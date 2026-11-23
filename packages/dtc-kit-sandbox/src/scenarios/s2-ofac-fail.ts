// SPDX-License-Identifier: Apache-2.0
import { FAKE_ADDRESSES, FAKE_CUSIP } from "../institutions.ts";
import type { ScriptedScenario } from "./types.ts";

export const ofacFail: ScriptedScenario = {
  id: "SBX-2-ofac-fail",
  title: "A client wallet on the sandbox sanctions list fails compliance and is barred from conversion orders",
  rows: ["wallet.registration-ofac-screening", "wallet.registration-status-taxonomy", "wallet.participant-kyc-aml-duty"],
  nalBasis: ["NAL rep 4", "help page register_wallets.htm: 'Failed Compliance ... barred from conversion orders'"],
  steps: [
    {
      name: "participant registers a client wallet for the sanctions test entity",
      actor: { as: "participant", participant: "SBX-9004" },
      request: { method: "POST", path: "/v1/wallets", body: { ledger: "sandbox-ledger", address: FAKE_ADDRESSES.dunmoreSable, kind: "client", clientId: "C-DUNMORE-SABLE" } },
      expect: { status: 202, body: { status: "Processing" } },
      capture: { walletId: "id" },
    },
    {
      name: "OFAC screen runs",
      actor: { as: "sim" },
      request: { method: "POST", path: "/v1/sim/advance", body: { seconds: 60 } },
      expect: { status: 200 },
    },
    {
      name: "the wallet is Failed Compliance and not allowlisted",
      actor: { as: "participant", participant: "SBX-9004" },
      request: { method: "GET", path: "/v1/wallets/{{walletId}}" },
      expect: { status: 200, body: { status: "Failed Compliance", onChainAllowlisted: false } },
    },
    {
      name: "a conversion order to that wallet is Declined",
      actor: { as: "participant", participant: "SBX-9004" },
      request: { method: "POST", path: "/v1/conversion-orders", body: { wallet: "{{walletId}}", cusip: FAKE_CUSIP, direction: "to-token", tokens: "100" } },
      expect: { status: 422, body: { status: "Declined", reasonCode: "WALLET_FAILED_COMPLIANCE" } },
    },
  ],
};
