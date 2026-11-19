# Communication: message board, alerts, new contacts

Migration `20250420100700_messaging_alerts_leads.sql`. DB tests in `tests/db/messaging.sql`, unit tests in `tests/unit/messaging.test.ts`.

## Message board

| Thread | Who | Notes |
|---|---|---|
| Direct, staff <-> family | coach <-> guardians of athletes the coach coaches; office (admin/finance) <-> any guardian | Tied to one family (`family_id`). |
| Direct, family -> club office | a guardian writing to "the club office" | Admins and finance read and answer; whoever answers becomes a participant. |
| Direct, staff <-> staff | any staff member | No family. |
| Channel | team, programme or camp edition | Admins and the scope's coaches post; guardians of athletes in the scope read and reply when the channel and the club allow it. |

Rules (enforced in the database: RLS on every table, `msg_*` RPCs; mirrored in `src/lib/messaging/permissions.ts`):

- Participants are staff members or guardians only. Athletes have no messaging identity, so there are no private adult <-> minor threads: messages about a child go through the child's guardians.
- Parents never message other parents.
- Contact details stay private: `profiles` is readable by the user themselves and admins only; thread people come from `msg_people()` (display names, no email/phone).
- Admins can read every staff <-> family thread of their club (the UI says so on the inbox, the thread and the composer). Finance reads office threads only. A coach reads only threads they are in and channels of what they coach.
- Moderation: admins hide (never hard-delete) messages, close/reopen threads; anyone who can read a message can report it. Message bodies and lead details are redacted from `audit_logs`.
- Attachments: PDF/JPEG/PNG/WebP up to 2 MB in the private `message-attachments` bucket (`<org>/<conversation>/<file>`), signed URLs valid 5 minutes; files of hidden messages are no longer readable.
- Read receipts are off by default (club setting). Unread counts come from `msg_read_state`.
- Updates: Supabase Realtime is not used in this codebase; pages refresh every 20 s while visible.

## Delivery channels

- In-app: always for messages (cannot be turned off); per-user switch for alerts, new contacts and announcements.
- Email (Resend, translated into the recipient's language): per-user per-category switch; club switch for message emails; quiet hours (the user's, else the club's) suppress email, except urgent alerts. Sensitive threads (all direct threads by default) never put the message text in the email: "You have a new message". Repeated messages in the same thread within 30 minutes do not create another notification while the previous one is unread. Sending is skipped when `RESEND_API_KEY` is unset.

## Alerts

Admins: everyone, staff, parents, a team, a programme or a camp edition. Coaches: their own teams, programmes and camp editions. Severity info / warning / urgent, send now or schedule, optional expiry. Shown as a banner (dismissible per user) and sent as notifications. Scheduled alerts are sent by `GET /api/messaging/cron` (bearer `CRON_SECRET`, e.g. every 5 minutes) and, as a fallback, when staff open the alerts page.

## New contacts (leads)

"Questions? Contact us" on `/club`, `/book/<club>` and `/register/<programme>`. The club is resolved on the server (request host, or the page's slug when it matches the host). Spam protection without captcha: honeypot field, minimum fill time, rate limit per HMAC-hashed client IP (3 per 10 minutes, 10 per day) and per club (100 per hour), checked in the action and again in `contact_lead_submit()` (service role only). The IP itself is never stored; set `CONTACT_FORM_SECRET`. Consent to be contacted is required and stored with a timestamp. Admins work the inbox (`/admin/leads`): status new / replied / converted / closed, reply by email from the club address, convert to a family (reuses a family with the same contact email).

The admin notifications page shows parent messages, employee messages and new contacts together.

## WhatsApp

Phase 1 (now): no API integration. Staff get "Open in WhatsApp" links (`https://wa.me/?text=...`, no phone number) on channel posts and alerts, so they share into their own WhatsApp groups. The app never exposes parent numbers to coaches.

Phase 2 (planned): WhatsApp Business Platform (Cloud API).

- One WhatsApp Business Account per club (tenant), connected by the club admin (embedded signup); tokens stored server-side per org, never in code.
- Outbound only at first: alerts and "you have a new message" notifications as pre-approved, translated message templates (utility category), sent to guardians who opted in to WhatsApp in their notification preferences (new channel next to in-app and email, explicit opt-in with timestamp, as for email consent). No message text of sensitive threads in WhatsApp, same rule as email.
- Phone numbers come from the guardian's own profile, are used only by the server-side sender and never shown to staff.
- Inbound replies (webhook, signature-verified, org mapped from the business phone number id) would land in the guardian's thread with the office; 24-hour customer-service window rules apply.
- Data protection: a data-processing agreement with Meta, an entry in the records of processing, and a check under nFADP/GDPR (transfer to the US) before go-live; ask privacy-compliance-officer. Under-13 rules (COPPA) mean WhatsApp delivery is to guardians only, never to athletes.
- Cost: conversation-based pricing per club; expose usage per tenant before enabling it by default.
