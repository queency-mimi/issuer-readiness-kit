// SPDX-License-Identifier: Apache-2.0
// Capture script stub (MKR-016). Records, from testnet only, what the kit needs to plan multi-party
// authorisation offline: the unsigned transaction, the record-mode simulation response, the decoded
// auth entries, the source account's signers/thresholds, and (for contract-account cases) the
// enforce-mode simulation after signing with THROWAWAY keys generated at runtime.
//
// Rules (docs/GATES.md G-SECRETS, docs/CONVENTIONS.md Fixtures):
//  - testnet only; throwaway keys from Keypair.random(), never written to disk or logged;
//  - every fixture gets <name>.provenance.json matching schemas/provenance.schema.json;
//  - fixtures hold public addresses, XDR and simulation responses only.
//
// Planned cases (one directory each under fixtures/auth-entries/):
//   01-single-g-source          call authorised by the tx source only (sourceAccount credentials)
//   02-two-g-addresses          transfer(from=A) where tx source is B: one address-credential slot
//   03-nested-token-transfer    contract call that internally transfers from A (nested tree)
//   04-classic-multisig-address address credential for a G account with two signers [U] spike MKR-016
//   05-contract-account         address credential for a C account with custom __check_auth
//   06-expiry-boundary          entry within SAFETY_LEDGERS of expiry
import { NotImplemented } from "../../../packages/maker-checker/src/errors.ts";

export async function capture(_options: { rpcUrl: string; outDir: string }): Promise<void> {
  throw new NotImplemented("MKR-016");
}

if (import.meta.main) {
  await capture({ rpcUrl: process.argv[2] ?? "https://soroban-testnet.stellar.org", outDir: process.argv[3] ?? "fixtures/maker-checker/auth-entries" });
}
