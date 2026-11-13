# Pre-Launch Security Testing Checklist — DLang Basketball Club OS

Complete every item before opening to real customers. This app handles minors'
data, so treat any unchecked box as a launch blocker. Test with **four real test
accounts** (admin, finance, coach, parent) plus one anonymous (logged-out) client.

## A. Access control / RLS (test as each role)
- [ ] **Parent** can see ONLY their own family, athletes, invoices, documents, attendance, notifications.
- [ ] **Parent** gets zero rows when querying another family's athlete / invoice / medical record (try by guessing an id).
- [ ] **Coach** can see ONLY assigned athletes/sessions; cannot see unassigned athletes.
- [ ] **Coach** sees **zero** rows from `athlete_medical`, `invoices`, `payments`.
- [ ] **Finance** can see all invoices/payments but **cannot** change club settings.
- [ ] **Admin** access is correct and is the only role that can reach Settings.
- [ ] **Anonymous** (logged out) can reach only public pages (`/login`, `/register/*`, `/auth/*`) and the public registration flow — nothing else.
- [ ] Direct API/PostgREST calls with a parent JWT cannot read another tenant's/family's rows (RLS holds outside the UI too).
- [ ] Confirm `service_role` key is absent from the client bundle (`grep -r service_role .next/static` returns nothing).

## B. Medical & sensitive data
- [ ] Coaches never receive medical notes anywhere in the UI or API.
- [ ] Private coach/attendance notes never appear in any parent-facing view.
- [ ] Medical writes by guardians are recorded in `audit_logs`.

## C. Financial integrity
- [ ] Recorded payments cannot be edited or deleted (immutability trigger).
- [ ] Invoice numbers are unique and monotonic; changing the counter never reuses a number.
- [ ] Parents cannot mark their own invoices paid or alter amounts.

## D. Consent records
- [ ] A new acceptance stores: timestamp, IP, user (when authenticated), form version, and the **exact text snapshot**.
- [ ] Acceptances cannot be edited or deleted by any role (verify a guardian and an admin both fail; verify a privileged/service path is blocked by the trigger).
- [ ] Withdrawing consent flips status to `withdrawn` and keeps the original snapshot.
- [ ] Required consents are enforced during registration (submission blocked until accepted).

## E. Files / storage
- [ ] The `documents` bucket is **private** (no public read).
- [ ] Document URLs are short-lived signed URLs; an expired/old URL returns 403.
- [ ] A parent cannot download another family's document by changing the id (server re-checks RLS before signing).
- [ ] Uploads/deletes are admin-only and appear in the audit log.

## F. Privacy / GDPR / FADP
- [ ] Parent "Download my data" returns only that family's data and nothing else.
- [ ] A parent can submit a deletion request only for their own family.
- [ ] Admin approval anonymises PII and **retains** financial records; the action is audited.
- [ ] Data retention period is configured and a purge process exists for expired inactive records.
- [ ] Privacy policy / consent wording is current and legally reviewed.

## G. Audit & monitoring
- [ ] Sensitive changes (invoices, payments, registrations, medical, consent, documents, settings, erasure) all produce audit rows.
- [ ] `audit_logs` cannot be modified or deleted by any application role.
- [ ] Error monitoring is connected (e.g. Sentry) and receives only **redacted** payloads.

## H. Secrets & configuration
- [ ] `assertServerEnv()` passes in production; app refuses to boot without required secrets.
- [ ] No secret is exposed via any `NEXT_PUBLIC_*` variable.
- [ ] `.env*` files are git-ignored and absent from the repo history.
- [ ] Production secrets live only in the host secret store; rotated on offboarding.
- [ ] Stripe & Resend keys are **live** keys scoped to least privilege; webhooks verify signatures.

## I. Transport & platform
- [ ] HTTPS enforced everywhere (HSTS); no mixed content.
- [ ] Supabase project: RLS on for every table; anon key has no elevated grants.
- [ ] Auth: email confirmation on; password policy set; session expiry sensible; rate-limiting/Captcha on auth endpoints.
- [ ] CORS / allowed redirect URLs restricted to known domains.
- [ ] Security headers set (CSP, X-Frame-Options/`frame-ancestors`, Referrer-Policy).

## J. Backup & recovery
- [ ] Daily backups + PITR enabled on the production database.
- [ ] Nightly encrypted off-platform dump to EU/CH storage with restricted access.
- [ ] A **test restore** has been performed successfully.

## K. Application hardening
- [ ] All server actions validate input (zod) and re-check the caller's role server-side (never trust the client).
- [ ] No raw SQL string interpolation; all queries parameterised / via the typed client.
- [ ] File-upload size/type limits enforced.
- [ ] Dependencies audited (`npm audit`) with no known high/critical issues.
- [ ] Generic error messages to users; detailed (redacted) logs server-side only.

## L. Operational / legal
- [ ] Data Processing Agreement in place with Supabase/Vercel/Stripe/Resend; data residency confirmed (EU/CH).
- [ ] Roles for handling subject-access and erasure requests assigned; SLA defined.
- [ ] Incident-response and breach-notification plan documented (FADP/GDPR timelines).
- [ ] Least-privilege review of who holds the admin role and the service-role key.

---
**Sign-off:** Security reviewer ______________  Date __________  ☐ Cleared for launch
