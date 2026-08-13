/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IChatMessage } from './livingDocs.js';

// Chat TRANSCRIPTS in workspace storage (plan 52 WP-B residuals, issue #312).
//
// `chatSessions.ts` next door persists the STRIP - which chats exist, what they are called, which one you
// were in. Until now that was all that survived a relaunch, so the app reopened showing three correctly
// titled tabs over three empty conversations: the shape of the work was remembered and the work itself was
// not. This module is the other half - the message bodies - kept deliberately separate because the two have
// completely different sizes and completely different risks. The strip is a few hundred bytes that must
// always survive; a transcript is unbounded prose that must NOT be allowed to grow forever in a workspace
// nobody ever clears.
//
// Three rules, applied in this order, bound it (all three are stated on the PR because a user losing text
// deserves to be told the rule, not to discover it):
//
//   1. per message  - a body longer than TRANSCRIPT_CONTENT_CAP is stored clipped, and marked as clipped so
//                     the rail can say so rather than quietly presenting a shortened answer as the whole one;
//   2. per chat     - only the most recent TRANSCRIPT_MESSAGE_CAP messages of a chat are stored;
//   3. per workspace- the stored bodies share one TRANSCRIPT_TOTAL_CAP character budget, filled in the order
//                     the caller hands us (the service passes the ACTIVE chat first, then the newest), and
//                     within a chat from its most recent message backwards, so what survives is always the
//                     end of the conversation you were actually in.
//
// Whatever the rules drop is COUNTED, per chat, and the count round-trips through storage - so a restored
// chat can open with an honest "N earlier messages were not kept" line instead of pretending it is complete.
//
// Restoring is a READ and nothing else. Nothing here calls a model, queues a proposal or writes an audit
// row: a restored transcript is a record of what happened, never a replay of it. That is also why a stored
// assistant turn carries `proposedCount` (how many changes it proposed) rather than the live `proposedIds`
// it had at the time - pending changes are in-memory only and do not survive a restart, so persisting their
// ids would guarantee a pointer that leads nowhere. A count can be spoken honestly; a dead id cannot.

/** The most recent messages one chat keeps in workspace storage. Older turns are dropped, and counted. */
export const TRANSCRIPT_MESSAGE_CAP = 40;

/** The longest a single stored message body may be, in characters. A longer body stores clipped + marked. */
export const TRANSCRIPT_CONTENT_CAP = 4000;

/** The whole workspace's transcript budget, in characters of stored body. Roughly a quarter of a megabyte. */
export const TRANSCRIPT_TOTAL_CAP = 256000;

/** One chat handed to the writer: its id, its live messages, and what it has already lost to the caps. */
export interface ITranscriptInput {
	readonly id: string;
	readonly messages: readonly IChatMessage[];
	/** Messages this chat lost to the caps in EARLIER saves, so the running total never resets to zero. */
	readonly dropped: number;
}

/** What the reader gives back: the restored conversations, and how much of each one was not kept. */
export interface ITranscriptStore {
	readonly transcripts: Map<string, IChatMessage[]>;
	readonly dropped: Map<string, number>;
}

/** The stored shape of one turn. Deliberately a subset of `IChatMessage` - see the note above on ids. */
interface IPersistedMessage {
	readonly role: 'user' | 'assistant';
	readonly content: string;
	readonly prompt?: string;
	readonly mentions?: readonly string[];
	readonly via?: 'model' | 'fallback';
	readonly stopped?: boolean;
	readonly failed?: boolean;
	readonly paused?: boolean;
	/** How many changes this assistant turn proposed, so a restored turn can say so without a dead pointer. */
	readonly proposed?: number;
	/** True when `content` was clipped at TRANSCRIPT_CONTENT_CAP, so the rail can mark it honestly. */
	readonly clipped?: boolean;
}

interface IPersistedTranscript {
	readonly id: string;
	readonly dropped: number;
	readonly messages: readonly IPersistedMessage[];
}

/** The persisted envelope. Versioned so a future shape can migrate rather than guess (as the strip does). */
interface IPersistedTranscripts {
	readonly version: 1;
	readonly sessions: readonly IPersistedTranscript[];
}

/** Clip one live turn down to the stored subset, marking a body the content cap shortened. */
function persistMessage(message: IChatMessage): IPersistedMessage {
	const full = String(message.content ?? '');
	const clipped = full.length > TRANSCRIPT_CONTENT_CAP;
	const content = clipped ? full.slice(0, TRANSCRIPT_CONTENT_CAP) : full;
	// The underlying instruction is kept (clipped the same way) because Retry re-runs it, not the shown
	// words - a restored generation turn must retry the brief it really sent, never the plain-words progress.
	const prompt = message.prompt ? String(message.prompt).slice(0, TRANSCRIPT_CONTENT_CAP) : undefined;
	return {
		role: message.role,
		content,
		...(prompt ? { prompt } : {}),
		...(message.mentions && message.mentions.length ? { mentions: [...message.mentions] } : {}),
		...(message.via ? { via: message.via } : {}),
		...(message.stopped ? { stopped: true } : {}),
		...(message.failed ? { failed: true } : {}),
		...(message.paused ? { paused: true } : {}),
		...(message.proposedIds && message.proposedIds.length ? { proposed: message.proposedIds.length } : {}),
		...(clipped ? { clipped: true } : {}),
	};
}

/** What one stored turn costs against the shared budget: the characters we are actually keeping. */
function messageCost(message: IPersistedMessage): number {
	return message.content.length + (message.prompt?.length ?? 0);
}

/**
 * Write the transcripts for workspace storage, applying all three caps. `entries` is in PRIORITY order - the
 * chat whose history matters most first - because the shared budget is filled in that order and a chat the
 * budget cannot reach stores nothing at all (and is honest about it). Returns the new per-chat dropped
 * totals so the caller can hold them and hand them back on the next save.
 */
export function serialiseTranscripts(entries: readonly ITranscriptInput[]): { raw: string; dropped: Map<string, number> } {
	const dropped = new Map<string, number>();
	const sessions: IPersistedTranscript[] = [];
	let budget = TRANSCRIPT_TOTAL_CAP;
	for (const entry of entries) {
		// Rule 2 - only the most recent turns of this chat are even candidates.
		const window = entry.messages.slice(-TRANSCRIPT_MESSAGE_CAP);
		let lost = Math.max(0, entry.dropped) + (entry.messages.length - window.length);
		// Rule 3 - fill from the NEWEST message backwards, so a chat that only partly fits keeps the end of
		// the conversation (where the reader is), never a stale opening with the answer missing.
		const kept: IPersistedMessage[] = [];
		for (let i = window.length - 1; i >= 0; i--) {
			const message = persistMessage(window[i]);
			const cost = messageCost(message);
			if (cost > budget) { lost += i + 1; break; }
			budget -= cost;
			kept.unshift(message);
		}
		if (kept.length || lost) { sessions.push({ id: entry.id, dropped: lost, messages: kept }); }
		if (lost) { dropped.set(entry.id, lost); }
	}
	const payload: IPersistedTranscripts = { version: 1, sessions };
	return { raw: JSON.stringify(payload), dropped };
}

/**
 * Read the transcripts back. Degrades HONESTLY, exactly as the strip does: unparseable JSON, a wrong version,
 * a non-array or a malformed turn yields an empty store rather than a throw or a half-built conversation - a
 * corrupt storage value costs the user their history, never their ability to open the workspace.
 *
 * Every restored turn is marked `restored`, which is what lets the rail tell a record from a live reply: it
 * prints an honest line where a restored turn's proposals used to be, instead of a pointer that leads nowhere.
 */
export function deserialiseTranscripts(raw: string | undefined): ITranscriptStore {
	const store: ITranscriptStore = { transcripts: new Map<string, IChatMessage[]>(), dropped: new Map<string, number>() };
	if (!raw) { return store; }
	let parsed: unknown;
	try { parsed = JSON.parse(raw); } catch { return store; }
	if (!parsed || typeof parsed !== 'object') { return store; }
	const payload = parsed as Partial<IPersistedTranscripts>;
	if (payload.version !== 1 || !Array.isArray(payload.sessions)) { return store; }
	for (const entry of payload.sessions) {
		if (!entry || typeof entry !== 'object') { continue; }
		const session = entry as Partial<IPersistedTranscript>;
		if (typeof session.id !== 'string' || !session.id) { continue; }
		const messages: IChatMessage[] = [];
		for (const rawMessage of Array.isArray(session.messages) ? session.messages : []) {
			if (!rawMessage || typeof rawMessage !== 'object') { continue; }
			const m = rawMessage as Partial<IPersistedMessage>;
			if (m.role !== 'user' && m.role !== 'assistant') { continue; }
			if (typeof m.content !== 'string') { continue; }
			messages.push({
				role: m.role,
				content: m.content,
				restored: true,
				...(typeof m.prompt === 'string' ? { prompt: m.prompt } : {}),
				...(Array.isArray(m.mentions) ? { mentions: m.mentions.filter((x): x is string => typeof x === 'string') } : {}),
				...(m.via === 'model' || m.via === 'fallback' ? { via: m.via } : {}),
				...(m.stopped === true ? { stopped: true } : {}),
				...(m.failed === true ? { failed: true } : {}),
				...(m.paused === true ? { paused: true } : {}),
				...(typeof m.proposed === 'number' && m.proposed > 0 ? { proposedCount: m.proposed } : {}),
				...(m.clipped === true ? { clipped: true } : {}),
			});
		}
		if (messages.length) { store.transcripts.set(session.id, messages); }
		const lost = typeof session.dropped === 'number' && session.dropped > 0 ? Math.floor(session.dropped) : 0;
		if (lost) { store.dropped.set(session.id, lost); }
	}
	return store;
}
