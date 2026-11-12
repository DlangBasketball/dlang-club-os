# CHANGELOG — DLANG Sports OS business pack

## 2026-11-12 — 12 Nov 2026 founder decisions

**Why.** On 12 November 2026 the founder answered the 14 "Decisions the founder must confirm" listed in the 11 Nov entry below and added one more (the AI assistant). The full decision log, with remaining risks and follow-up dates, is `docs/company/11_FOUNDER_DECISIONS_2026-11-12.md`. Originals in `docs/company/source/` were not changed. No code was changed.

### Files changed

| File | What changed |
|---|---|
| `docs/company/11_FOUNDER_DECISIONS_2026-11-12.md` | **New.** Decision log (question / answer / what changed / remaining risk / follow-up date), figures of record (workbook base, 12 Nov founder-facts case, plan of record) and dates of record |
| `docs/company/00_EXECUTIVE_PLAN.md` | New §0 summary; roadmap, gates, OKRs, risks (two added), decision log D3–D18, first-30-days list and changes table updated; new §4.6 (free EU/US pilots) and §4.7 (strategy review triggers) |
| `docs/company/01_BUSINESS_MODEL.md` | §10 now shows the v2 workbook (three cases); the calendar-year sketch marked superseded; AI included in the Club tier; pilots; capital plan; stop rule replaced; changes table |
| `docs/company/02_GO_TO_MARKET.md` | Free EU (§5.5) and US (§6.5) design-partner pilots; sequencing table; founding/pilot policy; W1–W2; validation list; changes table |
| `docs/company/04_ORG_DESIGN_AND_HR.md` | Fractional CTO + AI agent team; SPSA as employer; lean founder pay; workbook club counts; hiring plan; RACI; changes table |
| `docs/company/05_LEGAL_CORPORATE_STRUCTURE.md` | SPSA GmbH (new D1b: academy and software in one entity); FIT eligibility; Stripe Connect accepted; pilots' legal needs (Art. 27, COPPA); naming note; funding papers; checklist; budget; changes table |
| `docs/company/07_BRAND_AND_MARKETING.md` | "Global Sport OS" candidate, naming note and CH/EU/US check by 15 Jan 2027; club-level names; AI claim rule; pilot case studies; changes table |
| `docs/company/09_FOUNDER_PLAN_REVIEW.md` | Status rows answered; §5.4 milestones aligned to the workbook and pilots; actions 5, 6, 13, 14; question notes; new §8 summary of answers |
| `updated/DLANG_Sports_OS_Business_Plan_v2.md` + `.docx` | New decisions section in 00; sections 01, 02, 05, 06.4, 07.4, 09, 10, 11, 12, 13 and Appendix B updated |
| `updated/DLANG_Sports_OS_Rollout_v2.md` + `.docx` | Status box and top cash actions; weeks 1–13; stop rules; quarterly roadmap; week 1 checklist |
| `updated/README.md` | Index and "where documents disagree" note updated |

### The decisions, in one line each

| # | Topic | Founder answer | Main change |
|---|---|---|---|
| 1 | Entity | Swiss Preparatory Sports Academy GmbH (SPSA); account "SPSA Tech" [Confirm register no./date] | Treated as incorporated; new risk: academy and software in one entity; carve-out view by 15 Dec 2026 |
| 2 | FIT Digital | Not filed; prepare it | 0% until filed and awarded; eligibility may be blocked by the ≤6-months-since-register-entry rule |
| 3 | CTO | None; can an AI agent be CTO? | AI agents engineer; a named human fractional CTO is needed (`12_CTO_SOLUTION_AI_PLUS_HUMAN.md`); signed by 15 Dec 2026 |
| 4 | Payment rail | Stripe Connect; DLang connects | Closed; setup guide `docs/ops/STRIPE_CONNECT_TWINT_SETUP.md` |
| 5 | >>venture>> | Submit by 30 Nov 2026 | Committed; draft in `applications/venture-2027/` |
| 6 | Funding | EUR 50k secured, released once a CTO is in place; one cap table for now | CTO on the critical path for cash; Jan–Mar 2027 bridge ~CHF 45k |
| 7 | CTO structure | Defer to the CTO; fractional CTO + AI team | Structure A no longer the default; CTO proposes by 8 Jan 2027 |
| 8 | Founder pay | Lean-cost variant | Plan of record |
| 9 | Claim | "Cheapest payment rail" | "Cheaper than Spond" retired |
| 10 | Pilots | No free pilots in CH; one free US and one free EU design partner | Pilot policy rewritten |
| 11 | Markets | EU and US presence in 2027 | Free EU pilot live Sep 2027 / Jan 2028; free US pilot Sep–Oct 2027 / Mar 2028; paid EU early 2028 on a strong pilot; paid US unchanged (H2 2029+) |
| 12 | AI assistant | Available once fully functional | Opt-in per club; DLang beta Q1 2027; included in Club tier [Confirm] |
| 13 | Name | "Global Sport OS" candidate; clubs use own names (e.g. "DLang OS") | CH/EU/US trademark and domain check by 15 Jan 2027 with 2–3 alternatives; DLANG Sports OS stays the working name |
| 14 | Official dates | The v2 workbook | 00/01/09 aligned; "Known inconsistencies" closed (below) |
| 15 | Kill criterion | No kill switch | Strategy review triggers (`00` §4.7) |

### Figures of record (v2 workbook)

| | Workbook base | 12 Nov founder-facts case (FIT 0%, EUR 50k cash Mar 2027) | Plan of record (+ lean cost, AI in Club tier) |
|---|---|---|---|
| Cash negative for good | Apr 2027 | **Jan 2027** (about –43.5k in Feb 2027) | Jan 2027 |
| Unfunded shortfall Nov-27 / 28 / 29 | 72k / 254k / 441k | 82k / 264k / 451k | 82k / 214k / 330k |
| First EBITDA-positive month | about Q4 2030 | about Q4 2030 | about mid-2030 |

Upside Aug 2029; downside 2032 or later. Top cash actions: **sign the fractional CTO (15 Dec 2026) and bridge January–March 2027 (about CHF 45k)**; pre-seed about CHF 250–300k in total, including the EUR 50k, in H1 2027; seed CHF 400–500k in Q1 2029.

### Remaining inconsistencies and open items

1. **The workbook file still opens on its 11 Nov defaults** (FIT 50%, round Feb 2027, non-lean costs, AI add-on revenue from Year 3). The founder-facts and plan-of-record figures were recalculated on copies. Switch the defaults at the 3 Jan 2027 refresh (`Assumptions!D61`, `C61`, `C42:D45`, `B26`).
2. **Not in the workbook:** the 2027 EU/US pilots (about CHF 15–30k [Est.]) and any fractional-CTO cost above the engineering line.
3. **Not updated in this pass** (owned elsewhere or out of scope): `03_CTO_TECHNOLOGY_STRATEGY.md`, `06_CUSTOMER_SUCCESS_AND_SUPPORT.md`, `08_AI_AGENT_TEAM.md` and `10_FINANCIAL_MODEL_V2_NOTES.md` may still say the AI assistant is "not sold before 2028", that the CTO decision is Structure A vs reviewer on 8 Jan, or that 09 shows Q2 2029 break-even. Read them with the 12 Nov decisions.
4. **First paying club:** the rollout targets a signature on 31 Jan 2027; the workbook books first revenue in Feb 2027 (sign January, pay February). Consistent, noted for clarity.

---

## 2026-11-11 — Updated business pack (v2)

**Why this update exists.** The founder's August 2026 materials (business plan, 90-day rollout 24 Aug – 22 Nov 2026, financial model, CTO proposal, executive dashboard, investor deck) were written before the rollout ran. On 11 November 2026 the rollout ends in eleven days, Gate 2 (a real TWINT payment reconciling automatically) is very probably not met (the code records TWINT only as a label on manual payments and has no per-club payment accounts), and the other gates are unconfirmed. Every timeline has been **re-baselined from Monday 16 November 2026** and shown as **base / downside**. The originals in `docs/company/source/` were **not changed**. All revisions are new files.

Labels used across the pack: [Founder] taken from the founder's materials · [Est.] estimate · [Confirm] only the founder knows · [Verify] needs a lawyer, fiduciary or tax adviser.

---

### Files added or changed

| File | Status | Replaces / relates to | What it is |
|---|---|---|---|
| `docs/company/updated/DLANG_Sports_OS_Business_Plan_v2.md` + `.docx` | New | `source/DLANG_Sports_OS_Business_Plan.docx` (18 Aug 2026) | Updated business plan, same section structure 00–13 + appendices, changed sections marked [Updated Nov 2026] |
| `docs/company/updated/DLANG_Sports_OS_Rollout_v2.md` + `.docx` | New | `source/DLANG_Sports_OS_90_Day_Rollout.docx` | 13 weeks from 16 Nov 2026 to 14 Feb 2027 with gates and stop rules, then a 12-month quarterly roadmap to Feb 2028 |
| `docs/company/updated/DLANG_Sports_OS_Financial_Model_v2.xlsx` | New | `source/DLANG_Sports_OS_Financial_Model.xlsx` | Copy of the founder's model, re-based to Dec 2026, with Changes_v2 (93 logged cell changes) and Timeline_v2 (25 milestones) sheets |
| `docs/company/updated/CHANGELOG.md` | New | — | This file |
| `docs/company/updated/README.md` | New | — | Index and reading order for the updated pack |
| `docs/company/00_EXECUTIVE_PLAN.md` | New | Founder plan §01, §13; executive dashboard | Operating plan: roadmap, launch gates, OKRs, risks, decision log, first 30 days |
| `docs/company/01_BUSINESS_MODEL.md` | New | Founder plan §05.3, §11 | Segments, pricing, take-rate, unit economics, 3-year model by calendar year |
| `docs/company/02_GO_TO_MARKET.md` | New | Founder plan §07 | Swiss sales motion and calendar, EUR track, US gate, pilots, partners |
| `docs/company/03_CTO_TECHNOLOGY_STRATEGY.md` | New | Founder plan §06 | Architecture, payments, security, delivery, tech-debt register |
| `docs/company/04_ORG_DESIGN_AND_HR.md` | New | Founder plan §09; CTO proposal | Org stages, hiring plan, CTO decision, Swiss employment, equity |
| `docs/company/05_LEGAL_CORPORATE_STRUCTURE.md` | New | Founder plan §10 | GmbH, IP, payments/AML, VAT, contracts, insurance, dated checklist |
| `docs/company/06_CUSTOMER_SUCCESS_AND_SUPPORT.md` | New | Founder plan §08 | Onboarding tracks, SLAs, health score, help centre, migration playbook |
| `docs/company/07_BRAND_AND_MARKETING.md` | New | Founder positioning; investor deck | Brand layers, naming, claims policy, launch calendar, budget |
| `docs/company/08_AI_AGENT_TEAM.md` | New | — | The AI agent team, roster, governance and example prompts |
| `docs/company/09_FOUNDER_PLAN_REVIEW.md` | New | All founder materials | Line-by-line review; source of the re-baselined dates |
| `docs/company/10_FINANCIAL_MODEL_V2_NOTES.md` | New | Founder model | What changed in the v2 workbook and how to use it |
| `CLAUDE.md` (repo root) | New | — | Project guide for engineers and agents: business context, architecture, multi-tenant, i18n, theming, minors' data rules |
| `.claude/agents/*.md` (17 files) | New | — | Agent definitions: cto-architect, product-manager, frontend-engineer, backend-db-engineer, payments-engineer, security-reviewer, privacy-compliance-officer, qa-test-engineer, devops-sre, i18n-localization, ux-designer, customer-success, gtm-strategist, hr-people-partner, finance-analyst, legal-counsel-assistant, tenant-onboarding-specialist |

No application code, migrations or files in `docs/company/source/` were modified by this update.

---

### Changes by area

#### Strategy
- **Sequencing made explicit and gated.** DLang is customer zero (live on one full cycle Feb / Mar 2027; whole club Sep / Oct 2027) → Swiss programme-revenue organisations, Romandie first → schools H2 2027 → federation or multi-site pilot H2 2028 → EUR track (signed Q2 2028, live Sep 2028 at the earliest) → US exploration not before H2 2029 → broad white-label resale 2029 at the earliest. *Why:* the Swiss wedge (TWINT, QR-bill, Romandie network) does not travel to the US; US incumbents are consolidating; founder capacity and capital are too small for three markets. The deck's "worldwide, every team sport" is a ten-year destination, not a 2027 launch.
- **Two products, one codebase** stated: DLang's own operating system, and the white-label SaaS. No per-customer forks.
- **"Money must move first"** added as a top-level conclusion; payment work is the only engineering priority until Gate 2.
- **Positioning:** languages corrected to FR / DE / EN (IT later) because no translation layer exists yet; lead message is the programme-to-payment chain; no TWINT claim until Gate 2.
- **Brand layers:** company, platform and club brands separated; DLang becomes tenant #1 theme; trademark clearance needed because "DLang" collides with the D programming language.

#### Pricing
- **Kept:** CHF 149 + 1.90/athlete (EUR 149 + 2.00); tiers 290 / 490 / 890 / 1,690 (EUR 279 / 469 / 849 / 1,590); onboarding fees 750 / 1,500 / 2,900; 5 founding clubs at CHF 290 for life, 24 months founder access, 60-day refund, month-to-month.
- **Changed:** headline claim from "cheaper than Spond on total cost" to "cheapest payment rail". *Why:* the founder's own table shows DLANG CHF 6,573/yr vs Spond 1,755/yr; DLANG wins only on the payment line (693 vs 1,575).
- **Changed:** payment take-rate from 0.9% net on 50% of collections to ~0.2% net on 40%. *Why:* 0.9% assumed Payrexx (~1.3%); the code uses Stripe, where TWINT is ~1.9% + CHF 0.30.
- **Added:** founding "lifetime" price capped at the signed tier; founding slots close 30 Sep 2027; no free pilots, up to 5 paid design pilots at list price; Gate 1 fallback price card (low subscription + fee on programme/camp value) ready 15 Dec 2026.
- **Added:** add-ons (custom domain, SMS at cost, AI CHF 90 add-on — superseded 12 Nov 2026: opt-in, included in the Club tier — white-label native app 2029+); indicative USD 299/499/899 not published.

#### Financials
- Model re-based: month 1 = Dec 2026 (to Nov 2029); Year 1 = Dec 2026 – Nov 2027.
- Base signings 138 → 57 over three years (11 / 19 / 27), none in December or July. Churn 1.5% → 1.8% (bull 1.2%, bear 2.5%). Founding clubs held at CHF 290 in every year (fixes an error in the August model). AI revenue from Year 3 at 15% attach. Onboarding fee average 900 → 750. Support cost 55 → 65 per club per month.
- Costs added: employer social charges (~15%), dated hires, one-offs (CTO trial 10k, security review 10k, company setup 3k, compliance pack 2.5k, EU entry 6k, second pen test 10k).
- **Base outputs (Y1/Y2/Y3):** clubs 10 / 26 / 45; ARR CHF 39.6k / 117.1k / 238.5k (Aug: 51.9k / 254.3k / 669.5k); EBITDA –143.5k / –182.3k / –186.5k. Downside ARR 19.8k / 63.9k / 136.4k (6 / 15 / 27 clubs).
- **Unit economics:** LTV/CAC 13× → 4.5×; payback 3.7 → 10.6 months; gross margin 83% → 80%. No LTV/CAC quoted externally before 10 clubs.
- **Cash:** on today's stack (~CHF 71.5k modelled) cash dips to –17.5k in Jan 2027 and is negative for good from **Apr 2027** (downside Jan 2027). Need incl. buffer ~110k to Nov 2027, ~300k to Nov 2028, ~490k to Nov 2029.
- **Break-even:** base not within the 36-month horizon (~Q4 2030 at ~75–80 clubs); lean-cost ~mid-2030; upside Aug 2029; downside 2032+. (Aug: first profitable month Jul 2028.)
- **Funding:** FIT grant counted at 50% base / 0% downside; convertible signed 31 Jan 2027, upsized to CHF 150–200k recommended; seed CHF 400–500k Q1 2029; >>venture>> by 30 Nov 2026.

#### Timeline
| Milestone | August plan | v2 base / downside |
|---|---|---|
| Gate 2 (TWINT reconciles) | 18 Oct 2026, red line 31 Dec | 18 Dec 2026 / 31 Jan 2027 (red line 31 Dec kept, manual fallback) |
| Gate 1 (willingness to pay) | 20 Sep 2026 | 31 Jan 2027 / 15 Mar 2027 |
| First paid signature | by 30 Nov 2026 | 31 Jan 2027 / 31 Mar 2027 |
| Gate 3 | Club #1 weekly by 22 Nov 2026 | DLang full cycle 14 Feb / 31 Mar 2027; club #1 weekly 30 Apr / 30 Jun 2027 |
| 5 founding clubs | 31 Jan 2027 | Jun 2027 / Sep 2027 |
| 10 paying clubs | ~mid-2027 | Oct 2027 / Mar 2028 |
| ~25 clubs | Month 20 (~Apr 2028) | Oct 2028 / Jun 2029 |
| CHF 10k MRR | — | Dec 2028 / Q3 2029 |
| EUR track | Year 2 | Signed Q2 2028, live Sep 2028 / 2029 |
| Federation | Year 2 bet | Pilot H2 2028 / 2029 |
| US / broad resale | Deck: worldwide | Not before H2 2029 / 2029 at the earliest, gated |

- New 13-week rollout (16 Nov 2026 – 14 Feb 2027) with two planned holiday weeks (21 Dec – 3 Jan), and a 12-month quarterly roadmap following the Swiss club calendar (committees Jan–Apr, set-up by 31 May, no migrations Jun–Sep).

#### Go to market
- Sales cycle 21 days → 45–90 days; 31 founder hours per club (model had 22); at most 2 concurrent onboardings.
- Funnel check: ~37 qualified audits needed in Year 1 for 11 signings (rollout had planned 10).
- Audit order: private academies and camp operators first, international schools third.
- Referral switched on after 2 measured case studies (Q3 2027). Gated partner programme (referral → implementation partner → reseller → federation). Federations are relationships only until an H2 2028 pilot.
- Public launch "Season 2027/28 ready" Apr–May 2027; DLang case study 31 Mar 2027; no paid ads before a seed; no EU marketing before ≥10 Swiss clubs; no US pages before H2 2029.

#### Team / HR
- Engineering re-costed: CHF 4,500/month for ~24 h/week was ~CHF 43/h vs Swiss CHF 110–150/h; the Y2 CHF 8.5k "FTE" was EU-remote pricing.
- CTO decision due **8 Jan 2027**: Structure A if the 5-week trial delivers TWINT reconciliation (start Mar 2027), otherwise founder + AI agents + paid senior reviewer (4–8 h/week) from Feb 2027. Reviewer pre-contracted by 16 Dec.
- Part-time customer success Jan 2028 / Jun 2028 (recruit from Sep 2027 for Swiss notice periods); SDR at ~club 25; first salaried engineer Q1 2029 after a seed.
- Employer charges (~15–17%), CO Art. 335c notice periods, no CS start 15 Jun – 15 Sep, no EU hire before the EUR gate, no US hire before 2030.

#### CTO / technology
- Payment architecture: **Stripe Connect, one account per club, direct charges + application fee**; QR-bill free default; Payrexx fallback; decision 27 Nov 2026.
- Four missing beta items due 28 Feb 2027: CSV import, FR/EN translation layer, offline attendance, per-club payment accounts. Multi-club membership and cross-tenant tests in CI before club #2.
- AI assistant switched off by default per tenant; DPIA and data allow-list required. *(Superseded 12 Nov 2026: opt-in per club, DLang beta Q1 2027.)*
- PWA through 2027; native decision Q1 2028.
- Delivery: CI gates, per-tenant flags, forward-only migrations, weekly release, freezes over holidays/camp weeks/late August; human approval on every merge, second approver for payments/RLS/auth/migrations/AI.
- Security: external review booked 4 Dec, done 31 Jan 2027; ISO 27001-aligned controls in 2027, no certification before a contract needs it.
- Repo gaps logged: no CI workflow; TWINT a label only; `wf/tenancy` and `wf/platform` branches not merged.

#### Legal
- One GmbH in Vaud, register entry by 31 Dec 2026 / 31 Jan 2027; AG conversion before first employee grant or seed; Delaware subsidiary only at the US gate.
- IP present assignment (founder, SIDIS, contractors) by 31 Dec 2026, before the convertible; trademark clearance 15 Jan, CH filing 28 Feb 2027.
- Written fund-holding / AML view by 27 Nov 2026 (single Stripe account would mean DLANG holds club money).
- Contract set and compliance pack by 15 Jan 2027; insurance by 31 Jan 2027; legal budget ~CHF 20–45k year one [Est.].
- VAT: CHF 100k threshold now likely late 2028; voluntary registration decision by 31 Mar 2027. EU OSS / Art. 27 representative only at the EUR gate.
- Two cap tables (founder 90/81/72% vs 64.8% under the CTO proposal) to be reconciled by 3 Jan 2027 and shown to the investor.

#### Product scope
- Canonical 12-feature beta kept; status per feature added. Out of beta unchanged (native, AI, video, tournaments, federation management, API, website builder, etc.).
- Onboarding: assisted only in 2027; self-serve Q1 2028; enterprise with the federation pilot. Onboarding kit built Feb–May 2027 (before club #3, not club #6).
- Support SLAs restated in Swiss business hours; no "24/7"; P1 holiday cover; help centre wave 1 by 31 Mar 2027.

#### Investor deck (not edited; fixes listed for the founder)
- Remove "cheaper than Spond on total cost"; qualify or remove "€6,160 MVP"; replace "worldwide, every team sport" with Swiss-first + gates; mark premium modules as roadmap; relabel 10 / 50 / 150 clubs and EUR 54k / 269k / 808k ARR as a target (odds on its timeline <15% [Est.]); show one cap table including the CTO grant; state that IP is assigned to the company. Due 4 Dec 2026.

---

### Reconciliation of 11 Nov differences (resolved 12 Nov 2026)

The founder made the v2 workbook the only source for break-even and bridge dates. Break-even (00, 01, 09 now say about Q4 2030 on default costs, about mid-2030 on the lean plan of record, Aug 2029 upside, 2032+ downside), bridge timing (00, 01, 09 now follow the workbook and the founder-facts case) and the 3-year figures (01 now reports the workbook's Dec–Nov years; its calendar-year sketch is marked superseded) are aligned. The note on the first paying club is carried in the 12 Nov entry above.

---

### Decisions the founder had to confirm (all answered on 12 Nov 2026 — see the entry above and `docs/company/11_FOUNDER_DECISIONS_2026-11-12.md`)

1. **Status facts (by 20 Nov 2026):** → *Answered: SPSA GmbH; FIT not filed; EUR 50k on CTO release; no CTO yet. Still open: audits, cash.* Original questions: GmbH incorporated? FIT Digital filed by 10 Nov? Round status and investor? Number of audits done and results? CTO trial running and its deliverable? Actual cash at 30 Nov 2026?
2. **Payment rail (27 Nov):** Stripe Connect per club with direct charges + application fee (recommended) vs Payrexx per club; engage a lawyer for the fund-holding / AML view.
3. **>>venture>> submission by 30 Nov 2026:** yes / no.
4. **Round size and instrument (3 Jan 2027):** keep EUR 50k, or upsize the January convertible to CHF 150–200k; post-money cap wording.
5. **One cap table (3 Jan 2027):** including the CTO's Structure A grant if offered; disclosure to the investor.
6. **CTO decision (8 Jan 2027):** Structure A (start Mar 2027) vs reviewer + contractor + AI-agent model (from Feb 2027).
7. **Founder pay and lean-cost discipline:** accept the lean-cost variant (founder pay and engineering capped until ~30 clubs)?
8. **Headline claim:** adopt "cheapest payment rail" and retire "cheaper than Spond on total cost" across all assets by 4 Dec 2026.
9. **Founding offer details:** cap the lifetime price at the signed tier; close slots 30 Sep 2027; no free pilots.
10. **Market gates:** confirm the EUR, US and white-label resale entry gates and dates (EUR Q2 2028 earliest; US not before H2 2029; resale 2029 earliest).
11. **AI:** keep the assistant switched off by default and unsold until 2028. → *Answered: opt-in per club, DLang beta Q1 2027, included in the Club tier [Confirm].*
12. **Name:** keep "DLANG Sports OS" for 2027 pending trademark clearance (15 Jan) and naming decision (15 Feb 2027).
13. **Which break-even and bridge dates are official**; once chosen, update 00 / 01 / 09 to match. → *Answered: the v2 workbook; done.*
14. **Kill criterion:** fewer than 8 paying clubs by 31 Mar 2028 triggers a lifestyle-or-stop decision. → *Answered: no kill switch; strategy review triggers instead.*
