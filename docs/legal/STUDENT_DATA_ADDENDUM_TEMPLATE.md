# Student-Data Privacy Addendum (FERPA and state student-privacy laws)

> **TEMPLATE. Requires review by qualified counsel, and usually by the school
> district's own counsel, before signing.** Many districts insist on their own
> paper, or on the Student Data Privacy Consortium's National Data Privacy Agreement
> (NDPA) with a state-specific Exhibit G. Use this addendum only where the school
> accepts vendor paper. Annex C to the Terms. If it conflicts with the Terms or
> the DPA, this addendum prevails for Student Data.

**School / LEA:** [NAME, ADDRESS] · **Provider:** [PLATFORM LEGAL ENTITY]

## 1. Definitions
"**Student Data**" means personally identifiable information from education
records (34 CFR §99.3) and any other information about a student that the Provider
receives from the School or creates while providing the Service.
"**Eligible Student**" means a student who is 18 or older, or who attends a
post-secondary institution.

## 2. School-official designation (FERPA)
2.1 The School designates the Provider as a **"school official" with a legitimate
educational interest** under 34 CFR §99.31(a)(1)(i)(B). The Provider performs an
institutional service (athletics and activities administration) that the School
would otherwise carry out with its own staff.
2.2 The School confirms that its **annual FERPA notification** contains criteria
under which a contractor qualifies as a school official.
2.3 The Provider is under the School's **direct control** in its use and
maintenance of Student Data, and uses Student Data only for the purposes authorised
by the School.
2.4 _Product mapping:_ `compliance_settings.ferpa_school_official_designated = true`,
`ferpa_designation_date`, `ferpa_annual_notice_url`.

## 3. Use and disclosure restrictions
The Provider shall **not**:
a) use Student Data for targeted advertising, or build a profile of a student
   other than for the School's purposes;
b) sell, rent or trade Student Data;
c) re-disclose Student Data except to its sub-processors under written obligations
   at least as strict as these (34 CFR §99.33(a)), or as required by law (after
   notifying the School unless that is prohibited);
d) use Student Data to train AI models or to improve unrelated products.

## 4. Parent and Eligible Student rights
The School is responsible for responding to requests to inspect, review and amend
records (34 CFR §§99.10–99.22). The Provider will help within **10 business days**
of a request, so that the School can meet its **45-day** deadline.
_Product mapping:_ DSAR types `ferpa_inspect` and `ferpa_amend`, with automatic
45-day due dates.

## 5. Record of disclosures
The Provider keeps a log of disclosures of Student Data (34 CFR §99.32), available
to the School on request. _Product mapping:_ `education_record_disclosures`.

## 6. Security
The Provider maintains the measures in DPA Annex 2, and will align with the
standards required by the state (for example the NIST Cybersecurity Framework under
NY Ed Law §2-d / 8 NYCRR §121.5).

## 7. Breach notification
The Provider notifies the School within **48 hours** of discovering unauthorised
access to Student Data, or sooner if state law or the NDPA requires it (NY 2-d: 7
calendar days from discovery to the educational agency). It cooperates with the
School's notifications to parents.

## 8. Retention and destruction
Student Data is deleted or returned within **60 days** of the end of the agreement,
or earlier on the School's written request. The Provider certifies destruction in
writing.

## 9. COPPA in school settings
Where students are under 13, the School may consent on parents' behalf **only for
the educational purpose of the Service**, and not for any commercial purpose (FTC
COPPA guidance). _Product mapping:_ `parental_consents.method = 'school_authorization'`.

## 10. PPRA
The Service does not survey students on the protected topics in 20 U.S.C. §1232h
without the School's prior arrangement for parental notice and consent.

## 11. State-law exhibit (complete one per state)

| State | Statute | Extra obligations |
|---|---|---|
| California | SOPIPA (B&P §22584), Ed. Code §49073.1 (AB 1584) | Contract terms required by §49073.1(b); students keep ownership of their content |
| New York | Ed. Law §2-d, 8 NYCRR Part 121 | Parents' Bill of Rights attached; data privacy and security plan; breach notice within 7 days |
| Illinois | SOPPA (105 ILCS 85) | Public list of operators; breach notice within 30 days; written agreement published |
| [STATE] | [STATUTE] | [OBLIGATIONS] |

Signatures: _School_ ____________ _Provider_ ____________ Date ________
