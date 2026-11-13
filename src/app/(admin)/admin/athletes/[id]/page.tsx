import Link from "next/link";
import { notFound } from "next/navigation";
import { Pencil, UserCircle, Users } from "lucide-react";
import {
  PageHeader, Avatar, Button, Card, CardHeader, CardTitle, CardBody, Badge, statusTone, ErrorState, EmptyState,
} from "@/components/ui";
import { MedicalSection } from "@/components/athlete/medical-section";
import { PhotoManager } from "@/components/athlete/photo-manager";
import { ParentContactSection } from "@/components/athlete/parent-contact-section";
import { ActivityTimeline } from "@/components/athlete/activity-timeline";
import { ConfirmDeleteButton } from "@/components/confirm-delete-button";
import { getAthleteDetail } from "@/lib/data/athletes";
import { getFamily } from "@/lib/data/families";
import { getSessionUser } from "@/lib/auth/get-user";
import { deleteAthlete } from "@/lib/actions/athlete";
import { athleteAttendanceHistory } from "@/lib/data/attendance-admin";
import { AlertTriangle } from "lucide-react";
import { getI18n } from "@/lib/i18n/server";
import { signAthletePhotos } from "@/lib/people/server";
import { MemberCardPanel } from "@/components/member-card/member-card-panel";
import { shopDb } from "@/lib/shop/db";

function Detail({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="rounded-md bg-surface-elevated px-3 py-2">
      <div className="text-xs text-ink-3">{label}</div>
      <div className="text-sm text-ink">{value?.trim() ? value : "—"}</div>
    </div>
  );
}

export default async function AthleteDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { t, f } = await getI18n();
  const { id } = await params;
  const [{ data, error }, user] = await Promise.all([getAthleteDetail(id), getSessionUser()]);
  if (error) return <ErrorState title="Couldn't load athlete" message={error} />;
  if (!data) notFound();

  const { athlete: a, medical, safety, programs, timeline } = data;
  const canViewMedical = !!user?.roles.includes("admin");
  const isAdmin = canViewMedical;
  const photos = await signAthletePhotos([{ id: a.id, photoPath: a.photoPath }], a.orgId);
  const fullName = `${a.firstName} ${a.lastName}`;
  const optionLabel = (group: "gender" | "hand", v: string | null) =>
    v ? t.dynamic(`editPeople.${group}.${v.trim().toLowerCase()}`, undefined, v) : null;
  const family = await getFamily(a.familyId);
  const emergencyName = medical?.emergencyContactName ?? safety?.emergencyContactName ?? null;
  const emergencyPhone = medical?.emergencyContactPhone ?? safety?.emergencyContactPhone ?? null;
  const attendanceHistory = (await athleteAttendanceHistory(id)).data ?? [];
  const cardTag = isAdmin
    ? ((await (await shopDb()).from("member_cards").select("nfc_tag_id").eq("athlete_id", id).maybeSingle()).data?.nfc_tag_id ?? null)
    : null;

  return (
    <div className="animate-fade-up space-y-6">
      <div className="flex items-center gap-4">
        <Avatar name={fullName} src={photos.get(id) ?? null} alt={t("athletePhoto.alt", { name: fullName })} size="xl" />
        <div className="min-w-0 flex-1">
          <PageHeader
            title={fullName}
            actions={
              isAdmin ? (
                <div className="flex gap-2">
                  <Link href={`/admin/athletes/${id}/training`}><Button variant="secondary">{t("training.profile.link")}</Button></Link>
                  <Link href={`/admin/athletes/${id}/edit`}><Button variant="secondary"><Pencil className="h-4 w-4" /> {t("editPeople.edit")}</Button></Link>
                  <ConfirmDeleteButton action={deleteAthlete.bind(null, id)} label={t("common.delete")} confirmText={t("editPeople.athlete.confirmDelete", { name: fullName })} />
                </div>
              ) : undefined
            }
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 text-sm text-ink-3">
        <Link href={`/admin/families/${a.familyId}`} className="flex items-center gap-1.5 hover:text-maroon">
          <Users className="h-4 w-4" /> {a.familyName ?? "Family"}
        </Link>
        <span>·</span>
        <Badge tone={statusTone(a.status)}>{t.dynamic(`editPeople.athleteStatus.${a.status}`, undefined, a.status)}</Badge>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          {/* Profile */}
          <Card>
            <CardHeader><CardTitle>Profile</CardTitle></CardHeader>
            <CardBody className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              <Detail label="Date of birth" value={f.date(a.dob)} />
              <Detail label="Gender" value={optionLabel("gender", a.gender)} />
              <Detail label="Nationality" value={a.nationality} />
              <Detail label="School" value={a.school} />
              <Detail label="Jersey size" value={a.jerseySize} />
              <Detail label="Dominant hand" value={optionLabel("hand", a.dominantHand)} />
              <Detail label="Position" value={a.positionPref} />
              {a.notes ? <div className="col-span-2 sm:col-span-3"><Detail label="Notes" value={a.notes} /></div> : null}
            </CardBody>
          </Card>

          {/* Programs / teams */}
          <Card>
            <CardHeader>
              <CardTitle>Programs &amp; teams</CardTitle>
              {isAdmin && <Link href={`/admin/athletes/${id}/edit`} className="text-xs text-maroon hover:underline">{t("editPeople.edit")}</Link>}
            </CardHeader>
            <CardBody className="p-0">
              {programs.length === 0 ? (
                <div className="p-5"><EmptyState icon={<UserCircle className="h-5 w-5" />} title="Not enrolled" description="This athlete isn't registered for any program yet." /></div>
              ) : (
                <ul>
                  {programs.map((p) => (
                    <li key={p.id} className="flex items-center justify-between border-b border-line-soft px-5 py-3 last:border-0">
                      <Link href={`/admin/registrations/${p.id}`} className="text-sm text-ink hover:text-maroon">{p.name}</Link>
                      <Badge tone={statusTone(p.status)}>{p.status}</Badge>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>

          <ActivityTimeline events={timeline} />

          <Card>
            <CardHeader><CardTitle>Attendance history</CardTitle></CardHeader>
            <CardBody className="p-0">
              {attendanceHistory.length === 0 ? (
                <p className="px-5 py-6 text-center text-sm text-ink-3">No attendance recorded yet.</p>
              ) : (
                <ul>
                  {attendanceHistory.map((a, i) => (
                    <li key={i} className="flex items-center justify-between border-b border-line-soft px-5 py-2.5 last:border-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm text-ink">{a.programName}</span>
                        {a.injury && <AlertTriangle className="h-3.5 w-3.5 text-danger" />}
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-xs text-ink-3">{f.date(a.date)}</span>
                        <Badge tone={statusTone(a.status)}>{a.status}</Badge>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>
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
          <MedicalSection medical={medical} athleteId={id} canView={canViewMedical} />
          <ParentContactSection
            guardians={family.data?.guardians ?? []}
            familyPhone={family.data?.phone ?? null}
            familyAddress={family.data?.address ?? null}
            emergencyName={emergencyName}
            emergencyPhone={emergencyPhone}
          />
        </div>
      </div>
    </div>
  );
}
