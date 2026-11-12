# 10 — Financial Model v2: Notes

**Prepared:** November 2026; **updated 12 November 2026** (v2.1, founder decisions in `11_FOUNDER_DECISIONS_2026-11-12.md`)
**Workbook:** `docs/company/updated/DLANG_Sports_OS_Financial_Model_v2.1.xlsx` (plan of record, from 12 Nov 2026; see §0) and `docs/company/updated/DLANG_Sports_OS_Financial_Model_v2.xlsx` (11 Nov 2026 defaults, kept unchanged). Sections 1–5 below describe v2 on its 11 Nov defaults.
**Built from:** the founder's workbook `docs/company/source/DLANG_Sports_OS_Financial_Model.xlsx` (18 Aug 2026). The founder's file is unchanged. v2 is a copy.
**Companion:** `09_FOUNDER_PLAN_REVIEW.md` (re-baselined timeline and the reasons behind it)

All figures are in CHF. The numbers below were recalculated in LibreOffice with no formula errors. The Base, Bull and Bear scenarios were each checked on all 12 sheets.

---

## 0. v2.1: the plan of record as the default (12 Nov 2026)

**Workbook:** `docs/company/updated/DLANG_Sports_OS_Financial_Model_v2.1.xlsx`, a copy of v2 (v2 is unchanged). It opens on the founder's decisions of 12 Nov 2026 (`11_FOUNDER_DECISIONS_2026-11-12.md`) and was recalculated in LibreOffice, so cached values are present, with no formula errors. Every changed cell, old value, new value and reason is listed in the new **Changes_v2.1** sheet (66 entries, mostly notes and Timeline_v2 text).

**Input changes (all checked against the cell labels before changing):**

| Cell | Meaning | v2 | v2.1 | Decision |
|---|---|---|---|---|
| `Assumptions!D61` / `D62` | FIT grant probability, Base / Bull (`D63` Bear was already 0) | 50% / 75% | **0% / 0%** | 2: FIT at 0% until filed and awarded |
| `Assumptions!C61` / `C62` | Month the EUR 50k lands, Base / Bull (`C63` Bear stays 5 = Apr-27) | 3 (Feb-27) | **4 (Mar-27)** | 6: released once a CTO is in place |
| `Assumptions!C42` / `D42` | Founder pay Y2 / Y3 (before 15% social charges) | 5,000 / 7,000 | **3,500 / 5,000** | 8: lean-cost variant |
| `Assumptions!C43` / `D43` | Engineering Y2 / Y3 | 8,000 / 11,000 | **6,000 / 8,000** | 8 |
| `Assumptions!C45` / `D45` | Sales and marketing Y2 / Y3 | 1,500 / 2,500 | **1,000 / 1,500** | 8 |
| `Assumptions!B26` | AI module attach rate (share of clubs paying CHF 90) | 15% | **0%** | 12: AI included in the Club tier [Confirm] |
| `Assumptions!A83:AL83` (new row) and `Model_Monthly!B38:AK38` | One-off EU/US design-partner pilot costs, added to the legal/compliance/one-off line | — | **CHF 22,500 in 2027**: May 6,000, Jun 1,500, Aug 5,000, Sep 6,000, Oct 4,000 [Est.] | 11: about CHF 15–30k in 2027; midpoint used |

Row 44 (customer-success tooling) is in the `C42:D45` range but was **not** changed: the decision only covers rows 42, 43 and 45. `B74` (first year AI is sold, which also gates the CHF 6/club inference cost) stays at Year 3. Inference for the DLang beta and founding clubs in 2027–28 is therefore not costed (about CHF 1–2k over two years [Est.]). The pilot row is not scenario-dependent: in the downside the pilots move to Jan/Mar 2028, but the row keeps the base timing.

**Results (recomputed; Jan = Jan-27; model years end in November):**

| | v2.1 default (Base, incl. pilots) | v2.1 with pilot row = 0 (= `11` §2 plan of record) | v2.1 Bear (incl. pilots) | v2.1 Bear, pilot row = 0 (= `11` §2 downside) | v2.1 Bull (incl. pilots) |
|---|---|---|---|---|---|
| Paying clubs Nov-27 / Nov-28 / Nov-29 | 10 / 26 / 45 | 10 / 26 / 45 | 6 / 15 / 27 | 6 / 15 / 27 | 17 / 45 / 87 |
| ARR Nov-29 | 231.2k | 231.2k | 132.0k | 132.0k | 451.2k |
| Revenue Y1 / Y2 / Y3 | 18.2k / 89.9k / 195.4k | same | 6.6k / 50.7k / 113.6k | same | 33.8k / 160.9k / 370.1k |
| EBITDA Y1 / Y2 / Y3 | –166.0k / –131.6k / –116.7k | –143.5k / –131.6k / –116.7k | –175.4k / –149.5k / –184.0k | –152.9k / –149.5k / –184.0k | –155.9k / –75.8k / +27.4k |
| Cash Jan / Feb / Mar 2027 | –17.6k / –43.5k / –7.8k | same | –17.6k / –43.6k / –54.6k | same | –17.6k / –43.5k / –7.7k |
| Cash negative for good | Jan 2027 | Jan 2027 | Jan 2027 | Jan 2027 | Jan 2027 |
| To bridge before the EUR 50k lands | about CHF 45k (Jan–Mar) | about CHF 45k | about CHF 55k (Jan–Apr) | about CHF 55k | about CHF 45k |
| Unfunded shortfall Nov-27 / Nov-28 / Nov-29 | **104.5k / 236.0k / 352.7k** | **82.0k / 213.5k / 330.2k** | 113.9k / 263.4k / 447.4k | 91.4k / 240.9k / 424.9k | 94.4k / 170.2k / 142.7k |
| Lowest cash point | –352.7k (Nov-29) | –330.2k (Nov-29) | –447.4k (Nov-29) | –424.9k (Nov-29) | –191.2k (Mar-29) |
| EBITDA in Nov-29 | –5.3k a month | same | –12.7k a month | same | +10.8k a month |
| First EBITDA-positive month | about mid-2030 [Est., extrapolated] | same | 2032 or later | same | **Apr 2029** (v2 workbook base: Aug 2029) |

**Reconciliation with `11` §2:** with the pilot row at 0, v2.1 reproduces the plan-of-record and downside columns of `11` §2 exactly (82k / 214k / 330k; Jan–Mar bridge about 45k; –43.5k in Feb 2027; downside 91k / 241k / 425k, about 55k Jan–Apr). January cash is –17,550, shown as –17.5k in `11` and –17.6k here (rounding only). The only difference in the v2.1 default is the pilot line that `11` §2 lists as "not in the workbook": it adds **CHF 22.5k from May 2027**, so the shortfalls become **about 105k / 236k / 353k**. It does not change the Jan–Mar bridge, because the first pilot cost falls in May 2027. Not modelled: any fractional-CTO fee above the engineering line (see `12_CTO_SOLUTION_AI_PLUS_HUMAN.md`).

**Funding need on v2.1 (base, incl. pilots, plus a 3-month operating buffer):** about **CHF 45k bridge Jan–Mar 2027**; about **CHF 145k by Nov 2027** (104.5k + 3 × 13.8k average monthly EBITDA burn in Y1); about **CHF 270k by Nov 2028** (236.0k + 3 × 11.0k); about **CHF 380k by Nov 2029** (352.7k + 3 × 9.7k) [Est.]. Formula: shortfall + 3 × (that year's EBITDA ÷ 12). This sits inside the cash actions of record: pre-seed of about CHF 250–300k in total, including the EUR 50k, in H1 2027, then a seed of CHF 400–500k in Q1 2029.

---

## 1. What changed, in one paragraph

The model now starts in **December 2026**. Month 1 is Dec-26 and month 36 is Nov-29. Fiscal Year 1 runs Dec-26 to Nov-27.

Revenue cannot start earlier, for two reasons. First, no external club can pay until a real TWINT payment reconciles on DLang (Gate 2, target 18 Dec 2026). Second, the Sep–Nov 2026 months already passed with no revenue.

Clubs now sign later and the ramp follows the season:
- no signings in December or July
- peaks in March–June and August–October

Other changes:
- Churn is higher.
- Payment margin is close to zero on Stripe.
- The founding clubs stay at CHF 290 in every year.
- AI revenue moves to Year 3.
- Employer social charges, one-off costs and dated hires are now modelled.
- Engineering is costed at what Swiss CHF actually buys.

The sheet structure and the formula engine are the same as before. Every change is listed cell by cell in the **Changes_v2** sheet (93 entries). The milestones are in **Timeline_v2**.

## 2. Headline numbers: base vs downside (and upside for reference)

Year ends are November (Y1 = Nov-27, Y2 = Nov-28, Y3 = Nov-29).

| | Base | Downside (Bear) | Upside (Bull) | August model (base, Aug year ends) |
|---|---|---|---|---|
| Paying clubs, end Y1 / Y2 / Y3 | 10 / 26 / 45 | 6 / 15 / 27 | 17 / 45 / 87 | 13 / 50 / 118 |
| **ARR, end Y1 / Y2 / Y3** | **39.6k / 117.1k / 238.5k** | **19.8k / 63.9k / 136.4k** | 68.7k / 209.9k / 465.3k | 51.9k / 254.3k / 669.5k |
| Revenue Y1 / Y2 / Y3 | 18.2k / 89.9k / 201.1k | 6.6k / 50.7k / 117.0k | 33.8k / 160.9k / 380.7k | 31.7k / 193.4k / 556.9k |
| EBITDA Y1 / Y2 / Y3 | –143.5k / –182.3k / –186.5k | –152.9k / –200.2k / –256.2k | –133.4k / –126.5k / –37.5k | –89.0k / –74.9k / +52.3k |
| Average monthly burn (EBITDA) Y1 / Y2 / Y3 | 12.0k / 15.2k / 15.5k | 12.7k / 16.7k / 21.3k | 11.1k / 10.5k / 3.1k | — |
| Operating cost run-rate per month Y1 / Y2 / Y3 (excluding one-offs) | 10.8k / 20.8k / 28.3k | same | same (CS hire earlier) | 9.4k / 19.9k / 35.6k |
| CHF 10k MRR reached | Dec-28 | Sep-29 | Apr-28 | — |
| First month with positive EBITDA | **not within horizon** (about Q4 2030 at the Y3 sales pace) | not before 2032 | Aug-29 | Jul-28 |
| Cash goes negative (on the current funding stack) | **Apr-27** | Jan-27 | Apr-27 | — |
| Lowest cash point in the model | **–440.8k (Nov-29, still falling)** | –547.8k (Nov-29, still falling) | –237.0k (Jul-29, then rising) | –107.3k (Jan-29) |

*12 Nov 2026: the stack of record is now about CHF 61.5k (founder 15k + EUR 50k ≈ CHF 46.5k released in Mar 2027 once a CTO is in place + FIT at 0%). See §0 and `11` §2.*

**Current funding stack (v2, 11 Nov 2026):** CHF 71.5k in total.
- Founder CHF 15k (December 2026).
- EUR 50k convertible, about CHF 46.5k. It is signed 31 Jan 2027, with the cash arriving in February in the base case and April in the downside.
- FIT grant CHF 20k, counted at 50% in the base case and 0% in the downside.

The deepest cash figure in the table is the extra capital needed on top of this stack.

### Funding need (base, including a 3-month operating buffer)

| Funded through | Unfunded shortfall | With buffer | Instrument |
|---|---|---|---|
| Nov 2027 (end Y1) | 72k | **about CHF 110k** | Make the January 2027 convertible bigger, or close a bridge by **Apr 2027** |
| Nov 2028 (end Y2) | 254k | **about CHF 300k** | Pre-seed or bridge of CHF 250–300k in total during H1 2027 |
| Nov 2029 (end Y3) | 441k | **about CHF 490k** | Seed Q1 2029 of CHF 400–500k, raised from Q3 2028 |

Downside shortfall at the same three points: 91k / 292k / 548k.

Two extra cases were run:
- **Lean cost:** founder pay and engineering in Y2/Y3 held at 3.5k/5k and 6k/8k, sales and marketing at 1k/1.5k. The cash trough improves to –314k, and Nov-29 EBITDA is still –4.7k a month. Break-even moves to about mid-2030.
- **Engineer employee from Jan-29** (Assumptions!B70 = 26): the trough deepens to –561k. Hire only with a seed in the bank.

### Runway

On today's stack, base cash is:
- +1k in December 2026
- **–17.5k in January 2027**, before the convertible arrives. This is caused by the CTO trial and the compliance pack.
- briefly positive in February 2027
- negative again from **April 2027**

So the founder must either advance about CHF 20k, close the convertible in December, or push the trial and pen-test costs into February. *12 Nov 2026: with FIT at 0% and the EUR 50k in March, the bridge of record is about **CHF 45k for Jan–Mar 2027**, agreed by 15 Dec 2026 (§0).* Usable runway after the round is about **2 months**, not the 12 the August plan implied.

### Unit economics (v2 inputs)

| Metric | v2 | August model |
|---|---|---|
| Bottom-up CAC (31 founder hours at CHF 60, plus onboarding and travel) | 2,580 | — |
| Net of the CHF 750 onboarding fee | 1,830 | — |
| Fully loaded CAC (Year 2) | 3,545 | 1,376 |
| Gross profit per club per month | 334 | — |
| Gross margin | 80% | 83% |
| LTV (gross profit, 48-month cap at 1.8% churn) | 16.0k | — |
| LTV / CAC | 4.5× | 13× |
| CAC payback | 10.6 months | 3.7 months |

The v2 figures are a healthier and more believable profile than 13× and 3.7 months. The business is not a bad one. It is a slow-to-scale one.

**Funnel check:** 11 base signings in Year 1 at 30% audit-to-paid conversion need **about 37 qualified audits** in Year 1. That is 45 at bull conversion and 30 in the downside. The rollout plans for 10. Pipeline volume is a constraint just as real as the product.

## 3. What this means (plain reading)

1. **The model no longer supports two dates in the 09 review.**
   - **Break-even "Q2 2029":** on the v2 cost base the business needs about 75–80 clubs to cover CHF 28k a month of operating cost. The base case has 45 clubs in Nov-29. Break-even is about Q4 2030 if the Year-3 sales pace continues and costs stay flat. Only the upside case gets there inside the horizon (Aug-29).
   - **Bridge "by Sep 2027":** cash runs out in April 2027, not September.

   The Timeline_v2 sheet uses the model's dates. *(12 Nov 2026: 09 now uses the workbook dates; on the lean plan of record break-even is about mid-2030.)*
2. **EUR 50k is a 2-month round, not a 12-month round.** The sensible move is a single convertible of **CHF 150–200k** in January 2027 instead of EUR 50k plus a separate bridge. *12 Nov 2026: the cash actions of record are a Jan–Mar bridge of about CHF 45k, then a pre-seed of about CHF 250–300k in total, including the EUR 50k, in H1 2027. The company is SPSA GmbH (already incorporated); the 31 Dec 2026 deadline is the IP present assignment to SPSA. Structure A (CTO 20% before the round) is no longer the default: any CTO equity is set with the fractional CTO and advisors and shown to the investor.*
3. **The Swiss-only plan is default-dead until about 75 clubs unless costs stay lean.** *(12 Nov 2026: the founder accepted the lean-cost variant; it is the v2.1 default.)* Two ways out:
   - stay lean (founder pay and engineering capped, about CHF 20k a month total) until about 30 clubs
   - raise a seed in Q1 2029 on evidence of 25+ clubs and churn under 2% a month
4. **The US and broad white-label resale stay out of this model on purpose.** Neither is fundable or staffable on these numbers before H2 2029. The entry gates are in Timeline_v2. *12 Nov 2026: the two free EU and US design-partner pilots in 2027 bring no revenue; their cash cost (about CHF 15–30k [Est.]) is in v2.1 row 83 at CHF 22.5k.*
5. **The value case is still about 2× (Pricing!B47), not 3×.** Gate 1 is the one input that moves every number above.

## 4. Change log (summary — full list in Changes_v2)

| Area | August model | v2 | Why |
|---|---|---|---|
| Model start | M1 = Sep-26 | **M1 = Dec-26** (to Nov-29) | Sep–Nov 2026 passed with zero revenue. Gate 2 is due Dec-26. |
| New clubs, base (Y1 / Y2 / Y3) | 14 / 42 / 82 = 138 | **11 / 19 / 27 = 57** | First club Feb-27, 5 by Jun-27, 10 by Oct-27, about 25 by Oct-28. No signings in Dec or Jul. Committee cycle of 45–90 days. |
| New clubs, bear / bull | 83 / 227 in total | 36 / 101 | Downside and upside re-baselined to match. |
| Monthly churn (base / bull / bear) | 1.5% / 1.0% / 2.5% | **1.8% / 1.2% / 2.5%** | Month-to-month terms with a 60-day refund. Treasurer turnover at season change. |
| ARPA | 330 / 400 / 450, applied to all clubs | **public clubs 350 / 400 / 440; founding clubs 290 for life** | Fixes later-year ARPA being applied to the locked founding clubs. |
| Onboarding fee (average) | 900 | **750** | Starter-heavy mix and early discounting. |
| AI module | 25% attach from Year 2 | **15% from Year 3 (Dec-28)** | Out of beta scope. |
| Share of collections through the platform / net margin | 50% / 0.9% | **40% / 0.2%** | The code uses Stripe, where TWINT costs 1.9% + CHF 0.30. The 0.9% assumed Payrexx. |
| Support cost per club | 55 | **65** | First-cohort hand-holding. |
| Founder pay (Y1 / Y2 / Y3) | 2.5k / 6k / 8.5k | **2.5k / 5k / 7k + 15% social charges** | Social charges were missing. Revenue arrives a season later. |
| Engineering | 4.5k / 8.5k / 16k | **4.8k / 8k / 11k + CTO trial 10k (Jan–Feb 27)** | 4.5k for about 24 hours a week was about CHF 43/h. v2 buys fewer hours: CTO retainer, a senior reviewer for 6 hours a week, and AI agents. A salaried engineer is an option only after the seed. |
| Customer success | 300 / 900 / 1.8k | **300 / 600 / 900 tooling + part-time CS at 2.9k a month from Jan-28** (Jun-28 downside) | Hire is dated, allowing for Swiss notice periods. |
| Sales and marketing | 0.8k / 2.5k / 6k | **0.8k / 1.5k / 2.5k** | No paid acquisition before a seed. |
| Legal and compliance | 0.7k / 0.9k / 1.4k | **1.3k / 1.0k / 1.3k + one-offs** | GmbH and IP 3k (Dec-26), compliance pack 2.5k (Jan-27), pen test 10k (Feb-27), EU entry 6k (Sep-28), second pen test 10k (Dec-28). |
| Round timing | Nov-26 | **Feb-27** (Apr-27 downside) | Convertible signed 31 Jan 2027. |
| FIT grant | 100%, Jan-27 | **50% base / 75% bull / 0% downside, Feb-27** | Filing by 10 Nov 2026 is unconfirmed. |
| Bridge / seed | none | **Toggle at Assumptions!B72–B73, default 0** | The cash line shows the unfunded need. |
| Unit economics | 22 hours to close, CHF 45/h | **31 hours, CHF 60/h** | The plan's own figure and a Swiss loaded cost. |
| KPI red lines | first signature 30 Nov 26; 5 clubs 31 Jan 27 | **31 Jan 27 (31 Mar downside); 5 clubs 30 Jun 27 (30 Sep downside)** | Re-baselined. The TWINT red line of 31 Dec stays, with a fallback to 31 Jan. |
| Cap table | Founder 90/81/72% | Note added | The CTO's 20% grant before the round is not in the table. Founder holds about 64.8% after it. |
| FIT grant (v2.1, 12 Nov) | 100%, Jan-27 | v2: 50% base / 75% bull / 0% bear. **v2.1: 0% in all scenarios** (`D61:D63`) | Not filed by 10 Nov 2026; counted only once filed and awarded; eligibility [Verify] |
| Round timing (v2.1, 12 Nov) | Nov-26 | v2: Feb-27. **v2.1: Mar-27 base and bull (`C61`, `C62` = 4); Apr-27 bear** | The investor releases the EUR 50k once a CTO is in place (target signed 15 Dec 2026) |
| Lean costs (v2.1, 12 Nov) | — | v2: lean variant as a side case. **v2.1 default: founder 3.5k/5k, engineering 6k/8k, sales and marketing 1k/1.5k in Y2/Y3** | Founder accepted the lean-cost variant |
| AI module (v2.1, 12 Nov) | 25% attach from Year 2 | v2: 15% from Year 3. **v2.1: 0% (`B26`)**; inference cost kept | AI assistant opt-in per club, included in the Club tier [Confirm]; CHF 90 add-on withdrawn |
| EU/US pilots (v2.1, 12 Nov) | — | **v2.1: new row `Assumptions!83`, CHF 22.5k May–Oct 2027 [Est.]**, flowing into `Model_Monthly` row 38 | One free EU and one free US design-partner pilot in 2027 (about CHF 15–30k) |
| Timeline and notes (v2.1, 12 Nov) | — | Timeline_v2 rows for the round, FIT, bridge, break-even, CTO, EU and US updated; Cap_Table and Use_of_Funds notes updated | Dates of record in `11` §3 |
| Stop rule (12 Nov) | Kill criterion in the review | No kill switch: missed red lines trigger a two-week strategy review (`00` §4.7) | Founder decision 15 |

New input sections in the Assumptions sheet:
- **G:** a scenario table for round month, grant probability, customer-success start, sales cycle, conversion and audits needed
- **H:** founding price, social charges, hire costs and dates, the bridge toggle and the AI start year
- **I:** one-off costs by month

All new inputs are in blue, following the workbook's own convention.

## 5. How to use v2 / v2.1

- **Use v2.1 for the plan of record.** It opens on FIT 0%, EUR 50k in Mar 2027, lean costs, AI included and the pilot line. To reproduce the figures in `11` §2 exactly, set `Assumptions!C83:N83` to 0. To test a later release of the EUR 50k, change `C61` (5 = Apr-27).

- Switch scenarios at **Assumptions!B4** (Base / Bull / Bear). Bear is the downside timeline. Round month, grant probability and the customer-success hire follow the switch automatically.
- To test a funding plan, set **B72** (amount) and **B73** (month), for example CHF 150,000 in month 5 (Apr-27).
- To test the post-seed engineer hire, set **B70** = 26 (Jan-29).
- Update the opening position as soon as it is known: actual cash at 30 Nov 2026, whether FIT was filed, and the convertible terms. Founder funds at **B54** are still the August CHF 15k figure.
- The workbook is set to recalculate fully on open. Excel, LibreOffice and Google Sheets all compute the values on load.
