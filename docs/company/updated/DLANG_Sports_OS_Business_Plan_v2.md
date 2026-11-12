---
title: "DLANG Sports OS — Business Plan v2"
subtitle: "The operating system for club sport in Switzerland, and the plan to build a company around it. Re-baselined November 2026."
date: "11 November 2026, updated 12 November 2026"
---

**BUSINESS PLAN · v2 · NOVEMBER 2026**

**DLANG SPORTS OS**

The operating system for club sport in Switzerland, and the plan to build a company around it. Re-baselined three months after the August plan, with what we now know.

- Full-scale business plan, strategy and operational rollout, updated
- Swiss CHF domestic track first, EUR export track second, US and broad white-label resale behind written gates
- Three-year financial model v2 (December 2026 to November 2029), unit economics and capital plan
- Written for the same two readers: the investor deciding, and the founder executing

Prepared for: Derrick Lang, Founder & CEO

Company: Swiss Preparatory Sports Academy GmbH (SPSA), Vaud, trading as DLANG Sports OS (working name) *[Confirm register number and date]*

Date: 11 November 2026. Replaces the Business Plan of 18 August 2026 (original kept unchanged in `docs/company/source/`).

Status: Pre-revenue. Zero paying external clubs, as far as is known on 11 November 2026. Updated 12 November 2026 with the founder's 15 decisions (`docs/company/11_FOUNDER_DECISIONS_2026-11-12.md`). Items only the founder can confirm are marked *[Confirm]*.

Confidential. Not for circulation without the founder's consent.

---

# 00 How to read this document [Updated Nov 2026]

This plan still does two jobs. Sections 1 to 4 and 11 to 13 are written for someone deciding whether to put money in. Sections 5 to 10 and the companion Rollout v2 are written for the founder. Where the two conflict, the operational truth wins.

What is new in v2 is a third job: **telling the truth about the last three months.** The August plan set a 90-day rollout from 24 August to 22 November 2026, with three gates. On 11 November the evidence in the codebase says Gate 2 (a real TWINT payment reconciling automatically) has not been met: TWINT exists only as a label on manually recorded payments, and there is a single Stripe account rather than one per club. Gates 1 and 3 and the first paid signature are unconfirmed. So every date in this document is **re-baselined from Monday 16 November 2026** and shown as **base / downside**.

> **AN HONEST FRAMING, THREE MONTHS ON**
>
> DLANG Sports OS has a working production application (Next.js /
> Supabase / Stripe, multi-tenant with row-level security), card
> checkout and Swiss QR-bill that work, a 145+ athlete academy to
> deploy into, a founder who is the buyer, and a full set of sales
> assets. It still has zero paying external clubs, TWINT is not yet
> live, four beta features are missing, and the money raised so far
> covers about two months of the plan as now costed.
>
> Both paragraphs are true. The next six months are about the second.

**Labels.** *[founder]* = from the founder's August materials. *[unverified]* = not independently checked, never a model driver. *[Est.]* = estimate in this plan. *[Confirm]* = only the founder knows. *[Verify]* = needs a lawyer, fiduciary or tax adviser before anyone relies on it. Sections that changed materially carry **[Updated Nov 2026]** in the heading. All amounts CHF unless marked EUR.

## Founder decisions of 12 November 2026 [Updated 12 Nov 2026]

The founder answered the open status questions and took fifteen decisions the day after this plan was drafted. They are applied throughout and logged in `docs/company/11_FOUNDER_DECISIONS_2026-11-12.md`.

| # | Decision | Effect on this plan |
|---|---|---|
| 1 | The company is **Swiss Preparatory Sports Academy GmbH (SPSA)**; bank account "SPSA Tech" *[Confirm register no. and date]* | Treated as incorporated (10.1). New risk: academy and software in one entity (R17) |
| 2 | FIT Digital **not filed**; prepare it | Modelled at **0%**; eligibility may be blocked by the company-age rule (11.4) |
| 3, 7 | No CTO yet. **Named human fractional CTO + AI agent team**; the CTO sets the structure | Signed **15 Dec 2026** (latest 31 Jan 2027) (9.2) |
| 4 | **Stripe Connect** accepted; DLang connects first | Payment rail closed (2.1) |
| 5 | **>>venture>>** submitted by 30 Nov 2026 | Committed |
| 6 | **EUR 50k secured, released once a CTO is in place**; one cap table for now | CTO on the critical path for cash; Jan–Mar 2027 bridge (11.4) |
| 8 | **Lean-cost variant** accepted | Plan of record (11.1) |
| 9 | "Cheapest payment rail" adopted; "cheaper than Spond" retired | Claims (2.2) |
| 10, 11 | No free pilots in Switzerland; **one free EU and one free US design-partner pilot** in 2027 | New phases in 5.5 and gates in 13.3 |
| 12 | **AI assistant opt-in per club** once fully functional; DLang beta Q1 2027; included in the Club tier *[Confirm]* | 5.2, 5.3, 6.4 |
| 13 | Master-brand candidate **"Global Sport OS"**; clubs run it under their own name (e.g. "DLang OS") | Trademark and domain check by 15 Jan 2027 (5.1, 10.4) |
| 14 | Break-even and bridge dates come **only from the v2 workbook** | Section 01 and 11 |
| 15 | **No kill switch** | Strategy review triggers (13.2) |

**Companion documents.** Rollout v2 (weeks 1–13 from 16 November 2026 plus a 12-month roadmap), Financial Model v2 (`DLANG_Sports_OS_Financial_Model_v2.xlsx`, with Changes_v2 and Timeline_v2 sheets), and the company documents 00–10 in `docs/company/`, which hold the detail behind each section.

---

# 01 Executive summary [Updated Nov 2026]

## The business in one paragraph

DLANG Sports OS is a Swiss-built operating system for the organisations that run youth and club sport: academies, camps, clubs, and later the schools and federations behind them. It replaces the six disconnected tools a typical organisation runs on (spreadsheet, WhatsApp, paper consent forms, a bank account, a website and the club president's memory) with one system for registration, payment, scheduling, attendance, communication and reporting, in French, German and English (Italian later), on Swiss payment rails. It is built by an operator who runs a 145-athlete academy and needs the product himself *[founder]*. The long-term destination is a white-label platform any club, school or organisation in any sport can run under its own brand. The 2027 job is narrower: Switzerland, programme-revenue organisations, money moving end to end.

## The six things this plan concludes

| # | Conclusion | What it means in practice |
|---|---|---|
| 1 | **The wedge is still camps and academies, not clubs** | Unchanged from August. Programme and camp commerce (register → pay → roster → attend → remind) is the sharpest gap and DLang's own operating shape. |
| 2 | **Money must move before anything else ships** *(new)* | Gate 2 is the gating item. Club payments go through Stripe with a Connect account per club (direct charges plus a small application fee) so DLANG never holds club money. TWINT must reconcile automatically on DLang by **18 Dec 2026 / 31 Jan 2027**. |
| 3 | **The price must be justified on money, and the claim must be the true one** | "Cheaper than Spond on total cost" is false on our own table (DLANG CHF 6,573/yr vs Spond 1,755). The true claim is narrower and still strong: **the cheapest payment rail** (693 vs 1,575 on the same club). Qualify every deal on the club's own audited numbers. |
| 4 | **Distribution is captured at federation level** | Unchanged. Sell to segments without a federation software deal; treat federations as a 2028 pilot, not 2027 revenue. |
| 5 | **EUR 50,000 funds about two months, not a year, and arrives only once a CTO is in place** *(changed 12 Nov)* | With realistic Swiss engineering cost, employer social charges and a season-later ramp, the v2 model goes cash-negative in **April 2027** on its base. With the founder's 12 Nov facts (FIT at 0%, EUR 50k released in **March 2027** once the CTO is in place) cash is negative from **January 2027**, about –43.5k in February. The two top cash actions are **signing the fractional CTO** and **bridging January–March 2027 (about CHF 45k)**; then a **pre-seed of about CHF 250–300k in total, including the EUR 50k, in H1 2027**. |
| 6 | **The global white-label ambition is right as a destination and wrong as a 2027 launch** *(updated 12 Nov)* | Paid sales in 2027 are Swiss only. The founder's wish for an EU and US presence in 2027 is met with **one free design-partner pilot in each** (EU live Sep 2027, US Sep–Oct 2027), behind entry conditions. Paid EUR-track sales open after ≥10 Swiss clubs (Q2 2028, or early 2028 on a strong pilot). Paid US sales not before H2 2029. Broad white-label resale 2029 at the earliest. Each has a written entry gate (section 13.3). |

## The numbers [Updated Nov 2026]

Financial Model v2, base case. Model year 1 runs December 2026 to November 2027. The workbook runs Bull and Bear live; Bear is the downside timeline used throughout this plan.

| Metric (CHF) | Year 1 (to Nov-27) | Year 2 (to Nov-28) | Year 3 (to Nov-29) |
|---|---|---|---|
| Paying clubs at year end | 10 | 26 | 45 |
| Total revenue | 18,200 | 89,900 | 201,100 |
| **EBITDA** | **(143,500)** | **(182,300)** | **(186,500)** |
| **ARR at year end** | **39,600** | **117,100** | **238,500** |
| Downside ARR (clubs) | 19,800 (6) | 63,900 (15) | 136,400 (27) |
| Upside ARR (clubs) | 68,700 (17) | 209,900 (45) | 465,300 (87) |
| August plan ARR (clubs) | 51,900 (13) | 254,300 (50) | 669,500 (118) |

**Capital required on top of today's stack (workbook base, incl. a 3-month buffer):** about CHF 110k to November 2027, about CHF 300k to November 2028, about CHF 490k to November 2029. Lowest modelled cash point: base –440.8k, downside –547.8k, upside –237k. A lean-cost variant (founder pay and engineering capped) improves the base trough to about –314k.

**12 Nov founder-facts case** (same workbook, FIT at 0%, EUR 50k released in March 2027): cash negative from January 2027, about –43.5k in February; unfunded shortfall about 82k / 264k / 451k at November 2027 / 2028 / 2029. On the **plan of record** (founder-facts plus the accepted lean-cost variant and the AI assistant included in the Club tier) the shortfall is about 82k / 214k / 330k.

**Break-even (official, v2 workbook):** the base case does not reach a profitable month inside the 36-month horizon; at the Year-3 sales pace it gets there around **Q4 2030**, at roughly 75–80 clubs. On the **lean-cost plan of record** the founder accepted, around **mid-2030**. The upside case breaks even in **August 2029**; the downside not before 2032. The August plan's "first profitable month July 2028" no longer holds.

*Note on other company documents:* on 12 November 2026 the founder made the v2 workbook the only source for break-even and bridge dates. `00_EXECUTIVE_PLAN.md`, `01_BUSINESS_MODEL.md` and `09_FOUNDER_PLAN_REVIEW.md` have been aligned to it.

*The August investor deck projects 10 / 50 / 150 clubs and EUR 54k / 269k / 808k ARR. On the v2 model that path sits above even the upside case. It must be relabelled a target with named preconditions, not a forecast. Our estimate of the odds of reaching it on the deck's timeline: under 15% [Est.].*

## The ask, and a recommendation about it [Updated Nov 2026]

The deck asks for EUR 50,000 for 10% at EUR 450,000 pre-money (CHF 418,500). August's two observations still stand: the valuation is low for Swiss pre-seed, and a priced round is the wrong instrument at this size. Two things have changed.

- **The EUR 50k is secured, but released only once a CTO is in place** (founder, 12 Nov 2026). In the founder-facts case it lands in March 2027, so January–March 2027 needs a bridge of about **CHF 45k** (founder funds, an investor advance, or deferring the CTO trial and pen-test costs) *[Confirm]*.
- **The amount is too small for the plan as now costed.** EUR 50k (about CHF 46.5k) covers roughly two months of v2 burn. Raise a **pre-seed of about CHF 250–300k in total, including the EUR 50k, in H1 2027** (upsizing the same convertible), with cash in by **April 2027** at the latest.
- **The cap table must be one cap table.** The founder decided on one working cap table now, refined with the CTO and advisors. Any CTO equity is shown to the investor before the release.

> **RECOMMENDED ROUND STRUCTURE [Updated Nov 2026]**
>
> A subordinated convertible loan, signed by **31 January 2027**, after
> all IP is assigned to Swiss Preparatory Sports Academy GmbH (31 Dec
> 2026). EUR 50k first close secured, released once a CTO is in place;
> pre-seed CHF 250–300k in total in H1 2027. Cap stated
> post-money so the 10% promised for EUR 50k is actually 10% (CHF
> 465,000 post-money for that tranche, or re-priced for a larger round
> with a lawyer). Discount 15–20%, at or below 33.3%. Maturity 18–24
> months or a qualified round. Converts into newly issued shares. CTO
> equity grant disclosed. [Verify]
>
> The FIT Digital Grant (CHF 20,000) was **not filed** by the 10
> November 2026 deadline (founder, 12 Nov). It is counted at **0%**
> until filed and awarded; eligibility may be blocked if SPSA was
> entered in the register more than 6 months ago [Verify]. The
> \>>venture>> competition closes **30 November 2026**; the founder
> will submit.

---

# 02 Decision memo: what to change before another franc is spent [Updated Nov 2026]

In August this section found six contradictions in the founder's assets. Three months on, four are still open and three new ones have appeared. In priority order:

## 2.1 Decide the payment architecture by 27 November (new)

The August plan named Payrexx as the fastest route to TWINT and modelled a 0.9% payment margin on that basis. The codebase is built on Stripe, with one platform account. That combination has two problems. First, on Stripe, TWINT costs about 1.9% + CHF 0.30, so a 0.9% net margin does not exist; the v2 model uses 0.2% on 40% of collections. Second, if parents pay into one DLANG account, DLANG holds club money, which may make it a financial intermediary under Swiss anti-money-laundering rules [Verify].

**Decision:** Stripe Connect with a connected account per club, direct charges, and a DLANG application fee (indicatively 0.5% gross). QR-bill stays free and the default. Payrexx (one account per club) is the documented fallback; it is revisited at 25+ clubs on margin grounds. A written legal view on fund-holding is needed by 27 November, before the first external club.

## 2.2 Stop making claims you cannot evidence (still open, one new entry)

The August claim audit still applies in full (no "beta clubs report 60%", no "we've timed it", no named clubs presented as signed, "nFADP-aligned" not "nFADP-compliant", no AI promised in beta). Add four more:

| Claim in circulation | Where | The problem | Fix |
|---|---|---|---|
| "Cheaper than Spond on total cost" | Business plan §5.3, sales pitch | False on our own table: 6,573 vs 1,755 a year | "The cheapest payment rail for clubs that collect real money" |
| "€6,160 MVP" | Investor deck | Cannot describe a sellable multi-tenant payment platform | Say what it bought (incremental work on an existing build) or remove |
| "Worldwide, every team sport" | Investor deck | Not a 2027 plan | "Swiss-first, built multi-tenant; EU and US behind gates" |
| Premium modules listed as included | Deck, price list | AI, native apps, video etc. do not exist | Mark as roadmap with no date |

Deadline: deck and claims fixed by **4 December 2026**.

## 2.3 Make the company real: IP into SPSA by 31 December [Updated 12 Nov 2026]

The founder confirmed on 12 November that the company is **Swiss Preparatory Sports Academy GmbH (SPSA)** in Vaud, with a bank account "SPSA Tech" *[Confirm register number and date]*; FIT was not filed. What remains: a **present assignment** of all code, designs and brand from the founder, SIDIS and every contractor to SPSA by **31 December 2026** (downside 31 January 2027). The deck says the IP sits with the founder "under SIDIS draft". No investor money should arrive before that is fixed. Because SPSA also runs the academy, get a lawyer's and fiduciary's view by **15 December 2026** on ring-fencing the software business now and carving it into its own company before the seed [Verify].

## 2.4 Close the beta scope gap by 28 February (changed)

August's problem was two contradictory scope lists. November's problem is the gap between the canonical list (section 6.1) and the code. Four beta features are missing from the repository: **CSV import** (only export exists), **a multilingual interface** (no translation layer), **offline attendance** (no service worker) and **per-club payment accounts**. Meanwhile, two things outside beta scope exist: an AI assistant module and a white-label platform layer. Decision: finish the four missing items by **28 February 2027**; make the AI assistant **opt-in per club** (founder, 12 Nov: DLang beta Q1 2027, then founding clubs once fully functional, with the guardrails in 6.4); keep the white-label layer, because it is the same multi-tenancy the Swiss product needs, but sell nothing white-label in 2027.

## 2.5 Separate the two technical assets in your own mind (unchanged)

The V10 clickable prototype is a sales instrument and a specification, not shippable code. The production application is the real company asset. Put it through an independent security review (booked by **4 December**, done by **31 January 2027**) before real external club data.

## 2.6 Cap the founding-club discount and defend it (unchanged, dates moved)

Five founding clubs at CHF 290/month for life, in writing; the sixth pays list. The v2 model also fixes an error in the August model, which applied later-year ARPA to the founding clubs: they stay at CHF 290 in every year. Founding slots close **30 September 2027** whether or not all five are filled. Add one clause the August addendum lacked: the lifetime price is capped at the tier the club signed on (a founding club that grows past 180 athletes moves to Academy pricing less the same CHF 200 saving) [Verify].

## 2.7 Re-cost engineering and reconcile the cap table (new)

The August model budgets CHF 4,500/month for about 24 engineering hours a week: about CHF 43/hour against Swiss contractor rates of CHF 110–150. The Year-2 "1 FTE at CHF 8,500/month" is EU-remote pricing, and employer social charges are not modelled. v2 costs engineering honestly (section 11). The founder decided on 12 November: a **named human fractional CTO leading an AI agent team**, signed by **15 December 2026** (section 9.2).

---

# 03 The business [Updated Nov 2026]

## 3.1 What DLANG Sports OS is (unchanged)

A sports organisation collects money from families, assigns children to groups, puts those groups in a place at a time with an adult, records who turned up, and tells everyone what happens next. DLANG Sports OS is one system for those five operations, built around four roles.

| Role | Primary surface | What they do | What success looks like |
|---|---|---|---|
| Director / club admin (and finance) | Desktop | Set up programmes and camps, publish a registration link, see money owed and in, run reminders, export for the accountant, manage staff | Monday morning is calm. They know who has paid without asking anyone. |
| Coach | Mobile, offline-tolerant | Today's session, one-tap attendance, notes, team messages | Attendance in under 90 seconds, with no signal. |
| Parent | Mobile web app (PWA) | Register a child, sign consents, pay by QR-bill, TWINT or card, see the week | Registering for a camp takes under four minutes on a phone. |
| Athlete (13+) | Later phase | Schedule, feedback, progress | Not in the beta. Safeguarding design first. |

## 3.2 Two products, one codebase (new)

| | Product 1: DLang's own operating system | Product 2: DLANG Sports OS (white-label SaaS) |
|---|---|---|
| Who | DLang Basketball / Swiss Prep Sports Academy, Lausanne | Swiss programme-revenue organisations now; EU, US, federations and resellers later, behind gates |
| Job | Run the whole club: programmes, camps, registration, invoicing, reminders, attendance, coach and parent apps, player-development bookings | The same platform per tenant, with the club's branding, terminology, language and currency |
| Success test | DLang admin hours and CHF outstanding fall measurably; case study signed by DLang's director by 31 March 2027 | Paying clubs that use it weekly, renew and refer |
| Rule | Every new workflow runs on a DLang term or camp **before** it is sold | One codebase, no forks per customer, ever |

DLang is customer zero: DLang live on one full cycle including TWINT by **14 February / 31 March 2027**, and running the whole club (Easter camp, summer camps, 2027/28 season registration) by **September / October 2027**.

## 3.3 Why this founder (unchanged)

The founder runs the organisation the software is for *[founder]*. That gives a live proving ground, buyer credibility and correct instincts about sequencing. The corresponding risk is concentration: the founder is product manager, developer-manager, salesperson, support desk and operator of the reference customer. Section 9 addresses it; it remains the single largest execution risk.

## 3.4 What exists today (was 3.3) [Updated Nov 2026]

| Asset | State at 11 November 2026 | Assessment |
|---|---|---|
| Clickable prototype (V10 / V1 design reference) | 51 views, 6 personas, full design system | Ready to sell with. Not software. |
| Production application | Next.js 15 / React 19 / Supabase (Postgres, RLS on every tenant table, auth, storage) / Stripe / Swiss QR-bill / Resend; admin, coach and parent apps; public registration; AI assistant module; type-check and build pass | The real asset. Card checkout and QR-bill work. Missing: TWINT live, per-club payment accounts, CSV import, translation layer, offline attendance, CI pipeline, external security review. |
| Reference customer | DLang / Swiss Prep Sports Academy, 145+ athletes *[founder]* | Deploy here first. Winter-camp pilot December 2026. |
| Sales assets | Deck, brief, positioning, pricing, Strikefirst playbook, landing copy | Need the claim fix (section 2.2) by 4 December. |
| Company documents | Business model, GTM, technology, org/HR, legal, customer success, brand (docs/company/00–10) | New since August. This plan summarises them. |
| Paying external clubs | Zero *[Confirm]* | The plan is still about changing this number. |

---

# 04 Market

Section 4 is unchanged in substance. Sources and figures are as verified in August 2026 (Appendix A); none has been re-verified for this version. The conclusions are restated with one correction in 4.3.

## 4.1 The problem, quantified (unchanged)

| Fact | Figure | Source |
|---|---|---|
| Sports clubs affiliated to Swiss Olympic federations | 18,310 | Vereinsstudie 2022 |
| Active club memberships | 2.21 million | Vereinsstudie 2022 |
| Positions to fill nationally | 374,400, of which 351,000 unpaid | Vereinsstudie 2022 |
| Clubs with any paid staff | 13% (≈2,380) | Vereinsstudie 2022 |
| J+S youth participants (2025) | 703,700 | BASPO, Feb 2026 |
| J+S camp participant-days | 2.0 million in 2025 | BASPO |
| TWINT transactions (2025) | 901 million, over 6 million users | Blick / Netzwoche |

Administrative load is rising while the volunteer base that carries it shrinks. Software is one of the few levers that moves that ratio.

## 4.2 Who can actually pay (unchanged)

The Swiss market is large in units and small in wallets. 65% of clubs have up to 100 members and cannot pay CHF 290+/month. The realistic paid-platform universe is the ≈2,380 clubs with paid staff; the plan's target is the **2,000–3,000 Swiss organisations that collect programme revenue from families**: private academies, camp operators, ski and football academies, international-school sports programmes, and multi-sport clubs with a paid coordinator.

## 4.3 Competition, and the price reality [Updated Nov 2026]

The competitor table is unchanged from August (Spond free with 2.5% + CHF 0.20 card-only payments; Paak free under 100 members then CHF 29 / 99 a month; ClubDesk CHF 240/yr; Webling CHF 310/yr; Fairgate free to members under Swiss-Ski and STV deals; Twizzit, SportsNow; and the PlayMetrics / Stack Sports / SportsEngine consolidation in the US). Prices were verified August 2026 and should be re-checked before they appear in any sales asset.

**What a 140-athlete Swiss club collecting CHF 63,000 a year pays today** *(August table, unchanged)*

| | Software CHF/yr | Payment fees CHF/yr | Total CHF/yr |
|---|---|---|---|
| Spond Club (with website) | 180 | 1,575 | 1,755 |
| ClubDesk (M tier) | 240 | 410 | 650 |
| Paak One | 296 | 567 | 863 |
| Webling Plus | 311 | 410 | 721 |
| Twizzit (Hattrick) | 660 | 473 | 1,133 |
| SportsNow (Basic + card module) | 780 | 1,229 | 2,009 |
| **DLANG Club tier** | **5,880** | **693** | **6,573** |

> **THE CORRECTION [Updated Nov 2026]**
>
> August concluded that the payment rail is the best wedge and that
> DLANG is "cheaper than Spond on total cost". The first half is right.
> The second half is wrong on this very table: DLANG costs CHF 6,573 a
> year against Spond's 1,755. What is true is that on the payment line
> DLANG (693, QR-bill free by default) is less than half of Spond
> (1,575), and that DLANG must win the rest of the gap on hours and
> fees recovered, in the club's own audited numbers. That is a harder
> sale, and the honest one.
>
> Note also that the 693 assumed a Payrexx-level rail. On Stripe the
> club's TWINT/card cost is slightly higher; DLANG's application fee is
> kept small precisely so the rail claim stays true.

## 4.4 Where the white space is, and is not (unchanged)

Not differentiated: member database, roster, scheduling, RSVP, attendance, messaging, club websites, increasingly invoicing with QR-bill and TWINT, and "ask your club a question" AI. Genuinely open: **camps, courses and short-form programmes** as the core workflow; **payment-rail economics**; **French- and Italian-speaking Switzerland**; and possibly **J+S subsidy administration** *[unverified, validate with five clubs]*. The parent experience is a defensive requirement.

## 4.5 The three real threats (unchanged)

1. **Spond**: free at scale, localised to CHF; the answer must be numerical and about Swiss payment rails.
2. **Federation bundling**: Fairgate (Swiss-Ski, STV), clubcorner (football). Sell where there is no deal.
3. **The CHF 250–300/yr price floor, and Paak specifically**: Swiss, sports-native, AI on its roadmap.

Add a fourth, longer-range: **US consolidation** (PlayMetrics + Stack Sports + SportsEngine, private-equity backed). It is a reason not to enter the US early, and a reason Europe may get a well-funded entrant within two to three years.

---

# 05 Strategy [Updated Nov 2026]

## 5.1 Positioning [Updated Nov 2026]

> **POSITIONING STATEMENT (2027, SWITZERLAND)**
>
> DLANG Sports OS is the operating system for sports organisations that
> run on programme revenue: academies, camps and clubs that collect
> real money from real families. Register, pay, roster, attend, remind,
> in one chain, on Swiss payment rails, in French, German and English,
> built by someone who runs one.
>
> Sales line: the cheapest payment rail for clubs that collect real
> money. QR-bill free by default; TWINT and card when parents want
> them; reconciled automatically.
>
> Tagline unchanged: **Run your club. Not your inbox.**

Changes from August: "four languages" becomes French, German and English with Italian later (no translation layer exists yet, and claiming four would break the claim rule). No TWINT claim in any public asset until Gate 2 is passed on DLang. The category claim "operating system" is kept and still sets a quality bar.

**Brand layers** *(new, from 07)*: the company, the platform and the club brands are separate. DLang Basketball becomes tenant number one with its red-and-gold palette as a tenant theme; the platform gets a neutral look so other clubs do not inherit a rival's colours. *[Updated 12 Nov 2026]* The founder's master-brand candidate is **"Global Sport OS"**, with each club running it under its own name (for example "DLang OS"). Generic names are hard to register, so a Swiss / EU / US trademark and domain check on it and 2–3 alternatives is due **15 January 2027**; "DLANG Sports OS" (which also collides with the D programming language in search) stays the company/working name until then; naming decision by 15 February 2027.

## 5.2 The differentiators, ranked by how defensible they are (largely unchanged)

| Differentiator | Real? | Verdict |
|---|---|---|
| Programme and camp commerce as the core workflow | Yes | **First position** in every asset. 12–24 month window. |
| Swiss payment rails, QR-bill free by default | Yes, once Gate 2 passes | Lead against foreign competitors; worthless against ClubDesk/Webling/Paak on its own. |
| nFADP-aligned architecture, Swiss/EU data residency | Yes | The liable person, not the president, is the buyer here. |
| FR / DE / EN (IT later) | Partly | A requirement met, not an advantage held. |
| Founder-led onboarding | For now | Ends around 25 clubs. Productise before then. |
| Multi-tenant, white-label-ready platform *(new)* | Yes, technically | An option for 2028+, not a 2027 selling point. |
| AI assistant suite | Not yet | Do not lead with AI. Opt-in per club from the DLang beta (Q1 2027); included in the Club tier *[Confirm]*. |

## 5.3 The dual-track pricing architecture [Updated Nov 2026]

**The formula and the tiers are kept exactly.** One formula, two currencies, packaged tiers.

| | CHF domestic track | EUR export track |
|---|---|---|
| Base platform fee / club / month | CHF 149 | EUR 149 |
| Per active athlete / month | CHF 1.90 | EUR 2.00 |
| Payments | QR-bill free. TWINT and card at provider cost plus a small published DLANG application fee (via Stripe Connect) | SEPA Direct Debit and card at cost plus the same published fee |
| Tax | Swiss VAT 8.1% once registered | Reverse charge for VAT-registered customers; non-Union OSS for others [Verify] |
| When sold | From January 2027 | Not before Q2 2028, behind the EUR gate |

| Tier | Athlete cap | CHF / month | EUR / month | Onboarding fee CHF | Who it is for |
|---|---|---|---|---|---|
| Starter | 75 | 290 | 279 | 750 | Single-programme club or small camp operator |
| Club | 180 | 490 | 469 | 1,500 | **Primary ICP**: 100–300 athlete academy with a paid coordinator |
| Academy (Pro) | 400 | 890 | 849 | 2,900 | Multi-team, multi-location operations |
| Multi-site / Federation (Enterprise) | 1,000+ | 1,690 | 1,590 | Quoted | Academy groups, school networks, federations. Not sold before the H2 2028 pilot. |

USD prices (indicatively USD 299 / 499 / 899) are **not published** and are not used in the model. They exist only so a future US gate review has a starting point.

**Add-ons** *(new)*: custom domain; SMS passed through at cost; AI assistant opt-in per club, **included in the Club tier for now** *[Confirm]* (the CHF 90/month add-on is parked; the workbook still models 15% attach from Year 3 until its defaults are updated); white-label native app (2029 at the earliest, paid by the customer).

**Founding offer, unchanged in substance:** five clubs, CHF 290/month for life (capped at the signed tier), onboarding waived, 24 months of direct founder access, quarterly roadmap vote, 60-day money-back, month-to-month. Slots close 30 September 2027. No free pilots in Switzerland (confirmed 12 Nov 2026); the only free pilots are one EU and one US design partner (5.5).

**Payments: the deliberate decision to under-charge [Updated Nov 2026].** August modelled 0.9% net on 50% of collections, which assumed Payrexx at about 1.3%. On Stripe the margin is close to zero. v2 models **0.2% net on 40% of collections**, about CHF 4 per club per month. The rail is a reason to buy, not a profit line. Revisit at 25+ clubs (Payrexx or negotiated Stripe pricing), not before.

**The uncomfortable number, still there.** The generic value case is about CHF 983/month of value against CHF 490: **2.0×**, below the playbook's 3× qualifying rule. Never qualify on the generic model; only on the club's own audited numbers; walk away below 3×. If Gate 1 fails, the fallback price card (ready **15 December 2026**) is a lower subscription plus a small fee on programme and camp value.

## 5.4 The moat question, answered honestly (unchanged)

Three real moats, none of them technology: switching cost once a club is fully migrated (manufactured in the first 30 days), segment focus on programme commerce (a two-year window), and distribution through the founder's operator network (good for about the first fifty customers, then referral mechanics and a federation). Not moats: the AI suite, the design system, language support, "being Swiss", and, added in v2, white-label capability.

## 5.5 Market sequence and gates (new)

| Phase | What | Base / downside | Entry gate |
|---|---|---|---|
| 0 | DLang on the platform (customer zero) | Feb 2027 / Mar 2027 | Gate 2 + Gate 3 |
| 1 | Swiss programme-revenue organisations, Romandie first | First paid signature 31 Jan / 31 Mar 2027 | GmbH + IP, Gate 1, compliance pack, security review, insurance |
| 1b | Schools (international-school sports programmes) | H2 2027 | 3+ Swiss clubs live; school data-protection review |
| 2 | Federation or multi-site pilot | H2 2028 / 2029 | Reference base in Romandie |
| 2b | Free EU design-partner pilot *(12 Nov)* | Live Sep 2027 / Jan 2028 | DLang live + ≥3 paying Swiss clubs; EUR, SEPA, FR/DE complete; GDPR pack incl. Art. 27 representative; support hours covered; go/no-go 30 Jun 2027 |
| 2c | Free US design-partner pilot *(12 Nov)* | Live Sep–Oct 2027 (US fall season) / Mar 2028 | Same conditions; USD, US English, COPPA verifiable parental consent; no US entity [Verify]; cross-border Stripe Connect [Verify] |
| 3 | Paid EUR track (France border region first, then DE/AT) | Signed Q2 2028 (early 2028 on a strong pilot), live Sep 2028 / 2029 | ≥10 paying Swiss clubs, gross margin ≥75%, SEPA live, EU VAT set up, GDPR Art. 27 representative, FR + DE complete |
| 4 | Paid US sales | Not before H2 2029 / 2030 | ≥40 clubs, ≥CHF 25k MRR, NRR ≥100% for 12 months, seed closed, the 2027 design partner (or another) paying and a named channel, COPPA and sales-tax review |
| 5 | Broad white-label resale | 2029 at the earliest / 2030+ | ≥25 clubs on one codebase, external pen test passed, tenant-isolation tests in CI, a support SLA the company can staff |

**Why the founder's ambition and this sequence diverge.** The goal of a global, any-sport, white-label SaaS sold in Switzerland, the EU and the USA is a sound ten-year destination. As a 2027 launch it would fail. The only proven advantages (TWINT and QR-bill economics, French coverage, the Romandie network) do not travel to the US; the US is held by consolidating, well-funded incumbents with free tiers and channels; one founder cannot sell in three legal systems and two time zones; and the company has well under CHF 100k of committed money. The platform is built multi-tenant now so none of this needs a rewrite later. The two free pilots are the honest compromise with the founder's wish for a 2027 EU and US presence: one design partner each, behind entry conditions, used as case studies. They go live in the Swiss peak (Sep–Oct 2027) and cost about CHF 15–30k and 150–250 founder and CTO hours [Est.], none of it in the workbook.

---

# 06 Product and technology [Updated Nov 2026]

## 6.1 Canonical beta scope [Updated Nov 2026]

The twelve-feature list from August is kept. What changes is its status and the dates.

| # | Feature | Status 11 Nov 2026 | Due (base) |
|---|---|---|---|
| 1 | Multi-role auth and RBAC (admin, finance, coach, parent; athlete later) | Built. Users can belong to only one club (`profiles.org_id`); fix before club #2 | Q1 2027 |
| 2 | Club setup and branding | Built (runtime theming) | — |
| 3 | Athletes, families, teams, **CSV import with mapping preview** | Built except import (export only) | **28 Feb 2027** |
| 4 | Camp and programme registration with public link | Built | — |
| 5 | **TWINT**, card and QR-bill with reconciliation | Card and QR-bill work; TWINT a manual label; no per-club accounts | **TWINT on DLang 18 Dec 2026**; per-club Connect 28 Feb 2027 |
| 6 | Admin dashboard with live KPIs | Built | — |
| 7 | Coach attendance, **offline-tolerant** | Online only | **28 Feb 2027** |
| 8 | Schedule and sessions | Built | — |
| 9 | Broadcasts and 1:1 messaging | Built | — |
| 10 | Automated 7- and 14-day reminders | Built; multilingual depends on #11 | With #11 |
| 11 | **Multilingual UI** (FR first, then DE, EN; IT later) | No translation layer | **28 Feb 2027** (FR/EN parent and invoice flows first) |
| 12 | Parent PWA with digital consents | Built | — |

**Explicitly out of the beta:** native apps, any parent- or athlete-facing AI feature, video, tournaments, federation management, a public API, a website builder, recurring memberships, sibling-discount rules, waitlists, two-way calendar sync, the athlete role. The staff-facing AI assistant that exists in the code is **off unless a club admin switches it on** (opt-in per club, founder decision 12 Nov 2026; see 6.4).

> **TWO BUILD GATES, RE-DATED**
>
> **Gate 2, the money gate: 18 Dec 2026 (red line 31 Dec, downside 31
> Jan 2027).** A real DLang parent pays a real invoice by TWINT and it
> reconciles automatically; at least 10 real payments reconciled with
> zero manual steps; failure and duplicate cases tested. If missed:
> run the founding beta manually and keep payments as the only
> engineering priority.
>
> **Gate 3, the adoption gate: DLang runs one full cycle by 14 Feb
> 2027 (downside 31 Mar).** Gate 3b: club #1 using it weekly by 30 Apr
> (downside 30 Jun 2027). If missed: freeze features, spend the next
> cycle on adoption and stability.

## 6.2 Architecture and technical posture [Updated Nov 2026]

| Layer | Decision | Change from August |
|---|---|---|
| Client | PWA, not native, through 2027. Native decision in Q1 2028 only on measured push/retention data. | Date added |
| Application | Next.js 15 / React 19 / TypeScript. No rewrite. | — |
| Data and tenancy | Postgres via Supabase, `org_id` and forced RLS on every tenant table, one shared schema, one EU/CH region. Before club #2: multi-club membership and cross-tenant tests in CI. Separate EU/US regions not before H2 2029. | Detailed |
| Payments | **Stripe Connect, one account per club, direct charges plus application fee.** TWINT via Stripe. QR-bill generated natively. Payrexx fallback. | Changed from "Payrexx for beta" |
| QR-bill | Implementation Guidelines v2.4 (in force 14 Nov 2026), structured addresses required. Bank-accepted test bills by 27 Nov. | Re-checked |
| Hosting | Swiss or EU region | — |
| Offline | Service worker plus local queue for coach attendance, visible "saved locally" state | Not yet built |
| Delivery *(new)* | Trunk-based, CI gates (type-check, build, RLS tests), per-tenant feature flags, forward-only migrations, weekly release, freezes over Christmas, camp weeks and late August | New |
| AI-assisted engineering *(new)* | AI coding agents write and review code; a human approves every merge; a second person approves migrations, RLS, payments, auth and AI changes; agents never hold production credentials | New |
| Integrations *(new)* | CSV and bank-file matching first; Bexio and J+S export in 2027; DATEV with the EUR track; QuickBooks/Xero/Clever only after the US gate | New |

## 6.3 Security and compliance: the non-negotiable list [Updated Nov 2026]

The August control list is kept in full: record of processing activities, a DPIA covering minors' and health data and any AI processing, a DPA with every club, immutable consent records, data export and erasure, a breach procedure, an independent security review, one written under-16 access rule, and cyber and professional indemnity insurance. What v2 adds is dates:

| Control | Due (base) |
|---|---|
| Compliance pack (ROPA, DPIA, DPA template, privacy notice FR/DE/EN, breach procedure) drafted | 16 Dec 2026 |
| Compliance pack signed off by a data-protection lawyer [Verify] | 15 Jan 2027 |
| External security review booked / done, zero open critical or high | 4 Dec 2026 / 31 Jan 2027 |
| Cyber and professional liability insurance bound | 31 Jan 2027 |
| Status page, shared support mailbox, ticket log | 4 Dec 2026 |
| Controls aligned to ISO 27001 (no certification) | During 2027 |
| SOC 2 Type II or ISO certification | Only when a contract requires it, 2029 at the earliest |

Language rule unchanged: "nFADP-aligned by design, with Swiss data residency; independent review completed [date]" — never "compliant" until an independent party says so.

## 6.4 The AI roadmap, and what to say about it [Updated Nov 2026]

August scheduled the admin assistant ("Max") for "once 15+ clubs are live" and the paid AI module from Month 13. *[Updated 12 Nov 2026]* The founder wants the assistant available to clubs as soon as it is fully functional. So: **opt-in per club** (a club admin switches it on); **DLang beta first, Q1 2027**; then the founding clubs once written acceptance criteria are met (base Q2 2027). Guardrails: tenant-scoped context only; minimal personal data, with an allow-list that never sends minors' medical data, dates of birth or coach notes to an external model; no training on tenant data; the AI provider listed as a sub-processor in the DPA; a DPIA addendum signed off before any club switches it on; staff-only access. Pricing: **included in the Club tier and above for now** *[Confirm]*; the CHF 90 add-on is parked. The parent assistant ("Lina") ships first as a logged human 1:1 thread. The coach and athlete assistants stay in Year 2+ and, for athletes, only after a safeguarding review. The three August rules (no AI message auto-sent to a parent, no identifiable data to an external model without minimisation, anything on health or welfare escalates to a human) are kept.

---

# 07 Go to market [Updated Nov 2026]

## 7.1 Ideal customer profile (unchanged)

Private academy, camp operator, ski or football academy, international-school sports programme or multi-sport club with a paid coordinator; 100–300 active athletes; at least one paid administrator; Vaud, Geneva, Valais first; currently on WhatsApp plus spreadsheet plus paper plus bank; **not** covered by a federation software deal; a trigger event (lost treasurer, missed camp payments, new programme). Audit order for the first ten: private academies and camp operators first, international schools third.

## 7.2 The sales motion [Updated Nov 2026]

The five stages are kept (reach → workflow audit → demo against their numbers → proposal and committee → close and onboard). What changes is the clock.

| Item | August | v2 | Why |
|---|---|---|---|
| Sales cycle | 21 days | **45–90 days** (21 only as best case) | Committees decide, often at the spring AGM |
| Founder hours per closed club | 22 in the model, 31 in the plan | **31** | The plan's own figure |
| Concurrent onboardings | Not capped | **At most 2 at once** in 2027 | 8–10 founder hours each |
| Audits needed | 10 | **About 37 qualified audits in Year 1** for 11 signings at 30% conversion | Funnel check in v2 model |

**The Swiss club calendar now governs everything.** Clubs are effectively closed about 21 December to 4 January. Committees decide January to April. Summer-camp registration opens around March. Season registration peaks June to September, and nobody migrates during the peak unless set up by **31 May**. So: sign in January–April, go live for summer camps and the 2027/28 season, and expect **Q3–Q4 2027 to be the first real wave**.

**The four objections, one answer revised.** "Spond is free": correct, and for scheduling and messaging alone Spond is the right answer. Then run their numbers on the payment line only: CHF 1,575 a year in card fees on CHF 63,000 against roughly 693 through DLANG with QR-bill free. The rest of the gap to CHF 490/month must come from hours and write-offs recovered, in their audited numbers. If it does not reach 3×, walk away. The other three answers ("we already use ClubDesk/a federation tool", "CHF 490 is too much", "why trust a startup?") are unchanged.

## 7.3 Channels, ranked by expected value [Updated Nov 2026]

| Channel | Expected clubs to Nov 2027 | Assessment |
|---|---|---|
| Founder warm network (Romandie) | 5–7 | The founder claims warm access to 30+ Geneva-region clubs *[founder]*. Still the whole of Year 1. |
| Camp and academy operator networks | 2–3 | The segment nobody defends. |
| Reference-customer referral | 1–2 | Switch on only after two measured case studies (base Q3 2027). One month free for the club; 15% of first-year revenue for non-club referrers. |
| International schools | 0–1 | Higher value, slower; from H2 2027. |
| Federation partnership | 0 | Relationships and validation only (Swiss Basketball via DLang first). Pilot H2 2028. |
| Paid acquisition | 0 | None before a seed. |

**Partner programme (new, gated, all margins are estimates):** referral partners (2027); implementation partners keeping the onboarding fee plus 20% recurring for 24 months (2028); white-label resellers at 30/35/40% off list (2029+); federations at about 20% off list per club *[founder]*. Payment, legal and security texts always stay under DLANG's control, and each club keeps the right to export its data.

## 7.4 The Strikefirst founding programme, revised again [Updated Nov 2026]

August's four changes are kept (CHF 290 vs 490 anchor; 24 months founder access; AI "free for 24 months from the date each module ships"; hard cap at five). v2 adds: **no free pilots in Switzerland** (confirmed 12 Nov 2026; exceptions: one free EU and one free US design partner, 5.5); up to five additional paid design pilots at list price; slots close 30 September 2027; founding addendum includes the tier cap and is reviewed by a lawyer; DPA signed before any data import; selection criteria, 30/60/90-day reviews and exit tests as in `02_GO_TO_MARKET.md`. Re-dated targets: **first founding club signed 31 January 2027** (downside 31 March), **3 paying clubs by May 2027** (downside August), **5 founding clubs by June 2027** (downside September).

## 7.5 Federation strategy, now the 2028 bet [Updated Nov 2026]

The five steps are kept and pushed back one season: identify two or three cantonal or regional associations (Q1–Q2 2027, no cost); get one member club live and measurably better (H2 2027); offer an aggregate dashboard in exchange for introductions (H1 2028); structure a group agreement at about 20% off list with federation branding (pilot H2 2028, downside 2029); J+S reporting only after validating the gap with clubs (2028–2029).

---

# 08 Operations [Updated Nov 2026]

## 8.1 Onboarding: the function that decides retention [Updated Nov 2026]

The 30-day assisted onboarding from August is kept (setup → import → first programme → **first real payment = the gate** → coach training → parent announcement → first reminder cycle and a written before-and-after). A club is not onboarded until real money has moved. Signature to first registration within 14 days is still the main churn predictor.

What changes:

- **Three tracks, only one sold in 2027.** Assisted (about 2 weeks, 8–10 founder hours, falling to 6 or fewer by club 15). Self-serve (one day of setup) opens Q1 2028 (downside Q3 2028), once CSV import, Stripe Connect onboarding, an in-product checklist and a help centre exist and 10 assisted clubs are done. Enterprise (about 6 weeks, from CHF 5,000) starts with the federation or multi-site pilot.
- **Stripe Connect identity checks start before day 0**, because they take time; QR-bill-only is the fallback if they slip.
- **Productise before club #3, not club #6.** Club six now lands in the July–September peak. The onboarding kit (checklist, import template, French videos for admins, coaches and parents) is built **February–May 2027**.
- **Calendar rules:** no new migrations June–September; no go-lives 15 December – 6 January.

## 8.2 Support model [Updated Nov 2026]

| Tier | Channel | Target first response | Coverage |
|---|---|---|---|
| Founding clubs | Direct line to founder, logged as tickets | 4 business hours | Mon–Sat, Swiss business hours, for 24 months |
| Academy | Priority email and phone | 4 business hours | Business hours |
| Club | Email | 1 business day | Business hours |
| Starter | Email and in-product help | 2 business days | Business hours |
| All tiers: payment failure or data incident | Any channel | Same day, every day | Including weekends |

New rules: no data about minors in WhatsApp chats; P1-only cover with a named backup 24 December – 2 January; no founder leave June–September; no "24/7" claim anywhere. Tooling: shared mailbox, ticket log and status page by 4 December 2026; a helpdesk tool from Q4 2027. Help centre wave 1 (about 20 articles, FR and EN) by 31 March 2027; German only once the first German-speaking club is in the pipeline.

## 8.3 Operating rhythm [Updated Nov 2026]

Kept from August, with three changes: a **Monday weekly metrics review** against a one-sheet scorecard (cash and runway base/downside; MRR and clubs; pipeline by stage; DLang CHF outstanding, % paid within 7 days, admin hours; payments auto-reconciled; weekly active admins per club; onboarding days; open security findings; founder hours by category); a **monthly investor/advisor update** sent by the 5th; and **seasonal freezes** (21 December – 4 January; no risky releases June–September). A six-part health score (money flowing 30, admin activity 20, coaches 15, parents 15, programmes 10, relationship 10) starts as a manual sheet in February 2027.

---

# 09 Organisation and people [Updated Nov 2026]

## 9.1 The concentration problem (dates moved)

| Founder role | Hand over when | To whom | Cost (CHF) |
|---|---|---|---|
| Engineering | Now; fractional CTO signed **15 Dec 2026** | Named human fractional CTO leading the AI agent team; paid senior reviewer as cover until then | Within the engineering line; reviewer 2–4k/month |
| Onboarding delivery | ~Club 10; **Jan 2028** (downside Jun 2028) | Part-time customer success lead (50%) | ~2.9k/month + charges |
| First-line support | Same | Same person, plus in-product help | Included |
| Sales qualification | ~Club 25; Q4 2028 | Part-time SDR | 2–3k/month |
| Bookkeeping, payroll, VAT | On incorporation | Swiss fiduciary | 250–400/month |
| Legal, data protection | Now | Hourly startup lawyer; external DPO as needed | ~20–45k in year one [Est.] |
| **Product direction and closing** | **Never in this plan** | **Founder** | **This is the job** |

## 9.2 The technical partner decision is the financing plan [Updated Nov 2026]

August's logic stands: engineering is the largest cost line, and a partner on equity is worth more than the round. Three months on, two facts change the plan.

1. **The search has run past its own deadline.** August said: if no co-founder by end of Month 4, switch to the contractor model. Month 4 is December 2026. The CTO proposal (Structure A: 20% granted before the round, 4-year vesting with a 1-year cliff, retainer CHF 1,200 / 4,000 / 7,000 a month by year plus 25% / 20% / 15% of onboarding fees, 5-week paid trial at CHF 9–11k with the TWINT reconciliation as the deliverable) is a good structure. But CHF 1,200 a month for four to five days a week will make the search long.
2. **There is now a credible alternative.** The founder plus AI coding agents, with a paid Swiss-rate senior reviewer for 4–8 hours a week who approves every sensitive change, can carry the 2027 roadmap if scope holds.

**Founder decision, 12 November 2026.** No CTO is confirmed. The founder asked whether an AI agent could be the CTO. The answer (`docs/company/12_CTO_SOLUTION_AI_PLUS_HUMAN.md`): AI agents do the engineering, but a **named human fractional CTO** is needed to be accountable for architecture, security sign-off, payment, RLS and migration approvals, and investor and customer diligence. The founder adopted the **fractional CTO + AI agent team** model and defers the structure (retainer, equity, decision rights) to the CTO, who proposes it by **8 January 2027**. Target **signed by 15 December 2026** (latest 31 January 2027); the senior reviewer is pre-contracted by 16 December as cover. Because the investor releases the EUR 50k only once a CTO is in place, **this hire is on the critical path for cash**. Any CTO equity goes into the one cap table shown to the investor.

## 9.3 Headcount plan [Updated Nov 2026]

| | Year 1 (to Nov-27) | Year 2 (to Nov-28) | Year 3 (to Nov-29) |
|---|---|---|---|
| Founder / CEO | 1.0 (CHF 2.5k/month + charges) | 1.0 (lean plan 3.5k) | 1.0 (lean plan 5k) |
| Engineering | Fractional CTO + AI agents (+ reviewer as cover) (~4.8k/month + 10k trial) | Same, lean plan ~6k/month | Same, lean plan ~8k/month; first salaried engineer Q1 2029 only after a seed (CHF 125–155k + ~17% charges) |
| Customer success | Founder | 0.5 FTE from Jan 2028 | 0.5–1.0 FTE |
| Sales | Founder | Founder + referrals | Part-time SDR from ~club 25 |
| Finance and admin | Fiduciary | Fiduciary | Fiduciary |
| **Operating cost run-rate / month (excl. one-offs)** | **~10.8k** | **~20.8k** | **~28.3k** |

Planning assumptions [Verify with fiduciary]: employer charges about 15–17% on gross; standard notice periods (CO Art. 335c) giving 3–5 months from opening a role to a start; nobody starts in customer success between 15 June and 15 September; no EU hire before the EUR gate (Employer-of-Record if needed); no US hire before 2030 and only once the US gate opens. Stage 1 (5–8 people, 3–5 FTE) is built across 2027–2029; Stage 2 (15–25) is 2030 at the earliest.

## 9.4 Advisors: three seats worth filling (unchanged)

A Swiss startup lawyer on an hourly basis (the convertible's conversion-price clause, the IP assignment and the fund-holding question are now the three highest-return hours); a club or federation insider who is not a customer (0.25–0.5% over two years); a SaaS operator who has sold to European SMBs.

---

# 10 Legal, tax and structure [Updated Nov 2026]

## 10.1 Entity and canton (decision unchanged, dates moved)

*[Updated 12 Nov 2026]* The company is **Swiss Preparatory Sports Academy GmbH (SPSA)**, a GmbH in Canton de Vaud *[Confirm register number and date]*; no holding company, no EU or US entity (none needed for the free EU and US pilots [Verify]). Because SPSA also runs the academy, ring-fence the software business ("SPSA Tech" account, cost centre, internal agreement) and take advice by 15 December 2026 on carving it into its own company before the seed [Verify]. Convert to an AG before the first employee equity grant or the seed (about Q4 2028 – Q1 2029), with a Vaud tax ruling. A Delaware subsidiary only at the US gate (H2 2029 at the earliest); a "flip" to a US parent only if a US lead investor requires it. Incorporation still does not shield the founder from personal nFADP penalties.

## 10.2 Payments and anti-money-laundering (new)

The current single-Stripe-account design means DLANG would receive club money, which risks making it a financial intermediary. Stripe Connect direct charges into each club's own account (or a Payrexx account per club), with DLANG taking only an application fee, is designed to avoid that. The founder accepted Stripe Connect on 12 November 2026; DLang connects first. A **written legal view** (requested 27 November, due 15 January 2027) is required before the first external club, including how SPSA can be both the platform and DLang's account [Verify]; if counsel disagrees, the first clubs run on QR-bill into their own bank accounts.

## 10.3 Tax and VAT [Updated Nov 2026]

| Item | Position | Action |
|---|---|---|
| Swiss VAT | 8.1%; CHF 100k threshold now likely crossed in **late 2028**, not Year 2 of the old model | Fiduciary decides on voluntary registration by **31 March 2027** [Verify] |
| Club VAT position | Most clubs cannot reclaim | Quote ex-VAT, show the inclusive figure in every proposal |
| Application fees on payments | Treatment to confirm | Ask the fiduciary [Verify] |
| EU (at the EUR gate, Q2 2028 or 2029) | Non-Union OSS for non-registered clubs, reverse charge for registered businesses; GDPR Art. 27 representative | Set up before the first EU invoice [Verify] |
| US (not before H2 2029) | State sales-tax nexus; COPPA | Study at the US gate [Verify] |

## 10.4 Intellectual property [Updated Nov 2026]

By **31 December 2026**, before the convertible closes: **present assignment** of all code, designs and brand from the founder, SIDIS and every contractor to the GmbH; a contractor IP template for all future work; a note on the uncertain ownership of AI-assisted code; a one-off open-source licence scan. **Trademark:** CH / EU / US trademark and domain check on the founder's candidate "Global Sport OS" and 2–3 alternatives by 15 January 2027 (generic names are hard to register; "DLang" is already used by the D programming language), naming decision 15 February, Swiss filing by 28 February 2027, extended to the EU and US through the Madrid system only at their market gates.

## 10.5 Contract set required before club #1 [Updated Nov 2026]

| Document | Due |
|---|---|
| Subscription agreement / terms | 15 Jan 2027 |
| Founding-club addendum (lifetime price capped at tier, 24-month founder access, roadmap vote, 60-day refund) | 15 Jan 2027 |
| Data processing agreement and sub-processor list | 15 Jan 2027 |
| Parent-facing privacy notice FR / DE / EN | 15 Jan 2027 |
| Internal agreement for DLang as customer zero inside SPSA (or an academy-to-tech-company agreement after any carve-out), at arm's length | 31 Jan 2027 |
| Convertible loan agreement (release on CTO in place; any CTO equity disclosed) and Jan–Mar bridge papers | Bridge 15 Dec 2026; convertible 31 Jan 2027 |
| CTO / contractor agreements with IP assignment and vesting | Before any equity or retainer |
| Reseller / white-label agreement | Deferred to 2029+ |

Insurance: cyber and professional liability bound by 31 January 2027; D&O at the seed. Legal budget about CHF 20–45k in the first year [Est.], now in the model as one-offs.

---

# 11 Financial plan [Updated Nov 2026]

Full model: `DLANG_Sports_OS_Financial_Model_v2.xlsx` (a copy of the August workbook; all original sheets kept, plus Changes_v2 with 93 logged changes and Timeline_v2 with 25 milestones). Base case unless stated. All figures CHF. Model year 1 = December 2026 to November 2027.

## 11.1 Three-year summary [Updated Nov 2026]

| | Year 1 | Year 2 | Year 3 |
|---|---|---|---|
| New clubs signed (base) | 11 | 19 | 27 |
| **Clubs at year end** | **10** | **26** | **45** |
| Total revenue | 18,200 | 89,900 | 201,100 |
| **EBITDA** | **(143,500)** | **(182,300)** | **(186,500)** |
| Average monthly burn | 12,000 | 15,200 | 15,500 |
| **ARR at year end** | **39,600** | **117,100** | **238,500** |
| CHF 10k MRR reached | | Dec 2028 | |
| *Plan of record (lean, AI in Club tier, FIT 0%, round Mar 2027):* EBITDA | (143,500) | (131,600) | (116,700) |

**What drives the change from August.** Signings start in February 2027 and follow the season (none in December or July; peaks March–June and August–October), 57 over three years instead of 138. Churn is 1.8% a month (month-to-month terms, treasurer turnover at season change). Founding clubs stay at CHF 290 for life. Payment margin is 0.2%, not 0.9%. AI revenue starts in Year 3. Employer social charges, dated hires and one-off costs (CTO trial 10k, security review 10k, company setup 3k, compliance pack 2.5k, EU entry 6k, second pen test 10k) are now in.

**Read the shape.** August's plan described a business that turns profitable in July 2028 on EUR 50k. v2 describes a business that is **slow to scale and default-dead until about 75 clubs unless costs stay lean**. That is not a bad business; it is a business that needs either discipline (founder plus agents plus reviewer, about CHF 20k a month total, until about 30 clubs) or a seed raised on evidence of 25+ clubs and churn below 2% a month. Probably both.

## 11.2 Unit economics [Updated Nov 2026]

| Metric | v2 | August | Comment |
|---|---|---|---|
| ARPA, public clubs | 350 / 400 / 440 by year | 330 / 400 / 450 (all clubs) | Founding clubs fixed at 290 |
| Average onboarding fee | 750 | 900 | Starter-heavy early mix |
| Support cost per club per month | 65 | 55 | First-cohort hand-holding |
| Gross profit per club per month | 334 | 372 | |
| Gross margin | 80% | 83% | Support, not infrastructure, sets it |
| Monthly churn (base / bull / bear) | 1.8% / 1.2% / 2.5% | 1.5% / 1.0% / 2.5% | Modelled, not measured |
| Bottom-up CAC (31 founder hours at CHF 60 + onboarding + travel) | 2,580 (1,830 net of fee) | — | |
| Fully loaded CAC | 3,545 | 1,376 | |
| LTV (gross profit, 48-month cap) | 16,000 | 17,862 | |
| **LTV / CAC** | **4.5×** | 13.0× | Credible, not flattering |
| **CAC payback** | **10.6 months** | 3.7 months | Target: within 12 months |

No LTV/CAC figure is to be quoted externally before 10 paying clubs exist; until then quote the targets (payback within 12 months, churn at or below 1.5–1.8% a month).

## 11.3 Scenarios [Updated Nov 2026]

| | Downside (Bear) | Base | Upside (Bull) |
|---|---|---|---|
| What happens | Gate 2 slips to January; Gate 1 to March; free alternatives hold; round lands April (CTO late); no FIT grant | Gates met at base dates; 5 founding clubs by June 2027; 10 by October 2027; no federation deal before 2028 | Faster audits-to-signature; referrals compound in Romandie; earlier customer-success hire |
| Gross clubs signed over 3 years | 36 | 57 | 101 |
| Monthly churn | 2.5% | 1.8% | 1.2% |
| Clubs, Nov 2029 | 27 | 45 | 87 |
| ARR, Nov 2029 | 136,400 | 238,500 | 465,300 |
| Lowest cash (before new funding) | –547.8k | –440.8k | –237.0k |
| First profitable month | 2032 or later | ~Q4 2030 (lean costs: ~mid-2030) | Aug 2029 |
| Implication | A slow, founder-led business. No stop rule (founder, 12 Nov 2026): a missed gate triggers a structured strategy review of pricing, segment, channel and offer (13.2). | A fundable Swiss vertical SaaS only with a seed in Q1 2029 | The deck's direction, still below its numbers |

Our odds [Est.]: 10 Swiss clubs by end-2027, **50–60%**; a fundable Swiss vertical SaaS by 2029, **35–45%**; the deck's 150 clubs / EUR 808k on its timeline, **under 15%**. The deciding factors are money moving end to end, willingness to pay at CHF 290–490, and founder capacity and cash.

## 11.4 The capital plan, stated plainly [Updated Nov 2026]

| Source | Amount CHF | Timing (base) | Confidence |
|---|---|---|---|
| Founder funds / academy cash | 15,000 *[founder; update with actual cash at 30 Nov]* | Dec 2026 | Founder-controlled |
| Convertible, first close (EUR 50k) | ~46,500 | **Secured**; released once a CTO is in place: Feb 2027 in the workbook base, **Mar 2027** in the founder-facts case (downside Apr) | Founder, 12 Nov |
| FIT Digital Grant | 20,000 at **0%** = 0 (workbook base still carries 50%) | Not filed; next intake *[Verify]* | Not filed (founder, 12 Nov); eligibility may be blocked by the company-age rule |
| **Secured stack** | **~61,500** | | Founder 15k + EUR 50k; workbook base models 71.5k incl. FIT at 50% |
| Cash low before the round lands | –17.5k in Jan 2027 (workbook base); **–43.5k in Feb 2027** (founder-facts case) | | CTO trial + compliance pack + pen test |
| **Jan–Mar 2027 bridge** | **~45,000** | Agreed by 15 Dec 2026 | Founder funds, investor advance, or deferred costs *[Confirm]* |
| **Cash negative for good** | **from Apr 2027** (workbook base); **from Jan 2027** (founder-facts case and downside) | | |
| EU/US free pilots (2027) | ~22,500 [Est.] | May–Oct 2027 | In workbook v2.1 (12 Nov); not in the figures above |
| Need to Nov 2027 incl. buffer | ~110,000 (base); ~120,000 (founder-facts); ~145,000 (v2.1 plan of record incl. pilots) | Pre-seed CHF 250–300k in total incl. the EUR 50k, cash in by Apr 2027 at the latest | |
| Need to Nov 2028 incl. buffer | ~300,000 (base); ~260,000 on the lean plan of record; ~270,000 (v2.1 incl. pilots) | Same pre-seed, H1 2027 | |
| Need to Nov 2029 incl. buffer | ~490,000 | Seed CHF 400–500k in Q1 2029, raised from Q3 2028 | |

**Ways to close the gap, in order of preference (revised):**

0. **Sign the fractional CTO (15 Dec 2026) and bridge January–March 2027 (about CHF 45k).** These are the top two cash actions: the first releases the EUR 50k, the second carries cash until it lands.
1. **Stay lean and buy hours, not people** (accepted by the founder on 12 Nov 2026). Founder pay and engineering capped; fractional CTO plus AI agents; no salaried hires before a seed. This alone moves the base trough from about –441k to about –314k.
2. **Make the H1 2027 round the right size.** One pre-seed of about CHF 250–300k in total, including the EUR 50k, is cheaper and simpler than a series of small bridges.
3. **Win non-dilutive money, counted at zero until it arrives.** >>venture>> (submitting by 30 November 2026), FIT Digital (pack being prepared; eligibility to check), GENILEM coaching. Still avoid Venture Kick, Innosuisse coaching, EIC Accelerator and SICTIC for the August reasons.
4. **Sell with onboarding fees and annual prepay.** Ten public clubs at CHF 490 with a CHF 750–1,500 setup fee are worth more than any grant on the list.

In the founder-facts case the January–March gap is about CHF 45k: fund it personally, ask the investor for an advance against the CTO signature, or move the CTO trial and pen-test costs later.

## 11.5 The round structure (largely unchanged)

Subordinated convertible loan; principal in CHF (fix the FX at signing); cap stated **post-money**; discount 15–20%, never above 33.3%; interest 0–2% accrued and converted; maturity 18–24 months or a qualified round; mandatory subordination (Art. 725 CO); conversion-price definition word for word, reviewed by a Swiss lawyer; no SAFE. Signed 31 January 2027, after the GmbH and IP assignment, with the CTO grant disclosed.

**Ownership [Updated 12 Nov 2026].** There are two cap tables in circulation. The founder decided on **one working cap table now**, refined with the CTO and advisors by **3 January 2027**. With a fractional CTO, Structure A's 20% grant is no longer the default.

| Holder | Plan/model (no CTO grant): after round → pool → seed | CTO proposal Structure A: after grant, round and pool |
|---|---|---|
| Founder | 90% → 81% → 72% | 64.8% |
| CTO partner | — | 16.2% |
| Strategic investor | 10% → 9% → 8% | 9% |
| Option pool | — → 10% → 9% | 10% |
| Seed investor | — → — → 11% | — |

The investor buys into whichever is true; show it before signing. Note that the CTO proposal's 4× ARR valuation logic ignores the dilution a seed round would bring.

---

# 12 Risk register [Updated Nov 2026]

| # | Risk | L | I | Trigger to watch | Decided response |
|---|---|---|---|---|---|
| R1 | **Payment rail slips** (TWINT/Connect activation, reconciliation bugs) *(new, top)* | H | Critical | Not live on DLang by 31 Dec 2026 | Payments are the only engineering priority; manual beta; Payrexx fallback |
| R2 | **Willingness to pay does not exist at CHF 290–490** | M–H | Critical | <6 of 10 audits at 3× by 31 Jan 2027 | Fallback price card (low subscription + fee on programme/camp value), ready 15 Dec |
| R3 | **Founder capacity** | H | Critical | >2 concurrent onboardings, or two weeks with nothing shipped | Hours-based capacity; productised onboarding Feb–May 2027; June–September freeze |
| R4 | **Cash runs out** (founder-facts case: from January 2027; EUR 50k only after a CTO is in place) | H | Critical | Bridge not agreed by 15 Dec 2026; downside runway < 6 months | Sign the CTO; Jan–Mar bridge ~CHF 45k; pre-seed CHF 250–300k in H1 2027; lean-cost plan; grant at zero until paid |
| R5 | **Data breach or tenant leak of minors' data** | L–M | Critical | Any unauthorised access or critical finding | RLS tests in CI; review by 31 Jan; second approver on sensitive changes; DPIA; insurance |
| R6 | **Fund-holding / AML exposure** *(new)* | M | High | No legal view by 15 Jan 2027 | Connect direct charges only; QR-bill to club accounts as fallback |
| R7 | **Churn above 2.5% a month** | M | High | Any club two weeks without an admin login | Stop acquisition; sit with the club |
| R8 | **Spond or Paak closes the gap** | M | High | Paak ships AI; Spond adds TWINT/QR-bill | Lead with programme and camp commerce, not the rail |
| R9 | **Fractional CTO search drags** (now delays the EUR 50k) *(updated)* | H | High | No signed CTO by 15 Dec 2026 | Shortlist 30 Nov; reviewer cover from 16 Dec; latest 31 Jan 2027 |
| R10 | **Scope creep toward the global vision** (AI, native, pilots growing into launches, resale) *(updated)* | H | Medium | Any non-gate feature before 28 Feb 2027; custom pilot requests | Gates in 5.5; one free pilot per market with written scope; AI opt-in with guardrails; one codebase |
| R11 | **IP / cap-table inconsistency blocks investment** *(new)* | M | High | Before the EUR 50k is released | IP present assignment to SPSA by 31 Dec; one working cap table |
| R12 | **Seasonal timing missed** *(new)* | M | M–H | Fewer than 2 clubs signed by 30 April 2027 | Signing window Jan–Apr; set-up deadline 31 May |
| R13 | **A public claim is challenged** | M | High | Any prospect questions a figure | Claim audit by 4 Dec 2026 |
| R14 | **Federation lock-out** | M | M | Target says its association provides a system | Route to the 2028 federation strategy |
| R15 | **FX on a EUR round** | M | L | EUR/CHF moves >3% before transfer | Fix the rate in the loan agreement |
| R16 | **Key-person dependency on the reference customer** | L | M | Academy circumstances change | Second reference club measured by Q3 2027 |
| R17 | **Academy and software in one entity (SPSA)** *(new, 12 Nov)* | M | High | Investor, Stripe or a prospect club raises it | Ring-fence now; carve-out view by 15 Dec 2026; carve-out before the seed at the latest [Verify] |
| R18 | **2027 pilots stretch capacity and cash** *(new, 12 Nov)* | M–H | Medium | Swiss KPIs red on 31 Aug 2027; pre-seed not in | Entry conditions; go/no-go 30 Jun 2027; fall back to the downside dates |
| R19 | **Weak trademark for a generic name** *(new, 12 Nov)* | M | Low–M | Check on 15 Jan 2027 negative | 2–3 alternatives shortlisted; DLANG Sports OS stays the working name |

---

# 13 Milestones and governance [Updated Nov 2026]

## 13.1 The twelve-month milestone map (re-baselined from 16 November 2026)

| Month | Milestone (base) | Downside | Evidence | If missed |
|---|---|---|---|---|
| **Nov 2026** | Founder decisions (12 Nov). Truth week and retrospective (20 Nov; SPSA register details). Stripe Connect application for DLang + legal view requested (27 Nov). FIT intake and eligibility checked (27 Nov). Fractional CTO shortlist (30 Nov). >>venture>> submitted (30 Nov). | — | Status sheet; Connect application; submission receipt | Nothing else proceeds until status is known |
| **Dec 2026** | Deck and claims fixed (4 Dec). Security review booked (4 Dec). DLang winter-camp pilot (13 Dec). **Fractional CTO signed (15 Dec)**; **Jan–Mar bridge agreed (15 Dec)**; carve-out view (15 Dec). Fallback price card (15 Dec). **Gate 2: TWINT reconciles on DLang (18 Dec)**. IP assigned to SPSA (31 Dec). | Gate 2 31 Jan; CTO 31 Jan | Reconciled real payments; signed CTO | Manual beta; payments only priority |
| **Jan 2027** | Model refresh (3 Jan; workbook v2.1, on the plan of record since 12 Nov, refreshed with actuals). CTO's structure proposal (8 Jan). Compliance pack incl. AI DPIA addendum signed off (15 Jan). Trademark and domain check (15 Jan). DLang spring invoicing on platform. **Gate 1 (31 Jan)**, **first founding club signed (31 Jan)**, security review done, insurance bound, **convertible signed (31 Jan)**. | Gate 1 15 Mar; first club 31 Mar; round Apr | Signed addendum + DPA; audit write-ups | Strategy review (13.2); fallback price card |
| **Feb 2027** | **Gate 3: DLang full cycle (14 Feb)**. Naming decision (15 Feb). AI assistant opt-in beta on DLang. Four missing beta items shipped (28 Feb). Trademark filing (28 Feb). Pre-seed signed (28 Feb). | Gate 3 31 Mar | DLang cycle with <5% manual matching | Freeze features; adoption cycle |
| **Mar 2027** | **EUR 50k released** (founder-facts case). DLang case study published (31 Mar). VAT decision (31 Mar). Help centre wave 1. EU and US design-partner shortlists (31 Mar). First strategy-review checkpoint (31 Mar). | Case study 30 Apr | Signed case study with measured numbers | Sales stay theoretical |
| **Apr 2027** | **Gate 3b: club #1 weekly (30 Apr)**. Public launch "Season 2027/28 ready" (Apr–May). Pre-seed cash in (latest). | 30 Jun | Usage data | Freeze acquisition |
| **May 2027** | **3 paying clubs**. All 2027 clubs set up by 31 May. Onboarding kit complete. | Aug 2027 | Invoices paid | Clubs wait a season |
| **Jun 2027** | **5 founding clubs**. Peak season: no migrations, no risky releases. **Pilot go/no-go (30 Jun)**, EU and US. | Sep 2027 | 5 signed addenda; pilot decision memo | Close the cohort at what exists by 30 Sep |
| **Jul–Aug 2027** | DLang summer camps and 2027/28 registration on platform. Referral programme on (after 2 case studies). | — | DLang season live | — |
| **Sep 2027** | **DLang runs the whole club.** Founding slots close (30 Sep). First list-price clubs signed. **Free EU pilot live; free US pilot live Sep–Oct.** Customer-success recruiting opens. | Oct 2027; pilots Jan / Mar 2028 | Pilot cycles running | Pilots move to the downside dates |
| **Oct 2027** | **10 paying clubs.** EUR-track readiness review (no selling); pull-forward to early 2028 if the EU pilot is strong. | Mar 2028 | Billing | Re-plan 2028 capital |
| **Nov 2027** | Model re-run on actuals; Year-2 capital plan agreed; customer success hired for Jan 2028. | Jun 2028 hire | Updated model | Enter Year 2 under-capitalised |

**Later milestones (base / downside):** about 25 paying Swiss clubs Oct 2028 / Jun 2029 · CHF 10k MRR Dec 2028 / Q3 2029 · first EUR-track club signed Q2 2028, live Sep 2028 / 2029 · federation or multi-site pilot H2 2028 / 2029 · seed CHF 400–500k Q1 2029 · first salaried engineer after the seed · paid US gate not before H2 2029 / 2030 · broad white-label resale 2029 at the earliest / 2030+ · first profitable month (v2 workbook): about mid-2030 on the lean plan of record, about Q4 2030 on default costs, upside Aug 2029, downside 2032 or later.

## 13.2 Governance for a single-founder company [Updated Nov 2026]

Kept from August: monthly investor update (sent by the 5th, especially in bad months), quarterly founding-club roadmap call, monthly model refresh with actuals, quarterly advisory check-ins and quarterly compliance review. The August kill-criteria reviews are replaced (founder, 12 Nov 2026) by strategy review triggers. New: a **weekly metrics review** with the scorecard in 8.3; an **approval table** (humans approve merges, production deploys and migrations, pricing, legal and privacy documents, and any access to children's data; AI agents propose, the founder decides); and **strategy review triggers** instead of a stop decision: each missed gate (Gate 1; no paid signature by 31 March 2027; fewer than 3 paying clubs by 31 August 2027; fewer than 10 by 31 March 2028; churn above 2.5% for two months; downside runway under six months) starts a two-week review of pricing, segment, channel and offer with the CTO and advisors, ending in a written corrective plan (for example the fallback price card, a services-plus-licence model for academies, a federation or reseller channel, or postponing the pilots). Detail in `docs/company/00_EXECUTIVE_PLAN.md` §4.7. A review is also held at the seed decision in Q3 2028.

## 13.3 Entry gates for the later phases (new)

| Phase | Earliest | Every condition must be met |
|---|---|---|
| Free EU and US design-partner pilots *(12 Nov)* | EU Sep 2027; US Sep–Oct 2027 | DLang live + ≥3 paying Swiss clubs; i18n and currency for that market; privacy pack for that jurisdiction (GDPR Art. 27 representative; COPPA verifiable parental consent); support hours covered; one pilot per market, free, written agreement |
| Paid EUR track | Signed Q2 2028 (early 2028 on a strong EU pilot), live Sep 2028 | ≥10 paying Swiss clubs; gross margin ≥75%; SEPA Direct Debit live; EU VAT (non-Union OSS, reverse charge) set up [Verify]; GDPR Art. 27 representative; FR and DE complete across all surfaces; EUR price card; France border region first |
| Federation / multi-site pilot | H2 2028 | Romandie reference base; multi-club membership in the data model; enterprise onboarding track |
| Broad white-label resale | 2029 | ≥25 clubs on one codebase with no forks; external pen test passed; tenant-isolation tests in CI; staffable support SLA; reseller contract reviewed [Verify] |
| Paid US sales | H2 2029 | ≥40 paying clubs; ≥CHF 25k MRR; NRR ≥100% for 12 months; seed closed with a US budget line; the 2027 design partner (or another) paying; a named US channel; COPPA, state privacy and sales-tax review [Verify]; Delaware subsidiary plan |

## 13.4 The one-line summary [Updated Nov 2026]

> **IF YOU DO ONLY FIVE THINGS BEFORE 31 JANUARY 2027**
>
> 1. Get one real DLang parent to pay one real invoice by TWINT and see
> it reconcile automatically, by 18 December. Everything else is
> downstream of that transaction. (It was "before Christmas" in August;
> it still is.)
>
> 2. Sign the fractional CTO by 15 December (it releases the EUR 50k)
> and agree the January–March bridge (about CHF 45k) the same week.
> Submit >>venture>> by 30 November; IP assigned to SPSA by 31 December.
>
> 3. Fix the deck and every claim by 4 December. "Cheapest payment
> rail", not "cheaper than Spond".
>
> 4. Put one cap table in front of the investor, with the CTO's
> structure proposal (8 January).
>
> 5. Run ten audits, sign the first founding club and size the
> pre-seed for the plan as now costed (CHF 250–300k including the EUR
> 50k), all by 31 January.

---

# A Appendix A: sources

Unchanged from the August 2026 plan (`docs/company/source/DLANG_Sports_OS_Business_Plan.docx`, Appendix A). External figures were verified in August 2026 and have **not** been re-verified for this version; competitor prices in particular should be re-checked before use in a sales asset. Figures new in v2 come from the company documents `00`–`10` in `docs/company/` and the Financial Model v2, and are labelled [Est.], [Confirm] or [Verify] where they are not sourced facts.

Key regulatory dates relied on in v2: Swiss QR-bill Implementation Guidelines v2.4 in force 14 November 2026; structured addresses mandatory since 22 November 2025; >>venture>> 2027 entry window closes 30 November 2026; FIT Digital: 10 November 2026 intake missed, next intake to be confirmed.

# B Appendix B: what changed from the August 2026 plan

See `CHANGELOG.md` in this folder for the full list by area, and the Changes_v2 sheet of the Financial Model v2 for every changed cell.

**Changes from the founder's decisions of 12 November 2026** (added to this version):

| Topic | August 2026 plan | v2 (11 Nov 2026) | v2 updated 12 Nov 2026 |
|---|---|---|---|
| Entity | GmbH to be formed in Vaud | Formation by 31 Dec if not done *[Confirm]* | Swiss Preparatory Sports Academy GmbH (SPSA), account "SPSA Tech"; carve-out view by 15 Dec |
| FIT Digital | CHF 20k at 100% | 50% base / 0% downside | Not filed; 0% until filed and awarded; eligibility to check |
| CTO | Partner by Month 4 | Structure A or reviewer, decide 8 Jan 2027 | Fractional CTO + AI agent team, signed 15 Dec 2026 |
| Round | EUR 50k for 10% | Upsize to CHF 150–200k | EUR 50k secured, released once a CTO is in place; Jan–Mar bridge ~CHF 45k; pre-seed CHF 250–300k incl. EUR 50k in H1 2027 |
| Cash negative | Jul 2027 | Apr 2027 | Jan 2027 (founder-facts case); Apr 2027 workbook base |
| Founder pay | 2.5k / 6k / 8.5k | 2.5k / 5k / 7k + charges | Lean-cost variant accepted |
| Pilots | Founding programme | No free pilots | No free pilots in CH; one free EU and one free US design partner |
| Markets | Worldwide (deck) | EUR Q2 2028; US H2 2029 | Plus free EU (Sep 2027) and US (Sep–Oct 2027) pilots; paid EU early 2028 on a strong pilot |
| AI assistant | Paid module from Month 13 | Off, unsold before 2028 | Opt-in per club, DLang beta Q1 2027, included in the Club tier *[Confirm]* |
| Name | DLANG Sports OS | DLANG pending clearance | "Global Sport OS" candidate; clubs use their own names; check by 15 Jan 2027 |
| Break-even | Jul 2028 | ~Q4 2030 (workbook) | Same source; ~mid-2030 on the lean plan of record |
| Stop rule | Kill criteria | Fewer than 8 clubs by 31 Mar 2028 → lifestyle or stop | Strategy review triggers; no stop decision |
