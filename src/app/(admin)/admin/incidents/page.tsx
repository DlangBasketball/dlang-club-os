import { redirect } from "next/navigation";
import { getI18n } from "@/lib/i18n/server";
import { requireMe } from "@/lib/club-admin/server";
import { IncidentList } from "@/components/club-admin/incident-views";
export async function generateMetadata() {
  const { t } = await getI18n();
  return { title: t("clubadmin.incidents.title") };
}

/** Injury & incident log (admin): reports, follow-up, anonymous statistics for the safety review. */
export default async function AdminIncidentsPage() {
  const me = await requireMe(["admin"]);
  if (!me) redirect("/admin/dashboard");
  return <IncidentList me={me} base="/admin/incidents" canReport showStats />;
}
