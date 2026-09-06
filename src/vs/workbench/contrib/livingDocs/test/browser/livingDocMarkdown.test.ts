/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { applyBlockEdit, buildDocumentFromTemplate, buildExamplesTemplateSkeleton, buildSourcesSkeleton, buildTemplateFromDocument, buildTemplateSkeleton, composeExamplesInstruction, composeSourcesInstruction, composeTemplateInstruction, countBindSlots, countTemplateSlots, documentDisplayTitle, emptyBindsToSlots, extractBindLinks, extractStreamingReply, findQuoteLine, listItems, parseChatResponse, parseLivingDoc, parseMultiChatResponse, reconcileBindLinks, scopeBlockEdit, serializeLivingDoc, templateSkeletonRows, templateSlotHints, validateExampleSet, withFrontmatterList, withFrontmatterScalar, withFrontmatterSource, withFrontmatterTag, withMergedFrontmatter, withReplacedBody } from '../../common/livingDocMarkdown.js';

// A clean-file Living Document: pure Markdown + frontmatter dependency lists + inline bind links.
const WEEKLY_MD = [
	'---',
	'title: Weekly Operating Summary',
	'subtitle: Week 24',
	'sources:',
	'  - metrics.csv',
	'context:',
	'  - market-research.md',
	'---',
	'',
	'## Highlights',
	'',
	'Revenue grew [18%](bind:metrics.mrr.delta) week-on-week to [$48.6k](bind:metrics.mrr) MRR, on [427](bind:metrics.signups) new signups.',
	'',
	'## Commentary',
	'',
	'Growth accelerated sharply this week.',
].join('\n') + '\n';

const PLAIN_MD = [
	'# Project Readme',
	'',
	'Some **bold** intro prose with a [link](https://example.com).',
	'',
	'- first item',
	'- second item',
].join('\n') + '\n';

suite('LivingDoc bind-link format', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('parses frontmatter dependency lists and inline bind links', () => {
		const doc = parseLivingDoc(WEEKLY_MD);
		assert.deepStrictEqual(
			{
				title: doc.title,
				subtitle: doc.subtitle,
				sources: doc.sources,
				context: doc.context,
				isLiving: doc.isLiving,
				headings: doc.blocks.filter(b => b.type === 'heading').map(b => b.text),
				binds: doc.blocks.flatMap(b => b.binds),
			},
			{
				title: 'Weekly Operating Summary',
				subtitle: 'Week 24',
				sources: ['metrics.csv'],
				context: ['market-research.md'],
				isLiving: true,
				headings: ['Highlights', 'Commentary'],
				binds: [
					{ value: '18%', key: 'metrics.mrr.delta' },
					{ value: '$48.6k', key: 'metrics.mrr' },
					{ value: '427', key: 'metrics.signups' },
				],
			},
		);
	});

	test('a clean .md with bind links round-trips through parse -> serialize unchanged', () => {
		assert.strictEqual(serializeLivingDoc(parseLivingDoc(WEEKLY_MD)), WEEKLY_MD);
	});

	// Plan 28, iter 1: the SAME frontmatter parser reads template metadata. A `template: true` file exposes
	// its name/description; the slots and bind links live in the body verbatim.
	test('parses template frontmatter (template flag, name, description) and keeps the body verbatim', () => {
		const TEMPLATE_MD = [
			'---',
			'template: true',
			'name: Weekly report',
			'description: A weekly operating summary bound to metrics.csv.',
			'sources:',
			'  - metrics.csv',
			'---',
			'',
			'# {{slot:report title}}',
			'',
			'Revenue is [pending](bind:metrics.mrr) MRR.',
		].join('\n') + '\n';
		const doc = parseLivingDoc(TEMPLATE_MD);
		assert.deepStrictEqual(
			{ isTemplate: doc.isTemplate, name: doc.templateName, description: doc.templateDescription, sources: doc.sources, fromTemplate: doc.fromTemplate },
			{ isTemplate: true, name: 'Weekly report', description: 'A weekly operating summary bound to metrics.csv.', sources: ['metrics.csv'], fromTemplate: '' },
		);
		assert.ok(doc.body.includes('[pending](bind:metrics.mrr)'), 'bind links are kept verbatim in the body');
	});

	// A template's `name:` falls back to the derived title when none is authored.
	test('a template with no name falls back to the derived title', () => {
		const doc = parseLivingDoc(['---', 'template: true', '---', '', '# Meeting notes', '', 'body'].join('\n') + '\n');
		assert.strictEqual(doc.templateName, 'Meeting notes');
	});

	// An ordinary document is NOT a template - the template fields stay at their inert defaults.
	test('an ordinary document is not a template', () => {
		const doc = parseLivingDoc(WEEKLY_MD);
		assert.strictEqual(doc.isTemplate, false, 'a report is not a template');
		assert.strictEqual(doc.fromTemplate, '', 'no provenance on a hand-authored report');
	});

	// A generated document records `template: <name>` as provenance - a STRING value, not the boolean flag,
	// so it is NOT itself treated as a template (plan 28, D28-C provenance line for iter 3).
	test('template: <name> on a generated document reads as provenance, not a template flag', () => {
		const doc = parseLivingDoc(['---', 'title: Week 24', 'template: Weekly report', '---', '', 'body'].join('\n') + '\n');
		assert.strictEqual(doc.isTemplate, false, 'a provenance line does not make the document a template');
		assert.strictEqual(doc.fromTemplate, 'Weekly report', 'the originating template name is recorded as provenance');
	});

	// countTemplateSlots underpins the honest `N slots` count on the template card (plan 28, D28-C).
	test('countTemplateSlots counts {{slot}} / {{slot:hint}} placeholders and ignores bind links', () => {
		const body = '# {{slot:title}}\n\nWeek {{slot:week}} - {{date}}\n\nMRR is [pending](bind:metrics.mrr).';
		assert.strictEqual(countTemplateSlots(body), 3);
		assert.strictEqual(countTemplateSlots('No slots here, just [x](bind:metrics.mrr).'), 0);
	});

	// Slots inside an HTML comment are illustrative scaffolding (the New Template seed carries a
	// `<!-- {{slot:hint}} -->` example), not real slots, so the card must not count them (D28-C, PR #88 debt).
	test('countTemplateSlots ignores {{slot}} placeholders inside HTML comments', () => {
		assert.strictEqual(countTemplateSlots('<!-- {{slot:hint}} -->'), 0);
		assert.strictEqual(countTemplateSlots('# {{slot:title}}\n\n<!-- example: {{slot:hint}} -->'), 1);
		assert.strictEqual(countTemplateSlots('<!--\n{{slot:a}}\n{{slot:b}}\n-->\n{{slot:c}}'), 1);
		// An unclosed comment (no terminating `-->`) matches nothing, so trailing slots stay counted - the same
		// lenient behaviour buildTemplateSkeleton relies on.
		assert.strictEqual(countTemplateSlots('<!-- oops {{slot:still counted}}'), 1);
	});

	// countBindSlots underpins the v2 card meta "N bind slots" (plan 48 T2.3): every place live data lands -
	// the `{{slot}}` prompts AND the inline `bind:` links. A template with two slots and two binds is 4.
	test('countBindSlots totals {{slot}} prompts and inline bind links (the data-bound positions)', () => {
		const body = '# {{slot:title}}\n\nWeek {{slot:week}}\n\nMRR is [pending](bind:metrics.mrr), up [pending](bind:metrics.mrr.delta).';
		assert.strictEqual(countBindSlots(body), 4);
		assert.strictEqual(countBindSlots('Just prose, no binds.'), 0);
		// Slots inside HTML comments are illustrative (aligns with countTemplateSlots + the skeleton, D28-C).
		assert.strictEqual(countBindSlots('# {{slot:title}}\n<!-- {{slot:example}} -->\n[x](bind:metrics.mrr)'), 2);
	});

	// templateSkeletonRows drives the v2 card's 110px skeleton thumbnail (plan 48 T2.2): the rows are derived
	// from the template's PARSED doc - a heading is a `title` bar, prose is a `prose` bar, and a bound block
	// emits a `slots` row of accent-tint chips right after it, so the accent bars sit where live data lands.
	test('templateSkeletonRows derives title/prose/slots rows from the parsed doc, slots where binds occur', () => {
		const doc = parseLivingDoc('# Weekly Summary\n\nMRR is [pending](bind:metrics.mrr), up [pending](bind:metrics.mrr.delta).\n\nA plain commentary line.');
		const rows = templateSkeletonRows(doc);
		assert.deepStrictEqual(rows.map(r => r.kind), ['title', 'prose', 'slots', 'prose'], 'a title, the bound prose block + its two-chip slots row, then the plain prose line');
		const slotsRow = rows.find(r => r.kind === 'slots');
		assert.strictEqual(slotsRow?.slots?.length, 2, 'the bound block emits one accent chip per bind (2 here)');
		// Deterministic: the same doc always yields the same skeleton widths (a stable visual identity).
		assert.deepStrictEqual(templateSkeletonRows(doc), rows, 'the skeleton is a pure function of the doc');
	});

	// A near-empty template (no headings, no binds) still gets an honest skeleton, never a blank grey box.
	test('templateSkeletonRows yields plain prose bars for a template with no headings and no binds', () => {
		const rows = templateSkeletonRows(parseLivingDoc('Just one plain line of prose.'));
		assert.ok(rows.length >= 2 && rows.every(r => r.kind === 'prose'), 'a couple of grey prose bars, no empty box');
	});

	// The Weekly report starter (plan 28): H1 slot, a slot-only subtitle line, a bound Highlights line, and
	// two instruction-prose sections. The skeleton keeps headings + the bind line verbatim, sets the H1 to
	// the document name, strips slots, and drops the instruction prose (it becomes the model brief).
	const WEEKLY_TEMPLATE_BODY = [
		'# {{slot:report title}}',
		'',
		'Week {{slot:week number}} - {{slot:date range}}',
		'',
		'## Highlights',
		'',
		'Revenue is [pending](bind:metrics.mrr) MRR, up [pending](bind:metrics.mrr.delta) week-on-week, on [pending](bind:metrics.signups) new signups.',
		'',
		'## Commentary',
		'',
		'Summarise how the week went from the numbers above.',
		'',
		'## What to watch',
		'',
		'Call out the one metric to keep an eye on next week.',
		'',
	].join('\n');

	test('templateSlotHints returns the slot hints in order, deduped, slot: prefix stripped', () => {
		assert.deepStrictEqual(templateSlotHints('# {{slot:report title}}\n{{week number}}\n{{slot:report title}}'), ['report title', 'week number']);
		assert.deepStrictEqual(templateSlotHints('No slots [x](bind:metrics.mrr)'), []);
		// Slots inside HTML comments are illustrative, so they never reach the model brief (aligns with the count
		// and skeleton, D28-C).
		assert.deepStrictEqual(templateSlotHints('# {{slot:report title}}\n<!-- {{slot:example}} -->'), ['report title']);
	});

	// buildTemplateSkeleton is the review-engine-safe scaffold (plan 28, iter 3): bind links copied verbatim
	// (born bound), slots stripped, the H1 becomes the document name, instruction prose dropped, and the
	// frontmatter records `template:` provenance + the declared sources so the copied binds resolve on load.
	test('buildTemplateSkeleton keeps headings + verbatim bind links, strips slots, records provenance', () => {
		const skeleton = buildTemplateSkeleton(WEEKLY_TEMPLATE_BODY, 'Week 24 report', 'Weekly report', ['metrics.csv']);
		assert.strictEqual(skeleton, [
			'---',
			'template: Weekly report',
			'sources:',
			'  - metrics.csv',
			'---',
			'',
			'# Week 24 report',
			'',
			'## Highlights',
			'',
			'Revenue is [pending](bind:metrics.mrr) MRR, up [pending](bind:metrics.mrr.delta) week-on-week, on [pending](bind:metrics.signups) new signups.',
			'',
			'## Commentary',
			'',
			'## What to watch',
			'',
		].join('\n'));
		// The skeleton round-trips: it parses back as a document bound to the template's source, born from it.
		const doc = parseLivingDoc(skeleton);
		assert.strictEqual(doc.title, 'Week 24 report');
		assert.strictEqual(doc.fromTemplate, 'Weekly report');
		assert.deepStrictEqual(doc.sources, ['metrics.csv']);
		assert.deepStrictEqual(extractBindLinks(doc.body).map(b => b.key), ['metrics.mrr', 'metrics.mrr.delta', 'metrics.signups']);
		assert.strictEqual(countTemplateSlots(doc.body), 0, 'no slots survive into the generated document');
	});

	// A template with no sources and no bind links (e.g. Client update) yields a headings-only skeleton with
	// the H1 named after the document; HTML-comment guidance is stripped and never reaches disk.
	test('buildTemplateSkeleton on a prose-only template yields a headings-only skeleton, comments stripped', () => {
		const body = [
			'# {{slot:client name}} - Progress update',
			'',
			'<!-- guidance the model reads, not the reader -->',
			'## What we shipped',
			'',
			'Summarise the work completed this period.',
			'',
			'## What is next',
			'',
			'Outline the next milestone.',
			'',
		].join('\n');
		assert.strictEqual(buildTemplateSkeleton(body, 'Acme update', 'Client update', []), [
			'---',
			'template: Client update',
			'---',
			'',
			'# Acme update',
			'',
			'## What we shipped',
			'',
			'## What is next',
			'',
		].join('\n'));
	});

	// --- plan 48 T2.4/T2.5: Use-a-template + Save-as-template pure builders (binds emptied to slots) ---

	// emptyBindsToSlots turns every `[value](bind:key)` into a `{{slot:key}}` placeholder: the position where
	// live data lands is kept but the source coupling is gone (the doc is NOT born bound). Underpins Use + Save.
	test('emptyBindsToSlots rewrites every bind link to a {{slot:key}} placeholder, prose untouched', () => {
		const body = 'Revenue is [pending](bind:metrics.mrr) MRR, up [x](bind:metrics.mrr.delta). Plain prose stays.';
		assert.strictEqual(emptyBindsToSlots(body), 'Revenue is {{slot:metrics.mrr}} MRR, up {{slot:metrics.mrr.delta}}. Plain prose stays.');
		assert.strictEqual(extractBindLinks(emptyBindsToSlots(body)).length, 0, 'no bind links remain');
		assert.strictEqual(emptyBindsToSlots('No binds here.'), 'No binds here.', 'prose with no binds is unchanged');
	});

	// buildDocumentFromTemplate (T2.4 Use) duplicates the pattern into a NEW document with binds EMPTIED to
	// slots: the H1 becomes the doc name, HTML comments are stripped, every bind becomes a slot, and the
	// frontmatter records `template: <name>` provenance but declares NO sources - so the doc opens needing a
	// source bound (not born bound, unlike buildTemplateSkeleton).
	test('buildDocumentFromTemplate duplicates the pattern with binds emptied to slots and no sources declared', () => {
		const doc = buildDocumentFromTemplate(WEEKLY_TEMPLATE_BODY, 'My week', 'Weekly report');
		const parsed = parseLivingDoc(doc);
		assert.strictEqual(parsed.title, 'My week', 'the H1 becomes the document name');
		assert.strictEqual(parsed.fromTemplate, 'Weekly report', 'provenance records the originating template');
		assert.deepStrictEqual(parsed.sources, [], 'no sources are declared - the doc is not born bound');
		assert.strictEqual(extractBindLinks(parsed.body).length, 0, 'every bind is emptied to a slot');
		assert.ok(countTemplateSlots(parsed.body) > 0, 'the emptied binds survive as {{slot}} placeholders');
		assert.strictEqual(parsed.isLiving, false, 'with no bound source the duplicate is not yet living (needs binding)');
	});

	// buildTemplateFromDocument (T2.5 Save-as-template) keeps the active doc's body but empties its binds to
	// slots and writes `template: true` + `name:` (+ the doc's own sources), so it round-trips as a template.
	test('buildTemplateFromDocument empties the doc binds to slots and writes template frontmatter', () => {
		const source = '---\nsources:\n  - metrics.csv\n---\n\n# Week 24\n\nRevenue is [48k](bind:metrics.mrr) MRR.\n';
		const template = buildTemplateFromDocument(parseLivingDoc(source), 'Weekly report', 'A weekly summary.');
		const parsed = parseLivingDoc(template);
		assert.strictEqual(parsed.isTemplate, true, 'the file is a template (template: true)');
		assert.strictEqual(parsed.templateName, 'Weekly report');
		assert.strictEqual(parsed.templateDescription, 'A weekly summary.');
		assert.deepStrictEqual(parsed.sources, ['metrics.csv'], 'the pattern declares the doc\'s own sources');
		assert.strictEqual(extractBindLinks(parsed.body).length, 0, 'the doc\'s live figures are emptied to slots');
		assert.ok(countTemplateSlots(parsed.body) > 0, 'the emptied binds are {{slot}} placeholders in the pattern');
	});

	// The composed instruction is what drives the EXISTING chat path (plan 28, iter 3): a deterministic brief
	// carrying the template body, its slot hints, and the user's note. Snapshot so the prompt stays stable.
	test('composeTemplateInstruction composes a stable brief from the body, slot hints and note', () => {
		const instruction = composeTemplateInstruction('Weekly report', WEEKLY_TEMPLATE_BODY, 'Week 24 report', 'Focus on the churn dip.');
		assert.strictEqual(instruction, [
			'Generate the first draft of "Week 24 report" from the "Weekly report" template.',
			'Write the prose for each section as new content inserted after its heading, following the template brief below. Do not change any bound figures.',
			'',
			'Template brief:',
			WEEKLY_TEMPLATE_BODY.trim(),
			'',
			'Fill these slots from the sources: report title, week number, date range.',
			'',
			'Specific request for this document: Focus on the churn dip.',
		].join('\n'), 'the composed brief is stable (the note is passed through verbatim, no forced punctuation)');
	});

	test('composeTemplateInstruction omits the note line when no note is given', () => {
		const instruction = composeTemplateInstruction('Client update', '# {{slot:client name}}\n\n## What we shipped\n\nSummarise.', 'Acme update', '');
		assert.ok(!instruction.includes('Specific request'), 'no note line without a note');
		assert.ok(instruction.includes('Fill these slots from the sources: client name.'));
	});

	// --- F17 "From sources..." birth (journey 1b): the pure skeleton + brief for drafting from picked sources.
	test('buildSourcesSkeleton declares value sources and context, titled by the given name', () => {
		const skeleton = buildSourcesSkeleton('Board note - March', ['metrics.csv'], ['market-research.md', 'Team Notes.md']);
		assert.strictEqual(skeleton, [
			'---',
			'sources:',
			'  - metrics.csv',
			'context:',
			'  - market-research.md',
			'  - Team Notes.md',
			'---',
			'',
			'# Board note - March',
			'',
		].join('\n'), 'csv/json land under sources: and md/txt under context:, with the doc H1');
		// The skeleton is a parseable Living Document: its sources/context are read back correctly.
		const parsed = parseLivingDoc(skeleton);
		assert.deepStrictEqual(parsed.sources, ['metrics.csv']);
		assert.deepStrictEqual(parsed.context, ['market-research.md', 'Team Notes.md']);
		assert.strictEqual(parsed.title, 'Board note - March');
	});

	test('buildSourcesSkeleton falls back to the first source stem when no name is given', () => {
		assert.strictEqual(buildSourcesSkeleton('', ['metrics.csv'], []), '---\nsources:\n  - metrics.csv\n---\n\n# metrics\n');
		assert.strictEqual(buildSourcesSkeleton('', [], []), '---\n---\n\n# Untitled\n');
	});

	test('composeSourcesInstruction asks for a bound draft from the sources; the note is passed through', () => {
		const instruction = composeSourcesInstruction('Board note - March', ['metrics.csv'], ['market-research.md'], 'Lead with churn.');
		assert.strictEqual(instruction, [
			'Draft the first version of "Board note - March" from the attached sources: metrics.csv, market-research.md.',
			'Write the body as new content inserted into the document, grounded in what the sources actually say. Do not invent figures.',
			'Where you state a figure that comes from a data source (metrics.csv), write it as a bind link - [value](bind:<source>.<field>) - so it stays traceable, rather than baking in a plain number.',
			'',
			'Specific request for this document: Lead with churn.',
		].join('\n'), 'the brief names the sources, asks for born-bound figures, and carries the note verbatim');
	});

	test('composeSourcesInstruction omits the bind-link line when there are no value sources, and the note line when none', () => {
		const instruction = composeSourcesInstruction('Summary', [], ['market-research.md'], '');
		assert.ok(!instruction.includes('bind link'), 'no bind guidance without a value source');
		assert.ok(!instruction.includes('Specific request'), 'no note line without a note');
	});

	// --- F18 from-examples template wizard (journey 1x): example-set validation, template skeleton, brief.
	test('validateExampleSet accepts 3-10 and refuses out-of-bounds with a plain-words reason', () => {
		assert.deepStrictEqual(validateExampleSet(['a.md', 'b.md', 'c.md']), { ok: true });
		assert.deepStrictEqual(validateExampleSet(new Array(10).fill('x.md')), { ok: true });
		const tooFew = validateExampleSet(['a.md', 'b.md']);
		assert.strictEqual(tooFew.ok, false);
		assert.ok(tooFew.reason && tooFew.reason.includes('at least 3') && tooFew.reason.includes('you chose 2'), 'the refusal names the floor and the count in plain words');
		const tooMany = validateExampleSet(new Array(11).fill('x.md'));
		assert.strictEqual(tooMany.ok, false);
		assert.ok(tooMany.reason && tooMany.reason.includes('at most 10'), 'the refusal names the ceiling');
	});

	test('buildExamplesTemplateSkeleton is a real template file recording the examples and the skill.md sections', () => {
		const skeleton = buildExamplesTemplateSkeleton('Board note', ['Board Note.md', 'Team Notes.md', 'Weekly Summary.md']);
		const parsed = parseLivingDoc(skeleton);
		assert.strictEqual(parsed.isTemplate, true, 'it is a template: true file, so it joins the + New picker');
		assert.strictEqual(parsed.templateName, 'Board note');
		assert.deepStrictEqual(parsed.context, ['Board Note.md', 'Team Notes.md', 'Weekly Summary.md'], 'the examples are recorded so the analysis can read them');
		for (const section of ['## Structure', '## Recurring figures', '## Tone', '## Success examples']) {
			assert.ok(skeleton.includes(section), `the skill.md scaffold has ${section}`);
		}
	});

	test('composeExamplesInstruction asks for the shared pattern only, naming the examples', () => {
		const instruction = composeExamplesInstruction('Board note', ['Board Note.md', 'Team Notes.md', 'Weekly Summary.md']);
		assert.ok(instruction.includes('3 attached example documents (Board Note.md, Team Notes.md, Weekly Summary.md)'));
		assert.ok(instruction.includes('the "Board note" template'));
		assert.ok(/only what genuinely repeats/i.test(instruction), 'it guards against invented structure (never "no commonalities" territory)');
	});

	test('documentDisplayTitle falls back to the filename for odd/blank-heading Markdown, never a bare Untitled (F8)', () => {
		// Authored frontmatter title wins.
		assert.strictEqual(documentDisplayTitle(parseLivingDoc('---\ntitle: Board Note\n---\n\nBody.'), 'board.md'), 'Board Note');
		// No frontmatter title -> the first H1.
		assert.strictEqual(documentDisplayTitle(parseLivingDoc('# Weekly Summary\n\nBody.'), 'weekly.md'), 'Weekly Summary');
		// No title, no recognised H1 (`#Heading` has no space) -> the filename stem, not "Untitled".
		assert.strictEqual(documentDisplayTitle(parseLivingDoc('#Heading no space\n\nBody.'), 'notes-odd.md'), 'notes-odd');
		// Leading blank lines, no heading -> the filename stem.
		assert.strictEqual(documentDisplayTitle(parseLivingDoc('\n\n\nJust prose, no heading.'), 'messy-two.md'), 'messy-two');
		// No heading at all -> the filename stem.
		assert.strictEqual(documentDisplayTitle(parseLivingDoc('plain prose only'), 'plain.md'), 'plain');
		// Only when there is genuinely no filename either does it fall to Untitled.
		assert.strictEqual(documentDisplayTitle(parseLivingDoc('plain'), ''), 'Untitled');
	});

	test('reconcileBindLinks rewrites visible cache to the resolved value (lock wins), keeping the key', () => {
		const line = 'MRR is [$41.2k](bind:metrics.mrr) today.';
		const resolved = new Map([['metrics.mrr', '$48.6k']]);
		assert.strictEqual(reconcileBindLinks(line, resolved), 'MRR is [$48.6k](bind:metrics.mrr) today.');
	});

	test('extractBindLinks ignores ordinary Markdown links', () => {
		assert.deepStrictEqual(extractBindLinks('see [the docs](https://example.com) and [427](bind:metrics.signups)'), [
			{ value: '427', key: 'metrics.signups' },
		]);
	});

	// The migrated KPI table (spec 4): a clean Markdown table whose cells are bind links.
	const MIGRATED_TABLE_MD = [
		'---',
		'title: Board Note',
		'sources:',
		'  - metrics.csv',
		'---',
		'',
		'## Numbers',
		'',
		'| Metric | Previous | Current | Change |',
		'| --- | --- | --- | --- |',
		'| MRR | [$41.2k](bind:metrics.mrr.prev) | [$48.6k](bind:metrics.mrr) | [+18%](bind:metrics.mrr.delta) |',
		'| New signups | [312](bind:metrics.signups.prev) | [427](bind:metrics.signups) | [+37%](bind:metrics.signups.delta) |',
	].join('\n') + '\n';

	// The OLD format we replaced: bindings smuggled into HTML comments, a `{cell}`-free figure.
	const OLD_LIVING_MD = [
		'---',
		'livingDoc: true',
		'title: Weekly',
		'source: metrics.csv',
		'syncedWeek: 23',
		'---',
		'',
		'## Highlights',
		'',
		'<!-- bind id=p-highlights kind=figure cells=mrr -->',
		'Revenue grew 12% to $41.2k MRR.',
	].join('\n') + '\n';

	test('migrated sample: a clean table of bind links parses, exposes its keys, and round-trips', () => {
		const doc = parseLivingDoc(MIGRATED_TABLE_MD);
		const table = doc.blocks.find(b => b.type === 'table')!;
		assert.deepStrictEqual(
			{ keys: table.binds.map(b => b.key), roundTrips: serializeLivingDoc(doc) === MIGRATED_TABLE_MD },
			{ keys: ['metrics.mrr.prev', 'metrics.mrr', 'metrics.mrr.delta', 'metrics.signups.prev', 'metrics.signups', 'metrics.signups.delta'], roundTrips: true },
		);
	});

	test('the old HTML-comment binding scheme is no longer a Living Document signal', () => {
		const doc = parseLivingDoc(OLD_LIVING_MD);
		// No frontmatter sources/context and no inline bind links -> the old comment scheme is inert.
		assert.deepStrictEqual({ isLiving: doc.isLiving, binds: doc.blocks.flatMap(b => b.binds).length }, { isLiving: false, binds: 0 });
	});

	test('plain Markdown is not a Living Document and takes its title from the first H1', () => {
		const doc = parseLivingDoc(PLAIN_MD);
		assert.strictEqual(doc.isLiving, false);
		assert.strictEqual(doc.title, 'Project Readme');
		assert.ok(doc.body.includes('- first item'), 'body retains the raw Markdown for generic rendering');
	});

	// plan 16 iter 4: a plain doc must round-trip to BYTE-CLEAN plain Markdown. The display title derives
	// from the H1 (above), but that derived title must NOT be written back as `---\ntitle: ...\n---` -- a
	// file the user wrote as plain Markdown stays plain Markdown after an accepted chat edit re-serializes it.
	test('a plain doc round-trips through parse -> serialize as byte-clean plain Markdown (no injected frontmatter)', () => {
		assert.strictEqual(serializeLivingDoc(parseLivingDoc(PLAIN_MD)), PLAIN_MD);
	});

	test('serializing a plain doc after an inserted block stays plain Markdown -- no injected title frontmatter', () => {
		// Mirrors accepting a chat insert on a plain doc: the body gains a paragraph, then _persist re-serializes.
		const withInsert = PLAIN_MD + '\nA freshly inserted paragraph from chat.\n';
		const serialized = serializeLivingDoc(parseLivingDoc(withInsert));
		assert.deepStrictEqual(
			{
				startsWithFrontmatter: serialized.startsWith('---'),
				injectsTitle: serialized.includes('title:'),
				keepsInsert: serialized.includes('A freshly inserted paragraph from chat.'),
				stillPlain: parseLivingDoc(serialized).isLiving,
			},
			{ startsWithFrontmatter: false, injectsTitle: false, keepsInsert: true, stillPlain: false },
		);
	});

	// A plain doc that DID author a `title:` (but no sources/context) keeps it -- we drop only the DERIVED
	// title, never frontmatter the user actually wrote.
	test('a plain doc with an authored title (no sources) keeps that title on round-trip', () => {
		const TITLED_PLAIN = ['---', 'title: My Notes', '---', '', 'Just some prose.'].join('\n') + '\n';
		assert.strictEqual(serializeLivingDoc(parseLivingDoc(TITLED_PLAIN)), TITLED_PLAIN);
	});

	// withFrontmatterSource edits only the frontmatter `sources:` list, leaving the body verbatim - so adding
	// a source via the UI never touches the prose (the add-source affordance, R5).
	test('withFrontmatterSource adds a source to an existing sources list and the body is untouched', () => {
		const next = withFrontmatterSource(WEEKLY_MD, 'crm.json', true);
		const doc = parseLivingDoc(next);
		assert.deepStrictEqual(doc.sources, ['metrics.csv', 'crm.json'], 'appended to the sources list');
		assert.ok(next.includes('Revenue grew [18%](bind:metrics.mrr.delta)'), 'prose is byte-identical');
		assert.strictEqual(doc.context.length, 1, 'context list untouched');
	});

	test('withFrontmatterSource is idempotent on add and a no-op removing a source that is not bound', () => {
		assert.strictEqual(withFrontmatterSource(WEEKLY_MD, 'metrics.csv', true), WEEKLY_MD, 'adding an existing source is a no-op');
		assert.strictEqual(withFrontmatterSource(WEEKLY_MD, 'absent.csv', false), WEEKLY_MD, 'removing an absent source is a no-op');
	});

	test('withFrontmatterSource removes a source, dropping the empty sources key but keeping context', () => {
		const next = withFrontmatterSource(WEEKLY_MD, 'metrics.csv', false);
		const doc = parseLivingDoc(next);
		assert.deepStrictEqual({ sources: doc.sources, context: doc.context }, { sources: [], context: ['market-research.md'] }, 'source removed, context kept');
		assert.ok(!next.includes('sources:'), 'the now-empty sources key is dropped');
	});

	// The same frontmatter editor drives the `context:` list (referenced files, R6) - add/remove a real file
	// reference without touching prose or the sources list.
	test('withFrontmatterList edits the context list for referenced files, leaving sources and prose intact', () => {
		const added = withFrontmatterList(WEEKLY_MD, 'context', 'appendix.md', true);
		assert.deepStrictEqual(parseLivingDoc(added).context, ['market-research.md', 'appendix.md'], 'reference appended to the context list');
		assert.deepStrictEqual(parseLivingDoc(added).sources, ['metrics.csv'], 'sources untouched');
		assert.ok(added.includes('Growth accelerated sharply this week.'), 'prose untouched');

		const removed = withFrontmatterList(WEEKLY_MD, 'context', 'market-research.md', false);
		assert.deepStrictEqual({ context: parseLivingDoc(removed).context, sources: parseLivingDoc(removed).sources }, { context: [], sources: ['metrics.csv'] }, 'context reference removed, sources kept');
	});

	test('withFrontmatterSource creates a frontmatter block when a plain doc gains its first source', () => {
		const next = withFrontmatterSource(PLAIN_MD, 'metrics.csv', true);
		const doc = parseLivingDoc(next);
		assert.deepStrictEqual(doc.sources, ['metrics.csv'], 'first source recorded');
		assert.strictEqual(doc.isLiving, true, 'the doc is now living');
		assert.ok(doc.body.includes('- first item'), 'original body preserved');
		assert.ok(doc.title === 'Project Readme', 'title still derives from the H1');
	});

	test('withReplacedBody swaps the body but keeps the frontmatter (so a PM edit of a living doc keeps its sources)', () => {
		// Simulates the ProseMirror round-trip: the editor hands back only the body (bind links intact).
		const editedBody = 'Revenue grew [12%](bind:metrics.mrr.delta) week-on-week to [$48.6k](bind:metrics.mrr) MRR, on [427](bind:metrics.signups) new signups, and the team shipped on time.';
		const next = withReplacedBody(WEEKLY_MD, editedBody);
		const doc = parseLivingDoc(next);
		assert.deepStrictEqual({
			sources: doc.sources,
			context: doc.context,
			isLiving: doc.isLiving,
			keepsEdit: doc.body.includes('shipped on time'),
			keepsBind: doc.body.includes('[12%](bind:metrics.mrr.delta)'),
		}, { sources: ['metrics.csv'], context: ['market-research.md'], isLiving: true, keepsEdit: true, keepsBind: true });
	});

	test('withReplacedBody on a plain doc (no frontmatter) just returns the new body', () => {
		assert.strictEqual(withReplacedBody('# Title\n\nold body\n', 'new body').trim(), 'new body');
	});

	// Issue #357 / ticket #385 round 3: the non-approve re-attachment carries the frontmatter through
	// byte-exact and updates ONLY a modelled scalar whose value moved. A CRLF-authored file keeps its CRLF
	// endings on every unmodelled provenance key (the harness fixtures are LF, so this is a pure unit test),
	// and a nested map whose child key collides with a modelled key is not hoisted or destroyed.
	test('withMergedFrontmatter advances a changed scalar while carrying unmodelled keys byte-exact (CRLF + nested map)', () => {
		const crlf = ['---', 'title: Q3 Board Update', 'subtitle: Week 23', 'template: Weekly report', 'owner:', '  title: Team Lead', '  status: active', '---', '', '## Highlights', '', 'Body text.'].join('\r\n') + '\r\n';
		const advanced = { ...parseLivingDoc(crlf), subtitle: 'Week 25' };
		const out = withMergedFrontmatter(crlf, advanced);
		assert.deepStrictEqual({
			subtitleAdvanced: out.includes('subtitle: Week 25\r\n'),
			provenanceKeepsCRLF: out.includes('template: Weekly report\r\n'),
			nestedMapIntact: out.includes('owner:\r\n  title: Team Lead\r\n  status: active\r\n'),
			topLevelTitleIntact: out.includes('title: Q3 Board Update\r\n'),
		}, { subtitleAdvanced: true, provenanceKeepsCRLF: true, nestedMapIntact: true, topLevelTitleIntact: true });
	});

	// plan 16 iter 5: the chat-response parser must be tolerant -- a non-JSON / truncated / prose-wrapped
	// reply degrades to a plain answer instead of throwing (which used to surface as "the agent model errored").
	test('parseChatResponse extracts a clean JSON object with reply + edits + inserts', () => {
		const raw = '{"reply":"Done.","edits":[{"oldText":"a","newText":"b"}],"inserts":[{"afterHeading":"","newText":"- x"}]}';
		assert.deepStrictEqual(parseChatResponse(raw), {
			reply: 'Done.',
			edits: [{ oldText: 'a', newText: 'b' }],
			inserts: [{ afterHeading: '', newText: '- x' }],
		});
	});

	test('parseChatResponse extracts the JSON object even when the model wraps it in prose', () => {
		const raw = 'Sure, here is the change:\n{"reply":"Updated the intro.","edits":[],"inserts":[]}\nHope that helps!';
		assert.deepStrictEqual(parseChatResponse(raw), { reply: 'Updated the intro.', edits: [], inserts: [] });
	});

	test('parseChatResponse degrades a plain-text (non-JSON) reply to a plain answer with no changes', () => {
		const raw = 'The document already covers that, so no change is needed.';
		assert.deepStrictEqual(parseChatResponse(raw), { reply: raw, edits: [], inserts: [] });
	});

	test('parseChatResponse degrades malformed / truncated JSON to a plain answer instead of throwing', () => {
		const raw = '{"reply":"half a sentence and then the stream cut o';
		assert.deepStrictEqual(parseChatResponse(raw), { reply: raw, edits: [], inserts: [] });
	});

	test('parseChatResponse extracts the object even when the model appends a stray trailing brace', () => {
		// Observed live: the cheap model emits a valid object followed by an extra "}". The old
		// indexOf('{')..lastIndexOf('}') slice swallowed the stray brace, threw, and leaked the raw JSON
		// into the chat. The balanced-brace scan stops at the first complete object.
		const raw = '{"reply":"","edits":[{"oldText":"blue","newText":"red"}],"inserts":[]}}';
		assert.deepStrictEqual(parseChatResponse(raw), {
			reply: '',
			edits: [{ oldText: 'blue', newText: 'red' }],
			inserts: [],
		});
	});

	test('parseChatResponse keeps braces that appear inside string values', () => {
		const raw = '{"reply":"use {tokens} like this","edits":[],"inserts":[]} trailing prose';
		assert.deepStrictEqual(parseChatResponse(raw), { reply: 'use {tokens} like this', edits: [], inserts: [] });
	});

	test('parseChatResponse drops a stray trailing close bracket the model appends to an array', () => {
		// Observed live (gpt-4o-mini): a complete object whose final array carries an extra "]" -
		// {..."inserts":[]]}. The brace scan must drop the stray closer rather than fail and leak the JSON.
		const raw = '{"reply":"","edits":[{"oldText":"blue","newText":"red"}],"inserts":[]]}';
		assert.deepStrictEqual(parseChatResponse(raw), {
			reply: '',
			edits: [{ oldText: 'blue', newText: 'red' }],
			inserts: [],
		});
	});

	test('parseChatResponse keeps a real nested array intact', () => {
		const raw = '{"reply":"ok","edits":[{"oldText":"a","newText":"b"}],"inserts":[]}';
		assert.deepStrictEqual(parseChatResponse(raw), {
			reply: 'ok',
			edits: [{ oldText: 'a', newText: 'b' }],
			inserts: [],
		});
	});

	// --- extractStreamingReply: show the human prose live, not the raw JSON envelope (plan 27 iter 3) ---

	test('extractStreamingReply shows the growing reply prose from a partial envelope, not the raw JSON', () => {
		assert.strictEqual(extractStreamingReply('{"reply":"Access to systems is grante'), 'Access to systems is grante');
	});

	test('extractStreamingReply returns the reply and drops the trailing envelope once the value closes', () => {
		assert.strictEqual(extractStreamingReply('{"reply":"All done.","edits":[]}'), 'All done.');
	});

	test('extractStreamingReply unescapes quotes and newlines inside the streamed reply', () => {
		assert.strictEqual(extractStreamingReply('{"reply":"He said \\"hi\\"\\nthen left'), 'He said "hi"\nthen left');
	});

	test('extractStreamingReply returns empty while the reply value has not started (stays on Thinking)', () => {
		assert.strictEqual(extractStreamingReply('{"re'), '');
		assert.strictEqual(extractStreamingReply('{'), '');
	});

	test('extractStreamingReply passes a plain-text (non-envelope) reply through unchanged', () => {
		assert.strictEqual(extractStreamingReply('Just a plain answer, no JSON.'), 'Just a plain answer, no JSON.');
	});

	test('extractStreamingReply waits on a trailing backslash rather than mis-escaping across chunks', () => {
		// The delta split mid-escape ("...hi\\") must not swallow the next real character.
		assert.strictEqual(extractStreamingReply('{"reply":"hi\\'), 'hi');
	});

	// plan 18 (D-C): one model call returns a per-document edit map for the working set.
	test('parseMultiChatResponse extracts a reply plus per-document edits/inserts keyed by doc', () => {
		const raw = '{"reply":"Changed blue to red.","docs":[{"doc":"Project Brief","edits":[{"oldText":"blue","newText":"red"}]},{"doc":"Appendix","inserts":[{"afterHeading":"","newText":"Primary is red."}]}]}';
		assert.deepStrictEqual(parseMultiChatResponse(raw), {
			reply: 'Changed blue to red.',
			docs: [
				{ doc: 'Project Brief', edits: [{ oldText: 'blue', newText: 'red' }], inserts: [] },
				{ doc: 'Appendix', edits: [], inserts: [{ afterHeading: '', newText: 'Primary is red.' }] },
			],
		});
	});

	test('parseMultiChatResponse degrades a plain-text / malformed reply to a plain answer with no docs', () => {
		assert.deepStrictEqual(parseMultiChatResponse('I could not find blue anywhere.'), { reply: 'I could not find blue anywhere.', docs: [] });
		assert.deepStrictEqual(parseMultiChatResponse('{"reply":"cut o'), { reply: '{"reply":"cut o', docs: [] });
	});

	test('parseMultiChatResponse extracts the object even with a stray trailing brace', () => {
		const raw = '{"reply":"Done.","docs":[{"doc":"Brief","edits":[{"oldText":"a","newText":"b"}]}]}}';
		assert.deepStrictEqual(parseMultiChatResponse(raw), {
			reply: 'Done.',
			docs: [{ doc: 'Brief', edits: [{ oldText: 'a', newText: 'b' }], inserts: [] }],
		});
	});

	test('parseMultiChatResponse drops a stray trailing close bracket', () => {
		const raw = '{"reply":"Done.","docs":[{"doc":"Brief","edits":[{"oldText":"a","newText":"b"}]}]]}';
		assert.deepStrictEqual(parseMultiChatResponse(raw), {
			reply: 'Done.',
			docs: [{ doc: 'Brief', edits: [{ oldText: 'a', newText: 'b' }], inserts: [] }],
		});
	});

	test('parseMultiChatResponse reads a per-edit source grounding (sourceQuote + sourceLine) when present', () => {
		const raw = '{"reply":"Applied.","docs":[{"doc":"Access Control Policy","edits":[{"heading":"MFA","oldText":"old","newText":"new","rationale":"MFA now required","sourceQuote":"multi-factor authentication is now REQUIRED for all administrative access","sourceLine":2}]}]}';
		assert.deepStrictEqual(parseMultiChatResponse(raw), {
			reply: 'Applied.',
			docs: [{
				doc: 'Access Control Policy',
				edits: [{ heading: 'MFA', oldText: 'old', newText: 'new', rationale: 'MFA now required', sourceQuote: 'multi-factor authentication is now REQUIRED for all administrative access', sourceLine: 2 }],
				inserts: [],
			}],
		});
	});

	test('parseMultiChatResponse reads a source grounding on an insert too', () => {
		const raw = '{"reply":"Added.","docs":[{"doc":"Cryptography Policy","inserts":[{"afterHeading":"Standards","newText":"TLS 1.2+","sourceQuote":"data in transit must use TLS 1.2 or higher","sourceLine":19}]}]}';
		assert.deepStrictEqual(parseMultiChatResponse(raw), {
			reply: 'Added.',
			docs: [{
				doc: 'Cryptography Policy',
				edits: [],
				inserts: [{ afterHeading: 'Standards', newText: 'TLS 1.2+', sourceQuote: 'data in transit must use TLS 1.2 or higher', sourceLine: 19 }],
			}],
		});
	});

	test('parseMultiChatResponse degrades gracefully when the model omits the source grounding (no fabricated fields)', () => {
		const raw = '{"reply":"Applied.","docs":[{"doc":"Backup Policy","edits":[{"oldText":"a","newText":"b","rationale":"tidy"}]}]}';
		assert.deepStrictEqual(parseMultiChatResponse(raw), {
			reply: 'Applied.',
			docs: [{ doc: 'Backup Policy', edits: [{ oldText: 'a', newText: 'b', rationale: 'tidy' }], inserts: [] }],
		});
	});

	test('parseMultiChatResponse ignores a non-numeric sourceLine but keeps the quote', () => {
		const raw = '{"reply":"Applied.","docs":[{"doc":"Backup Policy","edits":[{"oldText":"a","newText":"b","sourceQuote":"a decision","sourceLine":"line two"}]}]}';
		assert.deepStrictEqual(parseMultiChatResponse(raw), {
			reply: 'Applied.',
			docs: [{ doc: 'Backup Policy', edits: [{ oldText: 'a', newText: 'b', sourceQuote: 'a decision' }], inserts: [] }],
		});
	});

	suite('findQuoteLine', () => {
		const transcript = [
			'Security Review - 3 March 2026',
			'2  Decision: multi-factor authentication is now REQUIRED for all administrative access,',
			'3          including cloud consoles, production servers, and the identity provider.',
			'19 Decision: data in transit must use TLS 1.2 or higher; TLS 1.0 and 1.1 are disallowed.',
		].join('\n');

		test('finds the true file line of a verbatim quote, ignoring the printed line-number token', () => {
			assert.strictEqual(findQuoteLine(transcript, 'data in transit must use TLS 1.2 or higher'), 4);
		});

		test('resolves a decision the source wrapped across two lines to its first line', () => {
			assert.strictEqual(findQuoteLine(transcript, 'multi-factor authentication is now REQUIRED for all administrative access, including cloud consoles'), 2);
		});

		test('returns undefined when the quote is not in the source (never guesses a line)', () => {
			assert.strictEqual(findQuoteLine(transcript, 'a decision that was never made'), undefined);
		});

		test('does not false-match a short source line inside a longer unrelated quote', () => {
			// A brief source line must not be claimed by a longer quote that merely contains its words -
			// that would assign a wrong-but-real line and break the decisions column's provenance.
			const short = ['1  MFA required.', '2  Logs are retained for six months.'].join('\n');
			assert.strictEqual(findQuoteLine(short, 'MFA required for all cloud systems and third-party integrations'), undefined);
		});
	});

	// The apply-layer of the decision-68 data-loss fix (plan 31 iter 1): a chat edit that targets ONE item
	// of a list block must anchor + splice at that item's boundary so sibling items are never destroyed.
	suite('list-item anchoring (decision-68 data loss)', () => {
		const FOUR_ITEM = ['- Expand the free trial', '- Win back churned accounts', '- Launch an annual plan', '- Improve onboarding'].join('\n');

		test('listItems splits a list block into per-line items; returns [] for prose', () => {
			assert.deepStrictEqual(listItems(FOUR_ITEM).map(i => i.text), [
				'- Expand the free trial', '- Win back churned accounts', '- Launch an annual plan', '- Improve onboarding',
			]);
			assert.deepStrictEqual(listItems('Just a prose paragraph, not a list.'), []);
		});

		test('scopeBlockEdit narrows a single-item quote to that item; keeps the whole block for prose', () => {
			const scoped = scopeBlockEdit(FOUR_ITEM, '- Win back churned accounts');
			assert.strictEqual(scoped.oldText, '- Win back churned accounts');
			// A prose block (or a quote that spans the whole list) is left as the whole block.
			assert.strictEqual(scopeBlockEdit('A single prose block.', 'A single prose block.').oldText, 'A single prose block.');
		});

		// Every assertion below reads the WHOLE closed result (docs/30 invariant I1), never just its text: the
		// point of the discriminated return is that `landed` and the text arrive together and cannot be read
		// apart. A helper that unwrapped the text for brevity would re-open exactly the hole issue #329 came
		// through, so each test snapshots `{landed, text}` or `{landed, reason}` in one deepStrictEqual.

		test('applyBlockEdit splices ONE item and leaves siblings byte-identical (the data-loss repro)', () => {
			// The pre-fix behaviour (whole-block replace with the one rewritten item) dropped the three siblings;
			// the snapshot below is the whole block, so their survival is asserted byte for byte.
			assert.deepStrictEqual(applyBlockEdit(FOUR_ITEM, '- Win back churned accounts', '- Win back churned accounts with a targeted email campaign'), {
				landed: true,
				text: [
					'- Expand the free trial',
					'- Win back churned accounts with a targeted email campaign',
					'- Launch an annual plan',
					'- Improve onboarding',
				].join('\n'),
			});
		});

		test('applyBlockEdit replaces the whole block for a prose edit (oldText === block)', () => {
			assert.deepStrictEqual(
				applyBlockEdit('Growth remained steady this week.', 'Growth remained steady this week.', 'Growth accelerated this week.'),
				{ landed: true, text: 'Growth accelerated this week.' },
			);
		});

		test('ordered lists: editing item 2 of 4 preserves the numbered siblings', () => {
			const ordered = ['1. First lever', '2. Second lever', '3. Third lever', '4. Fourth lever'].join('\n');
			assert.deepStrictEqual(applyBlockEdit(ordered, '2. Second lever', '2. Second lever, now with a metric'), {
				landed: true,
				text: ['1. First lever', '2. Second lever, now with a metric', '3. Third lever', '4. Fourth lever'].join('\n'),
			});
		});

		test('nested lists (one level): editing a parent item leaves its nested children untouched', () => {
			const nested = ['- Growth', '  - trial expansion', '  - annual plan', '- Retention', '- Activation'].join('\n');
			assert.deepStrictEqual(applyBlockEdit(nested, '- Retention', '- Retention and win-back'), {
				landed: true,
				text: ['- Growth', '  - trial expansion', '  - annual plan', '- Retention and win-back', '- Activation'].join('\n'),
			});
		});

		test('a list item containing a bound figure atom stays byte-identical when a sibling is edited', () => {
			const withFigure = ['- Revenue grew this quarter', '- Costs stayed flat this quarter', '- Margin improved', '- Cash balance is [$48.6k](bind:metrics.mrr)'].join('\n');
			assert.deepStrictEqual(applyBlockEdit(withFigure, '- Costs stayed flat this quarter', '- Costs fell sharply this quarter'), {
				landed: true,
				text: ['- Revenue grew this quarter', '- Costs fell sharply this quarter', '- Margin improved', '- Cash balance is [$48.6k](bind:metrics.mrr)'].join('\n'),
			});
		});

		test('fail-soft AND fail-loud: a scoped oldText no longer present reports anchor-miss, never a block', () => {
			// The anchor item was already edited away. Two things must hold at once, and only one of them used
			// to: applyBlockEdit must NOT fall back to a whole-block replace (the sibling-destroying data loss
			// this guard was built for), AND it must SAY so. The old signature returned `blockText` here -
			// byte-identical to a successful whole-block no-op - so `approve()` could not tell the difference
			// and recorded an approval over an untouched document (docs/30 I1, issue #329). There is no text on
			// a failed result to fall back to, by construction.
			assert.deepStrictEqual(applyBlockEdit(FOUR_ITEM, '- An item that is not here', '- rewritten'), { landed: false, reason: 'anchor-miss' });
		});
	});

	// The Properties panel's frontmatter read/write path (plan 45 pin 12 / P12.3). The panel edits title,
	// status, tags and policy; each must round-trip through the parser + writer and land on disk, and must
	// never touch the prose body.
	suite('Properties frontmatter (plan 45 pin 12)', () => {
		test('parseLivingDoc reads status, tags and policy additively', () => {
			const md = ['---', 'title: Q3 Report', 'status: In review', 'policy: ask-first', 'tags:', '  - draft', '  - finance', '---', '', 'Body text here.'].join('\n') + '\n';
			const doc = parseLivingDoc(md);
			assert.deepStrictEqual(
				{ title: doc.title, status: doc.status, tags: doc.tags, policy: doc.policy, body: doc.body },
				{ title: 'Q3 Report', status: 'In review', tags: ['draft', 'finance'], policy: 'ask-first', body: 'Body text here.\n' });
		});

		test('tags tolerate a compact inline comma list', () => {
			const doc = parseLivingDoc(['---', 'tags: draft, finance', '---', '', 'Body.'].join('\n') + '\n');
			assert.deepStrictEqual(doc.tags, ['draft', 'finance']);
		});

		test('withFrontmatterScalar sets, updates and clears a field, body verbatim', () => {
			const base = ['---', 'title: Old Title', '---', '', 'The **body** stays exactly as written.'].join('\n') + '\n';
			const set = withFrontmatterScalar(base, 'status', 'Approved');
			const doc = parseLivingDoc(set);
			assert.strictEqual(doc.status, 'Approved');
			assert.strictEqual(doc.body, 'The **body** stays exactly as written.\n');
			// Updating the same field replaces it in place, not appends.
			const updated = withFrontmatterScalar(set, 'status', 'Published');
			assert.strictEqual((updated.match(/status:/g) ?? []).length, 1);
			assert.strictEqual(parseLivingDoc(updated).status, 'Published');
			// Clearing removes the line; a no-op change returns the input identity.
			assert.strictEqual(parseLivingDoc(withFrontmatterScalar(updated, 'status', '')).status, '');
			assert.strictEqual(withFrontmatterScalar(set, 'status', 'Approved'), set);
		});

		test('withFrontmatterScalar prepends a frontmatter block to a plain doc, body untouched', () => {
			const plain = '# Readme\n\nJust prose.\n';
			const titled = withFrontmatterScalar(plain, 'title', 'My Doc');
			const doc = parseLivingDoc(titled);
			assert.strictEqual(doc.frontmatterTitle, 'My Doc');
			assert.ok(doc.body.includes('Just prose.'), 'the original prose survives');
		});

		test('withFrontmatterTag adds and removes one tag idempotently', () => {
			const base = ['---', 'title: T', '---', '', 'Body.'].join('\n') + '\n';
			const one = withFrontmatterTag(base, 'urgent', true);
			assert.deepStrictEqual(parseLivingDoc(one).tags, ['urgent']);
			const two = withFrontmatterTag(one, 'q3', true);
			assert.deepStrictEqual(parseLivingDoc(two).tags, ['urgent', 'q3']);
			// Adding an existing tag / removing an absent one is a no-op (returns input identity).
			assert.strictEqual(withFrontmatterTag(two, 'urgent', true), two);
			assert.deepStrictEqual(parseLivingDoc(withFrontmatterTag(two, 'urgent', false)).tags, ['q3']);
		});

		test('serializeLivingDoc preserves status/tags/policy across a block re-serialise', () => {
			const md = ['---', 'title: Q3', 'status: Draft', 'policy: never', 'tags:', '  - a', 'sources:', '  - metrics.csv', '---', '', 'Body.'].join('\n') + '\n';
			const round = parseLivingDoc(serializeLivingDoc(parseLivingDoc(md)));
			assert.deepStrictEqual(
				{ status: round.status, tags: round.tags, policy: round.policy, sources: round.sources },
				{ status: 'Draft', tags: ['a'], policy: 'never', sources: ['metrics.csv'] });
		});

		test('a plain Markdown doc still round-trips byte-clean (no injected frontmatter)', () => {
			assert.strictEqual(serializeLivingDoc(parseLivingDoc(PLAIN_MD)), PLAIN_MD);
		});
	});
});
