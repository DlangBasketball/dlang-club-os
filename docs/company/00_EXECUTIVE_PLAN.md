# 00 — Executive Operating Plan: DLANG Sports OS

**Prepared:** 11 November 2026 (week 12 of the founder's 13-week rollout, which ends 22 Nov 2026)
**Planning horizon:** 16 Nov 2026 – 30 Nov 2027 in detail; gates and milestones to 2029
**Updated:** 12 November 2026 with the founder's answers (decision log: `11_FOUNDER_DECISIONS_2026-11-12.md`), and the same day with the **round 2** follow-ups: the AI assistant is a **paid add-on** for clubs (DLang free), the EU and US pilots are **discounted paid pilots** (no free pilots anywhere), and a parent AI add-on is a proposal only (`13_PARENT_AI_ADDON_SPEC.md`). Figures of record: workbook **v2.2**.
**Status:** a recommendation built on the founder's August 2026 materials. All dates are **re-baselined from 16 Nov 2026** and shown as **base / downside**. The founder answered incorporation, FIT, round, CTO and payment-rail questions on 12 Nov 2026; audits done and actual cash remain *[Confirm]* for week 1.

**Label key:** [Founder] = taken from the founder's plan, model, deck or CTO proposal. [Est.] = estimate in this plan. [Confirm] = fact only the founder knows. [Verify] = needs a lawyer, fiduciary, tax adviser or auditor before relying on it. All amounts are CHF unless marked EUR.

**How this document fits:** it ties the company documents together and decides the order of work. Details live in:

| File | Covers |
|---|---|
| `01_BUSINESS_MODEL.md` | Segments, pricing, payment take-rate, unit economics, 3-year model |
| `02_GO_TO_MARKET.md` | Swiss sales motion and calendar, EUR track, US exploration gate |
| `03_CTO_TECHNOLOGY_STRATEGY.md` | Architecture, payments (Gate 2 work), security, technical roadmap |
| `04_ORG_DESIGN_AND_HR.md` | Org stages, hiring plan, CTO decision, equity |
| `05_LEGAL_CORPORATE_STRUCTURE.md` | GmbH, IP assignment, contracts, VAT, payments licensing, insurance |
| `06_CUSTOMER_SUCCESS_AND_SUPPORT.md` | Onboarding tracks, migration, SLAs, health scoring |
| `07_BRAND_AND_MARKETING.md` | Brand layers, naming, claims policy, launch calendar |
| `10_FINANCIAL_MODEL_V2_NOTES.md` | The v2 workbook: what changed and how to use it (the only computed source for financial figures and the break-even and bridge dates) |
| `11_FOUNDER_DECISIONS_2026-11-12.md` | The founder's 15 decisions of 12 Nov 2026, what changed, remaining risks, follow-up dates, figures and dates of record |
| `12_CTO_SOLUTION_AI_PLUS_HUMAN.md` | Why AI agents do the engineering but a named human fractional CTO is needed |
| `13_PARENT_AI_ADDON_SPEC.md` | Proposal (not committed): a paid parent AI add-on; user stories, limits, minors' data rules, pricing options, timing |
| `09_FOUNDER_PLAN_REVIEW.md` | Line-by-line review of the founder plan; source of the re-baselined dates |
| `source/` | The founder's originals: Business Plan, 90-Day Rollout, Financial Model, CTO Proposal, Executive Dashboard, Investor Deck |

## 0. Founder decisions of 12 November 2026 (what changed in this plan)

| Area | Decision [Founder] | Effect in this plan |
|---|---|---|
| Entity | Swiss Preparatory Sports Academy GmbH (SPSA) is the company; bank account "SPSA Tech" [Confirm register number and date] | Formation removed from the critical path. IP assignment to SPSA by 31 Dec 2026. New risk: software business and academy in one entity (risk #11) |
| CTO and cash | No CTO yet. EUR 50k is secured and released **once a CTO is in place**. Model: **named human fractional CTO + AI agent team**; the CTO sets the structure | CTO signed **15 Dec 2026** (latest 31 Jan 2027) is now on the critical path for cash |
| Funding | FIT not filed: modelled at **0%** (and possibly ineligible if SPSA's register entry is older than 6 months [Verify]). >>venture>> submitted by 30 Nov. Lean-cost variant accepted. One cap table for now | **12 Nov founder-facts case** (FIT 0%, EUR 50k cash Mar 2027): cash negative from **Jan 2027**, about –43.5k in Feb 2027 (workbook base: Apr 2027). **Top cash actions: sign the CTO and bridge Jan–Mar 2027 (~CHF 45k)**; pre-seed ~CHF 250–300k incl. the EUR 50k in H1 2027; seed CHF 400–500k Q1 2029 |
| Payment rail | Stripe Connect accepted; DLang connects first | D5 closed |
| Markets | Swiss paid launch first; one EU and one US design-partner pilot in 2027 behind entry conditions. **Round 2: no free pilots anywhere; both are discounted paid pilots** (proposed 50% off the Club-tier list for 6 months, 12-month commitment, then list [Confirm]) | New §4.6; full-price EU can move to early 2028 on a strong pilot; paid US gate unchanged |
| AI assistant | Opt-in per club as soon as fully functional; DLang beta Q1 2027. **Round 2: a paid add-on for clubs, not in the Club price; DLang gets it free** | Proposed **CHF 69 per club per month** [Est.][Confirm], sold to clubs from Jun 2027 (downside Sep 2027); v2.2 models 20% attach [Est.]. D4 revised |
| Parent AI add-on (round 2) | Idea, "maybe" | Spec only (`13`); not in the plan or the model; earliest a DLang-parents pilot after Nov 2027, base Q1 2028 [Confirm] |
| Name | "Global Sport OS" as master-brand candidate; clubs run it under their own name (e.g. "DLang OS") | Trademark and domain check CH/EU/US by 15 Jan 2027; 2–3 alternatives; "DLANG Sports OS" stays the working name |
| Dates of record | The v2 workbook is the only source for break-even and bridge dates | Break-even about Q4 2030 (workbook base), about mid-2030 (lean plan of record), Aug 2029 upside, 2032+ downside |
| No kill switch | Founder keeps going | "Lifestyle-or-stop" replaced by strategy review triggers (§4.7) |

---

## 1. The plan in one page

1. **DLang runs on it first.** DLang Basketball / Swiss Prep Sports Academy (145+ athletes [Founder]) is customer zero. No external club is promised a workflow DLang has not run end to end. DLang live on one full cycle incl. TWINT: **Feb 2027 / Mar 2027**. DLang running the whole club (Easter camp, summer camps, 2027/28 season registration and invoicing): **Sep 2027 / Oct 2027**.
2. **Then Swiss programme-revenue organisations, Romandie first.** Academies, camp operators, international-school sports programmes and multi-sport clubs with a paid coordinator, 100–300 athletes, no federation software deal [Founder ICP]. First paying external club **Feb 2027 / Apr 2027**; 10 clubs **Oct 2027 / Mar 2028**.
3. **Money must move before anything else ships.** Stripe with per-club Connect accounts (direct charges plus an application fee; accepted by the founder 12 Nov 2026, DLang connects first) so the platform never holds club money; QR-bill stays free and the default; TWINT reconciles automatically on DLang by **18 Dec 2026 / 31 Jan 2027**. Payrexx is the documented fallback.
4. **The white-label SaaS is the destination, not the 2027 launch.** The code is already multi-tenant (`org_id` + RLS on every table, runtime theming, locale and currency settings). That is kept. But paid EUR-track sales, paid US sales and broad white-label resale each open only behind an explicit gate (section 4). In 2027 the only non-Swiss activity is **one discounted paid EU and one discounted paid US design-partner pilot**, each behind entry conditions (section 4.6). No free pilots anywhere (round 2, 12 Nov 2026).
5. **Fund against the downside.** The two top cash actions: **sign the fractional CTO** (target 15 Dec 2026) so the secured EUR 50k is released, and **bridge January–March 2027 (about CHF 45k)**, because in the 12 Nov founder-facts case (FIT 0%, EUR 50k cash in Mar 2027) the v2 workbook shows cash negative from January 2027 and about –43.5k in February. Then sign the convertible by 31 Jan 2027 and raise a pre-seed of about **CHF 250–300k in total, including the EUR 50k, in H1 2027** (upsize or bridge by Apr 2027 at the latest; on the workbook base, cash goes negative in Apr 2027); seed CHF 400–500k in Q1 2029. Run the lean-cost plan and hire capacity by the hour until 10 paying clubs.

**Where ambition and realism diverge, plainly.** The goal of a global, any-sport, white-label SaaS sold in Switzerland, the EU and the USA is a sound ten-year destination. As a 2027 launch it would fail: the only proven advantages (TWINT and QR-bill economics, French/German coverage, the founder's Romandie network) do not travel to the US; the US market is held by well-funded, consolidating incumbents with free tiers and channels; one founder cannot sell in three legal systems and two time zones; and the company has about CHF 61.5k of secured capital (founder CHF 15k plus EUR 50k released once a CTO is in place; FIT at 0%) [Founder]. The founder's wish for an EU and US presence in 2027 is met with one discounted paid design-partner pilot in each (no free pilots, round 2), not with full-price launches. The deck's 150 clubs / EUR 808k ARR on its own timeline has **under 15%** odds [Est.]. Ten Swiss clubs by end-2027 has **50–60%** odds [Est.]. This plan optimises for the second.

---

## 2. Mission, vision and the two products

**Mission.** Give sports organisations back the hours and the money they lose to spreadsheets, WhatsApp threads and chasing parents for payments, so coaches can coach.

**Vision (10-year).** The operating system that any club, school or sports organisation, in any sport and country, runs on under its own brand: registration, payments, scheduling, attendance, communication and athlete development in one place.

**Positioning for 2027 (Swiss)** (adopted by the founder on 12 Nov 2026). "The cheapest payment rail in Switzerland for clubs that collect real money: QR-bill free by default, TWINT and card when parents want them, reconciled automatically." This replaces the deck's "cheaper than Spond on total cost", which is false on the founder's own table (DLANG CHF 6,573/yr vs Spond 1,755/yr; DLANG only wins on the payment rail, 693 vs 1,575) [Founder BP §5.3; see 01 §5.4].

| | Product 1: DLang's own operating system | Product 2: DLANG Sports OS (white-label SaaS) |
|---|---|---|
| Who | DLang Basketball / Swiss Prep Sports Academy, Lausanne | Swiss programme-revenue organisations now; EU, US, federations and resellers later |
| Job | Run the whole club: programmes, camps, registration, invoicing (QR-bill, TWINT, card), reminders, attendance, coach and parent apps, player development bookings | Same platform per tenant, with the club's branding, terminology, language and currency |
| Success test | DLang admin hours and CHF outstanding fall measurably; case study signed by DLang's director/treasurer by 31 Mar 2027 | Paying clubs that use it weekly, renew, and refer |
| Status (11 Nov 2026) | Code covers most admin/coach/parent flows; card checkout and QR-bill work; TWINT is only a manual label; no per-club Connect | Tenancy, theming and an AI assistant exist; CSV import, translations, offline attendance and per-club payment accounts are missing |
| Rule | Every new workflow runs on a DLang term or camp **before** it is sold | One codebase, no forks per customer, ever |

---

## 3. 12-month master roadmap by quarter (base case)

Swiss rhythm governs the sequence: clubs are effectively closed ~21 Dec – 4 Jan; committees decide Jan–Apr (often at the spring AGM); summer-camp registration opens ~March; season registration peaks Jun–Sep; nobody onboards during the peak unless set up by end of May. So clubs signed in Q1 2027 go live for summer camps and the 2027/28 season, and **Q3–Q4 2027 is the first real wave**.

| Quarter | Product / tech (03) | GTM (02) | People (04) | Legal / compliance (05) | Funding (01) | Exit criteria |
|---|---|---|---|---|---|---|
| **Q4 2026** (16 Nov – 31 Dec) | Stripe Connect accepted (12 Nov); DLang Connect account applied for 27 Nov. Stripe TWINT + Connect in staging; webhook reconciliation with failure states and duplicate protection. DLang winter-camp pilot (W4). QR-bill checked against v2.4 (in force 14 Nov 2026). Holidays: maintenance only. | 10 workflow audits booked (academies, camp operators, international schools first). Proposals to 2 warmest. Gate 1 fallback price card ready 15 Dec. | **Fractional CTO shortlisted 30 Nov, signed 15 Dec** (releases EUR 50k); reviewer fallback pre-contracted 16 Dec. | SPSA GmbH register details confirmed 20 Nov [Confirm]; IP present assignment to SPSA by 31 Dec; carve-out view from lawyer/fiduciary 15 Dec. Legal view on fund-holding/AML. Security review booked by 4 Dec. | >>venture>> submitted by **30 Nov**. FIT: not filed; next intake and the ≤6-months-since-register-entry rule checked by 27 Nov; modelled at 0%. Investor's CTO release condition in writing 27 Nov. **Jan–Mar bridge (~CHF 45k) agreed 15 Dec.** Deck/claim fix 4 Dec. | **Gate 2: 18 Dec** (red line 31 Dec, downside 31 Jan). |
| **Q1 2027** | FR/DE string catalogue for parent registration, invoices, reminders. DLang spring-term invoicing fully on platform. External security review done by 31 Jan; criticals/highs fixed. CSV import with mapping preview; offline attendance. **All four missing beta items done by 28 Feb.** AI assistant opt-in beta on DLang (Feb, complimentary), after the DPIA addendum; add-on price confirmed 15 Dec 2026, acceptance criteria written by 31 Mar. | Audits completed; **Gate 1 by 31 Jan** (downside 15 Mar). **First founding club signed 31 Jan** (downside 31 Mar), live Feb. 2 more in negotiation for spring go-live. EU and US design-partner candidates shortlisted by 31 Mar. | Fractional CTO running the AI agent team; CTO proposes structure, decision rights and any equity by **8 Jan**. | Compliance pack (ROPA, DPIA incl. AI addendum, DPA with AI sub-processor, privacy notice FR/DE/EN) by 15 Jan. Cyber + E&O insurance bound by 31 Jan. Trademark and domain check CH/EU/US for "Global Sport OS" + 2–3 alternatives by 15 Jan; naming decision 15 Feb; CH filing 28 Feb. VAT decision with fiduciary by 31 Mar. | Model refresh 3 Jan (workbook v2.2: FIT 0%, lean cost, AI as a paid add-on, discounted paid pilots). Jan–Mar bridge (~CHF 45k) carries cash to the release. **Convertible signed 31 Jan; EUR 50k cash Mar** (founder-facts case; Feb on the workbook base). Pre-seed (CHF 250–300k incl. the EUR 50k) signed by 28 Feb, cash in by Apr at the latest. GENILEM / MassChallenge CH applications. | **Gate 3 (DLang full cycle): 14 Feb** (downside 31 Mar). DLang case study by 31 Mar. First strategy-review checkpoint 31 Mar. |
| **Q2 2027** | Productised onboarding (recorded walkthroughs, in-app checklist, accountant export). DLang Easter camp and summer-camp registration on platform. AI add-on (paid, opt-in) on sale to clubs from Jun once acceptance criteria are met (downside Sep). Hardening for peak load. EUR/SEPA and USD/US-English groundwork for the pilots. | **3 paying clubs by May** (downside Aug). All set up by **31 May** for the summer peak. **5 founding clubs by Jun** (downside Sep). **Pilot go/no-go 30 Jun** (EU and US). | Founder capacity check: >5 concurrent onboardings breaks the founder (8–10 h/club). Pilot support hours assigned before go. | DPA signed with every club before data import. EU (GDPR Art. 27 representative) and US (COPPA, entity, cross-border Connect) counsel memos by 31 May [Verify]. | Pre-seed of CHF 250–300k in total (incl. the EUR 50k) closed in H1 2027. | **Gate 3b: club #1 weekly with a reference, 30 Apr** (downside 30 Jun). |
| **Q3 2027** | No risky releases during Jun–Sep peak; reliability and support tooling. DLang 2027/28 season registration and invoicing on platform. Pilot tenants set up (EU: EUR, SEPA, FR/DE; US: USD, US English, COPPA consent flow). | Referral programme on after 2 measured case studies. First list-price clubs (CHF 490 + setup fee) signed for the season. **Discounted paid EU pilot live Sep** (downside Jan 2028); **discounted paid US pilot live Sep–Oct** (downside Mar 2028). | Begin scoping part-time customer success (recruit from Oct). | Annual policy review; sub-processor list current. Art. 27 representative appointed before the EU pilot goes live. | Runway reviewed monthly on the plan of record; seed preparation for Q1 2029. | DLang running the whole club: **Sep 2027** (downside Oct). |
| **Q4 2027** (to 30 Nov) | Integrations backlog per 03 §6 (accounting export first). Multi-site needs scoped from real customers only. | **10 paying clubs by Oct** (downside Mar 2028). Pilot reviews at 60 days; EU case study drafted. | Part-time CS recruited for **Jan 2028** start (downside Jun 2028). | EU paid-track prerequisites (non-Union OSS) scoped [Verify]. | Model re-run on 10 clubs of actuals. | EUR gate review (needs ≥10 CH clubs); pull-forward to early 2028 if the EU pilot meets its success criteria. |

**Later milestones (base / downside):** 25 paying Swiss clubs Oct 2028 / Jun 2029 · CHF 10k MRR Dec 2028 / Sep 2029 · first paid EUR-track club signed Q2 2028 (early 2028 if the EU pilot is strong), live Sep 2028 / 2029 · first federation or multi-site white-label pilot H2 2028 / 2029 · first EBITDA-positive month (v2 workbook): about mid-2030 on the lean-cost plan of record, about Q4 2030 on the workbook defaults, Aug 2029 upside / 2032 or later downside · first engineer employee Q1 2029 after the seed · seed round Q1 2029 · paid US sales gate not before H2 2029 (discounted paid US pilot from fall 2027) · broad white-label resale 2029 at the earliest.

---

## 4. Launch gates: what must be true

A gate is passed only when **every** condition is met and evidenced. Dates are targets, not triggers.

### 4.1 Go live with DLang (Gate 2 + Gate 3) — base 14 Feb 2027 / downside 31 Mar 2027

| Condition | Evidence |
|---|---|
| A real TWINT payment reconciles automatically (Gate 2) | ≥10 real DLang payments reconciled with zero manual steps; failure and duplicate cases tested |
| Per-club Stripe Connect account for DLang; DLANG never touches funds | Connect account live; written legal view on fund-holding/AML [Verify] |
| QR-bill compliant with v2.4 (structured addresses) | Bank-accepted test bills |
| One full cycle: registration → payment (QR-bill, card, TWINT) → 7/14-day reminders → attendance | Spring-term run; admins active weekly |
| RLS tenant isolation passes `testing/rls_test_suite.sql`; backups and restore tested | Test output; restore drill logged |
| `npx tsc --noEmit` and `npm run build` green; no secrets in repo | CI log |

### 4.2 Sell in Switzerland (first external paid club) — base 31 Jan 2027 / downside 31 Mar 2027

| Condition | Evidence |
|---|---|
| SPSA GmbH register extract on file; all IP (founder, SIDIS, contractors) assigned to SPSA (or to a carved-out tech company if the lawyer advises it) | Register extract; signed present assignments [Verify] |
| Gate 1: ≥6 of 10 audits show ≥3× value at the quoted price | Audit write-ups with verbatim price reactions |
| Compliance pack: ROPA, DPIA (minors' data), DPA template, privacy notice FR/DE/EN, breach procedure | Lawyer sign-off [Verify] |
| External security review: zero open critical/high findings | Report |
| Cyber + professional liability insurance bound | Policy |
| Founding addendum (CHF 290/month for life, 24 months founder access, 60-day refund, month-to-month) [Founder] | Signed template |
| FR parent flows; CSV import ready for that club's data | Demo on the club's own spreadsheet |
| VAT position decided with fiduciary | Memo [Verify] |

### 4.3 Sell in the EU (EUR track) — base: sign Q2 2028, live Sep 2028 / downside 2029

≥10 paying Swiss clubs; gross margin ≥75%; SEPA Direct Debit live (first used in the discounted paid EU pilot); EU VAT via non-Union OSS and reverse charge set up [Verify]; GDPR Art. 27 representative appointed; DE and FR complete across all surfaces; EUR price card (EUR 149 + 2.00/athlete [Founder]); target region DE/AT/FR border first; no EU entity until a country has 3+ staff and recurring revenue (05 D7). **Pull-forward:** if the EU pilot (4.6) meets its success criteria and ≥10 Swiss clubs pay, the first paid EU club can be signed in **early 2028** instead of Q2 2028.

### 4.4 Sell in the US — not before H2 2029; decide then

All must be true: ≥40 paying clubs; ≥CHF 25k MRR; 12 months of net revenue retention ≥100%; a seed closed with a US budget line; the 2027 discounted US design partner moves to list price, or another US design partner pays list; a named US channel (league, school network or federation); counsel review of COPPA, state privacy law and state sales tax on SaaS [Verify]; Delaware subsidiary plan (05 D8). Odds of opening this gate by end-2029: low [Est.].

### 4.5 Broad white-label resale (agencies, resellers) — 2029 at the earliest

≥25 clubs on one codebase with no forks; an external penetration test passed; documented tenant-isolation tests in CI; a support SLA the company can actually staff; reseller contract and liability terms reviewed [Verify]. A federation or multi-site white-label pilot (H2 2028) comes first.

### 4.6 Discounted paid design-partner pilots, EU and US (added 12 Nov 2026; round 2: no free pilots)

The founder wants an EU and a US presence in 2027. The plan meets that with **exactly one pilot per market**, used as a model and case study. **Round 2 (12 Nov 2026): no free pilots at all.** Both pilots are **discounted paid pilots** ("so we don't lose"); the earlier "second free pilot in a market TBD" is removed and that market also pays a reduced price. Full-price sales stay behind 4.3 and 4.4. No free pilots in Switzerland.

**Pilot price (proposal) [Est.][Confirm]:** **50% off the Club-tier list price for the first 6 months, 12-month minimum commitment, then list price**; onboarding fee at 50%. EU: EUR 234.50 a month, then EUR 469. US: USD 249.50, then USD 499 (indicative). Alternative: the founding-equivalent EUR 279 / USD 299 for 12 months, then list (less revenue, Starter-price anchor). Workbook v2.2 books about CHF 2.6k / 8.8k / 10.3k of pilot revenue in model years 1 / 2 / 3; the pilot costs stay.

| | EU pilot | US pilot |
|---|---|---|
| Market | FR/DE-speaking border region (Grand Genève / Haute-Savoie, or Baden / Alsace); final country TBD | One club, academy or camp programme; US fall season |
| Target live (base / downside) | **Sep 2027 / Jan 2028** | **Sep–Oct 2027 / Mar 2028** (spring season) |
| Product and money | EUR, SEPA Direct Debit and card via Stripe Connect, FR or DE interface | USD, card/ACH via Stripe Connect cross-border [Verify], US English terminology |
| Privacy pack | GDPR: Art. 27 representative appointed, DPA in FR/DE, EU hosting confirmed | COPPA verifiable parental consent for under-13s, US privacy notice, state-law check [Verify with US counsel] |
| Entity | None (contract from SPSA); EU VAT on a paid cross-border sale (reverse charge / OSS) [Verify] | Whether a paid pilot needs a US entity or state sales-tax registration [Verify with counsel] |

**Entry conditions (all, per pilot):** DLang live in Switzerland and **≥3 paying Swiss clubs live** (base May 2027 / downside Aug 2027); i18n and currency complete for that market; the jurisdiction's privacy pack signed off; support hours named and covered (time zone included). **Go/no-go 30 Jun 2027.** Pilot terms: written agreement, 12-month commitment with the first 6 months at the pilot price, no custom development, data terms, case-study consent, and the list price after month 6 stated up front.

**Honest cost and capacity view.** Both pilots go live in the same weeks as the Swiss registration peak, DLang running the whole club and the push to 10 paying clubs. About CHF 15–30k cash in 2027 (representative, counsel memos, consent flow, travel, translation; carried in workbooks v2.1 and v2.2 at CHF 22.5k, May–Oct 2027; in v2.2 the discounted fees recover about CHF 2.6k in 2027 and the whole cost by about Nov 2029) and about 150–250 founder and CTO hours [Est.]. In the founder-facts case cash is negative from January 2027, so the pilots only start if the pre-seed has landed. If Swiss KPIs turn red (fewer than 3 paying clubs by 31 Aug, churn above 2.5%, or a P1 backlog), the pilots wait for the downside dates.

### 4.7 Strategy review triggers (replace the old stop rule, 12 Nov 2026)

The founder has committed to keep going, so there is no "lifestyle-or-stop" switch. Instead, each missed gate starts a **two-week structured review** (founder, fractional CTO, advisors) of pricing, segment, channel and offer, ending in a written corrective plan recorded in section 7 and reported in the next investor update.

| Trigger | Review focus | Corrective plays to choose from |
|---|---|---|
| Gate 1 missed (31 Jan / 15 Mar 2027) | Pricing, offer | Fallback price card (low subscription + fee on programme/camp value); annual prepay; Starter-first entry |
| No paid signature by 31 Mar 2027 | Offer, segment | Twenty more audits; switch audit order to camps/academies only; done-for-you setup bundle |
| Fewer than 3 paying CH clubs by 31 Aug 2027 | Channel, capacity | Postpone both pilots; DLang-network referrals with reward; implementation partner in Romandie |
| Fewer than 10 paying clubs by 31 Mar 2028 (the downside date) | Pricing, segment, channel, offer, cost | Services-plus-licence model for academies; federation or multi-site partner; schools segment; reseller via the DLang network; hold costs at the lean line; resize the funding plan |
| Churn above 2.5% a month for two months | Product, onboarding | Stop acquisition; sit with each club; fix the top three causes |
| Downside runway under 6 months | Funding, cost | Upsize or bridge; cut engineering to maintenance; defer pilots |

---

## 5. OKRs for the next two quarters

### Q4 2026 + January 2027 (16 Nov 2026 – 31 Jan 2027)

| Objective | Key results (target by 31 Jan 2027) |
|---|---|
| **O1. Money moves end to end on DLang** | KR1 Gate 2 passed (≥10 real TWINT payments auto-reconciled) by 18 Dec, no later than 31 Jan · KR2 DLang spring-term invoices 100% issued from the platform · KR3 zero manual reconciliation steps in January |
| **O2. Prove willingness to pay** | KR1 10 audits completed, ≥6 at ≥3× value · KR2 ≥3 clubs accept the price in writing · KR3 first founding club signed (addendum + DPA) |
| **O3. Make the company real and safe** | KR1 SPSA GmbH register details on file (20 Nov) and IP assigned to SPSA (31 Dec) · KR2 compliance pack signed off (15 Jan) · KR3 security review done, 0 open critical/high (31 Jan) · KR4 insurance bound |
| **O4. Fund the next 12 months** | KR1 >>venture>> submitted (30 Nov) · KR2 fractional CTO signed (15 Dec) so the EUR 50k is released; convertible signed (31 Jan) · KR3 Jan–Mar bridge (~CHF 45k) agreed (15 Dec) and pre-seed term sheet (CHF 250–300k incl. EUR 50k) agreed (31 Jan) · KR4 workbook defaults updated (FIT 0%, lean, AI as a paid add-on, discounted paid pilots; done 12 Nov 2026 in v2.2, refreshed with actuals 3 Jan) and showing ≥6 months runway on the downside case after the bridge |

### Q1 2027 extension (1 Feb – 31 Mar 2027)

| Objective | Key results (target by 31 Mar 2027) |
|---|---|
| **O1. DLang fully on the platform** | KR1 Gate 3 by 14 Feb · KR2 DLang admin weekly active ≥90% of weeks · KR3 case study signed and published with measured CHF outstanding and admin hours before/after |
| **O2. Close the beta scope** | KR1 CSV import, FR/DE, offline attendance, per-club Connect all shipped (28 Feb) · KR2 real club spreadsheet imports cleanly · KR3 build and type-check green on every merge · KR4 AI assistant opt-in beta live on DLang with the DPIA addendum signed |
| **O3. Build the founding cohort** | KR1 2 paying clubs live, 3 more in negotiation for go-live before 31 May · KR2 onboarding ≤12 calendar days and ≤10 founder hours per club · KR3 pipeline of ≥20 qualified Romandie organisations |
| **O4. Team decision executed** | KR1 fractional CTO in place and running the AI agent team; CTO's structure proposal agreed · KR2 one cap table identical across plan, model, CTO terms and deck · KR3 EUR 50k received by 31 Mar; pre-seed cash in by 30 Apr |

---

## 6. Top risk register (10, plus two added 12 Nov 2026)

Likelihood (L) and impact (I): H/M/L [Est.].

| # | Risk | L | I | Mitigation | Owner | Trigger to act |
|---|---|---|---|---|---|---|
| 1 | **Payment rail slips** (TWINT/Connect activation, reconciliation bugs) | H | H | Payment work is the only engineering priority; Payrexx fallback documented; manual beta if red line missed | Founder + engineering | Not live on DLang by 31 Dec |
| 2 | **No willingness to pay at CHF 290–490** against free Spond/Paak and federation-funded Fairgate | M–H | H | Audit private academies/camp operators first; Gate 1 fallback card (low subscription + fee on programme/camp value) ready 15 Dec | Founder | <6 of 10 audits at 3× by 31 Jan |
| 3 | **Founder capacity** (45–50 h/week; sales + product + onboarding + DLang) | H | H | Hours-based capacity (contractors, reviewer, AI agents); productised onboarding; cap concurrent onboardings at 3–5; Jun–Sep freeze | Founder | >5 concurrent onboardings or missed weekly review twice |
| 4 | **Cash runs out** (12 Nov founder-facts case: negative from Jan 2027, about –43.5k in Feb before the EUR 50k is released in Mar; workbook base: Apr 2027) | H | H | **Sign the CTO (15 Dec) and agree a Jan–Mar bridge of ~CHF 45k (15 Dec)**; FIT at 0% until awarded; pre-seed CHF 250–300k incl. EUR 50k in H1 2027; lean-cost plan of record | Founder | Bridge not agreed by 15 Dec, CTO not signed by 15 Dec, or downside runway <6 months |
| 5 | **Data breach / tenant leak of minors' data** | L–M | H | RLS test suite in CI; external review by 31 Jan; human approval on every migration, RLS and payment change; DPIA; cyber insurance | Engineering | Any critical finding or incident |
| 6 | **Fund-holding / AML exposure** if DLANG touches club money | M | H | Connect direct charges only; written legal view before first external club [Verify] | Founder + counsel | Lawyer view not received by 15 Jan |
| 7 | **Fractional CTO search drags** (now on the critical path for the EUR 50k) | H | H | Shortlist 30 Nov; sign 15 Dec; reviewer pre-contracted 16 Dec as cover; AI agents do the engineering, the CTO approves | Founder | No signed CTO by 15 Dec (latest 31 Jan) |
| 8 | **Scope creep toward the global vision** (AI, native apps, pilots turning into launches, resale) | H | M | Gates in section 4; exactly one discounted paid pilot per market with written scope; AI opt-in per club, paid add-on, with guardrails; parent AI add-on held as a proposal; PWA through 2027; one codebase, no forks | Founder | Any non-gate feature before 28 Feb; any custom pilot request |
| 9 | **IP / cap-table inconsistency** blocks investment (IP with founder "under SIDIS draft"; several cap tables in circulation [Founder]) | M | H | IP present assignment to SPSA by 31 Dec; one working cap table (founder decision 12 Nov) refined with the CTO and advisors, shown to the investor | Founder + lawyer | Before the EUR 50k is released |
| 10 | **Seasonal timing missed** (clubs not set up by 31 May wait a full season) | M | M–H | Signing window Jan–Apr; onboarding runbook; DLang as live demo | Founder | Fewer than 2 clubs signed by 30 Apr |
| 11 | **Software business and academy in one entity (SPSA GmbH)**: investor, club-trust and Stripe questions | M | H | Ring-fenced "SPSA Tech" accounts; internal service agreement; lawyer/fiduciary view on a carve-out by 15 Dec; carve-out before the seed at the latest [Verify] | Founder + lawyer + fiduciary | Investor, Stripe or a prospect club raises it |
| 12 | **2027 pilots stretch capacity and cash** (EU and US go live in the Swiss peak) | M–H | M | Entry conditions (≥3 paying CH clubs, i18n, privacy pack, support hours); go/no-go 30 Jun; pilots start only after the bridge lands | Founder + CTO | Swiss KPIs red, or bridge not in by 30 Jun |

---

## 7. Decision log

| # | Date | Decision | Rationale | Revisit when |
|---|---|---|---|---|
| D1 | Aug 2026 [Founder] | Swiss domestic track first, EUR export second | Proven wedge is TWINT/QR-bill + Romandie network | EUR gate (≥10 CH clubs) |
| D2 | Aug 2026 [Founder] | Pricing CHF 149 + 1.90/athlete/month; tiers 290/490/890/1,690; setup 750/1,500/2,900 | Scales with value; kept | Gate 1 result (31 Jan) |
| D3 | Aug 2026 [Founder]; amended 12 Nov 2026 | 5 founding clubs at CHF 290 for life, 60-day refund, month-to-month; paid pilots only; **round 2: no free pilots anywhere**, one discounted paid EU and one discounted paid US design-partner pilot | Creates references without free-pilot drag; the two discounted pilots buy market learning and test willingness to pay | Cohort full (base Jun 2027); pilot go/no-go 30 Jun 2027 |
| D4 | Nov 2026; revised 12 Nov 2026 | Native apps out of beta; PWA through 2027. AI assistant **opt-in per club** (DLang beta Q1 2027, complimentary); **round 2: a paid add-on for clubs, proposed CHF 69/month [Confirm]**, not in any tier price | Founder wants AI available once fully functional; guardrails and DPIA first | Measured push/retention issue (native); AI acceptance criteria met |
| D5 | 12 Nov 2026 [Founder] | Stripe with per-club Connect direct charges + application fee; QR-bill free default; Payrexx fallback; DLang connects first | Stack already built on Stripe; platform never holds club funds. Payment margin ~0.2% | Legal AML view; Stripe TWINT activation fails |
| D6 | 12 Nov 2026 [Founder] | Headline claim "cheapest payment rail"; "cheaper than Spond" retired | Founder's own table disproves the old claim | Never re-use without new data |
| D7 | Nov 2026 | All timelines re-baselined ~2 quarters later; sales cycle 45–90 days (not 21) | Original gates missed; Swiss committee calendar | Monthly model review |
| D8 | 12 Nov 2026 [Founder] | The company is Swiss Preparatory Sports Academy GmbH (SPSA), Vaud [Confirm register no.]; no EU/US entities; AG before first equity grant or seed | Already incorporated; cheapest compliant structure | Lawyer's carve-out view (15 Dec); seed term sheet |
| D9 | 12 Nov 2026 [Founder] | CTO: named human **fractional CTO + AI agent team**; the CTO sets the structure (by 8 Jan 2027). Not an AI-only CTO | Agents do the work; a human must be accountable for security, payments and diligence; the EUR 50k is released only once a CTO is in place | CTO not signed by 15 Dec |
| D10 | Nov 2026; amended 12 Nov 2026 | Paid US sales and broad white-label resale are gated later phases (H2 2029 / 2029+); one discounted paid US design-partner pilot in fall 2027 | Wedge does not travel; capacity; capital. A single discounted pilot buys learning cheaply | Pilot go/no-go 30 Jun 2027; gate review H2 2029 |
| D11 | Nov 2026 | Hire capacity by the hour until 10 clubs; first FTE engineer after seed (Q1 2029) | Do not hire on convertible money; CH notice periods 1–3 months | 10 paying clubs |
| D12 | 12 Nov 2026 [Founder] | FIT Digital not filed: prepare the application; model at 0% until filed and awarded | No grant income without an award | Next intake (check by 27 Nov) |
| D13 | 12 Nov 2026 [Founder] | EUR 50k secured, released once a CTO is in place; one cap table for now, refined by the CTO and advisors | Investor's condition | CTO signed; 3 Jan 2027 cap table |
| D14 | 12 Nov 2026 [Founder] | Lean-cost variant is the plan of record | Trough –441k → about –314k (–330k in the founder-facts case; about –326k in v2.2 with pilot costs, pilot fees and the paid AI add-on) | Seed close |
| D15 | 12 Nov 2026 [Founder]; amended round 2 | One discounted paid EU pilot (live Sep 2027 / Jan 2028) and one discounted paid US pilot (live Sep–Oct 2027 / Mar 2028) behind entry conditions; no free pilots; full-price EU can move to early 2028 on a strong pilot | Founder wants EU and US presence in 2027 | 30 Jun 2027 go/no-go |
| D16 | 12 Nov 2026 [Founder] | Master-brand candidate "Global Sport OS"; clubs run it under their own name; check CH/EU/US marks and domains by 15 Jan 2027 with 2–3 alternatives; "DLANG Sports OS" stays the working name | Generic names are hard to register | 15 Feb 2027 naming decision |
| D17 | 12 Nov 2026 [Founder] | Break-even and bridge dates come from the v2 workbook only | One computed source | Each model refresh |
| D18 | 12 Nov 2026 [Founder] | No kill switch: strategy review triggers (4.7) replace "fewer than 8 clubs by 31 Mar 2028 → lifestyle or stop" | Founder's commitment to keep going | Each trigger |

---

## 8. Operating cadence

| Rhythm | When | Who | Inputs | Output |
|---|---|---|---|---|
| **Weekly metrics review** (45 min) | Monday 08:00 | Founder (+ CTO/reviewer, + CS from 2028) | Scorecard below; pipeline; incidents; engineering board | 3 priorities for the week; any gate/red-line flag |
| **Engineering sync** (30 min) | Monday after review | Founder + engineering | Merged PRs, failing checks, security items | Release plan; human approvals queued |
| **Monthly advisor/investor update** (1 page + 30 min call) | First Thursday of the month | Founder → advisors, convertible investor(s), CTO | Scorecard trend, cash and runway (base/downside), gates, asks | Written update sent by the 5th; decisions recorded in section 7 |
| **Quarterly review** | Last week of each quarter | Founder + advisors | OKR scoring, model re-forecast, risk register | Next-quarter OKRs; gate go/no-go |
| **Seasonal freeze** | 21 Dec – 4 Jan; Jun–Sep peak (no risky releases) | All | — | Maintenance-only windows |

**Weekly scorecard** (one sheet, kept from the founder's Executive Dashboard intent): cash in bank and runway (base/downside) · MRR and paying clubs · pipeline by stage (audits, proposals, signed) · DLang: CHF outstanding, % paid within 7 days, admin hours · payments: count, % auto-reconciled, failures · weekly active admins per club · onboarding days per club · support tickets and open security findings · founder hours by category (sell / build / onboard / admin).

---

## 9. First 30 days: founder action list (16 Nov – 16 Dec 2026)

Owners: **F** = founder; **ENG** = CTO trial candidate or contractor + AI agents; **REV** = paid senior reviewer; **LAW** = lawyer; **FID** = fiduciary; **SEC** = external security firm; **ADV** = advisors.

| # | Action | Owner | Due | Done when |
|---|---|---|---|---|
| 1 | Truth week: the founder answered entity, FIT, round, CTO and rail on 12 Nov (`11_FOUNDER_DECISIONS_2026-11-12.md`); still to answer: audits done, actual cash, SPSA register number and date; write the 90-day retrospective | F | 20 Nov | One-page status shared with ADV and investor |
| 2 | Payment rail chosen (Stripe Connect, 12 Nov); request written view on fund-holding/AML, including SPSA being both platform and DLang club | F + ENG + LAW | 27 Nov | LAW engaged [Verify] |
| 3 | Enable TWINT in Stripe test mode; design per-club Connect | ENG | 27 Nov | Test TWINT payment succeeds |
| 4 | Check QR-bill generation against v2.4 (structured address) | ENG | 27 Nov | Bank-accepted test bill |
| 5 | Submit >>venture>> 2027 from the draft in `docs/company/applications/venture-2027/` | F | **30 Nov** | Submission confirmation |
| 6 | Confirm SPSA GmbH register number, date, purpose clause and shareholders; ask lawyer/fiduciary whether to carve out the software business; draft IP present assignments to SPSA (founder, SIDIS, contractors) | F + FID + LAW | Details 20 Nov; carve-out view 15 Dec; assignments signed 31 Dec | Extract on file; drafts received |
| 7 | Book 10 workflow audits (academies, camp operators, international schools first); hold 4 | F | Booked 22 Nov; 4 done by 16 Dec | Calendar; write-ups with verbatim price reactions |
| 8 | Fix deck and claims: drop "cheaper than Spond" (retired 12 Nov), qualify "€6,160 MVP", mark premium modules as roadmap, show Swiss-first sequence with the two discounted paid pilots and the AI add-on as a paid extra, and one cap table | F | 4 Dec | Claim audit passes |
| 9 | Book external security review (RLS/tenant isolation, auth, webhook, output escaping), CHF 5–15k [Est.] | F + SEC | 4 Dec | Signed engagement for January |
| 10 | Build TWINT checkout + webhook reconciliation (failure states, idempotency) in staging | ENG, reviewed by REV | 6 Dec | Staging run with tests |
| 11 | DLang live pilot on one real programme or winter camp (card + QR-bill + TWINT) | F + ENG | 13 Dec | Real parents paid; reconciliation report |
| 12 | Gate 1 fallback price card (low subscription + fee on programme/camp value), modelled per club | F | 15 Dec | One page ready to test |
| 13 | Draft compliance pack (ROPA, DPIA, DPA, privacy notice FR/DE/EN, breach procedure) | F, reviewed by LAW | Drafts 16 Dec; sign-off 15 Jan | Drafts with LAW |
| 14 | Pre-contract the reviewer (4–8 h/week) to cover until the fractional CTO starts, or if the CTO slips | F + REV | 16 Dec | Signed or ready-to-sign contract |
| 15 | Set up the weekly scorecard and send the first monthly update | F | Scorecard 23 Nov; update 5 Dec | Sheet live; update sent |
| 16 | Fractional CTO: brief per `12_CTO_SOLUTION_AI_PLUS_HUMAN.md`, shortlist, sign | F + ADV | Shortlist 30 Nov; signed **15 Dec** | Signed contract; investor notified so the EUR 50k is released |
| 17 | Get the investor's release condition for the EUR 50k in writing (what counts as "a CTO in place"); agree how Jan–Mar 2027 (~CHF 45k) is bridged: founder funds, investor advance, or deferring the CTO trial and pen-test costs [Confirm] | F | Condition 27 Nov; bridge 15 Dec | Email or side letter; bridge agreed |
| 18 | FIT Digital: confirm next intake and eligibility for SPSA (≤6 months since register entry for the Grant, ≤12 for the Seed loan; see `applications/fit-digital/FILING_STEPS.md`); finish the pack in `docs/company/applications/fit-digital/` | F | 27 Nov | Date known; pack ready to file |
| 19 | Trademark and domain check brief for "Global Sport OS" plus 2–3 alternatives (CH/EU/US) | F + LAW | Brief 4 Dec; results 15 Jan | Attorney engaged |

**Gate 2 target: 18 Dec 2026.** Red line 31 Dec (downside 31 Jan 2027): if missed, run the founding beta manually and keep payments as the only engineering priority [Founder failure response, kept].

---

## 10. Items needing professional validation

- Fund-holding and AML status under Connect direct charges; whether any SRO affiliation is needed; Stripe's treatment of SPSA as both platform and DLang club [Verify, LAW, Stripe].
- Whether to carve the software business out of SPSA GmbH, and when [Verify, LAW/FID].
- EU pilot: GDPR Art. 27 representative; US pilot: COPPA verifiable parental consent, need for a US entity, cross-border Stripe Connect [Verify, EU and US counsel].
- IP present-assignment wording to SPSA incl. SIDIS, convertible terms (cap stated post-money; release condition tied to the CTO; investor informed of any CTO equity) [Verify, LAW].
- Swiss VAT registration timing and treatment of application fees; EU non-Union OSS at the EUR gate [Verify, FID/tax adviser].
- DPIA for minors' data and any AI processing; DPA template; cross-border transfers to sub-processors [Verify, data-protection lawyer].
- Employer social charges and CH contractor/false-self-employment risk for long-running contractors [Verify, FID].
- Workbook defaults updated to the plan of record (FIT 0%, lean cost) and pilot costs added: done in `updated/DLANG_Sports_OS_Financial_Model_v2.1.xlsx` (12 Nov 2026); round 2 (AI paid add-on, discounted paid pilots) in `updated/DLANG_Sports_OS_Financial_Model_v2.2.xlsx` (plan of record: shortfalls about 102k / 225k / 326k; Jan–Mar bridge about CHF 45k); advisor review of the inputs still needed [Verify, ADV].

---

## 11. Changes vs. founder's August 2026 plan

| Topic | Founder plan (Aug 2026) | Updated (11 Nov 2026; rows marked 12 Nov reflect the founder's decisions) | Why |
|---|---|---|---|
| Planning baseline | 90-day rollout 24 Aug – 22 Nov 2026 | Re-baselined from 16 Nov 2026, base / downside dates | Original gates largely missed or unconfirmed |
| Gate 1 (willingness to pay) | 20 Sep 2026 | 31 Jan 2027 / 15 Mar 2027 | Audits likely incomplete; committees reconvene in January |
| Gate 2 (TWINT reconciles) | 18 Oct 2026, red line 31 Dec | 18 Dec 2026 / 31 Jan 2027; red line kept with manual fallback | TWINT is only a manual label in code; no Connect yet |
| Gate 3 | Club #1 weekly by 22 Nov 2026 | DLang full cycle 14 Feb 2027 / 31 Mar; club #1 weekly (3b) 30 Apr / 30 Jun 2027 | DLang must go first; seasonal go-live |
| First paid signature | By 30 Nov 2026 | 31 Jan 2027 / 31 Mar 2027 | Sales cycle 45–90 days, holiday closure |
| 5 founding clubs | 31 Jan 2027 | Jun 2027 / Sep 2027 | Same; set-up deadline 31 May for summer peak |
| 10 paying clubs | ~Jun 2027 (model) | Oct 2027 / Mar 2028 | Season-start wave is the real adds window |
| Break-even | First month Jul 2028 | **12 Nov:** v2 workbook only: about mid-2030 (lean plan of record), about Q4 2030 (workbook defaults), Aug 2029 upside / 2032 or later downside | Later ramp; realistic engineering cost; social charges; founder chose the workbook as the only source |
| Markets | Deck: "worldwide, every team sport" | CH 2027 (paid); **12 Nov:** one discounted paid EU pilot (Sep 2027 / Jan 2028) and one discounted paid US pilot (Sep–Oct 2027 / Mar 2028); full-price EUR Q2 2028 (early 2028 on a strong pilot); paid US H2 2029+; resale 2029+ | Wedge does not travel; capacity; capital; founder wants a 2027 EU/US presence |
| Payment margin | 0.9% net on 50% of collections (Payrexx ~1.3%) | ~0.2% on Stripe; QR-bill free default | Code uses Stripe; TWINT on Stripe ~1.9% + 0.30 |
| Payment architecture | Not specified | Stripe Connect direct charges per club; Payrexx fallback; legal AML view | DLANG must never hold club money |
| Headline claim | "Cheaper than Spond on total cost" | "Cheapest payment rail for clubs that collect real money" | Old claim false on own table (6,573 vs 1,755/yr) |
| Beta scope | CSV import, multilingual, offline, per-club payments in beta | Same, finished by 28 Feb 2027. **12 Nov:** AI assistant opt-in per club, DLang beta Q1 2027 (complimentary); round 2: paid add-on for clubs from Jun 2027, proposed CHF 69/month [Confirm] | Four items missing from repo; founder wants AI once fully functional, with DPIA and guardrails |
| Engineering cost | CHF 4,500/month (~CHF 43/h) | Swiss rates CHF 110–150/h, or explicit agent + reviewer model | Model under-costs Swiss engineering |
| FIT grant | CHF 20k at 100% | **12 Nov:** not filed; 0% until filed and awarded; application pack being prepared | Deadline 10 Nov 2026 missed |
| Funding | EUR 50k round + founder 15k + FIT 20k | **12 Nov:** EUR 50k secured, released once a CTO is in place (assumed Mar 2027); bridge Jan–Mar 2027 (~CHF 45k); pre-seed ~CHF 250–300k incl. the EUR 50k in H1 2027; seed CHF 400–500k Q1 2029 | Founder-facts case: cash negative from Jan 2027 (workbook base: Apr 2027) |
| CTO | Partner in place Sep–Oct 2026; month-4 cutoff | **12 Nov:** named human fractional CTO + AI agent team, signed 15 Dec 2026 (latest 31 Jan); CTO sets the structure by 8 Jan | An AI agent cannot be accountable; the EUR 50k depends on a CTO |
| Customer success hire | ~Club 10 (Aug 2027) | Jan 2028 / Jun 2028, after productised onboarding | Founder breaks at ~5 concurrent onboardings |
| First engineer FTE | Year 2 | Q1 2029, after seed | Do not hire on convertible money |
| Cap table | 90% → 81% → 72% (plan/model) vs 64.8% (CTO proposal) | **12 Nov:** one working cap table now, refined with the CTO and advisors, shown to the investor | Inconsistent documents block diligence |
| IP | With founder, "under SIDIS draft" | Present assignment to SPSA GmbH by 31 Dec 2026 | Required before any investment closes |
| Odds stated | Deck: 10/50/150 clubs, EUR 54k/269k/808k ARR | 10 clubs by end-2027: 50–60%; deck path <15%; fundable Swiss vertical SaaS by 2029: 35–45% [Est.] | Honest planning against the downside |
| Entity (12 Nov) | GmbH to be formed in Vaud | Swiss Preparatory Sports Academy GmbH (SPSA), bank account "SPSA Tech" [Confirm register no.]; carve-out view by 15 Dec | Founder's answer; academy and software in one entity is a new risk |
| Founding offer and pilots (12 Nov) | Founding programme; paid pilots | No free pilots anywhere (round 2); capped founding cohort; one discounted paid EU and one discounted paid US design partner | Founder's decision |
| Founder pay (12 Nov) | 2.5k / 6k / 8.5k | Lean-cost variant (Y2/Y3 founder 3.5k/5k, engineering 6k/8k, sales and marketing 1k/1.5k) | Founder accepted; trough about –314k to –330k (v2.2 plan of record: –326k) |
| Name (12 Nov) | DLANG Sports OS | "Global Sport OS" candidate; clubs use their own name (e.g. "DLang OS"); trademark and domain check CH/EU/US by 15 Jan 2027; 2–3 alternatives; decision 15 Feb | Generic names are hard to register |
| Stop rule (12 Nov) | Kill criteria reviews | Strategy review triggers (4.7); no stop decision | Founder's commitment to keep going |
