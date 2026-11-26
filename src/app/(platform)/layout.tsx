import type { Metadata } from "next";
import { ShieldCheck } from "lucide-react";
import { requirePlatformAdmin } from "@/lib/platform/auth";
import { PLATFORM_NAME } from "@/lib/platform/catalog";
import { PlatformNav } from "./platform-nav";

export const metadata: Metadata = {
  title: `${PLATFORM_NAME} — Platform console`,
  robots: { index: false, follow: false },
};

/**
 * Platform (SaaS operator) console. Gated server-side by requirePlatformAdmin()
 * (404 for everyone else); every query below is additionally constrained by
 * RLS / SECURITY DEFINER checks on is_platform_admin().
 */
export default async function PlatformLayout({ children }: { children: React.ReactNode }) {
  const admin = await requirePlatformAdmin();
  return (
    <div className="grain min-h-dvh bg-bg lg:grid lg:grid-cols-[240px_1fr]">
      <aside className="border-b border-line bg-bg-secondary p-4 lg:sticky lg:top-0 lg:flex lg:h-dvh lg:flex-col lg:border-b-0 lg:border-r lg:p-5">
        <div className="mb-4 flex items-center gap-2.5 lg:mb-8">
          <div className="flex h-9 w-9 items-center justify-center rounded-md border border-[#C19A45]/40 bg-[#C19A45]/10">
            <ShieldCheck className="h-5 w-5 text-[#C19A45]" />
          </div>
          <div className="leading-tight">
            <div className="font-display text-sm font-semibold text-ink">{PLATFORM_NAME}</div>
            <div className="text-[10px] uppercase tracking-[0.18em] text-[#C19A45]">Platform console</div>
          </div>
        </div>
        <div className="lg:flex-1">
          <PlatformNav email={admin.email} />
        </div>
      </aside>
      <main className="min-w-0 px-4 py-6 sm:px-6 lg:px-10 lg:py-8">{children}</main>
    </div>
  );
}
