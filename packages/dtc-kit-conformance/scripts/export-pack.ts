// SPDX-License-Identifier: Apache-2.0
// Writes packs/dtc-kit-readiness.pack.json from the TS catalogue so non-TS consumers can read it.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DTC_KIT_PACK } from "../src/catalogue/index.ts";
import { schemaProblems } from "../src/lint.ts";

const problems = schemaProblems(DTC_KIT_PACK);
if (problems.length > 0) {
  console.error(problems.join("\n"));
  process.exit(1);
}
const out = join(import.meta.dirname, "..", "packs");
mkdirSync(out, { recursive: true });
const file = join(out, `${DTC_KIT_PACK.packId}.pack.json`);
writeFileSync(file, `${JSON.stringify({ $schema: "../schema/scenario-pack.schema.json", ...DTC_KIT_PACK }, null, 2)}\n`);
console.log(`wrote ${file} (${DTC_KIT_PACK.scenarios.length} scenarios)`);
