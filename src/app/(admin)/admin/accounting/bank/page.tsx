import Link from "next/link";
import { redirect } from "next/navigation";
import { Card, CardBody, CardHeader, CardTitle, ErrorState, PageHeader } from "@/components/ui";
import { AccountingNav } from "@/components/accounting/accounting-nav";
import { BankUploadForm } from "@/components/accounting/bank-forms";
import { FinTable } from "@/components/finance/fin-table";
import { getSessionUser } from "@/lib/auth/get-user";
import { getI18n } from "@/lib/i18n/server";
import { listImports } from "@/lib/accounting/data";

export async function generateMetadata() {
  const { t } = await getI18n();
  return { title: t("accounting.bank.title") };
}

/** Upload a bank file (camt.053 / camt.054) and see the import history. */
export default async function BankImportPage() {
  const [me, { t, f }] = await Promise.all([getSessionUser(), getI18n()]);
  if (!me?.orgId || !(me.roles.includes("admin") || me.roles.includes("finance"))) redirect("/admin/dashboard");
  const imports = await listImports(me.orgId);

  return (
    <div className="animate-fade-up space-y-6">
      <PageHeader title={t("accounting.bank.title")} description={t("accounting.bank.description")} />
      <AccountingNav t={t} active="bank" />
      <Card>
        <CardHeader><CardTitle>{t("accounting.bank.upload")}</CardTitle></CardHeader>
        <CardBody className="space-y-2">
          <BankUploadForm />
          <p className="text-xs text-ink-3">{t("accounting.bank.autoBookHint")}</p>
        </CardBody>
      </Card>
      {imports.error !== null ? <ErrorState message={imports.error} /> : (
        <FinTable
          title={t("accounting.bank.history")} caption={t("accounting.bank.history")} rows={imports.data} rowKey={(r) => r.id} empty={t("accounting.bank.historyEmpty")}
          cols={[
            { key: "date", header: t("accounting.common.date"), cell: (r) => f.dateTime(r.created_at) },
            { key: "file", header: t("accounting.bank.fileName"), cell: (r) => <Link href={`/admin/accounting/bank/${r.id}`} className="text-ink hover:text-maroon">{r.file_name}</Link> },
            { key: "format", header: t("accounting.bank.format"), cell: (r) => r.format },
            { key: "period", header: t("accounting.bank.period"), cell: (r) => r.statement_from ? `${f.date(r.statement_from)} – ${f.date(r.statement_to ?? r.statement_from)}` : "—" },
            { key: "account", header: t("accounting.bank.account"), cell: (r) => r.account_last4 ? t("accounting.bank.accountLast4", { last4: r.account_last4 }) : "—" },
            { key: "entries", header: t("accounting.bank.entries"), align: "right", cell: (r) => f.number(r.entry_count) },
            { key: "booked", header: t("accounting.bank.bookedCount"), align: "right", cell: (r) => `${f.number(r.booked_count)} / ${f.number(r.entry_count)}` },
            { key: "total", header: t("accounting.common.amount"), align: "right", cell: (r) => r.currency ? f.money(Number(r.total_amount), r.currency) : f.number(Number(r.total_amount)) },
          ]}
        />
      )}
    </div>
  );
}
