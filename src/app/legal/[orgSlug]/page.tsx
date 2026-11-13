import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getLegalTenant } from "@/lib/compliance/tenant";
import { LEGAL_DOCS, LEGAL_DOC_TITLES } from "@/lib/compliance/legal-templates";
import { frameworkLabel } from "@/lib/compliance/profile";
import { CookieSettingsButton } from "@/components/compliance/cookie-consent-banner";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ orgSlug: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { orgSlug } = await params;
  const t = await getLegalTenant(orgSlug);
  return { title: t ? `Legal — ${t.clubName}` : "Legal", robots: { index: true, follow: true } };
}

export default async function LegalIndex({ params }: Params) {
  const { orgSlug } = await params;
  const t = await getLegalTenant(orgSlug);
  if (!t) notFound();

  return (
    <div className="space-y-8">
      <header className="space-y-2">
        <h1 className="font-display text-3xl font-semibold">Legal &amp; privacy</h1>
        <p className="text-ink-2">{t.clubName}</p>
        <p className="text-xs text-ink-3">Frameworks: {t.profile.frameworks.map(frameworkLabel).join(" · ")}</p>
      </header>
      <ul className="divide-y divide-line rounded-lg border border-line bg-surface">
        {LEGAL_DOCS.map((k) => (
          <li key={k}>
            <Link href={`/legal/${t.slug}/${k}`} className="flex items-center justify-between px-4 py-3 hover:bg-surface-elevated">
              <span>{LEGAL_DOC_TITLES[k]}</span>
              <span className="text-ink-3">→</span>
            </Link>
          </li>
        ))}
      </ul>
      <CookieSettingsButton className="text-sm text-maroon underline underline-offset-2" label="Change cookie settings" />
    </div>
  );
}
