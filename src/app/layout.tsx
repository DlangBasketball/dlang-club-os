import type { Metadata } from "next";
import "./globals.css";
import { APP_NAME, APP_TAGLINE } from "@/lib/constants";
import { getLocaleContext } from "@/lib/i18n/server";
import { getMessages } from "@/lib/i18n/messages";
import { I18nProvider } from "@/lib/i18n/client";
export const metadata: Metadata = { title: `${APP_NAME} — ${APP_TAGLINE}`, description: "DLang Basketball club OS." };
export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const i18n = await getLocaleContext();
  return (<html lang={i18n.locale}><body><I18nProvider ctx={i18n} messages={getMessages(i18n.locale)}>{children}</I18nProvider></body></html>);
}
