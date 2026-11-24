# My Athletes, athlete switcher, merge, proposed profile details

Migration `supabase/migrations/20250420106200_my_athletes_sync.sql` · tests `tests/db/my_athletes.sql` (124 assertions), `tests/unit/my-athletes.test.ts`.

Builds on [participant-profiles.md](participant-profiles.md) (one `athletes` row per participant) and [club-approval.md](club-approval.md). No new athlete rows are created for existing people: every screen reuses the existing athlete ids.

## Parent app

| Route | What |
|---|---|
| `/parent/athletes` | **My Athletes** (canonical list): the adult's own self profile (`athletes.player_profile_id = auth.uid()`) and every child of their families in the current club, with age, active teams (roster number), live programmes, next-step badges (`src/lib/participants/next-steps.ts` on top of `nextStep()`), pending DOB / sex corrections. Actions: **Add athlete** (`AddParticipantDialog`, `participant_create`) and **Add myself** (adults 18+, `participant_self_ensure`). |
| `/parent/children` | Redirects to `/parent/athletes` (old links / bookmarks). |
| `/parent/children/[id]` (+ `/card`, `/training`) | Unchanged athlete page. `/parent/athletes/[id]` redirects here. |

Labels use the club's terminology: `myAthletesLabel()` (`src/lib/tenant/terms.ts`) returns the translated "My athletes" / "Mes athlètes" for an untouched tenant, or `nav.myAthletesTerm` ("My {term}") filled with the tenant's plural term ("My Players", "My Students"). Used for the nav entry, the bottom tab and the page title. The nav item keeps `/parent/children/*` highlighted through `NavItem.aliases`.

Data: `my_athletes()` (security definer, current club, caller = `auth.uid()`; no client-supplied id) → `getMyAthletes()` / `getActiveAthleteState()` in `src/lib/participants/my-athletes.ts` (React `cache`, one read per request).

## Active athlete (switcher)

* Shown under the parent header (`AppShell.subHeader`, `ActiveAthleteSwitcher`) when the adult has 2+ active athletes: **All** + one chip per athlete.
* Choosing one calls `setActiveAthlete()` (`src/lib/actions/my-athletes.ts`): the id is checked with `my_athlete_resolve()` in the database, then stored in the httpOnly cookie `clubos_active_athlete` = `<userId>.<orgId>.<athleteId|all>` (SameSite=Lax, Secure in production, 1 year).
* Every read re-validates it (`resolveActiveAthlete()`): the cookie must belong to the same user and club and the athlete must still be in `my_athletes()`; otherwise it is ignored. A foreign / stale / malformed id never selects anything (unit + DB tests).
* Pages resolve their athlete with `athleteFilterFor(param, { allowAll })` → `resolveAthleteFilter()`: explicit `?athlete=` (validated; `all` where lists make sense) → active athlete → all (lists) / first athlete (single-athlete pages). `AthleteFilterBar` lets a page switch locally without changing the preference.

| Page | Default |
|---|---|
| `/parent/schedule` | active athlete's reply lines; All |
| `/parent/attendance` | active athlete (single-athlete page) |
| `/parent/development`, `/parent/journey` | list filtered to the active athlete; All |
| `/parent/kit`, `/parent/forms`, `/parent/documents` | filtered; family-wide documents always shown; All |
| `/parent/bookings` | bookings, camp weeks and club programme requests of the active athlete; All |
| `/parent/bookings/new`, `/parent/club-programmes`, `/parent/membership`, `/parent/programmes/[id]`, `/parent/waitlist`, `/parent/camps/[id]` (form + basket) | active athlete preselected |
| `/parent/invoices` | not filtered: invoices are family / payer level (no per-athlete list field) |

The schedule and documents pages had hard-coded English; their page strings now come from `myAthletes.pages.*`.

## Shared athlete picker

`AthletePickerField` (`src/components/participants/athlete-picker-field.tsx`) = `ParticipantPicker` in single mode + active-athlete preselection + `router.refresh()` after an inline creation (the new participant is selected at once, the rest of the form keeps its state).

| Form | Myself | Someone else |
|---|---|---|
| Club programme request (`ClubProgramRequestForm`) | when the programme accepts adults (`acceptsAdults(max_age)`) | no |
| "Join the club" person membership (`JoinClubRequestForm`) | when the type accepts adults | no |
| Selection / EYBL application (`ParentApplyForm`) | no | no — application rules and server action unchanged; only the child select was swapped; an added child is selected |
| Training booking wizard `/parent/bookings/new` | yes | no — third-party training stays on `/parent/bookings/request` (guardian consent flow) |
| Waiting list, camp basket | no | no |
| Camp registration | unchanged (already the picker, with "Someone else") | yes |

`club_request_submit` now accepts a payload without `family_id` when `athlete_id` is given (the athlete's family is used; the base function still requires the caller to be its guardian).

## Proposed profile details on club requests

The membership and club-programme forms have an optional "Add or update profile details" section: position, preferred jersey number, jersey size, height, weight, and a DOB / sex correction.

1. **Submit** — `club_request_submit(payload.profile)` validates the keys (`FIELD_NOT_ALLOWED` otherwise) and values (`participant_read_sports`, `participant_read_dob`, male / female), keeps only the values that differ from the profile and stores them in `club_approval_requests.proposed_profile` (`{sports, eligibility}`). Nothing is applied. Audit `athlete.profile.proposal.submitted`.
2. **Review** — `club_request_row()` adds `profile: {proposed, current, outcome}`. Admins and the family see everything; an assigned coach sees the sports fields only (no DOB / sex, current or proposed). `/admin/approvals` and `/coach/approvals` render it (`ProposedProfile`), the family sees it on its request.
3. **Approve** (admin or assigned coach), same transaction as the existing approval (`club_profile_apply`):
   * sports fields applied to the athlete (`participant_apply_sports`, audit path `club_approval`);
   * DOB / sex → a pending `athlete_change_requests` row + `ATHLETE_ELIGIBILITY_CHANGE` flag (applied only when staff approve in `/admin/data-review`);
   * preferred number → the new roster row of each active team of the programme when the number is free there (`assigned`); taken → the roster number stays empty and the reviewer is told (`taken`); a paid programme's roster row is created on confirmation, so the number is `reserved` and `trg_registrations_profile_jersey` puts it on the row when the registration is confirmed (if still free).
   * The outcome is stored in `profile_outcome` and returned; `decideClubRequest` appends it to the reviewer's message. Replays apply nothing twice.
4. **Decline** — nothing changes; `profile_outcome = {status: declined}`; audit `athlete.profile.proposal.declined`.

After approval every portal reads the same row: parent profile, admin athlete page, coach player view (`participant_sports_profile`) and team roster (`team_memberships.jersey_number`) — tested.

The original functions are kept unchanged as `club_request_submit_base`, `club_request_decide_base`, `club_request_row_base` (renamed once, internal only); the public names wrap them.

## Data checks and merge (staff)

`athlete_data_check()` (admin, current club; also run by **Refresh** and **Check athlete records** on `/admin/data-review`) raises flags only — never merges, links or deletes. A finding staff already resolved is not raised again (idempotent).

| Flag | Rule |
|---|---|
| `POSSIBLE_DUPLICATE` | same `bk_norm(first)`, `bk_norm(last)` and DOB in the club; every record but the oldest is flagged with `match_ids` |
| `POSSIBLE_SELF_LINK` (new) | adult player (18+) without login whose family contact e-mail **and** name match exactly one login of the club / family that is not linked yet. Staff confirm with **Link to this login** (`athlete_self_link_decide` → `ta_link_player`) or dismiss. |
| `ATHLETE_WITHOUT_GUARDIAN` | no family member and no own login (`source: data_check`) |

**Merge** — `/admin/data-review` lists open duplicate pairs side by side (`athlete_duplicate_pairs`: family, created, teams / registrations / invoices counts, login). Staff pick the record to keep (default: the older one), add an optional reason, confirm. `athlete_merge(keep, duplicate, reason, request_id)`:

* admin of the club only; both athletes must be in the caller's club (else `NOT_FOUND`, no cross-tenant hint); not the same, not erased, duplicate not already merged;
* one transaction; every single-column foreign key to `athletes(id)` is discovered from `pg_constraint` (`athlete_fk_columns()`, excluding `athletes` and the merge log) and each row is moved to the kept id;
* a unique / exclusion conflict (same team, member card, open request…) keeps the kept athlete's row; the duplicate's row stays on the archived duplicate and is recorded in `conflicts`; any other refusal aborts everything (`MERGE_BLOCKED`);
* the duplicate's login moves to the kept athlete when it has none (else recorded); a different family is recorded (guardians are not silently granted the other family);
* the duplicate is archived (`status = 'archived'`, `archived_at`, `merged_into_id`, `merged_at`) — never deleted, hidden everywhere like other archived people, not in the purge queue;
* `athlete_merges` log (RLS: admins read; no direct writes), flags resolved, audit `athlete.merge.kept` / `athlete.merge.archived`; the request id makes a retry return the first result.

## Permissions (API + data layer)

* Guardians: `my_athletes()` / `my_athlete_resolve()` only return their own athletes; profile writes stay on `participant_*` RPCs and the existing RLS.
* Coaches: read only confirmed players of their teams / programme sessions (`coach_can_access_athlete`), write sports fields only (`participant_update_sports`, `FIELD_NOT_ALLOWED` for anything else); sports-only view of proposals.
* Finance: **billing only**. `participant_is_staff()` is now admin-only (finance can no longer edit profiles through the participant RPCs), and `trg_athletes_finance_profile_guard` refuses profile-field changes by a finance-only caller through the table policy (`FIELD_NOT_ALLOWED`). Finance still reads athlete identity for invoices; no medical data, no sports profile RPC, no profile history, no merge / data check.
* Admins: within their club (every RPC checks `current_org_id()`).

## Audit and profile history

* `trg_athletes_profile_audit` writes `athlete.profile.created` / `athlete.profile.changed` for every insert / change of a profile field (names, DOB, sex, height, weight, position, jersey size, preferred number, login link, family, status, merge) with **before / after of the changed fields only**, the actor, `_meta.via` (staff, family, coach, club_approval, merge, review, system) and `_meta.reason`. Erasure records the event only (`athlete.profile.erased`), never the content.
* DOB / sex corrections: `athlete.profile.correction.requested|approved|declined|withdrawn` on the athlete.
* Link decisions (`participant.link.*`), proposals and merges as above.
* **Profile history** tab on `/admin/athletes/[id]` (admins only; `athlete_profile_history()` refuses everyone else, finance included): events in the club's locale (`f.dateTime`, translated field and action names, ids never shown raw).

## Tests

`tests/db/my_athletes.sql`: two children + self under one parent, switcher validation (own / foreign family / other club / stale / anonymous); coach restricted (other team, unconfirmed registration, sports-only writes); finance (medical, sports profile, RPC + direct edit, history, merge, data check); duplicate prevention (same parent twice → same athlete; other family → opaque `POSSIBLE_MATCH` + link request, no duplicate); data check flags + idempotency; self link only on staff confirmation; merge (permissions, cross-tenant, moved rows, recorded conflicts, archive, audit, replay, `ALREADY_MERGED`); club requests with proposals (pending → nothing applied; coach / admin views; approve applies values + roster number; taken number; reserved → assigned on confirmation; DOB through staff review; decline; replay); profile history (admin only); cross-tenant denial for every new RPC and the new table.

## Open points

* Finance can still `select` sports columns of the `athletes` row through the existing billing read policy (column-level hiding would break the shared PostgREST reads); the RPCs and UI never show them to finance.
* A merge of athletes from different families does not grant the other family's guardians access; staff use a link request / invitation.
* Third-party ("Someone else") booking is not offered in the training wizard or club forms (no consent flow there yet).
