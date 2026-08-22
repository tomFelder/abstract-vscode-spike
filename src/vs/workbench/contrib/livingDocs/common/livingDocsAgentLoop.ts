/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type Anthropic from '@anthropic-ai/sdk';

// The agent loop kernel (plan 55 work package B5; docs/30-editing-architecture.md D4 "the loop" and D5
// "no framework, and why"). This is a PURE Anthropic-Messages tool-use state machine: it drives a
// conversation - user task in, assistant turns out, tool calls executed and answered, terminal states
// named - and it knows nothing about VS Code, the workbench, the change store or the DOM. No service
// imports, no `Date.now`, no `Math.random`: the same scripted client and registry always produce the
// same event trace, so every rule below is provable at unit speed.
//
// Why hand-rolled rather than an SDK's tool runner (D5): the broker owns metering, the spend cap and the
// audit trail, and it implements a SUBSET of the Messages surface. Adopting a vendor client pressures the
// broker to fake the rest; adopting a provider-abstraction framework layers a second translation over the
// one this product already owns. What is left is a state machine small enough to read in one sitting, and
// this file is it. It joins the codebase's family of pure tested seams (`fanoutBudget.ts`,
// `fanoutOutcome.ts`, `changeStore.ts`).
//
// The wire it speaks is the broker's, pinned by plan 55 B2: an assistant turn carries text blocks and
// `tool_use` blocks, terminates with an Anthropic `stop_reason`, and may carry typed `error` events that
// the broker emitted mid-stream. See `livingDocSse.ts` for the event vocabulary the client adapter parses
// before it reaches this kernel.

type MessageParam = Anthropic.Messages.MessageParam;
type TextBlockParam = Anthropic.Messages.TextBlockParam;
type ToolUseBlockParam = Anthropic.Messages.ToolUseBlockParam;
type ToolResultBlockParam = Anthropic.Messages.ToolResultBlockParam;
type Tool = Anthropic.Messages.Tool;
type StopReason = Anthropic.Messages.StopReason;

/**
 * One block of an assistant turn as the loop consumes it. Only the two shapes the broker produces are
 * modelled: prose, and a request to call a tool. The `*Param` (request-side) types are used deliberately -
 * an assistant turn is appended verbatim to the append-only history that is sent back on the next step.
 */
export type AgentAssistantBlock = TextBlockParam | ToolUseBlockParam;

/** The mandatory terminal verb (doc 30 D4). The kernel owns its semantics; a registry entry is ignored. */
export const AGENT_FINISH_TOOL = 'finish';

/** The step ceiling when the caller does not set one (`livingDocs.agentMaxSteps`, doc 30 D4). */
export const AGENT_DEFAULT_MAX_STEPS = 20;

/**
 * The one broker error type that is RECOVERABLE inside the loop (issue #346): the model's tool arguments
 * did not parse, so the call cannot be executed, but the conversation can continue by telling the model so.
 * Every other error type the broker emits (`upstream_stream_error`, `proxy_error`, `door_unavailable`) names
 * a stream that failed, and the kernel surfaces it as a terminal failure rather than parsing a half body.
 */
export const AGENT_RECOVERABLE_STREAM_ERROR = 'invalid_tool_arguments';

/**
 * The canonical `finish` definition, exported so the model is TOLD about the mandatory terminal in the same
 * module that ENFORCES it. `runAgentLoop` appends it to the tools it sends whenever the registry does not
 * define a tool by that name, so a registry cannot accidentally ship a loop that can never end in success.
 */
export const AGENT_FINISH_TOOL_DEFINITION: Tool = {
	name: AGENT_FINISH_TOOL,
	description: 'End the run. Narrate in plain words what you did and what you did not do; the host composes the authoritative per-document ledger from its own receipts, so do not invent counts. Call this exactly once, and only after every tool result you still need has come back.',
	input_schema: {
		type: 'object',
		properties: {
			summary: { type: 'string', description: 'Plain-words narrative of the run for the person who asked.' },
			flags: { type: 'array', items: { type: 'string' }, description: 'Optional short markers for anything the person should look at.' }
		},
		required: ['summary']
	}
};

/** A typed `error` event the broker emitted while the turn streamed (`lwd-model-broker.js:635`, `:885`). */
export interface IAgentStreamError {
	/** The broker's error name: `invalid_tool_arguments`, `upstream_stream_error`, `proxy_error`, ... */
	readonly errorType: string;
	/** The broker's plain-words message, handed to the model or to the failure verbatim. */
	readonly message: string;
	/**
	 * The `tool_use` block this error belongs to, when the client could attribute it. The broker emits a
	 * malformed-arguments error immediately after that block's `content_block_stop`, so the SSE adapter
	 * knows which call it names. An UNATTRIBUTED error is never guessed at - it is terminal.
	 */
	readonly toolUseId?: string;
}

/** One Anthropic-Messages request, as the kernel builds it for every step. */
export interface IAgentModelRequest {
	/** The stable system prompt. Stable by contract: it is the prompt-cache prefix (doc 30 D7). */
	readonly system: string;
	/** The append-only conversation so far. Never edited; a correction is a new turn. */
	readonly messages: readonly MessageParam[];
	/** The tool definitions, stable across steps, with `finish` guaranteed present. */
	readonly tools: readonly Tool[];
}

/** One assistant turn, already assembled from the wire by the client adapter. */
export interface IAgentModelResponse {
	/** The turn's content blocks in wire order: text at index 0, `tool_use` blocks after it. */
	readonly content: readonly AgentAssistantBlock[];
	/**
	 * The turn's `stop_reason`. `null` is the honest value for a text-only turn on this broker, which emits
	 * no `message_delta` unless a tool call occurred. The broker's non-Anthropic `pause` stop reason (the
	 * D15 budget pause) is a RUN-level state owned by the caller above this kernel, not a loop state, so it
	 * is deliberately not representable here - a paused stream is never handed to `runAgentLoop`.
	 */
	readonly stopReason: StopReason | null;
	/** Typed `error` events seen while this turn streamed. The kernel surfaces every one, and swallows none. */
	readonly errors?: readonly IAgentStreamError[];
}

/** The model seam. One implementation talks to the broker; the tests script it turn by turn. */
export interface IAgentModelClient {
	/** Send one step. A rejection is a typed `clientError` failure, never a silently dropped step. */
	send(request: IAgentModelRequest): Promise<IAgentModelResponse>;
}

/** What a tool executor hands back: the `tool_result` content the model reads, and whether it failed. */
export interface IAgentToolResult {
	/** The text placed in the `tool_result` block. Receipts, not bodies (doc 30 D4). */
	readonly content: string;
	/** True when the tool ran and failed: the result is marked `is_error` and a `toolError` event is emitted. */
	readonly isError?: boolean;
}

/** Executes one tool call. Throwing is allowed: a throw becomes an `is_error` result, never a lost step. */
export type AgentToolExecutor = (input: unknown, call: ToolUseBlockParam) => Promise<IAgentToolResult>;

/** The tool surface handed to the kernel: what the model is told, and what actually runs. */
export interface IAgentToolRegistry {
	/** The definitions sent on every step. `finish` is appended by the kernel when it is missing. */
	readonly definitions: readonly Tool[];
	/** name -> executor. A name the model calls that is absent here is a typed `unknownTool` result. */
	readonly executors: ReadonlyMap<string, AgentToolExecutor>;
	/**
	 * Optional host probe for work an earlier tool DISPATCHED that has not settled yet - doc 30's
	 * `rewrite_documents` jobs stream into the store outside the loop. Returns a plain-words description
	 * while anything is in flight, `undefined` once everything has settled. `finish` is refused while it
	 * returns a description, so the run cannot be declared complete over unsettled work.
	 */
	readonly unsettledWork?: () => string | undefined;
}

/** Why a run ended without a `finish`. Every one is named; there is no silent stop. */
export type AgentFailureReason =
	/** `stop_reason: max_tokens` on a body-emitting call - a hard fail by invariant I7, never a partial. */
	| 'maxTokens'
	/** `stop_reason: tool_use` with zero `tool_use` blocks: malformed upstream, terminal, never re-looped. */
	| 'toolUseWithoutTools'
	/** The model ended its turn without calling `finish`. `finish` is structural, so this is a failure. */
	| 'stoppedWithoutFinish'
	/** The step ceiling was reached. Reaching the ceiling is a typed failure, never a silent stop. */
	| 'stepCeiling'
	/** A typed broker `error` event that names a broken stream. Retry policy belongs to the caller. */
	| 'streamError'
	/** The model client rejected. */
	| 'clientError';

/** Why one tool call could not produce a normal result. All of these CONTINUE the conversation. */
export type AgentToolFailureReason =
	/** The model called a name the registry does not have. */
	| 'unknownTool'
	/** The executor returned `isError`, or threw. */
	| 'executorFailed'
	/** The broker reported this call's arguments as unparseable, so it was never executed. */
	| 'invalidArguments'
	/** `finish` was called over unsettled work: other calls in the same turn, or in-flight host jobs. */
	| 'finishUnsettled'
	/** `finish` was called without a usable summary. */
	| 'finishInvalid';

export interface IAgentStepStartedEvent { readonly type: 'stepStarted'; readonly step: number }
export interface IAgentModelTextEvent { readonly type: 'modelText'; readonly step: number; readonly text: string }
export interface IAgentToolCallEvent { readonly type: 'toolCall'; readonly step: number; readonly callId: string; readonly name: string; readonly input: unknown }
export interface IAgentToolResultEvent { readonly type: 'toolResult'; readonly step: number; readonly callId: string; readonly name: string; readonly content: string }
export interface IAgentToolErrorEvent { readonly type: 'toolError'; readonly step: number; readonly callId: string; readonly name: string; readonly reason: AgentToolFailureReason; readonly message: string }
export interface IAgentStreamErrorEvent { readonly type: 'streamError'; readonly step: number; readonly errorType: string; readonly message: string; readonly toolUseId?: string }
export interface IAgentFinishedEvent { readonly type: 'finished'; readonly step: number; readonly summary: string; readonly flags: readonly string[] }
export interface IAgentFailedEvent { readonly type: 'failed'; readonly step: number; readonly reason: AgentFailureReason; readonly message: string }

/**
 * The steps-feed contract (doc 30 D4 "steering"): an append-only ledger of what the loop did. A correction
 * is a NEW event; an event is never edited once emitted, so the feed can be rendered incrementally and
 * replayed identically. Exactly one terminal event - `finished` or `failed` - ends every trace.
 */
export type AgentLoopEvent =
	| IAgentStepStartedEvent
	| IAgentModelTextEvent
	| IAgentToolCallEvent
	| IAgentToolResultEvent
	| IAgentToolErrorEvent
	| IAgentStreamErrorEvent
	| IAgentFinishedEvent
	| IAgentFailedEvent;

/** Everything one run produced. */
export interface IAgentLoopResult {
	/** The terminal event, repeated here so a caller never has to scan the trace to learn the outcome. */
	readonly outcome: IAgentFinishedEvent | IAgentFailedEvent;
	/** The full append-only event trace, in order, terminal event last. */
	readonly events: readonly AgentLoopEvent[];
	/** The append-only conversation as it stands at the end - the transcript, and the caching prefix. */
	readonly messages: readonly MessageParam[];
	/** How many model calls the run made. */
	readonly steps: number;
}

export interface IAgentLoopOptions {
	/** The user's task, the first turn of the conversation. */
	readonly task: string;
	/** The stable system prompt. */
	readonly system: string;
	readonly client: IAgentModelClient;
	readonly registry: IAgentToolRegistry;
	/** The step ceiling; defaults to {@link AGENT_DEFAULT_MAX_STEPS}. Floored at 1. */
	readonly maxSteps?: number;
	/** Called with every event as it is emitted, so the steps feed renders live rather than at the end. */
	readonly onEvent?: (event: AgentLoopEvent) => void;
}

const TRUNCATED = 'The model ran out of output tokens part-way through this turn, so nothing it produced can be trusted.';
const NO_TOOL_BLOCKS = 'The model said it was calling a tool but sent no tool call, so there is nothing to run.';
const FINISH_NEEDS_SUMMARY = 'finish needs a non-empty summary string. Call it again with a plain-words summary of what you did.';
const FINISH_OVER_TURN = 'finish cannot be called in the same turn as other tools - their results have not come back yet. Read the results first, then call finish on its own.';

function isToolUse(block: AgentAssistantBlock): block is ToolUseBlockParam {
	return block.type === 'tool_use';
}

function messageOf(err: unknown): string {
	return err instanceof Error ? err.message : String(err);
}

/** The tools sent on every step, with the mandatory terminal guaranteed present exactly once. */
function withFinishTool(definitions: readonly Tool[]): readonly Tool[] {
	return definitions.some(tool => tool.name === AGENT_FINISH_TOOL)
		? definitions
		: [...definitions, AGENT_FINISH_TOOL_DEFINITION];
}

/** Read a `finish` payload, or `undefined` when the model gave no usable summary. */
function readFinishInput(input: unknown): { readonly summary: string; readonly flags: readonly string[] } | undefined {
	if (!input || typeof input !== 'object') { return undefined; }
	const record = input as { summary?: unknown; flags?: unknown };
	if (typeof record.summary !== 'string' || !record.summary.trim()) { return undefined; }
	const flags = Array.isArray(record.flags) ? record.flags.filter((flag): flag is string => typeof flag === 'string') : [];
	return { summary: record.summary, flags };
}

function streamErrorEvent(step: number, error: IAgentStreamError): IAgentStreamErrorEvent {
	// Built branchwise rather than with an undefined-valued key so a snapshot assertion over the trace
	// compares the events a caller would actually see, not a shape with phantom keys.
	return error.toolUseId === undefined
		? { type: 'streamError', step, errorType: error.errorType, message: error.message }
		: { type: 'streamError', step, errorType: error.errorType, message: error.message, toolUseId: error.toolUseId };
}

/**
 * Drive one agent run to a named terminal state.
 *
 * The shape of a step: send the append-only history, read one assistant turn, surface its prose, surface any
 * typed stream error, then execute its `tool_use` blocks IN WIRE ORDER and answer all of them in ONE user
 * turn of `tool_result` blocks (Anthropic's parallel-tool-use semantics - many calls, one reply). Repeat
 * until the model calls `finish`, or until a rule below names a failure.
 *
 * The rules, all of which are failures rather than degradations:
 *
 *  - **`finish` is mandatory and structural.** A run cannot succeed without it. A turn that carries no tool
 *    call ends the run as `stoppedWithoutFinish`, however good the prose was.
 *  - **`finish` is refused over unsettled work.** Called alongside other tools in one turn, or while the
 *    registry's `unsettledWork` probe still names in-flight jobs, it returns an `is_error` result to the
 *    model and the conversation continues - the model is told, rather than the run quietly succeeding.
 *  - **`stop_reason: max_tokens` is a hard fail** (invariant I7): a truncated turn is never salvaged.
 *  - **`stop_reason: tool_use` with zero tool blocks is TERMINAL**, not a retry. A malformed upstream (the
 *    broker's translation produces exactly this when a door reports tool calls with an unusable array) must
 *    not be able to spin the loop.
 *  - **Typed broker `error` events are surfaced, never swallowed** (issue #346). A malformed-arguments error
 *    attributable to one call becomes that call's `is_error` result and the run continues; anything else,
 *    and anything unattributable, is a terminal `streamError`. Retry policy is the caller's, not the
 *    kernel's - the kernel reports, the service decides.
 *  - **The step ceiling is a typed failure**, never a silent stop. The per-document failure ceiling and the
 *    token budget are the host's bounds, not this kernel's; there is no wall clock anywhere.
 */
export async function runAgentLoop(options: IAgentLoopOptions): Promise<IAgentLoopResult> {
	const maxSteps = Math.max(1, options.maxSteps ?? AGENT_DEFAULT_MAX_STEPS);
	const tools = withFinishTool(options.registry.definitions);
	const events: AgentLoopEvent[] = [];
	const messages: MessageParam[] = [{ role: 'user', content: options.task }];
	let step = 0;

	function emit<T extends AgentLoopEvent>(event: T): T {
		events.push(event);
		options.onEvent?.(event);
		return event;
	}
	function done(outcome: IAgentFinishedEvent | IAgentFailedEvent): IAgentLoopResult {
		return { outcome, events, messages, steps: step };
	}

	while (step < maxSteps) {
		step++;
		emit({ type: 'stepStarted', step });

		let response: IAgentModelResponse;
		try {
			response = await options.client.send({ system: options.system, messages, tools });
		} catch (err) {
			return done(emit({ type: 'failed', step, reason: 'clientError', message: messageOf(err) }));
		}

		// Surface prose and collect the calls in one pass, so the event trace keeps the turn's wire order.
		const calls: ToolUseBlockParam[] = [];
		for (const block of response.content) {
			if (isToolUse(block)) {
				calls.push(block);
			} else if (block.text) {
				emit({ type: 'modelText', step, text: block.text });
			}
		}

		// Typed broker `error` events (#346), before anything is executed: a call the broker already told us
		// is unusable must never run with the empty input its translation substituted.
		const unusable = new Map<string, string>();
		for (const error of response.errors ?? []) {
			emit(streamErrorEvent(step, error));
			const call = error.toolUseId === undefined ? undefined : calls.find(candidate => candidate.id === error.toolUseId);
			if (error.errorType === AGENT_RECOVERABLE_STREAM_ERROR && call) {
				unusable.set(call.id, error.message);
				continue;
			}
			return done(emit({ type: 'failed', step, reason: 'streamError', message: error.message }));
		}

		// I7: truncation is a hard fail, checked before the tool blocks so a half-written call is never run.
		if (response.stopReason === 'max_tokens') {
			return done(emit({ type: 'failed', step, reason: 'maxTokens', message: TRUNCATED }));
		}
		if (!calls.length) {
			return response.stopReason === 'tool_use'
				? done(emit({ type: 'failed', step, reason: 'toolUseWithoutTools', message: NO_TOOL_BLOCKS }))
				: done(emit({ type: 'failed', step, reason: 'stoppedWithoutFinish', message: `The model ended its turn (${response.stopReason ?? 'no stop reason'}) without calling ${AGENT_FINISH_TOOL}.` }));
		}

		// The assistant turn is appended verbatim: history is append-only, and the turn must round-trip
		// exactly or the provider rejects the next request for unanswered tool calls.
		messages.push({ role: 'assistant', content: response.content.slice() });

		const results: ToolResultBlockParam[] = [];
		let finished: IAgentFinishedEvent | undefined;
		function refuse(call: ToolUseBlockParam, reason: AgentToolFailureReason, message: string): void {
			emit({ type: 'toolError', step, callId: call.id, name: call.name, reason, message });
			results.push({ type: 'tool_result', tool_use_id: call.id, content: message, is_error: true });
		}

		for (const call of calls) {
			emit({ type: 'toolCall', step, callId: call.id, name: call.name, input: call.input });

			const malformed = unusable.get(call.id);
			if (malformed !== undefined) {
				refuse(call, 'invalidArguments', malformed);
				continue;
			}

			if (call.name === AGENT_FINISH_TOOL) {
				// Unsettled work, both kinds: siblings in this very turn whose results the model has not read,
				// and host jobs an earlier tool dispatched that are still landing.
				const unsettled = calls.length > 1 ? FINISH_OVER_TURN : options.registry.unsettledWork?.();
				if (unsettled) {
					refuse(call, 'finishUnsettled', unsettled);
					continue;
				}
				const payload = readFinishInput(call.input);
				if (!payload) {
					refuse(call, 'finishInvalid', FINISH_NEEDS_SUMMARY);
					continue;
				}
				finished = { type: 'finished', step, summary: payload.summary, flags: payload.flags };
				continue;
			}

			const executor = options.registry.executors.get(call.name);
			if (!executor) {
				refuse(call, 'unknownTool', `There is no tool called ${call.name}. Use one of the tools you were given.`);
				continue;
			}
			let result: IAgentToolResult;
			try {
				result = await executor(call.input, call);
			} catch (err) {
				refuse(call, 'executorFailed', messageOf(err));
				continue;
			}
			if (result.isError) {
				refuse(call, 'executorFailed', result.content);
				continue;
			}
			emit({ type: 'toolResult', step, callId: call.id, name: call.name, content: result.content });
			results.push({ type: 'tool_result', tool_use_id: call.id, content: result.content });
		}

		// A successful `finish` is necessarily the only call in its turn, so there is nothing to answer.
		if (results.length) {
			messages.push({ role: 'user', content: results });
		}
		if (finished) {
			return done(emit(finished));
		}
	}

	return done(emit({ type: 'failed', step, reason: 'stepCeiling', message: `The run reached its ceiling of ${maxSteps} steps without calling ${AGENT_FINISH_TOOL}.` }));
}
