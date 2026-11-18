import Link from "next/link";
import { redirect } from "next/navigation";
import { Plus } from "lucide-react";
import { Badge, Card, CardBody, CardHeader, CardTitle, ErrorState, PageHeader, buttonVariants, type BadgeProps } from "@/components/ui";
import { AccountingNav } from "@/components/accounting/accounting-nav";
import { PolicyForm, RefundProcessForm } from "@/components/accounting/admin-forms";
import { getSessionUser } from "@/lib/auth/get-user";
import { getI18n } from "@/lib/i18n/server";
import { listPolicies, listRefundRequests } from "@/lib/accounting/data";
import { PRODUCT_TYPES } from "@/lib/accounting/refunds";

export async function generateMetadata() {
  const { t } = await getI18n();
  return { title: t("accounting.refunds.title") };
}

const TONE: Record<string, BadgeProps["tone"]> = { requested: "warning", processing: "info", stripe_failed: "danger", completed: "success", rejected: "neutral" };

/** Refund & cancellation policies per product type, and the refund requests to settle. */
export default async function RefundsPage() {
  const [me, { t, f }] = await Promise.all([getSessionUser(), getI18n()]);
  if (!me?.orgId || !(me.roles.includes("admin") || me.roles.includes("finance"))) redirect("/admin/dashboard");
  const [policies, requests] = await Promise.all([listPolicies(me.orgId), listRefundRequests(me.orgId)]);
  const byType = new Map(policies.map((p) => [p.product_type, p]));
  const open = (requests.data ?? []).filter((r) => r.status === "requested" || r.status === "stripe_failed" || r.status === "processing");
  const closed = (requests.data ?? []).filter((r) => !open.includes(r));

  return (
    <div className="animate-fade-up space-y-6">
      <PageHeader title={t("accounting.refunds.title")} description={t("accounting.refunds.description")}
        actions={<Link href="/admin/accounting/refunds/new" className={buttonVariants({ variant: "secondary" })}><Plus className="h-4 w-4" aria-hidden /> {t("accounting.refunds.newTitle")}</Link>} />
      <AccountingNav t={t} active="refunds" />

      <section aria-labelledby="req-h" className="space-y-3">
        <h2 id="req-h" className="font-display text-lg text-ink">{t("accounting.refunds.requestsTitle")}</h2>
        {requests.error !== null ? <ErrorState message={requests.error} /> : open.length === 0 ? (
          <p className="text-sm text-ink-3">{t("accounting.refunds.requestsEmpty")}</p>
        ) : open.map((r) => (
          <Card key={r.id}>
            <CardBody className="space-y-3 py-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-ink">{r.familyName ?? "—"}</span>
                    <Badge tone={TONE[r.status]}>{t(`accounting.refunds.statuses.${r.status}`)}</Badge>
                    {r.medical && <Badge tone="info">{t("accounting.refunds.medical")}</Badge>}
                  </div>
                  <div className="text-sm text-ink-2">
                    {r.subject ?? t(`accounting.refunds.productTypes.${r.product_type as (typeof PRODUCT_TYPES)[number]}`)}
                    {r.invoice_id && <> · <Link href={`/admin/invoices/${r.invoice_id}`} className="tnum hover:text-maroon">{r.invoiceNumber}</Link></>}
                  </div>
                  <div className="mt-1 text-xs text-ink-3">
                    {t("accounting.refunds.requestedOn", { date: f.dateTime(r.requested_at) })}
                    {r.days_before != null && <> · {t("accounting.refunds.daysBefore", { days: r.days_before })}</>}
                    {r.preference && <> · {t(`accounting.refunds.resolutions.${r.preference}`)}</>}
                    {r.iban_last4 && <> · {t("accounting.refunds.ibanLast4", { last4: r.iban_last4 })}</>}
                  </div>
                  {r.reason && <p className="mt-1 text-sm text-ink-2">{r.reason}</p>}
                  {r.stripe_error && <p className="mt-1 text-xs text-danger">{r.stripe_error}</p>}
                </div>
                <div className="text-right text-sm">
                  <div className="text-ink-3">{t("accounting.refunds.computed", { percent: r.computed_percent })}</div>
                  <div className="tnum text-lg font-medium text-ink">{f.money(Number(r.final_amount ?? r.computed_amount), r.currency)}</div>
                  <div className="text-xs text-ink-3">{t("accounting.refunds.base", { amount: f.money(Number(r.base_amount), r.currency) })}</div>
                </div>
              </div>
              {r.status !== "processing" && (
                <RefundProcessForm requestId={r.id} computed={Number(r.final_amount ?? r.computed_amount)} currency={r.currency} preference={r.preference} status={r.status} />
              )}
            </CardBody>
          </Card>
        ))}
        {closed.length > 0 && (
          <details className="rounded-lg border border-border bg-surface p-3">
            <summary className="cursor-pointer text-sm text-ink-2">{t("accounting.refunds.history", { count: closed.length })}</summary>
            <ul className="mt-2 divide-y divide-line-soft text-sm">
              {closed.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span className="text-ink">{r.familyName ?? "—"} · {r.subject ?? r.invoiceNumber ?? ""}</span>
                  <span className="flex items-center gap-2">
                    <Badge tone={TONE[r.status]}>{t(`accounting.refunds.statuses.${r.status}`)}</Badge>
                    {r.resolution && r.resolution !== "none" && <span className="text-xs text-ink-3">{t.dynamic(`accounting.refunds.resolutions.${r.resolution}`)}</span>}
                    <span className="tnum">{f.money(Number(r.payout_amount ?? 0), r.currency)}</span>
                  </span>
                </li>
              ))}
            </ul>
          </details>
        )}
      </section>

      <section aria-labelledby="pol-h" className="space-y-3">
        <h2 id="pol-h" className="font-display text-lg text-ink">{t("accounting.refunds.policiesTitle")}</h2>
        <p className="text-sm text-ink-3">{t("accounting.refunds.policiesHint")}</p>
        <div className="grid gap-4 lg:grid-cols-2">
          {PRODUCT_TYPES.map((pt) => {
            const p = byType.get(pt);
            return (
              <Card key={pt}>
                <CardHeader><CardTitle>{t(`accounting.refunds.productTypes.${pt}`)}</CardTitle></CardHeader>
                <CardBody>
                  <PolicyForm initial={{
                    productType: pt, fullUntilDays: p?.full_until_days ?? null, partialPercent: p?.partial_percent ?? 0,
                    partialUntilDays: p?.partial_until_days ?? null, medicalMode: p?.medical_mode ?? "credit", medicalPercent: p?.medical_percent ?? 100,
                    notes: p?.notes ?? null, isActive: p?.is_active ?? true,
                  }} />
                </CardBody>
              </Card>
            );
          })}
        </div>
      </section>
    </div>
  );
}
