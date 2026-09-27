import { connect, disconnect, getAccount, getWalletClient, watchAccount } from '@wagmi/core';
import type { EIP1193Provider } from 'viem';
import type { Runtime } from './config';
export { getAccount, watchAccount };

export async function connectWallet(r: Runtime) {
  const connector = r.walletConfig.connectors[0];
  if (!await connector.getProvider()) throw Error('No browser wallet found. Open this page in a wallet browser or install a browser wallet, then retry.');
  await connect(r.walletConfig, { connector });
}
export function disconnectWallet(r: Runtime) { return disconnect(r.walletConfig); }

export async function switchNetwork(r: Runtime) {
  const connector = getAccount(r.walletConfig).connector;
  if (!connector) throw Error('Connect your wallet first.');
  const provider = await connector.getProvider() as EIP1193Provider;
  const chainId = r.manifest.walletAddChain.chainId as `0x${string}`;
  try {
    await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId }] });
  } catch (error) {
    const e = error as { code?: number; message?: string; data?: { originalError?: { code?: number } } };
    if (e.code !== 4902 && e.data?.originalError?.code !== 4902 && !/unknown chain|unrecognized chain|chain.*not.*added/i.test(e.message ?? '')) throw error;
    await provider.request({ method: 'wallet_addEthereumChain', params: [r.manifest.walletAddChain] });
    await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId }] });
  }
}

export async function signingWallet(r: Runtime, expectedAddress: string) {
  const current = getAccount(r.walletConfig);
  if (current.address?.toLowerCase() !== expectedAddress.toLowerCase() || current.chainId !== r.manifest.chainId) throw Error('Wallet account or network changed. Review a new quote.');
  const wallet = await getWalletClient(r.walletConfig, { chainId: r.manifest.chainId });
  const [chainId, accounts] = await Promise.all([wallet.getChainId(), wallet.getAddresses()]);
  if (chainId !== r.manifest.chainId || accounts[0]?.toLowerCase() !== expectedAddress.toLowerCase()) throw Error('Wallet account or network changed. Review a new quote.');
  return wallet;
}
