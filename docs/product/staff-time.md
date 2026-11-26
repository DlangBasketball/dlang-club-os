# Staff time, lesson plans and club calendar

Migration: `supabase/migrations/20250420100500_staff_clockin_calendar.sql`. DB tests: `tests/db/staff_clockin.sql`.

## Clock-in

- Staff (admin, finance or coach role) clock in / out and take breaks from the coach app (`/coach`, `/coach/clock`) through the RPCs `staff_clock_in`, `staff_clock_out`, `staff_break`. Server time only; one open shift per person; a shift is auto-linked to the caller's programme session or team event running around now.
- Location check (optional, per device consent): the browser position is sent once to the server action, compared with the venue coordinates (`venues.latitude/longitude/geofence_radius_m`) and only the flag `geo_status` (`ok`, `too_far`, `unavailable`, `not_checked`) is stored. Coordinates are never stored or logged.
- Staff cannot write `staff_time_entries`, `staff_time_breaks` or `staff_timesheets` directly (RLS denies every write); corrections go through `staff_save_time_entry` / `staff_delete_time_entry` (admin only, reason required, written to `audit_logs`).
- Missed clock-out: a shift open longer than `staff_max_shift()` (16 h) becomes `missed` (counts zero hours until an admin corrects it). Flagged on the next clock-in / clock-out of that person and by `staff_flag_missed_clockouts()` (admin button on `/admin/timesheets`; service role for a scheduled job covers every org).
- Planned shifts: weekly templates `staff_shift_templates` (ISO weekday, start/end time, end <= start means it ends the next day), managed on `/admin/staff-schedules`.
- Approval: `staff_set_timesheet(profile, from, to, approve)` snapshots planned/worked minutes and locks the period (no corrections until reopened). Not allowed while the period has running or missed shifts.
- CSV export: `/admin/timesheets/export?from=YYYY-MM-DD&to=YYYY-MM-DD` (admin, finance).

## Payout hook: `public.staff_hours(p_org uuid, p_from date, p_to date)`

Returns one row per employee for the club-local days `[p_from, p_to]` (org time zone, `staff_org_tz()`):

| column | meaning |
|---|---|
| `profile_id` | employee (profiles.id) |
| `coach_id` | linked coaches.id or null |
| `full_name` | display name |
| `planned_minutes` | weekly templates expanded day by day (overnight counted on the start day; DST-correct) |
| `worked_minutes` | closed shifts clipped to the window, minus breaks |
| `break_minutes` | breaks of those shifts inside the window |
| `entry_count` | closed shifts in the window |
| `open_entries` / `missed_entries` | running / missed shifts (not counted) |
| `approved` | every day of the window is covered by approved timesheets |

Callers: finance/admin of `p_org` (signed-in client) or server code with the service role. Anyone else gets `NOT_AUTHORIZED`.
Use `worked_minutes` per `coach_id`, ideally only where `approved = true`. In the app, `src/lib/finance/clock-hook.ts` (`clockMinutesForPayouts`) wraps it.

## Lesson plans

`lesson_plans`: one per programme session or team event. Written by the session's lead coach, a coach of the event's team, or an admin; optional attachment in the private `lesson-plans` bucket (`<org_id>/<plan_id>/<file>`). With "share with parents", guardians of athletes in that programme / team see it in `/parent/schedule` and `/parent/calendar`. Admins list all plans at `/admin/lesson-plans`. Finance does not see lesson plans.

## Club calendar

`/admin/calendar`, `/coach/calendar`, `/parent/calendar` aggregate team events, programme sessions, camp editions, training bookings, staff shifts and `club_events` (title, type, dates, venue/location, audience `everyone` | `staff` | `parents`). Scoping lives in `src/lib/calendar/data.ts`. Each user can create a read-only ICS link (`/api/calendar/feed/<token>`); only the SHA-256 hash of the token is stored (`calendar_feed_tokens`), and a new link revokes the old one.
