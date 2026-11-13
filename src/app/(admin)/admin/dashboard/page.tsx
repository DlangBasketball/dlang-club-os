import { Suspense } from "react";
import { Plus } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui";
import { getSessionUser } from "@/lib/auth/get-user";
import { KpiCards, KpiCardsSkeleton } from "@/components/dashboard/kpi-cards";
import { QuickActions } from "@/components/dashboard/quick-actions";
import { ActivityFeed, ActivityFeedSkeleton } from "@/components/dashboard/activity-feed";
import { InvoiceSummary, InvoiceSummarySkeleton } from "@/components/dashboard/invoice-summary";
import { TodaysAttendance, TodaysAttendanceSkeleton } from "@/components/dashboard/todays-attendance";
import { UpcomingSessions, UpcomingSessionsSkeleton } from "@/components/dashboard/upcoming-sessions";
import { RegistrationSummary, RegistrationSummarySkeleton } from "@/components/dashboard/registration-summary";
import { RecentPayments, RecentPaymentsSkeleton } from "@/components/dashboard/recent-payments";
import { FinanceOverview, FinanceOverviewSkeleton } from "@/components/dashboard/finance-overview";

export default async function DashboardPage() {
  const user = await getSessionUser();
  const firstName = user?.fullName?.split(" ")[0] ?? "there";

  return (
    <div className="animate-fade-up space-y-8">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm text-ink-3">Welcome back</p>
          <h1 className="text-3xl font-semibold">Good to see you, {firstName}</h1>
        </div>
        <Link href="/admin/families"><Button><Plus className="h-4 w-4" /> Add family</Button></Link>
      </div>

      {/* Students & money: KPI tiles + charts */}
      <Suspense fallback={<FinanceOverviewSkeleton />}>
        <FinanceOverview />
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
