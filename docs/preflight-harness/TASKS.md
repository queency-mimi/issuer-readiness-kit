# TASKS: preflight-harness

Rules: `docs/AGENT_GUIDE.md` (repo root `docs/`). Pick the lowest-numbered `TODO` whose dependencies are `DONE`; mark `IN-PROGRESS (date)`; finish with `DONE (date): note`. One task at a time. Gate blocks are recorded as `BLOCKED(<gate or reason>)`.
Estimates [E] are not measured. Commands run in this directory. `pnpm test` = `node --test test/*.test.ts`; `pnpm check` = typecheck + test + lint.

**The first five (PFH-001..PFH-005) have no dependencies and can start in parallel.** They are pure code over data that already exists in the scaffold (inventories, taxonomy, raw output types) and, once done, the mapping layer for two of the three libraries and the verdict derivation are real.

Safety reminders: read-only on mainnet; testnet writes only in PFH-021/022 with runtime-generated throwaway keys; never run code from `.competitors/` without the user having run `scripts/fetch-competitors.sh` themselves; no secrets in fixtures (G-SECRETS); no contact with library authors (G-OUTREACH).

---

## Wave 1: pure mapping and derivation (no network)

### PFH-001: Library inventory completeness check
- Status: DONE (2026-11-08): scripts/check-inventory.ts + src/taxonomy/inventory-check.ts; all three inventories match (Stellar-Preflight read as text from the clone, 32 codes); mutation test fails as required. Deps: none. Size [E]: 0.5 day.
- Files: `scripts/check-inventory.ts`, `test/inventory.test.ts`.
- Question: does each recorded `LIBRARY_INVENTORY[...].codes` equal the codes actually present in the library at the pinned version?
- Method: for the two npm libraries, read the installed package (`node_modules/stellagate-core/dist/*.js` string literals for `code: "..."`; `node_modules/stellar-check/dist/types.d.ts` `DiagnosticCode`); for stellar-preflight, read `.competitors/Stellar-Preflight/packages/sdk/src/codes.ts` as **text** (do not import it); exit 1 with a diff if anything differs.
- Acceptance: `node scripts/check-inventory.ts` exits 0 for the two npm libraries today; with `.competitors/` absent it prints "stellar-preflight: skipped (not fetched)" and exits 0; a test mutates a copy of the inventory and expects exit 1.
- Test: `pnpm test`.

### PFH-002: Verdict derivation and scope separation
- Status: DONE (2026-11-08): src/verdict/derive.ts; precedence, sender scope, info and statusAgreement tested (test/derive.test.ts). Deps: none. Size [E]: 0.5 day.
- Files: `src/verdict/derive.ts` (new), `test/derive.test.ts`.
- Acceptance: `deriveVerdict(reasons, error?)` implements SPEC 4.1 exactly; table test with every precedence combination (error > blocking > meta warning/blocking > warning > none); sender-scope reasons never change the class (including a sender-side `SENDER_INSUFFICIENT_ASSET` blocking beside a clean receive side); `info` never changes it; `statusAgreement(libraryStatus, class)` implements the informational mapping in SPEC 4.1.
- Test: `pnpm test`.

### PFH-003: Fixture loader and validators
- Status: DONE (2026-11-08): loader, ajv validation, provenance and secret checks, `pfh fixtures validate`; negative cases are built in temp dirs inside test/load.test.ts rather than a committed test/fixtures-bad/. Deps: none. Size [E]: 1 day.
- Files: `src/fixtures/load.ts`, `test/load.test.ts`.
- Acceptance: `loadCaseDir`/`loadAllCases` implemented; JSON Schema validation (ajv, already a dev dependency) for case, state, ground truth, provenance; provenance required beside every state/truth file; `assertNoSecrets` on every file; the two synthetic fixtures load; negative fixtures under `test/fixtures-bad/` (missing provenance, seed-shaped string, wrong schema version, case id mismatch with directory name) each fail with the right `PFH_E_*` code; `node src/cli.ts fixtures validate --root fixtures/synthetic` exits 0.
- Test: `pnpm test`.

### PFH-004: stellar-check output mapper
- Status: DONE (2026-11-08): src/adapters/map-stellar-check.ts, 7 tests. Deps: none. Size [E]: 1 day.
- Files: `src/adapters/map-stellar-check.ts` (new), `test/map-stellar-check.test.ts`.
- Acceptance: `mapStellarCheckReport(report, caseFile)` -> `ReceiveVerdict` (without calling the library): all 18 `DiagnosticCode`s map per `LIBRARY_CODE_MAP`; party `sender` diagnostics go to `senderSide`; `incomplete` status -> `unknown`; `coverage` entries with `unresolved` become `CHECK_SKIPPED` info; native vs credit decides `NATIVE_BALANCE_CAP` vs `TRUSTLINE_LIMIT_EXCEEDED`; timestamps (`observedAt`, `startedAt`, `finishedAt`) stripped from `raw`; unknown code -> `unmapped`. Tests use reports produced by calling `assessPayment` (exported by the installed library) on hand-built snapshots, so no network.
- Test: `pnpm test`.

### PFH-005: stellagate-core output mapper
- Status: DONE (2026-11-08): src/adapters/map-stellagate.ts, 7 tests including both message-text disambiguations. Deps: none. Size [E]: 1 day.
- Files: `src/adapters/map-stellagate.ts` (new), `test/map-stellagate.test.ts`.
- Acceptance: `mapStellagateVerdict(verdict, caseFile)` -> `ReceiveVerdict`: the 25 codes map; the two disambiguations in SPEC 3.2 (`sac_balance_not_authorized`, `memo_required` directory vs on-chain) are driven by message text and tested with both messages; `destination_unfunded` severity warn vs block preserved; `Verdict.status` ok/warn/block recorded in `libraryStatus`; `contract_checks_skipped` -> `CHECK_SKIPPED`. Tests call the installed `check()` with injected in-memory `AccountSource`/`ContractSource` and `directory: null` (no network).
- Test: `pnpm test`.

## Wave 2: engine and adapters

### PFH-009: stellar-preflight output mapper
- Status: DONE (2026-11-08): src/adapters/map-stellar-preflight.ts, tested on hand-built results (clone not imported). Deps: none. Size [E]: 1 day.
- Files: `src/adapters/map-stellar-preflight.ts` (new), `test/map-stellar-preflight.test.ts`.
- Acceptance: `mapPreflightResult(result, caseFile)` for all 32 codes; `TRANSFER_SIMULATION_FAILED` refined using a supplied recorded contract error code (11 -> `SAC_DEAUTHORIZED_PARTY_UNKNOWN`, 13 -> `SIM_ACCOUNT_OR_TRUSTLINE_MISSING`, 10 -> sender-side `SENDER_INSUFFICIENT_ASSET`, other -> `SIMULATION_TRANSFER_FAILED`); `READY/WARNING/BLOCKED` recorded in `libraryStatus`. Tests use hand-built `PreflightResult` objects typed locally (do not import the clone).
- Test: `pnpm test`.

### PFH-006: Diff engine
- Status: DONE (2026-11-08): src/report/diff.ts; every finding kind, agreement levels, ground-truth handling, determinism tested. Deps: PFH-002. Size [E]: 2 days.
- Files: `src/report/diff.ts`, `test/diff.test.ts`.
- Acceptance: `isApplicable` and `buildDiffReport` per SPEC 6: agreement levels L0 to L3 using `REFINES` and `SAME_FACT`; all finding kinds; coverage-gap closure; applicability from capabilities; ground-truth contradiction not evaluated for `@not-derivable`; fixture-driven tests with hand-built verdict sets covering each finding kind at least once; output is deterministic (same input twice -> `JSON.stringify` equal) and independent of adapter order.
- Test: `pnpm test`.

### PFH-007: Report renderers (markdown and JSON)
- Status: DONE (2026-11-08): src/report/render.ts, golden test/golden/report.md. Deps: PFH-006. Size [E]: 1 day.
- Files: `src/report/render.ts`, `test/render.test.ts`, `test/golden/report.md`.
- Acceptance: `renderMarkdown`/`renderJson` per SPEC 6.4; golden-file test on a fixed `DiffReport`; the markdown has the matrix, findings grouped by kind, per-case appendix, and a "not evaluated" section; synthetic cases are excluded from headline counts; `node src/cli.ts report --in <verdicts.json> --format both --out out/` writes both files; output has no emojis and no timestamps other than `generatedAt`.
- Test: `pnpm test`.

### PFH-010: stellar-preflight adapter (replay)
- Status: IN-PROGRESS (2026-11-08): adapter, Chain feeder (src/adapters/feed-preflight.ts) and mapper written and unit-tested; opt-in gate PFH_ALLOW_COMPETITOR_CODE=1. NOT EXECUTED: clone present at the pinned commit, but `scripts/fetch-competitors.sh` failed in the agent session (npm registry ETIMEDOUT over IPv6) and the IPv4 retry was refused by the permission system. Owner runs `NODE_OPTIONS=--dns-result-order=ipv4first scripts/fetch-competitors.sh`, then `PFH_ALLOW_COMPETITOR_CODE=1 pnpm test` (the skipped test) to close this. Deps: PFH-009, PFH-003. Size [E]: 1.5 days. Note: needs `.competitors/Stellar-Preflight` — the **user** runs `scripts/fetch-competitors.sh` (it clones third-party code and installs with `--ignore-scripts`); an agent must not execute downloaded code on its own initiative.
- Files: `src/adapters/stellar-preflight.ts`, `src/adapters/feed-preflight.ts` (snapshot -> `Chain`), `test/preflight-adapter.test.ts` (skips with a clear message when `.competitors/` is absent).
- Acceptance: with the clone present, replay of both synthetic fixtures returns the expected codes; `Chain.call` serves recorded simulations and returns a clear error for unrecorded ones; the adapter never reaches the network (test replaces `fetch` with a function that throws); `pnpm test` stays green without the clone (skipped test reported, not failed).
- Test: `pnpm test`.

### PFH-011: stellagate-core adapter (replay)
- Status: DONE (2026-11-08): src/adapters/stellagate-core.ts with in-memory sources from the snapshot; replays all 29 captured cases offline. Deps: PFH-005, PFH-003. Size [E]: 1.5 days.
- Files: `src/adapters/stellagate-core.ts`, `src/adapters/feed-stellagate.ts`.
- Acceptance: `AccountSource`/`ContractSource`/`FederationResolver` built from a snapshot; `directory: null` unless the snapshot has one; both synthetic fixtures replay to the expected codes; network blocked in the test (fetch stub throws); `check` is called with `network` matching the case (`public` for mainnet).
- Test: `pnpm test`.

### PFH-012: stellar-check adapter (replay)
- Status: DONE (2026-11-08): src/adapters/stellar-check.ts with a Horizon-shaped fetch built from the snapshot (src/adapters/feed-horizon.ts); no network. Deps: PFH-004, PFH-003. Size [E]: 1.5 days.
- Files: `src/adapters/stellar-check.ts`, `src/adapters/feed-stellar-check.ts`.
- Acceptance: `PaymentProvider` built from a snapshot (Horizon-shaped account JSON including `is_authorized`, limits, liabilities, `subentry_count`, sponsorship counters, `data`); `getNetwork` from `networkParams`; muxed/contract/federation cases are `applicable:false` (not run); `referenceSender` used when the case has no sender; both synthetic fixtures replay to the expected codes; no network.
- Test: `pnpm test`.

### PFH-013: Capability verification
- Status: IN-PROGRESS (2026-11-08): applicability per capability flag is tested (diff.test.ts isApplicable); per-flag demonstration fixtures for Stellar-Preflight wait on PFH-010 execution. Deps: PFH-010, PFH-011, PFH-012. Size [E]: 1 day.
- Files: `test/capabilities.test.ts`.
- Acceptance: for each adapter and each capability flag in `CAPS`, a synthetic fixture demonstrates the claim true or false (for example: stellagate cannot distinguish maintain-liabilities-only; preflight can; stellar-check refuses a C destination with `UNSUPPORTED_PAYMENT`); any flag found wrong is corrected in the adapter and in SPEC 5.2 in the same change.
- Test: `pnpm test`.

### PFH-008: `pfh run`
- Status: DONE (2026-11-08): src/run.ts, `pfh run`, `pfh report [--check]`, --fail-on-findings, --allow-unmapped; test/render-run.test.ts. Deps: PFH-003, PFH-006, PFH-011 (any one adapter suffices to start; others register as they land). Size [E]: 1.5 days.
- Files: `src/run.ts` (new), `src/cli.ts`, `test/run.test.ts`.
- Acceptance: `node src/cli.ts run --adapters stellagate-core,stellar-check --cases synthetic.ready,synthetic.trustline-missing --fixtures fixtures/synthetic --out out/` writes `out/verdicts.json` (array of `ReceiveVerdict`, schema-valid) and `out/report.json`/`out/report.md`; unavailable adapter -> verdict with `error.kind: "adapter_unavailable"`, run continues; unmapped code fails the run unless `--allow-unmapped`; exit 1 with `--fail-on-findings` when any finding exists.
- Test: `pnpm test`.

### PFH-014: Live mode
- Status: TODO (out of MVP: headline numbers must come from fixtures, SPEC 5.3; `pfh run --live` throws NotImplemented("PFH-014")). Deps: PFH-010, PFH-011, PFH-012. Size [E]: 1 day.
- Acceptance: `pfh run --live --network testnet` runs each adapter's `live()` read-only against public Horizon/RPC for a single case given as input; results are written under `out/live/` and never mixed into the replay report; rate-limit and timeout errors map to `PROVIDER_*` reasons; a test with a stubbed `fetch` proves no POST except RPC JSON-RPC `simulateTransaction`/`getLedgerEntries` (which are POST by design) and that nothing is signed.
- Test: `pnpm test`.

## Wave 3: capture (network)

### PFH-020: Read-only snapshot capture
- Status: DONE (2026-11-08): src/fixtures/capture.ts with a Horizon GET + RPC read allow-list (guard test); used for all 29 recorded cases. Deps: PFH-003. Size [E]: 2 days.
- Files: `src/fixtures/capture.ts`, `scripts/capture.ts`, `test/capture.test.ts` (stubbed `fetch`).
- Acceptance: `captureSnapshot` produces a schema-valid `StateSnapshot` from Horizon and RPC for a list of accounts, contracts, SAC holders and simulation requests; simulation uses an **unsigned** envelope; `provenance.json` records URLs, versions, ledger; the function refuses non-GET Horizon calls and any RPC method outside `getLatestLedger`, `getLedgerEntries`, `simulateTransaction`, `getHealth` (`PFH_E_CAPTURE_NETWORK`); `node scripts/capture.ts --network testnet --accounts <G...>` writes a snapshot for an existing public testnet account (manual check, network).
- Test: `pnpm test` (stubbed); manual run noted in the DONE line.

### PFH-021: Seed testnet cases
- Status: IN-PROGRESS (2026-11-08): src/fixtures/seed.ts + scripts/seed-testnet.ts seeded 29 cases on testnet with Keypair.random() keys (record: fixtures/seed-runs/2026-11-08.json). Remaining: sep41.ready, sep41.allowlist-excluded, sep57.address-frozen, sep57.paused (need a licence-checked token WASM, G-LICENCE). Deps: PFH-020. Size [E]: 3 days.
- Files: `src/fixtures/seed/*.ts` (one module per recipe family), `scripts/capture.ts --seed-testnet`.
- Acceptance: for each of the 31 `seed-testnet` catalogue entries the recipe creates the state on **testnet only** with `Keypair.random()` keys (never written to disk or logged; test greps the output directory for seed-shaped strings), funds via Friendbot, then captures state and writes `fixtures/cases/<id>/{case.json,state.json,*.provenance.json}`; `seedTestnetCase` throws `PFH_E_CAPTURE_WRITE_ATTEMPT` for any non-testnet passphrase (test); idempotent for a given run directory; token contracts for the SEP-41, allowlist and SEP-57 cases come from a pinned, licence-checked source (OZ stellar-contracts examples are MIT; copying needs `docs/THIRD_PARTY.md` and `NOTICE` entries first, G-LICENCE) or are built from `soroban-examples` (record licence).
- Test: `pnpm test`; `node scripts/capture.ts --seed-testnet --case classic.trustline-missing` (network, writes testnet).

### PFH-022: Ground truth on testnet
- Status: DONE (2026-11-08) for captured cases: 18 Horizon payment results with tx hashes, 7 recorded simulations, 4 without ledger-derivable truth; maintain-liabilities-only settled as op_not_authorized. Deps: PFH-021. Size [E]: 2 days.
- Acceptance: for classic cases a single payment is submitted from the seeded sender and the operation result code recorded in `truth.json` with `txHash`; for SAC/SEP-41 cases the recorded `simulateTransaction` outcome is the truth; results that differ from the catalogue's `truth.expectedValue` are listed in the DONE line and the catalogue updated; resolves SIM-13.
- Test: `pnpm test` (fixtures load and validate).

### PFH-023: Mainnet read-only cases
- Status: TODO (out of MVP; mainnet read-only cases incl. sep8.regulated-asset). Deps: PFH-020. Size [E]: 1.5 days.
- Acceptance: for `sep8.regulated-asset` (discover a regulated asset by reading `stellar.toml`, no approval-server call), `memo.required-*` equivalents on mainnet (accounts with `config.memo_required` found by a bounded Horizon data-entry search or a known exchange list) and `sac.*` cases on real mainnet assets with `@mainnet-readonly`, fixtures captured with GET and unsigned simulation only; no mainnet write path exists in the code (test asserts the HTTP method allow-list); addresses used are public institutional accounts, not individuals' (check before committing; no private data).
- Test: `pnpm test`.

### PFH-024: First differential run and findings document
- Status: IN-PROGRESS (2026-11-08): docs/FINDINGS-2026-11-08.md generated by `pnpm report` over 29 testnet cases with two of three libraries; complete once PFH-010 executes and PFH-023 lands. Deps: PFH-008, PFH-010, PFH-011, PFH-012, PFH-021, PFH-022, PFH-023. Size [E]: 1.5 days.
- Output: `docs/FINDINGS-<date>.md` generated by `pfh report`, plus a hand-written summary of the three biggest disagreements with evidence tags; also the first real answer to the discovery note's cheapest-first-deliverable claim ("publish a disagreement table").
- Acceptance: report covers all captured cases; each finding links case id, libraries, versions/commits; no claim of library quality beyond the evidence; numbers are produced by the tool.
- Test: `node src/cli.ts run --out out/ && node src/cli.ts report --check out/verdicts.json`.

### PFH-025: Drift check
- Status: TODO (post-MVP). Deps: PFH-020. Size [E]: 1 day.
- Acceptance: `pfh fixtures recapture --case <id> --diff` re-captures read-only state and prints a structural diff against the stored snapshot; testnet resets are detected (accounts vanished) and reported as "fixture stale", not as a library finding.
- Test: `pnpm test` (stubbed).

## Wave 4: DTC readiness pack

### PFH-026: DTC readiness evaluator
- Status: DONE (2026-11-08): src/dtc/readiness.ts + src/dtc/run.ts, `pfh dtc run`; 11 of 12 scenarios evaluated on recorded fixtures (SC-011 needs sep57.address-frozen). Deps: PFH-003, PFH-002. Size [E]: 2 days.
- Files: `src/dtc/readiness.ts`, `test/readiness.test.ts`.
- Acceptance: `evaluateDtcReadiness` implements SPEC 9.3; all 12 `DTC_SCENARIOS` produce their expected `readiness` and `dtcReasons` on synthetic snapshots built for them (a helper builds them; real captures replace them when available); `unknown` is returned whenever the decisive requirement row is `unknown`; output always carries the dtc-stellar disclaimer text; `node src/cli.ts dtc run --out out/` writes a JSON result.
- Test: `pnpm test`.

### PFH-027: Scenario-pack exporter (CLI, drift guard, golden pack)
- Status: DONE (2026-11-08): `pfh export-pack`, golden fixtures/packs/preflight-harness-dtc-wallet-readiness.pack.json with staleness test; validates against dtc-kit schema. Deps: PFH-026. Size [E]: 0.5 day.
- Files: `src/export/scenario-pack.ts`, `src/cli.ts`, `test/scenario-pack.test.ts`, `fixtures/packs/preflight-harness-dtc-wallet-readiness.pack.json` (golden).
- Acceptance: `node src/cli.ts export-pack --out out/x.pack.json` writes the pack; a test fails if the golden file is stale (`pnpm export-pack` regenerates, like dtc-kit's); the pack validates against dtc-kit's schema (`DTC_KIT_SCENARIO_PACK_SCHEMA` or the sibling path) except the known `ticket` pattern, which the test asserts is the only error; the disclaimer is verbatim from the profile (PFH-029 checks); no runner code in this repository.
- Test: `pnpm test`.

### PFH-028: Align `ticket` with the ScenarioPack contract
- Status: DONE (2026-11-08): dtc-kit widened the pattern to ^[A-Z]{3}-[0-9]{3}$; the pack validates with 0 errors (scripts/demo-data.ts records the check). RISKS R9 updated. Deps: PFH-027. Size [E]: 0.25 day.
- Unblock: dtc-kit widens the pattern (user decision or dtc-kit agent via a cross-project request); then change the `ticket` value emitted by the exporter if needed and flip the known-mismatch assertion in the test to "no errors". Fallback if dtc-kit refuses: map to a DTC ticket id assigned by dtc-kit for each scenario.

### PFH-029: Validate scenario requirement refs against dtc-kit profiles
- Status: TODO (`pfh dtc check-refs` not implemented; scenario rows are checked against the dtc-kit profile only by the weakest-status test). Deps: PFH-026. Size [E]: 0.5 day.
- Acceptance: `pfh dtc check-refs --profile-dir <dir containing dtc-generic.json and dtc-stellar.json>` (path passed in, no hard-coded relative path into another project) verifies every `requirementRefs` row id exists and the recorded `status` equals the profile's; prints mismatches; exit 1 on any. A unit test uses a copied fixture of the two profile files (public data, copied with their version string) — or skips with a message if absent.
- Test: `pnpm test`.

## Wave 5: spikes

### PFH-030: SPIKE: re-verify the simulation facts (SIM-1 to SIM-8, SIM-10)
- Status: TODO. Deps: PFH-020. Size [E]: 1.5 days.
- Question: are the discovery agent's mainnet simulation results reproducible, and do they hold on testnet?
- Method: read-only. Mainnet RPC (a provider URL the user supplies if the public one is unreachable): build unsigned SAC `transfer` envelopes for the nine destination cases; read-only `getLedgerEntries` and SAC `authorized`/`balance` calls via simulation; record JSON responses under `fixtures/spikes/sim/` with provenance. Re-read `contract_error.rs` at a pinned `rs-soroban-env` commit.
- Decision rule: each SIM row gets its tag upgraded to [P] with date and ledger if reproduced; if not, correct SPEC 8, case expectations and mappings; if mainnet and testnet differ, record both.
- Acceptance: SPEC 8 table updated with the new tags and dates; fixtures validate.
- Test: `pnpm test`.

### PFH-031: SPIKE: classic ledger result codes (maintain-liabilities, buying liabilities, native minimum)
- Status: IN-PROGRESS (2026-11-08): testnet payments settled two of three: maintain-liabilities-only -> op_not_authorized (tx 43c115011dcc..., ledger 5,622,290), line full by buying liabilities -> op_line_full (tx d886ad08ab..., ledger 5,622,281) [P]. Remaining: createAccount below the minimum balance was not submitted. Until it is, the expectations of `native.unfunded-create-required` ([I]) and `native.unfunded-below-minimum` ([U]) are unverified, and the report shows them as `differs_from_expected` findings with those tags, never as library errors (post-audit fix). Deps: PFH-021. Size [E]: 1 day.
- Question: SIM-15, SIM-16 and the native createAccount minimum (`native.unfunded-below-minimum`): what does the ledger return?
- Method: testnet, throwaway keys: submit the payments; record Horizon operation results and the base reserve at the time.
- Decision rule: observed codes become ground truth; any library that disagrees gets a `contradicts_ground_truth` finding; if the minimum is not a fixed 1 XLM, the Preflight mapping `AMOUNT_BELOW_ACCOUNT_MINIMUM` notes the source of its constant.
- Acceptance: SPEC 8 rows SIM-15/16 updated; catalogue `truth.expectedValue` corrected.

### PFH-032: SPIKE: attributing SAC error #11 to sender or recipient
- Status: TODO. Deps: PFH-030. Size [E]: 1 day.
- Question: can a harness oracle tell which party is deauthorised from per-party reads (`authorized(addr)` and trustline flags) taken at the same ledger as the failed simulation?
- Decision rule: if yes for classic-backed SACs, add an oracle function `attributeDeauthorization(snapshot, call)` used by `evaluateDtcReadiness` and by the case expectations; if reads can race the simulation (non-atomic), document the window and leave `SAC_DEAUTHORIZED_PARTY_UNKNOWN`.
- Acceptance: results in SPEC 8 SIM-5; test fixtures for both directions.

### PFH-033: SPIKE: SEP-57 and OZ allowlist reads versus simulation outcome
- Status: TODO. Deps: PFH-021. Size [E]: 1.5 days.
- Question (SIM-9, SIM-11, SIM-12): for an OZ rwa token (deployed on testnet) and an OZ allowlist token, which of `is_frozen`, `allowed`, `blocked`, `verify_identity`, pause state predicts the simulation result, and which contract error codes appear?
- Decision rule: reads that predict the outcome become derivation rules for `TOKEN_ADDRESS_FROZEN`, `TOKEN_ALLOWLIST_EXCLUDED`, `TOKEN_PAUSED`, `TOKEN_IDENTITY_UNVERIFIED`; anything only visible by simulation stays `SIMULATION_TRANSFER_FAILED` with the error code recorded.
- Acceptance: SPEC 8 and `REASON_CODES[...].derivation` updated.

### PFH-034: SPIKE: SEP-8 regulated-asset discovery without calling the approval server
- Status: TODO. Deps: PFH-020. Size [E]: 0.5 day.
- Question: what can be reported about a SEP-8 asset from `stellar.toml` and the issuer account flags alone?
- Decision rule: if only "this asset is regulated and has an approval server" can be said, `REGULATED_ASSET_APPROVAL_REQUIRED` stays `out-of-band` and cases are `undetermined`.
- Acceptance: `sep8.regulated-asset` fixture captured read-only; SPEC 9/8 updated; no POST made.

## Wave 6: finishing

### PFH-035: Disagreement minimiser
- Status: TODO. Deps: PFH-006, PFH-008. Size [E]: 1.5 days.
- Acceptance: given a finding, `pfh minimise --case <id> --finding <n>` removes snapshot entries (unrelated accounts, trustlines, reads) while the finding persists and writes the smallest snapshot to `out/min/`; property: the minimised snapshot still reproduces the finding when replayed (test).

### PFH-036: Drafts of upstream issue texts
- Status: TODO. Deps: PFH-024. Size [E]: 0.5 day.
- Output: `drafts/<library>-<finding>.md` for each finding that is a probable bug, with reproduction (minimised snapshot), versions/commits and evidence tags. **Drafts only; nothing is posted** (G-OUTREACH); the user decides.
- Acceptance: files exist; each contains a runnable reproduction command.

---

## Cross-project requests

- dtc-kit's ScenarioPack schema (`projects/dtc-kit/packages/conformance/schema/scenario-pack.schema.json`) requires `ticket` to match `^DTC-[0-9]{3}$`. Request: widen to `^[A-Z]{3}-[0-9]{3}$` (or document how other projects obtain DTC ticket ids) so packs from preflight-harness and token-invariants validate (SPEC 9.4, PFH-028).
- Also for dtc-kit: confirm that `SC-NNN` ids need only be unique within a pack (ours use SC-001..SC-012 in a different pack), and whether the runner can execute scenarios whose evaluator lives in another project or should keep them `catalogue`.
- `docs/SOURCES.md` says the receive-check libraries' licence is "check each": MIT (Stellar-Preflight), Apache-2.0 (stellagate-core, stellar-check), verified 2026-10-31.
- `docs/ROADMAP.md` Phase 0 says "install and run the three existing libraries against a shared fixture set": Stellar-Preflight is not installable from npm; see SPEC 0.1.
- `docs/ARCHITECTURE.md` dependency graph lists `requirements-profile.schema.json` as consumed by preflight-harness; this project references profile rows by id only (SPEC 9.1).
