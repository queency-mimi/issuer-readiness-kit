// SPDX-License-Identifier: Apache-2.0
// PFH-020: read-only capture with a stubbed fetch. Asserts the method/URL allow-list and the snapshot shape.
import assert from "node:assert/strict";
import { test } from "node:test";
import { Address, nativeToScVal, xdr } from "@stellar/stellar-sdk";
import { captureSnapshot, guardedFetch } from "../src/fixtures/capture.ts";
import { PfhError } from "../src/errors.ts";
import { schemaErrors } from "../src/fixtures/validate.ts";

const G = "GASVYHCTBQCHUOQ5WA7FFQOVSXCXOCOJAADDM3JNMQORLC2LF3AU647P";
const ISSUER = "GASVYHCTBQCHUOQ5WBQ3JQO4PHQ7KLHMEPONISQK5WADDBERVRE3DTOQ";
const MISSING = "GASVYHCTBQCHUOQ5WCTVFHTFPHQ7KLHMEPONISQK5WAHOITOGVE3CLX5";
const SAC = "CA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJUWDA";
const HORIZON = "https://horizon.stub";
// stellar-sdk 17.4 XDR: union constructors are static functions; the TS types lag, so build entries untyped.
const X = xdr as any; // eslint-disable-line
const RPC = "https://rpc.stub";

const horizonAccount = {
  account_id: G, subentry_count: 1, num_sponsoring: 0, num_sponsored: 0, home_domain: "example.org",
  flags: { auth_required: false, auth_revocable: true, auth_immutable: false, auth_clawback_enabled: false },
  data: { "config.memo_required": "MQ==" },
  balances: [
    { asset_type: "credit_alphanum4", asset_code: "TEST", asset_issuer: ISSUER, balance: "95.0000000", limit: "100.0000000", buying_liabilities: "1.5000000", selling_liabilities: "0.0000000", is_authorized: true, is_authorized_to_maintain_liabilities: false, is_clawback_enabled: false },
    { asset_type: "native", balance: "9999.9999900", buying_liabilities: "0.0000000", selling_liabilities: "0.0000000" },
  ],
};

function stub(calls: { method: string; url: string; rpc?: string }[]): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const method = (init?.method ?? "GET").toUpperCase();
    const body = init?.body ? (JSON.parse(String(init.body)) as { method: string; params: { keys?: string[] } }) : undefined;
    calls.push({ method, url, ...(body ? { rpc: body.method } : {}) });
    const json = (status: number, b: unknown) => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json" } });
    if (url === `${HORIZON}/accounts/${G}`) return json(200, horizonAccount);
    if (url === `${HORIZON}/accounts/${MISSING}`) return json(404, { status: 404 });
    if (url === `${HORIZON}/ledgers?order=desc&limit=1`) return json(200, { _embedded: { records: [{ sequence: 500, base_reserve_in_stroops: 5000000, base_fee_in_stroops: 100 }] } });
    if (url === `${HORIZON}/`) return json(200, { horizon_version: "26.0.0", core_supported_protocol_version: 25 });
    if (body?.method === "getLatestLedger") return json(200, { jsonrpc: "2.0", id: 1, result: { sequence: 501, protocolVersion: 25 } });
    if (body?.method === "getVersionInfo") return json(200, { jsonrpc: "2.0", id: 1, result: { version: "25.0.0" } });
    if (body?.method === "getLedgerEntries") {
      const entries = (body.params.keys ?? []).flatMap((k) => {
        const key = X.LedgerKey.fromXDR(k, "base64");
        if (key.type !== "contractData") return [];
        const cd = key.contractData;
        const contract = Address.fromScAddress(cd.contract).toString();
        void Address;
        if (contract !== SAC) return [];
        if (cd.key.type === "scvLedgerKeyContractInstance") {
          const inst = new X.ScContractInstance({ executable: X.ContractExecutable.contractExecutableStellarAsset(), storage: null });
          const data = X.LedgerEntryData.contractData(new X.ContractDataEntry({ ext: X.ExtensionPoint.v0(), contract: cd.contract, key: cd.key, durability: cd.durability, val: X.ScVal.scvContractInstance(inst) }));
          return [{ key: k, xdr: data.toXDR("base64"), lastModifiedLedgerSeq: 400 }];
        }
        const val = nativeToScVal({ amount: 70000000n, authorized: true, clawback: false }, { type: { amount: ["symbol", "i128"], authorized: ["symbol", "bool"], clawback: ["symbol", "bool"] } });
        const data = X.LedgerEntryData.contractData(new X.ContractDataEntry({ ext: X.ExtensionPoint.v0(), contract: cd.contract, key: cd.key, durability: cd.durability, val }));
        return [{ key: k, xdr: data.toXDR("base64"), lastModifiedLedgerSeq: 400 }];
      });
      return json(200, { jsonrpc: "2.0", id: 1, result: { entries, latestLedger: 501 } });
    }
    if (body?.method === "simulateTransaction") {
      const call = calls.filter((c) => c.rpc === "simulateTransaction").length;
      if (call === 1) return json(200, { jsonrpc: "2.0", id: 1, result: { latestLedger: 501, results: [{ xdr: nativeToScVal(`TEST:${ISSUER}`).toXDR("base64"), auth: [] }] } });
      return json(200, { jsonrpc: "2.0", id: 1, result: { latestLedger: 501, error: 'HostError: Error(Contract, #13)\n\nEvent log (newest first):\n   0: [Diagnostic Event] data:["trustline entry is missing for account"]' } });
    }
    return json(500, {});
  }) as typeof fetch;
}

test("capture: accounts, contracts, SAC balances, reads and simulations from Horizon GET + RPC", async () => {
  const calls: { method: string; url: string; rpc?: string }[] = [];
  const { snapshot, provenance } = await captureSnapshot({
    network: "testnet", horizonUrl: HORIZON, rpcUrl: RPC, fetchImpl: stub(calls), delayMs: 0, capturedAt: "2026-11-08T00:00:00Z",
    accounts: [G, MISSING], contracts: [SAC], sacHolders: [{ sac: SAC, holder: G }],
    reads: [{ contractId: SAC, fn: "name", args: [] }],
    simulate: [{ contractId: SAC, fn: "transfer", args: [ISSUER, G, 100000000n], source: ISSUER }],
  });
  assert.equal(schemaErrors("state-snapshot", snapshot), null);
  assert.equal(schemaErrors("provenance", provenance), null);
  assert.equal(snapshot.ledger, 501);
  assert.deepEqual(snapshot.networkParams, { baseReserveStroops: "5000000", baseFeeStroops: "100" });
  const a = snapshot.accounts[G]!;
  assert.equal(a.balance, "99999999900");
  assert.deepEqual(a.trustlines[0], { asset: { code: "TEST", issuer: ISSUER }, balance: "950000000", limit: "1000000000", buyingLiabilities: "15000000", sellingLiabilities: "0", authorized: true, authorizedToMaintainLiabilities: false, clawbackEnabled: false });
  assert.equal(a.flags.authRevocable, true);
  assert.equal(a.homeDomain, "example.org");
  assert.equal(snapshot.accounts[MISSING], null);
  assert.deepEqual(snapshot.contracts[SAC], { exists: true, kind: "sac", wraps: { kind: "classic", code: "TEST", issuer: ISSUER }, reads: { "name()": `TEST:${ISSUER}` } });
  assert.deepEqual(snapshot.sacBalances[`${SAC}:${G}`], { amount: "70000000", authorized: true });
  assert.equal(snapshot.simulations[0]!.call, `${SAC}.transfer(${ISSUER}, ${G}, 100000000)`);
  assert.deepEqual([snapshot.simulations[0]!.result.ok, (snapshot.simulations[0]!.result as { contractErrorCode?: number }).contractErrorCode], [false, 13]);
  assert.equal(provenance.source.kind, "captured");
  assert.equal(provenance.containsSecrets, false);
  // Allow-list held: Horizon only GET, RPC only read methods.
  for (const c of calls) {
    if (c.url.startsWith(HORIZON)) assert.equal(c.method, "GET");
    else assert.ok(["getLatestLedger", "getLedgerEntries", "simulateTransaction", "getVersionInfo"].includes(c.rpc ?? ""), String(c.rpc));
  }
});

test("capture guard: refuses a Horizon POST and any RPC write method", async () => {
  const f = guardedFetch(stub([]), { horizonUrl: HORIZON, rpcUrl: RPC });
  const code = async (p: Promise<unknown>) => p.then(() => "ok", (e: unknown) => (e instanceof PfhError ? e.code : String(e)));
  assert.equal(await code(f(`${HORIZON}/transactions`, { method: "POST", body: "tx=AAAA" })), "PFH_E_CAPTURE_NETWORK");
  assert.equal(await code(f(RPC, { method: "POST", body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "sendTransaction", params: {} }) })), "PFH_E_CAPTURE_NETWORK");
  assert.equal(await code(f("https://elsewhere.example/", { method: "GET" })), "PFH_E_CAPTURE_NETWORK");
  assert.equal(await code(f(`${HORIZON}/accounts/${G}`)), "ok");
});
