import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { getTenant } from "@/lib/tenant/server";
import type { Tenant } from "@/lib/tenant/types";
import { loadSite } from "@/lib/site/server";
import { loadAdminPage, requireAdminOrg } from "@/lib/site/admin-data";
import { tagFromSlug } from "@/lib/site/languages";
import { SitePageView } from "@/components/site/site-page";

export const metadata: Metadata = { robots: { index: false, follow: false } };

/**
 * Draft preview of a site page for the club's admins (outside the admin
 * shell, so it looks exactly like the public site). Shows the working copy,
 * including images not yet cleared for public use (flagged). Never indexed.
 */
export default async function SitePreviewPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ lang?: string }> }) {
  const { id } = await params;
  const { lang: langParam } = await searchParams;
  const me = await requireAdminOrg();
  if (!me) redirect("/login");
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const tenant = await getTenant();
  const page = await loadAdminPage(me.orgId, id);
  if (!page) notFound();
  // The signed-in admin's own club only (tenant host must match when it names a club).
  if (tenant.id && tenant.id !== me.orgId && (tenant.source === "subdomain" || tenant.source === "custom_domain")) notFound();
  const site = await loadSite({ ...tenant, id: me.orgId } as Tenant & { id: string }, { allowDisabled: true });
  if (!site) notFound();
  const lang = tagFromSlug(langParam ?? "", site.settings.languages) ?? site.settings.defaultLanguage;
  const tr = page.content[lang] ?? page.content[site.settings.defaultLanguage] ?? Object.values(page.content)[0];
  if (!tr) notFound();
  const languages = site.settings.languages.filter((l) => page.content[l]);
  return <SitePageView site={site} lang={lang} path={page.path} page={tr} languages={languages} preview langHref={(l) => `/admin/site/preview/${id}?lang=${encodeURIComponent(l)}`} />;
}
