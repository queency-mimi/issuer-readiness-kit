# Issuer Readiness Kit

**Verifiable evidence that a tokenized asset on Stellar is ready to issue.**

[![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)
![Node >= 22.18](https://img.shields.io/badge/node-%3E%3D22.18-339933.svg)
![Rust 1.97.1](https://img.shields.io/badge/rust-1.97.1-orange.svg)
![Status: pre-release](https://img.shields.io/badge/status-pre--release-lightgrey.svg)

The Issuer Readiness Kit is open-source tooling for issuers, transfer agents and auditors of tokenized assets on Stellar. It walks one token through five questions and records the answer to each as evidence that can be re-checked:

| # | Question | Tool |
|---|---|---|
| 1 | Can the wallets that will hold the token receive it? | preflight-harness |
| 2 | Does the token behave as SEP-41 / SEP-57 require? | token-invariants |
| 3 | Did every freeze or forced transfer go through maker-checker approval, with an audit trail? | maker-checker |
| 4 | Who held the token at the record date, reconciled to supply? | holders-at-ledger |
| 5 | How ready is the setup against DTC-shaped requirements, row by row? | dtc-kit |

> [!IMPORTANT]
> **Pre-release.** The kit is being assembled from five standalone tools. Nothing here is audited. Anything that writes to a network runs on testnet only. Requirement profiles are **DTC-shaped, not DTC-certified**: the kit makes no claim of DTC certification or compatibility.

## Status

| Tool | Language | Location | Status |
|---|---|---|---|
| dtc-kit | TypeScript | `packages/dtc-kit-*` | In repo: 7 packages, 260 tests passing |
| preflight-harness | TypeScript | `packages/preflight-harness` | In repo: 87 tests (1 opt-in skip), read-only |
| maker-checker | TypeScript, Soroban | `packages/maker-checker`, `contracts/rwa-demo` | In repo: 70 tests; demo contract builds and passes its 4 tests as its own workspace |
| holders-at-ledger | Rust | `crates/holders-at-ledger-*`, `fork-test/` | Planned (M4) |
| token-invariants | Rust | `crates/token-invariants-*` | Planned (M5) |

The full plan to a working MVP, a single evidence pack from one command and a web console to view it, is in [`MILESTONES.md`](MILESTONES.md).

## Getting started

### Requirements

- Node.js 22.18 or later (24 recommended; see `.nvmrc`). TypeScript runs directly through Node's type stripping, so there is no build step.
- pnpm 10.22.0
- Rust 1.97.1 with the `wasm32v1-none` target, pinned in `rust-toolchain.toml` (needed from M4 onwards)

### Install and verify

```sh
pnpm install
pnpm check              # lint, typecheck and tests for all TypeScript packages
bash scripts/check.sh   # every check in the repository, TypeScript and Rust
```

## Usage

### DTC readiness (dtc-kit)

```sh
pnpm dtc:profiles check       # requirement profiles and the trust level of each row
pnpm dtc:conformance run      # 36 scenarios against the mock DTC sandbox
pnpm dtc:sandbox              # mock DTC registry API on 127.0.0.1:8080
pnpm dtc:export-pack          # regenerate the ScenarioPack JSON
```

Replay the recorded testnet run through the Stellar Asset Contract adapter:

```sh
pnpm dtc:conformance run --target testnet-recorded --adapter stellar-sac
```

Each requirement row carries a trust level: `published` (from a public DTC source), `inferred` (derived from published material) or `unknown`. Every result reports the weakest level behind it, so a pass is never stronger than the requirement it was checked against.

### Wallet receive checks (preflight-harness)

```sh
pnpm pfh adapters             # the receive-check libraries compared side by side
pnpm pfh run --out out/pfh    # replay the 29 recorded testnet cases through each library
pnpm pfh dtc run              # DTC registered-wallet scenarios on the same cases
```

Read-only: nothing is signed or submitted. Stellar-Preflight is compared only after you clone it yourself with `packages/preflight-harness/scripts/fetch-competitors.sh`.

### Control-action approvals (maker-checker)

```sh
pnpm mkr policy validate fixtures/maker-checker/policies/example-treasury.policy.json
pnpm mkr audit verify fixtures/maker-checker/testnet/e2e-audit.jsonl
pnpm mkr:contract:test        # the demo SEP-57 token (contracts/rwa-demo)
```

Demo only: testnet, unaudited, never holds keys.

## Repository layout

```
packages/    TypeScript packages (one pnpm workspace)
crates/      Rust crates (one Cargo workspace)
contracts/   Soroban contracts (separate Cargo workspace; soroban-sdk pins differ)
fork-test/   fork tests (separate Cargo workspace; soroban-sdk 29)
web/         web console for all five tools
fixtures/    recorded testnet and mainnet evidence, each file with provenance
schemas/     published JSON Schemas
scripts/     repository-wide and per-tool scripts
docs/        architecture decisions, per-tool specifications, migration map
```

Code lives in `packages/` and `crates/`, prefixed with the tool name. Everything else a tool owns sits under a folder named after it (`fixtures/<tool>/`, `schemas/<tool>/`, `scripts/<tool>/`, `docs/<tool>/`), so no two tools share a path.

## Documentation

- [`MILESTONES.md`](MILESTONES.md): roadmap to the MVP and beyond
- [`docs/adr/ADR-0001-monorepo.md`](docs/adr/ADR-0001-monorepo.md): why the five tools share one repository
- [`docs/MIGRATION.md`](docs/MIGRATION.md): where each source file lands, and its move status
- [`docs/dtc-kit/`](docs/dtc-kit/), [`docs/preflight-harness/`](docs/preflight-harness/), [`docs/maker-checker/`](docs/maker-checker/): each tool's specification, architecture, risks and testing

## License

Licensed under the [Apache License 2.0](LICENSE). See [`NOTICE`](NOTICE) for attributions.
