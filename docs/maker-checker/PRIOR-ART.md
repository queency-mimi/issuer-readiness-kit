# PRIOR-ART: maker-checker

Searched 2026-10-31 (G-NOVELTY). Method: read-only `gh api` repository metadata and shallow clones (never executed) for the repos below; GitHub repository search with `created:>=2026-01-01` for six queries (counts in section 3); installed-SDK type declarations; the discovery notes (re-checked where cheap). Trust tags per `docs/AGENT_GUIDE.md`. **Nothing here supports the words "first", "novel" or "nobody has built"**: earlier verdicts in this programme were wrong repeatedly (AGENT_GUIDE, Pitfalls), and section 4 lists what was not searched.

## 1. What exists

### 1.1 `tupui/stellar-stratum` (the signer UI this layer sits on top of)
- Facts [P: GitHub API 2026-10-31; clone at commit `51f8db9c534c`, read 2026-10-31]: created 2025-08-31, last push 2026-10-27, 4 stars, not archived, **licence MIT** (`LICENSE`, "Copyright (c) 2025 Consulting Manao GmbH"; `package.json` `"license": "MIT"`). Browser dapp (Vite, React); deployment via Radicle Pages (README). The shallow clone shows one commit; history was not examined.
- Covers (README + code): multisig configuration with lock-out checks; review before signing (operations in words, asset issuers, config changes, nested token transfers inside contract calls, tx hash); signature verification per account; sharing via Refractor links or air-gapped QR (`src/pages/AirgapSigner.tsx`, `submitToRefractor` in `src/lib/stellar.ts`); wallets Freighter, xBull, Albedo, Lobstr, Ghostsig, Ledger, Trezor and others; contract calls for any Soroban contract incl. SACs (`src/lib/contract/invoke.ts`); import by XDR/SEP-7/QR/Refractor ID; 24 h transaction validity.
- **Refuses calls that need another address's authorisation entry** [P: `src/lib/contract/invoke.ts` `buildInvocationXdr`, the error string quoted in SPEC 7; `USER_FLOWS.md` says the same].
- What I did **not** find: a server, role model, proposer/approver separation, policy (limits, allow-lists), audit log, notifications. Basis: directory listing and a keyword search over `src` (role, policy, audit, approver, proposer, webhook, notif) which matched only protocol-registry "role" labels (`src/lib/protocols/registry.ts`) and a UI submit-log listener (`src/lib/submitLog.ts`). Absence in a shallow read is not proof; the maintainer may have unpublished work. Discovery note agrees [S: `screen_I4_wallets.md`].
- Licence consequence: permissive; we do not copy code (G-LICENCE), we integrate by XDR hand-off. Not in `docs/THIRD_PARTY.md` because nothing is copied.

### 1.2 `stellar-registry/perch` (policy IR, read for ideas)
- Facts [P: API + clone commit `2258433aa340`, 2026-10-31]: created 2026-08-07, last push 2026-10-28, 1 star, **Apache-2.0**. "Composable policy layer for Soroban smart accounts: declarative policy IR, Rust+TS builders, lowering onto OpenZeppelin stellar-accounts."
- Ideas taken (reimplemented, nothing copied): canonical JSON with content hash as the identity of a reviewed policy (`CANONICAL.md`: RFC 8785 subset, `doc_hash = SHA-256(canonical bytes)`, domain-separated fragment hashes); fail-closed parsing (unknown fields, duplicate keys, unknown enum tags rejected; all violations collected); the explicit statement that per-invocation predicates cannot express cumulative limits and need a stateful sibling (`crates/perch-ir/src/lib.rs` header, issue #4). Differences: Perch lowers to on-chain OZ smart-account policy rules; ours is off-chain workflow with roles, approvals and an audit log, independent of OZ accounts. Perch's canonical form allows only `u32` numbers; ours needs ledger numbers and TTLs and uses strings for amounts.
- Not examined: Perch's recovery, ZK and relay packages; its audit status beyond `docs/audit-scope.md` existing.

### 1.3 `Use-Tessera/tessera` (policy at the signer)
- Facts [P: API + clone commit `3eab31c3`, README read 2026-10-31]: created 2026-10-06, last push 2026-10-28, 1 star, Apache-2.0. "Threshold signing for Stellar: FROST signers that enforce their own policy. Rust core, policy engine, signer daemon and CLI." Any t of n parties sign as one ordinary account; each signer decodes the transaction (the README's browser checker also takes a Soroban authorization entry), checks a `policy.toml` (deny by default, per-transaction and periodic caps) and refuses what is outside it. Self-described "new and unaudited".
- Relation: different layer. Tessera enforces limits **inside each signer** on a single FROST group key; we sequence human approvals and keep evidence above whatever signers exist. A Tessera signer could sit behind our adapter interface. The discovery note's claim of a hash-chained audit log in Tessera [S] was **not verified** here (no match for "audit" in the README).

### 1.4 Multisig tooling around it
- `stellar-expert/refractor` [P: API 2026-10-31]: MIT, created 2021-03-04, last push 2026-10-12, 5 stars. Pending-transaction storage and signature aggregation API. No roles or policy (per discovery note [S]; code not read).
- `stellar-agent-registry/stellar-multisig-ui` [P: API]: MIT, one push on 2026-05-18, 0 stars. "Coordinator" UI; its README claims to be the first; Stratum predates it (created 2025-08-31).
- On-chain contract treasuries (a different approach: funds held by a contract that enforces M-of-N): `oluwarantimini/quorum-vault` (licence NOASSERTION), `vaultfox-labs/soroban-multisig-vault`, `real-boys/soroban-multisig-safe`, `auroravest/soroban-multisig`, `Aegis-Stellar/Aegis` (no licence; M-of-N safe with recurring per-owner allowances, testnet), `WarrantX/warrantx-app` (MIT; "Stellar treasury operations app with policy-controlled spending, approvals, indexing, and SDK tooling"; README: contracts + Next.js dashboard + Express API + indexer + PostgreSQL; "v0.1.1 is a testnet-only preview. The contracts are unaudited"). Metadata and READMEs only were read (2026-10-31); code not examined. These overlap on the buyer (teams wanting approvals and limits) but not on the mechanism (they hold funds in a contract; we sit above existing accounts and signers).
- `signerreach/signerreach` [P: API + README]: Apache-2.0, created 2026-10-14, pushed 2026-10-31. Offline checker that warns when a classic-account signer/threshold change would leave the account unadministrable. Complementary (account-configuration safety), not workflow. It could be a pre-flight check in a future MKR ticket for classic multisig changes; not in v1.
- OpenZeppelin `stellar-contracts` v0.8.0 smart-account policies `simple_threshold`, `weighted_threshold`, `spending_limit` (`packages/accounts/src/policies`) and `stellar/smart-account-kit` (Apache-2.0, created 2026-07-30, `signAuthEntryWithSigners` for "a multi-party coordinator") [S: `screen_I4_wallets.md`; kit metadata P: API 2026-10-31]. On-chain route, explicitly not used here.

### 1.5 SDK pieces that cover part of the library layer (absorb risk)
- Installed `@stellar/stellar-sdk` 17.4.0 [P: `lib/esm/base/auth.d.ts`, `contract/assembled_transaction.d.ts`, read 2026-10-31] already provides: `authorizeEntry` (Keypair or callback incl. `signatureScVal` for custom accounts), `authorizeInvocation`, `buildAuthorizationEntryPreimage`, `buildWithDelegatesEntry` (CAP-71-01), `inspectAuthEntry`, `checkAuthEntryReadiness`, `AssembledTransaction.needsNonInvokerSigningBy` and sequential `signAuthEntries`, `Keypair.signMessage/verifyMessage` (SEP-53), `simulateTransaction(..., authMode)`.
- Discovery note: js-stellar-sdk Developer Experience Epic #1461 with children #1464 (transaction inspection, open), #1465 (fluent signing, open), #1466 (remote and multi-party signing helpers `prepareForRemoteSigning`/`applyRemoteSignatures`, open) and #1606 (`checkTransactionSignatures`) [S: `screen_I4_wallets.md`, issue states as of 2026-10-31 in the note; not re-fetched by me]. If #1466 ships, the plan/merge/bundle pieces in SPEC 7 partly become SDK calls. The unique parts that no SDK epic item mentions are roles, thresholds-by-policy, approvals with separation of duties, and the audit chain.
- SEP-43 (Draft v1.2.1), SEP-53 (referenced from the SDK docs; text not re-read), SEP-57 (Draft v0.4.0, updated 2026-09-08) [P: stellar-protocol, read 2026-10-31].

### 1.6 Custody vendors
Fireblocks, BitGo, Taurus, Dfns, Blockdaemon: DTCC-listed wallet providers [S]. Fireblocks' help article (updated 2026-06-23) says Soroban tokens are not supported and covers classic assets only; BitGo docs list classic tokens only; Taurus markets SAC/SEP-41/SEP-57 support for issuance [S: `notes/dtc_participant_package_and_requirements.md`]. Blockdaemon's "Approver App" (participant must authorise every transaction) is documented for Canton [S, same note]. None of this was re-fetched; vendor Stellar/Soroban co-signing APIs are unverified (MKR-023 BLOCKED).

## 2. Verdict

PARTIAL gap, same as the discovery note's, now with sharper edges [I]:
- A browser multisig UI exists and is active (Stratum). It has no server-side workflow, policy or audit. It cannot collect another address's auth entry.
- Contract-based treasuries with approvals exist at hackathon/preview maturity (WarrantX, Aegis, quorum-vault and others). They are not a layer above existing accounts and signers.
- Policy enforced inside signers exists in a new, unaudited form (Tessera).
- The SDK is absorbing the low-level helpers.
- What I did not find in this search: a headless, vendor-neutral layer combining a canonical hashed policy, roles with enforced separation of duties, pinned requirements, multi-party auth-entry collection and a hash-chained audit log, plus SEP-57 control-action templates. Absence of evidence only. The sections below say how far I looked.

SDF adoption pattern [S: `notes/sdf_adopt_vs_build.md`]: SDF adopts audited, open-source, live-on-mainnet, neutral work from repeat partners; for institutional wallets it leaves the product to custody vendors. A library/spec layer is high absorb risk; the defensible parts are the policy format, the audit format, and conformance vectors that vendors can adopt.

## 3. Searches run (GitHub, repositories created on or after 2026-01-01, 2026-10-31)

"stellar maker checker" 0 results; "soroban multisig approval workflow" 1 (payableX/payablex-frontend, accounts-payable dashboard, not read); "stellar multisig policy audit log" 0; "soroban authorization entries multi-party" 0; "stellar treasury approval policy signer" 0; "stellar multisig" 53 (first 12 listed above or judged unrelated: mergepay-api, SoroWill, Vero-protocol, vesting platform, Stellar-Guard (CAP-0077 multisig freeze governance contract, not read), stellar-safe-wallet, StellarPOS); "soroban multisig" 53; "stellar multi-signature coordinator" 2; "stellar approval policy" 4 (WarrantX, Neurochain-DSL, Aegis, carmelita); "stellar custody policy engine" 1 (Tessera); "SEP-57 freeze forced transfer" 0. Counts are GitHub's `total_count` at query time; only the first page was inspected.

## 4. Not searched (G-NOVELTY honesty)

npm and crates.io registries; non-GitHub hosts; SDF org repos and issues beyond what the discovery note recorded (#1461 family not re-fetched); OpenZeppelin repos beyond metadata (OZ Monitor, role-manager, Relayer plugins); Lobstr Vault; Freighter/xBull/Albedo multisig features; Fireblocks/BitGo/Taurus/Dfns Stellar API docs; Canton Wallet Gateway and Console Wallet clear-signing implementations (the gap map cites them as analogues [S]); SEP discussions on a maker-checker extension to SEP-43; private or stealth projects; code of every repo named above. Any "none found" is bounded by this list.

## 5. Re-check before relying

Re-run the six GitHub queries and the js-stellar-sdk #1461/#1466/#1606 states before starting MKR-010 and again before any claim in a README or pitch. Date every re-run here.
