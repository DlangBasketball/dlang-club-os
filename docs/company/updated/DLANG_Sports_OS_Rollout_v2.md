---
title: "DLANG Sports OS — Operational Rollout v2"
subtitle: "From plan to paid, re-baselined. Thirteen weeks from Monday 16 November 2026, then twelve months by quarter."
date: "11 November 2026, updated 12 November 2026"
---

**OPERATIONAL ROLLOUT · v2 · 13 WEEKS + 12 MONTHS**

**FROM PLAN TO PAID, AGAIN**

Week by week, Monday 16 November 2026 to Sunday 14 February 2027. What ships, what is sold, what is filed, who owns it, and when to stop. Then the twelve months after it, quarter by quarter, to February 2028.

- Thirteen weeks, five workstreams, three hard gates plus a red line
- Two holiday weeks planned as holiday weeks, not as lost weeks
- Stop rules written in advance, re-dated from the August rollout
- A 12-month roadmap that follows the Swiss club calendar

Companion to: DLANG Sports OS Business Plan v2 (November 2026) and Financial Model v2. Replaces: 90-Day Operational Rollout, 24 August – 22 November 2026 (original kept in `docs/company/source/`).

Owner: Derrick Lang, Founder & CEO

Confidential.

---

# 00 How to use this document

This is a schedule, not a strategy. It assumes the decisions in Business Plan v2 have been taken and answers one question: what happens on Monday.

**Why there is a v2.** The August rollout ran 24 August to 22 November 2026 with three gates (willingness to pay 20 September, TWINT reconciling 18 October, club #1 operating 22 November) and a red line of a first paid signature by 30 November. On 11 November the codebase shows TWINT only as a label on manually recorded payments and no per-club payment accounts, so Gate 2 is very probably not met. The other gates are unconfirmed. Rather than pretend, this rollout starts again on **Monday 16 November 2026**, and its first week is spent finding out exactly where things stand.

The five rules of the August rollout are kept, with one addition:

1. **One thing ships every week.** Except the two holiday weeks, which ship maintenance only, on purpose.
2. **One selling conversation every week, minimum.** Except 21 December – 3 January, when Swiss clubs are closed and nobody will take the call.
3. **The gates are real.** Each has a written consequence, decided now.
4. **Compliance is not phase two.** No external club data touches the system before the compliance pack exists and is signed off.
5. **Write the weekly note.** Friday 16:00, ten minutes: what shipped, what sold, what is filed, what is blocked, what is the number.
6. **(New) Money first.** Until Gate 2 passes, payment work is the only engineering priority. Nothing else is started that competes with it for the same hours.

**Owners.** **F** = founder. **ENG** = CTO trial candidate or contractor working with AI coding agents. **REV** = paid senior reviewer (approves every merge touching payments, RLS, auth, migrations). **LAW** = startup / data-protection lawyer. **FID** = fiduciary. **SEC** = external security firm. **ADV** = advisors. **DL** = DLang academy staff (admin / finance).

**Status, updated 12 November 2026.** The founder answered most of the open questions (log: `docs/company/11_FOUNDER_DECISIONS_2026-11-12.md`): the company is **Swiss Preparatory Sports Academy GmbH (SPSA)**, bank account "SPSA Tech" *[Confirm register number and date]*; **FIT Digital was not filed** (0% in the model; pack being prepared); **no CTO** yet, and the plan is a **named human fractional CTO leading the AI agent team**; the **EUR 50k is secured but released only once a CTO is in place**; **Stripe Connect** is accepted; **>>venture>>** will be submitted by 30 November. Still *[Confirm]* in week 1: audits done and actual cash.

> **THE TWO TOP CASH ACTIONS (12 Nov 2026)**
>
> With FIT at 0% and the EUR 50k released in March 2027 once the CTO is
> in place, the v2 workbook shows cash negative from January 2027 and
> about –43.5k in February. So: (1) **sign the fractional CTO by 15
> December**; (2) **agree a January–March bridge of about CHF 45k by 15
> December** (founder funds, an investor advance, or deferring the CTO
> trial and pen-test costs). Then a pre-seed of about CHF 250–300k in
> total, including the EUR 50k, in H1 2027.

> **ONE DELIBERATE MISMATCH, KEPT FROM AUGUST**
>
> This rollout targets the first founding club signed on 31 January 2027.
> Financial Model v2 books the first paying club in February 2027 and
> plans cash against the downside (first club April 2027). Track against
> the rollout; fund against the model. If the rollout slips by six to
> eight weeks it lands on the downside, and the capital plan already
> assumes that.

> **THE SINGLE SENTENCE VERSION OF THESE 13 WEEKS**
>
> By 14 February 2027, real DLang parents should be paying real invoices
> by TWINT, card and QR-bill that reconcile automatically, DLang should
> have run one full term on the platform, at least one external club
> should have signed and paid, and the company should exist, own its IP,
> and have a round signed that is big enough for the plan.

---

# 01 The thirteen weeks at a glance

| Phase | Weeks | Dates | The point of it | Ends with |
|---|---|---|---|---|
| **Phase 0: Truth and rail** | W1–W2 | 16–29 Nov | Confirm what the founder's 12 Nov answers left open. Stripe Connect for DLang. Submit >>venture>>. Start the CTO search and the bridge. | Status sheet; Connect application (27 Nov); CTO shortlist (30 Nov); >>venture>> filed (30 Nov) |
| **Phase 1: Prove the money moves** | W3–W5 | 30 Nov – 20 Dec | Build TWINT + reconciliation; run it live on a DLang winter camp. Fix every claim. Book audits for January. **Sign the fractional CTO and agree the Jan–Mar bridge (15 Dec).** | **GATE 2 (18 Dec)**: a real TWINT payment reconciles automatically on DLang |
| **Phase 2: Holiday** | W6–W7 | 21 Dec – 3 Jan | Clubs closed. Maintenance only. Model refresh, IP paperwork, planning. | Workbook v2.1 (plan of record since 12 Nov) refreshed with actuals (3 Jan); IP assigned to SPSA (31 Dec) |
| **Phase 3: Sell and secure** | W8–W11 | 4–31 Jan | Audits, proposals, CTO structure proposal, compliance pack, security review, trademark check, round. DLang spring invoicing on the platform. | **GATE 1 (31 Jan)**; first founding club signed; convertible signed |
| **Phase 4: Operate** | W12–W13 | 1–14 Feb | Productise onboarding. Club #1 kicks off. DLang completes one full cycle. | **GATE 3 (14 Feb)**: DLang runs one full cycle on the platform |

## The five workstreams running in parallel

| | Workstream | Owner | Weekly time | The one metric |
|---|---|---|---|---|
| WS1 | **Build** (payments first) | ENG, reviewed by REV; F as product owner | ~20–24 h engineering + 4–8 h review | Something shipped this week: yes / no. Gate 2 status. |
| WS2 | **Sell** | F | 10–15 h (0 in W6–W7) | Audits held; proposals out; signatures |
| WS3 | **Capital and legal** | F + FID + LAW | 3–5 h | Days to the next filing deadline |
| WS4 | **Compliance and security** | F + LAW + SEC | 2–4 h | Controls complete before club #1 |
| WS5 | **DLang operations and team** | F + DL | 3–5 h | DLang payments on platform; fractional CTO signed by 15 Dec |

*Founder load: roughly 45–50 hours a week without an engineering partner, 30–35 with one. Two holiday weeks are deliberately light. The founder cannot carry W8–W11 at full intensity without the fractional CTO (target 15 December) or the reviewer as cover.*

---

# 02 Week by week

## WEEK 1 · Mon 16 – Sun 22 November 2026 · Truth week

| Workstream | Actions this week | Owner | Done when |
|---|---|---|---|
| **Capital & legal** | Confirm what the 12 Nov answers left open: SPSA register number, date, purpose clause and shareholders; audits done; cash at hand. Write a one-page retrospective of the August rollout (what was met, missed, why). | F | One-page status sheet shared with ADV and investor by **20 Nov** |
| **Capital & legal** | Ask LAW for a quote on: IP present assignment to SPSA, fund-holding / AML view, convertible review, and whether to carve the software business out of SPSA. Ask the investor to put the EUR 50k release condition ("a CTO in place") in writing. | F + FID + LAW | Requests sent |
| **Build** | Draft the payment architecture: Stripe Connect (one account per club, direct charges, application fee) vs Payrexx per club. Enable TWINT in Stripe test mode. Check QR-bill output against v2.4 (in force 14 Nov). | ENG + REV | Two-page architecture note; test TWINT payment attempted |
| **Sell** | Rebuild the target list: 40 named Romandie organisations, academies and camp operators first, international schools third, each with athlete count, current tooling, introducer, trigger event. Mark anyone already audited. | F | List exists, ranked |
| **Compliance** | Pull together whatever exists of the record of processing and sub-processor list. | F | Gap list |
| **Team** | Set up the weekly scorecard (one sheet). | F | Sheet live by 23 Nov |

**Ships:** architecture note; scorecard. **Sold:** nothing yet; list rebuilt. **Filed:** legal requests.

## WEEK 2 · Mon 23 – Sun 29 November · Choose the rail, file >>venture>>

| Workstream | Actions this week | Owner | Done when |
|---|---|---|---|
| **Build** | **Stripe Connect accepted (12 Nov).** Start Stripe Connect onboarding for DLang as the first connected account by 27 Nov (identity checks take time; setup guide `docs/ops/STRIPE_CONNECT_TWINT_SETUP.md`). Bank-accepted test QR-bill. | F + ENG + REV | Connect application submitted for DLang |
| **Capital & legal** | **Submit >>venture>> (deadline 30 Nov)** from the draft in `docs/company/applications/venture-2027/`. Request the written fund-holding / AML view. FIT: confirm the next intake and whether SPSA meets the company-age rule (27 Nov). | F; LAW | Submission receipt; LAW engaged; FIT date known |
| **Sell** | First approaches: 15 audit requests, framed as "20 minutes on how you register and collect, in exchange for a written summary of what it costs you". Aim for January dates; take any December slot offered. | F | 15 sent; 6+ January audits in calendars by end of W3 |
| **Compliance** | Draft record of processing activities (ROPA) v1. | F | Draft |
| **Team** | Fractional CTO search: brief from `docs/company/12_CTO_SOLUTION_AI_PLUS_HUMAN.md`; **shortlist by 30 Nov**. Approach two senior reviewers as cover. | F | Shortlist written |

**Ships:** test TWINT payment in staging; v2.4 QR-bill. **Sold:** 15 audit requests. **Filed:** >>venture>>; Connect application.

## WEEK 3 · Mon 30 November – Sun 6 December · Clean every claim, book the review

| Workstream | Actions this week | Owner | Done when |
|---|---|---|---|
| **Sell** | **Claim audit and deck fix (4 Dec).** Remove "cheaper than Spond on total cost" (use "cheapest payment rail"), qualify or remove "€6,160 MVP", replace "worldwide" with Swiss-first + gates, mark unbuilt modules as roadmap, show one cap table including any CTO grant. Same audit on landing page, prototype narration and playbook. | F | Every asset passes the claim rule |
| **Compliance** | **Book the external security review (4 Dec)** for January: tenant isolation / RLS, auth, Stripe webhook, output escaping. CHF 5–15k [Est.]. Open shared support mailbox, ticket log and status page. | F + SEC | Signed engagement; support basics live |
| **Build** | TWINT checkout + webhook reconciliation in staging: idempotency, failure states, duplicate protection, partial payments. Tests for each. | ENG, REV approves | Staging run passes |
| **DLang** | Pick the winter camp / programme for the live pilot; DL prepares the parent list; agree the go-live date (week of 7 Dec). | F + DL | Pilot programme set up on platform |
| **Capital & legal** | Trademark and domain brief to the attorney: "Global Sport OS" + 2–3 alternatives, CH/EU/US (4 Dec). Bridge options for Jan–Mar costed. | F + LAW | Brief sent |

**Ships:** TWINT + reconciliation in staging. **Sold:** 6+ January audits booked. **Filed:** security review booked.

## WEEK 4 · Mon 7 – Sun 13 December · DLang goes live with real money

| Workstream | Actions this week | Owner | Done when |
|---|---|---|---|
| **Build** | Promote TWINT + reconciliation to production for DLang only (feature flag per tenant). Monitor every webhook. | ENG + REV | Live on DLang tenant |
| **DLang** | **Live pilot (by 13 Dec):** real DLang parents register and pay a real winter-camp invoice by TWINT, card or QR-bill. | F + DL | Real payments received; reconciliation report |
| **Sell** | Hold 1–2 audits if anyone will meet before the holidays. Send each audit summary within 24 hours. | F | Summaries sent |
| **Compliance** | Draft DPA template and parent privacy notice (FR first, then EN, DE). | F → LAW | Drafts |
| **Team** | **Sign the fractional CTO (by 15 Dec)** and tell the investor, so the EUR 50k can be released. **Agree the Jan–Mar bridge (~CHF 45k) by 15 Dec.** Pre-contract the senior reviewer (4–8 h/week) by 16 Dec as cover. | F + REV | Signed CTO contract; bridge agreed; reviewer ready to sign |

**Ships:** TWINT live on DLang. **Sold:** 1–2 audits. **Filed:** CTO contract; bridge.

## WEEK 5 · Mon 14 – Sun 20 December · Gate 2: the money moves

| Workstream | Actions this week | Owner | Done when |
|---|---|---|---|
| **Build** | **GATE 2 (Fri 18 Dec):** at least 10 real DLang payments reconciled automatically, with zero manual steps; failure and duplicate cases tested. | ENG + REV + F | Gate evidence written up |
| **Sell** | **Gate 1 fallback price card (15 Dec):** a lower subscription plus a small fee on programme and camp value, modelled for three audited clubs. | F | One page ready to test in January |
| **Compliance** | Full compliance pack drafted (ROPA, DPIA covering minors' and health data and an **AI assistant addendum**, DPA with the AI provider as sub-processor, privacy notice FR/DE/EN, breach procedure) and sent to LAW (16 Dec). | F → LAW | With LAW |
| **Capital & legal** | IP present-assignment drafts received from LAW; signature arranged for W7. | F + LAW | Drafts |
| **Team** | Last working week before the break: hand over a P1-only on-call plan with a named backup for 24 Dec – 2 Jan. | F | On-call note |

**Ships:** Gate 2 evidence. **Sold:** fallback price card. **Filed:** compliance pack to LAW.

> **GATE 2 · Friday 18 December 2026 · red line 31 December · downside 31 January 2027**
>
> **Pass:** ≥10 real DLang payments (at least some by TWINT) reconcile
> automatically, with failure and duplicate cases tested and a Connect
> account (or the agreed fallback) live for DLang.
>
> **Fail by 18 Dec:** keep going; nothing else in WS1 starts.
> **Fail by 31 Dec (red line):** run the founding beta manually (QR-bill
> into the club's own account, reconciliation by hand) and keep payments as
> the only engineering priority. Do not sign an external club onto TWINT
> until it passes. **Fail by 31 Jan:** switch to the Payrexx fallback.

## WEEK 6 · Mon 21 – Sun 27 December · Holiday: maintenance only

Swiss clubs are closed. No selling, no releases except fixes.

| Workstream | Actions | Owner | Done when |
|---|---|---|---|
| **Build** | Maintenance only. P1 cover per the on-call note. | ENG on call | No P1 open |
| **Founder** | Off sales. Rest. | F | — |

**Ships:** nothing new, on purpose. **Sold:** nothing. **Filed:** nothing.

## WEEK 7 · Mon 28 December 2026 – Sun 3 January 2027 · Paperwork and the model

| Workstream | Actions | Owner | Done when |
|---|---|---|---|
| **Capital & legal** | **IP present assignment to SPSA signed (31 Dec)**: founder, SIDIS and every contractor (and the fractional CTO). | F + LAW + FID | Signed assignments |
| **Finance** | **Model refresh (3 Jan):** actual cash at 30 Nov, December actuals; refresh workbook v2.1 (already on the plan of record since 12 Nov: FIT 0%, EUR 50k in Mar 2027, lean cost, AI in the Club tier, EU/US pilot costs) with actuals. Size the pre-seed (CHF 250–300k incl. the EUR 50k). **One working cap table (3 Jan)** including any CTO equity. | F (+ ADV) | Updated model; one cap table |
| **Build** | Maintenance only. Plan W8–W13 build: FR string catalogue, CSV import, offline attendance, per-club Connect onboarding flow. | F + ENG | Board ready |

**Ships:** maintenance only. **Sold:** nothing. **Filed:** IP assignments.

## WEEK 8 · Mon 4 – Sun 10 January · CTO structure, audits resume

| Workstream | Actions | Owner | Done when |
|---|---|---|---|
| **Team** | **CTO structure proposal (Fri 8 Jan):** the fractional CTO proposes retainer, any equity and decision rights; the founder agrees in writing. If the CTO is still not signed, the reviewer model runs and the latest CTO date is 31 Jan. | F + CTO | Agreed in writing |
| **Build** | Translation layer: string catalogue + helper; French first on parent registration, invoices and reminders. | ENG + REV | First FR screens behind a flag |
| **Sell** | Audits resume: 2–3 this week. Ask every committee for its decision date. | F | Audits 3/10 done |
| **DLang** | DL prepares spring-term invoicing on the platform. | F + DL | Programmes and families ready |

**Ships:** FR string catalogue (first screens). **Sold:** 2–3 audits. **Filed:** CTO structure.

## WEEK 9 · Mon 11 – Sun 17 January · DLang spring invoicing, compliance signed off

| Workstream | Actions | Owner | Done when |
|---|---|---|---|
| **DLang** | **DLang spring-term invoices issued from the platform** (QR-bill + TWINT + card), reminders on. | F + DL | 100% of spring invoices from the platform |
| **Compliance** | **Compliance pack signed off by LAW (15 Jan):** subscription terms, founding addendum (with tier cap), DPA, privacy notice FR/DE/EN. Written AML view must be in hand. | LAW + F | Signed-off pack |
| **Capital & legal** | Trademark and domain check CH/EU/US on "Global Sport OS" + 2–3 alternatives (15 Jan); shortlist for the 15 Feb naming decision. | LAW | Search report |
| **Sell** | Audits 6/10. | F | 6 write-ups with verbatim price reactions |
| **Build** | CSV import with column-mapping preview (start). | ENG + REV | Spec + first PR |

**Ships:** DLang spring invoicing live. **Sold:** 3 more audits. **Filed:** compliance pack; trademark search.

## WEEK 10 · Mon 18 – Sun 24 January · Security review, proposals out

| Workstream | Actions | Owner | Done when |
|---|---|---|---|
| **Compliance** | External security review in progress; fix criticals and highs as they land. | SEC + ENG + REV | Findings tracked |
| **Sell** | Proposals to the 2–3 best audits, each with a named committee decision date; the 60-day refund and month-to-month terms stated. | F | ≥3 proposals out |
| **Capital & legal** | Convertible agreement final draft reviewed by LAW (conversion price, post-money cap, subordination, release on CTO in place, any CTO equity disclosed). Pre-seed term sheet (CHF 250–300k incl. EUR 50k). Insurance quotes (cyber + professional liability). | F + LAW | Final draft; term sheet; quotes |
| **Build** | CSV import finished; tested on DLang's own spreadsheet. | ENG + REV | Real spreadsheet imports cleanly |

**Ships:** CSV import. **Sold:** ≥3 proposals. **Filed:** insurance quotes.

## WEEK 11 · Mon 25 – Sun 31 January · Gate 1, first signature, round signed

| Workstream | Actions | Owner | Done when |
|---|---|---|---|
| **Sell** | **GATE 1 (31 Jan):** ≥6 of 10 audits at ≥3× value at the quoted price. **First founding club signed (31 Jan):** addendum + DPA, onboarding kickoff booked within 7 days. | F | Signed addendum; kickoff date |
| **Capital & legal** | **Convertible signed (31 Jan)**. Insurance bound (31 Jan). | F + LAW | Signed agreement; policy |
| **Compliance** | **Security review complete (31 Jan)**, zero open critical/high. | SEC + REV | Report |
| **Build** | Offline attendance: service worker + local queue + "saved locally" state (start). | ENG + REV | First PR |

**Ships:** security fixes. **Sold:** first founding club. **Filed:** convertible; insurance.

> **GATE 1 · Sunday 31 January 2027 · downside 15 March 2027**
>
> **Pass:** at least 6 of 10 audits show ≥3× value at the quoted price,
> on the club's own numbers, and at least 3 clubs accept the price in
> writing.
>
> **Fail:** stop selling at the current price. Test the fallback price
> card (lower subscription plus a fee on programme and camp value) with
> the next ten audits. Do not discount the current price to close.

## WEEK 12 · Mon 1 – Sun 7 February · Productise onboarding, club #1 kicks off

| Workstream | Actions | Owner | Done when |
|---|---|---|---|
| **Build** | Onboarding kit v1: setup checklist in product, import template, FR training video for admins. Club #1 tenant created; Connect onboarding for club #1 started. | F + ENG | Club #1 test invoice renders with its logo and a valid QR-bill |
| **Sell** | Club #1 kickoff (day 0–2). Follow up on the other proposals. | F | Kickoff held |
| **Build** | Offline attendance finished. | ENG + REV | Coach test with flight mode on |
| **Capital & legal** | EUR 50k: release requested now that the CTO is in place (cash Feb on the workbook base, **Mar** in the founder-facts case). Jan–Mar bridge drawn as needed. Pre-seed signed by 28 Feb. | F | Bank statement; signed pre-seed |
| **Build** | AI assistant opt-in switched on for DLang (beta), after the DPIA addendum sign-off. | ENG + CTO | DLang admins using it; logs reviewed weekly |

**Ships:** onboarding kit v1; offline attendance. **Sold:** proposals followed up. **Filed:** —.

## WEEK 13 · Mon 8 – Sun 14 February · Gate 3 and the next twelve months

| Workstream | Actions | Owner | Done when |
|---|---|---|---|
| **DLang** | **GATE 3 (14 Feb):** DLang runs one full cycle on the platform: register → pay (QR-bill, card, TWINT) → roster → attend → 7/14-day reminder. | F + DL | Cycle complete with <5% manual payment matching |
| **Sell** | Club #1 first real registrations. Two more clubs in negotiation for spring go-live (must be set up by 31 May). | F | Club #1 registrations live |
| **Team** | Write the 13-week retrospective and confirm the Q1–Q4 2027 roadmap below. | F | Retrospective sent with the monthly update |
| **Build** | Remaining beta item: per-club Connect onboarding self-serve (due 28 Feb). | ENG + REV | On track |

**Ships:** Gate 3 evidence. **Sold:** club #1 live; 2 in negotiation. **Filed:** retrospective.

> **GATE 3 · Sunday 14 February 2027 · downside 31 March 2027**
>
> **Pass:** DLang has run one full registration-to-attendance cycle, with
> admins active every week and fewer than 5% of payments matched by hand.
>
> **Fail:** freeze feature development. Spend the next cycle on adoption
> and stability inside DLang. Do not onboard a second external club until
> it passes.
>
> **Gate 3b (club #1 using it weekly, with a reference): 30 April 2027,
> downside 30 June 2027.**

---

# 03 Runbooks

The August runbooks are kept as written (workflow audit call, 20-minute demo, 30-day club onboarding, incident runbook; see the original rollout in `docs/company/source/`), with these changes:

- **Audit call:** add one question: "When does your committee decide, and who signs?" Write the date down. Sales cycle planning assumes 45–90 days.
- **Demo:** lead with the programme-to-payment chain on DLang's real data (anonymised). Do not show TWINT before Gate 2. Never say "cheaper than Spond"; show the payment-line comparison only.
- **Onboarding:** the gate is still the first real payment. Start Stripe Connect identity checks before day 0. At most two onboardings at once. No go-lives 15 December – 6 January; no migrations June–September.
- **Incident:** payment failures and data incidents get a same-day answer every day, including the holiday cover. No data about minors in WhatsApp.

---

# 04 Operating cadence and stop rules

## 4.1 The week (kept from August, two changes)

| When | What | Time |
|---|---|---|
| Monday 08:00 | Weekly metrics review against the scorecard; the one thing that must ship, the one club that must move, the one number being watched | 45 min |
| Monday after review | Engineering sync: merged PRs, failing checks, security items, approvals queued | 30 min |
| Mon–Thu, first 30 min | Support queue, payment exceptions, error tracker | 30 min/day |
| Tuesday and Thursday afternoons | Selling. Blocked out. | 4 h each |
| Wednesday | Deep build / review day. No calls. | Full day |
| Friday morning | Ship, and tell the clubs | 3 h |
| Friday 16:00 | Weekly note | 10 min |
| By the 5th of each month | Model refreshed with actuals; investor/advisor update sent | 90 min |

## 4.2 Stop rules (re-dated; the last row became a strategy review trigger on 12 Nov 2026)

| If this happens | Stop doing this | Start doing this |
|---|---|---|
| TWINT does not reconcile on DLang by 18 Dec; red line 31 Dec | Any non-payment engineering | Manual founding beta; payments only. Payrexx fallback if still failing 31 Jan. |
| Fewer than 6 of 10 audits at 3× by 31 Jan | Selling at the current price | Fallback price card with the next ten audits |
| No paid signature by 31 Jan (red line 31 Mar 2027) | Building features | Twenty more audits. The offer is wrong, not the product. |
| DLang has not run a full cycle by 14 Feb (red line 31 Mar) | Onboarding external clubs | Adoption and stability inside DLang |
| No fractional CTO signed by 15 Dec (latest 31 Jan) | The open-ended search | Reviewer + contractor + agents model; ask the investor whether the reviewer plus a named CTO start date satisfies the release condition |
| No written AML / fund-holding view by 15 Jan | Signing any club onto card or TWINT | QR-bill into the club's own account only |
| A club goes two weeks without an admin login | Selling to new clubs | Sitting with that club |
| Downside cash runway falls below 6 months, or the Jan–Mar bridge is not agreed by 15 Dec | All discretionary spend | Bridge, upsize, or cut engineering to maintenance; move the CTO trial and pen-test costs later |
| More than 2 concurrent onboardings | Signing more | Finishing the ones in flight |
| Any club asks about a claim you cannot evidence | Everything else, that day | The claim audit |
| Fewer than 10 paying clubs by 31 Mar 2028, or any missed gate | Business as usual | **Strategy review** (two weeks, with the CTO and advisors) of pricing, segment, channel and offer, ending in a written corrective plan. No kill switch (founder, 12 Nov 2026); see `docs/company/00_EXECUTIVE_PLAN.md` §4.7 |

## 4.3 The dashboard: six numbers, weekly (kept, one replaced)

| Number | Green | Amber | Red |
|---|---|---|---|
| Paying clubs | On or ahead of the milestone map | One month behind | Two months behind |
| **Payments auto-reconciled on DLang (%)** *(replaces MRR until Feb 2027)* | ≥95% | 80–95% | <80% |
| Weekly active admins per club | 3+ sessions | 1–2 | Zero for two weeks |
| Cash runway, downside case (months) | 9+ | 6–9 | Under 6 |
| Support first response (founding clubs) | Under 4 business hours | Under 1 day | Over 1 day |
| Conversations held this week | 3+ | 1–2 | Zero (outside the holiday weeks) |

MRR returns as a dashboard number once the first club pays. If only one number can be watched: until Gate 2, payments auto-reconciled; after it, weekly active admins per club.

---

# 05 The next twelve months, quarter by quarter (15 Feb 2027 – Feb 2028)

The Swiss club calendar governs the sequence. Committees decide January to April. Summer-camp registration opens around March. Season registration peaks June to September and nobody migrates during it unless set up by **31 May**. Clubs are closed around 21 December to 4 January. So Q1–Q2 2027 is the signing and set-up window, Q3 is the peak (operate, do not migrate), and Q3–Q4 2027 is the first real wave of list-price clubs.

| Quarter | Ships (product) | Sold (GTM) | Filed (legal / finance) | People | Exit criteria (base / downside) |
|---|---|---|---|---|---|
| **Q1 2027 (rest), 15 Feb – 31 Mar** | All four missing beta items done (**28 Feb**): CSV import, FR/EN translation, offline attendance, per-club Connect. Multi-club membership and cross-tenant tests in CI before club #2. AI assistant opt-in beta on DLang. Help centre wave 1 (~20 articles FR/EN) by 31 Mar. | Club #1 live. DLang case study with measured before/after published **31 Mar** (downside 30 Apr). 2 more clubs in negotiation. EU and US design-partner shortlists (**31 Mar**). | Naming decision (**15 Feb**). Trademark filing in CH (**28 Feb**). Pre-seed signed (**28 Feb**). **EUR 50k cash in (Mar)**. VAT registration decision with FID (**31 Mar**). | Fractional CTO running the AI agent team; reviewer as second key if wanted. | Gate 3 passed (14 Feb / 31 Mar); 2 paying clubs live; first strategy-review checkpoint (31 Mar) |
| **Q2 2027, Apr – Jun** | Onboarding kit complete (recorded walkthroughs FR, in-app checklist, accountant export). DLang Easter camp and summer-camp registration on the platform. AI assistant opt-in for founding clubs once acceptance criteria are met. EUR/SEPA and USD/US-English groundwork for the pilots. Hardening for peak load. | Public launch "Season 2027/28 ready" (Apr–May). **3 paying clubs by May** (downside Aug). All 2027 clubs set up by **31 May**. **5 founding clubs by Jun** (downside Sep). Paid design pilots at list price in CH. **Pilot go/no-go 30 Jun** (one free EU, one free US). | Pre-seed cash in by **Apr** at the latest. EU and US counsel memos (**31 May**). DPA signed with every club before import. | Founder capacity check: never more than 2 onboardings at once. Pilot support hours named. | Gate 3b: club #1 weekly with a reference (30 Apr / 30 Jun) |
| **Q3 2027, Jul – Sep** | No risky releases during the peak. Reliability, support tooling, status page. DLang 2027/28 season registration and invoicing on the platform. Pilot tenants set up (Jul–Aug). | Referral programme on (after 2 measured case studies). First list-price clubs (CHF 490 + setup fee) signed for the season. Founding slots close **30 Sep**. No migrations. **Free EU pilot live Sep** (downside Jan 2028); **free US pilot live Sep–Oct** (downside Mar 2028). | Annual policy review; sub-processor list current. Art. 27 representative appointed before the EU pilot. | No founder leave Jun–Sep. Customer-success recruiting opens (Sep–Oct) to cover Swiss notice periods. | DLang runs the whole club (Sep / Oct 2027) |
| **Q4 2027, Oct – Dec** | Accounting export first (Bexio), then J+S export scoping. Multi-site needs scoped from real customers only. Helpdesk tool. Health-score dashboard. | **10 paying clubs by Oct** (downside Mar 2028). Autumn campaign. Pilot 60-day reviews; EU case study drafted. EUR-track readiness review, no selling. International schools pipeline. | Paid EU prerequisites scoped (non-Union OSS) [Verify]. Model re-run on actuals; Year-2 capital plan; seed preparation begins for a Q1 2029 raise. | Part-time customer success hired for **Jan 2028** (downside Jun 2028). | EUR gate review (needs ≥10 Swiss clubs); paid EU pull-forward to early 2028 if the EU pilot is strong |
| **Q1 2028, Jan – mid-Feb** | Self-serve onboarding track opens (downside Q3 2028). Native-app decision on measured push/retention data. AI assistant pricing review (included in the Club tier until then). | Committee season again: second signing window. First paid EU club signed if pulled forward. Federation conversations (Swiss Basketball via DLang first) toward an H2 2028 pilot. | Strategy review checkpoint scheduled for 31 Mar 2028 (fewer than 10 paying clubs → structured review, not a stop). | Customer success lead starts (Jan). | ~12+ paying clubs; churn ≤1.8%/month |

**Beyond February 2028 (base / downside):** about 25 paying Swiss clubs Oct 2028 / Jun 2029 · CHF 10k MRR Dec 2028 / Q3 2029 · first paid EUR-track club signed Q2 2028 (early 2028 on a strong pilot), live Sep 2028 / 2029 · federation or multi-site pilot H2 2028 / 2029 · seed CHF 400–500k Q1 2029 · paid US sales not before H2 2029 · broad white-label resale 2029 at the earliest · first EBITDA-positive month (v2 workbook) about mid-2030 on the lean plan of record (Q4 2030 on default costs; upside Aug 2029; downside 2032 or later). Entry gates are in Business Plan v2, section 13.3.

---

# 06 Templates

The August templates are kept (first-contact message, audit summary within 24 hours, one-page founding-club proposal, weekly note), with two edits: the founding proposal states the lifetime price is capped at the signed tier and names the committee decision date; and every template uses "cheapest payment rail", never "cheaper than Spond".

## 6.1 Week 1 checklist: start here (Mon 16 November 2026)

1. Write down what is still open after the 12 Nov answers: SPSA register number and date; audits done; cash today. *(F, Mon)*
2. Start the fractional CTO search (shortlist by 30 Nov) and cost the January–March bridge (about CHF 45k). *(F)*
3. Email a startup lawyer for a quote on IP assignment, fund-holding view and convertible review. *(F)*
4. Enable TWINT in Stripe test mode; generate one v2.4 QR-bill. *(ENG)*
5. Rebuild the 40-name target list, academies and camp operators first. *(F)*
6. Finish the >>venture>> submission from the draft in `docs/company/applications/venture-2027/` (deadline 30 Nov). *(F)*
7. Create the weekly scorecard sheet. *(F)*
8. Book the Friday 16:00 weekly note in the calendar for the next 13 weeks. *(F)*
9. Send the retrospective and status sheet to advisors and the investor by Friday 20 Nov. *(F)*
