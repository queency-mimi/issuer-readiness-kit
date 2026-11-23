# PRIOR-ART

Searched 2026-10-31 (read-only; GitHub API search, `gh api`; discovery notes re-checked where cheap). Weak evidence: GitHub search is keyword-based, misses Meridian-week hackathon repos and unindexed work, and ignores vendor private repos. Per G-NOVELTY this file must be re-run before anyone writes "first", "novel" or "nobody has built". Novelty here would mean "novel on Stellar".

## Searches run (created >= 2026-01-01 unless stated)

| Query | Hits | Relevant |
|---|---|---|
| "dtcc stellar" | 0 | |
| "dtcc tokenization" | 2 | `blocknetics/rwa-tokenization` (ERC-3643, Ethereum, 0*, no licence), `JamesTsetsekas/digital-securities-settlement` (Ethereum DvP, 0*): not Stellar, not a readiness kit |
| "mock dtcc" | 1 | `zainmorshed/dtcc-mock-service`: a password-expiry mock, unrelated |
| "sep-57 conformance", "sep-8 conformance", "t-rex stellar conformance", "stellar regulated asset test suite" | 0 | |
| "sep-41 conformance" | 2 | `Estamora-Soroban-Layers/estamora-contracts`/`-sdk` (Apache-2.0): escrow and a pre-flight simulation engine, not DTC |
| "dtc participant wallet", "dtc tokenization sandbox", "stellar institution sandbox mock", "tokenization sandbox institution simulator stellar" | 0 | |
| "stellar clawback forced transfer", "stellar allowlist trustline authorize" | 0 | |
| "record date holders snapshot stellar" | 0 | |
| "stellar t-rex compliance" | 1 | `Galmanus/vineland-stellar` (post-quantum compliance module for OZ T-REX, 0*, no licence): a module, not conformance |
| Earlier (discovery, 2026-10-29): "registered wallet allowlist stellar", "DTC participant wallet" | 0 | |
| Stellar org issues for "DTCC" in stellar-protocol, stellar-docs, OZ stellar-contracts, stellar-core | 0 | discovery note |

One query ("registered wallet allowlist stellar") timed out on 2026-10-31 and was not repeated; the discovery run's 0 is the only evidence.

## Adjacent work (what exists, what it misses)

| Project | Last push / licence | Covers | Misses for dtc-kit |
|---|---|---|---|
| `salkimos/Stellar-Preflight` | 2026-10-08 / MIT | ~31 typed receive-check codes for G/M/C destinations, SAC, SEP-41 simulation | No DTC registered-wallet semantics, no SEP-8, no SEP-57 allowlist reads; 0* (per discovery note screen_H_P054) |
| `StellaGate/stellagate` (`stellagate-core`) | 2026-10-19 / Apache-2.0 | ok/warn/block reasons for memo, trustline, SAC | Same gaps; no custom SEP-41 tokens |
| `GautamBytes/stellar-check`, `Eldren-cmd/stellar-send-guard`, `cyber-dawg/portcullis-client` (SEP-8 client) | 2026-09/10 | classic receive checks; SEP-8 client | Not DTC; 0* each |
| `useconcord/concord` | 2026-10-26 / MIT | Issuer-side reconciliation, BENJI run; read-only by design (ADR) | Issuer side, not participant allocation; may add participant features (absorb risk R6) |
| OpenZeppelin `stellar-contracts` (`rwa`, SEP-57 implementation) | 2026-10-24 / MIT | The T-REX token, compliance modules, RWA Wizard | No conformance for DTC rules; generic access-control viewer only |
| SDF `stellar-demo-wallet` | | SEP-8/24/31 test flows | Demo only |
| Canton: LocalNet, cn-quickstart, Denex Localnet (8.5M CC), BitDynamics DevKit (1.9M CC) | | Participant simulators with fake institutions | Canton only; the idea source, not a Stellar competitor |
| DTCC's own PSE environment | | Real pre-production | Participants only; login-gated; the kit cannot replace it, only prepare for it |
| Vendor onboarding bundles: IntellectEU (Canton), Fireblocks, Blockdaemon "Tokenization Starter Kit" | | Node ops, allowlist registration tooling, key custody | Canton only; reconciliation and corporate-action handling not described as vendor deliverables (discovery) |

## Verdicts (from discovery, re-checked read-only today where cheap)

- Participant-simulator sandbox with fake institutions on Stellar: no repo found today; discovery also found none. Weak evidence; consistent.
- Issuer-config linter + conformance suite: PARTIAL in discovery (Assay, Recon overlap, not re-checked today). This project does NOT target the linter for DTC tokens (DTC configures them).
- Participant-side allocation of DTC's consolidated credit: no equivalent found; incumbents (Broadridge etc.) are chain-agnostic and may cover it for large participants (discovery).

## Not searched

SDF org repos beyond the issue searches above; OpenZeppelin issues/PRs; vendor private repos and docs; npm and crates.io for this topic; X/LinkedIn/Discord; DTCC GitHub (if any); repos created before 2026-01-01; non-English repos; Meridian-week hackathon submissions (Devpost). The G-NOVELTY gate is NOT satisfied for any "first" claim: do not make one.
