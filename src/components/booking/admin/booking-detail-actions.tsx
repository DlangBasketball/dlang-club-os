"use client";
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CalendarClock, Copy, CreditCard, FileText, Link2, RefreshCw, Send, Wallet, XCircle } from "lucide-react";
import { Button, FieldHint, Input, Label } from "@/components/ui";
import { Select, Textarea } from "@/components/teams/fields";
import {
  cancelBooking, createBookingInvoice, recordBookingPayment, rescheduleBooking, retryBookingNotification, retryInvoiceEmail,
} from "@/lib/actions/booking-workflow";
import { bookingPaymentLink, listOpenSessions, sendBookingInvoice, type OpenSession } from "@/lib/actions/admin-booking";
import { RequestIds, slotInstant } from "@/lib/booking/admin-form";
import type { CoachOption, SpaceOption } from "@/lib/booking/admin-data";
import { REFUND_MODES, type RefundMode, type SetupMissingCode } from "@/lib/booking/types";
import { useFormat, useT } from "@/lib/i18n/client";

type Msg = { tone: "ok" | "err" | "warn"; text: string } | null;
type Panel = null | "invoice" | "payment" | "reschedule" | "cancel";

export type DetailActionProps = {
  bookingId: string; isAdmin: boolean; todayKey: string;
  canInvoice: boolean; canReschedule: boolean; canCancel: boolean;
  invoice: { id: string; number: string; status: string; balance: number; currency: string } | null;
  preview: {
    amount: number | null; currency: string; recipientName: string | null; recipientEmail: string | null; entityName: string | null;
    numberPreview: string | null; numberPrefix: string | null; categoryLabel: string; setupMissing: SetupMissingCode[]; serviceId: string;
  } | null;
  hasEntitlement: boolean; restoreByPolicy: boolean;
  isGroup: boolean; serviceId: string; coachId: string; coaches: CoachOption[]; spaces: SpaceOption[];
  slot: { date: string; time: string; venueSpaceId: string | null };
};

/** Role-gated booking actions (admin / finance): invoice, send, payment, payment link, reschedule, cancel. */
export function BookingDetailActions(p: DetailActionProps) {
  const t = useT();
  const f = useFormat();
  const router = useRouter();
  const ids = React.useRef(new RequestIds()).current;
  const [panel, setPanel] = React.useState<Panel>(null);
  const [busy, setBusy] = React.useState(false);
  const [msg, setMsg] = React.useState<Msg>(null);
  const [setupMissing, setSetupMissing] = React.useState<SetupMissingCode[] | null>(null);
  const [payUrl, setPayUrl] = React.useState<string | null>(null);

  const open = (x: Panel) => { setMsg(null); setSetupMissing(null); setPanel((cur) => (cur === x ? null : x)); };
  const done = (text?: string, tone: "ok" | "warn" = "ok") => { setPanel(null); if (text) setMsg({ tone, text }); router.refresh(); };

  // --- invoice ------------------------------------------------------------------
  async function createInvoice(send: boolean) {
    setBusy(true); setMsg(null); setSetupMissing(null);
    // One request id per "create invoice" intent: a double click or retry returns the same invoice.
    const res = await createBookingInvoice(p.bookingId, ids.get("invoice"), send);
    setBusy(false);
    if (!res.ok) { setMsg({ tone: "err", text: res.error }); return; }
    const d = res.data!;
    if (!d.ok) { setSetupMissing(d.setup_missing); setMsg({ tone: "err", text: res.message ?? "" }); return; }
    ids.settle("invoice");
    done(res.message, d.emailOk === false ? "warn" : "ok");
  }
  async function send() {
    setBusy(true); setMsg(null);
    const res = await sendBookingInvoice(p.bookingId);
    setBusy(false);
    if (!res.ok) { setMsg({ tone: "err", text: res.error }); return; }
    done(res.message, res.data?.emailOk === false ? "warn" : "ok");
  }
  async function paymentLink() {
    setBusy(true); setMsg(null);
    const res = await bookingPaymentLink(p.bookingId);
    setBusy(false);
    if (!res.ok) { setMsg({ tone: "err", text: res.error }); return; }
    setPayUrl(res.data!.url);
  }

  const invoiceOpen = p.invoice && !["cancelled", "refunded", "written_off", "paid"].includes(p.invoice.status);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {p.canInvoice && <Button size="sm" disabled={busy} onClick={() => open("invoice")}><FileText className="h-4 w-4" /> {t("adminBooking.detail.createInvoice")}</Button>}
        {p.invoice && invoiceOpen && (
          <Button size="sm" variant="secondary" disabled={busy} onClick={send}>
            <Send className="h-4 w-4" /> {p.invoice.status === "draft" ? t("adminBooking.detail.sendInvoice") : t("adminBooking.detail.resendInvoice")}
          </Button>
        )}
        {p.invoice && invoiceOpen && p.invoice.status !== "draft" && (
          <Button size="sm" variant="secondary" disabled={busy} onClick={() => open("payment")}><Wallet className="h-4 w-4" /> {t("adminBooking.detail.recordPayment")}</Button>
        )}
        {p.invoice && invoiceOpen && p.invoice.status !== "draft" && (
          <Button size="sm" variant="ghost" disabled={busy} onClick={paymentLink}><CreditCard className="h-4 w-4" /> {t("adminBooking.detail.paymentLink")}</Button>
        )}
        {p.canReschedule && <Button size="sm" variant="secondary" disabled={busy} onClick={() => open("reschedule")}><CalendarClock className="h-4 w-4" /> {t("adminBooking.detail.reschedule")}</Button>}
        {p.canCancel && <Button size="sm" variant="danger" disabled={busy} onClick={() => open("cancel")}><XCircle className="h-4 w-4" /> {t("adminBooking.detail.cancel")}</Button>}
      </div>

      {msg && (
        <p role={msg.tone === "err" ? "alert" : "status"} className={msg.tone === "err" ? "text-sm text-danger" : msg.tone === "warn" ? "text-sm text-warning" : "text-sm text-success"}>{msg.text}</p>
      )}
      {setupMissing && setupMissing.length > 0 && <SetupMissing codes={setupMissing} serviceId={p.serviceId} />}

      {payUrl && (
        <div className="space-y-2 rounded-lg border border-line p-3 text-sm">
          <p className="flex items-center gap-2 text-ink"><Link2 className="h-4 w-4" /> {t("adminBooking.detail.paymentLinkReady")}</p>
          <div className="flex gap-2">
            <Input readOnly value={payUrl} aria-label={t("adminBooking.detail.paymentLink")} onFocus={(e) => e.currentTarget.select()} />
            <Button type="button" size="sm" variant="secondary" onClick={() => void navigator.clipboard?.writeText(payUrl)}><Copy className="h-4 w-4" /> {t("common.copy")}</Button>
          </div>
          <FieldHint>{t("adminBooking.detail.paymentLinkHint")}</FieldHint>
        </div>
      )}

      {panel === "invoice" && p.preview && (
        <div className="space-y-3 rounded-lg border border-line p-3 text-sm">
          <p className="font-medium text-ink">{t("adminBooking.detail.invoicePreview")}</p>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
            <dt className="text-ink-3">{t("adminBooking.detail.recipient")}</dt><dd className="text-ink">{[p.preview.recipientName, p.preview.recipientEmail].filter(Boolean).join(" · ") || "—"}</dd>
            <dt className="text-ink-3">{t("adminBooking.detail.amount")}</dt><dd className="tnum text-ink">{p.preview.amount !== null ? f.money(p.preview.amount, p.preview.currency) : "—"}</dd>
            <dt className="text-ink-3">{t("adminBooking.detail.category")}</dt><dd className="text-ink">{p.preview.categoryLabel}</dd>
            <dt className="text-ink-3">{t("adminBooking.detail.entity")}</dt><dd className="text-ink">{p.preview.entityName ?? "—"}</dd>
            <dt className="text-ink-3">{t("adminBooking.detail.number")}</dt><dd className="font-mono text-ink">{p.preview.numberPreview ?? p.preview.numberPrefix ?? "—"}</dd>
          </dl>
          {p.preview.setupMissing.length > 0 ? <SetupMissing codes={p.preview.setupMissing} serviceId={p.serviceId} /> : (
            <>
              <FieldHint>{t("adminBooking.detail.invoiceHint")}</FieldHint>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" disabled={busy} onClick={() => createInvoice(true)}><Send className="h-4 w-4" /> {busy ? t("common.saving") : t("adminBooking.detail.createAndSend")}</Button>
                <Button size="sm" variant="secondary" disabled={busy} onClick={() => createInvoice(false)}>{t("adminBooking.detail.createDraft")}</Button>
                <Button size="sm" variant="ghost" disabled={busy} onClick={() => setPanel(null)}>{t("common.cancel")}</Button>
              </div>
            </>
          )}
        </div>
      )}

      {panel === "payment" && p.invoice && <PaymentPanel bookingId={p.bookingId} invoice={p.invoice} todayKey={p.todayKey} ids={ids} onDone={done} onCancel={() => setPanel(null)} />}
      {panel === "reschedule" && <ReschedulePanel {...p} ids={ids} onDone={done} onCancel={() => setPanel(null)} />}
      {panel === "cancel" && <CancelPanel {...p} ids={ids} onDone={done} onCancel={() => setPanel(null)} />}
    </div>
  );
}

function SetupMissing({ codes, serviceId }: { codes: SetupMissingCode[]; serviceId: string }) {
  const t = useT();
  return (
    <div role="alert" className="space-y-1 rounded border border-warning/30 bg-warning-soft p-3 text-sm text-warning">
      <p className="font-medium">{t("adminBooking.quote.setupTitle")}</p>
      <ul className="list-disc pl-5">{codes.map((c) => <li key={c}>{t.dynamic(`bookingWorkflow.setup.${c}`, undefined, c)}</li>)}</ul>
      <p className="text-xs">
        <Link href={`/admin/services/${serviceId}`} className="underline">{t("adminBooking.quote.fixService")}</Link>{" · "}
        <Link href="/admin/settings/billing-entities" className="underline">{t("adminBooking.quote.fixEntities")}</Link>
      </p>
    </div>
  );
}

const METHODS = ["bank_transfer", "twint", "qr_bill", "card", "manual"] as const;

function PaymentPanel({ bookingId, invoice, todayKey, ids, onDone, onCancel }: {
  bookingId: string; invoice: NonNullable<DetailActionProps["invoice"]>; todayKey: string; ids: RequestIds;
  onDone: (text?: string) => void; onCancel: () => void;
}) {
  const t = useT();
  const f = useFormat();
  const [v, setV] = React.useState({ amount: invoice.balance > 0 ? String(invoice.balance) : "", method: "bank_transfer" as (typeof METHODS)[number], receivedOn: todayKey, reference: "", note: "" });
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr(null);
    // The same request id until the payment is recorded: a retry after a timeout never books it twice.
    const res = await recordBookingPayment(bookingId, { ...v, amount: Number(v.amount) }, ids.get("payment"));
    setBusy(false);
    if (!res.ok) { setErr(res.error); return; }
    ids.settle("payment");
    onDone(res.message);
  }
  return (
    <form onSubmit={submit} className="space-y-3 rounded-lg border border-line p-3">
      <p className="text-sm text-ink-2">{t("adminBooking.detail.paymentBalance", { amount: f.money(invoice.balance, invoice.currency), number: invoice.number })}</p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div><Label htmlFor="bp-amt">{t("adminBooking.detail.amount")}</Label><Input id="bp-amt" type="number" min={0.01} step="0.01" required inputMode="decimal" value={v.amount} onChange={(e) => setV({ ...v, amount: e.target.value })} /></div>
        <div><Label htmlFor="bp-date">{t("adminBooking.detail.receivedOn")}</Label><Input id="bp-date" type="date" required max={todayKey} value={v.receivedOn} onChange={(e) => setV({ ...v, receivedOn: e.target.value })} /></div>
        <div><Label htmlFor="bp-m">{t("adminBooking.detail.method")}</Label>
          <Select id="bp-m" value={v.method} onChange={(e) => setV({ ...v, method: e.target.value as (typeof METHODS)[number] })}>
            {METHODS.map((m) => <option key={m} value={m}>{t.dynamic(`adminBooking.methods.${m}`, undefined, m)}</option>)}
          </Select></div>
        <div className="sm:col-span-3"><Label htmlFor="bp-ref">{t("adminBooking.detail.reference")}</Label><Input id="bp-ref" maxLength={200} value={v.reference} onChange={(e) => setV({ ...v, reference: e.target.value })} /></div>
      </div>
      <FieldHint>{t("adminBooking.detail.partialHint")}</FieldHint>
      {err && <p role="alert" className="text-sm text-danger">{err}</p>}
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={busy}>{busy ? t("common.saving") : t("adminBooking.detail.recordPayment")}</Button>
        <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={onCancel}>{t("common.cancel")}</Button>
      </div>
    </form>
  );
}

function ReschedulePanel(p: DetailActionProps & { ids: RequestIds; onDone: (text?: string) => void; onCancel: () => void }) {
  const t = useT();
  const f = useFormat();
  const [mode, setMode] = React.useState<"slot" | "join">("slot");
  const [v, setV] = React.useState({ date: p.slot.date, time: p.slot.time, coachId: p.coachId, venueSpaceId: p.slot.venueSpaceId ?? "", sessionId: "", override: false, overrideReason: "", notify: true });
  const [sessions, setSessions] = React.useState<OpenSession[]>([]);
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);
  React.useEffect(() => { if (p.isGroup) void listOpenSessions(p.serviceId).then((r) => setSessions(r.ok ? r.data ?? [] : [])); }, [p.isGroup, p.serviceId]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const startsAt = mode === "slot" ? slotInstant(v.date, v.time, f.timeZone) : null;
    if (mode === "slot" && !startsAt) { setErr(t("bookingWorkflow.errors.INVALID_TIME")); return; }
    if (mode === "join" && !v.sessionId) { setErr(t("bookingWorkflow.errors.SESSION_NOT_FOUND")); return; }
    setBusy(true); setErr(null);
    const res = await rescheduleBooking({
      bookingId: p.bookingId, startsAt, sessionId: mode === "join" ? v.sessionId : null, coachId: mode === "slot" ? v.coachId : null,
      venueSpaceId: mode === "slot" ? v.venueSpaceId || null : null, overrideAvailability: v.override, overrideReason: v.override ? v.overrideReason : null, notify: v.notify,
    }, p.ids.get("reschedule"));
    setBusy(false);
    if (!res.ok) { setErr(res.error); return; }
    p.ids.settle("reschedule");
    p.onDone(res.message);
  }
  return (
    <form onSubmit={submit} className="space-y-3 rounded-lg border border-line p-3">
      {p.isGroup && (
        <div className="flex flex-wrap gap-4 text-sm">
          <label className="flex items-center gap-2 text-ink-2"><input type="radio" className="accent-[var(--red-primary)]" checked={mode === "slot"} onChange={() => setMode("slot")} /> {t("adminBooking.detail.newSlot")}</label>
          <label className="flex items-center gap-2 text-ink-2"><input type="radio" className="accent-[var(--red-primary)]" checked={mode === "join"} onChange={() => setMode("join")} /> {t("adminBooking.detail.moveToSession")}</label>
        </div>
      )}
      {mode === "slot" ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div><Label htmlFor="rs-date">{t("adminBooking.form.date")}</Label><Input id="rs-date" type="date" required value={v.date} onChange={(e) => setV({ ...v, date: e.target.value })} /></div>
          <div><Label htmlFor="rs-time">{t("adminBooking.form.time")}</Label><Input id="rs-time" type="time" step={300} required value={v.time} onChange={(e) => setV({ ...v, time: e.target.value })} />
            <FieldHint>{t("adminBooking.form.timeZone", { zone: f.timeZone })}</FieldHint></div>
          <div><Label htmlFor="rs-coach">{t("adminBooking.form.coach")}</Label>
            <Select id="rs-coach" value={v.coachId} onChange={(e) => setV({ ...v, coachId: e.target.value })}>{p.coaches.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></div>
          <div><Label htmlFor="rs-space">{t("adminBooking.form.facility")}</Label>
            <Select id="rs-space" value={v.venueSpaceId} onChange={(e) => setV({ ...v, venueSpaceId: e.target.value })}>
              <option value="">{t("adminBooking.form.noSpace")}</option>
              {p.spaces.map((s) => <option key={s.id} value={s.id}>{s.venueName ? `${s.venueName} · ${s.name}` : s.name}</option>)}
            </Select></div>
        </div>
      ) : (
        <div className="space-y-1.5">
          {sessions.length === 0 && <p className="text-sm text-ink-3">{t("adminBooking.detail.noSessions")}</p>}
          {sessions.map((x) => (
            <label key={x.id} className={`flex items-center justify-between gap-3 rounded-lg border px-3 py-2 text-sm ${v.sessionId === x.id ? "border-maroon bg-maroon/10" : "border-line"} ${x.placesLeft === 0 ? "opacity-50" : ""}`}>
              <span className="flex items-center gap-2"><input type="radio" className="accent-[var(--red-primary)]" disabled={x.placesLeft === 0} checked={v.sessionId === x.id} onChange={() => setV({ ...v, sessionId: x.id })} />
                {f.date(x.startsAt, { weekday: true })} · {f.time(x.startsAt)}–{f.time(x.endsAt)}</span>
              <span className="text-xs text-ink-3">{[x.coachName, t("adminBooking.form.placesLeft", { count: x.placesLeft, capacity: x.capacity })].join(" · ")}</span>
            </label>
          ))}
        </div>
      )}
      {p.isAdmin && (
        <div className="space-y-2">
          <label className="flex items-center gap-2 text-sm text-ink-2"><input type="checkbox" className="h-4 w-4 accent-[var(--red-primary)]" checked={v.override} onChange={(e) => setV({ ...v, override: e.target.checked })} /> {t("adminBooking.form.overrideAvailability")}</label>
          {v.override && <Input required aria-label={t("adminBooking.form.overrideReason")} placeholder={t("adminBooking.form.overrideReason")} maxLength={500} value={v.overrideReason} onChange={(e) => setV({ ...v, overrideReason: e.target.value })} />}
        </div>
      )}
      <label className="flex items-center gap-2 text-sm text-ink-2"><input type="checkbox" className="h-4 w-4 accent-[var(--red-primary)]" checked={v.notify} onChange={(e) => setV({ ...v, notify: e.target.checked })} /> {t("adminBooking.form.notify")}</label>
      <FieldHint>{t("adminBooking.detail.rescheduleHint")}</FieldHint>
      {err && <p role="alert" className="text-sm text-danger">{err}</p>}
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={busy}>{busy ? t("common.saving") : t("adminBooking.detail.rescheduleConfirm")}</Button>
        <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={p.onCancel}>{t("common.cancel")}</Button>
      </div>
    </form>
  );
}

function CancelPanel(p: DetailActionProps & { ids: RequestIds; onDone: (text?: string, tone?: "ok" | "warn") => void; onCancel: () => void }) {
  const t = useT();
  const [reason, setReason] = React.useState("");
  const [refund, setRefund] = React.useState<RefundMode>("none");
  const [restore, setRestore] = React.useState<"policy" | "yes" | "no">("policy");
  const [notify, setNotify] = React.useState(true);
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!reason.trim()) { setErr(t("bookingWorkflow.errors.REASON_REQUIRED")); return; }
    setBusy(true); setErr(null);
    const res = await cancelBooking({
      bookingId: p.bookingId, reason, refundMode: p.invoice ? refund : "none",
      restorePackage: !p.hasEntitlement || restore === "policy" ? null : restore === "yes", notify,
    }, p.ids.get("cancel"));
    setBusy(false);
    if (!res.ok) { setErr(res.error); return; }
    p.ids.settle("cancel");
    p.onDone(p.invoice && refund === "none" ? `${res.message} ${t("adminBooking.detail.financeFollowUp")}` : res.message, p.invoice && refund === "none" ? "warn" : "ok");
  }
  return (
    <form onSubmit={submit} className="space-y-3 rounded-lg border border-danger/30 p-3">
      <div><Label htmlFor="bc-reason">{t("adminBooking.detail.cancelReason")}</Label><Textarea id="bc-reason" rows={2} required maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} /></div>
      {p.invoice && (
        <div><Label htmlFor="bc-refund">{t("adminBooking.detail.invoiceOnCancel")}</Label>
          <Select id="bc-refund" value={refund} onChange={(e) => setRefund(e.target.value as RefundMode)}>
            {REFUND_MODES.map((m) => <option key={m} value={m}>{t.dynamic(`adminBooking.refund.${m}`, undefined, m)}</option>)}
          </Select>
          <FieldHint>{t("adminBooking.detail.invoiceKeptHint", { number: p.invoice.number })}</FieldHint></div>
      )}
      {p.hasEntitlement && (
        <div><Label htmlFor="bc-restore">{t("adminBooking.detail.packageOnCancel")}</Label>
          <Select id="bc-restore" value={restore} onChange={(e) => setRestore(e.target.value as "policy" | "yes" | "no")}>
            <option value="policy">{p.restoreByPolicy ? t("adminBooking.detail.restorePolicyYes") : t("adminBooking.detail.restorePolicyNo")}</option>
            <option value="yes">{t("adminBooking.detail.restoreYes")}</option>
            <option value="no">{t("adminBooking.detail.restoreNo")}</option>
          </Select></div>
      )}
      <label className="flex items-center gap-2 text-sm text-ink-2"><input type="checkbox" className="h-4 w-4 accent-[var(--red-primary)]" checked={notify} onChange={(e) => setNotify(e.target.checked)} /> {t("adminBooking.form.notify")}</label>
      {err && <p role="alert" className="text-sm text-danger">{err}</p>}
      <div className="flex gap-2">
        <Button type="submit" size="sm" variant="danger" disabled={busy || !reason.trim()}>{busy ? t("common.saving") : t("adminBooking.detail.cancelConfirm")}</Button>
        <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={p.onCancel}>{t("adminBooking.detail.keep")}</Button>
      </div>
    </form>
  );
}

/** Retry one failed / no-contact booking notification or a failed invoice e-mail. */
export function RetryDeliveryButton({ id, kind }: { id: string; kind: "notification" | "invoiceEmail" }) {
  const t = useT();
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);
  async function run() {
    setBusy(true); setErr(null);
    const res = kind === "notification" ? await retryBookingNotification(id) : await retryInvoiceEmail(id);
    setBusy(false);
    if (!res.ok) { setErr(res.error); return; }
    router.refresh();
  }
  return (
    <span className="inline-flex items-center gap-2">
      <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={run}><RefreshCw className="h-3.5 w-3.5" /> {busy ? t("common.saving") : t("common.retry")}</Button>
      {err && <span role="alert" className="text-xs text-danger">{err}</span>}
    </span>
  );
}
