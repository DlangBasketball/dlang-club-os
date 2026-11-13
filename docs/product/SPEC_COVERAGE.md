# DLang OS: coverage of the founder's reference spec

Reference: `docs/product/reference-spec-sports-app.txt`, the founder's product spec saved under the DLang OS name. Status as of 13 Nov 2026, on branch `claude/ultracode-kfui6x` and the staging demo `https://dlang-staging.vercel.app`.

Legend: **Built** = in the app and tested · **Partial** = core built, with gaps noted · **Planned** = listed for later.

## Key elements (1–15)

| # | Spec element | Status | Where in DLang OS |
|---|---|---|---|
| 1 | General management & reporting | Built | Admin dashboard (KPIs and charts), Reports, Finance → Reports |
| 2 | Booking & scheduling | Built | Schedule, Calendar, Training bookings, Coach availability, public `/book` |
| 3 | Financial management | Built | Invoices, Payments, Credit notes, Finance hub (balances, transactions, expenses), Coach pay |
| 4 | Camps, sessions & trainings | Built | Programmes → Camps (weeks, price options, age groups), Training services and packages |
| 5 | Customer (athlete) management | Built | Players, Families, photos, medical, consents, documents, member or guest status |
| 6 | Workout & exercise management | Built | Development → Exercise library (videos), Training plans, auto-assign by age and level |
| 7 | E-commerce (shop, event booking, online payments) | Built | `/shop` with stock, public camp registration, training booking, Stripe card/TWINT and QR-bill |
| 8 | Communication management | Built | Messages, Alerts, New contacts, email notices, WhatsApp share links |
| 9 | Activity & fitness tracking | Partial | Evaluations and measurements, wellness check-in, attendance. Wearables and heart rate are planned |
| 10 | Custom design & branding | Built | Per-club name, logo, colours, fonts, language, currency, terminology |
| 11 | Employee clock-in | Built | Coach app Clock in/out, Timesheets, Staff schedules, optional location check |
| 12 | Client roll call | Built | Attendance, roll-call history, QR member cards and NFC bracelets (Android) |
| 13 | Client interactive emoji | Built | Progress emoji and level, rank band shown to the family only (no public list of children) |
| 14 | Online shop integrated into the website | Built | Public `/shop` on the club page; members and guests can order |
| 15 | One integrated admin (app + shop + website) | Built | One admin for the installable app, public club page, shop, camps and booking |

## Manager access

| Spec | Status | Where |
|---|---|---|
| Interactive dashboard and task menu | Built | Admin dashboard and navigation; global search (Ctrl/Cmd+K) |
| Rankings of students and employees | Built | Development → Rankings (players by team or programme; coach ranking for admins) |
| Menu: calendar, students, parents, finance, contracts, enrolment, plans, messages, notifications | Built | All present in the admin navigation |
| Finances: balances, transactions, payments, invoices, expenses (trainer, category, supplier, amount, description) | Built | Finance hub, Expenses with category, supplier, trainer and receipt |
| Clients: list/search, assessments, measurements history (yearly/monthly), evaluations | Built | Players, Development → Assessments, Evaluate, athlete history charts |
| Workout planner (sport- and age-specific; strength & conditioning) | Built | Development → Plans (templates by sport, age and level) |
| Nutrition planner (client- and age-specific) | Built | Development → Nutrition |
| Programs (by academy, location, yearly, camp, international, online) | Partial | Programmes (team, camp, clinic) with locations and sports. "International" and "online" are programme types still to add |
| Main calendar of all events, classes, camps, employee assignments, international events | Built | Calendar (all types, filters, ICS subscription) |
| General reports: clients, services, finances, attendance, clock-in, classes | Built | Reports, Timesheets, Attendance, Finance reports |
| Financial reports: payments recorded, reconciled and projected earnings, expenses, profit | Built | Finance → Reports |
| Notifications from parents, employees and new contacts | Built | Notifications plus Messages plus New contacts |

## Links / system configuration

| Spec | Status | Where |
|---|---|---|
| 1. Editable registration form; migrate data from Excel | Built | Programme → Registration form; Import (CSV and .xlsx) |
| 2. Editable contracts auto-filled from registration | Built | Contracts (templates with merge fields, e-acceptance, signed PDF) |
| 3. Forms editor (physicals, waivers…) | Built | Forms (builder, versions, signatures, renewal, reminders, PDF) |
| 4.1–4.2 Search students and parents | Built | Global search; Players and Families lists |
| 4.3 Sports | Built | Sports |
| 4.4 Locations | Built | Locations |
| 4.5–4.8 Events, classes, schedules, calendar | Built | Schedule, Teams, Programmes, Calendar, club events |
| 4.9 Alerts | Built | Alerts |
| 4.10 Roll call | Built | Attendance (plus QR and NFC) |
| 4.12 Messages | Built | Messages |
| 4.13 Employees | Built | Coaches, Invitations, staff roles |
| 4.14 Financial (prices, packages) | Built | Price options, training packages, discounts, plans |
| 4.15 Notifications | Built | Notifications, templates, preferences |
| 4.16 Clock-in schedules | Built | Staff schedules |

## Cloud manager core features (1–18)

| # | Feature | Status |
|---|---|---|
| 1 | Team management & monitoring | Built |
| 2 | Role hierarchy and permissions | Built: admin, finance, coach, parent, with database row-level security |
| 3 | Camps, training and workout sessions; booking; attendance | Built |
| 4 | Creation of sessions, events and training | Built |
| 5 | Workout plans by age, skill level and rating, auto-assigned | Built |
| 6 | Reports per session: performance, attendance, skill improvement, feedback | Partial: evaluations, attendance and plan feedback are built; a combined per-session report is planned |
| 7–12 | (not listed in the spec) | — |
| 13 | Online payment of camps, workouts and trainings | Built (Stripe card/TWINT once keys are set; QR-bill now) |
| 14 | Reporting (summary, daily schedule, sessions, client list, attendance, earnings) | Built |
| 15 | Finance management (balances, transactions, invoices, payments, expenses) | Built |
| 16 | Product inventory, workout videos, documents | Built |
| 17 | Communication (in-app messages, alerts, notifications, email) | Built |
| 18 | Automated data collection, visualisation and reporting of athletes | Built: evaluation and wellness charts, rankings |

## Customer (parent / athlete) access

| Spec | Status | Where |
|---|---|---|
| Login and password | Built | Password or email link; guests can sign up when they book |
| Panel: schedule, classes, contracts, events, message board, evaluation history | Built | Parent app: Home, Schedule, Calendar, Contracts, Messages, My training |
| Messages to teachers and managers with contact details kept private | Built | Messages (no emails or phone numbers shown) |
| Personal emoji improving with rank | Built | My training: level emoji and rank band |
| Training plan, roll-call history, notifications, online store | Built | My training, attendance on the child page, Notifications, Shop |
| Bracelet with RFID/NFC chip | Partial | NFC (Android Chrome) and QR member cards; iPhone cannot read NFC from the browser, so QR is used there |

## Employee access

| Spec | Status | Where |
|---|---|---|
| Login, clock-in | Built | Coach app: Clock |
| Panel: schedule, roll calls, lesson plans sent to parents, evaluations planner | Built | Coach home, Roll calls, Lesson plans (shared with parents), Development |
| Messages to clients with contact details kept private | Built | Messages |
| Assessment forms with sport-specific items | Built | Development → Assessments |
| Training planner shown on manager and client dashboards | Built | Development → Plans, and My training for parents |

## Athletes: future features listed in the spec

| Feature | Status |
|---|---|
| Athlete schedule, training workflows, exercise videos, feedback, document viewer, home assignments | Built |
| Scholarship progress reporting | Planned |
| One-rep-max calculator, result- and percentage-based testing reports | Planned (measurements already store results) |
| Wellness monitoring and daily questionnaire | Built (team opt-in) |
| AI-based training | Partial: the AI assistant is a paid add-on for admins; AI training plans are planned |
| Heart rate, hydration, weight, load monitoring, external devices | Planned (needs device integrations) |

## Platform goals

| Goal | Status |
|---|---|
| Web access with the club's own brand and domain | Built (custom domains need DNS set-up per club) |
| Publishing on iOS and Android | Partial: installable app (PWA) now; App Store / Google Play builds are planned |
| Installments and recurring card payments | Partial: Stripe one-off payments are built; installments and autopay are planned |
| Payroll and receivables/payables reports | Partial: coach pay and receivables are built; full payroll (social charges) is out of scope; use a payroll provider |

## Still to do (consolidated)

1. App Store / Google Play builds (wrap the existing app).
2. Installments and recurring card payments (Stripe Billing).
3. "International" and "online" programme types.
4. A combined per-session performance report.
5. Scholarship progress tracking; one-rep-max and testing reports.
6. Wearables and device integrations (heart rate, weight, load).
7. WhatsApp Business API (share links work today).
8. Shop confirmation emails; rate limits on promo codes and checkout.
9. Turn on email (Resend plus the club domain) and Stripe keys for live payments and messages.
