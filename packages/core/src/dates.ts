/**
 * Time-zone-aware date helpers, with no dependency beyond Intl.
 *
 * "Today" and "this month" mean the study's day and month (Europe/London by
 * default), not the server's or the browser's — a researcher in Leeds and a
 * function in a data centre must agree on which day a sitting belongs to.
 */

const formatters = new Map<string, Intl.DateTimeFormat>();
function formatter(tz: string): Intl.DateTimeFormat {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-GB", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formatters.set(tz, f);
  }
  return f;
}

export interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

export function zonedParts(ms: number, tz: string): ZonedParts {
  const parts: Record<string, number> = {};
  for (const p of formatter(tz).formatToParts(new Date(ms))) {
    if (p.type !== "literal") parts[p.type] = Number(p.value);
  }
  return {
    year: parts["year"]!,
    month: parts["month"]!,
    day: parts["day"]!,
    hour: parts["hour"] === 24 ? 0 : parts["hour"]!,
    minute: parts["minute"]!,
    second: parts["second"]!,
  };
}

/** Offset of `tz` from UTC at instant `ms`, in milliseconds (London summer: +3,600,000). */
export function tzOffsetMs(ms: number, tz: string): number {
  const p = zonedParts(ms, tz);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(ms / 1000) * 1000;
}

const pad = (n: number, w = 2) => String(n).padStart(w, "0");

/** The study-local calendar day of an instant, "YYYY-MM-DD". */
export function dayKey(ms: number, tz: string): string {
  const p = zonedParts(ms, tz);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

export function parseDayKey(day: string): { year: number; month: number; day: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const d = Number(m[3]);
  const probe = new Date(Date.UTC(year, month - 1, d));
  if (probe.getUTCFullYear() !== year || probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== d) return null;
  return { year, month, day: d };
}

/** The UTC instant at which the study-local day `day` begins. */
export function startOfDayUtc(day: string, tz: string): number {
  const p = parseDayKey(day);
  if (!p) throw new RangeError(`not a calendar day: ${day}`);
  const guess = Date.UTC(p.year, p.month - 1, p.day);
  // Two passes settle a DST boundary: the offset at the guess and at the answer.
  let t = guess - tzOffsetMs(guess, tz);
  t = guess - tzOffsetMs(t, tz);
  return t;
}

export function addDays(day: string, n: number): string {
  const p = parseDayKey(day);
  if (!p) throw new RangeError(`not a calendar day: ${day}`);
  const d = new Date(Date.UTC(p.year, p.month - 1, p.day + n));
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** Monday of the ISO week containing `day`. */
export function weekStart(day: string): string {
  const p = parseDayKey(day)!;
  const dow = new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay(); // 0 = Sunday
  return addDays(day, -((dow + 6) % 7));
}

export function daysBetween(a: string, b: string): number {
  const pa = parseDayKey(a)!;
  const pb = parseDayKey(b)!;
  return Math.round((Date.UTC(pb.year, pb.month - 1, pb.day) - Date.UTC(pa.year, pa.month - 1, pa.day)) / 86_400_000);
}

export const DATE_PRESETS = ["today", "7d", "30d", "this_month", "prev_month", "all", "custom"] as const;
export type DatePreset = (typeof DATE_PRESETS)[number];

export const DATE_PRESET_LABELS: Record<DatePreset, string> = {
  today: "Today",
  "7d": "Last 7 days",
  "30d": "Last 30 days",
  this_month: "This month",
  prev_month: "Previous month",
  all: "All time",
  custom: "Custom range",
};

export interface ResolvedRange {
  /** Inclusive start (UTC ms), or null for unbounded. */
  from: number | null;
  /** Exclusive end (UTC ms), or null for unbounded. */
  to: number | null;
  /** Study-local first and last day, inclusive, where bounded. */
  fromDay: string | null;
  toDay: string | null;
}

export function resolveRange(
  preset: DatePreset,
  custom: { from?: string | undefined; to?: string | undefined },
  now: Date,
  tz: string,
): ResolvedRange {
  const today = dayKey(now.getTime(), tz);
  const span = (first: string, last: string): ResolvedRange => ({
    from: startOfDayUtc(first, tz),
    to: startOfDayUtc(addDays(last, 1), tz),
    fromDay: first,
    toDay: last,
  });
  const p = parseDayKey(today)!;
  const monthStart = `${p.year}-${pad(p.month)}-01`;
  switch (preset) {
    case "today":
      return span(today, today);
    case "7d":
      return span(addDays(today, -6), today);
    case "30d":
      return span(addDays(today, -29), today);
    case "this_month":
      return span(monthStart, today);
    case "prev_month": {
      const lastOfPrev = addDays(monthStart, -1);
      return span(`${lastOfPrev.slice(0, 7)}-01`, lastOfPrev);
    }
    case "custom": {
      const from = custom.from && parseDayKey(custom.from) ? custom.from : null;
      const to = custom.to && parseDayKey(custom.to) ? custom.to : null;
      if (from && to && from > to) return span(to, from);
      return {
        from: from ? startOfDayUtc(from, tz) : null,
        to: to ? startOfDayUtc(addDays(to, 1), tz) : null,
        fromDay: from,
        toDay: to,
      };
    }
    case "all":
    default:
      return { from: null, to: null, fromDay: null, toDay: null };
  }
}

export function inRange(iso: string | null | undefined, range: ResolvedRange): boolean {
  if (range.from === null && range.to === null) return true;
  if (!iso) return false;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return false;
  if (range.from !== null && t < range.from) return false;
  if (range.to !== null && t >= range.to) return false;
  return true;
}

/** "2026-09-01" → "1 Sep 2026" */
export function formatDay(day: string): string {
  const p = parseDayKey(day);
  if (!p) return day;
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(
    new Date(Date.UTC(p.year, p.month - 1, p.day)),
  );
}
