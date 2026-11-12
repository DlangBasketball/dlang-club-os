# DLANG Sports OS: Go-to-Market and Launch Plan

**Status:** working document, re-baselined 11 November 2026; updated 12 November 2026 with the founder's decisions (`11_FOUNDER_DECISIONS_2026-11-12.md`), including **round 2**: no free pilots anywhere (EU and US pilots are discounted paid pilots), and the AI assistant is a paid club add-on (DLang free)
**Builds on:** the founder's August 2026 Business Plan (§7 go-to-market, §7.4 founding programme, §7.5 federation strategy), 90-Day Rollout, Financial Model, CTO Partnership Proposal and Investor Deck (`docs/company/source/`), the strategy review `09_FOUNDER_PLAN_REVIEW.md`, and `01_BUSINESS_MODEL.md` (pricing and phasing, which this document follows).

**Labels**
- **[Founder]**: from the founder's August 2026 materials, kept.
- **[Est.]**: an estimate or assumption made here.
- **[Verify]**: check against a live source, or have a lawyer, tax adviser or fiduciary validate it, before relying on it externally.

---

## 1. Decisions in brief

1. **One full-price market at a time, plus two discounted paid pilots.** Switzerland (Romandie first) is the only market **sold to at list price** in 2027. The founder wants an EU and US presence in 2027, so there is **one discounted paid EU design-partner pilot** (live Sep 2027 / downside Jan 2028) and **one discounted paid US design-partner pilot** (US fall season, live Sep–Oct 2027 / downside Mar 2028), each behind entry conditions (§5.5, §6.5). Full-price EUR-track sales open only when ≥ 10 Swiss clubs pay (base: first full-price EU club signed Q2 2028, or **early 2028 if the EU pilot is strong**; live Sep 2028). Full-price US sales: not before H2 2029. Broad white-label resale: 2029 at the earliest.
2. **DLang Basketball is customer zero and the lighthouse.** No external club is promised a payment flow that DLang has not run end to end. DLang goes live Feb 2027 (downside Mar 2027) and its before/after figures become the case study by 31 Mar 2027.
3. **Founder-led selling, sequenced to the Swiss club calendar.** The signing window is Jan–Jun; nobody is onboarded during the Jun–Sep registration peak unless set up by end of May. Sales cycle planned at 45–90 days, not the 21 days in the founder plan.
4. **Paid pilots everywhere; no free pilots** (founder, 12 Nov 2026, round 2). The Swiss pilot programme *is* the founder's founding programme: 5 clubs at CHF 290/month for life, 60-day refund, month-to-month. Up to 5 further "design pilot" clubs at list price with the same refund. **No free pilots in Switzerland once live, and none abroad.** Exactly one EU and one US design-partner pilot, used as a model and case study, both **discounted paid** ("so we don't lose"): proposed **50% off the Club-tier list for the first 6 months, 12-month commitment, then list** (EU EUR 234.50 then 469; US USD 249.50 then 499 indicative), onboarding at 50% [Est.][Confirm]. The earlier "second free pilot in a market TBD" is removed; that market pays the reduced price.
5. **Partners come after proof.** Referral rewards switch on after two clubs show measured results (~Q3 2027). Implementation partners 2028. White-label resellers 2029, behind a gate.

---

## 2. Where we actually start (11 Nov 2026)

| Item | Status | Implication for GTM |
|---|---|---|
| Paying external clubs | 0 [Founder, Aug 2026; still assumed 0] | Every claim is "pilot", never "customers" |
| Reference customer | DLang Basketball / Swiss Prep Sports Academy, 145+ athletes [Founder] | Lighthouse, but not yet live on the product |
| Warm network | 30+ Geneva-region football and ski clubs [Founder claim] | Channel 1; expect 20–25% conversion over 12 months, i.e. 6–8 clubs [Founder] |
| Product | Card checkout and QR-bill work. TWINT is a label only. No Stripe Connect. Missing: CSV import, translation layer, offline attendance, per-club payment accounts [Review] | First external signature cannot happen before TWINT reconciles on DLang and Connect exists |
| Company | **Swiss Preparatory Sports Academy GmbH (SPSA)**, Vaud; bank account "SPSA Tech" [Founder, 12 Nov; Confirm register no. and date]. FIT not filed (0%). EUR 50k secured, released once a CTO is in place | Contracts are signed by SPSA. IP present assignment to SPSA by 31 Dec 2026. Prospect clubs will notice they contract with another club's company: have the answer ready (ring-fenced "SPSA Tech", DPA, possible carve-out) [Verify with lawyer] |
| Original rollout | Gates of 20 Sep / 18 Oct / 22 Nov 2026 not met (Gate 2 very probably not met) | All dates below are re-baselined |

---

## 3. Market sequencing and why

| Phase | Market | Entry gate | Base date | Downside | Why this order |
|---|---|---|---|---|---|
| 0 | DLang (customer zero) | Gate 2: TWINT reconciles automatically | live Feb 2027 | Mar 2027 | Without money moving end to end there is nothing to sell |
| 1 | Romandie (VD, GE, VS) | Gate 1 (≥ 6/10 audits at 3× value) + GmbH + contract set | first paid Feb 2027 | Apr 2027 | Founder network, French-speaking, under-served vs German-speaking CH [Founder] |
| 1b | Rest of CH (BE/FR bilingual, ZH, BS, then Ticino) | DE interface live; 5 founding clubs live | from Q4 2027 | 2028 | Same rails (TWINT, QR-bill); needs DE (and later IT) |
| 1c | EU discounted paid design-partner pilot (12 Nov; paid since round 2) | DLang live + ≥ 3 paying CH clubs; EUR/SEPA and FR/DE complete; GDPR pack incl. Art. 27 representative; support hours covered | live Sep 2027 | Jan 2028 | Founder wants an EU presence in 2027; one discounted pilot buys a case study cheaply and tests willingness to pay |
| 1d | US discounted paid design-partner pilot (12 Nov; paid since round 2) | Same conditions; USD, US English, COPPA verifiable parental consent; cross-border Connect and sales tax on a paid pilot [Verify] | live Sep–Oct 2027 (fall season) | Mar 2028 (spring season) | Founder wants a US presence in 2027; learning first, a small discounted fee |
| 2 | EU (EUR track, paid) | ≥ 10 paying CH clubs, SEPA, EU VAT set-up, GDPR Art. 27 representative, DE/FR contract texts | signed Q2 2028 (early 2028 on a strong pilot), live Sep 2028 | 2029 | Same product, but the Swiss payment wedge disappears; must win on workflow alone |
| 3 | Federation / multi-site pilot | One live reference club in the federation's sport | H2 2028 | 2029 | Founder §7.5 sequence, kept |
| 4 | USA (paid) | ≥ 40 clubs, CHF 25k+ MRR, NRR ≥ 100%, seed closed, the 2027 design partner (or another) paying + channel | not before H2 2029 | later | No Swiss advantage carries over; incumbents consolidating; capital and capacity too small before then |
| 5 | Broad white-label resale | ≥ 25 clubs on one codebase, external pen test, staffable support SLA | 2029 earliest | later | A reseller multiplies support load before the company can carry it |

**Where ambition and realism diverge.** The deck says "worldwide, every team sport" and 150 clubs / EUR 808k ARR. The code is already multi-tenant and white-label capable, so the product is not the bottleneck. The bottlenecks are one founder's selling hours, a Swiss calendar where signing concentrates in Jan–Jun, per-country payment and compliance set-up, and capital. We put the deck's numbers on the deck's timeline at under 15% likelihood and 10 clubs by end-2027 at 50–60% [Review estimate]. "Any sport, any country" stays the product architecture; it is not the 2027 sales plan. The two discounted paid pilots are the honest way to start abroad in 2027: they cost about CHF 15–30k and 150–250 founder and CTO hours [Est.] and go live during the Swiss peak; workbook v2.2 carries CHF 22.5k of cost and the discounted fees (about CHF 2.6k in 2027, about 21.7k over three years).

---

## 4. Switzerland (home market)

### 4.1 ICP and segments

**ICP [Founder, kept]:** 100–300 active athletes, at least one paid administrator or coordinator, Vaud / Geneva / Valais first, no federation software deal, current tooling WhatsApp + spreadsheet + paper + bank account, a recent trigger event (lost treasurer, unpaid camp fees, parent complaint, new programme). Qualify only on the club's own audited value ≥ 3× price.

| Order | Segment | Why first/later | Typical decider and cycle [Est.] |
|---|---|---|---|
| 1 | Private academies and camp operators | Programme revenue, few deciders, nobody defends this segment [Founder] | Owner/director, 30–60 days |
| 2 | Multi-sport clubs with a paid coordinator | Real pain, but committee-driven | Comité, 45–90 days; clusters around the AGM and pre-season |
| 3 | International schools / private-school sport programmes | Higher ACV, outside the Verein ecosystem | Head of activities + bursar; for an August start, decided Jan–Apr; data-protection review |
| Later | Grassroots volunteer clubs (< 100 members) | Cannot pay CHF 290+; Spond is free | Only via a federation deal, 2028+ |
| Avoid | Clubs given Fairgate free through Swiss-Ski / STV | Hard sell for non-product reasons [Founder] | — |

### 4.2 The Swiss sales calendar (plan around it)

| Months | What clubs are doing | What DLANG does |
|---|---|---|
| Nov–Dec | Season running; winter camps being sold; Christmas slowdown from ~20 Dec | DLang go-live work; book January audits now; no closing expected 21 Dec–4 Jan |
| Jan–Mar | Budgets, AGMs, committee meetings; planning next season and summer camps | **Main audit and proposal window.** Get on comité agendas |
| Apr–May | Decisions for summer camps and next season; registration pages being prepared | **Main signing and onboarding window.** Last safe onboarding: end of May |
| Jun–Sep | Registration peak; summer camps; season start Aug/Sep | No new migrations mid-peak. Support live clubs; collect usage data; note trigger events for autumn |
| Oct | Post-start pain is visible (unpaid fees, attendance chaos) | Second, smaller audit window; plan Jan–Feb onboarding for spring programmes |

Consequence: a club audited in October usually signs in January–March and goes live for its spring or summer programme. This, not product readiness alone, is why 5 founding clubs land in Jun 2027 (base), not Jan 2027.

### 4.3 Channels, ranked by expected value

| # | Channel | Expected clubs by end-2027 [Est.] | Cost | Notes |
|---|---|---|---|---|
| 1 | Founder warm network (Romandie) | 5–7 | Founder time | Work the 30+ list as a ranked pipeline; maximum 2 onboardings in parallel |
| 2 | Camp and academy operator networks | 2–3 | Low | Operators talk to each other; not covered by federation deals [Founder] |
| 3 | DLang lighthouse: demo days, parent experience, coach word of mouth | 1–2 | Low | Invite directors to watch a real registration and payment cycle at DLang (from Mar 2027) |
| 4 | Reference referral | 0–2 in 2027, more in 2028 | 1 month free for both sides [Founder] | Switch on after two clubs have measured results (base Q3 2027) |
| 5 | International schools | 0–1 in 2027 | Medium, slow | Prepare the security and data-protection pack first; target Aug 2028 school-year starts |
| 6 | Federations and cantonal bodies | 0 revenue in 2027 | Relationship time | Year-2 bet (see 4.4) |
| 7 | Content / SEO (FR first, then DE) | Inbound leads only from 2028 | Founder + AI-assisted drafting, reviewed by a human | Topics clubs search for: QR-bill for clubs, TWINT collection, camp registration, unpaid fees. Compounds slowly; start Q2 2027 |
| 8 | Paid ads | 0 | — | Not in 2027 [Founder]. Market too small and relationship-driven |
| 9 | Events | Leads, not closes | Low | Cantonal association AGMs, coach education days, regional sport-admin gatherings [Verify calendars]. Go with a DLang case study, not a booth |

### 4.4 Federations, cantonal sport offices and J+S

The founder's §7.5 sequence is kept: relationship now, no revenue expected in 2027, group deal months 15–24.

| Body | What they want | What DLANG offers | Timing |
|---|---|---|---|
| **Swiss Basketball** and its regional associations | Well-run, growing member clubs; youth participation data | DLang as a live reference in their own sport; later a no-cost aggregate dashboard across participating clubs | Intro meeting H1 2027 with DLang figures; pilot H2 2028 (downside 2029) |
| **Cantonal sport offices** (e.g. Vaud, Geneva, Valais) [Verify names and contacts] | Healthy club ecosystems; camp and J+S activity | Visibility, not sales: listing in club-resource pages, invitations to club-admin training | Start Q2 2027 |
| **Jugend+Sport (J+S, BASPO)** | Correct course and attendance data from J+S coaches | **Opportunity, not a feature yet:** attendance export shaped for J+S course administration [Verify with BASPO what interfaces exist or are permitted] | Validate the pain with 5 clubs in 2027 [Founder]; build only if validated; never promise it in a sale before then |
| **Swiss Olympic / national federations with software deals** | Their existing vendor relationships | Nothing in 2027–28 | Avoid head-on competition with Fairgate / clubcorner deals |

J+S matters because it is a uniquely Swiss compliance chore with very large reach (703,700 J+S youth participants in 2025 [Founder, citing BASPO]). If clubs confirm it is painful, it becomes a lock-in no foreign competitor will build. Until validated, it stays off sales materials.

### 4.5 Sales motion (Switzerland)

**Stages [Founder §7.2, kept] with realistic durations:**

| Stage | What happens | Founder plan | Updated [Est.] |
|---|---|---|---|
| 1. Reach | Warm intro or approach naming an observed problem | Day 0 | Day 0 |
| 2. Workflow audit | 20 min: how they register, collect, chase; write their numbers down | Day 1–3 | Week 1–2 |
| 3. Demo against their numbers | Product with their programme names; ROI arithmetic | Day 4–10 | Week 2–4 |
| 4. Proposal and comité | One-page proposal that survives without the founder in the room | Day 10–17 | Week 4–10 (comité dates rule) |
| 5. Close and onboard | Signature, onboarding fee invoiced, kickoff within 7 days | Day 17–21 | Week 6–13 |

- **Cycle:** 45–90 days (owner-run academies at the short end, comités at the long end). The 21-day cycle is kept as the best case, not the plan.
- **Founder hours per closed club:** plan on 31 h [Founder plan figure, not the model's 22 h]; target 20 h by club 10 through onboarding productisation.
- **WIP cap:** max 2 clubs onboarding at once, max ~8 open proposals.
- **Objection handling [Founder, kept] with one correction:** do not say DLANG is cheaper than Spond on total cost. It is not on the plan's own table (CHF 6,573 vs 1,755 a year). Say it is the cheapest **payment rail** for clubs that collect real money: QR-bill free and the default, payment fees CHF 693 vs Spond's 1,575 on CHF 63k collections [Founder figures].
- **Evolution:** founder-led through ~club 10 → part-time customer success Jan 2028 (downside Jun 2028) → part-time SDR / inside sales at ~club 25 (base Oct 2028) → implementation partners 2028 → white-label resellers 2029+.

### 4.6 Localisation, pricing, legal and payment prerequisites

| Area | Requirement | Status / deadline |
|---|---|---|
| Language | FR (first), EN, then DE; IT for Ticino later. Parent messages in the parent's language | No translation layer in repo; FR/EN/DE by 28 Feb 2027; IT 2028 |
| Rails | QR-bill (free, default), TWINT, card | TWINT live on DLang 18 Dec 2026 (red line 31 Jan 2027); check the QR-bill guideline change the review flags for 14 Nov 2026 [Verify] |
| Payment architecture | Stripe Connect so DLANG never holds club money; per-club payment accounts | Decision by 27 Nov 2026; **legal view on whether DLANG holding funds would trigger anti-money-laundering obligations** [Verify with counsel] |
| Pricing | CHF 149 + 1.90/athlete; Starter 290 / Club 490 / Academy 890 / Multi-site 1,690; onboarding CHF 750 / 1,500 / 2,900 [Founder] | Kept. Gate 1 fallback price card by 15 Dec 2026 (see `01_BUSINESS_MODEL.md` §5.5) |
| VAT | Swiss VAT 8.1% once registered; mandatory threshold and voluntary early registration | [Verify with fiduciary] before the first invoice |
| Company and contracts | GmbH, IP assigned from founder to company, T&Cs, DPA, privacy notice, record of processing | GmbH + IP by 31 Dec 2026; compliance pack by 15 Jan 2027 [Verify with lawyer] |
| Data protection | nFADP: minors' data, medical info, consent; hosting region disclosed | Do not say "nFADP-compliant" until reviewed [Founder rule]; external security review booked by 4 Dec, done by 31 Jan |
| Product gaps for selling | CSV import, offline attendance | By 28 Feb 2027; until then onboarding uses assisted import |

### 4.7 Switzerland 90-day launch plan (weekly, 16 Nov 2026 – 14 Feb 2027)

| Week | Dates | Milestones | Exit test |
|---|---|---|---|
| W1 | 16–22 Nov | **Truth week:** entity (SPSA GmbH), FIT (not filed), round (EUR 50k on CTO release), CTO (none yet) and rail (Stripe Connect) answered 12 Nov; still confirm audits done, cash and SPSA register details; retrospective on the Aug plan (by 20 Nov). Draft payment architecture | Written status sheet; open questions to lawyer/fiduciary sent |
| W2 | 23–29 Nov | **Stripe Connect accepted (12 Nov); DLang Connect application 27 Nov.** >>venture>> submission (deadline 30 Nov; draft in `applications/venture-2027/`). Fractional CTO shortlist (30 Nov). Build ranked list of 30+ warm contacts; segment academies/camps first | Connect application filed; >>venture>> filed; list of 15 audit targets |
| W3 | 30 Nov–6 Dec | Fix deck and claims (4 Dec). Book external security review (4 Dec). Start Connect onboarding for DLang. Book 6+ audits for January | Deck has no "worldwide", no "€6,160 MVP", no unbuilt modules; 6 audits in calendars |
| W4 | 7–13 Dec | TWINT + reconciliation build; DLang pilot data loaded. 2 audits before the holidays where possible. Fractional CTO signed and Jan–Mar bridge agreed (by 15 Dec) | Test TWINT payment reconciles in staging |
| W5 | 14–20 Dec | **Gate 2 target (18 Dec):** a real TWINT payment reconciles on DLang. Gate 1 fallback price card ready (15 Dec) | Real CHF payment from a DLang parent auto-matched |
| W6 | 21–27 Dec | Holiday: maintenance only. Founder off sales | — |
| W7 | 28 Dec–3 Jan | Holiday: model refresh (3 Jan). GmbH and IP assignment completed (31 Dec) | Updated model with seasonality and 45–90 day cycle |
| W8 | 4–10 Jan | **CTO structure proposal (8 Jan)** from the fractional CTO signed by 15 Dec (reviewer model if the CTO slips; latest 31 Jan). Translation layer work begins (FR first). Audits resume (2–3 this week) | Decision communicated; audits 3/10 done |
| W9 | 11–17 Jan | DLang spring invoicing run through the product. Compliance pack (15 Jan): T&Cs, DPA, privacy notice. Audits 6/10 | DLang invoices sent with QR-bill + TWINT; pack reviewed by counsel |
| W10 | 18–24 Jan | Security review in progress; fixes. Proposals to the 2–3 best audits. Comité dates identified | ≥ 3 proposals out, each with a named decision date |
| W11 | 25–31 Jan | **Gate 1 (31 Jan):** ≥ 6 of 10 audits at 3×. **First founding club signed (31 Jan).** Security review done. Convertible signed (31 Jan) | Signature + onboarding kickoff booked within 7 days |
| W12 | 1–7 Feb | Onboarding productised: setup checklist, assisted import template, training video in FR. Founding club #1 kickoff | Club #1 test invoice renders with its logo and valid QR-bill |
| W13 | 8–14 Feb | **Gate 3 (14 Feb):** DLang runs one full cycle (register → pay → roster → attend → remind). Club #1 first real registrations | DLang cycle complete with < 5% manual payment matching |

**Stop rules (kept in spirit from the founder rollout):** if Gate 2 is not met by 31 Jan 2027, sell only as a "manual-payment beta" at Starter price and defer founding slots. If Gate 1 fails by 15 Mar 2027 (downside), switch to the fallback price card rather than discounting list prices, and re-audit the segment choice.

**After W13 (base / downside):** 3 clubs May / Aug 2027 · 5 founding clubs Jun / Sep 2027 (slots close 30 Sep 2027) · DLang runs camps + 2027/28 registration Sep / Oct 2027 · 10 clubs Oct 2027 / Mar 2028 · 25 clubs Oct 2028 / Jun 2029 · CHF 10k MRR Q4 2028 / Q3 2029.

### 4.8 Switzerland KPIs

| KPI | Target 2027 [Est.] | Why |
|---|---|---|
| Workflow audits completed | 10 by 31 Jan; 30 by end-2027 | Pipeline volume |
| Audits at ≥ 3× value | ≥ 60% | Gate 1; validates price |
| Audit → signature conversion | 20–25% | Founder assumption, now measured |
| Median sales cycle | ≤ 75 days | Tracks the 45–90 day assumption |
| Signature → first real registration | ≤ 14 days | Strongest churn predictor [Founder] |
| Founder hours per onboarded club | ≤ 31 h, falling to 20 h | Capacity |
| Weekly active admins per club | ≥ 1 every week | Gate 3b (club #1 weekly: 30 Apr / 30 Jun 2027) |
| Share of payments auto-reconciled | ≥ 95% | The core promise |
| Parent payment completion (reminder → paid) | +20 points vs club's baseline | Value proof for case studies |
| Logo churn | < 1.5% per month [Founder base] | Retention |
| Paying clubs | 10 by Oct 2027 (base) | Headline |

---

## 5. European Union (EUR track)

### 5.1 Country prioritisation

The Swiss wedge (TWINT, QR-bill, Romandie network) does not travel. In the EU DLANG sells workflow (registration → payment → attendance → reminders in one chain) against local incumbents and free tools. So the order follows language reuse, proximity and network, not market size.

| Rank | Market | Rationale | Risks |
|---|---|---|---|
| 1 | **France, Grand Genève border (Haute-Savoie, Ain), then Auvergne-Rhône-Alpes** | FR product already built; drivable; cross-border families already in Geneva clubs; camp and academy operators serve both sides | Associations (loi 1901) are budget-constrained; card/SEPA norms; French e-invoicing rules [Verify applicability] |
| 2 | **Germany and Austria (DACH ex-CH)** | DE interface built for Swiss-German expansion; large, organised club sector; academies and camps exist | Strong local club software and federation tools; Verein culture is price-sensitive; GDPR scrutiny is high |
| 3 | **Benelux** | English widely accepted for admin tools; multilingual like CH; compact | Small; needs NL eventually; incumbents unknown [Verify] |
| 4 | **Italy (north)** | Natural follow-on from IT built for Ticino; strong youth basketball/football academy culture | IT localisation not before 2028; payment habits differ [Verify] |
| 5 | **Spain** | Large youth-sport and camp market | No language or network advantage; furthest; last |

### 5.2 ICP, channels and motion (EU)

- **ICP:** same as CH: academies, camp operators and multi-sport clubs with paid staff, 100–300 athletes, collecting programme fees. Add: comfortable with an English or French contract.
- **Channels:** (1) Swiss clients' cross-border relationships and coaches; (2) camp and academy operator networks (international camps recruit across borders); (3) basketball network via DLang (tournaments, coach clinics); (4) FR/DE content reused from the Swiss SEO work; (5) local implementation partners from 2029.
- **Motion:** founder-led remote demos plus one in-person visit per closing club; no local hire before 10 EU clubs.

### 5.3 Pricing, localisation and prerequisites (EU)

| Area | Requirement |
|---|---|
| Pricing | EUR 149 + 2.00/athlete; Starter 279 / Club 469 / Academy 849 / Multi-site 1,590 [Founder]. Stated as EUR price points, not conversions |
| Payments | SEPA Direct Debit and cards via Stripe Connect; local methods per country [Verify per market]. No QR-bill/TWINT advantage |
| Tax | EU VAT handling: reverse charge for VAT-registered customers; OSS/non-Union scheme for non-registered clubs [Verify with tax adviser] |
| Data protection | GDPR; **Art. 27 EU representative** (DLANG is a Swiss controller/processor); DPA in FR/DE; EU hosting confirmed |
| Contracts | FR/DE terms; governing law and jurisdiction clause [Verify with lawyer] |
| Product | FR/DE/EN interface; EUR formatting; SEPA mandates; country-specific invoice fields [Verify] |

### 5.4 EU 90-day launch plan (relative to gate date G = ≥ 10 paying CH clubs; base G ≈ Oct 2027 → first EU signature Q2 2028)

Prerequisite work starts ~6 months before G+0 because tax, legal and payment set-up have lead times.

| Block | Weeks | Milestones |
|---|---|---|
| Pre-launch | G−24 to G−1 | Tax adviser opinion on EU VAT; Art. 27 representative appointed; SEPA via Connect tested on a test org; FR/DE contracts; 20-name France/border target list from Swiss clients' networks |
| Launch 1 | W1–W3 | 10 workflow audits in Grand Genève / Haute-Savoie; FR case study from a Swiss club with cross-border families |
| Launch 2 | W4–W6 | 3 proposals; first EUR club signed (founding-style "EU pioneer" offer: 3 clubs at Starter price for 24 months [Est.]) |
| Launch 3 | W7–W9 | First EU club onboarded with SEPA; parent payment cycle completed |
| Launch 4 | W10–W13 | Decide whether to open Germany/Austria based on EU club #1 weekly usage and cycle time |

**Pull-forward (12 Nov 2026):** if the EU pilot (§5.5) meets its success criteria and ≥ 10 Swiss clubs pay (base Oct 2027), G+0 moves to the pilot review, and the first full-price EU club can be signed in **early 2028** instead of Q2 2028.

**EU KPIs:** audits → signatures ≥ 15%; time to first SEPA collection ≤ 21 days from signature; EU support hours per club ≤ CH level; first EU club live Sep 2028 (downside 2029); 5 EU clubs by mid-2029 [Est.].

### 5.5 EU discounted paid design-partner pilot, 2027 (added 12 Nov 2026; paid since round 2)

| Item | Plan |
|---|---|
| Who | One academy, camp operator or club with paid staff, 100–300 athletes, in a FR/DE-speaking border region (Grand Genève / Haute-Savoie first; Baden or Alsace as alternatives). Country TBD by 31 Mar 2027 |
| Why discounted, not free | Founder decision, round 2: no free pilots "so we don't lose". A model and case study for the full-price EUR track that also tests willingness to pay |
| Price (proposal) [Est.][Confirm] | **EUR 234.50 a month (50% off Club-tier EUR 469) for months 1–6, then EUR 469**; 12-month minimum; onboarding at 50%. Alternative: EUR 279 (founding-equivalent) for 12 months, then list. Pilot costs (about CHF 15–30k for both pilots) are ours. EU VAT on the invoice (reverse charge / OSS) [Verify] |
| Entry conditions | DLang live in CH; ≥ 3 paying CH clubs live (base May 2027 / downside Aug 2027); EUR formatting, SEPA via Stripe Connect and FR or DE complete; GDPR Art. 27 representative appointed, DPA in the pilot's language, EU hosting confirmed; support hours named |
| Dates (base / downside) | Shortlist 31 Mar 2027 · counsel memo 31 May · go/no-go 30 Jun · set-up Jul–Aug · **live Sep 2027 / Jan 2028** · 60-day review Nov 2027 |
| Terms | Written pilot agreement: 12-month commitment (6 months at the pilot price, then list), no custom development, data terms, case-study consent, list EUR price stated up front |
| Success criteria | One full registration → SEPA/card payment → attendance → reminder cycle; ≥ 80% of one programme's fees through the platform; admin active weekly; signed case study; stays on at list price after month 6 |

---

## 6. United States (full-price sales gated; one discounted paid pilot in 2027)

### 6.1 Why later, plainly

The founder's ambition includes the US. It is a large market for youth club, AAU/travel basketball, private-school and camp software. But: (1) none of DLANG's Swiss advantages (TWINT, QR-bill, Romandie network, FR/DE/IT) apply; (2) the market is served by large, consolidating incumbents with registration, payments and scheduling already bundled [specific vendor numbers not verified, not cited]; (3) US norms differ (fees often passed to families, background-check and safety workflows, school procurement); (4) one founder cannot sell across nine time zones while the Swiss base is under 40 clubs. Entering early would spend the scarcest resource, founder time, where DLANG has no edge.

**Gate for paid US sales (not before H2 2029):** ≥ 40 paying clubs, CHF 25k+ MRR, net revenue retention ≥ 100%, seed closed, one US design partner **paying list price** (the 2027 discounted pilot moving to list is the preferred route), and one channel (e.g. a basketball academy network or camp operator group) committed. The discounted 2027 pilot (§6.5) does not open this gate; it only produces evidence for it.

### 6.2 ICP and channels (for when the gate opens)

| Segment | Why it might fit | Channel hypothesis |
|---|---|---|
| AAU / travel basketball programmes | DLang's sport; tournament- and fee-heavy; small paid staff | Basketball coaching network; tournament organisers; DLang coaches' US contacts |
| Private-school athletics and after-school sport | Budget lines; multi-sport | Introductions through international-school networks already served in CH |
| Sports camps | Seasonal, registration- and payment-heavy; closest to the Swiss camp ICP | Camp operator associations [Verify which] |
| School districts | Large but slow procurement, compliance-heavy | **Not targeted** before a US entity and track record exist |

### 6.3 Prerequisites

- US pricing (indicative USD 299 / 499 / 899) **not published** until validated with the design partner; test whether fees are passed through to families.
- Stripe US account under Connect; ACH and cards; possibly a US entity [Verify with lawyer and tax adviser].
- Sales tax on SaaS varies by state; nexus rules [Verify].
- COPPA for under-13 users; state privacy laws; consent flows for minors [Verify with US counsel].
- English US terminology (season, roster, tryouts), USD, US date and address formats; the terminology layer in the white-label module helps here.

### 6.4 90-day exploration plan (from gate date)

| Weeks | Milestones |
|---|---|
| W1–W3 | 15 discovery calls with AAU programmes, camps, private schools; competitor teardown from public sources |
| W4–W6 | Legal/tax memo on entity, sales tax, COPPA; Stripe US sandbox under Connect |
| W7–W9 | One paying design partner signed at a pilot price; US terminology pack |
| W10–W13 | Design partner runs one registration + payment cycle; go/no-go on a US channel partner |

**KPIs:** 1 paying design partner; ≥ 3 qualified channel conversations; payment cycle completed; decision memo by W13. No US hiring before a go decision.

### 6.5 US discounted paid design-partner pilot, 2027 (added 12 Nov 2026; paid since round 2)

| Item | Plan |
|---|---|
| Who | One AAU/travel basketball programme, academy or camp operator, reached through the DLang basketball network |
| Why discounted, not free | Founder decision, round 2: no free pilots. A model and case study for the US; the fee is small, the learning is the point |
| Price (proposal) [Est.][Confirm] | **USD 249.50 a month (50% off the indicative Club-tier USD 499) for months 1–6, then USD 499**; 12-month minimum; onboarding at 50%. Alternative: USD 299 for 12 months. US price not published. Whether invoicing a US club from SPSA creates sales-tax or entity obligations [Verify with US counsel] |
| Entry conditions | DLang live in CH; ≥ 3 paying CH clubs live; USD, US English terminology (season, roster, tryouts), US date and address formats; **COPPA verifiable parental consent** flow for under-13s, US privacy notice and state-law check [Verify with US counsel]; entity and sales-tax position for a paid pilot [Verify]; cross-border Stripe Connect for a US connected account [Verify with Stripe]; support hours across the time difference named |
| Dates (base / downside) | Shortlist 31 Mar 2027 · US counsel memo 31 May · go/no-go 30 Jun · set-up Jul–Aug · **live Sep–Oct 2027 (fall season) / Mar 2028 (spring season)** · 60-day review Dec 2027 |
| Terms | As the EU pilot (12-month commitment, 6 months discounted, then list); USD list price stated up front but not published |
| Success criteria | One season registration and payment cycle; parents complete consent and payment without support; admin active weekly; written decision memo on the US gate inputs |

**Capacity warning.** Both pilots go live in the same weeks as the Swiss registration peak, DLang running the whole club and the push to 10 paying clubs. If the Swiss KPIs are red on 31 Aug 2027 (fewer than 3 paying clubs, churn above 2.5%, P1 backlog), the pilots move to the downside dates.

---

## 7. Pilot programme playbook (5–10 clubs)

### 7.1 Structure

| Track | Clubs | Price | Terms |
|---|---|---|---|
| **Founding clubs** [Founder, kept] | 5 (hard cap, in writing) | CHF 290/month for life, any tier; onboarding waived | 24 months founder access, quarterly roadmap vote, co-branded case study, founding listing, month-to-month, 60-day refund. Slots close 30 Sep 2027 |
| **Design pilots** [Est., new] | up to 5 | List price; onboarding fee 50% off | Same refund and exit terms; must fit the ICP; first in line for the referral reward |

No free pilots, anywhere (round 2, 12 Nov 2026): a free pilot proves usage, not willingness to pay, and Gate 1 is about paying. The single EU and single US design partners (§5.5, §6.5) are discounted paid pilots outside the Swiss programme (50% off the Club list for 6 months, 12-month commitment, then list [Confirm]).

### 7.2 Selection criteria

ICP fit; audited value ≥ 3×; a named administrator with ≥ 2 h/week for the first month; a programme starting within 60 days of signature (so value is visible quickly); willingness to share before/after figures; mix of at least 2 academies/camps and 2 clubs with a comité.

### 7.3 Phases

| Phase | When | Activities | Exit test |
|---|---|---|---|
| Audit | Week −4 to 0 | Workflow audit; baseline numbers: admin hours/week, unpaid fees, days to collect | Signed baseline sheet |
| Setup | Days 0–7 | Branding, languages, payment methods (Connect onboarding), invoice template | Test invoice with club logo and valid QR-bill |
| Import | Days 3–10 | Assisted CSV import (self-serve once CSV import ships) | Athlete count matches the club's records exactly |
| First cycle | Days 10–45 | First real registrations, payments, attendance, reminders | ≥ 80% of fees for one programme collected through DLANG |
| Review 30/60/90 | Days 30, 60, 90 | Compare against baseline; collect feature requests; refund window closes day 60 | Admin active weekly; measured hours/fees recovered |
| Graduate | Day 90 | Case study draft; referral offer switched on | Club agrees to be a reference |

### 7.4 Capacity and governance

- Max 2 clubs in setup/import at once; no migrations 1 Jun–15 Sep except clubs already live.
- Weekly 30-minute pilot review (founder + engineering lead): open issues by severity, payment exceptions, usage.
- A pilot is stopped (refund, data export) if after 45 days the admin has not used the product weekly. Learn why; do not chase.

---

## 8. Partner and white-label reseller programme

The code already has a white-label layer (branding, terminology). The programme is gated by support capacity and security proof, not by the product. All margins below are **[Est.]**, to be validated against the 83% gross margin [Founder] and the re-modelled payment margin before publishing.

### 8.1 Tiers

| Tier | Who | Opens | What they do | Economics [Est.] |
|---|---|---|---|---|
| **Referral partner** | Live clubs, coaches, fiduciaries/treasurer services, camp operators | Q3 2027 (after 2 measured references) | Introduce; DLANG sells | Clubs: 1 month free both sides [Founder]. Non-clubs: 15% of first-year subscription revenue, paid after 90 days of the club paying |
| **Implementation partner** | Swiss fiduciaries, sport-admin consultants, regional associations | 2028 (after onboarding is productised and ≥ 10 clubs) | Sell and onboard under DLANG brand; tier-1 how-to support | Keep 100% of the onboarding fee + 20% recurring for 24 months; must complete certification (onboard 2 clubs with DLANG present) |
| **White-label reseller** | Federations, academy groups, sports-service companies, later foreign distributors | 2029 earliest; gate: ≥ 25 clubs on one codebase, external pen test, staffable SLA | Own brand to their clubs; own tier-1 support and billing | Wholesale at 30% (≥ 10 clubs), 35% (≥ 50), 40% (≥ 150) off list; annual minimum commitment; DLANG keeps payment application fee |
| **Federation partner** [Founder §7.5] | Cantonal/regional associations, national federations without a software deal | Pilot H2 2028 | Endorse and distribute to member clubs | Per-club rate ~20% below list, one group onboarding fee, federation branding, no-cost aggregate dashboard [Founder] |

### 8.2 Co-branding rules

1. **Default co-branding:** the club's brand is primary; "Powered by DLANG Sports OS" stays in the footer of the parent app, emails and the login page. Removal only on Multi-site/Federation or the white-label reseller tier.
2. **Untouchable elements:** payment pages, QR-bill content, legal texts (T&Cs, privacy notice, DPA) and security statements stay DLANG-controlled. Partners may not change them or make compliance claims beyond DLANG's published security pack.
3. **Data:** the club owns its data and can always export it (founder promise). A reseller cannot block a club's export or migration.
4. **Money:** funds flow club ← parents through the club's own Connect account; partners never hold club funds [Verify AML position with counsel].
5. **Trademark:** partners use the DLANG name and logo per a one-page brand sheet; no "DLANG" in partner domain names or app names.
6. **Termination:** if a partner exits, clubs migrate to direct DLANG contracts at the partner's price for 12 months.
7. **Quality:** a partner whose clubs churn > 3% per month for two quarters loses recurring share on new clubs [Est.].

### 8.3 Preconditions before the first reseller contract

Reseller agreement drafted by counsel (liability, data processing chain, sub-processors) [Verify]; partner portal or at least partner-scoped admin role; support runbook and SLA the company can staff; external penetration test passed; billing able to invoice the reseller wholesale.

---

## 9. Cross-market KPI dashboard (reported monthly)

| Area | Metric | 2027 target (base) [Est.] |
|---|---|---|
| Pipeline | Audits / proposals / signatures | 30 / 15 / 10 |
| Velocity | Median cycle days; signature → first registration | ≤ 75; ≤ 14 |
| Revenue | Paying clubs; MRR | 10 by Oct 2027; ~CHF 3.5–4.5k MRR end-2027 (founding prices weigh it down) |
| Product value | Auto-reconciled payment share; parent payment completion | ≥ 95%; +20 points vs baseline |
| Retention | Logo churn; weekly active admins | < 1.5%/month; 100% of live clubs |
| Efficiency | Founder hours per onboarding; support hours per club per month | 31 → 20; ≤ 2 h |
| Gates | Gate 1/2/3 status vs dates in §4.7 | All met by 31 Mar 2027 (downside) |

---

## 10. Items needing professional validation

| Item | Who |
|---|---|
| Whether any DLANG payment design means holding client funds (AML / financial intermediary rules) | Swiss lawyer |
| GmbH formation, IP assignment from founder, contract set, DPA, nFADP review | Swiss lawyer |
| VAT registration timing, EU VAT/OSS, invoicing of founding prices | Fiduciary / tax adviser |
| Stripe Connect and TWINT activation timelines and terms | Stripe (written confirmation) |
| J+S data interfaces and what is permitted | BASPO / J+S office |
| EU: Art. 27 representative, governing law, local invoice rules | EU counsel per country |
| US: entity, sales tax nexus, COPPA, state privacy law | US counsel and tax adviser |
| US discounted paid pilot: entity and sales-tax position for invoicing a US club, COPPA verifiable parental consent, cross-border Stripe Connect (by 31 May 2027) | US counsel and tax adviser; Stripe |
| EU discounted paid pilot: Art. 27 representative, DPA language, pilot agreement with price terms, EU VAT on the invoice (by 31 May 2027) | EU counsel; fiduciary |
| SPSA GmbH contracting with other clubs while running an academy; carve-out | Swiss lawyer |
| Reseller agreement and partner liability | Lawyer |

---

## 11. Changes vs. founder's August 2026 plan

| Topic | Founder plan | Updated | Why |
|---|---|---|---|
| Launch markets | "Worldwide, every team sport" (deck); Swiss first, EUR second (plan) | CH 2027 (paid); **12 Nov, round 2:** one discounted paid EU pilot (Sep 2027 / Jan 2028) and one discounted paid US pilot (Sep–Oct 2027 / Mar 2028); full-price EU signed Q2 2028 (early 2028 on a strong pilot), live Sep 2028; paid US not before H2 2029; white-label resale 2029+ | Swiss wedge does not travel; capacity and capital too small; founder wants a 2027 EU/US presence |
| Gate 2 (TWINT reconciles) | 18 Oct 2026 | 18 Dec 2026 (downside 31 Jan 2027) | TWINT is only a label in the code; no Connect yet |
| Gate 1 (willingness to pay) | 20 Sep 2026 | 31 Jan 2027 (downside 15 Mar 2027) | Audits not done/confirmed; Jan–Mar is the comité window |
| First paid signature | by 30 Nov 2026 | 31 Jan 2027 signed, paying Feb 2027 (downside Mar–Apr 2027) | Company, contracts and payment rail must exist first |
| 5 founding clubs | 31 Jan 2027 | Jun 2027 (downside Sep 2027); slots close 30 Sep 2027 | Swiss signing calendar; onboarding capacity |
| Gate 3 | Club #1 weekly by 22 Nov 2026 | DLang full cycle 14 Feb 2027; club #1 weekly 30 Apr 2027 (downside 30 Jun) | Lighthouse must run first |
| Sales cycle | 21 days | 45–90 days; 21 days as best case | Comité decisions, AGM timing |
| Founder hours per club | 22 h (model) vs 31 h (plan) | Plan on 31 h; target 20 h by club 10 | Use the conservative figure consistently |
| Competitive claim | "Cheaper than Spond on total cost" | "Cheapest payment rail for clubs collecting real money" (adopted by the founder 12 Nov) | Plan's own table: CHF 6,573 vs 1,755 total |
| Pilots | Founding programme only | Founding (5) + up to 5 paid design pilots; **no free pilots anywhere** (round 2, 12 Nov); one discounted paid EU and one discounted paid US design partner | Gate 1 tests payment, not usage; the two discounted pilots buy market learning and still test payment |
| Referral | Switch on Month 6 | Switch on after 2 measured references (~Q3 2027) | Month 6 of a slipped plan is meaningless; tie to proof |
| Federation strategy | Relationship Y1, group deal months 15–24 | Kept; pilot H2 2028 (downside 2029); Swiss Basketball first via DLang | Needs live reference in the sport |
| J+S integration | Validate with 5 clubs, then build | Kept; validate in 2027; never sold before built | Unverified gap; BASPO interfaces unknown |
| Partner / reseller programme | Not designed | Four tiers with gates and co-branding rules | Needed for scale, but only after support and security proof |
| Seasonality | None in model or plan | Sales calendar drives all dates; no migrations Jun–mid-Sep | Swiss registration peak and holidays |
| Localisation | Multilingual in beta scope | FR/EN/DE by 28 Feb 2027; IT 2028 | No translation layer in repo yet |
| Paid acquisition | None in Year 1 | None in 2027; content/SEO from Q2 2027 | Kept; low-cost compounding channel added |
| Company (12 Nov) | GmbH to be formed | SPSA GmbH signs all contracts; answer for prospects on the shared academy/software entity | Founder's answer |
| AI in sales (12 Nov) | — | AI assistant opt-in per club and a **paid add-on** (CHF 69 per club per month proposed [Confirm]; DLang free); never the lead message, offered at onboarding as an extra | Founder decision (round 2) |
| Team for selling | Part-time CS at club 10, SDR at club 25 | Part-time CS Jan 2028 (downside Jun 2028); SDR at ~club 25 (Oct 2028 base) | Same triggers, real dates; CH notice periods 1–3 months |
