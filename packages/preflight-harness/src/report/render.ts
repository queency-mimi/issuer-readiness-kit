// SPDX-License-Identifier: Apache-2.0
// Report renderers (SPEC 6.4). Output depends only on the DiffReport; generatedAt is the only clock value.
import { FINDING_GROUP } from "./diff.ts";
import type { DiffReport, Finding, MatrixCell, MatrixRow } from "./diff.ts";
import { LIBRARY_INVENTORY } from "../taxonomy/library-maps.ts";
import type { AdapterId } from "../taxonomy/library-maps.ts";

/** JSON with keys sorted at every depth (arrays keep their order), 2-space indent, trailing newline. */
export function renderJson(report: DiffReport): string {
  const sort = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(sort);
    if (v !== null && typeof v === "object") return Object.fromEntries(Object.keys(v).sort().map((k) => [k, sort((v as Record<string, unknown>)[k])]));
    return v;
  };
  return JSON.stringify(sort(report), null, 2) + "\n";
}

const esc = (s: string) => s.replace(/\|/g, "\\|").replace(/\n/g, " ");
const CLASS: Record<string, string> = { can_receive: "can", can_receive_with_warnings: "warn", cannot_receive: "cannot", unknown: "unknown" };

function cellText(c: MatrixCell): string {
  if (!c.applicable) return "n/a";
  if (c.notRun) return "not run";
  const codes = c.receiveCodes.length ? ` ${c.receiveCodes.join(", ")}` : "";
  return `${CLASS[c.verdict] ?? c.verdict}${codes}${c.error ? " (error)" : ""}`;
}

function truthText(r: MatrixRow): string {
  const t = r.groundTruth;
  if (t.kind === "horizon-result") return `Horizon ${t.operationResult}${t.txHash ? ` (tx ${t.txHash.slice(0, 10)})` : ""}`;
  if (t.kind === "simulation") return `simulation ${t.outcome}${t.contractErrorCode !== undefined ? ` #${t.contractErrorCode}` : ""}`;
  if (t.kind === "out-of-band") return "out of band";
  return "none";
}

const GROUP_TITLE = { disagreement: "Disagreements (libraries disagree)", gap: "Gaps (a library is silent or abstains)", expectation: "Differs from the case's authored expectation (a catalogue judgement with a trust tag, not recorded evidence)", error: "Errors (contradicts recorded ledger or simulation evidence, or the library failed)", note: "Notes (informational)" } as const;

function findingLine(f: Finding): string {
  return `- \`${f.caseId}\` ${f.kind} [${f.adapters.join(", ")}]${f.codes.length ? ` ${f.codes.join(", ")}` : ""}: ${esc(f.detail)}`;
}

/** Markdown report: header with versions and ledger range, matrix table, findings grouped by kind, per-case appendix. */
export function renderMarkdown(report: DiffReport): string {
  const L: string[] = [];
  const s = report.summary;
  L.push("# preflight-harness differential report", "");
  L.push(`Generated ${report.generatedAt}. Taxonomy v${report.taxonomyVersion}. Read-only replay of recorded fixtures; nothing was signed or submitted by this run.`, "");
  L.push("| Library | Version | Ran | Source |", "|---|---|---|---|");
  for (const a of report.adapters) {
    const inv = LIBRARY_INVENTORY[a.id as AdapterId];
    L.push(`| ${a.id} | ${a.version || "-"} | ${a.available ? "yes" : "no"} | ${inv ? `${inv.install.method} ${inv.repo} (${inv.licence})` : "-"} |`);
  }
  L.push("");
  const range = report.fixtureSet.ledgerRange ? `, ledgers ${report.fixtureSet.ledgerRange[0]} to ${report.fixtureSet.ledgerRange[1]}` : "";
  L.push(`Captured cases in the headline: ${s.cases}${range}. Synthetic cases (unit-test only, not counted): ${s.synthetic}. Catalogued but not captured: ${report.notEvaluated.length}.`, "");
  L.push(`Row agreement: ${s.unanimous} unanimous, ${s.split} split, ${s.single} single-library, ${s.unanimousUnknown} all-unknown, ${s.notCompared} not compared (no library that claims the case ran). Findings: ${s.disagreements} disagreements, ${s.gaps} gaps, ${s.expectationDiffs} differ from the authored expectation, ${s.errors} contradict recorded evidence or failed.`, "");
  for (const n of report.notRun) L.push(`Not run: **${n.adapterId}** for ${n.cases} case(s). ${esc(n.reason)}`, "");

  L.push("## Matrix", "");
  L.push(`| Case | Expected | Ground truth | ${report.adapters.map((a) => a.id).join(" | ")} | Agreement |`);
  L.push(`|---|---|---|${report.adapters.map(() => "---|").join("")}---|`);
  for (const r of report.rows) {
    const cells = report.adapters.map((a) => esc(cellText(r.cells.find((c) => c.adapterId === a.id)!)));
    L.push(`| \`${r.caseId}\`${r.tags.includes("@synthetic") ? " (synthetic)" : ""} | ${r.expectedVerdict} | ${truthText(r)} | ${cells.join(" | ")} | ${r.agreement} |`);
  }
  L.push("");

  L.push("## Findings", "");
  if (report.findings.length === 0) L.push("No findings.", "");
  for (const group of ["disagreement", "gap", "expectation", "error", "note"] as const) {
    const fs = report.findings.filter((f) => FINDING_GROUP[f.kind] === group);
    if (!fs.length) continue;
    L.push(`### ${GROUP_TITLE[group]}`, "");
    for (const f of fs) L.push(findingLine(f));
    L.push("");
  }

  L.push("## Per-case appendix", "");
  for (const r of report.rows) {
    const i = r.input;
    const asset = i.asset.kind === "native" ? "XLM" : i.asset.kind === "classic" ? `${i.asset.code}:${i.asset.issuer}` : i.asset.contractId;
    L.push(`### ${r.caseId}`, "");
    L.push(`${esc(r.title)}. Destination \`${i.destination}\`, asset \`${asset}\`, amount ${i.amount}${i.sender ? `, sender \`${i.sender}\`` : ""}${i.memo ? `, memo ${i.memo.type} "${esc(i.memo.value)}"` : ""}${r.ledger !== undefined ? `. Snapshot ledger ${r.ledger}` : ""}. Must report: ${r.mustReport.join(", ") || "nothing"}. Ground truth: ${truthText(r)}.`, "");
    for (const c of r.cells) {
      if (!c.applicable) {
        L.push(`- ${c.adapterId}: not applicable (outside the library's stated scope)`);
        continue;
      }
      if (c.notRun) {
        L.push(`- ${c.adapterId}: not run`);
        continue;
      }
      L.push(`- ${c.adapterId}: status \`${c.libraryStatus}\`, derived ${c.verdict}${c.error ? `, error ${esc(c.error)}` : ""}`);
      for (const x of c.reasons) L.push(`  - ${x.libraryCode} -> ${x.code} (${x.severity})${x.message ? `: ${esc(x.message)}` : ""}`);
    }
    L.push("");
  }

  L.push("## Not evaluated", "");
  if (report.notEvaluated.length === 0) L.push("Every catalogued case in this fixture set was evaluated.", "");
  else {
    for (const n of report.notEvaluated) L.push(`- \`${n.caseId}\` ${esc(n.title)}: ${esc(n.reason)}`);
    L.push("");
  }
  return L.join("\n");
}
