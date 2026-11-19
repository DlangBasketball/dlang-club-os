<?php
/**
 * Validates API envelopes before they are cached or rendered.
 *
 * @package DLangOSConnect
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Envelope validation.
 */
class DLOS_Validator {

	const MAX_ITEMS = 500;

	/**
	 * Validate and normalise an envelope.
	 *
	 * @param mixed  $decoded  json_decode(..., true) result.
	 * @param string $endpoint Endpoint name.
	 * @return array|null Normalised envelope or null when invalid.
	 */
	public static function envelope( $decoded, $endpoint ) {
		if ( ! is_array( $decoded ) || ! array_key_exists( 'data', $decoded ) ) {
			return null;
		}
		$club = isset( $decoded['club'] ) && is_array( $decoded['club'] ) ? $decoded['club'] : array();
		$data = $decoded['data'];

		if ( 'club' === $endpoint ) {
			if ( ! is_array( $data ) ) {
				return null;
			}
		} else {
			if ( ! is_array( $data ) || ( array() !== $data && ! self::is_list( $data ) ) ) {
				return null;
			}
			$data = array_values( array_filter( $data, 'is_array' ) );
			if ( count( $data ) > self::MAX_ITEMS ) {
				$data = array_slice( $data, 0, self::MAX_ITEMS );
			}
		}

		return array(
			'club'         => self::club( $club ),
			'data'         => $data,
			'generated_at' => isset( $decoded['generated_at'] ) && is_string( $decoded['generated_at'] ) ? $decoded['generated_at'] : '',
		);
	}

	/**
	 * Normalise the club block.
	 *
	 * @param array $club Raw club.
	 * @return array
	 */
	public static function club( array $club ) {
		return array(
			'slug'     => preg_replace( '/[^a-z0-9-]/', '', strtolower( DLOS_Format::str( $club, 'slug' ) ) ),
			'name'     => DLOS_Format::str( $club, 'name' ),
			'logo_url' => DLOS_Format::url( isset( $club['logo_url'] ) ? $club['logo_url'] : '' ),
			'theme'    => DLOS_Theme::sanitize_theme( DLOS_Format::arr( $club, 'theme' ) ),
			'locale'   => DLOS_Format::str( $club, 'locale' ),
			'currency' => strtoupper( substr( preg_replace( '/[^A-Za-z]/', '', DLOS_Format::str( $club, 'currency' ) ), 0, 3 ) ),
			'app_url'  => DLOS_Format::url( isset( $club['app_url'] ) ? $club['app_url'] : '' ),
		);
	}

	/**
	 * Whether an array is a list (0..n-1 keys).
	 *
	 * @param array $a Array.
	 * @return bool
	 */
	public static function is_list( array $a ) {
		return array_keys( $a ) === range( 0, count( $a ) - 1 );
	}
}
