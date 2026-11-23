// SPDX-License-Identifier: Apache-2.0
import type { CapabilityMatrix } from "@sik/dtc-kit-core";

/**
 * Capability matrix for a Stellar classic asset fronted by a SAC.
 * Evidence tags: P = observed on Stellar testnet in a recorded fixture with provenance
 * (fixtures/sac-force-transfer/testnet-run.json, ledgers 5,621,465-5,621,491, captured 2026-11-08 by
 * packages/dtc-kit-adapter-stellar-sac/scripts/testnet-spike.ts), S = discovery notes, I = inference, V = vendor
 * claim, U = unverified. A P cell proves what the TOKEN SIDE does; it says nothing about what DTC requires.
 */
export const SAC_MATRIX: CapabilityMatrix = {
  "allowlist-registered-wallets": {
    capability: "allowlist-registered-wallets",
    support: "native",
    mechanism: "AUTH_REQUIRED on the issuer account; DTC authorises each trustline with SetTrustLineFlags(AUTHORIZED). For C-address holders of SAC balances the SAC `set_authorized` call does the same.",
    caveats: [
      "Testnet fixtures/sac-force-transfer/testnet-run.json: SetTrustLineFlags(authorized) on existing trustlines succeeded (ledgers 5621468, 5621470); on an address with no trustline it failed op_no_trust (ledger 5621471).",
      "Two steps: the participant must create the trustline first, then DTC authorises it (row distribution_control.registration-two-step, inferred).",
      "Participant needs XLM for the base reserve plus 0.5 XLM per trustline (Fireblocks help article, per notes).",
    ],
    evidence: "P",
    profileRows: ["distribution_control.mechanism", "distribution_control.registration-two-step", "token.transfer-only-to-registered-wallets"],
    verifyTicket: "DTC-023",
  },
  "deny-unregistered-transfer": {
    capability: "deny-unregistered-transfer",
    support: "native",
    mechanism: "A payment or SAC transfer to an unauthorised trustline fails; simulation shows the SAC error 'balance is deauthorized' (Error(Contract, #11)).",
    caveats: [
      "Testnet fixtures/sac-force-transfer/testnet-run.json: a classic holder payment to a deauthorised trustline failed op_not_authorized (ledger 5621484) and to an address without a trustline op_no_trust (ledger 5621487). SAC contract-call error codes were not exercised.","An address with no trustline fails with a different error (TrustlineMissing, #13); both must map to DEST_NOT_REGISTERED in the precheck."],
    evidence: "P",
    profileRows: ["token.transfer-only-to-registered-wallets"],
    verifyTicket: "DTC-023",
  },
  "freeze-address": {
    capability: "freeze-address",
    support: "partial",
    mechanism: "Revoke authorisation (SetTrustLineFlags clearing AUTHORIZED; needs AUTH_REVOCABLE) or set AUTHORIZED_TO_MAINTAIN_LIABILITIES.",
    caveats: [
      "Revocation blocks the trustline both ways; a chill that blocks only outbound delivery cannot be expressed exactly.",
      "Whether AUTHORIZED_TO_MAINTAIN_LIABILITIES gives an outbound-only block is unverified [U].",
      "AUTH_REVOCABLE weakens the 'reversibility' story for the holder; DTC wants it anyway (override keys).",
    ],
    evidence: "I",
    profileRows: ["authorities.chill-freeze-mechanism", "wallet.control-state-semantics"],
    verifyTicket: "DTC-023",
  },
  "freeze-partial-balance": {
    capability: "freeze-partial-balance",
    support: "none",
    mechanism: "No primitive. Offers/liabilities are the only partial effect of trustline flags.",
    caveats: ["Not required by any published DTCC row."],
    evidence: "I",
    profileRows: [],
  },
  "global-pause": {
    capability: "global-pause",
    support: "partial",
    mechanism: "No pause switch on classic assets. Approximate by revoking every trustline in one or more transactions.",
    caveats: ["Not atomic across holders; a Global Lock needs a batch plan and a failure story (candidate pool P081)."],
    evidence: "I",
    profileRows: ["wallet.control-state-semantics", "authorities.chill-freeze-mechanism"],
    verifyTicket: "DTC-021",
  },
  "admin-burn": {
    capability: "admin-burn",
    support: "native",
    mechanism: "Clawback operation (needs AUTH_CLAWBACK_ENABLED, which must be set before the trustlines exist) or SAC `clawback`. A clawback is a burn.",
    caveats: [
      "Testnet fixtures/sac-force-transfer/testnet-run.json: clawback from holder A succeeded inside the force-transfer transaction (ledger 5621476).","Flag ordering: set AUTH_REVOCABLE and AUTH_CLAWBACK_ENABLED on the issuer before any holder trustline is created."],
    evidence: "P",
    profileRows: ["authorities.dtc-override-root-wallet", "authorities.force-transfer-mechanism"],
    verifyTicket: "DTC-020",
  },
  "admin-mint": {
    capability: "admin-mint",
    support: "native",
    mechanism: "The issuer account paying its own asset creates supply; SAC `mint` by the admin does the same.",
    caveats: [
      "Testnet fixtures/sac-force-transfer/testnet-run.json: issuer payments created supply (ledgers 5621475, 5621477).","Destination trustline must exist and be authorised."],
    evidence: "P",
    profileRows: ["authorities.dtc-initiated-mint-burn"],
    verifyTicket: "DTC-023",
  },
  "force-transfer": {
    capability: "force-transfer",
    support: "composed",
    mechanism: "Clawback from the holder, then an issuer payment of the same amount to the destination, as two operations in ONE transaction.",
    caveats: [
      "Testnet fixtures/sac-force-transfer/testnet-run.json: one transaction [clawback(A,10), payment(issuer->B,10)] signed only by the issuer moved 10 from A to B (ledger 5621476); with B deauthorised the same transaction failed as a whole with [op_success, op_not_authorized] and A kept 10 (ledger 5621480).",
      "Why composed: a clawback only burns and no classic operation moves tokens between two holders without the source holder's signature.",
      "Why one transaction: if clawback and payment were separate transactions a failure between them would destroy the holder's tokens. One transaction makes it all-or-nothing.",
      "The issuer key signs (the 'root wallet' in DTC's terms). Destination trustline must already be authorised.",
      "Whether DTC accepts clawback-plus-payment as the NAL's 'transaction reversibility' is DTC's call (row authorities.force-transfer-mechanism, unknown).",
    ],
    evidence: "P",
    profileRows: ["authorities.dtc-override-root-wallet", "authorities.force-transfer-mechanism", "authorities.root-key-holder"],
    verifyTicket: "DTC-020",
  },
  "whole-token-enforcement": {
    capability: "whole-token-enforcement",
    support: "none",
    mechanism: "Classic assets and the SAC use 7 fixed decimals. Whole-token rule can only be enforced off-chain (registry/precheck rejects amounts that are not multiples of 10^7 stroops).",
    caveats: [
      "Testnet fixtures/sac-force-transfer/testnet-run.json: a 0.5-token holder payment succeeded on-chain (ledger 5621491).","A holder or DTC-side bug can still create fractional balances on-chain. A contract token with decimals 0 would enforce it (see the SEP-57 adapter)."],
    evidence: "P",
    profileRows: ["token.whole-tokens-only", "token.whole-token-enforcement-stellar"],
    verifyTicket: "DTC-022",
  },
  "transfer-events": {
    capability: "transfer-events",
    support: "native",
    mechanism: "CAP-67 / SEP-41 transfer, mint, burn events (optional muxed fields).",
    caveats: ["Soroban RPC keeps about 7 days of events; the participant needs its own indexer for record-date history (holders-at-ledger)."],
    evidence: "S",
    profileRows: ["events.stellar-event-layout"],
    verifyTicket: "DTC-027",
  },
  "admin-events-distinguishable": {
    capability: "admin-events-distinguishable",
    support: "unknown",
    mechanism: "Clawback and set_authorized are likely distinct events, not shown to be.",
    caveats: ["Row events.admin-action-visibility is unknown."],
    evidence: "U",
    profileRows: ["events.admin-action-visibility"],
    verifyTicket: "DTC-027",
  },
  "wallet-recovery": {
    capability: "wallet-recovery",
    support: "composed",
    mechanism: "Same as force-transfer: clawback from the lost wallet plus issuer payment to the replacement.",
    caveats: ["No on-chain identity to migrate; the replacement wallet must be a newly registered, authorised wallet."],
    evidence: "I",
    profileRows: ["authorities.force-transfer-reasons"],
    verifyTicket: "DTC-020",
  },
  "contract-address-holder": {
    capability: "contract-address-holder",
    support: "partial",
    mechanism: "A C-address can hold a SAC balance; under AUTH_REQUIRED it must be authorised via SAC `set_authorized` first.",
    caveats: [
      "Classic payment operations cannot have a contract address as source or destination; only SAC contract calls work.",
      "Whether DTC can register a C-address at all is the open question wallet.contract-address-registrable.",
    ],
    evidence: "S",
    profileRows: ["wallet.contract-address-registrable", "wallet.stellar-address-binding"],
    verifyTicket: "DTC-028",
  },
  "muxed-attribution": {
    capability: "muxed-attribution",
    support: "partial",
    mechanism: "Muxed M-addresses on classic payments for sub-ledger attribution; muxed contract addresses arrive with CAP-84 (Protocol 30 votes 2026-11-03 testnet, 2026-11-23 mainnet).",
    caveats: ["DTC registers one address per wallet, so muxed IDs fit omnibus accounting but not DTC's registry (inference)."],
    evidence: "S",
    profileRows: ["wallet.stellar-address-binding"],
    verifyTicket: "DTC-037",
  },
  "custody-vendor-signing": {
    capability: "custody-vendor-signing",
    support: "partial",
    mechanism: "Classic operations are the supported path at Fireblocks and BitGo per their docs; trustline ops and clawback ops are classic.",
    caveats: [
      "Fireblocks: classic Stellar assets yes, 'Soroban tokens are not currently supported' (help article, updated 2026-06-23).",
      "BitGo docs list classic Stellar tokens only. See readiness-pack/wallet-vendor-matrix.md for trust tags.",
      "Issuer-side clawback and SetTrustLineFlags by custody vendors are not shown in the docs read.",
    ],
    evidence: "V",
    profileRows: ["access.wallet-provider-certification"],
    verifyTicket: "DTC-029",
  },
};
