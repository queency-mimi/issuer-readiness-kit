// SPDX-License-Identifier: Apache-2.0
// The superset ReasonCode taxonomy (SPEC.md section 3). Derived from the three libraries' sources
// (see library-maps.ts for the per-library evidence) plus the reasons screen_H_P054.md lists that no
// library implements yet. Adding a code is a SPEC change (version bump of TAXONOMY_VERSION).

export const TAXONOMY_VERSION = 1;

export type Severity = "info" | "warning" | "blocking";
/** receive: about the destination's ability to hold the asset. sender: about the paying side (kept so library output is not lost, excluded from receive comparison). meta: about the check itself. */
export type Scope = "receive" | "sender" | "meta";
export type Group =
  | "input"
  | "address"
  | "account"
  | "memo"
  | "trustline"
  | "asset"
  | "sac"
  | "token"
  | "simulation"
  | "regulated"
  | "sender"
  | "provider";
/** How a verdict for this reason can be derived: local parse, public read (Horizon/RPC state), simulation only, or out of band. */
export type Derivation = "local" | "public-read" | "simulation" | "out-of-band";

export interface ReasonMeta {
  group: Group;
  scope: Scope;
  /** Typical severity; libraries differ and the harness records each library's own severity. */
  defaultSeverity: Severity;
  derivation: Derivation;
  summary: string;
}

const r = (group: Group, scope: Scope, defaultSeverity: Severity, derivation: Derivation, summary: string): ReasonMeta => ({
  group, scope, defaultSeverity, derivation, summary,
});

export const REASON_CODES = {
  // input
  INVALID_INPUT: r("input", "meta", "blocking", "local", "Input rejected without saying which field (stellar-check INVALID_INPUT)."),
  INVALID_DESTINATION: r("input", "receive", "blocking", "local", "Destination is not a valid G, M, C or federation address."),
  DESTINATION_IS_SECRET_KEY: r("input", "receive", "blocking", "local", "A secret seed was pasted as the destination. Never put one in a fixture (G-SECRETS)."),
  INVALID_ASSET: r("input", "meta", "blocking", "local", "Asset identifier not recognised."),
  INVALID_AMOUNT: r("input", "meta", "blocking", "local", "Amount malformed, non-positive or too many decimals."),
  INVALID_SENDER: r("input", "meta", "blocking", "local", "Sender is not a valid G or C address."),
  INVALID_MEMO: r("input", "meta", "blocking", "local", "Memo value malformed for its type."),
  UNSUPPORTED_SCENARIO: r("input", "meta", "blocking", "local", "Library declares the payment shape out of scope."),
  // address
  DESTINATION_MUXED: r("address", "receive", "info", "local", "Destination is a muxed M address; funds go to the base account with an id."),
  DESTINATION_IS_ISSUER: r("address", "receive", "info", "local", "Destination is the asset issuer; the payment burns."),
  DESTINATION_IS_CONTRACT: r("address", "receive", "info", "local", "Destination is a C address; memo rules do not apply and classic payments cannot reach it."),
  FEDERATION_UNRESOLVED: r("address", "receive", "blocking", "public-read", "SEP-2 federation address did not resolve."),
  DESTINATION_FLAGGED: r("address", "receive", "blocking", "public-read", "Third-party directory flags the destination (malicious/unsafe). Directory is closed (StellarExpert)."),
  MUXED_FROM_CONTRACT_SENDER_RISK: r("address", "receive", "warning", "out-of-band", "Contract sender to a muxed destination: many exchanges do not credit these."),
  MUXED_ID_DROPPED_BY_RECEIVER: r("address", "receive", "warning", "out-of-band", "Receiver ignores the muxed id (exchange behaviour). Not derivable from public state."),
  // account
  ACCOUNT_UNFUNDED: r("account", "receive", "blocking", "public-read", "Destination account does not exist (op_no_destination for classic)."),
  ACCOUNT_UNFUNDED_CREATE_REQUIRED: r("account", "receive", "warning", "public-read", "Native payment to a non-existent account needs createAccount instead."),
  AMOUNT_BELOW_ACCOUNT_MINIMUM: r("account", "receive", "blocking", "public-read", "Non-existent account and amount below the createAccount minimum."),
  MUXED_BASE_ACCOUNT_UNFUNDED: r("account", "receive", "blocking", "public-read", "Base account behind a muxed address does not exist."),
  NATIVE_BALANCE_CAP: r("account", "receive", "blocking", "public-read", "Native balance plus buying liabilities would exceed int64."),
  RESERVE_INSUFFICIENT_FOR_TRUSTLINE: r("account", "receive", "blocking", "public-read", "Destination lacks XLM reserve/subentry room to add a trustline (SAC errors #14/#15)."),
  // memo
  MEMO_REQUIRED: r("memo", "receive", "warning", "public-read", "Destination declares config.memo_required (SEP-29) and no memo was given."),
  MEMO_REQUIRED_DIRECTORY: r("memo", "receive", "warning", "out-of-band", "Memo required according to an exchange directory, not on-chain."),
  MEMO_UNSUPPORTED_FOR_CONTRACT_SENDER: r("memo", "receive", "blocking", "local", "A contract sender cannot attach a memo."),
  // trustline
  TRUSTLINE_MISSING: r("trustline", "receive", "blocking", "public-read", "Destination has no trustline for the asset (op_no_trust)."),
  TRUSTLINE_NOT_AUTHORIZED: r("trustline", "receive", "blocking", "public-read", "Issuer has not authorised the trustline (op_not_authorized)."),
  TRUSTLINE_MAINTAIN_LIABILITIES_ONLY: r("trustline", "receive", "blocking", "public-read", "Trustline is authorised to maintain liabilities only; it cannot receive."),
  TRUSTLINE_LIMIT_EXCEEDED: r("trustline", "receive", "blocking", "public-read", "limit - balance - buying liabilities < amount (op_line_full)."),
  ISSUER_MISSING: r("trustline", "receive", "blocking", "public-read", "Issuer account does not exist."),
  // asset flags
  ASSET_CLAWBACK_ENABLED: r("asset", "receive", "info", "public-read", "Issuer can claw back received funds."),
  ASSET_AUTH_REVOCABLE: r("asset", "receive", "info", "public-read", "Issuer can revoke authorisation (freeze risk)."),
  ASSET_AUTH_REQUIRED: r("asset", "receive", "info", "public-read", "Issuer requires authorisation for every holder."),
  // SAC / contract destination
  CONTRACT_DESTINATION_MISSING: r("sac", "receive", "blocking", "public-read", "No contract instance at the C address; funds would be stranded. Simulation does NOT detect this."),
  SAC_NOT_DEPLOYED: r("sac", "receive", "blocking", "public-read", "No Stellar Asset Contract deployed for the classic asset."),
  SAC_UNREADABLE: r("sac", "receive", "blocking", "public-read", "Could not read which asset the SAC wraps."),
  SAC_BALANCE_NOT_AUTHORIZED: r("sac", "receive", "blocking", "public-read", "Holder's SAC balance exists and is deauthorised."),
  SAC_BALANCE_NEEDS_AUTHORIZATION: r("sac", "receive", "blocking", "public-read", "Issuer requires auth and the holder has no authorised balance yet."),
  SAC_RECIPIENT_DEAUTHORIZED: r("sac", "receive", "blocking", "simulation", "Simulation #11 attributed to the recipient (needs a per-party read; #11 alone is ambiguous)."),
  SAC_SENDER_DEAUTHORIZED: r("sac", "sender", "blocking", "simulation", "Simulation #11 attributed to the sender."),
  SAC_DEAUTHORIZED_PARTY_UNKNOWN: r("sac", "receive", "blocking", "simulation", "Simulation #11 BalanceDeauthorized with no per-party read: sender or recipient."),
  SIM_ACCOUNT_OR_TRUSTLINE_MISSING: r("sac", "receive", "blocking", "simulation", "Simulation #13 TrustlineMissing; also returned for an unfunded G account, so the two cannot be told apart by simulation."),
  // contract tokens
  TOKEN_CONTRACT_MISSING: r("token", "receive", "blocking", "public-read", "Token contract does not exist or is archived."),
  NOT_A_TOKEN: r("token", "receive", "blocking", "public-read", "Contract does not implement the SEP-41 read surface."),
  TOKEN_HOLDER_ACCOUNT_MISSING: r("token", "receive", "warning", "public-read", "Holder G account does not exist; it can hold the token but cannot move it."),
  MUXED_ID_UNSUPPORTED_BY_TOKEN: r("token", "receive", "warning", "out-of-band", "Custom token may drop the muxed id."),
  CUSTOM_TOKEN_LOGIC: r("token", "receive", "info", "simulation", "Custom token: a clean simulation does not prove submit-time success."),
  TOKEN_ADDRESS_FROZEN: r("token", "receive", "blocking", "public-read", "SEP-57 is_frozen(user) is true for the destination."),
  TOKEN_PAUSED: r("token", "receive", "blocking", "public-read", "Token contract is paused."),
  TOKEN_IDENTITY_UNVERIFIED: r("token", "receive", "blocking", "simulation", "SEP-57 identity verifier rejects the destination (verify_identity panics)."),
  TOKEN_ALLOWLIST_EXCLUDED: r("token", "receive", "blocking", "public-read", "OpenZeppelin allowlist extension: allowed(destination) is false (non-standard read)."),
  TOKEN_BLOCKLISTED: r("token", "receive", "blocking", "public-read", "OpenZeppelin blocklist extension: blocked(destination) is true (non-standard read)."),
  TOKEN_COMPLIANCE_REJECTED: r("token", "receive", "blocking", "simulation", "A SEP-57 compliance module rejects the transfer (post-state panic; seen only via simulation)."),
  TOKEN_DECIMALS_MISMATCH: r("token", "meta", "blocking", "public-read", "Amount has more decimals than the token supports."),
  // simulation
  SIMULATION_NOT_RUN: r("simulation", "meta", "info", "local", "Transfer was not simulated (no sender or library skipped it)."),
  SIMULATION_TRANSFER_FAILED: r("simulation", "receive", "blocking", "simulation", "Simulation failed with a contract error the library did not classify."),
  SIMULATION_UNSUPPORTED_OPERATION: r("simulation", "meta", "info", "local", "Classic payment operations cannot be simulated (RPC rejects OperationTypePayment)."),
  // regulated assets
  REGULATED_ASSET_APPROVAL_REQUIRED: r("regulated", "receive", "warning", "out-of-band", "SEP-8 regulated asset: an approval server decides per payment; not derivable as a pure read."),
  // sender-side (kept so nothing a library says is dropped)
  SENDER_ACCOUNT_MISSING: r("sender", "sender", "blocking", "public-read", "Sender account does not exist."),
  SENDER_TRUSTLINE_MISSING: r("sender", "sender", "blocking", "public-read", "Sender has no trustline for the asset."),
  SENDER_NOT_AUTHORIZED: r("sender", "sender", "blocking", "public-read", "Sender trustline not authorised."),
  SENDER_INSUFFICIENT_XLM: r("sender", "sender", "blocking", "public-read", "Sender lacks XLM for amount, reserve, liabilities and fee."),
  SENDER_INSUFFICIENT_ASSET: r("sender", "sender", "blocking", "public-read", "Sender balance after selling liabilities is below the amount (SAC #10)."),
  FEE_BUDGET_TOO_LOW: r("sender", "sender", "blocking", "public-read", "Planned fee below the network base fee."),
  // provider / meta
  NETWORK_MISMATCH: r("provider", "meta", "blocking", "local", "Provider passphrase differs from the intent."),
  PROVIDER_TIMEOUT: r("provider", "meta", "blocking", "public-read", "A read exceeded its deadline."),
  PROVIDER_RATE_LIMITED: r("provider", "meta", "blocking", "public-read", "Provider returned HTTP 429."),
  PROVIDER_UNAVAILABLE: r("provider", "meta", "warning", "public-read", "Provider or RPC could not be reached."),
  MALFORMED_PROVIDER_DATA: r("provider", "meta", "blocking", "public-read", "Provider returned inconsistent state."),
  DIRECTORY_UNAVAILABLE: r("provider", "meta", "info", "public-read", "Third-party directory could not be reached."),
  CHECK_SKIPPED: r("provider", "meta", "info", "local", "A check was skipped (no RPC given, no sender, etc.)."),
} as const satisfies Record<string, ReasonMeta>;

export type ReasonCode = keyof typeof REASON_CODES;

export const REASON_CODE_LIST = Object.keys(REASON_CODES) as ReasonCode[];

export function isReasonCode(value: string): value is ReasonCode {
  return Object.prototype.hasOwnProperty.call(REASON_CODES, value);
}

/**
 * Parent relation for comparison (SPEC section 6.2): a library that reports the child agrees with one that
 * reports the parent at "refinement" level, and the report says which one is more specific.
 */
export const REFINES: Partial<Record<ReasonCode, ReasonCode>> = {
  TRUSTLINE_MAINTAIN_LIABILITIES_ONLY: "TRUSTLINE_NOT_AUTHORIZED",
  SAC_BALANCE_NEEDS_AUTHORIZATION: "SAC_BALANCE_NOT_AUTHORIZED",
  SAC_RECIPIENT_DEAUTHORIZED: "SAC_DEAUTHORIZED_PARTY_UNKNOWN",
  SAC_SENDER_DEAUTHORIZED: "SAC_DEAUTHORIZED_PARTY_UNKNOWN",
  ACCOUNT_UNFUNDED_CREATE_REQUIRED: "ACCOUNT_UNFUNDED",
  AMOUNT_BELOW_ACCOUNT_MINIMUM: "ACCOUNT_UNFUNDED",
  MUXED_BASE_ACCOUNT_UNFUNDED: "ACCOUNT_UNFUNDED",
  MEMO_REQUIRED_DIRECTORY: "MEMO_REQUIRED",
  TOKEN_ADDRESS_FROZEN: "SIMULATION_TRANSFER_FAILED",
  TOKEN_PAUSED: "SIMULATION_TRANSFER_FAILED",
  TOKEN_IDENTITY_UNVERIFIED: "SIMULATION_TRANSFER_FAILED",
  TOKEN_ALLOWLIST_EXCLUDED: "SIMULATION_TRANSFER_FAILED",
  TOKEN_BLOCKLISTED: "SIMULATION_TRANSFER_FAILED",
  TOKEN_COMPLIANCE_REJECTED: "SIMULATION_TRANSFER_FAILED",
  SAC_DEAUTHORIZED_PARTY_UNKNOWN: "SIMULATION_TRANSFER_FAILED",
  SIM_ACCOUNT_OR_TRUSTLINE_MISSING: "SIMULATION_TRANSFER_FAILED",
};

/** Codes equal at the level of the underlying fact although the libraries name them differently (SPEC 6.2). */
export const SAME_FACT: ReasonCode[][] = [
  ["ACCOUNT_UNFUNDED", "SIM_ACCOUNT_OR_TRUSTLINE_MISSING", "TRUSTLINE_MISSING"],
  ["SAC_BALANCE_NOT_AUTHORIZED", "TRUSTLINE_NOT_AUTHORIZED"],
];
