// SPDX-License-Identifier: Apache-2.0
// JSON Schema validation (2020-12, strict) for the fixture and verdict shapes in schemas/.
import { readFileSync } from "node:fs";
import { Ajv2020 } from "ajv/dist/2020.js";
import type { ValidateFunction } from "ajv/dist/2020.js";
import addFormatsImport from "ajv-formats";

// ajv-formats is CommonJS; under NodeNext the default import is the module namespace type.
const addFormats = addFormatsImport as unknown as (ajv: Ajv2020) => void;

export type SchemaName = "case" | "state-snapshot" | "ground-truth" | "provenance" | "receive-verdict";

const schemaDir = new URL("../../../../schemas/preflight-harness/", import.meta.url);
let ajv: Ajv2020 | undefined;
const compiled = new Map<SchemaName, ValidateFunction>();

export function validator(name: SchemaName): ValidateFunction {
  const hit = compiled.get(name);
  if (hit) return hit;
  if (!ajv) {
    ajv = new Ajv2020({ strict: true, allErrors: true });
    addFormats(ajv);
  }
  const fn = ajv.compile(JSON.parse(readFileSync(new URL(`${name}.schema.json`, schemaDir), "utf8")) as object);
  compiled.set(name, fn);
  return fn;
}

/** Returns a one-line summary of the schema errors, or null when valid. */
export function schemaErrors(name: SchemaName, value: unknown): string | null {
  const fn = validator(name);
  if (fn(value)) return null;
  return (fn.errors ?? []).map((e) => `${e.instancePath || "/"} ${e.message ?? e.keyword}`).join("; ");
}
