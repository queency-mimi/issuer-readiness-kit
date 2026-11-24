// SPDX-License-Identifier: Apache-2.0
// `mkr` CLI (SPEC 11): a thin client over the same library as the server. Nothing here accepts a key.
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { Networks } from "@stellar/stellar-sdk";
import { startServer } from "./api/server.ts";
import { mergeBundles } from "./auth/bundle.ts";
import type { AuthBundle } from "./auth/types.ts";
import { toCsv, toJsonl } from "./audit/export.ts";
import { FileAuditStore } from "./audit/file-store.ts";
import { AuditLog, verifyEntries } from "./audit/log.ts";
import { canonicalize } from "./canonical.ts";
import { buildControlAction } from "./control/sep57.ts";
import type { ControlActionParams } from "./control/sep57.ts";
import { MkrError, NotImplemented } from "./errors.ts";
import { createRpcAuthDeps } from "./net/rpc.ts";
import { evaluate } from "./policy/evaluate.ts";
import { policyHash } from "./policy/hash.ts";
import { isoToUnix, parsePolicyDoc } from "./policy/parse.ts";
import { RequestService } from "./service/requests.ts";
import { createRpcSubmitter } from "./service/submit.ts";

export const VERSION = "0.1.0";

/**
 * Command table (SPEC section 11). `ticket` is the task that implements the command.
 * Exit codes: 0 ok, 1 denied or verification failed, 2 usage/input error, 3 network error, 70 not implemented.
 */
export const COMMANDS: { name: string; usage: string; ticket: string }[] = [
  { name: "policy canonicalize", usage: "mkr policy canonicalize <file>", ticket: "MKR-001" },
  { name: "policy hash", usage: "mkr policy hash <file>", ticket: "MKR-001" },
  { name: "policy validate", usage: "mkr policy validate <file> [--json]", ticket: "MKR-002" },
  { name: "policy eval", usage: "mkr policy eval --policy <file> --request <file> [--now <iso>] [--json]", ticket: "MKR-003" },
  { name: "request propose", usage: "mkr request propose --policy-hash <hex> --maker <id> --request <file> --state <dir> --rpc <url>", ticket: "MKR-009" },
  { name: "request show", usage: "mkr request show <id> --state <dir> [--json]", ticket: "MKR-009" },
  { name: "request list", usage: "mkr request list --state <dir> [--json]", ticket: "MKR-009" },
  { name: "request approve", usage: "mkr request approve <id> --approver <id> --at <iso> --nonce <n> --attest <sep53|host> [--address <G> --signature <b64>] [--asserted-by <s>] --state <dir>", ticket: "MKR-009" },
  { name: "request reject", usage: "mkr request reject <id> --approver <id> --at <iso> --nonce <n> --attest <sep53|host> [--address <G> --signature <b64>] [--asserted-by <s>] --state <dir>", ticket: "MKR-009" },
  { name: "request cancel", usage: "mkr request cancel <id> --by <id> --state <dir>", ticket: "MKR-009" },
  { name: "approval statement", usage: "mkr approval statement <id> --approver <id> --decision <approve|reject> --state <dir>", ticket: "MKR-006" },
  { name: "auth plan", usage: "mkr auth plan <id> --rpc <url> --state <dir>", ticket: "MKR-010" },
  { name: "auth merge", usage: "mkr auth merge <bundle.json>...", ticket: "MKR-013" },
  { name: "auth collect", usage: "mkr auth collect <id> --signer <adapter-id> --state <dir>", ticket: "MKR-020" },
  { name: "auth assemble", usage: "mkr auth assemble <id> --rpc <url> --state <dir>", ticket: "MKR-015" },
  { name: "control build", usage: "mkr control build <freeze|unfreeze|forced_transfer|pause|unpause> --token <C...> [--operator --user --from --to --amount --caller] [--json]", ticket: "MKR-017" },
  { name: "audit verify", usage: "mkr audit verify <log.jsonl> [--from <seq> --prev <hash>] [--anchor-seq <n> --anchor-hash <hex>]", ticket: "MKR-008" },
  { name: "audit head", usage: "mkr audit head <log.jsonl>", ticket: "MKR-008" },
  { name: "audit export", usage: "mkr audit export <log.jsonl> --format <jsonl|csv> [--control-actions]", ticket: "MKR-024" },
  { name: "serve", usage: "mkr serve --state <dir> [--port 8787] [--rpc <url>] [--signers <map.json>] [--tokens <map.json>] [--allow-mainnet-submit]", ticket: "MKR-025" },
];

export function helpText(): string {
  const lines = ["mkr " + VERSION + " (maker-checker; headless policy and audit layer; holds no keys; DEMO-ONLY)", "", "Commands:"];
  for (const c of COMMANDS) lines.push("  " + c.usage);
  lines.push("", "Global: --help, --version", "Rules are enforced off-chain by this software: anyone holding a signing key can bypass them.");
  return lines.join("\n") + "\n";
}

const out = (s: string) => process.stdout.write(s);
const usage = (m: string): never => {
  throw new MkrError("MKR_E_USAGE", m);
};

function readText(path: string | undefined): string {
  if (!path) usage("missing file argument");
  try {
    return readFileSync(path!, "utf8");
  } catch {
    return usage(`cannot read ${path}`);
  }
}

async function serviceFor(v: Record<string, string | boolean | undefined>, network: boolean): Promise<RequestService> {
  const state = typeof v.state === "string" ? v.state : usage("--state <dir> is required");
  mkdirSync(state, { recursive: true });
  const signers: Record<string, string> = typeof v.signers === "string" ? JSON.parse(readText(v.signers)) : {};
  const rpcUrl = typeof v.rpc === "string" ? v.rpc : undefined;
  if (network && !rpcUrl) usage("--rpc <url> is required for this command");
  const passphrase = typeof v.network === "string" && v.network === "mainnet" ? Networks.PUBLIC : Networks.TESTNET;
  const net = rpcUrl ? createRpcAuthDeps({ rpcUrl, networkPassphrase: passphrase }) : undefined;
  const svc = new RequestService({
    audit: new AuditLog(new FileAuditStore(join(state, "audit.jsonl"))),
    ...(net ? { auth: net.deps, submitter: createRpcSubmitter({ server: net.server, networkPassphrase: passphrase, allowMainnet: v["allow-mainnet-submit"] === true }) } : {}),
    clock: () => Math.floor(Date.now() / 1000),
    signerPrincipal: (s) => signers[s],
    allowMainnetSubmit: v["allow-mainnet-submit"] === true,
  });
  await svc.rebuild();
  return svc;
}

async function dispatch(name: string, pos: string[], v: Record<string, string | boolean | undefined>): Promise<number> {
  const json = v.json === true;
  switch (name) {
    case "policy canonicalize": {
      const r = parsePolicyDoc(readText(pos[0]));
      if ("violations" in r) throw new MkrError("MKR_E_POLICY_INVALID", `${r.violations.length} violation(s); run policy validate`);
      out(canonicalize(r.doc));
      return 0;
    }
    case "policy hash": {
      const r = parsePolicyDoc(readText(pos[0]));
      if ("violations" in r) throw new MkrError("MKR_E_POLICY_INVALID", `${r.violations.length} violation(s); run policy validate`);
      out(policyHash(r.doc) + "\n");
      return 0;
    }
    case "policy validate": {
      const r = parsePolicyDoc(readText(pos[0]));
      if ("doc" in r) {
        out(json ? JSON.stringify({ ok: true, policyHash: policyHash(r.doc) }) + "\n" : `ok ${policyHash(r.doc)}\n`);
        return 0;
      }
      out(json ? JSON.stringify({ violations: r.violations }) + "\n" : r.violations.map((x) => `${x.code} ${x.path || "/"}: ${x.message}`).join("\n") + "\n");
      return 1;
    }
    case "policy eval": {
      const r = parsePolicyDoc(readText(v.policy as string));
      if ("violations" in r) throw new MkrError("MKR_E_POLICY_INVALID", "policy invalid");
      const req = JSON.parse(readText(v.request as string)) as { maker: string; nodes: never[]; controlKind?: never; priorSpend?: never[] };
      const now = typeof v.now === "string" ? (isoToUnix(v.now) ?? usage("--now must be RFC 3339 UTC")) : Math.floor(Date.now() / 1000);
      const d = evaluate({ policy: r.doc, policyHash: policyHash(r.doc), maker: req.maker, networkPassphrase: r.doc.network.passphrase, nodes: req.nodes, ...(req.controlKind ? { controlKind: req.controlKind } : {}), nowUnix: now, priorSpend: req.priorSpend ?? [] });
      out(json ? JSON.stringify(d) + "\n" : `${d.outcome}${d.reasons.length ? " " + d.reasons.join(",") : ""} rules=${d.matchedRuleIds.join(",")}\n`);
      return d.outcome === "allow" ? 0 : 1;
    }
    case "request propose": {
      const svc = await serviceFor(v, true);
      const body = JSON.parse(readText(v.request as string));
      const st = await svc.propose({ policyHash: String(v["policy-hash"]), maker: String(v.maker), intent: body.intent, ...(body.controlKind ? { controlKind: body.controlKind } : {}) });
      out(JSON.stringify({ id: st.record.request.id, state: st.record.state, requirement: st.decision.requirement }) + "\n");
      return 0;
    }
    case "request show": {
      const st = (await serviceFor(v, false)).get(pos[0] ?? usage("request id required"));
      out(json ? JSON.stringify(st.record) + "\n" : `${st.record.request.id} ${st.record.state} ${st.record.request.summary.headline} approvals=${st.record.approvals.length}\n`);
      return 0;
    }
    case "request list": {
      const svc = await serviceFor(v, false);
      const rows = [...svc.requests.values()].map((s) => ({ id: s.record.request.id, state: s.record.state, maker: s.record.request.maker, headline: s.record.request.summary.headline }));
      out(json ? JSON.stringify(rows) + "\n" : rows.map((r) => `${r.id.slice(0, 12)} ${r.state} ${r.maker} ${r.headline}`).join("\n") + "\n");
      return 0;
    }
    case "request approve":
    case "request reject": {
      const svc = await serviceFor(v, false);
      const attest = v.attest === "sep53" ? { scheme: "stellar-sep53" as const, address: String(v.address), signatureBase64: String(v.signature) } : v.attest === "host" ? { scheme: "host-asserted" as const, assertedBy: String(v["asserted-by"] ?? "cli") } : usage("--attest sep53|host");
      const st = await svc.recordApproval(pos[0] ?? usage("request id required"), { approver: String(v.approver), decision: name.endsWith("approve") ? "approve" : "reject", at: String(v.at), nonce: String(v.nonce), attestation: attest });
      out(`${st.record.state}\n`);
      return 0;
    }
    case "request cancel": {
      const st = await (await serviceFor(v, false)).cancel(pos[0] ?? usage("request id required"), String(v.by));
      out(`${st.record.state}\n`);
      return 0;
    }
    case "approval statement": {
      const decision = v.decision === "reject" ? "reject" : v.decision === "approve" ? "approve" : usage("--decision approve|reject");
      const s = (await serviceFor(v, false)).approvalStatementFor(pos[0] ?? usage("request id required"), String(v.approver), decision);
      out(json ? JSON.stringify(s) + "\n" : s.message + "\n");
      return 0;
    }
    case "auth plan": {
      const r = await (await serviceFor(v, true)).plan(pos[0] ?? usage("request id required"));
      out(JSON.stringify(r.bundle, null, 2) + "\n");
      return 0;
    }
    case "auth merge": {
      if (pos.length < 2) usage("give at least two bundle files");
      const merged = pos.map((f) => JSON.parse(readText(f)) as AuthBundle).reduce((a, b) => mergeBundles(a, b));
      out(JSON.stringify(merged, null, 2) + "\n");
      return 0;
    }
    case "auth assemble": {
      const r = await (await serviceFor(v, true)).assemble(pos[0] ?? usage("request id required"));
      out(JSON.stringify(r) + "\n");
      return 0;
    }
    case "auth collect":
      throw new NotImplemented("MKR-020");
    case "control build": {
      const kind = pos[0] ?? usage("kind required");
      const params = { kind, token: v.token, operator: v.operator, userAddress: v.user, from: v.from, to: v.to, amount: v.amount, caller: v.caller } as unknown as ControlActionParams;
      const b = buildControlAction(params);
      out(json ? JSON.stringify(b) + "\n" : b.summary.headline + "\n");
      return 0;
    }
    case "audit verify":
    case "audit head":
    case "audit export": {
      const path = pos[0] ?? usage("log path required");
      if (!existsSync(path)) usage(`no such file ${path}`);
      const entries = readText(path).split("\n").filter((l) => l.length > 0).map((l) => JSON.parse(l));
      const from = typeof v.from === "string" ? Number(v.from) : 0;
      const anchored = typeof v["anchor-seq"] === "string" ? { seq: Number(v["anchor-seq"]), hash: String(v["anchor-hash"]) } : undefined;
      const rep = verifyEntries(entries.slice(from), { fromSeq: from, ...(typeof v.prev === "string" ? { trustedPrevHash: v.prev } : {}), ...(anchored ? { anchoredHead: anchored } : {}) });
      if (name === "audit verify") {
        out(JSON.stringify(rep) + "\n");
        return rep.ok ? 0 : 1;
      }
      if (name === "audit head") {
        out(JSON.stringify(rep.head ?? {}) + "\n");
        return rep.ok ? 0 : 1;
      }
      if (!rep.ok) throw new MkrError("MKR_E_AUDIT_CHAIN_BROKEN", `log does not verify at seq ${rep.failure?.seq} (${rep.failure?.reason})`);
      out(v.format === "csv" ? toCsv(entries, { controlActions: v["control-actions"] === true, ...(rep.head ? { head: rep.head } : {}) }) : toJsonl(entries));
      return 0;
    }
    case "serve": {
      const svc = await serviceFor(v, false);
      // --tokens <map.json>: {"<bearer token>": "<principal id>"}. Without it the API has no caller identity.
      let authenticate: ((t: string) => string | undefined) | undefined;
      if (typeof v.tokens === "string") {
        const map = JSON.parse(readText(v.tokens)) as Record<string, string>;
        if (typeof map !== "object" || map === null || Array.isArray(map) || Object.keys(map).length === 0) usage("--tokens must be a non-empty JSON object {token: principalId}");
        authenticate = (t) => (Object.hasOwn(map, t) && typeof map[t] === "string" ? map[t] : undefined);
      }
      const srv = await startServer({ service: svc, port: Number(v.port ?? 8787), ...(authenticate ? { authenticate } : {}) });
      process.stderr.write(`mkr serve: ${srv.url}/v1 (state ${String(v.state)}; mainnet submit ${svc.deps.allowMainnetSubmit ? "ALLOWED" : "blocked"}; caller authentication ${authenticate ? "ON (bearer tokens)" : "OFF"})\n`);
      if (!authenticate) process.stderr.write("mkr serve: WARNING no --tokens map: the server has no caller identity, so maker/approver/cancel identities are trusted as sent. Local development only; bound to 127.0.0.1 and loopback Host headers only.\n");
      if (typeof v.rpc !== "string") process.stderr.write("mkr serve: note no --rpc given: plan, assemble and submit are unavailable (they need a Soroban RPC URL).\n");
      await new Promise(() => undefined);
      return 0;
    }
  }
  return usage(`unknown command ${name}`);
}

const STRING_OPTIONS = ["policy", "request", "now", "state", "rpc", "signers", "network", "policy-hash", "maker", "approver", "at", "nonce", "attest", "address", "signature", "asserted-by", "by", "decision", "token", "operator", "user", "from", "to", "amount", "caller", "prev", "anchor-seq", "anchor-hash", "format", "port", "signer", "tokens"] as const;
const OPTIONS: Record<string, { type: "string" | "boolean" }> = {
  help: { type: "boolean" }, version: { type: "boolean" }, json: { type: "boolean" }, "control-actions": { type: "boolean" }, "allow-mainnet-submit": { type: "boolean" },
  ...Object.fromEntries(STRING_OPTIONS.map((o) => [o, { type: "string" as const }])),
};

export async function run(argv: string[]): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs({ args: argv, allowPositionals: true, strict: false, options: OPTIONS });
  } catch (e) {
    process.stderr.write(`usage error: ${(e as Error).message}\n`);
    return 2;
  }
  if (parsed.values.version) {
    out(VERSION + "\n");
    return 0;
  }
  if (parsed.values.help || parsed.positionals.length === 0) {
    out(helpText());
    return 0;
  }
  const name = parsed.positionals.slice(0, 2).join(" ");
  const cmd = COMMANDS.find((c) => c.name === name) ?? COMMANDS.find((c) => c.name === parsed.positionals[0]);
  if (!cmd) {
    process.stderr.write(`unknown command: ${parsed.positionals.join(" ")}\n${helpText()}`);
    return 2;
  }
  const rest = parsed.positionals.slice(cmd.name.split(" ").length);
  try {
    return await dispatch(cmd.name, rest, parsed.values as Record<string, string | boolean | undefined>);
  } catch (e) {
    if (e instanceof NotImplemented) {
      process.stderr.write(`${e.message} (${cmd.usage})\n`);
      return 70;
    }
    if (e instanceof MkrError) {
      process.stderr.write(`${e.code}: ${e.message}\n`);
      return e.code === "MKR_E_USAGE" ? 2 : e.code === "MKR_E_SIMULATION_FAILED" || e.code === "MKR_E_SIGNER_UNAVAILABLE" ? 3 : 1;
    }
    if (e instanceof SyntaxError) {
      process.stderr.write(`input error: ${e.message}\n`);
      return 2;
    }
    throw e;
  }
}

if (import.meta.main) {
  process.stdout.on("error", (e: NodeJS.ErrnoException) => {
    if (e.code !== "EPIPE") throw e;
  });
  process.exitCode = await run(process.argv.slice(2));
}
