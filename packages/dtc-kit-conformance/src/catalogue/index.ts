// SPDX-License-Identifier: Apache-2.0
import type { ScenarioPack } from "../pack.ts";
import { OVERRIDE_AND_CA_SCENARIOS } from "./override-scenarios.ts";
import { REGISTRY_SCENARIOS } from "./registry-scenarios.ts";
import { STELLAR_SCENARIOS } from "./stellar-scenarios.ts";

export { REGISTRY_SCENARIOS, OVERRIDE_AND_CA_SCENARIOS, STELLAR_SCENARIOS };

/** The catalogue as a ScenarioPack. Implemented scenarios run via src/implementations.ts; the rest are titled specs with a ticket. */
export const DTC_KIT_PACK: ScenarioPack = {
  packFormat: "1",
  packId: "dtc-kit-readiness",
  version: "2026-11-08",
  title: "DTC participant readiness scenarios",
  profile: "dtc-stellar",
  disclaimer:
    "DTC-shaped, not DTC-certified. Scenarios tagged @inferred or @unknown rest on profile rows that DTCC has not published; results must be labelled accordingly.",
  scenarios: [...REGISTRY_SCENARIOS, ...OVERRIDE_AND_CA_SCENARIOS, ...STELLAR_SCENARIOS],
};
