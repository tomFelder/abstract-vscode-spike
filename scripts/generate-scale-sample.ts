/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Generate an on-disk scale sample folder (plan 30, iter 1): 50 Living Documents fanned across 4 shared
// CSV sources, written under `living-docs-scale-sample/` at the repo root. Run via:
//
//   node scripts/generate-scale-sample.ts [docs] [bindsPerDoc]
//   node scripts/generate-scale-sample.ts 50 4
//
// The folder is gitignored (only this generator is tracked) - it is a throwaway performance fixture,
// regenerated on demand, never a committed artefact. The document + source SHAPE mirrors the pure
// `makeScaleFixture` used by the timing harness (src/.../test/browser/scaleFixture.ts): both produce N
// reports over a handful of shared CSVs so the on-disk run and the unit harness measure the same worst
// case. Kept in sync by hand (this script has no import path into src/ under the tsx/node runner).

// CommonJS-style requires: the repo's package.json is not `type: module`, so node runs this stripped-TS
// file as CJS (which gives us `__dirname` without ESM `import.meta`).
const fs = require('fs') as typeof import('fs');
const path = require('path') as typeof import('path');

const COLUMNS = ['mrr', 'signups', 'churn', 'active'];
const SHARED_SOURCE_COUNT = 4;

function makeSourceCsv(index: number): string {
	const base = 40000 + index * 1000;
	return [
		'week,date,mrr,signups,churn,active',
		`22,Jun 08,${base},290,3.1,179`,
		`23,Jun 15,${base + 900},312,3.1,188`,
		`24,Jun 19,${base + 8300},427,2.4,205`,
	].join('\n') + '\n';
}

function makeDocMd(index: number, bindsPerDoc: number, sourceName: string): string {
	const alias = sourceName.replace(/\.[^.]+$/, '');
	const lines: string[] = ['---', `title: Report ${index}`, 'sources:', `  - ${sourceName}`, '---', '', '## Numbers', ''];
	for (let b = 0; b < bindsPerDoc; b++) {
		const col = COLUMNS[b % COLUMNS.length];
		lines.push(`Metric ${b} is [pending](bind:${alias}.${col}).`);
		lines.push('');
	}
	return lines.join('\n').replace(/\n+$/, '\n');
}

function main(): void {
	const docs = Number(process.argv[2] ?? 50);
	const bindsPerDoc = Number(process.argv[3] ?? 4);
	const outDir = path.join(__dirname, '..', 'living-docs-scale-sample');
	fs.mkdirSync(outDir, { recursive: true });

	const sourceNames: string[] = [];
	for (let s = 0; s < SHARED_SOURCE_COUNT; s++) {
		const name = `metrics-${s}.csv`;
		sourceNames.push(name);
		fs.writeFileSync(path.join(outDir, name), makeSourceCsv(s));
	}
	for (let d = 0; d < docs; d++) {
		const sourceName = sourceNames[d % sourceNames.length];
		fs.writeFileSync(path.join(outDir, `report-${d}.md`), makeDocMd(d, bindsPerDoc, sourceName));
	}
	// A truthful project label for the web/memfs mount (plan 33, L5), so Home shows a real name.
	fs.writeFileSync(path.join(outDir, '.abstract-name'), 'Scale Sample\n');

	console.log(`Wrote ${docs} documents over ${SHARED_SOURCE_COUNT} shared sources to ${outDir}`);
}

main();
