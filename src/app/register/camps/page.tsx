import Link from "next/link";
import { notFound } from "next/navigation";
import { ShoppingBasket } from "lucide-react";
import { Button } from "@/components/ui";
import { I18nProvider } from "@/lib/i18n/client";
import { getI18n } from "@/lib/i18n/server";
import { listSeasonCamps } from "@/lib/camps/data";
import { publicBasketOrg } from "@/lib/camps/basket-server";
import { SeasonCampList } from "@/components/camps/season-camp-list";

/**
 * Public season chooser: the club's camps grouped by season, each with its
 * own page. Club from the host, or from the camp slug (?camp=) on the
 * platform host. No personal data.
 */
export default async function PublicCampSeasonsPage({ searchParams }: { searchParams: Promise<{ camp?: string }> }) {
  const { camp } = await searchParams;
  const slug = typeof camp === "string" ? camp.slice(0, 120) : null;
  const orgId = await publicBasketOrg(slug);
  if (!orgId) notFound();
  const [cards, i18n] = await Promise.all([listSeasonCamps(orgId, { publicOnly: true }), getI18n(orgId)]);
  const { t } = i18n;
  const basketHref = `/register/camps/basket${slug ? `?camp=${encodeURIComponent(slug)}` : ""}`;
  return (
    <div className="animate-fade-up space-y-6">
      <section className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-xs uppercase tracking-[0.18em] text-maroon">{t("programKind.camp")}</div>
          <h1 className="mt-1 font-display text-3xl font-semibold">{t("camps.seasons.publicTitle")}</h1>
          <p className="mt-2 max-w-2xl text-sm text-ink-2">{t("camps.seasons.publicIntro")}</p>
        </div>
        <Link href={basketHref}><Button variant="secondary"><ShoppingBasket className="h-4 w-4" /> {t("camps.basket.title")}</Button></Link>
      </section>
      <I18nProvider ctx={i18n.ctx} messages={i18n.messages}>
        <SeasonCampList camps={cards} linkTo="public" />
      </I18nProvider>
    </div>
  );
}
