/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { ILivingDocRenderInput, IPresentState, PresentChoice, renderExportHtml, renderLivingDocContent, renderLivingDocHtml } from '../../browser/livingDocRender.js';
import { parseLivingDoc } from '../../common/livingDocMarkdown.js';
import { ILivingDoc, IProposedChange } from '../../common/livingDocsModel.js';
import { FRESHNESS_COLOURS, UNREACHABLE_SOURCE_LINE, UNREACHABLE_SOURCE_MARKER } from '../../common/sourceFreshness.js';

// Plan 15 iter 5 flipped the default: every living document now opens in the unified ProseMirror surface
// ('pm'), the bespoke renderDoc HTML body is retired, and the calm chrome (formatting toolbar + Present)
// lives in PM. These tests assert the PM default and the absence of the old renderDoc body.
suite('livingDocs render (PM default - renderLivingDocHtml)', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	const doc: ILivingDoc = {
		title: 'Weekly Operating Summary', subtitle: 'Week 24',
		sources: ['metrics.csv'], context: [], blocks: [], isLiving: true, body: '',
	};

	function html(present: IPresentState): string {
		const input: ILivingDocRenderInput = {
			doc, pending: [], resolved: new Map(), dirty: false, status: '',
			recent: new Set(), mode: 'pm', rawText: '', present, syncDiff: [],
		};
		return renderLivingDocHtml(input);
	}

	// (plan 33 iter 4, L8; doc 22 section 3) Present is honest: the exports Abstract genuinely writes (HTML,
	// Markdown, PDF and a built-in-styled Word .docx) are selectable; the cloud/spreadsheet destinations
	// stay "Soon" and cannot be chosen or fired.
	test('Present offers the four real exports as selectable, and keeps gdoc/gsheet/xlsx "Soon"', () => {
		const h = html({ open: true, choice: 'html' });
		// The four real destinations are selectable (carry a data-present-choice hook).
		const real: PresentChoice[] = ['html', 'markdown', 'pdf', 'docx'];
		for (const k of real) {
			assert.ok(h.includes(`data-present-choice="${k}"`), `${k} export is selectable`);
		}
		// The remaining cloud/spreadsheet destinations are listed but NOT selectable and carry a Soon marker.
		const soon: PresentChoice[] = ['gdoc', 'gsheet', 'xlsx'];
		for (const k of soon) {
			assert.ok(!h.includes(`data-present-choice="${k}"`), `${k} is not selectable`);
		}
		assert.ok(h.includes('SOON'), 'a Soon marker is shown for the not-yet-real destinations');
		// The Word destination, when selected, offers the title-case CTA (doc 22 label rule).
		assert.ok(html({ open: true, choice: 'docx' }).includes('Export as Word'), 'the Word CTA reads "Export as Word"');
		// No fabricated hosting / access-control / shareable URL is claimed anywhere.
		assert.ok(!h.includes('WHO CAN ACCESS'), 'no fabricated access-control section');
		assert.ok(!h.includes('opportunity-os'), 'no old-brand fabricated shareable URL');
	});

	// #269 CR-3: the Word-paste handler must NOT post `wordPaste` (which the host weighs for a dropped-content
	// toast) when the insertion itself threw - nothing landed, so a toast would be a lie. The injected script
	// returns from the pasteHTML catch BEFORE the wordPaste post, so on failure the post is never reached.
	test('#269 CR-3: a failed pasteHTML returns before posting wordPaste (no toast for content never inserted)', () => {
		const h = html({ open: false, choice: 'html' });
		const catchReturn = h.indexOf('pasteHTML(cleaned); } catch (err) { return; }');
		const wordPastePost = h.indexOf('type: \'wordPaste\'');
		assert.deepStrictEqual(
			{ catchReturns: catchReturn !== -1, postExists: wordPastePost !== -1, returnBeforePost: catchReturn !== -1 && wordPastePost !== -1 && catchReturn < wordPastePost },
			{ catchReturns: true, postExists: true, returnBeforePost: true },
			'the pasteHTML catch returns before the wordPaste post so a swallowed insertion never raises a drop toast',
		);
	});

	// --- Before-export gate surface (plan 32 iter 4): no silent block, no silent override ---

	test('a failed before-export gate is SHOWN with its one-line reason plus Export anyway + Fix first', () => {
		const h = html({ open: true, choice: 'html', gate: { pass: false, flag: '1 of 4 figures do not reconcile: metrics.mrr.' } });
		assert.ok(h.includes('Before-export check failed'), 'the gate failure is surfaced, not silent');
		assert.ok(h.includes('1 of 4 figures do not reconcile: metrics.mrr.'), 'the grader reason is shown verbatim');
		// The two-choice row button markup (not the runtime script handler) carries both actions.
		assert.ok(/<button[^>]*data-present-cta-force/.test(h), 'an Export anyway (override) button is offered');
		assert.ok(/<button[^>]*data-present-fix-first/.test(h), 'a Fix first button jumps to the flagged block');
		assert.ok(h.includes('Export anyway') && h.includes('Fix first'), 'both actions read plainly');
	});

	test('a passing gate shows the normal export CTA and no gate banner (clean path unchanged)', () => {
		const h = html({ open: true, choice: 'html', gate: { pass: true } });
		assert.ok(!h.includes('Before-export check failed'), 'no gate banner on a clean document');
		assert.ok(/<button[^>]*data-present-cta[^-]/.test(h), 'the normal single export CTA button is present');
		assert.ok(!/<button[^>]*data-present-cta-force/.test(h), 'no Export-anyway override button when the gate passes');
	});

	test('the editor draws no per-webview top bar or avatar (the global Abstract header carries them - PH.4)', () => {
		const input: ILivingDocRenderInput = {
			doc, pending: [], resolved: new Map(), dirty: false, status: 'All sources synced',
			recent: new Set(), mode: 'pm', rawText: '', present: { open: false, choice: 'html' }, syncDiff: [],
		};
		const h = renderLivingDocHtml(input);
		assert.deepStrictEqual({
			topBar: h.includes('class="topbar"'),
			avatar: h.includes('class="av">TS<'),
		}, { topBar: false, avatar: false });
	});

	test('the Present CTA reflects the real export it will write', () => {
		assert.ok(html({ open: true, choice: 'html' }).includes('Export web page'), 'HTML choice CTA writes a web page');
		assert.ok(html({ open: true, choice: 'markdown' }).includes('Export Markdown'), 'Markdown choice CTA writes Markdown');
	});

	test('a living doc renders the unified ProseMirror surface (not the retired renderDoc body), and bound figures round-trip into PM as bind links', () => {
		const body = 'Revenue grew [12%](bind:metrics.mrr.delta) week-on-week.\n';
		const boundDoc: ILivingDoc = {
			title: 'Weekly', subtitle: 'Week 24', sources: ['metrics.csv'], context: [], isLiving: true,
			body, blocks: [{
				id: 'b1', type: 'paragraph', level: undefined,
				text: 'Revenue grew [12%](bind:metrics.mrr.delta) week-on-week.',
				binds: [{ key: 'metrics.mrr.delta', value: '12%' }],
			}],
		};
		const content = renderLivingDocContent({
			doc: boundDoc, pending: [], resolved: new Map([['metrics.mrr.delta', '+18%']]), dirty: false,
			status: '', recent: new Set(), mode: 'pm', rawText: body,
			present: { open: false, choice: 'html' }, syncDiff: [],
		});
		assert.deepStrictEqual({
			// the document IS the ProseMirror writing surface
			isPmSurface: content.html.includes('id="pm-root"'),
			// the bind link is handed to PM (the bundle renders it as the bound_figure atom node client-side)
			pmCarriesBindLink: content.pmMd?.includes('[12%](bind:metrics.mrr.delta)') ?? false,
			// the retired renderDoc body is gone: no server-rendered grid / bound span / contenteditable block
			noRenderDocGrid: !content.html.includes('class="docwrap"') && !content.html.includes('class="gutter2'),
			noServerBoundSpan: !content.html.includes('class="bound" data-cells='),
			noContentEditableBlock: !content.html.includes('contenteditable="true"'),
		}, {
			isPmSurface: true,
			pmCarriesBindLink: true,
			noRenderDocGrid: true,
			noServerBoundSpan: true,
			noContentEditableBlock: true,
		});
	});

	test('the numbered rail (pin 9): one gutter number per Markdown block in the deco payload, with the bound tone', () => {
		// Three blocks: a heading (line 1, idle), a plain paragraph (line 2, idle), a source-bound paragraph
		// (line 3, bound). The deco payload's ordered `numbers` carries one entry per block with its tone.
		const md = [
			'---', 'title: T', 'sources:', '  - metrics.csv', '---', '',
			'## Highlights', '', 'Revenue grew.', '', 'Margins held [40%](bind:metrics.margin).',
		].join('\n') + '\n';
		const parsed = parseLivingDoc(md);
		const content = renderLivingDocContent({
			doc: parsed, pending: [], resolved: new Map(), dirty: false, status: '', recent: new Set(),
			mode: 'pm', rawText: md, present: { open: false, choice: 'html' }, syncDiff: [],
		});
		assert.deepStrictEqual(content.pmDeco?.numbers, [
			{ id: parsed.blocks[0].id, line: 1, tone: 'idle', keys: [], recent: false },
			{ id: parsed.blocks[1].id, line: 2, tone: 'idle', keys: [], recent: false },
			{ id: parsed.blocks[2].id, line: 3, tone: 'bound', keys: ['metrics.margin'], recent: false },
		]);
	});

	test('the inline change widget cites the gutter address (pin 11 / P11.1): "Line N" in the mono tag row', () => {
		const md = ['## Highlights', '', 'Revenue grew fast this week.'].join('\n') + '\n';
		const parsed = parseLivingDoc(md);
		const target = parsed.blocks.find(b => b.text.startsWith('Revenue'))!; // block index 1 => Line 2
		const pending: IProposedChange[] = [{
			id: 'c1', docId: 'd', docTitle: 'T', blockId: target.id, blockLabel: 'Highlights',
			oldText: target.text, newText: 'Revenue dropped sharply this week.', kind: 'meaning',
			confidence: 0.85, rationale: '', sourceCells: [],
		}];
		const content = renderLivingDocContent({
			doc: parsed, pending, resolved: new Map(), dirty: false, status: '', recent: new Set(),
			mode: 'pm', rawText: md, present: { open: false, choice: 'html' }, syncDiff: [],
		});
		const widgetHtml = content.pmDeco?.edits[0]?.html ?? '';
		assert.deepStrictEqual({
			citesAddress: widgetHtml.includes('>Line 2</span>'),
			addressIsMono: widgetHtml.includes('class="src pm-addr">Line 2'),
		}, { citesAddress: true, addressIsMono: true });
	});

	test('source-peek is a bottom in-surface drawer (never splits the editor): grip + header + sync action over the CSV grid', () => {
		const h = renderLivingDocHtml({
			doc, pending: [], resolved: new Map(), dirty: false, status: '', recent: new Set(),
			mode: 'pm', rawText: '', present: { open: false, choice: 'html' }, syncDiff: [],
			sourcePeek: {
				source: 'metrics.csv', referencedBy: [], synced: false, syncedCount: 0,
				rows: [{ key: 'metrics.mrr', value: '$48.6k', selected: true }],
				grid: {
					headers: ['week', 'mrr', 'signups'],
					rows: [['23', '44.9', '389'], ['24', '48.6', '427']],
					latestIndex: 1,
				},
			},
		});
		assert.deepStrictEqual({
			// the comp's bottom drawer, not the old left split pane / floating circle
			isBottomDrawer: h.includes('class="srcdrawer"'),
			hasGrip: h.includes('class="sd-grip"'),
			noLeftSplitPane: !h.includes('class="peekwrap"') && !h.includes('class="srcpane"'),
			noFloatingCircle: !h.includes('class="synccircle"'),
			// sync is now a header primary button, close lives in the header too
			syncIsHeaderButton: h.includes('class="sd-sync" data-sync'),
			closeInHeader: h.includes('class="sd-x" data-source-close'),
			// content preserved: CSV grid + latest-row highlight + bound figures
			hasGridTable: h.includes('class="sp-grid"'),
			hasLatestRow: h.includes('<tr class="sel"><td>24</td><td>48.6</td><td>427</td></tr>'),
			stillHasBoundFigures: h.includes('BOUND FIGURES'),
		}, {
			isBottomDrawer: true, hasGrip: true, noLeftSplitPane: true, noFloatingCircle: true,
			syncIsHeaderButton: true, closeInHeader: true,
			hasGridTable: true, hasLatestRow: true, stillHasBoundFigures: true,
		});
	});

	test('the wedge runtime wires a bound figure to the source drawer (#254): click reveals, cell-edit is a second gesture, and there is a keyboard + a11y route', () => {
		const h = renderLivingDocHtml({
			doc, pending: [], resolved: new Map(), dirty: false, status: '', recent: new Set(),
			mode: 'pm', rawText: '', present: { open: false, choice: 'html' }, syncDiff: [],
		});
		assert.deepStrictEqual({
			// A single click on a bound figure inside a table cell posts reveal (opens the drawer), not the cell editor.
			figureClickReveals: h.includes(`e.target.closest('span.bound[data-key]')`) && h.includes(`type: 'reveal', cells: [fig.getAttribute('data-key')]`),
			// The cell editor stays reachable by a deliberate second gesture (double-click: e.detail >= 2).
			cellEditIsSecondGesture: h.includes(`fig && e.detail < 2`),
			// A focused figure activates the same reveal on Enter / Space (the keyboard route).
			keyboardRoute: h.includes(`e.key === 'Enter' || e.key === ' '`),
			// Figures are enriched into real tab-stop buttons with an accessible name (role/tabindex/aria-label/title).
			a11yEnriched: h.includes(`function enrichBoundFigures`) && h.includes(`fig.setAttribute('role', 'button')`) && h.includes(`fig.setAttribute('tabindex', '0')`),
		}, {
			figureClickReveals: true, cellEditIsSecondGesture: true, keyboardRoute: true, a11yEnriched: true,
		});
	});

	// The staleness-escape guardrail (docs/20 journey 1p): with the proxy down there is NO live reading for a remote
	// figure, so the drawer must mark that row in the stale family and say so in plain words - the same
	// provenance signal the figure hover-peek reads, so the two surfaces can never disagree.
	test('source drawer marks an unreachable api/mcp figure stale-amber and names it, leaving reachable rows alone', () => {
		const h = renderLivingDocHtml({
			doc, pending: [], resolved: new Map(), dirty: false, status: '', recent: new Set(),
			mode: 'pm', rawText: '', present: { open: false, choice: 'html' }, syncDiff: [],
			provenance: [
				{
					key: 'crm.pipeline', source: 'https://crm.example.com/data', location: 'pipeline',
					synced: 'Synced 2 h ago', fresh: true, then: '128,000', kind: 'api',
					fallback: UNREACHABLE_SOURCE_LINE,
				},
				{
					key: 'metrics.mrr', source: 'metrics.csv', location: 'mrr',
					synced: 'Synced 2 h ago', fresh: true, then: '$48.6k', kind: 'file',
				},
			],
			sourcePeek: {
				source: 'metrics.csv', referencedBy: [], synced: false, syncedCount: 0, grid: undefined,
				rows: [
					{ key: 'crm.pipeline', value: '128,000', selected: true },
					{ key: 'metrics.mrr', value: '$48.6k', selected: false },
				],
			},
		});
		assert.deepStrictEqual({
			unreachableRowMarked: h.includes(`<tr class="sel unreached"><td>crm.pipeline</td>`),
			rowCarriesTheMarker: h.includes(`<span class="sp-unreach-tag">${UNREACHABLE_SOURCE_MARKER}</span>`),
			plainWordsAboveTheTable: h.includes(`<div class="sp-unreach">&#9650; ${UNREACHABLE_SOURCE_LINE}.</div>`),
			reachableRowUntouched: h.includes(`<tr class=""><td>metrics.mrr</td><td>$48.6k</td></tr>`),
			// The marker borrows the stale family's cream/amber - no fourth colour is invented for it.
			staleFamilyColours: h.includes(`.srcdrawer tr.unreached td,.srcdrawer tr.sel.unreached td{background:${FRESHNESS_COLOURS.staleRowBg}}`),
		}, {
			unreachableRowMarked: true, rowCarriesTheMarker: true, plainWordsAboveTheTable: true,
			reachableRowUntouched: true, staleFamilyColours: true,
		});
	});

	test('the hover peek marks an unreachable source stale-amber even though it is not in the stale set', () => {
		const h = renderLivingDocHtml({
			doc, pending: [], resolved: new Map(), dirty: false, status: '', recent: new Set(),
			mode: 'pm', rawText: '', present: { open: false, choice: 'html' }, syncDiff: [],
		});
		assert.deepStrictEqual({
			// The amber marker is driven by p.fallback, not only by p.fresh (an unreachable key is never stale).
			markerOffFallback: h.includes(`: (p.fallback ? '<div class="tip-stale">${UNREACHABLE_SOURCE_MARKER}</div>' : '')`),
			// ... and the plain-words line under it still comes from the provenance payload.
			plainWordsLine: h.includes(`'<div class="tip-fallback">`),
		}, { markerOffFallback: true, plainWordsLine: true });
	});

	test('source-peek drawer, once synced, swaps the Sync button for a "N synced" chip', () => {
		const h = renderLivingDocHtml({
			doc, pending: [], resolved: new Map(), dirty: false, status: '', recent: new Set(),
			mode: 'pm', rawText: '', present: { open: false, choice: 'html' }, syncDiff: [],
			sourcePeek: {
				source: 'metrics.csv', referencedBy: [], synced: true, syncedCount: 3,
				rows: [{ key: 'metrics.mrr', value: '$48.6k', selected: true }], grid: undefined,
			},
		});
		assert.deepStrictEqual({
			showsSyncedChip: h.includes('class="sd-synced"') && h.includes('3 synced'),
			noSyncButton: !h.includes('class="sd-sync"'),
		}, { showsSyncedChip: true, noSyncButton: true });
	});

	test('the calm formatting toolbar lives in PM: wired to LWDPM.cmd (data-pmcmd), heading dropdown + B/I/lists/quote, Underline dropped', () => {
		const input: ILivingDocRenderInput = {
			doc, pending: [], resolved: new Map(), dirty: false, status: 'All sources synced',
			recent: new Set(), mode: 'pm', rawText: '', present: { open: false, choice: 'html' }, syncDiff: [],
		};
		const h = renderLivingDocHtml(input);
		assert.deepStrictEqual({
			// (plan 44-b PH.4) The per-doc top bar - brand/crumb, sync pill, Present - is gone: the one global
			// Abstract header carries them now. The doc webview draws NO top bar and NO in-body Present button.
			noTopBar: !h.includes('class="topbar"'),
			noInBodyPill: !h.includes('class="pill '),
			noInBodyPresent: !h.includes('data-present-open'),
			// the persistent calm toolbar is present and wired to the ProseMirror command bridge, NOT execCommand
			hasCalmToolbar: h.includes('class="etoolbar"'),
			wiredToPmCmd: h.includes('data-pmcmd="bold"') && h.includes('data-pmcmd="italic"'),
			noExecCommand: !h.includes('data-fmt='),
			// heading dropdown (a <select data-pmcmd>) -> paragraph/h1/h2/h3 option values
			hasHeadingDropdown: h.includes('<select class="tb-h" data-pmcmd') && h.includes('value="h2"') && h.includes('value="paragraph"'),
			hasListAndQuote: h.includes('data-pmcmd="bullet_list"') && h.includes('data-pmcmd="ordered_list"') && h.includes('data-pmcmd="blockquote"'),
			// Underline dropped: Markdown / the commonmark schema has no underline mark (calm by subtraction)
			noUnderline: !h.includes('data-pmcmd="underline"') && !h.includes('class="tb-b und"'),
			// the comp pares the toolbar to essentials - none of the old heavy controls
			noLinkToSource: !h.includes('Link to source'),
			noRunSkill: !h.includes('Run skill'),
			noHistoryButton: !h.includes('>History<'),
			// raw Markdown stays reachable via the hint affordance
			rawEditReachable: h.includes('class="hint-raw" data-to-raw'),
		}, {
			noTopBar: true,
			noInBodyPill: true,
			noInBodyPresent: true,
			hasCalmToolbar: true,
			wiredToPmCmd: true,
			noExecCommand: true,
			hasHeadingDropdown: true,
			hasListAndQuote: true,
			noUnderline: true,
			noLinkToSource: true,
			noRunSkill: true,
			noHistoryButton: true,
			rawEditReachable: true,
		});
	});

	// plan 16 iter 6: the formatting toolbar must show for a PLAIN doc too (PM is the one surface) -- a blank
	// new note previously opened with no way to format. The living-only chrome (sync bar, figure hint) stays off.
	test('a plain (non-living) doc in PM still gets the formatting toolbar, without the living-only chrome', () => {
		const plain: ILivingDoc = { title: 'Notes', subtitle: '', sources: [], context: [], blocks: [], isLiving: false, body: '' };
		const content = renderLivingDocContent({
			doc: plain, pending: [], resolved: new Map(), dirty: false, status: '',
			recent: new Set(), mode: 'pm', rawText: '', present: { open: false, choice: 'html' }, syncDiff: [],
		});
		const h = content.html;
		assert.deepStrictEqual({
			hasCalmToolbar: h.includes('class="etoolbar"'),
			wiredToPmCmd: h.includes('data-pmcmd="bold"') && h.includes('data-pmcmd="blockquote"'),
			// (plan 44-b PH.4) No in-webview crumb; the header carries the breadcrumb for every doc.
			noInPageCrumb: !h.includes('class="crumb'),
			// living-only chrome stays off for a plain doc
			noSyncBar: !h.includes('class="syncbar"'),
			noFigureHint: !h.includes('Bound figures are highlighted'),
			// the document is still the PM writing surface
			isPmSurface: h.includes('id="pm-root"'),
		}, {
			hasCalmToolbar: true,
			wiredToPmCmd: true,
			noInPageCrumb: true,
			noSyncBar: true,
			noFigureHint: true,
			isPmSurface: true,
		});
	});

	// Plan 26 iter 4: the toolbar save/version chip is honest. It reads a plain "Saved" when the document
	// has no snapshots, and "Saved &middot; vN" where N is the REAL snapshot count - never the fabricated v14.
	test('the toolbar chip shows a plain "Saved" and no version number when there are no snapshots', () => {
		const input: ILivingDocRenderInput = {
			doc, pending: [], resolved: new Map(), dirty: false, status: '', recent: new Set(),
			mode: 'pm', rawText: '', present: { open: false, choice: 'html' }, syncDiff: [], snapshotCount: 0,
		};
		const h = renderLivingDocHtml(input);
		assert.ok(h.includes('class="tb-saved-text">Saved</span>'), 'plain Saved with no version suffix');
		assert.ok(!h.includes('v14') && !h.includes('&middot; v'), 'no fabricated version number');
	});

	test('the toolbar chip shows the real snapshot count as "Saved &middot; vN"', () => {
		const input: ILivingDocRenderInput = {
			doc, pending: [], resolved: new Map(), dirty: false, status: '', recent: new Set(),
			mode: 'pm', rawText: '', present: { open: false, choice: 'html' }, syncDiff: [], snapshotCount: 3,
		};
		const h = renderLivingDocHtml(input);
		assert.ok(h.includes('Saved &middot; v3'), 'the chip reflects the real snapshot count');
		assert.ok(!h.includes('v14'), 'the fabricated v14 is gone');
	});

	// Issue #142: approving a model-driven change must NOT wipe the session's undo stack. The RUNTIME's
	// pmReset path used to call LWDPM.setDoc, which builds a fresh EditorState with a fresh (empty) history()
	// plugin - erasing every prior undo, including the user's own pre-approve typing. The fix swaps the body
	// as ONE transaction on the live state (pmReplaceBody) so history is preserved and Ctrl+Z undoes the
	// approve. This is a runtime-string change, so it is asserted at the string level per the brief.
	test('the pmReset path swaps the body history-preservingly (pmReplaceBody), never LWDPM.setDoc', () => {
		const h = html({ open: false, choice: 'html' });
		// The history-preserving swap helper is present in the shipped RUNTIME...
		assert.ok(h.includes('function pmReplaceBody('), 'pmReplaceBody is defined in the RUNTIME');
		// ...and the pmReset branch of applyUpdate calls it rather than the history-wiping setDoc.
		assert.ok(h.includes('pmReplaceBody(pmReset)'), 'the pmReset branch calls pmReplaceBody');
		assert.ok(!h.includes('LWDPM.setDoc(pmView, pmReset)'), 'the pmReset branch no longer calls LWDPM.setDoc');
		// The swap replaces the whole doc content on the live state (a normal, undoable transaction) instead
		// of recreating the state, and is dispatched under echo suppression so it does not double-persist.
		assert.ok(h.includes('replaceWith(0, st.doc.content.size, node.content)'), 'the swap is one transaction on the live doc');
		assert.ok(h.includes('_pmEchoSuppressed = true'), 'the programmatic swap is echo-suppressed');
		// The real user-edit echo path is only guarded by the flag, never disabled: pmOnChange still posts a
		// pmEdit for a genuine edit (or a user Ctrl+Z that reverts the swap) once the flag has cleared.
		assert.ok(h.includes('if (_pmEchoSuppressed) { return; }'), 'pmOnChange short-circuits only while suppressed');
	});

	// (plan 44-b PH.4) The breadcrumb moved off the doc webview onto the one global Abstract header (the
	// repurposed title bar): the LivingDocEditor publishes { breadcrumb: doc.title, fileName } to the header
	// content service, and AbstractHeaderContribution paints it natively via textContent (injection-safe by
	// construction). So the doc webview HTML must carry NO breadcrumb of its own - crumb, project button and
	// file segment are all gone - for a real document and for the no-project fallback alike.
	test('the doc webview draws no in-page breadcrumb (the global Abstract header carries it - PH.4)', () => {
		const realDoc = renderLivingDocContent({
			doc: { title: '25 - Why Abstract (the one-pager)', subtitle: '', sources: [], context: [], blocks: [], isLiving: false, body: '' },
			pending: [], resolved: new Map(), dirty: false, status: '', recent: new Set(), mode: 'pm', rawText: '',
			present: { open: false, choice: 'html' }, syncDiff: [], projectName: 'docs', fileName: '25-why-abstract.md',
		}).html;
		const noProject = renderLivingDocContent({
			doc, pending: [], resolved: new Map(), dirty: false, status: '', recent: new Set(), mode: 'pm', rawText: '',
			present: { open: false, choice: 'html' }, syncDiff: [],
		}).html;
		assert.deepStrictEqual({
			realDocNoCrumb: !realDoc.includes('class="crumb') && !realDoc.includes('data-open-project'),
			realDocNoBrandLogo: !realDoc.includes('class="logo"'),
			noProjectNoCrumb: !noProject.includes('class="crumb') && !noProject.includes('class="topbar"'),
		}, { realDocNoCrumb: true, realDocNoBrandLogo: true, noProjectNoCrumb: true });
	});

	// Issue #175: the top bar and formatting toolbar run edge-to-edge. The bars being siblings of .pmwrap is
	// necessary but not sufficient - it was true since the first commit yet the gutter persisted, because the
	// webview harness injects `body{padding:0 20px}` and the content CSS only reset margin, so the 20px lateral
	// inset survived and pushed every bar off both rails. The real acceptance is therefore that the generated
	// CSS resets the harness body padding to 0; only then do the sibling bars actually reach the rails while the
	// centred 720px prose column keeps its own 40px/30px insets. This is a generated-string test, so we assert
	// against the CSS text directly - reverting the `padding:0` reset must fail it.
	test('the generated CSS resets the harness body padding so the sibling header bars reach both rails (edge-to-edge chrome)', () => {
		const content = renderLivingDocContent({
			doc: { title: '25 - Why Abstract (the one-pager)', subtitle: '', sources: [], context: [], blocks: [], isLiving: false, body: '' },
			pending: [], resolved: new Map(), dirty: false, status: '', recent: new Set(), mode: 'pm', rawText: '',
			present: { open: false, choice: 'html' }, syncDiff: [], projectName: 'docs', fileName: '25-why-abstract.md',
		});
		const h = content.html;
		const shell = renderLivingDocHtml({
			doc, pending: [], resolved: new Map(), dirty: false, status: '', recent: new Set(), mode: 'pm', rawText: '',
			present: { open: false, choice: 'html' }, syncDiff: [],
		});
		const wrapAt = h.indexOf('<div class="pmwrap">');
		assert.deepStrictEqual({
			// The harness's `body{padding:0 20px}` inset is reset in the content's own html,body rule (the fix for
			// #175). Without this the bars are inset ~20px off each rail no matter where they sit in the DOM.
			bodyPaddingReset: shell.includes('html,body{margin:0;padding:0;'),
			// (plan 44-b PH.4) The per-doc top bar is gone; the formatting toolbar is now the first bar and
			// precedes .pmwrap in document order, not nested inside its padding.
			noTopBar: !h.includes('class="topbar"'),
			toolbarBeforeWrap: h.slice(0, wrapAt).includes('class="etoolbar"'),
			barsNotInsideWrap: !h.slice(wrapAt).includes('class="etoolbar"'),
			// The centred prose column keeps its 720px max-width and now reserves a 70px numbered-gutter lane (its
			// own inset, not the harness's). The translateX(-18px) pulls the reading group left by half the 40px
			// the wider lane added, so the prose TEXT never shifts from the 30px-lane baseline (P9.1).
			proseCentred: shell.includes('.pmwrap .prose{flex:0 1 auto;max-width:720px;margin:0;padding-left:70px;padding-right:0;box-sizing:content-box;position:relative;transform:translateX(-18px)}'),
		}, {
			bodyPaddingReset: true,
			noTopBar: true,
			toolbarBeforeWrap: true,
			barsNotInsideWrap: true,
			proseCentred: true,
		});
	});

	test('raw mode is reachable and offers the way back to the editor without a separate "rendered" mode', () => {
		const raw = renderLivingDocContent({
			doc, pending: [], resolved: new Map(), dirty: false, status: '', recent: new Set(),
			mode: 'raw', rawText: '# Hello', present: { open: false, choice: 'html' }, syncDiff: [],
		});
		assert.deepStrictEqual({
			isRawTextarea: raw.html.includes('class="raw"') && raw.html.includes('# Hello'),
			noPmSurfaceInRaw: raw.pmMd === null,
			wayBack: raw.html.includes('data-apply-raw'),
		}, { isRawTextarea: true, noPmSurfaceInRaw: true, wayBack: true });
	});
});

// The self-contained HTML/PDF export must carry its images inline as data URIs, not a relative `src` the
// sanitising Markdown renderer strips (which printed broken-image glyphs before issue #131/#245 D1).
suite('livingDocs export HTML (self-contained images - #131/#245 D1)', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	// A living doc whose body references an imported image at a space-containing path (the docx importer's
	// real output, e.g. from a document named "Weekly Report.docx").
	const exportDoc: ILivingDoc = {
		title: 'Weekly Report', subtitle: 'Week 24',
		sources: [], context: [], isLiving: true, body: '',
		blocks: [{ id: 'b1', type: 'paragraph', text: '![chart](assets/Weekly Report/image-1.png)', binds: [] }],
	};
	const DATA_URI = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAAAAAA6fptVAAAACklEQVQI12NgAAAAAgAB4iG8MwAAAABJRU5ErkJggg==';

	test('with a resolved image map the export HTML inlines the data URI (no bare relative src, no broken glyph)', () => {
		const html = renderExportHtml(exportDoc, new Map(), new Map([['assets/Weekly Report/image-1.png', DATA_URI]]));
		assert.deepStrictEqual({
			hasDataUri: html.includes(DATA_URI),
			hasImg: /<img[^>]*src="data:image\/png;base64,/.test(html),
			noBareRelativeSrc: !html.includes('assets/Weekly Report/image-1.png'),
		}, { hasDataUri: true, hasImg: true, noBareRelativeSrc: true });
	});
});
