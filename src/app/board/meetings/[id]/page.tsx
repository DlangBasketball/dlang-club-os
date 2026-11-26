import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, Card, CardBody, CardHeader, CardTitle, PageHeader } from "@/components/ui";
import { OpsButton, OpsForm } from "@/components/operations/ops-form";
import { DecisionList } from "@/components/operations/board-lists";
import { requireAuth } from "@/lib/auth/get-user";
import { getI18n } from "@/lib/i18n/server";
import { zonedParts } from "@/lib/staff/hours";
import { opsDb } from "@/lib/operations/db";
import { ATTENDEE_STATUSES, MEETING_KINDS, MEETING_STATUSES } from "@/lib/operations/validation";
import {
  addAttendee,
  addDocument,
  deleteDocument,
  deleteVote,
  fillAttendeesFromMembers,
  removeAttendee,
  saveDecision,
  saveMeeting,
  saveMinutes,
  saveVote,
  sendAgmInvitation,
  setAttendeeStatus,
} from "@/lib/actions/operations-board";

/**
 * One meeting: agenda, attendance list, minutes editor, votes (results) and
 * decisions. For an annual general assembly it is also the AGM kit:
 * invitation to all members, printable attendance list and recorded votes.
 */
export default async function MeetingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [me, { t, f }] = await Promise.all([requireAuth(), getI18n()]);
  if (!/^[0-9a-f-]{36}$/i.test(id) || !me.orgId) notFound();
  const db = await opsDb();
  const { data: m } = await db.from("committee_meetings").select("*").eq("id", id).eq("org_id", me.orgId).maybeSingle();
  if (!m) notFound();
  const [{ data: c }, { data: attendees }, { data: votes }, { data: decisions }, { data: documents }, { data: members }] = await Promise.all([
    db.from("committees").select("id,name").eq("id", m.committee_id).maybeSingle(),
    db.from("committee_meeting_attendees").select("*").eq("org_id", me.orgId).eq("meeting_id", id).order("display_name"),
    db.from("committee_votes").select("*").eq("org_id", me.orgId).eq("meeting_id", id).order("sort_order"),
    db.from("committee_decisions").select("*").eq("org_id", me.orgId).eq("meeting_id", id).order("created_at"),
    db.from("committee_documents").select("*").eq("org_id", me.orgId).eq("meeting_id", id).order("created_at"),
    db.from("committee_members").select("id,display_name").eq("org_id", me.orgId).eq("committee_id", m.committee_id).order("display_name"),
  ]);
  const isAdmin = me.roles.includes("admin");
  const agenda = Array.isArray(m.agenda) ? (m.agenda as { title?: string }[]) : [];
  const local = zonedParts(m.starts_at, f.timeZone);
  const present = (attendees ?? []).filter((a) => a.status === "present" || a.status === "proxy").length;
  const memberOpts = (members ?? []).map((x) => ({ value: x.id, label: x.display_name }));

  return (
    <div className="animate-fade-up space-y-6">
      <PageHeader eyebrow={<Link href={`/board/${m.committee_id}`} className="hover:text-text">{c?.name ?? t("operations.board.title")}</Link>}
        title={m.title} description={`${f.dateTime(m.starts_at, "long")}${m.location ? ` · ${m.location}` : ""}`}
        actions={m.kind !== "meeting" && isAdmin
          ? (m.invitation_sent_at
            ? <Badge tone="success">{t("operations.board.invitationSentOn", { date: f.date(m.invitation_sent_at) })}</Badge>
            : <OpsButton action={sendAgmInvitation.bind(null, m.id)} label={t("operations.board.sendInvitation")} variant="primary" confirm={t("operations.board.confirmInvitation")} />)
          : undefined} />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>{t("operations.board.agenda")}</CardTitle></CardHeader>
          <CardBody>
            {agenda.length === 0 ? <p className="text-sm text-text-muted">{t("operations.board.noAgenda")}</p> : (
              <ol className="list-decimal space-y-1 pl-5 text-sm">{agenda.map((a, i) => <li key={i}>{a.title}</li>)}</ol>
            )}
          </CardBody>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>{t("operations.board.attendance")}</CardTitle>
            <span className="text-xs text-text-muted">{t("operations.board.presentCount", { present, total: (attendees ?? []).length })}</span>
          </CardHeader>
          <CardBody className="space-y-3">
            <OpsButton action={fillAttendeesFromMembers.bind(null, m.id)} label={t("operations.board.fillFromMembers")} />
            <ul className="space-y-1.5 text-sm">
              {(attendees ?? []).map((a) => (
                <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-1.5 last:border-0">
                  <span>{a.display_name}{a.proxy_for ? ` (${t("operations.board.proxyFor", { name: a.proxy_for })})` : ""}</span>
                  <span className="flex flex-wrap gap-1">
                    {ATTENDEE_STATUSES.map((s) => (
                      <OpsButton key={s} action={setAttendeeStatus.bind(null, a.id, s)} label={t.dynamic(`operations.board.attendeeStatuses.${s}`)} variant={a.status === s ? "primary" : "ghost"} />
                    ))}
                    <OpsButton action={removeAttendee.bind(null, a.id)} label={t("common.remove")} variant="ghost" />
                  </span>
                </li>
              ))}
            </ul>
            <OpsForm action={addAttendee} submitLabel={t("common.add")} reset columns={3} fields={[
              { name: "meetingId", label: "", type: "hidden", defaultValue: m.id },
              { name: "memberId", label: "", type: "hidden" },
              { name: "displayName", label: t("common.name"), required: true },
              { name: "status", label: t("common.status"), type: "select", defaultValue: "present", options: ATTENDEE_STATUSES.map((s) => ({ value: s, label: t.dynamic(`operations.board.attendeeStatuses.${s}`) })) },
              { name: "proxyFor", label: t("operations.board.proxyField") },
            ]} />
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t("operations.board.minutes")}</CardTitle>
          {m.minutes_approved_at && <Badge tone="success">{t("operations.board.minutesApproved", { date: f.date(m.minutes_approved_at) })}</Badge>}
        </CardHeader>
        <CardBody>
          <OpsForm action={saveMinutes} submitLabel={t("common.save")} columns={1} fields={[
            { name: "meetingId", label: "", type: "hidden", defaultValue: m.id },
            { name: "minutes", label: t("operations.board.minutesField"), type: "textarea", rows: 14, defaultValue: m.minutes },
            { name: "approve", label: t("operations.board.approveMinutes"), type: "checkbox" },
          ]} />
        </CardBody>
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>{t("operations.board.votes")}</CardTitle></CardHeader>
          <CardBody className="space-y-4">
            <ul className="space-y-2 text-sm">
              {(votes ?? []).length === 0 && <li className="text-text-muted">{t("operations.board.noVotes")}</li>}
              {(votes ?? []).map((v) => (
                <li key={v.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-2 last:border-0">
                  <span>
                    <span className="font-medium">{v.motion}</span>
                    <div className="text-xs text-text-muted">{t("operations.board.voteCounts", { yes: v.votes_for, no: v.votes_against, abstain: v.abstentions })}</div>
                  </span>
                  <span className="flex items-center gap-1">
                    <Badge tone={v.result === "carried" ? "success" : v.result === "rejected" ? "danger" : "warning"}>{t.dynamic(`operations.board.voteResults.${v.result}`)}</Badge>
                    <OpsButton action={deleteVote.bind(null, v.id)} label={t("common.remove")} variant="ghost" confirm={t("operations.common.confirmDelete")} />
                  </span>
                </li>
              ))}
            </ul>
            <OpsForm action={saveVote} submitLabel={t("operations.board.recordVote")} reset columns={3} fields={[
              { name: "meetingId", label: "", type: "hidden", defaultValue: m.id },
              { name: "motion", label: t("operations.board.motion"), required: true, wide: true },
              { name: "votesFor", label: t("operations.board.yes"), type: "number", min: 0, defaultValue: 0 },
              { name: "votesAgainst", label: t("operations.board.no"), type: "number", min: 0, defaultValue: 0 },
              { name: "abstentions", label: t("operations.board.abstain"), type: "number", min: 0, defaultValue: 0 },
            ]} />
          </CardBody>
        </Card>
        <Card>
          <CardHeader><CardTitle>{t("operations.board.decisions")}</CardTitle></CardHeader>
          <CardBody className="space-y-4">
            <DecisionList decisions={decisions ?? []} members={members ?? []} />
            <OpsForm action={saveDecision.bind(null, null)} submitLabel={t("operations.board.addDecision")} reset fields={[
              { name: "committeeId", label: "", type: "hidden", defaultValue: m.committee_id },
              { name: "meetingId", label: "", type: "hidden", defaultValue: m.id },
              { name: "title", label: t("operations.common.title"), required: true },
              { name: "ownerMemberId", label: t("operations.board.owner"), type: "select", options: [{ value: "", label: t("common.none") }, ...memberOpts] },
              { name: "dueOn", label: t("operations.equipment.due"), type: "date" },
            ]} />
          </CardBody>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
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
              { name: "committeeId", label: "", type: "hidden", defaultValue: m.committee_id },
              { name: "meetingId", label: "", type: "hidden", defaultValue: m.id },
              { name: "title", label: t("operations.common.title"), required: true },
              { name: "url", label: t("operations.board.link"), type: "url", required: true },
            ]} />
          </CardBody>
        </Card>
        <Card>
          <CardHeader><CardTitle>{t("operations.common.details")}</CardTitle></CardHeader>
          <CardBody>
            <OpsForm action={saveMeeting.bind(null, m.id)} submitLabel={t("common.save")} fields={[
              { name: "committeeId", label: "", type: "hidden", defaultValue: m.committee_id },
              { name: "title", label: t("operations.common.title"), required: true, defaultValue: m.title },
              { name: "kind", label: t("operations.board.meetingKind"), type: "select", defaultValue: m.kind, options: MEETING_KINDS.map((k) => ({ value: k, label: t.dynamic(`operations.board.meetingKinds.${k}`) })) },
              { name: "startsAt", label: t("operations.board.when"), type: "datetime-local", required: true, defaultValue: `${local.date}T${local.time}` },
              { name: "location", label: t("operations.board.location"), defaultValue: m.location },
              { name: "status", label: t("common.status"), type: "select", defaultValue: m.status, options: MEETING_STATUSES.map((s) => ({ value: s, label: t.dynamic(`operations.board.meetingStatuses.${s}`) })) },
              { name: "agenda", label: t("operations.board.agenda"), type: "textarea", rows: 5, defaultValue: agenda.map((a) => a.title ?? "").join("\n"), hint: t("operations.board.agendaHint") },
            ]} />
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
