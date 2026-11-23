import Link from "next/link";
import { PageHeader } from "@/components/ui";
import { requireRole } from "@/lib/auth/get-user";
import { getI18n } from "@/lib/i18n/server";
import { AwaitingAttendanceCard, NoShowsCard } from "@/components/attendance/admin/dashboard-cards";
import { AccessRequestList, AlertFollowupList, CorrectionRequestList } from "@/components/attendance/admin/follow-up-lists";

export async function generateMetadata() {
  const { t } = await getI18n();
  return { title: t("adminAttendance.followup.title") };
}

/** Team attendance follow-up (admin): everything that needs a person. */
export default async function TeamAttendanceFollowupPage() {
  await requireRole(["admin"]);
  const { t } = await getI18n();
  return (
    <div className="animate-fade-up space-y-6">
      <PageHeader title={t("adminAttendance.followup.title")} description={t("adminAttendance.followup.description")}
        actions={<Link href="/admin/data-review" className="text-sm text-brand-primary hover:underline">{t("adminAttendance.review.title")}</Link>} />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <AwaitingAttendanceCard limit={50} />
        <NoShowsCard limit={30} />
      </div>
      <AlertFollowupList />
      <AccessRequestList />
      <CorrectionRequestList />
    </div>
  );
}
