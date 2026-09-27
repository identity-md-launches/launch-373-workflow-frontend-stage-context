import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
const dist = path.resolve('../dist'), evidence = path.resolve('../docs/frontend');
const server = createServer(async (req, res) => {
  try {
    const name = new URL(req.url!, 'http://localhost').pathname.replace(/^\/preview\//, '') || 'index.html';
    const type: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
    res.setHeader('Content-Type', type[path.extname(name)] || 'application/octet-stream');
    res.end(await readFile(path.join(dist, name)));
  } catch { res.writeHead(404); res.end(); }
});
await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
await page.addInitScript('globalThis.__name = value => value');
const errors: string[] = [], resources: { url: string; status: number }[] = [];
page.on('pageerror', e => errors.push(e.message));
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
page.on('response', response => resources.push({ url: response.url(), status: response.status() }));
const result: Record<string, unknown> = { checkedAt: new Date().toISOString(), mode: 'Unmocked production export with public RPC, no wallet, no transactions' };
try {
  await page.goto(`http://127.0.0.1:${(server.address() as { port: number }).port}/preview/`);
  await page.getByText('donations · complete through block', { exact: false }).waitFor({ timeout: 60000 });
  result.status = 'passed'; result.summary = await page.locator('.read-status, .history-status, .lifetime-totals, .yield-values').allTextContents();
  const pairs = await page.evaluate(() => {
    return [['primary', '.primary', '.primary'], ['body', '.hero-copy', 'body'], ['surface caption', '.swap-footnote', '.swap'], ['tinted caption', '.yield-panel .small.muted', '.yield-panel'], ['input', '#amount', '.amount-box']].map(([name, foreground, background]) => ({ name, color: getComputedStyle(document.querySelector(foreground)!).color, background: getComputedStyle(document.querySelector(background)!).backgroundColor }));
  });
  function luminance(rgb: string) {
    const values = rgb.match(/[\d.]+/g)!.slice(0, 3).map(Number).map(n => { const s = n / 255; return s <= .04045 ? s / 12.92 : ((s + .055) / 1.055) ** 2.4; });
    return values[0] * .2126 + values[1] * .7152 + values[2] * .0722;
  }
  // Body is transparent; its actual canvas is the root background.
  const canvas = await page.evaluate(() => getComputedStyle(document.documentElement).backgroundColor);
  result.contrast = pairs.map(pair => {
    if (pair.background === 'rgba(0, 0, 0, 0)') pair.background = canvas;
    const a = luminance(pair.color), b = luminance(pair.background);
    return { ...pair, ratio: Number(((Math.max(a, b) + .05) / (Math.min(a, b) + .05)).toFixed(2)) };
  });
  await page.screenshot({ path: path.join(evidence, 'live-desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: path.join(evidence, 'live-mobile.png'), fullPage: true });
} catch (error) { result.status = 'failed'; result.error = String(error); process.exitCode = 1; }
finally {
  result.errors = errors; result.resources = resources.map(item => ({ ...item, url: item.url.replace(/http:\/\/127\.0\.0\.1:\d+/, '[local-preview]') }));
  await writeFile(path.join(evidence, 'live-browser.json'), JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result, null, 2));
  await browser.close(); await new Promise<void>(resolve => server.close(() => resolve()));
}
