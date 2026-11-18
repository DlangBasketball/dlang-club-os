import { FamilyPage } from "@/components/family/pages";
import { getI18n } from "@/lib/i18n/server";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  const { t } = await getI18n();
  return { title: t("family.pages.family.title") };
}

export default function Page() {
  return <FamilyPage />;
}
