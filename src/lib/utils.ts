import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { formatMoney, formatDate as formatDateL, formatTime as formatTimeL } from "@/lib/format";

/** Merge Tailwind classes safely. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * CHF currency, Swiss formatting: CHF 1'490.00
 * @deprecated Use `formatMoney(amount, currency, locale)` from "@/lib/format",
 * or the tenant-bound `f.money()` from `getFormatter()` (server) / `useFormat()` (client).
 */
export function formatCHF(amount: number | string | null | undefined) {
  return formatMoney(amount, "CHF", "de-CH");
}

/**
 * Swiss date: 23.05.2026
 * @deprecated Use `f.date()` from `getFormatter()` (server) / `useFormat()` (client),
 * which apply the tenant locale and time zone.
 */
export function formatDate(date: string | Date | null | undefined) {
  return formatDateL(date, { locale: "de-CH", timeZone: "Europe/Zurich" });
}

export function initials(name: string | null | undefined) {
  if (!name) return "?";
  return name
    .split(" ")
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

/**
 * Short time, Swiss locale: 17:00
 * @deprecated Use `f.time()` from `getFormatter()` / `useFormat()`.
 */
export function formatTime(date: string | Date | null | undefined) {
  return formatTimeL(date, { locale: "de-CH", timeZone: "Europe/Zurich" });
}

/**
 * Compact relative time: "just now", "3h ago", "2d ago".
 * Prefer `f.relative()` from `useFormat()` for localised output.
 */
export function timeAgo(date: string | Date | null | undefined) {
  if (!date) return "";
  const d = typeof date === "string" ? new Date(date) : date;
  const secs = Math.round((Date.now() - d.getTime()) / 1000);
  if (secs < 60) return "just now";
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return formatDate(d);
}
