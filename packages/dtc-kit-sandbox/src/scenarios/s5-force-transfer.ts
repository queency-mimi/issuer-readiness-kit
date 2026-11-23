// SPDX-License-Identifier: Apache-2.0
import { FAKE_ADDRESSES } from "../institutions.ts";
import type { ScriptedScenario } from "./types.ts";

export const forceTransfer: ScriptedScenario = {
  id: "SBX-5-force-transfer",
  title: "DTC force-transfers tokens without the holder's signature, only to a Registered Wallet, and counts the use",
  rows: [
    "authorities.dtc-override-root-wallet",
    "authorities.force-transfer-reasons",
    "token.transfer-only-to-registered-wallets",
    "compliance.quarterly-sec-report-counts",
  ],
  nalBasis: ["NAL condition 7 and section III 'Override Keys'", "NAL rep 10 (quarterly count of root-wallet uses)"],
  steps: [
    {
      name: "seed two funded Completed wallets",
      actor: { as: "sim" },
      request: { method: "POST", path: "/v1/sim/reset", body: { fixture: "two-wallets-funded" } },
      expect: { status: 200 },
    },
    {
      name: "a participant cannot call the admin route",
      actor: { as: "participant", participant: "SBX-9002" },
      request: { method: "POST", path: "/v1/admin/force-transfers", body: { fromWallet: "W-1", toAddress: FAKE_ADDRESSES.birchClient2, tokens: "10", reason: "erroneous" } },
      expect: { status: 403 },
    },
    {
      name: "DTC force-transfers 10 tokens, no holder signature in the request",
      actor: { as: "dtc-ops" },
      request: { method: "POST", path: "/v1/admin/force-transfers", body: { fromWallet: "W-1", toAddress: FAKE_ADDRESSES.birchClient2, tokens: "10", reason: "erroneous" } },
      expect: { status: 200, body: { state: "Confirmed", tokens: "10" } },
    },
    {
      name: "DTC cannot force-transfer to an unregistered address",
      actor: { as: "dtc-ops" },
      request: { method: "POST", path: "/v1/admin/force-transfers", body: { fromWallet: "W-1", toAddress: FAKE_ADDRESSES.unregistered, tokens: "10", reason: "erroneous" } },
      expect: { status: 409, body: { code: "DEST_NOT_REGISTERED" } },
    },
    {
      name: "the use is counted for the quarterly report",
      actor: { as: "dtc-ops" },
      request: { method: "GET", path: "/v1/admin/root-wallet-uses" },
      expect: { status: 200, body: { total: 1 } },
    },
  ],
};
