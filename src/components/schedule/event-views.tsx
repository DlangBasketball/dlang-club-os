import Link from "next/link";
import { AlertTriangle, MapPin } from "lucide-react";
import { Badge, Card, EmptyState } from "@/components/ui";
import type { EventItem } from "@/lib/sportsops/data";
import { eventTitle, eventTone, eventTypeLabel } from "@/lib/sportsops/labels";
import { dayKey, fmtDayKey, fmtTime, weekDays } from "@/lib/sportsops/time";
import { cn } from "@/lib/utils";

function where(e: EventItem) {
  if (e.venueName) return e.spaceName ? `${e.venueName} · ${e.spaceName}` : e.venueName;
  return e.locationText ?? "Location TBC";
}

function ConflictNote({ e, all }: { e: EventItem; all: Map<string, EventItem> }) {
  if (!e.conflictsWith.length) return null;
  const other = e.conflictsWith.map((id) => all.get(id)).filter(Boolean) as EventItem[];
  const names = other.map((o) => o.teamName ?? eventTitle(o)).slice(0, 2).join(", ");
  return (
    <p className="mt-1 flex items-start gap-1 text-[11px] leading-tight text-warning">
      <AlertTriangle className="mt-px h-3 w-3 shrink-0" />
      <span>Clash at {e.venueName}{names ? ` with ${names}` : ""}</span>
    </p>
  );
}

function EventChip({ e, href, all }: { e: EventItem; href: (id: string) => string; all: Map<string, EventItem> }) {
  return (
    <Link href={href(e.id)} className={cn(
      "block rounded-md border border-line bg-surface-elevated p-2 text-xs transition-colors hover:border-maroon",
      e.conflictsWith.length > 0 && "border-warning",
      e.status === "cancelled" && "opacity-50 line-through",
    )} style={e.teamColor ? { borderLeft: `3px solid ${e.teamColor}` } : undefined}>
      <div className="font-mono text-[11px] text-ink-3">{fmtTime(e.startsAt)}–{fmtTime(e.endsAt)}</div>
      <div className="mt-0.5 font-medium text-ink">{eventTitle({ ...e, home_away: e.homeAway })}</div>
      <div className="mt-0.5 truncate text-ink-3">{where(e)}</div>
      <ConflictNote e={e} all={all} />
    </Link>
  );
}

export function WeekView({ start, events, href }: { start: string; events: EventItem[]; href: (id: string) => string }) {
  const days = weekDays(start);
  const all = new Map(events.map((e) => [e.id, e]));
  const today = dayKey(new Date());
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-7">
      {days.map((d) => {
        const list = events.filter((e) => dayKey(e.startsAt) === d);
        return (
          <Card key={d} className={cn("min-h-[140px] p-2", d === today && "border-maroon")}>
            <div className={cn("mb-2 px-1 text-xs font-medium uppercase tracking-wide", d === today ? "text-maroon" : "text-ink-3")}>{fmtDayKey(d)}</div>
            <div className="space-y-2">
              {list.length === 0 && <p className="px-1 text-xs text-ink-4">—</p>}
              {list.map((e) => <EventChip key={e.id} e={e} href={href} all={all} />)}
            </div>
          </Card>
        );
      })}
    </div>
  );
}

export function EventList({ events, href, rsvp, empty }: {
  events: EventItem[]; href: (id: string) => string; rsvp?: Map<string, { going: number; maybe: number; not_going: number }>; empty?: React.ReactNode;
}) {
  if (!events.length) return <>{empty ?? <EmptyState title="Nothing scheduled" description="No events in this period." />}</>;
  const all = new Map(events.map((e) => [e.id, e]));
  const groups = new Map<string, EventItem[]>();
  for (const e of events) {
    const k = dayKey(e.startsAt);
    groups.set(k, [...(groups.get(k) ?? []), e]);
  }
  return (
    <div className="space-y-5">
      {Array.from(groups.entries()).map(([day, list]) => (
        <section key={day}>
          <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-ink-3">{fmtDayKey(day)}</h3>
          <div className="space-y-2">
            {list.map((e) => {
              const c = rsvp?.get(e.id);
              return (
                <Link key={e.id} href={href(e.id)} className="block">
                  <Card className={cn("flex flex-wrap items-center gap-3 p-4 transition-colors hover:border-maroon", e.conflictsWith.length > 0 && "border-warning")}
                    style={e.teamColor ? { borderLeft: `3px solid ${e.teamColor}` } : undefined}>
                    <div className="w-24 shrink-0 font-mono text-sm text-ink-2">{fmtTime(e.startsAt)}–{fmtTime(e.endsAt)}</div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium text-ink">{eventTitle({ ...e, home_away: e.homeAway })}</span>
                        <Badge tone={eventTone(e.type)}>{eventTypeLabel(e.type)}</Badge>
                        {e.status !== "scheduled" && <Badge tone={e.status === "cancelled" ? "danger" : e.status === "postponed" ? "warning" : "neutral"}>{e.status}</Badge>}
                        {e.result && <Badge tone={e.result.outcome === "win" ? "success" : e.result.outcome === "loss" ? "danger" : "neutral"}>{e.result.scoreFor}–{e.result.scoreAgainst}</Badge>}
                      </div>
                      <div className="mt-0.5 flex items-center gap-1 text-xs text-ink-3"><MapPin className="h-3 w-3" />{where(e)}</div>
                      <ConflictNote e={e} all={all} />
                    </div>
                    {c && <div className="text-xs text-ink-3 tnum"><span className="text-success">{c.going} going</span> · {c.maybe} maybe · {c.not_going} out</div>}
                  </Card>
                </Link>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
