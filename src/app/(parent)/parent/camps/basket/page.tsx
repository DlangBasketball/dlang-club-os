import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { CampBasket } from "@/components/camps/basket/camp-basket";
import { getSessionUser } from "@/lib/auth/get-user";
import { getMemberCamp, listSeasonCamps, type PublicCamp } from "@/lib/camps/data";
import { guardianKids } from "@/lib/camps/parent-kids";
import { getI18n } from "@/lib/i18n/server";
import { getCheckoutPlanOffer } from "@/lib/plans/data";

export default async function ParentCampBasketPage() {
  const me = await getSessionUser();
  if (!me?.orgId) redirect("/login");
  const orgId = me.orgId;
  const { t, f } = await getI18n();
  const cards = await listSeasonCamps(orgId, { publicOnly: false });
  const camps = (await Promise.all(cards.map((c) => getMemberCamp(orgId, c.id)))).filter((c): c is PublicCamp => !!c);
  const kids = await guardianKids(me.id, orgId);
  const currency = camps[0]?.program.currency ?? f.currency;
  return (
    <div className="animate-fade-up max-w-3xl space-y-5">
      <PageHeader title={t("camps.basket.title")} description={t("camps.basket.description")} />
      <CampBasket mode="parent" scope={`parent:${orgId}`} camps={camps} kids={kids} consents={camps[0]?.consents ?? []}
        planRules={await getCheckoutPlanOffer(orgId, "camp", currency)} currency={currency} browseHref="/parent/camps" />
    </div>
  );
}
