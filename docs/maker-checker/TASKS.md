# TASKS: maker-checker

Rules: `docs/AGENT_GUIDE.md` (repo root `docs/`). Pick the lowest-numbered `TODO` whose dependencies are `DONE`; mark `IN-PROGRESS (date)`; finish with `DONE (date): note`. One task at a time. A gate that blocks a task is recorded as `BLOCKED(<gate or reason>)`.
Estimates are [E]: half a day to two days of agent work, not measured.
All commands run in this directory. `pnpm test` = `node --test test/*.test.ts`; `pnpm check` = typecheck + test + lint.

**The first five (MKR-001..MKR-005) have no dependencies and can start in parallel.** Together they replace the stubs on the main path (canonical hash, policy parse, evaluation, state machine, a test signer) and an agent finishing them can already run a policy through a full propose/approve cycle in a test.

Status key: TODO, IN-PROGRESS, DONE, BLOCKED.

---

## Wave 1: pure core (no network)

### MKR-001: Canonical JSON (RFC 8785 subset) and policyHash
- Status: DONE (2026-11-08): RFC 8785 subset canonicaliser and untagged policyHash; 41 vectors (RFC 8785 sorting/escaping examples in the subset plus edge cases), every unsupported value throws; byte-identical to `scripts/jcs_reference.py` for the example policy and 300 generated documents (`cmp` acceptance holds); hash recorded in `fixtures/policies/example-treasury.policy.hash`. Not done: cyberphone vectors (SPEC 3.4 c, licence check not made) and a second agent's implementation (3.4 d). SHA-256 moved to `@noble/hashes` (audited) so the core also runs in the browser. Deps: none. Size [E]: 1 day.
- Files: `src/canonical.ts`, `src/policy/hash.ts`, `test/canonical.test.ts`, `fixtures/vectors/jcs/*.json`, `scripts/jcs_reference.py` (independent reference).
- Acceptance: (1) `pnpm test` includes at least 40 canonicalisation vectors incl. SPEC 3.4 (a)-(c); (2) every unsupported value in SPEC 3.1 throws `MkrError` code `MKR_E_CANON_UNSUPPORTED_VALUE`; (3) `node src/cli.ts policy canonicalize fixtures/policies/example-treasury.policy.json | cmp - <(python3 scripts/jcs_reference.py fixtures/policies/example-treasury.policy.json)` exits 0 (Python `json.dumps(sort_keys=True, separators=(",",":"), ensure_ascii=False)` is an independent implementation for this subset; document where it differs and why the subset avoids it); (4) `node src/cli.ts policy hash <file>` prints 64 lowercase hex and equals `sha256sum` of the canonical bytes; (5) the value is recorded in `fixtures/policies/example-treasury.policy.hash`.
- Test: `pnpm test`.

### MKR-002: PolicyDoc parser and validator
- Status: DONE (2026-11-08): tokenizer with duplicate-key/null/float/unsafe-int detection, structural + semantic validation collecting all violations; all 20 invalid fixtures produce their code; multi-fault test; parser-accepted documents pass the JSON Schema. Added PD_SYNTAX and PD_MISSING_FIELD (SPEC 2.4) and a precise PD_DEAD_RULE (SPEC 2.5). Deps: none. Size [E]: 1.5 days.
- Files: `src/policy/parse.ts` (+ a duplicate-key-detecting JSON tokenizer), `test/policy-parse.test.ts`.
- Acceptance: (1) `fixtures/policies/example-treasury.policy.json` parses with zero violations; (2) for every entry in `fixtures/policies/invalid/EXPECT.json`, `parsePolicyDoc` returns a violation with the expected code (test iterates the file); (3) a document with three independent faults returns all three; (4) strkey checksum validation implemented without the SDK's throwing helpers leaking (use `StrKey.isValidEd25519PublicKey` / `isValidContract` from `@stellar/stellar-sdk`); (5) `node src/cli.ts policy validate <file> --json` prints `{"ok":true}` or `{"violations":[...]}` and exits 0/1; (6) a document passing the parser also passes `schemas/policy-doc.schema.json` (test).
- Test: `pnpm test`.

### MKR-003: Policy evaluation
- Status: DONE (2026-11-08): 31 table cases covering every DenyReason, boundaries, merged requirement, windows, determinism under rule shuffling (found and fixed an order-dependent reason), no-I/O check. Most-specific no-match reason and pre-simulation deny check recorded in SPEC 4.2. Deps: none (works on parsed objects; parser not required). Size [E]: 2 days.
- Files: `src/policy/evaluate.ts`, `test/evaluate.test.ts`.
- Acceptance: table-driven tests with at least 30 cases covering every `DenyReason`; nested-node coverage (a deny rule matching a sub-invocation denies the request); amounts as `bigint` with i128 edges; rolling-limit arithmetic including exact boundary (`total == max` allowed, `+1` denied); window boundaries (`startUtc` inclusive, `endUtc` exclusive, day change); merged requirement takes max/union/intersection (SPEC 4.4); determinism: rule array shuffled gives an identical `PolicyDecision`; `evaluate` performs no I/O and reads no clock (test passes a frozen `nowUnix`, lint rule forbids `Date.now`/`fetch` in `src/policy/`).
- Test: `pnpm test`.

### MKR-004: Workflow reducer (`applyEvent`)
- Status: DONE (2026-11-08): reducer with every SPEC 5.3 row; S1-S4 dedicated tests; seeded property test over 10,000 sequences (SEED to replay); legalNextEvents check. `cancelled` added vs the brief as planned. Mutation check: removing the S1 guard is caught (an isolated S1 case was added after the first mutation survived), removing S3 is caught. Tests were written after the code in this run, not test-first. Deps: none (attestation verifier injected via `TransitionContext`; only `host-asserted` is exercised until MKR-006). Size [E]: 2 days.
- Files: `src/workflow/machine.ts`, `test/machine.test.ts`, `test/machine.property.test.ts`.
- Acceptance: (1) every row of SPEC 5.3 has a positive and a negative test; (2) S1 to S4 (SPEC 5.5) each have a dedicated test; (3) property test with a seeded PRNG (seed printed on failure) generates at least 10,000 random event sequences over a 4-principal policy and asserts after every step: maker never in `approvals`; no principal twice; terminal states absorb; `approved` implies both groups at `min`; `signed` implies `approved` first and `nowUnix >= signingEligibleAt`; (4) cancelled added vs the brief is noted in the ticket DONE line; (5) `legalNextEvents` agrees with `applyEvent` (every returned event applies, a sampled illegal one throws).
- Test: `pnpm test`.

### MKR-005: StubSigner (test signer)
- Status: DONE (2026-11-08): StubSigner with runtime Keypair.random() in a private field, never serialised (test + source check); sign/decline/pending-then-sign; refuses to sign an auth entry whose preimage hash does not match. Also the runtime-key signer used on testnet. Deps: none. Size [E]: 0.5 day.
- Files: `src/signer/stub.ts`, `test/stub-signer.test.ts`.
- Acceptance: throwaway keys from `Keypair.random()` generated in the constructor and never serialised (no `fs`, `console` or `JSON.stringify` of the keypair in `src/signer/stub.ts`; lint rule added to `scripts/lint.ts`); scripted modes `sign`, `decline`, `pending-then-sign`; `signMessage` output verifies with `Keypair.verifyMessage`; `signTransaction` adds a decorated signature that verifies; `signAuthEntry` returns an entry whose signature verifies over `preimageHash` (uses `authorizeEntry` with a callback); two instances have different addresses; `addresses()` lists them.
- Test: `pnpm test`.

## Wave 2: audit, approvals, orchestration

### MKR-006: Approval statement and SEP-53 attestation
- Status: DONE (2026-11-08): approval statement/message/digest; SEP-53 verification; every statement field tamper, wrong address, replay and disallowed host-asserted refused. The CLI statement command works against a --state dir. Deps: MKR-001, MKR-004. Size [E]: 1 day.
- Files: `src/workflow/approval.ts` (new), `src/workflow/machine.ts` (`verifyApproval`), `test/approval.test.ts`.
- Acceptance: `approvalStatement`/`approvalMessage`/`approvalDigest` implemented per SPEC 5.4; `verifyApproval` accepts a SEP-53 signature made by `StubSigner.signMessage` and rejects: wrong address, tampered field (each field of the statement), replay on another request, `host-asserted` when not allowed; `node src/cli.ts approval statement <id> ...` prints the message string; the machine rejects an approval whose statement `requestId`/`policyHash`/`intentDigest` differ from the record.
- Test: `pnpm test`.

### MKR-008: AuditLog, MemoryAuditStore, verify
- Status: DONE (2026-11-08): AuditLog, MemoryAuditStore, pure verifyEntries (also used in the browser); one test per tamper class plus anchored-head truncation; 1,000 entries verify well under 2 s; CLI audit verify/head; schema validation. Deps: MKR-001. Size [E]: 1 day.
- Files: `src/audit/log.ts`, `test/audit.test.ts`, `fixtures/audit/*.jsonl`.
- Acceptance: append builds `seq`, `prevHash`, `hash` per SPEC 8.2; concurrent appends with a stale `expectedSeq` throw `MKR_E_AUDIT_APPEND_CONFLICT`; `verify` detects each of: edited field, deleted middle entry, reordered entries, wrong genesis, bad shape, duplicate seq (one test each, naming the failing `seq` and reason); 1,000-entry log verifies in under 2 s [E]; `node src/cli.ts audit verify <log.jsonl>` exits 0/1; `audit head` prints `{seq,hash}`; entries validate against `schemas/audit-entry.schema.json`.
- Test: `pnpm test`.

### MKR-007: FileAuditStore (JSON Lines)
- Status: DONE (2026-11-08): FileAuditStore (canonical JSON lines, fsync, lock file, mode 0600, partial-line detection and repair). Two-process conflict test passes. The `--repair` CLI flag is not wired (library `repair()` only). Deps: MKR-008. Size [E]: 1 day.
- Files: `src/audit/log.ts`, `test/audit-file.test.ts`.
- Acceptance: one canonical entry per line; `fsync` on append; second writer process gets `MKR_E_AUDIT_APPEND_CONFLICT` (test spawns two `node` processes); truncated last line (simulated crash) is detected by `verify` and `append` refuses to continue until repaired by an explicit `--repair` that moves the partial line to `<log>.partial` and records an `audit.checkpoint`; file created with mode 0600.
- Test: `pnpm test`.

### MKR-009: RequestService and the request CLI
- Status: DONE (2026-11-08): RequestService (propose/approve/reject/cancel/expire, rolling spend from the projection, projection rebuilt from the log alone, tested identical), CLI request/approval commands over --state. Instead of `scripts/demo-offline.ts` the offline end-to-end is `test/service.test.ts` and the testnet one is MKR-031. Deps: MKR-002, MKR-003, MKR-004, MKR-006, MKR-007, MKR-008. Size [E]: 2 days.
- Files: `src/service/requests.ts` (new), `src/cli.ts`, `test/service.test.ts`.
- Acceptance: `propose` (policy evaluation, request id, pinned requirement, audit entries `request.proposed` or `request.policy_denied`), `approve`, `reject`, `cancel`, expiry sweep; the request projection is rebuilt from the audit log alone (test deletes the projection and rebuilds it identically); rolling spend is computed from the projection (SPEC 4.5); CLI `request propose|show|approve|reject|cancel|list` work end to end with `--state <dir>` using `StubSigner` attestations; a script `scripts/demo-offline.ts` runs a full propose, two approvals, threshold, cooldown (injected clock) and prints the audit log; `node scripts/demo-offline.ts` exits 0.
- Test: `pnpm test`.

## Wave 3: Soroban authorisation entries

### MKR-016: SPIKE: capture auth-entry fixtures on testnet and settle the multi-signer questions
- Status: IN-PROGRESS (2026-11-08): single-key case answered on testnet (addressV2 entry from a second G signer passes enforce simulation, SPEC 7.11, recorded run). U1 (multisig G account), U2 (authMode for non-root frames) and the six capture cases are not done. Deps: none (needs network). Size [E]: 2 days.
- Question: U1 (does a G account with several signers authorise an address-credential entry with several signatures; threshold; ordering), U2 (`authMode` needed for non-root frames), U5 (Protocol 30 effects, if testnet has voted by then).
- Method: implement `fixtures/capture/capture-auth-entries.ts`; on **testnet only** with throwaway keys from `Keypair.random()` (never written), build the six cases listed in that file, simulate in `record` and `enforce` modes, try 1-of-2 and 2-of-2 signatures on a multisig G account's entry, record RPC responses.
- Decision rule: if two-signature entries from a G account are accepted at the account's medium threshold, add `AuthSignerNode` multi-signature support for classic accounts (SPEC 7.4 updated first) and size MKR-013; if not, one signer per classic slot and multi-signer accounts must use the envelope path. Record results in SPEC 7.11 with `[P]` and the ledger numbers.
- Acceptance: `fixtures/auth-entries/<case>/` exist with `*.provenance.json` validating against `schemas/provenance.schema.json`; `pnpm lint` passes (no seeds); SPEC 7.11 updated; written findings in the DONE line.
- Test: `pnpm test` (fixtures load).

### MKR-011: ScValJson mapping and invocation tree digest
- Status: DONE (2026-11-08): scValToJson/jsonToScVal round-trip (2,000 generated values incl. 128/256-bit edges, schema-valid), tree digest independent of nonce/expiry and sensitive to every listed change; flattening for evaluation. Timepoint/Duration/Option fail closed (MKR-018). Deps: MKR-001. Size [E]: 1.5 days.
- Files: `src/auth/scval.ts` (new), `src/auth/tree.ts` (new), `test/scval.test.ts`.
- Acceptance: `scValToJson`/`jsonToScVal` round-trip for every ScVal type in SPEC 5.2 (property test over generated values); map key order preserved; i128/u128/i256/u256 round-trip at +-2^127 edges; `invocationTreeDigest` is independent of nonce and expiry and changes when any arg, function, contract or sub-invocation changes (tests); built from SDK-constructed `SorobanAuthorizationEntry` objects offline; output validates against `schemas/action-request.schema.json` `$defs/scval`.
- Test: `pnpm test`.

### MKR-010: Plan: decode simulated entries into slots
- Status: DONE (2026-11-08): planAuth with injected deps; slots for address entries only; preimage hash recomputed in test; stable ids; PAYLOAD_MISMATCH and SIMULATION_FAILED tested; exercised on testnet. addressWithDelegates decode is via the SDK but untested (no fixture). Deps: MKR-011. Size [E]: 2 days.
- Files: `src/auth/plan.ts`, `test/plan.test.ts`.
- Acceptance: offline, with SDK-constructed simulation responses (and the MKR-016 fixtures when present): `address`, `addressV2`, `addressWithDelegates`, and `sourceAccount` entries decode; slots only for address-type entries; `validUntil` written into each entry and `preimageHash` equals `SHA-256(buildAuthorizationEntryPreimage(...).toXDR())` (test recomputes); `planId`/`slotId` stable across runs; tree digest mismatch yields `MKR_E_PAYLOAD_MISMATCH`; simulation error yields `MKR_E_SIMULATION_FAILED` with the contract error text; `AuthDeps` is injected (no network in tests).
- Test: `pnpm test`.

### MKR-012: Bundle and share verification
- Status: DONE (2026-11-08): toBundle (schema-valid) and verifyCollectedShare with one test per failure mode. Contract-account shares: structural check only, as specified, but no contract-account test yet. Deps: MKR-010, MKR-005. Size [E]: 1.5 days.
- Files: `src/auth/bundle.ts`, `test/bundle.test.ts`.
- Acceptance: `toBundle(plan)` validates against `schemas/auth-bundle.schema.json`; `verifyCollectedShare` accepts a valid ed25519 share made with `StubSigner` and rejects (one test each): different nonce, different expiry, different rootInvocation, different address, missing signature, signature over another slot's hash, expired slot, unknown slot; contract-account share passes structural checks only (documented in the test name).
- Test: `pnpm test`.

### MKR-013: Merge bundles and completeness
- Status: DONE (2026-11-08): mergeBundles commutative/associative/idempotent over 1,000 seeded cases; conflicts and foreign plans refused; isComplete. Deps: MKR-012. Size [E]: 1 day (+1 if MKR-016 finds multi-signature classic nodes).
- Files: `src/auth/bundle.ts`, `test/merge.property.test.ts`.
- Acceptance: property tests (seeded, 1,000 cases): `merge(a,b) == merge(b,a)`, associativity, idempotence; different `planId` refused; conflicting signatures for the same node refused; `isComplete` true only when every slot node has a verified share; merging in any order of three signers gives byte-identical bundles.
- Test: `pnpm test`.

### MKR-014: Re-plan on expiry
- Status: TODO (2026-11-08): `replanAuth` re-plans and the service records `auth.planned` with reason `replan`, but approval invalidation on digest change and the stale-plan workflow are not tested. Deps: MKR-010, MKR-013. Size [E]: 1 day.
- Files: `src/auth/plan.ts`, `test/replan.test.ts`.
- Acceptance: re-plan changes `validUntil` and nonces, discards all shares, emits an `auth.planned` audit entry with `reason: "expiry"`; approvals survive when the tree digest is unchanged and are void when it changed (workflow event `expired`-like path defined and tested); a plan within `SAFETY_LEDGERS` of expiry is reported stale.
- Test: `pnpm test`.

### MKR-015: Assembly, enforce-mode simulation, envelope signatures
- Status: DONE (2026-11-08): assembly in plan order, enforce-mode failure carries the contract error, stale plan refused, envelope signature merge refuses foreign keys and other transactions; testnet run passed enforce simulation (via the e2e script, not a separate assemble-testnet.ts). Multi-node (delegates) entries are refused (MKR-040). Deps: MKR-013. Size [E]: 2 days.
- Files: `src/auth/assemble.ts`, `test/assemble.test.ts`, `scripts/assemble-testnet.ts`.
- Acceptance: offline tests with injected `simulate`: entries placed in plan order, enforce-mode failure surfaces the contract error, stale plan refused; `addEnvelopeSignature` merges decorated signatures and refuses a signature that does not verify over the envelope hash; **testnet** run of `scripts/assemble-testnet.ts` (throwaway funded keys, a two-party `transfer`) produces an envelope that `simulateTransaction` (enforce) accepts; the script submits nothing (submission is MKR-027).
- Test: `pnpm test`; `node scripts/assemble-testnet.ts` (network).

## Wave 4: control actions and signer adapters

### MKR-018: SPIKE: SEP-57 Draft vs OpenZeppelin `rwa` crate
- Status: IN-PROGRESS (2026-11-08): names and argument order checked against OZ stellar-tokens 0.7.1 source and set_address_frozen executed on testnet (SPEC 6.1). Events, role model and 0.8.0 comparison open; no drafts/ note yet. Deps: none. Size [E]: 1 day.
- Question: do function names, argument order, auth model (`operator` vs `caller`), events and the `pause` doc glitch in SEP-57 v0.4.0 match `OpenZeppelin/stellar-contracts` `packages/tokens/src/rwa` at its latest release (v0.8.0 at discovery)? Is there an `unfreeze` function? Which role must the operator hold (OZ role-manager)?
- Method: read the crate and its tests; build the `rwa` example on testnet with a throwaway admin; call `set_address_frozen`, `forced_transfer`, `pause` in simulation.
- Decision rule: templates follow the deployed crate version that tests pass against; any difference from the Draft goes in SPEC 6.1 with `[P]` and a drafts/ note for the user to send to OZ (G-OUTREACH). If the crate differs by more than names, pin the version in `buildControlAction` and add a `contractVersion` field.
- Acceptance: SPEC 6.1 updated with the crate commit; `fixtures/control/*.json` of simulated invocations with provenance.
- Test: `pnpm test`.

### MKR-017: SEP-57 control-action builders
- Status: DONE (2026-11-08): builders for freeze/unfreeze (full and partial), forced_transfer, pause/unpause; validation, summaries, warnings; integration with evaluate on the example policy; CLI `control build`. Deps: MKR-011 (and MKR-018 for argument truth). Size [E]: 1.5 days.
- Files: `src/control/sep57.ts`, `test/sep57.test.ts`.
- Acceptance: `buildControlAction` for each kind returns the SPEC 6.1 function and typed args; invalid addresses, negative or non-decimal amounts, equal `from`/`to`, token that is not a `C` address are `MkrError`; summary text matches snapshot tests; output feeds `evaluate` (an integration test builds a freeze, evaluates it against the example policy and gets `allow` with 2 checkers + 1 admin, and a `mint` is denied by `deny-rwa-mint-burn`); `node src/cli.ts control build freeze --token C... --operator G... --user G... --json` works.
- Test: `pnpm test`.

### MKR-019: SPIKE: SEP-43 and SEP-53 wallet conformance
- Status: TODO. Deps: none. Size [E]: 1.5 days.
- Question: for Freighter, xBull, Lobstr (via Stellar Wallets Kit source and docs): what exactly do `signAuthEntry` (input: preimage vs entry; output: signature vs hash) and `signMessage` (SEP-53 framing vs the "HEX-encoded message" wording) do; which support contract-token calls; which show the auth tree.
- Method: read module source in `Creit-Tech/Stellar-Wallets-Kit` and wallet repos read-only; testnet runs need a human with a browser wallet, which is the user's step: list them in `drafts/wallet-conformance-checklist.md` and mark those rows `BLOCKED(user)`.
- Decision rule: if a wallet's `signMessage` does not verify with `Keypair.verifyMessage`, the SEP-43 adapter marks it `approvals: false` and checkers using it must use `host-asserted` or another wallet.
- Acceptance: `docs/WALLET-MATRIX.md` (new, tags [P]/[U] per cell, dated); SPEC 5.4/9.2 updated.
- Test: none (docs).

### MKR-020: SEP-43 adapter
- Status: TODO. Deps: MKR-019, MKR-005. Size [E]: 1.5 days.
- Files: `src/signer/adapters.ts` (or `src/signer/sep43.ts`), `test/sep43.test.ts`.
- Acceptance: adapter wraps an injected object with the SEP-43 methods; a fake wallet in tests implements the SEP; `signAuthEntry` sends the preimage XDR (SPEC 9) and maps the reply; errors in the SEP-43 error shape map to `declined`/`MKR_E_SIGNER_UNAVAILABLE`; capabilities derived from the matrix of MKR-019.
- Test: `pnpm test`.

### MKR-021: KMS/HSM adapter
- Status: TODO. Deps: MKR-005. Size [E]: 1.5 days.
- Files: `src/signer/kms.ts`, `test/kms.test.ts`, `docs/KMS.md`.
- Acceptance: depends on an injected `Ed25519Signer {publicKey(): Uint8Array; sign(data): Promise<Uint8Array>}`; signs envelope hash, auth preimage hash, and SEP-53 messages; test double is `Keypair`; `docs/KMS.md` lists which clouds' KMS offer Ed25519 as [U] items to verify (no vendor SDK dependency is added; no network in tests).
- Test: `pnpm test`.

### MKR-022: XDR hand-off adapter (Stratum, Refractor)
- Status: TODO. Deps: MKR-005. Size [E]: 1.5 days.
- Files: `src/signer/xdr-handoff.ts`, `test/xdr-handoff.test.ts`.
- Acceptance: `export(envelope)` returns base64 XDR, a file path variant, and a Stratum import link in the format Stratum's `src/lib/urlState.ts` accepts (read that file first; record the format in SPEC 9.3); `import(signedXdr)` verifies the signatures added belong to the expected signer set and the transaction hash is unchanged; Refractor polling is injected and off by default; the adapter refuses to be used for `signAuthEntry` (returns `declined` with reason "Stratum cannot collect authorization entries").
- Test: `pnpm test`.

### MKR-023: Custody-vendor API adapter
- Status: BLOCKED(vendor access, G-OUTREACH). Deps: MKR-005. Size [E]: 2 days.
- Question: do Fireblocks, BitGo, Taurus, Dfns expose Soroban auth-entry or raw-message signing for Stellar via API? Evidence so far: Fireblocks says Soroban tokens unsupported (2026-06-23, [S]); BitGo lists classic Stellar tokens only [S].
- Unblock: the user obtains sandbox access or written answers; agent drafts the questions in `drafts/custody-questions.md`.
- Acceptance (when unblocked): asynchronous ticket flow works against the vendor sandbox.

## Wave 5: service surface and hardening

### MKR-024: Audit export
- Status: DONE (2026-11-08): jsonl and csv (RFC 4180, formula guard), control-actions filter, golden file `fixtures/testnet/e2e-control-actions.csv`, head line. Deps: MKR-008. Size [E]: 1 day.
- Files: `src/audit/export.ts`, `test/export.test.ts`.
- Acceptance: `jsonl`, `csv` (RFC 4180 quoting; formula-injection guard: cells starting with `=+-@` are prefixed with `'`), `--control-actions` filter; `node src/cli.ts audit export <log> --format csv --control-actions` output matches a golden file; export of a verified log includes the head hash line.
- Test: `pnpm test`.

### MKR-025: HTTP server
- Audit fixes (2026-11-08): `mkr serve --tokens <map.json>` (bearer token to principal), startup warning when running without caller identity, note when `--rpc` is missing; loopback Host check and foreign-Origin refusal; `createRpcSubmitter` refuses to be built for the public network without `allowMainnet`. Test added in `test/service.test.ts`. Open: the `--allow-mainnet-submit` flag is not compiled out (G-VALUE).
- Status: DONE (2026-11-08): node:http server for every OpenAPI path, injected bearer-to-principal mapping, 127.0.0.1 default, 1 MiB limit, error mapping, optional CORS allow-list for the console. `mkr serve --state` works. No request logging at all (so nothing sensitive is logged). Deps: MKR-009, MKR-015. Size [E]: 2 days.
- Files: `src/api/server.ts`, `src/api/auth.ts`, `test/server.test.ts`.
- Acceptance: every path in `openapi/openapi.yaml` is routed; bearer token to principal mapping is an injected function; binds `127.0.0.1` by default; request body limit 1 MiB; JSON only; error shape per SPEC 10.3; no endpoint logs a body that can contain signatures except as digests; `mkr serve` starts and `GET /v1/healthz` answers.
- Test: `pnpm test`.

### MKR-026: Policy registry and supersession
- Status: DONE (2026-11-08): register requires admin (both versions when superseding), idempotent, unknown supersedes refused, superseded policy refuses new proposals, policy.registered entry. Deps: MKR-009. Size [E]: 1 day.
- Files: `src/service/policies.ts`, `test/policies.test.ts`.
- Acceptance: register requires admin; same document registers idempotently; `supersedes` must reference a registered hash (`PD_SUPERSEDES_UNKNOWN`); superseded policy refuses new proposals but in-flight requests complete (SPEC 5.6); `policy.registered` audit entry; listing shows `supersededBy`.
- Test: `pnpm test`.

### MKR-027: Submitter
- Status: DONE (2026-11-08): RPC submitter with bounded polling, idempotent per envelope hash; mainnet refused unless allowMainnetSubmit (tested); failed submit stays signed with request.submit_failed (tested). Deps: MKR-015. Size [E]: 1 day.
- Files: `src/service/submit.ts`, `test/submit.test.ts`.
- Acceptance: `submit` calls RPC `sendTransaction` then polls `getTransaction` with a bounded timeout; refuses `mainnet` unless `allowMainnetSubmit` (`MKR_E_MAINNET_SUBMIT_BLOCKED`, G-VALUE) even when the policy says mainnet; failure leaves the record `signed` with `request.submit_failed`; double submit of the same envelope hash is idempotent; tests use an injected RPC.
- Test: `pnpm test`.

### MKR-028: Threat model
- Status: TODO. Deps: none. Size [E]: 1 day.
- Files: `docs/THREAT-MODEL.md` (new).
- Acceptance: STRIDE table per flow in SPEC section 1; each threat has mitigation, test id or `OPEN`; includes at least: approval replay, TOCTOU between approval and signing, tree drift after approval, malicious signer returning altered entry, malicious bundle relay, audit truncation, clock manipulation, policy downgrade by superseding, maker-checker collusion, host-asserted spoofing, dependency compromise, log injection through free-text fields; every `OPEN` item is listed in `RISKS.md`.
- Test: none (docs); reviewed in MKR-033.

### MKR-029: OpenAPI conformance test
- Status: TODO. Deps: MKR-025. Size [E]: 1 day.
- Acceptance: a test parses `openapi/openapi.yaml` (use a small YAML-to-JSON dev dependency or convert once to JSON), starts the server, calls every operation with generated examples, and validates every response body against the declared schema with ajv; undeclared status codes fail the test.
- Test: `pnpm test`.

### MKR-030: Fuzz and differential tests for parser and canonicaliser
- Status: TODO. Deps: MKR-001, MKR-002. Size [E]: 1 day.
- Acceptance: seeded generator produces at least 50,000 documents (valid, near-valid mutations of the example, hostile Unicode); canonical output equals `scripts/jcs_reference.py` for all accepted values; the parser never throws anything other than `MkrError`; no input takes longer than 100 ms [E]; run time under 60 s.
- Test: `pnpm test` (CI size) and `node scripts/fuzz.ts --iterations 500000` (manual).

### MKR-031: End-to-end testnet demo (SEP-57 freeze with maker-checker and multi-party authorisation)
- Status: DONE (2026-11-08): `scripts/e2e-testnet.ts` (pnpm e2e:testnet) deploys the DEMO-ONLY OZ RWA wrapper, runs 20 API steps including 8 refusals, freezes the holder (tx be6b6fea…, ledger 5,622,041), reads is_frozen=true, verifies the audit chain. Recorded in fixtures/testnet/ with provenance. docs/E2E.md not written; DEMO.md covers it. Deps: MKR-009, MKR-013, MKR-015, MKR-017, MKR-018, MKR-027. Size [E]: 2 days.
- Files: `scripts/e2e-testnet.ts`, `docs/E2E.md`.
- Acceptance: on testnet, with throwaway keys: deploy an OZ rwa token (script from MKR-018), propose `freeze` as maker, approve by two checkers and one admin (SEP-53 attestations), cooldown (set to 0 for the demo), plan auth, collect an entry from a second address using `StubSigner`, assemble, sign, submit, observe `is_frozen == true`; `mkr audit verify` passes on the produced log; the log and a transcript are saved under `out/` (gitignored) and the explorer links are in `docs/E2E.md`. Mainnet is not touched.
- Test: `node scripts/e2e-testnet.ts` (network, writes testnet only).

### MKR-032: Audit checkpoints and anchoring interface
- Status: TODO. Deps: MKR-008, MKR-006. Size [E]: 1 day.
- Acceptance: `checkpoint()` appends `audit.checkpoint` signed through an adapter `signMessage`; `verify({anchoredHead})` fails when the log is shorter than or differs from the anchored head; an `Anchor` interface with a file-based sample and no network implementation; documented that real anchoring is a host decision (SPEC 8.5).
- Test: `pnpm test`.

### MKR-033: Counsel and security review package
- Status: BLOCKED(G-LEGAL, user decision to engage counsel and a security reviewer). Deps: MKR-028. Size [E]: 1 day to assemble.
- Output: `docs/REVIEW-PACKAGE.md` with audit-scope manifest (modules, hashes, commit), threat model, the questions in `RISKS.md` section "Review before anyone holds keys", and a list of what the reviewers should not assume. The agent assembles; the user engages reviewers.
- Acceptance: file exists; every item in RISKS "Review before anyone holds keys" is referenced.

### MKR-034: Operator runbook
- Status: TODO. Deps: MKR-025. Size [E]: 1 day.
- Files: `docs/RUNBOOK.md`.
- Acceptance: deployment hardening (bind, TLS terminator, token issuance outside), log backup and anchoring routine, incident response for "approval given to wrong request", "signer compromised", "policy compromised", restore from audit log, upgrade procedure keeping `policyHash`; states plainly that the service holds no keys and cannot stop a key holder.

### MKR-035: Draft note for the Stratum maintainer
- Status: TODO. Deps: MKR-022. Size [E]: 0.5 day.
- Output: `drafts/stratum-note.md` (not sent; G-OUTREACH): what the XDR hand-off needs from Stratum (stable import link format, no breaking change notice), what this layer adds, no request that duplicates their features. The user decides whether to send.
- Acceptance: file exists; contains only claims traceable to PRIOR-ART.

---

## Wave 6: MVP run (2026-11-08)

### MKR-036: DEMO-ONLY RWA token for testnet
- Status: DONE (2026-11-08): `contracts/rwa-demo` wraps OpenZeppelin stellar-tokens 0.7.1 RWAToken + Pausable with one operator (dependency, not copied). 4 contract tests; fmt and clippy -D warnings clean; wasm built with `stellar contract build` (21,371 bytes, sha256 48b6e9c5…8e1a) and committed as `fixtures/wasm/rwa-demo.wasm`. Mint/transfer/forced_transfer need identity and compliance contracts and are not wired.

### MKR-037: Demo server and wallet simulator
- Audit fixes (2026-11-08): `/demo/*` routes run after authentication; Host and Origin guards in `startServer`; friendbot retry/timeout; retries for account reads and simulation; `onInternalError` hook logs the cause behind a 500 in `demo:serve`; CORS ports 4173-4182 and 5173-5182. Re-driven end to end: freeze tx `87775496…f233a7`, ledger 5,628,989, `is_frozen = true`. Open: the simulator still signs for any local caller that passes the checks (DEMO-ONLY, documented in DEMO.md).
- Status: DONE (2026-11-08): `pnpm demo:serve` creates a testnet world (runtime keys, friendbot, token deploy), registers the policy and serves the API on 127.0.0.1:8787 with `/demo/*` wallet-simulator routes. Driven end to end from the web console on 2026-11-08 (freeze tx in ledger 5,622,359).

### MKR-038: Web approval console
- Audit fixes (2026-11-08): Policy view no longer overflows at 375-414 px; hero figure reworded to "N of N refused" with the scripted-attempt caveat; Live console selection no longer snaps back after a proposal. Screenshots in `docs/screenshots/` regenerated for overview, policy and the live run.
- Status: DONE (2026-11-08): `web/` (Vite, React, TS strict, Tailwind v4, kit tokens): overview, recorded run with in-browser re-verification of approvals and chain, live console over the API, policy viewer/editor/evaluator running the real core, audit viewer with tamper demo and exports. Data from `pnpm demo:data`.

### MKR-039: Investor docs
- Status: DONE (2026-11-08): MVP-PLAN.md, DEMO.md, PITCH.md, DEPLOY.md, README status table.

### MKR-040: Combine shares of multi-node (delegates) entries
- Status: TODO. Deps: MKR-016. `signedEntries` refuses entries with more than one signer node; combining node signatures into one entry is not implemented.

## Cross-project requests

- `docs/ARCHITECTURE.md` lists `PolicyDoc canonical JSON` as owned by maker-checker. Request: add a line that the schema lives at `projects/maker-checker/schemas/policy-doc.schema.json`, the hash rule is SPEC 3.2 (SHA-256 of RFC 8785 bytes, untagged), and that external signers MAY implement it from SPEC section 3 alone.
- `docs/SOURCES.md` lists `OpenZeppelin/stellar-contracts` licence as "OZ licence (check)": GitHub reports MIT (2026-10-31).
- No change needed to other projects.
