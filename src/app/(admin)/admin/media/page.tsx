import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { getSessionUser } from "@/lib/auth/get-user";
import { getI18n, getTranslations } from "@/lib/i18n/server";
import { getOrgCover, listMediaAssets } from "@/lib/media/server";
import { MediaLibrary } from "@/components/media/media-library";
import { CoverImage } from "@/components/media/cover-image";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations();
  return { title: t("media.library.title") };
}

/** Club media library: covers, banners and gallery images (admins). */
export default async function MediaLibraryPage() {
  const [me, { t }] = await Promise.all([getSessionUser(), getI18n()]);
  if (!me?.orgId || !me.roles.includes("admin")) redirect("/admin/dashboard");
  const [assets, cover] = await Promise.all([listMediaAssets(me.orgId), getOrgCover(me.orgId)]);
  return (
    <div className="animate-fade-up space-y-6">
      <PageHeader title={t("media.library.title")} description={t("media.library.description")} />
      <section aria-labelledby="club-cover" className="space-y-2">
        <h2 id="club-cover" className="text-lg font-semibold">{t("media.library.clubCoverTitle")}</h2>
        <p className="text-sm text-text-muted">{t("media.library.clubCoverHint")}</p>
        <CoverImage
          cover={cover}
          variant="banner"
          title={t("media.library.clubCoverPreview")}
          edit={{ target: "org", id: me.orgId, canUseLibrary: true }}
        />
      </section>
      <MediaLibrary assets={assets} />
    </div>
  );
}
