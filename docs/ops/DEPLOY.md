# DEPLOY — go-live runbook (DLang first, then new tenants)

Status: **v1, 12 Nov 2026** (rollout week 12, "Harden and document"). Read with ARCHITECTURE_DEPLOYMENT.md. Every date below is a *target*; if a gate fails, the date moves — the gate does not.

---

## 0. Realistic timeline

Today is Thursday 12 Nov 2026. The code builds and type-checks, but nothing is deployed to production yet, the RLS suite has not been run against a real Supabase project, and the auth middleware is not active (see §6 known blockers). Working backwards from what has to be true before real children's data goes in, these are the dates that hold up:

| # | Window | Milestone | Exit gate (all must be true) |
|---|---|---|---|
| 1 | **16 - 22 Nov 2026** (rollout W13) | **Staging live** (EU staging Supabase + Vercel preview on a fixed staging domain) | All 16 migrations apply cleanly from zero; `testing/rls_test_suite.sql` green; `scripts/deploy/smoke-test.sh` green; middleware fix merged. |
| 2 | **23 Nov - 4 Dec 2026** | **Production provisioned & hardened** | Supabase Pro + PITR on; Vercel Pro project; Resend domain verified (SPF/DKIM); Stripe live account approved with TWINT enabled (allow 3-10 business days for Stripe review); Sentry + uptime monitor paging; restore drill done once (BACKUP_DR.md); all critical/high security findings closed. |
| 3 | **by 4 Dec 2026** | **Compliance gate** | Record of processing (ROPA), DPIA and the DLang DPA signed and filed; privacy notice live in FR/DE/EN (IT can follow). *Rollout rule 4: no real club data before these exist.* |
| 4 | **7 - 18 Dec 2026** | **DLang data in production, parallel run** | Roster imported with the CSV importer (dry run on staging first); athlete count matches the club's own list exactly; coaches trained (30 min, on their phones); 5 friendly parents complete onboarding + one real TWINT payment end-to-end. Old tools stay the source of truth. |
| - | **19 Dec 2026 - 4 Jan 2027** | **Change freeze** (Vaud school holidays; volunteer admins unavailable) | Only SEV1/SEV2 fixes. On-call stays staffed (reduced). |
| 5 | **Tue 5 - Fri 8 Jan 2027** | **DLang cutover** | All parents invited in one batch; spring-term invoices issued from the platform; old spreadsheets set read-only. |
| 6 | **11 Jan - 5 Feb 2027** | **Hypercare** (4 weeks) | Health/errors reviewed twice daily; support log triaged daily; first full reminder cycle measured (francs outstanding before/after). |
| 7 | **Feb - Mar 2027** | **Founding clubs #2 and #3 (CH)** onboarded with TENANT_ONBOARDING_RUNBOOK.md | Each club live in <= 3 weeks elapsed and <= 5 founder hours (rollout W12 target). |
| 8 | **Q2 2027** (earliest) | **First EU tenant** | Frankfurt cell (if Option A was chosen), EU VAT/OSS invoicing handled, DE/FR/EN locale complete, EU DPA template. |
| 9 | **Q3 2027** (earliest, only with a signed US contract) | **US cell** | US legal entity or Stripe US account, COPPA review (users under 13), state privacy/breach-law review, USD pricing & sales-tax handling, US on-call coverage. |

Why not faster: Stripe live + TWINT approval, DNS propagation for custom domains/email, and DPA signature are external dependencies with multi-day lead times; the Christmas holidays remove two weeks of club availability; and running a real season start through a system with an inactive middleware and an unexecuted RLS suite is not acceptable risk for minors' data. Why not slower: the financial model already assumes the first paying club in Nov 2026 and two live clubs by year-end — this plan has DLang live in early January, i.e. roughly the 4-6 week slip the rollout document anticipates.

---

## 1. One-time platform setup (do once per region)

1. **Accounts** (company email, 2FA, at least two owners each): Vercel (Pro, team), Supabase (Pro org), Stripe, Resend, Sentry (EU data region), uptime monitor, DNS provider. Store recovery codes in the company password manager.
2. **Supabase projects**: `club-os-eu-staging`, `club-os-<cell>-prod` (region per ARCHITECTURE §2 decision). In prod: enable PITR add-on, set a strong DB password, restrict network access to the pooler if possible, enable "leaked password protection", set Auth Site URL + Redirect URLs (`https://<domain>/auth/callback`). Configure custom SMTP for Auth emails (Resend SMTP) — the built-in Supabase mailer is rate-limited to a few emails per hour and will break batch invitations.
3. **Vercel project** `club-os-eu` linked to the Git repo. Production branch: `main`. Settings -> Functions region: `fra1` (also pinned in `vercel.json`). For the US project set `iad1` in project settings.
4. **Environment variables** — per environment (Preview = staging, Production = prod) from `.env.example`. Validate the file before pasting:
   ```bash
   APP_ENV=production node scripts/deploy/check-env.mjs .env.production   # must print OK
   ```
5. **Stripe**: live account, business details, TWINT payment method activated (CH), webhook endpoint `https://<domain>/api/stripe/webhook` with the events the payments track lists; copy `whsec_…` into `STRIPE_WEBHOOK_SECRET`.
6. **Resend**: add and verify the platform sending domain (SPF/DKIM records from the Resend dashboard); set `RESEND_FROM`.
7. **Monitoring**: uptime checks on `/api/health` (1 min, EU probe locations) and `/login`; Sentry DSN in `SENTRY_DSN`; Vercel log drain to the EU log store. Verify a test alert reaches the on-call phone (ONCALL.md).

## 2. Database migrations (every deploy that includes `supabase/migrations/*`)

Follow MIGRATIONS.md. Short version:
```bash
supabase link --project-ref <ref>
supabase db push --dry-run          # review the SQL list
supabase db push                    # staging first, then production
psql "$STAGING_DB_URL" -f testing/rls_test_suite.sql   # staging only, must be all PASS
```
Order: migrate **before** deploying code that needs the new schema (expand -> deploy -> contract).

## 3. Deploying the app

### Vercel (default)
1. Merge to `main` -> Preview deploy -> runs against staging.
2. `scripts/deploy/smoke-test.sh https://<staging-domain> $HEALTH_CHECK_TOKEN`
3. Promote to production (Vercel dashboard "Promote" or `vercel promote <url>`), or deploy a tag.
4. `scripts/deploy/smoke-test.sh https://<prod-domain> $HEALTH_CHECK_TOKEN`
5. Watch Sentry + `/api/health` for 15 minutes. Roll back with Vercel "Instant Rollback" if error rate rises (no DB rollback needed if MIGRATIONS.md was followed).

### Docker (self-hosted / CH cell)
```bash
docker build \
  --build-arg NEXT_PUBLIC_SUPABASE_URL=… --build-arg NEXT_PUBLIC_SUPABASE_ANON_KEY=… \
  --build-arg NEXT_PUBLIC_SITE_URL=https://app.example.ch \
  --build-arg APP_VERSION=$(git describe --tags --always) --build-arg GIT_SHA=$(git rev-parse HEAD) \
  -t registry.example.ch/club-os:$(git rev-parse --short HEAD) .
docker run -d --restart=always --env-file /etc/club-os/prod.env -p 127.0.0.1:3000:3000 registry.example.ch/club-os:<sha>
```
Put a TLS reverse proxy (Caddy/Traefik) in front; it must set the security headers listed in `vercel.json`. Run two containers behind the proxy for zero-downtime rolling restarts. The image has a `HEALTHCHECK` on `/api/health?probe=live`.

## 4. DLang go-live checklist (milestones 4-5)

- [ ] Organization row for DLang exists in prod (name, slug `dlang`, country CH, currency CHF); first admin invited and signed in.
- [ ] Branding, venues, billing & tax (QR-IBAN, VAT status), notification templates set in Settings.
- [ ] Programs for spring term created with correct prices and dates.
- [ ] CSV import: dry run on **staging** with the real file -> fix errors -> dry run on **prod** -> import (Admin -> Import). Do **not** tick "email invitations" yet.
- [ ] Reconcile counts with the club: families, athletes, guardians. Sign-off by the club director in writing.
- [ ] Consent forms published; privacy notice linked from registration.
- [ ] Coaches invited and trained; each takes attendance for one real session.
- [ ] Friendly-parent pilot (5 families): invite -> onboarding -> registration -> invoice -> TWINT payment -> reconciled automatically.
- [ ] Cutover day: send invitations in batches of <= 100/hour (Auth SMTP limits), announce by the club's usual channel first, staff the support inbox.
- [ ] Day +1, +7: review support log, health, errors, payment reconciliation.

## 5. Every subsequent tenant
Use TENANT_ONBOARDING_RUNBOOK.md. A new tenant does **not** need a deploy: it is data (organization row, domain, branding, Stripe Connect account, import).

## 6. Known blockers to clear before production (status 12 Nov 2026)

1. **Auth middleware is not executed.** `middleware.ts` sits at the repo root, but the app uses `src/app`; Next.js only picks up `src/middleware.ts` in that layout (build output shows an empty middleware manifest). Page access is still guarded by `requireRole()` in layouts and by RLS, but Supabase session cookies are not refreshed and signed-out redirects happen only in layouts. Fix: move the file to `src/middleware.ts` (integrator; touches the tenancy track's routing). The matcher already excludes `/api/health` and `/api/stripe/webhook` so machine callers are not redirected to `/login` once it is active.
2. **AI model default** in `src/lib/env.ts` is hard-coded; move it to configuration (`ANTHROPIC_MODEL`) per policy.
3. `RESEND_FROM` vs `RESEND_FROM_EMAIL`: the code reads `RESEND_FROM`; both are in `.env.example` — set `RESEND_FROM`.
4. RLS suite has only been run against plain Postgres stubs; it must pass on the staging Supabase project (milestone 1 gate).
