import Link from "next/link";
import { ArrowLeft, Flag } from "lucide-react";
import { Card, CardHeader, CardTitle, PageHeader } from "@/components/ui";
import { MessagingSettingsForm, ReportQueue } from "@/components/messaging/settings";
import { requireRole } from "@/lib/auth/get-user";
import { getI18n } from "@/lib/i18n/server";
import { getMessagingSettings, getOpenReports } from "@/lib/messaging/data";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  const { t } = await getI18n();
  return { title: t("messaging.settings.title") };
}

/** Club messaging rules + moderation queue (admins). */
export default async function MessagingSettingsPage() {
  const me = await requireRole(["admin"]);
  const { t } = await getI18n();
  const [settings, reports] = await Promise.all([getMessagingSettings(me.orgId as string), getOpenReports()]);
  return (
    <div className="animate-fade-up space-y-5">
      <PageHeader
        eyebrow={<Link href="/admin/messages" className="inline-flex items-center gap-1 hover:text-text"><ArrowLeft className="h-3.5 w-3.5" /> {t("messaging.inbox.title")}</Link>}
        title={t("messaging.settings.title")}
        description={t("messaging.settings.description")}
      />
      <div className="grid gap-5 lg:grid-cols-2">
        <MessagingSettingsForm initial={settings} />
        <Card className="p-0">
          <CardHeader><CardTitle className="flex items-center gap-2"><Flag className="h-4 w-4" /> {t("messaging.moderation.reportsTitle")}</CardTitle></CardHeader>
          <ReportQueue reports={reports} />
        </Card>
      </div>
      <Card className="p-5 text-sm text-text-muted">
        <h2 className="mb-1 font-medium text-text">{t("messaging.whatsapp.title")}</h2>
        <p>{t("messaging.whatsapp.phase1")}</p>
      </Card>
    </div>
  );
}
