=== DLang OS Connect ===
Contributors: dlangos
Tags: sports club, schedule, registration, camps, club management
Requires at least: 6.3
Tested up to: 6.8
Requires PHP: 7.4
Stable tag: 1.0.0
License: GPLv2 or later
License URI: https://www.gnu.org/licenses/gpl-2.0.html

Show your club's live programmes, camps, schedule, results, teams, shop, donations and news from DLang OS on your WordPress site, in your club's look.

== Description ==

DLang OS is a club operating system for sports clubs, teams and schools: registrations, camps, invoicing, attendance, bookings, shop and a parent app. This plugin connects your WordPress website to your club's DLang OS app, so everything you enter once in the app appears on your website automatically, in the same colours as the app.

* **Real HTML, good for search engines.** Lists are rendered on your server from the app's public API (no iframe), with schema.org structured data (SportsEvent for games and camps, Product for shop items).
* **Buttons go where the action is.** Register, Book, Buy and Donate buttons open the app (or, if you prefer, the app's form in a window on your site). Payments and logins always happen on the app.
* **Your club's look.** Colours come from the club theme in the app. Choose club colours, light or dark, and keep your website's fonts if you like.
* **Fast and resilient.** Responses are cached; if the app cannot be reached, visitors see the last saved copy. The app can refresh your site instantly through a signed webhook.
* **Multilingual.** Follows WPML or Polylang (or the site language) and asks the app for the same language. Ships with French, German and Italian translations.
* **Works alongside** SportsPress, WooCommerce, WPML and Polylang. A helper page shows what you have in SportsPress and WooCommerce, links to the app's importer and can redirect old event, team and product URLs to the app.

= Shortcodes and blocks =

Every shortcode is also a block (category "DLang OS") with a live preview.

* `[dlang_camps season="summer" year="2027"]` - camp seasons, editions, prices, places left, register buttons
* `[dlang_programs kind="team,clinic" season="2026-27" limit="6"]` - programmes open for registration
* `[dlang_schedule team="u14" type="game" days="30" limit="10"]` - upcoming games, trainings and events, plus a calendar subscription link
* `[dlang_results team="u14" season="2026-27" limit="10"]` - past games with scores
* `[dlang_teams]` - all teams with coaches and training times
* `[dlang_team slug="u14" show_roster="0"]` - one team page with its next games and latest results
* `[dlang_coaches]` - coaching staff
* `[dlang_training]` - bookable player-development sessions and packages
* `[dlang_shop category="apparel" limit="12"]` - shop items with buy buttons
* `[dlang_donate campaign="new-hoops"]` - fundraising campaigns with progress
* `[dlang_news limit="3"]` - latest public club news
* `[dlang_login label="My account"]` - button to the app's login and family area
* `[dlang_embed widget="book"]` - an interactive app widget in an iframe (camps, programs, schedule, results, teams, book, shop, donate, login, register/<programme-slug>)

All list shortcodes also take `lang="fr"` (force a language) and `theme="club|light|dark"`. Shortcodes with structured data take `schema="0"` to switch it off (for example if another plugin already outputs it).

= Privacy =

The plugin only shows what your club marked as public in the app. Children appear at most with first name and initial and a shirt number, and only where the club recorded media consent; team rosters are hidden unless you switch them on per team. The plugin sets no cookies. The optional "Install the app" hint remembers a dismissal in the visitor's browser (localStorage). Your webhook secret never leaves the server.

The plugin connects to the app address you configure (your club's DLang OS app) to load public data. No data about your visitors is sent.

== Installation ==

1. Upload the zip in Plugins > Add New > Upload Plugin, then activate.
2. Go to Settings > DLang OS. Enter your app address (https://...) and your club slug (shown in the app under Settings > Website). Save, then click "Test connection": you should see your club name and logo.
3. In the app, under Settings > Website, enable the website connection, add your website address to the allowed website origins, paste the webhook URL shown on the plugin's settings page, and copy the website secret back into the plugin.
4. Add shortcodes or blocks to your pages.
5. Optional: add the "My account" item to your menu in Appearance > Menus (box "DLang OS").

== Frequently Asked Questions ==

= The widgets show "See this on the club app" =

The app could not be reached and no saved copy exists yet. Logged-in editors see the exact reason. Check the app address, the club slug and that the website connection is enabled in the app.

= Changes in the app take a few minutes to appear =

Set up the webhook (step 3 above) so the app refreshes the site immediately, or lower the cache duration. Common page caches (WP Rocket, W3 Total Cache, WP Super Cache, LiteSpeed) are cleared too.

= Does it replace SportsPress or WooCommerce? =

It can. Tools > Move to DLang OS shows what you have, links to the app's importer, can redirect old URLs (301) to the matching app pages and has a checklist for switching off WooCommerce checkout once the shop runs in the app. Nothing is deleted.

= Can I style it? =

All colours, radii and fonts are CSS custom properties (`--dlos-*`) on the `.dlos` wrapper; override them in your theme's CSS.

== Changelog ==

= 1.0.0 =
* First release: 13 shortcodes and blocks, club theming, caching with stale fallback, signed purge webhook, account menu item, install hint, migration helper with redirects, FR/DE/IT translations.
