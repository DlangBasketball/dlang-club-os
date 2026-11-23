"use client";
import * as React from "react";
import { Input, Label } from "@/components/ui";
import { Select } from "@/components/teams/fields";
import { buildPayerOptions, payerKey, type NewPayerFields, type PayerCandidates, type PayerChoice } from "@/lib/booking/admin-form";
import type { PayerKind } from "@/lib/booking/types";
import { useT } from "@/lib/i18n/client";
import { cn } from "@/lib/utils";

const NEW_KINDS: PayerKind[] = ["guardian", "sponsor", "other"];

/**
 * Bill To: the family default, saved payers of the family (siblings share
 * them) or athlete, guardians, the athlete, or a new payer (guardian,
 * sponsor, other) with name, e-mail and billing address.
 */
export function PayerPicker({ candidates, athlete, value, fields, loading, disabled, onChange, onFields }: {
  candidates: PayerCandidates | null; athlete: { id: string; name: string } | null; loading?: boolean; disabled?: boolean;
  value: PayerChoice; fields: NewPayerFields;
  onChange: (c: PayerChoice) => void; onFields: (patch: Partial<NewPayerFields>) => void;
}) {
  const t = useT();
  const id = React.useId();
  const options = buildPayerOptions(candidates, athlete);
  const current = payerKey(value);
  const groupLabel = (g: string) => t.dynamic(`adminBooking.payer.group.${g}`, undefined, g);

  return (
    <fieldset className="space-y-3" disabled={disabled}>
      <legend className="mb-1.5 block text-[11px] font-medium uppercase tracking-[0.12em] text-text-muted">{t("adminBooking.form.billTo")}</legend>
      {!athlete && <p className="text-sm text-ink-3">{t("adminBooking.payer.pickAthleteFirst")}</p>}
      {athlete && loading && <p className="text-sm text-ink-3">{t("common.loading")}</p>}
      {athlete && !loading && (
        <div className="space-y-1.5">
          {options.map((o) => (
            <label key={o.key} className={cn("flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2 text-sm",
              current === o.key ? "border-maroon bg-maroon/10" : "border-line hover:border-maroon/40")}>
              <input type="radio" name={`${id}-payer`} className="mt-0.5 accent-[var(--red-primary)]" checked={current === o.key} onChange={() => onChange(o.choice)} />
              <span className="min-w-0">
                <span className="block text-ink">{o.group === "family" ? t("adminBooking.payer.familyDefault", { name: o.label || "—" }) : o.label}</span>
                <span className="block text-xs text-ink-3">{[groupLabel(o.group), o.detail].filter(Boolean).join(" · ")}</span>
              </span>
            </label>
          ))}
          <label className={cn("flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2 text-sm",
            value.type === "new" ? "border-maroon bg-maroon/10" : "border-line hover:border-maroon/40")}>
            <input type="radio" name={`${id}-payer`} className="mt-0.5 accent-[var(--red-primary)]" checked={value.type === "new"} onChange={() => onChange({ type: "new", kind: "sponsor" })} />
            <span className="text-ink">{t("adminBooking.payer.newPayer")}</span>
          </label>
        </div>
      )}
      {athlete && value.type === "new" && (
        <div className="grid grid-cols-1 gap-3 rounded-lg border border-line p-3 sm:grid-cols-2">
          <div>
            <Label htmlFor={`${id}-kind`}>{t("adminBooking.payer.kind")}</Label>
            <Select id={`${id}-kind`} value={value.kind} onChange={(e) => onChange({ type: "new", kind: e.target.value as PayerKind })}>
              {NEW_KINDS.map((k) => <option key={k} value={k}>{t.dynamic(`adminBooking.payer.kinds.${k}`, undefined, k)}</option>)}
            </Select>
          </div>
          <div><Label htmlFor={`${id}-name`}>{t("adminBooking.payer.name")}</Label><Input id={`${id}-name`} required maxLength={140} value={fields.name} onChange={(e) => onFields({ name: e.target.value })} /></div>
          <div><Label htmlFor={`${id}-email`}>{t("adminBooking.payer.email")}</Label><Input id={`${id}-email`} type="email" maxLength={254} value={fields.email} onChange={(e) => onFields({ email: e.target.value })} /></div>
          <div><Label htmlFor={`${id}-phone`}>{t("adminBooking.payer.phone")}</Label><Input id={`${id}-phone`} type="tel" maxLength={40} value={fields.phone} onChange={(e) => onFields({ phone: e.target.value })} /></div>
          <div className="sm:col-span-2"><Label htmlFor={`${id}-street`}>{t("adminBooking.payer.street")}</Label><Input id={`${id}-street`} maxLength={140} value={fields.street} onChange={(e) => onFields({ street: e.target.value })} /></div>
          <div className="grid grid-cols-[1fr_2fr] gap-2 sm:col-span-2 sm:grid-cols-[1fr_2fr_0.8fr]">
            <div><Label htmlFor={`${id}-zip`}>{t("adminBooking.payer.postalCode")}</Label><Input id={`${id}-zip`} maxLength={16} value={fields.postalCode} onChange={(e) => onFields({ postalCode: e.target.value })} /></div>
            <div><Label htmlFor={`${id}-city`}>{t("adminBooking.payer.city")}</Label><Input id={`${id}-city`} maxLength={80} value={fields.city} onChange={(e) => onFields({ city: e.target.value })} /></div>
            <div><Label htmlFor={`${id}-country`}>{t("adminBooking.payer.country")}</Label><Input id={`${id}-country`} maxLength={2} value={fields.country} onChange={(e) => onFields({ country: e.target.value.toUpperCase() })} /></div>
          </div>
        </div>
      )}
    </fieldset>
  );
}
