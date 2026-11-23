// SPDX-License-Identifier: Apache-2.0
import { weakestStatus } from "@sik/dtc-kit-profile-spec/pure";
import type { ResolvedProfile, RowStatus } from "@sik/dtc-kit-profile-spec/pure";
import { SANDBOX_CLIENT_SECRET } from "../app.ts";
import { PARTICIPANTS } from "../institutions.ts";
import { httpTransport } from "../transport.ts";
import type { Transport } from "../transport.ts";
import type { Actor, ScriptedScenario } from "./types.ts";

export interface StepOutcome {
  step: string;
  ok: boolean;
  /** Who called, as a sandbox client id. */
  clientId: string;
  method: string;
  /** Path after placeholder substitution. */
  path: string;
  requestBody?: unknown;
  expectedStatus: number;
  status: number;
  responseBody: unknown;
  detail?: string;
}

export interface ScenarioOutcome {
  scenario: string;
  title: string;
  /** Weakest status among the scenario's rows; copied into the report (G-DTCC). */
  trust: RowStatus;
  rows: string[];
  passed: boolean;
  /** What the runner did before step 1 so the scenario starts from a known state. */
  preamble: string;
  steps: StepOutcome[];
}

const clientIdFor = (actor: Actor): string => {
  if (actor.as === "dtc-ops") return "dtc-ops-1";
  if (actor.as === "sim") return "sim-1";
  const p = PARTICIPANTS.find((x) => x.id === actor.participant);
  if (!p) throw new Error(`unknown participant ${actor.participant}`);
  return p.serviceAccountId;
};

const get = (v: unknown, path: string): unknown =>
  path.split(".").reduce<unknown>((acc, k) => (acc !== null && typeof acc === "object" ? (acc as Record<string, unknown>)[k] : undefined), v);

const fill = (v: unknown, vars: Record<string, string>): unknown => {
  if (typeof v === "string") return v.replace(/\{\{(\w+)\}\}/g, (_, k: string) => vars[k] ?? `{{${k}}}`);
  if (Array.isArray(v)) return v.map((x) => fill(x, vars));
  if (v !== null && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, fill(x, vars)]));
  return v;
};

/**
 * Run a scripted scenario (DTC-014) against a sandbox base URL or any Transport. Resets the sandbox to the
 * `empty` fixture first, mints a fake OAuth token per actor, substitutes `{{var}}` placeholders,
 * subset-matches response bodies by dotted path, and captures values for later steps. Never throws on a
 * failed expectation: the step is reported with `ok: false` and a detail.
 */
export async function runScripted(target: string | Transport, scenario: ScriptedScenario, profile?: ResolvedProfile): Promise<ScenarioOutcome> {
  const transport = typeof target === "string" ? httpTransport(target) : target;
  const tokens = new Map<string, string>();
  const token = async (clientId: string): Promise<string> => {
    const cached = tokens.get(clientId);
    if (cached) return cached;
    const r = await transport({ method: "POST", path: "/oauth/token", body: { grant_type: "client_credentials", client_id: clientId, client_secret: SANDBOX_CLIENT_SECRET } });
    const t = (r.body as { access_token?: string }).access_token;
    if (r.status !== 200 || !t) throw new Error(`oauth for ${clientId} failed with ${r.status}`);
    tokens.set(clientId, t);
    return t;
  };

  let trust: RowStatus;
  if (profile) trust = weakestStatus(profile, scenario.rows);
  else {
    const p = (await transport({ method: "GET", path: "/v1/profile" })).body as { rows: { id: string; status: RowStatus }[] };
    const statuses = new Map(p.rows.map((r) => [r.id, r.status]));
    const order: RowStatus[] = ["unknown", "inferred", "published"];
    trust = scenario.rows.length === 0 ? "unknown" : (order[Math.min(...scenario.rows.map((r) => order.indexOf(statuses.get(r) ?? "unknown")))] ?? "unknown");
  }

  const preamble = "POST /v1/sim/reset {\"fixture\":\"empty\"} as sim-1";
  await transport({ method: "POST", path: "/v1/sim/reset", headers: { authorization: `Bearer ${await token("sim-1")}` }, body: { fixture: "empty" } });

  const vars: Record<string, string> = {};
  const steps: StepOutcome[] = [];
  for (const s of scenario.steps) {
    const clientId = clientIdFor(s.actor);
    const path = fill(s.request.path, vars) as string;
    const body = s.request.body !== undefined ? fill(s.request.body, vars) : undefined;
    const res = await transport({ method: s.request.method, path, headers: { authorization: `Bearer ${await token(clientId)}` }, ...(body !== undefined ? { body } : {}) });
    const problems: string[] = [];
    if (res.status !== s.expect.status) problems.push(`status ${res.status}, expected ${s.expect.status}`);
    for (const [k, want] of Object.entries(s.expect.body ?? {})) {
      const got = get(res.body, k);
      if (JSON.stringify(got) !== JSON.stringify(want)) problems.push(`${k} = ${JSON.stringify(got)}, expected ${JSON.stringify(want)}`);
    }
    for (const [name, at] of Object.entries(s.capture ?? {})) {
      const v = get(res.body, at);
      if (typeof v === "string" || typeof v === "number") vars[name] = String(v);
      else problems.push(`capture ${name} from ${at}: missing`);
    }
    steps.push({
      step: s.name,
      ok: problems.length === 0,
      clientId,
      method: s.request.method,
      path,
      ...(body !== undefined ? { requestBody: body } : {}),
      expectedStatus: s.expect.status,
      status: res.status,
      responseBody: res.body,
      ...(problems.length > 0 ? { detail: problems.join("; ") } : {}),
    });
  }
  return { scenario: scenario.id, title: scenario.title, trust, rows: scenario.rows, passed: steps.every((s) => s.ok), preamble, steps };
}
