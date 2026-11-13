import { requireRole } from "@/lib/auth/get-user";
import { getTranslations } from "@/lib/i18n/server";
import { SubmissionDetail } from "@/components/forms/submission-detail";

export const dynamic = "force-dynamic";

export default async function ParentSubmissionPage({ params }: { params: Promise<{ id: string }> }) {
  await requireRole(["parent"]);
  const { id } = await params;
  const t = await getTranslations();
  return <SubmissionDetail id={id} base="/parent/forms/submissions" backHref="/parent/forms" backLabel={t("forms.parent.title")} canVoid={false} />;
}
