import Link from "next/link";
import { UserCircle } from "lucide-react";
import { PageHeader, DataTable, EmptyState, Badge, statusTone, ErrorState, type Column } from "@/components/ui";
import { createClient } from "@/lib/supabase/server";
import { formatDate } from "@/lib/utils";

type Row = { id: string; name: string; family: string; dob: string; status: string };

export default async function AthletesPage() {
  const supabase = await createClient();
  const { data: athletes, error } = await supabase
    .from("athletes")
    .select("id,first_name,last_name,dob,status,family_id")
    .order("last_name");
  if (error) return (<div className="animate-fade-up"><PageHeader title="Athletes" /><ErrorState title="Couldn't load athletes" message={error.message} /></div>);

  const famIds = Array.from(new Set((athletes ?? []).map((a) => a.family_id)));
  const families = famIds.length ? await supabase.from("families").select("id,name").in("id", famIds) : { data: [] };
  const famName = new Map(((families.data ?? []) as { id: string; name: string }[]).map((f) => [f.id, f.name]));

  const rows: Row[] = (athletes ?? []).map((a) => ({
    id: a.id,
    name: `${a.first_name} ${a.last_name}`,
    family: famName.get(a.family_id) ?? "—",
    dob: a.dob,
    status: a.status,
  }));

  const columns: Column<Row>[] = [
    { key: "name", header: "Athlete", render: (r) => <Link href={`/admin/athletes/${r.id}`} className="font-medium text-ink hover:text-maroon">{r.name}</Link> },
    { key: "family", header: "Family" },
    { key: "dob", header: "Born", render: (r) => formatDate(r.dob) },
    { key: "status", header: "Status", render: (r) => <Badge tone={statusTone(r.status)}>{r.status}</Badge> },
  ];

  return (
    <div className="animate-fade-up">
      <PageHeader title="Athletes" description="All athletes in the club. Medical data is access-controlled." />
      <DataTable columns={columns} rows={rows} getRowKey={(r) => r.id} empty={<EmptyState icon={<UserCircle className="h-5 w-5" />} title="No athletes yet" />} />
    </div>
  );
}
