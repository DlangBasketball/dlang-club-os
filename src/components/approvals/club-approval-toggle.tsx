"use client";
import * as React from "react";
import { Button } from "@/components/ui";
import { useCaAction } from "@/components/club-admin/use-ca-action";
import { setProgramClubApproval } from "@/lib/actions/club-approval";
import { useT } from "@/lib/i18n/client";

/** Admin: does a family request for this programme wait for the club's approval? */
export function ClubApprovalToggle({ programId, value }: { programId: string; value: boolean }) {
  const t = useT();
  const { busy, run, note } = useCaAction();
  return (
    <div className="space-y-2">
      <p className="text-sm text-text-secondary">{t(value ? "approvals.program.on" : "approvals.program.off")}</p>
      <div className="flex flex-wrap items-center gap-3">
        <Button size="sm" variant="secondary" loading={busy} onClick={() => run(() => setProgramClubApproval(programId, !value))}>
          {t(value ? "approvals.program.turnOff" : "approvals.program.turnOn")}
        </Button>
        {note}
      </div>
    </div>
  );
}
