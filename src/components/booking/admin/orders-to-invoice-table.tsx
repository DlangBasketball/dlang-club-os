"use client";
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CheckCircle2, FileText } from "lucide-react";
import { Badge, Button } from "@/components/ui";
import { createOrderInvoices } from "@/lib/actions/booking-orders";
import type { OrderToInvoice } from "@/lib/booking/orders";
import { newRequestId } from "@/lib/billing/request-id";
import { categoryLabelKey } from "@/lib/billing/activities";
import { useFormat, useT } from "@/lib/i18n/client";

type RowState = { status: "idle" | "busy" | "done" | "error"; text?: string };

/**
 * Finance "To Invoice" — booking orders with confirmed charges not yet
 * invoiced. "Create invoices" makes one invoice per payer of the order;
 * several selected orders of ONE revenue category can be invoiced together
 * (the server refuses mixed categories: CATEGORY_MIXED). Each action keeps
 * its request id while the page is open, so a retry never invoices twice.
 */
export function OrdersToInvoiceTable({ rows }: { rows: OrderToInvoice[] }) {
  const t = useT();
  const f = useFormat();
  const router = useRouter();
  const reqIds = React.useRef(new Map<string, string>());
  const [state, setState] = React.useState<Record<string, RowState>>({});
  const [selected, setSelected] = React.useState<string[]>([]);
  const [bulkMsg, setBulkMsg] = React.useState<{ ok: boolean; text: string } | null>(null);
  const idFor = (k: string) => { let id = reqIds.current.get(k); if (!id) { id = newRequestId(); reqIds.current.set(k, id); } return id; };
  const patch = (id: string, s: RowState) => setState((cur) => ({ ...cur, [id]: s }));

  async function invoice(ids: string[]) {
    const k = ids.slice().sort().join(",");
    ids.forEach((id) => patch(id, { status: "busy" }));
    const res = await createOrderInvoices(ids, idFor(k), true);
    const ok = res.ok && res.data?.ok;
    ids.forEach((id) => patch(id, ok ? { status: "done", text: res.message } : { status: "error", text: res.ok ? res.message : res.error }));
    if (ids.length > 1) setBulkMsg({ ok: Boolean(ok), text: (res.ok ? res.message : res.error) ?? "" });
    if (ok) { setSelected([]); router.refresh(); }
  }

  const cats = new Set(rows.filter((r) => selected.includes(r.order_id)).map((r) => r.billing_category));
  return (
    <div className="space-y-2">
      {selected.length > 1 && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Button type="button" size="sm" disabled={cats.size > 1} onClick={() => void invoice(selected)}>
            <FileText className="h-4 w-4" aria-hidden /> {t("bookingOrders.toInvoice.invoiceSelected", { count: selected.length })}
          </Button>
          {cats.size > 1 && <span className="text-warning">{t("bookingWorkflow.errors.CATEGORY_MIXED")}</span>}
        </div>
      )}
      {bulkMsg && <p role={bulkMsg.ok ? "status" : "alert"} className={bulkMsg.ok ? "text-sm text-success" : "text-sm text-danger"}>{bulkMsg.text}</p>}
      <div className="overflow-x-auto rounded-lg border border-line">
        <table className="w-full border-collapse text-[13.5px]">
          <caption className="sr-only">{t("bookingOrders.toInvoice.title")}</caption>
          <thead>
            <tr className="border-b border-border text-left text-[10.5px] uppercase tracking-[0.12em] text-text-muted">
              <th scope="col" className="px-3 py-2"><span className="sr-only">{t("bookingOrders.toInvoice.select")}</span></th>
              <th scope="col" className="px-3 py-2 font-medium">{t("bookingOrders.toInvoice.order")}</th>
              <th scope="col" className="px-3 py-2 font-medium">{t("bookingOrders.detail.participants")}</th>
              <th scope="col" className="px-3 py-2 font-medium">{t("adminBooking.detail.category")}</th>
              <th scope="col" className="px-3 py-2 text-right font-medium">{t("bookingOrders.toInvoice.amount")}</th>
              <th scope="col" className="px-3 py-2"><span className="sr-only">{t("bookingOrders.detail.actions")}</span></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const st = state[r.order_id];
              const blocked = r.setup_missing.length > 0;
              return (
                <tr key={r.order_id} className="border-b border-border-soft last:border-0">
                  <td className="px-3 py-2">
                    <input type="checkbox" aria-label={t("bookingOrders.toInvoice.selectOrder", { service: r.service_name })} className="h-4 w-4 accent-[var(--red-primary)]"
                      disabled={blocked || st?.status === "done"} checked={selected.includes(r.order_id)}
                      onChange={(e) => setSelected((xs) => e.target.checked ? [...xs, r.order_id] : xs.filter((x) => x !== r.order_id))} />
                  </td>
                  <td className="px-3 py-2">
                    <Link href={`/admin/bookings/orders/${r.order_id}`} className="font-medium text-ink hover:text-maroon">{r.service_name}</Link>
                    <span className="block text-xs text-ink-3">{[f.date(r.first_at), r.received_on ? t("bookingOrders.toInvoice.received", { date: f.date(r.received_on) }) : null].filter(Boolean).join(" · ")}</span>
                  </td>
                  <td className="px-3 py-2 text-ink-2">{(r.athletes ?? []).join(", ")}
                    {r.payers > 1 && <span className="block text-xs text-ink-3">{t("bookingOrders.toInvoice.payers", { count: r.payers })}</span>}</td>
                  <td className="px-3 py-2"><Badge tone="neutral">{t(categoryLabelKey(r.billing_category))}</Badge></td>
                  <td className="tnum px-3 py-2 text-right">{f.money(r.amount, r.currency)}</td>
                  <td className="px-3 py-2 text-right">
                    {st?.status === "done" ? <span className="inline-flex items-center gap-1 text-xs text-success"><CheckCircle2 className="h-3.5 w-3.5" aria-hidden /> {st.text}</span>
                      : blocked ? <Link href="/admin/settings/billing-entities" className="text-xs text-warning underline">{t("adminBooking.quote.setupTitle")}</Link>
                      : <Button type="button" size="sm" variant="secondary" disabled={st?.status === "busy"} onClick={() => void invoice([r.order_id])}>
                          <FileText className="h-4 w-4" aria-hidden /> {t("bookingOrders.actions.createInvoices")}</Button>}
                    {st?.status === "error" && <p role="alert" className="mt-1 text-xs text-danger">{st.text}</p>}
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
