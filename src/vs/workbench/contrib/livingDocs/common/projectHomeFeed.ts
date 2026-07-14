/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IAgentRun } from './livingDocsModel.js';

// Project Home's "front door" model (F15 / journey 1w): the WHILE YOU WERE AWAY feed and the
// whole-project chat composer's intent classifier, kept as a pure, DOM-free module so the render
// layer stays a thin HTML mapper and the logic is unit-testable.
//
// Real data only (the X2 lesson applied to the front door): the feed is assembled from the persisted
// agent run log, filtered to what actually happened since the user's last visit. Nothing is fabricated -
// when nothing ran since the cutoff the feed is empty, and when nothing needs review the surface promotes
// the honest all-clear ("Everything is in sync"), never a seeded row.

/** Whether the whole-project composer input reads as a read-only question or a change request (map-D24). */
export type ProjectChatIntent = 'question' | 'change';

// Verbs that open a change request when they lead the composer input (imperative to mutate the project).
// A leading change verb routes to the run/task surface; everything else answers read-only (the safe
// default - a question never silently mutates a document).
const CHANGE_VERBS = new Set([
	'add', 'append', 'adjust', 'apply', 'change', 'convert', 'correct', 'create', 'delete', 'draft',
	'edit', 'fix', 'generate', 'insert', 'make', 'move', 'refactor', 'remove', 'rename', 'replace',
	'revise', 'rewrite', 'set', 'tidy', 'turn', 'update', 'write',
]);

// Words that open a read-only question when they lead the input (interrogatives + read-only asks).
const QUESTION_WORDS = new Set([
	'am', 'are', 'can', 'could', 'compare', 'did', 'do', 'does', 'explain', 'find', 'had', 'has', 'have',
	'how', 'is', 'list', 'may', 'might', 'should', 'show', 'summarise', 'summarize', 'tell', 'was', 'were',
	'what', 'when', 'where', 'which', 'who', 'whom', 'whose', 'why', 'will', 'would',
]);

/**
 * Classify a whole-project composer input as a read-only question or a change request (journey 1w / map-D24:
 * "asking a question answers read-only with citations; asking for a change opens a task tab"). Read-only is
 * the safe default, so the routing only opens a change when the intent is unambiguous:
 *   1. input ending with `?` is a question (a question-shaped ask never silently mutates a document),
 *   2. otherwise a leading change verb ("Update the figures", "Add a risks section") is a change request,
 *   3. otherwise a leading interrogative / read-only ask ("What changed", "Summarise the project") is a question,
 *   4. otherwise it defaults to a question (answer read-only rather than guess at a mutation).
 */
export function classifyProjectChat(text: string): ProjectChatIntent {
	const trimmed = text.trim();
	if (!trimmed) { return 'question'; }
	if (trimmed.endsWith('?')) { return 'question'; }
	// The first alphabetic word, lower-cased and stripped of trailing punctuation, drives the leading-word test.
	const first = (trimmed.toLowerCase().match(/[a-z']+/)?.[0]) ?? '';
	if (CHANGE_VERBS.has(first)) { return 'change'; }
	if (QUESTION_WORDS.has(first)) { return 'question'; }
	return 'question';
}

/** One WHILE YOU WERE AWAY row: an agent run recorded since the user's last visit, with its needs-you count. */
export interface IAwayFeedRow {
	/** The agent's human name (resolved from the registry; falls back to the agent id). */
	readonly agentName: string;
	/** Epoch ms of the run start (0 when the timestamp is unparseable, so ordering never throws). */
	readonly startedAtMs: number;
	/** A relative-time label for the run start, e.g. "2h ago". */
	readonly whenLabel: string;
	/** Figures auto-applied by the run (informational). */
	readonly applied: number;
	/** Changes the run queued for review - the row's contribution to the needs-you count. */
	readonly queued: number;
	/** How many documents the run processed. */
	readonly docsTouched: number;
	/** True when the run failed (its runner threw); `error` then carries the reported reason. */
	readonly failed: boolean;
	/** The failure string when the run errored (shown on the row / hover), absent on a clean run. */
	readonly error?: string;
	/** True when the run was skipped because a previous run of the same agent was still in flight. */
	readonly skipped: boolean;
	/** Which trigger kind fired the run (cron / heartbeat / event / manual), for the "via" hint. */
	readonly via?: string;
}

/** The assembled WHILE YOU WERE AWAY feed + the all-clear state that drives the map-D14 promotion. */
export interface IAwayFeed {
	/** The feed rows (agent runs since the cutoff), newest-first, capped. */
	readonly rows: readonly IAwayFeedRow[];
	/** True when at least one run happened since the cutoff (drives the section-vs-empty choice). */
	readonly hasActivity: boolean;
	/** The live pending set total across the project (the real needs-you count - never fabricated). */
	readonly needsYouTotal: number;
	/** True when nothing needs review (map-D14 all-clear: "Everything is in sync"). */
	readonly allClear: boolean;
	/** True when this is the first visit (no recorded last-visit cutoff), so the copy can say so honestly. */
	readonly firstVisit: boolean;
}

export interface IAwayFeedInput {
	/** The persisted run log, in any order (typically newest-first from `getAgentRuns`). */
	readonly runs: readonly IAgentRun[];
	/** agentId -> human name, for resolving each row's label (falls back to the id when absent). */
	readonly agentNames: Readonly<Record<string, string>>;
	/** The live pending set total across the project (the real needs-you count). */
	readonly needsYouTotal: number;
	/** The last-visit cutoff in epoch ms; only runs started strictly after it are shown. Undefined on the
	 *  first visit, when every recorded run is shown (there is no prior visit to bound the window). */
	readonly sinceMs?: number;
	/** "now" in epoch ms, for the relative-time labels. */
	readonly nowMs: number;
	/** Cap on the number of rows (default 6). */
	readonly maxRows?: number;
}

/**
 * Assemble the WHILE YOU WERE AWAY feed from the persisted run log (journey 1w frame-1 floor). Runs are
 * filtered to the since-last-visit window (strictly after `sinceMs`; on the first visit every run is shown),
 * ordered newest-first, and capped. Real data only: an empty window yields an empty feed, and `allClear`
 * reflects the true live pending set - the caller renders the honest all-clear when it is zero.
 */
export function buildAwayFeed(input: IAwayFeedInput): IAwayFeed {
	const maxRows = input.maxRows ?? 6;
	const firstVisit = input.sinceMs === undefined;
	const rows: IAwayFeedRow[] = input.runs
		.map(run => toRow(run, input.agentNames, input.nowMs))
		// Since-last-visit cutoff: on a later visit only runs strictly after the cutoff; on the first visit all.
		.filter(row => firstVisit || row.startedAtMs > input.sinceMs!)
		.sort((a, b) => b.startedAtMs - a.startedAtMs)
		.slice(0, maxRows);
	return {
		rows,
		hasActivity: rows.length > 0,
		needsYouTotal: input.needsYouTotal,
		allClear: input.needsYouTotal === 0,
		firstVisit,
	};
}

function toRow(run: IAgentRun, agentNames: Readonly<Record<string, string>>, nowMs: number): IAwayFeedRow {
	const startedAtMs = Date.parse(run.startedAt) || 0;
	return {
		agentName: agentNames[run.agentId] ?? run.agentId,
		startedAtMs,
		whenLabel: relativeTime(startedAtMs, nowMs),
		applied: run.applied ?? 0,
		queued: run.queued ?? 0,
		docsTouched: run.docsTouched ?? 0,
		failed: !!run.error,
		error: run.error,
		skipped: run.skippedReason === 'still-running',
		via: run.via,
	};
}

/**
 * A compact relative-time label for a past instant ("just now", "5m ago", "2h ago", "3d ago", "2w ago").
 * A future or unparseable instant (0) reads "just now" so the label never shows a negative age.
 */
export function relativeTime(fromMs: number, nowMs: number): string {
	const deltaMs = nowMs - fromMs;
	if (!fromMs || deltaMs < 45 * 1000) { return 'just now'; }
	const minutes = Math.round(deltaMs / (60 * 1000));
	if (minutes < 60) { return `${minutes}m ago`; }
	const hours = Math.round(deltaMs / (60 * 60 * 1000));
	if (hours < 24) { return `${hours}h ago`; }
	const days = Math.round(deltaMs / (24 * 60 * 60 * 1000));
	if (days < 7) { return `${days}d ago`; }
	const weeks = Math.round(deltaMs / (7 * 24 * 60 * 60 * 1000));
	return `${weeks}w ago`;
}
