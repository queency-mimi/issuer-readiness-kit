// SPDX-License-Identifier: Apache-2.0
// MKR-037: `pnpm demo:serve`. Starts the maker-checker HTTP API on 127.0.0.1:8787 against testnet, with the
// DEMO wallet simulator mounted under /demo/ for the web console's live tab.
// On start it creates a fresh testnet world (throwaway keys in memory, friendbot, token deploy) and registers
// the demo policy as admin-dana. Testnet only (G-VALUE). Stop with Ctrl-C; the keys vanish with the process.
import { mkdirSync } from "node:fs";
import { startServer } from "../src/api/server.ts";
import { FileAuditStore } from "../src/audit/file-store.ts";
import { AuditLog } from "../src/audit/log.ts";
import { RequestService } from "../src/service/requests.ts";
import { createRpcSubmitter } from "../src/service/submit.ts";
import { createWorld } from "./lib/world.ts";
import { walletRoutes } from "./lib/wallet-sim.ts";

const port = Number(process.env.MKR_PORT ?? 8787);
const cooldown = Number(process.env.MKR_COOLDOWN ?? 30);
const log = (m: string) => process.stderr.write(`[demo] ${m}\n`);

let world: Awaited<ReturnType<typeof createWorld>>;
try {
  world = await createWorld({ rpcUrl: process.env.MKR_RPC, cooldownSeconds: cooldown, log });
} catch (e) {
  process.stderr.write(`[demo] could not set up the testnet world: ${(e as Error).message}\n[demo] nothing was started. Check the network and retry; the Recorded run tab works without this server.\n`);
  process.exit(1);
}
const dir = new URL("../out/demo-" + Date.now() + "/", import.meta.url).pathname;
mkdirSync(dir, { recursive: true });
const svc = new RequestService({
  audit: new AuditLog(new FileAuditStore(dir + "audit.jsonl")),
  auth: world.deps,
  submitter: createRpcSubmitter({ server: world.server, networkPassphrase: world.passphrase }),
  clock: () => Math.floor(Date.now() / 1000),
  signerPrincipal: (s) => world.registry[s],
});
const policy = await svc.registerPolicy(world.policy, "admin-dana");
// Vite dev (5173) and preview (4173) move to the next free port when it is taken, so allow a small range.
const ports = [...Array.from({ length: 10 }, (_, i) => String(5173 + i)), ...Array.from({ length: 10 }, (_, i) => String(4173 + i))];
const origins = ports.flatMap((p) => [`http://localhost:${p}`, `http://127.0.0.1:${p}`]);
const srv = await startServer({
  service: svc,
  port,
  corsOrigins: origins,
  onInternalError: (e) => log(`internal error behind a 500: ${(e as Error).message?.slice(0, 300)}`),
  // Demo identity: the console's "acting as" switch sends `Bearer demo:<principal>`. A host maps real tokens.
  authenticate: (t) => (t.startsWith("demo:") && world.policy.principals.some((p) => `demo:${p.id}` === t) ? t.slice(5) : undefined),
  extraRoutes: walletRoutes(world, svc, policy.policyHash),
});
log(`API ${srv.url}/v1  (policy ${policy.policyHash.slice(0, 12)}…, token ${world.token}, cooldown ${cooldown} s)`);
log(`audit log ${dir}audit.jsonl`);
log("open the web console (pnpm --dir web dev) and choose the Live tab");
process.on("SIGINT", () => {
  void srv.close().then(() => process.exit(0));
});
