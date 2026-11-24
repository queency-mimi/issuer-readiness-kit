// SPDX-License-Identifier: Apache-2.0
// Typed JSON form of Soroban values (SPEC 5.2). Fail closed on types not yet mapped (MKR-018 spike).
import { Address, nativeToScVal, scValToBigInt, xdr } from "@stellar/stellar-sdk";
import { MkrError } from "../errors.ts";
import { bytesToHex, hexToBytes } from "../hash.ts";
import type { ScValJson } from "../workflow/types.ts";

const unsupported = (t: string): never => {
  throw new MkrError("MKR_E_USAGE", `ScVal type ${t} is not mapped in v1 (spike MKR-018); refusing to approve what cannot be shown`);
};

export function scValToJson(v: xdr.ScVal): ScValJson {
  switch (v.type) {
    case "scvBool":
      return { type: "bool", value: v.b };
    case "scvVoid":
      return { type: "void" };
    case "scvU32":
      return { type: "u32", value: v.u32 };
    case "scvI32":
      return { type: "i32", value: v.i32 };
    case "scvU64":
    case "scvI64":
    case "scvU128":
    case "scvI128":
    case "scvU256":
    case "scvI256":
      return { type: v.type.slice(3).toLowerCase() as "u64", value: scValToBigInt(v).toString() };
    case "scvBytes":
      return { type: "bytes", value: bytesToHex(v.bytes.value) };
    case "scvString":
      return { type: "string", value: String(v.str) };
    case "scvSymbol":
      return { type: "symbol", value: String(v.sym) };
    case "scvAddress":
      return { type: "address", value: Address.fromScAddress(v.address).toString() };
    case "scvVec":
      return { type: "vec", value: (v.vec ?? []).map(scValToJson) };
    case "scvMap":
      return { type: "map", value: (v.map ?? []).map((e) => ({ key: scValToJson(e.key), value: scValToJson(e.val) })) };
    default:
      return unsupported(v.type);
  }
}

export function jsonToScVal(j: ScValJson): xdr.ScVal {
  switch (j.type) {
    case "bool":
      return xdr.ScVal.scvBool(j.value);
    case "void":
      return xdr.ScVal.scvVoid();
    case "u32":
      return xdr.ScVal.scvU32(j.value);
    case "i32":
      return xdr.ScVal.scvI32(j.value);
    case "u64":
    case "i64":
    case "u128":
    case "i128":
    case "u256":
    case "i256":
      if (!/^-?(0|[1-9][0-9]*)$/.test(j.value)) throw new MkrError("MKR_E_USAGE", `bad ${j.type} value`);
      return nativeToScVal(BigInt(j.value), { type: j.type });
    case "bytes":
      return xdr.ScVal.scvBytes(hexToBytes(j.value));
    case "string":
      return xdr.ScVal.scvString(j.value);
    case "symbol":
      return xdr.ScVal.scvSymbol(j.value);
    case "address":
      return new Address(j.value).toScVal();
    case "vec":
      return xdr.ScVal.scvVec(j.value.map(jsonToScVal));
    case "map":
      return xdr.ScVal.scvMap(j.value.map((e) => new xdr.ScMapEntry({ key: jsonToScVal(e.key), val: jsonToScVal(e.value) })));
  }
  return unsupported((j as { type: string }).type);
}

/** Short clear-signing rendering of a value. */
export function renderScVal(j: ScValJson): string {
  switch (j.type) {
    case "void":
      return "void";
    case "vec":
      return "[" + j.value.map(renderScVal).join(", ") + "]";
    case "map":
      return "{" + j.value.map((e) => `${renderScVal(e.key)}: ${renderScVal(e.value)}`).join(", ") + "}";
    case "string":
      return JSON.stringify(j.value);
    default:
      return `${String(j.value)}${j.type === "bool" || j.type === "address" || j.type === "symbol" ? "" : ` (${j.type})`}`;
  }
}
