// SPDX-License-Identifier: Apache-2.0
import { CAPABILITIES } from "@sik/dtc-kit-core";
import type { AddressRequest, CapabilityMatrix, ChainActionKind, ChainActionPlan, ChainAdapter, Tokens, TransferRequest } from "@sik/dtc-kit-core";

/**
 * The default adapter of the sandbox: an in-memory ledger, not a chain. Its plans are one step each and say
 * so; they exist so the registry exercises the same port a Stellar adapter fills (SPEC 3). Nothing here is
 * evidence about any real ledger.
 */
export class SandboxLedgerAdapter implements ChainAdapter {
  readonly id = "sandbox-ledger";

  capabilityMatrix(): CapabilityMatrix {
    const m = {} as CapabilityMatrix;
    for (const c of CAPABILITIES) {
      m[c] = {
        capability: c,
        support: "native",
        mechanism: "in-memory sandbox ledger (not a blockchain)",
        caveats: ["Sandbox only: says nothing about Stellar or any other ledger."],
        evidence: "I",
        profileRows: [],
      };
    }
    return m;
  }

  private plan(action: ChainActionKind, params: Record<string, string | bigint | boolean>): ChainActionPlan {
    return {
      adapterId: this.id,
      action,
      atomic: true,
      steps: [{ op: `sandbox.${action}`, signer: "dtc-sandbox", params }],
      preconditions: [],
      caveats: ["In-memory sandbox ledger; no transaction exists."],
      trust: "unknown",
      rows: [],
    };
  }

  planAllowlistAdd(req: AddressRequest): ChainActionPlan {
    return this.plan("allowlist-add", { address: req.address });
  }
  planAllowlistRemove(req: AddressRequest): ChainActionPlan {
    return this.plan("allowlist-remove", { address: req.address });
  }
  planRestrict(req: AddressRequest & { inbound: boolean; outbound: boolean }): ChainActionPlan {
    return this.plan("restrict", { address: req.address, inbound: req.inbound, outbound: req.outbound });
  }
  planUnrestrict(req: AddressRequest): ChainActionPlan {
    return this.plan("unrestrict", { address: req.address });
  }
  planMint(req: AddressRequest & { tokens: Tokens }): ChainActionPlan {
    return this.plan("mint", { address: req.address, tokens: req.tokens });
  }
  planBurn(req: AddressRequest & { tokens: Tokens }): ChainActionPlan {
    return this.plan("burn", { address: req.address, tokens: req.tokens });
  }
  planForceTransfer(req: TransferRequest): ChainActionPlan {
    return this.plan("force-transfer", { from: req.address, to: req.to, tokens: req.tokens });
  }
}
