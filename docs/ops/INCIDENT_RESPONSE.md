# INCIDENT RESPONSE

Covers availability incidents and **personal-data breaches** (any accidental or unlawful destruction, loss, alteration, unauthorised disclosure of, or access to personal data). Children's and health data are involved: treat every suspected breach as real until disproven.

## 1. Roles

| Role | Who (until the team grows) | Duty |
|---|---|---|
| Incident commander (IC) | On-call engineer, escalates to founder for SEV1 | Owns the timeline and decisions; nobody else changes production |
| Communications | Founder | Club admins, parents (via the club), authorities |
| Privacy lead | Founder (later: DPO/advisor) | Breach assessment, notifications, record |
| Scribe | Anyone available | Timestamped log in the incident doc |

## 2. Severity

| SEV | Examples | Response |
|---|---|---|
| **1** | Cross-tenant data exposure; medical/consent data leaked; production DB down; payments double-charging; credentials leaked | Page immediately, 24/7. Founder informed within 30 min. |
| **2** | Major feature down for a tenant (registration, payments, login); error rate > 5 %; suspected but unconfirmed breach | Page in business hours (08-22 CET), ack 30 min. |
| **3** | Degraded performance, single-user bug with a workaround | Next business day. |
| **4** | Cosmetic | Backlog. |

## 3. First 60 minutes (any SEV1/2)

1. **Acknowledge** the page; open an incident doc (`YYYY-MM-DD-short-name`), start the timeline (UTC).
2. **Stabilise**: roll back the last deploy if it correlates (Vercel Instant Rollback); disable the affected feature; for suspected data exposure, **contain first**: revoke the leaked key (Supabase service role, Stripe, Resend), rotate secrets (ONCALL.md §5), block the route.
3. **Preserve evidence**: export relevant logs (Vercel, Supabase `audit_logs`, Postgres logs, Sentry events) before retention expires. Don't delete anything.
4. **Assess**: which tenants (`org_id`), which data categories (minors, medical, financial), how many people, since when, is it ongoing?
5. **Decide** whether this is a personal-data breach (§4). If unsure, it is — start the clock.
6. **Status update** to affected club admins within 2 h for SEV1 (template §6).

## 4. Personal-data breach — notification duties

The **club is the controller**; the platform (DLang Sports OS) is the **processor**. The DPA with each club governs this.

| Duty | Who | Deadline | Rule |
|---|---|---|---|
| Notify the club (controller) | Platform | **Without undue delay; contractual target 24 h** from awareness | GDPR art. 33(2); nFADP art. 24(3); DPA |
| Notify the EU supervisory authority | Club (platform drafts) | **72 h** from the controller's awareness, unless unlikely to result in risk | GDPR art. 33 — for EU tenants (and CH tenants whose data subjects are in the EU) |
| Notify the **FDPIC** (Swiss Federal Data Protection and Information Commissioner) | Club (platform drafts) | **As soon as possible** when the breach is likely to result in a **high risk** to the persons concerned | nFADP art. 24(1); online form on edoeb.admin.ch |
| Inform the data subjects (parents/guardians) | Club, with platform support | Without undue delay when **high risk** (GDPR art. 34) / when needed for their protection or requested by FDPIC (nFADP art. 24(4)) | Health data of minors usually = high risk |
| US tenants | Club + platform counsel | State breach laws vary (commonly 30-60 days; some require AG notice); COPPA for under-13s | Assess per state of residence |
| Stripe / card data | Platform | Immediately, to Stripe | Card data never touches our servers (Stripe hosted) — confirm |

Practical rule: **platform tells the club within 24 h, with a pre-filled authority notification**, so the club can meet the 72 h deadline. If the platform itself is controller (e.g. its own sales CRM data), it notifies directly.

Breach record (keep even if no notification is required — GDPR art. 33(5), nFADP): facts, effects, data categories, number of people, measures taken, notification decisions and reasons. Store in `incidents/` in the company drive (restricted), retained 2+ years.

## 5. After the incident

* Postmortem within 5 business days, blameless: timeline, root cause, what detected it, what made it worse, actions with owners and dates.
* Add a regression test (RLS suite case for any isolation issue).
* Update this runbook if a step was missing.
* Log the incident in `docs/ops/CHANGELOG.md` (no personal data in Git).

## 6. Templates

**Club admin, first notice (SEV1/2):**
> Subject: [Service incident] <short description> — <date>
> We are investigating an issue affecting <feature> for <club>. Started: <time CET>. Impact: <what users see>. Your data: <no indication of exposure | we are assessing whether personal data is affected and will update you by <time>>. Next update: <time>. Contact: <phone/email>.

**Club admin, breach notice (processor -> controller):**
> What happened / when discovered / categories of data and approximate number of persons / likely consequences / measures taken and proposed / contact point. Attached: draft notification for <FDPIC | supervisory authority>, draft message to parents.

## 7. Useful queries

```sql
-- Who accessed/changed what (audit trigger)
select * from public.audit_logs where org_id = '<org>' and created_at > now() - interval '7 days' order by created_at desc;
-- Rows visible across tenants should be impossible: run testing/rls_test_suite.sql on a restored copy
```
