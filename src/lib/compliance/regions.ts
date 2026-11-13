/**
 * Region model for privacy compliance. Pure + isomorphic (safe on client).
 *
 * A tenant (club / school / organisation) is mapped to ONE primary regulatory
 * region from its country (or an explicit `data_region` override stored in
 * public.compliance_settings). The region decides which frameworks apply.
 */

export type ComplianceRegion = "CH" | "EU" | "UK" | "US" | "OTHER";

export type OrgType =
  | "club"
  | "team"
  | "school"
  | "school_district"
  | "federation"
  | "academy"
  | "camp_provider"
  | "organization"
  | "other";

/** EU-27 member states. */
export const EU_COUNTRIES = [
  "AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR", "HU", "IE",
  "IT", "LV", "LT", "LU", "MT", "NL", "PL", "PT", "RO", "SK", "SI", "ES", "SE",
] as const;

/** EEA non-EU states: GDPR applies via the EEA Agreement. */
export const EEA_EXTRA = ["IS", "LI", "NO"] as const;

/** Countries whose law requires a publicly reachable imprint / provider notice. */
export const IMPRINT_REQUIRED = new Set<string>(["CH", "DE", "AT", "LI", "LU"]);

/**
 * GDPR Art. 8 digital age of consent per member state (information-society
 * services offered directly to a child). Default 16 where not lowered.
 * Source: national implementing laws — verify with counsel before relying on it.
 */
export const GDPR_CHILD_CONSENT_AGE: Record<string, number> = {
  AT: 14, BE: 13, BG: 14, HR: 16, CY: 14, CZ: 15, DK: 13, EE: 13, FI: 13, FR: 15,
  DE: 16, GR: 15, HU: 16, IE: 16, IT: 14, LV: 13, LT: 14, LU: 16, MT: 13, NL: 16,
  PL: 16, PT: 13, RO: 16, SK: 16, SI: 15, ES: 14, SE: 13, IS: 13, LI: 16, NO: 13,
};

/** Data-protection supervisory authority per region / country (for notices). */
export const SUPERVISORY_AUTHORITY: Record<string, string> = {
  CH: "Federal Data Protection and Information Commissioner (FDPIC), Bern — www.edoeb.admin.ch",
  DE: "The competent German state data protection authority (Landesdatenschutzbehörde)",
  FR: "Commission nationale de l'informatique et des libertés (CNIL) — www.cnil.fr",
  AT: "Österreichische Datenschutzbehörde — www.dsb.gv.at",
  IT: "Garante per la protezione dei dati personali — www.garanteprivacy.it",
  ES: "Agencia Española de Protección de Datos (AEPD) — www.aepd.es",
  NL: "Autoriteit Persoonsgegevens — www.autoriteitpersoonsgegevens.nl",
  IE: "Data Protection Commission — www.dataprotection.ie",
  BE: "Autorité de protection des données / Gegevensbeschermingsautoriteit",
  LU: "Commission nationale pour la protection des données (CNPD)",
  UK: "Information Commissioner's Office (ICO) — ico.org.uk",
  GB: "Information Commissioner's Office (ICO) — ico.org.uk",
  US: "Federal Trade Commission (FTC); state Attorneys General; California Privacy Protection Agency (CPPA) where CCPA applies",
};

/**
 * US states with comprehensive consumer-privacy statutes in force (selection).
 * Most apply only above revenue / volume thresholds, and many exempt
 * non-profits — the org must assess applicability with counsel.
 */
export const US_STATE_PRIVACY_LAWS: Record<string, string> = {
  CA: "CCPA as amended by CPRA (Cal. Civ. Code §1798.100 et seq.)",
  CO: "Colorado Privacy Act (applies to some non-profits)",
  CT: "Connecticut Data Privacy Act",
  VA: "Virginia Consumer Data Protection Act",
  UT: "Utah Consumer Privacy Act",
  TX: "Texas Data Privacy and Security Act",
  OR: "Oregon Consumer Privacy Act (applies to non-profits)",
  MT: "Montana Consumer Data Privacy Act",
  IA: "Iowa Consumer Data Protection Act",
  DE: "Delaware Personal Data Privacy Act (applies to non-profits)",
  NH: "New Hampshire Privacy Act",
  NJ: "New Jersey Data Privacy Act (applies to non-profits)",
  NE: "Nebraska Data Privacy Act",
  TN: "Tennessee Information Protection Act",
  MN: "Minnesota Consumer Data Privacy Act (applies to non-profits)",
  MD: "Maryland Online Data Privacy Act",
  IN: "Indiana Consumer Data Protection Act",
  KY: "Kentucky Consumer Data Protection Act",
  RI: "Rhode Island Data Transparency and Privacy Protection Act",
};

/** State student-privacy laws relevant to ed-tech vendors (selection). */
export const US_STUDENT_PRIVACY_LAWS: Record<string, string> = {
  CA: "SOPIPA (Cal. Bus. & Prof. Code §22584) and AB 1584 (Ed. Code §49073.1)",
  NY: "Education Law §2-d and 8 NYCRR Part 121",
  IL: "Student Online Personal Protection Act (SOPPA)",
  CT: "Conn. Gen. Stat. §10-234aa et seq.",
  CO: "Student Data Transparency and Security Act",
  TX: "Texas Education Code ch. 32 subch. D",
  UT: "Utah Student Data Protection Act",
  VA: "Va. Code §22.1-289.01",
};

export function normaliseCountry(country: string | null | undefined): string {
  const c = (country ?? "").trim().toUpperCase();
  return c === "GB" ? "UK" : c;
}

export function regionForCountry(country: string | null | undefined): ComplianceRegion {
  const c = normaliseCountry(country);
  if (c === "CH") return "CH";
  if (c === "US") return "US";
  if (c === "UK") return "UK";
  if ((EU_COUNTRIES as readonly string[]).includes(c) || (EEA_EXTRA as readonly string[]).includes(c)) return "EU";
  return "OTHER";
}

export function isRegion(v: unknown): v is ComplianceRegion {
  return v === "CH" || v === "EU" || v === "UK" || v === "US" || v === "OTHER";
}
