# DEMO: maker-checker

<!-- SPDX-License-Identifier: Apache-2.0 -->

Testnet only. The recorded tabs work offline from committed fixtures; only the Live tab needs the network.

## 1. From a clean checkout

Requirements: Node >= 22.18 (24 tested), pnpm 10.22.0. Rust 1.97.1 and Stellar CLI 25.2.0 only if you rebuild the contract (the wasm is committed).

```sh
cd projects/maker-checker
pnpm install                 # library deps (the console imports the library's own core from ../src)
pnpm --dir web install       # console deps
pnpm check                   # optional: typecheck, 70 tests, lint (no network)
pnpm --dir web build         # runs pnpm demo:data (fixtures -> web/src/data/demo.json), tsc, vite build -> web/dist
pnpm --dir web preview       # http://localhost:4173 (or the next free port it prints)
```

Live tab (optional, needs internet; writes to testnet only):

```sh
pnpm demo:serve              # second terminal; about 30 s to fund accounts and deploy the demo token
                             # then Live console -> Connect (http://127.0.0.1:8787)
MKR_COOLDOWN=20 pnpm demo:serve   # shorter cooldown for a live audience (default 30 s)
```

`demo:serve` generates throwaway keys in memory, funds them with friendbot, deploys `fixtures/wasm/rwa-demo.wasm`, registers the demo policy and serves the API with a labelled wallet simulator. Ctrl-C ends it and the keys are gone. Friendbot can take about 15 s to answer; the script now passes `--network-family-autoselection-attempt-timeout=10000`, retries friendbot four times with backoff and, if it still fails, prints a one-line reason and exits without starting. The Live tab accepts a console served from localhost or 127.0.0.1 on ports 4173-4182 and 5173-5182 (Vite moves to the next port when one is taken). **Run `demo:serve` on your own machine only, never on a shared host or a server:** it signs with in-memory throwaway keys for any local caller that passes its checks (loopback Host header, allow-listed or absent Origin, a `demo:<principal>` bearer token), so another local user could drive it.

Re-record the fixture (about 3 minutes, testnet):

```sh
pnpm e2e:testnet && pnpm demo:data
```

CLI checks an engineer may want to see:

```sh
node src/cli.ts policy hash fixtures/policies/example-treasury.policy.json
node src/cli.ts policy validate fixtures/policies/invalid/groups-overlap.policy.json --json   # exit 1
node src/cli.ts audit verify fixtures/testnet/e2e-audit.jsonl
node src/cli.ts audit export fixtures/testnet/e2e-audit.jsonl --format csv --control-actions
```

## 2. Investor script (3-5 minutes)

**0:00 Overview tab.** "This is the approval layer an institution puts in front of Stellar signing keys." Point at the gate badges: DEMO-ONLY, TESTNET ONLY, UNAUDITED. Read the amber notice out loud: the rules are enforced off-chain by this software; a key holder can bypass it. "It does not claim to be custody. It is workflow and evidence."

**0:40 Hero figure.** "8 of 8 refused": in the recorded testnet run, eight scripted attempts to break the rules were each refused with a stable error code and none reached the chain. Say it is scripted, not a hit rate. Two of them had a key sign something first (Carol over the wrong statement; the operator on an auth entry the maker then tried to submit) and the service still refused. The chip says where it came from: testnet run, ledger 5,622,041, 2026-11-08.

**1:00 Stat tiles.** Three SEP-53 approvals, re-verified in this page, not just shown. One authorisation entry collected from a second signer (the operator), which the Stratum multisig UI refused to build when we read its code on 2026-10-31 (PITCH.md has the source; it may have changed since). 14 audit entries whose hash chain the page re-derives. 45 s from proposal to on-chain freeze, including a 20 s cooldown the policy imposed.

**1:30 Recorded run tab.** Scroll the 20 steps. Click "Refused 8". Walk three: the mint blocked by a deny rule (403), Alice trying to approve her own request (S1, 422), the operator's signature arriving from Alice's device (S3, 422). Then "All 20" and the last steps: enforce-mode simulation, fee payer signature, submit, `is_frozen = true`. Click the transaction link: it opens the testnet explorer.

**2:30 Policy tab.** Show the rules in words: 2 checkers and 1 admin for control actions; at most 1,000 XLM per transfer to one listed recipient. In "Try the policy engine", pick "Send 1,500 XLM": Deny, PER_REQUEST_LIMIT_EXCEEDED. Pick "Mint": Deny, deny rule. This is the same evaluator the API runs, in the browser. In "Edit and validate", load `duplicate-key`: the parser refuses a JSON trick most parsers accept.

**3:15 Audit log tab.** "Try to tamper with a copy": edit entry 6 (an approval). Verification fails at seq 6. Restore. Cut the tail: it fails only because we compare against an anchored head. "That is why operators anchor the head outside the service."

**3:45 Live console (if `demo:serve` runs).** As Alice, Freeze holder. Switch to Bob, Approve; Carol, Approve; Dana, Approve. Plan auth. Wait for the cooldown counter. "Sign entry: maker's device": refused, S3. "Sign entry: operations desk", "Assemble and sign", "Submit". Read is_frozen: true, with a live chip and the ledger. If the server is not running, the tab says so and shows nothing simulated; use the Recorded run instead.

**4:30 Close.** What exists: the policy format, the state machine, multi-party auth-entry collection, the audit chain, an API and a CLI, all tested and run on testnet. What does not yet: real wallet, KMS and custody adapters, multisig source accounts, an audit. See `PITCH.md`.
