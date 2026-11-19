<?php
/**
 * Minimal WordPress stubs so the plugin's classes can be tested with plain PHP (no WordPress, no PHPUnit).
 *
 * Escaping stubs follow core semantics closely enough for the assertions made in the tests.
 *
 * @package DLangOSConnect
 */

// phpcs:ignoreFile

define( 'ABSPATH', __DIR__ . '/' );
define( 'MINUTE_IN_SECONDS', 60 );
define( 'HOUR_IN_SECONDS', 3600 );
define( 'DAY_IN_SECONDS', 86400 );
define( 'MB_IN_BYTES', 1048576 );
define( 'DLOS_VERSION', 'test' );

$GLOBALS['dlos_test_options']    = array();
$GLOBALS['dlos_test_transients'] = array();
$GLOBALS['dlos_test_http']       = null; // callable( $url, $args ) => response array | WP_Error.
$GLOBALS['dlos_test_http_calls'] = array();
$GLOBALS['dlos_test_filters']    = array();
$GLOBALS['dlos_test_can']        = false;

/*
 * Optional: WP_CORE_DIR=/path/to/wordpress runs the same tests against WordPress' real escaping,
 * kses, hooks, URL and JSON functions (the stubs below only fill the gaps).
 */
$dlos_core = getenv( 'WP_CORE_DIR' );
if ( $dlos_core ) {
	define( 'WPINC', 'wp-includes' );
	$dlos_core = rtrim( $dlos_core, '/' ) . '/wp-includes/';
	foreach ( array( 'class-wp-error.php', 'plugin.php', 'formatting.php', 'kses.php' ) as $dlos_core_file ) {
		require_once $dlos_core . $dlos_core_file;
	}
	define( 'DLOS_TEST_REAL_CORE', true );
}

if ( ! function_exists( 'wp_allowed_protocols' ) ) {
	function wp_allowed_protocols() {
		return array( 'http', 'https', 'ftp', 'ftps', 'mailto', 'news', 'irc', 'irc6', 'ircs', 'gopher', 'nntp', 'feed', 'telnet', 'mms', 'rtsp', 'sms', 'svn', 'tel', 'fax', 'xmpp', 'webcal', 'urn' );
	}
}
if ( ! function_exists( 'is_utf8_charset' ) ) {
	function is_utf8_charset( $charset = null ) {
		return true;
	}
}
if ( ! function_exists( '_canonical_charset' ) ) {
	function _canonical_charset( $charset ) {
		return 'UTF-8';
	}
}
if ( ! function_exists( '_doing_it_wrong' ) ) {
	function _doing_it_wrong() {}
}
if ( ! function_exists( '_deprecated_argument' ) ) {
	function _deprecated_argument() {}
}
if ( ! function_exists( 'mbstring_binary_safe_encoding' ) ) {
	function mbstring_binary_safe_encoding( $reset = false ) {}
}
if ( ! function_exists( 'reset_mbstring_encoding' ) ) {
	function reset_mbstring_encoding() {}
}

if ( ! class_exists( 'WP_Error' ) ) {
	class WP_Error {
		public $code;
		public function __construct( $code = '' ) {
			$this->code = $code;
		}
	}
}

if ( ! function_exists( 'is_wp_error' ) ) {
function is_wp_error( $v ) {
	return $v instanceof WP_Error;
}
}

/* i18n: identity. */
if ( ! function_exists( '__' ) ) {
function __( $s, $d = null ) { return $s; }
}
if ( ! function_exists( '_x' ) ) {
function _x( $s, $c, $d = null ) { return $s; }
}
if ( ! function_exists( '_n' ) ) {
function _n( $s, $p, $n, $d = null ) { return 1 === (int) $n ? $s : $p; }
}
if ( ! function_exists( 'esc_html__' ) ) {
function esc_html__( $s, $d = null ) { return esc_html( $s ); }
}
if ( ! function_exists( 'esc_attr__' ) ) {
function esc_attr__( $s, $d = null ) { return esc_attr( $s ); }
}
if ( ! function_exists( 'esc_html_e' ) ) {
function esc_html_e( $s, $d = null ) { echo esc_html( $s ); }
}

/* Escaping. */
if ( ! function_exists( 'esc_html' ) ) {
function esc_html( $s ) { return htmlspecialchars( (string) $s, ENT_QUOTES, 'UTF-8' ); }
}
if ( ! function_exists( 'esc_attr' ) ) {
function esc_attr( $s ) { return htmlspecialchars( (string) $s, ENT_QUOTES, 'UTF-8' ); }
}
if ( ! function_exists( 'esc_url_raw' ) ) {
function esc_url_raw( $url, $protocols = null ) {
	$url = trim( (string) $url );
	if ( ! preg_match( '#^(https?)://#i', $url ) ) {
		return '';
	}
	return preg_replace( '/[^a-z0-9-~+_.?#=!&;,\/:%@$\|*\'()\[\]\\x80-\\xff]/i', '', $url );
}
}
if ( ! function_exists( 'esc_url' ) ) {
function esc_url( $url, $protocols = null ) {
	$clean = esc_url_raw( $url );
	return str_replace( array( '&', "'", '"' ), array( '&#038;', '&#039;', '&quot;' ), $clean );
}
}
if ( ! function_exists( 'sanitize_html_class' ) ) {
function sanitize_html_class( $c ) { return preg_replace( '/[^A-Za-z0-9_-]/', '', (string) $c ); }
}
if ( ! function_exists( 'sanitize_text_field' ) ) {
function sanitize_text_field( $s ) { return trim( preg_replace( '/[\r\n\t ]+/', ' ', strip_tags( (string) $s ) ) ); }
}
if ( ! function_exists( 'wp_strip_all_tags' ) ) {
function wp_strip_all_tags( $s ) {
	$s = preg_replace( '@<(script|style)[^>]*?>.*?</\\1>@si', '', (string) $s );
	return trim( strip_tags( $s ) );
}
}
/** Simplified wp_kses_post: allow a few tags, drop event handlers and javascript: URLs. */
if ( ! function_exists( 'wp_kses_post' ) ) {
function wp_kses_post( $html ) {
	$html = preg_replace( '@<(script|style|iframe)[^>]*?>.*?</\\1>@si', '', (string) $html );
	$html = strip_tags( $html, '<p><a><strong><em><ul><ol><li><br><b><i>' );
	$html = preg_replace( '/\s+on[a-z]+\s*=\s*("[^"]*"|\'[^\']*\'|[^\s>]+)/i', '', $html );
	$html = preg_replace( '/(href|src)\s*=\s*(["\']?)\s*javascript:[^"\'>\s]*\2/i', '$1=""', $html );
	return $html;
}
}
if ( ! function_exists( 'wp_json_encode' ) ) {
function wp_json_encode( $data, $flags = 0 ) { return json_encode( $data, $flags ); }
}
if ( ! function_exists( 'wp_parse_url' ) ) {
function wp_parse_url( $url, $component = -1 ) { return parse_url( (string) $url, $component ); }
}
if ( ! function_exists( 'wp_unslash' ) ) {
function wp_unslash( $v ) { return $v; }
}
if ( ! function_exists( 'remove_accents' ) ) {
function remove_accents( $s ) {
	$t = @iconv( 'UTF-8', 'ASCII//TRANSLIT//IGNORE', (string) $s );
	return false === $t ? (string) $s : $t;
}
}
if ( ! function_exists( 'number_format_i18n' ) ) {
function number_format_i18n( $n, $d = 0 ) { return number_format( (float) $n, $d, '.', "'" ); }
}
if ( ! function_exists( 'wp_date' ) ) {
function wp_date( $format, $ts = null ) { return gmdate( $format, null === $ts ? time() : $ts ); }
}
if ( ! function_exists( 'determine_locale' ) ) {
function determine_locale() { return isset( $GLOBALS['dlos_test_locale'] ) ? $GLOBALS['dlos_test_locale'] : 'en_US'; }
}
if ( ! function_exists( 'get_locale' ) ) {
function get_locale() { return determine_locale(); }
}
if ( ! function_exists( 'home_url' ) ) {
function home_url( $path = '' ) { return 'https://club.example.org' . $path; }
}
if ( ! function_exists( 'current_user_can' ) ) {
function current_user_can( $cap ) { return (bool) $GLOBALS['dlos_test_can']; }
}
if ( ! function_exists( 'is_admin' ) ) {
function is_admin() { return false; }
}

/* Hooks. */
if ( ! function_exists( 'add_filter' ) ) {
function add_filter( $tag, $cb, $prio = 10, $args = 1 ) { $GLOBALS['dlos_test_filters'][ $tag ][] = $cb; return true; }
}
if ( ! function_exists( 'add_action' ) ) {
function add_action( $tag, $cb, $prio = 10, $args = 1 ) { return add_filter( $tag, $cb, $prio, $args ); }
}
if ( ! function_exists( 'has_filter' ) ) {
function has_filter( $tag ) { return ! empty( $GLOBALS['dlos_test_filters'][ $tag ] ); }
}
if ( ! function_exists( 'apply_filters' ) ) {
function apply_filters( $tag, $value ) {
	$args = func_get_args();
	array_shift( $args );
	if ( ! empty( $GLOBALS['dlos_test_filters'][ $tag ] ) ) {
		foreach ( $GLOBALS['dlos_test_filters'][ $tag ] as $cb ) {
			$args[0] = call_user_func_array( $cb, $args );
		}
	}
	return $args[0];
}
}
if ( ! function_exists( 'do_action' ) ) {
function do_action( $tag ) {}
}
if ( ! function_exists( 'remove_all_filters' ) ) {
function remove_all_filters( $tag ) { unset( $GLOBALS['dlos_test_filters'][ $tag ] ); }
}

/* Options / transients (in memory). */
if ( ! function_exists( 'get_option' ) ) {
function get_option( $k, $default = false ) { return array_key_exists( $k, $GLOBALS['dlos_test_options'] ) ? $GLOBALS['dlos_test_options'][ $k ] : $default; }
}
if ( ! function_exists( 'update_option' ) ) {
function update_option( $k, $v, $autoload = null ) { $GLOBALS['dlos_test_options'][ $k ] = $v; return true; }
}
if ( ! function_exists( 'add_option' ) ) {
function add_option( $k, $v, $dep = '', $autoload = null ) { $GLOBALS['dlos_test_options'][ $k ] = $v; return true; }
}
if ( ! function_exists( 'delete_option' ) ) {
function delete_option( $k ) { unset( $GLOBALS['dlos_test_options'][ $k ] ); return true; }
}
if ( ! function_exists( 'get_transient' ) ) {
function get_transient( $k ) { return isset( $GLOBALS['dlos_test_transients'][ $k ] ) ? $GLOBALS['dlos_test_transients'][ $k ] : false; }
}
if ( ! function_exists( 'set_transient' ) ) {
function set_transient( $k, $v, $ttl = 0 ) {
	if ( strlen( $k ) > 172 ) {
		throw new Exception( 'transient name too long: ' . $k );
	}
	$GLOBALS['dlos_test_transients'][ $k ] = $v;
	return true;
}
}
if ( ! function_exists( 'delete_transient' ) ) {
function delete_transient( $k ) { unset( $GLOBALS['dlos_test_transients'][ $k ] ); return true; }
}

/* HTTP. */
if ( ! function_exists( 'wp_remote_get' ) ) {
function wp_remote_get( $url, $args = array() ) {
	$GLOBALS['dlos_test_http_calls'][] = array( $url, $args );
	$h = $GLOBALS['dlos_test_http'];
	return $h ? $h( $url, $args ) : new WP_Error( 'no_http' );
}
}
if ( ! function_exists( 'wp_remote_retrieve_response_code' ) ) {
function wp_remote_retrieve_response_code( $r ) { return is_array( $r ) && isset( $r['response']['code'] ) ? $r['response']['code'] : 0; }
}
if ( ! function_exists( 'wp_remote_retrieve_body' ) ) {
function wp_remote_retrieve_body( $r ) { return is_array( $r ) && isset( $r['body'] ) ? $r['body'] : ''; }
}

/* Assets (recorded, not printed). */
$GLOBALS['dlos_test_enqueued'] = array();
if ( ! function_exists( 'wp_enqueue_style' ) ) {
	function wp_enqueue_style( $h ) { $GLOBALS['dlos_test_enqueued'][] = 'style:' . $h; }
}
if ( ! function_exists( 'wp_enqueue_script' ) ) {
	function wp_enqueue_script( $h, $src = '' ) { $GLOBALS['dlos_test_enqueued'][] = 'script:' . $h . ( $src ? '@' . $src : '' ); }
}

/* Load the plugin's pure classes. */
$dlos_inc = dirname( __DIR__ ) . '/dlang-os-connect/includes/';
foreach ( array( 'settings', 'language', 'signature', 'cache', 'format', 'validator', 'api', 'theme', 'jsonld', 'renderer', 'rest', 'redirects', 'widgets', 'frontend' ) as $dlos_f ) {
	require_once $dlos_inc . 'class-dlos-' . $dlos_f . '.php';
}

/** Reset state between tests. */
function dlos_test_reset( array $settings = array() ) {
	$GLOBALS['dlos_test_options']    = array();
	$GLOBALS['dlos_test_transients'] = array();
	$GLOBALS['dlos_test_http']       = null;
	$GLOBALS['dlos_test_http_calls'] = array();
	$GLOBALS['dlos_test_filters']    = array();
	$GLOBALS['dlos_test_can']        = false;
	remove_all_filters( 'wpml_current_language' );
	update_option(
		DLOS_Settings::OPTION,
		array_merge(
			DLOS_Settings::defaults(),
			array(
				'app_url'   => 'https://app.example.org',
				'club_slug' => 'demo-club',
			),
			$settings
		)
	);
}

/** Load a JSON fixture as an array. */
function dlos_fixture( $name ) {
	return json_decode( file_get_contents( __DIR__ . '/fixtures/' . $name . '.json' ), true );
}

/** Render context for tests. */
function dlos_ctx( array $over = array() ) {
	return array_merge(
		DLOS_Renderer::default_context(),
		array(
			'app_url'     => 'https://app.example.org',
			'club_slug'   => 'demo-club',
			'lang'        => 'fr',
			'site_origin' => 'https://club.example.org',
		),
		$over
	);
}

/** Successful HTTP response stub. */
function dlos_http_ok( $body ) {
	return array(
		'response' => array( 'code' => 200 ),
		'body'     => is_string( $body ) ? $body : json_encode( $body ),
	);
}
