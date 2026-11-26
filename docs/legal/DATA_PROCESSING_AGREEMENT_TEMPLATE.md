# Data Processing Agreement (GDPR Art. 28 · nFADP Art. 9 · UK GDPR · US service-provider terms)

> **TEMPLATE. Requires review by qualified counsel in each jurisdiction where it is
> used.** Annex A to the Subscription Terms. The Customer (club, school or
> organisation) is the **controller** and the Provider is the **processor**. For US
> customers, §12 adds "service provider / contractor" terms under the CCPA and
> similar state laws.

**Controller:** [CUSTOMER LEGAL NAME, ADDRESS] · **Processor:** [PLATFORM LEGAL ENTITY, ADDRESS]

## 1. Subject matter and duration
The Processor processes personal data on behalf of the Controller in order to
provide the Service. Processing lasts for the term of the subscription plus the
exit period (Terms §8.3).

## 2. Details of processing (Annex 1)

| Item | Description |
|---|---|
| Nature and purpose | Hosting, storage, retrieval, transmission and display needed to run registrations, scheduling, attendance, billing, communications, documents and consent management. Optional assistant features. |
| Data subjects | Participants (including **children**), parents and guardians, emergency contacts, staff, coaches, volunteers |
| Personal data | Identity, contact, date of birth, team and programme, attendance, bookings, invoices and payments, consent records, documents, technical logs |
| Special categories / sensitive data | **Health data** (allergies, conditions, medication, insurance) provided by guardians; photos (where consented) |
| Frequency | Continuous |
| Retention | As configured by the Controller in `data_retention_policies`; defaults are documented in the Compliance Matrix |

## 3. Processor obligations (GDPR Art. 28(3))
The Processor shall:
a) process only on documented instructions from the Controller (these terms, the
   Controller's configuration, and its written requests), and tell the Controller if
   it believes an instruction is unlawful;
b) ensure that personnel are bound by confidentiality and receive privacy training
   each year;
c) implement the measures in **Annex 2** (Art. 32 / nFADP Art. 8);
d) engage sub-processors only under §7;
e) help the Controller respond to data-subject requests (built-in tools: data
   export, erasure and anonymisation, consent withdrawal, DSAR tracker with due
   dates), within **5 business days** of a request for assistance;
f) help with DPIAs, prior consultation and breach notification;
g) at the end of the service, delete or return all personal data (Terms §8.3);
h) make available the information needed to demonstrate compliance, and allow
   audits (§9).

## 4. Children's data
The Processor shall not use children's data for any purpose other than providing
the Service. In particular it shall not use it for advertising, profiling, or
training general-purpose models. For US tenants the Processor supports COPPA
verifiable-parental-consent records (`parental_consents`) and deletion on request.

## 5. Personal data breaches
The Processor shall notify the Controller **without undue delay and in any event
within 24 hours** of becoming aware of a personal data breach affecting Customer
Data. The notice shall include the information in GDPR Art. 33(3) as far as it is
available, followed by updates. This leaves the Controller time to meet its own
**72-hour** deadline (GDPR Art. 33) and the nFADP "as soon as possible" duty (Art. 24).
The Processor keeps its own breach register, and the Controller can use the
in-app breach log (`breach_incidents`).

## 6. Location and transfers
6.1 Primary hosting: **EU (AWS eu-central-1, Frankfurt)**. A US region is available
on request for US-only tenants.
6.2 Transfers outside CH/EEA/UK take place only to adequate countries or under
appropriate safeguards: the EU-US / Swiss-US DPF (certified recipients); the EU SCCs
2021/914 (Module 2 controller-to-processor and Module 3 processor-to-processor) with
the Swiss FDPIC amendments; or the UK Addendum. Transfer impact assessments are
available on request.

## 7. Sub-processors
7.1 The Controller gives general authorisation for the sub-processors in
[SUBPROCESSORS.md / URL].
7.2 The Processor will give **30 days' notice** of a new or replacement
sub-processor by email and on the published list. The Controller may object on
reasonable data-protection grounds. If the parties cannot resolve the objection,
the Controller may terminate the affected Service and receive a pro-rata refund.
7.3 The Processor imposes data-protection obligations on each sub-processor that
are equivalent to those in this DPA, and remains liable for them.

## 8. Controller obligations
The Controller ensures that it has a lawful basis for processing, has given
notices and obtained consents (including parental and COPPA consent), and that its
instructions are lawful. It also configures retention and access appropriately.

## 9. Audits
The Processor provides on request: its current security documentation, penetration
test summary, and sub-processor certifications (e.g. SOC 2 / ISO 27001 reports of
its hosting providers). On-site audits are possible once a year with 30 days' notice,
at the Controller's cost, unless a breach has occurred.

## 10. Liability
As set out in the Terms §9, with the data-protection cap in §9.3.

## 11. Swiss specifics
References to the GDPR include the corresponding provisions of the nFADP. The
FDPIC is the competent authority for Swiss Controllers. "Personal data" covers
data of natural persons only.

## 12. US state-law service-provider terms (CCPA/CPRA and similar)
The Processor shall not: (i) sell or share personal information; (ii) keep, use or
disclose it for any purpose other than the business purposes in Annex 1, or outside
the direct business relationship; (iii) combine it with personal information from
other sources except as permitted. The Processor shall comply with applicable state
law, give the same level of protection, notify the Controller if it can no longer
meet its obligations, and allow the Controller to take reasonable steps to stop and
remedy unauthorised use. The Processor certifies that it understands these
restrictions.

---
## Annex 2: Technical and organisational measures

| Area | Measure (as implemented in the codebase) |
|---|---|
| Tenant isolation | Every table carries `org_id`; Postgres row-level security on every tenant table, FORCE RLS on sensitive tables (migration 15) |
| Access control | Roles: admin, finance, coach, parent; least privilege; coaches cannot read medical data or invoices; parents see only their own family (RLS regression suite in `testing/`) |
| Authentication | Supabase Auth; magic link / password; MFA for admins [ROADMAP: Q1 2027] |
| Encryption | TLS 1.2+ in transit; AES-256 at rest (hosting provider); service-role key server-only |
| Integrity | Consent records are immutable (DB trigger); compliance evidence cannot be deleted by tenants |
| Logging | Audit trigger on invoices, payments, medical, consents, registrations, documents, DSARs, breaches, parental consents |
| Availability | Daily backups with point-in-time recovery (provider plan); restore test each quarter [ROADMAP] |
| Data minimisation | Optional fields; retention schedule per category; anonymisation routine `anonymise_family()` |
| Secure development | Code review, dependency updates, secrets never committed, error logs redacted (`src/lib/log.ts`) |
| Incident response | Breach log with 72-hour deadline tracking; 24-hour processor-to-controller notice |
| Personnel | Confidentiality undertakings; access removed when staff leave |

---
_Change log: [DATE] · [REVIEWER / COUNSEL] · [SUMMARY]_
