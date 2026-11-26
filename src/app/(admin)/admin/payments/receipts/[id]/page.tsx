import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Badge, Card, CardBody, CardHeader, CardTitle, ErrorState, PageHeader, statusTone } from "@/components/ui";
import { getSessionUser } from "@/lib/auth/get-user";
import { getI18n } from "@/lib/i18n/server";
import { getReceipt } from "@/lib/data/billing";
import { getPayerContext, isUuid } from "@/lib/data/player-billing";
import { CategoryPill } from "@/components/player-billing/category-pill";
import { AllocateReceiptForm, ReverseAllocationButton, VoidReceiptButton } from "@/components/player-billing/receipt-actions";

export async function generateMetadata() {
  const { t } = await getI18n();
  return { title: t("playerBilling.receipts.detailTitle") };
}

/**
 * One received amount: its allocations (each reversible through the payment
 * void) and the allocation form for what is still unallocated. Admin and
 * finance.
 */
export default async function ReceiptPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ family?: string }> }) {
  const [{ id }, sp, me, { t, f }] = await Promise.all([params, searchParams, getSessionUser(), getI18n()]);
  if (!me?.orgId || !(me.roles.includes("admin") || me.roles.includes("finance"))) redirect("/admin/dashboard");
  if (!isUuid(id)) notFound();
  const res = await getReceipt(id);
  if (res.error !== null) return <ErrorState title={t("playerBilling.errors.loadFailedTitle")} message={t("playerBilling.errors.loadFailed")} />;
  const r = res.data;
  if (!r) notFound();
  const familyId = r.familyId ?? (isUuid(sp.family) ? sp.family : null);
  const payer = familyId && r.unallocated > 0 && r.status !== "void" ? await getPayerContext(familyId) : null;
  const money = (n: number) => f.money(n, r.currency);
  const href = `/admin/payments/receipts/${r.id}`;

  return (
    <div className="animate-fade-up max-w-4xl space-y-5">
      <PageHeader
        eyebrow={<Link href="/admin/payments?view=receipts" className="hover:underline">{t("playerBilling.receipts.title")}</Link>}
        title={`${money(r.amount)} · ${f.date(r.receivedOn)}`}
        description={[r.payerName, t.dynamic(`roster.payments.methods.${r.method}`, undefined, r.method), r.reference].filter(Boolean).join(" · ")}
        actions={<Badge tone={statusTone(r.status)}>{t.dynamic(`playerBilling.receiptStatus.${r.status}`, undefined, r.status)}</Badge>}
      />
      <dl className="grid grid-cols-3 gap-3 text-sm">
        {([["received", r.amount], ["allocated", r.allocated], ["unallocated", r.unallocated]] as const).map(([k, v]) => (
          <div key={k} className="rounded-md border border-border bg-surface-elevated px-3 py-2">
            <dt className="text-[11px] uppercase tracking-[0.12em] text-text-muted">{t(`playerBilling.record.${k}`)}</dt>
            <dd className={`font-display text-lg tnum ${k === "unallocated" && v > 0 ? "text-warning" : "text-text"}`}>{money(v)}</dd>
          </div>
        ))}
      </dl>
      {r.note && <p className="text-sm text-text-secondary">{r.note}</p>}

      <Card>
        <CardHeader><CardTitle>{t("playerBilling.receipts.allocations")}</CardTitle></CardHeader>
        <CardBody className="p-0">
          {r.allocations.length === 0 ? <p className="px-5 py-4 text-sm text-text-muted">{t("playerBilling.receipts.noAllocations")}</p> : (
            <ul>
              {r.allocations.map((a) => (
                <li key={a.paymentId} className={`flex flex-wrap items-center justify-between gap-3 border-b border-border-soft px-5 py-2.5 last:border-0 ${a.voided ? "opacity-60" : ""}`}>
                  <span className="flex flex-wrap items-center gap-2 text-sm">
                    <Link href={`/admin/invoices/${a.invoiceId}`} className="tnum font-medium text-text hover:text-brand-primary">{a.invoiceNumber ?? "—"}</Link>
                    <CategoryPill category={a.activity} />
                    {a.voided && <Badge tone="neutral">{t("playerBilling.receipts.reversed")}</Badge>}
                  </span>
                  <span className="flex items-center gap-2">
                    <span className={`tnum text-sm ${a.voided ? "line-through" : ""}`}>{money(a.amount)}</span>
                    {!a.voided && r.status !== "void" && <ReverseAllocationButton paymentId={a.paymentId} label={a.invoiceNumber ?? ""} />}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      {r.status !== "void" && r.unallocated > 0 && (
        <Card>
          <CardHeader><CardTitle>{t("playerBilling.receipts.allocate")}</CardTitle></CardHeader>
          <CardBody>
            <AllocateReceiptForm receiptId={r.id} unallocated={r.unallocated} currency={r.currency} payer={payer?.data ?? null} receiptHref={href} />
          </CardBody>
        </Card>
      )}
      {r.status !== "void" && r.allocations.every((a) => a.voided) && <VoidReceiptButton receiptId={r.id} />}
    </div>
  );
}
