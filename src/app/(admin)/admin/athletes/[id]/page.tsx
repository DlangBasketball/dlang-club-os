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
import { getPlayerBilling, getPlayerStats, getPlayerTeams, getTeamPickerOptions } from "@/lib/data/player-profile";
import { MemberCardPanel } from "@/components/member-card/member-card-panel";
import { shopDb } from "@/lib/shop/db";
import { MoveToAlumniButton } from "@/components/alumni/tools";
import { hasFeature } from "@/lib/upgrades/server";

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
export default async function AthleteDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { t, f } = await getI18n();
  const { id } = await params;
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

  const [photos, cover, family, attendanceRes, teams, teamOptions, billing, cardTag, alumniOn] = await Promise.all([
    signAthletePhotos([{ id: a.id, photoPath: a.photoPath }], a.orgId),
    getAthleteCover(a.id),
    getFamily(a.familyId),
    athleteAttendanceHistory(id),
    getPlayerTeams(a.id),
    isAdmin ? getTeamPickerOptions() : Promise.resolve([]),
    canViewBilling ? getPlayerBilling(a.familyId, a.id) : Promise.resolve([]),
    isAdmin
      ? shopDb().then(async (db) => (await db.from("member_cards").select("nfc_tag_id").eq("athlete_id", id).maybeSingle()).data?.nfc_tag_id ?? null)
      : Promise.resolve(null),
    isAdmin ? hasFeature(a.orgId, "alumni_network") : Promise.resolve(false),
  ]);
  const attendanceHistory = attendanceRes.data ?? [];
  const stats = await getPlayerStats(a.id, attendanceHistory, { includeCredits: isAdmin, includeDevelopment: isAdmin });
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
            <Detail label={t("media.profile.positionPref")} value={a.positionPref} />
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
              <MemberCardPanel athleteId={id} pdfHref={`/admin/athletes/${id}/card`} admin initialTag={cardTag} />
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

  const teamsTab = (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      <PlayerTeamsCard athleteId={a.id} teams={teams} options={teamOptions} editable={isAdmin} />
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

  const attendanceTab = (
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

  const billingTab = (
    <Card>
      <CardHeader>
        <CardTitle>{t("media.profile.billingTitle")}</CardTitle>
        <Link href={`/admin/families/${a.familyId}`} className="text-xs text-brand-primary hover:underline">{t("media.profile.openFamily")}</Link>
      </CardHeader>
      <CardBody className="p-0">
        {billing.length === 0 ? (
          <p className="px-5 py-6 text-center text-sm text-text-muted">{t("media.profile.noInvoices")}</p>
        ) : (
          <ul>
            {billing.map((inv) => (
              <li key={inv.id} className="flex items-center justify-between gap-3 border-b border-border-soft px-5 py-2.5 last:border-0">
                <div className="min-w-0">
                  <Link href={`/admin/invoices/${inv.id}`} className="tnum text-sm text-text hover:text-brand-primary">{inv.number}</Link>
                  <div className="text-xs text-text-muted">
                    {f.date(inv.issuedAt)}
                    {!inv.forThisPlayer && ` · ${t("media.profile.familyInvoice")}`}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <span className="tnum text-sm text-text">{f.money(inv.total, inv.currency)}</span>
                  <Badge tone={statusTone(inv.status)}>{t.dynamic(`status.${inv.status}`, undefined, inv.status)}</Badge>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );

  const tabs: ProfileTab[] = [
    { id: "overview", label: t("media.profile.tabOverview"), content: overview },
    { id: "teams", label: t("media.profile.tabTeams"), content: teamsTab, count: teams.length + programs.length },
    ...(isAdmin ? [{ id: "development", label: t("media.profile.tabDevelopment"), content: developmentTab }] : []),
    { id: "attendance", label: t("media.profile.tabAttendance"), content: attendanceTab, count: attendanceHistory.length },
    { id: "documents", label: t("media.profile.tabDocuments"), content: documentsTab },
    ...(canViewBilling ? [{ id: "billing", label: t("media.profile.tabBilling"), content: billingTab }] : []),
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
      <ProfileTabs tabs={tabs} label={t("media.profile.sectionsLabel")} />
    </div>
  );
}
