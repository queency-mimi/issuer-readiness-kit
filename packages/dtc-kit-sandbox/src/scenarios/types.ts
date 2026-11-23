// SPDX-License-Identifier: Apache-2.0

/** Who makes the call: a fake participant service account, DTC ops, or the sandbox test hook. */
export type Actor = { as: "participant"; participant: string } | { as: "dtc-ops" } | { as: "sim" };

export interface ScriptedStep {
  name: string;
  actor: Actor;
  request: {
    method: "GET" | "POST";
    /** May contain `{{var}}` placeholders filled from earlier `capture` entries. */
    path: string;
    body?: Record<string, unknown>;
  };
  expect: {
    status: number;
    /** Every listed key must match at that JSON path (subset match, dotted path). */
    body?: Record<string, unknown>;
  };
  /** Save response values for later steps: var name -> dotted path in the response body. */
  capture?: Record<string, string>;
}

/**
 * A scripted sandbox scenario: data, no logic. `rows` are the profile rows each expectation rests on, so the
 * runner can label results (G-DTCC). `nalBasis` names the public no-action-letter condition or help page
 * each scenario is built from; nothing here comes from non-public DTCC material.
 */
export interface ScriptedScenario {
  id: string;
  title: string;
  rows: string[];
  nalBasis: string[];
  steps: ScriptedStep[];
}
