/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { IAuditEntry } from '../../common/livingDocsModel.js';
import { countUnseenAgentEdits, docRailDot, IDocDotInput, sourceRailDot } from '../../common/railStatus.js';

// A resting document with every red/yellow/green signal off (grey); each scenario overrides one facet.
const CALM: IDocDotInput = { pendingCount: 0, unseenAgentEdits: 0, relinkCount: 0, stale: false, fanoutFailed: false };

// One audit entry, defaulted to an agent auto-apply (the qualifying green case); scenarios override facets.
function audit(overrides: Partial<IAuditEntry> = {}): IAuditEntry {
	return {
		time: '2026-07-20T10:00:00.000Z',
		docTitle: 'Doc',
		blockId: 'b1',
		action: 'auto-applied',
		oldText: 'a',
		newText: 'b',
		via: 'model',
		...overrides,
	};
}

suite('livingDocs railStatus dots (issue #212)', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	// --- precedence ladder: red > yellow > green > grey ---

	test('a plain doc with nothing to report reads grey (the L3 earned-living rule)', () => {
		assert.deepStrictEqual(docRailDot(CALM), { shape: 'dot', color: 'grey', tooltip: 'Nothing to report' });
	});

	test('unseen agent edits alone read green with a count', () => {
		assert.deepStrictEqual(docRailDot({ ...CALM, unseenAgentEdits: 3 }), { shape: 'dot', color: 'green', tooltip: '3 changes applied since you last looked' });
	});

	test('pending changes alone read yellow with a count', () => {
		assert.deepStrictEqual(docRailDot({ ...CALM, pendingCount: 2 }), { shape: 'dot', color: 'yellow', tooltip: '2 changes waiting for approval' });
	});

	test('yellow wins over green when changes are both applied and waiting', () => {
		assert.deepStrictEqual(docRailDot({ ...CALM, pendingCount: 1, unseenAgentEdits: 4 }), { shape: 'dot', color: 'yellow', tooltip: '1 change waiting for approval' });
	});

	test('red (relink) wins over yellow and green together', () => {
		assert.deepStrictEqual(docRailDot({ pendingCount: 2, unseenAgentEdits: 4, relinkCount: 1, stale: true, fanoutFailed: true }), { shape: 'dot', color: 'red', tooltip: '1 change needs re-linking' });
	});

	test('a stale binding reads red when there is no relink and no fan-out failure', () => {
		assert.deepStrictEqual(docRailDot({ ...CALM, pendingCount: 2, stale: true }), { shape: 'dot', color: 'red', tooltip: 'A source changed - this document may be out of date' });
	});

	test('a failed fan-out run reads red', () => {
		assert.deepStrictEqual(docRailDot({ ...CALM, fanoutFailed: true }), { shape: 'dot', color: 'red', tooltip: 'A run could not reach the model for this document' });
	});

	// --- source / unsupported dash rows ---

	test('source and not-yet-imported rows read a grey dash with the kind/reason in the tooltip', () => {
		assert.deepStrictEqual(
			[
				sourceRailDot('source', 'file'),
				sourceRailDot('source', 'api'),
				sourceRailDot('source', 'mcp'),
				sourceRailDot('unsupported', undefined, 'Legacy .doc files are not imported yet'),
				sourceRailDot('unsupported'),
			],
			[
				{ shape: 'dash', color: 'grey', tooltip: 'File source' },
				{ shape: 'dash', color: 'grey', tooltip: 'API source' },
				{ shape: 'dash', color: 'grey', tooltip: 'MCP source' },
				{ shape: 'dash', color: 'grey', tooltip: 'Legacy .doc files are not imported yet' },
				{ shape: 'dash', color: 'grey', tooltip: 'Not yet imported' },
			],
		);
	});

	// --- countUnseenAgentEdits boundaries ---

	test('unseen count: equal-timestamp excluded, newer counted, older excluded, undefined anchor counts all, approved/override excluded', () => {
		const entries: IAuditEntry[] = [
			audit({ time: '2026-07-20T09:00:00.000Z' }),                 // older than anchor -> excluded
			audit({ time: '2026-07-20T10:00:00.000Z' }),                 // equal to anchor -> excluded (already seen)
			audit({ time: '2026-07-20T11:00:00.000Z' }),                 // newer -> counted
			audit({ time: '2026-07-20T12:00:00.000Z' }),                 // newer -> counted
			audit({ time: '2026-07-20T13:00:00.000Z', action: 'approved' }),        // approved never counts
			audit({ time: '2026-07-20T14:00:00.000Z', action: 'rejected' }),        // rejected never counts
			audit({ time: '2026-07-20T15:00:00.000Z', via: 'override' }),           // audited override never counts
		];
		const anchor = '2026-07-20T10:00:00.000Z';
		assert.deepStrictEqual(
			{
				withAnchor: countUnseenAgentEdits(entries, anchor),
				undefinedAnchor: countUnseenAgentEdits(entries, undefined),
			},
			{ withAnchor: 2, undefinedAnchor: 4 },
		);
	});

	test('an empty audit yields zero unseen (so a plain no-lock doc drives grey)', () => {
		assert.deepStrictEqual(countUnseenAgentEdits([], undefined), 0);
	});
});
