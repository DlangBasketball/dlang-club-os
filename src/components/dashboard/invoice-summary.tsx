import Link from "next/link";
import { Card, CardHeader, CardTitle, CardBody, ErrorState, SkeletonCard } from "@/components/ui";
import { getInvoiceSummary } from "@/lib/data/dashboard";
import { getI18n } from "@/lib/i18n/server";
import { totalsList } from "@/lib/payments/open-invoices";

export async function InvoiceSummary() {
  const { t, f } = await getI18n();
  const { data, error } = await getInvoiceSummary(f.timeZone);
  if (error) return <ErrorState title={t("dashboard.widgets.invoices.loadError")} message={error} />;
  const s = data!;
  const rows = [
    { key: "open", label: t("dashboard.widgets.invoices.open"), bucket: s.open, tone: "text-ink", href: "/admin/invoices?status=open" },
    { key: "overdue", label: t("dashboard.widgets.invoices.overdue"), bucket: s.overdue, tone: "text-danger", href: "/admin/invoices?status=overdue" },
  ];
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("dashboard.widgets.invoices.title")}</CardTitle>
        <Link href="/admin/invoices" className="text-xs text-maroon hover:underline">{t("dashboard.widgets.invoices.manage")}</Link>
      </CardHeader>
      <CardBody className="space-y-3">
        {rows.map((r) => (
          <Link key={r.key} href={r.href} className="flex items-center justify-between rounded-md bg-surface-elevated px-4 py-3 transition-colors hover:bg-surface-elevated/70">
            <div>
              <div className={`text-sm font-medium ${r.tone}`}>{r.label}</div>
              <div className="text-xs text-ink-3">{t("dashboard.widgets.invoices.count", { count: r.bucket.count })}</div>
            </div>
            <div className="text-right">
              {totalsList(r.bucket.totals, f.currency).map((m) => (
                <div key={m.currency} className="tnum text-lg font-semibold">{f.money(m.amount, m.currency)}</div>
              ))}
            </div>
          </Link>
        ))}
        <div className="flex items-center justify-between px-1 pt-1 text-xs text-ink-3">
          <span>{t("dashboard.widgets.invoices.paidAllTime")}</span>
          <span className="tnum text-ink-2">{f.number(s.paidCount)}</span>
        </div>
      </CardBody>
    </Card>
  );
}

export { SkeletonCard as InvoiceSummarySkeleton };
