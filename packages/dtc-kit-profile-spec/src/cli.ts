// SPDX-License-Identifier: Apache-2.0
// Profile CLI (DTC-001). Usage:
//   node packages/dtc-kit-profile-spec/src/cli.ts check [--dir <profiles dir>] [--json]
//   node packages/dtc-kit-profile-spec/src/cli.ts table <profileId> [--json]
// Exit 0 ok, 1 schema problem, 2 usage error.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { PROFILES_DIR } from "./paths.ts";
import { loadBundledProfile, resolveProfile } from "./load.ts";
import type { RequirementsProfile, RowStatus } from "./types.ts";
import { checkProfile } from "./validate.ts";

const DISCLAIMER = "DTC-shaped, not DTC-certified.";

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

function counts(p: RequirementsProfile): Record<RowStatus, number> & { rows: number } {
  const c = { rows: p.rows.length, published: 0, inferred: 0, unknown: 0 };
  for (const r of p.rows) c[r.status] += 1;
  return c;
}

function check(args: string[]): number {
  const dir = flag(args, "--dir") ?? PROFILES_DIR;
  const json = args.includes("--json");
  const files = readdirSync(dir).filter((f) => f.endsWith(".json")).sort();
  let failed = false;
  const out: { file: string; profileId: string; version: string; rows: number; published: number; inferred: number; unknown: number }[] = [];
  for (const file of files) {
    const doc: unknown = JSON.parse(readFileSync(join(dir, file), "utf8"));
    const res = checkProfile(doc);
    if (!res.ok) {
      failed = true;
      console.error(`${file}: INVALID\n  ${res.problems.join("\n  ")}`);
      continue;
    }
    const p = doc as RequirementsProfile;
    out.push({ file, profileId: p.profileId, version: p.version, ...counts(p) });
  }
  if (json) {
    console.log(JSON.stringify({ disclaimer: DISCLAIMER, profiles: out }, null, 2));
  } else {
    for (const p of out) {
      console.log(`${p.profileId.padEnd(12)} ${p.rows} rows: ${p.published} published, ${p.inferred} inferred, ${p.unknown} unknown (version ${p.version})`);
    }
    console.log(DISCLAIMER);
  }
  return failed ? 1 : 0;
}

function table(args: string[]): number {
  const id = args[0];
  if (!id) {
    console.error("usage: table <profileId> [--json]");
    return 2;
  }
  const resolved = resolveProfile(loadBundledProfile(id));
  const rows = [...resolved.rows.values()];
  if (args.includes("--json")) {
    console.log(JSON.stringify({ profile: resolved.profileId, version: resolved.version, lineage: resolved.lineage, disclaimers: resolved.disclaimers, rows }, null, 2));
    return 0;
  }
  console.log(`${resolved.profileId} ${resolved.version} (lineage ${resolved.lineage.join(" -> ")})`);
  console.log("status     confidence sources id");
  for (const r of rows) {
    console.log(`${r.status.padEnd(10)} ${r.confidence.padEnd(10)} ${String(r.sources.length).padEnd(7)} ${r.id}`);
  }
  for (const d of resolved.disclaimers) console.log(d);
  return 0;
}

const [cmd, ...rest] = process.argv.slice(2);
const code = cmd === "check" ? check(rest) : cmd === "table" ? table(rest) : (console.error("usage: profiles check|table"), 2);
process.exit(code);
