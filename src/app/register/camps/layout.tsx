import { BrandMark } from "@/components/layout/brand-mark";
import { LanguageSwitcher } from "@/components/i18n/language-switcher";
import { getTranslations } from "@/lib/i18n/server";
import { getTenant } from "@/lib/tenant/server";

/** Public camps area (season chooser + basket): localised with the host's club. */
export default async function RegisterCampsLayout({ children }: { children: React.ReactNode }) {
  const tenant = await getTenant();
  const t = await getTranslations(tenant.id);
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
