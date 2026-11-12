# 08 — AI Agent Team

**Prepared:** 12 November 2026; **updated 12 November 2026** with the founder's decisions (`11_FOUNDER_DECISIONS_2026-11-12.md`, decisions 3, 7, 12 and 13; `12_CTO_SOLUTION_AI_PLUS_HUMAN.md`)
**Purpose:** how the founder keeps building and running DLANG Sports OS with a team of Claude Code subagents, and how humans stay in control.
**Related:** `CLAUDE.md` (rules every agent follows), `.claude/agents/*.md` (agent definitions), `00_EXECUTIVE_PLAN.md` (gates and dates), `04_ORG_DESIGN_AND_HR.md` (human team plan).

---

## 1. Why an AI agent team

Until about 10 paying clubs, the plan is to buy capacity by the hour (`00_EXECUTIVE_PLAN.md` §1, `04_ORG_DESIGN_AND_HR.md`). The plan of record (founder decision, 12 Nov 2026) is a **named human fractional CTO leading this AI agent team** (`12_CTO_SOLUTION_AI_PLUS_HUMAN.md`): target signed **15 Dec 2026** (latest 31 Jan 2027), with a paid senior reviewer (4–8 h/week, pre-contracted 16 Dec 2026) as the bridge until the CTO starts. The agents do drafting, coding, testing and reviewing. **An agent cannot be the CTO**: it cannot sign, hold equity or production credentials, or be accountable to the investor, who releases the EUR 50k only once a CTO is in place. Accountable humans make decisions: the founder, the fractional CTO (or the reviewer until then), a lawyer and a fiduciary.

Every agent:
- reads `CLAUDE.md` and the company documents relevant to its area, including the founder's originals in `docs/company/source/` (text extracts in `docs/company/source/text/`);
- owns specific paths in the repository and the standards for them;
- checks its own work with `npx tsc --noEmit`, `npm run build`, `npm test` and `scripts/db-test.sh` (the last two once they are set up);
- hands off to the next agent rather than working outside its area.

## 2. The team

| Agent | Sector | Owns (main paths) | Typical hand-off |
|---|---|---|---|
| `cto-architect` | Technology | architecture, `src/lib/**` layering, `middleware.ts`, `docs/adr/` | backend, payments, frontend |
| `product-manager` | Product | `docs/product/specs/` | cto-architect, ux-designer |
| `frontend-engineer` | Engineering | `src/app/**` pages, `src/components/**`, `globals.css` | backend, ux, i18n |
| `backend-db-engineer` | Engineering | `supabase/migrations/`, `testing/`, `src/lib/data`, `src/lib/actions`, `src/types/database.ts` | security-reviewer |
| `payments-engineer` | Engineering | `src/lib/stripe.ts`, `swiss-payments.ts`, `invoice-pdf*.ts`, `api/stripe/webhook`, invoice/payment migrations | security, finance, legal |
| `security-reviewer` | Security | reviews everything (read-only) | owning agent |
| `privacy-compliance-officer` | Compliance | `docs/compliance/`, consent/privacy code reviews | legal, backend |
| `qa-test-engineer` | Quality | `testing/`, `*.test.ts`, `docs/qa/` | owning agent, devops |
| `devops-sre` | Operations | `.github/workflows/`, `scripts/`, `.env.example`, `docs/ops/` | founder for deploys |
| `i18n-localization` | Localisation | message catalogs, formatting and terminology helpers, email copy | frontend |
| `ux-designer` | Design | `docs/design/` (new files only), tokens with frontend | frontend |
| `customer-success` | Customers | `docs/support/` | qa, product, onboarding |
| `gtm-strategist` | Sales and marketing | `docs/gtm/` | finance, legal |
| `hr-people-partner` | People | `docs/people/` | legal, finance |
| `finance-analyst` | Finance | `docs/finance/` (never edits `docs/company/source/`) | founder |
| `legal-counsel-assistant` | Legal (templates only) | `docs/legal/templates/`, `docs/legal/questions-for-counsel.md` | lawyer, founder |
| `tenant-onboarding-specialist` | Onboarding | `docs/onboarding/`, CSV templates | customer-success |

The full definitions are in `.claude/agents/`. Edit them as the company changes, for example when a role is filled by a person.

## 3. How to use them

In Claude Code, ask for an agent by name ("use the payments-engineer agent to ...") or describe the task. Claude Code picks the agent whose `description` fits. For larger work, ask the `cto-architect` or `product-manager` for a plan first. Then run the agents in order.

Standard feature chain:
1. `product-manager`: spec with acceptance criteria and the gate it serves.
2. `cto-architect`: design and hand-off list.
3. `backend-db-engineer`, `payments-engineer`, `frontend-engineer` (with `ux-designer` and `i18n-localization`): build it.
4. `qa-test-engineer`: tests and smoke run.
5. `security-reviewer`, plus `privacy-compliance-officer` if personal data is involved: review.
6. Founder: reads the summary, approves the merge.

## 4. Example prompts

### Add a feature
> Use the product-manager agent to write a spec for "waitlist for full camps": parents can join a waitlist on `/register/[programSlug]`, and admins can promote someone, which sends an invoice. Tie it to the gate it serves in `docs/company/00_EXECUTIVE_PLAN.md`. Then have cto-architect produce a design and a hand-off list.

> Use the backend-db-engineer agent to add the `waitlist_entries` table from the approved spec, as a new timestamped, idempotent migration with RLS and cross-tenant denial tests. Validate it in a throwaway database. Then ask security-reviewer to review the migration.

> Use the frontend-engineer agent to build the admin waitlist screen to match the V1 prototype. No hard-coded strings, CSS variables only, with loading, empty and error states. Run `npx tsc --noEmit` and `npm run build`.

### Onboard a new club
> Use the tenant-onboarding-specialist agent to prepare the go-live checklist for a new academy in Geneva: French and English, CHF, about 180 athletes, QR-bill and card payments, and terminology "player" and "team". List what the club must send us and generate the CSV import template. Do not put any real club data in the repo.

### Launch a new country
> Use the gtm-strategist agent with privacy-compliance-officer, i18n-localization, payments-engineer and legal-counsel-assistant to draft a launch-readiness checklist for Germany (EUR track). Use the gate and dates in `docs/company/00_EXECUTIVE_PLAN.md` §4.3 and `02_GO_TO_MARKET.md` §5. Cover GDPR and the DPA, German UI and emails, EUR pricing as its own price points, SEPA and card payments, VAT, and what the code is still missing. Mark everything a lawyer or tax adviser must confirm as [Verify].

### Run a security review
> Use the security-reviewer agent to review the current branch diff against `main`. Focus on tenant isolation (RLS, `org_id` trust), service-role use, the Stripe webhook and access to minors' data. Run `scripts/db-test.sh` and `npm audit --omit=dev`. Report findings by severity with file and line.

### Other common prompts
- "finance-analyst: recompute runway under the downside case after hiring a contract engineer at 40 hours/month from January 2027, using `01_BUSINESS_MODEL.md` and the founder's Financial Model."
- "customer-success: write the parent FAQ for registration and paying by QR-bill, in French and German (with i18n-localization)."
- "hr-people-partner: role scorecard, contract points (decision rights, IP assignment to SPSA, hours) and a short paid trial plan for the fractional CTO, based on `12_CTO_SOLUTION_AI_PLUS_HUMAN.md`; shortlist by 30 Nov 2026, signed by 15 Dec 2026."
- "privacy-compliance-officer: draft the DPIA addendum and the DPA sub-processor entry for the opt-in AI assistant (`src/lib/ai/access.ts`, Settings → App & assistant) before DLang switches the beta on in Feb 2027."
- "finance-analyst: rerun `updated/DLANG_Sports_OS_Financial_Model_v2.1.xlsx` with the EUR 50k released in Apr 2027 instead of Mar 2027 and report the Jan–Apr bridge."
- "qa-test-engineer: build the DLang go-live smoke test plan for Gate 2 and Gate 3 in `00_EXECUTIVE_PLAN.md` §4.1."

## 5. Governance

Agents propose. Humans decide. These require explicit human approval every time:

| Action | Approver |
|---|---|
| Merge to `main` | Founder, plus the fractional CTO once signed (the paid reviewer until then). A second human approver on payments, RLS, auth, migrations and the AI assistant (`src/lib/ai`) |
| Production deploy, production database migration, DNS or hosting billing | Founder |
| Pricing, discounts, founding-club terms (including whether the AI assistant stays included in the Club tier [Confirm 15 Dec 2026]) | Founder, with finance-analyst analysis |
| Switching the AI assistant on for a club | That club's admin (opt-in, default off); never before the DPIA addendum and the DPA sub-processor entry are signed off |
| Any legal document, contract, privacy notice, DPA or consent text before use | Qualified lawyer, then the founder |
| Tax, VAT and accounting treatment | Fiduciary or tax adviser |
| Access to production data or to real club and children's data | Founder; least privilege; logged |
| Sending anything to customers, investors or authorities | Founder |

Working rules:
- Agents never commit secrets, real personal data or AI model identifiers. They never edit the founder's originals in `docs/company/source/`.
- Every change must keep `npx tsc --noEmit` and `npm run build` green and come with tests.
- Legal and compliance outputs are drafts marked [Verify]. They are not advice.
- Timelines quoted by any agent use the base / downside dates in `00_EXECUTIVE_PLAN.md`, never anything more aggressive.
- Review the agent definitions every quarter, together with the operating cadence in `00_EXECUTIVE_PLAN.md` §8. When a human takes over a sector, update that agent's hand-off rules to name the person's role.
- The **product's AI assistant** is separate from this agent team. It is opt-in per club (a club admin switches it on in Settings → App & assistant; default off), DLang beta Q1 2027. Agents changing it follow the guardrails in `03` §7 and need the second human approver.

## 6. Changes

| Date | Change | Why |
|---|---|---|
| 12 Nov 2026 | First version: 17 agents, hand-offs, example prompts, governance | Founder asked for an AI agent team |
| 12 Nov 2026 | Accountable human named as the **fractional CTO** (signed 15 Dec 2026, latest 31 Jan 2027), paid reviewer as the bridge; "contract engineer or CTO partner" removed | Founder decisions 3 and 7: AI agents engineer, a human CTO is accountable (`12_CTO_SOLUTION_AI_PLUS_HUMAN.md`) |
| 12 Nov 2026 | Second human approver for the AI assistant code; club-admin opt-in added to the approvals table; example prompts for the CTO search, the AI DPIA addendum and workbook v2.1 | Founder decision 12: AI assistant opt-in per club, DLang beta Q1 2027 |
