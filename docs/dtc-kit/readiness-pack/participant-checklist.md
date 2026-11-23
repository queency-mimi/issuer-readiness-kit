# Participant checklist

For a DTC participant preparing for tokenized securities on Stellar. Tags show how firm each item is. `[published]` comes from a DTCC or SEC document read in discovery; `[inferred]` is our reading; `[unknown]` is waiting on DTCC. Not legal advice. DTC-shaped, not DTC-certified.

## A. Do now (chain-independent, all `[published]` unless noted)

- [ ] Confirm you are a DTC Participant; only participants register wallets and you are responsible for activity in every Registered Wallet, even client-held keys (`wallet.only-participants-register`).
- [ ] Decide internal versus client wallets and set up a client identifier scheme that matches DTC's Account/Client Identifier (`wallet.account-model`).
- [ ] Own your KYC/AML on client wallets; DTC runs OFAC screening and may add checks (`wallet.participant-kyc-aml-duty`, `wallet.registration-ofac-screening`).
- [ ] Build handling for wallet statuses: Processing, Completed, Failed Compliance, Failed, Delivery Order Chill, Global Lock, Compliance Lock (`wallet.registration-status-taxonomy`). `[inferred]` what each does on-chain (`wallet.control-state-semantics`).
- [ ] Handle Forced Reconversion, claw-back and force-transfer events from DTC, including lost/stolen/erroneous (`wallet.forced-reconversion`, `authorities.force-transfer-reasons`).
- [ ] Use whole tokens only in your systems; reject fractional quantities before they reach an order (`token.whole-tokens-only` is `[inferred]`).
- [ ] Plan the cash leg off-DTC: DTC movements are free-of-value, you choose the on-chain cash solution (`operations.free-of-value`).
- [ ] Set up service accounts with rotation overlap and maker/checker approvals for conversion orders (`access.service-accounts-and-environments`).
- [ ] Be able to ingest DTC's CSV exports (wallets, balances, activity, orders) (`wallet.csv-exports`; column layouts unrecorded).

## B. Books and corporate actions

- [ ] For events DTC does not support on tokens, convert to book entry before the record date; there is no automatic re-tokenisation (`corporate_actions.unsupported-event-convert-before-record-date`).
- [ ] Expect ONE consolidated cash credit per event to your classic account; build the allocation to client sub-ledgers (`corporate_actions.cash-credit-consolidated-classic`, packages/reconciliation).
- [ ] Capture record-date holders per wallet at 20:00 ET `[inferred]` (`corporate_actions.position-capture-8pm-et`); keep your own balance history because node event retention is short (about 7 days on Soroban RPC `[S]`).
- [ ] Reconcile daily: on-chain balances by wallet against DTC's Balance export; flag, never auto-fix.
- [ ] Phase 1 covers record-date cash distributions and maturities on Treasuries; later events are 2027+ (`corporate_actions.phase1-scope`).

## C. Stellar-specific (all `[inferred]` or `[unknown]`)

- [ ] `[unknown]` Which token form: classic + SAC, SEP-57, or a DTC-built SEP-41 contract (`token.form`). Do not build for one only; test both adapters.
- [ ] `[inferred]` If classic: you will need XLM for the base reserve and 0.5 XLM per trustline, and registration is two steps (you open the trustline, DTC authorises it) (`distribution_control.registration-two-step`).
- [ ] `[unknown]` Which address kinds you may register: G, C, M, smart account (`wallet.stellar-address-binding`, `wallet.contract-address-registrable`). Until answered, register only ordinary G-accounts in rehearsals.
- [ ] `[unknown]` Who pays fees and reserves (`network.fee-payer`).
- [ ] `[unknown]` When a conversion order is "Completed" in terms of Stellar finality (`network.finality-threshold`).
- [ ] `[inferred]` Be able to decode SEP-41 / CAP-67 events and, if a SEP-57 token, its control events (`events.stellar-event-layout`).

## D. Vendor and wallet

- [ ] Ask your custody vendor the five questions in [wallet-vendor-matrix.md](wallet-vendor-matrix.md). Fireblocks documents classic Stellar assets only (June 2026 article); a contract token may not be custodied there `[V]`.
- [ ] `[unknown]` Ask whether DTCC certifies wallet providers on Stellar and whether your vendor is on the list (`access.wallet-provider-certification`).
- [ ] Run SC-033/SC-034 (wallet-vendor scenarios) against your vendor's test environment when DTC-037 lands.

## E. Practise with the sandbox (no real money, no DTCC)

- [ ] Start `pnpm sandbox` and run the five scenarios (register wallet, OFAC fail, convert, chill, force-transfer) once DTC-014 lands.
- [ ] Run `pnpm conformance run` and keep the report; every line is labelled published/inferred/unknown.

## F. Questions to put to DTCC or SDF (the user sends; drafts in `drafts/`)

1. Which token form and compliance mechanism will DTC use on Stellar?
2. Can a contract (C...) address be a Registered Wallet?
3. Which party holds the root/override key and is clawback plus issuer payment accepted as reversibility?
4. What confirmation threshold marks a conversion Completed?
5. Who pays fees, and is wallet-provider certification required?
