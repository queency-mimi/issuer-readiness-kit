# Migration map

Where each source project lands. Source paths are relative to `stellar-institutional-kit/projects/`. Status: `planned` until the move is done and the tool's checks pass in this repo, then `done (M#)`.

Never copied: `node_modules/`, `target/`, `.cache/` (holders-at-ledger has 1.6 GB of lake + index there), built `dist/`, `.competitors/`, per-tool `docs/screenshots/` (old per-tool UIs; the console gets new captures in M19).

## Layout rule

Code goes in `packages/` (TypeScript) or `crates/` (Rust), prefixed with the tool name. Everything else a tool owns goes under a folder named after the tool, so two tools never share a path:

| What | Where |
|---|---|
| fixtures and recorded runs | `fixtures/<tool>/` |
| published JSON Schemas | `schemas/<tool>/` |
| tool-level scripts | `scripts/<tool>/` |
| SPEC, ARCHITECTURE, TASKS and the other project docs | `docs/<tool>/` |

Each move keeps the tool's recorded evidence byte-identical. Provenance files keep the script path that was true at capture time.

## TypeScript (`packages/`)

| Source | Target | Package | Status |
|---|---|---|---|
| `dtc-kit/packages/profile-spec` | `packages/dtc-kit-profile-spec` | `@sik/dtc-kit-profile-spec` | done (M2) |
| `dtc-kit/packages/core` | `packages/dtc-kit-core` | `@sik/dtc-kit-core` | done (M2) |
| `dtc-kit/packages/sandbox` | `packages/dtc-kit-sandbox` | `@sik/dtc-kit-sandbox` | done (M2) |
| `dtc-kit/packages/adapter-stellar-sac` | `packages/dtc-kit-adapter-stellar-sac` | `@sik/dtc-kit-adapter-stellar-sac` | done (M2) |
| `dtc-kit/packages/adapter-stellar-sep57` | `packages/dtc-kit-adapter-stellar-sep57` | `@sik/dtc-kit-adapter-stellar-sep57` | done (M2) |
| `dtc-kit/packages/conformance` | `packages/dtc-kit-conformance` | `@sik/dtc-kit-conformance` | done (M2) |
| `dtc-kit/packages/reconciliation` | `packages/dtc-kit-reconciliation` | `@sik/dtc-kit-reconciliation` | done (M2) |
| `dtc-kit/scripts/{capture-fixture,lint}.ts` | `scripts/dtc-kit/` | n/a | done (M2) |
| `dtc-kit/scripts/demo-data.ts` | moves with the web console | n/a | planned (M19) |
| `dtc-kit/fixtures` | `fixtures/dtc-kit/` | n/a | done (M2) |
| `dtc-kit/*.md`, `dtc-kit/readiness-pack` | `docs/dtc-kit/`, `docs/dtc-kit/readiness-pack/` | n/a | copied (M2); links fixed in M7 |
| `preflight-harness/{src,test,schemas,fixtures,scripts}` | `packages/preflight-harness`, `schemas/preflight-harness/`, `fixtures/preflight-harness/` | `@sik/preflight-harness` | planned (M3) |
| `maker-checker/{src,test,schemas,openapi,fixtures,scripts}` | `packages/maker-checker`, `schemas/maker-checker/`, `fixtures/maker-checker/` | `@sik/maker-checker` | planned (M3) |

## Rust (`crates/`, one workspace)

| Source | Target | Status |
|---|---|---|
| `holders-at-ledger/schemas/holders-snapshot.schema.json` | `schemas/holders-at-ledger/` | copied early (M2, dtc-kit reconciliation reads it) |
| `holders-at-ledger/fixtures/golden/robovac-65290900.*` | `fixtures/holders-at-ledger/golden/` | copied early (M2, dtc-kit reconciliation test) |
| `holders-at-ledger/crates/{core,time,sources,assets,reconcile,state,cli}` | `crates/holders-at-ledger-{...}`; `cli/src/main.rs` `include_str!` and `sources/src/csv_baseline.rs` fixture path move to `schemas/holders-at-ledger/` and `fixtures/holders-at-ledger/` | planned (M4) |
| `holders-at-ledger/{fixtures,examples,scripts}` (rest) | `fixtures/holders-at-ledger/`, `scripts/holders-at-ledger/` | planned (M4) |
| `token-invariants/crates/{spec,harness,subject-min,subject-oz,cli,census}` | `crates/token-invariants-{...}`; `cli/src/main.rs` `include_str!` moves to `schemas/token-invariants/` | planned (M5) |
| `token-invariants/{schemas,fixtures,census,scripts}` | `schemas/token-invariants/`, `fixtures/token-invariants/`, `scripts/token-invariants/` | planned (M5) |

## Separate Rust workspaces

| Source | Target | Why separate | Status |
|---|---|---|---|
| `holders-at-ledger/fork-test` | `fork-test/` | soroban-sdk =29.0.1 | planned (M4) |
| `maker-checker/contracts/rwa-demo` | `contracts/rwa-demo` | soroban-sdk 25 + OZ =0.7.1 | planned (M3) |

## Web and docs

| Source | Target | Status |
|---|---|---|
| five `*/web` apps (same stack: Vite 8, React 19, Tailwind v4, kit tokens) | `web/` one console, one section per tool | planned (M19) |
| `holders-at-ledger/site` (Astro + Starlight) | decide: kit docs site or drop | open |
| each project's SPEC, ARCHITECTURE, RISKS, TESTING, PRIOR-ART, SOURCES | `docs/<tool>/` | dtc-kit copied (M2); others with their move; links in M7 |

## Cross-tool links rewritten on the move

| File | Before | After | Status |
|---|---|---|---|
| `packages/dtc-kit-reconciliation/src/holders-source.ts` | `../../../../holders-at-ledger/schemas/holders-snapshot.schema.json` | `schemas/holders-at-ledger/holders-snapshot.schema.json` | done (M2) |
| `packages/dtc-kit-reconciliation/test/holders-source.test.ts` | holders-at-ledger golden fixture by sibling path | `fixtures/holders-at-ledger/golden/` | done (M2) |
| `preflight-harness/scripts/demo-data.ts:37`, `test/smoke.test.ts:144` | `../dtc-kit/packages/conformance/schema/scenario-pack.schema.json` | `packages/dtc-kit-conformance/schema/` (then the shared package, M9) | planned (M3) |

## Known doc mismatch carried over (fix in M7)

dtc-kit's README says the recorded-testnet conformance run gives "28 pass, 1 observed, 0 fail, 7 skipped". The CLI (`pnpm dtc:conformance run --target testnet-recorded --adapter stellar-sac`) gives 27 pass, 1 observed, 0 fail, 8 skipped, both in the original dtc-kit folder and here. The move did not change it.
