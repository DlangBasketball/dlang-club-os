<?php
/**
 * Nav menu item type "DLang OS account" (and "Install the app").
 *
 * Items are stored as custom links with a placeholder URL; the real app URL is filled in at render
 * time, so changing the app address in the settings updates every menu.
 *
 * @package DLangOSConnect
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Menu integration.
 */
class DLOS_Menu {

	const ACCOUNT = '#dlang-os-account';
	const APP     = '#dlang-os-app';

	/**
	 * Hooks.
	 */
	public static function init() {
		add_action( 'admin_head-nav-menus.php', array( __CLASS__, 'meta_box' ) );
		add_filter( 'wp_setup_nav_menu_item', array( __CLASS__, 'label' ) );
		add_filter( 'wp_nav_menu_objects', array( __CLASS__, 'resolve' ) );
	}

	/**
	 * Placeholder => real URL.
	 *
	 * @param string $placeholder Placeholder.
	 * @return string
	 */
	public static function target( $placeholder ) {
		if ( self::ACCOUNT === $placeholder ) {
			return (string) apply_filters( 'dlos_login_url', DLOS_Widgets::login_url( null ) );
		}
		if ( self::APP === $placeholder ) {
			return DLOS_Api::app_page( '' );
		}
		return '';
	}

	/**
	 * Add the meta box on Appearance > Menus.
	 */
	public static function meta_box() {
		add_meta_box( 'dlos-nav-menu', __( 'DLang OS', 'dlang-os-connect' ), array( __CLASS__, 'render_meta_box' ), 'nav-menus', 'side', 'default' );
	}

	/**
	 * Meta box markup (same structure as core's custom-link boxes so "Add to Menu" works).
	 */
	public static function render_meta_box() {
		$items = array(
			self::ACCOUNT => __( 'My account', 'dlang-os-connect' ),
			self::APP     => __( 'Get the app', 'dlang-os-connect' ),
		);
		echo '<div id="dlos-menu-items" class="posttypediv"><div class="tabs-panel tabs-panel-active"><ul class="categorychecklist form-no-clear">';
		$i = -1;
		foreach ( $items as $url => $title ) {
			echo '<li><label class="menu-item-title"><input type="checkbox" class="menu-item-checkbox" name="menu-item[' . esc_attr( (string) $i ) . '][menu-item-object-id]" value="' . esc_attr( (string) $i ) . '"> ' . esc_html( $title ) . '</label>';
			echo '<input type="hidden" class="menu-item-type" name="menu-item[' . esc_attr( (string) $i ) . '][menu-item-type]" value="custom">';
			echo '<input type="hidden" class="menu-item-title" name="menu-item[' . esc_attr( (string) $i ) . '][menu-item-title]" value="' . esc_attr( $title ) . '">';
			echo '<input type="hidden" class="menu-item-url" name="menu-item[' . esc_attr( (string) $i ) . '][menu-item-url]" value="' . esc_attr( $url ) . '">';
			echo '<input type="hidden" class="menu-item-classes" name="menu-item[' . esc_attr( (string) $i ) . '][menu-item-classes]" value="dlos-menu-item">';
			echo '</li>';
			--$i;
		}
		echo '</ul></div><p class="button-controls"><span class="add-to-menu"><input type="submit" class="button-secondary submit-add-to-menu right" value="' . esc_attr__( 'Add to Menu', 'dlang-os-connect' ) . '" name="add-dlos-menu-item" id="submit-dlos-menu-items"><span class="spinner"></span></span></p></div>';
	}

	/**
	 * Show a friendly type label in the menu editor.
	 *
	 * @param object $item Menu item.
	 * @return object
	 */
	public static function label( $item ) {
		if ( is_object( $item ) && isset( $item->url ) && in_array( $item->url, array( self::ACCOUNT, self::APP ), true ) ) {
			$item->type_label = self::ACCOUNT === $item->url ? __( 'DLang OS account', 'dlang-os-connect' ) : __( 'DLang OS app', 'dlang-os-connect' );
		}
		return $item;
	}

	/**
	 * Replace placeholders with the app URLs on the front end (hide the item when not configured).
	 *
	 * @param array $items Items.
	 * @return array
	 */
	public static function resolve( $items ) {
		foreach ( $items as $k => $item ) {
			if ( ! isset( $item->url ) || ! in_array( $item->url, array( self::ACCOUNT, self::APP ), true ) ) {
				continue;
			}
			$url = self::target( $item->url );
			if ( '' === $url ) {
				unset( $items[ $k ] );
				continue;
			}
			$item->url     = $url;
			$item->classes = array_merge( (array) $item->classes, array( 'dlos-menu-item' ) );
			$item->xfn     = trim( $item->xfn . ' noopener' );
			$items[ $k ]   = $item;
		}
		return $items;
	}
}
