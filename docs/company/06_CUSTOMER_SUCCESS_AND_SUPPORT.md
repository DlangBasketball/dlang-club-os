# DLANG Sports OS: Customer Onboarding, Success and Support

**Status:** working document, re-baselined 11 November 2026
**Owner:** founder / CEO until the part-time customer success hire (base Jan 2028, downside Jun 2028)
**Builds on:** Business Plan §8.1 "Onboarding", §8.2 "Support model", §8.3 "Operating rhythm" and the onboarding-fee table (Aug 2026); the 90-Day Rollout; `09_FOUNDER_PLAN_REVIEW.md`; and the companion documents `01_BUSINESS_MODEL.md`, `02_GO_TO_MARKET.md` and `04_ORG_DESIGN_AND_HR.md`.

**Labels**
- **[Founder]**: a decision or figure from the founder's August 2026 materials, kept.
- **[Est.]**: an estimate or assumption made here.
- **[Verify]**: must be confirmed by counsel, a fiduciary, a payment provider or a vendor before anyone relies on it.

---

## 1. Decisions in brief

1. **The founder's rule stays the backbone: a club is not onboarded until real money has moved** (first real registration and payment end to end) [Founder §8.1]. Every track below ends at that gate. The signature-to-first-registration time (target ≤ 14 days) stays the lead churn predictor [Founder].
2. **Three onboarding tracks, but not all on sale now.** *Assisted (about 2 weeks of calendar time, 8–10 founder hours)* is the only track sold in 2027. *Self-serve (1 day of setup)* opens to customers no earlier than **Q1 2028** (downside Q3 2028), once CSV import, Stripe Connect self-onboarding, the in-product checklist and the help centre exist and have been used on at least 10 assisted clubs. *Enterprise (about 6 weeks)* is designed now and first used at the federation or multi-site pilot, **H2 2028** (downside 2029).
3. **Onboarding fees stay as a filter** (CHF 750 / 1,500 / 2,900) [Founder]. Self-serve does not remove the Starter fee; it lowers the delivery cost behind it.
4. **Support promises are cut to what one founder can keep.** Founding clubs keep direct founder access for 24 months [Founder], but on a logged channel, with posted hours and a defined holiday rota. No "24/7" claim anywhere. Money and data incidents are answered the same day, always [Founder].
5. **Productise before club six, which now falls in Jul–Sep 2027 (base).** That falls in the registration peak, when nobody new is migrated. So the onboarding kit is built **Feb–May 2027** while founding clubs 1–5 are onboarded [Founder rule, re-dated].
6. **Customer success is measured from day one** with a manual monthly health sheet. An in-product health score follows in Q4 2027. NPS is reported as raw counts until there are at least 20 responses.

---

## 2. Where we are (11 Nov 2026)

| Item | State | Consequence for this document |
|---|---|---|
| Paying external clubs | 0. Reference customer DLang Basketball, 145+ athletes [Founder] | DLang is tenant #1 and the rehearsal for every playbook here |
| Tenant setup in the product | Org onboarding form, branding (logo, primary colour), localisation (currency, default locale, languages), staff invitations, consents, audit log, CSV **export** exist on `main`. Terminology and other white-label platform work sit on unmerged branches | Branding and staff invites can be self-served today. Terminology and custom domain are **not** yet a sellable step |
| CSV **import** | Missing | All migrations are assisted (founder-run import) until 28 Feb 2027 (base) |
| Per-club payment accounts (Stripe Connect) | Missing. One Stripe account; TWINT is only a label for manually recorded payments | No external club can collect on its own account yet. This is the critical dependency for every track |
| Multilingual UI | Missing (no translation layer) | FR/EN training and help content first; DE when the first German-speaking club is in pipeline |
| Offline attendance | Missing | Coach training must assume connectivity until it ships |
| Support tooling | None. Founder inbox and phone | Set up minimal tooling by 4 Dec 2026 (§8) |

**Capacity reality [Founder + Est.]:** onboarding takes 8–10 founder hours per club [Founder]; support delivery is budgeted at CHF 55 per club per month [Founder], which is about 1–2 hours a month at founder-equivalent rates. With the founder also selling, building and running DLang, the work-in-progress cap is **at most 2 clubs onboarding at once** (`02_GO_TO_MARKET.md`).

---

## 3. Tenant onboarding

### 3.1 The checklist (all tracks)

Each step has an exit test. A step without a passed exit test is not done.

| # | Step | What it covers | Exit test | Product status (11 Nov 2026) |
|---|---|---|---|---|
| 1 | Contract and kickoff | Signature, onboarding fee invoiced, data processing agreement (DPA) signed, kickoff booked within 7 days [Founder] | Date in calendar; DPA countersigned | DPA template due with compliance pack, 15 Jan 2027 [Verify: counsel] |
| 2 | Organisation profile | Legal name, address, languages, currency, season dates, VAT status of the club | Org record complete; season calendar entered | Exists |
| 3 | Branding | Logo, primary colour, sender name, email footer, registration page header | Test invoice and test email render with club logo [Founder exit test] | Exists (logo, colour). Branded sender domain: Q3 2027 add-on [Est.] |
| 4 | Domain | Default sub-path or sub-domain; custom domain only for Academy and above or as an add-on | Public registration link resolves over HTTPS | Custom domain not on `main`. Sell from Q3 2027 at the earliest |
| 5 | Terminology | "Athlete/player", "programme/team/camp", "coach/trainer", "season/term" per sport and language | Parent-facing pages read in the club's own words | On a platform branch; ships with the translation layer (target 28 Feb 2027) |
| 6 | Payment setup | Club's own Stripe Connect account (KYC, bank account), TWINT and card enabled, QR-bill with the club's QR-IBAN or IBAN, structured address, invoice numbering pattern | A CHF 1 test payment by TWINT reaches the club's account and reconciles automatically; test QR-bill scans in a Swiss banking app | Connect missing. Gate 2 on DLang 18 Dec 2026 (downside 31 Jan 2027). QR-bill works |
| 7 | Data import | Families, athletes, guardians, medical/consent flags, open balances | Athlete count matches the club's own records exactly [Founder] | Assisted only until CSV import ships (28 Feb 2027 base) |
| 8 | Staff invites | Admin, finance, coach roles; two admins minimum (no single point of failure) | Every invited coach has logged in once | Exists (roles: admin, finance, coach, parent) |
| 9 | First programme live | One real programme or camp, price, capacity, public registration link | Director sends the link to one real parent [Founder] | Exists |
| 10 | **Money moved** | First real registration and payment end to end | **The gate.** Not onboarded until this passes [Founder] | Depends on step 6 |
| 11 | Coach adoption | 30-minute group training on their own phones with their own roster [Founder] | Every coach takes attendance for one real session [Founder] | Exists (online only) |
| 12 | Parent launch | Club announces DLANG in parents' languages with supplied templates | 60% of families opened the parent app at least once [Founder] | Templates FR/EN first, DE/IT later |
| 13 | First reminder cycle and review | Reminders run; founder and director review before/after numbers | Written before-and-after: hours spent, money outstanding [Founder]. This is the case study | Exists |

### 3.2 Three tracks and their timelines

| | Self-serve | Assisted | Enterprise |
|---|---|---|---|
| Who | Starter, simple single-site clubs with clean data | Club and Academy; every founding club | Multi-site, academy groups, federation pilots |
| Setup duration | **1 day** of setup (steps 2–9); money-moved gate within 14 days | **2 weeks** to the money-moved gate; habit-building to day 30 [Founder: "a working day spread over a fortnight"] | **6 weeks** to first site live; further sites in waves of 2–4 weeks [Est.] |
| DLANG hours | ≤ 1.5 h (check-in call, import review) [Est.] | 8–10 h now [Founder] → ≤ 6 h by club 15 (`01_BUSINESS_MODEL.md`) | 25–40 h [Est.], priced from CHF 5,000 (`01_BUSINESS_MODEL.md`) |
| Fee | CHF 750 Starter fee kept [Founder] | CHF 1,500 / 2,900 [Founder] | Quote, from CHF 5,000 [Est.] |
| Available | **Q1 2028 base / Q3 2028 downside** | **Now** (first external club Feb 2027 base) | **H2 2028 base / 2029 downside** |
| Entry gate | CSV import with validation, Connect self-onboarding, in-product checklist, help-centre wave 2, ≥ 10 assisted clubs done | — | ≥ 10 live Swiss clubs, external pen test passed, a QBR and SLA the company can staff |

**Assisted track day by day** (kept from Founder §8.1, with re-baselined dependencies):

| Day | Milestone | Owner |
|---|---|---|
| −14 to 0 | Pre-kickoff: club starts **Stripe Connect KYC** and sends its data export; DLANG reviews data quality | Club treasurer + founder |
| 0 | Signature, fee invoiced, kickoff within 7 days | Founder |
| 1–2 | Setup call (60 min): branding, languages, terminology, invoice template; test invoice renders | Founder + club admin |
| 3–5 | Import and reconciliation of athlete count | Founder |
| 6–8 | First real programme and registration link | Admin, founder on call |
| 9–12 | **Money moved** | Parent |
| 13–16 | Coach training | Founder |
| 17–21 | Parent launch | Admin |
| 22–30 | First reminder cycle and before/after review | Founder |

**Why KYC starts before day 0 [Est., Verify with Stripe]:** Connect onboarding for a Swiss association (Verein) requires statutes or a committee extract, an authorised signatory's ID and a bank account in the club's name. Committees are slow to produce these: plan 1–3 weeks. TWINT activation through the provider may add more [Verify]. If KYC is not complete by day 9, the assisted track slips and the club stays on QR-bill only until it is. That fallback works today.

**Enterprise track (6 weeks) outline [Est.]:** week 1, discovery and site map, data-ownership and DPA chain (federation as controller or processor? [Verify: counsel]); week 2, configuration of multi-team structure, roles and terminology per site; week 3, pilot-site import and payments; week 4, pilot-site money-moved gate; week 5, train-the-trainer for site admins; week 6, go-live review, SLA and QBR calendar agreed. Further sites follow in waves.

### 3.3 Seasonal windows (Swiss)

| Window | Rule |
|---|---|
| Jan–May | **Main onboarding window.** Last safe start for next season: end of May (`02_GO_TO_MARKET.md`) |
| Jun–Sep | Registration peak, summer camps, season start. **No new migrations.** Only clubs that are already live get support. Exception: a camp-only operator whose next programme is a winter camp |
| Oct–Nov | Second, smaller window for clubs whose spring programmes start in Jan–Feb |
| 15 Dec–6 Jan | No go-lives. Winter camps run on clubs that are already live |

---

## 4. Migration playbook (spreadsheets, WhatsApp and other tools)

The founder plan names the real competitor: spreadsheet plus WhatsApp plus paper [Founder §1]. Migration is where retention is won or lost: a club fully migrated in the first 30 days stays [Founder].

### 4.1 Source systems

| Source | What to get | How | Watch-outs |
|---|---|---|---|
| Excel / Google Sheets | Family, athlete, guardian, team, fee, paid/unpaid lists | DLANG import template (CSV). Founder maps columns until self-serve import ships | Duplicate families under two parents' names; birth dates in mixed formats; siblings sharing an email |
| WhatsApp groups | Group membership (names, phone numbers), not message history | Club exports member list or admin types it; phones matched to imported guardians | **Do not import chat history.** Personal data of minors [Verify: counsel]. The groups are repurposed, not killed |
| Paper forms, PDFs | Consents, medical notes | Re-collect through DLANG registration and consent flow at the next season's registration | Do not scan sensitive health data into notes fields |
| ClubDesk, Webling | Member list, fees | Their CSV/Excel member export [Verify current export options] | Membership-fee logic differs from programme pricing; re-model rather than copy |
| Spond | Members and groups | Its export features, if available [Verify] | Payment history stays in Spond; take open balances only |
| Fairgate, Paak, others | Member data | Request a GDPR/revDSG data-portability export if no self-serve export [Verify] | Federation-linked fields (licence numbers) may be needed again later |
| Bank / QR-bill records | Open balances per family | Treasurer's open-items list | Migrate **open balances only** as opening items. History only in Academy tier (up to 2 years [Founder]) |

### 4.2 Steps

| Step | Action | Exit test |
|---|---|---|
| M0 Data audit | Treasurer and DLANG review the sources together (30 min) | Single agreed source of truth per data type |
| M1 Clean | Club fixes duplicates in its own sheet using DLANG's checklist | ≤ 2% rows flagged by validation [Est.] |
| M2 Map and import | Template mapping, dry run, then import | Counts match exactly [Founder] |
| M3 Opening balances | Open items entered as opening invoices dated at cut-over | Sum equals treasurer's open-items total to the franc |
| M4 Parallel run | Old process and DLANG side by side for **one billing cycle at most** | Treasurer signs off the reconciliation |
| M5 Cut-over | Announce date; old sheet set read-only; new registrations only via DLANG link | No new entries in old sheet after cut-over |
| M6 WhatsApp repurposed | Groups keep chat; payments, registrations, schedules and attendance move to DLANG. Pinned message links to the parent app | Treasurer stops chasing payments in WhatsApp |
| M7 Close | Old tool cancelled after the club confirms export archived | Club confirms. No double costs |

**Rollback:** until M5, the club can revert at zero cost. The 60-day refund promise [Founder] covers the rest. DLANG always provides a full CSV export (exists) so the exit is real; this is also a selling point to Swiss committees.

---

## 5. Training curriculum

Formats: live (video call or on-site in Romandie), recorded (5–8 minute videos), and help-centre articles. Languages: **FR and EN first**, DE from the first German-speaking club, IT not before 2028 [Est.].

| Role | Module | Format and length | When | Proof of completion |
|---|---|---|---|---|
| **Club admin** | A1 Setup and settings tour | Live 60 min (assisted) / video (self-serve) | Day 1–2 | Test invoice rendered |
| | A2 Programmes, camps, registration links, capacity, waitlists | Live 30 min + 2 videos | Day 6–8 | First programme live |
| | A3 Families, athletes, consents, data protection basics | Video 8 min + article | Day 3–5 | Import reconciled |
| | A4 Messaging and announcements | Video 6 min | Day 17 | Parent launch sent |
| | A5 Reports, export, season close | Live 30 min | Day 22–30 | Before/after review done |
| **Finance / treasurer** | F1 Payment methods, Stripe Connect payouts, QR-bill | Live 45 min | Before day 9 | Test payment reconciled |
| | F2 Reminders, open items, credits, refunds | Video 8 min | Day 22–30 | First reminder cycle |
| | F3 Year-end and VAT basics in DLANG (not tax advice) | Article | Season end | — |
| **Coach** | C1 Roster, attendance, session notes on the phone | Live group 30 min [Founder] + 3-minute video | Day 13–16 | One real session's attendance taken [Founder] |
| | C2 Messaging parents within club rules | Video 4 min | Day 13–16 | — |
| **Parent** | P1 Register, pay with TWINT/QR-bill, manage consents | 1-page guide + 2-minute video, per language | Parent launch | 60% opened the app [Founder] |
| | P2 Schedule, absences, messages | In-app tips | Ongoing | — |
| **Enterprise site admin** | E1 Train-the-trainer: A1–A5 + C1 delivered by the site admin | Live 2 × 90 min | Enterprise week 5 | Site admin trains one coach group unaided |

**Build order [Est.]:** A1, C1 and P1 recorded in FR by **7 Feb 2027** (W12 in `02_GO_TO_MARKET.md`), the rest in FR and EN by **31 May 2027**. Recordings are made while onboarding founding clubs 1–3, using DLang data with consent or synthetic data, never another club's data.

---

## 6. Help centre and knowledge base

Scope: about 45 articles by end-2027. Every article is written from a real support question (§11). Each article has an owner, a "last verified against release" date, and screenshots in the demo tenant only.

**Languages:** ● = in the wave, ○ = later. FR is the master for Romandie; EN is the master for the product team. DE wave starts when the first German-speaking club is in pipeline (base Q3 2027, downside 2028). Machine translation is allowed only with native review [Est.].

| Wave and date (base / downside) | Section | Articles | EN | FR | DE |
|---|---|---|---|---|---|
| **Wave 1: 31 Mar 2027 / 30 Apr 2027** (≈ 20) | Getting started | Welcome checklist; Set up your club profile; Add your logo and colours; Invite staff and set roles; Season and calendar setup | ● | ● | ○ |
| | Payments | Connect your payout account; Enable TWINT and cards; QR-bill: IBAN, QR-IBAN and structured address; How payouts and fees work; Reconcile a payment | ● | ● | ○ |
| | Data | Import families and athletes (CSV); Fix import errors; Export your data | ● | ● | ○ |
| | Programmes | Create a programme or camp; Share a registration link; Manage capacity and waitlists | ● | ● | ○ |
| | Parents | How to register and pay (parent guide); Managing consents | ● | ● | ○ |
| | Coaches | Take attendance on your phone | ● | ● | ○ |
| **Wave 2: 30 Sep 2027 / 31 Jan 2028** (+15) | Billing | Reminders and dunning; Credits and refunds; Instalments; Sibling discounts; Invoice numbering | ● | ● | ● |
| | Operations | Bookings and player-development sessions; Schedules and venues; Messaging and announcements; Documents | ● | ● | ● |
| | Privacy and security | Data protection at DLANG (revDSG/GDPR); Two admins and account recovery; Audit log; Deleting a family | ● | ● | ● |
| | Migration | From spreadsheets; From WhatsApp groups; From another club tool | ● | ● | ● |
| **Wave 3: H2 2028 / 2029** (+10) | Enterprise and partners | Multi-site setup; Site admin roles; Federation dashboards; SLA and incident process; Custom domain; Terminology per site; SEPA for EU clubs; EUR invoicing | ● | ● | ● |
| Always | Status and trust | Status page; Release notes (weekly Friday changelog [Founder]); Support hours and how to reach us | ● | ● | ● |

---

## 7. Support tiers and SLAs

Hours are **Swiss business hours, Mon–Fri 08:00–18:00 CET**, excluding Vaud public holidays, unless stated. Targets are **first response**, not resolution.

| Tier | Channel | Normal (P3) | Degraded (P2) | Money or data incident (P1) | Extras |
|---|---|---|---|---|---|
| **Founding clubs** (5, 24 months) [Founder] | Direct founder line (WhatsApp Business or Slack Connect) **plus** email ticket | 4 business hours, Mon–Sat [Founder "6 days a week", kept with posted hours 08:00–19:00 Sat included] | 2 hours, Mon–Sat | Same day, every day [Founder] | Quarterly roadmap call [Founder] |
| **Academy / Multi-site** | Priority email and phone [Founder] | 4 business hours [Founder] | 2 business hours | Same day, every day | QBR (§10); named contact |
| **Club** | Email, in-app | 1 business day [Founder 24 h] | 4 business hours | Same day, every day | Half-yearly check-in |
| **Starter** | Email, in-app help [Founder] | 2 business days [Founder 48 h] | 1 business day | Same day, every day | — |
| **Enterprise / federation** (2028+) | As Academy + contracted SLA | Per contract, no stronger than Academy until a second support person exists | Per contract | Same day, every day | Monthly ops call, QBR |

**Severity definitions:** **P1**: parents cannot pay, wrong amounts charged, payouts missing, data exposed or lost, platform down. **P2**: a core workflow is broken for one club with a workaround (registration, attendance, reminders). **P3**: questions, how-to, cosmetic issues, feature requests.

**Rules**
- **The founder line is logged.** Every WhatsApp or Slack question is copied into the ticket log the same day [Founder rule: log every inbound question]. No athlete health or consent data in chat [Verify: counsel]; move it to the ticket.
- **Holiday rota.** 24 Dec–2 Jan and the founder's planned leave: P1 only, announced to clubs 4 weeks ahead, with a named backup (CTO partner or contractor) holding production access under the audit log. No founder leave Jun–Sep (registration peak) [Est.].
- **Support access to tenant data** only through a logged, time-limited mechanism visible in the club's audit log [Est.; product item Q2 2027].
- **No contractual service credits before 2028.** Targets are published; credits only in Enterprise contracts, reviewed by counsel [Verify].

---

## 8. Support tooling (by stage)

Real tool choices are made at each stage against these criteria: EU or Swiss data hosting option and a DPA; multilingual knowledge base; shared inbox with SLA timers; low per-seat cost at 1–3 seats; an API so tickets can be tagged by `org_id`. Vendor prices are not quoted here [Verify at purchase].

| Stage | When | Tooling |
|---|---|---|
| **0: DLang pilot** | by **4 Dec 2026** | `support@` shared mailbox; ticket log in a spreadsheet (date, club, role, language, type, severity, time to first response, resolution, product area); error tracking on the app; public status page; screen recorder for videos |
| **1: founding clubs** | Feb–Sep 2027 | Add WhatsApp Business (founding clubs only) and a scheduling link for kickoff and training; help centre wave 1 on a simple docs site under the DLANG domain; in-product checklist (Q2 2027) |
| **2: 10–40 clubs** | from Q4 2027 (base) | Helpdesk with multilingual KB, macros, SLA timers and in-app widget; CRM link for renewal dates; internal health dashboard reading platform data |
| **3: partners and enterprise** | 2029+ | Partner-scoped tier-1 queues for implementation partners and resellers (`02_GO_TO_MARKET.md`); on-call rota tool once a second engineer exists |

**AI support assistant:** the product's assistant module could later draft answers from the help centre. It stays **out of the beta** [Founder scope]. Earliest use: internal reply drafting in 2028, once the knowledge base has ≥ 40 articles and 6+ months of ticket log, and with a data-protection review [Verify].

---

## 9. Health scoring and churn signals

### 9.1 Health score (0–100) [Est. weights, to be recalibrated after the first renewal season, Sep 2028]

| Component | Weight | Measure (from platform data) |
|---|---|---|
| Money flowing | 30 | Share of the club's issued invoices in the last 60 days paid through DLANG (TWINT, card or QR-bill reconciled) |
| Admin activity | 20 | Days with an admin or finance login in the last 4 weeks |
| Coach adoption | 15 | Share of scheduled sessions with attendance taken |
| Parent adoption | 15 | Share of families who used the parent app in the last 60 days |
| Programme usage | 10 | Live programmes and new registrations versus the same season phase last year (or plan) |
| Relationship | 10 | Open P1/P2 tickets, last CSAT, NPS answer, champion still in role |

**Season adjustment:** compare each club with its own season phase. Low activity in July is normal for a club; low activity in late August is a red flag.

**Bands and plays:** **Green ≥ 70**: ask for referral or case study. **Amber 50–69**: check-in call within 10 business days; targeted training. **Red < 50**: founder call within 5 business days, written recovery plan, director informed.

**Implementation:** a manual monthly sheet from the first external club (Feb 2027). The internal dashboard comes in Q4 2027 (base) / Q2 2028 (downside), built from the tenant tables, which already carry `org_id`.

### 9.2 Churn signals (act on any one)

| Signal | Why it matters |
|---|---|
| Signature → first real registration > 14 days | Strongest predictor [Founder] |
| Money moved through DLANG falls below 50% of invoices | The club is collecting elsewhere, so DLANG has become a cost, not the rail |
| Committee change at the AGM / champion leaves | Swiss club decisions are committee decisions; a new treasurer re-opens the tool choice |
| Data export requested outside season close | Usually a sign the club is evaluating an alternative |
| Coach attendance < 30% after 6 weeks live | The club is running two systems |
| Parents told to "just pay by bank transfer" again | Payment habit lost |
| Unpaid DLANG invoice > 30 days | Budget or value problem |
| Federation announces a free tool deal (e.g. the Fairgate federation deals [Founder]) | Price objection becomes structural |
| Renewal window Aug–Sep with amber or red score | Churn here is seasonal and decided at renewal (`01_BUSINESS_MODEL.md`) |

**Churn target:** ≤ 1.5% per month logo churn [Founder base], measured and reported at the Aug–Sep renewal, not as a linear monthly figure.

---

## 10. QBR template (Academy, Multi-site, federations)

Cadence: quarterly, 60 minutes, avoiding Jun–Sep peaks (so: Jan, Apr, Oct, plus a short season-start check in Sep). Founding clubs get the founder's quarterly roadmap call instead [Founder].

| # | Section | Content | Time |
|---|---|---|---|
| 1 | Goals check | The club's 2–3 goals set at kickoff (e.g. hours saved, money outstanding, registration speed) | 5 min |
| 2 | Value delivered | Before/after: admin hours a week (refund guarantee is written against 4 h/week [Founder]); outstanding receivables; days to collect; share paid by TWINT/QR-bill | 15 min |
| 3 | Adoption | Health score by site; coach attendance rate; parent activation; top 3 unused features relevant to goals | 10 min |
| 4 | Support review | Tickets by type and severity; SLA performance; open issues | 5 min |
| 5 | Season ahead | Registration dates, camps, new sites, staff changes, committee or AGM dates | 10 min |
| 6 | Roadmap | What shipped; what is planned; the club's top 3 requests and an honest yes/no/later | 10 min |
| 7 | Actions | Owners and dates on both sides; renewal or expansion if relevant | 5 min |

**Data pack** is sent 3 business days before. **For federations, also include:** member-club adoption table, aggregated (never individual athlete) data, data-processing chain review, and the partner commercial terms (per-club rate about 20% below list [Founder §7.5]).

---

## 11. Feedback loop into product

1. **Tag every ticket** with product area, role, language and type (bug, how-to, request, billing) [Founder logging rule].
2. **Weekly, Monday:** top 5 tags of the week go into the product decision [Founder §8.3]. Any how-to asked **3 times** gets a help-centre article or a UI fix within 2 weeks [Est.].
3. **Weekly, Friday:** ship and publish a changelog clubs can see [Founder]. Close the loop with the clubs that asked.
4. **Quarterly:** founding-club roadmap vote [Founder]; requests are weighed by number of clubs, ARR share and fit with beta scope. **Scope rule:** a request that contradicts the beta scope (native apps, broad AI, US features) is logged, not built, before its phase gate.
5. **Monthly metric:** support hours per club per month (target ≤ 2 h, `02_GO_TO_MARKET.md`) and tickets per 100 athletes. A rise means the product, not the support desk, is the problem.

---

## 12. NPS and CSAT targets

| Metric | Who, how | 2027 target | 2028 target | Note |
|---|---|---|---|---|
| CSAT (ticket) | 1-question survey after each resolved ticket | ≥ 90% satisfied | ≥ 92% | From the first external club |
| First-response SLA met | Ticket log | ≥ 95% | ≥ 97% | P1 same day 100% |
| Admin NPS | Club admins and treasurers, twice a year (Oct and Mar) | Report raw counts; aim for ≥ 40 once n ≥ 20 | ≥ 40 | n will be < 20 in 2027: do not quote NPS externally before that |
| Parent CSAT | In-app, after first payment and at season end, in the parent's language | ≥ 85% | ≥ 88% | Max 2 prompts a year per parent |
| Coach ease score | In-app, after 4 weeks live | ≥ 4/5 | ≥ 4.2/5 | — |
| Time to money moved | Signature → first real payment | ≤ 14 days median | ≤ 10 days | Founder predictor |
| Onboarding hours per club | Time log | ≤ 10 h → ≤ 6 h by club 15 | ≤ 4 h (assisted), ≤ 1.5 h (self-serve) | [Est.] |

All targets are [Est.] for a market with no measured baseline yet. They are reviewed at the first full renewal season (Sep 2028).

---

## 13. Capacity and staffing

| Clubs live | Onboarding load | Support load [Est.] | Who |
|---|---|---|---|
| 1–5 (2027 H1) | 8–10 h per club, max 2 in parallel | ≤ 10 h/month | Founder; CTO partner or contractor as P1 backup |
| 6–12 (H2 2027) | 6–8 h; kit in use | 10–25 h/month | Founder. **Start recruiting customer success Sep–Oct 2027** to cover Swiss notice periods of 1–3 months |
| 12–25 (2028) | ≤ 6 h; self-serve opens for Starter | 25–50 h/month | Part-time customer success (50%) from **Jan 2028 base / Jun 2028 downside** [`04_ORG_DESIGN_AND_HR.md`] |
| 25+ (2029) | Implementation partners onboard under DLANG brand | 50+ h/month | CS role to 80–100%; partners take tier-1 how-to |

Founder-led onboarding breaks at about 25 clubs [Founder]. That is base Oct 2028, downside mid-2029.

---

## 14. Re-baselined milestones

| Milestone | Base | Downside |
|---|---|---|
| Support mailbox, ticket log, status page, error tracking | 4 Dec 2026 | 18 Dec 2026 |
| DLang onboarded as tenant #1 through the checklist (Gate 3) | 14 Feb 2027 | 31 Mar 2027 |
| DPA template and support data-handling rules (counsel) | 15 Jan 2027 | 28 Feb 2027 |
| Onboarding kit v0: checklist, import template, A1/C1/P1 videos in FR | 7 Feb 2027 | 15 Mar 2027 |
| First external club through the money-moved gate | Feb–Mar 2027 | Apr–May 2027 |
| CSV import, translation layer, offline attendance | 28 Feb 2027 | 30 Apr 2027 |
| Help centre wave 1 (FR + EN) | 31 Mar 2027 | 30 Apr 2027 |
| In-product checklist; logged support access | Q2 2027 | Q3 2027 |
| 5 founding clubs live; full training set FR + EN | Jun 2027 | Sep 2027 |
| First NPS round | Oct 2027 | Mar 2028 |
| Help centre wave 2 + DE; helpdesk tool; health dashboard | Q4 2027 | Q2 2028 |
| Part-time customer success starts | Jan 2028 | Jun 2028 |
| Self-serve track open (Starter) | Q1 2028 | Q3 2028 |
| Enterprise track and first QBR with a federation/multi-site client | H2 2028 | 2029 |
| Implementation-partner tier-1 support | 2028 (≥ 10 clubs) | 2029 |
| White-label reseller support model (partner-run tier-1) | 2029 earliest | later |

---

## 15. Professional validation required

| Topic | Question | Who |
|---|---|---|
| DPA and data roles | DLANG as processor for clubs; federation chains; sub-processor list (hosting, email, payments, helpdesk) | Data-protection counsel (revDSG / GDPR) |
| WhatsApp support | Is use of WhatsApp Business for founding-club support acceptable for data about minors? | Counsel |
| Stripe Connect and TWINT for associations | Documents, lead times, who bears KYC; whether DLANG ever holds club funds (anti-money-laundering question from the review) | Stripe / payment provider; counsel |
| SLA wording and refund guarantee | Liability caps, service credits, 60-day refund terms | Counsel |
| Support access to tenant data | Logged, consented access mechanism | Counsel + external security review (done by 31 Jan 2027) |
| Customer success employment | Part-time contract, social charges, notice periods | Fiduciary / employment lawyer |

---

## 16. Changes vs. founder's August 2026 plan

| Topic | Founder plan | Updated | Why |
|---|---|---|---|
| Onboarding timing claims | "Live in 60 minutes" / "live in 7 days" / "8–10 hours" side by side | Three named tracks: self-serve 1 day, assisted 2 weeks, enterprise 6 weeks; all end at the money-moved gate | One honest promise per track; the founder's own §8.1 already reconciled the figures |
| Self-serve onboarding | Implied from launch (60-minute journey) | Opens Q1 2028 base / Q3 2028 downside, behind 4 product gates and 10 assisted clubs | CSV import, Connect and the translation layer are missing in the repo today |
| Enterprise / federation onboarding | Federation terms published; Year-2 channel | Six-week track designed now, first used H2 2028 / 2029 | Needs ≥ 10 Swiss clubs, pen test and a staffable SLA |
| Payment setup step | "Payment methods connected" on day 1–2 | Stripe Connect KYC starts before day 0; QR-bill-only fallback if KYC slips | No per-club accounts in the code; association KYC takes 1–3 weeks [Est.] |
| Data import | Founder-run CSV import from day 3–5 | Same, assisted until 28 Feb 2027 (base); self-serve import is a gate for self-serve onboarding | Only CSV export exists in the repo |
| Productise onboarding | "Before club number six" | Same rule, built Feb–May 2027, because club six lands in the Jul–Sep peak | Swiss season calendar; no migrations Jun–Sep |
| Founding-club support | WhatsApp/Slack to founder, 4 h, 6 days a week, 24 months | Kept, with posted hours, every message logged as a ticket, holiday rota, no minors' data in chat | One founder cannot be always-on; data protection |
| Club / Starter response | 24 h / 48 h | 1 / 2 business days, plus P2 targets | Same intent, stated honestly in business time |
| Holiday and peak coverage | Not specified | P1-only 24 Dec–2 Jan with named backup; no founder leave Jun–Sep | Christmas slowdown and registration peak |
| Support tooling | Log every question (no tool named) | Staged: mailbox + log by 4 Dec 2026, helpdesk from Q4 2027, partner queues 2029 | Low cost until volume justifies a tool |
| Help centre | Recorded walkthroughs; parent templates in four languages | 3 waves, about 45 articles; FR + EN first, DE from first German-speaking club, IT 2028+ | Romandie first; translation layer not built yet |
| Customer success hire | Part-time at club 10 (about Month 12) | Jan 2028 base / Jun 2028 downside; recruiting starts Sep–Oct 2027 | Re-baselined club ramp; Swiss notice periods |
| Health scoring | Not defined (churn predictor only) | Six-component score, manual from Feb 2027, dashboard Q4 2027 | Retention needs an early warning before the Aug–Sep renewal |
| Churn measurement | 1.5%/month, linear | ≤ 1.5%/month target, measured at the Aug–Sep renewal | Swiss club churn is seasonal |
| QBRs | Quarterly reviews for Academy; founding roadmap call | Standard 7-part QBR template, avoiding Jun–Sep; federation add-ons | Repeatable once there is more than one Academy client |
| NPS / CSAT | Not set | Targets set; NPS not quoted externally until n ≥ 20 | Small samples mislead investors and the team |
| AI support assistant | Support log as training data for the parent assistant | Kept as a long-term idea; out of beta; internal drafting 2028 at the earliest with privacy review | Beta scope and data protection |
