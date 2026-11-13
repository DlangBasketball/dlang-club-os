"use client";

import * as React from "react";
import Link from "next/link";
import { MapPin, Coffee, Link2 } from "lucide-react";
import { Badge } from "@/components/ui";
import { useFormat, useT } from "@/lib/i18n/client";
import { entryMinutes, formatMinutes } from "@/lib/staff/hours";
import type { EntryView } from "@/lib/staff/data";

const STATUS_TONE = { open: "success", closed: "neutral", missed: "danger" } as const;
const GEO_TONE = { ok: "success", too_far: "warning", unavailable: "neutral", not_checked: "neutral" } as const;

/** Time entries with worked minutes, breaks, location flag and correction note. */
export function EntryList({
  entries,
  renderActions,
}: {
  entries: EntryView[];
  renderActions?: (e: EntryView) => React.ReactNode;
}) {
  const t = useT();
  const f = useFormat();
  const now = new Date();
  return (
    <ul className="divide-y divide-border-soft">
      {entries.map((e) => {
        const m = entryMinutes(e, { now });
        return (
          <li key={e.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0 space-y-1">
              <div className="flex flex-wrap items-center gap-2 text-sm text-text">
                <span className="font-medium">{f.date(e.clockInAt, { weekday: true })}</span>
                <span className="tnum text-text-muted">
                  {f.time(e.clockInAt)} – {e.clockOutAt ? f.time(e.clockOutAt) : "…"}
                </span>
                <Badge tone={STATUS_TONE[e.status]}>{t.dynamic(`staff.clock.status.${e.status}`)}</Badge>
                {e.geoStatus !== "not_checked" && <Badge tone={GEO_TONE[e.geoStatus]}><MapPin className="h-3 w-3" /> {t.dynamic(`staff.clock.geo.${e.geoStatus}`)}</Badge>}
                {e.source === "admin" && <Badge tone="info">{t("staff.clock.source.admin")}</Badge>}
              </div>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-text-muted">
                {e.venueName && <span className="flex items-center gap-1"><MapPin className="h-3 w-3" />{e.venueName}</span>}
                {e.linkedTitle && (
                  <span className="flex items-center gap-1">
                    <Link2 className="h-3 w-3" />
                    {e.linkedHref ? <Link href={e.linkedHref} className="hover:text-text hover:underline">{e.linkedTitle}</Link> : e.linkedTitle}
                  </span>
                )}
                {e.breaks.length > 0 && (
                  <span className="flex items-center gap-1">
                    <Coffee className="h-3 w-3" />
                    {e.breaks.map((b) => `${f.time(b.startedAt)}–${b.endedAt ? f.time(b.endedAt) : "…"}`).join(", ")}
                  </span>
                )}
              </div>
              {e.correctedAt && (
                <div className="text-xs text-text-muted">
                  {t("staff.clock.corrected")}: {e.correctionReason}
                </div>
              )}
              {e.note && <div className="text-xs text-text-muted">{e.note}</div>}
            </div>
            <div className="flex items-center gap-3 sm:flex-col sm:items-end">
              <div className="tnum font-display text-lg text-text">{e.status === "missed" ? "—" : formatMinutes(m.workedMinutes)}</div>
              {m.breakMinutes > 0 && <div className="tnum text-xs text-text-muted">{t("staff.clock.breaks")}: {formatMinutes(m.breakMinutes)}</div>}
              {renderActions?.(e)}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
