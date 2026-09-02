/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import type Anthropic from '@anthropic-ai/sdk';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { AGENT_FINISH_TOOL, AgentAssistantBlock, AgentFailureReason, AgentLoopEvent, IAgentModelClient, IAgentModelRequest, IAgentModelResponse, IAgentToolErrorEvent, IAgentToolResultEvent, runAgentLoop } from '../../common/livingDocsAgentLoop.js';
import {
	AGENT_LIST_DOCUMENTS_TOOL, AGENT_PLAN_SCOPE_TOOL, AGENT_READ_DOCUMENT_TOOL, AGENT_READ_ONLY_SYSTEM_PROMPT,
	AGENT_READ_ONLY_TOOL_DEFINITIONS, AGENT_READ_SOURCE_TOOL, AGENT_SCOPE_LOCKED_ERROR, agentStepLabel, blockLabel,
	chooseChatRoute, composeAgentReadLedger, composeAgentTask, createReadOnlyAgentTools, describeAgentRunFailure,
	IAgentBlock, IAgentDocumentRead, IAgentDocumentRow, IAgentScopeDoc, IAgentToolHost, serialiseBlocks, sliceHeadingSection
} from '../../common/livingDocsAgentTools.js';

// The read-only tool surface and the branch point (issue #380; doc 30 section 2.4 and section 7 stage 3).
//
// Everything here is driven at the S2 seam - the injected model client and tool registry - by a SCRIPTED
// fake client and a scripted host. No network, no service, no DOM, no clock. That is the point of the seam:
// a full multi-step conversation, its recoveries and its honest terminals are all provable at unit speed,
// and the tests below assert the whole append-only event trace, because the trace is the contract.

type TextBlockParam = Anthropic.Messages.TextBlockParam;
type ToolUseBlockParam = Anthropic.Messages.ToolUseBlockParam;

suite('livingDocs read-only agent tools (issue #380, doc 30 2.4)', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	function text(value: string): TextBlockParam {
		return { type: 'text', text: value };
	}

	function call(id: string, name: string, input: unknown): ToolUseBlockParam {
		return { type: 'tool_use', id, name, input };
	}

	/** A turn that asks for tools: the broker closes exactly this shape with `stop_reason: "tool_use"`. */
	function toolTurn(...content: readonly AgentAssistantBlock[]): IAgentModelResponse {
		return { content, stopReason: 'tool_use' };
	}

	/**
	 * The scripted fake model client: answers `send` from a fixed script, in order, and records what it was
	 * asked. It NEVER opens a socket, so a unit run cannot be silently answered by a live broker on 8090.
	 */
	class ScriptedClient implements IAgentModelClient {
		readonly requests: IAgentModelRequest[] = [];
		/**
		 * How long the conversation was AT EACH SEND. Recorded rather than read back off `requests`, because
		 * the kernel hands its live append-only array to every step - so all the recorded requests alias one
		 * list, and a length read afterwards would only ever report the final one.
		 */
		readonly historyLengths: number[] = [];
		private index = 0;
		constructor(private readonly script: readonly (IAgentModelResponse | Error)[]) { }
		async send(request: IAgentModelRequest): Promise<IAgentModelResponse> {
			this.requests.push(request);
			this.historyLengths.push(request.messages.length);
			const next = this.script[this.index++];
			if (!next) { throw new Error(`the loop took step ${this.index}, past the end of the script`); }
			if (next instanceof Error) { throw next; }
			return next;
		}
	}

	function headingBlock(value: string, level: number): IAgentBlock {
		return { type: 'heading', text: value, level };
	}

	function para(value: string): IAgentBlock {
		return { type: 'paragraph', text: value };
	}

	const PRICING: IAgentDocumentRead = {
		docId: 'file:///p/pricing.md',
		title: 'Pricing',
		blocks: [
			headingBlock('Pricing', 1),
			para('We charge $10 per seat per month.'),
			headingBlock('Enterprise', 2),
			para('Enterprise starts at $2,000 a year.'),
		]
	};

	const PLANS: IAgentDocumentRead = {
		docId: 'file:///p/plans.md',
		title: 'Plans',
		blocks: [
			headingBlock('Plans', 1),
			para('Three plans:\n- Starter\n- Team\n- Enterprise'),
		]
	};

	const OLD_FAQ: IAgentDocumentRead = {
		docId: 'file:///p/old-faq.md',
		title: 'Old pricing FAQ',
		blocks: [headingBlock('Old pricing FAQ', 1), para('We used to charge $8 per seat.')]
	};

	function row(doc: IAgentDocumentRead, extra?: Partial<IAgentDocumentRow>): IAgentDocumentRow {
		return {
			docId: doc.docId, title: doc.title, status: '', policy: 'ask-first', approxTokens: 120,
			headings: doc.blocks.filter(block => block.type === 'heading').map(block => block.text),
			...extra
		};
	}

	/** A scripted host: a fixed catalogue, fixed bodies, fixed sources. Nothing is read from disk. */
	function host(overrides?: Partial<IAgentToolHost>): IAgentToolHost {
		const docs = [PRICING, PLANS, OLD_FAQ];
		return {
			listDocuments: async () => docs.map(doc => row(doc)),
			readDocument: async docId => docs.find(doc => doc.docId === docId),
			readSource: async name => name === 'metrics.csv' ? 'seats,revenue\n120,1200' : undefined,
			...overrides
		};
	}

	const SCOPE: readonly IAgentScopeDoc[] = [
		{ docId: PRICING.docId, title: PRICING.title },
		{ docId: PLANS.docId, title: PLANS.title },
	];

	function tools(options?: { readonly host?: IAgentToolHost; readonly scope?: readonly IAgentScopeDoc[] }) {
		return createReadOnlyAgentTools({ host: options?.host ?? host(), scope: options?.scope ?? SCOPE });
	}

	async function run(script: readonly (IAgentModelResponse | Error)[], surface: ReturnType<typeof tools>, maxSteps?: number) {
		const client = new ScriptedClient(script);
		const observed: AgentLoopEvent[] = [];
		const result = await runAgentLoop({
			task: composeAgentTask('What do we charge, and does Plans agree with it?', SCOPE),
			system: AGENT_READ_ONLY_SYSTEM_PROMPT,
			client,
			registry: surface.registry,
			maxSteps,
			onEvent: event => observed.push(event)
		});
		assert.deepStrictEqual(observed, result.events, 'onEvent and result.events carry the same trace');
		return { result, client };
	}

	/** The event trace as compact strings, so a whole conversation reads as one assertion. */
	function trace(events: readonly AgentLoopEvent[]): string[] {
		return events.map(event => {
			switch (event.type) {
				case 'stepStarted': return `step ${event.step}`;
				case 'modelText': return `text: ${event.text}`;
				case 'toolCall': return `call ${event.name}`;
				case 'toolResult': return `result ${event.name}`;
				case 'toolError': return `toolError ${event.name} ${event.reason}`;
				case 'streamError': return `streamError ${event.errorType}`;
				case 'finished': return `finished: ${event.summary}`;
				case 'failed': return `failed ${event.reason}`;
			}
		});
	}

	function toolErrorAt(events: readonly AgentLoopEvent[], step: number): IAgentToolErrorEvent {
		const found = events.find((event): event is IAgentToolErrorEvent => event.type === 'toolError' && event.step === step);
		assert.ok(found, `expected a tool refusal at step ${step}`);
		return found;
	}

	function toolResultAt(events: readonly AgentLoopEvent[], step: number): IAgentToolResultEvent {
		const found = events.find((event): event is IAgentToolResultEvent => event.type === 'toolResult' && event.step === step);
		assert.ok(found, `expected a tool result at step ${step}`);
		return found;
	}

	// --- the surface itself ---

	test('the surface is the non-mutating subset, with the mandatory terminal and no mutating verb', () => {
		const names = AGENT_READ_ONLY_TOOL_DEFINITIONS.map(tool => tool.name);
		assert.deepStrictEqual(names, [
			AGENT_LIST_DOCUMENTS_TOOL, AGENT_READ_DOCUMENT_TOOL, AGENT_READ_SOURCE_TOOL, AGENT_PLAN_SCOPE_TOOL, AGENT_FINISH_TOOL
		]);
		// The verbs this slice deliberately does not ship: mutation belongs to a later tranche, retrieval to
		// stage 4. A verb the model is never told about is a verb it cannot half-use.
		for (const absent of ['propose_segments', 'rewrite_documents', 'search_documents']) {
			assert.ok(!names.includes(absent), `${absent} must not be in a read-only run`);
		}
	});

	test('blocks serialise with document-global ordinal labels, one label per block', () => {
		assert.strictEqual(blockLabel(0), 'B1');
		assert.strictEqual(serialiseBlocks(PRICING.blocks), [
			'B1  # Pricing',
			'B2  We charge $10 per seat per month.',
			'B3  ## Enterprise',
			'B4  Enterprise starts at $2,000 a year.',
		].join('\n'));
		// A block whose text wraps stays ONE label, with its continuation indented under it (doc 30 D1).
		assert.strictEqual(serialiseBlocks(PLANS.blocks), [
			'B1  # Plans',
			'B2  Three plans:',
			'    - Starter',
			'    - Team',
			'    - Enterprise',
		].join('\n'));
	});

	test('a heading section keeps the labels the whole document gave it', () => {
		const section = sliceHeadingSection(PRICING.blocks, 'Enterprise');
		assert.ok(section);
		assert.strictEqual(section.startIndex, 2);
		assert.strictEqual(serialiseBlocks(section.blocks, section.startIndex), [
			'B3  ## Enterprise',
			'B4  Enterprise starts at $2,000 a year.',
		].join('\n'));
		assert.strictEqual(sliceHeadingSection(PRICING.blocks, 'Nowhere'), undefined);
	});

	// --- the full conversation ---

	test('a scripted client drives a full multi-step run to finish, through a tool error and a schema violation', async () => {
		const surface = tools();
		const { result, client } = await run([
			// Step 1: narrate, and record the pre-filled scope. Gate-free, because scope was explicit.
			toolTurn(text('Let me look at both.'), call('t1', AGENT_PLAN_SCOPE_TOOL, { docIds: [PRICING.docId, PLANS.docId], rationale: 'Both were attached.' })),
			// Step 2: a SCHEMA VIOLATION - `docIds` is the contract, `docs` is not. The tool refuses in words
			// and the conversation continues; a malformed call is a recovery, not a terminal.
			toolTurn(call('t2', AGENT_PLAN_SCOPE_TOOL, { docs: [PRICING.docId] })),
			// Step 3: a TOOL ERROR - a docId that names nothing. Again answered, again survivable.
			toolTurn(call('t3', AGENT_READ_DOCUMENT_TOOL, { docId: 'file:///p/ghost.md' })),
			// Step 4: two real reads in one turn (Anthropic parallel tool use: many calls, one reply).
			toolTurn(
				call('t4', AGENT_READ_DOCUMENT_TOOL, { docId: PRICING.docId }),
				call('t5', AGENT_READ_DOCUMENT_TOOL, { docId: PLANS.docId })
			),
			// Step 5: a source read.
			toolTurn(call('t6', AGENT_READ_SOURCE_TOOL, { name: 'metrics.csv' })),
			// Step 6: the mandatory terminal, alone in its turn.
			toolTurn(call('t7', AGENT_FINISH_TOOL, { summary: 'Pricing says $10 per seat; Plans lists the same three tiers and does not contradict it.' })),
		], surface);

		assert.deepStrictEqual(trace(result.events), [
			'step 1', 'text: Let me look at both.', 'call plan_scope', 'result plan_scope',
			'step 2', 'call plan_scope', 'toolError plan_scope executorFailed',
			'step 3', 'call read_document', 'toolError read_document executorFailed',
			'step 4', 'call read_document', 'result read_document', 'call read_document', 'result read_document',
			'step 5', 'call read_source', 'result read_source',
			'step 6', 'call finish',
			'finished: Pricing says $10 per seat; Plans lists the same three tiers and does not contradict it.',
		]);
		assert.strictEqual(result.steps, 6);
		assert.strictEqual(result.outcome.type, 'finished');

		// The refusals reached the MODEL, in words it can act on - not just the event trace.
		assert.ok(toolErrorAt(result.events, 2).message.includes('docIds'));
		assert.ok(toolErrorAt(result.events, 3).message.includes('ghost.md'));

		// The stable prefix is stable: the same system prompt and the same tool surface on every step, which
		// is the only thing a prompt cache can hold onto (doc 30 section 2.6).
		assert.strictEqual(client.requests.length, 6);
		for (const request of client.requests) {
			assert.strictEqual(request.system, AGENT_READ_ONLY_SYSTEM_PROMPT);
			assert.deepStrictEqual(request.tools.map(tool => tool.name), AGENT_READ_ONLY_TOOL_DEFINITIONS.map(tool => tool.name));
		}
		// History is append-only and never rewritten: every step sees strictly more than the one before it -
		// the task, then an assistant turn and its answers per step.
		assert.deepStrictEqual(client.historyLengths, [1, 3, 5, 7, 9, 11]);

		// The host composed the ledger; the model only narrated. Every read is named with its real count.
		const receipts = surface.receipts();
		assert.deepStrictEqual(receipts.declared, [PRICING.docId, PLANS.docId]);
		assert.strictEqual(receipts.rationale, 'Both were attached.');
		assert.strictEqual(
			composeAgentReadLedger(receipts),
			'Read 2 of the 2 attached documents: Pricing (4 blocks), Plans (2 blocks). Read 1 source: metrics.csv. Nothing was changed - this run could only read.'
		);
	});

	test('the first user turn pre-fills the explicit scope, so the model never guesses at it', () => {
		const task = composeAgentTask('What do we charge?', SCOPE);
		assert.ok(task.includes(PRICING.docId) && task.includes(PLANS.docId));
		assert.ok(task.includes('What do we charge?'));
	});

	// --- scope, fails-closed ---

	test('plan_scope may narrow, and a widening past the explicit signal is a typed scope_locked error', async () => {
		const surface = tools();
		const { result } = await run([
			toolTurn(call('t1', AGENT_PLAN_SCOPE_TOOL, { docIds: [PRICING.docId], rationale: 'Only pricing matters here.' })),
			toolTurn(call('t2', AGENT_PLAN_SCOPE_TOOL, { docIds: [PRICING.docId, OLD_FAQ.docId] })),
			toolTurn(call('t3', AGENT_FINISH_TOOL, { summary: 'I could not widen the scope, so I stayed inside it.' })),
		], surface);

		const refusal = toolErrorAt(result.events, 2);
		assert.ok(refusal.message.startsWith(AGENT_SCOPE_LOCKED_ERROR), 'the error is typed, so the model can relay it in words');
		assert.ok(refusal.message.includes(OLD_FAQ.docId), 'the refusal names what it refused');

		// Fails closed: the refused call left the narrowed declaration exactly as it was.
		const receipts = surface.receipts();
		assert.deepStrictEqual(receipts.declared, [PRICING.docId]);
		assert.strictEqual(receipts.scopeWidenRefused, true);
		assert.ok(composeAgentReadLedger(receipts).includes('The scope stayed as you attached it'));
	});

	test('a read outside the declared scope is PERMITTED and appears in the ledger (founder ruling 9.4)', async () => {
		const surface = tools();
		const { result } = await run([
			toolTurn(call('t1', AGENT_LIST_DOCUMENTS_TOOL, {})),
			toolTurn(call('t2', AGENT_READ_DOCUMENT_TOOL, { docId: PRICING.docId })),
			// Never attached, never in scope - and read anyway, on purpose.
			toolTurn(call('t3', AGENT_READ_DOCUMENT_TOOL, { docId: OLD_FAQ.docId })),
			toolTurn(call('t4', AGENT_FINISH_TOOL, { summary: 'The old FAQ still quotes the previous price.' })),
		], surface);

		assert.strictEqual(result.outcome.type, 'finished');
		assert.ok(toolResultAt(result.events, 3).content.includes('Old pricing FAQ'), 'the out-of-scope read succeeded - it is permitted, not blocked');
		assert.strictEqual(
			composeAgentReadLedger(surface.receipts()),
			'Read 1 of the 2 attached documents: Pricing (4 blocks). Also read 1 other project document for context: Old pricing FAQ (2 blocks). Did not open Plans. Nothing was changed - this run could only read.'
		);
	});

	test('the catalogue marks the attached documents and carries the policy, so a locked doc is visible', async () => {
		const surface = tools({ host: host({ listDocuments: async () => [row(PRICING, { policy: 'never', status: 'approved' }), row(PLANS)] }) });
		const { result } = await run([
			toolTurn(call('t1', AGENT_LIST_DOCUMENTS_TOOL, {})),
			toolTurn(call('t2', AGENT_FINISH_TOOL, { summary: 'Listed the project.' })),
		], surface);
		const listed = toolResultAt(result.events, 1).content;
		assert.ok(listed.includes('policy: never'));
		assert.ok(listed.includes('attached'));
	});

	// --- the terminal, and the bounds ---

	test('finish is refused while work is unsettled, and the run continues rather than quietly succeeding', async () => {
		// The probe names in-flight work the first time it is asked and nothing after that, so the SAME finish
		// call lands only once the host says the work has settled.
		let probes = 0;
		const surface = tools({ host: host({ unsettledWork: () => { probes++; return probes === 1 ? 'one document is still being read' : undefined; } }) });
		const { result } = await run([
			// Refused for the FIRST kind of unsettled work: siblings in the same turn whose results are unread.
			// The kernel does not even reach the probe here, which is why `probes` is still 0 after this step.
			toolTurn(
				call('t1', AGENT_READ_DOCUMENT_TOOL, { docId: PRICING.docId }),
				call('t2', AGENT_FINISH_TOOL, { summary: 'Done already.' })
			),
			// Refused for the SECOND kind: the host still names in-flight work.
			toolTurn(call('t3', AGENT_FINISH_TOOL, { summary: 'Done now.' })),
			// Settled, so the same call lands.
			toolTurn(call('t4', AGENT_FINISH_TOOL, { summary: 'Pricing reads $10 per seat.' })),
		], surface);

		assert.deepStrictEqual(trace(result.events).filter(line => line.startsWith('toolError') || line.startsWith('finished')), [
			'toolError finish finishUnsettled',
			'toolError finish finishUnsettled',
			'finished: Pricing reads $10 per seat.',
		]);
		assert.strictEqual(result.outcome.type, 'finished');
		assert.strictEqual(probes, 2, 'the probe is consulted once per finish that reached it, and never for a crowded turn');
		assert.ok(toolErrorAt(result.events, 2).message.includes('one document is still being read'));
	});

	test('finish without a usable summary is refused - the model narrates, or the run does not end', async () => {
		const surface = tools();
		const { result } = await run([
			toolTurn(call('t1', AGENT_FINISH_TOOL, { summary: '   ' })),
			toolTurn(call('t2', AGENT_FINISH_TOOL, { summary: 'Both documents agree on the price.' })),
		], surface);
		assert.deepStrictEqual(trace(result.events).filter(line => !line.startsWith('step')), [
			'call finish', 'toolError finish finishInvalid',
			'call finish', 'finished: Both documents agree on the price.',
		]);
	});

	test('the step ceiling ends the run HONESTLY, with a visible terminal and no finish', async () => {
		const surface = tools();
		const reading = toolTurn(call('loop', AGENT_READ_DOCUMENT_TOOL, { docId: PRICING.docId }));
		const { result } = await run([reading, reading, reading, reading], surface, 3);

		assert.strictEqual(result.steps, 3, 'the ceiling bound the run');
		const outcome = result.outcome;
		assert.ok(outcome.type === 'failed');
		assert.strictEqual(outcome.reason, 'stepCeiling');
		assert.ok(outcome.message.includes('3 steps'), 'the terminal names the ceiling it hit');
		// The terminal is the LAST event, so a steps feed rendering the trace cannot show a run that just stops.
		assert.strictEqual(trace(result.events).at(-1), 'failed stepCeiling');
		// And what it DID read is still ledgered: a bounded run is a partial run, never a lost one.
		assert.ok(composeAgentReadLedger(surface.receipts()).includes('Pricing'));
	});

	test('a turn that ends without calling finish is a named failure, however good the prose was', async () => {
		const surface = tools();
		const { result } = await run([{ content: [text('They both say $10.')], stopReason: 'end_turn' }], surface);
		const outcome = result.outcome;
		assert.ok(outcome.type === 'failed');
		assert.strictEqual(outcome.reason, 'stoppedWithoutFinish');
	});

	test('an executor that throws is contained as a refusal the model can act on, not an escaping rejection', async () => {
		const surface = tools({ host: host({ readDocument: async () => { throw new Error('the file went away'); } }) });
		const { result } = await run([
			toolTurn(call('t1', AGENT_READ_DOCUMENT_TOOL, { docId: PRICING.docId })),
			toolTurn(call('t2', AGENT_FINISH_TOOL, { summary: 'I could not open Pricing.' })),
		], surface);
		assert.strictEqual(toolErrorAt(result.events, 1).message, 'the file went away');
		assert.strictEqual(result.outcome.type, 'finished');
		// Nothing was read, and the ledger says exactly that rather than printing an empty success.
		assert.ok(composeAgentReadLedger(surface.receipts()).startsWith('I read nothing in this run.'));
	});

	test('a re-read is a count on one ledger line, never a second line claiming a second document', async () => {
		const surface = tools();
		await run([
			toolTurn(call('t1', AGENT_READ_DOCUMENT_TOOL, { docId: PRICING.docId })),
			toolTurn(call('t2', AGENT_READ_DOCUMENT_TOOL, { docId: PRICING.docId, heading: 'Enterprise' })),
			toolTurn(call('t3', AGENT_FINISH_TOOL, { summary: 'Read it twice.' })),
		], surface);
		const documents = surface.receipts().reads.filter(entry => entry.kind === 'document');
		assert.strictEqual(documents.length, 1);
		assert.strictEqual(documents[0].reads, 2);
		assert.strictEqual(documents[0].blocks, 6, '4 blocks whole, then 2 in the section');
	});

	// --- ranged source reads (issue #383; doc 30 2.4 "read_source(name, range?) - attached source text, ranged") ---

	const METRICS = ['month,seats,revenue', 'jan,100,1000', 'feb,110,1100', 'mar,120,1200', 'apr,130,1300'].join('\n');

	test('read_source reads a ranged slice and the whole source, and the ledger discloses each (issue #383)', async () => {
		const surface = tools({ host: host({ readSource: async name => name === 'metrics.csv' ? METRICS : undefined }) });
		const { result } = await run([
			// A ranged read: rows 2-3 only, so the model reads part of a large source rather than all of it.
			toolTurn(call('t1', AGENT_READ_SOURCE_TOOL, { name: 'metrics.csv', range: '2-3' })),
			// The same source, whole.
			toolTurn(call('t2', AGENT_READ_SOURCE_TOOL, { name: 'metrics.csv' })),
			toolTurn(call('t3', AGENT_FINISH_TOOL, { summary: 'January and February revenue were 1000 and 1100.' })),
		], surface);

		assert.strictEqual(result.outcome.type, 'finished');
		// The ranged read returned EXACTLY rows 2-3 (jan and feb) and says how far the source runs - never the
		// header row or the later months, so the model's answer is grounded in exactly what it asked for.
		assert.strictEqual(
			toolResultAt(result.events, 1).content,
			'Source metrics.csv, rows 2-3 of 5:\n"""jan,100,1000\nfeb,110,1100"""'
		);
		// The ledger discloses BOTH reads of the one source, in read order, on a single line: the ranged read
		// names its rows and the whole read is named as whole, so the person sees exactly what was looked at.
		assert.strictEqual(
			composeAgentReadLedger(surface.receipts()),
			'Read 1 source: metrics.csv (rows 2-3, whole). Did not open Pricing, Plans. Nothing was changed - this run could only read.'
		);
	});

	test('read_source refuses a malformed range, clamps an overshoot, and names a note in lines not rows (issue #383)', async () => {
		const NOTE = ['alpha', 'bravo', 'charlie'].join('\n');
		const surface = tools({ host: host({ readSource: async name => name === 'notes.txt' ? NOTE : undefined }) });
		const { result } = await run([
			// A malformed range is refused in words and the run continues - a bad argument is a recovery, and it
			// records nothing, so it never reaches the ledger.
			toolTurn(call('t1', AGENT_READ_SOURCE_TOOL, { name: 'notes.txt', range: 'the top bit' })),
			// A range that runs past the end clamps to the last line rather than erroring, and says how far it ran.
			toolTurn(call('t2', AGENT_READ_SOURCE_TOOL, { name: 'notes.txt', range: '2-99' })),
			toolTurn(call('t3', AGENT_FINISH_TOOL, { summary: 'Read the note from its second line on.' })),
		], surface);

		assert.strictEqual(toolErrorAt(result.events, 1).reason, 'executorFailed', 'a malformed range is a recoverable refusal');
		// The overshoot clamps to the last line, serves only the in-range lines, and says how far it ran (2-3 of 3).
		assert.strictEqual(
			toolResultAt(result.events, 2).content,
			'Source notes.txt, lines 2-3 of 3:\n"""bravo\ncharlie"""'
		);
		// A .txt note is disclosed in LINES, not rows - the unit matches what the source naturally is.
		assert.strictEqual(
			composeAgentReadLedger(surface.receipts()),
			'Read 1 source: notes.txt (lines 2-3). Did not open Pricing, Plans. Nothing was changed - this run could only read.'
		);
	});

	test('a run that ends without finish says so in words, naming the ceiling it hit', () => {
		// The step ceiling is the one bound a person actually meets, so it names the number AND what to do.
		const ceiling = describeAgentRunFailure('stepCeiling', 20);
		assert.ok(ceiling.includes('20 steps'));
		assert.ok(ceiling.includes('Nothing was changed'));
		// Every reason the kernel can name has words - a terminal with no sentence would be a silent stop.
		const reasons: AgentFailureReason[] = [
			'maxTokens', 'toolUseWithoutTools', 'duplicateToolUseIds', 'hostProbeFailed',
			'stoppedWithoutFinish', 'stepCeiling', 'streamError', 'clientError'
		];
		for (const reason of reasons) {
			const said = describeAgentRunFailure(reason, 20);
			assert.ok(said.trim().length > 0, `${reason} needs plain words`);
			assert.ok(said.includes('Nothing was changed'), `${reason} must say the run changed nothing`);
		}
	});

	test('the steps feed reads as work, never as tool names', () => {
		const titleOf = (docId: string) => SCOPE.find(doc => doc.docId === docId)?.title;
		assert.strictEqual(agentStepLabel(AGENT_LIST_DOCUMENTS_TOOL, {}, titleOf), 'Listed the project\'s documents');
		assert.strictEqual(agentStepLabel(AGENT_READ_DOCUMENT_TOOL, { docId: PRICING.docId }, titleOf), 'Read Pricing');
		assert.strictEqual(agentStepLabel(AGENT_READ_DOCUMENT_TOOL, { docId: PRICING.docId, heading: 'Enterprise' }, titleOf), 'Read Pricing, under Enterprise');
		// A document the run never attached still labels honestly - by its id, never by a guessed title.
		assert.strictEqual(agentStepLabel(AGENT_READ_DOCUMENT_TOOL, { docId: OLD_FAQ.docId }, titleOf), `Read ${OLD_FAQ.docId}`);
		assert.strictEqual(agentStepLabel(AGENT_READ_SOURCE_TOOL, { name: 'metrics.csv' }, titleOf), 'Read metrics.csv');
		// A ranged source read shows the range live, in the source's own unit (rows for a spreadsheet extract).
		assert.strictEqual(agentStepLabel(AGENT_READ_SOURCE_TOOL, { name: 'metrics.csv', range: '2-3' }, titleOf), 'Read metrics.csv, rows 2-3');
		// A malformed range never lands as a read, so the feed falls back to the plain label rather than echoing junk.
		assert.strictEqual(agentStepLabel(AGENT_READ_SOURCE_TOOL, { name: 'metrics.csv', range: 'nonsense' }, titleOf), 'Read metrics.csv');
		assert.strictEqual(agentStepLabel(AGENT_PLAN_SCOPE_TOOL, {}, titleOf), 'Recorded what this run is about');
	});

	// --- the branch point ---

	test('the branch point: chips present routes to the loop, everything else keeps the single-shot path', () => {
		assert.strictEqual(chooseChatRoute({ attachedCount: 2, loopEnabled: true }), 'loop');
		assert.strictEqual(chooseChatRoute({ attachedCount: 1, loopEnabled: true }), 'loop');
		// No explicit scope - the ask keeps the pipeline it has always taken. This is the no-regression rule.
		assert.strictEqual(chooseChatRoute({ attachedCount: 0, loopEnabled: true }), 'single-shot');
		// And the loop can be turned off wholesale, which restores the previous behaviour exactly.
		assert.strictEqual(chooseChatRoute({ attachedCount: 3, loopEnabled: false }), 'single-shot');
		assert.strictEqual(chooseChatRoute({ attachedCount: 0, loopEnabled: false }), 'single-shot');
	});
});
