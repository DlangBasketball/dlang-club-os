import Link from "next/link";
import { notFound } from "next/navigation";
import { Pencil, UserCircle, Users } from "lucide-react";
import {
  PageHeader, Button, Card, CardHeader, CardTitle, CardBody, Badge, statusTone, ErrorState, EmptyState,
} from "@/components/ui";
import { MedicalSection } from "@/components/athlete/medical-section";
import { ParentContactSection } from "@/components/athlete/parent-contact-section";
import { ActivityTimeline } from "@/components/athlete/activity-timeline";
import { ConfirmDeleteButton } from "@/components/confirm-delete-button";
import { getAthleteDetail } from "@/lib/data/athletes";
import { getFamily } from "@/lib/data/families";
import { getSessionUser } from "@/lib/auth/get-user";
import { deleteAthlete } from "@/lib/actions/athlete";
import { formatDate } from "@/lib/utils";
import { athleteAttendanceHistory } from "@/lib/data/attendance-admin";
import { AlertTriangle } from "lucide-react";

function Detail({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="rounded-md bg-surface-elevated px-3 py-2">
      <div className="text-xs text-ink-3">{label}</div>
      <div className="text-sm text-ink">{value?.trim() ? value : "—"}</div>
    </div>
  );
}

export default async function AthleteDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [{ data, error }, user] = await Promise.all([getAthleteDetail(id), getSessionUser()]);
  if (error) return <ErrorState title="Couldn't load athlete" message={error} />;
  if (!data) notFound();

  const { athlete: a, medical, safety, programs, timeline } = data;
  const canViewMedical = !!user?.roles.includes("admin");
  const family = await getFamily(a.familyId);
  const emergencyName = medical?.emergencyContactName ?? safety?.emergencyContactName ?? null;
  const emergencyPhone = medical?.emergencyContactPhone ?? safety?.emergencyContactPhone ?? null;
  const attendanceHistory = (await athleteAttendanceHistory(id)).data ?? [];

  return (
    <div className="animate-fade-up space-y-6">
      <PageHeader
        title={`${a.firstName} ${a.lastName}`}
        actions={
          <div className="flex gap-2">
            <Link href={`/admin/athletes/${id}/edit`}><Button variant="ghost"><Pencil className="h-4 w-4" /> Edit</Button></Link>
            <ConfirmDeleteButton action={deleteAthlete.bind(null, id)} label="Delete" confirmText={`Delete ${a.firstName} ${a.lastName}? This cannot be undone.`} />
          </div>
        }
      />

      <div className="flex flex-wrap items-center gap-3 text-sm text-ink-3">
        <Link href={`/admin/families/${a.familyId}`} className="flex items-center gap-1.5 hover:text-maroon">
          <Users className="h-4 w-4" /> {a.familyName ?? "Family"}
        </Link>
        <span>·</span>
        <Badge tone={statusTone(a.status)}>{a.status}</Badge>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          {/* Profile */}
          <Card>
            <CardHeader><CardTitle>Profile</CardTitle></CardHeader>
            <CardBody className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              <Detail label="Date of birth" value={formatDate(a.dob)} />
              <Detail label="Gender" value={a.gender} />
              <Detail label="Nationality" value={a.nationality} />
              <Detail label="School" value={a.school} />
              <Detail label="Jersey size" value={a.jerseySize} />
              <Detail label="Dominant hand" value={a.dominantHand} />
              <Detail label="Position" value={a.positionPref} />
              {a.notes ? <div className="col-span-2 sm:col-span-3"><Detail label="Notes" value={a.notes} /></div> : null}
            </CardBody>
          </Card>

          {/* Programs / teams */}
          <Card>
            <CardHeader>
              <CardTitle>Programs &amp; teams</CardTitle>
              <Link href="/admin/registrations" className="text-xs text-maroon hover:underline">Manage</Link>
            </CardHeader>
            <CardBody className="p-0">
              {programs.length === 0 ? (
                <div className="p-5"><EmptyState icon={<UserCircle className="h-5 w-5" />} title="Not enrolled" description="This athlete isn't registered for any program yet." /></div>
              ) : (
                <ul>
                  {programs.map((p) => (
                    <li key={p.id} className="flex items-center justify-between border-b border-line-soft px-5 py-3 last:border-0">
                      <span className="text-sm text-ink">{p.name}</span>
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
                        <span className="text-xs text-ink-3">{formatDate(a.date)}</span>
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
