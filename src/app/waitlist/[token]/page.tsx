import { BrandMark } from "@/components/layout/brand-mark";
import { LanguageSwitcher } from "@/components/i18n/language-switcher";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui";
import { getI18n } from "@/lib/i18n/server";
import { I18nProvider } from "@/lib/i18n/client";
import { caAdminDb } from "@/lib/club-admin/db";
import { tokenSchema } from "@/lib/club-admin/validation";
import { OfferResponse } from "@/components/club-admin/waitlist-widgets";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  const { t } = await getI18n();
  return { title: t("clubadmin.waitlist.offerTitle"), robots: { index: false, follow: false } };
}

type Lookup = { org_id: string; status: string; kind: string; target_name: string; when: string | null; child_first_name: string; expires_at: string; expired: boolean };

/**
 * Public waiting-list offer (link from the email). The 48-hex token is the
 * credential; the page shows the child's first name and the programme only.
 */
export default async function WaitlistOfferPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const valid = tokenSchema.safeParse(token).success;
  const { data } = valid ? await caAdminDb().rpc("waitlist_offer_lookup", { p_token: token }) : { data: null };
  const o = (data ?? null) as Lookup | null;
  const i18n = await getI18n(o?.org_id ?? null);
  const { t, f } = i18n;
  const when = o?.when ? (o.when.includes("/") ? f.dateRange(o.when.split("/")[0], o.when.split("/")[1]) : f.dateTime(o.when)) : null;
  const open = o && o.status === "offered" && !o.expired;

  return (
    <div className="grain min-h-dvh bg-bg text-text">
      <header className="border-b border-border">
        <div className="mx-auto flex max-w-2xl items-center justify-between gap-3 px-4 py-4">
          <BrandMark />
          <LanguageSwitcher variant="compact" />
        </div>
      </header>
      <main className="mx-auto max-w-2xl px-4 py-10">
        <Card>
          <CardHeader><CardTitle>{t("clubadmin.waitlist.offerTitle")}</CardTitle></CardHeader>
          <CardBody className="space-y-4">
            {!o && <p className="text-sm text-ink-2">{t("clubadmin.errors.invalidLink")}</p>}
            {o && (
              <p className="text-sm text-ink-2">
                {t("clubadmin.waitlist.offerIntro", { child: o.child_first_name, name: o.target_name })}
                {when ? ` (${when})` : ""}
              </p>
            )}
            {open && <p className="text-sm text-ink-3">{t("clubadmin.waitlist.offerExpires", { date: f.dateTime(o.expires_at) })}</p>}
            {o && !open && (
              <p className="text-sm text-ink-2">{t.dynamic(`clubadmin.waitlist.offerState.${o.expired ? "expired" : o.status}`, undefined, t("clubadmin.waitlist.offerState.closed"))}</p>
            )}
            {open && (
              <I18nProvider ctx={i18n.ctx} messages={i18n.messages}>
                <OfferResponse token={token} />
              </I18nProvider>
            )}
          </CardBody>
        </Card>
      </main>
    </div>
  );
}
