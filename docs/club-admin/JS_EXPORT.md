# J+S (Jeunesse+Sport / Jugend+Sport) activity export

**Status: working export for MANUAL upload / entry in the national database (NDS). Club OS does not connect to NDS.**
Every column, format and rule below is our reading of the J+S rules and is marked **[Verify with J+S/NDS]**.
Have the club's J+S coach (Coach J+S / J+S-Coach) confirm them against the current NDS import template before the first real submission.

Where: Admin → J+S (`/admin/js`). Admin only. Download: `/admin/js/export?program=<id>&from=YYYY-MM-DD&to=YYYY-MM-DD&part=participants|sessions&ahv=0|1`.

## Settings (per club, `club_admin_settings`)

| Setting | Default | Note |
|---|---|---|
| J+S enabled, club number | off, empty | Club number as known to NDS [Verify with J+S/NDS] |
| Age range | 5–20 | Eligibility = calendar year of the session − birth year, inclusive [Verify with J+S/NDS] |
| Rate per participant-hour | empty | Only for the subsidy **estimate** shown in the app; enter the current J+S rate [Verify with J+S/NDS] |

Offers: tick a programme as a J+S offer (or a team; its programme then counts), optional offer number and a default session length (used when a session has no end time; fallback 60 min).
Coaches: J+S person number on the coach record.

## File 1 — participants and attendance (`part=participants`)

UTF-8 with BOM, separator `;`, CRLF, one row per participant (registered in the programme or marked in a session of the period), sorted by last name.

| Column | Format | Source |
|---|---|---|
| Last name, First name | text | athlete |
| Date of birth | `DD.MM.YYYY` | athlete [Verify with J+S/NDS] |
| Sex | `M` / `F` / empty | athlete gender [Verify with J+S/NDS] |
| Nationality | text as stored | athlete [Verify with J+S/NDS] |
| AHV number (optional) | `756.XXXX.XXXX.XX` | only with `ahv=1`, only numbers stored **with recorded consent**; decrypted by an admin-only RPC, every export audit-logged [Verify with J+S/NDS] |
| One column per session `DD.MM.YYYY HH:MM` | `1` present or late, `0` absent or excused, empty = not taken | attendance marks [Verify with J+S/NDS] |
| Sessions attended | integer | count of `1` |

## File 2 — sessions (`part=sessions`)

| Column | Format |
|---|---|
| Date | `DD.MM.YYYY` (club time zone) |
| Start | `HH:MM` |
| Duration (min) | integer (session end − start, else the offer's default length) |
| Coach, J+S person number | text |
| Participants present | integer |
| Location | text |

Column headers are written in the user's language. Text cells that start with `= + - @` are prefixed with `'` (spreadsheet formula protection).

## Subsidy estimate (in the app only)

Per offer and period: sessions, hours, eligible participants (attended at least once, inside the age range), participant-hours (Σ eligible attendances × session length) and, when a rate is set, participant-hours × rate. **This is an estimate, not the J+S calculation** [Verify with J+S/NDS].

## AHV / AVS number — data protection

- Optional, admin only, stored in `athlete_identifiers` encrypted (`pgp_sym_encrypt`, per-club key in `ca_pii_keys`, no policies), only the last 4 digits in clear.
- Cannot be stored without a consent note (who / which form / date); checksum validated (EAN-13, prefix 756).
- Not visible to finance, coaches or guardians; audit rows never contain the number.
- Before production: decide with the privacy officer whether to move the key to a vault (Supabase Vault / KMS) and set a retention rule (e.g. delete when the athlete leaves J+S offers).
