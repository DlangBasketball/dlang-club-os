<?php
/**
 * Uninstall: remove every option and transient the plugin created.
 *
 * @package DLangOSConnect
 */

if ( ! defined( 'WP_UNINSTALL_PLUGIN' ) ) {
	exit;
}

/**
 * Clean one site.
 */
function dlos_uninstall_site() {
	global $wpdb;
	foreach ( array( 'dlos_settings', 'dlos_redirects', 'dlos_cache_gen' ) as $option ) {
		delete_option( $option );
	}
	// Transients live in the options table unless a persistent object cache is used; there they
	// expire on their own (fresh copies within the cache TTL, stale copies within 7 days).
	// phpcs:ignore WordPress.DB.DirectDatabaseQuery
	$wpdb->query(
		$wpdb->prepare(
			"DELETE FROM {$wpdb->options} WHERE option_name LIKE %s OR option_name LIKE %s",
			$wpdb->esc_like( '_transient_dlos_' ) . '%',
			$wpdb->esc_like( '_transient_timeout_dlos_' ) . '%'
		)
	);
}

if ( is_multisite() ) {
	foreach ( get_sites(
		array(
			'fields' => 'ids',
			'number' => 0,
		)
	) as $dlos_site_id ) {
		switch_to_blog( $dlos_site_id );
		dlos_uninstall_site();
		restore_current_blog();
	}
} else {
	dlos_uninstall_site();
}
