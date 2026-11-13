"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, RotateCcw, SearchCheck } from "lucide-react";
import { Button } from "@/components/ui";
import { useT } from "@/lib/i18n/client";
import { flagMissedClockOuts, setTimesheet } from "@/lib/actions/staff-time";

/** Approve / reopen one employee's timesheet for a period (admin). */
export function TimesheetApproval({
  profileId, from, to, approved, disabled,
}: { profileId: string; from: string; to: string; approved: boolean; disabled?: boolean }) {
  const t = useT();
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);
  async function run() {
    setBusy(true);
    setErr(null);
    const res = await setTimesheet({ profileId, from, to, approve: !approved, note: null });
    setBusy(false);
    if (res.ok) router.refresh();
    else setErr(res.error);
  }
  return (
    <div className="flex flex-col items-end gap-1">
      <Button type="button" size="sm" variant={approved ? "secondary" : "success"} loading={busy} disabled={busy || disabled} onClick={run}>
        {approved ? <RotateCcw className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}
        {approved ? t("staff.timesheets.reopen") : t("staff.timesheets.approve")}
      </Button>
      {err && <span role="alert" className="max-w-[220px] text-right text-xs text-danger">{err}</span>}
    </div>
  );
}

/** Flag shifts left open too long as missed clock-outs (admin). */
export function MissedCheckButton() {
  const t = useT();
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  const [msg, setMsg] = React.useState<{ ok: boolean; text: string } | null>(null);
  async function run() {
    setBusy(true);
    const res = await flagMissedClockOuts();
    setBusy(false);
    setMsg(res.ok ? { ok: true, text: res.message ?? "" } : { ok: false, text: res.error });
    if (res.ok) router.refresh();
  }
  return (
    <span className="inline-flex items-center gap-2">
      <Button type="button" size="sm" variant="secondary" loading={busy} disabled={busy} onClick={run}>
        <SearchCheck className="h-4 w-4" /> {t("staff.timesheets.detectMissed")}
      </Button>
      {msg && <span role={msg.ok ? "status" : "alert"} className={msg.ok ? "text-xs text-success" : "text-xs text-danger"}>{msg.text}</span>}
    </span>
  );
}
