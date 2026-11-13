/**
 * Existing registrations import (pure; no I/O): one row = one athlete
 * enrolled in one programme. Athletes are matched by name + date of birth
 * (import them first with the families import), programmes by slug or name.
 */
import { MAX_ROWS, normaliseHeader, parseDate, type DateOrder, type Issue } from "./families";

export const REGISTRATION_COLUMNS = [
  "athlete_first_name",
  "athlete_last_name",
  "athlete_dob",
  "programme",
  "status",
  "registered_on",
  "notes",
] as const;

/** Header aliases specific to this import (on top of the families ones). */
export const REGISTRATION_ALIASES: Record<string, string> = {
  program: "programme",
  programme_name: "programme",
  program_name: "programme",
  programme_slug: "programme",
  program_slug: "programme",
  team: "programme",
  camp: "programme",
  registration_status: "status",
  registered_at: "registered_on",
  registration_date: "registered_on",
  date: "registered_on",
};

export const REGISTRATION_STATUSES = ["pending", "confirmed", "waitlist", "cancelled", "completed"] as const;
export type RegistrationStatus = (typeof REGISTRATION_STATUSES)[number];

const STATUS_ALIASES: Record<string, RegistrationStatus> = {
  pending: "pending", open: "pending", "en attente": "pending", offen: "pending", ausstehend: "pending",
  confirmed: "confirmed", active: "confirmed", paid: "confirmed", confirme: "confirmed", "confirmé": "confirmed", "bestätigt": "confirmed", bestaetigt: "confirmed",
  waitlist: "waitlist", waiting: "waitlist", "liste d'attente": "waitlist", warteliste: "waitlist",
  cancelled: "cancelled", canceled: "cancelled", annule: "cancelled", "annulé": "cancelled", storniert: "cancelled",
  completed: "completed", done: "completed", finished: "completed", "terminé": "completed", abgeschlossen: "completed",
};

export type RegistrationExisting = {
  /** `${lower(first)}|${lower(last)}|${dob}` -> athlete id */
  athletes: Map<string, string>;
  /** lower(slug) and lower(name) -> programme id (a name used twice maps to null = ambiguous) */
  programmes: Map<string, string | null>;
  /** `${athleteId}|${programId}` already registered */
  registrations: Set<string>;
};

export type PlannedRegistration = {
  row: number;
  athleteId: string;
  programId: string;
  status: RegistrationStatus;
  registeredOn: string | null;
  notes: string | null;
};

export type RegistrationPlan = {
  rows: PlannedRegistration[];
  errors: Issue[];
  warnings: Issue[];
  totals: { rows: number; registrations: number; skipped: number };
};

export function buildRegistrationPlan(table: string[][], order: DateOrder, existing: RegistrationExisting): RegistrationPlan {
  const errors: Issue[] = [];
  const warnings: Issue[] = [];
  const out: PlannedRegistration[] = [];
  const empty = (): RegistrationPlan => ({ rows: [], errors, warnings, totals: { rows: 0, registrations: 0, skipped: 0 } });
  if (table.length < 2) {
    errors.push({ row: 0, key: "noRows" });
    return empty();
  }
  const headers = table[0].map((h) => {
    const n = normaliseHeader(h);
    return REGISTRATION_ALIASES[n] ?? n;
  });
  const required = ["athlete_first_name", "athlete_last_name", "athlete_dob", "programme"];
  const missing = required.filter((c) => !headers.includes(c));
  if (missing.length) {
    errors.push({ row: 1, key: "missingColumns", values: { columns: missing.join(", ") } });
    return empty();
  }
  const data = table.slice(1);
  if (data.length > MAX_ROWS) {
    errors.push({ row: 0, key: "tooManyRows", values: { count: data.length, max: MAX_ROWS } });
    return empty();
  }
  const today = new Date().toISOString().slice(0, 10);
  const seen = new Map<string, number>();
  let skipped = 0;

  data.forEach((cells, idx) => {
    const line = idx + 2;
    const r: Record<string, string> = {};
    headers.forEach((h, i) => (r[h] = (cells[i] ?? "").trim()));
    const first = r.athlete_first_name;
    const last = r.athlete_last_name;
    let ok = true;
    const fail = (field: string, key: string, values?: Issue["values"]) => {
      errors.push({ row: line, field, key, values });
      ok = false;
    };
    if (!first) fail("athlete_first_name", "firstNameRequired");
    if (!last) fail("athlete_last_name", "lastNameRequired");
    const dob = r.athlete_dob ? parseDate(r.athlete_dob, order) : null;
    if (!r.athlete_dob) fail("athlete_dob", "dobRequired");
    else if (!dob) fail("athlete_dob", "dobUnreadable", { value: r.athlete_dob });
    if (!r.programme) fail("programme", "programmeRequired");

    let status: RegistrationStatus = "confirmed";
    if (r.status) {
      const s = STATUS_ALIASES[r.status.toLowerCase()];
      if (!s) warnings.push({ row: line, field: "status", key: "statusUnknown", values: { value: r.status } });
      else status = s;
    }
    let registeredOn: string | null = null;
    if (r.registered_on) {
      registeredOn = parseDate(r.registered_on, order);
      if (!registeredOn || registeredOn > today) {
        warnings.push({ row: line, field: "registered_on", key: "registeredOnIgnored", values: { value: r.registered_on } });
        registeredOn = null;
      }
    }
    if (!ok || !dob) return;

    const athleteId = existing.athletes.get(`${first.toLowerCase()}|${last.toLowerCase()}|${dob}`);
    if (!athleteId) {
      errors.push({ row: line, key: "athleteUnknown", values: { name: `${first} ${last}`, dob } });
      return;
    }
    const pKey = r.programme.toLowerCase();
    if (!existing.programmes.has(pKey)) {
      errors.push({ row: line, field: "programme", key: "programmeUnknown", values: { value: r.programme } });
      return;
    }
    const programId = existing.programmes.get(pKey);
    if (!programId) {
      errors.push({ row: line, field: "programme", key: "programmeAmbiguous", values: { value: r.programme } });
      return;
    }
    const key = `${athleteId}|${programId}`;
    if (seen.has(key)) {
      errors.push({ row: line, key: "duplicateRegistration", values: { line: seen.get(key) ?? 0 } });
      return;
    }
    seen.set(key, line);
    if (existing.registrations.has(key)) {
      skipped++;
      warnings.push({ row: line, key: "registrationExists", values: { name: `${first} ${last}`, programme: r.programme } });
      return;
    }
    out.push({ row: line, athleteId, programId, status, registeredOn, notes: r.notes ? r.notes.slice(0, 2000) : null });
  });

  return { rows: out, errors, warnings, totals: { rows: data.length, registrations: out.length, skipped } };
}

/** Programme lookup: slug and name (lower-case); a name shared by two programmes is ambiguous. */
export function programmeIndex(programmes: { id: string; slug: string | null; name: string }[]): Map<string, string | null> {
  const m = new Map<string, string | null>();
  const put = (k: string, id: string) => {
    if (!k) return;
    if (m.has(k) && m.get(k) !== id) m.set(k, null);
    else m.set(k, id);
  };
  for (const p of programmes) {
    put(p.name.trim().toLowerCase(), p.id);
    if (p.slug) put(p.slug.trim().toLowerCase(), p.id);
  }
  return m;
}
