// SPDX-License-Identifier: Apache-2.0
// Stellar-Preflight PreflightResult -> ReceiveVerdict (PFH-009). Pure; the result shape is mirrored locally from
// packages/sdk/src/preflight.ts at the pinned commit (read as text); the clone is never imported here.
import type { ReasonCode, Severity } from "../taxonomy/codes.ts";
import type { CaseFile, ReasonEntry, ReceiveVerdict } from "../types.ts";
import { assembleVerdict, jsonSafe, mapReason } from "./map-common.ts";

export interface PreflightResultLike {
  status: "READY" | "WARNING" | "BLOCKED";
  route?: string;
  recipient?: unknown;
  asset?: { kind: "native" | "classic" | "sac" | "sep41"; label: string; contractId?: string; decimals?: number };
  issues: { code: string; severity: Severity; message: string; action?: string }[];
}

/** SAC error enum (rs-soroban-env contract_error.rs; SPEC 8 SIM-10) -> canonical code. Only for SAC tokens. */
const SAC_ERROR: Record<number, ReasonCode> = { 10: "SENDER_INSUFFICIENT_ASSET", 11: "SAC_DEAUTHORIZED_PARTY_UNKNOWN", 13: "SIM_ACCOUNT_OR_TRUSTLINE_MISSING" };

export function mapPreflightResult(result: PreflightResultLike, testCase: CaseFile, context: { simulationErrorCode?: number } = {}, adapterVersion = "git:4599d9c77c66"): ReceiveVerdict {
  const entries: ReasonEntry[] = [];
  const unmapped: string[] = [];
  const isSac = result.asset?.kind === "sac" || (result.asset?.kind !== "sep41" && result.asset?.contractId !== undefined);
  for (const issue of result.issues) {
    const entry = mapReason("stellar-preflight", { libraryCode: issue.code, severity: issue.severity, party: "unspecified", message: issue.message }, (candidates) => {
      if (issue.code !== "TRANSFER_SIMULATION_FAILED") return candidates[0]!;
      const code = context.simulationErrorCode;
      const refined = isSac && code !== undefined ? SAC_ERROR[code] : undefined;
      return refined ?? "SIMULATION_TRANSFER_FAILED";
    });
    if (entry) entries.push(entry);
    else unmapped.push(issue.code);
  }
  return assembleVerdict({
    adapterId: "stellar-preflight",
    adapterVersion,
    caseId: testCase.caseId,
    entries,
    unmapped,
    libraryStatus: result.status,
    raw: jsonSafe(result),
  });
}
