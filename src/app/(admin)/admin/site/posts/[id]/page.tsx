import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { getTranslations } from "@/lib/i18n/server";
import { listAdminPosts, listPickerImages, loadAdminSite, requireAdminOrg } from "@/lib/site/admin-data";
import { PostEditor } from "@/components/site/admin/post-editor";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations();
  return { title: t("site.posts.editTitle") };
}

/** Edit (or create: id "new") a news post. */
export default async function SitePostEditorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = await requireAdminOrg();
  if (!me) redirect("/admin/dashboard");
  if (id !== "new" && !/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const t = await getTranslations();
  const site = await loadAdminSite(me.orgId);
  const [posts, images] = await Promise.all([listAdminPosts(me.orgId, site.settings.defaultLanguage), listPickerImages(me.orgId)]);
  const post = id === "new" ? null : posts.find((p) => p.id === id);
  if (id !== "new" && !post) notFound();
  return (
    <div className="animate-fade-up space-y-5">
      <PageHeader eyebrow={<Link href="/admin/site/posts" className="hover:text-text">{t("site.posts.title")}</Link>} title={post?.title ?? t("site.posts.new")} />
      <PostEditor
        post={post ? { id: post.id, slug: post.slug, status: post.status, publishedAt: post.publishedAt, coverPath: post.coverPath, authorName: post.authorName, tags: post.tags, content: post.content } : { id: null, slug: "", status: "draft", publishedAt: null, coverPath: null, authorName: null, tags: [], content: {} }}
        languages={site.settings.languages}
        defaultLang={site.settings.defaultLanguage}
        images={images}
      />
    </div>
  );
}
