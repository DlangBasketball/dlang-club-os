<?php
/**
 * REST route for the app's cache-purge webhook: POST /wp-json/dlang-os/v1/purge.
 *
 * @package DLangOSConnect
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Purge webhook.
 */
class DLOS_Rest {

	/**
	 * Hooks.
	 */
	public static function init() {
		add_action( 'rest_api_init', array( __CLASS__, 'routes' ) );
	}

	/**
	 * Register routes.
	 */
	public static function routes() {
		register_rest_route(
			'dlang-os/v1',
			'/purge',
			array(
				'methods'             => 'POST',
				'callback'            => array( __CLASS__, 'purge' ),
				// Authenticated by the HMAC signature in the callback (machine-to-machine, no WP user).
				'permission_callback' => '__return_true',
			)
		);
	}

	/**
	 * Handle a purge delivery.
	 *
	 * @param WP_REST_Request $request Request.
	 * @return WP_REST_Response
	 */
	public static function purge( $request ) {
		$raw    = (string) $request->get_body();
		$result = self::handle( $raw, (string) $request->get_header( 'x_dlang_signature' ), (string) $request->get_header( 'x_dlang_timestamp' ), (string) DLOS_Settings::get( 'webhook_secret' ), (string) DLOS_Settings::get( 'club_slug' ) );
		return new WP_REST_Response( $result['body'], $result['status'] );
	}

	/**
	 * Transport-independent handler (tested directly).
	 *
	 * @param string   $raw       Raw body.
	 * @param string   $signature Signature header.
	 * @param string   $timestamp Timestamp header.
	 * @param string   $secret    Secret.
	 * @param string   $club      Configured club slug.
	 * @param int|null $now       Time (tests).
	 * @return array{status:int,body:array}
	 */
	public static function handle( $raw, $signature, $timestamp, $secret, $club, $now = null ) {
		if ( strlen( $raw ) > 65536 ) {
			return array(
				'status' => 413,
				'body'   => array( 'error' => 'too_large' ),
			);
		}
		$check = DLOS_Signature::verify( $raw, $signature, $timestamp, $secret, $now );
		if ( true !== $check ) {
			return array(
				'status' => 'not_configured' === $check ? 503 : 401,
				'body'   => array( 'error' => $check ),
			);
		}
		$body = json_decode( $raw, true );
		if ( ! is_array( $body ) ) {
			return array(
				'status' => 400,
				'body'   => array( 'error' => 'invalid_body' ),
			);
		}
		if ( isset( $body['club'] ) && '' !== $club && strtolower( (string) $body['club'] ) !== strtolower( $club ) ) {
			return array(
				'status' => 409,
				'body'   => array( 'error' => 'wrong_club' ),
			);
		}
		$resource = isset( $body['resource'] ) && is_string( $body['resource'] ) ? $body['resource'] : '';
		$purged   = DLOS_Cache::purge( $resource );
		return array(
			'status' => 200,
			'body'   => array(
				'ok'     => true,
				'purged' => $purged,
			),
		);
	}
}
