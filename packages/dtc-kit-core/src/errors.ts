// SPDX-License-Identifier: Apache-2.0
export { NotImplemented } from "@sik/dtc-kit-profile-spec/pure";

/** An event that is illegal in the current state. Reducers throw it; hosts map it to 409/422. */
export class InvalidTransition extends Error {
  readonly from: string;
  readonly event: string;

  constructor(from: string, event: string, detail?: string) {
    super(`InvalidTransition: ${event} is not allowed from ${from}${detail ? ` (${detail})` : ""}`);
    this.name = "InvalidTransition";
    this.from = from;
    this.event = event;
  }
}
