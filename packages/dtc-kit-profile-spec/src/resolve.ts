// SPDX-License-Identifier: Apache-2.0
import type { ProfileRow, RequirementsProfile, ResolvedProfile } from "./types.ts";

/**
 * Apply `extends` (browser-safe: no file system). Parent rows are inherited, a child row with the same id
 * replaces the parent's. Cycles and missing parents throw. `lookup` resolves a profileId to its document.
 */
export function resolveWith(profile: RequirementsProfile, lookup: (profileId: string) => RequirementsProfile): ResolvedProfile {
  const lineage: RequirementsProfile[] = [];
  const seen = new Set<string>();
  let current: RequirementsProfile | undefined = profile;
  while (current) {
    if (seen.has(current.profileId)) {
      throw new Error(`profile extends cycle at ${current.profileId}`);
    }
    seen.add(current.profileId);
    lineage.unshift(current);
    current = current.extends ? lookup(current.extends) : undefined;
  }
  const rows = new Map<string, ProfileRow>();
  for (const p of lineage) {
    for (const row of p.rows) rows.set(row.id, row);
  }
  return {
    profileId: profile.profileId,
    version: profile.version,
    lineage: lineage.map((p) => p.profileId),
    disclaimers: lineage.map((p) => p.disclaimer),
    rows,
  };
}

/** Resolve against an in-memory set of documents (used by the browser console). */
export function resolveFromDocuments(profileId: string, documents: readonly RequirementsProfile[]): ResolvedProfile {
  const byId = new Map(documents.map((d) => [d.profileId, d]));
  const find = (id: string): RequirementsProfile => {
    const doc = byId.get(id);
    if (!doc) throw new Error(`profile ${id} not provided`);
    return doc;
  };
  return resolveWith(find(profileId), find);
}
