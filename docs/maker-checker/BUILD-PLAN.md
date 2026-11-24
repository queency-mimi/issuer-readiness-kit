# BUILD-PLAN: maker-checker

All durations are estimates [E] for one agent session each, not measured. "Needs the user" items are gates or decisions an agent cannot take (G-OUTREACH, G-LEGAL, G-VALUE).

| Milestone | Scope (tickets) | Exit criteria (all checkable by command) | Est. [E] | Needs the user |
|---|---|---|---|---|
| M0 Scaffold | this repo state | `pnpm install && pnpm check` green; smoke test passes; docs read in order by a fresh agent without questions | done | go/no-go on Phase 1 scope (`docs/ROADMAP.md` decision 1) |
| M1 Pure core | MKR-001..005 | policy fixtures parse/validate/hash; evaluate and reducer property tests pass; independent JCS check passes; StubSigner works | 4-6 days | none |
| M2 Offline workflow | MKR-006..009 | `scripts/demo-offline.ts` runs propose, two SEP-53 approvals, cooldown, audit verify; CLI request commands work with `--state`; projection rebuilds from the log | 4-6 days | none |
| M3 Soroban collection (offline) | MKR-010..015, 011 | plan/bundle/merge/assemble pass against SDK-built entries; failure-mode list in SPEC 7.10 each has a test | 7-9 days | none |
| M4 Testnet truth | MKR-016, 018, 019 (spikes) | SPEC 7.11 unknowns U1/U2 answered with `[P]` evidence and fixtures; SEP-57 templates verified against the OZ crate; wallet matrix written | 4-5 days | a human with browser wallets for some MKR-019 rows |
| M5 Adapters | MKR-017, 020, 021, 022 | SEP-43, KMS, XDR hand-off adapters pass interface contract tests; control builders feed `evaluate` | 5-7 days | none |
| M6 Service | MKR-024..027, 029 | HTTP server passes OpenAPI conformance; export and registry done; submitter refuses mainnet by default | 6-8 days | none |
| M7 Testnet demo | MKR-031, 032 | `scripts/e2e-testnet.ts` freezes an address on testnet through maker/checkers/admin and a second signer's auth entry; audit verifies; transcript saved | 3-4 days | testnet only; no approval needed |
| M8 Hardening and review prep | MKR-028, 030, 033, 034, 035 | threat model reviewed; fuzz clean; runbook; review package assembled | 5-6 days | **counsel and security reviewer engagement (G-LEGAL); decision to send the Stratum note (G-OUTREACH)** |
| M9 (not scheduled) | custody API adapter (MKR-023); mainnet pilot | vendor sandbox access; audit scope document; value cap; written user approval (G-VALUE) | n/a | everything |

Critical path: MKR-001 -> 011 -> 010 -> 012 -> 013 -> 015 -> 031. MKR-016 (spike) should start in week 1 because it can change the shape of 013.

## What this plan does not include

No UI; no hosted service; no key custody; no on-chain contracts; no mainnet. If SDF ships the helpers in js-stellar-sdk #1466/#1606 (SOURCES), M3 shrinks (decode and readiness checks) and the unique value concentrates in M1, M2, M7 and the audit log; revisit after each SDK release.

## Calendar anchors

Protocol 30 votes 2026-11-03 (testnet) and 2026-11-23 (mainnet) [P: `docs/ROADMAP.md`]; re-run the testnet spikes after the testnet vote. DTCC lists Stellar as expected 1H27 [per the profile rows in dtc-kit, status `inferred`]; no maker-checker requirement from DTCC on Stellar is published (G-DTCC): the DTCC roadmap lists SSO/maker-checker for its own service [P via `notes/canton_vs_stellar_gap_map.md` row 4] but that is DTCC's participant UI, not a chain requirement.
