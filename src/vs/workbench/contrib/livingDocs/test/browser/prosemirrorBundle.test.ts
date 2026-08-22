/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { decodeBase64 } from '../../../../../base/common/buffer.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { PROSEMIRROR_BUNDLE_BASE64 } from '../../browser/prosemirrorBundle.js';
import { IBlockGutterEntry } from '../../common/livingDocAddress.js';
import { parseLivingDoc } from '../../common/livingDocMarkdown.js';
import { buildPmDecorationSpec } from '../../common/livingDocPmDecorations.js';
import { ILivingDoc, IProposedChange } from '../../common/livingDocsModel.js';

// A minimal handle on the live ProseMirror view - enough to drive edits and read the doc back in a test
// without pulling PM's own types (the bundle is a base64 artifact, not an importable module).
interface ILwdpmView {
	state: { doc: { textContent: string; content: { size: number }; nodeSize: number }; tr: unknown };
	dom: HTMLElement;
	dispatch(tr: unknown): void;
	destroy(): void;
}

// The surface the vendored bundle exposes. The bundle is the SAME artifact shipped into the webview
// (decision 43/46); we exercise it directly so the test proves the real bound-figure node + Markdown
// serialize/parse (and, in the DOM tests, the real history plugin), not a re-implementation.
interface ILwdpmTestSurface {
	roundTrip(markdown: string): string;
	docJSON(markdown: string): unknown;
	mount(parent: HTMLElement, markdown: string, options?: { onChange?: () => void; editable?: boolean }): ILwdpmView;
	toMarkdown(view: ILwdpmView): string;
	cmd(view: ILwdpmView, name: string): boolean;
	setDoc(view: ILwdpmView, markdown: string): void;
	setDecorations(view: ILwdpmView, spec: IPmDecoTestPayload): void;
	destroy(view: ILwdpmView): void;
}

// The decoration payload the host pushes (`livingDocRender.ts`'s `IPmDecoPayload`): the pure spec plus the
// host-rendered widget HTML per change. Restated here for the same reason the view handle is - the bundle is
// a base64 artifact, so the test cannot import the shapes it is handed.
interface IPmDecoTestPayload {
	readonly edits: readonly { readonly id: string; readonly blockOrdinal?: number; readonly anchorText: string; readonly html: string }[];
	readonly inserts: readonly unknown[];
	readonly gutters: readonly unknown[];
	readonly numbers: readonly IBlockGutterEntry[];
}

// Decode + evaluate the vendored IIFE once. It assigns `window.LWDPM`; we hand it a plain object as
// `window` so it never touches the real global. The headless helpers (`roundTrip`/`docJSON`) only use
// the Markdown parser/serializer; the DOM helpers (`mount`/`setDoc`/`cmd`) use the real `document`,
// which is present in this browser test environment.
function loadLwdpm(): ILwdpmTestSurface {
	const code = decodeBase64(PROSEMIRROR_BUNDLE_BASE64).toString();
	const sandbox: { LWDPM?: ILwdpmTestSurface } = {};
	new Function('window', code)(sandbox);
	if (!sandbox.LWDPM) {
		throw new Error('vendored ProseMirror bundle did not define window.LWDPM');
	}
	return sandbox.LWDPM;
}

suite('ProseMirror vendored bundle (LWDPM)', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	const lwdpm = loadLwdpm();

	test('a bound figure parses to a bound_figure node and round-trips to [label](bind:key)', () => {
		const md = 'Revenue reached [49,800](bind:metrics.mrr.latest) this quarter.';

		// The figure is a first-class atom node (decision 46) carrying the resolved label + its key,
		// sitting inline between the surrounding text runs - not a stripped link or plain text.
		// (Normalize through JSON: ProseMirror's toJSON gives attrs a null prototype.)
		const json = JSON.parse(JSON.stringify(lwdpm.docJSON(md)));
		assert.deepStrictEqual(json, {
			type: 'doc',
			content: [{
				type: 'paragraph',
				content: [
					{ type: 'text', text: 'Revenue reached ' },
					{ type: 'bound_figure', attrs: { label: '49,800', key: 'metrics.mrr.latest' } },
					{ type: 'text', text: ' this quarter.' }
				]
			}]
		});

		// And it serializes back byte-identically (the on-disk round-trip the keystone needs).
		assert.strictEqual(lwdpm.roundTrip(md).trim(), md);
	});

	test('plain Markdown (heading, emphasis, list) round-trips unchanged', () => {
		const md = '# Heading\n\nA paragraph with **bold** and *italic*.\n\n* one\n* two';
		assert.strictEqual(lwdpm.roundTrip(md).trim(), md.trim());
	});

	test('a normal link stays a normal link (only bind: links become figures)', () => {
		const md = 'Growth of [12%](bind:metrics.growth) beside a [real link](https://example.com).';
		const json = JSON.stringify(lwdpm.docJSON(md));
		// Exactly one bound_figure (the bind: link); the http link is preserved as a link mark.
		assert.strictEqual(json.split('"bound_figure"').length - 1, 1);
		assert.ok(json.includes('https://example.com'), 'normal link href should survive');
		assert.strictEqual(lwdpm.roundTrip(md).trim(), md);
	});

	// --- [[Wikilinks]] (plan 52 WP-C, decision 179) ------------------------------
	// These pin the bundle rebuild's whole reason for existing. Before it, prosemirror-markdown's text
	// serializer escaped the brackets, so a wikilink typed into the editor reached disk as
	// `\[\[Doc Name\]\]` and the file stopped being Obsidian-compatible on the very first save.
	suite('wikilinks', () => {

		test('a wikilink parses to a wikilink node and round-trips to exactly [[Doc Name]]', () => {
			const md = 'See [[Team Notes]] and [[Q3 Plan|the plan]] for detail.';
			assert.deepStrictEqual(JSON.parse(JSON.stringify(lwdpm.docJSON(md))), {
				type: 'doc',
				content: [{
					type: 'paragraph',
					content: [
						{ type: 'text', text: 'See ' },
						{ type: 'wikilink', attrs: { target: 'Team Notes', alias: '' } },
						{ type: 'text', text: ' and ' },
						{ type: 'wikilink', attrs: { target: 'Q3 Plan', alias: 'the plan' } },
						{ type: 'text', text: ' for detail.' }
					]
				}]
			});
			assert.strictEqual(lwdpm.roundTrip(md).trim(), md);
		});

		test('[[ inside code is inert, and an escaped [[ stays literal', () => {
			// The rule is an INLINE rule, so a fence's raw content never reaches it and the earlier
			// `backticks` / `escape` rules claim their spans first. All three must round-trip untouched
			// AND contain no wikilink node - a code sample that silently became a link would be a defect.
			const cases = [
				'```\nnot a link: [[Team Notes]]\n```',
				'Inline `[[Team Notes]]` stays code.',
				'Escaped \\[\\[Team Notes\\]\\] stays literal.',
			];
			assert.deepStrictEqual(cases.map(md => ({
				roundTrips: lwdpm.roundTrip(md).trim() === md.trim(),
				hasNode: JSON.stringify(lwdpm.docJSON(md)).includes('"wikilink"'),
			})), [
				{ roundTrips: true, hasNode: false },
				{ roundTrips: true, hasNode: false },
				{ roundTrips: true, hasNode: false },
			]);
		});

		test('wikilinks coexist with bind: figures and {{slot}} tokens, in prose, lists and headings', () => {
			// The heading case also guards a data-loss bug this work found: upstream's heading content
			// expression is `(text | image)*`, so ANY inline atom made the parser drop the heading and
			// collapse the whole document to an empty paragraph - already true on main for bind: links.
			const md = '## Q3 [[Team Notes]] and [49,800](bind:metrics.mrr)\n\n'
				+ 'Prose with [[Q3 Plan]], a slot {{customer}} and [12%](bind:metrics.growth).\n\n'
				+ '* A list item linking [[Team Notes]]\n* Second item';
			assert.deepStrictEqual({
				roundTrip: lwdpm.roundTrip(md).trim(),
				wikilinkCount: JSON.stringify(lwdpm.docJSON(md)).split('"wikilink"').length - 1,
				figureCount: JSON.stringify(lwdpm.docJSON(md)).split('"bound_figure"').length - 1,
			}, {
				roundTrip: md,
				wikilinkCount: 3,
				figureCount: 2,
			});
		});
	});

	// --- Keystroke-level history (plan 26 iter 1) --------------------------------
	// These mount a real EditorView so they exercise the actual `history()` plugin + undo/redo commands
	// (not a re-implementation). They run in the browser test environment where `document` exists.
	suite('undo / redo history', () => {
		// Type into the live view the same way a keystroke does: an editable transaction, so the history
		// plugin records it. `tr` from the current state, insertText at the cursor, then dispatch.
		function typeAtEnd(view: ILwdpmView, text: string): void {
			const tr = view.state.tr as { insertText(text: string): unknown };
			view.dispatch(tr.insertText(text));
		}

		test('typing then undo removes it; redo restores it', () => {
			const parent = document.createElement('div');
			const view = lwdpm.mount(parent, 'Seed.', {});
			try {
				typeAtEnd(view, ' typed');
				assert.ok(lwdpm.toMarkdown(view).includes('typed'), 'the typed text should be present');

				assert.strictEqual(lwdpm.cmd(view, 'undo'), true, 'undo should apply');
				assert.ok(!lwdpm.toMarkdown(view).includes('typed'), 'undo should remove the typed text');

				assert.strictEqual(lwdpm.cmd(view, 'redo'), true, 'redo should apply');
				assert.ok(lwdpm.toMarkdown(view).includes('typed'), 'redo should restore the typed text');
			} finally {
				lwdpm.destroy(view);
			}
		});

		test('undo cannot cross a setDoc (service write): after setDoc, undo is a no-op', () => {
			// setDoc is the service-driven body reset after an approve/restore. It must recreate the
			// history so Cmd+Z can never silently revert an approved change without an audit entry.
			const parent = document.createElement('div');
			const view = lwdpm.mount(parent, 'Original body.', {});
			try {
				typeAtEnd(view, ' with a local edit');
				lwdpm.setDoc(view, 'Approved body from the service.');

				const before = lwdpm.toMarkdown(view);
				assert.strictEqual(lwdpm.cmd(view, 'undo'), false, 'undo must be a no-op after setDoc');
				assert.strictEqual(lwdpm.toMarkdown(view), before, 'the body must not change on the no-op undo');
			} finally {
				lwdpm.destroy(view);
			}
		});
	});

	// --- LivingDoc edit decorations mount by ordinal (docs/30 section 4.3, closes the #300 class) --------
	//
	// These mount a real EditorView and push a spec built by the REAL host builder, so what is asserted is
	// the shipped artifact placing the shipped spec - not a re-implementation of either. The two cases are
	// exactly the ones text-anchor placement lost silently: a list block (whose rendered `textContent` never
	// equals the item-scoped anchor the host diffs) and a block retyped after its change was proposed.
	suite('LivingDoc edit decorations (ordinal placement)', () => {
		// The host maps the pure spec to the webview payload by attaching each change's widget HTML
		// (`renderPmDeco`). A marked-up stub stands in for the real card: what is under test is WHERE the
		// widget lands, and a full card would only make the assertion harder to read.
		function payloadFor(doc: ILivingDoc, pending: readonly IProposedChange[]): IPmDecoTestPayload {
			const spec = buildPmDecorationSpec(doc, pending, new Set());
			return { ...spec, edits: spec.edits.map(e => ({ ...e, html: `<div data-editcard="${e.id}">card</div>` })) };
		}

		function mountWith(markdown: string, payload: IPmDecoTestPayload): { mountedCards: string[]; gutterNumbers: string[] } {
			const parent = document.createElement('div');
			const view = lwdpm.mount(parent, markdown, {});
			try {
				lwdpm.setDecorations(view, payload);
				return {
					mountedCards: Array.from(view.dom.querySelectorAll('[data-editcard]')).map(el => el.getAttribute('data-editcard') ?? ''),
					gutterNumbers: Array.from(view.dom.querySelectorAll('[data-lwd-num]')).map(el => el.getAttribute('data-lwd-num') ?? ''),
				};
			} finally {
				lwdpm.destroy(view);
			}
		}

		const LIST_MD = [
			'## Growth levers',
			'',
			'- Expand the free trial to thirty days',
			'- Win back recently churned accounts',
			'- Launch an annual billing plan',
		].join('\n') + '\n';

		test('a change to one item of a LIST block mounts its widget over that list', () => {
			const doc = parseLivingDoc(LIST_MD);
			const listBlock = doc.blocks.find(b => b.text.startsWith('- Expand'))!;
			const pending: IProposedChange[] = [{
				id: 'c-list', docId: 'doc', docTitle: 'Levers', blockId: listBlock.id, blockLabel: 'Growth levers',
				oldText: listBlock.text, newText: '- Win back recently churned accounts with a targeted campaign',
				kind: 'meaning', confidence: 0.8, rationale: '', sourceCells: [],
			}];

			// The widget mounts, the list node it replaced no longer carries a gutter number (the widget owns
			// that row), and the untouched heading keeps its own - the numbered gutter is unharmed.
			assert.deepStrictEqual(mountWith(LIST_MD, payloadFor(doc, pending)), { mountedCards: ['c-list'], gutterNumbers: ['1'] });
		});

		test('a block retyped after the change was proposed still mounts (the anchor no longer matches its own block)', () => {
			const before = 'Revenue grew fast this week.';
			const after = 'Revenue collapsed overnight, actually.';
			const md = `## Highlights\n\n${before}\n`;
			const drifted = parseLivingDoc(`## Highlights\n\n${after}\n`);
			const pending: IProposedChange[] = [{
				id: 'c-drift', docId: 'doc', docTitle: 'Weekly', blockId: drifted.blocks[1].id, blockLabel: 'Highlights',
				oldText: before, newText: 'Revenue dropped sharply this week.',
				kind: 'meaning', confidence: 0.8, rationale: '', sourceCells: [],
			}];
			const payload = payloadFor(drifted, pending);
			assert.strictEqual(payload.edits[0].anchorText, before, 'the anchor must be the stale text - that is what made this case fail');

			// Mounted against the DRIFTED document, whose second block no longer reads like the anchor.
			assert.deepStrictEqual(mountWith(md.replace(before, after), payload), { mountedCards: ['c-drift'], gutterNumbers: ['1'] });
		});

		test('an edit the host could not address falls back to its text anchor rather than mounting nowhere', () => {
			const md = 'Revenue grew fast this week.\n';
			const payload: IPmDecoTestPayload = {
				edits: [{ id: 'c-legacy', anchorText: 'Revenue grew fast this week.', html: '<div data-editcard="c-legacy">card</div>' }],
				inserts: [], gutters: [], numbers: [],
			};
			assert.deepStrictEqual(mountWith(md, payload), { mountedCards: ['c-legacy'], gutterNumbers: [] });
		});
	});
});
