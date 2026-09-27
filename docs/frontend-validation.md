# Frontend validation — worker report

## Scope, outcome and limitations

Delivered a Vite/React/TypeScript static frontend, wagmi injected-wallet connection, live StateView/hook/token reads, complete 24-hour donation history, a labelled liquidity-ratio estimate, and simulated/confirmed buy/sell flows through the **supplied network's Universal Router**. Source, exact lockfile, configuration, tests and build scripts are under `web/`; the complete export and manifest are under `dist/`; evidence and final design are under `docs/`. Existing deployed contracts, ABIs, libraries, root configuration and prior contract validation documents are unchanged.

**Implemented scope and worker validation are complete. Literal acceptance has two unresolved specification conflicts:**

1. The task names PoolSwapTest, while the supplied unchanged network object lacks that address and separately requires every swap/quote/approval to use its addresses. The delivered implementation uses the supplied Universal Router, Quoter and Permit2. It does not execute PoolSwapTest and does not claim that criterion passed. No exception was supplied during implementation.
2. Root `DESIGN.md` is explicitly outside the overriding write scope. The required design content is delivered as `docs/DESIGN.md`; a root copy was not created.

This is a worker's check record, not an independent review or certification. Nothing was deployed, published or broadcast. No CID/site name is claimed. Full literal workflow completion requires reconciliation of the two conflicts above.

**Commit limitation:** the worker's real `.git` is mounted read-only. `git add` failed creating `.git/index.lock`; no real repository commit was made. All candidate files are present for the publisher to commit. A disposable Git snapshot in `test/scratch/` checks the packed size of every existing tracked file plus every new deliverable; it is a validation fixture, not an alternative submission. A full ancestor-history bundle could not be measured because this checkout is partial and Git's promisor fetch also needs writing `.git`.

## Verification commands and results

Run frontend commands from `web/` unless specified otherwise.

| Check | Result |
| --- | --- |
| `npm ci --offline --no-audit --no-fund --cache ../test/scratch/npm-cache` | Passed: clean installation of 101 packages from a prepopulated worker cache, using the committed lockfile. Cache is not delivered. |
| `npm run typecheck` | Passed, including production source and TypeScript validation scripts. |
| `npm run build` | Passed: Vite relative-base production export; two pinned ABI fingerprints match. One informational >500KB entry-chunk warning; total exported assets are approximately 588KB uncompressed. |
| `npm run test` | Passed: five tests covering decimal precision, uint128 bounds, slippage/minimum rounding, both directions' decoded swap/settlement payloads, timestamp-boundary search. |
| `npm run test:browser` | Passed: 21 checks in Chromium 140.0.7339.186 against the actual production bytes served at `/preview/`, with mock RPC and EIP-1193 wallet. Five simulated wallet transactions, zero real transactions. |
| `node scripts/check-export.mjs` | Passed: exact handoff identifiers and contract set, unchanged network/add-chain values, 10 assets and every file's SHA-256. ABI verification is part of the build and runtime loader. |
| `npm run check:live` | Passed: actual chain ID, code, hook manager, pinned-block views, complete donation history and read-only buy quote. See `frontend/live-chain.json`. |
| `PLAYWRIGHT_BROWSERS_PATH=./node_modules/.cache/playwright npx --no-install tsx tests/live-browser.ts` | Passed: unmocked browser reads through the supplied RPC, no console errors and all resources HTTP 200. See `frontend/live-browser.json`. |

The supplied MCP browser transport returned `Transport closed` on its initial navigation. A permitted local Playwright runner was used instead; each runner owns and closes its preview/browser in one bounded foreground command. No continuously running server is part of the deliverable.

The final export is static: no sourcemaps, remote fonts, external scripts, dependency archives, registry mirrors, node_modules, package caches or submodules are included. `web/.gitignore` is the only new ignore file and uses the assignment's explicit allowance. `python3 web/scripts/check-scope.py` (from the root) audits the path set and packs the complete candidate snapshot. See `frontend/submission.json` for the inventory/budget method and its history limitation.

## Interaction coverage

Machine-readable evidence is in `frontend/browser-results.json`. The production app was exercised for:

- Relative assets/config/ABIs at `/preview/`, and an exact 24-hour event window excluding a synthetic older event.
- 1440×1100 desktop, 800×1100 intermediate, 390×844 mobile and 320×900 reflow, with no page overflow.
- Automated WCAG A/AA checks, keyboard skip link, visible focused screenshots and a complete keyboard-only mobile buy flow.
- Browser-wallet connection; balance reads; native-input buy without token approval; decoded input/minimum/direction/value and simulation before signing.
- Quote expiry after 30 seconds; confirmation disappears until refreshed.
- Sell sequence with separate exact-amount token approval to Permit2, Permit2 permission for the configured router, and router execution.
- Invalid excess precision and insufficient balances; recoverable wallet-signing rejection; a reverting execute simulation preventing wallet submission.
- Account change during a delayed quote; no stale quote reappears after the account change.
- Wrong chain, 4902 failure, exact `wallet_addEthereumChain` payload and a second switch; missing wallet and rejected connection.
- Missing router code, uninitialized pool and disabled actions; zero current in-range liquidity alone still permits a valid quote.
- Empty history and zero denominator; failed log ranges suppress all partial 24-hour totals/estimates.
- Tampered launch ABI fails fingerprint verification and prevents app startup.
- No uncaught browser/console errors or failing static resource responses in the successful scenarios.

The browser suite uses synthetic data for determinism. Screenshots `desktop-1440.png`, `desktop-390.png`, `desktop-320.png`, `keyboard-focus.png` and `keyboard-confirm-mobile.png` are **fixture views**, not evidence of live balances/donations. `live-desktop.png` and `live-mobile.png` are actual unmocked Sepolia reads.

## Live chain observation

The reproducible recipe is `web/scripts/check-live.ts`; it derives all RPC destinations and addresses from the committed runtime manifest, uses exact `eth_chainId`, `eth_getCode`, `eth_getBlockByNumber`, `eth_call` and bounded `eth_getLogs` calls, and records its pinned ending block in the evidence.

At block **11791686** (timestamp **1790492292**), the RPC returned chain 11155111, nonempty code for both launch contracts and all configured Uniswap addresses, and the expected hook PoolManager. StateView returned tick 177284, sqrtPriceX96 `560227709747861399187319382274582`, LP fee 3000, protocol fee 0, and zero current in-range liquidity. Both lifetime counters and the full 24-hour hook event totals were zero. The scan covered deployment block 11791446 through 11791686; earlier blocks cannot have events from this deployment. No alternate or partial range was substituted.

A read-only buy quote for `100000000000` wei returned `4938201277706176013` RBTE base units and gas estimate 146361. This proves the public quoter responded at that state; it does **not** prove a funded wallet swap or receipt. A later unmocked browser read completed at block 11791716 and showed the actual zero donations and unavailable yield. These snapshots are dated evidence, not promises about future liquidity, prices or RPC availability.

## Better Interface review

The workflow and core principles of all six domains were read from the pinned guide before/following implementation. Supporting guidance for forms, focus, number formatting, motion, contrast and design documentation was applied to the actual controls. Final source-derived documentation is in `docs/DESIGN.md`.

| Domain | Coverage | Findings / limitations |
| --- | --- | --- |
| Accessibility | **Checked**: semantic headings/landmarks, names, labels, live error/status regions, pressed states, native disclosures, keyboard skip link/focus; axe-core reports zero violations and 30 passing rule groups. | Axe leaves `aria-prohibited-attr` and some contrast nodes for manual review. Source/readable controls and sampled rendered pairs were reviewed; no full screen-reader session, native zoom or physical-device test. Automated zero violations is not full accessibility compliance. |
| Layout | **Checked**: production screenshots at desktop/mobile, 800px intermediate and 320px reflow; controls and long content in normal flow. | Primary trade DOM order was aligned with mobile visual order. No RTL/localization requirement or variants; native 200% zoom was not performed. |
| Writing | **Checked**: verb-first actions, testnet context, public/connected/wrong-network states, minimum output, estimate caveats, recovery messages and empty-vs-failed history. | No claims of personal earnings or APY; no promise that the hook pays every swap. PoolSwapTest discrepancy documented rather than hidden in the product. |
| Typography | **Checked**: real screenshots, numeric stability, wrapping, hierarchy, minimum 16px slippage input and full address access. | Supporting labels increased from 10–11px to 12px. System fonts are intentional; other operating systems' fallback rasterization was not tested. |
| Colors | **Checked**: semantic palette, redundant status text, automated contrast and five actual rendered foreground/background measurements. | Measured ratios: 9.44, 5.57, 5.97, 5.19 and 12.30 to 1. Dark theme is **not applicable**. No claim that every disabled/focus/hover pair was exhaustively measured. |
| UI | **Checked**: default/selected/disabled/loading/empty/error/confirmed states, modest borders, native controls, responsive targets, one filled trade action. | No page-load animation. Only 120ms hover-color transition under no-motion-preference; reduced-motion browser setting tested. Animation-panel slow replay is **not applicable** to this static flow. |

## Findings, corrections and rechecks

| Severity / location | Evidence and impact | Correction / recheck |
| --- | --- | --- |
| Medium — `web/src/styles.css:85`, supporting label rules | Initial mobile/desktop screenshots showed 10–11px captions and control hints below the chosen readable scale. | Raised supporting text to 12px, increased mobile chart-selection targets to 44px. Rebuilt; four widths and axe passed. |
| Medium — `web/src/App.tsx:99`, `web/src/styles.css:79` | Initial mobile CSS placed the trade card before analytics while DOM focus order visited analytics first. | Moved trade markup before analytics, explicitly positioned the desktop columns and mobile rows. Rebuilt and checked resulting layouts and native focus path. |
| Low — `web/src/App.tsx:104` | Hiding the explainer's line break on mobile joined “design.Shared” in a rendered screenshot. | Kept a literal space before the break. Final 320px and 390px screenshots show separate words. |
| High during build — `web/package.json` | The initial wagmi/older-viem combination failed Rollup export resolution. | Pinned viem 2.56.9, removed unused connector package, retained wagmi core's injected connector. Clean offline install, typecheck, build and interaction tests pass. |

Additional correctness checks in `web/src/Swap.tsx:33` and `:64` invalidate stale quotes, tie asynchronous results to the current account/amount/direction/slippage, check current wallet identity immediately before signing, and require a successful receipt. `web/src/chain.ts:64` refuses partial event-window statistics and checks for reorganization. These were implemented and exercised, not independently audited.

Unperformed live behavior: funded approvals, funded swaps, real wallet extension signing UX, real receipt/replacement/reorg recovery, exhaustive public-RPC failover under outages, Safari/Firefox, screen-reader speech, native zoom, RTL/pseudo-localization and physical-device rendering. No signing was authorized for validation, so all transaction flows use mocks. The control plane's later publication checks do not substitute for these limits.
