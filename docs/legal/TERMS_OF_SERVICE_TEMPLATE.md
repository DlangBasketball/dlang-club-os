# Subscription Terms of Service (Platform ↔ Organisation)

> **TEMPLATE. Requires review by qualified counsel in Switzerland, in each EU/EEA
> market and in each US state where it is used, before anyone signs it.**
> This is a B2B SaaS agreement between the platform operator and the subscribing
> club, school or organisation. Terms for end users (parents) are the club's own
> responsibility (see the in-app `/legal/<slug>/terms`).

_Version [N] · Effective [DATE]_

**Between** [PLATFORM LEGAL ENTITY], [ADDRESS], [UID/REGISTER] ("**Provider**")
**and** the organisation identified in the Order Form ("**Customer**").

## 1. Definitions
"**Service**" means the [PLATFORM NAME] club-management software provided as a
hosted service, including its white-label configuration.
"**Customer Data**" means the data that the Customer or its users submit to the Service.
"**Users**" means the Customer's staff, coaches, parents, guardians and participants.
"**Order Form**" means the plan, fees, term and options that the Customer selects.
"**DPA**" means the Data Processing Agreement in Annex A, which forms part of these terms.

## 2. The Service
2.1 Provider makes the Service available for the subscription term, under the
plan in the Order Form.
2.2 Provider may improve the Service. Provider will not materially reduce core
functionality during a paid term without 90 days' notice and a pro-rata refund
right.
2.3 **Availability target:** 99.5% monthly, excluding announced maintenance
(announced at least 48 h in advance, outside 07:00–22:00 CET where possible).
Service credits are set out in the Order Form.
2.4 **Support:** email support on business days ([CET / ET] hours). First response
target is 1 business day, or 4 hours for a P1 issue such as an outage or a
suspected data breach.

## 3. Customer responsibilities
3.1 The Customer is the **controller** of Customer Data. It is responsible for:
having a lawful basis for processing; giving notices to Users (a privacy notice
template is provided); obtaining parental and other consents; verifiable parental
consent where COPPA applies; acting on data-subject requests; and configuring
retention.
3.2 The Customer must keep credentials confidential, give access only to
authorised staff, and remove users who leave without delay.
3.3 Acceptable use: no unlawful content; no attempts to circumvent security or
reach other tenants' data; no load testing without consent; no data about
children beyond what the Customer's purpose requires.
3.4 **Schools:** where FERPA or state student-privacy law applies, the Student-Data
Addendum (Annex C) also applies and takes precedence for education records.

## 4. Fees and payment
4.1 Fees are as stated in the Order Form, invoiced [annually / monthly] in advance
in [CHF / EUR / USD], and payable within 30 days.
4.2 Prices exclude VAT and sales tax. Swiss VAT is applied where required.
4.3 Payment-processing fees for payments that parents make to the Customer
(card, TWINT, QR-bill) are as set out by the payment provider. The Customer is the
merchant of record for those payments.
4.4 Provider may change fees for a renewal term by giving at least 60 days' notice.

## 5. Data protection and security
5.1 Provider processes Customer Data only as the Customer's processor, under the
DPA (Annex A).
5.2 Provider maintains the technical and organisational measures in DPA Annex 2.
These include tenant isolation enforced by database row-level security,
encryption in transit and at rest, audit logging, and immutable consent records.
5.3 Hosting region: EU (Frankfurt) by default. A US region is available on request
for US-only tenants (see the Order Form).
5.4 Sub-processors are listed in [SUBPROCESSORS.md / URL]. Changes are notified
30 days in advance (DPA §7).

## 6. Intellectual property
6.1 Provider owns the Service. The Customer owns Customer Data and its own branding.
6.2 The Customer grants Provider a licence to host and process Customer Data, and to
display the Customer's branding, solely to provide the Service.
6.3 Provider may use aggregated, de-identified usage statistics that cannot
identify the Customer or any individual. It will **never** use data about children
for this purpose, for advertising, or to train general-purpose models.

## 7. Optional assistant features
Assistant features are **off by default for minors' data** and can be switched
off per organisation. If enabled, prompts may be sent to the AI sub-processor listed
in the sub-processor list, under a no-training, zero- or limited-retention
configuration. Outputs may be inaccurate and must not be relied on for medical,
legal or safeguarding decisions.

## 8. Term and termination
8.1 The initial term is as stated in the Order Form. The subscription renews
automatically for successive 12-month terms unless either party gives notice at
least 30 days before renewal.
8.2 Either party may terminate for material breach that is not cured within 30
days of written notice.
8.3 **Exit:** for 60 days after termination, the Customer may export all Customer
Data (CSV/JSON plus document files). Provider then deletes Customer Data within a
further 30 days, apart from backups, which expire on their rolling cycle of no more
than 35 days, and apart from data that Provider must keep by law.

## 9. Warranties and liability
9.1 Provider warrants that the Service will perform materially as described.
9.2 Except for liability that cannot be limited by law (intent, gross negligence,
personal injury, and in CH CO Art. 100), each party's aggregate liability is capped
at the fees paid in the 12 months before the claim. Neither party is liable for
indirect or consequential loss.
9.3 **Data-protection carve-out:** for breaches of the DPA, the cap is [2× / 3×]
annual fees. [Negotiate with counsel.]

## 10. Indemnities
Provider will defend the Customer against third-party claims that the Service
infringes intellectual property rights. The Customer will defend Provider against
claims arising from Customer Data or from the Customer's unlawful use of the Service.

## 11. Governing law and jurisdiction
- Customers in CH or the EU: **Swiss law** (CISG excluded); courts of [Lausanne, Vaud].
- US customers: the laws of the State of [DELAWARE / NEW YORK]; courts in [VENUE].
  Public schools may require the law of their own state, and the parties may agree
  to this in the Order Form.

## 12. Miscellaneous
Entire agreement; order of precedence (Student-Data Addendum > DPA > Order Form >
these terms); notices by email to the addresses in the Order Form; assignment only
with consent, except on a merger; force majeure; severability.

**Annexes:** A. DPA · B. Sub-processor list · C. Student-Data Addendum (schools) · D. Order Form

---
_Change log: [DATE] · [REVIEWER / COUNSEL] · [SUMMARY]_
