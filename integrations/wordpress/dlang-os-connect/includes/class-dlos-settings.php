<?php
/**
 * Plugin settings: defaults, access and sanitising.
 *
 * @package DLangOSConnect
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Settings store (single small option, autoloaded; large data lives elsewhere).
 */
class DLOS_Settings {

	const OPTION = 'dlos_settings';

	/** Languages the public API understands. */
	const LANGUAGES = array( 'en', 'fr', 'de', 'it', 'es' );

	/**
	 * Default settings.
	 *
	 * @return array
	 */
	public static function defaults() {
		return array(
			'app_url'        => '',
			'club_slug'      => '',
			'lang_mode'      => 'auto',
			'theme'          => 'club',
			'inherit_fonts'  => 1,
			'cache_ttl'      => 10,
			'webhook_secret' => '',
			'interactive'    => 'app',
			'pwa_hint'       => 0,
			'jsonld'         => 1,
			'redirects_on'   => 0,
		);
	}

	/**
	 * All settings merged with defaults.
	 *
	 * @return array
	 */
	public static function all() {
		$stored = get_option( self::OPTION, array() );
		if ( ! is_array( $stored ) ) {
			$stored = array();
		}
		return array_merge( self::defaults(), $stored );
	}

	/**
	 * One setting.
	 *
	 * @param string $key Key.
	 * @return mixed
	 */
	public static function get( $key ) {
		$all = self::all();
		return isset( $all[ $key ] ) ? $all[ $key ] : null;
	}

	/**
	 * Whether the minimum configuration exists.
	 *
	 * @return bool
	 */
	public static function is_configured() {
		return '' !== self::app_url() && '' !== (string) self::get( 'club_slug' );
	}

	/**
	 * The app base URL without trailing slash, or '' if not set/invalid.
	 *
	 * @return string
	 */
	public static function app_url() {
		return self::normalize_app_url( (string) self::get( 'app_url' ) );
	}

	/**
	 * Validate an app URL: https only (http allowed for localhost when explicitly filtered in).
	 *
	 * @param string $url Raw URL.
	 * @return string Normalised URL without trailing slash, or ''.
	 */
	public static function normalize_app_url( $url ) {
		$url = trim( (string) $url );
		if ( '' === $url ) {
			return '';
		}
		$parts = wp_parse_url( $url );
		if ( empty( $parts['scheme'] ) || empty( $parts['host'] ) ) {
			return '';
		}
		$scheme = strtolower( $parts['scheme'] );
		$host   = strtolower( $parts['host'] );
		if ( 'https' !== $scheme ) {
			$local      = in_array( $host, array( 'localhost', '127.0.0.1' ), true );
			$allow_http = $local && apply_filters( 'dlos_allow_insecure_localhost', false );
			if ( ! $allow_http ) {
				return '';
			}
		}
		if ( isset( $parts['user'] ) || isset( $parts['pass'] ) ) {
			return '';
		}
		$out = $scheme . '://' . $host;
		if ( ! empty( $parts['port'] ) ) {
			$out .= ':' . (int) $parts['port'];
		}
		if ( ! empty( $parts['path'] ) ) {
			$out .= '/' . trim( $parts['path'], '/' );
		}
		return rtrim( $out, '/' );
	}

	/**
	 * Sanitise submitted settings (register_setting callback).
	 *
	 * @param mixed $input Raw input.
	 * @return array
	 */
	public static function sanitize( $input ) {
		$input   = is_array( $input ) ? $input : array();
		$current = self::all();
		$out     = self::defaults();

		$app_url = isset( $input['app_url'] ) ? self::normalize_app_url( wp_unslash( $input['app_url'] ) ) : '';
		if ( isset( $input['app_url'] ) && '' !== trim( (string) $input['app_url'] ) && '' === $app_url && function_exists( 'add_settings_error' ) ) {
			add_settings_error( self::OPTION, 'dlos_app_url', __( 'The app address must be a valid https:// URL.', 'dlang-os-connect' ) );
		}
		$out['app_url'] = $app_url;

		$slug             = isset( $input['club_slug'] ) ? strtolower( (string) wp_unslash( $input['club_slug'] ) ) : '';
		$out['club_slug'] = preg_replace( '/[^a-z0-9-]/', '', $slug );

		$lang_modes       = array_merge( array( 'auto', 'site' ), self::LANGUAGES );
		$out['lang_mode'] = isset( $input['lang_mode'] ) && in_array( $input['lang_mode'], $lang_modes, true ) ? $input['lang_mode'] : 'auto';

		$out['theme']       = isset( $input['theme'] ) && in_array( $input['theme'], array( 'club', 'light', 'dark' ), true ) ? $input['theme'] : 'club';
		$out['interactive'] = isset( $input['interactive'] ) && in_array( $input['interactive'], array( 'app', 'embed' ), true ) ? $input['interactive'] : 'app';

		foreach ( array( 'inherit_fonts', 'pwa_hint', 'jsonld', 'redirects_on' ) as $flag ) {
			$out[ $flag ] = empty( $input[ $flag ] ) ? 0 : 1;
		}

		$ttl              = isset( $input['cache_ttl'] ) ? (int) $input['cache_ttl'] : 10;
		$out['cache_ttl'] = max( 1, min( 1440, $ttl ) );

		// Secret: keep the stored one when the field is left blank (it is never echoed back).
		$secret = isset( $input['webhook_secret'] ) ? trim( (string) wp_unslash( $input['webhook_secret'] ) ) : '';
		if ( ! empty( $input['webhook_secret_clear'] ) ) {
			$out['webhook_secret'] = '';
		} elseif ( '' === $secret ) {
			$out['webhook_secret'] = (string) $current['webhook_secret'];
		} else {
			$out['webhook_secret'] = preg_replace( '/[^\x21-\x7E]/', '', $secret );
		}

		return $out;
	}
}
