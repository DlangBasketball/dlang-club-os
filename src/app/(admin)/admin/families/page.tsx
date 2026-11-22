import Link from "next/link";
import { Users, Plus, Pencil } from "lucide-react";
import { PageHeader, Button, Badge, DataTable, EmptyState, ErrorState, Input, type Column } from "@/components/ui";
import { totalsList } from "@/lib/payments/open-invoices";
import { listFamilies, type FamilyListItem } from "@/lib/data/families";
import { getI18n } from "@/lib/i18n/server";
import { getTenant } from "@/lib/tenant/server";
import { term, termOr } from "@/lib/tenant/terms";
import { getSessionUser } from "@/lib/auth/get-user";
import { BulkCheckbox, BulkDeleteBar, BulkSelect, DeletePersonButton } from "@/components/people/delete-person";

export default async function FamiliesPage({ searchParams }: { searchParams: Promise<{ membership?: string; q?: string }> }) {
  const { membership: m, q: rawQ } = await searchParams;
  const q = (rawQ ?? "").trim().slice(0, 80);
  const membership = m === "guest" || m === "member" ? m : null;
  const [{ t, f }, tenant, me] = await Promise.all([getI18n(), getTenant(), getSessionUser()]);
  const isAdmin = !!me?.roles.includes("admin");
  const title = termOr(tenant.terminology, "family", t("nav.families"), { plural: true });
  const { data, error } = await listFamilies(membership, q);
  if (error) return (
    <div className="animate-fade-up">
      <PageHeader title={title} />
      <ErrorState title={t("editPeople.familyList.loadError")} message={error} />
    </div>
  );
  const rows = data!;
  const columns: Column<FamilyListItem>[] = [
    ...(isAdmin ? [{ key: "select", header: "", render: (r: FamilyListItem) => <BulkCheckbox id={r.id} name={r.name} /> }] : []),
    { key: "name", header: term(tenant.terminology, "family"), render: (r) => (
      <span className="flex flex-wrap items-center gap-2">
        <Link href={`/admin/families/${r.id}`} className="font-medium text-ink hover:text-maroon">{r.name}</Link>
        {r.membership === "guest" && <Badge tone="info">{t("camps.membership.guest")}</Badge>}
      </span>
    ) },
    { key: "athleteCount", header: term(tenant.terminology, "athlete", { plural: true }) },
    { key: "phone", header: t("editPeople.familyList.phone"), render: (r) => r.phone ?? "—" },
    { key: "openInvoices", header: t("editPeople.familyList.open"), render: (r) => <span className="tnum">{f.number(r.openInvoices)}</span> },
    { key: "balance", header: t("editPeople.familyList.balance"), align: "right", render: (r) => <span className="tnum">{totalsList(r.balance, f.currency).map((m) => f.money(m.amount, m.currency)).join(" + ")}</span> },
    {
      key: "actions",
      header: t("common.actions"),
      align: "right",
      render: (r) => (
        <span className="inline-flex items-center gap-1">
          <Link href={`/admin/families/${r.id}/edit`} aria-label={t("editPeople.editAria", { name: r.name })}>
            <Button size="sm" variant="ghost" type="button"><Pencil className="h-4 w-4" /> {t("editPeople.edit")}</Button>
          </Link>
          {isAdmin && <DeletePersonButton kind="family" id={r.id} name={r.name} variant="icon" />}
        </span>
      ),
    },
  ];
  return (
    <div className="animate-fade-up">
      <PageHeader
        title={title}
        description={t("editPeople.familyList.description", { athletes: term(tenant.terminology, "athlete", { plural: true, case: "lower" }) })}
        actions={<Link href="/admin/families/new"><Button><Plus className="h-4 w-4" /> {t("editPeople.familyList.new", { label: term(tenant.terminology, "family", { case: "lower" }) })}</Button></Link>}
      />
      <nav aria-label={t("camps.membership.filter")} className="mb-4 flex flex-wrap gap-2">
        {([null, "member", "guest"] as const).map((k) => (
          <Link key={k ?? "all"} href={`/admin/families?${new URLSearchParams({ ...(k ? { membership: k } : {}), ...(q ? { q } : {}) }).toString()}`} aria-current={membership === k ? "page" : undefined}
            className={`rounded-full border px-3 py-1 text-xs ${membership === k ? "border-maroon bg-maroon/15 text-ink" : "border-line text-ink-3 hover:border-maroon/40"}`}>
            {k ? t(`camps.membership.${k}s`) : t("common.all")}
          </Link>
        ))}
      </nav>
      <form method="get" className="mb-4 flex flex-wrap items-center gap-2" role="search">
        {membership && <input type="hidden" name="membership" value={membership} />}
        <Input name="q" defaultValue={q} placeholder={t("editPeople.familyList.searchPlaceholder")} aria-label={t("common.search")} className="w-64" />
        <Button type="submit" size="sm" variant="secondary">{t("common.search")}</Button>
      </form>
      <BulkSelect kind="family">
        {isAdmin && <BulkDeleteBar allIds={rows.map((r) => r.id)} />}
        <DataTable
          columns={columns}
          rows={rows}
          getRowKey={(r) => r.id}
          empty={q ? <EmptyState icon={<Users className="h-5 w-5" />} title={t("editPeople.familyList.noMatch", { q })} /> : <EmptyState icon={<Users className="h-5 w-5" />} title={t("editPeople.familyList.emptyTitle")} description={t("editPeople.familyList.emptyBody", { athletes: term(tenant.terminology, "athlete", { plural: true, case: "lower" }) })} action={<Link href="/admin/families/new"><Button size="sm">{t("editPeople.familyList.new", { label: term(tenant.terminology, "family", { case: "lower" }) })}</Button></Link>} />}
        />
      </BulkSelect>
      {isAdmin && (
        <p className="mt-4 text-sm"><Link href="/admin/deleted" className="text-text-muted underline-offset-4 hover:underline">{t("personDelete.deleted.link")}</Link></p>
      )}
    </div>
  );
}
