/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type Anthropic from '@anthropic-ai/sdk';
import { localize } from '../../../../nls.js';
import { AGENT_FINISH_TOOL_DEFINITION, AgentFailureReason, AgentToolExecutor, IAgentToolRegistry, IAgentToolResult } from './livingDocsAgentLoop.js';

// The READ-ONLY tool surface for stage 3's first tranche (issue #380; docs/30-editing-architecture.md
// section 2.4 "the eight-verb tool surface", section 4 "the UX specification"). Doc 30 names eight verbs;
// this module implements the NON-MUTATING subset - `list_documents`, `read_document`, `read_source`,
// `plan_scope` - and leans on the kernel for the mandatory terminal `finish`. `propose_segments`,
// `rewrite_documents` and `search_documents` are deliberately absent: mutation belongs to a later tranche
// and retrieval to stage 4, and a verb the model is never TOLD about is a verb it cannot half-use.
//
// Like the kernel beside it (`livingDocsAgentLoop.ts`) this file is PURE: no VS Code imports, no service,
// no DOM, no clock, no randomness. Everything the tools need from the running product arrives through
// {@link IAgentToolHost}, so the whole surface is drivable at unit speed by a scripted host and a scripted
// model client. That is the S2 seam, and it is the only seam this tranche adds.
//
// Three rules carry the trust wedge here, and each is enforced in code below rather than in the prompt:
//
//  1. **Ordinals, never quoted text.** `read_document` serialises a document as ordinal-labelled blocks
//     (`B1`, `B2`, ...), the same positional addressing doc 30 D1 chose for the edit wire. The model never
//     has to quote prose back to name a position, which is the whole #300/#303/#329 defect family.
//  2. **Scope is the attachments, and it cannot widen from inside the loop.** `plan_scope` arrives
//     PRE-FILLED with the explicit signal and is gate-free while the model stays inside it; a declaration
//     naming anything else returns a typed `scope_locked` error the model relays in words (doc 30 2.4).
//  3. **Every read is ledgered, in scope or out.** Reading other project documents for context is ALLOWED
//     (founder ruling 9.4) - and disclosed. The ledger is composed by the host from its own receipts, never
//     by the model, so `finish` narrates and the counts come from what actually happened.

type Tool = Anthropic.Messages.Tool;

/** The tool names this tranche ships. Exported so a caller can assert the surface it handed the model. */
export const AGENT_LIST_DOCUMENTS_TOOL = 'list_documents';
export const AGENT_READ_DOCUMENT_TOOL = 'read_document';
export const AGENT_READ_SOURCE_TOOL = 'read_source';
export const AGENT_PLAN_SCOPE_TOOL = 'plan_scope';

/** The typed error `plan_scope` returns when a declaration reaches past the explicit signal (doc 30 2.4). */
export const AGENT_SCOPE_LOCKED_ERROR = 'scope_locked';

/** One row of the document catalogue, as `list_documents` reports it (doc 30 2.4). */
export interface IAgentDocumentRow {
	/** The document's stable id. The host's own addressing; the model only ever echoes it back. */
	readonly docId: string;
	readonly title: string;
	/** The document's plain-language status, or '' when it never declared one. */
	readonly status: string;
	/** The per-document autonomy policy. A locked document is MARKED here; enforcement stays host-side. */
	readonly policy: string;
	/** A rough token size, so the model can budget what it reads rather than opening everything. */
	readonly approxTokens: number;
	/** The document's headings in document order, when the host can supply them cheaply. */
	readonly headings: readonly string[];
}

/** One block of a document, as the host hands it over for serialisation. */
export interface IAgentBlock {
	readonly type: string;
	readonly text: string;
	/** Heading level 1-6 on a `heading` block; absent on everything else. */
	readonly level?: number;
}

/** One document's body, as `read_document` receives it before the ordinals are applied. */
export interface IAgentDocumentRead {
	readonly docId: string;
	readonly title: string;
	readonly blocks: readonly IAgentBlock[];
}

/**
 * Everything the read-only tools need from the running product. A method that cannot answer returns
 * `undefined` rather than throwing; a throw is still contained (the kernel turns it into an `is_error`
 * result), but `undefined` is the shape that lets the tool word the failure for the model itself.
 */
export interface IAgentToolHost {
	/** Every document in the project, in the order the catalogue should read. */
	listDocuments(): Promise<readonly IAgentDocumentRow[]>;
	/** One document's blocks in document order, or `undefined` when the id names nothing. */
	readDocument(docId: string): Promise<IAgentDocumentRead | undefined>;
	/** One attached source's text, or `undefined` when the name is not a source of this project. */
	readSource(name: string): Promise<string | undefined>;
	/**
	 * Optional probe for work an earlier tool dispatched that has not settled. Nothing in THIS tranche
	 * dispatches anything, so it is normally absent; the port exists because `finish` must be refusable over
	 * unsettled work from the day mutation lands, and a seam added later is a seam nothing tested.
	 */
	readonly unsettledWork?: () => string | undefined;
}

/** One line of the host-composed ledger: what was read, how much of it, and whether it was in scope. */
export interface IAgentReadLedgerEntry {
	readonly kind: 'document' | 'source';
	/** The docId for a document, the file name for a source. */
	readonly id: string;
	readonly title: string;
	/** False for a document outside the declared scope - permitted, and named for exactly that reason. */
	readonly inScope: boolean;
	/** How many times the model read it. */
	readonly reads: number;
	/** Blocks served across those reads (0 for a source, which has no block structure). */
	readonly blocks: number;
}

/** The declared scope: the attachments, plus whatever narrowing `plan_scope` recorded. */
export interface IAgentScopeDoc {
	readonly docId: string;
	readonly title: string;
}

/** What one run's tools recorded, read by the host to compose the ledger the reply carries. */
export interface IAgentRunReceipts {
	/** The explicit scope the run started from - the attachment chips, in chip order. */
	readonly scope: readonly IAgentScopeDoc[];
	/** The docIds `plan_scope` last declared, or `undefined` when the model never called it. */
	readonly declared: readonly string[] | undefined;
	/** The rationale `plan_scope` last gave, or '' when it gave none. */
	readonly rationale: string;
	/** Every read, in first-read order. */
	readonly reads: readonly IAgentReadLedgerEntry[];
	/** True once a `plan_scope` call was refused for reaching past the explicit signal. */
	readonly scopeWidenRefused: boolean;
}

/** The read-only tool surface, plus the receipts the host composes its ledger from. */
export interface IAgentReadOnlyTools {
	readonly registry: IAgentToolRegistry;
	/** The receipts as they stand. Safe to read mid-run; the run's terminal reading is the ledger's input. */
	receipts(): IAgentRunReceipts;
}

/**
 * The stable system prompt for a read-only, explicit-scope run. Stable BY CONTRACT: it is the prompt-cache
 * prefix (doc 30 section 2.6), so it is a literal, identical on every turn of every conversation, and
 * nothing per-run is interpolated into it. The run's specifics travel in the first user turn instead.
 */
export const AGENT_READ_ONLY_SYSTEM_PROMPT = [
	'You are the agent inside Abstract, a document editor. The person has attached documents and asked you something about them.',
	'This run is READ-ONLY: you have no tool that changes a document, and you must not claim to have changed one. If the person asked for a change, read what you need, then say plainly in finish that this run could only read.',
	'Scope is exactly the documents the person attached. plan_scope is already filled in with them; call it only to narrow the set or to record your reading plan, and never to add a document - that returns a scope_locked error.',
	'You may read other project documents for context when it genuinely helps. Every read is disclosed to the person, so read deliberately rather than broadly.',
	'read_document returns the document as ordinal-labelled blocks (B1, B2, ...). Refer to a block by its label when you need to point at one; never quote prose to identify a position.',
	'Work in small steps: read what you need, then answer. When you are done you MUST call finish exactly once with a plain-words summary. The host composes the authoritative record of what you read, so do not invent counts or file lists in your summary.',
].join(' ');

/** The catalogue verb. Cheap, and the only way to learn a docId that was not attached. */
const LIST_DOCUMENTS_DEFINITION: Tool = {
	name: AGENT_LIST_DOCUMENTS_TOOL,
	description: 'List every document in this project: its docId, title, status, policy and rough size. Use it when you need a document that was not attached; the attached ones are already named in the task.',
	input_schema: { type: 'object', properties: {} }
};

const READ_DOCUMENT_DEFINITION: Tool = {
	name: AGENT_READ_DOCUMENT_TOOL,
	description: 'Read one document as ordinal-labelled blocks (B1, B2, ...). Pass a heading to read only the section under it; the labels stay the document\'s own, so B12 means the same block either way.',
	input_schema: {
		type: 'object',
		properties: {
			docId: { type: 'string', description: 'The document to read, exactly as it was given to you.' },
			heading: { type: 'string', description: 'Optional: read only the section under this heading.' }
		},
		required: ['docId']
	}
};

const READ_SOURCE_DEFINITION: Tool = {
	name: AGENT_READ_SOURCE_TOOL,
	description: 'Read an attached source file (a spreadsheet extract, a note, a PDF extraction) by name.',
	input_schema: {
		type: 'object',
		properties: {
			name: { type: 'string', description: 'The source file name as it appears on the document.' }
		},
		required: ['name']
	}
};

const PLAN_SCOPE_DEFINITION: Tool = {
	name: AGENT_PLAN_SCOPE_TOOL,
	description: 'Record which of the attached documents this run is about. It is already filled in with everything the person attached, so call it only to NARROW that set or to record your rationale. Naming a document the person did not attach returns a scope_locked error.',
	input_schema: {
		type: 'object',
		properties: {
			docIds: { type: 'array', items: { type: 'string' }, description: 'A subset of the attached documents.' },
			rationale: { type: 'string', description: 'One sentence on why this is the right set.' }
		},
		required: ['docIds']
	}
};

/**
 * The tool definitions this tranche sends, in the order the model reads them, with the kernel's mandatory
 * `finish` last. Exported so a caller (and the tests) can assert the surface WITHOUT running a loop - the
 * absence of `propose_segments`, `rewrite_documents` and `search_documents` is a contract of this slice.
 */
export const AGENT_READ_ONLY_TOOL_DEFINITIONS: readonly Tool[] = [
	LIST_DOCUMENTS_DEFINITION,
	READ_DOCUMENT_DEFINITION,
	READ_SOURCE_DEFINITION,
	PLAN_SCOPE_DEFINITION,
	AGENT_FINISH_TOOL_DEFINITION,
];

/** The ordinal label for the block at `index` (0-based), matching doc 30 D1's `B1-B7` span grammar. */
export function blockLabel(index: number): string {
	return `B${index + 1}`;
}

/**
 * Serialise blocks as ordinal-labelled lines. The label is the block's position in the WHOLE document, so a
 * section read and a full read agree on what `B12` means; a block whose text wraps over several lines has
 * its continuation lines indented under the label, so one label is always one block (doc 30 D1's wrap rule).
 */
export function serialiseBlocks(blocks: readonly IAgentBlock[], startIndex: number = 0): string {
	const lines: string[] = [];
	blocks.forEach((block, offset) => {
		const label = blockLabel(startIndex + offset);
		const pad = ' '.repeat(label.length + 2);
		const text = block.type === 'heading' ? `${'#'.repeat(block.level ?? 1)} ${block.text}` : block.text;
		const [first, ...rest] = text.split('\n');
		lines.push(`${label}  ${first}`);
		for (const line of rest) { lines.push(`${pad}${line}`); }
	});
	return lines.join('\n');
}

/**
 * The blocks under `heading`, with the index the first of them holds in the whole document. The section runs
 * from the matching heading to the next heading at the SAME level or shallower, which is how a reader would
 * scope it. An unmatched heading returns `undefined` so the tool can say so rather than serving the document
 * silently - a silent widening is exactly the class of failure doc 30 exists to kill.
 */
export function sliceHeadingSection(blocks: readonly IAgentBlock[], heading: string): { readonly blocks: readonly IAgentBlock[]; readonly startIndex: number } | undefined {
	const wanted = heading.trim().toLowerCase();
	const start = blocks.findIndex(block => block.type === 'heading' && block.text.trim().toLowerCase() === wanted);
	if (start < 0) { return undefined; }
	const level = blocks[start].level ?? 1;
	let end = blocks.length;
	for (let i = start + 1; i < blocks.length; i++) {
		const block = blocks[i];
		if (block.type === 'heading' && (block.level ?? 1) <= level) { end = i; break; }
	}
	return { blocks: blocks.slice(start, end), startIndex: start };
}

function errorResult(content: string): IAgentToolResult {
	return { content, isError: true };
}

function readString(input: unknown, key: string): string | undefined {
	if (!input || typeof input !== 'object') { return undefined; }
	const value = (input as Record<string, unknown>)[key];
	return typeof value === 'string' && value.trim() ? value : undefined;
}

/**
 * Build the read-only tool surface for one run over an EXPLICIT scope (the attachment chips).
 *
 * The returned registry is handed straight to `runAgentLoop`; the returned `receipts()` is what the host
 * composes its ledger from once the run terminates. The two are the same object's two faces on purpose: a
 * ledger built from anything other than the executors' own receipts would be a second count that can
 * disagree with the first, which is the defect family doc 30's invariant I3 names.
 */
export function createReadOnlyAgentTools(options: { readonly host: IAgentToolHost; readonly scope: readonly IAgentScopeDoc[] }): IAgentReadOnlyTools {
	const scope = options.scope;
	const inScope = new Set(scope.map(doc => doc.docId));
	const reads: IAgentReadLedgerEntry[] = [];
	let declared: readonly string[] | undefined;
	let rationale = '';
	let scopeWidenRefused = false;

	/** Record one read against the ledger, merging repeats so a re-read is a count, not a duplicate line. */
	function record(kind: 'document' | 'source', id: string, title: string, blocks: number): void {
		const existing = reads.findIndex(entry => entry.kind === kind && entry.id === id);
		if (existing >= 0) {
			const previous = reads[existing];
			reads[existing] = { ...previous, reads: previous.reads + 1, blocks: previous.blocks + blocks };
			return;
		}
		reads.push({ kind, id, title, inScope: kind === 'source' || inScope.has(id), reads: 1, blocks });
	}

	const listDocuments: AgentToolExecutor = async () => {
		const rows = await options.host.listDocuments();
		if (!rows.length) { return { content: 'This project has no documents.' }; }
		const lines = rows.map(row => {
			const marks = [`~${row.approxTokens} tokens`];
			if (row.status) { marks.push(`status: ${row.status}`); }
			if (row.policy) { marks.push(`policy: ${row.policy}`); }
			if (inScope.has(row.docId)) { marks.push('attached'); }
			const headings = row.headings.length ? `\n    headings: ${row.headings.join(' | ')}` : '';
			return `- ${row.docId}  "${row.title}"  (${marks.join(', ')})${headings}`;
		});
		return { content: `${rows.length} document${rows.length === 1 ? '' : 's'} in this project:\n${lines.join('\n')}` };
	};

	const readDocument: AgentToolExecutor = async input => {
		const docId = readString(input, 'docId');
		if (!docId) { return errorResult('read_document needs a docId. Take one from the task or from list_documents.'); }
		const doc = await options.host.readDocument(docId);
		if (!doc) { return errorResult(`There is no document with the id ${docId}. Call list_documents to see what this project holds.`); }
		const heading = readString(input, 'heading');
		if (heading) {
			const section = sliceHeadingSection(doc.blocks, heading);
			if (!section) {
				return errorResult(`"${doc.title}" has no heading called ${heading}. Read the document without a heading to see its structure.`);
			}
			record('document', doc.docId, doc.title, section.blocks.length);
			return { content: `"${doc.title}" - the section under ${heading}, ${section.blocks.length} block${section.blocks.length === 1 ? '' : 's'}:\n${serialiseBlocks(section.blocks, section.startIndex)}` };
		}
		record('document', doc.docId, doc.title, doc.blocks.length);
		if (!doc.blocks.length) { return { content: `"${doc.title}" is empty.` }; }
		return { content: `"${doc.title}" - ${doc.blocks.length} block${doc.blocks.length === 1 ? '' : 's'}:\n${serialiseBlocks(doc.blocks)}` };
	};

	const readSource: AgentToolExecutor = async input => {
		const name = readString(input, 'name');
		if (!name) { return errorResult('read_source needs a source name.'); }
		const text = await options.host.readSource(name);
		if (text === undefined) { return errorResult(`There is no source called ${name} on the documents in this run.`); }
		record('source', name, name, 0);
		return { content: `Source ${name}:\n"""${text}"""` };
	};

	const planScope: AgentToolExecutor = async input => {
		const raw = (input && typeof input === 'object') ? (input as Record<string, unknown>).docIds : undefined;
		if (!Array.isArray(raw) || raw.some(id => typeof id !== 'string')) {
			return errorResult('plan_scope needs docIds: an array of document ids, each one of the documents the person attached.');
		}
		const ids = raw as string[];
		// Fails closed: the widening check runs BEFORE anything is recorded, so a refused call leaves the
		// declared scope exactly as it was rather than half-applying the subset it happened to get right.
		const outside = ids.filter(id => !inScope.has(id));
		if (outside.length) {
			scopeWidenRefused = true;
			const attached = scope.map(doc => doc.docId).join(', ') || '(none)';
			return errorResult(`${AGENT_SCOPE_LOCKED_ERROR}: this run is scoped to the documents the person attached, so ${outside.join(', ')} cannot be added to it. The attached documents are: ${attached}. You may still READ other documents for context - every read is disclosed to the person - but the scope itself is theirs to widen, not yours.`);
		}
		declared = ids;
		rationale = readString(input, 'rationale') ?? '';
		const titles = ids.map(id => scope.find(doc => doc.docId === id)?.title ?? id);
		return { content: ids.length ? `Scope recorded: ${ids.length} document${ids.length === 1 ? '' : 's'} - ${titles.join(', ')}.` : 'Scope recorded as empty. Nothing in this run is about a particular document.' };
	};

	const registry: IAgentToolRegistry = {
		definitions: AGENT_READ_ONLY_TOOL_DEFINITIONS,
		executors: new Map<string, AgentToolExecutor>([
			[AGENT_LIST_DOCUMENTS_TOOL, listDocuments],
			[AGENT_READ_DOCUMENT_TOOL, readDocument],
			[AGENT_READ_SOURCE_TOOL, readSource],
			[AGENT_PLAN_SCOPE_TOOL, planScope],
		]),
		...(options.host.unsettledWork ? { unsettledWork: options.host.unsettledWork } : {}),
	};

	return {
		registry,
		receipts: () => ({ scope, declared, rationale, reads: reads.slice(), scopeWidenRefused }),
	};
}

/**
 * The FIRST user turn of a read-only run: the person's question, plus the explicit scope pre-filled so the
 * model never has to guess at it and never has to call `plan_scope` just to learn what it is. This is the
 * volatile half of the prompt and it sits AFTER the stable system prompt for exactly that reason (doc 30
 * section 2.6) - the cache breakpoint can only bite on a prefix that does not move.
 */
export function composeAgentTask(question: string, scope: readonly IAgentScopeDoc[]): string {
	const chips = scope.map(doc => `- ${doc.docId}  "${doc.title}"`).join('\n');
	return `Attached documents (this run's scope):\n${chips || '(none)'}\n\nQuestion: ${question}`;
}

function plural(n: number): string {
	return n === 1 ? '' : 's';
}

/**
 * Compose the run ledger from the host's own receipts (doc 30 2.4: "the host composes the authoritative
 * per-document ledger from store receipts"; founder ruling 9.4: reads outside scope are allowed AND
 * disclosed). The model narrates; this counts. Three registers, each printed only when it has something to
 * say: what was read of the attached set, what else was read, and what was left unopened.
 */
export function composeAgentReadLedger(receipts: IAgentRunReceipts): string {
	const documents = receipts.reads.filter(entry => entry.kind === 'document');
	const attached = documents.filter(entry => entry.inScope);
	const outside = documents.filter(entry => !entry.inScope);
	const sources = receipts.reads.filter(entry => entry.kind === 'source');
	const unopened = receipts.scope.filter(doc => !attached.some(entry => entry.id === doc.docId));

	const describe = (entry: IAgentReadLedgerEntry) => localize('livingDocs.agentLedger.doc', "{0} ({1} block{2})", entry.title, entry.blocks, plural(entry.blocks));
	const parts: string[] = [];

	if (!attached.length && !outside.length && !sources.length) {
		parts.push(localize('livingDocs.agentLedger.nothing', "I read nothing in this run."));
	}
	if (attached.length) {
		parts.push(localize(
			'livingDocs.agentLedger.attached',
			"Read {0} of the {1} attached document{2}: {3}.",
			attached.length, receipts.scope.length, plural(receipts.scope.length), attached.map(describe).join(', ')
		));
	}
	if (outside.length) {
		parts.push(localize(
			'livingDocs.agentLedger.outside',
			"Also read {0} other project document{1} for context: {2}.",
			outside.length, plural(outside.length), outside.map(describe).join(', ')
		));
	}
	if (sources.length) {
		parts.push(localize(
			'livingDocs.agentLedger.sources',
			"Read {0} source{1}: {2}.",
			sources.length, plural(sources.length), sources.map(entry => entry.title).join(', ')
		));
	}
	if (unopened.length) {
		parts.push(localize(
			'livingDocs.agentLedger.unopened',
			"Did not open {0}.",
			unopened.map(doc => doc.title).join(', ')
		));
	}
	if (receipts.scopeWidenRefused) {
		parts.push(localize('livingDocs.agentLedger.scopeLocked', "The scope stayed as you attached it; I could not add to it."));
	}
	parts.push(localize('livingDocs.agentLedger.readOnly', "Nothing was changed - this run could only read."));
	return parts.join(' ');
}

/**
 * The plain-words label for one tool call in the steps feed (doc 30 2.4 "steering": the feed generalises to
 * "step K - reading X"). The person watching a run should read what it is DOING, never a tool name.
 */
export function agentStepLabel(name: string, input: unknown, titleOf: (docId: string) => string | undefined): string {
	switch (name) {
		case AGENT_LIST_DOCUMENTS_TOOL:
			return localize('livingDocs.agentStep.list', "Listed the project's documents");
		case AGENT_READ_DOCUMENT_TOOL: {
			const docId = readString(input, 'docId');
			const title = (docId && titleOf(docId)) || docId || localize('livingDocs.agentStep.aDocument', "a document");
			const heading = readString(input, 'heading');
			return heading
				? localize('livingDocs.agentStep.readSection', "Read {0}, under {1}", title, heading)
				: localize('livingDocs.agentStep.readDocument', "Read {0}", title);
		}
		case AGENT_READ_SOURCE_TOOL:
			return localize('livingDocs.agentStep.readSource', "Read {0}", readString(input, 'name') ?? localize('livingDocs.agentStep.aSource', "a source"));
		case AGENT_PLAN_SCOPE_TOOL:
			return localize('livingDocs.agentStep.planScope', "Recorded what this run is about");
		default:
			return name;
	}
}

/**
 * The honest terminal sentence for a run that ended WITHOUT `finish` (doc 30 D4: reaching a bound is a typed
 * failure, never a silent stop). Every reason the kernel can name gets words a person can act on; the step
 * ceiling in particular says what it hit and what to do about it, because "the answer just stopped" is the
 * failure mode this whole design exists to make impossible.
 */
export function describeAgentRunFailure(reason: AgentFailureReason, maxSteps: number): string {
	switch (reason) {
		case 'stepCeiling':
			return localize('livingDocs.agentFailed.ceiling', "I stopped after {0} steps without finishing my answer. Nothing was changed. Ask again, more narrowly, and I will get further.", maxSteps);
		case 'maxTokens':
			return localize('livingDocs.agentFailed.maxTokens', "I ran out of room part-way through a step, so I stopped rather than answer from half a turn. Nothing was changed.");
		case 'stoppedWithoutFinish':
			return localize('livingDocs.agentFailed.noFinish', "I stopped without finishing my answer. Nothing was changed.");
		case 'streamError':
			return localize('livingDocs.agentFailed.stream', "The model call broke part-way through, so I stopped. Nothing was changed.");
		case 'clientError':
			return localize('livingDocs.agentFailed.client', "The model call failed, so I stopped. Nothing was changed.");
		case 'hostProbeFailed':
			return localize('livingDocs.agentFailed.probe', "I could not tell whether everything I had started had finished, so I stopped rather than claim it had. Nothing was changed.");
		case 'toolUseWithoutTools':
		case 'duplicateToolUseIds':
			return localize('livingDocs.agentFailed.malformed', "The model sent a step I could not act on, so I stopped. Nothing was changed.");
	}
}

/** Which pipeline a chat turn takes. */
export type ChatRoute = 'loop' | 'single-shot';

/** The signals the branch point reads. Deliberately tiny: routing is a decision, not an inference. */
export interface IChatRouteSignals {
	/** How many attachment chips the turn carries - the explicit scope signal (doc 30 D3, tier 0). */
	readonly attachedCount: number;
	/** Whether the agent loop is enabled for this workspace (`livingDocs.agentLoop`). */
	readonly loopEnabled: boolean;
}

/**
 * THE BRANCH POINT (issue #380; doc 30 section 7, stage 3: "the kernel plus tools, first for explicit-scope
 * asks only - chips present, the founder's clearest case").
 *
 * A turn whose scope was stated by the person - attachment chips present - runs the agent loop. Every other
 * ask keeps the single-shot pipeline it has always taken, which is why nothing outside this one class can
 * regress: the predicate is total, it reads two booleans, and it is the ONLY place the choice is made.
 *
 * It lives here, pure, rather than inline at the call site because the routing rule is the part of this
 * tranche most likely to be re-litigated as the later tranches land, and a rule that can be read and tested
 * without standing up a service is a rule that can be changed without fear.
 */
export function chooseChatRoute(signals: IChatRouteSignals): ChatRoute {
	return signals.loopEnabled && signals.attachedCount > 0 ? 'loop' : 'single-shot';
}
