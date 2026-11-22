# Milestones

Two parts. **Part 1** takes the kit to a working MVP in 20 milestones. **Part 2** is how the project is built after the MVP.

Status words: `done` (merged, checks green, evidence linked), `in progress`, `planned`. Sizes are effort, not dates: S about 1 day, M 2-3 days, L about a week. Every milestone ends with the full check (`bash scripts/check.sh`) green, its evidence committed, and a short public update with a real capture.

## What the MVP is

One repository where an issuer can walk one testnet token through five questions and get one readiness report:

1. Can the wallets that will hold it receive it? (preflight-harness)
2. Does the token behave to SEP-41 / SEP-57? (token-invariants)
3. Did every freeze or forced transfer go through maker-checker approval, with an audit trail? (maker-checker)
4. Who held it at the record date, reconciled to supply? (holders-at-ledger)
5. How ready is the setup against DTC-shaped requirements, row by row, with each row's trust level? (dtc-kit)

MVP is done when all five run from this repo on one shared testnet demo token, one command produces the readiness report, and one web console shows it. Not in the MVP: mainnet writes (never), DTC certification claims (never, gate G-DTCC), custody or KMS integrations, a hosted service.

## Part 1: MVP (20 milestones)

### Phase A: Move in (M1-M7)

Each tool arrives unchanged, with its own checks green, before anything is merged or rewritten.

| # | Milestone | Size | Done when | Status |
|---|---|---|---|---|
| M1 | Monorepo scaffold | S | pnpm + Cargo workspaces, `scripts/check.sh`, ADR-0001, MIGRATION.md, pushed | done (`4b0bb3c`) |
| M2 | dtc-kit moves in | M | 7 packages under `packages/dtc-kit-*`; 260 tests pass; holders-at-ledger schema path rewritten (MIGRATION.md) | planned |
| M3 | preflight-harness and maker-checker move in | M | both under `packages/`; preflight validates against the in-repo ScenarioPack schema, no `../dtc-kit` path; maker-checker 70 tests pass; `contracts/rwa-demo` builds as its own workspace | planned |
| M4 | holders-at-ledger moves in | M | 7 crates in the Cargo workspace, `fork-test/` separate; 63 tests offline; Python verifier passes; no `.cache/` in git | planned |
| M5 | token-invariants moves in | M | 6 crates in the workspace; wasm subjects build with `--profile release-wasm`; 69 tests and all 56 planted bugs caught; census re-derives offline | planned |
| M6 | CI | S | GitHub Actions runs `scripts/check.sh` on every push (Node + Rust caches); status badge in README | planned |
| M7 | One set of docs | M | each tool's SPEC, ARCHITECTURE, RISKS, TESTING, PRIOR-ART, SOURCES under `docs/<tool>/`; root `docs/GATES.md` (G-DTCC, G-VALUE, testnet-only writes); every link resolves | planned |

### Phase B: Remove duplicates (M8-M13)

One shared piece per concept. Each milestone replaces two or three copies with one and deletes the rest.

| # | Milestone | Size | Done when | Status |
|---|---|---|---|---|
| M8 | One canonical JSON + hash | M | `packages/canonical` (TS) and `crates/canonical` (Rust) produce byte-equal output on one shared vector file; holders-at-ledger, token-invariants and maker-checker use them | planned |
| M9 | One scenario-pack format | M | `packages/scenario-pack` owns the schema and types; dtc-kit and preflight import it; scenario ids namespaced per pack (no `SC-001` clash) | planned |
| M10 | Invariant packs become scenario packs | M | token-invariants exports its 61 invariants as a ScenarioPack (unblocks INV-015); the dtc-kit runner loads it | planned |
| M11 | One DTC reason-code list | S | dtc-kit `transfer-precheck` and preflight `DTC_*` codes merged into one taxonomy, each mapped to a requirements-profile row | planned |
| M12 | One control-action path | M | maker-checker's SEP-57 builders used by the dtc-kit SEP-57 adapter; dtc-kit sandbox conversion approvals go through maker-checker's policy engine | planned |
| M13 | One data-lake reader | M | token-invariants census reads the lake through holders-at-ledger `sources`; one zstd library | planned |

### Phase C: One token, five answers, on testnet (M14-M17)

The tools stop running on separate demo setups and share one token.

| # | Milestone | Size | Done when | Status |
|---|---|---|---|---|
| M14 | Shared demo token on testnet | S | `contracts/rwa-demo` (SEP-57, OZ 0.7.1) deployed by script; contract id, ledger and provenance in `fixtures/testnet/demo-token.json` | planned |
| M15 | Receive and behave on the demo token | M | preflight captures its SEP-57 cases including SC-011; token-invariants runs its packs against the deployed token (INV-022) | planned |
| M16 | Controls on the demo token | M | maker-checker approves and executes freeze and forced_transfer; dtc-kit SEP-57 adapter plans run on testnet (DTC-024/026); audit log exported | planned |
| M17 | Record date on the demo token | L | holders-at-ledger snapshots the demo token on testnet at ledger N, `exact` and hash-verified; dtc-kit reconciliation consumes it end to end | planned |

### Phase D: Product surface (M18-M20)

| # | Milestone | Size | Done when | Status |
|---|---|---|---|---|
| M18 | Readiness report | L | one command (`irk readiness`) runs the five checks for a token and writes one report (JSON + HTML): each line says pass, fail or not checked, and the trust level of the requirement behind it | planned |
| M19 | One web console | L | `web/` with five sections and the report view; recorded runs offline plus a live testnet tab; works at 375 px; built from the shared kit design tokens | planned |
| M20 | MVP release | M | README, DEMO, PITCH rewritten for the kit; demo video; console deployed; tag `v0.1.0`; release notes list what works and what does not | planned |

### Order and dependencies

```
M1 ─► M2 ─► M3 ─┐
M1 ─► M4 ─► M5 ─┼─► M6 ─► M7
                └─► M8 ─► M9 ─► M10 ─► M11 ─► M12 ─► M13
M3 ─► M14 ─► M15 ─► M16 ─► M17 ─► M18 ─► M19 ─► M20
```

Phase A and the start of Phase C (M14) can overlap: the demo token only needs maker-checker's contract in place.

## Part 2: After the MVP

To be filled from the market research (competitor analysis, sentiment, go-to-market) once it is in. Placeholder phases:

1. **Harden:** threat model, external review of maker-checker and the readiness report, fuzzing, `cargo deny`, `pnpm audit`.
2. **Real signers:** SEP-43 wallets, KMS, multisig G accounts, XDR hand-off (maker-checker MKR-016, MKR-019..022).
3. **Real tokens, read-only:** readiness reports for existing mainnet RWA tokens (read-only, no writes).
4. **Design partners:** pilots with issuers, wallet vendors and transfer agents.
5. **Upstream:** SEP drafts and contributions to SDF and OpenZeppelin where the kit found gaps.
6. **When DTCC publishes Stellar requirements:** update the profile data (rows move from `inferred`/`unknown` to `published`); the code does not change.
