"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Lock } from "lucide-react";
import { Badge, Button, Card, CardBody } from "@/components/ui";
import { Label, Textarea } from "@/components/ui/input";
import { requestSessionAccess } from "@/lib/actions/team-attendance";
import { useT } from "@/lib/i18n/client";

type AccessState = { status: "pending" | "approved" | "rejected"; decisionNote: string | null } | null;

/**
 * Shown when a coach opens a session they cannot run (shared link, team
 * list): request access, then the pending / approved / rejected state.
 */
export function RequestAccessPanel({ eventId, access, cancelled }: { eventId: string; access: AccessState; cancelled: boolean }) {
  const t = useT();
  const router = useRouter();
  const [note, setNote] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [status, setStatus] = React.useState(access?.status ?? null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const r = await requestSessionAccess({ eventId, note: note.trim() || null }).catch(() => null);
    setBusy(false);
    if (!r) { setError(t("coachTrainings.access.networkFailed")); return; }
    if (!r.ok) { setError(r.error); return; }
    const s = (r.data as { status?: string } | undefined)?.status;
    setStatus(s === "approved" ? "approved" : "pending");
    router.refresh();
  }

  const canAsk = !cancelled && (status === null || status === "rejected");
  return (
    <Card>
      <CardBody className="space-y-4">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-brand-primary/25 bg-brand-primary-soft text-brand-primary" aria-hidden>
            <Lock className="h-5 w-5" />
          </span>
          <div>
            <h2 className="font-display text-lg text-text">{t("coachTrainings.access.title")}</h2>
            <p className="text-sm text-text-secondary">{t("coachTrainings.access.body")}</p>
          </div>
        </div>
        <div aria-live="polite">
          {status === "pending" && <Badge tone="warning" dot>{t("coachTrainings.access.pending")}</Badge>}
          {status === "approved" && <p className="text-sm text-text-secondary">{t("coachTrainings.access.approvedEnded")}</p>}
          {status === "rejected" && (
            <div className="space-y-1">
              <Badge tone="danger" dot>{t("coachTrainings.access.rejected")}</Badge>
              {access?.decisionNote && <p className="text-sm text-text-secondary">{t("coachTrainings.access.decisionNote", { note: access.decisionNote })}</p>}
            </div>
          )}
          {cancelled && <p className="text-sm text-text-secondary">{t("teamAttendance.errors.EVENT_CANCELLED")}</p>}
        </div>
        {canAsk && (
          <form onSubmit={submit} className="space-y-3">
            <div>
              <Label htmlFor="access-note">{t("coachTrainings.access.note")}</Label>
              <Textarea id="access-note" maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
            </div>
            {error && <p role="alert" className="text-sm text-danger">{error}</p>}
            <Button type="submit" size="lg" loading={busy}>
              {status === "rejected" ? t("coachTrainings.access.requestAgain") : t("coachTrainings.access.request")}
            </Button>
          </form>
        )}
      </CardBody>
    </Card>
  );
}
