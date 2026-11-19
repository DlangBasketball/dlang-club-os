/**
 * DLang OS Connect - block editor (no build step).
 *
 * Block metadata (title, attributes) comes from each blocks/<name>/block.json, registered in PHP.
 * Inspector fields and their translated labels come from window.dlosBlocks (printed by PHP).
 * The preview is the real server-side render, so the editor shows exactly what visitors see.
 */
( function ( wp, config ) {
	'use strict';

	if ( ! wp || ! wp.blocks || ! config ) {
		return;
	}

	var el = wp.element.createElement;
	var Fragment = wp.element.Fragment;
	var InspectorControls = wp.blockEditor.InspectorControls;
	var useBlockProps = wp.blockEditor.useBlockProps;
	var PanelBody = wp.components.PanelBody;
	var TextControl = wp.components.TextControl;
	var SelectControl = wp.components.SelectControl;
	var ToggleControl = wp.components.ToggleControl;
	var ServerSideRender = wp.serverSideRender;

	function control( field, attributes, setAttributes ) {
		var value = attributes[ field.key ];
		var onChange = function ( next ) {
			var update = {};
			update[ field.key ] = next;
			setAttributes( update );
		};

		if ( 'toggle' === field.control ) {
			return el( ToggleControl, {
				key: field.key,
				label: field.label,
				checked: !! value,
				onChange: onChange,
				__nextHasNoMarginBottom: true,
			} );
		}
		if ( 'select' === field.control ) {
			return el( SelectControl, {
				key: field.key,
				label: field.label,
				value: value || '',
				options: field.options.map( function ( o ) {
					return { value: o[ 0 ], label: o[ 1 ] };
				} ),
				onChange: onChange,
				__nextHasNoMarginBottom: true,
			} );
		}
		return el( TextControl, {
			key: field.key,
			label: field.label,
			type: 'number' === field.control ? 'number' : 'text',
			min: 'number' === field.control ? 0 : undefined,
			value: value || '',
			onChange: function ( next ) {
				onChange( String( next ) );
			},
			__nextHasNoMarginBottom: true,
		} );
	}

	Object.keys( config.blocks ).forEach( function ( name ) {
		var blockName = 'dlang-os/' + name;
		var fields = config.blocks[ name ];

		wp.blocks.registerBlockType( blockName, {
			edit: function ( props ) {
				var blockProps = useBlockProps();
				return el(
					Fragment,
					null,
					el(
						InspectorControls,
						null,
						el(
							PanelBody,
							{ title: config.settings, initialOpen: true },
							fields.map( function ( field ) {
								return control( field, props.attributes, props.setAttributes );
							} )
						)
					),
					el(
						'div',
						blockProps,
						el( ServerSideRender, {
							block: blockName,
							attributes: props.attributes,
						} )
					)
				);
			},
			save: function () {
				return null; // Rendered on the server.
			},
		} );
	} );
} )( window.wp, window.dlosBlocks );
