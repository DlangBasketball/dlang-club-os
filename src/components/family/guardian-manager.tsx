"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { UserPlus, Trash2 } from "lucide-react";
import { Card, CardHeader, CardTitle, CardBody, Button, Input, Label, Select, Badge } from "@/components/ui";
import { useT } from "@/lib/i18n/client";
import { linkGuardian, updateGuardian, unlinkGuardian } from "@/lib/actions/family";
import { GUARDIAN_RELATIONS, normaliseOption } from "@/lib/people/validation";

type Relation = (typeof GUARDIAN_RELATIONS)[number];
type GuardianRow = { id: string; name: string | null; email: string | null; phone: string | null; relation: string | null; isPrimary: boolean };

function GuardianItem({ familyId, g, onMsg }: { familyId: string; g: GuardianRow; onMsg: (m: { ok: boolean; text: string }) => void }) {
  const t = useT();
  const router = useRouter();
  const [relation, setRelation] = React.useState<Relation>(normaliseOption(g.relation, GUARDIAN_RELATIONS) || "guardian");
  const [primary, setPrimary] = React.useState(g.isPrimary);
  const [busy, setBusy] = React.useState<"save" | "remove" | null>(null);
  const dirty = relation !== (normaliseOption(g.relation, GUARDIAN_RELATIONS) || "guardian") || primary !== g.isPrimary;
  const label = g.name ?? g.email ?? "—";

  async function save() {
    setBusy("save");
    const res = await updateGuardian({ familyId, profileId: g.id, relation, isPrimary: primary });
    setBusy(null);
    onMsg(res.ok ? { ok: true, text: res.message ?? t("editPeople.saved") } : { ok: false, text: res.error });
    if (res.ok) router.refresh();
  }
  async function remove() {
    if (!window.confirm(t("editPeople.guardians.confirmUnlink", { name: label }))) return;
    setBusy("remove");
    const res = await unlinkGuardian(familyId, g.id);
    setBusy(null);
    onMsg(res.ok ? { ok: true, text: res.message ?? t("editPeople.guardians.unlinked") } : { ok: false, text: res.error });
    if (res.ok) router.refresh();
  }

  return (
    <li className="grid grid-cols-1 gap-3 px-4 py-3 sm:grid-cols-[1fr_auto] sm:items-center">
      <div className="min-w-0">
        <div className="flex items-center gap-2 text-sm font-medium text-ink">
          <span className="truncate">{label}</span>
          {g.isPrimary && <Badge tone="maroon">{t("editPeople.guardians.primary")}</Badge>}
        </div>
        <div className="truncate text-xs text-ink-3">{[g.email, g.phone].filter(Boolean).join(" · ")}</div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Select aria-label={t("editPeople.guardians.relation")} value={relation} onChange={(e) => setRelation(e.target.value as Relation)} className="h-9 w-auto">
          {GUARDIAN_RELATIONS.map((r) => <option key={r} value={r}>{t(`editPeople.relation.${r}`)}</option>)}
        </Select>
        <label className="flex items-center gap-1.5 text-xs text-ink-2">
          <input type="checkbox" checked={primary} onChange={(e) => setPrimary(e.target.checked)} /> {t("editPeople.guardians.primary")}
        </label>
        <Button size="sm" variant="secondary" type="button" disabled={!dirty} loading={busy === "save"} onClick={save}>{t("common.save")}</Button>
        <Button size="sm" variant="ghost" type="button" loading={busy === "remove"} onClick={remove} aria-label={t("editPeople.remove")}>
          <Trash2 className="h-4 w-4 text-danger" />
        </Button>
      </div>
    </li>
  );
}

/** Guardians linked to a family: edit relation / primary contact, unlink, link an existing account by e-mail. */
export function GuardianManager({ familyId, guardians }: { familyId: string; guardians: GuardianRow[] }) {
  const t = useT();
  const router = useRouter();
  const [email, setEmail] = React.useState("");
  const [relation, setRelation] = React.useState<Relation>("guardian");
  const [primary, setPrimary] = React.useState(guardians.length === 0);
  const [pending, setPending] = React.useState(false);
  const [msg, setMsg] = React.useState<{ ok: boolean; text: string } | null>(null);

  async function link(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setMsg(null);
    const res = await linkGuardian({ familyId, email, relation, isPrimary: primary });
    setPending(false);
    if (res.ok) {
      setMsg({ ok: true, text: res.message ?? t("editPeople.guardians.linked") });
      setEmail("");
      router.refresh();
    } else setMsg({ ok: false, text: res.error });
  }

  return (
    <Card className="max-w-xl">
      <CardHeader>
        <CardTitle>{t("editPeople.guardians.title")}</CardTitle>
        <Link href="/admin/invitations" className="text-xs text-maroon hover:underline">{t("editPeople.guardians.invite")}</Link>
      </CardHeader>
      <CardBody className="space-y-4">
        {guardians.length === 0 ? (
          <p className="text-sm text-ink-3">{t("editPeople.guardians.none")}</p>
        ) : (
          <ul className="divide-y divide-line-soft rounded border border-line-soft">
            {guardians.map((g) => <GuardianItem key={g.id} familyId={familyId} g={g} onMsg={setMsg} />)}
          </ul>
        )}
        <form onSubmit={link} className="space-y-3 rounded border border-line-soft p-4">
          <div className="flex items-center gap-2 text-sm font-medium text-ink"><UserPlus className="h-4 w-4" /> {t("editPeople.guardians.linkTitle")}</div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Label htmlFor="g-email">{t("editPeople.guardians.email")}</Label>
              <Input id="g-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="g-rel">{t("editPeople.guardians.relation")}</Label>
              <Select id="g-rel" value={relation} onChange={(e) => setRelation(e.target.value as Relation)}>
                {GUARDIAN_RELATIONS.map((r) => <option key={r} value={r}>{t(`editPeople.relation.${r}`)}</option>)}
              </Select>
            </div>
            <label className="flex items-center gap-2 self-end pb-2 text-sm text-ink-2">
              <input type="checkbox" checked={primary} onChange={(e) => setPrimary(e.target.checked)} /> {t("editPeople.guardians.primary")}
            </label>
          </div>
          <Button type="submit" size="sm" loading={pending} disabled={!email}>{t("editPeople.guardians.link")}</Button>
        </form>
        {msg && <p role="status" className={msg.ok ? "text-sm text-success" : "text-sm text-danger"}>{msg.text}</p>}
      </CardBody>
    </Card>
  );
}
