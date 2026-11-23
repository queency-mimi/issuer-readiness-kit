// SPDX-License-Identifier: Apache-2.0
import { loadBundledProfile, resolveProfile } from "@sik/dtc-kit-profile-spec";
import { trustLabel } from "@sik/dtc-kit-core";
import type { AllocationInput, ConsolidatedCredit, ParticipantBooks } from "../src/index.ts";

export const profile = resolveProfile(loadBundledProfile("dtc-stellar"));
export const trust = trustLabel(profile, ["corporate_actions.cash-credit-consolidated-classic", "corporate_actions.position-capture-8pm-et"]);

export const books: ParticipantBooks = {
  participant: "SBX-9002",
  clients: [{ clientId: "C-BIRCH-001" }, { clientId: "C-BIRCH-002" }, { clientId: "C-BIRCH-003" }],
  wallets: [
    { ledger: "sandbox-ledger", address: "W1a", kind: "client", clientId: "C-BIRCH-001" },
    { ledger: "sandbox-ledger", address: "W1b", kind: "client", clientId: "C-BIRCH-001" },
    { ledger: "sandbox-ledger", address: "W2", kind: "client", clientId: "C-BIRCH-002" },
    { ledger: "sandbox-ledger", address: "W3a", kind: "client", clientId: "C-BIRCH-003" },
    { ledger: "sandbox-ledger", address: "W3b", kind: "client", clientId: "C-BIRCH-003" },
    { ledger: "sandbox-ledger", address: "H1", kind: "internal" },
  ],
};

export const credit = (amount: bigint): ConsolidatedCredit => ({
  participant: "SBX-9002",
  cusip: "SBX000AA0",
  eventId: "CA-1",
  eventKind: "interest",
  recordDate: "2027-01-15",
  payDate: "2027-01-19",
  amount,
  currency: "USD",
  receivedAt: "2027-01-19T15:00:00Z",
});

export const input = (amount: bigint, positions = [["W1a", 30n], ["W1b", 20n], ["W2", 30n], ["W3a", 15n], ["W3b", 5n]] as [string, bigint][]): AllocationInput => ({
  books,
  positions: positions.map(([address, tokens]) => ({ address, tokens })),
  credit: credit(amount),
  trust,
});
