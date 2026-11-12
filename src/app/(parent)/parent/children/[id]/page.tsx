import { notFound } from "next/navigation";
import Link from "next/link";
import { ChevronLeft, ShieldCheck, ClipboardList, HeartPulse } from "lucide-react";
import { Card, CardHeader, CardTitle, CardBody, Badge, statusTone, EmptyState, ErrorState } from "@/components/ui";
import { getChildProfile } from "@/lib/data/parent";
import { MedicalForm } from "@/components/parent/medical-form";
import { getI18n } from "@/lib/i18n/server";
import { PhotoManager } from "@/components/athlete/photo-manager";
import { photoUrlsForAthletes } from "@/lib/people/server";

export default async function ChildProfilePage({ params }: { params: Promise<{ id: string }> }) {
  const { t, f } = await getI18n();
  const { id } = await params;
  const { data, error } = await getChildProfile(id);
  if (error) return <ErrorState title="Couldn't load profile" message={error} />;
  if (!data) notFound();
  const m = data.medical;
  const photos = await photoUrlsForAthletes([data.id]);

  return (
    <div className="animate-fade-up space-y-6">
      <div className="flex items-center gap-2">
        <Link href="/parent/children" className="text-ink-3 hover:text-ink"><ChevronLeft className="h-5 w-5" /></Link>
        <div className="flex-1"><h1 className="font-display text-2xl font-semibold">{data.name}</h1><p className="text-xs text-ink-3">{data.age !== null ? `Age ${data.age}` : ""}{data.gender ? ` · ${data.gender}` : ""} · born {f.date(data.dob)}</p></div>
        <Link href={`/parent/children/${data.id}/training`} className="text-sm text-maroon hover:underline">{t("training.profile.link")}</Link>
      </div>

      <Card>
        <CardHeader><CardTitle>{t("athletePhoto.title")}</CardTitle></CardHeader>
        <CardBody>
          <PhotoManager athleteId={data.id} name={data.name} photoUrl={photos[data.id] ?? null} compact />
        </CardBody>
      </Card>

      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><HeartPulse className="h-4 w-4 text-maroon" /> Medical information</CardTitle></CardHeader>
        <CardBody>
          <MedicalForm athleteId={data.id} initial={{
            allergies: m?.allergies ?? "", conditions: m?.conditions ?? "", medications: m?.medications ?? "",
            notes: m?.notes ?? "", emergencyContactName: m?.emergencyContactName ?? "", emergencyContactPhone: m?.emergencyContactPhone ?? "",
          }} />
        </CardBody>
      </Card>

      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><ClipboardList className="h-4 w-4" /> Registrations</CardTitle></CardHeader>
        <CardBody className="p-0">
          {data.registrations.length === 0 ? (<div className="p-5"><EmptyState icon={<ClipboardList className="h-5 w-5" />} title="No registrations" /></div>) : (
            <ul>{data.registrations.map((r) => (
              <li key={r.id} className="flex items-center justify-between border-b border-line-soft px-5 py-3 last:border-0">
                <span className="text-sm text-ink">{r.programName}</span><Badge tone={statusTone(r.status)}>{r.status}</Badge>
              </li>
            ))}</ul>
          )}
        </CardBody>
      </Card>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><ShieldCheck className="h-4 w-4" /> Consents on file</CardTitle></CardHeader>
          <CardBody className="p-0">
            {data.consents.length === 0 ? (<div className="p-5 text-sm text-ink-3">No consents recorded.</div>) : (
              <ul>{data.consents.map((c, i) => (
                <li key={i} className="flex items-center justify-between border-b border-line-soft px-5 py-2.5 last:border-0">
                  <span className="flex items-center gap-2 text-sm text-ink"><ShieldCheck className="h-4 w-4 text-success" />{c.title}</span>
                  <span className="text-xs text-ink-3">{f.date(c.acceptedAt)}</span>
                </li>
              ))}</ul>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader><CardTitle>Recent attendance</CardTitle></CardHeader>
          <CardBody className="p-0">
            {data.attendance.length === 0 ? (<div className="p-5 text-sm text-ink-3">No published attendance yet.</div>) : (
              <ul>{data.attendance.slice(0, 8).map((a, i) => (
                <li key={i} className="flex items-center justify-between border-b border-line-soft px-5 py-2.5 last:border-0">
                  <span className="text-sm text-ink">{a.programName ?? "Session"}<span className="ml-2 text-xs text-ink-3">{f.date(a.date)}</span></span>
                  <Badge tone={statusTone(a.status)}>{a.status}</Badge>
                </li>
              ))}</ul>
            )}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
