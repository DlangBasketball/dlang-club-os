/**
 * Locale-, currency- and time-zone-aware formatting helpers.
 *
 * Pure functions with no React / server dependencies — usable in Server
 * Components, Client Components, route handlers, emails and PDFs.
 *
 *   formatMoney(1234.5, "CHF", "de-CH")  -> "CHF 1'234.50"
 *   formatMoney(1234.5, "EUR", "de-DE")  -> "1.234,50 €"
 *   formatMoney(1234.5, "USD", "en-US")  -> "$1,234.50"
 *   formatDate("2026-05-23", { locale: "en-US" }) -> "May 23, 2026"
 *   formatDate("2026-05-23", { locale: "de-CH", style: "short" }) -> "23.05.26"
 *
 * Output is normalised (typographic apostrophe -> ASCII apostrophe, narrow
 * no-break spaces -> no-break spaces) so server- and browser-rendered strings
 * match and hydration never diverges between ICU versions.
 */

export type MoneyInput = number | string | null | undefined;
export type DateInput = string | number | Date | null | undefined;

/** Defaults preserve the founding club's behaviour (DLang, Switzerland). */
export const FORMAT_DEFAULTS = {
  locale: "de-CH",
  currency: "CHF",
  timeZone: "Europe/Zurich",
} as const;

export type FormatContext = {
  /** Intl locale tag, e.g. "de-CH", "en-US". */
  locale?: string;
  /** ISO 4217 code, e.g. "CHF". */
  currency?: string;
  /** IANA time zone, e.g. "Europe/Zurich". */
  timeZone?: string;
};

const EMPTY = "—";

function toNumber(v: MoneyInput): number {
  const n = typeof v === "string" ? Number(v) : v ?? 0;
  return Number.isFinite(n) ? (n as number) : 0;
}

function toDate(v: DateInput): Date | null {
  if (v === null || v === undefined || v === "") return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v)) {
    // Date-only values (due dates, DOB) are calendar dates, not instants:
    // anchor at noon UTC so no time zone can shift them to another day.
    const d = new Date(`${v}T12:00:00Z`);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

function isDateOnly(v: DateInput): boolean {
  return typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
}

function normalise(s: string): string {
  return s.replace(/’/g, "'").replace(/ /g, " ");
}

// Intl constructors are comparatively expensive — memoise them.
const nfCache = new Map<string, Intl.NumberFormat>();
const dfCache = new Map<string, Intl.DateTimeFormat>();

function numberFormat(locale: string, input: Intl.NumberFormatOptions): Intl.NumberFormat {
  // Swiss convention groups every amount ≥ 1000 (CHF 1'234.50) in all national
  // languages; CLDR's it-CH default would print "CHF 1234.50".
  const opts: Intl.NumberFormatOptions =
    /-(CH|LI)$/i.test(locale) && input.useGrouping === undefined
      ? ({ ...input, useGrouping: "always" } as unknown as Intl.NumberFormatOptions)
      : input;
  const key = `${locale}|${JSON.stringify(opts)}`;
  let f = nfCache.get(key);
  if (!f) {
    try {
      f = new Intl.NumberFormat(locale, opts);
    } catch {
      f = new Intl.NumberFormat(FORMAT_DEFAULTS.locale, { ...opts, currency: opts.currency ? FORMAT_DEFAULTS.currency : undefined });
    }
    nfCache.set(key, f);
  }
  return f;
}

function dateFormat(locale: string, opts: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = `${locale}|${JSON.stringify(opts)}`;
  let f = dfCache.get(key);
  if (!f) {
    try {
      f = new Intl.DateTimeFormat(locale, opts);
    } catch {
      f = new Intl.DateTimeFormat(FORMAT_DEFAULTS.locale, { ...opts, timeZone: FORMAT_DEFAULTS.timeZone });
    }
    dfCache.set(key, f);
  }
  return f;
}

// ---------------------------------------------------------------------------
// Money
// ---------------------------------------------------------------------------

export type MoneyOptions = {
  /** Hide ".00" on whole amounts (marketing pages, price tags). */
  compactZeros?: boolean;
  /** "symbol" (€, $) or "code" (CHF, EUR). Default: Intl's choice per locale. */
  display?: "symbol" | "code" | "narrowSymbol";
  /** Always show a sign (+/-), e.g. for ledger deltas. */
  signed?: boolean;
};

/**
 * Format an amount in a currency for a locale.
 * Supports CHF / EUR / USD / GBP (and any other ISO code Intl knows).
 */
export function formatMoney(
  amount: MoneyInput,
  currency: string = FORMAT_DEFAULTS.currency,
  locale: string = FORMAT_DEFAULTS.locale,
  options: MoneyOptions = {},
): string {
  const n = toNumber(amount);
  const whole = options.compactZeros && Number.isInteger(n);
  const f = numberFormat(locale, {
    style: "currency",
    currency: (currency || FORMAT_DEFAULTS.currency).toUpperCase(),
    currencyDisplay: options.display,
    minimumFractionDigits: whole ? 0 : undefined,
    maximumFractionDigits: whole ? 0 : undefined,
    signDisplay: options.signed ? "exceptZero" : undefined,
  });
  return normalise(f.format(n));
}

/** Plain number with locale grouping: 1'234.5 (de-CH), 1,234.5 (en-US). */
export function formatNumber(value: MoneyInput, locale: string = FORMAT_DEFAULTS.locale, opts: Intl.NumberFormatOptions = {}): string {
  return normalise(numberFormat(locale, opts).format(toNumber(value)));
}

/** 0.125 -> "12.5 %" (de-CH) / "12.5%" (en-US). Pass a ratio, not a percentage. */
export function formatPercent(ratio: MoneyInput, locale: string = FORMAT_DEFAULTS.locale, maxFractionDigits = 1): string {
  return normalise(numberFormat(locale, { style: "percent", maximumFractionDigits: maxFractionDigits }).format(toNumber(ratio)));
}

/** Currency symbol for a locale: "CHF", "€", "$", "£". */
export function currencySymbol(currency: string = FORMAT_DEFAULTS.currency, locale: string = FORMAT_DEFAULTS.locale): string {
  const part = numberFormat(locale, { style: "currency", currency: currency.toUpperCase() })
    .formatToParts(0)
    .find((p) => p.type === "currency");
  return part?.value ?? currency.toUpperCase();
}

// ---------------------------------------------------------------------------
// Dates & times
// ---------------------------------------------------------------------------

export type DateStyle = "short" | "medium" | "long" | "full";

export type DateOptions = FormatContext & {
  style?: DateStyle;
  /** Include the weekday name ("Sat, 23 May 2026"). */
  weekday?: boolean;
};

/**
 * Calendar date in the tenant time zone. Day/month order follows the locale
 * (US: May 23, 2026 · 5/23/26 — EU: 23 May 2026 · 23.05.26).
 */
export function formatDate(date: DateInput, opts: DateOptions = {}): string {
  const d = toDate(date);
  if (!d) return EMPTY;
  const locale = opts.locale ?? FORMAT_DEFAULTS.locale;
  const timeZone = isDateOnly(date) ? "UTC" : opts.timeZone ?? FORMAT_DEFAULTS.timeZone;
  const style = opts.style ?? "medium";
  const o: Intl.DateTimeFormatOptions = opts.weekday
    ? { timeZone, weekday: "short", day: "numeric", month: style === "short" ? "numeric" : style === "medium" ? "short" : "long", year: "numeric" }
    : { timeZone, dateStyle: style };
  return normalise(dateFormat(locale, o).format(d));
}

/** Clock time in the tenant time zone; 24h in Europe, 12h in the US (locale-driven). */
export function formatTime(date: DateInput, opts: FormatContext & { hour12?: boolean } = {}): string {
  const d = toDate(date);
  if (!d) return EMPTY;
  const locale = opts.locale ?? FORMAT_DEFAULTS.locale;
  return normalise(
    dateFormat(locale, {
      timeZone: opts.timeZone ?? FORMAT_DEFAULTS.timeZone,
      hour: "2-digit",
      minute: "2-digit",
      hour12: opts.hour12,
    }).format(d),
  );
}

/** Date + time, e.g. "23 May 2026, 17:00" / "May 23, 2026, 5:00 PM". */
export function formatDateTime(date: DateInput, opts: DateOptions = {}): string {
  const d = toDate(date);
  if (!d) return EMPTY;
  const locale = opts.locale ?? FORMAT_DEFAULTS.locale;
  return normalise(
    dateFormat(locale, {
      timeZone: opts.timeZone ?? FORMAT_DEFAULTS.timeZone,
      dateStyle: opts.style ?? "medium",
      timeStyle: "short",
    }).format(d),
  );
}

/** "23–30 Jul 2026" / "Jul 23 – 30, 2026" — locale-aware range. */
export function formatDateRange(start: DateInput, end: DateInput, opts: DateOptions = {}): string {
  const a = toDate(start);
  const b = toDate(end);
  if (!a && !b) return EMPTY;
  if (!a || !b) return formatDate(a ?? b, opts);
  const locale = opts.locale ?? FORMAT_DEFAULTS.locale;
  const timeZone = isDateOnly(start) && isDateOnly(end) ? "UTC" : opts.timeZone ?? FORMAT_DEFAULTS.timeZone;
  const f = dateFormat(locale, { timeZone, dateStyle: opts.style ?? "medium" }) as Intl.DateTimeFormat & {
    formatRange?: (x: Date, y: Date) => string;
  };
  return normalise(f.formatRange ? f.formatRange(a, b) : `${f.format(a)} – ${f.format(b)}`);
}

/** Localised relative time: "3 hours ago", "vor 3 Stunden", "il y a 3 heures". */
export function formatRelative(date: DateInput, locale: string = FORMAT_DEFAULTS.locale, now: number = Date.now()): string {
  const d = toDate(date);
  if (!d) return "";
  const secs = Math.round((d.getTime() - now) / 1000);
  const abs = Math.abs(secs);
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  if (abs < 45) return rtf.format(0, "second");
  if (abs < 3600) return rtf.format(Math.round(secs / 60), "minute");
  if (abs < 86400) return rtf.format(Math.round(secs / 3600), "hour");
  if (abs < 86400 * 7) return rtf.format(Math.round(secs / 86400), "day");
  return formatDate(d, { locale });
}

// ---------------------------------------------------------------------------
// Calendar conventions
// ---------------------------------------------------------------------------

/** Regions whose week starts on Sunday (CLDR). Everything else: Monday. */
const SUNDAY_FIRST = new Set(["US", "CA", "MX", "BR", "JP", "KR", "IL", "PH", "AU", "ZA", "IN", "HK", "TW", "SA", "PE", "CO", "VE", "GT", "PR", "DO"]);

/** First day of the week for a locale tag: 0 = Sunday, 1 = Monday. */
export function firstDayOfWeek(locale: string = FORMAT_DEFAULTS.locale): 0 | 1 {
  try {
    const loc = new Intl.Locale(locale) as Intl.Locale & { getWeekInfo?: () => { firstDay: number }; weekInfo?: { firstDay: number } };
    const info = loc.getWeekInfo?.() ?? loc.weekInfo;
    if (info) return info.firstDay === 7 ? 0 : 1;
    const region = loc.maximize().region ?? "";
    return SUNDAY_FIRST.has(region) ? 0 : 1;
  } catch {
    return 1;
  }
}

/** Order of day/month/year in numeric dates: "MDY" (US), "DMY" (most of Europe), "YMD". */
export function dateOrder(locale: string = FORMAT_DEFAULTS.locale): "MDY" | "DMY" | "YMD" {
  const parts = dateFormat(locale, { timeZone: "UTC", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(Date.UTC(2026, 10, 23)));
  const order = parts
    .filter((p) => p.type === "day" || p.type === "month" || p.type === "year")
    .map((p) => p.type[0].toUpperCase())
    .join("");
  return order === "MDY" || order === "YMD" ? order : "DMY";
}

/** Whether the locale uses a 12-hour clock by default (en-US: true, de-CH: false). */
export function uses12HourClock(locale: string = FORMAT_DEFAULTS.locale): boolean {
  return Boolean(dateFormat(locale, { hour: "numeric", timeZone: "UTC" }).resolvedOptions().hour12);
}

/** Localised weekday names, starting from the locale's first day of the week. */
export function weekdayNames(locale: string = FORMAT_DEFAULTS.locale, width: "long" | "short" | "narrow" = "short"): string[] {
  const f = dateFormat(locale, { weekday: width, timeZone: "UTC" });
  // 2026-11-01 is a Sunday.
  const sunday = Date.UTC(2026, 10, 1);
  const start = firstDayOfWeek(locale);
  return Array.from({ length: 7 }, (_, i) => f.format(new Date(sunday + ((i + start) % 7) * 864e5)));
}

// ---------------------------------------------------------------------------
// Bound formatter (tenant/user context baked in)
// ---------------------------------------------------------------------------

export type Formatter = ReturnType<typeof createFormatter>;

/** Bind locale/currency/time zone once; pass the result around. */
export function createFormatter(ctx: FormatContext = {}) {
  const locale = ctx.locale ?? FORMAT_DEFAULTS.locale;
  const currency = ctx.currency ?? FORMAT_DEFAULTS.currency;
  const timeZone = ctx.timeZone ?? FORMAT_DEFAULTS.timeZone;
  const base = { locale, timeZone };
  return {
    locale,
    currency,
    timeZone,
    money: (amount: MoneyInput, cur: string = currency, options?: MoneyOptions) => formatMoney(amount, cur, locale, options),
    number: (v: MoneyInput, opts?: Intl.NumberFormatOptions) => formatNumber(v, locale, opts),
    percent: (ratio: MoneyInput, digits?: number) => formatPercent(ratio, locale, digits),
    date: (d: DateInput, opts: Omit<DateOptions, "locale" | "timeZone"> = {}) => formatDate(d, { ...base, ...opts }),
    time: (d: DateInput) => formatTime(d, base),
    dateTime: (d: DateInput, style?: DateStyle) => formatDateTime(d, { ...base, style }),
    dateRange: (a: DateInput, b: DateInput, style?: DateStyle) => formatDateRange(a, b, { ...base, style }),
    relative: (d: DateInput) => formatRelative(d, locale),
    firstDayOfWeek: () => firstDayOfWeek(locale),
    dateOrder: () => dateOrder(locale),
    weekdayNames: (width?: "long" | "short" | "narrow") => weekdayNames(locale, width),
  };
}
