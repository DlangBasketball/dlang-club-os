# DLANG Sports OS: Business Model and Pricing

**Status:** working document, re-baselined 11 November 2026
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
4. **The headline claim changes.** "Cheaper than Spond on total cost" is false on the plan's own table. The claim to use is "the cheapest payment rail in Switzerland for clubs that collect real money, because QR-bill is free and the default."
5. **Timelines are moved about two quarters later than the founder plan.** First paid external club: February 2027 (downside April 2027). 10 clubs: October 2027 (downside March 2028). First break-even month: Q3 2029 on a lean cost base. Cumulative funding need to end-2029: about CHF 240k base and 300k downside, before a 20% buffer.

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
| **EU (EUR track)** | Same profile in the EU | As in Switzerland | **Gated.** First club signed Q2 2028, live Sep 2028 (downside 2029) | As above |
| **US** | Club and travel teams, academies | Probably yes. Unproven for DLANG | **Gated.** Exploration not before H2 2029 | Club director. Market dominated by consolidating incumbents |

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
| **AI assistant** (ops copilot: payment chasing drafts, schedule conflicts, report Q&A) | CHF 90 / EUR 90 / USD 99 per month [Founder price] | **Off during the beta.** Paid add-on from Q1 2028, after 10 clubs | The code exists, but it is out of beta scope per the founder plan. It is a retention and margin feature, not an acquisition pitch. Paak has AI on its public roadmap |
| **Custom domain and branded email sender** | CHF 29/month [Est.]. Included in Academy and above | Q3 2027 | Low cost to deliver. Supports the white-label story |
| **SMS** | Pass-through cost + 20% [Est.], prepaid packs | When requested | Push and email are free. SMS is the expensive channel |
| **White-label native app** (club-branded iOS/Android) | From CHF 4,900 setup + CHF 190/month [Est.] | **Not before 2029.** Multi-site only, and only after 25 clubs on one codebase | Native apps are out of beta scope [Founder]. App-store accounts and review work per club make it a services product |
| **Payments (TWINT / card)** | Application fee 0.5% on TWINT and card [Est.] on top of Stripe's fee. QR-bill free | With Stripe Connect, target Dec 2026 on DLang | See §5.3 |
| **Premium onboarding and migration** | CHF 150/hour [Est.] above the tier scope | Now | Historical imports, special integrations |

---

## 5. Revenue streams and the payment decision

### 5.1 Streams

| Stream | Mechanism | Share of revenue, 2029 base [Est.] | Comment |
|---|---|---|---|
| Subscriptions | Tiered monthly or annual | ~84% | The business. Everything else is secondary |
| Onboarding and services | One-off fee per tier, plus hourly | ~11% | Filters out unserious clubs and offsets CAC. Not margin |
| AI add-on | CHF 90/month, 10% attach in 2028, 20% in 2029 | ~3% | Founder assumed 25%. Lowered until proven |
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
| **Switzerland** | 18,310 [Founder] | Programme-revenue orgs: academies, camps, schools, clubs with paid staff | **2,000–3,000** [Founder] | CHF 5,000 | **CHF 10–15M** | 47 clubs ≈ CHF 264k ARR by end-2029 (≈ 2% of SAM) |
| **Romandie, initial beachhead** | Share of the above | Vaud / Geneva / Valais, founder network (30+ warm clubs claimed) | ~500–700 [Est.] | CHF 5,000 | CHF 2.5–3.5M | Most of the 2027–28 clubs |
| **DACH / EU (EUR track)** | Germany roughly 85–90k sports clubs, Austria and France large [Verify: DOSB and national statistics] | Same ~10–13% paid-staff / programme share [Est.] | tens of thousands [Est.] | EUR 5,000 | large, but no rail advantage | 0–5 clubs by end-2029. Gated |
| **US** | Very large youth-sports market [Verify] | Club, travel and academy programmes | large [Verify] | USD 6,000 [Est.] | large | 0 by end-2029. Exploration only |

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
| **AI operations** | Weak as a moat | Retention and margin add-on from 2028. Never the lead message |
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
| **EUR track: first club** | "second track" | signed Q2 2028, live Sep 2028 | 2029 | ≥ 10 CH clubs, SEPA, EU VAT set-up, GDPR Art. 27 representative, DE/FR contract texts |
| Federation / multi-site pilot | Months 15–24 | H2 2028 | 2029 | One live reference club in the federation's sport |
| First break-even month | Jul 2028 | **Q3 2029** (lean costs) | not before 2031 | Durable break-even 2030 (base) |
| **US exploration** | "worldwide" (deck) | not before H2 2029 | later | ≥ 40 clubs, CHF 25k+ MRR, NRR ≥ 100%, seed closed, a paying US design partner plus a channel |
| **Broad white-label resale** | implied by the deck | 2029 at the earliest | later | ≥ 25 clubs on one codebase, external penetration test, a support SLA the company can staff |

**Where ambition and realism diverge.** The deck's "worldwide, every team sport" and "150 clubs / EUR 808k ARR" are not reachable on the deck's timeline. We estimate the odds at under 15%. The constraint is not the code, which is already multi-tenant and white-label capable. The constraints are:
- a single founder's selling hours;
- a Swiss sales calendar where signing concentrates in Jan–Jun;
- payment and compliance set-up per market;
- capital.

The Swiss wedge is real, but it is Swiss. Going abroad early would spread one founder across markets where DLANG has no advantage.

---

## 10. Three-year model (re-baselined, calendar years 2027–2029)

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
- On the lean plan the first break-even month is **Aug–Sep 2029**, at about 41–44 clubs, helped by peak-season onboarding fees.
- Durable break-even comes in **2030**, at about 50–55 clubs.
- If the seed funds the first engineer employee in Q1 2029, break-even moves out by 2–3 quarters. That is a choice, not a failure.
- The founder's model reached profitability in Jul 2028 with 50 clubs by Aug 2028. The difference comes from a 6-month later start, seasonality, a slower ramp, and Stripe-based payment margin.

### Downside (summary)

- Gross adds 6 / 10 / 16. Churn 1% / 2% / 2.5% a month. Costs cut further.
- Clubs at year end: 6 / 13 / 24.
- Revenue: about 10k / 56k / 118k.
- EBITDA: about –89k / –109k / –99k. Cumulative about **–297k** by end-2029, with no break-even before 2031.
- **Stop rule:** if paying clubs are under 8 by 31 Mar 2028, stop and make a deliberate decision. The options are: (a) pivot to a services and licence model for academies, (b) find a federation or strategic partner, or (c) wind down the SaaS track and keep the system for DLang.

**Validation required:** a fiduciary should review the salary, social-charge and VAT treatment. The full workbook (`DLANG_Sports_OS_Financial_Model.xlsx`) should be refreshed with these assumptions by 3 Jan 2027 (Action 13 in `09_FOUNDER_PLAN_REVIEW.md`).

---

## 11. Funding and bootstrapping options

**Capital need [Est.]:** about **CHF 240k** of cumulative operating loss through end-2029 in the base lean case, about CHF 300k in the downside. Add a 20% buffer, so plan for **CHF 290–360k** of total funding across 2027–2029, raised in tranches tied to the gates. This is roughly 3× the founder plan's CHF 81.5k stack. The founder plan already showed a CHF 107k cash trough beyond that stack.

| Source | Amount | Timing (base) | Probability / condition | Note |
|---|---|---|---|---|
| Founder funds [Founder] | CHF 15k | Now | Committed? [Verify] | |
| DLang academy covering founder time | In kind | 2027 | Founder decision | Document it as a related-party arrangement [Verify with fiduciary] |
| FIT Digital grant [Founder] | CHF 20k | Committee 1 Dec 2026 | **Model at 0%** until awarded. Was it filed by the 10 Nov deadline? [Verify] | Non-dilutive |
| >>venture>> competition | Prize amount not modelled | Submit by 30 Nov 2026 | Uncertain | Visibility and network more than money |
| Convertible loan [Founder] | EUR 50k (≈ CHF 46.5k), cap CHF 418.5k pre-money, 15–20% discount, 18–24 months | Signed by 31 Jan 2027 | Needs a GmbH and an IP assignment first | **The investor must be told about the CTO equity grant.** The cap tables disagree (founder 81% vs 64.8%) |
| CTO equity instead of cash [Founder: Structure A] | Replaces about CHF 80–120k a year of engineering cost | Decision by 8 Jan 2027, start Mar 2027 | Uncertain. A CHF 1,200/month retainer limits who will accept | Fallback: AI agents plus a paid senior reviewer for 4–8 hours a week |
| Customer prepay | 10 months' subscription upfront (annual prepay, 2 months free) | From the first clubs | Medium | Cheapest capital available. Offer annual prepay in every proposal |
| Angel bridge | CHF 100–150k | Term sheet by 30 Jun 2027, closed by Sep 2027 (downside: needed by Jun 2027) | Requires Gate 1 and 5 founding clubs | Same instrument as the convertible, at a higher cap if traction justifies it |
| Cantonal or federal innovation support | Varies | 2027 | [Verify] eligibility for Vaud programmes and Innosuisse | Usually needs a research partner or a specific project |
| Seed | CHF 0.5–1.0M [Est.] | Q1 2029 | Needs ≥ 25 clubs, CHF 10k+ MRR and retention data | Funds the first engineer employee and the EUR track. Swiss notice periods of 1–3 months mean hiring starts about a quarter after closing |

**Recommendation.** Stay bootstrapped and lean through Gate 1 and the first 5 clubs, funded by the founder, the academy, prepay and the convertible. Raise the bridge only on evidence (Gate 1 met, 5 paying clubs). Raise the seed only for the EUR track and engineering scale, at about 25 clubs. Do not raise on the "worldwide" story. Swiss and EU angels will diligence the Swiss numbers.

**Professional validation required before any money moves:**
- GmbH formation and IP assignment from the founder to the company (notary, fiduciary).
- Convertible loan terms and their interaction with the CTO grant (lawyer).
- AML status of the payment flow (counsel).
- VAT registration and EU VAT treatment (tax adviser).
- Employer social charges on any salary (fiduciary).

---

## 12. Changes vs. founder's August 2026 plan

| Topic | Founder plan | Updated | Why |
|---|---|---|---|
| Target segments | Programme-revenue orgs, ICP 100–300 athletes, Romandie | **Kept.** Schools moved to H2 2027, federations to a pilot in H2 2028, grassroots not before 2028 | The founder's segmentation is sound. Only the timing changes |
| Tier prices | Starter 290 / Club 490 / Academy 890 / Multi-site 1,690 (EUR 279/469/849/1,590) | **Kept.** Academy = Pro, Multi-site = Enterprise. Indicative USD 299/499/899, unpublished | Already shown to clubs and in the deck. Consistency matters more than renaming |
| Pricing formula | CHF 149 + 1.90 per athlete, EUR 149 + 2.00 | **Kept.** USD 149 + ~2.00 indicative | Linear and removes the incentive to under-report athletes |
| Onboarding fees | CHF 750 / 1,500 / 2,900 | **Kept.** Multi-site from CHF 5,000 [Est.] | Filters clubs and offsets CAC |
| Founding offer | 5 clubs at CHF 290 for life, 60-day refund | **Kept.** Slots close 30 Sep 2027, and founding prices are excluded from ARPA | The model applied Year-2 ARPA to locked prices |
| Payment margin | 0.9% net on 50% of collections (Payrexx-type rate) | **0.2% net** via a Stripe Connect application fee (0.5% gross). Payrexx revisited at 25+ clubs | The code is on Stripe. Stripe TWINT at 1.9% + 0.30 leaves almost no margin |
| Money flow | Not specified | **Stripe Connect direct charges. DLANG never holds club funds** | Avoids possible financial-intermediary status under anti-money-laundering law. Counsel to confirm |
| Headline claim | "Cheaper than Spond on total cost" | "Cheapest rail, QR-bill free. ROI on your audited numbers" | Plan's own table: 6,573 vs 1,755 a year |
| AI module | CHF 90, 25% attach from Month 13 | CHF 90, **off in beta**, 10% attach 2028, 20% 2029 | Out of beta scope. Not a moat. Attach rate unproven |
| Add-ons | AI only | Plus custom domain, SMS pass-through, native white-label app (2029+), premium onboarding | Brief requires a white-label packaging path, sequenced late |
| Sales cycle / CAC hours | 21 days, 22 hours | **45–90 days, 31 hours.** Bottom-up CAC ≈ 2,000 | Committee decisions. The plan's own text says 31 hours |
| LTV/CAC | 13×, payback 3.7 months, quoted | **Not quoted** before 10 clubs and 6 months of data. Target payback ≤ 12 months | Hypothetical inputs. Investors discount it anyway |
| Seasonality | None (linear adds) | ~70% of adds Feb–Sep. Churn measured at renewal | Swiss season, camps and AGM calendar |
| Model start | Month 1 = Sep 2026 | Calendar 2027–2029, from Nov 2026 status | 90-day rollout ends 22 Nov 2026 with Gates 1–3 not met |
| First paid club | Signature by 30 Nov 2026 | Feb 2027 (downside Apr 2027) | Gate 2 not met. No GmbH or contracts confirmed |
| 5 founding clubs | 31 Jan 2027 | Jun 2027 (downside Sep 2027) | Sales calendar and capacity |
| Clubs at years 1/2/3 | 13 / 50 / 118 (Aug years) | 12 / 24 / 47 (calendar years) | Later start, longer cycles, single seller |
| Revenue years 1/2/3 | 31.7k / 193.4k / 556.9k | 28.6k / 109.4k / 230.5k | As above |
| Profitability | First profitable month Jul 2028 | First break-even month Q3 2029 (lean), durable 2030 | As above, plus social charges and realistic engineering cost |
| Engineering cost | CHF 4,500/month (~CHF 43/h). Year-2 FTE at 8.5k | AI agents + senior reviewer + CTO retainer. Employee only after seed (Q1 2029) at Swiss cost (CHF 12–16k a month loaded) | Swiss contractors cost CHF 110–150/h. The FTE figure was EU-remote pricing |
| Employer social charges | Not modelled | +12% on salaries | AHV/IV/EO/ALV, accident insurance, pension [Verify with fiduciary] |
| FIT grant | 100% in the cash plan | 0% until awarded | Deadline was 10 Nov 2026. Filing status unknown |
| Capital need | CHF 81.5k stack (trough –107k) | CHF 290–360k in tranches (convertible → bridge → seed) | Later revenue and realistic costs |
| Cap table | Founder 90 → 81 → 72% vs 64.8% in the CTO proposal | One reconciled cap table before the convertible is signed | Investor disclosure |
| EU (EUR track) | "Second track" | First club signed Q2 2028, live Sep 2028. Gated on ≥ 10 CH clubs, SEPA, EU VAT, Art. 27 representative | Capacity, and no rail advantage abroad |
| US / worldwide | Deck: "worldwide, every team sport", 150 clubs / EUR 808k ARR | US exploration not before H2 2029 behind explicit gates | Wedge doesn't travel. Incumbents are consolidating. Capital and capacity are too small |
| White-label resale | Implied by the deck | Not before 2029. Gated on ≥ 25 clubs, penetration test, staffed SLA | Support burden and security exposure |
| DLang | Reference customer | Customer zero, live Feb 2027. Pays a documented founding fee once the GmbH exists. Excluded from the model | Clean books and an honest reference |
