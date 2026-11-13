import { AlertTriangle, CalendarClock, Timer } from "lucide-react";
import { PageHeader, Card, CardHeader, CardTitle, CardBody, EmptyState, ErrorState } from "@/components/ui";
import { ClockWidget } from "@/components/staff/clock-widget";
import { EntryList } from "@/components/staff/entry-list";
import { getSessionUser } from "@/lib/auth/get-user";
import { getI18n } from "@/lib/i18n/server";
import { getMyClockState, listShiftTemplates, listVenuesGeo } from "@/lib/staff/data";
import { expandShiftTemplates, formatMinutes, periodRange, totalWorkedMinutes, zonedDayKey } from "@/lib/staff/hours";

export async function generateMetadata() {
  const { t } = await getI18n();
  return { title: t("staff.clock.title") };
}

export default async function CoachClockPage() {
  const [{ t, f }, me] = await Promise.all([getI18n(), getSessionUser()]);
  if (!me?.orgId) return null;
  const tz = f.timeZone;
  const today = zonedDayKey(new Date(), tz);
  const week = periodRange("week", today);
  const [state, templates, venues] = await Promise.all([
    getMyClockState(me.orgId, me.id, tz),
    listShiftTemplates(me.orgId, me.id),
    listVenuesGeo(me.orgId),
  ]);
  if (state.error !== null) {
    return (<div className="animate-fade-up"><PageHeader title={t("staff.clock.title")} /><ErrorState title={t("staff.errors.generic")} /></div>);
  }
  const planned = expandShiftTemplates(
    (templates.data ?? []).map((x) => ({ ...x, profileId: x.profileId })),
    week.from, week.to, tz,
  );
  const venueName = new Map(venues.map((v) => [v.id, v.name]));
  const todaysShift = planned.find((s) => s.dayKey === today);
  const worked = totalWorkedMinutes(state.data.recent.filter((e) => zonedDayKey(e.clockInAt, tz) >= week.from));

  return (
    <div className="animate-fade-up space-y-5">
      <PageHeader title={t("staff.clock.title")} description={t("staff.clock.description")} />

      {state.data.missed.map((m) => (
        <div key={m.id} role="alert" className="flex items-start gap-3 rounded-md border border-warning/30 bg-warning-soft p-4 text-sm text-text">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
          <div>
            <div className="font-medium">{t("staff.clock.missedTitle")}</div>
            <div className="text-text-muted">{t("staff.clock.missedBody", { date: f.dateTime(m.clockInAt) })}</div>
          </div>
        </div>
      ))}

      <Card>
        <CardBody className="py-5">
          <ClockWidget
            open={state.data.open ? { clockInAt: state.data.open.clockInAt, breaks: state.data.open.breaks, linkedTitle: state.data.open.linkedTitle, venueName: state.data.open.venueName } : null}
            venues={venues.filter((v) => v.isActive).map((v) => ({ id: v.id, name: v.name, hasGeo: v.latitude !== null }))}
            defaultVenueId={todaysShift?.venueId ?? null}
          />
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><CalendarClock className="h-4 w-4" /> {t("staff.clock.planned")}</CardTitle>
          <span className="tnum text-sm text-text-muted">{t("staff.clock.weekWorked", { worked: formatMinutes(worked) })}</span>
        </CardHeader>
        <CardBody>
          {planned.length === 0 ? (
            <p className="text-sm text-text-muted">{t("staff.clock.noPlanned")}</p>
          ) : (
            <ul className="space-y-1.5 text-sm">
              {planned.map((s) => (
                <li key={`${s.templateId}-${s.dayKey}`} className="flex flex-wrap justify-between gap-2">
                  <span className="text-text">{f.date(s.start, { weekday: true })}</span>
                  <span className="tnum text-text-muted">
                    {f.time(s.start)}–{f.time(s.end)}{s.venueId && venueName.get(s.venueId) ? ` · ${venueName.get(s.venueId)}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><Timer className="h-4 w-4" /> {t("staff.clock.recent")}</CardTitle></CardHeader>
        <CardBody>
          {state.data.recent.length === 0 ? (
            <EmptyState icon={<Timer />} title={t("staff.clock.noRecent")} />
          ) : (
            <EntryList entries={state.data.recent} />
          )}
        </CardBody>
      </Card>
    </div>
  );
}
