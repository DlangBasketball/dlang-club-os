import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTenant } from "@/lib/tenant/server";
import { getTranslations } from "@/lib/i18n/server";
import { getHubSchedule } from "@/lib/website/hub";
import { PublicSiteHeader } from "@/components/website/public-site-header";
import { EventsWidget } from "@/components/website/widgets";

export async function generateMetadata(): Promise<Metadata> {
  const tenant = await getTenant();
  const t = await getTranslations(tenant.id);
  return { title: t("website.public.scheduleTitle") };
}

/** Public schedule and results of the club's public teams (same data as the website API). */
export default async function ClubSchedulePage({ searchParams }: { searchParams: Promise<{ team?: string }> }) {
  const tenant = await getTenant();
  if (!tenant.id) notFound();
  const { team } = await searchParams;
  const teamKey = typeof team === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(team) ? team : null;
  const { upcoming, results, t } = await getHubSchedule(tenant, teamKey);
  const o = { newTab: false, returnTo: null };
  return (
    <div className="grain min-h-dvh bg-bg text-text">
      <PublicSiteHeader tenant={tenant} />
      <main className="mx-auto max-w-5xl space-y-8 px-4 py-8">
        <div>
          <p className="text-xs uppercase tracking-[0.18em] text-brand-primary">{tenant.name}</p>
          <h1 className="mt-1 font-display text-3xl font-semibold">{t("website.public.scheduleTitle")}</h1>
        </div>
        <section aria-labelledby="sched-upcoming" className="space-y-3">
          <h2 id="sched-upcoming" className="font-display text-xl font-semibold">{t("website.public.upcoming")}</h2>
          <EventsWidget data={upcoming} t={t} o={o} />
        </section>
        <section aria-labelledby="sched-results" className="space-y-3">
          <h2 id="sched-results" className="font-display text-xl font-semibold">{t("website.public.results")}</h2>
          <EventsWidget data={results} t={t} o={o} results />
        </section>
      </main>
    </div>
  );
}
