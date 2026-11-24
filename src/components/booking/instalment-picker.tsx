"use client";
import * as React from "react";
import { CalendarClock, RotateCcw } from "lucide-react";
import { Button, Input } from "@/components/ui";
import { instalmentDatesError, instalmentSchedule, serviceInstalmentDates } from "@/lib/booking/instalments";
import { useFormat, useT } from "@/lib/i18n/client";
import { cn } from "@/lib/utils";

export type InstalmentValue = { count: number; dates: string[] | null };
export type InstalmentPayer = { key: string; name?: string | null; total: number };

/**
 * "Pay in 1 / 2 / 3 / 4 payments" for an eligible service booking
 * (docs/service-instalments.md). Shows, per payer, the total, each payment and
 * its due date before confirming. Staff (admin / finance) may change the due
 * dates; parents see the default schedule. The server recomputes the amounts
 * from the issued invoice and checks every rule again.
 */
export function InstalmentPicker({ choices, value, onChange, currency, payers, firstDue, today, canEditDates, disabled, idPrefix = "inst" }: {
  choices: number[]; value: InstalmentValue; onChange: (v: InstalmentValue) => void; currency: string;
  payers: InstalmentPayer[]; firstDue: string; today: string; canEditDates: boolean; disabled?: boolean; idPrefix?: string;
}) {
  const t = useT();
  const f = useFormat();
  if (choices.length <= 1) return null;
  const count = choices.includes(value.count) ? value.count : 1;
  const dates = count > 1 ? value.dates ?? serviceInstalmentDates(firstDue, count) : [];
  const datesErr = count > 1 && value.dates ? instalmentDatesError(value.dates, count, today) : null;
  const billed = payers.filter((p) => p.total > 0);

  function pick(n: number) { onChange({ count: n, dates: null }); }
  function setDate(k: number, d: string) {
    const next = [...dates];
    next[k] = d;
    onChange({ count, dates: next });
  }

  return (
    <fieldset className="space-y-3" disabled={disabled}>
      <legend className="mb-1 text-sm font-medium text-ink">{t("serviceInstalments.picker.legend")}</legend>
      <div role="radiogroup" aria-label={t("serviceInstalments.picker.legend")} className="flex flex-wrap gap-2">
        {choices.map((n) => (
          <label key={n} className={cn("inline-flex cursor-pointer items-center gap-2 rounded-md border px-3 py-1.5 text-sm",
            n === count ? "border-maroon bg-maroon-soft text-ink" : "border-line text-ink-2 hover:border-ink-3")}>
            <input type="radio" name={`${idPrefix}-count`} value={n} checked={n === count} onChange={() => pick(n)} />
            {n === 1 ? t("serviceInstalments.picker.payInFull") : t("serviceInstalments.picker.payments", { count: n })}
          </label>
        ))}
      </div>

      {count > 1 && (
        <div className="space-y-3">
          {canEditDates && (
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-ink-3">
              <span className="flex items-center gap-1.5"><CalendarClock className="h-3.5 w-3.5" aria-hidden /> {t("serviceInstalments.picker.datesHintStaff")}</span>
              {value.dates && (
                <Button type="button" size="sm" variant="ghost" onClick={() => onChange({ count, dates: null })}>
                  <RotateCcw className="h-3.5 w-3.5" aria-hidden /> {t("serviceInstalments.picker.resetDates")}
                </Button>
              )}
            </div>
          )}
          {canEditDates && (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {dates.map((d, k) => (
                <div key={k}>
                  <label htmlFor={`${idPrefix}-d${k}`} className="mb-1 block text-xs text-ink-3">{t("serviceInstalments.picker.dueOf", { seq: k + 1, count })}</label>
                  <Input id={`${idPrefix}-d${k}`} type="date" value={d} min={today} required onChange={(e) => setDate(k, e.target.value)} />
                </div>
              ))}
            </div>
          )}
          {datesErr && <p role="alert" className="text-sm text-danger">{t("bookingWorkflow.errors.INSTALMENT_DATES_INVALID")}</p>}

          {billed.length === 0 ? (
            <p className="text-sm text-ink-3">{t("serviceInstalments.picker.nothingToSplit")}</p>
          ) : billed.map((p) => {
            const rows = instalmentSchedule({ total: p.total, count, currency, firstDue, customDates: dates });
            return (
              <div key={p.key} className="rounded-md border border-line bg-surface p-3">
                <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2 text-sm">
                  <span className="font-medium text-ink">{p.name || t("serviceInstalments.picker.payer")}</span>
                  <span className="tnum text-ink-2">{t("serviceInstalments.picker.total", { amount: f.money(p.total, currency) })}</span>
                </div>
                <table className="w-full text-sm">
                  <caption className="sr-only">{t("serviceInstalments.picker.scheduleFor", { name: p.name || t("serviceInstalments.picker.payer") })}</caption>
                  <thead>
                    <tr className="border-b border-line text-left text-[11px] uppercase tracking-[0.12em] text-ink-3">
                      <th scope="col" className="py-1 pr-3 font-medium">{t("plans.common.instalment")}</th>
                      <th scope="col" className="py-1 pr-3 font-medium">{t("plans.common.dueDate")}</th>
                      <th scope="col" className="py-1 text-right font-medium">{t("plans.common.amount")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.seq} className="border-b border-line/60 last:border-0">
                        <td className="py-1 pr-3 text-ink-2">{t("plans.common.seqOf", { seq: r.seq, count })}</td>
                        <td className="py-1 pr-3 tnum">{r.dueDate ? f.date(r.dueDate) : "—"}</td>
                        <td className="py-1 text-right tnum">{f.money(r.amount, currency)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          })}
          <p className="text-xs text-ink-3">{canEditDates ? t("serviceInstalments.picker.serverNoteStaff") : t("serviceInstalments.picker.serverNoteFamily")}</p>
        </div>
      )}
    </fieldset>
  );
}

/** Staff dates valid for submit (null dates = default rule). */
export function instalmentValueOk(v: InstalmentValue, today: string): boolean {
  return v.count <= 1 || v.dates === null || instalmentDatesError(v.dates, v.count, today) === null;
}
