import { hasFeature } from "@/lib/upgrades/server";
import { notFound } from "next/navigation";
import { I18nProvider } from "@/lib/i18n/client";
import { getI18n } from "@/lib/i18n/server";
import { getCampForOrg, listSeasonCamps, type PublicCamp } from "@/lib/camps/data";
import { publicBasketOrg } from "@/lib/camps/basket-server";
import { getCheckoutPlanOffer } from "@/lib/plans/data";
import { CampBasket } from "@/components/camps/basket/camp-basket";

/**
 * Public camp basket (guests and members alike): several weeks for one or
 * more children, one checkout. The family and children are created once for
 * the whole basket. Club from the host, or from the camp slug (?camp=).
 */
export default async function PublicCampBasketPage({ searchParams }: { searchParams: Promise<{ camp?: string }> }) {
  const { camp } = await searchParams;
  const slug = typeof camp === "string" ? camp.slice(0, 120) : null;
  const orgId = await publicBasketOrg(slug);
  if (!orgId || !(await hasFeature(orgId, "camp_basket"))) notFound();
  const i18n = await getI18n(orgId);
  const cards = await listSeasonCamps(orgId, { publicOnly: true });
  const camps = (await Promise.all(cards.map((c) => getCampForOrg(orgId, c.id, true)))).filter((c): c is PublicCamp => !!c);
  const currency = camps[0]?.program.currency ?? i18n.f.currency;
  const browse = `/register/camps${slug ? `?camp=${encodeURIComponent(slug)}` : ""}`;
  return (
    <div className="animate-fade-up space-y-6">
      <section>
        <div className="text-xs uppercase tracking-[0.18em] text-maroon">{i18n.t("programKind.camp")}</div>
        <h1 className="mt-1 font-display text-3xl font-semibold">{i18n.t("camps.basket.title")}</h1>
        <p className="mt-2 max-w-2xl text-sm text-ink-2">{i18n.t("camps.basket.publicDescription")}</p>
      </section>
      <I18nProvider ctx={i18n.ctx} messages={i18n.messages}>
        <CampBasket mode="public" scope={`public:${orgId}`} camps={camps} slug={slug ?? camps[0]?.program.slug ?? null}
          consents={camps[0]?.consents ?? []} planRules={await getCheckoutPlanOffer(orgId, "camp", currency)} currency={currency} browseHref={browse} />
      </I18nProvider>
    </div>
  );
}
