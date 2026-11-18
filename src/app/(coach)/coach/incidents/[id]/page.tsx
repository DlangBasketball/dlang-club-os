import { redirect } from "next/navigation";
import { getI18n } from "@/lib/i18n/server";
import { requireMe } from "@/lib/club-admin/server";
import { IncidentDetail } from "@/components/club-admin/incident-views";
export async function generateMetadata() {
  const { t } = await getI18n();
  return { title: t("clubadmin.incidents.title") };
}

export default async function CoachIncidentPage({ params }: { params: Promise<{ id: string }> }) {
  const [{ id }, me] = await Promise.all([params, requireMe(["coach"])]);
  if (!me) redirect("/");
  return <IncidentDetail me={me} base="/coach/incidents" id={id} editable />;
}
