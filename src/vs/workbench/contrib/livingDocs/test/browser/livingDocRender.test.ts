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

	test('source-peek is a bottom in-surface drawer (never splits the editor): grip + header + sync action over the CSV grid', () => {
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
			mode: 'rendered', rawText: '', present: { open: false, choice: 'gdoc', scope: 'internal' }, syncDiff: [],
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

	test('the header is the comp calm bar; formatting is a persistent calm toolbar (no Link-to-source / Run-skill / History)', () => {
		const input: ILivingDocRenderInput = {
			doc, pending: [], resolved: new Map(), dirty: false, status: 'All sources synced',
			recent: new Set(), mode: 'rendered', rawText: '', present: { open: false, choice: 'gdoc', scope: 'internal' }, syncDiff: [],
		};
		const h = renderLivingDocHtml(input);
		assert.deepStrictEqual({
			pillIsRefresh: h.includes('class="pill ') && h.includes('data-refresh'),
			noDownloadButton: !h.includes('data-export-md'),
			noStandaloneRefreshButton: !h.includes('class="btn" data-refresh'),
			// the new "Workbench v2" comp DOES carry a calm persistent toolbar (was a floating selection
			// toolbar before; the comp now shows the persistent one, which is authoritative)
			hasCalmToolbar: h.includes('class="etoolbar"') && h.includes('Saved &middot; v14'),
			toolbarHasFormatting: h.includes('data-fmt="bold"') && h.includes('data-fmt="italic"'),
			// the comp pares the toolbar to essentials - none of the old heavy controls
			noLinkToSource: !h.includes('Link to source'),
			noRunSkill: !h.includes('Run skill'),
			noHistoryButton: !h.includes('>History<'),
			rawEditMovedToHint: h.includes('class="hint-raw" data-to-raw'),
			present: h.includes('data-present-open'),
		}, {
			pillIsRefresh: true,
			noDownloadButton: true,
			noStandaloneRefreshButton: true,
			hasCalmToolbar: true,
			toolbarHasFormatting: true,
			noLinkToSource: true,
			noRunSkill: true,
			noHistoryButton: true,
			rawEditMovedToHint: true,
			present: true,
		});
	});
});
