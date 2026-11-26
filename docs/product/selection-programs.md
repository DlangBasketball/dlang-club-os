# Selection programmes

Programmes that players **apply to** and staff **select from**: international or
representative teams, academies, tryout-based squads. Generic for every club and
sport; a club configures one through data. Module key: `selection_programs`
(Academy tier, add-on elsewhere).

## What a programme has

| Part | Where | Notes |
|---|---|---|
| Flags | `programs.selection_enabled`, `requires_approval`, `allow_non_members` | Kind `selection` ("Selection team") turns applications on at creation. |
| Divisions | `program_divisions` | Name, birth-year range and/or "under N" on a cut-off date, optional team (roster on enrolment), places. The applicant's division is suggested from the date of birth; admins can override. |
| Packages | `program_packages` | Price (programme / club currency) and the instalment counts the family may choose (`allowed_counts`, always includes 1 = pay in full). Shown as "from 300/month × 10" (price / largest count). These rules replace the club-wide `payment_plan_settings` for the package invoice. |
| Coaches | `program_coaches` | Head / assistant, whole programme or one division. Assigned coaches review in the coach app; the head coach may also sponsor applicants. |
| Applications | `program_applications` | `applied → under_review → accepted / waitlisted / declined → enrolled → withdrawn`. |

## Flow

1. **Apply.** Members: parent app → Programs → pick child and package (two taps).
   Non-members: public page `/register/<slug>` creates a guest family, the athlete,
   consents and a parent invitation (sign-in link or password). Guest families see
   only programme-relevant parts of the parent app (no board, carpooling, kit,
   development).
2. **Review.** Admins (`/admin/selection/<id>`) and assigned coaches
   (`/coach/selection/<id>`) accept, waitlist or decline (message required) with a
   note to the family. Every status change notifies the family (in-app, push, email).
3. **Pay.** Acceptance issues one invoice for the package (linked by `program_id`
   and the application). The family picks pay in full or N monthly instalments from
   today (any allowed count) — QR-bill, card, TWINT and autopay as for every plan.
   `plan_choose` on a package invoice follows the package rules too. The package can
   change until money is received or a plan exists (the unpaid invoice is cancelled
   and reissued).
4. **Enrol.** First payment (or a plan set-up, or a fully sponsored invoice) sets
   `enrolled`, adds the player to the division's team and confirms the programme
   registration.
5. **Sponsor.** Admin / finance / head coach marks an applicant sponsored (full or
   partial): the player's sponsorship gains scope `program`, and the package invoice
   shows the "Sponsored" credit note (ledger `athlete_sponsorship_entries`).

## Revenue

- Admin dashboard card **Program revenue**: per programme invoiced, collected,
  outstanding, sponsored, and applicants / to review / accepted / enrolled per
  division (`selection_program_stats`).
- `/admin/selection/report`: one row per application, filters season / programme /
  division / package, CSV export (`selection_report`).

## Founding club set-up (EYBL)

`scripts/seed-selection-eybl.sh` (SQL in `supabase/seeds/selection_eybl_dlang.sql`)
configures the club's EYBL team for organisation
`00000000-0000-0000-0000-000000000001` only, as data:

- programme "EYBL 2026-27", slug `eybl`, kind selection, public, approval required,
  non-members welcome;
- divisions U14 (born 2013 or later) and U16 (born 2011–2012), each with a team;
- packages 1 tournament 1500 (1–5 instalments, 300 × 5), 2 tournaments 3000
  (1–10, 300 × 10), 3 tournaments 4500 (1–10, 450 × 10);
- coaches "Derrick Lang" (head) and "Ademir Sunj" (assistant) when they exist.

```bash
DATABASE_URL=postgres://… scripts/seed-selection-eybl.sh
```

It is idempotent and never overwrites what the club changed in the app; rerun it
after adding a coach to assign them. Adjust birth years, prices and counts in
Admin → Selection programs → EYBL 2026-27. Requires migration
`20250420102600_selection_programs.sql`. Production data changes need founder
approval (CLAUDE.md §11).

Tests: `tests/db/selection_programs.sql`, `tests/unit/selection-programs.test.ts`,
`src/lib/payments/__tests__/selection.test.ts`.
