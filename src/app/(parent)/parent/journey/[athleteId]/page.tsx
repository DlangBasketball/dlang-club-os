import { JourneyDetailPage } from "@/components/family/pages";
import { getI18n } from "@/lib/i18n/server";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  const { t } = await getI18n();
  return { title: t("family.pages.journey.title") };
}

export default async function Page({ params }: { params: Promise<{ athleteId: string }> }) {
  const { athleteId } = await params;
  return <JourneyDetailPage app="parent" athleteId={athleteId} />;
}
