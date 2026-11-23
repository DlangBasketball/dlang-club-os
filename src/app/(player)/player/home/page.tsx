import Link from "next/link";
import { UserX, Shield } from "lucide-react";
import { PageHeader, Card, CardHeader, CardTitle, CardBody, Badge, EmptyState, ErrorState, buttonVariants } from "@/components/ui";
import { getI18n } from "@/lib/i18n/server";
import { getPlayerMe } from "@/lib/attendance/data";
import { getPlayerFamilyOverview } from "@/lib/attendance/family-data";
import { UpcomingSessions } from "@/components/attendance/family/sections";

/**
 * Player home: own teams (name, jersey, position) and upcoming sessions with
 * "report absence" (absence_report allows the player for themself). Reads
 * only player_me / player_attendance_overview: no guardian contacts,
 * medical data, staff notes or money.
 */
export default async function PlayerHomePage() {
  const { t } = await getI18n();
  const [me, overview] = await Promise.all([getPlayerMe(), getPlayerFamilyOverview()]);

  if (!me.data) {
    return (
      <div className="animate-fade-up space-y-5">
        <EmptyState icon={<UserX className="h-5 w-5" />} title={t("familyAttendance.player.notLinked.title")} description={t("familyAttendance.player.notLinked.body")} />
      </div>
    );
  }

  return (
    <div className="animate-fade-up space-y-6">
      <PageHeader
        title={t("familyAttendance.player.greeting", { name: me.data.firstName })}
        description={t("familyAttendance.player.description")}
        actions={<Link href="/player/attendance" className={buttonVariants({ variant: "secondary", size: "sm" })}>{t("familyAttendance.player.seeHistory")}</Link>}
      />

      <Card>
        <CardHeader><CardTitle>{t("familyAttendance.player.teams")}</CardTitle></CardHeader>
        <CardBody className="p-0">
          {me.data.teams.length === 0 ? (
            <p className="px-5 py-6 text-sm text-text-muted">{t("familyAttendance.player.noTeams")}</p>
          ) : (
            <ul>
              {me.data.teams.map((tm) => (
                <li key={tm.team_id} className="flex items-center justify-between gap-3 border-b border-border px-5 py-3 last:border-0">
                  <span className="flex items-center gap-2 text-sm text-text">
                    <Shield aria-hidden className="h-4 w-4 text-brand-primary" /> {tm.name}
                  </span>
                  <span className="flex items-center gap-1.5">
                    {tm.position && <Badge>{tm.position}</Badge>}
                    {tm.jersey_number !== null && <Badge tone="accent">{t("familyAttendance.player.jersey", { number: tm.jersey_number })}</Badge>}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      {overview.error || !overview.data ? (
        <ErrorState title={t("familyAttendance.upcoming.title")} message={t("familyAttendance.loadError")} />
      ) : (
        <UpcomingSessions overview={overview.data} athleteId={me.data.athleteId} />
      )}
    </div>
  );
}
