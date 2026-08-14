/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { buildChangePointer, buildTurnPointers, describeRestoredProposals, IInlineWidgetReport } from '../../common/changePointer.js';
import { parseLivingDoc } from '../../common/livingDocMarkdown.js';
import { ILivingDoc, IProposedChange } from '../../common/livingDocsModel.js';

// A document with the block shapes a proposal can land on: plain prose, prose carrying a bound figure, a
// bullet list and a table.
const DOC_MD = [
	'---',
	'title: Weekly Operating Summary',
	'sources:',
	'  - metrics.csv',
	'---',
	'',
	'## Commentary',
	'',
	'Growth remained steady this week, continuing the gradual climb seen since early Q2.',
	'',
	'Margins held [40%](bind:metrics.margin) steady through the quarter.',
	'',
	'## Colour tokens',
	'',
	'- Neutral ink `#14161A`',
	'- Surface `#FFFFFF`',
	'- Accent blue `#2C5BE5`',
	'',
	'| Metric | Value |',
	'| --- | --- |',
	'| Churn | 3.1% |',
].join('\n') + '\n';

function change(overrides: Partial<IProposedChange>): IProposedChange {
	return {
		id: 'c1', docId: 'file:///weekly.md', docTitle: 'Weekly Operating Summary', blockId: '', blockLabel: '',
		oldText: '', newText: '', kind: 'meaning', confidence: 0.9, rationale: '', sourceCells: [],
		...overrides,
	};
}

function blockStartingWith(doc: ILivingDoc, prefix: string) {
	return doc.blocks.find(b => b.text.startsWith(prefix))!;
}

/** A document's report: it was asked to decorate `requested` and actually mounted `mounted`. */
function report(requested: readonly string[], mounted: readonly string[]): IInlineWidgetReport {
	return { requested: new Set(requested), mounted: new Set(mounted) };
}

suite('livingDocs - the chat transcript change pointer (plan 52 WP-A1)', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	const doc = parseLivingDoc(DOC_MD);
	const prose = blockStartingWith(doc, 'Growth remained');
	const bound = blockStartingWith(doc, 'Margins held');
	const list = blockStartingWith(doc, '- Neutral ink');
	const table = blockStartingWith(doc, '| Metric');

	const proseEdit = change({
		id: 'p1', blockId: prose.id, blockLabel: 'Commentary', oldText: prose.text,
		newText: 'Growth accelerated sharply this week, surpassing the gradual climb observed since early Q2.',
	});
	const boundEdit = change({
		id: 'p2', blockId: bound.id, blockLabel: 'Commentary', oldText: bound.text,
		newText: 'Margins held 40% steady through the half.',
	});
	const listEdit = change({
		id: 'p3', blockId: list.id, blockLabel: 'Colour tokens', oldText: list.text,
		newText: '- Neutral ink `#101214`',
	});
	const tableEdit = change({
		id: 'p4', blockId: table.id, blockLabel: 'Metric', oldText: table.text,
		newText: '| Metric | Value |\n| --- | --- |\n| Churn | 2.4% |',
	});
	const insertion = change({
		id: 'p5', blockId: '', blockLabel: 'Colour tokens', insert: true, afterBlockId: list.id,
		oldText: '', newText: 'A new paragraph the model wrote.', kind: 'meaning',
	});

	test('the route is read off the document\'s report, never inferred from the change itself', () => {
		// This is the whole fix (round 1 of WP-A1). The route used to be PREDICTED from the change's Markdown -
		// "an anchor with list markers or table pipes in it cannot match a rendered node, so route to Review" -
		// and the prediction was wrong for block classes nobody had walked, which stranded readers on a document
		// showing them nothing. So the routes below are asserted against a report that deliberately CONTRADICTS
		// what any such rule would say: the document reports that it mounted nothing for the plain paragraph and
		// a widget for the bullet list. The pointer must follow the document, not the text.
		const pending = [proseEdit, boundEdit, listEdit, tableEdit, insertion];
		const contrary = report(['p1', 'p2', 'p3', 'p4', 'p5'], ['p3', 'p5']);

		assert.deepStrictEqual(pending.map(c => `${c.id}:${buildChangePointer(c, doc, contrary).route}`), [
			// Asked for and not mounted: nothing to land on, so Review - even though it is ordinary prose.
			'p1:review',
			'p2:review',
			// Mounted: the reader can be landed on the widget - even though it is a list (#300's block class).
			'p3:document',
			'p4:review',
			'p5:document',
		]);
	});

	test('a change the report does not cover is unknown, not "review"', () => {
		// The report is a snapshot of one decoration pass. A change proposed AFTER it is missing from `mounted`
		// simply because it did not exist yet, so absence there is not evidence. Only a change the surface was
		// asked to decorate and did not mount is. Getting this wrong flashed a wrong "REVIEW" marker onto every
		// brand-new proposal for the moment between the transcript rendering and the document re-decorating.
		assert.deepStrictEqual({
			neverReported: buildChangePointer(proseEdit, doc, undefined).route,
			reportPredatesTheChange: buildChangePointer(proseEdit, doc, report(['older'], ['older'])).route,
			askedAndMounted: buildChangePointer(proseEdit, doc, report(['p1'], ['p1'])).route,
			askedAndNotMounted: buildChangePointer(proseEdit, doc, report(['p1'], [])).route,
		}, {
			neverReported: 'unknown',
			reportPredatesTheChange: 'unknown',
			askedAndMounted: 'document',
			askedAndNotMounted: 'review',
		});
	});

	test('a pointer carries identity, address and size - and never the proposed prose', () => {
		const pointer = buildChangePointer(proseEdit, doc, report(['p1'], ['p1']));
		assert.deepStrictEqual({
			pointer,
			// The whole reason the model is structural: nothing on it repeats the proposal's words. A pointer
			// that carried `newText` would be the second copy this package exists to remove.
			carriesProse: JSON.stringify(pointer).includes('accelerated sharply'),
		}, {
			pointer: {
				changeId: 'p1',
				docId: 'file:///weekly.md',
				blockId: prose.id,
				insert: false,
				attention: true,
				blockLabel: 'Commentary',
				// "Commentary" is line 1, so the prose paragraph under it is line 2.
				line: 2,
				// The same word-run counts the inline widget prints for this change ("+3 added, 3 removed").
				added: 3,
				removed: 3,
				route: 'document',
			},
			carriesProse: false,
		});
	});

	test('an unloaded document, a deleted block and an insertion each degrade without inventing a route', () => {
		const orphan = change({ id: 'p6', blockId: 'gone', blockLabel: 'Commentary', oldText: 'x', newText: 'y' });
		assert.deepStrictEqual({
			// A document that is not loaded has no blocks to address, so the pointer carries no line - exactly as
			// the Review card's address citation already degrades. It has not reported either, so: unknown.
			unloadedDoc: buildChangePointer(proseEdit, undefined, undefined),
			// A block the document no longer has: no line to cite. The route still comes from the report, which
			// here says the surface was asked and mounted nothing.
			orphan: { line: buildChangePointer(orphan, doc, report(['p6'], [])).line, route: buildChangePointer(orphan, doc, report(['p6'], [])).route },
			// An insertion has no oldText to diff, so it reports no counts at all rather than a hollow "+1 -0".
			insertion: { added: buildChangePointer(insertion, doc, undefined).added, removed: buildChangePointer(insertion, doc, undefined).removed, insert: true },
		}, {
			unloadedDoc: {
				changeId: 'p1', docId: 'file:///weekly.md', blockId: prose.id, insert: false, attention: true,
				blockLabel: 'Commentary', added: 3, removed: 3, route: 'unknown',
			},
			orphan: { line: undefined, route: 'review' },
			insertion: { added: undefined, removed: undefined, insert: true },
		});
	});

	test('a turn shows pointers only for the changes still pending, each routed by its own document', () => {
		// The turn proposed three changes; one has since been approved (so it left the pending set) and one id
		// belongs to a different turn. The transcript must show exactly the two that are still open - and each
		// takes its route from ITS OWN document's report, because one turn can propose across documents.
		const stillPending = [listEdit, proseEdit, boundEdit];
		const reports = new Map<string, IInlineWidgetReport>([['file:///weekly.md', report(['p1', 'p3'], ['p1'])]]);
		const pointers = buildTurnPointers(['p1', 'p3', 'p9-approved'], stillPending, () => doc, docId => reports.get(docId));
		assert.deepStrictEqual(pointers.map(p => ({ id: p.changeId, route: p.route, label: p.blockLabel })), [
			{ id: 'p3', route: 'review', label: 'Colour tokens' },
			{ id: 'p1', route: 'document', label: 'Commentary' },
		]);
	});

	test('a restored turn says what BECAME of its proposals - approved, rejected, or never reviewed', () => {
		// The defect (#312 fix round 2): every restored proposal printed the same sentence, "changes waiting for
		// review are cleared when the workspace closes". True of a change nobody reviewed; false of one the user
		// APPROVED, which is on disk and in the History tab. The app knew and said the wrong thing anyway.
		const say = (proposed: number, approved?: number, rejected?: number) => {
			const note = describeRestoredProposals(proposed, approved, rejected);
			return note ? `${note.tag}${note.applied ? '*' : ''} ${note.text}` : undefined;
		};
		assert.deepStrictEqual({
			approvedOne: say(1, 1, 0),
			approvedAll: say(3, 3, 0),
			rejectedOne: say(1, 0, 1),
			neverReviewed: say(2, 0, 0),
			mixed: say(3, 1, 2),
			partlyApproved: say(3, 1, 0),
			partlyRejected: say(3, 0, 1),
			allThree: say(4, 1, 2),
			// A turn that proposed nothing draws nothing at all - the chip is not a permanent fixture.
			none: say(0),
			// Nonsense counts (a hand-edited or future-versioned storage value) are clamped, never spoken: more
			// outcomes than proposals would print a sentence whose own numbers do not add up.
			overClaimed: say(1, 5, 5),
		}, {
			// The one outcome that LANDED, and the only one marked as applied.
			approvedOne: 'APPROVED* Proposed 1 change. You approved it, so it is in the document - the History tab has the record.',
			approvedAll: 'APPROVED* Proposed 3 changes. You approved them all, so they are in the document - the History tab has the record.',
			rejectedOne: 'REJECTED Proposed 1 change. You rejected it, so the document was left unchanged.',
			// The only case the original sentence was ever right about.
			neverReviewed: 'PAST Proposed 2 changes. They were never approved or rejected, and changes waiting for review are cleared when the workspace closes.',
			mixed: 'PAST Proposed 3 changes - 1 approved, 2 rejected.',
			partlyApproved: 'PAST Proposed 3 changes - 1 approved, 2 never reviewed before the workspace closed.',
			partlyRejected: 'PAST Proposed 3 changes - 1 rejected, 2 never reviewed before the workspace closed.',
			allThree: 'PAST Proposed 4 changes - 1 approved, 2 rejected, 1 never reviewed before the workspace closed.',
			none: undefined,
			overClaimed: 'APPROVED* Proposed 1 change. You approved it, so it is in the document - the History tab has the record.',
		});
	});
});
