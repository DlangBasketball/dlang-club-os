<?php
/**
 * Transient cache with generations (cheap purge) and a stale copy (serve when the app is down).
 *
 * @package DLangOSConnect
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Cache keys and purge.
 *
 * Fresh copy: `dlos_f_<resource>_<hash(endpoint, params, lang, club, generation)>`, lives cache_ttl minutes.
 * Stale copy: `dlos_s_<resource>_<hash(endpoint, params, lang, club)>`, lives STALE_TTL, survives purges.
 * Purging a resource bumps its generation, so every fresh key for it changes at once (works with
 * or without a persistent object cache, no key scan needed).
 */
class DLOS_Cache {

	const GEN_OPTION = 'dlos_cache_gen';
	const STALE_TTL  = 604800; // 7 days.
	const FAIL_TTL   = 60;     // Back-off after a failed fetch.

	/** Which cached resources a webhook resource invalidates. */
	const DEPENDENCIES = array(
		'programs'  => array( 'programs', 'camps' ),
		'camps'     => array( 'camps', 'programs' ),
		'events'    => array( 'events', 'results' ),
		'results'   => array( 'results', 'events' ),
		'teams'     => array( 'teams', 'events', 'results' ),
		'coaches'   => array( 'coaches', 'teams' ),
		'training'  => array( 'training' ),
		'shop'      => array( 'shop' ),
		'campaigns' => array( 'campaigns' ),
		'news'      => array( 'news' ),
	);

	/**
	 * Normalise params so equivalent requests share a key.
	 *
	 * @param array $params Params.
	 * @return array
	 */
	public static function normalize_params( array $params ) {
		$out = array();
		foreach ( $params as $k => $v ) {
			if ( null === $v || '' === $v || array() === $v ) {
				continue;
			}
			if ( is_array( $v ) ) {
				$v = implode( ',', array_map( 'strval', $v ) );
			}
			$out[ strtolower( (string) $k ) ] = trim( (string) $v );
		}
		ksort( $out );
		return $out;
	}

	/**
	 * Build a cache key.
	 *
	 * @param string $kind     'f' (fresh), 's' (stale) or 'x' (failure back-off).
	 * @param string $endpoint Endpoint, e.g. 'camps'.
	 * @param array  $params   Query params (without club/lang).
	 * @param string $lang     Language.
	 * @param string $club     Club slug.
	 * @param int    $gen      Generation (fresh keys only).
	 * @return string Transient name (<= 64 chars).
	 */
	public static function key( $kind, $endpoint, array $params, $lang, $club, $gen = 0 ) {
		$endpoint = preg_replace( '/[^a-z0-9]/', '', strtolower( (string) $endpoint ) );
		$material = array(
			'e' => $endpoint,
			'p' => self::normalize_params( $params ),
			'l' => (string) $lang,
			'c' => (string) $club,
		);
		if ( 'f' === $kind ) {
			$material['g'] = (int) $gen;
		}
		$hash = substr( md5( (string) wp_json_encode( $material ) ), 0, 20 );
		return 'dlos_' . $kind . '_' . substr( $endpoint, 0, 16 ) . '_' . $hash;
	}

	/**
	 * Current generation for a resource (includes the global generation).
	 *
	 * @param string $resource Resource.
	 * @return int
	 */
	public static function generation( $resource ) {
		$gens = get_option( self::GEN_OPTION, array() );
		$gens = is_array( $gens ) ? $gens : array();
		$own  = isset( $gens[ $resource ] ) ? (int) $gens[ $resource ] : 0;
		$all  = isset( $gens['*'] ) ? (int) $gens['*'] : 0;
		return $all * 100000 + $own;
	}

	/**
	 * Resources affected by a webhook resource.
	 *
	 * @param string $resource Resource from the webhook ('club', unknown or '' = everything).
	 * @return string[] List; array('*') means everything.
	 */
	public static function affected( $resource ) {
		$resource = strtolower( (string) $resource );
		$aliases  = array(
			'program'   => 'programs',
			'camp'      => 'camps',
			'event'     => 'events',
			'result'    => 'results',
			'team'      => 'teams',
			'coach'     => 'coaches',
			'service'   => 'training',
			'services'  => 'training',
			'product'   => 'shop',
			'products'  => 'shop',
			'campaign'  => 'campaigns',
			'donations' => 'campaigns',
			'post'      => 'news',
		);
		if ( isset( $aliases[ $resource ] ) ) {
			$resource = $aliases[ $resource ];
		}
		return isset( self::DEPENDENCIES[ $resource ] ) ? self::DEPENDENCIES[ $resource ] : array( '*' );
	}

	/**
	 * Purge the fresh copies of a resource (stale copies stay as a safety net).
	 *
	 * @param string $resource Resource name, '' or 'club' for everything.
	 * @return string[] Purged resource names.
	 */
	public static function purge( $resource = '' ) {
		$targets = self::affected( $resource );
		$gens    = get_option( self::GEN_OPTION, array() );
		$gens    = is_array( $gens ) ? $gens : array();
		foreach ( $targets as $t ) {
			$gens[ $t ] = ( isset( $gens[ $t ] ) ? (int) $gens[ $t ] : 0 ) + 1;
		}
		update_option( self::GEN_OPTION, $gens, false );
		/**
		 * Fires after the cache was purged, e.g. to also clear a page cache.
		 *
		 * @param string[] $targets Purged resources ('*' = all).
		 */
		do_action( 'dlos_cache_purged', $targets );
		return $targets;
	}

	/**
	 * Also clear common full-page caches so visitors see the change (hooked to dlos_cache_purged).
	 * Disable with: add_filter( 'dlos_purge_page_cache', '__return_false' );
	 */
	public static function purge_page_caches() {
		if ( ! apply_filters( 'dlos_purge_page_cache', true ) ) {
			return;
		}
		if ( function_exists( 'rocket_clean_domain' ) ) {
			rocket_clean_domain(); // WP Rocket.
		}
		if ( function_exists( 'w3tc_flush_all' ) ) {
			w3tc_flush_all(); // W3 Total Cache.
		}
		if ( function_exists( 'wp_cache_clear_cache' ) ) {
			wp_cache_clear_cache(); // WP Super Cache.
		}
		if ( has_action( 'litespeed_purge_all' ) ) {
			do_action( 'litespeed_purge_all' ); // LiteSpeed Cache.
		}
		if ( class_exists( 'WpeCommon' ) && method_exists( 'WpeCommon', 'purge_varnish_cache' ) ) {
			WpeCommon::purge_varnish_cache(); // WP Engine.
		}
	}

	/**
	 * Delete every transient this plugin created (uninstall / "clear all" button).
	 */
	public static function delete_all() {
		global $wpdb;
		if ( isset( $wpdb ) && is_object( $wpdb ) && isset( $wpdb->options ) ) {
			// phpcs:ignore WordPress.DB.DirectDatabaseQuery
			$wpdb->query(
				$wpdb->prepare(
					"DELETE FROM {$wpdb->options} WHERE option_name LIKE %s OR option_name LIKE %s",
					$wpdb->esc_like( '_transient_dlos_' ) . '%',
					$wpdb->esc_like( '_transient_timeout_dlos_' ) . '%'
				)
			);
		}
		self::purge( '' );
	}
}
