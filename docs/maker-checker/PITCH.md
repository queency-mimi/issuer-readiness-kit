# maker-checker: approvals and evidence for multi-party Soroban signing

<!-- SPDX-License-Identifier: Apache-2.0 -->

DEMO-ONLY, testnet only, unaudited (gates G-VALUE and G-CRYPTO closed). Trust tags: [P] primary source read, [S] secondary, [I] inference, [E] estimate. Dated 2026-11-08.

## Problem

- Institutions run four-eyes control over payments and control actions. On Stellar today the signing tools do not carry that workflow:
  - The main open multisig UI, `tupui/stellar-stratum`, refuses calls that need another address's authorisation entry ("This call needs an authorization signed by ..., which cannot be collected here") and has no roles, policy or audit trail in its source [P: commit 51f8db9, read 2026-10-31; PRIOR-ART 1.1].
  - The SDK signs those entries one after another and says parallel signing for several owners "is not currently supported" [P: `@stellar/stellar-sdk` 17.4.0 `assembled_transaction.d.ts`].
  - SEP-57 control functions (freeze, forced transfer, pause) are "not yet supported in wallets" per SDF docs [S: quoted in discovery notes, not re-read]; Fireblocks' help says Soroban tokens are not supported [S: article dated 2026-06-23].
  - DTCC's materials describe a root-wallet override and quarterly SEC reporting of its non-corporate-action use [P via dtc-kit profile rows, status `published`]. That report starts from a record of who approved each control action.
- What I did not find (bounded search, PRIOR-ART section 3-4): a headless, vendor-neutral layer that combines a hashed policy, enforced separation of duties, multi-party auth-entry collection and a hash-chained audit log. Absence of evidence only; no "first" claim.

## What it does

A library, HTTP API and CLI that sit between people and signers:
propose (the service builds and simulates the call, so approvers approve the real authorised tree) -> approve (SEP-53 signatures over a canonical statement; the maker can never approve; nobody counts twice) -> cooldown and signing windows -> collect the auth entries other addresses must sign, verify each against the plan -> enforce-mode simulation -> envelope signature -> submit. Every step appends to a hash-chained log from which the state is rebuilt.

It holds no long-lived keys and is not custody. **Its rules are enforced off-chain; a key holder can bypass them.** On-chain controls (account thresholds, smart-account policies, SEP-57 roles) stay necessary.

## Who it is for

Issuers and operators of regulated tokens (SEP-57 / T-REX style), treasury teams at firms holding Stellar assets, and wallet or custody vendors who want a neutral policy and audit format rather than building one.

## Working today (measured, tagged)

| Fact | Value | Source |
|---|---|---|
| End-to-end SEP-57 freeze through the API on testnet | succeeded; `is_frozen = true` read back | [P] testnet run, freeze tx `be6b6fea…` ledger 5,622,041, 2026-11-08 (`fixtures/testnet/e2e-run.json`) |
| Scripted rule violations in that run, each refused with a stable error code, none reaching the chain | 8 of 8 (deny rule, per-request cap, recipient list, S1, S2, a signature over a different statement, cooldown, S3). Scripted attempts, not a hit rate. Two had a key sign first and were refused anyway (step 9, step 14) | [P] same run |
| Auth entry collected from a second signer, accepted by enforce-mode simulation | 1 `addressV2` entry | [P] same run |
| Proposal to on-chain freeze | 45 s, including a 20 s policy cooldown | [P] same run (audit entry time to ledger close time) |
| Second freeze driven from the web console | succeeded, ledger 5,622,359 | [P] live session, 2026-11-08 (not kept as a fixture) |
| Automated tests | 70 TS tests + 4 contract tests passing | [P] `pnpm check`, `pnpm contract:test`, 2026-11-08 |
| Canonical hash agreement with an independent implementation | byte-equal on the example policy and 300 generated documents | [P] `test/canonical.test.ts` vs `scripts/jcs_reference.py` |

## Why Stellar

Soroban authorisation entries let one transaction carry signatures from several addresses, each bound to an exact invocation tree and an expiry. That makes "approve exactly this tree, then collect exactly these signatures" checkable byte for byte, which is what this layer does. SEP-57 gives regulated tokens a standard control surface to template. DTCC lists Stellar among networks it expects to support [inferred per dtc-kit profile rows; G-DTCC].

## Roadmap

1. Real signers: SEP-43 wallet adapter with a per-wallet conformance matrix (MKR-019/020), KMS adapter (MKR-021), Stratum XDR hand-off (MKR-022).
2. Multisig source and authorising accounts (MKR-016), delegate entries (MKR-040), re-plan on expiry (MKR-014).
3. Hardening: threat model, fuzzing, OpenAPI conformance, audit anchoring (MKR-028/030/029/032), runbook (MKR-034).
4. Review package for counsel and a security auditor (MKR-033), then a capped pilot.

## Risks and gates

- Mistaken for custody control (R-S1): mitigated by wording in every surface; the limit is printed on each view.
- The SDK may absorb the low-level helpers (R-M1): the durable value is the policy format, the separation-of-duties state machine and the audit format.
- Demand may sit with custody vendors (R-M3); vendor Soroban signing APIs are unconfirmed (R-M4, MKR-023 BLOCKED).
- SEP-57 is a Draft (R-T2). The log is not claimed to satisfy any recordkeeping rule (R-L1, counsel).
- Gates: G-VALUE (no mainnet writes; mainnet submit refused by default), G-CRYPTO (no hand-written primitives; audited `@noble/hashes` and the Stellar SDK), G-LEGAL (counsel review before anyone holds keys), G-OUTREACH (no contact made).

## What launch needs

Hosting for the static console (recorded tabs work offline); npm publication of `@sik/maker-checker` once the API is frozen; an external security audit of the policy, state machine and auth-entry verification; counsel review of the audit-log claims; real signer adapters. Details in `DEPLOY.md`.
