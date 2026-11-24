# Participant profiles

Migration `supabase/migrations/20250420105600_participant_profiles.sql` · tests `tests/db/participant_profiles.sql`, `tests/unit/participants.test.ts`.

One profile per participant across the app: the existing `athletes` row. Camps, training, club programmes, rosters and attendance all point to it. Nothing here adds per-club code paths; terminology and position labels come from the catalogs (`participants.*`).

## Data model

| Field | Where | Notes |
|---|---|---|
| First / last name, DOB, sex | `athletes.first_name`, `last_name`, `dob` (NOT NULL), `gender` | New forms offer male / female. Stored legacy values (e.g. `other`) stay readable and can be saved back unchanged; a new value must be male / female. |
| Height, weight | `athletes.height_cm`, `weight_kg` (new, optional) | 40–250 cm, 10–250 kg. |
| Position | `athletes.position_pref` (existing) | The forms suggest basketball positions (`participants.positions.*` keys); free text is kept. |
| Jersey | `athletes.jersey_size` (existing), `athletes.preferred_jersey_number` (new, 0–999) | The preferred number is a wish only. Team numbers stay on `team_memberships.jersey_number`, one per roster; profile edits never write them (tested). |
| "Myself" | `athletes.player_profile_id = auth.uid()` | The adult's own profile, created on first use in the adult's household. Adults only: 18+ on the activity date (`SELF_MUST_BE_ADULT`). |

Booker, payer and participant stay separate: the person booking is the session user (`registrations.registered_by`, `training_bookings.created_by`), the payer is `billing_payers` / the family; a participant booked for "someone else" (Workstream B) never gets the booker in its `family_members`.

## Who may edit what (server-enforced)

| Caller | Fields | Path |
|---|---|---|
| Admin of the club (finance: billing only since `20250420106200`, see docs/my-athletes.md) | everything | `updateAthlete` (admin form) or `participant_update`; applied at once, audited |
| Guardian of the athlete (any `family_members` row of the athlete's family in the current club; the existing guardian model has no separate edit permission) | name, DOB, sex, sports fields | `participant_update` / `participant_update_sports` |
| The adult on their own self profile | same as guardian | same |
| Coach of the player (active `team_memberships` on a team in `team_coaches`, or a confirmed registration in a programme with one of their sessions) | height, weight, position, jersey size, preferred number only | `participant_update_sports`; any other key → `FIELD_NOT_ALLOWED` |

After a save the actions call `revalidatePersonEverywhere` (admin, coach, parent, public groups) plus the athlete's own pages.

## DOB / sex corrections and eligibility review

`participant_enrollment_impact(athlete, new_dob, new_sex)` lists the live enrolments a correction could affect:

* active team memberships (status ≠ inactive, not ended),
* non-camp registrations `pending`, `confirmed`, `pending_approval`,
* programme applications `applied`, `under_review`, `accepted`, `waitlisted`, `enrolled`,
* memberships `active` / `pending_approval` still valid,
* upcoming camp registrations whose age band (`camp_age_band` on the first day) or chosen age group would change (DOB only).

Flow for a non-staff caller:

1. No impact → the change applies immediately; `audit_logs` gets `athlete.eligibility.changed` (old / new, `via: family`).
2. Impact → nothing changes on the athlete; an `athlete_change_requests` row (pending, one per athlete; a newer correction supersedes it) and a `data_review_flags` row `ATHLETE_ELIGIBILITY_CHANGE` are created; admins get an in-app notice. Other fields of the same save still apply.
3. Admins decide in **/admin/data-review** (panel "Profile corrections to review"): approve applies the change (audited `via: review`), decline keeps the athlete and notifies the family with the optional message. Either way the flag is resolved.

The RLS bypass is closed: `trg_athletes_eligibility_guard` (BEFORE UPDATE OF dob, gender) raises `REVIEW_REQUIRED` for a non-staff caller when impact exists, whatever the path (direct table update included). Staff, the service role, the review RPC (`app.participant_review_apply`) and erasure / anonymisation bypass it.

## Adding a participant and duplicates

`participant_create(payload, request_id)` (parent app): name, DOB, sex required; sports fields optional. Idempotent on `request_id` (`booking_requests`, kind `participant_create`): a retry or double click returns the same athlete. The same child already in one of the caller's families is returned as `existing`.

Matching is private: normalised first + last name (`bk_norm`, case and accents) + DOB in the same club, outside the caller's families. A parent only ever receives `{ ok: false, code: "POSSIBLE_MATCH" }` — no id, name, family or count. `people_duplicate_check` stays staff only. The UI then offers:

* **Request link** → `participant_link_request` creates an `athlete_link_requests` row (opaque id to the requester) and a `ATHLETE_LINK_REQUEST` flag. The child's existing guardians are notified and see the request in **My family** (`participant_link_inbox`, with the requester's name and e-mail so they can verify); admins see the full match in **/admin/data-review**.
* **This is a different child** → a new profile is created and flagged `POSSIBLE_DUPLICATE` for staff.

### How an approved link grants access

`participant_link_decide(request, 'approve', permissions)` — by a guardian of the child (not the requester) or an admin — inserts the requester into the child's **family** (`family_members`, `is_primary = false`, relation from the request; `other` is stored as `guardian`) with the permissions the approver chose: `can_pay`, `can_see_medical`, `receives_emails` (defaults: no payment, no medical, e-mails on). The existing guardian model is family-scoped, so the new guardian sees every child of that family, exactly like an invited second guardian; the primary guardian or an admin can change the permissions later (`set_guardian_permissions`) or remove them (`remove_family_guardian`). No duplicate athlete is created. Requests expire after 30 days; the requester can withdraw.

Admin-created athletes (`createAthlete`) warn about a same-name-and-DOB match (names visible to staff) and need "Create anyway".

## Parent app screens

* **/parent/family** — "Add a child", link-request inbox, "My link requests".
* **/parent/children** — "Add a child" (all strings translated).
* **/parent/children/[id]** — "Edit profile": name, DOB, sex, sports fields; pending corrections with withdraw.
* **/parent/camps/[programId]**, **/parent/bookings/request** — `ParticipantPicker` ("Myself", "A child in my family", "Someone else"); adding a child or creating "Myself" happens inline, the new participant is selected, the rest of the form keeps its state.
* **/parent/programmes/[programId]** — "Add a child" entry above the (unchanged) selection application form; the list refreshes without losing the form.
* Coach **/coach/development/athletes/[id]** — "Sports details" card (coach of the player only).
* Admin **/admin/athletes/[id]/edit** — height, weight, preferred jersey number.

## ParticipantPicker

`src/components/participants/participant-picker.tsx`

```ts
<ParticipantPicker
  participants={choices.participants}   // getParticipantChoices(me): self first, then children
  self={choices.self}                   // { athleteId | null, dob, firstName, lastName }
  value={ids} onChange={(ids, all) => …}
  multiple                              // camps: several; training: one
  activityDate="2027-07-05"             // "Myself" needs 18+ on it
  allowSelf allowOther
  disabledReason={(p) => string | null} // e.g. outside the camp's ages
  renderBadge={(p) => …} renderSelected={(p) => …}
  someoneElse={(ctx) => <B's component {...ctx} />}   // slot for Workstream B
  onCreated={(p) => router.refresh()}
/>
```

`SomeoneElseSlotContext = { activityDate, onCreated(participant), onCancel(), idPrefix }`. Without a slot the default `SomeoneElseForm` collects the participant (name, DOB, sex), the participant's parent / legal guardian (name, e-mail and / or phone) and the booker's relation (nephew / niece, friend's child, other) and calls:

```ts
// src/lib/participants/third-party.ts  ("use server")
createThirdPartyParticipant(input: ThirdPartyInput, requestId: string): Promise<ThirdPartyResult>
type ThirdPartyResult =
  | { ok: true; data: { participant: ParticipantOption /* kind "other" */; status: "awaiting_consent" | "ready"; consentRequestId: string | null; replayed: boolean } }
  | { ok: false; code: ParticipantErrorCode | "INVALID_INPUT"; error: string };
```

Today it validates and returns `THIRD_PARTY_NOT_ENABLED`; Workstream B implements it (guardian consent, place hold).

## RPCs

All `security definer`, `search_path = public`, caller org = `current_org_id()`; no client-supplied org or role.

| Function | Caller |
|---|---|
| `participant_create(p_payload jsonb, p_request_id uuid)` | signed-in adult (guardian of the target family) |
| `participant_self_ensure(p_payload jsonb, p_request_id uuid)` | signed-in adult |
| `participant_update(p_athlete uuid, p_payload jsonb, p_request_id uuid)` | staff, guardian, self |
| `participant_update_sports(p_athlete uuid, p_payload jsonb)` | staff, guardian, self, coach of the player |
| `participant_sports_profile(p_athlete uuid)` | same as above (null otherwise) |
| `participant_change_decide(p_request uuid, p_decision text, p_note text)` | admin |
| `participant_change_withdraw(p_request uuid)` | requester / guardian |
| `participant_link_request(p_payload jsonb, p_request_id uuid)` | signed-in adult |
| `participant_link_decide(p_request uuid, p_decision text, p_permissions jsonb, p_note text)` | guardian of the child (not the requester) or admin |
| `participant_link_withdraw(p_request uuid)` | requester |
| `participant_link_inbox()` / `participant_my_requests()` | signed-in adult |
| `participant_review_queue()` | admin |

Both new tables have `org_id` + index, RLS on every verb (writes through the RPCs only), the restrictive tenant-isolation policy, `updated_at` and an audit trigger.
