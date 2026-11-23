// SPDX-License-Identifier: Apache-2.0
import { chill } from "./s4-chill.ts";
import { convert } from "./s3-convert.ts";
import { forceTransfer } from "./s5-force-transfer.ts";
import { ofacFail } from "./s2-ofac-fail.ts";
import { registerWallet } from "./s1-register-wallet.ts";
import type { ScriptedScenario } from "./types.ts";

export * from "./types.ts";
export * from "./runner.ts";
export { chill, convert, forceTransfer, ofacFail, registerWallet };

/** The five roadmap scenarios, in order: register wallet, OFAC fail, convert, chill, force-transfer. */
export const FIVE_SCENARIOS: readonly ScriptedScenario[] = [registerWallet, ofacFail, convert, chill, forceTransfer];
