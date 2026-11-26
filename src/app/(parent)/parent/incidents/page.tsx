import { redirect } from "next/navigation";
import { getI18n } from "@/lib/i18n/server";
import { requireMe } from "@/lib/club-admin/server";
import { IncidentList } from "@/components/club-admin/incident-views";
export async function generateMetadata() {
  const { t } = await getI18n();
  return { title: t("clubadmin.incidents.title") };
}

/** Parent: incident reports about my children (read only). */
export default async function ParentIncidentsPage() {
  const me = await requireMe(["parent"]);
  if (!me) redirect("/");
  return <IncidentList me={me} base="/parent/incidents" canReport={false} showStats={false} />;
}
