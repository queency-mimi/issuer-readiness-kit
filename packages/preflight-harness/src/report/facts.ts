// SPDX-License-Identifier: Apache-2.0
// Case drill-down facts for the web report: the parts of a recorded snapshot a reader needs to check a verdict by
// eye (destination account, the relevant trustline, issuer flags, contracts, recorded simulations). Pure: reads only
// the loaded fixture; nothing is inferred that the snapshot does not hold. Missing reads stay explicit ("not recorded").
import { MuxedAccount } from "@stellar/stellar-sdk";
import type { CaseFile, GroundTruth, Provenance, StateSnapshot } from "../types.ts";

export interface AccountFact {
  role: "destination" | "sender" | "issuer";
  address: string;
  /** "missing" = the capture read it and the account does not exist; "not-recorded" = the capture did not read it. */
  status: "funded" | "missing" | "not-recorded";
  /** Native balance in stroops, decimal string. */
  balanceStroops?: string;
  subentryCount?: number;
  flags?: string[];
  memoRequired?: boolean;
  trustline?: {
    asset: string;
    status: "present" | "absent";
    balance?: string;
    limit?: string;
    buyingLiabilities?: string;
    authorized?: boolean;
    authorizedToMaintainLiabilities?: boolean;
    clawbackEnabled?: boolean;
  };
}

export interface ContractFact {
  id: string;
  exists: boolean;
  kind: "sac" | "wasm" | null;
  wraps?: string;
}

export interface SimulationFact {
  call: string;
  ok: boolean;
  contractErrorCode?: number;
  /** First line of the host error, if any. */
  error?: string;
}

export interface CaseFacts {
  caseId: string;
  ledger: number;
  capturedAt: string;
  network: string;
  amount: string;
  asset: string;
  memo?: string;
  rationale: string;
  accounts: AccountFact[];
  contracts: ContractFact[];
  sacBalances: { key: string; amount: string | null; authorized: boolean | null }[];
  simulations: SimulationFact[];
  baseReserveStroops?: string;
  groundTruth: GroundTruth | null;
  provenance: { script: string; urls: string[]; readsAreAtomic: boolean; notes: string } | null;
}

const MEMO_KEY = "config.memo_required";

function baseAccount(address: string): string {
  return address.startsWith("M") ? MuxedAccount.fromAddress(address, "0").baseAccount().accountId() : address;
}

function assetLabel(c: CaseFile): string {
  const a = c.input.asset;
  return a.kind === "native" ? "XLM (native)" : a.kind === "classic" ? `${a.code}:${a.issuer}` : a.contractId;
}

function accountFact(role: AccountFact["role"], address: string, state: StateSnapshot, testCase: CaseFile): AccountFact {
  const id = baseAccount(address);
  if (!(id in state.accounts)) return { role, address, status: "not-recorded" };
  const a = state.accounts[id];
  if (!a) return { role, address, status: "missing" };
  const flags = Object.entries(a.flags).filter(([, v]) => v).map(([k]) => k);
  const memo = a.data[MEMO_KEY];
  const fact: AccountFact = {
    role,
    address,
    status: "funded",
    balanceStroops: a.balance,
    subentryCount: a.subentryCount,
    flags,
    memoRequired: memo !== undefined && Buffer.from(memo, "base64").toString("utf8") === "1",
  };
  const asset = testCase.input.asset;
  if (asset.kind === "classic" && role !== "issuer") {
    const t = a.trustlines.find((l) => l.asset.code === asset.code && l.asset.issuer === asset.issuer);
    const label = `${asset.code}:${asset.issuer}`;
    fact.trustline = t
      ? { asset: label, status: "present", balance: t.balance, limit: t.limit, buyingLiabilities: t.buyingLiabilities, authorized: t.authorized, authorizedToMaintainLiabilities: t.authorizedToMaintainLiabilities, clawbackEnabled: t.clawbackEnabled }
      : { asset: label, status: "absent" };
  }
  return fact;
}

export function caseFacts(testCase: CaseFile, state: StateSnapshot, truth: GroundTruth | undefined, provenance: Provenance | undefined): CaseFacts {
  const { input } = testCase;
  const accounts: AccountFact[] = [];
  const dest = input.destination;
  if (dest.startsWith("G") || dest.startsWith("M")) accounts.push(accountFact("destination", dest, state, testCase));
  if (input.sender && (input.sender.startsWith("G") || input.sender.startsWith("M"))) accounts.push(accountFact("sender", input.sender, state, testCase));
  if (input.asset.kind === "classic" && input.asset.issuer !== baseAccount(dest)) accounts.push(accountFact("issuer", input.asset.issuer, state, testCase));
  const contracts: ContractFact[] = Object.entries(state.contracts).map(([id, c]) => ({
    id,
    exists: c.exists,
    kind: c.kind,
    ...(c.wraps ? { wraps: c.wraps.kind === "native" ? "XLM (native)" : `${c.wraps.code}:${c.wraps.issuer}` } : {}),
  }));
  const sacBalances = Object.entries(state.sacBalances).map(([key, b]) => ({ key, amount: b ? b.amount : null, authorized: b ? b.authorized : null }));
  const simulations: SimulationFact[] = state.simulations.map((s) =>
    s.result.ok
      ? { call: s.call, ok: true }
      : { call: s.call, ok: false, ...(s.result.contractErrorCode !== undefined ? { contractErrorCode: s.result.contractErrorCode } : {}), error: s.result.error.split("\n")[0] ?? "" },
  );
  return {
    caseId: testCase.caseId,
    ledger: state.ledger,
    capturedAt: state.capturedAt,
    network: state.network,
    amount: input.amount,
    asset: assetLabel(testCase),
    ...(input.memo ? { memo: `${input.memo.type}:${input.memo.value}` } : {}),
    rationale: testCase.expected.rationale,
    accounts,
    contracts,
    sacBalances,
    simulations,
    ...(state.networkParams ? { baseReserveStroops: state.networkParams.baseReserveStroops } : {}),
    groundTruth: truth ?? null,
    provenance: provenance ? { script: provenance.script, urls: provenance.source.urls, readsAreAtomic: provenance.readsAreAtomic ?? true, notes: provenance.notes } : null,
  };
}
