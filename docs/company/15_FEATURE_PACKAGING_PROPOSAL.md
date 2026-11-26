# 15 · Feature packaging & upgrades [Proposal][Confirm]

*Status: proposal for founder approval, 21 Nov 2026. Pricing changes need founder approval before use (CLAUDE.md §11). All add-on prices are [Est.] unless they come from `01_BUSINESS_MODEL.md` §4.3.*

## 1. What this is

The app now knows every module it contains, which plan includes it, and what it costs on its own. A club admin sees all modules in **Plan & upgrades** (`/admin/upgrades`) and can switch a purchasable module on (a monthly add-on), start a one-time 14-day trial, or change plan. Modules outside the club's plan are not hidden: the menu shows them with an **Upgrade** badge (the club can choose to hide them instead) and the page shows what the module does, why clubs use it and its price in the club's currency. Coaches and parents never see prices: they get "ask the club admin".

Sources: tiers, caps and the add-ons AI assistant (CHF 69) and custom domain + branded email (CHF 29) come from `01_BUSINESS_MODEL.md` §4.1 and §4.3. The placement of the modules built since (accounting, operations, family features, website, …) is a proposal, with a reason per module below.

## 2. Principles used for the placement

1. **§4.1 "Includes" is binding.** Starter: programmes, registration, payments (QR-bill, card, TWINT), roster, attendance, messaging, parent web app, club branding. Club adds multi-team, coach app, reminders, reports, CSV import. Academy adds multi-location, bookings and player development, advanced roles, custom domain. Multi-site adds group dashboard, SSO / security pack.
2. **Core is never paywalled.** What a club needs to run legally and to get paid (consents for minors, invoicing, QR-bill) is core in every plan and cannot be blocked.
3. **Size follows complexity.** Modules that matter once a club has several teams, paid staff or a treasurer go to Club or Academy.
4. **Every non-core module can also be bought on its own**, so a Starter club is never forced up a whole tier for one need. Add-on prices are set so that buying three or four modules costs about as much as the next tier (Club − Starter = CHF 200; Academy − Club = CHF 400): the upgrade stays the better deal.
5. **Running-cost modules (AI, SMS) are add-ons in every tier** and are not covered by a blanket complimentary grant.
6. **Downgrades never delete data.** A module that turns off is hidden / read-only; its scheduled jobs stop; it comes back when switched on again.

## 3. Packaging table

Legend: ✓ included · add-on = can be bought on this plan · – not available on this plan. Prices: monthly, excl. VAT, CHF / EUR / USD. USD is indicative only (not published before the US gate, §4.1).

| Key | Module | Category | Starter | Club | Academy | Multi-site | Add-on CHF / EUR / USD [Est.] | Requires | Rationale |
|---|---|---|---|---|---|---|---|---|---|
| `programs` | Programs & schedule | core | ✓ | ✓ | ✓ | ✓ | – | – | §4.1 Starter: programmes. The product does not work without it. |
| `registration` | Online registration | core | ✓ | ✓ | ✓ | ✓ | – | – | §4.1 Starter: registration. |
| `invoicing` | Invoicing | core | ✓ | ✓ | ✓ | ✓ | – | – | §4.1 Starter: payments. Every other money module builds on it. |
| `qr_bill` | Swiss QR-bill | core | ✓ | ✓ | ✓ | ✓ | – | – | §4.1 Starter: QR-bill. Our Swiss wedge; QR-bill is free in §4.3. |
| `online_payments` | Card & TWINT payments | core | ✓ | ✓ | ✓ | ✓ | – | – | §4.1 Starter: card, TWINT. Monetised through the payment application fee (§4.3), not a tier. |
| `roster` | Roster: families, athletes, coaches | core | ✓ | ✓ | ✓ | ✓ | – | – | §4.1 Starter: roster. |
| `attendance` | Attendance | core | ✓ | ✓ | ✓ | ✓ | – | – | §4.1 Starter: attendance. |
| `messaging` | Messaging & notifications | core | ✓ | ✓ | ✓ | ✓ | – | – | §4.1 Starter: messaging. |
| `documents_consent` | Documents & consents | core | ✓ | ✓ | ✓ | ✓ | – | – | Not named in §4.1, but guardian consent is a legal duty for minors (nFADP/GDPR, CLAUDE.md §8). Never paywalled. |
| `parent_app` | Parent web app | core | ✓ | ✓ | ✓ | ✓ | – | – | §4.1 Starter: parent app (web). |
| `custom_branding` | Club branding | core | ✓ | ✓ | ✓ | ✓ | – | – | §4.1 Starter: club branding. |
| `web_push` | Web push notifications | core | ✓ | ✓ | ✓ | ✓ | – | – | §4.3: push and email are free; SMS is the paid channel. |
| `multi_club` | One login for several clubs | core | ✓ | ✓ | ✓ | ✓ | – | – | Network effect for families across clubs; charging for it would slow adoption. |
| `camps` | Camps | programs | ✓ | ✓ | ✓ | ✓ | – | – | Starter targets 'single-programme clubs and camp operators' (plan copy): camps must be in the entry tier. |
| `camp_basket` | Camp seasons & multi-week basket | programs | add-on | ✓ | ✓ | ✓ | 29 / 29 / 32 | `camps` | Multi-week booking with season discounts is a revenue lever for camp-heavy clubs; natural Club feature, sold to Starter camp operators. |
| `multi_team` | Multiple teams | programs | add-on | ✓ | ✓ | ✓ | 29 / 29 / 32 | – | §4.1 Club: multi-team. |
| `multi_location` | Multiple locations | programs | add-on | add-on | ✓ | ✓ | 49 / 49 / 54 | `multi_team` | §4.1 Academy: multi-location. Depends on teams. |
| `calendar_ics` | Club calendar & ICS feeds | programs | add-on | ✓ | ✓ | ✓ | 9 / 9 / 10 | – | Convenience for families of multi-team clubs; cheap to deliver, so a low add-on price. |
| `waitlists` | Waiting lists with auto-promotion | programs | add-on | ✓ | ✓ | ✓ | 19 / 19 / 21 | – | Fills every place automatically: matters once programmes sell out (Club size). |
| `shop` | Club shop | programs | add-on | ✓ | ✓ | ✓ | 39 / 39 / 43 | – | New revenue for the club; Club-tier clubs run kit sales. Add-on for Starter. |
| `alerts_leads` | Scheduled alerts & new contacts | communication | add-on | ✓ | ✓ | ✓ | 19 / 19 / 21 | – | Scheduled announcements and website enquiries scale with club size. |
| `media_library` | Media library | communication | add-on | ✓ | ✓ | ✓ | 15 / 15 / 17 | – | Nice-to-have for clubs with a public presence; low price. |
| `sms` | SMS packs | communication | add-on | add-on | add-on | add-on | 25 / 25 / 29 | – | §4.3: pass-through cost + 20% in prepaid packs. Monthly price here is a placeholder pack [Est.]. Not covered by complimentary_all (running cost). |
| `reminders` | Automatic payment reminders | finance | add-on | ✓ | ✓ | ✓ | 19 / 19 / 21 | – | §4.1 Club: reminders. |
| `discounts` | Discounts & promo codes | finance | add-on | ✓ | ✓ | ✓ | 15 / 15 / 17 | – | Sibling / early-bird pricing is common at Club size; small add-on for Starter. |
| `payment_plans` | Payment plans, instalments & autopay | finance | add-on | ✓ | ✓ | ✓ | 39 / 39 / 43 | – | Instalments and autopay reduce bad debt for larger fees: Club tier. Price reflects collection value. |
| `recurring_fees` | Recurring fees | finance | add-on | ✓ | ✓ | ✓ | 25 / 25 / 28 | – | Monthly / termly fees are typical for clubs with season members: Club tier. |
| `finance` | Finance: expenses, payouts, budgets | finance | add-on | ✓ | ✓ | ✓ | 29 / 29 / 32 | – | Expenses and coach payouts: committee reporting need at Club size. |
| `reports_advanced` | Reports | finance | add-on | ✓ | ✓ | ✓ | 29 / 29 / 32 | – | §4.1 Club: reports. |
| `accounting` | Accounting: bank import, exports, period locks, dunning, refunds | finance | add-on | add-on | ✓ | ✓ | 49 / 49 / 54 | `finance` | Treasurer-grade features (bank import, Bexio export, period locks, dunning): Academy and larger. Needs the finance module. |
| `bookings` | Training bookings & packages | training | add-on | add-on | ✓ | ✓ | 79 / 79 / 87 | – | §4.1 Academy: bookings. Highest-value add-on (private coaching revenue): highest add-on price. |
| `player_development` | Player development: assessments, plans, nutrition, rankings, wellness | training | add-on | add-on | ✓ | ✓ | 69 / 69 / 76 | – | §4.1 Academy: player development. |
| `player_journey` | Player journey & scout profile | training | add-on | add-on | ✓ | ✓ | 39 / 39 / 43 | `player_development` | Academy differentiator (scouting, placements). Needs player development. |
| `lesson_plans` | Lesson plans | training | add-on | ✓ | ✓ | ✓ | 15 / 15 / 17 | `coach_app` | Coach tooling; needs the coach app. |
| `coach_app` | Coach app | people | add-on | ✓ | ✓ | ✓ | 39 / 39 / 43 | – | §4.1 Club: coach app. |
| `csv_import` | CSV / Excel import | people | add-on | ✓ | ✓ | ✓ | 19 / 19 / 21 | – | §4.1 Club: CSV import. Premium onboarding (CHF 150/h, §4.3) stays a service, not a toggle. |
| `memberships` | Memberships | people | add-on | ✓ | ✓ | ✓ | 25 / 25 / 28 | – | Membership fees and renewals: Club tier. |
| `member_cards` | NFC / QR member cards | people | add-on | add-on | ✓ | ✓ | 19 / 19 / 21 | `memberships` | NFC/QR check-in is for larger venues: Academy. Needs memberships. |
| `forms` | Custom forms | people | add-on | ✓ | ✓ | ✓ | 19 / 19 / 21 | – | Custom forms (sizes, surveys, medical updates): Club. |
| `contracts` | Contracts & e-signature | people | add-on | add-on | ✓ | ✓ | 29 / 29 / 32 | – | Player / staff contracts with e-signature: academies. |
| `staff_time` | Staff clock-in, schedules & timesheets | people | add-on | add-on | ✓ | ✓ | 39 / 39 / 43 | `coach_app` | Clock-in and timesheets for paid coaches: academies with payroll. Needs the coach app. |
| `advanced_roles` | Advanced roles (finance role, delegated access) | people | add-on | add-on | ✓ | ✓ | 29 / 29 / 32 | – | §4.1 Academy: advanced roles. Gated where the finance role is assigned. |
| `staff_compliance` | Staff compliance & certificates | safety | add-on | ✓ | ✓ | ✓ | 19 / 19 / 21 | – | Child-protection certificates: should not be expensive; Club tier, low add-on price. [Confirm] whether to make it core for safeguarding reasons. |
| `injury_log` | Injury & incident log | safety | add-on | ✓ | ✓ | ✓ | 15 / 15 / 17 | – | Duty-of-care record: Club tier, low price. [Confirm] whether to make it core. |
| `js_export` | J+S export (Switzerland) | safety | add-on | ✓ | ✓ | ✓ | 15 / – / – | – | Swiss Jugend+Sport subsidy export: Club tier, sold in CHF only (Switzerland). |
| `ops_equipment` | Equipment & kit | operations | add-on | add-on | ✓ | ✓ | 19 / 19 / 21 | – | Operations modules serve multi-team academies: Academy; each sold separately. |
| `ops_facilities` | Facilities & closures | operations | add-on | add-on | ✓ | ✓ | 19 / 19 / 21 | – | As above (halls, closures, rentals). |
| `ops_board` | Board & committees | operations | add-on | add-on | ✓ | ✓ | 15 / 15 / 17 | – | As above (committees, minutes). |
| `ops_sponsors` | Sponsors & donations | operations | add-on | add-on | ✓ | ✓ | 25 / 25 / 28 | – | As above (sponsors, donations, ops invoices). |
| `split_billing` | Second guardian split billing | family | add-on | ✓ | ✓ | ✓ | 19 / 19 / 21 | – | Separated parents: frequent at Club size; low price. |
| `carpooling` | Carpooling | family | add-on | ✓ | ✓ | ✓ | 9 / 9 / 10 | – | Family convenience; lowest price point. |
| `website_connect` | Website connection: public API, embeds, WordPress plugin | website | add-on | ✓ | ✓ | ✓ | 29 / 29 / 32 | – | Live programmes on the club's existing site: Club tier. |
| `site_builder` | Built-in club website | website | add-on | add-on | ✓ | ✓ | 39 / 39 / 43 | `website_connect` | Built-in website replaces an agency: Academy; add-on for Club. Needs the website connection. |
| `custom_domain` | Custom domain & branded email sender | website | add-on | add-on | ✓ | ✓ | 29 / 29 / 32 | – | §4.3: CHF 29/month, included in Academy and above. |
| `extra_languages` | More than two languages | website | add-on | add-on | ✓ | ✓ | 19 / 19 / 21 | – | Two languages included (Swiss bilingual norm); three or more from Academy or as add-on. |
| `white_label` | Full white-label | website | – | – | ✓ | ✓ | – | – | Existing Academy plan feature (no platform branding); not sold separately. |
| `ai_assistant` | AI assistant | ai | add-on | add-on | add-on | add-on | 69 / 69 / 79 | – | §4.3: paid add-on in every tier, CHF 69 / EUR 69 / USD 79 [Est.][Confirm]. DLang complimentary (existing grant). Not covered by complimentary_all (inference cost). |
| `api_access` | Admin API access | enterprise | – | – | ✓ | ✓ | – | – | Existing Academy plan feature (admin API); not sold separately. |
| `priority_support` | Priority support | enterprise | add-on | add-on | ✓ | ✓ | 49 / 49 / 54 | – | Existing Academy plan feature; sold to Club as an add-on. |
| `sso` | Single sign-on | enterprise | – | – | – | ✓ | – | – | §4.1 Multi-site: security pack. |
| `federation_rollup` | Group / federation roll-up | enterprise | – | – | – | ✓ | – | – | §4.1 Multi-site: group dashboard. |

Notes:
- **Premium onboarding and migration** (CHF 150/h, §4.3) is a service, not a module toggle; it is not in the catalog.
- **White-label native app** (§4.3, not before 2029) is out of scope.
- **Payments application fee** (0.5% TWINT/card, §4.3) is a take-rate, not a module.
- The built-in club website (`site_builder`, `/admin/site`) is registered and its menu entry is locked/unlocked automatically. Its pages are built in a parallel branch; after the merge, its route group needs the one-line gate `export default featureLayout("site_builder")` in `src/app/(admin)/admin/site/layout.tsx`.

## 4. How it is built (for the record)

- **Catalog** `src/lib/upgrades/catalog.ts` (keys, categories, default tier, add-on prices, dependencies, gated routes), mirrored in SQL (`public.platform_features`, `public.feature_addon_prices`, migration `20250420102100_feature_upgrades.sql`). A unit test fails if the two drift.
- **Plan matrix**: `plans.features` (one boolean per module and plan), seeded once with the table above, then edited by platform admins in `/platform/plans/features`.
- **Per-club entitlements**: `public.org_feature_grants`: `addon` (paid; Stripe item or pending request), `trial` (end date; one self-serve trial per module), `complimentary`, `founding`, `complimentary_all` (feature `*`), `block`. Effective access = core ∪ ((plan ∪ add-ons ∪ trials, while the subscription is live) ∪ complimentary grants) − blocks, then dependencies. One resolver in TypeScript (`src/lib/upgrades/resolve.ts`), mirrored in SQL (`public.org_feature_enabled()`).
- **Writes**: club roles cannot write entitlements (RLS); club admins buy through server actions that check the role and write with the service role; platform admins use audited `platform_*` RPCs; the Stripe Billing webhook mirrors add-on items idempotently. Every change is written to the club's `audit_logs` and the `platform_audit_log`.
- **Enforcement, server-side first**: route-group layouts render the upsell screen; 291 server actions of paid modules refuse (`assertFeature`); export routes and the public website API answer 404; scheduled jobs skip clubs without the module; the menu shows a badge or hides the entry.
- **Billing**: with Stripe Billing configured (test mode outside production), switching a module on adds a prorated item to the club's platform subscription; switching off ends it at period end (daily job `/api/platform/cron/upgrades`). Without online billing, the switch records a request and the club sees "we'll activate it within 1 business day"; the platform team activates it in the tenant page. Upgrades apply at once (prorated), downgrades at period end, with a preview of what would lock.

## 5. Customer zero (DLang) and the demo tenant

- **Choice: data, not code.** DLang receives a `complimentary_all` grant as a data statement in the migration, guarded by its organization id (no-op elsewhere), plus the same row in the seeds. No code path names a club. The founder can give or end the same grant for any tenant in `/platform/tenants/<id>` → Entitlements → "Grant complimentary_all" (RPC `platform_set_feature_grant(org, '*', 'complimentary_all')`), which is audit-logged.
- DLang keeps its existing complimentary AI assistant add-on (AI and SMS are outside `complimentary_all` because they have running costs).
- **FC Seeblick** (demo) stays on the Club plan (trial), so Academy modules (bookings, accounting, operations, contracts, member cards, website builder, …) show the upgrade screens; player development runs a demo trial to show the trial state.

## 6. Open decisions for the founder [Confirm]

1. Approve the placement in §3, in particular: bookings and multi-location move from Club (old seed) to Academy as §4.1 says; staff compliance and the injury log as paid Club modules or core (safeguarding argument).
2. Approve the add-on price grid [Est.] and the rule "3–4 add-ons ≈ next tier".
3. Founding clubs: do they get specific modules complimentary (`founding` grants), and does the August promise of free AI for 24 months stand?
4. SMS: confirm the pack size and price (pass-through + 20%, §4.3) before it is sold; no SMS sending exists yet.
5. One free 14-day trial per module per club: confirm, and whether trials need a card on file.
6. Should finance users see prices (today: yes, they can view but not buy)?
7. Annual subscriptions: add-ons are billed yearly at 12 × monthly; confirm no annual discount on add-ons.
