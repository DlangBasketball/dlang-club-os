# Cookie Policy

> **TEMPLATE. Requires review by qualified counsel in each jurisdiction where it is
> used.** The in-app version is rendered at `/legal/<slug>/cookies`. The consent
> logic is in `src/lib/compliance/cookies.ts` and
> `src/components/compliance/cookie-consent-banner.tsx`.

_Last updated: [DATE]_

## Our approach
By default we set **only strictly necessary cookies**. Optional categories
(functional, analytics, marketing) stay **off** until you switch them on.
"Necessary only" and "Accept all" are equally prominent. You can change your
choice at any time with the **Cookie settings** link in the page footer. We ask
you again after 6 months, or when this policy changes.

We honour the **Global Privacy Control** (GPC) signal: if your browser sends it,
marketing cookies stay off and we treat it as an opt-out of any "sale" or
"sharing" under US state laws.

## Cookies and similar technologies we use

| Name | Provider | Purpose | Category | Duration |
|---|---|---|---|---|
| `sb-<project>-auth-token` (may be split into `.0`, `.1`) | Platform (Supabase Auth) | Keeps you signed in | Strictly necessary | Session refresh, up to 1 week |
| `cos_cookie_consent` | Platform | Stores your cookie choice and when you made it | Strictly necessary | 6 months |
| `__stripe_mid`, `__stripe_sid` | Stripe | Fraud prevention on the payment page only | Strictly necessary | 1 year / 30 min |
| _none_ | | Analytics | Analytics | |
| _none_ | | Advertising or cross-site tracking | Marketing | |

If the club adds an analytics tool, it must be loaded through `<ConsentGate
category="analytics">`, so that it runs only after consent, and it must be added
to this table.

## Legal basis
- **EU/EEA:** ePrivacy Directive Art. 5(3) as implemented nationally. Consent is
  required for anything that is not strictly necessary.
- **Switzerland:** TCA Art. 45c (information and right to refuse) and nFADP. The
  platform applies the stricter EU opt-in standard.
- **UK:** PECR reg. 6.
- **US:** CCPA/CPRA and other state laws (opt-out of sale or sharing; GPC).
  COPPA (no behavioural advertising to children under 13).

## Contact
[CLUB / PLATFORM CONTACT EMAIL]
