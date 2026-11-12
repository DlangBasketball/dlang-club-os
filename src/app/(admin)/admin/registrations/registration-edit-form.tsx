"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Button, Label, Select, Textarea } from "@/components/ui";
import { useT } from "@/lib/i18n/client";
import { updateRegistration } from "@/lib/actions/registration";
import { REGISTRATION_STATUSES, type RegistrationStatus } from "@/lib/people/validation";

/** Admin editor: programme, status, internal notes, cancellation / withdrawal reason. */
export function RegistrationEditForm({
  id,
  initial,
  programs,
}: {
  id: string;
  initial: { programId: string; status: string; notes: string | null; cancellationReason: string | null };
  programs: { id: string; label: string }[];
}) {
  const t = useT();
  const router = useRouter();
  const [programId, setProgramId] = React.useState(initial.programId);
  const [status, setStatus] = React.useState<RegistrationStatus>(
    (REGISTRATION_STATUSES as readonly string[]).includes(initial.status) ? (initial.status as RegistrationStatus) : "pending",
  );
  const [notes, setNotes] = React.useState(initial.notes ?? "");
  const [reason, setReason] = React.useState(initial.cancellationReason ?? "");
  const [pending, setPending] = React.useState(false);
  const [msg, setMsg] = React.useState<{ ok: boolean; text: string } | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setMsg(null);
    const res = await updateRegistration(id, { programId, status, notes, cancellationReason: status === "cancelled" ? reason : null });
    setPending(false);
    if (res.ok) {
      setMsg({ ok: true, text: res.message ?? t("editPeople.saved") });
      router.refresh();
    } else setMsg({ ok: false, text: res.error });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="r-program">{t("editPeople.registrations.program")}</Label>
          <Select id="r-program" value={programId} onChange={(e) => setProgramId(e.target.value)}>
            {programs.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
          </Select>
        </div>
        <div>
          <Label htmlFor="r-status">{t("editPeople.registrations.status")}</Label>
          <Select id="r-status" value={status} onChange={(e) => setStatus(e.target.value as RegistrationStatus)}>
            {REGISTRATION_STATUSES.map((s) => <option key={s} value={s}>{t(`status.${s}`)}</option>)}
          </Select>
        </div>
      </div>
      {status === "cancelled" && (
        <div>
          <Label htmlFor="r-reason">{t("editPeople.registrations.cancellationReason")}</Label>
          <Textarea id="r-reason" rows={2} maxLength={1000} value={reason} onChange={(e) => setReason(e.target.value)} required />
          <p className="mt-1 text-xs text-ink-3">{t("editPeople.registrations.statusCancelHint")}</p>
        </div>
      )}
      <div>
        <Label htmlFor="r-notes">{t("editPeople.registrations.notes")}</Label>
        <Textarea id="r-notes" rows={3} maxLength={2000} value={notes} onChange={(e) => setNotes(e.target.value)} />
        <p className="mt-1 text-xs text-ink-3">{t("editPeople.registrations.notesHint")}</p>
      </div>
      <p className="text-xs text-ink-3">{t("editPeople.registrations.priceNote")}</p>
      {msg && <p role="status" className={msg.ok ? "text-sm text-success" : "text-sm text-danger"}>{msg.text}</p>}
      <Button type="submit" loading={pending} disabled={status === "cancelled" && reason.trim().length < 3}>
        {pending ? t("editPeople.saving") : t("editPeople.saveChanges")}
      </Button>
    </form>
  );
}
