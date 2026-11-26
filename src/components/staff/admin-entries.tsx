"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Pencil, Plus, Trash2, X } from "lucide-react";
import { Button, FieldHint, Input, Label, Select } from "@/components/ui";
import { useT } from "@/lib/i18n/client";
import { deleteTimeEntry, saveTimeEntry } from "@/lib/actions/staff-time";
import type { EntryView } from "@/lib/staff/data";
import { EntryList } from "./entry-list";

/** Club-local "YYYY-MM-DDTHH:MM" values for an entry, computed on the server. */
export type EntryLocal = { clockIn: string; clockOut: string; breaks: { start: string; end: string }[] };

type Draft = { entryId: string | null; clockIn: string; clockOut: string; venueId: string; reason: string; breaks: { start: string; end: string }[] };

/** Admin list of an employee's shifts with add / correct / delete (reason required, audited). */
export function AdminEntries({
  profileId, entries, local, venues, locked, defaultDay,
}: {
  profileId: string;
  entries: EntryView[];
  local: Record<string, EntryLocal>;
  venues: { id: string; name: string }[];
  locked: boolean;
  defaultDay: string;
}) {
  const t = useT();
  const router = useRouter();
  const [draft, setDraft] = React.useState<Draft | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [msg, setMsg] = React.useState<{ ok: boolean; text: string } | null>(null);

  function startNew() {
    setMsg(null);
    setDraft({ entryId: null, clockIn: `${defaultDay}T09:00`, clockOut: `${defaultDay}T17:00`, venueId: "", reason: "", breaks: [] });
  }
  function startEdit(e: EntryView) {
    setMsg(null);
    const l = local[e.id];
    setDraft({
      entryId: e.id,
      clockIn: l?.clockIn ?? `${defaultDay}T09:00`,
      clockOut: l?.clockOut || l?.clockIn || `${defaultDay}T17:00`,
      venueId: e.venueId ?? "",
      reason: "",
      breaks: l?.breaks ?? [],
    });
  }
  async function save(ev: React.FormEvent) {
    ev.preventDefault();
    if (!draft) return;
    setBusy(true);
    const res = await saveTimeEntry({
      entryId: draft.entryId, profileId, clockIn: draft.clockIn, clockOut: draft.clockOut, venueId: draft.venueId || null,
      reason: draft.reason, breaks: draft.breaks.filter((b) => b.start && b.end),
    });
    setBusy(false);
    if (res.ok) {
      setDraft(null);
      setMsg({ ok: true, text: res.message ?? "" });
      router.refresh();
    } else setMsg({ ok: false, text: res.error });
  }
  async function remove(e: EntryView) {
    const reason = window.prompt(t("staff.timesheets.detail.deletePrompt"));
    if (reason === null) return;
    setBusy(true);
    const res = await deleteTimeEntry(e.id, reason);
    setBusy(false);
    setMsg(res.ok ? { ok: true, text: res.message ?? "" } : { ok: false, text: res.error });
    if (res.ok) router.refresh();
  }
  const setBreak = (i: number, k: "start" | "end", v: string) =>
    setDraft((d) => (d ? { ...d, breaks: d.breaks.map((b, j) => (j === i ? { ...b, [k]: v } : b)) } : d));

  return (
    <div className="space-y-4">
      {locked ? (
        <p className="text-sm text-text-muted">{t("staff.timesheets.detail.locked")}</p>
      ) : (
        !draft && <Button type="button" size="sm" onClick={startNew}><Plus className="h-4 w-4" /> {t("staff.timesheets.detail.addEntry")}</Button>
      )}

      {draft && (
        <form onSubmit={save} className="space-y-3 rounded-md border border-border bg-surface-elevated p-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <Label htmlFor="ae-in">{t("staff.timesheets.detail.clockIn")}</Label>
              <Input id="ae-in" type="datetime-local" required value={draft.clockIn} onChange={(e) => setDraft({ ...draft, clockIn: e.target.value })} />
            </div>
            <div>
              <Label htmlFor="ae-out">{t("staff.timesheets.detail.clockOut")}</Label>
              <Input id="ae-out" type="datetime-local" required value={draft.clockOut} onChange={(e) => setDraft({ ...draft, clockOut: e.target.value })} />
            </div>
            <div>
              <Label htmlFor="ae-venue">{t("staff.clock.venue")}</Label>
              <Select id="ae-venue" value={draft.venueId} onChange={(e) => setDraft({ ...draft, venueId: e.target.value })}>
                <option value="">{t("staff.clock.venueNone")}</option>
                {venues.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
              </Select>
            </div>
          </div>
          <div className="space-y-2">
            <div className="text-[11px] font-medium uppercase tracking-[0.12em] text-text-muted">{t("staff.clock.breaks")}</div>
            {draft.breaks.map((b, i) => (
              <div key={i} className="flex flex-wrap items-end gap-2">
                <div>
                  <Label htmlFor={`ae-bs-${i}`}>{t("staff.timesheets.detail.breakStart")}</Label>
                  <Input id={`ae-bs-${i}`} type="datetime-local" value={b.start} onChange={(e) => setBreak(i, "start", e.target.value)} />
                </div>
                <div>
                  <Label htmlFor={`ae-be-${i}`}>{t("staff.timesheets.detail.breakEnd")}</Label>
                  <Input id={`ae-be-${i}`} type="datetime-local" value={b.end} onChange={(e) => setBreak(i, "end", e.target.value)} />
                </div>
                <Button type="button" size="icon" variant="ghost" aria-label={t("staff.lessonPlans.removeDrill")}
                  onClick={() => setDraft({ ...draft, breaks: draft.breaks.filter((_, j) => j !== i) })}><X className="h-4 w-4" /></Button>
              </div>
            ))}
            <Button type="button" size="sm" variant="ghost" onClick={() => setDraft({ ...draft, breaks: [...draft.breaks, { start: draft.clockIn, end: draft.clockIn }] })}>
              <Plus className="h-4 w-4" /> {t("staff.timesheets.detail.addBreak")}
            </Button>
          </div>
          <div>
            <Label htmlFor="ae-reason">{t("staff.timesheets.detail.reason")}</Label>
            <Input id="ae-reason" required minLength={3} maxLength={500} value={draft.reason} onChange={(e) => setDraft({ ...draft, reason: e.target.value })} />
            <FieldHint>{t("staff.timesheets.detail.reasonHint")}</FieldHint>
          </div>
          <div className="flex gap-2">
            <Button type="submit" size="sm" loading={busy} disabled={busy}>{t("staff.timesheets.detail.save")}</Button>
            <Button type="button" size="sm" variant="secondary" onClick={() => setDraft(null)}>{t("staff.timesheets.detail.cancel")}</Button>
          </div>
        </form>
      )}
      {msg && msg.text && <p role={msg.ok ? "status" : "alert"} className={msg.ok ? "text-sm text-success" : "text-sm text-danger"}>{msg.text}</p>}

      {entries.length === 0 ? (
        <p className="text-sm text-text-muted">{t("staff.timesheets.detail.noEntries")}</p>
      ) : (
        <EntryList
          entries={entries}
          renderActions={locked ? undefined : (e) => (
            <div className="flex gap-1">
              <Button type="button" size="sm" variant="ghost" onClick={() => startEdit(e)} disabled={busy}><Pencil className="h-3.5 w-3.5" /> {t("staff.timesheets.detail.edit")}</Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => remove(e)} disabled={busy} aria-label={t("staff.timesheets.detail.delete")}><Trash2 className="h-3.5 w-3.5" /></Button>
            </div>
          )}
        />
      )}
    </div>
  );
}
