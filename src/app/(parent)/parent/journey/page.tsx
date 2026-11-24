import { JourneyIndexPage } from "@/components/family/pages";
import { getI18n } from "@/lib/i18n/server";
import { athleteFilterFor } from "@/lib/participants/my-athletes";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  const { t } = await getI18n();
  return { title: t("family.pages.journey.title") };
}

export default async function Page({ searchParams }: { searchParams: Promise<{ athlete?: string }> }) {
  const sp = await searchParams;
  // Default: the active athlete of the switcher; "All" lists every athlete.
  const filter = await athleteFilterFor(sp.athlete, { allowAll: true });
  return <JourneyIndexPage app="parent" filter={filter} />;
}
