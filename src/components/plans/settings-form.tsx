"use client";

import * as React from "react";
import { Button, Input, Label, Select, FieldHint } from "@/components/ui";
import { useT } from "@/lib/i18n/client";
import { savePlanSettings } from "@/lib/actions/plans";
import { ALLOWED_COUNTS, PRODUCT_TYPES, type PlanSettings } from "@/lib/payments/plans";
import { usePlanAction } from "./plan-widgets";

/** Club rules for instalments, reminders and autopay. */
export function PlanSettingsForm({ initial, currency, stripeReady }: { initial: PlanSettings; currency: string; stripeReady: boolean }) {
  const t = useT();
  const { busy, run, note } = usePlanAction();
  const [s, setS] = React.useState(initial);
  const [customText, setCustomText] = React.useState(initial.customDates.join(", "));
  const set = <K extends keyof PlanSettings>(k: K, v: PlanSettings[K]) => setS((x) => ({ ...x, [k]: v }));
  const toggle = <T,>(arr: T[], v: T) => (arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);
  const check = (id: string, checked: boolean, onChange: (v: boolean) => void, label: string) => (
    <label htmlFor={id} className="flex cursor-pointer items-center gap-2 text-sm text-ink-2">
      <input id={id} type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} /> {label}
    </label>
  );

  function save() {
    const customDates = customText.split(/[\s,;]+/).map((x) => x.trim()).filter(Boolean);
    void run(() => savePlanSettings({ ...s, customDates }));
  }

  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <h2 className="text-base font-semibold text-ink">{t("plans.settings.instalments")}</h2>
        {check("ps-enabled", s.enabled, (v) => set("enabled", v), t("plans.settings.enabled"))}
        <fieldset className="space-y-1">
          <legend className="text-sm text-ink-2">{t("plans.settings.productTypes")}</legend>
          <div className="flex flex-wrap gap-4">
            {PRODUCT_TYPES.map((p) => check(`ps-pt-${p}`, s.productTypes.includes(p), () => set("productTypes", toggle(s.productTypes, p)), t.dynamic(`plans.product.${p}`, undefined, p)))}
          </div>
          <FieldHint>{t("plans.settings.productTypesHint")}</FieldHint>
        </fieldset>
        <fieldset className="space-y-1">
          <legend className="text-sm text-ink-2">{t("plans.settings.allowedCounts")}</legend>
          <div className="flex flex-wrap gap-3">
            {ALLOWED_COUNTS.map((n) => check(`ps-c-${n}`, s.allowedCounts.includes(n), () => set("allowedCounts", toggle(s.allowedCounts, n).sort((a, b) => a - b)), String(n)))}
          </div>
        </fieldset>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div><Label htmlFor="ps-min">{t("plans.settings.minAmount", { currency })}</Label>
            <Input id="ps-min" inputMode="decimal" value={String(s.minAmount)} onChange={(e) => set("minAmount", Number(e.target.value) || 0)} /></div>
          <div><Label htmlFor="ps-feek">{t("plans.settings.feeKind")}</Label>
            <Select id="ps-feek" value={s.feeKind} onChange={(e) => set("feeKind", e.target.value as PlanSettings["feeKind"])}>
              <option value="none">{t("plans.settings.feeKinds.none")}</option>
              <option value="fixed">{t("plans.settings.feeKinds.fixed", { currency })}</option>
              <option value="percent">{t("plans.settings.feeKinds.percent")}</option>
            </Select></div>
          {s.feeKind !== "none" && (
            <div><Label htmlFor="ps-feev">{t("plans.settings.feeValue")}</Label>
              <Input id="ps-feev" inputMode="decimal" value={String(s.feeValue)} onChange={(e) => set("feeValue", Number(e.target.value) || 0)} /></div>
          )}
        </div>
        {check("ps-signup", s.firstAtSignup, (v) => set("firstAtSignup", v), t("plans.settings.firstAtSignup"))}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div><Label htmlFor="ps-sk">{t("plans.settings.schedule")}</Label>
            <Select id="ps-sk" value={s.scheduleKind} onChange={(e) => set("scheduleKind", e.target.value as PlanSettings["scheduleKind"])}>
              <option value="monthly">{t("plans.settings.scheduleKinds.monthly")}</option>
              <option value="custom">{t("plans.settings.scheduleKinds.custom")}</option>
            </Select></div>
          {s.scheduleKind === "monthly" ? (
            <div><Label htmlFor="ps-day">{t("plans.settings.dayOfMonth")}</Label>
              <Input id="ps-day" type="number" min={1} max={31} value={String(s.dayOfMonth)} onChange={(e) => set("dayOfMonth", Number(e.target.value) || 1)} />
              <FieldHint>{t("plans.settings.dayOfMonthHint")}</FieldHint></div>
          ) : (
            <div className="sm:col-span-2"><Label htmlFor="ps-custom">{t("plans.settings.customDates")}</Label>
              <Input id="ps-custom" placeholder={t("plans.settings.customDatesPlaceholder")} value={customText} onChange={(e) => setCustomText(e.target.value)} />
              <FieldHint>{t("plans.settings.customDatesHint")}</FieldHint></div>
          )}
          <div><Label htmlFor="ps-camp">{t("plans.settings.campDeadline")}</Label>
            <Input id="ps-camp" type="number" min={0} max={365} value={s.campLastDaysBefore == null ? "" : String(s.campLastDaysBefore)}
              onChange={(e) => set("campLastDaysBefore", e.target.value === "" ? null : Number(e.target.value))} />
            <FieldHint>{t("plans.settings.campDeadlineHint")}</FieldHint></div>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-base font-semibold text-ink">{t("plans.settings.reminders")}</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div><Label htmlFor="ps-rb">{t("plans.settings.remindBefore")}</Label>
            <Input id="ps-rb" type="number" min={0} max={30} value={String(s.remindBeforeDays)} onChange={(e) => set("remindBeforeDays", Number(e.target.value) || 0)} /></div>
          <div><Label htmlFor="ps-or">{t("plans.settings.overdueRepeat")}</Label>
            <Input id="ps-or" type="number" min={1} max={60} value={String(s.overdueRepeatDays)} onChange={(e) => set("overdueRepeatDays", Number(e.target.value) || 7)} /></div>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-base font-semibold text-ink">{t("plans.settings.autopay")}</h2>
        {check("ps-ap", s.autopayEnabled, (v) => set("autopayEnabled", v), t("plans.settings.autopayEnabled"))}
        {!stripeReady && <p className="text-xs text-warning">{t("plans.settings.stripeNotReady")}</p>}
        <p className="text-xs text-ink-3">{t("plans.autopay.twintNote")}</p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div><Label htmlFor="ps-retry">{t("plans.settings.retryDays")}</Label>
            <Input id="ps-retry" value={s.retryDays.join(", ")} onChange={(e) => set("retryDays", e.target.value.split(/[\s,;]+/).map(Number).filter((n) => Number.isInteger(n) && n > 0))} />
            <FieldHint>{t("plans.settings.retryDaysHint")}</FieldHint></div>
          <div><Label htmlFor="ps-mv">{t("plans.settings.mandateVersion")}</Label>
            <Input id="ps-mv" maxLength={20} value={s.mandateVersion} onChange={(e) => set("mandateVersion", e.target.value)} />
            <FieldHint>{t("plans.settings.mandateVersionHint")}</FieldHint></div>
        </div>
      </section>

      <div className="flex items-center gap-3">
        <Button onClick={save} loading={busy}>{t("common.save")}</Button>
        {note}
      </div>
    </div>
  );
}
