"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Coffee, LogIn, LogOut, MapPin, Play } from "lucide-react";
import { Button, Label, Select, Input } from "@/components/ui";
import { useFormat, useT } from "@/lib/i18n/client";
import { clockIn, clockOut, setBreak } from "@/lib/actions/staff-time";
import { entryMinutes, formatMinutes } from "@/lib/staff/hours";
import { cn } from "@/lib/utils";

export type ClockWidgetEntry = {
  clockInAt: string;
  breaks: { startedAt: string; endedAt: string | null }[];
  linkedTitle: string | null;
  venueName: string | null;
};

const GEO_PREF = "dlang.clock.geo";

function readGeoPref(): boolean {
  try {
    return window.localStorage.getItem(GEO_PREF) === "1";
  } catch {
    return false;
  }
}
function writeGeoPref(on: boolean) {
  try {
    window.localStorage.setItem(GEO_PREF, on ? "1" : "0");
  } catch {
    /* per-device convenience only */
  }
}

/** Ask the device for a position once; resolves null when refused or unavailable. */
function currentPosition(): Promise<{ lat: number; lng: number; accuracy: number | null } | null> {
  if (typeof navigator === "undefined" || !navigator.geolocation) return Promise.resolve(null);
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: Number.isFinite(p.coords.accuracy) ? p.coords.accuracy : null }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 },
    );
  });
}

/**
 * Big clock-in / clock-out control for phones. The position is requested only
 * when the employee ticks the location check (remembered on this device),
 * sent once to the server to compare with the venue, and never stored.
 */
export function ClockWidget({
  open,
  venues,
  defaultVenueId,
  compact = false,
}: {
  open: ClockWidgetEntry | null;
  venues: { id: string; name: string; hasGeo: boolean }[];
  defaultVenueId?: string | null;
  compact?: boolean;
}) {
  const t = useT();
  const f = useFormat();
  const router = useRouter();
  const [busy, setBusy] = React.useState<null | "in" | "out" | "break">(null);
  const [msg, setMsg] = React.useState<{ ok: boolean; text: string } | null>(null);
  const [venueId, setVenueId] = React.useState(defaultVenueId ?? "");
  const [note, setNote] = React.useState("");
  const [geo, setGeo] = React.useState(false);
  const [now, setNow] = React.useState(() => new Date());

  React.useEffect(() => setGeo(readGeoPref()), []);
  React.useEffect(() => {
    if (!open) return;
    const id = window.setInterval(() => setNow(new Date()), 30000);
    return () => window.clearInterval(id);
  }, [open]);

  const openBreak = open?.breaks.find((b) => !b.endedAt) ?? null;
  const worked = open ? entryMinutes({ clockInAt: open.clockInAt, clockOutAt: null, breaks: open.breaks }, { now }).workedMinutes : 0;
  const selectedVenue = venues.find((v) => v.id === venueId);

  async function doClockIn() {
    setBusy("in");
    setMsg(null);
    let position: { lat: number; lng: number; accuracy: number | null } | null = null;
    if (geo && selectedVenue?.hasGeo) {
      setMsg({ ok: true, text: t("staff.clock.geoChecking") });
      position = await currentPosition();
      if (!position) setMsg({ ok: false, text: t("staff.clock.geoDenied") });
    }
    const res = await clockIn({ venueId: venueId || null, note, position });
    setBusy(null);
    if (res.ok) {
      setNote("");
      setMsg({ ok: true, text: res.message ?? "" });
      router.refresh();
    } else setMsg({ ok: false, text: res.error });
  }

  async function doClockOut() {
    setBusy("out");
    setMsg(null);
    const res = await clockOut(note);
    setBusy(null);
    if (res.ok) {
      setNote("");
      setMsg({ ok: true, text: res.message ?? "" });
      router.refresh();
    } else setMsg({ ok: false, text: res.error });
  }

  async function toggleBreak() {
    setBusy("break");
    setMsg(null);
    const res = await setBreak(!openBreak);
    setBusy(null);
    if (res.ok) {
      setMsg({ ok: true, text: res.message ?? "" });
      router.refresh();
    } else setMsg({ ok: false, text: res.error });
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className={cn("text-sm font-medium", open ? (openBreak ? "text-warning" : "text-success") : "text-text-muted")}>
            {open
              ? openBreak
                ? t("staff.clock.statusBreak", { time: f.time(openBreak.startedAt) })
                : t("staff.clock.statusOn", { time: f.time(open.clockInAt) })
              : t("staff.clock.statusOff")}
          </div>
          {open?.linkedTitle && <div className="mt-0.5 text-xs text-text-muted">{t("staff.clock.linkedTo", { title: open.linkedTitle })}</div>}
          {open?.venueName && (
            <div className="mt-0.5 flex items-center gap-1 text-xs text-text-muted"><MapPin className="h-3 w-3" />{open.venueName}</div>
          )}
        </div>
        {open && (
          <div className="text-right">
            <div className="text-[11px] uppercase tracking-[0.12em] text-text-muted">{t("staff.clock.workedToday")}</div>
            <div className="tnum font-display text-2xl text-text">{formatMinutes(worked)}</div>
          </div>
        )}
      </div>

      {!open && !compact && venues.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label htmlFor="clock-venue">{t("staff.clock.venue")}</Label>
            <Select id="clock-venue" value={venueId} onChange={(e) => setVenueId(e.target.value)}>
              <option value="">{t("staff.clock.venueNone")}</option>
              {venues.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
            </Select>
          </div>
          <div>
            <Label htmlFor="clock-note">{t("staff.clock.note")}</Label>
            <Input id="clock-note" value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} />
          </div>
        </div>
      )}
      {!open && !compact && selectedVenue?.hasGeo && (
        <label className="flex items-start gap-2 text-sm text-text-muted">
          <input type="checkbox" className="mt-1" checked={geo} onChange={(e) => { setGeo(e.target.checked); writeGeoPref(e.target.checked); }} />
          <span>{t("staff.clock.geoConsent")}</span>
        </label>
      )}

      <div className="flex flex-col gap-2 sm:flex-row">
        {open ? (
          <>
            <Button type="button" size="lg" variant="danger" className="h-16 flex-1 text-lg" loading={busy === "out"} disabled={!!busy} onClick={doClockOut}>
              <LogOut className="h-5 w-5" /> {t("staff.clock.clockOut")}
            </Button>
            <Button type="button" size="lg" variant="secondary" className="h-16 sm:w-48" loading={busy === "break"} disabled={!!busy} onClick={toggleBreak}>
              {openBreak ? <Play className="h-5 w-5" /> : <Coffee className="h-5 w-5" />}
              {openBreak ? t("staff.clock.endBreak") : t("staff.clock.startBreak")}
            </Button>
          </>
        ) : (
          <Button type="button" size="lg" variant="success" className="h-16 flex-1 text-lg" loading={busy === "in"} disabled={!!busy} onClick={doClockIn}>
            <LogIn className="h-5 w-5" /> {t("staff.clock.clockIn")}
          </Button>
        )}
      </div>
      {msg && msg.text && <p role={msg.ok ? "status" : "alert"} className={msg.ok ? "text-sm text-success" : "text-sm text-danger"}>{msg.text}</p>}
    </div>
  );
}
