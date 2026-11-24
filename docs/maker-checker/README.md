# maker-checker (`@sik/maker-checker`, ticket prefix MKR)

**DEMO-ONLY. Testnet only. Not audited. Holds no long-lived keys. Not a signer, not a wallet, not a custodian.**

A headless **policy and audit layer for multi-party Soroban authorisation**. It sits on top of existing signers (wallets, KMS/HSM, custody APIs, or a UI such as `tupui/stellar-stratum` through XDR hand-off) through an adapter interface, and provides:

1. `PolicyDoc`: canonical JSON (RFC 8785 subset) with a content hash; roles maker / checker / admin; thresholds; spend limits; contract and function allow-lists; time windows; expiry.
2. An approval state machine `proposed -> approved -> signed -> submitted | rejected | expired | cancelled` with separation of duties: a maker can never approve their own request, nobody counts twice, and (if the policy says so) the maker cannot contribute a signature.
3. Collection of the Soroban authorisation entries that addresses other than the transaction source must sign, each checked against the plan, then enforce-mode simulation (the case Stratum refuses today).
4. An append-only, hash-chained audit log; request state is rebuilt from the log alone.
5. SEP-57 control-action builders (freeze, unfreeze, forced_transfer, pause, unpause).
6. An HTTP API (`openapi/openapi.yaml`), a CLI (`mkr`), and a web approval console (`web/`) that is a client of that API.

**Limit you must not forget:** this layer's rules are enforced off-chain, by this software. Anyone holding a signing key can bypass it. It records who proposed and approved what, in a tamper-evident log; it does not replace on-chain controls. See `SPEC.md` section 0 and `RISKS.md` ("Review before anyone holds keys").

## Status (2026-11-08)

| Area | State | Evidence |
|---|---|---|
| Canonical JSON, policyHash (MKR-001) | Working | 41 vectors; byte-equal to an independent Python reference on the example policy and 300 generated documents |
| PolicyDoc parser and validator (MKR-002) | Working | all 20 invalid fixtures give their code; fails closed |
| Policy evaluation (MKR-003) | Working | 31 table cases, every deny reason, determinism under shuffling |
| Approval state machine, SoD S1-S4 (MKR-004/006) | Working | transition tests, 10,000-sequence property test, SEP-53 tamper tests |
| Audit log, file store, export (MKR-007/008/024) | Working | tamper-class tests, two-process conflict test, golden CSV |
| Auth plan, share verification, merge, assembly (MKR-010..013, 015) | Working for single-node entries | offline tests per failure mode; testnet run |
| SEP-57 builders (MKR-017) | Working | names and order checked against OZ stellar-tokens 0.7.1; freeze executed on testnet |
| Service, HTTP API, CLI, submitter (MKR-009, 025..027) | Working | full flow over HTTP in tests; projection rebuild identical; mainnet submit refused |
| Testnet end to end (MKR-031) | Recorded | `fixtures/testnet/e2e-run.json`: 20 steps, 8 refusals, freeze tx in ledger 5,622,041, `is_frozen = true` |
| Demo RWA token (MKR-036) | DEMO-ONLY | `contracts/rwa-demo`, OZ 0.7.1 wrapper, freeze/pause path only |
| Web console (MKR-038) | Builds, checked in a browser | recorded run, live console (re-driven end to end after the audit fixes: freeze tx `87775496…f233a7`, testnet ledger 5,628,989, `is_frozen = true` read back; S3 refusal shown), policy editor, audit tamper demo. No horizontal overflow at 375, 390 or 414 px on any view |
| Re-plan on expiry (MKR-014) | Partial | re-plan exists; approval invalidation on digest change not tested |
| Multisig G accounts, delegates entries (MKR-016, MKR-040) | Not yet | single-key accounts only; delegate entries refused at assembly |
| SEP-43 wallet, KMS, XDR hand-off adapters (MKR-019..022) | Not yet | stubs throw `NotImplemented` with the ticket id; the demo uses a labelled wallet simulator |
| Custody API adapter (MKR-023) | BLOCKED | vendor access (G-OUTREACH) |
| Checkpoints/anchoring, fuzzing, OpenAPI conformance suite (MKR-032, 030, 029) | Not yet | anchored-head verification exists; no anchor implementation |
| Threat model, runbook, review package (MKR-028, 034, 033) | Not yet | MKR-033 BLOCKED on G-LEGAL |

### Fixed after the independent audit (2026-11-08)

Policy view overflow on phones; "refused before any signature" wording (now "scripted attempts, each refused, none reached the chain"; two had a key sign first); `/demo/*` wallet routes now run after bearer authentication, and the server refuses a foreign Host header (DNS rebinding) and a foreign browser Origin; `mkr serve --tokens <map.json>` for caller identity, with a startup warning when absent and a note when `--rpc` is missing; a second G-VALUE guard in `createRpcSubmitter`; friendbot retry and timeout, `--network-family-autoselection-attempt-timeout` in the demo scripts, retries for account reads and simulation on the flaky shared testnet RPC; Live tab CORS for ports 4173-4182 and 5173-5182; a Live console bug where proposing while another request was selected snapped the selection back (approvals landed on the wrong request).

### Known limits (not fixed)

- `mkr serve` without `--tokens` has no caller identity; maker, approver and cancel identities are trusted as sent (SEP-53 approval attestations still bind a key). Local development only.
- The demo wallet simulator signs for any local process that passes the Host, Origin and `demo:<principal>` checks. Run `demo:serve` on your own machine only.
- The `--allow-mainnet-submit` flag still exists as a human opt-in (second guard added; the flag is not compiled out).
- `pnpm audit --prod` did not complete in the audit sandbox (registry timeouts); dependency advisories are unchecked. The committed `rwa-demo.wasm` was not rebuilt from source by the auditor. Mutation-test results (S1, S3 guards) were not re-run by the auditor.
- The Live tab cannot work from an https-hosted console; hosted demos use the recorded tabs.

Test count: 70 TypeScript tests in 10 files (`pnpm test`) plus 4 contract tests (`pnpm contract:test`), all passing on 2026-11-08. The core was written before most of its tests in this run; key guards were mutation-checked (see TASKS MKR-004).

## Demo

`DEMO.md` has the commands and a 3-5 minute script. In short: `pnpm install && pnpm --dir web install && pnpm --dir web build && pnpm --dir web preview`, then optionally `pnpm demo:serve` for the live tab. `PITCH.md` is the one-page brief; `DEPLOY.md` the launch checklist; `MVP-PLAN.md` what this run set out to do.

## Read order

`../../docs/AGENT_GUIDE.md`, `../../docs/GATES.md`, `../../docs/CONVENTIONS.md`, then here: `SPEC.md` (normative), `ARCHITECTURE.md`, `BUILD-PLAN.md`, `TASKS.md`, `TESTING.md`, `RISKS.md`, `PRIOR-ART.md`, `SOURCES.md`, `AGENTS.md`.

## Layout

```
SPEC.md ARCHITECTURE.md BUILD-PLAN.md TASKS.md TESTING.md RISKS.md PRIOR-ART.md SOURCES.md AGENTS.md
MVP-PLAN.md DEMO.md PITCH.md DEPLOY.md
src/            canonical, hash, errors; policy/ workflow/ auth/ audit/ control/ signer/ service/ api/ net/; cli.ts
schemas/        JSON Schema 2020-12: policy-doc, action-request, audit-entry, auth-bundle, provenance
openapi/        openapi.yaml (OpenAPI 3.1)
contracts/      rwa-demo: DEMO-ONLY OZ RWA wrapper deployed by the testnet scripts
fixtures/       policies/ (1 valid, 20 invalid), testnet/ (recorded e2e run + provenance), wasm/ (rwa-demo.wasm)
test/           10 test files + helpers (offline RPC stand-in, seeded PRNG)
scripts/        lint, jcs_reference.py, e2e-testnet, demo-server, build-demo-data, lib/ (testnet world, wallet simulator)
web/            approval console (Vite + React + Tailwind v4)
```

## Commands

```
pnpm install              # Node >=22.18 (24 tested), pnpm 10.22.0, own pnpm-lock.yaml
pnpm typecheck            # tsc --noEmit (strict)
pnpm test                 # node --test test/*.test.ts (no network)
pnpm lint                 # SPDX headers, TODO needs a ticket id, no secret-seed-shaped strings, JSON parses
pnpm check                # all three
pnpm contract:test        # cargo test for contracts/rwa-demo (offline, -j 2)
pnpm contract:build       # stellar contract build, copies the wasm to fixtures/wasm/
pnpm e2e:testnet          # TESTNET: records a new fixtures/testnet/e2e-run.json (about 3 min)
pnpm demo:serve           # TESTNET: API + wallet simulator on 127.0.0.1:8787 for the live console
pnpm demo:data            # rebuild web/src/data/demo.json from fixtures (no network)
node src/cli.ts --help    # mkr CLI
```

Dependencies: runtime `@stellar/stellar-sdk` 17.4.0, `@noble/hashes` 2.4.0 (audited SHA-256); dev `ajv`, `ajv-formats`, `typescript`. Contract: `soroban-sdk` 25, OpenZeppelin `stellar-tokens` 0.7.1 (MIT, used as a dependency).

## Verified on

2026-11-08, Linux, Node v24.18.0, pnpm 10.22.0, Rust 1.97.1, Stellar CLI 25.2.0: `pnpm check` (typecheck ok, 70 tests pass, lint ok), `pnpm contract:test` (4 pass), `cargo fmt --check` and `cargo clippy --all-targets -- -D warnings` (clean), `pnpm --dir web build` (ok), `pnpm e2e:testnet` (recorded run above), `pnpm demo:serve` driven from the console.

## Licence

Apache-2.0 (repo root `LICENSE`). SPDX header in every source file. No third-party code is copied (`docs/THIRD_PARTY.md`); OZ stellar-tokens is a Cargo dependency.
