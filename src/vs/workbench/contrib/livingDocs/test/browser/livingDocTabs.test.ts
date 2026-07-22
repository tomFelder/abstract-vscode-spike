/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import {
	emptyTabStrip, ITabModel, ITabStripModel, neighbourAfterClose, parsePersistedTabStrip,
	TAB_OVERFLOW_THRESHOLD, tabsOverflow, toPersistedTabStrip
} from '../../common/livingDocTabs.js';

// A three-tab strip (two documents + one source), with the middle document active - the realistic shape a
// group holds while a reader works a doc with a source open alongside.
function strip(activeId: string | undefined, ...ids: string[]): ITabStripModel {
	const tabs: ITabModel[] = ids.map((id, i) => ({
		id,
		label: `Tab ${i + 1}`,
		kind: id.includes('csv') ? 'source' : 'document',
		dot: 'none',
	}));
	return { tabs, activeId };
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

	test('persistence round-trips ids + active id and hardens against corrupt/legacy values', () => {
		const model = strip('doc://b', 'doc://a', 'doc://b', 'metrics.csv');
		const persisted = toPersistedTabStrip(model);
		const restored = parsePersistedTabStrip(JSON.stringify(persisted));
		assert.deepStrictEqual(
			{
				persisted,
				restored,
				corrupt: parsePersistedTabStrip('{not json'),
				empty: parsePersistedTabStrip(undefined),
				// activeId not in ids is dropped so no phantom active tab survives a restore.
				strayActive: parsePersistedTabStrip(JSON.stringify({ ids: ['doc://a'], activeId: 'doc://gone' })),
			},
			{
				persisted: { ids: ['doc://a', 'doc://b', 'metrics.csv'], activeId: 'doc://b' },
				restored: { ids: ['doc://a', 'doc://b', 'metrics.csv'], activeId: 'doc://b' },
				corrupt: { ids: [], activeId: undefined },
				empty: { ids: [], activeId: undefined },
				strayActive: { ids: ['doc://a'], activeId: undefined },
			}
		);
	});
});
