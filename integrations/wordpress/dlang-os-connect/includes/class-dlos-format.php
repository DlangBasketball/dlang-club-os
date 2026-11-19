<?php
/**
 * Small, defensive accessors and formatters for API values.
 *
 * Every function returns plain (unescaped) strings; callers escape at output.
 *
 * @package DLangOSConnect
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Value helpers.
 */
class DLOS_Format {

	/**
	 * Scalar string from an array key.
	 *
	 * @param mixed  $arr Array.
	 * @param string $key Key.
	 * @return string
	 */
	public static function str( $arr, $key ) {
		if ( ! is_array( $arr ) || ! isset( $arr[ $key ] ) ) {
			return '';
		}
		$v = $arr[ $key ];
		if ( is_string( $v ) ) {
			return trim( $v );
		}
		if ( is_int( $v ) || is_float( $v ) ) {
			return (string) $v;
		}
		if ( is_array( $v ) && isset( $v['name'] ) && is_string( $v['name'] ) ) {
			return trim( $v['name'] );
		}
		return '';
	}

	/**
	 * Sub-array from an array key.
	 *
	 * @param mixed  $arr Array.
	 * @param string $key Key.
	 * @return array
	 */
	public static function arr( $arr, $key ) {
		return ( is_array( $arr ) && isset( $arr[ $key ] ) && is_array( $arr[ $key ] ) ) ? $arr[ $key ] : array();
	}

	/**
	 * A safe absolute http(s) URL or ''.
	 *
	 * @param mixed $url URL.
	 * @return string
	 */
	public static function url( $url ) {
		if ( ! is_string( $url ) || '' === trim( $url ) ) {
			return '';
		}
		$url    = trim( $url );
		$scheme = strtolower( (string) wp_parse_url( $url, PHP_URL_SCHEME ) );
		if ( ! in_array( $scheme, array( 'https', 'http' ), true ) ) {
			return '';
		}
		return esc_url_raw( $url, array( 'http', 'https' ) );
	}

	/**
	 * Money object {amount,currency,formatted} -> display string.
	 *
	 * @param mixed $money Money value.
	 * @return string
	 */
	public static function money( $money ) {
		if ( is_array( $money ) ) {
			if ( isset( $money['formatted'] ) && is_string( $money['formatted'] ) && '' !== $money['formatted'] ) {
				return $money['formatted'];
			}
			if ( isset( $money['amount'] ) && is_numeric( $money['amount'] ) ) {
				$cur = isset( $money['currency'] ) && is_string( $money['currency'] ) ? strtoupper( preg_replace( '/[^A-Za-z]/', '', $money['currency'] ) ) : '';
				return trim( $cur . ' ' . number_format_i18n( (float) $money['amount'], 2 ) );
			}
			return '';
		}
		if ( is_string( $money ) ) {
			return $money;
		}
		return '';
	}

	/**
	 * Numeric amount and currency of a money value (for JSON-LD).
	 *
	 * @param mixed $money Money value.
	 * @return array{0:?float,1:string}
	 */
	public static function money_parts( $money ) {
		if ( is_array( $money ) && isset( $money['amount'] ) && is_numeric( $money['amount'] ) ) {
			$cur = isset( $money['currency'] ) && is_string( $money['currency'] ) ? strtoupper( preg_replace( '/[^A-Za-z]/', '', $money['currency'] ) ) : '';
			return array( (float) $money['amount'], substr( $cur, 0, 3 ) );
		}
		return array( null, '' );
	}

	/**
	 * Date for display: prefers the API's formatted string, else formats the ISO value with the site settings.
	 *
	 * Accepted shapes: "field": "ISO", "field_formatted": "...", "field": {"iso": "...", "formatted": "..."},
	 * "formatted": {"field": "..."}.
	 *
	 * @param array  $item  Item.
	 * @param string $field Field name.
	 * @param bool   $time  Include time when formatting ourselves.
	 * @return string
	 */
	public static function date( $item, $field, $time = true ) {
		if ( ! is_array( $item ) || ! isset( $item[ $field ] ) ) {
			return '';
		}
		$v = $item[ $field ];
		if ( isset( $item[ $field . '_formatted' ] ) && is_string( $item[ $field . '_formatted' ] ) ) {
			return $item[ $field . '_formatted' ];
		}
		if ( isset( $item['formatted'] ) && is_array( $item['formatted'] ) && isset( $item['formatted'][ $field ] ) && is_string( $item['formatted'][ $field ] ) ) {
			return $item['formatted'][ $field ];
		}
		if ( is_array( $v ) ) {
			if ( isset( $v['formatted'] ) && is_string( $v['formatted'] ) ) {
				return $v['formatted'];
			}
			$v = isset( $v['iso'] ) ? $v['iso'] : '';
		}
		$ts = self::timestamp( $v );
		if ( null === $ts ) {
			return is_string( $v ) ? $v : '';
		}
		$format = get_option( 'date_format', 'Y-m-d' );
		if ( $time && preg_match( '/T\d{2}:\d{2}/', (string) $v ) ) {
			$format .= ' ' . get_option( 'time_format', 'H:i' );
		}
		return (string) wp_date( $format, $ts );
	}

	/**
	 * ISO value of a date field (for JSON-LD and <time datetime>).
	 *
	 * @param array  $item  Item.
	 * @param string $field Field.
	 * @return string
	 */
	public static function iso( $item, $field ) {
		if ( ! is_array( $item ) || ! isset( $item[ $field ] ) ) {
			return '';
		}
		$v = $item[ $field ];
		if ( is_array( $v ) ) {
			$v = isset( $v['iso'] ) ? $v['iso'] : ( isset( $v['start'] ) ? $v['start'] : '' );
		}
		if ( ! is_string( $v ) || ! preg_match( '/^\d{4}-\d{2}-\d{2}([T ][0-9:.]+(Z|[+-]\d{2}:?\d{2})?)?$/', $v ) ) {
			return '';
		}
		return $v;
	}

	/**
	 * Unix timestamp from an ISO string.
	 *
	 * @param mixed $v Value.
	 * @return int|null
	 */
	public static function timestamp( $v ) {
		if ( ! is_string( $v ) || ! preg_match( '/^\d{4}-\d{2}-\d{2}/', $v ) ) {
			return null;
		}
		$t = strtotime( $v );
		return false === $t ? null : $t;
	}

	/**
	 * Plain text from API "html-safe" content (for JSON-LD descriptions and excerpts).
	 *
	 * @param string $html HTML.
	 * @param int    $max  Max characters (0 = unlimited).
	 * @return string
	 */
	public static function plain( $html, $max = 0 ) {
		$text = trim( preg_replace( '/\s+/', ' ', wp_strip_all_tags( (string) $html ) ) );
		if ( $max > 0 && function_exists( 'mb_strlen' ) && mb_strlen( $text ) > $max ) {
			$text = rtrim( mb_substr( $text, 0, $max - 1 ) ) . '…';
		}
		return $text;
	}
}
