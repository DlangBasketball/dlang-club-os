---
title: "FIT Digital Application: DLANG Sports OS"
subtitle: "Fondation pour l'Innovation Technologique (FIT), Canton of Vaud. FIT Digital Grant application. English working version; the French version is the one to file."
date: "Draft dossier, 12 November 2026"
---

**APPLICATION DOSSIER · FIT DIGITAL GRANT · DRAFT**

> **Read before filing.** This is a draft prepared for the founder, who files it personally. **[Confirm: ...]** marks facts only the founder can supply. **[Verify on fondation-fit.ch]** marks programme conditions that could not be checked on the official site when this was written; check them there (or at the Innovaud pre-evaluation call) before filing. Figures marked **[Est.]** are planning estimates, not quotes. The French version (`FIT_Digital_Application_FR.md`) is the primary filing text; this English version mirrors it section by section. Delete this box before filing.

| Item | Content |
|---|---|
| Applicant | Swiss Preparatory Sports Academy GmbH, Canton of Vaud |
| Project | DLANG Sports OS: a digital operating system for sports clubs, academies and camps |
| Instrument | FIT Digital Grant, non-repayable [Verify on fondation-fit.ch] |
| Amount requested | **CHF 20,000** |
| Project period | 12 months, indicatively 1 March 2027 to 29 February 2028 [Confirm: start date depends on the committee date] |
| Contact | Derrick Lang, founder and managing director [Confirm: title as entered in the commercial register], [Confirm: email], [Confirm: phone] |
| Payment account | "SPSA Tech" account, [Confirm: bank and IBAN] |
| Commercial status | **Pre-revenue.** No paying external club at the date of this dossier. Product built and tested; pilot deployment with the first customer (DLang Basketball, Lausanne) in progress. |

---

# 1. Summary

Swiss sports clubs, academies and camps run on half a dozen disconnected tools: a spreadsheet, WhatsApp, paper forms, a bank account, a website and the memory of a volunteer president. Registration, invoicing, payment reminders, attendance and parental consent (for children, in most cases) are handled by hand.

**DLANG Sports OS** replaces them with one system: public online registration, families and athletes, invoicing with the Swiss QR-bill, card and TWINT payment, automatic reminders, attendance, coach and parent apps, documents and consents. It is built in Switzerland, on Swiss payment rails, in French, German and English (Italian next), with minors' data protection designed in. It is built by an operator who runs a 145+ athlete academy in Lausanne [Confirm: current headcount] and is its first user.

The platform is built and verified (automated tests, strict isolation between clubs, internal security reviews). It has no paying external customer yet. The CHF 20,000 FIT Digital Grant would fund the steps that turn a tested product into one **proven in the field**: an external security review, proof of automatic TWINT reconciliation, full FR/DE localisation, lawyer-reviewed nFADP compliance and market validation with Vaud clubs, aiming at 10 paying clubs by the end of November 2027 (base case; 6 in the cautious case).

---

# 2. Company and team

## 2.1 The company

| Item | Information |
|---|---|
| Legal name | Swiss Preparatory Sports Academy GmbH |
| Legal form | Limited liability company (GmbH / Sàrl) |
| Registered office | [Confirm: municipality and address in the Canton of Vaud] |
| UID (CHE number) | [Confirm: CHE-xxx.xxx.xxx] |
| Vaud commercial register number | [Confirm: register number] |
| Date of commercial register entry | [Confirm: date] |
| Share capital | [Confirm: amount, fully paid in; CHF 20,000 is the GmbH legal minimum] |
| Shareholders and quotas | [Confirm: shareholders and quota split] |
| Managing director(s) with signing authority | [Confirm: name(s) and signing mode] |
| Activities | [Confirm: sports academy and/or software activity, per the registered purpose] |
| Intellectual property | Present assignment of all code, designs and brand from the founder and contractors to the company, due by 31 December 2026 [Confirm: assignment signed, and date] |

**Eligibility point to clear with Innovaud.** The founder's materials say FIT Digital is for companies being formed or entered in the commercial register no more than six months ago [Verify on fondation-fit.ch]. If the applicant company has run the academy for longer, confirm before filing whether the software project is eligible in this company or must sit in a separate entity. [Confirm: register entry date and the company's history]

## 2.2 Team

| Person | Role | Time | Domicile |
|---|---|---|---|
| Derrick Lang | Founder, CEO. Product, sales and operations. Runs DLang Basketball / Swiss Prep Sports Academy, the platform's first customer and proving ground. | [Confirm: % of time] | [Confirm: domicile in Vaud] |
| Fractional CTO (human) | Architecture, review of every change, security, payments. Hiring decision on 8 January 2027, after a paid trial whose deliverable is the TWINT reconciliation. | [Confirm: name, status, % of time] | [Confirm] |
| AI-assisted engineering team | Specialised software agents (front end, database, payments, testing, security, data protection, translation) that propose code; every change is reviewed and approved by a human before merge and before production. | Continuous | n/a |
| External senior reviewer (fallback) | If no CTO is engaged: paid senior review, 4 to 8 hours a week from February 2027. | 4 to 8 h / week | [Confirm] |
| Others | [Confirm: other people, e.g. coordination, finance, coaching] | [Confirm] | [Confirm] |

The founder's materials list a team of 2 to 5 with at least one person domiciled in Vaud as a FIT condition [Verify on fondation-fit.ch]. [Confirm: team composition at filing]

**Advisers and partners.** [Confirm: Vaud fiduciary, lawyer, mentors, e.g. GENILEM if accepted]

**Private investment.** An investor has committed EUR 50,000 (about CHF 46,500), released once the CTO is in place, as a subordinated convertible loan targeted for signature on 31 January 2027 [Confirm: status of the commitment and terms].

---

# 3. Project description

## 3.1 The problem

| Fact | Figure | Source |
|---|---|---|
| Clubs affiliated to Swiss Olympic federations | 18,310 | Vereinsstudie 2022 |
| Club positions to fill, of which unpaid | 374,400, of which 351,000 unpaid | Vereinsstudie 2022 |
| Clubs with any paid staff | 13% (about 2,380) | Vereinsstudie 2022 |
| J+S youth participants (2025) | 703,700 | BASPO, February 2026 |
| J+S camp participant-days (2025) | 2.0 million | BASPO |

Administrative load is rising while the volunteer base that carries it shrinks. For an academy or camp, family fees are the lifeblood; they arrive by bank transfer, are matched by hand in a spreadsheet and chased by individual messages. Children's consents and medical information travel on paper or by messaging app.

## 3.2 The solution

DLANG Sports OS covers the full cycle of a programme or camp:

**register → pay → roster → attend → remind → report.**

- Public online registration per programme, with time-stamped parental consent (version, date, who) and a separate media consent.
- Invoicing with the Swiss QR-bill (free for the club), card and TWINT, instalment plans, credits and refunds.
- Automatic multilingual reminders; automatic reconciliation of online payments.
- Mobile web apps (PWA) for coaches (sessions, attendance) and parents (children, invoices, bookings, documents).
- Player-development session booking, documents, notifications, data export.
- White label: each organisation has its own colours, logo, terminology (athlete/player/student, programme/team/class), language and currency.

## 3.3 Current state, plainly

| Item | State on 12 November 2026 |
|---|---|
| Application | Built: Next.js / Supabase (Postgres with row-level security) / Stripe. 26 database migrations. |
| Quality | Type-check, 114 unit tests, 10 database test suites (273 assertions) including cross-club isolation tests; production build and lint clean. |
| Security | Five internal reviews; every critical and high finding fixed with a regression test. **No external penetration test yet.** |
| Payments | Stripe Connect with one account per club (the club is paid directly; DLANG never holds club money). **Not yet proven with real money or with TWINT in production.** |
| Languages | 5 languages on the parent, registration and invoice journeys. Admin and coach screens, emails and PDFs still mostly English. |
| Customers | DLang Basketball (first customer, Lausanne) being prepared for go-live. **Zero paying external clubs.** |
| Revenue | **None.** |

## 3.4 Goal of the funded period

Move from "built and tested" to "proven and sold" in French-speaking Switzerland: a first customer running its whole cycle on the platform, then 5 founding clubs and 10 paying clubs (base case) by the end of November 2027, with TWINT payments reconciling automatically, an external security review and lawyer-reviewed nFADP compliance.

---

# 4. Innovation and digital technology

1. **The whole money chain on Swiss rails.** QR-bill generation to the Swiss implementation guidelines (v2.4, in force 14 November 2026), automatic choice of reference type (QRR with QR-IBAN, SCOR or NON with IBAN), TWINT and card through Stripe Connect paid directly to the club, automatic reconciliation through signed, idempotent webhooks with failure handling, refunds and disputes. Low-cost Swiss competitors do not reconcile; foreign competitors do not offer QR-bill or TWINT natively.
2. **Multi-tenant architecture secured in the database.** Every table carries the organisation id and row-level security policies for every operation; a test suite discovers every table automatically and checks that one club can never read another's data.
3. **Minors' data protection by design.** Medical data visible only to the club's administrators and the child's guardians; coaches see only what they need; finance sees no medical data. Record of processing, retention schedule (17 categories), breach register (72-hour deadline), access requests, nFADP / GDPR / COPPA / FERPA profiles per organisation. The system is "nFADP-aligned by design"; a third-party audit is planned and we claim no certification.
4. **White label and localisation as product properties**, not custom work: brand, terminology, sport, country, languages, currency, time zone and money format (CHF 1'234.50) per organisation, with no customer-specific code.
5. **Engineering method.** A human fractional CTO directs a team of AI-assisted software agents; every change is reviewed by a human, and changes to the database, security, payments and authentication need a second human approval. This lets a very small team ship and test a platform of this level at low cost, under human control.

**What we do not claim.** An AI assistant module for club staff exists. It is off by default, switched on only by a club that opts in, and sold as a separate paid add-on (not included in any subscription) from mid-2027 at the earliest, after a data-protection impact assessment. It is not part of this project, and no FIT funds are used for it.

---

# 5. Market and competition

## 5.1 Target market

The Swiss market is large in club numbers and small in budgets: 65% of clubs have 100 members or fewer and cannot pay CHF 290+ a month. Our target is narrower: the **2,000 to 3,000 Swiss organisations that collect programme fees from families**: private academies, camp operators, ski and football academies, international-school sports programmes and multi-sport clubs with a paid coordinator. Entry order: French-speaking Switzerland (Vaud and Geneva), then German-speaking Switzerland.

## 5.2 Competition

| Competitor | Position | Our answer |
|---|---|---|
| Spond | Free, localised to CHF; card payments at 2.5% + CHF 0.20 | For scheduling and messaging alone, Spond is the right answer. On total cost Spond is cheaper than us. Our edge is the payment cost: about CHF 693 a year against CHF 1,575 for the same club (QR-bill free), plus automatic reconciliation and programme and camp management. |
| ClubDesk, Webling | Low-cost membership admin (CHF 240 to 310 a year) | No programme commerce, no online payment reconciliation. |
| Paak, Fairgate | Free below a threshold or through federation deals | We avoid segments covered by a federation deal. |
| Twizzit, SportsNow, US players | Foreign or niche | No native Swiss payment rails, no minors-and-nFADP-first design. |

Competitor prices verified August 2026; re-check before commercial use.

## 5.3 International (no revenue in 2027)

In 2027 the priority is Switzerland. Alongside, we run **two design-partner pilots**, one in the EU and one in the US, mainly for learning (terminology, currencies, data-protection requirements). They are **not free**: each pilot club pays a reduced price (proposed 50% of list for the first six months, then list price, with a 12-month commitment), so the pilots recover part of their cost. EUR sales open only after at least 10 paying Swiss clubs (first EU club signed Q2 2028 at the earliest); the US will not be explored commercially before H2 2029.

---

# 6. Business model

SaaS subscription per club: a base fee of CHF 149 a month plus CHF 1.90 per active athlete a month, packaged as tiers.

| Tier | Athletes | CHF / month | Onboarding fee CHF |
|---|---|---|---|
| Starter | up to 75 | 290 | 750 |
| Club (primary target) | up to 180 | 490 | 1,500 |
| Academy | up to 400 | 890 | 2,900 |
| Multi-site / Federation | 1,000+ | from 1,690 | quoted (not before the 2028 pilot) |

- **Payments:** QR-bill free. TWINT and card at provider cost plus a small published DLANG application fee (about 0.5% gross, about 0.2% net). The rail is a reason to buy, not a margin line.
- **Founding offer:** 5 clubs at CHF 290 a month for life (capped at the signed tier), onboarding waived, 60-day money-back. Slots close 30 September 2027.
- **Sales:** founder-led, after a workflow audit of the club; we close only when the value measured on the club's own numbers is at least 3 times the price.

**Projections (Financial Model v2, years run December to November):**

| CHF | Year 1 (to Nov 2027) | Year 2 (to Nov 2028) | Year 3 (to Nov 2029) |
|---|---|---|---|
| Paying clubs at year end (base) | 10 | 26 | 45 |
| ARR at year end (base) | 39,600 | 117,100 | 238,500 |
| Cautious-case ARR (clubs) | 19,800 (6) | 63,900 (15) | 136,400 (27) |
| Total revenue (base) | 18,200 | 89,900 | 201,100 |
| EBITDA (base) | (143,500) | (182,300) | (186,500) |

The base case does not break even inside the 36-month horizon; at the Year-3 sales pace, break-even is expected around Q4 2030 at about 75 to 80 clubs. These are projections, not results.

---

# 7. Milestones for the funded period (12 months)

Dates shown as **base / cautious**. "Before filing" items are the progress evidence we attach as soon as they are reached.

| # | Milestone | Date base / cautious | Evidence |
|---|---|---|---|
| P1 | Before filing: at least 10 real DLang family payments, including TWINT, reconciled automatically | 18 Dec 2026 / 31 Jan 2027 | Reconciliation export, anonymised screenshots |
| P2 | Before filing: DLang runs a full cycle on the platform (registration, invoice, payment, attendance, reminder) | 14 Feb / 31 Mar 2027 | DLang usage metrics |
| M1 | External security review done; critical and high findings fixed | 31 Jan / 31 Mar 2027 | Provider report, fix list |
| M2 | First external founding club signed and live | signed 31 Jan / 31 Mar, live Feb / Apr 2027 | Contract, data processing agreement (DPA) |
| M3 | Admin and coach screens, emails and PDF invoices in French and German; offline attendance | 31 May / 31 Aug 2027 | Demo, translation check report |
| M4 | 3 paying clubs | May / Aug 2027 | Invoices issued |
| M5 | 5 founding clubs; DLang case study published | Jun / Sep 2027 | Contracts, case study |
| M6 | Season registration peak (June to September) run on the platform by every live club | 30 Sep 2027 | Registration and payment volumes |
| M7 | 10 paying clubs; ARR CHF 39,600 (cautious: 6 clubs, CHF 19,800) | 30 Nov 2027 | Billing report |
| M8 | Final report to FIT; decision on a FIT Digital Seed application if eligible [Verify on fondation-fit.ch] | 29 Feb 2028 | Final report |

**Indicators tracked monthly:** paying clubs and ARR; share of online payments reconciled automatically (target at least 95%); average days to payment; admin hours saved, measured in audits; uptime; security or data incidents (target zero).

---

# 8. Budget and use of the CHF 20,000

Estimates [Est.], to be replaced by quotes before filing. The grant funds no founder salary [Verify on fondation-fit.ch: eligible costs].

| # | Item | Content | CHF | Timing | Milestone |
|---|---|---|---|---|---|
| 1 | External security review | Penetration test of the application and of cross-club isolation by an independent provider, plus a re-test of the fixes | 5,500 | Jan to Mar 2027 | M1 |
| 2 | External senior engineering (fractional CTO or reviewer) | Production proof of TWINT and Stripe Connect reconciliation, offline attendance, review of every change | 6,500 | Mar to Sep 2027 | P1, M3 |
| 3 | Professional FR / DE localisation | Native-speaker translation and review of admin and coach screens, emails, notifications and PDF invoices | 2,500 | Mar to May 2027 | M3 |
| 4 | Data-protection compliance | Swiss lawyer review of the data processing agreement (DPA), the FR/DE/EN privacy notice and the impact assessment (DPIA) for minors' data | 2,500 | Mar to Apr 2027 | M2 |
| 5 | Pilot infrastructure (12 months) | Hosting, database, transactional email, monitoring and backups for DLang and the pilot clubs | 1,500 | Mar 2027 to Feb 2028 | M2 to M7 |
| 6 | Market validation in French-speaking Switzerland | Workflow audits at 10+ Vaud and Romandie clubs, usability tests with parents and coaches, case study production | 1,500 | Mar to Sep 2027 | M4, M5 |
| | **Total** | | **20,000** | | |

---

# 9. Financing plan

**Model Year 1 (December 2026 to November 2027), base case.** Operating costs about CHF 161,700 (revenue of CHF 18,200 minus EBITDA of CHF -143,500, Financial Model v2).

| Source | CHF | Status |
|---|---|---|
| Founder funds | 15,000 | [Confirm: amount and date] |
| Investor convertible loan (EUR 50,000) | about 46,500 | Committed, released once the CTO is in place; signature targeted 31 Jan 2027 [Confirm] |
| FIT Digital Grant (this application) | 20,000 | **Requested, not secured** |
| Club revenue (base) | 18,200 | Projection |
| **Total** | **about 99,700** | |
| **Remaining need** | **about 62,000** (about CHF 110,000 with a three-month buffer) | To be covered by upsizing the convertible to CHF 150,000 to 200,000 or by a bridge by April 2027 |

We state this gap openly: the grant alone is not enough, but it pays for exactly the proofs (security, payments, compliance, first clubs) that the rest of the funding depends on. Other steps: the >>venture>> competition (submission by 30 November 2026) and GENILEM coaching [Confirm: status of applications]. In our own financial model this grant counts at 0% until it is awarded.

---

# 10. Risks and mitigations

| Risk | Likelihood | Mitigation |
|---|---|---|
| Real TWINT payments do not reconcile as designed | Medium | Test on DLang with at least 10 real payments before any external club; QR-bill as the default; Payrexx as the documented fallback |
| Long sales cycle (club committees decide January to April) | High | Target academies and camps first, where one person decides; audits booked from November 2026 |
| Founder dependency (product, sales, support and first customer) | High | Fractional CTO or senior reviewer decided 8 January 2027; operations runbooks already written |
| Insufficient funding (cash negative from April 2027 without new money) | High | Convertible upsized to CHF 150,000 to 200,000; lean-cost variant; grant counted at zero until paid |
| Free competitors (Spond, Paak) | Medium | Position on programme commerce and payment cost, not subscription price |
| Minors' data incident | Low to medium | Database-level security, isolation tests, external review, cyber and professional liability insurance by 31 January 2027 |
| Trademark: "DLang" already names a programming language | Medium | Clearance search by 15 January 2027, Swiss filing by 28 February 2027 |
| FIT eligibility (company age, team) | To clear | Raised at the Innovaud pre-evaluation call before filing |

---

# 11. Economic impact in the Canton of Vaud

- **Office and jobs.** The company and the founder are in Vaud [Confirm]. Jobs follow commercial milestones, not before: fractional CTO from March 2027 [Confirm], customer-success lead at 50% from January 2028, first salaried engineer after a seed round (2029 at the earliest). We prefer modest forecasts that hold.
- **Vaud clubs.** French-speaking Switzerland is our first market. For a 150-athlete academy, the aim is to give back several hours a week to often-volunteer administrators and to reduce unpaid fees; these gains will be measured club by club and published only once measured.
- **Families.** Online registration and payment in French, TWINT and QR-bill, clear consent for children's data.
- **Local suppliers.** Fiduciary, lawyer, translators, security provider and coaches sourced in the canton first [Confirm].
- **Reach.** A multilingual, white-label Swiss platform built in Lausanne, designed to expand to the EU and then the US, each behind a written entry gate.

---

# 12. Planned annexes

1. Vaud commercial register extract and articles of association [Confirm]
2. CVs of the founder and team [Confirm]
3. Corrected pitch deck (figures sourced or marked as targets)
4. Business Plan v2 (November 2026) and Financial Model v2
5. Beta evidence: anonymised DLang screenshots and usage metrics, payment reconciliation export
6. Letters of intent or contracts from test clubs [Confirm]
7. IP assignment deed to the company [Confirm]
8. Quotes for budget items 1 to 6

---

# 13. Declarations

The undersigned certifies that the information in this dossier is accurate, that the grant will be used only for the project described, and that the costs presented are not funded by any other public support [Confirm].

Place and date: [Confirm]

Signature: ____________________

Derrick Lang, for Swiss Preparatory Sports Academy GmbH
