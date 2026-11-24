# SOURCES: maker-checker

Trust tags: [P] primary read by an agent with URL/path and date, [S] secondary, [V] vendor, [I] inference, [E] estimate, [U] unverified.

## Discovery notes (`../../../zero-to-one-discovery/notes/`, relative to this project: `/home/ezedikeevan/Desktop/blockchain/stellar/zero-to-one-discovery/notes/`)

| Note | Used for |
|---|---|
| `screen_I4_wallets.md` (primary) | P045 verdict PARTIAL; Stratum facts; SDK epic #1461/#1466/#1606; OZ accounts policies; Tessera; other multisig repos |
| `canton_vs_stellar_gap_map.md` | row 4 "Institutional clear-signing + maker-checker for Soroban auth entries and SEP-57 control actions"; Canton analogues (Console Wallet clear signing, Wallet Gateway) |
| `canton_playbook.md` | maker/checker and clear-signing in the Canton world (read via grep, not in full) |
| `institutional_tooling_gaps.md` | policy/multisig/approval row; SEP-57 control plane row; SEP-8 production kit row (out of scope here) |
| `dtc_participant_package_and_requirements.md` | wallet vendors; Fireblocks/BitGo/Taurus/Blockdaemon status; DTC conversion-order "Pending Approval (Maker/Checker)" |
| `screen_I5_anchors_rwa.md` | SEP-29/SEP-8 context (read via grep; little relevant here) |
| `sdf_adopt_vs_build.md` | adoption pattern, absorb risk |

## External, read by the scaffolding agent on 2026-10-31

| Source | Tag | What was taken |
|---|---|---|
| https://github.com/tupui/stellar-stratum (commit 51f8db9c534c) | P | licence MIT; features; refusal of foreign auth entries (`src/lib/contract/invoke.ts`); no server/role/policy/audit found; Refractor transport |
| https://github.com/stellar-registry/perch (commit 2258433aa340) | P | Apache-2.0; `CANONICAL.md` rules; `crates/perch-ir/src/lib.rs` fail-closed and stateless-limit notes (ideas only) |
| https://github.com/Use-Tessera/tessera (commit 3eab31c327) | P | README: signer-side policy, FROST, Apache-2.0, unaudited |
| https://github.com/stellar/stellar-protocol `ecosystem/sep-0057.md` (v0.4.0 Draft, updated 2026-09-08) | P | control-action function names and arguments; changelog (can_transfer removed) |
| `ecosystem/sep-0043.md` (v1.2.1 Draft) | P | wallet interface methods and shapes |
| `ecosystem/sep-0029.md` (Active 0.5.0), `sep-0008.md` (Active 1.7.4) | P | statuses only (header lines) |
| `@stellar/stellar-sdk` 17.4.0 type declarations (installed here) | P | auth credential arms, authorizeEntry, preimage, authMode, SEP-53 sign/verify |
| GitHub API metadata for Refractor, smart-account-kit, quorum-vault, stellar-multisig-ui, Wallets Kit, WarrantX, SignerReach, Aegis, OZ stellar-contracts (MIT) | P | licence, dates, descriptions |
| RFC 8785 | P (not re-fetched; known standard) | canonical JSON |

## Not read / to be read by tickets

SEP-53 text (MKR-019); OZ `rwa` crate source (MKR-018); Stratum `src/lib/urlState.ts` import format (MKR-022); js-stellar-sdk #1461/#1466/#1606 live state (PRIOR-ART section 5); Soroban host `auth.rs`/`account_contract.rs` for the classic multi-signature rule (MKR-016); cyberphone JCS test data and licence (MKR-001).
