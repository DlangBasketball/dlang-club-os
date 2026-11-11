# DLang Basketball — Authentication (Supabase Auth)

Covers magic-link/OTP login, admin/coach/parent roles, RBAC + org/family/coach
scoping, role redirects, logout, protected routes, and the **admin-invites-a-parent
onboarding flow**. Validated end-to-end: the SQL ran against live Postgres (all
assertions pass) and the app type-checks and builds against Next 15 / React 19 /
Supabase 2.106.

## 1. Supabase setup steps

1. **Create the project**, then apply the migrations in `supabase/migrations/`
   (in filename order) and `supabase/seed.sql`. Migration `…090300` adds the
   `invitations` table, the `profiles.onboarding_completed_at` flag, and the
   invitation-aware `handle_new_user` trigger.
2. **Auth → Providers → Email**: enable Email. Turn on "Email OTP / Magic Link".
   Decide on "Confirm email" (on for production).
3. **Auth → URL Configuration**:
   - Site URL → your app origin (e.g. `https://app.dlangbasketball.ch`).
   - Redirect Allowlist → add `…/auth/callback` and `…/auth/callback?next=/onboarding`.
4. **Auth → Email Templates**: point the **Invite** and **Magic Link** templates
   at `{{ .SiteURL }}/auth/callback?next=/onboarding` (invite) and
   `{{ .ConfirmationURL }}` / `{{ .SiteURL }}/auth/callback` (magic link). The
   callback route accepts both `?code=` (PKCE) and `?token_hash=&type=` (OTP/invite).
5. **SMTP**: configure a real sender (e.g. Resend) under Auth → SMTP so invites
   and magic links actually deliver.
6. **Environment** (`.env.local`): `NEXT_PUBLIC_SUPABASE_URL`,
   `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (server-only),
   `NEXT_PUBLIC_SITE_URL`. The service-role key powers `inviteUserByEmail` and
   must never reach the browser.
7. **Generate types**: `npm run types` to replace the placeholder
   `src/types/database.ts` with the authoritative generated types.

## 2. Architecture — three layers of access control

1. **Middleware** (`middleware.ts`): refreshes the session every request and
   redirects signed-out users away from protected paths to `/login`.
2. **Server route guards** (`requireRole`, `requireAuth` in `lib/auth/get-user.ts`),
   called in each group layout: keeps each role in its own area and gates
   un-onboarded parents into `/onboarding`.
3. **Postgres RLS**: the real boundary. Parents see only their family
   (`family_members`), coaches only assigned athletes/sessions
   (`coach_can_access_athlete`), admins everything in their org, finance billing
   but not medical. The `service_role` key is the only RLS bypass (server jobs,
   Stripe webhook, invite linking).

## 3. Role redirect logic

`postLoginDestination(user)` (in `get-user.ts`) is the single source of truth,
used by the auth callback and the root page:

- parent **and** onboarding incomplete → `/onboarding`
- else by highest role: admin/finance → `/admin/dashboard`, coach →
  `/coach/schedule`, parent → `/parent/home` (see `homeForRoles` in `roles.ts`).

## 4. Invite → onboarding flow (new)

1. Admin opens **/admin/invitations**, enters an email + role (+ family for a
   parent) → `inviteUser` server action records an `invitations` row (admin-only
   via RLS) and calls `auth.admin.inviteUserByEmail` (service role).
2. The parent clicks the email link → `/auth/callback` establishes the session →
   `/onboarding`.
3. On that first sign-in the **`handle_new_user` trigger** consumes the matching
   pending invitation: creates the profile, links the guardian to their family
   (and/or assigns a staff role / links a coach record), and marks the invite
   `accepted` — atomically, bypassing RLS.
4. The parent confirms their details and accepts required consents
   (`completeOnboarding`), which stamps `onboarding_completed_at` and writes
   `consent_acceptances` for each child. They land on `/parent/home`.
5. Logout: `POST /auth/signout`.

## 5. Test cases

### Automated (executed against live Postgres — `supabase/tests/auth_tests.sql`)

All five pass:

1. **Invite consumption** — after the invited users are created, the parent is
   linked as primary guardian of their family, the coach gets a `coach` role and
   their coach record linked, and both invitations flip to `accepted`. A parent
   gets **no** `staff_roles` row.
2. **Parent isolation** — the invited parent sees only their 2 children, only
   their family's 1 invoice, only their child's medical row, only their own
   invitation; never the other family's data or invites.
3. **Coach access** — the invited coach can read the athlete in the program he
   was assigned.
4. **Onboarding completion** — the parent can self-update
   `onboarding_completed_at` under RLS.
5. **Negative** — a parent attempting to create an invitation is denied by RLS.

Run: `psql "$DB" -f supabase/tests/auth_tests.sql` (clean run = all pass).

### Manual / E2E matrix (Playwright/Vitest)

| # | Scenario | Expected |
|---|----------|----------|
| A | Magic-link login (known parent) | email → callback → `/parent/home` |
| B | Login while signed in, hit `/login` | redirected to role home |
| C | Signed-out user opens `/admin/families` | redirected to `/login?redirect=…` |
| D | Coach opens `/admin/dashboard` | redirected to `/coach/schedule` |
| E | Admin invites parent → parent accepts | lands on `/onboarding`, then `/parent/home` |
| F | Un-onboarded parent opens `/parent/invoices` | bounced to `/onboarding` |
| G | Parent invites a user (forged request) | server action rejects (not admin) |
| H | Logout | session cleared → `/login` |

Example (Playwright):

```ts
test("signed-out user is sent to login", async ({ page }) => {
  await page.goto("/admin/families");
  await expect(page).toHaveURL(/\/login\?redirect=/);
});

test("coach cannot reach admin", async ({ page }) => {
  await loginAs(page, "derrick@dlang.test");      // coach
  await page.goto("/admin/dashboard");
  await expect(page).toHaveURL(/\/coach\/schedule/);
});
```
