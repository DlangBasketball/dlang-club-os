# Public entry and guardian consent

Migration `supabase/migrations/20250420105900_public_entry_guardian_consent.sql` · DB suite `tests/db/public_entry_consent.sql` · unit tests `tests/unit/public-entry.test.ts`.

Builds on participant profiles (`docs/participant-profiles.md`) and club approval / next-step labels (`20250420105800_club_approval_status.sql`, `src/lib/status/next-step.ts`).

## 1. Where new customers enter

| Entry point | Route | What happens |
|---|---|---|
| Welcome screen of the club (public hub at `/` on the club host and `/club`) | `EntryPoints` (`src/components/entry/entry-points.tsx`) | Three cards: **Book a camp** (`/register/camps`), **Book personal training** (`/book`), **Join the club** (`/join?intent=join`). Signed-in visitors go straight to `/parent/camps`, `/parent/bookings/request`, `/parent/membership`. |
| Public camp page `/register/[programSlug]` | `AppBookingCallout` | Signed out: "Create an account" (`/join?intent=camp&next=/parent/camps/<id>`) or "Sign in" (via `/join/complete`). Guest checkout on the page still works. |
| Public training page `/book/[clubSlug]` | `AppBookingCallout` | Same, `next=/parent/bookings/request`. A signed-in user of another club can "Continue as a customer of this club". |
| Login page | link | "New to the club? Create an account" → `/join?next=<redirect>`. |
| `/join` | `src/app/join/*` | Club-customer sign-up (NOT `/signup`, which is the SaaS club sign-up). Choice "Book a camp or training" / "Join the club", name, e-mail → magic link (password sign-in only where `NEXT_PUBLIC_AUTH_PASSWORD_LOGIN=true`). Signed in: "Continue with this club". |
| `/join/complete` | route handler | Destination of the auth callback: runs `family_bootstrap` and returns to `next` (safe same-origin path) or the intent's default (`/parent/camps`, `/parent/bookings/request`, `/parent/membership`). |

`next` is accepted only as a same-origin absolute path (`safeNext`: no `//`, `\`, scheme, whitespace or control characters, ≤ 512 chars). The club is the host's tenant; on the platform host the page's public club slug is passed as `club=` (a slug, never an org id) and resolved in SQL.

A signed-in account without any club role used to loop between `/` and `/login`; `/` now sends it to `/join`.

## 2. `family_bootstrap(p_org_slug)` — a customer without invitation

The gap: `handle_new_user()` linked invited users only; a plain sign-up had `profiles.org_id = null` and no family, so `/parent` was unreachable.

* `family_bootstrap(slug)` (signed in): org from the public slug (`active` / `trial` clubs) → the caller's existing family in that club, else a new **guest** family (`families.membership_status = 'guest'`, caller primary guardian, `receives_emails`). Sets `profiles.org_id` only when null; the `family_members` trigger adds the `parent` org membership. Idempotent (advisory lock + lookup). Grants nothing else: no membership, team, invoice. Refused for a suspended membership.
* `handle_new_user()` does the same at sign-up when no invitation exists and the sign-up metadata carries `club_slug` (set by `/join`). Never blocks the sign-up.
* `/join/complete` (GET) never switches an existing current club; if the account belongs to another club, `/join` asks for confirmation and the POST server action switches (`switch_current_org`). A guest family has nothing to onboard, so `onboarding_completed_at` is stamped; invited member families keep their onboarding.

Camps and Training show in the parent app for guest families (only `PROGRAM_ONLY_HIDDEN_HREFS` are hidden). Adults book for themselves with "Myself" (participant profiles, 18+ on the activity date); minors are booked by a guardian, with the existing consent capture in the camp / booking flows.

## 3. Public registration without duplicates

* `register_public` (`/register/[programSlug]`, non-camp programmes): the server action passes `account_profile_id` from the session; the RPC honours it **from the service role only**. A signed-in caller's family (or bootstrapped guest family) and an existing child of that family with the same normalised name + DOB are reused; no parent invitation is created. Anonymous guests keep the old behaviour (family found by contact e-mail, new child rows, pending invitation).
* Programmes with `requires_club_approval` (Workstream C) refuse the direct path (`CLUB_APPROVAL_REQUIRED`): a signed-in visitor's children are resolved the same way and one `club_request_submit` per child is sent (→ `/parent/club-programmes`); an anonymous visitor is asked to sign in / create an account.
* Public camp checkout (`submitCampPublic`): signed in → `public_entry_resolve_children` (service role) + `register_camp` in parent mode for that family. Same COPPA gate as the public mode. Anonymous checkout unchanged.

## 4. "Someone else": booking for another family's child

### Data

| Table | Purpose |
|---|---|
| `participant_bookers` (org, athlete, profile, scope `status_only`, relation, display name / DOB as typed) | The booker ↔ participant link. The booker reads their own rows; admins of the club read all. Insert / update through RPCs only. |
| `guardian_consent_requests` (org, athlete, booker, guardian name / e-mail / phone, relation, `existing_child`, `token_hash`, `expires_at`, status `pending / accepted / declined / expired / revoked`, `registration_ids`, `booking_ids`, `order_ids`, `consent_forms` snapshot, `accepted_keys`, `accepted_by/at`, …) | One request per booker + child while pending. Admins read through RLS; booker and guardian only through whitelisting RPCs. |
| `registrations.guardian_consent_status / _request_id`, same on `training_bookings` | The hold marker (`awaiting → accepted / declined / expired / revoked`). |

Both tables: `org_id` + index, RLS on every verb, restrictive tenant isolation, `updated_at`, audit trigger (token hash redacted).

### Flow

1. **Participant** — `createThirdPartyParticipant` (A's contract, now implemented) → `third_party_participant_create`: first / last name, DOB, sex, guardian name + **e-mail (required: verification is by e-mail)** + phone, relation. The guardian e-mail cannot be the booker's own. A's private match runs first:
   * the booker's own child → normal family booking (`kind: "child"`);
   * an existing child of the club → that child is targeted, the request goes to **its existing guardians**; the booker gets the same answer shape and learns nothing;
   * otherwise a **holding guest family with no members** + the athlete.
   The booker is never added to any `family_members`.
2. **Hold** — camp: `third_party_camp_hold` creates one registration `pending` (capacity counts `pending + confirmed` everywhere, so the place is held), `registered_by` = booker, price snapshot of the option, **no invoice**. Age on the edition's first day: under the band (e.g. < 6) / above the maximum refused; the approval band (6–7) is held too. Training: `third_party_training_request` creates the booking `requested` (counts toward the session), payer = the booker's `billing_payers` row (kind `other`), billing `invoice` (never the child's family's package), no promo codes. Both are idempotent on `request_id` and refuse a third-party participant mixed with own children (`MIXED_PARTICIPANTS`).
3. **E-mail** — a fresh 32-byte token (base64url) is generated on the server; only its SHA-256 hex is stored (rotated when another place is held; the latest link is valid). Template `guardian_consent_request` (`src/lib/notifications/templates.ts`) through `dispatchNotification` (logged; `EMAIL_TEST_REDIRECT` applies on staging): participant first name, activity, dates, booker **name** (no contact data), hold expiry, link `/consent/<token>`.
4. **Guards** — `trg_registrations_gc_guard` / `trg_training_bookings_gc_guard`: while `awaiting`, the record cannot become `confirmed` / `completed` / `pending_approval` / `booked` / `no_show` or get an invoice (`CONSENT_PENDING`), whatever the path (staff confirm, direct update); the consent columns change only through the consent RPCs (`CONSENT_LOCKED`). Not confirmed ⇒ not on the confirmed-only rosters (Workstream C).
5. **Consent page** `/consent/[token]` (public, `noindex`, `no-referrer`): `guardian_consent_view` returns the club, participant name, activity and dates, booker name, relation, required / optional forms, masked e-mail. Never DOB, medical data, the booker's contact.

### How the guardian is verified

* **Accept requires a signed-in account** (`guardian_consent_accept`). For a new child, the caller's **confirmed sign-in e-mail from `auth.users`** (not the editable `profiles.email`) must equal the e-mail the request was sent to (`EMAIL_MISMATCH` otherwise; unconfirmed e-mails fail). Signing in with a magic link to that address proves ownership; the page says which address (masked). For an existing child, the caller must be a guardian of that child's family (`NOT_GUARDIAN`). The booker can never consent (`BOOKER_CANNOT_CONSENT`).
* Every required form must be ticked (`CONSENT_REQUIRED`).
* **Decline needs no account**: the e-mailed link is the credential (`guardian_consent_decline`; for a signed-out visitor the server calls it with the service role after hashing the token — anon has no EXECUTE).

### On accept

* `consent_acceptances` for each ticked form (version, `accepted_by` = guardian); where COPPA applies (US club, under 13) a verified `parental_consents` row, method `email_plus`, evidence = the request id.
* The guardian becomes the child's **primary guardian** (`family_members`, `can_pay`, `can_see_medical`, `receives_emails`) of the holding family — or, if they already have a family in the club, the child moves into it and the empty holding family is removed. Their club becomes current if they had none (or after acceptance via the server action).
* Camp: standard band → `pending` + camp invoice **to the booker** (`payer_kind 'other'`, `payer_profile_id`, `payer_id`), confirmed when paid in full (`invoices_gc_confirm`); approval band → `pending_approval` (existing camp age approval; the invoice the admin's approval creates is re-addressed to the booker by `trg_registrations_gc_payer`); free → confirmed.
* Training: consent `accepted`, the booking stays `requested` and staff are notified (`bk_enqueue_notifications`); the coach confirms under the existing rules.
* The booker is notified (in-app + e-mail, the name they typed only).

### Decline, expiry, withdrawal

* Decline / expiry / booker withdrawal (`guardian_consent_revoke`) cancel the held registration / booking and free the place (`gc_cancel_items`).
* **72-hour hold** (`gc_hold_hours()`, `CONSENT_HOLD_HOURS`): `expires_at` is set when the first place is held. Expiry runs **lazily** on every read that matters (consent page, accept / decline, booker status, new holds) and in the **scheduled job** `GET /api/consent/cron` (`Authorization: Bearer $CRON_SECRET`, e.g. every 15 minutes) → `guardian_consent_expire()` (service role) → notices to the booker and (expired) the guardian e-mail; `outcome_notified_at` prevents duplicates.

## 5. The booker's view — `/parent/bookings/others`

`booker_booking_status()` returns, per held item, **only**: consent request id, kind, item id, the participant name **as typed by the booker**, activity, edition, dates / times, booking status, consent state, camp approval state, hold expiry, and — only when the booker is the payer — invoice number, status, currency, total and balance. The page shows C's next-step label (`nextStep({ status, consent, campApproval, balance })`): *Awaiting guardian consent* → *Pending camp approval* (6–7) → *Awaiting payment* → *Confirmed*, plus *Awaiting confirmation* for training requests. Pending holds can be withdrawn. The nav entry "Bookings for others" sits under Bookings.

The booker never gets the child's profile, DOB, medical data, documents or club records: no RLS policy grants it (`is_guardian_of_athlete` stays false; paying grants nothing — tested), the training catalog for the booker (`third_party_training_catalog`) shows the typed name and no package data, and the picker lists the booker's participants from `booker_participants()` (typed name / DOB only).

## 6. Privacy (minors: nFADP / GDPR / COPPA)

* **Data minimisation**: the booker enters only name, DOB, sex and the guardian's contact; no medical data is collected from a third party. The holding family has no members, so nobody but staff sees the child until the guardian accepts.
* **Lawful basis / consent**: the child's data is processed for the booking the guardian is asked to approve; nothing is confirmed, invoiced or rostered before consent; decline / expiry cancel the booking. Consent is recorded per form with version, time and who (`consent_acceptances`, audit log); media consent stays a separate form.
* **COPPA** (US clubs, under 13): acceptance by the verified e-mail owner is recorded as `parental_consents` (`email_plus`, verified). FTC: *email plus* is only appropriate when the data is not disclosed to third parties — a club enabling disclosures must use a stronger method (see the privacy-compliance-officer).
* **Existing children** are never revealed: the booker gets the same answer for a match; the request goes only to that child's guardians.
* **Tokens**: 32 random bytes, only the SHA-256 is stored; the page sends no referrer and is not indexed. Residual risks: the e-mail body (with the link) is kept in `email_logs` like every transactional e-mail; a booker who types an address they control as "guardian" could accept for a child — mitigated by the booker ≠ guardian check, the match routing for existing children, the audit trail and staff visibility (admins see every request). Clubs needing stronger proof should verify the guardian in person or through the club's ID process.
* **Retention**: requests and booker links are personal data, audited and deleted with the athlete (cascade). Holding families of declined / expired requests (no members) stay until staff remove them; an automatic purge is a follow-up.
* Erasure / DSAR: `participant_bookers` and `guardian_consent_requests` reference the athlete (`on delete cascade`).

## 7. RPCs

| Function | Caller |
|---|---|
| `family_bootstrap(p_org_slug)` | signed in |
| `public_entry_resolve_children(p_payload)` | service role (server actions) |
| `register_public(p_payload)` (redefined) | service role / authenticated (as before; `account_profile_id` from service role only) |
| `third_party_participant_create(p_payload, p_request_id)` | signed-in adult of the club |
| `booker_participants()` · `booker_booking_status()` | signed in (own rows) |
| `third_party_camp_hold(p_payload, p_request_id)` | the booker |
| `third_party_training_catalog(p_athlete)` · `third_party_training_quote(p_payload)` · `third_party_training_request(p_payload, p_request_id)` | the booker |
| `guardian_consent_view(p_token_hash)` · `guardian_consent_decline(p_token_hash)` | signed in, or the server with the service role after hashing the link token (no anon EXECUTE; the link is the credential) |
| `guardian_consent_accept(p_token_hash, p_payload)` | signed-in guardian (verified) |
| `guardian_consent_revoke(p_request)` | the booker |
| `guardian_consent_expire()` · `guardian_consent_mark_notified(p_request)` | service role (scheduled job) |

All `security definer`, `search_path` set, caller and org checked in SQL; idempotent (request ids, or the request's own state for accept / decline / revoke).

## 8. Follow-ups

* Online card payment of an invoice by a booker who cannot open it in the parent app (RLS on invoices is family-scoped): today the booker sees the invoice number, amount due and status under Bookings for others; how the invoice reaches them (e-mail to the payer, pay link) follows the existing invoice sending of the club.
* `/parent/bookings/others` sits under the Bookings feature gate; a camps-only club without the bookings module would need the page moved (or a camps entry).
