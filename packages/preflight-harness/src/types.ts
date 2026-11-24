// SPDX-License-Identifier: Apache-2.0
// Normative shapes: SPEC.md sections 2 (fixtures), 4 (verdict), 5 (adapters). JSON Schemas in schemas/.
import type { ReasonCode, Severity } from "./taxonomy/codes.ts";

export type NetworkName = "testnet" | "mainnet";
export const PASSPHRASE: Record<NetworkName, string> = {
  testnet: "Test SDF Network ; September 2015",
  mainnet: "Public Global Stellar Network ; September 2015",
};

export type AssetRef =
  | { kind: "native" }
  | { kind: "classic"; code: string; issuer: string }
  /** A contract id: a SAC (resolved from the snapshot) or a custom SEP-41/SEP-57 token. */
  | { kind: "contract"; contractId: string };

export interface MemoInput {
  type: "text" | "id" | "hash";
  value: string;
}

export interface CaseInput {
  network: NetworkName;
  /** As a user would paste it: G, M, C or name*domain. Never a secret seed (PFH_E_FIXTURE_SECRET). */
  destination: string;
  asset: AssetRef;
  /** Decimal string in asset units, at most 7 decimals. */
  amount: string;
  sender?: string;
  memo?: MemoInput;
}

// ---- state snapshot (library-neutral, replayed into each library's injection point) ----

export interface TrustlineState {
  asset: { code: string; issuer: string };
  /** Stroops, decimal string. */
  balance: string;
  limit: string;
  buyingLiabilities: string;
  sellingLiabilities: string;
  authorized: boolean;
  authorizedToMaintainLiabilities: boolean;
  clawbackEnabled: boolean;
}

export interface AccountState {
  /** Native balance in stroops. */
  balance: string;
  subentryCount: number;
  numSponsoring: number;
  numSponsored: number;
  flags: { authRequired: boolean; authRevocable: boolean; authImmutable: boolean; clawbackEnabled: boolean };
  /** Data entries, values base64 as Horizon returns them. config.memo_required lives here (SEP-29). */
  data: Record<string, string>;
  trustlines: TrustlineState[];
  homeDomain?: string;
}

export interface ContractState {
  exists: boolean;
  /** "sac" for a Stellar Asset Contract, "wasm" for anything else, null when exists is false. */
  kind: "sac" | "wasm" | null;
  /** For a SAC: the classic asset it wraps. */
  wraps?: { kind: "native" } | { kind: "classic"; code: string; issuer: string };
  /** Recorded results of read-only calls, e.g. decimals, symbol, is_frozen, allowed. Key = function name + canonical args. */
  reads?: Record<string, unknown>;
}

export interface RecordedSimulation {
  /** Canonical description of the simulated call, e.g. "transfer(C..SAC, from G.., to G.., 10000000)". */
  call: string;
  source: string;
  result: { ok: true } | { ok: false; error: string; contractErrorCode?: number };
}

export interface StateSnapshot {
  schema: "sik.state-snapshot/1";
  network: NetworkName;
  /** Ledger sequence of the reads (Horizon and RPC reads are not atomic; this is the RPC latest ledger, SPEC 2.3). */
  ledger: number;
  capturedAt: string;
  /** null = the account does not exist. */
  accounts: Record<string, AccountState | null>;
  contracts: Record<string, ContractState>;
  /** key `${sacContractId}:${holder}` -> SAC balance; null = no balance entry. */
  sacBalances: Record<string, { amount: string; authorized: boolean } | null>;
  simulations: RecordedSimulation[];
  /** Ledger parameters some libraries read (stellar-check getNetwork): base reserve and base fee, in stroops. */
  networkParams?: { baseReserveStroops: string; baseFeeStroops: string };
  /** Third-party directory answers, only if the capture script queried them. */
  directory?: Record<string, { name?: string; tags: string[] } | null>;
  federation?: Record<string, { account: string; memoType?: "text" | "id" | "hash"; memo?: string }>;
}

// ---- provenance (schemas/provenance.schema.json) ----

export interface Provenance {
  fixture: string;
  capturedAt: string;
  script: string;
  scriptCommit?: string;
  network: NetworkName;
  source: { kind: "captured" | "synthetic"; urls: string[]; rpcVersion?: string; protocolVersion?: number; horizonVersion?: string };
  ledger: number;
  readsAreAtomic?: false;
  containsSecrets: false;
  notes: string;
}

// ---- ground truth ----

export type GroundTruth =
  | { kind: "horizon-result"; operationResult: "success" | "op_no_destination" | "op_no_trust" | "op_not_authorized" | "op_line_full" | "op_underfunded" | "other"; txHash?: string; note?: string }
  | { kind: "simulation"; outcome: "ok" | "contract-error"; contractErrorCode?: number; note?: string }
  | { kind: "out-of-band"; note: string }
  | { kind: "none"; note?: string };

// ---- case ----

export type CaseTag =
  | "@classic" | "@native" | "@muxed" | "@memo" | "@sac" | "@sep41" | "@sep57" | "@sep8" | "@sender-side"
  | "@testnet" | "@mainnet-readonly" | "@synthetic" | "@not-derivable";

export interface ExpectedOutcome {
  /** Canonical codes every correct library should report (receive scope). Empty = nothing expected. */
  mustReport: ReasonCode[];
  /** Canonical codes a correct library must not report. */
  mustNotReport?: ReasonCode[];
  verdict: ReceiveVerdictClass | "undetermined";
  /** Why the expectation holds, with the trust tag of the evidence. */
  rationale: string;
}

export interface CaseFile {
  schema: "sik.case/1";
  caseId: string;
  title: string;
  tags: CaseTag[];
  input: CaseInput;
  expected: ExpectedOutcome;
  /** Fixture directory holds state.json when captured; false means the case is catalogued but not yet captured. */
  captured: boolean;
}

// ---- verdict ----

export type ReceiveVerdictClass = "can_receive" | "can_receive_with_warnings" | "cannot_receive" | "unknown";
export type Party = "recipient" | "sender" | "issuer" | "application" | "provider" | "unspecified";

export interface ReasonEntry {
  code: ReasonCode;
  severity: Severity;
  party: Party;
  /** The library's own code, verbatim. */
  libraryCode: string;
  /** The library's message, verbatim (for audit; never compared). */
  message?: string;
}

export interface ReceiveVerdict {
  schema: "sik.receive-verdict/1";
  adapterId: string;
  adapterVersion: string;
  caseId: string;
  verdict: ReceiveVerdictClass;
  /** Receive-scope and meta-scope reasons, mapped. */
  reasons: ReasonEntry[];
  /** Sender-scope reasons kept apart so they never affect `verdict`. */
  senderSide: ReasonEntry[];
  /** Library codes that had no mapping. Non-empty fails the run (PFH_E_UNMAPPED_LIBRARY_CODE) unless --allow-unmapped. */
  unmapped: string[];
  /** The library's own status string, verbatim: READY/WARNING/BLOCKED, ok/warn/block, no_known_issues/issues_found/incomplete. */
  libraryStatus: string;
  /** Library output verbatim, JSON-safe, for the report appendix. */
  raw: unknown;
  error?: { kind: "adapter_unavailable" | "threw" | "timeout"; message: string };
}
