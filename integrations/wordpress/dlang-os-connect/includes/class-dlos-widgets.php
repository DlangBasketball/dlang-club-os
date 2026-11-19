<?php
/**
 * Widget registry: shortcodes and server-rendered blocks share one definition and one render path.
 *
 * @package DLangOSConnect
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Shortcodes + blocks.
 */
class DLOS_Widgets {

	/** Whether the front-end script must be printed. */
	private static $needs_front_js = false;

	/**
	 * Widget definitions: endpoint and attributes (name => default).
	 *
	 * @return array
	 */
	public static function definitions() {
		$common = array(
			'lang'  => '',
			'theme' => '',
		);
		return array(
			'camps'    => array(
				'endpoint' => 'camps',
				'atts'     => $common + array(
					'season' => '',
					'year'   => '',
					'schema' => '1',
				),
			),
			'programs' => array(
				'endpoint' => 'programs',
				'atts'     => $common + array(
					'kind'   => '',
					'season' => '',
					'limit'  => '',
				),
			),
			'schedule' => array(
				'endpoint' => 'events',
				'atts'     => $common + array(
					'team'   => '',
					'type'   => '',
					'days'   => '60',
					'limit'  => '',
					'schema' => '1',
				),
			),
			'results'  => array(
				'endpoint' => 'results',
				'atts'     => $common + array(
					'team'   => '',
					'season' => '',
					'limit'  => '',
					'schema' => '1',
				),
			),
			'teams'    => array(
				'endpoint' => 'teams',
				'atts'     => $common,
			),
			'team'     => array(
				'endpoint' => 'teams',
				'atts'     => $common + array(
					'slug'          => '',
					'show_roster'   => '0',
					'show_schedule' => '1',
					'show_results'  => '1',
					'limit'         => '5',
					'schema'        => '1',
				),
			),
			'coaches'  => array(
				'endpoint' => 'coaches',
				'atts'     => $common,
			),
			'training' => array(
				'endpoint' => 'training',
				'atts'     => $common,
			),
			'shop'     => array(
				'endpoint' => 'shop',
				'atts'     => $common + array(
					'category' => '',
					'limit'    => '',
					'schema'   => '1',
				),
			),
			'donate'   => array(
				'endpoint' => 'campaigns',
				'atts'     => $common + array( 'campaign' => '' ),
			),
			'news'     => array(
				'endpoint' => 'news',
				'atts'     => $common + array( 'limit' => '5' ),
			),
			'login'    => array(
				'endpoint' => '',
				'atts'     => $common + array( 'label' => '' ),
			),
			'embed'    => array(
				'endpoint' => '',
				'atts'     => $common + array(
					'widget'   => 'camps',
					'season'   => '',
					'year'     => '',
					'team'     => '',
					'type'     => '',
					'kind'     => '',
					'category' => '',
					'campaign' => '',
					'program'  => '',
					'height'   => '',
				),
			),
		);
	}

	/**
	 * Hooks.
	 */
	public static function init() {
		foreach ( array_keys( self::definitions() ) as $name ) {
			add_shortcode(
				'dlang_' . $name,
				function ( $atts ) use ( $name ) {
					return DLOS_Widgets::render( $name, is_array( $atts ) ? $atts : array() );
				}
			);
		}
		add_action( 'init', array( __CLASS__, 'register_assets_and_blocks' ) );
		add_action( 'wp_enqueue_scripts', array( __CLASS__, 'maybe_enqueue' ) );
		add_action( 'wp_footer', array( __CLASS__, 'print_front_js' ), 5 );
		add_filter( 'block_categories_all', array( __CLASS__, 'block_category' ) );
	}

	/**
	 * "DLang OS" block inserter category.
	 *
	 * @param array $categories Categories.
	 * @return array
	 */
	public static function block_category( $categories ) {
		$categories[] = array(
			'slug'  => 'dlang-os',
			'title' => __( 'DLang OS', 'dlang-os-connect' ),
			'icon'  => null,
		);
		return $categories;
	}

	/**
	 * Register styles, scripts and blocks.
	 */
	public static function register_assets_and_blocks() {
		wp_register_style( 'dlos-front', DLOS_URL . 'assets/css/dlang-os.css', array(), DLOS_VERSION );
		wp_register_script(
			'dlos-front',
			DLOS_URL . 'assets/js/front.js',
			array(),
			DLOS_VERSION,
			array(
				'in_footer' => true,
				'strategy'  => 'defer',
			)
		);
		wp_register_script(
			'dlos-blocks-editor',
			DLOS_URL . 'assets/js/blocks.js',
			array( 'wp-blocks', 'wp-element', 'wp-components', 'wp-block-editor', 'wp-server-side-render', 'wp-i18n' ),
			DLOS_VERSION,
			true
		);
		wp_add_inline_script( 'dlos-blocks-editor', 'window.dlosBlocks = ' . wp_json_encode( self::editor_config() ) . ';', 'before' );

		if ( ! function_exists( 'register_block_type' ) ) {
			return;
		}
		foreach ( array_keys( self::definitions() ) as $name ) {
			register_block_type(
				DLOS_DIR . 'blocks/' . $name,
				array(
					'render_callback' => function ( $attributes ) use ( $name ) {
						return DLOS_Widgets::render( $name, is_array( $attributes ) ? $attributes : array() );
					},
				)
			);
		}
	}

	/**
	 * Inspector controls for the editor script (labels translated here, so the editor needs no JS catalogs).
	 *
	 * @return array
	 */
	public static function editor_config() {
		$lang_opts  = array(
			array( '', __( 'Automatic', 'dlang-os-connect' ) ),
			array( 'en', 'English' ),
			array( 'fr', 'Français' ),
			array( 'de', 'Deutsch' ),
			array( 'it', 'Italiano' ),
			array( 'es', 'Español' ),
		);
		$theme_opts = array(
			array( '', __( 'Site default', 'dlang-os-connect' ) ),
			array( 'club', __( 'Club colours', 'dlang-os-connect' ) ),
			array( 'light', __( 'Light', 'dlang-os-connect' ) ),
			array( 'dark', __( 'Dark', 'dlang-os-connect' ) ),
		);
		$season     = array(
			array( '', __( 'All', 'dlang-os-connect' ) ),
			array( 'spring', __( 'Spring', 'dlang-os-connect' ) ),
			array( 'summer', __( 'Summer', 'dlang-os-connect' ) ),
			array( 'fall', __( 'Autumn', 'dlang-os-connect' ) ),
			array( 'winter', __( 'Winter', 'dlang-os-connect' ) ),
		);
		$labels     = array(
			'season'        => array( 'select', __( 'Season', 'dlang-os-connect' ), $season ),
			'year'          => array( 'text', __( 'Year', 'dlang-os-connect' ) ),
			'kind'          => array( 'text', __( 'Kind (team, camp, clinic…)', 'dlang-os-connect' ) ),
			'team'          => array( 'text', __( 'Team (slug)', 'dlang-os-connect' ) ),
			'type'          => array(
				'select',
				__( 'Type', 'dlang-os-connect' ),
				array(
					array( '', __( 'All', 'dlang-os-connect' ) ),
					array( 'game', __( 'Games', 'dlang-os-connect' ) ),
					array( 'training', __( 'Training', 'dlang-os-connect' ) ),
					array( 'event', __( 'Events', 'dlang-os-connect' ) ),
					array( 'tournament', __( 'Tournaments', 'dlang-os-connect' ) ),
				),
			),
			'days'          => array( 'number', __( 'Days ahead', 'dlang-os-connect' ) ),
			'limit'         => array( 'number', __( 'Maximum items (0 = all)', 'dlang-os-connect' ) ),
			'slug'          => array( 'text', __( 'Team (slug)', 'dlang-os-connect' ) ),
			'show_roster'   => array( 'toggle', __( 'Show public roster', 'dlang-os-connect' ) ),
			'show_schedule' => array( 'toggle', __( 'Show next games', 'dlang-os-connect' ) ),
			'show_results'  => array( 'toggle', __( 'Show latest results', 'dlang-os-connect' ) ),
			'category'      => array( 'text', __( 'Category', 'dlang-os-connect' ) ),
			'campaign'      => array( 'text', __( 'Campaign (slug, empty = all)', 'dlang-os-connect' ) ),
			'label'         => array( 'text', __( 'Button label', 'dlang-os-connect' ) ),
			'widget'        => array(
				'select',
				__( 'App widget', 'dlang-os-connect' ),
				array(
					array( 'camps', __( 'Camps', 'dlang-os-connect' ) ),
					array( 'programs', __( 'Programmes', 'dlang-os-connect' ) ),
					array( 'schedule', __( 'Schedule', 'dlang-os-connect' ) ),
					array( 'results', __( 'Results', 'dlang-os-connect' ) ),
					array( 'teams', __( 'Teams', 'dlang-os-connect' ) ),
					array( 'book', __( 'Book a training', 'dlang-os-connect' ) ),
					array( 'shop', __( 'Shop', 'dlang-os-connect' ) ),
					array( 'donate', __( 'Donate', 'dlang-os-connect' ) ),
					array( 'login', __( 'Login', 'dlang-os-connect' ) ),
				),
			),
			'program'       => array( 'text', __( 'Registration form for programme (slug)', 'dlang-os-connect' ) ),
			'height'        => array( 'number', __( 'Minimum height (px)', 'dlang-os-connect' ) ),
			'schema'        => array( 'toggle', __( 'Add structured data for search engines', 'dlang-os-connect' ) ),
			'lang'          => array( 'select', __( 'Language', 'dlang-os-connect' ), $lang_opts ),
			'theme'         => array( 'select', __( 'Look', 'dlang-os-connect' ), $theme_opts ),
		);
		$blocks     = array();
		foreach ( self::definitions() as $name => $def ) {
			$fields = array();
			foreach ( array_keys( $def['atts'] ) as $att ) {
				if ( isset( $labels[ $att ] ) ) {
					$f        = $labels[ $att ];
					$fields[] = array(
						'key'     => $att,
						'control' => $f[0],
						'label'   => $f[1],
						'options' => isset( $f[2] ) ? $f[2] : array(),
					);
				}
			}
			$blocks[ $name ] = $fields;
		}
		return array(
			'blocks'   => $blocks,
			'settings' => __( 'Settings', 'dlang-os-connect' ),
		);
	}

	/**
	 * Enqueue the stylesheet early on pages that contain a shortcode (blocks enqueue via block.json).
	 */
	public static function maybe_enqueue() {
		if ( ! is_singular() ) {
			return;
		}
		$post = get_post();
		if ( $post && false !== strpos( (string) $post->post_content, '[dlang_' ) ) {
			wp_enqueue_style( 'dlos-front' );
		}
	}

	/**
	 * Normalise attributes (shortcode strings, block booleans/numbers) against the defaults.
	 *
	 * @param string $name  Widget.
	 * @param array  $atts  Raw attributes.
	 * @return array
	 */
	public static function normalize_atts( $name, array $atts ) {
		$defs = self::definitions();
		$out  = array();
		foreach ( $defs[ $name ]['atts'] as $key => $default ) {
			$v = array_key_exists( $key, $atts ) ? $atts[ $key ] : $default;
			if ( is_bool( $v ) ) {
				$v = $v ? '1' : '0';
			} elseif ( is_int( $v ) || is_float( $v ) ) {
				$v = (string) $v;
			} elseif ( ! is_string( $v ) ) {
				$v = $default;
			}
			$out[ $key ] = sanitize_text_field( $v );
		}
		return $out;
	}

	/**
	 * Context for the renderer.
	 *
	 * @param array $atts Normalised attributes.
	 * @return array
	 */
	public static function context( array $atts ) {
		$settings = DLOS_Settings::all();
		$theme    = in_array( $atts['theme'], array( 'club', 'light', 'dark' ), true ) ? $atts['theme'] : $settings['theme'];
		$home     = wp_parse_url( home_url() );
		$origin   = isset( $home['scheme'], $home['host'] ) ? $home['scheme'] . '://' . $home['host'] . ( isset( $home['port'] ) ? ':' . (int) $home['port'] : '' ) : '';
		return array_merge(
			DLOS_Renderer::default_context(),
			array(
				'theme'         => $theme,
				'inherit_fonts' => ! empty( $settings['inherit_fonts'] ),
				'interactive'   => $settings['interactive'],
				'jsonld'        => ! empty( $settings['jsonld'] ),
				'lang'          => DLOS_Language::current( $atts['lang'] ),
				'club_slug'     => (string) $settings['club_slug'],
				'app_url'       => DLOS_Settings::app_url(),
				'site_origin'   => $origin,
			)
		);
	}

	/**
	 * Render a widget (shortcode and block entry point).
	 *
	 * @param string $name Widget.
	 * @param array  $raw  Raw attributes.
	 * @return string
	 */
	public static function render( $name, array $raw ) {
		$defs = self::definitions();
		if ( ! isset( $defs[ $name ] ) ) {
			return '';
		}
		wp_enqueue_style( 'dlos-front' );

		$atts = self::normalize_atts( $name, $raw );
		$ctx  = self::context( $atts );
		if ( 'embed' === $ctx['interactive'] ) {
			self::$needs_front_js = true;
		}

		if ( 'embed' === $name ) {
			if ( '' !== $ctx['app_url'] ) {
				wp_enqueue_script(
					'dlos-app-embed',
					$ctx['app_url'] . '/embed.js',
					array(),
					null,
					array(
						'in_footer' => true,
						'strategy'  => 'async',
					)
				); // phpcs:ignore WordPress.WP.EnqueuedResourceParameters.MissingVersion
			}
			return DLOS_Renderer::embed( $atts, $ctx );
		}

		if ( 'login' === $name ) {
			$club = DLOS_Api::get( 'club', array(), $ctx['lang'] );
			$env  = $club['ok'] ? $club['envelope'] : null;
			return DLOS_Renderer::login( self::login_url( $env ), $atts, $env ? $env['club'] : array(), $ctx );
		}

		$params = self::params( $name, $atts );
		$res    = DLOS_Api::get( $defs[ $name ]['endpoint'], $params, $ctx['lang'] );
		if ( ! $res['ok'] ) {
			return DLOS_Renderer::error_state( $name, $res['error'], current_user_can( 'edit_posts' ), $ctx['app_url'] );
		}
		$ctx['stale'] = $res['stale'];
		$env          = $res['envelope'];

		if ( 'team' === $name ) {
			return self::render_team( $env, $atts, $ctx );
		}
		return call_user_func( array( 'DLOS_Renderer', $name ), $env, $atts, $ctx );
	}

	/**
	 * Team page: team card plus its schedule and results.
	 *
	 * @param array $env  Teams envelope.
	 * @param array $atts Attributes.
	 * @param array $ctx  Context.
	 * @return string
	 */
	private static function render_team( array $env, array $atts, array $ctx ) {
		$slug     = $atts['slug'];
		$limit    = max( 1, (int) $atts['limit'] );
		$schedule = '';
		$results  = '';
		$nodes    = array();
		if ( '' !== $slug && '1' === $atts['show_schedule'] ) {
			$ev = DLOS_Api::get(
				'events',
				self::params(
					'schedule',
					array(
						'team' => $slug,
						'days' => '90',
						'type' => '',
					)
				),
				$ctx['lang']
			);
			if ( $ev['ok'] && $ev['envelope']['data'] ) {
				$items    = array_slice( $ev['envelope']['data'], 0, $limit );
				$schedule = DLOS_Renderer::event_list( $items, false );
				$nodes    = array_merge( $nodes, DLOS_Renderer::event_nodes( $items, $env['club'] ) );
			}
		}
		if ( '' !== $slug && '1' === $atts['show_results'] ) {
			$rs = DLOS_Api::get( 'results', array( 'team' => $slug ), $ctx['lang'] );
			if ( $rs['ok'] && $rs['envelope']['data'] ) {
				$results = DLOS_Renderer::event_list( array_slice( $rs['envelope']['data'], 0, $limit ), true );
			}
		}
		return DLOS_Renderer::team( $env, $atts, $ctx, $schedule, $results ) . DLOS_Renderer::schema( $atts, $ctx['jsonld'] ? $nodes : array() );
	}

	/**
	 * API params for a widget.
	 *
	 * @param string $name Widget.
	 * @param array  $atts Attributes.
	 * @return array
	 */
	public static function params( $name, array $atts ) {
		switch ( $name ) {
			case 'camps':
				return array(
					'season' => $atts['season'],
					'year'   => $atts['year'],
				);
			case 'programs':
				return array(
					'kind'   => $atts['kind'],
					'season' => $atts['season'],
				);
			case 'schedule':
				$days = max( 1, min( 366, (int) ( '' !== $atts['days'] ? $atts['days'] : 60 ) ) );
				$now  = time();
				return array(
					'from' => wp_date( 'Y-m-d', $now ),
					'to'   => wp_date( 'Y-m-d', $now + $days * DAY_IN_SECONDS ),
					'team' => $atts['team'],
					'type' => $atts['type'],
				);
			case 'results':
				return array(
					'team'   => $atts['team'],
					'season' => $atts['season'],
				);
			case 'shop':
				return array( 'category' => $atts['category'] );
			case 'news':
				$limit = (int) $atts['limit'];
				return $limit > 0 ? array( 'limit' => (string) min( 50, $limit ) ) : array();
			default:
				return array();
		}
	}

	/**
	 * Login / parent-area URL: the club's nav link when the API publishes one, else <app>/login.
	 *
	 * @param array|null $club_env Club envelope.
	 * @return string
	 */
	public static function login_url( $club_env ) {
		if ( is_array( $club_env ) && isset( $club_env['data'] ) && is_array( $club_env['data'] ) ) {
			$nav = DLOS_Format::arr( $club_env['data'], 'nav' );
			if ( ! $nav ) {
				$nav = DLOS_Format::arr( $club_env['data'], 'links' );
			}
			$url = DLOS_Format::url( isset( $nav['login'] ) ? $nav['login'] : '' );
			if ( '' !== $url ) {
				return $url;
			}
		}
		return DLOS_Api::app_page( 'login' );
	}

	/**
	 * Print the small front-end script when needed (embed dialogs / install hint).
	 */
	public static function print_front_js() {
		if ( ! self::$needs_front_js && ! DLOS_Frontend::pwa_hint_enabled() ) {
			return;
		}
		$config = array(
			'appOrigin' => self::origin( DLOS_Settings::app_url() ),
			'close'     => __( 'Close', 'dlang-os-connect' ),
			'loading'   => __( 'Loading…', 'dlang-os-connect' ),
			'title'     => __( 'Club app', 'dlang-os-connect' ),
		);
		wp_add_inline_script( 'dlos-front', 'window.dlosFront = ' . wp_json_encode( $config ) . ';', 'before' );
		wp_enqueue_script( 'dlos-front' );
	}

	/**
	 * Origin (scheme://host[:port]) of a URL.
	 *
	 * @param string $url URL.
	 * @return string
	 */
	public static function origin( $url ) {
		$p = wp_parse_url( (string) $url );
		if ( empty( $p['scheme'] ) || empty( $p['host'] ) ) {
			return '';
		}
		return $p['scheme'] . '://' . $p['host'] . ( isset( $p['port'] ) ? ':' . (int) $p['port'] : '' );
	}
}
