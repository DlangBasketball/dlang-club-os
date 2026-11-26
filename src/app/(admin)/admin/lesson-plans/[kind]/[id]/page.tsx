import { LessonPlanPage } from "@/components/staff/lesson-plan-page";
import { requireRole } from "@/lib/auth/get-user";
import { getI18n } from "@/lib/i18n/server";

export async function generateMetadata() {
  const { t } = await getI18n();
  return { title: t("staff.lessonPlans.title") };
}

export default async function AdminLessonPlanPage({ params }: { params: Promise<{ kind: string; id: string }> }) {
  await requireRole(["admin"]);
  const { kind, id } = await params;
  return <LessonPlanPage kind={kind} id={id} backHref="/admin/lesson-plans" />;
}
