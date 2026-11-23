// SPDX-License-Identifier: Apache-2.0
// Time-zone helpers built on Intl only (no fixed UTC offsets, DST-safe). Used by the precheck hours rule and
// the record-date capture.

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_RE = /^(\d{2}):(\d{2})$/;

export interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  /** Mon..Sun */
  weekday: string;
}

const formatters = new Map<string, Intl.DateTimeFormat>();
function formatter(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      weekday: "short",
    });
    formatters.set(timeZone, f);
  }
  return f;
}

/** Wall-clock parts of an instant in a time zone. */
export function zonedParts(epochMs: number, timeZone: string): ZonedParts {
  const parts = Object.fromEntries(formatter(timeZone).formatToParts(new Date(epochMs)).map((p) => [p.type, p.value]));
  return {
    year: Number(parts["year"]),
    month: Number(parts["month"]),
    day: Number(parts["day"]),
    hour: Number(parts["hour"]),
    minute: Number(parts["minute"]),
    second: Number(parts["second"]),
    weekday: String(parts["weekday"]),
  };
}

/** Offset of the zone from UTC at an instant, in minutes (e.g. -300 for EST). */
export function offsetMinutes(epochMs: number, timeZone: string): number {
  const p = zonedParts(epochMs, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((asUtc - Math.floor(epochMs / 1000) * 1000) / 60000);
}

export function parseIsoDate(date: string): { year: number; month: number; day: number } {
  const m = DATE_RE.exec(date);
  if (!m) throw new Error(`invalid ISO date ${date} (want YYYY-MM-DD)`);
  return { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
}

export function parseHhMm(time: string): { hour: number; minute: number } {
  const m = TIME_RE.exec(time);
  if (!m) throw new Error(`invalid time ${time} (want HH:MM)`);
  return { hour: Number(m[1]), minute: Number(m[2]) };
}

/**
 * The instant at which the wall clock in `timeZone` reads `date time`, as ISO-8601 with the zone's offset,
 * e.g. 2027-03-14T20:00:00-04:00. Iterates the offset twice so DST transition days resolve correctly.
 */
export function zonedInstant(date: string, time: string, timeZone: string): { iso: string; epochMs: number } {
  const d = parseIsoDate(date);
  const t = parseHhMm(time);
  const wall = Date.UTC(d.year, d.month - 1, d.day, t.hour, t.minute);
  let guess = wall;
  for (let i = 0; i < 3; i++) guess = wall - offsetMinutes(guess, timeZone) * 60000;
  const off = offsetMinutes(guess, timeZone);
  const sign = off < 0 ? "-" : "+";
  const abs = Math.abs(off);
  const pad = (n: number) => String(n).padStart(2, "0");
  const iso = `${date}T${pad(t.hour)}:${pad(t.minute)}:00${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
  return { iso, epochMs: guess };
}

/** Add days to an ISO date (calendar arithmetic in UTC, no zone involved). */
export function addDays(date: string, days: number): string {
  const d = parseIsoDate(date);
  return new Date(Date.UTC(d.year, d.month - 1, d.day + days)).toISOString().slice(0, 10);
}

/** 0 = Sunday .. 6 = Saturday for a calendar date. */
export function dayOfWeek(date: string): number {
  const d = parseIsoDate(date);
  return new Date(Date.UTC(d.year, d.month - 1, d.day)).getUTCDay();
}
