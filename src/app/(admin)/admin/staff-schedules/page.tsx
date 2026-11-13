import Link from "next/link";
import { Timer } from "lucide-react";
import { PageHeader, Card, CardHeader, CardTitle, CardBody, Button, ErrorState } from "@/components/ui";
import { ShiftTemplates, VenueGeofences } from "@/components/staff/schedule-forms";
import { requireRole } from "@/lib/auth/get-user";
import { getI18n } from "@/lib/i18n/server";
import { listEmployees, listShiftTemplates, listVenuesGeo } from "@/lib/staff/data";

export async function generateMetadata() {
  const { t } = await getI18n();
  return { title: t("staff.schedules.title") };
}

export default async function StaffSchedulesPage() {
  const me = await requireRole(["admin"]);
  const orgId = me.orgId as string;
  const [{ t, f }, employees, templates, venues] = await Promise.all([getI18n(), listEmployees(orgId), listShiftTemplates(orgId), listVenuesGeo(orgId)]);
  if (employees.error !== null || templates.error !== null) {
    return <div className="animate-fade-up"><PageHeader title={t("staff.schedules.title")} /><ErrorState title={t("staff.errors.generic")} /></div>;
  }
  const active = venues.filter((v) => v.isActive);
  return (
    <div className="animate-fade-up space-y-5">
      <PageHeader
        title={t("staff.schedules.title")}
        description={t("staff.schedules.description")}
        actions={<Link href="/admin/timesheets"><Button size="sm" variant="secondary"><Timer className="h-4 w-4" /> {t("staff.timesheets.title")}</Button></Link>}
      />
      <Card>
        <CardBody className="py-5">
          <ShiftTemplates
            templates={templates.data}
            employees={employees.data.map((e) => ({ profileId: e.profileId, name: e.name }))}
            venues={active.map((v) => ({ id: v.id, name: v.name }))}
            intlLocale={f.locale}
          />
        </CardBody>
      </Card>
      {active.length > 0 && (
        <Card>
          <CardHeader><CardTitle>{t("staff.schedules.geofence.title")}</CardTitle></CardHeader>
          <CardBody className="space-y-3">
            <p className="text-sm text-text-muted">{t("staff.schedules.geofence.description")}</p>
            <VenueGeofences venues={active} />
          </CardBody>
        </Card>
      )}
    </div>
  );
}
