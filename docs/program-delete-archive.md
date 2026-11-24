# Delete, archive and restore a programme

Admins can delete a programme from the Programmes list (trash icon on each card) and from the programme detail page. Migration: `supabase/migrations/20250420105300_program_delete_archive.sql`. Tests: `tests/db/program_delete_archive.sql` and `tests/unit/program-delete.test.ts`.

## Rules

1. **Delete** opens a dialog. The dialog shows the programme name, its current status and what is linked to it. The server counts the linked records.
2. **Nothing linked**: the admin types the programme name to confirm. The programme is then deleted permanently. It disappears from the list and from every selector, because every route is revalidated.
3. **Something linked**: the delete is refused. The dialog shows the counts per category and offers **Archive programme** as a separate action. A delete never archives on its own.
4. **Archive** hides the programme from new registrations (public `/register/[slug]`, parent camp pages, the basket, selection sign-up and admin enrolment), from new bookings and from active selectors. The database also refuses a new registration or selection application in an archived programme, and refuses moving one into it (`PROGRAM_ARCHIVED`).
   - Existing enrolments, sessions, attendance, invoices and payments stay as they are.
   - Upcoming sessions are **not** cancelled.
   - The detail page still opens, and invoices still show the programme name.
5. **Restore** returns an archived programme to the status it had before it was archived (`programs.status_before_archive`). If that status is unknown, it becomes **draft**. A trigger records the previous status whatever archived the programme: these functions, the edit form, or older code that sets `is_active = false`.
6. **Archived filter**: by default the Programmes list hides archived programmes. Use `?view=archived` or the "Archived (n)" chip to list them, with **Restore** on each card.
7. The dialog lists up to 10 **upcoming sessions** (date/time and title) and up to 10 **current enrolments** (child name and status), each followed by "and N more". Each event links to `/admin/schedule/[id]`, where the existing cancel flow lives. Each camp week links to its edition page. Programme sessions with no event have no link.
8. If an action fails, the dialog shows the translated reason and the current status badge. Nothing is removed from the screen before the server confirms.

## What counts as linked

| Category | Records |
|---|---|
| registrations | `registrations` (all statuses, including camp registrations), `program_applications` (selection), `waitlist_entries` (programme or its camp weeks) |
| bookings | `training_bookings` in a training session held at one of the programme's events |
| schedules | `program_sessions`, `camp_editions`, `camp_time_slots`, `events` of the programme's sessions or teams, `program_tournaments` |
| attendance | `attendance_sessions` (programme or its sessions; marks come with them), `team_attendance_sheets` of the programme's events |
| invoices | `invoices` with the programme, its registrations or its applications; `payment_plans` of the programme |
| payments | `payments` on those invoices |
| other | `documents`, `consent_acceptances`, `contracts` (programme or its registrations), `expenses`, `incident_reports`, `msg_conversations`, `recurring_fee_templates` |

Configuration rows are deleted along with the programme and do not block a delete. These are: registration form config and answers, form assignments, camp age groups and price options, packages, divisions, coach assignments, discounts scoped to the programme, alerts and slug redirects. Teams linked to the programme are kept, with `program_id` set to null.

## Database functions

All functions are `security definer` with `search_path = public`. Only admins of the programme's club may call them. Finance, coach and parent users get `NOT_AUTHORIZED`. A programme of another club, or one that does not exist, gives `PROGRAM_NOT_FOUND`. Every change is written to `audit_logs` (`program.delete`, `program.archive`, `program.restore`) with the name, statuses and counts only.

| Function | Returns |
|---|---|
| `program_delete_impact(p_program uuid)` | `jsonb`: `program_id, name, kind, status, previous_status, counts{…}, categories{registrations, bookings, schedules, attendance, invoices, payments, other}, total, can_delete, upcoming_sessions[≤10], upcoming_total, current_enrollments[≤10], current_enrollments_total` |
| `program_delete(p_program uuid)` | `{ok: true, deleted: true}`, or `{ok: false, deleted: false, code: 'PROGRAM_HAS_LINKED_RECORDS', impact}`. In the second case the impact counts are fresh and nothing was changed. |
| `program_archive(p_program uuid)` | `{ok, status: 'archived', previous_status}`. Raises `PROGRAM_ALREADY_ARCHIVED` if the programme is already archived. |
| `program_restore(p_program uuid)` | `{ok, status}`. Raises `PROGRAM_NOT_ARCHIVED` if the programme is not archived. |

The internal helpers `program_linked_records` and `program_admin_org` cannot be called by users.

**Concurrency.** `program_delete` and `program_archive` lock the programme row `FOR UPDATE` and count again in the same transaction. Records that reference the programme directly take a key-share lock on it, so they wait for the decision: registrations, sessions, camp weeks, invoices and the like. If a record arrives after the preview, the delete is refused with fresh counts.

## App code

- Server actions in `src/lib/actions/programs.ts`: `previewProgramDelete`, `deleteProgram`, `archiveProgram`, `restoreProgram`. `setProgramStatus(…, "archived")` now calls `archiveProgram`.
- Pure helpers in `src/lib/programs/program-delete.ts`. Typed RPC map in `src/lib/programs/db.ts`.
- UI in `src/components/admin/program-actions.tsx`: `ProgramDeleteButton`, `ProgramRestoreButton` and `ProgramActions`, using the accessible `PersonDialog`.
- Selectors that now hide archived programmes, while keeping the value an existing record already uses:
  - team form
  - registration editor
  - contract template editor
  - recurring fee templates
  - document upload and edit
  - form assignments
  - selection "add player"

  These already excluded archived or inactive programmes: discounts, incidents, J+S, waitlist, expense form, athlete enrolment, messaging, camp move-week and the public pages. Historic filters still list archived programmes: the registrations filter, form completion and finance reports.
