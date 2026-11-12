import Link from "next/link";
import { Pencil, UserCircle } from "lucide-react";
import { PageHeader, DataTable, EmptyState, Badge, statusTone, ErrorState, Avatar, Button, type Column } from "@/components/ui";
import { createClient } from "@/lib/supabase/server";
import { getI18n } from "@/lib/i18n/server";
import { getTenant } from "@/lib/tenant/server";
import { termOr } from "@/lib/tenant/terms";
import { getSessionUser } from "@/lib/auth/get-user";
import { signAthletePhotos } from "@/lib/people/server";

type Row = { id: string; name: string; family: string; dob: string; status: string; photoUrl: string | null };

export default async function AthletesPage() {
  const [{ t, f }, tenant, user] = await Promise.all([getI18n(), getTenant(), getSessionUser()]);
  const title = termOr(tenant.terminology, "athlete", t("nav.athletes"), { plural: true });
  const singular = termOr(tenant.terminology, "athlete", t("editPeople.athlete.singular"));
  const isAdmin = !!user?.roles.includes("admin");
  const supabase = await createClient();
  const { data: athletes, error } = await supabase
    .from("athletes")
    .select("id,org_id,first_name,last_name,dob,status,family_id,photo_path")
    .order("last_name");
  if (error) return (<div className="animate-fade-up"><PageHeader title={title} /><ErrorState title={t("common.error")} message={error.message} /></div>);

  const famIds = Array.from(new Set((athletes ?? []).map((a) => a.family_id)));
  const families = famIds.length ? await supabase.from("families").select("id,name").in("id", famIds) : { data: [] };
  const famName = new Map(((families.data ?? []) as { id: string; name: string }[]).map((f) => [f.id, f.name]));
  // Signed photo URLs (Storage RLS: admins of the org; finance gets none -> initials).
  const photos = await signAthletePhotos(
    (athletes ?? []).map((a) => ({ id: a.id, photoPath: a.photo_path })),
    user?.orgId ?? null,
  );

  const rows: Row[] = (athletes ?? []).map((a) => ({
    id: a.id,
    name: `${a.first_name} ${a.last_name}`,
    family: famName.get(a.family_id) ?? "—",
    dob: a.dob,
    status: a.status,
    photoUrl: photos.get(a.id) ?? null,
  }));

  const columns: Column<Row>[] = [
    {
      key: "name",
      header: singular,
      render: (r) => (
        <Link href={`/admin/athletes/${r.id}`} className="flex items-center gap-3 font-medium text-ink hover:text-maroon">
          <Avatar name={r.name} src={r.photoUrl} size="lg" />
          <span>{r.name}</span>
        </Link>
      ),
    },
    { key: "family", header: t("editPeople.athlete.family") },
    { key: "dob", header: t("editPeople.athlete.born"), render: (r) => f.date(r.dob) },
    { key: "status", header: t("common.status"), render: (r) => <Badge tone={statusTone(r.status)}>{t.dynamic(`editPeople.athleteStatus.${r.status}`, undefined, r.status)}</Badge> },
  ];
  if (isAdmin) {
    columns.push({
      key: "actions",
      header: t("common.actions"),
      align: "right",
      render: (r) => (
        <Link href={`/admin/athletes/${r.id}/edit`} aria-label={t("editPeople.editAria", { name: r.name })}>
          <Button size="sm" variant="ghost" type="button"><Pencil className="h-4 w-4" /> {t("editPeople.edit")}</Button>
        </Link>
      ),
    });
  }

  return (
    <div className="animate-fade-up">
      <PageHeader title={title} description={t("editPeople.athlete.listDescription")} />
      <DataTable columns={columns} rows={rows} getRowKey={(r) => r.id} caption={title} empty={<EmptyState icon={<UserCircle className="h-5 w-5" />} title={t("editPeople.athlete.empty")} />} />
    </div>
  );
}
