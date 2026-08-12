/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Workspace chat sessions (plan 52 WP-B, decision 178). Chat used to belong to a document: open another
// document and the conversation you were having vanished, because the rail was keyed by the active file.
// Chats now belong to the WORKSPACE and documents join them via the existing @-mention/attach chips, so a
// conversation survives navigation and two conversations can hold different attach sets at once.
//
// This module is the pure list model - create, title, activate, close, cap-and-overflow, persist - so the
// ordering, titling and next-active rules are unit-tested without a rail, a service or a DOM. The service
// owns the message bodies (keyed by session id) and the rail owns the tab strip.

/** One chat session's metadata. The message bodies live in the service, keyed by `id`. */
export interface IChatSession {
	/** Stable identity: the key the service stores this session's messages and attach set under. */
	readonly id: string;
	/**
	 * The tab label. Starts as the caller's fallback ("New chat") and is replaced, once, by a short form of
	 * the first user message - so a tab strip reads as a list of topics rather than a row of identical chips.
	 */
	readonly title: string;
	/** True while the title is still the placeholder, i.e. the first user message has not landed yet. */
	readonly untitled: boolean;
	/** Creation time (ms). Ordering is by creation, so tabs never reshuffle under the user as they type. */
	readonly createdAt: number;
	/** Resource strings of the documents attached to this session (the @-mention / attach chips). */
	readonly attached: readonly string[];
}

/**
 * The default number of tabs the strip shows before the rest fold into the overflow menu. Three, not four:
 * the chat rail is ~300px wide, and a fourth tab left nothing legible per tab once the + and the overflow
 * chip took their room (caught in the live walk - the fourth tab clipped past the panel edge).
 */
export const VISIBLE_TAB_CAP = 3;

/** The longest a derived tab title gets before it is elided (the strip is narrow; a tab is a glance). */
const TITLE_MAX = 28;

/**
 * Shorten a user message into a tab title: one line, collapsed whitespace, trimmed of Markdown noise, and
 * elided at `TITLE_MAX`. Returns undefined for a message with no usable text, so the caller keeps its
 * placeholder rather than showing an empty tab.
 */
export function titleFromMessage(text: string): string | undefined {
	const oneLine = String(text ?? '').replace(/\s+/g, ' ').trim();
	// Strip leading Markdown decoration so "## Rewrite the intro" titles as "Rewrite the intro".
	const bare = oneLine.replace(/^[#>*\-\s]+/, '').trim();
	if (!bare.length) { return undefined; }
	return bare.length > TITLE_MAX ? `${bare.slice(0, TITLE_MAX - 1).trimEnd()}…` : bare;
}

/**
 * Create a session. `id` and `now` are injected (never generated here) so the model stays pure and a test
 * can pin both - the same reason the workflow scripts pass timestamps in rather than calling Date.now().
 */
export function createSession(id: string, now: number, placeholder: string): IChatSession {
	return { id, title: placeholder, untitled: true, createdAt: now, attached: [] };
}

/**
 * Give an untitled session its title from the first user message. A session that already carries a real
 * title is returned untouched, so a long conversation never renames itself out from under the user.
 */
export function titleSession(session: IChatSession, firstMessage: string): IChatSession {
	if (!session.untitled) { return session; }
	const title = titleFromMessage(firstMessage);
	return title ? { ...session, title, untitled: false } : session;
}

/** Attach a document to a session (idempotent - attaching twice is not an error and does not duplicate). */
export function attachToSession(session: IChatSession, resource: string): IChatSession {
	if (session.attached.includes(resource)) { return session; }
	return { ...session, attached: [...session.attached, resource] };
}

/** Detach a document from a session. Detaching something that is not attached is a no-op. */
export function detachFromSession(session: IChatSession, resource: string): IChatSession {
	if (!session.attached.includes(resource)) { return session; }
	return { ...session, attached: session.attached.filter(r => r !== resource) };
}

/**
 * Close `closeId` and pick the next active session. The neighbour rule matches every tabbed editor the user
 * already knows: closing the active tab activates the one to its right, or the one to its left when it was
 * last. Closing a NON-active tab never moves the user. Closing the final tab leaves no sessions and no
 * active id - the caller decides whether to open a fresh one (the rail does, so the strip is never empty).
 */
export function closeSession(sessions: readonly IChatSession[], activeId: string | undefined, closeId: string): { sessions: IChatSession[]; activeId: string | undefined } {
	const index = sessions.findIndex(s => s.id === closeId);
	if (index < 0) { return { sessions: [...sessions], activeId }; }
	const remaining = sessions.filter(s => s.id !== closeId);
	if (activeId !== closeId) { return { sessions: remaining, activeId }; }
	const next = remaining[index] ?? remaining[index - 1];
	return { sessions: remaining, activeId: next ? next.id : undefined };
}

/**
 * Split the strip into the tabs it shows and the ones that fold into the overflow menu (plan 52 WP-B's
 * "calm many-tab state"). The ACTIVE session is always visible - it is pulled into the visible run even when
 * its position would have buried it - because a strip that hides the conversation you are having is a strip
 * that lies about where you are.
 */
export function splitTabs(sessions: readonly IChatSession[], activeId: string | undefined, cap: number = VISIBLE_TAB_CAP): { visible: IChatSession[]; overflow: IChatSession[] } {
	if (cap <= 0) { return { visible: [], overflow: [...sessions] }; }
	if (sessions.length <= cap) { return { visible: [...sessions], overflow: [] }; }
	const visible = sessions.slice(0, cap);
	if (activeId && !visible.some(s => s.id === activeId)) {
		const active = sessions.find(s => s.id === activeId);
		// Evict the last visible tab to make room, so the active tab is always on screen and the cap holds.
		if (active) { visible[cap - 1] = active; }
	}
	const visibleIds = new Set(visible.map(s => s.id));
	return { visible, overflow: sessions.filter(s => !visibleIds.has(s.id)) };
}

/** The persisted shape (workspace storage). Versioned so a future change can migrate rather than guess. */
interface IPersistedSessions {
	readonly version: 1;
	readonly activeId?: string;
	readonly sessions: readonly IChatSession[];
}

/** Serialise the session list for workspace storage. Message bodies are NOT persisted here. */
export function serialiseSessions(sessions: readonly IChatSession[], activeId: string | undefined): string {
	const payload: IPersistedSessions = { version: 1, sessions, ...(activeId ? { activeId } : {}) };
	return JSON.stringify(payload);
}

/**
 * Read the persisted session list back. Degrades HONESTLY: unparseable JSON, a wrong version, a non-array,
 * or an entry missing its id/title yields an empty list rather than a throw or a half-built strip, so a
 * corrupt storage value costs the user their tab list, never their ability to open the app.
 */
export function deserialiseSessions(raw: string | undefined): { sessions: IChatSession[]; activeId: string | undefined } {
	const empty = { sessions: [], activeId: undefined };
	if (!raw) { return empty; }
	let parsed: unknown;
	try { parsed = JSON.parse(raw); } catch { return empty; }
	if (!parsed || typeof parsed !== 'object') { return empty; }
	const payload = parsed as Partial<IPersistedSessions>;
	if (payload.version !== 1 || !Array.isArray(payload.sessions)) { return empty; }
	const sessions: IChatSession[] = [];
	for (const entry of payload.sessions) {
		if (!entry || typeof entry !== 'object') { continue; }
		const s = entry as Partial<IChatSession>;
		if (typeof s.id !== 'string' || !s.id || typeof s.title !== 'string' || !s.title) { continue; }
		sessions.push({
			id: s.id,
			title: s.title,
			untitled: s.untitled === true,
			createdAt: typeof s.createdAt === 'number' ? s.createdAt : 0,
			attached: Array.isArray(s.attached) ? s.attached.filter((r): r is string => typeof r === 'string') : [],
		});
	}
	// An active id that no longer names a surviving session falls back to the first, so the rail always has
	// somewhere to be rather than rendering an empty body beside a populated strip.
	const activeId = sessions.some(s => s.id === payload.activeId) ? payload.activeId : sessions[0]?.id;
	return { sessions, activeId };
}

/**
 * The sessions whose attach set includes `resource` - the "chats mentioning this doc" reading that keeps the
 * old per-document history reachable after chat detached from the document (plan 52 WP-B acceptance).
 */
export function sessionsMentioning(sessions: readonly IChatSession[], resource: string): IChatSession[] {
	return sessions.filter(s => s.attached.includes(resource));
}
