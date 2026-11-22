import Link from "next/link";
import { CreditCard } from "lucide-react";
import { Card, CardHeader, CardTitle, CardBody, Badge, statusTone, EmptyState, ErrorState, SkeletonCard } from "@/components/ui";
import { getRecentPayments } from "@/lib/data/dashboard";
import { getI18n } from "@/lib/i18n/server";

export async function RecentPayments() {
  const { t, f } = await getI18n();
  const { data, error } = await getRecentPayments(5);
  if (error) return <ErrorState title={t("dashboard.widgets.payments.loadError")} message={error} />;
  const payments = data!;
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("dashboard.widgets.payments.title")}</CardTitle>
        <Link href="/admin/payments" className="text-xs text-maroon hover:underline">{t("dashboard.widgets.payments.viewAll")}</Link>
      </CardHeader>
      <CardBody className="p-0">
        {payments.length === 0 ? (
          <div className="p-5"><EmptyState icon={<CreditCard className="h-5 w-5" />} title={t("dashboard.widgets.payments.empty")} /></div>
        ) : (
          <ul>
            {payments.map((p) => {
              const row = (
                <>
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-ink">{p.familyName}</div>
                    <div className="truncate text-xs text-ink-3">
                      <span className="tnum">{p.invoiceNumber}</span> · {t.dynamic(`payments.methods.${p.method}`, undefined, p.method)} · {f.relative(p.when)}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="tnum text-sm font-medium text-ink">{f.money(p.amount, p.currency ?? f.currency)}</span>
                    <Badge tone={statusTone(p.status)}>{t.dynamic(`status.${p.status}`, undefined, p.status)}</Badge>
                  </div>
                </>
              );
              return (
                <li key={p.id} className="border-b border-line-soft last:border-0">
                  {p.invoiceId ? (
                    <Link href={`/admin/invoices/${p.invoiceId}`} className="flex items-center justify-between gap-3 px-5 py-3 transition-colors hover:bg-surface-elevated/60">{row}</Link>
                  ) : (
                    <div className="flex items-center justify-between gap-3 px-5 py-3">{row}</div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}

export { SkeletonCard as RecentPaymentsSkeleton };
