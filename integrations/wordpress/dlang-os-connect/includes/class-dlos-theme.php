<?php
/**
 * Maps the club theme (envelope.club.theme) to the plugin's CSS variables.
 *
 * @package DLangOSConnect
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Club theme -> --dlos-* variables, with value sanitising and a contrast guard.
 */
class DLOS_Theme {

	/** App design token (without leading dashes) => plugin variable suffix. */
	const MAP = array(
		'brand-primary'          => 'primary',
		'brand-primary-dark'     => 'primary-hover',
		'brand-primary-contrast' => 'on-primary',
		'brand-primary-text'     => 'primary-text',
		'brand-accent'           => 'accent',
		'brand-accent-contrast'  => 'on-accent',
		'brand-accent-text'      => 'accent-text',
		'bg'                     => 'bg',
		'surface'                => 'surface',
		'surface-elevated'       => 'surface-2',
		'border'                 => 'border',
		'text'                   => 'text',
		'text-secondary'         => 'text-2',
		'text-muted'             => 'muted',
		'success-text'           => 'success',
		'warning-text'           => 'warning',
		'danger-text'            => 'danger',
		'radius-md'              => 'radius',
		'radius-lg'              => 'radius-lg',
		'font-display'           => 'font-display',
		'font-ui'                => 'font-ui',
	);

	/** Tokens used in light/dark mode (brand only; surfaces come from the stylesheet). */
	const BRAND_ONLY = array( 'primary', 'primary-hover', 'on-primary', 'accent', 'on-accent', 'radius', 'radius-lg', 'font-display', 'font-ui' );

	/**
	 * Keep only known tokens with safe CSS values.
	 *
	 * @param array $theme Raw theme map (css var name => value).
	 * @return array token (without dashes) => value
	 */
	public static function sanitize_theme( array $theme ) {
		$out = array();
		foreach ( $theme as $name => $value ) {
			$name = ltrim( strtolower( (string) $name ), '-' );
			if ( ! isset( self::MAP[ $name ] ) || ! is_string( $value ) ) {
				continue;
			}
			$value = self::sanitize_value( $value );
			if ( '' !== $value ) {
				$out[ $name ] = $value;
			}
		}
		return $out;
	}

	/**
	 * A CSS value safe to place in a custom property, or ''.
	 *
	 * @param string $value Value.
	 * @return string
	 */
	public static function sanitize_value( $value ) {
		$value = trim( (string) $value );
		if ( '' === $value || strlen( $value ) > 200 ) {
			return '';
		}
		if ( ! preg_match( '/^[A-Za-z0-9#%.,()\s"\'_-]+$/', $value ) ) {
			return '';
		}
		if ( preg_match( '/url\s*\(|expression|image-set|@import/i', $value ) ) {
			return '';
		}
		return $value;
	}

	/**
	 * Inline style declarations for a widget wrapper.
	 *
	 * @param array  $theme         Sanitised theme (from the envelope).
	 * @param string $mode          club|light|dark.
	 * @param bool   $inherit_fonts Keep the WordPress theme's fonts.
	 * @return string e.g. "--dlos-primary:#DA2627;--dlos-bg:#0A0A0A"
	 */
	public static function style( array $theme, $mode, $inherit_fonts ) {
		$vars = array();
		foreach ( $theme as $token => $value ) {
			if ( ! isset( self::MAP[ $token ] ) ) {
				continue;
			}
			$vars[ self::MAP[ $token ] ] = $value;
		}

		if ( 'club' !== $mode ) {
			$vars = array_intersect_key( $vars, array_flip( self::BRAND_ONLY ) );
			// The brand colour used as text must still be readable on the light/dark surface.
			if ( isset( $vars['primary'] ) ) {
				$surface = 'light' === $mode ? '#FFFFFF' : '#141414';
				if ( self::contrast( $vars['primary'], $surface ) >= 4.5 ) {
					$vars['primary-text'] = $vars['primary'];
				}
			}
		} elseif ( isset( $vars['text'], $vars['surface'] ) && self::contrast( $vars['text'], $vars['surface'] ) < 4.5 ) {
			// Unreadable tenant palette: fall back to the stylesheet's surfaces and text.
			foreach ( array( 'bg', 'surface', 'surface-2', 'border', 'text', 'text-2', 'muted' ) as $k ) {
				unset( $vars[ $k ] );
			}
		}

		if ( isset( $vars['primary'], $vars['on-primary'] ) && self::contrast( $vars['primary'], $vars['on-primary'] ) < 3.0 ) {
			unset( $vars['on-primary'] );
		}

		if ( $inherit_fonts ) {
			unset( $vars['font-display'], $vars['font-ui'] );
		}

		$decl = array();
		foreach ( $vars as $k => $v ) {
			$decl[] = '--dlos-' . $k . ':' . $v;
		}
		return implode( ';', $decl );
	}

	/**
	 * WCAG contrast ratio of two hex colours (returns 21 when either is not a hex colour,
	 * i.e. the guard only acts on values it can measure).
	 *
	 * @param string $a Colour.
	 * @param string $b Colour.
	 * @return float
	 */
	public static function contrast( $a, $b ) {
		$la = self::luminance( $a );
		$lb = self::luminance( $b );
		if ( null === $la || null === $lb ) {
			return 21.0;
		}
		$hi = max( $la, $lb );
		$lo = min( $la, $lb );
		return ( $hi + 0.05 ) / ( $lo + 0.05 );
	}

	/**
	 * Relative luminance of a #rgb / #rrggbb colour.
	 *
	 * @param string $hex Colour.
	 * @return float|null
	 */
	public static function luminance( $hex ) {
		$hex = ltrim( trim( (string) $hex ), '#' );
		if ( preg_match( '/^[0-9a-f]{3}$/i', $hex ) ) {
			$hex = $hex[0] . $hex[0] . $hex[1] . $hex[1] . $hex[2] . $hex[2];
		}
		if ( ! preg_match( '/^[0-9a-f]{6}$/i', $hex ) ) {
			return null;
		}
		$c = array();
		foreach ( array( 0, 2, 4 ) as $i ) {
			$v   = hexdec( substr( $hex, $i, 2 ) ) / 255;
			$c[] = $v <= 0.03928 ? $v / 12.92 : pow( ( $v + 0.055 ) / 1.055, 2.4 );
		}
		return 0.2126 * $c[0] + 0.7152 * $c[1] + 0.0722 * $c[2];
	}
}
