import Link from "next/link";
import { ClipboardList, Pencil, X } from "lucide-react";
import { PageHeader, DataTable, EmptyState, Badge, statusTone, ErrorState, Button, Input, type Column } from "@/components/ui";
import { Pager, pageParam } from "@/components/ui/pager";
import { findRegistrations, registrationProgramOptions, type RegistrationListItem } from "@/lib/data/registrations";
import { getI18n } from "@/lib/i18n/server";
import { getSessionUser } from "@/lib/auth/get-user";
import { createClient } from "@/lib/supabase/server";
import { DeletePersonButton } from "@/components/people/delete-person";

const STATUSES = ["pending", "confirmed", "waitlist", "cancelled", "completed"];
const UUID = /^[0-9a-f-]{36}$/i;
const selectCls = "h-9 rounded-md border border-line bg-surface px-2 text-sm text-ink";

type SP = { status?: string; program?: string; family?: string; q?: string; page?: string };

export default async function RegistrationsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const [{ t, f }, user, sp] = await Promise.all([getI18n(), getSessionUser(), searchParams]);
  const isAdmin = !!user?.roles.includes("admin");
  const status = sp.status && STATUSES.includes(sp.status) ? sp.status : undefined;
  const programId = sp.program && UUID.test(sp.program) ? sp.program : undefined;
  const familyId = sp.family && UUID.test(sp.family) ? sp.family : undefined;
  const q = (sp.q ?? "").trim().slice(0, 80);
  const page = pageParam(sp.page);
  const title = t("editPeople.registrationList.title");

  const [{ data, error }, programs, family] = await Promise.all([
    findRegistrations({ status, programId, familyId, q, page }),
    user?.orgId ? registrationProgramOptions(user.orgId) : Promise.resolve({ data: [], error: null }),
    familyId ? (await createClient()).from("families").select("id,name").eq("id", familyId).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  if (error) return (<div className="animate-fade-up"><PageHeader title={title} /><ErrorState title={t("editPeople.registrationList.loadError")} message={error} /></div>);
  const { rows, hasMore } = data!;
  const unknown = t("editPeople.registrationList.unknown");

  const columns: Column<RegistrationListItem>[] = [
    { key: "athleteName", header: t("editPeople.registrationList.colAthlete"), render: (r) => <Link href={`/admin/registrations/${r.id}`} className="font-medium text-ink hover:text-maroon">{r.athleteName ?? unknown}</Link> },
    {
      key: "programName",
      header: t("editPeople.registrationList.colProgram"),
      render: (r) => (
        <span>
          <Link href={`/admin/programs/${r.programId}`} className="text-ink-2 hover:text-maroon">{r.programName ?? unknown}</Link>
          {(r.editionName || r.editionStartsOn) && (
            <span className="block text-xs text-ink-3">{r.editionName ?? t("editPeople.registrationList.week", { date: f.date(r.editionStartsOn) })}</span>
          )}
        </span>
      ),
    },
    { key: "familyName", header: t("editPeople.registrationList.colFamily"), render: (r) => (r.familyId ? <Link href={`/admin/families/${r.familyId}`} className="text-ink-2 hover:text-maroon">{r.familyName ?? unknown}</Link> : "—") },
    { key: "createdAt", header: t("editPeople.registrationList.colSubmitted"), render: (r) => f.date(r.createdAt) },
    { key: "status", header: t("editPeople.registrationList.colStatus"), render: (r) => <Badge tone={statusTone(r.status)}>{t.dynamic(`status.${r.status}`, undefined, r.status)}</Badge> },
  ];
  if (isAdmin) {
    columns.push({
      key: "actions",
      header: t("common.actions"),
      align: "right",
      render: (r) => (
        <span className="inline-flex items-center gap-1">
          <Link href={`/admin/registrations/${r.id}#edit`} aria-label={t("editPeople.editAria", { name: `${r.athleteName ?? unknown} · ${r.programName ?? unknown}` })}>
            <Button size="sm" variant="ghost" type="button"><Pencil className="h-4 w-4" /> {t("editPeople.edit")}</Button>
          </Link>
          <DeletePersonButton kind="athlete" id={r.athleteId} name={r.athleteName ?? unknown} variant="icon" />
        </span>
      ),
    });
  }
  const filtered = !!(status || programId || familyId || q || page > 1);
  return (
    <div className="animate-fade-up">
      <PageHeader title={title} description={t("editPeople.registrationList.description")} />
      <form method="get" className="mb-4 flex flex-wrap items-center gap-2" role="search">
        <select name="status" defaultValue={status ?? ""} aria-label={t("editPeople.registrationList.colStatus")} className={selectCls}>
          <option value="">{t("editPeople.registrationList.allStatuses")}</option>
          {STATUSES.map((s) => <option key={s} value={s}>{t.dynamic(`status.${s}`, undefined, s)}</option>)}
        </select>
        <select name="program" defaultValue={programId ?? ""} aria-label={t("editPeople.registrationList.colProgram")} className={`${selectCls} max-w-xs`}>
          <option value="">{t("editPeople.registrationList.allPrograms")}</option>
          {(programs.data ?? []).map((p) => (
            <option key={p.id} value={p.id}>{p.isActive ? p.name : t("editPeople.registrationList.archivedProgram", { name: p.name })}</option>
          ))}
        </select>
        {familyId && <input type="hidden" name="family" value={familyId} />}
        <Input name="q" defaultValue={q} placeholder={t("editPeople.registrationList.searchPlaceholder")} aria-label={t("common.search")} className="w-60" />
        <Button type="submit" size="sm" variant="secondary">{t("editPeople.registrationList.filter")}</Button>
        {family.data && <Badge tone="neutral">{t("editPeople.registrationList.familyFilter", { name: family.data.name })}</Badge>}
        {filtered && (
          <Link href="/admin/registrations" className="inline-flex items-center gap-1 text-xs text-maroon hover:underline">
            <X className="h-3.5 w-3.5" /> {t("editPeople.registrationList.clear")}
          </Link>
        )}
      </form>
      <DataTable columns={columns} rows={rows} getRowKey={(r) => r.id}
        empty={filtered
          ? <EmptyState icon={<ClipboardList className="h-5 w-5" />} title={t("editPeople.registrationList.noMatch")} />
          : <EmptyState icon={<ClipboardList className="h-5 w-5" />} title={t("editPeople.registrationList.emptyTitle")} description={t("editPeople.registrationList.emptyBody")} />} />
      <Pager basePath="/admin/registrations" params={{ status, program: programId, family: familyId, q: q || undefined }} page={page} hasMore={hasMore} />
    </div>
  );
}
