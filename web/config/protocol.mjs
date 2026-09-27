import { parseAbi } from 'viem';
// Minimal public interfaces; deployment addresses come only from network.json.
export const interfaces = {
  StateView: parseAbi([
    'function getSlot0(bytes32 poolId) view returns (uint160 sqrtPriceX96, int24 tick, uint24 protocolFee, uint24 lpFee)',
    'function getLiquidity(bytes32 poolId) view returns (uint128 liquidity)',
    'function poolManager() view returns (address)',
  ]),
  Quoter: parseAbi([
    'struct PoolKey { address currency0; address currency1; uint24 fee; int24 tickSpacing; address hooks; }',
    'struct QuoteExactSingleParams { PoolKey poolKey; bool zeroForOne; uint128 exactAmount; bytes hookData; }',
    'function quoteExactInputSingle(QuoteExactSingleParams params) returns (uint256 amountOut, uint256 gasEstimate)',
  ]),
  UniversalRouter: parseAbi([
    'function execute(bytes commands, bytes[] inputs, uint256 deadline) payable',
    'error ExecutionFailed(uint256 commandIndex, bytes message)',
    'error V4TooLittleReceived(uint256 minAmountOutReceived, uint256 amountReceived)',
  ]),
  Permit2: parseAbi([
    'function allowance(address owner, address token, address spender) view returns (uint160 amount, uint48 expiration, uint48 nonce)',
    'function approve(address token, address spender, uint160 amount, uint48 expiration)',
  ]),
};
