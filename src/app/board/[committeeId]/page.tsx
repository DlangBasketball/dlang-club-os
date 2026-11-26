import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, Card, CardBody, CardHeader, CardTitle, PageHeader } from "@/components/ui";
import { OpsButton, OpsForm } from "@/components/operations/ops-form";
import { DecisionList } from "@/components/operations/board-lists";
import { requireAuth } from "@/lib/auth/get-user";
import { getI18n } from "@/lib/i18n/server";
import { opsDb } from "@/lib/operations/db";
import { COMMITTEE_KINDS, MEETING_KINDS, MEMBER_ROLES } from "@/lib/operations/validation";
import { addDocument, deleteDocument, removeMember, saveCommittee, saveDecision, saveMeeting, saveMember } from "@/lib/actions/operations-board";

/** A committee: members and roles, meetings, decisions log and documents. */
export default async function CommitteePage({ params }: { params: Promise<{ committeeId: string }> }) {
  const { committeeId } = await params;
  const [me, { t, f }] = await Promise.all([requireAuth(), getI18n()]);
  if (!/^[0-9a-f-]{36}$/i.test(committeeId) || !me.orgId) notFound();
  const db = await opsDb();
  // RLS: only members of this committee and admins get the row.
  const { data: c } = await db.from("committees").select("*").eq("id", committeeId).eq("org_id", me.orgId).maybeSingle();
  if (!c) notFound();
  const isAdmin = me.roles.includes("admin");
  const [{ data: members }, { data: meetings }, { data: decisions }, { data: documents }, profiles] = await Promise.all([
    db.from("committee_members").select("*").eq("org_id", me.orgId).eq("committee_id", committeeId).order("role"),
    db.from("committee_meetings").select("*").eq("org_id", me.orgId).eq("committee_id", committeeId).order("starts_at", { ascending: false }).limit(100),
    db.from("committee_decisions").select("*").eq("org_id", me.orgId).eq("committee_id", committeeId).order("due_on", { nullsFirst: false }).limit(500),
    db.from("committee_documents").select("*").eq("org_id", me.orgId).eq("committee_id", committeeId).is("meeting_id", null).order("created_at", { ascending: false }),
    isAdmin ? db.from("profiles").select("id,full_name,email").eq("org_id", me.orgId).order("full_name").limit(2000).then((r) => r.data ?? []) : Promise.resolve([]),
  ]);
  const memberOpts = (members ?? []).map((m) => ({ value: m.id, label: m.display_name }));
  return (
    <div className="animate-fade-up space-y-6">
      <PageHeader eyebrow={<Link href="/board" className="hover:text-text">{t("operations.board.title")}</Link>}
        title={c.name} description={c.description ?? t.dynamic(`operations.board.kinds.${c.kind}`)} />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>{t("operations.board.members")}</CardTitle></CardHeader>
          <CardBody className="space-y-4">
            <ul className="space-y-1.5 text-sm">
              {(members ?? []).length === 0 && <li className="text-text-muted">{t("operations.board.noMembers")}</li>}
              {(members ?? []).map((m) => (
                <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-1.5 last:border-0">
                  <span>
                    <span className="font-medium">{m.display_name}</span> · {t.dynamic(`operations.board.roles.${m.role}`)}
                    {m.ends_on && <span className="text-xs text-text-muted"> · {t("operations.board.until", { date: f.date(m.ends_on) })}</span>}
                    {!m.profile_id && <Badge className="ml-2">{t("operations.board.noLogin")}</Badge>}
                  </span>
                  {isAdmin && <OpsButton action={removeMember.bind(null, m.id)} label={t("common.delete")} variant="ghost" confirm={t("operations.common.confirmDelete")} />}
                </li>
              ))}
            </ul>
            {isAdmin && (
              <OpsForm action={saveMember.bind(null, null)} submitLabel={t("operations.board.addMember")} reset fields={[
                { name: "committeeId", label: "", type: "hidden", defaultValue: c.id },
                { name: "profileId", label: t("operations.board.account"), type: "select",
                  options: [{ value: "", label: t("operations.board.noLogin") }, ...profiles.map((p) => ({ value: p.id, label: p.full_name || String(p.email ?? "") }))] },
                { name: "displayName", label: t("common.name"), required: true },
                { name: "role", label: t("operations.board.role"), type: "select", defaultValue: "member", options: MEMBER_ROLES.map((r) => ({ value: r, label: t.dynamic(`operations.board.roles.${r}`) })) },
                { name: "email", label: t("common.email"), type: "email" },
                { name: "startsOn", label: t("operations.common.from"), type: "date" },
                { name: "endsOn", label: t("operations.common.to"), type: "date" },
              ]} />
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader><CardTitle>{t("operations.board.meetings")}</CardTitle></CardHeader>
          <CardBody className="space-y-4">
            <ul className="space-y-1.5 text-sm">
              {(meetings ?? []).length === 0 && <li className="text-text-muted">{t("operations.board.noMeetings")}</li>}
              {(meetings ?? []).map((m) => (
                <li key={m.id} className="flex flex-wrap items-center gap-2">
                  <Link href={`/board/meetings/${m.id}`} className="hover:text-brand-primary">{f.dateTime(m.starts_at, "medium")} · <span className="font-medium">{m.title}</span></Link>
                  {m.kind !== "meeting" && <Badge tone="accent">{t.dynamic(`operations.board.meetingKinds.${m.kind}`)}</Badge>}
                  <Badge tone={m.status === "held" ? "success" : m.status === "cancelled" ? "danger" : "neutral"}>{t.dynamic(`operations.board.meetingStatuses.${m.status}`)}</Badge>
                </li>
              ))}
            </ul>
            <OpsForm action={saveMeeting.bind(null, null)} submitLabel={t("operations.board.addMeeting")} redirectTo="/board/meetings/{id}" fields={[
              { name: "committeeId", label: "", type: "hidden", defaultValue: c.id },
              { name: "title", label: t("operations.common.title"), required: true },
              { name: "kind", label: t("operations.board.meetingKind"), type: "select", options: MEETING_KINDS.map((k) => ({ value: k, label: t.dynamic(`operations.board.meetingKinds.${k}`) })) },
              { name: "startsAt", label: t("operations.board.when"), type: "datetime-local", required: true },
              { name: "location", label: t("operations.board.location") },
              { name: "agenda", label: t("operations.board.agenda"), type: "textarea", rows: 4, hint: t("operations.board.agendaHint") },
            ]} />
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle>{t("operations.board.decisions")}</CardTitle></CardHeader>
        <CardBody className="space-y-4">
          <DecisionList decisions={decisions ?? []} members={members ?? []} />
          <OpsForm action={saveDecision.bind(null, null)} submitLabel={t("operations.board.addDecision")} reset columns={3} fields={[
            { name: "committeeId", label: "", type: "hidden", defaultValue: c.id },
            { name: "title", label: t("operations.common.title"), required: true },
            { name: "ownerMemberId", label: t("operations.board.owner"), type: "select", options: [{ value: "", label: t("common.none") }, ...memberOpts] },
            { name: "dueOn", label: t("operations.equipment.due"), type: "date" },
            { name: "description", label: t("operations.board.descriptionField"), type: "textarea", rows: 2 },
          ]} />
        </CardBody>
      </Card>

      <Card>
        <CardHeader><CardTitle>{t("operations.board.documents")}</CardTitle></CardHeader>
        <CardBody className="space-y-4">
          <ul className="space-y-1.5 text-sm">
            {(documents ?? []).length === 0 && <li className="text-text-muted">{t("operations.board.noDocuments")}</li>}
            {(documents ?? []).map((d) => (
              <li key={d.id} className="flex items-center justify-between gap-2">
                <a href={d.url} target="_blank" rel="noopener noreferrer" className="text-brand-primary hover:underline">{d.title}</a>
                <OpsButton action={deleteDocument.bind(null, d.id)} label={t("common.delete")} variant="ghost" confirm={t("operations.common.confirmDelete")} />
              </li>
            ))}
          </ul>
          <OpsForm action={addDocument} submitLabel={t("common.add")} reset fields={[
            { name: "committeeId", label: "", type: "hidden", defaultValue: c.id },
            { name: "title", label: t("operations.common.title"), required: true },
            { name: "url", label: t("operations.board.link"), type: "url", required: true, hint: t("operations.board.linkHint") },
          ]} />
        </CardBody>
      </Card>

      {isAdmin && (
        <Card>
          <CardHeader><CardTitle>{t("operations.common.details")}</CardTitle></CardHeader>
          <CardBody>
            <OpsForm action={saveCommittee.bind(null, c.id)} submitLabel={t("common.save")} fields={[
              { name: "name", label: t("common.name"), required: true, defaultValue: c.name },
              { name: "kind", label: t("operations.board.kind"), type: "select", defaultValue: c.kind, options: COMMITTEE_KINDS.map((k) => ({ value: k, label: t.dynamic(`operations.board.kinds.${k}`) })) },
              { name: "description", label: t("operations.board.descriptionField"), type: "textarea", rows: 2, defaultValue: c.description },
              { name: "isActive", label: t("operations.common.active"), type: "checkbox", defaultValue: c.is_active },
            ]} />
          </CardBody>
        </Card>
      )}
    </div>
  );
}
