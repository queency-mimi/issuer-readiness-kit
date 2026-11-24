# Milestones

Two parts. **Part 1** takes the kit to a working MVP in 20 milestones. **Part 2** is how the project is built after the MVP.

Status words: `done` (merged, checks green, evidence linked), `in progress`, `planned`. Sizes are effort, not dates: S about 1 day, M 2-3 days, L about a week. Every milestone ends with the full check (`bash scripts/check.sh`) green, its evidence committed, and a short public update with a real capture.

Order and scope follow the market analysis of 2026-11-22: the kit sells **verifiable evidence** that an issuer's controls work, so the plan reaches a readiness report on real tokens as early as possible. The two dated pressures are DTC tokenized assets on Stellar (expected 1H 2027) and the SEC transfer-agent record-keeping proposal (2026-09-01).

## What the MVP is

One repository where an issuer can walk a token through five questions and get one evidence pack:

1. Can the wallets that will hold it receive it? (preflight-harness)
2. Does the token behave to SEP-41 / SEP-57? (token-invariants)
3. Did every freeze or forced transfer go through maker-checker approval, with an audit trail? (maker-checker)
4. Who held it at the record date, reconciled to supply? (holders-at-ledger)
5. How ready is the setup against DTC-shaped requirements, row by row, with each row's trust level? (dtc-kit)

MVP is done when all five run from this repo on one shared testnet demo token, the read-only checks also run on real mainnet tokens, one command produces the evidence pack, and one web console shows it. Not in the MVP: mainnet writes (never, gate G-VALUE), DTC certification or compatibility claims (never, gate G-DTCC), custody or KMS integrations, a hosted service.

## Part 1: MVP (20 milestones)

### Phase A: Move in (M1-M7)

Each tool arrives unchanged, with its own checks green, before anything is merged or rewritten.

| # | Milestone | Size | Done when | Status |
|---|---|---|---|---|
| M1 | Monorepo scaffold | S | pnpm + Cargo workspaces, `scripts/check.sh`, ADR-0001, MIGRATION.md, pushed | done (`4b0bb3c`) |
| M2 | dtc-kit moves in | M | 7 packages under `packages/dtc-kit-*`; 260 tests pass; holders-at-ledger schema path rewritten (MIGRATION.md) | done (`e6c4eff`) |
| M3 | preflight-harness and maker-checker move in | M | both under `packages/`; preflight validates against the in-repo ScenarioPack schema, no `../dtc-kit` path; maker-checker 70 tests pass; `contracts/rwa-demo` builds as its own workspace | done: 417 TS tests (415 pass, 1 opt-in skip), contract 4/4; maker-checker's 2 s wall-clock audit test fails under heavy host load, as in the original project |
| M4 | holders-at-ledger moves in | M | 7 crates in the Cargo workspace, `fork-test/` separate; 63 tests offline; Python verifier passes; no `.cache/` in git | planned |
| M5 | token-invariants moves in | M | 6 crates in the workspace; wasm subjects build with `--profile release-wasm`; 69 tests and all 56 planted bugs caught; census re-derives offline | planned |
| M6 | CI | S | GitHub Actions runs `scripts/check.sh` on every push (Node + Rust caches); status badge in README | planned |
| M7 | One set of docs | M | each tool's SPEC, ARCHITECTURE, RISKS, TESTING, PRIOR-ART, SOURCES under `docs/<tool>/`; root `docs/GATES.md` (G-DTCC, G-VALUE, testnet-only writes); every link resolves | planned |

### Phase B: Shared formats (M8-M10)

The three things the evidence pack is made of: hashes, scenario ids, reason codes. One copy each.

| # | Milestone | Size | Done when | Status |
|---|---|---|---|---|
| M8 | One canonical JSON + hash | M | `packages/canonical` (TS) and `crates/canonical` (Rust) produce byte-equal output on one shared vector file; holders-at-ledger, token-invariants and maker-checker use them | planned |
| M9 | One scenario-pack format | M | `packages/scenario-pack` owns the schema and types; dtc-kit and preflight import it; scenario ids namespaced per pack (no `SC-001` clash) | planned |
| M10 | One DTC reason-code list | S | dtc-kit `transfer-precheck` and preflight `DTC_*` codes merged into one taxonomy, each mapped to a requirements-profile row | planned |

### Phase C: One token, five answers, on testnet (M11-M16)

The tools stop running on separate demo setups and share one token. The two remaining merges (M12, M14) land right before the milestone that needs them.

| # | Milestone | Size | Done when | Status |
|---|---|---|---|---|
| M11 | Shared demo token on testnet | S | **OZ version decided first** (0.7.1 as tested today, 0.8.x released 2026-10-20, or both side by side); `contracts/rwa-demo` (SEP-57) deployed by script; contract id, ledger and provenance in `fixtures/testnet/demo-token.json` | planned |
| M12 | Invariant packs become scenario packs | M | token-invariants exports its 61 invariants as a ScenarioPack (unblocks INV-015); the dtc-kit runner loads it | planned |
| M13 | Receive and behave on the demo token | M | preflight captures the regulated-token cases (SEP-57 / OZ permission reads, SEP-8 discovery, DTC registered-wallet reasons, incl. SC-011), with existing receive-check libraries run side by side rather than re-implemented; token-invariants runs its packs against the deployed token (INV-022) | planned |
| M14 | One control-action path | M | maker-checker's SEP-57 builders used by the dtc-kit SEP-57 adapter; dtc-kit sandbox conversion approvals go through maker-checker's policy engine | planned |
| M15 | Controls on the demo token | M | maker-checker approves and executes freeze and forced_transfer; dtc-kit SEP-57 adapter plans run on testnet (DTC-024/026); audit log exported | planned |
| M16 | Record date on the demo token | L | holders-at-ledger snapshots the demo token on testnet at ledger N, `exact` and hash-verified; dtc-kit reconciliation consumes it end to end | planned |

### Phase D: Real tokens and product surface (M17-M20)

| # | Milestone | Size | Done when | Status |
|---|---|---|---|---|
| M17 | Real tokens, read-only | M | receive checks, invariant probes and record-date snapshots run read-only against 2-3 public Stellar RWA tokens; results with provenance in `fixtures/mainnet/`; nothing signed or sent | planned |
| M18 | Evidence pack | L | one command (`irk readiness`) runs the five checks for a token and writes one pack (JSON + HTML, SHA-256 hashed): each line says pass, fail or not checked, with the trust level of the requirement behind it; fixed "DTC-shaped, not DTC-certified" banner; shaped so a transfer agent or auditor can file it (readable format, audit trail, discrepancy handling) | planned |
| M19 | One web console | L | `web/` with five sections and the evidence-pack view; recorded runs offline plus a live testnet tab; works at 375 px; built from the shared kit design tokens | planned |
| M20 | MVP release | M | README, DEMO, PITCH rewritten for the kit; demo video; console deployed; tag `v0.1.0`; release notes list what works and what does not | planned |

### Order and dependencies

```
M1 ─► M2 ─► M3 ─┬─► M6 ─► M7
M1 ─► M4 ─► M5 ─┘
M3,M5 ─► M8 ─► M9 ─► M10 ─► M11 ─► M12 ─► M13 ─► M14 ─► M15 ─► M16 ─► M17 ─► M18 ─► M19 ─► M20
```

M6-M7 (CI, docs) can run alongside Phase B. M11 only needs maker-checker's contract (M3), so the demo token can be deployed early if Phase B stalls.

## Part 2: After the MVP

Targets come from the market analysis (2026-11-22). Dates are targets, not commitments. All outreach is drafted for the user and sent by the user (gate G-OUTREACH). Upstream contributions run continuously across every phase.

| Phase | Target | Contents | Done when |
|---|---|---|---|
| P1 Credibility | Feb-Mar 2027 | Read-only evidence packs for 5 public tokens across classic, SAC and SEP-57 forms; receive-check comparison against the existing libraries; upstream PRs to js-stellar-sdk, wallet-backend / stellar-etl and OpenZeppelin where the kit found gaps; SCF application | 5 public evidence packs with provenance; at least 2 upstream contributions acknowledged; SCF application submitted |
| P2 Design partners | Mar-Jun 2027 | Pilots with one issuer or platform, one wallet or custody vendor, one transfer agent or auditor; feedback tracked in public issues; evidence-pack format revised from partner input | 2-3 named partners running the kit; at least 1 approved written reference |
| P3 DTC re-base | within 14 days of DTCC publishing Stellar requirements | Profile rows move from `inferred` / `unknown` to `published`; requirement-diff report regenerated; the code does not change | every Stellar row has a published source or an explicit `unknown` |
| P4 Harden | Apr-Aug 2027, alongside P2 | Threat model; external review of maker-checker and the evidence pack; fuzzing; `cargo deny`; `pnpm audit`; supply-chain review; deferred merge: one data-lake reader (token-invariants census on holders-at-ledger `sources`, one zstd library) | review report published, findings fixed or tracked |
| P5 Real signers and integrations | Jun-Sep 2027 | SEP-43 wallets, KMS, multisig G accounts, XDR hand-off (MKR-016, MKR-019..022); OZ Relayer adapter; a custody vendor adapter if a partner asks; adopt SDF historical-state and js-stellar-sdk preflight primitives as they ship | one partner executes a testnet control action end to end through its own signer |
| P6 Sustainability decision | Sep-Nov 2027 | Paid readiness-assessment and support offer; Meridian 2027 submission; go / no-go on a hosted evidence service (only if G-LEGAL opens) or a Matching Fund raise | 1-2 paid engagements and a written decision |

**Checkpoint, June 2027:** if no design partner is running the kit, narrow the project to the two parts no one else covered in our searches: the token conformance packs (token-invariants) and the record-date snapshots (holders-at-ledger).
