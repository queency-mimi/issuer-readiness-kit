# Migration map

Where each source project lands. Source paths are relative to `stellar-institutional-kit/projects/`. Status: `planned` until the move is done and the tool's checks pass in this repo.

Never copied: `node_modules/`, `target/`, `.cache/` (holders-at-ledger has 1.6 GB of lake + index there), built `dist/`, `.competitors/`.

## TypeScript (`packages/`)

| Source | Target | Package | Status |
|---|---|---|---|
| `dtc-kit/packages/profile-spec` | `packages/dtc-kit-profile-spec` | `@sik/dtc-kit-profile-spec` | planned |
| `dtc-kit/packages/core` | `packages/dtc-kit-core` | `@sik/dtc-kit-core` | planned |
| `dtc-kit/packages/sandbox` | `packages/dtc-kit-sandbox` | `@sik/dtc-kit-sandbox` | planned |
| `dtc-kit/packages/adapter-stellar-sac` | `packages/dtc-kit-adapter-stellar-sac` | `@sik/dtc-kit-adapter-stellar-sac` | planned |
| `dtc-kit/packages/adapter-stellar-sep57` | `packages/dtc-kit-adapter-stellar-sep57` | `@sik/dtc-kit-adapter-stellar-sep57` | planned |
| `dtc-kit/packages/conformance` | `packages/dtc-kit-conformance` | `@sik/dtc-kit-conformance` | planned |
| `dtc-kit/packages/reconciliation` | `packages/dtc-kit-reconciliation` | `@sik/dtc-kit-reconciliation` | planned |
| `dtc-kit/readiness-pack`, `dtc-kit/fixtures` | `docs/dtc-readiness-pack`, `fixtures/dtc-kit` | n/a | planned |
| `preflight-harness/{src,test,schemas,fixtures,scripts}` | `packages/preflight-harness` | `@sik/preflight-harness` | planned |
| `maker-checker/{src,test,schemas,openapi,fixtures,scripts}` | `packages/maker-checker` | `@sik/maker-checker` | planned |

## Rust (`crates/`, one workspace)

| Source | Target | Status |
|---|---|---|
| `holders-at-ledger/crates/{core,time,sources,assets,reconcile,state,cli}` | `crates/holders-at-ledger-{...}` | planned |
| `holders-at-ledger/{schemas,fixtures,examples}` | `crates/holders-at-ledger-*` or `fixtures/holders-at-ledger` | planned |
| `token-invariants/crates/{spec,harness,subject-min,subject-oz,cli,census}` | `crates/token-invariants-{...}` | planned |
| `token-invariants/{schemas,fixtures,census}` | `fixtures/token-invariants`, `docs/` | planned |

## Separate Rust workspaces

| Source | Target | Why separate | Status |
|---|---|---|---|
| `holders-at-ledger/fork-test` | `fork-test/` | soroban-sdk =29.0.1 | planned |
| `maker-checker/contracts/rwa-demo` | `contracts/rwa-demo` | soroban-sdk 25 + OZ =0.7.1 | planned |

## Web and docs

| Source | Target | Status |
|---|---|---|
| five `*/web` apps (same stack: Vite 8, React 19, Tailwind v4, kit tokens) | `web/` one console, one section per tool | planned |
| `holders-at-ledger/site` (Astro + Starlight) | decide: kit docs site or drop | open |
| each project's SPEC, ARCHITECTURE, RISKS, TESTING, PRIOR-ART, SOURCES | `docs/<tool>/` | planned |

## Cross-tool links to rewrite on the move

| File | Today | After |
|---|---|---|
| `dtc-kit/packages/reconciliation/src/holders-source.ts:10-16` | `../../../../holders-at-ledger/schemas/holders-snapshot.schema.json` | path inside this repo |
| `dtc-kit/packages/reconciliation/test/holders-source.test.ts:8,11` | holders-at-ledger golden fixture by relative path | path inside this repo |
| `preflight-harness/scripts/demo-data.ts:37`, `test/smoke.test.ts:144` | `../dtc-kit/packages/conformance/schema/scenario-pack.schema.json` | workspace import |
