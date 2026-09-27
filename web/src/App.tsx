import { useCallback, useEffect, useRef, useState } from 'react';
import type { Address } from 'viem';
import type { Runtime } from './config';
import { getPool, human, readHistory, readSnapshot, verifyChain, type History, type Snapshot } from './chain';
import { display, errorMessage, poolId, short } from './math';
import { connectWallet, disconnectWallet, getAccount, switchNetwork, watchAccount } from './wallet';
import { Swap } from './Swap';

function Arrow() { return <span aria-hidden="true">↗</span>; }
function Amount({ value, decimals, unit }: { value?: bigint; decimals: number; unit: string }) {
  return <span className="metric">{value === undefined ? '—' : display(human(value, decimals))}<span className="metric-unit">{unit}</span></span>;
}
function Activity({ runtime: r, history, snapshot, loading, error }: { runtime: Runtime; history?: History; snapshot?: Snapshot; loading: string; error: string }) {
  const [currency, setCurrency] = useState<'ETH' | 'RBTE'>('ETH'), [page, setPage] = useState(0);
  useEffect(() => setPage(0), [history]);
  const decimals = currency === 'ETH' ? r.manifest.network.nativeCurrency.decimals : snapshot?.decimals ?? r.manifest.token.decimals;
  const bars = Array<bigint>(24).fill(0n);
  history?.events.forEach(event => {
    const isEth = event.currency.toLowerCase() === getPool(r).currency0.toLowerCase();
    if (isEth !== (currency === 'ETH')) return;
    const i = Math.min(23, Math.floor(Number(event.timestamp - history.start) / 3600));
    if (i >= 0) bars[i] += event.amount;
  });
  const max = bars.reduce((a, b) => a > b ? a : b, 0n);
  return <section className="activity panel" aria-labelledby="activity-title">
    <div className="section-heading"><div><p className="eyebrow">Giving back, on chain</p><h2 id="activity-title">The last 24 hours</h2></div><div className="small-segment" aria-label="Chart currency"><button aria-pressed={currency === 'ETH'} onClick={() => setCurrency('ETH')}>ETH</button><button aria-pressed={currency === 'RBTE'} onClick={() => setCurrency('RBTE')}>RBTE</button></div></div>
    <div className="day-totals"><div><span className="small muted">ETH donated</span><Amount value={history?.sum0} decimals={r.manifest.network.nativeCurrency.decimals} unit="ETH" /></div><div><span className="small muted">Rebate donated</span><Amount value={history?.sum1} decimals={snapshot?.decimals ?? r.manifest.token.decimals} unit="RBTE" /></div></div>
    <div className="chart" role="img" aria-label={history ? `Hourly ${currency} donations. ${display(human(currency === 'ETH' ? history.sum0 : history.sum1, decimals))} ${currency} over the complete 24-hour window.` : 'Donation history unavailable until the complete window is loaded.'}>
      {history ? <div className="bars">{bars.map((amount, i) => <div className="bar-column" key={i}><div className={`bar ${amount === 0n ? 'zero' : ''}`} style={{ height: `${max ? Math.max(amount > 0n ? 2 : 0, Number(amount * 10000n / max) / 100) : 0}%` }} title={`${new Date(Number(history.start + BigInt(i) * 3600n) * 1000).toISOString()}: ${human(amount, decimals)} ${currency}`} /></div>)}</div> : <div className="chart-empty">{error ? 'History unavailable' : 'Reading the donation history…'}</div>}
      {history && max === 0n && <span className="chart-caption">No {currency} donations in this window</span>}
    </div>
    <div className="chart-axis"><span>24 hours ago</span><span>12 hours ago</span><span>Latest block</span></div>
    <p className="small muted history-status" role="status">{loading || (history ? `${history.events.length} donations · complete through block ${history.toBlock.toLocaleString()}` : 'The full window must load before totals or estimates are shown.')}</p>
    {error && <p className="error" role="alert">Donation history could not load: {error} Use Refresh pool to retry. No partial totals are displayed.</p>}
    {history && <>
      <details className="event-details"><summary>Donation transactions <span>{history.events.length}</span></summary>
        <p className="small muted">{new Date(Number(history.start) * 1000).toLocaleString()} – {new Date(Number(history.end) * 1000).toLocaleString()} (your local time). Hook Donated events for this pool only.</p>
        {history.events.length === 0 ? <p className="empty">No donations were recorded. A qualifying swap returns part of its output to in-range LPs.</p> : <><div className="table-scroll"><table><caption className="sr-only">Donations in the last 24 hours</caption><thead><tr><th scope="col">Time (local)</th><th scope="col">Amount</th><th scope="col">Transaction</th></tr></thead><tbody>{history.events.slice(page * 10, page * 10 + 10).map(event => {
          const eth = event.currency.toLowerCase() === getPool(r).currency0.toLowerCase();
          return <tr key={`${event.hash}:${event.index}`}><td>{new Date(Number(event.timestamp) * 1000).toLocaleTimeString()}</td><td>{display(human(event.amount, eth ? r.manifest.network.nativeCurrency.decimals : snapshot!.decimals))} {eth ? 'ETH' : 'RBTE'}</td><td><a href={`${r.manifest.network.explorer}/tx/${event.hash}`} target="_blank" rel="noreferrer" aria-label={`Donation transaction ${event.hash}`}>{short(event.hash)} ↗</a></td></tr>;
        })}</tbody></table></div>{history.events.length > 10 && <div className="pagination"><button disabled={page === 0} onClick={() => setPage(p => p - 1)}>Previous</button><span className="small">Page {page + 1} of {Math.ceil(history.events.length / 10)}</span><button disabled={(page + 1) * 10 >= history.events.length} onClick={() => setPage(p => p + 1)}>Next</button></div>}</>}
      </details>
      <details className="event-details"><summary>Hourly {currency} amounts</summary><div className="hourly">{bars.map((amount, i) => <p key={i}><span>{new Date(Number(history.start + BigInt(i) * 3600n) * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span><span>{display(human(amount, decimals))} {currency}</span></p>)}</div></details>
    </>}
  </section>;
}

export function App({ runtime: r }: { runtime: Runtime }) {
  const [account, setAccount] = useState(() => getAccount(r.walletConfig));
  const [snapshot, setSnapshot] = useState<Snapshot>(), [history, setHistory] = useState<History>();
  const [verified, setVerified] = useState(false), [refreshing, setRefreshing] = useState(false);
  const [readError, setReadError] = useState(''), [historyError, setHistoryError] = useState(''), [historyProgress, setHistoryProgress] = useState('');
  const [walletError, setWalletError] = useState(''), [walletBusy, setWalletBusy] = useState(false);
  const refreshingRef = useRef(false), alive = useRef(true);
  const wrongChain = !!account.address && account.chainId !== r.manifest.chainId;
  const refresh = useCallback(async () => {
    if (refreshingRef.current) return;
    refreshingRef.current = true; setRefreshing(true); setReadError(''); setVerified(false); setHistory(undefined); setHistoryError('');
    try {
      await verifyChain(r);
      const state = await readSnapshot(r);
      if (!alive.current) return;
      setSnapshot(state); setVerified(true); setHistoryProgress('Finding the 24-hour block window…');
      try {
        const recent = await readHistory(r, state, message => { if (alive.current) setHistoryProgress(message); });
        if (alive.current) setHistory(recent);
      } catch (e) { if (alive.current) setHistoryError(errorMessage(e)); }
    } catch (e) { if (alive.current) { setReadError(errorMessage(e)); setVerified(false); } }
    finally { if (alive.current) { setRefreshing(false); setHistoryProgress(''); } refreshingRef.current = false; }
  }, [r]);
  useEffect(() => {
    alive.current = true;
    const unwatch = watchAccount(r.walletConfig, { onChange: state => setAccount(state) });
    void refresh(); const id = setInterval(() => void refresh(), 90_000);
    return () => { alive.current = false; unwatch(); clearInterval(id); };
  }, [r, refresh]);
  async function walletAction(action: () => Promise<unknown>) {
    if (walletBusy) return;
    setWalletBusy(true); setWalletError('');
    try { await action(); } catch (e) { setWalletError(errorMessage(e)); }
    finally { setWalletBusy(false); }
  }
  const connect = () => void walletAction(() => connectWallet(r));
  const switchChain = () => void walletAction(() => switchNetwork(r));
  const decimals = snapshot?.decimals ?? r.manifest.token.decimals;
  const nativeDecimals = r.manifest.network.nativeCurrency.decimals;
  const price = snapshot?.sqrtPrice ? (Number(snapshot.sqrtPrice) / 2 ** 96) ** 2 * 10 ** (nativeDecimals - decimals) : undefined;
  const yield0 = history && snapshot?.liquidity ? human(history.sum0, nativeDecimals) / Number(snapshot.liquidity) : undefined;
  const yield1 = history && snapshot?.liquidity ? human(history.sum1, decimals) / Number(snapshot.liquidity) : undefined;
  return <>
    <a className="skip" href="#main">Skip to content</a>
    <header className="site-header wrap"><a className="brand" href="#main" aria-label="Rebate home"><span className="brand-mark" aria-hidden="true">r<span>↗</span></span>rebate<span className="brand-dot">.</span></a><nav aria-label="Main navigation"><a href="#overview">Pool overview</a><a href="#how-it-works">How it works</a></nav><div className="wallet-header"><span className="network-tag"><span aria-hidden="true">◉</span>{r.manifest.network.name}</span>{account.address ? <button className="wallet-button" title={account.address} disabled={walletBusy} onClick={() => void walletAction(() => disconnectWallet(r))}>{short(account.address)} · Disconnect</button> : <button className="wallet-button" disabled={walletBusy} onClick={connect}>{walletBusy ? 'Connecting…' : 'Connect wallet'} <Arrow /></button>}</div></header>
    <main id="main" className="wrap">
      {walletError && <p className="error banner" role="alert">{walletError}</p>}
      {wrongChain && <div className="notice banner" role="status"><span>Your wallet is on another network. Switch to {r.manifest.network.name} to trade.</span><button onClick={switchChain} disabled={walletBusy}>Switch to {r.manifest.network.name}</button></div>}
      <section className="hero" aria-labelledby="hero-title"><div><p className="eyebrow">Rebate / Uniswap v4</p><h1 id="hero-title">A little back,<br /><em>every swap.</em></h1><p className="hero-copy">Trade RBTE. Give back to liquidity.<br />A 0.5% donation flows to in-range LPs with each qualifying swap.</p></div><div className="mechanism" aria-label="A qualifying swap donates 0.5% to liquidity providers in range"><div className="flow-top"><span className="flow-label">Your swap</span><span className="flow-line" /><span className="flow-label">The pool</span></div><div className="loop-figure"><span className="orbit orbit-one" /><span className="orbit orbit-two" /><span className="loop-number">0.5<span>%</span><small>back to LPs</small></span></div><p className="small">Same swap. Shared liquidity.</p></div></section>
      <section id="overview" className="overview" aria-labelledby="pool-title"><div className="pool-heading"><div className="pool-name"><div className="paired-coins" aria-hidden="true"><span className="coin eth">Ξ</span><span className="coin">r</span></div><div><h2 id="pool-title">ETH / RBTE</h2><p className="small muted">Uniswap v4 · 0.30% pool fee · Sepolia testnet</p></div></div><button className="refresh" disabled={refreshing} onClick={() => void refresh()}>{refreshing ? 'Refreshing pool…' : 'Refresh pool'} <span aria-hidden="true">↻</span></button></div>
      <div className="read-status" role="status"><span className={`status-dot ${verified ? 'verified' : ''}`} aria-hidden="true" />{verified && snapshot ? `Live reads verified · block ${snapshot.block.toLocaleString()} · ${new Date(Number(snapshot.timestamp) * 1000).toLocaleTimeString()}` : readError ? 'Connection unavailable · transactions disabled' : 'Verifying contracts and reading the pool…'}</div>
      {readError && <p className="error banner" role="alert">{readError} Refresh the pool to retry.{snapshot && ' Figures below are from the last successful read.'}</p>}
      <div className="pool-grid"><aside className="trade-column"><Swap runtime={r} address={account.address as Address | undefined} wrongChain={wrongChain} verified={verified} snapshot={snapshot} onConnect={connect} onSwitch={switchChain} onSuccess={() => void refresh()} /><div className="testnet-note"><span className="note-icon" aria-hidden="true">ⓘ</span><div><strong>A place to try it out.</strong><p className="small muted">This pool is on Sepolia. Use test ETH to explore the mechanism.</p><a className="small" href={r.manifest.network.faucets[0]} target="_blank" rel="noreferrer">Get Sepolia test ETH <Arrow /></a></div></div></aside><div className="analytics"><section className="lifetime panel" aria-labelledby="donation-title"><div className="section-heading"><h2 id="donation-title">Returned to liquidity</h2><span className="tag">All time</span></div><div className="lifetime-totals"><div><Amount value={snapshot?.total0} decimals={nativeDecimals} unit="ETH" /><span className="small muted">Native currency donated</span></div><div><Amount value={snapshot?.total1} decimals={decimals} unit="RBTE" /><span className="small muted">Rebate tokens donated</span></div></div><div className="price-row"><span className="small muted">Current pool price</span><strong>{price === undefined ? '—' : `1 ETH ≈ ${display(price, 2)} RBTE`}</strong></div></section>
      <Activity runtime={r} history={history} snapshot={snapshot} loading={historyProgress} error={historyError} />
      <section className="yield-panel" aria-labelledby="yield-title"><div><div className="section-heading"><h2 id="yield-title">A view of LP yield</h2><span className="tag">Estimate</span></div><p className="small muted">24-hour donations ÷ current in-range liquidity</p></div><div className="yield-values"><div><strong>{yield0 === undefined ? '—' : display(yield0, 10)}</strong><span>ETH per liquidity unit</span></div><div><strong>{yield1 === undefined ? '—' : display(yield1, 10)}</strong><span>RBTE per liquidity unit</span></div></div><p className="small muted">A rough historical ratio, not an APY or your position’s return. Liquidity changes over time. One unit means one raw Uniswap liquidity unit.{snapshot?.liquidity === 0n && ' There is no current in-range liquidity, so this estimate is unavailable.'}</p><details><summary>See pool measurements</summary><dl className="measurement"><div><dt>In-range liquidity (raw L)</dt><dd>{snapshot?.liquidity.toString() ?? '—'}</dd></div><div><dt>Current tick</dt><dd>{snapshot?.tick ?? '—'}</dd></div><div><dt>Live LP fee</dt><dd>{snapshot ? `${snapshot.lpFee / 10000}%` : '—'}</dd></div><div><dt>Protocol fee (packed)</dt><dd>{snapshot?.protocolFee ?? '—'}</dd></div><div><dt>Donation rate</dt><dd>{snapshot ? `${Number(snapshot.donationBps) / 100}%` : '—'}</dd></div><div><dt>Fixed token supply</dt><dd>{snapshot ? `${display(human(snapshot.supply, decimals), 0)} RBTE` : '—'}</dd></div></dl></details></section></div>
      </div></section>
      <section id="how-it-works" className="how" aria-labelledby="how-title"><div className="how-intro"><p className="eyebrow">Built to give back</p><h2 id="how-title">Small by design. <br />Shared by the pool.</h2></div><ol className="how-steps"><li><span>01</span><div><h3>Make a swap</h3><p>Buy RBTE with ETH or sell RBTE for ETH. Preview the amount before your wallet confirms.</p></div></li><li><span>02</span><div><h3>A little goes back</h3><p>The hook donates 0.5% of the output on an exact-input swap. Dust and swaps ending with no in-range liquidity pay no donation.</p></div></li><li><span>03</span><div><h3>Liquidity providers share it</h3><p>Donations reach LPs in range at the post-swap tick, including liquidity added in the same block. The hook holds no funds.</p></div></li></ol></section>
      <section className="deployment" aria-labelledby="deployment-title"><details><summary id="deployment-title">Deployment &amp; contract details <span className="small muted">View addresses and configuration</span></summary><p className="small muted">The app loads this deployment manifest and its verified ABI files. The hook has no owner, pause, withdrawal or upgrade controls.</p><div className="contract-list">{[...r.manifest.contracts, ...Object.entries(r.manifest.network.uniswapV4).map(([name, address]) => ({ name, address }))].map(c => <div key={c.name}><strong>{c.name}</strong><a href={`${r.manifest.network.explorer}/address/${c.address}`} target="_blank" rel="noreferrer"><code>{c.address}</code> <Arrow /></a></div>)}</div><dl className="measurement"><div><dt>Pool ID</dt><dd><code>{poolId(getPool(r))}</code></dd></div><div><dt>Deployed source commit</dt><dd><code>{r.manifest.sourceCommit}</code></dd></div><div><dt>Attestation hash</dt><dd><code>{r.manifest.attestationHash}</code></dd></div><div><dt>Chain ID</dt><dd>{r.manifest.chainId}</dd></div></dl><a href="./imd-deployment.json" target="_blank" rel="noreferrer">Open deployment manifest <Arrow /></a></details></section>
    </main><footer className="wrap"><a className="brand footer-brand" href="#main">rebate.</a><p className="small muted">A small return to the people behind the pool.</p><span className="small muted">Sepolia · Experimental</span></footer>
  </>;
}
