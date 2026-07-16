/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// The pure, DOM-free half of the docx -> Markdown import pipeline (doc 22 section 2, issue #129). The
// docx-specific parsing (mammoth: docx -> semantic HTML + extracted images + the fidelity detections) runs
// in the node/proxy layer where file access lives (scripts/lwd-model-broker.js, POST /import/docx); this
// module turns that HTML into GFM Markdown, lifts embedded images out to `assets/<doc>/`, and folds the real
// kept/dropped fidelity summary the import card shows. It is string-in/data-out with no imports so it runs
// identically in the renderer and in the Node test harness - the fidelity mapping the acceptance criteria
// bite on is fully unit-testable, independent of whether mammoth is installed or a full build is up.
//
// mammoth emits a small, predictable HTML subset (h1-h6, p, ul/ol/li, strong/em, a, table/tr/td+th, img,
// blockquote, br, sup/sub) so the converter parses exactly that subset and is tolerant of anything else
// (an unknown tag is transparent - its text survives, its wrapper is dropped) - never a silent mangle.

/**
 * The fidelity detections the node layer reads off the raw docx parts (doc 22 section 2's "named and
 * dropped" list). Each flag is true only when the original document actually contained that structure, so
 * the kept/dropped card names a limitation only when it really applies - never a fabricated caveat.
 */
export interface IDocxDetections {
	/** The document carried Word comments (a `<w:commentReference>` / a `word/comments.xml` part). */
	readonly comments: boolean;
	/** The document carried tracked changes (`<w:ins>` / `<w:del>` runs). Their FINAL text is imported. */
	readonly trackedChanges: boolean;
	/** The document carried footnotes or endnotes (`word/footnotes.xml` / `word/endnotes.xml`). */
	readonly footnotes: boolean;
	/** The document carried text boxes (`<w:txbxContent>`). */
	readonly textboxes: boolean;
	/** The document carried non-empty headers or footers (`word/header*.xml` / `word/footer*.xml`). */
	readonly headersFooters: boolean;
}

/** No detections - the honest default for a plain document with none of the "named and dropped" structures. */
export function noDetections(): IDocxDetections {
	return { comments: false, trackedChanges: false, footnotes: false, textboxes: false, headersFooters: false };
}

/** One image lifted out of the converted HTML, ready to be written under `assets/<doc>/` by the service. */
export interface IExtractedImage {
	/** The on-disk asset name, e.g. "image-1.png" (unique within the document's assets folder). */
	readonly name: string;
	/** The image MIME, e.g. "image/png", from the source data URI. */
	readonly contentType: string;
	/** The image bytes, base64-encoded (as they arrived in the data URI). */
	readonly base64: string;
}

/** The whole conversion result: the Markdown body, the extracted images, and the fidelity summary. */
export interface IDocxConversion {
	/** The GFM Markdown body (no frontmatter - the service adds provenance to the lock, not the file). */
	readonly markdown: string;
	/** Embedded images, lifted to `assets/<doc>/` with the body referencing them relatively. */
	readonly images: readonly IExtractedImage[];
	/** The plain-words "kept" phrases for the summary card (e.g. "Headings", "3 images"). */
	readonly kept: readonly string[];
	/** The plain-words "not imported" phrases for the summary card (e.g. "Comments"). */
	readonly dropped: readonly string[];
}

// The file extension we give a lifted image, keyed off its data-URI MIME; unknown types keep a generic .png
// so the reference still renders rather than downloading. Kept local (a superset of the paste helper's map).
const MIME_EXT: Record<string, string> = {
	'image/png': 'png',
	'image/jpeg': 'jpg',
	'image/jpg': 'jpg',
	'image/gif': 'gif',
	'image/webp': 'webp',
	'image/svg+xml': 'svg',
	'image/bmp': 'bmp',
	'image/tiff': 'tiff',
	'image/x-emf': 'emf',
	'image/x-wmf': 'wmf',
};

// --- a tiny, tolerant HTML tokeniser for mammoth's known output subset ---

interface IElementNode {
	readonly type: 'element';
	readonly tag: string;
	readonly attrs: Record<string, string>;
	readonly children: HtmlNode[];
}
interface ITextNode {
	readonly type: 'text';
	readonly text: string;
}
type HtmlNode = IElementNode | ITextNode;

// Void elements never have children / a closing tag; mammoth only emits <img> and <br> from this set.
const VOID_TAGS = new Set(['img', 'br', 'hr', 'meta', 'link', 'input']);

function decodeEntities(s: string): string {
	// One pass so an already-escaped sequence like `&amp;lt;` (mammoth's encoding of the literal text `&lt;`)
	// decodes to `&lt;` and stops - a sequential chain would run `&amp;`->`&` first, then re-decode the `&lt;`
	// it produced into `<`, silently mangling literal prose (the module's "never a silent mangle" rule).
	return s.replace(/&(?:(?<named>nbsp|amp|lt|gt|quot|apos)|#(?<dec>\d+)|#x(?<hex>[0-9a-fA-F]+));/g, (match: string, named?: string, dec?: string, hex?: string) => {
		switch (named) {
			case 'nbsp': return ' ';
			case 'amp': return '&';
			case 'lt': return '<';
			case 'gt': return '>';
			case 'quot': return '"';
			case 'apos': return '\'';
		}
		if (dec !== undefined) { return String.fromCodePoint(parseInt(dec, 10)); }
		if (hex !== undefined) { return String.fromCodePoint(parseInt(hex, 16)); }
		return match;
	});
}

function parseAttrs(raw: string): Record<string, string> {
	const attrs: Record<string, string> = {};
	const re = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*("([^"]*)"|'([^']*)')/g;
	let m: RegExpExecArray | null;
	while ((m = re.exec(raw)) !== null) {
		attrs[m[1].toLowerCase()] = decodeEntities(m[3] !== undefined ? m[3] : (m[4] ?? ''));
	}
	return attrs;
}

/**
 * Parse the mammoth HTML subset into a shallow node tree. Tolerant by construction: comments and the
 * `<html>/<body>` wrapper are ignored, an unrecognised tag still nests its children (so its text survives),
 * and an unbalanced/stray closing tag is dropped rather than throwing. Never mangles - worst case a wrapper
 * is flattened, never content lost.
 */
function parseHtml(html: string): HtmlNode[] {
	const root: IElementNode = { type: 'element', tag: '#root', attrs: {}, children: [] };
	const stack: IElementNode[] = [root];
	const tagRe = /<!--[\s\S]*?-->|<(\/?)([a-zA-Z][a-zA-Z0-9]*)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>/g;
	let last = 0;
	let m: RegExpExecArray | null;
	const pushText = (text: string) => {
		if (!text) { return; }
		const decoded = decodeEntities(text);
		if (decoded) { stack[stack.length - 1].children.push({ type: 'text', text: decoded }); }
	};
	while ((m = tagRe.exec(html)) !== null) {
		pushText(html.slice(last, m.index));
		last = tagRe.lastIndex;
		if (m[0].startsWith('<!--')) { continue; }
		const closing = m[1] === '/';
		const tag = m[2].toLowerCase();
		const selfClose = m[4] === '/' || VOID_TAGS.has(tag);
		if (closing) {
			// Pop up to the matching open tag; ignore a stray close with no match.
			for (let i = stack.length - 1; i > 0; i--) {
				if (stack[i].tag === tag) { stack.length = i; break; }
			}
			continue;
		}
		const node: IElementNode = { type: 'element', tag, attrs: parseAttrs(m[3]), children: [] };
		stack[stack.length - 1].children.push(node);
		if (!selfClose) { stack.push(node); }
	}
	pushText(html.slice(last));
	return root.children;
}

// --- feature tally, for the honest kept/dropped card ---

interface IFeatures {
	headings: boolean;
	lists: boolean;
	tables: number;
	images: number;
	links: boolean;
	emphasis: boolean;
	quotes: boolean;
}

// --- serialisation to GFM Markdown ---

function escapeText(s: string): string {
	// Minimal escaping: backslash first, then the characters that would otherwise start inline Markdown.
	return s.replace(/([\\`*_[\]])/g, '\\$1');
}

// escapeText only guards inline-significant characters. A plain paragraph whose text happens to BEGIN with a
// character that is significant only at the start of a line - '#'/'>' (heading/quote), '-'/'+' (list, '*' is
// already inline-escaped), an ordered-list '1.'/'1)', or a leading table '|' - would otherwise be reinterpreted
// as structure by a downstream Markdown renderer. Guard the leading marker, per line, so the prose survives
// literally (the module's "never a silent mangle" rule). Applied to paragraph blocks only; the headings, lists,
// quotes and tables this module emits build their own markers deliberately.
function escapeLeadingBlockMarkers(s: string): string {
	return s
		// Heading / blockquote / unordered-list / leading-pipe markers: escape the marker character itself.
		.replace(/^(?<lead>[ \t]*)(?<marker>#{1,6}(?= |\t|$)|>|[-+](?= |\t)|\|)/gm, '$<lead>\\$<marker>')
		// Ordered list ('1.' / '1)'): escape the delimiter so the digits stay literal prose.
		.replace(/^(?<lead>[ \t]*)(?<num>\d{1,9})(?<delim>[.)])(?= |\t|$)/gm, '$<lead>$<num>\\$<delim>');
}

// Collapse the runs of whitespace mammoth leaves between inline elements to a single space, the way HTML
// itself renders them, without eating a deliberate leading/trailing space between two inline runs.
function collapseWs(s: string): string {
	return s.replace(/\s+/g, ' ');
}

interface ISerializeCtx {
	readonly features: IFeatures;
	readonly images: IExtractedImage[];
	readonly stem: string;
	// Running per-extension counters so lifted images get stable, unique names (image-1.png, image-2.png...).
	imageCount: number;
}

// Serialise a node's children as INLINE Markdown (bold/italic/links/images/code/text). Block children that
// wander into an inline context (a stray <p> in a table cell) are flattened to their inline text.
function serializeInline(nodes: readonly HtmlNode[], ctx: ISerializeCtx): string {
	let out = '';
	for (const node of nodes) {
		if (node.type === 'text') {
			out += escapeText(collapseWs(node.text));
			continue;
		}
		switch (node.tag) {
			case 'strong': case 'b': {
				ctx.features.emphasis = true;
				const inner = serializeInline(node.children, ctx).trim();
				out += inner ? `**${inner}**` : '';
				break;
			}
			case 'em': case 'i': {
				ctx.features.emphasis = true;
				const inner = serializeInline(node.children, ctx).trim();
				out += inner ? `*${inner}*` : '';
				break;
			}
			case 'code': {
				const inner = serializeInline(node.children, ctx).trim();
				out += inner ? '`' + inner.replace(/`/g, '') + '`' : '';
				break;
			}
			case 'a': {
				const href = node.attrs['href'] ?? '';
				const inner = serializeInline(node.children, ctx).trim();
				if (href && inner) { ctx.features.links = true; out += `[${inner}](${href})`; }
				else { out += inner; }
				break;
			}
			case 'img': {
				out += serializeImage(node, ctx);
				break;
			}
			case 'br': {
				out += '\n';
				break;
			}
			case 'sup': case 'sub': {
				// GFM has no portable super/subscript; keep the text so a footnote marker survives visibly.
				out += serializeInline(node.children, ctx);
				break;
			}
			default: {
				// Unknown inline wrapper: transparent - keep the text.
				out += serializeInline(node.children, ctx);
			}
		}
	}
	return out;
}

// Lift an embedded (data-URI) image out to `assets/<stem>/image-N.ext` and return a relative Markdown ref.
// A non-data src (already a path/URL) is referenced as-is. Alt text is preserved.
function serializeImage(node: IElementNode, ctx: ISerializeCtx): string {
	const alt = (node.attrs['alt'] ?? '').replace(/[[\]]/g, '');
	const src = node.attrs['src'] ?? '';
	const dataMatch = /^data:([^;,]+)(;base64)?,(.*)$/i.exec(src);
	if (dataMatch && dataMatch[2]) {
		const contentType = dataMatch[1].toLowerCase();
		const ext = MIME_EXT[contentType] ?? 'png';
		const name = `image-${++ctx.imageCount}.${ext}`;
		ctx.images.push({ name, contentType, base64: dataMatch[3] });
		ctx.features.images++;
		return `![${alt}](assets/${ctx.stem}/${name})`;
	}
	if (src) { ctx.features.images++; return `![${alt}](${src})`; }
	return '';
}

// The header level for h1-h6 (defaults to 1 for a malformed tag).
function headingLevel(tag: string): number {
	const n = parseInt(tag.slice(1), 10);
	return n >= 1 && n <= 6 ? n : 1;
}

// Serialise one list (<ul>/<ol>) at a given indent depth, recursing into nested lists inside each <li>.
function serializeList(node: IElementNode, ordered: boolean, ctx: ISerializeCtx, depth: number): string {
	ctx.features.lists = true;
	const indent = '  '.repeat(depth);
	const lines: string[] = [];
	let index = 0;
	for (const child of node.children) {
		if (child.type !== 'element' || child.tag !== 'li') { continue; }
		index++;
		const marker = ordered ? `${index}.` : '-';
		// Split the <li> into its inline lead (the item text) and any nested lists that follow.
		const inlineParts: HtmlNode[] = [];
		const nested: IElementNode[] = [];
		for (const c of child.children) {
			if (c.type === 'element' && (c.tag === 'ul' || c.tag === 'ol')) { nested.push(c); }
			else if (c.type === 'element' && c.tag === 'p') { inlineParts.push(...c.children); }
			else { inlineParts.push(c); }
		}
		const text = serializeInline(inlineParts, ctx).trim();
		lines.push(`${indent}${marker} ${text}`.replace(/\s+$/, ''));
		for (const n of nested) { lines.push(serializeList(n, n.tag === 'ol', ctx, depth + 1)); }
	}
	return lines.join('\n');
}

// Serialise a <table> to a GFM pipe table. The first row is the header; a table with no rows yields nothing.
function serializeTable(node: IElementNode, ctx: ISerializeCtx): string {
	const rows: string[][] = [];
	const walkRows = (n: IElementNode) => {
		for (const child of n.children) {
			if (child.type !== 'element') { continue; }
			if (child.tag === 'tr') {
				const cells: string[] = [];
				for (const c of child.children) {
					if (c.type === 'element' && (c.tag === 'td' || c.tag === 'th')) {
						cells.push(serializeInline(c.children, ctx).replace(/\n+/g, ' ').replace(/\|/g, '\\|').trim());
					}
				}
				rows.push(cells);
			} else if (child.tag === 'thead' || child.tag === 'tbody' || child.tag === 'tfoot') {
				walkRows(child);
			}
		}
	};
	walkRows(node);
	if (!rows.length) { return ''; }
	ctx.features.tables++;
	const width = rows.reduce((w, r) => Math.max(w, r.length), 0);
	const pad = (r: string[]) => { const c = r.slice(); while (c.length < width) { c.push(''); } return c; };
	const header = pad(rows[0]);
	const lines = [`| ${header.join(' | ')} |`, `| ${header.map(() => '---').join(' | ')} |`];
	for (const r of rows.slice(1)) { lines.push(`| ${pad(r).join(' | ')} |`); }
	return lines.join('\n');
}

// Serialise the top-level (block) nodes into Markdown blocks separated by blank lines.
function serializeBlocks(nodes: readonly HtmlNode[], ctx: ISerializeCtx): string {
	const blocks: string[] = [];
	for (const node of nodes) {
		if (node.type === 'text') {
			const text = escapeText(collapseWs(node.text)).trim();
			if (text) { blocks.push(escapeLeadingBlockMarkers(text)); }
			continue;
		}
		switch (node.tag) {
			case 'h1': case 'h2': case 'h3': case 'h4': case 'h5': case 'h6': {
				const inner = serializeInline(node.children, ctx).trim();
				if (inner) { ctx.features.headings = true; blocks.push(`${'#'.repeat(headingLevel(node.tag))} ${inner}`); }
				break;
			}
			case 'p': {
				const inner = serializeInline(node.children, ctx).trim();
				if (inner) { blocks.push(escapeLeadingBlockMarkers(inner)); }
				break;
			}
			case 'ul': case 'ol': {
				const list = serializeList(node, node.tag === 'ol', ctx, 0);
				if (list.trim()) { blocks.push(list); }
				break;
			}
			case 'table': {
				const table = serializeTable(node, ctx);
				if (table) { blocks.push(table); }
				break;
			}
			case 'blockquote': {
				const inner = serializeBlocks(node.children, ctx);
				if (inner.trim()) {
					ctx.features.quotes = true;
					blocks.push(inner.split('\n').map(l => l ? `> ${l}` : '>').join('\n'));
				}
				break;
			}
			case 'img': {
				const ref = serializeImage(node, ctx);
				if (ref) { blocks.push(ref); }
				break;
			}
			case 'br': {
				break;
			}
			case 'html': case 'body': case 'div': case 'section': case 'article': {
				// Structural wrapper: transparent - recurse and merge its blocks in place.
				const inner = serializeBlocks(node.children, ctx);
				if (inner.trim()) { blocks.push(inner); }
				break;
			}
			default: {
				// Any other block-ish element: keep its content as a paragraph rather than dropping it.
				const inner = serializeInline(node.children, ctx).trim();
				if (inner) { blocks.push(escapeLeadingBlockMarkers(inner)); }
			}
		}
	}
	return blocks.join('\n\n');
}

/**
 * Build the plain-words kept/dropped summary (doc 22 section 2). `kept` names the structures the conversion
 * preserved (from the real feature tally); `dropped` names the "not imported" limitations, and ONLY the ones
 * the source actually contained (from the detections) - never a fabricated caveat. Tracked changes are named
 * as "kept the final text" rather than a loss (the spec's honesty rule), and tables as display-only until the
 * #140 editing path. Pure so the card, the lock provenance and the tests all read the same phrasing.
 */
export function buildImportSummary(features: IFeatures, detections: IDocxDetections): { kept: string[]; dropped: string[] } {
	const kept: string[] = [];
	if (features.headings) { kept.push('Headings'); }
	kept.push('Paragraphs');
	if (features.lists) { kept.push('Lists'); }
	if (features.tables > 0) { kept.push(features.tables === 1 ? 'A table (display-only for now)' : `${features.tables} tables (display-only for now)`); }
	if (features.emphasis) { kept.push('Bold and italic'); }
	if (features.links) { kept.push('Links'); }
	if (features.quotes) { kept.push('Block quotes'); }
	if (features.images === 1) { kept.push('1 image'); }
	else if (features.images > 1) { kept.push(`${features.images} images`); }
	if (detections.trackedChanges) { kept.push('The final text of tracked changes'); }

	const dropped: string[] = [];
	if (detections.comments) { dropped.push('Comments'); }
	if (detections.trackedChanges) { dropped.push('Tracked-change marks (the final text was kept)'); }
	if (detections.footnotes) { dropped.push('Footnotes'); }
	if (detections.textboxes) { dropped.push('Text boxes'); }
	if (detections.headersFooters) { dropped.push('Headers and footers'); }
	return { kept, dropped };
}

/** Join the kept/dropped phrases into one honest plain-words line for the import card / notification. */
export function formatImportSummary(kept: readonly string[], dropped: readonly string[]): string {
	const keptLine = kept.length ? `${kept.join(', ')} kept` : 'Nothing to keep';
	const droppedLine = dropped.length ? ` · ${dropped.join(', ')} not imported` : '';
	return keptLine + droppedLine;
}

/**
 * Convert mammoth's docx HTML into a Living Document Markdown body: lift embedded images to
 * `assets/<stem>/`, map the semantic HTML to GFM (headings, nested lists, GFM pipe tables, bold/italic,
 * links, block quotes, images), and fold the real kept/dropped fidelity summary from the feature tally +
 * the node-layer detections. `stem` is the imported document's base name (drives the assets path). Pure and
 * fail-soft: unexpected HTML degrades to its text rather than throwing, so an import never mangles silently.
 */
export function convertDocxHtml(html: string, stem: string, detections: IDocxDetections = noDetections()): IDocxConversion {
	const features: IFeatures = { headings: false, lists: false, tables: 0, images: 0, links: false, emphasis: false, quotes: false };
	const ctx: ISerializeCtx = { features, images: [], stem, imageCount: 0 };
	let markdown = '';
	try {
		const tree = parseHtml(typeof html === 'string' ? html : '');
		markdown = serializeBlocks(tree, ctx).replace(/\n{3,}/g, '\n\n').trim();
	} catch {
		// Fail-soft: a parser surprise must never lose the document - fall back to the de-tagged text.
		markdown = escapeText(decodeEntities(String(html ?? '').replace(/<[^>]+>/g, ' '))).replace(/\s+/g, ' ').trim();
	}
	const summary = buildImportSummary(features, detections);
	return { markdown: markdown ? markdown + '\n' : '', images: ctx.images, kept: summary.kept, dropped: summary.dropped };
}
