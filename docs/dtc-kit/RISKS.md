# RISKS

Gates from docs/GATES.md, status 2026-10-31: G-DTCC (Stellar rows `inferred`/`unknown`; generic rows `published`), G-LEGAL (closed for hosted anything; open for libraries and local-first tools), G-VALUE closed, G-SECRETS applies, G-LICENCE (nothing copied), G-OUTREACH (agents draft), G-NOVELTY (see PRIOR-ART), G-ZK/G-CRYPTO (not touched).

## Top risks

| # | Risk | Likelihood / impact [E] | Mitigation | Gate |
|---|---|---|---|---|
| R1 | DTCC publishes Stellar requirements that contradict an `inferred` row (token form, address binding, force-transfer mechanism) | Medium / High | Rows are data with `candidates`; scenarios are gated on rows and tagged by weakest row; two adapters; DTC-040 runbook | G-DTCC |
| R2 | The spec never becomes public (checklists and guides are login-gated): the kit stays "DTC-shaped" forever and cannot certify | Medium / High | Treat the kit as readiness + vendor tooling, not certification; choose a design partner (wallet/custody vendor) early | G-DTCC |
| R3 | Misread as an official or compatible tool; a vendor or participant relies on it as DTCC's | Medium / High | Fixed disclaimer in every output, header on every HTTP response, profile `disclaimer` required by schema; fictional institutions with "(FICTIONAL)" names | G-DTCC, G-LEGAL |
| R4 | Rows copied from discovery notes are stale or wrong; only five clauses were re-read at scaffold | Medium / Medium | DTC-006 re-verify; `via` field records provenance; downgrade rule | G-DTCC |
| R5 | Stellar facts in the SAC matrix were all from notes at scaffold. 2026-11-08: six cells now P from the recorded testnet run (atomic clawback+payment, allowlist, deny codes, mint, burn, fractional payment); freeze direction, global pause and SAC contract-call errors are still I/S/U | Low / Medium | Remaining cells need their spikes (DTC-023 live path, DTC-027, DTC-028) | G-NOVELTY |
| R6 | Absorb risk: SDF, OZ, Concord, Fireblocks/Taurus or DTCC itself build the same thing (SDF adopts audited, live, neutral work; DTCC has the real certification environment) | Medium / Medium | Small, vendor-neutral, upstreamable packages (profile schema, ScenarioPack, matrices); offer pieces upstream rather than a platform | |
| R7 | Demand is unproven: no buyer, price or willingness to pay observed; participants cannot hold Stellar DTC tokens before DTCC opens Stellar to testing (plausibly Q1 2027 [I]) | High / High | Stage-gate (user decision after M1/M2); first customers are vendors, not participants; demand gate before large investment | |
| R8 | Sanctions-screening exposure: the sandbox "OFAC" feature might be mistaken for a screening service | Low / High | Only a fictional hard-coded list id; no real list fetched or shipped; no hosted service | G-LEGAL |
| R9 | Reconciliation depends on `HoldersSnapshot`; its schema can change (minor bump changes the `$id`) | Medium / Low | 2026-11-08: mapping validates against the holders-at-ledger schema read from disk, no copy; a schema change fails validation loudly | |
| R10 | Interpreting chill/lock semantics wrongly (only the names are public) | Medium / Medium | Row `wallet.control-state-semantics` is `inferred`; scenarios SC-015..017 tagged `@inferred` | G-DTCC |
| R11 | SEP-57 and SEP-41 are Draft and moving (v0.4.0 updated 2026-09-08; v0.5.2 updated 2026-08-24) | High / Low | Watcher DTC-031; matrices record the version read | |

## Unverified (2026-11-08)

- docker-compose and the Dockerfile were not run (no docker on the machine). Quickstart image tag and flags unknown.
- SEP-57 behaviour (freeze x forced_transfer x pause, decimals 0) is not observed; the SEP-57 adapter only plans.
- A live `--target testnet` path in the runner does not exist; testnet evidence is one recorded spike run (2026-11-08), replayed.
- `published` generic rows other than the five re-read on 2026-10-31 are as recorded in discovery notes dated 2026-10-29 (DTC-006).
- The SEC no-action letter was not opened by this project (403 to curl in discovery; not worked around).
- The reconciliation maths is tested (property tests) but not independently reviewed.
- R11 new: the sandbox's chill, lock and out-of-hours behaviour is our reading; every output built on it is labelled inferred or unknown.

## Open questions for the user

1. Go/no-go on Phase 1 scope (docs/ROADMAP.md decision point 1), given R7.
2. Who contacts DTCC/SDF about the contract-address question and the token form? Drafts: DTC-028 (`drafts/dtcc-questions.md`), DTC-029 (vendors). Agents never send (G-OUTREACH).
3. Is a wallet or custody vendor the intended first design partner (discovery recommends it), and which?
4. Should a linter/formatter be added (none configured)?
5. Can the user supply the SEC no-action letter PDF for DTC-006 (sec.gov blocks curl)?
6. ADR for the ScenarioPack contract (DTC-039) belongs in programme docs: approve?

## What would make us stop

- DTCC states publicly that participants/wallet vendors must use only DTCC-provided test tooling and certification, with no third-party readiness tooling: then pivot to vendor-side conformance only.
- DTCC picks a token form the profile cannot express (a structural schema gap): redesign the profile, not the code.
- A prior-art search (PRIOR-ART.md, rerun before any "first" claim) finds an adopted, maintained equivalent: contribute upstream instead of building.
- Legal advice that the sandbox or reconciliation module creates exposure (G-LEGAL).
- No design partner and no DTCC movement by the end of M2, per the user's call.
