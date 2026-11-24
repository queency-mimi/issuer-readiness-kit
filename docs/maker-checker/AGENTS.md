# AGENTS: maker-checker

Read `../../docs/AGENT_GUIDE.md`, `../../docs/GATES.md`, `../../docs/CONVENTIONS.md` first; then this project's README, SPEC, ARCHITECTURE, TASKS, RISKS, PRIOR-ART. Work inside this directory only. Do not commit.

Project rules (in addition to the guide):

1. **No keys, ever.** Nothing in this project may accept, store, log, or serialise a private key, seed or mnemonic (G-SECRETS). Tests use `StubSigner` (`Keypair.random()` at runtime). `pnpm lint` fails on seed-shaped strings; do not work around it.
2. **No mainnet writes.** Scripts that write must refuse any network but testnet. The submitter blocks mainnet unless the server flag is set, and agents never set it (G-VALUE).
3. **Do not describe this layer as enforcement of custody.** It gates workflow and records evidence; it cannot stop a key holder (SPEC section 0).
4. **SPEC first.** Change `SPEC.md` before changing an interface, and update the schema, the OpenAPI file and the smoke test in the same change. `PolicyDoc` is a cross-project artefact: a change to its hash rule needs an ADR in `docs/decisions/` (ask via TASKS "Cross-project requests").
5. **Fail closed.** When a parser, evaluator or verifier meets something it does not understand, it denies with a stable code. Never default to allow.
6. **Pure cores.** `src/policy/`, `src/workflow/`, `src/canonical.ts` do no I/O and read no clock; time and network come in as arguments.
7. **No copying third-party code** (G-LICENCE). Perch, Stratum and Tessera are read for ideas; if a ticket needs code from them, stop and record it in `docs/THIRD_PARTY.md` and `NOTICE` only after the licence check.
8. **Never contact anyone.** Notes for the Stratum maintainer, OpenZeppelin, custody vendors or counsel go in `drafts/` for the user to send (G-OUTREACH, G-LEGAL).
9. **Tag facts** [P] [S] [V] [I] [E] [U] with dates; add a spike ticket for every [U] you depend on.
10. **Language:** TypeScript, Node 24 type stripping, `erasableSyntaxOnly` (no enums, no namespaces, no parameter properties). `.ts` import suffixes. SPDX header on every source file.

Commands: `pnpm install`, `pnpm typecheck`, `pnpm test`, `pnpm lint`, `pnpm check`, `node src/cli.ts --help`.
