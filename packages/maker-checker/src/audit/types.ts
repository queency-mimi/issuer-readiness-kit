// SPDX-License-Identifier: Apache-2.0
// Normative shapes: SPEC.md section 8. JSON Schema: schemas/audit-entry.schema.json.
import type { Hex32 } from "../hash.ts";
import type { IsoTime } from "../policy/types.ts";

export type AuditEventType =
  | "policy.registered"
  | "request.proposed"
  | "request.policy_denied"
  | "approval.recorded"
  | "request.threshold_met"
  | "auth.planned"
  | "auth.slot_collected"
  | "auth.slot_declined"
  | "request.signed"
  | "request.submitted"
  | "request.submit_failed"
  | "request.rejected"
  | "request.cancelled"
  | "request.expired"
  | "control.built"
  | "audit.checkpoint";

export interface AuditEntry {
  version: 1;
  /** 0-based, gapless. */
  seq: number;
  /** Hash of the previous entry; GENESIS_HASH for seq 0. */
  prevHash: Hex32;
  at: IsoTime;
  type: AuditEventType;
  /** Principal id or "system". Never a secret. */
  actor: string;
  requestId?: Hex32;
  policyHash?: Hex32;
  /** Event-specific object; canonical-JSON-safe; never contains private keys or raw signatures of tx. */
  data: Record<string, unknown>;
  /** tagged SHA-256 over canonical JSON of this entry without `hash`. */
  hash: Hex32;
}

export type NewAuditEntry = Omit<AuditEntry, "version" | "seq" | "prevHash" | "hash" | "at"> & { at?: IsoTime };

/** Storage contract. Implementations must make append atomic and reject a stale expectedSeq. */
export interface AuditStore {
  head(): Promise<{ seq: number; hash: Hex32 } | undefined>;
  append(entry: AuditEntry, expectedSeq: number): Promise<void>;
  read(fromSeq: number, limit: number): Promise<AuditEntry[]>;
}

export interface VerifyReport {
  ok: boolean;
  entries: number;
  head?: { seq: number; hash: Hex32 };
  /** First failing seq and why, when ok is false. */
  failure?: { seq: number; reason: "bad_hash" | "bad_prev" | "bad_seq" | "bad_shape" };
}
