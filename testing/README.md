# Automated quality gate

Implements TESTING_AND_LAUNCH_PLAN.md §2. Everything here runs locally and in
GitHub Actions (`.github/workflows/ci.yml`).

| Command | What it runs | Needs |
|---|---|---|
| `npm run typecheck` | `tsc --noEmit` | — |
| `npm run lint` | `next lint` | — |
| `npm run test:unit` | Vitest, `tests/unit/**/*.test.ts` | — |
| `npm run test:db` | `scripts/db-test.sh`: migrations, seeds, SQL suites | Postgres 16 |
| `npm test` | unit + db | Postgres 16 |
| `npm run test:e2e` | Playwright, `e2e/**/*.spec.ts` | `npm run build` + a browser |

## Unit tests (`tests/unit`)

Pure logic in `src/lib`, no network: Swiss QR-bill (QRR mod-10 check digit,
SCOR/RF ISO 11649, SPC payload layout), CHF/date/time formatting,
`redact()` / `logError()` / `safeError()`, notification `applyVars()` +
every template, transactional email templates, and env validation.
`server-only` is aliased to a no-op stub (`tests/stubs`). The time zone is
pinned to `Europe/Zurich` in `vitest.config.ts`.

Known bugs are written as `it.fails(...)` with a comment explaining the
fix. When the fix lands the test errors ("expected to fail"): turn it into a
normal `it`.

## DB integration (`scripts/db-test.sh`)

1. Creates a throwaway **template** database (unique name, dropped on exit).
2. Installs `testing/supabase_stub.sql`, the Supabase compatibility layer for
   plain Postgres: roles `anon` / `authenticated` / `service_role` (bypasses
   RLS), `auth.users`, `auth.uid()` / `auth.role()` / `auth.jwt()` /
   `auth.email()` read from the GUC `request.jwt.claim.sub` (or the JSON
   `request.jwt.claims`), a `storage` schema stub, and Supabase's default
   privileges on `public`.
3. Applies **every** `supabase/migrations/*.sql` in lexical (timestamp)
   order, then the seeds (see `testing/seed_plan.conf` for placement).
4. Clones a **fresh database per suite** from the template and runs:
   `testing/rls_test_suite.sql`, `supabase/tests/*.sql`, `tests/db/*.sql`.
5. Fails on any `ERROR`, any line starting with `FAIL`, a non-zero psql exit,
   or a suite that printed no `PASS` at all.

Also prints a non-blocking warning when the migrations do **not** apply to an
empty database (today they don't: several migrations contain founding-club
data; see `testing/seed_plan.conf`). `EMPTY_DB_CHECK=strict` makes it
blocking; `EMPTY_DB_CHECK=off` skips it.

Environment: libpq vars, defaulting to `PGHOST=localhost PGPORT=5432
PGUSER=postgres PGPASSWORD=postgres`. Debug with `KEEP_DB=1` (keeps the
databases), `VERBOSE=1` (prints each suite's output), or pass suite paths to
run only those: `bash scripts/db-test.sh tests/db/money_logic.sql`.

### How future migrations are covered automatically

- New files in `supabase/migrations/` are picked up by glob, in timestamp
  order. Nothing to register.
- If a migration needs a Supabase-only object that plain Postgres lacks
  (an extension schema, a `storage` function, another `auth.*` helper),
  extend `testing/supabase_stub.sql`. Never change the migration for the
  test harness.
- `tests/db/tenant_isolation.sql` discovers **every table with an `org_id`
  column** from the catalog. A new tenant table is automatically checked for
  RLS enabled, plus read/update/delete/insert/move isolation across two tenants.
  If its seed data is empty, the suite prints a `NOTE` coverage gap. Add a
  fixture row in its ARRANGE block to fix that.
- Drop new SQL suites into `supabase/tests/` or `tests/db/`. Print
  `PASS — …` / `FAIL — …` lines (query output or `raise notice`), or
  `raise exception 'FAIL: …'`.

### Suites

| Suite | Covers |
|---|---|
| `testing/rls_test_suite.sql` | role × table RLS matrix inside the founding club |
| `supabase/tests/auth_tests.sql` | invite → `handle_new_user` → linking → isolation |
| `tests/db/tenant_isolation.sql` | **multi-tenant isolation**: org A is cloned into org B (all uuids remapped), and every role of both tenants plus `anon` is checked on every org-scoped table |
| `tests/db/money_logic.sql` | QRR reference/check digit (SQL ↔ TS parity), invoice numbering, manual invoices, partial/full/manual/Stripe payments, idempotency, immutability, overdue flagging, credits, cancellation window (24h boundary), staff override |

### Known findings (XFAIL)

Real defects the suites found are tracked rather than hidden. They print
`XFAIL` (non-blocking). `STRICT_KNOWN=1` makes them blocking. When a fix lands
they print `XPASS` so the entry can be removed:

- **Tenant isolation:** staff policies use `is_admin()` / `is_finance()` /
  `has_role()`, which ignore `org_id`, so an admin or finance user of *any*
  tenant can read and write other tenants' families, athletes, medical,
  invoices, payments, documents, and more. Several UPDATE policies let a row
  be re-homed into another org. `profiles_update_self` lets any user change
  their own `org_id` (tenant hop). List and fix plan:
  `tenant_test.known` in `tests/db/tenant_isolation.sql`.
- **Invoice numbering:** `next_invoice_number` uses `lpad(counter, 4)`, which
  *truncates* counters at or above 10000 (`10000` → `1000`), creating duplicates.
- **Overpayment** is not flagged or credited (plan §4).
- **Log redaction:** `redact()` does not mask Stripe keys of the form
  `sk_live_…` / `sk_test_…` / `whsec_…` (`tests/unit/log-redact.test.ts`).

## E2E (`e2e/`, Playwright)

`playwright.config.ts` starts `next start` on port 3100 (run `npm run build`
first), or set `E2E_BASE_URL` to target a deployed preview. Smoke specs check
that the login page renders, that protected routes redirect, that there's no
mobile overflow, and that the public registration page renders.
Backend-dependent specs skip unless `E2E_BACKEND=1` (seeded Supabase,
optional `E2E_PROGRAM_SLUG`). Browsers: `npx playwright install chromium`, or
point `PW_CHROMIUM_PATH` at an existing Chrome/Chromium binary. In CI the
e2e job runs nightly and on manual dispatch.

## CI (`.github/workflows/ci.yml`)

`checks` (lint, typecheck, unit) → `db` (Postgres 16 service container) →
`build` → `quality gate` (aggregate). Non-blocking: `npm audit`. Blocking:
`gitleaks` secret scan. Nightly/manual: Playwright e2e.

Manual setup in GitHub:
- Branch protection on `main`: require the **quality gate** and **secret scan** checks.
- `GITLEAKS_LICENSE` secret, needed only if the repository belongs to a
  GitHub *organization* (free for personal accounts).
