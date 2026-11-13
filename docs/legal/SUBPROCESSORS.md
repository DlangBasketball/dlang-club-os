# Sub-processor list

> **TEMPLATE. Confirm every entry against the vendor's current DPA, certification
> and region before publishing. Requires review by qualified counsel.**
> Annex B to the Terms and Annex 3 to the DPA. Keep this list in sync with the seed
> rows in `supabase/migrations/20250420091900_compliance_regions.sql`
> (`public.subprocessors` where `org_id is null`).

_Last updated: [DATE]. Changes are announced 30 days in advance to subscribed customers (DPA §7)._

| Sub-processor | Service | Data | Processing location | Transfer safeguard | Notes |
|---|---|---|---|---|---|
| Supabase Inc. | Postgres database, auth, file storage | All Customer Data | **EU: AWS eu-central-1 (Frankfurt)** | Data stays in region; DPA with SCCs for support access from outside the EU | Choose the EU region when creating the project. US region for US-only tenants on request |
| Amazon Web Services (via Supabase) | Infrastructure | All Customer Data (encrypted) | Frankfurt | In-region | Indirect sub-processor |
| Vercel Inc. | Web hosting, serverless functions, CDN | Request metadata, session cookies, rendered pages | Functions pinned to `fra1` (Frankfurt); global edge cache | SCCs + EU-US / Swiss-US DPF | Set the function region to `fra1` in project settings |
| Stripe Payments Europe Ltd. / Stripe Inc. | Card and wallet payments | Payer name, email, payment data | EU / US | SCCs + DPF | Independent controller for some fraud-prevention processing |
| Resend (Plus Five Five Inc.) | Transactional email | Recipient name and email, message content | US by default; **EU region available** | SCCs + DPF | Use the EU sending region for CH/EU tenants |
| AI assistant API provider | Optional in-app assistant | Question text plus a minimised club context (no medical data) | US | SCCs; zero-data-retention / no-training terms required | **Off unless enabled.** Removed from the public notice automatically when no API key is configured |

## Not sub-processors
- **Banks and PostFinance** (QR-bill and bank transfer): independent controllers.
- **TWINT:** independent controller where used.
- **The club's own tools** (e.g. Google Workspace): the club's own processors; list them in `subprocessors` with `org_id` set.

## Before go-live in each region
- [ ] Sign each vendor's DPA, archive the PDF, and set `dpa_url`.
- [ ] Confirm each US vendor's DPF certification (EU-US **and** Swiss-US extension) on dataprivacyframework.gov.
- [ ] Record a transfer impact assessment for each US transfer.
