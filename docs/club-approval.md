# Club approval of family requests, next-step status, confirmed-only rosters

Migration `supabase/migrations/20250420105800_club_approval_status.sql`, tests `tests/db/club_approval.sql` and `tests/unit/next-step.test.ts`.

## What needs club approval

| Family action | Before | Now |
|---|---|---|
| "Join the club" on `/parent/membership` | membership + invoice created at once | **request pending club approval**; membership + invoice only after an admin confirms |
| Place in a club programme (`programs.kind` `recurring_team` / `clinic`, `programs.requires_club_approval`) on `/parent/club-programmes` | no in-app path | **request pending club approval**; registration + invoice + team roster only after approval |
| Staff-created membership / registration | direct | **unchanged (direct)** |
| Camps (age band, `20250420105100`) | admin approval for the band | unchanged |
| Selection / EYBL (`program_applications`) | own review queue | unchanged |
| Training bookings | own request flow | unchanged |

`programs.requires_club_approval` is on by default for `recurring_team` and `clinic` (backfill once + insert trigger) and can be switched off by an admin on the programme page (`ClubApprovalToggle`). Camps and selection programmes never use it.

While a request is pending, **nothing else is written**: no membership, registration, invoice or team row. The pending state lives only in `club_approval_requests`, which no camp or booking rule reads, so a pending club application can never block a camp registration or a training booking (tested).

A guardian can no longer insert a registration directly into a club-approval programme, nor confirm one by editing it (`registrations_club_approval_guard`, error `CLUB_APPROVAL_REQUIRED`); staff, the service role and the approval RPCs pass.

## Data

- `club_approval_requests`: `org_id`, `subject_kind` (`membership` | `program_registration`), `membership_type_id` / `program_id`, `family_id`, `athlete_id`, `requested_by`, `assigned_coach_ids` (reviewers snapshot at submit), `status` (`pending` | `info_requested` | `approved` | `declined` | `withdrawn`), `request_id` (unique per org), decision fields, `membership_id` / `registration_id` once approved. One open request per child (or household) and subject.
- `club_approval_messages`: the conversation (family note, club question, family answer, decision message), `client_request_id` for idempotent writes.
- RLS on both, every verb: read = admins of the club, assigned coaches (programme requests only), guardians of the family; no direct insert / update (RPCs only); delete = admins. Audit triggers on both.

## Reviewers and notifications

Reviewers of a programme request: the head coach(es) of the programme (`program_coaches.role = 'head'` and head coaches of its active teams); without a head, every coach of the programme / its teams; none -> admins. Admins can always decide. Membership requests: admins only. Finance never decides.

`notify_profile_ids` (returned by the RPCs) = assigned coaches with a login, else the club's admins. The server action sends the in-app notice + e-mail through `dispatchNotification` in each recipient's language (`src/lib/approvals/notify.ts`, same pattern as camp approvals). The family gets the decision / question the same way.

## RPCs (all `security definer`, `search_path = public`, caller checks, request id replay)

| RPC | Who | Effect |
|---|---|---|
| `club_request_submit(payload, request_id)` | guardian of the family | validates org, family link, child, type / programme, age, window, existing membership / registration, open duplicate; inserts the request |
| `club_request_decide(id, 'approve' \| 'request_info' \| 'decline', message, request_id)` | admin, or assigned coach (programme) | `request_info` needs a message; `approve` applies the existing rules (below); a full programme returns `PROGRAM_FULL` and changes nothing |
| `club_request_reply(id, message, request_id)` | guardian | answers an information request -> back to `pending` |
| `club_request_withdraw(id, request_id)` | guardian | open request -> `withdrawn` |
| `club_request_queue(scope)` | admin / coach | reviewer queue (coaches: minimal data, no contact details) |
| `club_request_family_list()` | guardian | own requests with the derived registration / membership / invoice state |
| `club_request_counts()` | staff | open counts (club requests + camp approvals for admins) |
| `session_roster_unconfirmed(attendance_session)` | session coach / admin | "Not yet confirmed" names + reason |

### Approve = existing enrolment and billing rules

- **Membership**: `membership_create_core()` — the body of `membership_create()` (from `20250420102400`) without the service-role check, callable only from inside the database. `membership_create()` keeps its contract and calls it. Price, period, sponsorship share, `pending_payment` / `active`, invoice and audit are therefore exactly as for a staff-created membership. The season-fee instalment billing (`membership_issue`, 11 instalments) is the separate staff "player billing" flow and is unchanged.
- **Club programme**: capacity check (pending + confirmed registrations, programme row locked); registration `pending` + one `sent` invoice of `programs.price_chf` due in 14 days (as public registration), or `confirmed` at once when free. When the invoice is paid in full the registration is confirmed (`invoices_club_approval_confirm`), and a confirmed registration of an approved request joins the programme's active team(s) (`team_memberships`, `registrations_club_approval_roster`). Participation contracts are issued as for staff enrolments.

## Next-step status (family-facing)

`src/lib/status/next-step.ts`:

```ts
nextStep({ status?, clubApproval?, campApproval?, consent?, balance? }): NextStep
```

Precedence: `declined` > `cancelled` > `awaiting_guardian_consent` > `information_requested` / `pending_club_approval` > `pending_camp_approval` > `awaiting_confirmation` (training request) > `waitlisted` > `awaiting_payment` (open balance > 0) > `confirmed`. Labels in `nextStep.*` (en, fr, de, it, es). Always derived on read from the source rows (request, registration / membership / booking, invoice), never stored.

Used in: My Bookings (training bookings, camp weeks, club programme requests), `/parent/membership`, `/parent/club-programmes`.

## Confirmed-only rosters

- `session_roster()` lists registrations `confirmed` / `completed` only (before: every status except `cancelled`, so pending, pending_approval and waitlist children were on attendance sheets).
- `session_roster_unconfirmed()` + `UnconfirmedList` on the coach attendance page: pending club approval, information requested, pending camp approval, awaiting payment — names only, not markable.
- `coach_can_access_athlete()`: a programme registration grants coach access only when `confirmed` / `completed`. A reviewer coach sees a pending child only through the minimal queue data.
- Team rosters (`ta_roster_on`, team sheets) read `team_memberships`, which a family request only creates after approval + confirmation; `bk_event_roster` was already confirmed-only.

Changed test expectation: `supabase/tests/auth_tests.sql` assert 3 expected a coach to see a child whose camp registration was still unpaid (`pending`). It now asserts no access while unconfirmed, and access once confirmed.

## Screens

- `/admin/approvals` (admin nav "Approvals"): open / decided club requests, link + count to `/admin/camps/approvals`.
- `/coach/approvals` (coach nav "Club requests"): assigned programme requests.
- `/parent/club-programmes` (parent nav "Club programmes"): request a place, follow requests.
- `/parent/membership`: "Join the club" request form when the club offers active membership types (else the existing "no membership on offer" message), membership requests list.
- Admin programme page: club approval toggle for teams / clinics.

## Open points

- Public registration (`register_public`, `/register/[programSlug]`) still creates a pending registration + invoice for club programmes; routing it to `club_request_submit` belongs to the public-entry workstream.
- Guardian-consent holds (`awaiting_guardian_consent`) are produced by the consent workstream; the helper and the unconfirmed list already have the label.
