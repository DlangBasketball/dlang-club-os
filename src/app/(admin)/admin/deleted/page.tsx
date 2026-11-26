import Link from "next/link";
import { redirect } from "next/navigation";
import { ArchiveRestore } from "lucide-react";
import { Badge, DataTable, EmptyState, ErrorState, PageHeader, type Column } from "@/components/ui";
import { getSessionUser } from "@/lib/auth/get-user";
import { getI18n } from "@/lib/i18n/server";
import { createClient } from "@/lib/supabase/server";
import { daysUntilPurge, parseImpact } from "@/lib/people/person-delete";
import { DeletionRowActions, ImpactSummary } from "@/components/people/delete-person";

export async function generateMetadata() {
  const { t } = await getI18n();
  return { title: t("personDelete.deleted.title") };
}

type Row = {
  id: string;
  kind: "athlete" | "family";
  name: string;
  status: "archived" | "restored" | "erased";
  createdAt: string;
  purgeAfter: string | null;
  erasedAt: string | null;
  summary: unknown;
};

/**
 * Recently deleted (admin only): archived people with "Restore" and "Delete
 * now" for 30 days, then the permanently deleted ones (no personal data left,
 * shown as "Deleted player" / "Deleted family").
 */
export default async function RecentlyDeletedPage({ searchParams }: { searchParams: Promise<{ show?: string }> }) {
  const [me, { t, f }] = await Promise.all([getSessionUser(), getI18n()]);
  if (!me?.orgId || !me.roles.includes("admin")) redirect("/admin/dashboard");
  const show = (await searchParams).show === "erased" ? "erased" : "archived";
  const db = await createClient();
  const { data, error } = await db
    .from("person_deletions")
    .select("id,kind,target_id,status,summary,created_at,purge_after,erased_at")
    .eq("org_id", me.orgId)
    .eq("status", show)
    .order(show === "erased" ? "erased_at" : "created_at", { ascending: false })
    .limit(500);
  if (error) {
    return (<div className="animate-fade-up"><PageHeader title={t("personDelete.deleted.title")} /><ErrorState title={t("common.error")} message={t("personDelete.errors.failed")} /></div>);
  }
  const rows0 = (data ?? []) as { id: string; kind: "athlete" | "family"; target_id: string; status: Row["status"]; summary: unknown; created_at: string; purge_after: string | null; erased_at: string | null }[];

  // Names exist only while archived (erased rows have none left).
  const athleteIds = rows0.filter((r) => r.kind === "athlete" && r.status === "archived").map((r) => r.target_id);
  const familyIds = rows0.filter((r) => r.kind === "family" && r.status === "archived").map((r) => r.target_id);
  const [ath, fam] = await Promise.all([
    athleteIds.length ? db.from("athletes").select("id,first_name,last_name").eq("org_id", me.orgId).in("id", athleteIds) : Promise.resolve({ data: [] as { id: string; first_name: string; last_name: string }[] }),
    familyIds.length ? db.from("families").select("id,name").eq("org_id", me.orgId).in("id", familyIds) : Promise.resolve({ data: [] as { id: string; name: string }[] }),
  ]);
  const names = new Map<string, string>([
    ...((ath.data ?? []).map((a) => [a.id, `${a.first_name} ${a.last_name}`] as [string, string])),
    ...((fam.data ?? []).map((x) => [x.id, x.name] as [string, string])),
  ]);
  const rows: Row[] = rows0.map((r) => ({
    id: r.id,
    kind: r.kind,
    status: r.status,
    name: names.get(r.target_id) ?? (r.kind === "athlete" ? t("personDelete.deleted.deletedPlayer") : t("personDelete.deleted.deletedFamily")),
    createdAt: r.created_at,
    purgeAfter: r.purge_after,
    erasedAt: r.erased_at,
    summary: r.summary,
  }));

  const columns: Column<Row>[] = [
    { key: "name", header: t("personDelete.deleted.person"), render: (r) => <span className="font-medium text-text">{r.name}</span> },
    { key: "kind", header: t("personDelete.deleted.kind"), render: (r) => <Badge tone="neutral">{r.kind === "athlete" ? t("personDelete.deleted.kindAthlete") : t("personDelete.deleted.kindFamily")}</Badge> },
    { key: "createdAt", header: t("personDelete.deleted.deletedOn"), render: (r) => f.date(r.status === "erased" && r.erasedAt ? r.erasedAt : r.createdAt) },
    {
      key: "summary",
      header: t("personDelete.deleted.summary"),
      render: (r) => {
        const impact = parseImpact({ kind: r.kind, id: r.id, ...(r.summary as object) });
        return impact ? <ImpactSummary impact={impact} showDetails={false} /> : null;
      },
    },
    {
      key: "purge",
      header: show === "erased" ? t("common.status") : t("personDelete.deleted.purge"),
      render: (r) => r.status === "erased"
        ? <Badge tone="danger">{t("personDelete.deleted.statusErased")}</Badge>
        : <span className="text-sm text-text-muted">{t("personDelete.deleted.purgeIn", { count: daysUntilPurge(r.purgeAfter) ?? 0 })}</span>,
    },
    { key: "actions", header: t("common.actions"), align: "right", render: (r) => <DeletionRowActions deletionId={r.id} restorable={r.status === "archived"} /> },
  ];

  return (
    <div className="animate-fade-up">
      <PageHeader title={t("personDelete.deleted.title")} description={t("personDelete.deleted.description")} />
      <nav className="mb-4 flex flex-wrap gap-2" aria-label={t("personDelete.deleted.title")}>
        {(["archived", "erased"] as const).map((k) => (
          <Link key={k} href={k === "erased" ? "/admin/deleted?show=erased" : "/admin/deleted"} aria-current={show === k ? "page" : undefined}
            className={`rounded-full border px-3 py-1 text-xs ${show === k ? "border-brand-primary bg-brand-primary-soft text-text" : "border-border text-text-muted hover:border-brand-primary"}`}>
            {k === "erased" ? t("personDelete.deleted.showErased") : t("personDelete.deleted.showArchived")}
          </Link>
        ))}
      </nav>
      <p className="mb-4 text-sm text-text-muted">{t("personDelete.restoreNote")}</p>
      <DataTable columns={columns} rows={rows} getRowKey={(r) => r.id} caption={t("personDelete.deleted.title")}
        empty={<EmptyState icon={<ArchiveRestore className="h-5 w-5" />} title={t("personDelete.deleted.empty")} />} />
    </div>
  );
}
