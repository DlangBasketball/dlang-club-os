<?php
/**
 * Webhook signature verification (HMAC-SHA256 over the raw body).
 *
 * @package DLangOSConnect
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Verifies X-DLang-Signature / X-DLang-Timestamp.
 */
class DLOS_Signature {

	/** Allowed clock skew in seconds. */
	const TOLERANCE = 300;

	/**
	 * Verify a webhook delivery.
	 *
	 * The signature is `sha256=<hex HMAC-SHA256 of the raw body>` with the club's website secret.
	 * The timestamp header must be within the tolerance; when the signed body carries an `at`
	 * field it must be within the tolerance too (that value is covered by the HMAC, so a
	 * replayed body is rejected even if the unsigned header is forged).
	 *
	 * @param string   $raw_body  Raw request body exactly as received.
	 * @param string   $signature Header value.
	 * @param string   $timestamp Header value (unix seconds or ISO 8601).
	 * @param string   $secret    Shared secret.
	 * @param int|null $now       Current unix time (for tests).
	 * @return true|string True when valid, otherwise an error code.
	 */
	public static function verify( $raw_body, $signature, $timestamp, $secret, $now = null ) {
		$now    = null === $now ? time() : (int) $now;
		$secret = (string) $secret;
		if ( '' === $secret ) {
			return 'not_configured';
		}

		$signature = trim( (string) $signature );
		if ( 0 === strpos( $signature, 'sha256=' ) ) {
			$signature = substr( $signature, 7 );
		}
		$signature = strtolower( $signature );
		if ( ! preg_match( '/^[a-f0-9]{64}$/', $signature ) ) {
			return 'bad_signature';
		}

		$expected = hash_hmac( 'sha256', (string) $raw_body, $secret );
		if ( ! hash_equals( $expected, $signature ) ) {
			return 'bad_signature';
		}

		$ts = self::parse_time( $timestamp );
		if ( null === $ts || abs( $now - $ts ) > self::TOLERANCE ) {
			return 'expired';
		}

		$body = json_decode( (string) $raw_body, true );
		if ( is_array( $body ) && isset( $body['at'] ) ) {
			$at = self::parse_time( $body['at'] );
			if ( null === $at || abs( $now - $at ) > self::TOLERANCE ) {
				return 'expired';
			}
		}

		return true;
	}

	/**
	 * Build a signature header value (used by tests and the settings page's self-test).
	 *
	 * @param string $raw_body Body.
	 * @param string $secret   Secret.
	 * @return string
	 */
	public static function sign( $raw_body, $secret ) {
		return 'sha256=' . hash_hmac( 'sha256', (string) $raw_body, (string) $secret );
	}

	/**
	 * Parse unix seconds, unix milliseconds or an ISO 8601 string.
	 *
	 * @param mixed $value Value.
	 * @return int|null
	 */
	public static function parse_time( $value ) {
		if ( is_int( $value ) || ( is_string( $value ) && preg_match( '/^\d{9,13}$/', $value ) ) ) {
			$n = (int) $value;
			return $n > 99999999999 ? (int) floor( $n / 1000 ) : $n;
		}
		if ( is_string( $value ) && preg_match( '/^\d{4}-\d{2}-\d{2}T/', $value ) ) {
			$t = strtotime( $value );
			return false === $t ? null : $t;
		}
		return null;
	}
}
