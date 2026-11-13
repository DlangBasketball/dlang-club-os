import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { PageHeader, ErrorState, Card, CardHeader, CardTitle, CardBody } from "@/components/ui";
import { AthleteForm } from "@/components/athlete/athlete-form";
import { MedicalForm } from "@/components/athlete/medical-form";
import { PhotoManager } from "@/components/athlete/photo-manager";
import { AthleteProgrammes, AthleteConsents } from "@/components/athlete/athlete-records";
import { getAthleteDetail } from "@/lib/data/athletes";
import { getAthleteEditContext } from "@/lib/data/people-edit";
import { getSessionUser } from "@/lib/auth/get-user";
import { getTranslations } from "@/lib/i18n/server";
import { signAthletePhotos } from "@/lib/people/server";

export default async function EditAthletePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [{ data, error }, user, t] = await Promise.all([getAthleteDetail(id), getSessionUser(), getTranslations()]);
  if (error) return <ErrorState title={t("common.error")} message={error} />;
  if (!data) notFound();
  const a = data.athlete;
  const isAdmin = !!user?.roles.includes("admin");
  const name = `${a.firstName} ${a.lastName}`;
  if (!isAdmin) {
    return <ErrorState title={t("editPeople.errors.forbidden")} message={t("editPeople.readOnly")} />;
  }

  const [ctx, photos] = await Promise.all([
    getAthleteEditContext(id, a.familyId),
    signAthletePhotos([{ id: a.id, photoPath: a.photoPath }], a.orgId),
  ]);

  return (
    <div className="animate-fade-up space-y-8">
      <div>
        <Link href={`/admin/athletes/${id}`} className="mb-3 inline-flex items-center gap-1 text-sm text-ink-3 hover:text-ink">
          <ChevronLeft className="h-4 w-4" /> {t("editPeople.backToProfile")}
        </Link>
        <PageHeader title={t("editPeople.editTitle", { name })} />
      </div>

      <Card className="max-w-2xl">
        <CardHeader><CardTitle>{t("athletePhoto.title")}</CardTitle></CardHeader>
        <CardBody>
          <PhotoManager athleteId={id} name={name} photoUrl={photos.get(id) ?? null} />
        </CardBody>
      </Card>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">{t("editPeople.athlete.sectionProfile")}</h2>
        <AthleteForm
          familyId={a.familyId}
          athleteId={id}
          families={ctx.families}
          initial={{
            firstName: a.firstName, lastName: a.lastName, dob: a.dob,
            gender: a.gender, nationality: a.nationality, school: a.school,
            jerseySize: a.jerseySize, dominantHand: a.dominantHand,
            positionPref: a.positionPref, status: a.status, notes: a.notes,
          }}
        />
      </section>

      <AthleteProgrammes athleteId={id} registrations={ctx.registrations} teams={ctx.teams} programs={ctx.programs} />

      <div id="medical" className="scroll-mt-6">
        <MedicalForm
          athleteId={id}
          initial={
            data.medical
              ? {
                  allergies: data.medical.allergies ?? "",
                  conditions: data.medical.conditions ?? "",
                  medications: data.medical.medications ?? "",
                  insurance: data.medical.insurance ?? "",
                  emergencyContactName: data.medical.emergencyContactName ?? "",
                  emergencyContactPhone: data.medical.emergencyContactPhone ?? "",
                  notes: data.medical.notes ?? "",
                }
              : undefined
          }
        />
      </div>

      <div id="consents" className="scroll-mt-6">
        <AthleteConsents athleteId={id} consents={ctx.consents} forms={ctx.consentForms} guardians={ctx.guardians} />
      </div>
    </div>
  );
}
