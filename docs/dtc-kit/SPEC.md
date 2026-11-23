# SPEC (normative)

Status: implemented for the MVP, 2026-11-08 (scaffold 2026-10-31). Where this file and code disagree, this file wins until it is changed here first (docs/AGENT_GUIDE.md). Tags: [P] primary, [S] secondary, [V] vendor, [I] inference, [E] estimate, [U] unverified.

Everything in dtc-kit is **DTC-shaped, not DTC-certified**. The DTCC Stellar specification is unpublished (gate **G-DTCC**). Every dependency on it is a row in a requirements profile; code never hard-codes a DTCC requirement.

## 0. Scope

In: requirements-profile schema and two profile files; chain-neutral DTC state machines; a mock DTC registry/participant simulator with an HTTP API; two Stellar adapters and their capability matrices; a tagged scenario catalogue and runner; participant-side reconciliation of DTC's consolidated cash credit; a readiness-pack of documents.

Out (explicitly): any claim of DTC compatibility or certification; DTCC's real API, auth handshake, LedgerScan formats (login-gated, unread); an issuer payout planner for DTC tokens (DTC pays a consolidated cash credit); an issuer-config linter for DTC tokens (DTC's tokenization engine configures them); hosted sanctions screening or any real OFAC data (G-LEGAL); custody, key handling, mainnet writes (G-VALUE, G-SECRETS); UI; a token standard; a registered-wallet DvP standard (a later brief: it depends on whether a contract address can be a registered wallet, section 9).

## 1. Requirements profile (`packages/profile-spec`)

Schema: `packages/profile-spec/schema/requirements-profile.schema.json`, JSON Schema draft 2020-12, validated with Ajv in strict mode (`Ajv2020`). Shape in `src/types.ts`.

### 1.1 Profile document

| Field | Type | Rule |
|---|---|---|
| `profileId` | string | kebab-case, stable. Bundled: `dtc-generic`, `dtc-stellar`. |
| `version` | string | `YYYY-MM-DD` or `YYYY-MM-DD.N`; bump on ANY row change. |
| `title`, `description` | string | |
| `disclaimer` | string | Required. Every tool output must echo it (section 1.5). |
| `extends` | profileId | Child rows replace parent rows with the same `id`; others inherited. Cycles are an error. |
| `createdAt` | date | |
| `supersedes` | string | `profileId@version` |
| `rows` | array, min 1 | Section 1.2. |

`additionalProperties: false` everywhere: an unknown field is a validation error.

### 1.2 Row

| Field | Type | Rule |
|---|---|---|
| `id` | string | `<area>.<slug>`, lower case, `^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_-]*)+$`; the first segment MUST equal `area`. Stable forever: scenarios and docs reference ids. Unique within a profile. |
| `area` | enum | `wallet token network authorities distribution_control events operations corporate_actions compliance access exports identifiers` |
| `statement` | string | One sentence a human can check against the source. |
| `value` | any | The machine-readable value code reads. `null` iff `unknown`. |
| `status` | enum | `published | inferred | unknown` (table below). |
| `confidence` | enum | `high medium low none` |
| `sources` | array | `{url (https), tag, retrievedAt (date), via?, locator?, title?}`. |
| `basis` | string | Required when `inferred`. |
| `unblockedBy` | string | Required when `unknown`: the event or document that would fill the row. |
| `candidates` | string[] | Options still open. Scenarios must not assume one. |
| `noteRef`, `tags` | | Pointers and free tags. |

Status rules (enforced by the schema's `if/then`, tested in `packages/profile-spec/test/profile-schema.test.ts`):

| status | `value` | `confidence` | `sources` | extra |
|---|---|---|---|---|
| `published` | not null | `high` or `medium` | >= 1 and at least one with `tag: "P"` | Gate G-DTCC: only these may be treated as DTCC fact. |
| `inferred` | not null | `high medium low` | any (may be empty) | `basis` required: why we think it, and why it is not published. |
| `unknown` | `null` | `none` | any (usually empty) | `unblockedBy` required. |

`published` here means "stated by a primary DTCC or SEC document". At scaffold time the notes' reading was NOT independently re-verified for every row (ticket DTC-006); `sources[].via` records which rows were re-read (`scaffold-reread`, 2026-10-31).

### 1.3 Resolution and trust

`resolveProfile(profile)` returns `ResolvedProfile {profileId, version, lineage[], disclaimers[], rows: Map}`. `weakestStatus(profile, rowIds)` returns the weakest of `unknown < inferred < published`; a row id absent from the profile counts as `unknown`; an empty list yields `unknown`.

### 1.4 Bundled profiles at scaffold (2026-10-31)

`dtc-generic`: 28 rows, 25 `published`, 3 `inferred` (`wallet.control-state-semantics`, `token.whole-tokens-only`, `corporate_actions.position-capture-8pm-et`). `dtc-stellar` (extends generic): 18 rows, 6 `inferred`, 12 `unknown`, none `published`. The last point is a test (gate G-DTCC): a Stellar row may not be `published` until DTCC publishes Stellar requirements.

Why the two named inferred rows are not `published` although a help page states them: the page states them for the live networks; carry-over to Stellar, and the exact treatment around the 8:00 pm cutoff (the text was truncated in the capture), are not established. Re-read by a human in DTC-006 and upgrade only if every clause is supported.

### 1.5 Labelling rule (G-DTCC)

Every output that depends on rows (a precheck result, an HTTP response, a conformance report line, a generated document table) carries a `TrustLabel {status, rows[], profile, profileVersion, disclaimer}` where `status` is the weakest status among the rows it used. Outputs rendered for humans print the label when `status !== "published"` and ALWAYS print the disclaimer once. Wording is fixed: "DTC-shaped, not DTC-certified."

## 2. Core state machines (`packages/core`)

All machines are pure reducers: `reduceX(state, event, profile) -> {next, effects[], trust}`. They throw `InvalidTransition(from, event)` (DTC-004) for illegal pairs; they never perform I/O. `effects` are `CoreEffect` values (`src/types.ts`) executed by the host (sandbox, a participant system, an adapter). Amounts: whole tokens are `bigint`; cash is `bigint` minor units (USD cents); quantities that may be fractional arrive as strings and are rejected, not rounded.

Implemented 2026-11-08 (DTC-002..DTC-010), with table tests over every (state, event) pair. `trustLabel(profile, rows)` and `label(text, trust)` build and render the label (DTC-002). Wall-clock rules use `Intl` only (`src/time.ts`).

### 2.1 Wallet registration and control states (DTC-003, DTC-004)

States are the DTCC status list (row `wallet.registration-status-taxonomy`): `Processing`, `Completed`, `Failed Compliance`, `Failed`, `Delivery Order Chill`, `Global Lock`, `Compliance Lock`. Record: `WalletRecord` (`src/wallet-registration.ts`). Initial state: `Processing`, `ofacCleared=false`, `onChainAllowlisted=false`.

| From | Event | To | Effects / notes |
|---|---|---|---|
| Processing | `ofac-passed` | Completed if `onChainAllowlisted`, else Processing with `ofacCleared=true` | `allowlist-add` is emitted once, on the first `ofac-passed` |
| Processing | `onchain-allowlist-confirmed` | Completed if `ofacCleared`, else Processing with flag set | |
| Processing, Completed | `ofac-failed` | Failed Compliance | `allowlist-remove` if it was allowlisted; DTC "may at its discretion" re-screen (row `wallet.participant-kyc-aml-duty`) |
| Processing | `technical-failure` | Failed | |
| Completed | `delivery-order-chill` | Delivery Order Chill | save `statusBeforeControl=Completed`; effect `restrict` per row `wallet.control-state-semantics` |
| Completed, Delivery Order Chill | `global-lock` / `compliance-lock` | Global Lock / Compliance Lock | escalation keeps the original `statusBeforeControl` |
| any control state | `release-control` | `statusBeforeControl` | effect `unrestrict` (or `restrict` for the remaining control) |
| Failed Compliance, Failed | any control event | illegal | |

`validateRegistration(request, profile, directory)`: the host passes a `RegistrationDirectory {isParticipant, clientExists, isRegistered}`. Only a participant may register (error `NOT_A_PARTICIPANT`); `kind: "client"` requires a `clientId` (`VALIDATION` when missing) that exists in the participant's books (`CLIENT_ID_UNKNOWN`); the address text is NOT validated (row `wallet.address-not-validated-by-dtc`); a duplicate (ledger, address) is `ALREADY_REGISTERED`.

Restriction semantics (row `wallet.control-state-semantics`, **inferred**): Delivery Order Chill blocks outbound only; Global Lock and Compliance Lock block both ways; Failed Compliance blocks inbound (cannot receive, barred from orders). Any result derived from these carries `@inferred`. `restrictionFor` reads the effects from the row; a control state missing from the row blocks both ways and is labelled `unknown`. Processing and Failed wallets also block inbound (not allowlisted; published rows). `DEST_RESTRICTED` fires only for control states, so Failed Compliance yields `DEST_FAILED_COMPLIANCE` alone.

### 2.2 Transfer pre-check (DTC-005)

`precheckTransfer(intent, profile, opts?) -> {allowed, reasons[], trust}`; `opts.dtcLedgers` lists the ledgers DTC bridges (without it `CROSS_NETWORK_NO_BRIDGE` is not evaluated). "1.0" is not fractional. It returns EVERY reason that applies, in this order, and `allowed` is `reasons.length === 0`.

| Reason | Fires when | Rows |
|---|---|---|
| `DEST_NOT_REGISTERED` | `to` is undefined (address not in registry) | `token.transfer-only-to-registered-wallets` |
| `DEST_FAILED_COMPLIANCE` | destination status Failed Compliance | `wallet.registration-status-taxonomy` |
| `DEST_STATUS_NOT_COMPLETED` | destination Processing or Failed | same |
| `SOURCE_RESTRICTED` | source status blocks outbound | `wallet.control-state-semantics` |
| `DEST_RESTRICTED` | destination status blocks inbound | same |
| `FRACTIONAL_QUANTITY` | `rawQuantity` has a fractional part | `token.whole-tokens-only` |
| `CROSS_NETWORK_OUTSIDE_HOURS` | `toLedger` differs and `at` is outside 02:00-18:00 America/New_York Mon-Fri | `operations.transfer-and-processing-hours` |
| `CROSS_NETWORK_NO_BRIDGE` | `toLedger` differs and the pair is not a DTC-supported burn/mint pair | same |

`trust.status` = weakest status over the rows of the reasons that FIRED; if allowed, over all rows consulted.

### 2.3 Conversion orders (DTC-007)

States (row `operations.conversion-order-status-taxonomy`): `Pending Approval`, `Processing`, `Completed`, `Failed`, `Declined`. Directions: `to-token`, `to-book-entry`.

| From | Event | To | Effects / notes |
|---|---|---|---|
| (new) | `submitConversionOrder(input)` makerChecker=true | Pending Approval | no effect yet |
| (new) | `submitConversionOrder(input)` makerChecker=false | Processing | submit-time checks below; `to-token` debits the classic position (`classic-position`, -n) |
| Pending Approval | `approve` (checker != maker) | Processing | same entry effects as above |
| Pending Approval, Processing | `decline` | Declined | `reasonCode` set |
| Processing | `onchain-confirmed` | Completed | `to-token`: exactly `[mint, audit]`; `to-book-entry`: `[burn, classic-position(+n), audit]` |
| Processing | `onchain-reverted` | Failed, `reasonCode: ONCHAIN_REVERTED` | classic movement reversed (`classic-position`, +n for to-token) (row `authorities.dtc-initiated-mint-burn`) |
| Pending Approval, Processing | `outside-processing-hours` | unchanged | `audit` "held"; **[U]** DTCC behaviour outside the window is not recorded in the notes; the sandbox holds the order and re-checks every 15 min; the result is labelled `unknown` (it rests on the absent row `operations.out-of-hours-hold`) |

Submit-time declines, in this order: `WALLET_FAILED_COMPLIANCE`, `WALLET_NOT_COMPLETED`, fractional quantity (`FRACTIONAL_QUANTITY`), not a positive whole number (`INVALID_QUANTITY`), `to-book-entry` with fewer tokens than requested (`INSUFFICIENT_TOKENS`). DTC initiates mint/burn; a participant has no issue operation.

### 2.4 Force transfer (DTC-008)

States: `Requested -> Planned -> Submitted -> Confirmed | Failed`. Reasons (row `authorities.force-transfer-reasons`): `lost stolen erroneous`. `requestForceTransfer(req, profile)` returns `{ok, transfer}` or `{ok:false, code}`. Rules: destination must be a Registered Wallet able to receive (the same pre-check, destination reasons only: `DEST_NOT_REGISTERED`, `DEST_FAILED_COMPLIANCE`, ...; restrictions on the SOURCE do not apply to the override); the reason must be in the row's list (`INVALID_REASON`); no holder signature is part of the request (row `authorities.dtc-override-root-wallet`); `plan` calls `adapter.planForceTransfer`; `confirmed` emits `[force-transfer, root-wallet-use]`; each use is recorded as a `RootWalletUse` and counted per quarter and reason by `summariseRootWalletUses(uses, quarterStart)` (quarters on the America/New_York calendar, an assumption [I]) (row `compliance.quarterly-sec-report-counts`).

### 2.5 Record-date capture (DTC-009)

`captureInstant(date, kind, profile, {holidays?}) -> {at, recordDate, trust}` = the row's time (20:00) `America/New_York` on the record date for `interest`; for `maturity` the business day before the maturity date (holidays supplied by the caller). Computed with `Intl`/Temporal semantics, so DST is respected; never a fixed UTC offset. Label: `@inferred` while row `corporate_actions.position-capture-8pm-et` is. `PositionCapture` carries optional `ledgerSeq` and `supplyHash` to line up with the `HoldersSnapshot` of the holders-at-ledger project (see section 8.1).

### 2.6 Cash allocation lifecycle (DTC-010)

States: `Announced -> CaptureTaken -> CreditExpected -> CreditReceived -> Allocated -> Reconciled`, and `Disputed` reachable from any state after `CaptureTaken` with a `disputeCode` (section 8.4). A `maturity` case cannot become `Reconciled` without an audit effect recording that the tokens were burned. Rows: `corporate_actions.cash-credit-consolidated-classic`, `corporate_actions.phase1-scope`.

## 3. ChainAdapter port and capability matrix (`packages/core/src/chain-adapter.ts`)

A `ChainAdapter` PLANS; it never signs, never holds keys, never talks to mainnet (G-SECRETS, G-VALUE). Methods: `capabilityMatrix()`, `planAllowlistAdd/Remove`, `planRestrict`, `planUnrestrict`, `planMint`, `planBurn`, `planForceTransfer`. Each returns a `ChainActionPlan {adapterId, action, atomic, steps[], preconditions[], caveats[], trust, rows[]}`.

Invariants (tested in DTC-021, DTC-025):
1. `atomic === true` iff all `steps` go in one transaction. A SAC force transfer MUST be `atomic: true` with steps `[clawback(from), payment(issuer -> to)]`; otherwise a failure between the steps destroys the holder's tokens (a clawback is a burn).
2. Every plan lists the signers it needs; the adapter has none.
3. `trust` is the weakest status of `rows`.
4. A config naming a network other than `testnet` or `local` is rejected at compile time and at runtime.

`CapabilityMatrix` is a total record over `CAPABILITIES` (15 capabilities). Each cell: `support` (`native composed partial none unknown`), `mechanism`, `caveats[]`, `evidence` (P/S/V/I/U), `profileRows[]`, optional `verifyTicket`. Cells are static data reviewed in PRs. At scaffold the SAC matrix has no `P` evidence (facts taken from notes); the SEP-57 matrix has `P` for function names (read from SEP-57 Draft v0.4.0 on 2026-10-31) and `I`/`U` for behaviour. Upgrading a cell requires a fixture with provenance (docs/CONVENTIONS.md).

2026-11-08: plans may carry `envelopeXdr` (an UNSIGNED transaction envelope built with `@stellar/stellar-sdk` 17.4.0 and a placeholder sequence, only when every address is a valid strkey) and `network`. The SAC adapter's plans were submitted on Stellar testnet with throwaway keys by `packages/adapter-stellar-sac/scripts/testnet-spike.ts` (`operationsFromPlan` turns a plan into operations; signing happens only in the script). The recorded run (`fixtures/sac-force-transfer/testnet-run.json`, ledgers 5,621,465-5,621,491) upgraded six SAC cells to evidence `P`: allowlist, deny-unregistered (classic payment codes `op_not_authorized`, `op_no_trust`), admin-burn, admin-mint, force-transfer (atomic; the failing variant left the holder's balance unchanged) and whole-token-enforcement (`none`: a 0.5-token payment succeeded). SEP-57 plans have not been run on testnet (DTC-024, DTC-026).

Stellar facts this relies on, with status:
- SAC / classic: `AUTH_REQUIRED` + `SetTrustLineFlags` authorised trustlines are the allowlist; `AUTH_CLAWBACK_ENABLED` (and `AUTH_REVOCABLE`) must be set before trustlines exist; clawback burns [S via notes; re-verified by DTC-020/DTC-023]. Why a force transfer needs clawback plus an issuer payment in ONE transaction: no classic operation moves tokens between two holders without the source holder's signature, and a clawback alone only burns.
- SEP-57 functions `forced_transfer`, `mint`, `burn`, `recover_balance`, `set_address_frozen`, `freeze_partial_tokens`, `unfreeze_partial_tokens`, `pause`, `unpause`, `set_compliance`, `set_identity_verifier` exist with an `operator` argument [P: sep-0057.md v0.4.0 Draft, read 2026-10-31]. Their behaviour in combination is unspecified in the SEP.
- SEP-41 v0.5.2 Draft: `transfer(from, to: MuxedAddress, amount)`, `burn`, `allowance`; no allowlist, freeze or forced transfer [P, 2026-10-31].

## 4. Sandbox (`packages/sandbox`)

A mock DTC registry and participant simulator. Its API is the kit's OWN shape, derived from public help-page vocabulary. It is not DTCC's API and must never be described as compatible. Every JSON response carries header `x-dtc-kit-disclaimer: DTC-shaped, not DTC-certified. Fictional institutions. Not the DTCC API.`

### 4.1 Fake institutions (`src/institutions.ts`)

Participants `SBX-9001` Alder Clearing Bank (bank), `SBX-9002` Birch Prime Brokerage (prime broker, clients `C-BIRCH-001..003`), `SBX-9003` Cedar Custody Trust, `SBX-9004` Dunmore Retail Securities (client `C-DUNMORE-SABLE`, on the SANDBOX sanctions list `SBX-SDN-0001`). Wallet vendors `VND-FJORD` (claims classic trustlines and clawback ops), `VND-GLEN` (also claims Soroban auth entries and control-action display). All names are fictional and say so. Addresses are fake strings (`FAKE_ADDRESSES`); CUSIP `SBX000AA0`. The sandbox "sanctions list" is a hard-coded fictional id; no real OFAC data is used or fetched (G-LEGAL).

### 4.2 Routes (`src/api.ts` `ROUTES`)

| Method | Path | Role | Purpose | Ticket |
|---|---|---|---|---|
| GET | /v1/health | public | liveness + profile id/version/lineage | done |
| POST | /oauth/token | public | client_credentials for a fake service account | DTC-011 |
| GET | /v1/profile | public | active resolved profile with row statuses | DTC-011 |
| POST | /v1/wallets | participant | register (202, Processing) | DTC-011 |
| GET | /v1/wallets, /v1/wallets/:id | participant | list / one; `Accept: text/csv` | DTC-011, DTC-016 |
| GET | /v1/accounts/:participant/balances, /activity | participant | balances, activity; csv | DTC-011, DTC-016 |
| POST | /v1/conversion-orders | participant | create | DTC-012 |
| GET | /v1/conversion-orders/:id | participant | one | DTC-012 |
| POST | /v1/conversion-orders/:id/approve | participant | checker approves | DTC-012 |
| POST | /v1/transfers/precheck | participant | reasons + trust label | DTC-012 |
| POST | /v1/transfers | participant | sandbox-ledger transfer, enforces registered-wallet rule | DTC-012 |
| POST | /v1/admin/force-transfers | dtc-ops | override | DTC-013 |
| GET | /v1/admin/root-wallet-uses | dtc-ops | quarterly count | DTC-013 |
| POST | /v1/corporate-actions, /:id/capture, /:id/pay | dtc-ops | announce, capture, pay consolidated credit | DTC-015 |
| POST | /v1/sim/wallets/:id/control | sim | chill, global lock, compliance lock, release | DTC-013 |
| POST | /v1/sim/advance | sim | advance simulated time; completes async work | DTC-011 |
| POST | /v1/sim/reset | sim | reset to fixture `empty` or `two-wallets-funded` | DTC-011 |
| GET | /v1/conversion-orders | participant | list own orders; csv | DTC-016 |
| GET | /v1/corporate-actions/:id | participant | own captured positions and credit | DTC-015 |
| GET | /v1/sim/plans | sim | chain action plans recorded for every chain effect | DTC-021 |

All routes are implemented (2026-11-08). The HTTP layer is a pure function `handle(registry, request)` (`src/app.ts`) shared by the Node server and the browser console; unknown paths `404 NOT_FOUND`. Wrong role: `NOT_A_PARTICIPANT` (403) on participant routes, `FORBIDDEN_ROLE` (403) on dtc-ops/sim routes. Request/response bodies: `RegisterWalletRequest`, `CreateConversionOrderRequest` (`tokens` is a STRING), `PrecheckRequest/Response`, `ForceTransferRequest/Response`, `ApiError {code, message, ticket?}` in `src/api.ts`.

### 4.3 Behaviour

- **Determinism.** No randomness, no wall clock. Ids are sequential (`W-1`, `ORD-1`, `FT-1`, `CA-1`). Time is the simulated clock (`/v1/sim/advance`). Same request sequence gives byte-identical responses.
- **Async work** (sandbox constants, not DTC's): OFAC screen completes 30 s after registration; on-chain allowlist confirmation 30 s after OFAC pass; a conversion order completes 600 s after it enters Processing (DTCC's target is "15 minutes or less" [P: FAQ via notes]).
- **Auth.** `POST /oauth/token` accepts `client_id` = a participant's `serviceAccountId`, role `dtc-ops` or `sim` with fixed sandbox secrets documented in `README`. Tokens are opaque strings. A participant token on a `dtc-ops` or `sim` route is `403 FORBIDDEN_ROLE`; a participant acts only on its own wallets.
- **Status codes.** Created async work `202`; success `200`; validation `422`; a declined order returns `422` with the order body (`status: "Declined"`, `reasonCode`); rule refusals `409` with `{code}` from section 2.2; missing/invalid token `401`.
- **Fixtures.** `reset` with `{fixture:"two-wallets-funded"}` returns `{sourceWalletId:"W-1", destinationWalletId:"W-2"}`: W-1 (client `C-BIRCH-001`, 100 tokens) and W-2 (client `C-BIRCH-002`, 0 tokens), both Completed, participant `SBX-9002`.
- **CSV.** Columns are ours and the header comment says so (the real layouts are not in the notes).
- **Chain mode.** Default is a pure in-memory ledger. With a `ChainAdapter` configured the registry also records the adapter's `ChainActionPlan` for every effect; it submits to testnet only when `DTC_SUBMIT=testnet` (DTC-023, DTC-026).

### 4.4 Five scripted scenarios (`src/scenarios/`)

Data-driven (`ScriptedScenario`: steps of `{actor, request, expect, capture}`), run by `runScripted(baseUrlOrTransport, scenario, profile?)` (DTC-014), which first resets the sandbox to the `empty` fixture. Built only from the public no-action-letter conditions and public help pages; each lists its `rows` and `nalBasis`.

1. `SBX-1-register-wallet`: register -> Processing; non-participant refused; advance; Completed.
2. `SBX-2-ofac-fail`: sanctioned-test client wallet -> Failed Compliance, not allowlisted; conversion order Declined `WALLET_FAILED_COMPLIANCE`.
3. `SBX-3-convert`: to-token 100 -> Completed with 100 tokens; `"1.5"` refused `FRACTIONAL_QUANTITY`; to-book-entry 40.
4. `SBX-4-chill`: transfer ok; Delivery Order Chill; transfer refused `SOURCE_RESTRICTED`; release; ok. Labelled `@inferred`.
5. `SBX-5-force-transfer`: participant refused (403); DTC force-transfers 10 without holder signature; unregistered destination refused; root-wallet uses total 1.

## 5. Conformance (`packages/conformance`)

### 5.1 ScenarioPack format

Schema: `packages/conformance/schema/scenario-pack.schema.json` (2020-12). TS types: `src/pack.ts`. Exported JSON: `packs/dtc-kit-readiness.pack.json` (regenerate with `pnpm export-pack`; a test fails if stale). This is a cross-project contract (docs/ARCHITECTURE.md): token-invariants and preflight-harness produce packs in this format.

Scenario fields: `id` (`SC-NNN`), `title`, `area`, `tags`, `requiresRows`, `onUnknown`, `given[]`, `when`, `then[]` (expected results), `status` (`catalogue | implemented`), `ticket`, `testFile` (required when implemented).

Tags: exactly one trust tag `@published | @inferred | @unknown`, which MUST equal the weakest status of `requiresRows` (none if `requiresRows` is empty); adapter tags `@stellar-sac`, `@stellar-sep57` (which adapters it runs against); `@testnet` (needs a network); `@slow`. `catalogueProblems()` enforces this; a scenario can never claim more trust than its inputs.

`onUnknown`: `skip` (default) reports `SKIPPED(unknown-field:<row>)`, never pass/fail; `run-and-label` runs anyway and records the observed behaviour as an `observed` result labelled `@unknown` (used to probe adapters where DTCC has not said what it wants).

### 5.2 Runner (`runPack`, DTC-018)

Targets: `sandbox` (in-memory registry) and `testnet-recorded` (as sandbox, plus `@testnet` scenarios replay the recorded testnet fixture; nothing is re-submitted). Live testnet submission is the spike script, not the runner. Order of gates: tag selection (`not-selected`, `excluded-tag:<tag>`; default excludes `@slow`, plus `@testnet` for `sandbox`), catalogue-only (`not-implemented:<ticket>`), adapter (`other-adapter:<tags>` for adapter-tagged `@testnet` scenarios), unknown row with `onUnknown: skip` (`unknown-field:<row>`). A `run-and-label` scenario with an unknown row is reported `observed`, never pass/fail. A scenario with no required rows is labelled `unknown` (SPEC 1.3). Outcomes: `pass fail skipped observed`. `RunReport` (`src/runner.ts`) carries pack/profile ids and versions, adapter, target, start time, the disclaimer, and per-scenario `{id, outcome, skipReason?, trust, observation?, durationMs}`. Exit code: 0 if no `fail`; 1 if any `fail`; 2 usage error. A skipped or observed scenario is never a failure.

### 5.3 Catalogue at scaffold

36 scenarios (`SC-000..SC-035`): 29 implemented on 2026-11-08 (executable in `src/implementations.ts`, browser-safe), 7 catalogue (SC-013, SC-020, SC-021, SC-030, SC-032, SC-033, SC-034). At scaffold: 1 implemented. Tags used: all seven. By trust tag: `@published` 16, `@inferred` 13, `@unknown` 6, none 1 (SC-000). Adapter tags: `@stellar-sac` 13, `@stellar-sep57` 10; `@testnet` 10; `@slow` 1 (counted 2026-10-31 from the exported pack; the file wins over this sentence).

## 6. Reconciliation (`packages/reconciliation`)

Participant-side. DTC credits ONE consolidated cash payment to the participant's classic account per event (row `corporate_actions.cash-credit-consolidated-classic`). The participant allocates it to client sub-ledgers using the record-date holders. This is NOT an issuer payout planner. Design in `packages/reconciliation/DESIGN.md`; types in `src/types.ts`.

### 6.1 Allocation (normative, DTC-033)

Input: `ParticipantBooks` (wallet -> client or house mapping), record-date `CapturedPosition[]`, `ConsolidatedCredit` (bigint cents), trust label. Output `AllocationPlan` with `rounding: "largest-remainder"`.

1. Group tokens by sub-ledger: client wallet -> its `clientId`; internal wallet -> `HOUSE`. A position at an unmapped address -> refuse with `UNMAPPED_WALLET` (never guess).
2. `T` = total tokens. If `T = 0`: credit 0 -> empty plan; credit > 0 -> refuse `CREDIT_WITHOUT_POSITIONS`.
3. For each sub-ledger `i`: `share_i = floor(credit * t_i / T)`, `rem_i = (credit * t_i) mod T`, bigint arithmetic only.
4. `leftover = credit - sum(share_i)` (0 <= leftover < number of sub-ledgers). Give 1 cent to each of the `leftover` sub-ledgers with the largest `rem_i`; ties broken by sub-ledger id ascending (string order, `HOUSE` is just a string).
5. Lines sorted by sub-ledger id; `checksum` = SHA-256 of canonical JSON of `{eventId, credit, lines}` (keys sorted, bigints as decimal strings).

Invariants: `sum(amount) == credit`; all amounts >= 0; output independent of input order; a client with 0 tokens gets 0; identical input gives identical checksum.

### 6.2 Breaks (DTC-034)

`CREDIT_MISMATCH` (credit differs from `expectedCredit(T, rate)` when a rate is known), `POSITION_MISMATCH` (our positions differ from DTC's Balance export), `UNMAPPED_WALLET`, `SNAPSHOT_SUPPLY_MISMATCH` (supply hash/total differs from an independent supply read), `CLIENT_ID_UNKNOWN`, `CAPTURE_TIME_MISMATCH` (snapshot not at the 20:00 ET instant). The reconciler reports breaks and never fixes them; `clean` is true only with zero breaks and a plan that sums to the credit.

### 6.3 Interface to holders-at-ledger

The `HoldersSnapshot` JSON shape is defined by the holders-at-ledger project, not here. The contract table in `docs/ARCHITECTURE.md` lists it (owner `holders-at-ledger`, consumers `dtc-kit/reconciliation`, Concord) and points to the holders-at-ledger SPEC (`projects/holders-at-ledger/SPEC.md`), which did not exist at scaffold time. `positionsFromHoldersSnapshot(snapshot: unknown, ...)` takes `unknown`, validates it against that project's published schema read from disk (`DTC_HAL_SCHEMA`, default the sibling `holders-at-ledger/schemas/holders-snapshot.schema.json`), and carries no copy of the shape (DTC-032, done 2026-11-08). Positions are in the asset's base units (lossless); claimable balances and liquidity pools are returned as `excluded`, not dropped silently.

## 7. Readiness pack (`readiness-pack/`)

Documents, not code: requirement-to-Stellar matrix, wallet-vendor matrix (trust-tagged), participant checklist, SEP-8 and contract-address note. Generated tables arrive with DTC-036; until then they are hand-written and dated 2026-10-31.

## 8. Error code registry

Validation/lookup: `NOT_A_PARTICIPANT`, `FORBIDDEN_ROLE`, `UNAUTHENTICATED`, `NOT_FOUND`, `VALIDATION`, `ALREADY_REGISTERED`, `CLIENT_ID_UNKNOWN`, `NOT_IMPLEMENTED`, `INVALID_TRANSITION` (409). Sandbox: `INSUFFICIENT_TOKENS` (transfers, overrides), `CAPTURE_NOT_YET`, `ALREADY_PAID`, `INVALID_REASON`. Precheck: the eight in section 2.2. Orders: `WALLET_NOT_COMPLETED`, `WALLET_FAILED_COMPLIANCE`, `FRACTIONAL_QUANTITY`, `INVALID_QUANTITY`, `INSUFFICIENT_TOKENS`, `ONCHAIN_REVERTED`. Reconciliation: `UNMAPPED_WALLET`, `CREDIT_WITHOUT_POSITIONS`, plus the break codes of section 6.2. Core: `InvalidTransition`, `NotImplemented(<ticket>)`.

## 9. Open questions that stay rows (do not resolve in code)

1. **Contract address as Registered Wallet** (`wallet.contract-address-registrable`, unknown). It decides whether a DvP escrow, smart account or any Soroban contract can ever hold DTC tokens. DTC does not validate address text, so a C-address can be typed in; whether DTC's engine can mint to it, and whether the token side accepts it, are separate questions. DTC-028 measures the token side only. The answer from DTCC/SDF is user outreach (G-OUTREACH): the kit drafts the question.
2. **SEP-8 issuer approval server** (`distribution_control.sep-8-approval-fit`, inferred "poor"). See `readiness-pack/sep8-and-contract-wallets.md`. In short: the issuer of a DTC token is DTC's tokenization engine, which configures tokens itself, so a participant-run or third-party approval server has no natural place; SEP-8 is Active v1.7.4 last updated 2022-02-21 [P]; in the SDF repos checked only the demo wallet has client support (path-based check, weak [S]); no custody vendor with a raw-XDR path is evidenced to carry a SEP-8 flow. It could matter only if DTCC picks a classic SEP-8 regulated asset.
3. Token form, compliance mechanism, force-transfer mechanism, root-key holder, finality threshold, fee payer, CUSIP binding, event visibility, vendor certification: the `unknown` rows of `dtc-stellar`.
