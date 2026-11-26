import Link from "next/link";
import { ChevronLeft, HeartPulse } from "lucide-react";
import { Badge, Button, Card, CardBody, CardHeader, CardTitle } from "@/components/ui";
import { getI18n } from "@/lib/i18n/server";
import type { MyAthlete } from "@/lib/participants/my-athletes";
import { ProfileEditForm } from "./profile-edit-form";
import { LeaveChildLinkButton } from "./child-links";

type Medical = { allergies: string | null; conditions: string | null; medications: string | null; notes: string | null } | null;

/**
 * Child page for an adult linked to this child only (aunt, uncle,
 * grandparent, friend): identity, teams and live programmes, what they may do,
 * booking entry points (with can_register; the family guardian consents),
 * medical read-only (with can_see_medical), profile edits (with
 * can_edit_profile). Never the family, siblings, billing, documents or consents.
 */
export async function LinkedChildView({ athlete, medical, sports }: {
  athlete: MyAthlete;
  medical: Medical;
  sports: { heightCm: number | null; weightKg: number | null; positionPref: string | null; jerseySize: string | null; preferredJerseyNumber: number | null } | null;
}) {
  const { t, f } = await getI18n();
  const link = athlete.link!;
  const perms = (["canRegister", "canPay", "receivesEmails", "canSeeMedical", "canEditProfile"] as const).filter((k) => link[k]);
  const relation = t.dynamic(`participants.childLinks.relations.${link.relation}`, undefined, link.relation);
  return (
    <div className="animate-fade-up max-w-3xl space-y-6">
      <Link href="/parent/athletes" className="inline-flex items-center gap-1 text-sm text-text-muted hover:text-text">
        <ChevronLeft className="h-4 w-4" aria-hidden /> {t("media.profile.backToChildren")}
      </Link>
      <Card>
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center gap-2">
            {athlete.name} <Badge tone="info">{t("myAthletes.linkedBadge", { relation })}</Badge>
          </CardTitle>
        </CardHeader>
        <CardBody className="space-y-3">
          <p className="text-sm text-text-muted">{t("participants.childLinks.childPage.intro", { child: athlete.firstName })}</p>
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-md bg-surface-elevated px-3 py-2">
              <div className="text-xs text-text-muted">{t("media.profile.dob")}</div>
              <div className="text-sm text-text">{athlete.dob ? f.date(athlete.dob) : "—"}</div>
            </div>
            <div className="rounded-md bg-surface-elevated px-3 py-2">
              <div className="text-xs text-text-muted">{t("participants.childLinks.childPage.permissions")}</div>
              <div className="text-sm text-text">
                {perms.length ? perms.map((k) => t(`participants.childLinks.short.${k}`)).join(", ") : t("participants.childLinks.viewOnly")}
              </div>
            </div>
          </div>
          {athlete.teams.length > 0 && (
            <p className="text-sm text-text">{athlete.teams.map((tm) => tm.name).join(", ")}</p>
          )}
          {athlete.programmes.length > 0 && (
            <p className="text-sm text-text-muted">{t("myAthletes.programmes", { names: Array.from(new Set(athlete.programmes.map((p) => p.name))).join(", ") })}</p>
          )}
          {link.canRegister && (
            <div className="flex flex-wrap gap-2 pt-1">
              <Link href={`/parent/camps?athlete=${athlete.id}`}><Button size="sm" variant="secondary">{t("participants.childLinks.childPage.bookCamp")}</Button></Link>
              <Link href={`/parent/bookings/request?athlete=${athlete.id}`}><Button size="sm" variant="secondary">{t("participants.childLinks.childPage.bookTraining")}</Button></Link>
            </div>
          )}
          {link.canRegister && <p className="text-xs text-text-muted">{t("participants.childLinks.childPage.consentHint")}</p>}
        </CardBody>
      </Card>

      {link.canSeeMedical && (
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><HeartPulse className="h-4 w-4 text-brand-primary" aria-hidden /> {t("media.profile.medicalTitle")}</CardTitle></CardHeader>
          <CardBody className="space-y-2 text-sm text-text">
            {medical && (medical.allergies || medical.conditions || medical.medications || medical.notes) ? (
              <dl className="space-y-1.5">
                {([["allergies", medical.allergies], ["conditions", medical.conditions], ["medications", medical.medications], ["notes", medical.notes]] as const)
                  .filter(([, v]) => v).map(([k, v]) => (
                    <div key={k}><dt className="text-xs text-text-muted">{t(`participants.childLinks.childPage.medical.${k}`)}</dt><dd>{v}</dd></div>
                  ))}
              </dl>
            ) : <p className="text-text-muted">{t("participants.childLinks.childPage.noMedical")}</p>}
            <p className="text-xs text-text-muted">{t("participants.childLinks.childPage.medicalReadOnly")}</p>
          </CardBody>
        </Card>
      )}

      {link.canEditProfile && (
        <Card>
          <CardHeader><CardTitle>{t("participants.edit.title")}</CardTitle></CardHeader>
          <CardBody>
            <ProfileEditForm athleteId={athlete.id} pending={[]} initial={{
              firstName: athlete.firstName, lastName: athlete.lastName, dob: athlete.dob ?? "", sex: athlete.gender,
              heightCm: sports?.heightCm ?? null, weightKg: sports?.weightKg ?? null, positionPref: sports?.positionPref ?? null,
              jerseySize: sports?.jerseySize ?? null, preferredJerseyNumber: sports?.preferredJerseyNumber ?? null,
            }} />
          </CardBody>
        </Card>
      )}

      <Card>
        <CardBody className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-text-muted">{t("participants.childLinks.childPage.leaveHint")}</p>
          <LeaveChildLinkButton linkId={link.id} />
        </CardBody>
      </Card>
    </div>
  );
}
