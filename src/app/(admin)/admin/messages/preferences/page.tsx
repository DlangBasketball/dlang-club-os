import { NotificationPreferencesPage } from "@/components/messaging/pages";
import { getI18n } from "@/lib/i18n/server";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  const { t } = await getI18n();
  return { title: t("messaging.preferences.title") };
}

export default function Page() {
  return <NotificationPreferencesPage app="admin" />;
}
