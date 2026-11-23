// SPDX-License-Identifier: Apache-2.0
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { describe, it } from "node:test";
import { FIVE_SCENARIOS, MockDtcRegistry, createSandboxServer, inProcessTransport, runScripted } from "../src/index.ts";
import { profile } from "./helpers.ts";

describe("five scripted scenarios (DTC-014)", () => {
  for (const scenario of FIVE_SCENARIOS) {
    it(`${scenario.id} passes in-process`, async () => {
      const out = await runScripted(inProcessTransport(new MockDtcRegistry({ profile })), scenario, profile);
      assert.deepEqual(out.steps.filter((s) => !s.ok), [], JSON.stringify(out.steps, null, 1));
      assert.equal(out.passed, true);
    });
  }

  it("all five pass over HTTP against the Node server", async () => {
    const server = createSandboxServer("dtc-stellar");
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const { port } = server.address() as AddressInfo;
      for (const scenario of FIVE_SCENARIOS) {
        const out = await runScripted(`http://127.0.0.1:${port}`, scenario, profile);
        assert.equal(out.passed, true, `${scenario.id}: ${JSON.stringify(out.steps.filter((s) => !s.ok))}`);
      }
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it("labels each scenario with the weakest of its rows (chill is inferred)", async () => {
    const reg = () => inProcessTransport(new MockDtcRegistry({ profile }));
    const trust = await Promise.all(FIVE_SCENARIOS.map(async (s) => [s.id, (await runScripted(reg(), s, profile)).trust]));
    assert.deepEqual(Object.fromEntries(trust), {
      "SBX-1-register-wallet": "published",
      "SBX-2-ofac-fail": "published",
      "SBX-3-convert": "inferred",
      "SBX-4-chill": "inferred",
      "SBX-5-force-transfer": "published",
    });
  });

  it("is deterministic: the same scenario gives byte-identical transcripts", async () => {
    const a = await runScripted(inProcessTransport(new MockDtcRegistry({ profile })), FIVE_SCENARIOS[2]!, profile);
    const b = await runScripted(inProcessTransport(new MockDtcRegistry({ profile })), FIVE_SCENARIOS[2]!, profile);
    assert.equal(JSON.stringify(a), JSON.stringify(b));
  });

  it("a failing expectation is reported, not thrown", async () => {
    const broken = { ...FIVE_SCENARIOS[0]!, steps: [{ ...FIVE_SCENARIOS[0]!.steps[0]!, expect: { status: 202, body: { status: "Completed" } } }] };
    const out = await runScripted(inProcessTransport(new MockDtcRegistry({ profile })), broken, profile);
    assert.equal(out.passed, false);
    assert.match(out.steps[0]?.detail ?? "", /status/);
  });
});
