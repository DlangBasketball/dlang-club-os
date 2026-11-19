# MIGRATIONS — zero-downtime schema change policy

Applies to every file in `supabase/migrations/`. One schema, many regions: every migration is applied to **every** regional project (EU, CH, US) — a region must never run a different schema version for longer than a deploy window.

## 1. Rules

1. **Forward-only, timestamped files.** `YYYYMMDDHHMMSS_short_name.sql`. Never edit a migration that has been applied to staging or production; write a new one.
2. **Expand -> migrate -> contract.** Each schema change ships in up to three releases:
   * *Expand* (migration only, backward compatible): add nullable columns / new tables / new enum values / new functions. Old code keeps working.
   * *Migrate* (code release): code writes both old and new shape, reads new; backfill in batches.
   * *Contract* (migration, >= 1 release later): drop old columns, add `NOT NULL`, remove old functions.
3. **Code may assume a migration only after it ran in all regions.** Deploy order is always DB first, then app.
4. **Every new tenant table**: `org_id uuid not null references public.organizations(id) on delete cascade`, an index on `org_id`, `enable row level security`, policies using the helpers in `20250420090200_functions_rls.sql`, and an `updated_at` trigger. Add a case to `testing/rls_test_suite.sql` in the same PR.
5. **No secrets or tenant data in migrations.** Seed/reference data only.

## 2. Lock-safe patterns (Postgres 15/16)

| Change | Do | Don't |
|---|---|---|
| Add column | `add column x text` (nullable, or with a constant default — metadata-only) | add `NOT NULL` without default on a big table |
| Make NOT NULL | add `check (x is not null) not valid`; `validate constraint`; then `set not null` | `set not null` directly on a large table |
| Index | `create index concurrently` (own migration file, no transaction) | plain `create index` on hot tables |
| Foreign key | `add constraint … not valid`, then `validate constraint` | validating in the same statement on large tables |
| Rename column/table | add new + dual-write + backfill + drop old later | `rename` (breaks running code) |
| Enum value | `alter type … add value` (own migration; cannot be used in the same transaction) | removing enum values |
| Backfill | batches of 1-5k rows by primary key, outside peak hours | one `update` over the whole table |
| RLS policy change | create the new policy, then drop the old one, in one migration | a window with RLS disabled |

Always start long-running migrations with `set lock_timeout = '3s'; set statement_timeout = '60s';` so a blocked migration fails fast instead of queuing all traffic behind it. Retry later.

## 3. Procedure

1. **Local**: `supabase db reset` (applies all migrations from zero) + run the RLS suite.
2. **PR review**: reviewer checks the table above, RLS, and that the code in the same PR works with both old and new schema.
3. **Staging**: `supabase db push` to staging -> `psql … -f testing/rls_test_suite.sql` -> smoke test.
4. **Production, per region** (EU/CH first, US second):
   * Confirm a PITR restore point exists (timestamp noted in the deploy log) — BACKUP_DR.md.
   * `supabase db push --dry-run`, then `supabase db push`.
   * Deploy the app. Smoke test. Watch errors 15 min.
5. **Record** in `docs/ops/CHANGELOG.md`: date, migration ids, regions, operator.

## 4. Rollback

* App problems: Vercel Instant Rollback (the schema is backward compatible by rule 2).
* Bad migration (data damaged): write a corrective forward migration. Only if data is lost, restore with PITR to a new project and copy back the affected rows (BACKUP_DR.md §4). Never restore a whole production database over live data without an incident commander decision.

## 5. Drift control

* Never change schema from the Supabase dashboard in staging/production. If it happens, capture it with `supabase db diff` into a migration immediately.
* Monthly: `supabase db diff --linked` against each regional project must be empty.
* Regenerate types after schema changes: `npm run types` (writes `src/types/database.ts`).
