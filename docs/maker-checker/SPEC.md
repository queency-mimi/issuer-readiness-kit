# SPEC: maker-checker (normative)

Status: MVP, 2026-11-08 (core implemented and run end to end on testnet; see README status table). Package `@sik/maker-checker`, ticket prefix `MKR`. DEMO-ONLY until gates G-VALUE and G-CRYPTO open (`docs/GATES.md`). Changes made during the MVP run are marked "(2026-11-08)".
Trust tags: [P] primary source read (URL/path and date given), [S] secondary, [V] vendor, [I] inference, [E] estimate, [U] unverified (a spike ticket exists).
The key words MUST, MUST NOT, SHOULD, MAY are used in the RFC 2119 sense.

## 0. What this is and is not

maker-checker is a **headless policy and audit layer for multi-party Soroban authorisation**. It decides whether an action may proceed, records who proposed and approved it, helps collect the several signatures a Soroban transaction can need, and keeps a tamper-evident log.

It is **not** a signer (it never sees a private key, seed or mnemonic, and no API field can carry one), **not** a wallet, **not** a UI, and **not** a custodian. Signing happens in existing signers reached through the adapter interface (section 9): hardware/software wallets that speak SEP-43, KMS/HSM clients the host provides, custody-vendor APIs, or a UI such as `tupui/stellar-stratum` through XDR hand-off.

Important limit [I]: everything in sections 2 to 5 is enforced **off-chain, by this layer**. A holder of a signing key who bypasses this layer is not stopped by it. On-chain enforcement is the job of the account (classic thresholds, an OpenZeppelin smart account policy) and of the token (SEP-57 roles). This layer adds who-proposed, who-approved, what-exactly-was-approved, and evidence; it does not replace on-chain controls and MUST NOT be described as doing so.

Explicitly independent of OpenZeppelin smart accounts and of Perch: nothing here imports or requires them. Perch's policy IR and `CANONICAL.md` were read for ideas only (section 3, `PRIOR-ART.md`); no code was copied (G-LICENCE).

### 0.1 Terms

| Term | Meaning |
|---|---|
| principal | A named participant in a PolicyDoc (`maker-alice`). Not a key; it may have an attestation address. |
| maker | Role that may propose an action. |
| checker | Role that may approve or reject. |
| admin | Role that may register policies and may be required as an additional approver. |
| request | One proposed action (`ActionRequest`), content-addressed. |
| intent | The machine-checkable meaning of a request: network, source, contract, function, typed args, authorised-invocation tree digest. |
| slot | One signature obligation inside a Soroban authorisation entry (section 7). |
| bundle | Portable JSON used to move auth entries between signers (section 7.4). |
| attestation | Evidence that a principal made a decision (section 5.4). |

## 1. Data flow

```
 maker (propose)            policy engine            checkers (approve/reject)
      |                          |                              |
      v                          v                              v
 [intent + summary] -> evaluate(PolicyDoc, intent) -> requirement pinned -> approvals w/ attestations
                                                                     | threshold met + cooldown elapsed
                                                                     v
                         auth plan: simulate(record) -> decode entries -> slots, bundle
                                                                     |
              signer A (SEP-43 / KMS / custody) <---- slot 1 -----+  |  +---- slot 2 ----> signer B
                                  \_____ signed entries ___________\ | /
                                                                    v
                         merge shares -> re-simulate(enforce) -> envelope signature(s) -> submit
   every arrow above appends a hash-chained audit entry (section 8)
```

## 2. PolicyDoc v1

TypeScript shapes: `src/policy/types.ts`. JSON Schema 2020-12 (structure only): `schemas/policy-doc.schema.json`. Semantic rules: 2.5. A document MUST pass both.

### 2.1 Fields

| Field | Type | Rule |
|---|---|---|
| `version` | `1` | Other values: `PD_VERSION_UNSUPPORTED`. |
| `id` | string `^[a-z0-9][a-z0-9-]{1,63}$` | Policy family id. |
| `name` | string 1..120 | Human label. |
| `network` | `{name: "testnet"\|"mainnet", passphrase}` | Passphrase MUST equal the well-known value for the name: `Test SDF Network ; September 2015` or `Public Global Stellar Network ; September 2015` [P: SDK `Networks`, installed 17.4.0]. |
| `validity` | `{notBefore, expiresAt}` | RFC 3339 UTC seconds, `Z`. `expiresAt` is mandatory: no immortal policies. `notBefore < expiresAt`. |
| `principals` | array, sorted by `id` | See 2.2. 2..200 entries. |
| `separation.makerCannotSign` | boolean | If true, a principal who proposed a request MUST NOT contribute any signature to it (section 5.5, S3). |
| `requestTtlSeconds` | int 60..2592000 | A request becomes `expired` this long after `createdAt` if not terminal. |
| `authEntryTtlLedgers` | int 1..17280 | Ledgers an auth entry stays valid after planning (17280 = about 24 h at 5 s ledgers [E]). |
| `rules` | array, sorted by `id` | 1..200. Section 2.3. |
| `supersedes` | hex32 | `policyHash` of the document this replaces. |

### 2.2 Principals

`{id, label, roles, address?, attestation}`.
- `id`: `^[a-z][a-z0-9_-]{1,63}$`, unique.
- `roles`: non-empty subset of `admin`, `checker`, `maker`, **sorted ascending**, unique. One principal MAY hold several roles; separation of duties (5.5) applies per request, not per principal.
- `attestation`: non-empty subset of `host-asserted`, `stellar-sep53`, sorted. `stellar-sep53` requires `address` (a `G` address, `PD_SEP53_NEEDS_ADDRESS`). `host-asserted` means the host application authenticated the caller and vouches; it is weaker and is labelled as such in every audit entry (5.4).

### 2.3 Rules

`{id, effect, description?, match, makers?, approval?, limits?, windows?, cooldownSeconds?}`.
- `effect: "allow"` REQUIRES `makers` and `approval`. `effect: "deny"` MUST NOT carry `makers`, `approval`, `limits`, `windows` or `cooldownSeconds` (`PD_DENY_HAS_ACTION_FIELDS`).
- `match.targets`: sorted by `contract`; each `{contract: C..., functions: FunctionRule[]}`, functions non-empty, sorted by `name`, **no wildcard** (a `*` fails the name pattern, `PD_BAD_VALUE`).
- `FunctionRule`: `{name, amountArg?, recipientArg?, recipients?}`. `amountArg` and `recipientArg` are zero-based argument indexes. `recipients` (sorted, unique) restricts the recipient and REQUIRES `recipientArg` (`PD_RECIPIENT_ARG_MISSING`).
- `match.controlKinds` (optional, sorted): restricts the rule to control actions of those kinds (section 6). Every listed kind MUST have a matching function in `targets` (`PD_CONTROLKIND_FUNCTION_MISMATCH`; the mapping is the table in section 6.1).
- `makers`: principal ids that hold `maker`.
- `approval.checkers` and optional `approval.admins`: `{min, from}`; `from` principals hold the group's role; `min <= from.length`; the two `from` sets MUST be disjoint (`PD_GROUPS_OVERLAP`) so one person never counts twice.
- `limits.perRequest`: `{contract, max}` where `max` is a base-unit decimal string (i128 range). `limits.rolling`: `{contract, windowSeconds 60..2592000, max}`. Every limit's contract MUST appear in `match.targets` and some function for that contract MUST declare `amountArg` (`PD_LIMIT_CONTRACT_NOT_TARGETED`, `PD_AMOUNT_ARG_MISSING`).
- `windows`: `{days, startUtc, endUtc}`, UTC only in v1 (no time-zone database), `startUtc < endUtc` (`PD_WINDOW_ORDER`), no overnight windows (write two windows).
- `cooldownSeconds`: 0..2592000, a timelock between threshold met and signing allowed.

### 2.4 Parsing (fail closed)

`parsePolicyDoc(text)` MUST reject: duplicate JSON object keys at any depth (`PD_DUPLICATE_KEY`; `JSON.parse` silently keeps the last, so parse with a tokenizer), unknown fields (`PD_UNKNOWN_FIELD`), unknown enum values (`PD_BAD_ENUM`), wrong types (`PD_BAD_TYPE`), pattern/range failures (`PD_BAD_VALUE`), `null` anywhere and floats (`PD_BAD_TYPE`), and any number outside the safe-integer range (`PD_BAD_VALUE`). Added 2026-11-08: text that is not JSON, or nests deeper than 32 levels, or exceeds 1 MiB is `PD_SYNTAX`/`PD_BAD_VALUE`; a missing required field is `PD_MISSING_FIELD`. A `__proto__` key is treated as data (and refused as unknown), never as a prototype. Idea taken from Perch's fail-closed parser [P: `crates/perch-ir/src/lib.rs` header, commit 2258433, read 2026-10-31]; implementation is independent.

### 2.5 Semantic validation codes

`validatePolicyDoc` collects **all** violations as `{path (JSON Pointer), code, message}`; it never stops at the first.

| Code | Condition |
|---|---|
| `PD_NOT_SORTED` | Any list required to be sorted is not (principals by id; rules by id; roles; attestation; targets by contract; functions by name; `from`; `recipients`; `controlKinds`; `days`). Sorting is required so equal policies have equal bytes. |
| `PD_DUPLICATE_ID` | Duplicate principal id or rule id. |
| `PD_UNKNOWN_PRINCIPAL` | A rule refers to an id not in `principals`. |
| `PD_ROLE_MISSING` | A principal listed in `makers` lacks `maker`; in `checkers.from` lacks `checker`; in `admins.from` lacks `admin`. |
| `PD_GROUPS_OVERLAP` | `checkers.from` and `admins.from` intersect. |
| `PD_MIN_EXCEEDS_FROM` | `min > from.length`. |
| `PD_ALLOW_NEEDS_APPROVAL` | Allow rule without `makers` or `approval`. |
| `PD_DENY_HAS_ACTION_FIELDS` | See 2.3. |
| `PD_SEP53_NEEDS_ADDRESS` | Attestation includes `stellar-sep53` and no `address`. |
| `PD_ADDRESS_INVALID` | Not a valid strkey (checksum) of the required kind; muxed `M...` is rejected in v1. |
| `PD_VALIDITY_ORDER` | `expiresAt <= notBefore`. |
| `PD_NETWORK_PASSPHRASE_MISMATCH` | See 2.1. |
| `PD_LIMIT_CONTRACT_NOT_TARGETED` / `PD_AMOUNT_ARG_MISSING` | See 2.3. |
| `PD_RECIPIENT_ARG_MISSING` | `recipients` without `recipientArg`. |
| `PD_WINDOW_ORDER` | `startUtc >= endUtc`. |
| `PD_CONTROLKIND_FUNCTION_MISMATCH` | See 2.3. |
| `PD_DEAD_RULE` | An allow rule that can never be approved: for **every** maker `m` in `makers`, `from \ {m}` has fewer than `min` principals in some group (S1 excludes the proposer). (2026-11-08: the earlier wording "remove all makers" was stricter than S1 requires; a maker may approve another maker's request.) |
| `PD_SUPERSEDES_UNKNOWN` | `supersedes` is set but that hash is not registered (checked at registration, not by the pure validator). |

Fixtures: `fixtures/policies/example-treasury.policy.json` (valid) and `fixtures/policies/invalid/*.policy.json` with `EXPECT.json` (one code per file). Each invalid file MUST produce at least its expected code.

### 2.6 Versioning and supersession

A registered PolicyDoc is immutable and identified by `policyHash`. A change is a new document with `supersedes`. A request pins the `policyHash` it was proposed under; a later policy does not retroactively change an in-flight request (section 5.6). Registering a superseding document is itself recorded (`policy.registered`) and needs the `admin` role; it MAY be required to go through an ordinary request/approval cycle by a rule that targets the host's own policy-registry action (out of scope for v1; the registry is a host concern, ticket MKR-026).

## 3. Canonicalisation and hashing

### 3.1 JCS subset

Canonical bytes are RFC 8785 JSON Canonicalization Scheme output [P: RFC 8785] for the subset the kit produces: objects, arrays, strings, booleans, **safe integers**. Amounts that can exceed 2^53 are decimal **strings** (so no number ever needs the ECMAScript number-to-string rules). `canonicalize` MUST throw `MKR_E_CANON_UNSUPPORTED_VALUE` on: non-integer numbers, integers beyond +-(2^53-1), `NaN`/`Infinity`, `undefined`, `null`, `bigint`, symbols, functions, lone surrogates, and any object with a prototype other than `Object.prototype`/`null`. Rules: no insignificant whitespace; object members sorted by UTF-16 code units of the key; arrays keep order; strings escaped per RFC 8785 section 3.2.2.2 (only `"` `\` and C0 controls; `/` and non-ASCII literal; control characters without a short form as lowercase `\u00xx`). Implementation MUST NOT use `JSON.stringify` for ordering or escaping decisions (it may be used for nothing but number formatting of safe integers, where it is exact). Differs from Perch's CANON v1, which also restricts numbers to `u32`; ours needs ledger numbers and TTLs.

### 3.2 policyHash

`policyHash = lowercase-hex(SHA-256(canonicalBytes(doc)))`, **untagged**, so any external signer can recompute it with a standard JCS library and SHA-256. Interoperability with Perch's `doc_hash` is a non-goal (different schema).

### 3.3 Tagged hashes

Every other hash is `SHA-256(domainTag || bytes)` with the ASCII tags in `src/hash.ts` (`DOMAIN`): `sik-mkr/request/v1\n`, `sik-mkr/intent/v1\n`, `sik-mkr/approval/v1\n`, `sik-mkr/audit/v1\n`, `sik-mkr/auth-plan/v1\n`, `sik-mkr/checkpoint/v1\n`. No tag is a prefix of another. A canonical JSON object starts with `{`, a tag never does, so no tagged preimage equals an untagged policy preimage.

### 3.4 Required test vectors

(a) RFC 8785 section 3.2.2.3 sorting example and the RFC's number/string examples restricted to our subset; (b) at least 20 hand-built edge cases (empty object/array, nested order, astral characters, U+2028/2029, DEL, `/`); (c) vectors from an **independent** implementation (cyberphone/json-canonicalization test data, Apache-2.0 [U: licence and file list to be verified at copy time, G-LICENCE]) filtered to the subset; (d) differential test against a second implementation written by a different agent from this section alone (MKR-001 acceptance).

## 4. Policy evaluation

`evaluate(EvaluationInput): PolicyDecision` is **pure, total and deterministic**; time and prior spend are inputs. Deny by default.

### 4.1 Inputs

`policy`, `policyHash`, `maker` (principal id), `networkPassphrase`, `nodes` (flattened authorised-invocation tree, root first; section 4.3), optional `controlKind`, `nowUnix`, `priorSpend` (rolling totals supplied by the caller from the audit projection).

### 4.2 Algorithm

1. If `nowUnix < notBefore` -> deny `POLICY_NOT_YET_VALID`; if `>= expiresAt` -> `POLICY_EXPIRED`; if passphrase differs -> `NETWORK_MISMATCH`.
2. `maker` MUST be a principal holding `maker` (`MAKER_UNKNOWN`, `MAKER_NOT_MAKER_ROLE`).
3. For each rule decide `matches(rule)`: **every** node in `nodes` must be covered by some target/function of that rule (contract and function equal), recipients (if restricted) must contain the node's recipient, and if `controlKinds` is present the request's `controlKind` must be listed. A rule matches only if all nodes are covered. Partial coverage is not a match (and, if no rule matches, yields `CONTRACT_NOT_ALLOWED` or `FUNCTION_NOT_ALLOWED` or `RECIPIENT_NOT_ALLOWED` for the first uncovered node, for the operator's benefit).
4. If any **deny** rule matches -> deny `DENY_RULE_MATCHED` with that rule id. Deny wins regardless of order. A deny rule matches if **any** node is covered (stricter than allow): denying `mint` anywhere in a tree denies the whole request.
5. Among matching **allow** rules, drop those whose `makers` lacks the proposer (`MAKER_NOT_PERMITTED_BY_RULE`). If none remain -> deny `NO_MATCHING_ALLOW_RULE`.
6. For each remaining rule check limits (4.5) and windows (4.6); a rule that fails is dropped with its reason recorded. If none remain -> deny with the collected reasons.
7. Merge the surviving allow rules into one requirement (4.4).

Rule order is irrelevant by construction.

Additions (2026-11-08): (a) when no allow rule matches, the reported reason is the most specific miss across all allow rules, ranked `CONTRACT_NOT_ALLOWED` < `FUNCTION_NOT_ALLOWED` < `RECIPIENT_NOT_ALLOWED` < `CONTROL_KIND_NOT_ALLOWED` (a rule that covers every node but not the request's control kind), plus `NESTED_CALL_NOT_ALLOWED` when the miss is below the root; ties merge, so the result stays order-independent. (b) The service runs steps 1, 2 and 4 on the root call **before** simulation: a request the policy forbids outright is recorded as `request.policy_denied` with `stage: "pre-simulation"` without asking the network, which also covers calls that would fail simulation (a `mint` on a token whose identity verifier is not wired). The full evaluation on the simulated tree still follows for everything else.

### 4.3 The whole tree is checked

Policy applies to **every** authorised invocation node, not just the root. A transaction can authorise a nested token transfer deep inside another call; signing a transaction authorises all of it. Stratum documents the same hazard in its code: "`needsNonInvokerSigningBy` ignores source-account entries, yet signing the transaction authorises every call in them, including token transfers made deep inside the contract" [P: `tupui/stellar-stratum` `src/lib/contract/invoke.ts`, commit 51f8db9, read 2026-10-31]. The flattening is produced by `planAuth` (7.3) from the simulated entries; a request proposed from an intent alone (before simulation) is re-evaluated with the real tree at planning time and denied with `MKR_E_PAYLOAD_MISMATCH` if the tree differs from the approved `invocationTreeDigest`.

### 4.4 Merged requirement

If several allow rules survive, take the **most restrictive** value of each component: `checkersMin = max`, `adminsMin = max`, union of `from` sets per group, `cooldownSeconds = max`, `windows` = intersection of the rules' windows (a rule without windows contributes "always"). If the intersection of windows is empty or the union `from` set is smaller than the max `min` -> deny `OUTSIDE_TIME_WINDOW` / `NO_MATCHING_ALLOW_RULE`. The merged requirement is **pinned in the request record at proposal time** (5.6).

### 4.5 Limits

`amount` for a node comes from the argument at `amountArg` decoded as an i128 (or u128) base-unit integer. If the argument is absent or not an integer -> `AMOUNT_ARG_UNDECODABLE` (deny; fail closed). `perRequest`: the **sum of amounts per contract across all nodes** MUST be `<= max`. `rolling`: `priorSpend.total + this request's amount <= max`, where `priorSpend` counts amounts of requests in states `approved`, `signed`, `submitted` of the same policy `id` (any version) within `windowSeconds` before `nowUnix`, counted from the time the request reached `approved`; requests that end `rejected`, `expired` or `cancelled` release their amount. Amounts are in the token's base units; no decimals or prices are interpreted. Rolling accounting needs state; it is derived from the audit log projection, never stored separately (single source of truth). [I] An off-chain cumulative limit is only as strong as the layer's authority over the keys (section 0).

### 4.6 Windows

Signing and submission (not proposal or approval) are allowed only inside one of the merged windows, evaluated in UTC at the time of the signing attempt. `evaluate` returns the windows; the state machine enforces them at the `signing_completed` and `submitted` events.

### 4.7 Deny reasons

`DenyReason` in `src/policy/evaluate.ts` is the stable set. Messages are not stable; reasons are.

## 5. Approval workflow

### 5.1 States

`proposed -> approved -> signed -> submitted`, with terminal `rejected`, `expired`, `cancelled`. `submitted`, `rejected`, `expired`, `cancelled` are terminal (`TERMINAL_STATES`). Brief: `proposed -> approved -> signed -> submitted | rejected | expired`; `cancelled` is added so a maker can withdraw (deliberate, noted in TASKS MKR-004).

### 5.2 ActionRequest and Intent

Shapes: `src/workflow/types.ts`, `schemas/action-request.schema.json`. `id = requestHash = TAG_request SHA-256(JCS(request without id))`, so two different requests can never share an id and an id commits to the entire request including `policyHash`, `maker`, `intent`, `unsignedTxXdr` and `nonce`.

`Intent` is what approvers approve. It is **derived by the service**, never supplied as free text by the maker: the maker supplies `{contract, function, args, source}`; the service builds the unsigned transaction with the SDK, simulates it, and computes `invocationTreeDigest` over the canonical form of the authorised tree(s). `ScValJson` is the typed JSON form of a Soroban value: `{type, value}` with 64/128/256-bit integers as decimal strings, `bytes` as lowercase hex, `address` as strkey, `map` as an ordered array of `{key, value}` in XDR order. The mapping both ways is MKR-011 (spike MKR-018 for edge types: `Option`, `Result`, `Duration`, `Timepoint`, tuples). `summary` (clear-signing text) is generated by the kit from the intent; a human-supplied reason is stored only as `reasonHash` and the plaintext lives outside the log (8.4).

### 5.3 Transition table

`applyEvent(record, event, ctx)` is a pure reducer. Illegal events throw `MKR_E_TRANSITION_ILLEGAL`.

| From | Event | Guard | To |
|---|---|---|---|
| (none) | `proposed` | decision.outcome is allow; `request.expiresAt = createdAt + requestTtlSeconds`; maker holds `maker` | `proposed` |
| `proposed` | `approval_recorded` (approve) | S1, S2, attestation valid, approver in a `from` set not yet satisfied, not expired | `proposed`; or `approved` when both groups reach `min` (sets `thresholdMetAt`, `signingEligibleAt = thresholdMetAt + cooldown`) |
| `proposed` | `approval_recorded` (reject) | approver holds checker or admin and is in a `from` set; S1 | `rejected` (one rejection terminates) |
| `proposed`, `approved` | `cancelled` | actor is the maker or holds admin | `cancelled` |
| `approved` | `signature_collected` | now >= `signingEligibleAt`; inside window; slot known (S3) | `approved` (progress) |
| `approved` | `signing_completed` | all slots complete and envelope signature weight met; now >= `signingEligibleAt`; inside window | `signed` |
| `signed` | `submitted` | inside window; not expired; `signedTxXdrHash` matches | `submitted` |
| any non-terminal | `expired` | `nowUnix >= request.expiresAt` | `expired` |

A submit that fails on the network leaves the record `signed` with a `request.submit_failed` audit entry; the request can be retried until it expires or the transaction's own time bounds pass.

### 5.4 Approvals and attestation

An approval is `{statement, attestation}`. `ApprovalStatement` (canonical JSON, then signed) is
`{v:1, kind:"mkr-approval", requestId, policyHash, intentDigest, decision, approver, at, nonce}`. Its message string is `JCS(statement)` and its digest is `TAG_approval SHA-256`.

- `stellar-sep53`: the approver's wallet signs the message string with SEP-53 (`SHA-256("Stellar Signed Message:\n" + message)` signed with the account's ed25519 key) [P: `@stellar/stellar-sdk` 17.4.0 `Keypair.signMessage`/`verifyMessage` doc comments in `lib/esm/base/keypair.d.ts`, read 2026-10-31; SEP-53 text itself not re-read, [U]]. Verification: `Keypair.fromPublicKey(address).verifyMessage(message, signature)` where `address` equals the principal's declared `address`. Via SEP-43 `signMessage` [P: SEP-43 v1.2.1 Draft, read 2026-10-31] wallets differ in how they frame the result (the SEP says "HEX-encoded message derived from the public key and original message", which is ambiguous); a per-wallet conformance spike is MKR-019.
- Storage (2026-11-08): the full approval `{statement, attestation}` (including the SEP-53 signature) is kept in `approval.recorded.data.approval`, so anyone holding the log can re-verify every approval offline; replay re-verifies them (the web console does this in the browser). Transaction and auth-entry signatures stay digests only (8.4).
- `host-asserted`: the host authenticated the caller. Accepted only if the principal's `attestation` list contains it. Recorded as such; reports flag every approval that is host-asserted.

Replay protection: the statement binds `requestId`, `policyHash`, `intentDigest`, `decision`, `approver`, `at` and a `nonce`; an approval cannot be reused for another request, another decision, or after the request is changed (any change changes `requestId`).

### 5.5 Separation of duties (invariants)

- **S1**: the maker of a request MUST NOT approve or reject it, in any group, under any attestation, even if they hold `checker` or `admin`. Enforced in the reducer by comparing `statement.approver` with `request.maker`.
- **S2**: each principal counts at most once per request across both groups; a second approval by the same principal is `MKR_E_SOD_VIOLATION`.
- **S3**: if `separation.makerCannotSign`, the maker MUST NOT contribute any auth-entry share or envelope signature (the signer id is mapped to principals through the signer registry; unmapped signer ids are refused in that mode).
- **S4**: an approver MUST be named in the pinned requirement's `from` list; approvals from other principals are `MKR_E_SOD_VIOLATION` even if they hold the role.
- **S5**: attestation `address` must equal the principal's declared `address`; the audit entry records which scheme was used.
- **S6**: policy registration by an admin is not an approval of a request; an admin who registered the policy version still cannot approve their own request (S1 covers it).

Property tests (TESTING.md) assert S1 to S4 hold for every sequence of events the generator can produce.

### 5.6 Expiry and pinning

The merged requirement and `policyHash` are pinned at proposal. If the policy expires or is superseded afterwards the request completes under the pinned requirement unless it is cancelled; an operator SHOULD cancel requests whose policy was withdrawn for cause (`policy.registered` with `supersedes`, plus an admin `cancelled` event). [I] This avoids a retroactive policy change silently approving or blocking in-flight work; the alternative (re-evaluate on every step) is rejected because approvals would have been given against different rules.

## 6. SEP-57 control-action templates

`buildControlAction(params)` returns a typed invocation, not a transaction. It validates addresses and amount shape, renders the clear-signing summary, and returns the attributes policy matching needs. It does not simulate, sign or propose.

### 6.1 Templates

Function names and argument order are from SEP-57 T-REX v0.4.0 (Draft, updated 2026-09-08) [P: `stellar/stellar-protocol` `ecosystem/sep-0057.md`, read 2026-10-31]. **They match a Draft**; the deployed OpenZeppelin `rwa` crate can differ (spike MKR-018). Checked 2026-11-08 [P: `stellar-tokens` 0.7.1 `src/rwa/mod.rs` in the local cargo registry]: `set_address_frozen(user_address, freeze, operator)`, `freeze_partial_tokens`, `unfreeze_partial_tokens`, `forced_transfer(from, to, amount, operator)` and `Pausable::pause(caller)`/`unpause(caller)` have these names and orders; `set_address_frozen` was executed on testnet through `contracts/rwa-demo` (an OZ 0.7.1 wrapper). The rest of MKR-018 (events, role model, 0.8.0) is open.

| `controlKind` | Function(s) | Arguments (position: name) | Auth | `amountArg` / `recipientArg` |
|---|---|---|---|---|
| `freeze` | `set_address_frozen(user_address, freeze=true, operator)`; partial: `freeze_partial_tokens(user_address, amount, operator)` | 0 user_address: Address; 1 freeze: bool (or amount: i128); 2 operator: Address | `operator` | partial: amountArg 1 |
| `unfreeze` | `set_address_frozen(user_address, freeze=false, operator)`; partial: `unfreeze_partial_tokens(user_address, amount, operator)` | as above | `operator` | partial: amountArg 1 |
| `forced_transfer` | `forced_transfer(from, to, amount, operator)` | 0 from; 1 to; 2 amount: i128; 3 operator | `operator` | amountArg 2, recipientArg 1 |
| `pause` | `pause(caller)` | 0 caller: Address | `caller` | none |
| `unpause` | `unpause(caller)` | 0 caller | `caller` | none |

SEP-57 has no function called "unfreeze": it is `set_address_frozen(..., false, ...)`. The doc comment on `pause` in the Draft reads "Returns true if the contract is paused", which contradicts its signature; treated as a Draft text error [I], recorded as spike MKR-018.

Out of v1 builders but in the Draft: `mint`, `burn`, `recover_balance`, `set_compliance`, `set_identity_verifier`. The example policy denies `mint`/`burn` through this layer on purpose.

### 6.2 Summary text

Examples (generated, not free text): `FREEZE all balances of GABC...WXYZ on token CDEF...1234 (operator GOPS...5678)`; `FORCED TRANSFER 1250.0000000 units from GAAA...BBBB to GCCC...DDDD on token CXXX...YYYY (operator ...)`. The summary lists contract id in full in `facts` (never only an abbreviation), shows the operator, and adds to `warnings` when: the destination of a forced transfer is not in the rule's `recipients`; a freeze targets the operator itself; the `from` and `to` of a forced transfer are equal.

### 6.3 Why policy-check these

SDF's docs state "Transfers and control functions not yet supported in wallets" for SEP-57 [S: quoted in `notes/institutional_tooling_gaps.md` and `canton_vs_stellar_gap_map.md` row 4, from stellar-docs `tokens/anatomy-of-an-asset.mdx`; not re-read here, [U]]. DTCC's own materials describe a root-wallet override and quarterly SEC reporting of its non-corporate-action use [P: via `dtc-kit` profile rows `authorities.dtc-override-root-wallet`, `compliance.quarterly-sec-report-counts`, both `published`]; the audit export (8.8, `--control-actions`) produces the list of control actions that such a report would start from. Nothing in this kit is "DTC-compatible" (G-DTCC).

## 7. Multi-party Soroban authorisation-entry collection

This is the gap `tupui/stellar-stratum` leaves: it refuses calls that need another address's authorisation entry [P: `src/lib/contract/invoke.ts` `buildInvocationXdr`, error text "This call needs an authorization signed by ..., which cannot be collected here. Only calls the source account authorizes by signing the transaction can be built.", commit 51f8db9, read 2026-10-31; the same refusal is stated in `USER_FLOWS.md`]. We do not claim Stratum lacks anything else.

### 7.1 Facts the design rests on

All from the installed SDK `@stellar/stellar-sdk` 17.4.0 type declarations and doc comments, read 2026-10-31 (`lib/esm/base/auth.d.ts`, `lib/esm/contract/assembled_transaction.d.ts`, `lib/esm/rpc/*.d.ts`) unless marked.
1. Credential arms: `sourceAccount`, `address` (legacy), `addressV2` (CAP-71; the address is bound into the signed payload; SDK default for new entries), `addressWithDelegates` (CAP-71-01; one entry signed by the top-level account and/or nested delegates, all signing the **same** payload bound to the top-level address; delegate arrays sorted by address, no duplicates). Simulation never emits the delegates variant; which accounts use delegated authentication is client-side, account-specific knowledge.
2. `sourceAccount` credentials need no entry signature: the transaction envelope signature covers them. `needsNonInvokerSigningBy()` lists addresses with unsigned address credentials and skips source-account ones.
3. Signatures commit to `signatureExpirationLedger`. Changing it clears other nodes' signatures. Simulation returns 0 for it; the client must choose a real value before anyone signs. `checkAuthEntryReadiness` reports `unsignedBy` and `expired` (expiry exclusive).
4. `buildAuthorizationEntryPreimage(entry, validUntil, passphrase)` returns the `HashIdPreimage`; the signing payload is `SHA-256(preimage XDR)`.
5. `authorizeEntry` accepts a `Keypair` or a `SigningCallback` that may return a bare signature, `{signature, publicKey}`, or `{signatureScVal}` (verbatim ScVal for custom account contracts: passkeys, smart wallets).
6. `simulateTransaction(tx, addlResources?, authMode?, useUpgradedAuth?)` with `authMode` in `enforce | record | record_allow_nonroot`.
7. `AssembledTransaction.signAuthEntries` signs sequentially and its doc says "Sending to all `needsNonInvokerSigningBy` owners in parallel is not currently supported!" and that delegates must be signed with `authorizeEntry` and `forAddress`.

### 7.2 Invocation tree digest

`invocationTreeDigest = TAG_intent SHA-256(JCS(tree))` where `tree` is the list (in entry order) of `{credentialType, address (absent for sourceAccount), rootInvocation}`; `rootInvocation` is rendered as `{contract, function, args: ScValJson[], subInvocations: [...]}` recursively. Nonce and expiry are **excluded** (they change on re-plan; the tree of authorised calls is what approvers approve).

### 7.3 Planning (`planAuth`)

1. Build the unsigned `invokeHostFunction` transaction for the intent (source account sequence from RPC).
2. `simulateTransaction` with `authMode: "record"` (and `record_allow_nonroot` as a documented alternative for calls where a non-root frame authorises) [U: which mode a given flow needs is spike MKR-016]. Fail with `MKR_E_SIMULATION_FAILED` including the contract error.
3. Decode each returned entry (`inspectAuthEntry`-equivalent). For `address`/`addressV2` entries create a **slot**; for `sourceAccount` entries record nothing (covered by 7.9).
4. Choose `validUntil = latestLedger + authEntryTtlLedgers` (the same for all slots of the plan), record it as the slot's `signatureExpirationLedger`, compute each slot's `preimageHash` with it. Nonces come from simulation. (2026-11-08: the entry XDR is kept as simulated; signers receive `validUntil` in `SignAuthEntryRequest` and write it with `authorizeEntry`, and verification requires the signed entry's expiry to equal it.)
5. Compute the tree digest; compare with the request's approved digest (`MKR_E_PAYLOAD_MISMATCH`); evaluate policy on the flattened nodes (4.3).
6. Account kinds: `classic` for `G`, `contract` for `C`. For a `G` address whose account has multiple signers read signers/thresholds (`getAccountSigners`) [U: see 7.11].
7. Output `AuthPlan` (`src/auth/types.ts`); `planId = TAG_auth_plan SHA-256(JCS({requestId, unsignedTxHash, slots' (address, nonce, validUntil, digest)}))`; `slotId = planId[0..16] ":" index`.

### 7.4 Slots, signer nodes and the bundle

A slot has one or more **signer nodes** (top-level address first; delegates depth-first for `addressWithDelegates`). Every node signs the same `preimageHash`. `AuthBundle` (`schemas/auth-bundle.schema.json`) carries slots (entry XDR, preimage hash, readable tree text, signer nodes) and `collected` shares. It contains no secrets, may be moved by file, HTTP or QR chunks, and is safe to hand to an untrusted relay because every share is re-verified (7.5).

### 7.5 Collecting and verifying a share

For each slot the host picks a signer adapter whose `addresses()` includes the node address and calls `signAuthEntry` with `entryXdr`, `preimageXdr`, `preimageHash`, `nodePath`, a human `summary`, and the request id (adapter interface, section 9). The adapter MUST show or enforce the summary where it can (capability `clearSigning`). On return `verifyCollectedShare` checks: slot exists and not expired; the returned entry equals the planned entry in every byte except the signature of that node (same address, nonce, expiry, credential type, rootInvocation); for a classic ed25519 node the signature verifies over `preimageHash` for the node's key; for a contract node only structure is checked and validity is established by enforce-mode simulation at assembly (7.7), because `__check_auth` cannot be evaluated locally. Failures: `MKR_E_AUTH_ENTRY_INVALID`.

### 7.6 Merging

`mergeBundles(a, b)` is commutative, associative and idempotent; it refuses different `planId` or `requestId`; per slot it merges shares node by node; two different signatures for the same node are `MKR_E_AUTH_ENTRY_INVALID`. This allows several signers to work in parallel on different slots and bundles to be merged afterwards, which the SDK's sequential flow does not offer (7.1 item 7). Whether parallel signing of the **same** entry is useful depends on the account (7.11).

### 7.7 Assembly

`assembleForEnvelopeSigning`: place the signed entries into the operation's `auth` array in plan order; **re-simulate in `enforce` mode** with the signed entries; fail with `MKR_E_SIMULATION_FAILED` (carrying the contract error) if it does not succeed; apply the returned resource data and fee; refuse (`MKR_E_AUTH_PLAN_STALE`) if any `validUntil` is within `SAFETY_LEDGERS` (12) of the latest ledger. The result is the envelope for source-account signing. Enforce-mode simulation is also the only validity check for contract-account signatures.

### 7.8 Re-planning

When entries are about to expire, `replanAuth` produces a new plan with new `validUntil` and nonces; **all collected shares are discarded** (they commit to the old expiry) and `auth.planned` records the reason. Approvals are NOT discarded when the tree digest is unchanged; they are when it differs.

### 7.9 Source-account credentials and the envelope

Entries with `sourceAccount` credentials, the fee payer and sequence number are covered by the envelope signature(s). The transaction source account may itself be a multisig G account: `TxSignerRequirement` records its signers and thresholds read at `readAtLedger` (spike MKR-016 confirms the weight rule for Soroban operations, [U]). Envelope signatures are requested through `signTransaction` and merged with `addEnvelopeSignature`. v1 (2026-11-08) treats the weight as met when the source account's own key has signed (single-key sources); multisig source accounts wait for MKR-016. For classic multisig threshold collection of a plain transaction, an existing tool (Stratum, Refractor) MAY be used through the XDR hand-off adapter; this layer still owns approvals and audit.

### 7.10 Failure modes (each has a test)

simulation fails in record mode; entry expires between plan and assemble; signer returns an entry for another invocation; signer returns the right entry with a changed nonce or expiry; same node signed twice differently; contract account signature rejected by `__check_auth` (enforce simulation fails); tree changes after approval (RPC state drift changes sub-invocations); maker tries to sign (S3); delegate arrays unsorted or duplicated; signer pending forever (request expires); RPC down (retry, no state change).

### 7.11 Unknowns (spikes)

U1 Does a G account with several signers authorise an address-credential entry with several signatures, with which threshold (medium?) and ordering rules? The SDK says a bare signature "is verified against this address" and mentions multisig accounts whose signing key differs from the credential address, which suggests yes [I], but the host rule is not confirmed [U]. U2 Which `authMode` the RPC needs for flows where a non-root frame authorises. U3 Exact SEP-43 `signAuthEntry` behaviour per wallet (input is a preimage; output is documented as a "signed hash"). U4 Whether Freighter and others implement `signAuthEntry` for contract-token calls [U; the gap map says Freighter mobile lacks it for x402]. U5 Protocol 30 effects on auth (votes 2026-11-03 testnet, 2026-11-23 mainnet [P: docs/ROADMAP.md]).

Observed on testnet 2026-11-08 [P: `fixtures/testnet/e2e-run.json`, freeze tx in ledger 5,622,041]: a call whose authorising address (the token operator, a single-key G account) differs from the transaction source yields one `addressV2` entry in `record` simulation; the entry signed by that second key with `authorizeEntry` at the plan's `validUntil` passes `enforce` simulation and the transaction succeeds. U1 (several signers on one G account) and U2 remain open.

## 8. Audit log

### 8.1 Entry

`AuditEntry` (`src/audit/types.ts`, `schemas/audit-entry.schema.json`): `{version:1, seq, prevHash, at, type, actor, requestId?, policyHash?, data, hash}`. `seq` is gapless from 0. `prevHash` of seq 0 is `GENESIS_HASH` (64 zeros).

### 8.2 Hash

`hash = TAG_audit SHA-256(JCS(entry without hash))`, lowercase hex. Chain integrity: `entry[n].prevHash == entry[n-1].hash`.

### 8.3 Event types and required `data`

`policy.registered {policyHash, supersedes?, registeredBy, doc}`; `request.proposed {kind, controlKind?, headline, request, decision}`; `request.policy_denied {reasons}`; `approval.recorded {approver, decision, scheme, statementDigest}`; `request.threshold_met {thresholdMetAt, signingEligibleAt}`; `auth.planned {planId, slots (address, nonce, validUntil), reason, plan}`; `auth.slot_collected {slotId, nodePath, signerId, signatureDigest}`; `auth.slot_declined {slotId, signerId, reason}`; `request.signed {signedTxXdrHash}`; `request.submitted {txHash, ledger?}`; `request.submit_failed {code}`; `request.rejected`, `request.cancelled`, `request.expired`; `control.built {controlKind, contract}`; `audit.checkpoint {headSeq, headHash, signedBy?, signatureBase64?}`. (2026-11-08: the full PolicyDoc, request, decision and plan are carried so the projection can be rebuilt from the log alone, ARCHITECTURE D1; none of them holds a secret. `approval.recorded` also carries the full approval, see 5.4.)

### 8.4 What is never logged

Private keys, seeds, mnemonics (impossible: no input carries them); raw signatures are stored as digests, not values; the free-text business reason is stored as `reasonHash` only; PII beyond principal ids and labels declared in a PolicyDoc. `actor` is a principal id or `system`. [I] Append-only conflicts with erasure rights; since personal data is not stored, erasure applies to the reason plaintext held outside the log. Counsel to confirm (RISKS R-L2).

### 8.5 Tamper evidence is not tamper proof

A hash chain detects edits and deletions inside the chain but not truncation of the tail or wholesale replacement. Mitigation: `audit.checkpoint` entries (optionally signed by a principal via `signMessage`) and **external anchoring of the head** (`GET /v1/audit/head`) by the operator: a WORM store, a transparency log, or a ledger transaction memo/manageData written by the host [U: no anchoring implementation in v1; interface only]. `verify` accepts an externally supplied anchored head and fails if the log is shorter or differs.

### 8.6 Verification

`AuditLog.verify({fromSeq?, trustedPrevHash?})` re-derives every hash and link and checks `seq` gaplessness and entry shape; reports the first failure (`bad_hash`, `bad_prev`, `bad_seq`, `bad_shape`).

### 8.7 Stores

`AuditStore {head, append(entry, expectedSeq), read(from, limit)}`. `append` is atomic and rejects a stale `expectedSeq` (`MKR_E_AUDIT_APPEND_CONFLICT`) so two writers cannot fork the chain. `MemoryAuditStore` (tests, MKR-008) and `FileAuditStore` (JSON Lines, one canonical entry per line, `fsync` per append, advisory file lock, MKR-007). A database store is an adapter for the host.

### 8.8 Export

`jsonl` (the log itself), `csv` (seq, at, type, actor, requestId, summary), and `--control-actions` (only `control.built` / request lifecycle entries for control kinds, with approvers and attestation scheme).

## 9. Signer adapter interface

`src/signer/adapter.ts` is normative. The kit calls adapters; adapters never give the kit a key. Results are `signed | pending(ticket, pollAfterMs) | declined(reason)` because custody and wallet flows are asynchronous.

### 9.1 Capabilities

`signTransaction`, `signAuthEntry`, `signMessage`, `clearSigning` (`none | basic | full-auth-tree`), `asynchronous`, `contractAccounts`. The kit MUST refuse to route a high-risk request (policy flag in a later version; today: any `control` request) to a signer whose `clearSigning` is `none` unless the host overrides, and always records the capability used in `auth.slot_collected`.

### 9.2 Adapters

| Adapter | Kind | What it wraps | Status |
|---|---|---|---|
| `StubSigner` | stub | Throwaway keypairs from `Keypair.random()` at runtime; scripted sign/decline/pending. Test-only. | MKR-005 |
| `createSep43Adapter` | wallet-sep43 | Any wallet exposing SEP-43 `getAddress/signTransaction/signAuthEntry/signMessage` [P: SEP-43 v1.2.1 Draft, read 2026-10-31] (Freighter, xBull, Lobstr via a Wallets-Kit-style bridge; Stellar Wallets Kit has modules for Ledger, Trezor, D'CENT, OneKey, Lobstr, Fordefi, Ghostsig and others [S: `notes/screen_I4_wallets.md`]). | MKR-020 |
| `createKmsAdapter` | kms | Raw ed25519 over a host-provided KMS/HSM client; produces ed25519 signatures over `preimageHash` and envelope hashes. For custom accounts returns `signatureScVal`. | MKR-021 |
| `createXdrHandoffAdapter` | xdr-handoff | UIs with no API. Exports unsigned XDR, a Stratum import (Stratum accepts import by XDR/SEP-7/QR/Refractor ID [P: Stratum README, commit 51f8db9]), accepts the signed XDR back by file/paste/Refractor poll. Classic-transaction signatures only. | MKR-022 |
| `createCustodyApiAdapter` | custody-api | Fireblocks/BitGo/Taurus-style co-signer APIs; asynchronous. Vendor Soroban support is unconfirmed: Fireblocks' help article says "Soroban tokens are not currently supported" and covers classic assets only [S: `notes/dtc_participant_package_and_requirements.md`, article updated 2026-06-23]. | MKR-023, BLOCKED(vendor access, G-OUTREACH) |

### 9.3 Stratum integration, stated precisely

Stratum is a browser dapp (Vite/React, hosted, Radicle Pages), MIT, copyright Consulting Manao GmbH [P: repo, commit 51f8db9, 2026-10-31]. I found no server component, role model, policy or audit trail in its source (keyword search over `src` for role/policy/audit/approver/proposer/webhook/notif matched only protocol-registry "role" labels and a UI submit-log listener). Integration is therefore **XDR hand-off**: this layer owns the request, approvals and audit; Stratum is where co-signers review and sign classic-envelope signatures, using Refractor (`src/lib/stellar.ts` `submitToRefractor`) as transport if the operator allows a third-party service. It cannot sign auth entries for other addresses (7). No contact with the maintainer was made; any approach is the user's (G-OUTREACH, `drafts/` only).

## 10. HTTP API

Normative file: `openapi/openapi.yaml` (OpenAPI 3.1; paths listed in `test/smoke.test.ts`). Node `node:http`, no framework, JSON only.

### 10.1 AuthN/Z (shape, not mechanism)

`Authorization: Bearer <token>`; the host maps a token to a caller identity and the identity to a principal id. Token issuance, mTLS, OIDC and rate limiting are **host responsibilities** and out of scope. The server binds `127.0.0.1` by default. Authorisation: register policy -> `admin`; propose -> principal with `maker`; approvals -> the approving principal themself (the attestation must match; the HTTP caller identity alone is never sufficient unless the principal allows `host-asserted`); reads -> any authenticated principal named in the policy. No endpoint takes or returns key material.

### 10.2 Endpoints

See the OpenAPI file; summary: policies (register/list/get/evaluate), requests (propose/list/get/cancel/submit), approvals (statement/record), auth (plan/entries/assemble/signatures), control-actions/build, audit (read/head/verify), healthz. (2026-11-08: `POST /v1/requests` also accepts `control` instead of `intent`; `POST /v1/policies` takes `{policy, registeredBy}`. The `/demo/*` routes that `scripts/demo-server.ts` mounts beside the API belong to the demo wallet simulator, hold throwaway testnet keys, and are not part of this API.)

### 10.3 Error mapping

Errors are `{code, message, details?}` with `code` from section 12. HTTP: 400 usage/validation, 403 policy denied or mainnet submit blocked, 404 unknown, 409 illegal transition, 422 guard rejected (SoD, attestation, payload mismatch, simulation), 502 network.

## 11. CLI

Binary `mkr` (`node src/cli.ts`). Commands, flags and tickets are the table in `src/cli.ts` (`COMMANDS`), which is normative for names and flags. Exit codes: 0 ok; 1 denied or verification failed; 2 usage/input error; 3 network error; 70 not implemented. All commands that take `--json` print one JSON document on stdout; diagnostics go to stderr. `--state <dir>` points at a local directory holding the audit log and request projection; the CLI is a thin client over the same library as the server. Nothing in the CLI accepts a key.

## 12. Error codes

`MKR_E_CANON_UNSUPPORTED_VALUE`, `MKR_E_POLICY_PARSE`, `MKR_E_POLICY_INVALID`, `MKR_E_POLICY_UNKNOWN`, `MKR_E_POLICY_DENIED`, `MKR_E_TRANSITION_ILLEGAL`, `MKR_E_SOD_VIOLATION`, `MKR_E_ATTESTATION_INVALID`, `MKR_E_REQUEST_EXPIRED`, `MKR_E_PAYLOAD_MISMATCH`, `MKR_E_AUTH_PLAN_STALE`, `MKR_E_AUTH_ENTRY_INVALID`, `MKR_E_AUTH_SLOT_UNKNOWN`, `MKR_E_SIMULATION_FAILED`, `MKR_E_AUDIT_CHAIN_BROKEN`, `MKR_E_AUDIT_APPEND_CONFLICT`, `MKR_E_SIGNER_UNAVAILABLE`, `MKR_E_SIGNER_DECLINED`, `MKR_E_MAINNET_SUBMIT_BLOCKED`, `MKR_E_USAGE` (`src/errors.ts`). Policy violation codes are the `PD_*` set in 2.5.

## 13. Out of scope (explicit)

Key generation, storage, backup, recovery or ceremony; any UI in the package (the `web/` console added 2026-11-08 is a demo client of the HTTP API, not part of the library); a hosted multi-tenant service; user management and token issuance; sanctions/KYC screening (G-LEGAL); classic-only multisig coordination (Stratum/Refractor do it); on-chain policy contracts and anything depending on OpenZeppelin smart accounts; price/oracle-based limits (limits are base units); time zones other than UTC; mainnet writes by agents (G-VALUE); SEP-8 approval servers; notifications (webhooks are a host concern); a claim that the log is legally sufficient records (counsel, RISKS R-L1).
