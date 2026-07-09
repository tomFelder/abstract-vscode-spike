/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { historyHtml } from '../../browser/historyRender.js';
import { IAuditEntry, ISnapshotEntry } from '../../common/livingDocsModel.js';

// Plan 26 iter 3-4: the History tab is truthful. It renders REAL snapshots (restorable versions) and the
// REAL audit entries recorded since each one, all from the active document's lock - never the fabricated
// v14/v13 sample, and a calm one-line empty state when there is nothing yet.
suite('livingDocs History tab (historyHtml)', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	const NOW = Date.parse('2026-07-06T12:00:00.000Z');

	function snap(over: Partial<ISnapshotEntry>): ISnapshotEntry {
		return { id: 'id1', label: 'A version', at: '2026-07-06T11:00:00.000Z', via: 'manual', body: '# Doc', auditIndex: 0, ...over };
	}
	function audit(over: Partial<IAuditEntry>): IAuditEntry {
		return { time: '2026-07-06T11:30:00.000Z', docTitle: 'Weekly Summary', blockId: 'commentary', action: 'approved', oldText: 'a', newText: 'b', via: 'model', ...over };
	}

	test('renders real snapshots and audit from the lock - no fabricated sample', () => {
		const h = historyHtml(
			[snap({ id: 's1', label: 'Before bulk approve', via: 'bulk-approve' })],
			[audit({ blockId: 'commentary' })],
			'Weekly Summary',
			undefined,
			NOW,
		);
		// The header is the live document title, upper-cased - not the hardcoded WEEKLY SUMMARY.MD.
		assert.ok(h.includes('VERSION HISTORY &middot; WEEKLY SUMMARY'), 'header derives from the doc title');
		// The real snapshot label and the real audit block are present.
		assert.ok(h.includes('Before bulk approve'), 'real snapshot label shown');
		assert.ok(h.includes('commentary'), 'real audit block shown');
		// The fabricated sample is gone for good.
		assert.ok(!h.includes('>v14<') && !h.includes('>v13<') && !h.includes('>v12<') && !h.includes('>v11<'), 'no fabricated version rows');
		assert.ok(!h.includes('just now'), 'no fabricated "just now" literal');
	});

	test('a snapshot row carries a Restore action wired to its id', () => {
		const h = historyHtml([snap({ id: 'restore-me', label: 'Saved v' })], [], 'Doc', undefined, NOW);
		assert.ok(h.includes('data-restore="restore-me"'), 'the version row wires Restore to the snapshot id');
		assert.ok(h.includes('Restore'), 'a Restore affordance is present');
	});

	test('a published snapshot gets the amber SNAPSHOT badge; the live head gets CURRENT', () => {
		const h = historyHtml([snap({ id: 'p', label: 'Published', via: 'publish' })], [], 'Doc', undefined, NOW);
		assert.ok(h.includes('SNAPSHOT'), 'publish snapshot shows the SNAPSHOT badge');
		assert.ok(h.includes('CURRENT'), 'the current live state is marked CURRENT');
		assert.ok(h.includes('Current version'), 'a current-state head row is shown above the versions');
	});

	test('a published snapshot names the real pin count beside the SNAPSHOT badge (plan 32 iter 4)', () => {
		const h = historyHtml([snap({ id: 'p', label: 'Published', via: 'publish', pinnedSources: 3 })], [], 'Doc', undefined, NOW);
		assert.ok(h.includes('SNAPSHOT'), 'still shows the SNAPSHOT badge');
		assert.ok(h.includes('pinned 3 source versions'), 'the real pin count is named on the published row');
	});

	test('a published snapshot with no pinnable sources says so truthfully', () => {
		const h = historyHtml([snap({ id: 'p', label: 'Published', via: 'publish', pinnedSources: 0 })], [], 'Doc', undefined, NOW);
		assert.ok(h.includes('no sources to pin'), 'a 0-pin publish reads honestly, never a fabricated count');
	});

	test('truthful empty state when the document has no versions or changes', () => {
		const h = historyHtml([], [], 'Fresh Doc', undefined, NOW);
		assert.ok(h.includes('No versions yet - changes you approve will appear here.'), 'calm one-line empty state');
		assert.ok(!h.includes('data-restore'), 'no Restore rows when there is nothing to restore');
		// Still offers the manual Save version entry point (there is a body to snapshot).
		assert.ok(h.includes('data-save-version'), 'Save version is offered for an open document');
	});

	test('no document open shows a calm prompt, not a fabricated timeline', () => {
		const h = historyHtml([], [], undefined, undefined, NOW);
		assert.ok(h.includes('Open a Living Document to see its version history.'), 'honest no-doc prompt');
		assert.ok(!h.includes('data-restore') && !h.includes('CURRENT'), 'no version rows without a document');
	});

	test('restore is recorded on the audit as a "Restored" change, not "Approved"', () => {
		const h = historyHtml([], [audit({ via: 'restore', blockId: 'body' })], 'Doc', undefined, NOW);
		assert.ok(h.includes('Restored'), 'a restore audit entry reads as Restored');
	});

	test('caps the display at 20 rows and names the remainder rather than truncating silently', () => {
		const many: IAuditEntry[] = [];
		for (let i = 0; i < 25; i++) {
			many.push(audit({ blockId: `block-${i}`, time: `2026-07-06T10:${String(i).padStart(2, '0')}:00.000Z` }));
		}
		const h = historyHtml([], many, 'Doc', undefined, NOW);
		assert.ok(h.includes('5 earlier entries'), 'the 5 rows beyond the cap are named, not dropped');
	});

	test('a template-generated document keeps its real origin row at the base', () => {
		const h = historyHtml([snap({ id: 's1' })], [], 'Doc', 'Weekly report', NOW);
		assert.ok(h.includes('Created from Weekly report template'), 'the real template origin row is shown');
		assert.ok(h.includes('FROM TEMPLATE'), 'the origin row carries the FROM TEMPLATE badge');
	});
});
