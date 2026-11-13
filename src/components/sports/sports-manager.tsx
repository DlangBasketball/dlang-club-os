"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import { Badge, Button, Card, CardBody, Input, Label, Select } from "@/components/ui";
import { useT } from "@/lib/i18n/client";
import { deleteSport, saveSport, setSportTag, type SportTagKind } from "@/lib/actions/sports";
import { SPORT_ICON_KEYS, SPORT_TERMS, sportIcon, type SportTerm } from "@/lib/sports/icons";

export type SportItem = { id: string; name: string; icon: string | null; terminology: Partial<Record<SportTerm, string>>; isActive: boolean; sortOrder: number; usage: number };

type Draft = { id: string | null; name: string; icon: string; terminology: Partial<Record<SportTerm, string>>; isActive: boolean; sortOrder: number };
const EMPTY: Draft = { id: null, name: "", icon: "", terminology: {}, isActive: true, sortOrder: 0 };

/** Sports of the club (admin): name, icon, default terminology, active. */
export function SportsManager({ sports, canEdit }: { sports: SportItem[]; canEdit: boolean }) {
  const t = useT();
  const router = useRouter();
  const [draft, setDraft] = React.useState<Draft | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [msg, setMsg] = React.useState<{ ok: boolean; text: string } | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!draft) return;
    setBusy(true); setMsg(null);
    const res = await saveSport(draft.id, { name: draft.name, icon: draft.icon, terminology: draft.terminology, isActive: draft.isActive, sortOrder: draft.sortOrder });
    setBusy(false);
    if (!res.ok) return setMsg({ ok: false, text: res.error });
    setDraft(null);
    setMsg({ ok: true, text: t("sports.saved") });
    router.refresh();
  }
  async function remove(s: SportItem) {
    if (!window.confirm(t("sports.deleteConfirm", { name: s.name }))) return;
    const res = await deleteSport(s.id);
    if (!res.ok) return setMsg({ ok: false, text: res.error });
    router.refresh();
  }

  return (
    <div className="space-y-4">
      <ul className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {sports.map((s) => {
          const Icon = sportIcon(s.icon);
          return (
            <li key={s.id}>
              <Card><CardBody className="flex items-center gap-3">
                <span className="flex h-10 w-10 items-center justify-center rounded-full bg-brand-primary-soft text-brand-primary"><Icon className="h-5 w-5" aria-hidden /></span>
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{s.name} {!s.isActive && <Badge className="ml-1">{t("sports.inactive")}</Badge>}</p>
                  <p className="text-xs text-text-muted">{t("sports.usage", { count: s.usage })}
                    {Object.entries(s.terminology).filter(([, v]) => v).map(([k, v]) => ` · ${t(`sports.terms.${k as SportTerm}`)}: ${v}`).join("")}</p>
                </div>
                {canEdit && <>
                  <Button size="sm" variant="secondary" onClick={() => setDraft({ id: s.id, name: s.name, icon: s.icon ?? "", terminology: s.terminology, isActive: s.isActive, sortOrder: s.sortOrder })}>{t("common.edit")}</Button>
                  <Button size="sm" variant="ghost" aria-label={t("common.delete")} onClick={() => remove(s)}><Trash2 className="h-4 w-4 text-danger" aria-hidden /></Button>
                </>}
              </CardBody></Card>
            </li>
          );
        })}
      </ul>
      {sports.length === 0 && <p className="text-sm text-text-muted">{t("sports.empty")}</p>}
      {canEdit && !draft && <Button size="sm" onClick={() => setDraft(EMPTY)}><Plus className="h-4 w-4" aria-hidden /> {t("sports.add")}</Button>}
      {draft && (
        <Card><CardBody>
          <form onSubmit={save} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div><Label htmlFor="sp-n">{t("sports.name")}</Label><Input id="sp-n" value={draft.name} maxLength={60} required onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></div>
            <div><Label htmlFor="sp-i">{t("sports.icon")}</Label>
              <Select id="sp-i" value={draft.icon} onChange={(e) => setDraft({ ...draft, icon: e.target.value })}>
                <option value="">{t("sports.iconDefault")}</option>
                {SPORT_ICON_KEYS.map((k) => <option key={k} value={k}>{t(`sports.icons.${k as "ball"}`)}</option>)}
              </Select></div>
            <fieldset className="grid grid-cols-1 gap-3 sm:col-span-2 sm:grid-cols-3">
              <legend className="mb-1 text-[11px] font-medium uppercase tracking-[0.12em] text-text-muted">{t("sports.terminology")}</legend>
              {SPORT_TERMS.map((k) => (
                <div key={k}><Label htmlFor={`sp-t-${k}`}>{t(`sports.terms.${k}`)}</Label>
                  <Input id={`sp-t-${k}`} value={draft.terminology[k] ?? ""} maxLength={40} placeholder={t("sports.termPlaceholder")}
                    onChange={(e) => setDraft({ ...draft, terminology: { ...draft.terminology, [k]: e.target.value } })} /></div>
              ))}
            </fieldset>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={draft.isActive} onChange={(e) => setDraft({ ...draft, isActive: e.target.checked })} className="h-4 w-4 accent-[var(--red-primary)]" /> {t("sports.active")}</label>
            <div className="flex gap-2 sm:col-span-2">
              <Button type="submit" size="sm" loading={busy}>{t("common.save")}</Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => setDraft(null)}>{t("common.cancel")}</Button>
            </div>
          </form>
        </CardBody></Card>
      )}
      {msg && <p role={msg.ok ? "status" : "alert"} className={msg.ok ? "text-sm text-success" : "text-sm text-danger"}>{msg.text}</p>}
    </div>
  );
}

/** Tag a team / programme / development item with one of the club's sports. */
export function SportTagPicker({ kind, recordId, value, sports }: {
  kind: SportTagKind; recordId: string; value: string | null; sports: { id: string; name: string }[];
}) {
  const t = useT();
  const router = useRouter();
  const [v, setV] = React.useState(value ?? "");
  const [msg, setMsg] = React.useState<{ ok: boolean; text: string } | null>(null);
  async function change(next: string) {
    setV(next); setMsg(null);
    const res = await setSportTag(kind, recordId, next || null);
    if (!res.ok) { setV(value ?? ""); return setMsg({ ok: false, text: res.error }); }
    setMsg({ ok: true, text: t("sports.saved") });
    router.refresh();
  }
  if (!sports.length) return null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Label htmlFor={`sport-${recordId}`} className="mb-0">{t("sports.sport")}</Label>
      <Select id={`sport-${recordId}`} value={v} onChange={(e) => change(e.target.value)} className="max-w-[14rem]">
        <option value="">{t("sports.none")}</option>
        {sports.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
      </Select>
      {msg && <span role={msg.ok ? "status" : "alert"} className={msg.ok ? "text-xs text-success" : "text-xs text-danger"}>{msg.text}</span>}
    </div>
  );
}
