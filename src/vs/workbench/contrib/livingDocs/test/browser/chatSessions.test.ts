/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { attachToSession, closeSession, createSession, deserialiseSessions, detachFromSession, IChatSession, MAX_VISIBLE_TABS, MIN_TAB_WIDTH, serialiseSessions, sessionsMentioning, splitTabs, titleFromMessage, titleSession, visibleTabCap, VISIBLE_TAB_CAP } from '../../common/chatSessions.js';

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
			// The default rail (~300px): two readable tabs and a "1 more" chip, never three unreadable ones.
			defaultRailThreeChats: cap(300, 3),
			defaultRailTwoChats: cap(300, 2),
			// A wide rail earns more tabs, up to the point where a strip stops being a glance.
			wideRail: cap(900, 8),
			// A rail too narrow for even one full-width tab still shows one - `splitTabs` makes it the active one.
			veryNarrow: cap(120, 4),
			// Nothing measured yet (before the first layout) falls back to the fixed count rather than to 1.
			unmeasured: cap(0, 4),
			noChats: cap(300, 0),
		}, {
			defaultRailThreeChats: 2,
			defaultRailTwoChats: 2,
			wideRail: MAX_VISIBLE_TABS,
			veryNarrow: 1,
			unmeasured: VISIBLE_TAB_CAP,
			noChats: 0,
		});
	});

	test('every tab the width-derived cap shows has room to be read, and the rest go to the overflow menu', () => {
		const many = Array.from({ length: 6 }, (_, i) => session(`s${i}`, i));
		const width = 300;
		const { visible, overflow } = splitTabs(many, 's4', visibleTabCap(width, many.length));
		assert.deepStrictEqual({
			visible: visible.map(s => s.id),
			overflow: overflow.map(s => s.id),
			// The room each visible tab gets, once the strip's padding, the "+" and the "N more" chip are paid for.
			roomPerTab: Math.floor((width - 16 - 30 - 62) / visible.length) >= MIN_TAB_WIDTH,
		}, {
			// The active tab is pulled into the visible run; the rest are reachable through the menu.
			visible: ['s0', 's4'],
			overflow: ['s1', 's2', 's3', 's5'],
			roomPerTab: true,
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
