"use client";

import * as React from "react";
import { Button, Input, Label, FieldHint } from "@/components/ui";
import { useT } from "@/lib/i18n/client";
import { saveClubAdminSettings } from "@/lib/actions/club-admin-settings";
import { CERT_KINDS } from "@/lib/club-admin/compliance";
import type { Settings } from "@/lib/club-admin/data";
import { useCaAction } from "./use-ca-action";

/**
 * Club-admin settings, one section per page (the other sections keep their
 * saved values). Admin only (the action re-checks).
 */
export function ClubAdminSettingsForm({ initial, section }: { initial: Settings; section: "waitlist" | "membership" | "js" | "compliance" }) {
  const t = useT();
  const { busy, run, note } = useCaAction();
  const [v, setV] = React.useState(initial);
  const [days, setDays] = React.useState(initial.complianceReminderDays.join(", "));
  const set = <K extends keyof Settings>(k: K, val: Settings[K]) => setV((x) => ({ ...x, [k]: val }));
  const toggleKind = (k: (typeof CERT_KINDS)[number]) =>
    set("complianceMandatoryKinds", v.complianceMandatoryKinds.includes(k) ? v.complianceMandatoryKinds.filter((x) => x !== k) : [...v.complianceMandatoryKinds, k]);
  const save = () => run(() => saveClubAdminSettings({
    ...v,
    jsRatePerParticipantHour: v.jsRatePerParticipantHour,
    complianceReminderDays: days.split(/[,\s]+/).filter(Boolean).map(Number),
  }));
  return (
    <div className="space-y-3">
      {section === "waitlist" && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div><Label htmlFor="st-hours">{t("clubadmin.settings.offerHours")}</Label>
            <Input id="st-hours" type="number" min={1} max={336} value={v.waitlistOfferHours} onChange={(e) => set("waitlistOfferHours", Number(e.target.value))} /></div>
          <label htmlFor="st-auto" className="flex items-center gap-2 self-end pb-2 text-sm text-ink-2">
            <input id="st-auto" type="checkbox" checked={v.waitlistAutoOffer} onChange={(e) => set("waitlistAutoOffer", e.target.checked)} /> {t("clubadmin.settings.autoOffer")}
          </label>
        </div>
      )}
      {section === "membership" && (
        <div><Label htmlFor="st-window">{t("clubadmin.settings.renewalWindow")}</Label>
          <Input id="st-window" type="number" min={1} max={180} className="max-w-[10rem]" value={v.membershipRenewalWindowDays} onChange={(e) => set("membershipRenewalWindowDays", Number(e.target.value))} /></div>
      )}
      {section === "js" && (
        <>
          <label htmlFor="st-js" className="flex items-center gap-2 text-sm text-ink-2">
            <input id="st-js" type="checkbox" checked={v.jsEnabled} onChange={(e) => set("jsEnabled", e.target.checked)} /> {t("clubadmin.settings.jsEnabled")}
          </label>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
            <div><Label htmlFor="st-club">{t("clubadmin.settings.jsClubNumber")}</Label>
              <Input id="st-club" maxLength={40} value={v.jsClubNumber ?? ""} onChange={(e) => set("jsClubNumber", e.target.value)} /></div>
            <div><Label htmlFor="st-amin">{t("clubadmin.settings.jsAgeMin")}</Label>
              <Input id="st-amin" type="number" min={0} max={99} value={v.jsAgeMin} onChange={(e) => set("jsAgeMin", Number(e.target.value))} /></div>
            <div><Label htmlFor="st-amax">{t("clubadmin.settings.jsAgeMax")}</Label>
              <Input id="st-amax" type="number" min={0} max={99} value={v.jsAgeMax} onChange={(e) => set("jsAgeMax", Number(e.target.value))} /></div>
            <div><Label htmlFor="st-rate">{t("clubadmin.settings.jsRate")}</Label>
              <Input id="st-rate" inputMode="decimal" value={v.jsRatePerParticipantHour ?? ""} onChange={(e) => set("jsRatePerParticipantHour", e.target.value === "" ? null : Number(e.target.value))} /></div>
          </div>
          <FieldHint>{t("clubadmin.settings.jsRateHint")}</FieldHint>
        </>
      )}
      {section === "compliance" && (
        <>
          <label htmlFor="st-block" className="flex items-center gap-2 text-sm text-ink-2">
            <input id="st-block" type="checkbox" checked={v.complianceBlockYouth} onChange={(e) => set("complianceBlockYouth", e.target.checked)} /> {t("clubadmin.settings.blockYouth")}
          </label>
          <fieldset className="space-y-1">
            <legend className="mb-1 text-[11px] font-medium uppercase tracking-[0.12em] text-text-muted">{t("clubadmin.settings.mandatory")}</legend>
            <div className="flex flex-wrap gap-4 text-sm text-ink-2">
              {CERT_KINDS.map((k) => (
                <label key={k} htmlFor={`st-k-${k}`} className="flex items-center gap-2">
                  <input id={`st-k-${k}`} type="checkbox" checked={v.complianceMandatoryKinds.includes(k)} onChange={() => toggleKind(k)} />
                  {t.dynamic(`clubadmin.compliance.kinds.${k}`, undefined, k)}
                </label>
              ))}
            </div>
          </fieldset>
          <div><Label htmlFor="st-days">{t("clubadmin.settings.reminderDays")}</Label>
            <Input id="st-days" className="max-w-[14rem]" value={days} onChange={(e) => setDays(e.target.value)} /></div>
        </>
      )}
      <div className="flex items-center gap-3">
        <Button size="sm" loading={busy} onClick={save}>{t("common.save")}</Button>
        {note}
      </div>
    </div>
  );
}
