import { Card, CardHeader, CardTitle, PageHeader } from "@/components/ui";
import { requireRole } from "@/lib/auth/get-user";
import { getI18n } from "@/lib/i18n/server";
import { getScopeOptions, listAlerts } from "@/lib/messaging/data";
import { dispatchDueAlerts } from "@/lib/messaging/notify";
import { AlertForm, AlertList } from "./alerts";

/** Alerts page for the office (any audience) and coaches (their teams / programmes / camps). */
export async function AlertsPage({ app }: { app: "admin" | "coach" }) {
  const me = await requireRole(app === "admin" ? ["admin"] : ["coach", "admin"]);
  const { t } = await getI18n();
  // Scheduled alerts also go out from /api/messaging/cron; sending the due
  // ones here keeps a club without a scheduler working.
  if (me.orgId) await dispatchDueAlerts(me.orgId);
  const [scopes, alerts] = await Promise.all([getScopeOptions(me), listAlerts(me)]);
  const isAdmin = app === "admin" && me.roles.includes("admin");
  return (
    <div className="animate-fade-up space-y-5">
      <PageHeader title={t("messaging.alerts.pageTitle")} description={t(isAdmin ? "messaging.alerts.descriptionAdmin" : "messaging.alerts.descriptionCoach")} />
      <div className="grid gap-5 lg:grid-cols-2">
        <AlertForm scopes={scopes} isAdmin={isAdmin} />
        <Card className="p-0">
          <CardHeader><CardTitle>{t("messaging.alerts.recent")}</CardTitle></CardHeader>
          <AlertList alerts={alerts} />
        </Card>
      </div>
    </div>
  );
}
