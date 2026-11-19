import { CarpoolEventPage } from "@/components/family/pages";
import { getI18n } from "@/lib/i18n/server";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  const { t } = await getI18n();
  return { title: t("family.pages.carpool.title") };
}

export default async function Page({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await params;
  return <CarpoolEventPage app="parent" eventId={eventId} />;
}
