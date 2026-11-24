# Service instalments (pay a service booking in 1–4 payments)

Migration: `supabase/migrations/20250420105400_service_instalments.sql`
Tests: `tests/db/service_instalments.sql`, `tests/unit/service-instalments.test.ts`

## What it does

An eligible training service can be paid in 1, 2, 3 or 4 payments. Staff choose
the number of payments in **New Booking** (orders: single session, package,
several dates, group with several payers). Parents choose it when they
**request a session** in the parent app. One payment (pay in full) is the
default and is exactly today's behaviour.

## Eligibility (data, not code)

`training_services.max_instalments smallint not null default 1`, checked
`between 1 and 4`. 1 means pay in full only. The server never allows more than
4 (`service_instalments_max()`), whatever is stored. Clubs set the value on the
service page (Services → service → **Installments allowed**, admin + finance,
`service_instalments_save`). There are no service ids in code or migrations;
a club's value is set as data.

## Data model: the total is counted once

The existing instalment model from `20250420101000_instalments_recurring_autopay.sql`
is reused unchanged:

- One invoice per payer, as before (`booking_order_create_invoices`,
  `booking_create_invoice`). The invoice total is what the payer owes, after
  discounts and credits.
- One `payment_plans` row on that invoice (`kind 'installments'`,
  `source 'service'`, no fee) with its `payment_plan_installments`. The
  instalments only split the invoice's outstanding balance
  (`invoice_amount_due - invoice_net_paid`); they are not invoices.
- Payments are recorded on the invoice through the existing workflows (order
  detail → record payment, invoice page, receipts, Stripe, QR-bill).
  `refresh_installment_status` marks instalments paid oldest first and rolls
  any overpayment forward. Family balance, finance reports and revenue read
  the invoice, so nothing is counted twice.
- As for every plan, the invoice due date becomes the last instalment's due
  date; reminders and dunning per instalment use the existing plan jobs.

## Where the choice is stored

| Flow | Column | RPC (wrapper around the existing RPC) |
|---|---|---|
| Staff New Booking (orders) | `booking_orders.instalment_count`, `instalment_dates` (+ `instalment_dates_by`) | `booking_order_confirm_plan(payload, request_id)` → `booking_order_confirm` |
| Parent request | `training_bookings.instalment_count` | `booking_family_request_plan(payload, request_id)` → `booking_family_request` |

Payload keys: `instalments` (1–4, default 1) and, staff only,
`instalment_dates` (`["YYYY-MM-DD", ...]`, one per payment). The wrappers check
the role, the tenant (`current_org_id()`), the service's maximum, the 1–4
bounds and the dates, then call the unchanged booking RPC with the same request
id. A retry with the same request id replays the booking RPC and keeps the
stored choice (it is written once, by the first call). An existing package
(nothing to pay) and a package-covered parent request refuse more than one
payment (`INSTALMENTS_NOTHING_TO_SPLIT`).

Server actions: `confirmOrder(input, requestId, plan)` and
`createFamilyRequest(input, requestId, instalments)`; services editor:
`saveServiceInstalments(serviceId, max)`.

## When the plan is created

A deferred constraint trigger on `invoices` (`trg_invoices_service_plan`,
fires at COMMIT) attaches the plan when an invoice is issued (created as sent,
or a draft sent later) and it bills bookings whose order / booking chose more
than one payment. At commit the lines, total and booking links exist. It calls
`svc_plan_attach(invoice)`, which:

1. returns the existing plan if the invoice already has one (idempotent: a
   retried invoice run or a second issue finds it);
2. reads the agreed terms of the invoice's bookings (`svc_invoice_terms`). An
   invoice that bills orders with different terms gets no plan (audited
   `SERVICE_PLAN_SKIPPED`);
3. splits the outstanding balance (`service_instalment_split`) and creates the
   plan with `plan_create_internal` (the same function membership and EYBL
   plans use).

For every other invoice (membership, EYBL, camps, shop, manual), the trigger
returns at once. A failure never blocks issuing the invoice: the invoice stays
payable in full and `SERVICE_PLAN_ATTACH_FAILED` is written to `audit_logs`.

Group orders: one invoice per payer (unchanged), and each payer invoice gets its
own plan on its own total. Dates added later to a group order are invoiced
separately and get their own plan with the same number of payments.

## Split rule (SQL authoritative, TS mirror)

`service_instalment_split(total, count, currency)` = `plan_split` restricted to
1–4: equal shares in minor units, and the **last** payment absorbs the
rounding, so the sum is always the total.

| Total | Payments | Amounts |
|---|---|---|
| 450 | 4 | 112.50, 112.50, 112.50, 112.50 |
| 550 | 3 | 183.33, 183.33, 183.34 |
| 100 | 3 | 33.33, 33.33, 33.34 |

TS mirror: `serviceInstalmentSplit` in `src/lib/booking/instalments.ts`
(same results, unit-tested). The forms use it for the preview only; the server
recomputes everything from the issued invoice.

## Due dates

- **Default:** the first payment is due on the invoice due date (issue day +
  the booking invoice term, `bk_settings.invoice_due_days`; today if later),
  then the same day each following month, clamped to the month end
  (31 Jan → 28 Feb → 31 Mar). `service_instalment_dates`.
- **Staff dates (admin / finance only):** editable in New Booking. One date per
  payment, strictly ascending, not before today, at most 12 months ahead
  (`service_instalment_dates_error`). Parents cannot send dates
  (`NOT_AUTHORIZED`). If staff dates are already in the past when the invoice
  is issued, the default rule applies and `SERVICE_PLAN_DEFAULT_DATES` is
  audited. After creation, finance can still reschedule unpaid instalments in
  Finance → Payment plans (existing `plan_reschedule`).
- The preview in the form uses today + the invoice term. When the invoice is
  issued later, the default dates move with it.

## Where it is displayed

- Staff New Booking (`/admin/bookings/new`): choice, then per payer the total,
  each payment and its due date (editable) before confirming.
- Parent request (`/parent/bookings/request`): choice, then the total, each
  payment and its due date (read-only) before sending.
- Admin order detail (`/admin/bookings/orders/[id]`): payment schedule per payer
  invoice (amounts, due dates, status, paid, outstanding), or the chosen number
  of payments before invoicing.
- Parent booking detail (`/parent/bookings/[id]`): the same for the family's
  invoice.
- Existing views, unchanged and now including these plans: invoice detail
  (`/admin/invoices/[id]`, `/parent/invoices/[id]`, with per-instalment QR-bill
  and online payment), Finance → Payment plans (`/admin/payment-plans`),
  parent payment plans (`/parent/payment-plans`), family balances.

## Unchanged

Club Membership and EYBL instalment code paths are not redefined
(`plan_choose_internal`, `selection_plan_internal`, `membership_issue`,
`club_installment_schedule`, `plan_split`, `plan_due_dates`). Regression checks
pin their output (`tests/db/service_instalments.sql` section J, unit tests).
Existing service bookings keep their terms: no backfill, and an invoice whose
bookings chose one payment never gets a plan. The `payment_plans.source` check
gained the value `service` (superset).

## Errors (`bookingWorkflow.errors.<CODE>`)

`INSTALMENTS_NOT_ALLOWED`, `INSTALMENTS_OUT_OF_RANGE`,
`INSTALMENT_DATES_INVALID`, `INSTALMENTS_NOTHING_TO_SPLIT`, plus the existing
`NOT_AUTHORIZED`, `SERVICE_NOT_FOUND`.

## Reads

- `service_instalment_info(service_ids)`: maximum per service of the caller's
  club, the invoice term and the club's today (forms).
- `booking_instalment_choice(booking_id)`: count, dates and invoice of one
  booking (staff, or a guardian of the athlete).
