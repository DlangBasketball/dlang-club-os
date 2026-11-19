# Family & multi-club features

Migration: `supabase/migrations/20250420101400_family_multi_club.sql`. DB tests: `tests/db/family_features.sql`. Unit tests: `tests/unit/family-features.test.ts`.

## 1. One login, several clubs

- **Expand step.** `org_memberships (profile_id, org_id, roles[], status)` lists every club a person belongs to. `profiles.org_id` stays as the **current club**. `current_org_id()` still reads it, and it now returns null when an admin has suspended that membership.
- Memberships are maintained by triggers on `profiles`, `staff_roles` and `family_members`, and were backfilled from existing data. Roles stay org-scoped as before (`staff_roles`, plus guardian links for `parent`).
- **Switching** goes through `switch_current_org(p_org)` (security definer). It works only when an active membership exists, and it writes an audit row in both clubs (`org.switch_in` / `org.switch_out`). Users cannot update `profiles.org_id` directly (`profiles_block_org_change`), and they cannot insert memberships themselves.
- **Guardian helpers are scoped to the current club:** `is_guardian_of_family`, `is_guardian_of_athlete`, `guardian_has_athlete_in_program`, `guardian_has_athlete_on_team` and `is_any_guardian`. A person who is a guardian in club A and club B only sees club A's family while A is current.
- **Second club invitations.** `consume_invitation()` (server only) and `claim_my_invitations()` (caller's own email) turn a pending invitation into a membership, a role and a family link in the inviting club. The person's current club does not change. Admin invites, guest checkout and second-guardian invites to someone who already has a login therefore add a membership instead of failing. Invitations are claimed in the auth callback and when the app shell loads.
- **Switcher.** The `OrgSwitcher` appears in all three app shells when the person has two or more clubs. On a club-specific host (subdomain or custom domain), the switch returns the other club's host. Sessions are per host, so the person may need to sign in there.
- **Known limitation (contract step pending).** Profile-level data (name, email, language) is shared across clubs. `anonymise_family()` keeps a guardian who still belongs to another club: their link to this club ends, but their login and profile stay.

## 2. Second guardian & split billing

- `family_members` has new columns `can_pay`, `can_see_medical`, `receives_emails` and `billing_share_pct`.
- Medical rows (`athlete_medical`) are visible only to guardians with `can_see_medical`, through `guardian_can_see_medical()`.
- Checkout refuses a guardian without `can_pay`.
- The primary guardian invites a second guardian from **Family** in the parent app. The invitation carries the chosen permissions, and they are applied when the link is made. The primary guardian, or a club admin, changes permissions with `set_guardian_permissions()`. `remove_family_guardian()` never removes the primary guardian.
- **Approach: one invoice per payer.** A family invoice is split into one ordinary invoice per paying guardian (`split_family_invoice()`):
  - The original invoice becomes the first payer's part. Each other part gets a new number, its own QR / creditor reference (set by the existing reference trigger) and its own Stripe payment link.
  - The parts carry `payer_profile_id`, `split_group_id`, `split_share_pct` and `split_from_invoice_id`.
  - Lines are scaled per share. Every payer but the last gets `round(amount × pct / 100)` in the currency's minor unit, and the last payer gets the remainder, so the parts add up exactly to the original. `src/lib/family/split.ts` mirrors this math and the unit tests check it.
  - Why not one invoice with two payer shares: a Swiss QR-bill payment part carries exactly one amount and one reference. Separate invoices keep every existing flow unchanged: reconciliation by reference, reminders and dunning, credit notes, and status.
  - **Never split:** paid or adjusted invoices, or anything linked to payments, payment plans, shop orders, training packages or autopay. The function refuses any foreign key reference except lines, email logs, registrations and applied discounts.
  - **When splits run:**
    - `/api/family/cron`, daily after billing (`vercel.json`; bearer `CRON_SECRET`), for invoices of the last 60 days.
    - Finance can also run it per family from **Split billing** (`/admin/family-billing`).
    - Each payer gets an in-app and push notice.
  - **Rounding and tax:**
    - Totals are split exactly.
    - With tax-inclusive pricing (the Swiss default), the tax per part is recomputed from that part's total.
    - With tax-exclusive pricing, the per-part tax can differ by one minor unit in total.
- **Reminders go to the responsible payer.** `invoice_billing_recipients()` and `pickBillingRecipients()` return the payer of a split part. Otherwise they return the guardians with `receives_emails`, or everyone if nobody has it on. This is used by overdue reminders and by the instalment / autopay notices.

## 3. Privacy self-service (parent app → Privacy & data)

- **Download my family's data.** The export reads data through the guardian's own session (RLS), so it contains exactly what the guardian may see. It produces a JSON file plus a readable HTML summary, stored in the private `privacy-exports` bucket. Signed links last one hour. The export is audited (`privacy.export_generated`) and recorded as a completed portability DSAR. Old exports should be purged by the storage lifecycle (7 days recommended).
- **Correction.** Files a `rectification` DSAR (statutory due date from `dsar_due_days`) and notifies the admins.
- **Deletion.** Files a `deletion_requests` row plus a linked `erasure` DSAR. The admin approves it in Settings → Privacy, which runs `anonymise_family()`. Invoices and payments are kept for legal retention. Approving or rejecting also closes the linked DSAR.
- **Consents.** `family_consent_events` is an append-only history (media per child, marketing per guardian, scout profile). Rows cannot be updated or deleted. `family_consent_state()` returns the latest decision for each consent.
- Notification preferences (in-app / email / push per category, quiet hours) live on the same page.

## 4. Web Push

- VAPID and aes128gcm are implemented with `node:crypto` (`src/lib/push/webpush.ts`) and tested against the RFC 8291 test vector. No third-party SDK.
- Env: `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`. Generate keys with `node scripts/generate-vapid-keys.mjs`. Without them, push is a no-op and the opt-in card is hidden.
- `push_subscriptions` are per (club, device). RLS limits each user to their own rows in the current club. Gone endpoints (404/410) are deleted.
- **Pushes sent:**
  - urgent alerts and message-board notifications (in `messaging/notify.ts`)
  - event cancellations, postponements and time / venue changes (`sportsops/actions.ts` → `notifyEventChange`)
  - payment due, overdue and failed (`notifications/dispatch.ts`, `plans/notify.ts`)
  - carpool matches and split invoices
- Each push respects the per-category push switch and quiet hours (urgent alerts excepted).
- Works on Android and desktop browsers. On iOS / iPadOS 16.4+ it works only when the app is added to the Home Screen; the UI explains this.

## 5. Carpooling

- Tables `carpool_offers`, `carpool_requests` and `carpool_matches` (each with RLS).
- **Who sees the board:**
  - guardians of players on the event's team roster (or RSVP'd athletes for club-wide events)
  - the team's coaches
  - admins
- The board RPC returns first names only, never phone numbers or emails.
- `carpool_match()` checks seats and opens a private direct message thread between the two guardians. Both guardians get an in-app and push notice.

## 6. Player journey

- `player_journey()` returns the season-by-season history:
  - teams and the team's record
  - aggregated stats
  - attendance %
  - evaluation trend (guardians see shared evaluations only)
  - reviews
- **Season reviews** (`player_season_reviews`): coach comment and awards, optionally shared with the family.
- **Placement tracker** (`placement_targets` plus status history):
  - Statuses run interested → contacted → trial → offer → placed (or declined / withdrawn).
  - Each target has deadlines and attached athlete documents.
  - Admin and coaches can edit; guardians can read.
- **Scout profile** (`scout_profiles`):
  - Off by default.
  - Only a guardian can publish it, with explicit consent recorded in `family_consent_events`.
  - The guardian chooses which fields to show; medical fields are impossible by constraint.
  - Expiry is between 1 and 365 days. The profile can be revoked by the guardians or staff.
  - The link token (32 random bytes) is shown once; only its SHA-256 is stored.
  - The public page `/scout/[token]` (noindex) calls the server-only `scout_profile_view()`.
