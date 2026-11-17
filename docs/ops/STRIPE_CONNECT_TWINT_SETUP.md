# Stripe Connect + TWINT setup (founder runbook)

**Status:** 12 November 2026. For the founder, with the fractional CTO (see `docs/company/12_CTO_SOLUTION_AI_PLUS_HUMAN.md`) signing off before live mode.
**Goal:** pass **Gate 2**: real TWINT payments on a DLang programme reconcile automatically, with no manual step. Target **18 Dec 2026** (red line 31 Dec, downside 31 Jan 2027). The full gate needs at least 10 real payments; this runbook gets you to the first one (CHF 1).
**Related:** `docs/payments/regional-payments.md`, `docs/LAUNCH_READINESS.md` §8A, `docs/ops/TENANT_ONBOARDING_RUNBOOK.md` §4, `docs/ops/DEPLOY.md`, `docs/ops/ONCALL.md` §5 (secret rotation).

**Labels:** [Repo] = checked in this repository's code. [Verify] = check in the Stripe dashboard/docs or with Stripe support before relying on it. [Confirm] = only the founder knows.

---

## 0. Ground rules (read first)

1. **Never paste a key into a chat, email, ticket, document or commit.** That includes test keys. Keys go only into the hosting provider's environment variables (Vercel) or your local `.env.local` (git-ignored).
2. **Test mode first, always.** Live keys are created only after the full test run in §6 passes and the CTO signs off.
3. **AI agents never get live keys.** For an AI coding session to test against Stripe, the founder adds a **test-mode restricted key** as a secret in the cloud environment settings (§9). Nothing else.
4. **Club money never touches the platform account.** The code charges on the club's own connected account (direct charges) and takes an application fee [Repo]. In production set `STRIPE_CONNECT_REQUIRED=true` so nothing falls back to the platform account.
5. Use **MFA** on the Stripe login. Give the fractional CTO a Developer role, not Administrator, unless agreed.

---

## 1. What the code actually implements [Repo]

| Topic | Implementation | Where |
|---|---|---|
| Money flow | **Direct charges** on the club's connected account (`stripeAccount` header) + `application_fee_amount` | `src/lib/stripe-connect.ts` |
| Account type | **Standard by default**; Express if `STRIPE_CONNECT_ACCOUNT_TYPE=express` | `connectAccountType()` |
| Account creation | `accounts.create` with the club's country, default currency, business name, MCC 7941 (sports clubs), `metadata.org_id` | `ensureConnectAccount()` |
| Onboarding | Stripe-hosted Account Link; refresh URL `/api/stripe/connect/onboard`, return URL `/api/stripe/connect/return`, both on the **club's own host** (see "Return URLs" below) | `src/app/api/stripe/connect/*`, `createOnboardingLink()` |
| Return URLs | Checkout success/cancel and onboarding refresh/return are built server-side from the org's hosts: the host the user is on if it is the org's custom domain or `<slug>.<PLATFORM_ROOT_DOMAIN>`; `NEXT_PUBLIC_SITE_URL` only if the user is on the platform host itself; otherwise the org's canonical host (custom domain, then subdomain). An unknown or spoofed Host header is never used | `tenantReturnOrigin()` in `src/lib/tenant/url.ts`, `src/lib/tenant/return-origin.ts` |
| Express capabilities | `card_payments` + `transfers`, plus `twint_payments` for CH accounts (re-requested for existing Express accounts when the admin reopens onboarding). `STRIPE_CONNECT_REQUEST_TWINT=false` turns the TWINT request off | `src/lib/payments/connect-capabilities.ts` |
| Who may connect | Only a signed-in **admin** of the club (server-side check) | `onboard/route.ts` |
| Payment UI | Stripe **hosted Checkout**; asks for the region's methods (CH: card, TWINT), falls back to automatic methods if one isn't activated | `createInvoiceCheckout()`, `src/lib/payments/methods.ts` |
| Application fee | From `public.resolve_application_fee()` per plan. Defaults: founding 0%, starter 1.5%, club 1%, pro/academy/federation 0.5% | `src/lib/payments/fees.ts` |
| TWINT online | Offered only when the club has a connected account with `charges_enabled`; otherwise TWINT shows as "manual to the club's number" | `src/lib/payments/settings.ts` |
| Webhook | One route, `/api/stripe/webhook`, verifies against `STRIPE_WEBHOOK_SECRET` **or** `STRIPE_CONNECT_WEBHOOK_SECRET`; deduplicates in `stripe_events`; idempotent payment/refund application | `src/app/api/stripe/webhook/route.ts`, `src/lib/payments/stripe-webhook.ts` |
| Instalments | An open invoice split into instalments (club rules in Admin → Payment plans → Settings). One structured reference (QRR/SCOR) per invoice; one QR-bill per instalment with that instalment's amount; per-instalment hosted Checkout (card / TWINT) with `metadata.installment_id`. Payments always land on the invoice and are allocated to the earliest open instalment in SQL | `src/lib/actions/plans.ts`, `src/lib/plans/*`, migration `20250420101000_instalments_recurring_autopay.sql` |
| Recurring fees | Templates + enrolments; the daily cron `/api/billing/cron` issues one invoice per period (idempotent per period) | `src/lib/plans/cron.ts`, `src/app/api/billing/cron/route.ts` |
| Card autopay | Parent saves a card through Stripe Checkout in **setup mode** for a Customer created **on the club's connected account**; we store only `cus_…`, `pm_…`, brand, last 4, expiry and the consent (wording, version, timestamp, who). Due instalments / period invoices are charged with an **off-session PaymentIntent on the connected account** + `application_fee_amount`, idempotency key `autopay:<instalment>:<attempt>`. Declines retry after +3 / +7 days (club setting), then fall back to QR-bill + reminder; 3-D Secure (`authentication_required`) emails the parent a pay link. TWINT cannot be charged off-session | `src/lib/plans/autopay.ts`, `src/lib/plans/webhook.ts` |
| DLANG billing of clubs (SaaS plans) | Separate key and webhook (`STRIPE_BILLING_*`, `/api/billing/webhook`) | `src/lib/platform/billing.ts` — **not needed for Gate 2** |

**Recommendation: Standard accounts with direct charges + application fee** (the code's default). The club has its own full Stripe dashboard, activates TWINT itself, handles its own refunds and disputes, and carries Stripe's fees. DLANG never holds funds. This matches `03_CTO_TECHNOLOGY_STRATEGY.md` §5.

> **Express is possible but not recommended for Gate 2.** For Express CH accounts the code now requests `twint_payments` alongside `card_payments` and `transfers` [Repo, `ensureConnectAccount`; the capability name matches the Stripe SDK types]. [Verify] with Stripe that the platform may request `twint_payments` on Express accounts with direct charges, and that TWINT is enabled in the platform's payment method settings for connected accounts. If Stripe refuses the request at account creation, set `STRIPE_CONNECT_REQUEST_TWINT=false` so onboarding still works (cards only) until Stripe confirms.

---

## 2. Create the platform Stripe account (the GmbH)

1. Go to stripe.com and create an account **in the name of Swiss Preparatory Sports Academy GmbH**, country **Switzerland**.
2. Business details: legal name exactly as in the commercial register, UID (CHE-…), registered address in Vaud, business type "company (GmbH)", website = the platform domain, description "Software for sports clubs: registration, invoicing and payments".
3. Representative and beneficial owners: the founder (ID document, address). Stripe may ask for the register extract.
4. **Payout bank account:** the **"SPSA Tech"** account (CHF). This account receives only DLANG's platform revenue (application fees, and later SaaS subscriptions). **Club money never lands here.**
5. Turn on **MFA**. Invite the fractional CTO as a team member (Developer role) once signed.
6. Keep the dashboard in **Test mode** for everything until §7.

> **[Confirm] Is DLang Basketball the same legal entity as the GmbH?** If the GmbH also runs DLang's camps, DLang's club money and DLANG's platform revenue belong to the same company. Even so, keep them apart: DLang gets **its own connected Stripe account** (§5) with payouts to **DLang's operating bank account, not "SPSA Tech"**. Ask the fiduciary how to book it (one entity, two activities, or a separate association/entity for the club) [Verify, fiduciary].

---

## 3. Activate Connect

1. Dashboard → **Connect** → Get started. Choose **platform** ("Your users get paid", i.e. you build a platform or marketplace) [Verify wording; Stripe changes these screens].
2. Platform profile: industry "Software / SaaS for sports clubs"; who pays: "Your users' customers pay your users directly" (direct charges); account type **Standard** [Verify].
3. **Branding** (Connect settings → Branding): platform name, icon, brand colour. Club admins see this during onboarding.
4. **Countries:** allow **Switzerland** for now (add Liechtenstein if needed). EU countries come with the EU gate (2028).
5. Stripe may review the platform profile; this can take days [Verify]. Start it **now** (week of 16 Nov).
6. **Legal view on fund-holding (AML).** Required before live mode: written confirmation that direct charges + application fee mean the GmbH does not hold third-party funds [Verify — counsel, due 27 Nov 2026].

---

## 4. Enable TWINT

1. TWINT is available on Stripe for **Swiss accounts, CHF only** [Verify, current Stripe docs and pricing].
2. With **direct charges on Standard accounts, TWINT must be activated on each club's connected account**, not only on the platform. The club admin does this in its own Stripe dashboard → Settings → Payment methods → TWINT (or you guide them through it on a call) [Verify].
3. On the platform account, activate TWINT as well (test mode) so you can test the founding-club fallback locally.
4. Check: TWINT refund window, payout timing, and per-transaction fees (the founder plan uses 1.9% + CHF 0.30) [Verify]. Card and TWINT fees are paid by the club on direct charges.
5. TWINT in test mode: Checkout shows a Stripe test page where you authorise or decline the payment [Verify].

---

## 5. Environment variables (names from `.env.example` only)

Set these in **Vercel → Project → Settings → Environment Variables**, separately for **Preview/Staging** (test keys) and **Production** (live keys, only at §7). Never in code.

| Variable | Test mode (staging) | Live mode (production) | Notes |
|---|---|---|---|
| `STRIPE_SECRET_KEY` | `sk_test_…` of the platform account | `sk_live_…` | Server-only. The env check also accepts restricted keys (`rk_…`) [Repo] |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | `pk_test_…` | `pk_live_…` | Public by design |
| `STRIPE_WEBHOOK_SECRET` | `whsec_…` of the **platform** endpoint (§6) | new live `whsec_…` | Required in production [Repo] |
| `STRIPE_CONNECT_WEBHOOK_SECRET` | `whsec_…` of the **connected accounts** endpoint (§6) | new live `whsec_…` | Club payments arrive here |
| `STRIPE_CONNECT_ACCOUNT_TYPE` | `standard` | `standard` | See §1 |
| `STRIPE_CONNECT_REQUEST_TWINT` | `true` (default) | `true` | Express only: request `twint_payments` for CH accounts; `false` = don't [Verify] |
| `STRIPE_CONNECT_REQUIRED` | `false` (lets you test the fallback) | **`true`** | Production must never charge on the platform account |
| `NEXT_PUBLIC_SITE_URL` | staging URL | `https://app.<your root domain>` | Platform host. Stripe return URLs use it only when the user is on this host; club hosts come from the org (custom domain / `<slug>.PLATFORM_ROOT_DOMAIN`) |
| `PLATFORM_ROOT_DOMAIN` | staging root domain | your root domain | Needed so return URLs can target `<slug>.<root>` |
| `STRIPE_BILLING_SECRET_KEY`, `STRIPE_BILLING_WEBHOOK_SECRET` | optional | leave unset until DLANG bills clubs (Q2 2027) | DLang is on the founding deal |
| `CRON_SECRET` | random 32+ chars | different random value | Vercel Cron sends it as `Authorization: Bearer …` to `/api/billing/cron` (recurring invoices, reminders, autopay). Without it the route answers 401 and nothing is billed automatically |

After setting them: `APP_ENV=production node scripts/deploy/check-env.mjs <file>` (see `docs/ops/DEPLOY.md`) and check `/api/health` with the health token. Redeploy so the new values are used.

---

## 6. Webhook endpoints (test mode first)

> **Order matters (learned on staging, 17 Nov 2026):** activate **Connect** on the platform account (Dashboard → Connect → Get started) *before* creating the "connected accounts" webhook endpoint. An endpoint created earlier with `connect=true` stayed enabled but received no connected-account events (Stripe showed `pending_webhooks: 0` while nothing arrived). If club payments succeed in Stripe but invoices stay unpaid and `stripe_events` is empty, delete and recreate the Connect endpoint and update `STRIPE_CONNECT_WEBHOOK_SECRET`.

Create **two** endpoints, both pointing to the same URL: `https://<NEXT_PUBLIC_SITE_URL host>/api/stripe/webhook`. The route is excluded from the auth middleware [Repo].

| Endpoint | "Listen to" | Signing secret goes into |
|---|---|---|
| Platform | Events on **your account** | `STRIPE_WEBHOOK_SECRET` |
| Connect | Events on **connected accounts** | `STRIPE_CONNECT_WEBHOOK_SECRET` |

Subscribe both to exactly the events the code handles [Repo, `stripe-webhook.ts`]:

```
checkout.session.completed
checkout.session.async_payment_succeeded
payment_intent.succeeded
payment_intent.payment_failed
payment_intent.requires_action
setup_intent.succeeded
payment_method.detached
payment_method.updated
payment_method.automatically_updated
charge.refunded
charge.refund.updated
refund.updated
charge.dispute.closed
account.updated
account.application.deauthorized
```

The five events added for instalments and autopay (2026-11):

| Event | What the code does |
|---|---|
| `checkout.session.completed` (mode `setup`, `metadata.purpose=autopay_setup`) / `setup_intent.succeeded` | Reads the card's brand / last 4 / expiry from the SetupIntent's payment method on the club's account and activates the family's mandate (`autopay_activate`, checks the connected account); a replaced card is detached in Stripe |
| `payment_intent.succeeded` with `metadata.autopay_charge_id` | Records the payment on the invoice (same path as any card payment) and closes the autopay attempt |
| `payment_intent.payment_failed` with `metadata.autopay_charge_id` | Records the decline, schedules the retry (or the QR-bill fallback) and emails the family |
| `payment_intent.requires_action` | 3-D Secure needed: emails the parent a link to pay that instalment on-session |
| `payment_method.detached` / `payment_method.updated` / `payment_method.automatically_updated` | Deactivates the mandate / refreshes the card expiry (card updater) |

Other events are acknowledged and ignored. Later, for DLANG's own SaaS billing: a third endpoint at `/api/billing/webhook` for `checkout.session.*`, `customer.subscription.*`, `invoice.*` (not needed for Gate 2).

---

### 6.1 Saved cards and autopay on connected accounts

Nothing extra is needed on the club's side beyond card payments being active; on the platform:

1. **Connect → Settings → Payment methods (for connected accounts):** keep **Cards** enabled. Autopay is card-only (TWINT, being approved in the app for each payment, cannot be charged off-session; it stays available per instalment).
2. **Settings → Payments → Checkout:** Checkout in `setup` mode is used to save the card; no "save payment details" toggle is needed because the session is created in setup mode for a Customer on the connected account.
3. **Card updater / 3-D Secure:** nothing to switch on. Stripe updates expiring cards automatically where the issuer supports it (`payment_method.automatically_updated`); SCA exemptions for merchant-initiated transactions are requested by Stripe because the PaymentIntent is created with `off_session: true` and the card was saved with a setup intent (mandate). When the bank still asks for authentication the app emails the parent a pay link.
4. **Webhooks:** add the five events above to **both** endpoints (the Connect endpoint is the one that receives them for club accounts).
5. **Cron:** `vercel.json` schedules `GET /api/billing/cron` daily at 05:00 UTC (06:00/07:00 Zurich). Set `CRON_SECRET` in Vercel (§5). Running it more than once a day is safe (every step is claimed in SQL).
6. **Club settings:** Admin → Payment plans → Settings: turn on *instalments* (products, counts, minimum, fee, schedule) and *card autopay* (retry days, consent wording version).
7. **Test (test mode):** save card `4242 4242 4242 4242` as a parent (Payment plans & autopay), split an invoice in 3 with the first instalment due today, run the cron with `curl -H "Authorization: Bearer $CRON_SECRET" https://<staging>/api/billing/cron`; the instalment is paid. Then repeat with `4000 0000 0000 9995` (insufficient funds: retry scheduled, family emailed), `4000 0027 6000 3184` (3-D Secure required: pay-link email) and `4000 0000 0000 0069` (expired: immediate QR-bill fallback).

---

## 7. Test-mode run (staging), then live

### 7.1 Test mode (week of 23 Nov)

1. Deploy staging with test keys (§5) and the two test webhook secrets (§6).
2. Sign in to staging as DLang's **club admin** → **Settings → Online payments → Connect Stripe account** (`/admin/settings/payments`, which calls `/api/stripe/connect/onboard`).
3. Complete Stripe's hosted onboarding with **test data** (Stripe shows test values for ID and bank). You return to Settings with status *ready* or *pending*.
4. Activate TWINT on the test connected account (§4.2).
5. As a test parent: create a small invoice (CHF 1), open it, pay with **TWINT** and once with a test **card**.
6. Check: the invoice is marked paid without any manual step; a row exists in `stripe_events`; the payment shows on the connected account (not the platform) with the application fee (0% on the founding plan, so no fee line).
7. Failure cases: decline a TWINT payment; resend the same webhook from the dashboard (must be a no-op, "duplicate"); refund from the club's dashboard (refund row appears).
8. Run `scripts/deploy/smoke-test.sh` against staging.

**Return-URL check in staging [Repo, resolved in code]:** onboarding return and Checkout success/cancel URLs now go back to the host the user started on when it belongs to the club (`dlang.<root>` or its custom domain), so login cookies are still there. Check it once on staging: start onboarding and a CHF 1 Checkout from `dlang.<staging root>` and confirm you return there signed in, not on a login page. `PLATFORM_ROOT_DOMAIN` must be set for this.

### 7.2 Go live (after CTO sign-off and the AML view)

1. Toggle the dashboard to **Live**. Re-check Connect settings, branding, countries and TWINT in live mode (they are separate from test).
2. Create **live** webhook endpoints (§6) and put the live secrets and keys into the **Production** environment only. Set `STRIPE_CONNECT_REQUIRED=true`.
3. Redeploy production; run the env check and smoke test.

---

## 8. DLang connects its club account, then the first real CHF 1 TWINT payment

1. DLang's club admin signs in to production → **Settings → Online payments → Connect Stripe account**.
2. Stripe-hosted onboarding for DLang: legal entity [Confirm, §2], representative ID, **DLang's operating bank account** (not "SPSA Tech"). Start early: identity checks can take days [Verify].
3. In DLang's own Stripe dashboard (live): **activate TWINT** and cards.
4. Back in the app, Settings → Online payments shows *connected / charges enabled* (the `account.updated` webhook also updates this).
5. Create a real invoice of **CHF 1.00** to a family member who has agreed to test (synthetic names are fine for the programme; use a real TWINT app to pay).
6. Pay with **TWINT** via the parent invoice page.
7. Within a minute: invoice **paid**, payment visible in Admin → Payments, event in the webhook log, money on DLang's connected account. No manual step.
8. Refund the CHF 1 from DLang's Stripe dashboard and confirm the refund appears in the app.
9. Record date, time and outcome in `docs/ops/CHANGELOG.md` and the weekly review. **This is the first Gate 2 payment.** Then run the winter-camp pilot with 5–10 families to reach ≥10 payments, including a failure and a duplicate case.

If anything fails, follow `docs/ops/INCIDENT_RESPONSE.md`; payments remain the only engineering priority until Gate 2 is met.

---

## 9. Letting an AI coding session test against Stripe (test mode only)

The founder offered to give the AI agent access. Do it **only** this way:

1. In the Stripe dashboard (**Test mode**) → Developers → API keys → **Create restricted key**. Name it e.g. "agent-test". Grant only what the code calls [Repo]: Connect accounts and account links (write), Checkout Sessions (write), PaymentIntents (write), Charges (read), Refunds (read), Webhook endpoints (read) [Verify permission names and that restricted keys work with the connected-account header].
2. In the cloud coding environment's **settings, add it as a secret / network secret** (the agent can trigger the environment's secure credential form; you type the value there, never into the chat). Use the variable name `STRIPE_SECRET_KEY` so the code picks it up.
3. **Never** give live keys, the live webhook secrets, production Supabase keys or real family data to an AI session.
4. Revoke the restricted key after the testing session or rotate it monthly (`docs/ops/ONCALL.md` §5).

---

## 10. Later: cross-border Connect for a future US free pilot

A Swiss platform with a **US connected account** (a US club paid in USD) is a different setup: cross-border platform rules, US KYC, US tax forms, and whether Standard accounts with direct charges are allowed from a CH platform to US accounts **[Verify with Stripe]**. It is also behind the US gate (exploration not before H2 2029, `00_EXECUTIVE_PLAN.md`) and needs `privacy-compliance-officer` (COPPA/FERPA) first. Do not enable US in Connect countries until then. A free pilot means a 0% application fee, which the fee schedule already supports (`founding` plan).

---

## 11. Checklist

- [ ] Platform account in the GmbH's name (CH), MFA on, payout to "SPSA Tech" (§2)
- [ ] [Confirm] DLang's legal entity and bank account for its connected account (§2)
- [ ] Connect activated, Standard, Switzerland, branding set; platform review started (§3)
- [ ] Written AML / fund-holding view (counsel), due 27 Nov (§3.6)
- [ ] TWINT checked for CH accounts and pricing [Verify] (§4)
- [ ] Staging env vars set (test keys), env check green (§5)
- [ ] Two test webhook endpoints with the 15 events (§6)
- [ ] `CRON_SECRET` set; Vercel Cron enabled for `/api/billing/cron`; autopay test cards pass (§6.1)
- [ ] Test run passes incl. decline, duplicate, refund (§7.1); return to the club host after Stripe checked on staging
- [ ] CTO sign-off; live keys and live webhooks in Production only; `STRIPE_CONNECT_REQUIRED=true` (§7.2)
- [ ] DLang connected, TWINT active, CHF 1 TWINT paid, reconciled and refunded (§8)
- [ ] ≥10 real DLang payments reconciled automatically → **Gate 2** (18 Dec / 31 Dec / 31 Jan)
