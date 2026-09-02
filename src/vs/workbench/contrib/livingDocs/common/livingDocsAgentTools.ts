/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type Anthropic from '@anthropic-ai/sdk';
import { localize } from '../../../../nls.js';
import { AGENT_FINISH_TOOL_DEFINITION, AgentFailureReason, AgentToolExecutor, IAgentToolRegistry, IAgentToolResult } from './livingDocsAgentLoop.js';
import {
	expandSegments, ISegmentHunk, ISegmentReceipt, parseSegments, screenSegmentHunks,
	SEGMENT_LIST_SCHEMA, segmentLabel, SegmentDropReason, summariseSegmentReceipts
} from './livingDocSegments.js';
import { ITurnReceiptOutcome, reconcileTurnReceipt } from './turnReceipts.js';

// The tool surface for stage 3 (issues #380 and #381; docs/30-editing-architecture.md section 2.4 "the
// eight-verb tool surface", section 4 "the UX specification"). Doc 30 names eight verbs; this module
// implements five of them - `list_documents`, `read_document`, `read_source`, `plan_scope` and the ONE
// in-loop mutating verb `propose_segments` - and leans on the kernel for the mandatory terminal `finish`.
// `rewrite_documents` and `search_documents` are deliberately absent: whole-document rewrites belong to a
// later tranche and retrieval to stage 4, and a verb the model is never TOLD about is a verb it cannot
// half-use.
//
// There are two surfaces here and they differ by exactly one verb. `createReadOnlyAgentTools` ships the
// four readers and says so in its prompt; `createEditingAgentTools` adds `propose_segments`. Which one a
// run gets is the caller's decision, made once, and a run that was never handed the verb cannot change a
// document by any path - the guard is the absence of the tool, not a flag inside it.
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
export const AGENT_PROPOSE_SEGMENTS_TOOL = 'propose_segments';

/** The typed error `plan_scope` returns when a declaration reaches past the explicit signal (doc 30 2.4). */
export const AGENT_SCOPE_LOCKED_ERROR = 'scope_locked';

/** The typed error `propose_segments` returns for a document outside the declared scope (doc 30 2.4). */
export const AGENT_OUT_OF_SCOPE_ERROR = 'out_of_scope';

/** The typed error `propose_segments` returns when the segment list did not survive validation (I7). */
export const AGENT_INVALID_SEGMENTS_ERROR = 'invalid_segments';

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
 * One document as the EDIT path needs it: the raw body the hunks are measured in, the resolved view the
 * model was actually shown, and the policy dial that may refuse the whole call.
 *
 * `body` is body text with the frontmatter already stripped, which is the frontmatter quarantine (doc 30
 * section 2.1): the `---` block never enters model scope and never enters this module's coordinate space,
 * so the host can re-attach it verbatim with `withReplacedBody` on the way back out.
 */
export interface IAgentEditTarget {
	readonly docId: string;
	readonly title: string;
	/** The document body, frontmatter stripped, exactly as the hunks' offsets are measured against it. */
	readonly body: string;
	/**
	 * The block texts the model READ, in document order - `read_document` resolves bind links to their live
	 * values, so this is what its echoes must be checked against. Empty when the host has nothing to add.
	 */
	readonly blockViews: readonly string[];
	/** The enforced policy dial. `never` refuses every segment in the call, by name (issue #257). */
	readonly policy: string;
}

/**
 * Everything the tools need from the running product. A method that cannot answer returns `undefined`
 * rather than throwing; a throw is still contained (the kernel turns it into an `is_error` result), but
 * `undefined` is the shape that lets the tool word the failure for the model itself.
 */
export interface IAgentToolHost {
	/** Every document in the project, in the order the catalogue should read. */
	listDocuments(): Promise<readonly IAgentDocumentRow[]>;
	/** One document's blocks in document order, or `undefined` when the id names nothing. */
	readDocument(docId: string): Promise<IAgentDocumentRead | undefined>;
	/** One attached source's text, or `undefined` when the name is not a source of this project. */
	readSource(name: string): Promise<string | undefined>;
	/**
	 * The base a `propose_segments` call expands against, or `undefined` when the id names nothing. Required
	 * by {@link createEditingAgentTools}; absent on a read-only host, which has nothing to edit.
	 */
	readonly editTarget?: (docId: string) => Promise<IAgentEditTarget | undefined>;
	/**
	 * Write expanded hunks through the change store as reviewable changes, returning ONE id per hunk in the
	 * order they were given (the S3 seam). `undefined` means nothing was recorded at all - no store, or a
	 * journal that refused - and the tool says exactly that rather than inventing a per-segment reason for
	 * a failure that was not per-segment.
	 */
	readonly recordSegmentChanges?: (target: IAgentEditTarget, hunks: readonly ISegmentHunk[], intent: string) => Promise<readonly string[] | undefined>;
	/**
	 * Optional probe for work an earlier tool dispatched that has not settled. `propose_segments` settles
	 * inside its own call - the changes are in the store before it returns - so nothing here dispatches yet;
	 * the port exists because `finish` must be refusable over unsettled work the day `rewrite_documents`
	 * lands, and a seam added later is a seam nothing tested.
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

/**
 * What one `propose_segments` segment did, with the document it did it in.
 *
 * This is the record invariant I3 reconciles against, and the record issue #382 will reconcile the model's
 * `finish` narration against, so it is built from what the store ACTUALLY returned and never from what the
 * model said it was doing. One entry per mutating segment; `keep` segments claim nothing, so they receipt
 * nothing.
 */
export interface IAgentSegmentReceipt extends ISegmentReceipt {
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
	/** Every mutating segment the run acted on, in the order it proposed them. Empty on a read-only run. */
	readonly segmentReceipts: readonly IAgentSegmentReceipt[];
	/** How many `propose_segments` calls were rejected whole for failing validation (invariant I7). */
	readonly invalidSegmentLists: number;
	/**
	 * How many times the model invoked `propose_segments`, counted before any early return inside it. The
	 * reconciler's backstop (issue #425): an attempted mutation that queued nothing is a claim of change even
	 * when no per-segment receipt was left for it, so `mutatingCalls > 0` with zero queued fails closed.
	 */
	readonly mutatingCalls: number;
}

/** A tool surface, plus the receipts the host composes its ledger from. */
export interface IAgentTools {
	readonly registry: IAgentToolRegistry;
	/**
	 * The stable system prompt for THIS surface. It travels with the registry rather than being chosen at
	 * the call site because the two must agree: a run told it can propose changes, over a registry that has
	 * no `propose_segments`, would spend its steps calling a tool that does not exist.
	 */
	readonly systemPrompt: string;
	/** The receipts as they stand. Safe to read mid-run; the run's terminal reading is the ledger's input. */
	receipts(): IAgentRunReceipts;
}

/** The read-only surface's alias, kept so #380's callers and tests read unchanged. */
export type IAgentReadOnlyTools = IAgentTools;

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

/**
 * The stable system prompt for an EDITING run (issue #381). Stable by the same contract as the read-only
 * one: a literal, identical on every turn of every conversation, because it is the prompt-cache prefix
 * (doc 30 section 2.6).
 *
 * It teaches the segment contract in the terms the host enforces, and it is deliberately explicit about the
 * three things a model gets wrong here: the list must cover the WHOLE document, the echo is checked, and a
 * change is proposed for the person to review rather than something that has already happened. The last
 * one is a trust rule, not a mechanical one - a model that narrates "I have updated the pricing" over a
 * pending card has told the person something untrue about their own document.
 */
export const AGENT_EDITING_SYSTEM_PROMPT = [
	'You are the agent inside Abstract, a document editor. The person has attached documents and asked you something about them.',
	'You can read documents and you can propose changes to them. A change you propose is NOT applied: it goes to the person as a reviewable diff they approve or reject. Never say you have changed, updated or fixed a document - say what you have proposed.',
	'Scope is exactly the documents the person attached. plan_scope is already filled in with them; call it only to narrow the set or to record your reading plan, and never to add a document - that returns a scope_locked error. Proposing a change to a document outside that set returns an out_of_scope error.',
	'You may read other project documents for context when it genuinely helps. Every read is disclosed to the person, so read deliberately rather than broadly.',
	'read_document returns the document as ordinal-labelled blocks (B1, B2, ...). Refer to a block by its label; never quote prose to identify a position. Always read a document immediately before you propose a change to it, so your labels are current.',
	'propose_segments takes the WHOLE document as a list of segments in order: {keep} for every block you are not touching, {replace, echo, content} for the ones you are, {insertAfter, content} for new material. Every block from B1 to the last must appear exactly once in a keep or a replace, or the whole list is rejected.',
	'Each replace must echo the opening few words of every block in its range, in order. The host checks each echo against the block at that label, so a range that is one block out is rejected instead of applied to the wrong paragraph. Copy the words from what you just read; do not reconstruct them.',
	'Renaming a heading is an ordinary replace of that heading block. An empty content on a replace deletes those blocks.',
	'propose_segments answers with a receipt for every segment: the change it queued, or the named reason it did not. Read the receipt. If something was dropped, say so plainly rather than claiming it landed.',
	'Work in small steps. When you are done you MUST call finish exactly once with a plain-words summary. The host composes the authoritative record of what you read and proposed, so do not invent counts or file lists in your summary.',
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

/** The one in-loop mutating verb (doc 30 2.4): the model hands over a whole-document segment list, the host expands, screens and writes it, and answers with a receipt per segment. */
const PROPOSE_SEGMENTS_DEFINITION: Tool = {
	name: AGENT_PROPOSE_SEGMENTS_TOOL,
	description: 'Propose a change to one document by describing the WHOLE document as an ordered list of segments: {keep: "B1-B7"} for blocks you are not touching, {replace: "B8-B9", echo: ["Our pricing", "Each seat"], content: "..."} for the ones you are, {insertAfter: "B14", content: "..."} for new material. Every block must appear exactly once in a keep or a replace. Each replace echoes the opening words of every block in its range, and the host checks them, so an off-by-one range is rejected rather than applied to the wrong paragraph. Empty content on a replace deletes those blocks. The result is a diff the person reviews; nothing is written to the document.',
	input_schema: {
		type: 'object',
		properties: {
			docId: { type: 'string', description: 'The document to change, exactly as it was given to you. Read it first so your labels are current.' },
			segments: SEGMENT_LIST_SCHEMA,
			intent: { type: 'string', description: 'One sentence on what this change does, shown on the review card.' }
		},
		required: ['docId', 'segments']
	}
};

/**
 * The READ-ONLY definitions, in the order the model reads them, with the kernel's mandatory `finish` last.
 * Exported so a caller (and the tests) can assert the surface WITHOUT running a loop - the absence of every
 * mutating verb is a contract of the read-only surface.
 */
export const AGENT_READ_ONLY_TOOL_DEFINITIONS: readonly Tool[] = [
	LIST_DOCUMENTS_DEFINITION,
	READ_DOCUMENT_DEFINITION,
	READ_SOURCE_DEFINITION,
	PLAN_SCOPE_DEFINITION,
	AGENT_FINISH_TOOL_DEFINITION,
];

/**
 * The EDITING definitions: the four readers plus the ONE in-loop mutating verb (doc 30 2.4). The absence of
 * `rewrite_documents` and `search_documents` is a contract of this slice in exactly the same way.
 */
export const AGENT_EDITING_TOOL_DEFINITIONS: readonly Tool[] = [
	LIST_DOCUMENTS_DEFINITION,
	READ_DOCUMENT_DEFINITION,
	READ_SOURCE_DEFINITION,
	PLAN_SCOPE_DEFINITION,
	PROPOSE_SEGMENTS_DEFINITION,
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
	return createAgentTools({ ...options, editing: false });
}

/**
 * Build the EDITING tool surface for one run over an EXPLICIT scope (issue #381): the four readers plus
 * `propose_segments`, doc 30's one in-loop mutating verb.
 *
 * The host must supply `editTarget` and `recordSegmentChanges`; without them the verb has nothing to expand
 * against and nowhere to write, so the surface degrades to the read-only one rather than shipping a tool
 * that can only fail. That is a decision made once, here, instead of a per-call check the model would
 * discover halfway through a run.
 */
export function createEditingAgentTools(options: { readonly host: IAgentToolHost; readonly scope: readonly IAgentScopeDoc[] }): IAgentTools {
	const editable = !!options.host.editTarget && !!options.host.recordSegmentChanges;
	return createAgentTools({ ...options, editing: editable });
}

function createAgentTools(options: { readonly host: IAgentToolHost; readonly scope: readonly IAgentScopeDoc[]; readonly editing: boolean }): IAgentTools {
	const scope = options.scope;
	const inScope = new Set(scope.map(doc => doc.docId));
	const reads: IAgentReadLedgerEntry[] = [];
	const segmentReceipts: IAgentSegmentReceipt[] = [];
	let declared: readonly string[] | undefined;
	let rationale = '';
	let scopeWidenRefused = false;
	let invalidSegmentLists = 0;
	// How many times the model invoked the mutating verb, counted before ANY early return inside it so no
	// refusal or error path can fail to record the attempt. It is the reconciler's backstop (issue #425): an
	// attempted mutation that queued nothing is a claim of change even if some future error path forgot to
	// leave a per-segment receipt, so the reply fails closed rather than reading back the model's success prose.
	let mutatingCalls = 0;

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

	/**
	 * The ONE mutating verb (doc 30 2.4). The shape of it is the guarantee: the model hands over a segment
	 * list, the HOST expands it, screens it and writes it, and what comes back is a receipt per segment.
	 *
	 * Refusals come in two registers and they are deliberately different. A segment list that does not
	 * validate is rejected WHOLE - nothing from it is queued, the model is told which segment and why, and
	 * the run continues (invariant I7: a schema-invalid payload is a failed turn, not a partial apply). A
	 * list that validates but contains a hunk the host will not write - a bound figure, a no-op - queues
	 * everything else and NAMES that hunk's reason, because those are facts about the document rather than
	 * mistakes the model can correct by trying again.
	 */
	const proposeSegments: AgentToolExecutor = async input => {
		// Counted first: every invocation of the mutating verb is an attempt to change a document, and the
		// reconciler must be able to see it however this call returns (issue #425).
		mutatingCalls++;
		const docId = readString(input, 'docId');
		if (!docId) {
			// A propose call with no document named it still an attempted change that queued nothing; recorded
			// as a rejected list so the reply reconciles it as a failure rather than "proposed no changes".
			invalidSegmentLists++;
			return errorResult('propose_segments needs a docId. Take one from the task or from list_documents.');
		}
		const parsed = parseSegments((input as Record<string, unknown> | undefined)?.segments);
		if (!parsed.ok) {
			invalidSegmentLists++;
			return errorResult(`${AGENT_INVALID_SEGMENTS_ERROR}: ${parsed.message} Nothing was changed.`);
		}
		const mutating = parsed.segments
			.map((segment, segmentIndex) => ({ segmentIndex, label: segmentLabel(segment) }))
			.filter((entry): entry is { segmentIndex: number; label: string } => entry.label !== undefined);
		/** Record one whole-call refusal against every segment that asked for a change, then word it once. */
		const refuseAll = (reason: SegmentDropReason, docTitle: string, message: string): IAgentToolResult => {
			for (const entry of mutating) { segmentReceipts.push({ ...entry, docId, title: docTitle, reason }); }
			return errorResult(message);
		};

		if (!inScope.has(docId) || (declared && !declared.includes(docId))) {
			const attached = scope.map(doc => doc.docId).join(', ') || '(none)';
			return refuseAll('out-of-scope', docId, `${AGENT_OUT_OF_SCOPE_ERROR}: this run may only change the documents the person attached, so nothing was changed in ${docId}. The attached documents are: ${attached}.${declared && inScope.has(docId) ? ' You narrowed the scope yourself with plan_scope; call it again to include this document.' : ''}`);
		}
		const target = await options.host.editTarget!(docId);
		if (!target) {
			// An in-scope document that cannot be opened is a host-side failure to carry out the change, not a
			// silent nothing (#425 twin). Record it against every segment that asked for a change so the reply
			// reconciles it as a failure and the ledger names it, rather than reading back the model's prose.
			const title = scope.find(doc => doc.docId === docId)?.title ?? docId;
			return refuseAll('not-recorded', title, `There is no document with the id ${docId}. Call list_documents to see what this project holds.`);
		}
		if (target.policy === 'never') {
			return refuseAll('policy', target.title, `"${target.title}" is set never to change, so nothing was changed in it. Tell the person that; only they can change that setting.`);
		}

		const expansion = expandSegments(target.body, parsed.segments, { blockViews: target.blockViews });
		if (!expansion.ok) {
			invalidSegmentLists++;
			return errorResult(`${AGENT_INVALID_SEGMENTS_ERROR}: ${expansion.message} Nothing was changed in "${target.title}".`);
		}
		const screened = screenSegmentHunks(expansion.hunks);
		const queueable = screened.filter(entry => !entry.drop).map(entry => entry.hunk);
		let ids: readonly string[] = [];
		if (queueable.length) {
			const recorded = await options.host.recordSegmentChanges!(target, queueable, readString(input, 'intent') ?? '');
			// One id per hunk or nothing: a short list would mean some hunk landed without a receipt, and a
			// receipt is the only thing standing between the person and a claim nothing verified (I3). When the
			// write fails, the whole batch queued nothing - so record a receipt for EVERY screened segment (the
			// screener's own drops keep their reason, the would-have-queued hunks become 'not-recorded') rather
			// than returning silently, which used to collapse the claim to zero and pass the model's success
			// prose through unreconciled (issue #425).
			if (!recorded || recorded.length !== queueable.length) {
				for (const entry of screened) {
					segmentReceipts.push({ segmentIndex: entry.hunk.segmentIndex, label: entry.hunk.label, docId, title: target.title, reason: entry.drop ?? 'not-recorded' });
				}
				return errorResult(`Nothing could be recorded for "${target.title}", so nothing was changed. Tell the person this run could not write to their review queue.`);
			}
			ids = recorded;
		}

		let queued = 0;
		const receipts: ISegmentReceipt[] = screened.map(entry => entry.drop
			? { segmentIndex: entry.hunk.segmentIndex, label: entry.hunk.label, reason: entry.drop }
			: { segmentIndex: entry.hunk.segmentIndex, label: entry.hunk.label, changeId: ids[queued++] });
		receipts.sort((a, b) => a.segmentIndex - b.segmentIndex);
		for (const receipt of receipts) { segmentReceipts.push({ ...receipt, docId, title: target.title }); }

		const lines = receipts.map(receipt => receipt.changeId !== undefined
			? `- segment ${receipt.segmentIndex + 1} (${receipt.label}): queued as change ${receipt.changeId}`
			: `- segment ${receipt.segmentIndex + 1} (${receipt.label}): dropped (${receipt.reason})`);
		const head = `"${target.title}": ${ids.length} change${ids.length === 1 ? '' : 's'} queued for review, ${receipts.length - ids.length} dropped, ${expansion.keptBlocks} block${expansion.keptBlocks === 1 ? '' : 's'} kept unchanged.`;
		return { content: lines.length ? `${head}\n${lines.join('\n')}` : `${head} This list changed nothing.` };
	};

	const executors = new Map<string, AgentToolExecutor>([
		[AGENT_LIST_DOCUMENTS_TOOL, listDocuments],
		[AGENT_READ_DOCUMENT_TOOL, readDocument],
		[AGENT_READ_SOURCE_TOOL, readSource],
		[AGENT_PLAN_SCOPE_TOOL, planScope],
	]);
	if (options.editing) { executors.set(AGENT_PROPOSE_SEGMENTS_TOOL, proposeSegments); }

	const registry: IAgentToolRegistry = {
		definitions: options.editing ? AGENT_EDITING_TOOL_DEFINITIONS : AGENT_READ_ONLY_TOOL_DEFINITIONS,
		executors,
		...(options.host.unsettledWork ? { unsettledWork: options.host.unsettledWork } : {}),
	};

	return {
		registry,
		systemPrompt: options.editing ? AGENT_EDITING_SYSTEM_PROMPT : AGENT_READ_ONLY_SYSTEM_PROMPT,
		receipts: () => ({ scope, declared, rationale, reads: reads.slice(), scopeWidenRefused, segmentReceipts: segmentReceipts.slice(), invalidSegmentLists, mutatingCalls }),
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
	return [...readParagraphs(receipts), localize('livingDocs.agentLedger.readOnly', "Nothing was changed - this run could only read.")].join(' ');
}

/**
 * The ledger for an EDITING run (issue #381): everything the read-only ledger says about what was read,
 * followed by what was PROPOSED - per document, with every drop named.
 *
 * It is composed from the store's own receipts, never from the model's narration, which is what makes it
 * the authoritative half of the reply (doc 30 2.4, invariant I3). Issue #382 reconciles the narration
 * against exactly this record; until it does, the record at least sits beside the narration rather than
 * behind it, so a claim and its receipt are read together.
 */
export function composeAgentEditLedger(receipts: IAgentRunReceipts): string {
	const parts = readParagraphs(receipts);
	const byDoc = new Map<string, { title: string; receipts: IAgentSegmentReceipt[] }>();
	for (const receipt of receipts.segmentReceipts) {
		const entry = byDoc.get(receipt.docId) ?? { title: receipt.title, receipts: [] };
		entry.receipts.push(receipt);
		byDoc.set(receipt.docId, entry);
	}
	for (const entry of byDoc.values()) {
		parts.push(localize('livingDocs.agentLedger.forDoc', "In {0}: {1}.", entry.title, summariseSegmentReceipts(entry.receipts)));
	}
	if (receipts.invalidSegmentLists) {
		parts.push(receipts.invalidSegmentLists === 1
			? localize('livingDocs.agentLedger.invalid.one', "One set of changes was rejected before it reached your review queue because it did not line up with the document.")
			: localize('livingDocs.agentLedger.invalid.many', "{0} sets of changes were rejected before they reached your review queue because they did not line up with the document.", receipts.invalidSegmentLists));
	}
	// The closing line is a fold over what actually queued, so it can never contradict the per-document lines
	// above it (issue #425): a change waiting for review only when one truly landed; "proposed no changes" only
	// when the model proposed none; and, when it proposed changes that ALL dropped or failed to record, the
	// honest "nothing could be made" rather than the old "waiting on your review" over an empty rail.
	if (countQueuedChanges(receipts) > 0) {
		parts.push(localize('livingDocs.agentLedger.pending', "Nothing has been written to your documents yet; every change above is waiting on your review."));
	} else if (!byDoc.size && !receipts.invalidSegmentLists) {
		parts.push(localize('livingDocs.agentLedger.noChanges', "Nothing was changed - this run proposed no changes."));
	} else {
		parts.push(localize('livingDocs.agentLedger.noneMade', "Nothing was changed - none of the proposed changes could be made."));
	}
	return parts.join(' ');
}

/**
 * Reconcile the loop's finish narration against the run's store receipts before the reply renders (doc 30
 * invariant I3; issues #303, #415, #382). The loop path used to render `${finish.summary}\n\n${ledger}` -
 * the model's narration verbatim as the lead prose, the host ledger appended, and NO step reconciling the
 * two. A model that narrated "I updated the pricing" over a run that queued nothing had that false claim as
 * the most prominent line of the bubble - the exact #303 failure the single-shot path was hardened against.
 *
 * This is that step, and it carries the invariant by the same discipline the single-shot path uses via
 * `reconcileTurnReceipt`: the receipt is a REQUIRED argument, so prose cannot reach the bubble without it,
 * and what the model CLAIMED (every mutating segment it proposed, plus every whole list rejected as invalid)
 * is reconciled against what actually QUEUED (the segments carrying a store change id). Claimed > 0 with
 * queued === 0 discards the narrative and renders the reconciliation as a failure; anything that queued keeps
 * the narrative with the ledger beside it. The host ledger is the authoritative half either way, and it is
 * the count the review rail holds, so reply, rail and receipt report the one number.
 */
export function reconcileAgentReply(finishSummary: string, receipts: IAgentRunReceipts): ITurnReceiptOutcome {
	const ledger = composeAgentEditLedger(receipts);
	const summary = finishSummary.trim();
	const queued = countQueuedChanges(receipts);
	// What the model claimed it would change: every mutating segment it proposed, plus every whole list the
	// host rejected before a segment could even be screened (a claim that queued nothing all the same).
	let claimed = receipts.segmentReceipts.length + receipts.invalidSegmentLists;
	// Backstop (issue #425, defence in depth): a propose_segments call that queued nothing is a claim of
	// change even if some executor error path left no receipt for it. `mutatingCalls` is counted before any
	// early return in the executor, so it cannot be skipped - no attempted mutation can pass as a non-failure.
	if (queued === 0 && receipts.mutatingCalls > 0) { claimed = Math.max(claimed, 1); }
	// The I3 decision, made by the single-shot path's own machinery. The loop's per-document ledger already
	// NAMES each drop, so no `drops` are handed over here - the reconciler is used for its claimed-versus-
	// queued verdict and its honest lead sentence; the ledger carries the reasons.
	const reconciled = reconcileTurnReceipt({ claimed, queued, drops: [], reply: summary });
	// The reconciler's content leads in EVERY case, at parity with the single-shot path: on a failure it is the
	// honest "could not apply" sentence (the model's success prose discarded, I3); on a shortfall it is the
	// summary followed by the reconciler's own "N changes could not be applied", so an inflated claim is
	// qualified before the reader reaches the detail; on a clean run it is the summary unchanged. The
	// authoritative ledger is appended in every case.
	return { content: reconciled.content ? `${reconciled.content}\n\n${ledger}` : ledger, isError: reconciled.isError };
}

/**
 * How many of a run's segments actually became reviewable changes: the segments carrying a store change id.
 * This is the ONE definition of "queued" - the reply, the run ledger and the review rail are all folds over
 * it, so a run can never be counted two ways (AC3; the same guarantee the read half makes in `readParagraphs`).
 */
export function countQueuedChanges(receipts: IAgentRunReceipts): number {
	return receipts.segmentReceipts.filter(receipt => receipt.changeId !== undefined).length;
}

/** The read half of the ledger, shared by both composers so one run cannot be counted two ways. */
function readParagraphs(receipts: IAgentRunReceipts): string[] {
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
	return parts;
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
		case AGENT_PROPOSE_SEGMENTS_TOOL: {
			const docId = readString(input, 'docId');
			const title = (docId && titleOf(docId)) || docId || localize('livingDocs.agentStep.aDocument', "a document");
			return localize('livingDocs.agentStep.proposeSegments', "Proposed changes to {0}", title);
		}
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
export function describeAgentRunFailure(reason: AgentFailureReason, maxSteps: number, options?: { readonly changesQueued?: number }): string {
	const queued = options?.changesQueued ?? 0;
	// The state clause is separate from the reason clause because on an EDITING run it is not always
	// "nothing was changed": a run can queue three changes and then hit the step ceiling, and telling the
	// person nothing happened while three cards sit in their review rail is the same lie in the other
	// direction (issue #381; the read-only tranche could hard-code it because it had no way to be wrong).
	const state = queued === 0
		? localize('livingDocs.agentFailed.nothing', "Nothing was changed.")
		: queued === 1
			? localize('livingDocs.agentFailed.queued.one', "One change did reach your review queue before that, and it is still waiting on your call.")
			: localize('livingDocs.agentFailed.queued.many', "{0} changes did reach your review queue before that, and they are still waiting on your call.", queued);
	switch (reason) {
		case 'stepCeiling':
			return `${localize('livingDocs.agentFailed.ceiling', "I stopped after {0} steps without finishing my answer. Ask again, more narrowly, and I will get further.", maxSteps)} ${state}`;
		case 'maxTokens':
			return `${localize('livingDocs.agentFailed.maxTokens', "I ran out of room part-way through a step, so I stopped rather than answer from half a turn.")} ${state}`;
		case 'stoppedWithoutFinish':
			return `${localize('livingDocs.agentFailed.noFinish', "I stopped without finishing my answer.")} ${state}`;
		case 'streamError':
			return `${localize('livingDocs.agentFailed.stream', "The model call broke part-way through, so I stopped.")} ${state}`;
		case 'clientError':
			return `${localize('livingDocs.agentFailed.client', "The model call failed, so I stopped.")} ${state}`;
		case 'hostProbeFailed':
			return `${localize('livingDocs.agentFailed.probe', "I could not tell whether everything I had started had finished, so I stopped rather than claim it had.")} ${state}`;
		case 'toolUseWithoutTools':
		case 'duplicateToolUseIds':
			return `${localize('livingDocs.agentFailed.malformed', "The model sent a step I could not act on, so I stopped.")} ${state}`;
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
