import { type Address, type Hex, type AbiEvent, formatUnits } from 'viem';
import type { Runtime } from './config';
import { poolId, type PoolKey } from './math';

export function getPool(r: Runtime): PoolKey {
  return { currency0: r.manifest.pool.pairedCurrency, currency1: r.token.address,
    fee: r.manifest.pool.fee, tickSpacing: r.manifest.pool.tickSpacing, hooks: r.hook.address };
}
export async function verifyChain(r: Runtime) {
  if (await r.client.getChainId() !== r.manifest.chainId) throw Error('Public RPC returned the wrong network. Transactions are unavailable.');
  const u = r.manifest.network.uniswapV4;
  const entries = [...r.manifest.contracts.map(c => [c.name, c.address] as const),
    ...(['poolManager', 'stateView', 'universalRouter', 'quoter', 'permit2'] as const).map(k => [k, u[k]] as const)];
  await Promise.all(entries.map(async ([name, address]) => {
    const code = await r.client.getBytecode({ address });
    if (!code || code === '0x') throw Error(`No contract code at ${name}. Transactions are unavailable.`);
  }));
  const manager = await r.client.readContract({ address: r.hook.address, abi: r.abis[r.hook.name], functionName: 'poolManager' }) as Address;
  if (manager.toLowerCase() !== u.poolManager.toLowerCase()) throw Error('Hook PoolManager does not match the deployment network.');
}
export type Snapshot = {
  block: bigint; timestamp: bigint; blockHash: Hex; receivedAt: number;
  sqrtPrice: bigint; tick: number; liquidity: bigint; lpFee: number; protocolFee: number;
  total0: bigint; total1: bigint; decimals: number; symbol: string; supply: bigint; donationBps: bigint;
};
export async function readSnapshot(r: Runtime): Promise<Snapshot> {
  const head = await r.client.getBlock();
  const blockNumber = head.number;
  const read = (address: Address, abiName: string, functionName: string, args: unknown[] = []) =>
    r.client.readContract({ address, abi: r.abis[abiName], functionName, args, blockNumber });
  const id = poolId(getPool(r));
  const [slot, liquidity, total0, total1, decimals, symbol, supply, donationBps] = await Promise.all([
    read(r.manifest.network.uniswapV4.stateView, 'StateView', 'getSlot0', [id]),
    read(r.manifest.network.uniswapV4.stateView, 'StateView', 'getLiquidity', [id]),
    read(r.hook.address, r.hook.name, 'totalDonated', [id, getPool(r).currency0]),
    read(r.hook.address, r.hook.name, 'totalDonated', [id, r.token.address]),
    read(r.token.address, r.token.name, 'decimals'), read(r.token.address, r.token.name, 'symbol'),
    read(r.token.address, r.token.name, 'totalSupply'), read(r.hook.address, r.hook.name, 'DONATION_BPS'),
  ]);
  if (Number(decimals) !== r.manifest.token.decimals || symbol !== r.manifest.token.symbol) throw Error('Live token metadata does not match the handoff.');
  const [sqrtPrice, tick, protocolFee, lpFee] = slot as [bigint, number, number, number];
  return { block: blockNumber, blockHash: head.hash, timestamp: head.timestamp, receivedAt: Date.now(), sqrtPrice, tick, protocolFee, lpFee,
    liquidity: liquidity as bigint, total0: total0 as bigint, total1: total1 as bigint, decimals: Number(decimals), symbol: symbol as string, supply: supply as bigint, donationBps: donationBps as bigint };
}
export type Donation = { hash: Hex; index: number; block: bigint; timestamp: bigint; currency: Address; amount: bigint };
export type History = { start: bigint; end: bigint; fromBlock: bigint; toBlock: bigint; events: Donation[]; sum0: bigint; sum1: bigint };

export async function firstBlockAtOrAfter(low: bigint, high: bigint, cutoff: bigint, timestamp: (n: bigint) => Promise<bigint>) {
  while (low < high) {
    const middle = (low + high) / 2n;
    if (await timestamp(middle) < cutoff) low = middle + 1n;
    else high = middle;
  }
  return low;
}
async function concurrentMap<T, R>(items: T[], fn: (item: T) => Promise<R>, concurrency = 3): Promise<R[]> {
  let index = 0;
  const result: R[] = [];
  await Promise.all(Array.from({ length: Math.min(items.length, concurrency) }, async () => {
    while (index < items.length) { const i = index++; result[i] = await fn(items[i]); }
  }));
  return result;
}
export async function readHistory(r: Runtime, s: Snapshot, progress?: (message: string) => void): Promise<History> {
  const end = s.timestamp, start = end - 86400n;
  const blocks = new Map<bigint, Promise<bigint>>();
  const timestamp = (n: bigint) => {
    if (!blocks.has(n)) blocks.set(n, r.client.getBlock({ blockNumber: n }).then(b => b.timestamp));
    return blocks.get(n)!;
  };
  const fromBlock = await firstBlockAtOrAfter(BigInt(r.manifest.deploymentBlock), s.block, start, timestamp);
  const ranges: [bigint, bigint][] = [];
  for (let from = fromBlock; from <= s.block; from += 1000n) ranges.push([from, from + 999n < s.block ? from + 999n : s.block]);
  const event = r.abis[r.hook.name].find(e => e.type === 'event' && e.name === 'Donated') as AbiEvent;
  if (!event) throw Error('Donated event is missing from the verified ABI.');
  const id = poolId(getPool(r));
  let done = 0;
  const chunks = await concurrentMap(ranges, async ([from, to]) => {
    for (let attempt = 0; ; attempt++) {
      try {
        const logs = await r.client.getLogs({ address: r.hook.address, event, args: { poolId: id }, fromBlock: from, toBlock: to, strict: true });
        progress?.(`Reading donation history · ${++done}/${ranges.length} ranges`);
        return logs;
      } catch (error) {
        if (attempt >= 2) throw error;
        await new Promise(resolve => setTimeout(resolve, 500 * 2 ** attempt));
      }
    }
  });
  const seen = new Set<string>();
  const logs = chunks.flat().filter(log => {
    const unique = `${log.transactionHash}:${log.logIndex}`;
    if (log.removed || seen.has(unique)) return false;
    seen.add(unique); return true;
  });
  // Timestamp every event, never substitute a fixed blocks-per-day assumption.
  const events = (await concurrentMap(logs, async log => {
    const args = log.args as { poolId: Hex; currency: Address; amount: bigint };
    return { hash: log.transactionHash, index: log.logIndex, block: log.blockNumber, timestamp: await timestamp(log.blockNumber), currency: args.currency, amount: args.amount };
  })).filter(e => e.timestamp >= start && e.timestamp <= end && [getPool(r).currency0.toLowerCase(), r.token.address.toLowerCase()].includes(e.currency.toLowerCase()));
  const pinned = await r.client.getBlock({ blockNumber: s.block });
  if (pinned.hash !== s.blockHash) throw Error('The chain reorganized during the scan. Refresh to read a consistent 24-hour window.');
  events.sort((a, b) => a.block === b.block ? b.index - a.index : a.block > b.block ? -1 : 1);
  return { start, end, fromBlock, toBlock: s.block, events,
    sum0: events.reduce((sum, e) => sum + (e.currency.toLowerCase() === getPool(r).currency0.toLowerCase() ? e.amount : 0n), 0n),
    sum1: events.reduce((sum, e) => sum + (e.currency.toLowerCase() === r.token.address.toLowerCase() ? e.amount : 0n), 0n) };
}
export async function readBalances(r: Runtime, address: Address) {
  const [eth, token, allowance, permit] = await Promise.all([
    r.client.getBalance({ address }),
    r.client.readContract({ address: r.token.address, abi: r.abis[r.token.name], functionName: 'balanceOf', args: [address] }),
    r.client.readContract({ address: r.token.address, abi: r.abis[r.token.name], functionName: 'allowance', args: [address, r.manifest.network.uniswapV4.permit2] }),
    r.client.readContract({ address: r.manifest.network.uniswapV4.permit2, abi: r.abis.Permit2, functionName: 'allowance', args: [address, r.token.address, r.manifest.network.uniswapV4.universalRouter] }),
  ]);
  return { eth, token: token as bigint, allowance: allowance as bigint, permit: permit as readonly [bigint, number, number] };
}
export type Balances = Awaited<ReturnType<typeof readBalances>>;
export function human(value: bigint, decimals: number) { return Number(formatUnits(value, decimals)); }
