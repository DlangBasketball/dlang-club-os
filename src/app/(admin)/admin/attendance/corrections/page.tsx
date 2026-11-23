import Link from "next/link";
import { PageHeader } from "@/components/ui";
import { requireRole } from "@/lib/auth/get-user";
import { getI18n } from "@/lib/i18n/server";
import { CorrectionRequestList } from "@/components/attendance/admin/follow-up-lists";

export async function generateMetadata() {
  const { t } = await getI18n();
  return { title: t("adminAttendance.corrections.title") };
}

/** Guardian correction requests (notification target of requestAttendanceCorrection). */
export default async function AttendanceCorrectionsPage() {
  await requireRole(["admin"]);
  const { t } = await getI18n();
  return (
    <div className="animate-fade-up space-y-6">
      <PageHeader title={t("adminAttendance.corrections.title")} description={t("adminAttendance.corrections.description")}
        actions={<Link href="/admin/attendance/team" className="text-sm text-brand-primary hover:underline">{t("adminAttendance.followup.title")}</Link>} />
      <CorrectionRequestList />
    </div>
  );
}
