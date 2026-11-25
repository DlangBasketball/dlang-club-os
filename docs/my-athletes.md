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
| `NO_GUARDIAN_LOGIN` (since `20250420106300`, informational) | the family has no login and the athlete has none either — a staff-created / imported athlete. Expected, **not a problem**: shown with a "Suggestion" badge and a one-click **Invite a guardian** (`inviteGuardianForFlag` → existing `inviteUser`, role parent, family contact e-mail; the flag is marked `invited_at` and resolves itself once a guardian or the player logs in). Not raised for a "someone else" holding family awaiting consent. |
| `ATHLETE_WITHOUT_GUARDIAN` | no longer raised by the data check; the attendance review raises it only for a rostered player whose family **has** logins none of which can be reached |

Resolved or dismissed findings are never raised again (any earlier flag of the same code — open, resolved or dismissed — blocks a new one). The migration reclassified the open `ATHLETE_WITHOUT_GUARDIAN` flags of athletes without any login: each old flag is resolved with the note "Reclassified: …" (history kept, nothing deleted) and an informational `NO_GUARDIAN_LOGIN` flag (`details.previous_flag_id`) is opened.

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
* Finance: **billing only** (enforced in the database since `20250420106300`, see "Finance scope" below). `participant_is_staff()` is admin-only, finance has no read or write on the `athletes` table, reads billing columns through `billing_athletes`, sets sponsorships through `athlete_sponsorship_set`; no medical data, no sports profile RPC, no profile history, no merge / data check.
* Admins: within their club (every RPC checks `current_org_id()`).

## Audit and profile history

* `trg_athletes_profile_audit` writes `athlete.profile.created` / `athlete.profile.changed` for every insert / change of a profile field (names, DOB, sex, height, weight, position, jersey size, preferred number, login link, family, status, merge) with **before / after of the changed fields only**, the actor, `_meta.via` (staff, family, coach, club_approval, merge, review, system) and `_meta.reason`. Erasure records the event only (`athlete.profile.erased`), never the content.
* DOB / sex corrections: `athlete.profile.correction.requested|approved|declined|withdrawn` on the athlete.
* Link decisions (`participant.link.*`), proposals and merges as above.
* **Profile history** tab on `/admin/athletes/[id]` (admins only; `athlete_profile_history()` refuses everyone else, finance included): events in the club's locale (`f.dateTime`, translated field and action names, ids never shown raw).

## Tests

`tests/db/my_athletes.sql`: two children + self under one parent, switcher validation (own / foreign family / other club / stale / anonymous); coach restricted (other team, unconfirmed registration, sports-only writes); finance (medical, sports profile, RPC + direct edit, history, merge, data check); duplicate prevention (same parent twice → same athlete; other family → opaque `POSSIBLE_MATCH` + link request, no duplicate); data check flags + idempotency; self link only on staff confirmation; merge (permissions, cross-tenant, moved rows, recorded conflicts, archive, audit, replay, `ALREADY_MERGED`); club requests with proposals (pending → nothing applied; coach / admin views; approve applies values + roster number; taken number; reserved → assigned on confirmation; DOB through staff review; decline; replay); profile history (admin only); cross-tenant denial for every new RPC and the new table.

## Flexible link access: "Whole family" or "This child only" (`20250420106300`)

Migration `supabase/migrations/20250420106300_flexible_links_finance_scope.sql` · DB suite `tests/db/flexible_links.sql` (101 assertions) · unit `tests/unit/flexible-links.test.ts`.

Aunts, uncles, grandparents and friends can register a family member's or a friend's child without seeing the rest of the family. Whoever approves a link request (a family guardian of the child in **/parent/family**, or staff in **/admin/data-review**) now chooses the **scope**:

| Scope | Stored in | Access |
|---|---|---|
| **Whole family** (default for mother / father / guardian requests) | `family_members` (non-primary) with `can_pay`, `can_see_medical`, `receives_emails` | unchanged: a co-guardian, sees every child of the family |
| **This child only** (default for anyone else) | `athlete_guardian_links` (org, athlete, profile, relation `aunt_uncle / grandparent / adult_sibling / family_friend / other_carer`, `can_register`, `can_pay`, `can_see_medical`, `receives_emails`, `can_edit_profile`, `granted_by`, `status active / revoked`, `revoked_by / _at / revoke_reason`, `link_request_id`) | that one athlete only |

Defaults for "This child only": book + pay + e-mails on, medical + profile edits off; the approver can change them. Booking implies paying (`can_register ⇒ can_pay`, check constraint + `REGISTER_NEEDS_PAY`): a linker's bookings are invoiced to them, never to the family. One active link per (child, adult); the table has RLS on every verb (read: the linked adult, the child's family guardians, admins of the club; writes: RPCs only), the restrictive tenant-isolation policy, `updated_at` and the audit trigger; grant, permission change (`participant.link.permissions`, before / after) and revocation (`participant.link.revoked`, via guardian / staff / self) are audited.

### How each permission is enforced

The family helpers stay strictly family-scoped (`is_guardian_of_athlete`, `is_guardian_of_family`, `guardian_can_pay`, `is_primary_guardian`), so every family-wide surface — siblings, `families` (address, contact), `family_members`, family invoices / billing, documents, consents, forms, development, attendance overviews — stays closed to a linker. New helper `athlete_link_can(athlete, 'view' | 'register' | 'pay' | 'medical' | 'emails' | 'edit_profile')` (active link, current club, live athlete) is granted explicitly where it applies:

| Permission | Where |
|---|---|
| view | `athletes_link_select` policy (the child's row only); `my_athlete_ids()` / `my_athletes()` (kind `linked`, relation, permissions; no family id, no balances, no memberships / club requests; sports fields only with `can_edit_profile`) → My Athletes, switcher, `/parent/children/[id]` (restricted `LinkedChildView`) |
| can_see_medical | `guardian_can_see_medical()` → `medical_select` (read). Medical **writes** stay with the family (`medical_guardian_write` now also requires `is_guardian_of_athlete`) |
| can_edit_profile | `participant_can_manage()` → `participant_update`, `participant_update_sports`, `participant_sports_profile`, corrections (DOB / sex still go to staff review when an enrolment is affected). No direct table write (`athletes_guardian_write` checks the family) |
| can_register (+ can_pay) | a `participant_bookers` row (scope `linked`) kept in step by `athlete_link_sync_booker()`; `gc_is_booker()` honours it only while the link is active with `can_register`. Camp checkout (`submitCampParent` → `third_party_camp_hold`) and training requests (`/parent/bookings/request` → `third_party_training_request`) use the existing "someone else" flow. The picker shows the child under **"A child I'm linked to"** (relation badge) wherever "Someone else" is offered; forms without the consent flow (training wizard `/parent/bookings/new`, club programme / membership requests, selection applications, waiting list) do not offer linked children |
| can_pay | invoices of what the linker booked are addressed to them (`billing_payers` kind `other`, `payer_profile_id`); the child's family billing is not touched |
| receives_emails | stored and shown; booking e-mails (consent outcome, invoice) go to the linker as the booker. Club broadcasts to families do not include linkers (follow-up) |

### Consent rule (default)

A linker can never give the parental consent. Each booking is held (place kept, no invoice) and `gc_open_request()` creates a guardian consent request addressed to the child's family (`existing_child`; primary guardian's e-mail, else another guardian's, else the family contact e-mail — `NO_GUARDIAN_CONTACT` when none). Only a member of the child's family can accept (`NOT_GUARDIAN` otherwise, `BOOKER_CANNOT_CONSENT` for the linker); on acceptance the existing flow records the consents and issues the invoice to the linker. A club policy letting non-guardian carers consent themselves is **not** implemented (follow-up); the default above always applies.

### Revocation and management

* Family guardians see every active per-child link of their children in **/parent/family** ("People linked to one child": change permissions, end access); admins in the athlete page (`/admin/athletes/[id]`, guardians column); the linked adult can end their own link from the child page.
* Revocation (`athlete_link_revoke`) is immediate: the row stops matching every helper, the booker row is removed, pending holds are cancelled (`gc_cancel_items`, request `revoked`, place freed). Bookings a guardian already consented to stay. The link row is kept as history (`status = revoked`).
* Approving "Whole family" for an adult who already has a per-child link supersedes it (revoked, reason "superseded by family access").

RPCs (all `security definer`, `search_path = public`, caller + club checked in SQL): `participant_link_decide(request, decision, {scope, relation, can_*}, note)`, `athlete_links_for(athlete)`, `athlete_links_mine_to_manage()`, `athlete_link_update(link, permissions)`, `athlete_link_revoke(link, reason)`.

## Finance scope (`20250420106300`)

Before, `athletes_select` and `athletes_admin_write` granted `is_finance()` (admin **or** finance) every column of every athlete. Now:

* `athletes_select`: admins of the club, family guardians, coaches of the player (+ `athletes_link_select` for linkers). `athletes_admin_write`: admins only.
* `billing_athletes` (security-barrier view, caller's club, `is_finance()` = admin or finance): `id, org_id, family_id, first_name, last_name, status, archived_at, merged_into_id, created_at`, sponsorship columns and `licence_fee`. **No** DOB, sex, height, weight, position, jersey, hand, nationality, school, notes, photo, licence identity, medical, documents. DOB is not needed by any billing screen (membership player search falls back to name search for finance; admins keep birth-year search).
* `athlete_sponsorship_set(athlete | family, row)`: sponsorship writes for admin / finance (the existing guard stamps and audits).
* Code paths switched to the view: `src/lib/data/money-edit.ts`, `player-billing.ts`, `families.ts`, `dashboard.ts`, `sponsorships.ts`, `registrations.ts`, `src/lib/plans/data.ts`, `src/lib/finance/data.ts`, `src/lib/accounting/data.ts`, `src/lib/actions/sponsorship.ts`, `player-directory.ts` (finance branch), the membership list (`src/lib/club-admin/data.ts` `decorateMemberships`), and `getAthleteDetail` / family detail fall back to billing columns for a finance-only caller (admins keep the full row). Admins (often also finance) are unaffected.

## Privacy notes (nFADP / GDPR, minors)

* **Data minimisation.** A per-child linker gets one child, not the family: no siblings, no family address / contact, no family invoices or balances, no memberships or club requests, no documents or consents. Medical data only when a family guardian (or staff) turns on `can_see_medical`, read-only; sports profile only with `can_edit_profile`.
* **Consent stays with the family.** Parental consent for a booking is always given by a member of the child's family (guardian consent request, `existing_child`); a linker can never consent. The family can see, change and end every per-child link at any time (immediate effect).
* **Accountability.** Every grant, permission change and revocation is written to `audit_logs` (who, when, before / after); revoked links are kept as history (`status = revoked`, `revoked_by`, `revoked_at`, `revoke_reason`) and fall under the club's normal retention for guardian records.
* **Purpose limitation for finance.** Finance users process billing only: `billing_athletes` exposes identity, family, status and sponsorship, nothing about health, sport, school, nationality, photos or date of birth. Screens finance does not need (attendance, development, camp edition rosters, the assistant's athlete list) return no athlete rows to a finance-only user rather than profile data.
* **Staff-created athletes.** A child registered by staff without a guardian login is lawful and expected; the data check only suggests inviting a guardian at the family contact e-mail already on file (no new data collected), and never re-raises a dismissed suggestion.
* Synthetic data only in tests (`tests/db/flexible_links.sql`).

## Open points

* Finance-only users see no athlete names on screens that are not billing screens and still read the `athletes` table (e.g. camp edition lists, selection reports, forms exports): these degrade to missing names rather than exposing profile data. Switch them to `billing_athletes` when finance needs them.
* A guardian cannot yet invite a relative directly for one child by e-mail (the invitations table / `consume_invitation` are family-scoped); today the relative requests the link and the guardian approves "This child only". Follow-up: an athlete-scoped invitation.
* "Carers may consent" club policy (see Consent rule) and family broadcasts to linkers with `receives_emails` are follow-ups.
* Club programme / membership requests and selection applications stay with family guardians (no consent flow there).
* A merge of athletes from different families does not grant the other family's guardians access; staff use a link request / invitation.
