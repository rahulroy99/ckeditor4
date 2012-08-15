﻿/**
 * @license Copyright (c) 2003-2012, CKSource - Frederico Knabben. All rights reserved.
 * For licensing, see LICENSE.html or http://ckeditor.com/license
 */

(function() {
	// #### checkSelectionChange : START

	// The selection change check basically saves the element parent tree of
	// the current node and check it on successive requests. If there is any
	// change on the tree, then the selectionChange event gets fired.
	function checkSelectionChange() {
		// Editor may have no selection at all.
		var sel = this.getSelection( 1 );
		if ( sel.getType() == CKEDITOR.SELECTION_NONE )
			return;

		// Before doing anything, save a locked copy to be used for later recovery.
		sel.lock();
		this._.lastSelection = sel;

		var currentPath = this.elementPath();
		if ( !currentPath.compare( this._.selectionPreviousPath ) ) {
			this._.selectionPreviousPath = currentPath;
			this.fire( 'selectionChange', { selection: sel, path: currentPath } );
		}
	}

	var checkSelectionChangeTimer, checkSelectionChangeTimeoutPending;

	function checkSelectionChangeTimeout() {
		// Firing the "OnSelectionChange" event on every key press started to
		// be too slow. This function guarantees that there will be at least
		// 200ms delay between selection checks.

		checkSelectionChangeTimeoutPending = true;

		if ( checkSelectionChangeTimer )
			return;

		checkSelectionChangeTimeoutExec.call( this );

		checkSelectionChangeTimer = CKEDITOR.tools.setTimeout( checkSelectionChangeTimeoutExec, 200, this );
	}

	function checkSelectionChangeTimeoutExec() {
		checkSelectionChangeTimer = null;

		if ( checkSelectionChangeTimeoutPending ) {
			// Call this with a timeout so the browser properly moves the
			// selection after the mouseup. It happened that the selection was
			// being moved after the mouseup when clicking inside selected text
			// with Firefox.
			CKEDITOR.tools.setTimeout( checkSelectionChange, 0, this );

			checkSelectionChangeTimeoutPending = false;
		}
	}

	// #### checkSelectionChange : END

	function rangeRequiresFix( range ) {
		function isInlineCt( node ) {
			return node && node.type == CKEDITOR.NODE_ELEMENT && node.getName() in CKEDITOR.dtd.$removeEmpty;
		}

		function singletonBlock( node ) {
			var body = range.document.getBody();
			return !node.is( 'body' ) && body.getChildCount() == 1;
		}

		var start = range.startContainer,
			offset = range.startOffset;

		if ( start.type == CKEDITOR.NODE_TEXT )
			return false;

		// 1. Empty inline element. <span>^</span>
		// 2. Adjoin to inline element. <p><strong>text</strong>^</p>
		// 3. The only empty block in document. <body><p>^</p></body> (#7222)
		return !CKEDITOR.tools.trim( start.getHtml() ) ? isInlineCt( start ) || singletonBlock( start ) : isInlineCt( start.getChild( offset - 1 ) ) || isInlineCt( start.getChild( offset ) );
	}

	function createFillingChar( element ) {
		removeFillingChar( element, false );

		var fillingChar = element.getDocument().createText( '\u200B' );
		element.setCustomData( 'cke-fillingChar', fillingChar );

		return fillingChar;
	}

	function getFillingChar( element ) {
		return element.getCustomData( 'cke-fillingChar' );
	}

	// Checks if a filling char has been used, eventualy removing it (#1272).
	function checkFillingChar( element ) {
		var fillingChar = getFillingChar( element );
		if ( fillingChar ) {
			// Use this flag to avoid removing the filling char right after
			// creating it.
			if ( fillingChar.getCustomData( 'ready' ) )
				removeFillingChar( element );
			else
				fillingChar.setCustomData( 'ready', 1 );
		}
	}

	function removeFillingChar( element, keepSelection ) {
		var fillingChar = element && element.removeCustomData( 'cke-fillingChar' );
		if ( fillingChar ) {

			// Text selection position might get mangled by
			// subsequent dom modification, save it now for restoring. (#8617)
			if ( keepSelection !== false )
			{
				var bm,
					doc = element.getDocument(),
					sel = doc.getSelection().getNative(),
					// Be error proof.
					range = sel && sel.type != 'None' && sel.getRangeAt( 0 );

				if ( fillingChar.getLength() > 1 && range && range.intersectsNode( fillingChar.$ ) ) {
					bm = [ sel.anchorOffset, sel.focusOffset ];

					// Anticipate the offset change brought by the removed char.
					var startAffected = sel.anchorNode == fillingChar.$ && sel.anchorOffset > 0,
						endAffected = sel.focusNode == fillingChar.$ && sel.focusOffset > 0;
					startAffected && bm[ 0 ]--;
					endAffected && bm[ 1 ]--;

					// Revert the bookmark order on reverse selection.
					isReversedSelection( sel ) && bm.unshift( bm.pop() );
				}
			}

			// We can't simply remove the filling node because the user
			// will actually enlarge it when typing, so we just remove the
			// invisible char from it.
			fillingChar.setText( fillingChar.getText().replace( /\u200B/g, '' ) );

			// Restore the bookmark.
			if ( bm ) {
				var rng = sel.getRangeAt( 0 );
				rng.setStart( rng.startContainer, bm[ 0 ] );
				rng.setEnd( rng.startContainer, bm[ 1 ] );
				sel.removeAllRanges();
				sel.addRange( rng );
			}
		}
	}

	function isReversedSelection( sel ) {
		if ( !sel.isCollapsed ) {
			var range = sel.getRangeAt( 0 );
			// Potentially alter an reversed selection range.
			range.setStart( sel.anchorNode, sel.anchorOffset );
			range.setEnd( sel.focusNode, sel.focusOffset );
			return range.collapsed;
		}
	}

	// Setup all editor instances for the necessary selection hooks.
	CKEDITOR.on( 'instanceCreated', function( ev ) {
		var editor = ev.editor;

		editor.define( 'selectionChange', { errorProof:1 } );

		editor.on( 'contentDom', function() {
			var doc = editor.document,
				editable = editor.editable(),
				body = doc.getBody(),
				html = doc.getDocumentElement();

			var isInline = editable.isInline();

			// Browsers could loose the selection once the editable lost focus,
			// in such case we need to reproduce it by saving a locked selection
			// and restoring it upon focus gain.
			if ( CKEDITOR.env.ie || CKEDITOR.env.opera || isInline ) {
				var restoreSel;

				// Plays the magic here to restore/save dom selection on editable focus/blur.
				editable.attachListener( editable, 'focus', function() {
					editor.unlockSelection( restoreSel );
					restoreSel = 0;
				}, null, null, -1 );

				editable.attachListener( editable, 'blur', function() {
					editor.lockSelection();
					restoreSel = 1;
				}, null, null, -1 );

				// Disable selection restoring when clicking in.
				editable.attachListener( editable, 'mousedown', function() {
					restoreSel = 0;
				});
			}

			// The following selection related fixes applies to only framed editable.
			if ( CKEDITOR.env.ie && !isInline ) {
				var scroll;
				editable.attachListener( editable, 'mousedown', function( evt ) {
					// IE scrolls document to top on right mousedown
					// when editor has no focus, remember this scroll
					// position and revert it before context menu opens. (#5778)
					if ( evt.data.$.button == 2 ) {
						var sel = editor.document.$.selection;
						if ( sel.type == 'None' )
							scroll = editor.window.getScrollPosition();
					}
				});

				editable.attachListener( editable, 'mouseup', function( evt ) {
					// Restore recorded scroll position when needed on right mouseup.
					if ( evt.data.$.button == 2 && scroll ) {
						editor.document.$.documentElement.scrollLeft = scroll.x;
						editor.document.$.documentElement.scrollTop = scroll.y;
					}
					scroll = null;
				});

				// When content doc is in standards mode, IE doesn't focus the editor when
				// clicking at the region below body (on html element) content, we emulate
				// the normal behavior on old IEs. (#1659, #7932)
				if ( ( CKEDITOR.env.ie7Compat || CKEDITOR.env.ie6Compat ) && doc.$.compatMode != 'BackCompat' ) {

					function moveRangeToPoint( range, x, y )
					{
						// Error prune in IE7. (#9034, #9110)
						try { range.moveToPoint( x, y ); } catch ( e ) {}
					}

					html.on( 'mousedown', function( evt ) {
						evt = evt.data.$;

						// Expand the text range along with mouse move.
						function onHover( evt ) {
							evt = evt.data.$;
							if ( textRng ) {
								// Read the current cursor.
								var rngEnd = body.$.createTextRange();

								moveRangeToPoint( rngEnd, evt.x, evt.y );

								// Handle drag directions.
								textRng.setEndPoint( textRng.compareEndPoints( 'StartToStart', rngEnd ) < 0 ? 'EndToEnd' : 'StartToStart', rngEnd );

								// Update selection with new range.
								textRng.select();
							}
						}

						// We're sure that the click happens at the region
						// below body, but not on scrollbar.
						if ( evt.y < html.$.clientHeight && evt.y > body.$.offsetTop + body.$.clientHeight && evt.x < html.$.clientWidth ) {
							// Start to build the text range.
							var textRng = body.$.createTextRange();
							moveRangeToPoint( textRng, evt.x, evt.y );

							html.on( 'mousemove', onHover );

							html.on( 'mouseup', function( evt ) {
								html.removeListener( 'mousemove', onHover );
								evt.removeListener();
								textRng.select();
							});
						}
					});
				}

				// It's much simpler for IE8+, we just need to reselect the reported range.
				if ( CKEDITOR.env.ie && CKEDITOR.env.version > 7 ) {
					html.on( 'mouseup', function( evt ) {
						// The event is not fired when clicking on the scrollbars,
						// so we can safely check the following to understand
						// whether the empty space following <body> has been clicked.
						if ( evt.data.getTarget().getName() == 'html' ) {
							var sel = CKEDITOR.document.$.selection,
								range = sel.createRange();
							// The selection range is reported on host, but actually it should applies to the content doc.
							if ( sel.type != 'None' && range.parentElement().ownerDocument == doc.$ )
								range.select();
						}
					});
				}

			}

			// We check the selection change:
			// 1. Upon "selectionchange" event from the editable element. (which might be faked event fired by our code)
			// 2. After the accomplish of keyboard and mouse events.
			editable.attachListener( editable, 'selectionchange', checkSelectionChange, editor );
			editable.attachListener( editable, 'mouseup', checkSelectionChangeTimeout, editor );
			editable.attachListener( editable, 'keyup', checkSelectionChangeTimeout, editor );
			// Always fire the selection change on focus gain.
			editable.attachListener( editable, 'focus', function() {
				editor.forceNextSelectionCheck();
				editor.selectionChange( 1 );
			});

			if ( CKEDITOR.env.webkit ) {
				doc.on( 'keydown', function( evt ) {
					var key = evt.data.getKey();
					// Remove the filling char before some keys get
					// executed, so they'll not get blocked by it.
					switch ( key ) {
						case 13: // ENTER
						case 33: // PAGEUP
						case 34: // PAGEDOWN
						case 35: // HOME
						case 36: // END
						case 37: // LEFT-ARROW
						case 39: // RIGHT-ARROW
						case 8: // BACKSPACE
						case 45: // INS
						case 46: // DEl
							removeFillingChar( editor.document );
					}

				}, null, null, 10 );
			}
		});

		// Clear the cached range path before unload. (#7174)
		editor.on( 'contentDomUnload', editor.forceNextSelectionCheck, editor );
		// Check selection change on data reload.
		editor.on( 'dataReady', function() {
			editor.selectionChange( 1 );
		});

		function clearSelection() {
			var sel = editor.getSelection();
			sel && sel.removeAllRanges();
		}

		// Clear dom selection before editable destroying to fix some browser
		// craziness.

		// IE9 might cease to work if there's an object selection inside the iframe (#7639).
		CKEDITOR.env.ie9Compat && editor.on( 'beforeDestroy', clearSelection, null, null, 9 );
		// Webkit's selection will mess up after the data loading.
		CKEDITOR.env.webkit && editor.on( 'setData', clearSelection );
	});

	CKEDITOR.on( 'instanceReady', function( evt ) {
		var editor = evt.editor,
			editable = editor.editable();

		// On WebKit only, we need a special "filling" char on some situations
		// (#1272). Here we set the events that should invalidate that char.
		if ( CKEDITOR.env.webkit ) {
			editor.on( 'selectionChange', function() {
				checkFillingChar( editable );
			}, null, null, -1 );
			editor.on( 'beforeSetMode', function() {
				removeFillingChar( editable );
			}, null, null, -1 );

			var fillingCharBefore, resetSelection;

			function beforeData() {
				var doc = editor.document,
					fillingChar = getFillingChar( editable );

				if ( fillingChar ) {
					// If cursor is right blinking by side of the filler node, save it for restoring,
					// as the following text substitution will blind it. (#7437)
					var sel = doc.$.defaultView.getSelection();
					if ( sel.type == 'Caret' && sel.anchorNode == fillingChar.$ )
						resetSelection = 1;

					fillingCharBefore = fillingChar.getText();
					fillingChar.setText( fillingCharBefore.replace( /\u200B/g, '' ) );
				}
			}

			function afterData() {
				var doc = editor.document,
					fillingChar = getFillingChar( editable );

				if ( fillingChar ) {
					fillingChar.setText( fillingCharBefore );

					if ( resetSelection ) {
						doc.$.defaultView.getSelection().setPosition( fillingChar.$, fillingChar.getLength() );
						resetSelection = 0;
					}
				}
			}

			editor.on( 'beforeUndoImage', beforeData );
			editor.on( 'afterUndoImage', afterData );
			editor.on( 'beforeGetData', beforeData, null, null, 0 );
			editor.on( 'getData', afterData );
		}

	});

	/**
	 * Check the selection change in editor and potentially fires
	 * the {@link CKEDITOR.editor#event-selectionChange} event.
	 *
	 * @method
	 * @member CKEDITOR.editor
	 * @param {Boolean} [checkNow=false] Force the check to happen immediately
	 * instead of coming with a timeout delay (default).
	 */
	CKEDITOR.editor.prototype.selectionChange = function( checkNow ) {
		( checkNow ? checkSelectionChange : checkSelectionChangeTimeout ).call( this );
	};

	/**
	 * Retrieve the editor selection in scope of  editable element.
	 *
	 * **Note:** Since the native browser selection provides only one single
	 * selection at a time per document, so if editor's editable element has lost focus,
	 * this method will return a null value unless the ```{@link CKEDITOR.editor#lockSelection}```
	 * has been called beforehand so the saved selection is retrieved.
	 *
	 *		var selection = CKEDITOR.instances.editor1.getSelection();
	 *		alert( selection.getType() );
	 *
	 * @method
	 * @member CKEDITOR.editor
	 * @param {Boolean} forceRealSelection
	 * @returns {CKEDITOR.dom.selection} A selection object or null if not available for the moment.
	 * @todo param
	 */
	CKEDITOR.editor.prototype.getSelection = function( forceRealSelection ) {
		// Check if there exists a locked selection.
		if ( this._.savedSelection && !forceRealSelection )
			return this._.savedSelection;

		// Editable element might be absent.
		var editable = this.editable();
		return editable ? new CKEDITOR.dom.selection( editable ) : null;
	};

	/**
	 * Locks the selection made in the editor in order to make it possible to
	 * manipulate it without browser interference. A locked selection is
	 * cached and remains unchanged until it is released with the
	 * ```{@link CKEDITOR.editor#unlockSelection}``` method.
	 *
	 * @method
	 * @member CKEDITOR.editor
	 * @returns {Boolean} ```true``` if selection was locked.
	 */
	CKEDITOR.editor.prototype.lockSelection = function() {
		if ( !this._.savedSelection ) {
			var sel = this.getSelection( 1 );
			sel = sel.getType() == CKEDITOR.SELECTION_NONE ? this._.lastSelection : sel;
			if ( sel ) {
				!sel.isLocked && sel.lock();
				this._.savedSelection = sel;
				return true;
			}
		}

		return false;
	};

	/**
	 * Unlocks the selection made in the editor and locked with the
	 * ```{@link CKEDITOR.editor#unlockSelection}``` method. An unlocked selection
	 * is no longer cached and can be changed.
	 *
	 * @method
	 * @member CKEDITOR.editor
	 * @param {Boolean} [restore] If set to ```true```, the selection is
	 * restored back to the selection saved earlier by using the
	 * ```{@link CKEDITOR.dom.selection#lock}``` method.
	 */
	CKEDITOR.editor.prototype.unlockSelection = function( restore ) {
		var sel = this._.savedSelection;
		if ( sel ) {
			sel.unlock( restore );
			delete this._.savedSelection;
			return true;
		}

		return false;
	};

	/**
	 * @method
	 * @member CKEDITOR.editor
	 * @todo
	 */
	CKEDITOR.editor.prototype.forceNextSelectionCheck = function() {
		delete this._.selectionPreviousPath;
	};

	/**
	 * Gets the current selection in context of the document's body element.
	 *
	 *		var selection = CKEDITOR.instances.editor1.document.getSelection();
	 *		alert( selection.getType() );
	 *
	 * @method
	 * @member CKEDITOR.dom.document
	 * @returns {CKEDITOR.dom.selection} A selection object.
	 */
	CKEDITOR.dom.document.prototype.getSelection = function() {
		return new CKEDITOR.dom.selection( this );
	};

	/**
	 * Select this range as the only one with {@link CKEDITOR.dom.selection#selectRanges}.
	 *
	 * @method
	 * @member CKEDITOR.dom.range
	 */
	CKEDITOR.dom.range.prototype.select = function() {
		var sel = this.root instanceof CKEDITOR.editable ? this.root.editor.getSelection() : new CKEDITOR.dom.selection( this.root );

		sel.selectRanges( [ this ] );
	};

	/**
	 * No selection.
	 *
	 *		if ( editor.getSelection().getType() == CKEDITOR.SELECTION_NONE )
	 *			alert( 'Nothing is selected' );
	 *
	 * @readonly
	 * @property {Number} [=1]
	 * @member CKEDITOR
	 */
	CKEDITOR.SELECTION_NONE = 1;

	/**
	 * A text or a collapsed selection.
	 *
	 *		if ( editor.getSelection().getType() == CKEDITOR.SELECTION_TEXT )
	 *			alert( 'A text is selected' );
	 *
	 * @readonly
	 * @property {Number} [=2]
	 * @member CKEDITOR
	 */
	CKEDITOR.SELECTION_TEXT = 2;

	/**
	 * Element selection.
	 *
	 *		if ( editor.getSelection().getType() == CKEDITOR.SELECTION_ELEMENT )
	 *			alert( 'An element is selected' );
	 *
	 * @readonly
	 * @property {Number} [=3]
	 * @member CKEDITOR
	 */
	CKEDITOR.SELECTION_ELEMENT = 3;

	/**
	 * Manipulates the selection within a DOM element, if the current browser selection
	 * spans outside of the element, an empty selection object is returned.
	 *
	 *		var sel = new CKEDITOR.dom.selection( CKEDITOR.document );
	 *
	 * @class
	 * @constructor
	 * @param {CKEDITOR.dom.document} target The DOM document/element that the DOM selection
	 * is restrained to, only selection spans within the target element is considered as valid.
	 */
	CKEDITOR.dom.selection = function( target ) {
		var isElement = target instanceof CKEDITOR.dom.element;
		this.document = target instanceof CKEDITOR.dom.document ? target : target.getDocument();
		this.root = isElement ? target : this.document.getBody();
		this.isLocked = 0;
		this._ = {
			cache: {}
		};

		// On WebKit, it may happen that we've already have focus
		// on the editable element while still having no selection
		// available. We normalize it here by replicating the
		// behavior of other browsers.
		if ( CKEDITOR.env.webkit ) {
			var sel = this.document.getWindow().$.getSelection();
			if ( sel.type == 'None' && this.document.getActive().equals( this.root ) || sel.type == 'Caret' && sel.anchorNode.nodeType == CKEDITOR.NODE_DOCUMENT ) {
				var range = new CKEDITOR.dom.range( this.root );
				range.moveToPosition( this.root, CKEDITOR.POSITION_AFTER_START );
				var nativeRange = this.document.$.createRange();
				nativeRange.setStart( range.startContainer.$, range.startOffset );
				nativeRange.collapse( 1 );
				sel.addRange( nativeRange );
			}
		}

		// Check whether browser focus is really inside of the editable element.

		var nativeSel = this.getNative(),
			rangeParent;

		if ( nativeSel.getRangeAt ) {
			range = nativeSel.rangeCount && nativeSel.getRangeAt( 0 );
			rangeParent = range && new CKEDITOR.dom.node( range.commonAncestorContainer );
		}
		// For old IEs.
		else {
			// Sometimes, mostly when selection is close to the table or hr,
			// IE throws "Unspecified error".
			try {
				range = nativeSel.createRange();
			} catch ( err ) {}
			rangeParent = range && CKEDITOR.dom.element.get( range.item && range.item( 0 ) || range.parentElement() );
		}

		// Selection out of concerned range, empty the selection.
		if ( !( rangeParent && ( this.root.equals( rangeParent ) || this.root.contains( rangeParent ) ) ) ) {
			this._.cache.type = CKEDITOR.SELECTION_NONE;
			this._.cache.startElement = null;
			this._.cache.selectedElement = null;
			this._.cache.selectedText = '';
			this._.cache.ranges = new CKEDITOR.dom.rangeList();
		}

		return this;
	};

	var styleObjectElements = { img:1,hr:1,li:1,table:1,tr:1,td:1,th:1,embed:1,object:1,ol:1,ul:1,a:1,input:1,form:1,select:1,textarea:1,button:1,fieldset:1,thead:1,tfoot:1 };

	CKEDITOR.dom.selection.prototype = {
		/**
		 * Gets the native selection object from the browser.
		 *
		 *		var selection = editor.getSelection().getNative();
		 *
		 * @returns {Object} The native browser selection object.
		 */
		getNative: function() {
			if ( this._.cache.nativeSel !== undefined )
				return this._.cache.nativeSel;

			return ( this._.cache.nativeSel = this.document.$.selection || this.document.getWindow().$.getSelection() );
		},

		/**
		 * Gets the type of the current selection. The following values are
		 * available:
		 *
		 * * {@link CKEDITOR#SELECTION_NONE}</code> (1): No selection.
		 * * {@link CKEDITOR#SELECTION_TEXT}</code> (2): A text or a collapsed selection is selected.
		 * * {@link CKEDITOR#SELECTION_ELEMENT}</code> (3): An element is selected.
		 *
		 * Example:
		 *
		 *		if ( editor.getSelection().getType() == CKEDITOR.SELECTION_TEXT )
		 *			alert( 'A text is selected' );
		 *
		 * @method
		 * @returns {Number} One of the following constant values: {@link CKEDITOR#SELECTION_NONE},
		 * {@link CKEDITOR#SELECTION_TEXT} or {@link CKEDITOR#SELECTION_ELEMENT}.
		 */
		getType: CKEDITOR.env.ie ?
		function() {
			var cache = this._.cache;
			if ( cache.type )
				return cache.type;

			var type = CKEDITOR.SELECTION_NONE;

			try {
				var sel = this.getNative(),
					ieType = sel.type;

				if ( ieType == 'Text' )
					type = CKEDITOR.SELECTION_TEXT;

				if ( ieType == 'Control' )
					type = CKEDITOR.SELECTION_ELEMENT;

				// It is possible that we can still get a text range
				// object even when type == 'None' is returned by IE.
				// So we'd better check the object returned by
				// createRange() rather than by looking at the type.
				if ( sel.createRange().parentElement )
					type = CKEDITOR.SELECTION_TEXT;
			} catch ( e ) {}

			return ( cache.type = type );
		} : function() {
			var cache = this._.cache;
			if ( cache.type )
				return cache.type;

			var type = CKEDITOR.SELECTION_TEXT;

			var sel = this.getNative();

			if ( !( sel && sel.rangeCount ) )
				type = CKEDITOR.SELECTION_NONE;
			else if ( sel.rangeCount == 1 ) {
				// Check if the actual selection is a control (IMG,
				// TABLE, HR, etc...).

				var range = sel.getRangeAt( 0 ),
					startContainer = range.startContainer;

				if ( startContainer == range.endContainer && startContainer.nodeType == 1 && ( range.endOffset - range.startOffset ) == 1 && styleObjectElements[ startContainer.childNodes[ range.startOffset ].nodeName.toLowerCase() ] ) {
					type = CKEDITOR.SELECTION_ELEMENT;
				}
			}

			return ( cache.type = type );
		},

		/**
		 * Retrieves the {@link CKEDITOR.dom.range} instances that represent the current selection.
		 *
		 * Note: Some browsers return multiple ranges even for a continuous selection. Firefox, for example, returns
		 * one range for each table cell when one or more table rows are selected.
		 *
		 *		var ranges = selection.getRanges();
		 *		alert( ranges.length );
		 *
		 * @method
		 * @param {Boolean} [onlyEditables] If set to ```true```, this function retrives editable ranges only.
		 * @return {Array} Range instances that represent the current selection.
		 */
		getRanges: (function() {
			var func = CKEDITOR.env.ie ? ( function() {
				function getNodeIndex( node ) {
					return new CKEDITOR.dom.node( node ).getIndex();
				}

				// Finds the container and offset for a specific boundary
				// of an IE range.
				var getBoundaryInformation = function( range, start ) {
						// Creates a collapsed range at the requested boundary.
						range = range.duplicate();
						range.collapse( start );

						// Gets the element that encloses the range entirely.
						var parent = range.parentElement(),
							doc = parent.ownerDocument;

						// Empty parent element, e.g. <i>^</i>
						if ( !parent.hasChildNodes() )
							return { container: parent, offset: 0 };

						var siblings = parent.children,
							child, sibling,
							testRange = range.duplicate(),
							startIndex = 0,
							endIndex = siblings.length - 1,
							index = -1,
							position, distance, container;

						// Binary search over all element childs to test the range to see whether
						// range is right on the boundary of one element.
						while ( startIndex <= endIndex ) {
							index = Math.floor( ( startIndex + endIndex ) / 2 );
							child = siblings[ index ];
							testRange.moveToElementText( child );
							position = testRange.compareEndPoints( 'StartToStart', range );

							if ( position > 0 )
								endIndex = index - 1;
							else if ( position < 0 )
								startIndex = index + 1;
							else {
								// IE9 report wrong measurement with compareEndPoints when range anchors between two BRs.
								// e.g. <p>text<br />^<br /></p> (#7433)
								if ( CKEDITOR.env.ie9Compat && child.tagName == 'BR' ) {
									// "Fall back" to w3c selection.
									var sel = doc.defaultView.getSelection();
									return {
										container: sel[ start ? 'anchorNode' : 'focusNode' ],
										offset: sel[ start ? 'anchorOffset' : 'focusOffset' ] };
								} else
									return { container: parent, offset: getNodeIndex( child ) };
							}
						}

						// All childs are text nodes,
						// or to the right hand of test range are all text nodes. (#6992)
						if ( index == -1 || index == siblings.length - 1 && position < 0 ) {
							// Adapt test range to embrace the entire parent contents.
							testRange.moveToElementText( parent );
							testRange.setEndPoint( 'StartToStart', range );

							// IE report line break as CRLF with range.text but
							// only LF with textnode.nodeValue, normalize them to avoid
							// breaking character counting logic below. (#3949)
							distance = testRange.text.replace( /(\r\n|\r)/g, '\n' ).length;

							siblings = parent.childNodes;

							// Actual range anchor right beside test range at the boundary of text node.
							if ( !distance ) {
								child = siblings[ siblings.length - 1 ];

								if ( child.nodeType != CKEDITOR.NODE_TEXT )
									return { container: parent, offset: siblings.length };
								else
									return { container: child, offset: child.nodeValue.length };
							}

							// Start the measuring until distance overflows, meanwhile count the text nodes.
							var i = siblings.length;
							while ( distance > 0 && i > 0 ) {
								sibling = siblings[ --i ];
								if ( sibling.nodeType == CKEDITOR.NODE_TEXT ) {
									container = sibling;
									distance -= sibling.nodeValue.length;
								}
							}

							return { container: container, offset: -distance };
						}
						// Test range was one offset beyond OR behind the anchored text node.
						else {
							// Adapt one side of test range to the actual range
							// for measuring the offset between them.
							testRange.collapse( position > 0 ? true : false );
							testRange.setEndPoint( position > 0 ? 'StartToStart' : 'EndToStart', range );

							// IE report line break as CRLF with range.text but
							// only LF with textnode.nodeValue, normalize them to avoid
							// breaking character counting logic below. (#3949)
							distance = testRange.text.replace( /(\r\n|\r)/g, '\n' ).length;

							// Actual range anchor right beside test range at the inner boundary of text node.
							if ( !distance )
								return { container: parent, offset: getNodeIndex( child ) + ( position > 0 ? 0 : 1 ) };

							// Start the measuring until distance overflows, meanwhile count the text nodes.
							while ( distance > 0 ) {
								try {
									sibling = child[ position > 0 ? 'previousSibling' : 'nextSibling' ];
									if ( sibling.nodeType == CKEDITOR.NODE_TEXT ) {
										distance -= sibling.nodeValue.length;
										container = sibling;
									}
									child = sibling;
								}
								// Measurement in IE could be somtimes wrong because of <select> element. (#4611)
								catch ( e ) {
									return { container: parent, offset: getNodeIndex( child ) };
								}
							}

							return { container: container, offset: position > 0 ? -distance : container.nodeValue.length + distance };
						}
					};

				return function() {
					// IE doesn't have range support (in the W3C way), so we
					// need to do some magic to transform selections into
					// CKEDITOR.dom.range instances.

					var sel = this.getNative(),
						nativeRange = sel && sel.createRange(),
						type = this.getType(),
						range;

					if ( !sel )
						return [];

					if ( type == CKEDITOR.SELECTION_TEXT ) {
						range = new CKEDITOR.dom.range( this.root );

						var boundaryInfo = getBoundaryInformation( nativeRange, true );
						range.setStart( new CKEDITOR.dom.node( boundaryInfo.container ), boundaryInfo.offset );

						boundaryInfo = getBoundaryInformation( nativeRange );
						range.setEnd( new CKEDITOR.dom.node( boundaryInfo.container ), boundaryInfo.offset );

						// Correct an invalid IE range case on empty list item. (#5850)
						if ( range.endContainer.getPosition( range.startContainer ) & CKEDITOR.POSITION_PRECEDING && range.endOffset <= range.startContainer.getIndex() ) {
							range.collapse();
						}

						return [ range ];
					} else if ( type == CKEDITOR.SELECTION_ELEMENT ) {
						var retval = [];

						for ( var i = 0; i < nativeRange.length; i++ ) {
							var element = nativeRange.item( i ),
								parentElement = element.parentNode,
								j = 0;

							range = new CKEDITOR.dom.range( this.root );

							for ( ; j < parentElement.childNodes.length && parentElement.childNodes[ j ] != element; j++ ) {
								/*jsl:pass*/
							}

							range.setStart( new CKEDITOR.dom.node( parentElement ), j );
							range.setEnd( new CKEDITOR.dom.node( parentElement ), j + 1 );
							retval.push( range );
						}

						return retval;
					}

					return [];
				};
			})() : function() {

					// On browsers implementing the W3C range, we simply
					// tranform the native ranges in CKEDITOR.dom.range
					// instances.

					var ranges = [],
						range,
						sel = this.getNative();

					if ( !sel )
						return ranges;

					for ( var i = 0; i < sel.rangeCount; i++ ) {
						var nativeRange = sel.getRangeAt( i );

						range = new CKEDITOR.dom.range( this.root );

						range.setStart( new CKEDITOR.dom.node( nativeRange.startContainer ), nativeRange.startOffset );
						range.setEnd( new CKEDITOR.dom.node( nativeRange.endContainer ), nativeRange.endOffset );
						ranges.push( range );
					}
					return ranges;
				};

			return function( onlyEditables ) {
				var cache = this._.cache;
				if ( cache.ranges && !onlyEditables )
					return cache.ranges;
				else if ( !cache.ranges )
					cache.ranges = new CKEDITOR.dom.rangeList( func.call( this ) );

				// Split range into multiple by read-only nodes.
				if ( onlyEditables ) {
					var ranges = cache.ranges;
					for ( var i = 0; i < ranges.length; i++ ) {
						var range = ranges[ i ];

						// Drop range spans inside one ready-only node.
						var parent = range.getCommonAncestor();
						if ( parent.isReadOnly() )
							ranges.splice( i, 1 );

						if ( range.collapsed )
							continue;

						// Range may start inside a non-editable element,
						// replace the range start after it.
						if ( range.startContainer.isReadOnly() ) {
							var current = range.startContainer;
							while ( current ) {
								if ( current.is( 'body' ) || !current.isReadOnly() )
									break;

								if ( current.type == CKEDITOR.NODE_ELEMENT && current.getAttribute( 'contentEditable' ) == 'false' )
									range.setStartAfter( current );

								current = current.getParent();
							}
						}

						var startContainer = range.startContainer,
							endContainer = range.endContainer,
							startOffset = range.startOffset,
							endOffset = range.endOffset,
							walkerRange = range.clone();

						// Enlarge range start/end with text node to avoid walker
						// being DOM destructive, it doesn't interfere our checking
						// of elements below as well.
						if ( startContainer && startContainer.type == CKEDITOR.NODE_TEXT ) {
							if ( startOffset >= startContainer.getLength() )
								walkerRange.setStartAfter( startContainer );
							else
								walkerRange.setStartBefore( startContainer );
						}

						if ( endContainer && endContainer.type == CKEDITOR.NODE_TEXT ) {
							if ( !endOffset )
								walkerRange.setEndBefore( endContainer );
							else
								walkerRange.setEndAfter( endContainer );
						}

						// Looking for non-editable element inside the range.
						var walker = new CKEDITOR.dom.walker( walkerRange );
						walker.evaluator = function( node ) {
							if ( node.type == CKEDITOR.NODE_ELEMENT && node.isReadOnly() ) {
								var newRange = range.clone();
								range.setEndBefore( node );

								// Drop collapsed range around read-only elements,
								// it make sure the range list empty when selecting
								// only non-editable elements.
								if ( range.collapsed )
									ranges.splice( i--, 1 );

								// Avoid creating invalid range.
								if ( !( node.getPosition( walkerRange.endContainer ) & CKEDITOR.POSITION_CONTAINS ) ) {
									newRange.setStartAfter( node );
									if ( !newRange.collapsed )
										ranges.splice( i + 1, 0, newRange );
								}

								return true;
							}

							return false;
						};

						walker.next();
					}
				}

				return cache.ranges;
			};
		})(),

		/**
		 * Gets the DOM element in which the selection starts.
		 *
		 *		var element = editor.getSelection().getStartElement();
		 *		alert( element.getName() );
		 *
		 * @returns {CKEDITOR.dom.element} The element at the beginning of the selection.
		 */
		getStartElement: function() {
			var cache = this._.cache;
			if ( cache.startElement !== undefined )
				return cache.startElement;

			var node;

			switch ( this.getType() ) {
				case CKEDITOR.SELECTION_ELEMENT:
					return this.getSelectedElement();

				case CKEDITOR.SELECTION_TEXT:

					var range = this.getRanges()[ 0 ];

					if ( range ) {
						if ( !range.collapsed ) {
							range.optimize();

							// Decrease the range content to exclude particial
							// selected node on the start which doesn't have
							// visual impact. ( #3231 )
							while ( 1 ) {
								var startContainer = range.startContainer,
									startOffset = range.startOffset;
								// Limit the fix only to non-block elements.(#3950)
								if ( startOffset == ( startContainer.getChildCount ? startContainer.getChildCount() : startContainer.getLength() ) && !startContainer.isBlockBoundary() )
									range.setStartAfter( startContainer );
								else
									break;
							}

							node = range.startContainer;

							if ( node.type != CKEDITOR.NODE_ELEMENT )
								return node.getParent();

							node = node.getChild( range.startOffset );

							if ( !node || node.type != CKEDITOR.NODE_ELEMENT )
								node = range.startContainer;
							else {
								var child = node.getFirst();
								while ( child && child.type == CKEDITOR.NODE_ELEMENT ) {
									node = child;
									child = child.getFirst();
								}
							}
						} else {
							node = range.startContainer;
							if ( node.type != CKEDITOR.NODE_ELEMENT )
								node = node.getParent();
						}

						node = node.$;
					}
			}

			return cache.startElement = ( node ? new CKEDITOR.dom.element( node ) : null );
		},

		/**
		 * Gets the currently selected element.
		 *
		 *		var element = editor.getSelection().getSelectedElement();
		 *		alert( element.getName() );
		 *
		 * @returns {CKEDITOR.dom.element} The selected element. Null if no
		 * selection is available or the selection type is not {@link CKEDITOR#SELECTION_ELEMENT}.
		 */
		getSelectedElement: function() {
			var cache = this._.cache;
			if ( cache.selectedElement !== undefined )
				return cache.selectedElement;

			var self = this;

			var node = CKEDITOR.tools.tryThese(
			// Is it native IE control type selection?
			function() {
				return self.getNative().createRange().item( 0 );
			},
			// If a table or list is fully selected.
			function() {
				var root, retval,
					range = self.getRanges()[ 0 ],
					ancestor = range.getCommonAncestor( 1, 1 ),
					tags = { table:1,ul:1,ol:1,dl:1 };

				for ( var t in tags ) {
					if ( ( root = ancestor.getAscendant( t, 1 ) ) )
						break;
				}

				if ( root ) {
					// Enlarging the start boundary.
					var testRange = new CKEDITOR.dom.range( self.root );
					testRange.setStartAt( root, CKEDITOR.POSITION_AFTER_START );
					testRange.setEnd( range.startContainer, range.startOffset );

					var enlargeables = CKEDITOR.tools.extend( tags, CKEDITOR.dtd.$listItem, CKEDITOR.dtd.$tableContent ),
						walker = new CKEDITOR.dom.walker( testRange ),
						// Check the range is at the inner boundary of the structural element.
						guard = function( walker, isEnd ) {
							return function( node, isWalkOut ) {
								if ( node.type == CKEDITOR.NODE_TEXT && ( !CKEDITOR.tools.trim( node.getText() ) || node.getParent().data( 'cke-bookmark' ) ) )
									return true;

								var tag;
								if ( node.type == CKEDITOR.NODE_ELEMENT ) {
									tag = node.getName();

									// Bypass bogus br at the end of block.
									if ( tag == 'br' && isEnd && node.equals( node.getParent().getBogus() ) )
										return true;

									if ( isWalkOut && tag in enlargeables || tag in CKEDITOR.dtd.$removeEmpty )
										return true;
								}

								walker.halted = 1;
								return false;
							};
						};

					walker.guard = guard( walker );

					if ( walker.checkBackward() && !walker.halted ) {
						walker = new CKEDITOR.dom.walker( testRange );
						testRange.setStart( range.endContainer, range.endOffset );
						testRange.setEndAt( root, CKEDITOR.POSITION_BEFORE_END );
						walker.guard = guard( walker, 1 );
						if ( walker.checkForward() && !walker.halted )
							retval = root.$;
					}
				}

				if ( !retval )
					throw 0;

				return retval;
			},
			// Figure it out by checking if there's a single enclosed
			// node of the range.
			function() {
				var range = self.getRanges()[ 0 ],
					enclosed, selected;

				// Check first any enclosed element, e.g. <ul>[<li><a href="#">item</a></li>]</ul>
				for ( var i = 2; i && !( ( enclosed = range.getEnclosedNode() ) && ( enclosed.type == CKEDITOR.NODE_ELEMENT ) && styleObjectElements[ enclosed.getName() ] && ( selected = enclosed ) ); i-- ) {
					// Then check any deep wrapped element, e.g. [<b><i><img /></i></b>]
					range.shrink( CKEDITOR.SHRINK_ELEMENT );
				}

				return selected.$;
			});

			return cache.selectedElement = ( node ? new CKEDITOR.dom.element( node ) : null );
		},

		/**
		 * Retrieves the text contained within the range. An empty string is returned for non-text selection.
		 *
		 *		var text = editor.getSelection().getSelectedText();
		 *		alert( text );
		 *
		 * @since 3.6.1
		 * @returns {String} A string of text within the current selection.
		 */
		getSelectedText: function() {
			var cache = this._.cache;
			if ( cache.selectedText !== undefined )
				return cache.selectedText;

			var nativeSel = this.getNative(),
				text = CKEDITOR.env.ie ? nativeSel.type == 'Control' ? '' : nativeSel.createRange().text : nativeSel.toString();

			return ( cache.selectedText = text );
		},

		/**
		 * Locks the selection made in the editor in order to make it possible to
		 * manipulate it without browser interference. A locked selection is
		 * cached and remains unchanged until it is released with the {@link #unlock} method.
		 *
		 *		editor.getSelection().lock();
		 */
		lock: function() {
			// Call all cacheable function.
			this.getRanges();
			this.getStartElement();
			this.getSelectedElement();
			this.getSelectedText();

			// The native selection is not available when locked.
			this._.cache.nativeSel = null;

			this.isLocked = 1;
		},

		/**
		 * @todo
		 */
		unlock: function( restore ) {
			if ( !this.isLocked )
				return;

			if ( restore ) {
				var selectedElement = this.getSelectedElement(),
					ranges = !selectedElement && this.getRanges();
			}

			this.isLocked = 0;
			this.reset();

			if ( restore ) {
				if ( selectedElement )
					this.selectElement( selectedElement );
				else
					this.selectRanges( ranges );
			}
		},

		/**
		 * Clears the selection cache.
		 *
		 *		editor.getSelection().reset();
		 */
		reset: function() {
			this._.cache = {};
		},

		/**
		 * Makes the current selection of type {@link CKEDITOR#SELECTION_ELEMENT} by enclosing the specified element.
		 *
		 *		var element = editor.document.getById( 'sampleElement' );
		 *		editor.getSelection.selectElement( element );
		 *
		 * @param {CKEDITOR.dom.element} element The element to enclose in the selection.
		 */
		selectElement: function( element ) {
			var range = new CKEDITOR.dom.range( this.root );
			range.setStartBefore( element );
			range.setEndAfter( element );
			this.selectRanges( [ range ] );
		},

		/**
		 * Clears the original selection and adds the specified ranges to the document selection.
		 *
		 *		var ranges = new CKEDITOR.dom.range( editor.document );
		 *		editor.getSelection().selectRanges( [ ranges ] );
		 *
		 * @param {Array} ranges An array of {@link CKEDITOR.dom.range} instances
		 * representing ranges to be added to the document.
		 */
		selectRanges: function( ranges ) {
			if ( !ranges.length )
				return;

			// Refresh the locked selection.
			if ( this.isLocked ) {
				// making a new DOM selection will force the focus on editable in certain situation,
				// we have to save the currently focused element for later recovery.
				var focused = CKEDITOR.document.getActive();
				this.unlock();
				this.selectRanges( ranges );
				this.lock();
				// Return to the previously focused element.
				!focused.equals( this.root ) && focused.focus();
				return;
			}

			if ( CKEDITOR.env.ie ) {
				var notWhitespaces = CKEDITOR.dom.walker.whitespaces( true ),
					fillerTextRegex = /\ufeff|\u00a0/,
					nonCells = { table:1,tbody:1,tr:1 };

				if ( ranges.length > 1 ) {
					// IE doesn't accept multiple ranges selection, so we join all into one.
					var last = ranges[ ranges.length - 1 ];
					ranges[ 0 ].setEnd( last.endContainer, last.endOffset );
				}

				var range = ranges[ 0 ];
				var collapsed = range.collapsed,
					isStartMarkerAlone, dummySpan, ieRange;

				// Try to make a object selection, be careful with selecting phase element in IE
				// will breaks the selection in non-framed environment.
				var selected = range.getEnclosedNode();
				if ( selected && selected.type == CKEDITOR.NODE_ELEMENT && selected.getName() in styleObjectElements && !( selected.is( 'a' ) && selected.getText() ) ) {
					try {
						ieRange = selected.$.createControlRange();
						ieRange.addElement( selected.$ );
						ieRange.select();
						return;
					} catch ( er ) {}
				}

				// IE doesn't support selecting the entire table row/cell, move the selection into cells, e.g.
				// <table><tbody><tr>[<td>cell</b></td>... => <table><tbody><tr><td>[cell</td>...
				if ( range.startContainer.type == CKEDITOR.NODE_ELEMENT && range.startContainer.getName() in nonCells || range.endContainer.type == CKEDITOR.NODE_ELEMENT && range.endContainer.getName() in nonCells ) {
					range.shrink( CKEDITOR.NODE_ELEMENT, true );
				}

				var bookmark = range.createBookmark();

				// Create marker tags for the start and end boundaries.
				var startNode = bookmark.startNode;

				var endNode;
				if ( !collapsed )
					endNode = bookmark.endNode;

				// Create the main range which will be used for the selection.
				ieRange = range.document.$.body.createTextRange();

				// Position the range at the start boundary.
				ieRange.moveToElementText( startNode.$ );
				ieRange.moveStart( 'character', 1 );

				if ( endNode ) {
					// Create a tool range for the end.
					var ieRangeEnd = range.document.$.body.createTextRange();

					// Position the tool range at the end.
					ieRangeEnd.moveToElementText( endNode.$ );

					// Move the end boundary of the main range to match the tool range.
					ieRange.setEndPoint( 'EndToEnd', ieRangeEnd );
					ieRange.moveEnd( 'character', -1 );
				} else {
					// The isStartMarkerAlone logic comes from V2. It guarantees that the lines
					// will expand and that the cursor will be blinking on the right place.
					// Actually, we are using this flag just to avoid using this hack in all
					// situations, but just on those needed.
					var next = startNode.getNext( notWhitespaces );
					var inPre = startNode.hasAscendant( 'pre' );
					isStartMarkerAlone = ( !( next && next.getText && next.getText().match( fillerTextRegex ) ) // already a filler there?
					&& ( inPre || !startNode.hasPrevious() || ( startNode.getPrevious().is && startNode.getPrevious().is( 'br' ) ) ) );

					// Append a temporary <span>&#65279;</span> before the selection.
					// This is needed to avoid IE destroying selections inside empty
					// inline elements, like <b></b> (#253).
					// It is also needed when placing the selection right after an inline
					// element to avoid the selection moving inside of it.
					dummySpan = range.document.createElement( 'span' );
					dummySpan.setHtml( '&#65279;' ); // Zero Width No-Break Space (U+FEFF). See #1359.
					dummySpan.insertBefore( startNode );

					if ( isStartMarkerAlone ) {
						// To expand empty blocks or line spaces after <br>, we need
						// instead to have any char, which will be later deleted using the
						// selection.
						// \ufeff = Zero Width No-Break Space (U+FEFF). (#1359)
						range.document.createText( '\ufeff' ).insertBefore( startNode );
					}
				}

				// Remove the markers (reset the position, because of the changes in the DOM tree).
				range.setStartBefore( startNode );
				startNode.remove();

				if ( collapsed ) {
					if ( isStartMarkerAlone ) {
						// Move the selection start to include the temporary \ufeff.
						ieRange.moveStart( 'character', -1 );

						ieRange.select();

						// Remove our temporary stuff.
						range.document.$.selection.clear();
					} else
						ieRange.select();

					range.moveToPosition( dummySpan, CKEDITOR.POSITION_BEFORE_START );
					dummySpan.remove();
				} else {
					range.setEndBefore( endNode );
					endNode.remove();
					ieRange.select();
				}
			} else {
				var sel = this.getNative();

				// getNative() returns null if iframe is "display:none" in FF. (#6577)
				if ( !sel )
					return;

				sel.removeAllRanges();

				for ( var i = 0; i < ranges.length; i++ ) {
					// Joining sequential ranges introduced by
					// readonly elements protection.
					if ( i < ranges.length - 1 ) {
						var left = ranges[ i ],
							right = ranges[ i + 1 ],
							between = left.clone();
						between.setStart( left.endContainer, left.endOffset );
						between.setEnd( right.startContainer, right.startOffset );

						// Don't confused by Firefox adjancent multi-ranges
						// introduced by table cells selection.
						if ( !between.collapsed ) {
							between.shrink( CKEDITOR.NODE_ELEMENT, true );
							var ancestor = between.getCommonAncestor(),
								enclosed = between.getEnclosedNode();

							// The following cases has to be considered:
							// 1. <span contenteditable="false">[placeholder]</span>
							// 2. <input contenteditable="false"  type="radio"/> (#6621)
							if ( ancestor.isReadOnly() || enclosed && enclosed.isReadOnly() ) {
								right.setStart( left.startContainer, left.startOffset );
								ranges.splice( i--, 1 );
								continue;
							}
						}
					}

					range = ranges[ i ];

					var nativeRange = this.document.$.createRange();
					var startContainer = range.startContainer;

					// In FF2, if we have a collapsed range, inside an empty
					// element, we must add something to it otherwise the caret
					// will not be visible.
					// In Opera instead, the selection will be moved out of the
					// element. (#4657)
					if ( range.collapsed && ( CKEDITOR.env.opera || ( CKEDITOR.env.gecko && CKEDITOR.env.version < 10900 ) ) && startContainer.type == CKEDITOR.NODE_ELEMENT && !startContainer.getChildCount() ) {
						startContainer.appendText( '' );
					}

					if ( range.collapsed && CKEDITOR.env.webkit && rangeRequiresFix( range ) ) {
						// Append a zero-width space so WebKit will not try to
						// move the selection by itself (#1272).
						var fillingChar = createFillingChar( this.root );
						range.insertNode( fillingChar );

						next = fillingChar.getNext();

						// If the filling char is followed by a <br>, whithout
						// having something before it, it'll not blink.
						// Let's remove it in this case.
						if ( next && !fillingChar.getPrevious() && next.type == CKEDITOR.NODE_ELEMENT && next.getName() == 'br' ) {
							removeFillingChar( this.root );
							range.moveToPosition( next, CKEDITOR.POSITION_BEFORE_START );
						} else
							range.moveToPosition( fillingChar, CKEDITOR.POSITION_AFTER_END );
					}

					nativeRange.setStart( range.startContainer.$, range.startOffset );

					try {
						nativeRange.setEnd( range.endContainer.$, range.endOffset );
					} catch ( e ) {
						// There is a bug in Firefox implementation (it would be too easy
						// otherwise). The new start can't be after the end (W3C says it can).
						// So, let's create a new range and collapse it to the desired point.
						if ( e.toString().indexOf( 'NS_ERROR_ILLEGAL_VALUE' ) >= 0 ) {
							range.collapse( 1 );
							nativeRange.setEnd( range.endContainer.$, range.endOffset );
						} else
							throw e;
					}

					// Select the range.
					sel.addRange( nativeRange );
				}
			}

			// Fakes the IE DOM event "selectionchange" on editable.
			this.root.fire( 'selectionchange' );
			this.reset();

		},

		/**
		 * Creates a bookmark for each range of this selection (from {@link #getRanges})
		 * by calling the {@link CKEDITOR.dom.range#createBookmark} method,
		 * with extra care taken to avoid interference among those ranges. The arguments
		 * received are the same as with the underlying range method.
		 *
		 *		var bookmarks = editor.getSelection().createBookmarks();
		 *
		 * @returns {Array} Array of bookmarks for each range.
		 */
		createBookmarks: function( serializable ) {
			return this.getRanges().createBookmarks( serializable );
		},

		/**
		 * Creates a bookmark for each range of this selection (from {@link #getRanges})
		 * by calling the {@link CKEDITOR.dom.range#createBookmark2} method,
		 * with extra care taken to avoid interference among those ranges. The arguments
		 * received are the same as with the underlying range method.
		 *
		 *		var bookmarks = editor.getSelection().createBookmarks2();
		 *
		 * @returns {Array} Array of bookmarks for each range.
		 */
		createBookmarks2: function( normalized ) {
			return this.getRanges().createBookmarks2( normalized );
		},

		/**
		 * Selects the virtual ranges denoted by the bookmarks by calling {@link #selectRanges}.
		 *
		 *		var bookmarks = editor.getSelection().createBookmarks();
		 *		editor.getSelection().selectBookmarks( bookmarks );
		 *
		 * @param {Array} bookmarks The bookmarks representing ranges to be selected.
		 * @returns {CKEDITOR.dom.selection} This selection object, after the ranges were selected.
		 */
		selectBookmarks: function( bookmarks ) {
			var ranges = [];
			for ( var i = 0; i < bookmarks.length; i++ ) {
				var range = new CKEDITOR.dom.range( this.root );
				range.moveToBookmark( bookmarks[ i ] );
				ranges.push( range );
			}
			this.selectRanges( ranges );
			return this;
		},

		/**
		 * Retrieves the common ancestor node of the first range and the last range.
		 *
		 *		var ancestor = editor.getSelection().getCommonAncestor();
		 *
		 * @returns {CKEDITOR.dom.element} The common ancestor of the selection.
		 */
		getCommonAncestor: function() {
			var ranges = this.getRanges(),
				startNode = ranges[ 0 ].startContainer,
				endNode = ranges[ ranges.length - 1 ].endContainer;
			return startNode.getCommonAncestor( endNode );
		},

		/**
		 * Moves the scrollbar to the starting position of the current selection.
		 *
		 *		editor.getSelection().scrollIntoView();
		 */
		scrollIntoView: function() {

			// Scrolls the first range into view.
			if ( this.type != CKEDITOR.SELECTION_NONE )
				this.getRanges()[ 0 ].scrollIntoView();
		},

		/**
		 * Remove all the selection ranges from the document.
		 */
		removeAllRanges: function() {
			var nativ = this.getNative();

			nativ && nativ[ nativ.removeAllRanges ? 'removeAllRanges' : 'empty' ]();

			this.reset();
		}
	};

})();
