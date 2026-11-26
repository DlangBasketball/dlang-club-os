import { ErrorState } from "@/components/ui";
import { getI18n } from "@/lib/i18n/server";
import { todayIn } from "@/lib/payments/plans";
import Link from "next/link";
import { getRoster, getRosterHealth, getSeasonPrograms, getTournaments, getUnenrolledTeamMembers, seasonsOf } from "@/lib/selection/roster";
import { RosterTable } from "./roster-table";
import { RosterHealthNotice } from "./tournaments-editor";

/**
 * Roster tab of a selection programme (server). `seasonHref` / `playerHrefBase`
 * use "{id}" for the programme. An error or refused request is shown as an
 * error, never as an empty roster.
 */
export async function RosterSection({
  orgId, programId, roles, seasonHref, playerHrefBase, addHref,
}: {
  orgId: string; programId: string; roles: string[];
  seasonHref: string; playerHrefBase: string | null; addHref: string | null;
}) {
  const { t, f } = await getI18n();
  const isAdmin = roles.includes("admin");
  const isFinance = isAdmin || roles.includes("finance");
  const [roster, all, health, unenrolled] = await Promise.all([
    getRoster(programId),
    getSeasonPrograms(orgId),
    isFinance ? getRosterHealth(programId) : Promise.resolve(null),
    getUnenrolledTeamMembers(programId),
  ]);
  if (roster.error) return <ErrorState title={t("roster.loadFailedTitle")} message={t("roster.loadFailed")} />;
  const seasons = all.data.length ? seasonsOf(all.data, programId) : [];
  const me = all.data.find((p) => p.id === programId);
  const tournaments = await getTournaments(orgId, [programId]);
  const today = todayIn(f.timeZone);
  return (
    <div className="space-y-4">
      {health && <RosterHealthNotice missing={health.missing} recentFailures={health.recentFailures} canRepair={isAdmin} />}
      {all.error && <ErrorState compact title={t("roster.loadFailedTitle")} message={t("roster.seasonsFailed")} />}
      <RosterTable
        entries={roster.data}
        divisions={(me?.divisions ?? []).map((d) => ({ id: d.id, label: d.label }))}
        tournaments={tournaments.data.map((x) => ({ id: x.id, label: [x.name, x.stage].filter(Boolean).join(" · ") }))}
        seasons={(seasons.length ? seasons : me ? [me] : []).map((s) => ({
          id: s.id, label: s.seasonYear ? `${s.name} (${s.seasonYear})` : s.name, href: seasonHref.replace("{id}", s.id),
        }))}
        currentSeasonId={programId}
        playerHrefBase={playerHrefBase ? playerHrefBase.replace("{id}", programId) : null}
        addHref={addHref ? addHref.replace("{id}", programId) : null}
        canAdd={isAdmin}
        profileHrefBase={playerHrefBase?.startsWith("/admin/") ? "/admin/athletes/" : null}
      />
      {unenrolled.data.length > 0 && (
        <div className="space-y-2 rounded-md border border-warning/30 bg-warning-soft p-4 text-sm text-text">
          <p className="font-medium">{t("roster.unenrolled.title", { count: unenrolled.data.length })}</p>
          <p className="text-text-secondary">{t("roster.unenrolled.hint")}</p>
          <ul className="space-y-1">
            {unenrolled.data.map((m) => (
              <li key={`${m.divisionId}-${m.athleteId}`} className="flex flex-wrap items-center gap-2">
                <span>{m.name}</span>
                <span className="text-xs text-text-muted">{m.teamName}{m.jerseyNumber != null ? ` · #${m.jerseyNumber}` : ""}{m.birthYear ? ` · ${m.birthYear}` : ""}</span>
                <span className="text-xs text-warning">{t("roster.unenrolled.badge")}</span>
                {isAdmin && addHref && (
                  <Link className="text-xs text-brand-primary hover:underline"
                    href={`${addHref.replace("{id}", programId)}?athlete=${m.athleteId}&division=${m.divisionId}`}>{t("roster.unenrolled.create")}</Link>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
      <p className="text-xs text-text-muted">{t("roster.asOf", { date: f.date(today) })}</p>
    </div>
  );
}
