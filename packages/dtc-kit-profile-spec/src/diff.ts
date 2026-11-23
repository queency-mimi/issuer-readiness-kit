// SPDX-License-Identifier: Apache-2.0
import type { ProfileRow, RequirementsProfile } from "./types.ts";

export interface RowChange {
  id: string;
  kind: "added" | "removed" | "status-changed" | "value-changed" | "source-changed";
  before?: unknown;
  after?: unknown;
}

/** Key-order-independent JSON for comparing row values and sources. */
function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (v !== null && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(v) ?? "null";
}

/**
 * Diff two versions of a profile (own rows only, `extends` is not applied). Used by the watcher (DTC-031)
 * and the publication runbook (DTC-040) to report "unknown -> published" transitions when DTCC publishes
 * Stellar requirements. Order: rows of `before` in file order, then added rows in file order.
 */
export function diffProfiles(before: RequirementsProfile, after: RequirementsProfile): RowChange[] {
  const changes: RowChange[] = [];
  const afterById = new Map(after.rows.map((r) => [r.id, r]));
  const beforeIds = new Set(before.rows.map((r) => r.id));
  for (const b of before.rows) {
    const a: ProfileRow | undefined = afterById.get(b.id);
    if (!a) {
      changes.push({ id: b.id, kind: "removed", before: b.status });
      continue;
    }
    if (a.status !== b.status) changes.push({ id: b.id, kind: "status-changed", before: b.status, after: a.status });
    if (canonical(a.value) !== canonical(b.value)) changes.push({ id: b.id, kind: "value-changed", before: b.value, after: a.value });
    if (canonical(a.sources) !== canonical(b.sources)) {
      changes.push({ id: b.id, kind: "source-changed", before: b.sources.length, after: a.sources.length });
    }
  }
  for (const a of after.rows) {
    if (!beforeIds.has(a.id)) changes.push({ id: a.id, kind: "added", after: a.status });
  }
  return changes;
}
