import type { Metadata, Viewport } from "next";
import "./globals.css";
import { APP_TAGLINE } from "@/lib/constants";
import { getTenant } from "@/lib/tenant/server";
import { TenantProvider } from "@/lib/tenant/context";
import { TenantGate } from "@/components/layout/tenant-gate";
import { brandingToCssVars, googleFontsHref, isDarkPalette } from "@/lib/tenant/theme";

/** Per-tenant <title>, description and favicon. */
export async function generateMetadata(): Promise<Metadata> {
  const tenant = await getTenant();
  const icon = tenant.branding.faviconUrl ?? tenant.branding.logoUrl;
  return {
    title: { default: `${tenant.name} — ${APP_TAGLINE}`, template: `%s · ${tenant.name}` },
    description: `${tenant.name} — ${APP_TAGLINE}.`,
    applicationName: tenant.name,
    ...(icon ? { icons: { icon, apple: icon } } : {}),
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
  // Tenant theme -> CSS variables on <html>: inline style beats the
  // defaults in globals.css, so the whole UI rebrands with no code changes.
  const cssVars = brandingToCssVars(tenant.branding) as React.CSSProperties;
  const fontsHref = googleFontsHref(tenant.branding);
  const dark = isDarkPalette(tenant.branding);
  return (
    <html
      lang={tenant.defaultLocale}
      className={dark ? "dark" : undefined}
      style={{ ...cssVars, colorScheme: dark ? "dark" : "light" }}
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
          <TenantGate tenant={tenant}>{children}</TenantGate>
        </TenantProvider>
      </body>
    </html>
  );
}
