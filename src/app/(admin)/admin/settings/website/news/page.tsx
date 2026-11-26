import { ErrorState } from "@/components/ui";
import { getSessionUser } from "@/lib/auth/get-user";
import { createClient } from "@/lib/supabase/server";
import { getTranslations } from "@/lib/i18n/server";
import type { WebsiteDb } from "@/lib/website/server";
import { NewsManager, type AlertRow, type NewsRow } from "@/components/website/admin/news-manager";

export async function generateMetadata() {
  const t = await getTranslations();
  return { title: t("website.admin.tabs.news") };
}

/** Settings -> Website -> News: public news items and club-wide alerts shown on the website. */
export default async function WebsiteNewsPage() {
  const [t, me] = await Promise.all([getTranslations(), getSessionUser()]);
  if (!me?.orgId || !me.roles.includes("admin")) return <ErrorState message={t("website.errors.forbidden")} />;
  const db = (await createClient()) as unknown as WebsiteDb;
  const [news, alerts] = await Promise.all([
    db.from("website_news").select("id,title,excerpt,link_url,is_public,source,published_at").eq("org_id", me.orgId).order("published_at", { ascending: false }).limit(100),
    db.from("club_alerts").select("id,title,starts_at,is_public").eq("org_id", me.orgId).eq("audience", "all").is("cancelled_at", null).order("starts_at", { ascending: false }).limit(30),
  ]);
  const newsRows: NewsRow[] = ((news.data ?? []) as { id: string; title: string; excerpt: string | null; link_url: string | null; is_public: boolean; source: string; published_at: string }[])
    .map((n) => ({ id: n.id, title: n.title, excerpt: n.excerpt, linkUrl: n.link_url, isPublic: n.is_public, source: n.source, publishedAt: n.published_at }));
  const alertRows: AlertRow[] = ((alerts.data ?? []) as { id: string; title: string; starts_at: string; is_public: boolean }[])
    .map((a) => ({ id: a.id, title: a.title, startsAt: a.starts_at, isPublic: a.is_public }));
  return <NewsManager news={newsRows} alerts={alertRows} />;
}
