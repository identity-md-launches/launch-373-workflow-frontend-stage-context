# Rebate frontend

One static React + TypeScript page for the deployed RBTE / native ETH Uniswap v4 pool on Sepolia. Vite emits `../dist/`; wagmi core manages the injected wallet and viem handles ABI encoding and RPC reads. There is no backend, WalletConnect project ID, private credential, or deployment command.

## Install, build and preview

From `web/`, using Node 22:

```sh
npm ci --cache ./node_modules/.cache/npm
npm run typecheck
npm run build
npm run preview
```

Open the local URL printed by Vite. `npm run build` runs TypeScript, builds with `base: './'`, then verifies pinned implementation ABIs and generates the deployment manifest **after** the export. The root repository must retain the deployed Git commit because the export script uses `git show <sourceCommit>:docs/abi/<Contract>.json`. No Foundry build or network is needed for the frontend build itself. Installation can use the network; with a populated external npm cache, `npm ci --offline --cache <cache-path>` works too. An offline clean install/build was exercised; no registry archive is shipped.

The committed `dist/` is the publishable artifact. Serve its files as-is from a static host or gateway subpath, with a trailing slash (or `/index.html`). Hash anchors are used for page sections; no server rewrites are necessary. Fonts and icons do not make third-party requests. The browser fetches only relative config/ABI/assets and configured public RPCs until the visitor follows an external link or connects a wallet.

## Configuration and binding

- `config/handoff.json`: preserved deployment handoff, including the deployed source commit and complete contract set.
- `config/network.json`: preserved network block and exact add-chain parameters.
- `config/protocol.mjs`: minimal Uniswap/Permit2 interfaces; no deployment addresses.
- `scripts/export.mjs`: reads compiler-exported ABI arrays **from the pinned Git commit**, verifies recursively key-sorted canonical-JSON Keccak-256 against both handoff hashes, copies their original bytes to `dist/abi/`, and emits the inventory.
- `dist/imd-deployment.json`: the **only runtime deployment configuration**. Its network object is unchanged; extensions contain the handoff pool/token metadata, deployment block, add-chain parameters and relative protocol interface paths. Its declared SHA-256 asset inventory covers every other exported file, including `index.html` and six ABI JSON files. It excludes itself.
- `src/config.ts`: loads that manifest and its ABI paths, checks the canonical ABI fingerprints again, and derives the public client and wallet chain from it. Addresses, chain IDs and public RPC URLs are never independently embedded in application logic.

The launch ABI fingerprints are:

| Contract | Canonical ABI Keccak-256, without `0x` |
| --- | --- |
| RBTE | `38880b8e56d42ce900f744a7908c7139632a49f1c3f33385c64ceaed29d37bee` |
| LPDonateHook | `950542000c0b9393ece805bb474b1ca49ca78700a171c35877420aa82e7c2893` |

Do not manually edit exported config, ABIs, or hashes. Update reviewed build inputs, build again, run `node scripts/check-export.mjs`, and commit source, lockfile and the whole final export together. Runtime fingerprint checks bind ABIs to the loaded manifest; they are not independent signature verification. The deployment handoff/control plane supplies the attestation trust anchor.

## Reads and analytics

`src/chain.ts` checks the RPC chain, nonempty code at the two launch contracts plus PoolManager, StateView, Quoter, Universal Router and Permit2, and the hook's immutable manager. A snapshot pins StateView `getSlot0` / `getLiquidity`, hook counters and token metadata to one block. Reads are public before connecting a wallet and refresh every 90 seconds, manually, and after a successful swap. Signing is disabled if verification fails or the snapshot is over two minutes old.

The pool key comes from the handoff: native ETH, deployed RBTE, fee 3000, spacing 60 and the deployed hook. The pool ID is Keccak-256 of the ABI-encoded tuple. The approximate RBTE-per-ETH price is `(sqrtPriceX96 / 2^96)^2 × 10^(ETH decimals − token decimals)`; token decimals are also read and checked on chain.

For donations, binary search finds the first block at or after `snapshot.timestamp - 86400`, bounded below by the hook's deployment block. Three workers scan inclusive ranges of at most 1,000 blocks with retries. Only the hook's `Donated` event and this pool ID are requested. Logs are deduplicated by transaction hash/log index, filtered by currency and actual block timestamp, and the ending block hash is rechecked for reorganization. Any failed range makes the entire 24-hour result unavailable; partial totals are never substituted. The window ends at the latest successfully read block, rather than silently assuming a blocks-per-day count. Empty history is a confirmed zero. Failed history is unknown.

The estimate is separately `human-unit donations / current raw in-range liquidity` for each currency. It is explicitly not APY or a position's historical earnings. A zero denominator displays unavailable. Donations benefit LPs in range at the **post-swap** tick, including same-block JIT liquidity. There are no LP deposit/withdrawal controls in this assignment.

## Wallet and trade flow

Supported connection: a browser-injected EIP-1193 wallet, including wallet browsers. No wallet means an actionable connection error. A wrong chain exposes “Switch to Sepolia”; error 4902/unknown chain triggers `wallet_addEthereumChain` with the exact handoff parameters and then switches again. The connected address, disconnect control, balances, explorer links, loading states, rejection errors and receipt status are visible.

1. Choose buy or sell, enter the exact input amount and slippage (0.01–5%, default 0.5%). Decimal precision and balances are validated without floating-point conversion of transaction amounts.
2. Preview through the configured Quoter's `quoteExactInputSingle` using `simulateContract`; never send a quote transaction. The output includes hook effects. A 30-second quote displays the exact minimum received and a five-minute swap deadline.
3. A buy sends native ETH without approval. A sell shows separate controls for exact-amount ERC-20 approval to the configured Permit2, then exact-amount Permit2 approval to the configured Universal Router for 30 minutes, then the sell. Existing sufficient permissions skip completed steps. Refresh the quote if an approval takes over 30 seconds.
4. Reverify deployment and balances, simulate the chosen approval/execute call, recheck the selected wallet account/network and current quote, then request wallet confirmation. Swap encoding is command `0x10`, actions `0x060c0f`, full pool key, direction flag, unsigned exact-input amount, on-chain minimum and empty hookData. `zeroForOne: true` means ETH to RBTE; the reverse means RBTE to ETH.
5. Show the submitted hash and wait for a successful receipt before calling it confirmed. Reverts and timeouts remain errors with the transaction link. No test signs or broadcasts a real transaction.

Hook lifecycle callbacks are PoolManager-only and are not offered as wallet actions. The hook has no admin, donation withdrawal, pause, upgrade or sweep. The frontend's primary user actions are buy, sell and the required approvals; it is not a generic ERC-20 transfer/allowance management app.

## Assignment conflicts, resolved within the write/configuration rules

The supplied network block lists Universal Router, Quoter and Permit2 but **does not list PoolSwapTest**. The assignment also says every swap/quote/approval must use that block's addresses and the block must remain unchanged. This implementation follows that supplied network constraint and uses Universal Router. It does **not** claim to satisfy the conflicting literal PoolSwapTest requirement; no alternate router was silently inserted. Reconciliation of that requirement belongs to the assignment owner. The configured Universal Router's live code was checked.

The path rule permits only `web/**`, `dist/**`, `docs/**` and `web/.gitignore`; it overrides the later root `DESIGN.md` request. The final design record is [docs/DESIGN.md](../docs/DESIGN.md). Root files, contracts, libraries, and Foundry configuration are unchanged.

## Reproduce validation

```sh
cd web
npm run typecheck
npm run test
PLAYWRIGHT_BROWSERS_PATH=./node_modules/.cache/playwright npx playwright install chromium
npm run build
npm run test:browser
node scripts/check-export.mjs
npm run check:live
PLAYWRIGHT_BROWSERS_PATH=./node_modules/.cache/playwright npx --no-install tsx tests/live-browser.ts
```

The browser scripts start and close their own bounded foreground preview at `/preview/`. Mocked wallet/RPC tests exercise fund-related interactions without broadcasting. The separate live script records unmocked public-RPC browser reads, resource responses and rendered contrast. Read-only chain checks use `curl` so the worker's proxy configuration is honored. `npm run dev` supports source work with hot reload; its middleware serves the same configuration and ABIs from the committed `dist/`, so build once after changing configuration. Use the production preview for acceptance checks.

Evidence and coverage: [frontend-validation.md](../docs/frontend-validation.md). Publication, IPFS CIDs, named sites and the network verifier are outside this worker's work; these checks make no claim of independent certification.
