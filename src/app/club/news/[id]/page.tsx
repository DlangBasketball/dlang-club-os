import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTenant } from "@/lib/tenant/server";
import { getI18n } from "@/lib/i18n/server";
import { getPublicNewsItem } from "@/lib/website/public-data";
import { PublicSiteHeader } from "@/components/website/public-site-header";

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const [{ id }, tenant] = await Promise.all([params, getTenant()]);
  const item = tenant.id ? await getPublicNewsItem(tenant.id, id) : null;
  return { title: item?.title ?? tenant.name };
}

/** One public news item of the request host's club. HTML was sanitized on save and is sanitized again on read. */
export default async function ClubNewsPage({ params }: Props) {
  const [{ id }, tenant] = await Promise.all([params, getTenant()]);
  if (!tenant.id) notFound();
  const item = await getPublicNewsItem(tenant.id, id);
  if (!item) notFound();
  const { t, f } = await getI18n(tenant.id);
  return (
    <div className="grain min-h-dvh bg-bg text-text">
      <PublicSiteHeader tenant={tenant} maxWidth="max-w-3xl" />
      <main className="mx-auto max-w-3xl space-y-4 px-4 py-8">
        <Link href="/club" className="text-sm text-brand-primary hover:underline">{t("website.public.backToClub")}</Link>
        <p className="text-xs uppercase tracking-[0.18em] text-text-muted">{f.date(item.publishedAt)}</p>
        <h1 className="font-display text-3xl font-semibold">{item.title}</h1>
        <div className="prose-sm space-y-3 text-text-secondary [&_a]:text-brand-primary [&_a]:underline" dangerouslySetInnerHTML={{ __html: item.html }} />
        {item.linkUrl && (
          <a href={item.linkUrl} className="inline-block text-sm text-brand-primary hover:underline">{t("website.public.readOnWebsite")}</a>
        )}
      </main>
    </div>
  );
}
