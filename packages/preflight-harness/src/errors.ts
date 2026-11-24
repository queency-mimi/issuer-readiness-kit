// SPDX-License-Identifier: Apache-2.0

/** Thrown by every stub. The ticket id names the task that replaces it (see TASKS.md). */
export class NotImplemented extends Error {
  readonly ticket: string;
  constructor(ticket: string) {
    super(`not implemented: ${ticket}`);
    this.name = "NotImplemented";
    this.ticket = ticket;
  }
}

export type PfhErrorCode =
  | "PFH_E_FIXTURE_INVALID"
  | "PFH_E_FIXTURE_PROVENANCE_MISSING"
  | "PFH_E_FIXTURE_SECRET"
  | "PFH_E_ADAPTER_UNAVAILABLE"
  | "PFH_E_ADAPTER_THREW"
  | "PFH_E_UNMAPPED_LIBRARY_CODE"
  | "PFH_E_CAPTURE_NETWORK"
  | "PFH_E_CAPTURE_WRITE_ATTEMPT"
  | "PFH_E_USAGE";

export class PfhError extends Error {
  readonly code: PfhErrorCode;
  readonly details: Record<string, unknown>;
  constructor(code: PfhErrorCode, message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = "PfhError";
    this.code = code;
    this.details = details;
  }
}
