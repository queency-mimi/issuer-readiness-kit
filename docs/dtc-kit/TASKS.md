# TASKS

Prefix `DTC-NNN`. Pick the lowest-numbered `TODO` whose dependencies are `DONE` (docs/AGENT_GUIDE.md). Estimates are `[E]` (half a day to two days of one agent session unless stated); none was measured. Every command is run from the repo root (`projects/dtc-kit`) after `pnpm install`.

Gate reminders: **G-DTCC** (rows `inferred`/`unknown` are labelled in every output), **G-OUTREACH** (agents draft, the user sends), **G-SECRETS** (testnet throwaway keys only, generated at runtime), **G-VALUE** (no mainnet writes), **G-LEGAL** (no hosted sanctions screening; the sandbox OFAC list is fictional).

## Index

| ID | Title | Deps | Status |
|---|---|---|---|
| DTC-000 | Scaffold (this repo state) | | DONE 2026-10-31 |
| DTC-001 | Profile CLI: validate, status counts, trust table | | DONE 2026-11-08 |
| DTC-002 | `trustLabel()` builder and labelled-output helper in core | | DONE 2026-11-08 |
| DTC-003 | Control-state restrictions read from the profile | 002 | DONE 2026-11-08 |
| DTC-004 | Wallet registration reducer and request validation | 002, 003 | DONE 2026-11-08 |
| DTC-005 | Transfer pre-check | 002, 003, 004 | DONE 2026-11-08 |
| DTC-006 | Re-verify every `published` generic row against its primary source | | TODO |
| DTC-007 | Conversion order reducer | 002, 004 | DONE 2026-11-08 |
| DTC-008 | Force-transfer reducer and root-wallet-use summary | 002, 004, 005 | DONE 2026-11-08 |
| DTC-009 | Record-date capture instant (DST-safe) and capture function | 002 | DONE 2026-11-08 |
| DTC-010 | Cash-allocation lifecycle reducer | 002 | DONE 2026-11-08 |
| DTC-011 | Sandbox registry: wallets, fake OAuth, profile route, sim hooks | 004, 005 | DONE 2026-11-08 |
| DTC-012 | Sandbox: conversion orders, transfers, precheck endpoints | 007, 011 | DONE 2026-11-08 |
| DTC-013 | Sandbox: control hooks, force transfer, root-wallet uses | 008, 011 | DONE 2026-11-08 |
| DTC-014 | Scripted scenario runner and the five scenarios in CI | 011, 012, 013 | DONE 2026-11-08 |
| DTC-015 | Sandbox: corporate actions (create, capture, pay) | 009, 010, 011 | DONE 2026-11-08 |
| DTC-016 | Sandbox: CSV exports | 011, 012 | DONE 2026-11-08 |
| DTC-017 | docker-compose verified and five scenarios via compose | 014 | BLOCKED(no docker on the build machine) |
| DTC-018 | Conformance runner and report (JSON, JUnit) | 001, 002 | DONE 2026-11-08 |
| DTC-019 | Implement sandbox scenarios SC-001..SC-008, SC-010, SC-011 | 014, 018 | DONE 2026-11-08 |
| DTC-020 | Spike: atomic clawback plus issuer payment on testnet | | DONE 2026-11-08 |
| DTC-021 | SAC adapter: offline action plans | 002, 020 | DONE 2026-11-08 |
| DTC-022 | Spike: whole-token enforcement (SAC 7 decimals, SEP-57 decimals 0) | | PARTIAL 2026-11-08 (SAC half done; SEP-57 decimals-0 half TODO) |
| DTC-023 | SAC adapter on testnet end to end | 021 | PARTIAL 2026-11-08 (plans submitted on testnet by the spike; live runner target TODO) |
| DTC-024 | Spike: SEP-57 semantics (forced_transfer vs frozen/paused, deny path) | | TODO |
| DTC-025 | SEP-57 adapter: offline action plans | 002, 024 | DONE 2026-11-08 |
| DTC-026 | SEP-57 adapter on testnet end to end | 025 | TODO |
| DTC-027 | Event decoders for SEP-41/CAP-67, SAC admin ops and SEP-57 | 021, 025 | TODO |
| DTC-028 | Spike: contract (C) address as a registered wallet, token side | 023, 026 | TODO |
| DTC-029 | Spike: wallet-vendor capability refresh and outreach drafts | | TODO |
| DTC-030 | Implement remaining sandbox-level scenarios | 015, 019, 023, 026 | PARTIAL 2026-11-08 (12 of 13 done; SC-013 and the SEP-57 testnet run of SC-018 TODO) |
| DTC-031 | Profile diff and the DTCC-publication watcher | 001 | PARTIAL 2026-11-08 (diffProfiles done; watcher script TODO) |
| DTC-032 | Reconciliation: HoldersSnapshot mapping | holders-at-ledger SPEC (written) | DONE 2026-11-08 |
| DTC-033 | Reconciliation: allocation algorithm and property tests | 010 | DONE 2026-11-08 |
| DTC-034 | Reconciliation: break detection and report | 033, 016 | DONE 2026-11-08 |
| DTC-035 | Reconciliation: CLI, end to end with the sandbox, performance spike | 015, 032, 034 | PARTIAL 2026-11-08 (budget measured, e2e in demo:data; CLI TODO) |
| DTC-036 | Readiness-pack generator (matrices from data) | 001, 021, 025 | TODO |
| DTC-037 | Wallet-vendor scenario pack (@testnet) | 018, 023, 026 | TODO |
| DTC-038 | Spike: SEP-8 approval-server fit | | TODO |
| DTC-039 | ScenarioPack contract handover and ADR | 018 | TODO |
| DTC-040 | "DTCC published" runbook and rehearsal | 031 | TODO |
| DTC-041 | Build packages to JS + d.ts for npm publication (DEPLOY.md section 3) | | TODO |
| DTC-042 | Host the console and add the CI workflow (DEPLOY.md sections 2 and 5) | | TODO |

First five that can start immediately and prove the architecture end to end with thin real code: DTC-001, DTC-002, DTC-003, DTC-004, DTC-005 (profile CLI, trust labels, control semantics, wallet machine, transfer pre-check, all driven by the two profile files). DTC-006, DTC-020, DTC-022, DTC-024, DTC-029, DTC-038 are spikes or verifications that need no other ticket.

## Cross-project requests

- `holders-at-ledger`: resolved 2026-11-08. Its SPEC and `schemas/holders-snapshot.schema.json` now exist; dtc-kit reads the schema from the sibling checkout (or `DTC_HAL_SCHEMA`) and does not copy it.
- Programme docs: see "Requests for the programme docs" in the scaffold report (ADR for the ScenarioPack contract, DTC-039).

---

## Tickets

### DTC-000 Scaffold
Status: DONE 2026-10-31. Packages compile, 25 tests pass, five scenarios exist as data, 36 scenarios catalogued, two profile files validate. Test: `pnpm check`.

### DTC-001 Profile CLI
Status: DONE 2026-11-08. `pnpm profiles check|table`; counts 28 = 25 + 3 and 18 = 6 + 12; broken copy exits 1 naming `/rows/0`. Tests: `packages/profile-spec/test/cli.test.ts`.
- Deps: none. Files: `packages/profile-spec/src/cli.ts` (new), `package.json` script `profiles`.
- Do: `pnpm profiles check` validates every file in `profiles/`; `pnpm profiles table <profileId>` prints rows with status, confidence, source count; `--json`. Exit 1 on any schema problem.
- Accept: `pnpm profiles check` exits 0 and prints counts that match the files (at scaffold: dtc-generic 28 rows = 25 published + 3 inferred; dtc-stellar 18 rows = 6 inferred + 12 unknown); a broken copy of a profile exits 1 with the violated rule named. Test: `pnpm test` plus `pnpm profiles check`.

### DTC-002 trustLabel
Status: DONE 2026-11-08. `trustLabel`, `label`, `rowValue` in `packages/core/src/trust.ts`; disclaimers deduplicated and joined.
- Deps: none. Files: `packages/core/src/trust.ts` (new), `types.ts`.
- Do: `trustLabel(profile: ResolvedProfile, rows: string[]): TrustLabel` using `weakestStatus`, profile id/version, joined disclaimers. `label(text, trust)` renders `[inferred] text (rows: ...)`.
- Accept: unit tests: unknown row id yields `unknown`; mix of published and inferred yields `inferred`; disclaimer text contains "not DTC-certified". Test: `node --test packages/core/test/trust.test.ts`.

### DTC-003 Control-state restrictions
Status: DONE 2026-11-08. Effects read from the row; a missing control state blocks both ways, labelled unknown.
- Deps: 002. Files: `packages/core/src/control-state.ts`.
- Do: implement `restrictionFor` reading row `wallet.control-state-semantics`; Failed Compliance blocks inbound (row `token.transfer-only-to-registered-wallets`); Completed blocks nothing. `isChilled` over windows.
- Accept: table-driven test over all seven `WALLET_STATUSES`; every result carries a `TrustLabel` whose status is `inferred` for chill/lock states and `published` for Completed/Failed Compliance. Test: `node --test packages/core/test/control-state.test.ts`.

### DTC-004 Wallet registration reducer
Status: DONE 2026-11-08. Every (status, event) pair tested; `validateRegistration` takes a `RegistrationDirectory` (SPEC 2.1 updated).
- Deps: 002, 003. Files: `packages/core/src/wallet-registration.ts`.
- Do: implement `reduceWallet` and `validateRegistration` per the comment: Completed needs `ofacCleared && onChainAllowlisted`; `ofac-failed` -> Failed Compliance with `allowlist-remove`; controls remember `statusBeforeControl`; invalid events throw `InvalidTransition`.
- Accept: tests for every event from every status (illegal ones throw), a property test that `release-control` after any control returns the prior status, client wallet without `clientId` rejected. Test: `node --test packages/core/test/wallet-registration.test.ts`.

### DTC-005 Transfer pre-check
Status: DONE 2026-11-08. All eight reasons in SPEC order; processing window via Intl; `opts.dtcLedgers` for the bridge rule.
- Deps: 002, 003, 004. Files: `packages/core/src/transfer-precheck.ts`.
- Do: implement `precheckTransfer` producing every applicable reason (not just the first), `rawQuantity` fractional detection, cross-network hours via the processing-window row (use `Intl.DateTimeFormat` with `America/New_York`).
- Accept: tests for all eight reasons in `PRECHECK_REASONS`; result `trust` is the weakest of the rows of the reasons that fired, or of the rows consulted when allowed. Test: `node --test packages/core/test/transfer-precheck.test.ts`.

### DTC-006 Re-verify the published generic rows
Status: TODO. Audit 2026-11-08 flagged this as the main honesty gap: the Overview tile, README and PITCH.md now say the 25 rows were read 2026-10-29 via discovery notes and are not re-verified. Do this before showing the rows to DTCC or an institution.
- Deps: none. Files: `packages/profile-spec/profiles/dtc-generic.json`, `SOURCES.md`, new `fixtures/dtcc-pages/*` with provenance.
- Question: does each `published` row's statement match the primary source text today? Rows were copied from discovery notes dated 2026-10-29; only five were re-read at scaffold time (2026-10-31: product page SEP-41 tile, corp_actions_workflow Position Capture, conversion_orders fractional note, forced-reconversion note, reversion note).
- Method: public pages only via `curl` with a browser UA (no login, no WAF bypass). The SEC PDF returned 403 to curl in discovery and must not be worked around: use the copy the user saved or ask the user. Save page text with provenance through `scripts/capture-fixture.ts` (needs the web-page branch of DTC-020's script, or hand-run curl and record provenance by script).
- Decision rule: a row stays `published` only if a quoted sentence in the source supports every clause of `statement`. Otherwise narrow the statement or downgrade to `inferred` and add `basis`. Bump `version` and `retrievedAt`, set `via: "reread:<date>"`.
- Accept: `pnpm profiles check` passes; a table in `SOURCES.md` lists each row id with the quote and date; the `SEC NAL` rows are marked "not re-read" if the PDF was not obtainable. Test: `pnpm check`.

### DTC-007 Conversion order reducer
Status: DONE 2026-11-08. Submit is `submitConversionOrder`; new effect `classic-position`; revert replay test nets to zero; out-of-hours hold labelled unknown (SPEC 2.3 updated).
- Deps: 002, 004. Files: `packages/core/src/conversion.ts`.
- Do: implement `reduceConversion` per comment (Pending Approval only with maker/checker; Declined for Failed Compliance wallet or fractional quantity; on-chain revert -> Failed with an effect list that reverses the classic movement; outside processing hours -> held).
- Accept: table tests for each (status, event); effects for a successful to-token are exactly one `mint` then one `audit`; revert yields no net supply change when effects are replayed against an in-memory ledger. Test: `node --test packages/core/test/conversion.test.ts`.

### DTC-008 Force-transfer reducer
Status: DONE 2026-11-08. `requestForceTransfer` + reducer; new effect `root-wallet-use`; quarter summary on the ET calendar.
- Deps: 002, 004, 005. Files: `packages/core/src/force-transfer.ts`.
- Do: implement states Requested -> Planned -> Submitted -> Confirmed|Failed; refuse unregistered destination (reuse the pre-check); call `adapter.planForceTransfer` on `plan`; `summariseRootWalletUses` by quarter and reason.
- Accept: tests including "destination in Failed Compliance is refused" and "three uses over two quarters summarise correctly". Test: `node --test packages/core/test/force-transfer.test.ts`.

### DTC-009 Record-date capture
Status: DONE 2026-11-08. DST boundary tests 2027-03-14 and 2027-11-07; maturity skips weekends and caller holidays.
- Deps: 002. Files: `packages/core/src/record-date-capture.ts`.
- Do: `captureInstant` returns 20:00 America/New_York on the record date as an ISO instant with offset (maturity: previous business day; use a US federal holiday list passed in, do not embed one). `capturePositions` calls a `PositionSource`.
- Accept: DST tests (2027-03-14 and 2027-11-07 boundaries and an ordinary summer and winter date); result label is `inferred` while the row is. Test: `node --test packages/core/test/record-date-capture.test.ts`.

### DTC-010 Cash-allocation lifecycle
Status: DONE 2026-11-08. A received credit unequal to the expected one goes to Disputed CREDIT_MISMATCH.
- Deps: 002. Files: `packages/core/src/cash-allocation.ts`.
- Accept: legal path Announced -> CaptureTaken -> CreditExpected -> CreditReceived -> Allocated -> Reconciled; `dispute` from any state after CaptureTaken; maturity case cannot reach Reconciled without a `tokens-burned` audit effect. Test: `node --test packages/core/test/cash-allocation.test.ts`.

### DTC-011 Sandbox registry, wallets, OAuth, sim hooks
Status: DONE 2026-11-08. Pure handler `src/app.ts` shared by the Node server and the browser; `MockDtcRegistry` with simulated clock and job queue.
- Deps: 004, 005. Files: `packages/sandbox/src/registry.ts`, `server.ts`, new `store.ts`.
- Do: in-memory registry composing core reducers; routes `/oauth/token`, `/v1/profile`, `/v1/wallets*`, `/v1/accounts/:p/balances|activity`, `/v1/sim/advance`, `/v1/sim/reset`. Fake OAuth issues opaque tokens for the four fake service accounts; wrong role -> 403.
- Accept: scenario `SBX-1-register-wallet` passes when run by hand with `curl`; `GET /v1/profile` returns row statuses. Test: `node --test packages/sandbox/test/wallets.test.ts`.

### DTC-012 Sandbox conversion, transfers, precheck
- Deps: 007, 011. Accept: scenario `SBX-3-convert` steps pass (including the `1.5` refusal); `POST /v1/transfers/precheck` returns reasons plus trust label. Test: `node --test packages/sandbox/test/conversion.test.ts`.

### DTC-013 Sandbox controls, force transfer, root-wallet uses
- Deps: 008, 011. Accept: scenarios `SBX-4-chill` and `SBX-5-force-transfer` pass; participant token on admin route -> 403. Test: `node --test packages/sandbox/test/controls.test.ts`.

### DTC-014 Scripted scenario runner
Status: DONE 2026-11-08. `runScripted(urlOrTransport, scenario, profile?)`; five scenarios pass in-process and over HTTP.
- Deps: 011, 012, 013. Files: `packages/sandbox/src/scenarios/runner.ts`, `packages/sandbox/test/five-scenarios.test.ts`.
- Do: implement `runScripted` (placeholder substitution, fake OAuth per actor, subset body match, capture).
- Accept: `FIVE_SCENARIOS` all pass against an in-process server in CI. Test: `node --test packages/sandbox/test/five-scenarios.test.ts`.

### DTC-015 Sandbox corporate actions
Status: DONE 2026-11-08. Capture runs as a clock job at 20:00 ET; one `credit-classic` per participant; maturity burns.
- Deps: 009, 010, 011. Do: `/v1/corporate-actions*`: announce interest or maturity, capture at 20:00 ET of the simulated clock, pay ONE consolidated credit per participant to its classic account, maturity burns tokens.
- Accept: a script announces an interest event with five wallets across two participants and each participant receives exactly one `credit-classic`. Test: `node --test packages/sandbox/test/corporate-actions.test.ts`.

### DTC-016 Sandbox CSV exports
Status: DONE 2026-11-08. Four tables; round-trip test; first line states the columns are ours.
- Deps: 011, 012. Do: `Accept: text/csv` on wallets, balances, activity, conversion orders. Column layouts are OURS (the real ones are not recorded in the notes); record that in the CSV header comment and in `SPEC.md`.
- Accept: round-trip test CSV -> parse -> equals JSON. Test: `node --test packages/sandbox/test/csv.test.ts`.

### DTC-017 docker-compose verified
Status: BLOCKED(no docker on the build machine), unchanged 2026-11-08.
- Deps: 014. Do: on a machine with docker, `docker compose -f packages/sandbox/docker-compose.yml up --build`, fix the Dockerfile, pin and record the Stellar quickstart image tag and its flags (currently `[U]`), run the five scenarios against the container.
- Accept: `docker compose ... up -d && node packages/sandbox/scripts/run-five.ts http://localhost:8080` exits 0. Status BLOCKED(no docker) on the scaffold machine. Test: that command.

### DTC-018 Conformance runner
Status: DONE 2026-11-08. Targets `sandbox` and `testnet-recorded` (live testnet is the spike script, not the runner; SPEC 5.2 updated). JSON + JUnit; CLI `pnpm conformance run`.
- Deps: 001, 002. Files: `packages/conformance/src/runner.ts`, new `bin.ts`.
- Do: `runPack` per its comment: filter by tags, gate on profile rows (`SKIPPED(unknown-field:<row>)`), `run-and-label` mode, catalogue-only -> `skipped not-implemented:<ticket>`, JSON report, JUnit. CLI: `pnpm conformance run --profile dtc-stellar --adapter stellar-sac --target sandbox`.
- Accept: running the catalogue reports 1 pass (SC-000), N skipped with reasons, and every line carries `trust`; report starts with the disclaimer. Test: `node --test packages/conformance/test/runner.test.ts`.

### DTC-019 Implement first sandbox scenarios
Status: DONE 2026-11-08. Executable in `packages/conformance/src/implementations.ts` (browser-safe).
- Deps: 014, 018. Implement SC-001..SC-008, SC-010, SC-011 against the sandbox (chain-neutral, in-memory adapter). Flip `status` to `implemented` with `testFile`, re-run `pnpm export-pack`.
- Accept: `pnpm conformance run --target sandbox` shows 11 pass. Test: `pnpm test`.

### DTC-020 Spike: atomic clawback plus issuer payment
Status: DONE 2026-11-08. Answer: yes. Ledger 5,621,476: one issuer-signed [clawback, payment] moved 10 A->B. Ledger 5,621,480: with B deauthorised the transaction failed with [op_success, op_not_authorized] and A kept 10. Holder signature played no part. Fixture `fixtures/sac-force-transfer/testnet-run.json`; replay test offline; matrix cells upgraded to P.
- Deps: none. Question: on Stellar testnet, can one transaction contain `clawback(A, n)` then `payment(issuer -> B, n)` signed only by the issuer, and does it fail atomically when B's trustline is deauthorised? Does the holder A's signature play any part?
- Method: `@stellar/stellar-sdk` ^17.3, throwaway keys generated at runtime and discarded, Friendbot on testnet, capture the transactions and results through `scripts/capture-fixture.ts` into `fixtures/sac-force-transfer/`.
- Decision rule: if both hold, the SAC `force-transfer` cell stays `composed` and DTC-021 builds the plan as one atomic transaction. If the transaction cannot be built or is not atomic, set the cell `none`, document the failure mode in `readiness-pack/requirement-to-stellar-matrix.md`, and raise the row `authorities.force-transfer-mechanism` as a blocker for the SAC form.
- Accept: fixtures plus provenance committed; matrix cell updated with evidence tag `P` and the testnet transaction hashes. Test: `node --test packages/adapter-stellar-sac/test/force-transfer.fixture.test.ts` (replays the fixture, no network).

### DTC-021 SAC adapter: offline action plans
Status: DONE 2026-11-08. Seven plans with unsigned envelopes; `operationsFromPlan`; mainnet is a type error and a runtime throw.
- Deps: 002, 020. Implement the seven `plan*` methods returning unsigned `ChainActionPlan`s (steps, signers, preconditions, atomic flag, trust). Build XDR with `@stellar/stellar-sdk` only to prove well-formedness; never sign.
- Accept: a plan for force transfer has `atomic: true` and steps `[clawback, payment]`; a restrict plan names the flag change; a `network: "mainnet"` config is a type error and a runtime throw. Test: `node --test packages/adapter-stellar-sac/test/plans.test.ts`.

### DTC-022 Spike: whole-token enforcement
Status: PARTIAL 2026-11-08. SAC half: a 0.5-token payment succeeded on testnet (ledger 5,621,491); SC-031 implemented. SEP-57 decimals-0 half (SC-032) TODO with DTC-024.
- Deps: none. Question: what does a 7-decimal SAC do with a 0.5-token payment, and does a SEP-57 token deployed with decimals 0 behave and display as whole tokens in the wallets and explorers we can reach read-only?
- Decision rule: if the SAC accepts fractions on-chain (expected), the cell `whole-token-enforcement` stays `none` and `token.whole-token-enforcement-stellar` stays `inferred`; if decimals-0 deployment of OZ's token is not possible, mark the SEP-57 cell `none` and record the blocker.
- Accept: fixtures + provenance; SC-031 and SC-032 implemented as testnet scenarios. Test: `node --test packages/conformance/test/whole-token.fixture.test.ts`.

### DTC-023 SAC adapter on testnet end to end
Status: PARTIAL 2026-11-08. allowlist-add/remove, unrestrict, mint and force-transfer plans were submitted on testnet by the spike; SC-019 (observed) and SC-029 (pass) run from the recording via `--target testnet-recorded`. A live `--target testnet` runner path is not built.
- Deps: 021. Implement allowlist-add/remove, restrict, mint, force-transfer submission against testnet or the local quickstart with throwaway keys; implement SC-019, SC-029.
- Accept: `pnpm conformance run --adapter stellar-sac --target testnet --include @testnet` passes SC-019 and SC-029 and prints `@unknown` labels where rows are unknown. Test: that command (network required; `BLOCKED(network)` otherwise).

### DTC-024 Spike: SEP-57 semantics
- Deps: none. Questions: (1) which OZ SEP-57 implementation and version deploys on testnet today; (2) `forced_transfer` from a frozen address, from a partially frozen address, while paused: allowed or rejected? (3) does `forced_transfer` run compliance hooks? (4) what does a transfer to an unverified recipient fail with?
- Decision rule: record observed behaviour as fixtures; set the matrix cells accordingly; do NOT choose a "right" answer: DTC's expectation is unknown. Update SC-020 to `observed`.
- Accept: `fixtures/sep57-semantics/*` with provenance; a table in `packages/adapter-stellar-sep57/README.md`. Test: `node --test packages/adapter-stellar-sep57/test/semantics.fixture.test.ts`.

### DTC-025 SEP-57 adapter: offline plans
Status: DONE 2026-11-08. invoke_contract envelopes for forced_transfer, set_address_frozen, mint, burn; allowlist depends on the identity registry (no envelope, caveat).
- Deps: 002, 024. Seven `plan*` methods, one `invoke_contract` step each with the SEP function name; `restrict` with `inbound:false, outbound:true` returns a plan with a caveat if inbound-only/outbound-only is inexpressible.
- Accept: plans reference `forced_transfer`, `set_address_frozen`, `mint`, `burn`, `pause`. Test: `node --test packages/adapter-stellar-sep57/test/plans.test.ts`.

### DTC-026 SEP-57 adapter on testnet
- Deps: 025. Submit plans against a testnet deployment; implement SC-020 (observed), SC-018 for this adapter.
- Accept: `pnpm conformance run --adapter stellar-sep57 --target testnet` passes SC-018 and records SC-020. Test: that command (network required).

### DTC-027 Event decoders
- Deps: 021, 025. Decode SEP-41/CAP-67 transfer/mint/burn, SAC admin ops (clawback, set_authorized), SEP-57 events into one `DtcEvent` union with a flag `adminAction`. May adapt ideas from the owner's `activity-ledger` decoder (own project; if code is copied, record it in `docs/THIRD_PARTY.md` as an internal reuse and ask the user first). Implement SC-021.
- Accept: decoder tests on captured fixtures; matrix cell `admin-events-distinguishable` updated with evidence. Test: `node --test packages/adapter-stellar-sac/test/events.test.ts`.

### DTC-028 Spike: contract address as registered wallet (token side)
- Deps: 023, 026. Question: which of SAC `set_authorized` on a C-address, SEP-57 identity registration of a C-address, and a transfer to it, succeed on testnet? This bounds the token side only; DTC's willingness stays `unknown`.
- Decision rule: record outcomes in the matrix; leave `wallet.contract-address-registrable` `unknown`; write a one-page question for DTCC/SDF in `drafts/dtcc-questions.md` (the user sends it, G-OUTREACH).
- Accept: SC-030 produces an `observed` record. Test: `pnpm conformance run --include SC-030`.

### DTC-029 Spike: wallet-vendor capability refresh and outreach drafts
- Deps: none. Re-read the vendor documents named in `readiness-pack/wallet-vendor-matrix.md` (public pages only), update the trust tags and dates, and draft (do not send) one short question per vendor in `drafts/`.
- Decision rule: a vendor claim without a primary technical document stays `[V]`; only a vendor doc that names the operation counts as supporting it.
- Accept: matrix rows have dated sources; `drafts/` contains one file per vendor. Test: `pnpm check` (docs link check script is part of DTC-036).

### DTC-030 Implement the remaining sandbox-level scenarios
Status: PARTIAL 2026-11-08. Done: SC-008, SC-009, SC-012, SC-014..SC-017, SC-018 (sandbox), SC-022..SC-024, SC-027. Not done: SC-013 (testnet revert), SC-020, SC-018 with the SEP-57 adapter on testnet.
- Deps: 015, 019, 023, 026. SC-008, SC-009, SC-012..SC-018, SC-022..SC-024, SC-027.
- Accept: `pnpm conformance run --target sandbox` passes all non-`@testnet` implemented scenarios; only SC-020, SC-021, SC-030, SC-033, SC-034 remain observation-only. Test: `pnpm test`.

### DTC-031 Profile diff and watcher
Status: PARTIAL 2026-11-08. `diffProfiles` done with tests; `scripts/watch.ts` (network) not built.
- Deps: 001. Implement `diffProfiles`; add `scripts/watch.ts` that GETs (read-only, browser UA, once, politely) the DTCC product page, the Learning Center TOC and `welcome.htm` (string "Stellar"), the SEC letter URL is NOT fetched by script (403 in discovery), and the three SEP files' version lines via `gh api`; writes `out/watch-<date>.json`.
- Accept: running twice yields an empty diff; a mocked change of the product-page tile is reported. Test: `node --test packages/profile-spec/test/diff.test.ts packages/conformance/test/watch.test.ts`.

### DTC-032 Reconciliation: HoldersSnapshot mapping
Status: DONE 2026-11-08 (unblocked: holders-at-ledger published its SPEC and schema). Maps the golden mainnet capture robovac@65,290,900 losslessly; malformed input rejected with the schema error.
- Do: read `projects/holders-at-ledger/SPEC.md` and its schema (path from the docs/ARCHITECTURE.md contract table), validate input with that schema, map holders to `CapturedPosition`, copy `ledgerSeq`, `supplyHash`. Do not redefine the shape.
- Accept: a fixture snapshot produced by that project maps with no lossy conversion; a malformed snapshot is rejected with its schema error. Test: `node --test packages/reconciliation/test/holders-source.test.ts`.

### DTC-033 Allocation algorithm
Status: DONE 2026-11-08. 10,000 seeded cases; SHA-256 checksum via audited @noble/hashes 2.4.0 (G-CRYPTO).
- Deps: 010. Implement `allocateConsolidatedCredit` exactly as specified in its comment, plus `AllocationRefused`. Property tests with a seeded generator (no new dependency: write the 20-line PRNG).
- Accept: SC-025 and SC-026 pass; 10,000 random cases satisfy sum == credit, non-negative, order-independence, determinism of checksum. Test: `node --test packages/reconciliation/test/allocate.test.ts`.

### DTC-034 Break detection
Status: DONE 2026-11-08. One fixture per break code; clean fixture has none.
- Deps: 033, 016. Implement `expectedCredit`, `diffPositions`, `reconcile`; breaks listed in `BreakCode`; never auto-fix. SC-028.
- Accept: each break code has a fixture that triggers it and none triggers on the clean fixture. Test: `node --test packages/reconciliation/test/breaks.test.ts`.

### DTC-035 Reconciliation CLI, end to end, performance spike
Status: PARTIAL 2026-11-08. Spike: 91-134 ms for 10,000 wallets / 500 clients (five cold runs); SC-035 budget 1,000 ms. End to end corporate action + reconciliation runs in `pnpm demo:data`. `dtc-reconcile` CLI not built.
- Deps: 015, 032, 034. CLI `dtc-reconcile --books books.json --snapshot snap.json --credit credit.json [--dtc-balances balances.csv]` printing a report; end-to-end test against the sandbox corporate action. Spike: measure allocation time for 10,000 wallets / 500 clients on this machine and set the SC-035 budget from the measurement, not before.
- Accept: report JSON is stable across runs; SC-035 has a measured budget in its `then`. Test: `node --test packages/reconciliation/test/e2e.test.ts`.

### DTC-036 Readiness-pack generator
- Deps: 001, 021, 025. `scripts/gen-readiness.ts` regenerates the generated tables in `readiness-pack/requirement-to-stellar-matrix.md` between `<!-- generated:start -->` and `<!-- generated:end -->` markers from the two profiles and the two capability matrices, and checks that every `[P]` link in the pack is a URL listed in a profile or in `SOURCES.md`.
- Accept: running it twice changes nothing; changing a profile row status changes the matrix. Test: `pnpm gen:readiness && git diff --exit-code readiness-pack` (the user commits; use `diff` against a copy if not in git).

### DTC-037 Wallet-vendor scenario pack
- Deps: 018, 023, 026. Implement SC-033 and SC-034 as a pack a vendor can run against their own test environment and a CLI that prints supported / not supported / not testable. Share the pack with `preflight-harness`.
- Accept: runs against a mock vendor in tests; output never claims DTC compatibility. Test: `node --test packages/conformance/test/vendor-pack.test.ts`.

### DTC-038 Spike: SEP-8 approval-server fit
- Deps: none. Question: can a SEP-8 approval flow express "destination must be a registered wallet" for a payment, and which wallet or custody stacks can carry it? Use SDF's `stellar-demo-wallet` (read-only code reading) and the reference server docs; no contact.
- Decision rule: if no custody stack with a raw-XDR path is evidenced to support SEP-8 client flow, keep `distribution_control.sep-8-approval-fit` at "poor" and close; otherwise document the path in `readiness-pack/sep8-and-contract-wallets.md`.
- Accept: the readiness doc section is updated with dated evidence tags. Test: `pnpm check`.

### DTC-039 ScenarioPack contract handover
- Deps: 018. Draft `docs/decisions/ADR-0005` text (in `drafts/`, since programme docs are not ours to edit) proposing the ScenarioPack format as a cross-project contract, with the schema path and an example pack for `token-invariants` and `preflight-harness`.
- Accept: draft exists; example pack validates. Test: `node --test packages/conformance/test/catalogue.test.ts`.

### DTC-040 "DTCC published" runbook and rehearsal
- Deps: 031. Write `readiness-pack/publication-runbook.md`: what to do in order when DTCC publishes Stellar guidance (re-read, rewrite rows, bump versions, rerun conformance, diff report, announce what changed). Rehearse with a fake "published" copy of `dtc-stellar.json` in a temp dir.
- Accept: rehearsal transcript in the runbook; conformance reports show `unknown -> published` transitions in the diff. Test: `node --test packages/profile-spec/test/diff.test.ts`.

### DTC-041 Build packages for npm publication
- Deps: none. Emit JS + `.d.ts` (tsc, `rewriteRelativeImportExtensions`) into `dist/`, point `exports` there, add `files`, `repository`, `publishConfig`; keep `./pure` and `./browser` entries. See DEPLOY.md section 3.
- Accept: `npm pack --dry-run` per package lists only dist, schema, profiles, packs; a scratch consumer imports each package on Node 24 without type stripping.

### DTC-042 Host the console and add CI
- Deps: 041 for CI publish steps only. Static host for `web/dist`; GitHub Action as in DEPLOY.md section 5.
- Accept: hosted URL serves the build; CI runs `pnpm check`, the conformance run and the web build on every push. The user deploys (agents do not).
