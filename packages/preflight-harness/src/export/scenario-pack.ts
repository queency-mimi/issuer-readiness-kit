// SPDX-License-Identifier: Apache-2.0
// Scenario-pack exporter for dtc-kit's ScenarioPack contract (docs/ARCHITECTURE.md, "Cross-project contracts":
// owner dtc-kit/conformance, consumers token-invariants and preflight-harness).
// Contract read on 2026-10-31: projects/dtc-kit/packages/conformance/schema/scenario-pack.schema.json
// (packFormat "1") and SPEC.md section 5.1 of dtc-kit. The types below MIRROR that shape (no import from
// another project's source tree, ADR-0002); conformance is tested by validating the exported pack against the
// owner's published JSON Schema when it is present (test/smoke.test.ts, PFH-027).
// We do NOT define or run dtc-kit's runner. Known friction recorded in TASKS.md "Cross-project requests":
// the contract's `ticket` pattern is ^DTC-[0-9]{3}$, but scenarios produced here are implemented by PFH tickets.
import { DTC_STELLAR_DISCLAIMER, scenarioStatusTag } from "../dtc/scenarios.ts";
import type { DtcScenarioDef, ScenarioArea } from "../dtc/scenarios.ts";

export type ScenarioTag = "@published" | "@inferred" | "@unknown" | "@stellar-sac" | "@stellar-sep57" | "@testnet" | "@slow";

export interface PackScenario {
  /** `SC-NNN` */
  id: string;
  title: string;
  area: ScenarioArea;
  tags: ScenarioTag[];
  requiresRows: string[];
  onUnknown: "skip" | "run-and-label";
  given: string[];
  when: string;
  then: string[];
  status: "catalogue" | "implemented";
  /** Implementing ticket. dtc-kit's pattern is DTC-NNN; ours are PFH-NNN (see header). */
  ticket: string;
  testFile?: string;
}

export interface ScenarioPack {
  packFormat: "1";
  packId: "preflight-harness-dtc-wallet-readiness";
  /** YYYY-MM-DD with optional .N revision */
  version: string;
  title: string;
  profile: "dtc-stellar";
  disclaimer: string;
  scenarios: PackScenario[];
}

export { DTC_STELLAR_DISCLAIMER };

const scId = (n: number): string => `SC-${String(n).padStart(3, "0")}`;

/**
 * Build the pack from the scenario definitions. Pure and deterministic. Rules (all tested):
 *  - exactly one trust tag, equal to the weakest status among `requiresRows` (dtc-kit's catalogueProblems rule);
 *  - `onUnknown` is "run-and-label" when any referenced row is `unknown`, else "skip";
 *  - `status` is "catalogue" until the scenario is executed by dtc-kit's runner through an adapter we provide;
 *  - the profile disclaimer text is carried verbatim.
 */
export function buildScenarioPack(defs: DtcScenarioDef[], options: { version: string }): ScenarioPack {
  const scenarios: PackScenario[] = defs.map((d) => {
    const tags: ScenarioTag[] = [scenarioStatusTag(d), ...d.extraTags];
    const anyUnknown = d.requirementRefs.some((r) => r.status === "unknown");
    const then = [`readiness is ${d.expect.readiness}`];
    if (d.expect.receiveReasons.length > 0) then.push(`receive reasons include ${d.expect.receiveReasons.join(", ")}`);
    if (d.expect.dtcReasons.length > 0) then.push(`DTC readiness reasons include ${d.expect.dtcReasons.join(", ")}`);
    return {
      id: scId(d.sc),
      title: d.title,
      area: d.area,
      tags,
      requiresRows: d.requirementRefs.map((r) => r.rowId),
      onUnknown: anyUnknown ? "run-and-label" : "skip",
      given: [d.given, d.baseCase === null ? "fixture: to be captured (no catalogue case yet)" : `fixture: preflight-harness case ${d.baseCase}${d.inputOverride?.amount ? ` with amount ${d.inputOverride.amount}` : ""}`],
      when: "the wallet is checked for ability to receive the asset with preflight-harness (library verdicts plus the DTC readiness evaluator)",
      then,
      status: "catalogue",
      ticket: "PFH-026",
    };
  });
  return {
    packFormat: "1",
    packId: "preflight-harness-dtc-wallet-readiness",
    version: options.version,
    title: "DTC registered-wallet readiness scenarios (preflight-harness)",
    profile: "dtc-stellar",
    disclaimer: DTC_STELLAR_DISCLAIMER,
    scenarios,
  };
}
