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
| Booking status vs billing status | `training_bookings.status` keeps its enum: `booked` (shown as **confirmed**), `completed`, `no_show`, `cancelled`. `requested` is translated (`bookingWorkflow.state.requested`) but not created in phase A: staff confirm directly. Billing status is derived (`booking_billing_status`, §3). |
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

- Booking: `booked` (confirmed) → `completed` / `no_show` (existing `mark_training_booking`) or `cancelled`. History is kept (the row
  stays; cancel reason, `cancelled_at`, `cancelled_by`).
- Session: `scheduled` → `cancelled` (last participant left) / `completed`.
- Billing (`booking_billing_status`): `not_billable` (free / trial / price 0 / cancelled before invoicing) · `package`
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
- Not in phase A: absence reports for session events (`absence_report` checks team rosters) — cancel the booking instead.

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

- No pages (admin booking form / detail / finance, portals, athlete profile) — the UI tracks build them on this contract.
- `requested` bookings (parent requests awaiting staff confirmation), discounts / promo codes on workflow bookings (legacy
  `book_training` keeps them), legacy training credits as a billing mode of the new path.
- Absence reports for session events; automatic `completed` / `no_show` from the finalized sheet (use `mark_training_booking`).
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

Not in this phase: absence reports and correction requests for booked sessions in the portals (the parent is asked to contact the
club); the parent record page `/parent/attendance/team/<event>` stays team-only.

