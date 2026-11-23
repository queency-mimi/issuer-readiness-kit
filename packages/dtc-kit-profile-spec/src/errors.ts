// SPDX-License-Identifier: Apache-2.0

/**
 * Thrown by every stub. The ticket id is the contract: grep for it in TASKS.md.
 * No open-work marker may appear in code without a ticket id (docs/AGENT_GUIDE.md).
 */
export class NotImplemented extends Error {
  readonly ticket: string;

  constructor(ticket: string, detail?: string) {
    super(`NotImplemented(${ticket})${detail ? `: ${detail}` : ""}`);
    this.name = "NotImplemented";
    this.ticket = ticket;
  }
}
