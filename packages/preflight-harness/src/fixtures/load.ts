// SPDX-License-Identifier: Apache-2.0
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { PfhError } from "../errors.ts";
import type { CaseFile, GroundTruth, Provenance, StateSnapshot } from "../types.ts";
import { schemaErrors } from "./validate.ts";
import type { SchemaName } from "./validate.ts";

/** A Stellar secret seed is S + 55 base32 chars. G-SECRETS: nothing that looks like one may enter a fixture. */
const SEED = /\bS[A-D][A-Z2-7]{54}\b/;

/** Real. Throws PFH_E_FIXTURE_SECRET when text contains a secret-seed-shaped string. */
export function assertNoSecrets(text: string, where: string): void {
  if (SEED.test(text)) throw new PfhError("PFH_E_FIXTURE_SECRET", `${where}: contains a string shaped like a Stellar secret seed`, { where });
}

export interface LoadedCase {
  dir: string;
  testCase: CaseFile;
  state?: StateSnapshot;
  stateProvenance?: Provenance;
  truth?: GroundTruth;
  truthProvenance?: Provenance;
}

function readJson(path: string, schema: SchemaName): unknown {
  const text = readFileSync(path, "utf8");
  assertNoSecrets(text, path);
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (e) {
    throw new PfhError("PFH_E_FIXTURE_INVALID", `${path}: invalid JSON (${(e as Error).message})`, { path });
  }
  const errors = schemaErrors(schema, value);
  if (errors) throw new PfhError("PFH_E_FIXTURE_INVALID", `${path}: does not match ${schema}.schema.json: ${errors}`, { path, errors });
  return value;
}

function withProvenance<T>(dir: string, name: "state" | "truth", schema: SchemaName): { value?: T; provenance?: Provenance } {
  const file = join(dir, `${name}.json`);
  if (!existsSync(file)) return {};
  const provFile = join(dir, `${name}.provenance.json`);
  if (!existsSync(provFile)) throw new PfhError("PFH_E_FIXTURE_PROVENANCE_MISSING", `${file}: no ${name}.provenance.json beside it`, { file });
  const value = readJson(file, schema) as T;
  const provenance = readJson(provFile, "provenance") as Provenance;
  if (provenance.fixture !== `${name}.json`) throw new PfhError("PFH_E_FIXTURE_INVALID", `${provFile}: fixture field is ${provenance.fixture}, expected ${name}.json`, { provFile });
  return { value, provenance };
}

/**
 * Load fixtures/cases/<id>/: case.json (required), state.json + state.provenance.json (when captured),
 * truth.json + truth.provenance.json (when captured). Validates against schemas/, runs assertNoSecrets on every
 * file, and requires a provenance file beside every state/truth file (PFH_E_FIXTURE_PROVENANCE_MISSING).
 */
export function loadCaseDir(dir: string): LoadedCase {
  const testCase = readJson(join(dir, "case.json"), "case") as CaseFile;
  if (testCase.caseId !== basename(dir)) throw new PfhError("PFH_E_FIXTURE_INVALID", `${dir}: caseId ${testCase.caseId} does not match the directory name`, { dir });
  const state = withProvenance<StateSnapshot>(dir, "state", "state-snapshot");
  const truth = withProvenance<GroundTruth>(dir, "truth", "ground-truth");
  if (testCase.captured && !state.value) throw new PfhError("PFH_E_FIXTURE_INVALID", `${dir}: captured is true but there is no state.json`, { dir });
  if (state.value && state.value.network !== testCase.input.network) throw new PfhError("PFH_E_FIXTURE_INVALID", `${dir}: state network ${state.value.network} differs from the case network`, { dir });
  const loaded: LoadedCase = { dir, testCase };
  if (state.value) loaded.state = state.value;
  if (state.provenance) loaded.stateProvenance = state.provenance;
  if (truth.value) loaded.truth = truth.value;
  if (truth.provenance) loaded.truthProvenance = truth.provenance;
  return loaded;
}

/** Load every case directory (one containing case.json) under a fixtures root, sorted by case id. */
export function loadAllCases(root: string): LoadedCase[] {
  if (!existsSync(root)) return [];
  return readdirSync(root)
    .filter((name) => statSync(join(root, name)).isDirectory() && existsSync(join(root, name, "case.json")))
    .sort()
    .map((name) => loadCaseDir(join(root, name)));
}
