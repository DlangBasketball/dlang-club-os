import { requireRole } from "@/lib/auth/get-user";
import { getTranslations } from "@/lib/i18n/server";
import { SubmissionDetail } from "@/components/forms/submission-detail";

export const dynamic = "force-dynamic";

export default async function AdminSubmissionPage({ params }: { params: Promise<{ id: string }> }) {
  await requireRole(["admin"]);
  const { id } = await params;
  const t = await getTranslations();
  return <SubmissionDetail id={id} base="/admin/forms/submissions" backHref="/admin/forms/completion" backLabel={t("forms.completion.title")} canVoid />;
}
