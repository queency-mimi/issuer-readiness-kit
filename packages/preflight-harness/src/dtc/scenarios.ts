// SPDX-License-Identifier: Apache-2.0
// DTC registered-wallet readiness scenario definitions (SPEC.md section 9). Data only.
// Requirement rows are NOT redefined here: each ref points at a row id in dtc-kit's requirements profiles
// (projects/dtc-kit/packages/profile-spec/profiles/dtc-generic.json and dtc-stellar.json, version 2026-10-31, read
// 2026-10-31). `status` is copied for tagging; PFH-029 validates ids and status against the profile files.
// G-DTCC: a scenario is tagged with the WEAKEST status among its refs and never described as DTC-compatible.
import type { ReasonCode } from "../taxonomy/codes.ts";

export type RowStatus = "published" | "inferred" | "unknown";
export type DtcReasonCode =
  | "DTC_WALLET_UNFUNDED"
  | "DTC_TRUSTLINE_NOT_CREATED"
  | "DTC_TRUSTLINE_NOT_AUTHORIZED"
  | "DTC_WALLET_CONTROL_STATE_ACTIVE"
  | "DTC_ASSET_NOT_DISTRIBUTION_CONTROLLED"
  | "DTC_ASSET_NO_CLAWBACK"
  | "DTC_AMOUNT_NOT_WHOLE_TOKENS"
  | "DTC_WALLET_KIND_NOT_ESTABLISHED"
  | "DTC_RESERVE_SHORT"
  | "DTC_IDENTITY_NOT_VERIFIED";

export interface RequirementRef {
  profileId: "dtc-generic" | "dtc-stellar";
  rowId: string;
  status: RowStatus;
}

export type ScenarioArea = "infrastructure" | "wallet" | "transfer" | "conversion" | "control" | "override" | "corporate-action" | "stellar" | "vendor";

export interface DtcScenarioDef {
  id: string;
  /** Number used in the exported pack id `SC-NNN` (dtc-kit's ScenarioPack contract). Append-only: never renumber. */
  sc: number;
  /** dtc-kit ScenarioPack `area` enum value. */
  area: ScenarioArea;
  title: string;
  requirementRefs: RequirementRef[];
  /** Extra tags from docs/CONVENTIONS.md beyond the status tag. */
  extraTags: ("@stellar-sac" | "@stellar-sep57" | "@testnet" | "@slow")[];
  given: string;
  /** Catalogue case whose fixture this scenario reuses, if any. */
  baseCase: string | null;
  /** Input fields that differ from the base case (same snapshot, different request). */
  inputOverride?: { amount?: string };
  expect: { readiness: "ready" | "not-ready" | "unknown"; receiveReasons: ReasonCode[]; dtcReasons: DtcReasonCode[] };
}

const g = (rowId: string, status: RowStatus): RequirementRef => ({ profileId: "dtc-generic", rowId, status });
const s = (rowId: string, status: RowStatus): RequirementRef => ({ profileId: "dtc-stellar", rowId, status });

export const DTC_SCENARIOS: DtcScenarioDef[] = [
  { id: "dtc.ready-classic-wallet", sc: 1, area: "wallet", title: "Participant G wallet with an authorised trustline is ready to receive", requirementRefs: [g("token.transfer-only-to-registered-wallets", "published"), s("distribution_control.registration-two-step", "inferred")], extraTags: ["@stellar-sac", "@testnet"], given: "Classic asset with AUTH_REQUIRED and clawback; wallet funded, trustline created and authorised, reserve covered.", baseCase: "classic.ready-controlled-asset", expect: { readiness: "ready", receiveReasons: [], dtcReasons: [] } },
  { id: "dtc.trustline-pending-authorisation", sc: 2, area: "wallet", title: "Step 1 done (trustline), step 2 pending (DTC authorisation): not ready", requirementRefs: [s("distribution_control.registration-two-step", "inferred")], extraTags: ["@testnet"], given: "Trustline exists but the issuer has not authorised it.", baseCase: "classic.trustline-unauthorized", expect: { readiness: "not-ready", receiveReasons: ["TRUSTLINE_NOT_AUTHORIZED"], dtcReasons: ["DTC_TRUSTLINE_NOT_AUTHORIZED"] } },
  { id: "dtc.no-trustline", sc: 3, area: "wallet", title: "Wallet has not created the trustline: not ready", requirementRefs: [s("distribution_control.registration-two-step", "inferred")], extraTags: ["@testnet"], given: "Funded wallet, no trustline.", baseCase: "classic.trustline-missing", expect: { readiness: "not-ready", receiveReasons: ["TRUSTLINE_MISSING"], dtcReasons: ["DTC_TRUSTLINE_NOT_CREATED"] } },
  { id: "dtc.typed-address-does-not-exist", sc: 4, area: "wallet", title: "DTC does not validate wallet addresses; a mistyped or unfunded address is caught here", requirementRefs: [g("wallet.address-not-validated-by-dtc", "published")], extraTags: ["@testnet"], given: "Well-formed address that does not exist on the ledger.", baseCase: "classic.unfunded-credit-asset", expect: { readiness: "not-ready", receiveReasons: ["ACCOUNT_UNFUNDED"], dtcReasons: ["DTC_WALLET_UNFUNDED"] } },
  { id: "dtc.wallet-control-state-active", sc: 5, area: "control", title: "Trustline deauthorised or maintain-liabilities-only (possible chill/lock mapping)", requirementRefs: [g("wallet.control-state-semantics", "inferred"), s("authorities.chill-freeze-mechanism", "unknown")], extraTags: ["@testnet"], given: "Wallet was authorised, then authorisation revoked or reduced to maintain-liabilities.", baseCase: "classic.trustline-maintain-liabilities-only", expect: { readiness: "not-ready", receiveReasons: ["TRUSTLINE_MAINTAIN_LIABILITIES_ONLY"], dtcReasons: ["DTC_WALLET_CONTROL_STATE_ACTIVE"] } },
  { id: "dtc.asset-without-auth-required", sc: 6, area: "transfer", title: "Asset has no AUTH_REQUIRED: nothing enforces 'transferable only to Registered Wallets'", requirementRefs: [g("token.transfer-only-to-registered-wallets", "published"), s("distribution_control.mechanism", "unknown")], extraTags: ["@stellar-sac", "@testnet"], given: "Issuer flags lack AUTH_REQUIRED.", baseCase: "classic.ready", expect: { readiness: "not-ready", receiveReasons: [], dtcReasons: ["DTC_ASSET_NOT_DISTRIBUTION_CONTROLLED"] } },
  { id: "dtc.asset-without-clawback", sc: 7, area: "override", title: "Asset has no clawback flag: cannot support the root override on the classic form", requirementRefs: [g("authorities.dtc-override-root-wallet", "published"), s("authorities.force-transfer-mechanism", "unknown")], extraTags: ["@testnet"], given: "Issuer without AUTH_CLAWBACK_ENABLED (must be set before trustlines exist).", baseCase: "classic.ready", expect: { readiness: "not-ready", receiveReasons: [], dtcReasons: ["DTC_ASSET_NO_CLAWBACK"] } },
  { id: "dtc.fractional-amount", sc: 8, area: "conversion", title: "Amount is not a whole number of tokens", requirementRefs: [g("token.whole-tokens-only", "inferred"), s("token.whole-token-enforcement-stellar", "inferred")], extraTags: ["@testnet"], given: "Classic asset (7 decimals) and an amount with a fractional part.", baseCase: "classic.ready", inputOverride: { amount: "10.5" }, expect: { readiness: "not-ready", receiveReasons: [], dtcReasons: ["DTC_AMOUNT_NOT_WHOLE_TOKENS"] } },
  { id: "dtc.contract-address-wallet", sc: 9, area: "stellar", title: "C address as Registered Wallet: whether DTC accepts it is unknown", requirementRefs: [s("wallet.contract-address-registrable", "unknown")], extraTags: ["@stellar-sac", "@testnet"], given: "Contract account with an authorised SAC balance.", baseCase: "sac.c-address-ready", expect: { readiness: "unknown", receiveReasons: [], dtcReasons: ["DTC_WALLET_KIND_NOT_ESTABLISHED"] } },
  { id: "dtc.muxed-subledger-wallet", sc: 10, area: "stellar", title: "Muxed M address for a client sub-ledger wallet: registry fit is unknown", requirementRefs: [g("wallet.account-model", "published"), s("wallet.stellar-address-binding", "unknown")], extraTags: ["@testnet"], given: "Muxed address over a ready base account.", baseCase: "muxed.classic-ready", expect: { readiness: "unknown", receiveReasons: [], dtcReasons: ["DTC_WALLET_KIND_NOT_ESTABLISHED"] } },
  { id: "dtc.sep57-identity-unverified", sc: 11, area: "stellar", title: "Contract-token form: identity verifier rejects the wallet", requirementRefs: [s("token.form", "unknown")], extraTags: ["@stellar-sep57", "@testnet"], given: "SEP-57 token; destination has no verified identity.", baseCase: "sep57.address-frozen", expect: { readiness: "not-ready", receiveReasons: ["SIMULATION_TRANSFER_FAILED"], dtcReasons: ["DTC_IDENTITY_NOT_VERIFIED"] } },
  { id: "dtc.reserve-short", sc: 12, area: "stellar", title: "Wallet lacks XLM reserve to add the trustline", requirementRefs: [s("network.fee-payer", "unknown")], extraTags: ["@testnet"], given: "Funded wallet at its minimum balance; adding a trustline would breach the reserve.", baseCase: "classic.reserve-short", expect: { readiness: "not-ready", receiveReasons: ["TRUSTLINE_MISSING"], dtcReasons: ["DTC_RESERVE_SHORT"] } },
];

/** Verbatim from dtc-kit's dtc-stellar profile (version 2026-10-31, read 2026-10-31). Re-synced by PFH-029. */
export const DTC_STELLAR_DISCLAIMER =
  "DTC-shaped, not DTC-certified. Every Stellar row in this profile is inferred or unknown: DTCC has published no Stellar wallet, token or API requirements. Do not describe any output built on these rows as DTC-compatible.";

const ORDER: Record<RowStatus, number> = { unknown: 0, inferred: 1, published: 2 };

/** The tag a scenario carries: the weakest status among its requirement refs. Real. */
export function scenarioStatusTag(def: DtcScenarioDef): "@published" | "@inferred" | "@unknown" {
  let weakest: RowStatus = "published";
  for (const ref of def.requirementRefs) if (ORDER[ref.status] < ORDER[weakest]) weakest = ref.status;
  return `@${weakest}`;
}
