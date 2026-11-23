// SPDX-License-Identifier: Apache-2.0
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  PROFILES_DIR,
  checkProfile,
  loadBundledProfile,
  resolveProfile,
  validateProfile,
  weakestStatus,
} from "../src/index.ts";

const rawGeneric = (): Record<string, unknown> =>
  JSON.parse(readFileSync(join(PROFILES_DIR, "dtc-generic.json"), "utf8"));

describe("profile files validate against requirements-profile.schema.json", () => {
  it("dtc-generic validates", () => {
    const p = validateProfile(rawGeneric());
    assert.equal(p.profileId, "dtc-generic");
    assert.ok(p.rows.length >= 20);
  });

  it("dtc-stellar validates and extends dtc-generic", () => {
    const p = loadBundledProfile("dtc-stellar");
    assert.equal(p.extends, "dtc-generic");
  });

  it("dtc-generic has no unknown rows and every published row has a primary source", () => {
    const p = loadBundledProfile("dtc-generic");
    for (const row of p.rows) {
      assert.notEqual(row.status, "unknown", row.id);
      if (row.status === "published") {
        assert.ok(row.sources.some((s) => s.tag === "P"), `${row.id} lacks a primary source`);
      }
    }
  });

  it("dtc-stellar has no published rows (gate G-DTCC)", () => {
    const p = loadBundledProfile("dtc-stellar");
    for (const row of p.rows) {
      assert.notEqual(row.status, "published", `${row.id} must not be published`);
    }
  });

  it("the required generic facts are present, two of them deliberately inferred", () => {
    const resolved = resolveProfile(loadBundledProfile("dtc-stellar"));
    for (const id of [
      "wallet.only-participants-register",
      "wallet.registration-ofac-screening",
      "authorities.dtc-override-root-wallet",
      "operations.free-of-value",
      "corporate_actions.unsupported-event-convert-before-record-date",
      "corporate_actions.cash-credit-consolidated-classic",
      "corporate_actions.position-capture-8pm-et",
      "token.whole-tokens-only",
      "token.transfer-only-to-registered-wallets",
    ]) {
      assert.ok(resolved.rows.has(id), `missing ${id}`);
    }
    assert.equal(resolved.rows.get("corporate_actions.position-capture-8pm-et")?.status, "inferred");
    assert.equal(resolved.rows.get("token.whole-tokens-only")?.status, "inferred");
  });

  it("resolving dtc-stellar inherits generic rows and keeps lineage", () => {
    const resolved = resolveProfile(loadBundledProfile("dtc-stellar"));
    assert.deepEqual(resolved.lineage, ["dtc-generic", "dtc-stellar"]);
    assert.ok(resolved.rows.has("token.interface"));
    assert.ok(resolved.rows.has("wallet.account-model"));
    assert.equal(weakestStatus(resolved, ["wallet.account-model"]), "published");
    assert.equal(weakestStatus(resolved, ["wallet.account-model", "token.interface"]), "inferred");
    assert.equal(weakestStatus(resolved, ["wallet.contract-address-registrable"]), "unknown");
    assert.equal(weakestStatus(resolved, ["no.such-row"]), "unknown");
  });
});

describe("schema rejects rows that break the status rules", () => {
  const withRow = (mutate: (row: Record<string, unknown>) => void): unknown => {
    const p = rawGeneric();
    const rows = p["rows"] as Record<string, unknown>[];
    const row = rows.find((r) => r["status"] === "published");
    assert.ok(row);
    mutate(row);
    return p;
  };

  it("published row without a source", () => {
    assert.equal(checkProfile(withRow((r) => { r["sources"] = []; })).ok, false);
  });

  it("published row whose only source is not primary", () => {
    assert.equal(
      checkProfile(withRow((r) => {
        r["sources"] = [{ url: "https://example.com/x", tag: "S", retrievedAt: "2026-10-31" }];
      })).ok,
      false,
    );
  });

  it("published row with low confidence", () => {
    assert.equal(checkProfile(withRow((r) => { r["confidence"] = "low"; })).ok, false);
  });

  it("source that is not https", () => {
    assert.equal(
      checkProfile(withRow((r) => {
        r["sources"] = [{ url: "http://example.com/x", tag: "P", retrievedAt: "2026-10-31" }];
      })).ok,
      false,
    );
  });

  it("unknown row with a value", () => {
    const stellar = JSON.parse(readFileSync(join(PROFILES_DIR, "dtc-stellar.json"), "utf8"));
    const row = stellar.rows.find((r: { status: string }) => r.status === "unknown");
    row.value = { guess: true };
    assert.equal(checkProfile(stellar).ok, false);
  });

  it("inferred row without a basis", () => {
    const stellar = JSON.parse(readFileSync(join(PROFILES_DIR, "dtc-stellar.json"), "utf8"));
    const row = stellar.rows.find((r: { status: string }) => r.status === "inferred");
    delete row.basis;
    assert.equal(checkProfile(stellar).ok, false);
  });

  it("duplicate row ids", () => {
    const p = rawGeneric();
    const rows = p["rows"] as unknown[];
    rows.push(rows[0]);
    assert.equal(checkProfile(p).ok, false);
  });

  it("unknown top-level property", () => {
    const p = rawGeneric();
    p["surprise"] = 1;
    assert.equal(checkProfile(p).ok, false);
  });
});
