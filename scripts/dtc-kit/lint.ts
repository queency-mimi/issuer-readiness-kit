// SPDX-License-Identifier: Apache-2.0
// Project lint (no ESLint is configured at scaffold; typecheck is the main gate). Checks:
//  1. SPDX Apache-2.0 header in every .ts file.
//  2. Every NotImplemented("DTC-NNN") and every `ticket: "DTC-NNN"` names a ticket that exists in TASKS.md.
//  3. No bare open-work marker (the words checked are built below) without a DTC ticket id.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

// Monorepo: checks only dtc-kit's own files (packages/dtc-kit-*, scripts/dtc-kit) against docs/dtc-kit/TASKS.md.
const root = join(import.meta.dirname, "..", "..");
const MARKER = new RegExp(`\\b(${["TO", "DO"].join("")}|${["FIX", "ME"].join("")})\\b`);
const problems: string[] = [];

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "out" || name.startsWith(".")) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith(".ts")) out.push(p);
  }
  return out;
}

const tasks = readFileSync(join(root, "docs", "dtc-kit", "TASKS.md"), "utf8");
const tickets = new Set([...tasks.matchAll(/\|\s*(DTC-\d{3})\s*\|/g)].map((m) => m[1]));
tickets.add("DTC-000");

const dtcPackages = readdirSync(join(root, "packages")).filter((n) => n.startsWith("dtc-kit-"));
const dirs = [...dtcPackages.map((n) => join(root, "packages", n)), join(root, "scripts", "dtc-kit")];
for (const file of dirs.flatMap((d) => walk(d))) {
  const rel = relative(root, file);
  const text = readFileSync(file, "utf8");
  if (!text.startsWith("// SPDX-License-Identifier: Apache-2.0")) problems.push(`${rel}: missing SPDX header`);
  for (const m of text.matchAll(/(?:NotImplemented\(\s*"|ticket:\s*"|@see\s+)(DTC-\d{3})/g)) {
    if (!tickets.has(m[1] as string)) problems.push(`${rel}: references ${m[1]} which is not in TASKS.md`);
  }
  text.split("\n").forEach((line, i) => {
    if (MARKER.test(line) && !/DTC-\d{3}/.test(line)) problems.push(`${rel}:${i + 1}: open-work marker without ticket id`);
  });
}

if (problems.length > 0) {
  console.error(problems.join("\n"));
  process.exit(1);
}
console.log(`lint ok (${tickets.size} tickets known)`);
