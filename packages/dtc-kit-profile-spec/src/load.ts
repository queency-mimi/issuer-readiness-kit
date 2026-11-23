// SPDX-License-Identifier: Apache-2.0
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PROFILES_DIR } from "./paths.ts";
import type { RequirementsProfile, ResolvedProfile } from "./types.ts";
import { validateProfile } from "./validate.ts";
import { resolveWith } from "./resolve.ts";

/** Read and validate a profile file. Throws `ProfileValidationError` listing every schema violation. */
export function loadProfileFile(path: string): RequirementsProfile {
  const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
  return validateProfile(parsed);
}

/** Load a bundled profile by id, e.g. `dtc-generic`. */
export function loadBundledProfile(profileId: string): RequirementsProfile {
  return loadProfileFile(join(PROFILES_DIR, `${profileId}.json`));
}

/**
 * Apply `extends`: parent rows are inherited, a child row with the same id replaces the parent's.
 * Cycles and missing parents throw. `lookup` resolves a profileId to its file content.
 */
export function resolveProfile(
  profile: RequirementsProfile,
  lookup: (profileId: string) => RequirementsProfile = loadBundledProfile,
): ResolvedProfile {
  return resolveWith(profile, lookup);
}
