# SOURCES

Trust tags: [P] primary, [S] secondary, [V] vendor, [I] inference, [E] estimate, [U] unverified. Map of discovery notes: `../../docs/SOURCES.md`. Notes are research output, not truth; every note ends with "what I did not check".

## Discovery notes used (`../../../zero-to-one-discovery/notes/`, i.e. `/home/ezedikeevan/Desktop/blockchain/stellar/zero-to-one-discovery/notes/`)

| Note | Date | Used for |
|---|---|---|
| `dtc_participant_package_and_requirements.md` | 2026-10-29 | PRIMARY INPUT. Sections 2.3 (requirement tables W1-W10, T1-T9, O1-O5) -> profile rows; 2.4/2.6 -> Stellar rows; 3 -> primitive mapping; 4 -> architecture and profile fields; 5 -> blocking analysis; 6 -> vendor table |
| `meridian_dtcc_update.md` | 2026-10-29 | DTCC FAQ facts (detokenise before record date, free-of-value), Protocol 30 dates, networks live |
| `institutional_onboarding_screen.md` | | Onboarding steps, SEP-8 and token-model choices, wallet/custodian lag |
| `institutional_tooling_gaps.md` | | Needs matrix: SEP-8 server/client gaps, participant books gap, vendor state |
| `canton_playbook.md`, `canton_vs_stellar_gap_map.md` | | Sandbox-with-fake-institutions idea (item 2), wallet checklist template |
| `corporate_action_payout_engine.md` | | Why an issuer payout planner does not apply to DTC tokens; participant allocation reframe |
| `sdf_adopt_vs_build.md` | | Adoption evidence: audited, open source, live, neutral, repeat partner |
| `screen_H_P054.md` | 2026-10-31 | Receive-check prior art, SAC error codes (e.g. 'balance is deauthorized' #11), contract-address facts |
| `IDEA_REGISTER.md` section C0 | 2026-10-29 | Strategy shortlist rows 1 (DvP standard, deferred), 2 (participant simulator = this project), 3 (linter/conformance) |

## Primary sources behind profile rows (URLs also inside the profile files)

| Source | Tag | Read by whom, when |
|---|---|---|
| SEC no-action letter to DTC, 2025-12-11 (Preliminary Base Version) https://www.sec.gov/files/tm/no-action/dtc-nal-121125.pdf | P | Discovery agent 2026-10-29 via a saved copy (403 to curl; not worked around). NOT opened at scaffold |
| DTCC tokenization hub FAQ https://www.dtcc.com/products-and-services/digital-assets/tokenization/hub | P | Discovery 2026-10-29 |
| DTCC tokenization product page https://www.dtcc.com/products-and-services/digital-assets/tokenization | P | Discovery 2026-10-29; **re-read at scaffold 2026-10-31: tile "Token standard SEP-41", sentence "Stellar (SEP-41) and Arc from Circle (ERC-20) are anticipated in 2027"** |
| DTCC Tokenization Service At-a-Glance PDF https://communications.dtcc.com/rs/669-QIL-921/images/DTCC%20Tokenization%20Service%20At-a-Glance.pdf | P | Discovery |
| DTCC L1/L2 evaluation framework (updated 2026-08-12) https://files.dtcc.com/download/assets/evaluation-framework-l1-l2-blockchain-networks.pdf/8e9c53b2965e11f19a98ca3087bcb34c | P | Discovery |
| DTCC Learning Center help pages `https://dtcclearning.com/helpfiles/dda/tokenization_service/Content/Topics/tokenization_srvc/{welcome,register_wallets,register_a_wallet,accounts_oct_rev,conversion_orders,corp_actions_overview,corp_actions_workflow,service_accounts,members,glossary}.htm` | P | Discovery 2026-10-29; `corp_actions_workflow.htm` and `conversion_orders.htm` re-read 2026-10-31 (8:00 pm ET Position Capture sentence; "does not allow fractional tokens"; forced reconversion note) |
| SEP-41 Soroban Token Interface, Draft v0.5.2 (updated 2026-08-24) https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0041.md | P | Header and `transfer(from, to: MuxedAddress, amount)` read 2026-10-31 via `gh api` |
| SEP-57 T-REX, Draft v0.4.0 (updated 2026-09-08) https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0057.md | P | Function list read 2026-10-31 via `gh api` |
| SEP-8 Regulated Assets, Active v1.7.4 (updated 2022-02-21) https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0008.md | P | Header read 2026-10-31 |
| SDF docs: control asset access https://developers.stellar.org/docs/tokens/control-asset-access ; anatomy of an asset https://developers.stellar.org/docs/tokens/anatomy-of-an-asset | S | URLs return 200 on 2026-10-31; content cited via the discovery notes' local mirror, not re-read |
| Vendor documents (Fireblocks help, BitGo docs, Taurus CAPITAL, Blockdaemon docs) | V / P (docs) | See `readiness-pack/wallet-vendor-matrix.md` |

## Not read (login-gated or blocked)

DTCC API Reference Guide, Wallet Solution Provider Connectivity Guide, Onboarding Checklist, Client Readiness Checklist (Canton and Besu), launch Q&A deck, Tear Sheet and Roadmap; the DTCC Technical Readiness checklist on the Canton page (Google sign-in). sec.gov by curl (403). Fireblocks support page HTML (403 to curl/WebFetch in discovery; text came through the public Help Center JSON endpoint, flagged there as a possible workaround). None of these were accessed by the scaffold.

## Re-verification table

Filled by DTC-006: one line per `published` row with the supporting quote and date.
