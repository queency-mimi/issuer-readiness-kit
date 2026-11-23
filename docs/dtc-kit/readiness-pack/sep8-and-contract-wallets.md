# SEP-8 approval servers and contract-address wallets

Two open design questions, written down so nobody has to rediscover them. Status: inferred / unknown. DTC-shaped, not DTC-certified.

## 1. How an issuer's SEP-8 approval server fits (poor fit)

**What SEP-8 is** (background knowledge of the SEP, not re-read in full today [I]). A regulated asset on classic Stellar is flagged `AUTH_REQUIRED` + `AUTH_REVOCABLE`; each payment is first sent to an issuer-run approval server, which approves, revises, rejects or defers it, and the client then submits the approved transaction. SEP-8 is Active, v1.7.4, last updated 2022-02-21 [P: stellar-protocol sep-0008.md, read 2026-10-31].

**Where it could sit in the DTC model.** It would be a per-payment gate enforcing "destination must be a Registered Wallet" and "source not chilled", evaluated at the issuer (DTC's tokenization engine or its delegate) instead of through authorised trustlines.

**Why the fit is poor [I, confidence low]:**
1. DTC mints, burns and configures its own tokens (row `authorities.dtc-initiated-mint-burn`); participants do not deploy contracts or run issuer infrastructure. A participant-run approval server has no authority; the only natural operator is DTC.
2. Per-trustline authorisation (`AUTH_REQUIRED`) already gives the "only Registered Wallets can hold" property with no server in the payment path.
3. SEP-8 puts the issuer in the signing path of every participant payment: 24/7 same-network transfers (row `operations.transfer-and-processing-hours`) then depend on the issuer's server uptime.
4. Client support is thin: in the SDF repositories checked in discovery only `stellar-demo-wallet` has SEP-8 client code (a git-tree file-path check, weak [S]); SDF's own reference approval server was test-only and the `stellar/regulated-assets-approval-server` repo returned 404 [P, discovery]; no custody vendor with a raw-XDR signing path is evidenced to support the flow [U].
5. WisdomTree runs a SEP-8 server in-house for its classic assets [S], so the pattern exists, but for an issuer that is its own transfer agent.

**When it would matter.** Only if DTCC chose a classic SEP-8 regulated asset form. Then custody stacks must carry the approval round trip, the kit needs an approval-server mock in the sandbox, and a new capability row (`distribution_control.mechanism = sep-8`) becomes testable. Spike DTC-038 decides whether to model it; the sandbox does not model it today.

**Compliance exposure.** The approval server is the compliance control. Hosting one for others is a G-LEGAL matter; the kit would offer only a conformance test client, not a hosted service.

## 2. Can a contract (C...) address be a registered wallet? (open)

**Why it matters.** It decides whether a DvP escrow, a smart account (passkey, OZ accounts package), a repo or collateral contract can ever hold DTC tokens. The DTCC FAQ says DvP happens away from and without DTC involvement and participants choose the cash solution [P], so a DvP leg between participants may need a contract that holds DTC tokens; that contract would itself have to be a Registered Wallet. This is the question that gates a registered-wallet-aware DvP standard, and why no such standard is in this scaffold.

**What is known.**
- DTCC does not validate wallet addresses; Wallet Address is free text plus a ledger choice [P: `wallet.address-not-validated-by-dtc`]. So a C-address can be typed in. Whether DTC's engine can mint to it, or its registry accepts it, is unknown [`wallet.contract-address-registrable`, unknown].
- Classic payment operations cannot have a contract address as source or destination; only SAC contract calls can [S: SDF docs read in discovery].
- Under `AUTH_REQUIRED`, a contract holding a SAC balance must be authorised via the SAC's `set_authorized` before it can receive [S].
- SEP-57: `Address` covers contracts, but whether the identity registry and compliance modules accept one is not stated [U].
- Protocol 30 adds muxed contract (W...) addresses (CAP-84; testnet vote 2026-11-03, mainnet vote 2026-11-23) [S]. Whether DTC would register one is a further unknown.
- A SAC transfer has no memo (CAP-61 rejected) [S], so a contract wallet cannot carry an exchange-style memo.

**What the kit does about it.**
- Keeps the row `unknown`; no scenario assumes either answer.
- SC-030 (DTC-028) records what each adapter does when a C-address is authorised and sent tokens. That bounds the token side. It is not evidence about DTCC.
- Drafts the question for DTCC/SDF (`drafts/dtcc-questions.md`, DTC-028); the user sends it (G-OUTREACH).

**Decision rule.** If DTCC says no: DvP between participants must use a G-account holding wallet or settle via DTC conversions; the escrow idea reduces to a non-DTC-token escrow. If yes: the registered-wallet-aware DvP brief opens, and the adapters need `contract-address-holder` to move from `partial`/`unknown` to supported.
