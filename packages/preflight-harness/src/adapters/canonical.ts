// SPDX-License-Identifier: Apache-2.0
// Canonical strings for recorded contract calls. The capture script writes simulations under these keys and the
// Stellar-Preflight Chain feeder looks them up with the same function, so a lookup either hits the exact recorded
// call or reports "no recorded simulation" (never a guess).

export type CallArg = string | bigint | number | boolean;

/** `C...TOKEN.fn(arg1, arg2)`: addresses as strkeys, integers as decimal strings. */
export function canonicalCall(contractId: string, fn: string, args: readonly CallArg[]): string {
  return `${contractId}.${fn}(${args.map((a) => String(a)).join(", ")})`;
}

/** Key for a read-only call stored under `contracts[id].reads`: `fn(arg1, arg2)`. */
export function readKey(fn: string, args: readonly CallArg[]): string {
  return `${fn}(${args.map((a) => String(a)).join(", ")})`;
}

/** Stroops (7-decimal integer units) -> Horizon decimal string with exactly 7 decimals. */
export function stroopsToDecimal(stroops: string | bigint): string {
  const v = BigInt(stroops);
  const neg = v < 0n;
  const abs = neg ? -v : v;
  return `${neg ? "-" : ""}${abs / 10_000_000n}.${(abs % 10_000_000n).toString().padStart(7, "0")}`;
}

/** Decimal amount with at most 7 decimals -> stroops, or null when malformed. */
export function decimalToStroops(amount: string): bigint | null {
  const m = /^(\d+)(?:\.(\d{1,7}))?$/.exec(amount.trim());
  if (!m) return null;
  return BigInt(m[1]!) * 10_000_000n + BigInt((m[2] ?? "").padEnd(7, "0"));
}
