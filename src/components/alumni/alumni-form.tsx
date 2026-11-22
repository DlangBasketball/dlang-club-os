"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Button, Card, CardBody, CardHeader, CardTitle } from "@/components/ui";
import { FieldHint, Input, Label, Select, Textarea } from "@/components/ui/input";
import { useT } from "@/lib/i18n/client";
import { saveAlumni, saveAlumniPlacement } from "@/lib/actions/alumni";
import {
  ALUMNI_STATUSES, GENDERS, INSTITUTION_TYPES, NAME_STYLES, PLACEMENT_STATUSES, SCHOLARSHIPS, ageKnown, isMinor,
  type AlumniInput,
} from "@/lib/alumni/rules";
import type { AlumniRow } from "@/lib/alumni/db";
import { StatusLine } from "@/components/family/use-family-action";

type Values = Required<Omit<AlumniInput, "id" | "athleteId" | "birthYear" | "tags">> & { birthYear: string; tags: string };

function initialValues(a?: AlumniRow | null): Values {
  return {
    firstName: a?.first_name ?? "", lastName: a?.last_name ?? "", birthYear: a?.birth_year ? String(a.birth_year) : "",
    birthDate: a?.birth_date ?? "", gender: (a?.gender as Values["gender"]) ?? "", nationality: a?.nationality ?? "", photoPath: a?.photo_path ?? "",
    email: a?.email ?? "", phone: a?.phone ?? "", whatsapp: a?.whatsapp ?? false, instagram: a?.instagram ?? "", xHandle: a?.x_handle ?? "",
    linkedinUrl: a?.linkedin_url ?? "", highlightUrl: a?.highlight_url ?? "", guardianName: a?.guardian_name ?? "",
    guardianEmail: a?.guardian_email ?? "", guardianPhone: a?.guardian_phone ?? "", contactConsent: a?.contact_consent ?? false,
    contactConsentOn: a?.contact_consent_on ?? "", contactConsentSource: a?.contact_consent_source ?? "",
    showcaseConsent: a?.showcase_consent ?? false, showcaseConsentOn: a?.showcase_consent_on ?? "",
    showcaseGuardianConsent: a?.showcase_guardian_consent ?? false, showcaseNameStyle: a?.showcase_name_style ?? "initial",
    notes: a?.notes ?? "", tags: (a?.tags ?? []).join(", "), status: a?.status ?? "active",
  };
}

const EMPTY_PLACEMENT = { institution: "", institutionType: "ncaa_d1", country: "", endYear: "", scholarship: "unknown", status: "committed" };

/** Add / edit an alumnus. On "add", an optional first placement is saved with it. */
export function AlumniForm({ base, initial, photos }: { base: string; initial?: AlumniRow | null; photos: { path: string; label: string }[] }) {
  const t = useT();
  const router = useRouter();
  const [v, setV] = React.useState<Values>(() => initialValues(initial));
  const [pl, setPl] = React.useState(EMPTY_PLACEMENT);
  const [busy, setBusy] = React.useState(false);
  const [msg, setMsg] = React.useState<{ ok: boolean; text: string } | null>(null);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const set = <K extends keyof Values>(k: K, val: Values[K]) => setV((s) => ({ ...s, [k]: val }));
  const minor = isMinor({ birthYear: Number(v.birthYear) || null, birthDate: v.birthDate || null });
  const known = ageKnown({ birthYear: Number(v.birthYear) || null, birthDate: v.birthDate || null });
  const err = (k: string) => (errors[k] ? <p className="mt-1 text-xs text-danger">{errors[k]}</p> : null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    setErrors({});
    try {
      const res = await saveAlumni({
        ...v, id: initial?.id ?? null, athleteId: initial?.athlete_id ?? null, birthYear: v.birthYear,
        gender: v.gender || null, tags: v.tags.split(",").map((x) => x.trim()).filter(Boolean).slice(0, 20),
      } as AlumniInput);
      if (!res.ok) {
        setErrors(res.errors ?? {});
        setMsg({ ok: false, text: res.error });
        return;
      }
      const id = res.data!.id;
      if (!initial && pl.institution.trim()) {
        const p = await saveAlumniPlacement({
          alumniId: id, institution: pl.institution, institutionType: pl.institutionType as never, country: pl.country,
          endYear: pl.endYear as never, scholarship: pl.scholarship as never, status: pl.status as never, isCurrent: true,
        });
        if (!p.ok) setMsg({ ok: false, text: p.error });
      }
      router.push(`${base}/${id}` as never);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="space-y-5" onSubmit={submit} noValidate>
      <Card>
        <CardHeader><CardTitle>{t("alumni.form.identity")}</CardTitle></CardHeader>
        <CardBody className="grid gap-3 sm:grid-cols-2">
          <div><Label htmlFor="al-first">{t("alumni.fields.firstName")}</Label><Input id="al-first" required maxLength={80} value={v.firstName} onChange={(e) => set("firstName", e.target.value)} />{err("firstName")}</div>
          <div><Label htmlFor="al-last">{t("alumni.fields.lastName")}</Label><Input id="al-last" required maxLength={80} value={v.lastName} onChange={(e) => set("lastName", e.target.value)} />{err("lastName")}</div>
          <div>
            <Label htmlFor="al-by">{t("alumni.fields.birthYear")}</Label>
            <Input id="al-by" inputMode="numeric" maxLength={4} value={v.birthYear} onChange={(e) => set("birthYear", e.target.value.replace(/\D/g, ""))} />
            <FieldHint>{t("alumni.form.birthYearHint")}</FieldHint>{err("birthYear")}
          </div>
          <div>
            <Label htmlFor="al-bd">{t("alumni.fields.birthDate")}</Label>
            <Input id="al-bd" type="date" value={v.birthDate ?? ""} onChange={(e) => set("birthDate", e.target.value)} />
            <FieldHint>{t("alumni.form.birthDateHint")}</FieldHint>
          </div>
          <div>
            <Label htmlFor="al-gender">{t("alumni.fields.gender")}</Label>
            <Select id="al-gender" value={v.gender ?? ""} onChange={(e) => set("gender", e.target.value as Values["gender"])}>
              <option value="">{t("alumni.form.notSaid")}</option>
              {GENDERS.map((g) => <option key={g} value={g}>{t(`alumni.genders.${g}`)}</option>)}
            </Select>
          </div>
          <div><Label htmlFor="al-nat">{t("alumni.fields.nationality")}</Label><Input id="al-nat" maxLength={80} value={v.nationality ?? ""} onChange={(e) => set("nationality", e.target.value)} /></div>
          {photos.length > 0 && (
            <div className="sm:col-span-2">
              <Label htmlFor="al-photo">{t("alumni.fields.photo")}</Label>
              <Select id="al-photo" value={v.photoPath ?? ""} onChange={(e) => set("photoPath", e.target.value)}>
                <option value="">{t("alumni.form.noPhoto")}</option>
                {photos.map((p) => <option key={p.path} value={p.path}>{p.label}</option>)}
              </Select>
              <FieldHint>{t("alumni.form.photoHint")}</FieldHint>
            </div>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader><CardTitle>{t("alumni.form.contact")}</CardTitle></CardHeader>
        <CardBody className="grid gap-3 sm:grid-cols-2">
          <div><Label htmlFor="al-email">{t("alumni.fields.email")}</Label><Input id="al-email" type="email" maxLength={254} value={v.email ?? ""} onChange={(e) => set("email", e.target.value)} />{err("email")}</div>
          <div>
            <Label htmlFor="al-phone">{t("alumni.fields.phone")}</Label>
            <Input id="al-phone" type="tel" maxLength={40} value={v.phone ?? ""} onChange={(e) => set("phone", e.target.value)} />
            <FieldHint>{t("alumni.form.phoneHint")}</FieldHint>{err("phone")}
          </div>
          <label className="flex items-center gap-2 text-sm text-text-secondary sm:col-span-2">
            <input type="checkbox" checked={v.whatsapp} onChange={(e) => set("whatsapp", e.target.checked)} /> {t("alumni.fields.whatsapp")}
          </label>
          <div><Label htmlFor="al-ig">{t("alumni.fields.instagram")}</Label><Input id="al-ig" maxLength={100} value={v.instagram ?? ""} onChange={(e) => set("instagram", e.target.value)} /></div>
          <div><Label htmlFor="al-x">{t("alumni.fields.xHandle")}</Label><Input id="al-x" maxLength={100} value={v.xHandle ?? ""} onChange={(e) => set("xHandle", e.target.value)} /></div>
          <div><Label htmlFor="al-li">{t("alumni.fields.linkedinUrl")}</Label><Input id="al-li" type="url" maxLength={500} value={v.linkedinUrl ?? ""} onChange={(e) => set("linkedinUrl", e.target.value)} />{err("linkedinUrl")}</div>
          <div><Label htmlFor="al-hl">{t("alumni.fields.highlightUrl")}</Label><Input id="al-hl" type="url" maxLength={500} value={v.highlightUrl ?? ""} onChange={(e) => set("highlightUrl", e.target.value)} />{err("highlightUrl")}</div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader><CardTitle>{t("alumni.form.guardian")}</CardTitle></CardHeader>
        <CardBody className="space-y-3">
          <p className={minor ? "text-sm text-warning" : "text-sm text-text-muted"}>{t(minor ? "alumni.form.guardianRequired" : "alumni.form.guardianOptional")}</p>
          <div className="grid gap-3 sm:grid-cols-3">
            <div><Label htmlFor="al-gn">{t("alumni.fields.guardianName")}</Label><Input id="al-gn" maxLength={160} value={v.guardianName ?? ""} onChange={(e) => set("guardianName", e.target.value)} />{err("guardianName")}</div>
            <div><Label htmlFor="al-ge">{t("alumni.fields.guardianEmail")}</Label><Input id="al-ge" type="email" maxLength={254} value={v.guardianEmail ?? ""} onChange={(e) => set("guardianEmail", e.target.value)} />{err("guardianEmail")}</div>
            <div><Label htmlFor="al-gp">{t("alumni.fields.guardianPhone")}</Label><Input id="al-gp" type="tel" maxLength={40} value={v.guardianPhone ?? ""} onChange={(e) => set("guardianPhone", e.target.value)} />{err("guardianPhone")}</div>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader><CardTitle>{t("alumni.form.consent")}</CardTitle></CardHeader>
        <CardBody className="space-y-4 text-sm">
          <fieldset className="space-y-2">
            <label className="flex items-center gap-2 text-text"><input type="checkbox" checked={v.contactConsent} onChange={(e) => set("contactConsent", e.target.checked)} /> {t("alumni.fields.contactConsent")}</label>
            <FieldHint>{t("alumni.form.contactConsentHint")}</FieldHint>
            {v.contactConsent && (
              <div className="grid gap-3 sm:grid-cols-2">
                <div><Label htmlFor="al-cc-on">{t("alumni.fields.consentOn")}</Label><Input id="al-cc-on" type="date" value={v.contactConsentOn ?? ""} onChange={(e) => set("contactConsentOn", e.target.value)} /></div>
                <div><Label htmlFor="al-cc-src">{t("alumni.fields.consentSource")}</Label><Input id="al-cc-src" maxLength={200} placeholder={t("alumni.form.consentSourcePlaceholder")} value={v.contactConsentSource ?? ""} onChange={(e) => set("contactConsentSource", e.target.value)} /></div>
              </div>
            )}
          </fieldset>
          <fieldset className="space-y-2 border-t border-border pt-4">
            <label className="flex items-center gap-2 text-text"><input type="checkbox" checked={v.showcaseConsent} onChange={(e) => set("showcaseConsent", e.target.checked)} /> {t("alumni.fields.showcaseConsent")}</label>
            <FieldHint>{t("alumni.form.showcaseHint")}</FieldHint>
            {v.showcaseConsent && (
              <div className="grid gap-3 sm:grid-cols-2">
                <div><Label htmlFor="al-sc-on">{t("alumni.fields.consentOn")}</Label><Input id="al-sc-on" type="date" value={v.showcaseConsentOn ?? ""} onChange={(e) => set("showcaseConsentOn", e.target.value)} /></div>
                <div>
                  <Label htmlFor="al-sc-name">{t("alumni.fields.nameStyle")}</Label>
                  <Select id="al-sc-name" value={v.showcaseNameStyle} onChange={(e) => set("showcaseNameStyle", e.target.value as Values["showcaseNameStyle"])}>
                    {NAME_STYLES.map((s) => <option key={s} value={s}>{t(`alumni.nameStyles.${s}`)}</option>)}
                  </Select>
                </div>
                {(minor || !known) && (
                  <label className="flex items-center gap-2 text-text sm:col-span-2">
                    <input type="checkbox" checked={v.showcaseGuardianConsent} onChange={(e) => set("showcaseGuardianConsent", e.target.checked)} /> {t("alumni.fields.showcaseGuardianConsent")}
                  </label>
                )}
              </div>
            )}
          </fieldset>
        </CardBody>
      </Card>

      <Card>
        <CardHeader><CardTitle>{t("alumni.form.followUp")}</CardTitle></CardHeader>
        <CardBody className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label htmlFor="al-status">{t("alumni.fields.status")}</Label>
            <Select id="al-status" value={v.status} onChange={(e) => set("status", e.target.value as Values["status"])}>
              {ALUMNI_STATUSES.map((s) => <option key={s} value={s}>{t(`alumni.statuses.${s}`)}</option>)}
            </Select>
          </div>
          <div><Label htmlFor="al-tags">{t("alumni.fields.tags")}</Label><Input id="al-tags" value={v.tags} onChange={(e) => set("tags", e.target.value)} /><FieldHint>{t("alumni.form.tagsHint")}</FieldHint></div>
          <div className="sm:col-span-2"><Label htmlFor="al-notes">{t("alumni.fields.notes")}</Label><Textarea id="al-notes" rows={3} maxLength={4000} value={v.notes ?? ""} onChange={(e) => set("notes", e.target.value)} /></div>
        </CardBody>
      </Card>

      {!initial && (
        <Card>
          <CardHeader><CardTitle>{t("alumni.form.firstPlacement")}</CardTitle></CardHeader>
          <CardBody className="grid gap-3 sm:grid-cols-3">
            <div className="sm:col-span-3"><FieldHint>{t("alumni.form.firstPlacementHint")}</FieldHint></div>
            <div><Label htmlFor="al-p-inst">{t("alumni.placement.institution")}</Label><Input id="al-p-inst" maxLength={160} value={pl.institution} onChange={(e) => setPl((s) => ({ ...s, institution: e.target.value }))} /></div>
            <div>
              <Label htmlFor="al-p-type">{t("alumni.placement.type")}</Label>
              <Select id="al-p-type" value={pl.institutionType} onChange={(e) => setPl((s) => ({ ...s, institutionType: e.target.value }))}>
                {INSTITUTION_TYPES.map((k) => <option key={k} value={k}>{t(`alumni.types.${k}`)}</option>)}
              </Select>
            </div>
            <div><Label htmlFor="al-p-country">{t("alumni.placement.country")}</Label><Input id="al-p-country" maxLength={80} value={pl.country} onChange={(e) => setPl((s) => ({ ...s, country: e.target.value }))} /></div>
            <div><Label htmlFor="al-p-year">{t("alumni.placement.endYear")}</Label><Input id="al-p-year" inputMode="numeric" maxLength={4} value={pl.endYear} onChange={(e) => setPl((s) => ({ ...s, endYear: e.target.value.replace(/\D/g, "") }))} /></div>
            <div>
              <Label htmlFor="al-p-sch">{t("alumni.placement.scholarship")}</Label>
              <Select id="al-p-sch" value={pl.scholarship} onChange={(e) => setPl((s) => ({ ...s, scholarship: e.target.value }))}>
                {SCHOLARSHIPS.map((k) => <option key={k} value={k}>{t(`alumni.scholarships.${k}`)}</option>)}
              </Select>
            </div>
            <div>
              <Label htmlFor="al-p-status">{t("alumni.placement.status")}</Label>
              <Select id="al-p-status" value={pl.status} onChange={(e) => setPl((s) => ({ ...s, status: e.target.value }))}>
                {PLACEMENT_STATUSES.map((k) => <option key={k} value={k}>{t(`alumni.placementStatuses.${k}`)}</option>)}
              </Select>
            </div>
          </CardBody>
        </Card>
      )}

      <StatusLine msg={msg} />
      <div className="flex gap-2">
        <Button type="submit" loading={busy} disabled={busy}>{t("common.save")}</Button>
        <Button type="button" variant="secondary" onClick={() => router.back()} disabled={busy}>{t("common.cancel")}</Button>
      </div>
    </form>
  );
}
