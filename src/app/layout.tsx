import type { Metadata } from "next";
import "./globals.css";
import { APP_NAME, APP_TAGLINE } from "@/lib/constants";
import { CookieConsentBanner } from "@/components/compliance/cookie-consent-banner";
export const metadata: Metadata = { title: `${APP_NAME} — ${APP_TAGLINE}`, description: "DLang Basketball club OS." };
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (<html lang="en"><body>{children}<CookieConsentBanner policyHref={`/legal/${process.env.NEXT_PUBLIC_DEFAULT_ORG_SLUG ?? "dlang"}/cookies`} /></body></html>);
}
