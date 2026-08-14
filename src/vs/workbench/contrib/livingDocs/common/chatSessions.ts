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

import { localize } from '../../../../nls.js';
import { GraphemeIterator, isFullWidthCharacter } from '../../../../base/common/strings.js';

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
 * The number of tabs the strip shows when nobody has told us how wide the rail is (the first render, before
 * the pane has laid out). Once a real width is known, `visibleTabCap` below decides instead - a fixed count
 * is a guess, and this one guessed wrong: at three tabs in the default rail width the third collapsed to a
 * single letter and an ellipsis, which is a tab you cannot choose deliberately.
 */
export const VISIBLE_TAB_CAP = 3;

/**
 * The narrowest a chat tab may be drawn and still be CHOOSABLE: enough room for the first word or two of the
 * title plus its close box. This is the number the many-tab design turns on - rather than squeezing N tabs
 * into whatever space exists, the strip works out how many tabs of at least this width fit and folds the
 * rest into the overflow menu, where the whole derived title is readable rather than cut off by the strip.
 */
export const MIN_TAB_WIDTH = 96;

/**
 * The most tabs shown at any width. Past this a strip stops being a glance and becomes a list, and the
 * overflow menu - a vertical list with room for the whole derived title - is the better reading of "I have
 * a lot of chats". Note the derived title is itself capped at TITLE_MAX below: the menu shows all of THAT,
 * not all of the original prompt, which no surface ever promises.
 */
export const MAX_VISIBLE_TABS = 5;

/**
 * Room the strip's own furniture takes before any tab gets a pixel. Every one of these is real laid-out
 * chrome in `_renderChatTabs`, and the gap in particular used to be unbudgeted - which is how a strip that
 * promises tabs of at least `MIN_TAB_WIDTH` drew two 95px ones.
 */
const STRIP_PADDING = 16;
const TAB_GAP = 4;
/** The trailing "+", including the 4px margin that separates it from whatever precedes it. */
const NEW_CHAT_WIDTH = 34;

/**
 * How wide the bordered "N more ▾" chip really draws with `hidden` chats behind it.
 *
 * This used to be a single constant, 62. But the chip is laid out from its own TEXT, so it grows with the
 * number in it: measured in the running app, "4 more ▾" is 63.6px and "14 more ▾" is 69.2px. The tab beside it
 * takes the shortfall (`flex:1 1 0`), so from ten hidden chats on, a strip promising tabs of at least
 * `MIN_TAB_WIDTH` was drawing 91.3px ones. That is the same defect fix round 1 removed for the 4px flex gaps -
 * a budget written from what the layout was assumed to cost rather than from what it costs - and this is the
 * rest of it. Both numbers are measured and rounded UP, because a budget a pixel light is how this happens.
 *
 * The per-digit figure was 6 for one round and that was a pixel light (#312 fix round 3): measured at a
 * hundred hidden chats, "100 more ▾" really draws 76.6px against a budgeted 76. It did not produce an
 * under-minimum tab, but only because `NEW_CHAT_WIDTH` over-estimates the "+" by about 5.5px and absorbed the
 * error - a floor held up by another line item's slack is not held up by its own arithmetic. The real growth
 * measured across one to three digits is 13.0px, i.e. 6.5 a digit, so 7 is that rounded up the way the rest of
 * this budget is. `NEW_CHAT_WIDTH`'s slack is deliberately left alone: it is a margin, not a second bug.
 */
const OVERFLOW_BASE_WIDTH = 64;
const OVERFLOW_DIGIT_WIDTH = 7;
export function overflowWidth(hidden: number): number {
	const digits = String(Math.max(1, Math.floor(hidden))).length;
	return OVERFLOW_BASE_WIDTH + (digits - 1) * OVERFLOW_DIGIT_WIDTH;
}

/**
 * How many tabs fit in a strip `stripWidth` px wide, given how many chats there are. Pure arithmetic so the
 * rule is unit-tested rather than eyeballed in a running app:
 *
 * - every visible tab is at least `MIN_TAB_WIDTH` wide, so no tab is ever drawn as one letter + an ellipsis;
 * - the trailing "+" always keeps its room, so "new chat" never disappears at a narrow width;
 * - the "N more" chip is only paid for when something actually overflows, and is paid for at the width its
 *   own text really draws (`overflowWidth`), which grows once the hidden count reaches two digits;
 * - the 4px gap between every adjacent child is paid for too.
 *
 * **Zero is a real answer**, and it is the fix for the residual's own defect landing on the active tab: below
 * roughly 200px nothing can be drawn at `MIN_TAB_WIDTH`, and the previous `Math.max(1, ...)` floor handed the
 * one guaranteed-visible tab whatever was left - 32px at a 151px rail, which renders as a bare close box with
 * no title at all. Forcing a tab into a rail too narrow for one is the same defect the minimum exists to
 * prevent, so the strip stops pretending: at 0 the caller draws a chat PICKER instead of a strip (one
 * full-width control naming the chat you are in, opening a menu of all of them). See `_renderChatTabs`.
 */
export function visibleTabCap(stripWidth: number, sessionCount: number): number {
	if (sessionCount <= 0) { return 0; }
	// No measurement yet (the first render, or a hidden pane): fall back to the fixed count rather than
	// computing a cap of 1 from a width of 0 and flashing a one-tab strip before the first layout.
	if (!Number.isFinite(stripWidth) || stripWidth <= 0) { return Math.min(sessionCount, VISIBLE_TAB_CAP); }
	const room = stripWidth - STRIP_PADDING - NEW_CHAT_WIDTH;
	// What `n` tabs really cost: their own minimum widths, the gaps between them, and - only when `n` leaves
	// something behind - the overflow chip plus the gap before it.
	const costOf = (n: number) => n * MIN_TAB_WIDTH + (n - 1) * TAB_GAP + (n < sessionCount ? overflowWidth(sessionCount - n) + TAB_GAP : 0);
	let cap = 0;
	for (let n = 1; n <= Math.min(sessionCount, MAX_VISIBLE_TABS); n++) {
		if (costOf(n) > room) { break; }
		cap = n;
	}
	return cap;
}

/**
 * The longest a derived tab title gets before it is elided (the strip is narrow; a tab is a glance).
 *
 * Measured in DISPLAY COLUMNS, not UTF-16 code units. A full-width character - CJK, kana, the wide
 * punctuation that travels with them - is two columns wide on screen, so 28 of them are about twice the
 * strip room 28 Latin letters take. A cap counted in code units silently means two different things
 * depending on the language, which is not what a reader assumes a character limit means.
 */
const TITLE_MAX = 28;

/** How wide `text` draws, in columns: one per character, two for a full-width one. */
function columnWidth(text: string): number {
	let width = 0;
	const iterator = new GraphemeIterator(text);
	while (!iterator.eol()) {
		const start = iterator.offset;
		iterator.nextGraphemeLength();
		width += isFullWidthCharacter(text.charCodeAt(start)) ? 2 : 1;
	}
	return width;
}

/**
 * Cut `text` down to at most `columns`, never inside a character.
 *
 * A plain `slice` cuts by UTF-16 code unit, which splits a surrogate pair straight down the middle: an emoji
 * becomes a lone high surrogate that renders as a replacement glyph AND is written to workspace storage as
 * broken data, so it is not a pixel problem that ends at the tab. VS Code's own grapheme iterator walks whole
 * clusters, so an emoji, a skin-tone sequence or a combining accent is kept or dropped as one thing.
 */
function truncateColumns(text: string, columns: number): string {
	let width = 0;
	const iterator = new GraphemeIterator(text);
	while (!iterator.eol()) {
		const start = iterator.offset;
		iterator.nextGraphemeLength();
		width += isFullWidthCharacter(text.charCodeAt(start)) ? 2 : 1;
		// Cut BEFORE this cluster, never through it - `start` is a boundary the iterator found, not a guess.
		if (width > columns) { return text.slice(0, start); }
	}
	return text;
}

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
	if (columnWidth(bare) <= TITLE_MAX) { return bare; }
	// One column is kept back for the ellipsis, so an elided title never draws wider than the cap it names.
	return `${truncateColumns(bare, TITLE_MAX - 1).trimEnd()}…`;
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

/** What to ask before a chat is closed, or `needed: false` when there is nothing to lose by closing it. */
export interface ICloseChatConfirm {
	/** False when the chat holds no messages: an empty tab closes on the click, with no question asked. */
	readonly needed: boolean;
	/** The question, naming the chat by its title - which is the whole point when the route is a menu. */
	readonly message: string;
	/** One complete sentence saying what goes and that it does not come back. */
	readonly detail: string;
	/** The confirming button's label, so the destructive choice is named rather than being a bare "OK". */
	readonly primaryButton: string;
}

/**
 * The question to ask before closing a chat (#312 fix round 3).
 *
 * Closing a chat deletes its conversation from workspace storage the moment it happens - there is no undo
 * anywhere in the app, and the transcript is gone from disk, not just from the strip. Until this round that
 * was instant and silent from every route, and fix round 2's own work is what made it reachable: the "Close
 * Chat" submenu is a vertical list of similar titles, where a mis-aimed click costs a whole conversation, and
 * the palette entry made the SOLE chat closable for the first time (before it, the tab had no × and there was
 * no command, so the only conversation in a workspace simply could not be destroyed).
 *
 * So the rule is: **a chat that holds messages is never closed without being named first.** Naming it is what
 * turns a mis-aim into a mis-aim rather than a loss - the reader sees which title they actually hit, and how
 * much of it is about to go. An EMPTY chat asks nothing, because there is nothing to lose and a question there
 * would be the confirm-fatigue that teaches people to click through the ones that matter.
 *
 * The sole chat gets its own detail sentence because its outcome genuinely differs: the strip is never empty,
 * so closing the only chat opens a fresh one in its place. Without that sentence "close" reads as "the rail
 * goes away", and what really happens - your conversation is deleted and replaced by an empty one - is exactly
 * the surprise this guard exists to prevent.
 *
 * Pure, so every sentence is unit-tested rather than read off a screenshot, and the caller (the Close Chat
 * command, which every route now runs) only has to show it.
 */
export function closeChatConfirm(title: string, messageCount: number, sole: boolean): ICloseChatConfirm {
	const held = Math.max(0, Math.floor(messageCount));
	if (!held) { return { needed: false, message: '', detail: '', primaryButton: '' }; }
	const detail = sole
		? (held === 1
			? localize('livingDocs.chat.close.detailSoleOne', "This is your only chat, so an empty one opens in its place. Its 1 message is deleted from this workspace and cannot be brought back.")
			: localize('livingDocs.chat.close.detailSoleMany', "This is your only chat, so an empty one opens in its place. Its {0} messages are deleted from this workspace and cannot be brought back.", held))
		: (held === 1
			? localize('livingDocs.chat.close.detailOne', "Its 1 message is deleted from this workspace and cannot be brought back.")
			: localize('livingDocs.chat.close.detailMany', "Its {0} messages are deleted from this workspace and cannot be brought back.", held));
	return {
		needed: true,
		message: localize('livingDocs.chat.close.message', "Close the chat \"{0}\"?", title),
		detail,
		primaryButton: localize('livingDocs.chat.close.button', "Close Chat"),
	};
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
