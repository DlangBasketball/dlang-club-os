# Team rosters, training attendance, absence and no-show alerts, player portal

Contract for the UI work (coach mobile, admin team / dashboard, parent and player portals).

- Migration: `supabase/migrations/20250420104000_team_attendance.sql` (additive, idempotent)
- DB tests: `tests/db/team_attendance.sql` (`DB_TEST_PREFIX=ta scripts/db-test.sh tests/db/team_attendance.sql`)
- TS: `src/lib/attendance/*` (types, data reads, dispatcher, alerts, schedule) and `src/lib/actions/team-attendance.ts` (server actions)
- Unit tests: `tests/unit/attendance-alerts.test.ts`
- Cron: `GET /api/attendance/cron` (daily 17:10 UTC in `vercel.json`, `Authorization: Bearer $CRON_SECRET`)

## 1. Design decisions

| Topic | Decision |
|---|---|
| Existing attendance module | **Not extended.** `attendance_sessions` / `attendance_marks` (programme sessions: `open/submitted/locked`, `present/late/absent/excused`) stay as they are, with their pages and RPCs. Team sessions (`events`) get their own tables with the new model (`unmarked`, `unexcused`, `draft/final/reopened`, versions). The 4 existing sessions are untouched; any linked to a team event through `program_session_id` are flagged `LEGACY_ATTENDANCE_SESSION` and linked on the team sheet (`legacy_attendance_session_id`). |
| Rosters | Effective-dated on `team_memberships` (`joined_on` / `left_on`, both inclusive). The `(team_id, athlete_id)` unique key stays because the selection flow upserts on it. When an ended row is reopened, or moved to another team by an `UPDATE` of `team_id`, the closed period is archived in `team_membership_periods`. `team_roster_on()` reads both. |
| Roster snapshot | A sheet is built from `team_roster_on(team, local date of the event)` plus guests. The marks are the snapshot. Building again is idempotent: it adds missing roster players and drops untouched (`rev = 0`, unmarked) rows of players no longer on the roster. This happens only while the sheet is a draft. |
| EYBL / selection teams | A training event on a selection division team uses that team's own roster. Club roster RPCs refuse these teams (`SELECTION_ROSTER_MANAGED`) because the enrollment flow manages them. |
| Player role | `app_role` value `player`, added first and only compared as text in the migration. A player is derived from `athletes.player_profile_id` (unique per org) and is never a `staff_roles` row. |
| Errors | Authorization, not-found and invalid-input cases raise an UPPER_CASE code. Refusals that carry data are returned as `{ ok: false, code, … }`. |

## 2. Tables (all: `org_id` + index, RLS on, `created_at` / `updated_at`)

| Table | Purpose | Client writes |
|---|---|---|
| `team_memberships` (+ `dates_source`, `end_reason`, `ended_by`) | Effective-dated roster rows | Existing RLS. An API client cannot delete a row used by attendance (`MEMBERSHIP_HAS_ATTENDANCE`); the roster actions then end it instead |
| `team_membership_periods` | Archived earlier periods | none (trigger) |
| `event_coach_assignments` | Session-level coach access (`substitute` / `lead`; `pending` / `approved` / `rejected`) | none (RPC) |
| `team_attendance_sheets` | One per event (`event_id` unique). Fields: `status` `draft` → `final` (+ `reopened`), `version`, `roster_date`, `led_by_coach_id`, `submitted_*`, `finalized_*`, `first_finalized_at`, `reopened_*`, `finalize_count`, `correction_count`, `alerts_synced_at` | none (RPC) |
| `team_attendance_marks` | One per (event, athlete), enforced by a unique index. Fields: `status`, `finalized_status` (the value portals and stats read), `rev` (per-mark revision), `is_guest`, `note` (staff only), `reported_absence_ack` | none (RPC) |
| `team_attendance_mark_history` | Every status change (`phase` `draft` / `reopened` / `correction`) with the previous value, new value, editor, time, reason and request id | none |
| `team_attendance_requests` | Idempotency keys (`request_id` → stored result) | none, not readable |
| `team_absence_reports` | Guardian / player absence reports (`reported` / `acknowledged` / `superseded` / `withdrawn`, `needs_review`) | none (RPC) |
| `attendance_no_show_alerts` | Alerts to guardians (see §6) | none (service role) |
| `attendance_correction_requests` | Guardian → staff requests (`open` / `accepted` / `rejected` / `withdrawn`) | none (RPC) |
| `club_training_breaks` | Club holidays (`label`, `starts_on`, `ends_on`, optional `season_id`) | admin (RLS); a trigger cancels the trainings |
| `seasons.training_starts_on` / `training_ends_on` | Training calendar of a season (nullable) | admin (`saveSeason`) |
| `app_settings.attendance_tracking_starts_on` | Attendance go-live per club | admin (`attendance_settings_set`) |
| `athletes.player_profile_id`, `player_linked_at`; `invitations.athlete_id` | Player login link | admin / invitation |

Free text with possible health details (`note`, `reason`, `message`, `resolution_note`) is redacted in `audit_logs`.

## 3. Statuses

- Mark: `unmarked` | `present` | `late` | `excused` | `unexcused`. Finalized and corrected values never use `unmarked`.
- Sheet: `draft` → `final`. `reopened` comes from `attendance_reopen` and becomes `final` again on finalize. `attendance_correct` changes one mark on a **final** sheet, which stays final.
- Event types that take a sheet: `training`, `game`, `tournament`.
- Attendance rate = (present + late) / finalized marks of non-cancelled events. The finalized marks are `finalized_status` values, so `unmarked` never counts. A sheet reopened for corrections still counts with its last finalized values.

## 4. RPCs (signed-in API; each checks tenant and role)

### Rosters
| RPC | Who | Notes |
|---|---|---|
| `team_roster_on(team, on?)` | admin, finance, team coach | Players on the roster that day (`source` `current` / `history`) |
| `team_roster_history(team)` | same | All periods |
| `team_member_add(team, athlete, effective_on?, jersey?, position?)` | admin, team coach | Starts or restarts a membership on `effective_on`. Errors: `ALREADY_ON_TEAM`, `JERSEY_TAKEN`, `INVALID_JERSEY` |
| `team_member_leave(team, athlete, effective_on, reason)` | admin, team coach | Off the team **from** `effective_on` (`left_on = effective_on − 1`). Inactive at once when that date has passed; otherwise the daily cron sets it. A row that was never effective is removed when it has no attendance |
| `team_member_transfer(from, to, athlete, effective_on, reason)` | admin, or coach of **both** teams | Leave + add. Jersey / position carry over when free. History kept |

All roster changes are audited (`roster.add` / `roster.leave` / `roster.transfer` plus row audit).

### Sheet
| RPC | Returns |
|---|---|
| `attendance_sheet(event)` | Sheet JSON (`AttendanceSheet` in `src/lib/attendance/types.ts`): `event`, `sheet` (null = roster preview, nothing saved), `access`, `marks[]` (name, jersey, position, photo only with media consent, reported absence), `counts` |
| `attendance_open(event)` | Creates or returns the sheet and syncs the draft roster; returns the same JSON. `EVENT_CANCELLED` when no sheet exists yet |
| `attendance_save(event, marks[], expected_version, request_id, ack_reported=false)` | `marks`: `[{athlete_id, status, base_rev?, note?}]`. Per-mark last-write-wins: a mark whose `rev > base_rev` and was last changed by **another** user is not overwritten and comes back in `conflicts[]`. Returns `{ok, version, version_conflict, applied[], conflicts[], warnings[], replayed}`. `warnings`: `REPORTED_ABSENCE` for `unexcused` with an active report |
| `attendance_mark_all_present(event, expected_version, request_id?)` | Only `unmarked` marks. Strict version check → `{ok:false, code:'VERSION_CONFLICT', version}` |
| `attendance_add_guest(event, athlete)` / `attendance_remove_guest` | A guest is an existing player of the club added for this session only; the roster is unchanged. A guest who was marked cannot be removed (`GUEST_MARKED`) |
| `attendance_finalize(event, led_by_coach, expected_version, request_id, ack_reported=false)` | `{ok:true, already_final, version, alerts_created}`, or returned refusals: `VERSION_CONFLICT`, `UNMARKED_PLAYERS` (+ `unmarked[]`), `REPORTED_ABSENCE_UNACKNOWLEDGED` (+ `athletes[]`; call again with `ack_reported=true`). Raises `EVENT_CANCELLED`. A second finalize is a no-op |
| `attendance_reopen(event, reason)` | final → reopened |
| `attendance_correct(event, athlete, new_status, reason, request_id?, ack_reported=false)` | Final sheets only. Writes a history row and syncs alerts. Returns `{changed, history_id, previous_status, new_status, alerts_created, warnings}` |

Idempotency: a retry with the same `request_id` (same user, org and kind) returns the stored result with `replayed: true`. Another user's id gives `REQUEST_ID_REUSED`. Refusals are not stored, so the same id can be retried after fixing the sheet. Clients should create one id per user intent (`newRequestId()` in `src/lib/billing/request-id.ts`).

### Coach session access
| RPC | Who |
|---|---|
| `session_assign_coach(event, coach, role='substitute')` | admin → approved |
| `session_request_access(event, note?)` | a coach (not a coach of the team) → pending (`ALREADY_TEAM_COACH`) |
| `session_decide_access(assignment, approve, note?)` | admin; approve, reject or revoke |
| `session_access_list(status='pending')` | admin: whole club; coach: own requests |

`coach_can_run_event(event)` is true for coaches of the event's team. It is also true for a coach with an **approved** assignment for **that event only**, until 7 days after the sheet was finalized (`ta_grace_days()`). A substitute sees the event, its sheet, its marks and the reports for it, with minimal athlete data through the sheet RPC. A substitute gets no `athletes` rows, no medical data, no guardian contacts and no money, because `coach_can_access_athlete` is unchanged.

### Absence reports
`absence_report(event, athlete, reason?, category)` is for a guardian of the athlete or the player. The cut-off is the scheduled start (`ABSENCE_CUTOFF_PASSED`). The athlete must be on the roster on the event date or on the sheet. A new report supersedes the previous one. `absence_withdraw(report)` can only be used before the start. `absence_acknowledge(report)` is for staff who can run the session. Rescheduling (`starts_at` change) sets `needs_review = true` on active reports. Reports keep the event id, so they carry forward.

### Correction requests
`attendance_correction_request(event, athlete, message, requested_status?)` is for guardians and requires a finalized mark. One open request per mark (`CORRECTION_OPEN_EXISTS`). `attendance_correction_withdraw(request)`. `attendance_correction_resolve(request, accept, new_status?, note?)` is for admins and coaches of the team. Accept runs the correction (history and correction alerts). Reject requires a note. The server actions notify both sides.

### Reads
| RPC / TS (`src/lib/attendance/data.ts`) | Scope |
|---|---|
| `coach_sessions(from?, to?)` / `getCoachSessions` | Signed-in coach: team sessions + approved/pending assignments (`access`, `can_run`, sheet status, counts) |
| `sessions_awaiting_attendance(team?, limit)` / `getAwaitingSessions` | Admin: club; coach: sessions they can run. Lists sessions that ended, are not cancelled, have no final sheet, fall **inside the training window** (trainings) and are **on or after the go-live** |
| `attendance_stats(from?, to?, team?, season?, athlete?, group)` / `getAttendanceStats` | Admin: club; coach: teams they coach; guardian / player: own child or self only. With `season`, the dates are bounded by the season's training window, and trainings outside it never count |
| `attendance_alerts_followup(limit)` / `getAlertFollowups` | Admin: club; coach: their teams. Lists `no_contact` alerts and `failed` alerts at the attempt cap |
| `attendance_correction_requests_list(status, athlete?)` | Staff of the team, or the guardian (own children) |
| `guardian_attendance_overview(athlete, from?, to?)` | Guardian of the athlete (or admin): upcoming sessions (30 days, with report state and `can_report`), finalized history, reports, correction requests, the latest alert to this guardian, totals |
| `player_attendance_overview(from?, to?)`, `player_me()` | The player: same overview without alerts or requests; own limited record + current teams |
| `training_breaks_list(season?)`, `attendance_settings()` | Club members / staff |

## 5. Training window, go-live, breaks

- `seasons.training_starts_on` / `training_ends_on` are edited on Settings → Seasons. A **recurring** training (`series_id`) can never be created outside the window (`TRAINING_OUTSIDE_SEASON_WINDOW`) or inside a break (`TRAINING_IN_BREAK`); a trigger enforces this. `saveEvent` plans the weeks with `planWeeklySeries()` and skips those dates, returning them in `data.skipped`. The event form has a "weekly until a date" option that defaults to the team season's last training day.
- `app_settings.attendance_tracking_starts_on`: existing clubs got the day the migration ran (club time zone), so earlier sessions never flood the dashboards. Admins can move it on Settings → Seasons. New clubs start with null, which means every session counts.
- `club_training_breaks`: **saving** a break (RPC `training_break_save` or a direct admin insert/update) cancels the non-cancelled **trainings** in its dates. Each one gets `status='cancelled'` and `cancel_reason = label` and is audited `event.cancel_break`. This is the same path as a normal cancel, so pending alerts are suppressed. The action also notifies families (`notifyEventChange`). Trainings with a **final** sheet took place, so they are reported (`skipped_final`) and not cancelled. **Deleting** a break never un-cancels anything; `still_cancelled[]` is returned for review. Cancelled sessions stay visible as cancelled everywhere.

## 6. No-show alert lifecycle

1. An alert is created only when **all** of these hold: the sheet is **final**, the event has **ended**, the event is **not cancelled**, and the finalized mark is `unexcused`. It is created at finalize, or by `attendance_due_alerts()` (cron) when the sheet was finalized before the end.
2. Recipients are the guardians of the athlete's family (`family_members`) with an active login that is not suspended in the club. There is one `initial` alert per guardian, enforced by a unique index on (event, athlete, guardian, kind=initial). With no guardian there is one `no_contact` row for staff follow-up. Players never receive alerts.
3. The dispatcher (`src/lib/attendance/alerts.ts`, logic in `dispatcher.ts`) runs right after finalize or correct and in the daily cron. It claims rows with a lock and a 10-minute claim, so overlapping runs do not double-send. It uses the guardian's `events` notification preferences (in-app, e-mail only with `receives_emails` and an address, push when a device is registered, quiet hours respected). It records `channel_results` per channel. A retry skips channels that already succeeded and reuses `notification_id`. A failed delivery is retried with a back-off of 5 min × attempts², up to 5 attempts, and then appears in the follow-up list. With no channel at all the status is `no_contact`.
4. Status values: `pending` → `sent` | `failed` | `no_contact`. Cancelling the event sets pending/failed rows to `suppressed`.
5. Corrections:
   - If nothing has been sent yet, the unsent alerts follow the mark (they are superseded or revived).
   - If an alert was sent and the status changes, the live alerts become `superseded` and one `correction` alert per guardian (unique per history row) announces the new status.
   - If the status changes back to the last sent value, the pending alerts are superseded.
6. Content (translated en/fr/de/es/it; types `attendance_no_show` / `attendance_no_show_correction`): the player's name, team, and session date and time in the club time zone. It links to `attendancePortalPath(event, athlete)` = `/parent/attendance/team/<eventId>?athlete=<athleteId>` ("request a correction"; the **parent portal agent builds this page**). It contains no other family's data.

## 7. Permissions matrix

| | admin | finance | team coach | substitute (approved, that event, until final + 7 d) | guardian | player |
|---|---|---|---|---|---|---|
| Roster read (`team_roster_on`) | ✔ | ✔ | own teams | – | own child's row (table RLS) | via `player_me` |
| Roster write (add/leave/transfer) | ✔ | – | own teams (transfer: both) | – | – | – |
| Open/save/guest/finalize sheet | ✔ | – | own teams | that event | – | – |
| Correct / reopen | ✔ | – | own teams | that event (grace window) | – | – |
| Marks / history (tables) | ✔ | – | own teams | that event | – (finalized values via overview) | – (overview) |
| Absence report | – | – | acknowledge | acknowledge | report / withdraw own child | report / withdraw self |
| Correction request | resolve | – | resolve (own teams) | – | request / withdraw | – |
| Session access | assign / decide | – | request | – | – | – |
| Alerts | read club | – | read own teams | – | own alerts | – |
| Stats | club | – | own teams | – | own child | self |
| Breaks / go-live / training window | manage | read breaks | read | read | read breaks | read breaks |
| Other org | denied everywhere (`EVENT_NOT_FOUND` / `TEAM_NOT_FOUND` / empty reads) |

## 8. Server actions (`src/lib/actions/team-attendance.ts`)

`openAttendance`, `saveAttendance`, `markAllPresent`, `addGuest`, `removeGuest`, `finalizeAttendance`, `reopenAttendance`, `correctAttendance`, `reportAbsence`, `withdrawAbsence`, `acknowledgeAbsence`, `requestSessionAccess` (notifies admins), `assignSessionCoach` / `decideSessionAccess` (notify the coach), `requestAttendanceCorrection` (notifies admins and team coaches), `withdrawCorrectionRequest`, `resolveCorrectionRequest` (notifies the guardian), `rosterAdd`, `rosterLeave`, `rosterTransfer`, `setAttendanceGoLive`, `saveTrainingBreak`, `deleteTrainingBreak`, `invitePlayer`, `unlinkPlayerAccount`.

Every action returns `{ok:true, data?, message?}` or `{ok:false, error, code}`. `error` is translated from `teamAttendance.errors.<CODE>`. Finalize refusals arrive as `ok:true` with `data.ok === false`. Notification paths the UIs should provide: `/admin/attendance/access`, `/admin/attendance/corrections`, `/coach/attendance/corrections`, `/coach/sessions/<eventId>`, `/parent/attendance/team/<eventId>?athlete=`, `/player`.

## 9. Player portal

- `invitePlayer({athleteId, email})` uses the existing invitations flow with role `player` and `invitations.athlete_id`. `handle_new_user` / `consume_invitation` link the athlete and add org membership; they never add a staff role. A guardian login cannot be the player login (`PLAYER_IS_GUARDIAN`).
- `getSessionUser()` adds `player` when `is_player()` is true. `ROLE_HOME.player = "/player"`, and `/player` is a reserved app path (middleware auth gate, never a club site page).
- What a player can read:
  - their own team(s): `teams_player_select`
  - events of the teams they were on that day, plus future events of their current teams: `events_player_select`
  - their own limited record: `player_me`
  - their own finalized marks and reports: `player_attendance_overview`
- What a player can never read: the `athletes` table, other players' marks, or the sheet.

## 10. Data findings (migration data steps)

- `team_memberships.joined_on` has been NOT NULL since the table was created (column default = insert date), so there was nothing to backfill. Rows are marked `dates_source='recorded'` and dates are **not** rewritten. A player's roster for sessions before their row's creation date therefore does not include them; this only matters for sessions before the go-live.
- Flags written to `data_review_flags` (reason codes), refreshed by the daily cron:
  - `MEMBERSHIP_INACTIVE_NO_END`: inactive rows without an end date are off every roster.
  - `MEMBERSHIP_DATE_UNCERTAIN`: rows marked `dates_source='uncertain'`.
  - `TRAINING_WITHOUT_TEAM`: tracked trainings that have no roster.
  - `TEAM_WITHOUT_COACH`: active teams with tracked trainings and no `team_coaches`.
  - `ATHLETE_WITHOUT_GUARDIAN`: players on a current roster with no reachable guardian; their alerts become `no_contact`.
  - `LEGACY_ATTENDANCE_SESSION`: programme-session attendance linked to a team event.
  - `ATTENDANCE_UNFINISHED`: tracked sessions that ended more than 2 days ago without a final sheet. These resolve themselves when finalized.

## 11. Not done / for the UI agents

- No pages were built: the coach sheet, admin awaiting / follow-up / corrections / access screens, the parent record page with "request a correction", and the `(player)` route group all remain to be built.
- The cron runs daily on Vercel's daily plan. An alert for a sheet finalized before the session ended goes out at the next cron run or at the next finalize/correct in that club. Moving to hourly only needs a `vercel.json` schedule change.
- In quiet hours an alert's e-mail and push are suppressed (in-app still delivered) and not sent again later.
