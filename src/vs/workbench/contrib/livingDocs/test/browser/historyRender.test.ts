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
		assert.ok(h.includes('No versions yet.'), 'calm one-line empty state');
		assert.ok(!h.includes('data-restore'), 'no Restore rows when there is nothing to restore');
		// Still offers the manual Save version entry point (there is a body to snapshot).
		assert.ok(h.includes('data-save-version'), 'Save version is offered for an open document');
	});

	// Plan 52 WP-G / G2: History must state what it records AND what it does not, identically in both states -
	// the old wording named only the approve path and left "is my typing versioned?" unanswered.
	test('both states carry the same scope sentence: what is recorded, and that typing is not', () => {
		const RECORDED = 'Recorded here: changes you approve or reject, and versions you save with Save version.';
		const NOT_RECORDED = 'Your own typing is not recorded';
		const empty = historyHtml([], [], 'Fresh Doc', undefined, NOW);
		const populated = historyHtml([snap({ id: 's1', label: 'Saved version', via: 'manual' })], [audit({ blockId: 'body' })], 'Doc', undefined, NOW);
		assert.deepStrictEqual(
			[empty.includes(RECORDED), empty.includes(NOT_RECORDED), populated.includes(RECORDED), populated.includes(NOT_RECORDED)],
			[true, true, true, true]
		);
	});

	test('no document open shows a calm prompt, not a fabricated timeline', () => {
		const h = historyHtml([], [], undefined, undefined, NOW);
		assert.ok(h.includes('Open a document to see its version history.'), 'honest no-doc prompt (versions apply to any document, not only Living Documents - issue #181)');
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

	test('F19: a duplicated audit entry (persisted + in-session copy of the same lock) renders once', () => {
		const e = audit({ blockId: 'commentary', time: '2026-07-06T11:30:00.000Z', newText: 'Sharper line.' });
		const h = historyHtml([], [e, { ...e }], 'Doc', undefined, NOW);
		// Count the change-row BODY ("<docTitle> / <blockId>"), not the bare block id: the applied-change row now
		// also carries a "This Was Wrong" feedback button (doc 18 section 2.5) whose data-wrong payload legitimately
		// references the same block id, so a bare-id count would see two. The row body is the dedup signal.
		const rows = h.split(' / commentary').length - 1;
		assert.strictEqual(rows, 1, 'the same change is shown once, never doubled on a cold-open merge');
	});

	test('a template-generated document keeps its real origin row at the base', () => {
		const h = historyHtml([snap({ id: 's1' })], [], 'Doc', 'Weekly report', NOW);
		assert.ok(h.includes('Created from Weekly report template'), 'the real template origin row is shown');
		assert.ok(h.includes('FROM TEMPLATE'), 'the origin row carries the FROM TEMPLATE badge');
	});

	// The feedback verb (doc 18 section 2.5): "This Was Wrong" on APPLIED changes only. The button carries the
	// change ref (the audit row's own ISO time - a stable, unique key so the flag lands on THIS row after
	// relaunch, issue #258) so the reviewRailView can flag + comment; it never appears on a rejection or a
	// restore (those are not applied agent changes to disavow).
	test('an approved change carries a "This Was Wrong" feedback affordance keyed by the row time', () => {
		const h = historyHtml([], [audit({ blockId: 'commentary', action: 'approved', time: '2026-07-06T11:30:00.000Z' })], 'Weekly Summary', undefined, NOW);
		assert.ok(h.includes('This Was Wrong'), 'applied change has the feedback verb');
		assert.ok(/data-wrong="[^"]*2026-07-06T11:30:00.000Z[^"]*"/.test(h), 'the feedback button is keyed by the row time');
	});

	// Once flagged (persisted on the row as `wrong`, issue #258) the row reads flagged instead of offering an
	// infinitely re-flaggable button - so a reopened History never lets the same row be re-flagged forever.
	test('a flagged applied change reads "Flagged Wrong" and drops the re-flag button', () => {
		const h = historyHtml([], [audit({ action: 'approved', wrong: { at: '2026-07-06T12:00:00.000Z', comment: 'stale figure' } })], 'Weekly Summary', undefined, NOW);
		assert.ok(h.includes('Flagged Wrong'), 'the flagged row shows a static flagged badge');
		assert.ok(!h.includes('This Was Wrong'), 'the re-flag button is gone once flagged');
		assert.ok(h.includes('stale figure'), 'the persisted flag comment shows in the row');
	});

	// The rejection reason (1f frame-3) rides on the audit row and shows in History so the trail reads why.
	test('a rejection with a reason shows the reason in the History row', () => {
		const h = historyHtml([], [audit({ action: 'rejected', reason: 'the wording changed the meaning' })], 'Weekly Summary', undefined, NOW);
		assert.ok(h.includes('Rejected'), 'the rejection row is shown');
		assert.ok(h.includes('the wording changed the meaning'), 'the reject reason is shown on the row');
	});

	test('an auto-applied figure change also carries the feedback affordance', () => {
		const h = historyHtml([], [audit({ blockId: 'mrr', action: 'auto-applied', via: 'heuristic' })], 'Weekly Summary', undefined, NOW);
		assert.ok(h.includes('This Was Wrong'), 'auto-applied change has the feedback verb');
	});

	test('a rejection and a restore carry no feedback affordance (nothing was applied to disavow)', () => {
		const rejected = historyHtml([], [audit({ action: 'rejected' })], 'Weekly Summary', undefined, NOW);
		assert.ok(!rejected.includes('This Was Wrong'), 'a rejection is not an applied change');
		const restored = historyHtml([], [audit({ action: 'approved', via: 'restore' })], 'Weekly Summary', undefined, NOW);
		assert.ok(!restored.includes('This Was Wrong'), 'a restore is not a fresh applied agent change');
	});

	test('I1: an approval that could not be applied reads as the failure it is, never as "Approved"', () => {
		// docs/30 I1, issue #329. Before the closed result type this row was written as `approved`, so History
		// - the surface a user checks precisely BECAUSE they doubt what happened - confirmed the lie in the
		// past tense and offered to flag the "applied" change as wrong.
		const h = historyHtml([], [audit({ action: 'apply-failed', reason: 'the text it was written for has changed since it was proposed' })], 'Weekly Summary', undefined, NOW);
		assert.deepStrictEqual({
			verb: h.includes('Could not apply'),
			notApproved: !h.includes('Approved'),
			reasonShown: h.includes('the text it was written for has changed since it was proposed'),
			noFlagVerb: !h.includes('This Was Wrong'),
		}, { verb: true, notApproved: true, reasonShown: true, noFlagVerb: true });
	});
});
