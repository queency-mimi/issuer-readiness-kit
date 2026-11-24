// SPDX-License-Identifier: Apache-2.0
// Availability probing for `pfh adapters`. Imports only npm-installed packages (loaded by name) and checks the
// git-clone adapter by file existence: the harness never executes code from .competitors/ during a probe.
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { AdapterId } from "../taxonomy/library-maps.ts";
import type { AdapterInfo } from "./types.ts";

const root = new URL("../../", import.meta.url).pathname;
export const PREFLIGHT_ENTRY = root + ".competitors/Stellar-Preflight/packages/sdk/src/index.ts";

/** Resolve the package's ESM entry, then walk up to its own package.json (their `exports` hide ./package.json). */
function installedVersion(pkg: string): string | undefined {
  try {
    let dir = dirname(fileURLToPath(import.meta.resolve(pkg)));
    while (dir !== dirname(dir)) {
      const manifest = join(dir, "package.json");
      if (existsSync(manifest)) {
        const parsed = JSON.parse(readFileSync(manifest, "utf8")) as { name?: string; version?: string };
        if (parsed.name === pkg) return parsed.version;
      }
      dir = dirname(dir);
    }
  } catch {
    return undefined;
  }
  return undefined;
}

/** Commit checked out in the clone, read from .git/HEAD as text (detached HEAD at the pinned commit). */
function clonedCommit(): string {
  try {
    const head = readFileSync(root + ".competitors/Stellar-Preflight/.git/HEAD", "utf8").trim();
    return /^[0-9a-f]{40}$/.test(head) ? head : "";
  } catch {
    return "";
  }
}

export async function probe(id: AdapterId): Promise<AdapterInfo> {
  if (id === "stellar-preflight") {
    const cloned = existsSync(PREFLIGHT_ENTRY);
    const optIn = process.env["PFH_ALLOW_COMPETITOR_CODE"] === "1";
    const available = cloned && optIn;
    const commit = cloned ? clonedCommit() : "";
    return {
      id,
      version: available ? `git:${commit.slice(0, 12)}` : "",
      available,
      installHint: available
        ? ""
        : !cloned
          ? "Not fetched. Run scripts/fetch-competitors.sh yourself (clones salkimos/Stellar-Preflight at the pinned commit into .competitors/ and installs its SDK dependencies with --ignore-scripts), then set PFH_ALLOW_COMPETITOR_CODE=1."
          : `Clone present at ${commit.slice(0, 12) || "unknown commit"} but not executed: running downloaded third-party code needs your opt-in. Run scripts/fetch-competitors.sh yourself (installs its locked dependencies with --ignore-scripts), then set PFH_ALLOW_COMPETITOR_CODE=1.`,
    };
  }
  const pkg = id === "stellagate-core" ? "stellagate-core" : "stellar-check";
  const version = installedVersion(pkg);
  return { id, version: version ?? "", available: version !== undefined, installHint: version ? "" : `pnpm add -D ${pkg}@0.1.1` };
}
