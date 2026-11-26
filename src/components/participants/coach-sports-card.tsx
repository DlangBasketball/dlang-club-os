import { Dumbbell } from "lucide-react";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui";
import { getI18n } from "@/lib/i18n/server";
import { getSportsProfile } from "@/lib/participants/server";
import { SportsProfileForm } from "./profile-edit-form";

/**
 * Coach (and staff) view: the player's sports fields — height, weight,
 * position, jersey size and preferred number. Renders only for a player the
 * caller may edit (participant_sports_profile: own team / programme, or
 * staff). Never name, DOB, sex or medical data; team jersey numbers are set on
 * the roster.
 */
export async function CoachSportsCard({ athleteId }: { athleteId: string }) {
  if (!/^[0-9a-f-]{36}$/i.test(athleteId)) return null;
  const [{ t }, p] = await Promise.all([getI18n(), getSportsProfile(athleteId)]);
  if (!p) return null;
  return (
    <Card className="max-w-4xl">
      <CardHeader><CardTitle className="flex items-center gap-2"><Dumbbell className="h-4 w-4 text-brand-primary" aria-hidden /> {t("participants.coach.title")}</CardTitle></CardHeader>
      <CardBody className="space-y-3">
        <p className="text-xs text-text-muted">{t("participants.coach.hint")}</p>
        <SportsProfileForm athleteId={p.athleteId} initial={{
          heightCm: p.heightCm, weightKg: p.weightKg, positionPref: p.positionPref, jerseySize: p.jerseySize, preferredJerseyNumber: p.preferredJerseyNumber,
        }} />
      </CardBody>
    </Card>
  );
}
