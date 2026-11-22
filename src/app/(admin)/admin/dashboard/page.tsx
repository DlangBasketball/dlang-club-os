import { Suspense } from "react";
import { Plus } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui";
import { getSessionUser } from "@/lib/auth/get-user";
import { KpiCards, KpiCardsSkeleton } from "@/components/dashboard/kpi-cards";
import { QuickActions } from "@/components/dashboard/quick-actions";
import { DashboardShortcuts } from "@/components/dashboard/shortcuts";
import { ActivityFeed, ActivityFeedSkeleton } from "@/components/dashboard/activity-feed";
import { InvoiceSummary, InvoiceSummarySkeleton } from "@/components/dashboard/invoice-summary";
import { TodaysAttendance, TodaysAttendanceSkeleton } from "@/components/dashboard/todays-attendance";
import { UpcomingSessions, UpcomingSessionsSkeleton } from "@/components/dashboard/upcoming-sessions";
import { RegistrationSummary, RegistrationSummarySkeleton } from "@/components/dashboard/registration-summary";
import { RecentPayments, RecentPaymentsSkeleton } from "@/components/dashboard/recent-payments";
import { FinanceOverview, FinanceOverviewSkeleton } from "@/components/dashboard/finance-overview";
import { CoverImage } from "@/components/media/cover-image";
import { getOrgCover } from "@/lib/media/server";
import { getTranslations } from "@/lib/i18n/server";
import { SelectionRevenueCard } from "@/components/selection/revenue-card";
import { PlacementsDashboardCard } from "@/components/alumni/placements-card";

export default async function DashboardPage() {
  const [user, t] = await Promise.all([getSessionUser(), getTranslations()]);
  const firstName = user?.fullName?.split(" ")[0] ?? null;
  const cover = await getOrgCover(user?.orgId);
  const isAdmin = !!user?.roles.includes("admin");

  return (
    <div className="animate-fade-up space-y-8">
      <CoverImage
        cover={cover}
        variant="subtle"
        eyebrow={t("media.dashboard.welcomeBack")}
        title={firstName ? t("media.dashboard.greeting", { name: firstName }) : t("media.dashboard.greetingAnonymous")}
        edit={isAdmin && user?.orgId ? { target: "org", id: user.orgId, canUseLibrary: true } : null}
      >
        <Link href="/admin/families"><Button><Plus className="h-4 w-4" /> {t("media.dashboard.addFamily")}</Button></Link>
      </CoverImage>

      {/* Shortcuts: everyday jumps, filtered by role and plan */}
      <Suspense fallback={null}>
        <DashboardShortcuts />
      </Suspense>

      {/* Students & money: KPI tiles + charts */}
      <Suspense fallback={<FinanceOverviewSkeleton />}>
        <FinanceOverview />
      </Suspense>

      {/* Revenue straight from selection programmes (e.g. an international team) */}
      <Suspense fallback={null}>
        <SelectionRevenueCard />
      </Suspense>

      {/* Where former players went (alumni & placements) */}
      <Suspense fallback={null}>
        <PlacementsDashboardCard />
      </Suspense>

      {/* KPIs */}
      <Suspense fallback={<KpiCardsSkeleton />}>
        <KpiCards />
      </Suspense>

      {/* Quick actions */}
      <QuickActions />

      {/* Activity + right rail */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Suspense fallback={<ActivityFeedSkeleton rows={6} />}>
            <ActivityFeed />
          </Suspense>
        </div>
        <div className="space-y-6">
          <Suspense fallback={<InvoiceSummarySkeleton rows={2} />}>
            <InvoiceSummary />
          </Suspense>
          <Suspense fallback={<TodaysAttendanceSkeleton rows={1} />}>
            <TodaysAttendance />
          </Suspense>
        </div>
      </div>

      {/* Operational lists */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Suspense fallback={<UpcomingSessionsSkeleton rows={4} />}>
          <UpcomingSessions />
        </Suspense>
        <Suspense fallback={<RegistrationSummarySkeleton rows={4} />}>
          <RegistrationSummary />
        </Suspense>
        <Suspense fallback={<RecentPaymentsSkeleton rows={4} />}>
          <RecentPayments />
        </Suspense>
      </div>
    </div>
  );
}
