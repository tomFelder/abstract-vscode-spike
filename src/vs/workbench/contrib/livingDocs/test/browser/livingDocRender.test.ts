/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { ILivingDocRenderInput, IPresentState, PresentChoice, renderLivingDocHtml } from '../../browser/livingDocRender.js';
import { ILivingDoc } from '../../common/livingDocsModel.js';

suite('livingDocs Present modal (renderLivingDocHtml)', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	const doc: ILivingDoc = {
		title: 'Weekly Operating Summary', subtitle: 'Week 24',
		sources: ['metrics.csv'], context: [], blocks: [], isLiving: true, body: '',
	};

	function html(present: IPresentState): string {
		const input: ILivingDocRenderInput = {
			doc, pending: [], resolved: new Map(), dirty: false, status: '',
			recent: new Set(), mode: 'rendered', rawText: '', present, syncDiff: [],
		};
		return renderLivingDocHtml(input);
	}

	test('WHO CAN ACCESS is offered for every export choice, not just the hosted web page', () => {
		const choices: PresentChoice[] = ['gdoc', 'gsheet', 'docx', 'xlsx', 'site'];
		for (const choice of choices) {
			const h = html({ open: true, choice, scope: 'internal' });
			assert.ok(h.includes('WHO CAN ACCESS'), `scope selector shown for ${choice}`);
			assert.ok(h.includes('Workspace only') && h.includes('Anyone with link') && h.includes('Public'), `all three scopes for ${choice}`);
		}
	});

	test('the editor top bar carries the user avatar, matching the screens and the comp', () => {
		const input: ILivingDocRenderInput = {
			doc, pending: [], resolved: new Map(), dirty: false, status: 'All sources synced',
			recent: new Set(), mode: 'rendered', rawText: '', present: { open: false, choice: 'gdoc', scope: 'internal' }, syncDiff: [],
		};
		const h = renderLivingDocHtml(input);
		assert.ok(h.includes('class="topbar"') && h.includes('class="av">TS<'), 'top bar shows the TS avatar');
	});

	test('the shareable URL row appears for link/public scopes and is hidden when workspace-only', () => {
		assert.ok(!html({ open: true, choice: 'gdoc', scope: 'internal' }).includes('opportunity-os.live'), 'no public URL when workspace-only');
		assert.ok(html({ open: true, choice: 'gdoc', scope: 'link' }).includes('opportunity-os.live'), 'URL shown for anyone-with-link');
		assert.ok(html({ open: true, choice: 'gdoc', scope: 'public' }).includes('opportunity-os.live'), 'URL shown for public');
	});

	test('a bound prose figure renders as an inline highlighted span carrying its source key', () => {
		const boundDoc: ILivingDoc = {
			title: 'Weekly', subtitle: 'Week 24', sources: ['metrics.csv'], context: [], isLiving: true,
			body: '', blocks: [{
				id: 'b1', type: 'paragraph', level: undefined,
				text: 'Revenue grew [12%](bind:metrics.mrr.delta) week-on-week.',
				binds: [{ key: 'metrics.mrr.delta', value: '12%' }],
			}],
		};
		const h = renderLivingDocHtml({
			doc: boundDoc, pending: [], resolved: new Map([['metrics.mrr.delta', '+18%']]), dirty: false,
			status: '', recent: new Set(), mode: 'rendered', rawText: '',
			present: { open: false, choice: 'gdoc', scope: 'internal' }, syncDiff: [],
		});
		assert.deepStrictEqual({
			hasBoundSpan: h.includes('<span class="bound" data-cells="metrics.mrr.delta"'),
			showsResolvedValue: h.includes('>+18%</span>'),       // reconciled to the latest source value
			noRawBindSyntax: !h.includes('bind:metrics'),         // the bind: URL is never shown
		}, { hasBoundSpan: true, showsResolvedValue: true, noRawBindSyntax: true });
	});

	test('the in-surface source-peek pane renders the raw CSV grid with the latest row highlighted', () => {
		const h = renderLivingDocHtml({
			doc, pending: [], resolved: new Map(), dirty: false, status: '', recent: new Set(),
			mode: 'rendered', rawText: '', present: { open: false, choice: 'gdoc', scope: 'internal' }, syncDiff: [],
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
			hasGridTable: h.includes('class="sp-grid"'),
			hasHeaders: h.includes('<th>week</th>') && h.includes('<th>signups</th>'),
			hasLatestRow: h.includes('<tr class="sel"><td>24</td><td>48.6</td><td>427</td></tr>'),
			priorRowNotHighlighted: h.includes('<tr class=""><td>23</td>'),
			stillHasBoundFigures: h.includes('BOUND FIGURES'),
		}, { hasGridTable: true, hasHeaders: true, hasLatestRow: true, priorRowNotHighlighted: true, stillHasBoundFigures: true });
	});

	test('the header is the comp calm bar: pill refreshes, no Download/Refresh buttons, formatting is a floating selection toolbar', () => {
		const input: ILivingDocRenderInput = {
			doc, pending: [], resolved: new Map(), dirty: false, status: 'All sources synced',
			recent: new Set(), mode: 'rendered', rawText: '', present: { open: false, choice: 'gdoc', scope: 'internal' }, syncDiff: [],
		};
		const h = renderLivingDocHtml(input);
		assert.deepStrictEqual({
			pillIsRefresh: h.includes('class="pill ') && h.includes('data-refresh'),
			noDownloadButton: !h.includes('data-export-md'),
			noStandaloneRefreshButton: !h.includes('class="btn" data-refresh'),
			noPersistentFormattingRow: !h.includes('class="etoolbar"'),
			hasFloatingSelectionToolbar: h.includes('class="seltoolbar"') && h.includes('data-fmt="bold"'),
			rawEditMovedToHint: h.includes('class="hint-raw" data-to-raw'),
			present: h.includes('data-present-open'),
		}, {
			pillIsRefresh: true,
			noDownloadButton: true,
			noStandaloneRefreshButton: true,
			noPersistentFormattingRow: true,
			hasFloatingSelectionToolbar: true,
			rawEditMovedToHint: true,
			present: true,
		});
	});
});
