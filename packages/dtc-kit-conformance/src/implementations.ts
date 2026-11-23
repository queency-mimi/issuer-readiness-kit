// SPDX-License-Identifier: Apache-2.0
// Executable scenarios (DTC-019, DTC-030 part, DTC-033, DTC-034, DTC-035 spike). Browser-safe: the sandbox
// runs in-process, recorded testnet evidence is passed in through the context (never fetched here).
import { captureInstant, reduceCashAllocation, trustLabel } from "@sik/dtc-kit-core";
import type { CashAllocationCase, ChainAdapter } from "@sik/dtc-kit-core";
import type { ResolvedProfile } from "@sik/dtc-kit-profile-spec/pure";
import { allocateConsolidatedCredit, reconcile } from "@sik/dtc-kit-reconciliation/browser";
import type { ParticipantBooks } from "@sik/dtc-kit-reconciliation/browser";
import { CLIENTS, FAKE_ADDRESSES, FAKE_CUSIP, FIVE_SCENARIOS, MockDtcRegistry, inProcessTransport, runScripted } from "@sik/dtc-kit-sandbox/browser";
import type { Transport } from "@sik/dtc-kit-sandbox/browser";

/** One step of the recorded testnet run (fixtures/sac-force-transfer/testnet-run.json), as far as used here. */
export interface RecordedTestnetStep {
  step: string;
  scenario?: string;
  operations: string[];
  hash: string;
  ledger: number | null;
  successful: boolean;
  resultCodes: { transaction?: string; operations?: string[] } | null;
  balancesAfter: Record<string, string>;
}
export interface RecordedTestnetRun {
  network: string;
  finishedAt: string;
  asset: { code: string; issuer: string };
  steps: RecordedTestnetStep[];
}

export interface ScenarioContext {
  profile: ResolvedProfile;
  adapter: ChainAdapter;
  /** Recorded testnet evidence (replayed, never re-run here). */
  testnetRun?: RecordedTestnetRun;
  /** Monotonic clock for durations (performance.now in both Node and browsers). */
  now?: () => number;
}

export interface Evidence {
  kind: "sandbox" | "testnet-recorded" | "measurement";
  detail: string;
  ledger?: number;
  hash?: string;
}

export interface ImplResult {
  outcome: "pass" | "fail" | "observed";
  detail: string[];
  evidence: Evidence[];
  observation?: unknown;
}

type Impl = (ctx: ScenarioContext) => Promise<ImplResult>;

class Check {
  readonly problems: string[] = [];
  readonly notes: string[] = [];
  readonly evidence: Evidence[] = [];
  that(cond: boolean, msg: string): void {
    if (!cond) this.problems.push(msg);
  }
  eq(actual: unknown, expected: unknown, msg: string): void {
    const big = (_k: string, v: unknown) => (typeof v === "bigint" ? `${v}n` : v);
    const a = JSON.stringify(actual, big);
    const e = JSON.stringify(expected, big);
    if (a !== e) this.problems.push(`${msg}: got ${a}, expected ${e}`);
  }
  note(s: string): void {
    this.notes.push(s);
  }
  done(observation?: unknown): ImplResult {
    if (this.evidence.length === 0) this.evidence.push({ kind: "sandbox", detail: "in-memory mock DTC registry (fictional institutions)" });
    return { outcome: this.problems.length === 0 ? "pass" : "fail", detail: this.problems.length ? this.problems : this.notes, evidence: this.evidence, ...(observation !== undefined ? { observation } : {}) };
  }
}

type J = Record<string, unknown>;

/** A fresh sandbox with a logged-in client for every fake service account. */
function sandbox(ctx: ScenarioContext) {
  const registry = new MockDtcRegistry({ profile: ctx.profile, adapter: ctx.adapter });
  const t: Transport = inProcessTransport(registry);
  const call = async (clientId: string, method: "GET" | "POST", path: string, body?: unknown): Promise<{ status: number; body: J }> => {
    const r = await t({ method, path, headers: { authorization: `Bearer sbx-token.${clientId}` }, ...(body !== undefined ? { body } : {}) });
    return { status: r.status, body: r.body as J };
  };
  const register = async (sa: string, address: string, kind: "internal" | "client", clientId?: string, ledger = "sandbox-ledger"): Promise<string> =>
    (await call(sa, "POST", "/v1/wallets", { ledger, address, kind, ...(clientId ? { clientId } : {}) })).body["id"] as string;
  const advance = (arg: { seconds?: number; to?: string }) => call("sim-1", "POST", "/v1/sim/advance", arg);
  const convert = (sa: string, wallet: string, direction: "to-token" | "to-book-entry", tokens: string) => call(sa, "POST", "/v1/conversion-orders", { wallet, cusip: FAKE_CUSIP, direction, tokens });
  const balances = async (sa: string, participant: string) => (await call(sa, "GET", `/v1/accounts/${participant}/balances`)).body as { digital: { walletId: string; tokens: string }[]; classic: { shares: string }[]; cash: { amountMinorUnits: string } };
  const tokensOf = async (sa: string, participant: string, walletId: string) => (await balances(sa, participant)).digital.find((d) => d.walletId === walletId)?.tokens;
  return { registry, call, register, advance, convert, balances, tokensOf, transport: t };
}

const scripted = async (ctx: ScenarioContext, id: string): Promise<{ passed: boolean; detail: string[] }> => {
  const s = FIVE_SCENARIOS.find((x) => x.id === id);
  if (!s) return { passed: false, detail: [`scripted scenario ${id} missing`] };
  const out = await runScripted(inProcessTransport(new MockDtcRegistry({ profile: ctx.profile, adapter: ctx.adapter })), s, ctx.profile);
  return { passed: out.passed, detail: out.steps.filter((x) => !x.ok).map((x) => `${x.step}: ${x.detail ?? ""}`) };
};

const step = (ctx: ScenarioContext, re: RegExp): RecordedTestnetStep | undefined => ctx.testnetRun?.steps.find((s) => re.test(s.step));
const birchBooks = (registry: MockDtcRegistry): ParticipantBooks => ({
  participant: "SBX-9002",
  clients: CLIENTS.filter((c) => c.participant === "SBX-9002").map((c) => ({ clientId: c.clientId })),
  wallets: registry.snapshot().wallets.filter((w) => w.participant === "SBX-9002").map((w) => ({ ledger: w.ledger, address: w.address, kind: w.kind, ...(w.clientId ? { clientId: w.clientId } : {}) })),
});

/** Fund wallets by registering, completing, converting and settling. Returns wallet ids. */
async function fundedBirch(sb: ReturnType<typeof sandbox>, amounts: string[]): Promise<string[]> {
  const ids: string[] = [];
  for (const [i, n] of amounts.entries()) {
    const client = `C-BIRCH-00${(i % 3) + 1}`;
    ids.push(await sb.register("sa-birch-1", `SBX-ADDR-BIRCH-${String(i + 1).padStart(4, "0")}`, "client", client));
  }
  await sb.advance({ seconds: 60 });
  for (const [i, n] of amounts.entries()) await sb.convert("sa-birch-1", ids[i] as string, "to-token", n);
  await sb.advance({ seconds: 900 });
  return ids;
}

export const IMPLEMENTATIONS: Record<string, Impl> = {
  "SC-000": async (ctx) => {
    const c = new Check();
    const sb = sandbox(ctx);
    const r = await sb.transport({ method: "GET", path: "/v1/health" });
    const body = r.body as J;
    c.eq([r.status, body["profile"], body["lineage"]], [200, "dtc-stellar", ["dtc-generic", "dtc-stellar"]], "health");
    c.that((r.headers["x-dtc-kit-disclaimer"] ?? "").includes("not DTC-certified"), "disclaimer header");
    return c.done();
  },
  "SC-001": async (ctx) => {
    const c = new Check();
    const r = await scripted(ctx, "SBX-1-register-wallet");
    c.that(r.passed, r.detail.join("; "));
    const sb = sandbox(ctx);
    const id = await sb.register("sa-alder-1", FAKE_ADDRESSES.alderInternal, "internal");
    await sb.advance({ seconds: 60 });
    const w = (await sb.call("sa-alder-1", "GET", `/v1/wallets/${id}`)).body;
    c.eq([w["status"], w["onChainAllowlisted"]], ["Completed", true], "wallet after 60 s");
    const plans = (await sb.call("sim-1", "GET", "/v1/sim/plans")).body["plans"] as { action: string }[];
    c.eq(plans.map((p) => p.action), ["allowlist-add"], "chain plans");
    return c.done();
  },
  "SC-002": async (ctx) => {
    const c = new Check();
    const sb = sandbox(ctx);
    const r = await sb.call("sim-1", "POST", "/v1/wallets", { ledger: "sandbox-ledger", address: "SBX-ADDR-OUTSIDER-0001", kind: "internal" });
    c.eq([r.status, r.body["code"]], [403, "NOT_A_PARTICIPANT"], "refusal");
    c.eq(sb.registry.snapshot().wallets.length, 0, "wallets created");
    return c.done();
  },
  "SC-003": async (ctx) => {
    const c = new Check();
    const r = await scripted(ctx, "SBX-2-ofac-fail");
    c.that(r.passed, r.detail.join("; "));
    return c.done();
  },
  "SC-004": async (ctx) => {
    const c = new Check();
    const sb = sandbox(ctx);
    const r = await sb.call("sa-cedar-1", "POST", "/v1/wallets", { ledger: "stellar", address: "not a stellar address ;-)", kind: "internal" });
    c.eq(r.status, 202, "registration of malformed address text");
    c.note("Accepted: the registry does not validate address text (row wallet.address-not-validated-by-dtc). A chain adapter would plan no envelope for it.");
    const plan = ctx.adapter.planAllowlistAdd({ ledger: "stellar", address: "not a stellar address ;-)", cusip: FAKE_CUSIP });
    c.note(`adapter ${ctx.adapter.id}: envelope ${plan.envelopeXdr ? "built" : "not built"}; ${plan.caveats.at(-1) ?? ""}`);
    return c.done();
  },
  "SC-005": async (ctx) => {
    const c = new Check();
    const sb = sandbox(ctx);
    const a = await sb.call("sa-birch-1", "POST", "/v1/wallets", { ledger: "sandbox-ledger", address: "A", kind: "client" });
    const b = await sb.call("sa-birch-1", "POST", "/v1/wallets", { ledger: "sandbox-ledger", address: "B", kind: "client", clientId: "C-NOPE" });
    const d = await sb.call("sa-birch-1", "POST", "/v1/wallets", { ledger: "sandbox-ledger", address: "C", kind: "client", clientId: "C-BIRCH-001" });
    c.eq([a.status, b.status, d.status], [422, 422, 202], "statuses");
    const csv = await sb.transport({ method: "GET", path: "/v1/wallets", headers: { authorization: "Bearer sbx-token.sa-birch-1", accept: "text/csv" } });
    c.that(String(csv.body).includes("C-BIRCH-001"), "wallets CSV lists the clientId");
    return c.done();
  },
  "SC-006": async (ctx) => {
    const c = new Check();
    const sb = sandbox(ctx);
    await sb.call("sim-1", "POST", "/v1/sim/reset", { fixture: "two-wallets-funded" });
    const p = await sb.call("sa-birch-1", "POST", "/v1/transfers/precheck", { fromWallet: "W-1", toAddress: FAKE_ADDRESSES.unregistered, tokens: "1" });
    c.eq(p.body["reasons"], ["DEST_NOT_REGISTERED"], "precheck");
    const t = await sb.call("sa-birch-1", "POST", "/v1/transfers", { fromWallet: "W-1", toAddress: FAKE_ADDRESSES.unregistered, tokens: "1" });
    c.eq(t.status, 409, "transfer refused");
    c.eq(await sb.tokensOf("sa-birch-1", "SBX-9002", "W-1"), "100", "balance unchanged");
    const rec = step(ctx, /to C \(no trustline\)/);
    if (rec && ctx.adapter.id === "stellar-sac") {
      c.eq(rec.resultCodes?.operations, ["op_no_trust"], "ledger-level rejection on testnet");
      c.evidence.push({ kind: "testnet-recorded", detail: "classic payment to an address without a trustline: op_no_trust", ...(rec.ledger ? { ledger: rec.ledger } : {}), hash: rec.hash });
      c.evidence.push({ kind: "sandbox", detail: "registry precheck and transfer" });
    }
    return c.done();
  },
  "SC-007": async (ctx) => {
    const c = new Check();
    const sb = sandbox(ctx);
    await sb.call("sim-1", "POST", "/v1/sim/reset", { fixture: "two-wallets-funded" });
    await sb.call("sa-birch-1", "POST", "/v1/transfers", { fromWallet: "W-1", toAddress: FAKE_ADDRESSES.birchClient2, tokens: "4" });
    const b = await sb.balances("sa-birch-1", "SBX-9002");
    c.eq(b.digital.map((d) => d.tokens), ["96", "4"], "balances (fixture starts at 100/0)");
    const act = (await sb.call("sa-birch-1", "GET", "/v1/accounts/SBX-9002/activity")).body["activity"] as { type: string }[];
    c.eq(act.map((a) => a.type), ["Payment", "Payment Received"], "activity rows");
    return c.done();
  },
  "SC-008": async (ctx) => {
    const c = new Check();
    const sb = sandbox(ctx);
    await sb.call("sim-1", "POST", "/v1/sim/reset", { fixture: "two-wallets-funded" });
    await sb.register("sa-dunmore-1", FAKE_ADDRESSES.dunmoreSable, "client", "C-DUNMORE-SABLE");
    await sb.advance({ seconds: 60 });
    const p = await sb.call("sa-birch-1", "POST", "/v1/transfers/precheck", { fromWallet: "W-1", toAddress: FAKE_ADDRESSES.dunmoreSable, tokens: "1" });
    c.eq(p.body["reasons"], ["DEST_FAILED_COMPLIANCE"], "precheck");
    c.eq((await sb.call("sa-birch-1", "POST", "/v1/transfers", { fromWallet: "W-1", toAddress: FAKE_ADDRESSES.dunmoreSable, tokens: "1" })).status, 409, "transfer refused");
    c.eq(await sb.tokensOf("sa-birch-1", "SBX-9002", "W-1"), "100", "no tokens moved");
    return c.done();
  },
  "SC-009": async (ctx) => {
    const c = new Check();
    const sb = sandbox(ctx);
    await sb.call("sim-1", "POST", "/v1/sim/reset", { fixture: "two-wallets-funded" });
    await sb.register("sa-birch-1", FAKE_ADDRESSES.birchClient3, "client", "C-BIRCH-003");
    await sb.advance({ seconds: 45 }); // OFAC passed, on-chain authorisation not yet confirmed
    const p = await sb.call("sa-birch-1", "POST", "/v1/transfers/precheck", { fromWallet: "W-1", toAddress: FAKE_ADDRESSES.birchClient3, tokens: "1" });
    c.eq(p.body["reasons"], ["DEST_STATUS_NOT_COMPLETED"], "precheck while authorisation is pending");
    const rec = step(ctx, /deauthorised B$/);
    if (rec && ctx.adapter.id === "stellar-sac") {
      c.eq(rec.resultCodes?.operations, ["op_not_authorized"], "ledger-level failure on testnet (classic payment)");
      c.evidence.push({ kind: "testnet-recorded", detail: "classic payment to a deauthorised trustline: op_not_authorized (the SAC contract error 'balance is deauthorized' was not exercised)", ...(rec.ledger ? { ledger: rec.ledger } : {}), hash: rec.hash });
      c.evidence.push({ kind: "sandbox", detail: "registry precheck" });
    }
    return c.done();
  },
  "SC-010": async (ctx) => {
    const c = new Check();
    const sb = sandbox(ctx);
    const w = await sb.register("sa-birch-1", FAKE_ADDRESSES.birchClient1, "client", "C-BIRCH-001");
    await sb.advance({ seconds: 60 });
    const o = await sb.convert("sa-birch-1", w, "to-token", "100");
    c.eq(o.body["status"], "Processing", "order on submit");
    await sb.advance({ seconds: 900 });
    c.eq((await sb.call("sa-birch-1", "GET", `/v1/conversion-orders/${String(o.body["id"])}`)).body["status"], "Completed", "order after 15 min");
    const b = await sb.balances("sa-birch-1", "SBX-9002");
    c.eq([b.digital[0]?.tokens, b.classic[0]?.shares], ["100", "900"], "tokens and classic shares (fixture: 1,000 classic)");
    c.eq(sb.registry.snapshot().supply, 100n, "supply equals converted shares");
    return c.done();
  },
  "SC-011": async (ctx) => {
    const c = new Check();
    const sb = sandbox(ctx);
    const w = await sb.register("sa-birch-1", FAKE_ADDRESSES.birchClient1, "client", "C-BIRCH-001");
    await sb.advance({ seconds: 60 });
    const o = await sb.convert("sa-birch-1", w, "to-token", "1.5");
    c.eq([o.status, o.body["reasonCode"], o.body["status"]], [422, "FRACTIONAL_QUANTITY", "Declined"], "fractional order");
    const orders = (await sb.call("sa-birch-1", "GET", "/v1/conversion-orders")).body["orders"] as { status: string }[];
    c.eq(orders.filter((x) => x.status === "Processing").length, 0, "orders in Processing");
    return c.done();
  },
  "SC-012": async (ctx) => {
    const c = new Check();
    const sb = sandbox(ctx);
    const [w] = await fundedBirch(sb, ["100"]);
    await sb.convert("sa-birch-1", w as string, "to-book-entry", "40");
    await sb.advance({ seconds: 900 });
    const b = await sb.balances("sa-birch-1", "SBX-9002");
    c.eq([b.digital[0]?.tokens, b.classic[0]?.shares], ["60", "940"], "tokens and classic after burn");
    c.eq(sb.registry.snapshot().supply, 60n, "supply decreased by 40");
    return c.done();
  },
  "SC-014": async (ctx) => {
    const c = new Check();
    const sb = sandbox(ctx);
    const [w] = await fundedBirch(sb, ["10"]);
    await sb.register("sa-birch-1", FAKE_ADDRESSES.birchClient2, "client", "C-BIRCH-002", "sandbox-ledger-b");
    await sb.advance({ to: "2027-01-16T15:00:00Z" }); // Saturday 10:00 ET
    const body = { fromWallet: w, toAddress: FAKE_ADDRESSES.birchClient2, toLedger: "sandbox-ledger-b", tokens: "4" };
    const sat = await sb.call("sa-birch-1", "POST", "/v1/transfers", body);
    c.eq([sat.status, sat.body["code"]], [409, "CROSS_NETWORK_OUTSIDE_HOURS"], "Saturday cross-network");
    await sb.register("sa-birch-1", FAKE_ADDRESSES.birchClient3, "client", "C-BIRCH-003");
    await sb.advance({ seconds: 60 });
    const same = await sb.call("sa-birch-1", "POST", "/v1/transfers", { fromWallet: w, toAddress: FAKE_ADDRESSES.birchClient3, tokens: "1" });
    c.eq(same.status, 200, "same-network transfer on Saturday");
    await sb.advance({ to: "2027-01-18T15:00:00Z" }); // Monday 10:00 ET
    const mon = await sb.call("sa-birch-1", "POST", "/v1/transfers", body);
    c.eq([mon.status, mon.body["crossNetwork"]], [200, true], "Monday cross-network");
    c.eq(sb.registry.snapshot().supply, 10n, "supply conserved across both ledgers");
    return c.done();
  },
  "SC-015": async (ctx) => {
    const c = new Check();
    const r = await scripted(ctx, "SBX-4-chill");
    c.that(r.passed, r.detail.join("; "));
    const t = trustLabel(ctx.profile, ["wallet.control-state-semantics"]);
    c.eq(t.status, "inferred", "label of the refusal");
    return c.done();
  },
  "SC-016": async (ctx) => {
    const c = new Check();
    const sb = sandbox(ctx);
    await sb.call("sim-1", "POST", "/v1/sim/reset", { fixture: "two-wallets-funded" });
    await sb.call("sa-birch-1", "POST", "/v1/transfers", { fromWallet: "W-1", toAddress: FAKE_ADDRESSES.birchClient2, tokens: "5" });
    await sb.call("sim-1", "POST", "/v1/sim/wallets/W-2/control", { control: "global-lock" });
    const out = await sb.call("sa-birch-1", "POST", "/v1/transfers", { fromWallet: "W-2", toAddress: FAKE_ADDRESSES.birchClient1, tokens: "1" });
    const inn = await sb.call("sa-birch-1", "POST", "/v1/transfers", { fromWallet: "W-1", toAddress: FAKE_ADDRESSES.birchClient2, tokens: "1" });
    c.eq([out.body["code"], inn.body["code"]], ["SOURCE_RESTRICTED", "DEST_RESTRICTED"], "outbound and inbound");
    return c.done();
  },
  "SC-017": async (ctx) => {
    const c = new Check();
    const sb = sandbox(ctx);
    await sb.call("sim-1", "POST", "/v1/sim/reset", { fixture: "two-wallets-funded" });
    const locked = await sb.call("sim-1", "POST", "/v1/sim/wallets/W-1/control", { control: "compliance-lock" });
    const released = await sb.call("sim-1", "POST", "/v1/sim/wallets/W-1/control", { control: "release" });
    c.eq([locked.body["status"], released.body["status"]], ["Compliance Lock", "Completed"], "statuses");
    const plans = (await sb.call("sim-1", "GET", "/v1/sim/plans")).body["plans"] as { action: string }[];
    c.eq(plans.map((p) => p.action), ["restrict", "unrestrict"], "chain effects");
    return c.done();
  },
  "SC-018": async (ctx) => {
    const c = new Check();
    const r = await scripted(ctx, "SBX-5-force-transfer");
    c.that(r.passed, r.detail.join("; "));
    const sb = sandbox(ctx);
    await sb.call("sim-1", "POST", "/v1/sim/reset", { fixture: "two-wallets-funded" });
    const ft = await sb.call("dtc-ops-1", "POST", "/v1/admin/force-transfers", { fromWallet: "W-1", toAddress: FAKE_ADDRESSES.birchClient2, tokens: "100", reason: "erroneous" });
    c.eq(ft.body["state"], "Confirmed", "override");
    c.eq((await sb.balances("sa-birch-1", "SBX-9002")).digital.map((d) => d.tokens), ["0", "100"], "balances");
    const plan = ft.body["plan"] as { steps: { signer: string }[] } | undefined;
    c.that(!!plan && plan.steps.every((s) => s.signer !== FAKE_ADDRESSES.birchClient1), "no step is signed by the holder");
    c.note(`adapter ${ctx.adapter.id} planned ${plan?.steps.length ?? 0} step(s)`);
    return c.done();
  },
  "SC-019": async (ctx) => {
    const c = new Check();
    const main = step(ctx, /^SC-019 main/);
    const variant = step(ctx, /^SC-019 variant/);
    if (!main || !variant) {
      c.that(false, "recorded testnet run not provided");
      return c.done();
    }
    for (const s of [main, variant]) c.evidence.push({ kind: "testnet-recorded", detail: s.step, ...(s.ledger ? { ledger: s.ledger } : {}), hash: s.hash });
    const observation = {
      main: { successful: main.successful, operations: main.operations, balancesAfter: main.balancesAfter },
      variant: { successful: variant.successful, resultCodes: variant.resultCodes, holderAAfter: variant.balancesAfter["holderA"] },
      reading: "One issuer-signed transaction [clawback, payment] moved the tokens; when the payment leg failed the whole transaction failed and the holder kept the tokens. Whether DTC uses this mechanism is unknown.",
    };
    return { outcome: "observed", detail: [observation.reading], evidence: c.evidence, observation };
  },
  "SC-022": async (ctx) => {
    const c = new Check();
    const sb = sandbox(ctx);
    await sb.call("sim-1", "POST", "/v1/sim/reset", { fixture: "two-wallets-funded" });
    for (const reason of ["erroneous", "erroneous", "stolen"]) await sb.call("dtc-ops-1", "POST", "/v1/admin/force-transfers", { fromWallet: "W-1", toAddress: FAKE_ADDRESSES.birchClient2, tokens: "1", reason });
    const q1 = (await sb.call("dtc-ops-1", "GET", "/v1/admin/root-wallet-uses")).body;
    c.eq([q1["total"], q1["byReason"]], [3, { erroneous: 2, stolen: 1 }], "quarter totals");
    await sb.advance({ to: "2027-04-02T15:00:00Z" });
    await sb.call("dtc-ops-1", "POST", "/v1/admin/force-transfers", { fromWallet: "W-1", toAddress: FAKE_ADDRESSES.birchClient2, tokens: "1", reason: "lost" });
    const q2 = (await sb.call("dtc-ops-1", "GET", "/v1/admin/root-wallet-uses")).body;
    c.eq([q2["quarterStart"], q2["total"]], ["2027-04-01", 1], "next quarter counts only its own use");
    return c.done();
  },
  "SC-023": async (ctx) => {
    const c = new Check();
    c.eq(captureInstant("2027-01-15", "interest", ctx.profile).at, "2027-01-15T20:00:00-05:00", "winter capture");
    c.eq(new Date(captureInstant("2027-01-15", "interest", ctx.profile).at).toISOString(), "2027-01-16T01:00:00.000Z", "winter capture (UTC)");
    c.eq(new Date(captureInstant("2027-07-15", "interest", ctx.profile).at).toISOString(), "2027-07-16T00:00:00.000Z", "summer capture (UTC)");
    const sb = sandbox(ctx);
    const [w1, w2] = await fundedBirch(sb, ["100", "100"]);
    const ca = await sb.call("dtc-ops-1", "POST", "/v1/corporate-actions", { cusip: FAKE_CUSIP, kind: "interest", recordDate: "2027-01-15", payDate: "2027-01-19", rate: { numerator: "1", denominator: "1" } });
    await sb.advance({ to: "2027-01-15T22:00:00Z" }); // 17:00 ET, inside processing hours
    await sb.convert("sa-birch-1", w2 as string, "to-book-entry", "30");
    await sb.advance({ to: "2027-01-16T01:01:00Z" }); // 20:01 ET: capture has run
    await sb.convert("sa-birch-1", w1 as string, "to-book-entry", "30");
    const cap = (await sb.call("dtc-ops-1", "POST", `/v1/corporate-actions/${String(ca.body["id"])}/capture`)).body;
    const pos = cap["positions"] as { walletId: string; tokens: string }[];
    c.eq(pos.map((p) => [p.walletId, p.tokens]), [[w1, "100"], [w2, "70"]], "captured: W1 converted after 20:00 keeps 100; W2 converted before keeps 70");
    return c.done();
  },
  "SC-024": async (ctx) => {
    const c = new Check();
    const sb = sandbox(ctx);
    const [w1, w2] = await fundedBirch(sb, ["50", "50"]);
    await sb.convert("sa-birch-1", w2 as string, "to-book-entry", "50");
    await sb.advance({ seconds: 900 });
    const ca = await sb.call("dtc-ops-1", "POST", "/v1/corporate-actions", { cusip: FAKE_CUSIP, kind: "interest", recordDate: "2027-01-14", payDate: "2027-01-19", rate: { numerator: "1", denominator: "1" } });
    await sb.advance({ to: "2027-01-15T15:00:00Z" });
    const id = String(ca.body["id"]);
    const cap = (await sb.call("dtc-ops-1", "POST", `/v1/corporate-actions/${id}/capture`)).body;
    c.eq((cap["positions"] as { walletId: string }[]).map((p) => p.walletId), [w1], "only the wallet still holding tokens is captured");
    await sb.call("dtc-ops-1", "POST", `/v1/corporate-actions/${id}/pay`);
    c.eq(await sb.tokensOf("sa-birch-1", "SBX-9002", w2 as string), "0", "no automatic re-tokenisation");
    c.note("The sandbox does not model which events DTC supports on tokens; this checks the capture and re-tokenisation half only.");
    return c.done();
  },
  "SC-025": async (ctx) => {
    const c = new Check();
    const sb = sandbox(ctx);
    // Five wallets; clients by position i % 3 -> C-BIRCH-001: 30+20, C-BIRCH-002: 20+10, C-BIRCH-003: 20.
    await fundedBirch(sb, ["30", "20", "20", "20", "10"]);
    const positions = (sb.registry.balancesFor("SBX-9002")["digital"] as { address: string; tokens: bigint }[]).map((d) => ({ address: d.address, tokens: d.tokens }));
    const plan = allocateConsolidatedCredit({
      books: birchBooks(sb.registry),
      positions,
      credit: { participant: "SBX-9002", cusip: FAKE_CUSIP, eventId: "SC-025", eventKind: "interest", recordDate: "2027-01-15", payDate: "2027-01-19", amount: 100003n, currency: "USD", receivedAt: "2027-01-19T15:00:00Z" },
      trust: trustLabel(ctx.profile, ["corporate_actions.cash-credit-consolidated-classic", "wallet.account-model", "corporate_actions.position-capture-8pm-et"]),
    });
    c.eq(plan.lines.map((l) => [l.subLedger, l.tokens.toString(), l.amount.toString()]), [["C-BIRCH-001", "50", "50001"], ["C-BIRCH-002", "30", "30001"], ["C-BIRCH-003", "20", "20001"]], "largest-remainder lines");
    c.eq(plan.lines.reduce((s, l) => s + l.amount, 0n), 100003n, "sum equals credit");
    return c.done({ checksum: plan.checksum });
  },
  "SC-026": async (ctx) => {
    const c = new Check();
    let seed = 7;
    const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648), seed / 2147483648);
    const books: ParticipantBooks = { participant: "P", clients: Array.from({ length: 20 }, (_, i) => ({ clientId: `C${i}` })), wallets: Array.from({ length: 200 }, (_, i) => ({ ledger: "l", address: `W${i}`, kind: "client" as const, clientId: `C${i % 20}` })) };
    const trust = trustLabel(ctx.profile, ["corporate_actions.cash-credit-consolidated-classic"]);
    for (let n = 0; n < 1000; n++) {
      const positions = books.wallets.filter(() => rand() < 0.5).map((w) => ({ address: w.address, tokens: BigInt(Math.floor(rand() * 1e6)) }));
      const total = positions.reduce((s, p) => s + p.tokens, 0n);
      const amount = total === 0n ? 0n : BigInt(Math.floor(rand() * 1e12));
      const credit = { participant: "P", cusip: FAKE_CUSIP, eventId: `E${n}`, eventKind: "interest" as const, recordDate: "2027-01-15", payDate: "2027-01-19", amount, currency: "USD" as const, receivedAt: "2027-01-19T15:00:00Z" };
      const a = allocateConsolidatedCredit({ books, positions, credit, trust });
      const b = allocateConsolidatedCredit({ books, positions: [...positions].reverse(), credit, trust });
      c.that(a.lines.reduce((s, l) => s + l.amount, 0n) === amount, `case ${n}: sum`);
      c.that(a.lines.every((l) => l.amount >= 0n), `case ${n}: negative`);
      c.that(a.checksum === b.checksum, `case ${n}: order dependence`);
      if (c.problems.length) break;
    }
    c.note("1,000 seeded cases here; the unit test runs 10,000 (packages/dtc-kit-reconciliation/test/allocate.test.ts).");
    return c.done();
  },
  "SC-027": async (ctx) => {
    const c = new Check();
    const sb = sandbox(ctx);
    await fundedBirch(sb, ["60", "40"]);
    const alder = await sb.register("sa-alder-1", FAKE_ADDRESSES.alderInternal, "internal");
    await sb.advance({ seconds: 60 });
    await sb.convert("sa-alder-1", alder, "to-token", "25");
    await sb.advance({ seconds: 900 });
    const ca = await sb.call("dtc-ops-1", "POST", "/v1/corporate-actions", { cusip: FAKE_CUSIP, kind: "maturity", recordDate: "2027-01-21", payDate: "2027-01-21", rate: { numerator: "10000", denominator: "1" } });
    await sb.advance({ to: "2027-01-21T15:00:00Z" });
    const id = String(ca.body["id"]);
    await sb.call("dtc-ops-1", "POST", `/v1/corporate-actions/${id}/capture`);
    const pay = (await sb.call("dtc-ops-1", "POST", `/v1/corporate-actions/${id}/pay`)).body;
    c.eq(pay["credits"], [{ participant: "SBX-9001", amount: "250000" }, { participant: "SBX-9002", amount: "1000000" }], "one principal credit per participant ($100.00 per token, sandbox rate)");
    c.eq(sb.registry.snapshot().supply, 0n, "supply after maturity");
    return c.done();
  },
  "SC-028": async (ctx) => {
    const c = new Check();
    const trust = trustLabel(ctx.profile, ["corporate_actions.cash-credit-consolidated-classic"]);
    const books: ParticipantBooks = { participant: "SBX-9002", clients: [{ clientId: "C-BIRCH-001" }], wallets: [{ ledger: "sandbox-ledger", address: "W", kind: "client", clientId: "C-BIRCH-001" }] };
    const credit = { participant: "SBX-9002", cusip: FAKE_CUSIP, eventId: "SC-028", eventKind: "interest" as const, recordDate: "2027-01-15", payDate: "2027-01-19", amount: 12499n, currency: "USD" as const, receivedAt: "2027-01-19T15:00:00Z" };
    const report = reconcile({ books, positions: [{ address: "W", tokens: 100n }], credit, trust }, [{ walletAddress: "W", tokens: 100n }], { rate: { numerator: 125n, denominator: 1n }, trust });
    c.eq(report.breaks.map((b) => [b.code, b.expected, b.actual]), [["CREDIT_MISMATCH", "12500", "12499"]], "break");
    c.eq(report.plan, undefined, "no allocation posted");
    let cas: CashAllocationCase = { id: "SC-028", participant: "SBX-9002", cusip: FAKE_CUSIP, eventKind: "interest", recordDate: "2027-01-15", payDate: "2027-01-19", state: "Announced" };
    for (const e of [{ type: "capture-taken", captureRef: "c" }, { type: "credit-expected", amount: 12500n }, { type: "credit-received", amount: 12499n }] as const) cas = reduceCashAllocation(cas, e, ctx.profile).next;
    c.eq([cas.state, cas.disputeCode], ["Disputed", "CREDIT_MISMATCH"], "case state");
    return c.done();
  },
  "SC-029": async (ctx) => {
    const c = new Check();
    const rec = step(ctx, /^SC-029/);
    c.that(!!rec, "recorded testnet run not provided");
    if (rec) {
      c.eq([rec.successful, rec.resultCodes?.operations], [false, ["op_no_trust"]], "authorising a missing trustline");
      c.evidence.push({ kind: "testnet-recorded", detail: rec.step, ...(rec.ledger ? { ledger: rec.ledger } : {}), hash: rec.hash });
    }
    const sb = sandbox(ctx);
    await sb.call("sim-1", "POST", "/v1/sim/reset", { fixture: "two-wallets-funded" });
    const p = await sb.call("sa-birch-1", "POST", "/v1/transfers/precheck", { fromWallet: "W-1", toAddress: "G-ADDRESS-WITHOUT-TRUSTLINE", tokens: "1" });
    c.eq(p.body["reasons"], ["DEST_NOT_REGISTERED"], "registry precheck");
    return c.done();
  },
  "SC-031": async (ctx) => {
    const c = new Check();
    const rec = step(ctx, /^SC-031/);
    c.that(!!rec, "recorded testnet run not provided");
    if (rec) {
      c.eq([rec.successful, rec.balancesAfter["holderA"]], [true, "9.5000000"], "0.5-token payment on testnet");
      c.evidence.push({ kind: "testnet-recorded", detail: rec.step, ...(rec.ledger ? { ledger: rec.ledger } : {}), hash: rec.hash });
    }
    const sb = sandbox(ctx);
    await sb.call("sim-1", "POST", "/v1/sim/reset", { fixture: "two-wallets-funded" });
    const p = await sb.call("sa-birch-1", "POST", "/v1/transfers/precheck", { fromWallet: "W-1", toAddress: FAKE_ADDRESSES.birchClient2, tokens: "0.5" });
    c.eq(p.body["reasons"], ["FRACTIONAL_QUANTITY"], "registry-side enforcement");
    c.evidence.push({ kind: "sandbox", detail: "registry precheck" });
    return c.done();
  },
  "SC-035": async (ctx) => {
    const c = new Check();
    const now = ctx.now ?? (() => Date.now());
    const books: ParticipantBooks = {
      participant: "P",
      clients: Array.from({ length: 500 }, (_, i) => ({ clientId: `C${String(i).padStart(3, "0")}` })),
      wallets: Array.from({ length: 10_000 }, (_, i) => ({ ledger: "l", address: `W${i}`, kind: "client" as const, clientId: `C${String(i % 500).padStart(3, "0")}` })),
    };
    const positions = books.wallets.map((w, i) => ({ address: w.address, tokens: BigInt(((i * 7919) % 1000) + 1) }));
    const credit = { participant: "P", cusip: FAKE_CUSIP, eventId: "SC-035", eventKind: "interest" as const, recordDate: "2027-01-15", payDate: "2027-01-19", amount: 123_456_789n, currency: "USD" as const, receivedAt: "2027-01-19T15:00:00Z" };
    const t0 = now();
    const plan = allocateConsolidatedCredit({ books, positions, credit, trust: trustLabel(ctx.profile, ["corporate_actions.cash-credit-consolidated-classic"]) });
    const ms = now() - t0;
    c.eq(plan.lines.length, 500, "sub-ledgers");
    c.eq(plan.lines.reduce((s, l) => s + l.amount, 0n), credit.amount, "sum");
    c.that(ms < SC035_BUDGET_MS, `took ${ms.toFixed(1)} ms, budget ${SC035_BUDGET_MS} ms`);
    c.evidence.push({ kind: "measurement", detail: `allocation of 10,000 wallets / 500 clients took ${ms.toFixed(1)} ms in this run` });
    return c.done({ ms: Math.round(ms * 10) / 10 });
  },
};

/**
 * SC-035 budget, set from measurement (DTC-035 spike): on the build machine (4 cores, Node v24.18.0, shared
 * with another build) five cold runs on 2026-11-08 took 91.1, 134.0, 99.4, 128.5 and 125.4 ms [measured];
 * the budget is 1,000 ms, about 7x the slowest observed run, to absorb slower CI and browsers [E].
 */
export const SC035_BUDGET_MS = 1000;
