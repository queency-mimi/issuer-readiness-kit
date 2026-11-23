# issuer-readiness-kit

Open-source tooling for issuers of tokenized assets on Stellar: check that wallets can receive the token, that the token behaves to standard, that control actions (freeze, forced transfer) go through approval, who held the token on a record date, and how ready the whole setup is against DTC-shaped requirements.

**Status (2026-11-22): moving in.** dtc-kit is in (7 packages, 260 tests passing). The other four tools are being moved in from the Stellar Institutional Kit; until each one lands, its code and status live in its original project folder. Plan: [`MILESTONES.md`](MILESTONES.md). Nothing here is audited. Testnet only for anything that writes. DTC-shaped, not DTC-certified.

## The five tools

| Step | Question | Tool | Language | Moves into |
|---|---|---|---|---|
| 1 | Can this wallet receive the token? | preflight-harness | TypeScript | `packages/preflight-harness` |
| 2 | Does the token behave to SEP-41 / SEP-57? | token-invariants | Rust | `crates/token-invariants-*` |
| 3 | Who approved this freeze or forced transfer? | maker-checker | TypeScript | `packages/maker-checker`, `contracts/rwa-demo` |
| 4 | Who held the token at ledger N? | holders-at-ledger | Rust | `crates/holders-at-ledger-*`, `fork-test/` |
| 5 | How ready are we for DTC-style tokenization? | dtc-kit | TypeScript | `packages/dtc-kit-*` (moved in) |

How each source file maps to its new place: [`docs/MIGRATION.md`](docs/MIGRATION.md). Why this is one repo: [`docs/adr/ADR-0001-monorepo.md`](docs/adr/ADR-0001-monorepo.md).

## Layout

```
packages/    TypeScript packages, one pnpm workspace
crates/      Rust crates, one Cargo workspace
contracts/   Soroban contracts with their own Cargo workspace (soroban-sdk pins differ)
fork-test/   separate Cargo workspace (soroban-sdk 29)
web/         one web console for all five tools
fixtures/    recorded testnet / mainnet evidence, each file with provenance
docs/        ADRs, specs, migration map
scripts/     repo-wide scripts (check.sh)
```

## Requirements

- Node >= 22.18 (24 recommended, see `.nvmrc`), pnpm 10.22.0. TypeScript runs directly through Node type stripping, with no build step.
- Rust 1.97.1 with the `wasm32v1-none` target (pinned in `rust-toolchain.toml`).

## Commands

```
pnpm install
pnpm check          # all TypeScript packages: lint, typecheck, tests
bash scripts/check.sh   # everything: TypeScript, Rust workspace, separate Rust workspaces

# dtc-kit
pnpm dtc:profiles check                       # requirement profiles and their row statuses
pnpm dtc:conformance run                      # 36 scenarios against the mock DTC sandbox
pnpm dtc:conformance run --target testnet-recorded --adapter stellar-sac   # against the recorded testnet run
pnpm dtc:sandbox                              # mock DTC registry API on 127.0.0.1:8080
pnpm dtc:export-pack                          # regenerate the ScenarioPack JSON
```

Layout rule: code in `packages/` and `crates/`; each tool's fixtures, schemas, scripts and docs under `fixtures/<tool>/`, `schemas/<tool>/`, `scripts/<tool>/`, `docs/<tool>/`.

## Licence

Apache-2.0. See `LICENSE` and `NOTICE`.
