// SPDX-License-Identifier: Apache-2.0
import type { WalletKind } from "@sik/dtc-kit-core";

/**
 * Fake institutions. Every name and number is fictional and prefixed so it cannot be mistaken for a real
 * DTC participant. Nothing here is derived from a real participant list.
 */
export interface FakeParticipant {
  id: string;
  name: string;
  role: "bank" | "prime-broker" | "custodian" | "broker";
  /** Service account the sandbox OAuth endpoint accepts for this participant. Not a secret: sandbox only. */
  serviceAccountId: string;
}

export interface FakeClient {
  clientId: string;
  participant: string;
  name: string;
  /** Present only for the sanctions test entity. */
  sandboxSanctionsListId?: string;
}

export interface FakeWalletVendor {
  id: string;
  name: string;
  /** What the fake vendor claims to support; scenarios use it to model wallet-vendor readiness. */
  claims: string[];
}

export const PARTICIPANTS: readonly FakeParticipant[] = [
  { id: "SBX-9001", name: "Alder Clearing Bank (FICTIONAL)", role: "bank", serviceAccountId: "sa-alder-1" },
  { id: "SBX-9002", name: "Birch Prime Brokerage (FICTIONAL)", role: "prime-broker", serviceAccountId: "sa-birch-1" },
  { id: "SBX-9003", name: "Cedar Custody Trust (FICTIONAL)", role: "custodian", serviceAccountId: "sa-cedar-1" },
  { id: "SBX-9004", name: "Dunmore Retail Securities (FICTIONAL)", role: "broker", serviceAccountId: "sa-dunmore-1" },
];

export const CLIENTS: readonly FakeClient[] = [
  { clientId: "C-BIRCH-001", participant: "SBX-9002", name: "Meadow Pension Fund (FICTIONAL)" },
  { clientId: "C-BIRCH-002", participant: "SBX-9002", name: "Quarry Asset Management (FICTIONAL)" },
  { clientId: "C-BIRCH-003", participant: "SBX-9002", name: "Tern Family Office (FICTIONAL)" },
  { clientId: "C-DUNMORE-SABLE", participant: "SBX-9004", name: "Sable Trading FZE (FICTIONAL)", sandboxSanctionsListId: "SBX-SDN-0001" },
];

export const WALLET_VENDORS: readonly FakeWalletVendor[] = [
  { id: "VND-FJORD", name: "Fjord Wallets (FICTIONAL)", claims: ["classic-trustlines", "classic-clawback-ops"] },
  { id: "VND-GLEN", name: "Glen Custody Tech (FICTIONAL)", claims: ["classic-trustlines", "soroban-auth-entries", "control-action-display"] },
];

/** Obviously fake addresses. DTC does not validate address text, so the sandbox does not either (profile row wallet.address-not-validated-by-dtc). */
export const FAKE_ADDRESSES = {
  alderInternal: "SBX-ADDR-ALDER-INTERNAL-0001",
  birchClient1: "SBX-ADDR-BIRCH-CLIENT-0001",
  birchClient2: "SBX-ADDR-BIRCH-CLIENT-0002",
  birchClient3: "SBX-ADDR-BIRCH-CLIENT-0003",
  cedarInternal: "SBX-ADDR-CEDAR-INTERNAL-0001",
  dunmoreSable: "SBX-ADDR-DUNMORE-SABLE-0001",
  unregistered: "SBX-ADDR-NOBODY-0000",
} as const;

export const FAKE_CUSIP = "SBX000AA0";

export type { WalletKind };
