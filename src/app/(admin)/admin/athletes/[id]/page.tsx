import Link from "next/link";
import { notFound } from "next/navigation";
import { AlertTriangle, ClipboardList, Dumbbell, FileText, LineChart, Pencil, ShieldCheck, UserCircle } from "lucide-react";
import {
  Button, Card, CardHeader, CardTitle, CardBody, Badge, statusTone, ErrorState, EmptyState,
} from "@/components/ui";
import { MedicalSection } from "@/components/athlete/medical-section";
import { PhotoManager } from "@/components/athlete/photo-manager";
import { ParentContactSection } from "@/components/athlete/parent-contact-section";
import { ActivityTimeline } from "@/components/athlete/activity-timeline";
import { LicenceCard } from "@/components/athlete/licence-card";
import { SponsorshipCard } from "@/components/athlete/sponsorship-card";
import { SponsorshipBadge } from "@/components/athlete/sponsorship-badge";
import { formatPostalAddress } from "@/lib/people/licence";
import { PlayerCard } from "@/components/athlete/player-card";
import { ProfileTabs, type ProfileTab } from "@/components/athlete/profile-tabs";
import { PlayerTeamsCard } from "@/components/teams/player-teams-card";
import { AthleteProgrammesCard } from "@/components/selection/roster/athlete-programmes-card";
import { DeletePersonButton } from "@/components/people/delete-person";
import { isHiddenAthleteStatus } from "@/lib/people/person-delete";
import { getAthleteDetail } from "@/lib/data/athletes";
import { getFamily } from "@/lib/data/families";
import { getSessionUser } from "@/lib/auth/get-user";
import { athleteAttendanceHistory } from "@/lib/data/attendance-admin";
import { getI18n } from "@/lib/i18n/server";
import { signAthletePhotos } from "@/lib/people/server";
import { ageOn } from "@/lib/people/player-stats";
import { getAthleteCover } from "@/lib/media/server";
import { getFinalisedSheetMarks, getPlayerStats, getPlayerTeams, getTeamPickerOptions } from "@/lib/data/player-profile";
import { CourtsideCardSection } from "@/components/member-card/courtside-section";
import { shopDb } from "@/lib/shop/db";
import { MoveToAlumniButton } from "@/components/alumni/tools";
import { hasFeature } from "@/lib/upgrades/server";
import { getCurrentSeasonId, getPlayerBillingOverview, getPlayerMemberships } from "@/lib/data/player-billing";
import { BillingTab, MembershipTab } from "@/components/player-billing/profile-panels";
import { AthleteBookingsPanel, BookedSessionAttendance, BookingInvoicesPanel } from "@/components/booking/portal/admin-athlete";
import { getAthleteBookingHistory } from "@/lib/booking/data";
import { getBookedSessionMarks } from "@/lib/booking/portal-data";
import { parseProfileTab } from "@/lib/billing/player-billing";
import { zonedDayKey } from "@/lib/staff/hours";
import { dateParam, playerTotals, playerTotalsByTeam } from "@/lib/attendance/admin-stats";
import { getAthleteTeamPeriods, getSessionAttendance } from "@/lib/data/team-attendance-admin";
import { getSessionsOverview, toSessionRows } from "@/lib/attendance/overview";
import { listSeasons } from "@/lib/sportsops/data";
import { SessionHistoryList, TotalsSummary } from "@/components/attendance/admin/views";
import { selectClass } from "@/components/teams/fields";
import { Input } from "@/components/ui";
import { ProfileHistory } from "@/components/participants/profile-history";
import { getProfileHistory } from "@/lib/participants/admin-data";

function Detail({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="rounded-md bg-surface-elevated px-3 py-2">
      <div className="text-xs text-text-muted">{label}</div>
      <div className="text-sm text-text">{value?.trim() ? value : "—"}</div>
    </div>
  );
}

/**
 * Player profile (admin + finance). A "player card" hero (cover, photo, number,
 * teams, quick stats) and tabbed sections. Finance sees billing, never
 * medical data; editing (teams, cover, photo, medical, consents) is admin-only.
 */
export default async function AthleteDetailPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string; from?: string; to?: string; season?: string; team?: string }> }) {
  const { t, f } = await getI18n();
  const { id } = await params;
  const sp = await searchParams;
  const initialTab = parseProfileTab(sp.tab);
  const taFrom = dateParam(sp.from);
  const taTo = dateParam(sp.to);
  const taSeason = sp.season && /^[0-9a-f-]{36}$/i.test(sp.season) ? sp.season : null;
  const taTeam = sp.team && /^[0-9a-f-]{36}$/i.test(sp.team) ? sp.team : null;
  const [{ data, error }, user] = await Promise.all([getAthleteDetail(id), getSessionUser()]);
  if (error) return <ErrorState title={t("media.profile.loadError")} message={error} />;
  if (!data) notFound();

  const { athlete: a, medical, safety, programs, timeline } = data;
  const isAdmin = !!user?.roles.includes("admin");
  const isFinance = !!user?.roles.includes("finance");
  const canViewMedical = isAdmin;
  const canViewBilling = isAdmin || isFinance;
  const fullName = `${a.firstName} ${a.lastName}`;
  const today = new Date().toISOString().slice(0, 10);
  const optionLabel = (group: "gender" | "hand", v: string | null) =>
    v ? t.dynamic(`editPeople.${group}.${v.trim().toLowerCase()}`, undefined, v) : null;

  const [photos, cover, family, attendanceRes, teams, teamOptions, cardTag, alumniOn, memberships, bookings, billingOverview, profileHistory, currentSeasonId] = await Promise.all([
    signAthletePhotos([{ id: a.id, photoPath: a.photoPath }], a.orgId),
    getAthleteCover(a.id),
    getFamily(a.familyId),
    athleteAttendanceHistory(id),
    getPlayerTeams(a.id),
    isAdmin ? getTeamPickerOptions() : Promise.resolve([]),
    isAdmin
      ? shopDb().then(async (db) => (await db.from("member_cards").select("nfc_tag_id").eq("athlete_id", id).maybeSingle()).data?.nfc_tag_id ?? null)
      : Promise.resolve(null),
    isAdmin ? hasFeature(a.orgId, "alumni_network") : Promise.resolve(false),
    canViewBilling ? getPlayerMemberships(a.id) : Promise.resolve(null),
    // Booking history (staff RPC): bookings tab, booked-session attendance, invoices from bookings.
    canViewBilling ? getAthleteBookingHistory(a.id) : Promise.resolve(null),
    canViewBilling ? getPlayerBillingOverview(a.id, a.familyId) : Promise.resolve(null),
    // Profile history: admins only (finance / coaches / families never; the RPC re-checks).
    isAdmin ? getProfileHistory(a.id) : Promise.resolve(null),
    getCurrentSeasonId(),
  ]);
  const attendanceHistory = attendanceRes.data ?? [];
  const bookingRows = [...(bookings?.data?.upcoming ?? []), ...(bookings?.data?.past ?? [])];
  const bookedMarks = isAdmin ? await getBookedSessionMarks(a.id, bookingRows) : [];
  // Team assignments with dates (admin + finance) and team attendance (admin only).
  const dayKey = zonedDayKey(new Date(), f.timeZone);
  const [teamPeriods, teamSessions, seasonList] = await Promise.all([
    getAthleteTeamPeriods(a.id, dayKey),
    // Same read as the Attendance tab and the Dashboard (attendance_sessions_overview): team trainings / games,
    // booked sessions and earlier programme sessions, with this player's status.
    isAdmin ? getSessionsOverview({ athleteId: a.id, from: taFrom, to: taTo, teamId: taTeam, scope: taTeam ? "teams" : "all", limit: 1000 }) : Promise.resolve(null),
    isAdmin ? listSeasons() : Promise.resolve(null),
  ]);
  // A season keeps its own rule (the team's season + its training window): narrow to those sessions.
  const seasonIds = isAdmin && taSeason
    ? new Set(((await getSessionAttendance({ athleteId: a.id, from: taFrom, to: taTo, seasonId: taSeason, teamId: taTeam, limit: 1000 })).data ?? []).map((r) => r.event_id))
    : null;
  const sessionRows = toSessionRows((teamSessions?.data ?? []).filter((r) => !seasonIds || seasonIds.has(r.session_id)))
    .filter((r) => Date.parse(r.starts_at) <= Date.now());
  const sheetMarks = isAdmin ? await getFinalisedSheetMarks(a.id) : [];
  const stats = await getPlayerStats(a.id, attendanceHistory, { includeCredits: isAdmin, includeDevelopment: isAdmin, sheetMarks });
  const emergencyName = medical?.emergencyContactName ?? safety?.emergencyContactName ?? null;
  const emergencyPhone = medical?.emergencyContactPhone ?? safety?.emergencyContactPhone ?? null;
  const consents = timeline.filter((e) => e.kind === "consent");

  const overview = (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
      <div className="space-y-6 lg:col-span-2">
        <Card>
          <CardHeader>
            <CardTitle>{t("media.profile.detailsTitle")}</CardTitle>
            {isAdmin && <Link href={`/admin/athletes/${id}/edit`} className="text-xs text-brand-primary hover:underline">{t("editPeople.edit")}</Link>}
          </CardHeader>
          <CardBody className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <Detail label={t("media.profile.dob")} value={f.date(a.dob)} />
            <Detail label={t("media.profile.gender")} value={optionLabel("gender", a.gender)} />
            <Detail label={t("media.profile.nationality")} value={a.nationality} />
            <Detail label={t("media.profile.school")} value={a.school} />
            <Detail label={t("media.profile.jerseySize")} value={a.jerseySize} />
            <Detail label={t("media.profile.dominantHand")} value={optionLabel("hand", a.dominantHand)} />
            <Detail label={t("media.profile.positionPref")} value={a.positionPref ? t.dynamic(`participants.positions.${a.positionPref}`, undefined, a.positionPref) : null} />
            {a.notes ? <div className="col-span-2 sm:col-span-3"><Detail label={t("media.profile.notes")} value={a.notes} /></div> : null}
          </CardBody>
        </Card>
        <ActivityTimeline events={timeline} />
      </div>
      <div className="space-y-6">
        {isAdmin && (
          <Card>
            <CardHeader><CardTitle>{t("athletePhoto.title")}</CardTitle></CardHeader>
            <CardBody>
              <PhotoManager athleteId={id} name={fullName} photoUrl={photos.get(id) ?? null} compact />
            </CardBody>
          </Card>
        )}
        {isAdmin && (
          <Card>
            <CardHeader><CardTitle>{t("sports.cards.title")}</CardTitle></CardHeader>
            <CardBody>
              <CourtsideCardSection athleteId={id} name={fullName} pdfHref={`/admin/athletes/${id}/card`} admin initialTag={cardTag} />
            </CardBody>
          </Card>
        )}
        <LicenceCard licence={a.licence} showFee={canViewBilling} editHref={isAdmin ? `/admin/athletes/${id}/edit#licence` : undefined} />
        {canViewBilling && (
          <SponsorshipCard athleteId={id} sponsorship={a.sponsorship} editHref={isAdmin ? `/admin/athletes/${id}/edit#sponsorship` : undefined} inlineEdit={!isAdmin} />
        )}
        {canViewMedical && <MedicalSection medical={medical} athleteId={id} canView />}
        <ParentContactSection
          guardians={family.data?.guardians ?? []}
          familyPhone={family.data?.phone ?? null}
          familyAddress={family.data ? formatPostalAddress(family.data) : null}
          emergencyName={emergencyName}
          emergencyPhone={emergencyPhone}
        />
      </div>
    </div>
  );

  const periods = teamPeriods.data ?? [];
  const teamHistoryCard = (
    <Card>
      <CardHeader><CardTitle>{t("adminAttendance.profile.assignments")}</CardTitle></CardHeader>
      <CardBody className="p-0">
        {periods.length === 0 ? (
          <p className="px-5 py-5 text-sm text-text-muted">{t("adminAttendance.profile.noAssignments")}</p>
        ) : (
          <ul>
            {periods.map((p, i) => (
              <li key={`${p.teamId}-${p.joinedOn}-${i}`} className="flex flex-col gap-1 border-b border-border-soft px-5 py-2.5 last:border-0 sm:flex-row sm:items-center sm:justify-between">
                <span className="flex min-w-0 items-center gap-2">
                  <Link href={`/admin/teams/${p.teamId}`} className="truncate text-sm text-text hover:text-brand-primary">{p.teamName}</Link>
                  {p.current ? <Badge tone="success">{t("adminAttendance.profile.current")}</Badge> : <Badge>{t("adminAttendance.profile.past")}</Badge>}
                </span>
                <span className="text-xs text-text-muted">
                  {p.seasonName ? `${p.seasonName} · ` : ""}{f.date(p.joinedOn)} – {p.leftOn ? f.date(p.leftOn) : t("adminAttendance.profile.open")}
                  {p.reason ? ` · ${p.reason}` : ""}
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );

  const teamsTab = (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      <div className="space-y-2">
        <PlayerTeamsCard athleteId={a.id} teams={teams} options={teamOptions} editable={isAdmin} />
        <p className="text-xs text-text-muted">{t("playerBilling.membership.teamsNeverChangeFee")}</p>
        {teamHistoryCard}
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><ClipboardList className="h-4 w-4" aria-hidden /> {t("media.profile.programmesTitle")}</CardTitle>
          {isAdmin && <Link href={`/admin/athletes/${id}/edit`} className="text-xs text-brand-primary hover:underline">{t("media.profile.enrol")}</Link>}
        </CardHeader>
        <CardBody className="p-0">
          {programs.length === 0 ? (
            <div className="p-5"><EmptyState icon={<UserCircle className="h-5 w-5" />} title={t("media.profile.notEnrolled")} description={t("media.profile.notEnrolledHint")} /></div>
          ) : (
            <ul>
              {programs.map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-3 border-b border-border-soft px-5 py-3 last:border-0">
                  <Link href={`/admin/registrations/${p.id}`} className="min-w-0 truncate text-sm text-text hover:text-brand-primary">{p.name}</Link>
                  <Badge tone={statusTone(p.status)}>{t.dynamic(`status.${p.status}`, undefined, p.status)}</Badge>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
    </div>
  );

  const developmentTab = (
    <Card>
      <CardBody className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="font-medium text-text">{t("media.profile.developmentTitle")}</p>
          <p className="text-sm text-text-muted">{t("media.profile.developmentHint")}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {isAdmin && (
            <Link href={`/admin/development/athletes/${id}`}>
              <Button variant="secondary" size="sm"><LineChart className="h-4 w-4" aria-hidden /> {t("media.profile.openDevelopment")}</Button>
            </Link>
          )}
          {isAdmin && (
            <Link href={`/admin/athletes/${id}/training`}>
              <Button variant="secondary" size="sm"><Dumbbell className="h-4 w-4" aria-hidden /> {t("training.profile.link")}</Button>
            </Link>
          )}
          {isAdmin && alumniOn && !isHiddenAthleteStatus(a.status) && <MoveToAlumniButton athleteId={id} />}
        </div>
      </CardBody>
    </Card>
  );

  const byTeam = playerTotalsByTeam(sessionRows);
  const teamAttendance = isAdmin ? (
    <div className="space-y-4">
      <Card>
        <CardHeader><CardTitle>{t("adminAttendance.profile.teamAttendance")}</CardTitle></CardHeader>
        <CardBody className="space-y-4">
          <form method="get" className="flex flex-wrap items-end gap-3">
            <input type="hidden" name="tab" value="attendance" />
            <label className="text-xs text-text-muted">{t("adminAttendance.filters.from")}
              <Input type="date" name="from" defaultValue={taFrom ?? ""} className="mt-1 h-9 w-40" />
            </label>
            <label className="text-xs text-text-muted">{t("adminAttendance.filters.to")}
              <Input type="date" name="to" defaultValue={taTo ?? ""} className="mt-1 h-9 w-40" />
            </label>
            <label className="text-xs text-text-muted">{t("adminAttendance.filters.season")}
              <select name="season" defaultValue={taSeason ?? ""} className={`${selectClass} mt-1 h-9 w-44`}>
                <option value="">{t("adminAttendance.filters.allSeasons")}</option>
                {(seasonList?.data ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </label>
            <label className="text-xs text-text-muted">{t("adminAttendance.filters.team")}
              <select name="team" defaultValue={taTeam ?? ""} className={`${selectClass} mt-1 h-9 w-44`}>
                <option value="">{t("adminAttendance.filters.allTeams")}</option>
                {Array.from(new Map(periods.map((p) => [p.teamId, p.teamName])).entries()).map(([tid, name]) => <option key={tid} value={tid}>{name}</option>)}
              </select>
            </label>
            <Button type="submit" size="sm" variant="secondary">{t("adminAttendance.filters.apply")}</Button>
          </form>
          {teamSessions?.error ? <ErrorState message={t("teamAttendance.errors.generic")} /> : (
            <>
              <TotalsSummary totals={playerTotals(sessionRows)} />
              {byTeam.length > 1 && (
                <ul className="flex flex-wrap gap-2 text-xs text-text-muted">
                  {byTeam.map((b) => (
                    <li key={b.teamId} className="rounded-md bg-surface-elevated px-3 py-1.5">
                      <span className="font-medium text-text">{b.teamName}</span> · {t("adminAttendance.profile.teamRate", {
                        sessions: b.totals.sessions, rate: b.totals.rate === null ? "—" : f.percent(b.totals.rate, 0) })}
                    </li>
                  ))}
                </ul>
              )}
              <SessionHistoryList rows={sessionRows} mode="player" showTeam />
            </>
          )}
        </CardBody>
      </Card>
    </div>
  ) : null;

  const programmeAttendance = (
    <Card>
      <CardHeader><CardTitle>{t("media.profile.attendanceTitle")}</CardTitle></CardHeader>
      <CardBody className="p-0">
        {attendanceHistory.length === 0 ? (
          <p className="px-5 py-6 text-center text-sm text-text-muted">{t("media.profile.noAttendance")}</p>
        ) : (
          <ul>
            {attendanceHistory.map((row, i) => (
              <li key={i} className="flex items-center justify-between gap-3 border-b border-border-soft px-5 py-2.5 last:border-0">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="truncate text-sm text-text">{row.programName}</span>
                  {row.injury && <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-danger" aria-label={t("media.profile.injury")} />}
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <span className="text-xs text-text-muted">{row.date ? f.date(row.date) : "—"}</span>
                  <Badge tone={statusTone(row.status)}>{t.dynamic(`status.${row.status}`, undefined, row.status)}</Badge>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
  const attendanceTab = (
    <div className="space-y-6">
      {teamAttendance}
      {isAdmin && bookingRows.length > 0 && <BookedSessionAttendance rows={bookedMarks} t={t} f={f} />}
      {/* Earlier programme marks: shown when there are any, or when there is no sheet history above. */}
      {(attendanceHistory.length > 0 || !teamAttendance) && programmeAttendance}
    </div>
  );

  const documentsTab = (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><ShieldCheck className="h-4 w-4" aria-hidden /> {t("media.profile.consentsTitle")}</CardTitle>
        {isAdmin && <Link href={`/admin/athletes/${id}/edit#consents`} className="text-xs text-brand-primary hover:underline">{t("media.profile.manageConsents")}</Link>}
      </CardHeader>
      <CardBody className="space-y-4">
        {consents.length === 0 ? (
          <p className="text-sm text-text-muted">{t("media.profile.noConsents")}</p>
        ) : (
          <ul className="divide-y divide-border-soft rounded-md border border-border-soft">
            {consents.map((c) => (
              <li key={c.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                <span className="min-w-0 truncate text-sm text-text">{c.label}</span>
                <span className="shrink-0 text-xs text-text-muted">{c.at ? f.date(c.at) : "—"}</span>
              </li>
            ))}
          </ul>
        )}
        {isAdmin && (
          <Link href="/admin/documents" className="inline-flex items-center gap-1.5 text-sm text-brand-primary hover:underline">
            <FileText className="h-4 w-4" aria-hidden /> {t("media.profile.openDocuments")}
          </Link>
        )}
      </CardBody>
    </Card>
  );

  const selectionTab = (
    <AthleteProgrammesCard athleteId={a.id} recordHref={(programId, applicationId) => `/admin/selection/${programId}/players/${applicationId}`} />
  );

  const tabs: ProfileTab[] = [
    { id: "overview", label: t("media.profile.tabOverview"), content: overview },
    { id: "teams", label: t("media.profile.tabTeams"), content: teamsTab, count: teams.length + programs.length },
    ...(canViewBilling ? [{
      id: "membership", label: t("playerBilling.tabs.membership"),
      content: <MembershipTab athleteId={a.id} memberships={memberships?.data ?? []} currentSeasonId={currentSeasonId} canAdd={isAdmin} error={memberships?.error} />,
      count: (memberships?.data ?? []).length,
    }] : []),
    { id: "selection", label: t("playerBilling.tabs.selection"), content: selectionTab },
    ...(canViewBilling ? [{
      id: "bookings", label: t("playerBilling.tabs.bookings"),
      content: <AthleteBookingsPanel athleteId={a.id} upcoming={bookings?.data?.upcoming ?? []} past={bookings?.data?.past ?? []}
                                     error={bookings?.error} canBook={!isHiddenAthleteStatus(a.status)} t={t} f={f} />,
      count: bookingRows.length,
    }] : []),
    ...(isAdmin ? [{ id: "development", label: t("media.profile.tabDevelopment"), content: developmentTab }] : []),
    { id: "attendance", label: t("media.profile.tabAttendance"), content: attendanceTab, count: attendanceHistory.length + sessionRows.length + bookedMarks.length },
    { id: "documents", label: t("media.profile.tabDocuments"), content: documentsTab },
    ...(isAdmin && profileHistory ? [{
      id: "history", label: t("myAthletes.history.tab"),
      content: <ProfileHistory entries={profileHistory} t={t} f={f} />,
      count: profileHistory.length,
    }] : []),
    ...(canViewBilling ? [{
      id: "billing", label: t("media.profile.tabBilling"),
      content: (
        <div className="space-y-6">
          <BillingTab overview={billingOverview?.data ?? null} error={billingOverview?.error} familyId={a.familyId} athleteId={a.id} />
          <BookingInvoicesPanel rows={bookingRows} t={t} f={f} />
        </div>
      ),
    }] : []),
  ];

  return (
    <div className="animate-fade-up space-y-6">
      <PlayerCard
        name={fullName}
        photoUrl={photos.get(id) ?? null}
        cover={cover}
        coverEdit={isAdmin ? { target: "athlete", id: a.id, canUseLibrary: true } : null}
        teams={teams.map((m) => ({ teamId: m.teamId, teamName: m.teamName, color: m.color, jerseyNumber: m.jerseyNumber, position: m.position }))}
        teamHrefBase="/admin/teams/"
        positionPref={a.positionPref}
        age={ageOn(a.dob, today)}
        status={a.status}
        familyName={a.familyName}
        familyHref={`/admin/families/${a.familyId}`}
        stats={stats}
        showCredits={isAdmin}
        badges={<SponsorshipBadge kind={a.sponsorship.kind} percent={a.sponsorship.percent} />}
        actions={
          isAdmin ? (
            <>
              <Link href={`/admin/athletes/${id}/edit`}><Button variant="secondary" size="sm"><Pencil className="h-4 w-4" aria-hidden /> {t("editPeople.edit")}</Button></Link>
              {isHiddenAthleteStatus(a.status) ? (
                <Link href="/admin/deleted"><Button variant="ghost" size="sm">{t("personDelete.deleted.link")}</Button></Link>
              ) : (
                <DeletePersonButton kind="athlete" id={id} name={fullName} redirectTo="/admin/athletes" />
              )}
            </>
          ) : undefined
        }
      />
      <ProfileTabs tabs={tabs} label={t("media.profile.sectionsLabel")} initial={initialTab} param="tab" />
    </div>
  );
}
