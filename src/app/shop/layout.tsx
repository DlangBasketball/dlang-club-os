import Link from "next/link";
import { BrandMark } from "@/components/layout/brand-mark";
import { LanguageSwitcher } from "@/components/i18n/language-switcher";
import { getTranslations } from "@/lib/i18n/server";
import { getTenant } from "@/lib/tenant/server";

/** Public club shop shell (signed in or not). */
export default async function ShopLayout({ children }: { children: React.ReactNode }) {
  const tenant = await getTenant();
  const t = await getTranslations(tenant.id);
  return (
    <div className="grain min-h-dvh bg-bg text-text">
      <header className="border-b border-border">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-4">
          <Link href="/club" aria-label={t("shop.backToClub")}><BrandMark /></Link>
          <LanguageSwitcher variant="compact" />
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-8">{children}</main>
    </div>
  );
}
