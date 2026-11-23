// SPDX-License-Identifier: Apache-2.0
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { FAKE_ADDRESSES, parseCsv } from "../src/index.ts";
import { sandbox } from "./helpers.ts";

describe("CSV exports (DTC-016)", () => {
  for (const [table, path, key] of [
    ["wallets", "/v1/wallets", "wallets"],
    ["balances", "/v1/accounts/SBX-9002/balances", "digital"],
    ["activity", "/v1/accounts/SBX-9002/activity", "activity"],
    ["conversion orders", "/v1/conversion-orders", "orders"],
  ] as const) {
    it(`${table}: CSV parses back to the JSON rows`, async () => {
      const { call } = sandbox();
      await call("sim-1", "POST", "/v1/sim/reset", { fixture: "two-wallets-funded" });
      await call("sa-birch-1", "POST", "/v1/transfers", { fromWallet: "W-1", toAddress: FAKE_ADDRESSES.birchClient2, tokens: "4" });
      await call("sa-birch-1", "POST", "/v1/conversion-orders", { wallet: "W-1", cusip: "SBX000AA0", direction: "to-book-entry", tokens: "6" });
      const json = (await call("sa-birch-1", "GET", path)).body as Record<string, Record<string, unknown>[]>;
      const csv = await call("sa-birch-1", "GET", path, undefined, "text/csv");
      assert.match(csv.headers["content-type"] ?? "", /text\/csv/);
      const text = csv.body as string;
      assert.match(text.split("\n")[0] ?? "", /^# .*columns are dtc-kit's own/);
      const rows = parseCsv(text);
      const expected = (json[key] ?? []).map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v === undefined || v === null ? "" : String(v)])));
      assert.ok(expected.length > 0);
      assert.deepEqual(rows, expected);
    });
  }
});
