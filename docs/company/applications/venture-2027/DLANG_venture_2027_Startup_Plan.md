---
title: "DLANG Sports OS (working name)"
subtitle: "Startup plan for >>venture>> 2027 — the operating system for club and youth sport, built Swiss-first and multi-tenant"
author: "Swiss Preparatory Sports Academy GmbH (Vaud) · Derrick Lang, Founder & CEO"
date: "Draft of 12 November 2026 · for submission by 30 November 2026"
lang: en-GB
---

::: {.cover-meta}

| | |
|---|---|
| **Company** | Swiss Preparatory Sports Academy GmbH, Canton de Vaud. Register number / UID [Confirm: UID and date of registration] |
| **Product** | DLANG Sports OS (working name). Master-brand candidate "Global Sport OS", pending a trademark clearance check. Each club runs the platform under its own name, e.g. "DLang OS" |
| **Founder / CEO** | Derrick Lang |
| **Customer zero** | DLang Basketball / Swiss Prep Sports Academy, Lausanne, 145+ athletes |
| **Stage** | Working production application; pre-revenue; **zero paying external clubs** |
| **Committed capital** | EUR 50,000 from one investor, released once a CTO is in place; founder funds about CHF 15,000 [Confirm: actual cash at 30 Nov 2026] |
| **Funding sought (2027)** | Pre-seed of about **CHF 250–300k in total** (including the EUR 50k) during H1 2027, to fund the company to November 2028 |
| **Contact** | [Confirm: e-mail and phone for the jury] |

:::

*Status of this draft.* Every figure follows the company's Financial Model v2 (December 2026 – November 2029) unless stated. Amounts are in CHF unless marked EUR. Labels: **[Confirm: …]** means only the founder knows the fact; **[Verify: …]** means a lawyer, fiduciary or the competition website must confirm it; **[Est.]** is an estimate. None of these labels may remain in the submitted PDF.

\newpage

# 1. Executive summary

**The problem.** Switzerland has about 18,310 sports clubs with 2.21 million memberships, and they depend on 351,000 unpaid volunteer positions (Vereinsstudie 2022). The organisations that run youth sport for money — academies, camp operators, school sports programmes and clubs with a paid coordinator — still run registration, invoicing, payment chasing, attendance, consents and parent communication across a spreadsheet, WhatsApp, paper forms, a bank account and the memory of one person. Money is lost to unpaid invoices and admin hours, and children's personal data sits in chat groups.

**The solution.** DLANG Sports OS is one system for the full chain: **register → pay → roster → attend → remind**. Parents register and pay by Swiss QR-bill, TWINT or card on their phone; coaches take attendance in seconds; the club sees who has paid without asking anyone. Consents and documents are recorded properly. It is built for Swiss payment rails, in French, German and English (Italian next), and it is **multi-tenant and white-label from day one**: each club runs it under its own name, colours, language, currency and terminology, on one shared codebase.

**Why us.** The founder runs the organisation the software is for. DLang Basketball / Swiss Prep Sports Academy in Lausanne (145+ athletes) is **customer zero**: no workflow is sold to another club before DLang has run it end to end. That gives a live proving ground, credibility with buyers and correct instincts about what clubs actually do in a season.

**Where we are, honestly.** The production application exists (Next.js, Supabase/Postgres with row-level security on every tenant table, Stripe, Swiss QR-bill). Admin, coach and parent apps, public registration, invoicing and card checkout work. Per-club Stripe Connect accounts (with TWINT through Stripe), CSV import and a five-language message catalogue are now in the code but are **not yet proven with real money**. The company is **pre-revenue with zero paying external clubs**. The first gate — a real DLang parent paying a real invoice by TWINT and seeing it reconcile automatically — is targeted for **18 December 2026** (downside 31 January 2027).

**Business model.** SaaS subscription plus onboarding fee: CHF 149 per club per month plus CHF 1.90 per active athlete, packaged as Starter CHF 290, Club CHF 490, Academy CHF 890 and Multi-site CHF 1,690 per month. QR-bill is free; card and TWINT run at provider cost plus a small published application fee. Five founding clubs pay CHF 290 per month for life.

**Plan.** Switzerland first, Romandie first: first paying club **February 2027** (downside April), 5 founding clubs by **June 2027**, **10 paying clubs by October 2027**, about 25 by October 2028. In 2027 we also run **two discounted paid design-partner pilots outside Switzerland** (one in the USA, one in an EU market to be chosen): no free pilots, half the list price for six months, then list; paid expansion into the EU (EUR track, from Q2 2028) and the USA stays behind written gates.

**Financials (base case, Financial Model v2).**

| CHF | Year 1 (Dec 26–Nov 27) | Year 2 (to Nov 28) | Year 3 (to Nov 29) |
|---|---|---|---|
| Paying clubs at year end | 10 | 26 | 45 |
| Revenue | 18,200 | 89,900 | 201,100 |
| EBITDA | (143,500) | (182,300) | (186,500) |
| ARR at year end | 39,600 | 117,100 | 238,500 |

**The ask.** We are raising about **CHF 250–300k** in total (including the EUR 50k committed) as a subordinated convertible loan during H1 2027, which funds the company to November 2028, and plan a seed of CHF 400–500k in Q1 2029 on evidence of 25+ clubs and monthly churn below 2%. From >>venture>> we want what a first-time Swiss software founder lacks: expert coaching on the business plan and the round, introductions to investors and to sports-sector partners, and the credibility of an independent jury.

# 2. The problem

## 2.1 Club sport runs on volunteers and on six disconnected tools

| Fact (Switzerland) | Figure | Source |
|---|---|---|
| Sports clubs affiliated to Swiss Olympic federations | 18,310 | Vereinsstudie 2022 |
| Active club memberships | 2.21 million | Vereinsstudie 2022 |
| Positions to fill nationally | 374,400, of which 351,000 unpaid | Vereinsstudie 2022 |
| Clubs with any paid staff | 13% (about 2,380) | Vereinsstudie 2022 |
| J+S youth participants (2025) | 703,700 | BASPO, Feb 2026 |
| J+S camp participant-days (2025) | 2.0 million | BASPO |
| TWINT transactions (2025) | 901 million, over 6 million users | Press reports |

A typical youth sports organisation collects money from families, assigns children to groups, puts the groups in a place at a time with a coach, records who turned up and tells everyone what happens next. Today those five operations are spread over a spreadsheet, WhatsApp groups, paper consent forms, e-banking, a website and one person's memory. The consequences are concrete:

- **Money leaks.** Invoices go out late, reminders are manual, and payments arrive by QR-bill, TWINT, card and cash with nothing reconciling them. Treasurers spend evenings matching bank lines to names.
- **Hours leak.** Registration for one camp means e-mails, forms re-typed into a spreadsheet, and messages chasing missing consents. The volunteer base that carries this load is shrinking while the administrative load rises.
- **Children's data is exposed.** Medical notes, photos and phone numbers of minors circulate in chat groups. Under the revised Swiss data-protection act (nFADP, in force since September 2023) the liable person is an individual in the club, not an abstract organisation.
- **Parents expect better.** Families pay with TWINT for everything else; registering a child for a camp should take minutes on a phone, in their language.

## 2.2 Why the existing tools leave a gap

Swiss club-management tools (ClubDesk, Webling, Fairgate, Paak) are built around the **member register and the annual fee**. Free team apps (Spond, Heja) are built around **scheduling and messaging**, with card payments as an add-on. Neither group is built around **programmes and camps** — short, priced, capacity-limited offers that families register and pay for several times a year — which is how academies, camp operators and many clubs actually earn their money. That workflow, on Swiss payment rails, in French as well as German, is the gap we target.

## 2.3 The founder's own evidence

DLang Basketball / Swiss Prep Sports Academy runs camps, programmes and a season for 145+ athletes. The product exists because the founder needed it. The measurable before-and-after on DLang (CHF outstanding, share paid within 7 days, admin hours per week) is the first case study, due **31 March 2027** (downside 30 April). [Confirm: any baseline numbers already measured at DLang — e.g. hours per week on admin, CHF outstanding at a given date — that can be quoted.]

# 3. Solution and product

## 3.1 What it does

One platform with four role-based surfaces:

| Role | Surface | What they do |
|---|---|---|
| Director / club admin and finance | Desktop web | Set up programmes, camps, teams and seasons; publish a registration link; issue invoices; see money owed and paid; send reminders; export for the accountant; manage staff, documents and consents |
| Coach | Mobile web | Today's sessions; one-tap attendance; notes; team messages |
| Parent | Mobile web app | Register a child; sign consents; pay by QR-bill, TWINT or card; see invoices, bookings and documents |
| Platform operator | Admin console | Onboard a new club (tenant), set its plan, branding, language, currency and features |

**Core chain:** public registration → automatic invoice (Swiss QR-bill PDF, card/TWINT checkout) → payment reconciliation via webhook → rosters and schedule → attendance → automated 7- and 14-day reminders → reports and exports.

**Around the chain:** families and athletes, documents and consents (recorded with version, time and signer), player-development bookings and availability, notifications by e-mail, and an **AI assistant** for club staff (see 3.4).

## 3.2 Built multi-tenant and white-label from day one

Every tenant table carries an organisation identifier and is protected by Postgres row-level security, with policies for each operation and automated cross-tenant denial tests. Branding (colours, logo), terminology (athlete/player/student, programme/team/class), language and currency are tenant settings, not code. There are no per-customer code paths. This is why a club can run the system under its own name ("DLang OS" for customer zero) while the company builds one product — and why later expansion to other markets and to resellers does not need a rewrite.

## 3.3 Product status (12 November 2026)

| Capability | Status | Next milestone |
|---|---|---|
| Admin, coach and parent apps; public registration; schedule; messaging; reminders; reports | Built | Run a full cycle on DLang by 14 Feb 2027 |
| Swiss QR-bill invoices; card checkout via Stripe | Built and working | QR-bill checked against Implementation Guidelines v2.4 (in force 14 Nov 2026) |
| Per-club Stripe Connect accounts (club is merchant of record; DLANG takes an application fee) with TWINT | Implemented in code; not yet live with real payments | **Gate 2: first real TWINT payment reconciled on DLang, 18 Dec 2026** (downside 31 Jan 2027) |
| CSV import with template; exports | Implemented in code | Tested on a real club spreadsheet before club #1 |
| Interface languages: FR, DE, EN, IT (plus ES) message catalogues | Implemented in code; translation quality to be reviewed by native speakers | FR and EN parent and invoice flows complete by 28 Feb 2027 |
| Offline-tolerant coach attendance | Not built | 28 Feb 2027 |
| Data-protection tooling (data-subject requests, retention, consents) | Implemented in code | Compliance pack signed off by a data-protection lawyer, 15 Jan 2027 |
| External security review | Not done | Booked by 4 Dec 2026; done with zero open critical/high findings by 31 Jan 2027 |

[Confirm: which of the "implemented in code" items are deployed to production today.]

## 3.4 AI assistant: a paid, strictly opt-in add-on

The platform includes an AI assistant for club staff: drafting payment reminders, answering questions about the club's own data ("who has not paid for the Easter camp?"), spotting schedule conflicts. Our rules:

- **Opt-in per club, off by default, and a paid add-on.** It is not included in any subscription tier. A club switches it on explicitly and pays for it (proposed CHF 69 per club per month [Confirm: price]); our customer-zero club DLang uses it free during the beta from February 2027, and clubs can buy it from June 2027.
- **Staff only, tenant-scoped.** It only sees the requesting club's data, and only staff can use it.
- **Data minimisation.** An allow-list keeps minors' medical notes, dates of birth and coach notes out of any external model; no tenant data is used for model training.
- **A human sends.** No AI-written message is sent to a parent automatically; anything on health or welfare goes to a human.
- **DPIA first.** A signed-off data-protection impact assessment covers AI processing before the first club opts in.

The price is set from cost: inference is about CHF 12–22 per club per month, so CHF 69 keeps a gross margin near 75%. The model in section 10 (v2 base) still carries the original CHF 90 module from Year 3 at 15%; our plan of record (section 10.3) uses CHF 69 at 20% from June 2027. AI is a retention feature, not our acquisition pitch. A paid AI add-on for parents is an idea we have specified but not committed to.

## 3.5 Technology and delivery

Next.js 15 / React 19 / TypeScript; Supabase (Postgres, row-level security, authentication, storage) in a Swiss/EU region; Stripe Connect for card and TWINT; native Swiss QR-bill generation; transactional e-mail. Engineering is delivered by a human-led team supported by **AI engineering agents** that plan, write, test and review code; a human approves every merge, a second person approves database migrations, security policies, payments and authentication changes, and agents never hold production credentials. Every change must pass type-checking, the production build and the row-level-security test suite.

# 4. Market

## 4.1 Switzerland: who can actually pay

The Swiss market is large in units and small in wallets. About 65% of clubs have up to 100 members and cannot pay CHF 290+ a month; for them free tools are rational. Our target is the **2,000–3,000 Swiss organisations that collect programme revenue from families**: private academies, camp operators, ski and football academies, international-school sports programmes and multi-sport clubs with a paid coordinator.

| Market | Units | Paying segment (SAM) | Assumed ARPA / year | SAM value / year | Obtainable by end-2029 (base) |
|---|---|---|---|---|---|
| Switzerland | 18,310 clubs | 2,000–3,000 programme-revenue organisations | CHF 5,000 | **CHF 10–15M** | 45 clubs, CHF 238.5k ARR (about 2% of SAM) |
| Romandie (beachhead: Vaud, Geneva, Valais) | share of above | about 500–700 [Est.] | CHF 5,000 | CHF 2.5–3.5M | most clubs signed in 2027–28 |

**Ideal customer:** 100–300 active athletes; at least one paid administrator; French-speaking Switzerland first; today on WhatsApp plus spreadsheet plus paper plus e-banking; **not** covered by a federation software deal; a trigger event (a treasurer leaving, missed camp payments, a new programme).

The Swiss SAM is small but reachable and sufficient for a profitable niche business at 150–300 clubs. It is also the right place to prove the product: demanding buyers, strict data protection, multilingual users and local payment rails.

## 4.2 EU and USA: large, but our Swiss advantages do not travel

| Market | Size | What changes for us | Plan |
|---|---|---|---|
| EU (EUR track: France border region first, then Germany/Austria) | Germany alone has roughly 85–90k sports clubs [Verify: DOSB and national statistics]; a similar 10–13% paid-staff share would mean tens of thousands of paying organisations [Est.] | No TWINT/QR-bill advantage; SEPA Direct Debit needed; GDPR (with an Art. 27 representative), EU VAT; French and German complete | One **discounted paid design-partner pilot in 2027** in a market to be chosen [Confirm: which market]; paid EUR track opens behind a gate, first club signed Q2 2028 at the earliest |
| USA | Very large youth-sports market (club, travel/AAU, academies, camps) [Verify: market size source] | Well-funded, consolidating incumbents; fees often passed to families; COPPA for under-13s, state privacy laws, state sales tax on SaaS; USD and US terminology | One **discounted paid design-partner pilot in 2027**, ideally in basketball through the founder's network; paid US entry not before the US gate (H2 2029 at the earliest) |

The white-label architecture means none of these markets needs a different product — only settings (currency, language, terminology, payment methods) and the legal work each market requires.

# 5. Business model and pricing

## 5.1 Revenue streams

1. **Subscription (core).** One formula, two currencies: CHF 149 per club per month plus CHF 1.90 per active athlete (EUR 149 + EUR 2.00 on the EUR track), packaged into tiers.
2. **Onboarding and migration fee.** CHF 750 / 1,500 / 2,900 by tier; average CHF 750 modelled because the early mix is Starter-heavy.
3. **Payment application fee.** Card and TWINT run through each club's own Stripe Connect account; DLANG takes a small, published application fee. QR-bill stays free and the default. On Stripe pricing this is close to zero margin (modelled at 0.2% net on 40% of collections, about CHF 4 per club per month) — **the rail is a reason to buy, not a profit line**.
4. **Add-ons.** AI assistant for club staff (a paid add-on, not in any tier: CHF 69/month proposed; free for DLang, our customer zero); custom domain; SMS at cost; later a white-label native app paid by the customer.

| Tier | Athlete cap | CHF / month | EUR / month | Onboarding (CHF) | Who it is for |
|---|---|---|---|---|---|
| Starter | 75 | 290 | 279 | 750 | Single-programme club or small camp operator |
| Club | 180 | 490 | 469 | 1,500 | **Primary target**: 100–300-athlete academy with a paid coordinator |
| Academy | 400 | 890 | 849 | 2,900 | Multi-team, multi-location operations |
| Multi-site / Federation | 1,000+ | 1,690 | 1,590 | Quoted | Academy groups, school networks, federations (pilot H2 2028) |

USD prices (indicatively USD 299 / 499 / 899) are **not published**; the US design-partner pilot will test whether US clubs pass fees to families before any US price exists.

**Founding offer.** Five Swiss founding clubs at CHF 290 per month for life (capped at the tier signed), onboarding waived, 24 months of direct founder access, a quarterly roadmap vote, 60-day money-back and month-to-month terms. Slots close 30 September 2027.

**Why DLANG never holds club money.** Parents pay directly into the club's own Stripe account (direct charges) or its bank account (QR-bill). This keeps the club the merchant of record and is designed to keep DLANG outside the scope of a Swiss financial intermediary [Verify: written legal view on anti-money-laundering scope before the first external club].

## 5.2 Unit economics (Financial Model v2 inputs, not yet measured)

| Metric | Value |
|---|---|
| Public-club ARPA by year | CHF 350 / 400 / 440 per month (founding clubs fixed at 290) |
| Gross profit per club per month | CHF 334 (gross margin about 80%, set by support, not hosting) |
| Monthly logo churn (base / upside / downside) | 1.8% / 1.2% / 2.5% |
| Bottom-up CAC (31 founder hours at CHF 60, onboarding, travel) | CHF 2,580 (CHF 1,830 net of the onboarding fee) |
| Fully loaded CAC | CHF 3,545 |
| LTV (gross profit, 48-month cap) | CHF 16,000 |
| LTV / CAC; CAC payback | 4.5×; 10.6 months |

These are model inputs. We will quote measured unit economics only after 10 paying clubs; until then the targets are payback within 12 months and churn at or below 1.5–1.8% a month.

## 5.3 The value case we sell on

We do **not** claim to be cheaper than free tools on total cost. For a 140-athlete Swiss club collecting CHF 63,000 a year, Spond costs about CHF 1,755 a year in total, mostly card fees (CHF 1,575), against about CHF 6,573 for DLANG's Club tier. What is true is that our **payment line is less than half of Spond's** (QR-bill free by default; about CHF 693 a year on the founder's comparison — closer to CHF 800–1,000 on Stripe pricing [Est.]), and that the rest of the price must be earned in **admin hours and unpaid invoices recovered**. We therefore qualify every deal on the club's own audited numbers and walk away below 3× value. The generic value case is only about 2× at CHF 490/month; Gate 1 (6 of 10 audits showing at least 3× value, by 31 January 2027) tests whether real clubs see more. A fallback price card (lower subscription plus a small fee on programme and camp value) is ready if they do not.

# 6. Competition

| Competitor | Model and price (verified Aug 2026, to re-check) | Strength | Where DLANG wins / loses |
|---|---|---|---|
| **Spond** (team app, Norway) | Free; card payments 2.5% + CHF 0.20 | Free, excellent parent and player adoption, localised to CHF | It sets the "why pay?" objection. We win only with programme/camp commerce, QR-bill free by default, TWINT reconciled, and finance reporting — proven on the club's own numbers. For scheduling and messaging alone, Spond is the right answer and we say so |
| **Fairgate** (Swiss club management) | Provided free to members under federation deals (e.g. Swiss-Ski, STV) | Federation distribution; Swiss | Hard to displace where a federation pays. We avoid those segments and sell where there is no federation deal |
| **Paak** (Swiss, sports-native) | Free under 100 members, then about CHF 29 / 99 per month | Swiss, cheap, AI on its public roadmap | **Closest threat.** We lead with programme and camp commerce, the parent payment experience and French-speaking depth, not with price or AI |
| ClubDesk, Webling (Swiss association software) | About CHF 240–310 a year | Cheap, established member registers | Loses on price for registers; not built around programmes, camps and parent payments |
| Twizzit, SportsNow | CHF 660–780 a year plus payment modules | Course booking (SportsNow) | Closer to our wedge; we compete on the full chain and Swiss-rail economics |
| **US incumbents**: PlayMetrics, Stack Sports / SportsEngine, TeamSnap, LeagueApps and others | Registration + payments + scheduling bundles; free tiers; fees often passed to families | Scale, channels, private-equity backing, consolidation | Reason not to launch in the US early. The US pilot tests whether a niche exists (basketball academies and camps) before any spend [Verify: current US market structure] |

**Our differentiators, ranked by how defensible they are:**

1. **Programme and camp commerce as the core workflow** — first in every sales conversation; we estimate a 12–24-month window.
2. **Swiss payment rails, QR-bill free by default, TWINT reconciled automatically** — strong against foreign tools, once Gate 2 passes.
3. **Data protection built in** (nFADP-aligned by design, Swiss/EU data residency, recorded consents) — the liable person in the club is the buyer.
4. **Built by an operator** who runs a 145+-athlete academy on it.
5. **White-label, multi-tenant platform** — an option for federations, school networks and resellers from 2028, not a 2027 selling point.

**What is not a moat:** the AI assistant, language support or "being Swiss" on their own. Real moats are switching cost once a club is fully migrated, segment focus, and the founder's operator network for the first ~50 customers, followed by referrals and a federation partnership.

# 7. Go-to-market

## 7.1 Sequence

| Phase | What | Base / downside | Entry condition |
|---|---|---|---|
| 0 | DLang on the platform (customer zero) | Feb 2027 / Mar 2027 | Gate 2 (TWINT reconciles) and Gate 3 (one full billing cycle) |
| 1 | Swiss programme-revenue organisations, Romandie first | First paid signature Feb 2027 / Apr 2027 | Gate 1 (willingness to pay), legal and compliance pack, security review, insurance |
| 1b | International-school sports programmes | H2 2027 | 3+ Swiss clubs live; school data-protection review |
| Learn | **Discounted paid design-partner pilots: one USA, one EU market** | Selection Q2 2027; pilots live Sep–Oct 2027 / downside Jan–Mar 2028 | See 7.4 |
| 2 | Federation or multi-site pilot | H2 2028 / 2029 | Reference base in Romandie |
| 3 | Paid EUR track (France border region, then DE/AT) | Signed Q2 2028, live Sep 2028 / 2029 | ≥10 paying Swiss clubs; gross margin ≥75%; SEPA live; EU VAT and GDPR representative set up; FR and DE complete |
| 4 | Paid US entry | Not before H2 2029 | ≥40 clubs, ≥CHF 25k MRR, net revenue retention ≥100% for 12 months, seed closed, a paying US design partner and a named channel, COPPA and sales-tax review |
| 5 | Broad white-label resale | 2029 at the earliest | ≥25 clubs on one codebase, external penetration test passed, staffable support SLA |

## 7.2 Swiss sales motion

Founder-led and consultative: **reach → workflow audit → demo on the club's own numbers → proposal and committee → close and onboard**. Realistic cycle 45–90 days, because committees decide, often at the spring general assembly. About 31 founder hours per closed club; at most two onboardings at once in 2027. The base plan needs about **37 qualified audits in Year 1** for 11 signings at a 30% audit-to-paid conversion — pipeline volume is as real a constraint as the product.

**The Swiss club calendar governs the plan.** Clubs are effectively closed from about 21 December to 4 January; committees decide January–April; summer-camp registration opens around March; season registration peaks June–September, and nobody migrates in the peak unless set up by 31 May. So we **sign January–April, go live for summer camps and the 2027/28 season**, and expect Q3–Q4 2027 to be the first real wave.

## 7.3 Channels (expected clubs to November 2027)

| Channel | Expected | Notes |
|---|---|---|
| Founder warm network in Romandie | 5–7 | The founder reports warm access to 30+ Geneva-region clubs [Confirm] |
| Camp and academy operator networks | 2–3 | The segment nobody defends |
| Reference referrals | 1–2 | Switched on after two measured case studies (Q3 2027) |
| International schools | 0–1 | Higher value, slower |
| Federations (Swiss Basketball first, via DLang) | 0 | Relationships in 2027; pilot H2 2028 |
| Paid acquisition | 0 | None before a seed |

## 7.4 Discounted paid design-partner pilots outside Switzerland (2027)

The founder has decided to run **two design-partner pilots in 2027**: one in the **USA** and one in an EU market to be chosen [Confirm: EU market — e.g. France or Germany]. **There are no free pilots**: each pilot club pays a reduced price, proposed at **50% of the Club-tier list price for the first six months, with a 12-month commitment, then the list price** (EUR 234.50 then EUR 469 a month in the EU; USD 249.50 then USD 499 in the USA) [Confirm: pilot price]. Their main purpose is learning: test the white-label platform with a non-Swiss currency, language and terminology; learn what US and EU clubs would pay and how (fees passed to families or not); and build relationships before the paid gates open. To protect the Swiss plan:

- **Capped at two**, one season of close support inside a 12-month contract, with written success criteria and an exit with full data export.
- **Start only after** DLang runs a full cycle and the first Swiss founding clubs are set up (base: after May 2027), so Swiss onboarding and the June–September peak come first.
- **Remote onboarding** from Switzerland; no hires, no paid marketing abroad; whether a paid pilot needs a local entity or tax registration is checked first [Verify: counsel].
- **Legal first:** GDPR terms and a data-processing agreement for the EU pilot; a COPPA and state-privacy review before any data of US children under 13 is collected [Verify: US counsel].
- **Payments only where the rail is ready** (Stripe Connect in the pilot country); otherwise the pilot covers registration, scheduling, attendance and communication.
- **Cost and revenue:** about CHF 15–30k of cash cost in 2027 (legal review, privacy set-up, travel, translation); our plan-of-record model carries CHF 22.5k, and the pilot fees bring back about CHF 2.6k in 2027 and about CHF 21.7k over three years [Est.].

Paid expansion stays behind the gates in 7.1. A pilot that works raises our confidence in the gate; it does not open it.

## 7.5 Positioning and brand

*"DLANG Sports OS is the operating system for sports organisations that run on programme revenue: register, pay, roster, attend, remind — in one chain, on Swiss payment rails, built by someone who runs one."* Tagline: **Run your club. Not your inbox.**

Brand layers are separate: the company, the platform brand and each club's own brand. "DLANG Sports OS" is the working name; a trademark clearance search is due **15 January 2027** (the name collides in search with the D programming language), with **"Global Sport OS"** as the leading rebrand candidate and a naming decision by **15 February 2027**. Club-facing products carry the club's own name ("DLang OS" for customer zero). Public claims follow a strict rule: no TWINT claim before Gate 2 passes, "nFADP-aligned", never "compliant", until an independent party says so, and no customers named until they have signed.

# 8. Team and hiring

## 8.1 Today

| Person | Role | Background |
|---|---|---|
| **Derrick Lang** | Founder & CEO — product direction, sales, customer zero | Founder of DLang Basketball / Swiss Prep Sports Academy, Lausanne (145+ athletes). [Confirm: short bio — playing and coaching career, years running the academy, education, languages, relevant business experience; 80–120 words] |
| Engineering | Founder-led, with contractors and an AI engineering agent team | [Confirm: any named contractor or CTO candidate the founder is willing to name; otherwise keep anonymous] |
| Advisors | [Confirm: names and roles of any advisors, or "being recruited"] | Target seats: a Swiss startup lawyer (hourly), a club or federation insider, a SaaS operator who has sold to European SMBs |

The founder concentration risk is real: today the founder is product manager, engineering manager, salesperson, support desk and operator of the reference customer. The hiring plan below is designed to hand over one role at a time.

## 8.2 The CTO plan: a human fractional CTO, supported by an AI engineering agent team

The EUR 50k investment is released **once a CTO is in place**, so this is the first hire. The model:

- **A human fractional CTO** (part-time, Swiss-based or Swiss-hours) owns architecture, security, the payment rail and merge authority. Preferred structure: a paid trial with a concrete deliverable (the TWINT reconciliation), then a retainer plus vesting equity with a one-year cliff. Decision by **8 January 2027**; start **March 2027** at the latest, allowing for Swiss notice periods.
- **An AI engineering agent team** does much of the planning, implementation, testing and first-line review under the CTO's direction. Agents are tools, not decision-makers: they hold no production credentials, a human approves every merge, and a second human approves migrations, security policies, payments, authentication and AI changes.
- **Fallback if no CTO signs by 8 January:** a paid senior reviewer for 4–8 hours a week who approves every sensitive change, plus fixed-price specialists. [Confirm: whether the investor accepts a fractional CTO, or this fallback, as "a CTO in place" for releasing the EUR 50k.]

This buys senior judgement by the hour instead of a full Lausanne salary (CHF 125–155k plus about 17% social charges), which the company cannot fund before a seed.

## 8.3 Hiring plan

| Role | When (base / downside) | Trigger | Cost (CHF) |
|---|---|---|---|
| Fractional CTO (retainer + equity) | Decide 8 Jan 2027; start by Mar 2027 | Release of the EUR 50k; Gate 2 | Engineering budget about 4.8k/month in Year 1 (incl. reviewer and agents) plus a 10k paid trial |
| Swiss fiduciary (bookkeeping, VAT, payroll) | On incorporation | — | 250–400/month |
| Part-time customer success (about 50%) | Jan 2028 / Jun 2028 | About 10–12 clubs | about 2.9k/month loaded |
| Part-time sales development | About club 25 (Q4 2028) | Pipeline beyond founder capacity | 2–3k/month |
| First salaried engineer | Q1 2029, only after a seed | Seed closed | about 10.9k/month loaded |

**Founder pay stays lean until about 30 clubs** (Year 1: CHF 2,500/month plus social charges). Product direction and closing remain the founder's job throughout.

## 8.4 Cap table

[Confirm: current shareholdings in Swiss Preparatory Sports Academy GmbH (founder %, any other holders), the EUR 50k investor's instrument and terms (convertible cap and discount, or equity %), the investor's name if it may be disclosed, the CTO equity grant (% and vesting) and any option pool.] One cap table, including the CTO grant, will be shown to every investor before signing.

# 9. Milestones (base / downside)

| When | Milestone | Evidence |
|---|---|---|
| **30 Nov 2026** | >>venture>> 2027 startup plan submitted; payment architecture decided (27 Nov); legal view on fund-holding requested | Submission receipt; decision memo |
| **Dec 2026** | Claims and deck fixed (4 Dec); security review booked (4 Dec); DLang winter-camp pilot (13 Dec); **Gate 2: first real TWINT payment reconciled on DLang (18 Dec / 31 Jan)**; IP assigned to the GmbH (31 Dec) [Confirm: status of IP assignment] | 10+ real payments auto-reconciled |
| **Jan 2027** | **CTO decision (8 Jan)**; compliance pack signed off (15 Jan); trademark clearance (15 Jan); **Gate 1: 6 of 10 audits at ≥3× value (31 Jan / 15 Mar)**; security review done; insurance bound; convertible signed | Audit write-ups; signed documents |
| **Feb 2027** | **Gate 3: DLang runs a full billing cycle (14 Feb / 31 Mar)**; **first paying external club (Feb / Apr)**; remaining beta items (offline attendance, FR/EN flows) shipped (28 Feb); naming decision (15 Feb); trademark filing (28 Feb) | DLang cycle with <5% manual matching |
| **Mar 2027** | DLang case study with measured before/after (31 Mar / 30 Apr); fractional CTO started; EUR 50k released | Signed case study |
| **Apr–May 2027** | Club #1 using it weekly (30 Apr / 30 Jun); public launch "Season 2027/28 ready"; **3 paying clubs (May / Aug)**; all 2027 clubs set up by 31 May | Invoices paid |
| **Jun 2027** | **5 founding clubs (Jun / Sep)**; pre-seed closed (target) | Signed addenda |
| **H2 2027** | DLang runs the whole club, incl. summer camps and 2027/28 registration (Sep / Oct); **US and EU discounted paid design-partner pilots running**; founding slots close (30 Sep); **10 paying clubs (Oct 2027 / Mar 2028)** | Billing; pilot reports |
| **2028** | Part-time customer success (Jan / Jun); first EUR-track club signed Q2, live Sep (base); about 25 Swiss clubs (Oct 2028 / Jun 2029); CHF 10k MRR (Dec 2028 / Q3 2029); federation or multi-site pilot H2 | Model refreshed on actuals |
| **2029** | Seed CHF 400–500k (Q1); first salaried engineer; US gate review (not before H2 2029) | Seed closed |

**Stop rule.** If fewer than 8 Swiss clubs pay by 31 March 2028, the founder decides between running a lifestyle business and stopping.

# 10. Financial plan

All figures from Financial Model v2 (December 2026 – November 2029), base case, CHF, unless stated. The model is seasonal (no signings in December or July), keeps founding clubs at CHF 290 for life, includes employer social charges and dated one-off costs (company set-up and IP 3k, compliance pack 2.5k, CTO trial 10k, security review 10k, EU entry 6k, second penetration test 10k), and excludes the 2027 design-partner pilots (they are in the plan of record, section 10.3).

## 10.1 Three-year summary (base case)

| CHF | Year 1 (Dec 26–Nov 27) | Year 2 (Dec 27–Nov 28) | Year 3 (Dec 28–Nov 29) |
|---|---|---|---|
| New clubs signed | 11 | 19 | 27 |
| **Paying clubs at year end** | **10** | **26** | **45** |
| Subscription revenue | 13,509 | 74,812 | 173,406 |
| Onboarding fees | 4,500 | 14,250 | 20,250 |
| Payment margin | 187 | 855 | 1,741 |
| AI module | 0 | 0 | 5,730 |
| **Total revenue** | **18,196** | **89,917** | **201,127** |
| Cost of revenue | (6,869) | (19,479) | (38,651) |
| **Gross profit** (margin) | **11,327** (62%) | **70,438** (78%) | **162,476** (81%) |
| Founder compensation (incl. social charges) | (34,500) | (69,000) | (96,600) |
| Engineering | (67,600) | (96,000) | (132,000) |
| Customer success | (3,600) | (39,100) | (45,600) |
| Sales and marketing | (9,600) | (18,000) | (30,000) |
| Legal, compliance, accounting | (31,100) | (18,000) | (25,600) |
| Software, insurance, admin | (8,400) | (12,600) | (19,200) |
| **Total operating costs** | **(154,800)** | **(252,700)** | **(349,000)** |
| **EBITDA** | **(143,473)** | **(182,262)** | **(186,524)** |
| **ARR at year end** | **39,629** | **117,088** | **238,522** |

## 10.2 Scenarios

| | Downside | Base | Upside |
|---|---|---|---|
| Clubs at end of Y1 / Y2 / Y3 | 6 / 15 / 27 | 10 / 26 / 45 | 17 / 45 / 87 |
| ARR end of Y3 | 136,400 | 238,500 | 465,300 |
| Monthly churn | 2.5% | 1.8% | 1.2% |
| CHF 10k MRR reached | Sep 2029 | Dec 2028 | Apr 2028 |
| First EBITDA-positive month | not before 2032 | about Q4 2030 (needs about 75–80 clubs) | Aug 2029 |

**How we read this.** This is a slow-to-scale vertical SaaS, not a hockey stick, and we would rather show that than a forecast we cannot defend. It needs either cost discipline until about 30 clubs or a seed raised on evidence. We plan both: founder pay and engineering held lean (the "lean-cost" variant moves the base cash trough from about –441k to about –314k and break-even to about mid-2030), and a seed in Q1 2029 on 25+ clubs with monthly churn below 2%.

## 10.3 Cash and the effect of the founder's 12 November decisions

The v2 base case counts the FIT Digital grant at 50% (CHF 10k) and the EUR 50k arriving in February 2027. Since then, the founder has confirmed that **FIT Digital has not been applied for** and that the EUR 50k is **released once a CTO is in place** (we assume March 2027). Re-running the model with those two changes (all else equal):

| Base case, CHF | v2 model | With 12 Nov facts |
|---|---|---|
| Committed stack | 71,500 (founder 15k + EUR 50k ≈ 46.5k + FIT 10k) | **61,500** (founder 15k + EUR 50k ≈ 46.5k) |
| Lowest cash before the EUR 50k arrives | –17,550 (Jan 2027) | **–43,500 (Feb 2027)** |
| Cash negative from | Apr 2027 (briefly negative in Jan) | **Jan 2027, without recovery** |
| Unfunded shortfall at Nov 2027 / Nov 2028 / Nov 2029 | 72k / 254k / 441k | **82k / 264k / 451k** |
| Same, lean-cost variant (founder pay and engineering capped in Y2–Y3) | — / — / 314k | 82k / 214k / 324k |
| **Plan of record** (lean costs, plus the paid AI add-on and the two discounted paid pilots with their costs) | — | **102k / 225k / 326k** |

**Immediate consequence:** January–March 2027 must be bridged by about CHF 45k before the EUR 50k is released — by the founder, by an advance from the investor, or by moving the CTO trial and penetration-test costs later. [Confirm: how January–March 2027 will be funded.]

# 11. Funding need and use of funds

## 11.1 How much, when, and in what form

| Funded through | Unfunded need (base) | Including a 3-month buffer | Instrument |
|---|---|---|---|
| November 2027 | about CHF 82k | **about CHF 120k** | Upsize the January 2027 convertible, or a bridge by April 2027 |
| November 2028 | about CHF 264k | **about CHF 300–310k** | **Pre-seed of CHF 250–300k in total in H1 2027 (target)** |
| November 2029 | about CHF 451k | about CHF 500k | Seed of CHF 400–500k in Q1 2029, raised from Q3 2028 |

**Instrument.** A subordinated convertible loan in CHF (FX fixed at signing), cap stated post-money, discount 15–20%, maturity 18–24 months or a qualified round, converting into newly issued shares; signed only after all IP is assigned to the company and with the CTO equity grant disclosed [Verify: Swiss startup lawyer]. The committed EUR 50k is the first close [Confirm: investor name if disclosable, and agreed terms].

**Non-dilutive sources**, counted at zero until received: >>venture>> 2027; FIT Digital (not yet applied — next window [Verify]); GENILEM coaching; Innosuisse instruments where they fit [Verify].

## 11.2 Use of funds, December 2026 – November 2028 (base case)

| Use | CHF (24 months) | Share | What it buys |
|---|---|---|---|
| Engineering | 163,600 | 38% | Fractional CTO and paid trial, senior reviewer, contractors, AI engineering agents; offline attendance, payment hardening, onboarding productisation, integrations |
| Founder compensation (lean, incl. social charges) | 103,500 | 24% | A below-market draw until about 30 clubs |
| Legal, compliance, accounting | 49,100 | 11% | GmbH and IP, compliance pack (ROPA, DPIA, DPA, privacy notices), external security review, insurance, fiduciary, EU entry preparation |
| Customer success | 42,700 | 10% | Part-time customer-success lead from January 2028; tooling |
| Sales and marketing | 27,600 | 6% | Founder-led sales in Romandie, launch materials, events; no paid acquisition |
| Cost of revenue (hosting, e-mail, support delivery) | 26,300 | 6% | Swiss/EU hosting and per-club support |
| Software, insurance, admin | 21,000 | 5% | Tools, cyber and professional liability insurance, contingency |
| **Total cost** | **433,800** | **100%** | |
| Less: revenue over the period | (108,100) | | |
| Less: committed (founder 15k + EUR 50k ≈ 46.5k) | (61,500) | | |
| **New money needed** (before buffer) | **about 264,000** | | |

Not included: the 2027 design-partner pilots (about CHF 22.5k of cost, partly offset by their discounted fees; in the plan of record, section 10.3) and any prize money from >>venture>>.

# 12. Risks and mitigations

| # | Risk | Likelihood / impact | Mitigation | Trigger to act |
|---|---|---|---|---|
| 1 | **Payment rail slips** (TWINT/Connect activation, reconciliation bugs) | High / critical | Payments are the only engineering priority until Gate 2; QR-bill to the club's own account and a documented alternative provider as fallback; run the founding beta manually if needed | Not live on DLang by 31 Dec 2026 |
| 2 | **No willingness to pay at CHF 290–490** against free tools | Medium-high / critical | Audit private academies and camp operators first; qualify on the club's own numbers; walk away below 3×; fallback price card ready | Fewer than 6 of 10 audits at 3× by 31 Jan 2027 |
| 3 | **Cash runs out** — negative from January 2027 on today's stack | High / critical | Bridge Jan–Mar 2027; pre-seed of CHF 250–300k in H1 2027; lean founder pay and engineering until about 30 clubs; grants at zero until paid | Downside runway below 6 months at any monthly review |
| 4 | **Founder capacity** | High / critical | Hours-based capacity (fractional CTO, reviewer, agents); at most two concurrent onboardings; productised onboarding Feb–May 2027; design-partner pilots capped at two and started after the Swiss set-up window | Two weeks with nothing shipped, or >2 concurrent onboardings |
| 5 | **CTO search drags**, delaying release of the EUR 50k | High / medium | Decision on 8 January; reviewer model pre-contracted; agree with the investor what counts as "CTO in place" | No signed terms by 8 Jan 2027 |
| 6 | **Breach or tenant leak of children's data** | Low-medium / critical | Row-level security with cross-tenant tests; external security review; second approver on sensitive changes; DPIA; minimal data; private storage with signed URLs and audit logs; insurance | Any critical finding or incident |
| 7 | **Fund-holding / anti-money-laundering exposure** | Medium / high | Direct charges into each club's own account only; written legal view before the first external club | No legal view by 15 Jan 2027 |
| 8 | **AI assistant misuse or data exposure** | Low-medium / high | Opt-in per club, staff only, allow-list excluding minors' sensitive data, no auto-send to parents, DPIA before first opt-in, no training on tenant data | Any incident or complaint |
| 9 | **Distraction from early international pilots** | Medium / medium | Two discounted paid pilots maximum, with written scope, remote, no hires; full-price expansion behind written gates | Swiss milestones slip by more than one month |
| 10 | **Spond or Paak closes the gap** (TWINT/QR-bill or AI) | Medium / high | Lead with programme and camp commerce and the parent experience; switching cost through full migration | Competitor ships TWINT/QR-bill reconciliation |
| 11 | **Seasonal timing missed** | Medium / medium-high | Sign January–April; set-up deadline 31 May | Fewer than 2 clubs signed by 30 Apr 2027 |
| 12 | **IP, entity and cap-table questions block investment** | Medium / high | Present assignment of all IP to the GmbH by 31 Dec 2026; one cap table including the CTO grant; ring-fence the software business from academy operations [Confirm: whether academy operations and the software business sit in the same GmbH] | Before the convertible signs |
| 13 | **Name or trademark conflict** | Medium / low-medium | Clearance by 15 Jan 2027; "Global Sport OS" as candidate; club-facing products carry the club's own name | Clearance search negative |
| 14 | **Dependence on one reference customer** | Low / medium | Second measured reference club by Q3 2027 | Academy circumstances change |

# 13. Why >>venture>>, and what we ask of it

>>venture>> is Switzerland's established start-up competition for business plans, with expert coaching and a jury drawn from the Swiss investor and business community [Verify on venture.ch: organisers, categories, prize amounts, phases and dates of the 2027 edition]. For DLANG Sports OS, the competition matters for three reasons:

1. **Coaching on the plan and the round.** We are a first-time software company with a credible operator-founder; independent feedback on pricing, the pre-seed size and the convertible terms is directly useful in Q1 2027, when the round is negotiated.
2. **Network.** Introductions to Swiss pre-seed investors, to potential fractional CTOs and to sports-sector partners (federations, cantonal sport offices, school networks).
3. **Credibility.** An independent jury's assessment helps with club committees, which are cautious buyers.

**What we commit to show the jury by the finals** [Verify on venture.ch: timing of jury rounds]: Gate 2 passed on DLang (real TWINT payments reconciled), the result of Gate 1 (10 audits, priced), the CTO decision, the DLang case study with measured numbers, and the first paying founding clubs — or a plain account of which of these slipped and why.

---

# Appendix A — Assumptions and sources

- **Financial Model v2** (company workbook, December 2026 – November 2029; Base/Bull/Bear). Key inputs: base new clubs 11/19/27; monthly churn 1.8%; public ARPA CHF 350/400/440; founding clubs CHF 290 for life; average onboarding fee CHF 750; 40% of collections through the platform at 0.2% net margin; support CHF 65 per club per month; founder pay CHF 2.5k/5k/7k per month plus 15% social charges; engineering CHF 4.8k/8k/11k per month plus a CHF 10k CTO trial; part-time customer success from January 2028; AI module from December 2028 at 15% attach; EUR/CHF 0.93.
- **12 November 2026 adjustment** (section 10.3): FIT grant probability set to 0% and the convertible's cash month moved from February to March 2027; all other inputs unchanged. **Plan of record** (workbook v2.2): additionally lean costs, the AI add-on at CHF 69 with 20% attach from June 2027 (free for DLang), and the two discounted paid pilots with CHF 22.5k of cost.
- **Market data:** Vereinsstudie 2022 (Swiss Olympic / BASPO); BASPO J+S figures (February 2026); TWINT volumes from press reports. Competitor prices verified August 2026 and to be re-checked before submission [Verify].
- **Regulation relied on:** Swiss QR-bill Implementation Guidelines v2.4 (in force 14 November 2026); revised Swiss Federal Act on Data Protection (nFADP); EU GDPR; US COPPA. [Verify: legal positions with counsel.]
- **Company documents:** Business Plan v2 and Rollout v2 (11 November 2026), Executive Operating Plan, Business Model, Go-to-Market and Financial Model v2 notes.
