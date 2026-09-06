/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { timeout } from '../../../../../base/common/async.js';
import { mainWindow } from '../../../../../base/browser/window.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { ILivingDocRenderInput, renderLivingDocHtml } from '../../browser/livingDocRender.js';
import { parseLivingDoc } from '../../common/livingDocMarkdown.js';

// #320 - a brand-new blank document could not be typed into at all: the editor mount (`.ProseMirror`)
// computed to 0px wide, so there was nothing to click into and nowhere for a caret to go. The regression
// was EMPTY-ONLY: the reading column was a shrink-to-fit flex item, so any document with content sized it
// and masked the fault.
//
// Seam S4 (the assembled surface + its DOM): the webview document the editor actually sets - the same
// stylesheet, the same markup, the same vendored ProseMirror bundle and the same runtime that mounts it -
// is written into a real iframe and MEASURED. The one thing faked is the webview host API the runtime asks
// for on load (`acquireVsCodeApi`), which is the host boundary itself; the fake records what the surface
// posts back, so "the document accepts typing" is asserted on the `pmEdit` payload that would reach the
// host and be saved, not on a DOM guess.
suite('livingDocs blank document (#320)', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	/** The harness viewport. Wide enough that the reading column is never merely a narrow-viewport artefact. */
	const HARNESS_WIDTH = 1200;
	const HARNESS_HEIGHT = 800;

	interface IPostedMessage { readonly type?: string; readonly text?: string }

	/** The subset of the webview host API the ProseMirror runtime looks up on load: it posts edits back to
	 *  the host and reads/writes an opaque per-view state. The fake stands in for the real host boundary. */
	interface IWebviewHostApi {
		postMessage(message: IPostedMessage): void;
		getState(): undefined;
		setState(state: unknown): void;
	}

	interface IBlankSurface {
		/** The `.ProseMirror` editor mount - the surface a writer clicks into. */
		readonly mount: HTMLElement;
		/** The reading column (`#pm-root`) the mount lives in. */
		readonly column: HTMLElement;
		readonly view: Window;
		readonly posted: readonly IPostedMessage[];
		dispose(): void;
	}

	async function until<T>(what: string, probe: () => T | undefined | null | false): Promise<T> {
		const deadline = Date.now() + 5000;
		while (true) {
			const value = probe();
			if (value) {
				return value;
			}
			if (Date.now() > deadline) {
				throw new Error(`timed out waiting for ${what}`);
			}
			await timeout(10);
		}
	}

	/** Mount the real editor webview document for `rawText` (empty = a brand-new blank document). */
	async function mountDocument(rawText: string): Promise<IBlankSurface> {
		const doc = parseLivingDoc(rawText);
		const input: ILivingDocRenderInput = {
			doc, pending: [], resolved: new Map(), dirty: false, status: '',
			recent: new Set(), mode: 'pm', rawText, present: { open: false, choice: 'html' }, syncDiff: [],
		};
		const html = renderLivingDocHtml(input);

		const frame = mainWindow.document.createElement('iframe');
		frame.style.width = `${HARNESS_WIDTH}px`;
		frame.style.height = `${HARNESS_HEIGHT}px`;
		frame.style.border = '0';
		mainWindow.document.body.appendChild(frame);

		// From here on the iframe is live in the test document, so every exit takes it back out with it - a
		// mount that never arrives must not leave a webview behind for the suites that follow.
		try {
			const view = frame.contentWindow;
			assert.ok(view, 'the harness iframe has a window');

			const posted: IPostedMessage[] = [];
			// The webview host API, injected before the document is written so the runtime finds it on load.
			(view as Window & { acquireVsCodeApi?: () => IWebviewHostApi }).acquireVsCodeApi = () => ({
				postMessage: (message: IPostedMessage) => { posted.push(message); },
				getState: () => undefined,
				setState: () => undefined,
			});

			const frameDoc = view.document;
			frameDoc.open();
			frameDoc.write(html);
			frameDoc.close();

			const mount = await until('the ProseMirror editor to mount', () => frameDoc.querySelector<HTMLElement>('#pm-root .ProseMirror'));
			const column = frameDoc.querySelector<HTMLElement>('#pm-root');
			assert.ok(column, 'the reading column is in the surface');
			return { mount, column, view, posted, dispose: () => frame.remove() };
		} catch (err) {
			frame.remove();
			throw err;
		}
	}

	/** The Y inset from the top of the document surface at which a writer's first click lands - inside the
	 *  first line rather than on the surface's very edge. */
	const DOCUMENT_CLICK_INSET_Y = 24;

	/** The element the pointer hits when a writer clicks near the top-centre of the document surface. A surface
	 *  with no width has nothing there - which is the whole of #320 - so whether this lands in the mount is the
	 *  question both the "clickable" test and typing turn on. */
	function elementAtDocumentClick(surface: IBlankSurface): Element | null {
		const box = surface.mount.getBoundingClientRect();
		return surface.view.document.elementFromPoint(box.left + box.width / 2, box.top + DOCUMENT_CLICK_INSET_Y);
	}

	/** Type `text` the way a writer does: click into the document where it is drawn, then insert text. */
	function type(surface: IBlankSurface, text: string): void {
		const frameDoc = surface.view.document;
		// The caret is placed where the pointer lands, never at an element the writer could not have reached:
		// a surface with no width is a surface with nothing to click into, and typing must fail with it.
		const hit = elementAtDocumentClick(surface);
		assert.ok(hit && surface.mount.contains(hit), 'the writer can click into the document to place a caret');
		const target = hit;
		const range = frameDoc.createRange();
		range.selectNodeContents(target);
		range.collapse(true);
		const selection = surface.view.getSelection();
		assert.ok(selection, 'the surface has a selection');
		selection.removeAllRanges();
		selection.addRange(range);
		surface.mount.focus();
		frameDoc.execCommand('insertText', false, text);
	}

	test('#320: an EMPTY document mounts an editor surface with a non-zero computed width', async () => {
		const surface = await mountDocument('');
		try {
			const mountWidth = parseFloat(surface.view.getComputedStyle(surface.mount).width);
			const columnWidth = parseFloat(surface.view.getComputedStyle(surface.column).width);
			assert.ok(mountWidth > 0, `the empty document's editor surface must have width, got ${mountWidth}px`);
			assert.ok(columnWidth > 0, `the empty document's reading column must have width, got ${columnWidth}px`);
			// It is not merely non-zero: an empty document opens on the SAME reading column a document with
			// content gets, so the writer's first line lands where every later line will.
			const withContent = await mountDocument('Some prose already on the page.\n');
			try {
				assert.deepStrictEqual(
					surface.view.getComputedStyle(surface.mount).width,
					withContent.view.getComputedStyle(withContent.mount).width,
					'an empty document gets the same reading measure as one with content',
				);
			} finally {
				withContent.dispose();
			}
		} finally {
			surface.dispose();
		}
	});

	test('#320: the centre of an empty document is clickable - the editor surface is what the pointer hits', async () => {
		const surface = await mountDocument('');
		try {
			const hit = elementAtDocumentClick(surface);
			assert.ok(hit && surface.mount.contains(hit), 'clicking the middle of a blank document lands in the editor');
		} finally {
			surface.dispose();
		}
	});

	test('#320: a brand-new blank document accepts typing', async () => {
		const surface = await mountDocument('');
		try {
			type(surface, 'Hello');
			// The proof is what the surface sends the host to save, not just what the DOM shows: ProseMirror
			// took the keystrokes into its state and serialised them back to Markdown.
			const edit = await until('the typed text to reach the host as a pmEdit', () =>
				surface.posted.find(m => m.type === 'pmEdit' && (m.text ?? '').includes('Hello')));
			assert.ok(edit.text?.includes('Hello'), 'the typed text round-trips to Markdown');
			assert.ok(surface.mount.textContent?.includes('Hello'), 'the typed text stays on the editing surface');
		} finally {
			surface.dispose();
		}
	});
});
