"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { createAthlete, updateAthlete } from "@/lib/actions/athlete";
import { Card, CardBody, Button, Input, Label, Select, Textarea } from "@/components/ui";
import { useT } from "@/lib/i18n/client";
import { ATHLETE_STATUSES, DOMINANT_HANDS, GENDERS, normaliseOption } from "@/lib/people/validation";

const JERSEY = ["YS", "YM", "YL", "S", "M", "L", "XL", "XXL"];

type FormState = {
  familyId: string;
  firstName: string;
  lastName: string;
  dob: string;
  gender: string;
  nationality: string;
  school: string;
  jerseySize: string;
  dominantHand: string;
  positionPref: string;
  status: string;
  notes: string;
};

export type AthleteFormInitial = Partial<Record<keyof FormState, string | null>>;

export function AthleteForm({
  familyId,
  athleteId,
  initial,
  families,
}: {
  familyId: string;
  athleteId?: string;
  initial?: AthleteFormInitial;
  /** When given, the family link can be changed (move an athlete to another family). */
  families?: { id: string; label: string }[];
}) {
  const t = useT();
  const router = useRouter();
  const [f, setF] = React.useState<FormState>({
    familyId,
    firstName: initial?.firstName ?? "",
    lastName: initial?.lastName ?? "",
    dob: initial?.dob ?? "",
    gender: normaliseOption(initial?.gender, GENDERS),
    nationality: initial?.nationality ?? "",
    school: initial?.school ?? "",
    jerseySize: initial?.jerseySize ?? "",
    dominantHand: normaliseOption(initial?.dominantHand, DOMINANT_HANDS),
    positionPref: initial?.positionPref ?? "",
    status: normaliseOption(initial?.status, ATHLETE_STATUSES) || "active",
    notes: initial?.notes ?? "",
  });
  const set = (k: keyof FormState) => (v: string) => setF((s) => ({ ...s, [k]: v }));
  const [msg, setMsg] = React.useState<{ ok: boolean; text: string } | null>(null);
  const [pending, setPending] = React.useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setMsg(null);
    const payload = {
      ...f,
      gender: f.gender as (typeof GENDERS)[number] | "",
      dominantHand: f.dominantHand as (typeof DOMINANT_HANDS)[number] | "",
      status: f.status as (typeof ATHLETE_STATUSES)[number],
    };
    const res = athleteId ? await updateAthlete(athleteId, payload) : await createAthlete(payload);
    setPending(false);
    if (!res) return;
    if (res.ok) {
      setMsg({ ok: true, text: res.message ?? t("editPeople.saved") });
      router.refresh();
    } else setMsg({ ok: false, text: res.error });
  }

  // Keep a stored value that is not one of the presets (e.g. imported "XS").
  const jerseyOptions = f.jerseySize && !JERSEY.includes(f.jerseySize) ? [f.jerseySize, ...JERSEY] : JERSEY;

  return (
    <Card className="max-w-2xl">
      <CardBody>
        <form onSubmit={onSubmit} className="space-y-4">
          {families && families.length > 0 && (
            <div>
              <Label htmlFor="family">{t("editPeople.athlete.family")}</Label>
              <Select id="family" value={f.familyId} onChange={(e) => set("familyId")(e.target.value)}>
                {families.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
              </Select>
            </div>
          )}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div><Label htmlFor="fn">{t("editPeople.athlete.firstName")}</Label><Input id="fn" required maxLength={80} autoComplete="off" value={f.firstName} onChange={(e) => set("firstName")(e.target.value)} /></div>
            <div><Label htmlFor="ln">{t("editPeople.athlete.lastName")}</Label><Input id="ln" required maxLength={80} autoComplete="off" value={f.lastName} onChange={(e) => set("lastName")(e.target.value)} /></div>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div><Label htmlFor="dob">{t("editPeople.athlete.dob")}</Label><Input id="dob" type="date" required value={f.dob} onChange={(e) => set("dob")(e.target.value)} /></div>
            <div>
              <Label htmlFor="gender">{t("editPeople.athlete.gender")}</Label>
              <Select id="gender" value={f.gender} onChange={(e) => set("gender")(e.target.value)}>
                <option value="">{t("common.select")}</option>
                {GENDERS.map((g) => <option key={g} value={g}>{t(`editPeople.gender.${g}`)}</option>)}
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div><Label htmlFor="nat">{t("editPeople.athlete.nationality")}</Label><Input id="nat" maxLength={80} value={f.nationality} onChange={(e) => set("nationality")(e.target.value)} /></div>
            <div><Label htmlFor="school">{t("editPeople.athlete.school")}</Label><Input id="school" maxLength={120} value={f.school} onChange={(e) => set("school")(e.target.value)} /></div>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div>
              <Label htmlFor="jersey">{t("editPeople.athlete.jerseySize")}</Label>
              <Select id="jersey" value={f.jerseySize} onChange={(e) => set("jerseySize")(e.target.value)}>
                <option value="">—</option>
                {jerseyOptions.map((o) => <option key={o} value={o}>{o}</option>)}
              </Select>
            </div>
            <div>
              <Label htmlFor="hand">{t("editPeople.athlete.dominantHand")}</Label>
              <Select id="hand" value={f.dominantHand} onChange={(e) => set("dominantHand")(e.target.value)}>
                <option value="">—</option>
                {DOMINANT_HANDS.map((h) => <option key={h} value={h}>{t(`editPeople.hand.${h}`)}</option>)}
              </Select>
            </div>
            <div>
              <Label htmlFor="status">{t("editPeople.athlete.status")}</Label>
              <Select id="status" value={f.status} onChange={(e) => set("status")(e.target.value)}>
                {ATHLETE_STATUSES.map((s) => <option key={s} value={s}>{t(`editPeople.athleteStatus.${s}`)}</option>)}
              </Select>
            </div>
          </div>
          <div><Label htmlFor="pos">{t("editPeople.athlete.position")}</Label><Input id="pos" maxLength={60} value={f.positionPref} onChange={(e) => set("positionPref")(e.target.value)} /></div>
          <div>
            <Label htmlFor="notes">{t("editPeople.athlete.notes")}</Label>
            <Textarea id="notes" value={f.notes} maxLength={2000} onChange={(e) => set("notes")(e.target.value)} rows={3} placeholder={t("editPeople.athlete.notesPlaceholder")} />
          </div>
          {msg && <p role="status" className={msg.ok ? "text-sm text-success" : "text-sm text-danger"}>{msg.text}</p>}
          <Button type="submit" loading={pending}>
            {pending ? t("editPeople.saving") : athleteId ? t("editPeople.saveChanges") : t("editPeople.athlete.create")}
          </Button>
        </form>
      </CardBody>
    </Card>
  );
}
