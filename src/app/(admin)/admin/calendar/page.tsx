import Link from "next/link";
import { Plus } from "lucide-react";
import { PageHeader, ErrorState, Button } from "@/components/ui";
import { CalendarBody, CalendarFilters, CalendarToolbar } from "@/components/calendar/calendar-view";
import { FeedLink } from "@/components/calendar/feed-link";
import { loadCalendarPage, type CalendarSearchParams } from "@/lib/calendar/page";
import { getI18n } from "@/lib/i18n/server";
import { staffDb } from "@/lib/staff/db";

export async function generateMetadata() {
  const { t } = await getI18n();
  return { title: t("staff.calendar.title") };
}

const BASE = "/admin/calendar";

export default async function AdminCalendarPage({ searchParams }: { searchParams: Promise<CalendarSearchParams> }) {
  const page = await loadCalendarPage("admin", await searchParams, "month");
  if (!page) return null;
  const { t, f, q, from, to, items, error, firstDow, hasFeed, orgId, me } = page;
  const db = await staffDb();
  const [teams, coaches, venues] = await Promise.all([
    db.from("teams").select("id,name").eq("org_id", orgId).eq("is_active", true).order("name"),
    db.from("coaches").select("id,display_name").eq("org_id", orgId).eq("is_active", true).order("display_name"),
    db.from("venues").select("id,name").eq("org_id", orgId).eq("is_active", true).order("name"),
  ]);
  const isAdmin = me.roles.includes("admin");
  return (
    <div className="animate-fade-up space-y-5">
      <PageHeader
        title={t("staff.calendar.title")}
        description={t("staff.calendar.adminDescription")}
        actions={isAdmin ? <Link href="/admin/calendar/events/new"><Button size="sm"><Plus className="h-4 w-4" /> {t("staff.calendar.newClubEvent")}</Button></Link> : undefined}
      />
      <CalendarToolbar basePath={BASE} q={q} from={from} to={to} f={f} t={t} />
      <CalendarFilters
        q={q}
        t={t}
        options={{
          teams: teams.data ?? [],
          coaches: (coaches.data ?? []).map((c) => ({ id: c.id, name: c.display_name })),
          venues: venues.data ?? [],
        }}
      />
      {error ? <ErrorState title={error} /> : <CalendarBody items={items} q={q} from={from} to={to} basePath={BASE} f={f} t={t} firstDow={firstDow} />}
      <FeedLink active={hasFeed} />
    </div>
  );
}
