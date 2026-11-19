# DLang OS Connect - WordPress plugin

White-label WordPress plugin that shows a club's live DLang OS data on the club's own website, in the club's look.
Any club on DLang OS can install it; nothing in the plugin is specific to one club. It consumes the public API and
embeds described in [`PUBLIC_API_CONTRACT.md`](./PUBLIC_API_CONTRACT.md).

- Source: `integrations/wordpress/dlang-os-connect/`
- Tests: `php integrations/wordpress/tests/run.php` (or `npm run test:wp`)
- Build: `scripts/build-wp-plugin.sh` (or `npm run build:wp-plugin`) -> `dist/dlang-os-connect.zip` (git-ignored)
- Requirements: WordPress 6.3+, PHP 7.4+, outgoing HTTPS from the web server. Tested against SportsPress, WooCommerce,
  WPML and Polylang being active at the same time (no shared names: everything is prefixed `dlos_` / `dlang_`).

## 1. Install for a club

1. **Build or download the zip** (`dist/dlang-os-connect.zip`), then in WordPress: *Plugins > Add New > Upload Plugin*, activate.
2. **Settings > DLang OS**
   | Field | Value |
   |---|---|
   | App address | The club's app, https only (e.g. `https://app.<club-domain>`). |
   | Club slug | The org slug (app: *Settings > Website*). |
   | Language | *Follow WPML / Polylang, then the site language* (default). Or force one language. |
   | Look | *Club colours* (same as the app), *Light* or *Dark* with club accents. "Use this website's fonts" is on by default. |
   | Buttons | *Open the app in a new tab* (default) or *Open the app form in a window on this site* (embed dialog). |
   | Cache duration | 10 min default (1-1440). The last good copy is kept for 7 days and shown if the app is down. |
   | Webhook secret | The website secret from the app (write-only field, never shown again). |
   | Extras | Structured data (on), "Install the app" hint (off). |
   | Redirects | Off until the redirect list has been reviewed (see section 4). |
   Save, then **Test connection**: the club name, logo and colour swatches appear.
3. **In the app** (*Settings > Website*): enable the website connection, add the website origin
   (e.g. `https://www.<club-domain>`) to the allowed website origins (needed for embeds and CORS), set the webhook URL
   to `https://www.<club-domain>/wp-json/dlang-os/v1/purge` and copy the website secret into the plugin.
4. **Pages**: add shortcodes or blocks (section 2). **Menu**: *Appearance > Menus*, box *DLang OS* -> *My account*
   (and optionally *Get the app*). The menu item always points at the current app login URL.

## 2. Which shortcode on which page (typical club site)

Every shortcode is also a block (*DLang OS* category, live server-rendered preview, settings in the sidebar).
With WPML/Polylang put the same shortcode on each language version of the page; the language follows the page.

| Website page | Content | Shortcode |
|---|---|---|
| Home | Next games, 3 news items, open camps teaser | `[dlang_schedule type="game" days="14" limit="4"]` `[dlang_news limit="3"]` `[dlang_camps]` |
| Camps (one page per season or one page for all) | Seasons, weeks, prices (member price), places left, **Register** -> camp basket in the app | `[dlang_camps season="summer"]`, `[dlang_camps season="spring"]` (Easter), `[dlang_camps season="fall"]` |
| Programmes / Join a team | Teams and clinics open for registration, **Register** / waiting list | `[dlang_programs kind="team,clinic"]` |
| Schedule / Calendar | All upcoming games and events, iCal subscribe link | `[dlang_schedule days="60"]` |
| Results | Latest scores | `[dlang_results limit="20"]` |
| Teams overview | All teams, coaches, training times | `[dlang_teams]` |
| One page per team (U12, U14, ...) | Team, coaches, training times, next games, latest results | `[dlang_team slug="u14"]` (roster stays hidden unless `show_roster="1"` and the app publishes a consented roster) |
| Coaches / Staff | Staff cards | `[dlang_coaches]` |
| Pro training / Individual training | Sessions, packages, **Book** | `[dlang_training]` or the full booking flow `[dlang_embed widget="book"]` |
| Shop | Products, member prices, **Buy** | `[dlang_shop]` (or per category: `[dlang_shop category="apparel"]`) |
| Donate / Support us | Campaigns with progress, **Donate** | `[dlang_donate]` or one campaign `[dlang_donate campaign="new-hoops"]` |
| Header menu | "My account" / "Mon espace" | Menu item *DLang OS > My account*, or `[dlang_login]` as a button |
| Registration form inside a page | The app's own form in an iframe | `[dlang_embed widget="register/u14-boys"]` |

### Concrete set-up for DLang Basketball (customer zero)

WordPress 6.x/7.x with SportsPress, WooCommerce and WPML (EN/FR).

1. Plugin settings: app address `https://dlang-staging.vercel.app` (switch to `https://app.dlangbasketball.ch` when live),
   club slug `dlang`, language *Follow WPML*, look *Club colours*, buttons *new tab* first (embed once the app allows
   `https://dlangbasketball.ch` and `https://www.dlangbasketball.ch` as website origins).
2. In each language (EN and FR) of the existing pages, replace the SportsPress / WooCommerce content:
   | Existing page | Put |
   |---|---|
   | Camps (summer / Easter / autumn) | `[dlang_camps season="summer"]` etc. |
   | Schedule / Calendar (SportsPress calendar) | `[dlang_schedule days="60"]` + `[dlang_results limit="10"]` |
   | Each team page (SportsPress team) | `[dlang_team slug="<team slug in the app>"]` |
   | Pro training / Player development | `[dlang_training]` |
   | Shop (WooCommerce shop page) | `[dlang_shop]` (then follow the checklist in section 4) |
   | Support / Donate | `[dlang_donate]` |
   | Menu (EN and FR menus) | *DLang OS > My account*; rename the FR item to "Mon espace" |
3. Test connection, set up the webhook, then *Tools > Move to DLang OS* to build the redirect list (section 4).

## 3. How it works

- **Data**: `GET <app>/api/public/v1/<endpoint>?club=<slug>&lang=<xx>&...` with `wp_remote_get` (https only, 6 s
  timeout, 2 MB cap, 2 redirects). Responses are validated (envelope shape, lists of objects, URLs http(s) only,
  theme values) before they are cached or rendered.
- **Caching**: fresh copy in a transient for the cache duration, keyed by endpoint + params + language + club +
  generation; a separate stale copy (7 days) is served with a soft "Updating" note when the app fails; after a failure
  the app is not called again for 60 s. Purging bumps a per-resource generation (no key scans, works with object caches).
  Dependencies: camps <-> programmes, events <-> results, teams -> events/results, club -> everything.
- **Webhook** `POST /wp-json/dlang-os/v1/purge`: `X-DLang-Signature: sha256=<hex HMAC-SHA256(raw body, secret)>`
  compared with `hash_equals`; `X-DLang-Timestamp` (unix seconds, ms or ISO) and the signed body `at` must both be
  within 5 minutes (replays of old bodies are rejected). A `club` in the body must match the configured slug.
  Responses: 200 `{ok, purged}`, 401 bad signature / expired, 409 other club, 503 no secret configured.
  Common page caches (WP Rocket, W3TC, WP Super Cache, LiteSpeed, WP Engine) are cleared too
  (`add_filter( 'dlos_purge_page_cache', '__return_false' )` to opt out). Action `dlos_cache_purged` for anything else.
- **Rendering**: server-side HTML (good for SEO), every API value escaped (`esc_html`, `esc_attr`, `esc_url`; rich
  text through `wp_kses_post`), JSON-LD with `JSON_HEX_TAG` so data cannot close the script element.
  Schema: `SportsEvent` for games, tournaments and camp editions (with `Offer`s), `Product` for shop items.
- **Look**: the club theme (`envelope.club.theme`, the app's design tokens such as `--brand-primary`, `--bg`,
  `--surface`, `--text`, `--font-ui`) is mapped to `--dlos-*` variables on each widget. Only known tokens with safe
  CSS values are used; an unreadable text/surface pair falls back to the default palette, and the brand colour is
  only used as text in light/dark mode when it passes 4.5:1. Focus outlines, 44 px tap targets, screen-reader
  "opens in a new tab" hints, `prefers-reduced-motion` and forced-colours support. No jQuery.
- **Interactive flows**: buttons link to the item's `action_url` in a new tab. In embed mode the button also carries
  the app's `/embed/<widget>` URL (with `origin=` the website origin); a small script opens it in a native
  `<dialog>`, accepts `dlang:resize` messages only from the app origin and only from that iframe. Without JS the
  link still works. `[dlang_embed]` uses the app's `/embed.js` helper.
- **Language**: WPML (`wpml_current_language`), then Polylang (`pll_current_language`), then the site locale; reduced
  to en/fr/de/it/es, otherwise the club default.

## 4. Moving off SportsPress and WooCommerce (*Tools > Move to DLang OS*)

- **Report (read-only)**: counts of SportsPress events, teams, players, staff, tables/calendars and WooCommerce
  products and orders, with where each lives in the app. Players are children: import them from the club's member
  list with consent in the app importer (`<app>/admin/import`), never from public website pages.
- **Redirects**: *Build the redirect list* matches old URLs to app pages using the app's `url` fields:
  teams by slug then name, products by slug then name, games by date + opponent/title. Anything not matched
  confidently is listed and left alone. The list is stored in the `dlos_redirects` option (not autoloaded) and served
  via `template_redirect` as 301s **only after** the admin enables redirects. Targets must be on the app's host
  (no open redirect). All WPML/Polylang language URLs are included.
- **WooCommerce checkout switch-off checklist** (with automatic checks where possible): app shop set up and test
  purchase done; a page shows `[dlang_shop]`; product redirects on; open orders fulfilled/refunded; order history
  exported and archived for the accounting retention period; WooCommerce payment methods disabled; store hidden
  ("Coming soon" for store pages); privacy policy and terms updated; WooCommerce deactivated after the export.

## 5. Security and privacy

- Settings page and tools require `manage_options`; every form uses a nonce; all input sanitised
  (`DLOS_Settings::sanitize`), all output escaped. The webhook secret is write-only and never sent to the browser.
- No secrets or personal data in front-end scripts: the front script only receives the app origin and labels.
- Only `https://` app addresses (http only for `localhost` behind the `dlos_allow_insecure_localhost` filter).
- The plugin shows only what the app's public API returns (the app enforces media consent; children as first name +
  initial at most). Rosters are opt-in per team page. No cookies; the install hint stores a dismissal in localStorage.
- `uninstall.php` removes `dlos_settings`, `dlos_redirects`, `dlos_cache_gen` and all `dlos_` transients
  (per site on multisite).

## 6. Development

```
php integrations/wordpress/tests/run.php                       # stubs (no WordPress needed)
WP_CORE_DIR=/path/to/wordpress php integrations/wordpress/tests/run.php   # same tests with WordPress' real escaping/kses
php integrations/wordpress/tools/i18n.php                      # regenerate .pot/.po/.mo (FR/DE/IT), fails on missing strings
scripts/build-wp-plugin.sh                                     # lint + i18n + tests + zip
```

- Tests cover: signature verification (good, bad, expired header, replayed body), the purge handler, cache keys and
  purge generations, fetch/cache/stale-while-error/back-off, settings sanitising, language detection, rendering of
  camps/schedule/results/shop/team from synthetic fixtures with malicious strings, theme sanitising and contrast,
  redirect map building and lookup, JSON-LD output, and the shortcode entry point end to end.
- Translations: source strings in `integrations/wordpress/tools/translations/strings.php` (FR, DE with Swiss
  spelling, IT). Editor labels are translated in PHP and passed to the block script, so no JS catalogs are needed.
- The renderer tolerates small shape differences in the API (formatted dates as `field_formatted`, `{iso, formatted}`
  or `formatted.field`; ranges as `"8-14"` or `{min,max}`; venues as string or `{name,address,maps_url}`), so the
  app and the plugin can evolve independently within the v1 contract.
- Not yet verified on a live WordPress install from this environment (no Docker daemon or MySQL available): smoke-test
  activation, the block editor preview and the menu item on a staging copy of the club site before production.
