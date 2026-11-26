# Parent and player attendance portals, no-show alert delivery

Builds on `docs/team-attendance.md` (backend contract). This file covers the parent and player screens, alert recipients and content, and how to test alerts without e-mailing real people.

- Migration: `supabase/migrations/20250420104300_family_attendance_ui.sql` (additive, idempotent)
- DB tests: `tests/db/family_attendance_ui.sql` (`DB_TEST_PREFIX=fa scripts/db-test.sh tests/db/family_attendance_ui.sql`)
- Unit tests: `tests/unit/family-attendance.test.ts`
- Code: `src/lib/attendance/{recipients,family,family-data}.ts`, `src/lib/attendance/alerts.ts`, `src/lib/notifications/templates.ts`, `src/lib/email/{resend,webhook}.ts`, `src/app/api/email/webhook/route.ts`, `src/components/attendance/family/*`

## 1. Screens and routes

| Route | Who | What |
|---|---|---|
| `/parent/attendance?athlete=&team=&season=` | guardian (and admin previewing own families) | Child tabs (own children only). **Upcoming sessions** (next 30 days, every team the child is on; cancelled shown struck through with the reason; moved sessions at the new time with "Moved from ..."; postponed badge). **Report absence** per session until it starts (category + optional note; change or withdraw while open; "seen by the coach" and "time changed, check your report" states). **Attendance record**: finalized marks only, filters by team and season, totals (sessions, present, late, excused, unexcused, rate = (present + late) / sessions), each row links to the record page. Correction requests with their status. The earlier programme-session summary stays below. |
| `/parent/attendance/team/[eventId]?athlete=<id>` | guardian | Record page behind alert e-mails and in-app notices. Status (finalized value, or "not final yet" / "not happened yet" / cancelled with reason), team, date and time in the club time zone, location, guest / corrected notes, date of the alert we sent. Absence report for an upcoming session. **Request a correction** (message, optional requested status), the list of requests with status, the staff reply (`resolution_note`) and decision date, and "withdraw" for an open request. Without `?athlete=` it asks which child. Any other family's child or club: "Record not found". |
| `/parent/notifications` | guardian | Existing page, now translated. No-show alerts, corrections and correction outcomes show with an "Attendance" badge and open the record page. |
| `/player` → `/player/home` | player | Own teams (name, jersey, position), upcoming sessions with **report absence** (the backend allows a player to report for themself), link to history. |
| `/player/attendance?team=&season=` | player | Own finalized attendance with filters and totals. No record links, no alerts, no correction requests. |

Player routing: `ROLE_HOME.player = "/player"`; the `(player)` layout calls `requireRole(["player"])` (other roles go to their own home); middleware already gates `/player` (reserved app path). The shell is the same mobile `AppShell` as parent and coach (`NAV.player`: Home, Attendance).

Data rules: every read is a security-definer RPC run as the signed-in user (`guardian_attendance_overview`, `guardian_attendance_record`, `player_attendance_overview`, `player_me`). Guardians see only their own children, finalized values (a draft or a reopened sheet shows the last finalized value), never staff notes, correction reasons, other players' marks or coach data. The player portal never shows guardian contacts, medical data, staff notes or money.

## 2. No-show alert recipients

Rule (`src/lib/attendance/recipients.ts`, the same rule in SQL `ta_alert_recipients` / `ta_alert_family_email` / `ta_sync_mark_alerts`):

1. **Guardian logins**: members of the athlete's family (`family_members`) with an active login that is not suspended in the club. One alert each, recipient key `g:<profile id>`. Channels follow their own `events` preferences (in-app, e-mail only with `receives_emails`, push, quiet hours).
2. **Family contact e-mail**: only when the family has **no** such guardian login, `families.contact_email` (trimmed, lower-case, plausible address, active family) as an **e-mail-only** recipient, key `f:<family id>` (`recipient_family_id`). Never an address that belongs to a player login of the family: minors are never e-mailed directly. Quiet hours do not drop this e-mail, since it is the only channel. The message asks them to contact the club instead of linking a portal they cannot open.
3. **Nobody**: one `no_contact` row (key `none`) for staff follow-up, as before.

Idempotency: the unique indexes are now `(event, athlete, recipient_key)` for initial alerts and `(history row, recipient_key)` for corrections, so re-finalizing, retries and the cron never create a second alert for the same recipient. If a family later gets a guardian login, its unsent `none` / `f:` row is superseded and the guardian gets the alert. Players never receive alerts.

Staff follow-up (`attendance_alerts_followup`, unchanged columns): an e-mail-only alert appears with an empty guardian; `failed` means the family address could not be reached, `no_contact` means nobody to contact.

## 3. Content

`attendance_no_show` and `attendance_no_show_correction` (en, fr, de, es, it; the guardian's language, or the club default for an e-mail-only recipient). Each message names only that child: first and last name, team, session date and time in the **club** time zone, and the record link (`/parent/attendance/team/<event>?athlete=<athlete>`, "View record", request a correction there). It contains no other family's data.

A correction message starts with "Correction:", says it corrects the earlier message about the session, gives the new status (for example "late") and why it matters ("no longer counts as an unexcused absence, no action needed", or "now counts as an unexcused absence").

## 4. Delivery failures and bounces

- Synchronous provider errors (`resend-422: Invalid 'to' field`, network, no API key) are recorded on the alert's channel result and `last_error`; the alert is retried with back-off and appears in the follow-up list at the attempt cap (5).
- Asynchronous failures come through the **Resend webhook** `POST /api/email/webhook` (Svix signature, `RESEND_WEBHOOK_SECRET`). Alert e-mails carry the Resend id (`channel_results.email.provider_id`, `email_logs.provider_id`) and the tags `org` and `kind`. On `email.bounced`, `email.complained` or `email.failed` the e-mail log becomes `bounced` / `failed` and `attendance_alert_email_failed()` marks the alert `failed` with the reason, at the attempt cap (a bounce is permanent, so no retry); it shows in the staff follow-up list right away. `email.delivered` marks the e-mail log delivered.

Set-up: in Resend, add a webhook to `https://<app host>/api/email/webhook` with the events above and put its signing secret in `RESEND_WEBHOOK_SECRET`.

## 5. How to test without e-mailing real people

Resend's test inboxes: `delivered@resend.dev` (accepted and delivered) and `bounced@resend.dev` (accepted, then bounced through the webhook). Use them in one of two ways:

1. **Safe test mode (recommended for any verification on real club data):** set `EMAIL_TEST_REDIRECT=bounced@resend.dev` (or `delivered@resend.dev`) in the environment. Every e-mail of the app then goes to that address instead of the real recipient. `checkEnv()` warns if it is set in production. Remove it afterwards.
2. **Synthetic family:** create a test family with `contact_email = bounced@resend.dev` (no guardian login) and a test player on a test team.

Then: finalize a past test session with the player marked unexcused (or wait for the cron). Expected:

- `delivered@resend.dev`: alert `sent`, e-mail log `sent` then `delivered` (webhook).
- `bounced@resend.dev`: alert `sent` first, then, when Resend posts `email.bounced`, alert `failed` with `last_error` "bounced: ...", attempts at the cap, and the row is listed by `attendance_alerts_followup` (admin and team coach follow-up screens).
- No login and no e-mail: alert `no_contact` in the follow-up list.

Automated checks: `npx vitest run tests/unit/family-attendance.test.ts` (templates, time zone, recipients, idempotency with the recipient key, test redirect, webhook signature) and the DB suite above (recipient keys, claim, bounce, cross-family and other-org denial).

## 6. Not done

- No SMS. Push for an e-mail-only recipient does not exist (no login).
- The follow-up RPC keeps its columns, so it does not name the recipient kind (a null guardian with `failed` means the family e-mail); the admin and coach follow-up screens are built by the admin / coach agents.
- `events.rescheduled_from` is set from now on; sessions moved before this migration show no "moved from" note.
