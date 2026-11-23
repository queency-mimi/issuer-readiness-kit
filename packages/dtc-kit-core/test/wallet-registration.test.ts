// SPDX-License-Identifier: Apache-2.0
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { InvalidTransition, WALLET_STATUSES, reduceWallet, validateRegistration } from "../src/index.ts";
import type { WalletEvent, WalletRecord, WalletStatus } from "../src/index.ts";
import { profile, wallet } from "./helpers.ts";

const EVENTS: WalletEvent[] = [
  { type: "ofac-passed" },
  { type: "ofac-failed", detail: "x" },
  { type: "technical-failure", detail: "x" },
  { type: "onchain-allowlist-confirmed" },
  { type: "delivery-order-chill" },
  { type: "global-lock" },
  { type: "compliance-lock", source: "smf-feed" },
  { type: "release-control" },
];

/** Legal (status, event) -> next status. Everything else must throw InvalidTransition. */
const LEGAL: Partial<Record<WalletStatus, Partial<Record<WalletEvent["type"], WalletStatus>>>> = {
  Processing: { "ofac-passed": "Processing", "ofac-failed": "Failed Compliance", "technical-failure": "Failed", "onchain-allowlist-confirmed": "Processing" },
  Completed: { "ofac-failed": "Failed Compliance", "delivery-order-chill": "Delivery Order Chill", "global-lock": "Global Lock", "compliance-lock": "Compliance Lock" },
  "Delivery Order Chill": { "global-lock": "Global Lock", "compliance-lock": "Compliance Lock", "release-control": "Completed" },
  "Global Lock": { "release-control": "Completed" },
  "Compliance Lock": { "release-control": "Completed" },
};

describe("reduceWallet (DTC-004): every event from every status", () => {
  for (const status of WALLET_STATUSES) {
    for (const event of EVENTS) {
      const to = LEGAL[status]?.[event.type];
      it(`${status} + ${event.type} -> ${to ?? "InvalidTransition"}`, () => {
        const w = wallet(status, status === "Processing" ? { ofacCleared: false, onChainAllowlisted: false } : {});
        if (to === undefined) {
          assert.throws(() => reduceWallet(w, event, profile), InvalidTransition);
        } else {
          assert.equal(reduceWallet(w, event, profile).next.status, to);
        }
      });
    }
  }
});

describe("reduceWallet (DTC-004): rules", () => {
  const fresh = (): WalletRecord => wallet("Processing", { ofacCleared: false, onChainAllowlisted: false });

  it("Completed needs ofacCleared AND onChainAllowlisted, in either order", () => {
    const a = reduceWallet(fresh(), { type: "ofac-passed" }, profile);
    assert.equal(a.next.status, "Processing");
    assert.deepEqual(a.effects.map((e) => e.kind), ["allowlist-add"]);
    assert.equal(reduceWallet(a.next, { type: "onchain-allowlist-confirmed" }, profile).next.status, "Completed");
    const b = reduceWallet(fresh(), { type: "onchain-allowlist-confirmed" }, profile);
    assert.equal(b.next.status, "Processing");
    const c = reduceWallet(b.next, { type: "ofac-passed" }, profile);
    assert.equal(c.next.status, "Completed");
    assert.deepEqual(c.effects.map((e) => e.kind), [], "allowlist-add only when not yet allowlisted");
  });

  it("allowlist-add is emitted once, on the first ofac-passed", () => {
    const a = reduceWallet(fresh(), { type: "ofac-passed" }, profile);
    const again = reduceWallet(a.next, { type: "ofac-passed" }, profile);
    assert.deepEqual(again.effects, []);
  });

  it("ofac-failed after allowlisting emits allowlist-remove and leaves the wallet not allowlisted", () => {
    const r = reduceWallet(wallet("Completed"), { type: "ofac-failed", detail: "re-screen" }, profile);
    assert.equal(r.next.status, "Failed Compliance");
    assert.equal(r.next.onChainAllowlisted, false);
    assert.deepEqual(r.effects.map((e) => e.kind), ["allowlist-remove"]);
    const fresh2 = reduceWallet(fresh(), { type: "ofac-failed", detail: "list hit" }, profile);
    assert.deepEqual(fresh2.effects, []);
  });

  it("a chill emits restrict with the profile's inbound/outbound reading and is labelled inferred", () => {
    const r = reduceWallet(wallet("Completed"), { type: "delivery-order-chill" }, profile);
    assert.deepEqual(r.effects, [{ kind: "restrict", ledger: "sandbox-ledger", address: "SBX-ADDR-1", inbound: false, outbound: true }]);
    assert.equal(r.trust.status, "inferred");
    assert.equal(r.next.statusBeforeControl, "Completed");
  });

  it("escalation keeps the original statusBeforeControl; release restores it and unrestricts", () => {
    const chilled = reduceWallet(wallet("Completed"), { type: "delivery-order-chill" }, profile).next;
    const locked = reduceWallet(chilled, { type: "global-lock" }, profile).next;
    assert.equal(locked.statusBeforeControl, "Completed");
    const released = reduceWallet(locked, { type: "release-control" }, profile);
    assert.equal(released.next.status, "Completed");
    assert.equal(released.next.statusBeforeControl, undefined);
    assert.deepEqual(released.effects.map((e) => e.kind), ["unrestrict"]);
  });

  it("property: release-control after any sequence of controls returns the prior status", () => {
    const controls: WalletEvent[] = [{ type: "delivery-order-chill" }, { type: "global-lock" }, { type: "compliance-lock", source: "dtc-ops" }];
    for (const first of controls) {
      for (const second of [undefined, ...controls]) {
        let w = reduceWallet(wallet("Completed"), first, profile).next;
        if (second) {
          try {
            w = reduceWallet(w, second, profile).next;
          } catch (e) {
            assert.ok(e instanceof InvalidTransition);
          }
        }
        assert.equal(reduceWallet(w, { type: "release-control" }, profile).next.status, "Completed");
      }
    }
  });
});

describe("validateRegistration (DTC-004)", () => {
  const directory = {
    isParticipant: (id: string) => id === "SBX-9002",
    clientExists: (p: string, c: string) => p === "SBX-9002" && c === "C-BIRCH-001",
    isRegistered: (ledger: string, address: string) => ledger === "sandbox-ledger" && address === "TAKEN",
  };
  const base = { participant: "SBX-9002", ledger: "sandbox-ledger", address: "anything at all", kind: "internal" as const };

  it("accepts any address text (DTC does not validate it)", () => {
    assert.deepEqual(validateRegistration(base, profile, directory), { ok: true });
  });
  it("only a participant may register", () => {
    assert.equal(validateRegistration({ ...base, participant: "OUTSIDER" }, profile, directory).ok, false);
    const r = validateRegistration({ ...base, participant: "OUTSIDER" }, profile, directory);
    assert.equal(r.ok === false && r.code, "NOT_A_PARTICIPANT");
  });
  it("a client wallet without clientId is a VALIDATION error, an unknown one CLIENT_ID_UNKNOWN", () => {
    const a = validateRegistration({ ...base, kind: "client" }, profile, directory);
    assert.equal(a.ok === false && a.code, "VALIDATION");
    const b = validateRegistration({ ...base, kind: "client", clientId: "C-NOPE" }, profile, directory);
    assert.equal(b.ok === false && b.code, "CLIENT_ID_UNKNOWN");
    assert.deepEqual(validateRegistration({ ...base, kind: "client", clientId: "C-BIRCH-001" }, profile, directory), { ok: true });
  });
  it("a duplicate (ledger, address) is ALREADY_REGISTERED", () => {
    const r = validateRegistration({ ...base, address: "TAKEN" }, profile, directory);
    assert.equal(r.ok === false && r.code, "ALREADY_REGISTERED");
  });
});
