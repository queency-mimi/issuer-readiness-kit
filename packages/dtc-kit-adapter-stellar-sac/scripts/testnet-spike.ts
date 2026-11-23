// SPDX-License-Identifier: Apache-2.0
// Spikes DTC-020 (atomic clawback + issuer payment), DTC-022 SAC half (fractional payment), DTC-023 partial
// (allowlist add/remove, mint, force transfer) and SC-029 (authorise a missing trustline) on Stellar TESTNET.
//
// Every DTC-side transaction submitted here is built from a StellarSacAdapter plan (operationsFromPlan), so
// the fixture is evidence about what the adapter plans, not about hand-written operations.
//
// Keys: throwaway keypairs generated at runtime with Keypair.random(), funded by Friendbot, never written,
// never logged (G-SECRETS). Only public keys, hashes, ledgers and result codes are stored. Testnet only
// (G-VALUE): the Horizon URL is hard-coded to testnet and the adapter refuses any other network.
//
// Run: node packages/dtc-kit-adapter-stellar-sac/scripts/testnet-spike.ts    (network required, about 1-2 minutes)
import { setDefaultResultOrder } from "node:dns";
import { Asset, AuthClawbackEnabledFlag, AuthRequiredFlag, AuthRevocableFlag, Horizon, Keypair, Networks, Operation, TransactionBuilder } from "@stellar/stellar-sdk";
import type { Transaction, xdr } from "@stellar/stellar-sdk";
import { loadBundledProfile, resolveProfile } from "@sik/dtc-kit-profile-spec";
import { writeFixture } from "../../../scripts/dtc-kit/capture-fixture.ts";
import { StellarSacAdapter, operationsFromPlan } from "../src/index.ts";

const HORIZON = "https://horizon-testnet.stellar.org";
const FRIENDBOT = "https://friendbot.stellar.org";
const ASSET_CODE = "SBXTKN";
const LEDGER = "stellar-testnet";
const CUSIP = "SBX000AA0";

// Friendbot is unreachable over IPv6 from some networks (seen 2026-11-08); prefer IPv4.
setDefaultResultOrder("ipv4first");
const server = new Horizon.Server(HORIZON);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface StepRecord {
  step: string;
  scenario?: string;
  question: string;
  planAction?: string;
  submittedBy: string;
  operations: string[];
  hash: string | null;
  ledger: number | null;
  successful: boolean;
  resultCodes: { transaction?: string; operations?: string[] } | null;
  envelopeXdr: string;
  balancesAfter: Record<string, string>;
}

async function fund(pub: string): Promise<void> {
  for (let i = 0; i < 3; i++) {
    const r = await fetch(`${FRIENDBOT}?addr=${encodeURIComponent(pub)}`);
    if (r.ok) return;
    await sleep(2000);
  }
  throw new Error(`friendbot failed for ${pub}`);
}

async function balanceOf(pub: string, asset: Asset): Promise<string> {
  const acc = await server.loadAccount(pub);
  const line = acc.balances.find((b) => "asset_code" in b && b.asset_code === asset.getCode() && "asset_issuer" in b && b.asset_issuer === asset.getIssuer());
  return line ? line.balance : "no-trustline";
}

async function main(): Promise<void> {
  const profile = resolveProfile(loadBundledProfile("dtc-stellar"));
  const issuer = Keypair.random();
  const a = Keypair.random();
  const b = Keypair.random();
  const c = Keypair.random();
  const roles: Record<string, Keypair> = { issuer, holderA: a, holderB: b, holderC_noTrustline: c };
  const startedAt = new Date().toISOString();
  console.log("funding four throwaway testnet accounts via Friendbot ...");
  for (const k of Object.values(roles)) {
    await fund(k.publicKey());
    await sleep(600);
  }

  const asset = new Asset(ASSET_CODE, issuer.publicKey());
  const adapter = new StellarSacAdapter({ network: "testnet", assetCode: ASSET_CODE, issuerAccount: issuer.publicKey(), profile });
  const steps: StepRecord[] = [];

  async function submit(step: Omit<StepRecord, "hash" | "ledger" | "successful" | "resultCodes" | "envelopeXdr" | "balancesAfter" | "operations">, signer: Keypair, ops: xdr.Operation[]): Promise<StepRecord> {
    const account = await server.loadAccount(signer.publicKey());
    const builder = new TransactionBuilder(account, { fee: "1000", networkPassphrase: Networks.TESTNET });
    for (const op of ops) builder.addOperation(op);
    const tx: Transaction = builder.setTimeout(120).build();
    tx.sign(signer);
    let hash: string | null = Buffer.from(tx.hash()).toString("hex");
    let successful = false;
    let resultCodes: StepRecord["resultCodes"] = null;
    let ledger: number | null = null;
    try {
      const res = await server.submitTransaction(tx);
      successful = res.successful;
      ledger = res.ledger;
    } catch (e) {
      const extras = (e as { response?: { data?: { extras?: { result_codes?: { transaction?: string; operations?: string[] }; hash?: string } } } }).response?.data?.extras;
      resultCodes = extras?.result_codes ?? { transaction: String((e as Error).message) };
      hash = extras?.hash ?? hash;
      await sleep(5500);
      try {
        const rec = await server.transactions().transaction(hash).call();
        ledger = rec.ledger_attr;
        successful = rec.successful;
      } catch {
        ledger = null; // rejected before inclusion (no ledger)
      }
    }
    const balancesAfter: Record<string, string> = {};
    for (const [n, k] of Object.entries(roles)) if (n !== "issuer") balancesAfter[n] = await balanceOf(k.publicKey(), asset);
    const rec: StepRecord = { ...step, operations: tx.operations.map((o) => o.type), hash, ledger, successful, resultCodes, envelopeXdr: tx.toXDR(), balancesAfter };
    steps.push(rec);
    console.log(`${successful ? "OK  " : "FAIL"} ${step.step} ledger=${ledger ?? "-"} ${resultCodes ? JSON.stringify(resultCodes) : ""}`);
    await sleep(600);
    return rec;
  }

  const planned = (p: ReturnType<StellarSacAdapter["planMint"]>) => operationsFromPlan(p, asset);
  const req = (who: Keypair) => ({ ledger: LEDGER, address: who.publicKey(), cusip: CUSIP });

  await submit({ step: "issuer sets AUTH_REQUIRED, AUTH_REVOCABLE, AUTH_CLAWBACK_ENABLED (before any trustline)", question: "setup", submittedBy: "issuer" }, issuer, [
    Operation.setOptions({ setFlags: (AuthRequiredFlag | AuthRevocableFlag | AuthClawbackEnabledFlag) as never }),
  ]);
  await submit({ step: "holder A opens a trustline (participant step)", question: "setup", submittedBy: "holderA" }, a, [Operation.changeTrust({ asset })]);
  await submit({ step: "holder B opens a trustline (participant step)", question: "setup", submittedBy: "holderB" }, b, [Operation.changeTrust({ asset })]);
  await submit(
    { step: "DTC allowlists A (adapter plan allowlist-add)", question: "Does set_trust_line_flags(authorized) on an existing trustline register the wallet on-chain?", planAction: "allowlist-add", submittedBy: "issuer" },
    issuer,
    planned(adapter.planAllowlistAdd(req(a))),
  );
  await submit({ step: "DTC allowlists B (adapter plan allowlist-add)", question: "same", planAction: "allowlist-add", submittedBy: "issuer" }, issuer, planned(adapter.planAllowlistAdd(req(b))));
  await submit(
    { step: "SC-029: DTC tries to allowlist C, which has no trustline", scenario: "SC-029", question: "Can DTC authorise a trustline that does not exist yet?", planAction: "allowlist-add", submittedBy: "issuer" },
    issuer,
    planned(adapter.planAllowlistAdd(req(c))),
  );
  await submit({ step: "DTC mints 10 to A (adapter plan mint = issuer payment)", question: "mint", planAction: "mint", submittedBy: "issuer" }, issuer, planned(adapter.planMint({ ...req(a), tokens: 10n })));
  await submit(
    { step: "SC-019 main: DTC force-transfers 10 A -> B in one transaction [clawback, payment], issuer signs only", scenario: "SC-019", question: "Is clawback + issuer payment in one transaction a transfer without the holder's signature?", planAction: "force-transfer", submittedBy: "issuer" },
    issuer,
    planned(adapter.planForceTransfer({ ...req(a), to: b.publicKey(), tokens: 10n })),
  );
  await submit({ step: "DTC mints 10 more to A", question: "setup for the variant", planAction: "mint", submittedBy: "issuer" }, issuer, planned(adapter.planMint({ ...req(a), tokens: 10n })));
  await submit({ step: "DTC deauthorises B (adapter plan allowlist-remove)", question: "setup for the variant", planAction: "allowlist-remove", submittedBy: "issuer" }, issuer, planned(adapter.planAllowlistRemove(req(b))));
  await submit(
    { step: "SC-019 variant: force transfer 10 A -> B while B is deauthorised", scenario: "SC-019", question: "If the payment leg fails, does the clawback leg fail too (atomicity)?", planAction: "force-transfer", submittedBy: "issuer" },
    issuer,
    planned(adapter.planForceTransfer({ ...req(a), to: b.publicKey(), tokens: 10n })),
  );
  await submit(
    { step: "deny path: holder A pays 1 to deauthorised B", scenario: "SC-009", question: "Does the ledger itself refuse a holder transfer to a non-authorised wallet?", submittedBy: "holderA" },
    a,
    [Operation.payment({ destination: b.publicKey(), asset, amount: "1" })],
  );
  await submit(
    { step: "deny path: holder A pays 1 to C (no trustline)", scenario: "SC-006", question: "Does the ledger refuse a transfer to an address with no trustline?", submittedBy: "holderA" },
    a,
    [Operation.payment({ destination: c.publicKey(), asset, amount: "1" })],
  );
  await submit({ step: "DTC re-authorises B (adapter plan unrestrict)", question: "setup", planAction: "unrestrict", submittedBy: "issuer" }, issuer, planned(adapter.planUnrestrict(req(b))));
  await submit(
    { step: "SC-031: holder A pays 0.5 tokens to B", scenario: "SC-031", question: "Can a classic asset refuse a fractional amount at ledger level?", submittedBy: "holderA" },
    a,
    [Operation.payment({ destination: b.publicKey(), asset, amount: "0.5" })],
  );

  const ledgers = [...new Set(steps.map((s) => s.ledger).filter((l): l is number => l !== null))].sort((x, y) => x - y);
  const data = {
    kind: "dtc-kit/testnet-sac-spike",
    network: "testnet",
    networkPassphrase: Networks.TESTNET,
    horizon: HORIZON,
    startedAt,
    finishedAt: new Date().toISOString(),
    asset: { code: ASSET_CODE, issuer: issuer.publicKey() },
    accounts: Object.fromEntries(Object.entries(roles).map(([n, k]) => [n, k.publicKey()])),
    note: "Throwaway keypairs generated at runtime and discarded; no private key is stored. Accounts and asset are fictional sandbox objects on Stellar testnet. DTC-shaped, not DTC-certified.",
    steps,
  };
  const prov = writeFixture("sac-force-transfer/testnet-run.json", data, {
    script: "packages/dtc-kit-adapter-stellar-sac/scripts/testnet-spike.ts",
    sourceKind: "testnet-tx",
    sourceUrl: HORIZON,
    capturedAt: data.finishedAt,
    ledgers,
    network: "testnet",
    notes: "Throwaway keys generated at runtime with Keypair.random(), funded by Friendbot, never stored. Transactions built from StellarSacAdapter plans.",
  });
  console.log(`wrote fixtures/${prov.fixture} (${steps.length} steps, ledgers ${ledgers[0]}..${ledgers.at(-1)})`);
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
