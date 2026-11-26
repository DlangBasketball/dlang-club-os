/**
 * DLang OS Connect - front end (no dependencies).
 *
 * 1. Embed mode: buttons with data-dlos-embed open the app's chrome-less page in a <dialog>
 *    instead of a new tab; without JS (or <dialog> support) the link simply opens the app.
 * 2. Auto-height: listens for { type: "dlang:resize", height } from the app origin only.
 * 3. "Install the app" hint: shown unless dismissed or already running as an installed app.
 */
( function () {
	'use strict';

	var cfg = window.dlosFront || {};
	var appOrigin = cfg.appOrigin || '';
	var dialog = null;
	var frame = null;
	var opener = null;

	function sameOrigin( url ) {
		try {
			return !! appOrigin && new URL( url, window.location.href ).origin === appOrigin;
		} catch ( e ) {
			return false;
		}
	}

	function buildDialog() {
		dialog = document.createElement( 'dialog' );
		dialog.className = 'dlos dlos-dialog';
		dialog.setAttribute( 'aria-label', cfg.title || '' );

		var close = document.createElement( 'button' );
		close.type = 'button';
		close.className = 'dlos-dialog__close';
		close.setAttribute( 'aria-label', cfg.close || 'Close' );
		close.textContent = '×';
		close.addEventListener( 'click', function () {
			dialog.close();
		} );

		frame = document.createElement( 'iframe' );
		frame.className = 'dlos-dialog__frame';
		frame.title = cfg.title || '';
		frame.setAttribute( 'loading', 'eager' );
		frame.setAttribute( 'referrerpolicy', 'strict-origin-when-cross-origin' );
		frame.setAttribute( 'allow', 'payment' );

		dialog.appendChild( close );
		dialog.appendChild( frame );
		dialog.addEventListener( 'close', function () {
			frame.src = 'about:blank';
			if ( opener ) {
				opener.focus();
			}
		} );
		dialog.addEventListener( 'click', function ( e ) {
			if ( e.target === dialog ) {
				dialog.close();
			}
		} );
		document.body.appendChild( dialog );
	}

	document.addEventListener( 'click', function ( e ) {
		var link = e.target && e.target.closest ? e.target.closest( 'a[data-dlos-embed]' ) : null;
		if ( ! link || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0 ) {
			return;
		}
		var src = link.getAttribute( 'data-dlos-embed' );
		if ( ! sameOrigin( src ) || typeof HTMLDialogElement === 'undefined' ) {
			return; // Fall back to opening the app.
		}
		e.preventDefault();
		if ( ! dialog ) {
			buildDialog();
		}
		opener = link;
		frame.style.height = '';
		frame.src = src;
		dialog.showModal();
	} );

	window.addEventListener( 'message', function ( e ) {
		if ( ! appOrigin || e.origin !== appOrigin || ! e.data || e.data.type !== 'dlang:resize' ) {
			return;
		}
		var h = parseInt( e.data.height, 10 );
		if ( ! frame || ! h || h < 100 || h > 10000 || e.source !== frame.contentWindow ) {
			return;
		}
		frame.style.height = h + 'px';
	} );

	// Install hint.
	var hint = document.querySelector( '[data-dlos-pwa]' );
	if ( hint ) {
		var key = 'dlos-pwa-dismissed';
		var dismissed = false;
		try {
			dismissed = window.localStorage.getItem( key ) === '1';
		} catch ( err ) {
			dismissed = false;
		}
		var standalone = window.matchMedia && window.matchMedia( '(display-mode: standalone)' ).matches;
		if ( ! dismissed && ! standalone ) {
			hint.hidden = false;
		}
		var btn = hint.querySelector( '[data-dlos-pwa-close]' );
		if ( btn ) {
			btn.addEventListener( 'click', function () {
				hint.hidden = true;
				try {
					window.localStorage.setItem( key, '1' );
				} catch ( err ) {
					/* Private mode: hide for this page view only. */
				}
			} );
		}
	}
} )();
