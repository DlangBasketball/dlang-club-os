# Billing foundation (phase 1) — contract

Migration: `supabase/migrations/20250420103500_billing_foundation.sql` (one file, additive, idempotent).
Tests: `tests/db/billing_foundation.sql` (`DB_TEST_PREFIX=bf scripts/db-test.sh`), `tests/unit/membership-schedule.test.ts`,
`tests/unit/billing-foundation.test.ts`. Server layer: `src/lib/actions/billing.ts`, `src/lib/data/billing.ts`,
`src/lib/billing/activities.ts`, `src/lib/membership/schedule.ts`.

## 1. Rules

- **One invoice = one revenue category + one issuing entity.** `invoices.activity` (text + check):
  `club_membership` (Club Membership), `selection` (label = the programme `series`, e.g. "EYBL"), `training`
  (Private Training: packages **and** paid bookings), `shop`, `camp`, and `other` — **legacy only**: never selectable
  for a new invoice (`OTHER_NOT_ALLOWED`), every `other` invoice gets a `CATEGORY_AMBIGUOUS` row in `data_review_flags`.
- A given category must agree with the linked programme / registration / membership (`ACTIVITY_MISMATCH`);
  cross-category charges are separate invoices. A membership invoice is always `club_membership`.
- Category, number, issuing entity and `source_label` are **locked after issue** (`ACTIVITY_LOCKED`, `NUMBER_LOCKED`,
  `BILLING_ENTITY_LOCKED`). On a draft only an admin may change the entity.
- Split / child invoices (`split_from_invoice_id`) inherit category, membership, programme, entity and source label.
  Instalments live on their invoice (same category/entity/number). Credit/debit notes (`invoice_adjustments`) live on the
  original invoice and report under its category. There is no separate credit-note invoice type.
- Money never crosses categories: a payment belongs to one invoice; family credit is scoped to a category
  (`family_credit_entries.activity`, null = unassigned legacy credit); a receipt books one payment per invoice.

### How the category is set (`activity_source`)
| source | meaning |
|---|---|
| `migration_rule` / `migration_default` | backfill (see §6) |
| `set` | given explicitly (manual invoice, membership functions, admin reclassification) |
| `derived` | insert trigger: split parent → membership → registration (camp edition / programme kind) → programme kind (`selection`, `camp`) → imported club-fee text (see §6) |
| `default` | no rule: `other` + review flag |
| `linked` | a record linked in the creation transaction classified it (training booking/package → `training`, shop order → `shop`, legacy membership → `club_membership`, selection application → `selection`, camp registration → `camp`); the flag is resolved automatically |

## 2. Invoice numbers

`invoice_number_series (org_id, category, prefix, is_active)` — unique per org+category, admin-managed (Settings →
Billing entities). Format `<prefix>-<YYYY>-<NNNN>` (spaces allowed in the prefix, e.g. `DL CLUB-2026-0001`); YYYY = issue
year in `organizations.timezone` (fallback Europe/Zurich); one counter per org+prefix+year in `invoice_number_counters`
(upsert with row lock → concurrent issues serialise, no collisions; an existing number is skipped). `unique (org_id, number)`
stays.

- A category **with** a series: a draft carries `DRAFT-<id>`; the final number is assigned on transition to an issued
  status (or at insert when inserted issued). The payment reference (QRR/SCOR) is recomputed from the final number at that
  moment. A creation path that links its source record after inserting the invoice (shop, training, camp basket) gets the
  category's number in the same transaction.
- A category **without** a series keeps today's behaviour (the `app_settings.invoice_pattern` number given at insert).
- Issued numbers, payment references and therefore PDFs of existing invoices never change. No prefix is hard-coded:
  the founder's prefixes are data.

All invoice creation paths go through the invoice triggers, so all of them are covered: `create_manual_invoice`
(category required, `CATEGORY_REQUIRED`), `membership_issue`, `membership_carry_forward`, `membership_create` (legacy
typed memberships), `selection_issue_invoice` (both overloads), `book_training`, `book_training_session`,
`training_create_purchase`, `shop_place_order`, `register_camp`, `register_camp_basket`, `register_public`,
`waitlist_respond`, `recurring_generate` (recurring plan periods), `split_family_invoice`, kit deposits
(`operations-equipment.ts` → `create_manual_invoice` with `shop`). No TypeScript path inserts invoices directly.

## 3. Tables

| table | purpose | RLS |
|---|---|---|
| `billing_entities` | issuing entity: name, legal_name, street, building_number, address_extra, postal_code, city, country, vat_number, iban, qr_iban, email, phone, is_default (one per org), is_active | admin all verbs; finance read; delete only when unused |
| `billing_entity_routes` | `(org_id, activity) → billing_entity_id` | admin all; finance read |
| `invoice_number_series` | category prefix | admin all; finance read |
| `invoice_number_counters` | `(org_id, prefix, year) → last_value` | finance read; writes only via functions |
| `payment_receipts` | one received transfer: family_id?, payer_name, amount, currency, received_on, method, reference, note, bank_entry_id?, request_id (unique per org), status `open/partially_allocated/allocated/void` | finance read; writes only via RPCs |
| `membership_payers` | payer of a membership: payer_kind `guardian/family/sponsor/other`, payer_profile_id, family_id, payer_name/email, share_kind `fixed/percent`, share_value, amount, invoice_id | finance read; a payer reads own row; family guardians read a `family` share; writes only via RPCs |
| `data_review_flags` | entity_table, entity_id, reason_code, details, original_reference, resolved_at/by, resolution_note | admin/finance read + resolve; no client insert/delete |

New columns: `invoices` (`activity`, `activity_source`, `billing_entity_id`, `billing_entity_snapshot`,
`billing_entity_source`, `membership_id`, `charge_kind` `season_fee/carry_forward/adjustment`, `request_id`, `payer_kind`,
`payer_name`, `source_label`), `payments` (`receipt_id`, `request_id`, `installment_id`), `family_credit_entries.activity`,
`bank_entries.receipt_id`, `memberships` (`season_id`, `kind`='season_fee', `agreed_fee`, `installment_count`,
`first_due_month`, `due_day`, `sponsored`, `sponsored_notes`, `request_id`, `source`; `membership_type_id` is now
nullable for season fees; one live season fee per athlete+season), `app_settings` (`club_season_start_month` 8,
`club_installment_count` 11, `club_installment_due_day` 28, `club_first_installment_month` null = start month).
All new tables: `org_id` + index, RLS forced, restrictive tenant-isolation policy, `updated_at`, audit trigger (IBANs and
the invoice entity snapshot are redacted in `audit_logs`).

**Payer visibility** (`invoices_select`): a guardian sees an issued invoice of their family when they are its payer
(`payer_profile_id = auth.uid()`), or it has no individual payer and is not a sponsor/other share. Instalment plans
follow their invoice. Sponsors have no login.

## 4. RPCs (all re-check role and org; errors are `P0001` codes)

| RPC | who | returns |
|---|---|---|
| `receipt_record(payload)` — `{request_id*, amount*, currency?, received_on?, method, family_id?, payer_name?, reference?, note?, bank_entry_id?, allocations:[{invoice_id, amount, installment_id?}]}` | finance | receipt summary `{receipt_id, status, amount, allocated, unallocated, allocations[], replayed}`; each allocation is an ordinary payment via `record_offline_payment` |
| `receipt_allocate(receipt, allocations, request_id?)` | finance | summary (`replayed` on retry) |
| `receipt_void(receipt, reason)` | finance | only without allocations |
| `receipt_unallocated()` | finance | rows with money left |
| Reversal of an allocation | finance | existing `void_payment` (the reversal row keeps the receipt link → money unallocated again); `edit_manual_payment` refuses receipt payments |
| `membership_preview(payload)` — `{athlete_id, season_id, agreed_fee, currency?, installment_count?, first_due_month?, due_day?, payers:[{kind, profile_id?, family_id?, name?, email?, share_kind, share_value}], sponsored?}` | finance | payer amounts + schedules, `months_without_installment`, `existing_membership_id`; writes nothing |
| `membership_issue(payload + request_id, description?, sponsored_notes?)` | admin | membership + one invoice (+ plan if ≥ 2 instalments) per payer, one transaction; replay returns the original |
| `membership_carry_forward(from, to, amount, reason, request_id?)` | admin | separate `club_membership` invoice, `charge_kind='carry_forward'`, never in season-fee totals |
| `membership_summary(membership)` | RLS | season-fee vs carry-forward money |
| `club_installment_schedule(total, count, first_due_month, due_day, season_end, currency)` | any | `(seq, due_on, amount)`; minor units; remainder one unit at a time to the **first** instalments; refuses `SCHEDULE_AFTER_SEASON_END` |
| `club_season_months_without_installment(first, count, season_start, season_end)` | any | months |
| `club_billing_settings()` / `club_billing_settings_set(payload)` | staff / admin | defaults |
| `club_season_bounds(on, start_month?)`, `season_set_current(season)` | staff / admin | |
| `billing_entity_save(payload)` (full replace), `billing_entity_route_set(activity, entity|null)`, `invoice_set_billing_entity(invoice, entity)` (draft) | admin | |
| `invoice_number_series_set(category, prefix|'' , is_active)` | admin | `INVALID_PREFIX`, `PREFIX_IN_USE`, `OTHER_NOT_ALLOWED` |
| `invoice_set_activity(invoice, activity, reason)` | admin | reclassifies drafts and migration/default rows; resolves the flag |
| `create_manual_invoice(payload)` | finance | now `activity` required (or derived from `program_id`), `request_id` idempotent, `billing_entity_id` (admin) |
| `apply_family_credit` (category pool, then unassigned), `adjust_family_credit(…, p_activity)`, `family_credit_assign_activity` | finance | `ACTIVITY_MISMATCH` across categories |
| `family_balance_by_activity(family)` | RLS | per category+currency: open count, due, paid, balance, overdue, credit |
| `invoice_totals_by_category(from, to, entity?, status?)` | finance | per category+currency: invoice_count, invoiced, received, outstanding (credit notes under the original's category; cancelled/void count 0) |
| `invoice_source(invoice)` | RLS | `{kind: membership|programme|registration|booking|training_package|shop, id, label}` |
| `billing_category_label(invoice)` | RLS | programme series for selection invoices |
| `data_review_flag_resolve(flag, note)` | finance | |

## 5. Server layer

Actions (`src/lib/actions/billing.ts`, zod-validated, result `{ ok, data?, message? } | { ok:false, error, code? }`,
error = translated `billing.errors.<CODE>`): `saveBillingEntity`, `setBillingEntityRoute`, `setInvoiceBillingEntity`,
`setInvoiceActivity`, `setInvoiceNumberPrefix`, `saveClubBillingSettings`, `saveSeason`, `setCurrentSeason`
(admin); `previewMembership` (finance), `issueMembership`, `carryForwardMembership` (admin, `requestId`);
`recordReceipt`, `allocateReceipt` (`requestId`), `voidReceipt`, `adjustActivityCredit`, `assignCreditActivity`,
`resolveReviewFlag` (finance). `createInvoice` (`src/lib/actions/invoice.ts`) takes `activity` + `request_id`.

Reads (`src/lib/data/billing.ts`): `getBillingEntities` (entities, routes, number series, migration-default count),
`getClubBillingSettings`, `listSeasons`, `listUnallocatedReceipts`, `getReceipt`, `getFamilyBalanceByActivity`,
`getMembershipSummary`, `listMembershipPayers`, `getInvoiceSource`, `listReviewFlags`, `listBillingInvoices({category,
entityId, status, from, to, numberSearch (ilike), page, pageSize})` (category, number, entity name, source label),
`getInvoiceTotalsByCategory`, `getInvoiceCategoryInfo`. Open balances: `loadOpenInvoices` rows carry `activity`;
`openByActivity` / `openByFamilyActivity`; family detail has `balanceByActivity`.

TS mirrors: `clubInstallmentSchedule`, `seasonMonthsWithoutInstallment`, `membershipShares` (fixed first, percent of the
rest totalling 100, last percent payer absorbs centimes), `clubSeasonBounds` — same fixtures as SQL
(`tests/unit/fixtures/club-installment-schedule.json`).

UI: Settings → Billing entities (`/admin/settings/billing-entities`: entities, routing per category, number prefixes),
Settings → Seasons (`/admin/settings/seasons`), category badge on the admin and parent invoice pages
(`src/components/billing/category-badge.tsx`), category + source line on the invoice PDF, issuing entity name /
address / IBAN on the QR-bill (`applyBillingEntity`), category select on the manual invoice form.

## 6. Migration behaviour on existing data

1. One default billing entity per org from today's creditor settings (`app_settings.settings.payments`, then
   `organizations.payment_settings`, then the org name/country); new orgs get one by trigger. Every existing invoice gets
   it with `billing_entity_source='migration_default'` (count shown on the settings page for review).
2. Category backfill by linked records only: legacy membership link → `club_membership`; selection application or
   selection programme → `selection`; camp edition / camp programme → `camp`; training booking or package → `training`;
   shop order → `shop`; split children follow the parent. **Club-fee rule**: `program_id` is null **and** the
   description starts with "Membership fee" / "Club membership fee" / "Cotisation" / "Mitgliederbeitrag" / "Quota
   sociale" **and** contains a season label `YYYY-YY` or `YYYY/YYYY` whose second year follows the first (so a date
   range such as `2026-09-01` does not qualify; recurring-plan descriptions "Membership fee · 2026-09-01 – …" stay
   `other`). Everything else → `other` + `CATEGORY_AMBIGUOUS` flag with the original number in `original_reference`.
3. Family credit: entries linked to an invoice take its category; manual entries take the family's only category when
   unambiguous; if any pool would be negative the family's credit stays unassigned and is flagged
   `CREDIT_ACTIVITY_UNRESOLVED`.
4. Club fees → memberships (`billing_migrate_club_fees`): per org with a current season, per athlete: one
   `season_fee` membership; agreed fee = sum of the live (not cancelled/void) club-fee invoices ("payments received" +
   "balance"); `sponsored` when every balance invoice was cancelled with "sponsor" in the description or cancel reason;
   all the athlete's club-fee invoices (also the cancelled ones) linked with `membership_id`/`charge_kind='season_fee'`;
   one `membership_payers` row (`family`, fixed = fee, the family's contact, invoice = the live balance invoice).
   Invoices, payments and numbers are not changed. Flagged instead of guessed: `NO_ATHLETE`, `NO_CURRENT_SEASON`,
   `SEVERAL_FAMILIES`, `SEVERAL_CURRENCIES`, `SEVERAL_SEASON_PATTERNS`, `SEASON_MISMATCH` (label year ≠ current season),
   `FEE_PATTERN_MISMATCH` (no season label, an unknown suffix, more than one live balance or received invoice, nothing
   live and not sponsored), `MEMBERSHIP_EXISTS`, `MIGRATION_ERROR`. Season dates are not touched; fixing the season row
   later moves the validity of its season-fee memberships.

## 7. Team assignment never bills

Audited: `assignToTeam` (`src/lib/actions/roster.ts`), `addTeamMember` (`src/lib/sportsops/actions.ts`), selection
enrolment (`selection_*` functions insert `team_memberships`), person restore, team delete. None creates an invoice or a
membership; there is no trigger on `team_memberships` that bills. The only team-linked billing is
`recurring_enrol_team` (explicit finance action enrolling a team into a recurring fee template): two templates for two
teams would bill a player twice — do not use team recurring templates for the club fee; the season fee is one
membership per athlete and season (unique index). DB test: a player added to two teams creates no invoice/membership.

## 8. Error codes (`billing.errors.*` in en, fr, de, it, es)

See `BILLING_ERROR_CODES` in `src/lib/billing/activities.ts` (plus `DUPLICATE`, `generic`, `invalid`).
