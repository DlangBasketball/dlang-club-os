import { redirect } from "next/navigation";
import { Shirt } from "lucide-react";
import { Badge, Card, CardBody, CardHeader, CardTitle, EmptyState, PageHeader } from "@/components/ui";
import { OpsForm } from "@/components/operations/ops-form";
import { getSessionUser } from "@/lib/auth/get-user";
import { getI18n } from "@/lib/i18n/server";
import { opsDb } from "@/lib/operations/db";
import { sizesEditable } from "@/lib/operations/kit";
import { submitKitSizes } from "@/lib/actions/operations-equipment";
import { athleteFilterFor } from "@/lib/participants/my-athletes";
import { filterByAthlete } from "@/lib/participants/active-athlete";
import { AthleteFilterBar } from "@/components/participants/athlete-filter-bar";

/**
 * Kit for the family's children (RLS: guardians see only their own children's
 * kit): jersey number, status, and the quick sizes form while sizes are open.
 */
export default async function ParentKitPage({ searchParams }: { searchParams: Promise<{ athlete?: string }> }) {
  const [me, { t, f }, sp] = await Promise.all([getSessionUser(), getI18n(), searchParams]);
  if (!me?.orgId) redirect("/login");
  const db = await opsDb();
  const [{ data: allKit }, filter] = await Promise.all([
    db.from("kit_assignments").select("*").eq("org_id", me.orgId).order("created_at", { ascending: false }).limit(100),
    athleteFilterFor(sp.athlete, { allowAll: true }),
  ]);
  // Default: the active athlete of the switcher; "All" shows every child's kit.
  const kit = filterByAthlete(allKit ?? [], filter, (k) => k.athlete_id);
  const athleteIds = Array.from(new Set((kit ?? []).map((k) => k.athlete_id)));
  const teamIds = Array.from(new Set((kit ?? []).map((k) => k.team_id)));
  const [{ data: athletes }, { data: teams }] = await Promise.all([
    athleteIds.length ? db.from("athletes").select("id,first_name").in("id", athleteIds) : Promise.resolve({ data: [] as { id: string; first_name: string }[] }),
    teamIds.length ? db.from("teams").select("id,name").in("id", teamIds) : Promise.resolve({ data: [] as { id: string; name: string }[] }),
  ]);
  const childName = new Map((athletes ?? []).map((a) => [a.id, a.first_name]));
  const teamName = new Map((teams ?? []).map((x) => [x.id, x.name]));

  return (
    <div className="animate-fade-up space-y-5">
      <PageHeader title={t("operations.kit.parentTitle")} description={t("operations.kit.parentDescription")} />
      <AthleteFilterBar athletes={filter.athletes} filter={filter} basePath="/parent/kit" t={t} />
      {(kit ?? []).length === 0 ? <EmptyState icon={<Shirt />} title={t("operations.kit.parentEmpty")} /> : (kit ?? []).map((k) => (
        <Card key={k.id}>
          <CardHeader>
            <CardTitle>{childName.get(k.athlete_id) ?? ""} · {teamName.get(k.team_id) ?? ""}</CardTitle>
            <Badge tone={k.status === "sizes_requested" ? "warning" : k.status === "handed_out" ? "success" : "neutral"}>{t.dynamic(`operations.kit.statuses.${k.status}`)}</Badge>
          </CardHeader>
          <CardBody className="space-y-3">
            <p className="text-sm text-text-muted">
              {k.jersey_number !== null ? t("operations.kit.yourNumber", { number: k.jersey_number }) : t("operations.kit.numberPending")}
              {k.deposit_amount ? ` · ${t("operations.kit.depositInfo", { amount: f.money(k.deposit_amount, k.currency ?? f.currency) })}` : ""}
            </p>
            {sizesEditable(k.status) ? (
              <OpsForm action={submitKitSizes} submitLabel={t("operations.kit.sendSizes")} columns={3} fields={[
                { name: "assignmentId", label: "", type: "hidden", defaultValue: k.id },
                ...(k.include_jersey ? [{ name: "jerseySize", label: t("operations.kit.jerseySize"), required: true, defaultValue: k.jersey_size, hint: t("operations.kit.sizeHint") }] : []),
                ...(k.include_shorts ? [{ name: "shortsSize", label: t("operations.kit.shortsSize"), required: true, defaultValue: k.shorts_size }] : []),
                ...(k.include_warmup ? [{ name: "warmupSize", label: t("operations.kit.warmupSize"), required: true, defaultValue: k.warmup_size }] : []),
              ]} />
            ) : (
              <p className="text-sm">
                {[k.include_jersey && `${t("operations.kit.jersey")} ${k.jersey_size ?? "—"}`, k.include_shorts && `${t("operations.kit.shorts")} ${k.shorts_size ?? "—"}`,
                  k.include_warmup && `${t("operations.kit.warmup")} ${k.warmup_size ?? "—"}`].filter(Boolean).join(" · ")}
              </p>
            )}
          </CardBody>
        </Card>
      ))}
    </div>
  );
}
