import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BrandMark } from "@/components/layout/brand-mark";
import { LanguageSwitcher } from "@/components/i18n/language-switcher";
import { DonateForm } from "@/components/operations/donate-form";
import { getI18n, getTranslations } from "@/lib/i18n/server";
import { getTenant } from "@/lib/tenant/server";
import { getOrgPaymentProfile } from "@/lib/payments/settings";
import { getStripe } from "@/lib/stripe";
import { zonedDayKey } from "@/lib/staff/hours";
import { opsAdminDb } from "@/lib/operations/db";
import { campaignOpen, campaignProgress } from "@/lib/operations/fundraising";
import { startDonationCheckout } from "@/lib/actions/operations-sponsors";

type Props = { params: Promise<{ slug: string }>; searchParams: Promise<{ thanks?: string }> };

async function loadCampaign(slug: string) {
  const tenant = await getTenant();
  if (!tenant.id || !/^[a-z0-9-]{1,64}$/.test(slug)) return null;
  // Service role, filtered by the request host's club and a public campaign only.
  const { data } = await opsAdminDb().from("fundraising_campaigns").select("id,slug,title,description,goal_amount,currency,status,starts_on,ends_on,is_public")
    .eq("org_id", tenant.id).eq("slug", slug).eq("is_public", true).neq("status", "draft").maybeSingle();
  return data ? { tenant, orgId: tenant.id, campaign: data } : null;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const found = await loadCampaign(slug);
  const t = await getTranslations(found?.tenant.id);
  return { title: found ? t("operations.donate.metaTitle", { campaign: found.campaign.title, club: found.tenant.name }) : t("operations.donate.title") };
}

/**
 * Public campaign page: goal and progress (totals only, never donor names),
 * and an online gift through Stripe Checkout when the club has online
 * payments set up.
 */
export default async function DonatePage({ params, searchParams }: Props) {
  const [{ slug }, sp] = await Promise.all([params, searchParams]);
  const found = await loadCampaign(slug);
  if (!found) notFound();
  const { tenant, orgId, campaign: c } = found;
  const { t, f } = await getI18n(orgId);
  const { data: gifts } = await opsAdminDb().from("donations").select("amount,currency,status,donor_id,donated_on")
    .eq("org_id", orgId).eq("campaign_id", c.id).eq("status", "received").limit(10000);
  const p = campaignProgress(Number(c.goal_amount), c.currency, (gifts ?? []).map((g) => ({ amount: Number(g.amount), currency: g.currency, status: g.status, donorId: g.donor_id, donatedOn: g.donated_on })));
  const open = campaignOpen({ status: c.status, startsOn: c.starts_on, endsOn: c.ends_on }, zonedDayKey(new Date(), f.timeZone));
  const online = open && Boolean(getStripe()) && (await getOrgPaymentProfile(orgId)).stripeReady;

  return (
    <div className="grain min-h-dvh bg-bg text-text">
      <header className="border-b border-border">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 px-4 py-4">
          <Link href="/club" aria-label={tenant.name}><BrandMark /></Link>
          <LanguageSwitcher variant="compact" />
        </div>
      </header>
      <main className="mx-auto max-w-3xl space-y-6 px-4 py-8">
        <div>
          <p className="text-xs uppercase tracking-[0.18em] text-brand-primary">{tenant.name}</p>
          <h1 className="mt-1 font-display text-3xl font-semibold">{c.title}</h1>
          {c.description && <p className="mt-3 whitespace-pre-line text-text-secondary">{c.description}</p>}
        </div>
        <div className="space-y-2">
          <div className="h-3 overflow-hidden rounded-full bg-surface-elevated" role="progressbar" aria-valuenow={p.barPercent} aria-valuemin={0} aria-valuemax={100}>
            <div className="h-full rounded-full bg-brand-primary" style={{ width: `${p.barPercent}%` }} />
          </div>
          <p className="text-sm text-text-muted">{t("operations.donate.progress", { raised: f.money(p.raised, c.currency), goal: f.money(p.goal, c.currency), donors: p.donorCount })}</p>
        </div>
        {sp.thanks === "1" && <p role="status" className="rounded border border-success/40 bg-success-soft p-3 text-sm text-success">{t("operations.donate.thanks")}</p>}
        {!open ? <p className="text-sm text-text-muted">{t("operations.donate.closed")}</p>
          : online ? <DonateForm campaignId={c.id} currency={c.currency} action={startDonationCheckout} />
          : <p className="text-sm text-text-muted">{t("operations.donate.offline")}</p>}
      </main>
    </div>
  );
}
