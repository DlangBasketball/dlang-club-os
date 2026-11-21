"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Trash2, UserMinus, Archive, AlertTriangle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui";
import { useFormat, useT } from "@/lib/i18n/client";
import {
  confirmationMatches,
  formatAmounts,
  groupPlannedTables,
  impactLines,
  type DeleteImpact,
  type DeleteMode,
  type PersonKind,
} from "@/lib/people/person-delete";
import {
  deletePeopleBulk,
  deletePerson,
  erasePersonDeletionNow,
  previewPersonDelete,
  removeGuardianFromFamily,
  restorePersonDeletion,
} from "@/lib/actions/person-delete";

/** Modal shell (theme tokens only). Escape and backdrop close unless busy. */
export function PersonDialog({ title, busy, onClose, children }: { title: string; busy: boolean; onClose: () => void; children: React.ReactNode }) {
  const id = React.useId();
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !busy && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [busy, onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center" onClick={() => !busy && onClose()}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={id}
        className="max-h-[90vh] w-full max-w-lg space-y-4 overflow-y-auto rounded-t-2xl border border-border bg-surface p-5 text-left shadow-lg sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 id={id} className="font-display text-lg font-medium text-text">{title}</h3>
        {children}
      </div>
    </div>
  );
}

/** The summary list of a preview ("Removed from 2 teams", "1 unpaid invoice cancelled (CHF 300.00)" …). */
export function ImpactSummary({ impact, showDetails = true }: { impact: DeleteImpact; showDetails?: boolean }) {
  const t = useT();
  const f = useFormat();
  const lines = impactLines(impact);
  const groups = groupPlannedTables(impact.tables);
  return (
    <div className="space-y-3 text-sm">
      {lines.length === 0 ? (
        <p className="text-text-muted">{t("personDelete.impact.nothing")}</p>
      ) : (
        <ul className="list-disc space-y-1 ps-5 text-text">
          {lines.map((l) => (
            <li key={l.key}>
              {l.key === "invoicesCancelled"
                ? t("personDelete.impact.invoicesCancelled", { count: l.count, amount: formatAmounts(l.amounts, (a, c) => f.money(a, c)) })
                : t.dynamic(`personDelete.impact.${l.key}`, { count: l.count })}
            </li>
          ))}
        </ul>
      )}
      {showDetails && impact.records > 0 && (
        <details className="rounded-md border border-border p-3 text-text-muted">
          <summary className="cursor-pointer text-text">{t("personDelete.details", { count: impact.records })}</summary>
          <ul className="mt-2 space-y-0.5">
            {groups.map((g) => (
              <li key={g.group} className="flex justify-between gap-4">
                <span>{t.dynamic(`personDelete.groups.${g.group}`)}</span>
                <span className="tnum">{f.number(g.count)}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function ModeChoice({ mode, setMode, disabled }: { mode: DeleteMode; setMode: (m: DeleteMode) => void; disabled: boolean }) {
  const t = useT();
  const name = React.useId();
  const opt = (value: DeleteMode, label: string, help: string, Icon: typeof Archive) => (
    <label className={`flex cursor-pointer gap-3 rounded-md border p-3 ${mode === value ? "border-brand-primary bg-brand-primary-soft" : "border-border"}`}>
      <input type="radio" name={name} value={value} checked={mode === value} onChange={() => setMode(value)} disabled={disabled} className="mt-1" />
      <span className="space-y-0.5">
        <span className="flex items-center gap-1.5 font-medium text-text"><Icon className="h-4 w-4" aria-hidden /> {label}</span>
        <span className="block text-xs text-text-muted">{help}</span>
      </span>
    </label>
  );
  return (
    <fieldset className="space-y-2">
      <legend className="mb-1 text-sm font-medium text-text">{t("personDelete.modeLabel")}</legend>
      {opt("archive", t("personDelete.archive"), t("personDelete.archiveHelp"), Archive)}
      {opt("erase", t("personDelete.erase"), t("personDelete.eraseHelp"), Trash2)}
    </fieldset>
  );
}

function Feedback({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    <p role="alert" className="flex items-start gap-2 rounded-md border border-danger bg-danger-soft p-2 text-sm text-danger">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /> {error}
    </p>
  );
}

/**
 * Delete a player or a family from any page. Loads the impact preview,
 * offers archive (restorable 30 days) or a permanent delete (typed name),
 * then refreshes or navigates away. Render only for admins: the server
 * refuses everyone else anyway.
 */
export function DeletePersonButton({
  kind,
  id,
  name,
  redirectTo,
  variant = "button",
  label,
}: {
  kind: PersonKind;
  id: string;
  name: string;
  /** Where to go after a successful delete (the current page usually no longer exists). */
  redirectTo?: string;
  variant?: "button" | "icon" | "ghost";
  label?: string;
}) {
  const t = useT();
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [impact, setImpact] = React.useState<DeleteImpact | null>(null);
  const [mode, setMode] = React.useState<DeleteMode>("archive");
  const [typed, setTyped] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    setImpact(null);
    setError(null);
    const r = await previewPersonDelete(kind, id);
    if (r.ok && r.data) setImpact(r.data);
    else if (!r.ok) setError(r.error);
  }, [kind, id]);

  const openDialog = () => {
    setOpen(true);
    setMode("archive");
    setTyped("");
    void load();
  };

  const canSubmit = !busy && !!impact && (mode === "archive" || confirmationMatches(typed, name));

  const submit = async () => {
    setBusy(true);
    setError(null);
    const r = await deletePerson({ kind, id, mode, confirmName: mode === "erase" ? typed : undefined });
    setBusy(false);
    if (!r.ok) return setError(r.error);
    setOpen(false);
    if (redirectTo) router.push(redirectTo);
    router.refresh();
  };

  const text = label ?? t("personDelete.button");
  return (
    <>
      {variant === "icon" ? (
        <Button type="button" size="icon" variant="ghost" onClick={openDialog} aria-label={t("personDelete.buttonAria", { name })} title={t("personDelete.buttonAria", { name })}>
          <Trash2 className="h-4 w-4" />
        </Button>
      ) : (
        <Button type="button" size="sm" variant={variant === "ghost" ? "ghost" : "danger"} onClick={openDialog} aria-label={t("personDelete.buttonAria", { name })}>
          <Trash2 className="h-4 w-4" /> {text}
        </Button>
      )}
      {open && (
        <PersonDialog title={t("personDelete.title", { name })} busy={busy} onClose={() => setOpen(false)}>
          <p className="text-sm text-text-muted">{t("personDelete.intro", { name })}</p>
          {!impact && !error && (
            <p className="flex items-center gap-2 text-sm text-text-muted"><Loader2 className="h-4 w-4 animate-spin" aria-hidden /> {t("personDelete.loading")}</p>
          )}
          {impact && <ImpactSummary impact={impact} />}
          {impact && <ModeChoice mode={mode} setMode={setMode} disabled={busy} />}
          {impact && mode === "erase" && (
            <label className="block space-y-1 text-sm">
              <span className="text-text">{t("personDelete.typeToConfirm", { name })}</span>
              <input
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                autoComplete="off"
                className="h-10 w-full rounded border border-border bg-bg px-3 text-text focus-visible:shadow-focus focus-visible:outline-none"
              />
            </label>
          )}
          {impact && mode === "archive" && <p className="text-xs text-text-muted">{t("personDelete.restoreNote")}</p>}
          <Feedback error={error} />
          <div className="flex flex-wrap justify-end gap-2">
            <Button type="button" variant="secondary" size="sm" onClick={() => setOpen(false)} disabled={busy}>{t("common.cancel")}</Button>
            <Button type="button" variant="danger" size="sm" onClick={submit} disabled={!canSubmit} aria-busy={busy}>
              {busy ? t("personDelete.working") : mode === "erase" ? t("personDelete.confirmErase") : t("personDelete.confirmArchive")}
            </Button>
          </div>
        </PersonDialog>
      )}
    </>
  );
}

/** Unlink one guardian from a family (admin). */
export function RemoveGuardianButton({ familyId, profileId, name }: { familyId: string; profileId: string; name: string }) {
  const t = useT();
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const submit = async () => {
    setBusy(true);
    setError(null);
    const r = await removeGuardianFromFamily({ familyId, profileId });
    setBusy(false);
    if (!r.ok) return setError(r.error);
    setOpen(false);
    router.refresh();
  };
  return (
    <>
      <Button type="button" size="sm" variant="ghost" onClick={() => { setOpen(true); setError(null); }} aria-label={t("personDelete.guardian.aria", { name })}>
        <UserMinus className="h-4 w-4" /> {t("personDelete.guardian.button")}
      </Button>
      {open && (
        <PersonDialog title={t("personDelete.guardian.title", { name })} busy={busy} onClose={() => setOpen(false)}>
          <p className="text-sm text-text-muted">{t("personDelete.guardian.body", { name })}</p>
          <Feedback error={error} />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" size="sm" onClick={() => setOpen(false)} disabled={busy}>{t("common.cancel")}</Button>
            <Button type="button" variant="danger" size="sm" onClick={submit} disabled={busy} aria-busy={busy}>
              {busy ? t("personDelete.working") : t("personDelete.guardian.confirm")}
            </Button>
          </div>
        </PersonDialog>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Bulk selection: <BulkSelect kind> wraps a list, <BulkCheckbox id name> goes
// in each row, <BulkSelectAll ids> in the header, <BulkDeleteBar> above.
// ---------------------------------------------------------------------------
type BulkCtx = { kind: PersonKind; selected: Set<string>; toggle: (id: string, on: boolean) => void; setAll: (ids: string[], on: boolean) => void; clear: () => void };
const BulkContext = React.createContext<BulkCtx | null>(null);

export function BulkSelect({ kind, children }: { kind: PersonKind; children: React.ReactNode }) {
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const value = React.useMemo<BulkCtx>(() => ({
    kind,
    selected,
    toggle: (id, on) => setSelected((s) => { const n = new Set(s); if (on) n.add(id); else n.delete(id); return n; }),
    setAll: (ids, on) => setSelected((s) => { const n = new Set(s); for (const id of ids) { if (on) n.add(id); else n.delete(id); } return n; }),
    clear: () => setSelected(new Set()),
  }), [kind, selected]);
  return <BulkContext.Provider value={value}>{children}</BulkContext.Provider>;
}

export function BulkCheckbox({ id, name }: { id: string; name: string }) {
  const t = useT();
  const ctx = React.useContext(BulkContext);
  if (!ctx) return null;
  return (
    <input type="checkbox" className="h-4 w-4" checked={ctx.selected.has(id)} onChange={(e) => ctx.toggle(id, e.target.checked)} aria-label={t("personDelete.bulk.select", { name })} />
  );
}

export function BulkSelectAll({ ids }: { ids: string[] }) {
  const t = useT();
  const ctx = React.useContext(BulkContext);
  if (!ctx || !ids.length) return null;
  const all = ids.every((id) => ctx.selected.has(id));
  return <input type="checkbox" className="h-4 w-4" checked={all} onChange={(e) => ctx.setAll(ids, e.target.checked)} aria-label={t("personDelete.bulk.selectAll")} />;
}

export function BulkDeleteBar({ allIds = [] }: { allIds?: string[] }) {
  const t = useT();
  const router = useRouter();
  const ctx = React.useContext(BulkContext);
  const [open, setOpen] = React.useState(false);
  const [mode, setMode] = React.useState<DeleteMode>("archive");
  const [typed, setTyped] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [message, setMessage] = React.useState<string | null>(null);
  if (!ctx) return null;
  const count = ctx.selected.size;
  const word = t("personDelete.bulk.confirmWord");
  const canSubmit = !busy && count > 0 && (mode === "archive" || confirmationMatches(typed, word));

  const submit = async () => {
    setBusy(true);
    setError(null);
    const r = await deletePeopleBulk({ kind: ctx.kind, ids: Array.from(ctx.selected), mode, confirmWord: mode === "erase" ? typed : undefined });
    setBusy(false);
    if (!r.ok) return setError(r.error);
    setMessage(r.message ?? null);
    setOpen(false);
    ctx.clear();
    router.refresh();
  };

  return (
    <div className="mb-3 flex min-h-10 flex-wrap items-center gap-3" aria-live="polite">
      {allIds.length > 0 && (
        <label className="flex items-center gap-2 text-sm text-text-muted">
          <BulkSelectAll ids={allIds} /> {t("personDelete.bulk.selectAll")}
        </label>
      )}
      {count > 0 && (
        <>
          <span className="text-sm text-text">{t("personDelete.bulk.selected", { count })}</span>
          <Button type="button" size="sm" variant="danger" onClick={() => { setOpen(true); setMode("archive"); setTyped(""); setError(null); }}>
            <Trash2 className="h-4 w-4" /> {t("personDelete.bulk.delete")}
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={ctx.clear}>{t("personDelete.bulk.clear")}</Button>
        </>
      )}
      {message && count === 0 && <span className="text-sm text-text-muted">{message}</span>}
      {open && (
        <PersonDialog title={t("personDelete.bulk.title", { count })} busy={busy} onClose={() => setOpen(false)}>
          <p className="text-sm text-text-muted">{t("personDelete.bulk.intro")}</p>
          <ModeChoice mode={mode} setMode={setMode} disabled={busy} />
          {mode === "erase" && (
            <label className="block space-y-1 text-sm">
              <span className="text-text">{t("personDelete.bulk.typeWord", { word })}</span>
              <input value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off"
                className="h-10 w-full rounded border border-border bg-bg px-3 text-text focus-visible:shadow-focus focus-visible:outline-none" />
            </label>
          )}
          {mode === "archive" && <p className="text-xs text-text-muted">{t("personDelete.restoreNote")}</p>}
          <Feedback error={error} />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" size="sm" onClick={() => setOpen(false)} disabled={busy}>{t("common.cancel")}</Button>
            <Button type="button" variant="danger" size="sm" onClick={submit} disabled={!canSubmit} aria-busy={busy}>
              {busy ? t("personDelete.working") : mode === "erase" ? t("personDelete.confirmErase") : t("personDelete.confirmArchive")}
            </Button>
          </div>
        </PersonDialog>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Recently deleted: restore / delete now
// ---------------------------------------------------------------------------
export function DeletionRowActions({ deletionId, restorable }: { deletionId: string; restorable: boolean }) {
  const t = useT();
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [typed, setTyped] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const word = t("personDelete.bulk.confirmWord");
  if (!restorable) return null;

  const restore = async () => {
    setBusy(true);
    setError(null);
    const r = await restorePersonDeletion(deletionId);
    setBusy(false);
    if (!r.ok) return setError(r.error);
    router.refresh();
  };
  const eraseNow = async () => {
    setBusy(true);
    setError(null);
    const r = await erasePersonDeletionNow(deletionId, typed);
    setBusy(false);
    if (!r.ok) return setError(r.error);
    setOpen(false);
    router.refresh();
  };
  return (
    <div className="flex flex-wrap justify-end gap-2">
      <Button type="button" size="sm" variant="secondary" onClick={restore} disabled={busy} aria-busy={busy}>{t("personDelete.deleted.restore")}</Button>
      <Button type="button" size="sm" variant="ghost" onClick={() => { setOpen(true); setTyped(""); setError(null); }} disabled={busy}>
        <Trash2 className="h-4 w-4" /> {t("personDelete.deleted.deleteNow")}
      </Button>
      {!open && <Feedback error={error} />}
      {open && (
        <PersonDialog title={t("personDelete.deleted.deleteNowTitle")} busy={busy} onClose={() => setOpen(false)}>
          <p className="text-sm text-text-muted">{t("personDelete.deleted.deleteNowBody")}</p>
          <label className="block space-y-1 text-sm">
            <span className="text-text">{t("personDelete.bulk.typeWord", { word })}</span>
            <input value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off"
              className="h-10 w-full rounded border border-border bg-bg px-3 text-text focus-visible:shadow-focus focus-visible:outline-none" />
          </label>
          <Feedback error={error} />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" size="sm" onClick={() => setOpen(false)} disabled={busy}>{t("common.cancel")}</Button>
            <Button type="button" variant="danger" size="sm" onClick={eraseNow} disabled={busy || !confirmationMatches(typed, word)} aria-busy={busy}>
              {busy ? t("personDelete.working") : t("personDelete.confirmErase")}
            </Button>
          </div>
        </PersonDialog>
      )}
    </div>
  );
}
