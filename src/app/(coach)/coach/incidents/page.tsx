import { redirect } from "next/navigation";
import { getI18n } from "@/lib/i18n/server";
import { requireMe } from "@/lib/club-admin/server";
import { IncidentList } from "@/components/club-admin/incident-views";
export async function generateMetadata() {
  const { t } = await getI18n();
  return { title: t("clubadmin.incidents.title") };
}

/** Coach: incidents of the athletes I coach; report a new one. */
export default async function CoachIncidentsPage() {
  const me = await requireMe(["coach"]);
  if (!me) redirect("/");
  return <IncidentList me={me} base="/coach/incidents" canReport showStats={false} />;
}
