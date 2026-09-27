import { chromium, type Page, type BrowserContext } from 'playwright';
import AxeBuilder from '@axe-core/playwright';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodeFunctionData, encodeFunctionResult, encodeEventTopics, encodeAbiParameters, decodeAbiParameters, parseAbiParameters, toHex, type Abi, type Hex } from 'viem';
import { getPool } from '../src/chain';
import { poolId, swapParameters } from '../src/math';
import type { Runtime } from '../src/config';

const web = fileURLToPath(new URL('../', import.meta.url)), root = path.resolve(web, '..'), dist = path.join(root, 'dist');
const evidenceDir = path.join(root, 'docs/frontend');
await mkdir(evidenceDir, { recursive: true });
const manifest = JSON.parse(await readFile(path.join(dist, 'imd-deployment.json'), 'utf8'));
const abis: Record<string, Abi> = {};
for (const c of [...manifest.contracts, ...Object.entries(manifest.protocolInterfaces).map(([name, v]) => ({ name, ...(v as object) }))]) abis[c.name] = JSON.parse(await readFile(path.join(dist, c.abiPath), 'utf8'));
const token = manifest.contracts.find((c: { name: string }) => c.name === manifest.token.contract);
const hook = manifest.contracts.find((c: { name: string }) => c.name === manifest.hookContract);
const r = { manifest, token, hook } as Runtime;
const key = getPool(r), id = poolId(key), u = manifest.network.uniswapV4;
const ACCOUNT = '0x1000000000000000000000000000000000000001';
const HEAD = BigInt(manifest.deploymentBlock) + 8000n, END = BigInt(Math.floor(Date.now() / 1000));
const HASH = ('0x' + 'ab'.repeat(32)) as Hex;
const sent: Array<{ to: string; data: Hex; value?: Hex }> = [];
const rpcCalls: Array<{ method: string; params: unknown }> = [];
const state = { missingCode: false, failLogs: false, revertExecute: false, empty: false, zeroLiquidity: false, uninitialized: false, allowance: 0n, permit: 0n, rpcFailure: false, quoteDelay: 0 };
const block = (n: bigint) => ({ number: toHex(n), hash: HASH, parentHash: HASH, timestamp: toHex(END - (HEAD - n) * 12n), gasLimit: '0x1c9c380', gasUsed: '0x0', miner: ACCOUNT, difficulty: '0x0', totalDifficulty: '0x0', extraData: '0x', baseFeePerGas: '0x1', size: '0x100', transactions: [], uncles: [], logsBloom: '0x' + '00'.repeat(256), receiptsRoot: HASH, stateRoot: HASH, transactionsRoot: HASH, nonce: '0x0000000000000000', sha3Uncles: HASH, mixHash: HASH });
const amounts = [1n, 2n, 3n, 4n, 5n].map(n => n * 10n ** 15n);
const fixtureLogs = [0n, 600n, 3600n, 7199n, 7201n].map((age, i) => ({
  address: hook.address, blockHash: HASH, blockNumber: toHex(HEAD - age), data: encodeAbiParameters(parseAbiParameters('uint256'), [amounts[i]]),
  topics: encodeEventTopics({ abi: abis[hook.name], eventName: 'Donated', args: { poolId: id, currency: i % 2 === 0 ? key.currency0 : key.currency1 } }),
  logIndex: toHex(i), transactionIndex: '0x0', transactionHash: ('0x' + (i + 1).toString(16).padStart(64, '0')) as Hex, removed: false,
}));
function abiFor(address: string) {
  const a = address.toLowerCase();
  if (a === token.address.toLowerCase()) return abis[token.name];
  if (a === hook.address.toLowerCase()) return abis[hook.name];
  if (a === u.stateView) return abis.StateView;
  if (a === u.quoter) return abis.Quoter;
  if (a === u.permit2) return abis.Permit2;
  if (a === u.universalRouter) return abis.UniversalRouter;
  throw Error(`Unexpected contract ${address}`);
}
async function rpc(method: string, params: any[]): Promise<any> {
  rpcCalls.push({ method, params });
  if (state.rpcFailure) throw Error('RPC fixture unavailable');
  if (method === 'eth_chainId') return manifest.walletAddChain.chainId;
  if (method === 'eth_getCode') return state.missingCode && params[0].toLowerCase() === u.universalRouter ? '0x' : '0x60006000';
  if (method === 'eth_blockNumber') return toHex(HEAD);
  if (method === 'eth_getBlockByNumber') return block(params[0] === 'latest' ? HEAD : BigInt(params[0]));
  if (method === 'eth_getBalance') return toHex(2n * 10n ** 18n);
  if (method === 'eth_estimateGas') return '0x50000';
  if (method === 'eth_gasPrice') return '0x1';
  if (method === 'eth_getTransactionCount') return '0x0';
  if (method === 'eth_getTransactionReceipt') return { transactionHash: params[0], blockHash: HASH, blockNumber: toHex(HEAD), transactionIndex: '0x0', cumulativeGasUsed: '0x50000', gasUsed: '0x50000', effectiveGasPrice: '0x1', from: ACCOUNT, to: sent.at(-1)?.to, contractAddress: null, logs: [], logsBloom: '0x' + '00'.repeat(256), status: '0x1', type: '0x2' };
  if (method === 'eth_getLogs') {
    if (state.failLogs) throw Error('Fixture log range unavailable');
    assert.equal(params[0].address.toLowerCase(), hook.address.toLowerCase());
    assert.equal(params[0].topics[1].toLowerCase(), id.toLowerCase());
    assert(BigInt(params[0].toBlock) - BigInt(params[0].fromBlock) < 1000n);
    return state.empty ? [] : fixtureLogs.filter(l => BigInt(l.blockNumber) >= BigInt(params[0].fromBlock) && BigInt(l.blockNumber) <= BigInt(params[0].toBlock));
  }
  if (method === 'eth_call') {
    const target = params[0].to.toLowerCase();
    const abi = abiFor(target);
    const call = decodeFunctionData({ abi, data: params[0].data });
    const args = call.args as any[];
    let result: any;
    switch (call.functionName) {
      case 'poolManager': result = u.poolManager; break;
      case 'getSlot0': result = [state.uninitialized ? 0n : 10000n * 2n ** 96n, 184216, 0, 3000]; break;
      case 'getLiquidity': result = state.zeroLiquidity ? 0n : 12345678901234567890123n; break;
      case 'totalDonated': assert.equal(args[0], id); result = args[1].toLowerCase() === key.currency0 ? 1250000000000000000n : 480500000000000000000000n; break;
      case 'decimals': result = 18; break;
      case 'symbol': result = 'RBTE'; break;
      case 'totalSupply': result = 10n ** 27n; break;
      case 'DONATION_BPS': result = 50n; break;
      case 'balanceOf': result = 1000000n * 10n ** 18n; break;
      case 'allowance': result = target === token.address.toLowerCase() ? state.allowance : [state.permit, Number(END + 3600n), 0]; break;
      case 'approve': result = target === token.address.toLowerCase() ? true : undefined; break;
      case 'quoteExactInputSingle': {
        assert.equal(target, u.quoter);
        assert.equal(args[0].poolKey.hooks.toLowerCase(), hook.address.toLowerCase());
        if (state.quoteDelay) await new Promise(resolve => setTimeout(resolve, state.quoteDelay));
        result = [args[0].zeroForOne ? args[0].exactAmount * 100000000n * 995n / 1000n : args[0].exactAmount * 995n / (100000000n * 1000n), 180000n]; break;
      }
      case 'execute': if (state.revertExecute) throw Error('execution reverted: Minimum output not met'); result = undefined; break;
      default: throw Error(`Unexpected contract call ${call.functionName}`);
    }
    return encodeFunctionResult({ abi, functionName: call.functionName, result });
  }
  throw Error(`Unhandled RPC method ${method}`);
}
const server = createServer(async (req, res) => {
  try {
    const pathname = new URL(req.url!, 'http://local').pathname;
    if (!pathname.startsWith('/preview/')) { res.writeHead(404); res.end(); return; }
    const file = path.join(dist, pathname.slice('/preview/'.length) || 'index.html');
    const mime: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
    res.setHeader('Content-Type', mime[path.extname(file)] || 'application/octet-stream');
    res.end(await readFile(file));
  } catch { res.writeHead(404); res.end(); }
});
await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
const url = `http://127.0.0.1:${(server.address() as { port: number }).port}/preview/`;
process.env.PLAYWRIGHT_BROWSERS_PATH ??= path.join(web, 'node_modules/.cache/playwright');
const browser = await chromium.launch({ headless: true });
const results: { name: string; status: string; detail?: unknown }[] = [];
const errors: string[] = [], failedResources: string[] = [];
async function check(name: string, run: () => Promise<unknown>) { const detail = await run(); results.push({ name, status: 'passed', ...(detail === undefined ? {} : { detail }) }); console.log(`PASS ${name}`); }
async function mockNetwork(context: BrowserContext) {
  context.setDefaultTimeout(15_000);
  // tsx/esbuild preserves names in serialized callbacks using this helper.
  await context.addInitScript('globalThis.__name = (value) => value;');
  await context.route(/^https:\/\//, async route => {
    assert(manifest.network.rpcUrls.some((url: string) => new URL(url).href === route.request().url()), `Unexpected external request: ${route.request().url()}`);
    const input = route.request().postDataJSON();
    const respond = async (request: any) => {
      try { return { jsonrpc: '2.0', id: request.id, result: await rpc(request.method, request.params ?? []) }; }
      catch (error) { return { jsonrpc: '2.0', id: request.id, error: { code: -32000, message: String(error) } }; }
    };
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(Array.isArray(input) ? await Promise.all(input.map(respond)) : await respond(input)) });
  });
}
async function attachWallet(context: BrowserContext, chainId = manifest.walletAddChain.chainId) {
  await context.exposeFunction('__sendFixtureTransaction', (tx: { to: string; data: Hex; value?: Hex }) => {
    sent.push(tx);
    const call = decodeFunctionData({ abi: abiFor(tx.to), data: tx.data });
    if (call.functionName === 'approve') {
      const args = call.args as any[];
      if (tx.to.toLowerCase() === token.address.toLowerCase()) { assert.equal(args[0].toLowerCase(), u.permit2); state.allowance = args[1]; }
      else { assert.equal(tx.to.toLowerCase(), u.permit2); assert.equal(args[0].toLowerCase(), token.address.toLowerCase()); assert.equal(args[1].toLowerCase(), u.universalRouter); state.permit = args[2]; }
    }
    return '0x' + sent.length.toString(16).padStart(64, '0');
  });
  await context.addInitScript(({ account, chainId }) => {
    const w = window as any;
    const listeners: Record<string, Array<(...args: any[]) => void>> = {};
    const fixture = w.__wallet = { chainId, account, connected: false, unknown: true, rejectConnect: false, rejectSign: false, calls: [] as any[], emit: (name: string, value: unknown) => (listeners[name] ?? []).forEach(fn => fn(value)) };
    w.ethereum = {
      isMetaMask: true, on: (event: string, fn: (...args: any[]) => void) => { (listeners[event] ??= []).push(fn); }, removeListener: (event: string, fn: (...args: any[]) => void) => { listeners[event] = (listeners[event] ?? []).filter(l => l !== fn); },
      request: async ({ method, params }: { method: string; params: any[] }) => {
        fixture.calls.push({ method, params });
        if (method === 'eth_chainId') return fixture.chainId;
        if (method === 'eth_accounts') return fixture.connected ? [fixture.account] : [];
        if (method === 'eth_requestAccounts') { if (fixture.rejectConnect) throw Object.assign(Error('User rejected request'), { code: 4001 }); fixture.connected = true; return [fixture.account]; }
        if (method === 'wallet_switchEthereumChain') { if (fixture.unknown) throw Object.assign(Error('Unknown chain'), { code: 4902 }); fixture.chainId = params[0].chainId; fixture.emit('chainChanged', fixture.chainId); return null; }
        if (method === 'wallet_addEthereumChain') { fixture.unknown = false; return null; }
        if (method === 'wallet_getCapabilities') return {};
        if (method === 'eth_sendTransaction') { if (fixture.rejectSign) throw Object.assign(Error('User rejected request'), { code: 4001 }); return w.__sendFixtureTransaction(params[0]); }
        if (method === 'wallet_requestPermissions' || method === 'wallet_getPermissions') return [{ parentCapability: 'eth_accounts' }];
        if (method === 'wallet_revokePermissions') return null;
        throw Error('Unexpected wallet method ' + method);
      },
    };
  }, { account: ACCOUNT, chainId });
}
async function loaded(page: Page) { await page.goto(url); await page.getByText('4 donations · complete through block', { exact: false }).waitFor({ timeout: 30000 }); }
async function connected(page: Page) { await page.getByRole('button', { name: /Connect wallet/ }).first().click(); await page.getByRole('button', { name: /Disconnect/ }).waitFor(); await page.getByText('Balance: 2 ETH').waitFor(); }
async function quote(page: Page, amount: string) { await page.getByLabel('You pay', { exact: true }).fill(amount); await page.getByRole('button', { name: 'Preview swap' }).click(); await page.getByText('Quote ready.', { exact: false }).waitFor(); }
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1100 }, reducedMotion: 'reduce' });
  await mockNetwork(context); await attachWallet(context);
  const page = await context.newPage();
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
  page.on('response', response => { if (response.status() >= 400) failedResources.push(response.url()); });
  await check('production export loads at a gateway subpath; complete 24-hour range excludes old events', async () => { await loaded(page); assert.match(await page.locator('.day-totals').innerText(), /0\.004/); assert.match(await page.locator('.day-totals').innerText(), /0\.006/); });
  await check('desktop, intermediate, mobile and 320px reflow; no horizontal overflow', async () => {
    for (const [width, height] of [[1440, 1100], [800, 1100], [390, 844], [320, 900]]) {
      await page.setViewportSize({ width, height });
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `Overflow at ${width}`);
      if (width !== 800) await page.screenshot({ path: path.join(evidenceDir, `desktop-${width}.png`), fullPage: true });
    }
  });
  await page.setViewportSize({ width: 1440, height: 1100 });
  await check('automated accessibility: names, structure and rendered contrast', async () => {
    const scan = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
    await writeFile(path.join(evidenceDir, 'accessibility.json'), JSON.stringify({ violations: scan.violations, passes: scan.passes.map(p => p.id), incomplete: scan.incomplete.map(i => ({ id: i.id, impact: i.impact })) }, null, 2));
    assert.deepEqual(scan.violations, []);
    return { violations: scan.violations.length, passingRules: scan.passes.length };
  });
  await check('keyboard skip link and visible focus', async () => {
    await loaded(page); await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => document.activeElement?.textContent), 'Skip to content');
    await page.screenshot({ path: path.join(evidenceDir, 'keyboard-focus.png') });
    await page.keyboard.press('Enter'); assert.equal(new URL(page.url()).hash, '#main');
  });
  await page.getByText('4 donations · complete through block', { exact: false }).waitFor();
  await check('connect wallet and quote a buy with no approval', async () => {
    await connected(page); await quote(page, '0.001');
    assert.equal(await page.getByRole('button', { name: /^Approve/ }).count(), 0);
    assert(await page.getByText('99500', { exact: false }).count() || await page.getByText('99,500').count());
  });
  await check('expired quotes remove confirmation until refreshed', async () => {
    await page.clock.install(); await page.clock.fastForward(31_000);
    await page.getByText('Quote expired. Refresh the quote before continuing.').waitFor();
    assert.equal(await page.getByRole('button', { name: 'Confirm buy' }).count(), 0);
    await page.getByRole('button', { name: 'Refresh quote' }).click(); await page.getByRole('button', { name: 'Confirm buy' }).waitFor();
  });
  await check('buy simulation precedes signing; calldata enforces minimum and native value', async () => {
    await page.getByRole('button', { name: 'Confirm buy' }).click(); await page.getByText('Swap confirmed.', { exact: true }).waitFor();
    const tx = sent.at(-1)!; assert.equal(tx.to.toLowerCase(), u.universalRouter); assert.equal(BigInt(tx.value!), 10n ** 15n);
    const decoded = decodeFunctionData({ abi: abis.UniversalRouter, data: tx.data });
    const [commands, inputs, deadline] = decoded.args as [Hex, Hex[], bigint]; assert.equal(commands, '0x10'); assert(deadline > END);
    const [actions, params] = decodeAbiParameters(parseAbiParameters('bytes, bytes[]'), inputs[0]); assert.equal(actions, '0x060c0f');
    const [swap] = decodeAbiParameters(swapParameters, params[0]); assert.equal(swap.zeroForOne, true); assert.equal(swap.amountIn, 10n ** 15n); assert(swap.amountOutMinimum > 0n);
    assert(rpcCalls.some(c => c.method === 'eth_call' && JSON.stringify(c.params).includes(tx.data)));
  });
  await check('sell uses explicit token approval, Permit2 permission, then router swap', async () => {
    await page.getByRole('button', { name: 'Sell RBTE', exact: true }).click();
    await page.getByText('Balance: 1,000,000 RBTE').waitFor();
    await quote(page, '100');
    for (const action of ['Approve RBTE', 'Enable router spending', 'Confirm sell']) {
      const button = page.getByRole('button', { name: action, exact: true }); await button.waitFor(); await button.click();
      await page.getByText(/^(Token approval|Router permission|Swap) confirmed\.$/).waitFor();
    }
    assert.equal(sent.length, 4);
    assert.equal(sent[1].to.toLowerCase(), token.address.toLowerCase()); assert.equal(sent[2].to.toLowerCase(), u.permit2); assert.equal(sent[3].to.toLowerCase(), u.universalRouter);
    assert.equal(state.allowance, 100n * 10n ** 18n); assert.equal(state.permit, 100n * 10n ** 18n);
  });
  await check('invalid precision and excess balance produce recoverable errors', async () => {
    await page.getByRole('button', { name: 'Buy RBTE', exact: true }).click();
    await page.getByText('Balance: 2 ETH').waitFor();
    await page.getByLabel('You pay', { exact: true }).fill('0.0000000000000000001'); await page.getByRole('button', { name: 'Preview swap' }).click(); await page.getByText(/Enter a positive amount with at most/).waitFor();
    await page.getByLabel('You pay', { exact: true }).fill('3'); await page.getByRole('button', { name: 'Preview swap' }).click(); await page.getByText('Enter less than your ETH balance to leave room for gas.').waitFor();
  });
  await check('wallet signing rejection is shown without broadcasting', async () => {
    await quote(page, '0.001'); await page.evaluate(() => { (window as any).__wallet.rejectSign = true; });
    await page.getByRole('button', { name: 'Confirm buy' }).click(); await page.getByText('Request declined in your wallet.', { exact: false }).waitFor(); assert.equal(sent.length, 4);
    await page.evaluate(() => { (window as any).__wallet.rejectSign = false; });
  });
  await check('reverting swap simulation blocks wallet signing', async () => {
    state.revertExecute = true;
    await page.getByRole('button', { name: 'Refresh quote' }).click(); await page.getByText('Quote ready.', { exact: false }).waitFor();
    await page.getByRole('button', { name: 'Confirm buy' }).click(); await page.getByText(/Minimum output not met/).waitFor({ timeout: 30000 }); assert.equal(sent.length, 4); state.revertExecute = false;
  });
  await check('editing amount invalidates quote; delayed response cannot restore it', async () => {
    await page.getByLabel('You pay', { exact: true }).fill('0.002'); assert.equal(await page.getByRole('button', { name: 'Confirm buy' }).count(), 0);
    state.quoteDelay = 500;
    await page.getByRole('button', { name: 'Refresh quote' }).count().then(async count => { await page.getByRole('button', { name: count ? 'Refresh quote' : 'Preview swap' }).click(); });
    await page.evaluate(() => { const wallet = (window as any).__wallet; wallet.account = '0x2000000000000000000000000000000000000002'; wallet.emit('accountsChanged', [wallet.account]); });
    await page.waitForTimeout(800); assert.equal(await page.getByRole('button', { name: 'Confirm buy' }).count(), 0); state.quoteDelay = 0;
  });
  await context.close();
  await check('unknown chain triggers exact add-chain parameters and a second switch', async () => {
    const context = await browser.newContext(); await mockNetwork(context); await attachWallet(context, '0x1');
    const page = await context.newPage(); await loaded(page); await page.getByRole('button', { name: /Connect wallet/ }).first().click();
    await page.getByRole('button', { name: 'Switch to Sepolia' }).first().click(); await page.getByText('Balance: 2 ETH').waitFor();
    const calls = await page.evaluate(() => (window as any).__wallet.calls);
    const add = calls.find((c: any) => c.method === 'wallet_addEthereumChain'); assert.deepEqual(add.params[0], manifest.walletAddChain);
    assert.equal(calls.filter((c: any) => c.method === 'wallet_switchEthereumChain').length, 2);
    await context.close();
  });
  await check('missing browser wallet and connection rejection are actionable', async () => {
    const context = await browser.newContext(); await mockNetwork(context);
    const page = await context.newPage(); await loaded(page); await page.getByRole('button', { name: /Connect wallet/ }).first().click(); await page.getByText(/No browser wallet found/).waitFor(); await context.close();
    const rejected = await browser.newContext(); await mockNetwork(rejected); await attachWallet(rejected); const p = await rejected.newPage(); await loaded(p); await p.evaluate(() => { (window as any).__wallet.rejectConnect = true; }); await p.getByRole('button', { name: /Connect wallet/ }).first().click(); await p.getByText(/Request declined in your wallet/).waitFor(); await rejected.close();
  });
  await check('missing router code keeps actions disabled', async () => {
    state.missingCode = true;
    const context = await browser.newContext(); await mockNetwork(context); await attachWallet(context); const page = await context.newPage(); await page.goto(url); await page.getByText(/No contract code at universalRouter/).waitFor(); await page.getByRole('button', { name: /Connect wallet/ }).first().click(); assert(await page.getByRole('button', { name: 'Preview swap' }).isDisabled()); await context.close(); state.missingCode = false;
  });
  await check('empty history and zero liquidity show unavailable yield without dividing by zero', async () => {
    state.empty = true; state.zeroLiquidity = true;
    const context = await browser.newContext(); await mockNetwork(context); const page = await context.newPage(); await page.goto(url); await page.getByText('0 donations · complete through block', { exact: false }).waitFor(); await page.getByText(/There is no current in-range liquidity/).waitFor(); assert.equal(await page.getByText('Infinity').count(), 0); await context.close(); state.empty = false; state.zeroLiquidity = false;
  });
  await check('failed log ranges never display partial 24-hour totals', async () => {
    state.failLogs = true;
    const context = await browser.newContext(); await mockNetwork(context); const page = await context.newPage(); await page.goto(url);
    await page.getByText(/No partial totals are displayed/).waitFor({ timeout: 60000 });
    assert(!/0\.004/.test(await page.locator('.day-totals').innerText()));
    assert.equal(await page.locator('.yield-values strong').first().innerText(), '—');
    await context.close(); state.failLogs = false;
  });
  await check('uninitialized pool blocks quotes while zero current liquidity alone does not', async () => {
    state.uninitialized = true;
    const context = await browser.newContext(); await mockNetwork(context); await attachWallet(context); const page = await context.newPage(); await loaded(page); await connected(page);
    await page.getByText('The pool is not initialized. Trading is unavailable.').waitFor(); assert(await page.getByRole('button', { name: 'Preview swap' }).isDisabled());
    state.uninitialized = false; state.zeroLiquidity = true; await page.getByRole('button', { name: 'Refresh pool', exact: true }).click();
    await page.getByRole('button', { name: 'Preview swap' }).waitFor();
    await page.waitForFunction(() => !(document.querySelector('button[type="submit"]') as HTMLButtonElement)?.disabled);
    await context.close(); state.zeroLiquidity = false;
  });
  await check('ABI tampering fails closed', async () => {
    const context = await browser.newContext(); await mockNetwork(context); await context.route('**/abi/RBTE.json', route => route.fulfill({ contentType: 'application/json', body: '[]' })); const page = await context.newPage(); await page.goto(url); await page.getByText(/RBTE ABI verification failed/).waitFor(); assert.equal(await page.getByRole('button', { name: /Confirm/ }).count(), 0); await context.close();
  });
  await check('primary buy flow completes using only the keyboard', async () => {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } }); await mockNetwork(context); await attachWallet(context);
    const page = await context.newPage(); await loaded(page);
    const tabTo = async (text: string, id = '') => {
      for (let i = 0; i < 50; i++) {
        await page.keyboard.press('Tab');
        const active = await page.evaluate(() => ({ id: document.activeElement?.id, text: document.activeElement?.textContent?.trim() }));
        if (id ? active.id === id : active.text?.includes(text)) return;
      }
      throw Error(`Keyboard could not reach ${text || id}`);
    };
    await tabTo('Connect wallet'); await page.keyboard.press('Enter'); await page.getByText('Balance: 2 ETH').waitFor();
    await tabTo('', 'amount'); await page.keyboard.type('0.001');
    await tabTo('Preview swap'); await page.keyboard.press('Enter'); await page.getByText('Quote ready.', { exact: false }).waitFor();
    await tabTo('Confirm buy'); await page.screenshot({ path: path.join(evidenceDir, 'keyboard-confirm-mobile.png') });
    await page.keyboard.press('Enter'); await page.getByText('Swap confirmed.', { exact: true }).waitFor();
    assert.equal(sent.length, 5); await context.close();
  });
  await check('no browser console errors or failed production resources', async () => { assert.deepEqual(errors, []); assert.deepEqual(failedResources, []); });
} catch (error) {
  results.push({ name: 'Execution interrupted', status: 'failed', detail: String(error) }); process.exitCode = 1; console.error(error);
} finally {
  await writeFile(path.join(evidenceDir, 'browser-results.json'), JSON.stringify({ checkedAt: new Date().toISOString(), browser: await browser.version(), mode: 'Production export at /preview/ with mocked RPC and EIP-1193 wallet; no real transactions', results, errors, failedResources, sentTransactions: sent.length, rpcRequests: rpcCalls.length }, null, 2) + '\n');
  await browser.close(); await new Promise<void>(resolve => server.close(() => resolve()));
}
