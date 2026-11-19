<?php
/**
 * Tools > Move to DLang OS: read-only report, redirect map builder, WooCommerce checkout checklist.
 *
 * @package DLangOSConnect
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Migration helper page.
 */
class DLOS_Admin_Migration {

	const SLUG      = 'dlang-os-move';
	const MAX_ITEMS = 3000;

	/**
	 * Hooks.
	 */
	public static function init() {
		add_action( 'admin_menu', array( __CLASS__, 'menu' ) );
		add_action( 'admin_post_dlos_build_redirects', array( __CLASS__, 'handle_build' ) );
		add_action( 'admin_post_dlos_clear_redirects', array( __CLASS__, 'handle_clear' ) );
	}

	/**
	 * Menu entry.
	 */
	public static function menu() {
		add_management_page( __( 'Move to DLang OS', 'dlang-os-connect' ), __( 'Move to DLang OS', 'dlang-os-connect' ), 'manage_options', self::SLUG, array( __CLASS__, 'render' ) );
	}

	/**
	 * Count published posts of a type (0 when the type does not exist).
	 *
	 * @param string $type Post type.
	 * @return int|null Null when the post type is not registered.
	 */
	public static function count( $type ) {
		if ( ! post_type_exists( $type ) ) {
			return null;
		}
		$c = wp_count_posts( $type );
		return (int) ( isset( $c->publish ) ? $c->publish : 0 ) + (int) ( isset( $c->future ) ? $c->future : 0 );
	}

	/**
	 * Old WordPress items for the redirect map.
	 *
	 * @return array
	 */
	public static function collect_wp_items() {
		$kinds = array(
			'sp_event' => 'event',
			'sp_team'  => 'team',
			'product'  => 'product',
		);
		$home  = (string) wp_parse_url( home_url( '/' ), PHP_URL_PATH );
		$items = array();
		foreach ( $kinds as $type => $kind ) {
			if ( ! post_type_exists( $type ) ) {
				continue;
			}
			$ids = get_posts(
				array(
					'post_type'        => $type,
					'post_status'      => array( 'publish', 'future' ),
					'posts_per_page'   => self::MAX_ITEMS,
					'fields'           => 'ids',
					'no_found_rows'    => true,
					'suppress_filters' => true, // All languages (WPML/Polylang).
				)
			);
			foreach ( $ids as $id ) {
				$items[] = array(
					'kind'      => $kind,
					'path'      => (string) get_permalink( $id ),
					'home_path' => $home,
					'slug'      => (string) get_post_field( 'post_name', $id ),
					'name'      => html_entity_decode( (string) get_the_title( $id ), ENT_QUOTES, 'UTF-8' ),
					'date'      => (string) get_post_field( 'post_date', $id ),
				);
			}
		}
		return $items;
	}

	/**
	 * Earliest SportsPress event date (Y-m-d) or ''.
	 *
	 * @param array $items WordPress items.
	 * @return string
	 */
	private static function earliest_event( array $items ) {
		$min = '';
		foreach ( $items as $i ) {
			$d = substr( (string) $i['date'], 0, 10 );
			if ( 'event' === $i['kind'] && '' !== $d && ( '' === $min || $d < $min ) ) {
				$min = $d;
			}
		}
		return $min;
	}

	/**
	 * Build and store the redirect map.
	 */
	public static function handle_build() {
		if ( ! current_user_can( 'manage_options' ) ) {
			wp_die( esc_html__( 'You are not allowed to do this.', 'dlang-os-connect' ), 403 );
		}
		check_admin_referer( 'dlos_build_redirects' );

		$wp_items = self::collect_wp_items();
		$lang     = DLOS_Language::current();
		$app      = array(
			'event'   => array(),
			'team'    => array(),
			'product' => array(),
		);
		$errors   = array();

		$from = self::earliest_event( $wp_items );
		$res  = DLOS_Api::get( 'results', array(), $lang );
		if ( $res['ok'] ) {
			$app['event'] = $res['envelope']['data'];
		} else {
			$errors[] = 'results: ' . $res['error'];
		}
		$ev = DLOS_Api::get(
			'events',
			array(
				'from' => '' !== $from ? $from : wp_date( 'Y-m-d' ),
				'to'   => wp_date( 'Y-m-d', time() + 365 * DAY_IN_SECONDS ),
			),
			$lang
		);
		if ( $ev['ok'] ) {
			$app['event'] = array_merge( $app['event'], $ev['envelope']['data'] );
		} else {
			$errors[] = 'events: ' . $ev['error'];
		}
		foreach ( array(
			'teams' => 'team',
			'shop'  => 'product',
		) as $endpoint => $kind ) {
			$r = DLOS_Api::get( $endpoint, array(), $lang );
			if ( $r['ok'] ) {
				$app[ $kind ] = $r['envelope']['data'];
			} else {
				$errors[] = $endpoint . ': ' . $r['error'];
			}
		}

		$built = DLOS_Redirects::build_map( $wp_items, $app );
		update_option( DLOS_Redirects::OPTION, $built['map'], false );
		set_transient(
			'dlos_move_' . get_current_user_id(),
			array(
				'mapped'    => count( $built['map'] ),
				'unmatched' => array_slice( $built['unmatched'], 0, 200 ),
				'errors'    => $errors,
			),
			600
		);
		wp_safe_redirect( admin_url( 'tools.php?page=' . self::SLUG . '&dlos_built=1' ) );
		exit;
	}

	/**
	 * Remove the redirect map.
	 */
	public static function handle_clear() {
		if ( ! current_user_can( 'manage_options' ) ) {
			wp_die( esc_html__( 'You are not allowed to do this.', 'dlang-os-connect' ), 403 );
		}
		check_admin_referer( 'dlos_clear_redirects' );
		update_option( DLOS_Redirects::OPTION, array(), false );
		wp_safe_redirect( admin_url( 'tools.php?page=' . self::SLUG ) );
		exit;
	}

	/**
	 * Page.
	 */
	public static function render() {
		if ( ! current_user_can( 'manage_options' ) ) {
			return;
		}
		$sp_active = post_type_exists( 'sp_event' );
		$wc_active = class_exists( 'WooCommerce' );
		$map       = get_option( DLOS_Redirects::OPTION, array() );
		$map       = is_array( $map ) ? $map : array();
		$importer  = DLOS_Api::app_page( 'admin/import' );
		?>
		<div class="wrap">
			<h1><?php esc_html_e( 'Move to DLang OS', 'dlang-os-connect' ); ?></h1>
			<p><?php esc_html_e( 'This page only reads your site. Nothing is deleted or changed in SportsPress or WooCommerce.', 'dlang-os-connect' ); ?></p>
			<?php self::render_build_notice(); ?>

			<h2><?php esc_html_e( '1. What this site has today', 'dlang-os-connect' ); ?></h2>
			<table class="widefat striped" style="max-width:720px">
				<thead><tr><th><?php esc_html_e( 'Content', 'dlang-os-connect' ); ?></th><th><?php esc_html_e( 'Count', 'dlang-os-connect' ); ?></th><th><?php esc_html_e( 'In the app', 'dlang-os-connect' ); ?></th></tr></thead>
				<tbody>
				<?php
				$rows = array(
					array( __( 'SportsPress events (games)', 'dlang-os-connect' ), self::count( 'sp_event' ), __( 'Schedule and results', 'dlang-os-connect' ) ),
					array( __( 'SportsPress teams', 'dlang-os-connect' ), self::count( 'sp_team' ), __( 'Teams', 'dlang-os-connect' ) ),
					array( __( 'SportsPress players', 'dlang-os-connect' ), self::count( 'sp_player' ), __( 'Athletes (import from your member list, not from public pages)', 'dlang-os-connect' ) ),
					array( __( 'SportsPress staff', 'dlang-os-connect' ), self::count( 'sp_staff' ), __( 'Coaches', 'dlang-os-connect' ) ),
					array( __( 'SportsPress league tables and calendars', 'dlang-os-connect' ), self::sum( array( self::count( 'sp_table' ), self::count( 'sp_calendar' ), self::count( 'sp_list' ) ) ), __( 'Generated from the schedule', 'dlang-os-connect' ) ),
					array( __( 'WooCommerce products', 'dlang-os-connect' ), self::count( 'product' ), __( 'Shop', 'dlang-os-connect' ) ),
					array( __( 'WooCommerce orders', 'dlang-os-connect' ), self::order_count(), __( 'Stay in WooCommerce for your records', 'dlang-os-connect' ) ),
				);
				foreach ( $rows as $r ) {
					echo '<tr><td>' . esc_html( $r[0] ) . '</td><td>' . ( null === $r[1] ? '<span aria-label="' . esc_attr__( 'not installed', 'dlang-os-connect' ) . '">–</span>' : esc_html( number_format_i18n( $r[1] ) ) ) . '</td><td>' . esc_html( $r[2] ) . '</td></tr>';
				}
				?>
				</tbody>
			</table>
			<?php if ( ! $sp_active && ! $wc_active ) : ?>
				<p><?php esc_html_e( 'Neither SportsPress nor WooCommerce is active, so there is nothing to move.', 'dlang-os-connect' ); ?></p>
			<?php endif; ?>
			<?php if ( '' !== $importer ) : ?>
				<p><a class="button button-primary" href="<?php echo esc_url( $importer ); ?>" target="_blank" rel="noopener"><?php esc_html_e( 'Open the importer in the app', 'dlang-os-connect' ); ?></a>
				<span class="description"><?php esc_html_e( 'Import teams, schedule and products in the app (CSV export from SportsPress / WooCommerce). Player data of children is imported from your member list with consent, never scraped from the website.', 'dlang-os-connect' ); ?></span></p>
			<?php endif; ?>

			<h2><?php esc_html_e( '2. Redirect old pages to the app', 'dlang-os-connect' ); ?></h2>
			<p><?php esc_html_e( 'Matches your old event, team and product pages to the same items in the app (by slug, name, or date and opponent) so links from Google and social media keep working.', 'dlang-os-connect' ); ?></p>
			<p>
				<?php
				/* translators: %d: number of redirects */
				echo esc_html( sprintf( _n( '%d redirect saved.', '%d redirects saved.', count( $map ), 'dlang-os-connect' ), count( $map ) ) ) . ' ';
				echo DLOS_Settings::get( 'redirects_on' ) ? esc_html__( 'Redirects are ON.', 'dlang-os-connect' ) : esc_html__( 'Redirects are OFF (switch them on in Settings > DLang OS once the list looks right).', 'dlang-os-connect' );
				?>
			</p>
			<div style="display:flex;gap:8px">
				<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>">
					<input type="hidden" name="action" value="dlos_build_redirects">
					<?php wp_nonce_field( 'dlos_build_redirects' ); ?>
					<?php submit_button( __( 'Build the redirect list', 'dlang-os-connect' ), 'secondary', 'submit', false ); ?>
				</form>
				<?php if ( $map ) : ?>
				<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>">
					<input type="hidden" name="action" value="dlos_clear_redirects">
					<?php wp_nonce_field( 'dlos_clear_redirects' ); ?>
					<?php submit_button( __( 'Delete the redirect list', 'dlang-os-connect' ), 'delete', 'submit', false ); ?>
				</form>
				<?php endif; ?>
			</div>
			<?php if ( $map ) : ?>
				<table class="widefat striped" style="margin-top:12px">
					<thead><tr><th><?php esc_html_e( 'Old page', 'dlang-os-connect' ); ?></th><th><?php esc_html_e( 'New page in the app', 'dlang-os-connect' ); ?></th></tr></thead>
					<tbody>
					<?php
					foreach ( array_slice( $map, 0, 200, true ) as $from => $to ) {
						echo '<tr><td><code>/' . esc_html( $from ) . '</code></td><td><a href="' . esc_url( $to ) . '" target="_blank" rel="noopener">' . esc_html( $to ) . '</a></td></tr>';
					}
					?>
					</tbody>
				</table>
				<?php if ( count( $map ) > 200 ) : ?>
					<p class="description"><?php esc_html_e( 'Showing the first 200.', 'dlang-os-connect' ); ?></p>
				<?php endif; ?>
			<?php endif; ?>

			<h2><?php esc_html_e( '3. Switch off WooCommerce checkout once the shop runs in the app', 'dlang-os-connect' ); ?></h2>
			<?php self::render_checklist( $map ); ?>
		</div>
		<?php
	}

	/**
	 * Sum of counts ignoring missing types.
	 *
	 * @param array $counts Counts (null = missing).
	 * @return int|null
	 */
	private static function sum( array $counts ) {
		$present = array_filter(
			$counts,
			function ( $c ) {
				return null !== $c;
			}
		);
		return $present ? array_sum( $present ) : null;
	}

	/**
	 * WooCommerce order count (HPOS-compatible), null when WooCommerce is not active.
	 *
	 * @return int|null
	 */
	private static function order_count() {
		if ( ! function_exists( 'wc_get_orders' ) ) {
			return null;
		}
		$res = wc_get_orders(
			array(
				'limit'    => 1,
				'paginate' => true,
				'return'   => 'ids',
			)
		);
		return is_object( $res ) && isset( $res->total ) ? (int) $res->total : null;
	}

	/**
	 * Result of the last build.
	 */
	private static function render_build_notice() {
		// phpcs:ignore WordPress.Security.NonceVerification.Recommended -- display only.
		if ( ! isset( $_GET['dlos_built'] ) ) {
			return;
		}
		$key = 'dlos_move_' . get_current_user_id();
		$r   = get_transient( $key );
		delete_transient( $key );
		if ( ! is_array( $r ) ) {
			return;
		}
		/* translators: 1: matched pages, 2: unmatched pages */
		echo '<div class="notice notice-info"><p>' . esc_html( sprintf( __( '%1$d old pages matched, %2$d without a match (they keep working as before).', 'dlang-os-connect' ), $r['mapped'], count( $r['unmatched'] ) ) ) . '</p>';
		if ( $r['errors'] ) {
			echo '<p>' . esc_html__( 'Some app data could not be loaded:', 'dlang-os-connect' ) . ' <code>' . esc_html( implode( ', ', $r['errors'] ) ) . '</code></p>';
		}
		if ( $r['unmatched'] ) {
			echo '<details><summary>' . esc_html__( 'Pages without a match', 'dlang-os-connect' ) . '</summary><ul>';
			foreach ( $r['unmatched'] as $p ) {
				echo '<li><code>/' . esc_html( $p ) . '</code></li>';
			}
			echo '</ul></details>';
		}
		echo '</div>';
	}

	/**
	 * Checklist with the few checks we can detect.
	 *
	 * @param array $map Redirect map.
	 */
	private static function render_checklist( array $map ) {
		$product_redirects = 0;
		if ( post_type_exists( 'product' ) ) {
			$base = trim( (string) wp_parse_url( (string) get_post_type_archive_link( 'product' ), PHP_URL_PATH ), '/' );
			foreach ( array_keys( $map ) as $from ) {
				if ( '' !== $base && 0 === strpos( $from, $base ) ) {
					++$product_redirects;
				}
			}
		}
		$shop_page   = function_exists( 'wc_get_page_id' ) ? (int) wc_get_page_id( 'shop' ) : 0;
		$shop_has_sc = $shop_page > 0 && false !== strpos( (string) get_post_field( 'post_content', $shop_page ), 'dlang_shop' );
		$gateways    = self::enabled_gateways();

		$steps = array(
			array( __( 'All products, sizes, prices and stock are set up in the app shop, and a test purchase (card and TWINT) worked.', 'dlang-os-connect' ), null ),
			array( __( 'A page on this site shows the app shop with [dlang_shop] or the "DLang OS shop" block.', 'dlang-os-connect' ), $shop_has_sc ? true : null ),
			array( __( 'Old product pages redirect to the app (build the list above, then switch redirects on).', 'dlang-os-connect' ), $product_redirects > 0 && DLOS_Settings::get( 'redirects_on' ) ),
			array( __( 'Open WooCommerce orders are fulfilled or refunded in WooCommerce.', 'dlang-os-connect' ), null ),
			array( __( 'Order history is exported (WooCommerce > Analytics > Download) and archived for your accounting retention period.', 'dlang-os-connect' ), null ),
			array( __( 'WooCommerce payment methods are disabled (WooCommerce > Settings > Payments).', 'dlang-os-connect' ), null === $gateways ? null : 0 === $gateways ),
			array( __( 'The store is hidden: WooCommerce > Settings > Site visibility > "Coming soon" for store pages, or the shop page is replaced.', 'dlang-os-connect' ), null ),
			array( __( 'Privacy policy and terms name the app as the place where purchases and payments happen.', 'dlang-os-connect' ), null ),
			array( __( 'After the retention export: keep WooCommerce deactivated or remove it.', 'dlang-os-connect' ), null ),
		);
		echo '<ol>';
		foreach ( $steps as $step ) {
			$state = '';
			if ( true === $step[1] ) {
				$state = ' <strong style="color:#008a20">' . esc_html__( 'Done', 'dlang-os-connect' ) . '</strong>';
			} elseif ( false === $step[1] ) {
				$state = ' <strong style="color:#b32d2e">' . esc_html__( 'Not yet', 'dlang-os-connect' ) . '</strong>';
			}
			echo '<li>' . esc_html( $step[0] ) . $state . '</li>'; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- $state is built from escaped parts.
		}
		echo '</ol>';
	}

	/**
	 * Number of enabled WooCommerce payment gateways (null if unknown).
	 *
	 * @return int|null
	 */
	private static function enabled_gateways() {
		if ( ! function_exists( 'WC' ) ) {
			return null;
		}
		$wc = WC();
		if ( ! is_object( $wc ) || ! method_exists( $wc, 'payment_gateways' ) ) {
			return null;
		}
		$gw = $wc->payment_gateways();
		if ( ! is_object( $gw ) || ! method_exists( $gw, 'payment_gateways' ) ) {
			return null;
		}
		$n = 0;
		foreach ( (array) $gw->payment_gateways() as $g ) {
			if ( is_object( $g ) && isset( $g->enabled ) && 'yes' === $g->enabled ) {
				++$n;
			}
		}
		return $n;
	}
}
