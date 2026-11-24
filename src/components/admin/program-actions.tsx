"use client";
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, Archive, ArchiveRestore, ExternalLink, Eye, EyeOff, Loader2, Trash2 } from "lucide-react";
import { Badge, Button } from "@/components/ui";
import { PersonDialog } from "@/components/people/delete-person";
import { archiveProgram, deleteProgram, previewProgramDelete, restoreProgram, setProgramStatus } from "@/lib/actions/programs";
import type { ProgramStatus } from "@/lib/club-ops/validation";
import { useFormat, useT } from "@/lib/i18n/client";
import { confirmationMatches } from "@/lib/people/person-delete";
import { programImpactLines, upcomingSessionHref, type ProgramImpact, type UpcomingSession } from "@/lib/programs/program-delete";

const TONE = { draft: "warning", published: "success", archived: "neutral" } as const;

function ErrorLine({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    <p role="alert" className="flex items-start gap-2 rounded-md border border-danger bg-danger-soft p-2 text-sm text-danger">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /> {error}
    </p>
  );
}

function StatusBadge({ status }: { status: ProgramStatus }) {
  const t = useT();
  return <Badge tone={TONE[status]}>{t.dynamic(`editOps.programs.statuses.${status}`, undefined, status)}</Badge>;
}

function SessionLine({ programId, s }: { programId: string; s: UpcomingSession }) {
  const t = useT();
  const f = useFormat();
  const when = s.allDay ? f.dateRange(s.startsAt, s.endsAt ?? s.startsAt) : f.dateTime(s.startsAt);
  const title = s.title
    ?? (s.eventType ? t.dynamic(`staff.calendar.eventTypes.${s.eventType}`, undefined, s.eventType) : t.dynamic(`programDelete.sessionKinds.${s.kind}`));
  const href = upcomingSessionHref(programId, s);
  return (
    <li className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
      <span><span className="tnum text-text-muted">{when}</span> · <span className="text-text">{title}</span></span>
      {href && (
        <Link href={href} className="inline-flex items-center gap-1 text-xs text-brand-primary hover:underline" target="_blank" rel="noopener"
          aria-label={t("programDelete.reviewSessionAria", { title, when })}>
          <ExternalLink className="h-3 w-3" aria-hidden /> {s.kind === "event" ? t("programDelete.reviewOrCancel") : t("programDelete.review")}
        </Link>
      )}
    </li>
  );
}

/** Linked records, upcoming sessions and current enrolments of the preview. */
function ImpactDetails({ impact }: { impact: ProgramImpact }) {
  const t = useT();
  const lines = programImpactLines(impact);
  const moreSessions = impact.upcomingTotal - impact.upcomingSessions.length;
  const moreEnrol = impact.currentEnrollmentsTotal - impact.currentEnrollments.length;
  return (
    <div className="space-y-3 text-sm">
      {lines.length === 0 ? (
        <p className="text-text-muted">{t("programDelete.nothingLinked")}</p>
      ) : (
        <div className="space-y-1">
          <p className="font-medium text-text">{t("programDelete.linkedTitle")}</p>
          <ul className="list-disc space-y-0.5 ps-5 text-text">
            {lines.map((l) => <li key={l.key}>{t.dynamic(`programDelete.categories.${l.key}`, { count: l.count })}</li>)}
          </ul>
        </div>
      )}
      {impact.upcomingSessions.length > 0 && (
        <div className="space-y-1">
          <p className="font-medium text-text">{t("programDelete.upcomingTitle", { count: impact.upcomingTotal })}</p>
          <p className="text-xs text-text-muted">{t("programDelete.upcomingHelp")}</p>
          <ul className="space-y-1">
            {impact.upcomingSessions.map((s) => <SessionLine key={`${s.kind}-${s.id}`} programId={impact.programId} s={s} />)}
          </ul>
          {moreSessions > 0 && <p className="text-xs text-text-muted">{t("programDelete.andMore", { count: moreSessions })}</p>}
        </div>
      )}
      {impact.currentEnrollments.length > 0 && (
        <div className="space-y-1">
          <p className="font-medium text-text">{t("programDelete.enrollmentsTitle", { count: impact.currentEnrollmentsTotal })}</p>
          <ul className="space-y-0.5">
            {impact.currentEnrollments.map((e) => (
              <li key={`${e.kind}-${e.id}`} className="flex justify-between gap-3">
                <span className="text-text">{e.childName || t("programDelete.unnamedChild")}</span>
                <span className="text-text-muted">
                  {e.kind === "application"
                    ? t.dynamic(`selection.statuses.${e.status}`, undefined, e.status)
                    : t.dynamic(`status.${e.status}`, undefined, e.status)}
                </span>
              </li>
            ))}
          </ul>
          {moreEnrol > 0 && <p className="text-xs text-text-muted">{t("programDelete.andMore", { count: moreEnrol })}</p>}
        </div>
      )}
    </div>
  );
}

/**
 * Delete a programme: preview of linked records (server-side), then either a
 * permanent delete (nothing linked, typed name) or — when anything is linked —
 * the reason and "Archive programme" as a separate, explicit action. Nothing is
 * removed optimistically: the list only changes after the server confirms.
 * Render for admins only; the server refuses everyone else.
 */
export function ProgramDeleteButton({ programId, name, status, variant = "button", redirectTo }: {
  programId: string; name: string; status: ProgramStatus; variant?: "button" | "icon"; redirectTo?: string;
}) {
  const t = useT();
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [impact, setImpact] = React.useState<ProgramImpact | null>(null);
  const [typed, setTyped] = React.useState("");
  const [busy, setBusy] = React.useState<null | "delete" | "archive">(null);
  const [error, setError] = React.useState<string | null>(null);
  const confirmId = React.useId();

  const openDialog = async () => {
    setOpen(true); setImpact(null); setTyped(""); setError(null);
    const r = await previewProgramDelete(programId);
    if (r.ok) setImpact(r.impact);
    else setError(r.error);
  };

  const remove = async () => {
    setBusy("delete"); setError(null);
    const r = await deleteProgram(programId);
    setBusy(null);
    if (!r.ok) return setError(r.error);
    if (!r.deleted) { setImpact(r.impact); setError(r.error); return; }
    setOpen(false);
    if (redirectTo) router.push(redirectTo);
    router.refresh();
  };

  const archive = async () => {
    setBusy("archive"); setError(null);
    const r = await archiveProgram(programId);
    setBusy(null);
    if (!r.ok) return setError(r.error);
    setOpen(false);
    router.refresh();
  };

  const currentStatus = impact?.status ?? status;
  const canDelete = !!impact && impact.canDelete && confirmationMatches(typed, name);

  return (
    <>
      {variant === "icon" ? (
        <Button type="button" size="icon" variant="ghost" onClick={openDialog} aria-label={t("programDelete.buttonAria", { name })} title={t("programDelete.buttonAria", { name })}>
          <Trash2 className="h-4 w-4" />
        </Button>
      ) : (
        <Button type="button" size="sm" variant="danger" onClick={openDialog} aria-label={t("programDelete.buttonAria", { name })}>
          <Trash2 className="h-4 w-4" /> {t("programDelete.button")}
        </Button>
      )}
      {open && (
        <PersonDialog title={t("programDelete.title", { name })} busy={busy !== null} onClose={() => setOpen(false)}>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-text-muted">{t("programDelete.currentStatus")}</span>
            <StatusBadge status={currentStatus} />
          </div>
          {!impact && !error && (
            <p className="flex items-center gap-2 text-sm text-text-muted"><Loader2 className="h-4 w-4 animate-spin" aria-hidden /> {t("programDelete.loading")}</p>
          )}
          {impact && <ImpactDetails impact={impact} />}
          {impact && !impact.canDelete && (
            <div className="space-y-1 rounded-md border border-warning/30 bg-warning-soft p-3 text-sm">
              <p className="font-medium text-warning">{t("programDelete.blockedTitle")}</p>
              <p className="text-text">{impact.status === "archived" ? t("programDelete.blockedArchived") : t("programDelete.blockedHelp")}</p>
            </div>
          )}
          {impact && impact.canDelete && (
            <label htmlFor={confirmId} className="block space-y-1 text-sm">
              <span className="text-text">{t("programDelete.typeToConfirm", { name })}</span>
              <input
                id={confirmId}
                className="h-10 w-full rounded-md border border-border bg-surface-input px-3 text-text"
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                autoComplete="off"
                spellCheck={false}
              />
              <span className="block text-xs text-text-muted">{t("programDelete.permanentHelp")}</span>
            </label>
          )}
          <ErrorLine error={error} />
          <div className="flex flex-wrap justify-end gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)} disabled={busy !== null}>{t("common.cancel")}</Button>
            {impact && !impact.canDelete && impact.status !== "archived" && (
              <Button type="button" size="sm" variant="primary" onClick={archive} disabled={busy !== null} loading={busy === "archive"}>
                <Archive className="h-4 w-4" /> {t("programDelete.archiveInstead")}
              </Button>
            )}
            {impact && impact.canDelete && (
              <Button type="button" size="sm" variant="danger" onClick={remove} disabled={!canDelete || busy !== null} loading={busy === "delete"}>
                <Trash2 className="h-4 w-4" /> {t("programDelete.confirmDelete")}
              </Button>
            )}
          </div>
        </PersonDialog>
      )}
    </>
  );
}

/** Archive with a confirmation dialog (nothing linked is removed or cancelled). */
function ProgramArchiveButton({ programId, name }: { programId: string; name: string }) {
  const t = useT();
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const archive = async () => {
    setBusy(true); setError(null);
    const r = await archiveProgram(programId);
    setBusy(false);
    if (!r.ok) return setError(r.error);
    setOpen(false);
    router.refresh();
  };
  return (
    <>
      <Button size="sm" variant="secondary" onClick={() => { setOpen(true); setError(null); }}><Archive className="h-4 w-4" /> {t("editOps.programs.archive")}</Button>
      {open && (
        <PersonDialog title={t("programDelete.archiveTitle", { name })} busy={busy} onClose={() => setOpen(false)}>
          <p className="text-sm text-text">{t("programDelete.archiveHelp")}</p>
          <ErrorLine error={error} />
          <div className="flex flex-wrap justify-end gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)} disabled={busy}>{t("common.cancel")}</Button>
            <Button type="button" size="sm" variant="primary" onClick={archive} loading={busy} disabled={busy}><Archive className="h-4 w-4" /> {t("programDelete.confirmArchive")}</Button>
          </div>
        </PersonDialog>
      )}
    </>
  );
}

/** Put an archived programme back (its status before archiving, or draft). */
export function ProgramRestoreButton({ programId, name }: { programId: string; name: string }) {
  const t = useT();
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const restore = async () => {
    setBusy(true); setError(null);
    const r = await restoreProgram(programId);
    setBusy(false);
    if (!r.ok) return setError(r.error);
    router.refresh();
  };
  return (
    <span className="inline-flex flex-col items-end gap-1">
      <Button type="button" size="sm" variant="secondary" onClick={restore} loading={busy} disabled={busy} aria-label={t("programDelete.restoreAria", { name })}>
        <ArchiveRestore className="h-4 w-4" /> {t("programDelete.restore")}
      </Button>
      {error && <span role="alert" className="text-xs text-danger">{error}</span>}
    </span>
  );
}

/** Detail page: publish / unpublish, archive, restore, delete. */
export function ProgramActions({ programId, name, status }: { programId: string; name: string; status: ProgramStatus }) {
  const t = useT();
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function change(next: "published" | "draft") {
    setBusy(true); setError(null);
    const res = await setProgramStatus(programId, next);
    setBusy(false);
    if (!res.ok) setError(res.error);
    else router.refresh();
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge status={status} />
        {status === "draft" && <Button size="sm" variant="secondary" disabled={busy} onClick={() => change("published")}><Eye className="h-4 w-4" /> {t("editOps.programs.publish")}</Button>}
        {status === "published" && <Button size="sm" variant="secondary" disabled={busy} onClick={() => change("draft")}><EyeOff className="h-4 w-4" /> {t("editOps.programs.unpublish")}</Button>}
        {status !== "archived" && <ProgramArchiveButton programId={programId} name={name} />}
        {status === "archived" && <ProgramRestoreButton programId={programId} name={name} />}
        <ProgramDeleteButton programId={programId} name={name} status={status} redirectTo="/admin/programs" />
      </div>
      {status === "archived" && <p className="text-xs text-text-muted">{t("programDelete.archivedNote")}</p>}
      <ErrorLine error={error} />
    </div>
  );
}
