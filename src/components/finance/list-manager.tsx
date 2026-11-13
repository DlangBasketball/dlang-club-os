"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { Pencil, Plus, Power, Trash2 } from "lucide-react";
import { Badge, Button, Card, CardBody, CardHeader, CardTitle, Input, Label } from "@/components/ui";
import { deleteListItem, saveListItem, setListItemActive, type FinanceResult } from "@/lib/actions/finance";
import { useT } from "@/lib/i18n/client";

export type ListEntry = { id: string; name: string; active?: boolean; contact?: string | null; notes?: string | null };

/** Editable per-org list of expense categories or suppliers. */
export function ListManager({ kind, items }: { kind: "category" | "supplier"; items: ListEntry[] }) {
  const t = useT();
  const router = useRouter();
  const [editing, setEditing] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [msg, setMsg] = React.useState<{ ok: boolean; text: string } | null>(null);
  const title = kind === "category" ? t("finance.lists.categories") : t("finance.lists.suppliers");

  async function act(fn: () => Promise<FinanceResult>) {
    setBusy(true); setMsg(null);
    const res = await fn();
    setBusy(false);
    setMsg(res.ok ? (res.message ? { ok: true, text: res.message } : null) : { ok: false, text: res.error });
    if (res.ok) { setEditing(null); router.refresh(); }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {editing !== "new" && <Button size="sm" variant="secondary" onClick={() => setEditing("new")}><Plus className="h-4 w-4" aria-hidden /> {t("finance.lists.add")}</Button>}
      </CardHeader>
      <CardBody className="space-y-3">
        {msg && <p role={msg.ok ? "status" : "alert"} className={msg.ok ? "text-sm text-success" : "text-sm text-danger"}>{msg.text}</p>}
        {editing === "new" && <EntryForm kind={kind} busy={busy} onCancel={() => setEditing(null)} onSave={(v) => act(() => saveListItem(kind, null, v))} />}
        {items.length === 0 && editing !== "new" && <p className="text-sm text-ink-3">{t("finance.lists.empty")}</p>}
        <ul className="divide-y divide-line-soft">
          {items.map((i) => (
            <li key={i.id} className="py-2.5">
              {editing === i.id ? (
                <EntryForm kind={kind} entry={i} busy={busy} onCancel={() => setEditing(null)} onSave={(v) => act(() => saveListItem(kind, i.id, v))} />
              ) : (
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <span className={i.active === false ? "text-ink-3" : "text-ink"}>{i.name}</span>
                    {i.active === false && <Badge className="ml-2">{t("finance.lists.inactive")}</Badge>}
                    {i.contact && <span className="ml-2 text-xs text-ink-3">{i.contact}</span>}
                  </div>
                  <div className="flex gap-1.5">
                    <Button size="sm" variant="ghost" onClick={() => setEditing(i.id)}><Pencil className="h-3.5 w-3.5" aria-hidden /> {t("common.edit")}</Button>
                    <Button size="sm" variant="ghost" disabled={busy} onClick={() => act(() => setListItemActive(kind, i.id, i.active === false))}>
                      <Power className="h-3.5 w-3.5" aria-hidden /> {i.active === false ? t("finance.lists.activate") : t("finance.lists.deactivate")}
                    </Button>
                    <Button size="sm" variant="ghost" disabled={busy} aria-label={t("common.delete")}
                      onClick={() => { if (window.confirm(t("finance.lists.confirmDelete", { name: i.name }))) void act(() => deleteListItem(kind, i.id)); }}>
                      <Trash2 className="h-3.5 w-3.5" aria-hidden />
                    </Button>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      </CardBody>
    </Card>
  );
}

function EntryForm({ kind, entry, busy, onSave, onCancel }: {
  kind: "category" | "supplier"; entry?: ListEntry; busy: boolean;
  onSave: (v: { name: string; contact?: string; notes?: string }) => void; onCancel: () => void;
}) {
  const t = useT();
  const [name, setName] = React.useState(entry?.name ?? "");
  const [contact, setContact] = React.useState(entry?.contact ?? "");
  const [notes, setNotes] = React.useState(entry?.notes ?? "");
  const id = `${kind}-${entry?.id ?? "new"}`;
  return (
    <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); onSave(kind === "category" ? { name } : { name, contact, notes }); }}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div><Label htmlFor={`${id}-name`}>{t("finance.lists.name")}</Label><Input id={`${id}-name`} required maxLength={kind === "category" ? 80 : 120} value={name} onChange={(e) => setName(e.target.value)} /></div>
        {kind === "supplier" && <div><Label htmlFor={`${id}-contact`}>{t("finance.lists.contact")}</Label><Input id={`${id}-contact`} maxLength={200} value={contact} onChange={(e) => setContact(e.target.value)} /></div>}
      </div>
      {kind === "supplier" && <div><Label htmlFor={`${id}-notes`}>{t("finance.lists.notes")}</Label><Input id={`${id}-notes`} maxLength={1000} value={notes} onChange={(e) => setNotes(e.target.value)} /></div>}
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={busy}>{t("common.save")}</Button>
        <Button type="button" size="sm" variant="ghost" onClick={onCancel}>{t("common.cancel")}</Button>
      </div>
    </form>
  );
}
