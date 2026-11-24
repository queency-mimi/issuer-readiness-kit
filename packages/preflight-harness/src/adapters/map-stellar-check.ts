// SPDX-License-Identifier: Apache-2.0
// stellar-check Report -> ReceiveVerdict (PFH-004). Pure; does not call the library.
// stellar-check diagnostics carry no severity: every issue is blocking for the payment (status issues_found).
// Scope is decided by the canonical code, not the library's `party`: stellar-check files MEMO_REQUIRED under
// party "sender" (the sender must add it) while the fact is a destination requirement (SEP-29), so it stays a
// receive-scope reason; the library's party is kept on the entry.
import type { Report } from "stellar-check";
import type { CaseFile, Party, ReasonEntry, ReceiveVerdict } from "../types.ts";
import { assembleVerdict, jsonSafe, mapReason } from "./map-common.ts";

const TIMESTAMPS = new Set(["observedAt", "startedAt", "finishedAt"]);
const PARTY: Record<string, Party> = { sender: "sender", recipient: "recipient", issuer: "issuer", application: "application", provider: "provider" };

export function mapStellarCheckReport(report: Report, testCase: CaseFile, adapterVersion = "0.1.1"): ReceiveVerdict {
  const entries: ReasonEntry[] = [];
  const unmapped: string[] = [];
  const native = testCase.input.asset.kind === "native";
  for (const d of report.issues) {
    const entry = mapReason("stellar-check", { libraryCode: d.code, severity: "blocking", party: PARTY[d.party] ?? "unspecified", message: d.message }, (candidates) => {
      if (d.code === "DESTINATION_CAPACITY_EXCEEDED") return native ? "NATIVE_BALANCE_CAP" : "TRUSTLINE_LIMIT_EXCEEDED";
      // DESTINATION_NOT_AUTHORIZED: the library does not split maintain-liabilities-only from unauthorised; report the parent.
      return candidates[0]!;
    });
    if (entry) entries.push(entry);
    else unmapped.push(d.code);
  }
  for (const c of report.coverage) {
    if (c.status === "unresolved") entries.push({ code: "CHECK_SKIPPED", severity: "info", party: "application", libraryCode: `coverage.unresolved:${c.check}`, ...(c.reason ? { message: c.reason } : {}) });
  }
  return assembleVerdict({
    adapterId: "stellar-check",
    adapterVersion,
    caseId: testCase.caseId,
    entries,
    unmapped,
    libraryStatus: report.status,
    raw: jsonSafe(report, TIMESTAMPS),
  });
}
