# Booking workflow (phase A) — contract

Backend for athlete onboarding from the booking form, training sessions on the calendar, the booking lifecycle,
invoicing from the booking, payments and booking notifications. This is the contract for the two UI tracks
(admin booking form / detail / finance; coach, parent and player portals + athlete profile).

- Migration: `supabase/migrations/20250420104400_booking_workflow.sql` (one file, additive, idempotent)
- DB tests: `tests/db/booking_workflow.sql` (`DB_TEST_PREFIX=bk scripts/db-test.sh tests/db/booking_workflow.sql`)
- TS: `src/lib/booking/` (`types.ts` contract + zod, `helpers.ts`, `data.ts` reads, `dispatch-core.ts` + `notify.ts`
  notifications) and `src/lib/actions/booking-workflow.ts` (server actions)
- Unit tests: `tests/unit/booking-workflow.test.ts`
- Builds on `docs/billing-foundation.md` (categories, number series, entities, receipts) and `docs/team-attendance.md`
  (sheets, coach access).

## 1. Decisions

| Topic | Decision |
|---|---|
| Source of truth | `training_services` is the catalogue. New columns: `billing_category` (revenue category, default `training`, never `other`), `kind` (`private` / `group` / `trial` / `package`), `default_venue_space_id`. Price (`price_chf` + `currency`), duration, capacity (`max_participants`) and venue stay where they were. Existing services: `kind` = `group` when `session_type = 'group'`, else `private`. |
| Eligible coaches | New table `training_service_coaches`, backfilled from `coaches.serves` (slug lists). Once a service has rows they are authoritative; a service without rows falls back to the slug list (`bk_coach_eligible`). The legacy parent booking flow still checks `coaches.serves`. |
| Sessions | New `training_sessions` (service, coach, venue, venue space, `starts_at`/`ends_at` UTC, capacity, status `scheduled`/`cancelled`/`completed`). Each session has one `events` row: **type `training`, `team_id` null, `training_session_id` set, title = service name** (no athlete name). The enum is not extended: the team-training rules ignore these events (see §5). Participants = bookings with status `booked`/`completed`/`no_show`. |
| Booking status vs billing status | `training_bookings.status`: `requested` (held place awaiting the coach, since 20250420104700, §12), `booked` (shown as **confirmed**), `completed`, `no_show`, `cancelled`. Billing status is derived (`booking_billing_status`, §3). |
| Billing is explicit | `booking_confirm` never invoices, unless the club turns on `app_settings.settings.booking.auto_invoice` (default off; then a staff-only draft is created). |
| Times | Stored UTC (`timestamptz`); labels and invoice source labels use the club time zone (`organizations.timezone`, fallback via `ta_tz`). `formatSlot()` formats with `Intl` in the viewer's locale. |
| Date of birth | `athletes.dob` is NOT NULL in the schema, so `athlete_quick_create` always requires it (`DOB_REQUIRED`). It decides the minor rule: under 18 on the club's today → a guardian link is required. |
| Name matching | Portable accent / case folding (`bk_norm`, TS twin `normName`). `unaccent` / `pg_trgm` are not required (deterministic rules, §4). |
| Legacy paths | `book_training`, `book_training_session`, the guest checkout, `reschedule_training`, `admin_update_booking`, `cancel_training_booking`, `admin_cancel_booking` keep working unchanged. A trigger attaches their bookings to a session (create or join) so they appear on the calendar and in attendance; a failure there never blocks the legacy path and is flagged `BOOKING_WITHOUT_SESSION`. Legacy cancel / reschedule releases the session. |

## 2. Tables

All new tables: `org_id` + index, RLS forced, a policy for every verb, `created_at` / `updated_at`, audit trigger.

| Table | Purpose | Select | Writes |
|---|---|---|---|
| `training_service_coaches` | (service, coach) eligibility | org members | admin (RLS) / `training_service_coaches_set` |
| `billing_payers` | Bill To record: `kind` `athlete`/`guardian`/`sponsor`/`other`, `profile_id?`, `family_id?`, `athlete_id?`, `name`, `email`, `phone`, `street`, `postal_code`, `city`, `country` (ISO-2), `notes`, `is_active` | admin + finance; a payer login reads its own row | finance (RLS or `billing_payer_save`); delete admin. Audit redacts e-mail, phone, street, notes |
| `training_sessions` | one per calendar slot; exclusion constraints (below) | admin + finance, the session coach, guardians / player of a participant | none (RPC only) |
| `training_booking_entitlements` | package entitlement consumed by a booking — **unique per booking**, `restored_at` | admin + finance | none |
| `booking_requests` | idempotency keys (request_id → stored result) | none | none |
| `booking_notifications` | one delivery row per (booking, kind, change_seq, recipient) | admin + finance | none (RPCs / service role). Audit redacts recipient e-mail + name |

New columns:
- `training_bookings`: `session_id`, `payer_id`, `billing_mode` (`invoice`/`package`/`free`/`credits`), `list_price`, `currency`,
  `price_override_reason`, `price_override_by`, `availability_override_reason`, `warnings` (jsonb), `request_id` (unique per org),
  `created_via` (`legacy`/`workflow`), `change_seq`, `rescheduled_at`. Unique: one live booking per (session, athlete); one invoice per
  workflow booking.
- `invoices`: `payer_id`, `payer_email`, `payer_address` (jsonb `{street, postal_code, city, country}`) next to the existing
  `payer_kind` / `payer_name` / `payer_profile_id`. The QR-bill "payable by" block prints the payer name + address when the invoice has
  a payer record.
- `events.training_session_id` (unique); `team_attendance_sheets.team_id` is now nullable (session sheets).
- `notification_type` gains `booking_rescheduled`.

Concurrency:
- `training_sessions_coach_excl`: a coach never has two overlapping scheduled sessions (btree_gist).
- `training_sessions_space_excl`: a venue space never hosts two overlapping scheduled sessions; `events_space_no_overlap` also
  refuses a session in a space used by a team event (`SPACE_TAKEN`).
- `booking_confirm` / `booking_reschedule` lock the coach row (and the session row with `for update`) before evaluating, so two
  staff confirming the same slot or the last place run one after the other: the second gets `COACH_BUSY` / `SESSION_FULL`
  (tested with two real sessions via dblink).

## 3. Statuses

- Booking: `requested` → `booked` (coach / admin confirms) or `cancelled` (declined / withdrawn, §12); `booked` (confirmed) →
  `completed` / `no_show` (from the finalized attendance sheet since 20250420104700, or `mark_training_booking`) or `cancelled`.
  An excused booked session stays `booked` with `attendance_status = 'excused'`. History is kept (the row stays; cancel reason,
  `cancelled_at`, `cancelled_by`).
- Session: `scheduled` → `cancelled` (last participant left) / `completed`.
- Billing (`booking_billing_status`): `awaiting_confirmation` (a request: never invoiced) · `not_billable` (free / trial / price 0 / cancelled before invoicing) · `package`
  (package-covered or legacy credits) · `to_invoice` · `invoice_draft` · `invoiced` · `partially_paid` · `paid` · `credited`
  (invoice cancelled / refunded, or credited down to 0).
- Notification row: `pending` → `sending` → `sent` / `failed` / `no_contact` (`skipped` reserved).

## 4. RPCs

All are `security definer`, set `search_path`, resolve the org from the session (`current_org_id()`), and re-check the role.
"Staff" = admin + finance (`bk_is_staff`). Writes take a `request_id` (uuid): a retry by the same user returns the stored result with
`replayed: true`; another user / kind with the same id gets `REQUEST_ID_REUSED`. Refusals are raised as `P0001` codes (nothing is
stored, so the same id can be retried after fixing the input) except the data-carrying refusals marked "returned".

### Catalogue and people
| RPC | Who | Notes |
|---|---|---|
| `training_service_catalog(include_inactive=false)` | staff | services with kind, billing category, price, currency, duration, capacity, venue / space, eligible `coaches[]`, `packages[]`, `setup_missing[]`, `number_prefix` |
| `training_service_coaches_set(service, coaches[])` | admin | full replace; refreshes the review flags |
| `people_duplicate_check({first_name, last_name, dob, email, payer_name})` | staff | `athletes[]` with `score` / `reason` (`NAME_DOB` 100, `NAME` 80, `NAME_SWAPPED` 70, `LAST_NAME_DOB` 60, `FIRST_NAME_DOB` 50, `NAME_SIMILAR` 40 = same last name + first 3 letters), `payers[]` (e-mail or name), `families[]` (contact e-mail), `guardians[]` (login e-mail) |
| `athlete_quick_create(payload, request_id)` | staff | payload `{first_name, last_name, dob, gender?, email?, phone?, family_id? \| guardian_profile_id? \| new_family:{name?, contact_name, contact_email?, contact_phone?, street?, postal_code?, city?}, create_payer?:{kind, name?, …}, confirm_duplicate?}`. Minor → one of the three links is required (`GUARDIAN_REQUIRED`); a new family needs a contact name and an e-mail or phone (no login is created). An adult without a family gets a household of their own. Score ≥ 60 duplicates are **returned** `{ok:false, code:'DUPLICATE_SUSPECTED', candidates}` unless `confirm_duplicate`. Never creates a membership, roster row, registration or EYBL enrolment. Returns `{athlete_id, family_id, created_family, payer_id, is_minor}` |
| `billing_payer_save(payload, request_id?)` | staff | insert (idempotent with request_id) or update (`id`). A `profile_id` must be a guardian or the player of this club (`PROFILE_NOT_FOUND`) |
| `billing_payer_candidates(athlete)` | staff | saved payers of the family / athlete (siblings share them), the family's guardians, the family default snapshot |

### Lifecycle
| RPC | Notes |
|---|---|
| `booking_quote(payload)` | Writes nothing. Payload `{athlete_id, service_id, coach_id?, starts_at?, session_id?, venue_space_id?, payer_id?, billing:'auto'\|'invoice'\|'package'\|'free', purchase_id?, price?, price_reason?, override_availability?, override_reason?, notes?, notify?}`. Returns `{ok, errors[], warnings[], slot{session_id, coach_id, starts_at, ends_at, venue_id, venue_space_id, capacity, participants, places_left}, billing{billing_mode, price, list_price, currency, price_override, purchase_id, package_remaining, billing_status, setup_missing[]}, service, billing_entity, number_prefix, payer}` |
| `booking_confirm(payload, request_id)` | Same payload. Group service: an existing scheduled session of the same service, coach and start is **joined** (or pass `session_id`); otherwise a session + event is created. Capacity under row lock. Package: one entitlement deducted (row `training_booking_entitlements`, unique per booking), exactly once. `free` / trial / price 0 → `not_billable`. Price override (any staff) needs `price_reason`, audited `BOOKING_PRICE_OVERRIDE`. Availability / eligibility override: **admins only**, needs `override_reason`, audited `BOOKING_AVAILABILITY_OVERRIDE`. Queues notifications unless `notify:false`. Returns `{booking_id, session_id, event_id, starts_at, ends_at, coach_id, billing_mode, billing_status, price, currency, purchase_id, invoice_id (auto-invoice only), warnings[], setup_missing[]}` |
| `booking_reschedule(booking, payload, request_id)` | Payload `{starts_at? \| session_id?, coach_id?, venue_space_id?, price?, price_reason?, override_availability?, override_reason?, notify?}`. A private session (or a group session with no one else) **moves in place**: the event follows (`rescheduled_from` kept, absence reports flagged `needs_review`). Otherwise the old place is released (an empty session is cancelled with its event) and the new one created / joined (capacity checked). The package entitlement stays. The invoice is unchanged unless `price` changes: then a credit note (lower) or debit note (higher) through `issue_invoice_adjustment`; before invoicing the booking price just changes. Refused when the sheet was finalized (`BOOKING_ATTENDED`) or the slot is the same (`SAME_SLOT`) |
| `booking_cancel(booking, reason, request_id, refund_mode='none', restore_package=null, notify=true)` | Frees the place (empty session + event cancelled), keeps the row. Package entitlement restored once when `restore_package` is true, or (null) by policy: `settings.booking.refund_credits_on_cancel` (default true) **and** at least `settings.booking.cancellation_hours` (default 24) before the start. `refund_mode`: `none` (invoice untouched), `cancel_invoice` (`cancel_invoice`; refused with payments: `HAS_PAYMENTS`), `credit_note` (credit note for the booking price; an unpaid invoice is cancelled instead). Money that was paid is refunded through the existing refund / overpayment workflow. Issued invoices are never deleted |
| `booking_invoice_preview(booking)` | staff: `{billable, invoice_id, invoice_number, recipient (payer snapshot), amount, currency, category, billing_entity, number_prefix, number_preview ("DL PT-2026-0001"), source_label, setup_missing[]}` |
| `booking_create_invoice(booking, request_id, send=false)` | One invoice per booking (a second call returns `already_invoiced`). Activity = the service's `billing_category` (never mixed), number from that category's series, entity from the routes, `source_label` = "service · YYYY-MM-DD HH:MI" (club time), payer snapshot. `send=true` → issued (`sent`, final number); `false` → staff-only draft (number at issue). Paid services without a category / entity / series → **returned** `{ok:false, code:'SETUP_MISSING', setup_missing[]}` and the service is flagged `SERVICE_BILLING_SETUP`. `NOT_BILLABLE` for package / free / cancelled bookings |
| `booking_record_payment(booking, {request_id, amount, method?, received_on?, reference?, note?})` | staff: offline payment through `receipt_record` (idempotent; a retry returns `replayed`). Card / TWINT online payments are marked paid only by the Stripe webhook, as before |

### Notifications
| RPC | Who | Notes |
|---|---|---|
| (queue) | RPCs | `confirmed` / `rescheduled` / `cancelled` rows for: the payer (login or e-mail), the guardians with a login (`ta_alert_recipients`), the family contact e-mail when there is no guardian login, the player login, the coach login. No reachable family recipient → a `no_contact` row |
| `booking_notifications_claim(org?, booking?, limit)` | service role | claims `pending` (and stale `sending`) rows below 5 attempts with the data the message needs (athlete first name, service, coach, times, club time zone) |
| `booking_notification_record(id, status, error?, notification?, email_log?)` | service role | `sent` / `failed` / `no_contact` |
| `booking_notification_retry(id)` | staff | `failed` → `pending`; a `no_contact` row is re-queued from the current contacts |

### Reads
| RPC | Who | Returns |
|---|---|---|
| `booking_list(filters)` | staff | `{rows, total, limit, offset}`; filters `from, to, status, billing_status, coach_id, service_id, athlete_id, payer_id, search (accent-insensitive name), limit ≤ 200, offset`. Row = `BookingRow` (session, coach, athlete, payer, invoice number / status / balance, billing status, warnings) |
| `booking_detail(booking)` | staff | row + `recipient`, `participants[]`, `entitlement`, `attendance`, `notifications[]` (delivery status per recipient), `invoice_deliveries[]` (email_logs of the invoice), `invoice_preview` |
| `bookings_to_invoice(limit)` | staff | confirmed / completed / no-show billable bookings without invoice |
| `athlete_booking_history(athlete)` | staff | `{upcoming[], past[]}` |
| `coach_booking_agenda(from?, to?, coach?)` | the coach (admin may pass a coach) | sessions they lead with `participants[]` = first / last name + booking status only (no payer, price or invoice) |
| `guardian_booking_overview(athlete?)` | guardian | per own child: `upcoming[]`, `changes[]` (cancelled / rescheduled, 30 days), finalized session `attendance[]`, `invoices[]` **only where the guardian may see the invoice as payer** |
| `player_booking_overview()` | player | the same for the player, `invoices` always empty |
| `booking_dashboard_counts()` | staff | `{today, next_7_days, awaiting_invoice, outstanding[{currency, amount, count}], failed_notifications}` |
| `booking_followups(limit)` | staff | failed / no-contact / stuck notification rows, failed e-mails of booking invoices |
| `booking_review_flags(org)` | admin / service | refreshes `SERVICE_WITHOUT_COACH` / `SERVICE_BILLING_SETUP`, resolves fixed ones |
| Finance totals | finance | existing `invoice_totals_by_category(from, to, entity?, status?)` (TS `getBookingFinanceTotals`) |

## 5. Attendance and calendar

- Session events are ordinary `training` events with `training_session_id`: admin calendar and `coach_sessions` /
  `coach_training_cards` show them (access `session_coach`, roster size = confirmed bookings).
- The sheet builder (`ta_sheet_sync`, `attendance_open`, `ta_sheet_json`) uses **the confirmed bookings of the session** as the roster
  when the event has no team (`bk_event_roster`); the sheet is kept in step after confirm / reschedule / cancel while it is a draft.
  Team sheets are unchanged.
- `coach_can_run_event` / `ta_is_event_staff`: the session coach runs the sheet (plus admins and approved substitutes, as before).
- Not misfiring: `TRAINING_WITHOUT_TEAM` ignores session events; club training breaks never cancel booked sessions
  (`ta_break_events`); the training window guard only applies to recurring team series; `sessions_awaiting_attendance` lists sessions
  (team name = service name).
- Visibility: `events_select` shows a session event to staff, coaches, and the guardians / player of a participant only (before: any
  guardian saw team-less events). `player_sees_event` likewise.
- History: `ta_athlete_overview` (guardian / player attendance overview) includes booked sessions (upcoming and finalized).
- A session event cannot be moved, cancelled or deleted directly (`SESSION_EVENT_MANAGED`): reschedule or cancel the bookings.
- Since 20250420104700: absence reports and correction requests for session events (§12); the finalized sheet sets the booking status.

## 6. Server actions (`src/lib/actions/booking-workflow.ts`)

`quoteBooking`, `confirmBooking(input, requestId)`, `rescheduleBooking(input, requestId)`, `cancelBooking(input, requestId)`,
`createBookingInvoice(bookingId, requestId, send)`, `retryInvoiceEmail(emailLogId)`, `recordBookingPayment(bookingId, input, requestId)`,
`checkDuplicates`, `quickCreateAthlete(input, requestId)`, `savePayer(input, requestId?)`, `retryBookingNotification(id)` (staff =
admin, finance) and `setServiceCoaches(serviceId, coachIds)` (admin). Inputs are the zod schemas in `src/lib/booking/types.ts`
(camelCase; mapped to the RPC JSON by `toBookingRpcPayload` / `toPayerRpcPayload` / `toQuickCreateRpcPayload`).

Result: `{ok:true, data?, message?}` or `{ok:false, error, code}` — `error` is `bookingWorkflow.errors.<CODE>` translated. Refusals with
data arrive as `ok:true` with `data.ok === false` (`SETUP_MISSING` + `setup_missing`, `DUPLICATE_SUSPECTED` + `candidates`).
Create one `requestId` per user intent with `newRequestId()` (`src/lib/billing/request-id.ts`) and reuse it on retry.

After confirm / reschedule / cancel / retry the action delivers the queued notifications right away (`runBookingNotifications`,
service role, best effort). `createBookingInvoice(…, send=true)` e-mails the invoice (`invoice_sent`) to the payer e-mail, else the
family contact; the delivery is an `email_logs` row with `invoice_id`, shown in `booking_detail.invoice_deliveries` and in the
follow-up list; `retryInvoiceEmail` re-sends it.

Reads (`src/lib/booking/data.ts`, `Read<T> = {data, error:null} | {data:null, error: CODE}`): `getServiceCatalog`, `listBookings`,
`getBooking`, `getBookingsToInvoice`, `getAthleteBookingHistory`, `getCoachAgenda`, `getGuardianBookings`, `getPlayerBookings`,
`getBookingDashboardCounts`, `getBookingFollowups`, `getInvoicePreview`, `getPayerCandidates`, `getBookingFinanceTotals`.

Helpers (`src/lib/booking/helpers.ts`): `normName`, `isMinor` / `ageOn`, `bookingState`, `canReschedule` / `canCancel` / `canInvoice`,
`quoteSummary` (`canConfirm`, `needsOverride`, `invoiceBlocked`), `policyRestoresPackage`, `slotEnd`, `formatSlot`.

i18n: `bookingWorkflow.{errors, warnings, setup, billingStatus, state, notificationStatus, messages}` and
`notifyEmail.booking_rescheduled` in en (US English), fr, de, es, it (`npm run i18n:sync` regenerates the regional overlays).

Notification links (since 20250420104600, `portalPathFor`): guardian → `/parent/bookings/<booking>`, payer login → `/parent/bookings`,
coach → `/coach/trainings`, player → `/player/bookings`; recipients without a login get no link. Portal screens: §11.

## 7. Permissions

| | admin | finance | session coach | other coach | guardian | payer login | player | other club |
|---|---|---|---|---|---|---|---|---|
| Catalogue / quote / confirm / reschedule / cancel | ✔ | ✔ | – | – | – | – | – | denied |
| Availability / eligibility override | ✔ (reason) | – | – | – | – | – | – | denied |
| Price override | ✔ (reason) | ✔ (reason) | – | – | – | – | – | denied |
| Athlete quick create, duplicate check, payers | ✔ | ✔ | – | – | – | own payer row (read) | – | denied |
| Invoice from booking, payments | ✔ | ✔ | – | – | – | – | – | denied |
| Booking list / detail / to-invoice / dashboard / follow-up | ✔ | ✔ | – | – | – | – | – | empty / not found |
| Session rows, session event | ✔ | ✔ | own | events only (as before) | own children's | – | own | none |
| Agenda (roster names, no money) | any coach | – | ✔ | own only | – | – | – | – |
| Session attendance sheet | ✔ | – | ✔ | substitute if approved | finalized marks via overview | – | own via overview | – |
| Portal: bookings, changes, attendance | – | – | – | – | own children | – | self | – |
| Portal: invoices | – | – | – | – | where payer (existing rule) | ✔ (if guardian of the family) | never | – |

Payer visibility follows the billing-foundation rule (`invoices_select`): a guardian sees an issued invoice of their family when they
are its payer (`payer_profile_id`), or when it has no individual payer and is not a sponsor / other share. Payers without an account
never get portal access. A guardian payer of **another** family does not see the invoice (it belongs to the athlete's family).

Coach read path (closed in `20250420104600_booking_portals.sql`): coaches no longer select or update `training_bookings` directly
(`bookings_select` / `bookings_write` = org + finance/admin or the athlete's guardian). Coaches read `coach_booking_agenda` (roster
names) and the column-restricted view `public.coach_training_bookings` (own bookings: ids, service, session, times, status, venue /
location; no price, list price, currency, payer, invoice, package, credits or notes). Coach writes stay on the security definer RPCs
(`mark_training_booking`, sheet RPCs). Test: `tests/db/booking_portals.sql`.

## 8. Failure and retry model

- Every write RPC is one transaction: session, event, booking, entitlement, invoice link and notification rows commit together or
  not at all.
- Idempotency: `booking_requests` (confirm / reschedule / cancel / invoice / athlete_create), plus unique `request_id` on
  `training_bookings` and `billing_payers`, the receipt's `request_id`, one entitlement per booking, one workflow invoice
  per booking.
- Delivery happens after commit: a failed or interrupted send leaves the row `pending` / `sending` / `failed`; the next action, a
  retry (`retryBookingNotification`) or a later run (`runBookingNotifications({orgId})`) picks it up. Stale `sending` claims
  (> 10 minutes) are reclaimed; after 5 attempts the row stays `failed` in `booking_followups`.
- An invoice whose e-mail failed stays issued; the failure is an `email_logs` row (`failed`) → `retryInvoiceEmail`.

## 9. Existing data (migration behaviour)

- Nothing is changed in bookings, invoices or payments. The live club had 6 services (4 active, one group service of 6), 0 bookings
  and 0 package purchases.
- Services get `billing_category = 'training'`, `kind` from `session_type`; eligible coaches from the slug lists.
- `data_review_flags`: `SERVICE_WITHOUT_COACH` (active service, no eligible active coach) and `SERVICE_BILLING_SETUP` (active paid
  service whose category has no routed / default billing entity or no number series — e.g. until the "DL PT" prefix is set on
  Settings → Billing entities). Booking invoicing is refused for those until fixed; confirming bookings still works and the quote
  shows `setup_missing`.

## 10. Not done in phase A

- (Done in the UI tracks) pages: admin booking form / detail / finance, portals, athlete profile.
- (Done in 20250420104700, §12) `requested` bookings, family requests, promo codes on workflow bookings, absence reports for
  session events, `completed` / `no_show` from the finalized sheet.
- Still open: legacy training credits as a billing mode of the new path.
- (Done in 20250420104600) coach table access to booking money columns, see §7.

## 11. Portals (coach, parent, player, athlete profile)

Migration `20250420104600_booking_portals.sql` (RLS tightening above, `coach_training_bookings` view, `bk_portal_rows` also returns
`kind` / `event_id` on upcoming rows, `reason` (cancel reason) / `previous_starts_at` / `coach_name` on changes, `coach_name` on
attendance, `starts_at` on invoices). List logic: `src/lib/booking/portal.ts` (unit tests `tests/unit/booking-portal.test.ts`),
components `src/components/booking/portal/`.

| Route | What it shows | Reads |
|---|---|---|
| `/coach/trainings` | Team trainings + booked sessions in one list (title = service name, "Booked session", kind, places, participants' names); "Take attendance" on the session sheet | `coach_training_cards` + `coach_booking_agenda` (`mergeCoachTrainings`) |
| `/coach/trainings/<event>` (`/attendance`) | Session header "Booked session", roster = confirmed bookings | sheet RPCs (unchanged) |
| `/coach/schedule`, `/coach` home, `/coach/calendar` | Booked sessions next to programme sessions / team events (session event shown once, links to the trainings sheet) | `coach_booking_agenda`, `coach_training_bookings` |
| `/coach/training/<athlete>` | Athlete's sessions with this coach, no price / invoice | `coach_training_bookings` |
| `/parent/bookings` | Per child (tabs): upcoming (service, time in club zone, coach, place, "moved from"), changes (moved / cancelled + reason, 30 days), finalized booked-session attendance, invoices of bookings only where the guardian is the payer | `guardian_booking_overview` |
| `/parent/bookings/<id>` | Detail: club-made bookings show no price (only a visible invoice) and no family self-service change; cancel reason / move shown | table (guardian RLS), invoice RLS |
| `/parent/attendance` | Booked sessions merged into upcoming and history ("Booked session" label, no absence report, no team record link) | attendance overview + `guardian_booking_overview(child)` (`mergeAttendanceHistory`) |
| `/player/bookings`, `/player/attendance`, `/player/notifications` | Own bookings / changes / attendance, never money; notification list | `player_booking_overview` |
| `/admin/athletes/<id>` | Bookings tab (upcoming + history, booking detail links, state, billing status, invoice number / status, "New booking" → `/admin/bookings/new?athlete=<id>`), Attendance tab "Booked sessions" (admin), Billing tab "Invoices from bookings" | `athlete_booking_history`, `team_attendance_marks` (admin RLS) |

Since 20250420104700 (§12): absence reports and correction requests for booked sessions in the portals; the parent record page
`/parent/attendance/team/<event>` also serves session events.


## 12. Booking requests (open availability, family requests, promo codes, attendance)

Migration `20250420104700_booking_requests.sql` (additive, idempotent; no new table). DB tests `tests/db/booking_requests.sql`
(`DB_TEST_PREFIX=br scripts/db-test.sh tests/db/booking_requests.sql`), unit tests `tests/unit/booking-requests.test.ts`.
The enum value `booking_status 'requested'` is only compared as text in the migration (usable after its transaction commits).

### Settings (app_settings.settings.booking, admin: Services → Online booking)
| Key | Default | Meaning |
|---|---|---|
| `availability_mode` | `declared` | `declared`: a slot must fit the coach's declared availability (today's rule). `open_confirm`: any time inside the venue opening hours; a slot outside the declared availability is created as `requested`. Inside the declared availability bookings are confirmed at once in both modes. |
| `request_followup_hours` | 48 (1..720) | Requests unanswered longer appear in `booking_followups.requests`, the dashboard (`stale_requests`) and are flagged `stale`. |

The migration keeps `declared` for every club; the founder's club is switched to `open_confirm` as data.

### Slot rules (`bk_evaluate`, same signature)
- Outside the venue opening hours (`venues.opening_hours` of the facility's venue, else the service venue; club-wide or venue
  blackouts; a slot across midnight) → **`VENUE_CLOSED`** (before: `COACH_UNAVAILABLE`). An admin override lifts it
  (`VENUE_CLOSED_OVERRIDDEN` warning, audited like the availability override).
- Inside the venue hours but outside the declared availability: `declared` → `COACH_UNAVAILABLE`; `open_confirm` (or a family
  request) → allowed with the warning `NEEDS_COACH_CONFIRMATION`, `slot.needs_confirmation = true`, `creates = 'requested'`. A coach
  blackout stays `COACH_UNAVAILABLE` in every mode.
- Requests hold the place: they count for capacity (`bk_session_count` = every non-cancelled booking), create / join the session
  (coach and space exclusion constraints apply), and the unique "one live place per athlete and session" includes them
  (`training_bookings_session_athlete_live_uidx`). Joining a session that only holds requests is a request too.
- Quote / slot also return `within_availability`, `session_pending`, `availability_mode`.

### Lifecycle RPCs (security definer, `search_path` set, tenant + role checked, idempotent with `request_id`)
| RPC | Who | Notes |
|---|---|---|
| `booking_confirm` (changed) | staff | Returns `status` `booked` / `requested`. A request: no auto-invoice, notifications `requested` (coach) instead of `confirmed`. |
| `booking_request_confirm(booking, request_id, notify=true)` | the session coach, admins | `requested` → `booked`, decision recorded (`request_decision`, `request_decided_at/by`), sheet synced, `request_confirmed` to the family (and the coach when an admin decided). A confirmed booking returns `already_decided`; others `NOT_A_REQUEST`. Another coach / org: `BOOKING_NOT_FOUND`; finance / guardian: `NOT_AUTHORIZED`. |
| `booking_request_decline(booking, reason, request_id, notify=true)` | the session coach, admins | Reason required (`REASON_REQUIRED`, ≤ 500). → `cancelled` with the reason, place released (empty session + event cancelled), package entitlement restored (`restore_reason 'declined'`), promo redemption voided, never invoiced. `request_declined` to the family (+ coach when an admin decided). |
| `booking_request_withdraw(booking, request_id)` | a guardian of the athlete | Only family requests that are still open; → `cancelled` (`request_decision 'withdrawn'`), place / package / promo released, `request_withdrawn` to the coach. Other families: `BOOKING_NOT_FOUND`. |
| `family_booking_catalog(athlete)` | guardian of the athlete | Services with `bookable_by_families` (new column, default true; package services false), eligible coaches, package sessions left, open group sessions (times + free places only), `availability_mode`, `enabled` (`bookings_enabled`). |
| `booking_family_quote(payload)` / `booking_family_request(payload, request_id)` | guardian of the athlete | Payload `{athlete_id, service_id, coach_id?, session_id?, starts_at?, notes?, promo_code?}`. Always `requested` (any mode), source `family`, payer forced to the family default (any `payer_id` is ignored), billing `auto` (package when the child has one), no price / availability override, future slots only (`SLOT_IN_PAST`), venue hours apply (`VENUE_CLOSED`). Without a coach the first eligible coach that can take it is picked (inside declared availability first). Notifications `requested` to the coach and the club admins. |
| `coach_booking_requests(coach?)` | coach (own), admin (one coach or the club) | Waiting requests: service, time, place, athlete name, source, `stale`, places. No payer, price or notes. |
| `session_events_pending(event_ids[])` | visible events only | Session events that only hold requests (calendar style "awaiting coach confirmation"). |

`booking_create_invoice` / `bk_create_invoice` refuse a request (`REQUEST_PENDING`); `bookings_to_invoice` and the dashboard
"awaiting invoice" count only confirmed / completed / no-show bookings. `booking_cancel` / `booking_reschedule` refuse requests
(decide them instead). A guardian cannot create or change a request with a direct table write (`BOOKING_REQUEST_MANAGED`,
trigger `trg_bookings_request_guard`).

### Promo codes (shared discount engine)
`promo_code` in the quote / confirm payload (staff) and in family requests (as the legacy `book_training`: families may use
codes, never manual discounts). Applies to a single paid session billed by invoice at the list price (`PROMO_NOT_APPLICABLE`
for package / free, `PROMO_WITH_PRICE_OVERRIDE` with a manual price); `discount_evaluate` decides (scope, validity, usage
limits under lock at confirm; refusals `PROMO_<REASON>` as the shop / training codes). The booking stores `list_price`,
`price_chf` (net), `discount_total`, `promo_code`; `applied_discounts` rows (`source 'booking'`). The invoice gets the list
price line plus one negative line per discount (linked in `applied_discounts.invoice_id / invoice_item_id`). A booking cancelled
/ declined / withdrawn before invoicing voids its redemption.

### Absence reports, corrections, attendance status
- `absence_report` accepts session events: a guardian of the athlete (or the player) with a **confirmed** booking on the session
  (`NOT_BOOKED` otherwise), until the start. Shown on the coach sheet (`attendance_sheet` now previews session events too), on the
  booking detail (`absence_report`) and in the portals (`upcoming[].absence_report`, `can_report_absence`).
- `guardian_attendance_record` serves session events (`session{service_name, coach_name, booking_id, booking_status}`); correction
  requests work on session sheets (`attendance_correction_requests.team_id` is now nullable) and are resolved by an admin or the
  session coach (`attendance_correction_resolve`, `attendance_correction_requests_list`).
- Trigger `trg_marks_booking_status` (on `team_attendance_marks.finalized_status`): present / late → `completed`, unexcused →
  `no_show`, excused → stays `booked` with `attendance_status = 'excused'`; corrections update it. Billing is unaffected.

### Notifications
Kinds `requested`, `request_confirmed`, `request_declined`, `request_withdrawn`; recipient kind `admin`. Templates
`booking_requested` (coach / admins, link `/coach/trainings#booking-requests` or `/admin/bookings/<id>`),
`booking_request_declined` (family, with the reason), `request_confirmed` reuses `booking_confirmation`, `request_withdrawn` reuses
`booking_cancellation`. `booking_notifications_claim` also returns `reason`.

### Screens
| Route | What |
|---|---|
| Services → Online booking (`/admin/services`) | Availability mode + follow-up hours. Service detail: "Families can request this service". |
| `/admin/bookings/new` | Promo code (live discounted quote), "becomes a request" notice, `VENUE_CLOSED` message. |
| `/admin/bookings` | "Awaiting coach confirmation" filter, `stale` marker. |
| `/admin/bookings/<id>` | Request card (source, waiting time, decision) with Confirm / Decline (reason) for admins; discount, attendance marker, absence report. |
| Dashboard bookings card | "Awaiting coach confirmation" tile, stale requests in the follow-up list. |
| `/coach/trainings` | "Booking requests" section with count badge, Confirm / Decline; pending sessions dashed, requests named "(request)". |
| `/parent/bookings` | "Request a session" (→ `/parent/bookings/request`), requests "awaiting coach confirmation" (dashed) with Withdraw, "Report an absence" for confirmed sessions, declined / withdrawn in the changes. |
| `/parent/bookings/request` | Child, service, open group sessions, coach (optional), preferred date / time with the coach's declared times as hints, promo code, package coverage, live quote. |
| `/parent/attendance`, `/parent/attendance/team/<event>`, `/player` | Absence reports and the record page (correction requests) for booked sessions. |
| Calendars | Pending session events in a dashed style with "awaiting coach confirmation". |

Known limitation: the legacy parent booking flow (`book_training`, `/parent/bookings/new`) does not see held requests in its slot
computation (`training_busy`); a conflicting legacy booking joins the held session or is flagged `BOOKING_WITHOUT_SESSION`.

## 13. Booking orders (pricing options, packages, multi-date, recurring, group players, invoices per payer)

Migration `20250420104800_booking_orders.sql` (additive, idempotent). DB tests `tests/db/booking_orders.sql`
(`DB_TEST_PREFIX=bo scripts/db-test.sh tests/db/booking_orders.sql`), unit tests `tests/unit/booking-orders.test.ts`.
TS: `src/lib/booking/orders.ts` (contract, zod, pricing preview, recurrence), `order-form.ts` (form state), `order-data.ts`
(reads), `src/lib/actions/booking-orders.ts` (server actions).

### Why
New Booking could only consume an existing package; packages were sold elsewhere (`/admin/training`), the catalogue returned
package names without prices, and a group booking was one athlete per booking without multi-date, recurrence or "received on".

### Catalogue (source of truth: Services → service page → Pricing, admin + finance)
| Column / table | Meaning |
|---|---|
| `training_services.price_chf` | "1 Session" option (not offered for `kind = 'package'` services) |
| `credit_packages` (service) | package options: `credits` sessions, `price_chf` = **total per athlete** for the option, `validity_days`, `is_active`, `sort_order` |
| `training_services.short_description` | customer-facing, ≤ 280, shown in New Booking |
| `training_services.group_rate_chf` + `pricing_basis` | group services: rate **per player per session**. Only `per_player_per_session` is implemented (check constraint); `per_player_flat` / `per_session_flat` are not offered. Backfilled once from `price_chf` for existing group services |

`training_service_catalog` returns `pricing_options[]` (`{option_id: 'single' \| package id, kind, sessions, total, …}`),
`pricing_missing[]` (`GROUP_RATE`, `PACKAGES`), `short_description`, `group_rate`, `pricing_basis`. `service_pricing_save(service,
payload)` (admin + finance; a removed package that was sold or ordered is deactivated, not deleted). Labels are built in the UI:
"N Session(s)" (`bookingOrders.option.sessions`) + " — " + money (`formatMoney`, e.g. `1 Session — CHF 95.00`, `16 Sessions — CHF 1'280.00`).
A paid service without pricing is refused (`PRICING_MISSING`, "configure … in Services").

### Tables
| Table | Purpose | RLS |
|---|---|---|
| `booking_orders` | org, service, `kind` single/package/group, `option_kind` single/package/existing_package/group, snapshot (`package_id`, `option_sessions`, `list_total`, `agreed_total`, `list_rate`, `group_rate`, `pricing_basis`, `price_override_reason`, `currency`, `billing_category`), `purchase_id`, `coach_id`, `venue_space_id`, `description` (customer-facing, on the invoice), `internal_notes` (staff only), `received_on`, `status`, `request_id` (unique per org) | select admin + finance; insert / update / delete none (RPC only). Audit redacts notes + description |
| `booking_order_participants` | order, athlete (unique per order), `payer_id` (null = family default), `rate` snapshot, `status` | same |
| `training_bookings` + `order_id`, `order_participant_id`, `order_invoice_item_id` | one booking per athlete per date (unchanged model) | unchanged |

Agreed prices are snapshotted on the order, the participant and every booking (`price_chf`, `list_price`): catalogue changes
only affect new orders. The "one invoice per workflow booking" index now applies to bookings without an order
(`training_bookings_invoice_single_uidx`): order bookings share their payer invoice.

### Rules
- **Single** (`1 Session`): exactly one date, one athlete, booking price = agreed total, billed by invoice (0 → free).
- **Package**: the package is sold once (`training_package_purchases` row linked to the order, `status active`,
  `amount` = agreed total, `list_price` = max(list, agreed)), 0..N dates now (≤ sessions), each booking `billing_mode package`
  with one `training_booking_entitlements` row. Later dates: `booking_order_add_dates` (consumes the package, no charge).
  **Existing package** ("use this package"): an active purchase of the athlete for the service, charge 0.
- **Group**: several players, per-player payer and date subset (default all order dates). Charge per player = rate × the
  player's sessions (e.g. rate 30: 4 players on date 1 = 120; 3 of them also on date 2 → 210). One shared `training_sessions`
  row per date (join by service + coach + start), capacity checked per date for all the order's players and under the session
  lock at placement; duplicate athlete refused (`DUPLICATE_ATHLETE`, `ALREADY_BOOKED`).
- **Dates**: an explicit list (one, several, or a weekly rule expanded in the UI by `expandRecurrence`, editable before
  confirming). Every date is evaluated with `bk_evaluate` (availability / venue hours / coach + space conflicts / capacity /
  athlete overlap) plus order checks (`DUPLICATE_DATE`, `ORDER_DATES_OVERLAP`, `DATE_WITHOUT_PLAYERS`). Open availability mode:
  a date outside the declared availability becomes `requested` bookings (as §12).
- Price override (agreed total / rate ≠ catalogue) needs a reason (any staff); availability override: admins + reason.

### RPCs (security definer, `search_path` set, staff re-checked, tenant = `current_org_id()`)
| RPC | Notes |
|---|---|
| `booking_order_quote(payload)` | writes nothing: `{ok, errors[], dates_ok, dates[{starts_at, ok, errors[], athlete_errors[], warnings[], capacity, participants, adding, places_left, creates}], participants[{…, payer, payer_key, sessions, charge}], option{…}, totals{charge, sessions, payers[]}, setup_missing[], pricing_missing[], billing_entity, number_prefix}` |
| `booking_order_confirm(payload, request_id)` | all-or-nothing; order-level refusals are raised (P0001), per-date refusals are **returned** `{ok:false, code:'DATES_UNAVAILABLE', dates}` (nothing stored, retry with the same id); a placement race raises the code with `DETAIL {starts_at, athlete_id}`. Idempotent (`booking_requests` kind `order_confirm` + unique `request_id`; per-booking derived ids) |
| `booking_order_add_dates(order, payload, request_id)` | package sessions / more group dates (`participant_ids` subset); `dry_run: true` = quote |
| `booking_order_create_invoices(orders[], request_id, send=true)` | one invoice per payer (payer record or family default), one line per athlete ("service — athlete — dates (n × rate CUR)", quantity n, unit = rate) + the package line; only confirmed / completed / no-show billable bookings without invoice and the uninvoiced package. Category = the order's billing category (Personal Training → `training` → its number series, e.g. "DL PT"); several orders must share one category and currency (`CATEGORY_MIXED`, `CURRENCY_MIXED`). `SETUP_MISSING` returned. Links `training_bookings.invoice_id` / `order_invoice_item_id` and `training_package_purchases.invoice_id` |
| `booking_order_record_payment(order, invoice, {request_id, amount, method, received_on, reference, note})` | `receipt_record` on an invoice of the order (idempotent) |
| `booking_order_cancel(order, {scope: booking \| participant \| date, …, reason, refund_mode: credit_note \| none, restore_package?}, request_id)` | per booking through `booking_cancel` (credit note for an issued line; an unpaid invoice of only that line is cancelled; a draft loses the line; package restored per policy / staff). Requests are released like a decline. A player with nothing left leaves the order; an order without players is cancelled |
| `booking_order_reschedule(order, {scope: booking \| date, booking_id? \| session_id?, starts_at, coach_id?, venue_space_id?, price?, price_reason?, …}, request_id)` | per booking through `booking_reschedule` (a date moves all its players to one new shared session; a price change goes through a credit / debit note) |
| `booking_order_detail(order)` | order, participants (charge, invoiced, sessions booked / requested / completed / cancelled), dates (shared sessions with bookings + billing status + invoice), package usage (`booked`, `completed`, `available`), invoices per payer (due, paid, balance), totals |
| `booking_orders_to_invoice(limit)` | orders with confirmed uninvoiced charges (finance To Invoice) |
| `service_pricing_save(service, payload)` | see Catalogue |

Changed: `booking_create_invoice` refuses order bookings (`ORDER_INVOICING`); `bookings_to_invoice` leaves them out;
`booking_cancel` refuses `cancel_invoice` on a shared invoice (`INVOICE_SHARED`) and removes a draft line instead of a credit
note; `bk_row` returns `order_id`; `bk_portal_rows` also lists the package invoice of an order (`booking_id` null).

### Screens
| Route | What |
|---|---|
| Services → service page | "Pricing" card (replaces the packages card): short description, 1 Session price, packages (sessions, total, validity, active), group rate + basis, live preview of the options |
| `/admin/bookings/new` | Booking order form: service (+ short description), "Session or Package" (required; packages with totals; "use existing package"), group rate, agreed price + reason, athlete or players (+ Add New Athlete, per-player Bill To and dates), coach / facility, one date / several dates / weekly rule → editable list with per-date availability, received on, description (+ "customer sees" preview), internal notes, per-player / per-payer / total charges. `?classic=1`: the single-booking form (promo codes, joining an open group session) |
| `/admin/bookings/orders/<id>` | Order page: summary, money (charged / not invoiced / invoiced / paid / balance), package usage, players (cancel player), dates with shared rosters (move / cancel a date, move / cancel one booking), invoices per payer (record payment), create invoices, schedule package sessions / add dates |
| `/admin/bookings`, `/admin/bookings/<id>` | link to the order |
| `/admin/finance/to-invoice` | "Booking orders to invoice" (per order, or several orders of one category together) above the single bookings; totals unchanged |
| Coach / parent / player portals | unchanged reads: one session card + roster per date; guardians see their child's sessions and only invoices where they are the payer (shared order invoices de-duplicated) |

### Not done
- Pricing bases other than per player per session (`per_player_flat`, `per_session_flat`): refused (`INVALID_PRICING_BASIS`).
- Promo codes on orders (kept on the classic single-booking form).
- Adding a new player to an existing group order (create another order for the same dates: it joins the shared session).
- Booking notifications are sent per booking (one per date and player); the customer-facing order description is on the
  order page and the invoice, not in the e-mail templates.
- Moving a whole group date to a time that overlaps its current slot is refused (`COACH_BUSY`): the coach still leads the old
  session while the players move one by one; move it to a non-overlapping time or move the bookings individually.
