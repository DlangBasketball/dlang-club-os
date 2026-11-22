import Link from "next/link";
import { Receipt } from "lucide-react";
import { PageHeader, Card, CardBody, Badge, statusTone, EmptyState, ErrorState } from "@/components/ui";
import { listInvoices } from "@/lib/data/invoices";
import { getI18n } from "@/lib/i18n/server";
import { getInvoiceCategories } from "@/lib/data/player-billing";
import { CategoryPill } from "@/components/player-billing/category-pill";

/**
 * Parent invoices. RLS returns only what this guardian may see: their
 * family's invoices without an individual payer, and the share invoices
 * where they are the payer (another payer's share never appears here).
 * Each row shows its number and revenue category.
 */
export default async function ParentInvoicesPage() {
  const [{ data, error }, { t, f }] = await Promise.all([listInvoices("all"), getI18n()]); // RLS scopes to the parent's family
  if (error) return (<div className="animate-fade-up"><PageHeader title={t("invoices.title")} /><ErrorState title={t("invoices.loadError")} message={error} /></div>);
  const rows = data!;
  const categories = await getInvoiceCategories(rows.map((r) => r.id));
  const pill = (id: string) => {
    const c = categories.get(id);
    return c ? <CategoryPill category={c.category} label={c.label} /> : null;
  };
  const open = rows.filter((r) => r.balance > 0 && r.status !== "cancelled");
  const settled = rows.filter((r) => r.balance <= 0 || r.status === "cancelled");

  return (
    <div className="animate-fade-up space-y-6">
      <PageHeader title={t("invoices.title")} description={t("invoices.description")} />

      {rows.length === 0 ? (
        <EmptyState icon={<Receipt className="h-5 w-5" />} title={t("invoices.empty")} description={t("invoices.emptyHint")} />
      ) : (
        <>
          {open.length > 0 && (
            <section>
              <h2 className="mb-2 text-sm font-medium text-ink-2">{t("invoices.open")}</h2>
              <div className="space-y-2">
                {open.map((r) => (
                  <Link key={r.id} href={`/parent/invoices/${r.id}`} className="block">
                    <Card className="transition hover:border-maroon/40">
                      <CardBody className="flex items-center justify-between py-4">
                        <div>
                          <div className="flex flex-wrap items-center gap-2"><span className="tnum font-medium text-ink">{r.number}</span>{pill(r.id)}</div>
                          <div className="text-xs text-ink-3">{t("invoices.due", { date: f.date(r.dueDate) })}</div>
                        </div>
                        <div className="flex items-center gap-3">
                          <span className="tnum text-sm text-ink">{f.money(r.balance, r.currency)}</span>
                          <Badge tone={statusTone(r.status)}>{t.dynamic(`status.${r.status}`, undefined, r.status.replace("_", " "))}</Badge>
                        </div>
                      </CardBody>
                    </Card>
                  </Link>
                ))}
              </div>
            </section>
          )}
          {settled.length > 0 && (
            <section>
              <h2 className="mb-2 text-sm font-medium text-ink-2">{t("invoices.settled")}</h2>
              <div className="space-y-2">
                {settled.map((r) => (
                  <Link key={r.id} href={`/parent/invoices/${r.id}`} className="block">
                    <Card className="opacity-80 transition hover:opacity-100">
                      <CardBody className="flex items-center justify-between py-3">
                        <span className="flex flex-wrap items-center gap-2"><span className="tnum text-sm text-ink-2">{r.number}</span>{pill(r.id)}</span>
                        <div className="flex items-center gap-3">
                          <span className="tnum text-sm text-ink-3">{f.money(r.total, r.currency)}</span>
                          <Badge tone={statusTone(r.status)}>{t.dynamic(`status.${r.status}`, undefined, r.status.replace("_", " "))}</Badge>
                        </div>
                      </CardBody>
                    </Card>
                  </Link>
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}
