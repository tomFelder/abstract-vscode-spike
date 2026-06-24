/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IBindLink, ILivingDoc, ILivingDocBlock, LivingDocBlockType } from './livingDocsModel.js';

// The clean-file format (spec 08). A Living Document is portable Markdown:
//   - YAML-ish frontmatter holds the title/subtitle and the `sources:` / `context:` dependency lists
//   - value bindings live inline as real Markdown links with a `bind:` scheme, so the file renders
//     correctly in any viewer and the resolved value is its own visible text:
//       Revenue grew [18%](bind:metrics.mrr.delta) week-on-week to [$48.6k](bind:metrics.mrr) MRR.
//
// There are no HTML comments, no `{cell}` placeholders, and no slugged block ids on disk: the bind
// link's key is the durable anchor. The companion `<doc>.lock.json` carries the dependency graph.

// Matches one inline bind link: [visible value](bind:key). The key runs to the closing paren and
// carries no whitespace, e.g. `metrics.mrr` or `metrics.mrr.delta`.
const BIND_LINK_RE = /\[([^\]]*)\]\(bind:([^)\s]+)\)/g;

/** Every bind-link occurrence in a span of Markdown, in document order. */
export function extractBindLinks(text: string): IBindLink[] {
	const out: IBindLink[] = [];
	for (const m of text.matchAll(BIND_LINK_RE)) {
		out.push({ value: m[1], key: m[2] });
	}
	return out;
}

/**
 * Rewrite the visible link text of every bind link to the resolved value from the lock (lock wins).
 * Keys absent from `resolved` keep their current cached text. This is the rendered-cache
 * reconciliation: the `.md` is brought in line with the lock's authoritative values.
 */
export function reconcileBindLinks(text: string, resolved: ReadonlyMap<string, string>): string {
	return text.replace(BIND_LINK_RE, (whole, _value: string, key: string) => {
		const next = resolved.get(key);
		return next === undefined ? whole : `[${next}](bind:${key})`;
	});
}

function slug(s: string): string {
	return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'section';
}

interface IFrontmatter {
	title: string;
	subtitle: string;
	sources: string[];
	context: string[];
}

// Parse the YAML-ish frontmatter: `title`/`subtitle` scalars and `sources:` / `context:` block
// lists (`- item` lines). Returns the frontmatter values and the body that follows.
function parseFrontmatter(text: string): { fm: IFrontmatter; body: string } {
	const fm: IFrontmatter = { title: '', subtitle: '', sources: [], context: [] };
	const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
	if (!match) {
		return { fm, body: text };
	}
	const lines = match[1].split(/\r?\n/);
	let listInto: string[] | undefined;
	for (const line of lines) {
		const item = /^\s+-\s+(.*)$/.exec(line);
		if (item && listInto) {
			const value = item[1].trim().replace(/^["']|["']$/g, '');
			if (value) { listInto.push(value); }
			continue;
		}
		const i = line.indexOf(':');
		if (i < 0) { continue; }
		const key = line.slice(0, i).trim();
		const value = line.slice(i + 1).trim().replace(/^["']|["']$/g, '');
		listInto = undefined;
		if (key === 'title') { fm.title = value; }
		else if (key === 'subtitle') { fm.subtitle = value; }
		else if (key === 'sources') { listInto = fm.sources; if (value) { fm.sources.push(value); } }
		else if (key === 'context') { listInto = fm.context; if (value) { fm.context.push(value); } }
	}
	return { fm, body: text.slice(match[0].length) };
}

function classify(chunk: string): LivingDocBlockType {
	const lines = chunk.split(/\r?\n/).filter(l => l.trim().length > 0);
	if (lines.length === 1 && /^#{1,6}\s+/.test(lines[0])) { return 'heading'; }
	if (lines.length > 0 && lines.every(l => l.trim().startsWith('|'))) { return 'table'; }
	return 'paragraph';
}

function blockFor(chunk: string, index: number): ILivingDocBlock {
	const type = classify(chunk);
	const binds = extractBindLinks(chunk);
	if (type === 'heading') {
		const m = /^(#{1,6})\s+(.*)$/.exec(chunk.trim())!;
		const headingText = m[2].trim();
		return { id: 'h-' + slug(headingText), type, text: headingText, level: m[1].length, binds };
	}
	return { id: 'b-' + index, type, text: chunk, binds };
}

export function parseLivingDoc(text: string): ILivingDoc {
	const { fm, body } = parseFrontmatter(text);
	const cleanBody = body.replace(/^\r?\n+/, '').replace(/\s+$/, '') + '\n';

	const blocks: ILivingDocBlock[] = [];
	let index = 0;
	for (const chunk of cleanBody.split(/\r?\n[ \t]*\r?\n/)) {
		if (chunk.trim().length === 0) { continue; }
		blocks.push(blockFor(chunk.replace(/\s+$/, ''), index++));
	}

	const hasBinds = blocks.some(b => b.binds.length > 0);
	const isLiving = fm.sources.length > 0 || fm.context.length > 0 || hasBinds;

	let title = fm.title;
	if (!title) {
		const h1 = blocks.find(b => b.type === 'heading' && b.level === 1);
		title = h1 ? h1.text : 'Untitled';
	}

	return {
		title,
		subtitle: fm.subtitle,
		sources: fm.sources,
		context: fm.context,
		blocks,
		isLiving,
		body: cleanBody,
	};
}

// Render one block back to its Markdown source. Headings re-emit their `#` prefix from the level;
// everything else round-trips its raw text verbatim.
function serializeBlock(block: ILivingDocBlock): string {
	if (block.type === 'heading') {
		return `${'#'.repeat(block.level ?? 2)} ${block.text}`;
	}
	return block.text;
}

// Add or remove a single `source` in the document's frontmatter `sources:` list, returning the new raw
// text with the body left verbatim. Creates a frontmatter block if the doc has none; drops the `sources:`
// key when the last source is removed. Idempotent (adding an existing / removing an absent source is a no-op).
export function withFrontmatterSource(text: string, source: string, add: boolean): string {
	const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
	if (!match) {
		// A plain doc gains its first source: prepend a minimal frontmatter block (no-op on remove).
		return add ? `---\nsources:\n  - ${source}\n---\n\n${text}` : text;
	}

	// Walk the frontmatter lines, lifting out the existing `sources:` block (key + its `- ` items) and
	// keeping everything else (title/subtitle, the context block) in place.
	const kept: string[] = [];
	const existing: string[] = [];
	let sourcesAt = -1;
	let inSources = false;
	for (const line of match[1].split(/\r?\n/)) {
		const item = /^\s+-\s+(.*)$/.exec(line);
		if (inSources && item) {
			existing.push(item[1].trim().replace(/^["']|["']$/g, ''));
			continue;
		}
		inSources = false;
		const colon = line.indexOf(':');
		const key = colon >= 0 ? line.slice(0, colon).trim() : '';
		if (key === 'sources') {
			inSources = true;
			sourcesAt = kept.length;
			const inline = line.slice(colon + 1).trim().replace(/^["']|["']$/g, '');
			if (inline) { existing.push(inline); }
			continue;
		}
		kept.push(line);
	}

	const changed = add ? !existing.includes(source) : existing.includes(source);
	if (!changed) { return text; }

	const next = add ? [...existing, source] : existing.filter(s => s !== source);
	const block = next.length ? ['sources:', ...next.map(s => `  - ${s}`)] : [];
	// Re-insert where `sources:` was; if the doc had none, place it before `context:` (or at the end).
	let insertAt = sourcesAt;
	if (insertAt < 0) {
		const ctxIdx = kept.findIndex(l => l.trim().startsWith('context:'));
		insertAt = ctxIdx >= 0 ? ctxIdx : kept.length;
	}
	const fmLines = [...kept.slice(0, insertAt), ...block, ...kept.slice(insertAt)];
	return `---\n${fmLines.join('\n')}\n---\n${text.slice(match[0].length)}`;
}

export function serializeLivingDoc(doc: ILivingDoc): string {
	const fm: string[] = ['---'];
	if (doc.title) { fm.push(`title: ${doc.title}`); }
	if (doc.subtitle) { fm.push(`subtitle: ${doc.subtitle}`); }
	if (doc.sources.length) {
		fm.push('sources:');
		for (const s of doc.sources) { fm.push(`  - ${s}`); }
	}
	if (doc.context.length) {
		fm.push('context:');
		for (const c of doc.context) { fm.push(`  - ${c}`); }
	}
	fm.push('---', '');

	const body = doc.blocks.map(serializeBlock).join('\n\n');
	return `${fm.join('\n')}\n${body}\n`;
}
