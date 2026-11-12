import { redirect } from "next/navigation";
import { ErrorState, PageHeader } from "@/components/ui";
import { DiscountManager } from "@/components/camps/discount-manager";
import { getSessionUser } from "@/lib/auth/get-user";
import { listDiscounts } from "@/lib/camps/data";
import { campsDb } from "@/lib/camps/db";
import { getI18n } from "@/lib/i18n/server";

export default async function DiscountsPage() {
  const [me, { t }] = await Promise.all([getSessionUser(), getI18n()]);
  if (!me?.orgId || !(me.roles.includes("admin") || me.roles.includes("finance"))) redirect("/admin/dashboard");
  const db = await campsDb();
  const [{ data, error }, { data: programs }, { data: services }] = await Promise.all([
    listDiscounts(me.orgId),
    db.from("programs").select("id,name").eq("org_id", me.orgId).neq("status", "archived").order("name"),
    db.from("training_services").select("id,name").eq("org_id", me.orgId).eq("is_active", true).order("name"),
  ]);
  return (
    <div className="animate-fade-up max-w-4xl space-y-5">
      <PageHeader title={t("camps.discounts.title")} description={t("camps.discounts.description")} />
      {error ? <ErrorState message={error} /> : (
        <DiscountManager
          canEdit={me.roles.includes("admin")}
          programs={(programs ?? []).map((p) => ({ id: p.id, name: p.name }))}
          services={(services ?? []).map((s) => ({ id: s.id, name: s.name }))}
          discounts={(data ?? []).map((d) => ({
            id: d.id, name: d.name, description: d.description, kind: d.kind, value: d.value, currency: d.currency, scope: d.scope,
            scopeProgramId: d.scopeProgramId ?? null, scopeServiceId: d.scopeServiceId ?? null, rule: d.rule, code: d.code ?? null,
            validFrom: d.validFrom ?? null, validUntil: d.validUntil ?? null, siblingMinPosition: d.siblingMinPosition ?? null,
            earlyBirdDaysBefore: d.earlyBirdDaysBefore ?? null, maxRedemptions: d.maxRedemptions ?? null,
            maxRedemptionsPerFamily: d.maxRedemptionsPerFamily ?? null, stackable: d.stackable !== false, active: d.active, uses: d.uses,
          }))}
        />
      )}
    </div>
  );
}
