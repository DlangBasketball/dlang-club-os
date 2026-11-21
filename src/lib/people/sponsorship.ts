import { z } from "zod";
import { discountAmountMinor } from "@/lib/pricing/discounts";
import { fromMinorUnits, normalizeCurrency, toMinorUnits } from "@/lib/payments/currency";

/**
 * Sponsored players: the club pays all (full) or part (partial) of a player's
 * club fees. Pure module shared by pages, server actions and unit tests.
 *
 * Billing itself runs in SQL (migration 20250420102400_sponsored_players):
 * public.athlete_sponsorship_percent mirrors sponsorshipPercent() below, and
 * the sponsored share is always shown as its own "Sponsored (sponsor)" line
 * or credit note, recorded in public.athlete_sponsorship_entries.
 */

export const SPONSORSHIP_KINDS = ["none", "full", "partial"] as const;
export type SponsorshipKind = (typeof SPONSORSHIP_KINDS)[number];

/** Fees a sponsorship can cover. "all" covers every one of them. */
export const SPONSORSHIP_SCOPES = ["season", "recurring", "membership", "camp", "training", "shop", "all"] as const;
export type SponsorshipScope = (typeof SPONSORSHIP_SCOPES)[number];
/** A fee being billed (never "all"). */
export type FeeScope = Exclude<SponsorshipScope, "all">;
export const DEFAULT_SPONSORSHIP_SCOPE: SponsorshipScope[] = ["season", "recurring", "membership"];

export type Sponsorship = {
  kind: SponsorshipKind;
  /** 1-100; 100 for full; null for none. */
  percent: number | null;
  scope: SponsorshipScope[];
  sponsorName: string | null;
  reason: string | null;
  from: string | null;
  until: string | null;
  sponsoredAt?: string | null;
};

export type SponsorshipRow = {
  sponsorship_kind?: string | null;
  sponsorship_percent?: number | string | null;
  sponsorship_scope?: string[] | null;
  sponsor_name?: string | null;
  sponsorship_reason?: string | null;
  sponsorship_from?: string | null;
  sponsorship_until?: string | null;
  sponsored_at?: string | null;
};

/** Columns to select for sponsorshipFromRow (staff views; parents skip the reason). */
export const SPONSORSHIP_COLUMNS =
  "sponsorship_kind,sponsorship_percent,sponsorship_scope,sponsor_name,sponsorship_reason,sponsorship_from,sponsorship_until,sponsored_at";

export function sponsorshipFromRow(r: SponsorshipRow): Sponsorship {
  const kind = (SPONSORSHIP_KINDS as readonly string[]).includes(r.sponsorship_kind ?? "") ? (r.sponsorship_kind as SponsorshipKind) : "none";
  const pct = r.sponsorship_percent === null || r.sponsorship_percent === undefined ? null : Number(r.sponsorship_percent);
  const scope = (r.sponsorship_scope ?? DEFAULT_SPONSORSHIP_SCOPE).filter((s): s is SponsorshipScope =>
    (SPONSORSHIP_SCOPES as readonly string[]).includes(s));
  return {
    kind,
    percent: kind === "full" ? 100 : kind === "none" ? null : pct !== null && Number.isFinite(pct) ? pct : null,
    scope,
    sponsorName: r.sponsor_name ?? null,
    reason: r.sponsorship_reason ?? null,
    from: r.sponsorship_from ?? null,
    until: r.sponsorship_until ?? null,
    sponsoredAt: r.sponsored_at ?? null,
  };
}

export function isSponsored(s: Pick<Sponsorship, "kind"> | null | undefined): boolean {
  return !!s && s.kind !== "none";
}

export function scopeCovers(scope: readonly SponsorshipScope[], fee: FeeScope): boolean {
  return scope.includes("all") || scope.includes(fee);
}

/** Inside the from / until window (inclusive, YYYY-MM-DD). */
export function inSponsorshipWindow(s: Pick<Sponsorship, "from" | "until">, on: string): boolean {
  if (s.from && on < s.from) return false;
  if (s.until && on > s.until) return false;
  return true;
}

/**
 * Share (0-100) of a fee of kind `fee` billed for `on` that the sponsorship
 * covers. Mirrors public.athlete_sponsorship_percent.
 */
export function sponsorshipPercent(s: Sponsorship | null | undefined, fee: FeeScope, on: string): number {
  if (!s || s.kind === "none") return 0;
  if (!scopeCovers(s.scope, fee) || !inSponsorshipWindow(s, on)) return 0;
  if (s.kind === "full") return 100;
  return Math.min(Math.max(s.percent ?? 0, 0), 100);
}

export type SponsoredSplit = { currency: string; amount: number; sponsored: number; net: number; percent: number };

/**
 * Split a fee (after the other discounts) into the sponsored share and what
 * the family pays, rounded once in the currency's minor unit.
 */
export function splitSponsoredFee(amount: number, currency: string, s: Sponsorship | null | undefined, fee: FeeScope, on: string): SponsoredSplit {
  const cur = normalizeCurrency(currency);
  const minor = Math.max(0, toMinorUnits(amount, cur));
  const percent = sponsorshipPercent(s, fee, on);
  const sponsoredMinor = percent > 0 ? discountAmountMinor({ kind: "percent", value: percent }, minor, cur) : 0;
  return {
    currency: cur,
    amount: fromMinorUnits(minor, cur),
    sponsored: fromMinorUnits(sponsoredMinor, cur),
    net: fromMinorUnits(minor - sponsoredMinor, cur),
    percent,
  };
}

/**
 * Invoice line labels written by the database (public.sponsorship_label):
 * "<word> (<sponsor>)" in the invoice / club language.
 */
export const SPONSORSHIP_LINE_WORDS = ["Sponsored", "Sponsorisé", "Gesponsert", "Sponsorizzato", "Patrocinado"] as const;
export function isSponsorshipLine(description: string | null | undefined): boolean {
  const d = (description ?? "").trim();
  return SPONSORSHIP_LINE_WORDS.some((w) => d === w || d.startsWith(`${w} (`));
}

/** Players list filter (`?sponsored=yes|no`); anything else = all. */
export type SponsoredFilter = "yes" | "no" | null;
export function parseSponsoredFilter(v: string | string[] | undefined): SponsoredFilter {
  const s = Array.isArray(v) ? v[0] : v;
  return s === "yes" || s === "no" ? s : null;
}

/** Season (Aug-Jul by default) containing a day: "2026-27" for 2026-11-21. */
export function seasonFor(on: string, startMonth = 8): { label: string; from: string; to: string } {
  const y = Number(on.slice(0, 4));
  const m = Number(on.slice(5, 7));
  const start = m >= startMonth ? y : y - 1;
  const pad = (n: number) => String(n).padStart(2, "0");
  const endMonth = startMonth === 1 ? 12 : startMonth - 1;
  const endYear = startMonth === 1 ? start : start + 1;
  const lastDay = new Date(Date.UTC(endYear, endMonth, 0)).getUTCDate();
  return {
    label: startMonth === 1 ? String(start) : `${start}-${String(start + 1).slice(2)}`,
    from: `${start}-${pad(startMonth)}-01`,
    to: `${endYear}-${pad(endMonth)}-${pad(lastDay)}`,
  };
}

/** "2026-27" -> that season (Aug-Jul); anything else -> null. */
export function parseSeasonParam(v: string | string[] | undefined, startMonth = 8): { label: string; from: string; to: string } | null {
  const s = Array.isArray(v) ? v[0] : v;
  const m = /^(\d{4})-(\d{2})$/.exec(s ?? "");
  if (!m) return null;
  const start = Number(m[1]);
  if (start < 2000 || start > 2100 || (start + 1) % 100 !== Number(m[2])) return null;
  return seasonFor(`${start}-${String(startMonth).padStart(2, "0")}-01`, startMonth);
}

/** The current season and the four before it (report picker). */
export function seasonOptions(today: string, startMonth = 8): { label: string; from: string; to: string }[] {
  const cur = seasonFor(today, startMonth);
  const y = Number(cur.from.slice(0, 4));
  return [0, 1, 2, 3, 4].map((i) => seasonFor(`${y - i}-${String(startMonth).padStart(2, "0")}-01`, startMonth));
}

// ---------------------------------------------------------------------------
// Admin form validation (zod messages are i18n keys)
// ---------------------------------------------------------------------------
const K = {
  invalidKind: "sponsorship.errors.invalidKind",
  percentRequired: "sponsorship.errors.percentRequired",
  invalidPercent: "sponsorship.errors.invalidPercent",
  scopeRequired: "sponsorship.errors.scopeRequired",
  tooLong: "sponsorship.errors.tooLong",
  invalidDate: "sponsorship.errors.invalidDate",
  untilBeforeFrom: "sponsorship.errors.untilBeforeFrom",
} as const;

const optText = (max: number) =>
  z.string().trim().max(max, K.tooLong).optional().nullable().transform((v) => (v ? v : null));
const optDate = z
  .string()
  .trim()
  .optional()
  .nullable()
  .transform((v) => (v ? v : null))
  .refine((v) => v === null || (/^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`))), K.invalidDate);

export const sponsorshipSchema = z
  .object({
    kind: z.enum(SPONSORSHIP_KINDS, { errorMap: () => ({ message: K.invalidKind }) }),
    percent: z.union([z.string(), z.number()]).optional().nullable(),
    scope: z.array(z.enum(SPONSORSHIP_SCOPES, { errorMap: () => ({ message: K.scopeRequired }) })).max(7).default([]),
    sponsorName: optText(120),
    reason: optText(300),
    from: optDate,
    until: optDate,
  })
  .transform((v, ctx) => {
    let percent: number | null = null;
    if (v.kind === "full") percent = 100;
    if (v.kind === "partial") {
      const raw = typeof v.percent === "number" ? v.percent : (v.percent ?? "").toString().trim().replace(",", ".").replace(/%$/, "");
      if (raw === "") {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: K.percentRequired });
        return z.NEVER;
      }
      const n = Number(raw);
      if (!Number.isFinite(n) || n < 1 || n > 100) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: K.invalidPercent });
        return z.NEVER;
      }
      percent = Math.round(n * 100) / 100;
    }
    const scope = Array.from(new Set(v.scope)).sort() as SponsorshipScope[];
    if (v.kind !== "none" && scope.length === 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: K.scopeRequired });
      return z.NEVER;
    }
    if (v.from && v.until && v.until < v.from) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: K.untilBeforeFrom });
      return z.NEVER;
    }
    if (v.kind === "none") {
      return { kind: v.kind, percent: null, scope: DEFAULT_SPONSORSHIP_SCOPE, sponsorName: null, reason: null, from: null, until: null };
    }
    return { kind: v.kind, percent, scope, sponsorName: v.sponsorName, reason: v.reason, from: v.from, until: v.until };
  });
export type SponsorshipInput = z.input<typeof sponsorshipSchema>;
export type SponsorshipData = z.output<typeof sponsorshipSchema>;

/** Row patch for public.athletes (sponsored_by / sponsored_at are set by the database). */
export function sponsorshipToRow(d: SponsorshipData) {
  return {
    sponsorship_kind: d.kind,
    sponsorship_percent: d.percent,
    sponsorship_scope: d.scope,
    sponsor_name: d.sponsorName,
    sponsorship_reason: d.reason,
    sponsorship_from: d.from,
    sponsorship_until: d.until,
  };
}

export function sponsorshipErrorKey(err: z.ZodError): string {
  return err.issues[0]?.message ?? K.invalidKind;
}

/** Database error codes of the sponsorship RPCs -> i18n keys. */
export function sponsorshipDbErrorKey(message: string | null | undefined): string {
  const m = message ?? "";
  if (m.includes("SPONSORSHIP_STAFF_ONLY") || m.includes("NOT_AUTHORIZED")) return "sponsorship.errors.forbidden";
  if (m.includes("NOT_SPONSORED")) return "sponsorship.errors.notSponsored";
  if (m.includes("ATHLETE_NOT_FOUND")) return "sponsorship.errors.notFound";
  return "sponsorship.errors.saveFailed";
}
