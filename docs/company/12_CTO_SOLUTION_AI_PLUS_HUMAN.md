# 12 — The CTO Solution: a Fractional Human CTO Leading an AI Engineering Team

**Status:** recommendation for founder decision, 12 November 2026
**Owner:** CTO office (drafted by the `cto-architect` agent; the founder decides)
**Builds on:** `03_CTO_TECHNOLOGY_STRATEGY.md` (§1.6, §12), `04_ORG_DESIGN_AND_HR.md` (CTO decision, compensation, equity), `08_AI_AGENT_TEAM.md` (17 agents, governance), `00_EXECUTIVE_PLAN.md` (D9, risk 7, OKR O4), `09_FOUNDER_PLAN_REVIEW.md` §3.4, the founder's CTO Partnership Proposal (Aug 2026, `docs/company/source/text/DLANG_Sports_OS_CTO_Partnership_Proposal.txt`), `docs/LAUNCH_READINESS.md`.

**Labels:** [Founder] = founder fact or figure. [Repo] = checked in this repository on 12 Nov 2026. [Est.] = estimate in this document. [Verify] = needs a lawyer, tax adviser, fiduciary or the investor before anyone relies on it. [Confirm] = only the founder or the investor knows.

---

## 1. The situation in five lines

1. The company is **Swiss Preparatory Sports Academy GmbH (Vaud)**, bank account "SPSA Tech" [Founder].
2. A **EUR 50,000 investment is secured, but the investor releases it only once a CTO is in place** [Founder]. The exact wording of that condition is not in the repo [Confirm].
3. **No CTO is confirmed.** The August proposal (Structure A: 20% before the round, CHF 1,200/month, 4–5 days a week) has not produced a signed partner. The plan's own month-4 cut-off (December 2026) has arrived [`09` §3.4].
4. The code is **conditionally ready for a DLang pilot**: Stripe Connect, TWINT path, RLS, CI and tests exist, but nothing has run against live Stripe or a real Supabase project [`LAUNCH_READINESS.md` §1].
5. Gate 2 (a real TWINT payment reconciles automatically on DLang) is due **18 Dec 2026** (red line 31 Dec, downside 31 Jan 2027). Someone has to own production access and sign off on the payment and security work before real money moves.

The founder asks: *"Maybe we can have an AI agent be the CTO?"*

---

## 2. The honest answer: an AI agent cannot be the CTO, but it can do most of the engineering

### 2.1 Why an AI agent cannot hold the CTO role

| CTO duty | Can an AI agent do it? | Why not |
|---|---|---|
| Be a named officer or managing director in the commercial register, sign contracts, NDAs, DPAs | **No** | No legal personhood. It cannot be entered in the Vaud commercial register or sign anything. |
| Hold equity, vest, be bound by a shareholders' agreement, good/bad-leaver clauses, non-compete | **No** | It cannot own shares or be party to a contract. |
| Be accountable to an investor (meet them, answer due-diligence questions, be replaced if it fails) | **No** | Accountability needs a person who carries consequences. An investor's "CTO in place" condition is a **key-person condition**: they are buying a second responsible human beside the founder. An AI agent does not meet it, and presenting it as the CTO would put the release of funds (and the founder's credibility) at risk. |
| Carry personal responsibility under the nFADP for a system holding children's data | **No** | The revised Swiss data-protection law can hold individuals responsible; that has to be a person [Verify with counsel]. |
| Hold production credentials (live Stripe, production database, DNS) and be on call for incidents | **No (by our own rules)** | `03` §12 rule 1 and `08` §5: agents never hold production credentials or see real personal data. Incidents at 22:00 during summer-camp registration need a human who can be phoned. |
| Approve merges, migrations, RLS and payment changes | **No (by our own rules)** | The two-key rule (`03` §9, §12 rule 2) requires a human to approve. An agent may not approve its own work. |
| Make judgement calls with incomplete information (fund-holding/AML, breach notification, vendor choice) | **Partly** | An agent can prepare the analysis and options. A human must decide and own it. |

### 2.2 What the AI agent team can do (and already does)

The 17 agents in `.claude/agents/` [Repo] already cover most of the hands-on engineering and a large part of the company's analytical work:

- write features, migrations, RLS policies, server actions and UI on branches, with `tsc`, build and tests green;
- write and run tests (unit, RLS, cross-tenant denial, money logic, smoke);
- review every diff for security, privacy, i18n and tenancy rules before a human looks at it;
- draft architecture decisions, runbooks, incident timelines, investor technical answers, vendor comparisons;
- keep documentation, the changelog and the tech-debt register up to date.

Realistic effect [Est.]: with a strong human reviewer, the agents replace most of the hours a junior-to-mid contractor would bill. They do **not** replace judgement on payments, security, tenant isolation or incident response (`03` §12).

**Conclusion:** the right structure is **one accountable human CTO, working fractionally, who leads the AI engineering team.** The human supplies accountability, judgement, signatures and production access. The agents supply most of the engineering output. This is cheaper than Structure A and much easier to fill fast.

---

## 3. Recommended model: Fractional CTO + AI engineering team

### 3.1 The shape

```
                     Founder & CEO (product, commercial, investor, final say on business)
                                   |
            Fractional CTO (named human, title CTO; 4-8 h/week, rising)
       accountable for: architecture, security sign-off, production access,
             merge approval, incident response, technical due diligence
                                   |
     -----------------------------------------------------------------
     |                 |                    |                        |
 AI agent team    Fixed-price           External pen-test      Ad-hoc contractors
 (17 agents in    specialists           firm (by 31 Jan 2027)  (only for overflow,
 .claude/agents)  (e.g. QR-bill v2.4,                          approved by CTO)
                  mobile later)
```

### 3.2 Title options

| Title | When to use | Investor reading |
|---|---|---|
| **CTO (fractional)** | Default. The person holds the technical accountabilities in §3.3 and signs as such. | Clearest match for a "CTO in place" condition. |
| **Technical Co-founder & CTO (part-time)** | If the person takes meaningful vesting equity (≥2%) and plans to grow to 2–3 days a week after the seed. | Strongest signal; also the heaviest legal and cap-table work. |
| **CTO Advisor / Technical Advisor** | Only if the investor explicitly accepts it. | Weaker; many investors read "advisor" as "not in place". Ask before using it. |

### 3.3 Role description (to send to candidates)

**Fractional CTO, DLANG Sports OS (Swiss Preparatory Sports Academy GmbH, Lausanne/remote)**

*Mission:* keep a white-label, multi-tenant club-management platform that holds children's data and families' money safe and shippable, while leading an AI engineering team that does most of the implementation.

*Accountable for:*
1. **Architecture.** Owns the decisions in `03_CTO_TECHNOLOGY_STRATEGY.md`: one codebase, Postgres RLS tenancy, Stripe Connect direct charges, PWA through 2027. Writes or approves ADRs (`docs/adr/`).
2. **Security and privacy sign-off.** Approves every change to migrations, RLS, auth, payments and the AI context builder (two-key rule). Owns the pen-test scope (booked by 4 Dec, done by 31 Jan 2027) and closing critical/high findings. Works with the privacy adviser on the DPIA.
3. **Production access.** One of only two humans (with the founder) holding production credentials: Supabase production, Vercel, Stripe live dashboard (developer role), DNS. MFA on all of them. Access reviewed quarterly.
4. **Code review and merge approval.** Reviews agent pull requests (small diffs, tests included) and approves merges to `main` together with the founder (`08` §5).
5. **Incident response.** Incident commander for SEV1/SEV2 per `docs/ops/INCIDENT_RESPONSE.md` and `docs/ops/ONCALL.md`: reachable by phone in business hours, best-effort evenings, with an agreed backup during holidays. Leads the 72-hour breach assessment with the founder.
6. **Payments rail.** Signs off Gate 2 (≥10 real DLang payments reconciled automatically, failure and duplicate cases tested).
7. **Investor and customer technical representative.** Joins investor calls, answers due-diligence questions, signs the technical section of the monthly investor update.
8. **AI engineering team lead.** Assigns work to the agents, reviews their output quality weekly, updates agent definitions quarterly (`08` §5).
9. **Hiring.** Selects and manages contractors and, after the seed, the first engineer.

*Profile:* 8+ years building production web software; shipped a multi-tenant SaaS on Postgres; real experience with payments (Stripe Connect ideally) and security; comfortable leading AI coding agents and reviewing their code; French and English (German a plus); based in Romandie or reachable in CET; no conflict of interest with club-management competitors.

*Commitment:* 4–8 hours a week to start (Dec 2026 – Mar 2027), more around the Gate 2 pilot and before the summer peak; target 1–2 days a week after the convertible/bridge if both sides want it.

### 3.4 Decision rights

Adopt the founder's own table from the CTO Partnership Proposal §2.1 [Founder], with one change: the deadlock and veto rules apply to the fractional CTO in full. In short: the CTO leads architecture and security design; release gates are joint; either the founder or the CTO can stop a release touching minors' data; the founder has the casting vote on ordinary commercial matters only.

### 3.5 Who does what: human vs AI agents

| Work | AI agents (`.claude/agents/`) | Fractional CTO | Founder |
|---|---|---|---|
| Feature specs and acceptance tests | `product-manager` drafts | Checks feasibility and sequence | Decides scope |
| Architecture and ADRs | `cto-architect` drafts options and ADRs | **Decides and signs** | Consulted on cost and customer impact |
| Code, migrations, RLS, UI | `backend-db-engineer`, `frontend-engineer`, `payments-engineer` write on branches | Reviews; **approves** migrations, RLS, payments, auth | Accepts features on DLang |
| Tests | `qa-test-engineer` writes and runs | Checks coverage of risky paths | — |
| Security and privacy review | `security-reviewer`, `privacy-compliance-officer` review every diff | **Signs off**; may not waive a finding without writing why | Approves accepted risks jointly |
| Deploys and production changes | `devops-sre` prepares runbooks and checks | **Executes** or supervises; holds credentials | Approves production deploys and DB changes |
| Incidents | Agents help analyse logs (no real personal data), draft timelines and notices | **Incident commander** | Customer, investor and authority communication |
| Pen test, vendor DPAs | Agents prepare scope and checklists | Owns the technical scope and remediation | Signs contracts and DPAs |
| Investor technical due diligence | Agents draft answers and evidence packs | **Presents and answers** | Leads the relationship |
| Club onboarding | `tenant-onboarding-specialist` runs the checklist | Approves anything unusual (custom domain, data import edge cases) | Owns the club relationship |

### 3.6 Weekly cadence (about 6 hours a week in the base case) [Est.]

| When | What | Time |
|---|---|---|
| Monday 08:00 | Weekly metrics review with the founder (`00` §8): gates, incidents, engineering board, 3 priorities for the week | 45 min |
| Monday, after the review | Assign the week's work to agents (written task briefs with acceptance tests) | 30 min |
| Tuesday or Wednesday | **Review block**: agent pull requests, migrations, RLS, payment diffs; approve or send back | 2–3 h |
| Thursday | Architecture/decision slot (ADRs, vendor questions, the AI-assistant DPIA path); 30 min sync with the founder | 1 h |
| Friday | Check production health (Sentry, webhook failures, `/api/health`, backups); weekly on-call handover (`docs/ops/ONCALL.md` §3) | 30 min |
| Monthly (first Thursday) | Technical section of the investor update; access review | 1 h |
| Quarterly | Review agent definitions and agent output quality; DORA metrics; pen-test follow-up | 2 h |
| On demand | SEV1/SEV2 incidents | as needed |

Peak weeks (Gate 2 pilot 7–18 Dec; spring invoicing 11–17 Jan; summer registration from March) need 8–12 hours [Est.]. Agree this up front.

### 3.7 First 30 days (mid-Dec 2026 to mid-Jan 2027)

1. Get production access; enforce MFA; read `03`, `LAUNCH_READINESS.md`, `docs/ops/*`.
2. Sign off the Stripe Connect + TWINT setup (`docs/ops/STRIPE_CONNECT_TWINT_SETUP.md`) and the Gate 2 pilot; be on call during it.
3. Approve the pen-test scope (booked by 4 Dec, done by 31 Jan 2027).
4. Review the deferred items in `LAUNCH_READINESS.md` §7 and decide which close before club #2.
5. Decide the **AI assistant early-access path** (see §3.8).
6. Respect the freeze 19 Dec – 4 Jan (maintenance only).

### 3.8 The founder's wish: the AI assistant usable by clubs early

The fractional CTO is the right person to unblock this safely. Today [Repo]:
- The assistant exists (`src/lib/ai/*`, `src/app/(admin)/admin/assistant`), staff-only, reading through the caller's RLS session.
- It switches on for **every tenant at once** as soon as the two AI environment variables are set: `src/lib/compliance/tenant.ts` treats an unset `ai_assistant_enabled` as enabled, and the assistant page does not check the plan feature `ai_assistant` (`src/lib/platform/features.ts`). That conflicts with "off by default per tenant, opt-in" in `03` §1.4 and §7.

Proposed path (a founder decision; needs `privacy-compliance-officer` and `backend-db-engineer`):
1. **Before any AI key goes into production:** make the assistant opt-in per org (default off), check the plan feature, add a per-tenant monthly cost cap and an audit row per query (agents can build this in about a week; CTO approves).
2. **DPIA covering AI processing** (allow-listed fields only, no medical data, consents, dates of birth or coach notes; no training on tenant data; data location in the provider's DPA) [Verify — data-protection adviser].
3. **DLang internal use** from late January 2027, after spring invoicing, rather than Q2 2027 as in `03` §7 [Est.].
4. **Founding clubs opt in** from Gate 3b (30 Apr / 30 Jun 2027) rather than Q4 2027, with an evaluation set (including attempts to read other families' data) passing in CI.
5. It stays out of the sales pitch until steps 1–4 are done. "DLang first" applies.

---

## 4. Compensation options

Context: EUR 50,000 is roughly CHF 47,000 [Est., FX at the date of transfer]. The model's Year-1 engineering line is CHF 4,500/month [Founder]; Swiss senior contractors charge CHF 110–150/hour (`04`), and fractional CTOs with accountability typically CHF 150–220/hour [Est.]. **Cash is the binding constraint:** a fractional CTO must cost well under half the round, so equity has to carry part of the deal.

| Option | Time | Cash | Equity | Year-1 cash cost [Est.] | Fit |
|---|---|---|---|---|---|
| **F1 — Retainer + small equity (recommended)** | 4–8 h/week (~20–30 h/month) | **CHF 2,000–3,000/month** retainer, peaks billed at an agreed hourly rate with a monthly cap | **1–3%**, 4-year vesting, 12-month cliff (6-month cliff acceptable for an advisor form), good/bad-leaver | CHF 24,000–36,000 | Fits the round if the founder keeps the rest capital-light; strongest candidate pool |
| F2 — Higher cash, minimal equity | 4–8 h/week | CHF 3,500–5,000/month | 0–0.5% | CHF 42,000–60,000 | Most of or more than the whole round; only if the bridge is certain |
| F3 — Equity-heavy fractional | 6–10 h/week | CHF 1,000–1,500/month | 3–5% | CHF 12,000–18,000 | Cheapest in cash; harder to find; closer to a co-founder conversation |
| Original Structure A [Founder] | 4–5 days/week | CHF 1,200/month (Y1), 25% of onboarding fees | 20% before the round (16.2% after round and pool) | CHF 16,425 [Founder] | Hard to fill (about CHF 7/hour, `09` §3.4); keep it open as the upgrade path |
| Original Structure B [Founder] | 2–3 days/week | CHF 2,500/month (Y1), 30% of onboarding fees | 10% (8.1% after round and pool) | CHF 32,430 [Founder] | A natural step up for the fractional CTO after the seed or bridge |

Notes [all Verify with a Swiss lawyer and tax adviser]:
- **Vehicle.** GmbH quotas are publicly registered and awkward to grant in small slices (`04`). Options: (a) a **virtual participation plan / phantom shares** (cash on exit, no register entry) while the company is a GmbH; (b) a real quota transfer at nominal value with a shareholders' agreement; (c) options after the conversion to an AG. Ask for an advance tax ruling from the Vaud cantonal tax administration.
- **Upgrade path.** Write in that if the CTO moves to 2–3 days a week, the parties negotiate a step towards Structure B. This keeps the strongest candidates interested.
- **Disclosure.** The investor must see the grant and the cap table before releasing funds (`00` risk 9).
- **Contractor status.** A fractional CTO usually invoices through their own company; check false-self-employment risk with the fiduciary (`04`).
- **IP.** Present assignment of all IP to the GmbH from day one, including any trial work (`04`).
- **Insurance.** Confirm D&O / professional liability covers an officer who is not an employee [Verify].

---

## 5. Where to find candidates in Romandie

| Channel | How to use it | Notes |
|---|---|---|
| **EPFL Alumni** network and job board; EPFL Innovation Park community | Post the role brief; ask the founder's EPFL contacts for introductions | Strong for senior engineers who have left large companies and do fractional work |
| **HEIG-VD** and **HES-SO** alumni networks (Yverdon, Vaud) | Alumni groups, professors in software engineering and security | Good for pragmatic, local, French-speaking profiles |
| **UNIL / HEC Lausanne** entrepreneurship networks | Introductions to former startup CTOs | — |
| **Swiss startup networks:** Innovaud, GENILEM, Fongit (Geneva), Venturelab, Swiss Startup Association, Impact Hub Lausanne | Ask programme managers for introductions to ex-CTOs between companies | Also credible to investors |
| **Fractional / freelance platforms:** LinkedIn (search "fractional CTO" Vaud/Genève), Malt, Toptal, CTO-as-a-service firms in CH | Shortlist people with Swiss references | Check availability in Switzerland and fees [Verify] |
| **Tech meetups:** Swiss JS / Lausanne web meetups, GDG Lausanne, Postgres and security meetups | Attend one evening; ask organisers | Good for spotting builders |
| **Stripe partner directory**, Supabase partner/expert listings | Senior people with Connect and Postgres RLS experience | Payments is the riskiest area; prioritise it |
| **The investor's own network** | Ask the investor for 2–3 names they would accept | Fastest route to "meets the condition" |

---

## 6. Two-week selection plan (target: signed by Tue 15 Dec 2026)

| Dates | Step | Owner | Output |
|---|---|---|---|
| **Thu 12 – Fri 13 Nov** | Send the investor email (§8). Finalise the role brief (§3.3) and the term sheet range (§4). Ask the investor for names. | Founder (`hr-people-partner` drafts) | Email sent; brief ready |
| **Mon 16 – Fri 20 Nov** | Outreach to all channels in §5; 10–15 contacts. 30-minute screening calls with 6–8 people. Criteria: payments + Postgres/RLS experience, French, availability in Dec–Jan, reachable for incidents, no competitor conflict. | Founder | Shortlist of 3 |
| **Mon 23 – Fri 27 Nov** | **Paid technical deep-dive** (3–4 hours, fixed fee CHF 500–800 each [Est.]): candidate reviews the repo, `03`, the Stripe Connect code and one RLS migration, then a 60-minute session with the founder. References (2 each). | Founder + candidate | Written assessment; reference notes |
| **Mon 30 Nov – Fri 4 Dec** | Preferred candidate meets the investor (30 min call). Agree terms within §4. Lawyer instructed. | Founder | Investor's informal OK; agreed term sheet |
| **Mon 7 – Tue 15 Dec** | Lawyer drafts the fractional CTO agreement (role, decision rights, confidentiality, IP assignment, equity/virtual plan, termination). Signature. Investor written confirmation that the condition is met. | Founder + lawyer | **Signed agreement by 15 Dec**; investor confirmation; funds release requested |
| From signature | First 30 days (§3.7). The CTO is on call for the Gate 2 pilot. | CTO | — |

**Change to the plan.** This moves decision D9 ("CTO decision by 8 Jan 2027", `00` §7) to **15 Dec 2026** and replaces the "founder + AI agents + paid senior reviewer" fallback with a named fractional CTO. If the founder accepts, update D9, OKR O4 KR1 and `04` §4 [founder decision].

**If nobody suitable is found by 4 Dec:** go to the alternative in §7 and ask the investor whether it meets the condition.

---

## 7. Alternative: part-time Head of Engineering + external CTO advisor

If no single person combines CTO-level judgement with time in December:

| Role | Who | Time | Cash [Est.] | Equity [Est.] |
|---|---|---|---|---|
| **Head of Engineering (part-time)** | A senior engineer (Romandie or EU-remote, CET) who reviews agent output, holds production access and is on call | 1–2 days/week | CHF 3,000–5,000/month at CHF 110–150/h, capped | 0.5–1.5%, 4-year vesting, 12-month cliff |
| **External CTO advisor** | An experienced CTO (ideally from the investor's or EPFL's network) who signs off architecture and security, joins investor calls quarterly | 2–4 h/month | CHF 500–1,000/month or advisor equity 0.25–0.5% | 0.25–0.5%, 2-year vesting |

Pros: more hands-on hours; the advisor's name can be credible to investors. Cons: costs more cash in total; accountability is split, so the investor may not see it as "a CTO in place"; two contracts to manage. **Use it only if the investor confirms in writing that it meets the release condition.**

---

## 8. Draft email to the investor

> These drafts are for the founder to adapt and send. No terms are offered until the founder decides. [Verify the wording of the release condition against the signed investment documents before sending.]

### 8.1 English

**Subject:** DLANG Sports OS — proposed CTO structure and the funding release condition

Dear [Name],

Thank you again for your commitment to DLANG Sports OS. I want to address the condition that the EUR 50,000 is released once a CTO is in place, and propose how we meet it quickly and properly.

**What we propose.** We will appoint a named, experienced human as **CTO on a fractional basis** (4–8 hours a week to start, rising around our payment pilot and the summer season). This person will be formally accountable for architecture, security and data-protection sign-off, production access, code review and merge approval, and incident response, and will represent the technology to you and to our clubs. They will lead our AI engineering team, a set of specialised AI agents that write code, tests and documentation under strict rules: the agents never hold production credentials, never see real personal data, and cannot approve their own work. Every change to the database, security or payments needs human approval.

**Why this structure.** It gives the company an accountable technical leader now rather than in spring, at a cash cost the round can carry. The full-time co-founder structure from my August proposal remains the upgrade path once we raise the next round.

**Terms (indicative).** A monthly retainer in the range of CHF 2,000–3,000 and a small vesting equity stake (1–3%, four years with a one-year cliff), subject to legal and tax advice. You will see the final cap table before release.

**Timeline.** Shortlist by 27 November, an introductory call between you and the preferred candidate in the week of 30 November, signature by 15 December 2026. This lets the CTO supervise our first real TWINT payments on DLang's winter camp (target 18 December).

**My question to you.** Could you confirm that a signed agreement with a named fractional CTO, with the accountabilities above, satisfies the release condition? If you would prefer a different form (for example, a minimum time commitment or a particular title), please tell me now so we can build it into the selection. I would also welcome any names from your network.

Kind regards,
[Founder name]
Founder & CEO, Swiss Preparatory Sports Academy GmbH (DLANG Sports OS)

### 8.2 Français

**Objet :** DLANG Sports OS — structure CTO proposée et condition de libération des fonds

Madame, Monsieur [Nom],

Merci encore pour votre engagement envers DLANG Sports OS. Je souhaite revenir sur la condition selon laquelle les 50 000 EUR sont libérés une fois un CTO en place, et vous proposer une manière de la remplir rapidement et correctement.

**Notre proposition.** Nous nommerons une personne expérimentée, identifiée nommément, comme **CTO à temps partiel (fractional CTO)**, à raison de 4 à 8 heures par semaine au départ, davantage pendant notre pilote de paiement et la saison d'été. Cette personne sera formellement responsable de l'architecture, de la validation sécurité et protection des données, des accès à la production, de la revue et de l'approbation du code, et de la gestion des incidents. Elle représentera la technologie auprès de vous et de nos clubs. Elle dirigera notre équipe d'ingénierie IA, un ensemble d'agents IA spécialisés qui écrivent le code, les tests et la documentation selon des règles strictes : les agents n'ont jamais accès à la production, ne voient jamais de données personnelles réelles et ne peuvent pas approuver leur propre travail. Toute modification de la base de données, de la sécurité ou des paiements requiert une approbation humaine.

**Pourquoi cette structure.** Elle donne à l'entreprise un responsable technique engagé dès maintenant plutôt qu'au printemps, pour un coût que le tour de financement peut supporter. La structure de co-fondateur à plein temps de ma proposition d'août reste l'étape suivante après le prochain tour.

**Conditions (indicatives).** Une rémunération mensuelle de CHF 2 000 à 3 000 et une petite participation avec vesting (1 à 3 %, sur quatre ans avec une période de cliff d'un an), sous réserve d'avis juridique et fiscal. Vous verrez la table de capitalisation définitive avant la libération des fonds.

**Calendrier.** Liste restreinte d'ici au 27 novembre, entretien entre vous et le ou la candidat(e) retenu(e) la semaine du 30 novembre, signature d'ici au 15 décembre 2026. Le CTO pourra ainsi superviser nos premiers paiements TWINT réels lors du camp d'hiver de DLang (objectif : 18 décembre).

**Ma question.** Pouvez-vous me confirmer qu'un contrat signé avec un CTO à temps partiel, nommément désigné et doté des responsabilités ci-dessus, remplit la condition de libération ? Si vous souhaitez une autre forme (par exemple un engagement horaire minimum ou un titre particulier), merci de me l'indiquer dès maintenant afin que nous en tenions compte dans la sélection. Je serais également heureux de recevoir des noms issus de votre réseau.

Avec mes meilleures salutations,
[Nom du fondateur]
Fondateur & CEO, Swiss Preparatory Sports Academy GmbH (DLANG Sports OS)

---

## 9. Risks of this model and mitigations

| Risk | Mitigation |
|---|---|
| Investor does not accept a fractional CTO | Ask first (§8); offer a minimum hours commitment or the §7 alternative; get the confirmation in writing |
| Fractional CTO is too thin during peaks (Gate 2, summer registration) | Agree peak hours and a cap in the contract; agents absorb routine work; a named backup reviewer for holidays |
| Review bottleneck: agents produce more than one person can review | Small diffs (30-minute review rule, `03` §12); agents pre-review (`security-reviewer`, `qa-test-engineer`); founder accepts features on DLang |
| Key-person risk moves from founder to one part-time CTO | Credentials in a shared vault with break-glass access for the founder; runbooks in `docs/ops/`; quarterly access review |
| Equity granted to someone who leaves early | 12-month cliff; good/bad-leaver; IP assigned from day one |
| Cap table confusion (`00` risk 9) | One reconciled cap table, including this grant, shown to the investor before release |

---

## 10. Decisions for the founder

1. Accept the Fractional CTO + AI engineering team model (or choose the §7 alternative).
2. Approve the compensation range (§4, F1 recommended) as the negotiation envelope.
3. Send the investor email (§8) by **13 Nov 2026**.
4. Approve moving D9 to **15 Dec 2026**.
5. Approve the AI-assistant prerequisites in §3.8 (opt-in per org before any AI key goes into production).
