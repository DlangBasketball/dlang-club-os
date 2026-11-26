import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { SportsManager } from "@/components/sports/sports-manager";
import { getSessionUser } from "@/lib/auth/get-user";
import { getI18n } from "@/lib/i18n/server";
import { listSports } from "@/lib/sports/data";

export default async function SportsPage() {
  const [me, { t }] = await Promise.all([getSessionUser(), getI18n()]);
  if (!me?.orgId || !(me.roles.includes("admin") || me.roles.includes("finance"))) redirect("/admin/dashboard");
  const sports = await listSports(me.orgId);
  return (
    <div className="animate-fade-up max-w-4xl space-y-5">
      <PageHeader title={t("sports.title")} description={t("sports.description")} />
      <SportsManager sports={sports} canEdit={me.roles.includes("admin")} />
    </div>
  );
}
