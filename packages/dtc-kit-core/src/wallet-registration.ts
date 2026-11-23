// SPDX-License-Identifier: Apache-2.0
import type { ResolvedProfile } from "@sik/dtc-kit-profile-spec/pure";
import { isControlState, restrictionFor } from "./control-state.ts";
import { InvalidTransition } from "./errors.ts";
import { trustLabel } from "./trust.ts";
import type { CoreEffect, LedgerId, ParticipantId, Reduction, TrustLabel, WalletAddress, WalletId } from "./types.ts";

/** Profile row wallet.registration-status-taxonomy. Order is the DTCC help-page order, not a lifecycle. */
export const WALLET_STATUSES = [
  "Processing",
  "Completed",
  "Failed Compliance",
  "Failed",
  "Delivery Order Chill",
  "Global Lock",
  "Compliance Lock",
] as const;
export type WalletStatus = (typeof WALLET_STATUSES)[number];

export type WalletKind = "internal" | "client";

export interface WalletRecord {
  id: WalletId;
  participant: ParticipantId;
  ledger: LedgerId;
  address: WalletAddress;
  kind: WalletKind;
  /** Required when kind is "client" (profile row wallet.account-model). */
  clientId?: string;
  status: WalletStatus;
  /** True once DTC's OFAC screen passed. Registration is not Completed before this. */
  ofacCleared: boolean;
  /** True once the on-chain allowlist effect is confirmed. Stellar classic needs a participant trustline first. */
  onChainAllowlisted: boolean;
  /** The status to return to after a chill/lock is released. */
  statusBeforeControl?: WalletStatus;
}

export type WalletEvent =
  | { type: "ofac-passed" }
  | { type: "ofac-failed"; detail: string }
  | { type: "technical-failure"; detail: string }
  | { type: "onchain-allowlist-confirmed" }
  | { type: "delivery-order-chill" }
  | { type: "global-lock" }
  | { type: "compliance-lock"; source: "smf-feed" | "dtc-ops" }
  | { type: "release-control" };

const ROWS = {
  taxonomy: "wallet.registration-status-taxonomy",
  ofac: "wallet.registration-ofac-screening",
  kyc: "wallet.participant-kyc-aml-duty",
  control: "wallet.control-state-semantics",
  participants: "wallet.only-participants-register",
  address: "wallet.address-not-validated-by-dtc",
  accountModel: "wallet.account-model",
} as const;

/**
 * Registration and control-state machine for one Registered Wallet (SPEC 2.1, DTC-004).
 * Completed needs `ofacCleared` AND `onChainAllowlisted`; `allowlist-add` is emitted once, on the first
 * `ofac-passed` while not allowlisted; `ofac-failed` -> Failed Compliance with `allowlist-remove` if it was
 * allowlisted; controls remember `statusBeforeControl` (escalation keeps the original) and `release-control`
 * restores it with `unrestrict`. Restrict effects read row wallet.control-state-semantics (inferred).
 * Illegal (status, event) pairs throw InvalidTransition.
 */
export function reduceWallet(wallet: WalletRecord, event: WalletEvent, profile: ResolvedProfile): Reduction<WalletRecord> {
  const at = { ledger: wallet.ledger, address: wallet.address };
  const illegal = (): never => {
    throw new InvalidTransition(wallet.status, event.type);
  };
  const s = wallet.status;
  switch (event.type) {
    case "ofac-passed": {
      if (s !== "Processing") return illegal();
      const effects: CoreEffect[] = !wallet.ofacCleared && !wallet.onChainAllowlisted ? [{ kind: "allowlist-add", ...at }] : [];
      const next: WalletRecord = { ...wallet, ofacCleared: true, status: wallet.onChainAllowlisted ? "Completed" : "Processing" };
      return { next, effects, trust: trustLabel(profile, [ROWS.ofac, ROWS.taxonomy]) };
    }
    case "onchain-allowlist-confirmed": {
      if (s !== "Processing") return illegal();
      const next: WalletRecord = { ...wallet, onChainAllowlisted: true, status: wallet.ofacCleared ? "Completed" : "Processing" };
      return { next, effects: [], trust: trustLabel(profile, [ROWS.ofac, ROWS.taxonomy]) };
    }
    case "ofac-failed": {
      if (s !== "Processing" && s !== "Completed") return illegal();
      const effects: CoreEffect[] = wallet.onChainAllowlisted ? [{ kind: "allowlist-remove", ...at }] : [];
      const next: WalletRecord = { ...wallet, status: "Failed Compliance", ofacCleared: false, onChainAllowlisted: false };
      return { next, effects, trust: trustLabel(profile, [ROWS.ofac, ROWS.taxonomy, ROWS.kyc]) };
    }
    case "technical-failure": {
      if (s !== "Processing") return illegal();
      return {
        next: { ...wallet, status: "Failed" },
        effects: [],
        trust: trustLabel(profile, [ROWS.taxonomy]),
      };
    }
    case "delivery-order-chill":
    case "global-lock":
    case "compliance-lock": {
      const target: WalletStatus =
        event.type === "delivery-order-chill" ? "Delivery Order Chill" : event.type === "global-lock" ? "Global Lock" : "Compliance Lock";
      const allowedFrom: readonly WalletStatus[] = event.type === "delivery-order-chill" ? ["Completed"] : ["Completed", "Delivery Order Chill"];
      if (!allowedFrom.includes(s)) return illegal();
      const r = restrictionFor(target, profile);
      const next: WalletRecord = { ...wallet, status: target, statusBeforeControl: wallet.statusBeforeControl ?? s };
      return {
        next,
        effects: [{ kind: "restrict", ...at, inbound: r.blocksInbound, outbound: r.blocksOutbound }],
        trust: trustLabel(profile, [ROWS.taxonomy, ...r.trust.rows]),
      };
    }
    case "release-control": {
      if (!isControlState(s) || !wallet.statusBeforeControl) return illegal();
      const { statusBeforeControl, ...rest } = wallet;
      return {
        next: { ...rest, status: statusBeforeControl },
        effects: [{ kind: "unrestrict", ...at }],
        trust: trustLabel(profile, [ROWS.taxonomy, ROWS.control]),
      };
    }
  }
}

/** Lookups the validator needs from the host (sandbox registry or a participant's own books). */
export interface RegistrationDirectory {
  isParticipant(participant: string): boolean;
  clientExists(participant: string, clientId: string): boolean;
  isRegistered(ledger: LedgerId, address: WalletAddress): boolean;
}

/**
 * Validate a registration request before it enters the machine: only participants register
 * (NOT_A_PARTICIPANT); a client wallet needs a clientId (VALIDATION) that exists in the participant's books
 * (CLIENT_ID_UNKNOWN); a duplicate (ledger, address) is ALREADY_REGISTERED. The address text is NOT
 * validated (row wallet.address-not-validated-by-dtc).
 */
export function validateRegistration(
  request: Pick<WalletRecord, "participant" | "ledger" | "address" | "kind" | "clientId">,
  profile: ResolvedProfile,
  directory: RegistrationDirectory,
): { ok: true } | { ok: false; code: string; message: string; trust: TrustLabel } {
  const fail = (code: string, message: string, rows: string[]) => ({ ok: false as const, code, message, trust: trustLabel(profile, rows) });
  if (!directory.isParticipant(request.participant)) {
    return fail("NOT_A_PARTICIPANT", `${request.participant} is not a DTC participant in this registry`, [ROWS.participants]);
  }
  if (!request.ledger || request.address === undefined || request.address === "") {
    return fail("VALIDATION", "ledger and address are required", [ROWS.address]);
  }
  if (request.kind !== "internal" && request.kind !== "client") return fail("VALIDATION", "kind must be internal or client", [ROWS.accountModel]);
  if (request.kind === "client") {
    if (!request.clientId) return fail("VALIDATION", "a client wallet needs a clientId", [ROWS.accountModel]);
    if (!directory.clientExists(request.participant, request.clientId)) {
      return fail("CLIENT_ID_UNKNOWN", `client ${request.clientId} is not in ${request.participant}'s books`, [ROWS.accountModel]);
    }
  }
  if (directory.isRegistered(request.ledger, request.address)) {
    return fail("ALREADY_REGISTERED", `${request.address} is already registered on ${request.ledger}`, [ROWS.taxonomy]);
  }
  return { ok: true };
}
