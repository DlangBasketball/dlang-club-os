import { redirect } from "next/navigation";
import { Badge, Card, CardBody, CardHeader, CardTitle, ErrorState, PageHeader } from "@/components/ui";
import { AccountingNav } from "@/components/accounting/accounting-nav";
import { AccountRowActions, AddAccountForm, MappingForm, SeedChartButton, type MappingField } from "@/components/accounting/admin-forms";
import { FinTable } from "@/components/finance/fin-table";
import { getSessionUser } from "@/lib/auth/get-user";
import { getI18n } from "@/lib/i18n/server";
import { getChart } from "@/lib/accounting/data";
import { CORE_MAPPING_KEYS, DEFAULT_MAPPINGS, INCOME_KINDS, type AccountType } from "@/lib/accounting/chart";

export async function generateMetadata() {
  const { t } = await getI18n();
  return { title: t("accounting.chart.title") };
}

/** Chart of accounts + mapping of club money events (and expense categories) to accounts and VAT codes. */
export default async function ChartPage() {
  const [me, { t }] = await Promise.all([getSessionUser(), getI18n()]);
  if (!me?.orgId || !(me.roles.includes("admin") || me.roles.includes("finance"))) redirect("/admin/dashboard");
  const res = await getChart(me.orgId);
  if (res.error !== null) return <div className="animate-fade-up"><PageHeader title={t("accounting.chart.title")} /><ErrorState message={res.error} /></div>;
  const { accounts, mappings, categories } = res.data;
  const map = new Map(mappings.map((m) => [m.key, m]));
  const field = (key: string, label: string, vatOnly = false): MappingField =>
    ({ key, label, account: map.get(key)?.account_number ?? null, vatCode: map.get(key)?.vat_code ?? null, vatOnly });
  const vatKeys = Array.from(new Set([...DEFAULT_MAPPINGS.filter((m) => m.key.startsWith("vat.")).map((m) => m.key), ...mappings.filter((m) => m.key.startsWith("vat.")).map((m) => m.key)]));
  const fields: MappingField[] = [
    ...CORE_MAPPING_KEYS.map((k) => field(k, t(`accounting.chart.keys.${k}`))),
    ...INCOME_KINDS.map((k) => field(`income.${k}`, t(`accounting.chart.income.${k}`))),
    field("expense.default", t("accounting.chart.expenseDefault")),
    ...categories.map((c) => field(`expense.${c.id}`, t("accounting.chart.expenseCategory", { name: c.name }))),
  ];
  const vatFields = vatKeys.map((k) => field(k, t("accounting.chart.vatRate", { rate: k.slice(4) }), true));
  const options = accounts.filter((a) => a.is_active).map((a) => ({ number: a.number, name: a.name }));

  return (
    <div className="animate-fade-up space-y-6">
      <PageHeader title={t("accounting.chart.title")} description={t("accounting.chart.description")} actions={<SeedChartButton />} />
      <AccountingNav t={t} active="chart" />
      <p className="text-xs text-ink-3">{t("accounting.chart.seedHint")}</p>

      <FinTable
        title={t("accounting.chart.accountsTitle")} caption={t("accounting.chart.accountsTitle")} rows={accounts} rowKey={(r) => r.id}
        empty={t("accounting.chart.accountsEmpty")}
        cols={[
          { key: "number", header: t("accounting.chart.number"), cell: (r) => <span className="tnum font-mono">{r.number}</span> },
          { key: "name", header: t("accounting.chart.name"), cell: (r) => r.name },
          { key: "type", header: t("accounting.chart.type"), cell: (r) => t.dynamic(`accounting.chart.types.${r.type}`) },
          { key: "active", header: t("accounting.common.status"), cell: (r) => <Badge tone={r.is_active ? "success" : "neutral"}>{r.is_active ? t("accounting.common.active") : t("accounting.common.inactive")}</Badge> },
          { key: "actions", header: t("accounting.common.actions"), align: "right", cell: (r) => <AccountRowActions id={r.id} number={r.number} name={r.name} type={r.type as AccountType} active={r.is_active} /> },
        ]}
      />
      <Card>
        <CardHeader><CardTitle>{t("accounting.chart.addAccount")}</CardTitle></CardHeader>
        <CardBody><AddAccountForm /></CardBody>
      </Card>

      <Card>
        <CardHeader><div><CardTitle>{t("accounting.chart.mappingsTitle")}</CardTitle><p className="mt-0.5 text-xs text-ink-3">{t("accounting.chart.mappingsHint")}</p></div></CardHeader>
        <CardBody>{options.length ? <MappingForm fields={fields} accounts={options} /> : <p className="text-sm text-ink-3">{t("accounting.chart.accountsEmpty")}</p>}</CardBody>
      </Card>

      <Card>
        <CardHeader><div><CardTitle>{t("accounting.chart.vatTitle")}</CardTitle><p className="mt-0.5 text-xs text-ink-3">{t("accounting.chart.vatHint")}</p></div></CardHeader>
        <CardBody><MappingForm fields={vatFields} accounts={options} /></CardBody>
      </Card>
    </div>
  );
}
