"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { updateAthleteLicence } from "@/lib/actions/athlete";
import { Card, CardHeader, CardTitle, CardBody, Button, Input, Label } from "@/components/ui";
import { useT } from "@/lib/i18n/client";
import type { Licence } from "@/lib/people/licence";

type Fields = { number: string; category: string; federation: string; issuedOn: string; fee: string };

/** Admin editor for a player's federation licence (server action validates with zod). */
export function LicenceForm({ athleteId, initial }: { athleteId: string; initial: Licence }) {
  const t = useT();
  const router = useRouter();
  const [v, setV] = React.useState<Fields>({
    number: initial.number ?? "",
    category: initial.category ?? "",
    federation: initial.federation ?? "",
    issuedOn: initial.issuedOn ?? "",
    fee: initial.fee !== null ? initial.fee.toFixed(2) : "",
  });
  const set = (k: keyof Fields) => (e: React.ChangeEvent<HTMLInputElement>) => setV((s) => ({ ...s, [k]: e.target.value }));
  const [msg, setMsg] = React.useState<{ ok: boolean; text: string } | null>(null);
  const [pending, setPending] = React.useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setMsg(null);
    const res = await updateAthleteLicence(athleteId, v);
    setPending(false);
    if (res.ok) {
      setMsg({ ok: true, text: res.message ?? t("editPeople.saved") });
      router.refresh();
    } else setMsg({ ok: false, text: res.error });
  }

  return (
    <Card className="max-w-2xl">
      <CardHeader><CardTitle>{t("editPeople.licence.title")}</CardTitle></CardHeader>
      <CardBody>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div><Label htmlFor="lic-number">{t("editPeople.licence.number")}</Label><Input id="lic-number" maxLength={40} autoComplete="off" value={v.number} onChange={set("number")} /></div>
            <div><Label htmlFor="lic-category">{t("editPeople.licence.category")}</Label><Input id="lic-category" maxLength={40} placeholder={t("editPeople.licence.categoryPlaceholder")} value={v.category} onChange={set("category")} /></div>
          </div>
          <div><Label htmlFor="lic-federation">{t("editPeople.licence.federation")}</Label><Input id="lic-federation" maxLength={80} placeholder={t("editPeople.licence.federationPlaceholder")} value={v.federation} onChange={set("federation")} /></div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div><Label htmlFor="lic-issued">{t("editPeople.licence.issuedOn")}</Label><Input id="lic-issued" type="date" value={v.issuedOn} onChange={set("issuedOn")} /></div>
            <div><Label htmlFor="lic-fee">{t("editPeople.licence.fee")}</Label><Input id="lic-fee" inputMode="decimal" maxLength={16} value={v.fee} onChange={set("fee")} /></div>
          </div>
          <p className="text-xs text-text-muted">{t("editPeople.licence.hint")}</p>
          {msg && <p role="status" className={msg.ok ? "text-sm text-success" : "text-sm text-danger"}>{msg.text}</p>}
          <Button type="submit" loading={pending}>{pending ? t("editPeople.saving") : t("editPeople.saveChanges")}</Button>
        </form>
      </CardBody>
    </Card>
  );
}
