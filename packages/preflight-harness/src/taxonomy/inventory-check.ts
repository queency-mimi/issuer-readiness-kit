// SPDX-License-Identifier: Apache-2.0
// PFH-001: compare each recorded inventory with the codes the library at hand can actually emit. Everything is
// read as TEXT (installed dist files, the clone's TypeScript source); nothing is imported or executed.
// Fails (missingFromInventory non-empty) when the library can emit a code the inventory lacks: that code would
// be unmapped at run time. Inventory codes the installed version cannot emit are reported, not failed.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { AdapterId, LibraryInventory } from "./library-maps.ts";

export type ExtractMode = "object-keys" | `union:${string}` | "code-literals";

export function extractCodes(mode: ExtractMode, text: string): string[] {
  const found = new Set<string>();
  if (mode === "object-keys") {
    for (const m of text.matchAll(/^\s{2}([A-Z][A-Z0-9_]+):\s*\{/gm)) found.add(m[1]!);
  } else if (mode === "code-literals") {
    for (const m of text.matchAll(/\bcode:\s*"([a-z][a-z0-9_]*)"/g)) found.add(m[1]!);
  } else {
    const name = mode.slice("union:".length);
    const decl = new RegExp(`type\\s+${name}\\s*=([^;]+);`).exec(text);
    if (decl) for (const m of decl[1]!.matchAll(/'([A-Z0-9_]+)'|"([A-Z0-9_]+)"/g)) found.add((m[1] ?? m[2])!);
  }
  return [...found].sort();
}

export interface InventoryResult {
  adapterId: AdapterId;
  source: string;
  skipped?: string;
  found?: string[];
  missingFromInventory: string[];
  notInInstalled: string[];
}

function compare(adapterId: AdapterId, source: string, found: string[], inventory: readonly string[]): InventoryResult {
  const inv = new Set(inventory);
  const have = new Set(found);
  return {
    adapterId,
    source,
    found,
    missingFromInventory: found.filter((c) => !inv.has(c)).sort(),
    notInInstalled: [...inv].filter((c) => !have.has(c)).sort(),
  };
}

export function checkInventory(inventory: Record<AdapterId, LibraryInventory>, root: string): InventoryResult[] {
  const results: InventoryResult[] = [];

  const pfSrc = join(root, ".competitors/Stellar-Preflight/packages/sdk/src/codes.ts");
  if (existsSync(pfSrc)) results.push(compare("stellar-preflight", pfSrc, extractCodes("object-keys", readFileSync(pfSrc, "utf8")), inventory["stellar-preflight"].codes));
  else results.push({ adapterId: "stellar-preflight", source: pfSrc, skipped: "not fetched (.competitors/ absent; scripts/fetch-competitors.sh)", missingFromInventory: [], notInInstalled: [] });

  const gateDir = join(root, "node_modules/stellagate-core/dist");
  const gateText = readdirSync(gateDir).filter((f) => f.endsWith(".js")).map((f) => readFileSync(join(gateDir, f), "utf8")).join("\n");
  const gateCodes = extractCodes("code-literals", gateText);
  // check.ts builds `destination_${ParseError}` dynamically; ParseError is a union in address.d.ts.
  if (/code:\s*`destination_\$\{parsed\.error\}`/.test(gateText)) {
    const pe = /type\s+ParseError\s*=([^;]+);/.exec(readFileSync(join(gateDir, "address.d.ts"), "utf8"));
    for (const m of pe?.[1]!.matchAll(/"([a-z_]+)"/g) ?? []) gateCodes.push(`destination_${m[1]!}`);
  }
  results.push(compare("stellagate-core", gateDir, [...new Set(gateCodes)].sort(), inventory["stellagate-core"].codes));

  const checkTypes = join(root, "node_modules/stellar-check/dist/types.d.ts");
  results.push(compare("stellar-check", checkTypes, extractCodes("union:DiagnosticCode", readFileSync(checkTypes, "utf8")), inventory["stellar-check"].codes));
  return results;
}
