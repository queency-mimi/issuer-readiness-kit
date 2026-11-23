// SPDX-License-Identifier: Apache-2.0
import { weakestStatus } from "@sik/dtc-kit-profile-spec/pure";
import type { ResolvedProfile } from "@sik/dtc-kit-profile-spec/pure";
import type { TrustLabel } from "./types.ts";

/**
 * Build the label every row-dependent output carries (gate G-DTCC, SPEC 1.5): the weakest status of the
 * rows used, the rows (sorted, unique), the profile id/version and the profile disclaimers (unique, joined).
 */
export function trustLabel(profile: ResolvedProfile, rows: readonly string[]): TrustLabel {
  const unique = [...new Set(rows)].sort();
  return {
    status: weakestStatus(profile, unique),
    rows: unique,
    profile: profile.profileId,
    profileVersion: profile.version,
    disclaimer: [...new Set(profile.disclaimers)].join(" "),
  };
}

/** Render text for humans: non-published output is prefixed with its status and the rows it rests on. */
export function label(text: string, trust: TrustLabel): string {
  if (trust.status === "published") return text;
  return `[${trust.status}] ${text} (rows: ${trust.rows.join(", ")})`;
}

/** Read a row's machine value, or undefined when the row is absent or unknown. */
export function rowValue<T>(profile: ResolvedProfile, id: string): T | undefined {
  const row = profile.rows.get(id);
  if (!row || row.status === "unknown" || row.value === null) return undefined;
  return row.value as T;
}
