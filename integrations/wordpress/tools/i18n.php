<?php
/**
 * i18n build for DLang OS Connect (no WP-CLI or gettext needed).
 *
 *   php integrations/wordpress/tools/i18n.php           -> languages/dlang-os-connect.pot, <locale>.po and .mo
 *   php integrations/wordpress/tools/i18n.php --check   -> exit 1 when a locale misses a string
 *
 * Sources: gettext calls in the plugin's PHP (token based) and block.json titles/descriptions/keywords
 * (with the contexts WordPress uses for block metadata). Translations live in tools/translations/<locale>.php
 * as msgid => msgstr (plural: msgid => array(singular, plural); context: "ctx\x04msgid").
 *
 * @package DLangOSConnect
 */

// phpcs:ignoreFile

$root    = dirname( __DIR__ ) . '/dlang-os-connect';
$domain  = 'dlang-os-connect';
$locales = array( 'fr_FR', 'de_DE', 'it_IT' );
$check   = in_array( '--check', $argv, true );

/**
 * Extract entries: key => [msgctxt, msgid, msgid_plural, refs[], comments[]].
 */
function dlos_extract( $root, $domain ) {
	$funcs   = array(
		'__'          => array( 's' ),
		'_e'          => array( 's' ),
		'esc_html__'  => array( 's' ),
		'esc_html_e'  => array( 's' ),
		'esc_attr__'  => array( 's' ),
		'esc_attr_e'  => array( 's' ),
		'_x'          => array( 's', 'c' ),
		'esc_html_x'  => array( 's', 'c' ),
		'esc_attr_x'  => array( 's', 'c' ),
		'_n'          => array( 's', 'p', 'n' ),
	);
	$entries = array();
	$add     = function ( $ctx, $id, $plural, $ref, $comment ) use ( &$entries ) {
		$key = ( '' !== $ctx ? $ctx . "\x04" : '' ) . $id;
		if ( ! isset( $entries[ $key ] ) ) {
			$entries[ $key ] = array( $ctx, $id, $plural, array(), array() );
		}
		$entries[ $key ][3][] = $ref;
		if ( '' !== $comment && ! in_array( $comment, $entries[ $key ][4], true ) ) {
			$entries[ $key ][4][] = $comment;
		}
	};

	$it = new RecursiveIteratorIterator( new RecursiveDirectoryIterator( $root, FilesystemIterator::SKIP_DOTS ) );
	$files = array();
	foreach ( $it as $file ) {
		$files[] = (string) $file;
	}
	sort( $files );
	foreach ( $files as $path ) {
		$rel = substr( $path, strlen( $root ) + 1 );
		if ( '.php' === substr( $path, -4 ) ) {
			$tokens  = token_get_all( file_get_contents( $path ) );
			$n       = count( $tokens );
			$comment = '';
			for ( $i = 0; $i < $n; $i++ ) {
				$t = $tokens[ $i ];
				if ( is_array( $t ) && T_COMMENT === $t[0] && false !== stripos( $t[1], 'translators:' ) ) {
					$comment = trim( preg_replace( '#^/\*+|\*+/$|^//#', '', $t[1] ) );
					continue;
				}
				if ( ! is_array( $t ) || T_STRING !== $t[0] || ! isset( $funcs[ $t[1] ] ) ) {
					continue;
				}
				// Skip method calls / definitions.
				$prev = $i - 1;
				while ( $prev >= 0 && is_array( $tokens[ $prev ] ) && T_WHITESPACE === $tokens[ $prev ][0] ) {
					$prev--;
				}
				if ( $prev >= 0 && is_array( $tokens[ $prev ] ) && in_array( $tokens[ $prev ][0], array( T_OBJECT_OPERATOR, T_DOUBLE_COLON, T_FUNCTION ), true ) ) {
					continue;
				}
				$j = $i + 1;
				while ( $j < $n && is_array( $tokens[ $j ] ) && T_WHITESPACE === $tokens[ $j ][0] ) {
					$j++;
				}
				if ( '(' !== $tokens[ $j ] ) {
					continue;
				}
				// Collect top-level args.
				$args  = array();
				$cur   = array();
				$depth = 0;
				for ( $k = $j + 1; $k < $n; $k++ ) {
					$tk = $tokens[ $k ];
					if ( '(' === $tk || '[' === $tk ) {
						$depth++;
					} elseif ( ')' === $tk || ']' === $tk ) {
						if ( 0 === $depth ) {
							$args[] = $cur;
							break;
						}
						$depth--;
					} elseif ( ',' === $tk && 0 === $depth ) {
						$args[] = $cur;
						$cur    = array();
						continue;
					}
					if ( is_array( $tk ) && in_array( $tk[0], array( T_WHITESPACE, T_COMMENT ), true ) ) {
						continue;
					}
					$cur[] = $tk;
				}
				$lit = function ( $arg ) {
					if ( 1 === count( $arg ) && is_array( $arg[0] ) && T_CONSTANT_ENCAPSED_STRING === $arg[0][0] ) {
						return eval( 'return ' . $arg[0][1] . ';' );
					}
					return null;
				};
				$spec   = $funcs[ $t[1] ];
				$dom    = $lit( isset( $args[ count( $spec ) ] ) ? $args[ count( $spec ) ] : array() );
				$values = array();
				foreach ( $spec as $idx => $role ) {
					$values[ $role ] = isset( $args[ $idx ] ) ? $lit( $args[ $idx ] ) : null;
				}
				if ( $dom !== $domain || null === $values['s'] ) {
					$comment = '';
					continue;
				}
				$add( isset( $values['c'] ) ? (string) $values['c'] : '', $values['s'], isset( $values['p'] ) ? (string) $values['p'] : '', $rel . ':' . $t[2], $comment );
				$comment = '';
			}
		} elseif ( 'block.json' === basename( $path ) ) {
			$meta = json_decode( file_get_contents( $path ), true );
			if ( isset( $meta['title'] ) ) {
				$add( 'block title', $meta['title'], '', $rel, '' );
			}
			if ( isset( $meta['description'] ) ) {
				$add( 'block description', $meta['description'], '', $rel, '' );
			}
			foreach ( isset( $meta['keywords'] ) ? $meta['keywords'] : array() as $kw ) {
				$add( 'block keyword', $kw, '', $rel, '' );
			}
		}
	}
	// Plugin header.
	$header = file_get_contents( $root . '/dlang-os-connect.php' );
	foreach ( array( 'Plugin Name', 'Description' ) as $h ) {
		if ( preg_match( '/^\s*\*\s*' . $h . ':\s*(.+)$/m', $header, $m ) ) {
			$add( '', trim( $m[1] ), '', 'dlang-os-connect.php', $h . ' of the plugin' );
		}
	}
	return $entries;
}

function dlos_po_str( $s ) {
	$s = addcslashes( $s, "\\\"\t" );
	$s = str_replace( "\n", '\n', $s );
	return '"' . $s . '"';
}

function dlos_po( array $entries, $header, $translations = null, $nplurals = 2 ) {
	$out = $header;
	foreach ( $entries as $key => $e ) {
		list( $ctx, $id, $plural, $refs, $comments ) = $e;
		$out .= "\n";
		foreach ( $comments as $c ) {
			$out .= '#. ' . $c . "\n";
		}
		$out .= '#: ' . implode( ' ', array_slice( array_unique( $refs ), 0, 4 ) ) . "\n";
		if ( '' !== $ctx ) {
			$out .= 'msgctxt ' . dlos_po_str( $ctx ) . "\n";
		}
		$out .= 'msgid ' . dlos_po_str( $id ) . "\n";
		$tr = null === $translations ? null : ( isset( $translations[ $key ] ) ? $translations[ $key ] : null );
		if ( '' !== $plural ) {
			$out .= 'msgid_plural ' . dlos_po_str( $plural ) . "\n";
			for ( $i = 0; $i < $nplurals; $i++ ) {
				$val  = is_array( $tr ) && isset( $tr[ $i ] ) ? $tr[ $i ] : '';
				$out .= 'msgstr[' . $i . '] ' . dlos_po_str( $val ) . "\n";
			}
		} else {
			$out .= 'msgstr ' . dlos_po_str( is_string( $tr ) ? $tr : '' ) . "\n";
		}
	}
	return $out;
}

/** Binary .mo (little endian, no hash table). */
function dlos_mo( array $entries, array $translations, $plural_forms, $lang ) {
	$pairs = array(
		'' => "Project-Id-Version: DLang OS Connect\nMIME-Version: 1.0\nContent-Type: text/plain; charset=UTF-8\nContent-Transfer-Encoding: 8bit\nLanguage: {$lang}\nPlural-Forms: {$plural_forms}\n",
	);
	foreach ( $entries as $key => $e ) {
		if ( ! isset( $translations[ $key ] ) ) {
			continue;
		}
		$tr  = $translations[ $key ];
		$src = $key;
		if ( '' !== $e[2] ) {
			$src .= "\0" . $e[2];
			$tr   = implode( "\0", (array) $tr );
		}
		$pairs[ $src ] = $tr;
	}
	ksort( $pairs, SORT_STRING );
	$n       = count( $pairs );
	$o_tab   = 28;
	$t_tab   = $o_tab + 8 * $n;
	$data    = $t_tab + 8 * $n;
	$ids     = '';
	$strs    = '';
	$o_table = '';
	$t_table = '';
	$offsets = array();
	foreach ( $pairs as $id => $str ) {
		$offsets[] = array( strlen( $id ), strlen( $ids ), strlen( $str ), strlen( $strs ) );
		$ids      .= $id . "\0";
		$strs     .= $str . "\0";
	}
	foreach ( $offsets as $o ) {
		$o_table .= pack( 'VV', $o[0], $data + $o[1] );
		$t_table .= pack( 'VV', $o[2], $data + strlen( $ids ) + $o[3] );
	}
	// Empty hash table placed right after the translation table (readers such as WordPress' MO class expect that).
	return pack( 'VVVVVVV', 0x950412de, 0, $n, $o_tab, $t_tab, 0, $data ) . $o_table . $t_table . $ids . $strs;
}

$entries = dlos_extract( $root, $domain );
ksort( $entries, SORT_STRING );
$langdir = $root . '/languages';
if ( ! is_dir( $langdir ) ) {
	mkdir( $langdir, 0755, true );
}

$pot_header = 'msgid ""' . "\n" . 'msgstr ""' . "\n"
	. '"Project-Id-Version: DLang OS Connect 1.0.0\n"' . "\n"
	. '"Report-Msgid-Bugs-To: \n"' . "\n"
	. '"MIME-Version: 1.0\n"' . "\n"
	. '"Content-Type: text/plain; charset=UTF-8\n"' . "\n"
	. '"Content-Transfer-Encoding: 8bit\n"' . "\n"
	. '"X-Domain: dlang-os-connect\n"' . "\n";

$missing_total = 0;
if ( ! $check ) {
	file_put_contents( $langdir . '/' . $domain . '.pot', dlos_po( $entries, $pot_header ) );
}
foreach ( $locales as $locale ) {
	$translations = require __DIR__ . '/translations/' . $locale . '.php';
	$plural_forms = 'nplurals=2; plural=' . ( 'fr_FR' === $locale ? '(n > 1)' : '(n != 1)' ) . ';';
	$missing      = array_diff( array_keys( $entries ), array_keys( $translations ) );
	$unused       = array_diff( array_keys( $translations ), array_keys( $entries ) );
	foreach ( $missing as $m ) {
		fwrite( STDERR, "[{$locale}] missing: " . str_replace( "\x04", ' | ', $m ) . "\n" );
	}
	foreach ( $unused as $u ) {
		fwrite( STDERR, "[{$locale}] unused: " . str_replace( "\x04", ' | ', $u ) . "\n" );
	}
	$missing_total += count( $missing );
	if ( $check ) {
		continue;
	}
	$header = str_replace( 'X-Domain', "Language: {$locale}\\n\"\n\"Plural-Forms: {$plural_forms}\\n\"\n\"X-Domain", $pot_header );
	file_put_contents( $langdir . '/' . $domain . '-' . $locale . '.po', dlos_po( $entries, $header, $translations ) );
	file_put_contents( $langdir . '/' . $domain . '-' . $locale . '.mo', dlos_mo( $entries, $translations, $plural_forms, $locale ) );
}
echo count( $entries ) . ' strings, ' . count( $locales ) . ' locales, ' . $missing_total . " missing\n";
exit( $missing_total > 0 ? 1 : 0 );
