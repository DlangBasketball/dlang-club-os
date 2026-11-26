/**
 * Alumni & placements CSV import / export (pure; no I/O).
 *
 * One row = one person + (optionally) one placement. Several rows with the
 * same person (same email, or same first + last name + birth year) add
 * several placements to that person. Headers are matched case- and
 * accent-insensitively, with English, French and German aliases. Values such
 * as "NCAA D2", "Division II", "D-II" or "Div 2" map to the institution type.
 */
import { parseCsv, parseDate, type DateOrder } from "@/lib/import/families";
import {
  ALUMNI_STATUSES, INSTITUTION_TYPES, PLACEMENT_STATUSES, SCHOLARSHIPS,
  type AlumniPlacementStatus, type AlumniStatus, type InstitutionType, type Scholarship,
} from "./rules";

export const ALUMNI_MAX_ROWS = 2000;
export const ALUMNI_MAX_BYTES = 1_000_000;

export const ALUMNI_CSV_COLUMNS = [
  "first_name", "last_name", "birth_year", "gender", "nationality", "email", "phone", "whatsapp",
  "instagram", "x_handle", "linkedin_url", "highlight_url",
  "guardian_name", "guardian_email", "guardian_phone",
  "contact_consent", "contact_consent_on", "contact_consent_source", "showcase_consent", "showcase_consent_on",
  "status", "tags", "notes",
  "institution", "institution_type", "country", "city_state", "league", "level", "sport", "position",
  "start_date", "graduation_year", "scholarship", "placement_status", "current", "roster_url", "source_note",
] as const;
export type AlumniCsvColumn = (typeof ALUMNI_CSV_COLUMNS)[number];

/** Header aliases (normalised: lower case, no accents, non-alphanumerics -> "_"). */
export const ALUMNI_HEADER_ALIASES: Record<string, AlumniCsvColumn> = {
  // en
  first: "first_name", firstname: "first_name", given_name: "first_name",
  last: "last_name", lastname: "last_name", surname: "last_name", family_name: "last_name",
  year_of_birth: "birth_year", born: "birth_year", yob: "birth_year",
  sex: "gender", nationality_country: "nationality",
  e_mail: "email", email_address: "email", mail: "email",
  phone_number: "phone", mobile: "phone", cell: "phone", telephone: "phone",
  whats_app: "whatsapp",
  ig: "instagram", twitter: "x_handle", x: "x_handle", linkedin: "linkedin_url",
  highlights: "highlight_url", highlight_video: "highlight_url", video: "highlight_url", hudl: "highlight_url",
  parent_name: "guardian_name", parent_email: "guardian_email", parent_phone: "guardian_phone",
  consent: "contact_consent", consent_date: "contact_consent_on", consent_source: "contact_consent_source",
  public_consent: "showcase_consent", showcase: "showcase_consent", showcase_date: "showcase_consent_on",
  contact_status: "status",
  school: "institution", university: "institution", college: "institution", club: "institution", team: "institution", program: "institution", institution_name: "institution",
  type: "institution_type", division: "institution_type", institution_kind: "institution_type",
  city: "city_state", state: "city_state", region: "city_state",
  conference: "league", league_conference: "league",
  start: "start_date", started: "start_date", start_year: "start_date",
  grad_year: "graduation_year", class_of: "graduation_year", class: "graduation_year", expected_graduation: "graduation_year", end_year: "graduation_year",
  scholarship_type: "scholarship", status_placement: "placement_status",
  is_current: "current", current_placement: "current",
  roster: "roster_url", roster_link: "roster_url", source: "source_note",
  // fr
  prenom: "first_name", nom: "last_name", nom_de_famille: "last_name", annee_de_naissance: "birth_year", annee_naissance: "birth_year",
  genre: "gender", sexe: "gender", nationalite: "nationality", courriel: "email", telephone_mobile: "phone", portable: "phone", natel: "phone",
  nom_parent: "guardian_name", nom_du_responsable: "guardian_name", email_parent: "guardian_email", telephone_parent: "guardian_phone",
  consentement: "contact_consent", consentement_contact: "contact_consent", date_consentement: "contact_consent_on",
  consentement_public: "showcase_consent", statut: "status", etiquettes: "tags", remarques: "notes",
  etablissement: "institution", ecole: "institution", universite: "institution", type_etablissement: "institution_type",
  pays: "country", ville: "city_state", ligue: "league", niveau: "level", sport_pratique: "sport", poste: "position",
  date_debut: "start_date", annee_diplome: "graduation_year", annee_de_sortie: "graduation_year", bourse: "scholarship",
  statut_placement: "placement_status", actuel: "current", lien_effectif: "roster_url",
  // de
  vorname: "first_name", nachname: "last_name", familienname: "last_name", jahrgang: "birth_year", geburtsjahr: "birth_year",
  geschlecht: "gender", nationalitaet: "nationality", staatsangehoerigkeit: "nationality", e_mail_adresse: "email",
  telefon: "phone", handy: "phone", mobil: "phone",
  name_erziehungsberechtigte: "guardian_name", eltern_name: "guardian_name", eltern_email: "guardian_email", eltern_telefon: "guardian_phone",
  einwilligung: "contact_consent", einwilligung_kontakt: "contact_consent", einwilligung_datum: "contact_consent_on",
  einwilligung_oeffentlich: "showcase_consent", kontaktstatus: "status", stichworte: "tags", notizen: "notes", bemerkungen: "notes",
  institution_schule: "institution", schule: "institution", universitaet: "institution", verein: "institution", typ: "institution_type",
  land: "country", ort: "city_state", stadt: "city_state", liga: "league", stufe: "level", sportart: "sport",
  startdatum: "start_date", beginn: "start_date", abschlussjahr: "graduation_year", stipendium: "scholarship",
  platzierungsstatus: "placement_status", aktuell: "current",
};

export function normaliseAlumniHeader(h: string): string {
  const k = h.trim().toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/ß/g, "ss")
    .replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
  if ((ALUMNI_CSV_COLUMNS as readonly string[]).includes(k)) return k;
  return ALUMNI_HEADER_ALIASES[k] ?? k;
}

const key = (v: string) => v.trim().toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();

/** "NCAA D2", "Division II", "D-II", "Div 2", "ncaa_d2" … -> institution type; null when unknown. */
export function parseInstitutionType(raw: string): InstitutionType | null {
  const s = key(raw);
  if (!s) return null;
  const compact = s.replace(/\s+/g, "_");
  if ((INSTITUTION_TYPES as readonly string[]).includes(compact)) return compact as InstitutionType;
  // Junior colleges have divisions too (NJCAA Division I): check them before NCAA.
  if (/\b(njcaa|juco|junior college|community college|cccaa|nwac)\b/.test(s)) return "junior_college";
  if (/\bnaia\b/.test(s)) return "naia";
  if (/\bu ?sports\b|\bcis\b/.test(s)) return "u_sports";
  const div = s.match(/(?:^|\b)(?:ncaa\s*)?(?:division|div|d)\s*(iii|ii|i|1|2|3)\b/);
  if (div) return ({ i: "ncaa_d1", "1": "ncaa_d1", ii: "ncaa_d2", "2": "ncaa_d2", iii: "ncaa_d3", "3": "ncaa_d3" } as const)[div[1] as "i"];
  if (/\b(prep|academy|academie|akademie|accademia|academia|post ?grad|pg year|boarding)\b/.test(s)) return "prep_academy";
  if (/\b(high school|hs|secondary|lycee|gymnase|gymnasium|college secondaire|scuola superiore)\b/.test(s)) return "high_school";
  if (/\b(national team|equipe nationale|nationalmannschaft|nazionale|seleccion|selection nationale|federation)\b/.test(s)) return "national_team";
  if (/\b(pro|professional|professionnel|profi|euroleague|nba|g league|wnba)\b/.test(s)) return "pro_club";
  if (/\b(club|amateur|verein|amateurs?)\b/.test(s)) return "club_amateur";
  if (/\bncaa\b/.test(s)) return null; // NCAA without a division: ask
  if (/\bother|autre|andere|altro|otro\b/.test(s)) return "other";
  return null;
}

const SCHOLARSHIP_ALIASES: Record<string, Scholarship> = {
  full: "full", "full ride": "full", "full scholarship": "full", complete: "full", "bourse complete": "full", voll: "full", vollstipendium: "full",
  partial: "partial", part: "partial", "partial scholarship": "partial", partielle: "partial", "bourse partielle": "partial", teil: "partial", teilstipendium: "partial",
  "walk on": "walk_on", walkon: "walk_on", "preferred walk on": "walk_on", pwo: "walk_on",
  none: "none", no: "none", aucune: "none", non: "none", keine: "none", nein: "none",
  unknown: "unknown", inconnu: "unknown", unbekannt: "unknown", "": "unknown",
};

export function parseScholarship(raw: string): Scholarship | null {
  const s = key(raw);
  if ((SCHOLARSHIPS as readonly string[]).includes(s.replace(/\s+/g, "_"))) return s.replace(/\s+/g, "_") as Scholarship;
  return SCHOLARSHIP_ALIASES[s] ?? null;
}

const PLACEMENT_STATUS_ALIASES: Record<string, AlumniPlacementStatus> = {
  committed: "committed", commit: "committed", verbal: "committed", engage: "committed", zugesagt: "committed",
  signed: "signed", nli: "signed", signe: "signed", unterschrieben: "signed",
  enrolled: "enrolled", current: "enrolled", inscrit: "enrolled", eingeschrieben: "enrolled", active: "enrolled",
  transferred: "transferred", transfer: "transferred", transfere: "transferred", gewechselt: "transferred",
  graduated: "graduated", alumni: "graduated", diplome: "graduated", abgeschlossen: "graduated",
  "turned pro": "turned_pro", pro: "turned_pro", professionnel: "turned_pro", profi: "turned_pro",
  left: "left", quit: "left", parti: "left", ausgetreten: "left",
};
export function parsePlacementStatus(raw: string): AlumniPlacementStatus | null {
  const s = key(raw);
  const c = s.replace(/\s+/g, "_");
  if ((PLACEMENT_STATUSES as readonly string[]).includes(c)) return c as AlumniPlacementStatus;
  return PLACEMENT_STATUS_ALIASES[s] ?? null;
}

const CONTACT_STATUS_ALIASES: Record<string, AlumniStatus> = {
  active: "active", "active contact": "active", actif: "active", aktiv: "active", "in touch": "active",
  "lost touch": "lost_touch", lost: "lost_touch", "contact perdu": "lost_touch", "kein kontakt": "lost_touch",
  "do not contact": "do_not_contact", dnc: "do_not_contact", "ne pas contacter": "do_not_contact", "nicht kontaktieren": "do_not_contact",
};
export function parseContactStatus(raw: string): AlumniStatus | null {
  const s = key(raw);
  const c = s.replace(/\s+/g, "_");
  if ((ALUMNI_STATUSES as readonly string[]).includes(c)) return c as AlumniStatus;
  return CONTACT_STATUS_ALIASES[s] ?? null;
}

export function parseBool(raw: string): boolean | null {
  const s = key(raw);
  if (!s) return null;
  if (["yes", "y", "true", "1", "x", "oui", "o", "ja", "j", "si", "sì", "vrai", "wahr"].includes(s)) return true;
  if (["no", "n", "false", "0", "non", "nein", "falsch", "faux"].includes(s)) return false;
  return null;
}

const GENDER_ALIASES: Record<string, "female" | "male" | "other"> = {
  f: "female", female: "female", woman: "female", w: "female", femme: "female", feminin: "female", weiblich: "female", frau: "female",
  m: "male", male: "male", man: "male", homme: "male", masculin: "male", maennlich: "male", mannlich: "male", mann: "male", h: "male",
  other: "other", autre: "other", divers: "other", d: "other",
};

export type AlumniImportRow = {
  row: number;
  person: {
    first_name: string; last_name: string; birth_year: number | null; gender: string | null; nationality: string | null;
    email: string | null; phone: string | null; whatsapp: boolean; instagram: string | null; x_handle: string | null;
    linkedin_url: string | null; highlight_url: string | null; guardian_name: string | null; guardian_email: string | null;
    guardian_phone: string | null; contact_consent: boolean; contact_consent_on: string | null; contact_consent_source: string | null;
    showcase_consent: boolean; showcase_consent_on: string | null; status: AlumniStatus; tags: string[]; notes: string | null;
  };
  placement: {
    institution: string; institution_type: InstitutionType; country: string | null; region: string | null; league: string | null;
    level: string | null; sport: string | null; position: string | null; start_date: string | null; end_year: number | null;
    scholarship: Scholarship; status: AlumniPlacementStatus; is_current: boolean; roster_url: string | null; source_note: string | null;
  } | null;
};

/** Problem in the file; `key` is under alumni.import.issues.*. */
export type AlumniImportIssue = { row: number; field?: string; key: string; value?: string };

export type AlumniImportPlan = { rows: AlumniImportRow[]; issues: AlumniImportIssue[]; unknownColumns: string[]; people: number };

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const PHONE_RE = /^\+?[0-9 ().-]{4,40}$/;
const URL_RE = /^https?:\/\/\S+$/i;

/** Person identity for grouping rows: email, else name + birth year. */
export function personKey(p: { first_name: string; last_name: string; birth_year: number | null; email: string | null }): string {
  return p.email ? `e:${p.email.toLowerCase()}` : `n:${key(p.first_name)}|${key(p.last_name)}|${p.birth_year ?? ""}`;
}

export function buildAlumniImportPlan(text: string, order: DateOrder = "DMY", currentYear = new Date().getUTCFullYear()): AlumniImportPlan {
  return buildAlumniImportPlanFromTable(parseCsv(text), order, currentYear);
}

export function buildAlumniImportPlanFromTable(table: string[][], order: DateOrder = "DMY", currentYear = new Date().getUTCFullYear()): AlumniImportPlan {
  const issues: AlumniImportIssue[] = [];
  const rows: AlumniImportRow[] = [];
  const [header, ...body] = table.filter((r) => r.some((c) => c.trim() !== ""));
  if (!header) return { rows, issues: [{ row: 0, key: "empty" }], unknownColumns: [], people: 0 };
  const cols = header.map(normaliseAlumniHeader);
  const unknownColumns = header.filter((_, i) => !(ALUMNI_CSV_COLUMNS as readonly string[]).includes(cols[i]!));
  for (const need of ["first_name", "last_name"] as const) {
    if (!cols.includes(need)) issues.push({ row: 0, field: need, key: "missingColumn" });
  }
  if (issues.length) return { rows, issues, unknownColumns, people: 0 };
  if (body.length > ALUMNI_MAX_ROWS) return { rows, issues: [{ row: 0, key: "tooManyRows", value: String(ALUMNI_MAX_ROWS) }], unknownColumns, people: 0 };

  body.forEach((cells, i) => {
    const rowNo = i + 2;
    const get = (c: AlumniCsvColumn) => {
      const idx = cols.indexOf(c);
      return idx >= 0 ? (cells[idx] ?? "").trim() : "";
    };
    const bad = (field: AlumniCsvColumn, value: string) => issues.push({ row: rowNo, field, key: "invalid", value });
    const optText = (c: AlumniCsvColumn, max: number) => {
      const v = get(c);
      if (v.length > max) { bad(c, v.slice(0, 40)); return null; }
      return v || null;
    };
    const date = (c: AlumniCsvColumn) => {
      const v = get(c);
      if (!v) return null;
      if (/^\d{4}$/.test(v)) return `${v}-01-01`;
      const d = parseDate(v, order);
      if (!d) bad(c, v);
      return d;
    };
    const bool = (c: AlumniCsvColumn) => {
      const v = get(c);
      if (!v) return null;
      const b = parseBool(v);
      if (b === null) bad(c, v);
      return b;
    };
    const first = get("first_name");
    const last = get("last_name");
    if (!first || !last) {
      issues.push({ row: rowNo, field: !first ? "first_name" : "last_name", key: "required" });
      return;
    }
    if (first.length > 80 || last.length > 80) { bad(first.length > 80 ? "first_name" : "last_name", ""); return; }

    let birthYear: number | null = null;
    const by = get("birth_year");
    if (by) {
      const iso = /^\d{4}$/.test(by) ? null : parseDate(by, order);
      const y = iso ? Number(iso.slice(0, 4)) : Number(by);
      if (Number.isInteger(y) && y >= 1900 && y <= currentYear) birthYear = y; else bad("birth_year", by);
    }
    const email = get("email").toLowerCase() || null;
    if (email && !EMAIL_RE.test(email)) bad("email", email);
    const phone = get("phone") || null;
    if (phone && !PHONE_RE.test(phone)) bad("phone", phone);
    const gEmail = get("guardian_email").toLowerCase() || null;
    if (gEmail && !EMAIL_RE.test(gEmail)) bad("guardian_email", gEmail);
    const gPhone = get("guardian_phone") || null;
    if (gPhone && !PHONE_RE.test(gPhone)) bad("guardian_phone", gPhone);
    const url = (c: AlumniCsvColumn) => {
      const v = get(c);
      if (!v) return null;
      if (!URL_RE.test(v) || v.length > 500) { bad(c, v.slice(0, 40)); return null; }
      return v;
    };
    const genderRaw = get("gender");
    const gender = genderRaw ? GENDER_ALIASES[key(genderRaw)] ?? null : null;
    if (genderRaw && !gender) bad("gender", genderRaw);
    const statusRaw = get("status");
    const status = statusRaw ? parseContactStatus(statusRaw) : "active";
    if (!status) bad("status", statusRaw);
    const contactConsent = bool("contact_consent") ?? false;
    const showcaseConsent = bool("showcase_consent") ?? false;

    const person: AlumniImportRow["person"] = {
      first_name: first, last_name: last, birth_year: birthYear, gender, nationality: optText("nationality", 80),
      email: email && EMAIL_RE.test(email) ? email : null, phone: phone && PHONE_RE.test(phone) ? phone : null,
      whatsapp: bool("whatsapp") ?? false, instagram: optText("instagram", 100), x_handle: optText("x_handle", 100),
      linkedin_url: url("linkedin_url"), highlight_url: url("highlight_url"),
      guardian_name: optText("guardian_name", 160), guardian_email: gEmail && EMAIL_RE.test(gEmail) ? gEmail : null,
      guardian_phone: gPhone && PHONE_RE.test(gPhone) ? gPhone : null,
      contact_consent: contactConsent, contact_consent_on: date("contact_consent_on") ?? (contactConsent ? new Date().toISOString().slice(0, 10) : null),
      contact_consent_source: optText("contact_consent_source", 200) ?? (contactConsent ? "import" : null),
      showcase_consent: showcaseConsent, showcase_consent_on: date("showcase_consent_on") ?? (showcaseConsent ? new Date().toISOString().slice(0, 10) : null),
      status: status ?? "active",
      tags: get("tags").split(/[,;|]/).map((x) => x.trim()).filter(Boolean).slice(0, 20).map((x) => x.slice(0, 40)),
      notes: optText("notes", 4000),
    };
    if (birthYear && currentYear - birthYear < 19 && (!person.guardian_name || (!person.guardian_email && !person.guardian_phone))) {
      issues.push({ row: rowNo, field: "guardian_name", key: "guardianRequired" });
      return;
    }

    let placement: AlumniImportRow["placement"] = null;
    const institution = get("institution");
    if (institution) {
      const typeRaw = get("institution_type");
      const type = typeRaw ? parseInstitutionType(typeRaw) : (parseInstitutionType(get("level")) ?? "other");
      if (typeRaw && !type) issues.push({ row: rowNo, field: "institution_type", key: "unknownType", value: typeRaw });
      const schRaw = get("scholarship");
      const scholarship = schRaw ? parseScholarship(schRaw) : "unknown";
      if (!scholarship) bad("scholarship", schRaw);
      const stRaw = get("placement_status");
      const pStatus = stRaw ? parsePlacementStatus(stRaw) : "enrolled";
      if (!pStatus) bad("placement_status", stRaw);
      const gy = get("graduation_year");
      let endYear: number | null = null;
      if (gy) {
        const y = Number(gy.replace(/^class of\s*/i, "").replace(/^'/, ""));
        const full = y < 100 ? 2000 + y : y;
        if (Number.isInteger(full) && full >= 1950 && full <= 2100) endYear = full; else bad("graduation_year", gy);
      }
      placement = {
        institution: institution.slice(0, 160), institution_type: type ?? "other",
        country: optText("country", 80), region: optText("city_state", 120), league: optText("league", 120), level: optText("level", 120),
        sport: optText("sport", 60), position: optText("position", 60), start_date: date("start_date"), end_year: endYear,
        scholarship: scholarship ?? "unknown", status: pStatus ?? "enrolled", is_current: bool("current") ?? true,
        roster_url: url("roster_url"), source_note: optText("source_note", 1000),
      };
    }
    rows.push({ row: rowNo, person, placement });
  });
  return { rows, issues, unknownColumns, people: new Set(rows.map((r) => personKey(r.person))).size };
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

function cell(v: unknown): string {
  const s = v === null || v === undefined ? "" : Array.isArray(v) ? v.join(", ") : typeof v === "boolean" ? (v ? "yes" : "no") : String(v);
  // Neutralise spreadsheet formulas; quote separators, quotes and newlines.
  const safe = /^[=+\-@\t\r]/.test(s) && !/^[+-]?\d[\d\s().-]*$/.test(s) ? `'${s}` : s;
  return /[",;\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export type ExportPerson = Record<string, unknown> & { placements: Record<string, unknown>[] };

/** One line per placement (or one line for a person without placement), template column order. */
export function alumniToCsv(people: ExportPerson[]): string {
  const lines = [ALUMNI_CSV_COLUMNS.join(",")];
  for (const p of people) {
    const base = (c: AlumniCsvColumn): unknown => p[c];
    const pls = p.placements.length ? p.placements : [null];
    for (const pl of pls) {
      lines.push(ALUMNI_CSV_COLUMNS.map((c) => {
        if (["institution", "institution_type", "country", "league", "level", "sport", "position", "start_date", "scholarship", "roster_url", "source_note"].includes(c)) return cell(pl?.[c]);
        if (c === "city_state") return cell(pl?.region);
        if (c === "graduation_year") return cell(pl?.end_year);
        if (c === "placement_status") return cell(pl?.status);
        if (c === "current") return cell(pl ? pl.is_current : null);
        return cell(base(c));
      }).join(","));
    }
  }
  return lines.join("\n") + "\n";
}

/** Empty template with one synthetic example line (documentation for the club). */
export const ALUMNI_TEMPLATE_CSV = [
  ALUMNI_CSV_COLUMNS.join(","),
  "Alex,Example,2002,male,,alex@example.test,+41 79 000 00 00,yes,,,,https://example.test/highlights,,,,yes,2026-01-15,In person,no,,active,class-2024,,Example State University,NCAA D1,USA,Texas,Example Conference,,Basketball,Guard,2024-08-15,2028,full,enrolled,yes,https://example.test/roster,Coach email",
].join("\n") + "\n";
