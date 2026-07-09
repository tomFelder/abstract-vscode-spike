/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// A generated scale fixture (plan 30, iter 1): a folder of N Living Documents bound to a HANDFUL of
// shared sources, so the performance harness and the on-disk scale sample are produced from ONE pure
// function. No file system, no service - just the in-memory doc + source text a caller writes into a
// mock (the harness) or to disk (the generator script). The point is a deterministic worst case: many
// documents fanned across a few sources, exactly the shape that exposed the serial all-docs sweep.

// One CSV source shared by many documents. The `week` column advances so a bump to the latest row is a
// realistic "one source changed" event the incremental-derivation track measures against.
export interface IScaleSource {
	/** The source file name as authored in frontmatter (e.g. "metrics-0.csv"). */
	readonly name: string;
	/** The CSV text (header + rows), latest row last. */
	readonly csv: string;
}

// One generated document: its file name and its Markdown text (frontmatter + a bound figure block per
// bind). No lock is emitted - the service builds the lock on first load, exactly as it does for a real
// authored file, so the fixture exercises the real resolve/sync path rather than a pre-baked shortcut.
export interface IScaleDoc {
	/** The document file name (e.g. "report-0.md"). */
	readonly name: string;
	/** The document's Markdown source text. */
	readonly md: string;
}

export interface IScaleFixture {
	readonly sources: readonly IScaleSource[];
	readonly docs: readonly IScaleDoc[];
}

// A small, fixed set of column names so a bind key is `<alias>.<col>`; four columns is enough to give
// each document distinct-looking figures while staying bound to the same shared CSVs.
const COLUMNS = ['mrr', 'signups', 'churn', 'active'] as const;

// The number of distinct shared CSV sources the documents fan across. Deliberately small (a "handful",
// per the plan) so the shared-source cache has real work to do: with 50 docs over 4 CSVs, ~12 docs
// bind each CSV, so a naive refresh reads each CSV ~12x and a cached one reads it once.
const SHARED_SOURCE_COUNT = 4;

// Build one shared CSV with a few rows of plausible numbers. Deterministic given its index so two runs
// of the generator produce byte-identical fixtures (the harness asserts on stable counts, not values).
function makeSource(index: number): IScaleSource {
	const base = 40000 + index * 1000;
	const rows = [
		'week,date,mrr,signups,churn,active',
		`22,Jun 08,${base},290,3.1,179`,
		`23,Jun 15,${base + 900},312,3.1,188`,
		`24,Jun 19,${base + 8300},427,2.4,205`,
	];
	return { name: `metrics-${index}.csv`, csv: rows.join('\n') + '\n' };
}

// Build one document that binds `bindsPerDoc` figures from a SINGLE shared source (round-robined across
// the source set), so a change to that one source re-derives a known slice of the folder. Each bind is a
// figure block authored at a stale value so the first refresh has a real reconcile to do.
function makeDoc(index: number, bindsPerDoc: number, source: IScaleSource): IScaleDoc {
	const alias = source.name.replace(/\.[^.]+$/, '');
	const lines: string[] = [
		'---',
		`title: Report ${index}`,
		'sources:',
		`  - ${source.name}`,
		'---',
		'',
		'## Numbers',
		'',
	];
	for (let b = 0; b < bindsPerDoc; b++) {
		const col = COLUMNS[b % COLUMNS.length];
		// Authored at a deliberately stale "pending" value so resolving against the CSV reconciles it.
		lines.push(`Metric ${b} is [pending](bind:${alias}.${col}).`);
		lines.push('');
	}
	return { name: `report-${index}.md`, md: lines.join('\n').replace(/\n+$/, '\n') };
}

/**
 * Generate a scale fixture: `docs` documents fanned across a handful of shared CSV sources, each
 * document carrying `bindsPerDoc` figure bindings from one shared source. Pure and deterministic - the
 * performance harness writes it into a mock file service; the `scripts/generate-scale-sample.js` script
 * writes it to disk. `bindsPerDoc` defaults to 4 (one per column, so a single row's worth of figures).
 */
export function makeScaleFixture(docs: number, bindsPerDoc: number = 4): IScaleFixture {
	const sources: IScaleSource[] = [];
	for (let s = 0; s < SHARED_SOURCE_COUNT; s++) { sources.push(makeSource(s)); }
	const generated: IScaleDoc[] = [];
	for (let d = 0; d < docs; d++) {
		generated.push(makeDoc(d, bindsPerDoc, sources[d % sources.length]));
	}
	return { sources, docs: generated };
}
