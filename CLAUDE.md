# CLAUDE.md - DLANG Sports OS

Read this before changing anything. It applies to every agent in `.claude/agents/` and to any Claude Code session in this repo.

## 1. What this is

DLANG Sports OS ("Club OS") is a club operating system: programmes and camps, public registration, families and athletes, invoicing (Swiss QR-bill, Stripe card/TWINT), reminders, attendance, coach and parent apps, player-development bookings, notifications, documents and consents, and an AI assistant.

Two products, one codebase:
1. **DLang Basketball / Swiss Prep Sports Academy (Lausanne)** runs its whole club on it. DLang is customer zero: no workflow is sold to another club before DLang has run it end to end.
2. **A white-label, multi-tenant SaaS** for sports clubs, teams, schools and organisations in any sport, with per-tenant branding, terminology, locale and currency. Launch order: Switzerland, then the EU (EUR track), then the USA, each behind a gate in `docs/company/00_EXECUTIVE_PLAN.md`.

## 2. Business context (read before planning)

- Company docs: `docs/company/`
  - `00_EXECUTIVE_PLAN.md` - roadmap, launch gates, OKRs, re-baselined base/downside dates (the timeline source of truth)
  - `01_BUSINESS_MODEL.md` - segments, pricing, take-rate, unit economics, 3-year model
  - `02_GO_TO_MARKET.md` - Swiss sales motion and calendar, EU track, US gate, pilots, resellers
  - `03_CTO_TECHNOLOGY_STRATEGY.md` - architecture, payments, security, technical roadmap
  - `04_ORG_DESIGN_AND_HR.md`, `05_LEGAL_CORPORATE_STRUCTURE.md`, `06_CUSTOMER_SUCCESS_AND_SUPPORT.md`, `07_BRAND_AND_MARKETING.md`
  - `08_AI_AGENT_TEAM.md` - this AI agent team, example prompts, governance
  - `09_FOUNDER_PLAN_REVIEW.md` - review of the founder's August 2026 plan
- Founder originals: `docs/company/source/` (Business Plan, 90-Day Rollout, Financial Model .xlsx, CTO Partnership Proposal, Executive Dashboard, Investor Deck). Text extracts for reading/grepping: `docs/company/source/text/`. **Never edit or overwrite files in `docs/company/source/`**; write revisions as new, dated files elsewhere.
- Use the re-baselined dates in `00_EXECUTIVE_PLAN.md` (base / downside). Respect the Swiss club calendar: dead fortnight ~21 Dec - 4 Jan; committees decide Jan-Apr; summer-camp registration opens ~March; season registration peaks Jun-Sep.

## 3. Stack and architecture map

Next.js 15 App Router, React 19, TypeScript, Tailwind 3, Supabase (Postgres, RLS, auth, storage), Stripe, Swiss QR-bill (pdf-lib + qrcode), Resend email, AI assistant module, zod validation.

| Path | Purpose |
|---|---|
| `middleware.ts` | Session refresh and auth gate (public: `/`, `/login`, `/auth`, `/register`) |
| `src/app/(auth)`, `src/app/auth` | Login and auth callbacks |
| `src/app/(admin)/admin/*` | Admin/finance: dashboard, programs, athletes, families, registrations, invoices, payments, credits, attendance, bookings, availability, services, notifications, documents, consents, invitations, export, settings, assistant |
| `src/app/(coach)/coach/*` | Coach (mobile first): sessions, attendance |
| `src/app/(parent)/parent/*` | Parent app: children, invoices, bookings, documents |
| `src/app/register/[programSlug]` | Public registration |
| `src/app/onboarding` | New user / org onboarding |
| `src/app/api/stripe/webhook` | Stripe webhook (signature-verified) |
| `src/lib/data/*` | Server-side reads |
| `src/lib/actions/*` | Server actions (mutations, zod-validated) |
| `src/lib/supabase/*` | Clients: `server.ts`, `client.ts`, `middleware.ts`, `admin.ts` (service role, server only) |
| `src/lib/auth/*` | `get-user`, `roles`, `invitations`, `onboarding` |
| `src/lib/stripe.ts`, `swiss-payments.ts`, `invoice-pdf*.ts` | Payments and QR-bill |
| `src/lib/email`, `src/lib/notifications` | Resend email and notification dispatch/templates |
| `src/lib/ai` | AI assistant client, tenant context, prompts |
| `src/components/*` | UI (`ui/` primitives, `layout/` shell, feature folders) |
| `src/types/database.ts` | Generated Supabase types |
| `supabase/migrations/` | Timestamped SQL migrations |
| `testing/rls_test_suite.sql` | RLS tests |
| `docs/design/club-os-v1-prototype.html` | V1 design reference (do not overwrite) |

Roles (`app_role`): `admin`, `finance`, `coach`, `parent`.

## 4. Multi-tenant rules (non-negotiable)

1. Every tenant table has `org_id uuid not null references public.organizations(id)` and RLS enabled, with policies for every verb.
2. Policies use the helpers in `supabase/migrations/20250420090200_functions_rls.sql`: `public.current_org_id()`, `has_role()`, `is_admin()`, `is_finance()`, `current_coach_id()`, `is_guardian_of_family()`, `is_guardian_of_athlete()`, `coach_can_access_athlete()`, etc.
3. **Never trust a client-supplied `org_id`, role or user id.** Tenant resolution is server-side: the authenticated user -> `profiles.org_id` (`current_org_id()`), or for public pages the org that owns the requested slug, or for webhooks the org mapped from the Stripe connected account/metadata. Inserts set `org_id` server-side or are checked with `with check (org_id = public.current_org_id())`.
4. The service-role client (`src/lib/supabase/admin.ts`) bypasses RLS: use it only in server-only code (webhooks, background jobs, onboarding), always filter by `org_id` explicitly, never import it into client components.
5. No per-customer code paths (`if org === 'dlang'`). Differences live in org settings and feature flags.
6. Tests must include a cross-tenant denial case for every new table or policy.

## 5. Migration conventions

- Filename `YYYYMMDDHHMMSS_description.sql`, later than the newest existing file. Never edit a migration that has been applied anywhere; add a new one.
- Additive and idempotent: `if not exists`, `create or replace`, `drop policy if exists` + `create policy`, guarded `do $$` blocks for enum values/constraints. Destructive changes are split into expand -> migrate -> contract across releases.
- New tables: `org_id`, index on `org_id`, RLS + policies, `created_at`/`updated_at`, audit trigger if personal data.
- `security definer` functions set `search_path` and check the caller.
- RLS tests are required with every migration (`testing/`, run via `scripts/db-test.sh` when present).
- Validate locally in your **own throwaway database** (`psql -h localhost -U postgres -c "create database t_<name>"`, Postgres 16, postgres/postgres); stub `auth` schema, `auth.uid()` and roles `anon`/`authenticated`/`service_role` if needed; drop it afterwards. Never touch other databases.
- Regenerate `src/types/database.ts` after schema changes (`npm run types` with a Supabase project) or update it by hand consistently.

## 6. i18n rule

No hard-coded user-facing strings in components, server-action messages, emails, notifications or PDFs. Use the message catalogs and translation helper. Format dates, numbers and money with `Intl` and the org/user locale; take currency from the org or record (never hard-code "CHF"). Terminology (athlete/player/student, programme/team/class) comes from org settings. Swiss launch languages: French, German, then Italian and English.

## 7. Theming rule

Colours, radii, shadows and fonts only via CSS variables defined in `src/app/globals.css` (mapped into `tailwind.config.ts`). No hex literals in components. Tenants override the variables (brand colours, logo); default theme is the V1 prototype "V5 dark luxury": bg `#0A0A0A`/`#121212`/`#1A1A1A`, red `#DA2627`/`#961F1F`/`#321615`, gold `#C19A45`, text `#F1F1F1`; fonts Fraunces (display), Geist (UI), Geist Mono. Check contrast for any tenant palette.

## 8. Security rules for minors' data

- Most athletes are children. Collect the minimum; medical notes, documents and consents are sensitive data.
- Access: admin of the same org and the child's guardians; coaches only what they need for their programmes (`coach_can_access_athlete`). Finance sees billing, not medical data.
- Guardian consent is recorded (version, timestamp, who); media/photo consent is separate. No child photos or full names on public pages without consent.
- Storage buckets private, signed URLs, access audit-logged (`audit_logs`).
- Never put real personal data in code, fixtures, logs, commits, prompts to external services or issues. Synthetic data only in tests.
- AI assistant: tenant-scoped context only; send no more personal data than the task needs; no training on tenant data.
- Laws in scope: Swiss nFADP, EU GDPR, US COPPA (under 13) and FERPA (schools). Ask privacy-compliance-officer.
- Secrets only via env (`src/lib/env.ts`, names in `.env.example`); never commit keys.

## 9. Commands

```
npm install
npm run dev              # local dev server
npx tsc --noEmit         # must pass
npm run build            # must pass
npm run lint
npm test                 # when the test runner is configured
scripts/db-test.sh       # when present: migrations + RLS tests on a throwaway Postgres
npm run types            # regenerate Supabase types (needs SUPABASE_PROJECT_ID)
```

A change is not done until `npx tsc --noEmit` and `npm run build` pass, plus tests for what changed.

## 10. Which agent to use (`.claude/agents/`)

| Task | Agent |
|---|---|
| Architecture, cross-cutting design, plan a big feature | `cto-architect` |
| Spec a feature, prioritise, say no | `product-manager` |
| Pages, components, forms | `frontend-engineer` |
| Tables, migrations, RLS, server data/actions | `backend-db-engineer` |
| Invoices, Stripe, Connect, TWINT, QR-bill, reconciliation | `payments-engineer` |
| Security review of any diff | `security-reviewer` |
| nFADP/GDPR/COPPA/FERPA, consent, retention | `privacy-compliance-officer` |
| Tests, test plans, bug repro | `qa-test-engineer` |
| CI/CD, deploys, monitoring, backups, incidents | `devops-sre` |
| Translations, locale, currency, terminology | `i18n-localization` |
| UX flows, V1 design system, theming tokens | `ux-designer` |
| Support content, health scores, feedback | `customer-success` |
| Positioning, pricing pages, launches, sales assets | `gtm-strategist` |
| Hiring, roles, contractors, equity framing | `hr-people-partner` |
| Model, runway, unit economics, funding | `finance-analyst` |
| Legal templates and questions for counsel (not advice) | `legal-counsel-assistant` |
| Set up a new club tenant, CSV import, go-live | `tenant-onboarding-specialist` |

Usual chain for a feature: product-manager -> cto-architect -> backend-db-engineer / payments-engineer / frontend-engineer (+ ux-designer, i18n-localization) -> qa-test-engineer -> security-reviewer (+ privacy-compliance-officer if personal data) -> founder approval.

## 11. Governance

Humans approve merges to `main`, production deploys, database changes on production, pricing changes, and any legal or privacy document before use. Agents propose; the founder decides. Do not include AI model names or identifiers in code, commits or docs.
