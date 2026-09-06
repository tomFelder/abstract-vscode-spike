/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import {
	applyFocusRequest, applyReady, applyRender, applyRevealBlock, applyRevealHeading, EditorWebviewEffect, IEditorRenderContent,
	initialEditorWebviewState, recordPmBody,
} from '../../common/editorWebviewProtocol.js';

// The document editor's mount-once-then-message webview lifecycle (plan 30, track 4, the P2-3 debt). These
// tests cover the exact timing-sensitive cases the plan calls out - pmReset ordering, a render that arrives
// while the webview is not ready, and focus-after-navigate - directly against the pure reducer, with no DOM
// or webview. The editor host is now a thin shell that just carries these effects out.

const content = (html: string, pmMd: string | null): IEditorRenderContent => ({ html, pmMd, pmDeco: null });
const kinds = (effects: readonly EditorWebviewEffect[]) => effects.map(e => e.kind);

suite('livingDocs editorWebviewProtocol (plan 30, track 4)', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('the first render sets the shell HTML once (setHtml), never a postRender', () => {
		const step = applyRender(initialEditorWebviewState(), content('<shell/>', 'body one'));
		assert.deepStrictEqual(kinds(step.effects), ['setHtml'], 'the first render sets the shell once');
		assert.strictEqual(step.state.initialized, true, 'initialized flips true after the first render');
		assert.strictEqual(step.state.pmBody, 'body one', 'the first render records the mounted body');
	});

	test('a render before the webview is ready is HELD, and flushed on ready with NO pmReset', () => {
		// First render mounts the shell; a second render arrives before the RUNTIME signals ready.
		let s = applyRender(initialEditorWebviewState(), content('<shell/>', 'body one')).state;
		const held = applyRender(s, content('<updated/>', 'body two'));
		assert.deepStrictEqual(kinds(held.effects), ['holdPending'], 'the pre-ready render is held, not posted');
		assert.ok(held.state.pendingContent, 'the held content is carried in state');
		s = held.state;

		// The RUNTIME signals ready: the held render is flushed, and it must NOT carry a pmReset (it is the
		// body the surface is mounting with, not a change to a live surface).
		const ready = applyReady(s);
		assert.deepStrictEqual(kinds(ready.effects), ['postRender'], 'ready flushes exactly the held render');
		const posted = ready.effects[0];
		assert.ok(posted.kind === 'postRender' && posted.pmReset === undefined, 'the flushed render carries no pmReset');
		assert.strictEqual(ready.state.pendingContent, undefined, 'the held content is cleared once flushed');
		assert.strictEqual(ready.state.ready, true, 'ready flips true');
	});

	test('a model-driven body change after ready posts a pmReset; a chrome-only render does not', () => {
		let s = applyRender(initialEditorWebviewState(), content('<shell/>', 'the original body')).state;
		s = applyReady(s).state;

		// A render whose body changed (an approved change landed) resets the live PM surface to disk truth.
		const changed = applyRender(s, content('<updated/>', 'the rewritten body'));
		const c = changed.effects[0];
		assert.ok(c.kind === 'postRender' && c.pmReset === 'the rewritten body', 'a model-driven body change resets the surface');
		s = changed.state;

		// A chrome-only render (same body - e.g. a modal opened) must NOT reset the surface (no lost cursor).
		const chrome = applyRender(s, content('<modal/>', 'the rewritten body'));
		const cc = chrome.effects[0];
		assert.ok(cc.kind === 'postRender' && cc.pmReset === undefined, 'an unchanged body does not reset the surface');
	});

	test('the user\'s own typing (recordPmBody) suppresses a spurious pmReset on the next render', () => {
		let s = applyRender(initialEditorWebviewState(), content('<shell/>', 'first')).state;
		s = applyReady(s).state;
		// The user types; the pmEdit handler records the body the live surface now holds.
		s = recordPmBody(s, 'the user just typed this');
		// The next (non-typing) render carries that same body - it must NOT reset the surface out from under
		// the user's cursor. This is the exact regression the reducer guards against.
		const next = applyRender(s, content('<rerender/>', 'the user just typed this'));
		const e = next.effects[0];
		assert.ok(e.kind === 'postRender' && e.pmReset === undefined, 'a render matching the just-typed body does not remount');
	});

	test('a render with no PM body (pmMd null) clears the tracked body so the next real body resets', () => {
		let s = applyRender(initialEditorWebviewState(), content('<shell/>', 'a body')).state;
		s = applyReady(s).state;
		// A pmMd-null render (e.g. the raw-source mode) clears the tracked body.
		s = applyRender(s, content('<raw/>', null)).state;
		assert.strictEqual(s.pmBody, undefined, 'a null-body render clears the tracked body');
		// Returning to a PM body then resets (there is no prior body to compare, so no reset on the first).
		const back = applyRender(s, content('<pm/>', 'a body'));
		const e = back.effects[0];
		assert.ok(e.kind === 'postRender' && e.pmReset === undefined, 'the first PM body after a null render mounts without a reset');
	});

	test('a focus request BEFORE ready is held and flushed on ready (focus-after-navigate)', () => {
		// The rail asks to focus a change before the webview signalled ready (the body is not live yet).
		let s = applyRender(initialEditorWebviewState(), content('<shell/>', 'body')).state;
		const focus = applyFocusRequest(s, 'change-7');
		assert.deepStrictEqual(kinds(focus.effects), [], 'a pre-ready focus request posts nothing yet');
		assert.strictEqual(focus.state.pendingFocusChangeId, 'change-7', 'the focus target is held');
		s = focus.state;

		// On ready the held focus is flushed once the body (with its inline-diff decorations) is live.
		const ready = applyReady(s);
		assert.deepStrictEqual(kinds(ready.effects), ['postFocus'], 'ready flushes the held focus target');
		const posted = ready.effects[0];
		assert.ok(posted.kind === 'postFocus' && posted.id === 'change-7', 'the right change id is focused');
		assert.strictEqual(ready.state.pendingFocusChangeId, undefined, 'the focus target is cleared once flushed');
	});

	test('a focus request AFTER ready is posted immediately', () => {
		let s = applyRender(initialEditorWebviewState(), content('<shell/>', 'body')).state;
		s = applyReady(s).state;
		const focus = applyFocusRequest(s, 'change-9');
		assert.deepStrictEqual(kinds(focus.effects), ['postFocus'], 'a ready webview focuses immediately');
		const posted = focus.effects[0];
		assert.ok(posted.kind === 'postFocus' && posted.id === 'change-9', 'the right change id is focused');
	});

	test('ready flushes BOTH a held render and a held focus target, render first', () => {
		// A render and a focus request both raced ahead of ready; on ready the render lands, then the focus.
		let s = applyRender(initialEditorWebviewState(), content('<shell/>', 'first')).state;
		s = applyRender(s, content('<held/>', 'second')).state;   // held (not ready)
		s = applyFocusRequest(s, 'change-3').state;                 // held (not ready)
		const ready = applyReady(s);
		assert.deepStrictEqual(kinds(ready.effects), ['postRender', 'postFocus'], 'the body lands before the focus scrolls to it');
	});

	test('a ready with nothing pending is a no-op beyond flipping ready', () => {
		const s = applyRender(initialEditorWebviewState(), content('<shell/>', 'body')).state;
		const ready = applyReady(s);
		assert.deepStrictEqual(kinds(ready.effects), [], 'nothing to flush');
		assert.strictEqual(ready.state.ready, true, 'ready flips true');
	});

	test('an Outline reveal-heading request is held before ready and flushed on ready, or posted immediately after ready (issue #181)', () => {
		// Before ready: held (the headings must be laid out before one can be scrolled to), then flushed.
		const held = applyRender(initialEditorWebviewState(), content('<shell/>', 'body')).state; // initialized, not ready
		const beforeReady = applyRevealHeading(held, 2);
		assert.deepStrictEqual(kinds(beforeReady.effects), [], 'a reveal before ready posts nothing yet');
		assert.strictEqual(beforeReady.state.pendingRevealHeadingIndex, 2, 'the heading target is held');
		const flushed = applyReady(beforeReady.state);
		const heldPosted = flushed.effects.find(e => e.kind === 'postRevealHeading');
		assert.ok(heldPosted && heldPosted.kind === 'postRevealHeading' && heldPosted.headingIndex === 2, 'ready flushes the held heading');
		assert.strictEqual(flushed.state.pendingRevealHeadingIndex, undefined, 'the heading target is cleared once flushed');

		// After ready: posted immediately.
		const afterReady = applyRevealHeading(applyReady(held).state, 5);
		const nowPosted = afterReady.effects.find(e => e.kind === 'postRevealHeading');
		assert.ok(nowPosted && nowPosted.kind === 'postRevealHeading' && nowPosted.headingIndex === 5, 'a ready webview reveals immediately');
	});

	test('a Home reveal-block deep link is held before ready and flushed on ready, or posted immediately after ready (plan 48 H2.3u)', () => {
		// Before ready: held (the blocks must be laid out before one can be scrolled to), then flushed.
		const held = applyRender(initialEditorWebviewState(), content('<shell/>', 'body')).state; // initialized, not ready
		const beforeReady = applyRevealBlock(held, 3);
		assert.deepStrictEqual(kinds(beforeReady.effects), [], 'a reveal before ready posts nothing yet');
		assert.strictEqual(beforeReady.state.pendingRevealBlockIndex, 3, 'the block target is held');
		const flushed = applyReady(beforeReady.state);
		const heldPosted = flushed.effects.find(e => e.kind === 'postRevealBlock');
		assert.ok(heldPosted && heldPosted.kind === 'postRevealBlock' && heldPosted.blockIndex === 3, 'ready flushes the held block');
		assert.strictEqual(flushed.state.pendingRevealBlockIndex, undefined, 'the block target is cleared once flushed');

		// After ready: posted immediately. A -1 index (a deleted block, spec section 3.1) still flows through as-is; the
		// webview no-ops the scroll, so the doc + Review tab are open without an error.
		const afterReady = applyRevealBlock(applyReady(held).state, -1);
		const nowPosted = afterReady.effects.find(e => e.kind === 'postRevealBlock');
		assert.ok(nowPosted && nowPosted.kind === 'postRevealBlock' && nowPosted.blockIndex === -1, 'a ready webview reveals immediately; a deleted block passes -1');
	});
});
