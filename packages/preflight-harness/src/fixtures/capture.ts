// SPDX-License-Identifier: Apache-2.0
// Read-only capture of a StateSnapshot (SPEC 2.3, PFH-020). Horizon GET only; Soroban RPC JSON-RPC limited to
// read methods (getLatestLedger, getLedgerEntries, simulateTransaction with an UNSIGNED envelope, getHealth,
// getVersionInfo, getNetwork). Every request passes guardedFetch, which refuses anything else with
// PFH_E_CAPTURE_NETWORK. Never signs, never submits, never calls an approval server.
import { Account, Address, nativeToScVal, Operation, scValToNative, StrKey, TransactionBuilder, xdr } from "@stellar/stellar-sdk";
import { PfhError } from "../errors.ts";
import { PASSPHRASE } from "../types.ts";
import type { AccountState, ContractState, NetworkName, Provenance, RecordedSimulation, StateSnapshot, TrustlineState } from "../types.ts";
import { canonicalCall, decimalToStroops, readKey } from "../adapters/canonical.ts";
import type { CallArg } from "../adapters/canonical.ts";

const READ_RPC = new Set(["getLatestLedger", "getLedgerEntries", "simulateTransaction", "getHealth", "getVersionInfo", "getNetwork"]);
// stellar-sdk 17.4 XDR objects: discriminated plain classes whose TS types lag the runtime; read them untyped.
const X = xdr as any; // eslint-disable-line

/** Wrap a fetch so only Horizon GETs and read-only RPC methods can leave the process. */
export function guardedFetch(inner: typeof fetch, endpoints: { horizonUrl: string; rpcUrl: string }): typeof fetch {
  const horizon = endpoints.horizonUrl.replace(/\/+$/, "");
  const rpc = endpoints.rpcUrl.replace(/\/+$/, "");
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    const method = (init?.method ?? "GET").toUpperCase();
    if (url.startsWith(horizon + "/") || url === horizon) {
      if (method !== "GET") throw new PfhError("PFH_E_CAPTURE_NETWORK", `refused: ${method} ${url} (capture is GET-only on Horizon)`, { url, method });
      return inner(url, { ...init, method: "GET" });
    }
    if (url === rpc || url.startsWith(rpc + "/")) {
      if (method !== "POST") throw new PfhError("PFH_E_CAPTURE_NETWORK", `refused: ${method} ${url} (RPC is JSON-RPC POST)`, { url, method });
      let rpcMethod = "";
      try {
        rpcMethod = String((JSON.parse(String(init?.body ?? "")) as { method?: unknown }).method ?? "");
      } catch {
        rpcMethod = "";
      }
      if (!READ_RPC.has(rpcMethod)) throw new PfhError("PFH_E_CAPTURE_NETWORK", `refused: RPC method ${rpcMethod || "(unparsable)"} is not a read method`, { url, rpcMethod });
      return inner(url, init);
    }
    throw new PfhError("PFH_E_CAPTURE_NETWORK", `refused: ${url} is neither the configured Horizon nor RPC endpoint`, { url });
  }) as typeof fetch;
}

export interface CaptureRequest {
  network: NetworkName;
  rpcUrl: string;
  horizonUrl: string;
  accounts: string[];
  contracts: string[];
  sacHolders: { sac: string; holder: string }[];
  /** Read-only contract calls (name, decimals, ...) stored under contracts[id].reads. */
  reads?: { contractId: string; fn: string; args: CallArg[] }[];
  /** Simulations stored under simulations[] (unsigned envelope, source = `source`). */
  simulate: { contractId: string; fn: string; args: CallArg[]; source: string }[];
  fetchImpl?: typeof fetch;
  /** Pause between requests (rate limit). Default 150 ms on testnet, 600 ms on mainnet (<= 2 req/s). */
  delayMs?: number;
  /** Injected clock (determinism in tests). */
  capturedAt?: string;
  script?: string;
  notes?: string;
}

export interface CaptureResult {
  snapshot: StateSnapshot;
  provenance: Provenance;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function toScVal(a: CallArg): xdr.ScVal {
  if (typeof a === "bigint") return nativeToScVal(a, { type: "i128" });
  if (typeof a === "string" && (StrKey.isValidEd25519PublicKey(a) || StrKey.isValidContract(a) || StrKey.isValidMed25519PublicKey(a))) return nativeToScVal(a, { type: "address" });
  if (typeof a === "number") return nativeToScVal(a, { type: "u32" });
  return nativeToScVal(a);
}

function parseAccount(body: Record<string, any>): AccountState { // eslint-disable-line
  const trustlines: TrustlineState[] = [];
  let native = "0";
  for (const b of body["balances"] as Record<string, any>[]) { // eslint-disable-line
    const stroops = (v: unknown) => String(decimalToStroops(String(v ?? "0")) ?? 0n);
    if (b["asset_type"] === "native") native = stroops(b["balance"]);
    else if (b["asset_type"] === "credit_alphanum4" || b["asset_type"] === "credit_alphanum12") {
      trustlines.push({
        asset: { code: String(b["asset_code"]), issuer: String(b["asset_issuer"]) },
        balance: stroops(b["balance"]),
        limit: stroops(b["limit"]),
        buyingLiabilities: stroops(b["buying_liabilities"]),
        sellingLiabilities: stroops(b["selling_liabilities"]),
        authorized: b["is_authorized"] === true,
        authorizedToMaintainLiabilities: b["is_authorized_to_maintain_liabilities"] === true,
        clawbackEnabled: b["is_clawback_enabled"] === true,
      });
    }
  }
  const f = (body["flags"] ?? {}) as Record<string, boolean>;
  const state: AccountState = {
    balance: native,
    subentryCount: Number(body["subentry_count"] ?? 0),
    numSponsoring: Number(body["num_sponsoring"] ?? 0),
    numSponsored: Number(body["num_sponsored"] ?? 0),
    flags: { authRequired: f["auth_required"] === true, authRevocable: f["auth_revocable"] === true, authImmutable: f["auth_immutable"] === true, clawbackEnabled: f["auth_clawback_enabled"] === true },
    data: { ...((body["data"] ?? {}) as Record<string, string>) },
    trustlines: trustlines.sort((a, b) => `${a.asset.code}:${a.asset.issuer}`.localeCompare(`${b.asset.code}:${b.asset.issuer}`)),
  };
  if (typeof body["home_domain"] === "string" && body["home_domain"]) state.homeDomain = body["home_domain"];
  return state;
}

function contractDataKey(contractId: string, key: xdr.ScVal): string {
  const k = X.LedgerKey.contractData(new X.LedgerKeyContractData({ contract: new Address(contractId).toScAddress(), key, durability: X.ContractDataDurability.persistent }));
  return k.toXDR("base64") as string;
}

/** Wraps value of a SAC from its name(): "native" or "CODE:ISSUER". */
function wrapsFromName(name: unknown): ContractState["wraps"] | undefined {
  if (name === "native") return { kind: "native" };
  if (typeof name !== "string") return undefined;
  const [code, issuer, extra] = name.split(":");
  return code && issuer && extra === undefined && StrKey.isValidEd25519PublicKey(issuer) ? { kind: "classic", code, issuer } : undefined;
}

export async function captureSnapshot(req: CaptureRequest): Promise<CaptureResult> {
  const fetchImpl = guardedFetch(req.fetchImpl ?? globalThis.fetch, req);
  const delay = req.delayMs ?? (req.network === "mainnet" ? 600 : 150);
  const horizon = req.horizonUrl.replace(/\/+$/, "");
  const urls = new Set<string>();
  let rpcId = 0;

  const get = async (path: string): Promise<{ status: number; body: unknown }> => {
    await sleep(delay);
    const url = `${horizon}${path}`;
    urls.add(url.replace(/\/accounts\/[A-Z2-7]{56}$/, "/accounts/{id}"));
    const res = await fetchImpl(url);
    if (res.status === 404) return { status: 404, body: null };
    if (!res.ok) throw new PfhError("PFH_E_CAPTURE_NETWORK", `GET ${url} -> HTTP ${res.status}`, { url });
    return { status: res.status, body: await res.json() };
  };
  const call = async (method: string, params?: unknown): Promise<any> => { // eslint-disable-line
    await sleep(delay);
    urls.add(`${req.rpcUrl} ${method}`);
    const res = await fetchImpl(req.rpcUrl, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method, ...(params === undefined ? {} : { params }) }) });
    if (!res.ok) throw new PfhError("PFH_E_CAPTURE_NETWORK", `RPC ${method} -> HTTP ${res.status}`, { method });
    const body = (await res.json()) as { result?: unknown; error?: { message?: string } };
    if (body.error) throw new PfhError("PFH_E_CAPTURE_NETWORK", `RPC ${method} error: ${body.error.message ?? JSON.stringify(body.error)}`, { method });
    return body.result;
  };
  const entries = async (keys: string[]): Promise<Map<string, any>> => { // eslint-disable-line
    const out = new Map<string, unknown>();
    for (let i = 0; i < keys.length; i += 100) {
      const r = (await call("getLedgerEntries", { keys: keys.slice(i, i + 100) })) as { entries?: { key: string; xdr: string }[] };
      for (const e of r.entries ?? []) out.set(e.key, X.LedgerEntryData.fromXDR(e.xdr, "base64"));
    }
    return out;
  };

  const version = (await call("getVersionInfo").catch(() => null)) as { version?: string } | null;
  const root = (await get("/")).body as { horizon_version?: string; core_supported_protocol_version?: number } | null;

  // Horizon reads
  const accounts: Record<string, AccountState | null> = {};
  for (const id of [...new Set(req.accounts)].sort()) {
    const r = await get(`/accounts/${id}`);
    accounts[id] = r.status === 404 ? null : parseAccount(r.body as Record<string, unknown>);
  }
  const ledgerRec = ((await get("/ledgers?order=desc&limit=1")).body as { _embedded?: { records?: { base_reserve_in_stroops?: number; base_fee_in_stroops?: number }[] } })?._embedded?.records?.[0];

  // RPC reads
  const contracts: Record<string, ContractState> = {};
  const instanceKeys = [...new Set(req.contracts)].sort().map((c) => [c, contractDataKey(c, X.ScVal.scvLedgerKeyContractInstance())] as const);
  const inst = await entries(instanceKeys.map(([, k]) => k));
  for (const [c, k] of instanceKeys) {
    const e = inst.get(k);
    if (!e || e.type !== "contractData" || e.contractData.val.type !== "scvContractInstance") contracts[c] = { exists: false, kind: null };
    else contracts[c] = { exists: true, kind: e.contractData.val.instance.executable.type === "contractExecutableStellarAsset" ? "sac" : "wasm" };
  }
  const sacBalances: StateSnapshot["sacBalances"] = {};
  const balKeys = req.sacHolders.map((h) => [`${h.sac}:${h.holder}`, contractDataKey(h.sac, nativeToScVal(["Balance", h.holder], { type: ["symbol", "address"] }))] as const);
  const bals = await entries(balKeys.map(([, k]) => k));
  for (const [id, k] of balKeys) {
    const e = bals.get(k);
    if (!e || e.type !== "contractData") sacBalances[id] = null;
    else {
      const v = scValToNative(e.contractData.val) as { amount: bigint; authorized: boolean };
      sacBalances[id] = { amount: String(v.amount), authorized: v.authorized };
    }
  }

  const simulateRaw = async (contractId: string, fn: string, args: CallArg[], source: string): Promise<{ error?: string; retval?: unknown }> => {
    const src = StrKey.isValidEd25519PublicKey(source) ? source : "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN7";
    const tx = new TransactionBuilder(new Account(src, "0"), { fee: "100", networkPassphrase: PASSPHRASE[req.network] })
      .addOperation(Operation.invokeContractFunction({ contract: contractId, function: fn, args: args.map(toScVal) }))
      .setTimeout(30)
      .build();
    const r = (await call("simulateTransaction", { transaction: tx.toXDR() })) as { error?: string; results?: { xdr: string }[] };
    if (r.error) return { error: r.error };
    const x = r.results?.[0]?.xdr;
    return { retval: x ? scValToNative(X.ScVal.fromXDR(x, "base64")) : undefined };
  };

  for (const rd of req.reads ?? []) {
    const r = await simulateRaw(rd.contractId, rd.fn, rd.args, "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN7");
    if (r.error) continue;
    const c = contracts[rd.contractId] ?? (contracts[rd.contractId] = { exists: true, kind: null });
    c.reads = { ...(c.reads ?? {}), [readKey(rd.fn, rd.args)]: typeof r.retval === "bigint" ? String(r.retval) : r.retval };
    if (rd.fn === "name" && c.kind === "sac") {
      const w = wrapsFromName(r.retval);
      if (w) c.wraps = w;
    }
  }

  const simulations: RecordedSimulation[] = [];
  for (const s of req.simulate) {
    const r = await simulateRaw(s.contractId, s.fn, s.args, s.source);
    const callStr = canonicalCall(s.contractId, s.fn, s.args);
    if (r.error) {
      const m = /Error\(Contract, #(\d+)\)/.exec(r.error);
      simulations.push({ call: callStr, source: s.source, result: { ok: false, error: r.error, ...(m ? { contractErrorCode: Number(m[1]) } : {}) } });
    } else simulations.push({ call: callStr, source: s.source, result: { ok: true } });
  }

  const latest = (await call("getLatestLedger")) as { sequence: number; protocolVersion?: number };
  const capturedAt = req.capturedAt ?? new Date().toISOString();
  const snapshot: StateSnapshot = {
    schema: "sik.state-snapshot/1",
    network: req.network,
    ledger: latest.sequence,
    capturedAt,
    accounts,
    contracts,
    sacBalances,
    simulations,
    networkParams: { baseReserveStroops: String(ledgerRec?.base_reserve_in_stroops ?? 5000000), baseFeeStroops: String(ledgerRec?.base_fee_in_stroops ?? 100) },
  };
  const provenance: Provenance = {
    fixture: "state.json",
    capturedAt,
    script: req.script ?? "src/fixtures/capture.ts",
    network: req.network,
    source: {
      kind: "captured",
      urls: [...urls].sort(),
      ...(version?.version ? { rpcVersion: version.version } : {}),
      ...(latest.protocolVersion !== undefined ? { protocolVersion: latest.protocolVersion } : {}),
      ...(root?.horizon_version ? { horizonVersion: root.horizon_version } : {}),
    },
    ledger: latest.sequence,
    readsAreAtomic: false,
    containsSecrets: false,
    notes: req.notes ?? "Read-only capture: Horizon GET and RPC read methods; simulations use unsigned envelopes. Horizon and RPC reads are not atomic with each other; ledger is the RPC latest ledger after the reads.",
  };
  return { snapshot, provenance };
}
