import { AlertsPage } from "@/components/messaging/alerts-page";
import { getI18n } from "@/lib/i18n/server";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  const { t } = await getI18n();
  return { title: t("messaging.alerts.pageTitle") };
}

export default function Page() {
  return <AlertsPage app="admin" />;
}
