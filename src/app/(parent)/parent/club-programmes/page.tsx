import { redirect } from "next/navigation";
import { Shield } from "lucide-react";
import { Card, CardBody, CardHeader, CardMeta, CardTitle, EmptyState, PageHeader } from "@/components/ui";
import { ClubProgramRequestForm } from "@/components/approvals/club-request-forms";
import { FamilyClubRequests } from "@/components/approvals/family-club-requests";
import { getSessionUser } from "@/lib/auth/get-user";
import { listFamilyClubRequests, listRequestableClubPrograms } from "@/lib/approvals/data";
import { createClient } from "@/lib/supabase/server";
import { getI18n } from "@/lib/i18n/server";

export async function generateMetadata() {
  const { t } = await getI18n();
  return { title: t("approvals.programs.title") };
}

/**
 * Parent: club programmes (teams, clinics) that need the club's approval.
 * A request is "Pending club approval" until the assigned coach or an admin
 * confirms it; only then is the child enrolled and the usual invoice issued.
 */
export default async function ParentClubProgrammesPage() {
  const [me, { t, f }] = await Promise.all([getSessionUser(), getI18n()]);
  if (!me?.orgId || !me.roles.includes("parent")) redirect("/");
  const supabase = await createClient();
  const { data: links } = await supabase.from("family_members").select("family_id").eq("profile_id", me.id);
  const famIds = (links ?? []).map((l) => l.family_id as string);
  const [{ data: kidRows }, programs, requests] = await Promise.all([
    famIds.length
      ? supabase.from("athletes").select("id,first_name,last_name,family_id,status").eq("org_id", me.orgId).in("family_id", famIds).order("first_name")
      : Promise.resolve({ data: [] as { id: string; first_name: string; last_name: string; family_id: string; status: string }[] }),
    listRequestableClubPrograms(me.orgId),
    listFamilyClubRequests(),
  ]);
  const kids = ((kidRows ?? []) as { id: string; first_name: string; last_name: string; family_id: string; status: string }[])
    .filter((k) => k.status !== "inactive")
    .map((k) => ({ id: k.id, name: `${k.first_name} ${k.last_name}`.trim(), familyId: k.family_id }));
  const programRequests = requests.filter((r) => r.subject_kind === "program_registration");

  return (
    <div className="animate-fade-up space-y-6">
      <PageHeader title={t("approvals.programs.title")} description={t("approvals.programs.description")} />
      <FamilyClubRequests rows={programRequests} t={t} f={f} showChild={kids.length > 1}
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
                <ClubProgramRequestForm programId={p.id} kids={kids} />
              </CardBody>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
