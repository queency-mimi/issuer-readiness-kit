// SPDX-License-Identifier: Apache-2.0
// Append-only JSON Lines store (SPEC 8.7): one canonical entry per line, fsync per append, lock file, mode 0600.
import { closeSync, existsSync, fsyncSync, openSync, readFileSync, renameSync, rmSync, writeFileSync, writeSync } from "node:fs";
import { canonicalize } from "../canonical.ts";
import { MkrError } from "../errors.ts";
import type { AuditEntry, AuditStore } from "./types.ts";

function sleepSync(ms: number) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

export class FileAuditStore implements AuditStore {
  readonly path: string;
  constructor(path: string) {
    this.path = path;
  }

  /** Parsed lines; throws MKR_E_AUDIT_CHAIN_BROKEN when the last line is partial (crash mid-write). */
  #lines(): AuditEntry[] {
    if (!existsSync(this.path)) return [];
    const text = readFileSync(this.path, "utf8");
    if (text.length === 0) return [];
    if (!text.endsWith("\n")) throw new MkrError("MKR_E_AUDIT_CHAIN_BROKEN", `${this.path}: last line is partial; run repair before appending`);
    return text.slice(0, -1).split("\n").map((l, i) => {
      try {
        return JSON.parse(l) as AuditEntry;
      } catch {
        throw new MkrError("MKR_E_AUDIT_CHAIN_BROKEN", `${this.path}: line ${i + 1} is not JSON`);
      }
    });
  }

  #withLock<T>(fn: () => T): T {
    const lock = this.path + ".lock";
    let fd: number | undefined;
    for (let i = 0; i < 200 && fd === undefined; i++) {
      try {
        fd = openSync(lock, "wx", 0o600);
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
        sleepSync(10);
      }
    }
    if (fd === undefined) throw new MkrError("MKR_E_AUDIT_APPEND_CONFLICT", `could not take ${lock}`);
    try {
      return fn();
    } finally {
      closeSync(fd);
      rmSync(lock, { force: true });
    }
  }

  head(): Promise<{ seq: number; hash: string } | undefined> {
    const lines = this.#lines();
    const last = lines[lines.length - 1];
    return Promise.resolve(last ? { seq: last.seq, hash: last.hash } : undefined);
  }

  append(entry: AuditEntry, expectedSeq: number): Promise<void> {
    return Promise.resolve(
      this.#withLock(() => {
        const n = this.#lines().length;
        if (expectedSeq !== n || entry.seq !== n) throw new MkrError("MKR_E_AUDIT_APPEND_CONFLICT", `expected seq ${n}, got ${expectedSeq}`);
        const fd = openSync(this.path, "a", 0o600);
        try {
          writeSync(fd, canonicalize(entry) + "\n");
          fsyncSync(fd);
        } finally {
          closeSync(fd);
        }
      }),
    );
  }

  read(fromSeq: number, limit: number): Promise<AuditEntry[]> {
    return Promise.resolve(this.#lines().slice(fromSeq, fromSeq + limit));
  }

  /** Move a partial last line to `<log>.partial` so appends can continue (the caller records a checkpoint). */
  repair(): { moved: boolean } {
    return this.#withLock(() => {
      if (!existsSync(this.path)) return { moved: false };
      const text = readFileSync(this.path, "utf8");
      if (text.length === 0 || text.endsWith("\n")) return { moved: false };
      const cut = text.lastIndexOf("\n") + 1;
      writeFileSync(this.path + ".partial", text.slice(cut), { mode: 0o600 });
      const tmp = this.path + ".tmp";
      writeFileSync(tmp, text.slice(0, cut), { mode: 0o600 });
      renameSync(tmp, this.path);
      return { moved: true };
    });
  }
}
