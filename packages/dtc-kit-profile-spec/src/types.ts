// SPDX-License-Identifier: Apache-2.0

/** Row status. Gate G-DTCC: only `published` rows with a primary source may be treated as DTCC fact. */
export type RowStatus = "published" | "inferred" | "unknown";
export type Confidence = "high" | "medium" | "low" | "none";
/** P primary, S secondary, V vendor, I inference, E estimate, U unverified. */
export type SourceTag = "P" | "S" | "V" | "I" | "E" | "U";

export type RowArea =
  | "wallet"
  | "token"
  | "network"
  | "authorities"
  | "distribution_control"
  | "events"
  | "operations"
  | "corporate_actions"
  | "compliance"
  | "access"
  | "exports"
  | "identifiers";

export interface ProfileSource {
  url: string;
  title?: string;
  tag: SourceTag;
  /** ISO date (YYYY-MM-DD) the source was read for this row. */
  retrievedAt: string;
  via?: string;
  locator?: string;
}

export interface ProfileRow {
  id: string;
  area: RowArea;
  statement: string;
  /** Machine-readable value; `null` iff status is `unknown`. */
  value: unknown;
  status: RowStatus;
  confidence: Confidence;
  sources: ProfileSource[];
  basis?: string;
  candidates?: string[];
  noteRef?: string;
  unblockedBy?: string;
  tags?: string[];
}

export interface RequirementsProfile {
  $schema?: string;
  profileId: string;
  /** YYYY-MM-DD with optional `.N` revision. */
  version: string;
  title: string;
  description?: string;
  /** Must be echoed by every tool output. */
  disclaimer: string;
  extends?: string;
  createdAt: string;
  supersedes?: string;
  rows: ProfileRow[];
}

/** A profile after `extends` has been applied: parent rows inherited, child rows replacing by id. */
export interface ResolvedProfile {
  profileId: string;
  version: string;
  /** Chain of profile ids from root parent to this profile. */
  lineage: string[];
  disclaimers: string[];
  rows: ReadonlyMap<string, ProfileRow>;
}

/** Ordered weakest to strongest. */
export const STATUS_ORDER: readonly RowStatus[] = ["unknown", "inferred", "published"];
