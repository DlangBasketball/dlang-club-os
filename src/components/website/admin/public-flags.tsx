"use client";

import * as React from "react";
import { Button, Card, CardBody, CardHeader, CardTitle, Input } from "@/components/ui";
import { useFormat, useT } from "@/lib/i18n/client";
import { setCoachWebsiteFlags, setPublicFlag, setTeamWebsiteFlags } from "@/lib/actions/website";
import { Status, useRunner } from "./shared";

export type TeamFlagRow = { id: string; name: string; slug: string | null; league: string | null; isPublic: boolean; rosterPublic: boolean; coverPublic: boolean };
export type CoachFlagRow = { id: string; name: string; isPublic: boolean; photoPublic: boolean; hasPhoto: boolean };
export type ClubEventRow = { id: string; title: string; startsAt: string; isPublic: boolean };

function TeamRow({ team, rosterAllowed }: { team: TeamFlagRow; rosterAllowed: boolean }) {
  const t = useT();
  const r = useRunner();
  const [v, setV] = React.useState({ isPublic: team.isPublic, rosterPublic: team.rosterPublic, coverPublic: team.coverPublic, slug: team.slug ?? "", league: team.league ?? "" });
  return (
    <li className="flex flex-wrap items-center gap-3 py-3">
      <span className="min-w-[8rem] flex-1 font-medium">{team.name}</span>
      <label className="flex items-center gap-1.5 text-sm"><input type="checkbox" checked={v.isPublic} onChange={(e) => setV({ ...v, isPublic: e.target.checked })} />{t("website.admin.flags.public")}</label>
      <label className="flex items-center gap-1.5 text-sm" title={rosterAllowed ? undefined : t("website.admin.flags.rosterOff")}>
        <input type="checkbox" disabled={!v.isPublic || !rosterAllowed} checked={v.rosterPublic} onChange={(e) => setV({ ...v, rosterPublic: e.target.checked })} />{t("website.admin.flags.roster")}
      </label>
      <label className="flex items-center gap-1.5 text-sm"><input type="checkbox" disabled={!v.isPublic} checked={v.coverPublic} onChange={(e) => setV({ ...v, coverPublic: e.target.checked })} />{t("website.admin.flags.cover")}</label>
      <Input aria-label={t("website.admin.flags.slug")} placeholder={t("website.admin.flags.slug")} className="w-36" value={v.slug} onChange={(e) => setV({ ...v, slug: e.target.value.toLowerCase() })} />
      <Input aria-label={t("website.admin.flags.league")} placeholder={t("website.admin.flags.league")} className="w-40" value={v.league} onChange={(e) => setV({ ...v, league: e.target.value })} />
      <Button type="button" size="sm" variant="secondary" loading={r.busy} onClick={() => r.run(() => setTeamWebsiteFlags(team.id, v))}>{t("website.admin.save")}</Button>
      <Status msg={r.msg} />
    </li>
  );
}

function CoachRow({ coach }: { coach: CoachFlagRow }) {
  const t = useT();
  const r = useRunner();
  const [v, setV] = React.useState({ isPublic: coach.isPublic, photoPublic: coach.photoPublic });
  return (
    <li className="flex flex-wrap items-center gap-3 py-3">
      <span className="min-w-[8rem] flex-1 font-medium">{coach.name}</span>
      <label className="flex items-center gap-1.5 text-sm"><input type="checkbox" checked={v.isPublic} onChange={(e) => setV({ ...v, isPublic: e.target.checked })} />{t("website.admin.flags.public")}</label>
      <label className="flex items-center gap-1.5 text-sm"><input type="checkbox" disabled={!v.isPublic || !coach.hasPhoto} checked={v.photoPublic} onChange={(e) => setV({ ...v, photoPublic: e.target.checked })} />{t("website.admin.flags.photo")}</label>
      <Button type="button" size="sm" variant="secondary" loading={r.busy} onClick={() => r.run(() => setCoachWebsiteFlags(coach.id, v))}>{t("website.admin.save")}</Button>
      <Status msg={r.msg} />
    </li>
  );
}

function EventToggle({ row }: { row: ClubEventRow }) {
  const t = useT();
  const f = useFormat();
  const r = useRunner();
  return (
    <li className="flex flex-wrap items-center gap-3 py-2">
      <span className="flex-1 text-sm">{row.title} <span className="text-text-muted">· {f.date(row.startsAt)}</span></span>
      <label className="flex items-center gap-1.5 text-sm">
        <input type="checkbox" defaultChecked={row.isPublic} disabled={r.busy} onChange={(e) => r.run(() => setPublicFlag("club_event", row.id, e.target.checked))} />
        {t("website.admin.flags.showOnWebsite")}
      </label>
      <Status msg={r.msg} />
    </li>
  );
}

/** What is public: teams (roster / cover), coaches (photo), club-wide calendar entries. All default to not public. */
export function PublicFlags({ teams, coaches, events, rosterAllowed }: { teams: TeamFlagRow[]; coaches: CoachFlagRow[]; events: ClubEventRow[]; rosterAllowed: boolean }) {
  const t = useT();
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("website.admin.flags.title")}</CardTitle>
      </CardHeader>
      <CardBody className="space-y-6">
        <p className="text-sm text-text-muted">{t("website.admin.flags.intro")}</p>
        <section className="space-y-1">
          <h3 className="font-semibold">{t("website.sections.teams")}</h3>
          {teams.length === 0 ? <p className="text-sm text-text-muted">{t("website.widgets.empty")}</p> : (
            <ul className="divide-y divide-border">{teams.map((x) => <TeamRow key={x.id} team={x} rosterAllowed={rosterAllowed} />)}</ul>
          )}
          <p className="text-xs text-text-muted">{t("website.admin.flags.rosterHint")}</p>
        </section>
        <section className="space-y-1">
          <h3 className="font-semibold">{t("website.sections.coaches")}</h3>
          {coaches.length === 0 ? <p className="text-sm text-text-muted">{t("website.widgets.empty")}</p> : (
            <ul className="divide-y divide-border">{coaches.map((x) => <CoachRow key={x.id} coach={x} />)}</ul>
          )}
        </section>
        <section className="space-y-1">
          <h3 className="font-semibold">{t("website.admin.flags.clubEvents")}</h3>
          {events.length === 0 ? <p className="text-sm text-text-muted">{t("website.widgets.empty")}</p> : (
            <ul className="divide-y divide-border">{events.map((x) => <EventToggle key={x.id} row={x} />)}</ul>
          )}
        </section>
      </CardBody>
    </Card>
  );
}
