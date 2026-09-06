/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import type Anthropic from '@anthropic-ai/sdk';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { hashContent } from '../../common/changeRecord.js';
import { ChangeStore, IChangeStoreDocuments } from '../../common/changeStore.js';
import { AgentAssistantBlock, IAgentModelClient, IAgentModelRequest, IAgentModelResponse, IAgentToolResultEvent, runAgentLoop } from '../../common/livingDocsAgentLoop.js';
import {
	AGENT_EDITING_TOOL_DEFINITIONS, AGENT_PROPOSE_SEGMENTS_TOOL, AGENT_READ_DOCUMENT_TOOL,
	AGENT_READ_ONLY_TOOL_DEFINITIONS, agentStepLabel, composeAgentEditLedger, composeAgentTask,
	createEditingAgentTools, describeAgentRunFailure, IAgentEditTarget, IAgentScopeDoc, IAgentToolHost
} from '../../common/livingDocsAgentTools.js';
import { frontmatterBlock, parseLivingDoc, withReplacedBody } from '../../common/livingDocMarkdown.js';
import { FakeChangeFileSystem, fakeClock, fakeIds } from './changeStoreFakes.js';

// The first end-to-end agentic edit through the new loop (issue #381; doc 30 section 2.4 `propose_segments`).
//
// This suite drives BOTH seams the ticket names and nothing else. S2 is the loop: a SCRIPTED fake model
// client and the tool registry, so a full model -> segments -> receipts -> finish conversation runs at unit
// speed with no network, no DOM and no service - a unit run can never be answered by a live broker. S3 is
// the change store's write boundary: a REAL `ChangeStore` over an in-memory `IChangeStoreDocuments`, so the
// "reviewable diff in place" acceptance is proved by a change actually landing in the store the shipped
// review surfaces read, and by approving it and looking at the bytes.
//
// The document fixture carries FRONTMATTER on purpose. The store's seam speaks body text only, and the body
// is re-attached with `withReplacedBody` exactly as the service does, so "frontmatter never enters model
// scope" is a property this suite can actually check rather than a claim in a comment.

suite('livingDocs agent edit loop (issue #381, doc 30 2.4)', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	const HOME = 'file:///ws/.abstract';
	const PRICING = 'file:///ws/pricing.md';

	const PRICING_FILE = [
		'---',
		'title: Pricing',
		'status: draft',
		'fromTemplate: pricing-v2',
		'---',
		'',
		'# Pricing',
		'',
		'We charge $10 per seat per month.',
		'',
		'## Notes',
		'',
		'Billing runs on the first of the month.',
		'',
		'- Seats are per person',
		'- Annual billing saves 10%',
		''
	].join('\n');

	// B1 `# Pricing`, B2 the price line, B3 `## Notes`, B4 the billing line, B5 the list.

	type TextBlockParam = Anthropic.Messages.TextBlockParam;
	type ToolUseBlockParam = Anthropic.Messages.ToolUseBlockParam;

	function call(id: string, name: string, input: unknown): ToolUseBlockParam {
		return { type: 'tool_use', id, name, input };
	}
	function text(value: string): TextBlockParam {
		return { type: 'text', text: value };
	}
	function toolTurn(...content: readonly AgentAssistantBlock[]): IAgentModelResponse {
		return { content, stopReason: 'tool_use' };
	}

	/** The scripted fake model client. It NEVER opens a socket; a step past the end of the script throws. */
	class ScriptedClient implements IAgentModelClient {
		readonly requests: IAgentModelRequest[] = [];
		private index = 0;
		constructor(private readonly script: readonly IAgentModelResponse[]) { }
		async send(request: IAgentModelRequest): Promise<IAgentModelResponse> {
			this.requests.push(request);
			const next = this.script[this.index++];
			if (!next) { throw new Error(`the loop took step ${this.index}, past the end of the script`); }
			return next;
		}
	}

	/**
	 * The project as the store sees it: whole files in `raw`, body text over the seam.
	 *
	 * The split is the frontmatter quarantine (doc 30 section 2.1 / 8.3), reproduced here rather than
	 * simplified away: `read` hands out `parseLivingDoc(...).body` and `write` puts it back with
	 * `withReplacedBody`, so nothing on the model's side of this fixture can even address the `---` block.
	 */
	class Project implements IChangeStoreDocuments {
		readonly raw = new Map<string, string>([[PRICING, PRICING_FILE]]);
		/** Which documents are dialled "never change", so the policy refusal can be staged. */
		readonly locked = new Set<string>();
		/** The live values bind links resolve to for the model, as `read_document` would show them. */
		readonly resolved = new Map<string, string>();

		async read(docUri: string): Promise<string | undefined> {
			const file = this.raw.get(docUri);
			return file === undefined ? undefined : parseLivingDoc(file).body;
		}
		async snapshot(docUri: string): Promise<string> {
			return `snapshot-of-${docUri}`;
		}
		async write(docUri: string, body: string): Promise<void> {
			const file = this.raw.get(docUri);
			if (file === undefined) { throw new Error(`no such document: ${docUri}`); }
			this.raw.set(docUri, withReplacedBody(file, body));
		}

		/** The bind resolver the host applies before the model reads anything, as the service's does. */
		resolve(text: string): string {
			return text.replace(/\[([^\]]*)\]\(bind:([^)]+)\)/g, (_m, label: string, key: string) => this.resolved.get(key) ?? label);
		}
	}

	interface IStage {
		readonly project: Project;
		readonly store: ChangeStore;
		readonly host: IAgentToolHost;
		/** Every hunk batch the host was asked to record, so a refusal can be proved to have written nothing. */
		readonly recorded: string[][];
	}

	async function stage(): Promise<IStage> {
		const project = new Project();
		const store = new ChangeStore(new FakeChangeFileSystem(), project, HOME, fakeClock(), fakeIds());
		await store.open();
		const recorded: string[][] = [];

		const editTarget = async (docId: string): Promise<IAgentEditTarget | undefined> => {
			const file = project.raw.get(docId);
			if (file === undefined) { return undefined; }
			const doc = parseLivingDoc(file);
			return {
				docId,
				title: doc.title,
				body: doc.body,
				blockViews: doc.blocks.map(block => block.type === 'heading' ? `${'#'.repeat(block.level ?? 1)} ${project.resolve(block.text)}` : project.resolve(block.text)),
				policy: project.locked.has(docId) ? 'never' : 'ask',
			};
		};

		const host: IAgentToolHost = {
			listDocuments: async () => [...project.raw.keys()].map(docId => ({
				docId, title: parseLivingDoc(project.raw.get(docId)!).title, status: '', policy: '', approxTokens: 100, headings: [],
			})),
			readDocument: async docId => {
				const file = project.raw.get(docId);
				if (file === undefined) { return undefined; }
				const doc = parseLivingDoc(file);
				return {
					docId,
					title: doc.title,
					blocks: doc.blocks.map(block => block.level === undefined
						? { type: block.type, text: project.resolve(block.text) }
						: { type: block.type, text: project.resolve(block.text), level: block.level }),
				};
			},
			readSource: async () => undefined,
			editTarget,
			recordSegmentChanges: async (target, hunks, intent) => {
				recorded.push(hunks.map(hunk => hunk.label));
				const body = (await project.read(target.docId))!;
				const proposeResult = await store.propose({
					setId: 'set-1',
					changes: hunks.map(hunk => ({
						anchors: [{ docUri: target.docId, baseRevision: hashContent(body), span: hunk.span, oldText: hunk.oldText, newText: hunk.newText }],
						kind: 'meaning' as const,
						baseLength: body.length,
						plannerIntent: intent,
						display: { docTitle: target.title, rationale: intent, via: 'model' as const, ...(hunk.op === 'insert' ? { insert: true, nowText: hunk.newText.trim() } : {}) },
					})),
				});
				return proposeResult.receipts.length === hunks.length ? proposeResult.receipts.map(receipt => receipt.changeId) : undefined;
			},
		};
		return { project, store, host, recorded };
	}

	const SCOPE: readonly IAgentScopeDoc[] = [{ docId: PRICING, title: 'Pricing' }];

	/** Run one scripted conversation over the editing surface and hand back everything worth asserting on. */
	async function run(it: IStage, script: readonly IAgentModelResponse[], scope: readonly IAgentScopeDoc[] = SCOPE) {
		const surface = createEditingAgentTools({ host: it.host, scope });
		const results: IAgentToolResultEvent[] = [];
		const errors: string[] = [];
		const result = await runAgentLoop({
			task: composeAgentTask('Rename the Notes heading and soften the billing line.', scope),
			system: surface.systemPrompt,
			client: new ScriptedClient(script),
			registry: surface.registry,
			onEvent: event => {
				if (event.type === 'toolResult') { results.push(event); }
				if (event.type === 'toolError') { errors.push(event.message); }
			},
		});
		return { result, results, errors, receipts: surface.receipts(), ledger: composeAgentEditLedger(surface.receipts()) };
	}

	/** The segment list a well-behaved planner emits for the fixture: a heading rename plus a prose edit. */
	const GOOD_SEGMENTS = [
		{ keep: 'B1-B2' },
		{ replace: 'B3', echo: ['## Notes'], content: '## Billing notes' },
		{ replace: 'B4', echo: ['Billing runs on the first'], content: 'Billing runs on the first working day of the month.' },
		{ keep: 'B5' },
	];

	function readThenPropose(segments: unknown, intent: string = 'Rename the heading and soften the billing line.'): readonly IAgentModelResponse[] {
		return [
			toolTurn(call('c1', AGENT_READ_DOCUMENT_TOOL, { docId: PRICING })),
			toolTurn(text('Here is what I propose.'), call('c2', AGENT_PROPOSE_SEGMENTS_TOOL, { docId: PRICING, segments, intent })),
			toolTurn(call('c3', 'finish', { summary: 'I proposed two changes to Pricing.' })),
		];
	}

	// --- the acceptance: an ask becomes a reviewable diff in place ---------------------------------------

	test('a change the model asks for becomes reviewable changes in the store, with a receipt per segment', async () => {
		const it = await stage();
		const { result, results, receipts, ledger } = await run(it, readThenPropose(GOOD_SEGMENTS));

		assert.strictEqual(result.outcome.type, 'finished');

		// S3: the changes are in the store the shipped review surfaces read, as a diff in place.
		const open = it.store.openChanges();
		assert.strictEqual(open.length, 2);
		assert.deepStrictEqual(open.map(change => change.anchors[0].oldText), ['## Notes', 'Billing runs on the first of the month.']);
		assert.deepStrictEqual(open.map(change => change.anchors[0].newText), ['## Billing notes', 'Billing runs on the first working day of the month.']);
		assert.deepStrictEqual(open.map(change => change.status), ['pending', 'pending']);

		// The tool told the model exactly what happened, in its own labels.
		const proposeResult = results.find(event => event.name === AGENT_PROPOSE_SEGMENTS_TOOL)!;
		assert.ok(proposeResult.content.includes('2 changes queued for review, 0 dropped, 3 blocks kept unchanged'));
		assert.ok(proposeResult.content.includes(`segment 2 (B3): queued as change ${open[0].id}`));
		assert.ok(proposeResult.content.includes(`segment 3 (B4): queued as change ${open[1].id}`));

		// The receipts are per segment and carry the store's own ids - the record #382 will reconcile against.
		assert.deepStrictEqual(receipts.segmentReceipts.map(p => ({ segmentIndex: p.segmentIndex, label: p.label, changeId: p.changeId, reason: p.reason })), [
			{ segmentIndex: 1, label: 'B3', changeId: open[0].id, reason: undefined },
			{ segmentIndex: 2, label: 'B4', changeId: open[1].id, reason: undefined },
		]);
		assert.strictEqual(receipts.invalidSegmentLists, 0);

		// And the person reads a ledger the host composed, not a count the model narrated.
		assert.ok(ledger.includes('In Pricing: 2 changes are waiting for your review'));
		assert.ok(ledger.includes('Nothing has been written to your documents yet'));
	});

	test('approving the proposed changes rewrites only what was proposed - frontmatter and every other byte survive', async () => {
		const it = await stage();
		await run(it, readThenPropose(GOOD_SEGMENTS));
		const report = await it.store.approveByIds(it.store.openChanges().map(change => change.id));
		assert.deepStrictEqual(report.skipped, []);

		const after = it.project.raw.get(PRICING)!;
		// The `---` block is byte-identical, including `fromTemplate`, which the old serialiser dropped.
		assert.strictEqual(frontmatterBlock(after), frontmatterBlock(PRICING_FILE));
		assert.ok(after.includes('fromTemplate: pricing-v2'));
		// The document is the base with exactly the two hunks spliced in, and nothing else moved.
		assert.strictEqual(after, PRICING_FILE
			.replace('## Notes', '## Billing notes')
			.replace('Billing runs on the first of the month.', 'Billing runs on the first working day of the month.'));
	});

	test('a heading rename really lands - the instruction that used to evaporate at queue time', async () => {
		const it = await stage();
		await run(it, readThenPropose([
			{ keep: 'B1-B2' },
			{ replace: 'B3', echo: ['## Notes'], content: '## Billing notes' },
			{ keep: 'B4-B5' },
		]));
		const change = it.store.openChanges()[0];
		assert.strictEqual(change.anchors[0].oldText, '## Notes');
		assert.strictEqual(change.anchors[0].newText, '## Billing notes');
	});

	// --- the refusals, each named, each proved to have written nothing -----------------------------------

	test('an off-by-one range fails validation loudly and queues NOTHING', async () => {
		const it = await stage();
		const { result, errors, receipts, ledger } = await run(it, readThenPropose([
			{ keep: 'B1-B2' },
			// The model meant B3 and wrote B4: syntactically perfect, semantically one block out.
			{ replace: 'B4', echo: ['## Notes'], content: '## Billing notes' },
			{ keep: 'B3' },
			{ keep: 'B5' },
		]));

		assert.strictEqual(result.outcome.type, 'finished');
		assert.strictEqual(it.store.openChanges().length, 0, 'a rejected list must not queue anything at all');
		assert.deepStrictEqual(it.recorded, [], 'the store must not even be asked to record a rejected list');
		assert.strictEqual(errors.length, 1);
		assert.ok(errors[0].startsWith('invalid_segments:'), errors[0]);
		assert.ok(errors[0].includes('B4 does not start with "## Notes"'), errors[0]);
		assert.ok(errors[0].includes('Nothing was changed'), errors[0]);
		assert.strictEqual(receipts.invalidSegmentLists, 1);
		assert.deepStrictEqual(receipts.segmentReceipts, []);
		assert.ok(ledger.includes('rejected before it reached your review queue'));
	});

	test('duplicate headings cannot be told apart by an echo, so the call is rejected and nothing is queued', async () => {
		// The refuted case (issue #381 cycle 2): two `## Notes` sections. No echo can distinguish byte-identical
		// blocks, so the whole call is rejected loudly rather than landing on one the reviewer cannot tell is
		// wrong - and nothing reaches the store.
		const it = await stage();
		it.project.raw.set(PRICING, ['---', 'title: Pricing', '---', '', '# Pricing', '', '## Notes', '', 'Alpha.', '', '## Notes', '', 'Bravo.', ''].join('\n'));
		const { errors, receipts } = await run(it, readThenPropose([
			{ keep: 'B1' },
			{ replace: 'B2', echo: ['## Notes'], content: '## Overview' },
			{ keep: 'B3-B5' },
		]));

		assert.strictEqual(it.store.openChanges().length, 0, 'an ambiguous list must not queue anything');
		assert.deepStrictEqual(it.recorded, [], 'the store must not even be asked to record an ambiguous list');
		assert.ok(errors[0].startsWith('invalid_segments:'), errors[0]);
		assert.ok(errors[0].includes('word for word the same'), errors[0]);
		assert.strictEqual(receipts.invalidSegmentLists, 1);
		assert.deepStrictEqual(receipts.segmentReceipts, []);
	});

	test('a document dialled "never change" refuses the whole call, by name, per segment', async () => {
		const it = await stage();
		it.project.locked.add(PRICING);
		const { errors, receipts, ledger } = await run(it, readThenPropose(GOOD_SEGMENTS));

		assert.strictEqual(it.store.openChanges().length, 0);
		assert.deepStrictEqual(it.recorded, []);
		assert.ok(errors[0].includes('set never to change'), errors[0]);
		assert.deepStrictEqual(receipts.segmentReceipts.map(p => [p.label, p.reason]), [['B3', 'policy'], ['B4', 'policy']]);
		assert.ok(ledger.includes('2 were not made: 2 because the document is set never to change'));
	});

	test('a document the person did not attach is out of scope, and the refusal is typed', async () => {
		const it = await stage();
		it.project.raw.set('file:///ws/other.md', '---\ntitle: Other\n---\n\n# Other\n\nSome prose.\n');
		const { errors, receipts, ledger } = await run(it, [
			toolTurn(call('c1', AGENT_PROPOSE_SEGMENTS_TOOL, {
				docId: 'file:///ws/other.md',
				segments: [{ replace: 'B1', echo: ['# Other'], content: '# Elsewhere' }, { keep: 'B2' }],
			})),
			toolTurn(call('c2', 'finish', { summary: 'I could not change that one.' })),
		]);

		assert.strictEqual(it.store.openChanges().length, 0);
		assert.ok(errors[0].startsWith('out_of_scope:'), errors[0]);
		assert.deepStrictEqual(receipts.segmentReceipts.map(p => p.reason), ['out-of-scope']);
		assert.ok(ledger.includes('not one of the ones you attached'));
	});

	test('a hunk that would dissolve a live figure is dropped by name while its siblings still queue', async () => {
		const it = await stage();
		it.project.raw.set(PRICING, [
			'---', 'title: Pricing', '---', '',
			'# Pricing', '',
			'We closed at [$4.2M](bind:revenue) last year.', '',
			'Billing runs on the first of the month.', ''
		].join('\n'));
		it.project.resolved.set('revenue', '$4.2M');

		const { results, receipts, ledger } = await run(it, readThenPropose([
			{ keep: 'B1' },
			// The model read the RESOLVED text, so its rewrite carries no bind markup and the link would die.
			{ replace: 'B2', echo: ['We closed at $4.2M'], content: 'We closed at 4.2 million last year.' },
			{ replace: 'B3', echo: ['Billing runs'], content: 'Billing runs on the first working day.' },
		]));

		assert.strictEqual(it.store.openChanges().length, 1);
		assert.deepStrictEqual(it.recorded, [['B3']], 'only the surviving hunk may reach the store');
		assert.deepStrictEqual(receipts.segmentReceipts.map(p => [p.label, p.reason ?? 'queued']), [['B2', 'bind-guard'], ['B3', 'queued']]);
		const proposeResult = results.find(event => event.name === AGENT_PROPOSE_SEGMENTS_TOOL)!;
		assert.ok(proposeResult.content.includes('segment 2 (B2): dropped (bind-guard)'), proposeResult.content);
		assert.ok(ledger.includes('replaced a live figure with plain text'));
	});

	test('a replacement that changes nothing is a no-op receipt, never a card in the rail', async () => {
		const it = await stage();
		const { receipts } = await run(it, readThenPropose([
			{ keep: 'B1-B2' },
			{ replace: 'B3', echo: ['## Notes'], content: '## Notes' },
			{ keep: 'B4-B5' },
		]));
		assert.strictEqual(it.store.openChanges().length, 0);
		assert.deepStrictEqual(receipts.segmentReceipts.map(p => p.reason), ['no-op']);
	});

	test('a label naming a block the document does not have is a stale ordinal, and nothing is written', async () => {
		const it = await stage();
		const { errors } = await run(it, readThenPropose([{ keep: 'B1-B5' }, { insertAfter: 'B9', content: 'Extra.' }]));
		assert.strictEqual(it.store.openChanges().length, 0);
		assert.ok(errors[0].includes('names a block this document does not have'), errors[0]);
	});

	// --- the surface itself ------------------------------------------------------------------------------

	test('the editing surface adds exactly ONE mutating verb, and no more', () => {
		const names = AGENT_EDITING_TOOL_DEFINITIONS.map(tool => tool.name);
		assert.deepStrictEqual(names, ['list_documents', 'read_document', 'read_source', 'plan_scope', 'propose_segments', 'finish']);
		// The later tranches are absent, so the model cannot half-use a verb it was never told about.
		assert.ok(!names.includes('rewrite_documents'));
		assert.ok(!names.includes('search_documents'));
		// And the read-only surface stays exactly what issue #380 shipped.
		assert.ok(!AGENT_READ_ONLY_TOOL_DEFINITIONS.some(tool => tool.name === AGENT_PROPOSE_SEGMENTS_TOOL));
	});

	test('a host with nowhere to write gets the read-only surface rather than a verb that can only fail', async () => {
		const it = await stage();
		const readOnly = createEditingAgentTools({
			host: { listDocuments: it.host.listDocuments, readDocument: it.host.readDocument, readSource: it.host.readSource },
			scope: SCOPE,
		});
		assert.ok(!readOnly.registry.executors.has(AGENT_PROPOSE_SEGMENTS_TOOL));
		assert.ok(readOnly.systemPrompt.includes('This run is READ-ONLY'));
	});

	test('the editing prompt tells the model a change is proposed, never applied', () => {
		const surface = createEditingAgentTools({ host: { listDocuments: async () => [], readDocument: async () => undefined, readSource: async () => undefined, editTarget: async () => undefined, recordSegmentChanges: async () => undefined }, scope: SCOPE });
		assert.ok(surface.systemPrompt.includes('is NOT applied'));
		assert.ok(surface.systemPrompt.includes('Never say you have changed'));
	});

	test('the steps feed reads as work, not as a tool name', () => {
		assert.strictEqual(
			agentStepLabel(AGENT_PROPOSE_SEGMENTS_TOOL, { docId: PRICING }, () => 'Pricing'),
			'Proposed changes to Pricing'
		);
	});

	// --- the honest terminal (do not make issue #415 worse) ----------------------------------------------

	test('a run that queued changes and then failed does NOT report that nothing was changed', async () => {
		const it = await stage();
		const surface = createEditingAgentTools({ host: it.host, scope: SCOPE });
		// One propose, then a turn with no tool call at all: the run ends `stoppedWithoutFinish` over two
		// cards that are really sitting in the rail.
		const result = await runAgentLoop({
			task: composeAgentTask('Rename the Notes heading.', SCOPE),
			system: surface.systemPrompt,
			client: new ScriptedClient([
				toolTurn(call('c1', AGENT_PROPOSE_SEGMENTS_TOOL, { docId: PRICING, segments: GOOD_SEGMENTS })),
				{ content: [text('All done.')], stopReason: 'end_turn' },
			]),
			registry: surface.registry,
		});

		assert.strictEqual(result.outcome.type, 'failed');
		const receipts = surface.receipts();
		const queued = receipts.segmentReceipts.filter(receipt => receipt.changeId !== undefined).length;
		assert.strictEqual(queued, 2);
		const said = describeAgentRunFailure('stoppedWithoutFinish', 20, { changesQueued: queued });
		assert.ok(!said.includes('Nothing was changed'), said);
		assert.ok(said.includes('2 changes did reach your review queue'), said);
		// The read-only default is unchanged: a run with nothing queued still says so.
		assert.ok(describeAgentRunFailure('stoppedWithoutFinish', 20).includes('Nothing was changed'));
	});
});
