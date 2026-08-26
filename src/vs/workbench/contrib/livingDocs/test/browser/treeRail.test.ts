/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ITreeNode } from '../../../../../base/browser/ui/tree/tree.js';
import { DisposableStore, IDisposable } from '../../../../../base/common/lifecycle.js';
import { URI } from '../../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { ILivingDoc } from '../../common/livingDocsModel.js';
import { TreeRailFolderRenderer, TreeRailLeafRenderer } from '../../browser/treeRailFilesTree.js';
import { ClickGestureGuard, GestureScheduler } from '../../common/clickGesture.js';
import { ASSETS_FOLDER_ID, buildFileTree, ITreeRailItem, buildOutline, buildRecentDocItems, buildTreeRailNodes, buildWorkspaceSourceNodes, classifyWorkspaceExtra, collectAssetsFolderIds, filterTreeRailNodes, isAssetName, isMissingSource, ITreeRailFolderNode, ITreeRailLeafNode, ITreeRailNode, RECENT_STRIP_CAP, RECENT_STRIP_MIN, searchTreeRail, sourceKindGlyph, sourceMeta, touchRecentDoc } from '../../common/treeRail.js';

// Compact projection of a node tree for snapshot-style assertions: folders show label + children, leaves
// show label + kind. Ids are checked separately where they matter (persistence + identity).
function project(nodes: readonly ITreeRailNode[]): unknown {
	return nodes.map(n => n.type === 'folder'
		? { folder: n.label, children: project(n.children) }
		: { leaf: n.item.label, kind: n.item.kind });
}

const WEEKLY = URI.file('/ws/Weekly Summary.md');
const BOARD = URI.file('/ws/Board Note.md');

function doc(title: string, headings: readonly { text: string; level: number }[], body: string): ILivingDoc {
	const blocks = headings.map((h, i) => ({ id: `h${i}`, type: 'heading' as const, text: h.text, level: h.level, binds: [] }));
	return { title, subtitle: '', sources: ['metrics.csv'], context: [], blocks, isLiving: true, body };
}

suite('treeRail', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('buildFileTree returns root documents and sources separately - no synthetic "Reports" wrapper (plan 52 WP-D)', () => {
		const tree = buildFileTree([
			{ title: 'Weekly Summary', resource: WEEKLY, pendingCount: 1, sources: ['metrics.csv', 'crm.api'] },
			{ title: 'Board Note', resource: BOARD, pendingCount: 0, sources: ['metrics.csv'] },
		]);
		const project = (items: readonly ITreeRailItem[]) => items.map(i => ({ label: i.label, kind: i.kind, pending: i.pending }));
		// Root documents sorted by title (pending = pendingCount > 0); sources deduped + sorted, and no longer
		// pre-grouped - placement is the caller's call now.
		assert.deepStrictEqual({
			items: project(tree.items),
			folders: tree.folders,
			sources: project(tree.sources),
			unsupported: project(tree.unsupported),
		}, {
			items: [
				{ label: 'Board Note', kind: 'doc', pending: false },
				{ label: 'Weekly Summary', kind: 'doc', pending: true },
			],
			folders: [],
			sources: [
				{ label: 'crm.api', kind: 'source', pending: false },
				{ label: 'metrics.csv', kind: 'source', pending: false },
			],
			unsupported: [],
		});
	});

	test('buildFileTree computes each row\'s status dot: doc precedence (grey/green/yellow/red) + grey source/unsupported dashes (livingDocs #212)', () => {
		const tree = buildFileTree([
			{ title: 'Calm', resource: URI.file('/ws/Calm.md'), pendingCount: 0, sources: ['metrics.csv'] },
			{ title: 'Applied', resource: URI.file('/ws/Applied.md'), pendingCount: 0, sources: [], unseenAgentEdits: 2 },
			{ title: 'Pending', resource: URI.file('/ws/Pending.md'), pendingCount: 3, sources: [] },
			{ title: 'Needs input', resource: URI.file('/ws/Needs.md'), pendingCount: 1, sources: [], stale: true },
		], ['legacy.doc']);
		const dots = (items: readonly ITreeRailItem[]) => items.map(i => ({ label: i.label, kind: i.kind, shape: i.dot.shape, color: i.dot.color }));
		assert.deepStrictEqual({
			items: dots(tree.items),
			sources: dots(tree.sources),
			unsupported: dots(tree.unsupported),
		}, {
			items: [
				{ label: 'Applied', kind: 'doc', shape: 'dot', color: 'green' },
				{ label: 'Calm', kind: 'doc', shape: 'dot', color: 'grey' },
				{ label: 'Needs input', kind: 'doc', shape: 'dot', color: 'red' },
				{ label: 'Pending', kind: 'doc', shape: 'dot', color: 'yellow' },
			],
			sources: [{ label: 'metrics.csv', kind: 'source', shape: 'dash', color: 'grey' }],
			unsupported: [{ label: 'legacy.doc', kind: 'unsupported', shape: 'dash', color: 'grey' }],
		});
	});

	test('TreeRailLeafRenderer emits the LWD chip or the pending pill from the REAL render path, never both (P5.3)', () => {
		// The criterion is about what the row RENDERS, so this drives the real `TreeRailLeafRenderer.renderElement`
		// (not an in-test re-derivation of showsChip/showsPill) over leaf nodes built by the real data pipeline, and
		// reads the emitted DOM. Precedence (pending wins) then holds by the renderer itself, not by restating it here.
		const disposables = new DisposableStore();
		const store = disposables.add(new DisposableStore());
		// A no-op actions host: the renderer only needs a hover disposable + a per-row action store back from these.
		const renderer = new TreeRailLeafRenderer({
			renderLeafActions: () => disposables.add(new DisposableStore()),
			setupHover: (): IDisposable => ({ dispose: () => { } }),
			renderRenameInput: () => undefined,
		});

		// Real leaf nodes from the real builders: a living doc (chip), a living doc with pending approvals (pill
		// wins), a plain doc (neither) from the file tree, plus a bound source from the Context tab's workspace
		// sources (a non-doc leaf never carries a doc marker) - the renderer draws rows from both surfaces.
		const docInputs = [
			{ title: 'Live', resource: URI.file('/ws/Live.md'), pendingCount: 0, sources: ['metrics.csv'], isLiving: true },
			{ title: 'Pending', resource: URI.file('/ws/Pending.md'), pendingCount: 2, sources: ['metrics.csv'], isLiving: true },
			{ title: 'Plain', resource: URI.file('/ws/Plain.md'), pendingCount: 0, sources: [], isLiving: false },
		];
		const nodes = [...buildTreeRailNodes(docInputs), ...buildWorkspaceSourceNodes(docInputs)];
		const leaves = new Map<string, ITreeRailLeafNode>();
		const collect = (n: ITreeRailNode): void => n.type === 'leaf' ? void leaves.set(n.item.label, n) : n.children.forEach(collect);
		nodes.forEach(collect);

		// Render each leaf through the real template + renderElement, then read the emitted markers off the DOM.
		const render = (label: string): { hasChip: boolean; hasPill: boolean; pillText: string | null } => {
			const container = document.createElement('div');
			const template = renderer.renderTemplate(container);
			store.add({ dispose: () => renderer.disposeTemplate(template) });
			const leaf = leaves.get(label)!;
			const node: ITreeNode<ITreeRailLeafNode, void> = {
				element: leaf, children: [], depth: 1, visibleChildrenCount: 0, visibleChildIndex: 0,
				collapsible: false, collapsed: false, visible: true, filterData: undefined,
			};
			renderer.renderElement(node, 0, template);
			const pill = container.querySelector('.rail-tree-pending');
			return { hasChip: !!container.querySelector('.rail-tree-lwd'), hasPill: !!pill, pillText: pill?.textContent ?? null };
		};

		assert.deepStrictEqual(
			{ live: render('Live'), pending: render('Pending'), plain: render('Plain'), source: render('metrics.csv') },
			{
				live: { hasChip: true, hasPill: false, pillText: null },      // living, no pending -> chip only
				pending: { hasChip: false, hasPill: true, pillText: '2' },    // pending wins -> pill only, count 2, no chip
				plain: { hasChip: false, hasPill: false, pillText: null },    // plain doc -> neither marker
				source: { hasChip: false, hasPill: false, pillText: null },   // a source leaf never carries a doc marker
			},
		);
		disposables.dispose();
	});

	test('TreeRailFolderRenderer gives a folder row a chevron + folder glyph, and points the chevron at the collapse state (issue #363)', () => {
		// A user's own top-level directory must read as a directory, never as an app-made section (the founder
		// read `outputs/` as redundant app furniture). This drives the REAL folder renderer over a folder node
		// from the real builder, and reads the emitted DOM - both affordances, and the chevron's collapsed
		// class, which the rail CSS turns into the quarter-turn rotation.
		const renderer = new TreeRailFolderRenderer();
		const folder = buildTreeRailNodes([
			{ title: 'Q3', resource: URI.file('/ws/outputs/Q3.md'), pendingCount: 0, sources: [], folder: 'outputs' },
		]).find((n): n is ITreeRailFolderNode => n.type === 'folder')!;

		const render = (collapsed: boolean): { label: string; chevron: boolean; glyph: boolean; chevronCollapsed: boolean; twistieEmptied: boolean } => {
			const container = document.createElement('div');
			const template = renderer.renderTemplate(container);
			const twistie = document.createElement('div');
			const twistieRendered = renderer.renderTwistie(folder, twistie);
			const node: ITreeNode<ITreeRailFolderNode, void> = {
				element: folder, children: [], depth: 1, visibleChildrenCount: 1, visibleChildIndex: 0,
				collapsible: true, collapsed, visible: true, filterData: undefined,
			};
			renderer.renderElement(node, 0, template);
			const chevron = container.querySelector('.rail-tree-folder-chevron');
			renderer.disposeTemplate(template);
			return {
				label: container.querySelector('.rail-tree-folder-label')?.textContent ?? '',
				chevron: !!chevron?.classList.contains('codicon-chevron-down'),
				glyph: !!container.querySelector('.rail-tree-folder-glyph')?.classList.contains('codicon-folder'),
				chevronCollapsed: !!chevron?.classList.contains('rail-tree-folder-chevron-collapsed'),
				// The row owns the chevron, so the widget's own twistie is emptied - never two chevrons on a row.
				twistieEmptied: twistieRendered && twistie.classList.contains('rail-tree-twistie-empty'),
			};
		};

		assert.deepStrictEqual(
			{ expanded: render(false), collapsed: render(true) },
			{
				expanded: { label: 'outputs', chevron: true, glyph: true, chevronCollapsed: false, twistieEmptied: true },
				collapsed: { label: 'outputs', chevron: true, glyph: true, chevronCollapsed: true, twistieEmptied: true },
			});
	});

	test('sourceKindGlyph maps a source to its mono kind glyph: data/table, transcript/note, reference (P5.6)', () => {
		assert.deepStrictEqual(
			['metrics.csv', 'data.xlsx', 'config.json', 'board-transcript.md', 'notes.txt', 'ref.pdf', 'diagram.svg'].map(sourceKindGlyph),
			// allow-any-unicode-next-line
			['⊞', '⊞', '⊞', '◍', '◍', '◇', '◇'],
		);
	});

	test('buildRecentDocItems returns the MRU strip rows - capped, de-duplicated, foreign history entries dropped - and the tree carries no Recent group at all (livingDocs #212, plan 52 WP-D2)', () => {
		const docInputs = ['A', 'B', 'C', 'D', 'E', 'F'].map(t => ({ title: t, resource: URI.file(`/ws/${t}.md`), pendingCount: 0, sources: [] }));
		// Seven MRU entries newest-first: one repeat (F), one document from a folder that is not open (/other/X.md),
		// and more than the cap. The strip keeps MRU order, drops the repeat and the foreigner, and stops at the cap.
		const recent = [...['F', 'E', 'F', 'D', 'C', 'B'].map(t => URI.file(`/ws/${t}.md`)), URI.file('/other/X.md'), URI.file('/ws/A.md')];
		assert.deepStrictEqual(
			{
				cap: RECENT_STRIP_CAP,
				min: RECENT_STRIP_MIN,
				strip: buildRecentDocItems(docInputs, recent).map(i => i.label),
				// Two entries is where a jump-list starts being one: it needs somewhere to jump BACK to.
				pair: buildRecentDocItems(docInputs, [URI.file('/ws/A.md'), URI.file('/ws/B.md')]).map(i => i.label),
				// A single recent can only be the document you are already in - the active tab, the highlighted tree
				// row and the strip's own active marker all say it first - so the strip stays away (fix round 1, R-2).
				single: buildRecentDocItems(docInputs, [URI.file('/ws/A.md')]).map(i => i.label),
				none: buildRecentDocItems(docInputs, []).map(i => i.label),
				// Nothing recent-shaped is left in the file tree - the whole point of D2.
				treeHasNoRecentGroup: buildTreeRailNodes(docInputs).some(n => n.type === 'folder' && /recent/i.test(n.label)),
			},
			{ cap: 5, min: 2, strip: ['F', 'E', 'D', 'C', 'B'], pair: ['A', 'B'], single: [], none: [], treeHasNoRecentGroup: false },
		);
	});

	test('touchRecentDoc builds the MRU from documents OPENED, so a single-click preview journey fills the strip (plan 52 WP-D2, fix round 1 R-2)', () => {
		const A = URI.file('/ws/A.md');
		const B = URI.file('/ws/B.md');
		const C = URI.file('/ws/C.md');
		const docInputs = ['A', 'B', 'C'].map(t => ({ title: t, resource: URI.file(`/ws/${t}.md`), pendingCount: 0, sources: [] }));
		// The journey that used to leave the strip stuck at one row: three single clicks, each opening a PREVIEW
		// tab that replaces (and disposes) the last one. Reading surviving editors gave one entry every time;
		// remembering what was OPENED gives a real MRU, newest first.
		let mru: readonly URI[] = [];
		for (const opened of [A, B, C]) { mru = touchRecentDoc(mru, opened); }
		// Re-opening a document already in the list moves it to the front rather than duplicating it.
		const revisited = touchRecentDoc(mru, A);
		assert.deepStrictEqual(
			{
				afterThreeSingleClicks: mru.map(r => r.path),
				revisited: revisited.map(r => r.path),
				strip: buildRecentDocItems(docInputs, revisited).map(i => i.label),
				// The memory is bounded: an unbounded list would grow for the whole session.
				bounded: [A, B, C, A, B].reduce<readonly URI[]>((acc, r) => touchRecentDoc(acc, r, 2), []).map(r => r.path),
			},
			{
				afterThreeSingleClicks: ['/ws/C.md', '/ws/B.md', '/ws/A.md'],
				revisited: ['/ws/A.md', '/ws/C.md', '/ws/B.md'],
				strip: ['A', 'C', 'B'],
				bounded: ['/ws/B.md', '/ws/A.md'],
			},
		);
	});

	test('sourceMeta puts a bound source that is gone from disk in the STALE family, never "synced" (fix round 1, C-2)', () => {
		// The phantom the app's own `Delete…` leaves: it removes the file but not the `sources:` frontmatter that
		// names it, so the row survives. It used to read "synced" - asserted purely from a path having been
		// computed - while the delete dialog had just promised dependents would be "flagged as stale".
		const present = new Set(['metrics.csv', 'notes.txt']);
		const nodes = buildWorkspaceSourceNodes(
			[{ title: 'Weekly Summary', resource: WEEKLY, pendingCount: 0, sources: ['metrics.csv', 'chart.png'] }],
			[],
			new Map([['metrics.csv', 'fresh' as const], ['chart.png', 'missing' as const]]),
		);
		assert.deepStrictEqual(
			{
				rows: nodes.map(n => n.type === 'leaf' ? { leaf: n.item.label, meta: sourceMeta(n.item) } : { folder: n.label }),
				// The existence test is conservative in both directions: it compares basenames (frontmatter may
				// write a path), and it stays silent about a file the extras scan would never have listed anyway.
				deletedImage: isMissingSource('chart.png', present),
				unknownFormatNeverAccused: isMissingSource('warehouse.parquet', present),
			},
			{
				rows: [
					// allow-any-unicode-next-line
					{ leaf: 'chart.png', meta: { text: 'stale · missing', tone: 'stale' } },
					{ leaf: 'metrics.csv', meta: { text: 'synced', tone: 'synced' } },
				],
				deletedImage: true,
				unknownFormatNeverAccused: false,
			},
		);
	});

	test('isMissingSource never accuses a source that is not meant to be a local file, or one the folder scan cannot answer for (fix round 2, C-2b)', () => {
		// `presentFiles` is the workspace-extras scan: BASENAMES, from a walk bounded at four directory levels
		// that skips dot-directories, `out/` and `node_modules/`. Every case below is a source that is absent
		// from that set for a reason other than having been deleted - the set simply cannot see it.
		const present = new Set(['metrics.csv', 'notes.txt']);
		assert.deepStrictEqual(
			{
				// The real target: a plain filename beside a document, of a kind the scan collects, that the scan
				// did not see. This is the phantom the app's own `Delete…` leaves behind.
				deletedNeighbour: isMissingSource('chart.png', present),
				stillOnDisk: isMissingSource('metrics.csv', present),
				// A remote feed is an `api` source with NO local file by design. Reading the tail of its URL as a
				// filename accused every remote source whose URL ends in a data extension of having been deleted.
				remoteFeed: isMissingSource('https://example.com/live/data.csv', present),
				remoteFeedNoExtension: isMissingSource('https://example.com/live', present),
				// A source written as a path cannot be judged against a set of basenames: these three directories
				// are never walked, so "absent" means "not scanned", not "not there".
				underOut: isMissingSource('out/build-report.json', present),
				underNodeModules: isMissingSource('node_modules/pkg/data.csv', present),
				deeperThanTheScanWalks: isMissingSource('a/b/c/d/e/deep.csv', present),
				pathWrittenSource: isMissingSource('data/chart.png', present),
				windowsPathWrittenSource: isMissingSource('data\\chart.png', present),
				// A file type the scan never collects is absent for a reason that has nothing to do with existence.
				unknownFormat: isMissingSource('warehouse.parquet', present),
				boundMarkdown: isMissingSource('board-transcript.md', present),
			},
			{
				deletedNeighbour: true,
				stillOnDisk: false,
				remoteFeed: false,
				remoteFeedNoExtension: false,
				underOut: false,
				underNodeModules: false,
				deeperThanTheScanWalks: false,
				pathWrittenSource: false,
				windowsPathWrittenSource: false,
				unknownFormat: false,
				boundMarkdown: false,
			},
		);
	});

	test('the click-gesture guard holds a redraw for the whole click sequence, so nothing moves between the two clicks of a double-click (fix round 2, R-1)', () => {
		// The defect this exists to close: click 1 opens a document, the rail redraws, the geometry under the
		// cursor changes, and click 2 lands on something the user never aimed at. The guard holds every
		// event-driven redraw from mousedown until the double-click window has elapsed after mouseup.
		const disposables = new DisposableStore();
		// The scheduler is injected rather than stubbed onto a global, so the test drives time itself.
		let pending: { handler: () => void; delayMs: number; cancelled: boolean } | undefined;
		const schedule: GestureScheduler = (handler, delayMs) => {
			const entry = { handler, delayMs, cancelled: false };
			pending = entry;
			return { dispose: () => { entry.cancelled = true; } };
		};
		const elapse = (): void => {
			const entry = pending;
			pending = undefined;
			if (entry && !entry.cancelled) { entry.handler(); }
		};
		let redraws = 0;
		const guard = disposables.add(new ClickGestureGuard(() => { redraws++; }, 500, 5000, schedule));

		const trace: unknown[] = [];
		const step = (what: string, held?: boolean) => trace.push({ what, held: held ?? null, inFlight: guard.inFlight, redraws });

		step('idle');
		// A redraw with no gesture to protect happens immediately - the caller is told to proceed.
		step('quiet redraw', guard.hold());
		guard.begin();
		step('mousedown 1');
		guard.end();
		// Click 1 opened a document: the redraw it caused is HELD, so the second click still has its target.
		step('opened a document', guard.hold());
		guard.begin();
		step('mousedown 2 (within the window)');
		guard.end();
		step('mouseup 2');
		elapse();
		step('window elapsed');
		// A press held down does not release on a timer - the window only starts when the button comes back up.
		guard.begin();
		step('mousedown, held', guard.hold());
		guard.end();
		elapse();
		step('released and elapsed');

		assert.deepStrictEqual(trace, [
			{ what: 'idle', held: null, inFlight: false, redraws: 0 },
			{ what: 'quiet redraw', held: false, inFlight: false, redraws: 0 },
			{ what: 'mousedown 1', held: null, inFlight: true, redraws: 0 },
			{ what: 'opened a document', held: true, inFlight: true, redraws: 0 },
			// The second mousedown cancels the pending release, so the held redraw survives the whole gesture.
			{ what: 'mousedown 2 (within the window)', held: null, inFlight: true, redraws: 0 },
			{ what: 'mouseup 2', held: null, inFlight: true, redraws: 0 },
			// One deferred redraw is replayed - not one per event that asked for it.
			{ what: 'window elapsed', held: null, inFlight: false, redraws: 1 },
			{ what: 'mousedown, held', held: true, inFlight: true, redraws: 1 },
			{ what: 'released and elapsed', held: null, inFlight: false, redraws: 2 },
		]);
		disposables.dispose();
	});

	test('buildTreeRailNodes shows EXACTLY the folder hierarchy - no Recent group, no Sources group, no synthetic wrapper (plan 52 WP-D)', () => {
		// The pre-build state this replaces: a synthetic "Recent" group of second copies above the tree, and a
		// synthetic "Sources" group below it. Both are gone; documents and directories are all that is left. The
		// standing "Not yet imported" affordance stays - a file we saw and could not convert is never a silent drop.
		const nodes = buildTreeRailNodes(
			[
				{ title: 'Root Doc', resource: URI.file('/ws/root.md'), pendingCount: 0, sources: ['metrics.csv'], folder: '' },
				{ title: 'Q1', resource: URI.file('/ws/brief/q1.md'), pendingCount: 0, sources: [], folder: 'brief' },
			],
			['data.csv', 'shot.png', 'old.doc'],
		);
		assert.deepStrictEqual(project(nodes), [
			{ folder: 'brief', children: [{ leaf: 'Q1', kind: 'doc' }] },
			{ leaf: 'Root Doc', kind: 'doc' },
			{ folder: 'Not yet imported', children: [{ leaf: 'old.doc', kind: 'unsupported' }] },
		]);
	});

	test('buildFileTree resolves a file source to a URI in the referencing document\'s folder (for the Files-tab menu), but not an api (URL) source', () => {
		const tree = buildFileTree([
			{ title: 'Weekly Summary', resource: WEEKLY, pendingCount: 0, sources: ['metrics.csv', 'https://api.example.com/mrr'] },
		]);
		const sources = tree.sources;
		const csv = sources.find(i => i.label === 'metrics.csv')!;
		const api = sources.find(i => i.label === 'https://api.example.com/mrr')!;
		// A file source is renamable/deletable, so it carries a real sibling URI; an api (URL) source has no file.
		assert.strictEqual(csv.resource?.toString(), URI.file('/ws/metrics.csv').toString());
		assert.strictEqual(api.resource, undefined);
	});

	test('buildFileTree preserves the on-disk folder hierarchy instead of flattening subfolders (F7)', () => {
		const A = URI.file('/ws/root.md');
		const B = URI.file('/ws/subfolder-a/note.md');
		const C = URI.file('/ws/subfolder-a/deep/deep.md');
		const D = URI.file('/ws/reports/2025/q1.md');
		const tree = buildFileTree([
			{ title: 'Root Doc', resource: A, pendingCount: 0, sources: [], folder: '' },
			{ title: 'Sub Note', resource: B, pendingCount: 0, sources: [], folder: 'subfolder-a' },
			{ title: 'Deep Doc', resource: C, pendingCount: 0, sources: [], folder: 'subfolder-a/deep' },
			{ title: 'Q1', resource: D, pendingCount: 0, sources: [], folder: 'reports/2025' },
		]);
		// The workspace's own shape: root docs at the top level, subfolders nested by their path (not flattened),
		// and nothing synthetic wrapping either (plan 52 WP-D).
		assert.deepStrictEqual(tree.items.map(i => i.label), ['Root Doc']);
		const shape = tree.folders.map(f => ({
			name: f.name,
			items: f.items.map(i => i.label),
			subs: f.folders.map(s => ({ name: s.name, items: s.items.map(i => i.label) })),
		}));
		assert.deepStrictEqual(shape, [
			{ name: 'reports', items: [], subs: [{ name: '2025', items: ['Q1'] }] },
			{ name: 'subfolder-a', items: ['Sub Note'], subs: [{ name: 'deep', items: ['Deep Doc'] }] },
		]);
	});

	test('buildFileTree lists discovered non-Markdown files as SOURCES and unsupported files as "Not yet imported" (F9/F10)', () => {
		const A = URI.file('/ws/report.md');
		const tree = buildFileTree(
			[{ title: 'Report', resource: A, pendingCount: 0, sources: ['metrics.csv'], folder: '' }],
			['data.csv', 'notes.txt', 'chart.png', 'metrics.csv', 'brief.docx', 'old.doc', 'deck.pptx'],
		);
		// Bound source + discovered data/txt/image files, deduped (metrics.csv appears once), sorted.
		assert.deepStrictEqual(tree.sources.map(i => ({ label: i.label, kind: i.kind })), [
			{ label: 'chart.png', kind: 'source' },
			{ label: 'data.csv', kind: 'source' },
			{ label: 'metrics.csv', kind: 'source' },
			{ label: 'notes.txt', kind: 'source' },
		]);
		assert.deepStrictEqual(tree.unsupported.map(i => ({ label: i.label, kind: i.kind, hasReason: !!i.note, importable: !!i.importable })), [
			{ label: 'brief.docx', kind: 'unsupported', hasReason: false, importable: true },
			{ label: 'deck.pptx', kind: 'unsupported', hasReason: true, importable: false },
			{ label: 'old.doc', kind: 'unsupported', hasReason: true, importable: false },
		]);
	});

	test('classifyWorkspaceExtra sorts data/image files into sources, office files into not-yet-imported, and skips md/system files', () => {
		assert.strictEqual(classifyWorkspaceExtra('data.csv')?.kind, 'source');
		assert.strictEqual(classifyWorkspaceExtra('photo.PNG')?.kind, 'source');
		assert.strictEqual(classifyWorkspaceExtra('notes.txt')?.kind, 'source');
		const docx = classifyWorkspaceExtra('brief.docx');
		assert.strictEqual(docx?.kind, 'unsupported');
		assert.strictEqual(docx?.importable, true, 'a .docx offers the import door rather than a dead reason');
		assert.ok(!docx?.reason, 'an importable .docx carries no refusal reason');
		const doc = classifyWorkspaceExtra('old.doc');
		assert.ok(doc?.reason && doc.reason.length > 0, 'a genuinely-unsupported file carries a plain-words reason');
		// Never surfaced: Markdown (the file tree owns it), lock sidecars, the agents registry, hidden files.
		assert.strictEqual(classifyWorkspaceExtra('doc.md'), undefined);
		assert.strictEqual(classifyWorkspaceExtra('report.lock.json'), undefined);
		assert.strictEqual(classifyWorkspaceExtra('agents.json'), undefined);
		assert.strictEqual(classifyWorkspaceExtra('.hidden'), undefined);
		assert.strictEqual(classifyWorkspaceExtra('README'), undefined);
	});

	test('classifyWorkspaceExtra offers workbooks + PDFs as usable sources with a "Use as source" action (issue #131)', () => {
		assert.deepStrictEqual(classifyWorkspaceExtra('Budget.xlsx'), { kind: 'source', action: 'use-xlsx' });
		assert.deepStrictEqual(classifyWorkspaceExtra('legacy.XLS'), { kind: 'source', action: 'use-xlsx' });
		assert.deepStrictEqual(classifyWorkspaceExtra('Report.pdf'), { kind: 'source', action: 'use-pdf' });
		// A workbook/PDF lands in SOURCES (with its action), never in the dead "Not yet imported" section.
		const tree = buildFileTree([], ['Budget.xlsx', 'Report.pdf']);
		assert.deepStrictEqual(tree.sources.map(i => ({ label: i.label, kind: i.kind, action: i.action })), [
			{ label: 'Budget.xlsx', kind: 'source', action: 'use-xlsx' },
			{ label: 'Report.pdf', kind: 'source', action: 'use-pdf' },
		]);
		assert.deepStrictEqual(tree.unsupported, []);
	});

	test('isAssetName flags image/screenshot files (case-insensitive) and nothing else', () => {
		assert.deepStrictEqual(
			['shot.png', 'photo.JPG', 'a.jpeg', 'b.gif', 'c.svg', 'd.webp', 'data.csv', 'notes.txt', 'report.md', 'noext'].map(isAssetName),
			[true, true, true, true, true, true, false, false, false, false],
		);
	});

	test('buildTreeRailNodes shapes the on-disk hierarchy into collapsible folder + leaf nodes (issue #171)', () => {
		const A = URI.file('/ws/root.md');
		const B = URI.file('/ws/reports/2025/q1.md');
		const nodes = buildTreeRailNodes([
			{ title: 'Root Doc', resource: A, pendingCount: 0, sources: ['metrics.csv'], folder: '' },
			{ title: 'Q1', resource: B, pendingCount: 0, sources: [], folder: 'reports/2025' },
		]);
		// The on-disk hierarchy IS the top level - real directories first (nested verbatim), then root documents,
		// with nothing synthetic above or below them (plan 52 WP-D).
		assert.deepStrictEqual(project(nodes), [
			{ folder: 'reports', children: [{ folder: '2025', children: [{ leaf: 'Q1', kind: 'doc' }] }] },
			{ leaf: 'Root Doc', kind: 'doc' },
		]);
	});

	test('buildTreeRailNodes gives same-titled documents distinct resource-based leaf ids so the tree cannot reconcile the wrong row (issue #171)', () => {
		// Two documents in the same folder can share a title; a label-based leaf id would collide, and the
		// tree's identityProvider would then select/reconcile the wrong node. Leaf ids derive from the unique
		// on-disk resource, so the two rows are distinguishable even though their labels are identical.
		const nodes = buildTreeRailNodes([
			{ title: 'Status', resource: URI.file('/ws/reports/Status.md'), pendingCount: 0, sources: [], folder: 'reports' },
			{ title: 'Status', resource: URI.file('/ws/reports/Status-2.md'), pendingCount: 0, sources: [], folder: 'reports' },
		]);
		const reportsFolder = nodes.find((n): n is Extract<ITreeRailNode, { type: 'folder' }> => n.type === 'folder' && n.label === 'reports')!;
		const leafIds = reportsFolder.children.filter(c => c.type === 'leaf').map(c => c.id);
		assert.strictEqual(new Set(leafIds).size, 2, 'the two same-titled documents have distinct leaf ids');
		assert.ok(leafIds.every(id => id.includes('Status')), 'each leaf id carries its own resource');
	});

	test('buildWorkspaceSourceNodes buckets un-bound image assets behind one collapsed Assets node, keeping bound sources visible (issue #171, plan 52 WP-D3)', () => {
		const A = URI.file('/ws/report.md');
		const nodes = buildWorkspaceSourceNodes(
			// chart.png is a BOUND source (referenced by the doc) and stays visible; the loose screenshots are assets.
			[{ title: 'Report', resource: A, pendingCount: 0, sources: ['chart.png', 'metrics.csv'], folder: '' }],
			['shot-1.png', 'shot-2.png', 'shot-3.jpg', 'data.csv'],
		);
		assert.deepStrictEqual(project(nodes), [
			// Non-image sources (bound + discovered), then a single collapsed Assets bucket for the images.
			{ leaf: 'chart.png', kind: 'source' },
			{ leaf: 'data.csv', kind: 'source' },
			{ leaf: 'metrics.csv', kind: 'source' },
			{
				folder: 'Assets (3)', children: [
					{ leaf: 'shot-1.png', kind: 'source' },
					{ leaf: 'shot-2.png', kind: 'source' },
					{ leaf: 'shot-3.jpg', kind: 'source' },
				]
			},
		]);
		// The bucket's id is unchanged from when Sources lived in the tree, so a workspace that already persisted
		// its collapse state keeps it after the move.
		assert.strictEqual(nodes.find(c => c.type === 'folder')!.id, 'folder:Sources/Assets');
	});

	test('buildWorkspaceSourceNodes is workspace-level: it lists the folder\'s sources with no document open, and keeps each row\'s freshness (plan 52 WP-D3)', () => {
		// The Context tab must show the folder's sources whichever document is active - including none at all -
		// so the builder takes an empty document set and still returns the discovered files. Freshness rides on
		// the row (the ONE vocabulary, #122 F12) so nothing is lost by leaving the tree.
		const bound = [{ title: 'Report', resource: URI.file('/ws/report.md'), pendingCount: 0, sources: ['metrics.csv', 'notes.txt'], folder: '' }];
		const freshness = new Map<string, 'fresh' | 'stale' | 'context-only'>([['metrics.csv', 'stale'], ['notes.txt', 'context-only']]);
		const meta = (nodes: readonly ITreeRailNode[]) => nodes.map(n => n.type === 'leaf' ? { leaf: n.item.label, meta: sourceMeta(n.item) } : { folder: n.label });
		assert.deepStrictEqual(
			{
				noDocuments: project(buildWorkspaceSourceNodes([], ['data.csv', 'legacy.doc'])),
				withFreshness: meta(buildWorkspaceSourceNodes(bound, ['loose.csv'], freshness)),
				emptyFolder: buildWorkspaceSourceNodes([], []),
			},
			{
				// A folder with no documents still has data files; an unsupported file is not a source.
				noDocuments: [{ leaf: 'data.csv', kind: 'source' }],
				withFreshness: [
					// A bare discovered file has no owning document, so no freshness and no local URI - no meta.
					{ leaf: 'loose.csv', meta: undefined },
					{ leaf: 'metrics.csv', meta: { text: 'stale', tone: 'stale' } },
					{ leaf: 'notes.txt', meta: { text: 'context only', tone: 'context-only' } },
				],
				emptyFolder: [],
			},
		);
	});

	test('collectAssetsFolderIds finds the Assets bucket id so the view can seed it collapsed on first open (issue #171)', () => {
		const A = URI.file('/ws/report.md');
		const withAssets = buildWorkspaceSourceNodes(
			[{ title: 'Report', resource: A, pendingCount: 0, sources: [], folder: '' }],
			['shot-1.png', 'shot-2.png', 'data.csv'],
		);
		const noAssets = buildWorkspaceSourceNodes(
			[{ title: 'Report', resource: A, pendingCount: 0, sources: [], folder: '' }],
			['data.csv'],
		);
		assert.deepStrictEqual(
			{ withAssets: collectAssetsFolderIds(withAssets), noAssets: collectAssetsFolderIds(noAssets), constId: ASSETS_FOLDER_ID },
			{ withAssets: ['folder:Sources/Assets'], noAssets: [], constId: 'folder:Sources/Assets' },
		);
	});

	test('buildOutline returns headings in order (living OR plain doc), stripped of Markdown/bind syntax, with a stable headingIndex that skips blank headings', () => {
		// A PLAIN Markdown document (isLiving: false) still gets a full outline (issue #181). The outline is
		// derived from the RAW body the editor renders, so a blank ATX heading (`##` with no text) is not shown
		// as a row but STILL advances headingIndex, keeping each entry lined up with the Nth rendered `<hN>`.
		const body = [
			'# Weekly Operating Summary',
			'',
			'## [Highlights](bind:x)',
			'',
			'Prose in between.',
			'',
			'##   ',
			'',
			'## Key metrics',
			'',
		].join('\n');
		const d: ILivingDoc = { ...doc('Notes', [], body), isLiving: false, blocks: [] };
		assert.deepStrictEqual(buildOutline(d), [
			{ text: 'Weekly Operating Summary', level: 1, headingIndex: 0 },
			{ text: 'Highlights', level: 2, headingIndex: 1 },
			{ text: 'Key metrics', level: 2, headingIndex: 3 },
		]);
		assert.deepStrictEqual(buildOutline(undefined), []);
	});

	test('buildOutline counts setext + blockquote-nested headings so its indices match the rendered <hN> ordinals (issue #181 regression)', () => {
		// The DOM the Outline scrolls is rendered by prosemirror-markdown (markdown-it) from the raw body, which
		// renders SETEXT headings (`Title` underlined by `===`/`---`) and headings nested in a BLOCKQUOTE as real
		// `<hN>` elements. The old outline counted only single-line ATX headings, so every ordinal after a setext
		// or blockquote heading drifted and Outline clicks scrolled to the WRONG heading. Deriving the outline
		// from the same body scan makes the ordinals line up 1:1. `---` after a blank line is a thematic break,
		// NOT a setext underline, and a fenced code block's `# ...` line is not a heading - both excluded, so the
		// count matches the DOM exactly. Against the pre-fix (block-ordinal) code the indices would read
		// 0/1/2/3 and the setext/blockquote headings would be missing entirely, so this asserts the fix.
		const body = [
			'Alpha Setext Title',    // rendered <h1> #0 (setext, underlined below)
			'==================',
			'',
			'## Bravo',              // rendered <h2> #1 (ATX)
			'',
			'> # Quoted Charlie',    // rendered <h1> #2 (heading inside a blockquote)
			'',
			'```',
			'# Not A Heading',       // inside a fence: NOT rendered as a heading
			'```',
			'',
			'Delta Setext',          // rendered <h2> #3 (setext, `-` underline after content)
			'------------',
			'',
			'---',                   // thematic break (blank line before): NOT a heading
			'',
			'### Echo',              // rendered <h3> #4 (ATX)
			'',
		].join('\n');
		const d: ILivingDoc = { ...doc('Mixed', [], body), isLiving: false, blocks: [] };
		assert.deepStrictEqual(buildOutline(d), [
			{ text: 'Alpha Setext Title', level: 1, headingIndex: 0 },
			{ text: 'Bravo', level: 2, headingIndex: 1 },
			{ text: 'Quoted Charlie', level: 1, headingIndex: 2 },
			{ text: 'Delta Setext', level: 2, headingIndex: 3 },
			{ text: 'Echo', level: 3, headingIndex: 4 },
		]);
	});

	test('buildOutline counts list-item-nested headings (markdown-it renders `- # x` inside the <li>) without over-counting lazy/code setext underlines (issue #181 regression)', () => {
		// markdown-it renders a heading nested in a list item as a real `<hN>` inside the `<li>`, so the Outline
		// scan must count it or every ordinal after it drifts and clicks scroll to the wrong heading. It must
		// NOT, however, over-count: a setext underline UNDER a list item only underlines when it reaches the
		// item's content column (marker width) and sits no more than three columns past it - a less-indented
		// `===` is a lazy paragraph continuation (no heading) and a more-indented one is a code block (no
		// heading). Verified against markdown-it in the two-parser harness. Each comment is the rendered <hN>.
		const body = [
			'- # Bullet ATX',       // rendered <h1> #0 (ATX inside a `-` list item)
			'',
			'1. ## Ordered ATX',    // rendered <h2> #1 (ATX inside a `1.` list item)
			'',
			'- Setext In List',     // rendered <h1> #2 (setext: underline reaches the content column)
			'  ================',
			'',
			'- Lazy Not Heading',   // NOT a heading: the `===` is unindented -> lazy paragraph continuation
			'===',
			'',
			'## Tail',              // rendered <h2> #3 (ATX) - proves the count did not drift
			'',
		].join('\n');
		const d: ILivingDoc = { ...doc('Listy', [], body), isLiving: false, blocks: [] };
		assert.deepStrictEqual(buildOutline(d), [
			{ text: 'Bullet ATX', level: 1, headingIndex: 0 },
			{ text: 'Ordered ATX', level: 2, headingIndex: 1 },
			{ text: 'Setext In List', level: 1, headingIndex: 2 },
			{ text: 'Tail', level: 2, headingIndex: 3 },
		]);
	});

	test('searchTreeRail matches title or body case-insensitively with a snippet, and ignores blank queries', () => {
		const docs = [
			{ title: 'Weekly Summary', resource: WEEKLY, body: 'Revenue grew this week as growth accelerated sharply.' },
			{ title: 'Board Note', resource: BOARD, body: 'Momentum is steady.' },
		];
		const hits = searchTreeRail(docs, 'ACCELERAT');
		assert.deepStrictEqual(
			{ count: hits.length, title: hits[0]?.title, hasSnippet: /accelerat/i.test(hits[0]?.snippet ?? '') },
			{ count: 1, title: 'Weekly Summary', hasSnippet: true },
		);
		assert.strictEqual(searchTreeRail(docs, '   ').length, 0, 'blank query returns nothing');
	});

	test('filterTreeRailNodes narrows to matching rows, keeps ancestor folders, and passes a blank query through', () => {
		// Two docs in nested folders + one file we cannot import, so the filter must prune folders holding no match.
		const nodes = buildTreeRailNodes(
			[
				{ title: 'Weekly Summary', resource: URI.file('/ws/reports/2025/Weekly Summary.md'), pendingCount: 0, sources: [], folder: 'reports/2025' },
				{ title: 'Board Note', resource: URI.file('/ws/reports/Board Note.md'), pendingCount: 0, sources: [], folder: 'reports' },
			],
			['legacy.doc'],
		);
		// Collect every leaf label reachable under a filtered tree, so one deepStrictEqual reads the whole shape.
		const labels = (roots: readonly ITreeRailNode[]): string[] => {
			const out: string[] = [];
			const walk = (n: ITreeRailNode): void => n.type === 'leaf' ? void out.push(n.item.label) : n.children.forEach(walk);
			roots.forEach(walk);
			return out.sort();
		};
		assert.deepStrictEqual(
			{
				weekly: labels(filterTreeRailNodes(nodes, 'weekly')),
				// A folder whose own name matches is kept whole, so its rows stay reachable.
				folderName: labels(filterTreeRailNodes(nodes, '2025')),
				legacy: labels(filterTreeRailNodes(nodes, 'legacy')),
				noMatch: filterTreeRailNodes(nodes, 'zzz').length,
				blankUnchanged: labels(filterTreeRailNodes(nodes, '   ')),
				original: labels(nodes),
			},
			{
				weekly: ['Weekly Summary'],
				folderName: ['Weekly Summary'],
				legacy: ['legacy.doc'],
				noMatch: 0,
				blankUnchanged: ['Board Note', 'Weekly Summary', 'legacy.doc'],
				original: ['Board Note', 'Weekly Summary', 'legacy.doc'],
			},
		);
	});

	test('filterTreeRailNodes keeps a document matched only by body text (P4.2 content reach)', () => {
		// Two docs whose labels do NOT contain "primary colour" - the phrase only lives in Board Note's body. The
		// view resolves the body-match set via `searchTreeRail`, then feeds the leaf resources to the filter, which
		// must surface Board Note (kept via bodyMatchResources) while a term in no label or body prunes to nothing.
		const boardResource = URI.file('/ws/reports/Board Note.md');
		const nodes = buildTreeRailNodes([
			{ title: 'Weekly Summary', resource: URI.file('/ws/reports/2025/Weekly Summary.md'), pendingCount: 0, sources: [], folder: 'reports/2025' },
			{ title: 'Board Note', resource: boardResource, pendingCount: 0, sources: [], folder: 'reports' },
		]);
		const labels = (roots: readonly ITreeRailNode[]): string[] => {
			const out: string[] = [];
			const walk = (n: ITreeRailNode): void => n.type === 'leaf' ? void out.push(n.item.label) : n.children.forEach(walk);
			roots.forEach(walk);
			return out.sort();
		};
		// The body-match set the view derives from `searchTreeRail` for a given query - always recomputed per query,
		// so the tree filter and the set agree. Only Board Note's body carries "primary colour"; nothing carries "zzz".
		const bodySet = (query: string) => new Set(searchTreeRail(
			[
				{ title: 'Weekly Summary', resource: URI.file('/ws/reports/2025/Weekly Summary.md'), body: 'Revenue grew this week.' },
				{ title: 'Board Note', resource: boardResource, body: 'The brand refresh keeps the primary colour unchanged.' },
			],
			query,
		).map(hit => hit.resource.toString()));
		assert.deepStrictEqual(
			{
				bodyPhrase: labels(filterTreeRailNodes(nodes, 'primary colour', bodySet('primary colour'))),
				noBodySet: filterTreeRailNodes(nodes, 'primary colour').length,
				unmatched: filterTreeRailNodes(nodes, 'zzz', bodySet('zzz')).length,
			},
			{
				bodyPhrase: ['Board Note'],
				noBodySet: 0,
				unmatched: 0,
			},
		);
	});
});
