# DLANG Sports OS: CTO Technology Strategy

**Status:** working document, re-baselined 11 November 2026; **updated 12 November 2026** with the founder's decisions (`11_FOUNDER_DECISIONS_2026-11-12.md`), including **round 2**: the AI assistant is a **paid add-on** for clubs (DLang complimentary), the EU/US pilots are discounted paid pilots, and a parent AI add-on is a proposal only (`13_PARENT_AI_ADDON_SPEC.md`)
**Owner:** CTO office. The plan of record is a **named human fractional CTO leading the AI agent team** (`12_CTO_SOLUTION_AI_PLUS_HUMAN.md`), target signed **15 Dec 2026** (latest 31 Jan 2027). Until then this is the founder, with a paid senior reviewer (pre-contracted 16 Dec 2026; see §12).
**Builds on:** the founder's August 2026 Business Plan (§6.1 beta scope, §6.2 architecture, §6.3 compliance), the CTO Partnership Proposal, the Financial Model, the strategy review `09_FOUNDER_PLAN_REVIEW.md`, and the repository as it stands on `claude/ultracode-kfui6x`.
**Companion documents:** `01_BUSINESS_MODEL.md`, `02_GO_TO_MARKET.md`, `11_FOUNDER_DECISIONS_2026-11-12.md`, `12_CTO_SOLUTION_AI_PLUS_HUMAN.md`.

**How to read the labels**
- **[Founder]**: a decision or figure from the founder's August 2026 materials, kept unchanged.
- **[Repo]**: verified in this repository on 11 Nov 2026.
- **[Est.]**: an estimate or assumption made in this document.
- **[Verify]**: needs checking against a live vendor source, or validation by a lawyer, data-protection adviser, tax adviser or auditor, before anyone relies on it.

---

## 1. The decisions in brief

1. **No rewrite. One codebase, one shared database, one region.** Next.js 15 + Supabase Postgres with `org_id` on every tenant table and forced RLS stays the platform [Founder §6.2]. Region sharding (EU/US) and dedicated Enterprise instances are *designed for now* and *built only when a gate is met*. The US region is not before 2029.
2. **Engineering capacity goes to the payment rail first.** Until TWINT reconciles automatically on DLang's own camps (base 18 Dec 2026, downside 31 Jan 2027), nothing else ships unless it is a security fix. The payment architecture is Stripe with **per-club Connect accounts** (direct charges plus an application fee), so DLANG never holds club money. Payrexx stays the documented fallback. A written legal view on fund-holding is required [Verify].
3. **PWA through 2027, native later.** The four missing beta items (CSV import, translations, offline attendance, per-club payment accounts) are finished by 28 Feb 2027. White-label native apps (Expo / React Native, per-tenant builds) are a 2028 decision, triggered by measured push-notification or retention problems or by a paying multi-site customer that requires a branded store app.
4. **AI is opt-in per club, a paid add-on, and outside the sales pitch** (founder decisions 12 Nov 2026, round 2). The assistant is implemented [Repo]: a club admin switches it on in **Settings → App & assistant**; it is **off by default** and only works when the platform is configured, the club **holds the AI add-on** (an active entitlement, either `complimentary`, as for DLang, or a `paid_addon` on a live subscription; no plan price includes it) and the user is admin or finance staff (`src/lib/ai/access.ts`; entitlement table `public.ai_assistant_addons`, being implemented in parallel, 12 Nov 2026 [Repo]). **DLang beta first, Q1 2027** (switched on Feb 2027 / downside Mar 2027), then sold to clubs once written acceptance criteria are met (base Jun 2027 / downside Sep 2027). No club switches it on before the DPIA addendum and the DPA sub-processor entry are signed off (15 Jan 2027). Pricing (round 2): **not included in any tier; a paid add-on for clubs, proposed CHF 69 per club per month [Est.][Confirm by 15 Dec 2026]**; DLang (customer zero) complimentary. Billing needs a Stripe subscription item for the add-on, an entitlement that ends when the subscription lapses, and a cancellation path. The parent-facing `family` scope stays reserved and grants nothing (`13_PARENT_AI_ADDON_SPEC.md`). The first automation every club gets is still the *non-generative* reminder engine.
5. **Security is earned in steps, not bought as a badge.** External penetration test by 31 Jan 2027, then a lightweight ISO 27001-aligned control set during 2027, then a SOC 2 Type II or ISO 27001 certification only when a contract (US school district, federation, EU enterprise) requires it and pays for it. Earliest realistic certificate: 2029.
6. **A named human fractional CTO plus the AI agent team, with humans owning every merge to production** (founder decision 12 Nov 2026; `12_CTO_SOLUTION_AI_PLUS_HUMAN.md`). Agents write and review code; a human approves every migration, every RLS change and every payment change, with a second approver on payments, RLS, auth, migrations and AI. An AI agent cannot be the CTO: the investor releases the EUR 50k only once a CTO is in place, and that has to be an accountable person. Target signed **15 Dec 2026** (latest 31 Jan 2027); the CTO proposes structure, decision rights and any equity by 8 Jan 2027.

---

## 2. Where the code actually is (11 Nov 2026)

| Area | State [Repo] | Assessment |
|---|---|---|
| App framework | Next.js 15 App Router, React 19, TypeScript, Tailwind 3. Route groups `(admin)`, `(coach)`, `(parent)`, public `register/[programSlug]`, `onboarding`, `api/stripe/webhook`. ~200 TS/TSX files. `tsc --noEmit` and `next build` pass. | Sound. Keep. |
| Data | 16 migrations, ~30 tables. `org_id` on every tenant table. RLS enabled on all tables, `FORCE` on the 10 most sensitive. `SECURITY DEFINER` helpers (`current_org_id()`, `is_admin()`, `is_finance()`, guardian and coach scope checks). Append-only audit log. Immutable consents. Anonymising erasure. | The strongest asset in the company. Tenant isolation lives in the database, as the founder's plan demands. |
| Identity | Supabase magic link. `profiles.org_id` is **one org per user**. Roles in `staff_roles` (admin, finance, coach); `parent` derived from `family_members`. | Works for DLang. Blocks a parent with children in two clubs, or a coach working for two clubs. Must change before club #2 (see tech-debt register). |
| Payments | One Stripe account, card checkout, webhook. Swiss QR-bill with structured addresses (pdf-lib + qrcode). TWINT exists only as a **label for manually recorded payments**. No Stripe Connect. | Gate 2 is not met. This is the top engineering priority. |
| Email | Resend for transactional mail. | Bounce/complaint handling and per-tenant sender domains still to do. |
| AI | `src/lib/ai/*` calls an external LLM API, server-only, temperature 0, falls back to "contact a human" if unconfigured. `ai_queries` table with RLS. **12 Nov 2026:** per-club opt-in implemented (`src/lib/ai/access.ts`, admin switch in Settings → App & assistant, off by default; access needs platform configuration + plan entitlement + club opt-in + admin/finance role). | Opt-in per club; DLang beta Q1 2027 after the DPIA addendum. |
| Theming / white-label | Design tokens in `globals.css`. Runtime per-tenant theming, plans, subscriptions, self-signup and an operator console exist on the **unmerged** `wf/tenancy` and `wf/platform` branches. **12 Nov 2026:** per-club app name implemented (e.g. "DLang OS", stored in the club's branding, set in Settings → App & assistant, falls back to the organisation name; `src/lib/tenant/app-name.ts`); the platform name comes from `NEXT_PUBLIC_PLATFORM_NAME` (master brand undecided until 15 Feb 2027). | Useful foundations for DLANG's own billing of clubs. Merge selectively, after the payment work. |
| Missing beta items | CSV import (export only), translation layer, offline attendance (no service worker), per-club payment accounts. | Due 28 Feb 2027. |
| Testing and CI | `testing/rls_test_suite.sql` validated against Postgres. No CI workflow in the repo, no unit, integration or end-to-end test suite. | Biggest process gap. Fixed in Q4 2026 / Q1 2027. |
| Agent configuration | 17 agent definitions committed in `.claude/agents/` (status 12 Nov 2026; see `08_AI_AGENT_TEAM.md`). | Done. The fractional CTO leads this team and owns the human approvals. |

---

## 3. Target architecture

### 3.1 Shape of the platform

```
                    tenant custom domain / dlang subdomain
                                   |
        Edge (host's CDN + WAF)  ->  Next.js app (one deployment per region)
                                   |   - middleware: session refresh, tenant resolution from host
                                   |   - server components and server actions (RLS-scoped client)
                                   |   - service-role client only in webhooks and jobs
                                   |
     +-----------------------------+------------------------------+
     |                             |                              |
 Postgres (Supabase)        Payment adapters               Job runner
 - org_id + forced RLS      - Stripe Connect (card, TWINT)  - reminders, dunning
 - audit, consent, erasure  - QR-bill generator + camt.054   - reconciliation
 - private storage bucket     import for bank reconciliation - exports, imports
     |                      - Payrexx adapter (fallback)    - outbound webhooks
 Observability: error tracking, uptime, structured audit log, cost per tenant
```

Principles:
- **The database is the security boundary.** Application checks (`requireRole`) are convenience; RLS is the control [Founder §6.2, SECURITY.md].
- **Tenant is resolved once, from the host name or the session, and never from a request parameter.**
- **Payment providers sit behind an adapter interface** (`createCharge`, `refund`, `reconcile`, `onboardAccount`) so that Payrexx, Datatrans or a US processor can be added without touching the invoice model.
- **Every integration is per-tenant configured and per-tenant feature-flagged.**

### 3.2 Tenancy model and scaling path

| Stage | Model | Trigger to move | Earliest date (base / downside) [Est.] |
|---|---|---|---|
| **T1 — now** | Shared schema, shared database, `org_id` + forced RLS. One Supabase project in an EU region (Switzerland if the provider offers it on a suitable plan [Verify]). | — | Now |
| **T1.5 — hardening** | Same model plus: many-to-many memberships (user ↔ org), tenant resolution by domain, per-tenant config table (branding, terminology, locale, currency, payment provider, feature flags), cross-tenant isolation tests in CI, per-tenant rate limits and cost metering. | Before club #2 goes live | Q1 2027 / Q2 2027 |
| **T2 — regional cells** | One full stack per region ("cell"): EU cell (CH/EU customers) and later a US cell. A tiny global directory maps org → cell. No cross-region data. | A paying customer that contractually requires non-EU residency, *and* the US entry gate in §1 of `02_GO_TO_MARKET.md` is met | Not before H2 2029 |
| **T3 — dedicated instances** | Same code, separate database (and optionally separate deployment) for one tenant, managed by the same release train. Priced as Enterprise. | A federation or school network that requires it in a signed contract and pays a setup fee that covers it | Pilot H2 2028 at the earliest; only if a contract demands it |

**Scaling headroom [Est.]:** 118 clubs in Year 3 [Founder base case] × ~150 athletes ≈ 18k athletes and perhaps 40k user accounts. That is small for one well-indexed Postgres instance. The real scaling risks are not volume: they are (a) an expensive RLS helper evaluated per row on large tables, (b) reminder and invoice jobs bursting at season start (Aug–Sep), and (c) noisy tenants. Mitigations: composite indexes leading with `org_id`, `STABLE` helpers wrapped in sub-selects so Postgres caches them, a job queue with per-tenant concurrency limits, and a load test before each August peak.

**What we will not do:** schema-per-tenant or database-per-tenant as the default. It multiplies migration risk for a team this size and gives no security benefit over forced RLS that is tested in CI.

### 3.3 White-label configuration (what "customisable" means technically)

| Dimension | Mechanism | When |
|---|---|---|
| Branding (logo, palette, fonts within a safe set) | `org_settings.theme` → CSS variables at runtime; contrast check on save | Q1 2027 (merge from `wf/tenancy`) |
| Terminology (athlete/player/student, programme/team/class, coach/teacher) | Per-tenant term dictionary layered over the translation catalogue | Q2 2027 |
| Locale | FR, DE, EN at beta [Founder: multilingual interface in scope]; IT when a Ticino customer pays | FR/EN by 28 Feb 2027, DE by Jun 2027 |
| Currency | `organizations.currency` exists; CHF now, EUR with the EUR track | EUR Q2 2028 |
| Sport | Sport-agnostic data model (no basketball fields in core tables); sport-specific fields as typed custom fields | Audit Q2 2027 |
| Custom domain + sender domain | Host-based tenant resolution, managed TLS, per-tenant Resend domain with SPF/DKIM | Q3 2027 |
| Branded native app | Per-tenant Expo build (see §4) | 2028 decision |

---

## 4. Mobile strategy

| Phase | What | Gate | Timing [Est.] |
|---|---|---|---|
| **M1 — PWA** | Installable PWA. Coach screens built for 375 px [Founder]. Service worker with an offline attendance queue: local store, retry, conflict rule (last coach write wins per athlete/session, with an audit row), visible "saved on this phone" state. Web push where the platform supports it. | Beta requirement | Offline attendance by 28 Feb 2027 |
| **M2 — measure** | Track push delivery, coach weekly active use, parent open rates on iOS vs Android. | Six months of data from ≥5 clubs | H2 2027 |
| **M3 — one DLANG-branded native shell** | Expo / React Native app for coaches and parents, sharing TypeScript types and API client with the web; Supabase auth; native push; offline store. | M2 shows iOS push or retention is a measured problem, **or** ≥2 paying customers ask for a store app | Decision Q1 2028; ship H2 2028 |
| **M4 — per-tenant white-label builds** | Same Expo codebase, per-tenant config (name, icon, colours, bundle ID) built by a CI pipeline (EAS or equivalent); published under the customer's own developer account. | A Multi-site or federation customer pays a setup fee that covers store accounts, review cycles and maintenance | 2029 at the earliest |

Why not native now: the founder's plan scopes native out of the beta, and per-tenant store builds add an app-review cycle, two store accounts per tenant and a support burden the company cannot staff in 2027.

---

## 5. Payments architecture (the Gate 2 work)

| Decision | Choice | Why | Lead time / risk |
|---|---|---|---|
| Money flow | Stripe Connect, one connected account per club, **direct charges** with an application fee | Club is the merchant of record; DLANG does not hold funds | Connect platform review and per-club KYC can take days to weeks [Verify]. Legal view on Swiss anti-money-laundering exposure required by 27 Nov 2026 [Verify — counsel]. |
| TWINT | Stripe's TWINT method on the connected account | One stack, one webhook, EUR-ready later | Stripe TWINT pricing (1.9% + CHF 0.30 per the founder plan) leaves ~zero platform margin. The model now uses 0.2%, not 0.9% (see `01_BUSINESS_MODEL.md`). |
| Fallback | Payrexx adapter behind the same interface | Cheaper TWINT (~1.3% [Founder]), Swiss-native | Build only if Stripe TWINT or Connect onboarding fails the 31 Jan 2027 red line |
| QR-bill | Keep native generator; upgrade to Implementation Guidelines v2.4 (in force 14 Nov 2026); add camt.054 bank-file import to auto-match QR references | QR-bill is free and the default rail | v2.4 conformance check this month [Verify against SIX documentation] |
| Recurring | Not in beta. Instalment plans via scheduled invoices first; stored-credential recurring charging only after confirming TWINT "user on file" support [Founder] | Avoid building on an unconfirmed capability | 2027 H2 |
| DLANG's own billing of clubs | Separate Stripe Billing account (platform side), from `wf/platform` | Never mix club money and DLANG revenue | Q2 2027 |
| US / EU later | SEPA Direct Debit (EUR track); ACH and a US processor only with the US gate | — | 2028 / 2029+ |

---

## 6. Integrations roadmap

Ordered by what a paying Swiss academy asks for first. Every integration is per-tenant, off by default, and built on an outbound-webhook + CSV fallback so a club is never blocked by a missing connector.

| Integration | Market | Purpose | Build / buy | Timing (base) [Est.] |
|---|---|---|---|---|
| **CSV import/export** (families, athletes, invoices) | All | Onboarding in under a day; anti-lock-in | Build | 28 Feb 2027 |
| **camt.054 bank file import** | CH | Auto-match QR-bill payments | Build | Q1 2027 |
| **Calendar feeds (iCal/ICS, per user and per team)** | All | Coaches and parents see sessions in their own calendar | Build (read-only feeds) | Q2 2027 |
| **Bexio** | CH | Push invoices and payments to the club's accounting | Build against Bexio API | Q3 2027, when ≥3 clubs use Bexio |
| **Accounting export (generic CSV with chart-of-accounts mapping)** | CH/EU | Covers fiduciaries and tools without an API | Build | Q2 2027 |
| **J+S (Jugend+Sport) attendance export** | CH | Clubs claim J+S subsidies from attendance; a strong Swiss wedge | Build export in the format the federal portal accepts [Verify format and whether an API exists] | Q3 2027, before the autumn reporting cycle |
| **Google Workspace / Microsoft Entra SSO (OIDC/SAML)** | CH/EU schools | Staff sign-in at international schools | Use the auth provider's SSO; buy rather than build | Q4 2027, when the first school is in the pipeline |
| **Federation licensing systems** (player licences, eligibility) | CH first (e.g. Swiss Basketball) | Avoid double entry of licences | Partner integration; depends on federation willingness [Verify per federation] | 2028, tied to the federation pilot |
| **DATEV export** | DE | Required by German clubs' tax advisers | Build export | With EUR track, 2028 |
| **QuickBooks / Xero** | US / UK / intl | Accounting sync | Buy a unified accounting API if more than two are needed | With US gate, 2029+ |
| **Clever / ClassLink rostering + SSO** | US K-12 | Required by US school districts | Build to their specs; also needs US privacy commitments (student-data agreements) [Verify] | Only after the US gate, 2029+ |
| **Public API + outbound webhooks** | All | Partners build their own connectors | Build, versioned, per-tenant API keys | 2028 |

---

## 7. AI roadmap and guardrails

The founder's plan is right: an AI chat assistant is not a moat (Paak and others are building one) and AI is out of the beta [Founder §6.1]. AI work is therefore sequenced by *measurable admin time saved*, and gated by privacy.

| Stage | Capability | Uses an LLM? | Gate | Timing [Est.] |
|---|---|---|---|---|
| A0 | **Automated reminders and dunning** (7/14-day invoice reminders, missing-consent nudges, session reminders) | No. Rules engine. | Beta | Running on DLang's spring invoicing, Jan 2027 |
| A1 | **Admin assistant** (existing code, per-club opt-in implemented): answers staff questions over the club's own data, grounded, refuses otherwise, escalates to a human | Yes | DPIA addendum covering AI signed off and the AI provider listed as a sub-processor in the DPA (15 Jan 2027); provider terms checked for no-training and data location [Verify]; club admin opts in; written acceptance criteria ("fully functional") | **DLang beta Q1 2027** (on Feb 2027 / downside Mar 2027); founding clubs base Q2 2027; other clubs once criteria hold |
| A2 | **Drafting help**: parent messages, camp descriptions, translations FR/DE/EN | Yes | As A1; human sends every message | 2028 |
| A3 | **Scheduling optimisation**: hall/pitch allocation, coach availability, camp group building | Constraint solver first; LLM only for explanation | Proven demand from ≥3 multi-team clubs | 2028 H2 |
| A4 | **Separately priced AI add-on** for clubs (round 2: CHF 69/month proposed [Confirm]; founder's August price CHF 90) | — | Founder price decision (15 Dec 2026); add-on billing and entitlement live; A1 acceptance criteria met | **Back in the plan (round 2, 12 Nov 2026):** on sale from Jun 2027 (downside Sep 2027); DLang complimentary; workbook v2.2 models 20% attach |
| A5 | **Parent AI add-on** (proposal) | Yes | Club add-on proven; separate DPIA; guardian consent; COPPA view for US | Not before Nov 2027; base Q1 2028 DLang-parents pilot [Confirm]. `13_PARENT_AI_ADDON_SPEC.md` |

**Guardrails (non-negotiable, because the data subjects are children):**
1. **Never send** medical data, consent documents, dates of birth, or free-text coach notes about a minor to a model. The context builder uses an allow-list of fields, not a deny-list.
2. **Staff-only.** No AI feature is exposed to parents or athletes until a separate DPIA says otherwise (the proposed parent add-on, A5, needs exactly that, plus guardian consent). No AI interaction with minors, ever, in this roadmap.
3. **RLS-scoped context.** The assistant reads through the caller's RLS session, never the service role, so it cannot see what the user cannot see.
4. **No training on customer data**, contractually confirmed with the provider; prompts and answers retained only as the existing `ai_queries` preview, with a retention limit.
5. **Data location** stated in the data-processing agreement; if the provider processes outside CH/EU, the transfer basis is documented [Verify — data-protection adviser].
6. **Per-tenant on/off switch (default off, admin opt-in), platform-wide switch (no key or model configured = off), rate limit and monthly cost cap.** Inference is now matched by add-on revenue (workbook v2.2: about CHF 17 per AI club per month against CHF 69), except DLang's complimentary use (about CHF 25 a month [Est.]); the monthly cost cap per club protects the margin.
7. **Human in the loop** for anything that sends, charges, or changes a record.
8. **Evaluation set** of club questions (including attempts to extract other families' data) run in CI before any prompt or provider change.

---

## 8. Security program

The product holds minors' data and health data (medical notes, allergies). Under the revised Swiss FADP, fines of up to CHF 250,000 fall on the responsible individual [Founder §6.3]. The compliance pack (record of processing, DPIA, DPA template, breach procedure) is due 15 Jan 2027 and needs a data-protection adviser's review [Verify].

| Control | Now (to 31 Mar 2027) | 2027 | 2028–2029 |
|---|---|---|---|
| **External penetration test** | Book by 4 Dec 2026, complete by 31 Jan 2027, scope: tenant isolation/RLS, auth, Stripe webhook, file access, output escaping. CHF 5–15k [Est.] | Re-test after Connect and white-label merge (Q3) | Annual, plus before any Enterprise contract |
| **Tenant isolation tests** | Port `testing/rls_test_suite.sql` into CI; add a cross-tenant suite (two orgs, every role, every table) | Required check on every PR touching `supabase/` | — |
| **Vulnerability management** | Dependency scanning and alerts on the repo; patch criticals within 7 days, highs within 30 | Monthly patch day; container/host handled by managed providers | Formal SLA in contracts |
| **Secrets** | Already server-only via `src/lib/env.ts` with a boot check. Add secret scanning in CI and pre-commit. Rotate on any staff/contractor offboarding. | Move to the host's secret store per environment; separate test and live Stripe accounts | Short-lived credentials where providers support them |
| **Access reviews** | List every human with production, Supabase, Stripe, DNS, email access; enforce hardware-key or app-based MFA | Quarterly access review, recorded | Automated evidence for audit |
| **Backups** | Daily backups + PITR on the production project; first restore test before DLang goes live (Feb 2027) | Quarterly restore test | — |
| **Logging and incident response** | Redacting logger exists. Add error tracking and uptime monitoring. Write the breach procedure (FDPIC notification) | Tabletop exercise once a year | 24/7 on-call only with paid Enterprise SLA |
| **Certification** | None. Publish a plain-language security page and a filled-in standard security questionnaire | Align controls to ISO 27001 Annex A (policies, asset list, risk register) without certifying | **SOC 2 Type II** (US) or **ISO 27001** (EU/CH enterprise) only when a signed or late-stage contract requires it. A Type II needs a 3–12 month observation window after controls are in place, plus audit fees [Verify quotes]. Earliest certificate: 2029. |

---

## 9. Software delivery lifecycle

| Practice | Rule |
|---|---|
| Branching | Trunk-based. `main` is always deployable. Short-lived branches (<3 days). Long-running branches like `wf/tenancy` and `wf/platform` are merged in slices or closed by 31 Mar 2027. |
| Reviews | Every PR reviewed. Agent-authored PRs need a human approval. PRs touching `supabase/migrations`, RLS helpers, payments, auth or `src/lib/ai` need the CTO or the senior reviewer (two-key rule). |
| CI gates (required) | `tsc --noEmit`, `next lint`, `next build`, migrations applied to a fresh Postgres, RLS and cross-tenant test suites, unit tests for money and QR-bill logic, secret scan, dependency audit. End-to-end smoke tests (login, register, pay, mark attendance) by Q2 2027. |
| Feature flags | Per-tenant flags in the database (`org_features`), read server-side. New features ship dark, are enabled for DLang first, then for named clubs. Per-tenant and platform-wide off switch for every integration and every AI feature. |
| Migrations policy | Forward-only, timestamped files, never edited after merge. Expand → migrate → contract for any breaking change, across at least two releases. Every new table: `org_id not null`, RLS enabled and forced, policies, index on `org_id`, audit trigger if it holds money, consent or health data. A migration review checklist is part of the PR template. |
| Environments | Local → preview (per PR, test Stripe, seeded fake data, never real children's data) → staging → production. |
| Release train | Weekly release to production on a fixed weekday. **Freeze windows:** 21 Dec – 4 Jan; the week of each DLang holiday camp; the second half of August (season start). Hotfixes allowed in freezes for security and payments only. |
| Data in non-production | Synthetic only. Copying production data to any other environment is forbidden. |

### Engineering metrics (DORA, sized for a tiny team)

| Metric | Target by Jun 2027 [Est.] | Target by Dec 2027 |
|---|---|---|
| Deployment frequency | Weekly (release train) | Several times a week |
| Lead time for changes (merge → prod) | < 7 days | < 2 days |
| Change failure rate | < 20% | < 15% |
| Time to restore service | < 24 h | < 4 h in business hours |
| Plus: cross-tenant isolation test failures in production | 0 | 0 |
| Plus: payment reconciliation exceptions per 100 payments | Measured from Gate 2 | < 2 |

---

## 10. 12-month technical roadmap (Q4 2026 – Q3 2027)

Calendar realism: the 21 Dec – 3 Jan weeks are maintenance only; Feb ski week and DLang camps get no releases; capacity assumes the founder plus the paid reviewer and agents until the fractional CTO starts (signed 15 Dec 2026, latest 31 Jan 2027; structure proposal 8 Jan 2027).

| Quarter | Must deliver | Exit criteria | Downside |
|---|---|---|---|
| **Q4 2026** (from 16 Nov) | Payment-rail decision memo + legal view (27 Nov). Stripe Connect + TWINT on DLang test, then live. QR-bill v2.4 check. CI pipeline with type, build, migration and RLS gates. Pen test booked (4 Dec). | TWINT payment by a real parent reconciles automatically on DLang (**18 Dec**) | 31 Jan 2027; manual-beta fallback |
| **Q1 2027** | Fractional CTO in post (releases the EUR 50k). Pen test done, critical/high fixed (31 Jan). DPIA addendum + DPA sub-processor entry for AI (15 Jan); AI assistant beta switched on for DLang (Feb). Many-to-many memberships. CSV import, FR/EN translation layer, offline attendance (28 Feb). Merge theming slice from `wf/tenancy`. DLang spring invoicing on the platform. Backups + restore test. | DLang live, one full cycle (**Gate 3, 14 Feb**); club #1 onboarded on its own Connect account | Gate 3 by 31 Mar |
| **Q2 2027** | AI assistant offered to founding clubs (opt-in) once acceptance criteria are met. DE translation. Terminology dictionary. Per-tenant flags table. DLANG's own subscription billing (from `wf/platform`). iCal feeds. Accounting CSV export. End-to-end smoke tests. Load test plan for August. | 3 paying clubs live (May), onboarding a club in ≤1 day without engineering | 3 clubs by Aug |
| **Q3 2027** | Custom domains and sender domains. Bexio (if ≥3 clubs ask). J+S export. Load test and freeze before season start. Pen re-test. EU and US discounted paid design-partner pilots prepared (EUR and USD billing for the pilot price in Stripe) (EUR/SEPA, GDPR Art. 27 representative, US English, COPPA verifiable parental consent; go/no-go 30 Jun, live Sep–Oct 2027 / downside Jan and Mar 2028). | Season start (Aug–Sep) with zero P1 incidents; 5 founding clubs live | 5 clubs by Sep |

Beyond Q3 2027 (indicative): Entra/Google SSO (Q4 2027), public API (2028), EUR track with SEPA and DATEV (2028), native-app decision (Q1 2028), federation pilot (H2 2028), US cell and Clever/ClassLink only after the US gate (not before H2 2029).

---

## 11. Build vs. buy

| Capability | Decision | Rationale |
|---|---|---|
| Auth, Postgres, storage | **Buy** (Supabase) | Already built on it; RLS is the core control |
| Hosting / CDN / WAF | **Buy** (managed host in EU region) | No ops staff |
| Payments, TWINT, KYC | **Buy** (Stripe Connect; Payrexx fallback) | Regulated activity; DLANG must not hold funds |
| Swiss QR-bill generation | **Build** (exists) | Free rail, core differentiator, small code |
| Reconciliation logic | **Build** | The Gate 2 value; it is the product |
| Transactional email | **Buy** (Resend) | Deliverability is a specialist job |
| SMS | **Buy**, later | Only if email reminders underperform |
| Error tracking, uptime | **Buy** | Cheap, immediate |
| Feature flags | **Build** (one table) | A vendor is overkill at this size |
| Translations | **Build** the layer; **buy** professional review of FR/DE strings | Parents judge quality on language |
| Accounting connectors | **Build** Bexio, CSV, DATEV export; **buy** a unified API only if >2 API connectors are needed | Swiss tools are few and specific |
| SSO for schools | **Buy** (auth provider's SSO tier) | Do not hand-roll SAML |
| Native apps | **Build** with Expo, later | Shares TypeScript with web |
| Compliance automation (SOC 2/ISO evidence) | **Buy**, only when certifying | Not before a contract pays for it |
| LLM | **Buy** (API), provider-agnostic wrapper | Never self-host; keep switchable |

---

## 12. AI-augmented engineering operating model

**Team shape, plan of record (12 Nov 2026):** founder (product owner, acceptance tests on DLang) + a **named human fractional CTO** (shortlist 30 Nov, signed 15 Dec 2026, latest 31 Jan 2027; accountable for architecture, security sign-off, payment and RLS approvals, investor and customer due diligence) leading the **AI agent team** in `.claude/agents/` + a paid senior reviewer for 4–8 hours a week (pre-contracted 16 Dec 2026) as the bridge until the CTO starts + part-time contractors. Structure A (CTO partner with 20% before the round) is no longer the default; see `12_CTO_SOLUTION_AI_PLUS_HUMAN.md`. Hiring a Swiss employee takes 1–3 months of notice period on top of search time, so the first engineer employee is planned for Q1 2029, after a seed.

**Agent roster** (as first proposed; superseded by the 17 agents now committed in `.claude/agents/`, see `08_AI_AGENT_TEAM.md`):

| Agent | Does | May not |
|---|---|---|
| `planner` | Turns a founder story into a scoped task with acceptance tests | Change scope; the beta list is owned by the founder |
| `implementer` | Writes code and migrations on a branch, keeps `tsc` and `build` green | Merge; touch production; read real data |
| `migration-reviewer` | Checks every migration against the policy in §9 (org_id, forced RLS, index, audit, expand/contract) | Approve its own changes |
| `security-reviewer` | Reviews RLS, auth, webhook, file access, AI context builder; runs the cross-tenant suite | Waive a finding |
| `test-writer` | Adds unit, RLS and smoke tests for every change | Delete failing tests |
| `docs-keeper` | Updates SECURITY.md, the record of processing and the changelog when behaviour changes | Edit legal documents without human sign-off |

**Rules that keep this safe:**
1. **Agents never hold production credentials** and never see real personal data; they work on synthetic seed data and preview environments.
2. **Humans own the merge.** Two-key rule for migrations, RLS, payments, auth and AI (§9).
3. **Small diffs.** A PR that an agent produced and a human cannot review in 30 minutes is split.
4. **The tests are the spec.** Every bug fixed gets a regression test; every RLS change gets a cross-tenant test.
5. **Weekly review of agent output quality** (reverted PRs, review comments per PR) alongside DORA metrics.
6. **No AI model names or secrets in code, commits or docs**; the model identifier is configuration.

Estimated effect [Est.]: agents raise one experienced engineer's throughput meaningfully on well-specified work (CRUD, tests, translations, migrations); they do not replace judgement on payments, security or tenant isolation. The founder model's CHF 4,500/month engineering line only works *with* this model and with a reviewer paid at Swiss rates (CHF 110–150/hour [review brief]).

---

## 13. Tech-debt register (from the current codebase)

| # | Debt | Risk | Fix | Due |
|---|---|---|---|---|
| 1 | TWINT is a manual label; one Stripe account, no Connect | Gate 2 fails; DLANG could be seen as holding club funds | Connect + direct charges + reconciliation | 18 Dec 2026 (31 Jan) |
| 2 | No CI; tests only as a SQL file run by hand | Regressions in RLS reach production | CI with required gates (§9) | 15 Dec 2026 |
| 3 | `profiles.org_id` = one org per user | Parents/coaches in two clubs cannot use one account | Memberships table; RLS helpers read the active org from membership | 31 Mar 2027 |
| 4 | Unmerged `wf/tenancy`, `wf/platform` branches | Drift, painful merges, scope creep | Merge in slices or close | 31 Mar 2027 |
| 5 | No translation layer; UI strings hard-coded | Blocks Romandie and German-speaking clubs | i18n catalogue FR/EN/DE | FR/EN 28 Feb, DE Jun 2027 |
| 6 | No service worker / offline queue | Coaches lose attendance in halls without signal | PWA + offline queue | 28 Feb 2027 |
| 7 | CSV export only, no import | Onboarding needs engineering time | Import with validation and dry run | 28 Feb 2027 |
| 8 | Dashboard and some list pages still use sample data (README "stubbed") | Demo ≠ product | Wire to Supabase queries | 31 Jan 2027 |
| 9 | DLang-specific values (e.g. `RESEND_FROM_EMAIL` with the club's domain, basketball wording) in config/UI | White-label leaks | Move to per-tenant settings | Q2 2027 |
| 10 | Hand-written `src/types/database.ts` | Type drift from schema | Generate types in CI and fail on diff | Q1 2027 |
| 11 | AI assistant present; per-club opt-in now implemented (off by default) | Privacy exposure if a club switches it on before the paperwork | DPIA addendum + DPA sub-processor entry before any club enables it; allow-list context builder; acceptance criteria written | 15 Jan 2027 |
| 12 | Email bounce/complaint handling absent | Reminders land in spam; ROI story fails | Resend webhooks + suppression list | Q1 2027 |
| 13 | QR-bill v2.4 conformance unverified | Rejected bills at banks | Conformance test against SIX validation | 30 Nov 2026 |
| 14 | No error tracking or uptime monitoring | Silent failures | Add both | 15 Dec 2026 |
| 15 | RLS helper performance untested at scale | Slow pages at season start | Index review + load test | Jul 2027 |

---

## 14. Risks the CTO office owns

| Risk | Likelihood | Mitigation |
|---|---|---|
| Payment rail slips past 31 Jan 2027 | Medium | Single engineering priority; Payrexx fallback; manual beta |
| Cross-tenant data leak | Low, catastrophic | Forced RLS, CI isolation suite, pen test, two-key reviews |
| Founder capacity (sales + product + engineering) | High | Fractional CTO signed 15 Dec 2026 (latest 31 Jan 2027); reviewer as bridge; strict scope |
| Fractional CTO not signed in time (EUR 50k not released) | Medium | Shortlist 30 Nov; reviewer pre-contracted 16 Dec; Jan–Mar bridge of ~CHF 45k agreed 15 Dec (`11` §2) |
| EU/US discounted paid pilots compete with the Swiss season peak (Sep–Oct 2027) | Medium | Entry conditions (DLang live + ≥3 paying CH clubs, i18n/currency, privacy pack); go/no-go 30 Jun 2027; written pilot scope |
| Agent-generated code with subtle security flaws | Medium | Human merge, security-reviewer agent + human, tests as spec |
| Vendor dependency (Supabase, Stripe) | Medium | Standard Postgres, adapters, nightly logical dumps to CH/EU storage |
| AI feature causes a privacy incident with minors' data | Low if gated | Guardrails §7; off by default, club admin opt-in; DPIA addendum first |

---

## 15. Changes vs. founder's August 2026 plan

| Topic | Founder plan | Updated | Why |
|---|---|---|---|
| Core stack | Next.js 15 / React 19 / Supabase with forced RLS; do not rewrite | **Kept** | Correct, built, and the main asset |
| TWINT provider | Payrexx for beta (cheaper); Stripe the better platform | Stripe Connect with direct charges as primary; Payrexx as adapter-level fallback | The code is already on Stripe; Connect keeps DLANG out of fund-holding; margin re-modelled at ~0.2% |
| Gate 2 (TWINT reconciles) | 18 Oct 2026 | 18 Dec 2026 base / 31 Jan 2027 downside | Not met in repo: TWINT is a manual label, no Connect |
| Beta completeness | 12 features by the end of the 90 days | 4 missing items (CSV import, translations, offline, per-club accounts) by 28 Feb 2027 | Verified gaps in the repo |
| Mobile | PWA; revisit native when iOS push is a measured problem | Kept; native decision Q1 2028; per-tenant store builds 2029 at the earliest, paid by the customer | Same logic, now with dates and a paying-customer gate |
| AI | Out of beta; don't claim AI; CHF 90 module from Month 13 | Assistant kept but flagged off; rules-based reminders first; DPIA before any LLM use; module not modelled before 2028 | Minors' data; Paak and others have AI; no moat |
| Tenancy | Club ID on every table, RLS forced | Kept, plus many-to-many memberships, per-tenant config and CI isolation tests before club #2; regional cells and dedicated instances only behind gates | One-org-per-user blocks real multi-club use |
| Global / US | Deck: worldwide, every team sport | US cell, Clever/ClassLink, QuickBooks/Xero not before H2 2029 and only after the US gate | Capacity, capital, and no Swiss wedge in the US |
| White-label resale | Deck: licensing, white-label | Branding/terminology/domains in 2027 for DLANG's own clubs; resale 2029 at the earliest | Needs ≥25 clubs on one codebase, pen test, staffable SLA |
| Security | Compliance pack before club #1 | Kept; plus pen test by 31 Jan 2027, CI isolation suite, ISO 27001-aligned controls in 2027, certification only when a contract pays (2029 earliest) | Certification without a buyer is cost without revenue |
| QR-bill | Build to v2.4 (14 Nov 2026) | Kept; conformance test by 30 Nov 2026; camt.054 auto-matching added | Free rail needs automatic reconciliation to deliver the ROI story |
| Engineering cost | CHF 4,500/month (~24 h/week) Y1 | Only workable with AI agents plus a Swiss-rate senior reviewer (CHF 110–150/h); first employee Q1 2029 | CHF ~43/h is far below Swiss contractor rates |
| CTO | Equity + CHF 1,200/month retainer, 5-week paid trial on TWINT reconciliation | Decision by 8 Jan 2027; fallback is founder + agents + paid reviewer from Feb 2027 (*superseded 12 Nov 2026: see the CTO row below*) | Low Year-1 pay makes the search slow; the cutoff is now |
| SDLC | Not specified | Trunk-based, CI gates, two-key rule, per-tenant flags, forward-only migrations, weekly train with seasonal freezes | A children's-data product needs a repeatable, auditable process |
| Integrations | Not sequenced | CSV and camt.054 first; Bexio and J+S in 2027; SSO when a school is in the pipeline; DATEV with EUR; US systems after the US gate | Ordered by what Swiss academies pay for |
| AI (12 Nov 2026) | Out of beta; CHF 90 module | **Opt-in per club** (admin switch in Settings → App & assistant, default off; implemented in `src/lib/ai/access.ts`); DLang beta Q1 2027 (complimentary); round 2: **paid add-on**, CHF 69/month proposed [Confirm], on sale base Jun 2027; add-on entitlement (`complimentary` / `paid_addon`) instead of a plan feature | Founder wants it available once fully functional; guardrails and DPIA addendum first |
| Naming (12 Nov 2026) | "DLANG Sports OS" | Per-club app name (e.g. "DLang OS") implemented as tenant branding; platform name via `NEXT_PUBLIC_PLATFORM_NAME`; master brand decision 15 Feb 2027 | Clubs run the product under their own name |
| CTO (12 Nov 2026) | Structure A partner; decision 8 Jan 2027 | **Named human fractional CTO + AI agent team**, signed 15 Dec 2026 (latest 31 Jan 2027); reviewer as bridge; CTO proposes structure by 8 Jan 2027 | An AI agent cannot be accountable; the EUR 50k is released only once a CTO is in place |
| Markets (12 Nov 2026) | US/EU behind gates | Plus one discounted paid EU pilot (live Sep 2027 / Jan 2028) and one discounted paid US pilot (Sep–Oct 2027 / Mar 2028); full-price EU/US gates unchanged; no free pilots (round 2) | Founder wants EU and US presence in 2027 |
| Gates (12 Nov 2026) | Kill criterion at 31 Mar 2028 | No kill switch: a missed gate triggers a two-week strategy review (`00` §4.7) | Founder decision 15 |

*Items marked [Verify] (fund-holding under Swiss AML rules, Stripe Connect and TWINT terms, QR-bill v2.4 conformance, J+S data formats, AI provider data terms and transfers, certification costs) must be confirmed with counsel, a data-protection adviser, the vendors or an auditor before external use.*
