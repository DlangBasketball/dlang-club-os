"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { ShieldAlert } from "lucide-react";
import { upsertMedical } from "@/lib/actions/athlete";
import { Card, CardHeader, CardTitle, CardBody, Button, Input, Label, Badge, Textarea } from "@/components/ui";
import { useT } from "@/lib/i18n/client";

type Medical = {
  allergies: string;
  conditions: string;
  medications: string;
  insurance: string;
  emergencyContactName: string;
  emergencyContactPhone: string;
  notes: string;
};

/** Admin editor for the athlete's medical record + emergency contact (admin only; never finance). */
export function MedicalForm({ athleteId, initial }: { athleteId: string; initial?: Partial<Medical> }) {
  const t = useT();
  const router = useRouter();
  const [f, setF] = React.useState<Medical>({
    allergies: initial?.allergies ?? "",
    conditions: initial?.conditions ?? "",
    medications: initial?.medications ?? "",
    insurance: initial?.insurance ?? "",
    emergencyContactName: initial?.emergencyContactName ?? "",
    emergencyContactPhone: initial?.emergencyContactPhone ?? "",
    notes: initial?.notes ?? "",
  });
  const set = (k: keyof Medical) => (v: string) => setF((s) => ({ ...s, [k]: v }));
  const [msg, setMsg] = React.useState<{ ok: boolean; text: string } | null>(null);
  const [pending, setPending] = React.useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setMsg(null);
    const res = await upsertMedical(athleteId, f);
    setPending(false);
    if (res.ok) {
      setMsg({ ok: true, text: res.message ?? t("editPeople.saved") });
      router.refresh();
    } else setMsg({ ok: false, text: res.error });
  }

  return (
    <Card className="max-w-2xl">
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><ShieldAlert className="h-4 w-4 text-maroon" /> {t("editPeople.medical.title")}</CardTitle>
        <Badge tone="danger">{t("editPeople.medical.sensitive")}</Badge>
      </CardHeader>
      <CardBody>
        <form onSubmit={onSubmit} className="space-y-4">
          <p className="text-xs text-ink-3">{t("editPeople.medical.access")}</p>
          <div><Label htmlFor="alg">{t("editPeople.medical.allergies")}</Label><Input id="alg" maxLength={1000} value={f.allergies} onChange={(e) => set("allergies")(e.target.value)} /></div>
          <div><Label htmlFor="cond">{t("editPeople.medical.conditions")}</Label><Input id="cond" maxLength={1000} value={f.conditions} onChange={(e) => set("conditions")(e.target.value)} /></div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div><Label htmlFor="med">{t("editPeople.medical.medications")}</Label><Input id="med" maxLength={1000} value={f.medications} onChange={(e) => set("medications")(e.target.value)} /></div>
            <div><Label htmlFor="ins">{t("editPeople.medical.insurance")}</Label><Input id="ins" maxLength={200} value={f.insurance} onChange={(e) => set("insurance")(e.target.value)} /></div>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div><Label htmlFor="ecn">{t("editPeople.medical.emergencyName")}</Label><Input id="ecn" maxLength={120} value={f.emergencyContactName} onChange={(e) => set("emergencyContactName")(e.target.value)} /></div>
            <div><Label htmlFor="ecp">{t("editPeople.medical.emergencyPhone")}</Label><Input id="ecp" type="tel" maxLength={40} value={f.emergencyContactPhone} onChange={(e) => set("emergencyContactPhone")(e.target.value)} /></div>
          </div>
          <div>
            <Label htmlFor="mnotes">{t("editPeople.medical.notes")}</Label>
            <Textarea id="mnotes" maxLength={2000} value={f.notes} onChange={(e) => set("notes")(e.target.value)} rows={3} />
          </div>
          {msg && <p role="status" className={msg.ok ? "text-sm text-success" : "text-sm text-danger"}>{msg.text}</p>}
          <Button type="submit" loading={pending}>{pending ? t("editPeople.saving") : t("editPeople.medical.save")}</Button>
        </form>
      </CardBody>
    </Card>
  );
}
