"use client";
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, CalendarClock, CalendarPlus, FileText, Package, Users, Wallet, XCircle } from "lucide-react";
import { Badge, Button, Card, CardBody, CardHeader, CardTitle, FieldHint, Input, Label } from "@/components/ui";
import { Select, Textarea } from "@/components/teams/fields";
import { addOrderDates, cancelOrderPart, createOrderInvoices, recordOrderPayment, rescheduleOrderPart } from "@/lib/actions/booking-orders";
import { slotInstant } from "@/lib/booking/admin-form";
import type { CoachOption, SpaceOption } from "@/lib/booking/admin-data";
import { packageUsage, type OrderDateCheck, type OrderDetail } from "@/lib/booking/orders";
import { bookingDisplayKey } from "@/lib/booking/helpers";
import { newRequestId } from "@/lib/billing/request-id";
import { categoryLabelKey } from "@/lib/billing/activities";
import { useFormat, useT } from "@/lib/i18n/client";
import { cn } from "@/lib/utils";
import { billingTone, stateTone } from "./tones";

type Panel =
  | null
  | { kind: "invoice" }
  | { kind: "schedule" }
  | { kind: "payment"; invoiceId: string; number: string; balance: number; currency: string }
  | { kind: "cancel"; scope: "booking" | "participant" | "date"; id: string; label: string; invoiced: boolean; restore: boolean | null }
  | { kind: "reschedule"; scope: "booking" | "date"; id: string; label: string; date: string; time: string };

type Msg = { tone: "ok" | "err" | "warn"; text: string } | null;

/** One request id per open panel (a retry or double click replays on the server). */
function useIntentId() {
  const ref = React.useRef<string | null>(null);
  return {
    get: () => (ref.current ??= newRequestId()),
    settle: () => { ref.current = null; },
  };
}

/**
 * Order page body (admin / finance): participants, dates (shared sessions),
 * package usage, invoices per payer + payments, and the partial-change
 * actions. Everything writes through the order RPCs (src/lib/actions/booking-orders.ts).
 */
export function OrderWorkspace({ detail: d, isAdmin, coaches, spaces, todayKey, restoreByPolicy }: {
  detail: OrderDetail; isAdmin: boolean; coaches: CoachOption[]; spaces: SpaceOption[]; todayKey: string;
  restoreByPolicy: Record<string, boolean>;
}) {
  const t = useT();
  const f = useFormat();
  const router = useRouter();
  const intent = useIntentId();
  const [panel, setPanelRaw] = React.useState<Panel>(null);
  const [busy, setBusy] = React.useState(false);
  const [msg, setMsg] = React.useState<Msg>(null);
  const o = d.order;
  const cur = o.currency;
  const money = (n: number | null | undefined) => (n === null || n === undefined ? "—" : f.money(n, cur));
  const isGroup = o.option_kind === "group";
  const isPackage = o.option_kind === "package" || o.option_kind === "existing_package";
  const active = o.status === "active";
  const open = (p: Panel) => { setMsg(null); intent.settle(); setPanelRaw(p); };
  const done = (text?: string, tone: "ok" | "warn" = "ok") => { intent.settle(); setPanelRaw(null); if (text) setMsg({ tone, text }); router.refresh(); };

  const summaryRows: [string, React.ReactNode][] = [
    [t("bookingOrders.detail.option"), t.dynamic(`bookingOrders.optionKind.${o.option_kind}`, { sessions: o.option_sessions ?? 0 }, o.option_kind)],
    ...(isGroup
      ? [[t("bookingOrders.detail.rate"), `${money(o.group_rate)} · ${t("bookingOrders.pricing.basisPerPlayerPerSession")}`] as [string, React.ReactNode]]
      : o.option_kind !== "existing_package" ? [[t("bookingOrders.detail.agreedTotal"), money(o.agreed_total)] as [string, React.ReactNode]] : []),
    ...((o.price_override_reason ? [[t("bookingOrders.detail.priceReason"), `${o.price_override_reason} (${t("bookingOrders.detail.list", { price: money(isGroup ? o.list_rate : o.list_total) })})`]] : []) as [string, React.ReactNode][]),
    [t("adminBooking.form.coach"), o.coach?.display_name ?? "—"],
    [t("bookingOrders.detail.category"), t(categoryLabelKey(o.billing_category))],
    [t("bookingOrders.form.receivedOn"), o.received_on ? f.date(o.received_on) : "—"],
    [t("bookingOrders.detail.created"), [f.dateTime(o.created_at), o.created_by_name].filter(Boolean).join(" · ")],
  ];

  return (
    <div className="space-y-5">
      {msg && <p role={msg.tone === "err" ? "alert" : "status"} className={cn("rounded-lg border px-4 py-2.5 text-sm",
        msg.tone === "ok" ? "border-success/30 bg-success-soft text-success" : msg.tone === "warn" ? "border-warning/30 bg-warning-soft text-warning" : "border-danger/30 bg-danger-soft text-danger")}>{msg.text}</p>}

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>{t("bookingOrders.detail.summary")}</CardTitle></CardHeader>
          <CardBody className="space-y-2 text-sm">
            {summaryRows.map(([k, v]) => <Row key={k} label={k} value={v} />)}
            {o.description && (
              <div className="border-t border-line-soft pt-2">
                <p className="text-[11px] uppercase tracking-[0.12em] text-text-muted">{t("bookingOrders.form.description")}</p>
                <p className="whitespace-pre-wrap text-ink">{o.description}</p>
              </div>
            )}
            {o.internal_notes && (
              <div className="border-t border-line-soft pt-2">
                <p className="text-[11px] uppercase tracking-[0.12em] text-text-muted">{t("bookingOrders.form.internalNotes")}</p>
                <p className="whitespace-pre-wrap text-ink-2">{o.internal_notes}</p>
              </div>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader><CardTitle>{t("bookingOrders.detail.money")}</CardTitle></CardHeader>
          <CardBody className="space-y-2 text-sm">
            <Row label={t("bookingOrders.detail.charged")} value={<span className="tnum">{money(d.totals.charged)}</span>} />
            <Row label={t("bookingOrders.detail.uninvoiced")} value={<span className="tnum">{money(d.totals.uninvoiced)}</span>} />
            <Row label={t("bookingOrders.detail.invoiced")} value={<span className="tnum">{money(d.totals.invoiced)}</span>} />
            <Row label={t("bookingOrders.detail.paid")} value={<span className="tnum">{money(d.totals.paid)}</span>} />
            <Row label={t("bookingOrders.detail.balance")} value={<span className="tnum font-medium">{money(d.totals.balance)}</span>} />
            {(d.totals.credit ?? 0) > 0 && <Row label={t("bookingOrders.detail.creditTotal")} value={<span className="tnum text-warning">{money(d.totals.credit ?? 0)}</span>} />}
            {o.setup_missing.length > 0 && d.totals.uninvoiced > 0 && (
              <div role="alert" className="rounded border border-warning/30 bg-warning-soft p-2 text-warning">
                <p className="font-medium">{t("adminBooking.quote.setupTitle")}</p>
                <ul className="list-disc pl-5">{o.setup_missing.map((c) => <li key={c}>{t.dynamic(`bookingWorkflow.setup.${c}`, undefined, c)}</li>)}</ul>
                <Link href="/admin/settings/billing-entities" className="text-xs underline">{t("adminBooking.quote.fixEntities")}</Link>
              </div>
            )}
            <div className="flex flex-wrap gap-2 border-t border-line-soft pt-3">
              {d.totals.uninvoiced > 0 && <Button type="button" size="sm" disabled={busy} onClick={() => open({ kind: "invoice" })}><FileText className="h-4 w-4" aria-hidden /> {t("bookingOrders.actions.createInvoices")}</Button>}
              {d.can_add_dates && <Button type="button" size="sm" variant="secondary" disabled={busy} onClick={() => open({ kind: "schedule" })}><CalendarPlus className="h-4 w-4" aria-hidden /> {isPackage ? t("bookingOrders.actions.schedulePackage") : t("bookingOrders.actions.addDates")}</Button>}
            </div>
          </CardBody>
        </Card>
      </div>

      {panel?.kind === "invoice" && (
        <InvoicePanel t={t} busy={busy} setBusy={setBusy} orderId={o.id} intent={intent} payers={new Set(d.participants.filter((p) => p.status === "active").map((p) => p.payer.name)).size}
          onDone={done} onError={(text) => setMsg({ tone: "err", text })} onClose={() => open(null)} />
      )}
      {panel?.kind === "schedule" && (
        <SchedulePanel t={t} f={f} busy={busy} setBusy={setBusy} detail={d} coaches={coaches} spaces={spaces} isAdmin={isAdmin} todayKey={todayKey}
          intent={intent} onDone={done} onClose={() => open(null)} />
      )}

      {d.package && (
        <Card>
          <CardHeader><CardTitle><Package className="mr-1 inline h-4 w-4" aria-hidden />{t("bookingOrders.detail.package")}</CardTitle>
            {d.package.invoice_id && <Link href={`/admin/invoices/${d.package.invoice_id}`} className="text-xs text-maroon hover:underline">{d.package.invoice_number}</Link>}</CardHeader>
          <CardBody>
            {(() => {
              const u = packageUsage(d.package);
              return (
                <div className="grid grid-cols-2 gap-3 text-center sm:grid-cols-4">
                  <Stat label={t("bookingOrders.detail.pkgTotal")} value={u.total} />
                  <Stat label={t("bookingOrders.detail.pkgBooked")} value={u.booked} />
                  <Stat label={t("bookingOrders.detail.pkgCompleted")} value={u.completed} />
                  <Stat label={t("bookingOrders.detail.pkgAvailable")} value={u.available} />
                </div>
              );
            })()}
            {d.package.expires_at && <p className="mt-2 text-xs text-ink-3">{t("bookingOrders.detail.pkgExpires", { date: f.date(d.package.expires_at) })}</p>}
            {!d.package.owned && <p className="mt-2 text-xs text-ink-3">{t("bookingOrders.detail.pkgExisting")}</p>}
          </CardBody>
        </Card>
      )}

      <Card>
        <CardHeader><CardTitle><Users className="mr-1 inline h-4 w-4" aria-hidden />{t("bookingOrders.detail.participants")}</CardTitle></CardHeader>
        <CardBody className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-[13.5px]">
              <thead>
                <tr className="border-b border-border text-left text-[10.5px] uppercase tracking-[0.12em] text-text-muted">
                  <th scope="col" className="px-4 py-2 font-medium">{t("adminBooking.form.athlete")}</th>
                  <th scope="col" className="px-4 py-2 font-medium">{t("adminBooking.form.billTo")}</th>
                  <th scope="col" className="px-4 py-2 text-right font-medium">{t("bookingOrders.detail.sessions")}</th>
                  <th scope="col" className="px-4 py-2 text-right font-medium">{t("bookingOrders.detail.charge")}</th>
                  <th scope="col" className="px-4 py-2 text-right font-medium">{t("bookingOrders.detail.invoiced")}</th>
                  <th scope="col" className="px-4 py-2"><span className="sr-only">{t("bookingOrders.detail.actions")}</span></th>
                </tr>
              </thead>
              <tbody>
                {d.participants.map((p) => {
                  const live = p.sessions_booked + p.sessions_requested;
                  return (
                    <tr key={p.participant_id} className={cn("border-b border-border-soft last:border-0", p.status === "cancelled" && "opacity-60")}>
                      <td className="px-4 py-2"><Link href={`/admin/athletes/${p.athlete.id}?tab=bookings`} className="text-ink hover:text-maroon">{p.athlete.first_name} {p.athlete.last_name}</Link>
                        {p.status === "cancelled" && <Badge tone="danger" className="ml-2">{t("bookingOrders.status.cancelled")}</Badge>}</td>
                      <td className="px-4 py-2 text-ink-2">{p.payer.name ?? "—"}{p.payer.kind !== "family" && <span className="block text-xs text-ink-3">{t.dynamic(`bookingOrders.payerKind.${p.payer.kind}`, undefined, p.payer.kind)}</span>}</td>
                      <td className="tnum px-4 py-2 text-right text-ink-2">{t("bookingOrders.detail.sessionsCell", { booked: p.sessions_booked, completed: p.sessions_completed, cancelled: p.sessions_cancelled })}
                        {p.sessions_requested > 0 && <span className="block text-xs text-warning">{t("bookingOrders.detail.requestsCount", { count: p.sessions_requested })}</span>}</td>
                      <td className="tnum px-4 py-2 text-right">{money(p.charge)}</td>
                      <td className="tnum px-4 py-2 text-right text-ink-2">{money(p.invoiced)}</td>
                      <td className="px-4 py-2 text-right">
                        {active && live > 0 && (
                          <Button type="button" size="sm" variant="ghost" disabled={busy}
                            onClick={() => open({ kind: "cancel", scope: "participant", id: p.participant_id, label: `${p.athlete.first_name} ${p.athlete.last_name}`,
                                                  invoiced: p.invoiced > 0, restore: null })}>
                            <XCircle className="h-4 w-4" aria-hidden /> {t("bookingOrders.actions.cancelPlayer")}
                          </Button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CardBody>
      </Card>

      {(panel?.kind === "cancel" && panel.scope === "participant") && (
        <CancelPanel t={t} busy={busy} setBusy={setBusy} orderId={o.id} panel={panel} intent={intent} isPackage={isPackage}
          onDone={done} onClose={() => open(null)} />
      )}

      <Card>
        <CardHeader><CardTitle><CalendarClock className="mr-1 inline h-4 w-4" aria-hidden />{t("bookingOrders.detail.dates")}</CardTitle>
          <span className="text-xs text-ink-3">{t("adminBooking.form.timeZone", { zone: f.timeZone })}</span></CardHeader>
        <CardBody className="space-y-3">
          {d.dates.length === 0 && <p className="text-sm text-ink-3">{t("bookingOrders.detail.noDates")}</p>}
          {d.dates.map((x) => {
            const live = x.bookings.filter((b) => b.status === "booked" || b.status === "requested");
            const key = x.session_id ?? x.bookings[0]?.booking_id;
            const zp = toWall(x.starts_at, f.timeZone);
            return (
              <div key={key} className="rounded-lg border border-line p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="font-medium text-ink">{f.date(x.starts_at, { weekday: true })} · {f.time(x.starts_at)}{x.ends_at ? `–${f.time(x.ends_at)}` : ""}</p>
                    <p className="text-xs text-ink-3">{[x.coach_name, x.location, x.capacity && x.capacity > 1 ? t("adminBooking.detail.participantsCount", { count: x.participants_count ?? 0, capacity: x.capacity }) : null].filter(Boolean).join(" · ")}
                      {x.session_status === "cancelled" && <> · <span className="text-danger">{t("bookingOrders.status.cancelled")}</span></>}</p>
                  </div>
                  {active && live.length > 0 && x.session_id && (
                    <div className="flex flex-wrap gap-1">
                      {x.event_id && <Link href={`/admin/schedule/${x.event_id}`} className="self-center text-xs text-maroon hover:underline">{t("adminBooking.detail.calendarEvent")}</Link>}
                      {live.some((b) => b.status === "booked") && (
                        <Button type="button" size="sm" variant="ghost" disabled={busy}
                          onClick={() => open({ kind: "reschedule", scope: "date", id: x.session_id!, label: `${f.date(x.starts_at)} ${f.time(x.starts_at)}`, date: zp.date, time: zp.time })}>
                          <CalendarClock className="h-4 w-4" aria-hidden /> {t("bookingOrders.actions.moveDate")}
                        </Button>
                      )}
                      <Button type="button" size="sm" variant="ghost" disabled={busy}
                        onClick={() => open({ kind: "cancel", scope: "date", id: x.session_id!, label: `${f.date(x.starts_at)} ${f.time(x.starts_at)}`,
                                              invoiced: live.some((b) => b.invoice_id), restore: live.every((b) => restoreByPolicy[b.booking_id]) })}>
                        <XCircle className="h-4 w-4" aria-hidden /> {t("bookingOrders.actions.cancelDate")}
                      </Button>
                    </div>
                  )}
                </div>
                {(panel?.kind === "cancel" && panel.scope === "date" && panel.id === x.session_id) && (
                  <CancelPanel t={t} busy={busy} setBusy={setBusy} orderId={o.id} panel={panel} intent={intent} isPackage={isPackage} onDone={done} onClose={() => open(null)} />
                )}
                {(panel?.kind === "reschedule" && panel.scope === "date" && panel.id === x.session_id) && (
                  <ReschedulePanel t={t} f={f} busy={busy} setBusy={setBusy} orderId={o.id} panel={panel} intent={intent} isAdmin={isAdmin} todayKey={todayKey}
                    coaches={coaches} spaces={spaces} onDone={done} onClose={() => open(null)} />
                )}
                <ul className="mt-2 divide-y divide-line-soft">
                  {x.bookings.map((b) => {
                    const bz = toWall(b.starts_at, f.timeZone);
                    return (
                      <li key={b.booking_id} className="py-2">
                        <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                          <Link href={`/admin/bookings/${b.booking_id}`} className={cn("hover:text-maroon", b.status === "cancelled" ? "text-ink-3 line-through" : "text-ink")}>{b.first_name} {b.last_name}</Link>
                          <span className="flex flex-wrap items-center gap-1.5">
                            <Badge tone={stateTone(bookingDisplayKey(b))}>{t.dynamic(`bookingWorkflow.state.${bookingDisplayKey(b)}`, undefined, b.status)}</Badge>
                            <Badge tone={billingTone(b.billing_status)}>{t.dynamic(`bookingWorkflow.billingStatus.${b.billing_status}`, undefined, b.billing_status)}</Badge>
                            {b.invoice_id && <Link href={`/admin/invoices/${b.invoice_id}`} className="tnum text-xs text-maroon hover:underline">{b.invoice_number}</Link>}
                            {b.billing_mode === "invoice" && b.price !== null && <span className="tnum text-xs text-ink-3">{money(b.price)}</span>}
                            {active && b.status === "booked" && (
                              <>
                                <Button type="button" size="sm" variant="ghost" disabled={busy} aria-label={t("bookingOrders.actions.moveBookingOf", { name: b.first_name })}
                                  onClick={() => open({ kind: "reschedule", scope: "booking", id: b.booking_id, label: `${b.first_name} ${b.last_name}`, date: bz.date, time: bz.time })}>
                                  <CalendarClock className="h-4 w-4" aria-hidden />
                                </Button>
                                <Button type="button" size="sm" variant="ghost" disabled={busy} aria-label={t("bookingOrders.actions.cancelBookingOf", { name: b.first_name })}
                                  onClick={() => open({ kind: "cancel", scope: "booking", id: b.booking_id, label: `${b.first_name} ${b.last_name} · ${f.date(b.starts_at)}`,
                                                        invoiced: Boolean(b.invoice_id), restore: restoreByPolicy[b.booking_id] ?? null })}>
                                  <XCircle className="h-4 w-4" aria-hidden />
                                </Button>
                              </>
                            )}
                          </span>
                        </div>
                        {b.cancel_reason && b.status === "cancelled" && <p className="text-xs text-ink-3">{b.cancel_reason}</p>}
                        {(panel?.kind === "cancel" && panel.scope === "booking" && panel.id === b.booking_id) && (
                          <CancelPanel t={t} busy={busy} setBusy={setBusy} orderId={o.id} panel={panel} intent={intent} isPackage={isPackage} onDone={done} onClose={() => open(null)} />
                        )}
                        {(panel?.kind === "reschedule" && panel.scope === "booking" && panel.id === b.booking_id) && (
                          <ReschedulePanel t={t} f={f} busy={busy} setBusy={setBusy} orderId={o.id} panel={panel} intent={intent} isAdmin={isAdmin} todayKey={todayKey}
                            coaches={coaches} spaces={spaces} onDone={done} onClose={() => open(null)} />
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
        </CardBody>
      </Card>

      <Card>
        <CardHeader><CardTitle><FileText className="mr-1 inline h-4 w-4" aria-hidden />{t("bookingOrders.detail.invoices")}</CardTitle></CardHeader>
        <CardBody className="p-0">
          {d.invoices.length === 0 ? <p className="px-5 py-4 text-sm text-ink-3">{t("bookingOrders.detail.noInvoices")}</p> : (
            <ul>
              {d.invoices.map((i) => (
                <li key={i.invoice_id} className="border-b border-border-soft px-5 py-3 last:border-0">
                  <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                    <span className="min-w-0">
                      <Link href={`/admin/invoices/${i.invoice_id}`} className="tnum font-medium text-maroon hover:underline">{i.number}</Link>
                      <span className="ml-2 text-ink-2">{i.payer_name ?? "—"}</span>
                      {i.other_orders && <span className="ml-2 text-xs text-ink-3">{t("bookingOrders.detail.sharedInvoice")}</span>}
                    </span>
                    <span className="flex flex-wrap items-center gap-2">
                      <Badge tone={i.status === "paid" ? "success" : i.status === "cancelled" || i.status === "void" ? "danger" : i.status === "draft" ? "warning" : "info"}>
                        {t.dynamic(`status.${i.status}`, undefined, i.status)}</Badge>
                      <span className="tnum text-ink">{f.money(i.due, i.currency)}</span>
                      {i.adjustments !== 0 && <span className="tnum text-xs text-ink-3">{t("bookingOrders.detail.adjusted", { amount: f.money(i.adjustments, i.currency) })}</span>}
                      <span className="tnum text-xs text-ink-3">{t("bookingOrders.detail.paidOf", { amount: f.money(i.paid, i.currency) })}</span>
                      {i.balance > 0 && i.status !== "draft" && (
                        <Button type="button" size="sm" variant="secondary" disabled={busy}
                          onClick={() => open({ kind: "payment", invoiceId: i.invoice_id, number: i.number, balance: i.balance, currency: i.currency })}>
                          <Wallet className="h-4 w-4" aria-hidden /> {t("bookingOrders.actions.recordPayment")}
                        </Button>
                      )}
                    </span>
                  </div>
                  {i.balance < 0 && <p className="mt-1 text-xs text-warning">{t("bookingOrders.detail.creditOwed", { amount: f.money(-i.balance, i.currency) })}</p>}
                  {(panel?.kind === "payment" && panel.invoiceId === i.invoice_id) && (
                    <PaymentPanel t={t} busy={busy} setBusy={setBusy} orderId={o.id} panel={panel} intent={intent} todayKey={todayKey} onDone={done} onClose={() => open(null)} />
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
type T = ReturnType<typeof useT>;
type F = ReturnType<typeof useFormat>;
type Intent = ReturnType<typeof useIntentId>;
type Common = { t: T; busy: boolean; setBusy: (b: boolean) => void; intent: Intent; onDone: (text?: string, tone?: "ok" | "warn") => void; onClose: () => void };

function toWall(iso: string, timeZone: string): { date: string; time: string } {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
    .formatToParts(new Date(iso));
  const g = (k: string) => parts.find((p) => p.type === k)?.value ?? "";
  return { date: `${g("year")}-${g("month")}-${g("day")}`, time: `${g("hour")}:${g("minute")}` };
}

function PanelBox({ title, children, onClose, t }: { title: string; children: React.ReactNode; onClose: () => void; t: T }) {
  return (
    <div className="mt-2 space-y-3 rounded-lg border border-maroon/30 bg-surface-elevated p-3 text-sm">
      <div className="flex items-center justify-between gap-2"><p className="font-medium text-ink">{title}</p>
        <Button type="button" size="sm" variant="ghost" onClick={onClose}>{t("common.cancel")}</Button></div>
      {children}
    </div>
  );
}

function InvoicePanel({ t, busy, setBusy, intent, onDone, onClose, onError, orderId, payers }: Common & { orderId: string; payers: number; onError: (text: string) => void }) {
  const [send, setSend] = React.useState(true);
  const [missing, setMissing] = React.useState<string[] | null>(null);
  async function go() {
    setBusy(true);
    const res = await createOrderInvoices([orderId], intent.get(), send);
    setBusy(false);
    if (!res.ok) { onError(res.error); return; }
    const d = res.data!;
    if (!d.ok) { setMissing(d.setup_missing); return; }
    onDone(res.message);
  }
  return (
    <PanelBox title={t("bookingOrders.actions.createInvoices")} onClose={onClose} t={t}>
      <p className="text-ink-2">{t("bookingOrders.invoice.hint", { count: payers })}</p>
      <label className="flex items-center gap-2 text-ink-2">
        <input type="checkbox" className="h-4 w-4 accent-[var(--red-primary)]" checked={send} onChange={(e) => setSend(e.target.checked)} />
        {t("bookingOrders.invoice.issue")}
      </label>
      <FieldHint>{send ? t("bookingOrders.invoice.issueHint") : t("bookingOrders.invoice.draftHint")}</FieldHint>
      {missing && (
        <div role="alert" className="rounded border border-warning/30 bg-warning-soft p-2 text-warning">
          <ul className="list-disc pl-5">{missing.map((c) => <li key={c}>{t.dynamic(`bookingWorkflow.setup.${c}`, undefined, c)}</li>)}</ul>
          <Link href="/admin/settings/billing-entities" className="text-xs underline">{t("adminBooking.quote.fixEntities")}</Link>
        </div>
      )}
      <Button type="button" size="sm" disabled={busy} onClick={go}>{busy ? t("common.saving") : t("bookingOrders.invoice.create")}</Button>
    </PanelBox>
  );
}

function PaymentPanel({ t, busy, setBusy, intent, onDone, onClose, orderId, panel, todayKey }: Common & {
  orderId: string; todayKey: string; panel: Extract<Panel, { kind: "payment" }>;
}) {
  const [amount, setAmount] = React.useState(String(panel.balance));
  const [method, setMethod] = React.useState("bank_transfer");
  const [receivedOn, setReceivedOn] = React.useState(todayKey);
  const [reference, setReference] = React.useState("");
  const [err, setErr] = React.useState<string | null>(null);
  async function go() {
    setBusy(true); setErr(null);
    const res = await recordOrderPayment(orderId, panel.invoiceId, { amount: Number(amount), method: method as "bank_transfer", receivedOn, reference }, intent.get());
    setBusy(false);
    if (!res.ok) { setErr(res.error); return; }
    onDone(res.message);
  }
  return (
    <PanelBox title={t("bookingOrders.payment.title", { number: panel.number })} onClose={onClose} t={t}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div><Label htmlFor="op-amount">{t("bookingOrders.payment.amount", { currency: panel.currency })}</Label>
          <Input id="op-amount" type="number" min={0.05} step="0.05" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
        <div><Label htmlFor="op-method">{t("bookingOrders.payment.method")}</Label>
          <Select id="op-method" value={method} onChange={(e) => setMethod(e.target.value)}>
            {["bank_transfer", "qr_bill", "twint", "card", "manual"].map((m) => <option key={m} value={m}>{t.dynamic(`adminBooking.methods.${m}`, undefined, m)}</option>)}
          </Select></div>
        <div><Label htmlFor="op-date">{t("bookingOrders.payment.receivedOn")}</Label>
          <Input id="op-date" type="date" max={todayKey} value={receivedOn} onChange={(e) => setReceivedOn(e.target.value)} /></div>
        <div><Label htmlFor="op-ref">{t("bookingOrders.payment.reference")}</Label>
          <Input id="op-ref" maxLength={140} value={reference} onChange={(e) => setReference(e.target.value)} /></div>
      </div>
      {err && <p role="alert" className="text-danger">{err}</p>}
      <Button type="button" size="sm" disabled={busy || !(Number(amount) > 0)} onClick={go}>{busy ? t("common.saving") : t("bookingOrders.actions.recordPayment")}</Button>
    </PanelBox>
  );
}

function CancelPanel({ t, busy, setBusy, intent, onDone, onClose, orderId, panel, isPackage }: Common & {
  orderId: string; isPackage: boolean; panel: Extract<Panel, { kind: "cancel" }>;
}) {
  const [reason, setReason] = React.useState("");
  const [refund, setRefund] = React.useState<"credit_note" | "none">("credit_note");
  const [restore, setRestore] = React.useState<"policy" | "yes" | "no">("policy");
  const [err, setErr] = React.useState<string | null>(null);
  async function go() {
    setBusy(true); setErr(null);
    const res = await cancelOrderPart({
      orderId, scope: panel.scope, reason, refundMode: refund,
      bookingId: panel.scope === "booking" ? panel.id : null, participantId: panel.scope === "participant" ? panel.id : null,
      sessionId: panel.scope === "date" ? panel.id : null,
      restorePackage: restore === "policy" ? null : restore === "yes",
    }, intent.get());
    setBusy(false);
    if (!res.ok) { setErr(res.error); return; }
    onDone(res.message);
  }
  return (
    <PanelBox title={t.dynamic(`bookingOrders.cancel.title.${panel.scope}`, { label: panel.label }, panel.label)} onClose={onClose} t={t}>
      <p className="text-ink-2">{t.dynamic(`bookingOrders.cancel.hint.${panel.scope}`, undefined, "")}</p>
      <div><Label htmlFor="oc-reason">{t("bookingOrders.cancel.reason")}</Label>
        <Textarea id="oc-reason" maxLength={500} rows={2} value={reason} onChange={(e) => setReason(e.target.value)} /></div>
      {panel.invoiced && (
        <fieldset className="space-y-1">
          <legend className="text-[11px] font-medium uppercase tracking-[0.12em] text-text-muted">{t("bookingOrders.cancel.invoice")}</legend>
          <label className="flex items-center gap-2 text-ink-2"><input type="radio" className="accent-[var(--red-primary)]" checked={refund === "credit_note"} onChange={() => setRefund("credit_note")} />{t("bookingOrders.cancel.creditNote")}</label>
          <label className="flex items-center gap-2 text-ink-2"><input type="radio" className="accent-[var(--red-primary)]" checked={refund === "none"} onChange={() => setRefund("none")} />{t("bookingOrders.cancel.keepCharge")}</label>
        </fieldset>
      )}
      {isPackage && (
        <fieldset className="space-y-1">
          <legend className="text-[11px] font-medium uppercase tracking-[0.12em] text-text-muted">{t("bookingOrders.cancel.package")}</legend>
          <label className="flex items-center gap-2 text-ink-2"><input type="radio" className="accent-[var(--red-primary)]" checked={restore === "policy"} onChange={() => setRestore("policy")} />
            {panel.restore === null ? t("bookingOrders.cancel.policy") : panel.restore ? t("bookingOrders.cancel.policyRestores") : t("bookingOrders.cancel.policyKeeps")}</label>
          <label className="flex items-center gap-2 text-ink-2"><input type="radio" className="accent-[var(--red-primary)]" checked={restore === "yes"} onChange={() => setRestore("yes")} />{t("bookingOrders.cancel.restore")}</label>
          <label className="flex items-center gap-2 text-ink-2"><input type="radio" className="accent-[var(--red-primary)]" checked={restore === "no"} onChange={() => setRestore("no")} />{t("bookingOrders.cancel.noRestore")}</label>
        </fieldset>
      )}
      {err && <p role="alert" className="flex items-center gap-1.5 text-danger"><AlertTriangle className="h-4 w-4" aria-hidden />{err}</p>}
      <Button type="button" size="sm" variant="danger" disabled={busy || reason.trim().length === 0} onClick={go}>{busy ? t("common.saving") : t("bookingOrders.cancel.confirm")}</Button>
    </PanelBox>
  );
}

function ReschedulePanel({ t, f, busy, setBusy, intent, onDone, onClose, orderId, panel, isAdmin, todayKey, coaches, spaces }: Common & {
  f: F; orderId: string; isAdmin: boolean; todayKey: string; coaches: CoachOption[]; spaces: SpaceOption[];
  panel: Extract<Panel, { kind: "reschedule" }>;
}) {
  const [date, setDate] = React.useState(panel.date);
  const [time, setTime] = React.useState(panel.time);
  const [coachId, setCoachId] = React.useState("");
  const [spaceId, setSpaceId] = React.useState("");
  const [override, setOverride] = React.useState(false);
  const [overrideReason, setOverrideReason] = React.useState("");
  const [err, setErr] = React.useState<string | null>(null);
  async function go() {
    const startsAt = slotInstant(date, time, f.timeZone);
    if (!startsAt) return;
    setBusy(true); setErr(null);
    const res = await rescheduleOrderPart({
      orderId, scope: panel.scope, bookingId: panel.scope === "booking" ? panel.id : null, sessionId: panel.scope === "date" ? panel.id : null,
      startsAt, coachId: coachId || null, venueSpaceId: spaceId || null, overrideAvailability: override, overrideReason: override ? overrideReason : null,
    }, intent.get());
    setBusy(false);
    if (!res.ok) { setErr(res.error); return; }
    onDone(res.message);
  }
  return (
    <PanelBox title={t.dynamic(`bookingOrders.reschedule.title.${panel.scope}`, { label: panel.label }, panel.label)} onClose={onClose} t={t}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div><Label htmlFor="or-date">{t("adminBooking.form.date")}</Label><Input id="or-date" type="date" min={todayKey} value={date} onChange={(e) => setDate(e.target.value)} /></div>
        <div><Label htmlFor="or-time">{t("adminBooking.form.time")}</Label><Input id="or-time" type="time" step={300} value={time} onChange={(e) => setTime(e.target.value)} /></div>
        <div><Label htmlFor="or-coach">{t("adminBooking.form.coach")}</Label>
          <Select id="or-coach" value={coachId} onChange={(e) => setCoachId(e.target.value)}>
            <option value="">{t("bookingOrders.reschedule.sameCoach")}</option>
            {coaches.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select></div>
        <div><Label htmlFor="or-space">{t("adminBooking.form.facility")}</Label>
          <Select id="or-space" value={spaceId} onChange={(e) => setSpaceId(e.target.value)}>
            <option value="">{t("bookingOrders.reschedule.sameSpace")}</option>
            {spaces.map((sp) => <option key={sp.id} value={sp.id}>{sp.venueName ? `${sp.venueName} · ${sp.name}` : sp.name}</option>)}
          </Select></div>
      </div>
      {isAdmin && (
        <div className="space-y-2">
          <label className="flex items-center gap-2 text-ink-2"><input type="checkbox" className="h-4 w-4 accent-[var(--red-primary)]" checked={override} onChange={(e) => setOverride(e.target.checked)} />{t("adminBooking.form.overrideAvailability")}</label>
          {override && <Input aria-label={t("adminBooking.form.overrideReason")} placeholder={t("adminBooking.form.overrideReason")} maxLength={500} value={overrideReason} onChange={(e) => setOverrideReason(e.target.value)} />}
        </div>
      )}
      <FieldHint>{t("bookingOrders.reschedule.hint")}</FieldHint>
      {err && <p role="alert" className="text-danger">{err}</p>}
      <Button type="button" size="sm" disabled={busy || !date || !time || (override && !overrideReason.trim())} onClick={go}>{busy ? t("common.saving") : t("bookingOrders.reschedule.confirm")}</Button>
    </PanelBox>
  );
}

function SchedulePanel({ t, f, busy, setBusy, intent, onDone, onClose, detail, coaches, spaces, isAdmin, todayKey }: Common & {
  f: F; detail: OrderDetail; coaches: CoachOption[]; spaces: SpaceOption[]; isAdmin: boolean; todayKey: string;
}) {
  const o = detail.order;
  const [rows, setRows] = React.useState<{ key: string; date: string; time: string }[]>([{ key: "a", date: todayKey, time: "" }]);
  const [coachId, setCoachId] = React.useState(o.coach?.id ?? "");
  const [spaceId, setSpaceId] = React.useState(o.venue_space_id ?? "");
  const [players, setPlayers] = React.useState<string[]>(detail.participants.filter((p) => p.status === "active").map((p) => p.participant_id));
  const [override, setOverride] = React.useState(false);
  const [overrideReason, setOverrideReason] = React.useState("");
  const [checks, setChecks] = React.useState<OrderDateCheck[] | null>(null);
  const [errors, setErrors] = React.useState<string[]>([]);
  const [err, setErr] = React.useState<string | null>(null);
  const isGroup = o.option_kind === "group";
  const limit = detail.package ? detail.package.available : null;
  const dates = rows.map((r) => slotInstant(r.date, r.time, f.timeZone)).filter((v): v is string => Boolean(v));
  const input = (dryRun: boolean) => ({
    orderId: o.id, dates, participantIds: isGroup ? players : null, coachId: coachId || null, venueSpaceId: spaceId || null,
    overrideAvailability: override, overrideReason: override ? overrideReason : null, dryRun,
  });
  const key = JSON.stringify(input(true));
  React.useEffect(() => {
    if (dates.length === 0) { setChecks(null); setErrors([]); return; }
    let live = true;
    const h = window.setTimeout(async () => {
      const res = await addOrderDates(input(true), null);
      if (!live) return;
      if (res.ok) { const q = res.data as { dates?: OrderDateCheck[]; errors?: string[] }; setChecks(q.dates ?? []); setErrors(q.errors ?? []); }
      else { setChecks(null); setErrors([]); setErr(res.error); }
    }, 350);
    return () => { live = false; window.clearTimeout(h); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  async function go() {
    setBusy(true); setErr(null);
    const res = await addOrderDates(input(false), intent.get());
    setBusy(false);
    if (!res.ok) { setErr(res.error); return; }
    const d = res.data as { ok?: boolean; dates?: OrderDateCheck[] };
    if (d.ok === false) { setChecks(d.dates ?? null); setErr(res.message ?? ""); return; }
    onDone(res.message);
  }
  const ok = dates.length > 0 && errors.length === 0 && (checks?.every((c) => c.ok) ?? false);
  return (
    <Card>
      <CardBody>
        <PanelBox title={limit !== null ? t("bookingOrders.schedule.titlePackage", { count: limit }) : t("bookingOrders.schedule.title")} onClose={onClose} t={t}>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div><Label htmlFor="os-coach">{t("adminBooking.form.coach")}</Label>
              <Select id="os-coach" value={coachId} onChange={(e) => setCoachId(e.target.value)}>{coaches.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></div>
            <div><Label htmlFor="os-space">{t("adminBooking.form.facility")}</Label>
              <Select id="os-space" value={spaceId} onChange={(e) => setSpaceId(e.target.value)}>
                <option value="">{t("adminBooking.form.noSpace")}</option>
                {spaces.map((sp) => <option key={sp.id} value={sp.id}>{sp.venueName ? `${sp.venueName} · ${sp.name}` : sp.name}</option>)}
              </Select></div>
          </div>
          {isGroup && (
            <fieldset>
              <legend className="mb-1 text-[11px] font-medium uppercase tracking-[0.12em] text-text-muted">{t("bookingOrders.form.players")}</legend>
              <div className="flex flex-wrap gap-1.5">
                {detail.participants.filter((p) => p.status === "active").map((p) => {
                  const on = players.includes(p.participant_id);
                  return <button key={p.participant_id} type="button" aria-pressed={on} onClick={() => setPlayers((xs) => on ? xs.filter((x) => x !== p.participant_id) : [...xs, p.participant_id])}
                    className={cn("rounded-full border px-2.5 py-1 text-xs", on ? "border-maroon bg-maroon/10 text-ink" : "border-line text-ink-3")}>{p.athlete.first_name} {p.athlete.last_name}</button>;
                })}
              </div>
            </fieldset>
          )}
          <ul className="space-y-2">
            {rows.map((r) => {
              const at = slotInstant(r.date, r.time, f.timeZone);
              const c = at ? checks?.find((x) => Date.parse(x.starts_at) === Date.parse(at)) : null;
              return (
                <li key={r.key} className="flex flex-wrap items-end gap-2">
                  <div><Label htmlFor={`os-d-${r.key}`}>{t("adminBooking.form.date")}</Label><Input id={`os-d-${r.key}`} type="date" min={todayKey} value={r.date} onChange={(e) => setRows((xs) => xs.map((x) => x.key === r.key ? { ...x, date: e.target.value } : x))} /></div>
                  <div><Label htmlFor={`os-t-${r.key}`}>{t("adminBooking.form.time")}</Label><Input id={`os-t-${r.key}`} type="time" step={300} value={r.time} onChange={(e) => setRows((xs) => xs.map((x) => x.key === r.key ? { ...x, time: e.target.value } : x))} /></div>
                  {rows.length > 1 && <Button type="button" size="sm" variant="ghost" aria-label={t("bookingOrders.form.removeDate")} onClick={() => setRows((xs) => xs.filter((x) => x.key !== r.key))}><XCircle className="h-4 w-4" aria-hidden /></Button>}
                  {c && (c.ok
                    ? <span className={cn("pb-2 text-xs", c.creates === "requested" ? "text-warning" : "text-success")}>{c.creates === "requested" ? t("bookingOrders.date.request") : t("bookingOrders.date.available")}</span>
                    : <span role="alert" className="pb-2 text-xs text-danger">{[...c.errors, ...c.athlete_errors.map((e) => e.code)].map((e) => t.dynamic(`bookingWorkflow.errors.${e}`, undefined, e)).join(" · ")}</span>)}
                </li>
              );
            })}
          </ul>
          <Button type="button" size="sm" variant="secondary" disabled={limit !== null && rows.length >= limit}
            onClick={() => setRows((xs) => [...xs, { key: Math.random().toString(36).slice(2), date: xs[xs.length - 1]?.date ?? todayKey, time: xs[xs.length - 1]?.time ?? "" }])}>
            <CalendarPlus className="h-4 w-4" aria-hidden /> {t("bookingOrders.form.addDate")}
          </Button>
          {errors.length > 0 && <ul role="alert" className="text-danger">{errors.map((e) => <li key={e}>{t.dynamic(`bookingWorkflow.errors.${e}`, undefined, e)}</li>)}</ul>}
          {isAdmin && (
            <div className="space-y-2">
              <label className="flex items-center gap-2 text-ink-2"><input type="checkbox" className="h-4 w-4 accent-[var(--red-primary)]" checked={override} onChange={(e) => setOverride(e.target.checked)} />{t("adminBooking.form.overrideAvailability")}</label>
              {override && <Input aria-label={t("adminBooking.form.overrideReason")} placeholder={t("adminBooking.form.overrideReason")} maxLength={500} value={overrideReason} onChange={(e) => setOverrideReason(e.target.value)} />}
            </div>
          )}
          <FieldHint>{isGroup ? t("bookingOrders.schedule.groupHint") : t("bookingOrders.schedule.packageHint")}</FieldHint>
          {err && <p role="alert" className="text-danger">{err}</p>}
          <Button type="button" size="sm" disabled={busy || !ok || (override && !overrideReason.trim())} onClick={go}>{busy ? t("common.saving") : t("bookingOrders.schedule.confirm", { count: dates.length })}</Button>
        </PanelBox>
      </CardBody>
    </Card>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return <div className="flex items-start justify-between gap-3"><span className="text-ink-3">{label}</span><span className="text-right text-ink">{value}</span></div>;
}

function Stat({ label, value }: { label: string; value: number }) {
  return <div className="rounded-lg border border-line p-2"><p className="tnum text-xl text-ink">{value}</p><p className="text-xs text-ink-3">{label}</p></div>;
}
