import { z } from "zod";
import { addDays, monthDay, parseDate, splitInstalments } from "@/lib/payments/plans";

/*
 * Service instalments — shared contract (client + server safe, no I/O).
 * Schema: supabase/migrations/20250420105400_service_instalments.sql.
 * Contract: docs/service-instalments.md.
 *
 * The SQL is authoritative (service_instalment_split, service_instalment_dates,
 * service_instalment_dates_error); these mirrors let the forms show the total,
 * each payment and its due date before confirming. The server recomputes the
 * amounts from the issued invoice balance and never trusts these values.
 */

/** Absolute maximum of payments for a service booking (= service_instalments_max()). */
export const SERVICE_MAX_INSTALMENTS = 4;
/** Staff due dates may reach this many months ahead. */
export const INSTALMENT_DATES_MAX_MONTHS = 12;

/** Choices a service offers: 1 (pay in full) .. min(max_instalments, 4). */
export function instalmentChoices(maxInstalments: number | null | undefined): number[] {
  const max = Math.max(1, Math.min(SERVICE_MAX_INSTALMENTS, Math.trunc(Number(maxInstalments ?? 1)) || 1));
  return Array.from({ length: max }, (_, k) => k + 1);
}

/** Equal shares in minor units; the LAST payment absorbs the rounding (mirror of service_instalment_split). */
export function serviceInstalmentSplit(total: number, count: number, currency: string): number[] {
  if (!Number.isInteger(count) || count < 1 || count > SERVICE_MAX_INSTALMENTS) throw new Error("INSTALMENTS_OUT_OF_RANGE");
  return splitInstalments(total, count, currency);
}

/** Default due dates: `first`, then the same day each following month, clamped to the month end. */
export function serviceInstalmentDates(first: string, count: number): string[] {
  const { y, m, d } = parseDate(first);
  return Array.from({ length: Math.max(1, count) }, (_, k) => monthDay(y, m, k, d));
}

/** First due date of a new booking invoice: today + the booking invoice term (days). */
export function firstDueDate(today: string, invoiceDueDays: number | null | undefined): string {
  return addDays(today, Math.max(0, Math.trunc(Number(invoiceDueDays ?? 0)) || 0));
}

/** Staff due dates: null when valid, else the error code (mirror of service_instalment_dates_error). */
export function instalmentDatesError(dates: readonly string[], count: number, today: string): "INSTALMENT_DATES_INVALID" | null {
  if (dates.length !== count || dates.some((d) => !/^\d{4}-\d{2}-\d{2}$/.test(d))) return "INSTALMENT_DATES_INVALID";
  for (let k = 1; k < dates.length; k++) if (dates[k] <= dates[k - 1]) return "INSTALMENT_DATES_INVALID";
  if (dates[0] < today) return "INSTALMENT_DATES_INVALID";
  const { y, m, d } = parseDate(today);
  if (dates[count - 1] > monthDay(y, m, INSTALMENT_DATES_MAX_MONTHS, d)) return "INSTALMENT_DATES_INVALID";
  return null;
}

export type InstalmentRow = { seq: number; dueDate: string; amount: number };

/** The schedule shown before confirming: one row per payment (custom dates when given and valid). */
export function instalmentSchedule(opts: {
  total: number; count: number; currency: string; firstDue: string; customDates?: readonly string[] | null;
}): InstalmentRow[] {
  const amounts = serviceInstalmentSplit(opts.total, opts.count, opts.currency);
  const dates = opts.customDates && opts.customDates.length === opts.count ? [...opts.customDates] : serviceInstalmentDates(opts.firstDue, opts.count);
  return amounts.map((amount, k) => ({ seq: k + 1, dueDate: dates[k], amount }));
}

/** The plan part of a booking request: count + (staff only) due dates. */
export const instalmentChoiceSchema = z.object({
  count: z.number().int().min(1).max(SERVICE_MAX_INSTALMENTS).default(1),
  dates: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).max(SERVICE_MAX_INSTALMENTS).nullish().transform((v) => (v && v.length ? v : null)),
}).refine((v) => v.dates === null || v.dates.length === v.count, { path: ["dates"] });
export type InstalmentChoiceInput = z.input<typeof instalmentChoiceSchema>;
export type InstalmentChoice = z.output<typeof instalmentChoiceSchema>;

/** RPC payload keys of the choice (merged into the booking payload). */
export function toInstalmentRpc(c: InstalmentChoice | null | undefined): { instalments: number; instalment_dates?: string[] } {
  if (!c || c.count <= 1) return { instalments: 1 };
  return c.dates ? { instalments: c.count, instalment_dates: c.dates } : { instalments: c.count };
}

/** Instalment options of services (service_instalment_info). */
export type ServiceInstalmentInfo = {
  services: Record<string, number>;
  invoice_due_days: number | null;
  today: string;
  max: number;
};
