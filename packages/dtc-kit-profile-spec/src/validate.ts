// SPDX-License-Identifier: Apache-2.0
import { readFileSync } from "node:fs";
import { Ajv2020 } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import type { ErrorObject } from "ajv";
import type { RequirementsProfile } from "./types.ts";
import { SCHEMA_PATH } from "./paths.ts";

export class ProfileValidationError extends Error {
  readonly problems: string[];

  constructor(problems: string[]) {
    super(`profile failed schema validation:\n${problems.join("\n")}`);
    this.name = "ProfileValidationError";
    this.problems = problems;
  }
}

function describe(e: ErrorObject): string {
  return `${e.instancePath || "/"} ${e.message ?? "invalid"}${e.params ? ` ${JSON.stringify(e.params)}` : ""}`;
}

let cached: ReturnType<Ajv2020["compile"]> | undefined;

function compiled() {
  if (!cached) {
    const ajv = new Ajv2020({ allErrors: true, strict: true });
    addFormats.default(ajv);
    cached = ajv.compile(JSON.parse(readFileSync(SCHEMA_PATH, "utf8")));
  }
  return cached;
}

/** Validate against the 2020-12 schema, then run the cross-row checks the schema cannot express. */
export function validateProfile(input: unknown): RequirementsProfile {
  const validate = compiled();
  if (!validate(input)) {
    throw new ProfileValidationError((validate.errors ?? []).map(describe));
  }
  const profile = input as RequirementsProfile;
  const problems: string[] = [];
  const ids = new Set<string>();
  for (const row of profile.rows) {
    if (ids.has(row.id)) problems.push(`duplicate row id ${row.id}`);
    ids.add(row.id);
    if (!row.id.startsWith(`${row.area}.`)) {
      problems.push(`row ${row.id}: id must start with its area '${row.area}.'`);
    }
  }
  if (problems.length > 0) throw new ProfileValidationError(problems);
  return profile;
}

/** Non-throwing variant for CLIs and tests. */
export function checkProfile(input: unknown): { ok: true } | { ok: false; problems: string[] } {
  try {
    validateProfile(input);
    return { ok: true };
  } catch (e) {
    if (e instanceof ProfileValidationError) return { ok: false, problems: e.problems };
    throw e;
  }
}
