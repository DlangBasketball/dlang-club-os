<?php
/**
 * 301 redirects from old SportsPress / WooCommerce URLs to the matching app pages.
 *
 * The map (old path => app URL) is built on the "Move to DLang OS" page, stored in a non-autoloaded
 * option and only served when the admin switched redirects on.
 *
 * @package DLangOSConnect
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Redirect map building and serving.
 */
class DLOS_Redirects {

	const OPTION = 'dlos_redirects';

	/**
	 * Hooks.
	 */
	public static function init() {
		add_action( 'template_redirect', array( __CLASS__, 'maybe_redirect' ), 1 );
	}

	/**
	 * Serve a redirect for the current request when enabled and mapped.
	 */
	public static function maybe_redirect() {
		if ( empty( DLOS_Settings::get( 'redirects_on' ) ) || is_admin() ) {
			return;
		}
		$uri  = isset( $_SERVER['REQUEST_URI'] ) ? wp_unslash( $_SERVER['REQUEST_URI'] ) : ''; // phpcs:ignore WordPress.Security.ValidatedSanitizedInput.InputNotSanitized -- normalised below.
		$path = self::normalize_path( (string) $uri, (string) wp_parse_url( home_url( '/' ), PHP_URL_PATH ) );
		$map  = get_option( self::OPTION, array() );
		$to   = self::lookup( is_array( $map ) ? $map : array(), $path, DLOS_Settings::app_url() );
		if ( '' !== $to ) {
			wp_redirect( $to, 301, 'DLang OS Connect' ); // phpcs:ignore WordPress.Security.SafeRedirect.wp_redirect_wp_redirect -- target host is checked against the app host in lookup().
			exit;
		}
	}

	/**
	 * Look up a path; only returns targets on the configured app host.
	 *
	 * @param array  $map     Map path => URL.
	 * @param string $path    Normalised path.
	 * @param string $app_url App base URL.
	 * @return string
	 */
	public static function lookup( array $map, $path, $app_url ) {
		if ( '' === $path || ! isset( $map[ $path ] ) || ! is_string( $map[ $path ] ) ) {
			return '';
		}
		$to       = DLOS_Format::url( $map[ $path ] );
		$app_host = strtolower( (string) wp_parse_url( (string) $app_url, PHP_URL_HOST ) );
		$to_host  = strtolower( (string) wp_parse_url( $to, PHP_URL_HOST ) );
		if ( '' === $to || '' === $app_host || $to_host !== $app_host || 0 !== strpos( $to, 'https://' ) ) {
			return '';
		}
		return $to;
	}

	/**
	 * Normalise a request URI or permalink to a site-relative path: lowercase, no query, trailing slash.
	 *
	 * @param string $uri       URI or absolute URL.
	 * @param string $home_path Path of the home URL (sub-directory installs).
	 * @return string e.g. "event/u14-vs-geneva/"
	 */
	public static function normalize_path( $uri, $home_path = '/' ) {
		$path = (string) wp_parse_url( $uri, PHP_URL_PATH );
		$path = strtolower( rawurldecode( $path ) );
		$home = '/' . trim( strtolower( (string) $home_path ), '/' );
		$home = '/' === $home ? '/' : $home . '/';
		if ( '/' !== $home && 0 === strpos( $path, $home ) ) {
			$path = substr( $path, strlen( $home ) - 1 );
		}
		$path = trim( $path, '/' );
		return '' === $path ? '' : $path . '/';
	}

	/**
	 * Lowercase ASCII-ish key for name matching.
	 *
	 * @param string $s Text.
	 * @return string
	 */
	public static function key( $s ) {
		$s = wp_strip_all_tags( (string) $s );
		$s = function_exists( 'remove_accents' ) ? remove_accents( $s ) : $s;
		$s = strtolower( $s );
		return trim( preg_replace( '/[^a-z0-9]+/', '-', $s ), '-' );
	}

	/**
	 * Last path segment of a URL.
	 *
	 * @param string $url URL.
	 * @return string
	 */
	public static function last_segment( $url ) {
		$path = trim( (string) wp_parse_url( (string) $url, PHP_URL_PATH ), '/' );
		$pos  = strrpos( $path, '/' );
		return false === $pos ? $path : substr( $path, $pos + 1 );
	}

	/**
	 * Build the redirect map.
	 *
	 * @param array $wp_items  Old WordPress items: [ ['kind' => event|team|product, 'path', 'slug', 'name', 'date' (Y-m-d, events)] ].
	 * @param array $app_items App items by kind: [ 'event' => [...events+results], 'team' => [...], 'product' => [...] ].
	 * @return array{map:array,unmatched:array}
	 */
	public static function build_map( array $wp_items, array $app_items ) {
		$index = array();
		foreach ( $app_items as $kind => $items ) {
			foreach ( (array) $items as $item ) {
				if ( ! is_array( $item ) ) {
					continue;
				}
				$url = DLOS_Format::url( isset( $item['url'] ) ? $item['url'] : '' );
				if ( '' === $url ) {
					continue;
				}
				$name             = 'event' === $kind ? DLOS_Format::str( $item, 'title' ) : DLOS_Format::str( $item, 'name' );
				$slug             = DLOS_Format::str( $item, 'slug' );
				$index[ $kind ][] = array(
					'url'      => $url,
					'slug'     => self::key( '' !== $slug ? $slug : self::last_segment( $url ) ),
					'name'     => self::key( $name ),
					'date'     => substr( DLOS_Format::iso( $item, 'starts_at' ), 0, 10 ),
					'opponent' => self::key( DLOS_Format::str( $item, 'opponent' ) ),
				);
			}
		}

		$map       = array();
		$unmatched = array();
		foreach ( $wp_items as $wp ) {
			$kind = isset( $wp['kind'] ) ? $wp['kind'] : '';
			$path = self::normalize_path( isset( $wp['path'] ) ? $wp['path'] : '', isset( $wp['home_path'] ) ? $wp['home_path'] : '/' );
			if ( '' === $path ) {
				continue;
			}
			$match = self::match( $wp, isset( $index[ $kind ] ) ? $index[ $kind ] : array() );
			if ( '' !== $match ) {
				$map[ $path ] = $match;
			} else {
				$unmatched[] = $path;
			}
		}
		ksort( $map );
		return array(
			'map'       => $map,
			'unmatched' => $unmatched,
		);
	}

	/**
	 * Best app URL for one WordPress item ('' when not confident).
	 *
	 * @param array $wp         WordPress item.
	 * @param array $candidates Indexed app items of the same kind.
	 * @return string
	 */
	private static function match( array $wp, array $candidates ) {
		$slug = self::key( isset( $wp['slug'] ) ? $wp['slug'] : '' );
		$name = self::key( isset( $wp['name'] ) ? $wp['name'] : '' );
		$date = isset( $wp['date'] ) ? substr( (string) $wp['date'], 0, 10 ) : '';

		if ( 'event' === ( isset( $wp['kind'] ) ? $wp['kind'] : '' ) ) {
			// Games: same day and the title or the opponent matches.
			foreach ( $candidates as $c ) {
				if ( '' === $date || $c['date'] !== $date ) {
					continue;
				}
				if ( ( '' !== $name && $c['name'] === $name ) || ( '' !== $c['opponent'] && false !== strpos( $name, $c['opponent'] ) ) ) {
					return $c['url'];
				}
			}
			return '';
		}
		foreach ( $candidates as $c ) {
			if ( '' !== $slug && $c['slug'] === $slug ) {
				return $c['url'];
			}
		}
		foreach ( $candidates as $c ) {
			if ( '' !== $name && $c['name'] === $name ) {
				return $c['url'];
			}
		}
		return '';
	}
}
