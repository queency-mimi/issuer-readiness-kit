# dtc-kit: DTC Participant Kit

Lets a DTC participant, a wallet vendor or a Stellar issuer test readiness **before DTCC publishes its Stellar requirements**. Gate G-DTCC: the DTCC Stellar spec is unpublished, so every dependency on it is a row in a requirements profile with a status `published | inferred | unknown`, a source URL, a date and a confidence. When DTCC publishes, the data changes, not the code.

> **DTC-shaped, not DTC-certified.** This kit models public DTCC and SEC material (no-action letter, FAQ, Learning Center help pages, product page). It does not implement DTCC's API, does not use login-gated documents, and its outputs must never be described as "DTC-compatible". Fictional institutions only. Not legal advice.

## Status (2026-11-08)

Working MVP, not deployed or published. Demo: [DEMO.md](DEMO.md). Brief: [PITCH.md](PITCH.md). Later phase: [DEPLOY.md](DEPLOY.md). Plan: [MVP-PLAN.md](MVP-PLAN.md).

| Area | State | Evidence |
|---|---|---|
| Requirement profiles + CLI | Working; **generic `published` rows not yet re-verified** | `pnpm profiles check`: dtc-generic 28 rows (25 published, 3 inferred), dtc-stellar 18 rows (0 published, 6 inferred, 12 unknown). The 25 were read 2026-10-29 via discovery notes (5 re-read 2026-10-31; SEC letter not re-fetched). Shown on the Overview tile. DTC-006 TODO |
| Core state machines (wallet, controls, precheck, conversion, override, capture, cash allocation) | Working | table tests over every (state, event) pair; DST tests |
| Mock DTC registry + HTTP API | Working (in-memory) | all routes implemented; five scripted scenarios pass in-process and over HTTP |
| SAC adapter | Working, testnet-proven | plans with unsigned envelopes; 15 testnet transactions recorded (ledgers 5,621,465-5,621,491); atomic override shown at 5,621,476 / 5,621,480 |
| SEP-57 adapter | Plans only | **not yet run on testnet** (DTC-024, DTC-026) |
| Conformance runner + pack | Working | sandbox: 25 pass, 0 fail, 11 skipped of 36; with recorded testnet + SAC: 28 pass, 1 observed, 0 fail, 7 skipped |
| Reconciliation (allocation, breaks, HoldersSnapshot mapping) | Working | 10,000-case property test; one test per break code; golden mainnet snapshot mapped |
| Web console (`web/`) | Builds, static | `cd web && pnpm build`; runs the registry and runner in the browser |
| docker-compose | **Not run** | no docker on the build machine (DTC-017) |
| Watcher, readiness-pack generator, vendor pack, event decoders, C-address spike, SEP-8 spike | Not built | TASKS.md DTC-027..031, 036..040 |
| DTC certification or compatibility | **Never claimed** | gate G-DTCC |

Nothing here has been run against a real DTC environment. No mainnet reads or writes.

## Packages

| Package | What it is |
|---|---|
| `packages/profile-spec` | JSON Schema 2020-12 for requirements profiles; `profiles/dtc-generic.json` (28 rows: 25 published, 3 inferred) and `profiles/dtc-stellar.json` (18 rows: 6 inferred, 12 unknown); loader/validator |
| `packages/core` | Chain-neutral DTC state machines: wallet registration, transfer pre-check, conversion to book entry, chill/freeze, force-transfer, record-date capture, cash allocation; trust labels; the `ChainAdapter` port |
| `packages/sandbox` | Mock DTC registry and participant simulator: fake institutions, own HTTP API shape (pure handler shared with the browser), simulated clock, corporate actions, CSV, five scripted scenarios; docker-compose scaffold (not run) |
| `packages/adapter-stellar-sac` | Classic asset / SAC: AUTH_REQUIRED + authorised trustlines as allowlist, clawback as burn, why a force transfer needs clawback and an issuer payment in one transaction; capability matrix |
| `packages/adapter-stellar-sep57` | T-REX style token: `forced_transfer`, freeze, pause; capability matrix |
| `packages/conformance` | ScenarioPack format (+ JSON Schema), runner + CLI (JSON, JUnit), 36 tagged scenarios (29 executable) |
| `packages/reconciliation` | Participant-side allocation of DTC's consolidated cash credit to client sub-ledgers, break detection, and the `HoldersSnapshot` mapping (validated against holders-at-ledger's schema, not redefined here) |
| `web/` | Participant Sandbox console (Vite + React + TS + Tailwind v4, static build from `web/src/data/demo.json`) |
| `fixtures/` | Recorded Stellar testnet run with provenance |
| `readiness-pack/` | Requirement-to-Stellar matrix, wallet-vendor matrix, participant checklist, SEP-8 and contract-address note |

## Read order (for agents)

1. `../../docs/AGENT_GUIDE.md`, `../../docs/GATES.md`, `../../docs/CONVENTIONS.md`, `../../docs/ARCHITECTURE.md`
2. This README, [SPEC.md](SPEC.md) (normative), [ARCHITECTURE.md](ARCHITECTURE.md), [BUILD-PLAN.md](BUILD-PLAN.md), [TASKS.md](TASKS.md), [RISKS.md](RISKS.md), [PRIOR-ART.md](PRIOR-ART.md), [TESTING.md](TESTING.md), [SOURCES.md](SOURCES.md), [AGENTS.md](AGENTS.md)
3. Take the lowest-numbered `TODO` ticket whose dependencies are `DONE`. Open next (2026-11-08): DTC-006 (re-verify published rows), DTC-024/026 (SEP-57 on testnet), DTC-029, DTC-038, DTC-041/042 (publication).

## Commands

Toolchain: Node 24 (v24.18.0), pnpm 10.22.0, TypeScript 7.0.2 (type stripping, no build step for the packages).

```
pnpm install
pnpm check            # lint + typecheck + test
pnpm lint             # SPDX headers, ticket references, ticket-less TODOs (no ESLint configured)
pnpm typecheck        # tsc --noEmit over all packages
pnpm test             # node --test "packages/*/test/*.test.ts"
pnpm profiles check   # validate profiles; `pnpm profiles table dtc-stellar` lists rows
pnpm conformance run  # pack against the sandbox; --adapter stellar-sac --target testnet-recorded for the recorded testnet run
pnpm export-pack      # regenerate packages/conformance/packs/dtc-kit-readiness.pack.json
pnpm sandbox          # HTTP sandbox on 127.0.0.1:8080 (HOST=0.0.0.0 to expose)
pnpm demo:data        # regenerate web/src/data/demo.json (no network)
pnpm testnet:spike    # LIVE Stellar testnet run with throwaway keys (network; writes fixtures/)
cd web && pnpm install --ignore-workspace && pnpm build   # the console
```

## Verified on

2026-11-08, Node v24.18.0, pnpm 10.22.0, TypeScript 7.0.2, Linux, from `projects/dtc-kit`:

| Command | Outcome |
|---|---|
| `pnpm check` | OK: lint ok (43 tickets), typecheck clean, 260 tests, 260 pass, 0 fail |
| `pnpm demo:data` | OK: 5/5 scripted over HTTP; sandbox 25 pass / 0 fail / 11 skipped; testnet-recorded 28 pass / 1 observed / 0 fail / 7 skipped |
| `pnpm testnet:spike` | OK once, 2026-11-08 09:44 UTC: 15 transactions on Stellar testnet (11 succeeded, 4 rejected as each step expected) |
| `cd web && pnpm build` | OK: tsc clean, vite build (676 kB JS, 178 kB gzip). No automated UI tests; checked by hand and by an independent Playwright pass (2026-11-08) |
| `docker compose ... up` | **NOT RUN**: docker is not installed (DTC-017) |

Network use this session: Stellar testnet (Friendbot, Horizon) for the spike only; npm registry/store for installs. Nothing written to mainnet; no account created anywhere.

## Layout notes

This project is its own pnpm workspace (`packages/*`); there is no root workspace across projects (ADR-0002). Source files carry `// SPDX-License-Identifier: Apache-2.0`. No keys, no mainnet, no custody (G-SECRETS, G-VALUE).
