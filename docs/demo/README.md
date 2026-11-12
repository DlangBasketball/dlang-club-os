# Staging demo: DLANG Sports OS

Status: 12 Nov 2026. **Synthetic data only.** All people, families, addresses, phone numbers and emails in the demo are invented. Emails use the reserved `example.com` domain.

## URLs

| Front door | URL | Tenant shown before sign-in |
|---|---|---|
| DLang (founding club) | https://dlang-staging.vercel.app | DLang Basketball, app name "DLang OS", dark theme |
| Second demo club | https://fc-seeblick-staging.vercel.app | FC Seeblick (fictional), green light theme, German |

Both are Vercel projects (team `dlang1`, region fra1) built from the same commit. They use the same staging Supabase project `dlang-staging` (ref `kuuogjlmvxyrsdhrtyxe`, region eu-central-2 / Zurich). The only difference is `DEFAULT_ORG_SLUG`. A `*.vercel.app` host names no tenant (see `src/lib/tenant/host.ts`), so before sign-in each project shows its default club. After sign-in, users always see their own club, whichever URL they used. Vercel deployment protection is off for both projects, so they open on a phone without a Vercel login.

## Logging in

- The demo accounts are `demo-admin`, `demo-finance`, `demo-coach` and `demo-parent` (DLang), plus `demo-fc-admin` (FC Seeblick), all `@example.com`.
- **Passwords are shared privately with the founder. They are not in this repository.**
- Enter the email and the password on `/login`. Password sign-in only appears because staging sets `NEXT_PUBLIC_AUTH_PASSWORD_LOGIN=true`. Production stays magic-link only, and the env checks reject the flag when `APP_ENV=production`.
- Leaving the password empty sends a magic link. This does not work for demo accounts, because example.com cannot receive mail.
- Phones show a cookie banner on first visit. Tap "Necessary only" to reach the sign-in button.

## What is in the demo data

The data comes from `supabase/seeds/seed_demo.sql`, which is generated, idempotent and synthetic. The older `seed.sql`, `seed_family_module.sql` and `seed_tenants.sql` are not used for staging, because they contain realistic-looking personal data.

**DLang Basketball**
- Founding club. App name "DLang OS". V5 dark-luxury theme: red/gold, Fraunces display font.
- English UI, with FR and DE also enabled.
- Six programmes:
  - Big Ballers U12 (public)
  - Cheetahs U14
  - Unity U16
  - Winter Skills Clinic (public)
  - Easter Camp 2027 (public camp)
  - Summer Camp 2027 Week 1 (public camp)
- Three teams with a two-week schedule of practices and games, including one completed game with a score.
- 8 families and 12 players.
- 10 invoices in CHF: paid, open (pending), overdue and partially paid, with TWINT, QR-bill, bank and card payments.
- Submitted attendance for past practices and an open register for today.
- Private bookings, credits, coach availability and club notifications.
- An active **complimentary AI assistant add-on** row (`ai_assistant_addons`, source `complimentary`), with the club opt-in turned on.

**FC Seeblick** (fictional)
- German-speaking football club in Zurich. Light green theme.
- German UI and German terminology: Junioren, Mannschaften, Trainingsplan.
- Three programmes, including a public Easter football camp. Two teams with a schedule.
- 4 families, 6 juniors and 4 CHF invoices.
- Club plan trial. No AI add-on.

## Screenshots (`screenshots/`)

How they were taken:
- Playwright Chromium at deviceScaleFactor 2.
- "desktop" means a 1440x900 viewport. "phone" means the iPhone 13 descriptor.
- Saved as 256-colour PNGs to keep the repository small.
- They were captured from a production build (`next build && next start`) of the deployed commit, run locally against the **same staging Supabase project**. The sandbox that produced them could not reach `*.vercel.app` through its network proxy. The pages, data and configuration are the same, apart from the host name.

| File | Shows |
|---|---|
| `01-dlang-login-{desktop,phone}` | DLang sign-in: DLang OS branding, demo password field |
| `02-dlang-admin-dashboard-{desktop,phone}` | Admin dashboard: KPIs, open/overdue CHF totals, today's attendance, upcoming sessions, registrations, payments |
| `03-dlang-admin-programmes-desktop` | Programmes list (teams, clinic, camps) |
| `04-dlang-admin-families-desktop` | Families |
| `05-dlang-admin-athletes-desktop` | Players (club terminology for athletes) |
| `06-dlang-admin-invoices-{desktop,phone}` | Invoices: paid / pending / overdue / partially paid in CHF |
| `07-dlang-admin-schedule-desktop` | Team schedule (practices and games) |
| `08-dlang-admin-teams-desktop` | Teams for season 2026-27 |
| `09-dlang-admin-attendance-desktop` | Attendance sessions |
| `10-dlang-finance-payments-desktop` | Finance user: payments ledger |
| `11-dlang-register-easter-camp-{desktop,phone}` | Public registration page for Easter Camp 2027 (signed out) |
| `12-dlang-settings-branding-desktop` | Settings: branding and venues (theme colours, fonts) |
| `13-dlang-settings-app-assistant-desktop` | Settings: app name "DLang OS"; AI assistant shows "complimentary add-on" and "not available on this platform yet" (no AI key on staging) |
| `14-dlang-admin-assistant-desktop` | Assistant page (unavailable state without an AI key) |
| `15-dlang-coach-home-{phone,desktop}` | Coach home |
| `16-dlang-coach-attendance-{phone,desktop}` | Coach attendance: submitted and open registers |
| `17-dlang-coach-schedule-{phone,desktop}` | Coach schedule |
| `18-dlang-parent-home-{phone,desktop}` | Parent home (Martin family: two children, balance due) |
| `19-dlang-parent-invoice-overdue-{phone,desktop}` | Parent view of an overdue invoice: QR reference, TWINT/bank instructions, QR-bill download |
| `20-fc-seeblick-login-{desktop,phone}` | FC Seeblick sign-in in German, green theme |
| `21-fc-seeblick-admin-dashboard-{desktop,phone}` | FC Seeblick admin dashboard |
| `22-fc-seeblick-admin-programmes-desktop` | "Mannschaften" (programmes) |
| `23-fc-seeblick-admin-invoices-desktop` | FC Seeblick invoices (CHF) |
| `24-fc-seeblick-admin-schedule-desktop` | Trainingsplan (schedule) |
| `25-fc-seeblick-settings-app-assistant-desktop` | App & assistant settings in German: AI shown as a paid add-on the club does not have |

## Known gaps visible in the demo

- **No email:** Resend is not configured, and Supabase's built-in mailer only delivers to project team members, so magic links and invitations do not reach demo accounts.
- **No payments:** Stripe is not configured, so card and TWINT online payment buttons are not offered. QR-bill, TWINT-number and bank instructions are shown. The QR-IBAN is the published SIX sample account.
- **No AI answers:** no AI key or model is set, so the assistant is shown as unavailable even though DLang holds the complimentary add-on.
- **Incomplete German UI:** parts of the dashboard body ("Welcome back", "Quick actions", KPI labels) and the cookie banner are still English in the German UI. These strings are hard-coded in the app (an i18n gap, not demo data).

## Rebuilding the demo data

1. Apply `supabase/migrations/*` in order.
2. Create the five demo users with the Auth admin API, with `email_confirm: true`.
3. Run `supabase/seeds/seed_demo.sql`.

Part B of the seed links the users to their clubs and roles by email. It is a no-op if the users do not exist. Never run it against production.
