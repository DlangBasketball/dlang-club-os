# DLANG Sports OS: Business Model and Pricing

**Status:** working document, re-baselined 11 November 2026; updated 12 November 2026 with the founder's decisions (`11_FOUNDER_DECISIONS_2026-11-12.md`), including **round 2** (AI assistant as a paid club add-on, DLang free; discounted paid EU/US pilots; parent AI add-on as a proposal in `13_PARENT_AI_ADDON_SPEC.md`)
**Financial figures:** the v2 workbook family is the only computed source (founder decision 14); the plan of record since round 2 is `updated/DLANG_Sports_OS_Financial_Model_v2.2.xlsx`. Section 10 shows it.
**Builds on:** the founder's August 2026 Business Plan, Financial Model, 90-Day Rollout, CTO Partnership Proposal and Investor Deck (`docs/company/source/`), and the strategy review `09_FOUNDER_PLAN_REVIEW.md`.
**Currency:** CHF unless stated otherwise. EUR and USD prices are stated as their own price points, not as conversions.

**How to read the labels**
- **[Founder]**: a figure from the founder's August 2026 materials, kept unchanged.
- **[Est.]**: an estimate or assumption made in this document.
- **[Verify]**: needs checking against a live source, or validation by a lawyer, tax adviser or fiduciary, before anyone relies on it externally.

---

## 1. The decisions in brief

1. **DLang runs on it first, Swiss programme-revenue organisations buy it second, everyone else waits.** The paying customer through 2028 is a Swiss academy, camp operator, international-school sports programme or multi-sport club with a paid coordinator, as the founder's Business Plan §4.2 says. Grassroots volunteer clubs, the EU, the US and white-label resale are later phases, each with an entry gate.
2. **The founder's pricing formula stays: CHF 149 + CHF 1.90 per athlete per month.** The tiers stay: Starter 290, Club 490, Academy 890, Multi-site 1,690. The onboarding fees stay. The founding-club offer stays: 5 clubs at CHF 290 for life.
3. **The payment take-rate is re-modelled to match the stack that was actually built.** That stack is Stripe, with Stripe Connect direct charges plus an application fee. On Stripe the net margin is close to zero, so the model now uses 0.2%, not 0.9%. QR-bill stays free and is the default.
4. **The headline claim changes** (adopted by the founder on 12 Nov 2026). "Cheaper than Spond on total cost" is false on the plan's own table. The claim to use is "the cheapest payment rail in Switzerland for clubs that collect real money, because QR-bill is free and the default."
5. **Timelines are moved about two quarters later than the founder plan.** First paid external club: February 2027 (downside April 2027). 10 clubs: October 2027 (downside March 2028). First EBITDA-positive month (v2 workbook): **about mid-2030** on the lean-cost plan of record the founder accepted, about Q4 2030 on the workbook defaults, August 2029 upside, 2032 or later downside.
6. **Cash (12 Nov founder-facts case: FIT at 0%, EUR 50k released in March 2027 once a CTO is in place).** Cash is negative from **January 2027**, about –43.5k in February, so **about CHF 45k must be bridged January–March 2027**. Funding ask: pre-seed of about **CHF 250–300k in total, including the EUR 50k, in H1 2027**; seed CHF 400–500k in Q1 2029. On the workbook base (FIT 50%, round in February) cash goes negative in April 2027.
7. **Markets and AI (12 Nov 2026, round 2).** Swiss paid launch first, plus **one discounted paid EU and one discounted paid US design-partner pilot** in 2027; **no free pilots anywhere** (proposed pilot price: 50% off the Club-tier list for 6 months, 12-month commitment, then list [Confirm]). The AI assistant is **opt-in per club** and a **paid add-on, not in any tier price**: proposed **CHF 69 per club per month** [Est.][Confirm]; DLang (customer zero) gets it free; DLang beta Q1 2027, sold to clubs from Jun 2027. A parent AI add-on is a proposal only (§4.3, `13`).

---

## 2. Customer segments

The founder's market analysis holds. Switzerland has 18,310 clubs, but only 13% (about 2,380) have any paid staff [Founder, Vereinsstudie 2022]. Software in this market is cheap or free. A price of CHF 290–490 a month can only be justified to an organisation that collects programme fees from families and pays someone to administer them.

| Segment | Examples | Can they pay CHF 290+/month? | Priority and timing | Main buyer / decision |
|---|---|---|---|---|
| **Academies and camp operators** | DLang Basketball / Swiss Prep Sports Academy, ski and football academies, holiday-camp operators | Yes. Programme revenue, seasonal peaks, real admin pain | **Primary, now.** First paid club Feb 2027 | Owner or director. Usually one or two people decide, 30–60 days |
| **Multi-sport clubs with a paid coordinator** | 100–300 athletes, Vaud / Geneva / Valais, no federation software deal | Some. Only with paid staff and programme revenue | **Primary, from Q1 2027** | Committee (*comité*). 45–90 days. Decisions cluster at the AGM and before the season |
| **International schools and private-school sports programmes** | After-school sport, camps, inter-school fixtures | Yes, from existing budget lines | **Secondary, from H2 2027.** Contracts for a school year starting in August are typically decided Jan–Apr [Est.] | Head of activities plus the bursar. Procurement and data-protection review |
| **Leagues, cantonal associations, federations** | Regional associations without a national software deal | Yes, but as a group deal | **Pilot H2 2028** (downside 2029), per the founder's §7.5 sequence | Board. 6–18 months. Needs a live reference club first |
| **Grassroots volunteer clubs** (under 100 members, about 65% of clubs) | Village football, volunteer-run Vereine | No. Median club revenue is about CHF 21.75k a year [Founder] | **Not a target before 2028.** At most a low-touch tier later, or reached through a federation deal | President or treasurer. Very price-sensitive. Spond is free |
| **EU (EUR track)** | Same profile in the EU | As in Switzerland | **Gated.** One **discounted paid design-partner pilot** live Sep 2027 (downside Jan 2028). First full-price club signed Q2 2028 (early 2028 if the pilot is strong), live Sep 2028 (downside 2029) | As above |
| **US** | Club and travel teams, academies | Probably yes. Unproven for DLANG | **Gated.** One **discounted paid design-partner pilot** for the US fall season, live Sep–Oct 2027 (downside Mar 2028). Full-price sales not before H2 2029 | Club director. Market dominated by consolidating incumbents |

**Ideal customer profile (unchanged from the founder plan):** 100–300 athletes, a paid admin, Vaud / Geneva / Valais first, no federation software deal, and audited value of at least 3× the price.

---

## 3. Value proposition by segment

| Segment | The job DLANG does | Proof point to use | What not to promise |
|---|---|---|---|
| Academy / camp | Registration → payment → roster → attendance → invoices as one chain. Fewer unpaid fees. Fewer admin hours | DLang's own figures: hours per week, write-offs and time to collect, measured before and after (case study by 31 Mar 2027) | Native apps. AI features (not in beta) |
| Multi-sport club | One system for members, groups, payments, messages and coaches, in FR/DE/EN (IT later) | The treasurer's own numbers: QR-bill free, TWINT reconciled automatically | "Cheaper than Spond overall" (false, see §5.4) |
| School programme | Parent consent, medical info, sign-ups and camp billing with Swiss-hosted data | Data-processing agreement (DPA), record of processing activities (ROPA) and a data-protection impact assessment (DPIA). External security review | Integration with school management systems (not built) |
| Federation / association | Clubs actually use it, and the federation sees participation and compliance in aggregate | One member club live and measurably better off | J+S subsidy export (not validated, not built) |
| Parents (users, not buyers) | Pay with TWINT or QR-bill in two taps. Every message in their language | Parent-app usage at DLang | Anything worse than Spond. A worse parent app means churn whatever the committee decides |

**Value case (founder figure, kept and stated plainly):** generic value is about CHF 983 a month against the Club-tier price of CHF 490, which is 2.0×. That fails the plan's own 3× qualifying rule. Rule: never qualify a deal on generic numbers, only on the club's audited numbers. If fewer than 6 of the first 10 audits reach 3×, apply the Gate 1 fallback (§5.5) instead of cutting list prices.

---

## 4. Packaging

The founder's tier names are kept. "Academy" is the Pro tier and "Multi-site / Federation" is the Enterprise tier. Renaming them would undo pricing already shown to founding clubs and in the deck.

### 4.1 Core tiers

| Tier | Athlete cap | CHF / month | EUR / month | USD / month (indicative only) | Onboarding fee | Includes |
|---|---|---|---|---|---|---|
| **Starter** | 75 | 290 | 279 | 299 | CHF 750 | Programmes, registration, payments (QR-bill, card, TWINT), roster, attendance, messaging, parent app (web), club branding |
| **Club** (primary ICP) | 180 | 490 | 469 | 499 | CHF 1,500 | Plus multi-team, coach app, reminders, reports, CSV import |
| **Academy** (= Pro) | 400 | 890 | 849 | 899 | CHF 2,900 | Plus multi-location, bookings and player development, advanced roles, custom domain included |
| **Multi-site / Federation** (= Enterprise) | 1,000+ | from 1,690, negotiated | from 1,590 | quote | from CHF 5,000 [Est.] | Plus group dashboard, federation branding, SLA, data export, security pack |

- **Formula [Founder]:** CHF 149 + CHF 1.90 per active athlete per month, or EUR 149 + EUR 2.00. The tier is the cap. Above the cap the formula applies, so nobody is penalised for growing.
- **USD [Est.]:** USD 149 + about USD 2.00 per athlete, rounded. **Not published** until the US gate is met (§9). US norms, such as fees passed through to families at registration, must be validated with a paying US design partner first.
- **VAT:** Swiss VAT at 8.1% is added in Switzerland once the company is registered [Verify with fiduciary: registration timing and voluntary early registration]. EU: reverse charge for VAT-registered customers. Many clubs are not VAT-registered, so check whether non-Union OSS applies [Verify].
- **Annual prepay:** 2 months free, and the onboarding fee is waived. This is the only discount outside the founding programme.

### 4.2 Founding programme [Founder, kept]

- 5 founding clubs at CHF 290 a month for life, on any tier.
- 24 months of direct founder access.
- 60-day refund, month-to-month.
- Onboarding fee waived.

**Change:** the founding programme also gets a sunset. Any founding slot not signed by **30 Sep 2027** closes. Founding prices are excluded from the ARPA assumptions (the founder's model applied Year-2 ARPA to them).

### 4.3 Add-ons

| Add-on | Price | Availability | Note |
|---|---|---|---|
| **AI assistant for clubs** (ops copilot: payment chasing drafts, schedule conflicts, report Q&A) | **Paid add-on, not in any tier price** (round 2, 12 Nov 2026). Proposed **CHF 69 / EUR 69 / USD 79 (indicative) per club per month**, annual CHF 690 [Est.][Confirm]; replaces the founder's CHF 90. **DLang (customer zero): complimentary.** Founding clubs: the August offer promised AI free for 24 months from launch; honour it or charge on top of CHF 290 [Confirm] | **Opt-in per club** (the club admin switches it on). DLang beta Q1 2027 (free); on sale to clubs once acceptance criteria are met: base Jun 2027, downside Sep 2027 | Guardrails: tenant-scoped context, minimal personal data (never medical notes, dates of birth or coach notes), no training on tenant data, AI provider named as sub-processor in the DPA, DPIA addendum signed off first. A retention feature, not an acquisition pitch. Paak has AI on its public roadmap |
| **Parent AI add-on** (proposal, not committed) | CHF 3–5 per family per month or about CHF 30–45 per season [Est.][Confirm]; club or platform collects, revenue-share option | Not before the club add-on proves value; earliest a DLang-parents pilot after Nov 2027, base Q1 2028 | Spec: `13_PARENT_AI_ADDON_SPEC.md`. Guardians only, own family only, no medical advice, COPPA for under-13s. **Not in the model** (upside) |
| **Custom domain and branded email sender** | CHF 29/month [Est.]. Included in Academy and above | Q3 2027 | Low cost to deliver. Supports the white-label story |
| **SMS** | Pass-through cost + 20% [Est.], prepaid packs | When requested | Push and email are free. SMS is the expensive channel |
| **White-label native app** (club-branded iOS/Android) | From CHF 4,900 setup + CHF 190/month [Est.] | **Not before 2029.** Multi-site only, and only after 25 clubs on one codebase | Native apps are out of beta scope [Founder]. App-store accounts and review work per club make it a services product |
| **Payments (TWINT / card)** | Application fee 0.5% on TWINT and card [Est.] on top of Stripe's fee. QR-bill free | With Stripe Connect, target Dec 2026 on DLang | See §5.3 |
| **Premium onboarding and migration** | CHF 150/hour [Est.] above the tier scope | Now | Historical imports, special integrations |

**Why CHF 69 for the club AI add-on [Est.][Confirm].** (1) Cost floor: inference is about CHF 12–22 per AI club per month (workbook; v2.2 uses CHF 17), so CHF 69 keeps a 68–83% gross margin and sits above a 3× cost floor of about CHF 50–66. (2) Value: drafting reminders and answering report questions saves an admin about 2–3 hours a month, worth CHF 60–120 at CHF 30–40 an hour [Est.]. (3) Price story: 14% of the Club tier (CHF 490), below the founder's CHF 90, so it does not undercut the "cheapest payment rail" message. (4) Benchmarks: the pack has no published AI add-on price for club software (Paak has AI on its roadmap; ClubDesk and Webling do not price AI) [Verify with a market check before publishing]. Test range CHF 49–99; workbook v2.2 assumes 20% of paying clubs attach from Jun 2027 [Est.].

---

## 5. Revenue streams and the payment decision

### 5.1 Streams

| Stream | Mechanism | Share of revenue, 2029 base [Est.] | Comment |
|---|---|---|---|
| Subscriptions | Tiered monthly or annual | ~84% | The business. Everything else is secondary |
| Onboarding and services | One-off fee per tier, plus hourly | ~11% | Filters out unserious clubs and offsets CAC. Not margin |
| AI assistant (club add-on) | Paid add-on, CHF 69 per club per month proposed (round 2, 12 Nov 2026); DLang free | ~3% (about 7.5k ARR in Nov-29) | Workbook v2.2: 20% attach from Jun 2027 (`Assumptions!B26`, `B91`), inference CHF 17 per AI club plus DLang's complimentary use about CHF 25/month (a cost with no revenue). v2.1 had 0% (AI in the tier); v2 15% at CHF 90 from Year 3 |
| Payment application fee | Stripe Connect direct charges + application fee | ~2% | Near-zero margin on Stripe (§5.3) |
| Federation group deals | Per-club rate about 20% below list, group onboarding fee, federation dashboard free | 0% in model | Upside. Pilot H2 2028 at the earliest |

### 5.2 DLang as customer zero

DLang Basketball runs on the platform first, with a target of **live Feb 2027** (downside Mar 2027). It should run the whole club, including summer camps and 2027/28 season registration, by **Sep 2027** (downside Oct 2027).

Once the GmbH exists, DLang should pay a documented, arm's-length fee (the founding price) so the books and the reference story are clean. Payments between DLang and the founder's company are related-party transactions [Verify with fiduciary]. **The model excludes DLang revenue.**

### 5.3 Payments: the decision that has to be made by 27 Nov 2026

The founder model assumed a 0.9% net margin on 50% of collections, which presumes a Payrexx-style rate of about 1.3%. The repository is built on **Stripe**: Checkout plus a webhook, a single account, and TWINT recorded only manually. Stripe TWINT is cited at 1.9% + CHF 0.30 [Verify against current Stripe CH pricing, including Connect fees].

| Option | Club pays (TWINT, CHF 450 fee) | DLANG net per club/month* | Engineering | Legal |
|---|---|---|---|---|
| **A. Stripe Connect, direct charges + 0.5% application fee (recommended)** | ≈ 1.9% + 0.30 + 0.5% ≈ CHF 11.10 | ≈ CHF 5 (after Connect costs, 0.2% net modelled) | One integration, already started | Money goes straight to the club's account. DLANG never holds it. **Counsel to confirm no financial-intermediary status under Swiss anti-money-laundering law** |
| B. Payrexx / Datatrans for TWINT, Stripe for card | ≈ 1.3% + margin | ≈ CHF 24 (founder's 0.9%) | Second integration, 1–3 weeks to contract | Same question about holding funds, depending on the setup |
| C. No take-rate | Stripe's fee only | 0 | As A | As A |

*Assumes 140 athletes and CHF 63k collected per year, with 50% on TWINT or card [Founder]. [Est.]

**Decision: Option A for the beta.** One rail, the money never touches DLANG, and it is fastest to Gate 2. Revisit Option B at 25+ clubs, when about CHF 19 a month per club times 25 clubs justifies a second integration.

The take-rate is **not** a profit pillar before 100+ clubs, which is the same conclusion the founder reached.

### 5.4 The competitive price claim, corrected

On the founder's own table for a 140-athlete club collecting CHF 63k a year:

| | Software / yr | Payment fees / yr | Total / yr |
|---|---|---|---|
| Spond Club | 180 | 1,575 | 1,755 |
| ClubDesk | 240 | 410 | 650 |
| Paak | 296 | 567 | 863 |
| **DLANG Club (founder figures)** | **5,880** | **693** | **6,573** |

Source: founder Business Plan §4.3, figures dated August 2026, not re-verified.

DLANG is **not** cheaper in total. It is the cheapest **rail** among the products that matter for card and TWINT. With Stripe pricing, DLANG's payment line moves closer to about CHF 800–1,000 a year [Est.], so the rail advantage over Spond narrows.

The honest pitch is: "you pay more for software that returns more hours and more collected fees than it costs, on your own audited numbers."

### 5.5 Gate 1 fallback price card (prepare by 15 Dec 2026)

If fewer than 6 of 10 audits clear 3×, **do not lower the list price.** Instead, in order:

1. Raise the Starter cap from 75 to 120 athletes, for academies and camps only.
2. Offer annual prepay with the onboarding fee waived.
3. Offer a camp-season plan: 4 months a year at the Club price, for camp-only operators [Est.].

Re-test with the next 5 audits.

---

## 6. Unit economics: targets, not claims

The founder's model shows LTV/CAC of 13× and payback of 3.7 months. Both rest on hypothetical churn and ARPA. **Do not quote LTV/CAC externally before about 10 paying clubs and 6 months of renewal data.** Quote CAC hours, close rate and payback instead.

| Metric | Founder model | Target used here | Basis |
|---|---|---|---|
| Founder hours to close one club | 22 (model) / 31 (plan) | **31** | Plan text. Committee follow-ups |
| Sales cycle | 21 days | **45–90 days** | Committee calendars. Signing concentrates Jan–Jun |
| Bottom-up CAC | 1,575 | **≈ 2,000** (31 h × 45 + 9 h onboarding × 45 + 180 travel) | [Est.] |
| Net CAC after onboarding fee | 675 | **≈ 1,100** | Average fee 900. Founding clubs pay 0 |
| Fully loaded CAC, 2027 | — | **4,000–6,000** | Few closes against fixed sales effort. Expected and acceptable in year 1 [Est.] |
| Gross margin | 83% | **≥ 70% in 2027, ≥ 80% from 2028** | Support of CHF 55 per club per month [Founder] dominates the cost of revenue |
| Logo churn | 1.5%/month | **≤ 1.5%/month** (≤ 17%/year), measured at renewal in Aug–Sep | Churn in this market is seasonal, not linear |
| Net revenue retention | — | **≥ 100% from 2028** | Athlete growth moves clubs up the formula |
| CAC payback (gross profit) | 3.7 months | **≤ 12 months** | SMB SaaS norm |
| Audit → paid close rate | — | **≥ 30%** | Track from the first 10 audits |
| Hours to onboard | 8–10 | **≤ 6 by club 15** | Requires CSV import and onboarding productisation |

---

## 7. Market sizing by launch market

All figures below are **assumptions for planning**, not market research. The Swiss numbers come from the founder's sources. The EU and US numbers are order-of-magnitude placeholders, marked [Verify], to be replaced before any investor use.

| Market | Total clubs (TAM units) | Assumed paying segment | Paying orgs (SAM) | Assumed ARPA / yr | SAM value / yr | 3-year obtainable (SOM) |
|---|---|---|---|---|---|---|
| **Switzerland** | 18,310 [Founder] | Programme-revenue orgs: academies, camps, schools, clubs with paid staff | **2,000–3,000** [Founder] | CHF 5,000 | **CHF 10–15M** | 45 clubs ≈ CHF 238.5k ARR by Nov 2029, v2 workbook base (≈ 2% of SAM) |
| **Romandie, initial beachhead** | Share of the above | Vaud / Geneva / Valais, founder network (30+ warm clubs claimed) | ~500–700 [Est.] | CHF 5,000 | CHF 2.5–3.5M | Most of the 2027–28 clubs |
| **DACH / EU (EUR track)** | Germany roughly 85–90k sports clubs, Austria and France large [Verify: DOSB and national statistics] | Same ~10–13% paid-staff / programme share [Est.] | tens of thousands [Est.] | EUR 5,000 | large, but no rail advantage | 1 discounted paid pilot from Sep 2027; 0–5 full-price clubs by end-2029. Gated |
| **US** | Very large youth-sports market [Verify] | Club, travel and academy programmes | large [Verify] | USD 6,000 [Est.] | large | 1 discounted paid pilot from fall 2027; 0 full-price by end-2029 |

**What the sizing does and does not say.** The Swiss SAM is small but reachable, and it is enough for a profitable niche business at 150–300 clubs. The EU and US are large, but DLANG's wedge (TWINT, QR-bill, Romandie network, FR/DE in one product) **does not travel**. In the EU and US, DLANG competes on product alone against funded incumbents. That is why they are gated, not why they are excluded.

---

## 8. Competitive landscape by category

Competitor prices and figures come from the founder plan (verified August 2026). Players not named in the founder plan are described only by category. Re-verify every price before using it in sales material.

| Category | Typical players | How they make money | Where they are strong | Where DLANG wins or loses |
|---|---|---|---|---|
| **Club and association management (CH)** | ClubDesk (CHF 240/yr), Webling (CHF 310/yr), Fairgate (federation deals with Swiss-Ski and STV), Paak (free under 100 members, then CHF 29 or 99/month) | Low annual subscription, payment add-ons | Swiss rails (QR-bill, TWINT), DE/FR/IT (ClubDesk), federation distribution (Fairgate) | **Loses on price.** Wins only on programme/camp commerce, sport-specific depth and the parent experience. **Paak is the closest threat** |
| **Team and communication apps** | Spond (free, 2.5% + CHF 0.20 card), Heja, TeamSnap | Free software, payment fees, ads or premium | Parent and player adoption from the bottom up | Spond sets the "why pay?" objection. Answer: Swiss rails, QR-bill free, programme commerce, finance reporting |
| **Course and booking commerce** | SportsNow (CHF 40–230/month + CHF 25 TWINT module) | Subscription + 3.9% + 0.30 card | Studios and classes | No team or parent model. DLANG wins on camps plus teams |
| **Regional club platforms (EU)** | Twizzit (BE, EUR 3.75–5.50 per member per year), plus national Vereinsverwaltung tools [Verify] | Per member, setup fees | Local rails and languages | DLANG has no local rail advantage. Do not enter before the gate |
| **US youth-sports platforms** | PlayMetrics / Stack Sports / SportsEngine (consolidated 2025–26, private-equity backed), TeamSnap | Registration and processing fees, subscriptions | Scale, integrations, league distribution | Not a near-term market. Risk: the consolidated US group expands into Europe |
| **School athletics platforms** | Category exists, mainly in the US and UK [Verify players] | School or district licences | Scheduling, eligibility, forms | Swiss international schools are a niche DLANG can serve from the academy product |
| **Payment and registration tools** | Payrexx, RaiseNow, Stripe-based forms | Transaction fees | Cheap rails | A potential partner (Payrexx for TWINT, option B), not only a competitor |

### Differentiation, ranked by how defensible it is

| Differentiator | Defensible? | How to use it |
|---|---|---|
| **Programme and camp commerce as the core workflow** | Strongest. 12–24 months | Lead with it everywhere |
| **Payments built in, QR-bill free by default, TWINT reconciled automatically** | Strong against foreign players, neutral against Swiss tools | Lead against Spond. Prove it on the club's own numbers. **Requires Gate 2** |
| **Swiss-grade privacy:** nFADP-aligned, Swiss/EU hosting, row-level security per organisation, DPA/ROPA/DPIA pack | Durable, and it matters to schools and directors who carry personal liability | Say "nFADP-aligned by design", never "certified". Confirm the hosting region and sub-processor list [Verify]. External security review by 31 Jan 2027 |
| **White-label** (branding, terminology, locale and currency per organisation) | Moderate. The architecture is in place | Sell it as "your club's brand, not ours" to academies and federations. **Not** a resale programme before 2029 |
| **AI operations** | Weak as a moat | Retention feature and a paid add-on (CHF 69 proposed), opt-in per club from Q1 2027 (DLang first, free). Never the lead message |
| **Founder-led onboarding** | Ends at about 25 clubs | Use it hard in 2027. Productise it before it breaks |

---

## 9. Phasing and entry gates (re-baselined from 11 Nov 2026)

| Milestone | Founder plan (Aug 2026) | Base | Downside | Entry gate / condition |
|---|---|---|---|---|
| Gate 2: a real TWINT payment reconciles on DLang | 18 Oct 2026 | 18 Dec 2026 | 31 Jan 2027 | Stripe TWINT + Connect. Red line 31 Dec, with a manual beta as fallback |
| Gate 1: willingness to pay (≥ 6/10 audits at 3×) | 20 Sep 2026 | 31 Jan 2027 | 15 Mar 2027 | Audits private academies and camps first |
| DLang live on the platform | — | Feb 2027 | Mar 2027 | Gate 2 |
| First paid external club | by 30 Nov 2026 | Feb 2027 | Apr 2027 | GmbH, contract set, DPA |
| 5 founding clubs | 31 Jan 2027 | Jun 2027 | Sep 2027 | Founding slots close 30 Sep 2027 |
| DLang runs the whole club (camps + 2027/28 season) | — | Sep 2027 | Oct 2027 | Survives the seasonal peak |
| 10 paying clubs | ~Jun 2027 (model) | Oct 2027 | Mar 2028 | — |
| CHF 10k MRR | ~mid-2028 (model) | Q4 2028 | Q3 2029 | — |
| 25 paying clubs | ~Jan 2028 (model) | Oct 2028 | Jun 2029 | — |
| **EU discounted paid design-partner pilot** (12 Nov; paid since round 2) | — | live Sep 2027 | Jan 2028 | DLang live + ≥ 3 paying CH clubs; EUR, SEPA, FR/DE; GDPR Art. 27 representative; support hours covered; go/no-go 30 Jun 2027 |
| **US discounted paid design-partner pilot** (12 Nov; paid since round 2) | — | live Sep–Oct 2027 (US fall season) | Mar 2028 (spring season) | Same entry conditions; USD, US English, COPPA verifiable parental consent; US entity or sales-tax registration for a paid pilot [Verify]; cross-border Stripe Connect [Verify] |
| **EUR track: first paid club** | "second track" | signed Q2 2028 (early 2028 if the EU pilot is strong), live Sep 2028 | 2029 | ≥ 10 CH clubs, SEPA, EU VAT set-up, GDPR Art. 27 representative, DE/FR contract texts |
| Federation / multi-site pilot | Months 15–24 | H2 2028 | 2029 | One live reference club in the federation's sport |
| First break-even month (v2 workbook) | Jul 2028 | **about mid-2030** (lean plan of record); about Q4 2030 (workbook defaults); Aug 2029 upside | 2032 or later | ~75–80 clubs on the default cost base |
| **US paid sales** | "worldwide" (deck) | not before H2 2029 | later | ≥ 40 clubs, CHF 25k+ MRR, NRR ≥ 100%, seed closed, the 2027 design partner (or another) paying, plus a channel |
| **Broad white-label resale** | implied by the deck | 2029 at the earliest | later | ≥ 25 clubs on one codebase, external penetration test, a support SLA the company can staff |

**Where ambition and realism diverge.** The deck's "worldwide, every team sport" and "150 clubs / EUR 808k ARR" are not reachable on the deck's timeline. We estimate the odds at under 15%. The constraint is not the code, which is already multi-tenant and white-label capable. The constraints are:
- a single founder's selling hours;
- a Swiss sales calendar where signing concentrates in Jan–Jun;
- payment and compliance set-up per market;
- capital.

The Swiss wedge is real, but it is Swiss. Going abroad early would spread one founder across markets where DLANG has no advantage. That is why the founder's wish for a 2027 EU and US presence is met with **one discounted paid pilot per market** (round 2: no free pilots), behind entry conditions, and not with full-price launches. The pilots go live in the Swiss peak (Sep–Oct 2027) and cost about CHF 15–30k plus 150–250 founder and CTO hours [Est.]; workbook v2.2 carries CHF 22.5k of cost and about CHF 21.7k of pilot fees over three years.

---

## 10. Three-year model

### 10.0 Plan of record after round 2: workbook v2.2 (12 Nov 2026)

Source: `updated/DLANG_Sports_OS_Financial_Model_v2.2.xlsx` (copy of v2.1, which is unchanged), recalculated in LibreOffice. Inputs: FIT 0%, EUR 50k cash Mar 2027 once a CTO is in place, lean costs, EU/US pilot costs CHF 22.5k in 2027, plus round 2: **AI as a paid add-on** (CHF 69, 20% attach from Jun 2027 [Est.], DLang complimentary inference about CHF 25/month from Feb 2027) and **discounted paid EU/US pilots** (50% off the Club list for 6 months, then list; about CHF 2.6k / 8.8k / 10.3k of fees in Y1 / Y2 / Y3). The parent AI add-on is not modelled.

| CHF | v2.2 base (plan of record) | v2.2 downside (Bear) | v2.2 upside (Bull) |
|---|---|---|---|
| Paying clubs Nov-27 / 28 / 29 | 10 / 26 / 45, plus 2 pilot clubs | 6 / 15 / 27, plus 2 | 17 / 45 / 87, plus 2 |
| ARR Nov-27 / 28 / 29 | 46.5k / 131.7k / **249.0k** | 25.9k / 76.7k / 146.8k | 76.7k / 227.7k / 476.0k |
| Revenue Y1 / Y2 / Y3 | 21.4k / 101.7k / 211.6k | 9.5k / 61.2k / 127.4k | 37.4k / 174.8k / 391.3k |
| of which AI add-on | 0.6k / 2.9k / 5.9k | 0.3k / 1.7k / 3.5k | 1.0k / 5.1k / 10.9k |
| EBITDA Y1 / Y2 / Y3 | –163.6k / –122.7k / –101.5k | –173.3k / –141.6k / –171.7k | –153.2k / –65.3k / +48.5k |
| Cash Jan / Feb / Mar 2027 | –17.6k / –43.5k / –7.9k | –17.6k / –43.6k / –54.6k | –17.6k / –43.5k / –7.8k |
| Bridge before the EUR 50k lands | **about CHF 45k (Jan–Mar 2027)** | about CHF 55k (Jan–Apr) | about CHF 45k |
| Unfunded shortfall Nov-27 / 28 / 29 | **102k / 225k / 326k** | 112k / 253k / 425k | 92k / 157k / 109k (lowest –173k, Feb-29) |
| First EBITDA-positive month | about mid-2030 (Q2 2030) [Est., extrapolated] | 2032 or later | Mar 2029 |

Against v2.1 (base incl. pilot costs: 105k / 236k / 353k) the AI add-on improves the Nov-29 shortfall by about CHF 8.8k and the pilot fees by about CHF 17.5k. The first-quarter bridge does not change: no AI or pilot revenue arrives before June 2027.

### 10.1 Round-1 figures: the v2 workbook (founder decision 14, 12 Nov 2026; plan-of-record column superseded by 10.0)

Source: `updated/DLANG_Sports_OS_Financial_Model_v2.xlsx`. Model years run December to November (Year 1 = Dec 2026 – Nov 2027). Three cases are shown; the second and third are the same workbook recalculated on copies with the founder's 12 Nov facts (see `11_FOUNDER_DECISIONS_2026-11-12.md` §2). Since 12 Nov the plan of record is saved as `updated/DLANG_Sports_OS_Financial_Model_v2.1.xlsx`: with its EU/US pilot row (CHF 22.5k in 2027 [Est.]) the shortfalls are about 105k / 236k / 353k; with that row at 0 it reproduces the third case exactly (`10_FINANCIAL_MODEL_V2_NOTES.md` §0).

| CHF | Workbook base (as published) | 12 Nov founder-facts case (FIT 0%, EUR 50k cash Mar 2027) | Round-1 plan of record (founder-facts + lean cost + AI in Club tier; superseded by 10.0) | Downside (Bear) |
|---|---|---|---|---|
| Paying clubs Nov-27 / 28 / 29 | 10 / 26 / 45 | 10 / 26 / 45 | 10 / 26 / 45 | 6 / 15 / 27 |
| ARR Nov-27 / 28 / 29 | 39.6k / 117.1k / 238.5k | same | 39.6k / 117.1k / 231.2k | 19.8k / 63.9k / 136.4k |
| Revenue Y1 / Y2 / Y3 | 18.2k / 89.9k / 201.1k | same | 18.2k / 89.9k / 195.4k | 6.6k / 50.7k / 117.0k |
| EBITDA Y1 / Y2 / Y3 | –143.5k / –182.3k / –186.5k | same | –143.5k / –131.6k / –116.7k | –152.9k / –200.2k / –256.2k |
| Cash negative for good | Apr 2027 | **Jan 2027** (about –43.5k in Feb before the release) | Jan 2027 | Jan 2027 |
| Unfunded shortfall Nov-27 / 28 / 29 | 72k / 254k / 441k | 82k / 264k / 451k | 82k / 214k / 330k | 91k / 292k / 548k (FIT 0% already) |
| CHF 10k MRR | Dec 2028 | Dec 2028 | Dec 2028 | Sep 2029 |
| First EBITDA-positive month | about Q4 2030 (outside the horizon) | about Q4 2030 | **about mid-2030** [Est., extrapolated] | 2032 or later |

Upside (Bull), for reference: 17 / 45 / 87 clubs, ARR 465.3k in Nov-29, first EBITDA-positive month **Aug 2029**.

**Readout.** At about 75–80 clubs the default cost base breaks even; the base case reaches 45 clubs by Nov 2029. The founder accepted the lean-cost variant, which keeps Nov-29 burn to about CHF 5k a month and the trough to about –330k. Federation deals and the EU/US pilots are not in these numbers.

### 10.2 Earlier calendar-year sketch (superseded on 12 Nov 2026, kept for traceability)

The sketch below was built by hand before the v2 workbook was finished. Its dates (break-even Aug–Sep 2029, capital need CHF 240k) are **superseded** by 10.1. Do not quote it.

**Key assumptions [Est.]**
- **Club adds** are seasonal: about 70% are signed Feb–Sep, and almost none in Jul or Dec. Gross adds are 12 / 15 / 29.
- **Churn:** 0% in 2027 (founding clubs), then 1.2% a month in 2028 and 1.5% in 2029.
- **ARPA:** founding clubs pay CHF 290. Other clubs average CHF 430 / 440 / 460.
- **AI attach:** 0% / 10% / 20%.
- **Payments:** CHF 5 per club per month in 2027–28 and CHF 8 in 2029.
- **Onboarding:** CHF 900 on average for each non-founding club.
- **Cost of revenue:** CHF 73 per club per month (support 55, infrastructure and messaging 18) + CHF 300 a month of base infrastructure + 25% of AI revenue for inference.
- **Opex:** lean plan, monthly.
  - Founder: 2,000 / 4,000 / 5,000, plus 12% employer social charges. The 2027 figure assumes the academy covers the rest [Verify].
  - Engineering: AI agents plus a senior reviewer for 4–6 hours a week (CHF 1,500 a month), plus the CTO retainer per Structure A (1,200 from Mar 2027, then 4,000 and 5,000).
  - Part-time customer success from Jan 2028.
  - One-off costs of CHF 10–12k a year for the security review or penetration test, legal set-up and EU preparation.
- **Exclusions:** DLang revenue, spend from Sep–Dec 2026, and any grant.

### Base case

| CHF | 2027 | 2028 | 2029 |
|---|---|---|---|
| Paying clubs, year end | 12 | 24 | 47 |
| MRR at year end | 4.5k | 10.3k | 22.0k |
| ARR at year end | 54k | 124k | 264k |
| Subscription revenue | 21.9k | 92.7k | 192.9k |
| AI add-on | 0 | 2.1k | 7.9k |
| Payment application fees | 0.3k | 1.2k | 3.5k |
| Onboarding fees | 6.3k | 13.5k | 26.1k |
| **Total revenue** | **28.6k** | **109.4k** | **230.5k** |
| Cost of revenue | 8.3k | 21.0k | 37.8k |
| **Gross profit (margin)** | **20.2k (71%)** | **88.4k (81%)** | **192.7k (84%)** |
| Opex, lean plan | 104.9k | 195.8k | 241.2k |
| **EBITDA, lean plan** | **–84.7k** | **–107.3k** | **–48.5k** |
| Cumulative EBITDA | –84.7k | –192.0k | –240.5k |
| Opex, "investment" plan (higher founder pay, CTO at 7k in 2029, reviewer 2.25k, more marketing) | 126.0k | 235.7k | 302.2k |
| EBITDA, investment plan | –105.8k | –147.3k | –109.5k |

**Readout.**
- (Superseded) This sketch put the first break-even month in Aug–Sep 2029 at about 41–44 clubs and durable break-even in 2030. The workbook (10.1) puts it at about mid-2030 on the lean plan of record.
- If the seed funds the first engineer employee in Q1 2029, break-even moves out by 2–3 quarters. That is a choice, not a failure.
- The founder's model reached profitability in Jul 2028 with 50 clubs by Aug 2028. The difference comes from a 6-month later start, seasonality, a slower ramp, and Stripe-based payment margin.

### Downside (summary)

- Gross adds 6 / 10 / 16. Churn 1% / 2% / 2.5% a month. Costs cut further.
- Clubs at year end: 6 / 13 / 24.
- Revenue: about 10k / 56k / 118k.
- EBITDA: about –89k / –109k / –99k. Cumulative about **–297k** by end-2029, with no break-even before 2031.
- **Strategy review trigger (replaces the stop rule, 12 Nov 2026):** the founder has committed to keep going, so there is no stop decision. If fewer than 10 clubs pay by 31 Mar 2028 (the downside date; and as a hard checkpoint, fewer than 8), run a two-week structured review of pricing, segment, channel and offer and choose corrective plays: (a) a services-plus-licence model for academies, (b) a federation or strategic partner, (c) the schools segment, (d) resale through the DLang network, (e) holding costs at the lean line and resizing the funding plan. See `00_EXECUTIVE_PLAN.md` §4.7.

**Validation required:** a fiduciary should review the salary, social-charge and VAT treatment. The workbook is the source of record: `updated/DLANG_Sports_OS_Financial_Model_v2.2.xlsx` opens on the plan of record after round 2 (FIT 0%, round in Mar 2027, lean cost, AI as a paid add-on, discounted paid EU/US pilots with their costs); refresh it with actuals on 3 Jan 2027. v2.1 (AI in the Club tier, pilots as cost only) and v2 (11 Nov defaults) are kept unchanged for reference.

---

## 11. Funding and bootstrapping options

**Capital need (v2 workbook, 10.1).** Secured today: founder CHF 15k plus EUR 50k (about CHF 46.5k) released once a CTO is in place; FIT at 0%. In the 12 Nov founder-facts case cash is negative from **January 2027** and about –43.5k in February, so the first two cash actions are **signing the fractional CTO** (target 15 Dec 2026) and **bridging January–March 2027 (about CHF 45k)**. Beyond that, the unfunded shortfall on the plan of record is about 82k / 214k / 330k at Nov 2027 / 2028 / 2029 (82k / 264k / 451k on default costs). Funding ask: a **pre-seed of about CHF 250–300k in total, including the EUR 50k, in H1 2027**, and a **seed of CHF 400–500k in Q1 2029** (0.5–1.0M if it also funds the EUR track and the first engineer).

| Source | Amount | Timing (base) | Probability / condition | Note |
|---|---|---|---|---|
| Founder funds [Founder] | CHF 15k | Now | Committed? [Verify] | |
| DLang academy covering founder time | In kind | 2027 | Founder decision | Document it as a related-party arrangement [Verify with fiduciary] |
| FIT Digital grant [Founder] | CHF 20k | Not filed (founder, 12 Nov 2026); pack being prepared in `applications/fit-digital/` | **Modelled at 0%** until filed and awarded. Eligibility may be blocked if SPSA's register entry is older than 6 months (Grant) / 12 months (Seed) [Verify] | Non-dilutive |
| >>venture>> competition | Prize amount not modelled | Submit by 30 Nov 2026 (founder: yes; draft in `applications/venture-2027/`) | Uncertain | Visibility and network more than money |
| Convertible loan [Founder] | EUR 50k (≈ CHF 46.5k), cap CHF 418.5k pre-money, 15–20% discount, 18–24 months | **Secured**; released once a CTO is in place (assumed Mar 2027); signed by 31 Jan 2027 | Needs the IP assigned to SPSA first | One working cap table for now, refined with the CTO and advisors; any CTO equity disclosed to the investor |
| Fractional CTO (12 Nov 2026) | Engineering by AI agents; a named human fractional CTO accountable | Signed 15 Dec 2026 (latest 31 Jan 2027); structure set by the CTO by 8 Jan 2027 | Critical path for the EUR 50k | Paid senior reviewer covers until the CTO starts. Structure A is one option, not the default |
| Customer prepay | 10 months' subscription upfront (annual prepay, 2 months free) | From the first clubs | Medium | Cheapest capital available. Offer annual prepay in every proposal |
| Jan–Mar 2027 bridge (12 Nov) | about CHF 45k | Agreed by 15 Dec 2026 | Founder funds, an investor advance, or deferring the CTO trial and pen-test costs [Confirm] | Carries cash to the EUR 50k release |
| Pre-seed | about CHF 250–300k in total, including the EUR 50k | H1 2027 (signed by 28 Feb, cash in by Apr 2027 at the latest) | Gate 1, DLang live, first founding clubs | Upsize the convertible, same instrument, higher cap if traction justifies it |
| Cantonal or federal innovation support | Varies | 2027 | [Verify] eligibility for Vaud programmes and Innosuisse | Usually needs a research partner or a specific project |
| Seed | CHF 400–500k (0.5–1.0M with the EUR track and first engineer) [Est.] | Q1 2029, raised from Q3 2028 | Needs ≥ 25 clubs, CHF 10k+ MRR and retention data | Funds the first engineer employee and the EUR track. Swiss notice periods of 1–3 months mean hiring starts about a quarter after closing |

**Recommendation.** Sign the CTO and bridge January–March first; then stay lean (the founder accepted the lean-cost variant) through Gate 1 and the first 5 clubs, funded by the founder, the academy, prepay, the EUR 50k and the pre-seed. Raise the seed only for the EUR track and engineering scale, at about 25 clubs. Do not raise on the "worldwide" story. Swiss and EU angels will diligence the Swiss numbers.

**Professional validation required before any money moves:**
- IP assignment from the founder, SIDIS and contractors to Swiss Preparatory Sports Academy GmbH (SPSA), and whether to carve the software business out of SPSA (lawyer, fiduciary).
- Convertible loan terms and their interaction with the CTO grant (lawyer).
- AML status of the payment flow (counsel).
- VAT registration and EU VAT treatment (tax adviser).
- Employer social charges on any salary (fiduciary).

---

## 12. Changes vs. founder's August 2026 plan

| Topic | Founder plan | Updated (11 Nov 2026; rows marked 12 Nov reflect the founder's decisions) | Why |
|---|---|---|---|
| Target segments | Programme-revenue orgs, ICP 100–300 athletes, Romandie | **Kept.** Schools moved to H2 2027, federations to a pilot in H2 2028, grassroots not before 2028 | The founder's segmentation is sound. Only the timing changes |
| Tier prices | Starter 290 / Club 490 / Academy 890 / Multi-site 1,690 (EUR 279/469/849/1,590) | **Kept.** Academy = Pro, Multi-site = Enterprise. Indicative USD 299/499/899, unpublished | Already shown to clubs and in the deck. Consistency matters more than renaming |
| Pricing formula | CHF 149 + 1.90 per athlete, EUR 149 + 2.00 | **Kept.** USD 149 + ~2.00 indicative | Linear and removes the incentive to under-report athletes |
| Onboarding fees | CHF 750 / 1,500 / 2,900 | **Kept.** Multi-site from CHF 5,000 [Est.] | Filters clubs and offsets CAC |
| Founding offer | 5 clubs at CHF 290 for life, 60-day refund | **Kept.** Slots close 30 Sep 2027, and founding prices are excluded from ARPA | The model applied Year-2 ARPA to locked prices |
| Payment margin | 0.9% net on 50% of collections (Payrexx-type rate) | **0.2% net** via a Stripe Connect application fee (0.5% gross). Payrexx revisited at 25+ clubs | The code is on Stripe. Stripe TWINT at 1.9% + 0.30 leaves almost no margin |
| Money flow | Not specified | **Stripe Connect direct charges. DLANG never holds club funds** | Avoids possible financial-intermediary status under anti-money-laundering law. Counsel to confirm |
| Headline claim | "Cheaper than Spond on total cost" | "Cheapest rail, QR-bill free. ROI on your audited numbers" | Plan's own table: 6,573 vs 1,755 a year |
| AI module | CHF 90, 25% attach from Month 13 | **12 Nov, round 2:** opt-in per club, DLang beta Q1 2027 (free for DLang); a **paid add-on** for clubs, proposed CHF 69/month [Confirm], 20% attach from Jun 2027 in v2.2 | Founder wants it available once fully functional; guardrails and DPIA first |
| Add-ons | AI only | AI (paid, CHF 69 proposed) plus custom domain, SMS pass-through, native white-label app (2029+), premium onboarding | Brief requires a white-label packaging path, sequenced late |
| Sales cycle / CAC hours | 21 days, 22 hours | **45–90 days, 31 hours.** Bottom-up CAC ≈ 2,000 | Committee decisions. The plan's own text says 31 hours |
| LTV/CAC | 13×, payback 3.7 months, quoted | **Not quoted** before 10 clubs and 6 months of data. Target payback ≤ 12 months | Hypothetical inputs. Investors discount it anyway |
| Seasonality | None (linear adds) | ~70% of adds Feb–Sep. Churn measured at renewal | Swiss season, camps and AGM calendar |
| Model start | Month 1 = Sep 2026 | Calendar 2027–2029, from Nov 2026 status | 90-day rollout ends 22 Nov 2026 with Gates 1–3 not met |
| First paid club | Signature by 30 Nov 2026 | Feb 2027 (downside Apr 2027) | Gate 2 not met. No GmbH or contracts confirmed |
| 5 founding clubs | 31 Jan 2027 | Jun 2027 (downside Sep 2027) | Sales calendar and capacity |
| Clubs at years 1/2/3 | 13 / 50 / 118 (Aug years) | **12 Nov:** 10 / 26 / 45 (v2 workbook, Dec–Nov years); the 12 / 24 / 47 calendar-year sketch is superseded | One computed source |
| Revenue years 1/2/3 | 31.7k / 193.4k / 556.9k | 18.2k / 89.9k / 201.1k (v2 workbook base) | As above |
| Profitability | First profitable month Jul 2028 | **12 Nov:** about mid-2030 (lean plan of record), about Q4 2030 (workbook defaults), Aug 2029 upside, 2032+ downside | v2 workbook only |
| Engineering cost | CHF 4,500/month (~CHF 43/h). Year-2 FTE at 8.5k | AI agents + senior reviewer + CTO retainer. Employee only after seed (Q1 2029) at Swiss cost (CHF 12–16k a month loaded) | Swiss contractors cost CHF 110–150/h. The FTE figure was EU-remote pricing |
| Employer social charges | Not modelled | +12% on salaries | AHV/IV/EO/ALV, accident insurance, pension [Verify with fiduciary] |
| FIT grant | 100% in the cash plan | **12 Nov:** not filed; 0% until filed and awarded; eligibility to be checked | Deadline 10 Nov 2026 missed |
| Capital need | CHF 81.5k stack (trough –107k) | **12 Nov:** Jan–Mar 2027 bridge ~CHF 45k; pre-seed ~CHF 250–300k incl. EUR 50k in H1 2027; seed CHF 400–500k Q1 2029 | Founder-facts case: cash negative from Jan 2027 |
| Cap table | Founder 90 → 81 → 72% vs 64.8% in the CTO proposal | **12 Nov:** one working cap table now, refined with the CTO and advisors | Investor disclosure |
| EU (EUR track) | "Second track" | First club signed Q2 2028, live Sep 2028. Gated on ≥ 10 CH clubs, SEPA, EU VAT, Art. 27 representative | Capacity, and no rail advantage abroad |
| US / worldwide | Deck: "worldwide, every team sport", 150 clubs / EUR 808k ARR | **12 Nov, round 2:** one discounted paid US design-partner pilot (Sep–Oct 2027 / Mar 2028); full-price US not before H2 2029 behind explicit gates | Founder wants a US presence; wedge doesn't travel |
| EU pilot (12 Nov) | — | One discounted paid EU design-partner pilot (round 2), live Sep 2027 / Jan 2028; full-price EU can move to early 2028 on a strong pilot | Founder wants an EU presence in 2027 |
| Founding offer (12 Nov) | Founding programme | No free pilots anywhere (round 2); capped cohort as planned; EU/US pilots at 50% off for 6 months, then list (proposed) | Founder's decision |
| Founder pay (12 Nov) | 2.5k / 6k / 8.5k | Lean-cost variant accepted (Y2/Y3 founder 3.5k/5k, engineering 6k/8k, S&M 1k/1.5k) | Trough about –330k instead of –451k |
| Stop rule (12 Nov) | — | Strategy review triggers instead of a stop decision | Founder's commitment |
| White-label resale | Implied by the deck | Not before 2029. Gated on ≥ 25 clubs, penetration test, staffed SLA | Support burden and security exposure |
| DLang | Reference customer | Customer zero, live Feb 2027, first Stripe Connect account. Pays a documented founding fee. Excluded from the model. **12 Nov:** DLang and the software business share SPSA GmbH, so the fee is an internal allocation until any carve-out [Verify] | Clean books and an honest reference |
