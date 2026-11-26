import { PageHeader, Card, CardBody } from "@/components/ui";
import { ClubEventForm } from "@/components/calendar/club-event-form";
import { requireRole } from "@/lib/auth/get-user";
import { getI18n } from "@/lib/i18n/server";
import { staffDb } from "@/lib/staff/db";
import { zonedDayKey } from "@/lib/staff/hours";

export async function generateMetadata() {
  const { t } = await getI18n();
  return { title: t("staff.clubEvents.newTitle") };
}

export default async function NewClubEventPage({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  const me = await requireRole(["admin"]);
  const [{ t, f }, sp] = await Promise.all([getI18n(), searchParams]);
  const db = await staffDb();
  const [venues, teams] = await Promise.all([
    db.from("venues").select("id,name").eq("org_id", me.orgId as string).eq("is_active", true).order("name"),
    db.from("teams").select("id,name").eq("org_id", me.orgId as string).eq("is_active", true).order("name"),
  ]);
  const date = sp.date && /^\d{4}-\d{2}-\d{2}$/.test(sp.date) ? sp.date : zonedDayKey(new Date(), f.timeZone);
  return (
    <div className="animate-fade-up space-y-5">
      <PageHeader title={t("staff.clubEvents.newTitle")} eyebrow={t("staff.calendar.title")} />
      <Card><CardBody className="py-5">
        <ClubEventForm
          venues={venues.data ?? []}
          teams={teams.data ?? []}
          initial={{
            id: null, title: "", type: "other", allDay: false, startDate: date, startTime: "18:00", endDate: date, endTime: "20:00",
            venueId: "", teamId: "", location: "", audience: "everyone", description: "", url: "",
          }}
        />
      </CardBody></Card>
    </div>
  );
}
