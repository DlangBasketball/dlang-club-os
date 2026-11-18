import { redirect } from "next/navigation";
import { Button, Card, CardBody, Label, PageHeader, Select } from "@/components/ui";
import { CampBasket } from "@/components/camps/basket/camp-basket";
import { getSessionUser } from "@/lib/auth/get-user";
import { getCampForOrg, listSeasonCamps, type PublicCamp } from "@/lib/camps/data";
import { createClient } from "@/lib/supabase/server";
import { getI18n } from "@/lib/i18n/server";
import { getCheckoutPlanOffer } from "@/lib/plans/data";

/**
 * Admin / finance: a multi-week camp booking on behalf of a family (one
 * invoice, one registration per child-week). The family is chosen from the
 * club's own families (RLS); the checkout re-checks it server-side.
 */
export default async function AdminCampBasketPage({ searchParams }: { searchParams: Promise<{ family?: string }> }) {
  const { family } = await searchParams;
  const me = await getSessionUser();
  if (!me?.orgId || !(me.roles.includes("admin") || me.roles.includes("finance"))) redirect("/admin/dashboard");
  const orgId = me.orgId;
  const { t, f } = await getI18n();
  const supabase = await createClient();
  const { data: families } = await supabase.from("families").select("id,name").eq("org_id", orgId).order("name").limit(1000);
  const familyId = families?.some((x) => x.id === family) ? family! : null;
  const { data: kids } = familyId
    ? await supabase.from("athletes").select("id,first_name,last_name,dob,status").eq("org_id", orgId).eq("family_id", familyId).order("first_name")
    : { data: [] as { id: string; first_name: string; last_name: string; dob: string | null; status: string }[] };
  const cards = familyId ? await listSeasonCamps(orgId, { publicOnly: false }) : [];
  const camps = (await Promise.all(cards.map((c) => getCampForOrg(orgId, c.id, false)))).filter((c): c is PublicCamp => !!c);
  const currency = camps[0]?.program.currency ?? f.currency;

  return (
    <div className="animate-fade-up max-w-3xl space-y-5">
      <PageHeader title={t("camps.basket.adminTitle")} description={t("camps.basket.adminDescription")} />
      <Card><CardBody>
        <form method="get" className="flex flex-wrap items-end gap-3">
          <div className="min-w-[240px] flex-1"><Label htmlFor="basket-family">{t("camps.basket.family")}</Label>
            <Select id="basket-family" name="family" defaultValue={familyId ?? ""}>
              <option value="">{t("common.select")}</option>
              {(families ?? []).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
            </Select>
          </div>
          <Button type="submit" variant="secondary">{t("camps.basket.chooseFamily")}</Button>
        </form>
      </CardBody></Card>
      {familyId && (
        <CampBasket mode="admin" scope={`admin:${orgId}:${familyId}`} familyId={familyId} camps={camps}
          kids={(kids ?? []).filter((k) => k.status !== "inactive").map((k) => ({ id: k.id, name: `${k.first_name} ${k.last_name}`, dob: k.dob }))}
          consents={camps[0]?.consents ?? []} planRules={await getCheckoutPlanOffer(orgId, "camp", currency)} currency={currency} />
      )}
    </div>
  );
}
