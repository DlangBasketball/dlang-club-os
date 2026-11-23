"use client";
import * as React from "react";
import { Search, X } from "lucide-react";
import { Badge, Button, FieldHint, Input, Label } from "@/components/ui";
import { checkDuplicates, quickCreateAthlete } from "@/lib/actions/booking-workflow";
import { searchBookingFamilies, type FamilyHit } from "@/lib/actions/admin-booking";
import type { QuickAthleteFields, RequestIds } from "@/lib/booking/admin-form";
import { isMinor } from "@/lib/booking/helpers";
import type { DuplicateAthlete, QuickCreateInput } from "@/lib/booking/types";
import { useFormat, useT } from "@/lib/i18n/client";

/**
 * "Add New Athlete" from the booking form: a dialog over the form, so the
 * booking keeps every field (the panel's own fields live in the form draft
 * too). Duplicate check first (people_duplicate_check): a match can be picked
 * instead of creating a new record. A minor needs a guardian: an existing
 * family (search) or a new guardian contact. Never enrols the athlete.
 */
export function QuickAthleteDialog({ open, value, onChange, onClose, onDone, requestIds, todayKey }: {
  open: boolean; value: QuickAthleteFields; requestIds: RequestIds; todayKey: string;
  onChange: (patch: Partial<QuickAthleteFields>) => void; onClose: () => void;
  onDone: (athlete: { id: string; label: string; familyId: string | null }) => void;
}) {
  const t = useT();
  const f = useFormat();
  const id = React.useId();
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);
  const [matches, setMatches] = React.useState<DuplicateAthlete[] | null>(null);
  const [famQ, setFamQ] = React.useState("");
  const [famHits, setFamHits] = React.useState<FamilyHit[]>([]);

  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !busy) onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, busy, onClose]);

  React.useEffect(() => {
    const term = famQ.trim();
    if (term.length < 2) { setFamHits([]); return; }
    const h = window.setTimeout(async () => {
      const res = await searchBookingFamilies(term);
      setFamHits(res.ok ? res.data ?? [] : []);
    }, 250);
    return () => window.clearTimeout(h);
  }, [famQ]);

  if (!open) return null;
  const v = value;
  const minor = /^\d{4}-\d{2}-\d{2}$/.test(v.dob) ? isMinor(v.dob, todayKey) : false;
  const set = (patch: Partial<QuickAthleteFields>) => { setErr(null); setMatches(null); onChange(patch); };

  function payload(confirmDuplicate: boolean): QuickCreateInput {
    const useFamily = v.guardianMode === "existing" && v.familyId;
    const newGuardian = v.guardianMode === "new" && v.guardianName.trim();
    return {
      firstName: v.firstName, lastName: v.lastName, dob: v.dob, email: v.email, phone: v.phone || null,
      familyId: useFamily ? v.familyId : null,
      newFamily: newGuardian ? {
        contactName: v.guardianName, contactEmail: v.guardianEmail, contactPhone: v.guardianPhone || null,
        street: v.guardianStreet || null, postalCode: v.guardianPostalCode || null, city: v.guardianCity || null,
      } : null,
      confirmDuplicate,
    };
  }

  async function create(confirmDuplicate: boolean) {
    setBusy(true); setErr(null);
    try {
      if (!confirmDuplicate && matches === null) {
        // 1) duplicate check (name incl. accents / case, date of birth, guardian e-mail)
        const dup = await checkDuplicates({ firstName: v.firstName, lastName: v.lastName, dob: v.dob, email: v.guardianEmail || v.email || undefined });
        if (dup.ok && dup.data && dup.data.athletes.length > 0) { setMatches(dup.data.athletes); return; }
      }
      // 2) create (one request id for this intent: a retry or double click replays)
      const res = await quickCreateAthlete(payload(confirmDuplicate || (matches?.length ?? 0) > 0), requestIds.get("athlete"));
      if (!res.ok) { setErr(res.error); return; }
      const d = res.data!;
      if (!d.ok) { setMatches(d.candidates); return; }
      requestIds.settle("athlete");
      onDone({ id: d.athlete_id, label: `${v.firstName.trim()} ${v.lastName.trim()}`, familyId: d.family_id });
    } finally {
      setBusy(false);
    }
  }

  const canSubmit = v.firstName.trim() && v.lastName.trim() && v.dob &&
    (!minor || (v.guardianMode === "existing" ? Boolean(v.familyId) : Boolean(v.guardianName.trim() && (v.guardianEmail.trim() || v.guardianPhone.trim()))));

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center" onClick={() => !busy && onClose()}>
      <div role="dialog" aria-modal="true" aria-labelledby={`${id}-title`} onClick={(e) => e.stopPropagation()}
        className="max-h-[92vh] w-full max-w-xl overflow-y-auto rounded-t-2xl border border-line bg-surface-card p-5 sm:rounded-2xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 id={`${id}-title`} className="font-semibold text-ink">{t("adminBooking.quick.title")}</h3>
            <p className="mt-1 text-sm text-ink-2">{t("adminBooking.quick.description")}</p>
          </div>
          <button type="button" onClick={onClose} disabled={busy} aria-label={t("common.close")} className="text-ink-3 hover:text-ink"><X className="h-5 w-5" /></button>
        </div>

        <form className="mt-4 space-y-4" onSubmit={(e) => { e.preventDefault(); if (canSubmit) void create(false); }}>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div><Label htmlFor={`${id}-fn`}>{t("adminBooking.quick.firstName")}</Label><Input id={`${id}-fn`} required maxLength={80} value={v.firstName} onChange={(e) => set({ firstName: e.target.value })} autoFocus /></div>
            <div><Label htmlFor={`${id}-ln`}>{t("adminBooking.quick.lastName")}</Label><Input id={`${id}-ln`} required maxLength={80} value={v.lastName} onChange={(e) => set({ lastName: e.target.value })} /></div>
            <div>
              <Label htmlFor={`${id}-dob`}>{t("adminBooking.quick.dob")}</Label>
              <Input id={`${id}-dob`} type="date" required max={todayKey} value={v.dob} onChange={(e) => set({ dob: e.target.value })} />
              {minor && <FieldHint>{t("adminBooking.quick.minorHint")}</FieldHint>}
            </div>
            <div><Label htmlFor={`${id}-em`}>{t("adminBooking.quick.email")}</Label><Input id={`${id}-em`} type="email" maxLength={254} value={v.email} onChange={(e) => set({ email: e.target.value })} /></div>
            <div><Label htmlFor={`${id}-ph`}>{t("adminBooking.quick.phone")}</Label><Input id={`${id}-ph`} type="tel" maxLength={40} value={v.phone} onChange={(e) => set({ phone: e.target.value })} /></div>
          </div>

          <fieldset className="space-y-3 rounded-lg border border-line p-3">
            <legend className="px-1 text-sm font-medium text-ink">{minor ? t("adminBooking.quick.guardianRequired") : t("adminBooking.quick.guardianOptional")}</legend>
            <div className="flex flex-wrap gap-4 text-sm">
              <label className="flex items-center gap-2 text-ink-2"><input type="radio" className="accent-[var(--red-primary)]" checked={v.guardianMode === "existing"} onChange={() => set({ guardianMode: "existing" })} /> {t("adminBooking.quick.existingFamily")}</label>
              <label className="flex items-center gap-2 text-ink-2"><input type="radio" className="accent-[var(--red-primary)]" checked={v.guardianMode === "new"} onChange={() => set({ guardianMode: "new" })} /> {t("adminBooking.quick.newGuardian")}</label>
            </div>
            {v.guardianMode === "existing" ? (
              v.familyId ? (
                <div className="flex items-center justify-between gap-2 rounded border border-line px-3 py-2 text-sm">
                  <span className="text-ink">{v.familyLabel}</span>
                  <button type="button" className="text-ink-3 hover:text-ink" aria-label={t("adminBooking.quick.changeFamily")} onClick={() => set({ familyId: "", familyLabel: "" })}><X className="h-4 w-4" /></button>
                </div>
              ) : (
                <div>
                  <Label htmlFor={`${id}-fam`}>{t("adminBooking.quick.familySearch")}</Label>
                  <div className="relative">
                    <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-ink-3" aria-hidden />
                    <Input id={`${id}-fam`} className="pl-9" value={famQ} autoComplete="off" placeholder={t("adminBooking.quick.familyPlaceholder")} onChange={(e) => setFamQ(e.target.value)} />
                  </div>
                  {famHits.length > 0 && (
                    <ul className="mt-1 max-h-48 overflow-auto rounded border border-line">
                      {famHits.map((h) => (
                        <li key={h.id}>
                          <button type="button" className="flex w-full justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-surface-elevated"
                            onClick={() => { set({ familyId: h.id, familyLabel: [h.name, h.contactName].filter(Boolean).join(" · ") }); setFamQ(""); setFamHits([]); }}>
                            <span className="text-ink">{h.name}</span><span className="truncate text-xs text-ink-3">{[h.contactName, h.contactEmail].filter(Boolean).join(" · ")}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                  {famQ.trim().length >= 2 && famHits.length === 0 && <FieldHint>{t("adminBooking.quick.noFamily")}</FieldHint>}
                </div>
              )
            ) : (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="sm:col-span-2"><Label htmlFor={`${id}-gn`}>{t("adminBooking.quick.guardianName")}</Label><Input id={`${id}-gn`} maxLength={140} value={v.guardianName} onChange={(e) => set({ guardianName: e.target.value })} /></div>
                <div><Label htmlFor={`${id}-ge`}>{t("adminBooking.quick.email")}</Label><Input id={`${id}-ge`} type="email" maxLength={254} value={v.guardianEmail} onChange={(e) => set({ guardianEmail: e.target.value })} /></div>
                <div><Label htmlFor={`${id}-gp`}>{t("adminBooking.quick.phone")}</Label><Input id={`${id}-gp`} type="tel" maxLength={40} value={v.guardianPhone} onChange={(e) => set({ guardianPhone: e.target.value })} /></div>
                <div className="sm:col-span-2"><Label htmlFor={`${id}-gs`}>{t("adminBooking.quick.street")}</Label><Input id={`${id}-gs`} maxLength={140} value={v.guardianStreet} onChange={(e) => set({ guardianStreet: e.target.value })} /></div>
                <div><Label htmlFor={`${id}-gz`}>{t("adminBooking.quick.postalCode")}</Label><Input id={`${id}-gz`} maxLength={12} value={v.guardianPostalCode} onChange={(e) => set({ guardianPostalCode: e.target.value })} /></div>
                <div><Label htmlFor={`${id}-gc`}>{t("adminBooking.quick.city")}</Label><Input id={`${id}-gc`} maxLength={80} value={v.guardianCity} onChange={(e) => set({ guardianCity: e.target.value })} /></div>
                <p className="text-xs text-ink-3 sm:col-span-2">{t("adminBooking.quick.noLoginHint")}</p>
              </div>
            )}
          </fieldset>

          {matches && matches.length > 0 && (
            <div role="alert" className="space-y-2 rounded-lg border border-warning/40 bg-warning-soft p-3">
              <p className="text-sm font-medium text-warning">{t("adminBooking.quick.duplicatesTitle")}</p>
              <ul className="space-y-1">
                {matches.map((m) => (
                  <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 rounded border border-line bg-surface-card px-3 py-2 text-sm">
                    <span className="min-w-0">
                      <span className="text-ink">{m.first_name} {m.last_name}</span>{" "}
                      <span className="text-xs text-ink-3">{[m.dob ? f.date(m.dob) : null, m.family_name].filter(Boolean).join(" · ")}</span>{" "}
                      <Badge tone="neutral">{t.dynamic(`adminBooking.quick.reason.${m.reason}`, undefined, m.reason)}</Badge>
                      {m.archived && <Badge tone="warning">{t("adminBooking.quick.archived")}</Badge>}
                    </span>
                    {!m.archived && (
                      <Button type="button" size="sm" variant="secondary" onClick={() => onDone({ id: m.id, label: `${m.first_name} ${m.last_name}`, familyId: m.family_id })}>
                        {t("adminBooking.quick.useExisting")}
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
              <Button type="button" size="sm" variant="ghost" disabled={busy || !canSubmit} onClick={() => void create(true)}>{t("adminBooking.quick.createAnyway")}</Button>
            </div>
          )}

          <p className="text-xs text-ink-3">{t("adminBooking.quick.noEnrolHint")}</p>
          {err && <p role="alert" className="text-sm text-danger">{err}</p>}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="ghost" disabled={busy} onClick={onClose}>{t("adminBooking.quick.back")}</Button>
            <Button type="submit" disabled={busy || !canSubmit}>{busy ? t("common.saving") : t("adminBooking.quick.create")}</Button>
          </div>
        </form>
      </div>
    </div>
  );
}
