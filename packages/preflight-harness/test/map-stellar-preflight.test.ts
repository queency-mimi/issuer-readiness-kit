// SPDX-License-Identifier: Apache-2.0
// PFH-009: Stellar-Preflight PreflightResult -> ReceiveVerdict. Results are hand-built objects typed locally;
// the clone in .competitors/ is never imported here.
import assert from "node:assert/strict";
import { test } from "node:test";
import { mapPreflightResult } from "../src/adapters/map-stellar-preflight.ts";
import type { PreflightResultLike } from "../src/adapters/map-stellar-preflight.ts";
import { LIBRARY_INVENTORY } from "../src/taxonomy/library-maps.ts";
import type { CaseFile } from "../src/types.ts";

const caseFile: CaseFile = {
  schema: "sik.case/1", caseId: "t.case", title: "t", tags: ["@sac"], captured: true,
  input: { network: "testnet", destination: "GASVYHCTBQCHUOQ5WA7FFQOVSXCXOCOJAADDM3JNMQORLC2LF3AU647P", asset: { kind: "native" }, amount: "10" },
  expected: { mustReport: [], verdict: "undetermined", rationale: "test" },
};
const result = (status: PreflightResultLike["status"], issues: [string, "info" | "warning" | "blocking"][], kind: "native" | "classic" | "sac" | "sep41" = "classic"): PreflightResultLike => ({
  status, asset: { kind, label: "x" }, issues: issues.map(([code, severity]) => ({ code, severity, message: `${code} message` })),
});

test("preflight map: READY with info issues -> can_receive; status recorded", () => {
  const v = mapPreflightResult(result("READY", [["ASSET_AUTH_REVOCABLE", "info"]]), caseFile);
  assert.equal(v.verdict, "can_receive");
  assert.equal(v.libraryStatus, "READY");
  assert.deepEqual(v.reasons.map((r) => r.code), ["ASSET_AUTH_REVOCABLE"]);
  assert.equal(v.adapterId, "stellar-preflight");
});

test("preflight map: maintain-liabilities-only is its own code; memo required is a warning", () => {
  assert.deepEqual(mapPreflightResult(result("BLOCKED", [["TRUSTLINE_LIMITED_AUTH", "blocking"]]), caseFile).reasons.map((r) => r.code), ["TRUSTLINE_MAINTAIN_LIABILITIES_ONLY"]);
  const memo = mapPreflightResult(result("WARNING", [["MEMO_REQUIRED", "warning"]]), caseFile);
  assert.equal(memo.verdict, "can_receive_with_warnings");
});

test("preflight map: TRANSFER_SIMULATION_FAILED refined by the recorded SAC contract error code", () => {
  const refine = (code: number | undefined, kind: "sac" | "sep41" = "sac") => {
    const v = mapPreflightResult(result("BLOCKED", [["TRANSFER_SIMULATION_FAILED", "blocking"]], kind), caseFile, code === undefined ? {} : { simulationErrorCode: code });
    return { receive: v.reasons.map((r) => r.code), sender: v.senderSide.map((r) => r.code), verdict: v.verdict };
  };
  assert.deepEqual(refine(11).receive, ["SAC_DEAUTHORIZED_PARTY_UNKNOWN"]);
  assert.deepEqual(refine(13).receive, ["SIM_ACCOUNT_OR_TRUSTLINE_MISSING"]);
  const ten = refine(10);
  assert.deepEqual([ten.receive, ten.sender, ten.verdict], [[], ["SENDER_INSUFFICIENT_ASSET"], "can_receive"]);
  assert.deepEqual(refine(7).receive, ["SIMULATION_TRANSFER_FAILED"]);
  assert.deepEqual(refine(undefined).receive, ["SIMULATION_TRANSFER_FAILED"]);
  // SEP-41 error numbers are token-specific: never refined by SAC numbering.
  assert.deepEqual(refine(11, "sep41").receive, ["SIMULATION_TRANSFER_FAILED"]);
});

test("preflight map: every inventory code maps; unknown codes are listed in unmapped", () => {
  for (const code of LIBRARY_INVENTORY["stellar-preflight"].codes) {
    const v = mapPreflightResult(result("BLOCKED", [[code, "blocking"]]), caseFile);
    assert.deepEqual(v.unmapped, [], code);
    assert.equal(v.reasons.length + v.senderSide.length, 1, code);
  }
  assert.deepEqual(mapPreflightResult(result("WARNING", [["NEW_THING", "warning"]]), caseFile).unmapped, ["NEW_THING"]);
});
