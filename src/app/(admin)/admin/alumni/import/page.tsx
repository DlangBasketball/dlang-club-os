import { AlumniImportPage } from "@/components/alumni/pages";
import { getI18n } from "@/lib/i18n/server";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  const { t } = await getI18n();
  return { title: t("alumni.import.title") };
}

export default function Page() {
  return <AlumniImportPage app="admin" />;
}
