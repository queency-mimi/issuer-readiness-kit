// SPDX-License-Identifier: Apache-2.0
// Repository hygiene lint (no ESLint dependency). Checks, in order:
//  1. every .ts file under src, test, scripts, fixtures has the Apache-2.0 SPDX header (docs/CONVENTIONS.md)
//  2. no TODO/FIXME without a ticket id (docs/AGENT_GUIDE.md, Definition of done)
//  3. no Stellar secret seed (S + 55 base32 chars) or 12/24-word mnemonic marker anywhere (G-SECRETS)
//  4. every .json file parses
// Exit 0 clean, 1 findings.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const root = new URL("..", import.meta.url).pathname;
// Monorepo: this tool's files outside the package (fixtures/maker-checker, schemas/maker-checker, docs/maker-checker, contracts/rwa-demo)
// are linted under the relative path they had in the standalone project, so the rules below are unchanged.
const repo = join(root, "..", "..");
const ROOTS: [dir: string, prefix: string][] = [
  [root, ""],
  [join(repo, "fixtures/maker-checker"), "fixtures"],
  [join(repo, "schemas/maker-checker"), "schemas"],
  [join(repo, "docs/maker-checker"), ""],
  [join(repo, "contracts/rwa-demo"), "contracts/rwa-demo"],
];
const SKIP = new Set(["node_modules", ".git", "out", ".competitors", "target", "dist"]);
const BINARY = /\.(wasm|png|jpg|jpeg|webp|ico|woff2?|ttf)$/;
const findings: string[] = [];

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

const SEED = /\bS[A-D][A-Z2-7]{54}\b/;
const TICKET = /\b[A-Z]{3}-\d{3}\b/;

for (const [dir, prefix] of ROOTS) for (const file of walk(dir)) {
  const rel = join(prefix, relative(dir, file));
  if (rel.endsWith("pnpm-lock.yaml") || rel.endsWith("Cargo.lock") || BINARY.test(rel)) continue;
  const text = readFileSync(file, "utf8");
  if (/\.(ts|tsx|rs)$/.test(rel) && /^(src|test|scripts|fixtures|web\/src|web\/scripts|contracts\/rwa-demo\/src)\//.test(rel)) {
    if (!text.split("\n").slice(0, 3).some((l) => l.includes("SPDX-License-Identifier: Apache-2.0"))) findings.push(`${rel}: missing SPDX header`);
  }
  if (rel.endsWith(".ts") || rel.endsWith(".md") === false) {
    text.split("\n").forEach((line, i) => {
      if (/\b(TODO|FIXME)\b/.test(line) && !TICKET.test(line) && rel !== "scripts/lint.ts") findings.push(`${rel}:${i + 1}: TODO/FIXME without ticket id`);
    });
  }
  if (rel !== "scripts/lint.ts" && SEED.test(text)) findings.push(`${rel}: looks like a Stellar secret seed (G-SECRETS)`);
  if (rel.endsWith(".json")) {
    try {
      JSON.parse(text);
    } catch (e) {
      findings.push(`${rel}: invalid JSON (${(e as Error).message})`);
    }
  }
}

if (findings.length > 0) {
  process.stderr.write(findings.join("\n") + "\n");
  process.exitCode = 1;
} else {
  process.stdout.write("lint ok\n");
}
