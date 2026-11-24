// SPDX-License-Identifier: Apache-2.0
// Horizon replay: a `fetch` implementation that answers the Horizon GETs both npm libraries make, from a
// StateSnapshot. Feeding the libraries' OWN Horizon readers (stellagate-core horizonAccountSource, stellar-check
// HorizonProvider) keeps their parsing in the comparison instead of replacing it with ours (SPEC 5.1, D2).
// Rules: a recorded non-existent account (null) is a 404; an account the capture never read is a 503, so a
// library reports a provider failure instead of a false "unfunded". Every non-GET or unknown path is a 501.
import { PASSPHRASE } from "../types.ts";
import type { StateSnapshot } from "../types.ts";
import { stroopsToDecimal } from "./canonical.ts";

const DEFAULT_RESERVE = "5000000";
const DEFAULT_FEE = "100";

/** Horizon `GET /accounts/{id}` body rebuilt from the snapshot, or null for a recorded non-existent account. */
export function horizonAccountJson(state: StateSnapshot, id: string): Record<string, unknown> | null | undefined {
  if (!(id in state.accounts)) return undefined;
  const a = state.accounts[id];
  if (a === null || a === undefined) return null;
  const native = { balance: stroopsToDecimal(a.balance), buying_liabilities: "0.0000000", selling_liabilities: "0.0000000", asset_type: "native" };
  const lines = a.trustlines.map((t) => ({
    balance: stroopsToDecimal(t.balance),
    limit: stroopsToDecimal(t.limit),
    buying_liabilities: stroopsToDecimal(t.buyingLiabilities),
    selling_liabilities: stroopsToDecimal(t.sellingLiabilities),
    last_modified_ledger: state.ledger,
    is_authorized: t.authorized,
    is_authorized_to_maintain_liabilities: t.authorizedToMaintainLiabilities,
    is_clawback_enabled: t.clawbackEnabled,
    asset_type: t.asset.code.length <= 4 ? "credit_alphanum4" : "credit_alphanum12",
    asset_code: t.asset.code,
    asset_issuer: t.asset.issuer,
  }));
  return {
    id,
    account_id: id,
    sequence: "1",
    subentry_count: a.subentryCount,
    num_sponsoring: a.numSponsoring,
    num_sponsored: a.numSponsored,
    last_modified_ledger: state.ledger,
    thresholds: { low_threshold: 0, med_threshold: 0, high_threshold: 0 },
    flags: { auth_required: a.flags.authRequired, auth_revocable: a.flags.authRevocable, auth_immutable: a.flags.authImmutable, auth_clawback_enabled: a.flags.clawbackEnabled },
    balances: [...lines, native],
    signers: [{ weight: 1, key: id, type: "ed25519_public_key" }],
    data: { ...a.data },
    ...(a.homeDomain ? { home_domain: a.homeDomain } : {}),
  };
}

function respond(status: number, body: unknown, ledger: number): Response {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (ledger > 0) headers["x-last-ledger"] = String(ledger);
  return new Response(JSON.stringify(body), { status, headers });
}

/** A fetch that serves the snapshot as Horizon. Never touches the network. */
export function horizonFetch(state: StateSnapshot): typeof fetch {
  const f = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
    if (method !== "GET") return respond(501, { title: "replay serves GET only" }, state.ledger);
    const path = url.pathname.replace(/\/+$/, "");
    if (path === "") return respond(200, { network_passphrase: PASSPHRASE[state.network], history_latest_ledger: state.ledger }, state.ledger);
    if (path === "/ledgers") {
      const record = {
        sequence: state.ledger,
        base_reserve_in_stroops: Number(state.networkParams?.baseReserveStroops ?? DEFAULT_RESERVE),
        base_fee_in_stroops: Number(state.networkParams?.baseFeeStroops ?? DEFAULT_FEE),
      };
      return respond(200, { _embedded: { records: [record] } }, state.ledger);
    }
    const m = /^\/accounts\/([A-Z2-7]{56})$/.exec(path);
    if (m) {
      const body = horizonAccountJson(state, m[1]!);
      if (body === undefined) return respond(503, { title: "account not recorded in this snapshot" }, state.ledger);
      if (body === null) return respond(404, { status: 404, title: "Resource Missing" }, state.ledger);
      return respond(200, body, state.ledger);
    }
    return respond(501, { title: `replay does not serve ${path}` }, state.ledger);
  };
  return f as typeof fetch;
}

export const REPLAY_HORIZON_URL = "https://horizon.replay.invalid";
