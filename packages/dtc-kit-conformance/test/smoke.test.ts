// SPDX-License-Identifier: Apache-2.0
// SC-000: boots the sandbox server and proves the package graph links.
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { describe, it } from "node:test";
import { CAPABILITIES, InvalidTransition, NotImplemented, reduceWallet } from "@sik/dtc-kit-core";
import { StellarSacAdapter } from "@sik/dtc-kit-adapter-stellar-sac";
import { StellarSep57Adapter } from "@sik/dtc-kit-adapter-stellar-sep57";
import { loadBundledProfile, resolveProfile } from "@sik/dtc-kit-profile-spec";
import { DISCLAIMER_HEADER, ROUTES, createSandboxServer } from "@sik/dtc-kit-sandbox";
import { allocateConsolidatedCredit } from "@sik/dtc-kit-reconciliation";
import { DTC_KIT_PACK, IMPLEMENTATIONS } from "../src/index.ts";

describe("SC-000 smoke", () => {
  it("sandbox boots, reports the profile lineage and carries the disclaimer header", async () => {
    const server = createSandboxServer("dtc-stellar");
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const { port } = server.address() as AddressInfo;
      const res = await fetch(`http://127.0.0.1:${port}/v1/health`);
      assert.equal(res.status, 200);
      assert.ok(res.headers.get(DISCLAIMER_HEADER)?.includes("not DTC-certified"));
      const body = (await res.json()) as { status: string; profile: string; lineage: string[] };
      assert.equal(body.status, "ok");
      assert.equal(body.profile, "dtc-stellar");
      assert.deepEqual(body.lineage, ["dtc-generic", "dtc-stellar"]);

      const noToken = await fetch(`http://127.0.0.1:${port}/v1/wallets`, { method: "POST" });
      assert.equal(noToken.status, 401);
      assert.equal(((await noToken.json()) as { code: string }).code, "UNAUTHENTICATED");
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it("every documented route points at a ticket", () => {
    for (const r of ROUTES) assert.match(r.ticket, /^(scaffold|DTC-\d{3})$/, r.path);
  });

  it("the package graph links: core reducers and reconciliation are callable", () => {
    const profile = resolveProfile(loadBundledProfile("dtc-stellar"));
    assert.throws(() => reduceWallet({ status: "Failed" } as never, { type: "release-control" }, profile), InvalidTransition);
    assert.ok(new NotImplemented("DTC-026").message.includes("DTC-026"));
    assert.equal(typeof allocateConsolidatedCredit, "function");
  });

  it("both Stellar adapters publish a total capability matrix", () => {
    for (const adapter of [
      new StellarSacAdapter({ network: "testnet", assetCode: "SBXTEST", issuerAccount: "SBX-ISSUER" }),
      new StellarSep57Adapter({ network: "testnet", tokenContractId: "SBX-CONTRACT", operator: "SBX-OPERATOR" }),
    ]) {
      const matrix = adapter.capabilityMatrix();
      for (const cap of CAPABILITIES) {
        assert.equal(matrix[cap].capability, cap, `${adapter.id}:${cap}`);
        assert.ok(matrix[cap].mechanism.length > 0);
      }
    }
  });

  it("every implemented scenario has an executable implementation, and vice versa", () => {
    const implemented = DTC_KIT_PACK.scenarios.filter((s) => s.status === "implemented").map((s) => s.id);
    assert.deepEqual(implemented, Object.keys(IMPLEMENTATIONS).sort());
  });
});
