// SPDX-License-Identifier: Apache-2.0
// Audit export (SPEC 8.8): jsonl, csv (RFC 4180, formula-injection guard), control-actions filter.
import { canonicalize } from "../canonical.ts";
import type { AuditEntry } from "./types.ts";

export function summarizeEntry(e: AuditEntry): string {
  const d = e.data as Record<string, unknown>;
  const s = (k: string) => (d[k] === undefined ? "" : String(d[k]));
  switch (e.type) {
    case "policy.registered":
      return `policy ${s("policyHash").slice(0, 12)} registered by ${s("registeredBy")}`;
    case "request.proposed":
      return `${s("kind")}${d.controlKind ? ` ${s("controlKind")}` : ""}: ${s("headline")}`;
    case "request.policy_denied":
      return `denied: ${Array.isArray(d.reasons) ? d.reasons.join(", ") : ""}`;
    case "approval.recorded":
      return `${s("approver")} ${s("decision")} (${s("scheme")})`;
    case "request.threshold_met":
      return `threshold met; signing from ${s("signingEligibleAt")}`;
    case "auth.planned":
      return `auth plan ${s("planId").slice(0, 12)}, ${Array.isArray(d.slots) ? d.slots.length : 0} slot(s), reason ${s("reason")}`;
    case "auth.slot_collected":
      return `slot ${s("slotId")} signed by ${s("signerId")}`;
    case "auth.slot_declined":
      return `slot ${s("slotId")} declined by ${s("signerId")}: ${s("reason")}`;
    case "request.signed":
      return `envelope signed ${s("signedTxXdrHash").slice(0, 12)}`;
    case "request.submitted":
      return `submitted tx ${s("txHash").slice(0, 12)}${d.ledger ? ` ledger ${s("ledger")}` : ""}`;
    case "request.submit_failed":
      return `submit failed: ${s("code")}`;
    case "control.built":
      return `control ${s("controlKind")} built for ${s("contract")}`;
    case "audit.checkpoint":
      return `checkpoint head ${s("headSeq")}`;
    default:
      return e.type.replace("request.", "request ");
  }
}

export function toJsonl(entries: AuditEntry[]): string {
  return entries.map((e) => canonicalize(e) + "\n").join("");
}

function csvCell(v: string): string {
  const guarded = /^[=+\-@\t\r]/.test(v) ? "'" + v : v;
  return /[",\n\r]/.test(guarded) ? `"${guarded.replace(/"/g, '""')}"` : guarded;
}

/** Entries of requests that are SEP-57 control actions, plus control.built entries. */
export function controlActionEntries(entries: AuditEntry[]): AuditEntry[] {
  const control = new Set(entries.filter((e) => e.type === "request.proposed" && e.data.kind === "control").map((e) => e.requestId));
  return entries.filter((e) => e.type === "control.built" || (e.requestId !== undefined && control.has(e.requestId)));
}

export function toCsv(entries: AuditEntry[], opts: { controlActions?: boolean; head?: { seq: number; hash: string } } = {}): string {
  const rows = (opts.controlActions ? controlActionEntries(entries) : entries).map((e) =>
    [String(e.seq), e.at, e.type, e.actor, e.requestId ?? "", summarizeEntry(e)].map(csvCell).join(","),
  );
  const out = ["seq,at,type,actor,requestId,summary", ...rows];
  if (opts.head) out.push(`# verified head seq ${opts.head.seq} hash ${opts.head.hash}`);
  return out.join("\r\n") + "\r\n";
}
