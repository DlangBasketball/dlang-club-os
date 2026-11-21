"use client";

import * as React from "react";
import Link from "next/link";
import { CalendarCheck, CircleDollarSign, Gauge, Star } from "lucide-react";
import { Avatar, Badge, StatCard, statusTone } from "@/components/ui";
import { cn } from "@/lib/utils";
import { useT } from "@/lib/i18n/client";
import { CoverImage, type CoverEditConfig } from "@/components/media/cover-image";
import type { CoverView } from "@/lib/media/cover";

export type PlayerCardTeam = { teamId: string; teamName: string; color: string | null; jerseyNumber: number | null; position: string | null };

export type PlayerCardStats = {
  attendanceRate: number | null;
  seasonSessions: number;
  evaluation: { score: number | null; emoji: string | null; date: string | null } | null;
  /** null = not shown (role or module). */
  credits: number | null;
};

/**
 * Player-card hero: cover banner, large round photo overlapping it, name,
 * jersey number + position, team chips, age and status, then quick stat
 * tiles. Used on the admin player profile, the parent child page and the
 * coach view. Text sits on theme tokens only (dark + light themes).
 */
export function PlayerCard({
  name,
  photoUrl,
  cover,
  coverEdit,
  teams,
  positionPref,
  age,
  status,
  familyName,
  familyHref,
  teamHrefBase,
  actions,
  stats,
  showCredits = false,
  badges,
}: {
  name: string;
  photoUrl: string | null;
  cover: CoverView | null;
  coverEdit?: CoverEditConfig | null;
  teams: PlayerCardTeam[];
  positionPref?: string | null;
  age: number | null;
  status?: string | null;
  familyName?: string | null;
  familyHref?: string | null;
  /** Build a link for a team chip (admins); omit for plain chips. */
  /** Link prefix for team chips, e.g. "/admin/teams/" (strings only: this is a client component). */
  teamHrefBase?: string | null;
  actions?: React.ReactNode;
  stats?: PlayerCardStats | null;
  showCredits?: boolean;
  /** Extra status chips next to the player status (e.g. "Sponsored"). */
  badges?: React.ReactNode;
}) {
  const t = useT();
  const primary = teams.find((x) => x.jerseyNumber !== null) ?? teams[0] ?? null;
  const jersey = primary?.jerseyNumber ?? null;
  const position = primary?.position || positionPref || null;

  return (
    <div className="space-y-4">
      <div>
        <CoverImage cover={cover} variant="banner" edit={coverEdit ?? null} className="min-h-[8.5rem] sm:min-h-[11rem]" priority />
        <div className="relative flex flex-col gap-3 px-1 sm:flex-row sm:items-end sm:gap-5 sm:px-4">
          <div className="-mt-14 shrink-0 sm:-mt-16">
            <Avatar
              name={name}
              src={photoUrl}
              alt={t("athletePhoto.alt", { name })}
              size="2xl"
              className="border-4 border-bg shadow-lg ring-1 ring-border"
            />
          </div>
          <div className="min-w-0 flex-1 pb-1">
            <div className="flex flex-wrap items-center gap-2">
              {jersey !== null && (
                <span className="tnum rounded-md border border-brand-accent/40 bg-brand-accent-soft px-2 py-0.5 text-sm font-semibold text-brand-accent">
                  #{jersey}
                </span>
              )}
              <h1 className="min-w-0 truncate font-display text-2xl font-semibold leading-tight text-text sm:text-3xl">{name}</h1>
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-text-muted">
              {position && <span>{position}</span>}
              {position && age !== null && <span aria-hidden>·</span>}
              {age !== null && <span>{t("media.profile.ageYears", { age })}</span>}
              {familyName && (
                <>
                  <span aria-hidden>·</span>
                  {familyHref ? <Link href={familyHref} className="hover:text-brand-primary">{familyName}</Link> : <span>{familyName}</span>}
                </>
              )}
              {status && (
                <Badge tone={statusTone(status)}>{t.dynamic(`editPeople.athleteStatus.${status}`, undefined, status)}</Badge>
              )}
              {badges}
            </div>
            {teams.length > 0 && (
              <ul className="mt-2 flex flex-wrap gap-1.5" aria-label={t("media.roster.teamsTitle")}>
                {teams.map((tm) => {
                  const chip = (
                    <span className={cn("inline-flex items-center gap-1.5 rounded-full border border-border bg-surface-elevated px-2.5 py-0.5 text-xs text-text", teamHrefBase && "hover:border-brand-primary")}>
                      <span aria-hidden className="h-2 w-2 rounded-full bg-brand-primary" style={tm.color ? { backgroundColor: tm.color } : undefined} />
                      {tm.teamName}
                      {tm.jerseyNumber !== null && <span className="tnum text-text-muted">#{tm.jerseyNumber}</span>}
                    </span>
                  );
                  return <li key={tm.teamId}>{teamHrefBase ? <Link href={`${teamHrefBase}${tm.teamId}`}>{chip}</Link> : chip}</li>;
                })}
              </ul>
            )}
          </div>
          {actions && <div className="flex flex-wrap gap-2 sm:pb-1">{actions}</div>}
        </div>
      </div>

      {stats && (
        <div className={cn("grid grid-cols-2 gap-3", showCredits ? "lg:grid-cols-4" : "lg:grid-cols-3")}>
          <StatCard
            label={t("media.profile.statAttendance")}
            value={stats.attendanceRate !== null ? `${stats.attendanceRate}%` : "—"}
            hint={t("media.profile.statAttendanceHint")}
            icon={<CalendarCheck className="h-4 w-4" aria-hidden />}
            tone={stats.attendanceRate === null ? "brand" : stats.attendanceRate >= 80 ? "success" : stats.attendanceRate >= 60 ? "warning" : "danger"}
          />
          <StatCard
            label={t("media.profile.statSessions")}
            value={String(stats.seasonSessions)}
            hint={t("media.profile.statSessionsHint")}
            icon={<Gauge className="h-4 w-4" aria-hidden />}
          />
          <StatCard
            label={t("media.profile.statEvaluation")}
            value={
              stats.evaluation && (stats.evaluation.score !== null || stats.evaluation.emoji)
                ? [stats.evaluation.emoji, stats.evaluation.score !== null ? String(Math.round(stats.evaluation.score)) : null].filter(Boolean).join(" ")
                : "—"
            }
            hint={stats.evaluation?.score !== null && stats.evaluation?.score !== undefined ? t("media.profile.statEvaluationHint") : t("media.profile.statEvaluationNone")}
            icon={<Star className="h-4 w-4" aria-hidden />}
            accent
          />
          {showCredits && (
            <StatCard
              label={t("media.profile.statCredits")}
              value={stats.credits !== null ? String(stats.credits) : "—"}
              hint={t("media.profile.statCreditsHint")}
              icon={<CircleDollarSign className="h-4 w-4" aria-hidden />}
            />
          )}
        </div>
      )}
    </div>
  );
}
