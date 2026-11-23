"use client";
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle2, Info, RotateCcw } from "lucide-react";
import { Badge, Button, Card, CardBody, CardHeader, CardTitle, FieldHint, Input, Label } from "@/components/ui";
import { Select, Textarea } from "@/components/teams/fields";
import { confirmBooking, quoteBooking, savePayer } from "@/lib/actions/booking-workflow";
import { getBookingPayerCandidates, listOpenSessions, type OpenSession } from "@/lib/actions/admin-booking";
import {
  RequestIds, clearDraft, emptyBookingForm, formToPayload, isDirty, loadDraft, quoteKey, resolvePayer, saveDraft, withAthlete, withService,
  type BookingFormState, type PayerCandidates, type QuickAthleteFields,
} from "@/lib/booking/admin-form";
import type { CatalogService } from "@/lib/booking/data";
import type { CoachOption, SpaceOption } from "@/lib/booking/admin-data";
import { quoteSummary } from "@/lib/booking/helpers";
import { BILLING_CHOICES, type BookingQuote } from "@/lib/booking/types";
import { useFormat, useT } from "@/lib/i18n/client";
import { AthleteCombobox } from "./athlete-combobox";
import { QuickAthleteDialog } from "./quick-athlete-dialog";
import { PayerPicker } from "./payer-picker";

/** Refusals after which the slot list / quote is stale: re-read them, keep the form. */
const SLOT_REFUSALS = new Set(["SESSION_FULL", "COACH_BUSY", "SPACE_TAKEN", "SESSION_NOT_SCHEDULED", "ALREADY_BOOKED", "ATHLETE_OVERLAP", "COACH_UNAVAILABLE"]);

/**
 * Admin New Booking form on the booking workflow contract
 * (docs/booking-workflow.md): live booking_quote, confirm with one request
 * id per form open, draft kept in sessionStorage (restored on return).
 */
export function NewBookingForm({ services, coaches, spaces, isAdmin, scope, todayKey, initialAthlete }: {
  services: CatalogService[]; coaches: CoachOption[]; spaces: SpaceOption[]; isAdmin: boolean;
  /** Draft scope (the club): a draft never opens in another club. */
  scope: string; todayKey: string; initialAthlete?: { id: string; label: string; familyId: string } | null;
}) {
  const t = useT();
  const f = useFormat();
  const router = useRouter();
  const ids = React.useRef(new RequestIds()).current;
  const [s, setS] = React.useState<BookingFormState>(() => emptyBookingForm({ date: todayKey }));
  const [restored, setRestored] = React.useState(false);
  const [hydrated, setHydrated] = React.useState(false);
  const [candidates, setCandidates] = React.useState<PayerCandidates | null>(null);
  const [candLoading, setCandLoading] = React.useState(false);
  const [sessions, setSessions] = React.useState<OpenSession[]>([]);
  const [quote, setQuote] = React.useState<BookingQuote | null>(null);
  const [quoteErr, setQuoteErr] = React.useState<string | null>(null);
  const [quoting, setQuoting] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState<{ text: string; code?: string } | null>(null);

  // --- draft: restore once on mount, then save on every change -------------
  React.useEffect(() => {
    const store = typeof window !== "undefined" ? window.sessionStorage : null;
    const draft = loadDraft(store, scope);
    if (initialAthlete) {
      // Opened for one athlete (?athlete=): keep a draft of the same athlete, or an athlete-less draft.
      const base = draft && (!draft.athleteId || draft.athleteId === initialAthlete.id) && isDirty(draft) ? draft : null;
      setS((cur) => withAthlete(base ?? cur, initialAthlete.id, initialAthlete.label, initialAthlete.familyId));
      if (base) setRestored(true);
    } else if (draft && isDirty(draft)) {
      setS(draft);
      setRestored(true);
    }
    setHydrated(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const submitted = React.useRef(false);
  React.useEffect(() => {
    if (!hydrated) return;
    const h = window.setTimeout(() => { if (!submitted.current) saveDraft(window.sessionStorage, scope, s); }, 200);
    return () => window.clearTimeout(h);
  }, [s, hydrated, scope]);

  const set = <K extends keyof BookingFormState>(k: K, v: BookingFormState[K]) => { setErr(null); setS((x) => ({ ...x, [k]: v })); };
  const service = services.find((x) => x.id === s.serviceId) ?? null;
  const eligible = service ? coaches.filter((c) => service.coaches.some((e) => e.id === c.id)) : [];
  const others = service ? coaches.filter((c) => !service.coaches.some((e) => e.id === c.id)) : [];
  const isGroup = service?.kind === "group";

  // --- payer candidates of the athlete -------------------------------------
  React.useEffect(() => {
    if (!s.athleteId) { setCandidates(null); return; }
    let live = true;
    setCandLoading(true);
    getBookingPayerCandidates(s.athleteId).then((res) => {
      if (!live) return;
      setCandLoading(false);
      setCandidates(res.ok ? res.data ?? null : null);
    });
    return () => { live = false; };
  }, [s.athleteId]);

  // --- open sessions of a group service ------------------------------------
  const loadSessions = React.useCallback(async (serviceId: string) => {
    const res = await listOpenSessions(serviceId);
    setSessions(res.ok ? res.data ?? [] : []);
  }, []);
  React.useEffect(() => {
    if (service && isGroup) void loadSessions(service.id); else setSessions([]);
  }, [service, isGroup, loadSessions]);

  // --- live quote ------------------------------------------------------------
  const resolved = resolvePayer(s.payer, candidates, s.athleteId ? { id: s.athleteId, name: s.athleteLabel, familyId: s.athleteFamilyId || null } : null, s.newPayer);
  // Quote with the payer that exists now (a payer still to create is quoted as the family default).
  const quotePayerId = resolved.kind === "ready" ? resolved.payerId : null;
  const payload = formToPayload(s, f.timeZone, quotePayerId);
  const key = quoteKey(payload);
  const quoteSeq = React.useRef(0);
  const runQuote = React.useCallback(async () => {
    if (!payload) { setQuote(null); setQuoteErr(null); return; }
    const n = ++quoteSeq.current;
    setQuoting(true);
    const res = await quoteBooking(payload);
    if (n !== quoteSeq.current) return;
    setQuoting(false);
    if (res.ok) { setQuote(res.data ?? null); setQuoteErr(null); } else { setQuote(null); setQuoteErr(res.error); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  React.useEffect(() => {
    if (!hydrated) return;
    const h = window.setTimeout(() => void runQuote(), 350);
    return () => window.clearTimeout(h);
  }, [runQuote, hydrated]);

  const summary = quote ? quoteSummary(quote) : null;
  const needsOverride = Boolean(summary?.needsOverride);
  const overrideOk = !s.overrideAvailability || s.overrideReason.trim().length > 0;
  const priceOk = !s.priceOverride || (s.price.trim() !== "" && Number(s.price) >= 0 && s.priceReason.trim().length > 0);
  const payerOk = resolved.kind !== "invalid";
  const canConfirm = Boolean(payload && quote && (summary?.canConfirm || (needsOverride && s.overrideAvailability && isAdmin)) && overrideOk && priceOk && payerOk && !quoting);

  async function confirm() {
    if (!canConfirm || busy) return;
    setBusy(true); setErr(null);
    try {
      // 1) a payer to create first (guardian without a record, the athlete, a new payer) — idempotent per form.
      let payerId: string | null = resolved.kind === "ready" ? resolved.payerId : null;
      if (resolved.kind === "create") {
        const pr = await savePayer(resolved.payer, ids.get("payer"));
        if (!pr.ok) { setErr({ text: pr.error, code: pr.code }); return; }
        ids.settle("payer");
        payerId = pr.data!.payer_id;
        // Keep the created payer selected: a retry of the booking reuses it instead of creating another.
        setS((x) => ({ ...x, payer: { type: "payer", payerId: payerId! } }));
        const c = await getBookingPayerCandidates(s.athleteId);
        if (c.ok) setCandidates(c.data ?? null);
      }
      const body = formToPayload(s, f.timeZone, payerId);
      if (!body) return;
      // 2) confirm with the one request id of this form (double click / retry -> replay, never a second booking).
      const res = await confirmBooking(body, ids.get("confirm"));
      if (!res.ok) {
        setErr({ text: res.error, code: res.code });
        if (res.code && SLOT_REFUSALS.has(res.code)) {
          if (service && isGroup) void loadSessions(service.id);
          void runQuote();
        }
        return;
      }
      ids.settle("confirm");
      submitted.current = true;
      clearDraft(window.sessionStorage);
      router.push(`/admin/bookings/${res.data!.booking_id}?created=1`);
    } finally {
      setBusy(false);
    }
  }

  function startOver() {
    clearDraft(window.sessionStorage);
    setS(emptyBookingForm({ date: todayKey }));
    setRestored(false); setQuote(null); setErr(null);
  }

  const money = (n: number | null | undefined, cur?: string) => (n === null || n === undefined ? "—" : f.money(n, cur ?? service?.currency ?? undefined));
  const slotSessions = sessions.filter((x) => x.placesLeft > 0);

  return (
    <div className="space-y-5">
      {restored && (
        <div role="status" className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-info/30 bg-info-soft px-4 py-2.5 text-sm text-info">
          <span className="flex items-center gap-2"><Info className="h-4 w-4" /> {t("adminBooking.form.draftRestored")}</span>
          <Button type="button" size="sm" variant="ghost" onClick={startOver}><RotateCcw className="h-3.5 w-3.5" /> {t("adminBooking.form.startOver")}</Button>
        </div>
      )}

      <form onSubmit={(e) => { e.preventDefault(); void confirm(); }} className="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_340px]">
        <div className="space-y-5">
          <Card><CardBody className="space-y-4">
            <AthleteCombobox value={s.athleteId} label={s.athleteLabel} disabled={busy}
              onSelect={(a) => { setErr(null); setS((x) => a ? withAthlete(x, a.id, `${a.firstName} ${a.lastName}`, a.familyId) : { ...x, athleteId: "", athleteLabel: "", athleteFamilyId: "", payer: { type: "family" } }); }}
              onAddNew={() => set("quickOpen", true)} />

            <div>
              <Label htmlFor="nb-service">{t("adminBooking.form.service")}</Label>
              <Select id="nb-service" value={s.serviceId} disabled={busy}
                onChange={(e) => { const svc = services.find((x) => x.id === e.target.value); setErr(null); setS((x) => withService(x, e.target.value, { coachIds: svc?.coaches.map((c) => c.id) ?? [], venueSpaceId: svc?.default_venue_space_id ?? null })); }}>
                <option value="">{t("adminBooking.form.chooseService")}</option>
                {services.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
              </Select>
              {service && (
                <div className="mt-2 flex flex-wrap gap-1.5 text-xs">
                  <Badge tone="neutral">{t.dynamic(`adminBooking.kind.${service.kind}`, undefined, service.kind)}</Badge>
                  <Badge tone="neutral">{t("adminBooking.form.duration", { count: service.duration_min })}</Badge>
                  <Badge tone="accent">{money(service.price, service.currency)}</Badge>
                  {isGroup && <Badge tone="neutral">{t("adminBooking.form.capacity", { count: service.max_participants })}</Badge>}
                  {(service.default_venue_space_name || service.venue_name || service.location_text) && (
                    <Badge tone="neutral">{[service.venue_name, service.default_venue_space_name].filter(Boolean).join(" · ") || service.location_text}</Badge>
                  )}
                  {service.setup_missing.length > 0 && <Badge tone="warning">{t("adminBooking.form.setupMissing")}</Badge>}
                </div>
              )}
            </div>

            {service && isGroup && (
              <fieldset className="space-y-2">
                <legend className="mb-1.5 block text-[11px] font-medium uppercase tracking-[0.12em] text-text-muted">{t("adminBooking.form.session")}</legend>
                <div className="flex flex-wrap gap-4 text-sm">
                  <label className="flex items-center gap-2 text-ink-2"><input type="radio" className="accent-[var(--red-primary)]" checked={s.slotMode === "new"} onChange={() => set("slotMode", "new")} /> {t("adminBooking.form.newSession")}</label>
                  <label className="flex items-center gap-2 text-ink-2"><input type="radio" className="accent-[var(--red-primary)]" checked={s.slotMode === "join"} onChange={() => set("slotMode", "join")} disabled={slotSessions.length === 0} /> {t("adminBooking.form.joinSession", { count: slotSessions.length })}</label>
                </div>
                {s.slotMode === "join" && (
                  <div className="space-y-1.5">
                    {sessions.map((x) => (
                      <label key={x.id} className={`flex cursor-pointer items-center justify-between gap-3 rounded-lg border px-3 py-2 text-sm ${s.sessionId === x.id ? "border-maroon bg-maroon/10" : "border-line"} ${x.placesLeft === 0 ? "opacity-50" : ""}`}>
                        <span className="flex items-center gap-2">
                          <input type="radio" className="accent-[var(--red-primary)]" disabled={x.placesLeft === 0} checked={s.sessionId === x.id} onChange={() => set("sessionId", x.id)} />
                          <span className="text-ink">{f.date(x.startsAt, { weekday: true })} · {f.time(x.startsAt)}–{f.time(x.endsAt)}</span>
                        </span>
                        <span className="text-xs text-ink-3">{[x.coachName, x.spaceName, t("adminBooking.form.placesLeft", { count: x.placesLeft, capacity: x.capacity })].filter(Boolean).join(" · ")}</span>
                      </label>
                    ))}
                  </div>
                )}
              </fieldset>
            )}

            {(!isGroup || s.slotMode === "new") && (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <Label htmlFor="nb-coach">{t("adminBooking.form.coach")}</Label>
                  <Select id="nb-coach" value={s.coachId} disabled={busy || !service} onChange={(e) => set("coachId", e.target.value)}>
                    <option value="">{t("adminBooking.form.chooseCoach")}</option>
                    {eligible.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                    {isAdmin && others.length > 0 && (
                      <optgroup label={t("adminBooking.form.otherCoaches")}>
                        {others.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                      </optgroup>
                    )}
                  </Select>
                  {service && eligible.length === 0 && <FieldHint>{t("adminBooking.form.noEligibleCoach")}</FieldHint>}
                </div>
                <div>
                  <Label htmlFor="nb-space">{t("adminBooking.form.facility")}</Label>
                  <Select id="nb-space" value={s.venueSpaceId} disabled={busy} onChange={(e) => set("venueSpaceId", e.target.value)}>
                    <option value="">{t("adminBooking.form.noSpace")}</option>
                    {spaces.map((sp) => <option key={sp.id} value={sp.id}>{sp.venueName ? `${sp.venueName} · ${sp.name}` : sp.name}</option>)}
                  </Select>
                </div>
                <div><Label htmlFor="nb-date">{t("adminBooking.form.date")}</Label><Input id="nb-date" type="date" required value={s.date} disabled={busy} onChange={(e) => set("date", e.target.value)} /></div>
                <div>
                  <Label htmlFor="nb-time">{t("adminBooking.form.time")}</Label>
                  <Input id="nb-time" type="time" required step={300} value={s.time} disabled={busy} onChange={(e) => set("time", e.target.value)} />
                  <FieldHint>{t("adminBooking.form.timeZone", { zone: f.timeZone })}</FieldHint>
                </div>
              </div>
            )}
          </CardBody></Card>

          <Card><CardBody className="space-y-4">
            <PayerPicker candidates={candidates} loading={candLoading} disabled={busy}
              athlete={s.athleteId ? { id: s.athleteId, name: s.athleteLabel } : null}
              value={s.payer} fields={s.newPayer}
              onChange={(c) => set("payer", c)} onFields={(patch) => setS((x) => ({ ...x, newPayer: { ...x.newPayer, ...patch } }))} />
            {resolved.kind === "invalid" && <p role="alert" className="text-sm text-danger">{t.dynamic(`bookingWorkflow.errors.${resolved.reason}`)}</p>}

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="nb-billing">{t("adminBooking.form.billing")}</Label>
                <Select id="nb-billing" value={s.billing} disabled={busy} onChange={(e) => set("billing", e.target.value as BookingFormState["billing"])}>
                  {BILLING_CHOICES.map((b) => <option key={b} value={b}>{t.dynamic(`adminBooking.billingChoice.${b}`, undefined, b)}</option>)}
                </Select>
              </div>
              <label className="flex items-center gap-2 pt-6 text-sm text-ink-2">
                <input type="checkbox" className="h-4 w-4 accent-[var(--red-primary)]" checked={s.priceOverride} disabled={busy} onChange={(e) => set("priceOverride", e.target.checked)} />
                {t("adminBooking.form.overridePrice")}
              </label>
              {s.priceOverride && <>
                <div><Label htmlFor="nb-price">{t("adminBooking.form.price", { currency: quote?.billing.currency ?? service?.currency ?? f.currency })}</Label>
                  <Input id="nb-price" type="number" min={0} step="0.05" inputMode="decimal" value={s.price} disabled={busy} onChange={(e) => set("price", e.target.value)} /></div>
                <div><Label htmlFor="nb-price-r">{t("adminBooking.form.priceReason")}</Label>
                  <Input id="nb-price-r" maxLength={500} required value={s.priceReason} disabled={busy} onChange={(e) => set("priceReason", e.target.value)} /></div>
              </>}
            </div>

            <div><Label htmlFor="nb-notes">{t("adminBooking.form.notes")}</Label><Textarea id="nb-notes" maxLength={2000} value={s.notes} disabled={busy} onChange={(e) => set("notes", e.target.value)} /></div>
            <label className="flex items-center gap-2 text-sm text-ink-2">
              <input type="checkbox" className="h-4 w-4 accent-[var(--red-primary)]" checked={s.notify} disabled={busy} onChange={(e) => set("notify", e.target.checked)} />
              {t("adminBooking.form.notify")}
            </label>
          </CardBody></Card>
        </div>

        {/* Quote + confirm: sticky beside the form on desktop, below it on mobile */}
        <div className="space-y-4 lg:sticky lg:top-4 lg:self-start">
          <Card>
            <CardHeader><CardTitle>{t("adminBooking.quote.title")}</CardTitle>{quoting && <span className="text-xs text-ink-3">{t("adminBooking.quote.checking")}</span>}</CardHeader>
            <CardBody className="space-y-3 text-sm">
              {!payload && <p className="text-ink-3">{t("adminBooking.quote.incomplete")}</p>}
              {payload && quoteErr && <p role="alert" className="text-danger">{quoteErr}</p>}
              {payload && quote && (
                <>
                  <Row label={t("adminBooking.quote.price")} value={<span className="tnum font-medium">{money(quote.billing.price, quote.billing.currency)}</span>} />
                  {quote.billing.price_override && <Row label={t("adminBooking.quote.listPrice")} value={<span className="tnum line-through">{money(quote.billing.list_price, quote.billing.currency)}</span>} />}
                  <Row label={t("adminBooking.quote.billing")} value={t.dynamic(`bookingWorkflow.billingStatus.${quote.billing.billing_status}`, undefined, quote.billing.billing_status)} />
                  {quote.billing.billing_mode === "package" && quote.billing.package_remaining !== null && (
                    <Row label={t("adminBooking.quote.package")} value={t("adminBooking.quote.packageLeft", { count: quote.billing.package_remaining })} />
                  )}
                  {quote.slot.capacity !== null && quote.slot.capacity > 1 && (
                    <Row label={t("adminBooking.quote.places")} value={t("adminBooking.form.placesLeft", { count: quote.slot.places_left ?? 0, capacity: quote.slot.capacity })} />
                  )}
                  {quote.payer?.name && <Row label={t("adminBooking.form.billTo")} value={quote.payer.name} />}
                  {quote.billing_entity && <Row label={t("adminBooking.quote.entity")} value={quote.billing_entity.name} />}
                  {quote.number_prefix && <Row label={t("adminBooking.quote.prefix")} value={<span className="font-mono">{quote.number_prefix}</span>} />}

                  {quote.errors.length > 0 && (
                    <ul role="alert" className="space-y-1 rounded border border-danger/30 bg-danger-soft p-2 text-danger">
                      {quote.errors.map((e) => <li key={e} className="flex gap-2"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />{t.dynamic(`bookingWorkflow.errors.${e}`, undefined, t("bookingWorkflow.errors.generic"))}</li>)}
                    </ul>
                  )}
                  {quote.warnings.length > 0 && (
                    <ul className="space-y-1 rounded border border-warning/30 bg-warning-soft p-2 text-warning">
                      {quote.warnings.map((w, i) => <li key={`${w.code}-${i}`} className="flex gap-2"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />{t.dynamic(`bookingWorkflow.warnings.${w.code}`, undefined, w.code)}</li>)}
                    </ul>
                  )}
                  {quote.billing.setup_missing.length > 0 && (
                    <div className="space-y-1 rounded border border-warning/30 bg-warning-soft p-2 text-warning">
                      <p className="font-medium">{t("adminBooking.quote.setupTitle")}</p>
                      <ul className="list-disc pl-5">{quote.billing.setup_missing.map((c) => <li key={c}>{t.dynamic(`bookingWorkflow.setup.${c}`, undefined, c)}</li>)}</ul>
                      <p className="text-xs">
                        <Link href={`/admin/services/${quote.service.id}`} className="underline">{t("adminBooking.quote.fixService")}</Link>{" · "}
                        <Link href="/admin/settings/billing-entities" className="underline">{t("adminBooking.quote.fixEntities")}</Link>
                      </p>
                      <p className="text-xs">{t("adminBooking.quote.setupConfirmOk")}</p>
                    </div>
                  )}
                  {quote.billing.billing_status === "not_billable" && <p className="flex items-center gap-2 text-ink-2"><Info className="h-4 w-4" /> {t("adminBooking.quote.free")}</p>}
                  {summary?.canConfirm && quote.warnings.length === 0 && <p className="flex items-center gap-2 text-success"><CheckCircle2 className="h-4 w-4" /> {t("adminBooking.quote.ready")}</p>}
                </>
              )}

              {(needsOverride || s.overrideAvailability) && (isAdmin ? (
                <div className="space-y-2 rounded border border-line p-2">
                  <label className="flex items-center gap-2 text-ink-2">
                    <input type="checkbox" className="h-4 w-4 accent-[var(--red-primary)]" checked={s.overrideAvailability} onChange={(e) => set("overrideAvailability", e.target.checked)} />
                    {t("adminBooking.form.overrideAvailability")}
                  </label>
                  {s.overrideAvailability && <Input aria-label={t("adminBooking.form.overrideReason")} placeholder={t("adminBooking.form.overrideReason")} maxLength={500} value={s.overrideReason} onChange={(e) => set("overrideReason", e.target.value)} />}
                </div>
              ) : <p className="text-xs text-ink-3">{t("adminBooking.form.overrideAdminOnly")}</p>)}
            </CardBody>
          </Card>

          {err && (
            <div role="alert" className="rounded-lg border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-danger">
              <p>{err.text}</p>
              {err.code && SLOT_REFUSALS.has(err.code) && <p className="mt-1 text-xs">{t("adminBooking.form.slotRefusedHint")}</p>}
            </div>
          )}
          <Button type="submit" className="w-full" disabled={!canConfirm || busy}>{busy ? t("adminBooking.form.confirming") : t("adminBooking.form.confirm")}</Button>
          <p className="text-xs text-ink-3">{t("adminBooking.form.confirmHint")}</p>
        </div>
      </form>

      <QuickAthleteDialog open={s.quickOpen} value={s.quick} requestIds={ids} todayKey={todayKey}
        onChange={(patch: Partial<QuickAthleteFields>) => setS((x) => ({ ...x, quick: { ...x.quick, ...patch } }))}
        onClose={() => set("quickOpen", false)}
        onDone={(a) => { setErr(null); setS((x) => withAthlete(x, a.id, a.label, a.familyId)); }} />
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return <div className="flex items-start justify-between gap-3"><span className="text-ink-3">{label}</span><span className="text-right text-ink">{value}</span></div>;
}
