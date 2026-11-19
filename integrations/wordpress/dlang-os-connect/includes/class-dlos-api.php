<?php
/**
 * Client for the DLang OS public website API (v1).
 *
 * @package DLangOSConnect
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Fetches, validates and caches API responses.
 */
class DLOS_Api {

	/** Endpoints the plugin may call. */
	const ENDPOINTS = array( 'club', 'programs', 'camps', 'events', 'results', 'teams', 'coaches', 'training', 'shop', 'campaigns', 'news' );

	/** Query parameters allowed per endpoint. */
	const PARAMS = array(
		'club'      => array(),
		'programs'  => array( 'kind', 'season' ),
		'camps'     => array( 'season', 'year' ),
		'events'    => array( 'from', 'to', 'team', 'type' ),
		'results'   => array( 'team', 'season' ),
		'teams'     => array(),
		'coaches'   => array(),
		'training'  => array(),
		'shop'      => array( 'category' ),
		'campaigns' => array(),
		'news'      => array( 'limit' ),
	);

	const TIMEOUT = 6;

	/**
	 * Get an endpoint.
	 *
	 * @param string $endpoint Endpoint.
	 * @param array  $params   Query params.
	 * @param string $lang     Language ('' = club default).
	 * @return array{ok:bool,envelope:?array,stale:bool,error:string}
	 */
	public static function get( $endpoint, array $params = array(), $lang = '' ) {
		$result = array(
			'ok'       => false,
			'envelope' => null,
			'stale'    => false,
			'error'    => '',
		);

		if ( ! in_array( $endpoint, self::ENDPOINTS, true ) ) {
			$result['error'] = 'unknown_endpoint';
			return $result;
		}
		if ( ! DLOS_Settings::is_configured() ) {
			$result['error'] = 'not_configured';
			return $result;
		}

		$params = self::filter_params( $endpoint, $params );
		$club   = (string) DLOS_Settings::get( 'club_slug' );
		$fresh  = DLOS_Cache::key( 'f', $endpoint, $params, $lang, $club, DLOS_Cache::generation( $endpoint ) );
		$stale  = DLOS_Cache::key( 's', $endpoint, $params, $lang, $club );
		$fail   = DLOS_Cache::key( 'x', $endpoint, $params, $lang, $club );

		$cached = get_transient( $fresh );
		if ( is_array( $cached ) ) {
			$result['ok']       = true;
			$result['envelope'] = $cached;
			return $result;
		}

		$last_good = get_transient( $stale );
		if ( is_array( $last_good ) && get_transient( $fail ) ) {
			// The app failed a moment ago: do not hammer it on every page view.
			return self::stale_result( $last_good, 'backoff' );
		}

		$fetched = self::fetch( $endpoint, $params, $lang );
		if ( is_array( $fetched ) ) {
			$ttl = (int) DLOS_Settings::get( 'cache_ttl' ) * MINUTE_IN_SECONDS;
			set_transient( $fresh, $fetched, max( 60, $ttl ) );
			set_transient( $stale, $fetched, DLOS_Cache::STALE_TTL );
			delete_transient( $fail );
			$result['ok']       = true;
			$result['envelope'] = $fetched;
			return $result;
		}

		set_transient( $fail, 1, DLOS_Cache::FAIL_TTL );
		if ( is_array( $last_good ) ) {
			return self::stale_result( $last_good, (string) $fetched );
		}
		$result['error'] = (string) $fetched;
		return $result;
	}

	/**
	 * Result for a served stale copy.
	 *
	 * @param array  $envelope Envelope.
	 * @param string $error    Why.
	 * @return array
	 */
	private static function stale_result( array $envelope, $error ) {
		return array(
			'ok'       => true,
			'envelope' => $envelope,
			'stale'    => true,
			'error'    => $error,
		);
	}

	/**
	 * Keep only allowed params with safe values.
	 *
	 * @param string $endpoint Endpoint.
	 * @param array  $params   Params.
	 * @return array
	 */
	public static function filter_params( $endpoint, array $params ) {
		$allowed = isset( self::PARAMS[ $endpoint ] ) ? self::PARAMS[ $endpoint ] : array();
		$out     = array();
		foreach ( $allowed as $key ) {
			if ( ! isset( $params[ $key ] ) || '' === $params[ $key ] || null === $params[ $key ] ) {
				continue;
			}
			$val = preg_replace( '/[^A-Za-z0-9_,:.+-]/', '', (string) $params[ $key ] );
			if ( '' !== $val ) {
				$out[ $key ] = substr( $val, 0, 100 );
			}
		}
		return DLOS_Cache::normalize_params( $out );
	}

	/**
	 * Build the API URL.
	 *
	 * @param string $endpoint Endpoint.
	 * @param array  $params   Params (already filtered).
	 * @param string $lang     Language.
	 * @return string
	 */
	public static function url( $endpoint, array $params, $lang ) {
		$query = array( 'club' => (string) DLOS_Settings::get( 'club_slug' ) );
		if ( '' !== $lang ) {
			$query['lang'] = $lang;
		}
		$query = array_merge( $query, $params );
		return DLOS_Settings::app_url() . '/api/public/v1/' . $endpoint . '?' . http_build_query( $query, '', '&', PHP_QUERY_RFC3986 );
	}

	/**
	 * HTTP fetch + validation.
	 *
	 * @param string $endpoint Endpoint.
	 * @param array  $params   Params.
	 * @param string $lang     Language.
	 * @return array|string Envelope or error code.
	 */
	public static function fetch( $endpoint, array $params, $lang ) {
		$url = self::url( $endpoint, $params, $lang );
		if ( 0 !== strpos( $url, 'https://' ) && ! apply_filters( 'dlos_allow_insecure_localhost', false ) ) {
			return 'insecure_url';
		}

		$response = wp_remote_get(
			$url,
			array(
				'timeout'             => self::TIMEOUT,
				'redirection'         => 2,
				'reject_unsafe_urls'  => false === strpos( $url, '://localhost' ),
				'sslverify'           => true,
				'limit_response_size' => 2 * MB_IN_BYTES,
				'user-agent'          => 'DLangOSConnect/' . DLOS_VERSION . '; WordPress',
				'headers'             => array( 'Accept' => 'application/json' ),
			)
		);

		if ( is_wp_error( $response ) ) {
			return 'unreachable';
		}
		$code = (int) wp_remote_retrieve_response_code( $response );
		if ( 404 === $code ) {
			return 'not_found';
		}
		if ( 429 === $code ) {
			return 'rate_limited';
		}
		if ( 200 !== $code ) {
			return 'http_' . $code;
		}
		$decoded  = json_decode( (string) wp_remote_retrieve_body( $response ), true );
		$envelope = DLOS_Validator::envelope( $decoded, $endpoint );
		return null === $envelope ? 'invalid_response' : $envelope;
	}

	/**
	 * Uncached connection test for the settings page.
	 *
	 * @return array|string Envelope or error code.
	 */
	public static function test_connection() {
		if ( ! DLOS_Settings::is_configured() ) {
			return 'not_configured';
		}
		return self::fetch( 'club', array(), DLOS_Language::current() );
	}

	/**
	 * URL of an app page on the club's app (for menu items, embeds).
	 *
	 * @param string $path  Path, e.g. 'login'.
	 * @param array  $query Extra query args.
	 * @return string
	 */
	public static function app_page( $path, array $query = array() ) {
		$base = DLOS_Settings::app_url();
		if ( '' === $base ) {
			return '';
		}
		$path = ltrim( preg_replace( '#[^A-Za-z0-9/_-]#', '', (string) $path ), '/' );
		$url  = $base . '/' . $path;

		$query = array_filter(
			$query,
			function ( $v ) {
				return null !== $v && '' !== (string) $v;
			}
		);
		return empty( $query ) ? $url : $url . '?' . http_build_query( $query, '', '&', PHP_QUERY_RFC3986 );
	}
}
