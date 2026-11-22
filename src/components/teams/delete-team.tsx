"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Archive, Loader2, RotateCcw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui";
import { PersonDialog } from "@/components/people/delete-person";
import { useT } from "@/lib/i18n/client";
import { confirmationMatches } from "@/lib/people/person-delete";
import { teamImpactLines, type TeamDeleteMode, type TeamImpact } from "@/lib/teams/team-delete";
import { deleteTeam, previewTeamDelete, restoreTeam } from "@/lib/actions/team-delete";

function Feedback({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    <p role="alert" className="flex items-start gap-2 rounded-md border border-danger bg-danger-soft p-2 text-sm text-danger">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /> {error}
    </p>
  );
}

/** What archiving / deleting the team touches (counts from preview_delete_team). */
export function TeamImpactSummary({ impact }: { impact: TeamImpact }) {
  const t = useT();
  const lines = teamImpactLines(impact);
  return (
    <div className="space-y-2 text-sm">
      {lines.length === 0 ? (
        <p className="text-text-muted">{t("teamAdmin.delete.impact.nothing")}</p>
      ) : (
        <ul className="list-disc space-y-1 ps-5 text-text">
          {lines.map((l) => <li key={l.key}>{t.dynamic(`teamAdmin.delete.impact.${l.key}`, { count: l.count })}</li>)}
        </ul>
      )}
      {impact.divisions.length > 0 && (
        <p className="text-xs text-text-muted">
          {t("teamAdmin.delete.divisionsList", { list: impact.divisions.map((d) => `${d.programName} · ${d.name}`).join(", ") })}
        </p>
      )}
    </div>
  );
}

/**
 * Archive (default, restorable) or permanently delete a team, after a
 * preview of what it touches. A permanent delete needs the typed team name
 * and is offered only when nothing blocks it (past games and results, team
 * messages, kit in use: archive keeps those). Render for admins only; the
 * server refuses everyone else.
 */
export function DeleteTeamButton({ teamId, name, variant = "button", redirectTo }: {
  teamId: string; name: string; variant?: "button" | "icon"; redirectTo?: string;
}) {
  const t = useT();
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [impact, setImpact] = React.useState<TeamImpact | null>(null);
  const [mode, setMode] = React.useState<TeamDeleteMode>("archive");
  const [typed, setTyped] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const radio = React.useId();

  const openDialog = async () => {
    setOpen(true); setMode("archive"); setTyped(""); setImpact(null); setError(null);
    const r = await previewTeamDelete(teamId);
    if (r.ok && r.data) setImpact(r.data);
    else if (!r.ok) setError(r.error);
  };

  const canSubmit = !busy && !!impact && (mode === "archive" ? impact.isActive : impact.canDelete && confirmationMatches(typed, name));

  const submit = async () => {
    setBusy(true); setError(null);
    const r = await deleteTeam({ teamId, mode, confirmName: mode === "delete" ? typed : undefined });
    setBusy(false);
    if (!r.ok) return setError(r.error);
    setOpen(false);
    if (redirectTo && mode === "delete") router.push(redirectTo);
    router.refresh();
  };

  const opt = (value: TeamDeleteMode, label: string, help: string, Icon: typeof Archive, disabled: boolean) => (
    <label className={`flex gap-3 rounded-md border p-3 ${disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer"} ${mode === value ? "border-brand-primary bg-brand-primary-soft" : "border-border"}`}>
      <input type="radio" name={radio} value={value} checked={mode === value} onChange={() => setMode(value)} disabled={busy || disabled} className="mt-1" />
      <span className="space-y-0.5">
        <span className="flex items-center gap-1.5 font-medium text-text"><Icon className="h-4 w-4" aria-hidden /> {label}</span>
        <span className="block text-xs text-text-muted">{help}</span>
      </span>
    </label>
  );

  return (
    <>
      {variant === "icon" ? (
        <Button type="button" size="icon" variant="ghost" onClick={openDialog} aria-label={t("teamAdmin.delete.buttonAria", { name })} title={t("teamAdmin.delete.buttonAria", { name })}>
          <Trash2 className="h-4 w-4" />
        </Button>
      ) : (
        <Button type="button" size="sm" variant="danger" onClick={openDialog} aria-label={t("teamAdmin.delete.buttonAria", { name })}>
          <Trash2 className="h-4 w-4" /> {t("teamAdmin.delete.button")}
        </Button>
      )}
      {open && (
        <PersonDialog title={t("teamAdmin.delete.title", { name })} busy={busy} onClose={() => setOpen(false)}>
          <p className="text-sm text-text-muted">{t("teamAdmin.delete.intro")}</p>
          {!impact && !error && (
            <p className="flex items-center gap-2 text-sm text-text-muted"><Loader2 className="h-4 w-4 animate-spin" aria-hidden /> {t("teamAdmin.delete.loading")}</p>
          )}
          {impact && <TeamImpactSummary impact={impact} />}
          {impact && (
            <fieldset className="space-y-2">
              <legend className="mb-1 text-sm font-medium text-text">{t("teamAdmin.delete.modeLabel")}</legend>
              {opt("archive", t("teamAdmin.delete.archive"), impact.isActive ? t("teamAdmin.delete.archiveHelp") : t("teamAdmin.delete.alreadyArchived"), Archive, !impact.isActive)}
              {opt("delete", t("teamAdmin.delete.delete"), impact.canDelete ? t("teamAdmin.delete.deleteHelp") : t("teamAdmin.delete.deleteBlocked"), Trash2, !impact.canDelete)}
            </fieldset>
          )}
          {impact && !impact.canDelete && (
            <ul className="list-disc space-y-0.5 ps-5 text-xs text-text-muted">
              {impact.blockers.map((b) => <li key={b}>{t.dynamic(`teamAdmin.delete.blockers.${b}`)}</li>)}
            </ul>
          )}
          {impact && mode === "delete" && impact.canDelete && (
            <label className="block space-y-1 text-sm">
              <span className="text-text">{t("teamAdmin.delete.typeToConfirm", { name })}</span>
              <input
                className="h-10 w-full rounded-md border border-border bg-surface-input px-3 text-text"
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                autoComplete="off"
                spellCheck={false}
                aria-label={t("teamAdmin.delete.typeToConfirm", { name })}
              />
            </label>
          )}
          <Feedback error={error} />
          <div className="flex flex-wrap justify-end gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)} disabled={busy}>{t("common.cancel")}</Button>
            <Button type="button" size="sm" variant={mode === "delete" ? "danger" : "primary"} onClick={submit} disabled={!canSubmit} loading={busy}>
              {mode === "delete" ? t("teamAdmin.delete.confirmDelete") : t("teamAdmin.delete.confirmArchive")}
            </Button>
          </div>
        </PersonDialog>
      )}
    </>
  );
}

/** Put an archived team back (Teams page with "Include inactive"). */
export function RestoreTeamButton({ teamId, name }: { teamId: string; name: string }) {
  const t = useT();
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const restore = async () => {
    setBusy(true); setError(null);
    const r = await restoreTeam(teamId);
    setBusy(false);
    if (!r.ok) return setError(r.error);
    router.refresh();
  };
  return (
    <span className="inline-flex items-center gap-2">
      <Button type="button" size="sm" variant="secondary" onClick={restore} loading={busy} disabled={busy} aria-label={t("teamAdmin.delete.restoreAria", { name })}>
        <RotateCcw className="h-3.5 w-3.5" /> {t("teamAdmin.delete.restore")}
      </Button>
      {error && <span role="alert" className="text-xs text-danger">{error}</span>}
    </span>
  );
}
