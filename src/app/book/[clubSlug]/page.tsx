import Link from "next/link";
import { notFound } from "next/navigation";
import { MapPin } from "lucide-react";
import { Button, Card, CardBody } from "@/components/ui";
import { PublicBookingFlow } from "@/components/training/public-booking";
import { getPublicCatalog } from "@/lib/training/data";
import { hostNamesOtherClub, venueLine } from "@/lib/training/format";
import { getTenant } from "@/lib/tenant/server";
import { getSessionUser } from "@/lib/auth/get-user";
import { getI18n } from "@/lib/i18n/server";
import { I18nProvider } from "@/lib/i18n/client";
import { ContactForm } from "@/components/messaging/leads";

export const dynamic = "force-dynamic";

/**
 * Public training booking page of one club (no login needed to browse).
 * The club is resolved server-side from the slug; a club's own host only
 * serves its own slug. Members are pointed to the parent app.
 */
export default async function PublicBookingPage({ params }: { params: Promise<{ clubSlug: string }> }) {
  const { clubSlug } = await params;
  const slug = clubSlug.toLowerCase();
  const tenant = await getTenant();
  if (hostNamesOtherClub(tenant, slug)) notFound();
  const catalog = await getPublicCatalog(slug);
  if (!catalog) notFound();
  const [{ t, ctx, messages }, me] = await Promise.all([getI18n(catalog.org.id), getSessionUser()]);
  const member = me?.orgId === catalog.org.id;
  const venues = catalog.venues.filter((v) => catalog.services.some((s) => s.venueId === v.id) || catalog.availability.templates.some((x) => x.venueId === v.id));

  return (
    <div className="animate-fade-up space-y-6">
      <section>
        <div className="text-xs uppercase tracking-[0.18em] text-maroon">{catalog.org.name}</div>
        <h1 className="mt-1 font-display text-3xl font-semibold">{t("training.public.title")}</h1>
        <p className="mt-2 max-w-2xl text-sm text-ink-2">{t("training.public.intro")}</p>
        <ol className="mt-4 grid grid-cols-1 gap-2 text-sm text-ink-2 sm:grid-cols-3">
          <li className="rounded-lg border border-line p-3"><span className="font-semibold text-ink">1.</span> {t("training.public.step1")}</li>
          <li className="rounded-lg border border-line p-3"><span className="font-semibold text-ink">2.</span> {t("training.public.step2")}</li>
          <li className="rounded-lg border border-line p-3"><span className="font-semibold text-ink">3.</span> {t("training.public.step3")}</li>
        </ol>
        {venues.length > 0 && (
          <ul className="mt-3 space-y-1 text-xs text-ink-3">
            {venues.map((v) => <li key={v.id} className="flex items-center gap-1"><MapPin className="h-3.5 w-3.5" />{venueLine(v)}</li>)}
          </ul>
        )}
      </section>
      {me ? (
        <Card><CardBody className="space-y-3 py-5">
          <p className="text-sm text-ink-2">{member ? t("training.public.memberSignedIn") : t("training.public.otherClubSignedIn")}</p>
          {member && <Link href="/parent/bookings/new"><Button size="sm">{t("training.public.openWizard")}</Button></Link>}
        </CardBody></Card>
      ) : (
        <I18nProvider ctx={{ ...ctx, timeZone: catalog.org.timezone, currency: catalog.org.currency }} messages={messages}>
          <PublicBookingFlow catalog={catalog} />
        </I18nProvider>
      )}
      {!me && (
        <I18nProvider ctx={{ ...ctx, timeZone: catalog.org.timezone, currency: catalog.org.currency }} messages={messages}>
          <ContactForm compact clubSlug={slug} defaultInterest="training" source={`/book/${slug}`} />
        </I18nProvider>
      )}
    </div>
  );
}
