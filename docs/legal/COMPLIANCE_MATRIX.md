# Compliance matrix: Switzerland · EU/EEA · United States

> **Engineering assessment, not legal advice.** This maps statutory requirements to
> what the codebase does today and what is still missing. Before launch in each
> market, qualified counsel must confirm the interpretation, the retention periods,
> and the deadlines.
> Status key: **Done** = implemented and tested · **Partial** = data model or library
> exists, but the UI or automation is missing · **Gap** = not started · **Org** =
> organisational task, not code.
> _Assessed: 12 Nov 2026 against branch `wf/compliance`._

## 1. Which rules apply
`getComplianceProfile(org)` (`src/lib/compliance/profile.ts`) works out the
applicable rules from `organizations.country`, the `compliance_settings.data_region`
override, and `org_type`.

| Tenant | Frameworks applied | DSAR window | Authority breach deadline | Child consent age | Imprint |
|---|---|---|---|---|---|
| CH club (e.g. DLang, Lausanne) | nFADP + FADO; GDPR if the club targets EU residents (open question) | 30 days | "as soon as possible" (72 h internal target) | 16 (operating rule; capacity of judgement) | Required (UCA Art. 3(1)(s)) |
| EU club | GDPR + national ePrivacy law | 30 days (1 month, +2 months extension) | 72 h | 13–16 by member state (GDPR Art. 8 table in `regions.ts`) | Required in DE/AT/LU |
| UK club | UK GDPR, DPA 2018, PECR, Children's Code | 30 days | 72 h | 13 | No |
| US club | COPPA, CAN-SPAM, state privacy laws where thresholds are met | 45 days | state laws: 30–60 days to individuals / AG | 13 (COPPA) | No |
| US school or district | Above + FERPA, PPRA, state student-privacy law | 45 days (FERPA) | state laws + contract (often 48 h–7 days) | 13 | No |

## 2. Requirement matrix

| # | Requirement | CH (nFADP) | EU (GDPR) | US | Implementation | Status |
|---|---|---|---|---|---|---|
| 1 | Tenant isolation and access control | Art. 8 | Art. 32 | FTC Act §5; COPPA §312.8 | RLS on every table, FORCE RLS on sensitive tables (mig. 15); role model; `testing/rls_test_suite.sql` | **Done** |
| 2 | Privacy notice | Art. 19–21 | Art. 13–14 | COPPA §312.4; CCPA §1798.100, .130 | `/legal/<slug>/privacy` rendered from tenant variables plus profile; master template in `PRIVACY_POLICY_TEMPLATE.md` | **Done** (needs counsel review) |
| 3 | Imprint / provider identification | UCA Art. 3(1)(s) | DE DDG §5, AT ECG §5 | n/a | `/legal/<slug>/imprint`; flags missing fields | **Done** |
| 4 | Terms (club ↔ member) | CO | national contract law | state law | `/legal/<slug>/terms` | **Done** (template) |
| 5 | Platform ↔ club contract and DPA | Art. 9 | Art. 28 | CCPA service-provider terms | `TERMS_OF_SERVICE_TEMPLATE.md`, `DATA_PROCESSING_AGREEMENT_TEMPLATE.md` | **Org**: counsel review, e-signature flow |
| 6 | Sub-processor list and change notice | Art. 9(3) | Art. 28(2),(4) | contract | `subprocessors` table (platform plus org rows), `SUBPROCESSORS.md` | **Partial**: no automated 30-day notice email |
| 7 | Record of processing activities | Art. 12 (exemption < 250 staff does not cover high-risk data) | Art. 30 | n/a | `processing_activities` table | **Partial**: needs seed entries and admin UI |
| 8 | Consent capture with evidence | Art. 6(6)–(7) | Art. 7(1) | COPPA | `consent_acceptances` with text snapshot, IP and user agent; immutable (mig. 14–15) | **Done** |
| 9 | Withdrawal of consent | Art. 30(2)(b) | Art. 7(3) | COPPA §312.6 | `withdraw_consent()` RPC; parent privacy tools | **Done** |
| 10 | Special-category / sensitive data (health) | Art. 5(c), 6(7) explicit consent | Art. 9 | state "sensitive PI" | Separate `athlete_medical` table; coaches blocked; audit trigger; health consent form | **Done** |
| 11 | Children: parental consent | capacity of judgement | Art. 8 (13–16) | **COPPA VPC < 13** | `parental_consents` (FTC methods, separate third-party consent), `athlete_requires_vpc()`, `athlete_has_vpc()`; form template | **Partial**: registration flow does not yet block under-13 US sign-ups pending VPC |
| 12 | COPPA 2025 amendments: written security programme, retention policy, separate disclosure consent | — | — | 16 CFR 312.8, 312.10, 312.5(a)(2), compliance date 22 Apr 2026 | `third_party_disclosure_consented`; retention schedule; DPA Annex 2 | **Partial**: written WISP document missing |
| 13 | Retention schedule | Art. 6(4) | Art. 5(1)(e) | COPPA §312.10; CCPA §1798.100(a)(3) | `data_retention_policies` with regional defaults; `seed_retention_policies()`; bootstrap trigger for new orgs | **Partial**: no scheduled purge job yet |
| 14 | Right of access / portability | Art. 25, 28 | Art. 15, 20 | CCPA right to know | Parent self-service JSON export; admin export | **Done** |
| 15 | Right to erasure | Art. 32 | Art. 17 | CCPA delete; COPPA delete | `deletion_requests` + `anonymise_family()` (keeps financial records) | **Done** |
| 16 | DSAR tracking with deadlines | Art. 25(7) + FADO 18: 30 d | Art. 12(3): 1 month | CCPA 45 d; FERPA 45 d | `dsar_requests`, automatic `due_at`, `dsar_overdue` view, server actions | **Partial**: admin UI and reminder emails missing |
| 17 | Breach register and notification | Art. 24 (FDPIC, as soon as possible) | Art. 33 (72 h), 34 | state laws; FERPA contracts | `breach_incidents` with automatic 72 h `authority_notify_by`; cannot be deleted; audit-logged | **Partial**: no alerting or runbook UI |
| 18 | Cookie consent | TCA Art. 45c | ePrivacy Art. 5(3) | CCPA opt-out; GPC | Banner: necessary only by default, equal-weight reject, GPC honoured, `ConsentGate` | **Done** |
| 19 | International transfers | Art. 16–17; EU adequate (FADO Annex 1) | Ch. V: DPF / SCCs | — | Hosting in EU Frankfurt; DPF/SCC column per sub-processor | **Org**: TIAs, DPF checks |
| 20 | DPIA | Art. 22 (high risk: minors' health data) | Art. 35 | CPRA risk assessments (regs in force 2026) | `processing_activities.dpia_required` / `dpia_completed_at` | **Gap**: DPIA document not written |
| 21 | DPO / representative | Art. 10 (optional), Art. 14 rep. | Art. 27, 37 | — | Fields in `compliance_settings` | **Org** |
| 22 | FERPA school-official designation | — | — | 34 CFR 99.31(a)(1)(i)(B) | `ferpa_school_official_designated`, date, annual-notice URL; Student-Data Addendum | **Partial**: no UI toggle yet |
| 23 | FERPA disclosure log | — | — | 34 CFR 99.32 | `education_record_disclosures` (cannot be deleted) | **Partial**: no UI |
| 24 | CCPA/CPRA consumer rights, "Do Not Sell or Share" | — | — | §1798.120, .135 | We neither sell nor share; GPC honoured; DSAR types `opt_out_sale_share`, `limit_sensitive` | **Partial**: applies only above thresholds; counsel to confirm |
| 25 | Security: MFA for staff | Art. 8 / FADO 1–6 | Art. 32 | COPPA 312.8; state laws | Supabase Auth supports TOTP | **Gap**: enforce MFA for admin and finance |
| 26 | Audit logging | FADO Art. 4 (logging for high-risk) | Art. 5(2), 32 | — | `audit_trigger` on sensitive tables plus all new compliance tables | **Done** |
| 27 | Marketing email consent | UCA Art. 3(1)(o) | ePrivacy Art. 13 | CAN-SPAM | Consent key `media` / newsletter tick box | **Partial**: unsubscribe link in templates needs verifying |
| 28 | AI assistant transparency | nFADP Art. 21 (automated decisions: not made) | EU AI Act Art. 50 transparency (from 2 Aug 2026) | state AI laws | Assistant is labelled; no medical data in context; listed as optional sub-processor | **Partial**: add a "you are talking to an AI" notice in the chat UI and a per-org kill switch |
| 29 | Accessibility of legal pages | — | EAA (from 28 Jun 2025, B2C services) | ADA | Semantic HTML, keyboard-operable banner | **Partial**: full WCAG 2.1 AA audit pending |

## 3. Data residency guidance
- **Default:** host every CH and EU tenant in **EU / Frankfurt** (Supabase
  `eu-central-1`, Vercel functions `fra1`, Resend EU region). Switzerland recognises
  the EU/EEA as adequate (FADO Annex 1), and the EU recognises Switzerland as
  adequate (decision of 2000, confirmed in the Commission's January 2024 review).
  So EU hosting is acceptable for Swiss clubs, and Swiss hosting would be acceptable
  for EU clubs.
- **Swiss-only option:** Supabase `eu-central-2` (Zurich) for public bodies or
  schools that require data to stay in Switzerland. This means a separate project per
  residency zone.
- **US tenants:** EU hosting is lawful under US law. Some districts require US
  storage by contract, so offer `us-east-1` as a separate deployment (one Supabase
  project per region; tenant routing by `compliance_settings.hosting_region`).
- **US sub-processors** (support access, email, payments, AI): rely on the EU-US DPF
  and the **Swiss-US DPF** (in force since 15 Sep 2024) for certified vendors,
  otherwise on SCCs with the Swiss amendments plus a transfer impact assessment.
- **Never** mix residency zones in one database. `hosting_region` is recorded per
  tenant as evidence.

## 4. Remaining gaps: realistic timeline
These durations assume the current team (founder plus one engineer and the build
agents) and outside counsel on retainer. Counsel turnaround is usually the
critical path. Budget figures are rough estimates for planning only.

### Phase 0: Swiss launch readiness for DLang (now to 31 Jan 2027, about 11 weeks)
| Work item | Effort | Target | Owner |
|---|---|---|---|
| Merge this branch; run `testing/compliance_test_suite.sql` in CI | 1 day | 20 Nov 2026 | Eng |
| Admin UI: Settings → Privacy → Compliance (settings, retention, DSAR list, breach log), using the existing server actions | 1.5–2 weeks | 11 Dec 2026 | Eng |
| Fill in DLang details: legal name, address, UID, privacy contact; check `/legal/dlang/*` | 1 day | 4 Dec 2026 | Founder |
| Swiss counsel review of privacy notice, imprint, terms, parental consent form (FR + EN) | 3–5 weeks elapsed (est. CHF 3–6k) | 15 Jan 2027 | Founder and counsel |
| French translations of legal pages (Lausanne; nFADP requires notices the person can understand) | 1 week | 22 Jan 2027 | Founder |
| Sign vendor DPAs; move Supabase, Vercel and Resend to EU regions; record them in `subprocessors.dpa_url` | 3–5 days | 18 Dec 2026 | Eng |
| Write the ROPA (about 8 activities) and the DPIA for children's health data | 1 week | 29 Jan 2027 | Founder with counsel |
| Enforce MFA for admin and finance roles | 3 days | 31 Jan 2027 | Eng |

### Phase 1: Selling to other Swiss clubs (Feb to Apr 2027, about 12 weeks)
| Work item | Effort | Target |
|---|---|---|
| Platform ToS and DPA finalised by counsel; click-through acceptance at onboarding, stored with version | 4–6 weeks elapsed (est. CHF 5–10k) | 15 Mar 2027 |
| Scheduled retention job (Supabase cron or edge function) that applies `data_retention_policies` | 1.5 weeks | 31 Mar 2027 |
| DSAR reminder emails (7 days and 2 days before `due_at`); breach 24 h / 72 h alerts | 1 week | 15 Apr 2027 |
| 30-day sub-processor change notification email | 3 days | 30 Apr 2027 |
| German and Italian legal-page translations | 2 weeks elapsed | 30 Apr 2027 |

### Phase 2: EU launch (FR / DE / AT first) (May to Sep 2027, about 5 months)
| Work item | Effort | Target |
|---|---|---|
| Decide whether the platform needs an EU representative (Art. 27) as a Swiss processor serving EU clubs; appoint one (about EUR 1–3k per year) | 2–4 weeks | 31 May 2027 |
| National ePrivacy / child-age checks for each launch country; imprint rules for DE/AT | 3–4 weeks counsel (est. EUR 4–8k per country) | 30 Jun 2027 |
| Accessibility audit (WCAG 2.1 AA) of public and parent flows | 2–3 weeks | 31 Jul 2027 |
| AI assistant: in-chat AI disclosure, per-org kill switch, zero-retention contract confirmed | 1 week | 30 Jun 2027 |
| Pen test by an external firm (est. CHF/EUR 8–15k) and remediation | 3 weeks plus 2 weeks fixes | 15 Sep 2027 |

### Phase 3: US launch (clubs first, then schools) (Oct 2027 to Mar 2028, about 6 months)
| Work item | Effort | Target |
|---|---|---|
| US counsel: COPPA programme, state-law applicability (non-profit status), ToS under US law (est. USD 10–20k) | 6–8 weeks elapsed | 30 Nov 2027 |
| COPPA VPC in registration: block under-13 data beyond the parent's contact details until VPC; Stripe micro-charge method; 14-day auto-purge of unverified requests | 2–3 weeks | 15 Dec 2027 |
| Written information security programme (COPPA §312.8) | 1–2 weeks | 15 Dec 2027 |
| Optional US data residency (second Supabase project in `us-east-1`, tenant routing) | 3–4 weeks | 31 Jan 2028 |
| Schools: sign the SDPC NDPA template; state exhibits (CA, NY, IL first); FERPA admin UI | 4–6 weeks | 28 Feb 2028 |
| SOC 2 Type I (often required by districts): tooling and audit (est. USD 15–30k) | 3–4 months elapsed | 31 Mar 2028 |
| Cyber / tech E&O insurance with privacy cover | 2–4 weeks | 31 Dec 2027 |

## 5. Open legal questions for counsel
1. Waiver and consent retention given CH CO Art. 60 (20-year absolute limitation
   for personal injury). Is 10 years enough?
2. Is the platform a processor only, or a joint controller for platform-level
   analytics? (Current design: processor only, no platform analytics on tenant data.)
3. Does a Swiss club marketing camps to French families trigger GDPR Art. 3(2)?
4. US non-profit clubs: confirm which state laws apply (CO, OR, DE, NJ, MN cover non-profits).
5. Are liability waivers for minors enforceable in each target US state (many states will not enforce parent-signed pre-injury waivers)?
