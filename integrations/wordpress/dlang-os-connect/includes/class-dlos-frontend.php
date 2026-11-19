<?php
/**
 * Front-end extras: the optional floating "Install the app" hint.
 *
 * @package DLangOSConnect
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Front-end.
 */
class DLOS_Frontend {

	/**
	 * Hooks.
	 */
	public static function init() {
		add_action( 'wp_enqueue_scripts', array( __CLASS__, 'enqueue' ) );
		add_action( 'wp_footer', array( __CLASS__, 'pwa_hint' ), 8 );
	}

	/**
	 * Load the stylesheet in the head when the hint is on.
	 */
	public static function enqueue() {
		if ( self::pwa_hint_enabled() ) {
			wp_enqueue_style( 'dlos-front' );
		}
	}

	/**
	 * Whether the install hint is on and possible.
	 *
	 * @return bool
	 */
	public static function pwa_hint_enabled() {
		return ! is_admin() && ! empty( DLOS_Settings::get( 'pwa_hint' ) ) && '' !== DLOS_Settings::app_url();
	}

	/**
	 * Print the hint (hidden until front.js decides to show it: not dismissed, not already installed).
	 */
	public static function pwa_hint() {
		if ( ! self::pwa_hint_enabled() ) {
			return;
		}
		$url = DLOS_Api::app_page( '' );
		echo '<aside class="dlos dlos-pwa" data-dlos-pwa hidden aria-label="' . esc_attr__( 'Club app', 'dlang-os-connect' ) . '">';
		echo '<p class="dlos-pwa__text">' . esc_html__( 'Schedules, registrations and payments in your pocket: get the club app.', 'dlang-os-connect' ) . '</p>';
		echo '<a class="dlos-btn dlos-btn--primary" href="' . esc_url( $url ) . '" target="_blank" rel="noopener">' . esc_html__( 'Install the app', 'dlang-os-connect' ) . DLOS_Renderer::new_tab_hint() . '</a>'; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- escaped in the helper.
		echo '<button type="button" class="dlos-pwa__close" data-dlos-pwa-close aria-label="' . esc_attr__( 'Dismiss', 'dlang-os-connect' ) . '">&times;</button>';
		echo '</aside>';
	}
}
