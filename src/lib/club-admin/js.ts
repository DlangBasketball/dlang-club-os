/**
 * J+S (Jeunesse+Sport / Jugend+Sport) — pure helpers for the activity export
 * and the subsidy estimate.
 *
 * IMPORTANT: the CSV files are a working export for MANUAL entry / upload in
 * the national database (NDS, "Nationale Datenbank Sport"). The column set,
 * date formats and age rule below are our reading of the J+S rules and are
 * marked [Verify with J+S/NDS] in the app and docs/club-admin/JS_EXPORT.md:
 *   - separator ";" , UTF-8 with BOM, CRLF line ends (Swiss Excel default)
 *   - dates DD.MM.YYYY, times HH:MM (club time zone)
 *   - attendance 1 = present (incl. late), 0 = absent / excused, empty = not taken
 *   - eligibility: calendar year of the session minus birth year within
 *     [ageMin, ageMax] (default 5–20)
 * Nothing here talks to NDS.
 */

// ---------------------------------------------------------------------------
// AHV / AVS number (756.XXXX.XXXX.XC, EAN-13 check digit)
// ---------------------------------------------------------------------------
export function ahvDigits(raw: string | null | undefined): string {
  return (raw ?? "").replace(/\D/g, "");
}

export function isValidAhv(raw: string | null | undefined): boolean {
  const d = ahvDigits(raw);
  if (d.length !== 13 || !d.startsWith("756")) return false;
  let s = 0;
  for (let i = 0; i < 12; i++) s += Number(d[i]) * (i % 2 === 1 ? 3 : 1);
  return (10 - (s % 10)) % 10 === Number(d[12]);
}

export function formatAhv(raw: string | null | undefined): string {
  const d = ahvDigits(raw);
  return d.length === 13 ? `${d.slice(0, 3)}.${d.slice(3, 7)}.${d.slice(7, 11)}.${d.slice(11)}` : "";
}

/** "756.••••.••••.97" style mask from the stored last 4 digits. */
export function maskAhv(last4: string | null | undefined): string {
  return last4 && /^\d{4}$/.test(last4) ? `756.••••.••${last4.slice(0, 2)}.${last4.slice(2)}` : "";
}

// ---------------------------------------------------------------------------
// Eligibility + CSV
// ---------------------------------------------------------------------------
export const JS_DEFAULT_AGE_MIN = 5;
export const JS_DEFAULT_AGE_MAX = 20;

/** J+S age rule [Verify with J+S/NDS]: session year − birth year within the range. */
export function jsEligible(dob: string | null | undefined, sessionDay: string, min = JS_DEFAULT_AGE_MIN, max = JS_DEFAULT_AGE_MAX): boolean {
  if (!dob || !/^\d{4}/.test(dob) || !/^\d{4}/.test(sessionDay)) return false;
  const years = Number(sessionDay.slice(0, 4)) - Number(dob.slice(0, 4));
  return years >= min && years <= max;
}

/** "2026-03-14" -> "14.03.2026". */
export function chDate(day: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(day ?? "");
  return m ? `${m[3]}.${m[2]}.${m[1]}` : "";
}

/** One CSV cell: quoted when needed; text starting with = + - @ is neutralised (spreadsheet formulas). */
export function csvCell(v: string | number | null | undefined, text = true): string {
  if (v == null) return "";
  let s = String(v);
  if (text && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[;"\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function csvRows(rows: (string | number | null | undefined)[][], numericCols: number[] = []): string {
  const num = new Set(numericCols);
  return "﻿" + rows.map((r) => r.map((c, i) => csvCell(c, !num.has(i))).join(";")).join("\r\n") + "\r\n";
}

export type JsSession = {
  id: string;
  day: string;      // YYYY-MM-DD (club time zone)
  time: string;     // HH:MM
  minutes: number;
  coachName: string | null;
  coachNumber: string | null;
  location: string | null;
};
export type JsParticipant = {
  id: string;
  lastName: string;
  firstName: string;
  dob: string | null;
  sex: string | null;
  nationality: string | null;
  ahv?: string | null;
};
/** athleteId -> sessionId -> status */
export type JsMarks = Map<string, Map<string, "present" | "late" | "absent" | "excused">>;

export type JsLabels = {
  lastName: string; firstName: string; dob: string; sex: string; nationality: string; ahv: string; total: string;
  date: string; start: string; minutes: string; coach: string; coachNumber: string; present: string; location: string;
};

/** Sex as one letter (M / F), empty otherwise. [Verify with J+S/NDS] */
export function sexCode(raw: string | null | undefined): string {
  const s = (raw ?? "").trim().toLowerCase();
  if (["m", "male", "masculin", "männlich", "maschile", "masculino", "boy"].includes(s)) return "M";
  if (["f", "w", "female", "féminin", "weiblich", "femminile", "femenino", "girl"].includes(s)) return "F";
  return "";
}

const attended = (s: string | undefined) => s === "present" || s === "late";

/** Participants × sessions matrix (one row per participant). */
export function buildParticipantsCsv(
  sessions: JsSession[],
  people: JsParticipant[],
  marks: JsMarks,
  labels: JsLabels,
  includeAhv: boolean,
): string {
  const ordered = [...sessions].sort((a, b) => (a.day + a.time).localeCompare(b.day + b.time));
  const head = [labels.lastName, labels.firstName, labels.dob, labels.sex, labels.nationality,
    ...(includeAhv ? [labels.ahv] : []), ...ordered.map((s) => `${chDate(s.day)} ${s.time}`), labels.total];
  const fixed = 5 + (includeAhv ? 1 : 0);
  const rows = [...people]
    .sort((a, b) => a.lastName.localeCompare(b.lastName) || a.firstName.localeCompare(b.firstName))
    .map((p) => {
      const m = marks.get(p.id);
      const cells = ordered.map((s) => {
        const st = m?.get(s.id);
        return st ? (attended(st) ? 1 : 0) : "";
      });
      const total = cells.filter((c) => c === 1).length;
      return [p.lastName, p.firstName, chDate(p.dob), sexCode(p.sex), p.nationality ?? "",
        ...(includeAhv ? [p.ahv ?? ""] : []), ...cells, total];
    });
  const numeric = Array.from({ length: ordered.length + 1 }, (_, i) => fixed + i);
  return csvRows([head, ...rows], numeric);
}

/** One row per session: date, start, duration, coach, J+S number, present count, location. */
export function buildSessionsCsv(sessions: JsSession[], marks: JsMarks, labels: JsLabels): string {
  const head = [labels.date, labels.start, labels.minutes, labels.coach, labels.coachNumber, labels.present, labels.location];
  const rows = [...sessions]
    .sort((a, b) => (a.day + a.time).localeCompare(b.day + b.time))
    .map((s) => {
      let present = 0;
      for (const m of marks.values()) if (attended(m.get(s.id))) present++;
      return [chDate(s.day), s.time, s.minutes, s.coachName ?? "", s.coachNumber ?? "", present, s.location ?? ""];
    });
  return csvRows([head, ...rows], [2, 5]);
}

export type JsSummary = {
  sessions: number;
  hours: number;
  participants: number;          // distinct eligible participants who attended at least once
  ineligibleParticipants: number;
  participantHours: number;      // Σ eligible attendances × duration
  estimatedSubsidy: number | null;
};

/** Eligible hours and participants for a subsidy ESTIMATE (rate per participant-hour from the club settings). */
export function jsSummary(
  sessions: JsSession[],
  people: { id: string; dob: string | null }[],
  marks: JsMarks,
  opts: { ageMin?: number; ageMax?: number; ratePerParticipantHour?: number | null } = {},
): JsSummary {
  const dob = new Map(people.map((p) => [p.id, p.dob]));
  const min = opts.ageMin ?? JS_DEFAULT_AGE_MIN;
  const max = opts.ageMax ?? JS_DEFAULT_AGE_MAX;
  const eligible = new Set<string>();
  const ineligible = new Set<string>();
  let participantMinutes = 0;
  let minutes = 0;
  for (const s of sessions) {
    minutes += s.minutes;
    for (const [athleteId, m] of marks) {
      if (!attended(m.get(s.id))) continue;
      if (jsEligible(dob.get(athleteId) ?? null, s.day, min, max)) {
        eligible.add(athleteId);
        participantMinutes += s.minutes;
      } else ineligible.add(athleteId);
    }
  }
  for (const id of eligible) ineligible.delete(id);
  const participantHours = Math.round((participantMinutes / 60) * 100) / 100;
  const rate = opts.ratePerParticipantHour;
  return {
    sessions: sessions.length,
    hours: Math.round((minutes / 60) * 100) / 100,
    participants: eligible.size,
    ineligibleParticipants: ineligible.size,
    participantHours,
    estimatedSubsidy: rate != null && rate >= 0 ? Math.round(participantHours * rate * 100) / 100 : null,
  };
}
