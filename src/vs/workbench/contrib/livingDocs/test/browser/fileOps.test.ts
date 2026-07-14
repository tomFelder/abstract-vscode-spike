/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { emptyLock, ILivingDocLock } from '../../common/livingDocsModel.js';
import { IFileRef, rewriteLockSources, scanDependents, sidecarNameFor } from '../../common/fileOps.js';

suite('fileOps', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	suite('sidecarNameFor', () => {
		test('a .md document maps to a <stem>.lock.json sidecar', () => {
			assert.strictEqual(sidecarNameFor('Board Note.md'), 'Board Note.lock.json');
			assert.strictEqual(sidecarNameFor('Weekly Summary.md'), 'Weekly Summary.lock.json');
		});

		test('a non-.md file keeps its full name (its notional sidecar never exists on disk)', () => {
			// A data source (csv/json) has no `.md` to strip, so the pairing move finds no sidecar to carry.
			assert.strictEqual(sidecarNameFor('metrics.csv'), 'metrics.csv.lock.json');
		});

		test('only a trailing .md is stripped (an interior .md is preserved)', () => {
			assert.strictEqual(sidecarNameFor('notes.md.md'), 'notes.md.lock.json');
			assert.strictEqual(sidecarNameFor('readme.mdx'), 'readme.mdx.lock.json');
		});
	});

	suite('scanDependents', () => {
		const docs: readonly IFileRef[] = [
			{ id: 'file:///ws/Board%20Note.md', title: 'Board Note', sources: ['metrics.csv'], context: ['market-research.md'] },
			{ id: 'file:///ws/Weekly%20Summary.md', title: 'Weekly Summary', sources: ['metrics.csv'], context: [] },
			{ id: 'file:///ws/Team%20Notes.md', title: 'Team Notes', sources: [], context: [] },
		];

		test('lists the documents that bind a source, sorted by title, with viaSources set', () => {
			const deps = scanDependents(docs, 'metrics.csv');
			assert.deepStrictEqual(deps.map(d => d.title), ['Board Note', 'Weekly Summary']);
			assert.ok(deps.every(d => d.viaSources && !d.viaContext));
		});

		test('a context-only reference is reported viaContext', () => {
			const deps = scanDependents(docs, 'market-research.md');
			assert.deepStrictEqual(deps.map(d => ({ title: d.title, viaSources: d.viaSources, viaContext: d.viaContext })), [
				{ title: 'Board Note', viaSources: false, viaContext: true },
			]);
		});

		test('the file\'s own document is never its own dependent', () => {
			const deps = scanDependents(docs, 'metrics.csv', 'file:///ws/Board%20Note.md');
			assert.deepStrictEqual(deps.map(d => d.title), ['Weekly Summary']);
		});

		test('an unreferenced file has no dependents (the honest empty state)', () => {
			assert.deepStrictEqual(scanDependents(docs, 'nowhere.csv'), []);
		});
	});

	suite('rewriteLockSources', () => {
		function lockWith(source: string): ILivingDocLock {
			const lock = emptyLock();
			lock.bindings['metrics.mrr'] = { resolved: '$48.6k', source, sourceHash: 'abc', syncedAt: '2026-01-01T00:00:00Z', appliedBy: 'agent', kind: 'figure' };
			return lock;
		}

		test('rewrites a binding source prefix and preserves the #field qualifier', () => {
			const { lock, changed } = rewriteLockSources(lockWith('metrics.csv#mrr'), 'metrics.csv', 'kpis.csv');
			assert.strictEqual(changed, true);
			assert.strictEqual(lock.bindings['metrics.mrr'].source, 'kpis.csv#mrr');
		});

		test('rewrites a bare (no #field) binding source', () => {
			const { lock, changed } = rewriteLockSources(lockWith('metrics.csv'), 'metrics.csv', 'kpis.csv');
			assert.strictEqual(changed, true);
			assert.strictEqual(lock.bindings['metrics.mrr'].source, 'kpis.csv');
		});

		test('re-homes a context entry keyed by the renamed file', () => {
			const lock = emptyLock();
			lock.context['market-research.md'] = { reviewedHash: 'h', reviewedAt: '2026-01-01T00:00:00Z', scope: 'document' };
			const { lock: next, changed } = rewriteLockSources(lock, 'market-research.md', 'research.md');
			assert.strictEqual(changed, true);
			assert.ok(next.context['research.md']);
			assert.strictEqual(next.context['market-research.md'], undefined);
		});

		test('a partial-name collision is not rewritten (metrics.csv2 is untouched when renaming metrics.csv)', () => {
			const { lock, changed } = rewriteLockSources(lockWith('metrics.csv2#mrr'), 'metrics.csv', 'kpis.csv');
			assert.strictEqual(changed, false);
			assert.strictEqual(lock.bindings['metrics.mrr'].source, 'metrics.csv2#mrr');
		});

		test('does not mutate the input lock (returns a fresh copy)', () => {
			const input = lockWith('metrics.csv#mrr');
			const { lock } = rewriteLockSources(input, 'metrics.csv', 'kpis.csv');
			assert.strictEqual(input.bindings['metrics.mrr'].source, 'metrics.csv#mrr');
			assert.notStrictEqual(lock, input);
		});

		test('no reference to the old name is a no-op change=false', () => {
			const { changed } = rewriteLockSources(lockWith('other.csv#x'), 'metrics.csv', 'kpis.csv');
			assert.strictEqual(changed, false);
		});
	});
});
