import Link from "next/link";
import { Users, Plus } from "lucide-react";
import { PageHeader, Button, DataTable, EmptyState, ErrorState, type Column } from "@/components/ui";
import { listFamilies, type FamilyListItem } from "@/lib/data/families";
import { getFormatter } from "@/lib/i18n/server";

export default async function FamiliesPage() {
  const f = await getFormatter();
  const { data, error } = await listFamilies();
  if (error) return (
    <div className="animate-fade-up">
      <PageHeader title="Families" />
      <ErrorState title="Couldn't load families" message={error} />
    </div>
  );
  const rows = data!;
  const columns: Column<FamilyListItem>[] = [
    { key: "name", header: "Family", render: (r) => <Link href={`/admin/families/${r.id}`} className="font-medium text-ink hover:text-maroon">{r.name}</Link> },
    { key: "athleteCount", header: "Athletes" },
    { key: "phone", header: "Phone", render: (r) => r.phone ?? "—" },
    { key: "openInvoices", header: "Open" },
    { key: "balance", header: "Balance", align: "right", render: (r) => <span className="tnum">{f.money(r.balance)}</span> },
  ];
  return (
    <div className="animate-fade-up">
      <PageHeader
        title="Families"
        description="Households grouping athletes and their guardians."
        actions={<Link href="/admin/families/new"><Button><Plus className="h-4 w-4" /> New family</Button></Link>}
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
