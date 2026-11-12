# 11 — Founder Decisions, 12 November 2026

**Recorded:** 12 November 2026
**Answers to:** the 14 "Decisions the founder must confirm" in `updated/CHANGELOG.md` (11 Nov 2026) and the status questions in `09_FOUNDER_PLAN_REVIEW.md` §7, plus one new item (the AI assistant).
**Applied to:** `00`, `01`, `02`, `04`, `05`, `07`, `09`, and in `updated/` the Business Plan v2, Rollout v2, CHANGELOG and README. The founder's originals in `source/` are unchanged.

**Labels:** [Founder] = the founder's answer · [Est.] = estimate · [Confirm] = only the founder knows · [Verify] = needs a lawyer, fiduciary, tax adviser or the provider. Amounts in CHF unless marked EUR. Dates are **base / downside**.

---

## 1. Decision log

| # | Question | Founder answer (12 Nov 2026) | What we changed | Remaining risk | Follow-up date |
|---|---|---|---|---|---|
| 1 | Is the company incorporated? | Yes. The GmbH is **Swiss Preparatory Sports Academy GmbH (SPSA)**. The bank account for the software business is "SPSA Tech". Treated as incorporated. [Confirm register number (CHE-…) and register date] | "GmbH status unknown" removed everywhere. The 31 Dec 2026 deadline becomes "IP present assignment to SPSA and related documents", not formation. Stripe platform account and contracts go in SPSA's name. | **The software business and the academy (customer zero, minors' data, its own liabilities) sit in one legal entity.** Investors would buy into the academy too; other clubs would contract with a rival club's company; Stripe may not accept SPSA as both the platform and a connected account [Verify]. The register date also decides FIT eligibility: FIT Digital's Grant is described as open only to companies entered in the register no more than 6 months ago (12 months for the Seed loan), so an older SPSA may be **ineligible** [Verify on fondation-fit.ch; see `applications/fit-digital/FILING_STEPS.md`]. Options: keep SPSA with ring-fenced "SPSA Tech" accounts and an internal agreement now, and carve out a dedicated tech GmbH (or subsidiary) before the seed, or before the convertible if the investor or lawyer asks [Verify with lawyer and fiduciary]. | Register details and purpose clause: **20 Nov 2026**. Carve-out view from lawyer/fiduciary: **15 Dec 2026** |
| 2 | Was FIT Digital filed by 10 Nov 2026? | No. The founder asked us to prepare it. Draft pack: `docs/company/applications/fit-digital/` | FIT is modelled at **0%** until it is filed **and** awarded (all scenarios). Every "if filed" / "committee 1 Dec" reference removed. | The 10 Nov 2026 intake is missed; the next intake date is unknown [Verify with FIT/Innovaud]. **Eligibility may be blocked** by the ≤6-months-since-register-entry rule (Grant; ≤12 months for the Seed loan) if SPSA is older, and by the software activity sitting in an academy company [Verify; `applications/fit-digital/FILING_STEPS.md`]. If so, FIT only works through a new, carved-out GmbH. FIT at 0% raises each year-end shortfall by about CHF 10k. | Next intake date and eligibility check: **27 Nov 2026** |
| 3 | Is there a CTO? | No CTO confirmed. Founder asked whether an AI agent could be the CTO. | Answer recorded: **AI agents do the engineering, but a named human fractional CTO is needed** (accountable for architecture, security sign-off, payment and RLS approvals, investor and customer due diligence). See `12_CTO_SOLUTION_AI_PLUS_HUMAN.md`. Target **signed by 15 Dec 2026** / latest 31 Jan 2027. The paid senior reviewer (4–8 h/week) stays as the bridge until the CTO starts. | The CTO is now on the **critical path for cash** (decision 6). A short search over the December holidays may slip; a fractional CTO at Swiss rates costs more per hour than the August retainer assumed [Est.]. | Shortlist **30 Nov 2026**; signed **15 Dec 2026** (latest 31 Jan 2027); reviewer pre-contracted **16 Dec 2026** |
| 4 | Payment rail | **Stripe Connect accepted.** DLang connects as the first connected account. Setup guide: `docs/ops/STRIPE_CONNECT_TWINT_SETUP.md` | D5 closed: Stripe Connect, one account per club, direct charges + application fee; QR-bill free and the default; Payrexx stays the documented fallback. | The written AML / fund-holding view is still needed before the first external club [Verify]. If SPSA is both the platform and the DLang club, Stripe's treatment of DLang's account must be confirmed [Verify with Stripe]. Gate 2 dates unchanged (18 Dec 2026 / 31 Jan 2027). | Connect application for DLang **27 Nov 2026**; Gate 2 **18 Dec 2026** / 31 Jan 2027; AML view **15 Jan 2027** |
| 5 | Submit >>venture>>? | Yes, by **30 Nov 2026**. Draft: `docs/company/applications/venture-2027/` | Shown as committed in all files. | Prize money is not modelled; it is a visibility and network play. | Submission **30 Nov 2026** |
| 6 | Round status | **EUR 50k secured**, released by the investor **once a CTO is in place**. One cap table for now; the CTO and advisors refine it. | The CTO hire is on the critical path for cash. Funding stack now: founder CHF 15k + EUR 50k (about CHF 46.5k) on CTO release + FIT at 0% = **about CHF 61.5k**. The recommendation to upsize or bridge stands (decision 14). One working cap table; any CTO equity is set with the CTO and advisors and shown to the investor before release. | **12 Nov founder-facts case** (FIT 0%, EUR 50k cash in Mar 2027 once the CTO is in place): cash is negative from **Jan 2027 without recovery**, lowest **about –43.5k in Feb 2027**, so **about CHF 45k must be bridged Jan–Mar 2027** (founder, an investor advance, or moving the CTO trial and pen-test costs later) [Confirm how]. If the release slips to Apr 2027, cash reaches about –54k in Mar 2027. The release condition must be written down (what counts as "a CTO in place"). EUR 50k still funds only about two months of burn. | Release condition in writing **27 Nov 2026**; Jan–Mar bridge (~CHF 45k) agreed **15 Dec 2026**; one cap table **3 Jan 2027**; convertible signed **31 Jan 2027** |
| 7 | CTO decision structure (Structure A vs reviewer model) | Defer to the CTO; **adopt the fractional CTO + AI agent team model**. | D9 replaced. Structure A is no longer the default; the CTO proposes structure, decision rights and any equity by **8 Jan 2027**. Humans keep approving every merge; second approver on payments, RLS, auth, migrations and AI. | Decision rights and IP terms for a part-time CTO must be in the contract; disguised-employment and IP-assignment points [Verify]. | CTO proposal on structure **8 Jan 2027** |
| 8 | Founder pay and lean-cost discipline | **Lean-cost variant accepted.** | Plan of record: founder pay Y2/Y3 CHF 3.5k/5k, engineering Y2/Y3 CHF 6k/8k, sales and marketing Y2/Y3 CHF 1k/1.5k (model years). Base trough improves from –441k to about –314k (–330k in the founder-facts case with AI included). | The founder lives on a low draw for three years; DLang/academy support must be documented as related-party [Verify]. The workbook file itself still opens on the non-lean inputs. | Workbook defaults updated at the model refresh **3 Jan 2027** |
| 9 | Headline claim | **Adopt "cheapest payment rail"; retire "cheaper than Spond on total cost".** | D6 confirmed. Claim audit of deck, site and playbooks. | Any old deck still in circulation. | Deck and claims fixed **4 Dec 2026** |
| 10 | Founding offer and pilots | **No free pilots in Switzerland once live; capped founding cohort as planned.** Exception: **one free design-partner pilot in the USA** and **one free design-partner pilot in an EU market (TBD)**, used as a model and case study. | Founding cohort unchanged (5 clubs at CHF 290 for life, capped at the signed tier, slots close 30 Sep 2027; up to 5 paid design pilots at list). New: exactly one free EU pilot and one free US pilot, with entry conditions (see decision 11). | Free pilots prove usage, not willingness to pay. Scope creep: a "free" pilot asks for custom work. Mitigation: written pilot agreement (scope, 6-month term, data terms, case-study consent, conversion price stated up front). | Pilot agreement template **31 Mar 2027** |
| 11 | Markets | Founder wants EU and US presence in 2027. | Re-plan: **Swiss paid launch first**. Add a **free EU design-partner pilot**, target live **Sep 2027** / downside **Jan 2028** (FR/DE-speaking border region, EUR, SEPA, GDPR Art. 27 representative), and a **free US design-partner pilot**, target the US fall season, live **Sep–Oct 2027** / downside **Mar 2028** (spring season) (USD, COPPA verifiable parental consent, US English; no US entity for a free pilot [Verify with counsel]; cross-border Stripe Connect [Verify]). Entry conditions for each: DLang live in CH + **≥3 paying CH clubs live**; i18n and currency complete for that market; privacy pack for that jurisdiction; support hours covered. Paid EU/US sales stay behind the existing gates (paid EU signed Q2 2028 / 2029; paid US not before H2 2029). **Strong EU pilot results can pull the paid EU gate forward to early 2028** (still needs ≥10 paying CH clubs). | **Capacity and cash.** The pilots land in Sep–Oct 2027, the same weeks as the Swiss season peak, DLang running the whole club and the push to 10 paying clubs. Not in the workbook: about CHF 15–30k cash in 2027 (Art. 27 representative, US counsel memo, COPPA consent work, travel, translation) and about 150–250 founder and CTO hours [Est.]. If the 3-club condition is met only in Aug 2027 (downside), both pilots move to the downside dates. | Partner shortlist **31 Mar 2027**; counsel memos (EU, US) **31 May 2027**; go/no-go per pilot **30 Jun 2027** |
| 12 | AI assistant (new) | Make it available to clubs **as soon as it is fully functional**. | Changed from "off and unsold until 2028" to: **opt-in per club** (a club admin switches it on); **DLang beta first, Q1 2027**; then founding clubs once acceptance criteria are met (base Q2 2027). Guardrails: tenant-scoped context only, minimal personal data (allow-list; never medical notes, dates of birth or coach notes), no training on tenant data, the AI provider listed as a sub-processor in the DPA, DPIA addendum signed off before any club switches it on, humans approve every message to a parent. Pricing: **included in the Club tier and above for now [Confirm]**; the CHF 90 add-on is withdrawn from the plan until a price decision. | "Fully functional" needs written acceptance criteria. Inference cost becomes a cost line with no matching revenue (the workbook already carries about CHF 6 per club per month). The workbook still books CHF 90 AI revenue from Year 3; with AI included, Year-3 revenue is about CHF 5.7k lower. | DPIA addendum and DPA sub-processor entry **15 Jan 2027**; DLang beta switched on **Feb 2027**; pricing confirmed **15 Dec 2026** |
| 13 | Name | Master-brand candidate **"Global Sport OS"** (founder's idea) for the mass-market platform; each club runs it under its own name, e.g. "DLang OS". | Naming note added: generic names are hard to register. Run a **Swiss / EU / US trademark and domain check by 15 Jan 2027** and shortlist **2–3 alternatives**. Keep **"DLANG Sports OS"** as the company/working name until then; naming decision **15 Feb 2027**. Club-level names ("DLang OS") are tenant branding, not a registered mark. | "Global Sport OS" is likely to be refused or weak as descriptive in classes 9/42 and crowded on domains [Est.; Verify with a trademark attorney]. The legal entity is SPSA GmbH, so contracts and invoices will show SPSA whatever the product is called. | Check **15 Jan 2027**; decision **15 Feb 2027**; CH filing **28 Feb 2027** |
| 14 | Which break-even and bridge dates are official? | **The v2 workbook**, everywhere. | 00, 01 and 09 now use the workbook: first EBITDA-positive month **about Q4 2030** (base, workbook default), **about mid-2030** on the lean-cost plan of record, **Aug 2029** upside, **2032 or later** downside. Cash negative for good from **Apr 2027** (workbook base) / **Jan 2027** downside; in the **12 Nov founder-facts case** (FIT 0%, EUR 50k cash Mar 2027) from **Jan 2027**, lowest about –43.5k in Feb 2027. Top cash actions: **sign the fractional CTO and bridge Jan–Mar 2027 (about CHF 45k)**; then pre-seed of about **CHF 250–300k in total, including the EUR 50k, in H1 2027**; upsize or bridge **by Apr 2027** at the latest. The calendar-year sketch in 01 is marked superseded. "Known inconsistencies" closed. | The workbook file still opens on FIT 50%, a Feb 2027 round, non-lean costs and AI revenue from Year 3; the founder-facts and plan-of-record figures in §2 were recalculated from copies. The EUR 50k release depends on the CTO (decision 6). | Workbook defaults changed to the plan of record and re-saved **3 Jan 2027** |
| 15 | Kill criterion (fewer than 8 paying clubs by 31 Mar 2028 → lifestyle or stop) | **No kill switch.** The founder commits to keep going. | Replaced by **strategy review triggers**: a missed gate starts a structured, two-week review of pricing, segment, channel and offer (with the CTO and advisors), ending in a written corrective plan. Specific plays are listed in `00` §4.7. The 31 Mar 2028 checkpoint stays as a review date, not a stop date. | Without a stop rule, the risk is drifting on a business that is not working. The triggers must lead to real changes, recorded in the decision log, and the monthly investor update must report them. | First checkpoint **31 Mar 2027**; major review **31 Mar 2028** |

---

## 2. Figures of record after these decisions

Source: `updated/DLANG_Sports_OS_Financial_Model_v2.xlsx`, the only computed source. Three cases, all from the same workbook (recalculated in LibreOffice on copies; the file itself is unchanged):

- **Workbook base (as published 11 Nov 2026):** FIT at 50%, EUR 50k cash in Feb 2027, default costs.
- **12 Nov founder-facts case:** FIT at 0% (`Assumptions!D61` = 0) and the EUR 50k released in **Mar 2027** once the CTO is in place (`C61` = 4); default costs. Matches the >>venture>> plan (`applications/venture-2027/DLANG_venture_2027_Startup_Plan.md`).
- **Founder-facts + lean (plan of record):** the founder-facts case plus the accepted lean-cost inputs (`C42`/`D42` = 3,500/5,000, `C43`/`D43` = 6,000/8,000, `C45`/`D45` = 1,000/1,500) and AI included in the Club tier (`B26` = 0).

Model years end in November.

| | Workbook base | 12 Nov founder-facts case | Founder-facts + lean (plan of record) | Downside (Bear), FIT 0%, lean |
|---|---|---|---|---|
| Paying clubs Nov-27 / Nov-28 / Nov-29 | 10 / 26 / 45 | 10 / 26 / 45 | 10 / 26 / 45 | 6 / 15 / 27 |
| ARR Nov-29 | 238.5k | 238.5k | 231.2k | 132.0k |
| Cash Jan / Feb / Mar 2027 | –17.5k / +13.0k / +2.2k | **–17.5k / –43.5k / –7.8k** | –17.5k / –43.5k / –7.8k | –17.5k / –43.6k / –54.6k |
| Cash negative for good | Apr 2027 | **Jan 2027** | **Jan 2027** | Jan 2027 |
| To bridge before the EUR 50k lands | — | **about CHF 45k (Jan–Mar 2027)** | about CHF 45k | about CHF 55k (Jan–Apr 2027) |
| Unfunded shortfall Nov-27 / Nov-28 / Nov-29 | 72k / 254k / 441k | 82k / 264k / 451k | 82k / 214k / 330k | 91k / 241k / 425k |
| Lowest cash point | –440.8k (Nov-29) | –450.8k (Nov-29) | –330.2k (Nov-29) | –424.9k (Nov-29) |
| First EBITDA-positive month | about Q4 2030 (outside the horizon) | about Q4 2030 | about mid-2030 [Est., extrapolated] | 2032 or later |
| Upside (Bull), for reference | Aug 2029 break-even; trough –237k | — | — | — |

**Cash actions of record, in order:**
1. **Sign the fractional CTO** (target 15 Dec 2026, latest 31 Jan 2027): it releases the EUR 50k.
2. **Bridge January–March 2027, about CHF 45k**, agreed by 15 Dec 2026: founder funds, an advance from the investor, or moving the CTO trial (10k) and pen-test (10k) costs later [Confirm].
3. **Pre-seed of about CHF 250–300k in total, including the EUR 50k, in H1 2027** (upsize the convertible, or a bridge signed by 28 Feb with cash in by Apr 2027 at the latest).
4. **Seed CHF 400–500k in Q1 2029**, raised from Q3 2028.

**Not in the workbook:** the 2027 EU and US free pilots (about CHF 15–30k cash [Est.]) and any fractional-CTO fee above the modelled engineering line. Both add to the need above.

---

## 3. Dates of record (base / downside)

| Milestone | Base | Downside |
|---|---|---|
| SPSA register details confirmed | 20 Nov 2026 | 20 Nov 2026 |
| >>venture>> submitted | 30 Nov 2026 | 30 Nov 2026 |
| Deck and claims fixed | 4 Dec 2026 | 4 Dec 2026 |
| Fractional CTO signed (releases EUR 50k) | 15 Dec 2026 | 31 Jan 2027 |
| Gate 2: TWINT reconciles on DLang (Stripe Connect) | 18 Dec 2026 | 31 Jan 2027 |
| IP present assignment to SPSA | 31 Dec 2026 | 31 Jan 2027 |
| Trademark and domain check ("Global Sport OS" + 2–3 alternatives) | 15 Jan 2027 | 15 Feb 2027 |
| Jan–Mar 2027 bridge (~CHF 45k) agreed | 15 Dec 2026 | 15 Dec 2026 |
| Convertible signed; EUR 50k cash in | 31 Jan 2027; Mar 2027 (founder-facts case; Feb in the workbook base) | 31 Mar 2027; Apr 2027 |
| AI assistant opt-in beta on DLang | Feb 2027 (Q1) | Mar 2027 |
| Naming decision | 15 Feb 2027 | 15 Feb 2027 |
| Pre-seed CHF 250–300k incl. the EUR 50k: signed / cash in | 28 Feb 2027 / by Apr 2027 | Jan–Feb 2027 |
| First strategy-review checkpoint | 31 Mar 2027 | 31 Mar 2027 |
| 3 paying Swiss clubs (pilot entry condition) | May 2027 | Aug 2027 |
| Pilot go/no-go (EU and US) | 30 Jun 2027 | 30 Jun 2027 |
| Free EU design-partner pilot live | Sep 2027 | Jan 2028 |
| Free US design-partner pilot live | Sep–Oct 2027 | Mar 2028 |
| 10 paying Swiss clubs | Oct 2027 | Mar 2028 |
| Paid EU track: first club signed | Q2 2028 (early 2028 if the pilot is strong) | 2029 |
| Paid US sales gate | not before H2 2029 | later |
| First EBITDA-positive month | about mid-2030 (lean plan of record); about Q4 2030 on the workbook defaults; upside Aug 2029 | 2032 or later |
