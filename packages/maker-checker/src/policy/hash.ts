// SPDX-License-Identifier: Apache-2.0
import { canonicalBytes } from "../canonical.ts";
import { sha256Hex } from "../hash.ts";
import type { Hex32 } from "../hash.ts";
import type { PolicyDoc } from "./types.ts";

/** SHA-256 of the JCS bytes of the document, lowercase hex, untagged (SPEC section 3.2). */
export function policyHash(doc: PolicyDoc): Hex32 {
  return sha256Hex(canonicalBytes(doc));
}
