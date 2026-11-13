import type { Metadata, Viewport } from "next";
import { Fraunces, Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { getTenant } from "@/lib/tenant/server";
import { TenantProvider } from "@/lib/tenant/context";
import { TenantGate } from "@/components/layout/tenant-gate";
import { brandingToCssVars, googleFontsHref, isDarkPalette } from "@/lib/tenant/theme";
import { getLocaleContext } from "@/lib/i18n/server";
import { getMessages } from "@/lib/i18n/messages";
import { I18nProvider } from "@/lib/i18n/client";
import { CookieConsentBanner } from "@/components/compliance/cookie-consent-banner";
import { PwaRegister } from "@/components/pwa/pwa-register";
import { MANIFEST_PATH, iconUrl, iconVersion } from "@/lib/pwa/manifest";

// Design-system fonts (docs/design/DESIGN_SYSTEM.md). Each exposes a CSS
// variable consumed by --font-display / --font-ui / --font-mono in globals.css.
// A tenant with custom fonts overrides those tokens (src/lib/tenant/theme.ts).
const fontDisplay = Fraunces({
  subsets: ["latin", "latin-ext"],
  variable: "--font-fraunces",
  display: "swap",
  style: ["normal", "italic"],
  axes: ["opsz"],
  fallback: ["Iowan Old Style", "Times New Roman", "serif"],
});
const fontUi = Geist({
  subsets: ["latin", "latin-ext"],
  variable: "--font-geist",
  display: "swap",
  fallback: ["system-ui", "-apple-system", "Segoe UI", "Roboto", "sans-serif"],
});
const fontMono = Geist_Mono({
  subsets: ["latin", "latin-ext"],
  variable: "--font-geist-mono",
  display: "swap",
  fallback: ["ui-monospace", "Menlo", "monospace"],
});

/** Per-tenant <title>, description and favicon. */
export async function generateMetadata(): Promise<Metadata> {
  const tenant = await getTenant();
  const icon = tenant.branding.faviconUrl ?? tenant.branding.logoUrl;
  // The club's own product name ("DLang OS"); falls back to the club name.
  const app = tenant.appName;
  return {
    title: { default: app, template: `%s · ${app}` },
    description: app === tenant.name ? app : `${app} · ${tenant.name}`,
    applicationName: app,
    // Installable club app (PWA): per-tenant manifest + generated icons.
    manifest: MANIFEST_PATH,
    appleWebApp: { capable: true, title: app, statusBarStyle: isDarkPalette(tenant.branding) ? "black" : "default" },
    icons: {
      ...(icon ? { icon } : {}),
      apple: [{ url: iconUrl("apple-touch", iconVersion(tenant)), sizes: "180x180", type: "image/png" }],
    },
    // Next emits only mobile-web-app-capable; older iOS still reads the apple- prefixed tag.
    other: { "apple-mobile-web-app-capable": "yes" },
  };
}

export async function generateViewport(): Promise<Viewport> {
  const tenant = await getTenant();
  return {
    themeColor: tenant.branding.colors.background,
    colorScheme: isDarkPalette(tenant.branding) ? "dark" : "light",
  };
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const tenant = await getTenant();
  // No orgId: the signed-in user's org wins (then the host tenant), the same
  // context server pages get from getFormatter()/getTranslations(), so the
  // client I18nProvider and server-rendered numbers/dates agree.
  const i18n = await getLocaleContext();
  // Tenant theme -> design-system CSS variables on <html>: the inline style
  // beats the :root defaults (and the light-theme block) in globals.css, so
  // the whole UI rebrands with no component changes.
  const cssVars = brandingToCssVars(tenant.branding) as React.CSSProperties;
  const fontsHref = googleFontsHref(tenant.branding);
  const dark = isDarkPalette(tenant.branding);
  return (
    <html
      lang={i18n.locale}
      className={`${fontDisplay.variable} ${fontUi.variable} ${fontMono.variable}${dark ? " dark" : ""}`}
      style={{ ...cssVars, colorScheme: dark ? "dark" : "light" }}
      data-theme={dark ? "dark" : "light"}
      data-tenant={tenant.slug}
    >
      <head>
        {fontsHref && (
          <>
            <link rel="preconnect" href="https://fonts.googleapis.com" />
            <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
            <link rel="stylesheet" href={fontsHref} />
          </>
        )}
      </head>
      <body>
        <TenantProvider tenant={tenant}>
          <I18nProvider ctx={i18n} messages={getMessages(i18n.locale)}>
            <TenantGate tenant={tenant}>{children}</TenantGate>
            <CookieConsentBanner policyHref={`/legal/${tenant.slug}/cookies`} />
            <PwaRegister />
          </I18nProvider>
        </TenantProvider>
      </body>
    </html>
  );
}
