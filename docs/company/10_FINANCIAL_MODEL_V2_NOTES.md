# 10 — Financial Model v2: Notes

**Prepared:** November 2026
**Workbook:** `docs/company/updated/DLANG_Sports_OS_Financial_Model_v2.xlsx`
**Built from:** the founder's workbook `docs/company/source/DLANG_Sports_OS_Financial_Model.xlsx` (18 Aug 2026). The founder's file is unchanged. v2 is a copy.
**Companion:** `09_FOUNDER_PLAN_REVIEW.md` (re-baselined timeline and the reasons behind it)

All figures are in CHF. The numbers below were recalculated in LibreOffice with no formula errors. The Base, Bull and Bear scenarios were each checked on all 12 sheets.

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

**Current funding stack:** CHF 71.5k in total.
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

So the founder must either advance about CHF 20k, close the convertible in December, or push the trial and pen-test costs into February. Usable runway after the round is about **2 months**, not the 12 the August plan implied.

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

   The Timeline_v2 sheet uses the model's dates. 09 should be read with these two corrections.
2. **EUR 50k is a 2-month round, not a 12-month round.** The sensible move is a single convertible of **CHF 150–200k** in January 2027 instead of EUR 50k plus a separate bridge. This makes the CTO-grant disclosure and the GmbH/IP assignment (due 31 Dec) even more urgent.
3. **The Swiss-only plan is default-dead until about 75 clubs unless costs stay lean.** Two ways out:
   - stay lean (founder pay and engineering capped, about CHF 20k a month total) until about 30 clubs
   - raise a seed in Q1 2029 on evidence of 25+ clubs and churn under 2% a month
4. **The US and broad white-label resale stay out of this model on purpose.** Neither is fundable or staffable on these numbers before H2 2029. The entry gates are in Timeline_v2.
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

New input sections in the Assumptions sheet:
- **G:** a scenario table for round month, grant probability, customer-success start, sales cycle, conversion and audits needed
- **H:** founding price, social charges, hire costs and dates, the bridge toggle and the AI start year
- **I:** one-off costs by month

All new inputs are in blue, following the workbook's own convention.

## 5. How to use v2

- Switch scenarios at **Assumptions!B4** (Base / Bull / Bear). Bear is the downside timeline. Round month, grant probability and the customer-success hire follow the switch automatically.
- To test a funding plan, set **B72** (amount) and **B73** (month), for example CHF 150,000 in month 5 (Apr-27).
- To test the post-seed engineer hire, set **B70** = 26 (Jan-29).
- Update the opening position as soon as it is known: actual cash at 30 Nov 2026, whether FIT was filed, and the convertible terms. Founder funds at **B54** are still the August CHF 15k figure.
- The workbook is set to recalculate fully on open. Excel, LibreOffice and Google Sheets all compute the values on load.
