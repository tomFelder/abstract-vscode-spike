/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { auditKey, buildHistoryTimeline, dedupeAudit, IHistoryEvent } from '../../common/livingDocsHistory.js';
import { IAuditEntry, ISnapshotEntry } from '../../common/livingDocsModel.js';

// Issue #121 / F19: the History timeline rehydrates from the persisted lock (snapshots + audit) on a cold
// open. The merge/dedupe/ordering that makes the cold-open timeline identical to the in-session one lives
// in this pure module so it is deterministic and unit-testable without the DOM.
suite('livingDocs History timeline model (livingDocsHistory)', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	function audit(over: Partial<IAuditEntry>): IAuditEntry {
		return { time: '2026-07-06T11:30:00.000Z', docTitle: 'Board Note', blockId: 'b-3', action: 'approved', oldText: 'a', newText: 'b', via: 'model', ...over };
	}
	function snap(over: Partial<ISnapshotEntry>): ISnapshotEntry {
		return { id: 'id1', label: 'A version', at: '2026-07-06T11:00:00.000Z', via: 'manual', body: '# Doc', auditIndex: 0, ...over };
	}
	const changes = (evs: readonly IHistoryEvent[]) => evs.filter(e => e.kind === 'change');

	test('orders snapshots and audit changes newest-first on their timestamps', () => {
		const evs = buildHistoryTimeline(
			[snap({ id: 's', at: '2026-07-06T10:00:00.000Z' })],
			[audit({ blockId: 'old', time: '2026-07-06T09:00:00.000Z' }), audit({ blockId: 'new', time: '2026-07-06T12:00:00.000Z' })],
		);
		const times = evs.map(e => e.at);
		assert.deepStrictEqual(times, [...times].sort((a, b) => b - a), 'events are newest-first');
		assert.strictEqual(evs[0].kind, 'change');
		assert.strictEqual((evs[0] as { entry: IAuditEntry }).entry.blockId, 'new', 'the newest change is first');
	});

	test('dedupes audit entries that share a stable identity (a re-read that overlaps an in-session append)', () => {
		const e = audit({ blockId: 'b-3', time: '2026-07-06T11:30:00.000Z' });
		// The same change recorded twice - as would happen if a persisted entry were merged with an
		// in-session copy of the same lock. It must render exactly once (F19 "no duplicates").
		const deduped = dedupeAudit([e, { ...e }]);
		assert.strictEqual(deduped.length, 1, 'identical audit entries collapse to one');

		const evs = buildHistoryTimeline([], [e, { ...e }]);
		assert.strictEqual(changes(evs).length, 1, 'the timeline shows the change once, not twice');
	});

	test('keeps genuinely distinct changes on the same block (different text / time / action)', () => {
		const evs = buildHistoryTimeline([], [
			audit({ blockId: 'b-3', time: '2026-07-06T11:30:00.000Z', newText: 'first' }),
			audit({ blockId: 'b-3', time: '2026-07-06T11:31:00.000Z', newText: 'second' }),
			audit({ blockId: 'b-3', time: '2026-07-06T11:32:00.000Z', action: 'rejected', newText: 'third' }),
		]);
		assert.strictEqual(changes(evs).length, 3, 'distinct changes are all kept');
	});

	test('auditKey separates entries that differ only in one field', () => {
		const base = audit({});
		assert.notStrictEqual(auditKey(base), auditKey({ ...base, blockId: 'b-4' }));
		assert.notStrictEqual(auditKey(base), auditKey({ ...base, action: 'rejected' }));
		assert.notStrictEqual(auditKey(base), auditKey({ ...base, newText: 'different' }));
		assert.strictEqual(auditKey(base), auditKey({ ...audit({}) }), 'identical entries share a key');
	});

	test('a corrupt/unparseable timestamp sorts to the base rather than throwing', () => {
		const evs = buildHistoryTimeline([], [audit({ blockId: 'bad', time: 'not-a-date' }), audit({ blockId: 'ok', time: '2026-07-06T12:00:00.000Z' })]);
		assert.strictEqual(evs.length, 2);
		assert.strictEqual((evs[0] as { entry: IAuditEntry }).entry.blockId, 'ok', 'the datable entry sorts above the corrupt one');
		assert.strictEqual(evs[1].at, 0, 'the corrupt time parses to 0');
	});

	test('an empty lock yields an empty timeline (honest empty state upstream)', () => {
		assert.deepStrictEqual(buildHistoryTimeline([], []), []);
	});
});
