import type { Metadata, Viewport } from "next";
import { Fraunces, Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { APP_NAME, APP_TAGLINE } from "@/lib/constants";

// Design-system fonts (docs/design/DESIGN_SYSTEM.md). Each exposes a CSS
// variable consumed by --font-display / --font-ui / --font-mono in globals.css.
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

export const metadata: Metadata = { title: `${APP_NAME} — ${APP_TAGLINE}`, description: "DLang Basketball club OS." };
export const viewport: Viewport = { themeColor: "#0A0A0A", colorScheme: "dark light" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${fontDisplay.variable} ${fontUi.variable} ${fontMono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
