import { encodeAbiParameters, keccak256, parseAbiParameters, parseUnits, type Address } from 'viem';

export type PoolKey = { currency0: Address; currency1: Address; fee: number; tickSpacing: number; hooks: Address };
export const keyParameters = parseAbiParameters('(address currency0, address currency1, uint24 fee, int24 tickSpacing, address hooks)');
export const swapParameters = parseAbiParameters('((address currency0, address currency1, uint24 fee, int24 tickSpacing, address hooks) poolKey, bool zeroForOne, uint128 amountIn, uint128 amountOutMinimum, bytes hookData)');
export function poolId(key: PoolKey) { return keccak256(encodeAbiParameters(keyParameters, [key])); }
export function inputAmount(text: string, decimals: number): bigint {
  if (!/^(?:\d+\.?\d*|\.\d+)$/.test(text) || (text.split('.')[1]?.length ?? 0) > decimals) throw Error(`Enter a positive amount with at most ${decimals} decimal places.`);
  const value = parseUnits(text, decimals);
  if (value <= 0n || value >= 2n ** 128n) throw Error('Enter an amount greater than zero and within the swap limit.');
  return value;
}
export function slippageBps(text: string): bigint {
  if (!/^\d+(\.\d{1,2})?$/.test(text)) throw Error('Enter slippage from 0.01% to 5%, with at most two decimal places.');
  const bps = parseUnits(text, 2);
  if (bps < 1n || bps > 500n) throw Error('Enter slippage from 0.01% to 5%.');
  return bps;
}
export function minimumOutput(output: bigint, bps: bigint) {
  const result = output * (10_000n - bps) / 10_000n;
  if (result <= 0n || result >= 2n ** 128n) throw Error('The quoted output is outside the supported range. Try another amount.');
  return result;
}
export function encodeSwap(key: PoolKey, buy: boolean, amount: bigint, min: bigint) {
  const params = [
    encodeAbiParameters(swapParameters, [{ poolKey: key, zeroForOne: buy, amountIn: amount, amountOutMinimum: min, hookData: '0x' }]),
    encodeAbiParameters(parseAbiParameters('address, uint256'), [buy ? key.currency0 : key.currency1, amount]),
    encodeAbiParameters(parseAbiParameters('address, uint256'), [buy ? key.currency1 : key.currency0, min]),
  ];
  return encodeAbiParameters(parseAbiParameters('bytes, bytes[]'), ['0x060c0f', params]);
}
export function short(value: string) { return `${value.slice(0, 6)}…${value.slice(-4)}`; }
export function display(value: number, digits = 6) {
  if (!Number.isFinite(value)) return 'Unavailable';
  if (value !== 0 && Math.abs(value) < 10 ** -digits) return value.toExponential(3);
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: digits }).format(value);
}
export function errorMessage(error: unknown): string {
  const e = error as { shortMessage?: string; message?: string; code?: number; cause?: { code?: number } };
  if (e?.code === 4001 || e?.cause?.code === 4001 || /reject|denied/i.test(e?.message ?? '')) return 'Request declined in your wallet. You can try again when ready.';
  return (e?.shortMessage || e?.message || 'Unable to complete the request. Check your connection and try again.').slice(0, 450);
}
