// SPDX-License-Identifier: Apache-2.0
// Normative shapes: SPEC.md section 2. JSON Schema: schemas/policy-doc.schema.json.

/** RFC 3339 UTC, second precision, trailing Z: 2026-11-30T00:00:00Z */
export type IsoTime = string;
/** Non-negative integer in base units, decimal digits only, no leading zeros, <= 2^127-1. */
export type DecimalString = string;
/** [a-z][a-z0-9_-]{1,63} */
export type PrincipalId = string;
/** Stellar strkey: G... (account) or C... (contract). Muxed M... is rejected in v1. */
export type StellarAddress = string;
export type ContractId = string;

export type Role = "maker" | "checker" | "admin";
export type AttestationScheme = "stellar-sep53" | "host-asserted";
export type Day = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";
export type ControlKind = "freeze" | "unfreeze" | "forced_transfer" | "pause" | "unpause";

export interface PrincipalDecl {
  id: PrincipalId;
  label: string;
  /** Non-empty, unique, sorted ascending. */
  roles: Role[];
  /** Required when attestation includes "stellar-sep53". Must be a G address in v1. */
  address?: StellarAddress;
  /** Non-empty, unique, sorted ascending. */
  attestation: AttestationScheme[];
}

export interface FunctionRule {
  /** Contract function name (Soroban symbol, <= 32 chars). */
  name: string;
  /** Zero-based index of the i128 amount argument, if the function moves value. */
  amountArg?: number;
  /** Zero-based index of the recipient address argument, if any. */
  recipientArg?: number;
  /** If present, the recipient argument must be one of these. Non-empty, unique, sorted. */
  recipients?: StellarAddress[];
}

export interface Target {
  contract: ContractId;
  /** Non-empty. No wildcard in v1. Sorted by name, unique. */
  functions: FunctionRule[];
}

export interface PerRequestLimit {
  contract: ContractId;
  max: DecimalString;
}

export interface RollingLimit {
  contract: ContractId;
  windowSeconds: number;
  max: DecimalString;
}

export interface TimeWindow {
  /** Non-empty, unique, in calendar order mon..sun. */
  days: Day[];
  /** "HH:MM" UTC, start inclusive. */
  startUtc: string;
  /** "HH:MM" UTC, end exclusive. startUtc < endUtc (no overnight windows in v1). */
  endUtc: string;
}

export interface ApprovalGroup {
  min: number;
  /** Principals that may count toward this group. Each must hold the group's role. Sorted, unique. */
  from: PrincipalId[];
}

export interface ApprovalRequirement {
  checkers: ApprovalGroup;
  /** Optional additional admin approvals. `from` sets of checkers and admins must be disjoint. */
  admins?: ApprovalGroup;
}

export interface RuleMatch {
  /** Sorted by contract, unique. */
  targets: Target[];
  /** If present, a control action must have one of these kinds for the rule to match. */
  controlKinds?: ControlKind[];
}

export interface RuleLimits {
  perRequest?: PerRequestLimit[];
  rolling?: RollingLimit[];
}

export interface Rule {
  id: string;
  effect: "allow" | "deny";
  description?: string;
  match: RuleMatch;
  /** Principals allowed to propose under this rule. Each must hold the maker role. Required for allow. */
  makers?: PrincipalId[];
  /** Required for allow rules, forbidden for deny rules. */
  approval?: ApprovalRequirement;
  limits?: RuleLimits;
  /** Signing and submission are only allowed inside one of these windows. Absent = any time. */
  windows?: TimeWindow[];
  /** Minimum seconds between the approval threshold being met and signing being allowed. */
  cooldownSeconds?: number;
}

export interface PolicyDoc {
  version: 1;
  /** Stable family id: [a-z0-9][a-z0-9-]{1,63}. Versions of one policy share an id. */
  id: string;
  name: string;
  network: { name: "testnet" | "mainnet"; passphrase: string };
  validity: { notBefore: IsoTime; expiresAt: IsoTime };
  /** Sorted by id. */
  principals: PrincipalDecl[];
  separation: { makerCannotSign: boolean };
  /** Seconds a request may stay non-terminal. 60..2592000. */
  requestTtlSeconds: number;
  /** Ledgers an auth entry stays valid after planning. 1..17280. */
  authEntryTtlLedgers: number;
  /** Sorted by id. Evaluation order is irrelevant by construction (SPEC section 4). */
  rules: Rule[];
  /** policyHash of the document this one replaces, if any. */
  supersedes?: string;
}
