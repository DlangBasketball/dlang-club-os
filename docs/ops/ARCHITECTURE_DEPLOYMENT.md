# Reference architecture — deployment, regions & white-label

Status: **v1, 12 Nov 2026**. Owner: platform / ops. Applies to: DLang Basketball (tenant #1) and every white-label tenant in CH, EU and US.

---

## 1. Principles

1. **Data stays in its region.** A tenant's personal data (families, minors, medical, payments) is stored and processed in exactly one data region. No cross-region replication of personal data.
2. **One code base, one deployment per region.** The same Git commit is deployed to every region. A deployment only knows its own region's database; there is no global database holding tenant data.
3. **Tenant isolation is enforced by the database** (`org_id` on every tenant table + RLS, see `supabase/migrations/20250420090200_functions_rls.sql`), not by the application.
4. **Everything is reproducible from Git + env vars.** Infra is configured by environment variables (`.env.example`) and SQL migrations (`supabase/migrations`). No hand-edited production schema.

## 2. Topology

```
                        DNS (Cloudflare or registrar)
   *.clubos.app  ──CNAME──► cname.vercel-dns.com      club.example.ch ──CNAME──► (same)
                                   │
            ┌──────────────────────┴───────────────────────┐
            ▼                                              ▼
   EU deployment (Vercel project "club-os-eu")     US deployment ("club-os-us")
   functions: fra1 (Frankfurt)                     functions: iad1 (Washington DC)
   DATA_REGION=eu                                  DATA_REGION=us
            │                                              │
            ▼                                              ▼
   Supabase project "club-os-eu-prod"              Supabase project "club-os-us-prod"
   AWS eu-central-1 (Frankfurt)                    AWS us-east-1 (N. Virginia)
   Postgres + Auth + Storage, PITR                 Postgres + Auth + Storage, PITR
   tenants: CH + EU (incl. DLang)                  tenants: US (+ rest of world by choice)

   Optional CH-resident cell: "club-os-ch" (Supabase eu-central-2 Zurich, or self-hosted
   Docker on a Swiss host) for schools/cantons that contractually require Swiss hosting.

   Shared, no personal data:   Platform directory (tenant slug/domain -> region URL)
                               Stripe (Connect platform account per legal entity)
                               Resend (per-tenant sender domains)
                               Error reporting (Sentry EU org for EU cell, US org for US)
```

| Component | EU cell (launch) | US cell | Notes |
|---|---|---|---|
| Web/app | Vercel Pro, region `fra1` | Vercel Pro, region `iad1` | `vercel.json` pins `fra1`; override `regions` in the US project settings. Docker image (`Dockerfile`) is the fallback for self-hosting. |
| Database/Auth/Storage | Supabase Pro, `eu-central-1` | Supabase Pro, `us-east-1` | PITR add-on in production (see BACKUP_DR.md). |
| Payments | Stripe CH entity (CHF, TWINT, cards), Swiss QR-bill | Stripe US account (USD, cards, ACH) | Stripe Connect: each club is a connected account; platform fee via application fee. |
| Email | Resend, EU sending region | Resend, US | Per-tenant verified sender domains (section 6). |
| Errors | Sentry (EU data region) or self-hosted GlitchTip | Sentry (US) | Optional; set `SENTRY_DSN`. |
| Logs | Vercel log drain -> EU log store (e.g. Better Stack EU, Axiom EU) | US log store | Logs are redacted (`src/lib/log.ts`). |

### Why Frankfurt serves Switzerland
Switzerland and the EU recognise each other as adequate (nFADP Annex 1 lists EU/EEA states), so CH tenant data in Frankfurt is lawful under a DPA. Latency Lausanne -> Frankfurt is ~10-15 ms. Clubs or schools that contractually require **Swiss** hosting get the CH cell; it is the same deployment recipe with a different Supabase project.

> **Decision needed before DLang go-live (owner: founder, by 20 Nov 2026).** The 90-day rollout's demo script tells clubs the data is **"Swiss hosted"**, and the business plan lists "Swiss or EU region" hosting as a sales argument. Claims must match reality:
> * **Option A (recommended for CH launch):** put the first production cell in Supabase **Zurich (`eu-central-2`)** — confirm the region is offered for your plan when creating the project — and serve all CH tenants (DLang first) from it. Data at rest is in Switzerland; app functions run in `fra1` (EU, adequate). Say "data stored in Switzerland". Add the Frankfurt EU cell when the first EU tenant signs.
> * **Option B:** single Frankfurt cell for CH + EU (simplest, one project fewer). Then the sales line must become "hosted in the EU (Frankfurt), nFADP-adequate" — not "Swiss hosted".
> Either way the cell is chosen once per tenant and recorded in the platform directory.

## 3. Environments

| | local | staging | production |
|---|---|---|---|
| App | `npm run dev` | Vercel Preview (branch `main`/PRs) + a fixed staging domain | Vercel Production (tags / promoted deploys) |
| Supabase | `supabase start` (Docker) or a personal dev project | `club-os-eu-staging` (Free/Pro, no real data) | `club-os-eu-prod`, `club-os-us-prod` |
| Stripe | test mode | test mode | live mode |
| Email | Resend test key / sandbox domain | Resend, staging domain, internal recipients only | Resend, verified tenant domains |
| `APP_ENV` | `local` | `staging` | `production` |
| Data | seed/fake only | fake + anonymised fixtures only | real |

Rules: **real personal data never leaves production** (no prod dumps into staging; use the anonymised fixtures). Live Stripe keys exist only in production. `scripts/deploy/check-env.mjs` warns if a live key is configured outside production.

## 4. Tenant -> region mapping (region sharding)

Each tenant (organization) has a home `data_region` (`eu` | `us`, optional `ch`) chosen at sign-up from the club's country and contract, and **never changes silently** (a move is a documented migration, see TENANT_ONBOARDING_RUNBOOK.md §9).

* **In each regional database**, `public.organizations` holds only the tenants of that region. (Column `data_region` is added by the tenancy track; until then the region is implicit in which project the org lives in.)
* **Platform directory** — a tiny, personal-data-free registry used only for routing:

  | slug | custom_domain | region | regional_base_url | status |
  |---|---|---|---|---|
  | dlang | app.dlangbasketball.ch | eu | https://eu.clubos.app | live |

  Implementation options, in order of preference:
  1. *Static map in the edge config* (Vercel Edge Config / env JSON) — enough for the first ~50 tenants, zero extra infra.
  2. A small `platform` Supabase project (EU) with one `tenants_directory` table, read with the anon key + RLS `select` on public columns.
* **Request routing:**
  1. `<slug>.clubos.app` or a custom domain hits the regional deployment that owns the domain (each Vercel project only has its own tenants' domains attached, so DNS already routes to the right region).
  2. The app resolves the tenant from the `Host` header (subdomain or custom domain lookup in its own `organizations` table) and scopes the session to that `org_id`.
  3. The marketing site / generic login (`clubos.app/login`) asks for the club, looks up the directory and redirects to the regional URL. No personal data is entered before the redirect.
* **Auth is per region.** A user account lives in the Supabase Auth of the tenant's region. A parent with children in clubs in two regions has two accounts (rare; acceptable).
* **Cross-region platform reporting** (MRR, tenant counts) is built from aggregate, non-personal metrics pushed by each region, never by querying personal tables across regions.

## 5. Domains for white-label

Two levels:

1. **Platform subdomain (default, instant):** `<slug>.clubos.app` (EU) / `<slug>.us.clubos.app` (US). One wildcard DNS record per region: `*.clubos.app CNAME cname.vercel-dns.com` and the wildcard domain added to the Vercel project (requires Vercel nameservers *or* a wildcard cert via DNS-01 — simplest is to delegate `clubos.app` to Vercel DNS).
2. **Custom domain (white-label):** e.g. `app.dlangbasketball.ch`.
   1. Admin enters the domain in Club setup -> Domain.
   2. Platform calls Vercel Domains API `POST /v10/projects/{VERCEL_PROJECT_ID}/domains` (`VERCEL_API_TOKEN`, `VERCEL_TEAM_ID`).
   3. UI shows the records to create: `CNAME app -> cname.vercel-dns.com` (subdomain) or `A @ -> 76.76.21.21` (apex), plus the `TXT _vercel` verification record if Vercel returns one.
   4. Platform polls `GET /v9/projects/{id}/domains/{domain}` and `POST .../verify` until `verified: true`; Vercel issues the TLS certificate automatically.
   5. Store `custom_domain` + `domain_verified_at` on the organization; update the platform directory.
   6. Auth: add `https://app.dlangbasketball.ch/auth/callback` to Supabase Auth -> URL configuration -> Redirect URLs (scriptable via the Management API).
   Self-hosted (Docker) alternative: Caddy or Traefik with on-demand TLS, allow-listed against the directory.

## 6. Email per tenant (Resend)

* Default sender: `"<Club name> <no-reply@mail.clubos.app>"` with `Reply-To` = club contact. Works on day one, no club DNS changes.
* White-label sender: club adds domain `mail.dlangbasketball.ch` in Club setup -> Email. Platform calls Resend `POST /domains` (region `eu-west-1` for EU tenants, `us-east-1` for US) and shows the DNS records to add:
  * **SPF**: `TXT send.mail.<domain>  "v=spf1 include:amazonses.com ~all"` (exact value from Resend response)
  * **DKIM**: `TXT resend._domainkey.mail.<domain>` (public key from Resend)
  * **MX** for the bounce subdomain (from Resend)
  * **DMARC** (club's responsibility, recommended): `TXT _dmarc.<domain> "v=DMARC1; p=quarantine; rua=mailto:dmarc@<domain>"`
* Poll `GET /domains/{id}` until `verified`; then set the tenant's `email_from`. Until verified, mail keeps using the platform sender. Today the code reads one global `RESEND_FROM` (`src/lib/email/resend.ts`); the per-tenant sender is a follow-up for the tenancy/branding track.

## 7. Configuration & secrets

* Every variable is documented in `.env.example`; validated by `src/lib/observability/env-check.ts` (zod, non-throwing, safe at build time) and by `node scripts/deploy/check-env.mjs <file>` in CI before a deploy.
* `NEXT_PUBLIC_*` values are inlined at build time -> one build per region (Vercel does this automatically per project; Docker needs one image per region).
* Secrets live only in the Vercel project env (or the Docker host's secret store). Never in Git, never in build args.
* Rotation: see ONCALL.md §5.

## 8. Observability

* `GET /api/health?probe=live` — liveness (no I/O). `GET /api/health` — readiness (Postgres round-trip + config check); 503 if the database is unreachable. Excluded from auth middleware. With `Authorization: Bearer $HEALTH_CHECK_TOKEN` it also lists missing/invalid variable *names*.
* Structured JSON logs with PII redaction: `src/lib/observability/logger.ts`.
* Errors: `captureException()` in `src/lib/observability/error-reporting.ts`; all unhandled server errors flow there via `src/instrumentation.ts` (`onRequestError`). Sends to any Sentry-compatible DSN over HTTP when `SENTRY_DSN` is set; no SDK dependency.
* Uptime: an external monitor (Better Stack / UptimeRobot, EU location) hits `/api/health` every minute per region and pages on-call (ONCALL.md).

## 9. Capacity assumptions (first 12 months)

| | Year-1 target | Sizing |
|---|---|---|
| Tenants | 5-15 clubs, all CH/EU | 1 EU cell is enough; US cell provisioned only when the first US contract is signed |
| Active users | < 5'000 parents/coaches | Supabase Pro (Small compute) |
| Peak | season-start registration evenings (~200 concurrent) | Vercel serverless scales; DB connections via Supabase pooler |
| Storage | documents & consent PDFs, < 20 GB | Supabase Storage, same region |

Revisit when any of: > 30 tenants, DB CPU > 60 % sustained, p95 page > 1.5 s.
