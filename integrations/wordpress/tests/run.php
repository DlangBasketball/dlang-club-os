<?php
/**
 * Lightweight tests for DLang OS Connect. Run: php integrations/wordpress/tests/run.php
 *
 * @package DLangOSConnect
 */

// phpcs:ignoreFile

error_reporting( E_ALL );
set_error_handler(
	function ( $severity, $message, $file, $line ) {
		throw new ErrorException( $message, 0, $severity, $file, $line );
	}
);

require __DIR__ . '/bootstrap.php';

$GLOBALS['dlos_pass']  = 0;
$GLOBALS['dlos_fail']  = array();
$GLOBALS['dlos_tests'] = array();

function test( $name, callable $fn ) {
	$GLOBALS['dlos_tests'][ $name ] = $fn;
}

function ok( $cond, $msg ) {
	if ( $cond ) {
		$GLOBALS['dlos_pass']++;
		return;
	}
	throw new Exception( 'Assertion failed: ' . $msg );
}

function same( $expected, $actual, $msg ) {
	ok( $expected === $actual, $msg . ' (expected ' . var_export( $expected, true ) . ', got ' . var_export( $actual, true ) . ')' );
}

function contains( $haystack, $needle, $msg ) {
	ok( false !== strpos( $haystack, $needle ), $msg . ' (missing "' . $needle . '")' );
}

function not_contains( $haystack, $needle, $msg ) {
	ok( false === strpos( $haystack, $needle ), $msg . ' (found "' . $needle . '")' );
}

/** Decode the JSON-LD block(s) of rendered HTML. */
function jsonld( $html ) {
	if ( ! preg_match_all( '#<script type="application/ld\+json">(.*?)</script>#s', $html, $m ) ) {
		return array();
	}
	$out = array();
	foreach ( $m[1] as $json ) {
		$doc = json_decode( $json, true );
		ok( is_array( $doc ), 'JSON-LD is valid JSON' );
		$out = array_merge( $out, $doc['@graph'] );
	}
	return $out;
}

/** Visible HTML without the JSON-LD scripts. */
function visible( $html ) {
	return preg_replace( '#<script type="application/ld\+json">.*?</script>#s', '', $html );
}

/** No executable injection survived. */
function assert_safe( $html, $label ) {
	$v = visible( $html );
	not_contains( $v, '<script', $label . ': no script tag in visible HTML' );
	not_contains( $v, 'javascript:', $label . ': no javascript: URL' );
	not_contains( $v, '<img src=x', $label . ': no injected img' );
	ok( ! preg_match( '/<[^>]+\sonerror=/i', $v ), $label . ': no event-handler attribute' );
	// Exactly as many </script> as JSON-LD blocks: the payload cannot close the JSON-LD script early.
	ok( substr_count( $html, '</script>' ) === substr_count( $html, '<script type="application/ld+json">' ), $label . ': no early </script>' );
}

/* ---------------------------------------------------------------------- */
/* Signature                                                               */
/* ---------------------------------------------------------------------- */

test(
	'signature: good, bad, expired',
	function () {
		$secret = 'test-secret-123';
		$now    = 1800000000;
		$body   = '{"type":"content.updated","resource":"camps","club":"demo-club","at":"' . gmdate( 'c', $now - 10 ) . '"}';
		$sig    = DLOS_Signature::sign( $body, $secret );

		same( true, DLOS_Signature::verify( $body, $sig, (string) $now, $secret, $now ), 'valid signature accepted' );
		same( true, DLOS_Signature::verify( $body, strtoupper( substr( $sig, 7 ) ), (string) ( $now * 1000 ), $secret, $now ), 'bare upper-case hex and ms timestamp accepted' );
		same( true, DLOS_Signature::verify( $body, $sig, gmdate( 'c', $now + 120 ), $secret, $now ), 'ISO timestamp within tolerance accepted' );

		same( 'bad_signature', DLOS_Signature::verify( $body . ' ', $sig, (string) $now, $secret, $now ), 'modified body rejected' );
		same( 'bad_signature', DLOS_Signature::verify( $body, DLOS_Signature::sign( $body, 'other' ), (string) $now, $secret, $now ), 'wrong secret rejected' );
		same( 'bad_signature', DLOS_Signature::verify( $body, 'sha256=xyz', (string) $now, $secret, $now ), 'malformed signature rejected' );
		same( 'bad_signature', DLOS_Signature::verify( $body, '', (string) $now, $secret, $now ), 'missing signature rejected' );

		same( 'expired', DLOS_Signature::verify( $body, $sig, (string) ( $now - 301 ), $secret, $now ), 'old timestamp header rejected' );
		same( 'expired', DLOS_Signature::verify( $body, $sig, (string) ( $now + 400 ), $secret, $now ), 'future timestamp header rejected' );
		same( 'expired', DLOS_Signature::verify( $body, $sig, '', $secret, $now ), 'missing timestamp rejected' );

		$old  = '{"resource":"camps","at":"' . gmdate( 'c', $now - 3600 ) . '"}';
		same( 'expired', DLOS_Signature::verify( $old, DLOS_Signature::sign( $old, $secret ), (string) $now, $secret, $now ), 'replayed body (old signed "at") rejected even with a fresh header' );

		same( 'not_configured', DLOS_Signature::verify( $body, $sig, (string) $now, '', $now ), 'no secret configured' );
	}
);

test(
	'purge endpoint handler',
	function () {
		dlos_test_reset();
		$secret = 's3cret';
		$now    = time();
		$body   = json_encode( array( 'type' => 'content.updated', 'resource' => 'camps', 'club' => 'demo-club', 'at' => gmdate( 'c', $now ) ) );

		$before = DLOS_Cache::generation( 'camps' );
		$r      = DLOS_Rest::handle( $body, DLOS_Signature::sign( $body, $secret ), (string) $now, $secret, 'demo-club', $now );
		same( 200, $r['status'], 'valid purge accepted' );
		same( array( 'camps', 'programs' ), $r['body']['purged'], 'camps purge also purges programmes' );
		ok( DLOS_Cache::generation( 'camps' ) > $before, 'camps generation bumped' );

		$r = DLOS_Rest::handle( $body, 'sha256=' . str_repeat( '0', 64 ), (string) $now, $secret, 'demo-club', $now );
		same( 401, $r['status'], 'bad signature -> 401' );

		$r = DLOS_Rest::handle( $body, DLOS_Signature::sign( $body, $secret ), (string) $now, '', 'demo-club', $now );
		same( 503, $r['status'], 'no secret -> 503' );

		$other = json_encode( array( 'resource' => 'camps', 'club' => 'another-club', 'at' => gmdate( 'c', $now ) ) );
		$r     = DLOS_Rest::handle( $other, DLOS_Signature::sign( $other, $secret ), (string) $now, $secret, 'demo-club', $now );
		same( 409, $r['status'], 'other club -> 409' );

		$all = json_encode( array( 'resource' => 'club', 'at' => gmdate( 'c', $now ) ) );
		$r   = DLOS_Rest::handle( $all, DLOS_Signature::sign( $all, $secret ), (string) $now, $secret, 'demo-club', $now );
		same( array( '*' ), $r['body']['purged'], 'club change purges everything' );
	}
);

/* ---------------------------------------------------------------------- */
/* Cache                                                                   */
/* ---------------------------------------------------------------------- */

test(
	'cache keys',
	function () {
		dlos_test_reset();
		$a = DLOS_Cache::key( 'f', 'events', array( 'team' => 'u14', 'type' => 'game' ), 'fr', 'demo-club', 3 );
		$b = DLOS_Cache::key( 'f', 'events', array( 'type' => 'game', 'team' => 'u14', 'from' => '' ), 'fr', 'demo-club', 3 );
		same( $a, $b, 'param order and empty params do not change the key' );
		ok( $a !== DLOS_Cache::key( 'f', 'events', array( 'team' => 'u14', 'type' => 'game' ), 'en', 'demo-club', 3 ), 'language is part of the key' );
		ok( $a !== DLOS_Cache::key( 'f', 'events', array( 'team' => 'u16', 'type' => 'game' ), 'fr', 'demo-club', 3 ), 'params are part of the key' );
		ok( $a !== DLOS_Cache::key( 'f', 'events', array( 'team' => 'u14', 'type' => 'game' ), 'fr', 'other', 3 ), 'club is part of the key' );
		ok( $a !== DLOS_Cache::key( 'f', 'events', array( 'team' => 'u14', 'type' => 'game' ), 'fr', 'demo-club', 4 ), 'generation changes fresh keys' );
		same(
			DLOS_Cache::key( 's', 'events', array( 'team' => 'u14' ), 'fr', 'demo-club', 1 ),
			DLOS_Cache::key( 's', 'events', array( 'team' => 'u14' ), 'fr', 'demo-club', 9 ),
			'stale keys survive purges'
		);
		ok( 0 === strpos( $a, 'dlos_f_events_' ), 'key is prefixed for cleanup' );
		ok( strlen( $a ) <= 64, 'key fits transient limits' );

		$g = DLOS_Cache::generation( 'shop' );
		DLOS_Cache::purge( '' );
		ok( DLOS_Cache::generation( 'shop' ) > $g, 'global purge changes every generation' );
		same( array( 'programs', 'camps' ), DLOS_Cache::affected( 'program' ), 'singular resource names accepted' );
		same( array( '*' ), DLOS_Cache::affected( 'something-new' ), 'unknown resource purges everything (safe default)' );
		$t = DLOS_Cache::generation( 'teams' );
		DLOS_Cache::purge( 'shop' );
		same( $t, DLOS_Cache::generation( 'teams' ), 'shop purge leaves teams alone' );
	}
);

test(
	'api: fetch, cache, stale-while-error',
	function () {
		dlos_test_reset();
		$fixture                   = dlos_fixture( 'events' );
		$GLOBALS['dlos_test_http'] = function ( $url ) use ( $fixture ) {
			return dlos_http_ok( $fixture );
		};
		$r = DLOS_Api::get( 'events', array( 'team' => 'u14', 'evil' => 'x', 'type' => 'game<script>' ), 'fr' );
		ok( $r['ok'] && ! $r['stale'], 'first call fetches' );
		same( 3, count( $r['envelope']['data'] ), 'items kept' );
		$url = $GLOBALS['dlos_test_http_calls'][0][0];
		contains( $url, 'https://app.example.org/api/public/v1/events?club=demo-club&lang=fr', 'URL built from settings' );
		not_contains( $url, 'evil', 'unknown params dropped' );
		contains( $url, 'type=gamescript', 'param values reduced to safe characters' );
		same( 6, $GLOBALS['dlos_test_http_calls'][0][1]['timeout'], 'request has a timeout' );

		DLOS_Api::get( 'events', array( 'team' => 'u14', 'type' => 'game<script>' ), 'fr' );
		same( 1, count( $GLOBALS['dlos_test_http_calls'] ), 'second call served from cache' );

		// App goes down and the cache is purged: the stale copy is served with a flag.
		DLOS_Cache::purge( 'events' );
		$GLOBALS['dlos_test_http'] = function () {
			return new WP_Error( 'down' );
		};
		$r = DLOS_Api::get( 'events', array( 'team' => 'u14', 'type' => 'game<script>' ), 'fr' );
		ok( $r['ok'] && $r['stale'], 'stale copy served while the app is down' );
		same( 'unreachable', $r['error'], 'reason reported' );
		$calls = count( $GLOBALS['dlos_test_http_calls'] );
		$r     = DLOS_Api::get( 'events', array( 'team' => 'u14', 'type' => 'game<script>' ), 'fr' );
		ok( $r['stale'] && count( $GLOBALS['dlos_test_http_calls'] ) === $calls, 'back-off: no new request right after a failure' );

		// No copy at all -> error.
		$r = DLOS_Api::get( 'events', array( 'team' => 'u99' ), 'fr' );
		ok( ! $r['ok'], 'no stale copy -> error' );

		// Invalid payloads are rejected.
		$GLOBALS['dlos_test_http'] = function () {
			return dlos_http_ok( '{"data": {"not": "a list"}}' );
		};
		same( 'invalid_response', DLOS_Api::get( 'shop', array(), 'fr' )['error'], 'object instead of list rejected' );
		$GLOBALS['dlos_test_http'] = function () {
			return array( 'response' => array( 'code' => 404 ), 'body' => '{"error":"not_found"}' );
		};
		same( 'not_found', DLOS_Api::get( 'teams', array(), 'fr' )['error'], '404 mapped to not_found' );

		same( 'unknown_endpoint', DLOS_Api::get( '../admin', array(), 'fr' )['error'], 'unknown endpoints refused' );
	}
);

test(
	'settings: https only, secret kept',
	function () {
		dlos_test_reset( array( 'webhook_secret' => 'keep-me' ) );
		same( '', DLOS_Settings::normalize_app_url( 'http://app.example.org' ), 'http refused' );
		same( '', DLOS_Settings::normalize_app_url( 'javascript:alert(1)' ), 'javascript refused' );
		same( '', DLOS_Settings::normalize_app_url( 'https://user:pw@app.example.org' ), 'credentials in URL refused' );
		same( 'https://app.example.org/club', DLOS_Settings::normalize_app_url( 'https://APP.example.org/club/' ), 'normalised' );
		$s = DLOS_Settings::sanitize(
			array(
				'app_url'        => 'https://app.example.org',
				'club_slug'      => 'Demo Club!',
				'theme'          => 'neon',
				'cache_ttl'      => '99999',
				'webhook_secret' => '',
				'lang_mode'      => 'xx',
			)
		);
		same( 'democlub', $s['club_slug'], 'slug sanitised' );
		same( 'club', $s['theme'], 'unknown theme -> default' );
		same( 1440, $s['cache_ttl'], 'ttl clamped' );
		same( 'keep-me', $s['webhook_secret'], 'blank secret keeps the stored one' );
		same( 'auto', $s['lang_mode'], 'unknown language mode -> auto' );
	}
);

test(
	'language detection',
	function () {
		dlos_test_reset();
		$GLOBALS['dlos_test_locale'] = 'de_CH';
		same( 'de', DLOS_Language::current(), 'site locale' );
		add_filter(
			'wpml_current_language',
			function () {
				return 'fr';
			}
		);
		same( 'fr', DLOS_Language::current(), 'WPML wins in auto mode' );
		same( 'it', DLOS_Language::current( 'it_IT' ), 'explicit override' );
		update_option( DLOS_Settings::OPTION, array_merge( DLOS_Settings::all(), array( 'lang_mode' => 'site' ) ) );
		same( 'de', DLOS_Language::current(), 'site mode ignores WPML' );
		$GLOBALS['dlos_test_locale'] = 'ja';
		same( '', DLOS_Language::current(), 'unsupported locale -> club default' );
		$GLOBALS['dlos_test_locale'] = 'en_US';
	}
);

/* ---------------------------------------------------------------------- */
/* Rendering                                                               */
/* ---------------------------------------------------------------------- */

test(
	'render camps (escaping, CTAs, theme, JSON-LD)',
	function () {
		dlos_test_reset();
		$env  = DLOS_Validator::envelope( dlos_fixture( 'camps' ), 'camps' );
		$html = DLOS_Renderer::camps( $env, array(), dlos_ctx( array( 'theme' => 'club' ) ) );

		assert_safe( $html, 'camps' );
		contains( $html, 'Summer camps 2027', 'group title' );
		contains( $html, 'Week 1 &lt;script&gt;', 'malicious name shown as text' );
		contains( $html, 'Salle &quot;&gt;&lt;img', 'malicious venue escaped' );
		contains( $html, '5–9 juillet 2027', 'formatted dates from the API' );
		contains( $html, 'Ages 8–14', 'age range' );
		contains( $html, 'CHF 550.00', 'price' );
		contains( $html, 'members CHF 495.00', 'member price' );
		contains( $html, '4 places left', 'places left' );
		contains( $html, 'href="https://app.example.org/camps/summer-2027?add=ed-1"', 'register CTA to action_url' );
		contains( $html, 'target="_blank" rel="noopener"', 'opens the app in a new tab' );
		same( 'Join the waiting list', DLOS_Renderer::register_label( 'full' ), 'full edition offers the waiting list' );
		same( 1, substr_count( $html, 'dlos-card__actions' ), 'no button for an edition whose action URL is unsafe' );
		not_contains( $html, 'data-dlos-embed', 'no embed attribute in app mode' );

		// Theme: known tokens mapped, unknown and unsafe ones dropped, fonts inherited by default.
		contains( $html, '--dlos-primary:#0B5FFF', 'club primary colour mapped' );
		not_contains( $html, 'evil', 'unknown token dropped' );
		not_contains( $html, 'url(', 'unsafe CSS value dropped' );
		not_contains( $html, 'Inter', 'club font skipped when inheriting fonts' );

		same( 2, count( jsonld( $html ) ), 'JSON-LD node count' );
	}
);

test(
	'camps JSON-LD content',
	function () {
		dlos_test_reset();
		$env   = DLOS_Validator::envelope( dlos_fixture( 'camps' ), 'camps' );
		$html  = DLOS_Renderer::camps( $env, array(), dlos_ctx() );
		$nodes = jsonld( $html );
		same( 2, count( $nodes ), 'one SportsEvent per edition' );
		same( 'SportsEvent', $nodes[0]['@type'], 'type' );
		same( '2027-07-05', $nodes[0]['startDate'], 'start date' );
		same( '2027-07-09', $nodes[0]['endDate'], 'end date' );
		same( 550.0, (float) $nodes[0]['offers'][0]['price'], 'offer price' );
		same( 'CHF', $nodes[0]['offers'][0]['priceCurrency'], 'currency' );
		same( 'https://schema.org/InStock', $nodes[0]['offers'][0]['availability'], 'availability' );
		same( 'Demo Hoops Club', $nodes[0]['organizer']['name'], 'organizer' );
		same( "Week 2 </script><script>alert(2)</script>", $nodes[1]['name'], 'payload kept as data (hex-escaped in the HTML)' );
		ok( ! isset( $nodes[1]['url'] ) || 0 === strpos( $nodes[1]['url'], 'https://' ), 'javascript: URL not used in JSON-LD' );
		contains( $html, '</script>', 'closing tag hex-escaped inside JSON-LD' );

		$off = DLOS_Renderer::camps( $env, array( 'schema' => '0' ), dlos_ctx() );
		not_contains( $off, 'application/ld+json', 'schema="0" disables JSON-LD' );
		$off = DLOS_Renderer::camps( $env, array(), dlos_ctx( array( 'jsonld' => false ) ) );
		not_contains( $off, 'application/ld+json', 'global setting disables JSON-LD' );
	}
);

test(
	'render camps in embed mode and light theme',
	function () {
		dlos_test_reset();
		$env  = DLOS_Validator::envelope( dlos_fixture( 'camps' ), 'camps' );
		$html = DLOS_Renderer::camps( $env, array(), dlos_ctx( array( 'interactive' => 'embed', 'theme' => 'light', 'inherit_fonts' => false ) ) );
		contains( $html, 'data-dlos-embed="https://app.example.org/embed/camps?club=demo-club&#038;lang=fr&#038;theme=light&#038;origin=https%3A%2F%2Fclub.example.org&#038;season=summer&#038;year=2027"', 'embed URL with origin for the iframe' );
		contains( $html, 'dlos-theme--light', 'light theme class' );
		not_contains( $html, '--dlos-bg:', 'light mode does not take the club surfaces' );
		contains( $html, '--dlos-primary:#0B5FFF', 'light mode keeps the brand colour' );
		contains( $html, '--dlos-font-ui:&quot;Inter&quot;, sans-serif', 'club font used when not inheriting' );
	}
);

test(
	'render schedule and results',
	function () {
		dlos_test_reset();
		$env  = DLOS_Validator::envelope( dlos_fixture( 'events' ), 'events' );
		$html = DLOS_Renderer::schedule( $env, array( 'team' => 'u14', 'type' => 'game' ), dlos_ctx() );
		assert_safe( $html, 'schedule' );
		contains( $html, 'Riverside &lt;b&gt;BC&lt;/b&gt; vs U14 Boys', 'away game: opponent first, HTML escaped' );
		contains( $html, '<time datetime="2027-02-06T14:00:00+01:00">sam. 6 févr. 2027, 14:00</time>', 'machine and human dates' );
		contains( $html, 'Cancelled', 'cancelled badge' );
		contains( $html, 'dlos-event--cancelled', 'cancelled class' );
		contains( $html, 'href="https://maps.example.org/?q=riverside"', 'directions link' );
		contains( $html, 'calendar.ics?club=demo-club&#038;lang=fr&#038;team=u14&#038;type=game', 'iCal link with filters' );
		not_contains( $html, 'Directions</a> <a class="dlos-link" href="javascript', 'unsafe maps URL skipped' );

		$nodes = jsonld( $html );
		same( 2, count( $nodes ), 'JSON-LD for games only' );
		same( 'Riverside <b>BC</b>', $nodes[0]['homeTeam']['name'], 'home team is the opponent for an away game' );
		same( 'U14 Boys', $nodes[0]['awayTeam']['name'], 'away team' );
		same( 'Riverside Arena', $nodes[0]['location']['name'], 'location' );
		same( 'https://schema.org/EventScheduled', $nodes[0]['eventStatus'], 'status' );

		$res = DLOS_Renderer::results( $env, array( 'limit' => '5' ), dlos_ctx() );
		contains( $res, '64 – 58', 'score' );
		contains( $res, 'dlos-badge--win', 'outcome badge' );

		$empty = DLOS_Renderer::schedule( array( 'club' => $env['club'], 'data' => array() ), array(), dlos_ctx() );
		contains( $empty, 'Nothing is scheduled', 'empty state' );

		$stale = DLOS_Renderer::schedule( $env, array(), dlos_ctx( array( 'stale' => true ) ) );
		contains( $stale, 'role="status"', 'stale note is announced' );
	}
);

test(
	'render shop (Product JSON-LD) and team',
	function () {
		dlos_test_reset();
		$env  = DLOS_Validator::envelope( dlos_fixture( 'shop' ), 'shop' );
		$html = DLOS_Renderer::shop( $env, array(), dlos_ctx() );
		assert_safe( $html, 'shop' );
		contains( $html, '<strong>mesh</strong>', 'allowed HTML kept in descriptions' );
		not_contains( $html, '<script>steal', 'script tag removed from description (WordPress keeps the inner text as harmless text)' );
		contains( $html, 'Options: S, M, L', 'variants' );
		contains( $html, 'Out of stock', 'stock badge' );
		$nodes = jsonld( $html );
		same( 'Product', $nodes[0]['@type'], 'Product node' );
		same( 'Breathable mesh.', $nodes[0]['description'], 'plain-text description' );
		same( 45.0, (float) $nodes[0]['offers']['price'], 'price' );
		same( 'https://schema.org/OutOfStock', $nodes[1]['offers']['availability'], 'out of stock' );
		same( array( 'https://cdn.example.org/hoodie.jpg' ), $nodes[1]['image'], 'image object form' );

		$teams = DLOS_Validator::envelope( dlos_fixture( 'teams' ), 'teams' );
		$team  = DLOS_Renderer::team( $teams, array( 'slug' => 'u14', 'show_roster' => '0' ), dlos_ctx() );
		contains( $team, 'Alex Sample', 'coach' );
		contains( $team, 'Tuesday 18:00–19:30', 'training time' );
		not_contains( $team, 'Sam T.', 'roster hidden unless enabled' );
		$team = DLOS_Renderer::team( $teams, array( 'slug' => 'u14', 'show_roster' => '1' ), dlos_ctx() );
		contains( $team, 'Sam T.', 'roster shown when enabled' );
		contains( $team, 'Kim &lt;i&gt;R.&lt;/i&gt;', 'roster names escaped' );
		contains( DLOS_Renderer::team( $teams, array( 'slug' => 'nope' ), dlos_ctx() ), 'not found', 'unknown team' );
	}
);

test(
	'error states and embed widget',
	function () {
		$visitor = DLOS_Renderer::error_state( 'camps', 'unreachable', false, 'https://app.example.org' );
		contains( $visitor, 'See this on the club app', 'visitors get a link' );
		not_contains( $visitor, 'unreachable', 'no technical detail for visitors' );
		contains( DLOS_Renderer::error_state( 'camps', 'not_found', true, '' ), 'club slug', 'admins get a hint' );

		$e = DLOS_Renderer::embed( array( 'widget' => 'register/u14-boys', 'season' => 'x"><script>' ), dlos_ctx() );
		contains( $e, 'data-dlang-widget="register/u14-boys"', 'embed.js widget attribute' );
		contains( $e, 'data-club="demo-club"', 'club attribute' );
		not_contains( $e, '<script>', 'params sanitised' );
		same( '', DLOS_Renderer::embed( array( 'widget' => 'admin' ), dlos_ctx() ), 'unknown widget refused' );
	}
);

test(
	'shortcode entry point end to end',
	function () {
		dlos_test_reset( array( 'interactive' => 'embed', 'theme' => 'dark' ) );
		$fixtures                  = array(
			'camps'  => dlos_fixture( 'camps' ),
			'events' => dlos_fixture( 'events' ),
			'teams'  => dlos_fixture( 'teams' ),
		);
		$GLOBALS['dlos_test_http'] = function ( $url ) use ( $fixtures ) {
			preg_match( '#/api/public/v1/([a-z]+)\?#', $url, $m );
			return isset( $fixtures[ $m[1] ] ) ? dlos_http_ok( $fixtures[ $m[1] ] ) : array( 'response' => array( 'code' => 500 ), 'body' => '' );
		};
		$html = DLOS_Widgets::render( 'camps', array( 'season' => 'summer', 'lang' => 'de', 'theme' => 'light' ) );
		contains( $GLOBALS['dlos_test_http_calls'][0][0], 'camps?club=demo-club&lang=de&season=summer', 'shortcode attributes reach the API' );
		contains( $html, 'dlos-theme--light', 'per-shortcode theme override' );
		contains( $html, 'data-dlos-embed=', 'embed mode from settings' );
		ok( in_array( 'style:dlos-front', $GLOBALS['dlos_test_enqueued'], true ), 'stylesheet enqueued' );

		$sched = DLOS_Widgets::render( 'schedule', array( 'team' => 'u14', 'days' => '30' ) );
		$url   = end( $GLOBALS['dlos_test_http_calls'] )[0];
		contains( $url, 'from=' . gmdate( 'Y-m-d' ), 'schedule starts today' );
		contains( $url, 'to=' . gmdate( 'Y-m-d', time() + 30 * DAY_IN_SECONDS ), 'schedule window from days' );
		contains( $sched, 'dlos-theme--dark', 'site default theme' );

		$team = DLOS_Widgets::render( 'team', array( 'slug' => 'u14', 'show_roster' => false ) );
		contains( $team, 'Next games and events', 'team page includes its schedule' );
		not_contains( $team, 'Sam T.', 'block boolean false keeps roster hidden' );

		$fail = DLOS_Widgets::render( 'shop', array() );
		contains( $fail, 'See this on the club app', 'visitor fallback when the app errors' );

		$embed = DLOS_Widgets::render( 'embed', array( 'widget' => 'book' ) );
		contains( $embed, 'data-dlang-widget="book"', 'embed widget' );
		ok( in_array( 'script:dlos-app-embed@https://app.example.org/embed.js', $GLOBALS['dlos_test_enqueued'], true ), 'embed.js loaded from the app' );

		same( '', DLOS_Widgets::render( 'nope', array() ), 'unknown widget renders nothing' );
		same( 'https://app.example.org/login', DLOS_Widgets::login_url( null ), 'login URL fallback' );
	}
);

test(
	'theme sanitising and contrast guard',
	function () {
		$t = DLOS_Theme::sanitize_theme(
			array(
				'--brand-primary' => '#123456',
				'bg'              => '#FFFFFF',
				'--surface'       => '#FFFFFF',
				'--text'          => '#FAFAFA',
				'--font-ui'       => 'var(--font-geist, "Geist"), sans-serif',
				'--brand-accent'  => 'expression(alert(1))',
				'--radius-md'     => '8px;}body{display:none',
			)
		);
		ok( ! isset( $t['brand-accent'] ) && ! isset( $t['radius-md'] ), 'unsafe values dropped' );
		same( 'var(--font-geist, "Geist"), sans-serif', $t['font-ui'], 'font stacks allowed' );
		$style = DLOS_Theme::style( $t, 'club', true );
		not_contains( $style, '--dlos-text:', 'unreadable text/surface pair falls back to defaults' );
		contains( $style, '--dlos-primary:#123456', 'brand colour kept' );
		ok( DLOS_Theme::contrast( '#000000', '#FFFFFF' ) > 20.9, 'contrast maths' );
	}
);

/* ---------------------------------------------------------------------- */
/* Redirects                                                               */
/* ---------------------------------------------------------------------- */

test(
	'redirect map building and lookup',
	function () {
		$events = dlos_fixture( 'events' )['data'];
		$teams  = dlos_fixture( 'teams' )['data'];
		$shop   = dlos_fixture( 'shop' )['data'];
		$wp     = array(
			array( 'kind' => 'team', 'path' => 'https://club.example.org/team/u14/', 'slug' => 'u14', 'name' => 'U14' ),
			array( 'kind' => 'team', 'path' => 'https://club.example.org/team/girls-u16/', 'slug' => 'girls-u16', 'name' => 'U16 Girls' ),
			array( 'kind' => 'team', 'path' => 'https://club.example.org/team/seniors/', 'slug' => 'seniors', 'name' => 'Seniors' ),
			array( 'kind' => 'event', 'path' => 'https://club.example.org/event/riverside-u14/', 'slug' => 'riverside-u14', 'name' => 'Riverside BC vs Demo U14', 'date' => '2027-02-06 14:00:00' ),
			array( 'kind' => 'event', 'path' => 'https://club.example.org/event/old-game/', 'slug' => 'old-game', 'name' => 'Riverside BC vs Demo U14', 'date' => '2025-02-06 14:00:00' ),
			array( 'kind' => 'product', 'path' => 'https://club.example.org/fr/produit/maillot/', 'home_path' => '/', 'slug' => 'home-jersey', 'name' => 'Maillot' ),
			array( 'kind' => 'product', 'path' => 'https://club.example.org/produit/sweat/', 'slug' => 'sweat', 'name' => 'Club Hoodie' ),
		);
		$r = DLOS_Redirects::build_map( $wp, array( 'event' => $events, 'team' => $teams, 'product' => $shop ) );
		$m = $r['map'];
		same( 'https://app.example.org/club/teams/u14', $m['team/u14/'], 'team by slug' );
		same( 'https://app.example.org/club/teams/u16', $m['team/girls-u16/'], 'team by name' );
		same( 'https://app.example.org/club/events/ev-1', $m['event/riverside-u14/'], 'game by date + opponent' );
		same( 'https://app.example.org/shop/home-jersey', $m['fr/produit/maillot/'], 'product by slug (WPML language prefix kept in path)' );
		same( 'https://app.example.org/shop/hoodie', $m['produit/sweat/'], 'product by name, case-insensitive' );
		same( array( 'team/seniors/', 'event/old-game/' ), $r['unmatched'], 'unmatched reported, never guessed' );

		same( 'team/u14/', DLOS_Redirects::normalize_path( '/Team/U14?ref=x' ), 'path normalised' );
		same( 'team/u14/', DLOS_Redirects::normalize_path( '/site/team/u14/', '/site/' ), 'sub-directory install' );
		same( 'https://app.example.org/club/teams/u14', DLOS_Redirects::lookup( $m, 'team/u14/', 'https://app.example.org' ), 'lookup' );
		same( '', DLOS_Redirects::lookup( array( 'x/' => 'https://evil.example/' ), 'x/', 'https://app.example.org' ), 'foreign host never redirected (no open redirect)' );
		same( '', DLOS_Redirects::lookup( $m, 'team/u14/', '' ), 'no app configured -> no redirect' );
	}
);

test(
	'validator',
	function () {
		ok( null === DLOS_Validator::envelope( 'nope', 'shop' ), 'string rejected' );
		ok( null === DLOS_Validator::envelope( array( 'club' => array() ), 'shop' ), 'missing data rejected' );
		$e = DLOS_Validator::envelope( array( 'club' => array( 'logo_url' => 'javascript:x', 'name' => 'C' ), 'data' => array( array( 'a' => 1 ), 'str', 5 ) ), 'shop' );
		same( 1, count( $e['data'] ), 'non-object items dropped' );
		same( '', $e['club']['logo_url'], 'unsafe logo URL dropped' );
		ok( null !== DLOS_Validator::envelope( array( 'data' => array( 'name' => 'Club' ) ), 'club' ), 'club endpoint returns an object' );
	}
);

/* ---------------------------------------------------------------------- */

foreach ( $GLOBALS['dlos_tests'] as $name => $fn ) {
	try {
		$fn();
		echo "  ok   {$name}\n";
	} catch ( Throwable $e ) {
		$GLOBALS['dlos_fail'][] = $name;
		echo "  FAIL {$name}\n       " . $e->getMessage() . ' @ ' . basename( $e->getFile() ) . ':' . $e->getLine() . "\n";
	}
}
$failed = count( $GLOBALS['dlos_fail'] );
echo "\n" . ( defined( 'DLOS_TEST_REAL_CORE' ) ? '[WordPress core escaping/kses from WP_CORE_DIR] ' : '[stubbed WordPress functions] ' ) . count( $GLOBALS['dlos_tests'] ) . ' tests, ' . $GLOBALS['dlos_pass'] . ' assertions, ' . $failed . " failed\n";
exit( $failed ? 1 : 0 );
