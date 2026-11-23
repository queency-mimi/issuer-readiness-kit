// SPDX-License-Identifier: Apache-2.0
// CSV exports (DTC-016). The column layouts are dtc-kit's OWN: DTCC's real export layouts are not recorded
// in the public pages read (row wallet.csv-exports, value columnsRecorded: false). Every file says so on line 1.

export const CSV_NOTE = "# dtc-kit sandbox export: columns are dtc-kit's own, not DTCC's (layouts not public). DTC-shaped, not DTC-certified.";

function cell(v: unknown): string {
  const s = v === undefined || v === null ? "" : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(columns: readonly string[], rows: readonly Record<string, unknown>[]): string {
  const lines = [CSV_NOTE, columns.map(cell).join(",")];
  for (const r of rows) lines.push(columns.map((c) => cell(r[c])).join(","));
  return `${lines.join("\n")}\n`;
}

/** Parse a dtc-kit CSV (comment lines starting with # are skipped) into string records. */
export function parseCsv(text: string): Record<string, string>[] {
  const records: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let atLineStart = true;
  let comment = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i] as string;
    if (atLineStart && ch === "#" && !quoted) comment = true;
    atLineStart = false;
    if (comment) {
      if (ch === "\n") {
        comment = false;
        atLineStart = true;
      }
      continue;
    }
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n") {
      row.push(field);
      records.push(row);
      row = [];
      field = "";
      atLineStart = true;
    } else if (ch !== "\r") field += ch;
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    records.push(row);
  }
  const [header, ...body] = records;
  if (!header) return [];
  return body.map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ""])));
}
