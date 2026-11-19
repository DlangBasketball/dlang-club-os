import {
  GDPR_CHILD_CONSENT_AGE,
  IMPRINT_REQUIRED,
  SUPERVISORY_AUTHORITY,
  US_STATE_PRIVACY_LAWS,
  US_STUDENT_PRIVACY_LAWS,
  isRegion,
  normaliseCountry,
  regionForCountry,
  type ComplianceRegion,
  type OrgType,
} from "./regions";
import { defaultRetentionSchedule, type DataCategory } from "./retention";

/** Minimal org shape — works with organizations rows and compliance_settings. */
export type ComplianceOrgInput = {
  country?: string | null;
  /** Explicit override (compliance_settings.data_region or a future org column). */
  data_region?: string | null;
  org_type?: string | null;
  /** ISO 3166-2, e.g. "US-CA", "CH-VD", "DE-BY". */
  jurisdiction_subdivision?: string | null;
  /** Explicit list of US state laws the org has determined apply, e.g. ["CA"]. */
  us_state_laws?: string[] | null;
  coppa_applies?: boolean | null;
  ferpa_applies?: boolean | null;
};

export type Framework =
  | "nFADP"
  | "GDPR"
  | "UK_GDPR"
  | "ePrivacy"
  | "COPPA"
  | "FERPA"
  | "PPRA"
  | "CCPA_CPRA"
  | "US_STATE_PRIVACY"
  | "US_STATE_STUDENT_PRIVACY"
  | "CAN_SPAM";

export type CookieConsentModel = "opt_in" | "opt_out" | "notice_only";

export type ComplianceProfile = {
  region: ComplianceRegion;
  country: string;
  subdivision: string | null;
  orgType: OrgType;
  isSchool: boolean;
  frameworks: Framework[];
  /** Human-readable law names for notices. */
  laws: string[];
  supervisoryAuthority: string;
  /** Days to answer a standard access request. */
  dsarResponseDays: number;
  /** Hours from awareness to notify the authority of a reportable breach. */
  breachAuthorityHours: number;
  breachAuthorityRule: string;
  /** Age below which a parent/guardian must consent for online data processing. */
  childConsentAge: number;
  /** COPPA verifiable parental consent required for under-13s. */
  requiresVerifiableParentalConsent: boolean;
  /** Platform must be designated a "school official" in the school's FERPA notice. */
  requiresFerpaSchoolOfficial: boolean;
  requiresImprint: boolean;
  cookieConsent: CookieConsentModel;
  honorGlobalPrivacyControl: boolean;
  /** Record of processing activities duty (GDPR Art. 30 / nFADP Art. 12). */
  ropaRequired: boolean;
  /** Health data = special category / sensitive personal data. */
  healthDataIsSensitive: boolean;
  /** Recommended hosting region for the tenant database. */
  recommendedHosting: string;
  dataResidencyNote: string;
  retentionMonths: Record<DataCategory, number>;
  /** Items the org must still decide with counsel (shown in admin UI / docs). */
  openQuestions: string[];
};

const SCHOOL_TYPES: ReadonlySet<string> = new Set(["school", "school_district"]);

function toOrgType(v: string | null | undefined): OrgType {
  const allowed: OrgType[] = ["club", "team", "school", "school_district", "federation", "academy", "camp_provider", "organization", "other"];
  return (allowed as string[]).includes(v ?? "") ? (v as OrgType) : "club";
}

/**
 * Derive the compliance profile for a tenant.
 *  CH  -> nFADP (+ GDPR when targeting EU residents, flagged as open question)
 *  EU  -> GDPR + ePrivacy (national cookie law)
 *  UK  -> UK GDPR + PECR
 *  US  -> COPPA (children < 13) + state privacy laws (CCPA/CPRA etc.) + CAN-SPAM;
 *         FERPA (+ PPRA + state student-privacy laws) when the org is a school.
 */
export function getComplianceProfile(org: ComplianceOrgInput): ComplianceProfile {
  const country = normaliseCountry(org.country) || "CH";
  const region: ComplianceRegion = isRegion(org.data_region) ? org.data_region : regionForCountry(country);
  const orgType = toOrgType(org.org_type);
  const isSchool = SCHOOL_TYPES.has(orgType);
  const subdivision = org.jurisdiction_subdivision ?? null;
  const stateCode = subdivision?.startsWith("US-") ? subdivision.slice(3) : null;

  const frameworks: Framework[] = [];
  const laws: string[] = [];
  const openQuestions: string[] = [];

  let dsarResponseDays = 30;
  let breachAuthorityHours = 72;
  let breachAuthorityRule = "";
  let childConsentAge = 16;
  let cookieConsent: CookieConsentModel = "opt_in";
  let requiresVpc = false;
  let requiresFerpa = false;
  let recommendedHosting = "eu-central-1 (Frankfurt)";
  let dataResidencyNote = "";

  switch (region) {
    case "CH":
      frameworks.push("nFADP");
      laws.push("Swiss Federal Act on Data Protection (nFADP / revFADP, SR 235.1) and Data Protection Ordinance (FADO, SR 235.11)");
      breachAuthorityRule = "nFADP Art. 24: notify the FDPIC as soon as possible where the breach is likely to result in a high risk; 72 h applied as internal target.";
      childConsentAge = 16; // no fixed age in nFADP; capacity of judgement — 16 used as conservative operating rule
      cookieConsent = "opt_in"; // Swiss law (TCA Art. 45c) requires information + opt-out; opt-in chosen to align with EU visitors
      recommendedHosting = "eu-central-1 (Frankfurt) or eu-central-2 (Zurich)";
      dataResidencyNote =
        "Switzerland recognises the EU/EEA as adequate (FADO Annex 1), so EU-region hosting is lawful for Swiss clubs. Transfers to US sub-processors rely on the Swiss-US Data Privacy Framework (certified recipients) or Swiss-adapted SCCs.";
      openQuestions.push(
        "Does the club actively offer services to people in the EU (e.g. camps marketed in France)? If so GDPR Art. 3(2) may apply and an EU representative (Art. 27) may be needed.",
        "Confirm the age from which a child can consent alone (capacity of judgement, typically 13-16 in Swiss practice).",
      );
      break;
    case "EU":
      frameworks.push("GDPR", "ePrivacy");
      laws.push("EU General Data Protection Regulation (GDPR, Regulation (EU) 2016/679)", "national ePrivacy / cookie law (Directive 2002/58/EC as implemented)");
      breachAuthorityRule = "GDPR Art. 33: notify the lead supervisory authority within 72 hours of becoming aware, unless unlikely to result in a risk.";
      childConsentAge = GDPR_CHILD_CONSENT_AGE[country] ?? 16;
      dataResidencyNote =
        "Host in an EU region (Frankfurt). Transfers to US sub-processors rely on the EU-US Data Privacy Framework (certified recipients) or SCCs (Decision 2021/914) with a transfer impact assessment.";
      openQuestions.push("Is a Data Protection Officer mandatory (large-scale processing of children's health data may trigger Art. 37(1)(c))?");
      break;
    case "UK":
      frameworks.push("UK_GDPR", "ePrivacy");
      laws.push("UK GDPR and Data Protection Act 2018", "Privacy and Electronic Communications Regulations (PECR)", "ICO Age Appropriate Design Code");
      breachAuthorityRule = "UK GDPR Art. 33: notify the ICO within 72 hours.";
      childConsentAge = 13;
      dataResidencyNote = "The UK recognises the EEA as adequate; EU hosting is acceptable. US transfers rely on the UK Extension to the EU-US DPF or the IDTA/Addendum.";
      break;
    case "US": {
      frameworks.push("COPPA", "CAN_SPAM");
      laws.push("Children's Online Privacy Protection Act (COPPA, 15 U.S.C. §6501; 16 CFR Part 312, as amended 2025)", "CAN-SPAM Act");
      dsarResponseDays = 45;
      breachAuthorityHours = 30 * 24;
      breachAuthorityRule = "US state breach-notification laws: typically 30-60 days to notify affected residents and, above thresholds, the state Attorney General. Check each affected resident's state.";
      childConsentAge = 13;
      requiresVpc = org.coppa_applies !== false; // youth sports collect data from under-13s by default
      cookieConsent = "opt_out";
      recommendedHosting = "us-east-1 (N. Virginia) for US-only tenants; EU region acceptable";
      dataResidencyNote = "No federal residency requirement. Some school districts contractually require US-only storage — check the district's data-privacy agreement.";
      const states = new Set<string>((org.us_state_laws ?? []).map((s) => s.toUpperCase()));
      if (stateCode) states.add(stateCode);
      const stateLaws = [...states].filter((s) => US_STATE_PRIVACY_LAWS[s]);
      if (stateLaws.length) {
        frameworks.push("US_STATE_PRIVACY");
        if (states.has("CA")) frameworks.push("CCPA_CPRA");
        for (const s of stateLaws) laws.push(US_STATE_PRIVACY_LAWS[s]);
      }
      openQuestions.push(
        "Which state privacy laws apply? Most have revenue/volume thresholds and many exempt non-profits (CO, OR, DE, NJ, MN do not).",
        "Is the org a non-profit? CCPA does not apply to most non-profits, COPPA does.",
      );
      if (isSchool) {
        requiresFerpa = org.ferpa_applies !== false;
        frameworks.push("FERPA", "PPRA");
        laws.push("Family Educational Rights and Privacy Act (FERPA, 20 U.S.C. §1232g; 34 CFR Part 99)", "Protection of Pupil Rights Amendment (PPRA)");
        if (stateCode && US_STUDENT_PRIVACY_LAWS[stateCode]) {
          frameworks.push("US_STATE_STUDENT_PRIVACY");
          laws.push(US_STUDENT_PRIVACY_LAWS[stateCode]);
        }
        openQuestions.push("Has the school listed the platform as a 'school official' in its annual FERPA notification and signed the Student-Data Addendum?");
      }
      break;
    }
    default:
      frameworks.push("GDPR");
      laws.push("Applicable local data-protection law (GDPR-equivalent baseline applied)");
      breachAuthorityRule = "Local law — 72 h baseline applied.";
      dataResidencyNote = "Baseline: EU hosting. Check local localisation rules (e.g. some countries require in-country storage of minors' data).";
      openQuestions.push("Identify the applicable national data-protection law before onboarding this tenant.");
  }

  // Sport-for-minors defaults are the same everywhere.
  return {
    region,
    country,
    subdivision,
    orgType,
    isSchool,
    frameworks,
    laws,
    supervisoryAuthority: SUPERVISORY_AUTHORITY[country] ?? SUPERVISORY_AUTHORITY[region] ?? "The competent data-protection authority",
    dsarResponseDays,
    breachAuthorityHours,
    breachAuthorityRule,
    childConsentAge,
    requiresVerifiableParentalConsent: requiresVpc,
    requiresFerpaSchoolOfficial: requiresFerpa,
    requiresImprint: IMPRINT_REQUIRED.has(country),
    cookieConsent,
    honorGlobalPrivacyControl: true,
    ropaRequired: region !== "US", // GDPR Art. 30(5) exemption rarely applies to health data of minors
    healthDataIsSensitive: true,
    recommendedHosting,
    dataResidencyNote,
    retentionMonths: defaultRetentionSchedule(region),
    openQuestions,
  };
}

export function frameworkLabel(f: Framework): string {
  const m: Record<Framework, string> = {
    nFADP: "Swiss nFADP",
    GDPR: "EU GDPR",
    UK_GDPR: "UK GDPR",
    ePrivacy: "ePrivacy / cookies",
    COPPA: "COPPA",
    FERPA: "FERPA",
    PPRA: "PPRA",
    CCPA_CPRA: "CCPA / CPRA",
    US_STATE_PRIVACY: "US state privacy laws",
    US_STATE_STUDENT_PRIVACY: "State student-privacy law",
    CAN_SPAM: "CAN-SPAM",
  };
  return m[f];
}
