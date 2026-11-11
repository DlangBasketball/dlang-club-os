import type { Metadata } from "next";
import "./globals.css";
import { APP_NAME, APP_TAGLINE } from "@/lib/constants";
export const metadata: Metadata = { title: `${APP_NAME} — ${APP_TAGLINE}`, description: "DLang Basketball club OS." };
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (<html lang="en"><body>{children}</body></html>);
}
