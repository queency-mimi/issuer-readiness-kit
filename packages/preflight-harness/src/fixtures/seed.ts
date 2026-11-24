// SPDX-License-Identifier: Apache-2.0
// Testnet seeding (SPEC 2.3.3, PFH-021) and ground-truth payments (PFH-022). THE ONLY CODE IN THIS REPOSITORY THAT
// WRITES TO A NETWORK, and only to the public testnet: assertTestnetWrite refuses any other passphrase or endpoint
// (PFH_E_CAPTURE_WRITE_ATTEMPT). Keys are Keypair.random() held in memory for the run; they are never written,
// logged or returned. Only public addresses and transaction hashes leave this module.
import { Account, Asset, Contract, Keypair, MuxedAccount, nativeToScVal, Networks, Operation, rpc, StrKey, TransactionBuilder } from "@stellar/stellar-sdk";
import type { Transaction, xdr } from "@stellar/stellar-sdk";
import { PfhError } from "../errors.ts";
import type { CaseInput, GroundTruth } from "../types.ts";
import type { CallArg } from "../adapters/canonical.ts";
import { decimalToStroops } from "../adapters/canonical.ts";

export const TESTNET = {
  passphrase: Networks.TESTNET,
  horizonUrl: "https://horizon-testnet.stellar.org",
  rpcUrl: "https://soroban-testnet.stellar.org",
  friendbotUrl: "https://friendbot.stellar.org",
} as const;
export type WriteTarget = { passphrase: string; horizonUrl: string; rpcUrl: string; friendbotUrl: string };

export function assertTestnetWrite(cfg: WriteTarget): void {
  const ok = cfg.passphrase === TESTNET.passphrase && cfg.horizonUrl === TESTNET.horizonUrl && cfg.rpcUrl === TESTNET.rpcUrl && cfg.friendbotUrl === TESTNET.friendbotUrl;
  if (!ok) throw new PfhError("PFH_E_CAPTURE_WRITE_ATTEMPT", "refusing to write: the seeder writes only to the public Stellar testnet", { horizonUrl: cfg.horizonUrl, rpcUrl: cfg.rpcUrl });
}

/** Catalogue cases this seeder builds (the rest are in NOT_CAPTURED_REASON). */
export const SEEDED_CASES = [
  "classic.ready", "classic.trustline-missing", "classic.trustline-unauthorized", "classic.trustline-maintain-liabilities-only",
  "classic.line-full", "classic.line-exact-fit", "classic.line-full-by-buying-liabilities", "classic.unfunded-credit-asset",
  "native.unfunded-create-required", "native.unfunded-below-minimum", "memo.required-no-memo", "memo.required-memo-supplied",
  "memo.contract-sender-with-memo", "muxed.classic-ready", "muxed.base-unfunded", "classic.clawback-enabled", "classic.auth-revocable",
  "classic.destination-is-issuer", "sac.recipient-g-no-trustline", "sac.recipient-g-unfunded", "sac.recipient-deauthorised",
  "sac.sender-deauthorised", "sac.c-address-ready", "sac.c-address-undeployed", "sac.asset-sac-not-deployed", "sac.c-address-needs-auth",
  "sender.insufficient-balance", "classic.ready-controlled-asset", "classic.reserve-short",
] as const;
export type SeededCase = (typeof SEEDED_CASES)[number];

/** Destinations that must stay unfunded (fresh public keys, never created). */
export const UNFUNDED: SeededCase[] = ["classic.unfunded-credit-asset", "native.unfunded-create-required", "native.unfunded-below-minimum", "muxed.base-unfunded", "sac.recipient-g-unfunded"];
/** Cases whose destination is not a per-case G account. */
const NO_OWN_DEST: SeededCase[] = ["classic.destination-is-issuer", "sac.c-address-ready", "sac.c-address-undeployed", "sac.asset-sac-not-deployed", "sac.c-address-needs-auth"];

export interface WorldAddresses {
  iPlain: string; iAuth: string; iClaw: string; iRev: string; iCtrl: string; iNoSac: string;
  sRich: string; sPoor: string; sDeauth: string;
  /** Per-case destination G (funded or not, see UNFUNDED). */
  dest: Record<string, string>;
  /** SAC contract ids: TEST (I_PLAIN), AUTH (I_AUTH), REVO (I_REV, also used as a deployed C destination). */
  sacTest: string; sacAuth: string; sacRev: string;
  /** A strkey-valid contract address with nothing deployed. */
  undeployed: string;
}

export interface CasePlan {
  caseId: SeededCase;
  input: CaseInput;
  accounts: string[];
  contracts: string[];
  sacHolders: { sac: string; holder: string }[];
  reads: { contractId: string; fn: string; args: CallArg[] }[];
  simulate: { contractId: string; fn: string; args: CallArg[]; source: string }[];
  truth: { kind: "payment"; from: "sRich" | "sPoor" } | { kind: "simulation" } | { kind: "none"; note: string };
}

const classic = (code: string, issuer: string): CaseInput["asset"] => ({ kind: "classic", code, issuer });

/** Pure: the per-case inputs and capture requests for a seeded world. */
export function planCases(w: WorldAddresses): CasePlan[] {
  const T = classic("TEST", w.iPlain);
  const units = (amount: string) => decimalToStroops(amount)!;
  const plans: CasePlan[] = [];
  const pay = (caseId: SeededCase, input: Omit<CaseInput, "network">, from: "sRich" | "sPoor" = "sRich") => {
    const issuer = input.asset.kind === "classic" ? [input.asset.issuer] : [];
    const base = input.destination.startsWith("M") ? MuxedAccount.fromAddress(input.destination, "0").baseAccount().accountId() : input.destination;
    const sender = input.sender && input.sender.startsWith("G") ? [input.sender] : [];
    plans.push({ caseId, input: { network: "testnet", ...input }, accounts: [base, ...issuer, ...sender], contracts: [], sacHolders: [], reads: [], simulate: [], truth: { kind: "payment", from } });
  };
  const d = (id: SeededCase) => w.dest[id]!;
  pay("classic.ready", { destination: d("classic.ready"), asset: T, amount: "10", sender: w.sRich });
  pay("classic.trustline-missing", { destination: d("classic.trustline-missing"), asset: T, amount: "10", sender: w.sRich });
  pay("classic.trustline-unauthorized", { destination: d("classic.trustline-unauthorized"), asset: classic("AUTH", w.iAuth), amount: "10", sender: w.sRich });
  pay("classic.trustline-maintain-liabilities-only", { destination: d("classic.trustline-maintain-liabilities-only"), asset: classic("AUTH", w.iAuth), amount: "10", sender: w.sRich });
  pay("classic.line-full", { destination: d("classic.line-full"), asset: T, amount: "10", sender: w.sRich });
  pay("classic.line-exact-fit", { destination: d("classic.line-exact-fit"), asset: T, amount: "10", sender: w.sRich });
  pay("classic.line-full-by-buying-liabilities", { destination: d("classic.line-full-by-buying-liabilities"), asset: T, amount: "10", sender: w.sRich });
  pay("classic.unfunded-credit-asset", { destination: d("classic.unfunded-credit-asset"), asset: T, amount: "10", sender: w.sRich });
  pay("native.unfunded-create-required", { destination: d("native.unfunded-create-required"), asset: { kind: "native" }, amount: "5", sender: w.sRich });
  pay("native.unfunded-below-minimum", { destination: d("native.unfunded-below-minimum"), asset: { kind: "native" }, amount: "0.5", sender: w.sRich });
  pay("muxed.classic-ready", { destination: new MuxedAccount(new Account(d("muxed.classic-ready"), "0"), "12345").accountId(), asset: T, amount: "10", sender: w.sRich });
  pay("muxed.base-unfunded", { destination: new MuxedAccount(new Account(d("muxed.base-unfunded"), "0"), "12345").accountId(), asset: T, amount: "10", sender: w.sRich });
  pay("classic.clawback-enabled", { destination: d("classic.clawback-enabled"), asset: classic("CLAW", w.iClaw), amount: "10", sender: w.sRich });
  pay("classic.auth-revocable", { destination: d("classic.auth-revocable"), asset: classic("REVO", w.iRev), amount: "10", sender: w.sRich });
  pay("classic.destination-is-issuer", { destination: w.iPlain, asset: T, amount: "10", sender: w.sRich });
  pay("sender.insufficient-balance", { destination: d("sender.insufficient-balance"), asset: T, amount: "10", sender: w.sPoor }, "sPoor");
  pay("classic.ready-controlled-asset", { destination: d("classic.ready-controlled-asset"), asset: classic("CTRL", w.iCtrl), amount: "10", sender: w.sRich });
  pay("classic.reserve-short", { destination: d("classic.reserve-short"), asset: T, amount: "10", sender: w.sRich });

  // SEP-29 memo cases: no ground truth (the ledger accepts the payment; the SDK refuses at submit).
  for (const [id, memo] of [["memo.required-no-memo", undefined], ["memo.required-memo-supplied", { type: "text", value: "dep-1" }]] as const) {
    plans.push({ caseId: id, input: { network: "testnet", destination: d(id), asset: { kind: "native" }, amount: "10", sender: w.sRich, ...(memo ? { memo } : {}) }, accounts: [d(id), w.sRich], contracts: [], sacHolders: [], reads: [], simulate: [], truth: { kind: "none", note: "SEP-29 is enforced by SDKs at submit time, not by the ledger; no payment was submitted." } });
  }
  plans.push({ caseId: "memo.contract-sender-with-memo", input: { network: "testnet", destination: d("memo.contract-sender-with-memo"), asset: T, amount: "10", sender: w.sacTest, memo: { type: "text", value: "dep-1" } }, accounts: [d("memo.contract-sender-with-memo"), w.iPlain], contracts: [w.sacTest], sacHolders: [], reads: [], simulate: [], truth: { kind: "none", note: "A contract sender pays through Soroban, which carries no memo; nothing to submit." } });

  // SAC transfers to G recipients: the asset is the SAC contract id; truth is the recorded simulation.
  const sacToG = (id: SeededCase, sac: string, issuer: string, sender: string) =>
    plans.push({ caseId: id, input: { network: "testnet", destination: d(id), asset: { kind: "contract", contractId: sac }, amount: "10", sender }, accounts: [d(id), issuer, sender], contracts: [sac], sacHolders: [], reads: [{ contractId: sac, fn: "name", args: [] }], simulate: [{ contractId: sac, fn: "transfer", args: [sender, d(id), units("10")], source: sender }], truth: { kind: "simulation" } });
  sacToG("sac.recipient-g-no-trustline", w.sacTest, w.iPlain, w.sRich);
  sacToG("sac.recipient-g-unfunded", w.sacTest, w.iPlain, w.sRich);
  sacToG("sac.recipient-deauthorised", w.sacAuth, w.iAuth, w.sRich);
  sacToG("sac.sender-deauthorised", w.sacAuth, w.iAuth, w.sDeauth);

  // Classic assets to C destinations: the destination contract is REVO's SAC (a deployed contract that can hold balances).
  const toC = (id: SeededCase, dest: string, asset: { code: string; issuer: string }, sac: string) =>
    plans.push({ caseId: id, input: { network: "testnet", destination: dest, asset: classic(asset.code, asset.issuer), amount: "10", sender: w.sRich }, accounts: [asset.issuer, w.sRich], contracts: [dest, sac], sacHolders: [{ sac, holder: dest }], reads: [], simulate: [{ contractId: sac, fn: "transfer", args: [w.sRich, dest, units("10")], source: w.sRich }], truth: { kind: "simulation" } });
  toC("sac.c-address-ready", w.sacRev, { code: "TEST", issuer: w.iPlain }, w.sacTest);
  toC("sac.c-address-undeployed", w.undeployed, { code: "TEST", issuer: w.iPlain }, w.sacTest);
  toC("sac.asset-sac-not-deployed", w.sacRev, { code: "NOSAC", issuer: w.iNoSac }, new Asset("NOSAC", w.iNoSac).contractId(TESTNET.passphrase));
  toC("sac.c-address-needs-auth", w.sacRev, { code: "AUTH", issuer: w.iAuth }, w.sacAuth);
  return plans.sort((a, b) => a.caseId.localeCompare(b.caseId));
}

// ---------------------------------------------------------------------------------------------------------------
// Network side (testnet only)

export interface SeedLog {
  write(line: string): void;
}

interface Ctx {
  cfg: WriteTarget;
  keys: Map<string, Keypair>;
  server: rpc.Server;
  log: SeedLog;
  txs: { purpose: string; hash: string }[];
}

const FEE = "1000";

async function horizonGet(ctx: Ctx, path: string): Promise<Response> {
  return fetch(`${ctx.cfg.horizonUrl}${path}`, { headers: { accept: "application/json" } });
}

async function loadAccount(ctx: Ctx, id: string): Promise<Account> {
  const r = await horizonGet(ctx, `/accounts/${id}`);
  if (!r.ok) throw new PfhError("PFH_E_CAPTURE_NETWORK", `load ${id}: HTTP ${r.status}`);
  const body = (await r.json()) as { sequence: string };
  return new Account(id, body.sequence);
}

/** Submit a classic transaction to testnet Horizon. Returns hash and op result codes (never throws on tx_failed). */
async function submitClassic(ctx: Ctx, tx: Transaction): Promise<{ ok: boolean; hash: string; opCodes: string[]; txCode: string }> {
  assertTestnetWrite(ctx.cfg);
  const res = await fetch(`${ctx.cfg.horizonUrl}/transactions`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: `tx=${encodeURIComponent(tx.toXDR())}` });
  const body = (await res.json()) as { hash?: string; successful?: boolean; extras?: { result_codes?: { transaction?: string; operations?: string[] } } };
  const hash = Buffer.from(tx.hash()).toString("hex");
  if (res.ok && body.successful !== false) return { ok: true, hash, opCodes: ["op_success"], txCode: "tx_success" };
  return { ok: false, hash, opCodes: body.extras?.result_codes?.operations ?? [], txCode: body.extras?.result_codes?.transaction ?? `http_${res.status}` };
}

async function classicTx(ctx: Ctx, purpose: string, sourceId: string, ops: xdr.Operation[], signers: string[]): Promise<string> {
  const tx = new TransactionBuilder(await loadAccount(ctx, sourceId), { fee: FEE, networkPassphrase: ctx.cfg.passphrase }).setTimeout(120);
  for (const op of ops) tx.addOperation(op);
  const built = tx.build();
  for (const s of new Set([sourceId, ...signers])) built.sign(ctx.keys.get(s)!);
  const r = await submitClassic(ctx, built);
  if (!r.ok) throw new PfhError("PFH_E_CAPTURE_NETWORK", `seed step "${purpose}" failed: ${r.txCode} [${r.opCodes.join(", ")}] tx ${r.hash}`);
  ctx.txs.push({ purpose, hash: r.hash });
  ctx.log.write(`  ok  ${purpose} (tx ${r.hash.slice(0, 12)})`);
  return r.hash;
}

async function sorobanTx(ctx: Ctx, purpose: string, sourceId: string, op: xdr.Operation): Promise<string> {
  assertTestnetWrite(ctx.cfg);
  const tx = new TransactionBuilder(await loadAccount(ctx, sourceId), { fee: "100000", networkPassphrase: ctx.cfg.passphrase }).addOperation(op).setTimeout(120).build();
  const prepared = await ctx.server.prepareTransaction(tx);
  prepared.sign(ctx.keys.get(sourceId)!);
  const sent = await ctx.server.sendTransaction(prepared);
  if (sent.status === "ERROR") throw new PfhError("PFH_E_CAPTURE_NETWORK", `seed step "${purpose}" rejected by RPC`);
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 1500));
    const got = await ctx.server.getTransaction(sent.hash);
    if (got.status === "SUCCESS") {
      ctx.txs.push({ purpose, hash: sent.hash });
      ctx.log.write(`  ok  ${purpose} (tx ${sent.hash.slice(0, 12)})`);
      return sent.hash;
    }
    if (got.status === "FAILED") throw new PfhError("PFH_E_CAPTURE_NETWORK", `seed step "${purpose}" failed on ledger (tx ${sent.hash})`);
  }
  throw new PfhError("PFH_E_CAPTURE_NETWORK", `seed step "${purpose}" not confirmed in time (tx ${sent.hash})`);
}

const chunk = <T>(xs: T[], n: number): T[][] => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));

export interface SeededWorld {
  addresses: WorldAddresses;
  plans: CasePlan[];
  txs: { purpose: string; hash: string }[];
  /** Submit the ground-truth payment for a plan (testnet). */
  submitTruth(plan: CasePlan): Promise<{ truth: GroundTruth; ledger: number }>;
}

/**
 * Build the whole testnet world for SEEDED_CASES. Roughly 25 classic and 4 Soroban transactions from throwaway
 * accounts funded by Friendbot. Returns public addresses, the case plans and a ground-truth submitter.
 */
export async function seedWorld(log: SeedLog, cfg: WriteTarget = TESTNET): Promise<SeededWorld> {
  assertTestnetWrite(cfg);
  const keys = new Map<string, Keypair>();
  const fresh = () => {
    const k = Keypair.random();
    keys.set(k.publicKey(), k);
    return k.publicKey();
  };
  const ctx: Ctx = { cfg, keys, server: new rpc.Server(cfg.rpcUrl), log, txs: [] };

  const funder = fresh();
  const r = await fetch(`${cfg.friendbotUrl}/?addr=${funder}`);
  if (!r.ok) throw new PfhError("PFH_E_CAPTURE_NETWORK", `friendbot: HTTP ${r.status}`);
  log.write(`  ok  funder funded by Friendbot (${funder})`);

  const roles = { iPlain: fresh(), iAuth: fresh(), iClaw: fresh(), iRev: fresh(), iCtrl: fresh(), iNoSac: fresh(), sRich: fresh(), sPoor: fresh(), sDeauth: fresh() };
  const dest: Record<string, string> = {};
  for (const id of SEEDED_CASES) if (!NO_OWN_DEST.includes(id)) dest[id] = UNFUNDED.includes(id) ? Keypair.random().publicKey() : fresh();
  const TEST = new Asset("TEST", roles.iPlain), AUTH = new Asset("AUTH", roles.iAuth), CLAW = new Asset("CLAW", roles.iClaw), REVO = new Asset("REVO", roles.iRev), CTRL = new Asset("CTRL", roles.iCtrl), NOSAC = new Asset("NOSAC", roles.iNoSac);
  const undeployed = StrKey.encodeContract(Keypair.random().rawPublicKey());
  const addresses: WorldAddresses = { ...roles, dest, sacTest: TEST.contractId(cfg.passphrase), sacAuth: AUTH.contractId(cfg.passphrase), sacRev: REVO.contractId(cfg.passphrase), undeployed };
  const D = (id: SeededCase) => dest[id]!;

  // 1. create accounts (funder pays); the reserve-short wallet gets exactly 2 base reserves.
  const created = [...Object.values(roles), ...SEEDED_CASES.filter((id) => dest[id] && !UNFUNDED.includes(id)).map(D)];
  const createOps = created.map((id) => Operation.createAccount({ destination: id, startingBalance: id === D("classic.reserve-short") ? "1" : id === roles.sRich ? "2000" : "30" }));
  for (const [i, ops] of chunk(createOps, 50).entries()) await classicTx(ctx, `create accounts ${i + 1}`, funder, ops, []);

  // 2. issuer flags (before any trustline: clawback cannot be enabled later for existing lines)
  await classicTx(ctx, "issuer flags", funder, [
    Operation.setOptions({ source: roles.iAuth, setFlags: 1 | 2 }),
    Operation.setOptions({ source: roles.iClaw, setFlags: 2 | 8 }),
    Operation.setOptions({ source: roles.iRev, setFlags: 2 }),
    Operation.setOptions({ source: roles.iCtrl, setFlags: 1 | 2 | 8 }),
  ], [roles.iAuth, roles.iClaw, roles.iRev, roles.iCtrl]);

  // 3. trustlines
  const trust: [string, Asset, string?][] = [
    [roles.sRich, TEST], [roles.sRich, AUTH], [roles.sRich, CLAW], [roles.sRich, REVO], [roles.sRich, CTRL], [roles.sRich, NOSAC],
    [roles.sPoor, TEST], [roles.sDeauth, AUTH],
    [D("classic.ready"), TEST, "1000"], [D("classic.trustline-unauthorized"), AUTH], [D("classic.trustline-maintain-liabilities-only"), AUTH],
    [D("classic.line-full"), TEST, "100"], [D("classic.line-exact-fit"), TEST, "100"], [D("classic.line-full-by-buying-liabilities"), TEST, "100"],
    [D("muxed.classic-ready"), TEST], [D("classic.clawback-enabled"), CLAW], [D("classic.auth-revocable"), REVO],
    [D("sac.recipient-deauthorised"), AUTH], [D("sac.sender-deauthorised"), AUTH], [D("sender.insufficient-balance"), TEST],
    [D("classic.ready-controlled-asset"), CTRL], [D("memo.contract-sender-with-memo"), TEST],
  ];
  for (const [i, part] of chunk(trust, 15).entries()) await classicTx(ctx, `trustlines ${i + 1}`, funder, part.map(([who, asset, limit]) => Operation.changeTrust({ source: who, asset, ...(limit ? { limit } : {}) })), part.map(([who]) => who));

  // 4. authorisations by AUTH_REQUIRED issuers, then issuance
  const authorise = (issuer: string, trustor: string, asset: Asset) => Operation.setTrustLineFlags({ source: issuer, trustor, asset, flags: { authorized: true } });
  await classicTx(ctx, "authorise trustlines", funder, [
    authorise(roles.iAuth, roles.sRich, AUTH), authorise(roles.iAuth, roles.sDeauth, AUTH), authorise(roles.iAuth, D("classic.trustline-maintain-liabilities-only"), AUTH),
    authorise(roles.iAuth, D("sac.recipient-deauthorised"), AUTH), authorise(roles.iAuth, D("sac.sender-deauthorised"), AUTH),
    authorise(roles.iCtrl, roles.sRich, CTRL), authorise(roles.iCtrl, D("classic.ready-controlled-asset"), CTRL),
  ], [roles.iAuth, roles.iCtrl]);
  const pay = (from: string, to: string, asset: Asset, amount: string) => Operation.payment({ source: from, destination: to, asset, amount });
  await classicTx(ctx, "issue assets", funder, [
    pay(roles.iPlain, roles.sRich, TEST, "100000"), pay(roles.iAuth, roles.sRich, AUTH, "1000"), pay(roles.iClaw, roles.sRich, CLAW, "1000"),
    pay(roles.iRev, roles.sRich, REVO, "1000"), pay(roles.iCtrl, roles.sRich, CTRL, "1000"), pay(roles.iNoSac, roles.sRich, NOSAC, "1000"),
    pay(roles.iPlain, roles.sPoor, TEST, "5"), pay(roles.iAuth, roles.sDeauth, AUTH, "100"),
    pay(roles.iPlain, D("classic.line-full"), TEST, "95"), pay(roles.iPlain, D("classic.line-exact-fit"), TEST, "90"), pay(roles.iPlain, D("classic.line-full-by-buying-liabilities"), TEST, "80"),
  ], [roles.iPlain, roles.iAuth, roles.iClaw, roles.iRev, roles.iCtrl, roles.iNoSac]);

  // 5. state changes: maintain-liabilities-only, deauthorisations, SEP-29 data entries, a buy offer
  await classicTx(ctx, "reduce and revoke authorisations", funder, [
    Operation.setTrustLineFlags({ source: roles.iAuth, trustor: D("classic.trustline-maintain-liabilities-only"), asset: AUTH, flags: { authorized: false, authorizedToMaintainLiabilities: true } }),
    Operation.setTrustLineFlags({ source: roles.iAuth, trustor: D("sac.recipient-deauthorised"), asset: AUTH, flags: { authorized: false } }),
    Operation.setTrustLineFlags({ source: roles.iAuth, trustor: roles.sDeauth, asset: AUTH, flags: { authorized: false } }),
  ], [roles.iAuth]);
  await classicTx(ctx, "memo-required data entries and buy offer", funder, [
    Operation.manageData({ source: D("memo.required-no-memo"), name: "config.memo_required", value: "1" }),
    Operation.manageData({ source: D("memo.required-memo-supplied"), name: "config.memo_required", value: "1" }),
    Operation.manageBuyOffer({ source: D("classic.line-full-by-buying-liabilities"), selling: Asset.native(), buying: TEST, buyAmount: "15", price: "0.0001" }),
  ], [D("memo.required-no-memo"), D("memo.required-memo-supplied"), D("classic.line-full-by-buying-liabilities")]);

  // 6. Soroban: deploy three SACs (TEST, AUTH, REVO) and give REVO's SAC (a deployed C address) a TEST balance.
  for (const [label, asset] of [["TEST", TEST], ["AUTH", AUTH], ["REVO", REVO]] as const) await sorobanTx(ctx, `deploy SAC ${label}`, funder, Operation.createStellarAssetContract({ asset }));
  await sorobanTx(ctx, "SAC TEST transfer to the REVO SAC contract", roles.sRich, new Contract(addresses.sacTest).call("transfer", nativeToScVal(roles.sRich, { type: "address" }), nativeToScVal(addresses.sacRev, { type: "address" }), nativeToScVal(50_000_000n, { type: "i128" })));

  const plans = planCases(addresses);

  async function submitTruth(plan: CasePlan): Promise<{ truth: GroundTruth; ledger: number }> {
    if (plan.truth.kind !== "payment") throw new Error("only payment truths are submitted");
    const from = plan.truth.from === "sPoor" ? roles.sPoor : roles.sRich;
    const a = plan.input.asset;
    const asset = a.kind === "native" ? Asset.native() : a.kind === "classic" ? new Asset(a.code, a.issuer) : null;
    if (!asset) throw new Error("payment truth needs a classic or native asset");
    const b = new TransactionBuilder(await loadAccount(ctx, from), { fee: FEE, networkPassphrase: cfg.passphrase }).addOperation(Operation.payment({ destination: plan.input.destination, asset, amount: plan.input.amount })).setTimeout(120);
    const tx = b.build();
    tx.sign(keys.get(from)!);
    const res = await submitClassic(ctx, tx);
    const code = res.ok ? "success" : res.opCodes[0] ?? res.txCode;
    const known = ["success", "op_no_destination", "op_no_trust", "op_not_authorized", "op_line_full", "op_underfunded"];
    let ledger = 0;
    for (let i = 0; i < 10 && ledger === 0; i++) {
      await new Promise((r) => setTimeout(r, 1500));
      const got = await horizonGet(ctx, `/transactions/${res.hash}`);
      if (got.ok) ledger = ((await got.json()) as { ledger: number }).ledger;
    }
    log.write(`  ok  truth ${plan.caseId}: ${code} (tx ${res.hash.slice(0, 12)}, ledger ${ledger || "unknown"})`);
    const truth: GroundTruth = { kind: "horizon-result", operationResult: (known.includes(code) ? code : "other") as "success", txHash: res.hash, note: `Testnet payment from a throwaway sender; Horizon result ${res.txCode}${res.opCodes.length ? ` [${res.opCodes.join(", ")}]` : ""}.` };
    return { truth, ledger };
  }

  return { addresses, plans, txs: ctx.txs, submitTruth };
}
