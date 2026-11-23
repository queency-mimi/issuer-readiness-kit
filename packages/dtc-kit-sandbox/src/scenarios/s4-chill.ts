// SPDX-License-Identifier: Apache-2.0
import { FAKE_ADDRESSES } from "../institutions.ts";
import type { ScriptedScenario } from "./types.ts";

export const chill: ScriptedScenario = {
  id: "SBX-4-chill",
  title: "A Delivery Order Chill blocks outbound transfers from a wallet until released",
  rows: ["wallet.registration-status-taxonomy", "wallet.control-state-semantics", "token.transfer-only-to-registered-wallets"],
  nalBasis: [
    "help pages register_wallets.htm / glossary.htm (state names)",
    "effect of the state is an INFERRED reading (row wallet.control-state-semantics); this scenario is labelled @inferred",
  ],
  steps: [
    {
      name: "two Completed wallets exist with tokens in the first (seeded by fixture 'two-wallets-funded')",
      actor: { as: "sim" },
      request: { method: "POST", path: "/v1/sim/reset", body: { fixture: "two-wallets-funded" } },
      expect: { status: 200, body: { sourceWalletId: "W-1", destinationWalletId: "W-2" } },
    },
    {
      name: "a transfer succeeds before the chill",
      actor: { as: "participant", participant: "SBX-9002" },
      request: { method: "POST", path: "/v1/transfers", body: { fromWallet: "W-1", toAddress: FAKE_ADDRESSES.birchClient2, tokens: "5" } },
      expect: { status: 200 },
    },
    {
      name: "DTC chills the source wallet",
      actor: { as: "sim" },
      request: { method: "POST", path: "/v1/sim/wallets/W-1/control", body: { control: "delivery-order-chill" } },
      expect: { status: 200, body: { status: "Delivery Order Chill" } },
    },
    {
      name: "outbound transfer is refused with a labelled reason",
      actor: { as: "participant", participant: "SBX-9002" },
      request: { method: "POST", path: "/v1/transfers", body: { fromWallet: "W-1", toAddress: FAKE_ADDRESSES.birchClient2, tokens: "5" } },
      expect: { status: 409, body: { code: "SOURCE_RESTRICTED" } },
    },
    {
      name: "DTC releases the chill",
      actor: { as: "sim" },
      request: { method: "POST", path: "/v1/sim/wallets/W-1/control", body: { control: "release" } },
      expect: { status: 200, body: { status: "Completed" } },
    },
    {
      name: "the transfer succeeds again",
      actor: { as: "participant", participant: "SBX-9002" },
      request: { method: "POST", path: "/v1/transfers", body: { fromWallet: "W-1", toAddress: FAKE_ADDRESSES.birchClient2, tokens: "5" } },
      expect: { status: 200 },
    },
  ],
};
