import Link from "next/link";
import { Users, Plus } from "lucide-react";
import { PageHeader, Button, DataTable, EmptyState, ErrorState, type Column } from "@/components/ui";
import { listFamilies, type FamilyListItem } from "@/lib/data/families";
import { getI18n } from "@/lib/i18n/server";
import { getTenant } from "@/lib/tenant/server";
import { term, termOr } from "@/lib/tenant/terms";

export default async function FamiliesPage() {
  const [{ t, f }, tenant] = await Promise.all([getI18n(), getTenant()]);
  const title = termOr(tenant.terminology, "family", t("nav.families"), { plural: true });
  const { data, error } = await listFamilies();
  if (error) return (
    <div className="animate-fade-up">
      <PageHeader title={title} />
      <ErrorState title="Couldn't load families" message={error} />
    </div>
  );
  const rows = data!;
  const columns: Column<FamilyListItem>[] = [
    { key: "name", header: term(tenant.terminology, "family"), render: (r) => <Link href={`/admin/families/${r.id}`} className="font-medium text-ink hover:text-maroon">{r.name}</Link> },
    { key: "athleteCount", header: term(tenant.terminology, "athlete", { plural: true }) },
    { key: "phone", header: "Phone", render: (r) => r.phone ?? "—" },
    { key: "openInvoices", header: "Open" },
    { key: "balance", header: "Balance", align: "right", render: (r) => <span className="tnum">{f.money(r.balance)}</span> },
  ];
  return (
    <div className="animate-fade-up">
      <PageHeader
        title={title}
        description="Households grouping athletes and their guardians."
        actions={<Link href="/admin/families/new"><Button><Plus className="h-4 w-4" /> New {term(tenant.terminology, "family", { case: "lower" })}</Button></Link>}
      />
      <DataTable
        columns={columns}
        rows={rows}
        getRowKey={(r) => r.id}
        empty={<EmptyState icon={<Users className="h-5 w-5" />} title="No families yet" description="Create a family to start adding athletes." action={<Link href="/admin/families/new"><Button size="sm">New family</Button></Link>} />}
      />
    </div>
  );
}
