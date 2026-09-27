# Design and protocol references

Design review applies the pinned Better Interface guide supplied with this assignment, adapted from Jakub Krehel's **Better Interface**, MIT, commit `267330e1adfc66a718fb65fa6918c1f06d0a689e`: https://github.com/jakubkrehel/skills/tree/267330e1adfc66a718fb65fa6918c1f06d0a689e/skills/better-interface.

The design documentation method is adapted from Paul Bakaus's **Impeccable**, Apache-2.0, commit `9d715cc4f5564a990ca8345abfdd5df6dc9b41c8`: https://github.com/pbakaus/impeccable/blob/9d715cc4f5564a990ca8345abfdd5df6dc9b41c8/skill/reference/document.md. These remain distinct works under their respective licenses. The delivered implementation and documentation were written for this assignment; the long upstream guides are not redistributed here.

Protocol interfaces and integration were cross-checked against primary sources:

- [Uniswap v4 Universal Router swap guide](https://developers.uniswap.org/docs/protocols/v4/guides/swapping/swapping): command/action encoding and explicit Permit2 approvals.
- [IV4Quoter](https://github.com/Uniswap/v4-periphery/blob/main/src/interfaces/IV4Quoter.sol): `quoteExactInputSingle` tuple and return values.
- [IStateView](https://github.com/Uniswap/v4-periphery/blob/main/src/interfaces/IStateView.sol): slot0 and in-range liquidity views.
- The repository's **pinned deployed source** and compiler ABI arrays: `b840e7719a68c0aa463e798934a4ff6f8f8f92ba`. No address from a web reference overrides the supplied network table.

ABI subsets used for the Uniswap protocol are committed as actual JSON in the static export. The two launch ABIs are copied verbatim from the pinned compiler exports and verified against their handoff fingerprints on every build.
