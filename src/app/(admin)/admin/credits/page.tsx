import { Coins } from "lucide-react";
import { PageHeader, Card, CardHeader, CardTitle, CardBody, DataTable, Badge, EmptyState, ErrorState, type Column } from "@/components/ui";
import { listCreditPackages, listAthleteCredits, type PackageRow, type AthleteCredit } from "@/lib/data/training-admin";
import { PackageForm, GrantCreditsForm } from "@/components/admin/credit-admin";
import { getFormatter } from "@/lib/i18n/server";

export default async function AdminCreditsPage() {
  const f = await getFormatter();
  const [{ data: packages, error: pErr }, { data: athletes, error: aErr }] = await Promise.all([listCreditPackages(), listAthleteCredits()]);
  if (pErr || aErr) return (<div className="animate-fade-up"><PageHeader title="Credits" /><ErrorState title="Couldn't load" message={pErr ?? aErr ?? ""} /></div>);

  const pkgCols: Column<PackageRow>[] = [
    { key: "name", header: "Package" },
    { key: "creditCategory", header: "Category" },
    { key: "credits", header: "Credits" },
    { key: "priceChf", header: "Price", align: "right", render: (p) => f.money(p.priceChf) },
    { key: "isActive", header: "Status", render: (p) => <Badge tone={p.isActive ? "success" : "neutral"}>{p.isActive ? "active" : "inactive"}</Badge> },
  ];
  const credCols: Column<AthleteCredit>[] = [
    { key: "name", header: "Athlete" },
    { key: "personal", header: "Personal" },
    { key: "nutrition", header: "Nutrition" },
    { key: "mental", header: "Mental" },
  ];
  return (
    <div className="animate-fade-up space-y-6">
      <PageHeader title="Training credits" description="Credit packages and per-athlete balances." />
      <Card>
        <CardHeader><CardTitle>Grant credits</CardTitle></CardHeader>
        <CardBody><GrantCreditsForm athletes={(athletes ?? []).map((a) => ({ athleteId: a.athleteId, name: a.name }))} /></CardBody>
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
        <CardHeader><CardTitle>Athlete balances</CardTitle></CardHeader>
        <CardBody><DataTable columns={credCols} rows={athletes ?? []} getRowKey={(a) => a.athleteId} empty={<EmptyState icon={<Coins className="h-5 w-5" />} title="No athletes" />} /></CardBody>
      </Card>
    </div>
  );
}
