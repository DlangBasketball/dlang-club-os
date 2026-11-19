import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { ErrorState, PageHeader } from "@/components/ui";
import { requireRole } from "@/lib/auth/get-user";
import { getI18n } from "@/lib/i18n/server";
import { getTemplate } from "@/lib/contracts/data";
import { formsDb } from "@/lib/forms/db";
import { getOrgEmailContext } from "@/lib/email/org-context";
import { FormsNav } from "@/components/forms/forms-nav";
import { ContractTemplateEditor } from "@/components/forms/contract-template-editor";
import type { MergeData } from "@/lib/contracts/merge";

export const dynamic = "force-dynamic";

export default async function ContractTemplatePage({ params }: { params: Promise<{ id: string }> }) {
  const me = await requireRole(["admin"]);
  const { id } = await params;
  if (id !== "new" && !/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const { t } = await getI18n();
  let template = null;
  if (id !== "new") {
    const res = await getTemplate(id);
    if (res.error !== null) return <ErrorState title={t("forms.errors.loadFailed")} message={res.error} />;
    if (!res.data) notFound();
    template = res.data;
  }
  const db = await formsDb();
  const { data: programs } = await db.from("programs").select("id,name").eq("org_id", me.orgId!).order("name");
  const org = await getOrgEmailContext(me.orgId);
  // Preview values: clearly fictitious examples, formatted for the club.
  const sample: MergeData = {
    "athlete.first_name": t("forms.contracts.sample.firstName"), "athlete.last_name": t("forms.contracts.sample.lastName"),
    "athlete.full_name": `${t("forms.contracts.sample.firstName")} ${t("forms.contracts.sample.lastName")}`, "athlete.dob": org.f.date("2014-05-01"),
    "guardian.full_name": t("forms.contracts.sample.guardian"), "guardian.email": "parent@example.com", "family.name": t("forms.contracts.sample.family"),
    "family.address": t("forms.contracts.sample.address"), "programme.name": t("forms.contracts.sample.programme"), "programme.kind": t("forms.activities.team_season"),
    "programme.location": t("forms.contracts.sample.location"), price: org.f.money(450), currency: org.brand.currency ?? "", dates: org.f.dateRange("2026-08-24", "2027-06-26"),
    start_date: org.f.date("2026-08-24"), end_date: org.f.date("2027-06-26"), "club.name": org.clubName ?? "", today: org.f.date(new Date().toISOString().slice(0, 10)),
  };
  return (
    <div className="animate-fade-up max-w-4xl space-y-5">
      <Link href="/admin/contracts/templates" className="inline-flex items-center gap-1 text-xs text-ink-3 hover:text-ink"><ChevronLeft className="h-3.5 w-3.5" /> {t("forms.contracts.templatesTitle")}</Link>
      <PageHeader title={template ? template.name : t("forms.contracts.newTemplate")} description={t("forms.contracts.editorHint")} />
      <FormsNav active="templates" />
      <ContractTemplateEditor template={template} programs={(programs ?? []).map((p) => ({ id: p.id, name: p.name }))} sample={sample} />
    </div>
  );
}
