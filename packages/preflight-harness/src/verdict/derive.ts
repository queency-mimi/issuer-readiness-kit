// SPDX-License-Identifier: Apache-2.0
// Verdict derivation (SPEC.md section 4.1). The harness decides the class from mapped reasons, never from the
// library's own status string; the status is only compared for an informational finding.
import { REASON_CODES } from "../taxonomy/codes.ts";
import type { ReasonEntry, ReceiveVerdict, ReceiveVerdictClass } from "../types.ts";

/** Priority: error -> unknown; receive blocking -> cannot; meta warning/blocking -> unknown; receive warning -> warnings; else can. */
export function deriveVerdict(reasons: readonly ReasonEntry[], error?: ReceiveVerdict["error"]): ReceiveVerdictClass {
  if (error) return "unknown";
  const scoped = reasons.map((x) => ({ scope: REASON_CODES[x.code].scope, severity: x.severity }));
  if (scoped.some((x) => x.scope === "receive" && x.severity === "blocking")) return "cannot_receive";
  if (scoped.some((x) => x.scope === "meta" && x.severity !== "info")) return "unknown";
  if (scoped.some((x) => x.scope === "receive" && x.severity === "warning")) return "can_receive_with_warnings";
  return "can_receive";
}

const STATUS_CLASS: Record<string, ReceiveVerdictClass> = {
  READY: "can_receive",
  WARNING: "can_receive_with_warnings",
  BLOCKED: "cannot_receive",
  ok: "can_receive",
  warn: "can_receive_with_warnings",
  block: "cannot_receive",
  no_known_issues: "can_receive",
  issues_found: "cannot_receive",
  incomplete: "unknown",
};

/** The class a library's own status string implies, or undefined for an unrecognised status. */
export function statusClass(libraryStatus: string): ReceiveVerdictClass | undefined {
  return STATUS_CLASS[libraryStatus];
}

/** True when the library's status maps to the derived class (SPEC 4.1 informational check). */
export function statusAgreement(libraryStatus: string, derived: ReceiveVerdictClass): boolean {
  return statusClass(libraryStatus) === derived;
}
