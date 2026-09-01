/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IAgentRun, IAuditEntry, IProposedChange } from './livingDocsModel.js';
import { addressLabel } from './livingDocAddress.js';

// The Agents activity ledger's read model (spec 43 A3, plan 49-c): a pure, DOM-free fold of the SAME real
// event streams the editor's trust chips and the History tab already read - the orchestrator run log
// (`IAgentRun[]`) and each document's lock audit (`IAuditEntry[]`) - plus the live pending set (the changes
// still WAITING on a human call). It NEVER mutates any of them: the ledger is a read model, so this module
// only maps and orders (do-not-break, plan 49 section 5). Every row traces to a real event; there are no
// fabricated rows, and an empty project yields an empty list (the truthful empty state is the caller's).
//
// The three tiers match the ledger's status dot exactly (A3.1): `waiting` (amber) = a meaning change waiting
// on approval; `applied` (green) = an agent auto-applied or a human approved a change (reversible); `admin`
// (grey) = a registry/administrative event (paused, rejected, a run that errored). No fourth state is invented.

/** One ledger row's status tier - the amber/green/grey dot + the badge variant (A3.1). */
export type LedgerKind = 'waiting' | 'applied' | 'admin';

/**
 * A doc reference inside a ledger sentence (A3.3): the human `label` shown ("Weekly Summary · line 6"), the
 * durable `docId` (URI string) the deep link opens, and the durable `blockId` a WAITING row scrolls to (the
 * address model resolves it to the current line at render time; a deleted block degrades to no scroll). The
 * printed line number is NEVER persisted - it is computed here from the block's current ordinal.
 */
export interface ILedgerDocRef {
	readonly label: string;
	readonly docId: string;
	readonly blockId?: string;
}

/**
 * One ledger row (A3.1): the event's epoch `at` (for ordering + the mono timestamp), its `kind` (dot colour +
 * badge), the plain-language sentence as a `lead` + optional trailing doc link + optional `tail`, and the
 * right-aligned `badge` text. `deepLink` is true only for WAITING rows that resolve to a document's Review tab.
 */
export interface ILedgerEntry {
	readonly at: number;
	readonly kind: LedgerKind;
	/** The sentence up to (and excluding) the doc link, e.g. "Reporting agent proposed a meaning change in ". */
	readonly lead: string;
	/** The linked document reference rendered inside the sentence, when the event names a real document. */
	readonly doc?: ILedgerDocRef;
	/** Any sentence text after the doc link, e.g. " from metrics.csv". Empty when the link ends the sentence. */
	readonly tail: string;
	/** The right-aligned mono badge text: "WAITING" / "auto-applied · reversible" / "by <user>" / etc. */
	readonly badge: string;
	/** True for a WAITING row whose doc link deep-links into that document's Review tab (A3.3). */
	readonly deepLink: boolean;
}

/** One document's audit stream, carried with the doc identity the flat `getAudit()` view drops (A3.3 needs it). */
export interface ILedgerAuditInput {
	readonly docId: string;
	readonly docTitle: string;
	readonly entries: readonly IAuditEntry[];
	/**
	 * The block ids present in the document right now, in order, so a persisted audit `blockId` can be resolved
	 * to its current display line. A block that is gone resolves to no line (the sentence then names the doc
	 * without a "· line N" suffix rather than printing a stale number).
	 */
	readonly blockIds: readonly string[];
}

/** One agent run, carried with the agent's human name (the run only stores the id) for the sentence. */
export interface ILedgerRunInput {
	readonly agentName: string;
	readonly run: IAgentRun;
}

/**
 * A live pending change still waiting on a human call (a WAITING row). Only `meaning` changes surface here:
 * `figure` changes auto-apply under an auto-figures policy and land as an `applied` audit row, so listing them
 * as WAITING too would double-count. `blockLine` is the change's current display line where the block resolves.
 */
export interface ILedgerWaitingInput {
	readonly change: IProposedChange;
	readonly blockLine?: number;
}

/** Every input stream the ledger folds. The caller assembles these from the live service (real data only). */
export interface ILedgerInputs {
	readonly runs: readonly ILedgerRunInput[];
	readonly audits: readonly ILedgerAuditInput[];
	readonly waiting: readonly ILedgerWaitingInput[];
}

/** The bounded ledger (A3.4): the most recent rows plus whether older rows were truncated. */
export interface IActivityLedger {
	readonly entries: readonly ILedgerEntry[];
	/** True when the fold produced more rows than the cap, so the honest "older activity..." line shows. */
	readonly truncated: boolean;
}

/** The ledger shows the most recent this-many rows (A3.4); older activity lives in each doc's History tab. */
export const LEDGER_CAP = 50;

/** A doc ref carrying its resolved current line ("Weekly Summary · line 6"), or the bare title when unresolved. */
function docRef(docId: string, docTitle: string, line: number | undefined, blockId?: string): ILedgerDocRef {
	const label = line !== undefined ? `${docTitle} · ${addressLabel(line).toLowerCase()}` : docTitle;
	return { label, docId, blockId };
}

/** Resolve a persisted audit `blockId` to its current 1-based display line, or undefined when the block is gone. */
function resolveLine(blockIds: readonly string[], blockId: string): number | undefined {
	const index = blockIds.indexOf(blockId);
	return index < 0 ? undefined : index + 1;
}

// A run row's plain-language sentence + badge. A run that queued changes is WAITING; a run that auto-applied
// figures is applied+reversible; a run that only touched docs without landing anything, or that errored, is
// admin. The sentence names the run's documents when its flow declares them (real), else stays honestly generic.
function runEntry(input: ILedgerRunInput): ILedgerEntry | undefined {
	const { agentName, run } = input;
	const at = Date.parse(run.finishedAt ?? run.startedAt) || 0;
	// A run skipped by the overlap rule never executed - it is not an activity worth a ledger row.
	if (run.skippedReason) { return undefined; }
	if (run.error) {
		return { at, kind: 'admin', lead: `${agentName} run failed · ${run.error}`, tail: '', badge: 'no change applied', deepLink: false };
	}
	if (run.blocked) {
		return { at, kind: 'admin', lead: `${agentName} was stopped at the verify gate · ${run.blocked}`, tail: '', badge: 'blocked', deepLink: false };
	}
	if (run.queued > 0) {
		const n = run.queued;
		return { at, kind: 'waiting', lead: `${agentName} proposed ${n} change${n === 1 ? '' : 's'} for your review`, tail: '', badge: 'WAITING', deepLink: false };
	}
	if (run.applied > 0) {
		const n = run.applied;
		return { at, kind: 'applied', lead: `${agentName} refreshed ${n} bound figure${n === 1 ? '' : 's'}`, tail: '', badge: 'auto-applied · reversible', deepLink: false };
	}
	// A run that touched documents but changed nothing is honest activity worth recording, quietly.
	const docs = run.docsTouched ?? 0;
	return { at, kind: 'admin', lead: `${agentName} swept ${docs} document${docs === 1 ? '' : 's'} · nothing to change`, tail: '', badge: 'no change needed', deepLink: false };
}

// An audit row's plain-language sentence + badge, deriving from the SAME entries the History tab reads. An
// auto-applied edit is applied+reversible; an approved edit is applied "by <user>"; a rejected edit is admin;
// a restore/override/publish is the honest administrative note. The sentence links the document by address.
function auditEntry(docId: string, docTitle: string, blockIds: readonly string[], user: string, e: IAuditEntry): ILedgerEntry | undefined {
	const at = Date.parse(e.time) || 0;
	const line = resolveLine(blockIds, e.blockId);
	// An audit row opens the document (not a Review deep link), so its ref carries no blockId - the blockId
	// is load-bearing only for a WAITING row's deep-link scroll. The address is still cited via `line`.
	const ref = docRef(docId, docTitle, line);
	// The publish/override notes are recorded on the first block with a synthetic newText marker (not a real
	// prose edit), so they read as administrative events rather than applied figure/prose changes.
	if (e.via === 'override') {
		return { at, kind: 'admin', lead: 'Exported past the verify gate in ', doc: ref, tail: '', badge: `by ${user}`, deepLink: false };
	}
	if (e.action === 'rejected') {
		return { at, kind: 'admin', lead: 'Rejected a proposed change in ', doc: ref, tail: '', badge: `by ${user}`, deepLink: false };
	}
	// An approval that could NOT be applied (docs/30 I1, issue #329). It has to be caught BEFORE the fall-through
	// below, which reads every unhandled action as "Approved a change" - the very sentence this invariant exists
	// to stop the product from writing about a document nothing happened to.
	if (e.action === 'apply-failed') {
		return { at, kind: 'admin', lead: 'A change could not be applied to ', doc: ref, tail: '', badge: 'not applied', deepLink: false };
	}
	if (e.via === 'restore') {
		return { at, kind: 'applied', lead: 'Restored an earlier version of ', doc: ref, tail: '', badge: `by ${user}`, deepLink: false };
	}
	if (e.action === 'external-overwrite-kept') {
		return { at, kind: 'admin', lead: 'Kept your open version over an outside edit to ', doc: ref, tail: '', badge: `by ${user}`, deepLink: false };
	}
	if (e.action === 'auto-applied') {
		return { at, kind: 'applied', lead: 'Auto-applied a change in ', doc: ref, tail: '', badge: 'auto-applied · reversible', deepLink: false };
	}
	// action === 'approved' (a human accepted the agent's change, optionally hand-edited).
	const how = e.via === 'tweaked' ? 'Approved a hand-edited change in ' : 'Approved a change in ';
	return { at, kind: 'applied', lead: how, doc: ref, tail: '', badge: `by ${user}`, deepLink: false };
}

// A live pending meaning change → a WAITING row that deep-links to the document's Review tab (A3.3). The
// sentence cites the block's current address; the row carries the durable blockId so the deep link scrolls
// to the right block after the doc reloads (surviving the closed-doc path via the panel-replay seam).
function waitingEntry(input: ILedgerWaitingInput): ILedgerEntry {
	const { change, blockLine } = input;
	const at = 0; // A pending change has no recorded timestamp; it sorts to the top (newest) as the live call.
	const ref = docRef(change.docId, change.docTitle, blockLine, change.blockId);
	return { at, kind: 'waiting', lead: 'A meaning change is waiting on your call in ', doc: ref, tail: '', badge: 'WAITING', deepLink: true };
}

/**
 * Build the bounded activity ledger (A3) from the real event streams. Folds agent runs, per-document lock
 * audits and the live pending set into one flat chronological list, newest first, and bounds it to `LEDGER_CAP`
 * with a truncation flag. Pure: it reads the inputs and returns rows; it never mutates orchestrator or lock
 * state. `now` is the injectable render clock so relative-time formatting stays deterministic (never Date.now
 * here); WAITING rows (which have no recorded time) always sort to the top as the live, unresolved calls.
 */
export function buildActivityLedger(inputs: ILedgerInputs, user: string): IActivityLedger {
	const rows: ILedgerEntry[] = [];
	for (const w of inputs.waiting) { rows.push(waitingEntry(w)); }
	for (const r of inputs.runs) { const e = runEntry(r); if (e) { rows.push(e); } }
	for (const a of inputs.audits) {
		for (const entry of a.entries) {
			const e = auditEntry(a.docId, a.docTitle, a.blockIds, user, entry);
			if (e) { rows.push(e); }
		}
	}
	// Newest first. WAITING rows (at === 0 by construction) sort above dated rows so the live calls lead; a
	// stable sort keeps same-timestamp rows in insertion order (waiting, then runs, then audits).
	const ordered = rows
		.map((entry, index) => ({ entry, index }))
		.sort((a, b) => {
			// WAITING rows (at 0) always lead; among dated rows, newest first.
			const aw = a.entry.kind === 'waiting' && a.entry.at === 0;
			const bw = b.entry.kind === 'waiting' && b.entry.at === 0;
			if (aw !== bw) { return aw ? -1 : 1; }
			if (a.entry.at !== b.entry.at) { return b.entry.at - a.entry.at; }
			return a.index - b.index;
		})
		.map(x => x.entry);
	const truncated = ordered.length > LEDGER_CAP;
	return { entries: truncated ? ordered.slice(0, LEDGER_CAP) : ordered, truncated };
}
