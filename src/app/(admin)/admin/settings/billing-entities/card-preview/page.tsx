import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { Card, CardBody, CardHeader, CardTitle, ErrorState } from "@/components/ui";
import { CourtsideCard, type CourtsideLabels } from "@/components/member-card/courtside-card";
import { getSessionUser } from "@/lib/auth/get-user";
import { getI18n } from "@/lib/i18n/server";
import { PREVIEW_NAMES, type CourtsideBrand } from "@/lib/member-cards/courtside";
import { listCardBrands, qrSvgFor } from "@/lib/member-cards/courtside-data";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  const { t } = await getI18n();
  return { title: t("memberCard.preview.title") };
}

/**
 * Admin visual check of the Courtside card: every active brand x both
 * layouts (with / without photo) with synthetic names, including a very
 * long one. The QR encodes a preview marker, not a member credential; the
 * portrait is a drawn silhouette, never a real photo.
 */
export default async function CardPreviewPage() {
  const [{ t }, me] = await Promise.all([getI18n(), getSessionUser()]);
  if (!me?.roles.includes("admin")) return <ErrorState message={t("memberCard.errors.forbidden")} />;
  const res = await listCardBrands();
  if (!res.ok) return <ErrorState message={t("memberCard.errors.load")} />;
  const qrSvg = await qrSvgFor("CARD-PREVIEW");

  const brands: CourtsideBrand[] = res.rows.filter((r) => r.isActive).map((r) => ({
    entityId: r.entityId, displayName: r.displayName ?? r.entityName, subtitle: r.subtitle,
    logoUrl: r.logoUrl, watermarkUrl: r.watermarkUrl ?? r.logoUrl, sources: [], isFallback: false,
  }));

  const labels = (name: string, brand: string): CourtsideLabels => ({
    member: t("memberCard.memberLabel"), tapToEnlarge: t("memberCard.tapToEnlarge"), enlargeQr: t("memberCard.enlargeQr"),
    inactive: t("memberCard.inactive"), photoAlt: "", cardAria: t("memberCard.cardAria", { name, brand }),
  });

  return (
    <div className="space-y-6">
      <Link href="/admin/settings/billing-entities" className="inline-flex items-center gap-1 text-sm text-text-muted hover:text-text">
        <ChevronLeft className="h-4 w-4" aria-hidden /> {t("memberCard.preview.back")}
      </Link>
      <p className="text-sm text-text-muted">{t("memberCard.preview.intro")}</p>
      {brands.length === 0 && <p className="text-sm text-text-muted">{t("memberCard.brands.noEntities")}</p>}
      {brands.map((b) => (
        <Card key={b.entityId}>
          <CardHeader><CardTitle>{b.displayName}</CardTitle></CardHeader>
          <CardBody className="space-y-6">
            {(["photo", "noPhoto"] as const).map((layout) => (
              <div key={layout}>
                <h3 className="mb-3 text-xs uppercase tracking-wider text-text-muted">
                  {t(layout === "photo" ? "memberCard.preview.withPhoto" : "memberCard.preview.withoutPhoto")}
                </h3>
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                  {PREVIEW_NAMES.map((name) => (
                    <CourtsideCard key={name} brand={b} name={name} photoUrl={null} samplePhoto={layout === "photo"} qrSvg={qrSvg}
                      labels={labels(name, b.displayName)} />
                  ))}
                </div>
                <div className="mt-4 w-[320px] max-w-full">
                  <p className="mb-1 text-xs text-text-muted">{t("memberCard.preview.phoneWidth")}</p>
                  <CourtsideCard brand={b} name={PREVIEW_NAMES[PREVIEW_NAMES.length - 1]} photoUrl={null} samplePhoto={layout === "photo"}
                    qrSvg={qrSvg} labels={labels(PREVIEW_NAMES[PREVIEW_NAMES.length - 1], b.displayName)} />
                </div>
              </div>
            ))}
          </CardBody>
        </Card>
      ))}
    </div>
  );
}
