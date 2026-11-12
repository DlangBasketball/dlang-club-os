# TENANT ONBOARDING RUNBOOK

From signed contract to a club running its season. Target (rollout W12): **<= 3 weeks elapsed, <= 5 founder hours** per club. The long poles are the club's own DNS, Stripe verification and data clean-up — start them on day 1.

## 0. Before anything (contract & compliance) — Day 0

- [ ] Signed subscription agreement + **DPA** (processor terms, sub-processor list: Vercel, Supabase, Stripe, Resend, error reporting, AI provider if the assistant is enabled).
- [ ] Choose **data region / cell** (CH tenants: CH or EU cell per ARCHITECTURE §2; EU: EU; US: US). Record it in the platform directory. It is not changed later without §9.
- [ ] Club's privacy notice references the platform; consent texts reviewed (photos, medical, communication).
- [ ] Named club contacts: admin (owner), finance, data-protection contact.

## 1. Provision — Day 1 (30 min)

1. Create the organization in the region's production project (until a provisioning screen exists, run as service role):
   ```sql
   insert into public.organizations (name, slug, country, currency)
   values ('<Club name>', '<slug>', 'CH', 'CHF')   -- US: 'US','USD'; EU: 'DE','EUR' etc.
   returning id;
   ```
   (The tenancy track adds `data_region`, locale, terminology and branding columns — set them here once available.)
2. Invite the club admin (Admin -> Invitations, role `admin`), or via `inviteUser` with the service role for the very first admin.
3. Add the platform directory entry: slug -> region base URL, status `onboarding`.
4. Default subdomain `<slug>.clubos.app` works immediately (wildcard).

## 2. Domain (optional, white-label) — start Day 1, done when DNS propagates (1-3 days typical)

1. Club chooses e.g. `app.<club-domain>`.
2. Add it to the regional Vercel project (dashboard or Domains API, ARCHITECTURE §5). Send the club the exact CNAME / TXT records.
3. When verified: add `https://app.<club-domain>/auth/callback` to Supabase Auth redirect URLs; update directory; test login.

## 3. Branding & configuration — Day 2-5 (club does it, 1 h founder support)

- [ ] Logo, colours, club name, terminology (team/squad, season/term), languages, timezone, currency.
- [ ] Venues, programs/teams, seasons, prices, sibling discounts.
- [ ] Billing & tax: CH — QR-IBAN and creditor address for Swiss QR-bill, VAT number/status; EU — VAT handling; US — sales tax (usually exempt for youth sports — club confirms).
- [ ] Notification templates in the club's languages.
- [ ] Email sender: platform default sender on day one; club's own domain via Resend (ARCHITECTURE §6) — SPF, DKIM and (recommended) DMARC records. Expect 1-3 days for the club's IT/registrar.

## 4. Payments (Stripe Connect) — start Day 1, typically 2-7 business days

1. From Club setup -> Billing, start Stripe Connect onboarding (connected account in the club's country; Express or Standard per the payments track).
2. Club completes KYC (legal entity — association/Verein/association loi 1901/501(c)(3) etc., representative ID, bank account).
3. CH: confirm **TWINT** is enabled on the connected account; EU: SEPA Direct Debit / cards; US: cards / ACH.
4. Test: one real low-value payment, refunded. Verify the webhook marks the invoice paid and the payout lands.
5. Clubs not ready for Stripe can start with Swiss QR-bill / bank transfer only.

## 5. Data import (CSV) — Day 5-12

The importer is at **Admin -> Import** (`/admin/import`). Template: `/admin/import/template`.

1. Ask the club for an export of families/athletes/guardians from their current tool or spreadsheet. **No medical data** in the CSV — it is collected via the parent app with consent.
2. Map columns to the template (one row per athlete; household + guardians repeated). Accepted dates: `YYYY-MM-DD`, `DD.MM.YYYY`, or `DD/MM/YYYY` vs `MM/DD/YYYY` (choose in the form — US clubs: month first).
3. **Dry run on staging** with the real file (staging has no real data, so delete the staging import afterwards), fix errors with the club.
4. **Dry run in production** -> review warnings (existing athletes are skipped, existing families matched by exact name).
5. **Import.** Leave "email the guardian invitations" unticked unless the club has already announced the system.
6. Reconcile: counts of families / athletes / guardian invitations vs. the club's own numbers; club signs off in writing (email is fine).
7. Delete the CSV from all laptops/inboxes after sign-off (it contains minors' data).
8. Re-running a corrected file is safe: athletes with the same name + date of birth are skipped.

## 6. People — Day 10-15

- [ ] Coaches invited; 30-minute session on their own phones; each takes attendance once.
- [ ] Finance user invited if separate.
- [ ] Friendly-parent pilot (3-5 families) end-to-end: invitation -> onboarding -> consent -> registration -> payment.
- [ ] Invite all guardians in batches (<= 100/hour with Auth SMTP limits), after the club has announced it.

## 7. Go-live & hypercare — Day 15-21

- [ ] Directory status `live`. Uptime monitor for the custom domain.
- [ ] Day +1, +7, +30 check-ins: logins per week, registrations, payments reconciled, support tickets.
- [ ] First reminder cycle measured (outstanding before/after) — the ROI case study.

## 8. Offboarding / termination

Export (Admin -> Export) handed to the club; data deleted within the DPA period (default 30 days) from production; backups age out per BACKUP_DR.md; Stripe connected account disconnected; domain removed; directory entry removed. Confirm deletion in writing.

## 9. Moving a tenant between regions (rare)

Requires the club's written instruction. Freeze writes (maintenance banner) -> `pg_dump` rows by `org_id` from source (public schema tables in FK order + auth users of that org) -> load into target project -> verify counts -> switch domain + directory -> delete from source after 14 days. Plan 1 day; do it outside season peaks.
