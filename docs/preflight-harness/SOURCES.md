# SOURCES: preflight-harness

Trust tags: [P] primary read by an agent (URL/path and date), [S] secondary, [V] vendor, [I] inference, [E] estimate, [U] unverified.

## Discovery notes (`/home/ezedikeevan/Desktop/blockchain/stellar/zero-to-one-discovery/notes/`)

| Note | Used for |
|---|---|
| `screen_H_P054.md` (primary) | library table, reason-code table (26 reasons), SAC/simulation behaviour (section D), SEP-41/SEP-57/OZ allowlist (E), absorb risk, cheapest first deliverable |
| `screen_I5_anchors_rwa.md` | SEP-29/SEP-8 context (grep) |
| `dtc_participant_package_and_requirements.md` | DTC registered-wallet rows W1..W10, T1..T3; two-step registration; wallet binding choices |
| `canton_vs_stellar_gap_map.md`, `canton_playbook.md` | Canton wallet-requirements checklist as a template for readiness checks (grep) |
| `institutional_tooling_gaps.md` | SEP-8 production kit, travel rule, other adjacent rows (grep) |
| `sdf_adopt_vs_build.md` | "do not ship a sixth library" reasoning, adopt/absorb patterns |

## Sibling project data (read-only; referenced by id, not imported)

`projects/dtc-kit/packages/profile-spec/profiles/dtc-generic.json` and `dtc-stellar.json` (both `version` 2026-10-31, read 2026-10-31) [P]: requirement row ids and statuses used by `src/dtc/scenarios.ts`; the profile disclaimer text.

## External, read by the scaffolding agent on 2026-10-31

| Source | Tag | What was taken |
|---|---|---|
| https://github.com/salkimos/Stellar-Preflight (commit 4599d9c77c66) | P | codes, `Chain` interface, install facts, licence MIT |
| https://github.com/StellaGate/stellagate (HEAD 5cdd7cd6ce95) and npm `stellagate-core` 0.1.1 | P | codes, `check()` inputs, sources interfaces, licence Apache-2.0, installs and loads |
| https://github.com/GautamBytes/stellar-check (HEAD f29a88998378) and npm `stellar-check` 0.1.1 | P | `DiagnosticCode`, `PaymentProvider`, `Report`, docs/diagnostics.md, docs/fixtures.md |
| npm registry (`npm view`) | P | existence/versions/licences; `@stellar-preflight/sdk` and `stellar-preflight` 404 |
| https://github.com/stellar/stellar-protocol `ecosystem/sep-0057.md` v0.4.0 | P | `is_frozen`, `pause`, changelog removing `can_transfer` |
| `sep-0029.md` (Active 0.5.0), `sep-0008.md` (Active 1.7.4) | P | statuses (headers) |
| https://github.com/stellar/js-stellar-sdk issues 1601, 1607, 1624 | P | states: open, milestone Q4, updated 2026-10-05 |
| https://soroban-testnet.stellar.org `simulateTransaction` with an unsigned payment op | P | SIM-1 (testnet) |
| Installed `@stellar/stellar-sdk` 17.4.0 | P | no `preflightPayment`/`minimumBalance` |
| Mainnet RPC `mainnet.sorobanrpc.com` | blocked | scaffold agent's request failed (`fetch failed`); recorded, not bypassed |

## To be read by tickets

`rs-soroban-env` `contract_error.rs` at a pinned commit (PFH-030); OZ stellar-contracts `fungible/extensions/{allowlist,blocklist}` and `rwa` (PFH-033); SEP-8 text and a real `stellar.toml` (PFH-034); SEP-41 text (SIM-11).
