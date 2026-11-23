// SPDX-License-Identifier: Apache-2.0
// Fixture writer. Fixtures are captured by script, never by hand (docs/CONVENTIONS.md): the script, source,
// ledgers and capture time are stored beside the fixture as <name>.provenance.json with the file's SHA-256.
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";

export interface FixtureProvenance {
  /** Path of the fixture relative to fixtures/. */
  fixture: string;
  /** Script that produced it, relative to repo root. */
  script: string;
  /** One of: public web page, Horizon/RPC GET, testnet transaction. Never a login-gated source. */
  sourceKind: "web-page" | "rpc-read" | "testnet-tx";
  sourceUrl: string;
  /** ISO instant of capture. */
  capturedAt: string;
  /** Ledger sequence(s) for chain fixtures. */
  ledgers?: number[];
  network?: "testnet" | "local";
  /** SHA-256 of the fixture file. */
  sha256: string;
  notes?: string;
}

export const REPO_ROOT = join(import.meta.dirname, "..", "..");
export const FIXTURES_DIR = join(REPO_ROOT, "fixtures", "dtc-kit");

/** Write `data` as pretty JSON under fixtures/ and its provenance beside it. Returns the provenance. */
export function writeFixture(relPath: string, data: unknown, prov: Omit<FixtureProvenance, "fixture" | "sha256">): FixtureProvenance {
  const file = join(FIXTURES_DIR, relPath);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
  const sha256 = createHash("sha256").update(readFileSync(file)).digest("hex");
  const provenance: FixtureProvenance = { fixture: relative(FIXTURES_DIR, file), sha256, ...prov };
  writeFileSync(file.replace(/\.json$/, ".provenance.json"), `${JSON.stringify(provenance, null, 2)}\n`);
  return provenance;
}

/** Verify a fixture against its provenance (hash match). */
export function verifyFixture(relPath: string): { ok: boolean; provenance: FixtureProvenance } {
  const file = join(FIXTURES_DIR, relPath);
  const provenance = JSON.parse(readFileSync(file.replace(/\.json$/, ".provenance.json"), "utf8")) as FixtureProvenance;
  const sha = createHash("sha256").update(readFileSync(file)).digest("hex");
  return { ok: sha === provenance.sha256, provenance };
}
