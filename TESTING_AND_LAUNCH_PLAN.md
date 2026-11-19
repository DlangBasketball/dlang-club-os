# DLang Basketball Club OS — Testing & Launch Plan

This plan covers everything required to validate the app and take it live for a
small pilot. It is grounded in the actual build: Next.js + Supabase, 16 SQL
migrations, role-scoped RLS, Stripe + Swiss QR-bill payments, Resend email, and
the AI assistant (v2). Companion docs: `SECURITY.md`, `SECURITY_CHECKLIST.md`,
and the runnable `testing/rls_test_suite.sql`.

## Test accounts (dev seed)
| Role | Login | Notes |
|---|---|---|
| Admin | `admin@dlang.test` | full access |
| Finance | `finance@dlang.test` | invoices/payments, no settings |
| Coach | `derrick@dlang.test` | Derrick Lang, assigned sessions only |
| Parent | `carla.lopes@gmail.com` | guardian of the Lopes family (child: Mateo) |

Password for all seed accounts: `password123`. Confirm exact emails in
`supabase/seeds`. **For the pilot, use real invited accounts, not seeds.**
Reference data: family Lopes, overdue invoice `INV-2026-0211`, another family
(Rossi) used to prove isolation.

---

# 1. Manual QA Checklist

Run on **Chrome + Safari (desktop)** and **iOS Safari + Android Chrome (mobile)**.
Mark Pass/Fail; any Fail on a P1 flow blocks launch.

| # | Flow | Account | Steps | Expected result | P |
|---|---|---|---|---|---|
| 1 | Parent login | parent | Sign in at `/login` | Lands on `/parent/home`; sees only own family | P1 |
| 2 | Admin login | admin | Sign in | Lands on `/admin/dashboard`; full nav incl. Settings | P1 |
| 3 | Coach login | coach | Sign in | Lands on coach home; sees Schedule/Attendance only | P1 |
| 4 | Public registration | none | `/register/<program-slug>` → fill parent + 1 child → accept consents → submit | Family/athlete/registration created; invoice issued; success page; confirmation email queued | P1 |
| 5 | Multi-child registration | none | Same flow, add 2+ children | All children registered; sibling discount applied if configured; one invoice | P1 |
| 6 | Consent acceptance | none | During reg, leave a required consent unchecked → submit | Blocked with "accept all required"; on accept, acceptance stored with version + IP + **text snapshot** | P1 |
| 7 | Invoice generation | admin | `/admin/invoices` after a registration; also create a manual invoice | Number follows pattern `INV-{YYYY}-{####}`, monotonic; line items + total correct | P1 |
| 8 | Stripe payment | parent | Open an invoice → pay with card `4242…` | Payment succeeds; invoice → paid; webhook recorded; receipt | P1 |
| 9 | Manual payment | finance | `/admin/payments` → record manual/TWINT/bank payment against an invoice | Payment recorded immutably; invoice balance/status updates | P1 |
| 10 | Overdue reminder | admin | Settings/Notifications → "Send overdue reminders" (with `INV-2026-0211` overdue) | Reminder email + in-app notification to that family's guardian; email logged | P2 |
| 11 | Coach attendance | coach | `/coach/attendance` → open a session → mark present/absent → submit | Marks saved; roster size set; parents (if visible) see attendance; private notes hidden from parents | P1 |
| 12 | Parent portal permissions | parent | Try to reach `/admin/*`, `/coach/*`, and another family's invoice URL | Redirected/denied; never sees other families' data | P1 |
| 13 | Coach permissions | coach | Try `/admin/*`; open attendance for a session not theirs | Denied; sees only assigned sessions; no invoices/medical | P1 |
| 14 | Admin permissions | admin | Visit every admin route | All load; can manage org-wide data and settings | P1 |
| 15 | Training booking | parent | `/parent/bookings/new` → child + service + slot → pay by invoice | Booking created; slot marked taken; invoice issued; confirmation email; coach notified | P1 |
| 16 | Credit booking | parent | Book a credit-eligible service with credits available | Credits deducted; no invoice; booking confirmed | P2 |
| 17 | Booking cancellation | parent | Cancel a booking >24h out, then one <24h out | >24h: within policy, credits refunded / invoice voided; <24h: outside policy per config | P2 |
| 18 | Document upload/download | admin→parent | Admin uploads a family-scoped doc; parent opens it; parent tries another family's doc id | Parent downloads own via signed URL; other family's denied | P1 |
| 19 | Notification delivery | all | Trigger events (reminder, broadcast); open the bell | In-app bell shows unread; email logged; parent sees only their notifications | P2 |
| 20 | Data export | parent/admin | Parent: Account → "Download my data"; Admin: Settings/Privacy → Export | Parent JSON contains only their family; admin JSON has org config + counts | P2 |
| 21 | Deletion request | parent→admin | Parent requests erasure; admin approves | PII anonymised; financial records retained; audit row written | P2 |
| 22 | Mobile responsiveness | all | Walk flows 1–18 on phone | Bottom-tab nav works; forms/tables usable; no overflow; tap targets adequate | P1 |
| 23 | Error handling | all | Bad login; expired signed URL; offline submit; invalid form input | Friendly messages; generic server-error with ref id; no stack traces or PII leaked | P1 |
| — | Security / RLS | — | Run `testing/rls_test_suite.sql` | Zero `FAIL` lines (see §3) | P1 |

---

# 2. Automated Test Plan

**Pyramid.** Many fast unit tests, fewer integration tests against a real test
DB, a thin layer of E2E for the money/safety paths, plus the RLS suite in CI.

**Unit (Vitest)** — pure logic, no network:
- `formatCHF`, `formatDate`, `timeAgo`, `initials`
- invoice number formatting against the pattern; QRR reference + check-digit (`qrr_check_digit`)
- credit math (deduct/refund), cancellation-policy window calculation
- `redact()` masks emails/phones/IBANs/keys; `applyVars()` template substitution

**Integration (Vitest + a disposable Supabase/Postgres)** — call the RPCs and
assert DB state: `register_public`, `create_manual_invoice`, `record_manual_payment`,
`apply_stripe_payment`, `book_training_session`, `cancel_training_booking`,
`reschedule_booking`, `flag_overdue_invoices`, `withdraw_consent`, `anonymise_family`.
Seed fixtures, run RPC, assert rows + audit entries.

**E2E (Playwright)** — critical paths only, one per role:
- public registration → invoice issued
- parent pays with Stripe test card → invoice paid
- coach marks attendance → parent sees it
- parent cannot open another family's invoice/document (expect denial)

```ts
// e2e/registration.spec.ts (illustrative)
test('public registration issues an invoice', async ({ page }) => {
  await page.goto('/register/summer-pro-skills-academy-w1');
  await fillParent(page); await addChild(page, 'Test', 'Child');
  await acceptRequiredConsents(page);
  await page.getByRole('button', { name: /submit/i }).click();
  await expect(page.getByText(/registration confirmed/i)).toBeVisible();
});
```

**RLS suite** — `psql -f testing/rls_test_suite.sql`; fail CI if any line prints `FAIL`.

**CI pipeline (GitHub Actions):** `lint → typecheck (tsc) → unit → spin up Postgres + apply migrations → integration + RLS suite → build → (nightly) Playwright`. Block merge on any red. Add `npm audit` and a secret-scanner.

---

# 3. Supabase RLS Test Cases

Authoritative, runnable: **`testing/rls_test_suite.sql`** (all assertions
currently PASS). It simulates each role via the JWT claim and asserts:

| Control | Assertion |
|---|---|
| Parent = own family | own-family athletes/invoices only; another family's athlete → 0 |
| Medical protection | coach → 0 medical; parent → 0 of another child's medical |
| Financial admin-only | coach → 0 invoices & 0 payments; finance → >0 invoices |
| Coach scope | coach sees a strict subset of athletes (4 of 8 in seed) |
| Consent immutability | app edit affects 0 rows (RLS); privileged edit/delete blocked by trigger |
| Document scope | parent cannot see another athlete's document |
| AI audit isolation | coach cannot read another user's AI queries |
| Deletion request | parent cannot request another family's erasure |
| Erasure RPC | `anonymise_family` is admin-only |

Extend per resource using the matrix **{role} × {table} × {expected rows}**.
Manual spot-checks to add via PostgREST (not just the UI): call the REST API with
a parent JWT and confirm cross-tenant/cross-family reads return empty.

---

# 4. Payment Test Cases

**Stripe (test mode).** Use Stripe test cards:
| Scenario | Card | Expected |
|---|---|---|
| Success | `4242 4242 4242 4242` | Payment intent succeeds → invoice paid → webhook records payment |
| Generic decline | `4000 0000 0000 0002` | Decline shown; invoice stays open; no payment row |
| 3-D Secure required | `4000 0025 0000 3155` | Auth challenge; on complete → paid |
| Insufficient funds | `4000 0000 0000 9995` | Decline; invoice unchanged |

- **Webhook integrity:** verify signature; reject unsigned/late events; idempotent on duplicate delivery (no double payment).
- **Idempotency:** retrying a succeeded payment does not create a second payment row or overpay.
- **Reconciliation:** Stripe `payment_intent` id stored on the payment; invoice status transitions paid/partially_paid correctly.

**Swiss QR-bill / manual.**
- QRR reference generated with valid mod-10 recursive check digit; SCOR/NON variants render correctly.
- `find_invoice_by_reference` matches a paid reference back to the right invoice.
- Manual/TWINT/bank payment recorded by finance; **payments immutable** (edit/delete blocked).
- Partial payment → `partially_paid`; sum of payments == total → `paid`.
- Overpayment handled (flag/credit) rather than silently lost.

**Overdue.** `flag_overdue_invoices` moves past-due `sent` → `overdue`; overdue
reminder targets only that family's guardians (see RLS suite + flow #10).

---

# 5. Pilot Launch Plan (5–10 families)

**Goal:** validate the end-to-end real-money, real-data flows with a friendly
cohort before general availability.

**Prerequisites (all green):** Go-live checklist (§7) complete; `SECURITY_CHECKLIST.md`
signed off; RLS suite green; Stripe in **live** mode with low-value real test;
backups + PITR on; legal/consent wording reviewed; support channel staffed.

**Cohort:** 5–10 families who already know the club (forgiving, reachable),
ideally spanning: single-child, multi-child, a sibling-discount case, one card
payer and one QR-bill/TWINT payer, and at least one coach actively marking
attendance.

**Phasing (≈3 weeks):**
1. *Week 0 — Setup:* configure club profile, venues, programs, consent forms,
   payment instructions, invoice numbering; invite admin + coach; dry-run a fake
   registration in production and refund it.
2. *Week 1 — Onboarding:* invite pilot families; they self-register or are
   invited; watch the first real invoices + payments closely; daily check-in.
3. *Week 2 — Operate:* run real sessions + attendance; trigger an overdue
   reminder; test a booking + cancellation; collect feedback (short form).
4. *Week 3 — Review:* triage bugs, measure success criteria, decide go/no-go for
   wider rollout.

**Monitor daily:** failed payments, failed emails (Settings → Notifications log),
error refs in logs, any RLS/permission surprise, sign-in problems, mobile issues.

**Success criteria:** ≥90% of pilot families complete registration + payment
unaided; zero data-isolation incidents; zero unrecoverable payment errors;
attendance used in ≥1 real session; positive qualitative feedback.

**Comms:** a short welcome email with what to expect + the support contact + a
one-line "this is a pilot, tell us what breaks." **Rollback:** keep the prior
process (spreadsheet/manual invoicing) available for 30 days; document how to
export and revert if needed.

---

# 6. Bug Triage System

**Intake:** single channel (support email / shared inbox) + an internal tracker
(GitHub Issues or Linear). Every server error surfaces a `ref XXXX` id — ask
users to quote it; it maps to the redacted server log.

**Severity & SLA:**
| Sev | Definition | Examples | Response | Fix target |
|---|---|---|---|---|
| **S1 Critical** | Data leak, payment loss, or app down | One family sees another's data; double charge; login broken | Immediate; consider pausing pilot | < 24h / hotfix |
| **S2 Major** | Core flow broken, no safe workaround | Registration fails; invoice not issued; emails not sending | Same business day | < 3 days |
| **S3 Minor** | Workaround exists | Wrong label; mobile layout glitch; slow page | Next triage | Next release |
| **S4 Cosmetic / enhancement** | Polish or request | Copy tweak, nice-to-have | Backlog | Scheduled |

**Triage cadence:** daily during pilot. Each issue gets: severity, owner,
repro steps, affected role/flow, and (for S1/S2) a root-cause note.
**Security incidents** (any S1 data-isolation/payment) follow `SECURITY.md` →
incident response, with breach-notification timelines (FADP/GDPR) considered.

---

# 7. Go-Live Checklist

**Environment & config**
- [ ] Production Supabase project; all 16 migrations applied in order; seeds NOT loaded in prod.
- [ ] `assertServerEnv()` passes; all required env vars set in the host secret store; no secret in any `NEXT_PUBLIC_*`.
- [ ] `NEXT_PUBLIC_SITE_URL` correct; custom domain + HTTPS/HSTS; redirect URLs locked to known domains.

**Security**
- [ ] `SECURITY_CHECKLIST.md` fully signed off.
- [ ] `testing/rls_test_suite.sql` green against production schema (with seed-equivalent fixtures in staging).
- [ ] Service-role key server-only; RLS + FORCE RLS on as designed; security headers (CSP, frame-ancestors) set.

**Payments & email**
- [ ] Stripe **live** keys; webhook endpoint live + signature verified; one real low-value end-to-end test + refund.
- [ ] Resend domain verified (SPF/DKIM); a real test email delivered (not spam).
- [ ] Invoice numbering counter set so the next number is correct (no reuse).

**Data & ops**
- [ ] Club profile, venues, programs, consent-form wording, payment instructions configured.
- [ ] Daily backups + PITR enabled; a test restore performed; nightly off-platform encrypted dump.
- [ ] Error monitoring (e.g. Sentry) connected, receiving **redacted** payloads only.
- [ ] AI assistant: leave disabled for MVP **or** set `ANTHROPIC_API_KEY` + red-team prompts first.

**Legal & support**
- [ ] DPAs with Supabase/Vercel/Stripe/Resend; data residency (EU/CH) confirmed.
- [ ] Privacy policy + consent texts legally reviewed and current.
- [ ] Support channel live; admin/coach trained; rollback plan documented.

---

# 8. Post-Launch Improvement Plan

**Week 1:** watch dashboards daily — payment success rate, email delivery rate,
error refs, sign-in funnel. Fix S1/S2 immediately. Collect a short satisfaction pulse.

**Day 30:** review metrics; close the pilot bug backlog; decide GA. Tighten the
roughest UX edges surfaced by real users (mobile, registration clarity).

**Day 90:** broaden rollout; revisit data-retention purge job; quarterly backup
restore drill; security re-review.

**Metrics to track:** registration completion rate, time-to-first-payment,
payment success %, overdue rate, email deliverability, attendance submissions per
week, support tickets per family, page performance (LCP), error rate.

**Engineering backlog (already scoped during the build):**
- Wire the remaining notification auto-triggers (payment received, attendance
  submitted, document uploaded, consent required) — templates already exist; just
  call `dispatchNotification`.
- Connect the saved notification-template overrides into the dispatch renderer.
- Installment payment plans (PRD Q4 — currently open).
- Live brand theming from the saved primary color/logo (currently stored, used in emails/PDFs).
- Coach "all notifications" page; streaming + rate-limiting for the AI assistant before enabling it.
- Scheduled/automated overdue reminders (cron/Edge Function) instead of manual.

**Feedback loop:** a lightweight in-app "send feedback" link → triage weekly →
feed S3/S4 + requests into the backlog with severity and effort.
