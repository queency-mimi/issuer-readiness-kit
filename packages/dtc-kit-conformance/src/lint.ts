// SPDX-License-Identifier: Apache-2.0
import { readFileSync } from "node:fs";
import { Ajv2020 } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { weakestStatus } from "@sik/dtc-kit-profile-spec";
import type { ResolvedProfile } from "@sik/dtc-kit-profile-spec";
import type { ScenarioPack } from "./pack.ts";
import { ADAPTER_TAGS, TRUST_TAGS, TRUST_TAG_FOR } from "./pack.ts";

export const PACK_SCHEMA_PATH = new URL("../schema/scenario-pack.schema.json", import.meta.url);

/** Schema validation of a pack (any language can do the same with the JSON Schema). */
export function schemaProblems(pack: unknown): string[] {
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats.default(ajv);
  const validate = ajv.compile(JSON.parse(readFileSync(PACK_SCHEMA_PATH, "utf8")));
  if (validate(pack)) return [];
  return (validate.errors ?? []).map((e) => `${e.instancePath || "/"} ${e.message ?? "invalid"}`);
}

/**
 * Catalogue lint: checks the schema cannot express. Every row must exist in the resolved profile, the
 * trust tag must equal the weakest required row (so a scenario can never claim more than its inputs),
 * ids must be unique. Returns problems; empty means clean.
 */
export function catalogueProblems(pack: ScenarioPack, profile: ResolvedProfile): string[] {
  const problems: string[] = [];
  const ids = new Set<string>();
  for (const s of pack.scenarios) {
    if (ids.has(s.id)) problems.push(`${s.id}: duplicate id`);
    ids.add(s.id);
    for (const row of s.requiresRows) {
      if (!profile.rows.has(row)) problems.push(`${s.id}: unknown profile row ${row}`);
    }
    const trustTags = s.tags.filter((t) => (TRUST_TAGS as readonly string[]).includes(t));
    if (s.requiresRows.length === 0) {
      if (trustTags.length > 0) problems.push(`${s.id}: trust tag without required rows`);
    } else {
      const expected = TRUST_TAG_FOR[weakestStatus(profile, s.requiresRows)];
      if (trustTags.length !== 1 || trustTags[0] !== expected) {
        problems.push(`${s.id}: trust tag must be exactly ${expected}, found [${trustTags.join(", ")}]`);
      }
    }
    if (s.onUnknown === "run-and-label" && !s.tags.includes("@unknown") && !s.requiresRows.some((r) => profile.rows.get(r)?.status === "unknown")) {
      problems.push(`${s.id}: run-and-label is only meaningful with an unknown required row`);
    }
    if (s.tags.includes("@testnet") && !s.tags.some((t) => (ADAPTER_TAGS as readonly string[]).includes(t)) && s.area !== "vendor") {
      problems.push(`${s.id}: @testnet needs an adapter tag`);
    }
  }
  return problems;
}
