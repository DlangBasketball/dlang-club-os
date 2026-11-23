# Courtside member card

Migration `supabase/migrations/20250420105200_member_card_courtside.sql` (additive, idempotent). DB tests
`tests/db/member_card_courtside.sql` (`DB_TEST_PREFIX=mc scripts/db-test.sh tests/db/member_card_courtside.sql`). Unit
tests `tests/unit/member-card-courtside.test.ts`.

## 1. Brands are data

| What | Where |
|---|---|
| Brand per billing entity: `display_name`, `subtitle` (second line, e.g. "Powered by …"), `logo_path`, `watermark_path` (defaults to the logo) | table `member_card_brands` (unique per `billing_entity_id`; RLS: admin all verbs, finance read, restrictive tenant isolation; audit trigger) |
| Logos | private bucket `member-card-brands`, path `<org_id>/<billing_entity_id>/<logo|watermark>_<random>.<png|webp|jpg>`; read = any signed-in member of the org (signed URLs, no personal data), write = admin (`member_card_brand_asset_access`) |
| Save | `member_card_brand_save(payload)` (admin; checks the entity and that paths live under `<org>/<entity>/`; audited `member_card.brand.save`) |
| UI | Settings → Billing entities → "Member card brands" (`src/components/member-card/brands-editor.tsx`): name, second line, logo / watermark upload with live preview, remove. No logo → clean text-only lockup (monogram + name), never another brand's logo. |
| Preview | `/admin/settings/billing-entities/card-preview` (admin): every active brand × with / without photo × synthetic names (incl. a very long one) + a 320 px column. Preview QR codes encode a marker, not a credential. |

### Which card(s) an athlete gets (`member_card_brand_sources`, TS mirror `resolveCardBrands`)

| Eligibility | Entity |
|---|---|
| Club membership `status='active'` and today (club time zone) within `valid_from..valid_until` | entity of its invoice (`invoices.membership_id` / `memberships.invoice_id`, not void/cancelled/refunded, not a `migration_default` assignment), else the entity routed for `club_membership` |
| Selection application `status='enrolled'`, programme active and not ended | entity routed for `selection` |
| Training package `status='active'`, not expired, sessions left | entity routed for `training` |

Routes fall back to the org's default entity (`billing_entity_resolve`); inactive entities never show. Eligible under two
entities → two cards (club membership first), switchable with tabs or a horizontal swipe. Not eligible at all → one card
of the default entity (`is_fallback`). No billing entity at all → text-only card with the club name.

## 2. Card read

`member_card_courtside(athlete)` → `{athlete_id, first_name, last_name, token, card_active, photo_path, brands[]}` for an
admin of the org, a guardian of the athlete, or the athlete's own player login (`athletes.player_profile_id`). Coaches and
other families get `NOT_AUTHORIZED`, other clubs `ATHLETE_NOT_FOUND`.

Loader `src/lib/member-cards/courtside-data.ts` (`loadCourtsideCard`): feature `member_cards`, QR SVG from the token,
signed URLs for logos and the photo (user client → Storage RLS; for a player login, whose Storage read does not cover
the photo bucket, the own photo is signed server-side after the RPC authorised the read and the path matched
`<org>/<athlete>/`).

Screens (`CourtsideCardSection`): parent app child page (card + Add / Replace / Remove photo + existing print / lost
card), admin athlete profile (same + NFC tag), player home (own card, read-only). Without the feature the existing
member-card panel is unchanged.

## 3. QR = existing credential

The QR is `M1.<nonce>.<sig>` built from `member_cards.nonce` + `version` with the club key (`member_card_sign`), i.e. the
same token as `member_card_token()`, the PDF card and NFC writes. Reading the card issues a card only when none exists and
never rotates; brand and photo changes do not touch `member_cards` (asserted in the DB tests). Only "lost card"
(`rotate_member_card`) changes it.

## 4. Photos

Same storage as the athlete identification photo (private `athlete-photos`, `<org>/<athlete>/<file>`, Storage RLS:
admin or guardian write, signed URLs). New: preview + crop (portrait 4:5 or square, drag / arrow keys, zoom) in
`src/components/people/photo-crop-dialog.tsx` → existing browser resize (`resizePhoto`, EXIF dropped) → existing
`uploadAthletePhoto` (upload new object, switch `athletes.photo_path`, delete old after success, audit
`athlete.photo.upload|replace|remove`, revalidate parent + admin pages). A failed replace keeps the current photo and
says so. The card shows the photo in a 4:5 frame with `object-fit: contain` (layout WITH photo); without a photo the
layout gives the logo and the name more room. Card photos are internal identification only (never public).

## 5. Check-in path (coach scan)

1. Coach opens `/coach/trainings/[eventId]/attendance` (team training, game, tournament, or booked training session).
   With the `member_cards` feature the scanner (`CardCheckIn` → `RollCallScanner` with `check`) sits above the sheet:
   camera QR, Web NFC or typed code.
2. `checkInWithCard(eventId, raw, requestId)` (server action, admin / coach role) → RPC
   `member_card_check_in(event, token, request_id)`:
   - `ta_event_for_write` (org, `ta_can_run`: admin, team coach, session coach or approved substitute; sheet event type);
   - resolves the token (signature with the club key) or NFC tag inside the event's org;
   - `attendance_open(event)` (creates / syncs the sheet), finds the athlete's mark on **that** sheet;
   - `present`/`late` already → `{ok, already:true}` (repeated scans write nothing);
   - otherwise `attendance_save(event, [{athlete_id, status:'present', base_rev}], version, request_id)` — the same
     write as a tap on the sheet: `team_attendance_marks` + `team_attendance_mark_history`, sheet version, so the roster,
     history, attendance stats / dashboard and the no-show follow-ups read the same record. Audited
     `MEMBER_CARD_CHECK_IN`.
   - Refusals: `UNKNOWN_CARD`, `NOT_ON_SHEET` (add as guest first), `SHEET_FINAL`, `CONFLICT`.
3. The page refreshes; the sheet remounts on the new sheet version (unsaved local taps are restored from the device
   draft).

The legacy programme roll call (`/coach/attendance/[programSessionId]`, `attendance_sessions` / `attendance_marks`) keeps
its scanner (marks present locally, saved with the roster); a team sheet linked to such a session is linked through
`legacy_attendance_session_id` as before.

## 6. Theming

Card colours are card tokens in `src/app/globals.css` (`--card-courtside-*`, `--card-qr-*`, `--card-courtside-surface`)
mapped in `tailwind.config.ts` (`courtside-*`, `card-qr*`, `bg-courtside`); tenants may override them. Fraunces for the
name, Geist for labels; all sizes in container units so the card scales down to 320 px phones; names wrap to at most two
balanced lines and step down in size (`fitName`).
