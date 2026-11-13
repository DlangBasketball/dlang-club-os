import { notFound } from "next/navigation";
import { PageHeader, Card, CardBody } from "@/components/ui";
import { ClubEventForm } from "@/components/calendar/club-event-form";
import { requireRole } from "@/lib/auth/get-user";
import { getI18n } from "@/lib/i18n/server";
import { staffDb } from "@/lib/staff/db";
import { zonedParts } from "@/lib/staff/hours";

export async function generateMetadata() {
  const { t } = await getI18n();
  return { title: t("staff.clubEvents.editTitle") };
}

export default async function EditClubEventPage({ params }: { params: Promise<{ id: string }> }) {
  const me = await requireRole(["admin"]);
  const [{ t, f }, { id }] = await Promise.all([getI18n(), params]);
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const db = await staffDb();
  const orgId = me.orgId as string;
  const [{ data: ev }, venues, teams] = await Promise.all([
    db.from("club_events").select("*").eq("org_id", orgId).eq("id", id).maybeSingle(),
    db.from("venues").select("id,name").eq("org_id", orgId).eq("is_active", true).order("name"),
    db.from("teams").select("id,name").eq("org_id", orgId).eq("is_active", true).order("name"),
  ]);
  if (!ev) notFound();
  const s = zonedParts(ev.starts_at, f.timeZone);
  const e = zonedParts(ev.ends_at, f.timeZone);
  return (
    <div className="animate-fade-up space-y-5">
      <PageHeader title={t("staff.clubEvents.editTitle")} eyebrow={t("staff.calendar.title")} />
      <Card><CardBody className="py-5">
        <ClubEventForm
          venues={venues.data ?? []}
          teams={teams.data ?? []}
          initial={{
            id: ev.id, title: ev.title, type: ev.type, allDay: ev.all_day, startDate: s.date, startTime: s.time, endDate: e.date, endTime: e.time,
            venueId: ev.venue_id ?? "", teamId: ev.team_id ?? "", location: ev.location ?? "", audience: ev.audience,
            description: ev.description ?? "", url: ev.url ?? "",
          }}
        />
      </CardBody></Card>
    </div>
  );
}
