import "server-only";
import { NextResponse } from "next/server";
import { getI18n } from "@/lib/i18n/server";
import { getOrgEmailContext } from "@/lib/email/org-context";
import { buildDocumentPdf, type PdfBlock } from "@/lib/forms/pdf";
import { getIncident } from "./data";
import { audit, requireMe } from "./server";

/**
 * Incident report PDF. getIncident() reads through RLS, so only an admin of
 * the club, the athlete's guardians or the athlete's coaches ever get a
 * document (finance never). Every export is audit-logged.
 */
export async function renderIncidentPdf(id: string): Promise<NextResponse> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new NextResponse(null, { status: 404 });
  const me = await requireMe(["admin", "coach", "parent"]);
  if (!me) return new NextResponse(null, { status: 404 });
  const r = await getIncident(me.orgId, id);
  if (!r) return new NextResponse(null, { status: 404 });
  const { t, f } = await getI18n();
  const org = await getOrgEmailContext(me.orgId);
  const k = (group: string, v: string | null) => (v ? t.dynamic(`clubadmin.incidents.${group}.${v}`, undefined, v) : "—");

  const blocks: PdfBlock[] = [
    { kind: "heading", text: t("clubadmin.incidents.sectionEvent") },
    { kind: "row", label: t("clubadmin.incidents.occurredAt"), value: f.dateTime(r.occurred_at) },
    { kind: "row", label: t("clubadmin.incidents.context"), value: [r.programName, r.teamName].filter(Boolean).join(" · ") || "—" },
    { kind: "row", label: t("clubadmin.incidents.location"), value: r.location ?? "—" },
    { kind: "row", label: t("clubadmin.incidents.bodyPart"), value: k("bodyParts", r.body_part) },
    { kind: "row", label: t("clubadmin.incidents.severity"), value: k("severities", r.severity) },
    { kind: "paragraph", text: `${t("clubadmin.incidents.description")}:\n${r.description}` },
    { kind: "heading", text: t("clubadmin.incidents.sectionCare") },
    { kind: "row", label: t("clubadmin.incidents.firstAidGiven"), value: r.first_aid_given ? t("common.yes") : t("common.no") },
    { kind: "row", label: t("clubadmin.incidents.firstAidBy"), value: r.first_aid_by ?? "—" },
    ...(r.first_aid_details ? [{ kind: "paragraph" as const, text: `${t("clubadmin.incidents.firstAidDetails")}:\n${r.first_aid_details}` }] : []),
    { kind: "row", label: t("clubadmin.incidents.parentsInformedAt"), value: r.parents_informed_at ? f.dateTime(r.parents_informed_at) : "—" },
    { kind: "row", label: t("clubadmin.incidents.parentsInformedHow"), value: k("informedHow", r.parents_informed_how) },
    { kind: "row", label: t("clubadmin.incidents.referral"), value: k("referrals", r.referral) },
    { kind: "heading", text: t("clubadmin.incidents.sectionFollowUp") },
    { kind: "row", label: t("clubadmin.incidents.returnStatus"), value: k("returnStatuses", r.return_status) },
    { kind: "row", label: t("clubadmin.incidents.clearedOn"), value: r.cleared_on ? f.date(r.cleared_on) : "—" },
    { kind: "row", label: t("clubadmin.incidents.clearanceDocument"), value: r.clearance_file_name ?? "—" },
    ...(r.follow_up_notes ? [{ kind: "paragraph" as const, text: `${t("clubadmin.incidents.followUpNotes")}:\n${r.follow_up_notes}` }] : []),
  ];
  const bytes = await buildDocumentPdf({
    title: t("clubadmin.incidents.pdfTitle"),
    subtitle: org.clubName ?? undefined,
    meta: [
      { label: t("clubadmin.incidents.athlete"), value: r.athleteName },
      { label: t("clubadmin.incidents.status"), value: k("statuses", r.status) },
      { label: t("clubadmin.incidents.reportedOn"), value: f.dateTime(r.created_at) },
      { label: t("clubadmin.incidents.reference"), value: r.id },
    ],
    blocks,
    footer: `${org.clubName ?? ""} · ${t("clubadmin.incidents.pdfConfidential")}`,
  });
  await audit(me, "incident.pdf", "incident_reports", r.id);
  return new NextResponse(Buffer.from(bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="incident-${r.id.slice(0, 8)}.pdf"`,
      "Cache-Control": "private, no-store",
    },
  });
}
