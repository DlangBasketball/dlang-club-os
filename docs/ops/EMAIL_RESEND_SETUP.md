# Email (Resend) setup

Status 17 Nov 2026: **live on staging**. The domain `dlangbasketball.ch` is verified in Resend (EU region, eu-west-1). App and Supabase Auth emails are delivered from `noreply@dlangbasketball.ch`.

## DNS records (Infomaniak → Domains → dlangbasketball.ch → DNS zone)

| Type | Source | Target | Note |
|---|---|---|---|
| **DKIM** (Infomaniak's own type, not TXT) | `resend._domainkey` | `v=DKIM1; k=rsa; p=<key from Resend>` | Infomaniak refuses DKIM keys as TXT ("Please choose the DKIM type") |
| MX | `send` | `feedback-smtp.eu-west-1.amazonses.com` (priority 10) | bounce handling only, on the `send` subdomain |
| TXT | `send` | `v=spf1 include:amazonses.com ~all` | SPF for the `send` subdomain |
| CNAME | `rsend` | `send.forge.rmta.net` | Resend tracking |

The club's existing mailbox (MX on the root domain) is untouched. Optional later: a DMARC record `_dmarc` TXT `v=DMARC1; p=none; rua=mailto:<address>`.

## Keys and settings
- A **full-access** Resend key is stored only as a network secret of the cloud agent environment (domain/key management).
- A **sending-only** key (restricted to dlangbasketball.ch) is used by the app: Vercel env `RESEND_API_KEY` (sensitive), with `RESEND_FROM` / `RESEND_FROM_EMAIL` = `DLang Basketball <noreply@dlangbasketball.ch>`.
- Supabase Auth SMTP: host `smtp.resend.com`, port 465, user `resend`, password = the sending-only key, sender `DLang OS <noreply@dlangbasketball.ch>`, rate limit 100/h.

## Per-club senders (white-label)
Each new club either sends from the platform domain with its own display name, or verifies its own domain in Resend and sets its sender in club settings. Do not send from a club's domain before it is verified (SPF/DKIM failures land in spam).
