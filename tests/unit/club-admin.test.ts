import { describe, expect, it } from "vitest";
import {
  addDays, ageOn, coversDay, daysBetween, effectiveStatus, fitsAgeRule, isExpiringSoon, isMemberOn, joinValidity,
  memberUnitPrice, membershipPeriod, renewalValidity,
} from "@/lib/club-admin/membership";
import { hoursLeft, isOfferOpen, moveTo, offerExpiry, placeInLine, processList, respond, type Entry } from "@/lib/club-admin/waitlist";
import {
  ahvDigits, buildParticipantsCsv, buildSessionsCsv, chDate, csvCell, formatAhv, isValidAhv, jsEligible, jsSummary, maskAhv, sexCode,
  type JsLabels, type JsMarks, type JsParticipant, type JsSession,
} from "@/lib/club-admin/js";
import { bestCert, certState, coachRow, dueReminder, missingKinds, thresholdsCovered, type Cert } from "@/lib/club-admin/compliance";
import { incidentStats } from "@/lib/club-admin/incidents";
import { ahvSchema, certificateSchema, fileKey, incidentSchema, isFileKeyFor, membershipTypeSchema, settingsSchema, tokenSchema } from "@/lib/club-admin/validation";

// ---------------------------------------------------------------------------
// Membership validity and renewal dates
// ---------------------------------------------------------------------------
describe("membership periods", () => {
  it("season periods start on day 1 of the start month", () => {
    expect(membershipPeriod("season", 8, "2026-11-18")).toEqual({ start: "2026-08-01", end: "2027-07-31" });
    expect(membershipPeriod("season", 8, "2026-07-31")).toEqual({ start: "2025-08-01", end: "2026-07-31" });
    expect(membershipPeriod("season", 8, "2026-08-01")).toEqual({ start: "2026-08-01", end: "2027-07-31" });
    expect(membershipPeriod("season", 1, "2026-05-05")).toEqual({ start: "2026-01-01", end: "2026-12-31" });
  });
  it("calendar-year periods", () => {
    expect(membershipPeriod("calendar_year", 8, "2026-03-01")).toEqual({ start: "2026-01-01", end: "2026-12-31" });
    expect(membershipPeriod("calendar_year", 8, "2024-02-29")).toEqual({ start: "2024-01-01", end: "2024-12-31" });
  });
  it("join: from the join day to the end of its period", () => {
    expect(joinValidity("season", 8, "2026-09-01")).toEqual({ from: "2026-09-01", until: "2027-07-31" });
    expect(joinValidity("calendar_year", 8, "2026-11-30")).toEqual({ from: "2026-11-30", until: "2026-12-31" });
  });
  it("renewal starts the day after the previous end", () => {
    expect(renewalValidity("season", 8, "2027-07-31", "2027-07-10")).toEqual({ from: "2027-08-01", until: "2028-07-31" });
    expect(renewalValidity("calendar_year", 8, "2026-12-31", "2026-12-20")).toEqual({ from: "2027-01-01", until: "2027-12-31" });
  });
  it("a long-lapsed renewal starts at the current period", () => {
    expect(renewalValidity("season", 8, "2024-07-31", "2026-11-18")).toEqual({ from: "2026-08-01", until: "2027-07-31" });
  });
  it("day arithmetic", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2024-03-01", -1)).toBe("2024-02-29");
    expect(daysBetween("2026-11-18", "2026-12-18")).toBe(30);
  });
});

describe("membership status and member pricing", () => {
  const m = { status: "active" as const, valid_from: "2026-08-01", valid_until: "2027-07-31" };
  it("validity covers the day only when active", () => {
    expect(coversDay(m, "2026-08-01")).toBe(true);
    expect(coversDay(m, "2027-07-31")).toBe(true);
    expect(coversDay(m, "2027-08-01")).toBe(false);
    expect(coversDay({ ...m, status: "pending_payment" }, "2026-10-01")).toBe(false);
    expect(isMemberOn([m, { ...m, status: "cancelled" }], "2026-10-01")).toBe(true);
    expect(isMemberOn([], "2026-10-01")).toBe(false);
  });
  it("effective status expires a stale active row", () => {
    expect(effectiveStatus(m, "2027-08-02")).toBe("expired");
    expect(effectiveStatus(m, "2027-01-01")).toBe("active");
  });
  it("expiring soon: within the window, not renewed", () => {
    expect(isExpiringSoon({ status: "active", valid_until: "2027-07-31" }, "2027-07-10", 30)).toBe(true);
    expect(isExpiringSoon({ status: "active", valid_until: "2027-07-31", renewed: true }, "2027-07-10", 30)).toBe(false);
    expect(isExpiringSoon({ status: "active", valid_until: "2027-07-31" }, "2027-05-01", 30)).toBe(false);
    expect(isExpiringSoon({ status: "expired", valid_until: "2027-07-31" }, "2027-08-15", 30)).toBe(true);
    expect(isExpiringSoon({ status: "cancelled", valid_until: "2027-07-31" }, "2027-07-20", 30)).toBe(false);
  });
  it("age rules", () => {
    expect(ageOn("2016-03-14", "2026-03-13")).toBe(9);
    expect(ageOn("2016-03-14", "2026-03-14")).toBe(10);
    expect(fitsAgeRule("2016-03-14", "2026-09-01", 5, 20)).toBe(true);
    expect(fitsAgeRule("2016-03-14", "2026-09-01", 12, null)).toBe(false);
    expect(fitsAgeRule(null, "2026-09-01", null, null)).toBe(true);
  });
  it("member price only for members and only when lower", () => {
    expect(memberUnitPrice(300, 250, true)).toBe(250);
    expect(memberUnitPrice(300, 250, false)).toBe(300);
    expect(memberUnitPrice(300, null, true)).toBe(300);
    expect(memberUnitPrice(300, 350, true)).toBe(300);
    expect(memberUnitPrice(300, 0, true)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Waiting list offer chain and expiry
// ---------------------------------------------------------------------------
describe("waiting list offer chain", () => {
  const now = new Date("2026-11-18T10:00:00Z");
  const e = (id: string, position: number, status: Entry["status"] = "waiting", offerExpiresAt: string | null = null): Entry =>
    ({ id, position, createdAt: `2026-11-0${position}T00:00:00Z`, status, offerExpiresAt });
  const list = [e("a", 1), e("b", 2), e("c", 3)];

  it("no offer while the list is full", () => {
    const r = processList(list, { capacity: 10, taken: 10 }, now);
    expect(r.offered).toEqual([]);
  });
  it("a freed spot is offered to the first in line only, for 48 h", () => {
    const r = processList(list, { capacity: 10, taken: 9 }, now);
    expect(r.offered).toEqual(["a"]);
    const a = r.entries.find((x) => x.id === "a")!;
    expect(a.status).toBe("offered");
    expect(a.offerExpiresAt).toBe(offerExpiry(now, 48).toISOString());
    expect(new Date(a.offerExpiresAt!).getTime() - now.getTime()).toBe(48 * 3_600_000);
  });
  it("an open offer holds the spot", () => {
    const first = processList(list, { capacity: 10, taken: 9 }, now);
    const again = processList(first.entries, { capacity: 10, taken: 9 }, now);
    expect(again.offered).toEqual([]);
  });
  it("decline passes the spot to the next person", () => {
    const first = processList(list, { capacity: 10, taken: 9 }, now);
    const declined = respond(first.entries, "a", false, now);
    expect(declined.result).toBe("declined");
    const next = processList(declined.entries, { capacity: 10, taken: 9 }, now);
    expect(next.offered).toEqual(["b"]);
  });
  it("expiry passes the spot on, and an expired offer cannot be accepted", () => {
    const first = processList(list, { capacity: 10, taken: 9 }, now, 48);
    const later = new Date(now.getTime() + 49 * 3_600_000);
    expect(respond(first.entries, "a", true, later).result).toBe("expired");
    const next = processList(first.entries, { capacity: 10, taken: 9 }, later);
    expect(next.expired).toEqual(["a"]);
    expect(next.offered).toEqual(["b"]);
  });
  it("accept takes the spot; nothing left to offer", () => {
    const first = processList(list, { capacity: 10, taken: 9 }, now);
    const acc = respond(first.entries, "a", true, now);
    expect(acc.result).toBe("accepted");
    expect(processList(acc.entries, { capacity: 10, taken: 10 }, now).offered).toEqual([]);
    expect(respond(acc.entries, "a", true, now).result).toBe("not_open");
  });
  it("a capacity increase offers several spots in order; unlimited offers everyone", () => {
    expect(processList(list, { capacity: 12, taken: 10 }, now).offered).toEqual(["a", "b"]);
    expect(processList(list, { capacity: null, taken: 50 }, now).offered).toEqual(["a", "b", "c"]);
  });
  it("manual reorder and place in line", () => {
    const moved = moveTo(list, "c", 1);
    expect(moved.map((x) => [x.id, x.position])).toEqual([["a", 2], ["b", 3], ["c", 1]]);
    expect(placeInLine(moved, "a")).toBe(2);
    expect(placeInLine(moveTo(list, "a", 99), "a")).toBe(3);
    expect(processList(moved, { capacity: 1, taken: 0 }, now).offered).toEqual(["c"]);
  });
  it("offer helpers", () => {
    expect(isOfferOpen(e("x", 1, "offered", "2026-11-18T11:00:00Z"), now)).toBe(true);
    expect(isOfferOpen(e("x", 1, "offered", "2026-11-18T09:00:00Z"), now)).toBe(false);
    expect(hoursLeft("2026-11-20T10:30:00Z", now)).toBe(48);
    expect(hoursLeft(null, now)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// J+S CSV formatting and summary
// ---------------------------------------------------------------------------
describe("J+S", () => {
  it("AHV checksum, format, mask", () => {
    expect(isValidAhv("756.1234.5678.97")).toBe(true);
    expect(isValidAhv("7561234567897")).toBe(true);
    expect(isValidAhv("756.1234.5678.98")).toBe(false);
    expect(isValidAhv("757.1234.5678.97")).toBe(false);
    expect(isValidAhv("")).toBe(false);
    expect(ahvDigits("756.1234.5678.97")).toBe("7561234567897");
    expect(formatAhv("7561234567897")).toBe("756.1234.5678.97");
    expect(maskAhv("7897")).toBe("756.••••.••78.97");
  });
  it("age eligibility by calendar year [Verify with J+S/NDS]", () => {
    expect(jsEligible("2016-12-31", "2021-01-05")).toBe(true); // turns 5 that year
    expect(jsEligible("2017-01-01", "2021-12-31")).toBe(false);
    expect(jsEligible("2006-01-01", "2026-12-31")).toBe(true); // turns 20
    expect(jsEligible("2005-12-31", "2026-01-01")).toBe(false);
    expect(jsEligible(null, "2026-01-01")).toBe(false);
  });
  it("cells: dates, separators, quotes, spreadsheet formulas", () => {
    expect(chDate("2026-03-14")).toBe("14.03.2026");
    expect(csvCell("Müller; Hans")).toBe('"Müller; Hans"');
    expect(csvCell('Say "hi"')).toBe('"Say ""hi"""');
    expect(csvCell("=SUM(A1)")).toBe("'=SUM(A1)");
    expect(csvCell(-3, false)).toBe("-3");
    expect(sexCode("Female")).toBe("F");
    expect(sexCode("Male")).toBe("M");
    expect(sexCode("")).toBe("");
  });

  const labels: JsLabels = {
    lastName: "Last name", firstName: "First name", dob: "Date of birth", sex: "Sex", nationality: "Nationality", ahv: "AHV",
    total: "Total", date: "Date", start: "Start", minutes: "Minutes", coach: "Coach", coachNumber: "J+S no", present: "Present", location: "Location",
  };
  const sessions: JsSession[] = [
    { id: "s2", day: "2026-05-27", time: "17:00", minutes: 90, coachName: "Coach A", coachNumber: "12345", location: "Hall" },
    { id: "s1", day: "2026-05-20", time: "17:00", minutes: 90, coachName: "Coach A", coachNumber: "12345", location: "Hall" },
  ];
  const people: JsParticipant[] = [
    { id: "p2", lastName: "Zeller", firstName: "Ana", dob: "2014-09-02", sex: "Female", nationality: "CH", ahv: "756.1234.5678.97" },
    { id: "p1", lastName: "Aebi", firstName: "Tim", dob: "2016-11-21", sex: "Male", nationality: "CH" },
    { id: "p3", lastName: "Old", firstName: "Max", dob: "1990-01-01", sex: "Male", nationality: "CH" },
  ];
  type St = "present" | "late" | "absent" | "excused";
  const marks: JsMarks = new Map<string, Map<string, St>>([
    ["p1", new Map<string, St>([["s1", "present"], ["s2", "late"]])],
    ["p2", new Map<string, St>([["s1", "absent"]])],
    ["p3", new Map<string, St>([["s1", "present"]])],
  ]);

  it("participants CSV: BOM, semicolons, sorted, attendance 1/0/empty, AHV column only when asked", () => {
    const csv = buildParticipantsCsv(sessions, people, marks, labels, false);
    expect(csv.startsWith("﻿")).toBe(true);
    const lines = csv.slice(1).trimEnd().split("\r\n");
    expect(lines[0]).toBe("Last name;First name;Date of birth;Sex;Nationality;20.05.2026 17:00;27.05.2026 17:00;Total");
    expect(lines[1]).toBe("Aebi;Tim;21.11.2016;M;CH;1;1;2");
    expect(lines[3]).toBe("Zeller;Ana;02.09.2014;F;CH;0;;0");
    expect(csv).not.toContain("756.");
    const withAhv = buildParticipantsCsv(sessions, people, marks, labels, true).slice(1).split("\r\n");
    expect(withAhv[0]).toContain(";AHV;");
    expect(withAhv[3]).toBe("Zeller;Ana;02.09.2014;F;CH;756.1234.5678.97;0;;0");
  });
  it("sessions CSV: date, start, duration, coach, J+S number, present count", () => {
    const lines = buildSessionsCsv(sessions, marks, labels).slice(1).trimEnd().split("\r\n");
    expect(lines[0]).toBe("Date;Start;Minutes;Coach;J+S no;Present;Location");
    expect(lines[1]).toBe("20.05.2026;17:00;90;Coach A;12345;2;Hall");
    expect(lines[2]).toBe("27.05.2026;17:00;90;Coach A;12345;1;Hall");
  });
  it("summary: eligible hours and participants, subsidy estimate", () => {
    const s = jsSummary(sessions, people, marks, { ratePerParticipantHour: 1.5 });
    expect(s.sessions).toBe(2);
    expect(s.hours).toBe(3);
    expect(s.participants).toBe(1); // p1 (p2 absent, p3 too old)
    expect(s.ineligibleParticipants).toBe(1);
    expect(s.participantHours).toBe(3);
    expect(s.estimatedSubsidy).toBe(4.5);
    expect(jsSummary(sessions, people, marks).estimatedSubsidy).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Staff compliance: states and reminder scheduling
// ---------------------------------------------------------------------------
describe("staff compliance", () => {
  const today = "2026-11-18";
  const c = (id: string, kind: string, status: Cert["status"], valid_until: string | null): Cert => ({ id, kind, status, valid_until });
  it("certificate states", () => {
    expect(certState(null, today)).toBe("missing");
    expect(certState(c("1", "first_aid", "verified", "2027-11-18"), today)).toBe("ok");
    expect(certState(c("1", "first_aid", "verified", "2027-01-10"), today)).toBe("expiring");
    expect(certState(c("1", "first_aid", "verified", "2026-11-17"), today)).toBe("expired");
    expect(certState(c("1", "first_aid", "pending", "2027-11-18"), today)).toBe("pending");
    expect(certState(c("1", "first_aid", "rejected", "2027-11-18"), today)).toBe("rejected");
    expect(certState(c("1", "first_aid", "verified", null), today)).toBe("ok");
  });
  it("missing kinds mirror the database check (verified + valid on the day)", () => {
    const certs = [c("1", "first_aid", "verified", "2026-12-01"), c("2", "child_protection", "pending", null)];
    expect(missingKinds(certs, ["criminal_record_youth", "child_protection", "first_aid"], today)).toEqual(["criminal_record_youth", "child_protection"]);
    expect(missingKinds(certs, ["first_aid"], "2026-12-02")).toEqual(["first_aid"]);
  });
  it("best certificate per kind and coach row", () => {
    const certs = [c("old", "first_aid", "verified", "2026-01-01"), c("new", "first_aid", "verified", "2028-01-01")];
    expect(bestCert(certs, "first_aid", today)?.id).toBe("new");
    const row = coachRow(certs, ["first_aid", "child_protection"], today);
    expect(row.blocked).toBe(true);
    expect(row.kinds.map((k) => k.state)).toEqual(["ok", "missing"]);
  });
  it("reminders at 60 / 30 / 7 days, once each", () => {
    expect(dueReminder("2027-01-17", today)).toBe(60);           // 60 days left
    expect(dueReminder("2027-01-18", today)).toBeNull();         // 61 days left
    expect(dueReminder("2026-12-18", today, [60, 30, 7], [60])).toBe(30);
    expect(dueReminder("2026-12-18", today, [60, 30, 7], [60, 30])).toBeNull();
    expect(dueReminder("2026-11-25", today, [60, 30, 7], [60, 30])).toBe(7);
    expect(dueReminder("2026-11-17", today)).toBeNull();         // already expired
    expect(dueReminder(null, today)).toBeNull();
  });
  it("a late first run sends only the tightest reminder and marks the looser ones", () => {
    expect(dueReminder("2026-11-20", today)).toBe(7);
    expect(thresholdsCovered(7)).toEqual([60, 30, 7]);
    expect(dueReminder("2026-11-20", today, [60, 30, 7], thresholdsCovered(7))).toBeNull();
    expect(thresholdsCovered(30, [60, 30, 7])).toEqual([60, 30]);
  });
});

// ---------------------------------------------------------------------------
// Incidents: anonymous statistics; validation
// ---------------------------------------------------------------------------
describe("incident statistics", () => {
  it("counts without personal data", () => {
    const s = incidentStats([
      { occurred_at: "2026-10-03T10:00:00Z", body_part: "ankle", severity: "moderate", referral: "doctor", return_status: "out", status: "open" },
      { occurred_at: "2026-10-20T10:00:00Z", body_part: "ankle", severity: "minor", referral: "none", return_status: "cleared", status: "closed" },
      { occurred_at: "2026-11-01T10:00:00Z", body_part: "head", severity: "serious", referral: "hospital", return_status: "modified", status: "open" },
    ]);
    expect(s.total).toBe(3);
    expect(s.open).toBe(2);
    expect(s.bySeverity).toMatchObject({ minor: 1, moderate: 1, serious: 1, critical: 0 });
    expect(s.byBodyPart[0]).toEqual({ key: "ankle", count: 2 });
    expect(s.byMonth).toEqual([{ month: "2026-10", count: 2 }, { month: "2026-11", count: 1 }]);
    expect(s.outOfPlay).toBe(2);
    expect(JSON.stringify(s)).not.toMatch(/athlete|name/i);
  });
});

describe("club-admin validation", () => {
  it("membership type", () => {
    expect(membershipTypeSchema.safeParse({ name: "Player", kind: "player", scope: "person", price: "120", period: "season", seasonStartMonth: 8, isActive: true }).success).toBe(true);
    const bad = membershipTypeSchema.safeParse({ name: "X", kind: "player", scope: "person", price: 1, period: "season", seasonStartMonth: 8, minAge: 12, maxAge: 5, isActive: true });
    expect(bad.success).toBe(false);
  });
  it("AHV needs a valid number and a consent note", () => {
    const id = "00000000-0000-4000-8000-000000000001";
    expect(ahvSchema.safeParse({ athleteId: id, ahv: "756.1234.5678.97", consentNote: "Signed form" }).success).toBe(true);
    expect(ahvSchema.safeParse({ athleteId: id, ahv: "756.1234.5678.97", consentNote: "" }).success).toBe(false);
    expect(ahvSchema.safeParse({ athleteId: id, ahv: "756.1234.5678.90", consentNote: "Signed form" }).success).toBe(false);
    expect(ahvSchema.safeParse({ athleteId: id, ahv: null }).success).toBe(true);
  });
  it("certificate dates, incident fields, settings, offer token", () => {
    const id = "00000000-0000-4000-8000-000000000001";
    expect(certificateSchema.safeParse({ coachId: id, kind: "first_aid", issuedOn: "2026-02-01", validUntil: "2026-01-01" }).success).toBe(false);
    expect(incidentSchema.safeParse({ athleteId: id, occurredAt: "2026-11-18T09:00:00.000Z", description: "Fell", bodyPart: "knee", severity: "minor",
      firstAidGiven: true, referral: "none", returnStatus: "not_applicable" }).success).toBe(true);
    expect(incidentSchema.safeParse({ athleteId: id, occurredAt: "2026-11-18T09:00:00.000Z", description: "Fell", bodyPart: "tail", severity: "minor",
      firstAidGiven: true, referral: "none", returnStatus: "not_applicable" }).success).toBe(false);
    expect(settingsSchema.safeParse({ waitlistOfferHours: 48, waitlistAutoOffer: true, membershipRenewalWindowDays: 30, jsEnabled: true, jsAgeMin: 5, jsAgeMax: 20,
      complianceBlockYouth: false, complianceMandatoryKinds: ["first_aid"], complianceReminderDays: [60, 30, 7] }).success).toBe(true);
    expect(tokenSchema.safeParse("a".repeat(48)).success).toBe(true);
    expect(tokenSchema.safeParse("a".repeat(47)).success).toBe(false);
  });
  it("private file keys are scoped to org, area and owner", () => {
    const org = "00000000-0000-4000-8000-000000000001", owner = "00000000-0000-4000-8000-000000000002", f = "00000000-0000-4000-8000-000000000003";
    const k = fileKey(org, "certificates", owner, f, "pdf");
    expect(isFileKeyFor(k, org, "certificates", owner)).toBe(true);
    expect(isFileKeyFor(k, org, "incidents", owner)).toBe(false);
    expect(isFileKeyFor(k, "00000000-0000-4000-8000-000000000009", "certificates", owner)).toBe(false);
    expect(isFileKeyFor(`${org}/certificates/${owner}/../x.pdf`, org, "certificates", owner)).toBe(false);
  });
});
