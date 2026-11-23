// SPDX-License-Identifier: Apache-2.0
import { FAKE_ADDRESSES } from "../institutions.ts";
import type { ScriptedScenario } from "./types.ts";

export const registerWallet: ScriptedScenario = {
  id: "SBX-1-register-wallet",
  title: "A participant registers a wallet; it completes only after OFAC screening and allowlisting",
  rows: [
    "wallet.only-participants-register",
    "wallet.registration-ofac-screening",
    "wallet.registration-status-taxonomy",
    "wallet.address-not-validated-by-dtc",
  ],
  nalBasis: [
    "NAL section III 'Only Participants May Register Wallets'",
    "NAL rep 4 (registration requires OFAC screening)",
    "help page register_wallets.htm (status list)",
  ],
  steps: [
    {
      name: "participant submits a registration; DTC does not validate the address text",
      actor: { as: "participant", participant: "SBX-9001" },
      request: { method: "POST", path: "/v1/wallets", body: { ledger: "sandbox-ledger", address: FAKE_ADDRESSES.alderInternal, kind: "internal" } },
      expect: { status: 202, body: { status: "Processing" } },
      capture: { walletId: "id" },
    },
    {
      name: "a non-participant service account is refused",
      actor: { as: "sim" },
      request: { method: "POST", path: "/v1/wallets", body: { ledger: "sandbox-ledger", address: "SBX-ADDR-OUTSIDER-0001", kind: "internal" } },
      expect: { status: 403, body: { code: "NOT_A_PARTICIPANT" } },
    },
    {
      name: "time passes; OFAC screen and allowlist confirmation complete",
      actor: { as: "sim" },
      request: { method: "POST", path: "/v1/sim/advance", body: { seconds: 60 } },
      expect: { status: 200 },
    },
    {
      name: "the wallet is Completed",
      actor: { as: "participant", participant: "SBX-9001" },
      request: { method: "GET", path: "/v1/wallets/{{walletId}}" },
      expect: { status: 200, body: { status: "Completed" } },
    },
  ],
};
