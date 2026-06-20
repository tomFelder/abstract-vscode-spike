/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ILivingDoc, ILivingDocBlock } from './livingDocsModel.js';

// A Living Document is a portable Markdown file:
//   - YAML-ish frontmatter holds doc-level scalars (title, subtitle, source, syncedWeek)
//   - data-bindings live in HTML comments before the block they annotate, so the file still
//     renders cleanly in any Markdown viewer:
//       <!-- bind id=p-highlights kind=figure cells=mrr,signups,churn -->
//       <!-- table id=kpi-table cells=mrr,signups,churn,active -->

interface IAttrs {
	id?: string;
	kind?: 'figure' | 'narrative';
	cells: string[];
}

function parseAttrs(s: string): IAttrs {
	const out: IAttrs = { cells: [] };
	for (const tok of s.trim().split(/\s+/)) {
		const eq = tok.indexOf('=');
		if (eq < 0) { continue; }
		const key = tok.slice(0, eq);
		const value = tok.slice(eq + 1);
		if (key === 'cells') { out.cells = value ? value.split(',') : []; }
		else if (key === 'id') { out.id = value; }
		else if (key === 'kind') { out.kind = value === 'narrative' ? 'narrative' : 'figure'; }
	}
	return out;
}

function slug(s: string): string {
	return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'section';
}

export function parseLivingDoc(text: string): ILivingDoc {
	let title = 'Untitled';
	let subtitle = '';
	let source = 'metrics.csv';
	let syncedWeek = 0;

	let body = text;
	const fm = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
	if (fm) {
		body = text.slice(fm[0].length);
		for (const line of fm[1].split(/\r?\n/)) {
			const i = line.indexOf(':');
			if (i < 0) { continue; }
			const key = line.slice(0, i).trim();
			const value = line.slice(i + 1).trim().replace(/^["']|["']$/g, '');
			if (key === 'title') { title = value; }
			else if (key === 'subtitle') { subtitle = value; }
			else if (key === 'source') { source = value; }
			else if (key === 'syncedWeek') { syncedWeek = parseInt(value, 10) || 0; }
		}
	}

	const blocks: ILivingDocBlock[] = [];
	let pending: IAttrs | undefined;
	let auto = 0;
	for (const raw of body.split(/\r?\n/)) {
		const line = raw.trim();
		if (!line) { continue; }

		let m = /^<!--\s*bind\s+(.*?)\s*-->$/.exec(line);
		if (m) { pending = parseAttrs(m[1]); continue; }

		m = /^<!--\s*table\s+(.*?)\s*-->$/.exec(line);
		if (m) {
			const a = parseAttrs(m[1]);
			blocks.push({ id: a.id ?? 'kpi-table', type: 'kpiTable', binding: { source, cells: a.cells } });
			continue;
		}

		if (line.startsWith('## ')) {
			const t = line.slice(3).trim();
			blocks.push({ id: 'h-' + slug(t), type: 'heading', text: t });
			continue;
		}
		if (line.startsWith('#')) { continue; } // title is taken from frontmatter

		if (pending) {
			blocks.push({ id: pending.id ?? 'p-' + (++auto), type: 'paragraph', kind: pending.kind, binding: { source, cells: pending.cells }, text: line });
			pending = undefined;
		} else {
			blocks.push({ id: 'p-' + (++auto), type: 'paragraph', text: line });
		}
	}

	return { title, subtitle, source, syncedWeek, blocks };
}

export function serializeLivingDoc(doc: ILivingDoc): string {
	const lines: string[] = [
		'---',
		'livingDoc: true',
		`title: ${doc.title}`,
		`subtitle: ${doc.subtitle}`,
		`source: ${doc.source}`,
		`syncedWeek: ${doc.syncedWeek}`,
		'---',
		'',
	];
	for (const b of doc.blocks) {
		if (b.type === 'heading') {
			lines.push(`## ${b.text ?? ''}`, '');
		} else if (b.type === 'kpiTable') {
			lines.push(`<!-- table id=${b.id} cells=${b.binding?.cells.join(',') ?? ''} -->`, '');
		} else {
			if (b.binding) {
				const kind = b.kind ? ` kind=${b.kind}` : '';
				lines.push(`<!-- bind id=${b.id}${kind} cells=${b.binding.cells.join(',')} -->`);
			}
			lines.push(b.text ?? '', '');
		}
	}
	return lines.join('\n').replace(/\n+$/, '\n');
}
