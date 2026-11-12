"use client";
import * as React from "react";
import { MapPin, Users } from "lucide-react";
import { Avatar, Badge } from "@/components/ui";
import { useFormat, useT } from "@/lib/i18n/client";
import {
  generateSlots, groupByLocalDate, localToday, mergeAnyCoach, participantsNeeded, type Slot,
} from "@/lib/training/slots";
import type { AvailabilityData, TrainingCoach, TrainingService, TrainingSettings, TrainingVenue } from "@/lib/training/data";
import type { SlotBusy } from "@/lib/training/slots";

export const ANY_COACH = "any";
export { venueLine, weekdayName } from "@/lib/training/format";

export function slotsFor(opts: {
  service: TrainingService; coachId: string; availability: AvailabilityData; busy: SlotBusy[]; venues: TrainingVenue[];
  settings: TrainingSettings; timeZone: string; now?: Date;
}): Slot[] {
  const now = opts.now ?? new Date();
  const coachIds = opts.coachId === ANY_COACH ? opts.service.coachIds : opts.service.coachIds.filter((c) => c === opts.coachId);
  const slots = generateSlots({
    timeZone: opts.timeZone,
    fromDate: localToday(now, opts.timeZone),
    days: Math.max(1, opts.settings.horizonDays),
    service: { id: opts.service.id, durationMin: opts.service.durationMin, maxParticipants: opts.service.maxParticipants, minParticipants: opts.service.minParticipants, venueId: opts.service.venueId },
    coachIds,
    templates: opts.availability.templates.filter((t) => t.isActive !== false),
    windows: opts.availability.windows.filter((w) => !w.isBooked),
    blackouts: opts.availability.blackouts,
    busy: opts.busy,
    venueHours: Object.fromEntries(opts.venues.map((v) => [v.id, v.openingHours])),
    stepMin: opts.settings.slotStepMin,
    now,
    leadMinutes: opts.settings.leadHours * 60,
  });
  return opts.coachId === ANY_COACH ? mergeAnyCoach(slots) : slots;
}

/** Date tabs + time buttons for the bookable slots of one service. */
export function SlotPicker({
  service, slots, coaches, venues, selected, onSelect, coachPhotos = {},
}: {
  service: TrainingService; slots: Slot[]; coaches: TrainingCoach[]; venues: TrainingVenue[];
  selected: Slot | null; onSelect: (s: Slot) => void; coachPhotos?: Record<string, string>;
}) {
  const t = useT();
  const f = useFormat();
  const days = React.useMemo(() => groupByLocalDate(slots, f.timeZone), [slots, f.timeZone]);
  const [day, setDay] = React.useState<string | null>(null);
  const active = days.find((d) => d.date === day) ?? days[0] ?? null;
  const coachName = (id: string) => coaches.find((c) => c.id === id)?.name ?? "";
  const venue = (id: string | null) => venues.find((v) => v.id === id);

  if (!slots.length) return <p className="text-sm text-ink-3">{t("training.book.noSlots")}</p>;
  return (
    <div className="space-y-3">
      <div className="flex gap-2 overflow-x-auto pb-1" role="tablist" aria-label={t("training.book.pickDate")}>
        {days.map((d) => (
          <button key={d.date} type="button" role="tab" aria-selected={active?.date === d.date} onClick={() => setDay(d.date)}
            className={`shrink-0 rounded-lg border px-3 py-2 text-left text-xs ${active?.date === d.date ? "border-maroon bg-maroon/10 text-ink" : "border-line text-ink-3 hover:text-ink"}`}>
            <div className="font-medium">{f.date(`${d.date}T12:00:00Z`, { weekday: true, style: "medium" })}</div>
            <div className="text-[11px] text-ink-4">{t("training.book.slotCount", { count: d.slots.length })}</div>
          </button>
        ))}
      </div>
      {active && (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {active.slots.map((s) => {
            const needs = service.sessionType === "group" ? participantsNeeded(service.minParticipants, s.booked) : 0;
            const v = venue(s.venueId);
            const isSel = selected?.start === s.start && selected?.coachId === s.coachId;
            return (
              <button key={`${s.coachId}-${s.start}`} type="button" onClick={() => onSelect(s)}
                className={`flex items-center justify-between gap-3 rounded-xl border p-3 text-left transition active:scale-[0.99] ${isSel ? "border-maroon bg-maroon/5" : "border-line hover:border-maroon/40"}`}>
                <div className="flex min-w-0 items-center gap-3">
                  <Avatar name={coachName(s.coachId)} src={coachPhotos[s.coachId] ?? null} size="sm" />
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-ink tnum">{f.time(s.start)} – {f.time(s.end)}</div>
                    <div className="truncate text-xs text-ink-3">{coachName(s.coachId)}</div>
                    {v && <div className="flex items-center gap-1 truncate text-[11px] text-ink-4"><MapPin className="h-3 w-3" />{v.name}</div>}
                  </div>
                </div>
                {service.sessionType === "group" && (
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <Badge tone="neutral"><Users className="h-3 w-3" /> {t("training.book.spotsLeft", { count: s.spotsLeft })}</Badge>
                    {needs > 0 && <span className="text-[11px] text-warning">{t("training.book.needsMore", { count: needs })}</span>}
                  </div>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
