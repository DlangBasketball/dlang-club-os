# 05 — Legal & Corporate Structure

**DLANG Sports OS** · Version 1.1 · 11 November 2026, updated 12 November 2026 with the founder's decisions (`11_FOUNDER_DECISIONS_2026-11-12.md`)
**Owner:** founder / CEO. Each item is checked by a Swiss corporate lawyer, a fiduciary/tax adviser and, for the EU and US, local counsel before anyone relies on it.
**Builds on:** Business Plan §10 "Legal, tax and structure" and §8 data-protection controls (Aug 2026), the CTO Partnership Proposal, the Financial Model, the Investor Deck, `09_FOUNDER_PLAN_REVIEW.md`, `03_CTO_TECHNOLOGY_STRATEGY.md` and `04_ORG_DESIGN_AND_HR.md`.

> **Not legal or tax advice.** This document is a planning tool that shows which decisions are needed, in what order, and roughly what they cost. Thresholds, fees and rules change, and they depend on facts only the founder knows. Every item marked **[Counsel]**, **[Tax]** or **[Verify]** must be confirmed by a qualified professional in the relevant jurisdiction (Switzerland, each EU member state, each US state) before anyone acts on it. Figures marked **[Est.]** are planning estimates, not quotes. Figures marked **[Founder]** come from the August 2026 materials.

---

## 1. Decisions at a glance

| # | Decision | Recommendation | Deadline (base / latest) |
|---|---|---|---|
| D1 | Legal form now | **The company is Swiss Preparatory Sports Academy GmbH (SPSA), Vaud** [Founder, 12 Nov 2026; Confirm register number (CHE-…), register date, purpose clause and shareholders]. Bank account for the software business: "SPSA Tech". No holding company and no foreign entity. | Register details on file by **20 Nov 2026** |
| D2 | AG conversion | Convert the GmbH to an **AG before the first employee equity grant or the seed round**, whichever comes first (likely Q4 2028 to Q1 2029). Do not do it earlier. | Decide at seed term sheet |
| D3 | IP | **Present assignment** of all code, designs and brand from the founder, SIDIS and every contractor **to the GmbH**. No IP may sit with the founder personally. | **31 Dec 2026** (before the convertible closes) |
| D4 | Payments | **Stripe Connect accepted by the founder (12 Nov 2026)**: direct charges to each club's own connected account, plus an application fee. The platform never holds club money. DLang connects first (`docs/ops/STRIPE_CONNECT_TWINT_SETUP.md`). Written anti-money-laundering (AML) opinion still needed before the first external club; confirm with Stripe how SPSA can be both platform and DLang's account **[Verify]** | Connect application 27 Nov 2026; AML view 15 Jan 2027. Live on DLang by 18 Dec 2026 / 31 Jan 2027 |
| D5 | Trademark | Founder's master-brand candidate is **"Global Sport OS"**; each club runs the product under its own name (e.g. "DLang OS"). Generic names are hard to register: run a **CH / EU / US trademark and domain check** on it plus **2–3 alternatives** by 15 Jan 2027. "DLANG Sports OS" stays the working name until then ("DLang" also identifies the D programming language). File in Switzerland (IGE/IPI) first; extend through Madrid at the paid EUR or US gates. | Check by **15 Jan 2027**; decision 15 Feb; CH filing by 28 Feb 2027 |
| D6 | VAT | Register for Swiss VAT **voluntarily or by the threshold, decided with the fiduciary in Q1 2027**. EU VAT (non-Union OSS plus reverse charge) only at the EUR gate. US sales tax only at the US gate. | Fiduciary decision by **31 Mar 2027** |
| D7 | EU presence | **No EU entity.** For the **free EU design-partner pilot (live Sep 2027 / Jan 2028)** appoint a GDPR Art. 27 representative and sign an EU-language DPA; contract from SPSA. Non-Union OSS and an Employer of Record (EoR) only at the paid EUR gate. Form a subsidiary only once a country has 3+ staff and recurring revenue. | Art. 27 representative before the EU pilot goes live; paid EUR gate Q2 2028 (early 2028 on a strong pilot) |
| D8 | US presence | **No US entity for the free US design-partner pilot (live Sep–Oct 2027 / Mar 2028)** [Verify with US counsel]; COPPA verifiable parental consent before any under-13 data; cross-border Stripe Connect confirmed **[Verify]**. At the paid US gate (not before H2 2029), form a **Delaware C-Corp subsidiary of the Swiss company**. Model a "flip" only if a US lead investor makes it a term. | US counsel memo by 31 May 2027; paid US gate review H2 2029 at the earliest |
| D1b | Academy and software in one entity (new, 12 Nov) | SPSA also runs the academy (customer zero). Ring-fence now (separate "SPSA Tech" account and bookkeeping segment, internal service agreement, IP held for the software business), and get a lawyer/fiduciary view on **carving the software business into its own GmbH** (sister or subsidiary) before the seed, or before the convertible if the investor or lawyer requires it **[Counsel] [Tax]** | View by **15 Dec 2026** |
| D9 | Insurance | Cyber plus professional liability (E&O) before the first external club's live data. Add D&O when a board with outside members exists. | Bound by **31 Jan 2027** |

---

## 2. Where things stand (11 Nov 2026)

The founder answered the main items on 12 Nov 2026 (`11_FOUNDER_DECISIONS_2026-11-12.md`). Anything still unconfirmed is treated as **not done**.

| Item | Founder plan (Aug 2026) | Status now | Consequence |
|---|---|---|---|
| GmbH in Vaud | Formed W1 (24 Aug), register entry W3 | **Exists: Swiss Preparatory Sports Academy GmbH (SPSA)** [Founder, 12 Nov]. Register number and date [Confirm]. Bank account "SPSA Tech". | The convertible, contracts, Stripe and insurance go in SPSA's name. The academy and the software business share one entity (D1b). |
| FIT Digital (CHF 20k) | Deadline 10 Nov 2026, committee 1 Dec 2026 | **Not filed** [Founder, 12 Nov]. Application pack being prepared (`applications/fit-digital/`). | Modelled at 0%. **Eligibility may be blocked**: the Grant is described as open to companies entered in the register no more than 6 months ago (12 months for the Seed loan) [Verify on fondation-fit.ch]. If SPSA is older, FIT may require a new, carved-out GmbH (D1b). |
| IP | "100% founder-owned asset … under SIDIS draft" (deck) | Founder holds it personally. SIDIS agreement in draft. | This is a diligence red flag. Fix it before money comes in (D3). |
| Payments rail | Payrexx favoured for TWINT. Stripe for card. | **Stripe Connect accepted** [Founder, 12 Nov]. The repo still has one Stripe account and TWINT only as a manual label. | Gate 2 not met until Connect is live for DLang (D4). |
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

**Update 12 Nov 2026: the company is the academy's own GmbH.** The founder confirmed the company is Swiss Preparatory Sports Academy GmbH. If the academy (DLang Basketball) is operated by the same GmbH, the paragraph below cannot be met as written: customer zero and the vendor are one legal person. Until a decision on a carve-out (D1b, view by 15 Dec 2026), keep the software business ring-fenced ("SPSA Tech" account, separate cost centre, internal agreement recording what the academy would pay, IP register for the software) and tell the investor plainly what the EUR 50k buys into **[Counsel] [Tax]**.

**Relationship to DLang Basketball / Swiss Prep Sports Academy (original recommendation).** The founding club is the first customer and the reference case. It must be a **separate legal person** (association, sole trader or company, to be confirmed by the founder, review question 4). It needs a **written subscription agreement on arm's-length terms** with the GmbH, for example the founding-club price of CHF 290 per month **[Founder]**. Without one, the academy's athletes' data and money flow through an unclear structure, and an investor or tax authority could treat academy costs and SaaS costs as commingled **[Tax]**.

**Directors, signatories and residency.** A Swiss GmbH needs at least one managing director resident in Switzerland **[Verify]**. The founder meets this. If the fractional CTO takes equity (the CTO proposes the structure by 8 Jan 2027; Structure A's 20% before the round **[Founder]** is one option), put in a **shareholders' agreement**, signed before or alongside the quota transfer, covering: vesting with reverse vesting and good/bad leaver terms, the CTO's security veto as described in the proposal, drag-along and tag-along, pre-emption, information rights, deadlock, and non-compete or non-solicit to the extent enforceable in Switzerland **[Counsel]**. The convertible investor must be **told about the CTO grant in writing** before signing (review correction 7).

### 3.2 Funding instruments and corporate steps

| Instrument | Founder plan | Updated | Legal points |
|---|---|---|---|
| Pre-seed | EUR 50k (CHF 46.5k) as a **subordinated convertible loan**, cap CHF 418.5k pre-money (= 465k post), 15–20% discount, 18–24 months **[Founder]** | **Secured; released once a CTO is in place** [Founder, 12 Nov]. Sign by **31 Jan 2027**; cash assumed Mar 2027. Write down the release condition (what counts as "a CTO in place") by 27 Nov 2026. | Have a Swiss lawyer review the conversion-price definition (2 h, BP §9). Subordination keeps it out of over-indebtedness calculations (CO 725b) **[Counsel]**. Conversion needs a capital increase, which means a notarial deed **[Verify]**. Keep the discount at or below the Swiss safe-harbour level the plan cites. |
| Bridge | Not in plan | **Jan–Mar 2027 bridge of about CHF 45k** (agreed by 15 Dec 2026), then a **pre-seed of about CHF 250–300k in total, including the EUR 50k, in H1 2027** (cash in by Apr 2027 at the latest), same instrument family | Use the same document template to keep legal cost down. A founder loan for the Jan–Mar bridge needs a written loan agreement and subordination **[Counsel]**. Use most-favoured-nation clauses with care. |
| Seed | Not dated | **Q1 2029** | AG conversion, an employee participation plan with a Vaud tax ruling, and full IP and data-room diligence. See `04` §6. |

### 3.3 EU: no entity until there is a reason

**Free EU design-partner pilot (12 Nov 2026):** one EU club, contracted from SPSA, live Sep 2027 (downside Jan 2028); needs an Art. 27 representative, an EU-language DPA and a written pilot agreement; no entity, no OSS while it is free **[Verify]**.

The paid EUR track enters only after its gate (review §5): **at least 10 Swiss clubs, SEPA live, EU VAT set up, a GDPR Art. 27 representative, and DE/FR product and legal texts complete**. Base: first club signed Q2 2028, live Sep 2028. Downside: 2029.

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
| **No entity** (sell from CH) | Swiss company contracts directly with US customers | Neutral | Lowest. But US customers and payment processors may prefer a US counterparty. Sales-tax nexus still applies (§6.3). | The one free US design-partner pilot (Sep–Oct 2027 / Mar 2028) and any paying design partner, pre-gate [Verify] |
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
| Fractional CTO (any trial, and any equity the CTO proposes) | **Contractor agreement with IP assignment** for the 5-week paid trial (CHF 9–11k **[Founder]**), then a shareholders' agreement plus a service or employment contract | Assignment of all trial output whether or not the partnership proceeds | Before the trial starts |
| Freelancers, designers, translators, pen-testers | Short-form **contractor IP and confidentiality agreement** (one template) | Assignment, confidentiality, data-processing clause where they touch personal data | Before any work starts |
| Future employees | Swiss employment contract with an IP and inventions clause (CO Art. 332) plus confidentiality | Covers inventions and designs, not only software | At hire |

**AI-assisted code.** Much of the repo was produced with AI coding agents under the founder's accounts. Copyright protection for purely machine-generated output is uncertain in Switzerland, the EU and the US **[Counsel]**. Mitigations:

1. Keep the company's rights through **contract and trade secret** as well as copyright: confidential repo, access control, NDAs.
2. Document human direction, review and selection (the commit history helps).
3. Confirm the tool providers' terms give output ownership to the user and include no restrictive licence.
4. Run an **open-source licence scan** of the dependency tree once before the convertible closes (BP §10.3). Copyleft dependencies in a commercial SaaS should be identified now.

### 4.2 Trademark strategy

**Founder's candidate (12 Nov 2026): "Global Sport OS"** as the master brand, with each club running the product under its own name (e.g. "DLang OS" for DLang). Naming note: descriptive and laudatory words ("global", "sport", "OS") are hard to register in classes 9 and 42 and may be refused as non-distinctive, and matching domains are likely taken [Est.; Verify with a trademark attorney]. So the check by **15 Jan 2027** covers "Global Sport OS" plus **2–3 more distinctive alternatives** (coined or composite names), in CH, EU and US registers and on domains and handles. Club names such as "DLang OS" are tenant branding and need no platform filing, but the club should own its own name. The legal entity (SPSA GmbH) appears on contracts and invoices whatever the product is called.

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
| **Parent/athlete privacy notice** (FR, DE, IT, EN) | Transparency for data subjects, including minors | Medical fields, photos, retention, under-16 rule (one rule, BP §8), AI assistant only if the club has switched it on (opt-in, 12 Nov 2026), with what it processes | Same |
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

Vaud combined profit tax for a GmbH is roughly in the mid-teens percent range **[Est.] [Tax]**. With losses expected until about 2029 (v2 workbook: first EBITDA-positive month about mid-2030 on the lean plan of record, about Q4 2030 on default costs), **carry losses forward** (7 years in Switzerland **[Verify]**) and keep clean books from day one. Swiss R&D super-deductions and the patent box are cantonal options. Ask the fiduciary whether Vaud's R&D deduction applies to the engineering spend **[Tax]**.

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
| **GDPR** | Offering services to EU clubs or monitoring EU residents | **Art. 27 EU representative** (a service, about a few hundred to low thousands EUR a year **[Est.]**), Art. 28 DPA, transfer mechanism | **Before the free EU pilot goes live (Sep 2027 / Jan 2028)**; full set at the paid EUR gate (2028) |
| **COPPA and US state privacy laws** | US, children under 13, state thresholds | Verifiable parental consent flows, school-context rules, US privacy notice | **Before the free US pilot goes live (Sep–Oct 2027 / Mar 2028)**; US counsel memo by 31 May 2027 |
| **AI assistant (12 Nov 2026)** | Any club that switches the opt-in assistant on (DLang beta Q1 2027) | DPIA addendum; AI provider listed as sub-processor in the DPA; no training on tenant data; data allow-list (no medical notes, dates of birth or coach notes); human approval before any message to a parent | DPIA addendum and DPA update by **15 Jan 2027** |

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

Owners: **F** = founder, **L** = Swiss lawyer, **FT** = fiduciary/tax adviser, **E** = engineering (fractional CTO leading the AI agent team; the paid reviewer until the CTO starts), **B** = insurance broker. Dates are **base / downside**.

### Phase 0: Switzerland foundations (now → Feb 2027)

| # | Item | Owner | Base | Downside | Done when |
|---|---|---|---|---|---|
| 1 | Confirm SPSA register number, date, purpose clause, shareholders; SIDIS status; insurance (GmbH, FIT, round and rail answered 12 Nov) | F | 20 Nov 2026 | 20 Nov 2026 | Register extract on file |
| 2 | Payment-architecture decision plus written AML/fund-holding view | F, E, L | 27 Nov 2026 | 11 Dec 2026 | Decision memo plus counsel email or opinion |
| 3 | SPSA register extract and articles on file; lawyer/fiduciary view on carving the software business out (D1b) | F, FT, L | 15 Dec 2026 | 31 Jan 2027 | Extract; written view |
| 4 | "SPSA Tech" bank account [Founder]; Stripe platform account in SPSA's name; DLang connected account | F | 31 Dec 2026 | 31 Jan 2027 | Accounts live |
| 5 | IP assignments: founder → SPSA GmbH (or the carved-out company), SIDIS signed with present assignment, contractor template, fractional CTO contract with IP assignment | F, L | 31 Dec 2026 | 31 Jan 2027 | Signed copies in data room |
| 6 | Related-party subscription (academy ↔ GmbH) | F, L | 31 Dec 2026 | 31 Jan 2027 | Signed |
| 7 | Open-source licence scan | E | 15 Jan 2027 | 31 Jan 2027 | Report, no unresolved copyleft |
| 8 | Trademark and domain check CH/EU/US: "Global Sport OS" + 2–3 alternatives | L | 15 Jan 2027 | 15 Feb 2027 | Go/no-go per name; shortlist for the 15 Feb decision |
| 9 | Compliance pack: ROPA, DPIA, DPA, privacy notice (FR/EN first, DE/IT next), breach procedure | F, L | 15 Jan 2027 | 15 Feb 2027 | Documents approved |
| 10 | MSA, Founding Club Addendum, support policy | L | 15 Jan 2027 | 15 Feb 2027 | Templates final |
| 11 | External security review booked (4 Dec) and completed | E | 31 Jan 2027 | 28 Feb 2027 | Report, criticals fixed |
| 12 | Cyber plus E&O bound | B | 31 Jan 2027 | 28 Feb 2027 | Policy schedule |
| 13 | Convertible loan signed (release on CTO in place; any CTO equity disclosed); Jan–Mar bridge papers (~CHF 45k) | F, L | 31 Jan 2027 (bridge papers 15 Dec 2026) | 31 Mar 2027 | Signed; funds received |
| 14 | Swiss trademark filed | L | 28 Feb 2027 | 31 Mar 2027 | IGE filing receipt |
| 15 | VAT decision (voluntary or threshold); bookkeeping set up | FT | 31 Mar 2027 | 30 Apr 2027 | Memo; registered if decided |

**First paid external signature (31 Jan / 31 Mar 2027) cannot happen before items 2, 3, 5, 9, 10 and 12 are done.** If they slip, the signature slips with them. A signature without them is worse than a late signature.

### Phase 1: Swiss scale (2027 → 2028)

| Item | Owner | Base | Downside |
|---|---|---|---|
| Formal SLA and trust page at 10 clubs | F, E | Oct 2027 | Mar 2028 |
| Pre-seed papers, CHF 250–300k incl. the EUR 50k (same template) | F, L | Signed 28 Feb 2027, cash by Apr 2027 | Jan–Feb 2027 |
| Free EU pilot: Art. 27 representative, EU DPA, pilot agreement | F, L, EU counsel | Before go-live Sep 2027 | Jan 2028 |
| Free US pilot: counsel memo (no-entity position, COPPA consent, state law), cross-border Stripe Connect, pilot agreement | F, US counsel | Memo 31 May 2027; go-live Sep–Oct 2027 | Mar 2028 |
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
| GmbH formation: not needed (SPSA exists); carve-out into a separate GmbH, if advised | 0 / 2,000–4,000 **[Founder]** |
| Free EU and US pilots: Art. 27 representative, EU DPA, US counsel memo (2027) | 4,000–10,000 |
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
| IP assignment from founder, SIDIS and contractors to SPSA; carve-out of the software business from the academy GmbH | Swiss corporate lawyer, fiduciary |
| FIT Digital eligibility for SPSA (company-age rule) | FIT / Innovaud |
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

| Topic | Founder plan (Aug 2026) | Updated (11 Nov 2026; rows marked 12 Nov reflect the founder's decisions) | Why |
|---|---|---|---|
| Entity | GmbH in Vaud, formed W1 (24 Aug), register W3 | **12 Nov:** Swiss Preparatory Sports Academy GmbH (SPSA) exists [Confirm register no. and date]; account "SPSA Tech"; carve-out view by 15 Dec 2026 | Founder's answer; academy and software in one entity is a new risk |
| AG | Mentioned only as a requirement for angel syndication | **Convert before the first employee grant or the seed (Q4 2028 – Q1 2029)** | AG is the standard for ESOP and VC. Converting earlier wastes CHF 30k+ of tied-up capital. |
| Holding structure | Not addressed | No HoldCo by default. One tax-adviser check before the convertible converts. | Value is lowest now, so if a holding is ever wanted, set it up now. Otherwise unnecessary. |
| IP | "Founder-owned under SIDIS draft" (deck); BP §10.3 says assign to the company | **Present assignment to the GmbH by 31 Dec 2026**, SIDIS signed. AI-assisted code risk addressed. | IP held personally under a draft is a diligence red flag. Contractors' work is not assigned automatically under Swiss law. |
| Trademark | "Register in Switzerland at minimum" | **12 Nov:** "Global Sport OS" candidate + 2–3 alternatives checked CH/EU/US (marks and domains) by 15 Jan 2027; clubs use their own names; CH by 28 Feb 2027, EU and US at the paid gates, through Madrid | Generic names are hard to register; D-language conflict for "DLANG" |
| Payments | Payrexx for TWINT (beta); Stripe card. No fund-flow design. | **12 Nov:** Stripe Connect direct charges accepted; DLang connects first; written AML view by 15 Jan 2027 | The current single-account repo would make the platform hold club money, which raises financial-intermediary risk. |
| Contracts | Six documents before club #1 (BP §10.4) | Same core set, plus Founding Addendum guardrails (tier cap), related-party agreement, SLA staging and **reseller agreement deferred to 2029+** | An uncapped "lifetime" price is a long-term liability. White-label resale is behind a gate. |
| Swiss VAT | Threshold crossed in Year 2 | Threshold likely **late 2028** on the re-baselined base case. **Voluntary-registration decision by 31 Mar 2027.** Acquisition-tax check on imported services. | Revenue has slipped about one quarter or more. Registration cuts clubs' effective price by 8.1%, and that trade-off needs real numbers. |
| EU | Reverse charge "generally applies", confirm per country | **12 Nov:** free EU pilot from Sep 2027 needs an Art. 27 representative and EU DPA. Non-Union OSS, reverse charge at the paid EUR gate (Q2 2028, early 2028 on a strong pilot / 2029) | Many clubs are not VAT-registered and fall under OSS. The founder's B2B-only framing was incomplete. |
| US | Deck: "worldwide", US statistics | **12 Nov:** free US pilot from Sep–Oct 2027 with COPPA consent and no entity [Verify]; paid US not before H2 2029; Delaware subsidiary by default; flip only if a lead investor requires it | The Swiss wedge does not carry over. Incumbent market. A flip is costly and hard to reverse. |
| FIT Digital (12 Nov) | CHF 20k, deadline 10 Nov 2026 | Not filed; 0%; eligibility under the company-age rule to be checked | Founder's answer |
| Funding papers (12 Nov) | EUR 50k round | EUR 50k released on CTO in place; Jan–Mar bridge ~CHF 45k; pre-seed CHF 250–300k incl. EUR 50k in H1 2027 | Founder-facts case: cash negative from Jan 2027 |
| Data protection for AI (12 Nov) | "AI from day one" dropped | Opt-in assistant per club; DPIA addendum and DPA sub-processor entry by 15 Jan 2027 | Founder wants AI available once fully functional |
| Insurance | "In place" before club #1 | Cyber plus E&O bound by **31 Jan 2027**. D&O at the seed. | Same intent, now dated and ordered. |
| Data protection | Controls listed; "nFADP-aligned" language | Kept. Pack due **15 Jan 2027**. GDPR/COPPA tied to the market gates. | The founder's discipline is right. It needed dates. |
| Legal budget | Not modelled as a line | **About CHF 20–45k** in the first 12 months [Est.] | Unbudgeted legal cost is a common cause of cash surprises. Add it at the 3 Jan 2027 model refresh. |
| First paid signature | Red line 30 Nov 2026 | **31 Jan 2027 / 31 Mar 2027**, and only after the legal prerequisites in §10 | Signing without the entity, IP, DPA and payment design creates liabilities that cost more than the delay. |
