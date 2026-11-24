"use client";

import { Input, Label, Select } from "@/components/ui";
import { useT } from "@/lib/i18n/client";
import { JERSEY_SIZES, POSITION_SUGGESTIONS } from "@/lib/participants/validation";

export type SportsDraft = { heightCm: string; weightKg: string; positionPref: string; jerseySize: string; preferredJerseyNumber: string };

export const emptySports = (): SportsDraft => ({ heightCm: "", weightKg: "", positionPref: "", jerseySize: "", preferredJerseyNumber: "" });

/** Translated label of a stored position (suggestion key, else the stored free text). */
export function positionLabel(t: ReturnType<typeof useT>, v: string | null | undefined): string {
  if (!v) return "";
  return t.dynamic(`participants.positions.${v}`, undefined, v);
}

/**
 * Optional sports fields (height, weight, position, jersey size, preferred
 * jersey number). The preferred number is a preference only: team numbers
 * are set per roster by the club.
 */
export function SportsFields({ value, onChange, idPrefix, disabled }: {
  value: SportsDraft; onChange: (v: SportsDraft) => void; idPrefix: string; disabled?: boolean;
}) {
  const t = useT();
  const set = (k: keyof SportsDraft) => (v: string) => onChange({ ...value, [k]: v });
  const positions: string[] = value.positionPref && !(POSITION_SUGGESTIONS as readonly string[]).includes(value.positionPref)
    ? [value.positionPref, ...POSITION_SUGGESTIONS] : [...POSITION_SUGGESTIONS];
  const sizes: string[] = value.jerseySize && !(JERSEY_SIZES as readonly string[]).includes(value.jerseySize)
    ? [value.jerseySize, ...JERSEY_SIZES] : [...JERSEY_SIZES];
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <div>
        <Label htmlFor={`${idPrefix}-h`}>{t("participants.fields.height")}</Label>
        <Input id={`${idPrefix}-h`} inputMode="decimal" value={value.heightCm} disabled={disabled} onChange={(e) => set("heightCm")(e.target.value)} />
      </div>
      <div>
        <Label htmlFor={`${idPrefix}-w`}>{t("participants.fields.weight")}</Label>
        <Input id={`${idPrefix}-w`} inputMode="decimal" value={value.weightKg} disabled={disabled} onChange={(e) => set("weightKg")(e.target.value)} />
      </div>
      <div>
        <Label htmlFor={`${idPrefix}-p`}>{t("participants.fields.position")}</Label>
        <Select id={`${idPrefix}-p`} value={value.positionPref} disabled={disabled} onChange={(e) => set("positionPref")(e.target.value)}>
          <option value="">—</option>
          {positions.map((p) => <option key={p} value={p}>{positionLabel(t, p)}</option>)}
        </Select>
      </div>
      <div>
        <Label htmlFor={`${idPrefix}-s`}>{t("participants.fields.jerseySize")}</Label>
        <Select id={`${idPrefix}-s`} value={value.jerseySize} disabled={disabled} onChange={(e) => set("jerseySize")(e.target.value)}>
          <option value="">—</option>
          {sizes.map((s) => <option key={s} value={s}>{s}</option>)}
        </Select>
      </div>
      <div className="sm:col-span-2">
        <Label htmlFor={`${idPrefix}-n`}>{t("participants.fields.preferredJerseyNumber")}</Label>
        <Input id={`${idPrefix}-n`} inputMode="numeric" maxLength={3} value={value.preferredJerseyNumber} disabled={disabled}
          onChange={(e) => set("preferredJerseyNumber")(e.target.value.replace(/[^0-9]/g, ""))} />
        <p className="mt-1 text-xs text-text-muted">{t("participants.fields.preferredJerseyHint")}</p>
      </div>
    </div>
  );
}
