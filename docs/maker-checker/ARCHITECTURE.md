# ARCHITECTURE: maker-checker

Normative interfaces are in `SPEC.md`; this file explains modules, data flow and the decisions behind them. Status 2026-11-08: core implemented (see README status table); signer adapters other than `StubSigner` remain stubs. Added in the MVP run: `src/service/` (RequestService, submitter), `src/net/rpc.ts` (RPC wiring), `src/api/client.ts`, `src/audit/file-store.ts` and `export.ts` (Node-only parts split from the browser-safe `log.ts`), `contracts/rwa-demo`, `web/` (a client of the API).

## Position in the programme

`docs/ARCHITECTURE.md` lists maker-checker as independent: it consumes existing signers and SEP-57 control actions, and owns the `PolicyDoc` canonical JSON contract. It depends on no other project. Other projects depend on it only through published interfaces: `schemas/policy-doc.schema.json`, `openapi/openapi.yaml`, the CLI, and the library API. It never imports another project's source (ADR-0002).

## Layers

```
 CLI (src/cli.ts)        HTTP API (src/api/)               <- thin; same library underneath
        \                   /
         service layer (RequestService, PolicyRegistry, Submitter)      MKR-009/026/027
        /        |         |            \
 policy/       workflow/   auth/         audit/                          pure cores
 parse         machine     plan          log + stores
 hash          (reducer)   bundle        export/checkpoint
 evaluate                  assemble
        \        |         |            /
          canonical.ts, hash.ts, errors.ts                               MKR-001
                       |
 control/sep57.ts (builders)            signer/ (adapter interface, stub, wallet, kms, handoff, custody)
```

## Modules

| Path | Responsibility | Pure? | Ticket |
|---|---|---|---|
| `src/canonical.ts`, `src/hash.ts` | RFC 8785 subset, SHA-256, domain tags | yes | MKR-001 |
| `src/policy/parse.ts` | fail-closed parse + semantic validation, `PD_*` | yes | MKR-002 |
| `src/policy/evaluate.ts` | allow/deny + merged requirement; time and spend are inputs | yes | MKR-003 |
| `src/workflow/machine.ts` | event-sourced reducer, SoD invariants | yes | MKR-004 |
| `src/workflow/approval.ts` | approval statement, SEP-53 verification | yes (crypto only) | MKR-006 |
| `src/audit/*` | hash chain, stores, export, checkpoints | store I/O only | MKR-007/008/024/032 |
| `src/auth/*` | plan, bundle, merge, assemble | network via injected `AuthDeps` | MKR-010..015 |
| `src/control/sep57.ts` | control-action builders | yes | MKR-017 |
| `src/signer/*` | adapter interface and adapters | I/O at the edge | MKR-005/020..023 |
| `src/service/*` | orchestration, projection from audit | I/O | MKR-009/026/027 |
| `src/api/*` | node:http server | I/O | MKR-025 |

## Decisions

**D1. The audit log is the source of truth; request state is a projection.** Every state change is an event appended to the hash-chained log; the current record of a request is `fold(applyEvent, events)`. Consequences: no second store can disagree with the log; rolling spend limits are computed from the same events; recovery after a crash is "replay the log". Cost: projection rebuild time grows with the log (indexed snapshots are an optimisation, not a source of truth).

**D2. Pure cores, injected edges.** `evaluate`, `applyEvent`, canonicalisation, share verification and merging take time, RPC and attestation verification as inputs. This makes the security-critical logic testable without a network and allows property tests (TESTING.md).

**D3. Content addressing everywhere.** The policy is its hash; the request id is its hash; audit entries chain by hash; the plan id is a hash. An approval binds to ids, so it cannot be moved to another request or survive a change.

**D4. Deny by default, fail closed.** Unknown fields, ambiguous lists, undecodable amounts, partial rule coverage of a call tree, missing windows intersections: all deny. Idea from Perch's IR [P: `perch-ir` header, read 2026-10-31], reimplemented.

**D5. Off-chain enforcement is stated as off-chain.** The layer gates workflow and records evidence; it cannot stop a key holder. SPEC section 0 and RISKS R-S1 say so; the docs never call the layer "enforcement" of custody.

**D6. No key material crosses any interface.** Adapters return signatures; the kit stores digests of signatures; no API field is named or typed to carry a secret. `StubSigner` keys are generated at runtime and never persisted (G-SECRETS); lint checks for seed-shaped strings.

**D7. Signers are reached through one interface with asynchronous results.** Wallets prompt humans; custody consoles approve later. `signed | pending | declined` plus `poll` covers both. The kit tracks capability `clearSigning` and records it in the audit.

**D8. Stratum by hand-off, not by embedding.** Stratum is a browser dapp with no server API [P]; the integration is an XDR hand-off adapter. We do not fork or vendor it (MIT permits it, but there is no need and its UI is not our product).

**D9. Parallel collection by merge, not by lock.** Bundles merge commutatively (SPEC 7.6), so independent signers can work offline on the same plan and a coordinator merges whatever arrives. The SDK's own helper is sequential [P: `assembled_transaction.d.ts`].

**D10. Independence from OpenZeppelin smart accounts.** Policies are not compiled to on-chain rules. An operator may additionally configure OZ smart-account policies (`simple_threshold`, `weighted_threshold`, `spending_limit` exist in `packages/accounts/src/policies`, v0.8.0, per `notes/screen_I4_wallets.md`); this layer neither requires nor generates them. Perch (which lowers a policy IR onto OZ accounts) is a different layer, noted in PRIOR-ART.

## Data flow for the multi-signer path

See SPEC section 1 and section 7. Key invariants: the expiry is fixed in the plan before anyone signs; the tree digest approved by checkers equals the tree in the signed entries; the transaction is re-simulated in enforce mode after all entries are in; the source account signs last.

## Failure and recovery

Process dies mid-append: the file store detects a partial last line and refuses to append until repaired (MKR-007). RPC down: planning/assembly return `MKR_E_SIMULATION_FAILED` or a network error without state change. Entries expire: re-plan discards shares, keeps approvals if the digest is unchanged (SPEC 7.8). Policy expires mid-request: request completes under the pinned requirement unless cancelled (SPEC 5.6).

## Scaling and size

Not a goal at scaffold. A single process with a JSON Lines log is expected to be adequate for treasury-scale volumes (tens to thousands of requests per day [E, not measured]); the store interface allows a database.
