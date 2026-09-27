import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeAbiParameters, parseAbiParameters } from 'viem';
import { inputAmount, slippageBps, minimumOutput, encodeSwap, swapParameters, type PoolKey } from '../src/math';
import { firstBlockAtOrAfter } from '../src/chain';

const key: PoolKey = { currency0: '0x0000000000000000000000000000000000000000', currency1: '0x0000000000000000000000000000000000000001', fee: 3000, tickSpacing: 60, hooks: '0x0000000000000000000000000000000000000044' };
test('decimal input preserves wei and rejects rounding, exponent, signs and uint128 overflow', () => {
  assert.equal(inputAmount('0.000000000000000001', 18), 1n);
  assert.equal(inputAmount('.125', 6), 125000n);
  for (const bad of ['0', '-1', '1e6', 'Infinity', 'NaN', '0.0000001', '1,000', ' 1']) assert.throws(() => inputAmount(bad, 6));
  assert.throws(() => inputAmount((2n ** 128n).toString(), 0));
});
test('slippage rounds output down and never permits a zero minimum', () => {
  assert.equal(slippageBps('0.5'), 50n);
  assert.equal(minimumOutput(101n, 50n), 100n);
  assert.throws(() => minimumOutput(1n, 500n));
  for (const bad of ['0', '5.01', '-1', '1e2', '0.001']) assert.throws(() => slippageBps(bad));
});
for (const buy of [true, false]) test(`${buy ? 'buy' : 'sell'} calldata binds direction, exact input, on-chain minimum and settlement currencies`, () => {
  const encoded = encodeSwap(key, buy, 10n ** 18n, 900n);
  const [actions, params] = decodeAbiParameters(parseAbiParameters('bytes, bytes[]'), encoded);
  assert.equal(actions, '0x060c0f');
  const [swap] = decodeAbiParameters(swapParameters, params[0]);
  assert.deepEqual(swap, { poolKey: key, zeroForOne: buy, amountIn: 10n ** 18n, amountOutMinimum: 900n, hookData: '0x' });
  assert.deepEqual(decodeAbiParameters(parseAbiParameters('address, uint256'), params[1]), [buy ? key.currency0 : key.currency1, 10n ** 18n]);
  assert.deepEqual(decodeAbiParameters(parseAbiParameters('address, uint256'), params[2]), [buy ? key.currency1 : key.currency0, 900n]);
});
test('24-hour boundary finds the first timestamp, including gaps, equal timestamps and recent deployment', async () => {
  const timestamps = [50n, 55n, 65n, 65n, 100n];
  const at = async (n: bigint) => timestamps[Number(n)];
  assert.equal(await firstBlockAtOrAfter(0n, 4n, 65n, at), 2n);
  assert.equal(await firstBlockAtOrAfter(0n, 4n, 66n, at), 4n);
  assert.equal(await firstBlockAtOrAfter(0n, 4n, 20n, at), 0n);
  assert.equal(await firstBlockAtOrAfter(4n, 4n, 20n, at), 4n);
});
