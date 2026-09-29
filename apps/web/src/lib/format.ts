/** Display formatting, in the study's time zone. */

let tz = "Europe/London";
export const setTimeZone = (z: string) => {
  tz = z;
};
export const timeZone = () => tz;

const dt = new Map<string, Intl.DateTimeFormat>();
function fmt(key: string, opts: Intl.DateTimeFormatOptions) {
  const k = `${key}|${tz}`;
  let f = dt.get(k);
  if (!f) {
    f = new Intl.DateTimeFormat("en-GB", { ...opts, timeZone: tz });
    dt.set(k, f);
  }
  return f;
}

export function dateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "—";
  return fmt("dt", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(t);
}

export function dateOnly(iso: string | null | undefined): string {
  if (!iso) return "—";
  const t = Date.parse(iso.length === 10 ? `${iso}T12:00:00Z` : iso);
  if (!Number.isFinite(t)) return "—";
  return fmt("d", { day: "numeric", month: "short", year: "numeric" }).format(t);
}

export function shortDay(day: string): string {
  const t = Date.parse(`${day}T12:00:00Z`);
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }).format(t);
}

export function relative(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return "never";
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "—";
  const s = Math.round((now - t) / 1000);
  if (Math.abs(s) < 45) return "just now";
  const m = Math.round(s / 60);
  if (Math.abs(m) < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (Math.abs(h) < 36) return `${h} h ago`;
  const d = Math.round(h / 24);
  return `${d} days ago`;
}

export const int = (n: number | null | undefined) => (n === null || n === undefined ? "—" : n.toLocaleString("en-GB"));

export function pct(n: number | null | undefined, estimated = false): string {
  if (n === null || n === undefined) return "n/a";
  return `${estimated ? "≈ " : ""}${Math.round(n * 100)}%`;
}

export function duration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return "—";
  const m = ms / 60_000;
  if (m < 1) return `${Math.round(ms / 1000)} s`;
  if (m < 90) return `${m.toFixed(m < 10 ? 1 : 0)} min`;
  return `${(m / 60).toFixed(1)} h`;
}

export const shortId = (id: string) => (id.length > 12 ? `${id.slice(0, 6)}…${id.slice(-4)}` : id);

export function bytes(n: number | null | undefined): string {
  if (!n) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
