# ADR-0001: One monorepo for five issuer tools

Date: 2026-11-22. Status: accepted.

**Context.** dtc-kit, holders-at-ledger, token-invariants, preflight-harness and maker-checker were built as separate projects in the Stellar Institutional Kit (kit ADR-0002: independent projects, no root workspace). Together they answer one issuer's questions in order: can wallets receive the token, does the token behave, are control actions approved, who held it at the record date, how ready is the setup. Kept apart, they had already started to duplicate each other:

- the scenario-pack format (dtc-kit `ScenarioPack`, copied by preflight-harness, not yet mapped from token-invariants `invariant-pack`);
- DTC reason codes (dtc-kit `transfer-precheck.ts` and preflight-harness `DTC_*`);
- SEP-57 control-call builders (dtc-kit `adapter-stellar-sep57` and maker-checker `control/sep57.ts`);
- maker/checker approval (dtc-kit sandbox conversion orders and maker-checker);
- canonical JSON + SHA-256 (holders-at-ledger, token-invariants, maker-checker);
- data-lake reading (holders-at-ledger `sources`, token-invariants census).

Two links were relative paths into sibling folders (dtc-kit reconciliation reads holders-at-ledger's schema; preflight-harness validates against dtc-kit's ScenarioPack schema).

**Decision.** Merge the five into one project, `issuer-readiness-kit`, in one repository:

- TypeScript in one pnpm workspace (`packages/*`, `web`).
- Rust in one Cargo workspace (`crates/*`), with `fork-test/` (soroban-sdk 29) and `contracts/rwa-demo` (soroban-sdk 25, OZ 0.7.1) as separate workspaces, because soroban-sdk versions cannot share a lockfile.
- One release profile for host binaries (unwind, overflow checks) and a `release-wasm` profile for Soroban wasm (opt-level z, abort, LTO), so token-invariants' wasm settings no longer apply to the holders-at-ledger server.
- One web console.

This is consistent with kit ADR-0002 as amended (a project may be an intra-project workspace): the five become one project. Each package and crate keeps a published interface (JSON Schema, CLI, library API), so any one of them can still be lifted out.

**Order.** Scaffold first. Then move each tool in unchanged, with its checks green. Then remove duplicates one at a time, each as its own change.

**Consequences.** One install, one check command, cross-tool changes in one commit. Larger clone; Rust builds need both toolchains' caches. Each tool's existing claims and gates (G-DTCC, G-VALUE, testnet-only writes) carry over unchanged.
