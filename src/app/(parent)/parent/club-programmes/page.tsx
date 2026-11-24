import { redirect } from "next/navigation";
import { Shield } from "lucide-react";
import { Card, CardBody, CardHeader, CardMeta, CardTitle, EmptyState, PageHeader } from "@/components/ui";
import { ClubProgramRequestForm } from "@/components/approvals/club-request-forms";
import { FamilyClubRequests } from "@/components/approvals/family-club-requests";
import { getSessionUser } from "@/lib/auth/get-user";
import { listFamilyClubRequests, listRequestableClubPrograms } from "@/lib/approvals/data";
import { getParticipantChoices } from "@/lib/participants/server";
import { getActiveAthleteState } from "@/lib/participants/my-athletes";
import { acceptsAdults, ALL_ATHLETES } from "@/lib/participants/active-athlete";
import { todayIn } from "@/lib/payments/plans";
import { getI18n } from "@/lib/i18n/server";

export async function generateMetadata() {
  const { t } = await getI18n();
  return { title: t("approvals.programs.title") };
}

/**
 * Parent: club programmes (teams, clinics) that need the club's approval.
 * A request is "Pending club approval" until the assigned coach or an admin
 * confirms it; only then is the athlete enrolled and the usual invoice issued.
 * The athlete is chosen with the shared picker (children; "Myself" for adults
 * when the programme accepts adults), preselecting the active athlete.
 */
export default async function ParentClubProgrammesPage() {
  const [me, { t, f }] = await Promise.all([getSessionUser(), getI18n()]);
  if (!me?.orgId || !me.roles.includes("parent")) redirect("/");
  const [choices, programs, requests, state] = await Promise.all([
    getParticipantChoices({ id: me.id, orgId: me.orgId, fullName: me.fullName ?? null }),
    listRequestableClubPrograms(me.orgId),
    listFamilyClubRequests(),
    getActiveAthleteState(),
  ]);
  const active = state.active && state.active !== ALL_ATHLETES ? state.active : null;
  const today = todayIn(f.timeZone);
  const programRequests = requests.filter((r) => r.subject_kind === "program_registration");
  const familyAthletes = choices.participants.filter((p) => p.kind !== "other");

  return (
    <div className="animate-fade-up space-y-6">
      <PageHeader title={t("approvals.programs.title")} description={t("approvals.programs.description")} />
      <FamilyClubRequests rows={programRequests} t={t} f={f} showChild={familyAthletes.length > 1}
        title={t("approvals.programs.myRequests")} description={t("approvals.family.description")} />
      {programs.length === 0 ? <EmptyState icon={<Shield className="h-5 w-5" />} title={t("approvals.programs.empty")} /> : (
        <div className="space-y-4">
          {programs.map((p) => (
            <Card key={p.id}>
              <CardHeader>
                <div>
                  <CardTitle>{p.name}</CardTitle>
                  <CardMeta>
                    {t(`programKind.${p.kind}` as never)}
                    {p.price > 0 ? ` · ${f.money(p.price, p.currency ?? f.currency)}` : ""}
                    {p.minAge != null || p.maxAge != null ? ` · ${t("approvals.programs.ages", { min: p.minAge ?? "–", max: p.maxAge ?? "–" })}` : ""}
                    {p.startsOn ? ` · ${f.dateRange(p.startsOn, p.endsOn ?? p.startsOn)}` : ""}
                  </CardMeta>
                </div>
              </CardHeader>
              <CardBody className="space-y-3">
                {p.description && <p className="whitespace-pre-wrap text-sm text-text-muted">{p.description}</p>}
                <p className="text-xs text-text-muted">{t("approvals.programs.approvalNote")}</p>
                <ClubProgramRequestForm programId={p.id} choices={choices} active={active}
                  activityDate={p.startsOn && p.startsOn > today ? p.startsOn : today} allowSelf={acceptsAdults(p.maxAge)} />
              </CardBody>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
