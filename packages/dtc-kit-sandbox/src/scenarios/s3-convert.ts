// SPDX-License-Identifier: Apache-2.0
import { FAKE_ADDRESSES, FAKE_CUSIP } from "../institutions.ts";
import type { ScriptedScenario } from "./types.ts";

export const convert: ScriptedScenario = {
  id: "SBX-3-convert",
  title: "A conversion order mints whole tokens 1:1 into a Completed wallet and converting back burns them",
  rows: [
    "authorities.dtc-initiated-mint-burn",
    "token.one-to-one-backing",
    "token.whole-tokens-only",
    "operations.conversion-order-status-taxonomy",
  ],
  nalBasis: ["help page conversion_orders.htm (statuses, DTC-initiated mint/burn, no fractional tokens)", "FAQ (1:1 backing)"],
  steps: [
    {
      name: "register and complete a wallet",
      actor: { as: "participant", participant: "SBX-9002" },
      request: { method: "POST", path: "/v1/wallets", body: { ledger: "sandbox-ledger", address: FAKE_ADDRESSES.birchClient1, kind: "client", clientId: "C-BIRCH-001" } },
      expect: { status: 202 },
      capture: { walletId: "id" },
    },
    { name: "time passes", actor: { as: "sim" }, request: { method: "POST", path: "/v1/sim/advance", body: { seconds: 60 } }, expect: { status: 200 } },
    {
      name: "convert 100 shares to 100 tokens",
      actor: { as: "participant", participant: "SBX-9002" },
      request: { method: "POST", path: "/v1/conversion-orders", body: { wallet: "{{walletId}}", cusip: FAKE_CUSIP, direction: "to-token", tokens: "100" } },
      expect: { status: 202, body: { status: "Processing" } },
      capture: { orderId: "id" },
    },
    { name: "order settles", actor: { as: "sim" }, request: { method: "POST", path: "/v1/sim/advance", body: { seconds: 900 } }, expect: { status: 200 } },
    {
      name: "order is Completed and the wallet holds 100 tokens",
      actor: { as: "participant", participant: "SBX-9002" },
      request: { method: "GET", path: "/v1/conversion-orders/{{orderId}}" },
      expect: { status: 200, body: { status: "Completed", tokens: "100" } },
    },
    {
      name: "a fractional quantity is refused, not rounded",
      actor: { as: "participant", participant: "SBX-9002" },
      request: { method: "POST", path: "/v1/conversion-orders", body: { wallet: "{{walletId}}", cusip: FAKE_CUSIP, direction: "to-token", tokens: "1.5" } },
      expect: { status: 422, body: { reasonCode: "FRACTIONAL_QUANTITY" } },
    },
    {
      name: "convert 40 tokens back to book entry",
      actor: { as: "participant", participant: "SBX-9002" },
      request: { method: "POST", path: "/v1/conversion-orders", body: { wallet: "{{walletId}}", cusip: FAKE_CUSIP, direction: "to-book-entry", tokens: "40" } },
      expect: { status: 202 },
    },
  ],
};
