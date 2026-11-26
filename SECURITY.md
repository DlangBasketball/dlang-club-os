# DLang Basketball Club OS — Security & Data Protection

This app handles **minors, guardian data, medical notes, payments, and consent
records**. Security and Swiss FADP / EU GDPR compliance are treated as first-class
requirements. This document describes the controls in place and how they are
enforced. Each control was validated against a live Postgres instance.

> Defence in depth: every protection is enforced at the **database** layer
> (Row-Level Security + triggers), not just in application code. Even a bug in
> the app cannot bypass these rules, because the database itself refuses the query.

---

## 1. Row-Level Security (RLS)

RLS is **enabled on all 29 tables**, each with explicit policies — no table is
readable or writable without a policy that authorises the specific caller.
`FORCE ROW LEVEL SECURITY` is additionally set on the most sensitive tables
(`athlete_medical`, `consent_acceptances`, `invoices`, `payments`, `documents`,
`profiles`, `families`, `athletes`, `audit_logs`, `deletion_requests`) so that
even the table owner is subject to policy. The server "admin" client uses the
Supabase `service_role` (which has `BYPASSRLS`) and is **only ever imported in
server code** — never shipped to the browser.

Policies are built on a small set of `SECURITY DEFINER` helper functions:
`current_org_id()`, `is_admin()`, `is_finance()` (admin∪finance),
`is_guardian_of_athlete()`, `is_guardian_of_family()`, `coach_can_access_athlete()`,
`coach_leads_attendance_session()`.

## 2. Role-based permissions

Roles come from `staff_roles` (admin / finance / coach); `parent` is derived from
`family_members`. The permission matrix (admin UI → Settings → Staff & roles):

| Area | Admin | Finance | Coach | Parent |
|---|---|---|---|---|
| Club settings | ✓ | — | — | — |
| Invoices & payments | ✓ | ✓ | — | own |
| Families & athletes | ✓ | view | assigned | own |
| Attendance | ✓ | — | own sessions | view own |
| Documents & consents | ✓ | view | assigned | own |
| Medical notes | ✓ | — | — | own |

## 3. Data minimisation

Read paths select only the columns needed for the view. Guardians and coaches
never receive columns outside their need-to-know (e.g. coaches never receive
`athlete_medical`; guardians never receive private coach notes). The parent data
export returns a curated, RLS-scoped subset rather than raw rows.

## 4. Medical notes protection

`athlete_medical` is readable **only by admins and the athlete's guardians**
(`medical_select` policy). Coaches are excluded entirely (validated: a coach sees
0 medical rows). Limited safety information for coaches is exposed through a
separate, minimal `athlete_safety` path, not the full medical record. Writes are
guardian/admin only and are audited.

## 5. Audit logging of sensitive changes

An `audit_trigger` writes immutable `audit_logs` rows (actor, action, table,
target, old/new data, timestamp) on every change to: `invoices`, `payments`,
`registrations`, `athlete_medical`, `consent_acceptances`, `invitations`, and
`documents`. Settings changes and privacy actions (erasure) are logged explicitly.
`audit_logs` has only a SELECT policy (admin) — there is no UPDATE/DELETE path, so
the trail is append-only. Viewer: Settings → Audit log (filterable by table).

## 6. Secure file storage

Document files live in a **private** Supabase Storage bucket (`documents`,
`public = false`). Files are never served directly. Downloads go through a server
action that (a) re-checks visibility via the RLS-scoped session client, then
(b) mints a **60-second signed URL** using the service role. Object-level policies
restrict direct access to staff. Uploads/deletes are admin-only and audited.

## 7. Consent record immutability

Consent acceptances are an evidentiary record (timestamp, IP, user, form version,
and a **text snapshot** of exactly what was agreed). They are immutable:

- No RLS UPDATE/DELETE policy exists → the app can never edit or delete them
  (validated: a guardian's UPDATE silently affects 0 rows).
- A `BEFORE UPDATE OR DELETE` trigger blocks DELETE entirely and rejects any
  change to evidentiary fields **even for privileged/service-role callers**
  (validated: a superuser edit raises *"records are immutable"*).
- The only permitted mutation is a lawful **withdrawal** via `withdraw_consent()`,
  which flips `status → withdrawn` and stamps `withdrawn_at`, leaving the original
  snapshot intact.

## 8. GDPR / FADP data export

- **Data subject (parent):** Account → "Download my data" returns a JSON export of
  their family, athletes, registrations, invoices, consents and documents,
  produced through the RLS-scoped client (a parent can only ever export their own).
- **Controller (admin):** Settings → Privacy → "Export JSON" returns the org
  configuration and record counts.

## 9. Deletion / erasure workflow

`deletion_requests` table + workflow:
1. A parent submits a request for their own family (RLS prevents requesting
   another family's erasure — validated).
2. An admin reviews it (Settings → Privacy) and approves or rejects.
3. On approval, `anonymise_family()` scrubs PII across families, athletes,
   `athlete_medical`, and guardian profiles (names → `[deleted]`, emails →
   `deleted-<id>@deleted.invalid`, contacts/medical → null, dob → sentinel),
   while **retaining financial records** (invoices/payments) as legally required.
   Validated: personal data scrubbed, invoice retained.

## 10. Backup & export strategy

- **Managed backups:** enable Supabase daily backups + Point-in-Time Recovery
  (PITR) on the production project (paid tier). Verify restore quarterly.
- **Off-platform copies:** a scheduled `pg_dump` (nightly) to encrypted,
  access-controlled object storage in the EU/CH region, retained per the data
  retention policy. Encrypt at rest; restrict the dump credentials.
- **Logical export:** the in-app export tools (admin + per-family) cover
  portability and ad-hoc needs.
- **Test restores** before launch and on a recurring schedule.

## 11. Environment variable security

- All secrets are accessed through `src/lib/env.ts` (server-only). The service
  role key, Stripe and Resend keys are **never** referenced in client components.
- `assertServerEnv()` fails fast at boot if a required secret is missing and
  refuses to start if any `NEXT_PUBLIC_*` var appears to contain a secret.
- `.env*` files are git-ignored; production secrets live only in the host's secret
  store (Vercel/Supabase env settings), rotated on staff offboarding.

## 12. Error logging without exposing sensitive data

`src/lib/log.ts` provides a redacting logger: emails, phone numbers, IBANs, API
keys and JWTs are masked, and any object key matching `pass|token|secret|key|
email|phone|medical|dob|…` is replaced with `[redacted]` before logging. Server
actions return a generic *"Something went wrong (ref XXXX)"* to the client while
the full (redacted) detail is logged server-side under that reference id.

## 13. Admin-only financial records

`invoices` and `payments` are restricted to `is_finance()` (admin ∪ finance) plus
the owning guardian for their own invoices. Validated: a coach sees 0 invoices and
0 payments; a parent sees only their own family's invoices; finance sees all.
Payments are additionally immutable (trigger) once recorded.

## 14. Parent — own family only

Every parent-facing read is gated by `is_guardian_of_*`. Validated: a guardian
sees only their own athlete(s), their own invoices, and their own child's medical
record — and 0 rows for any other family.

## 15. Coach — assigned scope only

Coaches are limited to athletes/sessions they are connected to via
`coach_can_access_athlete()` / `coach_leads_attendance_session()`. Validated: the
test coach sees 4 of 8 athletes (only assigned), 0 medical records, and 0
financial records.

---

*Controls 1–15 are implemented across migrations `…090200` (base RLS), `…090400`
(family RLS), `…090900` (attendance/coach scope), `…091300` (documents/consent),
and `…091400` (security hardening). See `SECURITY_CHECKLIST.md` for the pre-launch
gate.*
