# Wallet and custody vendor matrix (Stellar)

As of the discovery note dated 2026-10-29, re-checked only where stated. **No vendor was contacted** (G-OUTREACH). Trust tags: [P] vendor's own technical documentation read, [V] vendor marketing/FAQ, [S] secondary, [U] not established. A claim stays [V] until a technical document names the operation. Refresh: ticket DTC-029.

The kit tests what a vendor stack can do; it does not rank vendors or say who is "DTC-ready".

| Vendor | Classic Stellar assets, trustlines | Issuer-side clawback / SetTrustLineFlags | Soroban contract tokens and auth-entry signing | SEP-57 control functions | Named by DTCC | Evidence and caveats |
|---|---|---|---|---|---|---|
| Fireblocks | Yes. Tokenization on Stellar is a premium add-on; clawback must be enabled before trustlines; wallet needs 1 XLM + 0.5 XLM per trustline [V help article] | Described in the article for the issuing flow; operation-level support not read [U] | **No**: "Soroban tokens are not currently supported on Fireblocks" [V help article, metadata updated 2026-06-23] | Not supported (follows from the previous column) [I] | DTCC Canton onboarding case (Citadel) [S]; not shown for Stellar | The article page returned 403 to curl and WebFetch; the discovery agent read the same text through the public Help Center JSON endpoint and flagged that as a possible workaround of a block. Re-read before relying on it. Developer docs `/docs/stellar` returned 404 |
| BitGo | Yes: XLM since 2017; developer docs list classic Stellar tokens (USDC, USDM1, AQUA, ...); a token send is two transfers (token + XLM fee) [P docs] | Not documented [U] | No Soroban or contract-token mention found [U]; absence is not proof | Not documented [U] | Listed on DTCC's product page as a wallet provider (logo asset) [P] for the live networks; BitGo has a Canton guide [P] | Docs list tokens, not a capability statement |
| Taurus | Custody of Stellar tokenised assets via Taurus-PROTECT and issuance via Taurus-CAPITAL since 2024-06-24 [S: press] | Not stated [U] | Taurus-CAPITAL FAQ lists token standards "Stellar SAC, SEP-41 and SEP-57" [V own site, marketing page]. PROTECT signing of Soroban auth entries not stated [U] | Issuance-side claim only [V] | In DTCC's collaborator list, not on the initial wallet-provider logo row [P] | Marketing, not technical docs |
| Blockdaemon | Stellar nodes (Horizon full history/watcher, core); Builder Vault MPC key management pitched for wallet-as-a-service [P docs.blockdaemon.com, updated 2026-05-13; V for Builder Vault] | Not documented [U] | Soroban RPC node with 7 days retention [P]; Soroban transaction signing in its wallet product not documented [U] | Not documented [U] | Delivered DTCC Canton wallet infrastructure; "network-agnostic by design", Stellar named as a future example [V blog] | No Stellar-specific custody doc found |
| Dfns, Cobo, MPCVault, Balance, Turnkey | Listed among Stellar custody/signing vendors in discovery (SCF awards, partner pages) [S] | [U] | [U] | [U] | Dfns named as a DTCC collaborator [S] | Not assessed in depth |
| Fystack (competitor blog, 2026-10-01) | States Fireblocks, BitGo, Taurus, Dfns and Fystack "all support Stellar, but they are different kinds of products" [S, competitor marketing] | | | | | Do not rely on it |

## What this means for the token-form choice

A Soroban contract token (SEP-57 or bespoke) cannot be custodied at Fireblocks today on the evidence above, while a classic asset fronted by a SAC can. So the token form DTCC picks (`token.form`, unknown) is the hinge for vendor readiness [I]. Also: SDF's own docs say transfers and control functions of SEP-57 tokens are not yet supported in wallets, and indexer support must be self-implemented [P: SDF docs mirror read in discovery, not re-read].

## Questions to put to a vendor (drafts only; the user sends)

1. Can your stack sign a Soroban authorization entry for a SEP-41 `transfer`, and can an approver see which function and amounts they are signing (clear signing)?
2. Can an issuer vault submit `SetTrustLineFlags`, `Clawback`, and a multi-operation transaction containing a clawback and a payment?
3. Do you attribute inbound payments to muxed (M...) IDs for sub-ledger accounting? Plan for muxed contract addresses (CAP-84, Protocol 30)?
4. Is there a documented path for a SEP-8 approval flow in your signing stack?
5. What would you need from DTCC to be listed as a Stellar wallet provider?

The wallet-vendor scenarios SC-033 and SC-034 (DTC-037) turn questions 1-3 into a runnable pack the vendor can use in its own environment.
