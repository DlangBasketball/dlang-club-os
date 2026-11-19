import Link from "next/link";
import { CalendarDays, ChevronLeft, ChevronRight, MapPin } from "lucide-react";
import { Button, Card, CardBody, EmptyState } from "@/components/ui";
import { selectClass } from "@/components/teams/fields";
import type { Translator } from "@/lib/i18n/translator";
import type { Formatter } from "@/lib/format";
import {
  CALENDAR_KINDS,
  CALENDAR_VIEWS,
  groupByDay,
  monthGrid,
  stepAnchor,
  type CalendarItem,
  type CalendarKind,
  type CalendarView,
} from "@/lib/calendar/aggregate";
import { isoWeekdayName, zonedDayKey } from "@/lib/staff/hours";
import { cn } from "@/lib/utils";

/**
 * Month / week / day / list rendering of calendar items (server component).
 * Navigation and filters are plain links / GET forms, so it works without JS.
 */
export type CalendarQuery = {
  view: CalendarView;
  date: string;
  kinds: CalendarKind[];
  team: string | null;
  coach: string | null;
  venue: string | null;
};

const KIND_BAR: Record<CalendarKind, string> = {
  team_event: "border-l-brand-primary",
  session: "border-l-info",
  camp: "border-l-brand-accent",
  booking: "border-l-success",
  shift: "border-l-warning",
  club_event: "border-l-border-strong",
};

export function calendarHref(basePath: string, q: CalendarQuery, over: Partial<CalendarQuery> = {}): string {
  const m = { ...q, ...over };
  const p = new URLSearchParams();
  p.set("view", m.view);
  p.set("date", m.date);
  for (const k of m.kinds) p.append("kind", k);
  if (m.team) p.set("team", m.team);
  if (m.coach) p.set("coach", m.coach);
  if (m.venue) p.set("venue", m.venue);
  return `${basePath}?${p.toString()}`;
}

function timeLabel(i: CalendarItem, f: Formatter, t: Translator): string {
  return i.allDay ? t("staff.calendar.allDay") : `${f.time(i.start)}–${f.time(i.end)}`;
}

function Chip({ item, f, t, compact }: { item: CalendarItem; f: Formatter; t: Translator; compact?: boolean }) {
  const body = (
    <div
      className={cn(
        "rounded border border-border-soft border-l-[3px] bg-surface-elevated px-2 py-1 text-left",
        KIND_BAR[item.kind],
        item.status === "cancelled" && "line-through opacity-60",
        item.href && "transition-colors hover:border-border-strong",
      )}
      style={item.color ? { borderLeftColor: item.color } : undefined}
      title={item.title}
    >
      <div className={cn("truncate text-text", compact ? "text-[11px]" : "text-sm font-medium")}>
        {!compact || item.allDay ? null : <span className="tnum mr-1 text-text-muted">{f.time(item.start)}</span>}
        {item.title}
      </div>
      {!compact && (
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-text-muted">
          <span className="tnum">{timeLabel(item, f, t)}</span>
          <span>{t.dynamic(`staff.calendar.kinds.${item.kind}`)}</span>
          {item.location && <span className="flex items-center gap-1"><MapPin className="h-3 w-3" />{item.location}</span>}
          {item.status === "cancelled" && <span className="text-danger">{t("staff.calendar.cancelled")}</span>}
          {item.status === "draft" && <span>{t("staff.calendar.draft")}</span>}
        </div>
      )}
      {!compact && item.description && <p className="mt-1 line-clamp-2 whitespace-pre-wrap text-xs text-text-muted">{item.description}</p>}
    </div>
  );
  return item.href ? <Link href={item.href} className="block">{body}</Link> : body;
}

export function CalendarToolbar({
  basePath, q, from, to, f, t,
}: { basePath: string; q: CalendarQuery; from: string; to: string; f: Formatter; t: Translator }) {
  const label = q.view === "month"
    ? new Intl.DateTimeFormat(f.locale, { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${q.date.slice(0, 7)}-15T12:00:00Z`))
    : from === to ? f.date(from, { weekday: true }) : `${f.date(from)} – ${f.date(to)}`;
  const today = zonedDayKey(new Date(), f.timeZone);
  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="flex items-center gap-1">
        <Link href={calendarHref(basePath, q, { date: stepAnchor(q.view, q.date, -1) })} aria-label={t("staff.calendar.previous")}>
          <Button size="icon" variant="secondary" className="h-9 w-9"><ChevronLeft className="h-4 w-4" /></Button>
        </Link>
        <Link href={calendarHref(basePath, q, { date: today })}><Button size="sm" variant="secondary" className="h-9">{t("staff.calendar.today")}</Button></Link>
        <Link href={calendarHref(basePath, q, { date: stepAnchor(q.view, q.date, 1) })} aria-label={t("staff.calendar.next")}>
          <Button size="icon" variant="secondary" className="h-9 w-9"><ChevronRight className="h-4 w-4" /></Button>
        </Link>
      </div>
      <span className="text-sm font-medium capitalize text-text">{label}</span>
      <div className="ml-auto flex rounded border border-border p-0.5 text-xs">
        {CALENDAR_VIEWS.map((v) => (
          <Link key={v} href={calendarHref(basePath, q, { view: v })}
            className={cn("rounded px-3 py-1.5", q.view === v ? "bg-brand-primary text-on-brand" : "text-text-muted hover:text-text")}>
            {t.dynamic(`staff.calendar.views.${v}`)}
          </Link>
        ))}
      </div>
    </div>
  );
}

export function CalendarFilters({
  q, t, options,
}: {
  q: CalendarQuery;
  t: Translator;
  options?: { teams?: { id: string; name: string }[]; coaches?: { id: string; name: string }[]; venues?: { id: string; name: string }[]; kinds?: readonly CalendarKind[] };
}) {
  const kinds = options?.kinds ?? CALENDAR_KINDS;
  return (
    <form method="get" className="flex flex-wrap items-end gap-2" aria-label={t("staff.calendar.filters")}>
      <input type="hidden" name="view" value={q.view} />
      <input type="hidden" name="date" value={q.date} />
      <select name="kind" defaultValue={q.kinds[0] ?? ""} className={`${selectClass} h-9 w-44`} aria-label={t("staff.calendar.allTypes")}>
        <option value="">{t("staff.calendar.allTypes")}</option>
        {kinds.map((k) => <option key={k} value={k}>{t.dynamic(`staff.calendar.kinds.${k}`)}</option>)}
      </select>
      {options?.teams && (
        <select name="team" defaultValue={q.team ?? ""} className={`${selectClass} h-9 w-44`} aria-label={t("staff.calendar.allTeams")}>
          <option value="">{t("staff.calendar.allTeams")}</option>
          {options.teams.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
        </select>
      )}
      {options?.coaches && (
        <select name="coach" defaultValue={q.coach ?? ""} className={`${selectClass} h-9 w-44`} aria-label={t("staff.calendar.allCoaches")}>
          <option value="">{t("staff.calendar.allCoaches")}</option>
          {options.coaches.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
        </select>
      )}
      {options?.venues && (
        <select name="venue" defaultValue={q.venue ?? ""} className={`${selectClass} h-9 w-44`} aria-label={t("staff.calendar.allVenues")}>
          <option value="">{t("staff.calendar.allVenues")}</option>
          {options.venues.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
        </select>
      )}
      <Button size="sm" variant="secondary" type="submit" className="h-9">{t("staff.calendar.apply")}</Button>
    </form>
  );
}

function weekdayHeaders(locale: string, firstDow: 0 | 1): string[] {
  const order = firstDow === 1 ? [1, 2, 3, 4, 5, 6, 7] : [7, 1, 2, 3, 4, 5, 6];
  return order.map((iso) => isoWeekdayName(locale, iso, "short"));
}

export function CalendarBody({
  items, q, from, to, basePath, f, t, firstDow,
}: { items: CalendarItem[]; q: CalendarQuery; from: string; to: string; basePath: string; f: Formatter; t: Translator; firstDow: 0 | 1 }) {
  const days = groupByDay(items, from, to, f.timeZone);
  const today = zonedDayKey(new Date(), f.timeZone);

  if (q.view === "month") {
    const weeks = monthGrid(q.date, firstDow);
    const month = q.date.slice(0, 7);
    return (
      <div className="overflow-x-auto">
        <div className="grid min-w-[640px] grid-cols-7 gap-px overflow-hidden rounded-md border border-border bg-border">
          {weekdayHeaders(f.locale, firstDow).map((name) => (
            <div key={`h-${name}`} className="bg-surface px-2 py-1.5 text-[11px] uppercase tracking-[0.12em] text-text-muted">{name}</div>
          ))}
          {weeks.flat().map((d) => {
            const list = days.get(d) ?? [];
            return (
              <div key={d} className={cn("min-h-[104px] bg-surface p-1.5", d.slice(0, 7) !== month && "opacity-50")}>
                <Link href={calendarHref(basePath, q, { view: "day", date: d })}
                  className={cn("mb-1 inline-flex h-6 min-w-6 items-center justify-center rounded px-1 text-xs tnum", d === today ? "bg-brand-primary text-on-brand" : "text-text-muted hover:text-text")}>
                  {Number(d.slice(8))}
                </Link>
                <div className="space-y-1">
                  {list.slice(0, 3).map((i) => <Chip key={`${d}-${i.id}`} item={i} f={f} t={t} compact />)}
                  {list.length > 3 && (
                    <Link href={calendarHref(basePath, q, { view: "day", date: d })} className="block text-[11px] text-text-muted hover:text-text">
                      {t("staff.calendar.more", { count: list.length - 3 })}
                    </Link>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  const entries = Array.from(days.entries()).filter(([, list]) => q.view !== "list" || list.length > 0);
  if (entries.every(([, list]) => list.length === 0)) {
    return <EmptyState icon={<CalendarDays />} title={t("staff.calendar.empty")} />;
  }
  if (q.view === "week") {
    return (
      <div className="grid gap-3 lg:grid-cols-7">
        {entries.map(([d, list]) => (
          <section key={d} className="min-w-0">
            <Link href={calendarHref(basePath, q, { view: "day", date: d })}
              className={cn("mb-2 block text-xs font-medium uppercase tracking-wide", d === today ? "text-brand-primary" : "text-text-muted")}>
              {f.date(d, { weekday: true })}
            </Link>
            <div className="space-y-1.5">{list.map((i) => <Chip key={`${d}-${i.id}`} item={i} f={f} t={t} />)}</div>
          </section>
        ))}
      </div>
    );
  }
  return (
    <div className="space-y-5">
      {entries.map(([d, list]) => (
        <section key={d}>
          <h2 className={cn("mb-2 text-xs font-medium uppercase tracking-wide", d === today ? "text-brand-primary" : "text-text-muted")}>{f.date(d, { weekday: true })}</h2>
          {list.length === 0 ? (
            <Card><CardBody className="py-3 text-sm text-text-muted">{t("staff.calendar.empty")}</CardBody></Card>
          ) : (
            <div className="space-y-1.5">{list.map((i) => <Chip key={`${d}-${i.id}`} item={i} f={f} t={t} />)}</div>
          )}
        </section>
      ))}
    </div>
  );
}
