"use client";
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle2, Info, Package, Tag } from "lucide-react";
import { Badge, Button, Card, CardBody, CardHeader, CardTitle, FieldHint, Input, Label } from "@/components/ui";
import { Select, Textarea } from "@/components/teams/fields";
import { createFamilyRequest, quoteFamilyRequest } from "@/lib/actions/booking-workflow";
import { RequestIds } from "@/lib/booking/admin-form";
import {
  declaredTimes, emptyFamilyRequest, familyFormToPayload, packageLeft, withFamilyService,
  type DeclaredAvailabilityInput, type FamilyRequestForm as FormState,
} from "@/lib/booking/family-request";
import { normalizePromoCode } from "@/lib/booking/helpers";
import type { FamilyCatalog, FamilyQuote } from "@/lib/booking/types";
import { useFormat, useT } from "@/lib/i18n/client";
import { firstDueDate, instalmentChoices, type ServiceInstalmentInfo } from "@/lib/booking/instalments";
import { InstalmentPicker } from "@/components/booking/instalment-picker";

export type DeclaredAvailability = DeclaredAvailabilityInput;

/**
 * Parent request form (own children only): service, preferred date / time
 * inside the venue hours (the coach's declared times are shown as hints),
 * optional coach, or an open group session; live quote with package
 * coverage and an optional promo code. Sends one request id per form so a
 * retry never creates a second request.
 */
export function FamilyRequestForm({ kids, catalog, declared, todayKey, instalmentInfo = null }: {
  kids: { id: string; first_name: string; last_name: string }[];
  catalog: FamilyCatalog; declared: DeclaredAvailability | null; todayKey: string;
  /** Payments allowed per service (service_instalment_info); null = pay in full only. */
  instalmentInfo?: ServiceInstalmentInfo | null;
}) {
  const t = useT();
  const f = useFormat();
  const router = useRouter();
  const ids = React.useRef(new RequestIds()).current;
  const tz = catalog.timezone || f.timeZone;
  const [s, setS] = React.useState<FormState>(() => emptyFamilyRequest({ athleteId: catalog.athlete.id, date: todayKey }));
  const [codeDraft, setCodeDraft] = React.useState("");
  const [quote, setQuote] = React.useState<FamilyQuote | null>(null);
  const [quoteErr, setQuoteErr] = React.useState<string | null>(null);
  const [quoting, setQuoting] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);
  const [instalments, setInstalments] = React.useState(1);

  const service = catalog.services.find((x) => x.id === s.serviceId) ?? null;
  const isGroup = service?.kind === "group";
  const openSessions = (service?.sessions ?? []).filter((x) => x.places_left > 0);
  const hints = React.useMemo(
    () => (service && !s.sessionId ? declaredTimes({ service, coachId: s.coachId, date: s.date, timeZone: tz, availability: declared }) : []),
    [service, s.sessionId, s.coachId, s.date, tz, declared],
  );
  const payload = familyFormToPayload(s, tz);
  const key = payload ? JSON.stringify(payload) : "";

  const seq = React.useRef(0);
  React.useEffect(() => {
    if (!payload) { setQuote(null); setQuoteErr(null); return; }
    const n = ++seq.current;
    const h = window.setTimeout(async () => {
      setQuoting(true);
      const res = await quoteFamilyRequest(payload);
      if (n !== seq.current) return;
      setQuoting(false);
      if (res.ok) { setQuote(res.data ?? null); setQuoteErr(null); } else { setQuote(null); setQuoteErr(res.error); }
    }, 350);
    return () => window.clearTimeout(h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => { setErr(null); setS((x) => ({ ...x, [k]: v })); };
  const canSend = Boolean(payload && quote?.ok && !quoting && !busy);
  // Instalments (eligible services, billed by invoice): parents choose the count, the club's default dates apply.
  const billedPrice = quote?.ok && quote.billing.billing_mode === "invoice" ? Number(quote.billing.price ?? 0) : 0;
  const instChoices = service && billedPrice > 0 ? instalmentChoices(instalmentInfo?.services[service.id] ?? 1) : [1];
  const instToday = instalmentInfo?.today ?? todayKey;
  const instCount = instChoices.includes(instalments) ? instalments : 1;
  React.useEffect(() => { setInstalments(1); }, [s.serviceId]);

  async function send() {
    if (!payload || !canSend) return;
    setBusy(true); setErr(null);
    const res = await createFamilyRequest(payload, ids.get("confirm"), instCount);
    setBusy(false);
    if (!res.ok) { setErr(res.error); return; }
    ids.settle("confirm");
    router.push(`/parent/bookings/${res.data!.booking_id}?requested=1`);
  }

  const money = (n: number | null | undefined, cur?: string | null) => (n === null || n === undefined ? "—" : f.money(n, cur ?? service?.currency));
  const promoApplied = quote?.billing.promo === "applied";

  return (
    <form onSubmit={(e) => { e.preventDefault(); void send(); }} className="space-y-5">
      <Card><CardBody className="space-y-4">
        {kids.length > 1 && (
          <div>
            <Label htmlFor="fr-child">{t("bookingRequests.family.child")}</Label>
            <Select id="fr-child" value={s.athleteId} onChange={(e) => router.push(`/parent/bookings/request?athlete=${e.target.value}`)}>
              {kids.map((k) => <option key={k.id} value={k.id}>{k.first_name} {k.last_name}</option>)}
            </Select>
          </div>
        )}
        <div>
          <Label htmlFor="fr-service">{t("adminBooking.form.service")}</Label>
          <Select id="fr-service" value={s.serviceId} disabled={busy}
            onChange={(e) => { setErr(null); setCodeDraft(""); setS((x) => withFamilyService(x, catalog.services.find((y) => y.id === e.target.value) ?? null)); }}>
            <option value="">{t("adminBooking.form.chooseService")}</option>
            {catalog.services.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
          </Select>
          {service && (
            <div className="mt-2 flex flex-wrap gap-1.5 text-xs">
              <Badge tone="neutral">{t.dynamic(`adminBooking.kind.${service.kind}`, undefined, service.kind)}</Badge>
              <Badge tone="neutral">{t("adminBooking.form.duration", { count: service.duration_min })}</Badge>
              {packageLeft(service) > 0
                ? <Badge tone="accent"><Package className="h-3 w-3" aria-hidden /> {t("bookingRequests.family.packageLeft", { count: packageLeft(service) })}</Badge>
                : <Badge tone="accent">{money(service.price, service.currency)}</Badge>}
              {service.venue_name && <Badge tone="neutral">{service.venue_name}</Badge>}
            </div>
          )}
        </div>

        {service && isGroup && openSessions.length > 0 && (
          <fieldset className="space-y-1.5">
            <legend className="mb-1.5 block text-[11px] font-medium uppercase tracking-[0.12em] text-text-muted">{t("bookingRequests.family.openSessions")}</legend>
            <label className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm ${!s.sessionId ? "border-maroon bg-maroon/10" : "border-line"}`}>
              <input type="radio" className="accent-[var(--red-primary)]" checked={!s.sessionId} onChange={() => set("sessionId", "")} />
              {t("bookingRequests.family.newTime")}
            </label>
            {openSessions.map((x) => (
              <label key={x.session_id} className={`flex cursor-pointer items-center justify-between gap-3 rounded-lg border px-3 py-2 text-sm ${s.sessionId === x.session_id ? "border-maroon bg-maroon/10" : "border-line"}`}>
                <span className="flex items-center gap-2">
                  <input type="radio" className="accent-[var(--red-primary)]" checked={s.sessionId === x.session_id} onChange={() => set("sessionId", x.session_id)} />
                  <span className="text-ink">{f.date(x.starts_at, { weekday: true })} · {f.time(x.starts_at)}–{f.time(x.ends_at)}</span>
                </span>
                <span className="text-xs text-ink-3">{[x.coach_name, t("bookingRequests.family.placesLeft", { count: x.places_left })].filter(Boolean).join(" · ")}</span>
              </label>
            ))}
          </fieldset>
        )}

        {service && !s.sessionId && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Label htmlFor="fr-coach">{t("adminBooking.form.coach")}</Label>
              <Select id="fr-coach" value={s.coachId} disabled={busy} onChange={(e) => set("coachId", e.target.value)}>
                <option value="">{t("bookingRequests.family.anyCoach")}</option>
                {service.coaches.map((c) => <option key={c.id} value={c.id}>{c.display_name}</option>)}
              </Select>
            </div>
            <div><Label htmlFor="fr-date">{t("adminBooking.form.date")}</Label>
              <Input id="fr-date" type="date" required min={todayKey} value={s.date} disabled={busy} onChange={(e) => set("date", e.target.value)} /></div>
            <div>
              <Label htmlFor="fr-time">{t("bookingRequests.family.preferredTime")}</Label>
              <Input id="fr-time" type="time" required step={300} value={s.time} disabled={busy} onChange={(e) => set("time", e.target.value)} />
              <FieldHint>{t("adminBooking.form.timeZone", { zone: tz })}</FieldHint>
            </div>
            <div className="sm:col-span-2">
              <p className="mb-1.5 text-xs text-text-muted">{hints.length ? t("bookingRequests.family.declaredHint") : t("bookingRequests.family.noDeclared")}</p>
              {hints.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {hints.map((h) => (
                    <button key={h} type="button" onClick={() => set("time", h)} aria-pressed={s.time === h}
                      className={`rounded border px-2.5 py-1 text-xs tnum ${s.time === h ? "border-maroon bg-maroon/10 text-ink" : "border-line text-ink-2 hover:text-ink"}`}>{h}</button>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {service && packageLeft(service) === 0 && service.price > 0 && (
          <div>
            <Label htmlFor="fr-promo">{t("shop.checkout.promo")}</Label>
            <div className="flex max-w-sm gap-2">
              <Input id="fr-promo" value={codeDraft} maxLength={40} className="font-mono" onChange={(e) => setCodeDraft(normalizePromoCode(e.target.value))} />
              <Button type="button" size="sm" variant="secondary" disabled={!codeDraft.trim() || busy} onClick={() => set("promoCode", codeDraft.trim())}>
                <Tag className="h-4 w-4" aria-hidden /> {t("shop.checkout.apply")}
              </Button>
              {s.promoCode && <Button type="button" size="sm" variant="ghost" onClick={() => { setCodeDraft(""); set("promoCode", ""); }}>{t("bookingRequests.promo.remove")}</Button>}
            </div>
            {promoApplied && <FieldHint>{t("shop.checkout.promoApplied")}</FieldHint>}
          </div>
        )}

        <div>
          <Label htmlFor="fr-notes">{t("bookingRequests.family.notes")}</Label>
          <Textarea id="fr-notes" maxLength={1000} value={s.notes} disabled={busy} onChange={(e) => set("notes", e.target.value)} />
          <FieldHint>{t("bookingRequests.family.notesHint")}</FieldHint>
        </div>
      </CardBody></Card>

      <Card>
        <CardHeader><CardTitle>{t("bookingRequests.family.summary")}</CardTitle>{quoting && <span className="text-xs text-ink-3">{t("adminBooking.quote.checking")}</span>}</CardHeader>
        <CardBody className="space-y-2 text-sm">
          {!payload && <p className="text-ink-3">{t("bookingRequests.family.incomplete")}</p>}
          {payload && quoteErr && <p role="alert" className="text-danger">{quoteErr}</p>}
          {payload && quote && (
            <>
              {quote.slot.starts_at && <Row label={t("adminBooking.detail.when")} value={`${f.date(quote.slot.starts_at, { weekday: true })} · ${f.time(quote.slot.starts_at)}${quote.slot.ends_at ? `–${f.time(quote.slot.ends_at)}` : ""}`} />}
              {quote.slot.coach_name && <Row label={t("adminBooking.form.coach")} value={quote.slot.coach_name} />}
              {quote.billing.billing_mode === "package"
                ? <Row label={t("adminBooking.quote.package")} value={t("bookingRequests.family.packageCovers", { count: quote.billing.package_remaining ?? 0 })} />
                : <Row label={t("adminBooking.quote.price")} value={<span className="tnum">
                    {Number(quote.billing.discount_total ?? 0) > 0 && <span className="mr-1 text-ink-3 line-through">{money(quote.billing.list_price, quote.billing.currency)}</span>}
                    {money(quote.billing.price, quote.billing.currency)}</span>} />}
              <Row label={t("adminBooking.form.billTo")} value={t("bookingRequests.family.payerFamily")} />
              {quote.errors.length > 0 && (
                <ul role="alert" className="space-y-1 rounded border border-danger/30 bg-danger-soft p-2 text-danger">
                  {quote.errors.map((e) => <li key={e} className="flex gap-2"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />{t.dynamic(`bookingWorkflow.errors.${e}`, undefined, t("bookingWorkflow.errors.generic"))}</li>)}
                </ul>
              )}
              {instChoices.length > 1 && (
                <div className="border-t border-line pt-3">
                  <InstalmentPicker choices={instChoices} value={{ count: instCount, dates: null }} onChange={(v) => { setErr(null); setInstalments(v.count); }}
                    currency={quote.billing.currency ?? service?.currency ?? f.currency} firstDue={firstDueDate(instToday, instalmentInfo?.invoice_due_days)}
                    today={instToday} canEditDates={false} disabled={busy} idPrefix="fr-inst"
                    payers={[{ key: "family", name: t("bookingRequests.family.payerFamily"), total: billedPrice }]} />
                </div>
              )}
              {quote.ok && (
                <p className="flex items-start gap-2 text-ink-2">
                  {quote.slot.within_availability ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" aria-hidden /> : <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />}
                  {quote.slot.within_availability ? t("bookingRequests.family.withinAvailability") : t("bookingRequests.family.outsideAvailability")}
                </p>
              )}
            </>
          )}
        </CardBody>
      </Card>

      {err && <p role="alert" className="rounded-lg border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-danger">{err}</p>}
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={!canSend}>{busy ? t("bookingRequests.family.sending") : t("bookingRequests.family.send")}</Button>
        <Link href="/parent/bookings" className="text-sm text-text-muted hover:text-text">{t("common.cancel")}</Link>
      </div>
      <p className="text-xs text-text-muted">{t("bookingRequests.family.sendHint")}</p>
    </form>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return <div className="flex items-start justify-between gap-3"><span className="text-ink-3">{label}</span><span className="text-right text-ink">{value}</span></div>;
}
