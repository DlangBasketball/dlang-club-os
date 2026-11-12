# Updated business pack — November 2026

This folder holds the **updated (v2) versions** of the founder's August 2026 business materials, re-baselined on 11 November 2026. All dates run from **Monday 16 November 2026** and are shown as **base / downside**. **Updated 12 November 2026** with the founder's 15 decisions (log: [`../11_FOUNDER_DECISIONS_2026-11-12.md`](../11_FOUNDER_DECISIONS_2026-11-12.md)).

**The originals are untouched** and live in [`../source/`](../source/) (with plain-text extracts in [`../source/text/`](../source/text/)). Never edit the originals; write new dated versions here.

## What is in this folder

| File | What it is | Replaces (original in `docs/company/source/`) |
|---|---|---|
| [`CHANGELOG.md`](CHANGELOG.md) | Every changed file, what changed and why, grouped by area; the **12 Nov 2026 founder decisions** section, figures of record and remaining open items | — |
| [`DLANG_Sports_OS_Business_Plan_v2.md`](DLANG_Sports_OS_Business_Plan_v2.md) / [`.docx`](DLANG_Sports_OS_Business_Plan_v2.docx) | Updated business plan. Same sections (00–13, appendices) as the original; changed sections marked **[Updated Nov 2026]** | `DLANG_Sports_OS_Business_Plan.docx` (18 Aug 2026) |
| [`DLANG_Sports_OS_Rollout_v2.md`](DLANG_Sports_OS_Rollout_v2.md) / [`.docx`](DLANG_Sports_OS_Rollout_v2.docx) | Operational rollout: weeks 1–13 (16 Nov 2026 – 14 Feb 2027) with owners, gates and stop rules, then a 12-month roadmap by quarter to Feb 2028 | `DLANG_Sports_OS_90_Day_Rollout.docx` (24 Aug – 22 Nov 2026) |
| [`DLANG_Sports_OS_Financial_Model_v2.xlsx`](DLANG_Sports_OS_Financial_Model_v2.xlsx) | Financial model v2: Dec 2026 – Nov 2029, Base / Bull / Bear; all original sheets plus **Changes_v2** (93 cell changes) and **Timeline_v2** (25 milestones). Notes in [`../10_FINANCIAL_MODEL_V2_NOTES.md`](../10_FINANCIAL_MODEL_V2_NOTES.md) | `DLANG_Sports_OS_Financial_Model.xlsx` |

Not replaced (still the founder's originals, to be revised by the founder): the **CTO Partnership Proposal** (superseded in practice by the founder's 12 Nov decision for a fractional CTO + AI agent team; see 04, Business Plan v2 §9.2 and `../12_CTO_SOLUTION_AI_PLUS_HUMAN.md`), the **Executive Dashboard** (superseded in practice by the weekly scorecard in Rollout v2 §4.3 and 00 §8), and the **Investor Deck** (the required fixes are listed in CHANGELOG, due 4 Dec 2026).

## The supporting company documents (one level up, `docs/company/`)

| File | Covers |
|---|---|
| `00_EXECUTIVE_PLAN.md` | Operating plan: roadmap, launch gates, OKRs, risks, decision log, first 30 days |
| `01_BUSINESS_MODEL.md` | Segments, pricing, take-rate, unit economics |
| `02_GO_TO_MARKET.md` | Swiss sales motion and calendar, EUR track, US gate, pilots, partners |
| `03_CTO_TECHNOLOGY_STRATEGY.md` | Architecture, payments, security, delivery, tech debt |
| `04_ORG_DESIGN_AND_HR.md` | Org stages, hiring, CTO decision, Swiss employment, equity |
| `05_LEGAL_CORPORATE_STRUCTURE.md` | Entity, IP, payments/AML, VAT, contracts, insurance |
| `06_CUSTOMER_SUCCESS_AND_SUPPORT.md` | Onboarding, SLAs, health score, help centre |
| `07_BRAND_AND_MARKETING.md` | Brand layers, naming, claims policy, launch calendar |
| `08_AI_AGENT_TEAM.md` | The AI agent team and governance |
| `09_FOUNDER_PLAN_REVIEW.md` | Line-by-line review of the August plan |
| `10_FINANCIAL_MODEL_V2_NOTES.md` | How the v2 workbook changed and how to use it |
| `11_FOUNDER_DECISIONS_2026-11-12.md` | The founder's decisions of 12 Nov 2026: decision log, remaining risks, follow-up dates, figures and dates of record |
| `12_CTO_SOLUTION_AI_PLUS_HUMAN.md` | Why AI agents engineer but a named human fractional CTO is needed |

## How to read it (suggested order)

1. **`../11_FOUNDER_DECISIONS_2026-11-12.md`** — 10 minutes. The founder's answers and what they changed.
2. **`CHANGELOG.md`** — what changed in each file, and what is still open.
3. **`DLANG_Sports_OS_Business_Plan_v2`** — sections 00, 01, 02 and 13 first (the summary, the decision memo, the milestones and gates); the rest as reference.
4. **`DLANG_Sports_OS_Rollout_v2`** — what happens from Monday 16 November. Start with section 6.1, the week 1 checklist.
5. **`DLANG_Sports_OS_Financial_Model_v2.xlsx`** with `../10_FINANCIAL_MODEL_V2_NOTES.md` — switch scenarios at `Assumptions!B4`; enter actual cash at `B54`; test a bridge at `B72`–`B73`.
6. **`../00_EXECUTIVE_PLAN.md`** then 01–07 as needed for detail; `../09_FOUNDER_PLAN_REVIEW.md` for the reasoning behind each re-baselined date.

**Where documents disagree:** financial figures and the break-even and bridge dates follow the v2 workbook (founder decision, 12 Nov 2026). The workbook file still opens on its 11 Nov defaults; the 12 Nov founder-facts case (FIT 0%, EUR 50k released in March 2027 once a CTO is in place: cash negative from January 2027) and the lean plan of record are in `../11_FOUNDER_DECISIONS_2026-11-12.md` §2 until the defaults are switched on 3 Jan 2027. Operating dates follow `00_EXECUTIVE_PLAN.md`.

## Conventions

- Amounts in CHF unless marked EUR. Model year 1 = Dec 2026 – Nov 2027.
- Labels: [founder] / [Founder] from the August materials · [Est.] estimate · [Confirm] only the founder knows · [Verify] needs a lawyer, fiduciary or tax adviser.
- The `.docx` files are generated from the `.md` files with pandoc, using the original business plan `.docx` as the style reference. Edit the `.md`, then regenerate:

```
cd docs/company/updated
pandoc DLANG_Sports_OS_Business_Plan_v2.md -o DLANG_Sports_OS_Business_Plan_v2.docx --reference-doc=../source/DLANG_Sports_OS_Business_Plan.docx
pandoc DLANG_Sports_OS_Rollout_v2.md -o DLANG_Sports_OS_Rollout_v2.docx --reference-doc=../source/DLANG_Sports_OS_Business_Plan.docx
```
