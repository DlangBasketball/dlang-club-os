# 09 — Founder Plan Review and Re-baselined Timeline

**Prepared:** 11 November 2026 (week 12 of the founder's 13-week rollout)
**Reviewer role:** strategy partner, outside view (SaaS and sports operator background)
**Scope:** the founder's August 2026 materials, checked against each other and against the code in this repository
**Status of this document:** a review and a recommendation. Where it says what has or has not happened since August, it is **inferring** from the documents and the repository. The founder must confirm or correct those points (section 7).
**Updated 12 November 2026:** the founder answered the main status questions and took 15 decisions. Section 8 summarises them and what they change; the dated milestones in §5.4 now follow the v2 workbook (the only computed source) and the founder's facts. Full log: `11_FOUNDER_DECISIONS_2026-11-12.md`.

Source materials reviewed in full:

| Ref | Document | Location |
|---|---|---|
| BP | Business Plan, 18 Aug 2026 (sections 00–13, Appendices A–B) | `docs/company/source/text/DLANG_Sports_OS_Business_Plan.md` |
| RO | 90-Day Operational Rollout, 24 Aug – 22 Nov 2026 | `docs/company/source/text/DLANG_Sports_OS_90_Day_Rollout.md` |
| FM | Financial Model workbook (README, Assumptions, Pricing, Unit_Economics, Model_Monthly, Annual_PL, Scenarios, Use_of_Funds, Cap_Table, KPI_Targets) | `docs/company/source/DLANG_Sports_OS_Financial_Model.xlsx` (text dump in `source/text/`) |
| CTO | CTO Partnership Proposal (15 pp) | `docs/company/source/text/DLANG_Sports_OS_CTO_Partnership_Proposal.txt` |
| DB | Executive Dashboard (HTML) | `docs/company/source/DLANG_Sports_OS_Executive_Dashboard.html` |
| DK | Investor Deck, August 2026 (12 slides) | `docs/company/source/DLang_Sports_OS_Investor_Deck_2026.pdf` |
| Repo | Code on `claude/ultracode-kfui6x` plus unmerged branches `wf/tenancy` and `wf/platform` | this repository |

All amounts are in CHF unless marked EUR. The model's exchange rate is 1 EUR = 0.93 CHF.

---

## 1. Executive verdict

The founder's own planning documents are unusually good: honest, sourced, internally critical, and focused in the right order (DLang first, then Swiss programme-revenue organisations, then the EUR track). The plan's weakness is not strategy but **calendar and capacity**. The rollout put about 18 months of work into 13 weeks for one founder, an engineering partner who has not yet been hired, and a cash base of CHF 81,500, including a grant and a round that are not confirmed. Today, 11 November 2026, the repository shows that the central technical gate, Gate 2 (a real TWINT payment reconciling automatically), is very probably **not** met. TWINT appears only as a label for manually recorded payments. There is no Stripe TWINT payment method and no Connect account per club. So the plan has slipped by roughly one quarter.

That slip is recoverable, but only if the next 90 days are re-planned around the Swiss calendar rather than against it. Christmas is a dead fortnight. Club committees decide in January–April. Clubs buy in time for summer camps and the August/September season start.

**Odds of success.** I put the chance of reaching 10 paying external clubs by the end of 2027 at about **50–60%**. I put the chance of reaching the deck's 150 clubs and EUR 808k ARR on its timeline at **under 15%**. A real, fundable Swiss vertical SaaS by 2029 is **about 35–45%**. Three things decide which way it goes:

1. **Whether money moves end to end.** That means a real parent paying by TWINT, the payment reconciling automatically on DLang's own camps, and every club's money flowing through its own account. It must happen before Christmas, or by 31 January 2027 at the latest.
2. **Whether willingness to pay exists at CHF 290–490 a month.** The plan's own generic value case clears only **2.0×** the Club-tier price against a 3× qualifying rule (FM, Pricing §D). Only audited numbers from real clubs can settle this, and the plan has no evidence of any yet.
3. **Founder capacity and cash, solved together.** That means a technical partner, or a disciplined founder-plus-AI-agents-plus-contract-reviewer model, plus a funding stack that actually closes. The model has the company out of cash in July 2027 even on its own optimistic timing (FM, Model_Monthly, closing cash M11).

---

## 2. What the founder's plan gets right — keep these

1. **The wedge is camps, academies and programme-revenue organisations, not volunteer associations (BP §1, §4.2, §5.1).** This is the right call. The buyers are about 2,000–3,000 Swiss organisations that collect real money, out of 18,310 clubs. It matches DLang's own operating shape, and generalist association tools are poorly built for it.
2. **"Spond is free" is answered with arithmetic, not features (BP §4.3, §7.2).** QR-bill at zero cost against Spond's 2.5% card-only fee is a sharp, true, napkin-sized argument for the treasurer, as long as it is framed correctly (see §3.1).
3. **Claim discipline (BP §2.2, RO W2).** The plan removes the named "signed" clubs that are not customers, removes "we've timed it", replaces "nFADP-compliant" with "nFADP-aligned by design", and drops "AI from day one". In a market where club presidents all know each other, this protects the only asset that cannot be rebuilt. Keep it as a standing rule.
4. **One pricing formula with packaged tiers (BP §5.3, FM Pricing).** CHF 149 + CHF 1.90 per athlete, or EUR 149 + EUR 2.00, published as Starter 290 / Club 490 / Academy 890 / Multi-site 1,690. This reconciles the deck with the old CHF 290/590/1,290 price list and makes the founding-club saving real.
5. **A hard cap of five founding clubs with written terms (BP §2.6, §7.4).** The founding offer is CHF 290 a month for life, 24 months of founder access, a 60-day refund, and month-to-month terms. Capping it at five and putting it in a signed addendum is correct.
6. **Paid onboarding fees as a filter, not margin (BP §5.3).** CHF 750 / 1,500 / 2,900. "Free setup creates expensive churn" is exactly right.
7. **A canonical beta scope with explicit exclusions (BP §6.1).** The beta is twelve features. Native apps, AI, tournaments, recurring memberships, waitlists, the athlete role, a website builder and federation management are all out. This is the right list. The repository has since gone beyond it in places (an AI assistant, a white-label platform layer), which section 3 addresses.
8. **Gates with failure responses written in advance (RO §4.2, FM KPI_Targets).** The gates are willingness to pay, money moving, and adoption. They come with stop rules, a 30 Nov 2026 first-signature red line, a 31 Dec 2026 payment red line, and a 31 Jan 2027 founding-cohort red line. Keep the mechanism. The dates need re-baselining.
9. **Compliance before data (BP §6.3, RO rule 4).** That means a record of processing, a DPIA, a DPA, consent records that cannot be altered, data export, and an independent security review before any real club data. This is correct given minors' and health data and personal liability under the FADP.
10. **Federation as a Year-2 channel, not a Year-1 claim (BP §7.5).** The steps are: get one member club measurably better off, then offer an aggregate dashboard, then a group agreement. This is the right order.
11. **An honest capital section (BP §11.4, FM Use_of_Funds).** It says plainly that EUR 50k does not fund Year 1. It recommends a subordinated convertible loan rather than priced equity, with the post-money versus pre-money cap error spotted. It keeps the discount at or below 33.3%. All of this is sound and saves real money.
12. **A model that funds conservatively and a rollout that drives behaviour (RO §00).** "Track against the rollout, fund against the model" is a good principle. The re-baseline in section 5 keeps it.

---

## 3. Where the plan is weak, inconsistent or risky

### 3.1 Pricing against a market where the leader is free

| Issue | Evidence | Why it matters | Fix |
|---|---|---|---|
| **The "cheaper than Spond on total cost" claim is false on the plan's own table** | BP §5.3, "Payments", says under-charging on the rail "is what makes the 'we are cheaper than Spond on total cost' argument true". BP §4.3 and FM Pricing §C show DLANG Club at **CHF 6,573/yr** against Spond at **CHF 1,755/yr**, which is 3.7× more expensive. | This is exactly the kind of checkable claim that BP §2.2 warns about. A treasurer will do this arithmetic. | Say: "**on payment rails** we cost CHF 693 a year against Spond's CHF 1,575." Then say: "**on total cost we are more expensive, and here is the fee recovery and admin time that pays for the difference, in your own numbers.**" Never claim cheaper in total. |
| **The value case fails the plan's own 3× rule** | FM Pricing §D: value CHF 983.50 a month against CHF 490, a ratio of **2.0×**. The Gate 1 pass rule needs at least 3× in six of ten audits (RO W4). | On generic inputs Gate 1 fails. Only larger or higher write-off clubs pass. | Treat Gate 1 as a real experiment. Prepare the fallback model in advance: a lower subscription (CHF 99–190) plus a percentage of programme or camp registration value, or a per-registration fee. |
| **The 20 admin hours a month saved and the 12% write-off are founder estimates, not measurements** | FM Pricing §D notes. BP Appendix A lists the 12% as an unverified founder figure. | Both value drivers are unmeasured. | Measure both at DLang first (before and after, Jan–Mar 2027) and publish that as case study #1. |
| **VAT is not visible in the comparison** | BP §10.2: most clubs cannot reclaim VAT, so the effective price is 8.1% higher once DLANG is VAT-registered. | CHF 490 becomes CHF 529.70 to a non-registered Verein. | Show prices including VAT in proposals once registered. Decide on voluntary VAT registration with the fiduciary (input-VAT recovery against the price hit to clubs). |
| **The payment-margin assumption does not match the stack actually built** | FM Assumptions §C: 0.9% net margin assuming Payrexx at about 1.3%. BP §6.2 prefers Stripe for developer reasons. The repository is built on **Stripe** (Checkout plus webhook). Stripe TWINT costs 1.9% + CHF 0.30. | Charging the club 2.2% all-in on Stripe TWINT leaves roughly **zero margin** on CHF 50–200 tickets. Payment margin in the model is about 5% of revenue, so it is small but currently fictional. | Pick one rail strategy now (section 6, action 3). Model the payment margin at 0.0–0.3% on Stripe, or move TWINT to Payrexx/Datatrans for the 0.9%. |
| **Spond and Paak can close the rail gap** | BP §4.5 R4. | The wedge has a shelf life of about 12–24 months. | Lead with programme and camp commerce plus operational depth. Use the rail argument as the opener, not the moat. |

### 3.2 Claims still in circulation

- **Deck slide 2: "€6,160 capital-efficient MVP".** The plan itself says a sellable multi-tenant beta takes 5–8 months of a small team (BP §2.5). Either qualify it ("incremental cost on an existing build, per SIDIS Appendix B") or remove it.
- **Deck slide 2: "100% founder-owned asset … under SIDIS draft".** IP held by the founder personally, under a *draft* development agreement with a third party, is a diligence red flag. The IP must be **assigned to the GmbH**, and the SIDIS agreement must be signed with a present assignment (BP §10.3).
- **Deck slides 1, 4, 5 and 12: "every team sport … worldwide", "Back the global multi-sport platform", and US youth participation statistics.** These contradict the plan's Swiss beachhead (BP §5, §7.3). An investor will notice. Keep "global" as the vision line and show the Swiss-first sequence as the plan.
- **Deck slide 6 prices "premium modules €49–199/month" (AI, analytics, placement).** None of these exist or are in beta scope (BP §6.1, §6.4). Label them as roadmap.
- **Deck slide 12 vs CTO §00:** "Founder retains 90%" stops being true if a 20% CTO grant goes in before the round (CTO §4.1). The investor must be told before signing (see 3.6).

### 3.3 Financial-model assumptions, checked line by line

| Assumption (FM sheet) | Value | Assessment |
|---|---|---|
| Gross adds ramp (Assumptions §A) | 2 in Nov-26, 2 in Dec-26, then 1/month, rising to 9/month by Aug-29; 138 over 36 months | **Timing is already wrong.** Likely actual: 0 paid by Nov-26. Shape also ignores seasonality. Swiss clubs sign Jan–Jun to go live for summer camps and the Aug/Sep season. Very few sign in Nov–Dec or Jul. Re-phase: about 70% of annual adds in Feb–Sep. |
| Sales cycle (BP §7.2) | 21 days, first contact to signature | Optimistic for committee-run clubs. Committees meet roughly monthly, and spending outside the budget often waits for the spring AGM (Mar–May). Use **45–90 days** for clubs and 30–45 days for privately owned academies and camp operators. |
| Warm-network conversion (BP §7.3) | 20–25% of 30+ clubs, giving 6–8 in Year 1 | Plausible for the year. Note the network is "football and ski clubs in the Geneva region", and many of those are covered by the Swiss-Ski/Fairgate or football association (clubcorner) systems, which the ICP itself deprioritises (BP §7.1). Effective addressable warm list may be 10–15. |
| Logo churn (Assumptions §B) | 1.5%/month base, flat | Monthly churn is the wrong shape for clubs. Losses cluster at season end (Jun–Aug) and when a treasurer or coordinator leaves. Model an annual renewal hazard of 15–25% concentrated in Q3. The 2.5% bear figure is a good stress test. |
| Blended ARPA | 330 / 400 / 450 by year | Y1 330 is fine. Y2 400 is applied to the whole base, including five clubs locked at 290 for life. This is a small overstatement and should be fixed in the formula. |
| Onboarding fee | 900 average, waived for 5 | OK. Note it is offered month-to-month, so it is also the only up-front cash. |
| Founder hours to close (Unit_Economics §A) | **22 h** | Inconsistent with BP §7.2, which says **31 h**. Use 31 h, or measure it. |
| CAC (Unit_Economics §C) | Fully loaded 1,376; LTV/CAC 13×; payback 3.7 months | All of these are on hypothetical churn and ARPA. Do not quote LTV/CAC to investors before about 10 paying clubs and 6 months of retention data. Quote CAC hours and close rate instead. |
| Engineering cost (Assumptions §E) | **CHF 4,500/month in Year 1** for "~24 h/week engineering" (RO §01) | Implies about **CHF 43/hour**. A Swiss senior contractor costs CHF 110–150/h, which would be CHF 11–15k/month at 24 h/week. Nearshore EU costs EUR 50–80/h. The 4,500 is only plausible with heavy AI-agent leverage plus a part-time senior reviewer. Either change the number or write that model down explicitly. |
| Year-2 engineering "1.0 FTE" | CHF 8,500/month | A Swiss senior developer costs CHF 130–170k a year plus about 12–15% employer social charges, so CHF 12–16k a month. Remote EU is about CHF 7–10k. The model is EU-remote-priced without saying so. |
| Founder compensation | 2,500 / 6,000 / 8,500 per month | Year 1 is below subsistence in Vaud. Is the academy paying the founder? **Employer social charges** (AHV/IV/EO/ALV, accident insurance, occupational pension above the threshold) on any GmbH salary are **not modelled**. Add about 10–15% on top of any salary line. |
| Support delivery | 55/club/month in cost of revenue | Reasonable. In Year 1 it is actually founder time, so it is double-counted with founder capacity rather than with cash. |
| AI module | 25% attach at CHF 90 from Month 13 | Optional upside. Fine to keep out of the base case until the module exists. |
| Funding timing (Assumptions §F) | Round lands M3 (Nov-26), FIT grant M5 (Jan-27) at **100% probability** | The grant depends on Vaud incorporation, a beta with test customers, and a filing made by 10 Nov 2026, which cannot be confirmed from here. Model the grant at 50% at most, or 0 if it was not filed. The round's close is unconfirmed. |
| Cash path (Model_Monthly) | Closing cash **–4,300 in Oct-26** before the round. Turns negative again Jul-27. Trough **–107,340** in Jan-29 (Base). Bear trough –336k. | **Superseded by the v2 workbook (12 Nov 2026):** on the workbook base cash is negative from **Apr 2027**; in the 12 Nov founder-facts case (FIT 0%, EUR 50k released Mar 2027 once a CTO is in place) from **Jan 2027**, about –43.5k in Feb 2027. Bridge Jan–Mar 2027 (about CHF 45k), then a pre-seed of about CHF 250–300k incl. the EUR 50k in H1 2027. |
| Break-even | First profitable month Jul-28; durable early 2029 | **v2 workbook (12 Nov 2026):** about Q4 2030 on default costs, about mid-2030 on the lean-cost plan the founder accepted, Aug 2029 upside, 2032 or later downside. |
| Use of funds (Use_of_Funds; DK slide 10) | 25% roadmap (EUR 12,640 in the deck vs 12,500 in the model) … 15% contingency | Small mismatch between deck and model (EUR 140). Bigger point, which the plan states itself: the round covers about a third to a half of 12 months. |
| Cap table (Cap_Table vs CTO §4.1) | BP/FM: founder 90% → 81% after pool → 72% after seed. CTO: founder **64.8%** → **57.9%** after seed. | The two documents describe different companies. The CTO structure is the one likely to happen, so the investor-facing cap table must show it. |
| Valuation | EUR 450k pre-money for 10% | The plan's own benchmark says this is below the Swiss pre-seed band (CHF 0.5–2.0m). Keep the convertible cap but consider raising it, or keep the low price and add a pro-rata right instead. Do not sell a priced round. |
| Equity value to CTO (CTO §5.1) | 4× ARR trade sale on CHF 648k Year-3 ARR, so 16.2% is worth CHF 420k | 4× is at the top of what sub-CHF 1m ARR vertical SaaS sells for, and it ignores seed dilution. Bull uses 150 clubs where the model's bull case is 204. Present a range of 2–4× with dilution after the seed. |

### 3.4 The CTO equity offer

- **Structure A pays CHF 1,200 a month for 4–5 days a week in Year 1** (CTO §00, §4.2). That is about CHF 7 an hour. The proposal is honest about it ("not a living wage"), but it shrinks the candidate pool to people with savings or a partner's income. Expect a long search: realistically 3–6 months to find, a 5-week trial, then 1–3 months' notice if the candidate is employed. **The plan's own rule (BP §9.2) was to switch to contractors if there was no co-founder by the end of Month 4, which is December 2026.** That date is now due.
- **20% equity before the round, at nominal value** is the right sequence for tax (CTO §8.2). Get an advance tax ruling, and confirm the investor accepts the dilution.
- **The services-revenue share (25% / 20% / 15% of onboarding fees)** is well designed, and the guardrails are good. The risk to watch is disguised employment if the CTO works through a personal company (CTO §8.2 names it).
- **The trial deliverable (TWINT reconciliation by 18 October) is overdue.** Re-scope the trial around the *current* gap: Stripe TWINT payments, per-club Connect accounts, the reconciliation webhook, and an independent RLS review.
- **Founder decision, 12 Nov 2026:** no CTO is confirmed; the founder asked whether an AI agent could be CTO. Answer: AI agents do the engineering, but a **named human fractional CTO** is needed (`12_CTO_SOLUTION_AI_PLUS_HUMAN.md`), target signed by **15 Dec 2026**. The EUR 50k is released only once a CTO is in place, so this is on the critical path for cash.
- **A credible alternative** (now the cover until the fractional CTO starts) if no partner signs by 31 January 2027: the founder plus AI coding agents, plus a paid senior Swiss/EU engineer for **4–8 hours a week of review and security sign-off** (about CHF 2–4k a month), plus a fixed-price external security review. This is close to the capital-light cost without depending on finding a co-founder.

### 3.5 Dependence on the founder's time

The rollout needs **45–50 hours a week without an engineering partner, and about 25 with one** (RO §01). That is on top of running a 145-athlete academy during the basketball season (Sep–May), with camps in the holidays. Six roles sit with one person (BP §9.1). The capacity risk (BP R2) is the second most likely failure mode after willingness to pay. Concretely:

- The two Tuesday/Thursday selling blocks (RO §4.1) clash with academy training slots in the evenings. Hold sales calls in the morning.
- Academy holiday camps (Christmas, February ski week, Easter, summer) are both the best place to test the product and the weeks of least founder capacity. Plan product releases *before* each camp, never during one.
- Onboarding at 8–10 hours a club stops working at about 5 concurrent clubs, not 25. The productisation in BP §8.1 must happen before club #3, not club #6.

### 3.6 Legal, payments and setup lead times

| Item | Realistic lead time | Plan assumption | Note |
|---|---|---|---|
| GmbH in Vaud (capital deposit account, notary deed, commercial register entry) | 3–6 weeks end to end | Formation in W1 (24 Aug), register entry in W3 | **Answered 12 Nov: exists as Swiss Preparatory Sports Academy GmbH** [Confirm register date]. Original note: if not done, nothing else (round, FIT, contracts, Stripe in the company's name) can close. |
| Business bank account | 1–4 weeks (longer for a new GmbH) | W1–W3 | |
| Stripe account with TWINT enabled (CH) | Days to 2 weeks (KYC) | W2 sandbox | Repo has no TWINT payment method yet. |
| Stripe Connect (each club a connected account) | 2–4 weeks to build; KYC per club takes days and needs association documents | Not in plan | **Required** so that DLANG never holds club money. Holding funds may make DLANG a financial intermediary under Swiss anti-money-laundering law. Have counsel confirm before the first external club. Charges must go direct to the club's account, with DLANG taking an application fee. |
| Payrexx/Datatrans TWINT alternative | 1–3 weeks contract | BP §6.2 suggests Payrexx | Cheaper rail, second integration. |
| Swiss QR-bill v2.4 | Effective **14 Nov 2026** | BP §6.2 | Code uses structured addresses (type "S"). Verify against v2.4 this week. |
| VAT registration | 2–4 weeks | At CHF 100k turnover (Year 2) | Consider voluntary registration. Decide with the fiduciary. |
| DPA, privacy notice in 4 languages, ROPA, DPIA | 3–6 weeks with a lawyer, plus translation | Done by W4 | Unknown. Must exist before the first external club, and **before DLang's own parents' data goes live in production**. |
| Independent security review | 2–4 weeks to book, 1–2 weeks to run, 1–3 weeks to fix | W8–W12 | Book now for a January 2027 slot. |
| Cyber and professional indemnity insurance | 2–4 weeks | W6 | |
| Hiring (Swiss notice periods) | 1–3 months notice, plus 1–2 months search | Not modelled | Every hire date in the plan should add 3–5 months. |
| EU sales (EUR track) | SEPA via Stripe: weeks. EU VAT: register under the non-Union OSS scheme for sales to non-VAT-registered associations, or reverse charge for B2B. GDPR Art. 27 EU representative. DE/FR legal texts. | "EUR track second" | 2–4 months of preparation. Do not start before about 10 CH clubs. |
| US | Entity decision (US subsidiary or direct), state sales tax on SaaS, COPPA (under-13s), state privacy laws, ACH/card, a different incumbent set (TeamSnap, LeagueApps, SportsEngine/PlayMetrics/Stack) | Deck says "worldwide" | Not before 2029. See section 5.4. |

### 3.7 Scope — the repository versus the canonical beta

Inferred from the code (`src/`, `supabase/migrations`, branches):

| BP §6.1 beta feature | Repository state (inferred) |
|---|---|
| 1. RBAC (admin, finance, coach, parent; athlete in the permission layer) | **Built.** Four roles plus row-level security across 16 migrations. Athlete role not present, which is consistent with "three ship". |
| 2. Club setup and branding | **Built.** White-label tenancy and runtime theming are on the unmerged `wf/tenancy` branch. |
| 3. Athlete/family management **with CSV import** | CRUD **built**. **CSV import not found** (only CSV *export*). This blocks migration, and so blocks switching cost. |
| 4. Public camp/programme registration | **Built** (`register/[programSlug]`, consents with text snapshot). |
| 5. **TWINT**, card and QR-bill with reconciliation | Card via Stripe Checkout plus webhook: **built**. QR-bill generation: **built**. **TWINT: manual recording only.** No Stripe Connect, single Stripe account. **Gate 2 is not technically met.** |
| 6. Admin dashboard with live KPIs | **Built.** |
| 7. Coach attendance, **offline-tolerant** | Attendance **built**. **Offline queue / service worker not found.** |
| 8. Schedule and sessions | Built in part (bookings and attendance modules). |
| 9. Broadcasts and 1:1 messaging | Notifications plus email built. Broadcast targeting by payment status should be verified. |
| 10. Automated reminders at 7 and 14 days | Overdue reminders exist (manually triggered). Scheduling and auto-cancel on payment should be verified. |
| 11. **Multilingual UI DE/FR/IT/EN** | **Not built** (no i18n framework or string catalogue). Blocks Romandie parents and multilingual reminders. |
| 12. Parent progressive web app with consents | Parent web area built. Consents built. Progressive web app install and offline not found. |
| Out of scope: AI | **An AI assistant module exists** (migration `…091500_ai_assistant.sql`, `src/lib/ai`). **Changed 12 Nov 2026 (founder):** opt-in per club, DLang beta Q1 2027, then founding clubs once fully functional, with guardrails (tenant-scoped, minimal personal data, no training on tenant data, DPA covers the AI sub-processor, DPIA addendum first). Included in the Club tier for now [Confirm]. Still never the headline claim. |
| Out of scope: platform/white-label resale | `wf/platform` adds plans, subscriptions, self-signup and an operator console. Useful foundations for DLANG's *own* billing of clubs, but they must not displace items 3, 5, 7 and 11. |

**Conclusion:** the build is much further along than "12–15% of a beta" (BP §2.5 described the prototype, not this code). But the four items still missing are exactly the ones the plan calls gates or switching-cost drivers: integrated TWINT with per-club Connect, CSV import, i18n, and offline attendance. They should be the whole engineering backlog until February 2027.

---

## 4. Status check against the 90-day rollout (today: Wed 11 Nov 2026, week 12 of 13)

**Everything in this section is inferred.** The materials are dated 18 August 2026, and nothing after that date was provided. The repository's commit history was imported in one go on 11 Nov 2026, so it cannot show *when* work was done, only *what exists*.

| Rollout item | Planned week | Likely status | Basis for the inference |
|---|---|---|---|
| GmbH formed in Vaud; bank account | W1–W3 | **Answered 12 Nov: exists** as Swiss Preparatory Sports Academy GmbH (SPSA); bank account "SPSA Tech" [Confirm register no. and date]. | Founder |
| GENILEM application | W1 | Unknown | — |
| Claim audit; one price list | W2 | **Partly.** BP and FM are reconciled. The deck (Aug 2026) still carries "€6,160 MVP", "worldwide", EUR pricing and premium modules. | DK slides 2, 5, 6, 12 |
| Ten workflow audits; **Gate 1** | W2–W4 | **Unknown, possibly not done.** There are no audit summaries, tally or price reactions anywhere. | No artefacts |
| Canonical scope document | W1 | Done in effect (BP §6.1). Repository scope has drifted (AI, platform). | Repo |
| TWINT sandbox; registration to payment; **Gate 2** (18 Oct) | W2–W8 | **Very likely not met.** No TWINT integration, no Connect. Card and QR-bill work. | `src/lib/stripe.ts`, `payment-methods.tsx` |
| DLang academy running a real programme on the platform | W7 | Unknown. Possible in a card/QR-bill-only form. | — |
| Founding club #1 signed | W7 | **Probably not.** Red line is 30 Nov. | No addendum, DPA or invoice in materials |
| CTO trial started (W5); offer or reset (W8) | W5–W8 | **Answered 12 Nov: no CTO.** Fractional CTO + AI agent team adopted; target signed 15 Dec 2026. | Founder |
| Round closed | W7 | **Answered 12 Nov:** EUR 50k secured, released once a CTO is in place. | Founder |
| FIT Digital application filed (deadline **10 Nov 2026**) | W11 | **Answered 12 Nov: not filed.** Pack being prepared; 0% in the model; eligibility under the ≤6-months-since-register-entry rule to be checked. | Founder |
| >>venture>> 2027 submission (window **closes 30 Nov 2026**) | W6+ | **Answered 12 Nov:** will be submitted by 30 Nov 2026 (draft in `applications/venture-2027/`). | Founder |
| Security review commissioned | W8 | Unknown. Internal `SECURITY.md` and `SECURITY_CHECKLIST.md` exist; no external report. | Repo docs |
| ROPA / DPIA / DPA / privacy notice in 4 languages | W1–W10 | Unknown | No documents in the repo |
| Coach attendance live; reminders measured; case study | W9–W11 | Not achievable without club #1 | — |
| **Gate 3** (22 Nov) | W13 | **Will not be met** on any realistic reading. | — |

**Questions the founder must answer to confirm each gate.** These are the minimum facts needed to pick the right branch of section 5.

*Gate 1 (willingness to pay):*
1. How many workflow audits were held? Where are the written summaries?
2. How many showed recovered hours plus fees of at least 3× CHF 490 a month?
3. What were the exact price reactions, verbatim?
4. How many demos and proposals were made, with what decision dates?

*Gate 2 (money moves):*
5. Has any real parent paid any real DLang invoice through the app, by card, QR-bill or TWINT? How many, and what amount?
6. Which TWINT route is chosen (Stripe TWINT, Payrexx, Datatrans)? Is the merchant account live, and in whose name?
7. Is DLang's academy running at least one programme on the production system with real families?

*Gate 3 (adoption):*
8. Is any external club using the system? Is any signed? Is any in negotiation, with decision dates?
9. Are DLang admins and coaches logging in weekly? Who has stopped using the spreadsheet?

*Capital and legal:*
10. *(Answered 12 Nov: yes, SPSA GmbH; date still to confirm.)* Is the GmbH registered? If so, on what date (this starts the FIT 6- and 12-month eligibility clocks)? Who are the shareholders?
11. *(Answered 12 Nov: not filed.)* Was the Innovaud pre-evaluation held? Is SPSA within the company-age limit?
12. What is the status of the EUR 50k round: term sheet, instrument, signed, funded?
13. What is the bank balance today, and the actual monthly burn?

---

## 5. Re-baselined realistic timeline (from Monday 16 November 2026)

### 5.1 Planning principles

- **Fund against the downside, track against the base.** This is the founder's own principle, kept.
- **The Swiss calendar governs selling.** Christmas and New Year (about 21 Dec – 4 Jan) is effectively closed for clubs. Club committees decide Jan–Apr, often waiting for the spring AGM for unbudgeted spend. Families register for summer camps from about March and for the season from June to September. Winter camps run Dec–Feb, Easter camps in April, and cantonal ski weeks in February (dates vary by canton). So **external clubs signed in Q1 2027 go live for summer camps and the 2027/28 season**, and Q4 2027 is the first real wave of adds.
- **DLang is customer #1 in every phase.** It is the only customer whose calendar the founder controls. Run every new workflow on a DLang camp or term *before* selling it.
- **Swiss hiring lead times** are 1–3 months' notice plus 1–2 months' search. Every "hire" milestone below is a *start* date.

### 5.2 Next 13 weeks, week by week (16 Nov 2026 – 14 Feb 2027)

| Wk | Dates | Must ship / decide | Must sell / file | Gate or checkpoint |
|---|---|---|---|---|
| 1 | 16–22 Nov | **Truth week.** Answer the 13 questions in §4. Re-run the claim audit on the deck. Freeze scope to the four missing beta items (TWINT+Connect, CSV import, i18n, offline). Check QR-bill against v2.4 (in force 14 Nov). Choose the payment rail. | Book 5 workflow audits for Dec–Jan. Start the >>venture>> submission. | Status baseline written down. Original rollout W13 retrospective. |
| 2 | 23–29 Nov | Enable TWINT in the Stripe test environment. Design per-club Connect accounts (direct charges plus application fee). Finish the ROPA/DPIA/DPA drafts. | **Submit >>venture>> by 30 Nov.** 2 audits. *(12 Nov: SPSA GmbH exists; confirm register details.)* Fractional CTO shortlist by 30 Nov. | First-signature red line (30 Nov) applies to *DLang's own paid flow plus a signed LOI*, re-dated (see §5.3). |
| 3 | 30 Nov – 6 Dec | TWINT checkout and webhook reconciliation in staging, with failure states and duplicate protection. Request quotes for the external security review. | FIT not filed (12 Nov); next intake and eligibility checked. 2 audits. | **Fractional CTO signed and Jan–Mar bridge agreed by 15 Dec.** |
| 4 | 7–13 Dec | **DLang live pilot:** one real DLang programme or winter camp, real parents, card + QR-bill + TWINT. | Proposals to the 2 warmest audit clubs, with a January decision date. | **Gate 2 attempt.** |
| 5 | 14–20 Dec | Fix pilot defects. Start the CSV import with a column-mapping preview. Book the security review for January. | Holiday-season message to the pipeline. | **Gate 2 target: 18 Dec.** |
| 6–7 | 21 Dec – 3 Jan | Low-intensity weeks. Maintenance only, nothing new in production. Write the 90-day retrospective. Refresh the model with actuals and re-phase it for seasonality. | None (clubs are closed). | **Gate 2 red line: 31 Dec.** If missed, run the founding beta manually and keep the payment work as the only engineering priority. |
| 8 | 4–10 Jan | i18n: string catalogue plus FR and DE for parent registration, invoices and reminders. | 3 audits and demos (committees reconvene). | **CTO structure proposal (8 Jan)** from the fractional CTO signed in December (founder decision 12 Nov); reviewer model if the CTO slips (latest 31 Jan). |
| 9 | 11–17 Jan | DLang spring-term invoicing run fully on the platform, with 7- and 14-day reminders running automatically. | 2 proposals. | Measure: CHF outstanding before and after, admin minutes. |
| 10 | 18–24 Jan | External security review runs. Fix critical and high findings. | Founding addendum and DPA signed with club #1 (base). | — |
| 11 | 25–31 Jan | Offline attendance queue (service worker). Coach training at DLang. | **First founding club signed (base). Downside: end of Feb.** | Founding-cohort red line re-dated to 30 Jun 2027 (from 31 Jan). |
| 12 | 1–7 Feb | Productised onboarding: recorded walkthroughs and an in-app checklist. | Onboard club #1 (day 0–12 runbook). | — |
| 13 | 8–14 Feb | Hardening. Accountant-format export. | Pipeline review: clubs 2–3 in negotiation for spring go-live. | **Re-baselined Gate 3 (DLang):** DLang ran one full registration → payment (incl. TWINT) → reminder → attendance cycle, and admins are active weekly. |

### 5.3 Re-baselined gates and red lines

| Gate | Original date | Base | Downside | Failure response (founder's own, kept) |
|---|---|---|---|---|
| Gate 1 — willingness to pay (10 audits, ≥6 at 3×) | 20 Sep 2026 | **31 Jan 2027** | 15 Mar 2027 | Restructure to a lower subscription plus a fee on programme or camp value. |
| Gate 2 — real TWINT payment reconciles automatically on DLang | 18 Oct 2026 (red line 31 Dec) | **18 Dec 2026** | 31 Jan 2027 | Manual beta; payment chain is the only engineering priority. |
| First paid external signature | by 30 Nov 2026 | **31 Jan 2027** | 31 Mar 2027 | 20 more discovery calls; the offer is wrong, not the product. |
| Gate 3 — DLang fully operating on the platform | 22 Nov 2026 | **14 Feb 2027** | 31 Mar 2027 | Freeze features; adoption only. |
| Gate 3b — club #1 operating weekly with a full cycle and a reference | 22 Nov 2026 | **30 Apr 2027** | 30 Jun 2027 | Same. |
| Founding cohort (5) closed | 31 Jan 2027 | **30 Jun 2027** | 30 Sep 2027 | Cut to 3 and move to public pricing. |

### 5.4 12- and 24-month milestones

| Milestone | Founder plan | **Base** | **Downside** | Notes and preconditions |
|---|---|---|---|---|
| DLang live on the platform (one full cycle incl. TWINT) | Oct 2026 | **Feb 2027** | Mar 2027 | §5.2 W13 |
| DLang runs the *whole club* on it (Easter camp, summer-camp registration, 2027/28 season registration and invoicing) | — | **Sep 2027** | Oct 2027 | Proves seasonal peak load. Summer-camp registration opens about March. |
| First paying external Swiss club | Nov 2026 (model) / Oct 2026 (rollout) | **Feb 2027** (signed late Jan) | Apr 2027 | Founding price CHF 290 |
| 3 paying Swiss clubs | Nov–Dec 2026 | **May 2027** | Aug 2027 | Go-live before summer camps |
| 5 founding clubs | Jan 2027 | **Jun 2027** | Sep 2027 | Cap held at 5 |
| 10 paying Swiss clubs | Jun 2027 (model ≈ 9.4) | **Oct 2027** | Mar 2028 | The season-start wave. First clubs at list price CHF 490 plus setup fee. |
| 25 paying Swiss clubs | Jan 2028 (model ≈ 24.8) | **Oct 2028** | Jun 2029 | Needs referrals switched on plus productised onboarding |
| CHF 10k MRR | ~Feb 2028 | **Q4 2028** | Q3 2029 | |
| Free EU design-partner pilot (added 12 Nov) | — | **Live Sep 2027** | Jan 2028 | Entry: DLang live + ≥3 paying CH clubs, EUR/SEPA and FR/DE complete, GDPR pack incl. Art. 27 representative, support hours covered; go/no-go 30 Jun 2027 |
| Free US design-partner pilot (added 12 Nov) | — | **Live Sep–Oct 2027** (US fall season) | Mar 2028 (spring season) | Same entry conditions; USD, US English, COPPA verifiable parental consent; no US entity [Verify]; cross-border Stripe Connect [Verify] |
| First paid EUR-track club (DE/AT/FR border region) | Year 3 mix | **Signed Q2 2028** (early 2028 if the EU pilot is strong), **live Sep 2028** | 2029 | Entry gate: ≥10 CH clubs, gross margin ≥75%, SEPA live, EU VAT (OSS) and GDPR Art. 27 representative in place, DE/FR complete |
| First federation / multi-site pilot | Year 2 (months 15–24) | **H2 2028** | 2029 | Needs 2 published case studies in that federation's sport or region |
| Break-even (first EBITDA-positive month) | Jul 2028, durable early 2029 | **About mid-2030** on the lean-cost plan of record; about Q4 2030 on the workbook defaults; Aug 2029 upside | 2032 or later | v2 workbook (founder decision 14). Needs about 75–80 clubs on the default cost base |
| Fractional CTO in place (signed) | Sep–Oct 2026 | **15 Dec 2026** | 31 Jan 2027 | Founder decision 12 Nov: fractional CTO + AI agent team. Releases the EUR 50k |
| Part-time customer success (50%) starts | ~Month 12 (Aug 2027) | **Jan 2028** (hire at club 8–10) | Jun 2028 | Recruit from Oct 2027 |
| First engineering employee (FTE) | Year 2 | **Q1 2029** (after seed) | Later | Do not hire on convertible money |
| Bridge and pre-seed | — (gap of ~107k named) | **Bridge Jan–Mar 2027 (~CHF 45k)**, agreed by 15 Dec 2026; pre-seed ~CHF 250–300k incl. the EUR 50k in H1 2027 (cash in by Apr 2027 at the latest) | Bridge needed from Jan 2027 | Founder-facts case: cash negative from Jan 2027 (workbook base: Apr 2027) |
| Seed round (≈CHF 300k at ≥CHF 2.5m pre, per Cap_Table) | ~Aug 2028 | **Q1 2029** | 2029–2030 | Needs ≥25 clubs, <1.5% monthly churn equivalent, 2 case studies |
| **Paid US sales gate** | Deck implies "worldwide" | **Not before H2 2029; decide at that point** | Later or never | The free 2027 US pilot is evidence, not the gate. See below |
| Broad white-label resale (selling the platform to resellers or agencies) | Deck "licensing, white-label" | **2029 at the earliest** | — | Federation or multi-site white-label first (H2 2028) |

**Founder decision, 12 Nov 2026:** the founder wants an EU and US presence in 2027. The re-plan keeps the Swiss paid launch first and adds exactly one free design-partner pilot in each market (rows above), with entry conditions. Honest view: both go live in the Swiss peak (Sep–Oct 2027) and cost about CHF 15–30k plus 150–250 founder and CTO hours [Est.], none of it in the workbook; they wait for the downside dates if the Swiss conditions are not met.

**Where ambition and realism diverge, plainly.** The founder's vision and this repository's direction aim at a global, any-sport, white-label SaaS launching in Switzerland, the EU and the USA. That is a fine ten-year destination and the architecture already supports it: organisation IDs on every table, runtime theming, locale and currency settings. As a **2027 go-to-market** it would fail, for four reasons:

1. **The wedge does not travel.** TWINT and QR-bill economics, Romandie language coverage and the founder's personal network are the only proven advantages. None of them exists in the US, and only some exist in the EU.
2. **The US is an incumbent-saturated, private-equity-consolidating market.** TeamSnap, LeagueApps, SportsEngine/PlayMetrics/Stack and GameChanger have channels, free tiers and payment economics a two-person Swiss company cannot match. It also carries COPPA, state privacy laws, state sales tax on SaaS, and (practically) a US entity.
3. **Capacity.** One founder at 45–50 hours a week cannot run sales in two time zones and three legal systems.
4. **Capital.** The company has about CHF 61,500 secured (founder 15k plus EUR 50k on CTO release; FIT at 0%, 12 Nov). A US entry costs a six-figure minimum; a single free pilot does not.

**US entry gate (all must be true):** at least 40 paying clubs; at least CHF 25k MRR; a year of net revenue retention ≥100%; a seed round closed with a US line item; the 2027 free US design partner (or another) willing to pay; and a named US channel (a league, school network or federation). **EUR gate:** as in the table. **White-label resale gate:** at least 25 clubs on one codebase with no forks; an external penetration test passed; documented tenant isolation tests; and a support SLA the company can actually staff.

---

## 6. "Do better": top 15 prioritised actions

| # | Action | Owner | Effort | Deadline | Success metric |
|---|---|---|---|---|---|
| 1 | Answer the 13 status questions in §4 and write the honest 90-day retrospective (what was assumed that was wrong) | Founder | 0.5 day | 20 Nov 2026 | Written status on all 3 gates, cash and legal; shared with advisors and investor |
| 2 | Submit the >>venture>> 2027 application (reuse BP sections) | Founder | 2–3 days | **30 Nov 2026** (hard close) | Confirmation of submission |
| 3 | Decide the payment architecture: Stripe TWINT plus per-club Connect accounts (direct charges with an application fee) versus Payrexx/Datatrans for TWINT. Get a written legal view on whether DLANG holds funds (anti-money-laundering exposure). | Founder + CTO/reviewer + counsel | 1 week | 27 Nov 2026 | Decision memo; Stripe TWINT test payment succeeds |
| 4 | Build and ship integrated TWINT with automatic reconciliation, failure states and duplicate protection; run it on a real DLang programme | Engineering (CTO trial or contractor plus agents) | 3–4 weeks | 18 Dec 2026 (base) / 31 Jan 2027 (red line) | ≥10 real DLang payments reconciled with zero manual steps |
| 5 | Sign a named human fractional CTO to lead the AI agent team (founder decision 12 Nov); pre-contract the senior reviewer as cover | Founder | Ongoing | Shortlist 30 Nov; **signed 15 Dec 2026**; reviewer 16 Dec | Signed contract; investor confirms EUR 50k release |
| 6 | SPSA GmbH exists (founder, 12 Nov): confirm register details; assign all IP (founder and SIDIS) to SPSA; sign the SIDIS agreement with a present assignment; get a view on carving the software business out of the academy GmbH | Founder + fiduciary + lawyer | 3–6 weeks elapsed | Details 20 Nov; carve-out view 15 Dec; IP 31 Dec 2026 | Register extract; signed IP assignments on file |
| 7 | Compliance pack: ROPA, DPIA, DPA template, parent privacy notice FR/DE/EN (IT later), breach procedure, under-16 rule documented | Founder + data-protection lawyer | 5–8 days of work | 15 Jan 2027 (before club #1 data) | Documents signed off; DPA signed with club #1 |
| 8 | Book and complete an independent security review (RLS/tenant isolation, auth, webhook, output escaping); fix critical and high findings | Founder (procure) + engineering | CHF 5–15k; 4–6 weeks elapsed | Booked by 4 Dec; done by 31 Jan 2027 | Report with zero open critical/high findings |
| 9 | Ship the three missing switching-cost features in order: CSV import with mapping preview, FR/DE i18n for parent and coach surfaces, offline attendance | Engineering | 5–7 weeks | 28 Feb 2027 | A real club spreadsheet imports cleanly; a parent completes registration in French; attendance taken in airplane mode syncs |
| 10 | Run 10 workflow audits with **privately owned academies, camp operators and international schools first** (not federation-covered football or ski clubs); record price reactions verbatim | Founder | 10 × (20 min + 1 h write-up) | 31 Jan 2027 | Gate 1 tally: ≥6 of 10 at ≥3× value; ≥3 accept the price |
| 11 | Prepare the Gate 1 fallback price card *now*: a low subscription plus a fee on programme or camp registration value, modelled per club | Founder | 1 day | 15 Dec 2026 | A one-page alternative price card ready to test in parallel |
| 12 | Fix the deck and assets: remove "cheaper than Spond on total", qualify "€6,160 MVP", mark premium modules as roadmap, show the Swiss-first sequence, show the cap table *including* the CTO grant | Founder | 1 day | 4 Dec 2026 | Claim audit passes; one cap table across BP, FM, CTO and deck |
| 13 | Switch the v2 workbook defaults to the plan of record: FIT 0%, EUR 50k cash Mar 2027, lean-cost inputs, AI included in the Club tier; add pilot costs | Founder (+ advisor review) | 1 day | 3 Jan 2027 (*done 12 Nov 2026 as `updated/DLANG_Sports_OS_Financial_Model_v2.1.xlsx`; advisor review and actuals on 3 Jan*) | Workbook opens on the founder-facts numbers |
| 14 | Funding stack: bridge Jan–Mar 2027 (~CHF 45k; founder, investor advance or deferred costs); sign the EUR 50k subordinated convertible (cap stated post-money; release on CTO in place); pre-seed ~CHF 250–300k incl. the EUR 50k in H1 2027; FIT pack ready for the next intake if SPSA is eligible; GENILEM; MassChallenge CH (Jan 2027) | Founder + lawyer | 1–2 days a month | Bridge agreed 15 Dec 2026; convertible 31 Jan 2027; pre-seed cash by Apr 2027 | Runway never below 3 months on the downside model |
| 15 | Turn DLang into the case study: before/after measurement on the spring term (CHF outstanding, collection within 7 days, admin hours), signed off by the DLang director/treasurer, published by 31 Mar 2027 | Founder | 2–3 h a week for 8 weeks | 31 Mar 2027 | One-page case study with measured numbers; used in every proposal |

---

## 7. Questions for the founder (things only you know)

1. **Status:** what actually happened in weeks 1–12? (The 13 questions in §4 come first.)
2. **Money:** what is the bank balance today, and what will you personally live on until mid-2027? Does the academy pay you a salary, and will it keep doing so?
3. **Round:** *(answered 12 Nov: EUR 50k secured, released once a CTO is in place)* who is the strategic investor, what have they actually agreed, and do they know about the planned 20% CTO grant?
4. **Entity:** *(answered 12 Nov: the company is Swiss Preparatory Sports Academy GmbH; still open: does the same GmbH run the academy?)* which legal entity runs DLang Basketball / Swiss Prep Sports Academy today (association, sole trader, GmbH)? Will the academy be a paying customer of the new GmbH, at what price, and on arm's-length terms?
5. **IP:** who wrote the current code (you, SIDIS, freelancers, AI agents under your accounts)? Is any of it assigned to anyone yet? What does the SIDIS draft actually say about ownership and payment?
6. **CTO:** *(answered 12 Nov: none yet; fractional CTO + AI agent team adopted)* is there a real candidate? Did a trial start? Which of structures A–D are they leaning towards, and when could they start given their notice period?
7. **Time:** how many hours a week can you truly give DLANG Sports OS during the basketball season (Sep–May) and during camp weeks?
8. **Pipeline:** name the clubs. Of your 30+ warm contacts, how many are private academies or camp operators *not* covered by Swiss-Ski/Fairgate or the football association system?
9. **DLang calendar:** what are DLang's 2027 dates for winter, ski-week, Easter and summer camps, and when does 2027/28 registration open? These anchor every product release.
10. **Payments today:** how does DLang collect money now (bank transfer, TWINT QR, cash)? What is the real write-off, in CHF, for the 2025/26 season?
11. **Ambition:** is the goal a large venture outcome (which needs the federation or multi-site channel and a seed round by 2029), or a profitable Swiss/EU business with 100–200 clubs? The plan supports both, but they need different decisions in 2027. You agreed in BP §13.2 to decide at Month 18.
12. **Grants:** *(answered 12 Nov: not filed; pack being prepared)* was FIT Digital filed? Did Innovaud say anything about eligibility (team of 2–5, Vaud domicile, beta with test customers)?
13. **Non-negotiables:** which of these would you refuse to change even if Gate 1 fails: the CHF 290 founding price, the 60-day refund, month-to-month terms, QR-bill free?
14. **White-label and other sports:** has any non-basketball organisation, or any school or federation, asked to use the platform under its own brand? Name them. That is the only evidence that should pull white-label resale earlier.
15. **US:** *(answered 12 Nov: a 2027 presence through one free design-partner pilot)* what specifically draws you to the US (a personal network, a partner, an investor's request)? If there is a concrete US partner, they are the first thing to evaluate against the gate in §5.4.

---

## 8. Founder answers of 12 November 2026, and what they change

The founder answered the status questions and the 14 decisions listed in `updated/CHANGELOG.md`, and added a 15th (the AI assistant). The full log, with remaining risks and follow-up dates, is `11_FOUNDER_DECISIONS_2026-11-12.md`.

| Topic | This review said (11 Nov) | Founder answer (12 Nov) | Updated position |
|---|---|---|---|
| Entity | GmbH status unknown; treat as not done | Swiss Preparatory Sports Academy GmbH (SPSA); account "SPSA Tech" | Incorporated [Confirm register no. and date]. New risk: academy and software in one entity; carve-out view by 15 Dec 2026 |
| FIT Digital | Unknown whether filed; 50% base | Not filed; prepare it | 0% until filed and awarded; eligibility under the company-age rule may block it |
| CTO | Decide 8 Jan 2027: Structure A or reviewer model | No CTO; can an AI agent be CTO? Defer structure to the CTO | Named human fractional CTO + AI agent team, signed 15 Dec 2026 (latest 31 Jan 2027) |
| Round | Status unknown; upsize recommended | EUR 50k secured, released once a CTO is in place; one cap table for now | CTO on the critical path for cash; Jan–Mar 2027 bridge ~CHF 45k; pre-seed ~CHF 250–300k incl. EUR 50k in H1 2027 |
| Payment rail | Decide by 27 Nov | Stripe Connect; DLang connects | Closed; AML view still due 15 Jan 2027 |
| >>venture>> | Still open, submit | Submit by 30 Nov 2026 | Committed |
| Founder pay | Lean-cost variant proposed | Accepted | Plan of record; trough about –330k (founder-facts case) instead of –451k |
| Claim | "Cheapest payment rail" | Adopted | Deck fix 4 Dec 2026 |
| Pilots | No free pilots | No free pilots in CH; one free EU and one free US design partner | EU live Sep 2027 / Jan 2028; US Sep–Oct 2027 / Mar 2028; entry conditions |
| Markets | EUR Q2 2028; US H2 2029 | EU and US presence in 2027 | Via the two pilots; paid EU can move to early 2028 on a strong pilot; paid US unchanged |
| AI assistant | Off by default, unsold until 2028 | Available once fully functional | Opt-in per club; DLang beta Q1 2027; included in the Club tier [Confirm] |
| Name | DLANG Sports OS pending clearance | "Global Sport OS" candidate; clubs use own names | CH/EU/US trademark and domain check by 15 Jan 2027 with 2–3 alternatives; decision 15 Feb 2027 |
| Break-even and bridge dates | Q2 2029; bridge by Sep 2027 (§5.4 before this update) | Use the v2 workbook | About mid-2030 lean / Q4 2030 default / Aug 2029 upside / 2032+ downside; cash negative Jan 2027 (founder-facts) or Apr 2027 (workbook base) |
| Stop rule | Fewer than 8 clubs by 31 Mar 2028 → lifestyle or stop (BP) | No kill switch | Strategy review triggers (`00` §4.7) |
