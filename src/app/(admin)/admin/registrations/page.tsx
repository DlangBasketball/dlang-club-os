import Link from "next/link";
import { ClipboardList, Pencil } from "lucide-react";
import { PageHeader, DataTable, EmptyState, Badge, statusTone, ErrorState, Button, type Column } from "@/components/ui";
import { listRegistrations, type RegistrationListItem } from "@/lib/data/registrations";
import { getI18n } from "@/lib/i18n/server";
import { getSessionUser } from "@/lib/auth/get-user";

export default async function RegistrationsPage() {
  const [{ t, f }, user] = await Promise.all([getI18n(), getSessionUser()]);
  const isAdmin = !!user?.roles.includes("admin");
  const { data, error } = await listRegistrations();
  if (error) return (<div className="animate-fade-up"><PageHeader title="Registrations" /><ErrorState title="Couldn't load registrations" message={error} /></div>);
  const rows = data!;
  const columns: Column<RegistrationListItem>[] = [
    { key: "athleteName", header: "Athlete", render: (r) => <Link href={`/admin/registrations/${r.id}`} className="font-medium text-ink hover:text-maroon">{r.athleteName}</Link> },
    { key: "programName", header: "Program" },
    { key: "familyName", header: "Family" },
    { key: "createdAt", header: "Submitted", render: (r) => f.date(r.createdAt) },
    { key: "status", header: "Status", render: (r) => <Badge tone={statusTone(r.status)}>{t.dynamic(`status.${r.status}`, undefined, r.status)}</Badge> },
  ];
  if (isAdmin) {
    columns.push({
      key: "actions",
      header: t("common.actions"),
      align: "right",
      render: (r) => (
        <Link href={`/admin/registrations/${r.id}#edit`} aria-label={t("editPeople.editAria", { name: `${r.athleteName} · ${r.programName}` })}>
          <Button size="sm" variant="ghost" type="button"><Pencil className="h-4 w-4" /> {t("editPeople.edit")}</Button>
        </Link>
      ),
    });
  }
  return (
    <div className="animate-fade-up">
      <PageHeader title="Registrations" description="Program & camp sign-ups submitted by parents." />
      <DataTable columns={columns} rows={rows} getRowKey={(r) => r.id} empty={<EmptyState icon={<ClipboardList className="h-5 w-5" />} title="No registrations yet" description="Public sign-ups will appear here." />} />
    </div>
  );
}
