#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
"""Independent reference canonicaliser for the kit's JCS subset (SPEC 3.1), MKR-001.

Python's json.dumps(sort_keys=True, separators=(",", ":"), ensure_ascii=False) equals RFC 8785
on the subset the kit accepts (objects, arrays, strings, booleans, safe integers) except:
  * sort order: Python sorts keys by code point, RFC 8785 by UTF-16 code units. They differ only
    for keys mixing astral characters with U+E000..U+FFFF; we sort by UTF-16 explicitly below.
  * escaping: with ensure_ascii=False Python writes DEL, U+2028/2029 and non-ASCII literally and
    C0 controls as lowercase \\u00xx except the short forms, which is what RFC 8785 requires.
  * floats / NaN / null: outside the subset; this script refuses them like the TS code.
Usage: jcs_reference.py <file.json>   (writes canonical bytes to stdout, no trailing newline)
"""
import json
import sys


def check(v, path="/"):
    if v is None:
        raise SystemExit(f"unsupported null at {path}")
    if isinstance(v, bool):
        return
    if isinstance(v, int):
        if abs(v) > 2**53 - 1:
            raise SystemExit(f"unsafe integer at {path}")
        return
    if isinstance(v, float):
        raise SystemExit(f"float at {path}")
    if isinstance(v, str):
        return
    if isinstance(v, list):
        for i, x in enumerate(v):
            check(x, f"{path}{i}/")
        return
    if isinstance(v, dict):
        for k, x in v.items():
            check(x, f"{path}{k}/")
        return
    raise SystemExit(f"unsupported type at {path}")


def utf16_key(s):
    return s.encode("utf-16-be")


def canon(v):
    if isinstance(v, dict):
        items = sorted(v.items(), key=lambda kv: utf16_key(kv[0]))
        return "{" + ",".join(json.dumps(k, ensure_ascii=False) + ":" + canon(x) for k, x in items) + "}"
    if isinstance(v, list):
        return "[" + ",".join(canon(x) for x in v) + "]"
    return json.dumps(v, ensure_ascii=False)


def main():
    with open(sys.argv[1], "rb") as f:
        data = json.loads(f.read().decode("utf-8"))
    check(data)
    sys.stdout.buffer.write(canon(data).encode("utf-8"))


if __name__ == "__main__":
    main()
