# >>venture>> 2027 — submission checklist

**Deadline: Monday 30 November 2026** (aim to upload by **Friday 27 November**).
**Owner:** Derrick Lang (founder). Prepared 12 November 2026.

Files in this folder:

| File | What it is |
|---|---|
| `DLANG_venture_2027_Startup_Plan.md` | The source text. Edit this one. |
| `DLANG_venture_2027_Startup_Plan.pdf` | The file to upload. Current draft: **18 A4 pages** (inside the 10–20 range). |
| `DLANG_venture_2027_Startup_Plan.docx` | An editable copy in the house style. It runs to about 27 pages because the reference styles are larger, so **do not upload the DOCX**. |
| `build/print.css`, `build/pagebreak.lua` | The print style and page-break filter used to make the PDF. |

## 1. Competition format: what we were told (check every line on venture.ch)

| Item | What we were told | Status |
|---|---|---|
| Application window | 1 Oct – 30 Nov 2026 | [Verify on venture.ch] |
| Document | Startup plan, 10–20 pages, in English, uploaded as a PDF | [Verify on venture.ch] |
| Updates | The plan can be updated until the deadline | [Verify on venture.ch] |
| Other upload fields (team photos, short pitch text, video, category, form fields) | Unknown | [Verify on venture.ch] |
| Organisers, categories, prize money, jury phases and finals dates | Unknown. Section 13 of the plan has placeholders for these | [Verify on venture.ch] |
| Eligibility (company age, registered in CH, team size) | Unknown | [Verify on venture.ch] |

## 2. Steps to submit

| # | Action | Due | Done |
|---|---|---|---|
| 1 | Create an account on venture.ch. Read the 2027 rules, the template or guidance, the eligibility criteria and the upload fields. Correct section 1 above. | 16 Nov | ☐ |
| 2 | Check the page limits, page format and any required section order. If venture.ch prescribes a structure, reorder the plan to match it. | 16 Nov | ☐ |
| 3 | Answer every **[Confirm]** item in section 3 below, and write the answers into the `.md` file. | 20 Nov (truth week) | ☐ |
| 4 | Clear every **[Verify]** item, or remove the sentence it belongs to (section 4). | 25 Nov | ☐ |
| 5 | Write the team section: founder bio (80–120 words), and any CTO candidate or advisors you are willing to name. Collect a portrait photo of each person named, with their consent. | 22 Nov | ☐ |
| 6 | Decide the name question for the submission. "DLANG Sports OS (working name)" is used throughout, and "Global Sport OS" is named as the rebrand candidate pending a trademark check. Keep it this way unless the clearance search is already done. | 22 Nov | ☐ |
| 7 | Get the investor's OK on what may be said about the EUR 50k: the name, the terms, and the "released once a CTO is in place" condition. | 24 Nov | ☐ |
| 8 | Have one outside reader (an advisor or the investor) read the PDF for 30 minutes and mark anything unclear or overstated. | 25 Nov | ☐ |
| 9 | Run the final text checks: search for `[Confirm`, `[Verify` and `[Est.]` (an [Est.] label may stay if it is meant). Remove the "Status of this draft" paragraph on the cover. Change the cover date line to "Submitted 27 November 2026". | 26 Nov | ☐ |
| 10 | Re-render the PDF (command below). Check that it is still 10–20 pages and that the tables are not cut. | 26 Nov | ☐ |
| 11 | Upload the PDF and fill in the online form. Save the confirmation e-mail or screenshot as the submission receipt (milestone in Rollout v2, week 2). | **27 Nov** (hard stop 30 Nov) | ☐ |
| 12 | Put the competition dates (jury rounds, coaching, finals) in the calendar. Add to the monthly investor update. | After upload | ☐ |

**Privacy rule for the submission.** Do not include personal data of athletes, parents or coaches. That means no names, no photos of children and no screenshots with real data. Use synthetic demo data only. Name the founder and company, and any team members who have agreed to be named.

## 3. Every [Confirm] placeholder in the plan

| # | Section | Placeholder | What to write |
|---|---|---|---|
| C1 | Cover | UID and date of registration of Swiss Preparatory Sports Academy GmbH | Commercial-register UID (CHE-…) and the entry date |
| C2 | Cover | Actual cash at 30 Nov 2026 | Founder funds or academy cash available to the software business (the model assumes CHF 15,000) |
| C3 | Cover | Contact e-mail and phone for the jury | A business e-mail address |
| C4 | §2.3 | Baseline numbers already measured at DLang | For example admin hours per week, CHF outstanding on a given date, or % paid within 7 days. If none exist, delete the sentence |
| C5 | §3.3 | Which "implemented in code" items are live in production | Stripe Connect and TWINT, CSV import, languages, data-protection tooling |
| C6 | §4.2, §7.1, §7.4 | Second design-partner pilot market and timing | For example France or Germany, and the start month (the plan suggests after May 2027) |
| C7 | §7.3 | Warm access to 30+ Geneva-region clubs | Confirm the number, or soften the wording |
| C8 | §7.4 | Budget for the two free pilots | The plan estimates CHF 5–10k. This cost is not in the financial model |
| C9 | §8.1 | Founder bio | 80–120 words: sport career, years running the academy, education, languages, business experience |
| C10 | §8.1 | Named contractor or CTO candidate | Name and role, or keep anonymous |
| C11 | §8.1 | Advisors | Names and roles, or "being recruited" |
| C12 | §8.2 | Does a fractional CTO, or the paid-reviewer fallback, count as "a CTO in place" for releasing the EUR 50k? | The investor's written answer |
| C13 | §8.4 | Cap table | Founder %, any other holders, the investor's instrument and terms, the CTO grant and vesting, any option pool |
| C14 | §9 | Status of the IP assignment to the GmbH (founder, previous contractors) | Done, or the date it will be done |
| C15 | §10.3 | How January–March 2027 is funded before the EUR 50k is released (the gap is about CHF 45k) | Founder advance, investor advance, or a cost shift |
| C16 | §11.1 | Investor name, if it may be disclosed, and the agreed terms | Name, or "a private investor"; cap, discount and maturity |
| C17 | §12 (risk 12) | Do the academy operations and the software business sit in the same GmbH? | If yes, describe the ring-fence (separate accounts, "SPSA Tech" bank account, an arm's-length customer agreement) or a plan to separate them |

## 4. [Verify] items: check them, or remove the sentence

| # | Section | Item |
|---|---|---|
| V1 | §4.2 | EU club counts (DOSB and national statistics) and a US market-size source. Cite a source, or keep the wording qualitative. |
| V2 | §5.1 | Written legal view that Stripe Connect direct charges keep DLANG outside the anti-money-laundering (financial-intermediary) scope. Requested by 27 Nov in the Rollout. |
| V3 | §6 | Competitor prices. They were verified in August 2026 and must be re-checked. Also check the current state of the US market (PlayMetrics, Stack Sports / SportsEngine, TeamSnap, LeagueApps). |
| V4 | §7.4 | US counsel view on COPPA and state privacy law before any data of US children under 13 is collected. Needed for the pilot, not for the submission. |
| V5 | §11.1 | Convertible terms (Swiss startup lawyer). Check the next FIT Digital window. Check whether Innosuisse instruments fit. |
| V6 | §13 | The organisers, categories, prize amounts, phases and jury dates of >>venture>> 2027. |
| V7 | Appendix A | Legal positions on QR-bill, nFADP, GDPR and COPPA. |

## 5. Where the plan departs from the v2 business pack (founder decisions of 12 Nov 2026)

The jury will read the plan as one story. These four points differ from Business Plan v2 and Rollout v2 on purpose. Make sure they are what you want:

1. **Free design-partner pilots in the USA and one more market in 2027.** v2 said "no free pilots" and "US not before H2 2029". The plan keeps paid entry behind the v2 gates. It limits the pilots to two, time-boxes them, runs them remotely, and starts them only after the Swiss set-up window.
2. **AI assistant offered early as an opt-in.** It stays off by default and is free during the beta, under a DPIA. Paid AI revenue stays in Year 3 of the model.
3. **FIT Digital not applied for.** The plan re-runs the model with the grant at 0% and the EUR 50k arriving in March 2027. The result: cash goes negative from January 2027, and the shortfall is about CHF 10k larger at each year end.
4. **Founder pay lean until about 30 clubs.** The base case in the plan stays the v2 base. The lean-cost variant is quoted as the plan of record for discipline (cash trough about –CHF 324k instead of –451k).

## 6. Re-render after editing

From `docs/company/applications/venture-2027/`:

```
pandoc DLANG_venture_2027_Startup_Plan.md -s --embed-resources --css build/print.css \
  --lua-filter build/pagebreak.lua -o /tmp/venture_plan.html
google-chrome --headless=new --no-pdf-header-footer \
  --print-to-pdf=DLANG_venture_2027_Startup_Plan.pdf file:///tmp/venture_plan.html
pandoc DLANG_venture_2027_Startup_Plan.md --lua-filter build/pagebreak.lua \
  --reference-doc=../../source/DLANG_Sports_OS_Business_Plan.docx -o DLANG_venture_2027_Startup_Plan.docx
```

Check the page count afterwards. The PDF footer shows "Page X of Y".
