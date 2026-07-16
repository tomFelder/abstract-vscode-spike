/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { buildTidyPlan, ITidyInventoryItem, ITidyMove, TIDY_DEFAULT_STALE_WEEKS } from '../../common/tidyPlan.js';

suite('tidyPlan', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	// A fixed "now" and a helper to place a file's mtime a given number of weeks in the past, so the
	// no-edits-in-N-weeks staleness gate is exercised deterministically.
	const NOW = Date.parse('2026-07-15T00:00:00Z');
	const weeksAgo = (n: number) => NOW - n * 7 * 24 * 60 * 60 * 1000;

	function item(partial: Partial<ITidyInventoryItem> & { name: string }): ITidyInventoryItem {
		return { folder: '', referencedBy: 0, ...partial };
	}

	function plan(items: ITidyInventoryItem[]): readonly ITidyMove[] {
		return buildTidyPlan(items, { nowMs: NOW }).moves;
	}

	suite('data files', () => {
		test('a loose CSV / xlsx at the root is proposed for data/ with a plain reason', () => {
			const moves = plan([item({ name: 'metrics.csv' }), item({ name: 'Budget.xlsx' })]);
			assert.deepStrictEqual(moves, [
				{ from: 'Budget.xlsx', to: 'data/Budget.xlsx', reason: 'a data file sitting at the project root' },
				{ from: 'metrics.csv', to: 'data/metrics.csv', reason: 'a data file sitting at the project root' },
			]);
		});

		test('a BOUND data file that lives where its lock points is NOT proposed', () => {
			// referencedBy > 0: another document binds it as a sibling source - moving it is churn, so leave it.
			assert.deepStrictEqual(plan([item({ name: 'metrics.csv', referencedBy: 2 })]), []);
		});

		test('a data file already inside data/ is left alone (only the root is tidied)', () => {
			assert.deepStrictEqual(plan([item({ name: 'metrics.csv', folder: 'data' })]), []);
		});
	});

	suite('images', () => {
		test('a loose image at the root is proposed for assets/', () => {
			assert.deepStrictEqual(plan([item({ name: 'logo.png' })]), [
				{ from: 'logo.png', to: 'assets/logo.png', reason: 'an image sitting at the project root' },
			]);
		});

		test('a referenced image is not proposed', () => {
			assert.deepStrictEqual(plan([item({ name: 'logo.png', referencedBy: 1 })]), []);
		});
	});

	suite('templates', () => {
		test('a *.template.md loose at the root is proposed for templates/', () => {
			assert.deepStrictEqual(plan([item({ name: 'Weekly.template.md' })]), [
				{ from: 'Weekly.template.md', to: 'templates/Weekly.template.md', reason: 'a template kept outside the templates folder' },
			]);
		});

		test('a template already under templates/ is left alone', () => {
			assert.deepStrictEqual(plan([item({ name: 'Weekly.template.md', folder: 'templates' })]), []);
		});
	});

	suite('imported originals', () => {
		test('the untouched original of an imported document is proposed for archive/originals/', () => {
			assert.deepStrictEqual(plan([item({ name: 'Weekly Summary.docx', isImportedOriginal: true })]), [
				{ from: 'Weekly Summary.docx', to: 'archive/originals/Weekly Summary.docx', reason: 'the original of an imported document, now that a Markdown copy exists' },
			]);
		});
	});

	suite('superseded documents -> archive/', () => {
		test('an "-old" document, stale and unreferenced, is archived with the self-marking reason', () => {
			assert.deepStrictEqual(plan([item({ name: 'Board Note -old.md', mtimeMs: weeksAgo(6) })]), [
				{ from: 'Board Note -old.md', to: 'archive/Board Note -old.md', reason: `the name marks it as an old version, it has not been edited in ${TIDY_DEFAULT_STALE_WEEKS} weeks, and nothing references it` },
			]);
		});

		test('a lower version is archived and NAMES the newer sibling that supersedes it', () => {
			const moves = plan([
				item({ name: 'Plan v1.md', mtimeMs: weeksAgo(8) }),
				item({ name: 'Plan v2.md', mtimeMs: weeksAgo(1) }),
			]);
			assert.deepStrictEqual(moves, [
				{ from: 'Plan v1.md', to: 'archive/Plan v1.md', reason: `it looks superseded by "Plan v2.md", it has not been edited in ${TIDY_DEFAULT_STALE_WEEKS} weeks, and nothing references it` },
			]);
		});

		test('a numbered-copy duplicate is archived, superseded by the un-suffixed base', () => {
			const moves = plan([
				item({ name: 'Report.md', mtimeMs: weeksAgo(1) }),
				item({ name: 'Report (2).md', mtimeMs: weeksAgo(9) }),
			]);
			assert.deepStrictEqual(moves, [
				{ from: 'Report (2).md', to: 'archive/Report (2).md', reason: `it looks superseded by "Report.md", it has not been edited in ${TIDY_DEFAULT_STALE_WEEKS} weeks, and nothing references it` },
			]);
		});

		test('a RECENT superseded-looking document is NOT archived (the staleness floor holds)', () => {
			// "no edits in N weeks" is a hard gate: a copy edited last week may still be in use.
			assert.deepStrictEqual(plan([
				item({ name: 'Report.md', mtimeMs: weeksAgo(0) }),
				item({ name: 'Report copy.md', mtimeMs: weeksAgo(1) }),
			]), []);
		});

		test('a still-REFERENCED old document is NOT archived (would-orphan is the human\'s call, not ours)', () => {
			assert.deepStrictEqual(plan([item({ name: 'Board Note -old.md', mtimeMs: weeksAgo(12), referencedBy: 1 })]), []);
		});

		test('a lone "v2" with no earlier sibling is NOT archived (ambiguous - it is just the current doc)', () => {
			assert.deepStrictEqual(plan([item({ name: 'Plan v2.md', mtimeMs: weeksAgo(12) })]), []);
		});

		test('the newest version in a family is never archived, only the older members', () => {
			const moves = plan([
				item({ name: 'Deck v1.md', mtimeMs: weeksAgo(10) }),
				item({ name: 'Deck v2.md', mtimeMs: weeksAgo(9) }),
				item({ name: 'Deck v3.md', mtimeMs: weeksAgo(8) }),
			]);
			assert.deepStrictEqual(moves.map(m => m.from), ['Deck v1.md', 'Deck v2.md']);
			assert.ok(moves.every(m => m.reason.includes('"Deck v3.md"')));
		});
	});

	suite('working-files', () => {
		test('a scratch note is proposed for working-files/', () => {
			assert.deepStrictEqual(plan([item({ name: 'scratch.md' })]), [
				{ from: 'scratch.md', to: 'working-files/scratch.md', reason: 'a scratch working note that nothing references' },
			]);
		});

		test('a WIP thinking doc is proposed for working-files/', () => {
			assert.deepStrictEqual(plan([item({ name: 'pricing wip.md' })]), [
				{ from: 'pricing wip.md', to: 'working-files/pricing wip.md', reason: 'a scratch working note that nothing references' },
			]);
		});

		test('a referenced scratch doc is left alone (it is load-bearing)', () => {
			assert.deepStrictEqual(plan([item({ name: 'scratch.md', referencedBy: 1 })]), []);
		});

		test('"Meeting Notes" is NOT swept to working-files (conservative: notes are real deliverables)', () => {
			assert.deepStrictEqual(plan([item({ name: 'Meeting Notes.md', mtimeMs: weeksAgo(12) })]), []);
		});
	});

	suite('the honest empty plan', () => {
		test('an already-tidy project yields no moves (never a fabricated row)', () => {
			const moves = plan([
				item({ name: 'Weekly Summary.md', mtimeMs: weeksAgo(1), referencedBy: 0 }),
				item({ name: 'metrics.csv', folder: 'data', referencedBy: 3 }),
				item({ name: 'Weekly.template.md', folder: 'templates' }),
				item({ name: 'logo.png', folder: 'assets' }),
			]);
			assert.deepStrictEqual(moves, []);
		});

		test('a plain document with an ordinary name is never proposed', () => {
			assert.deepStrictEqual(plan([item({ name: 'Weekly Summary.md', mtimeMs: weeksAgo(50) })]), []);
		});
	});

	suite('a realistic mixed project', () => {
		test('sorts a full plan by destination then name, one reason each', () => {
			const moves = plan([
				item({ name: 'Weekly Summary.md', mtimeMs: weeksAgo(1) }),          // current doc - kept
				item({ name: 'metrics.csv' }),                                       // -> data/
				item({ name: 'raw.tsv' }),                                           // -> data/
				item({ name: 'diagram.svg' }),                                       // -> assets/
				item({ name: 'Weekly Summary -old.md', mtimeMs: weeksAgo(9) }),      // -> archive/
				item({ name: 'Old Brief.docx', isImportedOriginal: true }),          // -> archive/originals/
				item({ name: 'scratch.md' }),                                        // -> working-files/
				item({ name: 'Board Note.template.md' }),                            // -> templates/
			]);
			assert.deepStrictEqual(moves, [
				{ from: 'Old Brief.docx', to: 'archive/originals/Old Brief.docx', reason: 'the original of an imported document, now that a Markdown copy exists' },
				{ from: 'Weekly Summary -old.md', to: 'archive/Weekly Summary -old.md', reason: `the name marks it as an old version, it has not been edited in ${TIDY_DEFAULT_STALE_WEEKS} weeks, and nothing references it` },
				{ from: 'diagram.svg', to: 'assets/diagram.svg', reason: 'an image sitting at the project root' },
				{ from: 'metrics.csv', to: 'data/metrics.csv', reason: 'a data file sitting at the project root' },
				{ from: 'raw.tsv', to: 'data/raw.tsv', reason: 'a data file sitting at the project root' },
				{ from: 'Board Note.template.md', to: 'templates/Board Note.template.md', reason: 'a template kept outside the templates folder' },
				{ from: 'scratch.md', to: 'working-files/scratch.md', reason: 'a scratch working note that nothing references' },
			]);
		});
	});

	suite('the staleWeeks knob', () => {
		test('a shorter window archives a more recently-touched old doc', () => {
			const items = [item({ name: 'Note -old.md', mtimeMs: weeksAgo(2) })];
			assert.deepStrictEqual(buildTidyPlan(items, { nowMs: NOW, staleWeeks: 8 }).moves, []);
			assert.strictEqual(buildTidyPlan(items, { nowMs: NOW, staleWeeks: 1 }).moves.length, 1);
		});
	});
});
