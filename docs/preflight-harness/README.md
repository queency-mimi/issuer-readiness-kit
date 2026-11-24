# preflight-harness (`@sik/preflight-harness`, ticket prefix PFH)

**MVP (2026-11-08). Read-only on mainnet. Never signs or submits on mainnet. Not a new receive-check library.**

A differential test harness for the Stellar libraries that answer "can this destination receive this asset?", plus a DTC registered-wallet readiness scenario pack. Demo: `DEMO.md`. Investor brief: `PITCH.md`. Later-phase hosting/publishing: `DEPLOY.md`. Plan and scope: `MVP-PLAN.md`. First findings: `docs/FINDINGS-2026-11-08.md`.

- Replays recorded Stellar testnet states through **stellagate-core** and **stellar-check** (npm, pinned) and, with the owner's opt-in, **salkimos/Stellar-Preflight** (pinned git clone), each through its own injection point, offline.
- Normalises every answer to a `ReceiveVerdict` with typed reason codes from a superset taxonomy (70 codes) and reports three kinds of finding: libraries disagree, a library is silent or abstains, a verdict differs from the case author's trust-tagged expectation, or a verdict contradicts a recorded ledger or simulation result (0 in the 2026-11-08 run).
- Exports 12 DTC readiness scenarios in dtc-kit's ScenarioPack format (validates against dtc-kit's published schema with 0 errors as of 2026-11-08), tagged by the weakest requirement row. Nothing here is DTC-compatible (G-DTCC).

## Status (2026-11-08, verified by running the commands in "Verified on")

| Area | Status | Evidence |
|---|---|---|
| Taxonomy, library inventories and code maps | Working | `pnpm check-inventory`: all three inventories match source (Stellar-Preflight read as text) |
| Fixture loader, schemas, provenance, secret guard | Working | `node src/cli.ts fixtures validate` |
| Testnet seeding + read-only capture + ground truth | Working (ran once) | 29 cases, ledgers 5,622,268 to 5,622,359, `fixtures/seed-runs/2026-11-08.json`; 18 Horizon payment results, 7 recorded simulations, 4 without ledger-derivable truth |
| stellagate-core adapter | Working | replays all 29 cases offline |
| stellar-check adapter | Working | replays all 29 (classic scope; muxed/contract cases reported as not applicable) |
| Stellar-Preflight adapter, `Chain` feeder, mapper | Written and unit-tested, **not executed** | clone present at `4599d9c77c66`; its dependency install did not complete (registry timeout, then the retry was refused by the agent permission system); needs the owner to run `scripts/fetch-competitors.sh` and set `PFH_ALLOW_COMPETITOR_CODE=1` |
| Diff engine, markdown/JSON reports, `pfh run`, `pfh report --check` | Working | `pnpm report`: 5 disagreements, 14 gaps, 2 differ from authored expectation, 0 contradict recorded results, 1 note; deterministic |
| DTC readiness evaluator, `pfh dtc run`, `pfh export-pack` | Working | 11 of 12 scenarios evaluated (SC-011 needs a SEP-57 token) |
| Web report (`web/`) | Working, static | `pnpm demo:data && cd web && pnpm build` |
| Live mode (`pfh run --live`) | Not implemented | PFH-014 (throws `NotImplemented`) |
| SEP-41 / allowlist / SEP-57 / SEP-8 cases | Not captured | PFH-021 (remaining), PFH-023, PFH-033, PFH-034 |
| Drift check, minimiser, upstream issue drafts | Not started | PFH-025, PFH-035, PFH-036 |

Simulation facts the cases rest on are in `SPEC.md` section 8 with trust tags; the testnet run settled the maintain-liabilities-only result (`op_not_authorized`). Re-verification spikes: PFH-030 to PFH-034.

Not verified: `pnpm audit` (root and web) timed out against registry.npmjs.org in the audit and in this session (IPv6 route). Lockfiles pin versions and have no install-script packages; run `NODE_OPTIONS=--dns-result-order=ipv4first pnpm audit --prod` before any publish step.

## Read order

`../../docs/AGENT_GUIDE.md`, `../../docs/GATES.md`, `../../docs/CONVENTIONS.md`, then `SPEC.md` (normative), `ARCHITECTURE.md`, `BUILD-PLAN.md`, `TASKS.md`, `TESTING.md`, `RISKS.md`, `PRIOR-ART.md`, `SOURCES.md`, `AGENTS.md`.

## Layout

```
SPEC.md ARCHITECTURE.md BUILD-PLAN.md TASKS.md TESTING.md RISKS.md PRIOR-ART.md SOURCES.md AGENTS.md
MVP-PLAN.md DEMO.md PITCH.md DEPLOY.md docs/FINDINGS-2026-11-08.md
src/taxonomy/    codes.ts (70 codes), library-maps.ts (inventories + mappings), inventory-check.ts
src/adapters/    three adapters, feeders (Horizon-shaped JSON, Stellar-Preflight Chain), mappers, probe, registry
src/fixtures/    catalogue.ts (34 cases), load.ts, validate.ts, capture.ts, seed.ts
src/verdict/     derive.ts        src/report/  diff.ts, render.ts, facts.ts      src/run.ts  src/cli.ts (pfh)
src/dtc/         scenarios.ts (12), readiness.ts, run.ts                src/export/  scenario-pack.ts
schemas/         case, state-snapshot, ground-truth, receive-verdict, provenance
fixtures/        cases/ (29 recorded testnet cases), synthetic/ (2), packs/ (golden ScenarioPack), seed-runs/
scripts/         lint, check-inventory, seed-testnet, capture, demo-data, make-synthetic-fixtures, fetch-competitors.sh
test/            15 test files, golden/report.md
web/             Vite + React + TS strict + Tailwind v4 static report (own package.json and lockfile)
out/             last `pnpm report` output (verdicts.json, report.json, report.md)
```

## Commands

```
pnpm install              # Node >=22.18 (24 tested), pnpm 10.22.0, own pnpm-lock.yaml
pnpm typecheck            # tsc --noEmit (strict, noUncheckedIndexedAccess, erasableSyntaxOnly, verbatimModuleSyntax)
pnpm test                 # node --test test/*.test.ts  (no build step)
pnpm lint                 # SPDX headers, TODO needs a ticket id, no secret-seed-shaped strings, JSON parses
pnpm check                # all three
node src/cli.ts adapters  # which libraries are installed/available and how to install the rest
node src/cli.ts taxonomy  # the 70 reason codes     node src/cli.ts catalogue   # the 34 cases
node src/cli.ts fixtures validate                   # schema + provenance + secret checks
pnpm report                                         # pfh run over fixtures/cases -> out/
node src/cli.ts dtc run                             # DTC readiness scenarios -> out/dtc-readiness.json
pnpm export-pack                                    # golden ScenarioPack
pnpm demo:data && (cd web && pnpm install && pnpm build)   # web report -> web/dist
pnpm seed:testnet                                   # network, TESTNET writes with throwaway keys; not needed for the demo
node scripts/make-synthetic-fixtures.ts             # regenerate fixtures/synthetic/
scripts/fetch-competitors.sh                        # YOU run this to get Stellar-Preflight (network, third-party code)
```

## Verified on

2026-11-08, Linux, Node v24.18.0, pnpm 10.22.0: `pnpm check` (typecheck ok; 86 tests, 85 pass, 0 fail, 1 skipped = the Stellar-Preflight opt-in test; `lint ok`; inventory check ok for all three libraries), `pnpm demo:data` (29 captured cases, 22 findings, 11/12 DTC scenarios), `cd web && pnpm build` (tsc + vite, ok), `node src/cli.ts report --in out/verdicts.json --check out/report.json` (matches). `scripts/fetch-competitors.sh` was attempted: the clone is at the pinned commit, but the SDK dependency install timed out on the npm registry (IPv6 unreachable), and the IPv4 retry was refused by the agent permission system, so Stellar-Preflight was not executed.

2026-10-31 (scaffold): `pnpm install --frozen-lockfile` ok; both npm libraries install and load.

## Licence

Apache-2.0 (repo root `LICENSE`). Libraries under test keep their own licences (MIT, Apache-2.0); none is copied.
