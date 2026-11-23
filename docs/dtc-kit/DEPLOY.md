# dtc-kit: deploy and publish checklist (later phase)

<!-- SPDX-License-Identifier: Apache-2.0 -->

Nothing here has been deployed or published (2026-11-08). This is the list to make it mechanical. The user deploys and publishes; agents do not (G-OUTREACH).

## 1. What must never happen

- **No mainnet.** Adapters reject any network other than `testnet` or `local` at compile time and at runtime (G-VALUE). Do not add a mainnet config, do not fund a mainnet account, do not point `testnet-spike.ts` at another Horizon.
- **No keys in the repo, CI secrets or images** (G-SECRETS). The spike generates throwaway testnet keys at runtime and discards them; nothing to configure.
- **No real sanctions data, no hosted screening, no custody** (G-LEGAL). The sandbox "OFAC" list is a fictional id.
- **No wording of DTC compatibility or certification** anywhere (G-DTCC). Keep "DTC-shaped, not DTC-certified" on every surface, the `x-dtc-kit-disclaimer` header on every sandbox response, and fictional names.
- **No login-gated DTCC material** in profiles, fixtures or docs.

## 2. Static console (`web/`)

| Item | Value |
|---|---|
| Build | `pnpm install && pnpm demo:data` (repo root), then `cd web && pnpm install --ignore-workspace --frozen-lockfile && pnpm build` |
| Output | `web/dist/` (static; relative asset paths, `base: './'`; hash routing, so any static host works, no rewrites) |
| Size | about 0.7 MB JS (177 kB gzipped), 41 kB CSS, bundled Geist fonts; no runtime network requests |
| Env vars | none |
| Host | any static host (GitHub Pages, Cloudflare Pages, Netlify, S3 + CDN). Set `Cache-Control: no-cache` on `index.html` |
| Before publishing | re-run `pnpm demo:data` so the provenance date is current; check both themes and 375 px width; run the DESIGN.md pre-flight |

## 3. npm packages

Currently `private: true` under `@sik/*`. To publish, per package: remove `private`, choose the scope, add `files`, `repository`, `publishConfig.access`, and a build step, because the packages ship TypeScript sources run by Node type stripping (consumers on Node >= 22.18 can import `.ts` only from their own code, not from `node_modules`). Plan: emit JS + `.d.ts` with `tsc` (`rewriteRelativeImportExtensions`) into `dist/` and point `exports` there.

| Package | Publish? | Notes |
|---|---|---|
| `@sik/dtc-kit-profile-spec` | yes | schema + profiles + loader; `./pure` entry is browser-safe |
| `@sik/dtc-kit-core` | yes | state machines and the ChainAdapter port; no I/O |
| `@sik/dtc-kit-sandbox` | yes | `./browser` entry (registry, handler, scenarios) and Node server |
| `@sik/dtc-kit-adapter-stellar-sac` | yes | depends on `@stellar/stellar-sdk` 17.4.0 |
| `@sik/dtc-kit-adapter-stellar-sep57` | after DTC-026 | plans not yet run on testnet; publish with that stated in the README |
| `@sik/dtc-kit-conformance` | yes | runner, CLI (`bin` to add), pack JSON and schema |
| `@sik/dtc-kit-reconciliation` | after review | allocation maths should get an independent review before a participant relies on it; `holders-source` reads the holders-at-ledger schema from disk (set `DTC_HAL_SCHEMA`) |

Also publish `packages/conformance/packs/dtc-kit-readiness.pack.json` and `schema/scenario-pack.schema.json` as stable URLs (cross-project contract; ADR draft is DTC-039).

## 4. Sandbox container

`packages/sandbox/Dockerfile` and `docker-compose.yml` exist but have **never been built** (no docker on the build machine, DTC-017). On a machine with docker: `docker compose -f packages/sandbox/docker-compose.yml up --build`, then `pnpm conformance run` style checks via `node -e` against `http://localhost:8080` (or `runScripted("http://localhost:8080", ...)`). Env vars: `PORT` (default 8080), `HOST` (default `127.0.0.1`; the container must set `HOST=0.0.0.0`), `DTC_PROFILE` (`dtc-stellar` default, or `dtc-generic`). Pin the image digest before publishing.

## 5. CI (GitHub Action, to add)

```yaml
# .github/workflows/dtc-kit.yml (sketch)
jobs:
  check:
    runs-on: ubuntu-latest
    defaults: { run: { working-directory: projects/dtc-kit } }
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with: { version: 10.22.0 }
      - uses: actions/setup-node@v4
        with: { node-version: 24 }
      - run: pnpm install --frozen-lockfile
      - run: pnpm check
      - run: pnpm conformance run --junit conformance.xml
      - run: cd web && pnpm install --ignore-workspace --frozen-lockfile && pnpm build
```

Do not run `pnpm testnet:spike` in CI by default (network, Friendbot rate limits); run it manually and commit the new fixture.

## 6. Testnet objects

There are no long-lived testnet contract ids. The recorded run (`fixtures/sac-force-transfer/testnet-run.json`) used a throwaway issuer and holders created on 2026-11-08 (asset `SBXTKN`, issuer `GDXRG7AWR6F6VAGFNCJMINZLPPDQK2X7AQRGDZQHUKCRZ6ZY5EBMPPMI`). Testnet resets periodically; after a reset the explorer links in the console stop resolving while the fixture (hashes, ledgers, envelopes) stays valid evidence of what happened. Re-run `pnpm testnet:spike` and `pnpm demo:data` to refresh.

## 7. Before any public launch

- Re-run the prior-art search (PRIOR-ART.md) and keep "no first/novel claims" (G-NOVELTY).
- DTC-006: re-verify every `published` generic row against its primary source, or downgrade it.
- Legal review of the wording and of the sandbox's fictional sanctions feature (G-LEGAL).
- Decide licence notices for bundled fonts (SIL OFL 1.1) and icons (MIT) in the console's About text.
