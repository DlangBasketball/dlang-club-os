# Regional payments (CH / EU / US)

Club fees are collected in each club's own currency, on the payment rails its
members expect, and paid straight into the club's own Stripe account.

## Method matrix

| Region | Online (Stripe, club's connected account) | Offline (reconciled by finance) |
|---|---|---|
| CH / LI | Card, Apple Pay, Google Pay, TWINT (CHF) | Swiss QR-bill (QRR), bank transfer, TWINT to club number |
| EU / EEA | Card, wallets, SEPA Direct Debit (EUR, opt-in), iDEAL (NL), Bancontact (BE) | SEPA credit transfer with RF reference, optional EPC QR |
| US | Card, wallets, ACH Direct Debit (USD, opt-in) | Cash / check (manual) |
| Other | Card, wallets | Bank transfer |

Source of truth: `src/lib/payments/methods.ts` (pure, unit-tested). SEPA and ACH
debits settle in 3–5 business days; the invoice flips to paid when Stripe sends
`payment_intent.succeeded` / `checkout.session.async_payment_succeeded`.

## Data model (migration `20250420091800_regional_payments.sql`)

- `payment_method` enum: + `sepa_debit`, `ach`, `ideal`, `bancontact`, `apple_pay`, `google_pay`.
- `invoices.currency` / `payments.currency` default from the organization; a payment must match its invoice currency.
- Invoice tax: `subtotal_amount`, `tax_rate`, `tax_amount`, `tax_label`, `tax_inclusive`, `reverse_charge`, `tax_exempt_reason`, `buyer_tax_id`. A trigger keeps net + tax = total and locks tax once money has been received.
- `organizations.payment_settings` jsonb: enabled methods, creditor, IBAN / QR-IBAN / BIC, TWINT number, SEPA / ACH / EPC toggles, tax defaults, `stripe` block (service-role only), `plan_code`.
- `platform_fee_schedules`: application fee per SaaS plan (bps + fixed). `resolve_application_fee()` applies the org override.
- `stripe_events`: webhook idempotency log.
- `payment_plans` + `payment_plan_installments`: installment plans on an invoice and recurring membership fees. RPCs: `installment_schedule`, `create_installment_plan`, `create_recurring_plan`, `run_recurring_billing`, `installments_due`.
- Refunds are new, negative `refunded` payment rows (payments stay append-only).
- CH / LI orgs keep the Swiss QRR reference unchanged. Other orgs get an ISO 11649 `RF…` reference.

## Setup checklist

1. Apply the migration. Run `testing/regional_payments_test.sql` on a scratch database.
2. In the Stripe dashboard, enable Connect for the platform (Standard by default; set `STRIPE_CONNECT_ACCOUNT_TYPE=express` for Express).
3. Add two webhook endpoints, both pointing at `/api/stripe/webhook`:
   - Platform endpoint → `STRIPE_WEBHOOK_SECRET`
   - Connect endpoint ("Events on connected accounts") → `STRIPE_CONNECT_WEBHOOK_SECRET`

   Events: `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `payment_intent.succeeded`, `payment_intent.payment_failed`, `charge.refunded`, `charge.refund.updated`, `refund.updated`, `charge.dispute.closed`, `account.updated`, `account.application.deauthorized`.
4. A club admin opens **Settings → Online payments → Connect Stripe account** (`/api/stripe/connect/onboard`) and completes Stripe onboarding.
5. On the connected account, the club activates TWINT / SEPA Direct Debit / iDEAL / Bancontact / ACH in its Stripe payment-method settings. If a method in our matrix isn't activated, Checkout falls back to Stripe's automatic methods.
6. Schedule `select public.run_recurring_billing(org_id)` daily per org (pg_cron or a server cron with the service role) to issue recurring membership invoices.

Founding-club fallback: with no connected account and `STRIPE_CONNECT_REQUIRED` unset, online payments go to the platform Stripe account, which is how the system worked before Connect.

## Tests

- `npm run test:payments` runs the unit tests for the pure helpers (currency minor units, tax, method matrix, schedule, fees, EPC QR). It uses Node's built-in test runner.
- `testing/regional_payments_test.sql` contains the SQL assertions (currency defaults, tax trigger, QRR/RF references, idempotent Stripe payments and refunds, Connect guards, installments, recurring billing).
