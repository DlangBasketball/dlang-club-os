# Legal & compliance pack

> **TEMPLATES ONLY. NOT LEGAL ADVICE.** Every document in this folder is a
> starting draft written by the product team. Before any of it is signed,
> published or relied on, it must be reviewed and adapted by qualified counsel
> in each jurisdiction where it is used: Switzerland, each EU/EEA member state
> concerned, the UK, and each US state concerned. Text in `[square brackets]`
> must be completed or confirmed.

This folder holds the legal documents needed to sell the platform to sports
clubs, schools and organisations in Switzerland, the EU and the US. It also
explains how those documents map to product features.

| File | Purpose | Who signs / publishes it |
|---|---|---|
| [COMPLIANCE_MATRIX.md](COMPLIANCE_MATRIX.md) | Each requirement for CH, EU and US, mapped to features, gaps and a dated roadmap | Internal |
| [PRIVACY_POLICY_TEMPLATE.md](PRIVACY_POLICY_TEMPLATE.md) | Privacy notice the club (controller) gives to parents, athletes and staff | Club publishes it |
| [TERMS_OF_SERVICE_TEMPLATE.md](TERMS_OF_SERVICE_TEMPLATE.md) | SaaS subscription terms between the platform and the club | Platform and club |
| [DATA_PROCESSING_AGREEMENT_TEMPLATE.md](DATA_PROCESSING_AGREEMENT_TEMPLATE.md) | GDPR Art. 28 / nFADP Art. 9 processor agreement | Platform and club |
| [SUBPROCESSORS.md](SUBPROCESSORS.md) | Public list of sub-processors (Annex 3 of the DPA) | Platform publishes it |
| [PARENTAL_CONSENT_FORM_TEMPLATE.md](PARENTAL_CONSENT_FORM_TEMPLATE.md) | Parental consent form, including COPPA verifiable parental consent | Club uses it with parents |
| [COOKIE_POLICY_TEMPLATE.md](COOKIE_POLICY_TEMPLATE.md) | Cookie policy | Club or platform publishes it |
| [STUDENT_DATA_ADDENDUM_TEMPLATE.md](STUDENT_DATA_ADDENDUM_TEMPLATE.md) | FERPA and state student-privacy addendum for US schools and districts | Platform and school |

## How the product uses these templates

- Each tenant has public pages at `/legal/<org-slug>/{privacy,terms,imprint,cookies}`.
  The text comes from `src/lib/compliance/legal-templates.ts`, a short version of
  the templates here, filled in with the club's own details: Settings → Profile,
  plus the `compliance_settings` table. Admins can replace any section through
  `compliance_settings.legal_overrides` (keys such as `privacy.controller`).
- `getComplianceProfile(org)` in `src/lib/compliance/profile.ts` chooses the rules
  that apply from the org's country, region override and org type.
- The registers are in `supabase/migrations/20250420091900_compliance_regions.sql`:
  retention schedule, record of processing activities (ROPA), sub-processors,
  COPPA consents, FERPA disclosures, breach log and DSARs.

## Change control

1. Change the master template in this folder.
2. Get counsel to review it, then record the reviewer and date in the file's change log.
3. Update the short version in `legal-templates.ts` and bump `CONSENT_VERSION` in
   `src/lib/compliance/cookies.ts` if the cookie categories changed.
4. For sub-processor changes, update `SUBPROCESSORS.md` **and** the seed in the
   migration, then give clubs **30 days' notice** (DPA §7).
