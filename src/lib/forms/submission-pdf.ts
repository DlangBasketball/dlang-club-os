import "server-only";
import { NextResponse } from "next/server";
import { getI18n } from "@/lib/i18n/server";
import { logError } from "@/lib/log";
import { getOrgEmailContext } from "@/lib/email/org-context";
import { getSessionUser } from "@/lib/auth/get-user";
import { formsDb, FORM_FILES_BUCKET } from "./db";
import { getSubmission } from "./data";
import { buildDocumentPdf, type PdfBlock } from "./pdf";
import { displayAnswer, visibleFieldIds } from "./logic";
import { allFields } from "./schema";
import { writeAudit } from "@/lib/people/server";

/**
 * PDF export of one submission. getSubmission is RLS-scoped, so only an admin
 * of the org or a guardian of the athlete ever gets a document. Every export
 * is audit-logged (sensitive data leaving the system).
 */
export async function renderSubmissionPdf(id: string): Promise<NextResponse> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new NextResponse(null, { status: 404 });
  const { t, f } = await getI18n();
  const res = await getSubmission(id);
  if (res.error !== null) return new NextResponse(t("forms.errors.loadFailed"), { status: 403 });
  if (!res.data) return new NextResponse(null, { status: 404 });
  const s = res.data;
  const me = await getSessionUser();
  const org = me?.orgId ? await getOrgEmailContext(me.orgId) : null;

  const labels = { yes: t("common.yes"), no: t("common.no"), accepted: t("forms.view.accepted") };
  const visible = visibleFieldIds(allFields(s.definition), s.answers);
  const blocks: PdfBlock[] = [];
  for (const sec of s.definition.sections) {
    const fields = sec.fields.filter((x) => visible.has(x.id) && x.type !== "signature");
    if (!fields.length) continue;
    if (sec.title) blocks.push({ kind: "heading", text: sec.title });
    for (const fld of fields) {
      if (fld.type === "info") {
        blocks.push({ kind: "paragraph", text: [fld.label, fld.help].filter(Boolean).join("\n") });
        continue;
      }
      const v = s.answers[fld.id];
      blocks.push({ kind: "row", label: fld.label, value: fld.type === "date" && typeof v === "string" ? f.date(v) : displayAnswer(fld, v, labels) });
    }
  }

  let png: Uint8Array | null = null;
  if (s.signaturePath) {
    try {
      const db = await formsDb();
      const { data } = await db.storage.from(FORM_FILES_BUCKET).download(s.signaturePath);
      if (data) png = new Uint8Array(await data.arrayBuffer());
    } catch (e) {
      logError("forms.pdf.signature", e);
    }
  }

  const bytes = await buildDocumentPdf({
    title: s.formTitle,
    subtitle: org?.clubName ?? undefined,
    meta: [
      { label: t("forms.view.athlete"), value: s.athleteName },
      { label: t("forms.view.version"), value: String(s.version) },
      { label: t("forms.view.submitted"), value: f.dateTime(s.submittedAt) },
      ...(s.validUntil ? [{ label: t("forms.view.validUntil"), value: f.date(s.validUntil) }] : []),
      ...(s.status === "voided" ? [{ label: t("forms.view.status"), value: t("forms.submissionStatus.voided") }] : []),
      { label: t("forms.view.reference"), value: s.id },
    ],
    blocks,
    signature: s.signerName ? { heading: t("forms.view.signature"), lines: [t("forms.view.signedBy", { name: s.signerName })], png } : undefined,
    footer: org?.clubName ?? "",
  });
  if (me?.orgId) await writeAudit({ id: me.id, orgId: me.orgId }, "forms.submission.pdf", "form_submissions", s.id);
  return new NextResponse(Buffer.from(bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="form-${s.id.slice(0, 8)}.pdf"`,
      "Cache-Control": "private, no-store",
    },
  });
}
