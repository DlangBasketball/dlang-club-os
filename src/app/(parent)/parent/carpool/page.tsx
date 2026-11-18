import { CarpoolIndexPage } from "@/components/family/pages";
import { getI18n } from "@/lib/i18n/server";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  const { t } = await getI18n();
  return { title: t("family.pages.carpool.title") };
}

export default function Page() {
  return <CarpoolIndexPage app="parent" />;
}
