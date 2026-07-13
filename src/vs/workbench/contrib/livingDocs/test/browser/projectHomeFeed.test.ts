/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { IAgentRun } from '../../common/livingDocsModel.js';
import { buildAwayFeed, classifyProjectChat, relativeTime } from '../../common/projectHomeFeed.js';

suite('livingDocs projectHomeFeed', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	// --- classifyProjectChat: the whole-project composer's question-vs-change routing (map-D24) ---

	test('a question-shaped input answers read-only even when it names a change verb', () => {
		assert.strictEqual(classifyProjectChat('What changed since Monday?'), 'question');
		assert.strictEqual(classifyProjectChat('How fresh is the revenue figure?'), 'question');
		// A `?` wins over a leading change verb: a question-shaped ask never silently mutates a document.
		assert.strictEqual(classifyProjectChat('Update the board note?'), 'question');
	});

	test('a leading interrogative or read-only ask is a question', () => {
		assert.strictEqual(classifyProjectChat('Summarise the project'), 'question');
		assert.strictEqual(classifyProjectChat('Tell me which policies are stale'), 'question');
		assert.strictEqual(classifyProjectChat('List the documents with pending changes'), 'question');
	});

	test('a leading change verb opens a change request', () => {
		assert.strictEqual(classifyProjectChat('Update every policy to reflect the 3 March decisions'), 'change');
		assert.strictEqual(classifyProjectChat('Add a risks section to the board note'), 'change');
		assert.strictEqual(classifyProjectChat('Rewrite the summary in plain words'), 'change');
	});

	test('an ambiguous statement defaults to a read-only question (never a silent mutation)', () => {
		assert.strictEqual(classifyProjectChat('the revenue looks off'), 'question');
		assert.strictEqual(classifyProjectChat(''), 'question');
		assert.strictEqual(classifyProjectChat('   '), 'question');
	});

	// --- buildAwayFeed: the WHILE YOU WERE AWAY feed assembly (ordering, cutoff, empty states) ---

	function run(agentId: string, startedAt: string, over: Partial<IAgentRun> = {}): IAgentRun {
		return { agentId, startedAt, applied: 0, queued: 0, ...over };
	}

	const now = Date.parse('2026-07-13T12:00:00Z');
	const names = { refresh: 'Weekly refresh', audit: 'Compliance audit' };

	test('orders rows newest-first and resolves agent names', () => {
		const feed = buildAwayFeed({
			runs: [
				run('refresh', '2026-07-13T09:00:00Z', { queued: 2 }),
				run('audit', '2026-07-13T11:00:00Z', { queued: 1 }),
				run('refresh', '2026-07-12T09:00:00Z', { queued: 3 }),
			],
			agentNames: names,
			needsYouTotal: 6,
			sinceMs: Date.parse('2026-07-10T00:00:00Z'),
			nowMs: now,
		});
		assert.strictEqual(feed.rows.length, 3);
		assert.strictEqual(feed.rows[0].agentName, 'Compliance audit', 'newest run (11:00) leads');
		assert.strictEqual(feed.rows[1].agentName, 'Weekly refresh');
		assert.strictEqual(feed.rows[2].startedAtMs, Date.parse('2026-07-12T09:00:00Z'), 'oldest run last');
		assert.strictEqual(feed.hasActivity, true);
		assert.strictEqual(feed.allClear, false);
		assert.strictEqual(feed.firstVisit, false);
	});

	test('the since-last-visit cutoff excludes runs at or before the cutoff', () => {
		const cutoff = Date.parse('2026-07-13T10:00:00Z');
		const feed = buildAwayFeed({
			runs: [
				run('audit', '2026-07-13T11:00:00Z'),  // after the cutoff -> shown
				run('refresh', '2026-07-13T10:00:00Z'), // exactly at the cutoff -> excluded (strictly after)
				run('refresh', '2026-07-13T08:00:00Z'), // before the cutoff -> excluded
			],
			agentNames: names,
			needsYouTotal: 0,
			sinceMs: cutoff,
			nowMs: now,
		});
		assert.strictEqual(feed.rows.length, 1, 'only the run after the cutoff is in the window');
		assert.strictEqual(feed.rows[0].startedAtMs, Date.parse('2026-07-13T11:00:00Z'));
	});

	test('the first visit (no cutoff) shows every recorded run', () => {
		const feed = buildAwayFeed({
			runs: [run('audit', '2026-07-01T11:00:00Z'), run('refresh', '2026-06-01T09:00:00Z')],
			agentNames: names,
			needsYouTotal: 4,
			sinceMs: undefined,
			nowMs: now,
		});
		assert.strictEqual(feed.rows.length, 2);
		assert.strictEqual(feed.firstVisit, true);
	});

	test('an empty window is honest: no rows, and all-clear tracks the live pending set', () => {
		const feed = buildAwayFeed({
			runs: [run('refresh', '2026-07-01T09:00:00Z')],
			agentNames: names,
			needsYouTotal: 0,
			sinceMs: Date.parse('2026-07-10T00:00:00Z'),
			nowMs: now,
		});
		assert.strictEqual(feed.rows.length, 0, 'no run since the cutoff -> empty feed, never a fabricated row');
		assert.strictEqual(feed.hasActivity, false);
		assert.strictEqual(feed.allClear, true, 'nothing pending -> the map-D14 all-clear');
	});

	test('all-clear is false whenever the live pending set is non-empty, even with no runs', () => {
		const feed = buildAwayFeed({ runs: [], agentNames: names, needsYouTotal: 3, sinceMs: 1, nowMs: now });
		assert.strictEqual(feed.hasActivity, false);
		assert.strictEqual(feed.allClear, false);
	});

	test('rows carry the run outcome: queued (needs-you), failures and skips', () => {
		const feed = buildAwayFeed({
			runs: [
				run('refresh', '2026-07-13T11:00:00Z', { queued: 2, applied: 1, docsTouched: 4, via: 'cron' }),
				run('audit', '2026-07-13T10:30:00Z', { error: 'source unreadable' }),
				run('audit', '2026-07-13T10:00:00Z', { skippedReason: 'still-running' }),
			],
			agentNames: names,
			needsYouTotal: 2,
			sinceMs: Date.parse('2026-07-13T00:00:00Z'),
			nowMs: now,
		});
		assert.strictEqual(feed.rows[0].queued, 2);
		assert.strictEqual(feed.rows[0].applied, 1);
		assert.strictEqual(feed.rows[0].docsTouched, 4);
		assert.strictEqual(feed.rows[0].via, 'cron');
		assert.strictEqual(feed.rows[1].failed, true);
		assert.strictEqual(feed.rows[1].error, 'source unreadable');
		assert.strictEqual(feed.rows[2].skipped, true);
	});

	test('the row cap keeps the feed calm (maxRows)', () => {
		const runs = Array.from({ length: 10 }, (_v, i) => run('refresh', `2026-07-13T0${i}:00:00Z`.replace('T010', 'T10')));
		const feed = buildAwayFeed({ runs, agentNames: names, needsYouTotal: 0, sinceMs: 0, nowMs: now, maxRows: 4 });
		assert.strictEqual(feed.rows.length, 4);
	});

	// --- relativeTime ---

	test('relativeTime reads in plain, non-negative units', () => {
		assert.strictEqual(relativeTime(now, now), 'just now');
		assert.strictEqual(relativeTime(now - 5 * 60 * 1000, now), '5m ago');
		assert.strictEqual(relativeTime(now - 2 * 60 * 60 * 1000, now), '2h ago');
		assert.strictEqual(relativeTime(now - 3 * 24 * 60 * 60 * 1000, now), '3d ago');
		assert.strictEqual(relativeTime(now - 14 * 24 * 60 * 60 * 1000, now), '2w ago');
		// An unparseable/zero instant never shows a negative age.
		assert.strictEqual(relativeTime(0, now), 'just now');
	});
});
