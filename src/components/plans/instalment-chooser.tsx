"use client";

import * as React from "react";
import { CalendarClock } from "lucide-react";
import { planOffer, type PlanSettings } from "@/lib/payments/plans";
import { useFormat, useT } from "@/lib/i18n/client";

/**
 * "Pay in full" or "N instalments" at checkout. The preview is computed from
 * the club's rules with the same pure functions the database mirrors; the
 * server re-checks everything when the plan is created.
 */
export function InstalmentChooser({
  rules, productType, total, currency, activityStart, value, onChange, idPrefix = "inst",
}: {
  rules: { settings: PlanSettings; today: string } | null | undefined;
  productType: "camp" | "season" | "training_package" | "shop" | "invoice";
  total: number;
  currency: string;
  activityStart?: string | null;
  value: number;
  onChange: (count: number) => void;
  idPrefix?: string;
}) {
  const t = useT();
  const f = useFormat();
  const offer = React.useMemo(
    () => (rules ? planOffer(rules.settings, { productType, balance: total, currency, today: rules.today, activityStart }) : null),
    [rules, productType, total, currency, activityStart],
  );
  React.useEffect(() => {
    if (value > 1 && (!offer?.eligible || !offer.options.some((o) => o.count === value))) onChange(0);
  }, [offer, value, onChange]);
  if (!offer?.eligible) return null;
  const money = (n: number) => f.money(n, currency);
  const chosen = offer.options.find((o) => o.count === value) ?? null;

  return (
    <fieldset className="space-y-2 rounded-md border border-line p-4">
      <legend className="flex items-center gap-2 px-1 text-sm font-semibold text-ink"><CalendarClock className="h-4 w-4 text-ink-3" /> {t("plans.choose.title")}</legend>
      <label className="flex cursor-pointer items-center gap-2 text-sm text-ink-2" htmlFor={`${idPrefix}-full`}>
        <input id={`${idPrefix}-full`} type="radio" name={`${idPrefix}-count`} checked={value < 2} onChange={() => onChange(0)} />
        {t("plans.choose.payInFull", { amount: money(total) })}
      </label>
      {offer.options.map((o) => (
        <label key={o.count} className="flex cursor-pointer items-center gap-2 text-sm text-ink-2" htmlFor={`${idPrefix}-${o.count}`}>
          <input id={`${idPrefix}-${o.count}`} type="radio" name={`${idPrefix}-count`} checked={value === o.count} onChange={() => onChange(o.count)} />
          <span>{t("plans.choose.option", { count: o.count, amount: money(o.amounts[0]) })}</span>
          {o.fee > 0 && <span className="text-xs text-ink-3">{t("plans.choose.fee", { amount: money(o.fee) })}</span>}
        </label>
      ))}
      {chosen && (
        <ol className="mt-2 space-y-1 rounded-md bg-surface-elevated/50 p-3 text-xs text-ink-2" aria-label={t("plans.choose.schedule")}>
          {chosen.dates.map((d, i) => (
            <li key={d + i} className="flex justify-between gap-3">
              <span>{t("plans.common.seqOf", { seq: i + 1, count: chosen.count })} · {f.date(d)}</span>
              <span className="tnum">{money(chosen.amounts[i])}</span>
            </li>
          ))}
          <li className="flex justify-between gap-3 border-t border-line pt-1 font-semibold"><span>{t("plans.choose.total")}</span><span className="tnum">{money(chosen.total)}</span></li>
        </ol>
      )}
      <p className="text-xs text-ink-3">{t("plans.choose.hint")}</p>
    </fieldset>
  );
}
