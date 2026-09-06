/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { blockApplyFailed, blockApplyLanded, BlockApplyResult } from './applyOutcome.js';
import { IBindLink, ILivingDoc, ILivingDocBlock, LivingDocBlockType } from './livingDocsModel.js';
import { docHasEarnedLiving } from './livingUpgrade.js';

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

// Count the `{{slot}}` / `{{slot:hint}}` placeholders in a template body (plan 28, D28-C). Used for the
// honest `N slots` count on the template card; the same slots become the model brief at generation time.
// A slot is any `{{ ... }}` run; the result is the number of occurrences in document order. Slots inside an
// HTML comment are illustrative scaffolding (e.g. the New Template seed's `<!-- {{slot:hint}} -->`), not real
// slots, so they are stripped first - the same comment-strip the skeleton uses (D28-C). Pure + tested.
const SLOT_RE = /\{\{\s*[^}]+\}\}/g;
const HTML_COMMENT_RE = /<!--[\s\S]*?-->/g;
// Drop every `<!-- ... -->` comment. An unclosed `<!--` (no terminating `-->`) matches nothing and is left
// intact, so slots after it stay counted - the same lenient behaviour the skeleton builder relies on.
function stripHtmlComments(text: string): string {
	return text.replace(HTML_COMMENT_RE, '');
}
export function countTemplateSlots(body: string): number {
	return (stripHtmlComments(body).match(SLOT_RE) ?? []).length;
}

// The template's "bind slots" (plan 48 T2.3): every place live data lands in the finished document -
// the `{{slot}}` prompts the model fills AND the inline `bind:` links copied through verbatim. Both are
// counted (a template can carry either or both) so the card's "N bind slots" meta is the honest total of
// data-bound positions the skeleton thumbnail draws. Pure, so the card meta and the thumbnail agree.
export function countBindSlots(body: string): number {
	const clean = stripHtmlComments(body);
	const slots = (clean.match(SLOT_RE) ?? []).length;
	const binds = extractBindLinks(clean).length;
	return slots + binds;
}

// One row in a template's skeleton thumbnail (plan 48 T2.2). The thumbnail is derived from the template's
// PARSED doc - never a screenshot or canned art - so it literally shows where live data lands: a `title`
// row is a heading (a stronger grey bar), a `prose` row is a body line (a lighter grey bar), and a `slots`
// row marks the bind positions (accent-tint chips) that occur at that point in the document. `widthPct` and
// each chip's `widthPx` are derived deterministically from the source so the same template always draws the
// same skeleton (a stable visual identity), and `slots[]` carries one chip per bind slot on that line.
export interface ITemplateSkeletonRow {
	readonly kind: 'title' | 'prose' | 'slots';
	/** For title/prose rows: the bar width as a percentage (10-96) of the thumbnail column. */
	readonly widthPct?: number;
	/** For slots rows: the accent-tint chip widths (px), one per bind slot on that line. */
	readonly slots?: readonly number[];
}

// A small deterministic width from a string + salt, so a template's skeleton is stable across renders (the
// same doc always looks the same) but varies line-to-line so it reads like real structure, not a fixed comb.
function skeletonWidth(seed: string, salt: number, min: number, span: number): number {
	let hash = salt;
	for (let i = 0; i < seed.length; i++) { hash = (hash * 31 + seed.charCodeAt(i)) | 0; }
	return min + (Math.abs(hash) % (span + 1));
}

// Derive the skeleton-thumbnail rows for a template from its PARSED doc (plan 48 T2.2). Walks the doc's
// blocks in order: a heading emits a `title` bar; a paragraph/table emits a `prose` bar, and where the block
// carries bind slots (inline `bind:` links or `{{slot}}` prompts) it also emits a `slots` row of accent-tint
// chips right after that block - so the accent bars sit exactly where live data will land in the finished
// document. Bounded to `maxRows` (the 110px thumbnail holds ~6 lines) so a long template still reads calmly;
// an empty/prose-only template still draws a couple of grey bars rather than an empty box. Pure + tested.
export function templateSkeletonRows(doc: ILivingDoc, maxRows = 6): ITemplateSkeletonRow[] {
	const rows: ITemplateSkeletonRow[] = [];
	const push = (row: ITemplateSkeletonRow) => { if (rows.length < maxRows) { rows.push(row); } };
	let emittedTitle = false;
	for (const block of doc.blocks) {
		if (rows.length >= maxRows) { break; }
		if (block.type === 'heading') {
			// The first heading reads as the document title (a wider, stronger bar); deeper headings are
			// shorter section titles. A block with no readable text is skipped rather than drawn as a stub.
			const width = block.level === 1 && !emittedTitle ? skeletonWidth(block.id, 1, 46, 22) : skeletonWidth(block.id, 2, 30, 20);
			emittedTitle = emittedTitle || block.level === 1;
			push({ kind: 'title', widthPct: width });
		} else {
			push({ kind: 'prose', widthPct: skeletonWidth(block.id, 3, 74, 22) });
		}
		// Bind slots on this block: one accent-tint chip per inline bind link plus per `{{slot}}` prompt, so a
		// block that binds two figures shows two accent chips exactly where those figures render.
		const slotCount = block.binds.length + (stripHtmlComments(block.text).match(SLOT_RE) ?? []).length;
		if (slotCount > 0) {
			const chips: number[] = [];
			for (let i = 0; i < Math.min(slotCount, 3); i++) { chips.push(skeletonWidth(block.id + i, 4, 32, 26)); }
			push({ kind: 'slots', slots: chips });
		}
	}
	// A near-empty template (no headings, no bound blocks - e.g. a single plain line, or nothing at all)
	// still deserves an honest skeleton: a couple of plain prose bars, so the thumbnail reads as a document
	// and never a blank grey box or one lonely bar. Any real rows we did emit are kept; we only top up plain
	// prose bars until there are at least two.
	const fallbackWidths = [88, 72];
	while (rows.length < 2) {
		rows.push({ kind: 'prose', widthPct: fallbackWidths[rows.length] });
	}
	return rows;
}

// Strip every `{{slot:hint}}` / `{{slot}}` run from a line (leaving the surrounding literal text intact).
function stripSlots(text: string): string {
	return text.replace(SLOT_RE, '');
}

// The human hints a template's slots carry, in document order: `{{slot:executive summary}}` -> "executive
// summary"; a bare `{{week number}}` (no `slot:` prefix) -> "week number". Deduped, used as the model brief.
// Slots inside HTML comments are illustrative, not real, so they are stripped first to match the count and
// skeleton (D28-C).
export function templateSlotHints(body: string): string[] {
	const hints: string[] = [];
	const seen = new Set<string>();
	for (const m of stripHtmlComments(body).matchAll(SLOT_RE)) {
		const inner = m[0].replace(/^\{\{\s*|\s*\}\}$/g, '').replace(/^slot:\s*/i, '').trim();
		if (inner && !seen.has(inner.toLowerCase())) { seen.add(inner.toLowerCase()); hints.push(inner); }
	}
	return hints;
}

// Build the STATIC skeleton for a document generated from a template (plan 28, iter 3, D28-C). The
// skeleton is the scaffold the review engine then fills: the template's headings (the H1 becomes the
// document's own name), and any line carrying a `bind:` link copied through VERBATIM so the generated
// document is born bound to its sources. Slots and the template's instruction prose are dropped here - they
// become the model brief (see `composeTemplateInstruction`), never fake prose written to disk. The
// frontmatter records the originating template's name as provenance (`template: <name>`, read back as
// `fromTemplate`) plus the template's declared `sources:` so the copied binds resolve on first load. Pure.
export function buildTemplateSkeleton(body: string, docName: string, templateName: string, sources: readonly string[]): string {
	const title = docName.trim() || templateName.trim() || 'Untitled';
	const clean = stripHtmlComments(body);
	const blocks: string[] = [];
	let usedH1 = false;
	for (const raw of clean.split(/\r?\n/)) {
		const line = raw.trim();
		if (!line) { continue; }
		const heading = /^(#{1,6})\s+(.*)$/.exec(line);
		if (heading) {
			let text = stripSlots(heading[2]).replace(/\s{2,}/g, ' ').trim();
			if (heading[1].length === 1 && !usedH1) { text = title; usedH1 = true; }
			if (!text) { continue; }
			blocks.push(`${heading[1]} ${text}`);
			continue;
		}
		if (/\]\(bind:/.test(line)) {
			const kept = stripSlots(line).replace(/\s{2,}/g, ' ').trim();
			if (kept) { blocks.push(kept); }
			continue;
		}
		// Instruction prose and slot-only lines are the brief for the model, not skeleton content: drop them.
	}
	if (!usedH1) { blocks.unshift(`# ${title}`); }

	const fm = ['---', `template: ${templateName.trim() || title}`];
	if (sources.length) { fm.push('sources:', ...sources.map(s => `  - ${s}`)); }
	fm.push('---');
	return `${fm.join('\n')}\n\n${blocks.join('\n\n')}\n`;
}

// Rewrite every inline `bind:` link to an EMPTY `{{slot:<key>}}` placeholder (plan 48 T2.4/T2.5). A bound
// figure `[value](bind:metrics.mrr)` becomes `{{slot:metrics.mrr}}` - the position where live data will land
// is kept (the skeleton thumbnail and "N bind slots" count still see it), but the coupling to a source is
// gone, so the document is NOT born bound: the user must bind a source before a figure resolves. Used by the
// Use-a-template and Save-as-template flows, which both want the pattern's shape with its binds left open.
// Pure (string in, string out) so it is unit-testable and the same on the service + in a snapshot test.
export function emptyBindsToSlots(body: string): string {
	return body.replace(BIND_LINK_RE, (_whole, _value: string, key: string) => `{{slot:${key}}}`);
}

// Build a NEW DOCUMENT duplicated from a template (plan 48 T2.4). Unlike `buildTemplateSkeleton` (which
// copies binds through VERBATIM so a generated doc is born bound), Use duplicates the pattern with its binds
// EMPTIED to slots: the body is the template's body with HTML-comment scaffolding stripped and every `bind:`
// link turned into a `{{slot:<key>}}` placeholder, and the frontmatter records the originating template's
// name as provenance (`template: <name>`, read back as `fromTemplate`) but declares NO `sources:` - nothing
// is bound yet. So the duplicate opens as plain Markdown that visibly needs a source bound (the tree-row
// "bind sources" nudge, T2.4), rather than resolving figures against a source it never picked. Deterministic.
export function buildDocumentFromTemplate(body: string, docName: string, templateName: string): string {
	const title = docName.trim() || templateName.trim() || 'Untitled';
	const emptied = emptyBindsToSlots(stripHtmlComments(body));
	const blocks: string[] = [];
	let usedH1 = false;
	for (const chunk of emptied.split(/\r?\n[ \t]*\r?\n/)) {
		const text = chunk.replace(/\s+$/, '');
		if (!text.trim()) { continue; }
		const heading = /^(#{1,6})\s+(.*)$/.exec(text.trim());
		if (heading && heading[1].length === 1 && !usedH1) {
			blocks.push(`# ${title}`);
			usedH1 = true;
			continue;
		}
		blocks.push(text);
	}
	if (!usedH1) { blocks.unshift(`# ${title}`); }
	const fm = ['---', `template: ${templateName.trim() || title}`, '---'];
	return `${fm.join('\n')}\n\n${blocks.join('\n\n')}\n`;
}

// Build a TEMPLATE from the active document (plan 48 T2.5, the Save-current-doc-as-template door). The active
// document's body is kept but its binds are EMPTIED to slots (so the template carries the pattern, not the
// current doc's live figures), and a `template: true` + `name:` (+ `description:`) frontmatter block is
// written so the file is discovered as a template by `parseLivingDoc`. The document's OWN `sources:` are
// carried through as the template's declared sources (they name what the pattern expects to bind), matching
// the New-template seed. Deterministic (string in, string out), so it round-trips on disk and snapshot-tests.
export function buildTemplateFromDocument(doc: Pick<ILivingDoc, 'body' | 'sources'>, templateName: string, description: string): string {
	const name = templateName.trim() || 'Untitled Template';
	const body = emptyBindsToSlots(doc.body).replace(/\s+$/, '') + '\n';
	const fm = ['---', 'template: true', `name: ${name}`];
	if (description.trim()) { fm.push(`description: ${description.trim()}`); }
	if (doc.sources.length) { fm.push('sources:', ...doc.sources.map(s => `  - ${s}`)); }
	fm.push('---');
	return `${fm.join('\n')}\n\n${body}`;
}

// Compose the instruction the generate flow sends through the EXISTING chat path (plan 28, iter 3): the
// template body is the brief (its instruction prose + slot hints), the document is already named, and the
// user's optional note is appended. The model answers with insertion changes that land in the review
// rail - generation never writes prose directly (decision 17). Deterministic, so it is snapshot-testable.
export function composeTemplateInstruction(templateName: string, body: string, docName: string, note: string): string {
	const name = docName.trim() || templateName.trim();
	const hints = templateSlotHints(body);
	const lines = [
		`Generate the first draft of "${name}" from the "${templateName}" template.`,
		`Write the prose for each section as new content inserted after its heading, following the template brief below. Do not change any bound figures.`,
		'',
		'Template brief:',
		body.trim(),
	];
	if (hints.length) {
		lines.push('', `Fill these slots from the sources: ${hints.join(', ')}.`);
	}
	if (note.trim()) {
		lines.push('', `Specific request for this document: ${note.trim()}`);
	}
	return lines.join('\n');
}

// ---- "From sources..." birth (F17, journey 1b): the third new-document birth. The user picks one or more
// project source files (csv/json bind sources + md/txt knowledge) and the document is DRAFTED FROM THEM
// through the review engine - the draft arrives as reviewable changes, never silently written prose. The
// two helpers below are the pure, self-contained pieces (skeleton + model brief); the service writes the
// skeleton, opens it, and drives the SAME chat path every generation uses so provenance is honest: the
// picked sources are declared in the skeleton frontmatter (`sources:` for value data, `context:` for prose
// knowledge) so bound figures resolve and the draft's origin is recorded on disk. Pure + tested.

// Build the STATIC skeleton for a document drafted from sources (F17). Just the frontmatter recording the
// picked sources plus the document's own H1 - no fabricated body (the prose is the review engine's job).
// `valueSources` (csv/json) land under `sources:` so their figures can bind; `context` (md/txt) under
// `context:` so they are read as knowledge. An empty name falls back to the first source's stem, else
// 'Untitled'. Deterministic, so it is snapshot-testable.
export function buildSourcesSkeleton(docName: string, valueSources: readonly string[], contextSources: readonly string[]): string {
	const title = docName.trim() || sourceStem(valueSources[0] ?? contextSources[0]) || 'Untitled';
	const fm = ['---'];
	if (valueSources.length) { fm.push('sources:', ...valueSources.map(s => `  - ${s}`)); }
	if (contextSources.length) { fm.push('context:', ...contextSources.map(s => `  - ${s}`)); }
	fm.push('---');
	return `${fm.join('\n')}\n\n# ${title}\n`;
}

// Reduce a source file name to a human stem for a title fallback: drop the directory and extension.
function sourceStem(source: string | undefined): string {
	if (!source) { return ''; }
	const base = source.split('/').pop() ?? source;
	return base.replace(/\.[a-z0-9]+$/i, '').trim();
}

// Compose the instruction the "From sources..." draft sends through the EXISTING chat path (F17). The
// document is already named and its sources are already declared (and so read by the chat path); this asks
// the model to DRAFT the document from those sources, and - matching the template path's born-bound stance -
// to represent any figure taken from a data source as a `bind:` link rather than a baked-in number, so
// provenance survives. The model answers with insertion changes that land in the review rail; generation
// never writes prose directly (decision 17). Deterministic, so it is snapshot-testable.
export function composeSourcesInstruction(docName: string, valueSources: readonly string[], contextSources: readonly string[], note: string): string {
	const name = docName.trim() || 'this document';
	const all = [...valueSources, ...contextSources];
	const lines = [
		`Draft the first version of "${name}" from the attached sources: ${all.join(', ') || 'the project sources'}.`,
		`Write the body as new content inserted into the document, grounded in what the sources actually say. Do not invent figures.`,
	];
	if (valueSources.length) {
		lines.push(`Where you state a figure that comes from a data source (${valueSources.join(', ')}), write it as a bind link - [value](bind:<source>.<field>) - so it stays traceable, rather than baking in a plain number.`);
	}
	if (note.trim()) {
		lines.push('', `Specific request for this document: ${note.trim()}`);
	}
	return lines.join('\n');
}

// ---- "New template from examples" wizard (F18, journey 1x): the user picks 3-10 past documents; the agent
// names what repeats (structure, recurring figures, tone) THROUGH THE REVIEW GRAMMAR and proposes a real
// `*.template.md` (a skill.md-shaped file: description + rules + tone + success examples) written to the
// project, which then joins the + New picker. The helpers below are the pure pieces: the example-set
// validation, the template skeleton, and the analysis brief. Pure + tested.

// The example-set bounds (journey 1x: "3-10 past documents"). Fewer than the floor cannot show a pattern;
// more than the ceiling is refused rather than silently truncated - both with a plain-words reason.
export const EXAMPLE_SET_MIN = 3;
export const EXAMPLE_SET_MAX = 10;

// Validate a picked example set (F18). Returns `ok:false` with a plain-words `reason` when the count is
// outside the bounds - never a black-box refusal. Pure, so the sheet and the service share one rule.
export function validateExampleSet(picks: readonly string[]): { readonly ok: boolean; readonly reason?: string } {
	const n = picks.length;
	if (n < EXAMPLE_SET_MIN) {
		return { ok: false, reason: `Pick at least ${EXAMPLE_SET_MIN} documents so the pattern is real - you chose ${n}.` };
	}
	if (n > EXAMPLE_SET_MAX) {
		return { ok: false, reason: `Pick at most ${EXAMPLE_SET_MAX} documents - you chose ${n}. Trim the set to the clearest examples.` };
	}
	return { ok: true };
}

// Build the STATIC skeleton for a template grown from examples (F18). A real `*.template.md`: `template: true`
// frontmatter with the human name, a description the analysis will fill, the picked examples recorded under
// `context:` so the review-grammar analysis reads them (and the file honestly records what it was grown
// from), and the skill.md section scaffold (structure / recurring figures / tone / success examples) the
// analysis fills through review. Deterministic, so it is snapshot-testable.
export function buildExamplesTemplateSkeleton(templateName: string, examples: readonly string[]): string {
	const name = templateName.trim() || 'Untitled Template';
	const fm = ['---', 'template: true', `name: ${name}`, 'description: Grown from example documents - the shared pattern is described below.'];
	if (examples.length) { fm.push('context:', ...examples.map(e => `  - ${e}`)); }
	fm.push('---');
	const body = [
		`# ${name}`,
		'',
		'## Structure',
		'',
		'The sections and order these documents share.',
		'',
		'## Recurring figures',
		'',
		'The numbers worth binding to a source each time.',
		'',
		'## Tone',
		'',
		'How these documents read - voice, length, formality.',
		'',
		'## Success examples',
		'',
		'What a good version of this document looks like.',
	];
	return `${fm.join('\n')}\n\n${body.join('\n')}\n`;
}

// Compose the instruction the from-examples wizard sends through the EXISTING chat path (F18). The examples
// are already declared as `context:` on the new template (and so read by the chat path); this asks the model
// to NAME what repeats across them and fill each section of the template. The model answers with insertion
// changes that land in the review rail - the analysis is reviewable, never a silent write, and a model
// outage becomes an honest error turn, never "no commonalities". Deterministic, so it is snapshot-testable.
export function composeExamplesInstruction(templateName: string, examples: readonly string[]): string {
	return [
		`Study the ${examples.length} attached example documents (${examples.join(', ')}) and describe the pattern they share, so it can become the "${templateName}" template.`,
		`Fill each section as new content inserted after its heading: under Structure, the sections and order they share; under Recurring figures, the numbers worth binding to a source; under Tone, how they read; under Success examples, what a strong version looks like.`,
		`Name only what genuinely repeats across the examples - do not invent structure that is not there.`,
	].join('\n');
}

function slug(s: string): string {
	return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'section';
}

interface IFrontmatter {
	title: string;
	subtitle: string;
	sources: string[];
	context: string[];
	// Template metadata (plan 28, D28-A): a `*.template.md` declares `template: true` plus a human `name:`
	// and `description:`. These are inert on an ordinary document (the fields stay at their defaults), so the
	// same single frontmatter parser serves both a document and a template - there is no second parser.
	template: boolean;
	name: string;
	description: string;
	// The originating template's `name:`, recorded on a generated document's frontmatter as provenance
	// (`template: Weekly report`) so the audit trail can read "Created from Weekly report template".
	fromTemplate: string;
	// Plain-language document status (`status:`), the Properties STATUS chip (plan 45 pin 12). Inert everywhere
	// else, so the one parser keeps serving documents that never author a status.
	status: string;
	// Document tags (`tags:` block list), the Properties TAGS chips (plan 45 pin 12).
	tags: string[];
	// The per-document autonomy policy (`policy:`), read through `docPolicy.ts` into the three-tier grammar
	// (plan 45 pin 12 / #122 F11). A plain string here; `coerceDocPolicy` normalises it at the read site.
	policy: string;
}

// Parse the YAML-ish frontmatter: `title`/`subtitle`/`name`/`description` scalars, the `template:` flag,
// and `sources:` / `context:` block lists (`- item` lines). Returns the frontmatter values and the body
// that follows. The `template:` scalar is truthy only on the literal `true` (a generated doc records the
// template it came from as a `template: <name>` STRING, which reads as `fromTemplate` provenance - not a
// template file itself).
function parseFrontmatter(text: string): { fm: IFrontmatter; body: string } {
	const fm: IFrontmatter = { title: '', subtitle: '', sources: [], context: [], template: false, name: '', description: '', fromTemplate: '', status: '', tags: [], policy: '' };
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
		else if (key === 'name') { fm.name = value; }
		else if (key === 'description') { fm.description = value; }
		else if (key === 'status') { fm.status = value; }
		else if (key === 'policy') { fm.policy = value; }
		else if (key === 'tags') {
			// `tags:` is a block list (`- item` lines) but tolerates an inline comma list on the same line
			// (`tags: draft, q3`) so a hand-authored doc that used the compact form still reads.
			listInto = fm.tags;
			if (value) { for (const t of value.split(',').map(v => v.trim()).filter(Boolean)) { fm.tags.push(t); } }
		}
		else if (key === 'template') {
			// `template: true` marks a template file; `template: <name>` on a generated document is provenance.
			if (value === 'true') { fm.template = true; }
			else if (value) { fm.fromTemplate = value; }
		}
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

// --- Body chunking (docs/30 section 2.1) ------------------------------------------------------------
//
// The ONE place a document body is cut into blocks. `parseLivingDoc` reads the block list off it, and the
// differ (`livingDocDiffer.ts`) aligns against it - so a block the reader sees and a block the differ
// pairs are the same thing by construction, not by two regexes that agree today and drift tomorrow.
//
// Two properties the old inline `split(/\r?\n[ \t]*\r?\n/)` could not give:
//
//  - EXACT OFFSETS. Every chunk carries its half-open `[start, end)` range in the string it was cut from,
//    so a change's span can be stated in document coordinates and spliced back byte-exactly. A split-based
//    chunker loses the arithmetic the moment it trims.
//  - FENCED BLOCKS STAY WHOLE. A ``` fence containing a blank line used to shred into one block per
//    paragraph inside it, which meant an edit to a code sample was proposed against half a code sample.
//    A fence is one unit from its opening marker to its closing marker (or to the end of the body when it
//    is never closed).
//
// Everything else keeps the shipped rule exactly: blocks are separated by blank lines, and a block's
// trailing whitespace is not part of it.

/** A blank line for chunking purposes - the shipped separator, matched literally. */
const BLANK_LINE_RE = /^[ \t]*$/;

/** An opening code fence: up to three leading spaces, then three or more backticks or tildes. */
const FENCE_OPEN_RE = /^ {0,3}(?<marker>`{3,}|~{3,})/;

/**
 * One block of a document body, with the exact half-open `[start, end)` range it occupies in the string it
 * was chunked from. `text` is always `body.slice(start, end)`; the whitespace BETWEEN chunks (the blank-line
 * separators, the trailing newline) belongs to no chunk and is what a caller must treat as the seams.
 */
export interface IBodyChunk {
	readonly start: number;
	readonly end: number;
	readonly text: string;
}

/**
 * Cut a document body into blocks, preserving exact offsets. Headings, paragraphs, lists and tables split on
 * blank lines (a tight list is one block, as it has always been - see {@link listItems} for sub-scoping);
 * a fenced code block is one block regardless of what it contains.
 */
export function chunkDocBody(body: string): IBodyChunk[] {
	const chunks: IBodyChunk[] = [];
	let start = -1;
	let end = -1;
	let fence: string | undefined;

	const flush = () => {
		if (start >= 0) { chunks.push({ start, end, text: body.slice(start, end) }); }
		start = -1;
	};

	let offset = 0;
	while (offset < body.length) {
		const newline = body.indexOf('\n', offset);
		const lineEnd = newline < 0 ? body.length : newline;
		const raw = body.slice(offset, lineEnd);
		const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw;

		if (fence !== undefined) {
			// Inside a fence nothing separates: a blank line is content, and only a matching closing marker
			// (same character, at least as long, nothing after it) ends the block.
			if (!BLANK_LINE_RE.test(line)) {
				end = offset + line.replace(/\s+$/, '').length;
				const closer = new RegExp(`^ {0,3}${fence[0] === '`' ? '`' : '~'}{${fence.length},}[ \t]*$`);
				if (closer.test(line)) { fence = undefined; }
			}
		} else if (BLANK_LINE_RE.test(line)) {
			flush();
		} else {
			if (start < 0) { start = offset; }
			end = offset + line.replace(/\s+$/, '').length;
			const opener = FENCE_OPEN_RE.exec(line);
			if (opener) { fence = opener.groups!.marker; }
		}

		if (newline < 0) { break; }
		offset = newline + 1;
	}
	flush();
	return chunks;
}

// Token-overlap (Jaccard) similarity of two strings, 0..1: 1 = identical token sets, 0 = nothing in common.
// Deterministic, no model. This is the ONE shipped implementation - the differ pairs blocks with it
// (docs/30 section 2.1), `scopeBlockEdit` locates the list item an edit targets with it, and the service
// relocates a prose claim against moved text with it. It used to exist three times.
export function jaccardSimilarity(a: string, b: string): number {
	return jaccardOfTokens(similarityTokens(a), similarityTokens(b));
}

/**
 * The token set {@link jaccardSimilarity} compares, exposed so a caller that scores the SAME string many
 * times can tokenise it once.
 *
 * The differ needs this: its gap aligner fills a dynamic-programming table and asks for the similarity of
 * the same pair of blocks up to three ways per cell, so tokenising inside the comparison re-scans the same
 * prose thousands of times on a large document. Splitting the rule from the scoring keeps ONE definition of
 * what a token is (the reason `jaccardSimilarity` is now written in terms of these two) while letting the
 * hot path hoist the scanning out of its inner loop.
 */
export function similarityTokens(text: string): ReadonlySet<string> {
	return new Set(text.toLowerCase().match(/[a-z0-9]+/g) ?? []);
}

/** The Jaccard overlap of two token sets from {@link similarityTokens}: 0..1, 1 = identical sets. */
export function jaccardOfTokens(ta: ReadonlySet<string>, tb: ReadonlySet<string>): number {
	if (ta.size === 0 || tb.size === 0) { return 0; }
	let inter = 0;
	for (const t of ta) { if (tb.has(t)) { inter++; } }
	return inter / (ta.size + tb.size - inter);
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
	for (const chunk of chunkDocBody(cleanBody)) {
		blocks.push(blockFor(chunk.text, index++));
	}

	const hasBinds = blocks.some(b => b.binds.length > 0);
	// "Living is earned" (plan 42 L3): a `.md` earns living status only once a source is bound -- frontmatter
	// `sources:`/`context:`, or an inline bind link. Plain Markdown (a doc the user merely wrote) stays plain.
	const isLiving = docHasEarnedLiving({
		hasFrontmatterSources: fm.sources.length > 0,
		hasFrontmatterContext: fm.context.length > 0,
		hasBindLinks: hasBinds,
	});

	let title = fm.title;
	if (!title) {
		const h1 = blocks.find(b => b.type === 'heading' && b.level === 1);
		title = h1 ? h1.text : 'Untitled';
	}

	return {
		title,
		frontmatterTitle: fm.title,
		subtitle: fm.subtitle,
		sources: fm.sources,
		context: fm.context,
		blocks,
		isLiving,
		body: cleanBody,
		isTemplate: fm.template,
		// A template's card title is its `name:` if authored, else the derived title.
		templateName: fm.name || title,
		templateDescription: fm.description,
		fromTemplate: fm.fromTemplate,
		status: fm.status,
		tags: fm.tags,
		policy: fm.policy,
	};
}

// The title to show for a document in the tree-rail / Home list (plan 37 F8): the authored frontmatter
// `title:`, else the first H1, else the file's own name. A Markdown file with an odd or missing heading
// (`#Heading` with no space, leading blank lines, no heading at all) must never collapse to a bare
// "Untitled" that erases which file it is - it falls back to the filename so the row still names the file.
// `filename` is the document's basename; its `.md`/generated-view extension is stripped for the label.
// Pure (string in, string out), so it is unit-testable independent of the DOM view + the file scan.
export function documentDisplayTitle(doc: Pick<ILivingDoc, 'frontmatterTitle' | 'blocks'>, filename: string): string {
	const authored = (doc.frontmatterTitle ?? '').trim();
	if (authored) { return authored; }
	const h1 = doc.blocks.find(b => b.type === 'heading' && b.level === 1);
	const heading = h1 ? h1.text.trim() : '';
	if (heading) { return heading; }
	const stem = filename.replace(/\.(export|source|template)\.md$/i, '').replace(/\.md$/i, '').trim();
	return stem || 'Untitled';
}

// Render one block back to its Markdown source. Headings re-emit their `#` prefix from the level;
// everything else round-trips its raw text verbatim.
function serializeBlock(block: ILivingDocBlock): string {
	if (block.type === 'heading') {
		return `${'#'.repeat(block.level ?? 2)} ${block.text}`;
	}
	return block.text;
}

// Add or remove a single `value` in a frontmatter block list (`sources:` or `context:`), returning the new
// raw text with the body left verbatim. Creates a frontmatter block if the doc has none; drops the key when
// its last item is removed. Idempotent (adding an existing / removing an absent value is a no-op).
export function withFrontmatterList(text: string, key: 'sources' | 'context' | 'tags', value: string, add: boolean): string {
	const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
	if (!match) {
		// A plain doc gains its first entry: prepend a minimal frontmatter block (no-op on remove).
		return add ? `---\n${key}:\n  - ${value}\n---\n\n${text}` : text;
	}

	// Walk the frontmatter lines, lifting out the existing `<key>:` block (key + its `- ` items) and
	// keeping everything else (title/subtitle, the other list) in place.
	const kept: string[] = [];
	const existing: string[] = [];
	let keyAt = -1;
	let inList = false;
	for (const line of match[1].split(/\r?\n/)) {
		const item = /^\s+-\s+(.*)$/.exec(line);
		if (inList && item) {
			existing.push(item[1].trim().replace(/^["']|["']$/g, ''));
			continue;
		}
		inList = false;
		const colon = line.indexOf(':');
		const lineKey = colon >= 0 ? line.slice(0, colon).trim() : '';
		if (lineKey === key) {
			inList = true;
			keyAt = kept.length;
			const inline = line.slice(colon + 1).trim().replace(/^["']|["']$/g, '');
			if (inline) { existing.push(inline); }
			continue;
		}
		kept.push(line);
	}

	const changed = add ? !existing.includes(value) : existing.includes(value);
	if (!changed) { return text; }

	const next = add ? [...existing, value] : existing.filter(v => v !== value);
	const block = next.length ? [`${key}:`, ...next.map(v => `  - ${v}`)] : [];
	// Re-insert where the key was; a new `sources:` goes before `context:`, a new `context:` at the end.
	let insertAt = keyAt;
	if (insertAt < 0) {
		const ctxIdx = key === 'sources' ? kept.findIndex(l => l.trim().startsWith('context:')) : -1;
		insertAt = ctxIdx >= 0 ? ctxIdx : kept.length;
	}
	const fmLines = [...kept.slice(0, insertAt), ...block, ...kept.slice(insertAt)];
	return `---\n${fmLines.join('\n')}\n---\n${text.slice(match[0].length)}`;
}

// Convenience wrapper for the document's value sources (`sources:` frontmatter list).
export function withFrontmatterSource(text: string, source: string, add: boolean): string {
	return withFrontmatterList(text, 'sources', source, add);
}

// Set (or clear) a scalar frontmatter field (`title:` / `subtitle:` / `status:` / `policy:`), returning the new
// raw text with the body left verbatim. Used by the Properties panel to write title / status / policy edits back
// to the file on disk (plan 45 pin 12 / P12.3). Creates a frontmatter block if the doc has none; an empty value
// removes the key (a cleared status leaves no dangling `status:` line). The body is never touched, so a plain
// Markdown doc that gains its first field keeps its prose byte-identical. Idempotent (a no-op change returns the
// input unchanged so the caller can skip a redundant disk write).
export function withFrontmatterScalar(text: string, key: 'title' | 'subtitle' | 'status' | 'policy', value: string): string {
	const clean = value.trim();
	const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
	if (!match) {
		// A plain doc gains its first scalar: prepend a minimal frontmatter block (no-op when clearing).
		return clean ? `---\n${key}: ${clean}\n---\n\n${text}` : text;
	}

	// Walk the frontmatter lines, dropping the existing `<key>:` scalar line (and any stray list items that
	// followed it, in case the key was previously a list) and keeping everything else in place.
	const kept: string[] = [];
	let found = false;
	let existing = '';
	let skippingList = false;
	for (const line of match[1].split(/\r?\n/)) {
		const item = /^\s+-\s+(.*)$/.exec(line);
		if (skippingList && item) { continue; }
		skippingList = false;
		const colon = line.indexOf(':');
		const lineKey = colon >= 0 ? line.slice(0, colon).trim() : '';
		if (lineKey === key) {
			found = true;
			existing = line.slice(colon + 1).trim().replace(/^["']|["']$/g, '');
			skippingList = true;
			continue;
		}
		kept.push(line);
	}

	if (found && existing === clean) { return text; }
	if (!found && !clean) { return text; }

	// Re-insert the scalar where it was (or append it); a cleared value simply drops the line.
	const rest = text.slice(match[0].length);
	const fmLines = clean ? [`${key}: ${clean}`, ...kept] : kept;
	if (fmLines.length === 0) {
		// The frontmatter is now empty: drop the whole `---` block, leaving the body alone.
		return rest.replace(/^\r?\n+/, '');
	}
	return `---\n${fmLines.join('\n')}\n---\n${rest}`;
}

// Convenience wrapper for a document's tags (`tags:` frontmatter block list), so the Properties panel adds or
// removes one tag chip at a time through the same list machinery as sources/context (plan 45 pin 12 / P12.3).
export function withFrontmatterTag(text: string, tag: string, add: boolean): string {
	return withFrontmatterList(text, 'tags', tag.trim(), add);
}

// Replace a document's body while keeping its frontmatter block verbatim. Used when a living document is
// edited in ProseMirror (which only round-trips the body): the editor serializes the body back to
// Markdown, and this re-attaches the original `---` frontmatter so `sources:`/`context:` are never lost.
// A doc with no frontmatter returns the new body unchanged. The new body is normalized to end in a single
// trailing newline.
/**
 * A document's frontmatter block exactly as authored, `---` fences included, or `''` when it has none.
 *
 * Exists so the approve path can PROVE the block survived a write rather than trusting that it did. The
 * parser reads ten fields and the serialiser emits six (docs/30 section 8.3), so "the frontmatter is
 * preserved" is a claim about bytes the parsed document cannot make on its own.
 */
export function frontmatterBlock(text: string): string {
	return /^---\r?\n[\s\S]*?\r?\n---\r?\n?/.exec(text)?.[0] ?? '';
}

export function withReplacedBody(text: string, newBody: string): string {
	const body = newBody.replace(/\s+$/, '') + '\n';
	const match = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/.exec(text);
	if (!match) {
		return body;
	}
	return text.slice(0, match[0].length).replace(/\r?\n*$/, '\n') + '\n' + body;
}

// --- List-item anchoring (plan 31 iter 1, decision-68 data-loss fix) --------------------------------
//
// A bulleted / numbered list with no blank lines between items parses as a SINGLE block whose `text` is the
// whole list (`parseLivingDoc` splits blocks on blank lines). A chat edit that targets ONE item must be
// anchored and applied at that item's boundary; otherwise approving it replaces the entire block with the
// single rewritten item and every sibling item is silently destroyed. These pure helpers make each list item
// its own searchable / replaceable unit.

const LIST_MARKER_RE = /^(\s*)([-*+]|\d+[.)])\s+\S/;

/**
 * The list items in a block as exact substrings with their [start, end) character ranges. An item is one
 * list-marker line (top-level or nested); its range covers that physical line only, so splicing one item
 * never disturbs a sibling or a nested child on another line. Returns [] when the block is not a list.
 */
export function listItems(blockText: string): { text: string; start: number; end: number }[] {
	const items: { text: string; start: number; end: number }[] = [];
	let offset = 0;
	for (const rawLine of blockText.split('\n')) {
		const line = rawLine.replace(/\r$/, '');
		if (LIST_MARKER_RE.test(line)) {
			items.push({ text: line, start: offset, end: offset + line.length });
		}
		offset += rawLine.length + 1; // + the newline that split() consumed
	}
	return items;
}

// The comparable content of a list item: marker stripped, whitespace collapsed, lower-cased.
function listItemContent(line: string): string {
	return line.replace(/^(\s*)([-*+]|\d+[.)])\s+/, '').replace(/\s+/g, ' ').trim().toLowerCase();
}

/**
 * Scope an edit to the single list item it targets. When `blockText` is a multi-item list and `quote` (the
 * model's quoted oldText, or the proposed newText when locating the changed item) clearly matches ONE item,
 * returns that item's exact slice and range; otherwise returns the whole block unchanged. This is what lets a
 * one-item edit anchor and splice at the `<li>` boundary and leave sibling items byte-identical.
 */
export function scopeBlockEdit(blockText: string, quote: string): { oldText: string; start: number; end: number } {
	const whole = { oldText: blockText, start: 0, end: blockText.length };
	const q = (quote ?? '').trim();
	if (!q) { return whole; }
	const items = listItems(blockText);
	if (items.length < 2) { return whole; }
	const target = listItemContent(q);
	if (!target) { return whole; }
	let best: { text: string; start: number; end: number } | undefined;
	let bestScore = 0;
	for (const item of items) {
		const content = listItemContent(item.text);
		const score = content === target ? 1 : (content.includes(target) || target.includes(content) ? 0.9 : jaccardSimilarity(content, target));
		if (score > bestScore) { bestScore = score; best = item; }
	}
	if (best && bestScore >= 0.5 && best.text.trim() !== blockText.trim()) {
		return { oldText: blockText.slice(best.start, best.end), start: best.start, end: best.end };
	}
	return whole;
}

/**
 * Apply an approved edit to a block's raw text. When `oldText` is the whole block (a prose rewrite) the block
 * becomes `newText`. When `oldText` is a scoped sub-span (one list item) `newText` is spliced over exactly
 * that range, so every sibling line stays byte-identical.
 *
 * Fail-soft AND fail-LOUD (docs/30 invariant I1, issue #329): if a scoped `oldText` is no longer present (the
 * block changed since the change was queued) nothing is written - sibling content is never destroyed by a
 * whole-block replace - and the caller is handed `{landed: false, reason: 'anchor-miss'}`. The old `string`
 * return handed back the block UNCHANGED on that path, which is byte-for-byte what a successful no-op edit
 * returns, so the caller could not tell "applied" from "did nothing" and recorded an approval either way.
 * A caller now has to narrow on `landed` before it can reach the text at all.
 */
export function applyBlockEdit(blockText: string, oldText: string, newText: string): BlockApplyResult {
	const old = oldText ?? '';
	if (!old || old === blockText || old.trim() === blockText.trim()) { return blockApplyLanded(newText); }
	const at = blockText.indexOf(old);
	if (at >= 0) {
		return blockApplyLanded(blockText.slice(0, at) + newText + blockText.slice(at + old.length));
	}
	return blockApplyFailed('anchor-miss');
}

/** Serialise ONLY a document's body (its blocks re-emitted, joined by blank lines) - never its frontmatter. */
export function serializeLivingDocBody(doc: ILivingDoc): string {
	return doc.blocks.map(serializeBlock).join('\n\n');
}

export function serializeLivingDoc(doc: ILivingDoc): string {
	const body = serializeLivingDocBody(doc);

	// Only emit the frontmatter the file actually authored. The `title:` line comes from
	// `frontmatterTitle` (the authored value), NEVER the derived `doc.title` (H1/'Untitled' fallback) -- so
	// a plain Markdown doc round-trips byte-clean and an accepted chat edit never injects a `title:` block
	// into a file the user wrote as plain Markdown (plan 16 iter 4, decision 57).
	const fmTitle = doc.frontmatterTitle ?? '';
	const fmLines: string[] = [];
	if (fmTitle) { fmLines.push(`title: ${fmTitle}`); }
	if (doc.subtitle) { fmLines.push(`subtitle: ${doc.subtitle}`); }
	// Preserve the Properties-panel fields (plan 45 pin 12) across a block-driven re-serialise (a refresh /
	// figure sync): emit them only when authored, so a plain doc still round-trips byte-clean and these fields
	// are never lost when the body is rebuilt from blocks.
	if (doc.status) { fmLines.push(`status: ${doc.status}`); }
	if (doc.policy) { fmLines.push(`policy: ${doc.policy}`); }
	if (doc.tags?.length) {
		fmLines.push('tags:');
		for (const t of doc.tags) { fmLines.push(`  - ${t}`); }
	}
	if (doc.sources.length) {
		fmLines.push('sources:');
		for (const s of doc.sources) { fmLines.push(`  - ${s}`); }
	}
	if (doc.context.length) {
		fmLines.push('context:');
		for (const c of doc.context) { fmLines.push(`  - ${c}`); }
	}

	// No authored frontmatter -> the document is plain Markdown; emit the body alone (no `---` block).
	if (fmLines.length === 0) {
		return `${body}\n`;
	}
	return `---\n${fmLines.join('\n')}\n---\n\n${body}\n`;
}

// The modelled SCALAR frontmatter fields, paired with the value the parsed document holds for each. These
// are the only frontmatter a NON-approve persist can legitimately change (a figure sync advances `subtitle`;
// see `_resolveSubtitle`). The list keys (sources/context/tags) are NEVER mutated on that path - list edits
// go through `saveRawText` - so they are carried through byte-exact rather than re-emitted; re-emitting a
// list was the #385 round-2 corruption (a comment between items duplicated them). Used by
// {@link withMergedFrontmatter} to update only a scalar whose value actually moved.
const MODELLED_FRONTMATTER_SCALARS: readonly { readonly key: 'title' | 'subtitle' | 'status' | 'policy'; readonly read: (doc: ILivingDoc) => string }[] = [
	{ key: 'title', read: doc => doc.frontmatterTitle ?? '' },
	{ key: 'subtitle', read: doc => doc.subtitle ?? '' },
	{ key: 'status', read: doc => doc.status ?? '' },
	{ key: 'policy', read: doc => doc.policy ?? '' },
];

/**
 * Replace the value of a TOP-LEVEL scalar frontmatter key IN PLACE, leaving every other byte untouched.
 *
 * Unlike {@link withFrontmatterScalar} (which the Properties panel uses to AUTHOR a field, and which re-orders
 * the key to the front and rebuilds the block), this rewrites ONLY the matching line's value: key order, list
 * items, nested maps, comments, blank lines and CR/LF endings are all left exactly as they were. It matches a
 * top-level key only (the key at column 0), so a nested `  <key>:` child of another map is never mistaken for
 * the field (the #385 round-2 hoisting bug). A no-op (key absent, or value already equal) returns the text
 * unchanged. Pure.
 */
function withReplacedFrontmatterScalar(text: string, key: 'title' | 'subtitle' | 'status' | 'policy', value: string): string {
	const match = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/.exec(text);
	if (!match) { return text; }
	const block = match[0];
	// The top-level `key:` line: the key at column 0, its colon and trailing spacing, then the value up to
	// (but not including) the line ending, so the original `\n` or `\r\n` is preserved by the splice below.
	const lineRe = new RegExp(`^(${key}:[ \\t]*)([^\\r\\n]*)`, 'm');
	const m = lineRe.exec(block);
	if (!m || m[2] === value) { return text; }
	const nextBlock = block.slice(0, m.index) + m[1] + value + block.slice(m.index + m[0].length);
	return nextBlock + text.slice(block.length);
}

/**
 * Re-serialise a document for a NON-approve persist (figure sync, hand edits, skill fixes) while preserving
 * its frontmatter, making BOTH #357 properties true at once (docs/30 section 8.3):
 *
 *  - UNMODELLED frontmatter survives BYTE-EXACT. The `---` block is carried through verbatim by
 *    {@link withReplacedBody}, so the `template`/`name`/`description`/`fromTemplate` provenance, every unknown
 *    user key, nested maps, comments, blank lines, list formatting and CR/LF endings are exactly as authored.
 *    This is round 1's proven behaviour.
 *  - A MODELLED SCALAR that legitimately changed on this path still reaches disk. A figure sync advances
 *    `subtitle: Week N` (`_resolveSubtitle`); that one line is updated surgically in place
 *    ({@link withReplacedFrontmatterScalar}), and ONLY when its value actually moved, so an unchanged field is
 *    never touched and the block does not churn. Lists are not re-emitted (re-emitting them was the round-2
 *    corruption), because no persist path mutates them.
 *
 * The body is always the block-derived body, normalised to a single trailing newline. Pure (text + doc in,
 * text out), so it round-trips on disk and is unit-testable.
 */
export function withMergedFrontmatter(originalText: string, doc: ILivingDoc): string {
	let text = withReplacedBody(originalText, serializeLivingDocBody(doc));
	const original = parseLivingDoc(originalText);
	for (const scalar of MODELLED_FRONTMATTER_SCALARS) {
		const next = scalar.read(doc);
		if (next !== scalar.read(original)) {
			text = withReplacedFrontmatterScalar(text, scalar.key, next);
		}
	}
	return text;
}

// The chat model is asked for "ONLY a JSON object" of {reply, edits, inserts}, but a real model
// intermittently wraps it in prose, truncates it, or answers in plain text. The old call-site did a bare
// `JSON.parse(raw.slice(indexOf('{'), lastIndexOf('}')+1))`, which THREW on any of those and surfaced as a
// flat "the agent model errored". This pure parser is tolerant (plan 16 iter 5, decision 58): it extracts
// the JSON object when present, and otherwise degrades to treating the whole reply as a plain chat answer
// (no changes) -- never a crash. Unit-tested independently of the model.
export interface IParsedChatResponse {
	readonly reply: string;
	readonly edits: { heading?: string; oldText?: string; newText?: string; rationale?: string }[];
	readonly inserts: { afterHeading?: string; newText?: string; rationale?: string }[];
}

// Extract the first complete JSON object from a string, ignoring prose or stray characters before and
// after it AND dropping stray closing tokens the model appends inside it. A real model (gpt-4o-mini,
// observed live) intermittently wraps the object in prose, appends a stray trailing `}` or a stray `]` on
// an array (`{..."inserts":[]]}`), or truncates mid-stream; the old `indexOf('{')..lastIndexOf('}')` slice
// broke on any of those and leaked the raw JSON into the chat. This rebuilds the object from the first `{`,
// tracking brace AND bracket depth (plus string state + escapes), emitting characters but DROPPING any
// closer that would go below zero - so a doubled `}}` / `]]` the model tacked on is discarded rather than
// breaking the parse. Returns the reconstructed object string, or undefined when no object ever closes
// (a truncated stream) so callers degrade to a plain answer. Pure + unit-tested.
function extractBalancedJsonObject(raw: string): string | undefined {
	const start = raw.indexOf('{');
	if (start < 0) { return undefined; }
	let braceDepth = 0, bracketDepth = 0, inString = false, escaped = false;
	let out = '';
	for (let i = start; i < raw.length; i++) {
		const ch = raw[i];
		if (inString) {
			out += ch;
			if (escaped) { escaped = false; }
			else if (ch === '\\') { escaped = true; }
			else if (ch === '"') { inString = false; }
			continue;
		}
		if (ch === '"') { inString = true; out += ch; continue; }
		if (ch === '{') { braceDepth++; out += ch; continue; }
		if (ch === '[') { bracketDepth++; out += ch; continue; }
		if (ch === ']') {
			if (bracketDepth === 0) { continue; } // stray array close -> drop
			bracketDepth--; out += ch; continue;
		}
		if (ch === '}') {
			if (braceDepth === 0) { continue; } // stray object close -> drop
			braceDepth--; out += ch;
			if (braceDepth === 0 && bracketDepth === 0) { return out; } // object complete
			continue;
		}
		out += ch;
	}
	return undefined; // never balanced (truncated) -> plain answer
}

// Best-effort extraction of the human `reply` prose from a PARTIAL chat-response JSON while it streams
// (plan 27 iter 3), so the live turn shows words rather than the raw `{"reply":"..."}` envelope. The chat
// contract emits `reply` first, so this reads its string value from `"reply":"` up to the closing
// unescaped quote (or the end of the partial buffer when it has not arrived yet), unescaping the common
// JSON string escapes. A reply that is NOT a JSON envelope (the tolerant plain-text path) is returned
// unchanged; an envelope whose reply value has not started yet returns '' (the turn stays on "Thinking").
export function extractStreamingReply(raw: string): string {
	const s = raw.replace(/^[\s\uFEFF]+/, '');
	if (!s.startsWith('{')) { return raw; }
	const key = /"reply"\s*:\s*"/.exec(s);
	if (!key) { return ''; }
	let out = '';
	for (let i = key.index + key[0].length; i < s.length; i++) {
		const ch = s[i];
		if (ch === '\\') {
			const next = s[i + 1];
			if (next === undefined) { break; } // a trailing backslash - wait for the next delta
			out += next === 'n' ? '\n' : next === 't' ? '\t' : next === 'r' ? '\r' : next;
			i++;
			continue;
		}
		if (ch === '"') { break; } // the closing quote of the reply value
		out += ch;
	}
	return out;
}

export function parseChatResponse(raw: string): IParsedChatResponse {
	const plain: IParsedChatResponse = { reply: raw.trim(), edits: [], inserts: [] };
	const objStr = extractBalancedJsonObject(raw);
	if (!objStr) {
		return plain; // no balanced JSON object -> a plain-text answer
	}
	try {
		const json = JSON.parse(objStr) as {
			reply?: unknown;
			edits?: unknown;
			inserts?: unknown;
		};
		return {
			// A parsed object with no `reply` leaves reply empty -- the queued change cards carry the meaning.
			reply: typeof json.reply === 'string' ? json.reply.trim() : '',
			edits: Array.isArray(json.edits) ? json.edits : [],
			inserts: Array.isArray(json.inserts) ? json.inserts : [],
		};
	} catch {
		return plain; // malformed / truncated JSON -> degrade to a plain answer, never throw
	}
}

// The multi-document chat contract (plan 18, decision 62): one model call over the whole working set
// returns a reply plus a per-document map of edits/inserts, each entry keyed by the document it targets.
// Tolerant in the same way as parseChatResponse: a non-JSON / truncated reply degrades to a plain answer
// with no per-doc changes (never throws). The `doc` key is matched to a working-set document by title
// at the call site.
// Each proposed edit/insert may carry a SOURCE GROUNDING (plan 23.4, decision #77): a short verbatim
// `sourceQuote` from the attached source (the transcript) plus, where the model can determine it, a
// `sourceLine` number. Both are OPTIONAL and only appear on the parsed object when the model supplied
// them (a non-numeric `sourceLine` is dropped, the quote kept) - the parser NEVER fabricates a line.
export interface IParsedChatEdit {
	readonly heading?: string;
	readonly oldText?: string;
	readonly newText?: string;
	readonly rationale?: string;
	readonly sourceQuote?: string;
	readonly sourceLine?: number;
}

export interface IParsedChatInsert {
	readonly afterHeading?: string;
	readonly newText?: string;
	readonly rationale?: string;
	readonly sourceQuote?: string;
	readonly sourceLine?: number;
}

export interface IParsedDocEdits {
	readonly doc: string;
	readonly edits: IParsedChatEdit[];
	readonly inserts: IParsedChatInsert[];
}

export interface IParsedMultiChatResponse {
	readonly reply: string;
	readonly docs: IParsedDocEdits[];
}

// Copy through only the string fields the model actually supplied, and attach the optional source
// grounding when present. Building the object key-by-key (rather than spreading undefineds) keeps the
// parsed shape minimal so tolerant callers and deepStrictEqual tests see no fabricated `undefined` keys.
function readSourceGrounding(raw: { sourceQuote?: unknown; sourceLine?: unknown }, into: { sourceQuote?: string; sourceLine?: number }): void {
	if (typeof raw.sourceQuote === 'string' && raw.sourceQuote.trim()) { into.sourceQuote = raw.sourceQuote; }
	if (typeof raw.sourceLine === 'number' && Number.isFinite(raw.sourceLine)) { into.sourceLine = raw.sourceLine; }
}

function normaliseEdit(raw: { heading?: unknown; oldText?: unknown; newText?: unknown; rationale?: unknown; sourceQuote?: unknown; sourceLine?: unknown }): IParsedChatEdit {
	const edit: { heading?: string; oldText?: string; newText?: string; rationale?: string; sourceQuote?: string; sourceLine?: number } = {};
	if (typeof raw.heading === 'string') { edit.heading = raw.heading; }
	if (typeof raw.oldText === 'string') { edit.oldText = raw.oldText; }
	if (typeof raw.newText === 'string') { edit.newText = raw.newText; }
	if (typeof raw.rationale === 'string') { edit.rationale = raw.rationale; }
	readSourceGrounding(raw, edit);
	return edit;
}

function normaliseInsert(raw: { afterHeading?: unknown; newText?: unknown; rationale?: unknown; sourceQuote?: unknown; sourceLine?: unknown }): IParsedChatInsert {
	const insert: { afterHeading?: string; newText?: string; rationale?: string; sourceQuote?: string; sourceLine?: number } = {};
	if (typeof raw.afterHeading === 'string') { insert.afterHeading = raw.afterHeading; }
	if (typeof raw.newText === 'string') { insert.newText = raw.newText; }
	if (typeof raw.rationale === 'string') { insert.rationale = raw.rationale; }
	readSourceGrounding(raw, insert);
	return insert;
}

// Look up the 1-based line number of a source quote in the real source text (plan 23.4). Used to fill
// a decision's `sourceLine` truthfully when the model gave a quote but no number: we search the actual
// attached source for the quote and return the line it starts on. Matching is whitespace- and
// case-insensitive, and tolerant of the source wrapping a sentence across lines (the quote's leading
// run is matched against a small sliding window of joined lines). Returns undefined when the quote is
// not found - the caller then shows the quote with NO line chip. NEVER guesses a line.
export function findQuoteLine(sourceText: string, quote: string): number | undefined {
	const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();
	const needle = norm(quote);
	if (!needle) { return undefined; }
	const lines = sourceText.split(/\r?\n/);
	// The source may show its own line numbers as a leading token (e.g. "2  Decision: ..."); strip a
	// leading integer so the match is on the prose, and remember the printed number is not what we return
	// (we return the true file line so it always matches the reader's cross-check against the raw file).
	const clean = lines.map(l => norm(l.replace(/^\s*\d+\s+/, '')));
	// First try a whole-line containment; then try joining each line with the next so a wrapped decision
	// ("...REQUIRED for all administrative access,\n including cloud consoles...") still resolves to its
	// first line. The needle only needs its leading portion to match for a wrapped sentence.
	for (let i = 0; i < clean.length; i++) {
		if (!clean[i]) { continue; }
		// Whole-line containment either way, but only treat the line as a match when the model's quote
		// extends slightly past it (needle.includes(line)) if the line is nearly as long as the needle -
		// otherwise a short source line ("MFA required.") would false-match a longer, unrelated quote and
		// assign a wrong-but-real line, which would break the provenance the decisions column promises.
		if (clean[i].includes(needle)) { return i + 1; }
		if (needle.includes(clean[i]) && clean[i].length >= needle.length * 0.8) { return i + 1; }
	}
	for (let i = 0; i < clean.length - 1; i++) {
		const joined = `${clean[i]} ${clean[i + 1]}`.trim();
		if (joined && joined.includes(needle)) { return i + 1; }
	}
	return undefined;
}

export function parseMultiChatResponse(raw: string): IParsedMultiChatResponse {
	const plain: IParsedMultiChatResponse = { reply: raw.trim(), docs: [] };
	const objStr = extractBalancedJsonObject(raw);
	if (!objStr) {
		return plain;
	}
	try {
		const json = JSON.parse(objStr) as { reply?: unknown; docs?: unknown };
		const docs: IParsedDocEdits[] = Array.isArray(json.docs)
			? json.docs
				.filter((d): d is { doc?: unknown; edits?: unknown; inserts?: unknown } => !!d && typeof d === 'object')
				.map(d => ({
					doc: typeof d.doc === 'string' ? d.doc : '',
					edits: Array.isArray(d.edits) ? d.edits.map(normaliseEdit) : [],
					inserts: Array.isArray(d.inserts) ? d.inserts.map(normaliseInsert) : [],
				}))
			: [];
		return { reply: typeof json.reply === 'string' ? json.reply.trim() : '', docs };
	} catch {
		return plain;
	}
}
