# PITCH: preflight-harness

<!-- SPDX-License-Identifier: Apache-2.0 -->

One page, written 2026-11-08. Trust tags: [P] primary, recorded in this project; [S] secondary; [I] inference; [E] estimate; [U] unverified.

## Problem

Before a wallet, custodian or tokenisation platform sends an asset on Stellar, it has to know whether the destination can actually receive it. Does a trustline exist, and is it authorised (or only allowed to maintain liabilities)? Is there room under the limit? Is the account funded? Is a memo required, and is it a contract address? Getting this wrong means a failed payment, or for a regulated asset a compliance problem.

- Small open-source libraries now answer the question, each differently: Stellar-Preflight (32 reason codes), stellagate-core (25), stellar-check (18) [P: inventories checked against source, `PRIOR-ART.md`, 2026-10-31]. All are weeks old with 0 stars [P].
- The Stellar JS SDK has the feature queued but not shipped: js-stellar-sdk issues #1601 (payment preflight and reserve math), #1607 and #1624 were open with milestone Q4 as of 2026-10-31 [P: GitHub API].
- No one publishes how these answers compare with what the ledger actually does. We found no differential harness among the repos searched [I: bounded search, `PRIOR-ART.md` section 4].

## What it does

1. Seeds receive situations on **Stellar testnet** with throwaway keys, captures the ledger state read-only, and records ground truth: the real Horizon result of a payment, or a `simulateTransaction` outcome for SAC cases.
2. Replays each recorded state through each library's **own code**, offline, via its injection point.
3. Normalises every answer to one 70-code taxonomy and reports three kinds of finding: libraries disagree, a library is silent on a reason the state requires, a verdict differs from the case author's trust-tagged expectation, or a verdict contradicts a recorded ledger or simulation result (none did in this run).
4. Ships a DTC registered-wallet readiness scenario pack (12 scenarios) in dtc-kit's ScenarioPack format, tagged by the weakest requirement row it rests on. It is DTC-shaped and **not DTC-certified**.

## Who it is for

Wallet and custody teams choosing or validating a receive check; the library authors (a shared conformance set); SDF, as a test bed for the queued SDK preflight; tokenisation teams preparing for DTC-style registered-wallet flows. None of these groups has been consulted (R12 in `RISKS.md`).

## Measured today (all from `pnpm report` over committed fixtures)

| Figure | Value | Tag |
|---|---|---|
| Recorded testnet cases | 29 (ledgers 5,622,268 to 5,622,359, captured 2026-11-08) | [P] |
| Cases with a real testnet payment result / recorded simulation / no ledger-derivable result | 18 / 7 / 4 | [P] |
| Libraries executed | 2 of 3 (stellagate-core 0.1.1, stellar-check 0.1.1). Stellar-Preflight is wired but not run: executing it awaits the owner's opt-in | [P] |
| Row agreement | 15 unanimous, 3 split, 7 single-library, 4 not compared | [P] |
| Findings | 5 disagreements, 14 gaps (13 omitted reasons, 1 abstention), 2 differing from the authored expectation ([I] and [U] tagged, not recorded results), 0 contradicting a recorded result, 1 informational | [P] |
| Contradictions of a recorded Horizon result on a blocking case | 0 | [P] |
| DTC scenarios evaluated against recorded cases | 11 of 12 (1 needs a SEP-57 token on testnet) | [P] |
| ScenarioPack validation against dtc-kit's published schema | 0 errors | [P] |
| Harness test suite | 86 tests: 85 pass, 1 skipped (the opt-in Stellar-Preflight test) | [P] |

One concrete example: paying the asset's own issuer **succeeded** on testnet (tx `e400a3604254...`, ledger 5,622,275). stellagate-core said "can receive", stellar-check said "unknown", and neither reported that such a payment burns the asset [P].

## Why Stellar

Stellar's receive rules are rich and have a lot of state: trustline authorisation levels (including maintain-liabilities-only), issuer flags (AUTH_REQUIRED, REVOCABLE, CLAWBACK), reserves and liabilities, SEP-29 memos, muxed accounts, and SAC balances for contract addresses. That makes "can it receive?" a real question with a ledger-verifiable answer. Testnet plus RPC simulation make it cheap to record ground truth without risking value.

## Roadmap

1. Run Stellar-Preflight (one opt-in command), so the matrix has three columns.
2. SEP-41, allowlist and SEP-57 token cases on testnet (needs a licence-checked OZ token build; PFH-021, PFH-033).
3. Read-only mainnet cases, such as a regulated SEP-8 asset discovered by reading `stellar.toml` only (PFH-023, PFH-034).
4. Drift check after testnet resets (PFH-025), plus a disagreement minimiser and drafts of upstream issue texts (PFH-035, PFH-036). The drafts are for the owner to decide on; nothing gets posted.
5. When the SDK's `preflightPayment` ships, add it as a fourth adapter.

## Risks and gates

Libraries may change or vanish (pinned versions, inventory check). Taxonomy mapping choices are inferences (one table, shown beside the verbatim library codes). Testnet resets break explorer links but not fixtures. Demand is unproven. Gates: no mainnet writes ever, testnet writes only with runtime throwaway keys, no DTC-compatibility claims (G-DTCC), no outreach to library authors (G-OUTREACH). The harness is not a new receive-check library.

## What launch needs

A static host for `web/dist` (no backend). Optionally publish the harness as an npm package, or as a GitHub Action that runs `pfh run --fail-on-findings` in a library's CI. No contract deployment and no audit is needed for the harness itself; the token cases in the roadmap need testnet-only contracts. Details are in `DEPLOY.md`.
