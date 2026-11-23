// SPDX-License-Identifier: Apache-2.0
// DTC-032: map a real HoldersSnapshot (holders-at-ledger golden fixture, recorded mainnet capture) without loss.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { HAL_SCHEMA_DEFAULT_PATH, SnapshotRejected, positionsFromHoldersSnapshot } from "../src/holders-source.ts";

const GOLDEN = new URL("../../../fixtures/holders-at-ledger/golden/robovac-65290900.json", import.meta.url);
const available = existsSync(GOLDEN) && existsSync(HAL_SCHEMA_DEFAULT_PATH);

describe("positionsFromHoldersSnapshot (DTC-032)", { skip: available ? false : "holders-at-ledger golden fixture missing from fixtures/holders-at-ledger" }, () => {
  const doc = () => JSON.parse(readFileSync(GOLDEN, "utf8")) as Record<string, unknown>;
  const asset = "robovac:GAFB7IYPCYZCODQBB5BR5JO45JC4PPVLARUAXQSFHWTLH2KMHPWJ36GD";

  it("maps the golden snapshot with no lossy conversion (base units, ledger, hashes)", () => {
    const r = positionsFromHoldersSnapshot(doc(), { ledger: "stellar-pubnet", asset });
    assert.deepEqual(r.positions, [{ address: "GAGIYA2P7NF5B5T6MRCGARCMGORDVKHM3OW52BCYVFDYEJFBMIF2UEDA", tokens: 1000080000000n }]);
    assert.equal(r.ledgerSeq, 65290900);
    assert.equal(r.closedAt, "2026-11-03T21:15:39Z");
    assert.equal(r.decimals, 7);
    assert.equal(r.supplyHash, "sha256:619a9a0138c1c1a69f5067e083cbb35ddbf96ad678d2af205b0e3fd5a6a24bec");
    assert.equal(r.reconciliation, "exact");
    assert.equal(r.holdersSum, 1000080000000n);
    assert.deepEqual(r.excluded, []);
  });

  it("rejects a malformed snapshot with the schema's error", () => {
    const d = doc();
    delete d["holdersHash"];
    assert.throws(() => positionsFromHoldersSnapshot(d, { ledger: "stellar-pubnet", asset }), (e: unknown) => e instanceof SnapshotRejected && e.code === "SCHEMA" && /holdersHash/.test(e.message));
  });

  it("rejects a snapshot of a different asset", () => {
    assert.throws(() => positionsFromHoldersSnapshot(doc(), { ledger: "stellar-pubnet", asset: "OTHER:GAFB7IYPCYZCODQBB5BR5JO45JC4PPVLARUAXQSFHWTLH2KMHPWJ36GD" }), (e: unknown) => e instanceof SnapshotRejected && e.code === "ASSET_MISMATCH");
  });
});
