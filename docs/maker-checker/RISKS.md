# RISKS: maker-checker

Gates: see `../../docs/GATES.md`. Status date 2026-10-31. Likelihood/impact are judgements [I], not measurements.

## Gates that apply

| Gate | Where it bites here |
|---|---|
| G-SECRETS | No key material anywhere; `StubSigner` throwaway keys; lint on seed-shaped strings. |
| G-VALUE (closed) | No mainnet writes by agents; `Submitter` blocks mainnet by default; any pilot holding value needs an audit scope document, a cap and written user approval. |
| G-CRYPTO | Hand-written RFC 8785 canonicalisation is hash-critical. Not cryptography, but treated like it: independent vectors, differential reference, external review before anything holding value depends on the hash. SHA-256 and ed25519/SEP-53 come from `node:crypto` and the SDK. README says DEMO-ONLY. |
| G-LEGAL (closed for hosted/custody; open for local libraries) | Anything that looks like custody, hosted signing, sanctions screening, or retention of personal data. We build the library and local CLI/server only. See "Review before anyone holds keys". |
| G-LICENCE | Stratum (MIT), Perch (Apache-2.0), Tessera (Apache-2.0): ideas only, no code copied. |
| G-NOVELTY | PRIOR-ART carries the search and its limits; no "first" claims. |
| G-OUTREACH | Stratum maintainer, OZ, custody vendors: drafts only (MKR-035, MKR-018, MKR-023). |
| G-DTCC | DTCC maker-checker for its own service is a participant-UI feature [P via note]; no Stellar requirement exists. Never label output "DTC-compatible". |
| G-ZK | Not touched. |

## Risk register

| ID | Risk | L | I | Mitigation / owner |
|---|---|---|---|---|
| R-S1 | Off-chain policy is bypassed by anyone holding a key; users mistake it for custody control. | high | high | SPEC section 0; README banner; no "enforce" wording; recommend on-chain controls (account thresholds, SEP-57 roles) in parallel. |
| R-S2 | TOCTOU: transaction approved, then changed before signing (tree drift, different args). | med | high | Content-addressed request id; approvals bind `intentDigest`; plan re-checks tree digest; enforce-mode re-simulation; MKR-010/011/015. |
| R-S3 | Approval replay or forgery (host-asserted spoofing). | med | high | Statement binds request/policy/intent/decision/approver/nonce; SEP-53 signatures; host-asserted only where the policy allows and flagged in reports. |
| R-S4 | Separation of duties bypass (maker counts as checker; one person two approvals). | med | high | Invariants S1 to S4, property tests (MKR-004). |
| R-S5 | Malicious or buggy signer returns an altered auth entry. | med | high | `verifyCollectedShare` byte-compare except signature; ed25519 verification; enforce-mode simulation for contract accounts. |
| R-S6 | Audit log truncation or wholesale replacement. | med | high | Checkpoints and external head anchoring (MKR-032); verify with anchored head; documented as operator duty. |
| R-S7 | Clock manipulation (cooldown, windows, expiry). | med | med | Time is an input; host supplies a trusted clock; large skew alarms [U: not specified yet]. |
| R-S8 | Parser/canonicaliser differential: two implementations hash the same policy differently, so an external signer approves a different document. | med | high | Subset-only JCS, independent reference, fuzz (MKR-001/030). |
| R-S9 | Log injection or CSV formula injection via labels. | low | med | Labels are bounded and validated; CSV export prefixes risky cells (MKR-024). |
| R-S10 | Supply-chain compromise (`@stellar/stellar-sdk`, ajv). | low | high | Pinned lockfile; minimal deps; review before value. |
| R-T1 | Unknown on-chain rule for multi-signature G-account auth entries (U1) invalidates the classic multi-signer slot model. | med | med | Spike MKR-016 before MKR-013 sizing. |
| R-T2 | SEP-57 is a Draft; OZ implementation differs (arg order, roles). | med | med | Spike MKR-018; templates pin a contract version. |
| R-T3 | SEP-43 wallets differ on `signAuthEntry`/`signMessage` semantics; some cannot sign contract-token auth. | high | med | Wallet matrix (MKR-019); capability flags; adapters mark wallets unusable for approvals when SEP-53 verification fails. |
| R-T4 | Protocol 30 changes auth semantics or fees (votes 2026-11-03 testnet, 2026-11-23 mainnet). | low | med | Re-run MKR-016/031 after the testnet vote. |
| R-T5 | RPC state drift between plan and assembly changes sub-invocations. | med | med | Digest check; re-plan; failure-mode test (SPEC 7.10). |
| R-M1 | SDF ships js-stellar-sdk #1466/#1606 helpers; library pieces become redundant. | med | med | Keep unique value in policy format, SoD, audit; build thin wrappers; re-check each release (PRIOR-ART 5). |
| R-M2 | Stratum adds its own roles/audit, or a contract-based treasury (WarrantX, Aegis) gains institutional users. | med | med | Neutral interop (XDR hand-off); policy/audit format as the portable part; do not compete on UI. |
| R-M3 | No demand: DTC participants buy wallet tooling from custody vendors, not neutral kits (`notes/dtc_participant_package_and_requirements.md`: "Nobody I found sells a DTC-participant readiness product stand-alone"). | med | high | Design partners are custody/wallet vendors; demo with a SEP-57 freeze; do not build more than M7 before a partner exists. |
| R-M4 | Vendor APIs for Soroban signing do not exist (Fireblocks: Soroban tokens unsupported, [S]). | high | med | KMS adapter path (MKR-021); custody adapter BLOCKED. |
| R-L1 | The log is not a legally sufficient record for any regulator's recordkeeping rule. | med | med | Do not claim it; counsel (below). |
| R-L2 | Append-only log vs erasure rights. | low | med | No personal data in the log by design; reason text outside the log; counsel to confirm. |

## Review before anyone holds keys (counsel and security)

We never hold keys. This section lists what must be reviewed **before any operator runs this layer in front of real value, or before anyone builds a hosted variant or integrates a signer that holds keys on someone's behalf**. The scaffold itself touches none of this; the user engages the reviewers (G-LEGAL, G-OUTREACH). Nothing here is legal advice.

### Counsel

1. **Does operating this layer constitute custody or "control" of digital assets** in the operator's jurisdictions, even though no key is held? The service decides when a transaction may be signed and can sequence signers; some regimes look at control, not key possession. Cover: US state money-transmitter and trust-company rules, NYDFS, MiCA (EU), UK, Singapore, as relevant to the first operator [U].
2. **Sanctions and KYC**: this layer does no screening. Does an operator relying on it for approvals create screening obligations at the approval step? (G-LEGAL.)
3. **Recordkeeping**: whether a hash-chained JSON log satisfies books-and-records, SOX or regulator retention rules; retention periods; WORM requirements; who must hold the anchor.
4. **Data protection**: principal ids, labels and any reason text; lawful basis; erasure vs append-only; cross-border transfer if logs are anchored externally.
5. **Liability and wording**: disclaimers ("not custody", "does not enforce on-chain"), indemnities in any open-source licence interplay (Apache-2.0 is as-is), representations made to institutions.
6. **Regulated-asset control actions** (freeze, forced transfer, pause): obligations of the issuer or transfer agent when these are executed; reporting (DTCC describes quarterly SEC reporting of root-wallet use [P via dtc-kit profile row `compliance.quarterly-sec-report-counts`]); whether the audit export is evidence or merely a convenience.
7. **Approval records as electronic signatures**: whether SEP-53 signatures by a wallet key count as approval evidence for internal-controls purposes.
8. **Outsourcing**: if an institution runs this layer via a vendor, the third-party-risk implications.

### Security

1. **Independent code review and audit** of the pure cores (canonicalisation, evaluation, reducer, share verification, merge, audit chain) with the threat model (MKR-028) and a scope document. G-CRYPTO and G-VALUE stay closed until done.
2. **Formal or model-checked state machine**: SoD invariants S1 to S4 in a model (TLA+ or equivalent) in addition to property tests [U: not planned in tickets; recommend adding before value].
3. **Canonicalisation differential review** against at least one independent JCS library.
4. **Signer integration review**: for each adapter, who sees what is signed; clear-signing coverage; behaviour on malicious entries; for KMS, key policy, IAM, key rotation and audit of the KMS side; for custody vendors, their approval policies are separate controls that must not contradict this layer's.
5. **Deployment hardening**: authentication of callers (mTLS/OIDC), network position, secrets handling for tokens (no signer secrets exist in this service), log storage permissions, backup and anchoring, time source.
6. **Key ceremony and recovery are out of scope and unreviewed**: any operator needs their own (HSM ceremony, backup, break-glass).
7. **Penetration test** of the HTTP surface and of the bundle/relay path (malicious bundles).
8. **Dependency and supply-chain review** (`@stellar/stellar-sdk`, ajv dev only, Node version).
9. **Incident response**: runbook (MKR-034) reviewed; drill for "approval given to the wrong request" and "signer compromised".
10. **Protocol dependency review** after Protocol 30: auth semantics, fee model.

## Open questions for the user

1. Which first operator or design partner (custody vendor, DTC participant, issuer) do we build for? Without one, stop after M7 (R-M3).
2. Do you want the audit-anchoring interface to name a specific mechanism (WORM bucket, transparency log, ledger memo)? Left open (SPEC 8.5).
3. Do you accept host-asserted approvals at all, or should the first release require SEP-53 for every approver?
4. Should classic multisig threshold collection stay delegated to Stratum/Refractor (current plan) or be absorbed later?
5. Appetite to send the Stratum note (MKR-035) and a question to OpenZeppelin about SEP-57 argument order (MKR-018)?
6. Engage counsel/security now or after M7? (BUILD-PLAN M8.)

## What would make us stop

- SDF ships the js-stellar-sdk multi-party and readiness helpers **and** a policy/audit layer, or Stratum adds a server-side role/audit model: reassess (R-M1/R-M2); the portable policy and audit formats may still be worth publishing as a spec.
- MKR-016 shows Soroban auth for multi-signer accounts cannot be coordinated headlessly in a useful way.
- Counsel concludes that operating the layer is regulated activity in the first target jurisdiction and no operator will take that on (R-L1, legal item 1).
- No design partner by the end of M7.
- Any need to hold or see a private key to make the design work: that violates ADR-0003; stop and redesign.
