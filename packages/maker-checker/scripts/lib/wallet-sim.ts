// SPDX-License-Identifier: Apache-2.0
// DEMO wallet simulator (MKR-037). Stands in for the approvers' wallets and the signing desks in a local demo:
// throwaway testnet keys generated at runtime live in this process's memory only. It is mounted under /demo/
// next to the API but is not part of it: the API never sees a key. Production approvers use their own wallets
// (SEP-43 adapter, MKR-020, not built yet).
import type { IncomingMessage, ServerResponse } from "node:http";
import { MkrError } from "../../src/errors.ts";
import type { RequestService } from "../../src/service/requests.ts";
import type { World } from "./world.ts";
import { readIsFrozen, EXPLORER_CONTRACT, EXPLORER_TX } from "./world.ts";

export function worldInfo(world: World, policyHash: string) {
  return {
    network: "testnet",
    rpcUrl: world.rpcUrl,
    token: world.token,
    xlmSac: world.xlmSac,
    holder: world.holder,
    treasuryRecipient: world.treasuryRecipient,
    policyHash,
    principals: world.policy.principals,
    signers: world.signerInfo,
    deploy: world.deploy,
    explorer: { tx: EXPLORER_TX, contract: EXPLORER_CONTRACT },
    walletSimulator: "Throwaway testnet keys generated when this process started; held in memory only; never written or returned.",
  };
}

function json(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}

export function walletRoutes(world: World, svc: RequestService, policyHash: string) {
  return async (req: IncomingMessage, res: ServerResponse, body: unknown): Promise<boolean> => {
    const url = new URL(req.url ?? "/", "http://local");
    if (!url.pathname.startsWith("/demo/")) return false;
    const b = (body ?? {}) as Record<string, string>;
    try {
      if (url.pathname === "/demo/world" && req.method === "GET") return (json(res, 200, worldInfo(world, policyHash)), true);
      if (url.pathname === "/demo/wallet/sign-message" && req.method === "POST") {
        const w = world.principals[b.principal ?? ""];
        if (!w) throw new MkrError("MKR_E_SIGNER_UNAVAILABLE", `no wallet for ${b.principal}`);
        const r = await w.signMessage({ message: String(b.message), address: w.address, requestId: String(b.requestId ?? "") });
        if (r.status !== "signed") throw new MkrError("MKR_E_SIGNER_DECLINED", "declined");
        return (json(res, 200, { signatureBase64: r.signatureBase64, address: r.signerAddress }), true);
      }
      if (url.pathname === "/demo/wallet/sign-auth-entry" && req.method === "POST") {
        const st = svc.get(String(b.requestId));
        const slot = st.plan?.slots.find((s) => s.slotId === b.slotId);
        if (!slot) throw new MkrError("MKR_E_AUTH_SLOT_UNKNOWN", "no such slot");
        const id = b.signerId === "alice-device" ? "operator-key" : String(b.signerId);
        const s = world.signers[id];
        if (!s) throw new MkrError("MKR_E_SIGNER_UNAVAILABLE", `no signer ${b.signerId}`);
        const r = await s.signAuthEntry({ networkPassphrase: world.passphrase, entryXdr: slot.entryXdr, validUntil: slot.signatureExpirationLedger, preimageXdr: "", preimageHash: slot.preimageHash, nodePath: "0", address: slot.address, summary: st.record.request.summary.tree, requestId: st.record.request.id, slotId: slot.slotId });
        if (r.status !== "signed") throw new MkrError("MKR_E_SIGNER_DECLINED", "declined");
        return (json(res, 200, { signedEntryXdr: r.entryXdr, signerAddress: r.signerAddress }), true);
      }
      if (url.pathname === "/demo/wallet/sign-envelope" && req.method === "POST") {
        const st = svc.get(String(b.requestId));
        if (!st.envelope) throw new MkrError("MKR_E_TRANSITION_ILLEGAL", "assemble first");
        const s = world.signers[String(b.signerId)];
        if (!s) throw new MkrError("MKR_E_SIGNER_UNAVAILABLE", `no signer ${b.signerId}`);
        const r = await s.signTransaction({ networkPassphrase: world.passphrase, envelopeXdr: st.envelope.envelopeXdr, address: s.address, summary: st.record.request.summary.tree, requestId: st.record.request.id });
        if (r.status !== "signed") throw new MkrError("MKR_E_SIGNER_DECLINED", "declined");
        return (json(res, 200, { signedEnvelopeXdr: r.envelopeXdr }), true);
      }
      if (url.pathname === "/demo/read/is-frozen" && req.method === "GET") {
        const r = await readIsFrozen(world, url.searchParams.get("address") ?? world.holder);
        return (json(res, 200, { ...r, readAt: new Date().toISOString().slice(0, 19) + "Z", kind: "live read (simulation, testnet)" }), true);
      }
    } catch (e) {
      const code = e instanceof MkrError ? e.code : "MKR_E_INTERNAL";
      return (json(res, e instanceof MkrError ? 422 : 500, { code, message: (e as Error).message }), true);
    }
    return (json(res, 404, { code: "MKR_E_USAGE", message: "no demo route" }), true);
  };
}
