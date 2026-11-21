import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { getTranslations } from "@/lib/i18n/server";
import { listAdminPages, listPickerImages, loadAdminPage, loadAdminSite, requireAdminOrg } from "@/lib/site/admin-data";
import { siteTranslationAvailable } from "@/lib/actions/site";
import { localizedPath } from "@/lib/site/paths";
import { PageEditor } from "@/components/site/admin/page-editor";
import { PublishBar } from "@/components/site/admin/site-admin";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations();
  return { title: t("site.editor.title") };
}

/** Block editor of one site page (per-language tabs, publish / schedule, history). */
export default async function SitePageEditor({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = await requireAdminOrg();
  if (!me) redirect("/admin/dashboard");
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const t = await getTranslations();
  const site = await loadAdminSite(me.orgId);
  const [page, pages, images, ai] = await Promise.all([
    loadAdminPage(me.orgId, id),
    listAdminPages(me.orgId, site.settings.defaultLanguage),
    listPickerImages(me.orgId),
    siteTranslationAvailable(),
  ]);
  if (!page) notFound();
  const def = site.settings.defaultLanguage;
  const title = page.content[def]?.title || page.path;
  return (
    <div className="animate-fade-up space-y-5">
      <PageHeader
        eyebrow={<Link href="/admin/site" className="hover:text-text">{t("site.admin.title")}</Link>}
        title={title}
        description={page.path}
      />
      <PublishBar
        id={page.id}
        status={page.status}
        publishedAt={page.publishedAt}
        previewHref={`/admin/site/preview/${page.id}?lang=${encodeURIComponent(def)}`}
        livePath={site.enabled ? localizedPath(page.path, def, def) : null}
      />
      <PageEditor
        page={{ id: page.id, path: page.path, parentId: page.parentId, showInNav: page.showInNav, template: page.template, content: page.content, versions: page.versions }}
        languages={site.settings.languages}
        defaultLang={def}
        images={images}
        parents={pages.map((p) => ({ id: p.id, title: p.title, path: p.path }))}
        aiAvailable={ai}
      />
    </div>
  );
}
