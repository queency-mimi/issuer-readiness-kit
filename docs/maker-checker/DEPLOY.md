# DEPLOY: later-phase checklist (nothing here has been done)

<!-- SPDX-License-Identifier: Apache-2.0 -->

Status 2026-11-08: nothing is hosted, published or deployed except throwaway testnet contracts created by the demo scripts. Every item below waits for the user. **Nothing in this project may write to mainnet (G-VALUE).**

## 1. Static web console (`web/`)

| Item | Value |
|---|---|
| Build | `pnpm install && pnpm --dir web install && pnpm --dir web build` (needs the root install: the console imports `../src`) |
| Output | `web/dist/` (static, relative base `./`, fonts bundled, no runtime fetches except the Live tab and explorer links) |
| Host | any static host (GitHub Pages, Cloudflare Pages, Netlify, S3+CDN). No server-side code, no env vars |
| Size | about 0.63 MB JS (161 kB gzip) plus fonts, 2026-11-08 build |
| Live tab when hosted | calls `http://127.0.0.1:8787` from the viewer's browser. From an `https` origin, browsers may block this (mixed content / private network access). The recorded tabs are the hosted demo; the Live tab is for local demos. Do not expose `demo:serve` publicly |
| Checks before publishing | `pnpm demo:data` rebuilt from the current fixtures; light and dark at 1440 and 390 px; no console errors |

## 2. npm package `@sik/maker-checker`

- Today `private: true`, version 0.1.0. To publish: remove `private`, choose the public scope, add `exports` for `src/index.ts` built output (a `tsc` emit or a bundler step is needed: the source runs by Node type stripping and ships `.ts` imports), add `files` (src, schemas, openapi, README, LICENSE), and decide whether `scripts/` and `contracts/` stay out (they should).
- Keep the package DEMO-ONLY in its description until an audit (G-CRYPTO labelling rule).
- Publish `schemas/*.schema.json` and `openapi/openapi.yaml` with the package; other projects depend on the PolicyDoc schema and hash rule (SPEC 3.2).
- CLI binary: add `"bin": { "mkr": ... }` pointing at the built `cli.js`.

## 3. Contract (`contracts/rwa-demo`)

- DEMO-ONLY wrapper around OpenZeppelin `stellar-tokens` 0.7.1. **Do not publish to crates.io** and **never deploy to mainnet**: identity verifier and compliance are wired to the operator address, so it is not a usable RWA token.
- Testnet contract ids are ephemeral (a new one per `pnpm e2e:testnet` or `pnpm demo:serve`, operator key discarded at exit). Recorded instance: `CBOKJQLZUMEMWGRSTI6EPAXKNYBAG2GMA7Y25GYMN64JAMVN35IMGVCI` (deploy ledger 5,622,029, 2026-11-08); its operator key no longer exists, so it can only be read.
- Rebuild: `pnpm contract:build` (Stellar CLI 25.2.0, `stellar contract build`; plain `cargo build --target wasm32v1-none` fails because OZ enables `experimental_spec_shaking_v2`). Commit the wasm and update `fixtures/` by re-running `pnpm e2e:testnet` so the recorded sha256 matches.

## 4. The API as a service

Not for hosting yet. Before any operator runs `mkr serve` for real:

| Requirement | Why |
|---|---|
| Bind 127.0.0.1 behind a TLS terminator; host-issued bearer tokens mapped to principals (`mkr serve --tokens <map.json>`, or the `authenticate` option) | SPEC 10.1; without `--tokens` the server has no caller identity and prints a warning; the demo `demo:<principal>` tokens are for local demos only. The server also refuses a non-loopback Host header and a foreign browser Origin (DNS-rebinding guard); pass `allowedHosts` when fronted by a proxy |
| `--rpc <url>` given | without it plan, assemble and submit are unavailable |
| Durable audit store on a disk with backups; anchor `GET /v1/audit/head` externally (WORM store or a ledger memo) | SPEC 8.5; truncation is only detectable against an anchor |
| A trusted clock | cooldowns, windows and expiry depend on it (R-S7) |
| Real signer adapters (SEP-43, KMS) replacing the wallet simulator | the simulator holds keys in process memory; acceptable for testnet only |
| `--allow-mainnet-submit` left off | G-VALUE; agents never set it. A second guard makes `createRpcSubmitter` throw for the public network unless the flag opts in. Consider compiling the flag out until G-VALUE opens |
| `pnpm audit --prod` (root and web) run with a working registry | not completed in the audit sandbox (registry timeouts); direct deps are exact pins |
| Rebuild `fixtures/wasm/rwa-demo.wasm` from source and compare sha256 | the committed wasm matches the run record but was not rebuilt by the auditor; `rwa-demo` operator instance storage is never TTL-extended (low, demo only) |
| Runbook (MKR-034), threat model (MKR-028), review package (MKR-033) | counsel and security review before anyone holds keys |

Env vars used by the demo scripts only: `MKR_PORT` (default 8787), `MKR_COOLDOWN` (seconds, default 30), `MKR_RPC` (default `https://soroban-testnet.stellar.org`). No secrets are read from the environment.

## 5. What must never go to mainnet

- Any transaction from `scripts/e2e-testnet.ts`, `scripts/demo-server.ts` or `scripts/lib/world.ts` (they call `assertTestnet` and use testnet friendbot).
- `contracts/rwa-demo` in any form.
- The wallet simulator (`scripts/lib/wallet-sim.ts`) or `StubSigner` holding any key that controls value.
- A policy with `network.name = "mainnet"` submitted by this code before G-VALUE opens: an audit scope document, a value cap and the user's written approval.
