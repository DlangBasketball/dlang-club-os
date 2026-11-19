import { BrandMark } from "@/components/layout/brand-mark";
import { LanguageSwitcher } from "@/components/i18n/language-switcher";

export default function PublicBookingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grain min-h-screen bg-bg text-ink">
      <header className="border-b border-line">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-4">
          <BrandMark />
          <LanguageSwitcher variant="compact" />
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 py-8">{children}</main>
    </div>
  );
}
