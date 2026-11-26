import type { Range } from "./math";

/** Search-param parsing shared by the finance pages and CSV exports (pure). */
export const isDay = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`));
export const isMonth = (v: unknown): v is string => typeof v === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(v);
export const isCurrency = (v: unknown): v is string => typeof v === "string" && /^[A-Z]{3}$/.test(v);
export const isUuid = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

/** Year to date (1 Jan .. today) unless both ends are valid; swapped when reversed. */
export function rangeFrom(sp: { from?: string | null; to?: string | null }, today: string): Range {
  const r: Range = { from: isDay(sp.from) ? sp.from : `${today.slice(0, 4)}-01-01`, to: isDay(sp.to) ? sp.to : today };
  return r.to < r.from ? { from: r.to, to: r.from } : r;
}

/** The 12 months ending with `today`'s month. */
export function last12Months(today: string): Range {
  const y = Number(today.slice(0, 4));
  const m = Number(today.slice(5, 7));
  const start = new Date(Date.UTC(y, m - 12, 1));
  return { from: start.toISOString().slice(0, 10), to: today };
}

/** "2026-11" -> "November 2026" / "Nov 26" in the user's locale. */
export function formatMonth(locale: string, key: string, style: "long" | "short" = "long"): string {
  const d = new Date(Date.UTC(Number(key.slice(0, 4)), Number(key.slice(5, 7)) - 1, 1));
  return new Intl.DateTimeFormat(locale, style === "long"
    ? { month: "long", year: "numeric", timeZone: "UTC" }
    : { month: "short", year: "2-digit", timeZone: "UTC" }).format(d);
}

export function qs(params: Record<string, string | null | undefined>): string {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) u.set(k, v);
  const s = u.toString();
  return s ? `?${s}` : "";
}
