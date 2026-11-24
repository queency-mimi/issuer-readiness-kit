// SPDX-License-Identifier: Apache-2.0

/**
 * Thrown by every stub. The ticket id says which task replaces the stub
 * (see TASKS.md). No stub may be deleted without that ticket being DONE.
 */
export class NotImplemented extends Error {
  readonly ticket: string;
  constructor(ticket: string) {
    super(`not implemented: ${ticket}`);
    this.name = "NotImplemented";
    this.ticket = ticket;
  }
}

/** Stable machine-readable error codes. Messages may change; codes may not (SPEC section 12). */
export type MkrErrorCode =
  | "MKR_E_CANON_UNSUPPORTED_VALUE"
  | "MKR_E_POLICY_PARSE"
  | "MKR_E_POLICY_INVALID"
  | "MKR_E_POLICY_UNKNOWN"
  | "MKR_E_POLICY_DENIED"
  | "MKR_E_TRANSITION_ILLEGAL"
  | "MKR_E_SOD_VIOLATION"
  | "MKR_E_ATTESTATION_INVALID"
  | "MKR_E_REQUEST_EXPIRED"
  | "MKR_E_PAYLOAD_MISMATCH"
  | "MKR_E_AUTH_PLAN_STALE"
  | "MKR_E_AUTH_ENTRY_INVALID"
  | "MKR_E_AUTH_SLOT_UNKNOWN"
  | "MKR_E_SIMULATION_FAILED"
  | "MKR_E_AUDIT_CHAIN_BROKEN"
  | "MKR_E_AUDIT_APPEND_CONFLICT"
  | "MKR_E_SIGNER_UNAVAILABLE"
  | "MKR_E_SIGNER_DECLINED"
  | "MKR_E_MAINNET_SUBMIT_BLOCKED"
  | "MKR_E_USAGE";

export class MkrError extends Error {
  readonly code: MkrErrorCode;
  readonly details: Record<string, unknown>;
  constructor(code: MkrErrorCode, message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = "MkrError";
    this.code = code;
    this.details = details;
  }
}
