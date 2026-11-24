# MVP plan: maker-checker (MKR)

<!-- SPDX-License-Identifier: Apache-2.0 -->

Written 2026-11-08 at the start of the MVP run. Testnet only. Holds no long-lived keys. Drafts in `drafts/` stay unsent (G-OUTREACH).

## 1. Current state (read 2026-11-08, before any change)

| Part | State |
|---|---|
| Docs | SPEC (normative, 13 sections), ARCHITECTURE, RISKS, PRIOR-ART (searched 2026-10-31), 35 tickets in TASKS |
| Schemas, OpenAPI, fixtures | 5 JSON Schemas, `openapi/openapi.yaml` (18 paths), 1 valid + 20 invalid policy fixtures |
| Code | Types only. **Every** core function throws `NotImplemented("MKR-NNN")`: canonicaliser, parser, evaluator, reducer, audit log, stores, auth plan/bundle/assemble, SEP-57 builders, signers, server, CLI commands |
| Tests | 7 smoke tests (scaffold shape) |
| Testnet evidence | none |
| Surface | none |

## 2. MVP definition: what an investor sees in 3-5 minutes

1. **Web approval console, recorded run (works offline from committed data).** A real testnet run of the whole path through the HTTP API: a maker proposes a SEP-57 **freeze** of an address on an OpenZeppelin RWA token deployed on testnet; the policy engine pins "2 checkers + 1 admin"; the maker's attempt to approve their own request is refused (separation of duties); a `mint` proposal is denied by a deny rule; three different approvers attest with SEP-53 signatures; the token operator's Soroban authorisation entry is collected from a second signer (the case Stratum refuses); enforce-mode simulation; envelope signature by the fee payer; submission; `is_frozen` reads `true`. Each step shows the API call, the result and the audit sequence number, and links the transaction to a testnet explorer. Chip: "Testnet run, ledger N, date".
2. **Audit log viewer.** The run's hash-chained log, verified in the browser by the same `AuditLog.verify` code. A "tamper with a copy" control edits one entry in the browser's copy and shows verification failing at that sequence (labelled as a local edit, not data).
3. **Policy viewer and editor.** The example policy and the run's policy rendered as principals, rules, thresholds, limits, windows, `policyHash`. An editor runs the real parser/validator/hasher in the browser; the 20 invalid fixtures can be loaded to show each `PD_*` code; an evaluate panel runs the real `evaluate` on a chosen call (amount, recipient, function) and shows allow/deny and the merged requirement.
4. **Live console (with `pnpm demo:serve` running).** The same flow on testnet, click by click: switch acting user, propose, approve as other users, wait out the cooldown, plan auth, collect the entry, assemble, sign, submit, read `is_frozen` live. Approver and signer keys live in a clearly labelled **wallet simulator** in the demo process (throwaway keys from `Keypair.random()`, never written); the API itself never sees a key. When the server is not running the tab says so; nothing is simulated.
5. **The limit, on every view:** "Rules are enforced off-chain by this software. Anyone holding a signing key can bypass it." plus TESTNET ONLY, DEMO-ONLY and UNAUDITED badges.

## 3. Surface choice

`web/` only (Vite + React + TS strict + Tailwind v4), as recommended: the value is a workflow people click through. No `site/`: the developer reference is `SPEC.md` + `openapi/openapi.yaml` + the CLI; a docs site would repeat them. Revisit at launch (DEPLOY.md).

## 4. Tasks this run (ticket ids from TASKS.md; new ones added there)

| Order | Ticket(s) | Work |
|---|---|---|
| 1 | MKR-001 | `canonical.ts` (RFC 8785 subset), `policyHash`, `hash.ts` on `@noble/hashes` so the core also runs in the browser; vectors + `scripts/jcs_reference.py` |
| 2 | MKR-002 | duplicate-key tokenizer, fail-closed parser, all `PD_*` codes; iterate `EXPECT.json` |
| 3 | MKR-003 | `evaluate` (deny wins, whole tree, limits, windows, merged requirement) |
| 4 | MKR-005, MKR-006 | `StubSigner` (runtime keys, scripted modes); approval statement + SEP-53 verification |
| 5 | MKR-004 | reducer + seeded property test of S1-S4 |
| 6 | MKR-008, MKR-007, MKR-024 | audit log, memory and JSON Lines stores, verify, export |
| 7 | MKR-011, MKR-010, MKR-012, MKR-013, MKR-015 | ScValJson, tree digest, plan, bundle/share verification, merge, assembly (offline tests with SDK-built entries) |
| 8 | MKR-017 | SEP-57 builders |
| 9 | MKR-009, MKR-026, MKR-027 | `RequestService` (projection rebuilt from the log), registry, submitter (mainnet refused) |
| 10 | MKR-025 | `node:http` server for the OpenAPI paths; CLI commands wired |
| 11 | MKR-036 (new) | `contracts/rwa-demo`: OZ `stellar-tokens` 0.7.1 RWA token wrapper for testnet (freeze/pause only path), built locally |
| 12 | MKR-031 | `scripts/e2e-testnet.ts` through the HTTP API, records `fixtures/testnet/e2e-run.json` + audit log + provenance |
| 13 | MKR-037 (new) | `scripts/demo-server.ts` (`pnpm demo:serve`): API + wallet simulator + testnet setup |
| 14 | MKR-038 (new) | `web/` console; `pnpm demo:data` builds its JSON from fixtures |
| 15 | MKR-039 (new) | DEMO.md, PITCH.md, DEPLOY.md, README status, TASKS |

## 5. Left out, and why

| Item | Why |
|---|---|
| Mainnet anything | G-VALUE. Submitter refuses mainnet unless a flag agents never set |
| SEP-43 wallet adapter (MKR-020), wallet matrix (MKR-019) | Needs a human with browser wallets for the conformance rows; the console uses the labelled wallet simulator |
| KMS (MKR-021), XDR hand-off / Stratum (MKR-022), custody API (MKR-023, BLOCKED) | Not on the demo path; the adapter interface is in place |
| Testnet spike on multisig G accounts (MKR-016) | U1 stays [U]; the demo uses single-key accounts and says so |
| SEP-57 Draft vs OZ crate full spike (MKR-018) | The demo token uses OZ 0.7.1 names, which the testnet run exercises for `set_address_frozen`; the full comparison stays open |
| Re-plan on expiry (MKR-014), checkpoints/anchoring (MKR-032), fuzzing at 50k docs (MKR-030), OpenAPI conformance suite (MKR-029) | Hardening; not needed for the core claim. Smaller tests stand in where noted in TASKS |
| Threat model, runbook, review package, Stratum note (MKR-028, 033, 034, 035) | Docs for review/launch, not demo; G-LEGAL/G-OUTREACH for two of them |
| Transfers through the RWA token | OZ RWA transfers need identity-verifier and compliance contracts; the demo token wires only the control path (freeze, pause). Treasury-transfer rules are shown with the real evaluator on the example policy, not on testnet |
| Hosting, npm publishing | Later phase (DEPLOY.md) |

## 6. Outcome (2026-11-08, end of run)

| Ticket | Result |
|---|---|
| MKR-001..009, 010..013, 015, 017, 024..027 | Done (see TASKS for each DONE line and its gaps). 70 TS tests in 10 files pass offline |
| MKR-031 | Done. `pnpm e2e:testnet` recorded `fixtures/testnet/e2e-run.json`: 20 steps, 8 refusals, freeze tx ledger 5,622,041, `is_frozen = true`, 14 audit entries verified |
| MKR-036 | Done. `contracts/rwa-demo` (OZ 0.7.1 wrapper), 4 tests, fmt + clippy clean, wasm committed |
| MKR-037 | Done. `pnpm demo:serve`; driven from the console to a second testnet freeze (ledger 5,622,359) |
| MKR-038 | Done. `web/` builds; checked in a browser at 1440 px (dark) and 390 px (light): recorded run, policy editor/evaluator, audit tamper demo, live console online and offline |
| MKR-039 | Done. DEMO.md, PITCH.md, DEPLOY.md, README status table |
| MKR-014, 016, 018 | Partial (TASKS) |
| MKR-019..023, 028..030, 032..035, 040 | Not done (out of MVP scope, reasons in section 5; MKR-023 and MKR-033 BLOCKED) |

Deviations from the plan, with reasons: no `scripts/demo-offline.ts` (the offline flow is `test/service.test.ts`); no separate `scripts/assemble-testnet.ts` (the e2e covers assembly on testnet); approval signatures are stored in full in the audit log (SPEC 5.4 updated) so the console can re-verify them; a deny-rule pre-check runs before simulation (SPEC 4.2) because a forbidden `mint` on the demo token would otherwise fail in simulation before policy could deny it. The core was written before most tests; key guards were mutation-checked instead.
