/**
 * Families & athletes import — parsing, validation and planning (pure; no I/O).
 * Used for CSV and .xlsx files (see ./xlsx.ts and ./mapping.ts).
 *
 * One row = one athlete. Family and guardian columns repeat on every row of
 * the same household; rows are grouped into families by `family_ref` (if the
 * club's export has a household id) or by family name + first guardian email.
 *
 * Accepted: comma, semicolon (Swiss/German Excel) or tab separated; UTF-8 with
 * or without BOM; quoted fields with embedded separators/newlines.
 */
import { z } from "zod";

export const MAX_ROWS = 2000;
export const MAX_BYTES = 1_000_000;

export const TEMPLATE_COLUMNS = [
  "family_ref",
  "family_name",
  "family_address",
  "family_phone",
  "guardian1_name",
  "guardian1_email",
  "guardian1_relation",
  "guardian2_name",
  "guardian2_email",
  "guardian2_relation",
  "athlete_first_name",
  "athlete_last_name",
  "athlete_dob",
  "athlete_gender",
  "athlete_school",
  "athlete_jersey_size",
  "athlete_nationality",
] as const;

export const TEMPLATE_CSV =
  TEMPLATE_COLUMNS.join(",") +
  "\n" +
  [
    "H-001,Muster,\"Avenue de Cour 12, 1007 Lausanne\",+41 21 000 00 00,Anna Muster,anna.muster@example.com,mother,Marc Muster,marc.muster@example.com,father,Léa,Muster,14.03.2013,F,Collège de Béthusy,YM,CH",
    "H-001,Muster,\"Avenue de Cour 12, 1007 Lausanne\",+41 21 000 00 00,Anna Muster,anna.muster@example.com,mother,Marc Muster,marc.muster@example.com,father,Noah,Muster,2015-09-02,M,,YS,CH",
  ].join("\n") +
  "\n";

export type DateOrder = "DMY" | "MDY";
/** A row-numbered problem; `key` is an i18n key under forms.import.issues.* */
export type Issue = { row: number; field?: string; key: string; values?: Record<string, string | number> };

/* -------------------------------------------------------------------------- */
/* CSV parsing                                                                */
/* -------------------------------------------------------------------------- */

export function detectDelimiter(headerLine: string): string {
  const counts: [string, number][] = [",", ";", "\t"].map((d) => [d, headerLine.split(d).length - 1]);
  counts.sort((a, b) => b[1] - a[1]);
  return counts[0][1] > 0 ? counts[0][0] : ",";
}

/** RFC 4180-ish parser. Returns rows of raw string cells. */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, "");
  const firstLine = src.split(/\r?\n/, 1)[0] ?? "";
  const delim = detectDelimiter(firstLine);
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i++;
        } else inQuotes = false;
      } else cell += c;
      continue;
    }
    if (c === '"' && cell === "") inQuotes = true;
    else if (c === delim) {
      row.push(cell);
      cell = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += c;
  }
  if (cell !== "" || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((v) => v.trim() !== ""));
}

/** Normalise a header: "Athlete DOB" -> "athlete_dob". Accepts a few common aliases. */
const ALIASES: Record<string, string> = {
  household_id: "family_ref",
  family_id: "family_ref",
  family: "family_name",
  household: "family_name",
  first_name: "athlete_first_name",
  last_name: "athlete_last_name",
  dob: "athlete_dob",
  date_of_birth: "athlete_dob",
  birthdate: "athlete_dob",
  athlete_date_of_birth: "athlete_dob",
  gender: "athlete_gender",
  school: "athlete_school",
  jersey_size: "athlete_jersey_size",
  nationality: "athlete_nationality",
  parent_email: "guardian1_email",
  parent_name: "guardian1_name",
  guardian_email: "guardian1_email",
  guardian_name: "guardian1_name",
  address: "family_address",
  phone: "family_phone",
};
export function normaliseHeader(h: string): string {
  const k = h
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
  return ALIASES[k] ?? k;
}

/* -------------------------------------------------------------------------- */
/* Field validation                                                           */
/* -------------------------------------------------------------------------- */

/** Parse YYYY-MM-DD, DD.MM.YYYY, and DD/MM/YYYY or MM/DD/YYYY (per `order`). */
export function parseDate(raw: string, order: DateOrder): string | null {
  const s = raw.trim();
  let y: number, m: number, d: number;
  let mt = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (mt) [y, m, d] = [+mt[1], +mt[2], +mt[3]];
  else if ((mt = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/))) [d, m, y] = [+mt[1], +mt[2], +mt[3]];
  else if ((mt = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/))) {
    if (order === "MDY") [m, d, y] = [+mt[1], +mt[2], +mt[3]];
    else [d, m, y] = [+mt[1], +mt[2], +mt[3]];
  } else return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

const GENDERS: Record<string, string> = {
  f: "Female", female: "Female", w: "Female", weiblich: "Female", feminin: "Female", féminin: "Female", fille: "Female", girl: "Female",
  m: "Male", male: "Male", männlich: "Male", maennlich: "Male", masculin: "Male", garcon: "Male", garçon: "Male", boy: "Male",
  x: "Other", d: "Other", other: "Other", divers: "Other", autre: "Other",
};
const RELATIONS: Record<string, string> = {
  mother: "mother", mum: "mother", mom: "mother", mere: "mother", mère: "mother", mutter: "mother",
  father: "father", dad: "father", pere: "father", père: "father", vater: "father",
  guardian: "guardian", tuteur: "guardian", tutrice: "guardian", vormund: "guardian", other: "guardian",
};

const email = z.string().trim().toLowerCase().email();

export type RowInput = Record<string, string>;

export type PlannedGuardian = { email: string; name: string | null; relation: string };
export type PlannedAthlete = {
  row: number;
  first_name: string;
  last_name: string;
  dob: string;
  gender: string | null;
  school: string | null;
  jersey_size: string | null;
  nationality: string | null;
};
export type PlannedFamily = {
  key: string;
  name: string;
  address: string | null;
  phone: string | null;
  guardians: PlannedGuardian[];
  athletes: PlannedAthlete[];
  /** Set when the family already exists in the club (matched by exact name). */
  existingFamilyId: string | null;
};

export type ExistingData = {
  /** lower(name) -> ids (more than one id = ambiguous, so we create a new family) */
  familiesByName: Map<string, string[]>;
  /** `${lower(first)}|${lower(last)}|${dob}` */
  athleteKeys: Set<string>;
  /** emails with a pending invitation or a linked profile in this org */
  knownEmails: Set<string>;
};

export type ImportPlan = {
  families: PlannedFamily[];
  errors: Issue[];
  warnings: Issue[];
  totals: {
    rows: number;
    familiesNew: number;
    familiesExisting: number;
    athletes: number;
    athletesSkipped: number;
    invitations: number;
  };
};

function opt(v: string | undefined): string | null {
  const t = (v ?? "").trim();
  return t === "" ? null : t;
}

/**
 * Validate every row and group into families. Never throws; all problems are
 * reported as row-numbered issues (row numbers are 1-based spreadsheet lines,
 * header = line 1).
 */
export function buildImportPlan(text: string, order: DateOrder, existing?: ExistingData): ImportPlan {
  if (text.length > MAX_BYTES) {
    return {
      families: [],
      errors: [{ row: 0, key: "fileTooLarge", values: { mb: MAX_BYTES / 1_000_000 } }],
      warnings: [],
      totals: { rows: 0, familiesNew: 0, familiesExisting: 0, athletes: 0, athletesSkipped: 0, invitations: 0 },
    };
  }
  return buildImportPlanFromTable(parseCsv(text), order, existing);
}

/**
 * Same as buildImportPlan for an already parsed table (CSV or .xlsx, after
 * column mapping): row 0 is the header row.
 */
export function buildImportPlanFromTable(table: string[][], order: DateOrder, existing?: ExistingData): ImportPlan {
  const errors: Issue[] = [];
  const warnings: Issue[] = [];
  const empty: ImportPlan = {
    families: [],
    errors,
    warnings,
    totals: { rows: 0, familiesNew: 0, familiesExisting: 0, athletes: 0, athletesSkipped: 0, invitations: 0 },
  };

  if (table.length < 2) {
    errors.push({ row: 0, key: "noRows" });
    return empty;
  }
  const headers = table[0].map(normaliseHeader);
  const required = ["athlete_first_name", "athlete_last_name", "athlete_dob"];
  const missingCols = required.filter((c) => !headers.includes(c));
  if (missingCols.length) {
    errors.push({ row: 1, key: "missingColumns", values: { columns: missingCols.join(", ") } });
    return empty;
  }
  const unknown = headers.filter((h) => h && !(TEMPLATE_COLUMNS as readonly string[]).includes(h));
  if (unknown.length) warnings.push({ row: 1, key: "unknownColumns", values: { columns: unknown.join(", ") } });

  const dataRows = table.slice(1);
  if (dataRows.length > MAX_ROWS) {
    errors.push({ row: 0, key: "tooManyRows", values: { count: dataRows.length, max: MAX_ROWS } });
    return empty;
  }

  const families = new Map<string, PlannedFamily>();
  const seenAthletes = new Map<string, number>();
  let skipped = 0;
  const todayIso = new Date().toISOString().slice(0, 10);

  dataRows.forEach((cells, idx) => {
    const line = idx + 2;
    const r: RowInput = {};
    headers.forEach((h, i) => (r[h] = (cells[i] ?? "").trim()));
    let rowOk = true;
    const fail = (field: string, key: string, values?: Issue["values"]) => {
      errors.push({ row: line, field, key, values });
      rowOk = false;
    };

    const first = opt(r.athlete_first_name);
    const last = opt(r.athlete_last_name);
    if (!first) fail("athlete_first_name", "firstNameRequired");
    if (!last) fail("athlete_last_name", "lastNameRequired");
    const dob = r.athlete_dob ? parseDate(r.athlete_dob, order) : null;
    if (!r.athlete_dob) fail("athlete_dob", "dobRequired");
    else if (!dob) fail("athlete_dob", "dobUnreadable", { value: r.athlete_dob });
    else if (dob > todayIso) fail("athlete_dob", "dobFuture");
    else if (+dob.slice(0, 4) < new Date().getUTCFullYear() - 100) fail("athlete_dob", "dobTooOld");

    let gender: string | null = null;
    if (r.athlete_gender) {
      gender = GENDERS[r.athlete_gender.toLowerCase()] ?? null;
      if (!gender) warnings.push({ row: line, field: "athlete_gender", key: "genderUnknown", values: { value: r.athlete_gender } });
    }

    const guardians: PlannedGuardian[] = [];
    for (const n of [1, 2] as const) {
      const rawEmail = r[`guardian${n}_email`];
      if (!rawEmail) continue;
      const e = email.safeParse(rawEmail);
      if (!e.success) {
        fail(`guardian${n}_email`, "emailInvalid", { value: rawEmail });
        continue;
      }
      const rawRel = (r[`guardian${n}_relation`] ?? "").toLowerCase();
      const relation = rawRel ? RELATIONS[rawRel] ?? "guardian" : "guardian";
      if (rawRel && !RELATIONS[rawRel])
        warnings.push({ row: line, field: `guardian${n}_relation`, key: "relationUnknown", values: { value: rawRel } });
      guardians.push({ email: e.data, name: opt(r[`guardian${n}_name`]), relation });
    }
    if (!r.guardian1_email && !r.guardian2_email)
      warnings.push({ row: line, key: "noGuardian" });

    if (!rowOk || !first || !last || !dob) return;

    const familyName = opt(r.family_name) ?? `${last} family`;
    if (!r.family_name) warnings.push({ row: line, field: "family_name", key: "noFamilyName", values: { name: familyName } });
    const key = opt(r.family_ref)
      ? `ref:${r.family_ref.toLowerCase()}`
      : `name:${familyName.toLowerCase()}|${guardians[0]?.email ?? ""}`;

    const athleteKey = `${first.toLowerCase()}|${last.toLowerCase()}|${dob}`;
    if (seenAthletes.has(athleteKey)) {
      errors.push({ row: line, key: "duplicateAthlete", values: { line: seenAthletes.get(athleteKey) ?? 0 } });
      return;
    }
    seenAthletes.set(athleteKey, line);

    let fam = families.get(key);
    if (!fam) {
      const matches = existing?.familiesByName.get(familyName.toLowerCase()) ?? [];
      fam = {
        key,
        name: familyName,
        address: opt(r.family_address),
        phone: opt(r.family_phone),
        guardians: [],
        athletes: [],
        existingFamilyId: matches.length === 1 ? matches[0] : null,
      };
      if (matches.length > 1)
        warnings.push({ row: line, field: "family_name", key: "ambiguousFamily", values: { name: familyName } });
      families.set(key, fam);
    } else {
      if (fam.name !== familyName || (opt(r.family_address) && fam.address && fam.address !== opt(r.family_address)))
        warnings.push({ row: line, key: "familyDiffers" });
    }
    for (const g of guardians) if (!fam.guardians.some((x) => x.email === g.email)) fam.guardians.push(g);

    if (existing?.athleteKeys.has(athleteKey)) {
      skipped++;
      warnings.push({ row: line, key: "athleteExists", values: { name: `${first} ${last}`, dob } });
      return;
    }
    fam.athletes.push({
      row: line,
      first_name: first,
      last_name: last,
      dob,
      gender,
      school: opt(r.athlete_school),
      jersey_size: opt(r.athlete_jersey_size),
      nationality: opt(r.athlete_nationality)?.toUpperCase() ?? null,
    });
  });

  // An email can only have one open invitation per club.
  const emailOwner = new Map<string, string>();
  let invitations = 0;
  for (const fam of Array.from(families.values())) {
    fam.guardians = fam.guardians.filter((g) => {
      const owner = emailOwner.get(g.email);
      if (owner && owner !== fam.key) {
        warnings.push({ row: 0, key: "guardianMultiple", values: { email: g.email } });
        return false;
      }
      emailOwner.set(g.email, fam.key);
      if (existing?.knownEmails.has(g.email)) {
        warnings.push({ row: 0, key: "guardianKnown", values: { email: g.email } });
        return false;
      }
      return true;
    });
    invitations += fam.guardians.length;
  }

  const list = Array.from(families.values()).filter((f) => f.athletes.length > 0 || f.guardians.length > 0);
  return {
    families: list,
    errors,
    warnings,
    totals: {
      rows: dataRows.length,
      familiesNew: list.filter((f) => !f.existingFamilyId).length,
      familiesExisting: list.filter((f) => f.existingFamilyId).length,
      athletes: list.reduce((n, f) => n + f.athletes.length, 0),
      athletesSkipped: skipped,
      invitations,
    },
  };
}
