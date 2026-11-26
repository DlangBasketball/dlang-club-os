# Prospect demo sandboxes (`/demo`)

Status 26 Nov 2026. Branch `claude/prospect-demo-sandbox`. **Implemented and tested locally. Not deployed to staging** (see §6).

A prospect opens `/demo`, picks one of five roles and lands in the app as that person, inside **their own fictional club**. They can switch roles at any time; every role works on the same records, so the handoff shows: Jamie (parent) registers Alex, the club admin approves Alex, Coach Taylor sees the same athlete on the U14 Falcons roster.

## 1. How it works

| Piece | Where | What |
|---|---|---|
| Sandbox = one club | `supabase/migrations/20250420107000_demo_sandbox.sql` | `demo_sandbox_create()` seeds a new `organizations` row (flagged `demo_sandbox_id`) with the scenario and links five fresh logins (admin, finance, coach, parent, athlete). Isolation is the normal tenant model: RLS, `current_org_id()`, role helpers and RPC checks. No per-tenant code path. |
| Prospect identity | `src/lib/demo/sandbox.ts` | A random 256-bit token in the httpOnly cookie `clubos_demo` (24 h); the database stores only its SHA-256 (`demo_sandboxes.token_hash`). |
| Role sessions | `POST /demo/enter` | Creates the sandbox on first use (five users via the Auth admin API, reserved `@demo.example.com` addresses, random unused passwords), then generates a one-time magic-link token server-side and verifies it at once: the browser gets a normal Supabase session. **No e-mail is sent; no password or link ever appears in code, the page or the video.** |
| Reset | `POST /demo/reset` → `demo_sandbox_reset()` | Seeds a fresh club for the same five logins and detaches the old club (no member can reach it). Only the caller's sandbox changes. |
| Expiry | `demo_sandbox_expire()` | Runs before each new sandbox: expired sandboxes lose their roles and their auth users are deleted (best effort). |
| Rate limit | `DEMO_MAX_SANDBOXES_PER_HOUR` (default 30) | Across all prospects. |
| Guards | `src/lib/demo/config.ts`, env check | `/demo*` is 404 unless `DEMO_SANDBOX_ENABLED=true` and the deployment is not production. The env check rejects the flag in production and rejects a live Stripe key while it is on. POST routes require a same-origin `Origin` header. `/demo` is a reserved site path (TS + `site_path_reserved()`). |
| Outbound off | `src/lib/email/resend.ts`, `src/lib/push/send.ts`, `src/lib/stripe.ts`, `src/lib/platform/billing.ts` | E-mail to `@demo.example.com` is dropped before the provider (even with `EMAIL_TEST_REDIRECT`). Push is skipped for demo clubs. No Stripe client for a live key while demo is enabled. There is no SMS sender in the app. In-app notifications still appear (they are part of the demo). |
| UI | `src/app/demo/page.tsx`, `src/components/demo/demo-bar.tsx` | Prospect page (EN/FR/DE/IT): five role cards with "Start here", reset, safety notes, plan comparison from `public.plans`, "Book a walkthrough" (`DEMO_WALKTHROUGH_URL`, flagged on the page when missing). A "Demo · Switch role" pill on every page of a demo browser. |

### Scenario (seeded per sandbox, all fictional)

- Club "DLang Demo Club", dark DLang theme, CHF, English (FR/DE enabled), every module unlocked (complimentary grant, Academy trial without billing).
- **U14 Falcons** (head coach **Coach Taylor** = coach login) and **U12 Comets** (Coach Rivera, no login), each with team-mates.
- **Jamie Morgan** (parent login), guardian of **Alex Morgan** (athlete login; no request, no roster place) and **Sam Morgan** (active U12 Comets member).
- U14 Falcons practice **today 17:30** (club time), another in two days; U12 practices tomorrow and in three days.
- **Skills Camp** (one published 5-day edition about eight weeks out, CHF 390 / 250) and a **5-session package** of Skills Training (CHF 300).
- Invoices: Sam's U12 season fee CHF 450, paid by sandbox TWINT; Sam's 5-session package CHF 300, open; **Casey Brooks** (external camp customer, child Riley) CHF 390 camp invoice, paid by sandbox card. Each sandbox payment carries its invoice's QR reference and the note "Sandbox … no money moved".
- "Draft registration" for Alex is represented as *not yet submitted*: the app has no draft state for club requests; the parent submits it from Club programmes.
- U14 Falcons and U12 Comets are free programmes (the season fee is invoiced separately), so an approved request is confirmed at once and joins the roster. With a programme price, Alex would join the roster only after the invoice is paid (existing club-approval rule).

## 2. Configuration (staging only)

```
DEMO_SANDBOX_ENABLED=true
DEMO_WALKTHROUGH_URL=https://…            # approved booking link (https)
DEMO_MAX_SANDBOXES_PER_HOUR=30           # optional
NEXT_PUBLIC_PLATFORM_NAME=DLang Sports OS   # page headline uses the platform name
APP_ENV=staging
```
Stripe on staging must be unset or a `sk_test_` key.

## 3. Deploy to staging

1. Apply `20250420107000_demo_sandbox.sql` to the staging Supabase project `dlang-staging` (no other migration is pending on this branch).
2. Set the env vars above on the Vercel project `dlang-staging` and deploy the branch (or merge into the staging branch).
3. Open `https://dlang-staging.vercel.app/demo` and run §4.

## 4. Verification

### 4a. Done in the build sandbox (26 Nov 2026)

| # | Check | How | Result |
|---|---|---|---|
| 1 | Jamie switches Alex ↔ Sam, submits Alex's registration | `tests/db/demo_sandbox.sql` B: `my_athletes()`, `my_athlete_resolve()`, `club_request_submit()` as Jamie's login | PASS |
| 2 | Admin approves; Coach Taylor sees Alex with the **same athlete id** | C: `club_request_queue()`, `club_request_decide()` as admin; `team_roster_on()` as Coach Taylor; no duplicate athlete | PASS |
| 3 | Coach Taylor marks Alex present; Alex sees it | D: `attendance_open/save/mark_all_present/finalize()` as coach; `player_attendance_overview()`, `player_me()` as Alex | PASS |
| 4 | Jamie books a programme; Finance follows invoice + sandbox payment | E: `register_camp()` with the payload `submitCampParent()` sends; invoice, registration→invoice link and sandbox payments read as Finance under RLS; Casey's paid invoice | PASS |
| 5 | Second prospect sees the original state; reset of the first leaves the second untouched | F | PASS |
| 6 | Coach only own team; parent only own children; athlete only own record; demo roles reach no real club (and vice versa); `demo_sandboxes` and demo RPCs closed to API users | G + `tests/db/rpc_tenant_isolation.sql` | PASS |
| – | Expiry detaches roles; an expired sandbox cannot be reset | H | PASS |
| – | Full DB suite (70 suites, 5,932 assertions, incl. the new 71-assertion suite), unit tests (94 files, 1,584 tests), payments tests, i18n strict, lint, `tsc --noEmit`, `next build` | local Postgres 16 / Node | PASS (build run with an offline Google-Fonts stand-in: the sandbox cannot reach fonts.googleapis.com) |
| – | `/demo` renders (desktop + phone); 403 without same-origin; unknown role → error; no backend → "could not be opened"; 404 with `APP_ENV=production` | `next start` locally with placeholder Supabase | PASS |

The DB checks call the same RPCs and RLS the screens call, as the real role logins. They do not click through the screens.

### 4b. Still to run on staging (not done: staging unreachable from the sandbox)

`DEMO_E2E=1 E2E_BASE_URL=https://dlang-staging.vercel.app npx playwright test e2e/demo --project=chromium-desktop` clicks steps 1–5 through the real screens and records the video footage. It has never run; expect to adjust a selector or two on the first run. Then check by hand: the plan table shows four plans, the walkthrough button opens the approved URL, and a second browser (second prospect) is unaffected by a reset in the first.

## 5. Sales video

See `video/VIDEO_HANDOFF.md`: shot list, timed voiceover and headlines for the 72 s landscape and 30 s vertical cuts, EN/FR SRT captions, thumbnail. Footage must be recorded on staging after §4b.

## 6. Launch dependencies and open points

1. **Staging deployment** — needs someone with access to the `dlang-staging` Supabase project (apply the migration) and the Vercel team `dlang1` (env vars + deploy). Neither was available to the build sandbox.
2. **Approved "Book a walkthrough" URL** — not provided. The page shows a visible warning until `DEMO_WALKTHROUGH_URL` is set. Must be set before external release.
3. **UI journey + footage** — §4b and the video are blocked on 1.
4. **Membership card** — not part of the demo (no membership type seeded, not verified). Left out of the video.
5. **Public address** — the buyer walkthrough points at the staging URL; decide the external address (e.g. a `demo.` subdomain) before release.
6. **Plan names** — taken from `public.plans` codes, labels translated on the page ("Multi-site & Federation"). Prices deliberately not shown (founder decision pending in the pricing docs).
7. **Old demo clubs** — a reset or expiry detaches the old club but keeps its rows (payments are append-only by design). They are tiny; purge occasionally with a platform job if needed.
8. **Bot traffic** — the hourly cap limits creation; add CAPTCHA/turnstile in front of `/demo/enter` if the page is linked publicly at scale.
9. **Claims** — the page and video make no time-saved or revenue claims; add one only with measured pilot evidence.
