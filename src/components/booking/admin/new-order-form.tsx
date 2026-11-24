"use client";
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, CalendarPlus, CheckCircle2, Hourglass, Info, Repeat, RotateCcw, Trash2, X } from "lucide-react";
import { Badge, Button, Card, CardBody, CardHeader, CardTitle, FieldHint, Input, Label } from "@/components/ui";
import { Select, Textarea } from "@/components/teams/fields";
import { savePayer } from "@/lib/actions/booking-workflow";
import { getBookingPayerCandidates } from "@/lib/actions/admin-booking";
import { confirmOrder, getAthletePackages, quoteOrder, type AthletePackage } from "@/lib/actions/booking-orders";
import {
  RequestIds, buildPayerOptions, payerKey, resolvePayer, slotInstant, type PayerCandidates, type PayerChoice, type QuickAthleteFields,
} from "@/lib/booking/admin-form";
import {
  addPlayer, clearOrderDraft, completeRows, emptyOrderForm, isOrderDirty, loadOrderDraft, orderFormToPayload, playerDateKeys, removePlayer,
  saveOrderDraft, togglePlayerDate, withOrderService, type DateMode, type OrderFormState,
} from "@/lib/booking/order-form";
import {
  duplicateDateKeys, expandRecurrence, isPriceOverride, offeredOptions, optionLabel, priceTag, orderPricingPreview, type OrderDateCheck, type OrderOption,
  type OrderQuote,
} from "@/lib/booking/orders";
import type { CatalogService } from "@/lib/booking/data";
import type { CoachOption, SpaceOption } from "@/lib/booking/admin-data";
import { newRequestId } from "@/lib/billing/request-id";
import { useFormat, useT } from "@/lib/i18n/client";
import { cn } from "@/lib/utils";
import { firstDueDate, instalmentChoices, type ServiceInstalmentInfo } from "@/lib/booking/instalments";
import { InstalmentPicker, instalmentValueOk, type InstalmentValue } from "@/components/booking/instalment-picker";
import { AthleteCombobox } from "./athlete-combobox";
import { QuickAthleteDialog } from "./quick-athlete-dialog";

const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7] as const;

/**
 * Admin New Booking on booking orders (docs/booking-workflow.md §13): one
 * service, a pricing option ("Session or Package" / group rate), one or
 * several dates or a weekly rule expanded into an editable list, one athlete
 * (private) or several players with their own Bill To and dates (group),
 * received date, customer-facing description (preview) and internal notes.
 * Every change re-quotes (per-date availability, charges per player and per
 * payer); confirm is all-or-nothing with one request id per form.
 */
export function NewOrderForm({ services, coaches, spaces, isAdmin, scope, todayKey, initialAthlete, instalmentInfo = null }: {
  services: CatalogService[]; coaches: CoachOption[]; spaces: SpaceOption[]; isAdmin: boolean;
  scope: string; todayKey: string; initialAthlete?: { id: string; label: string; familyId: string } | null;
  /** Payments allowed per service (service_instalment_info); null = pay in full only. */
  instalmentInfo?: ServiceInstalmentInfo | null;
}) {
  const t = useT();
  const f = useFormat();
  const router = useRouter();
  const ids = React.useRef(new RequestIds()).current;
  const payerIds = React.useRef(new Map<string, string>());
  const [s, setS] = React.useState<OrderFormState>(() => emptyOrderForm({ receivedOn: todayKey }));
  const [restored, setRestored] = React.useState(false);
  const [hydrated, setHydrated] = React.useState(false);
  const [cands, setCands] = React.useState<Record<string, PayerCandidates | null>>({});
  const [pkgs, setPkgs] = React.useState<AthletePackage[]>([]);
  const [quote, setQuote] = React.useState<OrderQuote | null>(null);
  const [quoteErr, setQuoteErr] = React.useState<string | null>(null);
  const [quoting, setQuoting] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState<{ text: string; code?: string; date?: string | null } | null>(null);
  const submitted = React.useRef(false);
  const [plan, setPlan] = React.useState<InstalmentValue>({ count: 1, dates: null });

  // --- draft ----------------------------------------------------------------------
  React.useEffect(() => {
    const draft = loadOrderDraft(window.sessionStorage, scope);
    if (draft && isOrderDirty(draft)) { setS(draft); setRestored(true); }
    else if (initialAthlete) setS((cur) => addPlayer(cur, { athleteId: initialAthlete.id, label: initialAthlete.label, familyId: initialAthlete.familyId }, false));
    setHydrated(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  React.useEffect(() => {
    if (!hydrated) return;
    const h = window.setTimeout(() => { if (!submitted.current) saveOrderDraft(window.sessionStorage, scope, s); }, 200);
    return () => window.clearTimeout(h);
  }, [s, hydrated, scope]);

  const set = <K extends keyof OrderFormState>(k: K, v: OrderFormState[K]) => { setErr(null); setS((x) => ({ ...x, [k]: v })); };
  const service = services.find((x) => x.id === s.serviceId) ?? null;
  const isGroup = service?.kind === "group";
  const currency = service?.currency ?? f.currency;
  const money = (n: number | null | undefined, cur = currency) => (n === null || n === undefined ? "—" : f.money(n, cur));
  const sessionsLabel = (n: number) => t("bookingOrders.option.sessions", { count: n });
  const eligible = service ? coaches.filter((c) => service.coaches.some((e) => e.id === c.id)) : [];
  const others = service ? coaches.filter((c) => !service.coaches.some((e) => e.id === c.id)) : [];
  const options = service?.pricing_options ?? [];
  const offered = service ? offeredOptions(service.kind) : [];
  const pricingMissing = service?.pricing_missing ?? [];
  // Instalments: eligible services only (max per service, 4 at most); an existing package has nothing to pay.
  const instChoices = service && s.option && s.option !== "existing_package" ? instalmentChoices(instalmentInfo?.services[service.id] ?? 1) : [1];
  const instToday = instalmentInfo?.today ?? todayKey;
  const instFirstDue = firstDueDate(instToday, instalmentInfo?.invoice_due_days);
  const planCount = instChoices.includes(plan.count) ? plan.count : 1;
  React.useEffect(() => { setPlan({ count: 1, dates: null }); }, [s.serviceId, s.option]);

  // --- payer candidates per player, packages of a private athlete -------------------------
  const athleteKey = s.players.map((p) => p.athleteId).join(",");
  React.useEffect(() => {
    let live = true;
    for (const p of s.players) {
      if (p.athleteId in cands) continue;
      setCands((c) => ({ ...c, [p.athleteId]: null }));
      void getBookingPayerCandidates(p.athleteId).then((res) => { if (live) setCands((c) => ({ ...c, [p.athleteId]: res.ok ? res.data ?? null : null })); });
    }
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [athleteKey]);
  const first = s.players[0]?.athleteId ?? "";
  React.useEffect(() => {
    if (!service || isGroup || !first) { setPkgs([]); return; }
    let live = true;
    void getAthletePackages(first, service.id).then((res) => { if (live) setPkgs(res.ok ? res.data ?? [] : []); });
    return () => { live = false; };
  }, [service, isGroup, first]);

  // --- rows, preview ------------------------------------------------------------
  const rows = completeRows(s.rows);
  const rowKeys = rows.map((r) => r.key);
  const dupes = duplicateDateKeys(s.rows.filter((r) => r.date && r.time));
  const catalogueTotal = s.option === "single" ? options.find((o) => o.kind === "single")?.total ?? null
    : s.option === "package" ? options.find((o) => o.package_id === s.packageId)?.total ?? null : null;
  const catalogueRate = service?.group_rate ?? null;
  const agreedNum = s.priceOverride && s.agreed.trim() !== "" ? Number(s.agreed) : null;
  const effective = s.option === "group" ? agreedNum ?? catalogueRate : agreedNum ?? catalogueTotal;
  const override = s.priceOverride && isPriceOverride(agreedNum, s.option === "group" ? catalogueRate : catalogueTotal);
  const resolved = new Map(s.players.map((p) => [p.athleteId, resolvePayer(p.payer, cands[p.athleteId] ?? null,
    { id: p.athleteId, name: p.label, familyId: p.familyId || null }, { name: "", email: "", phone: "", street: "", postalCode: "", city: "", country: "CH" })]));
  const payerNameOf = (athleteId: string): string => {
    const p = s.players.find((x) => x.athleteId === athleteId);
    if (!p) return "";
    const opts = buildPayerOptions(cands[athleteId] ?? null, { id: p.athleteId, name: p.label });
    const o = opts.find((x) => x.key === payerKey(p.payer));
    return o ? (o.group === "family" ? t("adminBooking.payer.familyDefault", { name: o.label || "—" }) : o.label) : "";
  };
  const preview = orderPricingPreview({
    option: (s.option || "single") as OrderOption, agreedTotal: effective, rate: effective,
    players: s.players.map((p) => {
      const r = resolved.get(p.athleteId);
      const pk = r?.kind === "ready" && r.payerId ? `payer:${r.payerId}` : p.payer.type === "family" ? `family:${p.familyId}` : `new:${p.athleteId}:${payerKey(p.payer)}`;
      return { athleteId: p.athleteId, payerKey: pk, payerName: payerNameOf(p.athleteId), dates: playerDateKeys(p, rows) };
    }),
  });

  // --- live quote -------------------------------------------------------------------
  const quotePayers = new Map(s.players.map((p) => {
    const r = resolved.get(p.athleteId);
    return [p.athleteId, r?.kind === "ready" ? r.payerId : payerIds.current.get(p.athleteId) ?? null] as const;
  }));
  const payload = orderFormToPayload(s, f.timeZone, quotePayers);
  const key = payload ? JSON.stringify(payload) : "";
  const seq = React.useRef(0);
  const runQuote = React.useCallback(async () => {
    if (!payload) { setQuote(null); setQuoteErr(null); return; }
    const n = ++seq.current;
    setQuoting(true);
    const res = await quoteOrder(payload);
    if (n !== seq.current) return;
    setQuoting(false);
    if (res.ok) { setQuote(res.data ?? null); setQuoteErr(null); } else { setQuote(null); setQuoteErr(res.error); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  React.useEffect(() => {
    if (!hydrated) return;
    const h = window.setTimeout(() => void runQuote(), 400);
    return () => window.clearTimeout(h);
  }, [runQuote, hydrated]);

  const checkFor = (rowKey: string): OrderDateCheck | null => {
    const r = rows.find((x) => x.key === rowKey);
    if (!r || !quote) return null;
    const at = slotInstant(r.date, r.time, f.timeZone);
    return at ? quote.dates.find((d) => Date.parse(d.starts_at) === Date.parse(at)) ?? null : null;
  };
  const athleteName = (id: string) => s.players.find((p) => p.athleteId === id)?.label ?? "";

  const payersOk = [...resolved.values()].every((r) => r.kind !== "invalid");
  const priceOk = !s.priceOverride || (s.agreed.trim() !== "" && Number(s.agreed) >= 0 && (!override || s.priceReason.trim().length > 0));
  const overrideOk = !s.overrideAvailability || s.overrideReason.trim().length > 0;
  const needsOverride = Boolean(quote && !quote.ok && quote.errors.length === 0
    && quote.dates.every((d) => d.errors.every((e) => ["COACH_UNAVAILABLE", "COACH_NOT_ELIGIBLE", "VENUE_CLOSED"].includes(e))));
  const canConfirm = Boolean(payload && quote && !quoting && payersOk && priceOk && overrideOk && pricingMissing.length === 0
    && (quote.ok || (needsOverride && isAdmin && s.overrideAvailability)) && dupes.size === 0
    && instalmentValueOk({ count: planCount, dates: plan.dates }, instToday));
  const createsRequests = quote?.dates.some((d) => d.creates === "requested") ?? false;

  // --- confirm ----------------------------------------------------------------------
  async function confirm() {
    if (!canConfirm || busy) return;
    setBusy(true); setErr(null);
    try {
      // 1) payers to create first (guardian without a record, the athlete): one request id per player.
      for (const p of s.players) {
        const r = resolved.get(p.athleteId);
        if (r?.kind !== "create" || payerIds.current.has(p.athleteId)) continue;
        const pr = await savePayer(r.payer, payerReq(p.athleteId));
        if (!pr.ok) { setErr({ text: pr.error, code: pr.code }); return; }
        payerIds.current.set(p.athleteId, pr.data!.payer_id);
        setS((x) => ({ ...x, players: x.players.map((y) => y.athleteId === p.athleteId ? { ...y, payer: { type: "payer", payerId: pr.data!.payer_id } } : y) }));
        const c = await getBookingPayerCandidates(p.athleteId);
        if (c.ok) setCands((m) => ({ ...m, [p.athleteId]: c.data ?? null }));
      }
      const finalPayers = new Map(s.players.map((p) => {
        const r = resolved.get(p.athleteId);
        return [p.athleteId, payerIds.current.get(p.athleteId) ?? (r?.kind === "ready" ? r.payerId : null)] as const;
      }));
      const body = orderFormToPayload(s, f.timeZone, finalPayers);
      if (!body) return;
      // 2) one request id for this form: a double click / retry replays, never a second order.
      const res = await confirmOrder(body, ids.get("confirm"), planCount > 1 ? { count: planCount, dates: plan.dates } : null);
      if (!res.ok) {
        setErr({ text: res.error, code: res.code, date: res.date ?? null });
        void runQuote();
        return;
      }
      const d = res.data!;
      if (!d.ok) {
        setErr({ text: res.message ?? "", code: d.code });
        setQuote((q) => (q ? { ...q, dates: d.dates, ok: false } : q));
        return;
      }
      ids.settle("confirm");
      submitted.current = true;
      clearOrderDraft(window.sessionStorage);
      router.push(`/admin/bookings/orders/${d.order_id}?created=1`);
    } finally {
      setBusy(false);
    }
  }
  const payerReqIds = React.useRef(new Map<string, string>());
  function payerReq(athleteId: string): string {
    let id = payerReqIds.current.get(athleteId);
    if (!id) { id = newRequestId(); payerReqIds.current.set(athleteId, id); }
    return id;
  }

  function startOver() {
    clearOrderDraft(window.sessionStorage);
    setS(emptyOrderForm({ receivedOn: todayKey }));
    setRestored(false); setQuote(null); setErr(null);
  }

  // --- date rows ---------------------------------------------------------------------
  const setRows = (rowsNext: OrderFormState["rows"]) => set("rows", rowsNext);
  const newRow = (date = "", time = s.time) => ({ key: `r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, date, time });
  function setMode(m: DateMode) {
    setErr(null);
    setS((x) => ({ ...x, dateMode: m, rows: m === "one" ? x.rows.slice(0, 1) : x.rows }));
  }
  function generate() {
    const r = s.rec;
    const out = expandRecurrence({ from: r.from, weekdays: r.weekdays, until: r.end === "until" ? r.until : null, count: r.end === "count" ? Number(r.count) : null, time: s.time });
    setS((x) => ({ ...x, rows: out.map((o) => newRow(o.date, o.time)), players: x.players.map((p) => ({ ...p, dates: "all" })) }));
  }
  const datesLimit = s.option === "single" ? 1 : s.option === "package" ? (options.find((o) => o.package_id === s.packageId)?.sessions ?? null)
    : s.option === "existing_package" ? (pkgs.find((p) => p.purchaseId === s.purchaseId)?.remaining ?? null) : null;

  const descriptionPreview = [service?.name, s.description.trim()].filter(Boolean).join(" — ");

  return (
    <div className="space-y-5">
      {restored && (
        <div role="status" className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-info/30 bg-info-soft px-4 py-2.5 text-sm text-info">
          <span className="flex items-center gap-2"><Info className="h-4 w-4" aria-hidden /> {t("adminBooking.form.draftRestored")}</span>
          <Button type="button" size="sm" variant="ghost" onClick={startOver}><RotateCcw className="h-3.5 w-3.5" aria-hidden /> {t("adminBooking.form.startOver")}</Button>
        </div>
      )}

      <form onSubmit={(e) => { e.preventDefault(); void confirm(); }} className="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_360px]">
        <div className="min-w-0 space-y-5">
          {/* 1. Service */}
          <Card><CardBody className="space-y-3">
            <div>
              <Label htmlFor="no-service">{t("adminBooking.form.service")}</Label>
              <Select id="no-service" value={s.serviceId} disabled={busy}
                onChange={(e) => { const svc = services.find((x) => x.id === e.target.value); setErr(null);
                  setS((x) => withOrderService(x, e.target.value, { kind: svc?.kind ?? "private", coachIds: svc?.coaches.map((c) => c.id) ?? [], venueSpaceId: svc?.default_venue_space_id ?? null })); }}>
                <option value="">{t("adminBooking.form.chooseService")}</option>
                {services.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
              </Select>
            </div>
            {service && (
              <>
                {service.short_description && <p className="text-sm text-ink-2">{service.short_description}</p>}
                <div className="flex flex-wrap gap-1.5 text-xs">
                  <Badge tone="neutral">{t.dynamic(`adminBooking.kind.${service.kind}`, undefined, service.kind)}</Badge>
                  <Badge tone="neutral">{t("adminBooking.form.duration", { count: service.duration_min })}</Badge>
                  {isGroup && <Badge tone="neutral">{t("adminBooking.form.capacity", { count: service.max_participants })}</Badge>}
                  {service.setup_missing.length > 0 && <Badge tone="warning">{t("adminBooking.form.setupMissing")}</Badge>}
                </div>
                {pricingMissing.length > 0 && (
                  <p role="alert" className="flex items-start gap-2 rounded border border-danger/30 bg-danger-soft p-2 text-sm text-danger">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                    <span>{pricingMissing.map((c) => t.dynamic(`bookingOrders.pricingMissing.${c}`, undefined, c)).join(" ")}{" "}
                      <Link href={`/admin/services/${service.id}`} className="underline">{t("bookingOrders.form.configurePricing")}</Link></span>
                  </p>
                )}
              </>
            )}
          </CardBody></Card>

          {/* 2. Athlete(s) */}
          <Card>
            <CardHeader><CardTitle>{isGroup ? t("bookingOrders.form.players") : t("adminBooking.form.athlete")}</CardTitle>
              {isGroup && <span className="text-xs text-ink-3">{t("bookingOrders.form.playersCount", { count: s.players.length })}</span>}</CardHeader>
            <CardBody className="space-y-3">
              {(isGroup || s.players.length === 0) ? (
                <AthleteCombobox value="" label="" disabled={busy || !service}
                  onSelect={(a) => { if (a) { setErr(null); setS((x) => addPlayer(x, { athleteId: a.id, label: `${a.firstName} ${a.lastName}`, familyId: a.familyId }, isGroup)); } }}
                  onAddNew={() => set("quickOpen", true)} />
              ) : null}
              {!service && <FieldHint>{t("bookingOrders.form.serviceFirst")}</FieldHint>}
              <ul className="space-y-2">
                {s.players.map((p) => {
                  const opts = buildPayerOptions(cands[p.athleteId] ?? null, { id: p.athleteId, name: p.label });
                  const r = resolved.get(p.athleteId);
                  const pv = preview.players.find((x) => x.athleteId === p.athleteId);
                  const mine = playerDateKeys(p, rows);
                  const aerr = quote?.dates.flatMap((d) => d.athlete_errors.filter((e) => e.athlete_id === p.athleteId).map((e) => ({ ...e, at: d.starts_at }))) ?? [];
                  return (
                    <li key={p.athleteId} className="space-y-2 rounded-lg border border-line p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-medium text-ink">{p.label}</span>
                        <span className="flex items-center gap-2">
                          {s.option && <span className="tnum text-sm text-ink">{money(pv?.charge ?? 0)}</span>}
                          <Button type="button" size="sm" variant="ghost" disabled={busy} aria-label={t("bookingOrders.form.removePlayer", { name: p.label })}
                            onClick={() => { setErr(null); setS((x) => removePlayer(x, p.athleteId)); }}><X className="h-4 w-4" aria-hidden /></Button>
                        </span>
                      </div>
                      <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto]">
                        <div>
                          <Label htmlFor={`no-payer-${p.athleteId}`}>{t("adminBooking.form.billTo")}</Label>
                          <Select id={`no-payer-${p.athleteId}`} value={payerKey(p.payer)} disabled={busy || cands[p.athleteId] === undefined}
                            onChange={(e) => { const o = opts.find((x) => x.key === e.target.value); if (o) { setErr(null); setS((x) => ({ ...x, players: x.players.map((y) => y.athleteId === p.athleteId ? { ...y, payer: o.choice as PayerChoice } : y) })); } }}>
                            {opts.map((o) => <option key={o.key} value={o.key}>{o.group === "family" ? t("adminBooking.payer.familyDefault", { name: o.label || "—" }) : o.label}{o.detail ? ` · ${o.detail}` : ""}</option>)}
                          </Select>
                          {r?.kind === "invalid" && <p role="alert" className="mt-1 text-xs text-danger">{t.dynamic(`bookingWorkflow.errors.${r.reason}`)}</p>}
                        </div>
                      </div>
                      {isGroup && rows.length > 1 && (
                        <div>
                          <p className="mb-1 text-[11px] font-medium uppercase tracking-[0.12em] text-text-muted">{t("bookingOrders.form.playerDates")}</p>
                          <div className="flex flex-wrap gap-1.5">
                            {rows.map((row) => {
                              const on = mine.includes(row.key);
                              return (
                                <button key={row.key} type="button" aria-pressed={on} disabled={busy}
                                  onClick={() => { setErr(null); setS((x) => togglePlayerDate(x, p.athleteId, row.key, rowKeys)); }}
                                  className={cn("rounded-full border px-2.5 py-1 text-xs", on ? "border-maroon bg-maroon/10 text-ink" : "border-line text-ink-3 line-through")}>
                                  {f.date(row.date, { weekday: true })} {row.time}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      )}
                      {aerr.map((e, i) => (
                        <p key={`${e.code}-${i}`} role="alert" className="flex items-center gap-1.5 text-xs text-danger"><AlertTriangle className="h-3.5 w-3.5" aria-hidden />
                          {f.date(e.at, { weekday: true })} {f.time(e.at)}: {t.dynamic(`bookingWorkflow.errors.${e.code}`, undefined, e.code)}</p>
                      ))}
                    </li>
                  );
                })}
              </ul>
            </CardBody>
          </Card>

          {/* 3. Session or package / group rate */}
          {service && (
            <Card>
              <CardHeader><CardTitle>{isGroup ? t("bookingOrders.form.groupPricing") : t("bookingOrders.form.sessionOrPackage")}</CardTitle></CardHeader>
              <CardBody className="space-y-3">
                {isGroup ? (
                  <p className="text-sm text-ink">
                    {catalogueRate === null ? t("bookingOrders.form.noGroupRate") : t("bookingOrders.form.groupRate", { rate: money(catalogueRate) })}
                    <span className="block text-xs text-ink-3">{t("bookingOrders.pricing.basisPerPlayerPerSession")}</span>
                  </p>
                ) : (
                  <fieldset className="space-y-1.5">
                    <legend className="sr-only">{t("bookingOrders.form.sessionOrPackage")}</legend>
                    {options.filter((o) => offered.includes(o.kind)).map((o) => {
                      const checked = o.kind === "single" ? s.option === "single" : s.option === "package" && s.packageId === o.package_id;
                      return (
                        <label key={o.option_id} className={cn("flex cursor-pointer items-center justify-between gap-3 rounded-lg border px-3 py-2 text-sm", checked ? "border-maroon bg-maroon/10" : "border-line hover:border-maroon/40")}>
                          <span className="flex items-center gap-2">
                            <input type="radio" name="no-option" required className="accent-[var(--red-primary)]" checked={checked} disabled={busy}
                              onChange={() => { setErr(null); setS((x) => ({ ...x, option: o.kind, packageId: o.package_id ?? "", purchaseId: "", priceOverride: false, agreed: "", dateMode: o.kind === "single" ? "one" : x.dateMode, rows: o.kind === "single" ? x.rows.slice(0, 1) : x.rows })); }} />
                            <span className="text-ink">{optionLabel(o, sessionsLabel, (n) => priceTag(n, currency, (v) => money(v)))}</span>
                          </span>
                          {o.kind === "package" && o.sessions > 0 && <span className="text-xs text-ink-3">{t("bookingOrders.form.perSession", { price: money(Math.round((Number(o.total) / o.sessions) * 100) / 100) })}</span>}
                        </label>
                      );
                    })}
                    {pkgs.map((p) => {
                      const checked = s.option === "existing_package" && s.purchaseId === p.purchaseId;
                      return (
                        <label key={p.purchaseId} className={cn("flex cursor-pointer items-center justify-between gap-3 rounded-lg border border-dashed px-3 py-2 text-sm", checked ? "border-maroon bg-maroon/10" : "border-line hover:border-maroon/40")}>
                          <span className="flex items-center gap-2">
                            <input type="radio" name="no-option" className="accent-[var(--red-primary)]" checked={checked} disabled={busy}
                              onChange={() => { setErr(null); setS((x) => ({ ...x, option: "existing_package", purchaseId: p.purchaseId, packageId: "", priceOverride: false, agreed: "" })); }} />
                            <span className="text-ink">{t("bookingOrders.form.useExisting", { count: p.remaining, total: p.sessions })}</span>
                          </span>
                          {p.orderId && <Link href={`/admin/bookings/orders/${p.orderId}`} className="text-xs text-maroon hover:underline">{t("bookingOrders.form.openOrder")}</Link>}
                        </label>
                      );
                    })}
                    {options.filter((o) => offered.includes(o.kind)).length === 0 && pkgs.length === 0 && <p className="text-sm text-ink-3">{t("bookingOrders.form.noOptions")}</p>}
                  </fieldset>
                )}
                {s.option && s.option !== "existing_package" && (
                  <div className="space-y-2">
                    <label className="flex items-center gap-2 text-sm text-ink-2">
                      <input type="checkbox" className="h-4 w-4 accent-[var(--red-primary)]" checked={s.priceOverride} disabled={busy}
                        onChange={(e) => { setErr(null); setS((x) => ({ ...x, priceOverride: e.target.checked, agreed: e.target.checked ? String(effective ?? "") : "" })); }} />
                      {isGroup ? t("bookingOrders.form.overrideRate") : t("bookingOrders.form.overrideTotal")}
                    </label>
                    {s.priceOverride && (
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <div><Label htmlFor="no-agreed">{isGroup ? t("bookingOrders.form.agreedRate", { currency }) : t("bookingOrders.form.agreedTotal", { currency })}</Label>
                          <Input id="no-agreed" type="number" min={0} step="0.05" inputMode="decimal" value={s.agreed} disabled={busy} onChange={(e) => set("agreed", e.target.value)} /></div>
                        <div><Label htmlFor="no-reason">{t("adminBooking.form.priceReason")}</Label>
                          <Input id="no-reason" maxLength={500} value={s.priceReason} disabled={busy} required={override} onChange={(e) => set("priceReason", e.target.value)} /></div>
                      </div>
                    )}
                  </div>
                )}
              </CardBody>
            </Card>
          )}

          {/* 4. Dates */}
          {service && (
            <Card>
              <CardHeader><CardTitle>{t("bookingOrders.form.dates")}</CardTitle>
                {datesLimit !== null && <span className="text-xs text-ink-3">{t("bookingOrders.form.datesOfLimit", { count: rows.length, limit: datesLimit })}</span>}</CardHeader>
              <CardBody className="space-y-4">
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div>
                    <Label htmlFor="no-coach">{t("adminBooking.form.coach")}</Label>
                    <Select id="no-coach" value={s.coachId} disabled={busy} onChange={(e) => set("coachId", e.target.value)}>
                      <option value="">{t("adminBooking.form.chooseCoach")}</option>
                      {eligible.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                      {isAdmin && others.length > 0 && <optgroup label={t("adminBooking.form.otherCoaches")}>{others.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</optgroup>}
                    </Select>
                    {eligible.length === 0 && <FieldHint>{t("adminBooking.form.noEligibleCoach")}</FieldHint>}
                  </div>
                  <div>
                    <Label htmlFor="no-space">{t("adminBooking.form.facility")}</Label>
                    <Select id="no-space" value={s.venueSpaceId} disabled={busy} onChange={(e) => set("venueSpaceId", e.target.value)}>
                      <option value="">{t("adminBooking.form.noSpace")}</option>
                      {spaces.map((sp) => <option key={sp.id} value={sp.id}>{sp.venueName ? `${sp.venueName} · ${sp.name}` : sp.name}</option>)}
                    </Select>
                  </div>
                </div>

                {s.option !== "single" && (
                  <div role="tablist" aria-label={t("bookingOrders.form.dates")} className="flex w-fit rounded border border-line p-0.5 text-xs">
                    {(["one", "multi", "recurring"] as const).map((m) => (
                      <button key={m} type="button" role="tab" aria-selected={s.dateMode === m} disabled={busy} onClick={() => setMode(m)}
                        className={cn("rounded px-3 py-1.5", s.dateMode === m ? "bg-maroon text-inverse" : "text-ink-2 hover:text-ink")}>
                        {t.dynamic(`bookingOrders.form.mode.${m}`, undefined, m)}
                      </button>
                    ))}
                  </div>
                )}

                {s.dateMode === "recurring" && s.option !== "single" && (
                  <div className="space-y-3 rounded-lg border border-line p-3">
                    <fieldset>
                      <legend className="mb-1.5 block text-[11px] font-medium uppercase tracking-[0.12em] text-text-muted">{t("bookingOrders.form.weekdays")}</legend>
                      <div className="flex flex-wrap gap-1.5">
                        {WEEKDAYS.map((d) => {
                          const on = s.rec.weekdays.includes(d);
                          // 2024-01-01 is a Monday: weekday names from Intl in the viewer's locale.
                          const name = new Intl.DateTimeFormat(f.locale, { weekday: "short", timeZone: "UTC" }).format(new Date(Date.UTC(2024, 0, d)));
                          return (
                            <button key={d} type="button" aria-pressed={on} disabled={busy}
                              onClick={() => set("rec", { ...s.rec, weekdays: on ? s.rec.weekdays.filter((x) => x !== d) : [...s.rec.weekdays, d] })}
                              className={cn("rounded-full border px-3 py-1 text-xs", on ? "border-maroon bg-maroon/10 text-ink" : "border-line text-ink-3")}>{name}</button>
                          );
                        })}
                      </div>
                    </fieldset>
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                      <div><Label htmlFor="no-rfrom">{t("bookingOrders.form.from")}</Label><Input id="no-rfrom" type="date" value={s.rec.from} disabled={busy} onChange={(e) => set("rec", { ...s.rec, from: e.target.value })} /></div>
                      <div><Label htmlFor="no-rtime">{t("adminBooking.form.time")}</Label><Input id="no-rtime" type="time" step={300} value={s.time} disabled={busy} onChange={(e) => set("time", e.target.value)} /></div>
                      <div>
                        <Label htmlFor="no-rend">{t("bookingOrders.form.ends")}</Label>
                        <Select id="no-rend" value={s.rec.end} disabled={busy} onChange={(e) => set("rec", { ...s.rec, end: e.target.value as "until" | "count" })}>
                          <option value="count">{t("bookingOrders.form.endCount")}</option>
                          <option value="until">{t("bookingOrders.form.endUntil")}</option>
                        </Select>
                      </div>
                      {s.rec.end === "count"
                        ? <div><Label htmlFor="no-rcount">{t("bookingOrders.form.count")}</Label><Input id="no-rcount" type="number" min={1} max={60} value={s.rec.count} disabled={busy} onChange={(e) => set("rec", { ...s.rec, count: e.target.value })} /></div>
                        : <div><Label htmlFor="no-runtil">{t("bookingOrders.form.until")}</Label><Input id="no-runtil" type="date" value={s.rec.until} disabled={busy} onChange={(e) => set("rec", { ...s.rec, until: e.target.value })} /></div>}
                    </div>
                    <Button type="button" size="sm" variant="secondary" disabled={busy || !s.time || s.rec.weekdays.length === 0} onClick={generate}>
                      <Repeat className="h-4 w-4" aria-hidden /> {t("bookingOrders.form.generate")}
                    </Button>
                    <FieldHint>{t("bookingOrders.form.generateHint")}</FieldHint>
                  </div>
                )}

                <ul className="space-y-2">
                  {s.rows.map((r, i) => {
                    const chk = r.date && r.time ? checkFor(r.key) : null;
                    const dup = dupes.has(`${r.date}T${r.time}`);
                    const bad = Boolean(err?.date && r.date && r.time && Date.parse(err.date) === Date.parse(slotInstant(r.date, r.time, f.timeZone) ?? ""));
                    return (
                      <li key={r.key} className={cn("rounded-lg border p-2", chk && !chk.ok || dup || bad ? "border-danger/50" : "border-line")}>
                        <div className="flex flex-wrap items-end gap-2">
                          <div className="min-w-[9rem] flex-1"><Label htmlFor={`no-d-${r.key}`}>{t("adminBooking.form.date")}</Label>
                            <Input id={`no-d-${r.key}`} type="date" value={r.date} disabled={busy} onChange={(e) => setRows(s.rows.map((x) => x.key === r.key ? { ...x, date: e.target.value } : x))} /></div>
                          <div className="w-32"><Label htmlFor={`no-t-${r.key}`}>{t("adminBooking.form.time")}</Label>
                            <Input id={`no-t-${r.key}`} type="time" step={300} value={r.time} disabled={busy} onChange={(e) => setRows(s.rows.map((x) => x.key === r.key ? { ...x, time: e.target.value } : x))} /></div>
                          {(s.dateMode !== "one" || i > 0) && (
                            <Button type="button" size="sm" variant="ghost" disabled={busy} aria-label={t("bookingOrders.form.removeDate")}
                              onClick={() => setRows(s.rows.filter((x) => x.key !== r.key))}><Trash2 className="h-4 w-4" aria-hidden /></Button>
                          )}
                        </div>
                        <DateStatus t={t} f={f} chk={chk} dup={dup} athleteName={athleteName} />
                      </li>
                    );
                  })}
                </ul>
                {s.dateMode !== "one" && s.option !== "single" && (
                  <Button type="button" size="sm" variant="secondary" disabled={busy || (datesLimit !== null && s.rows.length >= datesLimit)}
                    onClick={() => setRows([...s.rows, newRow(s.rows[s.rows.length - 1]?.date ?? "", s.rows[s.rows.length - 1]?.time ?? s.time)])}>
                    <CalendarPlus className="h-4 w-4" aria-hidden /> {t("bookingOrders.form.addDate")}
                  </Button>
                )}
                {(s.option === "package" || s.option === "existing_package") && <FieldHint>{t("bookingOrders.form.packageLaterHint")}</FieldHint>}
                <FieldHint>{t("adminBooking.form.timeZone", { zone: f.timeZone })}</FieldHint>
              </CardBody>
            </Card>
          )}

          {/* 5. Details */}
          <Card><CardBody className="space-y-4">
            <div className="max-w-xs">
              <Label htmlFor="no-received">{t("bookingOrders.form.receivedOn")}</Label>
              <Input id="no-received" type="date" value={s.receivedOn} max={todayKey} disabled={busy} onChange={(e) => set("receivedOn", e.target.value)} />
              <FieldHint>{t("bookingOrders.form.receivedOnHint")}</FieldHint>
            </div>
            <div>
              <Label htmlFor="no-desc">{t("bookingOrders.form.description")}</Label>
              <Textarea id="no-desc" maxLength={1000} rows={2} value={s.description} disabled={busy} onChange={(e) => set("description", e.target.value)} />
              <FieldHint>{t("bookingOrders.form.descriptionHint")}</FieldHint>
              {service && (
                <div className="mt-2 rounded border border-dashed border-line p-2 text-sm">
                  <p className="text-[11px] uppercase tracking-[0.12em] text-text-muted">{t("bookingOrders.form.customerSees")}</p>
                  <p className="text-ink">{descriptionPreview}</p>
                </div>
              )}
            </div>
            <div>
              <Label htmlFor="no-notes">{t("bookingOrders.form.internalNotes")}</Label>
              <Textarea id="no-notes" maxLength={2000} value={s.internalNotes} disabled={busy} onChange={(e) => set("internalNotes", e.target.value)} />
              <FieldHint>{t("bookingOrders.form.internalNotesHint")}</FieldHint>
            </div>
            <label className="flex items-center gap-2 text-sm text-ink-2">
              <input type="checkbox" className="h-4 w-4 accent-[var(--red-primary)]" checked={s.notify} disabled={busy} onChange={(e) => set("notify", e.target.checked)} />
              {t("adminBooking.form.notify")}
            </label>
          </CardBody></Card>
        </div>

        {/* Summary + confirm */}
        <div className="space-y-4 lg:sticky lg:top-4 lg:self-start">
          <Card>
            <CardHeader><CardTitle>{t("bookingOrders.summary.title")}</CardTitle>{quoting && <span className="text-xs text-ink-3">{t("adminBooking.quote.checking")}</span>}</CardHeader>
            <CardBody className="space-y-3 text-sm">
              {!payload && <p className="text-ink-3">{t("bookingOrders.summary.incomplete")}</p>}
              {s.option && s.players.length > 0 && (
                <>
                  <ul className="space-y-1">
                    {preview.players.map((p) => (
                      <li key={p.athleteId} className="flex justify-between gap-3">
                        <span className="min-w-0 truncate text-ink-2">{athleteName(p.athleteId)}{s.option === "group" ? ` · ${t("bookingOrders.summary.sessions", { count: p.sessions })}` : ""}</span>
                        <span className="tnum text-ink">{money(p.charge)}</span>
                      </li>
                    ))}
                  </ul>
                  {preview.payers.length > 1 && (
                    <div className="border-t border-line pt-2">
                      <p className="mb-1 text-[11px] uppercase tracking-[0.12em] text-text-muted">{t("bookingOrders.summary.perPayer")}</p>
                      <ul className="space-y-1">{preview.payers.map((p) => (
                        <li key={p.payerKey} className="flex justify-between gap-3"><span className="min-w-0 truncate text-ink-2">{p.payerName || "—"}</span><span className="tnum">{money(p.charge)}</span></li>
                      ))}</ul>
                    </div>
                  )}
                  <div className="flex justify-between gap-3 border-t border-line pt-2 font-medium">
                    <span>{t("bookingOrders.summary.total")}</span><span className="tnum">{money(preview.total)}</span>
                  </div>
                  {s.option === "existing_package" && <p className="text-xs text-ink-3">{t("bookingOrders.summary.coveredByPackage")}</p>}
                  {s.option === "package" && <p className="text-xs text-ink-3">{t("bookingOrders.summary.packageOnce")}</p>}
                  {instChoices.length > 1 && (
                    <div className="border-t border-line pt-3">
                      <InstalmentPicker choices={instChoices} value={{ count: planCount, dates: plan.dates }} onChange={(v) => { setErr(null); setPlan(v); }}
                        currency={currency} firstDue={instFirstDue} today={instToday} canEditDates disabled={busy} idPrefix="no-inst"
                        payers={preview.payers.map((p) => ({ key: p.payerKey, name: p.payerName, total: p.charge }))} />
                    </div>
                  )}
                </>
              )}
              {payload && quoteErr && <p role="alert" className="text-danger">{quoteErr}</p>}
              {quote && (
                <>
                  {quote.billing_entity && <Row label={t("adminBooking.quote.entity")} value={quote.billing_entity.name} />}
                  {quote.number_prefix && <Row label={t("adminBooking.quote.prefix")} value={<span className="font-mono">{quote.number_prefix}</span>} />}
                  {quote.errors.length > 0 && (
                    <ul role="alert" className="space-y-1 rounded border border-danger/30 bg-danger-soft p-2 text-danger">
                      {quote.errors.map((e) => <li key={e} className="flex gap-2"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />{t.dynamic(`bookingWorkflow.errors.${e}`, undefined, t("bookingWorkflow.errors.generic"))}</li>)}
                    </ul>
                  )}
                  {!quote.dates_ok && <p role="alert" className="text-danger">{t("bookingOrders.summary.datesConflict", { count: quote.dates.filter((d) => !d.ok).length })}</p>}
                  {quote.setup_missing.length > 0 && (
                    <div className="space-y-1 rounded border border-warning/30 bg-warning-soft p-2 text-warning">
                      <p className="font-medium">{t("adminBooking.quote.setupTitle")}</p>
                      <ul className="list-disc pl-5">{quote.setup_missing.map((c) => <li key={c}>{t.dynamic(`bookingWorkflow.setup.${c}`, undefined, c)}</li>)}</ul>
                      <p className="text-xs"><Link href="/admin/settings/billing-entities" className="underline">{t("adminBooking.quote.fixEntities")}</Link></p>
                      <p className="text-xs">{t("adminBooking.quote.setupConfirmOk")}</p>
                    </div>
                  )}
                  {quote.ok && createsRequests && <p className="flex items-start gap-2 rounded border border-dashed border-warning/50 p-2 text-ink-2"><Hourglass className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden /> {t("bookingOrders.summary.createsRequests")}</p>}
                  {quote.ok && <p className="flex items-center gap-2 text-success"><CheckCircle2 className="h-4 w-4" aria-hidden /> {t("bookingOrders.summary.ready", { count: quote.totals.sessions })}</p>}
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
              {err.date && <p className="mt-1 text-xs">{t("bookingOrders.summary.failedDate", { date: `${f.date(err.date, { weekday: true })} ${f.time(err.date)}` })}</p>}
            </div>
          )}
          <Button type="submit" className="w-full" disabled={!canConfirm || busy}>
            {busy ? t("adminBooking.form.confirming") : t("bookingOrders.summary.confirm", { count: quote?.totals.sessions ?? 0 })}
          </Button>
          <p className="text-xs text-ink-3">{t("bookingOrders.summary.confirmHint")}</p>
          <p className="text-xs text-ink-3"><Link href="/admin/bookings/new?classic=1" className="underline">{t("bookingOrders.summary.classic")}</Link></p>
        </div>
      </form>

      <QuickAthleteDialog open={s.quickOpen} value={s.quick} requestIds={ids} todayKey={todayKey}
        onChange={(patch: Partial<QuickAthleteFields>) => setS((x) => ({ ...x, quick: { ...x.quick, ...patch } }))}
        onClose={() => set("quickOpen", false)}
        onDone={(a) => { setErr(null); setS((x) => ({ ...addPlayer(x, { athleteId: a.id, label: a.label, familyId: a.familyId ?? "" }, isGroup), quickOpen: false, quick: emptyOrderForm().quick })); }} />
    </div>
  );
}

function DateStatus({ t, f, chk, dup, athleteName }: {
  t: ReturnType<typeof useT>; f: ReturnType<typeof useFormat>; chk: OrderDateCheck | null; dup: boolean; athleteName: (id: string) => string;
}) {
  if (dup) return <p role="alert" className="mt-1 text-xs text-danger">{t("bookingWorkflow.errors.DUPLICATE_DATE")}</p>;
  if (!chk) return null;
  return (
    <div className="mt-1 space-y-0.5 text-xs">
      {chk.ok && (
        <p className={cn("flex items-center gap-1.5", chk.creates === "requested" ? "text-warning" : "text-success")}>
          {chk.creates === "requested" ? <Hourglass className="h-3.5 w-3.5" aria-hidden /> : <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />}
          {chk.creates === "requested" ? t("bookingOrders.date.request") : t("bookingOrders.date.available")}
          {chk.capacity !== null && chk.capacity > 1 && ` · ${t("adminBooking.form.placesLeft", { count: chk.places_left ?? 0, capacity: chk.capacity })}`}
          {chk.session_id && ` · ${t("bookingOrders.date.joins")}`}
        </p>
      )}
      {chk.errors.map((e) => <p key={e} role="alert" className="flex items-center gap-1.5 text-danger"><AlertTriangle className="h-3.5 w-3.5" aria-hidden />{t.dynamic(`bookingWorkflow.errors.${e}`, undefined, e)}</p>)}
      {chk.athlete_errors.map((e, i) => <p key={`${e.athlete_id}-${i}`} role="alert" className="text-danger">{athleteName(e.athlete_id)}: {t.dynamic(`bookingWorkflow.errors.${e.code}`, undefined, e.code)}</p>)}
      {chk.warnings.map((w, i) => <p key={`${w.code}-${i}`} className="text-warning">{w.athlete_id ? `${athleteName(w.athlete_id)}: ` : ""}{t.dynamic(`bookingWorkflow.warnings.${w.code}`, undefined, w.code)}</p>)}
      {chk.ends_at && <span className="sr-only">{f.time(chk.ends_at)}</span>}
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return <div className="flex items-start justify-between gap-3"><span className="text-ink-3">{label}</span><span className="text-right text-ink">{value}</span></div>;
}
