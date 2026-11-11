import { notFound } from "next/navigation";
import { PageHeader, ErrorState } from "@/components/ui";
import { AthleteForm } from "@/components/athlete/athlete-form";
import { MedicalForm } from "@/components/athlete/medical-form";
import { getAthleteDetail } from "@/lib/data/athletes";
import { getSessionUser } from "@/lib/auth/get-user";

export default async function EditAthletePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [{ data, error }, user] = await Promise.all([getAthleteDetail(id), getSessionUser()]);
  if (error) return <ErrorState title="Couldn't load athlete" message={error} />;
  if (!data) notFound();
  const a = data.athlete;
  const canEditMedical = !!user?.roles.includes("admin");

  return (
    <div className="animate-fade-up space-y-8">
      <div>
        <PageHeader title={`Edit ${a.firstName} ${a.lastName}`} />
        <AthleteForm
          familyId={a.familyId}
          athleteId={id}
          initial={{
            firstName: a.firstName, lastName: a.lastName, dob: a.dob,
            gender: a.gender ?? "", nationality: a.nationality ?? "", school: a.school ?? "",
            jerseySize: a.jerseySize ?? "", dominantHand: a.dominantHand ?? "",
            positionPref: a.positionPref ?? "", status: a.status, notes: a.notes ?? "",
          }}
        />
      </div>

      {canEditMedical && (
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
      )}
    </div>
  );
}
