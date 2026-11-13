# 13 — Parent AI Add-on: Product Spec (proposal)

**Status:** **Proposal, not committed.** Not in the plan of record, not in the workbook (v2.2 treats it as upside only), not on the 2027 roadmap.
**Prepared:** 12 November 2026, from the founder's follow-up answers (round 2, item B, in `11_FOUNDER_DECISIONS_2026-11-12.md` §1a).
**Founder's idea ("maybe"):** parents could pay an extra fee to use the AI assistant to make their own club admin easier.
**Owner when picked up:** product-manager, then cto-architect, privacy-compliance-officer, payments-engineer, i18n-localization, security-reviewer. Founder decides.

**Labels:** [Est.] estimate · [Confirm] only the founder knows · [Verify] needs a lawyer, data-protection adviser or the provider. Amounts in CHF unless marked.

---

## 1. Problem and idea

Parents ask the club the same questions every week: when is training, what do I owe, what do I bring to camp, how do I register, what did that German message say. Club admins answer by hand. A parent-facing assistant inside the parent app could answer from the family's own records and the club's published information, in the parent's language, at any hour.

It would be a **paid add-on for families**, on top of the **club AI add-on** (round 2, item A: the staff assistant is a paid add-on for clubs at a proposed CHF 69 per club per month; DLang gets it free).

## 2. User stories (first version)

| # | As a parent / guardian, I want to... | Answered from |
|---|---|---|
| P1 | ask "when and where is my child's next training or match?" and get the next sessions, with changes and cancellations | The family's registrations and the club's published schedule |
| P2 | ask "what do I owe, and by when?" and get open invoices, due dates and how to pay (QR-bill, card, TWINT) | The family's own invoices (status, amount, due date) |
| P3 | ask "what do we need to bring to camp / the tournament?" | The club's published programme information and packing lists |
| P4 | get help with a registration: which programme fits my child's age group, what the form asks for, where I am stuck | Public programme pages and the registration form (no new data collected by the AI) |
| P5 | have a club message translated and summarised into my language (FR, DE, IT, EN) | Messages already sent to this family |
| P6 | ask "has my booking with the coach been confirmed?" | The family's own player-development bookings |
| P7 | draft a polite message to the club (absence, question about an invoice), which **I** review and send | The parent's own input; sent only by the parent |

Out of scope for version 1: voice, push notifications written by the AI, payments made by the AI, anything the club has not published.

## 3. What it must NOT do

- **No medical, health, injury, nutrition or psychological advice.** It refers the parent to a doctor or the club. Medical notes are never in its context.
- **No data on other children or other families.** Only the guardian's own family, through the existing row-level security (`is_guardian_of_family`, `is_guardian_of_athlete`). No rosters, no other parents' names, no team lists beyond what the club publishes.
- **No coach notes, assessments or selection decisions**, and no guessing about selection, playing time or ranking.
- **No actions on its own:** it does not pay, cancel, register, change consents or send messages. It drafts; the parent acts.
- **No talking to children.** The add-on is for guardians (18+) only; athletes, including teenage athletes with their own login, never get it. **Under-13s never use it.**
- **No legal or financial advice** beyond explaining the club's own invoices and terms.
- **No training on tenant or family data**; no use of family data for anything else.

## 4. Minors' data rules (CLAUDE.md §8, nFADP, GDPR, COPPA)

- **Data minimisation.** The parent context is an allow-list: child first name, programme, age group (not date of birth), sessions, the family's invoices, bookings, and published club information. **Never** medical notes, dates of birth, documents, consents content, coach notes or photos. *Note:* the current parent context in code (`src/lib/ai/context.ts`) derives the child's age from the date of birth and includes last names; that must be reduced to the allow-list before any parent switch-on.
- **Consent by the guardian.** The guardian switches the add-on on for their family, after a plain-language notice (what is sent to the AI provider, retention, sub-processor, how to switch off). The switch-on is recorded with version, timestamp and who (as for other consents). Switching off stops all processing at once.
- **Club permission first.** The club must allow the parent add-on for its families (club setting, default off) and have the club add-on active (see §7).
- **Under 13 / COPPA (US).** No processing of an under-13's data through the AI without verifiable parental consent; the guardian is the only user. For US tenants this is a COPPA question for counsel before any switch-on [Verify]. FERPA if a school tenant [Verify].
- **Sub-processor and DPA.** The AI provider is already listed as a sub-processor for the club add-on; the parent add-on needs the parent-facing privacy notice updated and the DPIA extended [Verify with data-protection adviser].
- **Logging.** Questions and answers are logged for abuse handling and quality, retained for a short, stated period (e.g. 30 days [Est.]), visible to the guardian, not to coaches. Access to logs is audit-logged (`audit_logs`).
- **Tenant isolation.** Context is built with the guardian's own session (row-level security), never with the service-role client.

## 5. Pricing options [Est.][Confirm]

| Option | Price to the family | Notes |
|---|---|---|
| A. Monthly | **CHF 3–5 per family per month** (EUR 3–5; USD 4–6 indicative) | Easy to try and cancel; small amounts carry Stripe fixed fees (CHF 0.30 + %), so net per family is about CHF 2.50–4.50 |
| B. Season / annual fee (recommended to test first) | **About CHF 30–45 per family per season** | Matches how families pay clubs (per season); one charge, lower fee drag; can be added at registration checkout |
| C. Bundled by the club | Club pays a flat amount (e.g. CHF 1 per active family per month [Est.]) and offers it free to its parents | Simplest for parents; the club decides; fits the club add-on |

**Who collects the money.**
- **Platform collects (direct to the family):** DLANG sells to the family through Stripe; the club gets a **revenue share** (e.g. 20–30% [Est.]) for allowing it. Clear for us, but DLANG then has a direct consumer relationship (consumer terms, refunds, VAT on digital services to consumers, Swiss and EU) [Verify].
- **Club collects (recommended for a first pilot):** the club adds the fee to its own registration invoice or checkout (Stripe Connect direct charge, as for club fees); DLANG bills the club a per-family wholesale price. The club stays the family's contracting party, which matches how clubs work today.
- Either way: **payment via Stripe** (card, TWINT; QR-bill if bundled into the season invoice). No new rail.

**Revenue illustration (not in the model) [Est.]:** a club with 140 athletes ≈ 110 families; at 15% take-up and CHF 40 per season, about CHF 660 per club per season before shares and fees. At 45 clubs, about CHF 30k a year gross. Upside only.

## 6. Payment and billing

- Stripe: a family-level subscription or a one-off season item at checkout; refunds and cancellation in the parent app.
- The entitlement model already reserves a **`family` scope** for add-ons (`src/lib/ai/access.ts`: "reserved (future parent add-on) and grants nothing yet"). The parent add-on would use it.
- Currency and language from the org and the user locale (i18n rule); no hard-coded "CHF".

## 7. Dependencies

1. **Club AI add-on live and proving value first** (round 2, item A): sold to clubs from Jun 2027 (base); value shown by measured time saved and retention on at least 5 paying AI clubs [Est.].
2. **Parent assistant is currently disabled in code:** only club staff (admin, finance) may use the assistant; the `family` scope grants nothing. Enabling it is a deliberate change with tests (cross-tenant and cross-family denial cases).
3. **Does the club need the club add-on first?** Recommended **yes**: one DPIA and sub-processor setup per club, the club controls whether its parents can use it, and support stays manageable [Confirm].
4. Parent-context allow-list (§4), guardian consent record, published club info pages (schedule, packing lists) in structured form.
5. Message catalogues for the parent UI in FR/DE/IT/EN.

## 8. Privacy review needed (before any build)

DPIA extension for parent use and children's data; privacy notice for parents; consent text and record; retention period for logs; COPPA and state-law view for US tenants; consumer-law and VAT view if the platform sells directly to families. Owner: privacy-compliance-officer, then a data-protection adviser [Verify]. Founder approves the documents before use.

## 9. Rough effort [Est.]

| Work | Estimate |
|---|---|
| Parent-context allow-list, guardian consent flow, club setting, `family` entitlement, tests (incl. cross-family denial) | 2–3 weeks of agent engineering + CTO review |
| Stripe item (family subscription or season checkout line), revenue-share accounting if platform collects | 1–2 weeks |
| Parent UI (chat panel in the parent app), translations FR/DE/IT/EN | 1–2 weeks |
| Privacy pack (DPIA extension, notices, consent text) | 1–2 weeks elapsed, adviser cost about CHF 2–4k |
| Inference cost | small per family (short questions); cap per family per month [Est.] |

Total about **5–8 weeks** elapsed, plus privacy review. Not in the 2027 capacity plan.

## 10. Recommended earliest timing [Confirm]

- **Not before the club add-on proves value** (sold to clubs from Jun 2027; first evidence after the Sep–Oct 2027 season peak).
- **Earliest:** a **DLang-parents pilot after the 2027 season peak, not before Nov 2027; base Q1 2028**, free to DLang families during the pilot (DLang is customer zero), with guardian consent and a written success check (questions answered without staff, satisfaction, zero data incidents).
- **Then:** offer to other clubs' parents for the **2028/29 season** if the pilot passes and the privacy review is signed off.
- **Decision point:** review this spec at the 31 Mar 2027 strategy checkpoint and again after the DLang pilot. Until then it stays a proposal.
