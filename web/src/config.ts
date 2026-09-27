import { createPublicClient, defineChain, fallback, http, keccak256, stringToHex, type Abi, type Address } from 'viem';
import { createConfig, injected } from '@wagmi/core';

export type Contract = { name: string; address: Address; abiHash: string; abiPath: string };
export type Manifest = {
  version: number; launchId: string; chainId: number; sourceCommit: string; attestationHash: string;
  contracts: Contract[]; assets: { path: string; sha256: string }[];
  network: {
    chainId: number; name: string; testnet: boolean; rpcUrls: string[]; explorer: string;
    nativeCurrency: { name: string; symbol: string; decimals: number }; faucets: string[];
    uniswapV4: Record<'poolManager' | 'universalRouter' | 'quoter' | 'stateView' | 'permit2' | 'positionManager', Address>;
  };
  walletAddChain: { chainId: string; chainName: string; rpcUrls: string[]; nativeCurrency: { name: string; symbol: string; decimals: number }; blockExplorerUrls: string[] };
  pool: { pairedCurrency: Address; fee: number; tickSpacing: number; initialPrice: string };
  token: { name: string; symbol: string; decimals: number; contract: string };
  hookContract: string; deploymentBlock: number;
  protocolInterfaces: Record<string, { abiPath: string; abiHash: string }>;
};

export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical((value as Record<string, unknown>)[k])}`).join(',')}}`;
  return JSON.stringify(value);
}
const base = new URL('./', window.location.href);
export async function loadDeployment() {
  const response = await fetch(new URL('imd-deployment.json', base), { cache: 'no-cache' });
  if (!response.ok) throw Error('Deployment configuration could not load. Reload the page.');
  const manifest = await response.json() as Manifest;
  if (manifest.version !== 1 || manifest.chainId !== manifest.network?.chainId || Number(BigInt(manifest.walletAddChain.chainId)) !== manifest.chainId) throw Error('Deployment network mismatch. Transactions are unavailable.');
  const abis: Record<string, Abi> = {};
  await Promise.all([...manifest.contracts, ...Object.entries(manifest.protocolInterfaces).map(([name, value]) => ({ name, ...value }))].map(async c => {
    if (!/^[\w/-]+\.json$/.test(c.abiPath) || c.abiPath.includes('..')) throw Error('Unsafe ABI path');
    const res = await fetch(new URL(c.abiPath, base));
    if (!res.ok) throw Error(`Could not load ${c.name} ABI. Reload the page.`);
    const abi = await res.json();
    if (!Array.isArray(abi) || keccak256(stringToHex(canonical(abi))).slice(2) !== c.abiHash) throw Error(`${c.name} ABI verification failed. Transactions are unavailable.`);
    abis[c.name] = abi;
  }));
  const token = manifest.contracts.find(c => c.name === manifest.token.contract);
  const hook = manifest.contracts.find(c => c.name === manifest.hookContract);
  if (!token || !hook || manifest.pool.pairedCurrency !== '0x0000000000000000000000000000000000000000') throw Error('Unsupported or incomplete native-currency pool configuration');
  const chain = defineChain({
    id: manifest.chainId, name: manifest.network.name, testnet: manifest.network.testnet,
    nativeCurrency: manifest.network.nativeCurrency,
    rpcUrls: { default: { http: manifest.network.rpcUrls } },
    blockExplorers: { default: { name: 'Explorer', url: manifest.network.explorer } },
  });
  const transport = () => fallback(manifest.network.rpcUrls.map(url => http(url, { timeout: 12_000, retryCount: 1 })), { rank: false });
  const client = createPublicClient({ chain, transport: transport(), batch: { multicall: false } });
  const walletConfig = createConfig({ chains: [chain], connectors: [injected()], transports: { [chain.id]: transport() }, storage: null });
  return { manifest, token, hook, abis, chain, client, walletConfig };
}
export type Runtime = Awaited<ReturnType<typeof loadDeployment>>;
