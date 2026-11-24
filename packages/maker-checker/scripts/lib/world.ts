// SPDX-License-Identifier: Apache-2.0
// Testnet demo world (MKR-031/037): throwaway keys generated at runtime (never written), friendbot funding,
// deploy of the DEMO-ONLY RWA token wasm, and a PolicyDoc built around those public addresses.
// Testnet only (G-VALUE). Nothing here can reach mainnet: assertTestnet guards every write path.
import { readFileSync } from "node:fs";
import { Address, Asset, Contract, Keypair, nativeToScVal, Networks, Operation, rpc, scValToNative, TransactionBuilder } from "@stellar/stellar-sdk";
import type { Transaction } from "@stellar/stellar-sdk";
import { createRpcAuthDeps, assertTestnet, friendbotFund, getAccountWithRetry, TESTNET_RPC } from "../../src/net/rpc.ts";
import type { AuthDeps } from "../../src/auth/plan.ts";
import { sha256Hex, bytesToHex } from "../../src/hash.ts";
import { unixToIso } from "../../src/policy/parse.ts";
import type { PolicyDoc } from "../../src/policy/types.ts";
import { StubSigner } from "../../src/signer/stub.ts";

export const WASM_PATH = new URL("../../../../fixtures/maker-checker/wasm/rwa-demo.wasm", import.meta.url);
export const EXPLORER_TX = "https://stellar.expert/explorer/testnet/tx/";
export const EXPLORER_CONTRACT = "https://stellar.expert/explorer/testnet/contract/";

export interface SignerInfo {
  signerId: string;
  address: string;
  /** Principal the signer registry maps this signer to (S3). */
  heldBy: string;
  purpose: string;
}

export interface World {
  rpcUrl: string;
  passphrase: string;
  server: rpc.Server;
  deps: AuthDeps;
  /** SEP-53 attestation wallets, one per principal. */
  principals: Record<string, StubSigner>;
  /** Transaction / auth-entry signers, by signer id. */
  signers: Record<string, StubSigner>;
  signerInfo: SignerInfo[];
  registry: Record<string, string>;
  token: string;
  xlmSac: string;
  holder: string;
  treasuryRecipient: string;
  deploy: { wasmSha256: string; wasmHash: string; uploadTx: string; deployTx: string; deployLedger: number };
  policy: PolicyDoc;
}

export const PRINCIPALS = [
  { id: "admin-dana", label: "Dana (policy admin, runs the operations desk)", roles: ["admin"] },
  { id: "checker-bob", label: "Bob (checker)", roles: ["checker"] },
  { id: "checker-carol", label: "Carol (checker)", roles: ["checker"] },
  { id: "maker-alice", label: "Alice (maker)", roles: ["maker"] },
] as const;

async function sendAndWait(server: rpc.Server, tx: Transaction): Promise<rpc.Api.GetSuccessfulTransactionResponse> {
  const sent = await server.sendTransaction(tx);
  if (sent.status === "ERROR") throw new Error(`send failed: ${sent.errorResult?.toXdr("base64")}`);
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 1500));
    const r = await server.getTransaction(sent.hash);
    if (r.status === "SUCCESS") return r;
    if (r.status === "FAILED") throw new Error(`tx ${sent.hash} failed`);
  }
  throw new Error(`tx ${sent.hash} timed out`);
}

async function prepareSignSend(server: rpc.Server, signer: StubSigner, passphrase: string, build: (b: TransactionBuilder) => TransactionBuilder) {
  const acct = await getAccountWithRetry(server, signer.address);
  const tx = build(new TransactionBuilder(acct, { fee: "1000000", networkPassphrase: passphrase })).setTimeout(300).build();
  const prepared = await server.prepareTransaction(tx);
  const r = await signer.signTransaction({ networkPassphrase: passphrase, envelopeXdr: prepared.toXDR(), address: signer.address, summary: [], requestId: "setup" });
  if (r.status !== "signed") throw new Error("setup signer declined");
  return sendAndWait(server, TransactionBuilder.fromXDR(r.envelopeXdr, passphrase) as Transaction);
}

export function buildPolicy(w: { principals: Record<string, StubSigner>; token: string; xlmSac: string; treasuryRecipient: string; nowUnix: number; cooldownSeconds: number }): PolicyDoc {
  return {
    version: 1,
    id: "mkr-testnet-demo",
    name: "Testnet demo: SEP-57 control actions and a treasury transfer rule (runtime addresses)",
    network: { name: "testnet", passphrase: Networks.TESTNET },
    validity: { notBefore: unixToIso(w.nowUnix - 60), expiresAt: unixToIso(w.nowUnix + 30 * 86400) },
    principals: PRINCIPALS.map((p) => ({ id: p.id, label: p.label, roles: [...p.roles], address: w.principals[p.id]!.address, attestation: ["stellar-sep53" as const] })),
    separation: { makerCannotSign: true },
    requestTtlSeconds: 86400,
    authEntryTtlLedgers: 720,
    rules: [
      {
        id: "allow-rwa-control",
        effect: "allow",
        description: "SEP-57 control actions on the demo RWA token need two checkers and one admin, then a cooldown. No time window so the demo runs any day.",
        match: {
          targets: [{ contract: w.token, functions: [{ name: "forced_transfer", amountArg: 2, recipientArg: 1 }, { name: "pause" }, { name: "set_address_frozen" }, { name: "unpause" }] }],
          controlKinds: ["forced_transfer", "freeze", "pause", "unfreeze", "unpause"],
        },
        makers: ["maker-alice"],
        approval: { checkers: { min: 2, from: ["checker-bob", "checker-carol"] }, admins: { min: 1, from: ["admin-dana"] } },
        cooldownSeconds: w.cooldownSeconds,
      },
      {
        id: "allow-treasury-xlm",
        effect: "allow",
        description: "Native XLM transfers to the one listed recipient, at most 1,000 XLM per request and 2,000 XLM per 24 h, one checker.",
        match: { targets: [{ contract: w.xlmSac, functions: [{ name: "transfer", amountArg: 2, recipientArg: 1, recipients: [w.treasuryRecipient] }] }] },
        makers: ["maker-alice"],
        approval: { checkers: { min: 1, from: ["checker-bob", "checker-carol"] } },
        limits: { perRequest: [{ contract: w.xlmSac, max: "10000000000" }], rolling: [{ contract: w.xlmSac, windowSeconds: 86400, max: "20000000000" }] },
      },
      {
        id: "deny-rwa-mint-burn",
        effect: "deny",
        description: "Minting and burning never go through this layer.",
        match: { targets: [{ contract: w.token, functions: [{ name: "burn" }, { name: "mint" }] }] },
      },
    ],
  };
}

export async function createWorld(opts: { rpcUrl?: string; cooldownSeconds: number; log?: (m: string) => void }): Promise<World> {
  const rpcUrl = opts.rpcUrl ?? TESTNET_RPC;
  const passphrase = Networks.TESTNET;
  assertTestnet(passphrase);
  const log = opts.log ?? (() => undefined);
  const { deps, server } = createRpcAuthDeps({ rpcUrl, networkPassphrase: passphrase });
  const principals = Object.fromEntries(PRINCIPALS.map((p) => [p.id, new StubSigner(`${p.id}-sep53`)]));
  const operator = new StubSigner("operator-key");
  const feePayer = new StubSigner("fee-payer-key");
  const signers: Record<string, StubSigner> = { "operator-key": operator, "fee-payer-key": feePayer };
  const signerInfo: SignerInfo[] = [
    { signerId: "operator-key", address: operator.address, heldBy: "admin-dana", purpose: "Token operator: signs the Soroban authorisation entry for set_address_frozen" },
    { signerId: "fee-payer-key", address: feePayer.address, heldBy: "checker-carol", purpose: "Transaction source: pays the fee and signs the envelope" },
    { signerId: "alice-device", address: operator.address, heldBy: "maker-alice", purpose: "The operator key reached from the maker's device: used once to show S3 refuses it" },
  ];
  const registry = Object.fromEntries(signerInfo.map((s) => [s.signerId, s.heldBy]));
  const holder = Keypair.random().publicKey();
  const treasuryRecipient = Keypair.random().publicKey();
  log(`funding operator ${operator.address} and fee payer ${feePayer.address} with friendbot (testnet)`);
  await friendbotFund(operator.address, server);
  await friendbotFund(feePayer.address, server);
  await friendbotFund(treasuryRecipient, server);

  const wasm = readFileSync(WASM_PATH);
  log(`uploading rwa-demo.wasm (${wasm.length} bytes)`);
  const up = await prepareSignSend(server, feePayer, passphrase, (b) => b.addOperation(Operation.uploadContractWasm({ wasm })));
  const wasmHash = up.returnValue ? bytesToHex(scValToNative(up.returnValue) as Uint8Array) : sha256Hex(wasm);
  const salt = new Uint8Array(32);
  crypto.getRandomValues(salt);
  log("deploying the token with the operator as its only operator");
  const dep = await prepareSignSend(server, feePayer, passphrase, (b) =>
    b.addOperation(
      Operation.createCustomContract({
        address: new Address(feePayer.address),
        wasmHash: Buffer.from(wasmHash, "hex"),
        salt: Buffer.from(salt),
        constructorArgs: [new Address(operator.address).toScVal(), nativeToScVal(7, { type: "u32" }), nativeToScVal("MKR Demo RWA", { type: "string" }), nativeToScVal("MKRD", { type: "string" })],
      }),
    ),
  );
  const token = Address.fromScVal(dep.returnValue!).toString();
  log(`token ${token}`);
  const xlmSac = Asset.native().contractId(passphrase);
  const nowUnix = Math.floor(Date.now() / 1000);
  const policy = buildPolicy({ principals, token, xlmSac, treasuryRecipient, nowUnix, cooldownSeconds: opts.cooldownSeconds });
  return {
    rpcUrl, passphrase, server, deps, principals, signers, signerInfo, registry, token, xlmSac, holder, treasuryRecipient, policy,
    deploy: { wasmSha256: sha256Hex(wasm), wasmHash, uploadTx: up.txHash, deployTx: dep.txHash, deployLedger: dep.ledger },
  };
}

/** Live read of is_frozen(address) by simulation (no write). */
export async function readIsFrozen(world: Pick<World, "server" | "passphrase" | "token" | "signers">, address: string): Promise<{ frozen: boolean; latestLedger: number }> {
  const src = await getAccountWithRetry(world.server, world.signers["fee-payer-key"]!.address);
  const tx = new TransactionBuilder(src, { fee: "100", networkPassphrase: world.passphrase }).addOperation(new Contract(world.token).call("is_frozen", new Address(address).toScVal())).setTimeout(60).build();
  const sim = await world.server.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(sim)) throw new Error(sim.error);
  return { frozen: Boolean(scValToNative(sim.result!.retval)), latestLedger: sim.latestLedger };
}
