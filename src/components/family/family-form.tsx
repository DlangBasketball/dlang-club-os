"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { createFamily, updateFamily } from "@/lib/actions/family";
import { Card, CardBody, Button, Input, Label } from "@/components/ui";
import { useT } from "@/lib/i18n/client";

type FamilyFields = { name: string; address: string; phone: string; contactName: string; contactEmail: string };

export function FamilyForm({
  familyId,
  initial,
}: {
  familyId?: string;
  initial?: Partial<Record<keyof FamilyFields, string | null>>;
}) {
  const t = useT();
  const router = useRouter();
  const [f, setF] = React.useState<FamilyFields>({
    name: initial?.name ?? "",
    address: initial?.address ?? "",
    phone: initial?.phone ?? "",
    contactName: initial?.contactName ?? "",
    contactEmail: initial?.contactEmail ?? "",
  });
  const set = (k: keyof FamilyFields) => (e: React.ChangeEvent<HTMLInputElement>) => setF((s) => ({ ...s, [k]: e.target.value }));
  const [msg, setMsg] = React.useState<{ ok: boolean; text: string } | null>(null);
  const [pending, setPending] = React.useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setMsg(null);
    const res = familyId ? await updateFamily(familyId, f) : await createFamily(f);
    setPending(false);
    if (!res) return;
    if (res.ok) {
      setMsg({ ok: true, text: res.message ?? t("editPeople.saved") });
      router.refresh();
    } else setMsg({ ok: false, text: res.error });
  }

  return (
    <Card className="max-w-xl">
      <CardBody>
        <form onSubmit={onSubmit} className="space-y-4">
          <div>
            <Label htmlFor="name">{t("editPeople.family.name")}</Label>
            <Input id="name" required maxLength={120} value={f.name} onChange={set("name")} />
          </div>
          <div>
            <Label htmlFor="address">{t("editPeople.family.address")}</Label>
            <Input id="address" maxLength={300} autoComplete="street-address" value={f.address} onChange={set("address")} />
          </div>
          <div>
            <Label htmlFor="phone">{t("editPeople.family.phone")}</Label>
            <Input id="phone" type="tel" maxLength={40} value={f.phone} onChange={set("phone")} />
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="contactName">{t("editPeople.family.contactName")}</Label>
              <Input id="contactName" maxLength={120} value={f.contactName} onChange={set("contactName")} />
            </div>
            <div>
              <Label htmlFor="contactEmail">{t("editPeople.family.contactEmail")}</Label>
              <Input id="contactEmail" type="email" maxLength={200} value={f.contactEmail} onChange={set("contactEmail")} />
            </div>
          </div>
          <p className="text-xs text-ink-3">{t("editPeople.family.contactHint")}</p>
          {msg && <p role="status" className={msg.ok ? "text-sm text-success" : "text-sm text-danger"}>{msg.text}</p>}
          <Button type="submit" loading={pending}>
            {pending ? t("editPeople.saving") : familyId ? t("editPeople.saveChanges") : t("editPeople.family.create")}
          </Button>
        </form>
      </CardBody>
    </Card>
  );
}
