import { redirect } from "next/navigation";
import { getI18n } from "@/lib/i18n/server";
import { requireMe } from "@/lib/club-admin/server";
import { IncidentNew } from "@/components/club-admin/incident-views";
export async function generateMetadata() {
  const { t } = await getI18n();
  return { title: t("clubadmin.incidents.title") };
}

export default async function AdminIncidentNewPage() {
  const me = await requireMe(["admin"]);
  if (!me) redirect("/admin/dashboard");
  return <IncidentNew me={me} base="/admin/incidents" />;
}
