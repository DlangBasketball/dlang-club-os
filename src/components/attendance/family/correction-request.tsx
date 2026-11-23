"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Button, Label, Select, Textarea, FieldHint } from "@/components/ui";
import { useT } from "@/lib/i18n/client";
import { requestAttendanceCorrection, withdrawCorrectionRequest } from "@/lib/actions/team-attendance";
import { FINAL_STATUSES, type FinalStatus } from "@/lib/attendance/types";

/** "Request a correction" form on the record page (guardian only; the server re-checks). */
export function CorrectionRequestForm({ eventId, athleteId, currentStatus }: { eventId: string; athleteId: string; currentStatus: string }) {
  const t = useT();
  const router = useRouter();
  const [pending, start] = React.useTransition();
  const [msg, setMsg] = React.useState<{ ok: boolean; text: string } | null>(null);
  const id = `correction-${eventId}-${athleteId}`;
  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        const form = e.currentTarget;
        const fd = new FormData(form);
        const requested = String(fd.get("requested") ?? "");
        setMsg(null);
        start(async () => {
          const res = await requestAttendanceCorrection({
            eventId, athleteId, message: String(fd.get("message") ?? ""),
            requestedStatus: (FINAL_STATUSES as readonly string[]).includes(requested) ? (requested as FinalStatus) : null,
          });
          setMsg(res.ok ? { ok: true, text: res.message ?? "" } : { ok: false, text: res.error });
          if (res.ok) {
            form.reset();
            router.refresh();
          }
        });
      }}
    >
      <div>
        <Label htmlFor={`${id}-message`}>{t("familyAttendance.correction.message")}</Label>
        <Textarea id={`${id}-message`} name="message" required minLength={1} maxLength={1000} aria-describedby={`${id}-hint`} />
        <FieldHint id={`${id}-hint`}>{t("familyAttendance.correction.messageHint")}</FieldHint>
      </div>
      <div>
        <Label htmlFor={`${id}-requested`}>{t("familyAttendance.correction.requested")}</Label>
        <Select id={`${id}-requested`} name="requested" defaultValue="">
          <option value="">{t("familyAttendance.correction.noPreference")}</option>
          {FINAL_STATUSES.filter((s) => s !== currentStatus).map((s) => (
            <option key={s} value={s}>{t(`teamAttendance.statuses.${s}`)}</option>
          ))}
        </Select>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={pending} aria-busy={pending}>{pending ? t("common.saving") : t("familyAttendance.correction.submit")}</Button>
        {msg && <p role={msg.ok ? "status" : "alert"} className={msg.ok ? "text-sm text-success" : "text-sm text-danger"}>{msg.text}</p>}
      </div>
    </form>
  );
}

/** Withdraw an open correction request (the requester's family only; server re-checks). */
export function WithdrawCorrectionButton({ requestId }: { requestId: string }) {
  const t = useT();
  const router = useRouter();
  const [pending, start] = React.useTransition();
  const [err, setErr] = React.useState<string | null>(null);
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <Button
        type="button" size="sm" variant="ghost" disabled={pending} aria-busy={pending}
        onClick={() => start(async () => {
          setErr(null);
          const res = await withdrawCorrectionRequest(requestId);
          if (res.ok) router.refresh();
          else setErr(res.error);
        })}
      >
        {t("familyAttendance.correction.withdraw")}
      </Button>
      {err && <span role="alert" className="text-xs text-danger">{err}</span>}
    </span>
  );
}
