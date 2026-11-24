// SPDX-License-Identifier: Apache-2.0
// PFH-002: verdict derivation (SPEC 4.1) and the informational status agreement.
import assert from "node:assert/strict";
import { test } from "node:test";
import { deriveVerdict, statusAgreement } from "../src/verdict/derive.ts";
import type { ReasonEntry } from "../src/types.ts";
import type { ReasonCode, Severity } from "../src/taxonomy/codes.ts";

const r = (code: ReasonCode, severity: Severity): ReasonEntry => ({ code, severity, party: "unspecified", libraryCode: code });

test("derive: precedence error > receive blocking > meta warning/blocking > receive warning > none", () => {
  assert.equal(deriveVerdict([r("TRUSTLINE_MISSING", "blocking")], { kind: "threw", message: "x" }), "unknown");
  assert.equal(deriveVerdict([r("TRUSTLINE_MISSING", "blocking"), r("PROVIDER_UNAVAILABLE", "warning")]), "cannot_receive");
  assert.equal(deriveVerdict([r("PROVIDER_UNAVAILABLE", "warning"), r("MEMO_REQUIRED", "warning")]), "unknown");
  assert.equal(deriveVerdict([r("INVALID_AMOUNT", "blocking")]), "unknown");
  assert.equal(deriveVerdict([r("MEMO_REQUIRED", "warning")]), "can_receive_with_warnings");
  assert.equal(deriveVerdict([]), "can_receive");
});

test("derive: info never changes the class, including meta info", () => {
  assert.equal(deriveVerdict([r("ASSET_CLAWBACK_ENABLED", "info"), r("CHECK_SKIPPED", "info")]), "can_receive");
  assert.equal(deriveVerdict([r("MEMO_REQUIRED", "warning"), r("SIMULATION_NOT_RUN", "info")]), "can_receive_with_warnings");
});

test("derive: sender-scope reasons are ignored even when blocking", () => {
  assert.equal(deriveVerdict([r("SENDER_INSUFFICIENT_ASSET", "blocking")]), "can_receive");
  assert.equal(deriveVerdict([r("SAC_SENDER_DEAUTHORIZED", "blocking"), r("MEMO_REQUIRED", "warning")]), "can_receive_with_warnings");
});

test("derive: the reason's own severity is used, not the taxonomy default", () => {
  // MEMO_REQUIRED defaults to warning, stellagate-core and stellar-check report it blocking.
  assert.equal(deriveVerdict([r("MEMO_REQUIRED", "blocking")]), "cannot_receive");
  // ACCOUNT_UNFUNDED defaults to blocking, stellagate-core reports it as warn for native XLM.
  assert.equal(deriveVerdict([r("ACCOUNT_UNFUNDED", "warning")]), "can_receive_with_warnings");
});

test("statusAgreement: simple mapping of each library's status vocabulary", () => {
  assert.equal(statusAgreement("READY", "can_receive"), true);
  assert.equal(statusAgreement("WARNING", "can_receive_with_warnings"), true);
  assert.equal(statusAgreement("BLOCKED", "cannot_receive"), true);
  assert.equal(statusAgreement("ok", "can_receive"), true);
  assert.equal(statusAgreement("warn", "can_receive_with_warnings"), true);
  assert.equal(statusAgreement("block", "cannot_receive"), true);
  assert.equal(statusAgreement("no_known_issues", "can_receive"), true);
  assert.equal(statusAgreement("issues_found", "cannot_receive"), true);
  assert.equal(statusAgreement("incomplete", "unknown"), true);
  assert.equal(statusAgreement("BLOCKED", "unknown"), false);
  assert.equal(statusAgreement("issues_found", "can_receive"), false);
  assert.equal(statusAgreement("something-else", "can_receive"), false);
});
