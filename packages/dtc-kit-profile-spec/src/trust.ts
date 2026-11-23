// SPDX-License-Identifier: Apache-2.0
import { STATUS_ORDER } from "./types.ts";
import type { ResolvedProfile, RowStatus } from "./types.ts";

/**
 * Weakest status among the given row ids. Used to label every output
 * (gate G-DTCC): an output is only as trustworthy as its weakest input row.
 * A row id absent from the profile counts as `unknown`.
 */
export function weakestStatus(profile: ResolvedProfile, rowIds: readonly string[]): RowStatus {
  let weakest = STATUS_ORDER.length - 1;
  if (rowIds.length === 0) return "unknown";
  for (const id of rowIds) {
    const status = profile.rows.get(id)?.status ?? "unknown";
    weakest = Math.min(weakest, STATUS_ORDER.indexOf(status));
  }
  return STATUS_ORDER[weakest] ?? "unknown";
}

/** `@published` | `@inferred` | `@unknown`, the scenario trust tag for a status. */
export function trustTag(status: RowStatus): `@${RowStatus}` {
  return `@${status}`;
}
