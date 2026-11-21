import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { getTranslations } from "@/lib/i18n/server";
import { listAdminPosts, loadAdminSite, requireAdminOrg } from "@/lib/site/admin-data";
import { SiteTabs } from "@/components/site/admin/site-tabs";
import { PostsList } from "@/components/site/admin/post-editor";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations();
  return { title: t("site.posts.title") };
}

/** News / blog posts of the club site (/news/<slug>). */
export default async function SitePostsPage() {
  const me = await requireAdminOrg();
  if (!me) redirect("/admin/dashboard");
  const t = await getTranslations();
  const site = await loadAdminSite(me.orgId);
  const posts = await listAdminPosts(me.orgId, site.settings.defaultLanguage);
  return (
    <div className="animate-fade-up space-y-6">
      <PageHeader title={t("site.posts.title")} description={t("site.posts.description")} />
      <SiteTabs t={t} current="posts" />
      <PostsList posts={posts.map((p) => ({ id: p.id, slug: p.slug, status: p.status, publishedAt: p.publishedAt, title: p.title }))} />
    </div>
  );
}
