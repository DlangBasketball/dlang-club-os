# BACKUP & DISASTER RECOVERY

## 1. Targets

| Tier | What | RPO (max data loss) | RTO (max downtime) |
|---|---|---|---|
| Database (Postgres: all tenant data) | per regional Supabase project | **<= 5 min** with PITR (WAL archiving; typically ~2 min) | **<= 4 h** to a restored, verified project |
| Auth users | part of the same project (auth schema) | same as DB | same as DB |
| File storage (documents, consent PDFs) | Supabase Storage, same region | <= 24 h (nightly copy) | <= 8 h |
| App tier | Vercel / Docker image | 0 (rebuild from Git) | <= 30 min (redeploy / rollback) |
| Configuration | env vars in Vercel / secret store | 0 (documented in `.env.example`, values in the password manager) | <= 1 h |

These targets assume Supabase **Pro + PITR add-on** in production. Without PITR, Supabase Pro keeps daily backups for 7 days, i.e. RPO up to 24 h — not acceptable for payment and consent records once real clubs are live. Budget: PITR (7-day retention) is roughly USD 100/month per project; include it in the hosting line of the financial model (currently CHF 8/club/month, which only covers it from ~12+ clubs per cell).

## 2. Backup layers

1. **Supabase PITR** (primary) — continuous, 7-day window, restores to any second. Same region as the data.
2. **Supabase daily backups** — included, 7-day (Pro) retention.
3. **Independent nightly logical backup** (defence against account loss / provider incident / ransomware):
   ```bash
   pg_dump "$DB_URL_DIRECT" --format=custom --no-owner --no-privileges \
     --schema=public --schema=auth --schema=storage -f club-os-$(date -u +%F).dump
   age -r "$BACKUP_PUBLIC_KEY" -o club-os-$(date -u +%F).dump.age club-os-$(date -u +%F).dump
   ```
   Upload to an object store **in the same jurisdiction** (CH data -> Swiss provider bucket; EU data -> EU bucket; US -> US), versioned, object-lock 30 days, separate credentials from production. Run from a scheduled CI job or a small cron container. Retention: 30 daily, 12 monthly. The private decryption key is held offline by two named people.
4. **Storage objects**: nightly `rclone sync` of the Supabase Storage buckets to the same backup bucket.
5. **Code & migrations**: Git (GitHub) + a weekly mirror.

Retention vs. erasure: deletion requests (GDPR art. 17 / nFADP) are executed in production immediately; backups age out within 30 days (12-month monthlies contain only aggregated, non-personal exports — or are excluded if that cannot be guaranteed). State this in the privacy notice.

## 3. Restore drills

* **Before DLang go-live (by 4 Dec 2026)**, then **quarterly** (first week of Mar, Jun, Sep, Dec): restore PITR to a *new* project, run `testing/rls_test_suite.sql`, count rows in key tables against production, time the whole exercise. Record RTO achieved in `docs/ops/CHANGELOG.md`.
* Annually: restore from the independent logical backup into an empty Postgres to prove it works without Supabase.

## 4. Scenarios

| Scenario | Action |
|---|---|
| Bad deploy (app) | Vercel Instant Rollback / previous Docker tag. No data action. |
| Bad migration or bulk mistake (e.g. wrong CSV import) | Small: corrective SQL / delete the import batch (the importer only creates rows it can identify by id). Large: PITR-restore to a **new** project at T-1 min, copy back affected rows by `org_id`, verify with the club. |
| Tenant asks to restore their own data | Same as above, scoped to one `org_id`. Never roll back other tenants. |
| Supabase region outage | Status page + comms (INCIDENT_RESPONSE.md). Wait if ETA < RTO. Otherwise restore the latest logical backup / PITR into a new project in an **allowed** region (CH/EU data stays in CH/EU), repoint env vars, redeploy. |
| Account compromise / ransomware | Incident SEV1. Revoke keys, restore from the independent encrypted backup into a fresh account. |
| Vercel outage | Deploy the Docker image to the standby host (documented in DEPLOY.md §3), switch DNS (TTL 300 s on app records). |

## 5. What to verify after any restore

1. `/api/health` ok. 2. RLS suite PASS. 3. Row counts per `org_id` for families, athletes, invoices, payments. 4. Latest Stripe payments reconcile with invoices (replay webhooks from the Stripe dashboard for the gap window — the webhook handler is idempotent). 5. Auth: a test admin and a test parent can sign in.
