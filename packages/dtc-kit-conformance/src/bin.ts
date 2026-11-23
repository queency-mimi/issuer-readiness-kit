// SPDX-License-Identifier: Apache-2.0
// Conformance CLI (DTC-018):
//   node packages/dtc-kit-conformance/src/bin.ts run [--profile dtc-stellar] [--adapter sandbox-ledger|stellar-sac|stellar-sep57]
//        [--target sandbox|testnet-recorded] [--include TAG]... [--exclude TAG]... [--json FILE] [--junit FILE]
// Exit 0: no fail. 1: a scenario failed. 2: usage error.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { StellarSacAdapter } from "@sik/dtc-kit-adapter-stellar-sac";
import { StellarSep57Adapter } from "@sik/dtc-kit-adapter-stellar-sep57";
import type { ChainAdapter } from "@sik/dtc-kit-core";
import { loadBundledProfile, resolveProfile } from "@sik/dtc-kit-profile-spec";
import { SandboxLedgerAdapter } from "@sik/dtc-kit-sandbox";
import { DTC_KIT_PACK } from "./catalogue/index.ts";
import type { RecordedTestnetRun } from "./implementations.ts";
import { exitCodeFor, runPack, toJunitXml } from "./runner.ts";
import type { Target } from "./runner.ts";
import type { ScenarioTag } from "./pack.ts";

export const RECORDED_TESTNET_RUN = join(import.meta.dirname, "..", "..", "..", "fixtures", "dtc-kit", "sac-force-transfer", "testnet-run.json");

export function makeAdapter(id: string, profile: ReturnType<typeof resolveProfile>): ChainAdapter {
  if (id === "sandbox-ledger") return new SandboxLedgerAdapter();
  if (id === "stellar-sac") {
    const run = JSON.parse(readFileSync(RECORDED_TESTNET_RUN, "utf8")) as RecordedTestnetRun;
    return new StellarSacAdapter({ network: "testnet", assetCode: run.asset.code, issuerAccount: run.asset.issuer, profile });
  }
  if (id === "stellar-sep57") return new StellarSep57Adapter({ network: "testnet", tokenContractId: "SBX-SEP57-NOT-DEPLOYED", operator: "SBX-OPERATOR", profile });
  throw new Error(`unknown adapter ${id}`);
}

async function main(argv: string[]): Promise<number> {
  const [cmd, ...args] = argv;
  if (cmd !== "run") {
    console.error("usage: conformance run [--profile P] [--adapter A] [--target sandbox|testnet-recorded] [--include TAG] [--exclude TAG] [--json F] [--junit F]");
    return 2;
  }
  const opt = (name: string) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const many = (name: string) => args.flatMap((a, i) => (a === name && args[i + 1] ? [args[i + 1] as ScenarioTag] : []));
  const target = (opt("--target") ?? "sandbox") as Target;
  if (target !== "sandbox" && target !== "testnet-recorded") {
    console.error(`target ${target}: use sandbox or testnet-recorded (live testnet runs are the spike script: node packages/dtc-kit-adapter-stellar-sac/scripts/testnet-spike.ts)`);
    return 2;
  }
  const profile = resolveProfile(loadBundledProfile(opt("--profile") ?? DTC_KIT_PACK.profile));
  let adapter: ChainAdapter;
  try {
    adapter = makeAdapter(opt("--adapter") ?? "sandbox-ledger", profile);
  } catch (e) {
    console.error((e as Error).message);
    return 2;
  }
  const include = many("--include");
  const exclude = many("--exclude");
  const testnetRun = target === "testnet-recorded" ? (JSON.parse(readFileSync(RECORDED_TESTNET_RUN, "utf8")) as RecordedTestnetRun) : undefined;
  const report = await runPack({ pack: DTC_KIT_PACK, profile, adapter, target, ...(include.length ? { include } : {}), ...(exclude.length ? { exclude } : {}), ...(testnetRun ? { testnetRun } : {}) });
  console.log(report.disclaimer);
  console.log(`pack ${report.packId}@${report.packVersion}  profile ${report.profile}@${report.profileVersion}  adapter ${report.adapter}  target ${report.target}`);
  for (const r of report.results) {
    const label = r.trust === "published" ? "" : ` [${r.trust}]`;
    console.log(`${r.outcome.toUpperCase().padEnd(8)} ${r.id}${label} ${r.title}${r.skipReason ? `  (${r.skipReason})` : ""}`);
    if (r.outcome === "fail") for (const d of r.detail ?? []) console.log(`         - ${d}`);
  }
  const s = report.summary;
  console.log(`${s.total} scenarios: ${s.pass} pass, ${s.fail} fail, ${s.observed} observed, ${s.skipped} skipped`);
  const json = opt("--json");
  if (json) writeFileSync(json, `${JSON.stringify(report, (_k, v: unknown) => (typeof v === "bigint" ? v.toString() : v), 2)}\n`);
  const junit = opt("--junit");
  if (junit) writeFileSync(junit, toJunitXml(report));
  return exitCodeFor(report);
}

if (process.argv[1] === import.meta.filename) {
  main(process.argv.slice(2)).then((code) => process.exit(code), (e: unknown) => {
    console.error(e);
    process.exit(2);
  });
}
