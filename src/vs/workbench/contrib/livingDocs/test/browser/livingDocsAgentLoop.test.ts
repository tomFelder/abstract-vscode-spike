/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import type Anthropic from '@anthropic-ai/sdk';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { AGENT_FINISH_TOOL, AgentAssistantBlock, AgentLoopEvent, AgentToolExecutor, IAgentModelClient, IAgentModelRequest, IAgentModelResponse, IAgentStreamError, IAgentToolRegistry, runAgentLoop } from '../../common/livingDocsAgentLoop.js';

// The loop kernel (plan 55 B5; doc 30 D4/D5). Every rule the kernel carries is proven here against a
// SCRIPTED client and scripted executors - no network, no service, no DOM - and asserted as a snapshot of
// the whole append-only event trace, because the trace IS the contract the steps feed renders. A rule that
// only half-fires shows up as a diff in the trace rather than as a passing narrow assertion.

type TextBlockParam = Anthropic.Messages.TextBlockParam;
type ToolUseBlockParam = Anthropic.Messages.ToolUseBlockParam;
type StopReason = Anthropic.Messages.StopReason;

suite('livingDocs agent loop kernel (plan 55 B5, doc 30 D4/D5)', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	function text(value: string): TextBlockParam {
		return { type: 'text', text: value };
	}

	function call(id: string, name: string, input: unknown): ToolUseBlockParam {
		return { type: 'tool_use', id, name, input };
	}

	function turn(content: readonly AgentAssistantBlock[], stopReason: StopReason | null, errors?: readonly IAgentStreamError[]): IAgentModelResponse {
		return errors ? { content, stopReason, errors } : { content, stopReason };
	}

	/** A turn that asks for tools: the broker closes exactly this shape with `stop_reason: "tool_use"`. */
	function toolTurn(...content: readonly AgentAssistantBlock[]): IAgentModelResponse {
		return turn(content, 'tool_use');
	}

	/** Answers `send` from a script, in order, and records what it was asked. */
	class ScriptedClient implements IAgentModelClient {
		readonly toolNames: string[][] = [];
		private index = 0;
		constructor(private readonly script: readonly (IAgentModelResponse | Error)[]) { }
		async send(request: IAgentModelRequest): Promise<IAgentModelResponse> {
			this.toolNames.push(request.tools.map(tool => tool.name));
			const next = this.script[this.index++];
			if (!next) { throw new Error(`the loop took step ${this.index}, past the end of the script`); }
			if (next instanceof Error) { throw next; }
			return next;
		}
	}

	function registry(executors: Record<string, AgentToolExecutor>, unsettledWork?: () => string | undefined): IAgentToolRegistry {
		return {
			definitions: Object.keys(executors).map(name => ({ name, description: name, input_schema: { type: 'object' as const } })),
			executors: new Map(Object.entries(executors)),
			unsettledWork
		};
	}

	/** An executor that always answers with the same receipt. */
	function says(content: string): AgentToolExecutor {
		return async () => ({ content });
	}

	async function run(script: readonly (IAgentModelResponse | Error)[], tools: IAgentToolRegistry, maxSteps?: number): Promise<{ events: readonly AgentLoopEvent[]; result: Awaited<ReturnType<typeof runAgentLoop>>; client: ScriptedClient }> {
		const client = new ScriptedClient(script);
		const observed: AgentLoopEvent[] = [];
		const result = await runAgentLoop({
			task: 'update the whole project for the new pricing',
			system: 'You edit living documents.',
			client,
			registry: tools,
			maxSteps,
			onEvent: event => observed.push(event)
		});
		// The live feed and the recorded trace are the same list: a caller that renders incrementally and a
		// caller that reads `result.events` at the end can never disagree.
		assert.deepStrictEqual(observed, result.events, 'onEvent and result.events carry the same trace');
		return { events: result.events, result, client };
	}

	test('a four-step conversation with parallel tool use lands on finish, and the history round-trips', async () => {
		const script = [
			toolTurn(text('Let me look at the project.'), call('tu1', 'list_documents', {})),
			toolTurn(call('tu2', 'read_document', { docId: 'a' }), call('tu3', 'search_documents', { query: 'pricing' })),
			toolTurn(call('tu4', 'propose_segments', { docId: 'a' })),
			toolTurn(call('tu5', AGENT_FINISH_TOOL, { summary: 'Updated the pricing in Access Control.', flags: ['check the pricing table in b'] }))
		];
		const { events, result } = await run(script, registry({
			list_documents: says('2 documents: a, b'),
			read_document: says('a: the old pricing is $10'),
			search_documents: says('hit: b'),
			propose_segments: says('queued(c1)')
		}));

		assert.deepStrictEqual(events, [
			{ type: 'stepStarted', step: 1 },
			{ type: 'modelText', step: 1, text: 'Let me look at the project.' },
			{ type: 'toolCall', step: 1, callId: 'tu1', name: 'list_documents', input: {} },
			{ type: 'toolResult', step: 1, callId: 'tu1', name: 'list_documents', content: '2 documents: a, b' },
			{ type: 'stepStarted', step: 2 },
			// The parallel turn: both calls run IN WIRE ORDER, and both are answered in one user turn below.
			{ type: 'toolCall', step: 2, callId: 'tu2', name: 'read_document', input: { docId: 'a' } },
			{ type: 'toolResult', step: 2, callId: 'tu2', name: 'read_document', content: 'a: the old pricing is $10' },
			{ type: 'toolCall', step: 2, callId: 'tu3', name: 'search_documents', input: { query: 'pricing' } },
			{ type: 'toolResult', step: 2, callId: 'tu3', name: 'search_documents', content: 'hit: b' },
			{ type: 'stepStarted', step: 3 },
			{ type: 'toolCall', step: 3, callId: 'tu4', name: 'propose_segments', input: { docId: 'a' } },
			{ type: 'toolResult', step: 3, callId: 'tu4', name: 'propose_segments', content: 'queued(c1)' },
			{ type: 'stepStarted', step: 4 },
			{ type: 'toolCall', step: 4, callId: 'tu5', name: AGENT_FINISH_TOOL, input: { summary: 'Updated the pricing in Access Control.', flags: ['check the pricing table in b'] } },
			{ type: 'finished', step: 4, summary: 'Updated the pricing in Access Control.', flags: ['check the pricing table in b'] }
		]);

		assert.deepStrictEqual(result.messages, [
			{ role: 'user', content: 'update the whole project for the new pricing' },
			{ role: 'assistant', content: [text('Let me look at the project.'), call('tu1', 'list_documents', {})] },
			{ role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tu1', content: '2 documents: a, b' }] },
			{ role: 'assistant', content: [call('tu2', 'read_document', { docId: 'a' }), call('tu3', 'search_documents', { query: 'pricing' })] },
			{
				role: 'user', content: [
					{ type: 'tool_result', tool_use_id: 'tu2', content: 'a: the old pricing is $10' },
					{ type: 'tool_result', tool_use_id: 'tu3', content: 'hit: b' }
				]
			},
			{ role: 'assistant', content: [call('tu4', 'propose_segments', { docId: 'a' })] },
			{ role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tu4', content: 'queued(c1)' }] },
			{ role: 'assistant', content: [call('tu5', AGENT_FINISH_TOOL, { summary: 'Updated the pricing in Access Control.', flags: ['check the pricing table in b'] })] }
		], 'the assistant turns round-trip verbatim and every tool call is answered exactly once');
	});

	test('the mandatory finish is added to the tool definitions when the registry omits it', async () => {
		const { client } = await run(
			[toolTurn(call('tu1', AGENT_FINISH_TOOL, { summary: 'Nothing needed changing.' }))],
			registry({ list_documents: says('none') })
		);
		assert.deepStrictEqual(client.toolNames, [['list_documents', AGENT_FINISH_TOOL]]);
	});

	test('tool failures - unknown name, a throw, a returned error - reach the model and the run continues', async () => {
		const script = [
			toolTurn(call('tu1', 'rename_heading', { docId: 'a' })),
			toolTurn(call('tu2', 'propose_segments', { docId: 'a' })),
			toolTurn(call('tu3', 'propose_segments', { docId: 'b' })),
			toolTurn(call('tu4', AGENT_FINISH_TOOL, { summary: 'One document changed; the other was locked.' }))
		];
		let attempt = 0;
		const { events, result } = await run(script, registry({
			propose_segments: async () => {
				attempt++;
				if (attempt === 1) { throw new Error('the change store was not reachable'); }
				return { content: 'dropped(policy): b is locked', isError: true };
			}
		}));

		assert.deepStrictEqual(events, [
			{ type: 'stepStarted', step: 1 },
			{ type: 'toolCall', step: 1, callId: 'tu1', name: 'rename_heading', input: { docId: 'a' } },
			{ type: 'toolError', step: 1, callId: 'tu1', name: 'rename_heading', reason: 'unknownTool', message: 'There is no tool called rename_heading. Use one of the tools you were given.' },
			{ type: 'stepStarted', step: 2 },
			{ type: 'toolCall', step: 2, callId: 'tu2', name: 'propose_segments', input: { docId: 'a' } },
			{ type: 'toolError', step: 2, callId: 'tu2', name: 'propose_segments', reason: 'executorFailed', message: 'the change store was not reachable' },
			{ type: 'stepStarted', step: 3 },
			{ type: 'toolCall', step: 3, callId: 'tu3', name: 'propose_segments', input: { docId: 'b' } },
			{ type: 'toolError', step: 3, callId: 'tu3', name: 'propose_segments', reason: 'executorFailed', message: 'dropped(policy): b is locked' },
			{ type: 'stepStarted', step: 4 },
			{ type: 'toolCall', step: 4, callId: 'tu4', name: AGENT_FINISH_TOOL, input: { summary: 'One document changed; the other was locked.' } },
			{ type: 'finished', step: 4, summary: 'One document changed; the other was locked.', flags: [] }
		]);
		// Every failure went back to the model as an `is_error` tool_result, so the model can react to it.
		assert.deepStrictEqual(result.messages[2], {
			role: 'user',
			content: [{ type: 'tool_result', tool_use_id: 'tu1', content: 'There is no tool called rename_heading. Use one of the tools you were given.', is_error: true }]
		});
	});

	test('the step ceiling is a typed failure, never a silent stop', async () => {
		const script = [
			toolTurn(call('tu1', 'read_document', { docId: 'a' })),
			toolTurn(call('tu2', 'read_document', { docId: 'b' })),
			toolTurn(call('tu3', 'read_document', { docId: 'c' }))
		];
		const { events } = await run(script, registry({ read_document: says('body') }), 2);

		assert.deepStrictEqual(events, [
			{ type: 'stepStarted', step: 1 },
			{ type: 'toolCall', step: 1, callId: 'tu1', name: 'read_document', input: { docId: 'a' } },
			{ type: 'toolResult', step: 1, callId: 'tu1', name: 'read_document', content: 'body' },
			{ type: 'stepStarted', step: 2 },
			{ type: 'toolCall', step: 2, callId: 'tu2', name: 'read_document', input: { docId: 'b' } },
			{ type: 'toolResult', step: 2, callId: 'tu2', name: 'read_document', content: 'body' },
			{ type: 'failed', step: 2, reason: 'stepCeiling', message: `The run reached its ceiling of 2 steps without calling ${AGENT_FINISH_TOOL}.` }
		]);
	});

	test('prose without finish is a failure, however good the prose was', async () => {
		const { events, result } = await run(
			[turn([text('I updated everything, all done.')], 'end_turn')],
			registry({ propose_segments: says('queued(c1)') })
		);
		assert.deepStrictEqual(events, [
			{ type: 'stepStarted', step: 1 },
			{ type: 'modelText', step: 1, text: 'I updated everything, all done.' },
			{ type: 'failed', step: 1, reason: 'stoppedWithoutFinish', message: `The model ended its turn (end_turn) without calling ${AGENT_FINISH_TOOL}.` }
		]);
		assert.strictEqual(result.outcome.type, 'failed');
	});

	test('stop_reason max_tokens is a hard fail (I7) and the truncated tool call is never executed', async () => {
		const { events } = await run(
			[turn([text('Rewriting'), call('tu1', 'propose_segments', { docId: 'a' })], 'max_tokens')],
			registry({ propose_segments: says('queued(c1)') })
		);
		assert.deepStrictEqual(events, [
			{ type: 'stepStarted', step: 1 },
			{ type: 'modelText', step: 1, text: 'Rewriting' },
			{ type: 'failed', step: 1, reason: 'maxTokens', message: 'The model ran out of output tokens part-way through this turn, so nothing it produced can be trusted.' }
		]);
	});

	test('stop_reason tool_use with zero tool blocks is terminal, so a malformed upstream cannot spin the loop', async () => {
		const { events } = await run(
			[turn([text('Calling a tool now.')], 'tool_use'), toolTurn(call('tu1', AGENT_FINISH_TOOL, { summary: 'never reached' }))],
			registry({ propose_segments: says('queued(c1)') })
		);
		assert.deepStrictEqual(events, [
			{ type: 'stepStarted', step: 1 },
			{ type: 'modelText', step: 1, text: 'Calling a tool now.' },
			{ type: 'failed', step: 1, reason: 'toolUseWithoutTools', message: 'The model said it was calling a tool but sent no tool call, so there is nothing to run.' }
		]);
	});

	test('a broken-stream error event ends the run rather than committing a half-read turn (#346)', async () => {
		const { events } = await run(
			[turn([text('The old price was ')], null, [{ errorType: 'upstream_stream_error', message: 'the model stream ended early' }])],
			registry({ propose_segments: says('queued(c1)') })
		);
		assert.deepStrictEqual(events, [
			{ type: 'stepStarted', step: 1 },
			{ type: 'modelText', step: 1, text: 'The old price was ' },
			{ type: 'streamError', step: 1, errorType: 'upstream_stream_error', message: 'the model stream ended early' },
			{ type: 'failed', step: 1, reason: 'streamError', message: 'the model stream ended early' }
		]);
	});

	test('a malformed-arguments error becomes that call\'s error result and the conversation continues (#346)', async () => {
		const malformed = 'the model returned malformed arguments for tool propose_segments: {"docId":';
		const script = [
			turn([call('tu1', 'propose_segments', {})], 'tool_use', [{ errorType: 'invalid_tool_arguments', message: malformed, toolUseId: 'tu1' }]),
			toolTurn(call('tu2', AGENT_FINISH_TOOL, { summary: 'I retried the call and it landed.' }))
		];
		const { events } = await run(script, registry({ propose_segments: says('queued(c1)') }));

		// No `toolResult` for tu1 anywhere in the trace: the executor was never run with the empty input the
		// broker's translation substituted for the unparseable arguments.
		assert.deepStrictEqual(events, [
			{ type: 'stepStarted', step: 1 },
			{ type: 'streamError', step: 1, errorType: 'invalid_tool_arguments', message: malformed, toolUseId: 'tu1' },
			{ type: 'toolCall', step: 1, callId: 'tu1', name: 'propose_segments', input: {} },
			{ type: 'toolError', step: 1, callId: 'tu1', name: 'propose_segments', reason: 'invalidArguments', message: malformed },
			{ type: 'stepStarted', step: 2 },
			{ type: 'toolCall', step: 2, callId: 'tu2', name: AGENT_FINISH_TOOL, input: { summary: 'I retried the call and it landed.' } },
			{ type: 'finished', step: 2, summary: 'I retried the call and it landed.', flags: [] }
		]);
	});

	test('an unattributable malformed-arguments error is terminal rather than guessed at', async () => {
		const { events } = await run(
			[turn([call('tu1', 'propose_segments', {})], 'tool_use', [{ errorType: 'invalid_tool_arguments', message: 'malformed arguments' }])],
			registry({ propose_segments: says('queued(c1)') })
		);
		assert.deepStrictEqual(events, [
			{ type: 'stepStarted', step: 1 },
			{ type: 'streamError', step: 1, errorType: 'invalid_tool_arguments', message: 'malformed arguments' },
			{ type: 'failed', step: 1, reason: 'streamError', message: 'malformed arguments' }
		]);
	});

	test('finish alongside other tools in one turn is refused - their results have not been read yet', async () => {
		const script = [
			toolTurn(call('tu1', 'propose_segments', { docId: 'a' }), call('tu2', AGENT_FINISH_TOOL, { summary: 'all done' })),
			toolTurn(call('tu3', AGENT_FINISH_TOOL, { summary: 'One change queued in Access Control.' }))
		];
		const { events } = await run(script, registry({ propose_segments: says('queued(c1)') }));

		assert.deepStrictEqual(events, [
			{ type: 'stepStarted', step: 1 },
			{ type: 'toolCall', step: 1, callId: 'tu1', name: 'propose_segments', input: { docId: 'a' } },
			{ type: 'toolResult', step: 1, callId: 'tu1', name: 'propose_segments', content: 'queued(c1)' },
			{ type: 'toolCall', step: 1, callId: 'tu2', name: AGENT_FINISH_TOOL, input: { summary: 'all done' } },
			{ type: 'toolError', step: 1, callId: 'tu2', name: AGENT_FINISH_TOOL, reason: 'finishUnsettled', message: 'finish cannot be called in the same turn as other tools - their results have not come back yet. Read the results first, then call finish on its own.' },
			{ type: 'stepStarted', step: 2 },
			{ type: 'toolCall', step: 2, callId: 'tu3', name: AGENT_FINISH_TOOL, input: { summary: 'One change queued in Access Control.' } },
			{ type: 'finished', step: 2, summary: 'One change queued in Access Control.', flags: [] }
		]);
	});

	test('finish is refused while the host still has dispatched work in flight, then accepted once it settles', async () => {
		let inFlight: string | undefined = 'still rewriting 2 documents';
		const script = [
			toolTurn(call('tu1', AGENT_FINISH_TOOL, { summary: 'all done' })),
			toolTurn(call('tu2', AGENT_FINISH_TOOL, { summary: 'Both documents were rewritten.' }))
		];
		const tools = registry({ rewrite_documents: says('dispatched') }, () => inFlight);
		const client = new ScriptedClient(script);
		const result = await runAgentLoop({
			task: 'rewrite everything',
			system: 'You edit living documents.',
			client,
			registry: tools,
			onEvent: event => { if (event.type === 'toolError') { inFlight = undefined; } }
		});

		assert.deepStrictEqual(result.events, [
			{ type: 'stepStarted', step: 1 },
			{ type: 'toolCall', step: 1, callId: 'tu1', name: AGENT_FINISH_TOOL, input: { summary: 'all done' } },
			{ type: 'toolError', step: 1, callId: 'tu1', name: AGENT_FINISH_TOOL, reason: 'finishUnsettled', message: 'still rewriting 2 documents' },
			{ type: 'stepStarted', step: 2 },
			{ type: 'toolCall', step: 2, callId: 'tu2', name: AGENT_FINISH_TOOL, input: { summary: 'Both documents were rewritten.' } },
			{ type: 'finished', step: 2, summary: 'Both documents were rewritten.', flags: [] }
		]);
	});

	test('finish without a usable summary is re-asked rather than accepted', async () => {
		const script = [
			toolTurn(call('tu1', AGENT_FINISH_TOOL, { flags: ['check b'] })),
			toolTurn(call('tu2', AGENT_FINISH_TOOL, { summary: '   ' })),
			toolTurn(call('tu3', AGENT_FINISH_TOOL, { summary: 'Nothing needed changing.', flags: [7, 'check b'] }))
		];
		const { events } = await run(script, registry({ propose_segments: says('queued(c1)') }));
		const reask = 'finish needs a non-empty summary string. Call it again with a plain-words summary of what you did.';

		assert.deepStrictEqual(events, [
			{ type: 'stepStarted', step: 1 },
			{ type: 'toolCall', step: 1, callId: 'tu1', name: AGENT_FINISH_TOOL, input: { flags: ['check b'] } },
			{ type: 'toolError', step: 1, callId: 'tu1', name: AGENT_FINISH_TOOL, reason: 'finishInvalid', message: reask },
			{ type: 'stepStarted', step: 2 },
			{ type: 'toolCall', step: 2, callId: 'tu2', name: AGENT_FINISH_TOOL, input: { summary: '   ' } },
			{ type: 'toolError', step: 2, callId: 'tu2', name: AGENT_FINISH_TOOL, reason: 'finishInvalid', message: reask },
			{ type: 'stepStarted', step: 3 },
			{ type: 'toolCall', step: 3, callId: 'tu3', name: AGENT_FINISH_TOOL, input: { summary: 'Nothing needed changing.', flags: [7, 'check b'] } },
			// Non-string flags are dropped rather than carried into the ledger as junk.
			{ type: 'finished', step: 3, summary: 'Nothing needed changing.', flags: ['check b'] }
		]);
	});

	test('a rejecting model client is a named failure, never a lost step', async () => {
		const { events } = await run([new Error('the model was not available')], registry({ propose_segments: says('queued(c1)') }));
		assert.deepStrictEqual(events, [
			{ type: 'stepStarted', step: 1 },
			{ type: 'failed', step: 1, reason: 'clientError', message: 'the model was not available' }
		]);
	});
});
