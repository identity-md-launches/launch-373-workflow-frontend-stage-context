import { readFile, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createPublicClient, custom, keccak256, type Hex } from 'viem';
import type { Runtime } from '../src/config';
import { getPool, readHistory, readSnapshot, verifyChain } from '../src/chain';
import { poolId } from '../src/math';

// Read-only audit: curl honors the worker's network proxy; no wallets or signing.
const exec = promisify(execFile);
const manifest = JSON.parse(await readFile('../dist/imd-deployment.json', 'utf8'));
const abis: Runtime['abis'] = {};
for (const c of [...manifest.contracts, ...Object.entries(manifest.protocolInterfaces).map(([name, v]) => ({ name, ...(v as object) }))]) abis[c.name] = JSON.parse(await readFile(`../dist/${c.abiPath}`, 'utf8'));
let usedRpc = '';
const client = createPublicClient({ transport: custom({ request: async ({ method, params }) => {
  let failure: unknown;
  for (const url of manifest.network.rpcUrls) {
    try {
      const { stdout } = await exec('curl', ['--silent', '--show-error', '--fail', '--max-time', '20', '-H', 'Content-Type: application/json', '--data-binary', JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), url], { maxBuffer: 8 * 1024 * 1024 });
      const result = JSON.parse(stdout);
      if (result.error) throw Error(JSON.stringify(result.error));
      usedRpc = url;
      return result.result;
    } catch (error) { failure = error; }
  }
  throw failure;
} }, { retryCount: 0 }) });
const r = { manifest, abis, client, token: manifest.contracts.find((c: { name: string }) => c.name === manifest.token.contract), hook: manifest.contracts.find((c: { name: string }) => c.name === manifest.hookContract) } as unknown as Runtime;
const evidence: Record<string, unknown> = { checkedAt: new Date().toISOString(), mode: 'Read-only public RPC; no transactions broadcast', sourceCommit: manifest.sourceCommit, checks: {} };
try {
  await verifyChain(r);
  evidence.deploymentCheck = 'passed: chain ID, nonempty code, hook manager';
  const codes = [];
  for (const [name, address] of [...manifest.contracts.map((c: { name: string; address: string }) => [c.name, c.address]), ...Object.entries(manifest.network.uniswapV4)]) {
    const code = await client.getBytecode({ address: address as Hex });
    codes.push({ name, address, bytes: code ? (code.length - 2) / 2 : 0, keccak256: code ? keccak256(code) : null });
  }
  evidence.code = codes;
  const snapshot = await readSnapshot(r);
  evidence.snapshot = snapshot;
  evidence.poolId = poolId(getPool(r));
  try { evidence.history = await readHistory(r, snapshot); } catch (error) { evidence.historyError = String(error); }
  try {
    const quote = await client.simulateContract({ address: manifest.network.uniswapV4.quoter, abi: abis.Quoter, functionName: 'quoteExactInputSingle', args: [{ poolKey: getPool(r), zeroForOne: true, exactAmount: 100000000000n, hookData: '0x' }] });
    evidence.readOnlyBuyQuote = { amountInWei: '100000000000', result: quote.result };
  } catch (error) { evidence.readOnlyBuyQuoteError = String(error); }
  evidence.rpcUsed = usedRpc;
} catch (error) { evidence.error = String(error); process.exitCode = 1; }
await writeFile('../docs/frontend/live-chain.json', JSON.stringify(evidence, (_, v) => typeof v === 'bigint' ? v.toString() : v, 2) + '\n');
console.log(JSON.stringify(evidence, (_, v) => typeof v === 'bigint' ? v.toString() : v, 2));
