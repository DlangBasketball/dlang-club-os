"use client";
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CheckCircle2, FileText } from "lucide-react";
import { Button } from "@/components/ui";
import { createBookingInvoice } from "@/lib/actions/booking-workflow";
import { newRequestId } from "@/lib/billing/request-id";
import type { SetupMissingCode } from "@/lib/booking/types";
import { useFormat, useT } from "@/lib/i18n/client";

export type ToInvoiceRow = {
  bookingId: string; slotStart: string; serviceName: string; serviceId: string; athleteName: string; athleteId: string;
  coachName: string; payerName: string | null; price: number | null; currency: string; setupMissing: boolean;
};

type RowState = { status: "idle" | "busy" | "done" | "error"; text?: string; invoiceId?: string; number?: string; setup?: SetupMissingCode[] };

/**
 * Confirmed billable bookings without an invoice. Each row has its own
 * request id for its whole life on the page, so a double click, a retry or
 * "Create all" running twice never creates a second invoice (the server
 * also allows only one invoice per booking).
 */
export function ToInvoiceTable({ rows }: { rows: ToInvoiceRow[] }) {
  const t = useT();
  const f = useFormat();
  const router = useRouter();
  const reqIds = React.useRef(new Map<string, string>());
  const [state, setState] = React.useState<Record<string, RowState>>({});
  const [running, setRunning] = React.useState(false);
  const idFor = (bookingId: string) => {
    let id = reqIds.current.get(bookingId);
    if (!id) { id = newRequestId(); reqIds.current.set(bookingId, id); }
    return id;
  };
  const patch = (id: string, s: RowState) => setState((cur) => ({ ...cur, [id]: s }));

  async function createOne(r: ToInvoiceRow, send: boolean): Promise<boolean> {
    const cur = state[r.bookingId];
    if (cur?.status === "busy" || cur?.status === "done") return cur.status === "done";
    patch(r.bookingId, { status: "busy" });
    const res = await createBookingInvoice(r.bookingId, idFor(r.bookingId), send);
    if (!res.ok) { patch(r.bookingId, { status: "error", text: res.error }); return false; }
    const d = res.data!;
    if (!d.ok) { patch(r.bookingId, { status: "error", text: res.message, setup: d.setup_missing }); return false; }
    patch(r.bookingId, { status: "done", text: res.message, invoiceId: d.invoice_id, number: d.number });
    return true;
  }

  async function createAll() {
    if (running) return;
    setRunning(true);
    for (const r of rows) {
      if (r.setupMissing) continue;
      if (state[r.bookingId]?.status === "done") continue;
      await createOne(r, false);
    }
    setRunning(false);
    router.refresh();
  }

  const pending = rows.filter((r) => !r.setupMissing && state[r.bookingId]?.status !== "done").length;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-ink-3">{t("adminBooking.toInvoice.bulkHint")}</p>
        <Button size="sm" variant="secondary" disabled={running || pending === 0} onClick={createAll}>
          <FileText className="h-4 w-4" /> {running ? t("common.saving") : t("adminBooking.toInvoice.createAll", { count: pending })}
        </Button>
      </div>
      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full border-collapse text-[13.5px]">
          <caption className="sr-only">{t("adminBooking.toInvoice.title")}</caption>
          <thead>
            <tr className="border-b border-border bg-bg-secondary text-left text-[10.5px] uppercase tracking-[0.12em] text-text-muted">
              <th scope="col" className="px-4 py-2.5 font-medium">{t("adminBooking.list.appointment")}</th>
              <th scope="col" className="px-4 py-2.5 font-medium">{t("adminBooking.list.athlete")}</th>
              <th scope="col" className="px-4 py-2.5 font-medium">{t("adminBooking.list.payer")}</th>
              <th scope="col" className="px-4 py-2.5 text-right font-medium">{t("adminBooking.detail.amount")}</th>
              <th scope="col" className="px-4 py-2.5 font-medium">{t("common.actions")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const st = state[r.bookingId] ?? { status: "idle" };
              return (
                <tr key={r.bookingId} className="border-b border-border-soft last:border-0 align-top">
                  <td className="px-4 py-2.5">
                    <Link href={`/admin/bookings/${r.bookingId}`} className="block text-ink hover:text-maroon">{f.date(r.slotStart, { weekday: true })} · {f.time(r.slotStart)}</Link>
                    <span className="block text-xs text-ink-3">{r.serviceName} · {r.coachName}</span>
                  </td>
                  <td className="px-4 py-2.5"><Link href={`/admin/athletes/${r.athleteId}?tab=bookings`} className="text-ink hover:text-maroon">{r.athleteName}</Link></td>
                  <td className="px-4 py-2.5 text-ink-2">{r.payerName ?? t("adminBooking.list.familyPayer")}</td>
                  <td className="tnum px-4 py-2.5 text-right">{r.price !== null ? f.money(r.price, r.currency) : "—"}</td>
                  <td className="px-4 py-2.5">
                    {st.status === "done" ? (
                      <span className="inline-flex items-center gap-1.5 text-success"><CheckCircle2 className="h-4 w-4" />
                        {st.invoiceId ? <Link href={`/admin/invoices/${st.invoiceId}`} className="font-mono hover:underline">{st.number}</Link> : st.text}</span>
                    ) : r.setupMissing ? (
                      <Link href={`/admin/services/${r.serviceId}`} className="text-xs text-warning underline">{t("adminBooking.toInvoice.setupMissing")}</Link>
                    ) : (
                      <span className="flex flex-col items-start gap-1">
                        <span className="flex flex-wrap gap-1.5">
                          <Button size="sm" disabled={st.status === "busy" || running} onClick={() => void createOne(r, true).then(() => router.refresh())}>{t("adminBooking.toInvoice.createSend")}</Button>
                          <Button size="sm" variant="secondary" disabled={st.status === "busy" || running} onClick={() => void createOne(r, false).then(() => router.refresh())}>{t("adminBooking.toInvoice.createDraft")}</Button>
                        </span>
                        {st.status === "error" && <span role="alert" className="text-xs text-danger">{st.text}{st.setup?.length ? ` ${st.setup.map((c) => t.dynamic(`bookingWorkflow.setup.${c}`, undefined, c)).join(" ")}` : ""}</span>}
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
