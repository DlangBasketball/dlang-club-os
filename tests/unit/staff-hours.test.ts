import { describe, expect, it } from "vitest";
import {
  entryMinutes,
  expandShiftTemplates,
  formatMinutes,
  geoStatusFor,
  haversineMeters,
  isMissedClockOut,
  isOvernight,
  minutesToHours,
  periodRange,
  plannedMinutesByProfile,
  shiftPeriod,
  toCsv,
  totalWorkedMinutes,
  windowFor,
  type ShiftTemplate,
} from "@/lib/staff/hours";

const TZ = "Europe/Zurich";
const tpl = (over: Partial<ShiftTemplate>): ShiftTemplate => ({
  id: "t1", profileId: "p1", venueId: null, weekday: 1, startTime: "09:00", endTime: "17:00",
  validFrom: null, validUntil: null, isActive: true, ...over,
});

describe("entryMinutes", () => {
  it("subtracts breaks", () => {
    const r = entryMinutes({
      clockInAt: "2026-03-02T08:00:00Z", clockOutAt: "2026-03-02T16:00:00Z",
      breaks: [{ startedAt: "2026-03-02T11:00:00Z", endedAt: "2026-03-02T11:30:00Z" }],
    });
    expect(r).toEqual({ grossMinutes: 480, breakMinutes: 30, workedMinutes: 450 });
  });

  it("merges overlapping breaks and clips them to the shift", () => {
    const r = entryMinutes({
      clockInAt: "2026-03-02T08:00:00Z", clockOutAt: "2026-03-02T10:00:00Z",
      breaks: [
        { startedAt: "2026-03-02T07:30:00Z", endedAt: "2026-03-02T08:15:00Z" },
        { startedAt: "2026-03-02T09:00:00Z", endedAt: "2026-03-02T09:20:00Z" },
        { startedAt: "2026-03-02T09:10:00Z", endedAt: "2026-03-02T09:30:00Z" },
      ],
    });
    expect(r.breakMinutes).toBe(15 + 30);
    expect(r.workedMinutes).toBe(120 - 45);
  });

  it("runs an open shift and an open break until now", () => {
    const now = new Date("2026-03-02T10:00:00Z");
    const r = entryMinutes({ clockInAt: "2026-03-02T08:00:00Z", clockOutAt: null, breaks: [{ startedAt: "2026-03-02T09:45:00Z", endedAt: null }] }, { now });
    expect(r).toEqual({ grossMinutes: 120, breakMinutes: 15, workedMinutes: 105 });
  });

  it("counts an overnight shift across midnight and clips it to a day window", () => {
    const e = { clockInAt: "2026-03-03T21:00:00Z", clockOutAt: "2026-03-04T01:00:00Z" }; // 22:00-02:00 Zurich
    expect(entryMinutes(e).workedMinutes).toBe(240);
    expect(entryMinutes(e, { window: windowFor("2026-03-04", "2026-03-04", TZ) }).workedMinutes).toBe(120);
    expect(entryMinutes(e, { window: windowFor("2026-03-03", "2026-03-03", TZ) }).workedMinutes).toBe(120);
  });

  it("uses real elapsed time across DST changes", () => {
    // Spring forward 2026-03-29 02:00 -> 03:00 Zurich: 01:00-05:00 local is 3 h.
    expect(entryMinutes({ clockInAt: "2026-03-29T00:00:00Z", clockOutAt: "2026-03-29T03:00:00Z" }).workedMinutes).toBe(180);
    // Fall back 2026-10-25 03:00 -> 02:00: 01:00-05:00 local is 5 h.
    expect(entryMinutes({ clockInAt: "2026-10-24T23:00:00Z", clockOutAt: "2026-10-25T04:00:00Z" }).workedMinutes).toBe(300);
  });

  it("totals only closed shifts unless asked", () => {
    const now = new Date("2026-03-02T12:00:00Z");
    const entries = [
      { clockInAt: "2026-03-02T08:00:00Z", clockOutAt: "2026-03-02T09:00:00Z" },
      { clockInAt: "2026-03-02T10:00:00Z", clockOutAt: null },
    ];
    expect(totalWorkedMinutes(entries, { now })).toBe(60);
    expect(totalWorkedMinutes(entries, { now, includeOpen: true })).toBe(180);
  });
});

describe("planned shifts", () => {
  it("expands weekly templates with validity", () => {
    const shifts = expandShiftTemplates([tpl({ validUntil: "2026-03-09" })], "2026-03-02", "2026-03-15", TZ);
    expect(shifts.map((s) => s.dayKey)).toEqual(["2026-03-02", "2026-03-09"]);
    expect(shifts[0].start.toISOString()).toBe("2026-03-02T08:00:00.000Z");
  });

  it("handles overnight templates on their start day", () => {
    expect(isOvernight("22:00", "02:00")).toBe(true);
    expect(isOvernight("09:00", "17:00")).toBe(false);
    const [s] = expandShiftTemplates([tpl({ weekday: 2, startTime: "22:00", endTime: "02:00" })], "2026-03-02", "2026-03-08", TZ);
    expect(s.dayKey).toBe("2026-03-03");
    expect((s.end.getTime() - s.start.getTime()) / 60000).toBe(240);
  });

  it("is DST-correct (wall-clock template, real minutes)", () => {
    const sunday = tpl({ weekday: 7, startTime: "01:00", endTime: "05:00" });
    expect(plannedMinutesByProfile([sunday], "2026-03-29", "2026-03-29", TZ).get("p1")).toBe(180);
    expect(plannedMinutesByProfile([sunday], "2026-10-25", "2026-10-25", TZ).get("p1")).toBe(300);
    expect(plannedMinutesByProfile([sunday], "2026-03-22", "2026-03-22", TZ).get("p1")).toBe(240);
  });

  it("sums planned minutes per profile and skips inactive templates", () => {
    const m = plannedMinutesByProfile(
      [tpl({}), tpl({ id: "t2", weekday: 2, startTime: "22:00", endTime: "02:00" }), tpl({ id: "t3", isActive: false }), tpl({ id: "t4", profileId: "p2" })],
      "2026-03-02", "2026-03-08", TZ,
    );
    expect(m.get("p1")).toBe(480 + 240);
    expect(m.get("p2")).toBe(480);
  });
});

describe("periods, flags and formatting", () => {
  it("builds week and month periods", () => {
    expect(periodRange("week", "2026-03-04")).toEqual({ from: "2026-03-02", to: "2026-03-08" });
    expect(periodRange("month", "2026-02-14")).toEqual({ from: "2026-02-01", to: "2026-02-28" });
    expect(periodRange("month", "2026-12-31")).toEqual({ from: "2026-12-01", to: "2026-12-31" });
    expect(shiftPeriod("month", "2026-12-01", 1)).toEqual({ from: "2027-01-01", to: "2027-01-31" });
    expect(shiftPeriod("week", "2026-03-02", -1)).toEqual({ from: "2026-02-23", to: "2026-03-01" });
  });

  it("detects missed clock-outs", () => {
    const now = new Date("2026-03-03T12:00:00Z");
    expect(isMissedClockOut({ clockInAt: "2026-03-02T08:00:00Z", clockOutAt: null }, now)).toBe(true);
    expect(isMissedClockOut({ clockInAt: "2026-03-03T08:00:00Z", clockOutAt: null }, now)).toBe(false);
    expect(isMissedClockOut({ clockInAt: "2026-03-02T08:00:00Z", clockOutAt: "2026-03-02T09:00:00Z" }, now)).toBe(false);
  });

  it("formats minutes and hours", () => {
    expect(formatMinutes(450)).toBe("7:30");
    expect(formatMinutes(-15)).toBe("-0:15");
    expect(minutesToHours(450)).toBe(7.5);
    expect(minutesToHours(100)).toBe(1.67);
  });

  it("writes safe CSV", () => {
    expect(toCsv([["a", "b,c", 'say "hi"'], ["=SUM(A1)", 2, null]])).toBe('a,"b,c","say ""hi"""\r\n\'=SUM(A1),2,\r\n');
  });
});

describe("geofence", () => {
  const venue = { latitude: 46.5196, longitude: 6.6323, radiusM: 300 };
  it("measures distance", () => {
    expect(Math.round(haversineMeters({ lat: 46.5196, lng: 6.6323 }, { lat: 46.5286, lng: 6.6323 }))).toBeGreaterThan(990);
  });
  it("flags only distance", () => {
    expect(geoStatusFor(null, venue)).toBe("not_checked");
    expect(geoStatusFor({ lat: 46.5197, lng: 6.6324 }, venue)).toBe("ok");
    expect(geoStatusFor({ lat: 46.54, lng: 6.6323 }, venue)).toBe("too_far");
    expect(geoStatusFor({ lat: 46.5225, lng: 6.6323, accuracy: 100 }, venue)).toBe("ok");
    expect(geoStatusFor({ lat: 46.5, lng: 6.6 }, { latitude: null, longitude: null, radiusM: 300 })).toBe("unavailable");
  });
});
