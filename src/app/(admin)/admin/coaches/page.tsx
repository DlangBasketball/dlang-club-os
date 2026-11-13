import Link from "next/link";
import { Plus, Search, UserCog } from "lucide-react";
import { PageHeader, DataTable, EmptyState, Badge, ErrorState, Avatar, Button, Input, Select, Label, type Column } from "@/components/ui";
import { getI18n } from "@/lib/i18n/server";
import { getTenant } from "@/lib/tenant/server";
import { termOr } from "@/lib/tenant/terms";
import { getSessionUser } from "@/lib/auth/get-user";
import { listCoaches, type CoachListItem } from "@/lib/data/coaches";
import { COACH_STATUS_FILTERS, matchesCoachSearch, parseStatusFilter } from "@/lib/coaches/validation";

type Row = CoachListItem & Record<string, unknown>;

export default async function CoachesPage({ searchParams }: { searchParams: Promise<{ q?: string; status?: string }> }) {
  const [{ t }, tenant, user, sp] = await Promise.all([getI18n(), getTenant(), getSessionUser(), searchParams]);
  const title = termOr(tenant.terminology, "coach", t("coaches.title"), { plural: true });
  const isAdmin = !!user?.roles.includes("admin");
  const res = await listCoaches();
  if (res.error !== null) {
    return <div className="animate-fade-up"><PageHeader title={title} /><ErrorState title={t("common.error")} message={res.error} /></div>;
  }
  const q = (sp.q ?? "").slice(0, 100);
  const status = parseStatusFilter(sp.status);
  const all = res.data;
  const rows = all.filter((c) =>
    (status === "all" || (status === "active" ? c.isActive : !c.isActive)) &&
    matchesCoachSearch({ name: c.name, title: c.title, teams: c.teams.map((x) => x.name) }, q),
  ) as Row[];

  const columns: Column<Row>[] = [
    {
      key: "name",
      header: t("coaches.columns.coach"),
      render: (r) => (
        <Link href={`/admin/coaches/${r.id}`} className="flex items-center gap-3 text-ink hover:text-maroon">
          <Avatar name={r.name} src={r.photoUrl} size="lg" />
          <span className="min-w-0">
            <span className="block font-medium">{r.name}</span>
            {r.title && <span className="block truncate text-xs text-ink-3">{r.title}</span>}
          </span>
        </Link>
      ),
    },
    {
      key: "teams",
      header: t("coaches.columns.teams"),
      render: (r) => r.teams.length ? (
        <div className="flex flex-wrap gap-1">
          {r.teams.map((tm) => (
            <Link key={tm.id} href={`/admin/teams/${tm.id}`}>
              <Badge tone={tm.isActive ? "maroon" : "neutral"}>{tm.name}</Badge>
            </Link>
          ))}
        </div>
      ) : <span className="text-xs text-ink-3">{t("coaches.noTeams")}</span>,
    },
    {
      key: "login",
      header: t("coaches.columns.login"),
      render: (r) => r.linked
        ? <Badge tone="success" dot>{t("coaches.login.linked")}</Badge>
        : r.invitePending
          ? <Badge tone="warning" dot>{t("coaches.login.pending")}</Badge>
          : <Badge>{t("coaches.login.none")}</Badge>,
    },
    {
      key: "status",
      header: t("coaches.columns.status"),
      render: (r) => <Badge tone={r.isActive ? "success" : "neutral"}>{r.isActive ? t("coaches.status.active") : t("coaches.status.inactive")}</Badge>,
    },
  ];

  return (
    <div className="animate-fade-up space-y-4">
      <PageHeader
        title={title}
        description={t("coaches.description")}
        actions={isAdmin ? (
          <Link href="/admin/coaches/new"><Button size="sm"><Plus className="h-4 w-4" /> {t("coaches.new")}</Button></Link>
        ) : undefined}
      />
      {all.length > 0 && (
        <form method="get" role="search" aria-label={t("coaches.searchLabel")} className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <div className="flex-1">
            <Label htmlFor="coach-q" className="sr-only">{t("coaches.searchLabel")}</Label>
            <Input id="coach-q" name="q" type="search" defaultValue={q} placeholder={t("coaches.searchPlaceholder")} maxLength={100} />
          </div>
          <div className="sm:w-48">
            <Label htmlFor="coach-status" className="sr-only">{t("coaches.filterLabel")}</Label>
            <Select id="coach-status" name="status" defaultValue={status}>
              {COACH_STATUS_FILTERS.map((s) => <option key={s} value={s}>{t(`coaches.filter.${s}`)}</option>)}
            </Select>
          </div>
          <div className="flex gap-2">
            <Button type="submit" variant="secondary"><Search className="h-4 w-4" /> {t("coaches.search")}</Button>
            {(q || status !== "all") && <Link href="/admin/coaches"><Button type="button" variant="ghost">{t("coaches.clear")}</Button></Link>}
          </div>
        </form>
      )}
      {all.length > 0 && <p className="text-xs text-ink-3">{t("coaches.count", { count: rows.length })}</p>}
      <DataTable
        caption={title}
        columns={columns}
        rows={rows}
        getRowKey={(r) => r.id}
        empty={all.length === 0
          ? <EmptyState icon={<UserCog className="h-5 w-5" />} title={t("coaches.empty.title")} description={t("coaches.empty.description")} />
          : <EmptyState icon={<Search className="h-5 w-5" />} title={t("coaches.noResults")} />}
      />
    </div>
  );
}
