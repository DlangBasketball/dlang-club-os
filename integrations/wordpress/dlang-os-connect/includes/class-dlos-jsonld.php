<?php
/**
 * schema.org JSON-LD for games, camps and shop items.
 *
 * @package DLangOSConnect
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Builds JSON-LD graphs.
 */
class DLOS_JsonLd {

	/**
	 * <script type="application/ld+json"> for a list of nodes ('' when empty).
	 *
	 * @param array $nodes Nodes.
	 * @return string
	 */
	public static function script( array $nodes ) {
		$nodes = array_values( array_filter( $nodes ) );
		if ( empty( $nodes ) ) {
			return '';
		}
		$doc = array(
			'@context' => 'https://schema.org',
			'@graph'   => $nodes,
		);
		// JSON_HEX_* make "</script>" and quotes inert inside the script element.
		$json = wp_json_encode( $doc, JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE );
		if ( ! is_string( $json ) ) {
			return '';
		}
		return '<script type="application/ld+json">' . $json . '</script>';
	}

	/**
	 * Organizer node for the club.
	 *
	 * @param array $club Club.
	 * @return array
	 */
	public static function organizer( array $club ) {
		$node = array(
			'@type' => 'SportsOrganization',
			'name'  => DLOS_Format::str( $club, 'name' ),
		);
		$url  = DLOS_Format::url( isset( $club['app_url'] ) ? $club['app_url'] : '' );
		if ( '' !== $url ) {
			$node['url'] = $url;
		}
		return $node;
	}

	/**
	 * Place node from a venue (string or {name,address}).
	 *
	 * @param mixed $venue Venue.
	 * @return array|null
	 */
	public static function place( $venue ) {
		if ( is_string( $venue ) && '' !== trim( $venue ) ) {
			return array(
				'@type' => 'Place',
				'name'  => trim( $venue ),
			);
		}
		if ( is_array( $venue ) ) {
			$name = DLOS_Format::str( $venue, 'name' );
			$addr = DLOS_Format::str( $venue, 'address' );
			if ( '' === $name && '' === $addr ) {
				return null;
			}
			$node = array(
				'@type' => 'Place',
				'name'  => '' !== $name ? $name : $addr,
			);
			if ( '' !== $addr ) {
				$node['address'] = $addr;
			}
			return $node;
		}
		return null;
	}

	/**
	 * SportsEvent for a game/event item.
	 *
	 * @param array $event Event item.
	 * @param array $club  Club.
	 * @return array|null
	 */
	public static function event( array $event, array $club ) {
		$start = DLOS_Format::iso( $event, 'starts_at' );
		$title = DLOS_Format::str( $event, 'title' );
		if ( '' === $start || '' === $title ) {
			return null;
		}
		$node = array(
			'@type'               => 'SportsEvent',
			'name'                => $title,
			'startDate'           => $start,
			'eventAttendanceMode' => 'https://schema.org/OfflineEventAttendanceMode',
			'eventStatus'         => self::status( DLOS_Format::str( $event, 'status' ) ),
			'organizer'           => self::organizer( $club ),
		);
		$end  = DLOS_Format::iso( $event, 'ends_at' );
		if ( '' !== $end ) {
			$node['endDate'] = $end;
		}
		$place = self::place( isset( $event['venue'] ) ? $event['venue'] : null );
		if ( $place ) {
			$node['location'] = $place;
		}
		$url = DLOS_Format::url( isset( $event['url'] ) ? $event['url'] : '' );
		if ( '' !== $url ) {
			$node['url'] = $url;
		}
		$team     = DLOS_Format::str( DLOS_Format::arr( $event, 'team' ), 'name' );
		$opponent = DLOS_Format::str( $event, 'opponent' );
		if ( 'game' === DLOS_Format::str( $event, 'type' ) && '' !== $team && '' !== $opponent ) {
			$ours             = array(
				'@type' => 'SportsTeam',
				'name'  => $team,
			);
			$theirs           = array(
				'@type' => 'SportsTeam',
				'name'  => $opponent,
			);
			$away             = 'away' === DLOS_Format::str( $event, 'home_away' );
			$node['homeTeam'] = $away ? $theirs : $ours;
			$node['awayTeam'] = $away ? $ours : $theirs;
		}
		return $node;
	}

	/**
	 * SportsEvent for a camp edition.
	 *
	 * @param array $edition Edition.
	 * @param array $group   Season group.
	 * @param array $club    Club.
	 * @return array|null
	 */
	public static function camp( array $edition, array $group, array $club ) {
		$name = DLOS_Format::str( $edition, 'name' );
		if ( '' === $name ) {
			return null;
		}
		$dates = isset( $edition['dates'] ) && is_array( $edition['dates'] ) ? $edition['dates'] : array();
		$start = DLOS_Format::iso( $dates, 'start' );
		if ( '' === $start ) {
			$start = DLOS_Format::iso( $dates, 'starts_on' );
		}
		if ( '' === $start ) {
			$start = DLOS_Format::iso( $edition, 'starts_on' );
		}
		if ( '' === $start ) {
			return null; // startDate is required for an Event.
		}
		$end = DLOS_Format::iso( $dates, 'end' );
		if ( '' === $end ) {
			$end = '' !== DLOS_Format::iso( $dates, 'ends_on' ) ? DLOS_Format::iso( $dates, 'ends_on' ) : DLOS_Format::iso( $edition, 'ends_on' );
		}
		$node = array(
			'@type'               => 'SportsEvent',
			'name'                => $name,
			'startDate'           => $start,
			'eventAttendanceMode' => 'https://schema.org/OfflineEventAttendanceMode',
			'eventStatus'         => 'https://schema.org/EventScheduled',
			'organizer'           => self::organizer( $club ),
		);
		if ( '' !== $end ) {
			$node['endDate'] = $end;
		}
		$place = self::place( isset( $edition['venue'] ) ? $edition['venue'] : null );
		if ( $place ) {
			$node['location'] = $place;
		}
		$url = DLOS_Format::url( isset( $edition['action_url'] ) ? $edition['action_url'] : ( isset( $group['url'] ) ? $group['url'] : '' ) );
		if ( '' !== $url ) {
			$node['url'] = $url;
		}
		$offers = array();
		foreach ( DLOS_Format::arr( $edition, 'price_options' ) as $opt ) {
			if ( ! is_array( $opt ) ) {
				continue;
			}
			list( $amount, $currency ) = DLOS_Format::money_parts( isset( $opt['price'] ) ? $opt['price'] : null );
			if ( null === $amount ) {
				continue;
			}
			$offer = array(
				'@type'         => 'Offer',
				'price'         => $amount,
				'priceCurrency' => '' !== $currency ? $currency : DLOS_Format::str( $club, 'currency' ),
				'availability'  => self::availability( $edition ),
			);
			if ( '' !== $url ) {
				$offer['url'] = $url;
			}
			$offers[] = $offer;
		}
		if ( ! empty( $offers ) ) {
			$node['offers'] = $offers;
		}
		return $node;
	}

	/**
	 * Product for a shop item.
	 *
	 * @param array $item Shop item.
	 * @param array $club Club.
	 * @return array|null
	 */
	public static function product( array $item, array $club ) {
		$name = DLOS_Format::str( $item, 'name' );
		if ( '' === $name ) {
			return null;
		}
		$node = array(
			'@type' => 'Product',
			'name'  => $name,
			'brand' => array(
				'@type' => 'Brand',
				'name'  => DLOS_Format::str( $club, 'name' ),
			),
		);
		$desc = DLOS_Format::plain( DLOS_Format::str( $item, 'description' ), 500 );
		if ( '' !== $desc ) {
			$node['description'] = $desc;
		}
		$images = array();
		foreach ( DLOS_Format::arr( $item, 'images' ) as $img ) {
			$u = DLOS_Format::url( is_array( $img ) ? ( isset( $img['url'] ) ? $img['url'] : '' ) : $img );
			if ( '' !== $u ) {
				$images[] = $u;
			}
		}
		if ( $images ) {
			$node['image'] = $images;
		}
		$url = DLOS_Format::url( isset( $item['url'] ) ? $item['url'] : '' );
		if ( '' !== $url ) {
			$node['url'] = $url;
		}
		list( $amount, $currency ) = DLOS_Format::money_parts( isset( $item['price'] ) ? $item['price'] : null );
		if ( null !== $amount ) {
			$node['offers'] = array(
				'@type'         => 'Offer',
				'price'         => $amount,
				'priceCurrency' => '' !== $currency ? $currency : DLOS_Format::str( $club, 'currency' ),
				'availability'  => ( isset( $item['in_stock'] ) && false === $item['in_stock'] ) ? 'https://schema.org/OutOfStock' : 'https://schema.org/InStock',
			);
			$buy            = DLOS_Format::url( isset( $item['action_url'] ) ? $item['action_url'] : '' );
			if ( '' !== $buy || '' !== $url ) {
				$node['offers']['url'] = '' !== $buy ? $buy : $url;
			}
		}
		return $node;
	}

	/**
	 * schema.org event status.
	 *
	 * @param string $status API status.
	 * @return string
	 */
	public static function status( $status ) {
		switch ( $status ) {
			case 'cancelled':
				return 'https://schema.org/EventCancelled';
			case 'moved':
				return 'https://schema.org/EventRescheduled';
			default:
				return 'https://schema.org/EventScheduled';
		}
	}

	/**
	 * Availability from places_left/status.
	 *
	 * @param array $item Item.
	 * @return string
	 */
	public static function availability( array $item ) {
		$status = DLOS_Format::str( $item, 'status' );
		if ( 'full' === $status || 'closed' === $status || ( isset( $item['places_left'] ) && is_numeric( $item['places_left'] ) && (int) $item['places_left'] <= 0 ) ) {
			return 'https://schema.org/SoldOut';
		}
		if ( 'waitlist' === $status ) {
			return 'https://schema.org/LimitedAvailability';
		}
		return 'https://schema.org/InStock';
	}
}
