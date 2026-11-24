import Link from "next/link";
import { CalendarDays, ChevronRight, Dumbbell, LogIn, MapPin, Newspaper, ShoppingBag, Tag, Tent } from "lucide-react";
import { buttonVariants } from "@/components/ui";
import { cn } from "@/lib/utils";
import { getI18n } from "@/lib/i18n/server";
import { getHubCamps } from "@/lib/data/club-hub";
import type { Tenant } from "@/lib/tenant/types";
import { InstallAppPrompt } from "./install-app-prompt";
import { ContactForm } from "@/components/messaging/leads";
import { CoverImage } from "@/components/media/cover-image";
import { getOrgCover } from "@/lib/media/server";
import { PublicSiteHeader } from "@/components/website/public-site-header";
import { NewsList } from "@/components/website/widgets";
import { getHubNews } from "@/lib/website/hub";
import { EntryPoints } from "@/components/entry/entry-points";

/** Public booking page for personal training (built by the training module). */
export const TRAINING_BOOKING_PATH = "/book";

/**
 * Public, tenant-branded club hub: camps open for registration, personal
 * training booking, member sign-in and the "Install app" card. Reachable
 * signed out; shows only public programme data.
 */
export async function ClubHub({ tenant, signedIn = false, canEditCover = false }: { tenant: Tenant; signedIn?: boolean; canEditCover?: boolean }) {
  const [{ t, f }, camps, cover, news] = await Promise.all([
    getI18n(tenant.id),
    tenant.id ? getHubCamps(tenant.id) : Promise.resolve([]),
    getOrgCover(tenant.id),
    getHubNews(tenant),
  ]);

  return (
    <div className="grain min-h-dvh bg-bg text-text">
      <PublicSiteHeader tenant={tenant} signIn={{ href: signedIn ? "/" : "/login", label: signedIn ? t("pwa.hub.openApp") : t("pwa.hub.signIn") }} />

      <main className="mx-auto max-w-5xl space-y-10 px-4 py-8">
        <CoverImage
          cover={cover}
          variant="hero"
          className="animate-fade-up"
          eyebrow={t("pwa.hub.eyebrow")}
          title={tenant.name}
          subtitle={t("pwa.hub.intro")}
          edit={canEditCover && tenant.id ? { target: "org", id: tenant.id, canUseLibrary: true } : null}
          priority
        />

        <EntryPoints t={t} signedIn={signedIn} />

        <InstallAppPrompt />

        <section aria-labelledby="hub-camps" className="space-y-4">
          <div className="flex items-center gap-2">
            <Tent className="h-5 w-5 text-brand-primary" aria-hidden />
            <h2 id="hub-camps" className="font-display text-xl font-semibold">{t("pwa.hub.campsTitle")}</h2>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-text-muted">{t("pwa.hub.campsIntro")}</p>
            <Link href="/register/camps" className={cn(buttonVariants({ variant: "outline", size: "sm" }), "shrink-0")}>
              {t("pwa.hub.campsBySeason")}
              <ChevronRight className="h-4 w-4" aria-hidden />
            </Link>
          </div>
          {camps.length === 0 ? (
            <p className="rounded-md border border-dashed border-border p-6 text-center text-sm text-text-muted">{t("pwa.hub.campsEmpty")}</p>
          ) : (
            <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {camps.map((c) => (
                <li key={c.slug}>
                  <Link
                    href={`/register/${encodeURIComponent(c.slug)}`}
                    className="group flex h-full flex-col rounded-md border border-border bg-surface p-4 shadow-sm transition hover:border-brand-primary/60 active:scale-[0.99]"
                  >
                    <h3 className="font-display text-lg font-semibold">{c.name}</h3>
                    {c.description && <p className="mt-1 line-clamp-3 text-sm text-text-muted">{c.description}</p>}
                    <div className="mt-3 space-y-1.5 text-sm text-text-muted">
                      {(c.startsOn || c.endsOn) && (
                        <div className="flex items-center gap-1.5">
                          <CalendarDays className="h-4 w-4" aria-hidden />
                          {c.startsOn && c.endsOn ? f.dateRange(c.startsOn, c.endsOn) : f.date((c.startsOn ?? c.endsOn)!)}
                        </div>
                      )}
                      {c.location && (
                        <div className="flex items-center gap-1.5">
                          <MapPin className="h-4 w-4" aria-hidden />
                          {c.location}
                        </div>
                      )}
                      <div className="flex items-center gap-1.5">
                        <Tag className="h-4 w-4" aria-hidden />
                        {t("common.perParticipant", { price: f.money(c.price) })}
                      </div>
                    </div>
                    <span className="mt-auto flex items-center gap-1 pt-4 text-sm font-medium text-brand-primary">
                      {t("pwa.hub.campRegister")}
                      <ChevronRight className="h-4 w-4 transition group-hover:translate-x-0.5" aria-hidden />
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        {news.items.length > 0 && (
          <section aria-labelledby="hub-news" className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Newspaper className="h-5 w-5 text-brand-primary" aria-hidden />
                <h2 id="hub-news" className="font-display text-xl font-semibold">{t("website.public.newsTitle")}</h2>
              </div>
              <Link href="/club/schedule" className={cn(buttonVariants({ variant: "outline", size: "sm" }), "shrink-0")}>
                {t("website.public.scheduleCta")}
                <ChevronRight className="h-4 w-4" aria-hidden />
              </Link>
            </div>
            <NewsList data={news.items} t={news.t} o={{ newTab: false, returnTo: null }} />
          </section>
        )}

        <section aria-labelledby="hub-training" className="space-y-4">
          <div className="flex items-center gap-2">
            <Dumbbell className="h-5 w-5 text-brand-primary" aria-hidden />
            <h2 id="hub-training" className="font-display text-xl font-semibold">{t("pwa.hub.trainingTitle")}</h2>
          </div>
          <div className="flex flex-col gap-4 rounded-md border border-border bg-surface p-5 shadow-sm sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-text-muted">{t("pwa.hub.trainingIntro")}</p>
            <Link href={TRAINING_BOOKING_PATH} className={cn(buttonVariants({ variant: "primary", size: "md" }), "shrink-0")}>
              {t("pwa.hub.trainingCta")}
              <ChevronRight className="h-4 w-4" aria-hidden />
            </Link>
          </div>
        </section>

        <section aria-labelledby="hub-shop" className="space-y-4">
          <div className="flex items-center gap-2">
            <ShoppingBag className="h-5 w-5 text-brand-primary" aria-hidden />
            <h2 id="hub-shop" className="font-display text-xl font-semibold">{t("shop.hub.title")}</h2>
          </div>
          <div className="flex flex-col gap-4 rounded-md border border-border bg-surface p-5 shadow-sm sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-text-muted">{t("shop.hub.intro")}</p>
            <Link href="/shop" className={cn(buttonVariants({ variant: "primary", size: "md" }), "shrink-0")}>
              {t("shop.hub.cta")}
              <ChevronRight className="h-4 w-4" aria-hidden />
            </Link>
          </div>
        </section>

        <section aria-label={t("messaging.contact.title")}>
          <ContactForm clubSlug={tenant.slug} source="/club" compact={signedIn} />
        </section>

        {!signedIn && (
          <section aria-labelledby="hub-members" className="rounded-md border border-border bg-surface p-5 shadow-sm">
            <h2 id="hub-members" className="font-display text-lg font-semibold">{t("pwa.hub.membersTitle")}</h2>
            <p className="mt-1 text-sm text-text-muted">{t("pwa.hub.signInHint")}</p>
            <Link href="/login" className={cn(buttonVariants({ variant: "outline", size: "md" }), "mt-4")}>
              <LogIn className="h-4 w-4" aria-hidden />
              {t("pwa.hub.signIn")}
            </Link>
          </section>
        )}
      </main>
    </div>
  );
}
