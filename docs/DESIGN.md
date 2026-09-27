# Rebate: implemented web design

This file is under `docs/` because the worker's explicit write scope prohibits root `DESIGN.md`. It documents the final source in `web/src/`, not a proposal. The screenshots in `docs/frontend/` show the production export; `live-*` uses actual Sepolia reads, while `desktop-*` uses labelled test fixtures described in the validation record.

## Overview

Rebate is a one-page testnet pool interface for traders and liquidity providers. Its hierarchy is an editorial introduction, a pool identity/status row, a trade form and donation measurements, then an explanation and expandable deployment details. The visual language is warm off-white, deep green, serif display type and compact sans-serif controls. It uses flat, outlined surfaces and restrained spacing rather than shadows or moving decoration.

The circles in the desktop introduction explain the fixed 0.5% mechanism. They are CSS shapes, not a data visualization. The donation bars are actual hourly sums from the complete event window; they are accompanied by readable totals and an expandable numeric table. The fixed two-column overview is a page arrangement, not a requirement for future pages.

## Colors

Definitions are at `web/src/styles.css:1`. Components consume semantic tokens; primitives preserve a consistent hex palette. Only a light theme is implemented.

| Semantic token | Primitive / value | Role |
| --- | --- | --- |
| `--color-page`, `--color-input` | `--stone-100`, `#f5f4ee` | Page canvas and input groups |
| `--color-surface` | `--stone-50`, `#fcfcf9` | Panels and neutral buttons |
| `--color-text` | `--stone-900`, `#253129` | Primary text and headings |
| `--color-muted` | `--stone-600`, `#5c6459` | Supporting copy and captions |
| `--color-border` | `--stone-300`, `#d4d8cc` | Group boundaries and chart baseline |
| `--color-accent`, `--color-focus` | `--green-800`, `#2b4b37` | Primary action, links and focus outline |
| `--color-accent-hover` | `--green-900`, `#1e3929` | Primary action hover |
| `--color-on-accent` | `--stone-50`, `#fcfcf9` | Primary action label |
| `--color-tint` | `--green-100`, `#e8eee1` | Yield panel and hover surface |
| `--color-highlight` | `--green-300`, `#dce9b2` | Rebate symbol on dark green |
| `--color-error`, `--color-error-bg` | `#8f341f`, `#fff1e9` | Persistent recoverable errors |
| `--color-notice`, `--color-notice-bg` | `#725313`, `#fcf4da` | Wrong-network/expired-quote notices |

Measured live-browser foreground/background pairs: primary label 9.44:1, hero supporting copy 5.57:1, surface caption 5.97:1, tinted caption 5.19:1, amount input 12.30:1. These are the sampled opaque rendered pairs in `frontend/live-browser.json`, not a claim about all possible states or disability accommodations. Status always includes text, not only a colored dot.

## Typography

- Body and controls: `'Trebuchet MS', Arial, sans-serif`, weight 400 or 700, default 16px / 1.5. The worker browser uses the available system fallback; no font files or font-host requests are required.
- Display: `Georgia, 'Times New Roman', serif`, regular and italic. H1 is `clamp(2.8rem, 5.5vw, 4.5rem)` / 1.06, with `-.045em` tracking. It changes to 52px at the intermediate stacked layout and `clamp(42px, 10.5vw, 54px)` on small screens.
- Card H2: 18px / 1.25 (17px on small screens), weight 700. The explainer heading uses 32px / 1.15 serif, reduced to 30px when stacked. H3 is 15px bold.
- Supporting captions and small controls: 12–14px, with `.small` at `.8125rem` / 1.6. The final typography review raised 10–11px supporting labels to 12px.
- Primary metrics: responsive 1.8–2.35rem, line-height 1.35; hourly totals are 24px and mobile lifetime values 30px. Numbers use `font-variant-numeric: tabular-nums`.
- Amount input: 32px desktop, 28px mobile. Slippage input stays at 16px. Addresses use the platform monospace stack and wrap rather than clip. Headings use balanced wrapping; explanatory paragraphs are limited to roughly 38–70 characters by their role.

## Layout

`.wrap` is a maximum 1184px, initially the viewport minus 80px. Spacing uses 4/8/12/16/20/24/28px for controls/groups, with 40–66px for page sections. `.pool-grid` has a 1.5:1 split and 24px gap. The source/keyboard order puts the primary trade flow before analytics; desktop places it in the right column, and mobile presents it first.

Breakpoints in `web/src/styles.css:190`:

- At 1000px: 24px page margins, compact navigation, a narrower grid, and wrapped price details.
- At 760px: one column, trade first, analytics next; explainer and footer stack. The explanatory display heading keeps a space when its line break disappears.
- At 520px: 16px page margins, 20px panel padding, wrapped header/network controls, hidden decorative mechanism, wrapping pool status, and 44px chart-currency buttons. Contract address rows stack.

Actual export checked at 1440×1100, 800×1100, 390×844 and 320×900: no horizontal page overflow. Long hashes wrap inside expandable details. The transaction table may scroll locally. These viewport checks are not native 200% zoom, a physical phone test, or proof of every possible locale.

## Elevation & depth

No box shadows, overlays or fixed transaction bars. Panels have a one-pixel structural border. Page, panel and input tones create shallow grouping. The small swap-direction arrow uses a local `z-index: 1`; the focused skip link uses `z-index: 5`. The trade action remains in normal document flow and is never obscured by sticky chrome.

## Shapes

`--radius-panel: 20px`, `--radius-control: 10px`. Input groups and segmented-control containers use 12px, the compact slippage box 7px, status tags 5px and chart bar tops 3px. Currency marks and the mechanism use circles. The `r` mark and ETH character are text/CSS, with no downloaded imagery.

## Components

| Source/pattern | Purpose and behavior |
| --- | --- |
| `App`, `web/src/App.tsx` | Header, status, snapshot orchestration, explainer and contract disclosure. Refresh is manual and every 90 seconds. Errors remain visible and provide retry guidance. |
| `Amount`, `web/src/App.tsx:9` | Currency-labelled tabular numbers; missing values use a dash rather than a false zero. Tiny values use scientific notation. |
| `Activity`, `web/src/App.tsx:12` | ETH/RBTE chart selection, complete-window totals, native `<details>` for transactions/hourly values and ten-row pagination. Selection uses `aria-pressed`. Empty and failed history are distinct. |
| `Swap`, `web/src/Swap.tsx` | Native form labels, direction buttons, amount and slippage inputs, exact minimum, expiring quote and explicit approval/permission/confirmation steps. Busy/unverified/wrong-chain states gate transactions. Errors use `role="alert"`; progress uses a stable status region. |
| `.primary`, `.secondary`, `.wallet-button` | A single filled primary action in the trade flow; neutral refresh/connect/secondary controls. 44px base target height; visible hover, pressed, disabled and keyboard focus states. |
| `.yield-panel`, `.measurement` | Separate estimate label, formula, units, current-liquidity caveat and expanded raw measurements. Zero liquidity displays unavailable. |
| `.deployment`, `.contract-list` | Native disclosure for full contract addresses, source/attestation hashes and manifest link; address links remain selectable and wrap. |

Native buttons, links, inputs and disclosure controls provide keyboard behavior. Focus uses a 3px green outline with 4px offset; forced colors uses `Highlight`. A first-focus skip link reaches `<main>`. There are no modal focus traps. The only transition is a 120ms background-color change, enabled only when reduced motion is not requested.

## Do's and don'ts

- Reuse semantic colors, `.wrap`, `.panel`, `.section-heading`, `.small` and native elements. Preserve the one filled trade action and visible disabled-state explanation.
- Preserve actual currency units, transaction minimums, clock expiry and unavailable/zero distinctions. Never replace missing RPC data with illustrative numbers.
- Keep transaction amounts as bigint. Format visual ratios separately and label approximations.
- For another section, place a semantic heading in `.wrap`, reuse a panel or spaced content group, add one primary action only if the section has a separate task, and test its smallest layout and keyboard order. Do not add a new typography family or color role solely for decoration.
- Retain system fonts and small static assets unless a new requirement justifies the bytes. Regenerate the deployment asset inventory after every export change.

Design guidance attribution and verification limitations are in `frontend/ATTRIBUTION.md` and `frontend-validation.md`.
