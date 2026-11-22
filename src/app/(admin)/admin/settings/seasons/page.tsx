import { ErrorState } from "@/components/ui";
import { getClubBillingSettings, listSeasons } from "@/lib/data/billing";
import { getTranslations } from "@/lib/i18n/server";
import { SeasonsEditor } from "@/components/billing/seasons-editor";

export async function generateMetadata() {
  const t = await getTranslations();
  return { title: t("billing.seasons.tab") };
}

/** Settings -> Seasons & membership plan defaults. */
export default async function SeasonsPage() {
  const [settings, seasons, t] = await Promise.all([getClubBillingSettings(), listSeasons(), getTranslations()]);
  if (settings.error !== null || seasons.error !== null) {
    const denied = settings.error === "NOT_AUTHORIZED" || seasons.error === "NOT_AUTHORIZED";
    return <ErrorState message={denied ? t("billing.errors.NOT_AUTHORIZED") : t("billing.errors.generic")} />;
  }
  return <SeasonsEditor settings={settings.data} seasons={seasons.data.seasons} canEdit={seasons.data.canEdit} />;
}
