import Link from "next/link";
import { ClipboardList } from "lucide-react";
import { PageHeader, DataTable, EmptyState, Badge, statusTone, ErrorState, type Column } from "@/components/ui";
import { listRegistrations, type RegistrationListItem } from "@/lib/data/registrations";
import { getFormatter } from "@/lib/i18n/server";

export default async function RegistrationsPage() {
  const f = await getFormatter();
  const { data, error } = await listRegistrations();
  if (error) return (<div className="animate-fade-up"><PageHeader title="Registrations" /><ErrorState title="Couldn't load registrations" message={error} /></div>);
  const rows = data!;
  const columns: Column<RegistrationListItem>[] = [
    { key: "athleteName", header: "Athlete", render: (r) => <Link href={`/admin/registrations/${r.id}`} className="font-medium text-ink hover:text-maroon">{r.athleteName}</Link> },
    { key: "programName", header: "Program" },
    { key: "familyName", header: "Family" },
    { key: "createdAt", header: "Submitted", render: (r) => f.date(r.createdAt) },
    { key: "status", header: "Status", render: (r) => <Badge tone={statusTone(r.status)}>{r.status}</Badge> },
  ];
  return (
    <div className="animate-fade-up">
      <PageHeader title="Registrations" description="Program & camp sign-ups submitted by parents." />
      <DataTable columns={columns} rows={rows} getRowKey={(r) => r.id} empty={<EmptyState icon={<ClipboardList className="h-5 w-5" />} title="No registrations yet" description="Public sign-ups will appear here." />} />
    </div>
  );
}
