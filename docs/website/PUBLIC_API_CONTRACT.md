# DLang OS public website API (v1) - contract

Shared contract between the app (Next.js) and the "DLang OS Connect" WordPress plugin.
Base URL: the club's app address, e.g. `https://dlang-staging.vercel.app` (later `https://app.dlangbasketball.ch`).

## Club resolution
Every endpoint takes `?club=<org slug>` (e.g. `dlang`). If omitted, the request host's club is used
(custom domain / subdomain / default). Unknown or disabled club -> 404 JSON `{ "error": "not_found" }`.
The club must have "website connection" enabled in admin (Settings -> Website); otherwise 404.

## Common
- `GET` only, JSON, UTF-8. `?lang=en|fr|de|it|es` picks translated labels and formats (defaults to club locale).
- CORS: `Access-Control-Allow-Origin` echoes the Origin only if it is in the club's allowed website origins.
- Caching: `Cache-Control: public, s-maxage=60, stale-while-revalidate=300`. `ETag` supported.
- Rate limit per IP (429 JSON `{ "error": "rate_limited" }`).
- Money: `{ "amount": 550.0, "currency": "CHF", "formatted": "CHF 550.00" }`.
- Dates: ISO 8601 with offset, plus `formatted` strings in the requested language.
- Images: absolute public URLs (covers/photos only where the club marked them public; never a child photo or
  full child name unless media consent is recorded - children appear as first name + initial only, or not at all).
- Every list item has `url` (canonical app page for details) and, where relevant, `action_url` (register / book / buy)
  that works for guests (sign up during checkout).
- Envelope: `{ "club": { "slug", "name", "logo_url", "theme": {css var name -> value}, "locale", "currency", "app_url" }, "data": [...], "generated_at" }`.

## Endpoints (`/api/public/v1/...`)
| Path | Query | data[] item fields |
|---|---|---|
| `club` | - | (data = object) name, tagline, contact (public email/phone/address), social links, logo, cover, theme, languages, nav links to app pages (camps, programs, schedule, book, shop, donate, login) |
| `programs` | `kind=team,camp,clinic,...`, `season` | id, slug, name, kind, age_range, level, description (html-safe), cover_url, location, starts_on, ends_on, price_from, places_left (null if unlimited), status (open/full/waitlist/closed), url, action_url |
| `camps` | `season=spring,summer,fall,winter`, `year` | camp season groups: season, year, title, url (season registration page), editions[]: id, name, dates, venue, ages, price_options[] (days, lunch, price, member_price), places_left, status, action_url (adds to camp basket) |
| `events` | `from`, `to` (default next 60 days), `team` (slug or id), `type=game,training,event,tournament` | id, type, title, team {slug,name}, opponent, home_away, starts_at, ends_at, venue {name,address,maps_url}, status (scheduled/cancelled/moved), result (for past games: our_score, their_score, outcome), url |
| `results` | `team`, `season` | past games only, same shape as events |
| `teams` | - | slug, name, age_group, league, coaches[] (name, role, photo_url if public), training_times[] (weekday, start, end, venue), cover_url, url. No player list unless `roster_public` and consent (first name + initial, number). |
| `coaches` | - | id, name, role, bio, photo_url (public only), licences (labels only), url |
| `training` | - | services/packages: id, name, duration, group (min,max), price per session/person, packages[] (sessions, price), url, action_url (/book) |
| `shop` | `category` | id, name, description, images[], price, member_price, in_stock, variants[] (size etc.), url, action_url |
| `campaigns` | - | donation campaigns: slug, title, goal, raised, progress_pct, url (/club/donate/[slug]) |
| `news` | `limit` | club alerts/posts marked public: id, title, excerpt, published_at, url |
| `calendar.ics` | same as events | iCalendar feed of public events |

## Embeds (interactive parts)
`/embed/<widget>?club=<slug>&lang=..&theme=light|dark|club&...` renders a chrome-less page meant for an iframe:
widgets `camps`, `programs`, `schedule`, `results`, `teams`, `book`, `shop`, `donate`, `register/<programSlug>`, `login`.
- Frameable only by the club's allowed website origins (CSP `frame-ancestors`), all other app pages stay `SAMEORIGIN`.
- Auto-height: posts `{ type: "dlang:resize", height }` to `window.parent` (targetOrigin = the allowed origin from `?origin=` checked against the list).
- Checkout/payment/login steps open in a new top-level tab of the app (Stripe and auth cookies need first-party context), then return to `return_to` (must be an allowed origin).
- Script helper `/embed.js`: `<div data-dlang-widget="camps" data-club="dlang" data-season="summer"></div><script src="https://<app>/embed.js" async></script>` -> creates the iframe and handles resize.

## Webhook to the website (optional, for cache purge)
When public data changes (program/camp/event/shop/news), the app POSTs `{ "type": "content.updated", "resource": "camps", "club": "dlang", "at": ISO }`
to the club's configured website webhook URL with header `X-DLang-Signature: sha256=<hex HMAC of raw body with the club's website secret>`
and `X-DLang-Timestamp`. The WordPress plugin verifies it and clears its cache.
WordPress endpoint: `POST /wp-json/dlang-os/v1/purge`.
