"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui";
import { acknowledgeAbsence } from "@/lib/actions/team-attendance";
import { useT } from "@/lib/i18n/client";

/** Staff acknowledge a reported absence ("seen"). */
export function AcknowledgeAbsenceButton({ reportId, name }: { reportId: string; name: string }) {
  const t = useT();
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  async function go() {
    setBusy(true);
    setError(null);
    const r = await acknowledgeAbsence(reportId).catch(() => null);
    setBusy(false);
    if (!r) { setError(t("coachTrainings.common.networkFailed")); return; }
    if (!r.ok) { setError(r.error); return; }
    router.refresh();
  }
  return (
    <span className="inline-flex flex-col items-end gap-1">
      <Button type="button" variant="secondary" size="sm" onClick={go} loading={busy}
              aria-label={t("coachTrainings.absence.acknowledgeNamed", { name })}>
        {t("coachTrainings.absence.acknowledge")}
      </Button>
      {error && <span role="alert" className="text-xs text-danger">{error}</span>}
    </span>
  );
}
