/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { ILivingDocRenderInput, IPresentState, PresentChoice, renderLivingDocContent, renderLivingDocHtml } from '../../browser/livingDocRender.js';
import { ILivingDoc } from '../../common/livingDocsModel.js';

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

	// (plan 33 iter 4, L8; doc 22 §3) Present is honest: the exports Abstract genuinely writes (HTML,
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

	test('the editor top bar carries the user avatar, matching the screens and the comp', () => {
		const input: ILivingDocRenderInput = {
			doc, pending: [], resolved: new Map(), dirty: false, status: 'All sources synced',
			recent: new Set(), mode: 'pm', rawText: '', present: { open: false, choice: 'html' }, syncDiff: [],
		};
		const h = renderLivingDocHtml(input);
		assert.ok(h.includes('class="topbar"') && h.includes('class="av">TS<'), 'top bar shows the TS avatar');
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

	test('the calm formatting toolbar lives in PM: wired to LWDPM.cmd (data-pmcmd), heading dropdown + B/I/lists/quote, Underline dropped, Present available', () => {
		const input: ILivingDocRenderInput = {
			doc, pending: [], resolved: new Map(), dirty: false, status: 'All sources synced',
			recent: new Set(), mode: 'pm', rawText: '', present: { open: false, choice: 'html' }, syncDiff: [],
		};
		const h = renderLivingDocHtml(input);
		assert.deepStrictEqual({
			pillIsRefresh: h.includes('class="pill ') && h.includes('data-refresh'),
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
			present: h.includes('data-present-open'),
		}, {
			pillIsRefresh: true,
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
			present: true,
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
			crumbIsMarkdown: h.includes('class="crumb">Markdown<'),
			// living-only chrome stays off for a plain doc
			noSyncBar: !h.includes('class="syncbar"'),
			noFigureHint: !h.includes('Bound figures are highlighted'),
			// the document is still the PM writing surface
			isPmSurface: h.includes('id="pm-root"'),
		}, {
			hasCalmToolbar: true,
			wiredToPmCmd: true,
			crumbIsMarkdown: true,
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

	// Issue #174: the editor bar is a real file breadcrumb - the clickable project (workspace folder), the
	// document title, and the on-disk file name in muted grey - not the static "Abstract / Markdown" noise.
	test('the top bar shows a real file breadcrumb (project / title + grey file name), project segment clickable', () => {
		const content = renderLivingDocContent({
			doc: { title: '25 - Why Abstract (the one-pager)', subtitle: '', sources: [], context: [], blocks: [], isLiving: false, body: '' },
			pending: [], resolved: new Map(), dirty: false, status: '', recent: new Set(), mode: 'pm', rawText: '',
			present: { open: false, choice: 'html' }, syncDiff: [], projectName: 'docs', fileName: '25-why-abstract.md',
		});
		const h = content.html;
		assert.deepStrictEqual({
			// the project segment is a real button that navigates back to the project view (posts openProject)
			projectSegmentClickable: h.includes('class="crumb-proj" data-open-project'),
			projectSegmentIsFolder: h.includes('>docs</button>'),
			// the document title fills the middle segment (fed from the same model title that drives the H1)
			titleSegment: h.includes('class="crumb-title">25 - Why Abstract (the one-pager)<'),
			// the file name trails in its own muted-grey segment
			fileNameSegment: h.includes('class="crumb-file">25-why-abstract.md<'),
			// the static brand/type crumb is gone for a real document (no "Markdown" / "Living Document" type)
			noTypeCrumb: !h.includes('class="crumb">Markdown<') && !h.includes('class="crumb">Living Document<'),
		}, {
			projectSegmentClickable: true,
			projectSegmentIsFolder: true,
			titleSegment: true,
			fileNameSegment: true,
			noTypeCrumb: true,
		});
	});

	// Issue #174: with no workspace folder in play (projectName absent), the bar falls back to the brand crumb
	// rather than rendering a blank/half breadcrumb - the file breadcrumb needs a project segment to anchor.
	test('the top bar falls back to the brand crumb when no project name is supplied', () => {
		const content = renderLivingDocContent({
			doc, pending: [], resolved: new Map(), dirty: false, status: '', recent: new Set(), mode: 'pm', rawText: '',
			present: { open: false, choice: 'html' }, syncDiff: [],
		});
		const h = content.html;
		assert.deepStrictEqual({
			hasBrandCrumb: h.includes('class="crumb">Living Document<'),
			noFileBreadcrumb: !h.includes('class="crumb-proj"'),
		}, { hasBrandCrumb: true, noFileBreadcrumb: true });
	});

	// Issue #174: every breadcrumb value (project name, document title, file name) is authored data that
	// reaches the webview HTML, so all three MUST go through esc() and land inert. A hostile filename/title
	// must appear as escaped text, never as live markup - reverting any esc() on the breadcrumb fails this.
	test('the breadcrumb escapes hostile project/title/file names so nothing renders as live markup', () => {
		const content = renderLivingDocContent({
			doc: { title: '<img src=x onerror="alert(1)">', subtitle: '', sources: [], context: [], blocks: [], isLiving: false, body: '' },
			pending: [], resolved: new Map(), dirty: false, status: '', recent: new Set(), mode: 'pm', rawText: '',
			present: { open: false, choice: 'html' }, syncDiff: [],
			projectName: '"><script>x</script>', fileName: '</span><b>evil</b>.md',
		});
		const h = content.html;
		assert.deepStrictEqual({
			// no un-escaped hostile tag survives anywhere in the emitted breadcrumb HTML
			noLiveImg: !h.includes('<img src=x onerror'),
			noLiveScript: !h.includes('<script>x</script>'),
			noLiveSpanBreakout: !h.includes('</span><b>evil</b>'),
			// the values are present, escaped (proves they were rendered, not merely dropped)
			titleEscaped: h.includes('&lt;img src=x onerror=&quot;alert(1)&quot;&gt;'),
			projectEscaped: h.includes('&quot;&gt;&lt;script&gt;x&lt;/script&gt;'),
			fileEscaped: h.includes('&lt;/span&gt;&lt;b&gt;evil&lt;/b&gt;.md'),
		}, {
			noLiveImg: true,
			noLiveScript: true,
			noLiveSpanBreakout: true,
			titleEscaped: true,
			projectEscaped: true,
			fileEscaped: true,
		});
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
			// The bars precede .pmwrap in document order and are not nested inside its padding.
			topBarBeforeWrap: h.slice(0, wrapAt).includes('class="topbar"'),
			toolbarBeforeWrap: h.slice(0, wrapAt).includes('class="etoolbar"'),
			barsNotInsideWrap: !h.slice(wrapAt).includes('class="topbar"') && !h.slice(wrapAt).includes('class="etoolbar"'),
			// The centred prose column keeps its 720px max-width + 30px provenance gutter (its own inset, not the harness's).
			proseCentred: shell.includes('.pmwrap .prose{flex:0 1 auto;max-width:720px;margin:0;padding-left:30px'),
		}, {
			bodyPaddingReset: true,
			topBarBeforeWrap: true,
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
