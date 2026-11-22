import { notFound } from "next/navigation";
import Link from "next/link";
import { ChevronLeft, ShieldCheck, ClipboardList, HeartPulse, LineChart, Dumbbell, FileText } from "lucide-react";
import { Button, Card, CardHeader, CardTitle, CardBody, Badge, statusTone, EmptyState, ErrorState } from "@/components/ui";
import { getChildProfile } from "@/lib/data/parent";
import { MedicalForm } from "@/components/parent/medical-form";
import { getI18n } from "@/lib/i18n/server";
import { PhotoManager } from "@/components/athlete/photo-manager";
import { PlayerCard } from "@/components/athlete/player-card";
import { ProfileTabs, type ProfileTab } from "@/components/athlete/profile-tabs";
import { PlayerTeamsCard } from "@/components/teams/player-teams-card";
import { AthleteProgrammesCard } from "@/components/selection/roster/athlete-programmes-card";
import { photoUrlsForAthletes } from "@/lib/people/server";
import { getAthleteCover } from "@/lib/media/server";
import { getPlayerStats, getPlayerTeams } from "@/lib/data/player-profile";
import { MemberCardPanel } from "@/components/member-card/member-card-panel";
import { LicenceCard } from "@/components/athlete/licence-card";
import { SponsorshipNote } from "@/components/athlete/sponsorship-badge";

/**
 * Parent app: one child's player card. Guardians edit the photo, the cover
 * (private: only the club and the family see it), medical information; teams
 * and programmes are read-only here. No billing tab (invoices have their own
 * page) and no other family's data (RLS).
 */
export default async function ChildProfilePage({ params }: { params: Promise<{ id: string }> }) {
  const { t, f } = await getI18n();
  const { id } = await params;
  const { data, error } = await getChildProfile(id);
  if (error) return <ErrorState title={t("media.profile.loadError")} message={error} />;
  if (!data) notFound();
  const m = data.medical;
  const [photos, cover, teams] = await Promise.all([
    photoUrlsForAthletes([data.id]),
    getAthleteCover(data.id),
    getPlayerTeams(data.id),
  ]);
  const stats = await getPlayerStats(data.id, data.attendance, { familyView: true });

  const overview = (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      <Card className="lg:col-span-2">
        <CardHeader><CardTitle>{t("media.profile.detailsTitle")}</CardTitle></CardHeader>
        <CardBody className="grid grid-cols-2 gap-2">
          <div className="rounded-md bg-surface-elevated px-3 py-2">
            <div className="text-xs text-text-muted">{t("media.profile.dob")}</div>
            <div className="text-sm text-text">{f.date(data.dob)}</div>
          </div>
          <div className="rounded-md bg-surface-elevated px-3 py-2">
            <div className="text-xs text-text-muted">{t("media.profile.gender")}</div>
            <div className="text-sm text-text">{data.gender ? t.dynamic(`editPeople.gender.${data.gender.trim().toLowerCase()}`, undefined, data.gender) : "—"}</div>
          </div>
        </CardBody>
      </Card>
      {data.sponsorship.kind !== "none" && (
        <div className="lg:col-span-2"><SponsorshipNote kind={data.sponsorship.kind} percent={data.sponsorship.percent} sponsorName={data.sponsorship.sponsorName} /></div>
      )}
      <div className="lg:col-span-2"><LicenceCard licence={data.licence} /></div>
      <Card>
        <CardHeader><CardTitle>{t("athletePhoto.title")}</CardTitle></CardHeader>
        <CardBody>
          <PhotoManager athleteId={data.id} name={data.name} photoUrl={photos[data.id] ?? null} compact />
        </CardBody>
      </Card>
      <Card>
        <CardHeader><CardTitle>{t("sports.cards.title")}</CardTitle></CardHeader>
        <CardBody>
          <MemberCardPanel athleteId={data.id} pdfHref={`/parent/children/${data.id}/card`} />
        </CardBody>
      </Card>
      <Card className="lg:col-span-2">
        <CardHeader><CardTitle className="flex items-center gap-2"><HeartPulse className="h-4 w-4 text-brand-primary" aria-hidden /> {t("media.profile.medicalTitle")}</CardTitle></CardHeader>
        <CardBody>
          <MedicalForm athleteId={data.id} initial={{
            allergies: m?.allergies ?? "", conditions: m?.conditions ?? "", medications: m?.medications ?? "",
            notes: m?.notes ?? "", emergencyContactName: m?.emergencyContactName ?? "", emergencyContactPhone: m?.emergencyContactPhone ?? "",
          }} />
        </CardBody>
      </Card>
    </div>
  );

  const teamsTab = (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      <PlayerTeamsCard athleteId={data.id} teams={teams} options={[]} editable={false} />
      <AthleteProgrammesCard athleteId={data.id} />
      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><ClipboardList className="h-4 w-4" aria-hidden /> {t("media.profile.registrationsTitle")}</CardTitle></CardHeader>
        <CardBody className="p-0">
          {data.registrations.length === 0 ? (
            <div className="p-5"><EmptyState icon={<ClipboardList className="h-5 w-5" />} title={t("media.profile.noRegistrations")} /></div>
          ) : (
            <ul>{data.registrations.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-3 border-b border-border-soft px-5 py-3 last:border-0">
                <span className="min-w-0 truncate text-sm text-text">{r.programName}</span>
                <Badge tone={statusTone(r.status)}>{t.dynamic(`status.${r.status}`, undefined, r.status)}</Badge>
              </li>
            ))}</ul>
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
          <p className="text-sm text-text-muted">{t("media.profile.developmentHintParent")}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href={`/parent/development/${data.id}`}>
            <Button variant="secondary" size="sm"><LineChart className="h-4 w-4" aria-hidden /> {t("media.profile.openDevelopment")}</Button>
          </Link>
          <Link href={`/parent/children/${data.id}/training`}>
            <Button variant="secondary" size="sm"><Dumbbell className="h-4 w-4" aria-hidden /> {t("training.profile.link")}</Button>
          </Link>
        </div>
      </CardBody>
    </Card>
  );

  const attendanceTab = (
    <Card>
      <CardHeader><CardTitle>{t("media.profile.recentAttendance")}</CardTitle></CardHeader>
      <CardBody className="p-0">
        {data.attendance.length === 0 ? (<div className="p-5 text-sm text-text-muted">{t("media.profile.noPublishedAttendance")}</div>) : (
          <ul>{data.attendance.slice(0, 20).map((a, i) => (
            <li key={i} className="flex items-center justify-between gap-3 border-b border-border-soft px-5 py-2.5 last:border-0">
              <span className="min-w-0 truncate text-sm text-text">{a.programName ?? t("media.profile.session")}<span className="ml-2 text-xs text-text-muted">{f.date(a.date)}</span></span>
              <Badge tone={statusTone(a.status)}>{t.dynamic(`status.${a.status}`, undefined, a.status)}</Badge>
            </li>
          ))}</ul>
        )}
      </CardBody>
    </Card>
  );

  const documentsTab = (
    <Card>
      <CardHeader><CardTitle className="flex items-center gap-2"><ShieldCheck className="h-4 w-4" aria-hidden /> {t("media.profile.consentsTitle")}</CardTitle></CardHeader>
      <CardBody className="space-y-4">
        {data.consents.length === 0 ? (<p className="text-sm text-text-muted">{t("media.profile.noConsents")}</p>) : (
          <ul className="divide-y divide-border-soft rounded-md border border-border-soft">{data.consents.map((c, i) => (
            <li key={i} className="flex items-center justify-between gap-3 px-4 py-2.5">
              <span className="flex min-w-0 items-center gap-2 text-sm text-text"><ShieldCheck className="h-4 w-4 shrink-0 text-success" aria-hidden /><span className="truncate">{c.title}</span></span>
              <span className="shrink-0 text-xs text-text-muted">{f.date(c.acceptedAt)}</span>
            </li>
          ))}</ul>
        )}
        <Link href="/parent/documents" className="inline-flex items-center gap-1.5 text-sm text-brand-primary hover:underline">
          <FileText className="h-4 w-4" aria-hidden /> {t("media.profile.openDocuments")}
        </Link>
      </CardBody>
    </Card>
  );

  const tabs: ProfileTab[] = [
    { id: "overview", label: t("media.profile.tabOverview"), content: overview },
    { id: "teams", label: t("media.profile.tabTeams"), content: teamsTab, count: teams.length + data.registrations.length },
    { id: "development", label: t("media.profile.tabDevelopment"), content: developmentTab },
    { id: "attendance", label: t("media.profile.tabAttendance"), content: attendanceTab, count: data.attendance.length },
    { id: "documents", label: t("media.profile.tabDocuments"), content: documentsTab, count: data.consents.length },
  ];

  return (
    <div className="animate-fade-up space-y-6">
      <Link href="/parent/children" className="inline-flex items-center gap-1 text-sm text-text-muted hover:text-text">
        <ChevronLeft className="h-4 w-4" aria-hidden /> {t("media.profile.backToChildren")}
      </Link>
      <PlayerCard
        name={data.name}
        photoUrl={photos[data.id] ?? null}
        cover={cover}
        coverEdit={{ target: "athlete", id: data.id, canUseLibrary: false }}
        teams={teams.map((tm) => ({ teamId: tm.teamId, teamName: tm.teamName, color: tm.color, jerseyNumber: tm.jerseyNumber, position: tm.position }))}
        age={data.age}
        stats={stats}
      />
      <ProfileTabs tabs={tabs} label={t("media.profile.sectionsLabel")} />
    </div>
  );
}
