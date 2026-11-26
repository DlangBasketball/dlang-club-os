# Camp age approval band

Migration: `supabase/migrations/20250420105100_camp_age_approval.sql` (one file, additive, idempotent).
Tests: `tests/db/camp_age_approval.sql` (`DB_TEST_PREFIX=ca scripts/db-test.sh tests/db/camp_age_approval.sql`),
`tests/unit/camp-age-approval.test.ts`.
Code: `src/lib/camps/age-approval.ts` (pure TS mirror + UI helpers), `src/lib/camps/approval-server.ts` (submit),
`src/lib/camps/approval-data.ts` (reads), `src/lib/camps/approval-notify.ts` (notices), `src/lib/actions/camp-approval.ts`
(admin actions), `src/lib/actions/camp-registration.ts` (parent submission split).

## 1. Rule

A camp programme may accept children slightly younger than its minimum age after an admin review. Configured per camp
(`programs.approval_age_min` / `approval_age_max`, both null = **off**, the default). The band must end below
`programs.min_age` (DB check `programs_approval_age_chk`; the admin form says so).

**Age** = whole years on the camp week's first day (`camp_editions.starts_on`) from `athletes.dob`:
`public.camp_age_on_start(dob, starts_on)`; TS mirror `campAgeOnStart()` (same fixtures in both test suites,
including a birthday exactly on day 1 and 29 February).

**Classification** `public.camp_age_band(age, min_age, max_age, band_min, band_max)` / `campAgeBand()`:

| case | result | flow |
|---|---|---|
| age unknown, or no `min_age`, or age >= `min_age` (and <= `max_age`) | `standard` | existing flow, unchanged |
| age inside the band | `approval` | "Submit for approval" |
| below the band (and below `min_age`) | `too_young` | blocked, existing message (`AGE_OUT_OF_RANGE`) |
| above `max_age` | `too_old` | existing rule (`AGE_OUT_OF_RANGE`) |

With a band configured the database enforces it on **every** registration path (single week, basket, waitlist, direct
insert): trigger `registrations_camp_approval_guard` refuses a camp place for an `approval` child (`APPROVAL_REQUIRED`) or
a `too_young` / `too_old` child (`AGE_OUT_OF_RANGE`), measured on the week's first day. For those programmes the older
programme age check in `registrations_program_rules` (which measures on today / the programme start) is skipped for camp
weeks, so a child who turns 8 on day 1 books the standard way. Camps without a band keep the previous rule exactly.

## 2. Statuses

| what the family / admin sees | `registrations.status` | `approval_status` | invoice | capacity |
|---|---|---|---|---|
| Pending admin approval | `pending_approval` (new enum label) | `pending` | none | not counted |
| Approved – awaiting payment | `pending` (the existing reservation) | `approved` | issued camp invoice | counted |
| Confirmed | `confirmed` | `approved` | paid | counted |
| Declined | `cancelled` | `declined` (+ message) | none | – |
| Withdrawn (guardian cancelled the request) | `cancelled` | `withdrawn` | none | – |

Capacity everywhere counts `pending` + `confirmed` (unchanged), so a request never takes a place; an approved request
does, like any other camp booking awaiting payment. The new enum label is only used at run time (no DDL in the migration
uses it), following the `ADD VALUE` pattern of `20250420091200_notifications.sql`.

Decision columns: `approval_request_id`, `approval_requested_at`, `approval_age` (age on day 1 at submission),
`approval_decided_by`, `approval_decided_at`, `approval_note` (message to the parent, <= 1000 chars). Every submit /
decision / "full" refusal / confirmation on payment is written to `audit_logs` (`camp.approval.*`), and `registrations`
keeps its audit trigger.

## 3. How "payment before confirmation" is determined

There is no separate camp setting: the existing camp rule (`register_camp`, `register_camp_basket`) is that a **priced**
camp week is created as `pending` with an issued invoice and holds the place until paid; nothing in the regular camp flow
confirms it automatically. The approval workflow reuses exactly that:

- price > 0 → `pending` + invoice issued through the normal invoice triggers (category `camp`, the club's camp number
  series, e.g. `DL CAMP-2026-0001`, payment reference, billing entity) → usual payment instructions (QR-bill, card/TWINT,
  instalments where the club allows them) on the parent invoice page;
- price 0 → confirmed at once, no invoice.

When the invoice of an **approved** registration is paid in full (`invoices.status` → `paid`, from any payment path:
Stripe webhook, offline payment, receipt allocation), trigger `trg_invoices_camp_approval_confirm` confirms that
registration, so the child appears on the confirmed roster. Regular camp registrations are not touched.

## 4. RPCs

| RPC | who | notes |
|---|---|---|
| `camp_approval_submit(payload)` — `{program_id, edition_id, family_id, registered_by, request_id*, children:[{athlete_id, age_group_id, price_option_id, days}], consents, ip}` | service role (parent server action resolves family + own children) | locks the edition; window/published checks as `register_camp`; child must classify `approval` (`NOT_APPROVAL_AGE`); age group / option / days validated (the group's own age fit is what the admin reviews); price snapshot of the option (no automatic discounts — an admin can apply one after approval with the existing manual discount); consents recorded; **replay** of the same `request_id` returns the same rows; a second active request for the same child + week → `ALREADY_REQUESTED` (also unique partial index `registrations_approval_active_uidx`); a declined/withdrawn row without invoice makes way for a new request |
| `camp_approval_decide(registration, 'approve'|'decline', note, request_id)` | **admin** of the registration's org (finance, coaches, guardians, other orgs refused) | locks the registration; already decided: the same decision replays (`replayed: true`, same invoice), another one → `ALREADY_DECIDED`. Approve locks the edition and re-checks `pending + confirmed < capacity`; full → returns `{decided:false, reason:'EDITION_FULL', taken, capacity}` and changes nothing. Otherwise the same row → `pending` + invoice (or `confirmed` when free) |
| `camp_age_on_start`, `camp_age_band` | anyone | pure |

Guards: the approval columns and the `pending_approval` status change only through these RPCs (or the service role).
A guardian may withdraw (cancel) a request; finance cannot move a request into the booking flow (`USE_CAMP_APPROVAL`).
Concurrent approvals for the last place serialise on the edition row lock (tested with two real sessions via dblink).

## 5. Server layer and UI

- **Admin camp settings** (`/admin/programs/<camp id>`, admin): card "Age approval" (from age / to age, turn off).
  Action `saveCampApprovalBand`.
- **Parent app** (`/parent/camps/<camp id>`): a child in the band is marked "Needs approval", gets the same form,
  options and required consents; before submission the note shows exactly "Children aged {min} and {max} can apply. Our
  team will review your registration and let you know whether a place is available." (one age / wider bands have their
  own wording; ages come from the band). The button reads "Submit for approval" (or "Register and submit for approval"
  when standard children are in the same submission: they go through `register_camp` as before). The form keeps one
  request id, so a double click never creates two requests. After submission → `/parent/bookings?camp=requested`.
  The multi-week basket is unchanged: a band child added there is refused (age group check, or `APPROVAL_REQUIRED` from the database).
- **My bookings** (`/parent/bookings`): section "Camp registrations" with each week's state (Pending admin approval,
  Approved – awaiting payment with a "Pay invoice" link, Confirmed, Declined with the club's message). RLS: guardians see
  only their own children.
- **Admin queue** `/admin/camps/approvals` (Camps → Pending approval, admin only; linked with its count from Programs
  and from each camp page): child, age on the first day, camp week + places taken, parent contact, form answers,
  options/days/price, consents. Approve / Decline with an optional message. Action `decideCampApproval` (request id fixed
  per button, so retries replay). After approval: member price and participation contracts as for any camp booking.
- **Roster / counters** (`/admin/programs/<camp>/editions/<week>`): status badges show the workflow states; counters
  Confirmed / Awaiting payment / Approved – awaiting payment / Pending approval; revenue excludes requests.
- **Finance**: requests carry no invoice, so they never appear in finance; approved requests appear as ordinary camp
  invoices (open until paid), category `camp`.
- **Notifications** (existing dispatch, in-app + logged e-mail, in the recipient's language): admins on every new request
  (in-app to each admin, e-mail to the club's alert recipients); the family on approval (invoice number and amount) and
  on decline (with the message). No medical data in any notice.

## 6. Not covered

- Public (signed-out) camp pages: the approval workflow is for the Parent App; a band child on a public page is refused
  as before (age group / `APPROVAL_REQUIRED`).
- Automatic discounts (sibling, early bird, promo) are not applied to a request; admins can add a manual discount after
  approval.
- The previous programme age rule for camps without a band still measures on today / the programme start date; switching
  every camp to the first-day rule would be a separate decision.
