# Launch Readiness Report

**Product:** DLANG Sports OS (white-label club operating system) and its first tenant, DLang Basketball (Lausanne)
**Branch:** `claude/ultracode-kfui6x` (not pushed)
**Date:** 12 November 2026
**Author:** Chief of staff
**Timeline source of truth:** `docs/company/updated/DLANG_Sports_OS_Rollout_v2.md` and `docs/company/09_FOUNDER_PLAN_REVIEW.md` §5 (re-baselined). All dates below are **base / downside**.

---

## 1. Bottom line

| Question | Answer |
|---|---|
| Is the code ready for a DLang production pilot? | **Yes, conditionally.** All automated gates are green and every critical/high review finding is fixed. Nothing has yet run against a real Supabase project, real Stripe, or real Resend. |
| Is DLang "live"? | **No.** Production infrastructure, Stripe Connect + TWINT activation, data import and a real-money pilot are manual founder steps (section 7A). |
| Is Gate 2 (a real TWINT payment reconciles automatically on DLang) met? | **No, but it is now technically reachable.** The code path exists (Stripe Connect, per-club account, webhook, idempotent reconciliation). It must be proven with ≥10 real DLang payments. Target **18 Dec 2026**, red line 31 Dec, downside **31 Jan 2027**. |
| Can a second Swiss club be onboarded? | Technically yes (self-signup, branding, Connect, import). Commercially gated: first paid signature **31 Jan / 31 Mar 2027**, go-live **Feb / Apr 2027**. |
| EU / US? | **Not before their gates.** EU: first club signed Q2 2028, live Sep 2028 (downside 2029). US: exploration not before H2 2029. |

Biggest remaining risks: (1) unproven against live Stripe/TWINT; (2) admin and coach screens, emails and PDFs still largely English-only; (3) offline attendance not built; (4) no external penetration test yet; (5) funding: the v2 model shows cash negative from Apr 2027 without an upsized convertible.

---

## 2. What was built in this phase (per engineering track)

All nine track branches were merged `--no-ff` into `claude/ultracode-kfui6x`, followed by integration fix commits and review fix commits. Migrations grew from 16 to 26.

| Track | Delivered | Key paths | Known limits |
|---|---|---|---|
| **Tenancy (white-label core)** | Tenant resolution by custom domain, `<slug>.PLATFORM_ROOT_DOMAIN` or `<slug>.localhost`; per-tenant branding, terminology, sport, country, locales, currency, timezone, plan, status, data region; public-safe `get_public_tenant()`; Settings > Branding editor with WCAG contrast check; suspended-tenant gate. Seeds `dlang` (CHF, fr-CH/de-CH/en) and `riverside` (US, USD). | `supabase/migrations/20250420091600_white_label_tenancy.sql`, `supabase/seeds/seed_tenants.sql`, `src/lib/tenant/*`, `src/app/(admin)/admin/settings/branding/` | Logo is URL-only (no upload). Custom-domain TLS/routing is manual. |
| **Platform (SaaS operator layer)** | Plans and prices from Business Plan §5.3: Starter CHF 290 / Club 490 / Academy 890 / Federation from 1,690 (contact sales); onboarding fees CHF 750 / 1,500 / 2,900, waived on annual; founding deal (CHF 290 for life, fee waived). Self-signup with 14-day trial, operator console (`/platform`: MRR, tenants, suspend, plan change, domains), Stripe Billing checkout/portal/webhook with dedup, usage snapshots, feature/limit checks. | `20250420091700_platform_saas.sql`, `src/lib/platform/`, `src/app/platform/`, `src/app/api/billing/*` | USD prices and EUR/USD onboarding fees are **not** from founder docs; confirm before use. No overage billing; no per-country tax rates. |
| **i18n** | 5 languages (en, de, fr, it, es), 421 keys each, typed keys (missing key fails `tsc`); locale negotiation (user > cookie > club > browser > en); money/date formatting per locale + country (CHF 1'234.50, 1.234,50 €, $1,234.50); language switcher; `npm run i18n:check`. Parent, login, registration and invoice surfaces translated. | `src/lib/i18n/`, `src/lib/format.ts`, `src/messages/*.json`, `20250420095000_i18n_localization.sql`, `docs/i18n.md` | Admin and coach screens, email bodies, invoice PDF labels, cookie banner and legal pages are still English. |
| **Payments (regional)** | Stripe Connect (Standard/Express) with direct charges + application fee, so DLANG never holds club money; CH/EU/US method matrix (card, TWINT, SEPA, ACH, iDEAL, Bancontact, Apple/Google Pay); club currency on invoices; invoice tax fields; QRR for CH/LI, RF elsewhere; EPC transfer QR for EU; refunds as append-only negative rows; installment and recurring-fee plans; admin Settings > Online payments. | `20250420091800_regional_payments.sql`, `src/lib/payments/`, `src/lib/stripe-connect.ts`, `src/app/api/stripe/*`, `docs/payments/regional-payments.md` | Hosted Checkout only (no embedded Elements). No Stripe autopay for installments. One tax rate per invoice; no US sales-tax engine. |
| **Compliance** | Per-org compliance settings (CH/EU/UK/US), 17-category retention schedule, ROPA, sub-processors, COPPA parental consents, FERPA disclosure log, breach register with 72 h deadline, DSAR register with statutory due dates; region profiles (nFADP, GDPR, COPPA, CCPA/CPRA, FERPA); cookie banner (necessary-only default, GPC honoured); public legal pages `/legal/[orgSlug]/*`; legal templates and a 29-requirement compliance matrix. | `20250420091900_compliance_regions.sql`, `src/lib/compliance/`, `src/components/compliance/`, `src/app/legal/`, `docs/legal/*` | No compliance admin screens, no retention job, no DSAR/breach reminders, MFA not enforced. All templates need counsel review. |
| **Quality** | Vitest unit suite, Postgres DB harness (`scripts/db-test.sh`: applies every migration to an empty DB, then runs each suite on a fresh clone), tenant-isolation suite that discovers every `org_id` table automatically, money-logic suite, Playwright smoke specs, GitHub Actions CI with a "quality gate" job and blocking Gitleaks. | `vitest.config.ts`, `tests/`, `scripts/db-test.sh`, `testing/`, `e2e/`, `.github/workflows/ci.yml` | Full e2e flows (pay, attendance, cross-family denial) not written; no coverage tooling. |
| **DevOps** | Health endpoint (`/api/health`, live/ready, token-gated config report), JSON logger with redaction, Sentry-compatible error reporting without SDK, env validation, Dockerfile (standalone), `vercel.json` (fra1, security headers), pre-deploy env check, post-deploy smoke test, admin **CSV import** (families, athletes, parent invites; dry run; all-or-nothing). Ops docs: architecture, deploy, migrations, backup/DR, incident response, on-call, tenant onboarding runbook. | `src/app/api/health/`, `src/lib/observability/`, `Dockerfile`, `vercel.json`, `scripts/deploy/`, `src/app/(admin)/admin/import/`, `docs/ops/*` | Backup job, uptime monitor and Sentry project are manual. Usage cron not yet in `vercel.json`. |
| **Design** | Design tokens as CSS variables (V5 dark luxury defaults, light theme, system), restyled primitives, admin sidebar/top bar, mobile drawer, coach/parent bottom tab bar, accessibility (skip link, focus ring, 44 px targets, reduced motion), AA contrast on all text tokens; two-panel login. | `src/app/globals.css`, `tailwind.config.ts`, `src/components/ui/*`, `src/components/layout/*`, `docs/design/DESIGN_SYSTEM.md` | Not visually reviewed in a browser. Page-level screens inherit the look but were not individually reworked. |
| **Sports ops** | Seasons, venues and courts, teams, coaches, rosters, events, game results, RSVPs; hard double-booking constraint per court plus soft conflict warnings; admin Teams / Schedule / Venues / Reports with 5 CSV exports (formula-injection safe); coach My team; parent Schedule with per-child RSVP. | `20250420092000_teams_seasons_schedule.sql`, `src/lib/sportsops/`, `src/app/(admin)/admin/{teams,schedule,reports}`, `src/app/(coach)/coach/team`, `src/app/(parent)/parent/schedule` | `event-form.tsx` still converts times in browser time zone; no per-athlete stats UI; no event notifications. |

**Integration fixes on top of the merges:** middleware moved to `src/middleware.ts` (it previously never ran); migration `20250420095100_integration_fixes.sql` (role checks scoped to own org, isolation policies on all new tables, invoice numbers past 9999, every migration now applies to an empty DB); tenant identity replaces hard-coded "DLang Basketball" in emails, notifications, PDF, QR-bill creditor and assistant; Stripe keys masked in logs; AI model identifier moved to configuration only.

---

## 3. Company documents produced

All in `docs/company/` (founder originals untouched in `docs/company/source/`).

| File | What it decides |
|---|---|
| `00_EXECUTIVE_PLAN.md` | DLang first, Swiss sales next, EU/US behind gates; money chain before anything else; OKRs to 31 Mar 2027, risk register, first-30-days list. |
| `01_BUSINESS_MODEL.md` | Pricing kept (CHF 149 + 1.90/athlete; 290/490/890/1,690); 0.5% Connect application fee (≈0.2% net margin); 3-year model; funding need CHF 290–360k in tranches. |
| `02_GO_TO_MARKET.md` | Switzerland only in 2027 (Romandie first); week-by-week 90-day plan 16 Nov–14 Feb; founder-led sales, no free pilots, 5 founding clubs; gated partner programme. |
| `03_CTO_TECHNOLOGY_STRATEGY.md` | No rewrite; multi-club membership and cross-tenant CI before club #2; payment rail first; PWA now, native 2029+; AI off by default; pen test by 31 Jan 2027. |
| `04_ORG_DESIGN_AND_HR.md` | Headcount follows club gates; CTO decision 8 Jan 2027; CS 50% from Jan 2028; first engineer Q2 2029 after seed. |
| `05_LEGAL_CORPORATE_STRUCTURE.md` | Vaud GmbH, IP assigned by 31 Dec 2026; trademark clearance ("DLang" collides with the D language) by 15 Jan 2027; AML view by 27 Nov; insurance by 31 Jan 2027. |
| `06_CUSTOMER_SUCCESS_AND_SUPPORT.md` | A club is onboarded only when real money moved; assisted onboarding only in 2027; support SLAs in Swiss business hours; health score; migration playbook M0–M7. |
| `07_BRAND_AND_MARKETING.md` | Company / platform / club brand layers; naming review by 15 Feb 2027; claim rules ("cheapest payment rail", not "cheaper than Spond"); public launch Apr–May 2027. |
| `08_AI_AGENT_TEAM.md` | How the agent team works, routing and governance. |
| `09_FOUNDER_PLAN_REVIEW.md` | Independent review; re-baselined gates and milestones (section 5). |
| `10_FINANCIAL_MODEL_V2_NOTES.md` + `updated/DLANG_Sports_OS_Financial_Model_v2.xlsx` | Re-dated model (M1 = Dec-26), 93 logged changes, Timeline_v2 sheet. Base ARR CHF 39.6k / 117.1k / 238.5k at Nov-27/28/29. |
| `updated/DLANG_Sports_OS_Business_Plan_v2.{md,docx}`, `updated/DLANG_Sports_OS_Rollout_v2.{md,docx}`, `updated/CHANGELOG.md`, `updated/README.md` | Founder-voice v2 plan and 13-week rollout (16 Nov 2026–14 Feb 2027); changelog lists 14 founder decisions. |

**Known inconsistency (founder decision #13 in the CHANGELOG):** `00` and `09` say break-even Q2–Q3 2029 and a CHF 100–150k bridge by Sep 2027. The v2 workbook (and Business Plan v2 / Rollout v2) show base break-even about **Q4 2030**, upside Aug 2029, and cash **negative from Apr 2027** on current funds, so the January convertible should be upsized to CHF 150–200k. This report follows the workbook for cash and the 09/Rollout v2 gates for operational dates.

---

## 4. AI agent team

- `CLAUDE.md` (repo root): product overview, business context index and Swiss club calendar, architecture map, multi-tenant rules (org_id + RLS everywhere, server-side tenant resolution, service-role limits), migration conventions, i18n/theming rules, minors' data rules (nFADP, GDPR, COPPA, FERPA), commands, routing table, governance.
- `.claude/agents/` (17 agents): cto-architect, product-manager, frontend-engineer, backend-db-engineer, payments-engineer, security-reviewer (read-only), privacy-compliance-officer, qa-test-engineer, devops-sre, i18n-localization, ux-designer, customer-success, gtm-strategist, hr-people-partner, finance-analyst, legal-counsel-assistant (templates only), tenant-onboarding-specialist.
- Governance: agents never hold production credentials; a human approves every merge; a second human approves changes to migrations, RLS, payments, auth and AI; production migrations, pricing, legal and tax decisions are human-only.
- Status: these files (and `docs/company/`) are **not yet committed**; they were deliberately left untracked. Commit them once the founder has read them.

---

## 5. Verification status (run on 12 Nov 2026 in `/home/user/dlang-club-os`)

| Check | Command | Result |
|---|---|---|
| Type-check | `npx tsc --noEmit` | **Pass** (exit 0) |
| Unit tests | `npm run test:unit` | **Pass**: 11 files, 114 tests |
| Payments tests | `npm run test:payments` | **Pass**: 7/7 |
| Translation check | `node scripts/i18n-check.mjs --strict` | **Pass**: 0 errors, 0 warnings |
| DB suites | `bash scripts/db-test.sh` | **Pass**: 10 suites, 273 assertions, 26 migrations; all migrations apply to an empty DB. 1 tracked XFAIL (overpayments not flagged). |
| Production build | `npm run build` (temporary `.env.local` from `.env.example`, removed afterwards) | **Pass**; middleware included (92.7 kB) |
| Lint | `npx next lint` | **Pass**: no warnings or errors |

DB suite breakdown: RLS 16, platform 35, regional payments 1 block, sports ops 6, compliance 25, auth 5, minors' privacy 26, money logic 65 (+1 XFAIL), RPC tenant isolation 70, table tenant isolation 24.

**Not verified:** anything against real Supabase Auth/Storage, real Stripe (Connect onboarding, TWINT, SEPA, webhooks), real Resend delivery, Vercel deploy, Docker image build, visual review of the design, Playwright flows that need a seeded backend (`E2E_BACKEND=1`), Gitleaks run locally.

---

## 6. Review findings and outcomes

Five reviews ran after integration (tenant isolation, payments, minors' privacy, white-label, build health). Every critical and high finding was either fixed or confirmed already fixed, with a regression test.

| Severity | Finding | Outcome |
|---|---|---|
| Critical | anon/authenticated could execute service-role payment RPCs (repoint a club's Stripe account, forge "paid") | **Fixed** (`20250420095200_tenant_rpc_hardening.sql`, `20250420095300_payments_review_fixes.sql`): EXECUTE revoked, anon allowlist enforced by a pg_proc test, in-body `is_service_caller()` guard. Also fixed a latent bug: `current_user` checks inside SECURITY DEFINER always passed. |
| Critical | SECURITY DEFINER RPCs never checked the target row's org (cross-tenant medical reads, erasure, payments) | **Fixed** in 095200 for 14 functions; per-RPC cross-tenant denial tests. |
| Critical | App roles read from every org → admin escalation into another club | **Fixed** (`src/lib/auth/get-user.ts`, `staff.ts`, `invitations.ts`) + unit tests. |
| Critical | Storage policy let any club admin read/delete every club's documents | **Fixed** (`20250420095400_minors_privacy_fixes.sql`): path must start with own org id. |
| Critical | Registration alerts (children's names) to one platform-wide inbox | **Fixed**: per-org recipients; `CLUB_ADMIN_EMAIL` removed. |
| High | Uninvited signups joined DLang and could read its bank details | **Fixed**: `profiles.org_id` nullable until invitation/provisioning; test shows zero visible rows. |
| High | Invitations accepted another club's family/coach ids | **Fixed**: same-org trigger + app checks. |
| High | `record_manual_payment` and `book_training_session` across clubs | **Fixed** + amount rounding to currency exponent. |
| High | Erasure failed (called via service role) and left medical data in audit logs and notes | **Fixed**: session-client call; audit trigger redacts health columns; erasure clears notes, documents and audit payloads. |
| High | Medical notes copied into `registrations.notes` (visible to finance/coaches) | **Fixed**; existing copies cleared. |
| High | Admin Programs, Payments and Coach Schedule pages showed hard-coded DLang data | **Fixed**: real, org-scoped data and empty states; new `/admin/programs/new`. |
| High | Dates in Zurich time for every tenant; slots entered in browser time | **Fixed** (deprecated helpers deleted, DST-safe `zonedWallTimeToUtc`), except `event-form.tsx` (deferred). |
| High | Invoice PDF crashed on non-Latin-1 names | **Fixed** by transliteration (`toWinAnsi`); embedded Unicode font deferred. |
| High | Apex/app host resolved every signed-in club to DLang's tenant | **Fixed**: platform hosts resolve the user's own club; branding save allowed there. |
| Medium | Pending SEPA/ACH refunds and lost disputes not recorded | **Fixed**: `refund.updated`, `charge.refund.updated`, `charge.dispute.closed` handled; new `apply_stripe_dispute_loss`. |
| Medium | QR-bill reference type mismatched the invoice's reference/IBAN | **Fixed**: account chosen from the reference (QRR ↔ QR-IBAN, SCOR/NON ↔ IBAN), no QR-bill otherwise. |
| Medium | Paid invoices still printed a payable QR-bill | **Fixed**: only when balance > 0. |
| Medium | `markInvoicePaid` ignored refunds | **Fixed**. |
| Medium | COPPA promise not enforced | **Fixed** as a gate: under-13 online registration refused for US/COPPA orgs (`VPC_REQUIRED`); full consent flow deferred. |
| Medium | Parent data export incomplete | **Fixed**: medical, consent text, attendance, bookings, profile included. |
| Medium | Email links, brand colour/logo, currency; terminology never applied; PDF "Club OS"/red/TWINT footer | **Fixed** (tenant URLs, branded emails, `formatMoney`, nav and page headers use tenant terms, PDF uses platform name, brand colour, region-correct footer). Remaining parts deferred (below). |
| Medium | CI skipped payments tests and i18n check | **Fixed** in `.github/workflows/ci.yml`. |

---

## 7. Deferred items (low/medium severity, accepted for the DLang pilot)

1. **Overpayments** not flagged or credited (tracked XFAIL in `tests/db/money_logic.sql`).
2. `invoice_net_paid(uuid)` is executable by authenticated users without an org check (read-only amount leak given a UUID).
3. PaymentIntent idempotency key ignores payer/fee/description → second payer can get a 502 for 24 h (Hosted Checkout path unaffected).
4. `src/components/schedule/event-form.tsx` converts times in the browser time zone.
5. Usage-snapshot cron not scheduled in `vercel.json`.
6. `legal-templates.ts` falls back to "DLANG Sports OS" and `defaultLegalSlug()` to `dlang` when env is unset; Dockerfile lacks `NEXT_PUBLIC_PLATFORM_NAME` build arg.
7. Raw Postgres error logged unredacted in `src/lib/actions/registration.ts`.
8. Settings export file named `dlang-export-*.json` for every tenant.
9. Booking confirmation and assistant context still say "CHF".
10. Invoice PDF: no tenant logo (needs safe fetch or stored file); English-only labels; transliteration instead of Unicode font.
11. Registration error messages hard-coded English; public programme lookup by slug only (slugs unique per club; new slugs get a random suffix).
12. Light-theme derived shades differ slightly from hand-set design values.
13. Payments fee plan codes (`founding`, `pro`) coexist with platform plan codes; fee levels 1.5% / 1% vs the business model's 0.5% need a founder decision.
14. USD prices and EUR/USD onboarding fees are placeholders.
15. `src/types/database.ts` was edited by hand; regenerate with `npm run types` against the real project.

---

## 8. Go-live checklist

Each step has an owner (F = founder, ENG = engineer/contractor, REV = paid senior reviewer, LAW = lawyer, FID = fiduciary, DL = DLang staff). Dates are base / downside and follow Rollout v2.

### A. DLang Basketball live in production

Target: **real-money pilot on a DLang winter camp 7–18 Dec 2026 → Gate 2 on 18 Dec (red line 31 Dec, downside 31 Jan 2027) → spring invoicing on the platform 11–17 Jan 2027 → Gate 3 (one full cycle) 14 Feb 2027 (downside 31 Mar 2027).** No go-lives or production migrations 19 Dec–4 Jan.

**Week 1–2 decisions (by 27 Nov)**
- [ ] F: answer the status questions in `09_FOUNDER_PLAN_REVIEW.md` §4 (incorporation, cash, FIT filing, audits, CTO trial). **20 Nov.**
- [ ] F: hosting claim decision: Supabase **eu-central-1 (Frankfurt)** and drop "Swiss hosted" from sales copy, or use **Zurich (eu-central-2)**. Recommendation: Frankfurt unless a buyer requires Swiss residency. **20 Nov.**
- [ ] F + LAW: written AML view on Stripe Connect direct charges + application fee; payment rail decision (Stripe Connect, Payrexx fallback). **27 Nov.**
- [ ] F: decide platform fee levels (0.5% per business model vs 1–1.5% in code) and DLang's own plan (founding deal). **27 Nov.**

**Infrastructure (23 Nov–4 Dec)**
- [ ] F: create two Supabase projects (staging, production) in the chosen EU region, Pro plan with point-in-time recovery; custom SMTP for Auth email; auth redirect URLs for the production domain and `*.root`.
- [ ] ENG: apply all 26 migrations in order to staging (`supabase db push` or `psql` per `docs/ops/MIGRATIONS.md`), then `supabase/seeds/seed_tenants.sql`. Run `testing/rls_test_suite.sql` and `bash scripts/db-test.sh` equivalents on staging. Regenerate types (`npm run types`). Production migrations need human approval.
- [ ] F: Vercel Pro project, region `fra1`; production domain (e.g. `app.<root>`) and wildcard `*.<root>`; DLang subdomain `dlang.<root>` or custom domain.
- [ ] ENG: set env vars, then validate with `APP_ENV=production node scripts/deploy/check-env.mjs <file>`: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SITE_URL`, `PLATFORM_ROOT_DOMAIN`, `DEFAULT_ORG_SLUG=dlang`, `NEXT_PUBLIC_DEFAULT_ORG_SLUG=dlang`, `NEXT_PUBLIC_PLATFORM_NAME`, `PLATFORM_SALES_EMAIL`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_CONNECT_WEBHOOK_SECRET`, `STRIPE_CONNECT_ACCOUNT_TYPE`, `STRIPE_CONNECT_REQUIRED=true`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`, `STRIPE_BILLING_SECRET_KEY`, `STRIPE_BILLING_WEBHOOK_SECRET`, `RESEND_API_KEY`, `RESEND_FROM`, `APP_ENV`, `DATA_REGION`, `HEALTH_CHECK_TOKEN`, `SENTRY_DSN`, `CRON_SECRET`. Leave the AI assistant off (`ANTHROPIC_*` unset) until a DPIA is signed.
- [ ] F: Stripe platform account (live), enable **Connect**; two webhook endpoints at `/api/stripe/webhook` (platform + connected accounts) subscribed to `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `payment_intent.succeeded`, `payment_intent.payment_failed`, `charge.refunded`, `charge.refund.updated`, `refund.updated`, `charge.dispute.closed`, `account.updated`, `account.application.deauthorized`. Billing webhook at `/api/billing/webhook` for `checkout.session.*`, `customer.subscription.*`, `invoice.*`; enable Customer Portal.
- [ ] F: Resend account in EU region; verify sending domain (SPF, DKIM, DMARC).
- [ ] F: sign DPAs with Supabase, Vercel, Stripe, Resend (and Sentry); record URLs in `subprocessors.dpa_url`.
- [ ] F: uptime monitor on `/api/health`; Sentry project; nightly encrypted dump per `docs/ops/BACKUP_DR.md`; add the usage cron (`/api/platform/cron/usage`) and a daily `run_recurring_billing` job. **One restore drill before 4 Dec.**
- [ ] F: GitHub branch protection on `main` requiring "quality gate" and "secret scan".
- [ ] F: insert the first operator row in `public.platform_admins`.
- [ ] F + LAW: compliance gate (ROPA, DPIA, DPA, privacy notice reviewed). **4 Dec** (compliance pack signed off 15 Jan).
- [ ] F: book the external security review / pen test. **Booked 4 Dec, done 31 Jan 2027.**

**DLang tenant (30 Nov–6 Dec)**
- [ ] ENG: confirm `dlang` tenant from seed; F fills legal name, address, UID, privacy email in `compliance_settings` / Settings > Profile; check `/legal/dlang/*`.
- [ ] F: branding (logo URL, colours) in Settings > Branding; payment settings (IBAN, QR-IBAN, VAT defaults); set DLang subscription in `/platform` (founding deal).
- [ ] DL (club admin): Settings > Online payments → complete Stripe Connect onboarding (start identity checks immediately, they take days); activate **TWINT** and card on DLang's Stripe account.
- [ ] F: invite staff (admin, finance, coaches) from the admin staff screen; enforce strong passwords (MFA is not yet enforced in-app).
- [ ] F: create the winter-camp programme(s), venues, teams and schedule.

**Data and pilot (7–18 Dec)**
- [ ] F: import families via `/admin/import` (download template, dry run, fix errors, import; parent-invite emails off for the dry run).
- [ ] F: pilot with **5–10 families** on one real winter camp: registration → invoice → pay by card, TWINT and QR-bill → reminder → attendance. Run old process in parallel for one billing cycle at most.
- [ ] ENG + REV: run `scripts/deploy/smoke-test.sh` after every deploy; watch webhook logs and Sentry daily.
- [ ] **Gate 2 (18 Dec):** ≥10 real DLang payments reconciled automatically with zero manual steps; failure and duplicate cases tested. If missed: red line 31 Dec, downside 31 Jan; payments remain the only engineering priority.
- [ ] 19 Dec–4 Jan: freeze (maintenance only).
- [ ] 11–17 Jan: DLang spring invoicing on the platform; coach training (late Jan).
- [ ] **Gate 3 (14 Feb / 31 Mar 2027):** one full cycle register → pay (QR-bill, card, TWINT) → roster → attend → 7/14-day reminder, <5% manual payment matching, weekly active admins.

### B. First paying white-label tenant in Switzerland

Target: **Gate 1 and first founding club signed 31 Jan 2027 (downside 31 Mar); club #1 kickoff 1–7 Feb; club #1 live Feb 2027 (downside Apr); Gate 3b (club #1 weekly with a reference) 30 Apr / 30 Jun 2027.** Founding cohort of 5 closed 30 Jun / 30 Sep 2027; 10 paying clubs Oct 2027 / Mar 2028.

- [ ] F + LAW: GmbH registered and IP assigned (**31 Dec 2026**); subscription agreement, founding-club addendum, DPA and privacy notice ready before the first signature (**31 Jan 2027**); cyber + professional liability insurance bound (**31 Jan**).
- [ ] F: 10 workflow audits with private academies / camp operators; Gate 1 tally (≥6 of 10 at ≥3× value); fallback price card ready (**15 Dec**).
- [ ] ENG: before club #2: multi-club membership (today one org per profile), offline attendance, French admin/coach UI, French email/PDF text, compliance admin screens, MFA for admin/finance. The four beta items (CSV import ✓, translation, offline attendance, per-club Connect ✓) close **28 Feb 2027**.
- [ ] ENG: fix deferred items 1–3 and 5 (overpayments, `invoice_net_paid`, PaymentIntent key, usage cron).
- [ ] Security review report with zero open critical/high findings (**31 Jan 2027**).
- [ ] Per tenant (runbook `docs/ops/TENANT_ONBOARDING_RUNBOOK.md`): provision via `/signup` or operator console, subdomain or custom domain (manual DNS + Vercel domain), branding, Stripe Connect + TWINT activation **before day 0**, DPA signed **before import**, CSV import, first real payment = onboarded. At most 2 onboardings at once; no go-lives 15 Dec–6 Jan; no migrations Jun–Sep.
- [ ] F + FID: Swiss VAT registration decision (**31 Mar 2027**); trademark clearance (**15 Jan**) and CH filing (**28 Feb**).
- [ ] F: upsize the January convertible to CHF 150–200k (per v2 model) or line up the bridge (term sheet **30 Jun 2027**).

### C. EU launch

Target: **first EUR-track club signed Q2 2028, live Sep 2028 (downside 2029).** Order: French border region (Grand Genève / Haute-Savoie), then DE/AT, Benelux, northern Italy, Spain. No EU marketing before ≥10 Swiss clubs.

Entry gate (all true): ≥10 paying Swiss clubs; gross margin ≥75%; SEPA live; EU VAT (non-Union OSS + reverse charge) set up with FID; GDPR Art. 27 EU representative appointed; DE and FR UI complete.

- [ ] ENG: SEPA Debit + iDEAL/Bancontact proven on a real connected account; EPC QR in the PDF; per-line tax; Unicode PDF font; DE/FR for every surface including legal pages and emails.
- [ ] F + LAW: EU terms, DPA, cookie policy reviewed under local law; Madrid trademark extension at the gate.
- [ ] Data residency stays EU (Frankfurt); confirm CH↔EU adequacy wording in the privacy notice.
- [ ] Confirm EUR onboarding fees (currently placeholders 720 / 1,440 / 2,790).

### D. US launch

Target: **exploration not before H2 2029; decide then.** Broad white-label resale 2029 at the earliest.

US gate (all true): ≥40 paying clubs; ≥CHF 25k MRR; a year of NRR ≥100%; seed closed with a US line item; one paying inbound US design partner; a named US channel (league, school network, federation). White-label resale gate: ≥25 clubs on one codebase, external pen test passed, documented tenant-isolation tests, staffable support SLA.

- [ ] Separate US Supabase project (us-east-1) and Vercel deployment; tenant→region directory.
- [ ] Full COPPA verifiable-parental-consent flow (current gate only blocks under-13 online registration), written information security programme, FERPA school-official terms, state privacy laws.
- [ ] US sales-tax nexus study and engine; ACH proven; USD price list confirmed (currently placeholders).
- [ ] Delaware C-Corp subsidiary at the gate; US trademark via Madrid; no US hire before 2030.

---

## 9. Phase 2 backlog (prioritised for the next run)

**P0 — before DLang Gate 2 (by 18 Dec 2026)**
1. Prove Stripe Connect + TWINT end to end against Stripe test mode, then live; add Playwright e2e for register → pay → webhook reconciliation (`E2E_BACKEND=1`).
2. Overpayment handling (flag + credit) and close the `invoice_net_paid` org check; fix PaymentIntent idempotency key.
3. Add usage and recurring-billing crons to `vercel.json`; deploy staging; run smoke tests; restore drill.
4. Redact the raw registration error log; fix `dlang-export` filename and the `legal-templates` platform-name fallback.

**P1 — before club #2 (by 28 Feb 2027)**
5. Offline attendance (service-worker queue with sync).
6. French (and German) for admin and coach screens, email/notification bodies, invoice PDF, cookie banner and legal pages.
7. Multi-club membership (profile ↔ many orgs) with org switcher; keep cross-tenant tests in CI.
8. Compliance admin screens (settings, retention, DSAR, breaches, consents) and MFA for admin/finance.
9. Fix `event-form.tsx` time zone; tenant terminology in emails and remaining pages; tenant time zone field in settings.
10. Logo upload to Storage (used by emails and PDF); Unicode font in PDF.

**P2 — Q2–Q3 2027**
11. Retention job, DSAR/breach reminders, sub-processor change notices.
12. Accountant export and Bexio integration; bank-file (camt.054) matching for QR-bill.
13. Per-athlete stats UI, season editing, event notifications, events on parent home.
14. Custom-domain automation via Vercel Domains API; per-tenant Resend sender domains.
15. Embedded Stripe Elements; Stripe-side autopay for installments; reconcile payment fee plan codes with platform plans.

**P3 — gated (EU 2028, US 2029+)**
16. Per-line tax, OSS reporting, SEPA mandates at scale; US sales-tax engine.
17. Full COPPA VPC flow; FERPA/school SSO; US region deployment and tenant directory.
18. AI assistant re-enabled only after DPIA, staff-only, with a data allow-list.
