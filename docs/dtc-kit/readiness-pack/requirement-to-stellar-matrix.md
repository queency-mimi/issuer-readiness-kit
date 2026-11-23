# Requirement-to-Stellar matrix

Profile versions: `dtc-generic` 2026-10-31, `dtc-stellar` 2026-10-31. "Status" is the profile row status. Hand-written at scaffold; DTC-036 will regenerate the part between the markers.

Reading the table: the first four columns say what DTCC has said. The next columns are OUR mapping to Stellar, so they are inference unless a tag says otherwise. "SAC" = classic asset fronted by a Stellar Asset Contract. "SEP-57" = T-REX style contract token (Draft v0.4.0).

<!-- generated:start -->

## Requirements DTCC has published (chain-independent)

| Requirement | Row id | Status | SAC (classic + AUTH flags) | SEP-57 | Open ambiguity |
|---|---|---|---|---|---|
| Only participants register wallets; participant responsible | `wallet.only-participants-register` | published [P] | Off-chain registry rule; on-chain it appears as the issuer authorising the trustline [I] | Same, via identity registry [I] | None on the DTC side |
| OFAC screen before a wallet is allowlisted | `wallet.registration-ofac-screening` | published [P] | DTC authorises the trustline only after its screen [I] | Identity/allowlist entry added only after the screen [I] | Latency from DTC registration to on-chain effect is unknown |
| Tokens transferable only to Registered Wallets | `token.transfer-only-to-registered-wallets` | published [P] | `AUTH_REQUIRED` + authorised trustlines: unauthorised holders cannot receive [S]. Two-step: participant opens the trustline, then DTC authorises [I] | Identity verifier + compliance modules reject unverified recipients [P for hooks, I for behaviour] | Which mechanism DTCC will use is `distribution_control.mechanism` (unknown) |
| DTC override: convert/transfer/mint/burn without the holder key | `authorities.dtc-override-root-wallet` | published [P] | Clawback burns; force transfer = clawback + issuer payment in ONE transaction, both ops signed by the issuer [P: testnet 2026-11-08, ledger 5,621,476 tx c63843557af8...; failing variant ledger 5,621,480 tx d78063812d0f..., holder kept its tokens; `fixtures/sac-force-transfer/testnet-run.json`]. Needs `AUTH_CLAWBACK_ENABLED` before trustlines exist [S] | `forced_transfer(from,to,amount,operator)`, `mint`, `burn` [P names] | Whether DTC accepts clawback+payment as "transaction reversibility" is DTC's call |
| Mint/burn initiated by DTC, not participants | `authorities.dtc-initiated-mint-burn` | published [P] | Issuer payment mints; clawback burns [S] | `mint`, `burn` with operator role [P] | Who holds the operator/issuer key (`authorities.root-key-holder`, unknown) |
| Wallet statuses incl. Chill, Global Lock, Compliance Lock | `wallet.registration-status-taxonomy` | published [P] | Revoke authorisation or `AUTHORIZED_TO_MAINTAIN_LIABILITIES` [I]; cannot express outbound-only exactly | `set_address_frozen`, `pause` [P names] | `authorities.chill-freeze-mechanism` unknown; DTC statuses may be DTC-app only |
| Effect of each control state | `wallet.control-state-semantics` | **inferred** | As above | As above | Page names states; effects not described in what was read |
| 1:1 backing, same CUSIP | `token.one-to-one-backing` | published [P] | n/a on-chain; supply must equal converted shares: checkable by reconciliation | same | CUSIP-to-asset binding unknown (`identifiers.cusip-asset-binding`) |
| No fractional tokens | `token.whole-tokens-only` | **inferred** | Classic/SAC have 7 fixed decimals: cannot be enforced by flags; registry-side only [I] | Decimals 0 contract token can enforce it [I] | Pushes toward a contract token; DTCC picks the form |
| Observability of all transfers | `network.observability-all-transfers` | published [P] | Public ledger, CAP-67 events [S] | Public ledger + SEP-57 events [P] | Confidential (amount-hiding) tokens would be reviewed against "review all transfers" (L1/L2 framework excludes audit-resistant privacy) [P framework] |
| Free-of-value; cash leg off-DTC | `operations.free-of-value` | published [P] | Cash on Stellar: stablecoins; DvP away from DTC [P] | same | A DvP escrow would itself need to be a Registered Wallet (open question) |
| Same-network 24/7; cross-network burn-mint 02:00-18:00 ET Mon-Fri | `operations.transfer-and-processing-hours` | published [P] | Stellar transfers are 24/7 natively [I] | same | Conversion behaviour outside hours not described |
| Position capture 20:00 ET; unsupported events converted before record date | `corporate_actions.position-capture-8pm-et`, `corporate_actions.unsupported-event-convert-before-record-date` | inferred / published | Participant needs holder balances AT the capture instant: Soroban RPC keeps ~7 days of events [S], so keep your own history (holders-at-ledger) | same | Exact cutoff treatment of in-flight conversions not read in full |
| One consolidated cash credit to the classic account | `corporate_actions.cash-credit-consolidated-classic` | published [P] | Nothing on-chain; participant allocates to client sub-ledgers (packages/reconciliation) | same | Rate and credit timing per event come from DTC's CA Web, not from the chain |
| Quarterly counts incl. root-wallet uses | `compliance.quarterly-sec-report-counts` | published [P] | Chain side must expose counts: clawback/payment ops by the issuer are enumerable [I] | Events for forced_transfer [P names] | Whether admin actions are distinguishable (`events.admin-action-visibility`, unknown) |
| Service accounts, roles, PSE vs Production | `access.service-accounts-and-environments` | published [P] | Off-chain | Off-chain | API schemas and handshake unknown (login-gated) |

## Stellar-specific rows (all inferred or unknown)

| Question | Row id | Status | What we know | Unblocked by |
|---|---|---|---|---|
| DTCC lists Stellar with SEP-41, anticipated 2027 | `network.stellar-availability`, `token.interface` | inferred | Product page tile read 2026-10-31 [P]; it is not a requirement | DTCC supported-protocols list |
| Concrete token form | `token.form` | unknown | SAC, SEP-57 or bespoke SEP-41 contract | DTCC Stellar guide |
| Compliance mechanism | `distribution_control.mechanism` | unknown | AUTH_REQUIRED / SEP-57 / SEP-8 | DTCC Stellar guide |
| Registration takes two steps on classic | `distribution_control.registration-two-step` | inferred | Holder trustline first, then DTC authorisation [I] | token.form |
| Address kinds (G, C, M, smart account) | `wallet.stellar-address-binding` | unknown | DTC does not validate address text [P] | Connectivity Guide |
| Contract address as Registered Wallet | `wallet.contract-address-registrable` | unknown | See [sep8-and-contract-wallets.md](sep8-and-contract-wallets.md) | Connectivity Guide / DTCC answer |
| Force-transfer mechanism, root-key holder, chill mechanism | `authorities.force-transfer-mechanism`, `authorities.root-key-holder`, `authorities.chill-freeze-mechanism` | unknown | Candidates listed in the rows | token.form |
| Event layout and admin visibility | `events.stellar-event-layout` (inferred), `events.admin-action-visibility` (unknown) | mixed | SEP-41/CAP-67 and SEP-57 events are public | LedgerScan docs |
| Finality threshold for "Completed" | `network.finality-threshold` | unknown | | DTCC Stellar guide |
| Fee payer / reserves | `network.fee-payer` | unknown | Sponsored reserves and fee-bump exist | DTCC Stellar guide |
| CUSIP to asset binding | `identifiers.cusip-asset-binding` | unknown | | Eligible Securities data |
| Wallet-provider certification, handshake | `access.wallet-provider-certification` | unknown | | Connectivity Guide |
| SEP-8 fit | `distribution_control.sep-8-approval-fit` | inferred (poor) | | token.form |

<!-- generated:end -->

## Capability matrices (our adapters)

Full cells with mechanism, caveats and evidence tags: `packages/adapter-stellar-sac/src/matrix.ts` and `packages/adapter-stellar-sep57/src/matrix.ts`. Summary at scaffold:

| Capability | SAC | SEP-57 |
|---|---|---|
| Allowlist of registered wallets | native (AUTH_REQUIRED + SetTrustLineFlags) [S] | composed (identity verifier + modules) [P/I] |
| Deny unregistered transfer | native [S] | composed [I] |
| Freeze address | partial (revoke authorisation) [I] | native `set_address_frozen` [P] |
| Freeze part of a balance | none | native [P] |
| Global pause | partial (revoke every trustline, not atomic) [I] | native `pause` [P] |
| Admin burn | native (clawback) [S] | native [P] |
| Admin mint | native [S] | native [P] |
| Force transfer | composed: clawback + issuer payment, one tx [I] | native `forced_transfer` [P] |
| Whole-token enforcement | none (7 decimals) [I] | composed (decimals 0) [I] |
| Transfer events | native [S] | native [P] |
| Admin events distinguishable | unknown [U] | partial [P] |
| Wallet recovery | composed [I] | native `recover_balance` [P] |
| Contract address as holder | partial [S] | unknown [U] |
| Muxed attribution | partial [S] | partial [P] |
| Custody vendor signing | partial: classic only [V] | unknown [V/U] |

Why a SAC force transfer needs clawback and an issuer payment in one transaction: a clawback only destroys the holder's tokens; no classic operation moves tokens between two holders without the source holder's signature. Pairing a clawback with an issuer payment of the same amount reproduces a transfer, and putting both operations in one transaction makes the pair all-or-nothing. Separate transactions would let a failure after the clawback strand the holder with nothing. Spike DTC-020 tested this on Stellar testnet on 2026-11-08 [P]: the transaction [clawback(A,10), payment(issuer->B,10)] signed only by the issuer succeeded at ledger 5,621,476; the same transaction with B deauthorised failed as a whole with result codes [op_success, op_not_authorized] at ledger 5,621,480 and A kept 10 tokens. The cell is `composed` with evidence `P`. This shows what the token side can do; whether DTC uses this mechanism stays unknown.
