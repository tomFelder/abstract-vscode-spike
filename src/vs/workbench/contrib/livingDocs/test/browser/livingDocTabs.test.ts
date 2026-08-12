/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import {
	emptyTabStrip, ITabModel, ITabStripModel, neighbourAfterClose, parsePersistedTabStrip,
	previewTabId, TAB_OVERFLOW_THRESHOLD, tabsOverflow, toPersistedTabStrip
} from '../../common/livingDocTabs.js';

// A three-tab strip (two documents + one source), with the middle document active - the realistic shape a
// group holds while a reader works a doc with a source open alongside. Every tab starts PINNED; `previewing`
// below flips exactly one into the group's preview slot, mirroring core (a group holds one preview editor).
function strip(activeId: string | undefined, ...ids: string[]): ITabStripModel {
	const tabs: ITabModel[] = ids.map((id, i) => ({
		id,
		label: `Tab ${i + 1}`,
		kind: id.includes('csv') ? 'source' : 'document',
		dot: 'none',
		preview: false,
	}));
	return { tabs, activeId };
}

// The same strip with one tab in the preview slot - what `IEditorGroup.isPinned(editor) === false` projects to.
function previewing(model: ITabStripModel, previewId: string): ITabStripModel {
	return { ...model, tabs: model.tabs.map(t => ({ ...t, preview: t.id === previewId })) };
}

suite('livingDoc product tabs (spec 43 section 3.2)', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('neighbourAfterClose activates the right neighbour, then falls back to the left, then empties', () => {
		const model = strip('doc://b', 'doc://a', 'doc://b', 'metrics.csv');
		assert.deepStrictEqual(
			{
				closeMiddle: neighbourAfterClose(model, 'doc://b'),
				closeLast: neighbourAfterClose(model, 'metrics.csv'),
				closeFirst: neighbourAfterClose(model, 'doc://a'),
				closeUnknown: neighbourAfterClose(model, 'doc://z'),
				closeOnly: neighbourAfterClose(strip('doc://a', 'doc://a'), 'doc://a'),
			},
			{
				closeMiddle: 'metrics.csv',   // right neighbour slides in
				closeLast: 'doc://b',          // no right neighbour -> left
				closeFirst: 'doc://b',         // right neighbour slides in
				closeUnknown: 'doc://b',       // not present -> active unchanged
				closeOnly: undefined,          // last tab closed -> group empties (split contract)
			}
		);
	});

	test('tabsOverflow trips only above the ~8 cap', () => {
		const eight = strip('t0', ...Array.from({ length: TAB_OVERFLOW_THRESHOLD }, (_, i) => `t${i}`));
		const nine = strip('t0', ...Array.from({ length: TAB_OVERFLOW_THRESHOLD + 1 }, (_, i) => `t${i}`));
		assert.deepStrictEqual(
			{ threshold: TAB_OVERFLOW_THRESHOLD, atCap: tabsOverflow(eight), overCap: tabsOverflow(nine), empty: tabsOverflow(emptyTabStrip) },
			{ threshold: 8, atCap: false, overCap: true, empty: false }
		);
	});

	test('persistence round-trips ids + active id + preview id and hardens against corrupt/legacy values', () => {
		// The realistic WP-F shape: the user pinned one doc and a source, then peeked a second doc.
		const model = previewing(strip('doc://b', 'doc://a', 'doc://b', 'metrics.csv'), 'doc://b');
		const persisted = toPersistedTabStrip(model);
		const restored = parsePersistedTabStrip(JSON.stringify(persisted));
		assert.deepStrictEqual(
			{
				persisted,
				restored,
				// Every tab pinned - the group has no preview slot filled, so nothing is stored for it.
				allPinned: toPersistedTabStrip(strip('doc://a', 'doc://a', 'doc://b')),
				corrupt: parsePersistedTabStrip('{not json'),
				empty: parsePersistedTabStrip(undefined),
				// activeId not in ids is dropped so no phantom active tab survives a restore.
				strayActive: parsePersistedTabStrip(JSON.stringify({ ids: ['doc://a'], activeId: 'doc://gone' })),
				// Same for a previewId naming a tab that is no longer open (a doc deleted between runs).
				strayPreview: parsePersistedTabStrip(JSON.stringify({ ids: ['doc://a'], previewId: 'doc://gone' })),
				// A key written before WP-F carries no previewId: it reads back as "everything pinned".
				legacy: parsePersistedTabStrip(JSON.stringify({ ids: ['doc://a', 'doc://b'], activeId: 'doc://b' })),
			},
			{
				persisted: { ids: ['doc://a', 'doc://b', 'metrics.csv'], activeId: 'doc://b', previewId: 'doc://b' },
				restored: { ids: ['doc://a', 'doc://b', 'metrics.csv'], activeId: 'doc://b', previewId: 'doc://b' },
				allPinned: { ids: ['doc://a', 'doc://b'], activeId: 'doc://a', previewId: undefined },
				corrupt: { ids: [], activeId: undefined, previewId: undefined },
				empty: { ids: [], activeId: undefined, previewId: undefined },
				strayActive: { ids: ['doc://a'], activeId: undefined, previewId: undefined },
				strayPreview: { ids: ['doc://a'], activeId: undefined, previewId: undefined },
				legacy: { ids: ['doc://a', 'doc://b'], activeId: 'doc://b', previewId: undefined },
			}
		);
	});

	test('previewTabId reads the group preview slot the strip projects (plan 52 WP-F)', () => {
		const pinnedOnly = strip('doc://a', 'doc://a', 'doc://b', 'metrics.csv');
		// A malformed model carrying two preview tabs cannot come from a group (one preview slot), but the rule
		// must still be total: the first wins rather than throwing or reporting a set.
		const twoPreviews: ITabStripModel = { ...pinnedOnly, tabs: pinnedOnly.tabs.map(t => ({ ...t, preview: true })) };
		assert.deepStrictEqual(
			{
				pinnedOnly: previewTabId(pinnedOnly),
				peekedDoc: previewTabId(previewing(pinnedOnly, 'doc://b')),
				peekedSource: previewTabId(previewing(pinnedOnly, 'metrics.csv')),
				// Pinning that peek (a double-click, or an edit) empties the slot again.
				afterPin: previewTabId(previewing(previewing(pinnedOnly, 'doc://b'), 'doc://nothing')),
				empty: previewTabId(emptyTabStrip),
				twoPreviews: previewTabId(twoPreviews),
			},
			{
				pinnedOnly: undefined,
				peekedDoc: 'doc://b',
				peekedSource: 'metrics.csv',
				afterPin: undefined,
				empty: undefined,
				twoPreviews: 'doc://a',
			}
		);
	});
});
