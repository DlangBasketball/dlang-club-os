import { Coins, History, Wallet } from "lucide-react";
import { PageHeader, Card, CardHeader, CardTitle, CardBody, DataTable, Badge, EmptyState, ErrorState, type Column } from "@/components/ui";
import { listCreditPackages, type PackageRow } from "@/lib/data/training-admin";
import {
  listFamilyCredits,
  listTrainingCreditLedger,
  listTrainingCreditTotals,
  type CreditLedgerRow,
  type CreditTotalsRow,
  type FamilyCreditRow,
} from "@/lib/data/money-edit";
import { PackageForm } from "@/components/admin/credit-admin";
import { FamilyCreditAdjust, GrantCreditsWithReason, TrainingCreditAdjust } from "@/components/money/credit-editors";
import { getFormatter, getTranslations } from "@/lib/i18n/server";

export default async function AdminCreditsPage() {
  const [f, t] = await Promise.all([getFormatter(), getTranslations()]);
  const [{ data: packages, error: pErr }, { data: athletes, error: aErr }, ledger, familyCredits] = await Promise.all([
    listCreditPackages(),
    listTrainingCreditTotals(),
    listTrainingCreditLedger(),
    listFamilyCredits(),
  ]);
  if (pErr || aErr) return (<div className="animate-fade-up"><PageHeader title="Credits" /><ErrorState title="Couldn't load" message={pErr ?? aErr ?? ""} /></div>);

  const pkgCols: Column<PackageRow>[] = [
    { key: "name", header: "Package" },
    { key: "creditCategory", header: "Category" },
    { key: "credits", header: "Credits" },
    { key: "priceChf", header: "Price", align: "right", render: (p) => f.money(p.priceChf) },
    { key: "isActive", header: "Status", render: (p) => <Badge tone={p.isActive ? "success" : "neutral"}>{p.isActive ? "active" : "inactive"}</Badge> },
  ];
  const bal = (r: CreditTotalsRow, c: "personal" | "nutrition" | "mental") => (
    <span className="tnum" title={t("editMoney.training.current", { total: r.totals[c].total, used: r.totals[c].used, balance: r.totals[c].total - r.totals[c].used })}>
      {r.totals[c].total - r.totals[c].used}
    </span>
  );
  const credCols: Column<CreditTotalsRow>[] = [
    { key: "name", header: t("editMoney.training.athlete") },
    { key: "personal", header: t("editMoney.training.categories.personal"), render: (r) => bal(r, "personal") },
    { key: "nutrition", header: t("editMoney.training.categories.nutrition"), render: (r) => bal(r, "nutrition") },
    { key: "mental", header: t("editMoney.training.categories.mental"), render: (r) => bal(r, "mental") },
    { key: "athleteId", header: t("editMoney.common.actions"), align: "right", render: (r) => <TrainingCreditAdjust athleteId={r.athleteId} name={r.name} totals={r.totals} /> },
  ];
  const ledgerCols: Column<CreditLedgerRow>[] = [
    { key: "at", header: t("editMoney.common.date"), render: (r) => f.date(r.at) },
    { key: "athleteName", header: t("editMoney.training.athlete") },
    { key: "category", header: t("editMoney.training.category"), render: (r) => t.dynamic(`editMoney.training.categories.${r.category}`, undefined, r.category) },
    { key: "kind", header: t("editMoney.training.kindLabel"), render: (r) => t.dynamic(`editMoney.training.kinds.${r.kind}`, undefined, r.kind) },
    { key: "delta", header: t("editMoney.training.change"), align: "right", render: (r) => <span className="tnum">{r.delta > 0 ? `+${r.delta}` : r.delta} ({r.totalBefore} → {r.totalAfter})</span> },
    { key: "reason", header: t("editMoney.common.reason") },
  ];
  const famCols: Column<FamilyCreditRow>[] = [
    { key: "familyName", header: t("editMoney.invoice.family") },
    { key: "balance", header: t("editMoney.credit.balanceHeader"), align: "right", render: (r) => <span className="tnum">{f.money(r.balance, r.currency)}</span> },
    { key: "lastAt", header: t("editMoney.credit.lastChange"), render: (r) => f.date(r.lastAt) },
    { key: "familyId", header: t("editMoney.common.actions"), align: "right", render: (r) => <FamilyCreditAdjust familyId={r.familyId} familyName={r.familyName} currency={r.currency} balance={r.balance} /> },
  ];

  return (
    <div className="animate-fade-up space-y-6">
      <PageHeader title="Training credits" description={t("editMoney.training.pageHint")} />
      <Card>
        <CardHeader><CardTitle>{t("editMoney.training.grantHeader")}</CardTitle></CardHeader>
        <CardBody><GrantCreditsWithReason athletes={(athletes ?? []).map((a) => ({ athleteId: a.athleteId, name: a.name }))} /></CardBody>
      </Card>
      <Card>
        <CardHeader><CardTitle>Credit packages</CardTitle></CardHeader>
        <CardBody className="space-y-4">
          <PackageForm />
          <DataTable columns={pkgCols} rows={packages ?? []} getRowKey={(p) => p.id}
            empty={<EmptyState icon={<Coins className="h-5 w-5" />} title="No packages yet" />} />
        </CardBody>
      </Card>
      <Card>
        <CardHeader><CardTitle>{t("editMoney.training.balancesTitle")}</CardTitle></CardHeader>
        <CardBody><DataTable columns={credCols} rows={athletes ?? []} getRowKey={(a) => a.athleteId} empty={<EmptyState icon={<Coins className="h-5 w-5" />} title={t("editMoney.training.noAthletes")} />} /></CardBody>
      </Card>
      <Card>
        <CardHeader><CardTitle>{t("editMoney.training.historyTitle")}</CardTitle></CardHeader>
        <CardBody><DataTable columns={ledgerCols} rows={ledger.data ?? []} getRowKey={(r) => r.id} empty={<EmptyState icon={<History className="h-5 w-5" />} title={t("editMoney.training.historyEmpty")} />} /></CardBody>
      </Card>
      <Card>
        <CardHeader><CardTitle>{t("editMoney.credit.familyBalancesTitle")}</CardTitle></CardHeader>
        <CardBody>
          <p className="mb-3 text-sm text-ink-3">{t("editMoney.credit.familyBalancesHint")}</p>
          <DataTable columns={famCols} rows={familyCredits.data ?? []} getRowKey={(r) => `${r.familyId}:${r.currency}`} empty={<EmptyState icon={<Wallet className="h-5 w-5" />} title={t("editMoney.credit.noBalances")} />} />
        </CardBody>
      </Card>
    </div>
  );
}
