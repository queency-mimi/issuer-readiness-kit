// SPDX-License-Identifier: Apache-2.0
// Per-library code inventories and their mapping into the superset taxonomy.
// Evidence: read-only clones on 2026-10-31 (commit ids below); [P] for the code lists (read from source),
// [I] for each mapping decision. A library's code that is not in its inventory is a hard failure (PFH-001 test),
// so a new release cannot silently add an unmapped code (scripts/check-inventory.ts, PFH-001).
import type { ReasonCode, Severity } from "./codes.ts";

export type AdapterId = "stellar-preflight" | "stellagate-core" | "stellar-check";

export interface LibraryInventory {
  adapterId: AdapterId;
  /** Name and install method, verified 2026-10-31. */
  install: { method: "npm" | "git-clone"; spec: string; note: string };
  repo: string;
  /** Commit read on 2026-10-31. For npm packages this can be newer than the published tarball. */
  commit: string;
  licence: "MIT" | "Apache-2.0";
  /** Files the code list was read from. */
  evidence: string[];
  codes: readonly string[];
}

export const LIBRARY_INVENTORY: Record<AdapterId, LibraryInventory> = {
  "stellar-preflight": {
    adapterId: "stellar-preflight",
    install: {
      method: "git-clone",
      spec: "https://github.com/salkimos/Stellar-Preflight at a pinned commit, cloned to .competitors/ (scripts/fetch-competitors.sh)",
      note: "Not on npm (@stellar-preflight/sdk and stellar-preflight both 404, 2026-10-31). packages/sdk is private, version 0.0.0, and exports TypeScript source (./src/index.ts); Node refuses type stripping inside node_modules, so it cannot be a normal dependency.",
    },
    repo: "https://github.com/salkimos/Stellar-Preflight",
    commit: "4599d9c77c66abc2a606c5d0e105777812a87844",
    licence: "MIT",
    evidence: ["packages/sdk/src/codes.ts", "docs/codes.md", "packages/sdk/src/chain.ts (injectable Chain)", "packages/sdk/src/preflight.ts"],
    codes: [
      "INVALID_RECIPIENT", "INVALID_ASSET", "INVALID_AMOUNT", "INVALID_SENDER", "MUXED_RECIPIENT", "ACCOUNT_NOT_FOUND",
      "ACCOUNT_NOT_FOUND_MUXED", "ACCOUNT_NOT_FOUND_LOW_AMOUNT", "ACCOUNT_NOT_FOUND_CREATE", "MEMO_REQUIRED", "ISSUER_NOT_FOUND",
      "ASSET_CLAWBACK_ENABLED", "ASSET_AUTH_REVOCABLE", "RECIPIENT_IS_ISSUER", "TRUSTLINE_MISSING", "TRUSTLINE_NOT_AUTHORIZED",
      "TRUSTLINE_LIMITED_AUTH", "TRUSTLINE_LIMIT_EXCEEDED", "CONTRACT_NOT_FOUND", "CONTRACT_NEEDS_SAC_TRANSFER", "SAC_NOT_DEPLOYED",
      "CONTRACT_BALANCE_NOT_AUTHORIZED", "CONTRACT_BALANCE_NEEDS_AUTH", "TOKEN_NOT_FOUND", "SAC_UNREADABLE", "NOT_A_TOKEN",
      "TOKEN_HOLDER_NO_ACCOUNT", "MUXED_CUSTOM_TOKEN", "CUSTOM_TOKEN_LOGIC", "TRANSFER_NOT_SIMULATED", "SEP41_NOT_SIMULATED",
      "TRANSFER_SIMULATION_FAILED",
    ],
  },
  "stellagate-core": {
    adapterId: "stellagate-core",
    install: { method: "npm", spec: "stellagate-core@0.1.1", note: "Installs and loads cleanly (pnpm 10.22.0, Node 24.18.0, 2026-10-31). Repo StellaGate/stellagate; npm author field says jadonamite." },
    repo: "https://github.com/StellaGate/stellagate",
    commit: "5cdd7cd6ce953be5a2064fe5c4aa705832fe4fbd",
    licence: "Apache-2.0",
    evidence: ["src/check.ts", "src/holdability.ts", "src/address.ts (ParseError: empty | secret_key | invalid)", "src/sources.ts (injectable AccountSource, ContractSource, DirectorySource, FederationResolver)"],
    codes: [
      "account_unavailable", "amount_invalid", "asset_invalid", "contract_checks_skipped", "contract_sender_cannot_memo",
      "destination_empty", "destination_secret_key", "destination_invalid", "destination_contract", "destination_contract_missing",
      "destination_flagged", "destination_unfunded", "directory_unavailable", "federation_failed", "issuer_missing", "memo_invalid",
      "memo_required", "memo_unsupported_for_contract_sender", "muxed_from_contract", "no_trustline", "rpc_unavailable",
      "sac_balance_not_authorized", "sac_not_deployed", "trustline_limit_exceeded", "trustline_not_authorized",
    ],
  },
  "stellar-check": {
    adapterId: "stellar-check",
    install: { method: "npm", spec: "stellar-check@0.1.1", note: "Installs and loads cleanly (2026-10-31). Exports checkPayment, assessPayment, HorizonProvider, importPaymentXdr. Pins @stellar/stellar-sdk 17.0.1." },
    repo: "https://github.com/GautamBytes/stellar-check",
    commit: "f29a88998378450dc0103373f858d92784f5be10",
    licence: "Apache-2.0",
    evidence: ["src/types.ts (DiagnosticCode)", "docs/diagnostics.md", "src/assess.ts", "src/types.ts (injectable PaymentProvider)"],
    codes: [
      "INVALID_INPUT", "UNSUPPORTED_PAYMENT", "NETWORK_MISMATCH", "PROVIDER_TIMEOUT", "PROVIDER_RATE_LIMITED", "PROVIDER_UNAVAILABLE",
      "MALFORMED_DATA", "SOURCE_ACCOUNT_MISSING", "DESTINATION_ACCOUNT_MISSING", "SOURCE_TRUSTLINE_MISSING", "DESTINATION_TRUSTLINE_MISSING",
      "SOURCE_NOT_AUTHORIZED", "DESTINATION_NOT_AUTHORIZED", "INSUFFICIENT_XLM", "INSUFFICIENT_ASSET", "DESTINATION_CAPACITY_EXCEEDED",
      "FEE_BUDGET_TOO_LOW", "MEMO_REQUIRED",
    ],
  },
};

export interface CodeMapping {
  /** One canonical code, or several when the library code covers more than one situation (then `note` says how to split). */
  to: ReasonCode | readonly ReasonCode[];
  /** The library's usual severity for this code, if it states one. The adapter records the severity actually returned. */
  usualSeverity?: Severity;
  note?: string;
}

const m = (to: ReasonCode | readonly ReasonCode[], usualSeverity?: Severity, note?: string): CodeMapping =>
  note === undefined ? (usualSeverity === undefined ? { to } : { to, usualSeverity }) : { to, ...(usualSeverity === undefined ? {} : { usualSeverity }), note };

export const LIBRARY_CODE_MAP: Record<AdapterId, Record<string, CodeMapping>> = {
  "stellar-preflight": {
    INVALID_RECIPIENT: m("INVALID_DESTINATION", "blocking"),
    INVALID_ASSET: m("INVALID_ASSET", "blocking"),
    INVALID_AMOUNT: m("INVALID_AMOUNT", "blocking"),
    INVALID_SENDER: m("INVALID_SENDER", "blocking"),
    MUXED_RECIPIENT: m("DESTINATION_MUXED", "info"),
    ACCOUNT_NOT_FOUND: m("ACCOUNT_UNFUNDED", "blocking"),
    ACCOUNT_NOT_FOUND_MUXED: m("MUXED_BASE_ACCOUNT_UNFUNDED", "blocking"),
    ACCOUNT_NOT_FOUND_LOW_AMOUNT: m("AMOUNT_BELOW_ACCOUNT_MINIMUM", "blocking"),
    ACCOUNT_NOT_FOUND_CREATE: m("ACCOUNT_UNFUNDED_CREATE_REQUIRED", "warning"),
    MEMO_REQUIRED: m("MEMO_REQUIRED", "warning", "StellaGate reports the same condition as blocking: a known severity disagreement."),
    ISSUER_NOT_FOUND: m("ISSUER_MISSING", "blocking"),
    ASSET_CLAWBACK_ENABLED: m("ASSET_CLAWBACK_ENABLED", "info"),
    ASSET_AUTH_REVOCABLE: m("ASSET_AUTH_REVOCABLE", "info"),
    RECIPIENT_IS_ISSUER: m("DESTINATION_IS_ISSUER", "info"),
    TRUSTLINE_MISSING: m("TRUSTLINE_MISSING", "blocking"),
    TRUSTLINE_NOT_AUTHORIZED: m("TRUSTLINE_NOT_AUTHORIZED", "blocking"),
    TRUSTLINE_LIMITED_AUTH: m("TRUSTLINE_MAINTAIN_LIABILITIES_ONLY", "blocking", "Only library that distinguishes maintain-liabilities-only (chain.ts reads authorizedToMaintainLiabilities)."),
    TRUSTLINE_LIMIT_EXCEEDED: m("TRUSTLINE_LIMIT_EXCEEDED", "blocking"),
    CONTRACT_NOT_FOUND: m("CONTRACT_DESTINATION_MISSING", "blocking"),
    CONTRACT_NEEDS_SAC_TRANSFER: m("DESTINATION_IS_CONTRACT", "info"),
    SAC_NOT_DEPLOYED: m("SAC_NOT_DEPLOYED", "blocking"),
    CONTRACT_BALANCE_NOT_AUTHORIZED: m("SAC_BALANCE_NOT_AUTHORIZED", "blocking"),
    CONTRACT_BALANCE_NEEDS_AUTH: m("SAC_BALANCE_NEEDS_AUTHORIZATION", "blocking"),
    TOKEN_NOT_FOUND: m("TOKEN_CONTRACT_MISSING", "blocking"),
    SAC_UNREADABLE: m("SAC_UNREADABLE", "blocking"),
    NOT_A_TOKEN: m("NOT_A_TOKEN", "blocking"),
    TOKEN_HOLDER_NO_ACCOUNT: m("TOKEN_HOLDER_ACCOUNT_MISSING", "warning"),
    MUXED_CUSTOM_TOKEN: m("MUXED_ID_UNSUPPORTED_BY_TOKEN", "warning"),
    CUSTOM_TOKEN_LOGIC: m("CUSTOM_TOKEN_LOGIC", "info"),
    TRANSFER_NOT_SIMULATED: m("SIMULATION_NOT_RUN", "info"),
    SEP41_NOT_SIMULATED: m("SIMULATION_NOT_RUN", "warning"),
    TRANSFER_SIMULATION_FAILED: m(
      ["SIMULATION_TRANSFER_FAILED", "SAC_DEAUTHORIZED_PARTY_UNKNOWN", "SIM_ACCOUNT_OR_TRUSTLINE_MISSING", "SENDER_INSUFFICIENT_ASSET", "TOKEN_ADDRESS_FROZEN", "TOKEN_ALLOWLIST_EXCLUDED", "TOKEN_COMPLIANCE_REJECTED"],
      "blocking",
      "Generic: the reason text carries the contract error name (simReason). The adapter refines by the recorded contract error code/name; otherwise SIMULATION_TRANSFER_FAILED.",
    ),
  },
  "stellagate-core": {
    account_unavailable: m("PROVIDER_UNAVAILABLE", "warning"),
    amount_invalid: m("INVALID_AMOUNT", "blocking"),
    asset_invalid: m("INVALID_ASSET", "blocking"),
    contract_checks_skipped: m("CHECK_SKIPPED", "info"),
    contract_sender_cannot_memo: m("MEMO_UNSUPPORTED_FOR_CONTRACT_SENDER", "blocking", "Emitted at two sites: federation memo and SEP-29 memo, both with a C sender."),
    destination_empty: m("INVALID_DESTINATION", "blocking", "Dynamic code destination_${ParseError} from check.ts."),
    destination_secret_key: m("DESTINATION_IS_SECRET_KEY", "blocking", "Dynamic code destination_${ParseError}."),
    destination_invalid: m("INVALID_DESTINATION", "blocking", "Dynamic code destination_${ParseError}."),
    destination_contract: m("DESTINATION_IS_CONTRACT", "info"),
    destination_contract_missing: m("CONTRACT_DESTINATION_MISSING", "blocking"),
    destination_flagged: m("DESTINATION_FLAGGED", "blocking"),
    destination_unfunded: m("ACCOUNT_UNFUNDED", "blocking", "Severity is warn for native XLM and block for other assets (check.ts)."),
    directory_unavailable: m("DIRECTORY_UNAVAILABLE", "info"),
    federation_failed: m("FEDERATION_UNRESOLVED", "blocking"),
    issuer_missing: m("ISSUER_MISSING", "blocking"),
    memo_invalid: m("INVALID_MEMO", "blocking"),
    memo_required: m(["MEMO_REQUIRED", "MEMO_REQUIRED_DIRECTORY"], "blocking", "Also fires on a directory tag memo-required (then MEMO_REQUIRED_DIRECTORY); the adapter splits on the message text '(public directory)'."),
    memo_unsupported_for_contract_sender: m("MEMO_UNSUPPORTED_FOR_CONTRACT_SENDER", "blocking"),
    muxed_from_contract: m("MUXED_FROM_CONTRACT_SENDER_RISK", "warning"),
    no_trustline: m("TRUSTLINE_MISSING", "blocking"),
    rpc_unavailable: m("PROVIDER_UNAVAILABLE", "info"),
    sac_balance_not_authorized: m(
      ["SAC_BALANCE_NOT_AUTHORIZED", "SAC_BALANCE_NEEDS_AUTHORIZATION"],
      "blocking",
      "One code, two situations (holdability.ts): balance exists and is deauthorised, or no balance and issuer AUTH_REQUIRED. The adapter splits on the message text 'has not been approved'.",
    ),
    sac_not_deployed: m("SAC_NOT_DEPLOYED", "blocking"),
    trustline_limit_exceeded: m("TRUSTLINE_LIMIT_EXCEEDED", "blocking"),
    trustline_not_authorized: m(
      ["TRUSTLINE_NOT_AUTHORIZED", "TRUSTLINE_MAINTAIN_LIABILITIES_ONLY"],
      "blocking",
      "Trustline type has a single `authorized` boolean (sources.ts), so maintain-liabilities-only lines are reported here and cannot be told apart from unauthorised.",
    ),
  },
  "stellar-check": {
    INVALID_INPUT: m("INVALID_INPUT", "blocking"),
    UNSUPPORTED_PAYMENT: m("UNSUPPORTED_SCENARIO", "blocking", "Classic payments only; C addresses, SAC and SEP-41 destinations are outside its scope."),
    NETWORK_MISMATCH: m("NETWORK_MISMATCH", "blocking"),
    PROVIDER_TIMEOUT: m("PROVIDER_TIMEOUT", "blocking"),
    PROVIDER_RATE_LIMITED: m("PROVIDER_RATE_LIMITED", "blocking"),
    PROVIDER_UNAVAILABLE: m("PROVIDER_UNAVAILABLE", "blocking"),
    MALFORMED_DATA: m("MALFORMED_PROVIDER_DATA", "blocking"),
    SOURCE_ACCOUNT_MISSING: m("SENDER_ACCOUNT_MISSING", "blocking"),
    DESTINATION_ACCOUNT_MISSING: m("ACCOUNT_UNFUNDED", "blocking"),
    SOURCE_TRUSTLINE_MISSING: m("SENDER_TRUSTLINE_MISSING", "blocking"),
    DESTINATION_TRUSTLINE_MISSING: m("TRUSTLINE_MISSING", "blocking"),
    SOURCE_NOT_AUTHORIZED: m("SENDER_NOT_AUTHORIZED", "blocking"),
    DESTINATION_NOT_AUTHORIZED: m(
      ["TRUSTLINE_NOT_AUTHORIZED", "TRUSTLINE_MAINTAIN_LIABILITIES_ONLY"],
      "blocking",
      "assess.ts: 'Authorization to maintain liabilities is insufficient.' The code does not split the two states.",
    ),
    INSUFFICIENT_XLM: m("SENDER_INSUFFICIENT_XLM", "blocking"),
    INSUFFICIENT_ASSET: m("SENDER_INSUFFICIENT_ASSET", "blocking"),
    DESTINATION_CAPACITY_EXCEEDED: m(["TRUSTLINE_LIMIT_EXCEEDED", "NATIVE_BALANCE_CAP"], "blocking", "Native payments use the int64 cap (assess.ts), credit assets the trustline limit."),
    FEE_BUDGET_TOO_LOW: m("FEE_BUDGET_TOO_LOW", "blocking"),
    MEMO_REQUIRED: m("MEMO_REQUIRED", "blocking", "Reported as a Diagnostic with party sender; the report status is issues_found."),
  },
};

/** Canonical codes for a library code, or undefined when the library code is not in the inventory. */
export function mapLibraryCode(adapterId: AdapterId, libraryCode: string): readonly ReasonCode[] | undefined {
  const entry = LIBRARY_CODE_MAP[adapterId][libraryCode];
  if (!entry) return undefined;
  return typeof entry.to === "string" ? [entry.to] : entry.to;
}
