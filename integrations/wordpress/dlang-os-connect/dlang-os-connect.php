<?php
/**
 * Plugin Name:       DLang OS Connect
 * Description:       Show your club's live programmes, camps, schedule, results, teams, coaches, training, shop, donations and news from DLang OS on your WordPress site, in your club's look. Enter it once in the app, show it everywhere.
 * Version:           1.0.0
 * Requires at least: 6.3
 * Requires PHP:      7.4
 * Author:            DLang OS
 * License:           GPL-2.0-or-later
 * License URI:       https://www.gnu.org/licenses/gpl-2.0.html
 * Text Domain:       dlang-os-connect
 * Domain Path:       /languages
 *
 * @package DLangOSConnect
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

define( 'DLOS_VERSION', '1.0.0' );
define( 'DLOS_FILE', __FILE__ );
define( 'DLOS_DIR', plugin_dir_path( __FILE__ ) );
define( 'DLOS_URL', plugin_dir_url( __FILE__ ) );

require_once DLOS_DIR . 'includes/class-dlos-settings.php';
require_once DLOS_DIR . 'includes/class-dlos-language.php';
require_once DLOS_DIR . 'includes/class-dlos-signature.php';
require_once DLOS_DIR . 'includes/class-dlos-cache.php';
require_once DLOS_DIR . 'includes/class-dlos-format.php';
require_once DLOS_DIR . 'includes/class-dlos-validator.php';
require_once DLOS_DIR . 'includes/class-dlos-api.php';
require_once DLOS_DIR . 'includes/class-dlos-theme.php';
require_once DLOS_DIR . 'includes/class-dlos-jsonld.php';
require_once DLOS_DIR . 'includes/class-dlos-renderer.php';
require_once DLOS_DIR . 'includes/class-dlos-widgets.php';
require_once DLOS_DIR . 'includes/class-dlos-rest.php';
require_once DLOS_DIR . 'includes/class-dlos-menu.php';
require_once DLOS_DIR . 'includes/class-dlos-redirects.php';
require_once DLOS_DIR . 'includes/class-dlos-frontend.php';

if ( is_admin() ) {
	require_once DLOS_DIR . 'includes/admin/class-dlos-admin-settings.php';
	require_once DLOS_DIR . 'includes/admin/class-dlos-admin-migration.php';
}

/**
 * Boot the plugin.
 */
function dlos_boot() {
	add_action( 'init', 'dlos_load_textdomain', 1 );

	DLOS_Widgets::init();
	DLOS_Rest::init();
	DLOS_Menu::init();
	DLOS_Redirects::init();
	DLOS_Frontend::init();
	add_action( 'dlos_cache_purged', array( 'DLOS_Cache', 'purge_page_caches' ) );

	if ( is_admin() ) {
		DLOS_Admin_Settings::init();
		DLOS_Admin_Migration::init();
	}
}
add_action( 'plugins_loaded', 'dlos_boot' );

/**
 * Translations (bundled .mo files; language packs from translate.wordpress.org take precedence).
 */
function dlos_load_textdomain() {
	load_plugin_textdomain( 'dlang-os-connect', false, dirname( plugin_basename( DLOS_FILE ) ) . '/languages' );
}

/**
 * Activation: create options with autoload off for the large ones.
 */
function dlos_activate() {
	if ( false === get_option( DLOS_Settings::OPTION ) ) {
		add_option( DLOS_Settings::OPTION, DLOS_Settings::defaults(), '', true );
	}
	if ( false === get_option( DLOS_Redirects::OPTION ) ) {
		add_option( DLOS_Redirects::OPTION, array(), '', false );
	}
	if ( false === get_option( DLOS_Cache::GEN_OPTION ) ) {
		add_option( DLOS_Cache::GEN_OPTION, array(), '', false );
	}
}
register_activation_hook( __FILE__, 'dlos_activate' );
