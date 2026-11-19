<?php
/**
 * Settings > DLang OS.
 *
 * @package DLangOSConnect
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Settings page.
 */
class DLOS_Admin_Settings {

	const SLUG = 'dlang-os';

	/**
	 * Hooks.
	 */
	public static function init() {
		add_action( 'admin_menu', array( __CLASS__, 'menu' ) );
		add_action( 'admin_init', array( __CLASS__, 'register' ) );
		add_action( 'admin_post_dlos_test', array( __CLASS__, 'handle_test' ) );
		add_action( 'admin_post_dlos_clear_cache', array( __CLASS__, 'handle_clear_cache' ) );
		add_filter( 'plugin_action_links_' . plugin_basename( DLOS_FILE ), array( __CLASS__, 'action_links' ) );
	}

	/**
	 * Menu entry.
	 */
	public static function menu() {
		add_options_page( __( 'DLang OS Connect', 'dlang-os-connect' ), __( 'DLang OS', 'dlang-os-connect' ), 'manage_options', self::SLUG, array( __CLASS__, 'render' ) );
	}

	/**
	 * Settings link on the Plugins screen.
	 *
	 * @param array $links Links.
	 * @return array
	 */
	public static function action_links( $links ) {
		array_unshift( $links, '<a href="' . esc_url( admin_url( 'options-general.php?page=' . self::SLUG ) ) . '">' . esc_html__( 'Settings', 'dlang-os-connect' ) . '</a>' );
		return $links;
	}

	/**
	 * Register the option.
	 */
	public static function register() {
		register_setting(
			'dlos',
			DLOS_Settings::OPTION,
			array(
				'type'              => 'array',
				'sanitize_callback' => array( 'DLOS_Settings', 'sanitize' ),
				'default'           => DLOS_Settings::defaults(),
				'show_in_rest'      => false,
			)
		);
	}

	/**
	 * Test the connection (admin-post, nonce + capability checked).
	 */
	public static function handle_test() {
		if ( ! current_user_can( 'manage_options' ) ) {
			wp_die( esc_html__( 'You are not allowed to do this.', 'dlang-os-connect' ), 403 );
		}
		check_admin_referer( 'dlos_test' );
		$result = DLOS_Api::test_connection();
		$store  = is_array( $result )
			? array(
				'ok'   => true,
				'club' => $result['club'],
				'data' => array(
					'name' => DLOS_Format::str( $result['data'], 'name' ),
				),
			)
			: array(
				'ok'    => false,
				'error' => (string) $result,
			);
		set_transient( 'dlos_test_' . get_current_user_id(), $store, 120 );
		wp_safe_redirect( admin_url( 'options-general.php?page=' . self::SLUG . '&dlos_tested=1' ) );
		exit;
	}

	/**
	 * Clear the cache.
	 */
	public static function handle_clear_cache() {
		if ( ! current_user_can( 'manage_options' ) ) {
			wp_die( esc_html__( 'You are not allowed to do this.', 'dlang-os-connect' ), 403 );
		}
		check_admin_referer( 'dlos_clear_cache' );
		DLOS_Cache::delete_all();
		wp_safe_redirect( admin_url( 'options-general.php?page=' . self::SLUG . '&dlos_cleared=1' ) );
		exit;
	}

	/**
	 * Human message for an error code.
	 *
	 * @param string $code Code.
	 * @return string
	 */
	public static function error_message( $code ) {
		$messages = array(
			'not_configured'   => __( 'Enter the app address and the club slug first, then save.', 'dlang-os-connect' ),
			'not_found'        => __( 'The app does not know this club, or the website connection is switched off in the app (Settings > Website).', 'dlang-os-connect' ),
			'unreachable'      => __( 'The app could not be reached. Check the address and that this server can make outgoing HTTPS requests.', 'dlang-os-connect' ),
			'rate_limited'     => __( 'The app is rate limiting this site. Try again in a minute.', 'dlang-os-connect' ),
			'invalid_response' => __( 'The app answered, but not with the expected data. Check the app address.', 'dlang-os-connect' ),
			'insecure_url'     => __( 'Only https:// app addresses are allowed.', 'dlang-os-connect' ),
		);
		/* translators: %s: error code */
		return isset( $messages[ $code ] ) ? $messages[ $code ] : sprintf( __( 'Unexpected answer from the app (%s).', 'dlang-os-connect' ), $code );
	}

	/**
	 * Page.
	 */
	public static function render() {
		if ( ! current_user_can( 'manage_options' ) ) {
			return;
		}
		$s    = DLOS_Settings::all();
		$name = DLOS_Settings::OPTION;
		?>
		<div class="wrap">
			<h1><?php esc_html_e( 'DLang OS Connect', 'dlang-os-connect' ); ?></h1>
			<p><?php esc_html_e( 'Show your club\'s live programmes, camps, schedule, teams, shop and more from the app on this website. You enter things once in the app; this site always shows the current version.', 'dlang-os-connect' ); ?></p>
			<?php
			// "Settings saved" and validation errors are printed by WordPress for Settings sub-pages.
			self::render_notices();
			?>
			<form method="post" action="options.php">
				<?php settings_fields( 'dlos' ); ?>
				<h2><?php esc_html_e( 'Connection', 'dlang-os-connect' ); ?></h2>
				<table class="form-table" role="presentation">
					<tr>
						<th scope="row"><label for="dlos-app-url"><?php esc_html_e( 'App address', 'dlang-os-connect' ); ?></label></th>
						<td><input type="url" class="regular-text code" id="dlos-app-url" name="<?php echo esc_attr( $name ); ?>[app_url]" value="<?php echo esc_attr( $s['app_url'] ); ?>" placeholder="https://app.example.org" required>
						<p class="description"><?php esc_html_e( 'The address of your club\'s DLang OS app (https only).', 'dlang-os-connect' ); ?></p></td>
					</tr>
					<tr>
						<th scope="row"><label for="dlos-club"><?php esc_html_e( 'Club slug', 'dlang-os-connect' ); ?></label></th>
						<td><input type="text" class="regular-text code" id="dlos-club" name="<?php echo esc_attr( $name ); ?>[club_slug]" value="<?php echo esc_attr( $s['club_slug'] ); ?>" pattern="[a-z0-9-]+" required>
						<p class="description"><?php esc_html_e( 'Shown in the app under Settings > Website.', 'dlang-os-connect' ); ?></p></td>
					</tr>
				</table>

				<h2><?php esc_html_e( 'Display', 'dlang-os-connect' ); ?></h2>
				<table class="form-table" role="presentation">
					<tr>
						<th scope="row"><label for="dlos-lang"><?php esc_html_e( 'Language', 'dlang-os-connect' ); ?></label></th>
						<td><select id="dlos-lang" name="<?php echo esc_attr( $name ); ?>[lang_mode]">
							<?php
							$modes = array(
								'auto' => __( 'Follow WPML / Polylang, then the site language', 'dlang-os-connect' ),
								'site' => __( 'Site language only', 'dlang-os-connect' ),
								'en'   => 'English',
								'fr'   => 'Français',
								'de'   => 'Deutsch',
								'it'   => 'Italiano',
								'es'   => 'Español',
							);
							foreach ( $modes as $v => $label ) {
								echo '<option value="' . esc_attr( $v ) . '"' . selected( $s['lang_mode'], $v, false ) . '>' . esc_html( $label ) . '</option>';
							}
							?>
						</select></td>
					</tr>
					<tr>
						<th scope="row"><label for="dlos-theme"><?php esc_html_e( 'Look', 'dlang-os-connect' ); ?></label></th>
						<td><select id="dlos-theme" name="<?php echo esc_attr( $name ); ?>[theme]">
							<option value="club" <?php selected( $s['theme'], 'club' ); ?>><?php esc_html_e( 'Club colours (same as the app)', 'dlang-os-connect' ); ?></option>
							<option value="light" <?php selected( $s['theme'], 'light' ); ?>><?php esc_html_e( 'Light, with club accent colours', 'dlang-os-connect' ); ?></option>
							<option value="dark" <?php selected( $s['theme'], 'dark' ); ?>><?php esc_html_e( 'Dark, with club accent colours', 'dlang-os-connect' ); ?></option>
						</select>
						<p><label><input type="checkbox" name="<?php echo esc_attr( $name ); ?>[inherit_fonts]" value="1" <?php checked( $s['inherit_fonts'], 1 ); ?>> <?php esc_html_e( 'Use this website\'s fonts', 'dlang-os-connect' ); ?></label></p></td>
					</tr>
					<tr>
						<th scope="row"><?php esc_html_e( 'Buttons (register, book, buy)', 'dlang-os-connect' ); ?></th>
						<td><fieldset>
							<label><input type="radio" name="<?php echo esc_attr( $name ); ?>[interactive]" value="app" <?php checked( $s['interactive'], 'app' ); ?>> <?php esc_html_e( 'Open the app in a new tab', 'dlang-os-connect' ); ?></label><br>
							<label><input type="radio" name="<?php echo esc_attr( $name ); ?>[interactive]" value="embed" <?php checked( $s['interactive'], 'embed' ); ?>> <?php esc_html_e( 'Open the app form in a window on this site (embed)', 'dlang-os-connect' ); ?></label>
							<p class="description"><?php esc_html_e( 'Embed needs this website\'s address in the app\'s allowed website origins. Payment and login steps always open in a new tab.', 'dlang-os-connect' ); ?></p>
						</fieldset></td>
					</tr>
					<tr>
						<th scope="row"><?php esc_html_e( 'Extras', 'dlang-os-connect' ); ?></th>
						<td>
							<label><input type="checkbox" name="<?php echo esc_attr( $name ); ?>[jsonld]" value="1" <?php checked( $s['jsonld'], 1 ); ?>> <?php esc_html_e( 'Add structured data for search engines (games, camps, shop items)', 'dlang-os-connect' ); ?></label><br>
							<label><input type="checkbox" name="<?php echo esc_attr( $name ); ?>[pwa_hint]" value="1" <?php checked( $s['pwa_hint'], 1 ); ?>> <?php esc_html_e( 'Show a small "Install the app" hint to visitors', 'dlang-os-connect' ); ?></label>
						</td>
					</tr>
				</table>

				<h2><?php esc_html_e( 'Cache and updates', 'dlang-os-connect' ); ?></h2>
				<table class="form-table" role="presentation">
					<tr>
						<th scope="row"><label for="dlos-ttl"><?php esc_html_e( 'Cache duration (minutes)', 'dlang-os-connect' ); ?></label></th>
						<td><input type="number" min="1" max="1440" id="dlos-ttl" name="<?php echo esc_attr( $name ); ?>[cache_ttl]" value="<?php echo esc_attr( (string) $s['cache_ttl'] ); ?>" class="small-text">
						<p class="description"><?php esc_html_e( 'If the app cannot be reached, the last saved copy is shown.', 'dlang-os-connect' ); ?></p></td>
					</tr>
					<tr>
						<th scope="row"><label for="dlos-secret"><?php esc_html_e( 'Webhook secret', 'dlang-os-connect' ); ?></label></th>
						<td><input type="password" class="regular-text code" id="dlos-secret" name="<?php echo esc_attr( $name ); ?>[webhook_secret]" value="" autocomplete="new-password" placeholder="<?php echo esc_attr( '' !== $s['webhook_secret'] ? __( 'Saved (leave empty to keep)', 'dlang-os-connect' ) : '' ); ?>">
						<?php if ( '' !== $s['webhook_secret'] ) : ?>
							<label><input type="checkbox" name="<?php echo esc_attr( $name ); ?>[webhook_secret_clear]" value="1"> <?php esc_html_e( 'Remove', 'dlang-os-connect' ); ?></label>
						<?php endif; ?>
						<p class="description"><?php esc_html_e( 'Copy the website secret from the app. With it, the app refreshes this site the moment you change something. Webhook URL to paste in the app:', 'dlang-os-connect' ); ?>
						<code><?php echo esc_html( rest_url( 'dlang-os/v1/purge' ) ); ?></code></p></td>
					</tr>
				</table>

				<h2><?php esc_html_e( 'Old pages', 'dlang-os-connect' ); ?></h2>
				<table class="form-table" role="presentation">
					<tr>
						<th scope="row"><?php esc_html_e( 'Redirects', 'dlang-os-connect' ); ?></th>
						<td><label><input type="checkbox" name="<?php echo esc_attr( $name ); ?>[redirects_on]" value="1" <?php checked( $s['redirects_on'], 1 ); ?>> <?php esc_html_e( 'Send visitors of old event, team and product pages to the app (301)', 'dlang-os-connect' ); ?></label>
						<p class="description"><a href="<?php echo esc_url( admin_url( 'tools.php?page=' . DLOS_Admin_Migration::SLUG ) ); ?>"><?php esc_html_e( 'Build the redirect list on Tools > Move to DLang OS', 'dlang-os-connect' ); ?></a></p></td>
					</tr>
				</table>
				<?php submit_button(); ?>
			</form>

			<hr>
			<div style="display:flex;gap:8px;flex-wrap:wrap">
				<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>">
					<input type="hidden" name="action" value="dlos_test">
					<?php wp_nonce_field( 'dlos_test' ); ?>
					<?php submit_button( __( 'Test connection', 'dlang-os-connect' ), 'secondary', 'submit', false ); ?>
				</form>
				<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>">
					<input type="hidden" name="action" value="dlos_clear_cache">
					<?php wp_nonce_field( 'dlos_clear_cache' ); ?>
					<?php submit_button( __( 'Clear cache', 'dlang-os-connect' ), 'secondary', 'submit', false ); ?>
				</form>
			</div>

			<h2><?php esc_html_e( 'Shortcodes', 'dlang-os-connect' ); ?></h2>
			<p><?php esc_html_e( 'Each shortcode is also available as a block in the editor (category "DLang OS").', 'dlang-os-connect' ); ?></p>
			<p><code>[dlang_camps season="summer"]</code> <code>[dlang_programs kind="team"]</code> <code>[dlang_schedule team="u14" type="game" days="30"]</code> <code>[dlang_results team="u14"]</code> <code>[dlang_teams]</code> <code>[dlang_team slug="u14"]</code> <code>[dlang_coaches]</code> <code>[dlang_training]</code> <code>[dlang_shop category="apparel"]</code> <code>[dlang_donate campaign="new-hoops"]</code> <code>[dlang_news limit="3"]</code> <code>[dlang_login]</code> <code>[dlang_embed widget="book"]</code></p>
		</div>
		<?php
	}

	/**
	 * Result notices.
	 */
	private static function render_notices() {
		// phpcs:disable WordPress.Security.NonceVerification.Recommended -- display only.
		if ( isset( $_GET['dlos_cleared'] ) ) {
			echo '<div class="notice notice-success"><p>' . esc_html__( 'Cache cleared.', 'dlang-os-connect' ) . '</p></div>';
		}
		if ( ! isset( $_GET['dlos_tested'] ) ) {
			return;
		}
		// phpcs:enable
		$key    = 'dlos_test_' . get_current_user_id();
		$result = get_transient( $key );
		delete_transient( $key );
		if ( ! is_array( $result ) ) {
			return;
		}
		if ( empty( $result['ok'] ) ) {
			echo '<div class="notice notice-error"><p><strong>' . esc_html__( 'Connection failed.', 'dlang-os-connect' ) . '</strong> ' . esc_html( self::error_message( (string) $result['error'] ) ) . '</p></div>';
			return;
		}
		$club = $result['club'];
		$name = '' !== $club['name'] ? $club['name'] : $result['data']['name'];
		echo '<div class="notice notice-success"><p style="display:flex;align-items:center;gap:12px">';
		if ( '' !== $club['logo_url'] ) {
			echo '<img src="' . esc_url( $club['logo_url'] ) . '" alt="" width="40" height="40" style="object-fit:contain">';
		}
		/* translators: %s: club name */
		echo '<span><strong>' . esc_html__( 'Connected.', 'dlang-os-connect' ) . '</strong> ' . esc_html( sprintf( __( 'Club: %s', 'dlang-os-connect' ), $name ) ) . '</span>';
		foreach ( array( 'brand-primary', 'brand-accent', 'bg', 'text' ) as $token ) {
			if ( isset( $club['theme'][ $token ] ) ) {
				echo '<span title="' . esc_attr( $token ) . '" style="display:inline-block;width:20px;height:20px;border-radius:4px;border:1px solid #ccc;background:' . esc_attr( $club['theme'][ $token ] ) . '"></span>';
			}
		}
		echo '</p></div>';
	}
}
