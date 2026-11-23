// SPDX-License-Identifier: Apache-2.0
import {
  InvalidTransition,
  captureInstant,
  insideProcessingWindow,
  isFractional,
  precheckTransfer,
  reduceConversion,
  reduceForceTransfer,
  reduceWallet,
  requestForceTransfer,
  submitConversionOrder,
  summariseRootWalletUses,
  trustLabel,
  validateRegistration,
  zonedParts,
} from "@sik/dtc-kit-core";
import type {
  ChainActionPlan,
  ChainAdapter,
  ConversionEvent,
  ConversionOrder,
  CoreEffect,
  ForceTransfer,
  ForceTransferReason,
  PrecheckResult,
  Reduction,
  RootWalletUse,
  TrustLabel,
  WalletEvent,
  WalletRecord,
} from "@sik/dtc-kit-core";
import type { ResolvedProfile } from "@sik/dtc-kit-profile-spec/pure";
import type { CreateConversionOrderRequest, ForceTransferRequest, PrecheckRequest, RegisterWalletRequest } from "./api.ts";
import { CLIENTS, FAKE_ADDRESSES, FAKE_CUSIP, PARTICIPANTS } from "./institutions.ts";
import { SandboxLedgerAdapter } from "./sandbox-adapter.ts";

/** Sandbox constants (NOT DTC's): async delays and the fixed start of the simulated clock. */
export const SANDBOX_TIMING = {
  /** Wednesday 2027-01-13 10:00 America/New_York: inside the processing window, so runs are reproducible. */
  clockStart: "2027-01-13T15:00:00.000Z",
  ofacScreenSeconds: 30,
  allowlistConfirmSeconds: 30,
  /** DTCC's published target is "15 minutes or less" (row operations.transfer-and-processing-hours). */
  conversionSeconds: 600,
  outOfHoursRecheckSeconds: 900,
  /** Book-entry shares every fictional participant starts with in the fixtures. */
  seededClassicShares: 1000n,
} as const;

export const SANDBOX_LEDGERS = ["sandbox-ledger", "sandbox-ledger-b"] as const;

/** An error the HTTP layer turns into a response. */
export class ApiFailure extends Error {
  readonly status: number;
  readonly code: string;
  readonly extra: Record<string, unknown>;

  constructor(status: number, code: string, message: string, extra: Record<string, unknown> = {}) {
    super(`${code}: ${message}`);
    this.name = "ApiFailure";
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

export type Principal = { role: "participant"; participant: string; clientId: string } | { role: "dtc-ops" | "sim"; clientId: string };

export interface RegistryOptions {
  profile: ResolvedProfile;
  /** Chain adapter asked for a plan on every chain effect. Default: the in-memory SandboxLedgerAdapter. */
  adapter?: ChainAdapter;
}

export interface ActivityRow {
  seq: number;
  at: string;
  type: string;
  walletId: string | null;
  address: string | null;
  cusip: string;
  quantity: string;
  counterparty: string | null;
  ref: string | null;
}

export interface RecordedPlan extends ChainActionPlan {
  seq: number;
  at: string;
  ref: string;
}

interface CapturedLine {
  walletId: string;
  participant: string;
  address: string;
  ledger: string;
  kind: "internal" | "client";
  clientId: string | null;
  tokens: bigint;
}

export interface CorporateAction {
  id: string;
  cusip: string;
  kind: "interest" | "maturity";
  recordDate: string;
  payDate: string;
  /** Cash in minor units (USD cents) per token, as an exact fraction. */
  rate: { numerator: bigint; denominator: bigint };
  captureAt: string;
  status: "Announced" | "Captured" | "Paid";
  positions: CapturedLine[];
  credits: { participant: string; amount: bigint }[];
  burned: bigint;
  trust: TrustLabel;
}

interface Job {
  due: number;
  seq: number;
  run: () => void;
}

export const WALLET_COLUMNS = ["id", "participant", "ledger", "address", "kind", "clientId", "status", "ofacCleared", "onChainAllowlisted", "statusBeforeControl"] as const;
export const ORDER_COLUMNS = ["id", "participant", "wallet", "walletAddress", "ledger", "cusip", "direction", "tokens", "status", "createdAt", "maker", "reasonCode"] as const;
export const DIGITAL_COLUMNS = ["walletId", "address", "ledger", "kind", "clientId", "cusip", "tokens"] as const;
export const ACTIVITY_COLUMNS = ["seq", "at", "type", "walletId", "address", "cusip", "quantity", "counterparty", "ref"] as const;

const project = <T extends object>(o: T, columns: readonly string[]): Record<string, unknown> =>
  Object.fromEntries(columns.map((c) => [c, (o as Record<string, unknown>)[c] ?? null]));

const WHOLE = /^\s*\d+(\.0+)?\s*$/;
const parseQuantity = (raw: unknown, field = "tokens"): { raw: string; tokens: bigint } => {
  if (typeof raw !== "string" || !/^\s*\d+(\.\d+)?\s*$/.test(raw)) {
    throw new ApiFailure(422, "VALIDATION", `${field} must be a decimal string such as "10"`);
  }
  return { raw, tokens: WHOLE.test(raw) ? BigInt(raw.trim().split(".")[0] ?? "0") : 0n };
};

/**
 * In-memory mock DTC registry (SPEC 4). Holds wallets, orders, a sandbox token ledger, classic positions,
 * cash, activity and a simulated clock. It composes the core reducers and contains no DTC rule of its own:
 * every decision comes from `@sik/dtc-kit-core` reading the profile. Deterministic: sequential ids, no
 * randomness, no wall clock. DTC-shaped, not DTC-certified; fictional institutions; not the DTCC API.
 */
export class MockDtcRegistry {
  readonly options: RegistryOptions;
  readonly profile: ResolvedProfile;
  readonly adapter: ChainAdapter;

  private now = 0;
  private seq = new Map<string, number>();
  private jobs: Job[] = [];
  private wallets = new Map<string, WalletRecord>();
  private walletByAddress = new Map<string, string>();
  private balances = new Map<string, bigint>();
  private classic = new Map<string, bigint>();
  private cash = new Map<string, bigint>();
  private orders = new Map<string, ConversionOrder>();
  private forceTransfers = new Map<string, ForceTransfer>();
  private rootUses: RootWalletUse[] = [];
  private activityLog: (ActivityRow & { participant: string })[] = [];
  private planLog: RecordedPlan[] = [];
  private auditLog: { at: string; message: string; data?: Record<string, string> }[] = [];
  private corporateActions = new Map<string, CorporateAction>();

  constructor(options: RegistryOptions) {
    this.options = options;
    this.profile = options.profile;
    this.adapter = options.adapter ?? new SandboxLedgerAdapter();
    this.reset("empty");
  }

  // ---------- clock, ids, jobs ----------

  nowIso(): string {
    return new Date(this.now).toISOString();
  }

  private nextId(prefix: string): string {
    const n = (this.seq.get(prefix) ?? 0) + 1;
    this.seq.set(prefix, n);
    return `${prefix}-${n}`;
  }

  private schedule(seconds: number, run: () => void): void {
    const n = (this.seq.get("job") ?? 0) + 1;
    this.seq.set("job", n);
    this.jobs.push({ due: this.now + seconds * 1000, seq: n, run });
  }

  /** Advance simulated time (by seconds or to an instant) and run every due job in time order. */
  advance(arg: { seconds?: number; to?: string }): { now: string; ran: number } {
    const target = arg.to !== undefined ? Date.parse(arg.to) : this.now + (arg.seconds ?? 0) * 1000;
    if (!Number.isFinite(target) || target < this.now) throw new ApiFailure(422, "VALIDATION", "advance needs seconds >= 0 or a future instant `to`");
    let ran = 0;
    for (;;) {
      const due = this.jobs.filter((j) => j.due <= target).sort((a, b) => a.due - b.due || a.seq - b.seq)[0];
      if (!due) break;
      this.jobs = this.jobs.filter((j) => j !== due);
      this.now = Math.max(this.now, due.due);
      due.run();
      ran += 1;
    }
    this.now = target;
    return { now: this.nowIso(), ran };
  }

  // ---------- fixtures ----------

  reset(fixture: "empty" | "two-wallets-funded"): Record<string, unknown> {
    this.now = Date.parse(SANDBOX_TIMING.clockStart);
    this.seq = new Map();
    this.jobs = [];
    this.wallets = new Map();
    this.walletByAddress = new Map();
    this.balances = new Map();
    this.classic = new Map(PARTICIPANTS.map((p) => [`${p.id}|${FAKE_CUSIP}`, SANDBOX_TIMING.seededClassicShares]));
    this.cash = new Map(PARTICIPANTS.map((p) => [p.id, 0n]));
    this.orders = new Map();
    this.forceTransfers = new Map();
    this.rootUses = [];
    this.activityLog = [];
    this.planLog = [];
    this.auditLog = [];
    this.corporateActions = new Map();
    if (fixture === "empty") return { fixture };
    if (fixture !== "two-wallets-funded") throw new ApiFailure(422, "VALIDATION", `unknown fixture ${String(fixture)}`);
    const seed = (address: string, clientId: string, tokens: bigint): string => {
      const id = this.nextId("W");
      const w: WalletRecord = { id, participant: "SBX-9002", ledger: "sandbox-ledger", address, kind: "client", clientId, status: "Completed", ofacCleared: true, onChainAllowlisted: true };
      this.wallets.set(id, w);
      this.walletByAddress.set(`${w.ledger}|${address}`, id);
      this.balances.set(`${w.ledger}|${address}`, tokens);
      return id;
    };
    const source = seed(FAKE_ADDRESSES.birchClient1, "C-BIRCH-001", 100n);
    const destination = seed(FAKE_ADDRESSES.birchClient2, "C-BIRCH-002", 0n);
    this.classic.set(`SBX-9002|${FAKE_CUSIP}`, SANDBOX_TIMING.seededClassicShares - 100n);
    return { fixture, sourceWalletId: source, destinationWalletId: destination };
  }

  // ---------- auth ----------

  principalFor(clientId: string): Principal | undefined {
    const p = PARTICIPANTS.find((x) => x.serviceAccountId === clientId);
    if (p) return { role: "participant", participant: p.id, clientId };
    if (clientId === "dtc-ops-1") return { role: "dtc-ops", clientId };
    if (clientId === "sim-1") return { role: "sim", clientId };
    return undefined;
  }

  // ---------- effects ----------

  private record(plan: ChainActionPlan, ref: string): void {
    this.planLog.push({ ...plan, seq: this.planLog.length + 1, at: this.nowIso(), ref });
  }

  private activity(participant: string, row: Omit<ActivityRow, "seq" | "at" | "cusip"> & { cusip?: string }): void {
    this.activityLog.push({ participant, seq: this.activityLog.length + 1, at: this.nowIso(), cusip: FAKE_CUSIP, ...row });
  }

  private walletAt(ledger: string, address: string): WalletRecord | undefined {
    const id = this.walletByAddress.get(`${ledger}|${address}`);
    return id ? this.wallets.get(id) : undefined;
  }

  private balance(ledger: string, address: string): bigint {
    return this.balances.get(`${ledger}|${address}`) ?? 0n;
  }

  private addBalance(ledger: string, address: string, delta: bigint): void {
    this.balances.set(`${ledger}|${address}`, this.balance(ledger, address) + delta);
  }

  /** Perform core effects. Chain effects are also planned by the adapter and recorded (SPEC 4.3 chain mode). */
  private apply(effects: readonly CoreEffect[], ref: string): void {
    for (const e of effects) {
      switch (e.kind) {
        case "allowlist-add": {
          this.record(this.adapter.planAllowlistAdd({ ledger: e.ledger, address: e.address, cusip: FAKE_CUSIP }), ref);
          this.schedule(SANDBOX_TIMING.allowlistConfirmSeconds, () => {
            const w = this.walletAt(e.ledger, e.address);
            if (w && w.status === "Processing") this.applyWallet(w, { type: "onchain-allowlist-confirmed" });
          });
          break;
        }
        case "allowlist-remove":
          this.record(this.adapter.planAllowlistRemove({ ledger: e.ledger, address: e.address, cusip: FAKE_CUSIP }), ref);
          break;
        case "restrict":
        case "unrestrict": {
          const req = { ledger: e.ledger, address: e.address, cusip: FAKE_CUSIP };
          this.record(e.kind === "restrict" ? this.adapter.planRestrict({ ...req, inbound: e.inbound, outbound: e.outbound }) : this.adapter.planUnrestrict(req), ref);
          const w = this.walletAt(e.ledger, e.address);
          if (w) this.activity(w.participant, { type: e.kind === "restrict" ? "Freeze" : "Unfreeze", walletId: w.id, address: w.address, quantity: "0", counterparty: null, ref });
          break;
        }
        case "mint": {
          this.record(this.adapter.planMint({ ledger: e.ledger, address: e.to, cusip: e.cusip, tokens: e.tokens }), ref);
          this.addBalance(e.ledger, e.to, e.tokens);
          const w = this.walletAt(e.ledger, e.to);
          if (w) this.activity(w.participant, { type: "Mint", walletId: w.id, address: w.address, quantity: e.tokens.toString(), counterparty: "DTC", ref });
          break;
        }
        case "burn": {
          this.record(this.adapter.planBurn({ ledger: e.ledger, address: e.from, cusip: e.cusip, tokens: e.tokens }), ref);
          this.addBalance(e.ledger, e.from, -e.tokens);
          const w = this.walletAt(e.ledger, e.from);
          if (w) this.activity(w.participant, { type: "Burn", walletId: w.id, address: w.address, quantity: e.tokens.toString(), counterparty: "DTC", ref });
          break;
        }
        case "force-transfer": {
          this.addBalance(e.ledger, e.from, -e.tokens);
          this.addBalance(e.ledger, e.to, e.tokens);
          const from = this.walletAt(e.ledger, e.from);
          const to = this.walletAt(e.ledger, e.to);
          if (from) this.activity(from.participant, { type: "Force Transfer Out", walletId: from.id, address: from.address, quantity: e.tokens.toString(), counterparty: e.to, ref });
          if (to) this.activity(to.participant, { type: "Force Transfer In", walletId: to.id, address: to.address, quantity: e.tokens.toString(), counterparty: e.from, ref });
          break;
        }
        case "classic-position": {
          const key = `${e.participant}|${e.cusip}`;
          this.classic.set(key, (this.classic.get(key) ?? 0n) + e.shares);
          break;
        }
        case "credit-classic": {
          this.cash.set(e.participant, (this.cash.get(e.participant) ?? 0n) + e.amount);
          this.activity(e.participant, { type: "Cash Credit", walletId: null, address: null, quantity: e.amount.toString(), counterparty: "DTC", ref: e.ref });
          break;
        }
        case "root-wallet-use":
          this.rootUses.push({ at: this.nowIso(), ledger: e.ledger, reason: e.reason as ForceTransferReason, transferId: e.transferId });
          break;
        case "audit":
          this.auditLog.push({ at: this.nowIso(), message: e.message, ...(e.data ? { data: e.data } : {}) });
          break;
      }
    }
  }

  private applyWallet(w: WalletRecord, event: WalletEvent): Reduction<WalletRecord> {
    const r = reduceWallet(w, event, this.profile);
    this.wallets.set(w.id, r.next);
    this.apply(r.effects, w.id);
    return r;
  }

  // ---------- wallets ----------

  registerWallet(participant: string | undefined, req: RegisterWalletRequest): WalletRecord {
    const request = { participant: participant ?? "", ledger: req?.ledger, address: req?.address, kind: req?.kind, ...(req?.clientId ? { clientId: req.clientId } : {}) };
    const v = validateRegistration(request, this.profile, {
      isParticipant: (id) => PARTICIPANTS.some((p) => p.id === id),
      clientExists: (p, c) => CLIENTS.some((x) => x.participant === p && x.clientId === c),
      isRegistered: (ledger, address) => this.walletByAddress.has(`${ledger}|${address}`),
    });
    if (!v.ok) {
      const status = v.code === "NOT_A_PARTICIPANT" ? 403 : v.code === "ALREADY_REGISTERED" ? 409 : 422;
      throw new ApiFailure(status, v.code, v.message, { trust: v.trust });
    }
    const id = this.nextId("W");
    const w: WalletRecord = { id, participant: request.participant, ledger: request.ledger, address: request.address, kind: request.kind, ...(request.clientId ? { clientId: request.clientId } : {}), status: "Processing", ofacCleared: false, onChainAllowlisted: false };
    this.wallets.set(id, w);
    this.walletByAddress.set(`${w.ledger}|${w.address}`, id);
    this.activity(w.participant, { type: "Wallet Registered", walletId: id, address: w.address, quantity: "0", counterparty: null, ref: id });
    this.schedule(SANDBOX_TIMING.ofacScreenSeconds, () => {
      const cur = this.wallets.get(id);
      if (!cur || cur.status !== "Processing") return;
      const sanctioned = CLIENTS.some((c) => c.clientId === cur.clientId && c.sandboxSanctionsListId !== undefined);
      this.applyWallet(cur, sanctioned ? { type: "ofac-failed", detail: "sandbox sanctions list SBX-SDN-0001 (fictional)" } : { type: "ofac-passed" });
    });
    return w;
  }

  private ownWallet(participant: string, id: string): WalletRecord {
    const w = this.wallets.get(id);
    if (!w || w.participant !== participant) throw new ApiFailure(404, "NOT_FOUND", `wallet ${id}`);
    return w;
  }

  wallet(participant: string, id: string): Record<string, unknown> {
    return project(this.ownWallet(participant, id), WALLET_COLUMNS);
  }

  listWallets(participant: string): Record<string, unknown>[] {
    return [...this.wallets.values()].filter((w) => w.participant === participant).map((w) => project(w, WALLET_COLUMNS));
  }

  balancesFor(participant: string): Record<string, unknown> {
    const digital = [...this.wallets.values()]
      .filter((w) => w.participant === participant)
      .map((w) => project({ walletId: w.id, address: w.address, ledger: w.ledger, kind: w.kind, clientId: w.clientId, cusip: FAKE_CUSIP, tokens: this.balance(w.ledger, w.address) }, DIGITAL_COLUMNS));
    return {
      participant,
      asOf: this.nowIso(),
      classic: [{ cusip: FAKE_CUSIP, shares: this.classic.get(`${participant}|${FAKE_CUSIP}`) ?? 0n }],
      digital,
      cash: { currency: "USD", amountMinorUnits: this.cash.get(participant) ?? 0n },
    };
  }

  activityFor(participant: string): Record<string, unknown>[] {
    return this.activityLog.filter((a) => a.participant === participant).map((a) => project(a, ACTIVITY_COLUMNS));
  }

  // ---------- conversion orders ----------

  private scheduleCompletion(orderId: string, seconds: number): void {
    this.schedule(seconds, () => {
      const o = this.orders.get(orderId);
      if (!o || o.status !== "Processing") return;
      if (!insideProcessingWindow(this.nowIso(), this.profile)) {
        this.applyOrder(o, { type: "outside-processing-hours" });
        this.scheduleCompletion(orderId, SANDBOX_TIMING.outOfHoursRecheckSeconds);
        return;
      }
      const w = this.wallets.get(o.wallet);
      if (!w || w.status !== "Completed") return void this.applyOrder(o, { type: "onchain-reverted", detail: "wallet not Completed when the chain action ran" });
      if (o.direction === "to-book-entry" && this.balance(o.ledger, o.walletAddress) < o.tokens) {
        return void this.applyOrder(o, { type: "onchain-reverted", detail: "insufficient tokens at burn time" });
      }
      this.applyOrder(o, { type: "onchain-confirmed" });
    });
  }

  private applyOrder(o: ConversionOrder, event: ConversionEvent): Reduction<ConversionOrder> {
    const r = reduceConversion(o, event, this.profile);
    this.orders.set(o.id, r.next);
    this.apply(r.effects, o.id);
    if (o.status !== "Processing" && r.next.status === "Processing") this.scheduleCompletion(o.id, SANDBOX_TIMING.conversionSeconds);
    return r;
  }

  createConversionOrder(participant: string, req: CreateConversionOrderRequest & { makerChecker?: boolean; maker?: string }): { order: Record<string, unknown>; declined: boolean; trust: TrustLabel } {
    if (req?.direction !== "to-token" && req?.direction !== "to-book-entry") throw new ApiFailure(422, "VALIDATION", "direction must be to-token or to-book-entry");
    if (req.cusip !== FAKE_CUSIP) throw new ApiFailure(422, "VALIDATION", `unknown cusip (the sandbox has only ${FAKE_CUSIP})`);
    if (typeof req.tokens !== "string") throw new ApiFailure(422, "VALIDATION", "tokens must be a string");
    const w = this.ownWallet(participant, req.wallet);
    const r = submitConversionOrder(
      {
        id: this.nextId("ORD"),
        participant,
        wallet: w,
        cusip: req.cusip,
        direction: req.direction,
        rawQuantity: req.tokens,
        makerChecker: req.makerChecker === true,
        ...(req.maker !== undefined ? { maker: req.maker } : {}),
        availableTokens: this.balance(w.ledger, w.address),
        createdAt: this.nowIso(),
      },
      this.profile,
    );
    this.orders.set(r.next.id, r.next);
    this.apply(r.effects, r.next.id);
    if (r.next.status === "Processing") this.scheduleCompletion(r.next.id, SANDBOX_TIMING.conversionSeconds);
    if (r.next.direction === "to-token" && r.next.status === "Processing") {
      this.activity(participant, { type: "Conversion To Token", walletId: w.id, address: w.address, quantity: r.next.tokens.toString(), counterparty: null, ref: r.next.id });
    }
    return { order: project(r.next, ORDER_COLUMNS), declined: r.next.status === "Declined", trust: r.trust };
  }

  private ownOrder(participant: string, id: string): ConversionOrder {
    const o = this.orders.get(id);
    if (!o || o.participant !== participant) throw new ApiFailure(404, "NOT_FOUND", `order ${id}`);
    return o;
  }

  order(participant: string, id: string): Record<string, unknown> {
    return project(this.ownOrder(participant, id), ORDER_COLUMNS);
  }

  listOrders(participant: string): Record<string, unknown>[] {
    return [...this.orders.values()].filter((o) => o.participant === participant).map((o) => project(o, ORDER_COLUMNS));
  }

  approveOrder(participant: string, id: string, checker: unknown): Record<string, unknown> {
    if (typeof checker !== "string" || checker === "") throw new ApiFailure(422, "VALIDATION", "checker is required");
    const r = this.applyOrder(this.ownOrder(participant, id), { type: "approve", checker });
    return project(r.next, ORDER_COLUMNS);
  }

  // ---------- transfers ----------

  private intentFor(participant: string, req: PrecheckRequest) {
    const from = this.ownWallet(participant, req?.fromWallet);
    if (typeof req.toAddress !== "string") throw new ApiFailure(422, "VALIDATION", "toAddress is required");
    const q = parseQuantity(req.tokens);
    const toLedger = req.toLedger ?? from.ledger;
    const to = this.walletAt(toLedger, req.toAddress);
    return { from, to, toLedger, q };
  }

  precheck(participant: string, req: PrecheckRequest): PrecheckResult {
    const { from, to, toLedger, q } = this.intentFor(participant, req);
    return precheckTransfer(
      { from, to, tokens: q.tokens, rawQuantity: q.raw, at: this.nowIso(), ...(toLedger !== from.ledger ? { toLedger } : {}) },
      this.profile,
      { dtcLedgers: SANDBOX_LEDGERS },
    );
  }

  transfer(participant: string, req: PrecheckRequest): Record<string, unknown> {
    const check = this.precheck(participant, req);
    if (!check.allowed) throw new ApiFailure(409, check.reasons[0] ?? "REFUSED", `transfer refused: ${check.reasons.join(", ")}`, { reasons: check.reasons, trust: check.trust });
    const { from, to, toLedger, q } = this.intentFor(participant, req);
    if (!to) throw new ApiFailure(409, "DEST_NOT_REGISTERED", "destination not registered");
    if (isFractional(q.raw) || q.tokens <= 0n) throw new ApiFailure(422, "VALIDATION", "tokens must be a positive whole number");
    if (this.balance(from.ledger, from.address) < q.tokens) throw new ApiFailure(409, "INSUFFICIENT_TOKENS", `wallet ${from.id} holds fewer than ${q.tokens} tokens`);
    const ref = this.nextId("TX");
    this.addBalance(from.ledger, from.address, -q.tokens);
    this.addBalance(toLedger, to.address, q.tokens);
    const crossNetwork = toLedger !== from.ledger;
    this.activity(from.participant, { type: crossNetwork ? "Cross-Network Burn" : "Payment", walletId: from.id, address: from.address, quantity: q.tokens.toString(), counterparty: to.address, ref });
    this.activity(to.participant, { type: crossNetwork ? "Cross-Network Mint" : "Payment Received", walletId: to.id, address: to.address, quantity: q.tokens.toString(), counterparty: from.address, ref });
    return { id: ref, from: from.id, to: to.id, tokens: q.tokens, crossNetwork, trust: check.trust };
  }

  // ---------- DTC override ----------

  forceTransfer(req: ForceTransferRequest): ForceTransfer & { trust: TrustLabel } {
    const from = this.wallets.get(req?.fromWallet);
    if (!from) throw new ApiFailure(404, "NOT_FOUND", `wallet ${String(req?.fromWallet)}`);
    if (typeof req.toAddress !== "string") throw new ApiFailure(422, "VALIDATION", "toAddress is required");
    const q = parseQuantity(req.tokens);
    if (isFractional(q.raw)) throw new ApiFailure(422, "FRACTIONAL_QUANTITY", "tokens must be whole");
    const asked = requestForceTransfer(
      { id: this.nextId("FT"), from, to: this.walletAt(from.ledger, req.toAddress), toAddress: req.toAddress, cusip: FAKE_CUSIP, tokens: q.tokens, reason: req.reason, requestedAt: this.nowIso() },
      this.profile,
    );
    if (!asked.ok) throw new ApiFailure(asked.code.startsWith("DEST_") ? 409 : 422, asked.code, `force transfer refused: ${asked.code}`, { trust: asked.trust });
    if (this.balance(from.ledger, from.address) < q.tokens) throw new ApiFailure(409, "INSUFFICIENT_TOKENS", `wallet ${from.id} holds fewer than ${q.tokens} tokens`);
    let t = reduceForceTransfer(asked.transfer, { type: "plan", adapter: this.adapter }, this.profile).next;
    if (t.plan) this.record(t.plan, t.id);
    t = reduceForceTransfer(t, { type: "submitted", txRef: `sandbox-${t.id}` }, this.profile).next;
    const done = reduceForceTransfer(t, { type: "confirmed" }, this.profile);
    this.forceTransfers.set(t.id, done.next);
    this.apply(done.effects, t.id);
    return { ...done.next, trust: done.trust };
  }

  rootWalletUses(): Record<string, unknown> {
    const p = zonedParts(this.now, "America/New_York");
    const qMonth = Math.floor((p.month - 1) / 3) * 3 + 1;
    const quarterStart = `${p.year}-${String(qMonth).padStart(2, "0")}-01`;
    const { total = 0, ...byReason } = summariseRootWalletUses(this.rootUses, quarterStart);
    return { quarterStart, total, byReason, uses: this.rootUses, trust: trustLabel(this.profile, ["compliance.quarterly-sec-report-counts", "authorities.dtc-override-root-wallet"]) };
  }

  // ---------- sim hooks ----------

  control(walletId: string, control: unknown): Record<string, unknown> {
    const w = this.wallets.get(walletId);
    if (!w) throw new ApiFailure(404, "NOT_FOUND", `wallet ${walletId}`);
    const events: Record<string, WalletEvent> = {
      "delivery-order-chill": { type: "delivery-order-chill" },
      "global-lock": { type: "global-lock" },
      "compliance-lock": { type: "compliance-lock", source: "dtc-ops" },
      release: { type: "release-control" },
    };
    const event = typeof control === "string" ? events[control] : undefined;
    if (!event) throw new ApiFailure(422, "VALIDATION", `control must be one of ${Object.keys(events).join(", ")}`);
    const r = this.applyWallet(w, event);
    return { ...project(r.next, WALLET_COLUMNS), trust: r.trust };
  }

  plans(): RecordedPlan[] {
    return this.planLog;
  }

  audit(): readonly { at: string; message: string; data?: Record<string, string> }[] {
    return this.auditLog;
  }

  // ---------- corporate actions ----------

  createCorporateAction(req: { cusip?: unknown; kind?: unknown; recordDate?: unknown; payDate?: unknown; rate?: { numerator?: unknown; denominator?: unknown }; holidays?: unknown }): CorporateAction {
    if (req?.cusip !== FAKE_CUSIP) throw new ApiFailure(422, "VALIDATION", `unknown cusip (the sandbox has only ${FAKE_CUSIP})`);
    if (req.kind !== "interest" && req.kind !== "maturity") throw new ApiFailure(422, "VALIDATION", "kind must be interest or maturity");
    if (typeof req.recordDate !== "string" || typeof req.payDate !== "string") throw new ApiFailure(422, "VALIDATION", "recordDate and payDate are required");
    const num = req.rate?.numerator;
    const den = req.rate?.denominator;
    if (typeof num !== "string" || typeof den !== "string" || !/^\d+$/.test(num) || !/^[1-9]\d*$/.test(den)) {
      throw new ApiFailure(422, "VALIDATION", "rate is {numerator, denominator} as integer strings (cents per token)");
    }
    const holidays = Array.isArray(req.holidays) ? req.holidays.filter((h): h is string => typeof h === "string") : [];
    let cap: ReturnType<typeof captureInstant>;
    try {
      cap = captureInstant(req.recordDate, req.kind, this.profile, { holidays });
    } catch (e) {
      throw new ApiFailure(422, "VALIDATION", (e as Error).message);
    }
    const ca: CorporateAction = {
      id: this.nextId("CA"),
      cusip: FAKE_CUSIP,
      kind: req.kind,
      recordDate: cap.recordDate,
      payDate: req.payDate,
      rate: { numerator: BigInt(num), denominator: BigInt(den) },
      captureAt: cap.at,
      status: "Announced",
      positions: [],
      credits: [],
      burned: 0n,
      trust: trustLabel(this.profile, ["corporate_actions.position-capture-8pm-et", "corporate_actions.cash-credit-consolidated-classic", "corporate_actions.phase1-scope"]),
    };
    this.corporateActions.set(ca.id, ca);
    const due = (Date.parse(cap.at) - this.now) / 1000;
    if (due < 0) throw new ApiFailure(422, "VALIDATION", `capture instant ${cap.at} is in the sandbox past`);
    this.schedule(due, () => {
      ca.positions = [...this.wallets.values()]
        .map((w) => ({ walletId: w.id, participant: w.participant, address: w.address, ledger: w.ledger, kind: w.kind, clientId: w.clientId ?? null, tokens: this.balance(w.ledger, w.address) }))
        .filter((l) => l.tokens > 0n);
      ca.status = "Captured";
    });
    return ca;
  }

  private ca(id: string): CorporateAction {
    const ca = this.corporateActions.get(id);
    if (!ca) throw new ApiFailure(404, "NOT_FOUND", `corporate action ${id}`);
    return ca;
  }

  capture(id: string): Record<string, unknown> {
    const ca = this.ca(id);
    if (ca.status === "Announced") throw new ApiFailure(409, "CAPTURE_NOT_YET", `positions are captured at ${ca.captureAt}; sandbox clock is ${this.nowIso()}`, { captureAt: ca.captureAt });
    return { id: ca.id, capturedAt: ca.captureAt, positions: ca.positions, trust: ca.trust };
  }

  /** Entitlement per participant, rounded half-up to a cent: ONE consolidated credit each. */
  private entitlements(ca: CorporateAction): Map<string, bigint> {
    const tokens = new Map<string, bigint>();
    for (const l of ca.positions) tokens.set(l.participant, (tokens.get(l.participant) ?? 0n) + l.tokens);
    const { numerator: n, denominator: d } = ca.rate;
    return new Map([...tokens].map(([p, t]) => [p, (2n * t * n + d) / (2n * d)]));
  }

  pay(id: string): Record<string, unknown> {
    const ca = this.ca(id);
    if (ca.status === "Announced") throw new ApiFailure(409, "CAPTURE_NOT_YET", "capture first");
    if (ca.status === "Paid") throw new ApiFailure(409, "ALREADY_PAID", `${id} was paid`);
    const credits = [...this.entitlements(ca)].sort(([a], [b]) => (a < b ? -1 : 1)).map(([participant, amount]) => ({ participant, amount }));
    const effects: CoreEffect[] = credits.map((c) => ({ kind: "credit-classic", participant: c.participant, amount: c.amount, currency: "USD", ref: ca.id }));
    if (ca.kind === "maturity") {
      for (const w of this.wallets.values()) {
        const held = this.balance(w.ledger, w.address);
        if (held > 0n) {
          effects.push({ kind: "burn", ledger: w.ledger, from: w.address, tokens: held, cusip: ca.cusip });
          ca.burned += held;
        }
      }
    }
    this.apply(effects, ca.id);
    ca.credits = credits;
    ca.status = "Paid";
    return { id: ca.id, kind: ca.kind, credits, burned: ca.burned, trust: ca.trust };
  }

  corporateActionFor(participant: string, id: string): Record<string, unknown> {
    const ca = this.ca(id);
    const own = ca.positions.filter((l) => l.participant === participant).map(({ walletId, address, ledger, kind, clientId, tokens }) => ({ walletId, address, ledger, kind, clientId, tokens }));
    const credit = ca.credits.find((c) => c.participant === participant)?.amount ?? null;
    return { id: ca.id, cusip: ca.cusip, kind: ca.kind, recordDate: ca.recordDate, payDate: ca.payDate, rate: ca.rate, captureAt: ca.captureAt, status: ca.status, positions: own, credit, trust: ca.trust };
  }

  /** Programmatic access for tests and the demo-data script. */
  snapshot(): { now: string; wallets: WalletRecord[]; supply: bigint } {
    let supply = 0n;
    for (const v of this.balances.values()) supply += v;
    return { now: this.nowIso(), wallets: [...this.wallets.values()], supply };
  }

  /** Map a thrown reducer error to the API's shape. */
  static toFailure(e: unknown): ApiFailure {
    if (e instanceof ApiFailure) return e;
    if (e instanceof InvalidTransition) return new ApiFailure(409, "INVALID_TRANSITION", e.message, { from: e.from, event: e.event });
    return new ApiFailure(500, "INTERNAL", e instanceof Error ? e.message : String(e));
  }
}
