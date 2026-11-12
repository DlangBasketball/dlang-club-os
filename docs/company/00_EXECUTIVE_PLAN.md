# 00 — Executive Operating Plan: DLANG Sports OS

**Prepared:** 11 November 2026 (week 12 of the founder's 13-week rollout, which ends 22 Nov 2026)
**Planning horizon:** 16 Nov 2026 – 30 Nov 2027 in detail; gates and milestones to 2029
**Status:** a recommendation built on the founder's August 2026 materials. All dates are **re-baselined from 16 Nov 2026** and shown as **base / downside**. Where the status since August is unknown (incorporation, FIT filing, round, audits, CTO trial), it is marked *[Confirm]* and must be answered by the founder in week 1.

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
| `07_*` (in progress in parallel) | Remaining company document in the 01–07 set; referenced by number only |
| `09_FOUNDER_PLAN_REVIEW.md` | Line-by-line review of the founder plan; source of the re-baselined dates |
| `source/` | The founder's originals: Business Plan, 90-Day Rollout, Financial Model, CTO Proposal, Executive Dashboard, Investor Deck |

---

## 1. The plan in one page

1. **DLang runs on it first.** DLang Basketball / Swiss Prep Sports Academy (145+ athletes [Founder]) is customer zero. No external club is promised a workflow DLang has not run end to end. DLang live on one full cycle incl. TWINT: **Feb 2027 / Mar 2027**. DLang running the whole club (Easter camp, summer camps, 2027/28 season registration and invoicing): **Sep 2027 / Oct 2027**.
2. **Then Swiss programme-revenue organisations, Romandie first.** Academies, camp operators, international-school sports programmes and multi-sport clubs with a paid coordinator, 100–300 athletes, no federation software deal [Founder ICP]. First paying external club **Feb 2027 / Apr 2027**; 10 clubs **Oct 2027 / Mar 2028**.
3. **Money must move before anything else ships.** Stripe with per-club Connect accounts (direct charges plus an application fee) so DLANG never holds club money; QR-bill stays free and the default; TWINT reconciles automatically on DLang by **18 Dec 2026 / 31 Jan 2027**. Payrexx is the documented fallback.
4. **The white-label SaaS is the destination, not the 2027 launch.** The code is already multi-tenant (`org_id` + RLS on every table, runtime theming, locale and currency settings). That is kept. But EUR track, US and broad white-label resale each open only behind an explicit gate (section 5).
5. **Fund against the downside.** Close the convertible by 31 Jan 2027, prepare a CHF 100–150k bridge by Sep 2027 (Jun 2027 downside), seed in Q1 2029. Hire capacity by the hour until 10 paying clubs.

**Where ambition and realism diverge, plainly.** The goal of a global, any-sport, white-label SaaS sold in Switzerland, the EU and the USA is a sound ten-year destination. As a 2027 launch it would fail: the only proven advantages (TWINT and QR-bill economics, French/German coverage, the founder's Romandie network) do not travel to the US; the US market is held by well-funded, consolidating incumbents with free tiers and channels; one founder cannot sell in three legal systems and two time zones; and the company has at most about CHF 81.5k of committed or targeted capital [Founder]. The deck's 150 clubs / EUR 808k ARR on its own timeline has **under 15%** odds [Est.]. Ten Swiss clubs by end-2027 has **50–60%** odds [Est.]. This plan optimises for the second.

---

## 2. Mission, vision and the two products

**Mission.** Give sports organisations back the hours and the money they lose to spreadsheets, WhatsApp threads and chasing parents for payments, so coaches can coach.

**Vision (10-year).** The operating system that any club, school or sports organisation, in any sport and country, runs on under its own brand: registration, payments, scheduling, attendance, communication and athlete development in one place.

**Positioning for 2027 (Swiss).** "The cheapest payment rail in Switzerland for clubs that collect real money: QR-bill free by default, TWINT and card when parents want them, reconciled automatically." This replaces the deck's "cheaper than Spond on total cost", which is false on the founder's own table (DLANG CHF 6,573/yr vs Spond 1,755/yr; DLANG only wins on the payment rail, 693 vs 1,575) [Founder BP §5.3; see 01 §5.4].

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
| **Q4 2026** (16 Nov – 31 Dec) | Payment-rail decision 27 Nov. Stripe TWINT + Connect in staging; webhook reconciliation with failure states and duplicate protection. DLang winter-camp pilot (W4). QR-bill checked against v2.4 (in force 14 Nov 2026). Holidays: maintenance only. | 10 workflow audits booked (academies, camp operators, international schools first). Proposals to 2 warmest. Gate 1 fallback price card ready 15 Dec. | CTO trial status [Confirm]; reviewer fallback contract drafted. | GmbH in Vaud + IP present assignment by 31 Dec (if not done [Confirm]). Legal view on fund-holding/AML. Security review booked by 4 Dec. | >>venture>> submitted by **30 Nov**. FIT committee 1 Dec (if filed [Confirm]). Deck/claim fix 4 Dec. | **Gate 2: 18 Dec** (red line 31 Dec, downside 31 Jan). |
| **Q1 2027** | FR/DE string catalogue for parent registration, invoices, reminders. DLang spring-term invoicing fully on platform. External security review done by 31 Jan; criticals/highs fixed. CSV import with mapping preview; offline attendance. **All four missing beta items done by 28 Feb.** | Audits completed; **Gate 1 by 31 Jan** (downside 15 Mar). **First founding club signed 31 Jan** (downside 31 Mar), live Feb. 2 more in negotiation for spring go-live. | **CTO decision 8 Jan**: offer from trial, or founder + AI agents + paid senior reviewer (4–8 h/week). If partner: start Mar 2027. | Compliance pack (ROPA, DPIA, DPA, privacy notice FR/DE/EN) by 15 Jan. Cyber + E&O insurance bound by 31 Jan. Trademark clearance 15 Jan ("DLang" also names a programming language), CH filing 28 Feb. VAT decision with fiduciary by 31 Mar. | Model refresh 3 Jan (seasonality, Stripe margin, real engineering cost, grant probability). **Convertible signed 31 Jan.** GENILEM / MassChallenge CH applications. | **Gate 3 (DLang full cycle): 14 Feb** (downside 31 Mar). DLang case study by 31 Mar. |
| **Q2 2027** | Productised onboarding (recorded walkthroughs, in-app checklist, accountant export). DLang Easter camp and summer-camp registration on platform. Hardening for peak load. | **3 paying clubs by May** (downside Aug). All set up by **31 May** for the summer peak. **5 founding clubs by Jun** (downside Sep). | Founder capacity check: >5 concurrent onboardings breaks the founder (8–10 h/club). | DPA signed with every club before data import. | **Bridge term sheet by 30 Jun** (CHF 100–150k). Downside: bridge must close by Jun. | **Gate 3b: club #1 weekly with a reference, 30 Apr** (downside 30 Jun). |
| **Q3 2027** | No risky releases during Jun–Sep peak; reliability and support tooling. DLang 2027/28 season registration and invoicing on platform. | Referral programme on after 2 measured case studies. First list-price clubs (CHF 490 + setup fee) signed for the season. | Begin scoping part-time customer success (recruit from Oct). | Annual policy review; sub-processor list current. | **Bridge closed by Sep** (base). Cash: model goes negative Jul 2027 without it [Founder model]. | DLang running the whole club: **Sep 2027** (downside Oct). |
| **Q4 2027** (to 30 Nov) | Integrations backlog per 03 §6 (accounting export first). Multi-site needs scoped from real customers only. | **10 paying clubs by Oct** (downside Mar 2028). EUR-track readiness review only (no selling). | Part-time CS recruited for **Jan 2028** start (downside Jun 2028). | EU prerequisites scoped (non-Union OSS, GDPR Art. 27 rep) for the 2028 EUR gate [Verify]. | Model re-run on 10 clubs of actuals. | EUR gate review (needs ≥10 CH clubs). |

**Later milestones (base / downside):** 25 paying Swiss clubs Oct 2028 / Jun 2029 · CHF 10k MRR Q4 2028 / Q3 2029 · first EUR-track club signed Q2 2028, live Sep 2028 / 2029 · first federation or multi-site white-label pilot H2 2028 / 2029 · first EBITDA-positive month Q2–Q3 2029, durable late 2029 / not before 2030 · first engineer employee Q1 2029 after the seed · seed round Q1 2029 · US exploration gate not before H2 2029 · broad white-label resale 2029 at the earliest.

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
| GmbH registered; all IP (founder, SIDIS, contractors) assigned to it | Register extract; signed present assignments [Verify] |
| Gate 1: ≥6 of 10 audits show ≥3× value at the quoted price | Audit write-ups with verbatim price reactions |
| Compliance pack: ROPA, DPIA (minors' data), DPA template, privacy notice FR/DE/EN, breach procedure | Lawyer sign-off [Verify] |
| External security review: zero open critical/high findings | Report |
| Cyber + professional liability insurance bound | Policy |
| Founding addendum (CHF 290/month for life, 24 months founder access, 60-day refund, month-to-month) [Founder] | Signed template |
| FR parent flows; CSV import ready for that club's data | Demo on the club's own spreadsheet |
| VAT position decided with fiduciary | Memo [Verify] |

### 4.3 Sell in the EU (EUR track) — base: sign Q2 2028, live Sep 2028 / downside 2029

≥10 paying Swiss clubs; gross margin ≥75%; SEPA Direct Debit live; EU VAT via non-Union OSS and reverse charge set up [Verify]; GDPR Art. 27 representative appointed; DE and FR complete across all surfaces; EUR price card (EUR 149 + 2.00/athlete [Founder]); target region DE/AT/FR border first; no EU entity until a country has 3+ staff and recurring revenue (05 D7).

### 4.4 Sell in the US — not before H2 2029; decide then

All must be true: ≥40 paying clubs; ≥CHF 25k MRR; 12 months of net revenue retention ≥100%; a seed closed with a US budget line; one paying inbound US design partner; a named US channel (league, school network or federation); counsel review of COPPA, state privacy law and state sales tax on SaaS [Verify]; Delaware subsidiary plan (05 D8). Odds of opening this gate by end-2029: low [Est.].

### 4.5 Broad white-label resale (agencies, resellers) — 2029 at the earliest

≥25 clubs on one codebase with no forks; an external penetration test passed; documented tenant-isolation tests in CI; a support SLA the company can actually staff; reseller contract and liability terms reviewed [Verify]. A federation or multi-site white-label pilot (H2 2028) comes first.

---

## 5. OKRs for the next two quarters

### Q4 2026 + January 2027 (16 Nov 2026 – 31 Jan 2027)

| Objective | Key results (target by 31 Jan 2027) |
|---|---|
| **O1. Money moves end to end on DLang** | KR1 Gate 2 passed (≥10 real TWINT payments auto-reconciled) by 18 Dec, no later than 31 Jan · KR2 DLang spring-term invoices 100% issued from the platform · KR3 zero manual reconciliation steps in January |
| **O2. Prove willingness to pay** | KR1 10 audits completed, ≥6 at ≥3× value · KR2 ≥3 clubs accept the price in writing · KR3 first founding club signed (addendum + DPA) |
| **O3. Make the company real and safe** | KR1 GmbH registered and IP assigned (31 Dec) · KR2 compliance pack signed off (15 Jan) · KR3 security review done, 0 open critical/high (31 Jan) · KR4 insurance bound |
| **O4. Fund the next 12 months** | KR1 >>venture>> submitted (30 Nov) · KR2 convertible signed (31 Jan) · KR3 refreshed model shows ≥6 months runway on the downside case |

### Q1 2027 extension (1 Feb – 31 Mar 2027)

| Objective | Key results (target by 31 Mar 2027) |
|---|---|
| **O1. DLang fully on the platform** | KR1 Gate 3 by 14 Feb · KR2 DLang admin weekly active ≥90% of weeks · KR3 case study signed and published with measured CHF outstanding and admin hours before/after |
| **O2. Close the beta scope** | KR1 CSV import, FR/DE, offline attendance, per-club Connect all shipped (28 Feb) · KR2 real club spreadsheet imports cleanly · KR3 build and type-check green on every merge |
| **O3. Build the founding cohort** | KR1 2 paying clubs live, 3 more in negotiation for go-live before 31 May · KR2 onboarding ≤12 calendar days and ≤10 founder hours per club · KR3 pipeline of ≥20 qualified Romandie organisations |
| **O4. Team decision executed** | KR1 CTO partner signed (start Mar) or reviewer model running · KR2 cap table identical across plan, model, CTO terms and deck |

---

## 6. Top-10 risk register

Likelihood (L) and impact (I): H/M/L [Est.].

| # | Risk | L | I | Mitigation | Owner | Trigger to act |
|---|---|---|---|---|---|---|
| 1 | **Payment rail slips** (TWINT/Connect activation, reconciliation bugs) | H | H | Payment work is the only engineering priority; Payrexx fallback documented; manual beta if red line missed | Founder + engineering | Not live on DLang by 31 Dec |
| 2 | **No willingness to pay at CHF 290–490** against free Spond/Paak and federation-funded Fairgate | M–H | H | Audit private academies/camp operators first; Gate 1 fallback card (low subscription + fee on programme/camp value) ready 15 Dec | Founder | <6 of 10 audits at 3× by 31 Jan |
| 3 | **Founder capacity** (45–50 h/week; sales + product + onboarding + DLang) | H | H | Hours-based capacity (contractors, reviewer, AI agents); productised onboarding; cap concurrent onboardings at 3–5; Jun–Sep freeze | Founder | >5 concurrent onboardings or missed weekly review twice |
| 4 | **Cash runs out** (model negative from Jul 2027; FIT grant counted at 100%) | M–H | H | Grant at 50% (0 if not filed); convertible by 31 Jan; bridge term sheet 30 Jun; capital-light variant (Y1 opex ~57k vs 112.8k [Founder]) | Founder | Downside runway <6 months |
| 5 | **Data breach / tenant leak of minors' data** | L–M | H | RLS test suite in CI; external review by 31 Jan; human approval on every migration, RLS and payment change; DPIA; cyber insurance | Engineering | Any critical finding or incident |
| 6 | **Fund-holding / AML exposure** if DLANG touches club money | M | H | Connect direct charges only; written legal view before first external club [Verify] | Founder + counsel | Lawyer view not received by 15 Jan |
| 7 | **CTO search drags** (CHF 1,200/month Y1 retainer for 4–5 days/week is a hard sell [Founder]) | H | M | Decision 8 Jan; reviewer fallback pre-contracted; no equity grant without trial deliverable (TWINT reconciliation) | Founder | No signed terms by 8 Jan |
| 8 | **Scope creep toward the global vision** (AI, native apps, US, resale) | H | M | Gates in section 4; AI off by default per tenant; PWA through 2027; one codebase, no forks | Founder | Any non-gate feature before 28 Feb |
| 9 | **IP / cap-table inconsistency** blocks investment (IP with founder "under SIDIS draft"; founder 81% vs 64.8% in different documents [Founder]) | M | H | GmbH + present assignment by 31 Dec; one cap table incl. CTO grant shown to investor | Founder + lawyer | Before convertible signs |
| 10 | **Seasonal timing missed** (clubs not set up by 31 May wait a full season) | M | M–H | Signing window Jan–Apr; onboarding runbook; DLang as live demo | Founder | Fewer than 2 clubs signed by 30 Apr |

---

## 7. Decision log

| # | Date | Decision | Rationale | Revisit when |
|---|---|---|---|---|
| D1 | Aug 2026 [Founder] | Swiss domestic track first, EUR export second | Proven wedge is TWINT/QR-bill + Romandie network | EUR gate (≥10 CH clubs) |
| D2 | Aug 2026 [Founder] | Pricing CHF 149 + 1.90/athlete/month; tiers 290/490/890/1,690; setup 750/1,500/2,900 | Scales with value; kept | Gate 1 result (31 Jan) |
| D3 | Aug 2026 [Founder] | 5 founding clubs at CHF 290 for life, 60-day refund, month-to-month; paid pilots only | Creates references without free-pilot drag | Cohort full (base Jun 2027) |
| D4 | Nov 2026 | Native apps and customer-facing AI out of beta; PWA through 2027 | Founder plan scoped them out; capacity | Measured push/retention issue or paying multi-site demand (2028) |
| D5 | by 27 Nov 2026 | Stripe with per-club Connect direct charges + application fee; QR-bill free default; Payrexx fallback | Stack already built on Stripe; DLANG never holds funds. Payment margin re-modelled ~0.2% not 0.9% (Payrexx assumption) | Legal view; Stripe TWINT activation fails |
| D6 | Nov 2026 | Headline claim changed to "cheapest payment rail", not "cheaper than Spond" | Founder's own table disproves the old claim | Never re-use without new data |
| D7 | Nov 2026 | All timelines re-baselined ~2 quarters later; sales cycle 45–90 days (not 21) | Original gates missed; Swiss committee calendar | Monthly model review |
| D8 | by 31 Dec 2026 | One Swiss GmbH in Vaud; no EU/US entities; AG before first equity grant or seed | Cheapest compliant structure | Seed term sheet |
| D9 | by 8 Jan 2027 | CTO: Structure A if trial delivers; otherwise founder + AI agents + paid senior reviewer | Avoid a long search blocking the payment rail | 8 Jan 2027 |
| D10 | Nov 2026 | US and broad white-label resale are gated later phases (H2 2029 / 2029+) | Wedge does not travel; incumbents; capacity; capital | Gate review H2 2029 |
| D11 | Nov 2026 | Hire capacity by the hour until 10 clubs; first FTE engineer after seed (Q1 2029) | Do not hire on convertible money; CH notice periods 1–3 months | 10 paying clubs |

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
| 1 | Truth week: answer the status questions in `09_FOUNDER_PLAN_REVIEW.md` §7 (incorporation, FIT filed, round, audits, CTO trial, cash); write the 90-day retrospective | F | 20 Nov | One-page status shared with ADV and investor |
| 2 | Choose the payment rail and request written view on fund-holding/AML | F + ENG + LAW | 27 Nov | Decision memo; LAW engaged [Verify] |
| 3 | Enable TWINT in Stripe test mode; design per-club Connect | ENG | 27 Nov | Test TWINT payment succeeds |
| 4 | Check QR-bill generation against v2.4 (structured address) | ENG | 27 Nov | Bank-accepted test bill |
| 5 | Submit >>venture>> 2027 (reuse business-plan sections) | F | **30 Nov** | Submission confirmation |
| 6 | If not incorporated: instruct GmbH formation in Vaud; draft IP present assignments (founder, SIDIS, contractors) | F + FID + LAW | Instruct by 27 Nov; register by 31 Dec | Instruction signed; drafts received |
| 7 | Book 10 workflow audits (academies, camp operators, international schools first); hold 4 | F | Booked 22 Nov; 4 done by 16 Dec | Calendar; write-ups with verbatim price reactions |
| 8 | Fix deck and claims: drop "cheaper than Spond", qualify "€6,160 MVP", mark premium modules as roadmap, show Swiss-first sequence and one cap table incl. CTO grant | F | 4 Dec | Claim audit passes |
| 9 | Book external security review (RLS/tenant isolation, auth, webhook, output escaping), CHF 5–15k [Est.] | F + SEC | 4 Dec | Signed engagement for January |
| 10 | Build TWINT checkout + webhook reconciliation (failure states, idempotency) in staging | ENG, reviewed by REV | 6 Dec | Staging run with tests |
| 11 | DLang live pilot on one real programme or winter camp (card + QR-bill + TWINT) | F + ENG | 13 Dec | Real parents paid; reconciliation report |
| 12 | Gate 1 fallback price card (low subscription + fee on programme/camp value), modelled per club | F | 15 Dec | One page ready to test |
| 13 | Draft compliance pack (ROPA, DPIA, DPA, privacy notice FR/DE/EN, breach procedure) | F, reviewed by LAW | Drafts 16 Dec; sign-off 15 Jan | Drafts with LAW |
| 14 | Pre-contract the reviewer fallback (4–8 h/week) in case the CTO decision on 8 Jan is "no" | F + REV | 16 Dec | Signed or ready-to-sign contract |
| 15 | Set up the weekly scorecard and send the first monthly update | F | Scorecard 23 Nov; update 5 Dec | Sheet live; update sent |

**Gate 2 target: 18 Dec 2026.** Red line 31 Dec (downside 31 Jan 2027): if missed, run the founding beta manually and keep payments as the only engineering priority [Founder failure response, kept].

---

## 10. Items needing professional validation

- Fund-holding and AML status under Connect direct charges; whether any SRO affiliation is needed [Verify, LAW].
- GmbH formation, IP present-assignment wording incl. SIDIS, convertible terms (cap stated post-money; investor informed of CTO grant) [Verify, LAW].
- Swiss VAT registration timing and treatment of application fees; EU non-Union OSS at the EUR gate [Verify, FID/tax adviser].
- DPIA for minors' data and any AI processing; DPA template; cross-border transfers to sub-processors [Verify, data-protection lawyer].
- Employer social charges and CH contractor/false-self-employment risk for long-running contractors [Verify, FID].
- Financial model re-forecast (seasonality, Stripe margin, engineering cost at Swiss rates CHF 110–150/h vs the model's ~CHF 43/h) [Verify, ADV].

---

## 11. Changes vs. founder's August 2026 plan

| Topic | Founder plan (Aug 2026) | Updated (11 Nov 2026) | Why |
|---|---|---|---|
| Planning baseline | 90-day rollout 24 Aug – 22 Nov 2026 | Re-baselined from 16 Nov 2026, base / downside dates | Original gates largely missed or unconfirmed |
| Gate 1 (willingness to pay) | 20 Sep 2026 | 31 Jan 2027 / 15 Mar 2027 | Audits likely incomplete; committees reconvene in January |
| Gate 2 (TWINT reconciles) | 18 Oct 2026, red line 31 Dec | 18 Dec 2026 / 31 Jan 2027; red line kept with manual fallback | TWINT is only a manual label in code; no Connect yet |
| Gate 3 | Club #1 weekly by 22 Nov 2026 | DLang full cycle 14 Feb 2027 / 31 Mar; club #1 weekly (3b) 30 Apr / 30 Jun 2027 | DLang must go first; seasonal go-live |
| First paid signature | By 30 Nov 2026 | 31 Jan 2027 / 31 Mar 2027 | Sales cycle 45–90 days, holiday closure |
| 5 founding clubs | 31 Jan 2027 | Jun 2027 / Sep 2027 | Same; set-up deadline 31 May for summer peak |
| 10 paying clubs | ~Jun 2027 (model) | Oct 2027 / Mar 2028 | Season-start wave is the real adds window |
| Break-even | First month Jul 2028 | Q2–Q3 2029, durable late 2029 / not before 2030 | Later ramp; realistic engineering cost; social charges |
| Markets | Deck: "worldwide, every team sport" | CH 2027; EUR track Q2 2028 earliest; US gate H2 2029+; resale 2029+ | Wedge does not travel; capacity; capital |
| Payment margin | 0.9% net on 50% of collections (Payrexx ~1.3%) | ~0.2% on Stripe; QR-bill free default | Code uses Stripe; TWINT on Stripe ~1.9% + 0.30 |
| Payment architecture | Not specified | Stripe Connect direct charges per club; Payrexx fallback; legal AML view | DLANG must never hold club money |
| Headline claim | "Cheaper than Spond on total cost" | "Cheapest payment rail for clubs that collect real money" | Old claim false on own table (6,573 vs 1,755/yr) |
| Beta scope | CSV import, multilingual, offline, per-club payments in beta | Same, finished by 28 Feb 2027; AI assistant off by default, not sold | Four items missing from repo; AI/minors' data DPIA |
| Engineering cost | CHF 4,500/month (~CHF 43/h) | Swiss rates CHF 110–150/h, or explicit agent + reviewer model | Model under-costs Swiss engineering |
| FIT grant | CHF 20k at 100% | 50% probability (0 if not filed) | Committee 1 Dec; filing unconfirmed |
| Funding | EUR 50k round + founder 15k + FIT 20k | Convertible by 31 Jan 2027; bridge CHF 100–150k by Sep 2027 (Jun downside); seed Q1 2029 | Model cash negative from Jul 2027; trough ~107k base, ~336k bear [Founder] |
| CTO | Partner in place Sep–Oct 2026; month-4 cutoff | Decision 8 Jan 2027; start Mar 2027 or reviewer model from Feb | Retainer level and CH notice periods slow the search |
| Customer success hire | ~Club 10 (Aug 2027) | Jan 2028 / Jun 2028, after productised onboarding | Founder breaks at ~5 concurrent onboardings |
| First engineer FTE | Year 2 | Q1 2029, after seed | Do not hire on convertible money |
| Cap table | 90% → 81% → 72% (plan/model) vs 64.8% (CTO proposal) | One cap table incl. CTO grant, shown to investor | Inconsistent documents block diligence |
| IP | With founder, "under SIDIS draft" | Present assignment to the GmbH by 31 Dec 2026 | Required before any investment closes |
| Odds stated | Deck: 10/50/150 clubs, EUR 54k/269k/808k ARR | 10 clubs by end-2027: 50–60%; deck path <15%; fundable Swiss vertical SaaS by 2029: 35–45% [Est.] | Honest planning against the downside |
