# DLANG Sports OS: Org Design and HR Plan

**Status:** working document, re-baselined 11 November 2026; updated 12 November 2026 with the founder's decisions (`11_FOUNDER_DECISIONS_2026-11-12.md`; CTO model in `12_CTO_SOLUTION_AI_PLUS_HUMAN.md`)
**Owner:** founder / CEO. People, payroll and legal items are checked by a Swiss fiduciary and an employment lawyer before use.
**Builds on:** Business Plan §9 "Organisation and people" (Aug 2026), the CTO Partnership Proposal (Structure A), the Financial Model, `09_FOUNDER_PLAN_REVIEW.md`, and the companion documents `01_BUSINESS_MODEL.md`, `02_GO_TO_MARKET.md` and `03_CTO_TECHNOLOGY_STRATEGY.md`.

**Labels**
- **[Founder]**: a decision or figure from the founder's August 2026 materials, kept.
- **[Est.]**: an estimate or assumption made here. Every salary band in this document is [Est.].
- **[Verify]**: must be confirmed by a fiduciary, employment lawyer, tax adviser or a live salary survey before anyone relies on it.

---

## 1. The decisions in brief

1. **The founder's question stays the right one.** The question is "in what order does the founder stop doing things", not "who do we hire" [Founder BP §9.1]. Until there are 10 paying clubs, DLANG hires **capacity by the hour**, not people by the year. That means contractors, a paid senior reviewer and AI agents. The only senior hire now is a **named human fractional CTO** who leads the AI agent team (founder decision, 12 Nov 2026).
2. **Headcount follows revenue gates, not dates.** Stage 1 (5–8 people, about 3–5 FTE) is built across **2027–2029**, not in 2027. Stage 2 (15–25 people) requires a seed round and the EUR track working, so it is **2030 at the earliest**. Stage 3 (40+) is a Series-A-funded company, so **2032 or later**. The deck's "worldwide" org cannot be staffed or funded on the current plan, and this document does not pretend it can.
3. **Switzerland is the employer of record for the core team.** The company is **Swiss Preparatory Sports Academy GmbH (SPSA)** [Founder, 12 Nov; Confirm register no.], converted to an AG before the first employee equity grant. EU and US people are contractors or go through an Employer-of-Record (EoR) until a country has 3 or more people and recurring revenue. A local entity comes only after that.
4. **CTO model decided 12 Nov 2026: fractional CTO + AI agent team.** The founder asked whether an AI agent could be CTO; the answer is that agents do the engineering but a named human must be accountable for architecture, security sign-off, payment/RLS/migration approvals and investor diligence. Target **signed by 15 Dec 2026** (latest 31 Jan 2027). The EUR 50k is released only once a CTO is in place, so this hire is on the **critical path for cash**. The CTO proposes structure, decision rights and any equity by 8 Jan 2027 (Structure A is one option, no longer the default). A paid senior reviewer (4–8 h/week, pre-contracted by 16 Dec) covers until the CTO starts. The first engineer employee comes in **Q1 2029, after the seed**. Swiss notice periods of 1–3 months mean recruiting starts the day the seed closes.
5. **The first non-engineering hire is customer success, not sales.** The founder plan triggered it at club 10 [Founder]; here it starts in **Jan 2028** (base) or **Jun 2028** (downside). Onboarding at 8–10 hours per club breaks the founder at about 5 concurrent clubs [review §3.5]. Productised onboarding has to come first, and the person comes second.
6. **One equity philosophy, written once.** There is a 10% option pool [Founder cap table]. Grants are made in the AG under a Swiss employee participation plan with a cantonal tax ruling. Every grant vests over 4 years with a 1-year cliff, and the founder reverse-vests too [Founder]. US options wait for a US entity.

---

## 2. Where we are (11 Nov 2026)

| Item | State | Source |
|---|---|---|
| People | Founder only. Contractors ad hoc. AI coding agents in use. | Review brief |
| Founder load | 45–50 h/week without an engineering partner, alongside running DLang Basketball (145+ athletes, Sep–May season, holiday camps) | RO §01, review §3.5 |
| CTO | None confirmed (founder, 12 Nov). Fractional CTO + AI agent team adopted; target signed 15 Dec 2026. EUR 50k released once a CTO is in place | Founder decisions 3, 6, 7 |
| Legal entity | Swiss Preparatory Sports Academy GmbH (SPSA), Vaud; bank account "SPSA Tech" [Confirm register no. and date]. IP present assignment to SPSA by 31 Dec 2026. The academy and the software business share the entity (carve-out view by 15 Dec) | Founder decision 1 |
| Payroll, social insurance | Nothing set up. A fiduciary is planned "immediately on incorporation" at CHF 250–400/month. | BP §9.1 |
| Budget envelope | Lean-cost plan of record (accepted 12 Nov): founder pay Y2/Y3 CHF 3.5k/5k, engineering Y2/Y3 CHF 6k/8k; no employees before 2028 | v2 workbook; `01_BUSINESS_MODEL.md` §10.1 |

**The constraint everything follows from:** the v2 workbook base has 10 / 26 / 45 paying clubs at Nov 2027 / 28 / 29, and ARR of CHF 39.6k / 117.1k / 238.5k. One Swiss software engineer, fully loaded, costs roughly CHF 150–185k a year [Est.]. **That is more than the company's 2028 ARR.** Every hire before the seed has to be part-time, variable or paid in equity.

---

## 3. Org chart by stage

### Stage 0: founder-led (now → about 10 paying clubs; base Q4 2027, downside Q1 2028)

```
                    Founder / CEO  (product, sales, onboarding, DLang operator)
                              |
     +------------------------+-------------------------+----------------------+
     |                        |                         |                      |
 Fractional CTO (human)      Senior reviewer            Fixed-price            Outsourced services
 from Dec 2026 [base]        4-8 h/week [cover until    specialists            - Fiduciary (books, payroll, VAT)
   Feb 2027 [downside]       the CTO starts]            - pen-test firm        - Employment / corporate lawyer
     |                                                  - translators FR/DE/IT - External DPO / privacy adviser
 AI coding agents (planner, implementer, migration-     - designer (sprints)
 reviewer, security-reviewer, test-writer, docs-keeper)
 -- humans own every merge to production
```

| Seat | Who | Load | Cost/month [Est.] |
|---|---|---|---|
| CEO | Founder | full time, of which ~40% DLang | 2,500 + social charges in Y1; lean plan 3,500 / 5,000 in Y2 / Y3 [workbook] |
| CTO | Fractional CTO (named human) leading the AI agent team; structure set by the CTO | part-time [Est.] | Within the engineering line (CHF 4.8k/month Y1 in the workbook) [Est.; Confirm with the CTO] |
| Review and security sign-off | Senior Swiss/EU engineer, contractor | 4–8 h/week | 1,500–4,000 |
| Finance, payroll, VAT | Fiduciary | retainer | 250–400 [Founder] |
| Legal, privacy | Lawyer + external DPO, by the hour | spikes | budget 10–12k/year one-off [01 §10] |

### Stage 1: Swiss launch and scale (about 10 → 50 clubs; 2028–2029; 5–8 people, about 3–5 FTE)

```
                              CEO (founder)  -- sales lead CH, partnerships
          +-------------------+--------------------+------------------------+
          |                   |                    |                        |
     CTO (partner)       Customer Success     Ops & Finance              (outsourced: fiduciary,
          |              Lead (CH, 50%→100%)   coordinator (CH, 40-60%)   lawyer, DPO, pen-test)
   +------+--------+          |
   |               |     Support / onboarding
 Senior full-   Contract     specialist (CH, part-time,
 stack engineer  mobile/QA   season Jun-Oct, FR/DE)
 (CH, Q1 2029,   (EU, as
  after seed)    needed)
                         + Sales development (part-time, CH, club 25)
```

### Stage 2: EU track live, US exploration (about 50 → 150 clubs; 2030 at the earliest; 15–25 people)

```
                                         CEO
  +-----------+-------------+------------+-------------+--------------+-------------+
 CTO       Head of        Head of       Head of        Finance &      People (fractional
  |        Product        Customer      Sales (CH+EU)  Ops lead       → HR generalist)
  |        + designer     Success        |  AE CH (FR/DE)  + Legal/DPO
  |                      CSMs CH x2     |  AE DACH (EoR)   (counsel, part-time)
  |                      CSM EU (EoR)   |  SDR x1-2
  |                      Support x2     Partnerships/federations manager
 Eng lead -- platform x2, product eng x3, mobile x1, QA/DevOps/SRE x1, security (fractional)
                                         Marketing manager (content, events, PLG)
                                         US: 1 founding AE or partner manager, only once the US gate opens
```

### Stage 3: multi-market company (40+ people; Series A funded; 2032 or later)

The team is organised by function, with country "pods" for sales and customer success (CH, DACH, FR/BE, US). There are separate platform, payments, mobile and data teams, and a security team led by a security lead. Leadership is CEO, CTO, VP Sales, VP Customer, VP Product, CFO, Head of People, and Legal counsel/DPO. **This stage is described for completeness and direction only. No date is planned for it.**

---

## 4. Role catalogue

### 4.1 Mission, responsibilities and KPIs

| Function / role | Mission | Key responsibilities | KPIs |
|---|---|---|---|
| **CEO (founder)** | Make clubs pay for and rely on DLANG | Product direction and closing (never handed over [Founder]), fundraising, hiring, DLang reference account, federation relationships | Paying clubs; net new MRR; cash runway ≥ 9 months; gate dates hit |
| **CTO** | Safe, shippable multi-tenant platform | Architecture, payment rail, RLS and security, agent operating model, merge authority, hiring engineers | Gate 2 date; cross-tenant incidents = 0; change failure rate; onboarding hours/club < 5 by month 12 [Founder] |
| Platform engineer | Tenancy, data, infrastructure | Migrations, RLS, multi-region readiness, performance at several hundred tenants | p95 latency; migration rollbacks; RLS test coverage |
| Product engineer | Features clubs use weekly | Registration, payments UI, schedule, attendance, messaging, i18n | Cycle time; weekly-active admins; bug escape rate |
| Mobile engineer | Coach and parent apps | PWA, offline attendance, later white-label native builds (2028 decision [03 §4]) | Crash-free sessions; push opt-in; app-store releases |
| QA engineer | Stop regressions reaching clubs | Test strategy, payment and RLS regression suites, release sign-off in peak season | Escaped defects in Jun–Sep; suite runtime |
| DevOps / SRE | Uptime and recoverability | CI/CD, backups and restore drills, monitoring, incident on-call | Uptime ≥ 99.5% [Est.]; restore-drill pass; MTTR |
| Security lead (fractional → employee) | Children's data stays safe | Pen tests, ISO 27001-aligned controls, vendor review, incident response | Open high findings = 0 past SLA; audit readiness |
| **Product manager / Head of Product** | Right thing, in the right order | Roadmap, discovery with clubs, beta scope discipline, terminology/locale configuration | Feature adoption; scope delivered vs. committed |
| Product designer | Fast, trusted admin and parent UX | Design system (V5 palette), white-label theming, accessibility | Task completion time; support tickets per feature |
| **Customer Success Lead / CSM** | Every club live in < 30 days and renewing | Onboarding, data import, admin training, health scoring, renewals, case studies | Time-to-live; logo churn; NRR; onboarding hours/club |
| Support specialist | Fast answers in FR/DE/EN | Tier-1 tickets, help centre, parent payment questions in peak season | First response < 4 business h [Est.]; CSAT; tickets/club |
| **Sales: AE Switzerland** | Close ICP clubs (100–300 athletes, paid admin) | Audits at 3× value [Founder], proposals, committee meetings | Win rate; cycle length (45–90 days expected); ACV |
| SDR (CH, later EU) | Qualified audits on the calendar | Outbound to academies, camp operators, international schools | Audits booked/month; audit→proposal rate |
| AE EU (DACH or FR/BE) | Open the EUR track | Same as CH, in EUR, SEPA, local references | EUR clubs signed; time to first 5 |
| AE US / partner manager | Test the US thesis cheaply | Design-partner deals, channel partners | Paying US design partners; channel pipeline |
| **Marketing manager** | Inbound that sales can close | Case studies (DLang first), content in FR/DE, events, federation newsletters, website | Inbound audits/month; CAC payback |
| **Partnerships / federations manager** | Channel leverage | Cantonal sport offices, J+S, federations, multi-site pilots, resellers (2029+ gate) | Partner-sourced pipeline; pilots signed |
| **Finance & Ops** | Clean books, cash visibility, compliant payroll | Billing, dunning, VAT (CH, later EU OSS), payroll through fiduciary, board pack, model refresh | Days to close; DSO; forecast accuracy |
| **Legal & Compliance / DPO** | Lawful processing of minors' data, sound contracts | DPA templates, record of processing, revFADP/GDPR, Art. 27 representative (EU), AML view on payment flows, contract review | DPIAs current; DSAR turnaround; no unsigned DPAs |
| **People / HR** | Hire well, keep people, stay compliant | Hiring process, contracts, ESOP admin, policies, EoR management | Time-to-hire; offer acceptance; 12-month retention |

### 4.2 When, where, how, and what it costs

Hire dates are **base / downside**. Each one depends on its trigger, not on the calendar. All bands are **gross annual salary at 100%, before employer charges, [Est.] [Verify against a current salary survey]**. Swiss figures assume Vaud/Geneva. Zurich runs about 5–10% higher.

| Role | Trigger | Base / downside date | Location | Model | Band [Est.] |
|---|---|---|---|---|---|
| Fractional CTO | Founder decision 12 Nov 2026; releases the EUR 50k | **15 Dec 2026 / 31 Jan 2027** | CH or EU-remote, CET ±1 | Fractional contract (equity, if any, proposed by the CTO and shown to the investor) | Day rate at Swiss market [Est.]; Structure A retainer CHF 1.2k / 4k / 7k only if the CTO chooses it |
| Senior reviewer | Cover until the fractional CTO starts, or a second key on payments/RLS | Pre-contracted 16 Dec 2026 | CH/EU | Contractor, CHF 110–150/h | CHF 2–4k/month |
| Customer Success Lead | ≥ 8 live clubs or > 3 concurrent onboardings | Jan 2028 / Jun 2028 (start 50%) | CH (Romandie, FR+DE) | Employee, part-time | CHF 85–105k (at 100%) |
| Ops & finance coordinator | Fiduciary invoices > CHF 1k/month or > 25 clubs billing | Q3 2028 / 2029 | CH | Employee 40–60% or freelance | CHF 75–95k (at 100%) |
| Part-time SDR | Club 25 [Founder] | Q4 2028 / mid-2029 | CH | Employee 50% or student/intern | CHF 60–80k (at 100%) + variable |
| Senior full-stack engineer (first employee) | Seed closed | Q1 2029 search → Q2 2029 start / 2030 | CH (Lausanne) | Employee | CHF 125–155k + options |
| Seasonal support specialist | Peak Jun–Oct with > 25 clubs | Jun 2029 / Jun 2030 | CH, remote | Fixed-term part-time | CHF 65–80k (at 100%) |
| Contract mobile / QA | Native-app decision (2028) or peak-season release risk | 2028–2029, as needed | EU-remote | Contractor | EUR 60–90/h |
| AE Switzerland | Founder close rate holds, > 40 clubs, seed | 2029 / 2030 | CH | Employee | CHF 95–120k base, about 60/40 OTE split |
| AE DACH or FR/BE | EUR gate met (≥ 10 CH clubs, SEPA, OSS, Art. 27 rep [review]) and first EUR club live | 2029 / 2030 | DE/AT or FR/BE | EoR | EUR 60–80k base + variable |
| CSM EU | ≥ 10 EUR clubs | 2030 / 2031 | EU | EoR | EUR 50–65k |
| Head of Product | > 6 engineers, or the founder spending > 30% of time on specs | 2030+ | CH | Employee | CHF 140–170k |
| Product designer | White-label/native build or Stage 2 | 2030 (freelance sprints before that) | CH/EU | Freelance → employee | CHF 100–125k / EUR 55–75k |
| Product engineers (×3), platform (×2), mobile, QA/DevOps | Series A / Stage 2 plan | 2030+ | CH core + EU-remote | Employee (CH) / EoR (EU) | CHF 115–150k / EUR 60–90k |
| Marketing manager | Inbound becomes the bottleneck after AE hire | 2030+ | CH | Employee | CHF 95–120k |
| Partnerships / federations manager | Federation or multi-site pilot signed (H2 2028 / 2029 base) | 2030+ (founder until then) | CH | Employee | CHF 100–130k |
| Legal counsel / DPO | > 150 clubs, or enterprise/federation contracts | Stage 3 (external until then) | CH | Employee or retained | CHF 140–180k |
| Head of People | > 20 employees | Stage 2 late / Stage 3 | CH | Fractional → employee | CHF 120–150k |
| US AE / partner manager | US gate: ≥ 40 clubs, CHF 25k+ MRR, NRR ≥ 100%, seed, paying US design partner + channel [review] | Not before 2030 | US (East Coast) | EoR | USD 90–120k base, about USD 180–220k OTE |
| Security lead | Contract requires SOC 2/ISO (earliest certificate 2029 [03 §1]) | 2031+ (fractional earlier) | CH/EU | Employee | CHF 150–180k |

**Employer cost on top of Swiss gross [Est., Verify with fiduciary]:** about 13–18%. This covers AHV/IV/EO and ALV (employer share about 6.4%), BVG pension (employer at least 50% of contributions, age-dependent), UVG accident insurance, family allowance fund, sickness insurance (KTG, if offered) and the administrative fee. Use **1.17 × gross** for planning. EoR in the EU typically costs employer charges (about 20–45% depending on country) **plus** a provider fee [Verify per country and provider]. In the US, budget health insurance, payroll tax and the EoR fee at about 25–35% on top of base [Est.].

---

## 5. Hiring plan by quarter (base case, tied to milestones)

Club counts and ARR come from the v2 workbook (`01_BUSINESS_MODEL.md` §10.1). **A row only executes if its gate is met.** Otherwise it slides with the gate.

| Quarter | Milestone gate | People action | FTE (excl. agents) | Incremental people cost/yr [Est.] |
|---|---|---|---|---|
| Q4 2026 | Stripe Connect accepted (12 Nov); TWINT on DLang (18 Dec) | **Fractional CTO shortlisted 30 Nov, signed 15 Dec** (releases EUR 50k); reviewer pre-contracted 16 Dec; engage fiduciary and lawyer; IP assigned to SPSA by 31 Dec | 1.0 + CTO (fractional) + contractors | CTO within the engineering line |
| Q1 2027 | CTO structure proposal 8 Jan; convertible 31 Jan; EUR 50k released (Mar in the founder-facts case); first paid signature 31 Jan / 31 Mar | CTO runs the AI agent team; reviewer stays as second key if the CTO wants one; translators for FR/DE/IT; pen-test firm | 1.0 + CTO | Per CTO contract; reviewer 24–48k/yr if kept |
| Q2–Q3 2027 | 3 → 5 founding clubs (May / Jun); EU and US free pilots go/no-go 30 Jun, live Sep–Oct | No hires. Name support hours for the pilots (US time zone) before go. Productise onboarding before club #3 [review §3.5]. DLang staff as "customer success" for the reference account (documented as a related-party arrangement [Verify]) | 1.0 + partner | — |
| Q4 2027 | 10 clubs (Oct; downside Mar 2028); pre-seed (CHF 250–300k incl. EUR 50k) closed in H1 2027 | Open the Customer Success Lead search (job post Oct; Swiss notice 1–3 months) | 1.0 + partner | — |
| Q1 2028 | ≥ 8 live clubs | **CS Lead starts at 50% (Jan)** | 1.5 | ~50k |
| Q2–Q3 2028 | Peak registration season; first EUR club signed Q2 | CS Lead to 80–100% for Jun–Oct; finance coordinator (freelance) | 2.0–2.3 | +40–55k |
| Q4 2028 | 25 clubs (Oct; downside Jun 2029); CHF 10k MRR | Part-time SDR (50%); prepare the seed and the hiring plan | 2.5–2.8 | +35–45k |
| Q1 2029 | **Seed closed** | Search for the first engineer employee (notice period means a Q2 start); AG conversion done; ESOP plan live | 2.8 | — |
| Q2–Q3 2029 | 35–45 clubs | Senior engineer starts; seasonal support (Jun–Oct) | 3.8–4.3 | +170k + 30k |
| Q4 2029 | ~45 clubs, ARR ~CHF 238.5k (v2 workbook); US gate review | Decide on AE CH and EU AE (EoR) for 2030; Stage 1 complete at 5–8 people | 4–5 | — |
| 2030 | EUR track ≥ 10 clubs; Series A prep | Stage 2 build-out (section 3), paced at roughly one hire every 6–8 weeks [Est.] | 8–15 | per plan |

**Downside:** shift every row from Q4 2027 onward by 2–3 quarters. If there are fewer than 10 paying clubs on 31 Mar 2028, the strategy review in `00_EXECUTIVE_PLAN.md` §4.7 runs (the old stop rule was retired on 12 Nov 2026) and **no employee is hired** until its corrective plan is agreed.

**Where the founder's ambition and this plan differ:** the founder's model hires 1 FTE engineer in Y2 at CHF 8.5k/month and 2 FTE by Y3 [Founder model]. CHF 8.5k/month is EU-remote pricing, and the model leaves out employer charges [review §3.3]. A Lausanne hire costs roughly 1.7–2× that. This plan therefore keeps engineering on partner + reviewer + agents until a seed pays for a real salary.

---

## 6. Recruiting process

**Principles:**
- Hire for a written scorecard, not for a CV.
- Every candidate does work that resembles the job, and DLANG pays for it.
- Two people decide, never the founder alone. Before Stage 1 the second voice is the CTO, the reviewer or a trusted advisor.

| Step | What | Owner | Time |
|---|---|---|---|
| 1. Scorecard | Mission, 3–5 outcomes for the first 12 months, competencies, must-haves (languages, Swiss work permit or EU/EFTA eligibility) | Hiring manager | 1 day |
| 2. Sourcing | Founder network, EPFL/HES-SO alumni, Lausanne/Geneva startup communities, Innovaud/GENILEM [Founder BP §9.2], parents of club athletes, jobs.ch / LinkedIn | Founder | 2–6 weeks |
| 3. Screen call | 30 min: motivation, logistics, salary range shared up front | Hiring manager | — |
| 4. Work sample | **Engineering:** a paid take-home of 4–6 h or a paid trial day on a synthetic tenant (an RLS policy plus a migration plus a test), never real data. **CS:** onboard a mock club from a messy CSV and run a 20-min admin training. **Sales:** run a value audit (3× rule) on a sample club. **Ops:** reconcile a month of QR-bill/TWINT payments. | Hiring manager | 1 week |
| 5. Loop | 3 interviews of 45 min: work-sample debrief, values/collaboration, a role-specific deep dive. Structured questions with a 1–4 rating per scorecard line. Notes submitted before any discussion. | Panel of 2–3 | 1 week |
| 6. References | 2 references, including one former manager | Founder | 3 days |
| 7. Decision and offer | Written offer within 48 h: salary, 13th month (if used), equity, start date that respects their notice period | Founder | — |

**Lead times to plan with:**
- Swiss hire: 4–8 weeks of search + **1–3 months' notice** (CO Art. 335c: 1 month in year 1, 2 months in years 2–9, 3 months after that, unless the contract says otherwise [Verify]). That gives **3–5 months from opening to start**.
- EoR hire: 4–8 weeks of search + about 2–4 weeks of EoR setup + local notice.

**Senior hires:**
- Paid trials, as with the CTO's 5-week trial [Founder], are the norm for senior hires before Stage 2.
- Every trial agreement assigns IP to the company from day one [Founder CTO proposal].

**Compliance:**
- Check work authorisation. For non-EU/EFTA hires in Switzerland, quotas and the labour-market test apply [Verify].
- Do not ask about age, family plans or nationality beyond permit eligibility.
- Keep interview data no longer than 3 months after rejection unless the candidate consents (revFADP) [Verify].

---

## 7. Onboarding plan (30 / 60 / 90)

| Window | Everyone | Engineering | Customer Success / Sales |
|---|---|---|---|
| Before day 1 | Contract, IP assignment, confidentiality, laptop, accounts with least privilege, security and privacy training booked | Repo access, no production credentials | CRM and help-desk access |
| Days 1–30 | Meet DLang (attend a training session and a camp day); read the business plan, this doc and SECURITY.md; ship or close something in week 1 | First PR merged in week 1 under the two-key rule; run the RLS test suite locally; shadow an incident review | Shadow 3 onboardings and 5 audits; answer tier-1 tickets with review |
| Days 31–60 | Own one measurable outcome from the scorecard | Own one feature or a migration end to end; on-call shadow | Run 2 onboardings solo; first health-score review |
| Days 61–90 | 90-day review against the scorecard (written, both directions); confirm the end of probation (up to 3 months under Swiss law [Verify]) | On-call primary; propose one tech-debt item from `03` §13 | Own a book of clubs; first renewal or case-study conversation |

**Peak-season rule:** no one starts in CS or support between **15 Jun and 15 Sep** (registration peak). Hire for a start in **Feb–May**.

---

## 8. Compensation and equity philosophy

**Cash:**
- Pay the **50th percentile for the local market** in Stage 1 and 2 [Est.], with bands published internally. Same role, same band, same location factor.
- Swiss contracts state the salary as **12 or 13 payments**. The 13th month is customary but only owed if the contract says so [Verify]. **Recommendation:** express salaries as an annual total paid in 13 instalments, which matches market expectations.
- Variable pay applies only to sales (OTE about 60/40 base/variable) and to the CTO's onboarding-fee share [Founder].

**Equity:**

| Topic | Decision |
|---|---|
| Pool | **10%** after the round [Founder cap table], reserved before the bridge so investors price it in |
| Cap table truth | Investors are told about the CTO's 20% grant before signing. The model's founder 90→81→72% and the CTO proposal's 64.8% must be reconciled into one table by 3 Jan 2027 [review §3] |
| Vehicle (CH) | Convert the **GmbH to an AG before the first employee grant**. GmbH quotas are publicly registered and harder to transfer; the CTO proposal estimates conversion at "a few thousand francs" [Founder] [Verify cost]. Use an employee participation plan (options or restricted shares) with an **advance tax ruling from the Vaud cantonal tax administration** on timing of taxation and valuation [Verify] |
| Vesting | 4 years, 1-year cliff, monthly after that. Good/bad-leaver as in the CTO proposal. Founder reverse-vesting [Founder] |
| Indicative grants [Est.] | CTO 16.2% after round and pool [Founder]. First engineer 0.75–1.5%. CS Lead 0.3–0.6%. AE 0.2–0.4%. Stage 2 managers 0.3–0.8%. Later ICs 0.05–0.25% |
| EU staff via EoR | Options granted by the Swiss AG. Local tax and securities treatment checked per country [Verify] |
| US staff | No US option plan until a US subsidiary exists. US option plans normally need an independent valuation to set strike prices and a choice of option type [Verify with US counsel]. Before that, use cash-settled awards or Swiss-plan options with US tax advice |
| Refresh | Review yearly against performance and dilution. No grants promised by email; every grant goes through the board and is documented [Founder CTO §] |

---

## 9. Core HR policies to set up

**By the first employee (base Jan 2028). Owner: founder + fiduciary + employment lawyer.**

| Area | Swiss baseline [Verify every line with an employment lawyer/fiduciary] |
|---|---|
| Contract | Written individual contract under the Code of Obligations. Probation up to 3 months. Notice per CO Art. 335c, or as agreed in writing. Working time, overtime compensation clause, IP and confidentiality |
| Holidays | Minimum 4 weeks (5 weeks under age 20), plus public holidays of the canton (Vaud). Recommend 5 weeks for all |
| Social insurance | AHV/IV/EO and ALV via a compensation fund; BVG pension above the statutory entry threshold; UVG accident insurance; family allowances; optional collective sickness insurance (KTG). The fiduciary registers the company before the first payroll |
| Pay | 13 instalments; payslips; expense regulation (approved by the cantonal tax office if lump sums are used [Verify]) |
| Working time | Time recording duties apply unless a simplified regime is agreed [Verify]. Weekly maximum 45 h for office staff |
| Data protection | Employee privacy notice (revFADP); monitoring limits; access to personnel files |
| Health and safety | Home-office allowance policy; ergonomic guidance; harassment and anti-discrimination policy with an external confidential contact |
| Contractors | Written contract for every contractor. Check **dependent-employment risk**: the social insurance office decides self-employed status, and a full-time single-client contractor can be reclassified [Verify] |

**EU (from first EoR hire):**
- The EoR handles statutory contracts, but DLANG still owns working-time and right-to-disconnect rules, GDPR for HR data, and equity documentation.
- **Works councils:** in Germany, employees in a unit with 5 or more staff can elect a works council. In France, a CSE is required at 11 or more. In the Netherlands, a works council is required at 50 or more [Verify]. DLANG will stay below these thresholds per country through Stage 2. Plan for consultation before any monitoring tools or reorganisations once a country team grows.
- **Cross-border staff** (for example French residents near Geneva working for a Swiss employer): social-security rules depend on telework share. A CH–EU multilateral framework covers telework below 50% [Verify]. Check this before allowing French residents to work mostly from home.

**US (only after the US gate):**
- At-will employment, but with written offer letters, state-specific pay-transparency and final-pay rules.
- Benefits are expected for market hires: health insurance, 401(k) via the EoR.
- Paid leave per state law.
- Background checks if staff will access minors' data in school/district deals [Verify].

**Child-safeguarding (all markets):** staff with access to production personal data of minors sign a safeguarding and data-handling undertaking. Access is logged and reviewed quarterly. A Swiss criminal record extract (including the special extract for work with minors) is required for anyone who attends club sessions on site [Verify].

---

## 10. Remote work and culture

**Work model:**
- **Lausanne-anchored, remote-first.** Core collaboration hours are 9:00–15:00 CET.
- One in-person day every two weeks in Stage 1, with a quarterly offsite.
- Customers are reached in person during the season. CS and sales attend club events.
- **Written by default.** Decisions go in the repo or the docs folder. Weekly 30-min pilot review [02 §7.4]. Monthly KPI pack [02 §9].
- **Languages.** Internal work is in English. Customer-facing staff need French, and German by Stage 2. Italian is covered by contractors.
- **AI agents are tools, not teammates with authority.** They hold no production credentials, and humans approve every merge to payments, RLS, auth or migrations [03 §12]. The same rule binds every new engineer.

**Values (to be tested with the first hires, not imposed):**

| Value | What it looks like here |
|---|---|
| **The club's money and the child's data come first** | No payment or RLS change ships without a second key. Report incidents in under an hour, without blame |
| **Season-aware** | We ship before camps and registration peaks, never during them. Nobody is a hero in July |
| **Truth over optimism** | Gates, stop rules and downside dates are said out loud (this document included) |
| **Customer zero is real** | Everyone uses DLang's live operation as the test of "done" |
| **Small team, high trust** | Owners, not tickets. Write it down. Pay contractors on time |

---

## 11. RACI for launch-critical activities (Nov 2026 → Gate 3b)

**Roles:**
- **F** = Founder/CEO
- **C** = CTO partner (or senior reviewer in the fallback)
- **E** = contract engineers + AI agents (agents are never A)
- **D** = DLang staff (customer zero)
- **Fi** = fiduciary
- **L** = lawyer / external DPO
- **CS** = CS Lead (from 2028)

R = responsible, A = accountable, C = consulted, I = informed.

| Activity (deadline) | F | C | E | D | Fi | L | CS |
|---|---|---|---|---|---|---|---|
| Payment architecture + legal view on fund-holding (27 Nov 2026) | A | R | C | I | C | R | — |
| IP assignment to SPSA GmbH; any CTO equity disclosed (31 Dec 2026) | A/R | C | — | — | R | R | — |
| TWINT live and reconciling on DLang (18 Dec / 31 Jan) | A | R | R | C | I | — | — |
| Fractional CTO signed (15 Dec 2026); reviewer pre-contracted (16 Dec); CTO structure proposal (8 Jan 2027) | A/R | C | — | — | C | C | — |
| Compliance pack: DPA, privacy notice, record of processing (15 Jan 2027) | A | C | C | I | — | R | — |
| External security review (booked 4 Dec, done 31 Jan) | A | R | C | — | I | C | — |
| Convertible signed (31 Jan 2027) | A/R | I | — | — | C | R | — |
| CSV import, FR/DE/IT, offline attendance (28 Feb 2027) | A | R | R | C | — | — | — |
| Gate 3: DLang full cycle (14 Feb 2027) | A | C | C | R | I | — | — |
| Value audits and founding-club sales (10 audits by 31 Jan; 5 clubs by Jun 2027) | A/R | I | — | C | — | C (contract) | — |
| Club onboarding and data import | A | C | R (tooling) | C | — | — | R (from 2028) |
| VAT registration and billing setup (when turnover requires it [Verify threshold]) | A | — | — | — | R | C | — |
| First payroll and social-insurance registration (before first employee) | A | — | — | — | R | C | I |
| Incident response (security or payment) | A | R | R | I | I | C (notification duty) | I |

---

## 12. Items needing professional validation

| Item | Who |
|---|---|
| Salary bands, employer charge rate, BVG plan choice | Fiduciary + current salary survey |
| Contract templates, probation and notice, contractor classification, IP assignment | Swiss employment lawyer |
| GmbH→AG conversion cost and timing; employee participation plan; cantonal tax ruling | Corporate lawyer + tax adviser |
| Fractional CTO contract: IP assignment, decision rights, disguised-employment risk, any equity and its disclosure to the investor | Lawyer + tax adviser |
| Software business and academy in one GmbH (SPSA): carve-out, intercompany agreement | Lawyer + fiduciary |
| Cross-border telework (FR/CH) social-security treatment | Fiduciary / social insurance office |
| EoR provider choice and per-country cost; EU works-council thresholds | EoR provider + local counsel |
| US option plan, benefits, background checks | US counsel (only once the US gate opens) |
| Safeguarding checks for staff with access to minors' data | Lawyer + DPO |

---

## 13. Changes vs. founder's August 2026 plan

| Topic | Founder plan | Updated (11 Nov 2026; rows marked 12 Nov reflect the founder's decisions) | Why |
|---|---|---|---|
| Hiring principle | Founder hands roles over in order (engineering → onboarding → support → sales) | **Kept.** Made explicit as stage gates tied to club counts | The sequencing is right; only the dates were optimistic |
| CTO partner | Structure A; co-founder by end of Month 4 (Dec 2026), else contractor model | **12 Nov:** named human fractional CTO + AI agent team; signed 15 Dec 2026 (latest 31 Jan 2027); CTO sets structure by 8 Jan; reviewer covers until then | An AI agent cannot be accountable; the EUR 50k is released only once a CTO is in place |
| Engineering cost | CHF 4,500/month for ~24 h/week (Y1); 1 FTE at CHF 8.5k/month (Y2); 2 FTE (Y3) | Partner + reviewer + agents through 2028; first engineer employee **Q2 2029** at CHF 125–155k + ~17% charges | CHF 43/h is far below Swiss contractor rates (CHF 110–150/h); CHF 8.5k/month is EU-remote pricing; employer charges not modelled |
| Customer success | Part-time at club 10, about Month 12 (Sep 2027) | CS Lead at 50% from **Jan 2028** (downside Jun 2028); onboarding productised before club #3 | Clubs arrive later (10 clubs Oct 2027 base); onboarding breaks the founder at about 5 concurrent clubs, not 25 |
| First-line support | Club 15, same person | Same person, plus **seasonal** support Jun–Oct from 2029 | Registration peaks Jun–Sep concentrate parent tickets |
| Sales | Part-time SDR at club 25, Year 2 | SDR at club 25 → **Q4 2028** base; first AE CH not before 2029/2030 | Club 25 re-baselined to Oct 2028; the founder remains the closer [Founder] |
| EU / US staffing | Implied by "worldwide" deck framing | EU AE via EoR only after the EUR gate (2029/2030); US hire **not before 2030**, behind the US gate | Capacity and capital too small; the Swiss wedge does not carry to the US |
| Org size | Not specified beyond Year 3 | Stage 1 5–8 people (2027–29); Stage 2 15–25 (2030+, seed/Series A); Stage 3 40+ (2032+, undated) | Base ARR CHF 264k at end-2029 cannot fund more |
| Employer social charges | Not modelled | Plan at ~1.17 × Swiss gross [Verify] | Mandatory AHV/ALV/BVG/UVG/FAK |
| Equity / cap table | Founder 90→81→72% (model) vs. 64.8% (CTO proposal); 10% pool | **12 Nov:** one working cap table now, refined with the CTO and advisors; 10% pool kept; investor told about any CTO equity; AG before employee grants | The two tables disagree; investors will diligence it |
| Founder pay (12 Nov) | 2.5k / 6k / 8.5k | Lean-cost variant accepted: Y2/Y3 founder 3.5k/5k, engineering 6k/8k | Founder decision 8 |
| Entity (12 Nov) | GmbH to be formed | SPSA GmbH is the employer; carve-out view by 15 Dec 2026 | Founder decision 1 |
| Pilot staffing (12 Nov) | — | No hires for the EU/US free pilots; support hours named before go/no-go (30 Jun 2027) | Capacity |
| Stop rule (12 Nov) | — | Strategy review triggers; no employee hired until a review's plan is agreed | Founder's commitment to keep going |
| Vesting | 4 years, 1-year cliff, founder reverse-vesting | **Kept**, applied to every grant | Sound and market-standard |
| Fiduciary | CHF 250–400/month on incorporation | **Kept**; also runs payroll and social-insurance registration before the first hire | Sound; scope widened |
| Policies, recruiting, onboarding | Not covered | Scorecards, paid work samples, 30/60/90, Swiss/EU/US policy baselines, safeguarding | Required before the first employee in a children's-data business |
