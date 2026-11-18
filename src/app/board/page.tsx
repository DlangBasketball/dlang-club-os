import Link from "next/link";
import { Landmark } from "lucide-react";
import { Badge, Card, CardBody, CardHeader, CardTitle, EmptyState, PageHeader } from "@/components/ui";
import { OpsForm } from "@/components/operations/ops-form";
import { requireAuth } from "@/lib/auth/get-user";
import { getI18n } from "@/lib/i18n/server";
import { zonedDayKey } from "@/lib/staff/hours";
import { opsDb } from "@/lib/operations/db";
import { COMMITTEE_KINDS } from "@/lib/operations/validation";
import { saveCommittee } from "@/lib/actions/operations-board";

/** Committees the signed-in person may see (members + admins only, by RLS). */
export default async function BoardPage() {
  const [me, { t, f }] = await Promise.all([requireAuth(), getI18n()]);
  const isAdmin = me.roles.includes("admin");
  const db = await opsDb();
  const today = zonedDayKey(new Date(), f.timeZone);
  const [{ data: committees }, { data: meetings }, { data: open }] = await Promise.all([
    db.from("committees").select("*").eq("org_id", me.orgId ?? "").order("name"),
    db.from("committee_meetings").select("id,committee_id,title,starts_at,kind,status").eq("org_id", me.orgId ?? "")
      .gte("starts_at", new Date(Date.now() - 864e5).toISOString()).neq("status", "cancelled").order("starts_at").limit(20),
    db.from("committee_decisions").select("id,committee_id,due_on,status").eq("org_id", me.orgId ?? "").in("status", ["open", "in_progress"]).limit(2000),
  ]);
  const name = new Map((committees ?? []).map((c) => [c.id, c.name]));
  return (
    <div className="animate-fade-up space-y-6">
      <PageHeader title={t("operations.board.title")} description={t("operations.board.description")} />
      {(committees ?? []).length === 0 ? <EmptyState icon={<Landmark />} title={t("operations.board.empty")} description={isAdmin ? undefined : t("operations.board.notMember")} /> : (
        <ul className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {(committees ?? []).map((c) => {
            const tasks = (open ?? []).filter((d) => d.committee_id === c.id);
            const late = tasks.filter((d) => d.due_on && d.due_on < today).length;
            return (
              <li key={c.id}>
                <Link href={`/board/${c.id}`} className="block h-full">
                  <Card className="h-full hover:border-brand-primary">
                    <CardBody className="space-y-2">
                      <div className="flex items-start justify-between gap-2">
                        <span className="font-medium">{c.name}</span>
                        <Badge>{t.dynamic(`operations.board.kinds.${c.kind}`)}</Badge>
                      </div>
                      {c.description && <p className="text-sm text-text-muted">{c.description}</p>}
                      <div className="flex flex-wrap gap-1.5 text-xs">
                        <Badge tone={tasks.length ? "warning" : "success"}>{t("operations.board.openTasks", { count: tasks.length })}</Badge>
                        {late > 0 && <Badge tone="danger">{t("operations.board.lateTasks", { count: late })}</Badge>}
                        {!c.is_active && <Badge>{t("operations.common.inactive")}</Badge>}
                      </div>
                    </CardBody>
                  </Card>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
      {(meetings ?? []).length > 0 && (
        <Card>
          <CardHeader><CardTitle>{t("operations.board.upcoming")}</CardTitle></CardHeader>
          <CardBody>
            <ul className="space-y-1.5 text-sm">
              {(meetings ?? []).map((m) => (
                <li key={m.id}>
                  <Link href={`/board/meetings/${m.id}`} className="hover:text-brand-primary">
                    {f.dateTime(m.starts_at, "medium")} · <span className="font-medium">{m.title}</span> · {name.get(m.committee_id)}
                  </Link>
                  {m.kind !== "meeting" && <Badge tone="accent" className="ml-2">{t.dynamic(`operations.board.meetingKinds.${m.kind}`)}</Badge>}
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      )}
      {isAdmin && (
        <Card>
          <CardHeader><CardTitle>{t("operations.board.addCommittee")}</CardTitle></CardHeader>
          <CardBody>
            <OpsForm action={saveCommittee.bind(null, null)} submitLabel={t("common.add")} redirectTo="/board/{id}" fields={[
              { name: "name", label: t("common.name"), required: true },
              { name: "kind", label: t("operations.board.kind"), type: "select", options: COMMITTEE_KINDS.map((k) => ({ value: k, label: t.dynamic(`operations.board.kinds.${k}`) })) },
              { name: "description", label: t("operations.board.descriptionField"), type: "textarea", rows: 2 },
              { name: "isActive", label: t("operations.common.active"), type: "checkbox", defaultValue: true },
            ]} />
          </CardBody>
        </Card>
      )}
    </div>
  );
}
