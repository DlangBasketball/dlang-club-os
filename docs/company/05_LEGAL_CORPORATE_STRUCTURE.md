# 05 — Legal & Corporate Structure

**DLANG Sports OS** · Version 1.0 · 11 November 2026
**Owner:** founder / CEO. Each item is checked by a Swiss corporate lawyer, a fiduciary/tax adviser and, for the EU and US, local counsel before anyone relies on it.
**Builds on:** Business Plan §10 "Legal, tax and structure" and §8 data-protection controls (Aug 2026), the CTO Partnership Proposal, the Financial Model, the Investor Deck, `09_FOUNDER_PLAN_REVIEW.md`, `03_CTO_TECHNOLOGY_STRATEGY.md` and `04_ORG_DESIGN_AND_HR.md`.

> **Not legal or tax advice.** This document is a planning tool that shows which decisions are needed, in what order, and roughly what they cost. Thresholds, fees and rules change, and they depend on facts only the founder knows. Every item marked **[Counsel]**, **[Tax]** or **[Verify]** must be confirmed by a qualified professional in the relevant jurisdiction (Switzerland, each EU member state, each US state) before anyone acts on it. Figures marked **[Est.]** are planning estimates, not quotes. Figures marked **[Founder]** come from the August 2026 materials.

---

## 1. Decisions at a glance

| # | Decision | Recommendation | Deadline (base / latest) |
|---|---|---|---|
| D1 | Legal form now | **One Swiss GmbH in Canton de Vaud**, with no holding company and no foreign entity. Keep the founder's choice. | Register entry by **31 Dec 2026** / 31 Jan 2027 |
| D2 | AG conversion | Convert the GmbH to an **AG before the first employee equity grant or the seed round**, whichever comes first (likely Q4 2028 to Q1 2029). Do not do it earlier. | Decide at seed term sheet |
| D3 | IP | **Present assignment** of all code, designs and brand from the founder, SIDIS and every contractor **to the GmbH**. No IP may sit with the founder personally. | **31 Dec 2026** (before the convertible closes) |
| D4 | Payments | **Stripe Connect with direct charges** to each club's own connected account, plus a DLANG application fee. DLANG never holds club money. Get a written anti-money-laundering (AML) opinion before the first external club. | Architecture decision and legal view by **27 Nov 2026**. Live on DLang by 18 Dec 2026 / 31 Jan 2027 |
| D5 | Trademark | Run a clearance search first. "DLang" already identifies the D programming language. File in Switzerland (IGE/IPI) and extend through Madrid only when the EUR or US gates come into sight. | Clearance by **15 Jan 2027**. CH filing by 28 Feb 2027 |
| D6 | VAT | Register for Swiss VAT **voluntarily or by the threshold, decided with the fiduciary in Q1 2027**. EU VAT (non-Union OSS plus reverse charge) only at the EUR gate. US sales tax only at the US gate. | Fiduciary decision by **31 Mar 2027** |
| D7 | EU presence | **No EU entity.** Use a GDPR Art. 27 representative, non-Union OSS and an Employer of Record (EoR) for staff when the EUR gate is met (2028). Form a subsidiary only once a country has 3+ staff and recurring revenue. | EUR gate: Q2 2028 at the earliest |
| D8 | US presence | **Not before H2 2029.** At the US gate, form a **Delaware C-Corp subsidiary of the Swiss company**. Model a "flip" only if a US lead investor makes it a term. | US gate review: H2 2029 at the earliest |
| D9 | Insurance | Cyber plus professional liability (E&O) before the first external club's live data. Add D&O when a board with outside members exists. | Bound by **31 Jan 2027** |

---

## 2. Where things stand (11 Nov 2026)

The founder must confirm each of these. The review (`09` §4) treats anything unconfirmed as **not done**.

| Item | Founder plan (Aug 2026) | Status now | Consequence |
|---|---|---|---|
| GmbH in Vaud | Formed W1 (24 Aug), register entry W3 | **Unknown.** No register extract in the materials. | Until it exists, the convertible, contracts, Stripe in the company's name, insurance and FIT Digital (which requires Vaud incorporation) cannot close properly. |
| FIT Digital (CHF 20k) | Deadline 10 Nov 2026, committee 1 Dec 2026 | **Unknown whether filed.** The deadline has passed. | If not filed, set its probability to 0 in the model. If filed, register entry dates start the 6- and 12-month eligibility clocks. |
| IP | "100% founder-owned asset … under SIDIS draft" (deck) | Founder holds it personally. SIDIS agreement in draft. | This is a diligence red flag. Fix it before money comes in (D3). |
| Payments rail | Payrexx favoured for TWINT. Stripe for card. | The repo has Stripe Checkout, one Stripe account, and TWINT only as a manual label. | Gate 2 is not met. There is a fund-holding question until Connect exists (D4). |
| Contract set (§10.4) | Required before club #1 | No drafts found in the materials | Must be ready before the first paid signature (base **31 Jan 2027**). |
| Cyber / E&O insurance | "In place" before club #1 | Unknown | Clubs' committees will ask for it (D9). |
| Data-protection pack (ROPA, DPIA, DPA, breach procedure) | Required before club #1 | Drafting per review W2 | Due **15 Jan 2027** (review action 7). |

**Fallback if the GmbH is not yet formed:** instruct a Vaud fiduciary this week. Formation realistically takes **3–6 weeks** end to end: opening a capital-deposit account at a bank (the slowest step for a new tech company), the notarial deed, then commercial-register publication. The base date is **register entry by 31 Dec 2026**. The downside is **31 Jan 2027**, because the Christmas fortnight closes notaries and banks. Until register entry, the founder signs nothing in the company's name except pre-incorporation acts the notary has structured to transfer to the company **[Counsel]**.

---

## 3. Entity structure

### 3.1 Switzerland: GmbH now, AG later, no holding company yet

The founder's comparison (BP §10.1) is sound and is kept here: GmbH CHF 20,000 capital fully paid in, formation CHF 2,000–4,000. AG CHF 100,000 nominal with CHF 50,000 paid in, formation CHF 4,000–8,000 **[Founder]**.

| Option | For | Against | Verdict |
|---|---|---|---|
| **GmbH (Vaud)** | Lowest capital tied up. Meets FIT Digital. Limited liability. Can take the convertible. | Shareholders and quota holdings are public in the commercial register. Transfers are more formal. Less familiar to foreign investors. Less convenient for employee equity. | **Now** |
| **AG** | Standard for venture investment and employee participation plans. Share register is private. Transfer is easier. Capital band available under the 2023 corporate law reform **[Verify]**. | CHF 50k paid-in capital needed. Higher running cost. Conversion costs "a few thousand francs" (CTO proposal) **[Founder] [Verify]**. | **Before the first employee grant or the seed (Q4 2028 – Q1 2029)**, done as a conversion under the Merger Act (FusG) **[Counsel]** |
| **Founder personal HoldCo above OpCo** | Can help with reinvesting dividends or exit proceeds and with participation relief. | Extra entity, accounts and cost. For a Swiss-resident individual, private capital gains on shares are generally tax-free, so the benefit is often small at this stage **[Tax]**. A later restructuring can trigger tax and blocking-period issues. | **Ask a tax adviser once, before the convertible converts.** Value is lowest now, so if a holding company is ever wanted, set it up now. Default: no. |
| **Group HoldCo with separate IP-Co / OpCo** | Ring-fences IP from operating risk. | Transfer-pricing documentation, two sets of books, and no real benefit while there is one market and pre-revenue. | **No.** Revisit when the US subsidiary is formed. |

**Relationship to DLang Basketball / Swiss Prep Sports Academy.** The founding club is the first customer and the reference case. It must be a **separate legal person** (association, sole trader or company, to be confirmed by the founder, review question 4). It needs a **written subscription agreement on arm's-length terms** with the GmbH, for example the founding-club price of CHF 290 per month **[Founder]**. Without one, the academy's athletes' data and money flow through an unclear structure, and an investor or tax authority could treat academy costs and SaaS costs as commingled **[Tax]**.

**Directors, signatories and residency.** A Swiss GmbH needs at least one managing director resident in Switzerland **[Verify]**. The founder meets this. If a CTO partner joins as a shareholder (Structure A, 20% before the round **[Founder]**), put in a **shareholders' agreement**, signed before or alongside the quota transfer, covering: vesting with reverse vesting and good/bad leaver terms, the CTO's security veto as described in the proposal, drag-along and tag-along, pre-emption, information rights, deadlock, and non-compete or non-solicit to the extent enforceable in Switzerland **[Counsel]**. The convertible investor must be **told about the CTO grant in writing** before signing (review correction 7).

### 3.2 Funding instruments and corporate steps

| Instrument | Founder plan | Updated | Legal points |
|---|---|---|---|
| Pre-seed | EUR 50k (CHF 46.5k) as a **subordinated convertible loan**, cap CHF 418.5k pre-money (= 465k post), 15–20% discount, 18–24 months **[Founder]** | Kept. Sign by **31 Jan 2027**. | Have a Swiss lawyer review the conversion-price definition (2 h, BP §9). Subordination keeps it out of over-indebtedness calculations (CO 725b) **[Counsel]**. Conversion needs a capital increase, which means a notarial deed **[Verify]**. Keep the discount at or below the Swiss safe-harbour level the plan cites. |
| Bridge | Not in plan | **CHF 100–150k by Sep 2027** (downside Jun 2027), same instrument family | Use the same document template to keep legal cost down. Use most-favoured-nation clauses with care. |
| Seed | Not dated | **Q1 2029** | AG conversion, an employee participation plan with a Vaud tax ruling, and full IP and data-room diligence. See `04` §6. |

### 3.3 EU: no entity until there is a reason

The EUR track enters only after its gate (review §5): **at least 10 Swiss clubs, SEPA live, EU VAT set up, a GDPR Art. 27 representative, and DE/FR product and legal texts complete**. Base: first club signed Q2 2028, live Sep 2028. Downside: 2029.

| Stage | Structure | Trigger | Main legal risk |
|---|---|---|---|
| Selling cross-border from CH | Swiss GmbH/AG invoices EU clubs directly. Art. 27 representative appointed. Non-Union OSS registration. | EUR gate met | VAT treatment per customer type (§6). Local consumer and association rules on auto-renewal **[Counsel per country]**. |
| First EU staff | **Employer of Record (EoR)** in the country | First EUR club live, and an AE or CSM is needed (`04`: 2029/2030) | **Permanent-establishment risk:** an EoR salesperson who habitually concludes contracts can create a taxable presence for the Swiss company. Keep contract signature in CH and get advice **[Tax]**. |
| EU subsidiary (e.g. DE GmbH or FR SAS) | Wholly owned by the Swiss company | 3+ staff in one country **and** recurring local revenue, or a large customer or public tender requiring a local contracting party | Transfer pricing (cost-plus service entity), local works-council thresholds (`04` §7) |

EU data residency: the beta runs on one region (`03`). Confirm the hosting region in the DPA and sub-processor list. Switzerland and the EU recognise each other's adequacy, so a Swiss-or-EU hosting region serves both **[Verify]**.

### 3.4 US: Delaware subsidiary vs. flip, and not before the gate

The deck's "worldwide" framing is a vision line, not a plan. The **US gate** (review §5.4) is **not before H2 2029**. It requires at least 40 clubs, CHF 25k+ MRR, net revenue retention of 100%+, a closed seed, and a paying US design partner plus a channel. The Swiss wedge (TWINT, QR-bill, the Romandie network) does not carry over to the US. The US market is held by consolidating incumbents and carries COPPA, state privacy laws and state sales tax. Setting up a US entity before then would be cost without revenue.

| Option | How it works | Fundraising effect | Cost and complexity | When it makes sense |
|---|---|---|---|---|
| **No entity** (sell from CH) | Swiss company contracts directly with US customers | Neutral | Lowest. But US customers and payment processors may prefer a US counterparty. Sales-tax nexus still applies (§6.3). | One or two US design partners, pre-gate |
| **Delaware C-Corp subsidiary** (CH parent owns US sub) | US sub sells and employs. Intercompany licence or services agreement with the Swiss parent. | Fine for Swiss and European investors. **Some US VCs will not invest in a non-US parent.** | Moderate: registered agent, Delaware franchise tax, federal and state returns, transfer-pricing documentation **[Tax]** | **Default at the US gate** |
| **"Flip"** (new Delaware parent; Swiss company becomes a subsidiary through a share exchange) | Shareholders swap Swiss shares for Delaware shares | Preferred by many US institutional seed and Series A investors. Uses US-standard option plans. | High. Swiss tax consequences for the founder and the company (possible taxation on the transfer, loss of Swiss tax-free capital-gain treatment, IP migration and exit-tax questions), plus restructuring of the Swiss ESOP **[Tax] [Counsel]**. Expensive to undo. | **Only** if a US lead investor makes it a condition of a round large enough to justify it. Model it then. Never do it pre-emptively. |

If a US subsidiary is formed, keep the **IP in the Swiss parent** and license it to the US sub. Moving IP out of Switzerland later can be a taxable event **[Tax]**.

---

## 4. Intellectual property

### 4.1 Assignment: the first fix

Swiss law gives the employer the rights to software that **employees** write in the course of their duties (URG Art. 17) **[Verify]**. It does **not** do this for **contractors, agencies or the founder acting before incorporation**. Their work stays with the author unless it is assigned in writing.

| Contributor | Instrument | Must include | Deadline |
|---|---|---|---|
| Founder (pre-incorporation work, prototype `club-os-v1-prototype.html`, repo, brand, domain names) | **IP contribution / assignment agreement** to the GmbH, or a contribution in kind at formation (notarial, valuation needed) **[Counsel]** | Present assignment ("hereby assigns") of copyright, database rights, designs, domain names and know-how. Waiver of moral-right exercise to the extent Swiss law permits. Founder warranty about third-party code. | At incorporation, latest **31 Dec 2026** |
| SIDIS (development partner, draft agreement) | **Sign the development agreement with a present assignment to the GmbH**, not to the founder | Assignment on creation (not on payment), source-code delivery, no retained licence beyond what is agreed, open-source disclosure, confidentiality, warranty of originality | **31 Dec 2026** |
| CTO partner (trial and Structure A) | **Contractor agreement with IP assignment** for the 5-week paid trial (CHF 9–11k **[Founder]**), then a shareholders' agreement plus a service or employment contract | Assignment of all trial output whether or not the partnership proceeds | Before the trial starts |
| Freelancers, designers, translators, pen-testers | Short-form **contractor IP and confidentiality agreement** (one template) | Assignment, confidentiality, data-processing clause where they touch personal data | Before any work starts |
| Future employees | Swiss employment contract with an IP and inventions clause (CO Art. 332) plus confidentiality | Covers inventions and designs, not only software | At hire |

**AI-assisted code.** Much of the repo was produced with AI coding agents under the founder's accounts. Copyright protection for purely machine-generated output is uncertain in Switzerland, the EU and the US **[Counsel]**. Mitigations:

1. Keep the company's rights through **contract and trade secret** as well as copyright: confidential repo, access control, NDAs.
2. Document human direction, review and selection (the commit history helps).
3. Confirm the tool providers' terms give output ownership to the user and include no restrictive licence.
4. Run an **open-source licence scan** of the dependency tree once before the convertible closes (BP §10.3). Copyleft dependencies in a commercial SaaS should be identified now.

### 4.2 Trademark strategy

**Clearance risk:** "DLang" / "D Lang" is the established name of the **D programming language** (dlang.org). A Class 9 (software) filing for "DLANG" may face conflicts or weak distinctiveness. A Class 41/42 filing for sports-club software is a different field, but this must be searched before money is spent on branding. "DLang Basketball" may also be a separate brand owned by the academy entity, so decide which entity owns which mark.

| Step | Office | Classes (Nice) **[Counsel]** | Est. official fee **[Est.] [Verify]** | When |
|---|---|---|---|---|
| 1. Clearance search (CH, EU, US, plus Google and app stores) | Attorney or IGE assisted search | 9, 35, 41, 42 | CHF 500–1,500 with attorney | **By 15 Jan 2027** |
| 2. Swiss application, word mark (plus logo later) | **IGE/IPI** | 42 (SaaS) and 9 core; 41 if offering sports-organisation services | Around CHF 550 for up to 3 classes, plus attorney time | **By 28 Feb 2027** |
| 3. Extension through the **Madrid Protocol** (WIPO) using the Swiss base mark | Designate EU (**EUIPO**) | Same | EU designation fees per class, in the high hundreds of CHF/EUR | Within the 6-month priority window if the EUR gate is likely within 12 months. Otherwise at the EUR gate (2028). |
| 4. United States | Designate the US through Madrid, or file directly with the **USPTO** | Same, with a stricter specification of goods and services | Several hundred USD per class plus US counsel | At the US gate (2029+). A US filing needs use, or a bona fide intent to use. |

Also: register core domains in the GmbH's name (not the founder's), secure social handles, and record ownership of the logo and design system through the assignments above.

---

## 5. Contract stack

Governing law: **Swiss law, venue Lausanne** for all Swiss and EU B2B contracts until EU counsel advises otherwise. US contracts come at the US gate, under US-law paper.

| Document | Purpose | Key positions | Needed by |
|---|---|---|---|
| **Master Subscription Agreement / Terms of Service** (club-facing) | The commercial contract | Month-to-month for founding clubs, annual for others. Prices exclude VAT, with the VAT-inclusive figure stated. Liability cap = 12 months' fees. Exclusion of indirect loss. Data export on exit (the anti-lock-in promise). Suspension for non-payment. Acceptable use. | **First paid signature, 31 Jan 2027** (downside 31 Mar 2027) |
| **Founding Club Addendum** | Lifetime price lock at CHF 290, 24-month founder access, 60-day refund, roadmap voting **[Founder]** | Define "lifetime" (for the life of the product and the club's continuous subscription, non-transferable). Cap tier and athlete-count growth (otherwise a 400-athlete academy pays CHF 290 forever). | Same. Never agreed by email (BP §10.4). |
| **Data Processing Agreement (DPA)** | Club = controller, DLANG = processor. nFADP plus GDPR Art. 28. | Sub-processor list (hosting, email, payments, any AI provider). Swiss addendum to the EU Standard Contractual Clauses for transfers outside CH/EU. Breach notice within 48–72 h of discovery. Audit by questionnaire. | Same |
| **Parent/athlete privacy notice** (FR, DE, IT, EN) | Transparency for data subjects, including minors | Medical fields, photos, retention, under-16 rule (one rule, BP §8), AI off by default (`03`) | Same |
| **Service Level Agreement** | Beta: **best-effort** with published support hours. Paid tiers: availability target. | Do not promise 99.9% before monitoring and on-call exist. Use service credits, not damages. | Beta: simple support policy. Formal SLA from club 10 (Oct 2027). |
| **Payments terms** (club ↔ payment provider, accepted through Connect onboarding) | The club contracts with the payment provider. DLANG is the platform. | DLANG's application fee is disclosed. Refunds and chargebacks are the club's. | Before TWINT goes live on DLang |
| **Contractor IP and NDA template** | §4.1 | — | Now |
| **Shareholders' agreement** | Founder, CTO and investors | §3.1 | Before any equity grant |
| **Convertible loan agreement** | Pre-seed | §3.2 | 31 Jan 2027 |
| **Related-party subscription** (academy ↔ GmbH) | Arm's-length terms | §3.1 | 31 Dec 2026 |
| **Reseller / white-label partner agreement** | Federations, agencies or resellers rebranding the platform | Territory, branding licence (partner marks on DLANG platform), who is controller or processor (often the partner becomes a processor and DLANG a sub-processor), first-line support split, minimum commitments, revenue share, no sublicensing of source, termination data handover | **Not before 2029.** Entry gate (review): 25+ clubs on one codebase, an external pen test, and a staffable support SLA. A federation or multi-site **pilot** (H2 2028) uses a simple MSA plus a pilot addendum. |
| **Website terms, cookie notice, AUP** | Public site and registration pages | — | Before public launch of register pages |
| **Security / trust pack** (questionnaire answers, policy summary) | Sales enablement | Say "nFADP-aligned by design … independent audit scheduled", not "compliant" (BP §8) | 15 Jan 2027 |

**Budget [Est.]:** a Swiss startup lawyer producing the MSA, Addendum, DPA, privacy notice and contractor template from good precedents costs roughly **CHF 6,000–12,000**. The shareholders' agreement plus convertible review costs another **CHF 3,000–8,000**. Ask for fixed-fee quotes. Startup programmes and >>venture>> partner firms sometimes offer reduced rates **[Verify]**.

---

## 6. VAT and sales tax on SaaS

### 6.1 Switzerland (MWST/TVA/IVA)

| Point | Position **[Tax] [Verify]** | Decision |
|---|---|---|
| Rate | 8.1% standard **[Founder]** | — |
| Mandatory registration | Once **worldwide turnover from taxable supplies reaches CHF 100,000** within 12 months **[Founder]**. In the re-baselined base case that is late 2028; it is not Year 2 as the model says. | Track monthly. Register in advance, not retrospectively. |
| Voluntary registration | Allowed below the threshold. Recovers input VAT on costs (hosting, contractors, legal). | The **cost** is that most clubs cannot reclaim VAT, so CHF 490 effectively becomes CHF 529.70 (review). Decide with the fiduciary **by 31 Mar 2027**, using real cost and price data. Lean: stay unregistered while revenue is small and costs are mostly foreign B2B services. Note that imported services from abroad can create **reverse-charge (acquisition tax) liability above CHF 10,000 a year even when not registered** **[Verify]**. |
| Simplified method | Net tax rate method (Saldosteuersatz) for small businesses **[Founder]** | Ask at registration |
| Invoices | QR-bill for DLANG's own invoices to clubs. Keep the QR-bill implementation current with the version change noted in the review (in force 14 Nov 2026) **[Verify]**. | Engineering task in W1–W2 |

### 6.2 EU (EUR track, 2028+)

| Customer | Treatment **[Tax] [Verify per country]** | Mechanism |
|---|---|---|
| VAT-registered business or association (B2B) | Place of supply is the customer's country. **Reverse charge**: DLANG invoices without VAT and quotes the customer's VAT ID. | Validate VAT IDs (VIES). Store evidence. |
| Non-registered club or association (treated as B2C for VAT) | SaaS is an electronically supplied service, taxed **at the customer's country rate**. A non-EU supplier has no small-seller threshold. | Register for the **non-Union OSS** in one member state. File quarterly. Collect two pieces of location evidence. |

This matters because many small clubs are not VAT-registered, so a large share of EU clubs will fall into the OSS case. Set up OSS before the first EU invoice. It is a one-time job of weeks, but it needs billing-system support for per-country rates. Stripe Tax or equivalent can compute rates, but **DLANG remains liable** for the returns.

### 6.3 United States (2029+)

- There is no federal sales tax. Each state decides whether SaaS is taxable. Some states tax it, some exempt it, and some tax part of it **[Verify per state]**.
- **Economic nexus** (after *Wayfair*) is triggered by sales into a state above that state's threshold, commonly USD 100,000 of sales or a number of transactions. A foreign seller can have nexus with **no US entity** **[Verify]**.
- A US subsidiary with staff also creates physical nexus where they work, plus US federal and state income-tax filing.
- Action at the US gate: a nexus study with a US sales-tax adviser, registration only where required, tax-exempt certificates from schools and non-profits stored in billing.

### 6.4 Corporate income tax (CH)

Vaud combined profit tax for a GmbH is roughly in the mid-teens percent range **[Est.] [Tax]**. With losses expected until about 2029 (review: break-even Q2 2029 base), **carry losses forward** (7 years in Switzerland **[Verify]**) and keep clean books from day one. Swiss R&D super-deductions and the patent box are cantonal options. Ask the fiduciary whether Vaud's R&D deduction applies to the engineering spend **[Tax]**.

---

## 7. Payments licensing: why Stripe Connect

**The problem.** If DLANG collects parents' payments into **its own** Stripe account and then pays clubs, DLANG holds third-party funds. Under the Swiss Anti-Money Laundering Act, accepting or holding assets belonging to others, or helping to transfer them, can make a company a **financial intermediary**. That requires affiliation with a self-regulatory organisation (SRO), KYC procedures and audits **[Counsel]**. In the EU, the equivalent activity can require payment-institution authorisation under PSD2 unless an exemption applies **[Counsel]**. Today the repo has **one Stripe account**, so this exposure would exist as soon as an external club collects through it.

**The fix.**

| Design | Who holds the money | DLANG regulatory exposure | Fit |
|---|---|---|---|
| Single DLANG account, pay clubs out | DLANG | **High.** Likely financial intermediation. | **Do not use for external clubs.** |
| **Stripe Connect, direct charges** on each club's connected account, plus an **application fee** to DLANG | **The club** (Stripe is the regulated payment provider; funds settle to the club's account) | **Low.** DLANG is a software platform that receives its own fee. Confirm with counsel. | **Recommended.** Matches the multi-tenant `org_id` model. |
| Payrexx / Datatrans per club (club's own merchant account), DLANG integrates through API | The club | Low | Valid alternative. Better TWINT margin per the founder (about 1.3% vs Stripe 1.9% + CHF 0.30 **[Founder]**), but a second integration. Decision by 27 Nov 2026 (review action 3). |

**Conditions to keep it clean [Counsel]:**

- Each club passes the payment provider's own KYC. Associations need statutes and committee documents, so allow days per club in onboarding.
- DLANG never sets up payouts to a DLANG-controlled bank account on a club's behalf.
- Refunds and chargebacks are processed on the club's account.
- The DLang academy's own collections run on **its own** connected account, not the GmbH's.
- Get a **written legal opinion** (fixed fee, roughly CHF 1,500–4,000 **[Est.]**) before the first external club goes live, and store it in the data room.
- Payment margin: on Stripe TWINT the model's 0.9% margin is roughly zero (review correction 6). Decide the application-fee level knowing that.

---

## 8. Data protection (summary; full controls in BP §8)

| Regime | When it applies | Must-haves | Owner / date |
|---|---|---|---|
| **Swiss nFADP** (in force since Sep 2023) | Now | ROPA, DPIA (minors, medical fields, AI), DPA template, breach procedure (notify the FDPIC where the risk is high), consent records, export and erasure | Founder + data-protection adviser, **15 Jan 2027** |
| **GDPR** | Offering services to EU clubs or monitoring EU residents | **Art. 27 EU representative** (a service, about a few hundred to low thousands EUR a year **[Est.]**), Art. 28 DPA, transfer mechanism | At the EUR gate (2028) |
| **COPPA and US state privacy laws** | US, children under 13, state thresholds | Verifiable parental consent flows, school-context rules | US gate (2029+) |

Personal liability: nFADP fines (up to CHF 250,000) fall on the **responsible individual**, not the company **[Founder]**. Incorporation does not remove that risk. The controls do.

---

## 9. Insurance

| Cover | Why | When | Indicative premium **[Est.] [Verify with a broker]** |
|---|---|---|---|
| **Cyber** (incident response, data restoration, third-party privacy claims, possibly regulatory costs where insurable) | Minors' data and payments metadata across clubs | Bound **by 31 Jan 2027**, before the first external club's live data | Low four figures CHF a year at this size. Insurers will ask about MFA, backups and the pen test. |
| **Professional liability / Tech E&O** | Software failure causing a club loss (missed invoices, wrong reconciliation) | Same | Often bundled with cyber. Low four figures CHF a year. |
| General / business liability | Events, demos, premises | At incorporation | Hundreds of CHF a year |
| **D&O** | Investors or an outside board member join, or after the seed | Seed (Q1 2029) or on the first outside director | Low four figures CHF a year |
| Employee covers (UVG accident, BVG pension, KTG daily sickness) | Mandatory or near-mandatory for employees | First employee (Q1–Q2 2029) | See `04` §5 (1.17 × gross) |

Set the MSA liability cap (12 months' fees) at or below insured limits. Use a broker, not direct purchase.

---

## 10. Launch legal checklist (re-baselined from 11 Nov 2026)

Owners: **F** = founder, **L** = Swiss lawyer, **FT** = fiduciary/tax adviser, **E** = engineering (CTO partner or contractor plus reviewer), **B** = insurance broker. Dates are **base / downside**.

### Phase 0: Switzerland foundations (now → Feb 2027)

| # | Item | Owner | Base | Downside | Done when |
|---|---|---|---|---|---|
| 1 | Confirm status of GmbH, FIT, round, SIDIS and insurance (review action 1) | F | 20 Nov 2026 | 20 Nov 2026 | Written status note |
| 2 | Payment-architecture decision plus written AML/fund-holding view | F, E, L | 27 Nov 2026 | 11 Dec 2026 | Decision memo plus counsel email or opinion |
| 3 | GmbH formed in Vaud (if not done): capital deposit, deed, register | F, FT, notary | 31 Dec 2026 | 31 Jan 2027 | Register extract |
| 4 | Business bank account; Stripe platform account in the GmbH's name | F | 31 Dec 2026 | 31 Jan 2027 | Accounts live |
| 5 | IP assignments: founder → GmbH, SIDIS signed with present assignment, contractor template | F, L | 31 Dec 2026 | 31 Jan 2027 | Signed copies in data room |
| 6 | Related-party subscription (academy ↔ GmbH) | F, L | 31 Dec 2026 | 31 Jan 2027 | Signed |
| 7 | Open-source licence scan | E | 15 Jan 2027 | 31 Jan 2027 | Report, no unresolved copyleft |
| 8 | Trademark clearance search | L | 15 Jan 2027 | 15 Feb 2027 | Go/no-go on "DLANG" as a mark |
| 9 | Compliance pack: ROPA, DPIA, DPA, privacy notice (FR/EN first, DE/IT next), breach procedure | F, L | 15 Jan 2027 | 15 Feb 2027 | Documents approved |
| 10 | MSA, Founding Club Addendum, support policy | L | 15 Jan 2027 | 15 Feb 2027 | Templates final |
| 11 | External security review booked (4 Dec) and completed | E | 31 Jan 2027 | 28 Feb 2027 | Report, criticals fixed |
| 12 | Cyber plus E&O bound | B | 31 Jan 2027 | 28 Feb 2027 | Policy schedule |
| 13 | Convertible loan signed (CTO grant disclosed); shareholders' agreement if CTO joins | F, L | 31 Jan 2027 | 31 Mar 2027 | Signed, funds received |
| 14 | Swiss trademark filed | L | 28 Feb 2027 | 31 Mar 2027 | IGE filing receipt |
| 15 | VAT decision (voluntary or threshold); bookkeeping set up | FT | 31 Mar 2027 | 30 Apr 2027 | Memo; registered if decided |

**First paid external signature (31 Jan / 31 Mar 2027) cannot happen before items 2, 3, 5, 9, 10 and 12 are done.** If they slip, the signature slips with them. A signature without them is worse than a late signature.

### Phase 1: Swiss scale (2027 → 2028)

| Item | Owner | Base | Downside |
|---|---|---|---|
| Formal SLA and trust page at 10 clubs | F, E | Oct 2027 | Mar 2028 |
| Bridge round papers (same template) | F, L | Sep 2027 | Jun 2027 (earlier if cash forces it) |
| Mandatory VAT registration check at the CHF 100k trailing turnover | FT | Late 2028 | 2029 |
| Annual DPIA and sub-processor review; second pen test | E | Each Q1 | — |

### Phase 2: EUR track (gate: 10+ CH clubs; signed Q2 2028 / 2029)

| Item | Owner | Lead time **[Est.]** |
|---|---|---|
| Art. 27 GDPR representative appointed | F | 2–4 weeks |
| Non-Union OSS registration; billing per-country VAT; VIES checks | FT, E | 4–8 weeks |
| DE/FR (and AT/BE as needed) MSA, DPA and privacy notice localised and checked by local counsel | L + local counsel | 6–10 weeks |
| SEPA Direct Debit via the payment provider | E | 2–4 weeks |
| EU trademark (Madrid designation or EUIPO) | L | Filing within days; registration takes months |
| EoR provider contract for the first EU hire; PE-risk check | F, FT | 4–8 weeks |

### Phase 3: US (gate: H2 2029 at the earliest) and white-label resale (gate: 2029 at the earliest)

| Item | Owner | Notes |
|---|---|---|
| Delaware C-Corp subsidiary, registered agent, EIN, US bank | L (US) | Only after the US gate. Flip analysis only if a US lead investor requires it. |
| Intercompany licence and transfer-pricing memo | FT | IP stays in the Swiss parent |
| Sales-tax nexus study; state registrations | US tax adviser | Before the first US invoice above thresholds |
| COPPA and state-privacy review; US MSA/DPA | US counsel | Under-13 consent flows |
| USPTO application | L (US) | Clearance first |
| Reseller / white-label partner agreement template | L | Gate: 25+ clubs, external pen test, staffable SLA |

---

## 11. Legal budget, first 12 months [Est.]

| Item | CHF (range) |
|---|---|
| GmbH formation (if not done), incl. notary and register | 2,000–4,000 **[Founder]** |
| Share capital (paid in, remains company cash) | 20,000 **[Founder]** |
| Contract stack (MSA, Addendum, DPA, privacy notice, contractor template) | 6,000–12,000 |
| Convertible review plus shareholders' agreement | 3,000–8,000 |
| AML / payments legal view | 1,500–4,000 |
| Trademark clearance plus Swiss filing | 1,500–3,000 |
| Data-protection adviser (DPIA and ROPA review) | 2,000–5,000 |
| Cyber plus E&O insurance (annual) | 1,500–4,000 |
| Fiduciary (books, VAT decision, annual accounts) | 3,000–4,800 (CHF 250–400 a month **[Founder]**, per `04`) |
| **Total cash outside share capital** | **about 20,000–45,000** |

The founder model does not carry this as a separate line. Add it in the 3 Jan 2027 model refresh (review action 13). If cash is tight, use the order of §10 Phase 0. Payments/AML, IP and the contract stack come before trademark and insurance, but **insurance must still be bound before external live data**.

---

## 12. Items requiring professional validation

| Topic | Who |
|---|---|
| Pre-incorporation acts; contribution in kind of founder IP vs. post-formation assignment | Swiss corporate lawyer, notary |
| Fund-holding / AML status under Stripe Connect or Payrexx; PSD2 position for EU clubs | Swiss financial-regulatory lawyer; EU counsel at the EUR gate |
| Convertible conversion-price definition; subordination; safe-harbour discount | Swiss startup lawyer |
| Personal holding company question; GmbH→AG timing; ESOP tax ruling | Tax adviser, Vaud tax administration |
| Voluntary VAT registration; acquisition-tax exposure on imported services | Fiduciary |
| EU OSS and B2B/B2C classification of clubs per country | EU VAT adviser |
| US entity form, flip consequences, nexus | US counsel, US sales-tax adviser, Swiss tax adviser together |
| Trademark clearance (D programming language conflict) | IP attorney |
| AI-generated code ownership; open-source obligations | IP/technology lawyer |
| Insurance limits vs. MSA liability cap | Broker plus lawyer |

---

## 13. Changes vs. founder's August 2026 plan

| Topic | Founder plan (Aug 2026) | Updated (11 Nov 2026) | Why |
|---|---|---|---|
| Entity | GmbH in Vaud, formed W1 (24 Aug), register W3 | GmbH in Vaud kept. Status unconfirmed. **Register entry by 31 Dec 2026 / 31 Jan 2027.** | Sound choice. The timeline was missed or is unknown. The Christmas closure lengthens formation. |
| AG | Mentioned only as a requirement for angel syndication | **Convert before the first employee grant or the seed (Q4 2028 – Q1 2029)** | AG is the standard for ESOP and VC. Converting earlier wastes CHF 30k+ of tied-up capital. |
| Holding structure | Not addressed | No HoldCo by default. One tax-adviser check before the convertible converts. | Value is lowest now, so if a holding is ever wanted, set it up now. Otherwise unnecessary. |
| IP | "Founder-owned under SIDIS draft" (deck); BP §10.3 says assign to the company | **Present assignment to the GmbH by 31 Dec 2026**, SIDIS signed. AI-assisted code risk addressed. | IP held personally under a draft is a diligence red flag. Contractors' work is not assigned automatically under Swiss law. |
| Trademark | "Register in Switzerland at minimum" | **Clearance first** (D-language conflict), CH by 28 Feb 2027, EU at the EUR gate, US at the US gate, all through Madrid | Avoid paying to file a mark that may be blocked. Sequence filings with the market gates. |
| Payments | Payrexx for TWINT (beta); Stripe card. No fund-flow design. | **Stripe Connect direct charges (or per-club Payrexx), written AML view by 27 Nov 2026** | The current single-account repo would make DLANG hold club money, which raises financial-intermediary risk. |
| Contracts | Six documents before club #1 (BP §10.4) | Same core set, plus Founding Addendum guardrails (tier cap), related-party agreement, SLA staging and **reseller agreement deferred to 2029+** | An uncapped "lifetime" price is a long-term liability. White-label resale is behind a gate. |
| Swiss VAT | Threshold crossed in Year 2 | Threshold likely **late 2028** on the re-baselined base case. **Voluntary-registration decision by 31 Mar 2027.** Acquisition-tax check on imported services. | Revenue has slipped about one quarter or more. Registration cuts clubs' effective price by 8.1%, and that trade-off needs real numbers. |
| EU | Reverse charge "generally applies", confirm per country | Non-Union OSS for non-registered clubs, reverse charge for B2B, Art. 27 representative. **Only at the EUR gate (Q2 2028 / 2029).** | Many clubs are not VAT-registered and fall under OSS. The founder's B2B-only framing was incomplete. |
| US | Deck: "worldwide", US statistics | **Not before H2 2029.** Delaware subsidiary by default. Flip only if a lead investor requires it. Nexus, COPPA. | The Swiss wedge does not carry over. Incumbent market. Capacity and capital are too small. A flip is costly and hard to reverse. |
| Insurance | "In place" before club #1 | Cyber plus E&O bound by **31 Jan 2027**. D&O at the seed. | Same intent, now dated and ordered. |
| Data protection | Controls listed; "nFADP-aligned" language | Kept. Pack due **15 Jan 2027**. GDPR/COPPA tied to the market gates. | The founder's discipline is right. It needed dates. |
| Legal budget | Not modelled as a line | **About CHF 20–45k** in the first 12 months [Est.] | Unbudgeted legal cost is a common cause of cash surprises. Add it at the 3 Jan 2027 model refresh. |
| First paid signature | Red line 30 Nov 2026 | **31 Jan 2027 / 31 Mar 2027**, and only after the legal prerequisites in §10 | Signing without the entity, IP, DPA and payment design creates liabilities that cost more than the delay. |
