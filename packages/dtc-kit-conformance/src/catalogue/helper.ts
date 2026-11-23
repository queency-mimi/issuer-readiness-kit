// SPDX-License-Identifier: Apache-2.0
import type { Scenario } from "../pack.ts";

/** Identity function that gives object literals full type checking. */
export const scenario = (s: Scenario): Scenario => s;
