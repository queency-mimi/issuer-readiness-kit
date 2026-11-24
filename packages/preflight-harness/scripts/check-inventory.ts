// SPDX-License-Identifier: Apache-2.0
// PFH-001: exit 1 when an installed library (or the cloned Stellar-Preflight, read as text) can emit a code that
// LIBRARY_INVENTORY lacks. Reads files only; executes nothing from the libraries.
import { fileURLToPath } from "node:url";
import { checkInventory } from "../src/taxonomy/inventory-check.ts";
import { LIBRARY_INVENTORY } from "../src/taxonomy/library-maps.ts";

const root = fileURLToPath(new URL("..", import.meta.url));
let failed = false;
for (const r of checkInventory(LIBRARY_INVENTORY, root)) {
  if (r.skipped) {
    process.stdout.write(`${r.adapterId}: skipped (${r.skipped})\n`);
    continue;
  }
  const notes = r.notInInstalled.length ? `; in the inventory but not in this version: ${r.notInInstalled.join(", ")}` : "";
  if (r.missingFromInventory.length) {
    failed = true;
    process.stdout.write(`${r.adapterId}: FAIL, ${r.found!.length} codes found, not in the inventory: ${r.missingFromInventory.join(", ")}${notes}\n`);
  } else process.stdout.write(`${r.adapterId}: ok, ${r.found!.length} codes found, all inventoried${notes}\n`);
}
process.exitCode = failed ? 1 : 0;
