import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSessionUser, postLoginDestination } from "@/lib/auth/get-user";
import { getTenant } from "@/lib/tenant/server";
import { showsHubAtRoot } from "@/lib/pwa/hub";
import { ClubHub } from "@/components/pwa/club-hub";
import { resolveSiteRequest } from "@/lib/site/resolve";
import { hostServesSite } from "@/lib/site/server";
import { SitePageView, siteMetadata } from "@/components/site/site-page";

export async function generateMetadata(): Promise<Metadata> {
  const user = await getSessionUser();
  if (user) return {};
  const tenant = await getTenant();
  if (!showsHubAtRoot(tenant) && !hostServesSite(tenant)) return {};
  const r = await resolveSiteRequest("/");
  if (r?.kind !== "page") return {};
  return siteMetadata({ site: r.site, lang: r.lang, path: "/", languages: r.languages, title: r.tr.metaTitle || r.tr.title, description: r.tr.metaDescription, ogImagePath: r.tr.ogImage?.path ?? null, isHome: true });
}

export default async function RootPage() {
  const user = await getSessionUser();
  if (!user) {
    // On a club's own host, outsiders land on the club's website when it is
    // switched on (Admin -> Site), else on the public club hub (camps,
    // personal training, install app). The platform host keeps sign-in.
    const tenant = await getTenant();
    if (showsHubAtRoot(tenant) || hostServesSite(tenant)) {
      const r = await resolveSiteRequest("/");
      if (r?.kind === "page") return <SitePageView site={r.site} lang={r.lang} path="/" page={r.tr} languages={r.languages} contentLang={r.contentLang} switcher={r.switcher} />;
      if (r?.kind === "redirect") redirect(r.to);
      if (showsHubAtRoot(tenant)) return <ClubHub tenant={tenant} />;
    }
    redirect("/login");
  }
  redirect(postLoginDestination(user));
}
