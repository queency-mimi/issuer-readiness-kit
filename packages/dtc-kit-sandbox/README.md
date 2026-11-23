# @sik/dtc-kit-sandbox

Mock DTC registry and participant simulator. **DTC-shaped, not DTC-certified; fictional institutions; not the DTCC API.**

- `src/institutions.ts`: four fake participants (`SBX-9001..9004`), clients, two fake wallet vendors, fake addresses, fake CUSIP `SBX000AA0`.
- `src/api.ts`: the route table (`ROUTES`), request/response types, error shape. Built from public help-page vocabulary; DTCC's real API is login-gated and unread.
- `src/registry.ts`: `MockDtcRegistry` (DTC-011..013, 015, 016): wallets, conversion orders, transfers, DTC override, corporate actions, CSV, a simulated clock with a job queue (OFAC 30 s, allowlist 30 s, conversion 600 s; sandbox constants, not DTC's). Composes the core reducers; no rule of its own.
- `src/app.ts`: the HTTP API as a pure function `handle(registry, request)`, shared by the Node server and the browser console.
- `src/server.ts`: Node HTTP shell around `handle`. `src/transport.ts`: HTTP and in-process transports.
- `src/scenarios/`: the five scripted scenarios as data and `runScripted(urlOrTransport, scenario)` (DTC-014). All five pass in-process and over HTTP.
- `src/browser.ts`: browser-safe entry (`@sik/dtc-kit-sandbox/browser`).
- `Dockerfile`, `docker-compose.yml`, `.env.example`: scaffold, **not yet run** (docker absent on the scaffold machine; DTC-017).

Run: `pnpm sandbox` (from the repo root) then `curl -i localhost:8080/v1/health`.

Sandbox-only credentials (no secrets exist in this project): `client_id` = a participant's `serviceAccountId` (`sa-alder-1`, `sa-birch-1`, `sa-cedar-1`, `sa-dunmore-1`), `dtc-ops-1`, or `sim-1`; `client_secret` = `sandbox-secret` for all.

The sanctions "list" is a fictional id (`SBX-SDN-0001`). No real OFAC data is used or fetched (G-LEGAL).
