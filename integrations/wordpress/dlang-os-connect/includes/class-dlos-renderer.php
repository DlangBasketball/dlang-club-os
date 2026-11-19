<?php
/**
 * Server-side HTML for every widget. Pure functions of (envelope, attributes, context) so they can be tested.
 *
 * Escaping rule: every value from the API is escaped at output (esc_html / esc_attr / esc_url),
 * rich text fields go through wp_kses_post, JSON-LD is hex-encoded.
 *
 * @package DLangOSConnect
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Renderer.
 */
class DLOS_Renderer {

	/**
	 * Default render context.
	 *
	 * @return array
	 */
	public static function default_context() {
		return array(
			'theme'         => 'club',
			'inherit_fonts' => true,
			'interactive'   => 'app',
			'jsonld'        => true,
			'stale'         => false,
			'lang'          => '',
			'club_slug'     => '',
			'app_url'       => '',
			'site_origin'   => '',
		);
	}

	/* ------------------------------------------------------------------ */
	/* Wrapper, states, shared bits                                        */
	/* ------------------------------------------------------------------ */

	/**
	 * Wrap widget content.
	 *
	 * @param string $widget  Widget name.
	 * @param string $inner   Inner HTML (already escaped).
	 * @param array  $club    Club block of the envelope.
	 * @param array  $ctx     Context.
	 * @param string $jsonld  JSON-LD script (already encoded).
	 * @return string
	 */
	public static function wrap( $widget, $inner, array $club, array $ctx, $jsonld = '' ) {
		$theme   = in_array( $ctx['theme'], array( 'club', 'light', 'dark' ), true ) ? $ctx['theme'] : 'club';
		$classes = array( 'dlos', 'dlos--' . sanitize_html_class( $widget ), 'dlos-theme--' . $theme );
		if ( ! empty( $ctx['inherit_fonts'] ) ) {
			$classes[] = 'dlos--inherit-fonts';
		}
		$style = DLOS_Theme::style( isset( $club['theme'] ) && is_array( $club['theme'] ) ? $club['theme'] : array(), $theme, ! empty( $ctx['inherit_fonts'] ) );

		$html = '<div class="' . esc_attr( implode( ' ', $classes ) ) . '"' . ( '' !== $style ? ' style="' . esc_attr( $style ) . '"' : '' ) . '>';
		if ( ! empty( $ctx['stale'] ) ) {
			$html .= '<p class="dlos-note" role="status">' . esc_html__( 'Updating: showing the last saved information.', 'dlang-os-connect' ) . '</p>';
		}
		$html .= $inner;
		$html .= '</div>';
		if ( ! empty( $ctx['jsonld'] ) ) {
			$html .= $jsonld;
		}
		return $html;
	}

	/**
	 * Empty state.
	 *
	 * @param string $message Message.
	 * @return string
	 */
	public static function empty_state( $message ) {
		return '<p class="dlos-empty">' . esc_html( $message ) . '</p>';
	}

	/**
	 * Error state: visitors see a quiet link to the app, admins see what to fix.
	 *
	 * @param string $widget   Widget.
	 * @param string $error    Error code.
	 * @param bool   $is_admin Whether the viewer can manage the plugin.
	 * @param string $app_url  App URL.
	 * @return string
	 */
	public static function error_state( $widget, $error, $is_admin, $app_url ) {
		if ( $is_admin ) {
			if ( 'not_configured' === $error ) {
				$msg = __( 'DLang OS Connect is not configured yet. Go to Settings > DLang OS.', 'dlang-os-connect' );
			} elseif ( 'not_found' === $error ) {
				$msg = __( 'The app did not find this club. Check the club slug and that the website connection is enabled in the app.', 'dlang-os-connect' );
			} else {
				/* translators: %s: technical error code */
				$msg = sprintf( __( 'Could not load data from the app (%s). Visitors see a link to the app instead.', 'dlang-os-connect' ), $error );
			}
			return '<div class="dlos dlos--error"><p class="dlos-note dlos-note--admin" role="status">' . esc_html( $msg ) . '</p></div>';
		}
		if ( '' === $app_url ) {
			return '';
		}
		return '<div class="dlos dlos--error dlos--' . esc_attr( sanitize_html_class( $widget ) ) . '"><p class="dlos-empty"><a class="dlos-link" href="' . esc_url( $app_url ) . '" target="_blank" rel="noopener">' . esc_html__( 'See this on the club app', 'dlang-os-connect' ) . self::new_tab_hint() . '</a></p></div>';
	}

	/**
	 * Screen-reader hint for links that open a new tab.
	 *
	 * @return string
	 */
	public static function new_tab_hint() {
		return '<span class="dlos-sr"> ' . esc_html__( '(opens in a new tab)', 'dlang-os-connect' ) . '</span>';
	}

	/**
	 * Call-to-action button.
	 *
	 * @param string $href        Target URL (app page).
	 * @param string $label       Label.
	 * @param array  $ctx         Context.
	 * @param string $embed_path  Embed widget path for embed mode ('' = always open the app).
	 * @param array  $embed_query Extra embed query.
	 * @param string $variant     primary|secondary.
	 * @return string
	 */
	public static function cta( $href, $label, array $ctx, $embed_path = '', array $embed_query = array(), $variant = 'primary' ) {
		$href = DLOS_Format::url( $href );
		if ( '' === $href ) {
			return '';
		}
		$attrs = ' class="dlos-btn dlos-btn--' . esc_attr( $variant ) . '" href="' . esc_url( $href ) . '" target="_blank" rel="noopener"';
		if ( 'embed' === $ctx['interactive'] && '' !== $embed_path ) {
			$src = self::embed_url( $embed_path, $embed_query, $ctx );
			if ( '' !== $src ) {
				$attrs .= ' data-dlos-embed="' . esc_url( $src ) . '"';
			}
		}
		return '<a' . $attrs . '>' . esc_html( $label ) . self::new_tab_hint() . '</a>';
	}

	/**
	 * Secondary text link to an app page.
	 *
	 * @param string $href  URL.
	 * @param string $label Label.
	 * @return string
	 */
	public static function link( $href, $label ) {
		$href = DLOS_Format::url( $href );
		if ( '' === $href ) {
			return '';
		}
		return '<a class="dlos-link" href="' . esc_url( $href ) . '" target="_blank" rel="noopener">' . esc_html( $label ) . self::new_tab_hint() . '</a>';
	}

	/**
	 * Chrome-less embed URL on the app.
	 *
	 * @param string $path  Widget path, e.g. register/u14.
	 * @param array  $query Extra query.
	 * @param array  $ctx   Context.
	 * @return string
	 */
	public static function embed_url( $path, array $query, array $ctx ) {
		if ( '' === $ctx['app_url'] ) {
			return '';
		}
		$path = trim( preg_replace( '#[^A-Za-z0-9/_-]#', '', (string) $path ), '/' );
		$q    = array_merge(
			array(
				'club'   => $ctx['club_slug'],
				'lang'   => $ctx['lang'],
				'theme'  => $ctx['theme'],
				'origin' => $ctx['site_origin'],
			),
			$query
		);
		$q    = array_filter(
			$q,
			function ( $v ) {
				return null !== $v && '' !== (string) $v;
			}
		);
		return $ctx['app_url'] . '/embed/' . $path . '?' . http_build_query( $q, '', '&', PHP_QUERY_RFC3986 );
	}

	/**
	 * Status badge.
	 *
	 * @param string   $status      open|full|waitlist|closed|cancelled|moved.
	 * @param int|null $places_left Places left.
	 * @return string
	 */
	public static function badge( $status, $places_left = null ) {
		$labels = array(
			'open'      => __( 'Open', 'dlang-os-connect' ),
			'full'      => __( 'Full', 'dlang-os-connect' ),
			'waitlist'  => __( 'Waiting list', 'dlang-os-connect' ),
			'closed'    => __( 'Closed', 'dlang-os-connect' ),
			'cancelled' => __( 'Cancelled', 'dlang-os-connect' ),
			'moved'     => __( 'Moved', 'dlang-os-connect' ),
		);
		$out    = '';
		if ( isset( $labels[ $status ] ) ) {
			$out .= '<span class="dlos-badge dlos-badge--' . esc_attr( $status ) . '">' . esc_html( $labels[ $status ] ) . '</span>';
		}
		if ( 'open' === $status && null !== $places_left && $places_left > 0 && $places_left <= 10 ) {
			/* translators: %d: number of places left */
			$out .= ' <span class="dlos-badge dlos-badge--places">' . esc_html( sprintf( _n( '%d place left', '%d places left', $places_left, 'dlang-os-connect' ), $places_left ) ) . '</span>';
		}
		return $out;
	}

	/**
	 * Places left as int or null.
	 *
	 * @param array $item Item.
	 * @return int|null
	 */
	public static function places_left( array $item ) {
		return isset( $item['places_left'] ) && is_numeric( $item['places_left'] ) ? (int) $item['places_left'] : null;
	}

	/**
	 * Registration CTA label for a status.
	 *
	 * @param string $status Status.
	 * @return string '' when registration is not possible.
	 */
	public static function register_label( $status ) {
		if ( 'waitlist' === $status || 'full' === $status ) {
			return __( 'Join the waiting list', 'dlang-os-connect' );
		}
		if ( 'closed' === $status ) {
			return '';
		}
		return __( 'Register', 'dlang-os-connect' );
	}

	/**
	 * Range text from "8-14", {min,max} or {from,to}.
	 *
	 * @param mixed $range Range.
	 * @return string
	 */
	public static function range_text( $range ) {
		if ( is_string( $range ) || is_int( $range ) ) {
			return (string) $range;
		}
		if ( is_array( $range ) ) {
			if ( isset( $range['formatted'] ) && is_string( $range['formatted'] ) ) {
				return $range['formatted'];
			}
			$min = isset( $range['min'] ) ? $range['min'] : ( isset( $range['from'] ) ? $range['from'] : null );
			$max = isset( $range['max'] ) ? $range['max'] : ( isset( $range['to'] ) ? $range['to'] : null );
			if ( is_numeric( $min ) && is_numeric( $max ) ) {
				return (int) $min . '–' . (int) $max;
			}
			if ( is_numeric( $min ) ) {
				return (int) $min . '+';
			}
		}
		return '';
	}

	/**
	 * Date span text for {start,end,formatted} / "string" / starts_on+ends_on.
	 *
	 * @param mixed $dates Dates.
	 * @param array $item  Fallback item with starts_on/ends_on.
	 * @return string
	 */
	public static function dates_text( $dates, array $item = array() ) {
		if ( is_string( $dates ) ) {
			return $dates;
		}
		if ( is_array( $dates ) ) {
			if ( isset( $dates['formatted'] ) && is_string( $dates['formatted'] ) ) {
				return $dates['formatted'];
			}
			$start = DLOS_Format::date( $dates, 'start', false );
			$end   = DLOS_Format::date( $dates, 'end', false );
			if ( '' !== $start ) {
				return '' !== $end && $end !== $start ? $start . ' – ' . $end : $start;
			}
		}
		$start = DLOS_Format::date( $item, 'starts_on', false );
		$end   = DLOS_Format::date( $item, 'ends_on', false );
		if ( '' === $start ) {
			return '';
		}
		return '' !== $end && $end !== $start ? $start . ' – ' . $end : $start;
	}

	/**
	 * Meta line from parts.
	 *
	 * @param string[] $parts Plain strings.
	 * @return string
	 */
	public static function meta( array $parts ) {
		$parts = array_values( array_filter( array_map( 'strval', $parts ), 'strlen' ) );
		if ( empty( $parts ) ) {
			return '';
		}
		return '<p class="dlos-meta">' . implode( '<span class="dlos-sep" aria-hidden="true"> · </span>', array_map( 'esc_html', $parts ) ) . '</p>';
	}

	/**
	 * Image tag (lazy, decoding async) or ''.
	 *
	 * @param mixed  $url   URL.
	 * @param string $alt   Alt text.
	 * @param string $class Class.
	 * @return string
	 */
	public static function img( $url, $alt, $class = 'dlos-card__img' ) {
		$url = DLOS_Format::url( $url );
		if ( '' === $url ) {
			return '';
		}
		return '<img class="' . esc_attr( $class ) . '" src="' . esc_url( $url ) . '" alt="' . esc_attr( $alt ) . '" loading="lazy" decoding="async">';
	}

	/**
	 * Apply an item limit.
	 *
	 * @param array $items Items.
	 * @param mixed $limit Limit (0/empty = all).
	 * @return array
	 */
	public static function limit( array $items, $limit ) {
		$limit = (int) $limit;
		return $limit > 0 ? array_slice( $items, 0, $limit ) : $items;
	}

	/* ------------------------------------------------------------------ */
	/* Widgets                                                             */
	/* ------------------------------------------------------------------ */

	/**
	 * Camps grouped by season.
	 *
	 * @param array $env   Envelope.
	 * @param array $attrs Attributes.
	 * @param array $ctx   Context.
	 * @return string
	 */
	public static function camps( array $env, array $attrs, array $ctx ) {
		$club   = $env['club'];
		$groups = $env['data'];
		if ( empty( $groups ) ) {
			return self::wrap( 'camps', self::empty_state( __( 'No camps are open for registration at the moment.', 'dlang-os-connect' ) ), $club, $ctx );
		}
		$html  = '';
		$nodes = array();
		foreach ( $groups as $group ) {
			$title = DLOS_Format::str( $group, 'title' );
			$html .= '<section class="dlos-group">';
			$html .= '<div class="dlos-group__head">';
			if ( '' !== $title ) {
				$html .= '<h3 class="dlos-group__title">' . esc_html( $title ) . '</h3>';
			}
			$html .= self::link( isset( $group['url'] ) ? $group['url'] : '', __( 'All dates and prices', 'dlang-os-connect' ) );
			$html .= '</div><ul class="dlos-grid" role="list">';

			foreach ( DLOS_Format::arr( $group, 'editions' ) as $ed ) {
				if ( ! is_array( $ed ) ) {
					continue;
				}
				$status = DLOS_Format::str( $ed, 'status' );
				$places = self::places_left( $ed );
				$html  .= '<li class="dlos-card">';
				$html  .= '<h4 class="dlos-card__title">' . esc_html( DLOS_Format::str( $ed, 'name' ) ) . '</h4>';
				$ages   = self::range_text( isset( $ed['ages'] ) ? $ed['ages'] : '' );
				$html  .= self::meta(
					array(
						self::dates_text( isset( $ed['dates'] ) ? $ed['dates'] : null, $ed ),
						self::venue_name( isset( $ed['venue'] ) ? $ed['venue'] : null ),
						'' !== $ages ? sprintf( /* translators: %s: age range */ __( 'Ages %s', 'dlang-os-connect' ), $ages ) : '',
					)
				);
				$html  .= self::price_options( DLOS_Format::arr( $ed, 'price_options' ) );
				$html  .= '<p class="dlos-card__status">' . self::badge( $status, $places ) . '</p>';
				$label  = self::register_label( $status );
				$btn    = '' === $label ? '' : self::cta(
					isset( $ed['action_url'] ) ? $ed['action_url'] : '',
					$label,
					$ctx,
					'camps',
					array(
						'season' => DLOS_Format::str( $group, 'season' ),
						'year'   => DLOS_Format::str( $group, 'year' ),
					)
				);
				if ( '' !== $btn ) {
					$html .= '<p class="dlos-card__actions">' . $btn . '</p>';
				}
				$html   .= '</li>';
				$nodes[] = DLOS_JsonLd::camp( $ed, $group, $club );
			}
			$html .= '</ul></section>';
		}
		return self::wrap( 'camps', $html, $club, $ctx, self::schema( $attrs, $nodes ) );
	}

	/**
	 * Camp price options list.
	 *
	 * @param array $options Options.
	 * @return string
	 */
	public static function price_options( array $options ) {
		$rows = '';
		foreach ( $options as $opt ) {
			if ( ! is_array( $opt ) ) {
				continue;
			}
			$days  = isset( $opt['days'] ) && is_numeric( $opt['days'] ) ? (int) $opt['days'] : 0;
			$label = $days > 0
				/* translators: %d: number of days */
				? sprintf( _n( '%d day', '%d days', $days, 'dlang-os-connect' ), $days )
				: DLOS_Format::str( $opt, 'label' );
			if ( ! empty( $opt['lunch'] ) ) {
				$label .= ' ' . __( 'with lunch', 'dlang-os-connect' );
			}
			$price  = DLOS_Format::money( isset( $opt['price'] ) ? $opt['price'] : null );
			$member = DLOS_Format::money( isset( $opt['member_price'] ) ? $opt['member_price'] : null );
			$rows  .= '<li><span class="dlos-prices__label">' . esc_html( $label ) . '</span> <span class="dlos-prices__price">' . esc_html( $price ) . '</span>';
			if ( '' !== $member && $member !== $price ) {
				/* translators: %s: member price */
				$rows .= ' <span class="dlos-prices__member">' . esc_html( sprintf( __( 'members %s', 'dlang-os-connect' ), $member ) ) . '</span>';
			}
			$rows .= '</li>';
		}
		return '' === $rows ? '' : '<ul class="dlos-prices" role="list">' . $rows . '</ul>';
	}

	/**
	 * Venue name from string/object.
	 *
	 * @param mixed $venue Venue.
	 * @return string
	 */
	public static function venue_name( $venue ) {
		if ( is_string( $venue ) ) {
			return $venue;
		}
		return is_array( $venue ) ? DLOS_Format::str( $venue, 'name' ) : '';
	}

	/**
	 * Programmes.
	 *
	 * @param array $env   Envelope.
	 * @param array $attrs Attributes.
	 * @param array $ctx   Context.
	 * @return string
	 */
	public static function programs( array $env, array $attrs, array $ctx ) {
		$items = self::limit( $env['data'], isset( $attrs['limit'] ) ? $attrs['limit'] : 0 );
		if ( empty( $items ) ) {
			return self::wrap( 'programs', self::empty_state( __( 'No programmes are open at the moment.', 'dlang-os-connect' ) ), $env['club'], $ctx );
		}
		$html = '<ul class="dlos-grid" role="list">';
		foreach ( $items as $p ) {
			$name   = DLOS_Format::str( $p, 'name' );
			$status = DLOS_Format::str( $p, 'status' );
			$html  .= '<li class="dlos-card">';
			$html  .= self::img( isset( $p['cover_url'] ) ? $p['cover_url'] : '', '' );
			$html  .= '<h3 class="dlos-card__title">' . esc_html( $name ) . '</h3>';
			$from   = DLOS_Format::money( isset( $p['price_from'] ) ? $p['price_from'] : null );
			$ages   = self::range_text( isset( $p['age_range'] ) ? $p['age_range'] : '' );
			$html  .= self::meta(
				array(
					self::dates_text( null, $p ),
					self::venue_name( isset( $p['location'] ) ? $p['location'] : null ),
					'' !== $ages ? sprintf( /* translators: %s: age range */ __( 'Ages %s', 'dlang-os-connect' ), $ages ) : '',
					DLOS_Format::str( $p, 'level' ),
				)
			);
			$desc   = DLOS_Format::str( $p, 'description' );
			if ( '' !== $desc ) {
				$html .= '<div class="dlos-card__text">' . wp_kses_post( $desc ) . '</div>';
			}
			if ( '' !== $from ) {
				/* translators: %s: price */
				$html .= '<p class="dlos-price">' . esc_html( sprintf( __( 'From %s', 'dlang-os-connect' ), $from ) ) . '</p>';
			}
			$html .= '<p class="dlos-card__status">' . self::badge( $status, self::places_left( $p ) ) . '</p>';
			$html .= '<p class="dlos-card__actions">';
			$label = self::register_label( $status );
			if ( '' !== $label ) {
				$html .= self::cta( isset( $p['action_url'] ) ? $p['action_url'] : '', $label, $ctx, 'register/' . DLOS_Format::str( $p, 'slug' ) );
			}
			$html .= ' ' . self::link( isset( $p['url'] ) ? $p['url'] : '', __( 'Details', 'dlang-os-connect' ) );
			$html .= '</p></li>';
		}
		$html .= '</ul>';
		return self::wrap( 'programs', $html, $env['club'], $ctx );
	}

	/**
	 * Upcoming schedule.
	 *
	 * @param array $env   Envelope.
	 * @param array $attrs Attributes.
	 * @param array $ctx   Context.
	 * @return string
	 */
	public static function schedule( array $env, array $attrs, array $ctx ) {
		$items = self::limit( $env['data'], isset( $attrs['limit'] ) ? $attrs['limit'] : 0 );
		if ( empty( $items ) ) {
			return self::wrap( 'schedule', self::empty_state( __( 'Nothing is scheduled in this period.', 'dlang-os-connect' ) ), $env['club'], $ctx );
		}
		$html = self::event_list( $items, false );
		$ics  = self::ics_url( $attrs, $ctx );
		if ( '' !== $ics ) {
			$html .= '<p class="dlos-foot"><a class="dlos-link" href="' . esc_url( $ics ) . '">' . esc_html__( 'Subscribe to this calendar', 'dlang-os-connect' ) . '</a></p>';
		}
		return self::wrap( 'schedule', $html, $env['club'], $ctx, self::schema( $attrs, self::event_nodes( $items, $env['club'] ) ) );
	}

	/**
	 * Past results.
	 *
	 * @param array $env   Envelope.
	 * @param array $attrs Attributes.
	 * @param array $ctx   Context.
	 * @return string
	 */
	public static function results( array $env, array $attrs, array $ctx ) {
		$items = self::limit( $env['data'], isset( $attrs['limit'] ) ? $attrs['limit'] : 0 );
		if ( empty( $items ) ) {
			return self::wrap( 'results', self::empty_state( __( 'No results yet.', 'dlang-os-connect' ) ), $env['club'], $ctx );
		}
		return self::wrap( 'results', self::event_list( $items, true ), $env['club'], $ctx, self::schema( $attrs, self::event_nodes( $items, $env['club'] ) ) );
	}

	/**
	 * JSON-LD nodes for games and tournaments.
	 *
	 * @param array $items Events.
	 * @param array $club  Club.
	 * @return array
	 */
	public static function event_nodes( array $items, array $club ) {
		$nodes = array();
		foreach ( $items as $e ) {
			if ( in_array( DLOS_Format::str( $e, 'type' ), array( 'game', 'tournament' ), true ) ) {
				$nodes[] = DLOS_JsonLd::event( $e, $club );
			}
		}
		return $nodes;
	}

	/**
	 * Event list markup.
	 *
	 * @param array $items       Events.
	 * @param bool  $with_scores Results mode.
	 * @return string
	 */
	public static function event_list( array $items, $with_scores ) {
		$types = array(
			'game'       => __( 'Game', 'dlang-os-connect' ),
			'training'   => __( 'Training', 'dlang-os-connect' ),
			'event'      => __( 'Event', 'dlang-os-connect' ),
			'tournament' => __( 'Tournament', 'dlang-os-connect' ),
		);
		$html  = '<ol class="dlos-events" role="list">';
		foreach ( $items as $e ) {
			$type   = DLOS_Format::str( $e, 'type' );
			$status = DLOS_Format::str( $e, 'status' );
			$iso    = DLOS_Format::iso( $e, 'starts_at' );
			$html  .= '<li class="dlos-event dlos-event--' . esc_attr( sanitize_html_class( $type ) ) . ( 'cancelled' === $status ? ' dlos-event--cancelled' : '' ) . '">';
			$html  .= '<div class="dlos-event__when">';
			$when   = DLOS_Format::date( $e, 'starts_at' );
			$html  .= '' !== $iso ? '<time datetime="' . esc_attr( $iso ) . '">' . esc_html( $when ) . '</time>' : esc_html( $when );
			$html  .= '</div><div class="dlos-event__body">';
			if ( isset( $types[ $type ] ) ) {
				$html .= '<span class="dlos-event__type">' . esc_html( $types[ $type ] ) . '</span> ';
			}
			$html .= '<h3 class="dlos-event__title">' . esc_html( self::event_title( $e ) ) . '</h3>';

			$venue = isset( $e['venue'] ) ? $e['venue'] : null;
			$parts = array(
				DLOS_Format::str( DLOS_Format::arr( $e, 'team' ), 'name' ),
				self::venue_name( $venue ),
			);
			$html .= self::meta( $parts );

			if ( $with_scores ) {
				$html .= self::score( DLOS_Format::arr( $e, 'result' ) );
			}
			if ( in_array( $status, array( 'cancelled', 'moved' ), true ) ) {
				$html .= '<p class="dlos-card__status">' . self::badge( $status ) . '</p>';
			}
			$links = '';
			$maps  = is_array( $venue ) ? DLOS_Format::url( isset( $venue['maps_url'] ) ? $venue['maps_url'] : '' ) : '';
			if ( '' !== $maps ) {
				$links .= self::link( $maps, __( 'Directions', 'dlang-os-connect' ) ) . ' ';
			}
			$links .= self::link( isset( $e['url'] ) ? $e['url'] : '', __( 'Details', 'dlang-os-connect' ) );
			if ( '' !== trim( $links ) ) {
				$html .= '<p class="dlos-event__links">' . $links . '</p>';
			}
			$html .= '</div></li>';
		}
		return $html . '</ol>';
	}

	/**
	 * "Team vs Opponent" / "Opponent vs Team" / title.
	 *
	 * @param array $e Event.
	 * @return string
	 */
	public static function event_title( array $e ) {
		$team     = DLOS_Format::str( DLOS_Format::arr( $e, 'team' ), 'name' );
		$opponent = DLOS_Format::str( $e, 'opponent' );
		if ( 'game' === DLOS_Format::str( $e, 'type' ) && '' !== $team && '' !== $opponent ) {
			$away = 'away' === DLOS_Format::str( $e, 'home_away' );
			/* translators: 1: home team, 2: away team */
			return sprintf( __( '%1$s vs %2$s', 'dlang-os-connect' ), $away ? $opponent : $team, $away ? $team : $opponent );
		}
		return DLOS_Format::str( $e, 'title' );
	}

	/**
	 * Score line.
	 *
	 * @param array $result Result.
	 * @return string
	 */
	public static function score( array $result ) {
		if ( ! isset( $result['our_score'], $result['their_score'] ) || ! is_numeric( $result['our_score'] ) || ! is_numeric( $result['their_score'] ) ) {
			return '';
		}
		$labels  = array(
			'win'  => __( 'Win', 'dlang-os-connect' ),
			'loss' => __( 'Loss', 'dlang-os-connect' ),
			'draw' => __( 'Draw', 'dlang-os-connect' ),
		);
		$outcome = DLOS_Format::str( $result, 'outcome' );
		$html    = '<p class="dlos-score"><span class="dlos-score__value">' . esc_html( (int) $result['our_score'] . ' – ' . (int) $result['their_score'] ) . '</span>';
		if ( isset( $labels[ $outcome ] ) ) {
			$html .= ' <span class="dlos-badge dlos-badge--' . esc_attr( $outcome ) . '">' . esc_html( $labels[ $outcome ] ) . '</span>';
		}
		return $html . '</p>';
	}

	/**
	 * iCalendar feed URL for the schedule filters.
	 *
	 * @param array $attrs Attributes.
	 * @param array $ctx   Context.
	 * @return string
	 */
	public static function ics_url( array $attrs, array $ctx ) {
		if ( '' === $ctx['app_url'] || '' === $ctx['club_slug'] ) {
			return '';
		}
		$q = array_filter(
			array(
				'club' => $ctx['club_slug'],
				'lang' => $ctx['lang'],
				'team' => isset( $attrs['team'] ) ? preg_replace( '/[^A-Za-z0-9_-]/', '', (string) $attrs['team'] ) : '',
				'type' => isset( $attrs['type'] ) ? preg_replace( '/[^a-z,]/', '', (string) $attrs['type'] ) : '',
			),
			'strlen'
		);
		return $ctx['app_url'] . '/api/public/v1/calendar.ics?' . http_build_query( $q, '', '&', PHP_QUERY_RFC3986 );
	}

	/**
	 * Teams grid.
	 *
	 * @param array $env   Envelope.
	 * @param array $attrs Attributes.
	 * @param array $ctx   Context.
	 * @return string
	 */
	public static function teams( array $env, array $attrs, array $ctx ) {
		$items = $env['data'];
		if ( empty( $items ) ) {
			return self::wrap( 'teams', self::empty_state( __( 'No teams to show yet.', 'dlang-os-connect' ) ), $env['club'], $ctx );
		}
		$html = '<ul class="dlos-grid" role="list">';
		foreach ( $items as $t ) {
			$html   .= '<li class="dlos-card">';
			$html   .= self::img( isset( $t['cover_url'] ) ? $t['cover_url'] : '', '' );
			$html   .= '<h3 class="dlos-card__title">' . esc_html( DLOS_Format::str( $t, 'name' ) ) . '</h3>';
			$html   .= self::meta( array( DLOS_Format::str( $t, 'age_group' ), DLOS_Format::str( $t, 'league' ) ) );
			$coaches = array();
			foreach ( DLOS_Format::arr( $t, 'coaches' ) as $c ) {
				$n = DLOS_Format::str( $c, 'name' );
				if ( '' !== $n ) {
					$coaches[] = $n;
				}
			}
			if ( $coaches ) {
				/* translators: %s: list of coach names */
				$html .= '<p class="dlos-card__line">' . esc_html( sprintf( __( 'Coaches: %s', 'dlang-os-connect' ), implode( ', ', $coaches ) ) ) . '</p>';
			}
			$html .= self::training_times( DLOS_Format::arr( $t, 'training_times' ) );
			$html .= '<p class="dlos-card__actions">' . self::link( isset( $t['url'] ) ? $t['url'] : '', __( 'Team page', 'dlang-os-connect' ) ) . '</p>';
			$html .= '</li>';
		}
		$html .= '</ul>';
		return self::wrap( 'teams', $html, $env['club'], $ctx );
	}

	/**
	 * One team (by slug) with coaches, training times and optional public roster.
	 *
	 * @param array  $env       Teams envelope.
	 * @param array  $attrs     Attributes (slug, show_roster).
	 * @param array  $ctx       Context.
	 * @param string $schedule  Pre-rendered schedule HTML for the team ('' = none).
	 * @param string $results   Pre-rendered results HTML.
	 * @return string
	 */
	public static function team( array $env, array $attrs, array $ctx, $schedule = '', $results = '' ) {
		$slug = isset( $attrs['slug'] ) ? strtolower( (string) $attrs['slug'] ) : '';
		$team = null;
		foreach ( $env['data'] as $t ) {
			if ( '' !== $slug && strtolower( DLOS_Format::str( $t, 'slug' ) ) === $slug ) {
				$team = $t;
				break;
			}
		}
		if ( null === $team ) {
			return self::wrap( 'team', self::empty_state( __( 'This team was not found.', 'dlang-os-connect' ) ), $env['club'], $ctx );
		}
		$html  = '<article class="dlos-team">';
		$html .= self::img( isset( $team['cover_url'] ) ? $team['cover_url'] : '', '', 'dlos-team__cover' );
		$html .= '<h2 class="dlos-team__title">' . esc_html( DLOS_Format::str( $team, 'name' ) ) . '</h2>';
		$html .= self::meta( array( DLOS_Format::str( $team, 'age_group' ), DLOS_Format::str( $team, 'league' ) ) );

		$coaches = DLOS_Format::arr( $team, 'coaches' );
		if ( $coaches ) {
			$html .= '<h3 class="dlos-h">' . esc_html__( 'Coaches', 'dlang-os-connect' ) . '</h3><ul class="dlos-people" role="list">';
			foreach ( $coaches as $c ) {
				$name  = DLOS_Format::str( $c, 'name' );
				$html .= '<li class="dlos-person">' . self::img( isset( $c['photo_url'] ) ? $c['photo_url'] : '', $name, 'dlos-person__photo' );
				$html .= '<span class="dlos-person__name">' . esc_html( $name ) . '</span>';
				$role  = DLOS_Format::str( $c, 'role' );
				if ( '' !== $role ) {
					$html .= ' <span class="dlos-person__role">' . esc_html( $role ) . '</span>';
				}
				$html .= '</li>';
			}
			$html .= '</ul>';
		}

		$times = self::training_times( DLOS_Format::arr( $team, 'training_times' ) );
		if ( '' !== $times ) {
			$html .= '<h3 class="dlos-h">' . esc_html__( 'Training times', 'dlang-os-connect' ) . '</h3>' . $times;
		}

		// Roster only when the site owner opts in AND the app published one (consent-checked there:
		// number + first name and initial). Never photos of players.
		$roster = DLOS_Format::arr( $team, 'roster' );
		if ( ! empty( $attrs['show_roster'] ) && $roster ) {
			$html .= '<h3 class="dlos-h">' . esc_html__( 'Roster', 'dlang-os-connect' ) . '</h3><ul class="dlos-roster" role="list">';
			foreach ( $roster as $p ) {
				$num   = DLOS_Format::str( $p, 'number' );
				$html .= '<li>' . ( '' !== $num ? '<span class="dlos-roster__num">' . esc_html( $num ) . '</span> ' : '' ) . esc_html( DLOS_Format::str( $p, 'name' ) ) . '</li>';
			}
			$html .= '</ul>';
		}

		if ( '' !== $schedule ) {
			$html .= '<h3 class="dlos-h">' . esc_html__( 'Next games and events', 'dlang-os-connect' ) . '</h3>' . $schedule;
		}
		if ( '' !== $results ) {
			$html .= '<h3 class="dlos-h">' . esc_html__( 'Latest results', 'dlang-os-connect' ) . '</h3>' . $results;
		}
		$html .= '<p class="dlos-card__actions">' . self::link( isset( $team['url'] ) ? $team['url'] : '', __( 'Team page on the app', 'dlang-os-connect' ) ) . '</p>';
		$html .= '</article>';
		return self::wrap( 'team', $html, $env['club'], $ctx );
	}

	/**
	 * Training times list.
	 *
	 * @param array $times Times.
	 * @return string
	 */
	public static function training_times( array $times ) {
		$rows = '';
		foreach ( $times as $tt ) {
			if ( ! is_array( $tt ) ) {
				continue;
			}
			$span  = trim( DLOS_Format::str( $tt, 'start' ) . '–' . DLOS_Format::str( $tt, 'end' ), '–' );
			$rows .= '<li>' . esc_html( trim( self::weekday( isset( $tt['weekday'] ) ? $tt['weekday'] : '' ) . ' ' . $span ) );
			$venue = self::venue_name( isset( $tt['venue'] ) ? $tt['venue'] : null );
			if ( '' !== $venue ) {
				$rows .= ' <span class="dlos-muted">' . esc_html( $venue ) . '</span>';
			}
			$rows .= '</li>';
		}
		return '' === $rows ? '' : '<ul class="dlos-times" role="list">' . $rows . '</ul>';
	}

	/**
	 * Weekday label from 0-7 (ISO 1 = Monday, 0/7 = Sunday) or a string.
	 *
	 * @param mixed $day Day.
	 * @return string
	 */
	public static function weekday( $day ) {
		if ( is_numeric( $day ) ) {
			global $wp_locale;
			$n = (int) $day % 7;
			if ( isset( $wp_locale ) && is_object( $wp_locale ) && method_exists( $wp_locale, 'get_weekday' ) ) {
				return (string) $wp_locale->get_weekday( $n );
			}
			$names = array( 'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday' );
			return $names[ $n ];
		}
		return is_string( $day ) ? $day : '';
	}

	/**
	 * Coaches.
	 *
	 * @param array $env   Envelope.
	 * @param array $attrs Attributes.
	 * @param array $ctx   Context.
	 * @return string
	 */
	public static function coaches( array $env, array $attrs, array $ctx ) {
		$items = $env['data'];
		if ( empty( $items ) ) {
			return self::wrap( 'coaches', self::empty_state( __( 'No coaches to show yet.', 'dlang-os-connect' ) ), $env['club'], $ctx );
		}
		$html = '<ul class="dlos-grid dlos-grid--people" role="list">';
		foreach ( $items as $c ) {
			$name  = DLOS_Format::str( $c, 'name' );
			$html .= '<li class="dlos-card dlos-card--person">';
			$html .= self::img( isset( $c['photo_url'] ) ? $c['photo_url'] : '', $name, 'dlos-card__photo' );
			$html .= '<h3 class="dlos-card__title">' . esc_html( $name ) . '</h3>';
			$html .= self::meta( array( DLOS_Format::str( $c, 'role' ) ) );
			$bio   = DLOS_Format::str( $c, 'bio' );
			if ( '' !== $bio ) {
				$html .= '<div class="dlos-card__text">' . wp_kses_post( $bio ) . '</div>';
			}
			$lic = array();
			foreach ( DLOS_Format::arr( $c, 'licences' ) as $l ) {
				$label = is_string( $l ) ? $l : DLOS_Format::str( $l, 'label' );
				if ( '' !== $label ) {
					$lic[] = '<span class="dlos-badge">' . esc_html( $label ) . '</span>';
				}
			}
			if ( $lic ) {
				$html .= '<p class="dlos-tags">' . implode( ' ', $lic ) . '</p>';
			}
			$html .= '</li>';
		}
		$html .= '</ul>';
		return self::wrap( 'coaches', $html, $env['club'], $ctx );
	}

	/**
	 * Player-development training services.
	 *
	 * @param array $env   Envelope.
	 * @param array $attrs Attributes.
	 * @param array $ctx   Context.
	 * @return string
	 */
	public static function training( array $env, array $attrs, array $ctx ) {
		$items = $env['data'];
		if ( empty( $items ) ) {
			return self::wrap( 'training', self::empty_state( __( 'No training sessions are bookable at the moment.', 'dlang-os-connect' ) ), $env['club'], $ctx );
		}
		$html = '<ul class="dlos-grid" role="list">';
		foreach ( $items as $s ) {
			$html .= '<li class="dlos-card">';
			$html .= '<h3 class="dlos-card__title">' . esc_html( DLOS_Format::str( $s, 'name' ) ) . '</h3>';
			$dur   = isset( $s['duration'] ) ? $s['duration'] : '';
			/* translators: %d: minutes */
			$dur_t = is_numeric( $dur ) ? sprintf( __( '%d min', 'dlang-os-connect' ), (int) $dur ) : ( is_string( $dur ) ? $dur : '' );
			$group = DLOS_Format::arr( $s, 'group' );
			$grp_t = '';
			if ( isset( $group['min'], $group['max'] ) && is_numeric( $group['min'] ) && is_numeric( $group['max'] ) ) {
				$grp_t = 1 === (int) $group['max']
					? __( 'Individual', 'dlang-os-connect' )
					/* translators: 1: minimum, 2: maximum group size */
					: sprintf( __( 'Groups of %1$d–%2$d', 'dlang-os-connect' ), (int) $group['min'], (int) $group['max'] );
			}
			$html .= self::meta( array( $dur_t, $grp_t ) );
			$price = DLOS_Format::money( isset( $s['price'] ) ? $s['price'] : null );
			if ( '' !== $price ) {
				/* translators: %s: price */
				$html .= '<p class="dlos-price">' . esc_html( sprintf( __( '%s per session', 'dlang-os-connect' ), $price ) ) . '</p>';
			}
			$packs = '';
			foreach ( DLOS_Format::arr( $s, 'packages' ) as $pk ) {
				$n = isset( $pk['sessions'] ) && is_numeric( $pk['sessions'] ) ? (int) $pk['sessions'] : 0;
				if ( $n <= 0 ) {
					continue;
				}
				/* translators: %d: number of sessions */
				$packs .= '<li><span class="dlos-prices__label">' . esc_html( sprintf( _n( '%d session', '%d sessions', $n, 'dlang-os-connect' ), $n ) ) . '</span> <span class="dlos-prices__price">' . esc_html( DLOS_Format::money( isset( $pk['price'] ) ? $pk['price'] : null ) ) . '</span></li>';
			}
			if ( '' !== $packs ) {
				$html .= '<ul class="dlos-prices" role="list">' . $packs . '</ul>';
			}
			$html .= '<p class="dlos-card__actions">' . self::cta( isset( $s['action_url'] ) ? $s['action_url'] : '', __( 'Book', 'dlang-os-connect' ), $ctx, 'book', array( 'service' => DLOS_Format::str( $s, 'id' ) ) ) . '</p>';
			$html .= '</li>';
		}
		$html .= '</ul>';
		return self::wrap( 'training', $html, $env['club'], $ctx );
	}

	/**
	 * Shop.
	 *
	 * @param array $env   Envelope.
	 * @param array $attrs Attributes.
	 * @param array $ctx   Context.
	 * @return string
	 */
	public static function shop( array $env, array $attrs, array $ctx ) {
		$items = self::limit( $env['data'], isset( $attrs['limit'] ) ? $attrs['limit'] : 0 );
		if ( empty( $items ) ) {
			return self::wrap( 'shop', self::empty_state( __( 'The shop has no items at the moment.', 'dlang-os-connect' ) ), $env['club'], $ctx );
		}
		$html  = '<ul class="dlos-grid" role="list">';
		$nodes = array();
		foreach ( $items as $p ) {
			$name   = DLOS_Format::str( $p, 'name' );
			$images = DLOS_Format::arr( $p, 'images' );
			$first  = $images ? ( is_array( $images[0] ) ? ( isset( $images[0]['url'] ) ? $images[0]['url'] : '' ) : $images[0] ) : '';
			$html  .= '<li class="dlos-card dlos-card--product">';
			$html  .= self::img( $first, $name );
			$html  .= '<h3 class="dlos-card__title">' . esc_html( $name ) . '</h3>';
			$price  = DLOS_Format::money( isset( $p['price'] ) ? $p['price'] : null );
			$member = DLOS_Format::money( isset( $p['member_price'] ) ? $p['member_price'] : null );
			if ( '' !== $price ) {
				$html .= '<p class="dlos-price">' . esc_html( $price );
				if ( '' !== $member && $member !== $price ) {
					/* translators: %s: member price */
					$html .= ' <span class="dlos-prices__member">' . esc_html( sprintf( __( 'members %s', 'dlang-os-connect' ), $member ) ) . '</span>';
				}
				$html .= '</p>';
			}
			$desc = DLOS_Format::str( $p, 'description' );
			if ( '' !== $desc ) {
				$html .= '<div class="dlos-card__text">' . wp_kses_post( $desc ) . '</div>';
			}
			$variants = array();
			foreach ( DLOS_Format::arr( $p, 'variants' ) as $v ) {
				$label = is_string( $v ) ? $v : ( '' !== DLOS_Format::str( $v, 'label' ) ? DLOS_Format::str( $v, 'label' ) : ( '' !== DLOS_Format::str( $v, 'size' ) ? DLOS_Format::str( $v, 'size' ) : DLOS_Format::str( $v, 'name' ) ) );
				if ( '' !== $label ) {
					$variants[] = $label;
				}
			}
			if ( $variants ) {
				/* translators: %s: list of sizes/variants */
				$html .= '<p class="dlos-card__line">' . esc_html( sprintf( __( 'Options: %s', 'dlang-os-connect' ), implode( ', ', $variants ) ) ) . '</p>';
			}
			$in_stock = ! ( isset( $p['in_stock'] ) && false === $p['in_stock'] );
			if ( ! $in_stock ) {
				$html .= '<p class="dlos-card__status"><span class="dlos-badge dlos-badge--full">' . esc_html__( 'Out of stock', 'dlang-os-connect' ) . '</span></p>';
			} else {
				$html .= '<p class="dlos-card__actions">' . self::cta( isset( $p['action_url'] ) ? $p['action_url'] : '', __( 'Buy', 'dlang-os-connect' ), $ctx, 'shop', array( 'product' => DLOS_Format::str( $p, 'id' ) ) ) . '</p>';
			}
			$html   .= '</li>';
			$nodes[] = DLOS_JsonLd::product( $p, $env['club'] );
		}
		$html .= '</ul>';
		return self::wrap( 'shop', $html, $env['club'], $ctx, self::schema( $attrs, $nodes ) );
	}

	/**
	 * Donation campaigns (all, or one by slug).
	 *
	 * @param array $env   Envelope.
	 * @param array $attrs Attributes (campaign).
	 * @param array $ctx   Context.
	 * @return string
	 */
	public static function donate( array $env, array $attrs, array $ctx ) {
		$items = $env['data'];
		$slug  = isset( $attrs['campaign'] ) ? strtolower( (string) $attrs['campaign'] ) : '';
		if ( '' !== $slug ) {
			$items = array_values(
				array_filter(
					$items,
					function ( $c ) use ( $slug ) {
						return strtolower( DLOS_Format::str( $c, 'slug' ) ) === $slug;
					}
				)
			);
		}
		if ( empty( $items ) ) {
			return self::wrap( 'donate', self::empty_state( __( 'There is no open fundraising campaign at the moment.', 'dlang-os-connect' ) ), $env['club'], $ctx );
		}
		$html = '<ul class="dlos-grid dlos-grid--wide" role="list">';
		foreach ( $items as $c ) {
			$title  = DLOS_Format::str( $c, 'title' );
			$pct    = isset( $c['progress_pct'] ) && is_numeric( $c['progress_pct'] ) ? max( 0, min( 100, (int) round( (float) $c['progress_pct'] ) ) ) : null;
			$html  .= '<li class="dlos-card dlos-card--campaign">';
			$html  .= '<h3 class="dlos-card__title">' . esc_html( $title ) . '</h3>';
			$raised = DLOS_Format::money( isset( $c['raised'] ) ? $c['raised'] : null );
			$goal   = DLOS_Format::money( isset( $c['goal'] ) ? $c['goal'] : null );
			if ( null !== $pct ) {
				/* translators: %d: percent of the goal reached */
				$label = sprintf( __( '%d%% of the goal reached', 'dlang-os-connect' ), $pct );
				$html .= '<div class="dlos-progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' . esc_attr( (string) $pct ) . '" aria-label="' . esc_attr( $label ) . '"><span class="dlos-progress__bar" style="width:' . esc_attr( (string) $pct ) . '%"></span></div>';
			}
			if ( '' !== $raised && '' !== $goal ) {
				/* translators: 1: amount raised, 2: goal */
				$html .= '<p class="dlos-card__line">' . esc_html( sprintf( __( '%1$s raised of %2$s', 'dlang-os-connect' ), $raised, $goal ) ) . '</p>';
			}
			$html .= '<p class="dlos-card__actions">' . self::cta( isset( $c['url'] ) ? $c['url'] : '', __( 'Donate', 'dlang-os-connect' ), $ctx, 'donate', array( 'campaign' => DLOS_Format::str( $c, 'slug' ) ) ) . '</p>';
			$html .= '</li>';
		}
		$html .= '</ul>';
		return self::wrap( 'donate', $html, $env['club'], $ctx );
	}

	/**
	 * News list.
	 *
	 * @param array $env   Envelope.
	 * @param array $attrs Attributes.
	 * @param array $ctx   Context.
	 * @return string
	 */
	public static function news( array $env, array $attrs, array $ctx ) {
		$items = self::limit( $env['data'], isset( $attrs['limit'] ) ? $attrs['limit'] : 0 );
		if ( empty( $items ) ) {
			return self::wrap( 'news', self::empty_state( __( 'No news yet.', 'dlang-os-connect' ) ), $env['club'], $ctx );
		}
		$html = '<ul class="dlos-news" role="list">';
		foreach ( $items as $n ) {
			$url   = DLOS_Format::url( isset( $n['url'] ) ? $n['url'] : '' );
			$title = esc_html( DLOS_Format::str( $n, 'title' ) );
			$html .= '<li class="dlos-news__item"><h3 class="dlos-news__title">';
			$html .= '' !== $url ? '<a href="' . esc_url( $url ) . '" target="_blank" rel="noopener">' . $title . self::new_tab_hint() . '</a>' : $title;
			$html .= '</h3>';
			$iso   = DLOS_Format::iso( $n, 'published_at' );
			if ( '' !== $iso ) {
				$html .= '<p class="dlos-meta"><time datetime="' . esc_attr( $iso ) . '">' . esc_html( DLOS_Format::date( $n, 'published_at', false ) ) . '</time></p>';
			}
			$excerpt = DLOS_Format::plain( DLOS_Format::str( $n, 'excerpt' ), 300 );
			if ( '' !== $excerpt ) {
				$html .= '<p class="dlos-news__excerpt">' . esc_html( $excerpt ) . '</p>';
			}
			$html .= '</li>';
		}
		$html .= '</ul>';
		return self::wrap( 'news', $html, $env['club'], $ctx );
	}

	/**
	 * Login / account button.
	 *
	 * @param string $url   Login URL.
	 * @param array  $attrs Attributes (label).
	 * @param array  $club  Club (for theme).
	 * @param array  $ctx   Context.
	 * @return string
	 */
	public static function login( $url, array $attrs, array $club, array $ctx ) {
		$url = DLOS_Format::url( $url );
		if ( '' === $url ) {
			return '';
		}
		$label         = isset( $attrs['label'] ) && '' !== trim( (string) $attrs['label'] ) ? (string) $attrs['label'] : __( 'My account', 'dlang-os-connect' );
		$html          = '<a class="dlos-btn dlos-btn--primary dlos-btn--login" href="' . esc_url( $url ) . '">' . esc_html( $label ) . '</a>';
		$ctx['jsonld'] = false;
		return self::wrap( 'login', $html, $club, $ctx );
	}

	/**
	 * Generic embed via the app's /embed.js helper.
	 *
	 * @param array $attrs Attributes (widget + params).
	 * @param array $ctx   Context.
	 * @return string
	 */
	public static function embed( array $attrs, array $ctx ) {
		$widget = isset( $attrs['widget'] ) ? trim( preg_replace( '#[^a-z0-9/_-]#', '', strtolower( (string) $attrs['widget'] ) ), '/' ) : '';
		$base   = preg_replace( '#/.*$#', '', $widget );
		$known  = array( 'camps', 'programs', 'schedule', 'results', 'teams', 'book', 'shop', 'donate', 'register', 'login' );
		if ( '' === $widget || ! in_array( $base, $known, true ) || '' === $ctx['app_url'] ) {
			return '';
		}
		$data = array(
			'widget' => $widget,
			'club'   => $ctx['club_slug'],
			'lang'   => $ctx['lang'],
			'theme'  => $ctx['theme'],
		);
		foreach ( array( 'season', 'year', 'team', 'type', 'kind', 'category', 'campaign', 'program' ) as $k ) {
			if ( isset( $attrs[ $k ] ) && '' !== (string) $attrs[ $k ] ) {
				$data[ $k ] = preg_replace( '/[^A-Za-z0-9_,.-]/', '', (string) $attrs[ $k ] );
			}
		}
		$html = '<div class="dlos-embed"';
		foreach ( $data as $k => $v ) {
			if ( '' !== $v ) {
				$html .= ' data-' . ( 'widget' === $k ? 'dlang-widget' : esc_attr( $k ) ) . '="' . esc_attr( $v ) . '"';
			}
		}
		$min   = isset( $attrs['height'] ) ? max( 0, min( 3000, (int) $attrs['height'] ) ) : 0;
		$html .= $min > 0 ? ' style="min-height:' . esc_attr( (string) $min ) . 'px"' : '';
		$html .= '></div>';

		$fallback      = self::embed_url( $widget, array_diff_key( $data, array_flip( array( 'widget', 'club', 'lang', 'theme' ) ) ), $ctx );
		$html         .= '<noscript><a class="dlos-link" href="' . esc_url( $fallback ) . '" target="_blank" rel="noopener">' . esc_html__( 'Open on the club app', 'dlang-os-connect' ) . '</a></noscript>';
		$ctx['jsonld'] = false;
		return self::wrap( 'embed', $html, array(), $ctx );
	}

	/**
	 * JSON-LD script unless disabled for this widget (schema="0").
	 *
	 * @param array $attrs Attributes.
	 * @param array $nodes Nodes.
	 * @return string
	 */
	public static function schema( array $attrs, array $nodes ) {
		if ( isset( $attrs['schema'] ) && in_array( strtolower( (string) $attrs['schema'] ), array( '0', 'false', 'no', 'off' ), true ) ) {
			return '';
		}
		return DLOS_JsonLd::script( $nodes );
	}
}
