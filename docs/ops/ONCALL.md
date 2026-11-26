# ON-CALL

## 1. Coverage (realistic for a 1-3 person team)

| Period | Coverage | Notes |
|---|---|---|
| Until the first engineering hire / CTO partner | Founder primary; external freelance backup on retainer for SEV1 | Be explicit with clubs: support hours Mon-Fri 08:00-20:00 CET, SEV1 24/7 best effort |
| With 2 engineers | Weekly rotation, Monday 09:00 CET handover | Secondary = the other engineer |
| US cell live | Add US-hours coverage (contractor or follow-the-sun) before the first US tenant goes live | Not before Q3 2027 |

Peak-risk windows needing an explicitly staffed on-call: season starts (mid-Aug to end-Sep), registration openings announced by clubs, January term start, invoice/reminder batch days.

## 2. Alerts -> pager

| Signal | Source | Threshold | SEV |
|---|---|---|---|
| `/api/health` not 200 / `status: down` | Uptime monitor, 1-min checks, 2 locations | 2 consecutive failures | 1 |
| `/api/health` `status: degraded` | Uptime monitor (keyword) | 10 min | 3 |
| Error rate | Sentry | > 20 events/5 min or new issue in payments/auth/import | 2 |
| Stripe webhook failures | Stripe dashboard alerts | any failed delivery > 1 h | 2 |
| Email bounces/complaints | Resend | complaint rate > 0.1 % or bounce > 4 % | 3 |
| DB resources | Supabase reports | CPU > 80 % 15 min, disk > 80 %, connections > 80 % | 2 |
| PITR / backup job | backup job exit code | any failure | 2 (next business day) |

Escalation: ack within 15 min (SEV1) / 30 min (SEV2) -> else secondary -> else founder phone.

## 3. Handover checklist (weekly)

- Open incidents and their next steps
- Deploys and migrations planned this week (MIGRATIONS.md)
- Tenants onboarding this week (TENANT_ONBOARDING_RUNBOOK.md)
- Known flaky alerts
- Secrets expiring in the next 30 days

## 4. First checks for any page

```bash
curl -s -H "Authorization: Bearer $HEALTH_CHECK_TOKEN" https://<domain>/api/health | jq
scripts/deploy/smoke-test.sh https://<domain> "$HEALTH_CHECK_TOKEN"
```
Then: Vercel deployments (recent deploy?), Sentry (new issue?), Supabase status page + project reports, Stripe/Resend status pages.

## 5. Secret rotation

| Secret | Rotate | How |
|---|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` | On suspicion; yearly | Supabase -> API -> rotate JWT secret (invalidates anon key too: update `NEXT_PUBLIC_SUPABASE_ANON_KEY`, redeploy all regions in the cell) |
| `STRIPE_SECRET_KEY` | On suspicion; yearly | Roll key in Stripe with expiry overlap, update env, redeploy |
| `STRIPE_WEBHOOK_SECRET` | With endpoint changes | Roll in Stripe, update env |
| `RESEND_API_KEY` | On suspicion; yearly | Create new key, update env, delete old |
| `HEALTH_CHECK_TOKEN`, `VERCEL_API_TOKEN` | On staff change | Regenerate |
| Backup encryption key | Never silently | Re-encrypt policy, two holders |

Every staff departure: rotate everything the person could read, same day.

## 6. Support

Club admins contact support (email/phone in the DPA). Parents contact their club first; clubs escalate. Log every ticket (date, club, category, minutes) — the rollout plan uses this log to choose the next product fixes.
