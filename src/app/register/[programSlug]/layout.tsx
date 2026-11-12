import { BrandMark } from "@/components/layout/brand-mark";
import { LanguageSwitcher } from "@/components/i18n/language-switcher";
import { getTranslations } from "@/lib/i18n/server";
import { getPublicProgram } from "@/lib/data/public-registration";

export default async function RegisterLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ programSlug: string }>;
}) {
  // Localise the chrome with the PROGRAM's club (language), not the host
  // tenant's — a platform-host link must not show another club's language.
  const { programSlug } = await params;
  const data = await getPublicProgram(programSlug);
  const t = await getTranslations(data?.program.orgId);
  return (
    <div className="grain min-h-screen bg-bg text-ink">
      <header className="border-b border-line">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-4">
          <BrandMark />
          <div className="flex items-center gap-3">
            <span className="hidden text-xs text-ink-3 sm:inline">{t("registration.secure")}</span>
            <LanguageSwitcher variant="compact" />
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 py-8">{children}</main>
    </div>
  );
}
