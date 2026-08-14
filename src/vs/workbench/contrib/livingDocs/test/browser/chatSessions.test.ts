/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { attachToSession, closeSession, createSession, deserialiseSessions, detachFromSession, IChatSession, MAX_VISIBLE_TABS, MIN_TAB_WIDTH, overflowWidth, serialiseSessions, sessionsMentioning, splitTabs, titleFromMessage, titleSession, visibleTabCap, VISIBLE_TAB_CAP } from '../../common/chatSessions.js';

suite('livingDocs - workspace chat sessions (plan 52 WP-B)', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	const NEW = 'New chat';
	const session = (id: string, at: number) => createSession(id, at, NEW);

	test('a session is born untitled and takes its title, once, from the first user message', () => {
		const fresh = session('s1', 1000);
		const titled = titleSession(fresh, '## Rewrite the intro paragraph');
		// A second message must NOT rename a conversation the user has already read as a topic.
		const renamed = titleSession(titled, 'and also fix the table');
		assert.deepStrictEqual({
			fresh: { title: fresh.title, untitled: fresh.untitled, attached: fresh.attached },
			titled: { title: titled.title, untitled: titled.untitled },
			renamed: titled.title === renamed.title,
		}, {
			fresh: { title: NEW, untitled: true, attached: [] },
			// Markdown decoration stripped; the tab reads as the topic.
			titled: { title: 'Rewrite the intro paragraph', untitled: false },
			renamed: true,
		});
	});

	test('titleFromMessage collapses whitespace, elides long text, and refuses to title an empty message', () => {
		assert.deepStrictEqual({
			multiline: titleFromMessage('  Tighten   the\nsummary  '),
			long: titleFromMessage('Please rewrite the entire commentary section so that it reads far more concisely'),
			blank: titleFromMessage('   \n  '),
			decorationOnly: titleFromMessage('###   '),
		}, {
			multiline: 'Tighten the summary',
			long: 'Please rewrite the entire c…',
			// Nothing usable -> undefined, so the caller keeps its placeholder rather than an empty tab.
			blank: undefined,
			decorationOnly: undefined,
		});
	});

	test('a title is cut between characters and measured in the columns it draws, never in code units', () => {
		// Two pre-existing defects the residuals surfaced (#312 fix round 1). The first is broken DATA, not a
		// broken pixel: a plain `slice` cut a surrogate pair in half, so a lone high surrogate reached the tab
		// AND the workspace-storage record. The second is a cap that quietly means two different things - 28
		// CJK characters draw about twice as wide as 28 Latin ones, so counting code units makes the strip's own
		// promise depend on the language you write in.
		const emoji = titleFromMessage('🎉'.repeat(40)) ?? '';
		const cjk = titleFromMessage('文'.repeat(30)) ?? '';
		// 'e' plus a COMBINING acute: two code points that draw as one letter, kept or dropped together.
		const accented = titleFromMessage('e\u0301'.repeat(40)) ?? '';
		// Iterating by code point pairs surrogates up, so a HALF of a pair is the only one left standing alone.
		const lone = (s: string) => [...s].some(c => c.length === 1 && c.charCodeAt(0) >= 0xD800 && c.charCodeAt(0) <= 0xDFFF);
		assert.deepStrictEqual({
			emoji, emojiLoneSurrogate: lone(emoji),
			cjkChars: [...cjk].length, cjkLoneSurrogate: lone(cjk),
			// A combining accent belongs to the letter in front of it and must never be orphaned onto the ellipsis.
			accentedEndsWhole: accented.endsWith('e\u0301…'),
		}, {
			// 27 whole emoji plus the ellipsis - never 27 and a half, and never a lone high surrogate.
			emoji: `${'🎉'.repeat(27)}…`, emojiLoneSurrogate: false,
			// 13 double-width characters plus the ellipsis is 27 columns: the same room the Latin cap gets, and
			// half the number of characters, because that is what the same amount of strip actually holds.
			cjkChars: 14, cjkLoneSurrogate: false,
			accentedEndsWhole: true,
		});
	});

	test('attach is idempotent and detach is forgiving, so two sessions hold different attach sets', () => {
		const a = attachToSession(attachToSession(session('a', 1), 'file:///ws/A.md'), 'file:///ws/A.md');
		const b = attachToSession(session('b', 2), 'file:///ws/B.md');
		const detached = detachFromSession(detachFromSession(b, 'file:///ws/Nope.md'), 'file:///ws/B.md');
		assert.deepStrictEqual({
			a: a.attached,
			b: b.attached,
			detached: detached.attached,
		}, {
			a: ['file:///ws/A.md'],
			b: ['file:///ws/B.md'],
			detached: [],
		});
	});

	test('closing the active tab activates its right neighbour, or its left when it was last', () => {
		const list = [session('a', 1), session('b', 2), session('c', 3)];
		const middle = closeSession(list, 'b', 'b');
		const last = closeSession(list, 'c', 'c');
		const inactive = closeSession(list, 'a', 'c');
		const only = closeSession([session('solo', 1)], 'solo', 'solo');
		assert.deepStrictEqual({
			middle: { ids: middle.sessions.map(s => s.id), active: middle.activeId },
			last: { ids: last.sessions.map(s => s.id), active: last.activeId },
			inactive: { ids: inactive.sessions.map(s => s.id), active: inactive.activeId },
			only: { ids: only.sessions.map(s => s.id), active: only.activeId },
		}, {
			middle: { ids: ['a', 'c'], active: 'c' },
			last: { ids: ['a', 'b'], active: 'b' },
			// Closing a tab the user is not in must never move them.
			inactive: { ids: ['a', 'b'], active: 'a' },
			only: { ids: [], active: undefined },
		});
	});

	test('the strip caps visible tabs and always keeps the active one on screen', () => {
		const many = Array.from({ length: VISIBLE_TAB_CAP + 3 }, (_, i) => session(`s${i}`, i));
		const early = splitTabs(many, 's0');
		// 's6' would sit well past the cap; it must be pulled into view rather than hidden behind overflow.
		const buried = splitTabs(many, `s${VISIBLE_TAB_CAP + 2}`);
		const activeId = `s${VISIBLE_TAB_CAP + 2}`;
		assert.deepStrictEqual({
			earlyVisibleCount: early.visible.length,
			earlyVisible: early.visible.map(s => s.id),
			earlyOverflow: early.overflow.map(s => s.id),
			// The buried active tab evicts the LAST visible slot, so the cap still holds exactly.
			buriedVisible: buried.visible.map(s => s.id),
			buriedHoldsActive: buried.visible.some(s => s.id === activeId),
			buriedOverflowExcludesActive: buried.overflow.every(s => s.id !== activeId),
			underCap: splitTabs([session('x', 1)], 'x').overflow.length,
		}, {
			earlyVisibleCount: VISIBLE_TAB_CAP,
			earlyVisible: many.slice(0, VISIBLE_TAB_CAP).map(s => s.id),
			earlyOverflow: many.slice(VISIBLE_TAB_CAP).map(s => s.id),
			buriedVisible: [...many.slice(0, VISIBLE_TAB_CAP - 1).map(s => s.id), activeId],
			buriedHoldsActive: true,
			buriedOverflowExcludesActive: true,
			underCap: 0,
		});
	});

	test('how many tabs the strip shows is derived from its real width, so no tab is ever unchoosable', () => {
		// The residual this rule exists to fix (#312): a fixed cap of three squeezed the third tab in the default
		// rail down to one letter and an ellipsis. A tab is only shown if it can be at least MIN_TAB_WIDTH wide.
		const cap = (width: number, count: number) => visibleTabCap(width, count);
		assert.deepStrictEqual({
			// The default rail (~300px): ONE readable tab and a "2 more" chip. Two tabs would be 88px each once
			// the padding, the "+", the chip and the gaps between them are paid for - under the minimum, which
			// is the whole defect. The gaps used to go unbudgeted, so the rule quietly broke its own promise.
			defaultRailThreeChats: cap(300, 3),
			// Two chats need no overflow chip at all, so the same 300px comfortably holds both.
			defaultRailTwoChats: cap(300, 2),
			// A wide rail earns more tabs, up to the point where a strip stops being a glance.
			wideRail: cap(900, 8),
			// A single chat needs no chip either, so it keeps its tab far further down than a crowded rail does.
			narrowSoleChat: cap(151, 1),
			// Below 212px a crowded rail fits nothing at MIN_TAB_WIDTH, so the answer is ZERO and the rail draws
			// a chat picker. The old floor of one handed the active tab 32px at 151px: a bare close box, no title.
			tooNarrowForAnyTab: cap(151, 4),
			tooNarrowBoundary: cap(213, 4),
			justWideEnough: cap(214, 4),
			// Nothing measured yet (before the first layout) falls back to the fixed count rather than to 1.
			unmeasured: cap(0, 4),
			noChats: cap(300, 0),
		}, {
			defaultRailThreeChats: 1,
			defaultRailTwoChats: 2,
			wideRail: MAX_VISIBLE_TABS,
			narrowSoleChat: 1,
			tooNarrowForAnyTab: 0,
			tooNarrowBoundary: 0,
			justWideEnough: 1,
			unmeasured: VISIBLE_TAB_CAP,
			noChats: 0,
		});
	});

	test('every tab the width-derived cap shows has room to be read, and the rest go to the overflow menu', () => {
		const many = Array.from({ length: 6 }, (_, i) => session(`s${i}`, i));
		const width = 460;
		const { visible, overflow } = splitTabs(many, 's4', visibleTabCap(width, many.length));
		assert.deepStrictEqual({
			visible: visible.map(s => s.id),
			overflow: overflow.map(s => s.id),
			// The room each visible tab really gets, once the strip's padding, the "+" (and its margin), the
			// "N more" chip and every 4px gap between them are paid for. This is the sum that used to be short.
			roomPerTab: Math.floor((width - 16 - 34 - overflowWidth(overflow.length) - visible.length * 4) / visible.length) >= MIN_TAB_WIDTH,
		}, {
			// The active tab is pulled into the visible run; the rest are reachable through the menu.
			visible: ['s0', 's1', 's4'],
			overflow: ['s2', 's3', 's5'],
			roomPerTab: true,
		});
	});

	test('the "N more" chip is budgeted from its own text, so a two-digit count cannot squeeze the tabs', () => {
		// #312 fix round 2 (V3): the chip's width was one flat constant, 62, but it is laid out from its own TEXT.
		// Measured in the running app, "4 more ▾" draws 63.6px and "14 more ▾" draws 69.2px - so past ten hidden
		// chats the tab beside it absorbed the shortfall and a strip promising 96px tabs drew 91.3px ones. Same
		// class as the unbudgeted flex gaps of round 1: a budget written from an assumed cost, not a real one.
		//
		// Swept rather than sampled, because the defect only appears at widths where the chip is being paid for.
		const roomPerTab = (width: number, count: number) => {
			const cap = visibleTabCap(width, count);
			// Zero is the picker, which draws no tabs at all and so cannot draw an unreadable one.
			if (!cap) { return Number.POSITIVE_INFINITY; }
			const hidden = count - cap;
			return (width - 16 - 34 - (hidden ? overflowWidth(hidden) + 4 : 0) - (cap - 1) * 4) / cap;
		};
		let narrowest = Number.POSITIVE_INFINITY;
		for (let count = 1; count <= 15; count++) {
			for (let width = 120; width <= 900; width++) { narrowest = Math.min(narrowest, roomPerTab(width, count)); }
		}
		assert.deepStrictEqual({
			budgetCoversFourMore: overflowWidth(4) >= 63.6,
			budgetCoversFourteenMore: overflowWidth(14) >= 69.2,
			// The whole point, swept over every width and chat count a rail can hold: no tab is ever drawn under
			// the minimum the strip promises.
			everyTabClearsTheMinimum: narrowest >= MIN_TAB_WIDTH,
			// The width the 91.3px tab was measured at, with the same 15 chats: too narrow for a tab now, so the
			// picker takes the strip instead of a tab that breaks its own rule.
			fifteenChatsAt216: visibleTabCap(216, 15),
		}, {
			budgetCoversFourMore: true,
			budgetCoversFourteenMore: true,
			everyTabClearsTheMinimum: true,
			fifteenChatsAt216: 0,
		});
	});

	test('sessions round-trip through workspace storage, keeping titles, attach sets and the active tab', () => {
		const list = [
			titleSession(attachToSession(session('a', 10), 'file:///ws/A.md'), 'Tighten the summary'),
			session('b', 20),
		];
		const restored = deserialiseSessions(serialiseSessions(list, 'b'));
		assert.deepStrictEqual({
			ids: restored.sessions.map(s => s.id),
			titles: restored.sessions.map(s => s.title),
			untitled: restored.sessions.map(s => s.untitled),
			attached: restored.sessions.map(s => s.attached),
			active: restored.activeId,
		}, {
			ids: ['a', 'b'],
			titles: ['Tighten the summary', NEW],
			untitled: [false, true],
			attached: [['file:///ws/A.md'], []],
			active: 'b',
		});
	});

	test('a corrupt or stale stored value degrades honestly - never a throw, never a half-built strip', () => {
		const droppedEntry = deserialiseSessions(JSON.stringify({
			version: 1,
			activeId: 'ghost',
			sessions: [{ id: 'good', title: 'Kept' }, { title: 'no id' }, null, { id: 'x' }],
		}));
		assert.deepStrictEqual({
			missing: deserialiseSessions(undefined).sessions,
			garbage: deserialiseSessions('{not json').sessions,
			wrongVersion: deserialiseSessions(JSON.stringify({ version: 99, sessions: [{ id: 'a', title: 'A' }] })).sessions,
			notAnArray: deserialiseSessions(JSON.stringify({ version: 1, sessions: 'nope' })).sessions,
			keptIds: droppedEntry.sessions.map((s: IChatSession) => s.id),
			// An active id naming a session that did not survive falls back to the first, never to nothing.
			fallbackActive: droppedEntry.activeId,
		}, {
			missing: [],
			garbage: [],
			wrongVersion: [],
			notAnArray: [],
			keptIds: ['good'],
			fallbackActive: 'good',
		});
	});

	test('"chats mentioning this doc" finds every session that attached the document, keeping old history reachable', () => {
		const list = [
			attachToSession(session('a', 1), 'file:///ws/Weekly.md'),
			session('b', 2),
			attachToSession(attachToSession(session('c', 3), 'file:///ws/Board.md'), 'file:///ws/Weekly.md'),
		];
		assert.deepStrictEqual({
			weekly: sessionsMentioning(list, 'file:///ws/Weekly.md').map(s => s.id),
			board: sessionsMentioning(list, 'file:///ws/Board.md').map(s => s.id),
			none: sessionsMentioning(list, 'file:///ws/Nope.md').map(s => s.id),
		}, {
			weekly: ['a', 'c'],
			board: ['c'],
			none: [],
		});
	});
});
