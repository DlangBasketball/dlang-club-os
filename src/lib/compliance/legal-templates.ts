/**
 * Tenant legal pages rendered from templates + tenant variables.
 *
 * Output is structured data (never raw HTML), so tenant-supplied values can't
 * inject markup. Every template carries a "review by counsel" flag; the long-
 * form master templates live in docs/legal/.
 *
 * TEMPLATE TEXT — NOT LEGAL ADVICE. Each club must have its notices reviewed
 * by qualified counsel in its jurisdiction before relying on them.
 */
import { CATEGORY_INFO, type ConsentCategory } from "./cookies";
import { frameworkLabel, type ComplianceProfile } from "./profile";
import { DATA_CATEGORY_LABELS, formatMonths, type DataCategory } from "./retention";

export const LEGAL_DOCS = ["privacy", "terms", "imprint", "cookies"] as const;
export type LegalDocKey = (typeof LEGAL_DOCS)[number];

export const LEGAL_DOC_TITLES: Record<LegalDocKey, string> = {
  privacy: "Privacy notice",
  terms: "Terms of use",
  imprint: "Imprint",
  cookies: "Cookie policy",
};

export function isLegalDoc(v: string): v is LegalDocKey {
  return (LEGAL_DOCS as readonly string[]).includes(v);
}

export const PLATFORM_NAME = process.env.NEXT_PUBLIC_PLATFORM_NAME ?? "DLANG Sports OS";

export type LegalSubprocessor = { name: string; service: string; location: string; mechanism: string | null };

export type LegalTenant = {
  slug: string;
  clubName: string;
  legalName: string;
  address: string;
  contactEmail: string;
  contactPhone: string;
  website: string;
  country: string;
  companyRegisterId: string;
  vatId: string;
  representative: string;     // person authorised to represent (imprint)
  dpoName: string;
  dpoEmail: string;
  euRepresentative: string;
  chRepresentative: string;
  ferpaAnnualNoticeUrl: string;
  aiAssistantEnabled: boolean;
  lastUpdated: string;        // ISO date
  subprocessors: LegalSubprocessor[];
  /** Optional per-section text overrides: { "privacy.contact": "..." }. */
  overrides: Record<string, string>;
  profile: ComplianceProfile;
};

export type LegalSection = { id: string; heading: string; paragraphs: string[]; list?: string[] };
export type LegalDocument = {
  key: LegalDocKey;
  title: string;
  lastUpdated: string;
  intro: string;
  sections: LegalSection[];
  reviewNotice: string;
  missingFields: string[];
};

const REVIEW_NOTICE =
  "This notice is generated from a template provided by the platform. It must be reviewed and adapted by the club with qualified legal counsel; it does not constitute legal advice.";

function or(v: string, fallback: string) {
  return v && v.trim() ? v.trim() : fallback;
}

function section(t: LegalTenant, id: string, heading: string, paragraphs: string[], list?: string[]): LegalSection {
  const o = t.overrides[id];
  return o ? { id, heading, paragraphs: o.split(/\n{2,}/) } : { id, heading, paragraphs, list };
}

function contactLine(t: LegalTenant) {
  return [or(t.legalName, t.clubName), t.address, t.contactEmail, t.contactPhone].filter(Boolean).join(" · ");
}

// ---------------------------------------------------------------------------
function privacy(t: LegalTenant): LegalDocument {
  const p = t.profile;
  const club = t.clubName;
  const retentionRows: DataCategory[] = ["athlete_profile", "guardian_contact", "medical", "attendance", "financial", "consent_records", "media", "audit_logs"];
  const sections: LegalSection[] = [
    section(t, "privacy.controller", "1. Who is responsible", [
      `${or(t.legalName, club)} ("${club}", "we") is the controller of the personal data described in this notice. ${PLATFORM_NAME} provides the software we use and acts as our processor under a data processing agreement.`,
      `Contact: ${contactLine(t) || "[club contact details — to be completed]"}.`,
      ...(t.dpoEmail ? [`Data protection officer / privacy contact: ${or(t.dpoName, "Data protection officer")} — ${t.dpoEmail}.`] : []),
      ...(p.region === "CH" && t.euRepresentative ? [`EU representative (GDPR Art. 27): ${t.euRepresentative}.`] : []),
      ...(p.region !== "CH" && t.chRepresentative ? [`Swiss representative (nFADP Art. 14): ${t.chRepresentative}.`] : []),
    ]),
    section(t, "privacy.data", "2. What we collect", [
      "We only collect what we need to run our programmes safely:",
    ], [
      "Participant details: name, date of birth, gender (optional), school (optional), team and programme.",
      "Parent / guardian details: name, email, phone, address, relationship to the participant.",
      "Health information you choose to give us: allergies, conditions, medication, emergency contacts and insurance. This is sensitive data and only authorised staff can see it.",
      "Attendance, bookings and performance notes recorded by coaches.",
      "Billing data: invoices, payments and payment references. Card details are handled by our payment provider; we never see full card numbers.",
      "Consent records, including the exact text you accepted and when.",
      "Technical data: sign-in session, security logs and the IP address used for consent evidence.",
      ...(t.aiAssistantEnabled ? ["Questions you type into the in-app assistant (kept for a short period, see section 6)."] : []),
    ]),
    section(t, "privacy.purposes", "3. Why we use it and on what legal basis", [], [
      "Registering participants and running training, camps and events — performance of our contract with you.",
      "Invoicing, accounting and keeping financial records — legal obligation.",
      "Health information — your explicit consent, and to protect vital interests in an emergency.",
      "Photos and video for club communications — your consent, which you can withdraw at any time.",
      "Safety, security and preventing misuse of our systems — our legitimate interests.",
      "Service messages (schedule changes, payment reminders) — performance of contract. We send newsletters only with your consent.",
    ]),
    section(t, "privacy.children", "4. Children", [
      `Most of our participants are minors. A parent or guardian registers each child and manages their data. Below the age of ${p.childConsentAge} we always rely on the consent of the parent or guardian.`,
      ...(p.requiresVerifiableParentalConsent
        ? ["For children under 13 in the United States we obtain verifiable parental consent before collecting personal information, as required by COPPA. Parents can review their child's information, have it deleted and refuse further collection at any time, and can consent to collection without consenting to disclosure to third parties."]
        : []),
      "We do not sell children's data, do not use it for advertising and do not create profiles for marketing.",
    ]),
    section(t, "privacy.sharing", "5. Who we share it with", [
      "Inside the club, staff only see what their role requires (for example, coaches see their own athletes' attendance but not invoices or other families' data).",
      `Outside the club we use these service providers, bound by data processing agreements:`,
    ], t.subprocessors.map((s) => `${s.name} — ${s.service} (${s.location}${s.mechanism ? `; ${s.mechanism}` : ""})`)),
    section(t, "privacy.transfers", "6. International transfers and retention", [
      p.dataResidencyNote,
      "We keep data only as long as needed. Default retention periods (after membership ends unless stated):",
    ], retentionRows.map((c) => `${DATA_CATEGORY_LABELS[c]}: ${formatMonths(p.retentionMonths[c])}`).concat(
      t.aiAssistantEnabled ? [`${DATA_CATEGORY_LABELS.ai_queries}: ${formatMonths(p.retentionMonths.ai_queries)}`] : [],
    )),
    section(t, "privacy.rights", "7. Your rights", [
      `You can ask for access to, correction, deletion or a copy (portability) of your data, object to or restrict processing, and withdraw consent at any time. Parents and guardians exercise these rights on behalf of their children. Signed-in parents can download their data and request deletion from the account page; otherwise write to ${or(t.dpoEmail || t.contactEmail, "the club")}.`,
      `We answer within ${p.dsarResponseDays} days. Some records (for example invoices) must be kept for legal reasons even after a deletion request; we anonymise everything else.`,
      ...(p.frameworks.includes("CCPA_CPRA")
        ? ["California residents: we do not sell or share personal information for cross-context behavioural advertising. You may use an authorised agent, and we honour Global Privacy Control signals. We will not discriminate against you for exercising your rights."]
        : []),
      ...(p.frameworks.includes("FERPA")
        ? [`Where we act for a school, education records are handled under FERPA: parents and eligible students may inspect and request amendment of records through the school${t.ferpaAnnualNoticeUrl ? ` (see ${t.ferpaAnnualNoticeUrl})` : ""}.`]
        : []),
      `You also have the right to complain to ${p.supervisoryAuthority}.`,
    ]),
    section(t, "privacy.security", "8. Security", [
      "Data is encrypted in transit and at rest, access is role-based and enforced in the database, sensitive changes are audit-logged, and consent records cannot be altered. If a breach occurs that affects you, we will tell you and the authorities as the law requires.",
    ]),
    section(t, "privacy.laws", "9. Applicable law", [
      `This notice is designed to meet: ${p.laws.join("; ")}.`,
      `Frameworks considered: ${p.frameworks.map(frameworkLabel).join(", ")}.`,
    ]),
  ];
  const missing: string[] = [];
  if (!t.legalName) missing.push("Legal entity name");
  if (!t.address) missing.push("Postal address");
  if (!t.contactEmail) missing.push("Contact email");
  if (p.region === "EU" && !t.dpoEmail) missing.push("DPO / privacy contact email");
  return {
    key: "privacy",
    title: `${LEGAL_DOC_TITLES.privacy} — ${club}`,
    lastUpdated: t.lastUpdated,
    intro: `This notice explains how ${club} handles personal data of participants, parents and guardians, and staff when you use our registration and club-management app.`,
    sections,
    reviewNotice: REVIEW_NOTICE,
    missingFields: missing,
  };
}

// ---------------------------------------------------------------------------
function terms(t: LegalTenant): LegalDocument {
  const club = t.clubName;
  const law = t.profile.region === "CH" ? "Swiss law; place of jurisdiction at the club's registered seat, subject to mandatory consumer provisions"
    : t.profile.region === "US" ? `the laws of the state in which ${club} is organised`
    : `the law of the country where ${club} is established, subject to mandatory consumer-protection law of your country of residence`;
  return {
    key: "terms",
    title: `${LEGAL_DOC_TITLES.terms} — ${club}`,
    lastUpdated: t.lastUpdated,
    intro: `These terms govern your use of ${club}'s online registration and member app. Programme-specific conditions (fees, refunds, code of conduct) are shown when you register and form part of your agreement with ${club}.`,
    sections: [
      section(t, "terms.parties", "1. Who you contract with", [
        `Your agreement for programmes and services is with ${or(t.legalName, club)}. The app is provided to ${club} by ${PLATFORM_NAME}, which is not a party to your registration contract.`,
      ]),
      section(t, "terms.accounts", "2. Accounts", [
        "You must give accurate information, keep your sign-in details secure and tell us about unauthorised use. Accounts for children are created and managed by a parent or guardian, who is responsible for the information provided.",
      ]),
      section(t, "terms.payments", "3. Fees and payment", [
        `Fees are shown before you register. Invoices are payable by the due date by the methods offered (for example card, bank transfer or QR-bill). ${club}'s cancellation and refund policy is shown at registration.`,
      ]),
      section(t, "terms.conduct", "4. Acceptable use", [
        "Do not misuse the app: no attempts to access other families' data, no uploading of unlawful content, no interference with security. We may suspend accounts that breach these terms.",
      ]),
      section(t, "terms.liability", "5. Liability", [
        "Participation in sport involves inherent risks, covered by the waiver you accept at registration. Nothing in these terms limits liability that cannot be limited by law (including for intent, gross negligence or personal injury where applicable).",
      ]),
      section(t, "terms.law", "6. Governing law", [`These terms are governed by ${law}.`]),
      section(t, "terms.contact", "7. Contact", [contactLine(t) || "[club contact details — to be completed]"]),
    ],
    reviewNotice: REVIEW_NOTICE,
    missingFields: t.legalName ? [] : ["Legal entity name"],
  };
}

// ---------------------------------------------------------------------------
function imprint(t: LegalTenant): LegalDocument {
  const rows = [
    `Name: ${or(t.legalName, t.clubName)}`,
    `Address: ${or(t.address, "[to be completed]")}`,
    `Email: ${or(t.contactEmail, "[to be completed]")}`,
    ...(t.contactPhone ? [`Phone: ${t.contactPhone}`] : []),
    ...(t.representative ? [`Represented by: ${t.representative}`] : []),
    ...(t.companyRegisterId ? [`Register / UID: ${t.companyRegisterId}`] : []),
    ...(t.vatId ? [`VAT number: ${t.vatId}`] : []),
    ...(t.website ? [`Website: ${t.website}`] : []),
  ];
  const missing: string[] = [];
  if (!t.legalName) missing.push("Legal entity name");
  if (!t.address) missing.push("Postal address");
  if (!t.contactEmail) missing.push("Contact email");
  if (t.profile.country === "DE" && !t.representative) missing.push("Authorised representative (DE DDG §5)");
  return {
    key: "imprint",
    title: `${LEGAL_DOC_TITLES.imprint} — ${t.clubName}`,
    lastUpdated: t.lastUpdated,
    intro: t.profile.requiresImprint
      ? "Provider identification required by law (CH UCA Art. 3(1)(s); DE Digitale-Dienste-Gesetz §5; AT ECG §5)."
      : "Provider identification.",
    sections: [
      section(t, "imprint.provider", "Responsible for this service", [], rows),
      section(t, "imprint.platform", "Technical platform", [
        `This service runs on ${PLATFORM_NAME}, which processes data on behalf of ${t.clubName}.`,
      ]),
      ...(t.profile.region === "EU"
        ? [section(t, "imprint.odr", "Consumer dispute resolution", [
            "We are neither obliged nor willing to take part in dispute-resolution proceedings before a consumer arbitration board unless required by law.",
          ])]
        : []),
    ],
    reviewNotice: REVIEW_NOTICE,
    missingFields: missing,
  };
}

// ---------------------------------------------------------------------------
function cookies(t: LegalTenant): LegalDocument {
  const cats: ConsentCategory[] = ["necessary", "functional", "analytics", "marketing"];
  return {
    key: "cookies",
    title: `${LEGAL_DOC_TITLES.cookies} — ${t.clubName}`,
    lastUpdated: t.lastUpdated,
    intro: "We use only strictly necessary cookies by default. Anything else stays off unless you switch it on.",
    sections: [
      section(t, "cookies.categories", "Categories", [], cats.map((c) => `${CATEGORY_INFO[c].label}: ${CATEGORY_INFO[c].description}`)),
      section(t, "cookies.list", "Cookies we set", [], [
        "sb-*-auth-token — sign-in session (strictly necessary; session / up to 1 week).",
        "cos_cookie_consent — remembers your cookie choice (strictly necessary; 6 months).",
        "__stripe_mid / __stripe_sid — set by our payment provider only on the payment page, for fraud prevention (strictly necessary).",
      ]),
      section(t, "cookies.control", "Your choices", [
        "You can change your choice at any time with the \"Cookie settings\" link at the bottom of each page. We honour the Global Privacy Control browser signal as an opt-out of any sale or sharing of personal information.",
      ]),
    ],
    reviewNotice: REVIEW_NOTICE,
    missingFields: [],
  };
}

export function renderLegalDocument(key: LegalDocKey, tenant: LegalTenant): LegalDocument {
  switch (key) {
    case "privacy": return privacy(tenant);
    case "terms": return terms(tenant);
    case "imprint": return imprint(tenant);
    case "cookies": return cookies(tenant);
  }
}

/** Plain-text rendering (e.g. for emails, PDF export or snapshots). */
export function legalDocumentToText(doc: LegalDocument): string {
  const out = [doc.title, `Last updated: ${doc.lastUpdated}`, "", doc.intro, ""];
  for (const s of doc.sections) {
    out.push(s.heading, ...s.paragraphs, ...(s.list ?? []).map((l) => `- ${l}`), "");
  }
  out.push(doc.reviewNotice);
  return out.join("\n");
}
