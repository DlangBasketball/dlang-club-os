<?php
/**
 * Language detection: WPML, Polylang, then the site locale.
 *
 * @package DLangOSConnect
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Resolves which language to ask the app for.
 */
class DLOS_Language {

	/**
	 * Current language code for API calls ('' lets the app use the club default).
	 *
	 * @param string $override Optional explicit language (shortcode lang="fr").
	 * @return string
	 */
	public static function current( $override = '' ) {
		$override = self::normalize( $override );
		if ( '' !== $override ) {
			return $override;
		}

		$mode = (string) DLOS_Settings::get( 'lang_mode' );
		if ( in_array( $mode, DLOS_Settings::LANGUAGES, true ) ) {
			return $mode;
		}

		if ( 'auto' === $mode ) {
			$multilingual = self::from_multilingual_plugin();
			if ( '' !== $multilingual ) {
				return $multilingual;
			}
		}

		$locale = function_exists( 'determine_locale' ) ? determine_locale() : get_locale();
		return self::normalize( $locale );
	}

	/**
	 * Language from WPML or Polylang when one is active.
	 *
	 * @return string
	 */
	public static function from_multilingual_plugin() {
		// WPML (and plugins that implement its filter API).
		if ( defined( 'ICL_SITEPRESS_VERSION' ) || has_filter( 'wpml_current_language' ) ) {
			$code = apply_filters( 'wpml_current_language', null );
			if ( is_string( $code ) && 'all' !== $code ) {
				$norm = self::normalize( $code );
				if ( '' !== $norm ) {
					return $norm;
				}
			}
		}
		// Polylang.
		if ( function_exists( 'pll_current_language' ) ) {
			$code = pll_current_language( 'slug' );
			if ( is_string( $code ) ) {
				$norm = self::normalize( $code );
				if ( '' !== $norm ) {
					return $norm;
				}
			}
		}
		return '';
	}

	/**
	 * Reduce a locale/language code to a supported two-letter code.
	 *
	 * @param string $code e.g. fr_CH, de-DE, en.
	 * @return string
	 */
	public static function normalize( $code ) {
		$code = strtolower( substr( (string) $code, 0, 2 ) );
		return in_array( $code, DLOS_Settings::LANGUAGES, true ) ? $code : '';
	}
}
