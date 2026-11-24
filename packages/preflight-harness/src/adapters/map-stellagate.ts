// SPDX-License-Identifier: Apache-2.0
// stellagate-core Verdict -> ReceiveVerdict (PFH-005). Pure; does not call the library.
// Disambiguation (SPEC 3.2) uses the library's message text where one code covers two situations.
import type { Verdict } from "stellagate-core";
import type { Severity } from "../taxonomy/codes.ts";
import type { CaseFile, ReasonEntry, ReceiveVerdict } from "../types.ts";
import { assembleVerdict, jsonSafe, mapReason } from "./map-common.ts";

const SEVERITY: Record<string, Severity> = { info: "info", warn: "warning", block: "blocking" };

export function mapStellagateVerdict(verdict: Verdict, testCase: CaseFile, adapterVersion = "0.1.1"): ReceiveVerdict {
  const entries: ReasonEntry[] = [];
  const unmapped: string[] = [];
  for (const r of verdict.reasons) {
    const entry = mapReason("stellagate-core", { libraryCode: r.code, severity: SEVERITY[r.severity] ?? "blocking", party: "unspecified", message: r.message }, (candidates) => {
      if (r.code === "sac_balance_not_authorized") return r.message.includes("has not been approved") ? "SAC_BALANCE_NEEDS_AUTHORIZATION" : "SAC_BALANCE_NOT_AUTHORIZED";
      if (r.code === "memo_required") return r.message.includes("(public directory)") ? "MEMO_REQUIRED_DIRECTORY" : "MEMO_REQUIRED";
      // trustline_not_authorized: its Trustline type has one `authorized` boolean, so it cannot tell maintain-liabilities apart.
      return candidates[0]!;
    });
    if (entry) entries.push(entry);
    else unmapped.push(r.code);
  }
  return assembleVerdict({
    adapterId: "stellagate-core",
    adapterVersion,
    caseId: testCase.caseId,
    entries,
    unmapped,
    libraryStatus: verdict.status,
    raw: jsonSafe(verdict),
  });
}
