import Link from "next/link";
import { PageHeader } from "@/components/ui";
import { requireRole } from "@/lib/auth/get-user";
import { getI18n } from "@/lib/i18n/server";
import { AccessRequestList } from "@/components/attendance/admin/follow-up-lists";

export async function generateMetadata() {
  const { t } = await getI18n();
  return { title: t("adminAttendance.access.title") };
}

/** Coach session-access requests (notification target of requestSessionAccess). */
export default async function AttendanceAccessPage() {
  await requireRole(["admin"]);
  const { t } = await getI18n();
  return (
    <div className="animate-fade-up space-y-6">
      <PageHeader title={t("adminAttendance.access.title")} description={t("adminAttendance.access.description")}
        actions={<Link href="/admin/attendance/team" className="text-sm text-brand-primary hover:underline">{t("adminAttendance.followup.title")}</Link>} />
      <AccessRequestList />
    </div>
  );
}
