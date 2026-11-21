import Link from "next/link";
import { Pencil, UserCircle } from "lucide-react";
import { PageHeader, DataTable, EmptyState, Badge, statusTone, ErrorState, Avatar, Button, type Column } from "@/components/ui";
import { createClient } from "@/lib/supabase/server";
import { getI18n } from "@/lib/i18n/server";
import { getTenant } from "@/lib/tenant/server";
import { termOr } from "@/lib/tenant/terms";
import { getSessionUser } from "@/lib/auth/get-user";
import { signAthletePhotos } from "@/lib/people/server";
import { parseLicenceFilter } from "@/lib/people/licence";
import { parseSponsoredFilter, type SponsorshipKind } from "@/lib/people/sponsorship";
import { SponsorshipBadge } from "@/components/athlete/sponsorship-badge";
import { HIDDEN_ATHLETE_STATUS_FILTER } from "@/lib/people/person-delete";
import { BulkCheckbox, BulkDeleteBar, BulkSelect, DeletePersonButton } from "@/components/people/delete-person";

type Row = { id: string; name: string; family: string; dob: string; status: string; photoUrl: string | null; licence: string | null; licenceCategory: string | null; sponsorship: SponsorshipKind; sponsorshipPercent: number | null; sponsor: string | null };

export default async function AthletesPage({ searchParams }: { searchParams: Promise<{ licence?: string | string[]; sponsored?: string | string[] }> }) {
  const sp = await searchParams;
  const licenceFilter = parseLicenceFilter(sp.licence);
  const sponsoredFilter = parseSponsoredFilter(sp.sponsored);
  const [{ t, f }, tenant, user] = await Promise.all([getI18n(), getTenant(), getSessionUser()]);
  const title = termOr(tenant.terminology, "athlete", t("nav.athletes"), { plural: true });
  const singular = termOr(tenant.terminology, "athlete", t("editPeople.athlete.singular"));
  const isAdmin = !!user?.roles.includes("admin");
  const supabase = await createClient();
  let query = supabase
    .from("athletes")
    .select("id,org_id,first_name,last_name,dob,status,family_id,photo_path,licence_number,licence_category,sponsorship_kind,sponsorship_percent,sponsor_name")
    .not("status", "in", HIDDEN_ATHLETE_STATUS_FILTER)
    .order("last_name");
  if (licenceFilter === "has") query = query.not("licence_number", "is", null);
  if (licenceFilter === "missing") query = query.is("licence_number", null);
  if (sponsoredFilter === "yes") query = query.neq("sponsorship_kind", "none");
  if (sponsoredFilter === "no") query = query.eq("sponsorship_kind", "none");
  const { data: athletes, error } = await query;
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
    licence: a.licence_number,
    licenceCategory: a.licence_category,
    sponsorship: a.sponsorship_kind,
    sponsorshipPercent: a.sponsorship_percent === null ? null : Number(a.sponsorship_percent),
    sponsor: a.sponsor_name,
  }));

  const columns: Column<Row>[] = [
    ...(isAdmin ? [{ key: "select", header: "", render: (r: Row) => <BulkCheckbox id={r.id} name={r.name} /> }] : []),
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
    {
      key: "licence",
      header: t("editPeople.licence.column"),
      render: (r) =>
        r.licence ? (
          <span className="tnum text-sm text-text">{r.licence}{r.licenceCategory ? <span className="ml-1.5 text-xs text-text-muted">{r.licenceCategory}</span> : null}</span>
        ) : (
          <Badge tone="warning">{t("editPeople.licence.missing")}</Badge>
        ),
    },
    {
      key: "sponsorship",
      header: t("sponsorship.list.column"),
      render: (r) =>
        r.sponsorship === "none" ? (
          <span className="text-text-muted">—</span>
        ) : (
          <span className="flex flex-col items-start gap-0.5">
            <SponsorshipBadge kind={r.sponsorship} percent={r.sponsorshipPercent} />
            {r.sponsor && <span className="text-xs text-text-muted">{r.sponsor}</span>}
          </span>
        ),
    },
    { key: "status", header: t("common.status"), render: (r) => <Badge tone={statusTone(r.status)}>{t.dynamic(`editPeople.athleteStatus.${r.status}`, undefined, r.status)}</Badge> },
  ];
  const listHref = (licence: typeof licenceFilter, sponsored: typeof sponsoredFilter) => {
    const q = new URLSearchParams();
    if (licence) q.set("licence", licence);
    if (sponsored) q.set("sponsored", sponsored);
    const s = q.toString();
    return s ? `/admin/athletes?${s}` : "/admin/athletes";
  };
  if (isAdmin) {
    columns.push({
      key: "actions",
      header: t("common.actions"),
      align: "right",
      render: (r) => (
        <span className="inline-flex items-center gap-1">
          <Link href={`/admin/athletes/${r.id}/edit`} aria-label={t("editPeople.editAria", { name: r.name })}>
            <Button size="sm" variant="ghost" type="button"><Pencil className="h-4 w-4" /> {t("editPeople.edit")}</Button>
          </Link>
          <DeletePersonButton kind="athlete" id={r.id} name={r.name} variant="icon" />
        </span>
      ),
    });
  }

  return (
    <div className="animate-fade-up">
      <PageHeader title={title} description={t("editPeople.athlete.listDescription")} />
      <div className="mb-4 flex flex-wrap gap-x-6 gap-y-2">
        <nav aria-label={t("editPeople.licence.filterLabel")} className="flex flex-wrap gap-2">
          {([null, "has", "missing"] as const).map((k) => (
            <Link key={k ?? "all"} href={listHref(k, sponsoredFilter)} aria-current={licenceFilter === k ? "page" : undefined}
              className={`rounded-full border px-3 py-1 text-xs ${licenceFilter === k ? "border-maroon bg-maroon/15 text-ink" : "border-line text-ink-3 hover:border-maroon/40"}`}>
              {k === "has" ? t("editPeople.licence.filterHas") : k === "missing" ? t("editPeople.licence.filterMissing") : t("common.all")}
            </Link>
          ))}
        </nav>
        <nav aria-label={t("sponsorship.list.filterLabel")} className="flex flex-wrap gap-2">
          {([null, "yes", "no"] as const).map((k) => (
            <Link key={k ?? "all"} href={listHref(licenceFilter, k)} aria-current={sponsoredFilter === k ? "page" : undefined}
              className={`rounded-full border px-3 py-1 text-xs ${sponsoredFilter === k ? "border-maroon bg-maroon/15 text-ink" : "border-line text-ink-3 hover:border-maroon/40"}`}>
              {k === "yes" ? t("sponsorship.list.filterYes") : k === "no" ? t("sponsorship.list.filterNo") : t("common.all")}
            </Link>
          ))}
        </nav>
      </div>
      <BulkSelect kind="athlete">
        {isAdmin && <BulkDeleteBar allIds={rows.map((r) => r.id)} />}
        <DataTable columns={columns} rows={rows} getRowKey={(r) => r.id} caption={title} empty={<EmptyState icon={<UserCircle className="h-5 w-5" />} title={t("editPeople.athlete.empty")} />} />
      </BulkSelect>
      {isAdmin && (
        <p className="mt-4 text-sm"><Link href="/admin/deleted" className="text-text-muted underline-offset-4 hover:underline">{t("personDelete.deleted.link")}</Link></p>
      )}
    </div>
  );
}
