# dtc-kit: MVP plan

<!-- SPDX-License-Identifier: Apache-2.0 -->

Date: 2026-11-08. Goal: a working, investor-presentable MVP of the DTC Participant Kit. Hosting and npm publishing come later (`DEPLOY.md`); this plan makes them mechanical.

> **DTC-shaped, not DTC-certified.** Gate G-DTCC: every Stellar requirement in this kit is `inferred` or `unknown`; nothing here is DTC-compatible, and the demo says so on every screen.

## 1. Current state (before this plan, scaffold of 2026-10-31)

* pnpm workspace, 7 packages, TypeScript by type stripping. `pnpm check` green: 25 tests (profile schema, catalogue lint, smoke SC-000) [P: README, 2026-10-31].
* Data that is real: two requirement profiles (`dtc-generic` 28 rows: 25 published + 3 inferred; `dtc-stellar` 18 rows: 6 inferred + 12 unknown), each row with source URL, date, confidence. 36-scenario catalogue tagged by weakest row. Two capability matrices.
* Stubs (`NotImplemented`): every core reducer (DTC-003..010), trust label (DTC-002), sandbox registry and every HTTP route except `/v1/health` (DTC-011..016), scenario runner (DTC-014), both adapters' plans (DTC-021, DTC-025), conformance runner (DTC-018), reconciliation (DTC-032..034), profile CLI and diff (DTC-001, DTC-031), fixture capture (DTC-020).
* Nothing run on testnet. No demo surface. No DEMO/PITCH/DEPLOY docs.
* Since scaffold, `holders-at-ledger` has written its SPEC and `schemas/holders-snapshot.schema.json` plus a real mainnet golden snapshot, so DTC-032 is no longer blocked.

## 2. MVP definition: what an investor sees in 3-5 minutes

**Participant Sandbox console** (`web/`, Vite + React + TS strict + Tailwind v4, static build from committed data):

1. **Hero + gates**: one sentence on what the kit is; gate notices visible at the top (G-DTCC "DTC-shaped, not DTC-certified", TESTNET-ONLY, fictional institutions, not legal advice). One headline figure: how many of the requirements DTCC has actually published for Stellar (0 of 18 rows) versus generic DTC rows (25 of 28), from the profile files.
2. **Requirement profiles**: both profiles as a filterable table: status (published / inferred / unknown, icon + word), confidence, statement, source links with retrieval dates, `basis` for inferred rows, `unblockedBy` for unknown rows.
3. **Run the scenarios** (in the browser, live): the five scripted sandbox scenarios and the conformance pack run against the real `MockDtcRegistry` code compiled into the page (the same TypeScript the Node server runs). Step-by-step request/response log, pass/fail per step, trust label per scenario. A "replay recorded run" toggle shows the committed `pnpm demo:data` report from the Node HTTP server for comparison.
4. **Stellar testnet evidence**: the SAC adapter's force-transfer plan (`[clawback, payment]`, atomic) and what actually happened on testnet: a recorded run with throwaway keys (transaction hashes, ledger numbers, date, links to a testnet explorer), including the negative variant where the destination is deauthorised and the whole transaction fails, the "authorise a trustline that does not exist" failure (SC-029), and the 0.5-token payment that a classic asset cannot refuse (SC-031). Labelled "testnet run, ledger N, date". SEP-57 shown as offline plans only, labelled not-yet-run-on-testnet.
5. **Readiness report**: conformance results grouped pass / fail / skipped / observed, each line with its trust label; skipped lines name the unknown row that blocks them (`SKIPPED(unknown-field:...)`) and what would unblock it. Downloadable JSON and JUnit.
6. **Reconciliation**: a sandbox interest event, one consolidated cash credit per participant, allocated to client sub-ledgers by largest remainder (sum equals credit, checksum shown), plus one deliberate CREDIT_MISMATCH break.

## 3. Surface choice

Web app only, as recommended. The kit's value is the interactive "run your readiness against a labelled requirement model" loop; a docs site would duplicate SPEC.md. Developer docs stay in the Markdown files (README, SPEC, readiness-pack). If a docs site is wanted later it is a DEPLOY.md item.

Design: kit foundation copied into `web/src/styles/kit` and `web/src/ui/kit`, project slug `dtc-kit` (accent from `design/projects.json`). Skills: design-taste-frontend, high-end-visual-design, frontend-design, dataviz (for the status bar chart), full-output-enforcement.

## 4. Tasks (this session)

| Id | Ticket(s) | Task | Acceptance |
|---|---|---|---|
| M1 | DTC-001, 002, 031 (diff only) | Profile CLI, `trustLabel`, `diffProfiles`; split `resolveProfile` into a browser-safe module | tests; `pnpm profiles check` prints 28 = 25 + 3 and 18 = 6 + 12 |
| M2 | DTC-003..010 | All core reducers with table tests | no `NotImplemented` in `packages/core` |
| M3 | DTC-011..016 | Sandbox: pure request handler shared by the Node server and the browser, registry, corporate actions, CSV | route tests; five scenarios pass in-process and over HTTP |
| M4 | DTC-014 | Scripted runner with pluggable transport (HTTP or in-process) | `FIVE_SCENARIOS` pass in CI |
| M5 | DTC-020, 021, 022 (SAC half), 023 (partial) | SAC adapter plans with XDR built by `@stellar/stellar-sdk`; testnet spike script with throwaway keys; fixtures + provenance; fixture replay tests | plans test; fixtures committed with tx hashes; replay test offline |
| M6 | DTC-025 | SEP-57 adapter offline plans | plans test |
| M7 | DTC-018, 019, part of 030 | Conformance runner + CLI + JUnit; implement sandbox scenarios; testnet scenarios report `observed` from the recorded fixtures | `pnpm conformance run` exit 0, report carries disclaimer and trust per line |
| M8 | DTC-032, 033, 034 | Reconciliation: HoldersSnapshot mapping (validated against holders-at-ledger's published schema), allocation with 10,000-case property test, breaks | tests |
| M9 | demo | `pnpm demo:data` writes `web/src/data/demo.json` with provenance; `web/` console | `pnpm build` offline |
| M10 | docs | DEMO.md, PITCH.md, DEPLOY.md, README status, TASKS statuses | read-through; every number traced |

## 5. Explicitly left out (and why)

* **SEP-57 on testnet** (DTC-024, DTC-026, SC-020, SC-032): needs an OZ RWA token contract built and deployed; the contract toolchain build is out of this session's disk/time budget. The console shows SEP-57 plans only and marks the testnet run "not yet available".
* **Event decoders** (DTC-027, SC-021), **contract-address spike** (DTC-028, SC-030), **vendor pack** (DTC-037, SC-033/034): observation work on testnet; catalogue-only, reported `skipped not-implemented:<ticket>`.
* **docker-compose** (DTC-017): no docker on this machine; stays BLOCKED.
* **Re-verification of published rows** (DTC-006) and **watcher** fetches (DTC-031 network half): need careful manual re-reading of DTCC pages; rows keep their recorded `retrievedAt` dates and the console shows them.
* **Vendor refresh and outreach drafts** (DTC-029), **SEP-8 spike** (DTC-038), **readiness-pack generator** (DTC-036), **runbook** (DTC-040), **ScenarioPack ADR** (DTC-039): not on the demo path.
* **Any mainnet write, any real DTCC system, any real sanctions data**: forbidden (G-VALUE, G-DTCC, G-LEGAL).

## 6. Outcome (2026-11-08, end of session)

| Task | Result |
|---|---|
| M1 profile CLI, trust, diff | Done |
| M2 core reducers | Done; no `NotImplemented` left anywhere in `packages/` |
| M3/M4 sandbox, handler, runner | Done; five scenarios pass in-process and over HTTP |
| M5 SAC adapter + testnet spike | Done; 15 testnet transactions recorded (ledgers 5,621,465-5,621,491); replay test offline |
| M6 SEP-57 plans | Done (plans only; not run on testnet) |
| M7 conformance runner | Done; 29 of 36 scenarios executable; sandbox 25 pass / 11 skipped; recorded testnet 28 pass / 1 observed / 7 skipped |
| M8 reconciliation | Done (DTC-032/033/034); CLI (rest of DTC-035) not built |
| M9 console | Done; builds offline; checked by hand in Chrome, both themes, 1440 px and 390 px |
| M10 docs | DEMO.md, PITCH.md, DEPLOY.md, README, TASKS, SPEC, TESTING, RISKS updated |

Deviation from the plan: the runner's testnet target is `testnet-recorded` (replay of the recorded spike) rather than a live testnet target; live submission stays in `pnpm testnet:spike`. Reason: a pitch must not depend on Friendbot and testnet availability, and the evidence is the same transactions.
