import { useEffect, useRef, useState } from 'react';
import { formatUnits, type Address, type Hex } from 'viem';
import type { Runtime } from './config';
import { getPool, human, readBalances, verifyChain, type Balances, type Snapshot } from './chain';
import { display, encodeSwap, errorMessage, inputAmount, minimumOutput, slippageBps } from './math';
import { signingWallet } from './wallet';

type Quote = { output: bigint; min: bigint; amount: bigint; buy: boolean; createdAt: number; account: Address; slippage: string };
type Props = { runtime: Runtime; address?: Address; wrongChain: boolean; snapshot?: Snapshot; verified: boolean; onConnect: () => void; onSwitch: () => void; onSuccess: () => void };
export function Swap({ runtime: r, address, wrongChain, snapshot, verified, onConnect, onSwitch, onSuccess }: Props) {
  const [buy, setBuy] = useState(true), [amountText, setAmountText] = useState(''), [slippage, setSlippage] = useState('0.5');
  const [quote, setQuote] = useState<Quote>(), [balances, setBalances] = useState<Balances>();
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [status, setStatus] = useState('');
  const [hash, setHash] = useState<Hex>(), [now, setNow] = useState(Date.now()), [balanceError, setBalanceError] = useState('');
  const version = useRef(0), lock = useRef(false);
  const epoch = `${address}:${wrongChain}:${buy}:${amountText}:${slippage}`;
  const currentEpoch = useRef(epoch); currentEpoch.current = epoch;
  const decimals = snapshot?.decimals ?? r.manifest.token.decimals;
  const symbol = snapshot?.symbol ?? r.manifest.token.symbol;
  const inputSymbol = buy ? 'ETH' : symbol, outputSymbol = buy ? symbol : 'ETH';
  const inputDecimals = buy ? r.manifest.network.nativeCurrency.decimals : decimals;
  const outputDecimals = buy ? decimals : r.manifest.network.nativeCurrency.decimals;
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(id); }, []);
  useEffect(() => { version.current++; setQuote(undefined); setError(''); setStatus(''); }, [epoch]);
  useEffect(() => {
    let alive = true;
    setBalances(undefined); setBalanceError('');
    if (address && !wrongChain && verified) readBalances(r, address).then(b => { if (alive) setBalances(b); }).catch(e => { if (alive) setBalanceError(errorMessage(e)); });
    return () => { alive = false; };
  }, [r, address, wrongChain, verified, snapshot]);
  const fresh = !!snapshot && now - snapshot.receivedAt < 120_000;
  const ready = verified && fresh && !!snapshot?.sqrtPrice && !!address && !wrongChain && !!balances;
  const quoteFresh = !!quote && now - quote.createdAt < 30_000 && quote.account === address && quote.buy === buy && quote.slippage === slippage;
  const needToken = !buy && !!quote && !!balances && balances.allowance < quote.amount;
  const needPermit = !buy && !!quote && !!balances && (balances.permit[0] < quote.amount || balances.permit[1] < Math.floor(now / 1000) + 300);
  const action = needToken ? `Approve ${symbol}` : needPermit ? 'Enable router spending' : `Confirm ${buy ? 'buy' : 'sell'}`;
  async function refreshBalances() { if (address) setBalances(await readBalances(r, address)); }
  async function getQuote() {
    if (lock.current || !address || !ready) return;
    lock.current = true; setBusy(true); setError(''); setStatus(''); setHash(undefined); setQuote(undefined);
    const request = ++version.current;
    const startEpoch = currentEpoch.current;
    try {
      const amount = inputAmount(amountText, inputDecimals);
      const bps = slippageBps(slippage);
      const available = buy ? balances!.eth : balances!.token;
      if (amount > available || (buy && amount === available)) throw Error(buy ? 'Enter less than your ETH balance to leave room for gas.' : `Your ${symbol} balance is too low for this amount.`);
      const response = await r.client.simulateContract({
        address: r.manifest.network.uniswapV4.quoter, abi: r.abis.Quoter, functionName: 'quoteExactInputSingle',
        args: [{ poolKey: getPool(r), zeroForOne: buy, exactAmount: amount, hookData: '0x' }], account: address,
      });
      const [output] = response.result as readonly [bigint, bigint];
      const min = minimumOutput(output, bps);
      if (version.current !== request || currentEpoch.current !== startEpoch) return;
      setQuote({ output, min, amount, buy, createdAt: Date.now(), account: address, slippage });
      setStatus('Quote ready. Review the amounts before continuing.');
    } catch (e) { if (currentEpoch.current === startEpoch) setError(errorMessage(e)); }
    finally { setBusy(false); lock.current = false; }
  }
  async function transact() {
    if (lock.current || !ready || !quoteFresh || !quote || !address) return;
    lock.current = true; setBusy(true); setError(''); setHash(undefined);
    const startEpoch = currentEpoch.current;
    const assertCurrent = () => {
      if (currentEpoch.current !== startEpoch || Date.now() - quote.createdAt >= 30_000) throw Error('The quote expired or your selection changed. Request a new quote.');
    };
    let stage = 'swap';
    try {
      setStatus('Checking deployment and simulating the transaction…');
      await verifyChain(r);
      const currentBalances = await readBalances(r, address);
      setBalances(currentBalances);
      assertCurrent();
      const u = r.manifest.network.uniswapV4;
      let call;
      if (!buy && currentBalances.allowance < quote.amount) {
        stage = 'token approval';
        call = { address: r.token.address, abi: r.abis[r.token.name], functionName: 'approve', args: [u.permit2, quote.amount], account: address };
      } else if (!buy && (currentBalances.permit[0] < quote.amount || currentBalances.permit[1] < Math.floor(Date.now() / 1000) + 300)) {
        stage = 'router permission';
        call = { address: u.permit2, abi: r.abis.Permit2, functionName: 'approve', args: [r.token.address, u.universalRouter, quote.amount, Math.floor(Date.now() / 1000) + 1800], account: address };
      } else {
        call = { address: u.universalRouter, abi: r.abis.UniversalRouter, functionName: 'execute',
          args: ['0x10', [encodeSwap(getPool(r), buy, quote.amount, quote.min)], BigInt(Math.floor(Date.now() / 1000) + 300)],
          value: buy ? quote.amount : 0n, account: address };
      }
      const simulation = await r.client.simulateContract(call);
      const wallet = await signingWallet(r, address);
      assertCurrent();
      setStatus(`Confirm ${stage} in your wallet.`);
      const tx = await wallet.writeContract({ ...simulation.request, chain: r.chain, account: address });
      setHash(tx); setStatus(`${stage[0].toUpperCase() + stage.slice(1)} submitted. Waiting for confirmation…`);
      const receipt = await r.client.waitForTransactionReceipt({ hash: tx, confirmations: 1, timeout: 180_000 });
      if (receipt.status !== 'success') throw Error(`The ${stage} reverted on chain. No successful ${stage} was confirmed. Review the transaction before retrying.`);
      setStatus(`${stage[0].toUpperCase() + stage.slice(1)} confirmed.`);
      if (currentEpoch.current === startEpoch) await refreshBalances();
      if (stage === 'swap') { setQuote(undefined); onSuccess(); }
    } catch (e) { setError(errorMessage(e)); setStatus(''); }
    finally { setBusy(false); lock.current = false; }
  }
  const blocking = !verified ? 'Verifying the deployment before trading.' : !fresh ? 'Pool data is stale. Refresh the pool to continue.' : !snapshot?.sqrtPrice ? 'The pool is not initialized. Trading is unavailable.' : !balances && address && !wrongChain ? 'Reading wallet balances and spending permissions…' : '';
  return <section className="swap panel" aria-labelledby="swap-title">
    <div className="section-heading"><h2 id="swap-title">Swap Rebate</h2><span className="tag">Testnet only</span></div>
    <div className="segment" aria-label="Trade direction">
      <button type="button" aria-pressed={buy} disabled={busy} onClick={() => setBuy(true)}>Buy {symbol}</button>
      <button type="button" aria-pressed={!buy} disabled={busy} onClick={() => setBuy(false)}>Sell {symbol}</button>
    </div>
    <form onSubmit={e => { e.preventDefault(); void getQuote(); }} noValidate>
      <div className="amount-box">
        <label htmlFor="amount">You pay</label>
        <div className="amount-row"><input id="amount" name="amount" inputMode="decimal" autoComplete="off" placeholder="0.00" value={amountText} disabled={busy} onChange={e => setAmountText(e.target.value)} aria-describedby="balance swap-error" aria-invalid={!!error} /><span className="currency"><span className={`coin ${buy ? 'eth' : ''}`} aria-hidden="true">{buy ? 'Ξ' : 'r'}</span>{inputSymbol}</span></div>
        <p className="small muted" id="balance">Balance: {balances ? `${display(human(buy ? balances.eth : balances.token, inputDecimals))} ${inputSymbol}` : 'Connect to view'}</p>
      </div>
      <div className="swap-divider" aria-hidden="true">↓</div>
      <div className="amount-box receive"><span className="small muted">You receive · estimate</span><div className="amount-row"><output>{quoteFresh ? display(human(quote!.output, outputDecimals)) : '—'}</output><span className="currency"><span className={`coin ${buy ? '' : 'eth'}`} aria-hidden="true">{buy ? 'r' : 'Ξ'}</span>{outputSymbol}</span></div></div>
      <div className="slippage-row"><label htmlFor="slippage">Slippage tolerance</label><div><input id="slippage" name="slippage" inputMode="decimal" value={slippage} disabled={busy} onChange={e => setSlippage(e.target.value)} aria-describedby="slippage-hint" /><span>%</span></div></div>
      <p className="small muted" id="slippage-hint">0.01–5%. Minimum received is enforced on chain.</p>
      {quote && <div className="quote-detail">
        <dl><div><dt>Minimum received</dt><dd>{formatUnits(quote.min, outputDecimals)} {outputSymbol}</dd></div><div><dt>Quote expires in</dt><dd>{Math.max(0, Math.ceil((30_000 - (now - quote.createdAt)) / 1000))}s</dd></div><div><dt>Transaction deadline</dt><dd>5 minutes</dd></div></dl>
        {!buy && <ol className="steps"><li>{balances && balances.allowance >= quote.amount ? '✓ ' : '1. '}Approve exactly {formatUnits(quote.amount, decimals)} {symbol} to Permit2</li><li>{balances && !needPermit ? '✓ ' : '2. '}Allow the router this amount for 30 minutes</li><li>3. Confirm the sell</li></ol>}
        {!quoteFresh && <p className="notice">Quote expired. Refresh the quote before continuing.</p>}
      </div>}
      <div className="action-stack">
        {!address ? <button type="button" className="primary" onClick={onConnect}>Connect wallet <span aria-hidden="true">↗</span></button> : wrongChain ? <button type="button" className="primary" onClick={onSwitch}>Switch to {r.manifest.network.name}</button> : <>
          <button type="submit" className={quoteFresh ? 'secondary' : 'primary'} disabled={busy || !ready}>{busy ? 'Request in progress…' : quote ? 'Refresh quote' : 'Preview swap'}{!quote && !busy && <span aria-hidden="true">↗</span>}</button>
          {quoteFresh && <button type="button" className="primary" disabled={busy || !ready} onClick={() => void transact()}>{busy ? 'Request in progress…' : action}</button>}
        </>}
      </div>
      {blocking && address && !wrongChain && <p className="small notice">{blocking}</p>}
      {balanceError && <p className="error" role="alert">Unable to read balances: {balanceError} Use Refresh pool to retry.</p>}
      <p id="swap-error" className="error" role={error ? 'alert' : undefined}>{error}</p>
      <p className="small" role="status">{status}</p>
      {hash && <a className="small" href={`${r.manifest.network.explorer}/tx/${hash}`} target="_blank" rel="noreferrer">View transaction on the explorer ↗</a>}
    </form>
    <p className="swap-footnote">Exact-input swaps through Uniswap v4. Quotes include the pool fee and applicable 0.5% donation. Network gas is separate.</p>
  </section>;
}
