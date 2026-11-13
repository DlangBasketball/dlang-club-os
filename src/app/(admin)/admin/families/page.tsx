import Link from "next/link";
import { Users, Plus, Pencil } from "lucide-react";
import { PageHeader, Button, Badge, DataTable, EmptyState, ErrorState, type Column } from "@/components/ui";
import { listFamilies, type FamilyListItem } from "@/lib/data/families";
import { getI18n } from "@/lib/i18n/server";
import { getTenant } from "@/lib/tenant/server";
import { term, termOr } from "@/lib/tenant/terms";

export default async function FamiliesPage({ searchParams }: { searchParams: Promise<{ membership?: string }> }) {
  const { membership: m } = await searchParams;
  const membership = m === "guest" || m === "member" ? m : null;
  const [{ t, f }, tenant] = await Promise.all([getI18n(), getTenant()]);
  const title = termOr(tenant.terminology, "family", t("nav.families"), { plural: true });
  const { data, error } = await listFamilies(membership);
  if (error) return (
    <div className="animate-fade-up">
      <PageHeader title={title} />
      <ErrorState title="Couldn't load families" message={error} />
    </div>
  );
  const rows = data!;
  const columns: Column<FamilyListItem>[] = [
    { key: "name", header: term(tenant.terminology, "family"), render: (r) => (
      <span className="flex flex-wrap items-center gap-2">
        <Link href={`/admin/families/${r.id}`} className="font-medium text-ink hover:text-maroon">{r.name}</Link>
        {r.membership === "guest" && <Badge tone="info">{t("camps.membership.guest")}</Badge>}
      </span>
    ) },
    { key: "athleteCount", header: term(tenant.terminology, "athlete", { plural: true }) },
    { key: "phone", header: "Phone", render: (r) => r.phone ?? "—" },
    { key: "openInvoices", header: "Open" },
    { key: "balance", header: "Balance", align: "right", render: (r) => <span className="tnum">{f.money(r.balance)}</span> },
    {
      key: "actions",
      header: t("common.actions"),
      align: "right",
      render: (r) => (
        <Link href={`/admin/families/${r.id}/edit`} aria-label={t("editPeople.editAria", { name: r.name })}>
          <Button size="sm" variant="ghost" type="button"><Pencil className="h-4 w-4" /> {t("editPeople.edit")}</Button>
        </Link>
      ),
    },
  ];
  return (
    <div className="animate-fade-up">
      <PageHeader
        title={title}
        description="Households grouping athletes and their guardians."
        actions={<Link href="/admin/families/new"><Button><Plus className="h-4 w-4" /> New {term(tenant.terminology, "family", { case: "lower" })}</Button></Link>}
      />
      <nav aria-label={t("camps.membership.filter")} className="mb-4 flex flex-wrap gap-2">
        {([null, "member", "guest"] as const).map((k) => (
          <Link key={k ?? "all"} href={k ? `/admin/families?membership=${k}` : "/admin/families"} aria-current={membership === k ? "page" : undefined}
            className={`rounded-full border px-3 py-1 text-xs ${membership === k ? "border-maroon bg-maroon/15 text-ink" : "border-line text-ink-3 hover:border-maroon/40"}`}>
            {k ? t(`camps.membership.${k}s`) : t("common.all")}
          </Link>
        ))}
      </nav>
      <DataTable
        columns={columns}
        rows={rows}
        getRowKey={(r) => r.id}
        empty={<EmptyState icon={<Users className="h-5 w-5" />} title="No families yet" description="Create a family to start adding athletes." action={<Link href="/admin/families/new"><Button size="sm">New family</Button></Link>} />}
      />
    </div>
  );
}
