/**
 * Player-card numbers (pure, unit-tested): attendance rate over the last 30
 * days, sessions this season, age.
 */

export type MarkRow = { date: string; status: string };

const ATTENDED = new Set(["present", "late"]);
/** Excused absences do not count against the rate. */
const COUNTED = new Set(["present", "late", "absent"]);

function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Season start: the current season's start date when the club has one,
 * otherwise 1 August (the usual club season) of this year, or of last year
 * before August.
 */
export function seasonStartFor(today: string, currentSeasonStart?: string | null): string {
  if (currentSeasonStart && currentSeasonStart <= today) return currentSeasonStart;
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7));
  return `${month >= 8 ? year : year - 1}-08-01`;
}

export type AttendanceStats = {
  /** 0..100, null when nothing was recorded in the window. */
  rate30: number | null;
  attended30: number;
  counted30: number;
  /** Sessions attended (present / late) since the season start. */
  seasonSessions: number;
};

export function attendanceStats(rows: MarkRow[], today: string, seasonStart: string): AttendanceStats {
  const from30 = addDays(today, -29);
  let attended30 = 0;
  let counted30 = 0;
  let seasonSessions = 0;
  for (const r of rows) {
    if (!r.date || r.date > today) continue;
    const status = r.status?.toLowerCase();
    if (r.date >= from30 && COUNTED.has(status)) {
      counted30++;
      if (ATTENDED.has(status)) attended30++;
    }
    if (r.date >= seasonStart && ATTENDED.has(status)) seasonSessions++;
  }
  return {
    rate30: counted30 ? Math.round((attended30 / counted30) * 100) : null,
    attended30,
    counted30,
    seasonSessions,
  };
}

/** Whole years between a date of birth and `today` (YYYY-MM-DD), null when unknown. */
export function ageOn(dob: string | null | undefined, today: string): number | null {
  if (!dob || !/^\d{4}-\d{2}-\d{2}/.test(dob)) return null;
  const [y, m, d] = dob.slice(0, 10).split("-").map(Number);
  const [ty, tm, td] = today.slice(0, 10).split("-").map(Number);
  let age = ty - y;
  if (tm < m || (tm === m && td < d)) age--;
  return age >= 0 && age < 130 ? age : null;
}
