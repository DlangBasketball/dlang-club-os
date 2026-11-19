import Link from "next/link";
import { Globe, LogIn } from "lucide-react";
import { BrandMark } from "@/components/layout/brand-mark";
import { LanguageSwitcher } from "@/components/i18n/language-switcher";
import { buttonVariants } from "@/components/ui";
import { getTranslations } from "@/lib/i18n/server";
import { getWebsiteSettings } from "@/lib/website/server";
import { embedThemeVars } from "@/lib/website/theme";
import type { Tenant } from "@/lib/tenant/types";
import { ReturnToWebsite } from "./return-to-website";

/**
 * Header of the app's public pages (club hub, shop, camps, donate, news):
 * the same theme as the club's website embeds, the club's own website nav
 * links and a "Website" link, so the app and the website read as one site.
 */
export async function PublicSiteHeader({ tenant, maxWidth = "max-w-5xl", signIn }: { tenant: Tenant; maxWidth?: string; signIn?: { href: string; label: string } | null }) {
  const t = await getTranslations(tenant.id);
  const settings = tenant.id ? await getWebsiteSettings(tenant.id) : null;
  const connected = Boolean(settings?.enabled);
  const vars = connected && settings ? (embedThemeVars(tenant.branding, settings.embedTheme) as React.CSSProperties) : undefined;
  return (
    <header className="border-b border-border bg-bg text-text" style={vars}>
      <div className={`mx-auto flex ${maxWidth} flex-wrap items-center justify-between gap-3 px-4 py-4`}>
        <Link href="/club" aria-label={tenant.name}><BrandMark /></Link>
        <div className="flex flex-wrap items-center gap-2">
          {connected && settings && settings.navLinks.length > 0 && (
            <nav aria-label={t("website.public.websiteNav")} className="flex flex-wrap items-center gap-x-3 gap-y-1">
              {settings.navLinks.map((l) => (
                <a key={`${l.label}-${l.url}`} href={l.url} className="text-sm text-text-muted hover:text-text">{l.label}</a>
              ))}
            </nav>
          )}
          {connected && settings?.websiteUrl && (
            <a href={settings.websiteUrl} className={buttonVariants({ variant: "ghost", size: "sm" })}>
              <Globe className="h-4 w-4" aria-hidden />
              {t("website.public.website")}
            </a>
          )}
          <LanguageSwitcher variant="compact" />
          {signIn && (
            <Link href={signIn.href} className={buttonVariants({ variant: "secondary", size: "sm" })}>
              <LogIn className="h-4 w-4" aria-hidden />
              {signIn.label}
            </Link>
          )}
        </div>
      </div>
      {connected && settings && settings.allowedOrigins.length > 0 && (
        <div className={`mx-auto ${maxWidth} px-4 pb-2`}>
          <ReturnToWebsite allowedOrigins={settings.allowedOrigins} label={t("website.public.backToWebsite")} />
        </div>
      )}
    </header>
  );
}
