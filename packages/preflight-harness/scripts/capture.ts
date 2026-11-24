// SPDX-License-Identifier: Apache-2.0
// PFH-020 manual capture: read-only snapshot of public accounts/contracts, printed as JSON (no writes anywhere).
//   node scripts/capture.ts --network testnet --accounts G...,G... [--contracts C...] [--rpc URL] [--horizon URL]
import { setDefaultResultOrder } from "node:dns";
import { setDefaultAutoSelectFamily } from "node:net";
import { parseArgs } from "node:util";
import { captureSnapshot } from "../src/fixtures/capture.ts";

// This machine has no IPv6 route; Node's dual-stack connect races time out on Cloudflare-fronted hosts.
setDefaultResultOrder("ipv4first");
setDefaultAutoSelectFamily(false);
const { values } = parseArgs({ options: { network: { type: "string" }, accounts: { type: "string" }, contracts: { type: "string" }, rpc: { type: "string" }, horizon: { type: "string" } } });
const network = values.network === "mainnet" ? "mainnet" : "testnet";
const horizonUrl = values.horizon ?? (network === "mainnet" ? "https://horizon.stellar.org" : "https://horizon-testnet.stellar.org");
const rpcUrl = values.rpc ?? (network === "testnet" ? "https://soroban-testnet.stellar.org" : "");
if (!rpcUrl) {
  process.stderr.write("mainnet has no default public RPC here: pass --rpc <url> (read-only methods only)\n");
  process.exit(2);
}
const split = (s?: string) => (s ? s.split(",").map((x) => x.trim()).filter(Boolean) : []);
const result = await captureSnapshot({ network, horizonUrl, rpcUrl, accounts: split(values.accounts), contracts: split(values.contracts), sacHolders: [], simulate: [], script: "scripts/capture.ts" });
process.stdout.write(JSON.stringify(result, null, 2) + "\n");
