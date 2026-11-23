// SPDX-License-Identifier: Apache-2.0
import type {
  ConversionDirection,
  ConversionOrder,
  ForceTransfer,
  ForceTransferReason,
  PrecheckReason,
  WalletKind,
  WalletRecord,
} from "@sik/dtc-kit-core";

/**
 * HTTP API shape of the sandbox. It is the kit's OWN shape, derived from the public help pages (statuses,
 * accounts, orders, CSV exports). It is NOT DTCC's API: the API Reference Guide is login-gated and unread.
 * Do not claim compatibility. Every JSON response carries `x-dtc-kit-disclaimer`.
 */
export type Role = "participant" | "dtc-ops" | "sim";

export interface RouteSpec {
  method: "GET" | "POST";
  path: string;
  operationId: string;
  role: Role | "public";
  summary: string;
  /** Ticket that implements the handler; handlers return 501 with this id until then. */
  ticket: string;
}

export const ROUTES: readonly RouteSpec[] = [
  { method: "GET", path: "/v1/health", operationId: "health", role: "public", summary: "Liveness plus profile id/version", ticket: "scaffold" },
  { method: "POST", path: "/oauth/token", operationId: "token", role: "public", summary: "client_credentials for a fake service account", ticket: "DTC-011" },
  { method: "GET", path: "/v1/profile", operationId: "profile", role: "public", summary: "Active resolved profile with row statuses", ticket: "DTC-011" },
  { method: "POST", path: "/v1/wallets", operationId: "registerWallet", role: "participant", summary: "Register a wallet (async: Processing)", ticket: "DTC-011" },
  { method: "GET", path: "/v1/wallets", operationId: "listWallets", role: "participant", summary: "List own wallets; text/csv supported", ticket: "DTC-011" },
  { method: "GET", path: "/v1/wallets/:id", operationId: "getWallet", role: "participant", summary: "One wallet with status", ticket: "DTC-011" },
  { method: "GET", path: "/v1/accounts/:participant/balances", operationId: "balances", role: "participant", summary: "Classic and digital balances; text/csv supported", ticket: "DTC-011" },
  { method: "GET", path: "/v1/accounts/:participant/activity", operationId: "activity", role: "participant", summary: "Activity incl. freeze/unfreeze, Payment, Payment Received; text/csv supported", ticket: "DTC-011" },
  { method: "GET", path: "/v1/conversion-orders", operationId: "listConversionOrders", role: "participant", summary: "List own conversion orders; text/csv supported", ticket: "DTC-016" },
  { method: "POST", path: "/v1/conversion-orders", operationId: "createConversionOrder", role: "participant", summary: "Create a conversion order (maker/checker optional)", ticket: "DTC-012" },
  { method: "GET", path: "/v1/conversion-orders/:id", operationId: "getConversionOrder", role: "participant", summary: "One order", ticket: "DTC-012" },
  { method: "POST", path: "/v1/conversion-orders/:id/approve", operationId: "approveConversionOrder", role: "participant", summary: "Checker approves a Pending Approval order", ticket: "DTC-012" },
  { method: "POST", path: "/v1/transfers/precheck", operationId: "precheckTransfer", role: "participant", summary: "Would DTC rules allow this transfer? Returns reason codes and trust label", ticket: "DTC-012" },
  { method: "POST", path: "/v1/transfers", operationId: "transfer", role: "participant", summary: "Sandbox-ledger transfer; enforces registered-wallet rule", ticket: "DTC-012" },
  { method: "POST", path: "/v1/admin/force-transfers", operationId: "forceTransfer", role: "dtc-ops", summary: "DTC override: move tokens without holder signature", ticket: "DTC-013" },
  { method: "GET", path: "/v1/admin/root-wallet-uses", operationId: "rootWalletUses", role: "dtc-ops", summary: "Count for the quarterly SEC report", ticket: "DTC-013" },
  { method: "POST", path: "/v1/corporate-actions", operationId: "createCorporateAction", role: "dtc-ops", summary: "Announce an interest or maturity event", ticket: "DTC-015" },
  { method: "GET", path: "/v1/corporate-actions/:id", operationId: "getCorporateAction", role: "participant", summary: "The participant's own captured positions and credit for an event", ticket: "DTC-015" },
  { method: "POST", path: "/v1/corporate-actions/:id/capture", operationId: "captureCorporateAction", role: "dtc-ops", summary: "Take the 20:00 ET position capture", ticket: "DTC-015" },
  { method: "POST", path: "/v1/corporate-actions/:id/pay", operationId: "payCorporateAction", role: "dtc-ops", summary: "Credit one consolidated cash amount to each participant's classic account", ticket: "DTC-015" },
  { method: "POST", path: "/v1/sim/wallets/:id/control", operationId: "simControl", role: "sim", summary: "Test hook: apply chill, global lock, compliance lock, release", ticket: "DTC-013" },
  { method: "POST", path: "/v1/sim/advance", operationId: "simAdvance", role: "sim", summary: "Advance clock and complete pending async work (OFAC screen, on-chain allowlist)", ticket: "DTC-011" },
  { method: "POST", path: "/v1/sim/reset", operationId: "simReset", role: "sim", summary: "Reset all state to the seeded fixture", ticket: "DTC-011" },
  { method: "GET", path: "/v1/sim/plans", operationId: "simPlans", role: "sim", summary: "Chain action plans the configured adapter produced for every chain effect", ticket: "DTC-021" },
] as const;

export interface RegisterWalletRequest {
  ledger: string;
  address: string;
  kind: WalletKind;
  clientId?: string;
}

export type RegisterWalletResponse = Pick<WalletRecord, "id" | "status" | "ledger" | "address" | "kind" | "clientId">;

export interface CreateConversionOrderRequest {
  wallet: string;
  cusip: string;
  direction: ConversionDirection;
  /** String so that "1.5" can be rejected, not silently rounded. */
  tokens: string;
  /** Maker/checker: the order waits in Pending Approval for a different checker. */
  makerChecker?: boolean;
  maker?: string;
}

export type ConversionOrderResponse = Pick<ConversionOrder, "id" | "status" | "direction" | "tokens" | "reasonCode">;

export interface PrecheckRequest {
  fromWallet: string;
  toAddress: string;
  tokens: string;
  toLedger?: string;
}

export interface PrecheckResponse {
  allowed: boolean;
  reasons: PrecheckReason[];
  trust: { status: "published" | "inferred" | "unknown"; rows: string[]; disclaimer: string };
}

export interface ForceTransferRequest {
  fromWallet: string;
  toAddress: string;
  tokens: string;
  reason: ForceTransferReason;
}

export type ForceTransferResponse = Pick<ForceTransfer, "id" | "state" | "reason" | "tokens">;

export interface ApiError {
  code: string;
  message: string;
  /** Present on 501 stubs. */
  ticket?: string;
}

export const DISCLAIMER_HEADER = "x-dtc-kit-disclaimer";
export const DISCLAIMER_TEXT = "DTC-shaped, not DTC-certified. Fictional institutions. Not the DTCC API.";
