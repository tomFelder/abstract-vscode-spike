/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { bufferToStream, VSBuffer } from '../../../../../base/common/buffer.js';
import { Emitter, Event } from '../../../../../base/common/event.js';
import { URI } from '../../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { IClipboardService } from '../../../../../platform/clipboard/common/clipboardService.js';
import { IWorkbenchLayoutService } from '../../../../services/layout/browser/layoutService.js';
import { NullLogService } from '../../../../../platform/log/common/log.js';
import { InMemoryStorageService } from '../../../../../platform/storage/common/storage.js';
import { NullAnalyticsService } from '../../common/analytics.js';
import { IFileService } from '../../../../../platform/files/common/files.js';
import { INotificationService } from '../../../../../platform/notification/common/notification.js';
import { IRequestService } from '../../../../../platform/request/common/request.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { IWorkspaceContextService } from '../../../../../platform/workspace/common/workspace.js';
import { IFileDialogService } from '../../../../../platform/dialogs/common/dialogs.js';
import { IHostService } from '../../../../services/host/browser/host.js';
import { ICommandService } from '../../../../../platform/commands/common/commands.js';
import { IEditorService } from '../../../../services/editor/common/editorService.js';
import { IViewsService } from '../../../../services/views/common/viewsService.js';
import { LivingDocsService } from '../../browser/livingDocsService.js';
import { AgentPolicy, IAgentDef, IAuditEntry, IFreshness, ILivingDoc } from '../../common/livingDocsModel.js';
import { buildContextGroups } from '../../common/contextGroups.js';
import { extractBindLinks, parseLivingDoc } from '../../common/livingDocMarkdown.js';

const METRICS_CSV = [
	'week,date,mrr,signups,churn,active',
	'22,Jun 08,40300,290,3.1,179',
	'23,Jun 15,41200,312,3.1,188',
	'24,Jun 19,48600,427,2.4,205',
].join('\n');

// A clean-file Living Document: bind links authored at the week-23 values; resolving against the CSV
// (latest = week 24) should reconcile the visible cache to the week-24 values.
const WEEKLY_MD = [
	'---',
	'title: Weekly Operating Summary',
	'subtitle: Week 23',
	'sources:',
	'  - metrics.csv',
	'context:',
	'  - market-research.md',
	'---',
	'',
	'## Highlights',
	'',
	'Revenue grew [12%](bind:metrics.mrr.delta) week-on-week to [$41.2k](bind:metrics.mrr) MRR, on [312](bind:metrics.signups) new signups.',
	'',
	'## Commentary',
	'',
	'Growth remained steady this week.',
	'',
	'## What to watch',
	'',
	'Activation rate on the new onboarding flow.',
].join('\n') + '\n';

// A second bound document - its KPI table is a clean Markdown table whose cells are bind links.
const BOARD_MD = [
	'---',
	'title: Board Note',
	'sources:',
	'  - metrics.csv',
	'---',
	'',
	'## Numbers',
	'',
	'| Metric | Current |',
	'| --- | --- |',
	'| MRR | [$41.2k](bind:metrics.mrr) |',
	'| Signups | [312](bind:metrics.signups) |',
	'',
	'## Note to the board',
	'',
	'Momentum is steady this week.',
].join('\n') + '\n';

const PLAIN_MD = [
	'# Team Notes',
	'',
	'A plain Markdown file with **no** frontmatter and no bindings.',
	'',
	'- first item',
	'- second item',
].join('\n') + '\n';

// The influence (context) source for the Weekly Summary - plain Markdown, not itself a living doc.
const MARKET_MD = [
	'# Market research',
	'',
	'Steady competitive landscape; no major moves this week.',
].join('\n') + '\n';

const API_MD = [
	'---',
	'title: Ecosystem Signal',
	'sources:',
	'  - https://api.example.com/repo',
	'---',
	'',
	'## Ecosystem',
	'',
	'The repository has [0](bind:repo.stargazers_count) stars and [0](bind:repo.open_issues_count) open issues.',
].join('\n') + '\n';

// A document whose figure block mixes a resolvable bind with one the source can't provide; the
// Financial grader must block the run because metrics.unknown does not reconcile.
const BADBIND_MD = [
	'---', 'title: Ratio Doc', 'sources:', '  - metrics.csv', '---', '',
	'## Ratio', '', 'MRR is [$41.2k](bind:metrics.mrr) at a ratio of [0.0](bind:metrics.unknown).',
].join('\n') + '\n';

// A template file (plan 28, D28-A): `template: true` frontmatter, a declared source, two `{{slot}}`
// placeholders and a bind link in the body. Discovered by listTemplates, excluded from listDocuments.
const WEEKLY_TEMPLATE_MD = [
	'---',
	'template: true',
	'name: Weekly report',
	'description: A weekly operating summary bound to metrics.csv.',
	'sources:',
	'  - metrics.csv',
	'---',
	'',
	'# {{slot:report title}}',
	'',
	'Week {{slot:week number}}',
	'',
	'Revenue is [pending](bind:metrics.mrr) MRR.',
].join('\n') + '\n';

const API_PAYLOAD = { stargazers_count: 12345, open_issues_count: 678, full_name: 'microsoft/vscode' };
// The canned proxy /mcp/resolve response (plan 29, iter 4): the extracted field value + the raw MCP payload.
const MCP_RESOLVE_RESPONSE = { value: '128,000', raw: JSON.stringify({ period: '2026-W24', total: 128000, won: 47 }) };
// The canned proxy /proxy/fetch response for an authenticated api source (the payload the proxy returns
// AFTER injecting the secret server-side - the renderer never sees the credential).
const API_AUTH_PAYLOAD = { arr: 480000, seats: 1200 };

// An inline mcp binding (D29-B): bind:key@mcp:server.tool/field, resolved through the proxy.
const MCP_MD = [
	'---',
	'title: Pipeline Brief',
	'---',
	'',
	'## Pipeline',
	'',
	'Total open pipeline is [pending](bind:pipeline@mcp:demo.query/total) this week.',
].join('\n') + '\n';

// An authenticated api source naming a proxy-side secret (D29-C): `<url> auth=<secret-name>`.
const API_AUTH_MD = [
	'---',
	'title: Revenue Signal',
	'sources:',
	'  - https://crm.example.com/metrics auth=crm-token',
	'---',
	'',
	'## Revenue',
	'',
	'ARR is [pending](bind:metrics.arr) across [pending](bind:metrics.seats) seats.',
].join('\n') + '\n';

const WEEKLY = URI.file('/ws/Weekly Summary.md');
const BOARD = URI.file('/ws/Board Note.md');
const README = URI.file('/ws/Team Notes.md');
// A closed loopback port for the model proxy URL: the STREAMING model path (a raw `fetch`) fails fast
// against it and falls back to the mocked buffered call, so a real proxy on the default port cannot leak
// into the fan-out tests. The buffered call is matched by the mock via its `/v1/messages` path either way.
const DEAD_PROXY = 'http://127.0.0.1:49999';
const API = URI.file('/ws/Ecosystem.md');
const MCP = URI.file('/ws/Pipeline Brief.md');
const APIAUTH = URI.file('/ws/Revenue Signal.md');
const BADBIND = URI.file('/ws/Ratio Doc.md');
const TEMPLATE = URI.file('/ws/templates/Weekly report.template.md');

// Spreadsheets-as-CSV-sources fixtures (issue #131). The workbook file bytes are irrelevant here (the
// proxy /sources/xlsx route is mocked), so any content stands in. The report binds the EXTRACTED CSV path,
// exactly as it will on disk after "Use as source" writes data/<workbook>/<sheet>.csv.
const WORKBOOK = URI.file('/ws/Budget.xlsx');
const XLSX_REPORT = URI.file('/ws/Budget Brief.md');
const XLSX_REPORT_MD = [
	'---', 'title: Budget Brief', 'sources:', '  - data/Budget/FY26.csv', '---', '',
	'## Budget', '', 'MRR is [pending](bind:FY26.MRR).',
].join('\n') + '\n';
// The canned proxy /sources/xlsx reply: one sheet, already clean + number-normalised, carrying a NAMED
// merged-header limitation so the test proves the warning is surfaced verbatim, never a silent misread.
const XLSX_SHEETS = {
	sheets: [{
		name: 'FY26', fileName: 'FY26.csv',
		csv: 'Month,MRR\n2026-01-05,1234.56\n2026-02-05,2000\n', rows: 3, cols: 2,
		warnings: ['This sheet has merged header cells - values may misalign with their columns.'],
	}],
};
// The canned proxy /sources/pdf replies: a readable text PDF, and a scanned/image-only one.
const PDF_TEXT = { readable: true, text: 'Board pack: revenue is up week on week. Watch churn.', pages: 2, reason: '' };
const PDF_IMAGE_ONLY = { readable: false, text: '', pages: 4, reason: 'This PDF has no selectable text - it looks scanned or image-only.' };
const PDF_FILE = URI.file('/ws/Board Pack.pdf');

// The suite title starts with the grep-stable "livingDocs" token (matching the sibling suites'
// "livingDocs <topic>" convention) so the standard gate `./scripts/test.sh --grep "livingDocs"`
// catches it. Previously titled "LivingDocsService", it was silently skipped by that case-sensitive
// grep, hiding a fan-out failure (issue #203). Keep any new livingDocs suite title lower-case "livingDocs".
suite('livingDocs Service', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();

	interface IOpenedEditor { resource?: URI; options?: { selection?: { startLineNumber: number } } }

	let lastFiles: Map<string, string> | undefined;
	// A test hook to set the "active document" (last opened editor) without a private-field reach-in, so
	// save-as-template (plan 48 T2.5) can pin the document it saves from.
	let setActiveEditor: ((resource: URI) => void) | undefined;
	// The last view id the service asked to open (focusPanel -> openView), so the reviewBlock deep-link test
	// can assert the Review rail was revealed (plan 48 H2.3u).
	let lastOpenedView: string | undefined;
	// Notifications the service raised (file-op toasts + named errors), so a test can assert the message
	// and drive the Undo action a toast carries (the file-ops tests; issue #125).
	let lastNotifications: { message: string; actions?: { primary?: { label: string; run: () => unknown }[] }; closed?: boolean }[] = [];
	// The convention folders the Tidy apply asked to create on demand (doc 22 section 5), so a test can assert
	// `data/`/`archive/` were made before the move landed.
	let createdFolders: string[] = [];
	let lastModelBody: string | undefined;
	let lastModelCalls = 0;
	let lastOpenedFolder: URI | undefined;
	// Plan 29 iter 4: capture what the renderer sent to the proxy's /mcp/resolve + /proxy/fetch routes, so a
	// test can prove the credential (the secret VALUE) never leaves the proxy - the renderer only names it.
	let lastMcpBody: string | undefined;
	let lastProxyFetchBody: string | undefined;
	// The most recent text the service wrote to the clipboard (share-to-clipboard), so a test can assert
	// the shared payload is the resolved, binding-free Markdown.
	let lastClipboard: string | undefined;
	// Issue #130: capture the HTML the renderer hands the desktop print-to-PDF command, and let a test control
	// the bytes it returns (undefined mimics the web harness where the command is absent). `lastDocxBody` is
	// the JSON the renderer POSTs to the proxy's /export/docx route (so a test can prove it carries the
	// resolved Markdown, not bindings).
	let lastPrintPdfHtml: string | undefined;
	let pdfCommandBytes: VSBuffer | undefined;
	let lastDocxBody: string | undefined;
	// External-edit floor (issue #133): write a file DIRECTLY to the backing map (bypassing the service's own
	// writeFile) and fire the correlated watcher for it, exactly as an edit made outside Abstract would arrive.
	// Injected by createService so a test can drive the same watcher seam the real file service provides, with
	// no global stub or private-field reach-in (the repo test learning).
	let simulateExternalEdit: ((resource: URI, content: string) => void) | undefined;
	// External-edit floor (issue #133): change the file on disk WITHOUT delivering a watcher event yet - the real,
	// legitimate state where a save races an outside edit before the (async) watcher fires. It is exactly what the
	// pre-write guard exists to catch, so a test can exercise that guard deterministically without the watcher
	// notice racing ahead and deduping it.
	let writeExternalNoWatcher: ((resource: URI, content: string) => void) | undefined;

	function createService(opened: IOpenedEditor[] = [], opts: { boardNote?: boolean; api?: boolean; mcp?: boolean; mcpResponse?: object; apiAuth?: boolean; badBind?: boolean; template?: boolean; agents?: IAgentDef[]; model?: object; modelSequence?: object[]; fanoutBudget?: number; proxyUrl?: string; pickFolder?: URI; noFolder?: boolean; failLockDelete?: boolean; failLockMove?: boolean; workbook?: boolean; xlsxReport?: boolean; xlsx?: object; pdf?: object; failInterop?: boolean; storage?: InMemoryStorageService } = {}): LivingDocsService {
		const files = new Map<string, string>();
		// Correlated watchers registered per resource (issue #133), so `simulateExternalEdit` can fire the same
		// change event the real file service delivers for an edit made outside Abstract.
		const watchers = new Map<string, Emitter<unknown>[]>();
		lastFiles = files;
		files.set(URI.file('/ws/metrics.csv').toString(), METRICS_CSV);
		files.set(URI.file('/ws/market-research.md').toString(), MARKET_MD);
		files.set(WEEKLY.toString(), WEEKLY_MD);
		files.set(README.toString(), PLAIN_MD);
		// Seed the agent registry before construction so the orchestrator loads it instead of defaults.
		if (opts.agents) { files.set(URI.file('/ws/agents.json').toString(), JSON.stringify(opts.agents)); }
		if (opts.boardNote) { files.set(BOARD.toString(), BOARD_MD); }
		if (opts.api) { files.set(API.toString(), API_MD); }
		if (opts.mcp) { files.set(MCP.toString(), MCP_MD); }
		if (opts.apiAuth) { files.set(APIAUTH.toString(), API_AUTH_MD); }
		if (opts.badBind) { files.set(BADBIND.toString(), BADBIND_MD); }
		// A template lives under a `templates/` subfolder to prove discovery walks into subdirectories (plan 28).
		if (opts.template) { files.set(TEMPLATE.toString(), WEEKLY_TEMPLATE_MD); }
		// Spreadsheets as CSV sources (issue #131): a workbook file + a report that binds its extracted CSV.
		if (opts.workbook) { files.set(WORKBOOK.toString(), 'workbook-bytes'); }
		if (opts.xlsxReport) { files.set(XLSX_REPORT.toString(), XLSX_REPORT_MD); }
		if (opts.pdf) { files.set(PDF_FILE.toString(), 'pdf-bytes'); }

		const fileService = {
			onDidChangeFileSystemProviderRegistrations: Event.None,
			readFile: async (resource: URI) => {
				const content = files.get(resource.toString());
				if (content === undefined) { throw new Error(`not found: ${resource.toString()}`); }
				return { value: VSBuffer.fromString(content) };
			},
			writeFile: async (resource: URI, buffer: VSBuffer) => {
				files.set(resource.toString(), buffer.toString());
			},
			exists: async (resource: URI) => files.has(resource.toString()),
			// `failLockDelete` simulates a sidecar delete failing AFTER the file delete succeeded, so the
			// file-ops tests can prove deleteFile rolls the file back (the pair never half-applies).
			del: async (resource: URI) => {
				if (opts.failLockDelete && resource.path.endsWith('.lock.json')) { throw new Error('simulated lock delete failure'); }
				if (!files.has(resource.toString())) { throw new Error(`not found: ${resource.toString()}`); }
				files.delete(resource.toString());
			},
			// The F16 atomic move (rename + Tidy): move one file key to a new key. `failLockMove` simulates the
			// sidecar move failing AFTER the document moved, so the move-op tests can prove the pair rolls back.
			move: async (from: URI, to: URI) => {
				if (opts.failLockMove && to.path.endsWith('.lock.json')) { throw new Error('simulated lock move failure'); }
				const content = files.get(from.toString());
				if (content === undefined) { throw new Error(`not found: ${from.toString()}`); }
				files.set(to.toString(), content);
				files.delete(from.toString());
				return { resource: to } as unknown as never;
			},
			// Convention folders are created on demand (doc 22 section 5). The Map has no real directories (resolve
			// synthesises them from keys), so folder creation is a no-op that just records that it was asked.
			createFolder: async (resource: URI) => { createdFolders.push(resource.toString()); return { resource } as unknown as never; },
			// List the direct children of a directory, so document discovery can fan out. Direct file children
			// are the keys with no further slash; an immediate subdirectory is synthesised (as an isDirectory
			// entry) from any key that has a deeper path, so the recursive template/document walk can descend.
			resolve: async (resource: URI) => {
				const prefix = resource.toString().replace(/\/+$/, '') + '/';
				const children: { resource: URI; isDirectory: boolean }[] = [];
				const dirs = new Set<string>();
				for (const key of files.keys()) {
					if (!key.startsWith(prefix)) { continue; }
					const rest = key.slice(prefix.length);
					const slash = rest.indexOf('/');
					if (slash < 0) {
						children.push({ resource: URI.parse(key), isDirectory: false });
					} else {
						dirs.add(prefix + rest.slice(0, slash));
					}
				}
				for (const dir of dirs) { children.push({ resource: URI.parse(dir), isDirectory: true }); }
				return { children };
			},
			// A correlated watcher per resource (issue #133): the service watches a document's own `.md` + lock; a
			// change fires this emitter. The service's own writes go via `writeFile` (which does NOT fire it), so
			// only `simulateExternalEdit` below models an edit made outside Abstract.
			createWatcher: (resource: URI) => {
				const emitter = new Emitter<unknown>();
				const list = watchers.get(resource.toString()) ?? [];
				list.push(emitter);
				watchers.set(resource.toString(), list);
				return { onDidChange: emitter.event, dispose: () => { emitter.dispose(); const l = watchers.get(resource.toString()); if (l) { l.splice(l.indexOf(emitter), 1); } } };
			},
		} as unknown as IFileService;
		simulateExternalEdit = (resource: URI, content: string) => {
			files.set(resource.toString(), content);
			for (const e of watchers.get(resource.toString()) ?? []) { e.fire(undefined); }
		};
		writeExternalNoWatcher = (resource: URI, content: string) => { files.set(resource.toString(), content); };

		// `activeEditor` tracks the last opened editor that carries a resource, so the service reads the same
		// "current document" a user would after opening one (used by save-as-template, plan 48 T2.5).
		const editorService = { openEditor: async (input: IOpenedEditor) => { opened.push(input); if (input.resource) { (editorService as { activeEditor?: { resource?: URI } }).activeEditor = { resource: input.resource }; } return undefined; }, findEditors: () => [], closeEditors: async () => undefined, onDidActiveEditorChange: Event.None, activeEditor: undefined } as unknown as IEditorService;
		setActiveEditor = (resource: URI) => { (editorService as unknown as { activeEditor?: { resource?: URI } }).activeEditor = { resource }; };
		lastOpenedView = undefined;
		const viewsService = { openView: async (id: string) => { lastOpenedView = id; return null; } } as unknown as IViewsService;
		// Most settings the service reads are booleans that default to true (useModel); the fan-out context
		// budget (plan 30, track 3) is a number a test can lower to force multi-batch packing over few docs.
		// Most settings the service reads default to true (booleans like useModel); the fan-out budget is a number
		// a test can lower; the model proxy URL lets a test point the STREAMING model path (a raw `fetch`, not the
		// mocked request service) at a dead port, so the streaming call fails fast and falls back to the mocked
		// buffered call - keeping the fan-out tests hermetic regardless of any real proxy on the default port.
		const configurationService = { getValue: (key?: string) => (key === 'livingDocs.fanoutContextBudget' ? opts.fanoutBudget : key === 'livingDocs.modelProxyUrl' ? opts.proxyUrl : true) } as unknown as IConfigurationService;
		lastNotifications = [];
		createdFolders = [];
		const notificationService = {
			info: (message: unknown) => { lastNotifications.push({ message: String(message) }); },
			error: (message: unknown) => { lastNotifications.push({ message: String(message) }); },
			notify: (n: { message: string; actions?: { primary?: { label: string; run: () => unknown }[] } }) => { const handle = { ...n, closed: false }; lastNotifications.push(handle); return { close: () => { handle.closed = true; } }; },
		} as unknown as INotificationService;
		// Routes the renderer's HTTP calls: when a model proxy response is configured, /healthz reports
		// healthy and /v1/messages returns the canned Claude response; everything else is the api source.
		const requestService = {
			request: async (options: { url?: string; data?: string }) => {
				const url = options.url ?? '';
				// Issue #131/#245 C2: simulate the measured CORS failure - the broker is UP (so /healthz answers)
				// but the interop POST dies at the transport (net::ERR_FAILED). The service must diagnose this as
				// a failed request, not "the proxy is down".
				if (opts.failInterop && (url.includes('/import/docx') || url.includes('/sources/xlsx') || url.includes('/sources/pdf'))) {
					throw new Error('net::ERR_FAILED');
				}
				if (opts.failInterop && url.includes('/healthz')) {
					return { res: { statusCode: 200, headers: {} }, stream: bufferToStream(VSBuffer.fromString(JSON.stringify({ ok: true }))) };
				}
				// Issue #130: the docx export route returns .docx BYTES, not JSON. The real bytes are proven by
				// the pure-node writer test (scripts/test/lwd-docx.test.js); here we return a PK-headed buffer and
				// capture the posted body so the SERVICE wiring (gate -> resolved Markdown -> POST -> write) is proven.
				if (url.includes('/export/docx')) {
					lastDocxBody = options.data;
					return { res: { statusCode: 200, headers: {} }, stream: bufferToStream(VSBuffer.wrap(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x64, 0x6f, 0x63, 0x78]))) };
				}
				let payload: object = API_PAYLOAD;
				// The proxy routes (plan 29 iter 4): /mcp/resolve returns the extracted value + raw payload;
				// /proxy/fetch returns the authenticated api JSON. Both capture the sent body so a test can
				// assert the renderer only ever names the secret, never carries its value.
				if (url.includes('/mcp/resolve')) { lastMcpBody = options.data; payload = opts.mcpResponse ?? MCP_RESOLVE_RESPONSE; }
				else if (url.includes('/proxy/fetch')) { lastProxyFetchBody = options.data; payload = API_AUTH_PAYLOAD; }
				// Source-extraction routes (issue #131): the node/proxy layer returns the extracted CSVs / PDF text.
				else if (url.includes('/sources/xlsx')) { payload = opts.xlsx ?? XLSX_SHEETS; }
				else if (url.includes('/sources/pdf')) { payload = opts.pdf ?? PDF_TEXT; }
				else if (opts.model || opts.modelSequence) {
					if (url.includes('/healthz')) { payload = { ok: true }; }
					else if (url.includes('/v1/messages')) {
						// A `modelSequence` returns a DIFFERENT canned reply per call (the Nth /v1/messages call
						// gets the Nth reply), so a multi-batch fan-out can be given one reply per batch; a single
						// `model` returns the same reply every call. lastModelCalls counts calls either way.
						payload = opts.modelSequence ? (opts.modelSequence[lastModelCalls] ?? opts.modelSequence[opts.modelSequence.length - 1]) : opts.model!;
						lastModelBody = options.data;
						lastModelCalls++;
					}
				}
				return {
					res: { statusCode: 200, headers: {} },
					stream: bufferToStream(VSBuffer.fromString(JSON.stringify(payload))),
				};
			},
		} as unknown as IRequestService;
		const workspaceService = { getWorkspace: () => ({ folders: opts.noFolder ? [] : [{ uri: URI.file('/ws'), name: 'ws' }] }), onDidChangeWorkspaceFolders: Event.None } as unknown as IWorkspaceContextService;
		// Folder open: the picker returns the configured folder (or nothing when cancelled); openWindow records it.
		const fileDialogService = { showOpenDialog: async () => opts.pickFolder ? [opts.pickFolder] : undefined } as unknown as IFileDialogService;
		lastOpenedFolder = undefined;
		lastModelCalls = 0;
		lastMcpBody = undefined;
		lastProxyFetchBody = undefined;
		const hostService = { openWindow: async (toOpen: { folderUri?: URI }[]) => { lastOpenedFolder = toOpen?.[0]?.folderUri; } } as unknown as IHostService;
		lastClipboard = undefined;
		const clipboardService = { writeText: async (t: string) => { lastClipboard = t; } } as unknown as IClipboardService;
		lastPrintPdfHtml = undefined;
		// Fake the desktop-only print-to-PDF command: record the HTML and return the configured bytes (default
		// undefined = the command is absent, as on the web harness).
		const commandService = {
			executeCommand: async (id: string, html: string) => {
				if (id === '_livingDocs.printToPDF') { lastPrintPdfHtml = html; return pdfCommandBytes; }
				return undefined;
			},
		} as unknown as ICommandService;

		// A caller can hand in its OWN storage so two services can be built over the same workspace state - which
		// is what a relaunch is (the process is new; `User/workspaceStorage/` is not). Otherwise each service gets
		// a fresh, empty store exactly as before.
		const storage = opts.storage ?? store.add(new InMemoryStorageService());
		const service = new LivingDocsService(fileService, editorService, viewsService, configurationService, notificationService, new NullLogService(), requestService, workspaceService, fileDialogService, hostService, new NullAnalyticsService(), storage, commandService, clipboardService, { isVisible: () => false } as unknown as IWorkbenchLayoutService);
		store.add(service);
		return service;
	}

	function blockText(service: LivingDocsService, uri: URI, headingId: string): string {
		// The bound paragraph follows its heading; return the first block after the given heading.
		const blocks = service.getDoc(uri)!.blocks;
		const i = blocks.findIndex(b => b.id === headingId);
		return blocks[i + 1].text;
	}

	test('loading a bound document resolves its bind keys to the latest source values', async () => {
		const service = createService();
		await service.loadDocument(WEEKLY);

		// Authored at the week-23 cache ($41.2k / 312 / 12%); resolved to week-24 ($48.6k / 427 / +18%).
		const resolved = service.getResolved(WEEKLY);
		assert.deepStrictEqual(
			{ mrr: resolved.get('metrics.mrr'), signups: resolved.get('metrics.signups'), delta: resolved.get('metrics.mrr.delta') },
			{ mrr: '$48.6k', signups: '427', delta: '+18%' },
		);
		// Load is read-only: the on-disk cache is untouched until an explicit refresh/save.
		assert.ok(blockText(service, WEEKLY, 'h-highlights').includes('[$41.2k](bind:metrics.mrr)'), 'on-disk cache unchanged on load');
	});

	// --- Properties panel (plan 45 pin 12): frontmatter read/write on disk + truthful lock reads ---

	test('setDocStatus/setDocTitle/setDocTag write frontmatter to the .md on disk; setDocPolicy round-trips', async () => {
		const service = createService();
		await service.loadDocument(WEEKLY);

		await service.setDocTitle(WEEKLY, 'Weekly Ops');
		await service.setDocStatus(WEEKLY, 'In review');
		await service.setDocTag(WEEKLY, 'finance', true);
		await service.setDocPolicy(WEEKLY, 'never');

		// The edits landed on disk (what a same-session reload re-reads) AND the body is verbatim.
		const onDisk = lastFiles!.get(WEEKLY.toString()) ?? '';
		assert.deepStrictEqual(
			{
				title: onDisk.includes('title: Weekly Ops'),
				status: onDisk.includes('status: In review'),
				tag: onDisk.includes('- finance'),
				policy: onDisk.includes('policy: never'),
				body: onDisk.includes('## Highlights'),
			},
			{ title: true, status: true, tag: true, policy: true, body: true });
		// The service's live reads reflect the writes (the panel re-renders from these).
		assert.strictEqual(service.getDocPolicy(WEEKLY), 'never');
		assert.strictEqual(service.getDoc(WEEKLY)!.status, 'In review');

		// Removing the tag drops it again.
		await service.setDocTag(WEEKLY, 'finance', false);
		assert.ok(!(lastFiles!.get(WEEKLY.toString()) ?? '').includes('- finance'), 'the tag is removed on disk');
	});

	test('getBoundSources groups the lock bindings by source file with truthful counts + keys', async () => {
		const service = createService();
		await service.loadDocument(WEEKLY);
		const bound = service.getBoundSources(WEEKLY);
		// WEEKLY binds three keys, all from metrics.csv, so one grouped row with count 3.
		assert.deepStrictEqual(
			bound.map(b => ({ source: b.source, count: b.count, keys: [...b.keys].sort() })),
			[{ source: 'metrics.csv', count: 3, keys: ['metrics.mrr', 'metrics.mrr.delta', 'metrics.signups'] }]);
	});

	test('getDocPolicy degrades an unauthored policy to the safe default (ask-first)', async () => {
		const service = createService();
		await service.loadDocument(WEEKLY);
		assert.strictEqual(service.getDocPolicy(WEEKLY), 'ask-first');
	});

	// --- Image assets (issue #141): paste/drop writes beside the doc; relative srcs resolve to data URIs ---

	test('saveImageAsset writes under assets/<doc-basename>/ beside the doc, sanitising and de-duplicating', async () => {
		const service = createService();
		const rel = await service.saveImageAsset(WEEKLY, 'My Shot (1).png', VSBuffer.fromString('PNGBYTES'));
		assert.strictEqual(rel, 'assets/Weekly Summary/My-Shot-1.png');
		assert.strictEqual(lastFiles!.get(URI.file('/ws/assets/Weekly Summary/My-Shot-1.png').toString()), 'PNGBYTES', 'the bytes land beside the document');
		// The same file pasted again gets a de-duplicated name, never an overwrite.
		const rel2 = await service.saveImageAsset(WEEKLY, 'My Shot (1).png', VSBuffer.fromString('PNGBYTES2'));
		assert.strictEqual(rel2, 'assets/Weekly Summary/My-Shot-1-2.png');
		assert.strictEqual(lastFiles!.get(URI.file('/ws/assets/Weekly Summary/My-Shot-1.png').toString()), 'PNGBYTES', 'the first asset is untouched');
		// A nameless paste (e.g. a raw screenshot) derives its extension from the reported MIME.
		const rel3 = await service.saveImageAsset(WEEKLY, '', VSBuffer.fromString('x'), 'image/jpeg');
		assert.strictEqual(rel3, 'assets/Weekly Summary/image.jpg');
	});

	test('readImageAsset returns a data URI for a doc-relative src, and error:true (no dataUri) when missing', async () => {
		const service = createService();
		lastFiles!.set(URI.file('/ws/logo.png').toString(), 'FAKEPNG');
		const ok = await service.readImageAsset(WEEKLY, 'logo.png');
		assert.strictEqual(ok.dataUri, 'data:image/png;base64,RkFLRVBORw==', 'the file comes back as a data URI');
		assert.ok(!ok.error);
		// A missing file is an explicit error reply - the editor renders a VISIBLE broken state from it.
		const missing = await service.readImageAsset(WEEKLY, 'assets/Weekly Summary/nope.png');
		assert.strictEqual(missing.error, true);
		assert.strictEqual(missing.dataUri, undefined);
	});

	test('readImageAsset refuses a src that escapes the workspace (path traversal), but allows nested paths', async () => {
		const service = createService();
		// The files EXIST outside the workspace - containment (not a read failure) must be what refuses them.
		lastFiles!.set(URI.file('/outside.png').toString(), 'SECRET');
		lastFiles!.set(URI.file('/etc/x').toString(), 'SECRET');
		const up = await service.readImageAsset(WEEKLY, '../outside.png');
		assert.strictEqual(up.error, true, '../ escaping the doc folder + workspace is refused');
		assert.strictEqual(up.dataUri, undefined);
		const deep = await service.readImageAsset(WEEKLY, '../../../etc/x');
		assert.strictEqual(deep.error, true, 'a deep ../../../ traversal is refused');
		assert.strictEqual(deep.dataUri, undefined);
		// Legitimate doc-relative reads still resolve: the assets layout and a nested subfolder.
		lastFiles!.set(URI.file('/ws/assets/Weekly Summary/x.png').toString(), 'ASSET');
		const asset = await service.readImageAsset(WEEKLY, 'assets/Weekly Summary/x.png');
		assert.ok(asset.dataUri && asset.dataUri.startsWith('data:image/png;base64,'), 'assets/<doc>/x.png still resolves');
		lastFiles!.set(URI.file('/ws/sub/img.png').toString(), 'NESTED');
		const nested = await service.readImageAsset(WEEKLY, 'sub/img.png');
		assert.ok(nested.dataUri && nested.dataUri.startsWith('data:image/png;base64,'), 'a nested relative path inside the doc folder still resolves');
	});

	test('refreshFromSources reconciles the visible cache (figures auto-apply), persists, and audits', async () => {
		const service = createService();
		await service.loadDocument(WEEKLY);

		await service.refreshFromSources();

		const highlights = blockText(service, WEEKLY, 'h-highlights');
		assert.ok(highlights.includes('[$48.6k](bind:metrics.mrr)') && highlights.includes('[427](bind:metrics.signups)') && highlights.includes('[+18%](bind:metrics.mrr.delta)'), `reconciled in memory: ${highlights}`);
		const onDisk = lastFiles!.get(WEEKLY.toString()) ?? '';
		assert.ok(onDisk.includes('[$48.6k](bind:metrics.mrr)'), `persisted resolved value: ${onDisk}`);
		assert.ok(service.getAudit().some(e => e.action === 'auto-applied'), 'figure auto-apply audited');
	});

	// --- external-edit floor (issue #133, doc 21 §6): detect an outside edit, offer reload/keep, never clobber ---

	test('an external edit to an open document surfaces the reload/keep notice', async () => {
		const service = createService();
		await service.loadDocument(WEEKLY);
		lastNotifications = [];

		// Someone edits the same file in Word/Obsidian/another machine while it is open in Abstract.
		simulateExternalEdit!(WEEKLY, WEEKLY_MD.replace('Growth remained steady', 'Growth accelerated'));
		await new Promise(r => setTimeout(r, 0)); // the watcher handler re-reads + hashes asynchronously

		const notice = lastNotifications.find(n => /changed outside Abstract/.test(n.message));
		const labels = notice?.actions?.primary?.map(a => a.label) ?? [];
		assert.deepStrictEqual({ shown: !!notice, labels }, { shown: true, labels: ['Reload from disk', 'Keep my version'] });
	});

	test('a persist over an externally-changed file does NOT clobber it without a choice', async () => {
		const service = createService();
		await service.loadDocument(WEEKLY);
		// The file changes on disk outside Abstract after it was opened.
		const external = WEEKLY_MD.replace('Growth remained steady', 'Edited in Obsidian');
		simulateExternalEdit!(WEEKLY, external);
		lastNotifications = [];

		// A refresh would normally reconcile + persist; with an undecided external change it must abandon the write.
		await service.refreshFromSources(WEEKLY);

		const onDisk = lastFiles!.get(WEEKLY.toString());
		// A reload/keep notice is up (from the persist guard, or the watcher for the same conflict - deduped to one).
		const notice = lastNotifications.find(n => /changed on disk since you opened it|changed outside Abstract/.test(n.message));
		assert.deepStrictEqual({ preserved: onDisk === external, prompted: !!notice }, { preserved: true, prompted: true });
	});

	test('after "Keep my version" the next persist lands and appends an external-overwrite-kept audit entry', async () => {
		const service = createService();
		await service.loadDocument(WEEKLY);
		simulateExternalEdit!(WEEKLY, WEEKLY_MD.replace('Growth remained steady', 'Edited elsewhere'));
		await new Promise(r => setTimeout(r, 0));
		// The reviewer chooses to keep the version open in Abstract.
		const keep = lastNotifications.flatMap(n => n.actions?.primary ?? []).find(a => a.label === 'Keep my version');
		keep!.run();

		await service.refreshFromSources(WEEKLY);

		const onDisk = lastFiles!.get(WEEKLY.toString()) ?? '';
		const audit = service.getLock(WEEKLY)!.audit;
		assert.deepStrictEqual({
			wroteOurVersion: onDisk.includes('[$48.6k](bind:metrics.mrr)') && !onDisk.includes('Edited elsewhere'),
			audited: audit.some(e => e.action === 'external-overwrite-kept'),
		}, { wroteOurVersion: true, audited: true });
	});

	test('our own writes do not false-positive as an external edit', async () => {
		const service = createService();
		await service.loadDocument(WEEKLY);
		lastNotifications = [];

		// A normal refresh reconciles figures and persists - a self-write, which must flow exactly as before.
		await service.refreshFromSources(WEEKLY);
		await new Promise(r => setTimeout(r, 0));

		const onDisk = lastFiles!.get(WEEKLY.toString()) ?? '';
		const conflict = lastNotifications.find(n => /changed outside Abstract|changed on disk since you opened it/.test(n.message));
		assert.deepStrictEqual({ persisted: onDisk.includes('[$48.6k](bind:metrics.mrr)'), falsePositive: !!conflict }, { persisted: true, falsePositive: false });
	});

	test('a live-typed silent save over an externally-changed file does NOT write without a choice', async () => {
		const service = createService();
		await service.loadDocument(WEEKLY);
		// The file changes on disk outside Abstract while it is open (watcher not yet delivered - a save races it).
		const external = WEEKLY_MD.replace('Growth remained steady', 'Edited in Word');
		writeExternalNoWatcher!(WEEKLY, external);
		lastNotifications = [];

		// Live ProseMirror typing persists through saveRawText({ silent: true }) - the primary live-editing write path.
		const typed = WEEKLY_MD.replace('Growth remained steady', 'I am still typing here');
		await service.saveRawText(WEEKLY, typed, { silent: true });

		const onDisk = lastFiles!.get(WEEKLY.toString());
		const notice = lastNotifications.find(n => /changed on disk since you opened it/.test(n.message));
		// The external edit is preserved on disk (not clobbered), the notice is shown, and the typed text is kept in
		// the editor (in memory) so it is not lost while the user decides.
		assert.deepStrictEqual(
			{ diskPreserved: onDisk === external, prompted: !!notice, typedKept: service.getRawText(WEEKLY) === typed },
			{ diskPreserved: true, prompted: true, typedKept: true });
	});

	test('after "Keep my version" the first raw-text save writes + audits once TO DISK, and a NEW external edit re-triggers', async () => {
		const service = createService();
		await service.loadDocument(WEEKLY);
		simulateExternalEdit!(WEEKLY, WEEKLY_MD.replace('Growth remained steady', 'Edited elsewhere'));
		await new Promise(r => setTimeout(r, 0));
		// The reviewer keeps the version open in Abstract, then keeps typing (the live-editing path lands the save).
		lastNotifications.flatMap(n => n.actions?.primary ?? []).find(a => a.label === 'Keep my version')!.run();
		const typed = WEEKLY_MD.replace('Growth remained steady', 'My kept version');
		await service.saveRawText(WEEKLY, typed, { silent: true });

		// Read the ON-DISK lock sidecar (F3: the entry must land on disk ATOMICALLY with the .md save, so a quit or
		// reload immediately after the Keep still shows it in History). getLock reads memory, which masked the bug.
		const onDiskLockText = lastFiles!.get(URI.file('/ws/Weekly Summary.lock.json').toString());
		const onDiskAudit = onDiskLockText ? (JSON.parse(onDiskLockText).audit as { action: string }[]) : [];
		const afterKeep = {
			wroteOurVersion: (lastFiles!.get(WEEKLY.toString()) ?? '') === typed,
			diskAuditCount: onDiskAudit.filter(e => e.action === 'external-overwrite-kept').length,
		};

		// A genuinely NEW external edit AFTER the kept write re-arms detection (the Keep decision was one-shot).
		lastNotifications = [];
		simulateExternalEdit!(WEEKLY, typed.replace('My kept version', 'A second outside edit'));
		await new Promise(r => setTimeout(r, 0));
		const reTriggered = lastNotifications.some(n => /changed outside Abstract/.test(n.message));

		assert.deepStrictEqual({ ...afterKeep, reTriggered }, { wroteOurVersion: true, diskAuditCount: 1, reTriggered: true });
	});

	test('the discard warning fires when live-typed prose is pending and the file changed on disk', async () => {
		const service = createService();
		await service.loadDocument(WEEKLY);
		// The user has typed but the silent save was blocked by an external change, so there is unsaved in-editor work.
		const external = WEEKLY_MD.replace('Growth remained steady', 'Edited outside');
		writeExternalNoWatcher!(WEEKLY, external);
		lastNotifications = [];

		const typed = WEEKLY_MD.replace('Growth remained steady', 'Unsaved live typing');
		await service.saveRawText(WEEKLY, typed, { silent: true });

		const notice = lastNotifications.find(n => /changed on disk since you opened it/.test(n.message));
		assert.deepStrictEqual(
			{ shown: !!notice, warnsDiscard: /Reloading will discard the changes you have here that are not yet saved\./.test(notice?.message ?? '') },
			{ shown: true, warnsDiscard: true });
	});

	test('watcher fires FIRST, then a blocked typed save refreshes the notice to carry the discard warning (F4 live order)', async () => {
		const service = createService();
		await service.loadDocument(WEEKLY);
		lastNotifications = [];
		// Live order (issue #133 F4): the OS watcher wins the race and raises the notice BEFORE any typing, so its
		// first message has NO discard line (there is no unsaved work yet).
		const external = WEEKLY_MD.replace('Growth remained steady', 'Edited outside first');
		simulateExternalEdit!(WEEKLY, external);
		await new Promise(r => setTimeout(r, 0));
		const firstNotice = lastNotifications.find(n => /changed outside Abstract/.test(n.message));
		const firstWarnsDiscard = /Reloading will discard/.test(firstNotice?.message ?? '');

		// THEN the user types; the silent save is blocked (external change undecided), setting unsavedRaw. The already-up
		// notice must be closed + re-raised WITH the discard line - dedup still holds, so exactly one notice stays live.
		const typed = WEEKLY_MD.replace('Growth remained steady', 'Now I am typing');
		await service.saveRawText(WEEKLY, typed, { silent: true });

		const liveNotices = lastNotifications.filter(n => !n.closed && /changed (outside Abstract|on disk since you opened it)/.test(n.message));
		const liveWarnsDiscard = liveNotices.some(n => /Reloading will discard the changes you have here that are not yet saved\./.test(n.message));
		assert.deepStrictEqual(
			{ firstWarnsDiscard, liveCount: liveNotices.length, liveWarnsDiscard },
			{ firstWarnsDiscard: false, liveCount: 1, liveWarnsDiscard: true });
	});

	test('first open bootstraps a lock sidecar from the sources (resolved value, hash, syncedAt, kind)', async () => {
		const service = createService();
		await service.loadDocument(WEEKLY);

		const lockText = lastFiles!.get(URI.file('/ws/Weekly Summary.lock.json').toString());
		assert.ok(lockText, 'a lock sidecar was written on first open');
		const lock = JSON.parse(lockText!);
		const mrr = lock.bindings['metrics.mrr'];
		assert.strictEqual(mrr.resolved, '$48.6k', 'resolved value bootstrapped from the source');
		assert.ok(mrr.sourceHash && mrr.syncedAt, 'binding carries a source hash and sync time');
		assert.deepStrictEqual({ appliedBy: mrr.appliedBy, kind: mrr.kind }, { appliedBy: 'agent', kind: 'figure' });
	});

	test('the lock is the source of truth for resolved values: load does not re-read sources (lock wins)', async () => {
		const service = createService();
		// Seed a lock whose resolved value is NOT derivable from the CSV; load must honour it.
		lastFiles!.set(URI.file('/ws/Weekly Summary.lock.json').toString(), JSON.stringify({
			version: 1,
			bindings: { 'metrics.mrr': { resolved: '$99.9k', source: 'metrics.csv#mrr', sourceHash: 'stale', syncedAt: 't', appliedBy: 'agent', kind: 'figure' } },
			context: {}, claims: {}, pins: [], audit: [],
		}));

		await service.loadDocument(WEEKLY);
		assert.strictEqual(service.getResolved(WEEKLY).get('metrics.mrr'), '$99.9k', 'load shows the lock value, not a fresh source read');
	});

	test('re-syncing a changed source updates the lock binding resolved + sourceHash and reconciles the .md', async () => {
		const service = createService();
		lastFiles!.set(URI.file('/ws/Weekly Summary.lock.json').toString(), JSON.stringify({
			version: 1,
			bindings: { 'metrics.mrr': { resolved: '$99.9k', source: 'metrics.csv#mrr', sourceHash: 'stale', syncedAt: 't', appliedBy: 'agent', kind: 'figure' } },
			context: {}, claims: {}, pins: [], audit: [],
		}));
		await service.loadDocument(WEEKLY);

		await service.refreshFromSources();

		const mrr = service.getLock(WEEKLY)!.bindings['metrics.mrr'];
		assert.strictEqual(mrr.resolved, '$48.6k', 're-sync pulls the current source value into the lock');
		assert.notStrictEqual(mrr.sourceHash, 'stale', 'source hash refreshed at sync');
		const lockOnDisk = JSON.parse(lastFiles!.get(URI.file('/ws/Weekly Summary.lock.json').toString())!);
		assert.strictEqual(lockOnDisk.bindings['metrics.mrr'].resolved, '$48.6k', 'lock persisted to its sidecar');
	});

	// --- issue #121 / F19: History rehydrates from the on-disk lock audit on a cold open ---

	test('F19: a cold open rehydrates the audit trail from the persisted lock (not just in-session entries)', async () => {
		const service = createService();
		// A lock already on disk with real audit[] entries - as it would be after a prior session's approve.
		// The freshly constructed service has an empty in-memory doc cache, so this is a genuine cold open.
		lastFiles!.set(URI.file('/ws/Weekly Summary.lock.json').toString(), JSON.stringify({
			version: 1,
			bindings: {}, context: {}, claims: {}, pins: [], audit: [
				{ time: '2026-07-09T22:35:49.359Z', docTitle: 'Weekly Operating Summary', blockId: 'h-commentary', action: 'approved', oldText: 'Growth remained steady this week.', newText: 'Growth accelerated this week.', via: 'model' },
				{ time: '2026-07-10T09:12:03.100Z', docTitle: 'Weekly Operating Summary', blockId: 'h-highlights', action: 'rejected', oldText: 'x', newText: 'y', via: 'model' },
			],
			contextItems: [], snapshots: [],
		}));

		await service.loadDocument(WEEKLY);

		// The History tab reads getLock(...).audit; on a cold open it must carry the persisted entries.
		const audit = service.getLock(WEEKLY)!.audit;
		assert.strictEqual(audit.length, 2, 'both persisted audit entries rehydrated on cold open');
		assert.deepStrictEqual(audit.map(e => e.blockId), ['h-commentary', 'h-highlights'], 'entries preserved from disk');
	});

	test('X1 within-session persistence: approve writes the new text + audit entry back to the on-disk lock (write-then-read)', async () => {
		const service = createService();
		// A claim anchored to the Commentary sentence; a context change queues a deterministic (heuristic)
		// candidate the user approves - no model probe, so the write-then-read is deterministic.
		seedLock(WEEKLY, {
			version: 1, bindings: {}, context: {},
			claims: { 'commentary-tone': { anchor: 'Growth remained steady this week.', boundTo: ['market-research.md'], kind: 'meaning', state: 'applied' } },
			pins: [], audit: [],
		});
		await service.loadDocument(WEEKLY);
		lastFiles!.set(URI.file('/ws/market-research.md').toString(), MARKET_MD + '\nA new competitor entered the market.\n');
		await service.checkSources(WEEKLY);
		await service.reviewImpact(WEEKLY);
		const pending = service.getPendingForDoc(WEEKLY)[0];
		const { newText, blockId } = pending;
		await service.approve(pending.id);

		// Read the persisted bytes back through the file map (what a same-session reload re-reads). This is the
		// verifiable half of X1: approve -> _persist -> read-back succeeds within the provider session. The web
		// dev-harness caveat is that the in-memory mount drops these bytes on a full page reload (decision 162).
		const mdOnDisk = lastFiles!.get(WEEKLY.toString()) ?? '';
		assert.ok(mdOnDisk.includes(newText), 'the approved prose is persisted to the .md on disk');
		const lockOnDisk = JSON.parse(lastFiles!.get(URI.file('/ws/Weekly Summary.lock.json').toString())!);
		assert.ok(lockOnDisk.audit.some((e: { action: string; blockId: string }) => e.action === 'approved' && e.blockId === blockId), 'the approval is persisted to the lock audit, so a cold reopen rehydrates it');
	});

	// --- issue #258: negative verbs persist. reject(), its optional reason, and the "This Was Wrong" flag must
	// write through to the on-disk lock like approve does, so they survive a relaunch and a flagged row cannot
	// be re-flagged forever. Verified by reading the persisted lock bytes back (what a cold reopen rehydrates). ---
	test('#258: reject persists the rejected row + its reason, and This-Was-Wrong persists the flag (survives relaunch)', async () => {
		const service = createService();
		// An already-approved row on disk (as a prior session's approve would leave it), plus a claim bound to the
		// context so the change below queues a deterministic heuristic candidate the user rejects with a reason.
		const approvedTime = '2026-07-11T08:00:00.000Z';
		seedLock(WEEKLY, {
			version: 1, bindings: {}, context: {},
			claims: { 'commentary-tone': { anchor: 'Growth remained steady this week.', boundTo: ['market-research.md'], kind: 'meaning', state: 'applied' } },
			pins: [], audit: [
				{ time: approvedTime, docTitle: 'Weekly Summary', blockId: 'h-commentary', action: 'approved', oldText: 'a', newText: 'b', via: 'model' },
			],
		});
		await service.loadDocument(WEEKLY);
		lastFiles!.set(URI.file('/ws/market-research.md').toString(), MARKET_MD + '\nA new competitor entered the market.\n');
		await service.checkSources(WEEKLY);
		await service.reviewImpact(WEEKLY);
		const rejected = service.getPendingForDoc(WEEKLY)[0];
		await service.reject(rejected.id, 'this changes the meaning');

		// Flag the approved row wrong (keyed by its ISO time). A second flag on the same row is a no-op (no
		// infinite re-flag).
		await service.reportChangeWrong({ changeRef: approvedTime, comment: 'the figure is stale', docTitle: 'Weekly Summary' });
		await service.reportChangeWrong({ changeRef: approvedTime, comment: 'again', docTitle: 'Weekly Summary' });

		// Read the persisted lock bytes back - the trail a cold reopen would rehydrate (the relaunch-survival proof;
		// getLock reads memory, which masked the original bug where reject never reached disk).
		const onDisk = JSON.parse(lastFiles!.get(URI.file('/ws/Weekly Summary.lock.json').toString())!) as { audit: IAuditEntry[] };
		const rejectRow = onDisk.audit.find(e => e.action === 'rejected');
		const flaggedRow = onDisk.audit.find(e => e.time === approvedTime);
		assert.deepStrictEqual({
			rejectPersisted: rejectRow?.action,
			rejectReason: rejectRow?.reason,
			flagPersisted: flaggedRow?.wrong?.comment,
		}, {
			rejectPersisted: 'rejected',
			rejectReason: 'this changes the meaning',
			flagPersisted: 'the figure is stale',
		});
	});

	test('changing a value source flips the binding dirty bit (hash mismatch), with no model calls', async () => {
		const service = createService();
		await service.loadDocument(WEEKLY);
		assert.strictEqual(service.getFreshness(WEEKLY).dirty, false, 'fresh immediately after load');

		// A new week lands in the CSV - the bound document may be affected.
		lastFiles!.set(URI.file('/ws/metrics.csv').toString(), METRICS_CSV + '\n25,Jun 26,52000,470,2.2,210');
		await service.checkSources(WEEKLY);

		const fresh = service.getFreshness(WEEKLY);
		assert.ok(fresh.dirty && fresh.staleBindings.includes('metrics.mrr'), `binding dirty on source change: ${JSON.stringify(fresh)}`);
	});

	test('changing a context source flips its freshness to stale (the influence path)', async () => {
		const service = createService();
		await service.loadDocument(WEEKLY);
		assert.deepStrictEqual(service.getFreshness(WEEKLY).staleContext, [], 'context current after load');

		lastFiles!.set(URI.file('/ws/market-research.md').toString(), MARKET_MD + '\nA new competitor entered the market.\n');
		await service.checkSources(WEEKLY);

		assert.deepStrictEqual(service.getFreshness(WEEKLY).staleContext, ['market-research.md'], 'context flagged changed-since-review');
	});

	test('the Context panel groups the document\'s linked sources and referenced files, fresh by default', async () => {
		const service = createService();
		await service.loadDocument(WEEKLY);

		const groups = buildContextGroups(service.getDoc(WEEKLY)!, service.getFreshness(WEEKLY));
		// metrics.csv feeds the one bound block (Highlights); market-research.md is influence-only.
		assert.deepStrictEqual(groups, [
			{ label: 'Linked sources', items: [{ name: 'metrics.csv', kind: 'file', detail: 'live · feeds 1 block', changed: false }] },
			{ label: 'Referenced files', items: [{ name: 'market-research.md', kind: 'reference', detail: 'current', changed: false }] },
		]);
	});

	test('a changed value source flips its linked-source row to changed; a changed context source flips its referenced row', async () => {
		const service = createService();
		await service.loadDocument(WEEKLY);

		lastFiles!.set(URI.file('/ws/metrics.csv').toString(), METRICS_CSV + '\n25,Jun 26,52000,470,2.2,210');
		lastFiles!.set(URI.file('/ws/market-research.md').toString(), MARKET_MD + '\nA new competitor entered the market.\n');
		await service.checkSources(WEEKLY);

		const groups = buildContextGroups(service.getDoc(WEEKLY)!, service.getFreshness(WEEKLY));
		assert.deepStrictEqual(groups, [
			{ label: 'Linked sources', items: [{ name: 'metrics.csv', kind: 'file', detail: 'stale · feeds 1 block', changed: true }] },
			{ label: 'Referenced files', items: [{ name: 'market-research.md', kind: 'reference', detail: 'stale', changed: true }] },
		]);
	});

	test('the doc subtitle tracks the resolved week from its source (on load and on sync)', async () => {
		const service = createService();
		await service.loadDocument(WEEKLY); // fixture subtitle "Week 23"; CSV latest week is 24
		assert.strictEqual(service.getDoc(WEEKLY)!.subtitle, 'Week 24', 'subtitle resolves to the latest source week on load');

		lastFiles!.set(URI.file('/ws/metrics.csv').toString(), METRICS_CSV + '\n25,Jun 26,52000,470,2.2,210');
		await service.syncFromSources(WEEKLY);
		assert.strictEqual(service.getDoc(WEEKLY)!.subtitle, 'Week 25', 'syncing advances the subtitle to the new week');
	});

	test('buildContextGroups splits image references into Images and surfaces added pasted/knowledge groups', () => {
		const doc: ILivingDoc = { title: 't', subtitle: '', sources: [], context: ['market-research.md', 'chart.png'], blocks: [], isLiving: true, body: '' };
		const fresh: IFreshness = { staleBindings: [], staleContext: [], dirty: false };
		const groups = buildContextGroups(doc, fresh, [
			{ kind: 'pasted', label: 'Q3 plan notes', detail: 'pasted note' },
			{ kind: 'knowledge', label: 'North Star metric', detail: 'company knowledge' },
		]);
		assert.deepStrictEqual(groups.map(g => [g.label, g.items.map(i => `${i.kind}:${i.name}`)]), [
			['Referenced files', ['reference:market-research.md']],
			['Images', ['image:chart.png']],
			['Pasted text', ['pasted:Q3 plan notes']],
			['Company knowledge', ['knowledge:North Star metric']],
		]);
	});

	test('addContext persists a typed context item to the lock; getAddedContext + the Context panel surface it', async () => {
		const service = createService();
		await service.loadDocument(WEEKLY);

		await service.addContext(WEEKLY, 'pasted', 'Customer interview: pricing is the blocker.');

		assert.deepStrictEqual(
			service.getAddedContext(WEEKLY).map(a => ({ kind: a.kind, label: a.label, detail: a.detail })),
			[{ kind: 'pasted', label: 'Customer interview: pricing is the blocker.', detail: 'pasted note' }],
		);
		const groups = buildContextGroups(service.getDoc(WEEKLY)!, service.getFreshness(WEEKLY), service.getAddedContext(WEEKLY));
		assert.ok(groups.some(g => g.label === 'Pasted text'), 'the Pasted text group now renders');
		const lockOnDisk = JSON.parse(lastFiles!.get(URI.file('/ws/Weekly Summary.lock.json').toString())!);
		assert.strictEqual(lockOnDisk.contextItems[0].kind, 'pasted', 'persisted to the lock sidecar');
	});

	test('an api source is grouped as a linked source with its kind', async () => {
		const service = createService([], { api: true });
		await service.loadDocument(API);

		const groups = buildContextGroups(service.getDoc(API)!, service.getFreshness(API));
		assert.deepStrictEqual(groups, [
			{ label: 'Linked sources', items: [{ name: 'https://api.example.com/repo', kind: 'api', detail: 'live · polled', changed: false }] },
		]);
	});

	test('the Skills report grades the document: Financial reconciles, Formatting flags sentence-case headings, Strategy needs a model', async () => {
		const service = createService();
		await service.loadDocument(WEEKLY);

		const report = service.getSkillReport(WEEKLY).map(s => ({ id: s.id, status: s.status, detail: s.detail, canRun: s.canRun }));
		assert.deepStrictEqual(report, [
			{ id: 'strategy', status: 'needs-model', detail: 'Connect a model to test claims against the decision stack.', canRun: false },
			{ id: 'financial', status: 'pass', detail: 'All 3 linked figures reconcile with sources.', canRun: true },
			{ id: 'formatting', status: 'flag', detail: '1 heading-case fix suggested.', canRun: true },
		]);
	});

	test('syncFromSources re-derives the figures, returns the old->new diff, and records the last sync diff', async () => {
		const service = createService();
		// Seed a stale MRR in the lock so a sync produces a visible figure change.
		lastFiles!.set(URI.file('/ws/Weekly Summary.lock.json').toString(), JSON.stringify({
			version: 1,
			bindings: { 'metrics.mrr': { resolved: '$99.9k', source: 'metrics.csv#mrr', sourceHash: 'stale', syncedAt: 't', appliedBy: 'agent', kind: 'figure' } },
			context: {}, claims: {}, pins: [], audit: [],
		}));
		await service.loadDocument(WEEKLY);

		const diff = await service.syncFromSources(WEEKLY);

		assert.ok(diff.some(c => c.key === 'metrics.mrr' && c.old === '$99.9k' && c.next === '$48.6k'), `mrr diff present: ${JSON.stringify(diff)}`);
		assert.deepStrictEqual(service.getLastSyncDiff(WEEKLY), diff, 'the last sync diff is recorded for the editor banner');
		assert.strictEqual(service.getLock(WEEKLY)!.bindings['metrics.mrr'].resolved, '$48.6k', 'the figure is applied to the lock');
	});

	test('syncFromSources records no diff when the figures already match their source', async () => {
		const service = createService();
		await service.loadDocument(WEEKLY); // the seeded lock already resolves to the latest week
		await service.syncFromSources(WEEKLY);
		assert.deepStrictEqual(service.getLastSyncDiff(WEEKLY), [], 'a no-op sync reports an empty diff');
	});

	test('the Formatting flag is fixable; applySkillFix title-cases the headings in place and the grader then passes', async () => {
		const service = createService();
		await service.loadDocument(WEEKLY);

		const before = service.getSkillReport(WEEKLY).find(s => s.id === 'formatting')!;
		const financial = service.getSkillReport(WEEKLY).find(s => s.id === 'financial')!;
		assert.deepStrictEqual(
			{ formattingFlag: before.status, formattingFixable: before.fixable, financialFixable: !!financial.fixable },
			{ formattingFlag: 'flag', formattingFixable: true, financialFixable: false },
		);

		await service.applySkillFix(WEEKLY, 'formatting');

		const heading = service.getDoc(WEEKLY)!.blocks.find(b => b.type === 'heading' && /watch/i.test(b.text))!;
		assert.strictEqual(heading.text, 'What to Watch', 'the flagged heading is title-cased in place (minor word stays lower)');
		assert.strictEqual(service.getSkillReport(WEEKLY).find(s => s.id === 'formatting')!.status, 'pass', 'the grader now passes');
		assert.ok((lastFiles!.get(WEEKLY.toString()) ?? '').includes('## What to Watch'), 'the fix is persisted to disk');
		assert.ok(service.getAudit().some(e => e.newText === 'What to Watch'), 'the fix is audited');
	});

	test('the Financial skill flags a bound figure that does not reconcile to its source', async () => {
		const service = createService([], { badBind: true });
		await service.loadDocument(BADBIND);

		const financial = service.getSkillReport(BADBIND).find(s => s.id === 'financial')!;
		assert.deepStrictEqual(
			{ status: financial.status, detail: financial.detail },
			{ status: 'flag', detail: '1 of 2 figures do not reconcile: metrics.unknown.' },
		);
	});

	test('refreshing re-syncs the value bindings and clears their dirty bits', async () => {
		const service = createService();
		await service.loadDocument(WEEKLY);
		lastFiles!.set(URI.file('/ws/metrics.csv').toString(), METRICS_CSV + '\n25,Jun 26,52000,470,2.2,210');
		await service.checkSources(WEEKLY);
		assert.ok(service.getFreshness(WEEKLY).dirty, 'dirty before refresh');

		await service.refreshFromSources();

		assert.deepStrictEqual(service.getFreshness(WEEKLY).staleBindings, [], 'binding dirty bits cleared after re-sync');
		assert.strictEqual(service.getResolved(WEEKLY).get('metrics.mrr'), '$52.0k', 'lock now holds the new value');
	});

	function seedLock(uri: URI, lock: object): void {
		const stem = uri.path.split('/').pop()!.replace(/\.md$/, '');
		lastFiles!.set(URI.file(`/ws/${stem}.lock.json`).toString(), JSON.stringify(lock));
	}

	test('Review impact on a changed context queues a candidate; approve applies it, updates the lock, and clears the flag', async () => {
		const service = createService();
		// Authored claim bound to the context, anchored to the Commentary sentence.
		seedLock(WEEKLY, {
			version: 1, bindings: {}, context: {},
			claims: { 'commentary-tone': { anchor: 'Growth remained steady this week.', boundTo: ['market-research.md'], kind: 'meaning', state: 'applied' } },
			pins: [], audit: [],
		});
		await service.loadDocument(WEEKLY);

		// The context source changes -> the document is flagged, then the user runs Review impact.
		lastFiles!.set(URI.file('/ws/market-research.md').toString(), MARKET_MD + '\nA new competitor entered the market.\n');
		await service.checkSources(WEEKLY);
		await service.reviewImpact(WEEKLY);

		const pending = service.getPendingForDoc(WEEKLY);
		assert.strictEqual(pending.length, 1, 'one impact candidate queued');
		assert.deepStrictEqual(
			{ kind: pending[0].kind, via: pending[0].via, context: pending[0].contextReviewed, claim: pending[0].claimId, relink: !!pending[0].relink },
			{ kind: 'meaning', via: 'heuristic', context: ['market-research.md'], claim: 'commentary-tone', relink: false },
		);
		const commentaryBlockId = pending[0].blockId;
		assert.notStrictEqual(pending[0].newText, pending[0].oldText, 'a real edit is proposed');

		await service.approve(pending[0].id);

		assert.strictEqual(service.getPendingForDoc(WEEKLY).length, 0, 'cleared from the rail');
		assert.deepStrictEqual(service.getFreshness(WEEKLY).staleContext, [], 'context flag cleared after approve');
		const lock = service.getLock(WEEKLY)!;
		assert.strictEqual(lock.claims['commentary-tone'].state, 'applied', 'claim re-anchored + applied');
		assert.ok(lock.audit.some(e => e.action === 'approved' && e.blockId === commentaryBlockId), 'approval audited in the lock');
	});

	test('a claim whose anchor no longer matches surfaces a re-link prompt instead of mis-attaching', async () => {
		const service = createService();
		seedLock(WEEKLY, {
			version: 1, bindings: {}, context: {},
			claims: { 'orphan': { anchor: 'A sentence that does not appear anywhere in this document.', boundTo: ['market-research.md'], kind: 'meaning', state: 'applied' } },
			pins: [], audit: [],
		});
		await service.loadDocument(WEEKLY);
		const before = service.getDoc(WEEKLY)!.blocks.map(b => b.text).join('\n');

		lastFiles!.set(URI.file('/ws/market-research.md').toString(), MARKET_MD + '\nA new competitor entered the market.\n');
		await service.checkSources(WEEKLY);
		await service.reviewImpact(WEEKLY);

		const pending = service.getPendingForDoc(WEEKLY);
		assert.strictEqual(pending.length, 1, 'one prompt queued');
		assert.ok(pending[0].relink, 'it is a loud re-link prompt, not a silent re-attach');
		assert.ok(/re-link/i.test(pending[0].rationale), `prompt explains the re-link: ${pending[0].rationale}`);
		assert.strictEqual(service.getDoc(WEEKLY)!.blocks.map(b => b.text).join('\n'), before, 'no prose was changed');
	});

	test('with no model available, Review impact is a visible heuristic state (not a silent degrade)', async () => {
		const service = createService();
		seedLock(WEEKLY, {
			version: 1, bindings: {}, context: {},
			claims: { 'commentary-tone': { anchor: 'Growth remained steady this week.', boundTo: ['market-research.md'], kind: 'meaning', state: 'applied' } },
			pins: [], audit: [],
		});
		await service.loadDocument(WEEKLY);
		lastFiles!.set(URI.file('/ws/market-research.md').toString(), MARKET_MD + '\nA new competitor entered the market.\n');
		await service.checkSources(WEEKLY);

		await service.reviewImpact(WEEKLY);

		assert.ok(/no model/i.test(service.getStatus(WEEKLY)), `surfaces the no-model state: ${service.getStatus(WEEKLY)}`);
		assert.strictEqual(service.getPendingForDoc(WEEKLY)[0].via, 'heuristic', 'candidate marked as the heuristic fallback');
	});

	// Shape one Claude /v1/messages reply carrying a single JSON text block (what the proxy returns).
	function modelMessage(json: object): object {
		return { content: [{ type: 'text', text: JSON.stringify(json) }], stop_reason: 'end_turn' };
	}

	test('Review impact with the model proxy reachable produces a real model rewrite (via: model)', async () => {
		const rewrite = 'Growth held steady, though a new competitor now warrants watching.';
		const service = createService([], { model: modelMessage({ newText: rewrite, kind: 'meaning', confidence: 0.9, rationale: 'A new competitor entered the market.' }) });
		seedLock(WEEKLY, {
			version: 1, bindings: {}, context: {},
			claims: { 'commentary-tone': { anchor: 'Growth remained steady this week.', boundTo: ['market-research.md'], kind: 'meaning', state: 'applied' } },
			pins: [], audit: [],
		});
		await service.loadDocument(WEEKLY);
		lastFiles!.set(URI.file('/ws/market-research.md').toString(), MARKET_MD + '\nA new competitor entered the market.\n');
		await service.checkSources(WEEKLY);

		await service.reviewImpact(WEEKLY);

		const pending = service.getPendingForDoc(WEEKLY);
		assert.strictEqual(pending.length, 1, 'one impact candidate queued');
		assert.deepStrictEqual({ via: pending[0].via, newText: pending[0].newText }, { via: 'model', newText: rewrite });
	});

	test('Review impact falls back to the heuristic when the model refuses', async () => {
		const service = createService([], { model: { stop_reason: 'refusal', content: [] } });
		seedLock(WEEKLY, {
			version: 1, bindings: {}, context: {},
			claims: { 'commentary-tone': { anchor: 'Growth remained steady this week.', boundTo: ['market-research.md'], kind: 'meaning', state: 'applied' } },
			pins: [], audit: [],
		});
		await service.loadDocument(WEEKLY);
		lastFiles!.set(URI.file('/ws/market-research.md').toString(), MARKET_MD + '\nA new competitor entered the market.\n');
		await service.checkSources(WEEKLY);

		await service.reviewImpact(WEEKLY);

		assert.strictEqual(service.getPendingForDoc(WEEKLY)[0].via, 'heuristic', 'a refusal degrades to the heuristic candidate');
	});

	// --- Chat agent (criterion 2): a real model-backed conversation over the document + sources ---

	// One Claude reply carrying the Chat agent's JSON contract: a prose reply plus optional edits.
	function chatReply(reply: string, edits: object[] = []): object {
		return modelMessage({ reply, edits });
	}

	test('sendChatMessage records the user turn (with parsed @mentions) and a model-backed assistant reply', async () => {
		const service = createService([], { model: chatReply('metrics.csv shows MRR up 18% to $48.6k this week.') });
		await service.loadDocument(WEEKLY);

		await service.sendChatMessage(WEEKLY, 'Summarise this week @metrics.csv');

		const msgs = service.getChatMessages(WEEKLY);
		assert.deepStrictEqual(
			msgs.map(m => ({ role: m.role, via: m.via, content: m.content, mentions: m.mentions })),
			[
				{ role: 'user', via: undefined, content: 'Summarise this week @metrics.csv', mentions: ['metrics.csv'] },
				{ role: 'assistant', via: 'model', content: 'metrics.csv shows MRR up 18% to $48.6k this week.', mentions: undefined },
			],
		);
		assert.strictEqual(service.isChatBusy(WEEKLY), false, 'no longer busy once the reply lands');
	});

	test('sendChatMessage shows plain-words progress but drives the model with the full instruction (F4)', async () => {
		const service = createService([], { model: chatReply('Drafted the sections.') });
		await service.loadDocument(WEEKLY);
		lastModelBody = undefined;

		await service.sendChatMessage(
			WEEKLY,
			'Generate the first draft of "Week 24" from the "Weekly" template.\n\nTemplate brief:\n## Summary\nSummarise the figures.',
			'Draft "Week 24" from the Weekly template.',
		);

		const user = service.getChatMessages(WEEKLY)[0];
		assert.strictEqual(user.content, 'Draft "Week 24" from the Weekly template.', 'the rail shows plain-words progress');
		assert.ok(!user.content.includes('Template brief'), 'the internal template brief never leaks into the rail');
		assert.ok((user.prompt ?? '').includes('Template brief'), 'the full instruction is kept on the turn for retry');
		assert.ok((lastModelBody ?? '').includes('Template brief'), 'the model is still driven with the full instruction');
	});

	test('a chat survives a relaunch: the same workspace storage restores the transcript, and restoring re-runs nothing', async () => {
		// The residual this proves (issue #312): the strip used to come back without the conversation under it.
		// A "relaunch" here is exactly what it is in the real app - a new service (new process) over the SAME
		// workspace storage, since the slim profile clone is the only thing that ever loses `workspaceStorage`.
		const storage = store.add(new InMemoryStorageService());
		const before = createService([], { model: chatReply('Highlights, Commentary, What to watch.'), storage });
		await before.loadDocument(WEEKLY);
		await before.sendChatMessage(WEEKLY, 'Headings @metrics.csv');
		const callsWhileChatting = lastModelCalls;

		// createService resets lastModelCalls, so ANY model call made while restoring would show below as
		// non-zero - the "a restored transcript is a record, not a replay" guarantee, asserted rather than hoped.
		const after = createService([], { model: chatReply('never asked for'), storage });
		const restored = after.getChatMessages(WEEKLY);

		assert.deepStrictEqual({
			callsWhileChatting,
			transcript: restored.map(m => ({ role: m.role, content: m.content, mentions: m.mentions, restored: m.restored })),
			// The strip and the conversation are restored together, from one load.
			tabs: after.getChatSessions().map(s => s.title),
			callsWhileRestoring: lastModelCalls,
			proposalsQueuedByRestoring: after.getAllPending().length,
			droppedMessages: after.getDroppedChatMessages(),
		}, {
			callsWhileChatting: 1,
			transcript: [
				{ role: 'user', content: 'Headings @metrics.csv', mentions: ['metrics.csv'], restored: true },
				{ role: 'assistant', content: 'Highlights, Commentary, What to watch.', mentions: undefined, restored: true },
			],
			tabs: ['Headings @metrics.csv'],
			callsWhileRestoring: 0,
			proposalsQueuedByRestoring: 0,
			droppedMessages: 0,
		});
	});

	test('closing a chat takes its stored transcript with it, so a relaunch never resurrects it', async () => {
		const storage = store.add(new InMemoryStorageService());
		const before = createService([], { model: chatReply('Kept for now.'), storage });
		await before.loadDocument(WEEKLY);
		await before.sendChatMessage(WEEKLY, 'Headings');
		const closed = before.getActiveChatSession();
		before.closeChatSession(closed);

		const after = createService([], { model: chatReply('never asked for'), storage });
		assert.deepStrictEqual({
			// Closing the last chat opens a fresh one, so there is exactly one tab - and it is not the closed one.
			tabs: after.getChatSessions().map(s => s.title),
			transcript: after.getChatMessages(WEEKLY).length,
			reopenedTheClosedOne: after.getChatSessions().some(s => s.id === closed),
		}, {
			tabs: ['New chat'],
			transcript: 0,
			reopenedTheClosedOne: false,
		});
	});

	test('a restored turn remembers that a change was approved, and that another was rejected', async () => {
		// #312 fix round 2 (V1): a restored turn could say only that changes had been proposed, so the rail said
		// the same thing about all of them - "cleared when the workspace closes". For an APPROVED change that is
		// simply untrue: it is in the document and in the audit trail, both of which this test also checks, so
		// the transcript was contradicting the two records sitting next to it. The outcome is now written onto
		// the turn as the user acts, which is the only moment it exists - the change leaves the pending set
		// immediately, and a restart takes the rest of it.
		const commentary = 'Growth accelerated sharply this week.';
		const watch = 'Activation rate is climbing on the new onboarding flow.';
		const storage = store.add(new InMemoryStorageService());
		const before = createService([], {
			model: chatReply('Sharpened two lines for your approval.', [
				{ heading: 'Commentary', oldText: 'Growth remained steady this week.', newText: commentary, rationale: 'The +18% MRR delta crosses the accelerating threshold.' },
				{ heading: 'What to watch', oldText: 'Activation rate on the new onboarding flow.', newText: watch, rationale: 'Activation is the leading watch item this week.' },
			]),
			storage,
		});
		await before.loadDocument(WEEKLY);
		await before.sendChatMessage(WEEKLY, 'Sharpen the commentary and the watch item');
		const pending = before.getPendingForDoc(WEEKLY);
		await before.approve(pending.find(c => c.newText === commentary)!.id);
		await before.reject(pending.find(c => c.newText === watch)!.id);

		const after = createService([], { model: chatReply('never asked for'), storage });
		await after.loadDocument(WEEKLY);
		const restored = after.getChatMessages(WEEKLY).at(-1)!;
		assert.deepStrictEqual({
			restored: restored.restored,
			proposed: restored.proposedCount,
			approved: restored.approvedCount,
			rejected: restored.rejectedCount,
			// The two records the old sentence contradicted: the approved text really is in the document, and the
			// rejected one really is not.
			commentaryOnDisk: blockText(after, WEEKLY, 'h-commentary'),
			// Nothing is re-queued by restoring, so the restored counts are the ONLY surviving account of it.
			stillPending: after.getAllPending().length,
		}, {
			restored: true,
			proposed: 2,
			approved: 1,
			rejected: 1,
			commentaryOnDisk: commentary,
			stillPending: 0,
		});
	});

	test('getSourcePeek surfaces then-vs-now once the source drifts since last sync (F13)', async () => {
		const service = createService();
		await service.loadDocument(WEEKLY);
		const before = service.getSourcePeek(WEEKLY, ['metrics.mrr'])!.rows.find(r => r.key === 'metrics.mrr')!;
		assert.strictEqual(before.current, undefined, 'no then-vs-now while the source is fresh');

		lastFiles!.set(URI.file('/ws/metrics.csv').toString(), METRICS_CSV + '\n25,Jun 26,52000,470,2.2,210');
		await service.checkSources(WEEKLY);

		const row = service.getSourcePeek(WEEKLY, ['metrics.mrr'])!.rows.find(r => r.key === 'metrics.mrr')!;
		assert.ok(row.current !== undefined && row.current !== row.value, `stale binding shows then (${row.value}) -> now (${row.current})`);
	});

	test('listSources reports a source as not fresh once it drifts - stale never presented as current (F12)', async () => {
		const service = createService();
		await service.loadDocument(WEEKLY);
		const freshBefore = (await service.listSources()).find(s => s.id === 'metrics.csv');
		assert.ok(freshBefore && freshBefore.fresh, 'the source is fresh right after load');

		lastFiles!.set(URI.file('/ws/metrics.csv').toString(), METRICS_CSV + '\n25,Jun 26,52000,470,2.2,210');
		await service.checkSources(WEEKLY);

		const stale = (await service.listSources()).find(s => s.id === 'metrics.csv');
		assert.ok(stale && stale.fresh === false, 'a drifted source is reported not fresh');
	});

	test('cancelChat stops an in-flight reply: no pending changes, busy cleared, a muted stopped turn (plan 27)', async () => {
		// A configured model (opts.model) keeps the first-AI-use gate closed (healthy /healthz -> `needsModelChoice`
		// is false), so this genuine send proceeds to the reply rather than being held - the behaviour under test.
		const service = createService([], { model: chatReply('should never be applied', [{ heading: 'Commentary', oldText: 'Growth accelerated sharply this week.', newText: 'x', rationale: 'y' }]) });
		await service.loadDocument(WEEKLY);

		// The cancellation source is registered once the reply is in flight (after the model-status probe that opens
		// sendChatMessage resolves). Wait until the reply is busy, then cancel: this aborts the streaming model call
		// mid-flight so a partial reply is never committed and the turn is recorded as a muted stop.
		const inFlight = service.sendChatMessage(WEEKLY, 'Rewrite the commentary');
		while (!service.isChatBusy(WEEKLY)) { await new Promise(r => setTimeout(r, 0)); }
		service.cancelChat(WEEKLY);
		await inFlight;

		const msgs = service.getChatMessages(WEEKLY);
		const last = msgs[msgs.length - 1];
		assert.deepStrictEqual(
			{ role: last.role, stopped: last.stopped, busy: service.isChatBusy(WEEKLY), pending: service.getPendingForDoc(WEEKLY).length },
			{ role: 'assistant', stopped: true, busy: false, pending: 0 },
		);
	});

	test('a genuine model error records a failed turn, and retryChat replaces it by re-running the same user message (plan 27 iter 3)', async () => {
		// Both the streaming fetch (no proxy in the test) and the buffered call error, so the ladder ends in an
		// honest failed turn. retryChat drops that failed turn and re-runs the SAME user message (no duplicate).
		const service = createService([], { model: { error: { message: 'boom' } } });
		await service.loadDocument(WEEKLY);

		await service.sendChatMessage(WEEKLY, 'Rewrite the commentary');
		const afterSend = service.getChatMessages(WEEKLY);
		assert.deepStrictEqual(
			afterSend.map(m => ({ role: m.role, failed: m.failed })),
			[{ role: 'user', failed: undefined }, { role: 'assistant', failed: true }],
			'a failed model call records a user turn + a failed assistant turn',
		);
		assert.strictEqual(afterSend[afterSend.length - 1].content, 'The model call failed.', 'the failed turn carries the honest error copy');

		service.retryChat(WEEKLY);
		await Promise.resolve();
		// Drain the re-run (it fails again against the same error payload).
		while (service.isChatBusy(WEEKLY)) { await new Promise(r => setTimeout(r, 0)); }

		const afterRetry = service.getChatMessages(WEEKLY);
		assert.deepStrictEqual(
			afterRetry.map(m => ({ role: m.role, failed: m.failed })),
			[{ role: 'user', failed: undefined }, { role: 'assistant', failed: true }],
			'retry replaced the failed turn in place - still exactly one user turn and one failed assistant turn',
		);
	});

	test('retryChat is a no-op after a successful reply (nothing to retry)', async () => {
		const service = createService([], { model: chatReply('All good.') });
		await service.loadDocument(WEEKLY);
		await service.sendChatMessage(WEEKLY, 'Summarise this week');
		const before = service.getChatMessages(WEEKLY).length;

		service.retryChat(WEEKLY);
		await Promise.resolve();

		assert.strictEqual(service.getChatMessages(WEEKLY).length, before, 'a successful assistant turn is left untouched');
		assert.strictEqual(service.isChatBusy(WEEKLY), false, 'no new reply is kicked off');
	});

	test('the chat prompt carries the document, its resolved figures, and the @mentioned source', async () => {
		const service = createService([], { model: chatReply('Done.') });
		await service.loadDocument(WEEKLY);
		lastModelBody = undefined;

		await service.sendChatMessage(WEEKLY, 'Check the numbers @metrics.csv');

		const body = lastModelBody ?? '';
		assert.ok(body.includes('Weekly Operating Summary'), 'prompt includes the document title');
		assert.ok(body.includes('$48.6k'), 'prompt includes the resolved figure value');
		assert.ok(body.includes('week,mrr') || body.includes('metrics.csv'), `prompt includes the mentioned source: ${body.slice(0, 120)}`);
	});

	test('a chat reply that proposes an edit queues it to the Review rail; approve applies it to the prose', async () => {
		const newText = 'Growth accelerated this week.';
		const service = createService([], {
			model: chatReply('I drafted a sharper commentary line for your approval.', [
				{ heading: 'Commentary', oldText: 'Growth remained steady this week.', newText, rationale: 'The +18% MRR delta crosses the accelerating threshold.' },
			]),
		});
		await service.loadDocument(WEEKLY);

		await service.sendChatMessage(WEEKLY, 'Tighten the commentary');

		const pending = service.getPendingForDoc(WEEKLY);
		assert.strictEqual(pending.length, 1, 'one proposed edit queued from chat');
		assert.deepStrictEqual(
			{ via: pending[0].via, kind: pending[0].kind, newText: pending[0].newText },
			{ via: 'model', kind: 'meaning', newText },
		);
		const assistant = service.getChatMessages(WEEKLY).at(-1)!;
		assert.ok((assistant.steps ?? []).some(s => s.status === 'queued'), 'the assistant turn renders a queued tool-step');

		await service.approve(pending[0].id);
		assert.strictEqual(blockText(service, WEEKLY, 'h-commentary'), newText, 'approving the chat-proposed edit rewrites the block');
	});

	// #253: the editor action bar's "Approve all in this doc" must apply EVERY pending change for the open
	// document, addressing them through the proposals' OWN docId (pendingDocIdFor + approveAll) - the path the
	// editor pane now takes. The audit caught it silently no-opping: routing the apply through a re-derived
	// `this._resource` filtered to an empty set. This pins the fixed path end to end, after a tab switch (a
	// second document loaded in between) mirrors the exact audit repro, so a regression can never re-hide it.
	test('#253: the editor-bar "Approve all in this doc" applies every pending change via the proposals own docId, after a tab switch', async () => {
		const commentary = 'Growth accelerated this week.';
		const watch = 'Activation rate is climbing on the new onboarding flow.';
		const service = createService([], {
			boardNote: true,
			model: chatReply('Sharpened two lines for your approval.', [
				{ heading: 'Commentary', oldText: 'Growth remained steady this week.', newText: commentary, rationale: 'The +18% MRR delta crosses the accelerating threshold.' },
				{ heading: 'What to watch', oldText: 'Activation rate on the new onboarding flow.', newText: watch, rationale: 'Activation is the leading watch item this week.' },
			]),
		});
		await service.loadDocument(WEEKLY);
		await service.sendChatMessage(WEEKLY, 'Sharpen the commentary and the watch item');
		// A tab switch: another document is loaded (and becomes the last-loaded state), exactly as the audit
		// repro opened Board Note after the Appendix. The pending changes still belong to WEEKLY.
		await service.loadDocument(BOARD);

		// The editor action bar's approveAllDoc handler: resolve the pending set + its own docId, then apply.
		const pendingBefore = service.getPendingForDoc(WEEKLY);
		const docId = service.pendingDocIdFor(WEEKLY);
		assert.ok(docId, 'the open document reports the docId its pending changes are keyed under');
		await service.approveAll(docId!);

		assert.deepStrictEqual(
			{
				queuedBefore: pendingBefore.length,
				docId,
				commentary: blockText(service, WEEKLY, 'h-commentary'),
				watch: blockText(service, WEEKLY, 'h-what-to-watch'),
				pendingAfter: service.getPendingForDoc(WEEKLY).length,
			},
			{ queuedBefore: 2, docId: WEEKLY.toString(), commentary, watch, pendingAfter: 0 },
		);
	});

	// --- Tweak: amend-before-approve (plan 31 iter 3, D31-B) ---

	test('amendChange then approve applies the human-edited text and audits it via tweaked', async () => {
		const service = createService([], {
			model: chatReply('Drafted a sharper commentary line.', [
				{ heading: 'Commentary', oldText: 'Growth remained steady this week.', newText: 'Growth accelerated this week.', rationale: 'r' },
			]),
		});
		await service.loadDocument(WEEKLY);
		await service.sendChatMessage(WEEKLY, 'Tighten the commentary');
		const change = service.getPendingForDoc(WEEKLY)[0];

		service.amendChange(change.id, 'Growth accelerated sharply this week.');
		// The proposal re-renders as still-pending with the amended text (not approved yet).
		const amended = service.getPendingForDoc(WEEKLY)[0];
		assert.strictEqual(amended.newText, 'Growth accelerated sharply this week.', 'pending change carries the human amendment');
		assert.strictEqual(amended.tweaked, true, 'flagged tweaked');

		await service.approve(change.id);
		assert.strictEqual(blockText(service, WEEKLY, 'h-commentary'), 'Growth accelerated sharply this week.', 'the amended text is what lands in the prose');
		const entry = service.getLock(WEEKLY)!.audit.find(e => e.action === 'approved')!;
		assert.strictEqual(entry.via, 'tweaked', 'the audit records the human tweak');
		assert.strictEqual(entry.newText, 'Growth accelerated sharply this week.', 'the audit records the amended text');
	});

	test('amendChange then reject discards cleanly, applying nothing', async () => {
		const service = createService([], {
			model: chatReply('Drafted a sharper commentary line.', [
				{ heading: 'Commentary', oldText: 'Growth remained steady this week.', newText: 'Growth accelerated this week.', rationale: 'r' },
			]),
		});
		await service.loadDocument(WEEKLY);
		await service.sendChatMessage(WEEKLY, 'Tighten the commentary');
		const change = service.getPendingForDoc(WEEKLY)[0];

		service.amendChange(change.id, 'Growth accelerated sharply this week.');
		await service.reject(change.id);

		assert.strictEqual(service.getPendingForDoc(WEEKLY).length, 0, 'the change is cleared from the rail');
		assert.strictEqual(blockText(service, WEEKLY, 'h-commentary'), 'Growth remained steady this week.', 'the prose is untouched by a rejected tweak');
		assert.ok(!service.getLock(WEEKLY)!.audit.some(e => e.action === 'approved'), 'no approval audited');
	});

	test('amendChange is a no-op for an unknown id, an empty amendment, or a no-op amendment', async () => {
		const service = createService([], {
			model: chatReply('Drafted a sharper commentary line.', [
				{ heading: 'Commentary', oldText: 'Growth remained steady this week.', newText: 'Growth accelerated this week.', rationale: 'r' },
			]),
		});
		await service.loadDocument(WEEKLY);
		await service.sendChatMessage(WEEKLY, 'Tighten the commentary');
		const change = service.getPendingForDoc(WEEKLY)[0];

		service.amendChange('no-such-id', 'x');
		service.amendChange(change.id, '   ');
		service.amendChange(change.id, 'Growth accelerated this week.');
		const after = service.getPendingForDoc(WEEKLY)[0];
		assert.strictEqual(after.newText, 'Growth accelerated this week.', 'text unchanged by the no-op amendments');
		assert.ok(!after.tweaked, 'not flagged tweaked by a no-op amendment');
	});

	// --- decision-68: a chat edit to one list item must not destroy its siblings on approve (plan 31 iter 1)

	test('a chat edit to ONE list item preserves its sibling items on approve (decision-68 data loss)', async () => {
		const LIST = URI.file('/ws/Growth Levers.md');
		// A four-item list is a SINGLE block (parse splits on blank lines). The model targets item 2 only.
		const LIST_MD = [
			'# Growth Levers', '', 'Our priorities this quarter:', '',
			'- Increase revenue this quarter',
			'- Increase revenue next quarter',
			'- Increase revenue this year',
			'- Increase revenue next year',
		].join('\n') + '\n';
		const service = createService([], {
			model: chatReply('Sharpened the second lever.', [
				{ heading: 'Growth Levers', oldText: '- Increase revenue next quarter', newText: '- Increase revenue substantially next quarter', rationale: 'r' },
			]),
		});
		lastFiles!.set(LIST.toString(), LIST_MD);
		await service.loadDocument(LIST);

		await service.sendChatMessage(LIST, 'Sharpen the second lever');

		const pending = service.getPendingForDoc(LIST);
		assert.strictEqual(pending.length, 1, 'the list-item edit is queued');
		// The proposal is anchored at the single <li>, not the whole list block (pre-fix it was best.text).
		assert.strictEqual(pending[0].oldText, '- Increase revenue next quarter', 'oldText scoped to the targeted item');

		await service.approve(pending[0].id);

		const listBlock = service.getDoc(LIST)!.blocks.find(b => b.text.includes('Increase revenue'))!;
		assert.strictEqual(listBlock.text, [
			'- Increase revenue this quarter',
			'- Increase revenue substantially next quarter',
			'- Increase revenue this year',
			'- Increase revenue next year',
		].join('\n'), 'only item 2 changed; items 1/3/4 survive byte-identical');
		const onDisk = lastFiles!.get(LIST.toString()) ?? '';
		assert.ok(
			onDisk.includes('- Increase revenue this quarter') && onDisk.includes('- Increase revenue this year') && onDisk.includes('- Increase revenue next year'),
			`all sibling items persisted to disk: ${onDisk}`,
		);
	});

	test('a chat edit to a plain list item keeps a bound-figure sibling intact', async () => {
		const KPIS = URI.file('/ws/KPIs.md');
		const KPIS_MD = [
			'---', 'title: KPIs', 'sources:', '  - metrics.csv', '---', '',
			'## Highlights', '', 'This quarter:', '',
			'- Revenue grew steadily',
			'- Costs stayed flat',
			'- Cash balance is [$41.2k](bind:metrics.mrr)',
		].join('\n') + '\n';
		const service = createService([], {
			model: chatReply('Tightened the costs line.', [
				{ heading: 'Highlights', oldText: '- Costs stayed flat', newText: '- Costs fell sharply', rationale: 'r' },
			]),
		});
		lastFiles!.set(KPIS.toString(), KPIS_MD);
		await service.loadDocument(KPIS);

		await service.sendChatMessage(KPIS, 'Tighten the costs line');
		const pending = service.getPendingForDoc(KPIS);
		assert.strictEqual(pending.length, 1, 'the plain-item edit is queued even though a sibling item is bound');
		assert.strictEqual(pending[0].oldText, '- Costs stayed flat', 'anchored on the plain item, not the bound one');

		await service.approve(pending[0].id);
		const listBlock = service.getDoc(KPIS)!.blocks.find(b => b.text.includes('Cash balance'))!;
		assert.ok(listBlock.text.includes('- Costs fell sharply'), 'the plain item was rewritten');
		assert.ok(/- Cash balance is \[[^\]]+\]\(bind:metrics\.mrr\)/.test(listBlock.text), 'the bound-figure sibling survives with its bind link intact');
		assert.ok(listBlock.text.includes('- Revenue grew steadily'), 'the other plain sibling survives too');
	});

	test('a chat edit that targets a BOUND list item is skipped (never touch a figure)', async () => {
		const KPIS = URI.file('/ws/KPIs.md');
		const KPIS_MD = [
			'---', 'title: KPIs', 'sources:', '  - metrics.csv', '---', '',
			'## Highlights', '', 'This quarter:', '',
			'- Revenue grew steadily',
			'- Cash balance is [$41.2k](bind:metrics.mrr)',
		].join('\n') + '\n';
		const service = createService([], {
			model: chatReply('Rewrote the cash line.', [
				{ heading: 'Highlights', oldText: '- Cash balance is $41.2k', newText: '- Cash balance is now much higher', rationale: 'r' },
			]),
		});
		lastFiles!.set(KPIS.toString(), KPIS_MD);
		await service.loadDocument(KPIS);

		await service.sendChatMessage(KPIS, 'Rewrite the cash line');
		assert.strictEqual(service.getPendingForDoc(KPIS).length, 0, 'an edit whose target item carries a bind is not queued');
	});

	test('chat is multi-turn: a follow-up carries the prior turns to the model (F3 over current state)', async () => {
		const service = createService([], { model: chatReply('Done.') });
		await service.loadDocument(WEEKLY);
		await service.sendChatMessage(WEEKLY, 'Give me three growth levers');
		lastModelBody = undefined;

		await service.sendChatMessage(WEEKLY, 'Change a couple of them');

		const body = lastModelBody ?? '';
		assert.ok(body.includes('Conversation so far'), 'the follow-up prompt includes the transcript');
		assert.ok(body.includes('Give me three growth levers'), 'the follow-up prompt carries the earlier user turn');
	});

	test('a chat reply that GENERATES content queues an insertion; approve splices a new block into the doc (F3)', async () => {
		const newText = '1. Expand the trial\n2. Win back churned accounts\n3. Add an annual plan';
		const service = createService([], {
			model: modelMessage({
				reply: 'Here is a starting top-3 list.', edits: [], inserts: [
					{ afterHeading: 'Commentary', newText, rationale: 'Drafted the list you asked for.' },
				]
			}),
		});
		await service.loadDocument(WEEKLY);

		await service.sendChatMessage(WEEKLY, 'Generate me a top-3 list of growth levers');

		const pending = service.getPendingForDoc(WEEKLY);
		assert.strictEqual(pending.length, 1, 'one insertion queued');
		assert.deepStrictEqual(
			{ insert: pending[0].insert, oldText: pending[0].oldText, newText: pending[0].newText },
			{ insert: true, oldText: '', newText },
		);

		await service.approve(pending[0].id);
		const blocks = service.getDoc(WEEKLY)!.blocks;
		assert.ok(blocks.some(b => b.text === newText), 'approving the insertion adds the new content as a block');
		assert.strictEqual(service.getPendingForDoc(WEEKLY).length, 0, 'cleared from the rail after approve');
	});

	test('approveAll accepts every pending change for a document at once (F6 accept-all)', async () => {
		const service = createService([], {
			model: modelMessage({
				reply: 'Edited and added.', edits: [
					{ heading: 'Commentary', oldText: 'Growth remained steady this week.', newText: 'Growth accelerated this week.', rationale: 'r' },
				], inserts: [
					{ afterHeading: 'Commentary', newText: 'A new closing note.', rationale: 'r' },
				]
			}),
		});
		await service.loadDocument(WEEKLY);

		await service.sendChatMessage(WEEKLY, 'Tighten the commentary and add a closing note');
		assert.strictEqual(service.getPendingForDoc(WEEKLY).length, 2, 'an edit and an insertion are queued');

		await service.approveAll(WEEKLY.toString());
		assert.strictEqual(service.getPendingForDoc(WEEKLY).length, 0, 'accept-all clears the whole rail');
		const blocks = service.getDoc(WEEKLY)!.blocks;
		assert.ok(blocks.some(b => b.text === 'A new closing note.'), 'the insertion landed');
		assert.ok(blocks.some(b => b.text === 'Growth accelerated this week.'), 'the edit landed');
	});

	// --- multi-document review (plan 18): reject-all mirrors of approveAll ---

	// Queue one end-of-document insertion into each of two docs by chatting on each in turn. The single
	// canned model reply (an insert with an empty afterHeading) lands in whichever doc is active, so this
	// builds genuine cross-document pending state without depending on the iter-3 fan-out.
	async function queuePendingInTwoDocs(): Promise<LivingDocsService> {
		const service = createService([], {
			boardNote: true,
			model: modelMessage({ reply: 'Added.', edits: [], inserts: [{ afterHeading: '', newText: 'A shared closing note.', rationale: 'r' }] }),
		});
		await service.loadDocument(WEEKLY);
		await service.sendChatMessage(WEEKLY, 'Add a closing note');
		await service.loadDocument(BOARD);
		await service.sendChatMessage(BOARD, 'Add a closing note');
		return service;
	}

	test('rejectAll(docId) discards one document\'s pending changes and leaves the others untouched', async () => {
		const service = await queuePendingInTwoDocs();
		assert.strictEqual(service.getAllPending().length, 2, 'precondition: one pending change in each of two docs');

		await service.rejectAll(WEEKLY.toString());

		assert.deepStrictEqual(
			{ weekly: service.getPendingForDoc(WEEKLY).length, board: service.getPendingForDoc(BOARD).length },
			{ weekly: 0, board: 1 },
			'rejectAll clears the named doc only',
		);
		assert.ok(service.getAudit().some(e => e.action === 'rejected' && e.docTitle === 'Board Note') === false
			&& service.getAudit().some(e => e.action === 'rejected'), 'the rejection is audited for the cleared doc');
	});

	test('rejectAllPending() discards every pending change across all documents in one action', async () => {
		const service = await queuePendingInTwoDocs();
		assert.strictEqual(service.getAllPending().length, 2, 'precondition: pending across two docs');

		await service.rejectAllPending();

		assert.strictEqual(service.getAllPending().length, 0, 'reject-all clears every doc');
	});

	test('approveAllPending() applies every pending change across all documents in one action (chat-level accept-all)', async () => {
		const service = await queuePendingInTwoDocs();
		assert.strictEqual(service.getAllPending().length, 2, 'precondition: pending across two docs');

		await service.approveAllPending();

		assert.strictEqual(service.getAllPending().length, 0, 'accept-all clears every doc');
		assert.ok(
			service.getDoc(WEEKLY)!.blocks.some(b => b.text === 'A shared closing note.')
			&& service.getDoc(BOARD)!.blocks.some(b => b.text === 'A shared closing note.'),
			'the change landed in both documents',
		);
	});

	// Regression (issues #248 + #253, the stale-document-identity family). Block ids are POSITIONAL
	// (`parseLivingDoc` stamps paragraphs `b-0`, `b-1`, ...), so the same id (`b-3` here, the second body
	// paragraph) exists in BOTH the Weekly and the Board Note. The Weekly is loaded first (it is the tab open
	// at launch); the user then switches to the Board Note and approves a change to ITS `b-3`. The old audit
	// builder resolved `docTitle` by searching every open doc for the first one holding that block id and
	// taking its title - which returned the Weekly (loaded first), stamping the wrong document onto a Board
	// Note approval (#248). Approve now audits under the OWNING document's title regardless of load order, so
	// the identity is pinned after a tab switch; the same fix removes the stale-identity root cause of #253.
	test('an approve after a tab switch audits under the OWNING document, not the doc that was open first (#248/#253)', async () => {
		const service = createService([], {
			boardNote: true,
			model: modelMessage({ reply: 'Sharpened.', edits: [{ heading: 'Note to the board', oldText: 'Momentum is steady this week.', newText: 'Momentum accelerated this week.', rationale: 'r' }] }),
		});
		// Load the Weekly first (the launch tab), THEN switch to the Board Note and chat there. Both docs carry
		// a positional `b-3` paragraph, so a docTitle guessed from block id alone would collide across them.
		await service.loadDocument(WEEKLY);
		await service.loadDocument(BOARD);
		await service.sendChatMessage(BOARD, 'Sharpen the note to the board');
		const change = service.getPendingForDoc(BOARD)[0];

		await service.approve(change.id);

		const entry = service.getLock(BOARD)!.audit.find(e => e.action === 'approved')!;
		assert.deepStrictEqual(
			{ docTitle: entry.docTitle, blockId: entry.blockId, weeklyAudited: service.getLock(WEEKLY)!.audit.length },
			{ docTitle: 'Board Note', blockId: 'b-3', weeklyAudited: 0 },
			'the approval audits under the Board Note (its own state), not the Weekly that was open first',
		);
	});

	// --- working set (plan 18 iter 2): the documents a chat instruction edits across (D-A/D-B) ---

	test('addFolderToWorkingSet puts every folder document into the chat working set as titled chips', async () => {
		const service = createService([], { boardNote: true });
		await service.loadDocument(WEEKLY);

		await service.addFolderToWorkingSet(WEEKLY);

		assert.deepStrictEqual(
			service.getWorkingSet(WEEKLY).map(d => d.title).sort(),
			['Board Note', 'Market research', 'Team Notes', 'Weekly Operating Summary'],
			'a folder expands to all its Markdown documents',
		);
	});

	test('addToWorkingSet de-duplicates by resource and removeFromWorkingSet drops one document', async () => {
		const service = createService([], { boardNote: true });
		await service.loadDocument(WEEKLY);

		await service.addToWorkingSet(WEEKLY, [BOARD, README]);
		await service.addToWorkingSet(WEEKLY, [BOARD]);
		assert.strictEqual(service.getWorkingSet(WEEKLY).length, 2, 'adding the same document twice does not duplicate it');

		service.removeFromWorkingSet(WEEKLY, BOARD);
		assert.deepStrictEqual(
			service.getWorkingSet(WEEKLY).map(d => d.resource.toString()),
			[README.toString()],
			'removeFromWorkingSet drops only the named document',
		);
	});

	test('the working set is per chat (active document): adding to one does not leak into another', async () => {
		const service = createService([], { boardNote: true });
		await service.loadDocument(WEEKLY);
		await service.loadDocument(BOARD);

		await service.addToWorkingSet(WEEKLY, [README]);

		assert.deepStrictEqual(
			{ weekly: service.getWorkingSet(WEEKLY).length, board: service.getWorkingSet(BOARD).length },
			{ weekly: 1, board: 0 },
			'the working set is scoped to the chat it was added from',
		);
	});

	test('getWorkingSetCandidates lists folder documents not already in the working set', async () => {
		const service = createService([], { boardNote: true });
		await service.loadDocument(WEEKLY);
		await service.addToWorkingSet(WEEKLY, [BOARD]);

		const candidates = (await service.getWorkingSetCandidates(WEEKLY)).map(d => d.title).sort();
		assert.deepStrictEqual(
			candidates,
			['Market research', 'Team Notes', 'Weekly Operating Summary'],
			'the picker offers every folder doc except those already added',
		);
	});

	// --- multi-document fan-out (plan 18 iter 3): one instruction edits the whole working set (D-C) ---

	// One model reply carrying the per-document edit map for the working set.
	function multiReply(reply: string, docs: object[]): object {
		return modelMessage({ reply, docs });
	}

	test('with a working set, one chat instruction fans out edits to every document via a single model call (D-C)', async () => {
		const service = createService([], {
			boardNote: true,
			proxyUrl: DEAD_PROXY,
			model: multiReply('Changed blue to red across all three.', [
				{ doc: 'Weekly Operating Summary', edits: [{ oldText: 'Growth remained steady this week.', newText: 'Growth is now red-themed.', rationale: 'r' }] },
				{ doc: 'Board Note', edits: [{ oldText: 'Momentum is steady this week.', newText: 'Momentum is now red-themed.', rationale: 'r' }] },
				{ doc: 'Team Notes', inserts: [{ afterHeading: '', newText: 'Primary colour is now red.', rationale: 'r' }] },
			]),
		});
		await service.loadDocument(WEEKLY);
		await service.addToWorkingSet(WEEKLY, [WEEKLY, BOARD, README]);
		lastModelCalls = 0;

		await service.sendChatMessage(WEEKLY, 'change the primary colour from blue to red');

		assert.strictEqual(lastModelCalls, 1, 'D-C: the working set is edited with ONE model call, not one per doc');
		const docIds = new Set(service.getAllPending().map(c => c.docId));
		assert.deepStrictEqual(
			[...docIds].sort(),
			[BOARD.toString(), README.toString(), WEEKLY.toString()].sort(),
			'proposals are queued across all three working-set documents',
		);
	});

	// --- fan-out context budgeting (plan 30, track 3, D30-B): batches to a budget, merges keyed edits ---

	test('a working set over the fan-out budget is sent in BATCHES, and the per-batch edits merge to the right docs', async () => {
		// Two documents each padded to ~1000 tokens (~4000 chars): together they exceed a 2000-token budget's
		// usable per-batch space (budget minus the fixed prompt overhead), so the fan-out splits them into two
		// single-doc batches. Each batch gets its OWN reply (modelSequence): batch 1 edits the Weekly, batch 2
		// the Board. The merge must queue each batch's edit against its own document - two model calls, two docs.
		// Padding blocks are blank-line separated so they are their OWN paragraphs - the editable anchor block
		// ("Growth remained steady this week.") stays short so the edit still matches it, while the doc as a
		// whole grows past the per-document budget.
		const padBlocks = Array.from({ length: 40 }, (_, i) => `Background context paragraph ${i} that pads the document body so it approaches the per-document budget.`).join('\n\n');
		const weeklyBig = WEEKLY_MD.replace('Growth remained steady this week.', `Growth remained steady this week.\n\n${padBlocks}`);
		const boardBig = BOARD_MD.replace('Momentum is steady this week.', `Momentum is steady this week.\n\n${padBlocks}`);
		const service = createService([], {
			boardNote: true,
			proxyUrl: DEAD_PROXY,
			fanoutBudget: 2000,
			modelSequence: [
				multiReply('Weekly done.', [{ doc: 'Weekly Operating Summary', edits: [{ oldText: 'Growth remained steady this week.', newText: 'Growth is now red-themed.', rationale: 'r' }] }]),
				multiReply('Board done.', [{ doc: 'Board Note', edits: [{ oldText: 'Momentum is steady this week.', newText: 'Momentum is now red-themed.', rationale: 'r' }] }]),
			],
		});
		lastFiles!.set(WEEKLY.toString(), weeklyBig);
		lastFiles!.set(BOARD.toString(), boardBig);
		await service.loadDocument(WEEKLY);
		await service.addToWorkingSet(WEEKLY, [WEEKLY, BOARD]);
		lastModelCalls = 0;

		await service.sendChatMessage(WEEKLY, 'change the primary colour from blue to red');

		// Two batches => two model calls (not one over-large call, and not one per attempt).
		assert.strictEqual(lastModelCalls, 2, 'the over-budget working set is sent in two batches');
		const docIds = new Set(service.getAllPending().map(c => c.docId));
		assert.deepStrictEqual(
			[...docIds].sort(),
			[BOARD.toString(), WEEKLY.toString()].sort(),
			'each batch\'s edit is merged against its own document (no drop, no double-count)',
		);
		// Exactly one pending change per document - the merge did not double-queue across batches.
		assert.strictEqual(service.getPendingForDoc(WEEKLY).length, 1, 'the Weekly has exactly its own one proposal');
		assert.strictEqual(service.getPendingForDoc(BOARD).length, 1, 'the Board has exactly its own one proposal');
		// The fan-out progress records the two-batch run for the run screen's "batch K of M" chip (no oversize).
		const progress = service.getFanoutProgress(WEEKLY);
		assert.strictEqual(progress?.batchCount, 2, 'the run screen sees a two-batch fan-out');
		assert.deepStrictEqual(progress?.oversizeDocIds, [], 'no document was oversize');
		// The assistant turn carries the batch steps so the rail shows the run proceeded in batches.
		const assistant = service.getChatMessages(WEEKLY).at(-1)!;
		assert.ok(assistant.steps?.some(s => /Batch 1 of 2/.test(s.label)), 'a Batch 1 of 2 step is surfaced');
		assert.ok(assistant.steps?.some(s => /Batch 2 of 2/.test(s.label)), 'a Batch 2 of 2 step is surfaced');
	});

	test('a document larger than the whole budget is flagged oversize, never sent, others still change (no silent drop)', async () => {
		// README is padded to a large body; the budget (2000) is far smaller, so it cannot fit any batch and
		// is set aside as oversize. The Weekly still fits and is edited. The oversize doc is reported honestly.
		const bigBody = `---\ntitle: Team Notes\n---\n\n## Team Notes\n\n${'padding sentence to blow the budget. '.repeat(400)}\n`;
		const service = createService([], {
			fanoutBudget: 2000,
			proxyUrl: DEAD_PROXY,
			modelSequence: [
				multiReply('Weekly done.', [{ doc: 'Weekly Operating Summary', edits: [{ oldText: 'Growth remained steady this week.', newText: 'Growth is now red-themed.', rationale: 'r' }] }]),
			],
		});
		lastFiles!.set(README.toString(), bigBody);
		await service.loadDocument(WEEKLY);
		await service.addToWorkingSet(WEEKLY, [WEEKLY, README]);
		lastModelCalls = 0;

		await service.sendChatMessage(WEEKLY, 'change the primary colour from blue to red');

		// Only the fitting document is edited; the oversize document produced no proposal and was never sent.
		const docIds = new Set(service.getAllPending().map(c => c.docId));
		assert.deepStrictEqual([...docIds], [WEEKLY.toString()], 'only the fitting document is edited');
		const progress = service.getFanoutProgress(WEEKLY);
		assert.deepStrictEqual(progress?.oversizeDocIds, [README.toString()], 'the oversize document is flagged, not dropped silently');
		const assistant = service.getChatMessages(WEEKLY).at(-1)!;
		assert.ok(assistant.steps?.some(s => /too large for this run/.test(s.label)), 'the oversize document reads "too large for this run"');
	});

	// --- F14 (issue #123): a model outage on the fan-out path must never render as "no changes proposed" ---

	test('a fan-out with the model down names EVERY failed doc + carries them for surgical retry, never an all-clear (F14)', async () => {
		// /healthz is healthy (model probes available) but every /v1/messages errors (the outage): the fan-out
		// must record each target document as failed, surface a NAMED unreachable error listing them, queue NO
		// proposals, and never read as a silent "no changes proposed". The run screen sees the same failed set.
		const service = createService([], { boardNote: true, proxyUrl: DEAD_PROXY, model: { error: { message: 'model proxy unreachable' } } });
		await service.loadDocument(WEEKLY);
		await service.addToWorkingSet(WEEKLY, [WEEKLY, BOARD, README]);

		await service.sendChatMessage(WEEKLY, 'tighten every note across the project');

		const turn = service.getChatMessages(WEEKLY).at(-1)!;
		assert.ok(turn.failedDocs && turn.failedDocs.length === 3, 'all three fan-out documents are recorded as failed');
		assert.deepStrictEqual(
			[...turn.failedDocs!.map(d => d.id)].sort(),
			[WEEKLY.toString(), BOARD.toString(), README.toString()].sort(),
			'the failed set is exactly the working set',
		);
		assert.ok(/The model was not available/.test(turn.content), 'the turn names the model as unreachable');
		assert.ok(/Retry failed/.test(turn.content), 'the turn offers the surgical retry');
		assert.ok(!/no changes|nothing to change|did not find anything/i.test(turn.content), 'never a silent all-clear');
		assert.strictEqual(service.getAllPending().length, 0, 'nothing is proposed when the model was down');
		// The run screen reads the failed docs so their tiles render "model unreachable", not "no change".
		const progress = service.getFanoutProgress(WEEKLY);
		assert.deepStrictEqual(
			[...(progress?.failedDocIds ?? [])].sort(),
			[WEEKLY.toString(), BOARD.toString(), README.toString()].sort(),
			'the fan-out progress carries the failed docs for the run screen',
		);
	});

	test('retryFailedDocs re-runs ONLY the failed documents (surgical retry, F14)', async () => {
		// First run: the model is down for the fan-out, so all three docs fail. Then the model recovers and the
		// surgical retry re-runs ONLY the failed docs - proven by the retry's single model call carrying just the
		// failed documents' bodies, and by proposals now landing for them.
		const service = createService([], {
			boardNote: true,
			proxyUrl: DEAD_PROXY,
			modelSequence: [
				// Calls 1..N (the down run + its single silent retry per batch) all error.
				{ error: { message: 'model proxy unreachable' } },
				{ error: { message: 'model proxy unreachable' } },
				// The retry run (model recovered) returns real edits across the three documents.
				multiReply('Recovered.', [
					{ doc: 'Weekly Operating Summary', edits: [{ oldText: 'Growth remained steady this week.', newText: 'Growth recovered.', rationale: 'r' }] },
					{ doc: 'Board Note', edits: [{ oldText: 'Momentum is steady this week.', newText: 'Momentum recovered.', rationale: 'r' }] },
				]),
			],
		});
		await service.loadDocument(WEEKLY);
		await service.addToWorkingSet(WEEKLY, [WEEKLY, BOARD, README]);
		await service.sendChatMessage(WEEKLY, 'tighten every note');
		assert.ok(service.getChatMessages(WEEKLY).at(-1)!.failedDocs?.length === 3, 'the first run failed all three');

		// Do NOT reset lastModelCalls (the mock indexes modelSequence by it); lastModelBody holds the LAST call.
		lastModelBody = undefined;
		service.retryFailedDocs(WEEKLY);
		await new Promise(r => setTimeout(r, 0));
		// Drain the async retry delivery.
		for (let i = 0; i < 50 && service.isChatBusy(WEEKLY); i++) { await new Promise(r => setTimeout(r, 5)); }

		// The retry sends a single fan-out call whose body contains only the failed documents (all three here).
		assert.ok((lastModelBody ?? '').includes('Weekly Operating Summary'), 'the retry re-runs the failed Weekly');
		assert.ok((lastModelBody ?? '').includes('Board Note'), 'the retry re-runs the failed Board');
		// Proposals now land for the recovered documents, and the last turn is no longer a failure.
		assert.ok(service.getAllPending().length >= 1, 'the recovered retry lands proposals');
		assert.ok(!service.getChatMessages(WEEKLY).at(-1)!.failedDocs, 'the retry turn is not a failure once recovered');
	});

	test('with NO working set, chat still edits only the active document (backwards compatible, D-B)', async () => {
		const service = createService([], {
			boardNote: true,
			// A single-doc reply shape; were the fan-out wrongly triggered it would look for a `docs` array.
			model: chatReply('Tightened it.', [{ heading: 'Commentary', oldText: 'Growth remained steady this week.', newText: 'Growth accelerated.', rationale: 'r' }]),
		});
		await service.loadDocument(WEEKLY);

		await service.sendChatMessage(WEEKLY, 'tighten the commentary');

		const docIds = new Set(service.getAllPending().map(c => c.docId));
		assert.deepStrictEqual([...docIds], [WEEKLY.toString()], 'with no set, only the active doc is edited');
	});

	// --- per-doc autonomy policy is ENFORCED (issue #257): the dial gates the propose/apply pipeline, not just
	// its own render. All three positions are pinned live end-to-end, in chat, figure sync, and fan-out. ---

	// Author WEEKLY_MD with an explicit `policy:` line (the dial writes exactly this scalar to frontmatter).
	function weeklyWithPolicy(policy: string): string {
		return WEEKLY_MD.replace('subtitle: Week 23', `subtitle: Week 23\npolicy: ${policy}`);
	}

	test('#257 "never": a chat edit request creates NO proposal and the reply names the doc + policy (no silent nothing)', async () => {
		const service = createService([], {
			model: chatReply('Here is a sharper commentary line.', [
				{ heading: 'Commentary', oldText: 'Growth remained steady this week.', newText: 'Growth accelerated this week.', rationale: 'r' },
			]),
		});
		lastFiles!.set(WEEKLY.toString(), weeklyWithPolicy('never'));
		await service.loadDocument(WEEKLY);
		assert.strictEqual(service.getDocPolicy(WEEKLY), 'never', 'precondition: the doc is dialled never');

		await service.sendChatMessage(WEEKLY, 'Tighten the commentary');

		const turn = service.getChatMessages(WEEKLY).at(-1)!;
		assert.deepStrictEqual(
			{
				pending: service.getPendingForDoc(WEEKLY).length,
				namesDoc: /Weekly Operating Summary/.test(turn.content),
				namesPolicy: /Never change this doc/.test(turn.content),
				via: turn.via,
			},
			{ pending: 0, namesDoc: true, namesPolicy: true, via: 'fallback' },
			'never refuses in chat with a named reason and queues nothing',
		);
	});

	test('#257 "never": a read-only question is still answered (the doc is read, only EDITS are refused)', async () => {
		const service = createService([], { model: chatReply('MRR is $48.6k, up 18% this week.') });
		lastFiles!.set(WEEKLY.toString(), weeklyWithPolicy('never'));
		await service.loadDocument(WEEKLY);

		await service.sendChatMessage(WEEKLY, 'What is MRR this week?');

		const turn = service.getChatMessages(WEEKLY).at(-1)!;
		assert.deepStrictEqual(
			{ answered: /MRR is \$48\.6k/.test(turn.content), refused: /Never change this doc/.test(turn.content), pending: service.getAllPending().length },
			{ answered: true, refused: false, pending: 0 },
			'a never doc still answers questions; the refusal only fires when the model wanted to edit',
		);
	});

	test('#257 "ask-first" forces a FIGURE SYNC into Review even though it would otherwise auto-apply', async () => {
		const service = createService();
		lastFiles!.set(WEEKLY.toString(), weeklyWithPolicy('ask-first'));
		await service.loadDocument(WEEKLY);

		await service.refreshFromSources(WEEKLY);

		// The prose is left byte-identical (no auto-apply), and each figure change waits as a pending review row.
		const highlights = blockText(service, WEEKLY, 'h-highlights');
		const pending = service.getPendingForDoc(WEEKLY);
		assert.deepStrictEqual(
			{
				proseUntouched: highlights.includes('[$41.2k](bind:metrics.mrr)'),
				queued: pending.length > 0,
				kind: pending[0]?.kind,
				autoApplied: service.getAudit().some(e => e.action === 'auto-applied'),
			},
			{ proseUntouched: true, queued: true, kind: 'figure', autoApplied: false },
			'ask-first queues the figure sync for review instead of auto-applying it',
		);
	});

	test('#257 "auto-apply": a figure sync still lands on its own (the golden path is not regressed)', async () => {
		const service = createService();
		lastFiles!.set(WEEKLY.toString(), weeklyWithPolicy('auto-apply'));
		await service.loadDocument(WEEKLY);

		await service.refreshFromSources(WEEKLY);

		const highlights = blockText(service, WEEKLY, 'h-highlights');
		assert.deepStrictEqual(
			{ applied: highlights.includes('[$48.6k](bind:metrics.mrr)'), queued: service.getPendingForDoc(WEEKLY).length, audited: service.getAudit().some(e => e.action === 'auto-applied') },
			{ applied: true, queued: 0, audited: true },
			'auto-apply lands figures automatically, nothing queued',
		);
	});

	test('#257 an UNAUTHORED doc (no dial) keeps the auto-apply-figures default (doc 20 1g) - enforcement never silently gates existing docs', async () => {
		const service = createService(); // WEEKLY_MD carries no policy: line
		await service.loadDocument(WEEKLY);

		await service.refreshFromSources(WEEKLY);

		const highlights = blockText(service, WEEKLY, 'h-highlights');
		assert.deepStrictEqual(
			{ applied: highlights.includes('[$48.6k](bind:metrics.mrr)'), queued: service.getPendingForDoc(WEEKLY).length },
			{ applied: true, queued: 0 },
			'the default figure behaviour is auto-apply, unchanged by the enforcement',
		);
	});

	test('#257 fan-out: a "never" document in the project is SKIPPED with a truthful skip reason, others still change', async () => {
		const service = createService([], {
			boardNote: true,
			proxyUrl: DEAD_PROXY,
			model: multiReply('Applied across the project.', [
				{ doc: 'Weekly Operating Summary', edits: [{ oldText: 'Growth remained steady this week.', newText: 'Growth accelerated.', rationale: 'r' }] },
				// The model even RETURNS an edit for the Board Note - it must be refused because the doc is dialled never.
				{ doc: 'Board Note', edits: [{ oldText: 'Momentum is steady this week.', newText: 'Momentum accelerated.', rationale: 'r' }] },
			]),
		});
		lastFiles!.set(BOARD.toString(), BOARD_MD.replace('title: Board Note', 'title: Board Note\npolicy: never'));
		await service.loadDocument(WEEKLY);
		await service.addToWorkingSet(WEEKLY, [WEEKLY, BOARD]);

		await service.sendChatMessage(WEEKLY, 'tighten every note across the project');

		const pendingDocIds = new Set(service.getAllPending().map(c => c.docId));
		const progress = service.getFanoutProgress(WEEKLY);
		const turn = service.getChatMessages(WEEKLY).at(-1)!;
		assert.deepStrictEqual(
			{
				weeklyChanged: pendingDocIds.has(WEEKLY.toString()),
				boardRewritten: pendingDocIds.has(BOARD.toString()),
				boardOnDiskUntouched: (lastFiles!.get(BOARD.toString()) ?? '').includes('Momentum is steady this week.'),
				skippedByPolicy: [...(progress?.skippedByPolicyDocIds ?? [])],
				skipStep: (turn.steps ?? []).some(s => s.status === 'skipped' && /Board Note/.test(s.label) && /Never change this doc/.test(s.label)),
			},
			{
				weeklyChanged: true,
				boardRewritten: false,
				boardOnDiskUntouched: true,
				skippedByPolicy: [BOARD.toString()],
				skipStep: true,
			},
			'the never doc is skipped with a truthful run-log reason and never rewritten; the editable doc still changes',
		);
	});

	test('#257 external frontmatter edit is HONOURED: flipping policy to never on disk stops the next chat proposal, no dial touched', async () => {
		const service = createService([], {
			model: chatReply('Sharpened it.', [
				{ heading: 'Commentary', oldText: 'Growth remained steady this week.', newText: 'Growth accelerated.', rationale: 'r' },
			]),
		});
		await service.loadDocument(WEEKLY);
		// First send with the default policy: a proposal queues as normal.
		await service.sendChatMessage(WEEKLY, 'Tighten the commentary');
		assert.strictEqual(service.getPendingForDoc(WEEKLY).length, 1, 'precondition: a normal doc queues a chat proposal');
		await service.reject(service.getPendingForDoc(WEEKLY)[0].id);

		// Someone edits the file's frontmatter OUTSIDE Abstract, dialling policy to never (no setDocPolicy call).
		simulateExternalEdit!(WEEKLY, weeklyWithPolicy('never'));
		await new Promise(r => setTimeout(r, 0)); // the watcher re-reads + reparses the frontmatter
		// Reload from disk so the freshly-parsed policy is the enforced one (an external-edit reload path).
		await service.loadDocument(WEEKLY);
		assert.strictEqual(service.getDocPolicy(WEEKLY), 'never', 'the external policy edit is read, not cached stale');

		await service.sendChatMessage(WEEKLY, 'Tighten it again');

		assert.deepStrictEqual(
			{ pending: service.getPendingForDoc(WEEKLY).length, refused: /Never change this doc/.test(service.getChatMessages(WEEKLY).at(-1)!.content) },
			{ pending: 0, refused: true },
			'enforcement follows the external policy edit without touching the dial',
		);
	});

	test('#257 V1: a pre-flight NO-MODEL whole-project fan-out surfaces the named outage on the run screen, never a false all-clear', async () => {
		// The broker is unreachable BEFORE the run starts (no model configured). The whole-project fan-out must NOT
		// silently hold the prompt on the first-use chat choice (which would strand the run reading "0 changes, all
		// unchanged"); it surfaces the SAME F14 named outage the mid-run death does - every doc named failed.
		const service = createService([], { boardNote: true, proxyUrl: DEAD_PROXY }); // no opts.model -> /healthz unhealthy
		await service.loadDocument(WEEKLY);
		await service.addToWorkingSet(WEEKLY, [WEEKLY, BOARD, README]);

		await service.sendChatMessage(WEEKLY, 'apply the security review decisions across the project');

		const turn = service.getChatMessages(WEEKLY).at(-1)!;
		const progress = service.getFanoutProgress(WEEKLY);
		assert.deepStrictEqual(
			{
				namesOutage: /The model was not available/.test(turn.content),
				noAllClear: !/no changes|nothing to change|did not find anything|unchanged/i.test(turn.content),
				failedDocs: [...(progress?.failedDocIds ?? [])].sort(),
				pending: service.getAllPending().length,
			},
			{
				namesOutage: true,
				noAllClear: true,
				failedDocs: [BOARD.toString(), README.toString(), WEEKLY.toString()].sort(),
				pending: 0,
			},
			'the pre-flight no-model fan-out names the outage and every failed doc, never a silent all-clear',
		);
	});

	test('WP-E sev-3: a pre-flight no-model fan-out reads policy from disk, so an UNLOADED never-doc tiles "left alone", not "unreachable"', async () => {
		// The whole-project door (_kickProjectRun) loads ONLY the anchor, so BOARD is in the working set but never
		// independently loaded. With the model down pre-flight, its `never` dial must still be honoured by reading the
		// frontmatter from disk - otherwise it is mislabelled a model failure (folded into the outage) rather than
		// the honest "left alone (policy: never)" tile. The anchor (WEEKLY) and the ordinary README still fail honestly.
		const service = createService([], { boardNote: true, proxyUrl: DEAD_PROXY }); // no opts.model -> /healthz unhealthy
		lastFiles!.set(BOARD.toString(), BOARD_MD.replace('title: Board Note', 'title: Board Note\npolicy: never'));
		await service.loadDocument(WEEKLY); // ONLY the anchor is loaded; BOARD/README stay unloaded (disk-only)
		await service.addToWorkingSet(WEEKLY, [WEEKLY, BOARD, README]);

		await service.sendChatMessage(WEEKLY, 'apply the security review decisions across the project');

		const progress = service.getFanoutProgress(WEEKLY);
		assert.deepStrictEqual(
			{
				loadedBoard: service.getDoc(BOARD) !== undefined,
				skippedByPolicy: [...(progress?.skippedByPolicyDocIds ?? [])],
				failedDocs: [...(progress?.failedDocIds ?? [])].sort(),
			},
			{
				loadedBoard: false, // proves BOARD was never independently loaded - policy came from disk
				skippedByPolicy: [BOARD.toString()],
				failedDocs: [README.toString(), WEEKLY.toString()].sort(),
			},
			'the unloaded never-doc is read from disk and tiled left-alone; only the non-protected docs are named failed',
		);
	});

	test('chat works on a PLAIN doc (decision 48): a generated insert queues + approve splices it, and the doc stays plain', async () => {
		const newText = '1. First lever\n2. Second lever\n3. Third lever';
		const service = createService([], {
			model: modelMessage({
				reply: 'Here is a starting list.', edits: [], inserts: [
					{ afterHeading: 'Team Notes', newText, rationale: 'Drafted the list you asked for.' },
				]
			}),
		});
		await service.loadDocument(README);
		assert.strictEqual(service.getDoc(README)!.isLiving, false, 'precondition: README is a plain doc');

		await service.sendChatMessage(README, 'Generate me a top-3 list');

		const assistant = service.getChatMessages(README).at(-1)!;
		assert.strictEqual(assistant.via, 'model', 'chat is model-backed on a plain doc, not the living-doc fallback');
		const pending = service.getPendingForDoc(README);
		assert.strictEqual(pending.length, 1, 'the generated insertion is queued for a plain doc');

		await service.approve(pending[0].id);
		const doc = service.getDoc(README)!;
		assert.ok(doc.blocks.some(b => b.text === newText), 'approving the insertion adds the new content as a block');
		assert.strictEqual(doc.isLiving, false, 'accepting chat content does NOT turn a plain doc into a living one (affordances stay tied to real bindings)');
	});

	test('with no backend configured, a genuine send HOLDS the prompt for the first-use choice - no faked reply, nothing queued (plan 42 L2)', async () => {
		// no opts.model -> /healthz is unhealthy -> `needsModelChoice` is true. The first-AI-use gate now HOLDS the
		// typed prompt and renders the inline sign-in vs included-model choice instead of emitting a fallback turn:
		// the user turn stays visible (the prompt is preserved), no assistant turn is faked, and nothing is queued.
		const service = createService();
		await service.loadDocument(WEEKLY);

		await service.sendChatMessage(WEEKLY, 'Summarise this week');

		const msgs = service.getChatMessages(WEEKLY);
		assert.deepStrictEqual(
			{
				messages: msgs.map(m => ({ role: m.role, content: m.content })),
				held: service.getPendingModelPrompt(WEEKLY),
				pending: service.getPendingForDoc(WEEKLY).length,
				busy: service.isChatBusy(WEEKLY),
			},
			{
				// The user turn is preserved verbatim; no fallback/answer assistant turn is emitted.
				messages: [{ role: 'user', content: 'Summarise this week' }],
				// The exact prompt is held for replay once a door is chosen.
				held: { resource: WEEKLY, text: 'Summarise this week', displayText: undefined },
				pending: 0,
				busy: false,
			},
		);
	});

	test('the onboarding demo path (a substituted displayText) is exempt from the first-use gate - it answers, not held (plan 42 L2)', async () => {
		// A send WITH displayText is the walkthrough deliberately driving the model (its own no-model guidance
		// covers it), so it is NOT held even with no backend: the gate opens only for a genuine user send. With no
		// model the reply is the honest fallback turn - proving the exemption reaches `_deliverChatReply`.
		const service = createService();
		await service.loadDocument(WEEKLY);

		await service.sendChatMessage(WEEKLY, 'Generate the first draft from the Weekly template.', 'Draft from the Weekly template.');

		const msgs = service.getChatMessages(WEEKLY);
		assert.deepStrictEqual(
			{
				roles: msgs.map(m => ({ role: m.role, via: m.via })),
				fallbackNamesModel: /proxy|model/i.test(msgs.at(-1)!.content),
				held: service.getPendingModelPrompt(WEEKLY),
			},
			{
				roles: [{ role: 'user', via: undefined }, { role: 'assistant', via: 'fallback' }],
				fallbackNamesModel: true,
				held: undefined,
			},
		);
	});

	test('getMentionableFiles resolves real folder files (md/csv/json), not just frontmatter-declared ones', async () => {
		const service = createService();
		await service.loadDocument(WEEKLY);
		// Team Notes.md is a real folder file but NOT a declared source/context of WEEKLY - it must still be
		// mentionable (R6). Lock sidecars are excluded.
		assert.deepStrictEqual(
			[...service.getMentionableFiles(WEEKLY)].sort(),
			['Team Notes.md', 'market-research.md', 'metrics.csv'],
			'declared sources/context PLUS the other real folder documents',
		);
	});

	test('addContextFile references a real folder file in the context frontmatter (prose + sources untouched), and removeContextFile clears it', async () => {
		const service = createService();
		await service.loadDocument(WEEKLY);

		await service.addContextFile(WEEKLY, 'Team Notes.md');
		assert.ok(service.getDoc(WEEKLY)!.context.includes('Team Notes.md'), 'reference added to the in-memory doc');
		const onDisk = lastFiles!.get(WEEKLY.toString()) ?? '';
		assert.ok(/context:[\s\S]*Team Notes\.md/.test(onDisk), 'persisted into the context frontmatter on disk');
		assert.deepStrictEqual(service.getDoc(WEEKLY)!.sources, ['metrics.csv'], 'sources list untouched');
		assert.ok(onDisk.includes('Growth remained steady this week.'), 'prose untouched');

		await service.removeContextFile(WEEKLY, 'market-research.md');
		assert.ok(!service.getDoc(WEEKLY)!.context.includes('market-research.md'), 'reference removed');
	});

	test('getContextCandidates lists folder files not already referenced or bound (and excludes the doc + system files)', async () => {
		const service = createService();
		await service.loadDocument(WEEKLY); // sources: metrics.csv, context: market-research.md; bootstraps a lock
		// Team Notes.md is the only other real document not already bound/referenced.
		assert.deepStrictEqual([...await service.getContextCandidates(WEEKLY)].sort(), ['Team Notes.md'], 'folder files minus self, bound source, referenced context, and lock sidecars');
	});

	test('runSkillCheck strategy surfaces a model verdict against the decision stack', async () => {
		const flag = 'Strategy: the "steady growth" framing ignores the new competitor noted in market-research.md.';
		const service = createService([], { model: modelMessage({ pass: false, flag }) });
		await service.loadDocument(WEEKLY);

		await service.runSkillCheck(WEEKLY, 'strategy');

		const strategy = service.getSkillReport(WEEKLY).find(s => s.id === 'strategy')!;
		assert.deepStrictEqual(
			{ status: strategy.status, detail: strategy.detail, canRun: strategy.canRun },
			{ status: 'flag', detail: flag, canRun: true },
		);
	});

	test('a clean Markdown table with bind links in cells resolves each cell on refresh', async () => {
		const service = createService([], { boardNote: true });
		await service.loadDocument(BOARD);
		await service.refreshFromSources();

		const table = service.getDoc(BOARD)!.blocks.find(b => b.type === 'table')!;
		assert.ok(table.text.includes('[$48.6k](bind:metrics.mrr)') && table.text.includes('[427](bind:metrics.signups)'), `table cells resolved: ${table.text}`);
	});

	test('plain Markdown is not a Living Document and reports a Markdown status', async () => {
		const service = createService();
		await service.loadDocument(README);
		assert.strictEqual(service.getDoc(README)?.isLiving, false);
		assert.strictEqual(service.getStatus(README), 'Markdown');
	});

	test('saveRawText persists verbatim and reparses the document', async () => {
		const service = createService();
		await service.loadDocument(README);

		const edited = PLAIN_MD.replace('Team Notes', 'Renamed Notes');
		await service.saveRawText(README, edited);

		assert.strictEqual(service.getRawText(README), edited, 'raw text updated');
		assert.strictEqual(service.getDoc(README)?.title, 'Renamed Notes', 'reparsed after save');
	});

	test('an api source resolves live values into its bind links on refresh', async () => {
		const service = createService([], { api: true });
		await service.loadDocument(API);
		await service.refreshFromSources();

		const eco = service.getDoc(API)!.blocks.find(b => b.type === 'paragraph' && b.binds.length > 0)!;
		assert.ok(eco.text.includes('[12,345](bind:repo.stargazers_count)'), `live stars resolved: ${eco.text}`);
		assert.ok(eco.text.includes('[678](bind:repo.open_issues_count)'), `live issues resolved: ${eco.text}`);
	});

	// --- plan 29 iter 4: mcp resolution + api auth (credentials stay in the proxy) ---

	test('an inline mcp binding resolves through the proxy and lands its extracted value', async () => {
		const service = createService([], { mcp: true });
		await service.loadDocument(MCP);
		await service.refreshFromSources();

		const block = service.getDoc(MCP)!.blocks.find(b => b.type === 'paragraph' && b.binds.length > 0)!;
		assert.ok(block.text.includes('[128,000](bind:pipeline@mcp:demo.query/total)'), `mcp value resolved into the bind link: ${block.text}`);
		// The renderer asked the proxy to resolve the parsed server/tool/field - never spawning a process itself.
		assert.ok(lastMcpBody, 'the renderer POSTed to the proxy /mcp/resolve route');
		const sent = JSON.parse(lastMcpBody!) as { server: string; tool: string; field: string };
		assert.deepStrictEqual({ server: sent.server, tool: sent.tool, field: sent.field }, { server: 'demo', tool: 'query', field: 'total' });
		// The lock records the mcp origin (server.tool#field) for provenance, not a pretend file path.
		assert.strictEqual(service.getLock(MCP)!.bindings['pipeline@mcp:demo.query/total'].source, 'demo.query#total');
	});

	test('a down mcp server leaves the binding unresolved (flagged stale) and the document still renders', async () => {
		// The proxy returns a structured error (server down) instead of a value.
		const service = createService([], { mcp: true, mcpResponse: { error: { type: 'mcp_error', message: 'mcp server exited' } } });
		await service.loadDocument(MCP);
		await service.refreshFromSources();

		// No value landed: the visible cache keeps its authored placeholder, and no lock binding was written -
		// the document renders fine rather than throwing or showing an error toast.
		const block = service.getDoc(MCP)!.blocks.find(b => b.type === 'paragraph' && b.binds.length > 0)!;
		assert.ok(block.text.includes('[pending](bind:pipeline@mcp:demo.query/total)'), `unresolved binding keeps its placeholder: ${block.text}`);
		assert.strictEqual(service.getLock(MCP)!.bindings['pipeline@mcp:demo.query/total'], undefined, 'no lock binding written for the unresolved mcp key');
	});

	test('source-peek for an mcp value shows the real payload with the field, not a CSV', async () => {
		const service = createService([], { mcp: true });
		await service.loadDocument(MCP);
		await service.refreshFromSources();

		const peek = service.getSourcePeek(MCP, ['pipeline@mcp:demo.query/total']);
		assert.ok(peek?.payload, 'an mcp cell yields a raw-payload view');
		assert.strictEqual(peek!.payload!.kind, 'mcp');
		assert.strictEqual(peek!.payload!.field, 'total');
		assert.ok(peek!.payload!.raw.includes('"total":128000'), 'the raw MCP tool payload is surfaced');
		assert.strictEqual(peek!.grid, undefined, 'no pretend CSV grid for an mcp source');
	});

	test('an authenticated api source resolves via the proxy and the secret VALUE never leaves the proxy', async () => {
		const service = createService([], { apiAuth: true });
		await service.loadDocument(APIAUTH);
		await service.refreshFromSources();

		const block = service.getDoc(APIAUTH)!.blocks.find(b => b.type === 'paragraph' && b.binds.length > 0)!;
		assert.ok(block.text.includes('[480,000](bind:metrics.arr)'), `authenticated api value resolved: ${block.text}`);
		// The renderer routed the fetch through the proxy, naming the secret - and carried NO secret value.
		assert.ok(lastProxyFetchBody, 'the renderer POSTed to the proxy /proxy/fetch route');
		const sent = JSON.parse(lastProxyFetchBody!) as { url: string; auth: string };
		assert.strictEqual(sent.url, 'https://crm.example.com/metrics', 'the clean URL (auth marker stripped) is sent');
		assert.strictEqual(sent.auth, 'crm-token', 'only the secret NAME is sent to the proxy');
		// The lock/source identity is the clean URL, not the ` auth=...` spec, so provenance stays clean.
		assert.strictEqual(service.getLock(APIAUTH)!.bindings['metrics.arr'].source, 'https://crm.example.com/metrics#arr');
	});

	test('editBlock edits non-bound prose and persists it, but ignores bound blocks', async () => {
		const service = createService();
		await service.loadDocument(WEEKLY);

		const watch = service.getDoc(WEEKLY)!.blocks.find(b => b.type === 'paragraph' && b.binds.length === 0)!;
		await service.editBlock(WEEKLY, watch.id, 'Edited prose.');
		assert.strictEqual(service.getDoc(WEEKLY)!.blocks.find(b => b.id === watch.id)!.text, 'Edited prose.', 'non-bound prose updated');
		assert.ok(service.getRawText(WEEKLY).includes('Edited prose.'), 'edit persisted to the Markdown source');

		const bound = service.getDoc(WEEKLY)!.blocks.find(b => b.binds.length > 0)!;
		const before = bound.text;
		await service.editBlock(WEEKLY, bound.id, 'Should be ignored.');
		assert.strictEqual(service.getDoc(WEEKLY)!.blocks.find(b => b.id === bound.id)!.text, before, 'bound block left unchanged');
	});

	test('listDocuments lists every Markdown document in the folder, flags living vs plain, and sorts by title', async () => {
		const service = createService([], { boardNote: true, api: true });

		const docs = await service.listDocuments();
		// All `.md` are listed now (the folder is the project), with an isLiving flag for the badge - plain
		// docs (Team Notes, the market-research reference note) included, generated `.export`/`.source` views excluded.
		assert.deepStrictEqual(
			docs.map(d => ({ title: d.title, isLiving: d.isLiving })),
			[
				{ title: 'Board Note', isLiving: true },
				{ title: 'Ecosystem Signal', isLiving: true },
				{ title: 'Market research', isLiving: false },
				{ title: 'Team Notes', isLiving: false },
				{ title: 'Weekly Operating Summary', isLiving: true },
			],
			'all .md listed with a living/plain flag, sorted by title',
		);
		assert.deepStrictEqual(docs.find(d => d.title === 'Ecosystem Signal')!.sourceKinds, ['api'], 'api source kind still surfaced for the chip');
	});

	// Plan 28, iter 1: a `*.template.md` is discovered by listTemplates but NEVER appears in listDocuments
	// (so it is absent from the Reports tree-rail and the Home documents grid), even though it stays on disk.
	test('listDocuments excludes *.template.md; listTemplates discovers it (parsed, from a subfolder)', async () => {
		const service = createService([], { template: true });

		const docs = await service.listDocuments();
		assert.ok(!docs.some(d => d.resource.path.endsWith('.template.md')), 'no template file in the documents list');
		assert.ok(!docs.some(d => d.title === 'Weekly report'), 'the template is not listed as a report');

		const templates = await service.listTemplates();
		assert.deepStrictEqual(
			templates.map(t => ({ name: t.name, description: t.description, sources: t.sources })),
			[{ name: 'Weekly report', description: 'A weekly operating summary bound to metrics.csv.', sources: ['metrics.csv'] }],
			'the template is discovered (from the templates/ subfolder), parsed via the shared frontmatter parser',
		);
		assert.ok(templates[0].body.includes('[pending](bind:metrics.mrr)'), 'the template body (bind links + slots) is carried for generation');
		assert.strictEqual(templates[0].uri.toString(), TEMPLATE.toString(), 'the template uri is the on-disk file');
	});

	test('listTemplates returns nothing when the folder ships no templates', async () => {
		const templates = await createService().listTemplates();
		assert.deepStrictEqual(templates, [], 'no templates -> empty list (the screen shows the calm empty state)');
	});

	// Plan 48 T2: the gallery model carries the real bind-slot count, the parsed skeleton rows, and the honest
	// usage count from `template: <name>` provenance lineage across the open folder's documents.
	test('listTemplateGallery reports the real bind-slot count, a parsed skeleton, and honest usage lineage', async () => {
		const service = createService([], { template: true });
		// Seed two documents born from the Weekly report template (recorded as `template: <name>` provenance) so
		// the usage count is REAL lineage, not a hardcoded N. A third doc from a different template must not count.
		const files = lastFiles!;
		files.set(URI.file('/ws/Week 24.md').toString(), '---\ntemplate: Weekly report\nsources:\n  - metrics.csv\n---\n\n# Week 24\n\nMRR is [pending](bind:metrics.mrr).\n');
		files.set(URI.file('/ws/Week 25.md').toString(), '---\ntemplate: weekly report\n---\n\n# Week 25\n');
		files.set(URI.file('/ws/From Other.md').toString(), '---\ntemplate: Some other template\n---\n\n# From Other\n');

		const gallery = await service.listTemplateGallery();
		assert.strictEqual(gallery.length, 1, 'the one template is in the gallery');
		const card = gallery[0];
		// The template body has two {{slot}} placeholders + one bind link -> 3 bind slots.
		assert.strictEqual(card.bindSlots, 3, 'the bind-slot meta is the true {{slot}} + bind total');
		// Case-insensitive lineage: "Weekly report" + "weekly report" both count; the other-template doc does not.
		assert.strictEqual(card.usageCount, 2, 'the usage count is the real lineage across the folder (2), never fabricated');
		assert.ok(card.skeleton.length > 0 && card.skeleton.some(r => r.kind === 'slots'), 'the skeleton is derived from the parsed doc, with a slots row where binds occur');
	});

	test('listTemplateGallery honestly reports used 0× for a template nothing was generated from', async () => {
		const service = createService([], { template: true });
		const gallery = await service.listTemplateGallery();
		assert.strictEqual(gallery.length, 1);
		assert.strictEqual(gallery[0].usageCount, 0, 'no generated documents -> an honest used 0×');
	});

	// --- plan 48 T2.4: Use a template = duplicate into the folder with binds emptied to slots ---
	// Use is a pure duplication (no model call, no review proposals): the new doc carries the pattern with its
	// binds emptied to {{slot}} placeholders, records `template: <name>` provenance, declares no sources, and
	// is opened. So it reports `needsSourceBinding` (the tree-row nudge) until a source is bound.
	test('useTemplate duplicates the template into the folder with binds emptied to slots, opens it, and it needs binding', async () => {
		const opened: IOpenedEditor[] = [];
		const service = createService(opened, { template: true });

		const uri = await service.useTemplate(TEMPLATE);
		assert.ok(uri && uri.path.endsWith('.md') && !uri.path.endsWith('.template.md'), 'a new document (not a template) is created');
		const raw = lastFiles!.get(uri!.toString()) ?? '';
		const doc = parseLivingDoc(raw);
		assert.strictEqual(doc.fromTemplate, 'Weekly report', 'the new doc records the originating template as provenance');
		assert.deepStrictEqual(doc.sources, [], 'no sources are declared - the doc is not born bound');
		assert.strictEqual(extractBindLinks(doc.body).length, 0, 'every bind is emptied to a slot');
		assert.ok(/\{\{slot:/.test(raw), 'the emptied binds survive as {{slot}} placeholders');
		assert.deepStrictEqual(opened[opened.length - 1]?.resource?.toString(), uri!.toString(), 'the new document is opened');
		assert.strictEqual(service.getPendingForDoc(uri!).length, 0, 'Use is a pure duplication - no review proposals queued');

		// The queryable "needs binding" state (T2.4): the duplicate reports needsSourceBinding until a source binds.
		const summary = (await service.listDocuments()).find(d => d.resource.toString() === uri!.toString());
		assert.strictEqual(summary?.needsSourceBinding, true, 'a template-born doc with no bound source needs binding (the tree nudge)');
	});

	// --- plan 48 T2.5: Save the active document as a template into `.abstract/templates/` ---
	test('saveActiveDocAsTemplate writes the active doc to .abstract/templates with binds emptied to slots, and it appears in the grid', async () => {
		const opened: IOpenedEditor[] = [];
		const service = createService(opened);
		// Pin the Weekly Summary as the active document (the doc save-as-template writes from).
		setActiveEditor!(WEEKLY);

		const templateUri = await service.saveActiveDocAsTemplate();
		assert.ok(templateUri && templateUri.path.includes('/.abstract/templates/') && templateUri.path.endsWith('.template.md'), 'the template lands under .abstract/templates/');
		const raw = lastFiles!.get(templateUri!.toString()) ?? '';
		const parsed = parseLivingDoc(raw);
		assert.strictEqual(parsed.isTemplate, true, 'the saved file is a template (template: true)');
		assert.strictEqual(extractBindLinks(parsed.body).length, 0, 'the active doc\'s live figures are emptied to slots');
		// It is discovered by the gallery (T2.6): the new card appears.
		const gallery = await service.listTemplateGallery();
		assert.ok(gallery.some(c => c.uri.toString() === templateUri!.toString()), 'the saved template appears in the gallery grid');
	});

	test('saveActiveDocAsTemplate is an honest no-op with no active document', async () => {
		const service = createService([]);
		const result = await service.saveActiveDocAsTemplate();
		assert.strictEqual(result, undefined, 'no active document -> no template written');
		assert.ok(lastNotifications.some(n => /document/i.test(n.message)), 'a plain-words nudge is shown, not a silent no-op');
	});

	// --- plan 48 T2.6: both discovery sources, deduped by name with .abstract/templates winning ---
	test('templates from both templates/ and .abstract/templates/ are discovered with no same-name duplicates', async () => {
		const service = createService([], { template: true }); // seeds templates/Weekly report.template.md
		// A DIFFERENT-named template in .abstract/templates/ -> both appear (two distinct cards).
		lastFiles!.set(URI.file('/ws/.abstract/templates/Board note.template.md').toString(), '---\ntemplate: true\nname: Board note\n---\n\n# {{slot:title}}\n');
		let gallery = await service.listTemplateGallery();
		assert.deepStrictEqual(gallery.map(c => c.name).sort(), ['Board note', 'Weekly report'], 'both sources are discovered');

		// A SAME-named template in .abstract/templates/ -> ONE card, and the hidden-store copy wins the dedupe.
		const abstractWeekly = URI.file('/ws/.abstract/templates/Weekly report.template.md');
		lastFiles!.set(abstractWeekly.toString(), '---\ntemplate: true\nname: Weekly report\ndescription: The saved copy.\n---\n\n# {{slot:title}}\n');
		gallery = await service.listTemplateGallery();
		const weeklyCards = gallery.filter(c => c.name === 'Weekly report');
		assert.strictEqual(weeklyCards.length, 1, 'a same-name template appears ONCE (no duplicate)');
		assert.strictEqual(weeklyCards[0].uri.toString(), abstractWeekly.toString(), 'the .abstract/templates/ copy wins the dedupe');
	});

	// --- plan 48 H2.3u: the Home Review deep link opens the doc + Review tab and scrolls to the addressed block ---
	// reviewBlock resolves the durable block id to its CURRENT ordinal via the address model, so a doc that
	// changed still scrolls to the right block; a deleted block degrades to -1 (open, no scroll, spec section 3.1).
	test('reviewBlock opens the doc, focuses the Review tab, and reveals the addressed block by its current ordinal', async () => {
		const opened: IOpenedEditor[] = [];
		const service = createService(opened);

		const revealed: { docId: string; blockIndex: number }[] = [];
		store.add(service.onDidRequestRevealBlock(e => revealed.push(e)));

		// The Weekly Summary's blocks in document order: resolve a real block id to its ordinal.
		await service.loadDocument(WEEKLY);
		const doc = parseLivingDoc(WEEKLY_MD);
		const targetBlock = doc.blocks[2]; // an interior block, so the ordinal is non-trivial

		await service.reviewBlock(WEEKLY, targetBlock.id);
		assert.deepStrictEqual(opened[opened.length - 1]?.resource?.toString(), WEEKLY.toString(), 'the document is opened');
		assert.ok((lastOpenedView ?? '').toLowerCase().includes('review'), 'the Review rail is opened (focusPanel(review))');
		assert.strictEqual(revealed.length, 1, 'one reveal is requested');
		assert.strictEqual(revealed[0].blockIndex, 2, 'the durable block id resolves to its current 0-based ordinal');

		// A deleted/unknown block degrades to -1 (open + Review tab, no scroll): never an error (spec section 3.1).
		revealed.length = 0;
		await service.reviewBlock(WEEKLY, 'no-such-block-id');
		assert.strictEqual(revealed[0].blockIndex, -1, 'an unknown block resolves to -1 (graceful degrade, no scroll)');
	});

	// Pin 13.5: a "Line N" citation click on a Review card or a chat meaning-change card scrolls the editor to the
	// addressed block WITHOUT switching the rail's own tab. revealBlockAddress mirrors reviewBlock's ordinal
	// resolution + graceful-degrade, but never opens a view (no focusPanel), so a chat citation keeps the user on Chat.
	test('revealBlockAddress reveals the addressed block by ordinal and never switches the rail tab', async () => {
		const opened: IOpenedEditor[] = [];
		const service = createService(opened);

		const revealed: { docId: string; blockIndex: number }[] = [];
		store.add(service.onDidRequestRevealBlock(e => revealed.push(e)));

		await service.loadDocument(WEEKLY);
		const doc = parseLivingDoc(WEEKLY_MD);
		const targetBlock = doc.blocks[2];

		await service.revealBlockAddress(WEEKLY, targetBlock.id);
		assert.deepStrictEqual(opened[opened.length - 1]?.resource?.toString(), WEEKLY.toString(), 'the document is opened');
		assert.strictEqual(lastOpenedView, undefined, 'no rail tab is switched (navigate-only, unlike reviewBlock)');
		assert.strictEqual(revealed.length, 1, 'one reveal is requested');
		assert.strictEqual(revealed[0].blockIndex, 2, 'the durable block id resolves to its current 0-based ordinal');

		// A deleted/unknown block degrades to -1 (open, no scroll): never an error (spec section 3.1).
		revealed.length = 0;
		await service.revealBlockAddress(WEEKLY, 'no-such-block-id');
		assert.strictEqual(revealed[0].blockIndex, -1, 'an unknown block resolves to -1 (graceful degrade, no scroll)');
	});

	// Plan 29, iter 1: the source registry folds every document's declared sources by identity. Two documents
	// binding the same CSV must produce ONE metrics.csv row whose fan-in lists both, each with its own keys.
	test('listSources folds a shared CSV into one row with the two-doc dependency fan-in; api source carries kind api', async () => {
		const service = createService([], { boardNote: true, api: true });

		const sources = await service.listSources();
		const metrics = sources.find(s => s.id === 'metrics.csv');
		assert.ok(metrics, 'the shared CSV is one registry row');
		assert.strictEqual(metrics!.kind, 'file', 'a sibling file is a file source');
		assert.strictEqual(metrics!.usedBy.length, 2, 'both documents that bind metrics.csv appear in the fan-in');
		const byTitle = new Map(metrics!.usedBy.map(u => [u.title, u.keys]));
		assert.deepStrictEqual(byTitle.get('Weekly Operating Summary'), ['metrics.mrr', 'metrics.mrr.delta', 'metrics.signups'], 'the Weekly summary keys are the bind keys it authors');
		assert.deepStrictEqual(byTitle.get('Board Note'), ['metrics.mrr', 'metrics.signups'], 'the Board note keys are its own bind keys');

		const api = sources.find(s => s.kind === 'api');
		assert.ok(api, 'an api source is projected with kind api');
		assert.strictEqual(api!.id, 'https://api.example.com/repo', 'the api source id is the frontmatter URL');
		assert.strictEqual(api!.label, 'api.example.com', 'the api source label is its host');
		assert.deepStrictEqual(api!.usedBy.map(u => u.title), ['Ecosystem Signal'], 'the api source fan-in is the one document that binds it');

		// A context (influence) source is registered too, with no bind keys.
		const market = sources.find(s => s.id === 'market-research.md');
		assert.ok(market && market.usedBy.every(u => u.context && u.keys.length === 0), 'a context source is registered as a keyless influence edge');
	});

	// Plan 29, iter 1: freshness + last-sync come from the lock. A loaded, synced document reports its source
	// fresh with a real syncedAt; editing the underlying CSV flips the same source stale in the registry.
	test('listSources reports real freshness + syncedAt from the lock and flips stale when the source changes', async () => {
		const service = createService();
		await service.loadDocument(WEEKLY);

		let metrics = (await service.listSources()).find(s => s.id === 'metrics.csv')!;
		assert.strictEqual(metrics.fresh, true, 'a just-synced source is fresh');
		assert.ok(metrics.syncedAt && !Number.isNaN(Date.parse(metrics.syncedAt)), 'syncedAt is a real timestamp from the lock');

		// Change the CSV under the document and recompute the always-on dirty bits.
		lastFiles!.set(URI.file('/ws/metrics.csv').toString(), METRICS_CSV + '\n25,Jun 26,52000,455,2.2,214');
		await service.checkSources(WEEKLY);

		metrics = (await service.listSources()).find(s => s.id === 'metrics.csv')!;
		assert.strictEqual(metrics.fresh, false, 'the registry flips the source stale when its value changes');
	});

	test('listSources returns an empty list for a project with no bound documents', async () => {
		// Only the plain README is a document here (no sources/context/binds) -> the honest empty registry.
		const service = createService();
		const sources = await service.listSources();
		assert.deepStrictEqual(sources.map(s => s.id), ['market-research.md', 'metrics.csv'], 'the sample Weekly summary contributes its two sources');
		const empty = await createService([], { noFolder: true }).listSources();
		assert.deepStrictEqual(empty, [], 'no folder -> the honest empty state');
	});

	test('createTemplate writes an untitled.template.md seeded with a commented example and opens it', async () => {
		const opened: IOpenedEditor[] = [];
		const service = createService(opened);
		const uri = await service.createTemplate();
		assert.ok(uri && uri.path.endsWith('untitled.template.md'), 'a new untitled.template.md is created');
		const raw = lastFiles!.get(uri!.toString()) ?? '';
		assert.ok(/^---\r?\ntemplate: true/.test(raw), 'seeded with template: true frontmatter');
		assert.ok(/\{\{slot:/.test(raw) && /\(bind:/.test(raw), 'seeded with a slot and a bind link example');
		assert.ok(parseLivingDoc(raw).isTemplate, 'the seed parses back as a template');
		assert.deepStrictEqual(opened[opened.length - 1]?.resource?.toString(), uri!.toString(), 'the new template is opened in the editor');
		// A second create does not collide with the first.
		const uri2 = await service.createTemplate();
		assert.ok(uri2 && uri2.toString() !== uri!.toString(), 'a second createTemplate picks a non-colliding name');
	});

	// Plan 28, iter 3: generate a draft from a template. With a model reachable the prose arrives as
	// insertion proposals through the EXISTING chat path (review engine), the skeleton is born bound to the
	// template's source, and the frontmatter records `template:` provenance. No new approve/apply path.
	test('generateFromTemplate writes a bound skeleton with provenance and drafts through the review engine', async () => {
		const opened: IOpenedEditor[] = [];
		const service = createService(opened, {
			template: true,
			model: modelMessage({ reply: 'Drafted your weekly report.', edits: [], inserts: [{ afterHeading: 'Commentary', newText: 'MRR grew steadily this week.', rationale: 'From the metrics.' }] }),
		});

		const uri = await service.generateFromTemplate(TEMPLATE, 'Week 24 report', 'Focus on churn.');
		assert.ok(uri && uri.path.endsWith('Week 24 report.md'), 'a titled document is created from the doc name');

		// The skeleton on disk: provenance + declared source, the H1 named after the document, the bind link
		// copied verbatim (born bound), and no slots left behind.
		const raw = lastFiles!.get(uri!.toString()) ?? '';
		const doc = parseLivingDoc(raw);
		assert.strictEqual(doc.fromTemplate, 'Weekly report', 'template provenance recorded (History reads "Created from Weekly report template")');
		assert.deepStrictEqual(doc.sources, ['metrics.csv'], 'the template source is carried so the copied binds resolve');
		assert.ok(raw.includes('# Week 24 report'), 'the H1 is the document name');
		assert.ok(raw.includes('[pending](bind:metrics.mrr)'), 'the bind link is copied through verbatim');
		assert.ok(!/\{\{/.test(raw), 'no slots survive into the generated document');

		// The prose arrived as a reviewable insertion proposal (not written directly): it is in the pending set.
		const pending = service.getPendingForDoc(uri!);
		assert.strictEqual(pending.length, 1, 'the model draft landed as one insertion proposal in the review rail');
		assert.strictEqual(pending[0].newText, 'MRR grew steadily this week.', 'the proposal carries the generated prose');
		assert.strictEqual(pending[0].oldText, '', 'an insertion has no old text (all-additions inline diff)');

		// The composed brief was actually sent to the model (the existing chat path, not a bespoke one).
		assert.ok(lastModelCalls >= 1 && (lastModelBody ?? '').includes('Generate the first draft of'), 'the composed template brief drove the model call');
		assert.deepStrictEqual(opened[opened.length - 1]?.resource?.toString(), uri!.toString(), 'the generated document is opened in the editor');
	});

	// The honest no-model state (plan 28, iter 3): the skeleton is still created and bound, but no prose is
	// fabricated - the status explains the draft needs the model, and nothing is queued.
	test('generateFromTemplate with no model still writes the bound skeleton and explains the draft needs a model', async () => {
		const service = createService([], { template: true }); // no opts.model -> /healthz unhealthy
		const uri = await service.generateFromTemplate(TEMPLATE, 'Week 24 report', '');
		assert.ok(uri, 'the skeleton is created even without a model');
		const raw = lastFiles!.get(uri!.toString()) ?? '';
		assert.ok(raw.includes('[pending](bind:metrics.mrr)') && raw.includes('# Week 24 report'), 'the bound skeleton is on disk');
		assert.strictEqual(service.getPendingForDoc(uri!).length, 0, 'no fabricated prose is queued without a model');
		assert.ok(/model/i.test(service.getStatus(uri!)), `the status explains the draft needs the model: ${service.getStatus(uri!)}`);
	});

	// --- F17 "From sources..." birth (journey 1b): draft a document FROM selected sources through review ---
	// The skeleton DECLARES the picked sources (provenance) and the document is opened, then the draft is driven
	// through the SAME chat path every generation uses (like generateFromTemplate): the prose arrives as a
	// reviewable insertion proposal in the Review rail, never written to disk directly (decision 17).
	test('generateFromSources writes a source-declared skeleton (provenance) and drafts through the review engine', async () => {
		const opened: IOpenedEditor[] = [];
		const service = createService(opened, {
			model: modelMessage({ reply: 'Drafted from your sources.', edits: [], inserts: [{ afterHeading: '', newText: 'MRR grew steadily this week.', rationale: 'From the metrics.' }] }),
		});

		const uri = await service.generateFromSources(['metrics.csv', 'market-research.md'], 'Board note - March', 'Lead with churn.');
		assert.ok(uri && uri.path.endsWith('Board note - March.md'), 'a titled document is created from the doc name');

		// The skeleton on disk declares the picked sources with provenance: csv under sources:, md under context:.
		const raw = lastFiles!.get(uri!.toString()) ?? '';
		const doc = parseLivingDoc(raw);
		assert.deepStrictEqual(doc.sources, ['metrics.csv'], 'the csv is a value source (so its figures can bind)');
		assert.deepStrictEqual(doc.context, ['market-research.md'], 'the document/knowledge source is context');
		assert.ok(raw.includes('# Board note - March'), 'the H1 is the document name');
		// The prose arrived as a reviewable insertion proposal (not written directly): it is in the pending set.
		const pending = service.getPendingForDoc(uri!);
		assert.strictEqual(pending.length, 1, 'the model draft landed as one insertion proposal in the review rail');
		assert.strictEqual(pending[0].newText, 'MRR grew steadily this week.', 'the proposal carries the drafted prose');
		assert.strictEqual(pending[0].oldText, '', 'an insertion has no old text (all-additions inline diff)');
		// The composed from-sources brief actually drove the model call (the existing chat path, not a bespoke one).
		assert.ok((lastModelBody ?? '').includes('Draft the first version of'), 'the composed from-sources brief drove the model call');
		assert.deepStrictEqual(opened[opened.length - 1]?.resource?.toString(), uri!.toString(), 'the drafted document is opened in the editor');
	});

	test('generateFromSources with no model still writes the source-declared skeleton and names the model honestly', async () => {
		const service = createService([], {}); // no opts.model -> /healthz unhealthy -> no model
		const uri = await service.generateFromSources(['metrics.csv'], 'Draft', '');
		assert.ok(uri, 'the skeleton is created even without a model');
		const raw = lastFiles!.get(uri!.toString()) ?? '';
		assert.ok(raw.includes('sources:') && raw.includes('metrics.csv') && raw.includes('# Draft'), 'the source-declared skeleton is on disk');
		assert.strictEqual(service.getPendingForDoc(uri!).length, 0, 'no fabricated prose is queued without a model');
		assert.ok(/model/i.test(service.getStatus(uri!)), `the status names the model, never fake content: ${service.getStatus(uri!)}`);
	});

	test('generateFromSources refuses an empty selection', async () => {
		const service = createService();
		const uri = await service.generateFromSources([], 'Draft', '');
		assert.strictEqual(uri, undefined, 'no sources -> nothing drafted');
	});

	// --- F18 from-examples template wizard (journey 1x): grow a real template file through the review grammar ---
	test('generateTemplateFromExamples refuses fewer than 3 examples with a plain-words reason (never a silent write)', async () => {
		const service = createService();
		const uri = await service.generateTemplateFromExamples(['Team Notes.md', 'market-research.md'], 'Board note');
		assert.strictEqual(uri, undefined, 'a set below the floor is refused - no template written');
	});

	// The template file is a real, discoverable `*.template.md` that records the examples it was grown from and
	// carries the skill.md scaffold; the analysis then runs through the SAME chat path (like generateFromTemplate),
	// so the named commonalities arrive as reviewable insertion proposals - the review grammar, never a silent write.
	test('generateTemplateFromExamples writes a real, discoverable template and analyses the examples through the review engine', async () => {
		const opened: IOpenedEditor[] = [];
		const service = createService(opened, {
			model: modelMessage({ reply: 'Found the shared pattern.', edits: [], inserts: [{ afterHeading: 'Structure', newText: 'Title, summary, then the numbers.', rationale: 'Every example shares it.' }] }),
		});

		const uri = await service.generateTemplateFromExamples(['Team Notes.md', 'Weekly Summary.md', 'market-research.md'], 'Board note');
		assert.ok(uri && uri.path.endsWith('Board note.template.md'), 'a real *.template.md file is written to the project');

		// The template on disk is a genuine template that records the examples it was grown from + the skill.md shape.
		const raw = lastFiles!.get(uri!.toString()) ?? '';
		const doc = parseLivingDoc(raw);
		assert.strictEqual(doc.isTemplate, true, 'it is template: true, so it joins the + New picker');
		assert.deepStrictEqual(doc.context, ['Team Notes.md', 'Weekly Summary.md', 'market-research.md'], 'the examples are recorded so the analysis reads them');
		for (const section of ['## Structure', '## Recurring figures', '## Tone', '## Success examples']) {
			assert.ok(raw.includes(section), `the skill.md scaffold has ${section}`);
		}

		// It joins the Templates library at once (before any approval - the file exists on disk).
		assert.ok((await service.listTemplates()).some(t => t.name === 'Board note'), 'the new template appears in listTemplates');

		// The analysis named the commonality as a reviewable insertion proposal (the review grammar), not a silent write.
		const pending = service.getPendingForDoc(uri!);
		assert.strictEqual(pending.length, 1, 'the analysis landed as one insertion proposal in the review rail');
		assert.strictEqual(pending[0].newText, 'Title, summary, then the numbers.', 'the proposal carries the named commonality');
		assert.ok((lastModelBody ?? '').includes('Study the 3 attached example documents'), 'the composed analysis brief drove the model call');
	});

	test('generateTemplateFromExamples with no model still writes the template and NAMES the error (never "no commonalities")', async () => {
		const service = createService([], {}); // no opts.model -> /healthz unhealthy -> no model
		const uri = await service.generateTemplateFromExamples(['Team Notes.md', 'Weekly Summary.md', 'market-research.md'], 'Board note');
		assert.ok(uri, 'the template file is still created without a model');
		assert.strictEqual(service.getPendingForDoc(uri!).length, 0, 'no fabricated analysis is queued without a model');
		const status = service.getStatus(uri!);
		assert.ok(/model/i.test(status), `the status names the model: ${status}`);
		assert.ok(!/no commonalities/i.test(status), 'a model outage is NEVER rendered as "no commonalities" (the F14 rule)');
	});

	// Plan 28, iter 4: a named blank create is born titled; an empty name keeps decision 56's Untitled path.
	test('createDocument(name) writes a titled <name>.md; an empty name keeps the Untitled escape hatch', async () => {
		const service = createService();
		const named = await service.createDocument('Quarterly plan');
		assert.ok(named && named.path.endsWith('Quarterly plan.md'), 'a provided name is born titled');
		const blank = await service.createDocument();
		assert.ok(blank && blank.path.endsWith('Untitled.md'), 'no name keeps the Untitled name-on-first-save path');
	});

	test('getWorkspaceFolderName returns the open folder name, or undefined when no folder is open', async () => {
		assert.strictEqual(createService().getWorkspaceFolderName(), 'ws', 'reports the open folder name');
		assert.strictEqual(createService([], { noFolder: true }).getWorkspaceFolderName(), undefined, 'undefined when no folder is open');
	});

	test('openFolder opens the picked folder in the same window; cancelling opens nothing', async () => {
		const picked = URI.file('/picked-folder');
		const service = createService([], { pickFolder: picked });
		await service.openFolder();
		assert.deepStrictEqual(lastOpenedFolder?.toString(), picked.toString(), 'the picked folder is opened as the workspace');

		const cancelled = createService(); // no pickFolder -> the picker returns nothing
		await cancelled.openFolder();
		assert.strictEqual(lastOpenedFolder, undefined, 'cancelling the picker opens no window');
	});

	test('addSource adds a source to the doc frontmatter (no prose touched), persists to disk, and resolves it', async () => {
		const service = createService();
		lastFiles!.set(URI.file('/ws/forecast.csv').toString(), 'week,arr\n24,500000\n');
		await service.loadDocument(WEEKLY);

		await service.addSource(WEEKLY, 'forecast.csv');

		assert.ok(service.getDoc(WEEKLY)!.sources.includes('forecast.csv'), 'source added to the in-memory doc');
		const onDisk = lastFiles!.get(WEEKLY.toString()) ?? '';
		assert.ok(/sources:[\s\S]*forecast\.csv/.test(onDisk), `persisted into the frontmatter on disk: ${onDisk.slice(0, 80)}`);
		assert.ok(onDisk.includes('Growth remained steady this week.'), 'prose left untouched');
	});

	test('removeSource drops a source from the doc frontmatter and persists', async () => {
		const service = createService();
		await service.loadDocument(WEEKLY);

		await service.removeSource(WEEKLY, 'metrics.csv');

		assert.deepStrictEqual(service.getDoc(WEEKLY)!.sources, [], 'source removed from the in-memory doc');
		assert.ok(!(lastFiles!.get(WEEKLY.toString()) ?? '').includes('metrics.csv'), 'removed from the on-disk frontmatter');
	});

	test('getSourceCandidates lists the folder data files not already bound (excludes lock sidecars + the bound source)', async () => {
		const service = createService();
		lastFiles!.set(URI.file('/ws/forecast.csv').toString(), 'week,arr\n');
		lastFiles!.set(URI.file('/ws/crm.json').toString(), '{}');
		await service.loadDocument(WEEKLY); // bootstraps Weekly Summary.lock.json, which must NOT be offered

		const candidates = await service.getSourceCandidates(WEEKLY);
		assert.deepStrictEqual([...candidates].sort(), ['crm.json', 'forecast.csv'], 'folder csv/json minus the bound metrics.csv and the lock sidecar');
	});

	test('exportMarkdown writes a clean static .md with resolved values and no bind syntax', async () => {
		const opened: IOpenedEditor[] = [];
		const service = createService(opened);
		await service.loadDocument(WEEKLY);
		await service.refreshFromSources();

		const target = await service.exportMarkdown(WEEKLY);
		assert.ok(target && target.path.endsWith('Weekly Summary.export.md'), `target name: ${target?.path}`);
		const md = lastFiles!.get(target!.toString()) ?? '';
		assert.ok(md.startsWith('# Weekly Operating Summary'), 'starts with the H1 title');
		assert.ok(md.includes('$48.6k') && md.includes('427'), 'resolved values inlined');
		assert.ok(!md.includes('bind:') && !md.includes(']('), 'no bind-link syntax in the export');
	});

	test('shareDocument copies the resolved, binding-free Markdown to the clipboard and confirms', async () => {
		const service = createService();
		await service.loadDocument(WEEKLY);
		await service.refreshFromSources();

		await service.shareDocument(WEEKLY);

		assert.ok(lastClipboard !== undefined, 'something was written to the clipboard');
		assert.ok(!lastClipboard!.includes('](bind:'), 'no bind-link syntax in the shared markdown');
		assert.ok(lastClipboard!.includes('$48.6k') && lastClipboard!.includes('427'), 'resolved values inlined');
		assert.ok(lastNotifications.some(n => n.message.includes('Copied')), 'a confirmation toast was surfaced');
	});

	test('exportDocx posts the RESOLVED Markdown to the proxy route and writes the .docx beside the document', async () => {
		const service = createService([]);
		await service.loadDocument(WEEKLY);
		await service.refreshFromSources();

		const target = await service.exportDocx(WEEKLY);
		assert.ok(target && target.path.endsWith('Weekly Summary.export.docx'), `target name: ${target?.path}`);
		const posted = JSON.parse(lastDocxBody ?? '{}');
		assert.ok(posted.markdown.includes('$48.6k') && !posted.markdown.includes('bind:'), 'the posted body carries resolved values, no bindings');
		assert.ok((lastFiles!.get(target!.toString()) ?? '').startsWith('PK'), 'the returned .docx bytes are written beside the document');
	});

	test('exportDocx honours the before-export gate: blocked unforced, audited override with force', async () => {
		const service = createService([], { badBind: true });
		await service.loadDocument(BADBIND);

		assert.strictEqual(await service.exportDocx(BADBIND), undefined, 'an unforced docx export is blocked at the gate');
		const target = await service.exportDocx(BADBIND, true);
		assert.ok(target && target.path.endsWith('.export.docx'), 'the forced docx export writes the file');
		assert.ok(service.getAudit().some(e => e.via === 'override'), 'the override lands on the audit trail via:override');
	});

	test('exportPdf hands the self-contained HTML to the desktop print command and writes the .pdf', async () => {
		const service = createService([]);
		await service.loadDocument(WEEKLY);
		await service.refreshFromSources();
		pdfCommandBytes = VSBuffer.wrap(new Uint8Array([0x25, 0x50, 0x44, 0x46])); // "%PDF"

		const target = await service.exportPdf(WEEKLY);
		assert.ok(target && target.path.endsWith('Weekly Summary.export.pdf'), `target name: ${target?.path}`);
		assert.ok((lastPrintPdfHtml ?? '').includes('<!DOCTYPE html>') && (lastPrintPdfHtml ?? '').includes('Weekly Operating Summary'), 'the resolved HTML page was handed to print-to-PDF');
		assert.ok((lastFiles!.get(target!.toString()) ?? '').startsWith('%PDF'), 'the PDF bytes are written beside the document');
		pdfCommandBytes = undefined;
	});

	test('exportPdf is honestly unavailable on the web harness (no print command) and writes nothing', async () => {
		const service = createService([]);
		await service.loadDocument(WEEKLY);
		await service.refreshFromSources();
		pdfCommandBytes = undefined; // the desktop command is absent on web

		const target = await service.exportPdf(WEEKLY);
		assert.strictEqual(target, undefined, 'no PDF is produced when the desktop print command is absent');
		assert.strictEqual(lastFiles!.get(URI.file('/ws/Weekly Summary.export.pdf').toString()), undefined, 'nothing is written');
	});

	function manualAgent(policy: AgentPolicy): IAgentDef {
		return { id: 'agent', name: 'Agent', trigger: { kind: 'manual' }, flow: { sources: [], docs: [WEEKLY.toString()] }, policy, status: 'idle' };
	}

	test('policy auto-figures applies the figure silently and audits it, with nothing queued', async () => {
		const service = createService([], { agents: [manualAgent('auto-figures')] });
		await service.loadDocument(WEEKLY);

		await service.runAgent('agent');

		const highlights = blockText(service, WEEKLY, 'h-highlights');
		assert.ok(highlights.includes('[$48.6k](bind:metrics.mrr)'), `figure auto-applied to the doc: ${highlights}`);
		assert.strictEqual(service.getPendingForDoc(WEEKLY).length, 0, 'nothing queued for review');
		assert.ok(service.getAudit().some(e => e.action === 'auto-applied'), 'auto-apply audited in the lock');
	});

	test('policy ask-before-apply queues a pending figure change and leaves the doc untouched', async () => {
		const service = createService([], { agents: [manualAgent('ask-before-apply')] });
		await service.loadDocument(WEEKLY);

		await service.runAgent('agent');

		assert.ok(blockText(service, WEEKLY, 'h-highlights').includes('[$41.2k](bind:metrics.mrr)'), 'doc cache untouched');
		const pending = service.getPendingForDoc(WEEKLY);
		assert.deepStrictEqual({ count: pending.length, kind: pending[0]?.kind, draft: !!pending[0]?.draft }, { count: 1, kind: 'figure', draft: false });
	});

	test('policy draft-only prepares a draft in the rail and never lands it', async () => {
		const service = createService([], { agents: [manualAgent('draft-only')] });
		await service.loadDocument(WEEKLY);

		await service.runAgent('agent');

		assert.ok(blockText(service, WEEKLY, 'h-highlights').includes('[$41.2k](bind:metrics.mrr)'), 'doc untouched by a draft-only run');
		const pending = service.getPendingForDoc(WEEKLY);
		assert.deepStrictEqual({ count: pending.length, draft: !!pending[0]?.draft }, { count: 1, draft: true });
	});

	// --- plan 32 iter 1: policy routing on the EVENT path (a live source edit ripples without a manual Refresh) ---

	function eventAgent(policy: AgentPolicy): IAgentDef {
		return { id: 'agent', name: 'Watcher', trigger: { kind: 'event', source: '*' }, flow: { sources: [], docs: [] }, policy, status: 'idle' };
	}

	test('a source event under an auto-figures agent applies figures immediately (no manual Refresh)', async () => {
		const service = createService([], { agents: [eventAgent('auto-figures')] });
		await service.loadDocument(WEEKLY);

		// A source change fires the event agent over the dirtied co-dependents (the propagation graph walk).
		await service.orchestrator.onSourceChanged('/ws/metrics.csv');

		const highlights = blockText(service, WEEKLY, 'h-highlights');
		assert.ok(highlights.includes('[$48.6k](bind:metrics.mrr)'), `figure landed on the event path: ${highlights}`);
		assert.strictEqual(service.getPendingForDoc(WEEKLY).length, 0, 'auto-figures queues nothing on the event path');
		assert.ok(service.getAudit().some(e => e.action === 'auto-applied'), 'the event-path auto-apply is audited');
		assert.ok(!service.orchestrator.isDirty(WEEKLY), 'the event agent drains the dirty bit it processed');
	});

	test('a source event under a draft-only agent queues drafts and never lands them (event path)', async () => {
		const service = createService([], { agents: [eventAgent('draft-only')] });
		await service.loadDocument(WEEKLY);

		await service.orchestrator.onSourceChanged('/ws/metrics.csv');

		assert.ok(blockText(service, WEEKLY, 'h-highlights').includes('[$41.2k](bind:metrics.mrr)'), 'draft-only leaves the doc untouched on the event path');
		const pending = service.getPendingForDoc(WEEKLY);
		assert.deepStrictEqual({ count: pending.length, draft: !!pending[0]?.draft }, { count: 1, draft: true }, 'a draft is queued for review');
	});

	test('the verify gate blocks a run whose figures do not reconcile (Financial flag), applying nothing', async () => {
		const agent: IAgentDef = { id: 'agent', name: 'Agent', trigger: { kind: 'manual' }, flow: { sources: [], docs: [BADBIND.toString()] }, policy: 'auto-figures', status: 'idle' };
		const service = createService([], { badBind: true, agents: [agent] });
		await service.loadDocument(BADBIND);

		await service.runAgent('agent');

		const ratio = service.getDoc(BADBIND)!.blocks.find(b => b.type === 'paragraph' && b.binds.length > 0)!;
		assert.ok(ratio.text.includes('[$41.2k](bind:metrics.mrr)'), 'no figure applied - the run was blocked at the gate');
		assert.strictEqual(service.getAgents().find(a => a.id === 'agent')!.status, 'blocked', 'agent surfaces the blocked state');
		assert.strictEqual(service.getPendingForDoc(BADBIND).length, 0, 'nothing queued either');
	});

	test('a clean run passes the verify gate and lands the figure', async () => {
		const service = createService([], { agents: [manualAgent('auto-figures')] });
		await service.loadDocument(WEEKLY);

		await service.runAgent('agent');

		assert.ok(blockText(service, WEEKLY, 'h-highlights').includes('[$48.6k](bind:metrics.mrr)'), 'clean figures land');
		assert.strictEqual(service.getAgents().find(a => a.id === 'agent')!.status, 'idle', 'agent is not blocked');
	});

	test('before-export gate blocks export when the document figures do not reconcile', async () => {
		const service = createService([], { badBind: true });
		await service.loadDocument(BADBIND);

		const target = await service.exportMarkdown(BADBIND);

		assert.strictEqual(target, undefined, 'export blocked at the gate');
		assert.strictEqual(lastFiles!.get(URI.file('/ws/Ratio Doc.export.md').toString()), undefined, 'no export file written');
	});

	test('on-publish writes a pin snapshotting the current source versions', async () => {
		const service = createService();
		await service.loadDocument(WEEKLY);

		await service.publishDocument(WEEKLY);

		const pins = service.getLock(WEEKLY)!.pins;
		assert.ok(pins.some(p => p.source === 'metrics.csv' && !!p.version), `pinned to the source version: ${JSON.stringify(pins)}`);
	});

	// --- plan 32 iter 4: the gate is visible + override-audited; publish pins surface ---

	test('previewExportGate surfaces the failed grader reason so the export flow can show it (no silent block)', async () => {
		const service = createService([], { badBind: true });
		await service.loadDocument(BADBIND);
		const gate = service.previewExportGate(BADBIND);
		assert.strictEqual(gate.pass, false, 'the gate reports the failure to the surface');
		assert.ok(gate.flag && /reconcile/i.test(gate.flag), 'the one-line grader reason is available for the modal');
	});

	test('exporting PAST a failed gate with force writes the file AND audits the override (no silent override)', async () => {
		const service = createService([], { badBind: true });
		await service.loadDocument(BADBIND);

		// Without force the gate blocks (existing behaviour); with force the export proceeds and is audited.
		assert.strictEqual(await service.exportMarkdown(BADBIND), undefined, 'unforced export is still blocked at the gate');
		const target = await service.exportMarkdown(BADBIND, true);
		assert.ok(target, 'the forced export writes the file');
		assert.ok(service.getAudit().some(e => e.via === 'override'), 'the override lands on the audit trail via:override');
	});

	test('publishing PAST a failed gate with force publishes and audits the override', async () => {
		const service = createService([], { badBind: true });
		await service.loadDocument(BADBIND);
		assert.strictEqual(service.getLock(BADBIND)!.pins.length, 0, 'not published yet');

		await service.publishDocument(BADBIND); // blocked, no pins
		assert.strictEqual(service.getLock(BADBIND)!.pins.length, 0, 'an unforced publish past a failed gate does nothing');

		await service.publishDocument(BADBIND, true);
		assert.ok(service.getAudit().some(e => e.via === 'override'), 'the forced publish audits the override');
	});

	test('a publish records the real pin count on its snapshot so History can name it', async () => {
		const service = createService();
		await service.loadDocument(WEEKLY);
		await service.publishDocument(WEEKLY);

		const published = service.getSnapshots(WEEKLY).find(s => s.via === 'publish');
		assert.ok(published, 'a publish snapshot is recorded');
		assert.strictEqual(published!.pinnedSources, service.getLock(WEEKLY)!.pins.length, 'the snapshot carries the true pin count for the History row');
		assert.ok(published!.pinnedSources! > 0, 'the sample doc pins at least one source version');
	});

	test('source-peek shows the pinned version line on a published document (plan 32 iter 4)', async () => {
		const service = createService();
		await service.loadDocument(WEEKLY);
		await service.publishDocument(WEEKLY);

		const peek = service.getSourcePeek(WEEKLY, ['metrics.mrr']);
		assert.ok(peek, 'source-peek is available');
		assert.ok(peek!.pinnedLabel && /pinned at v/.test(peek!.pinnedLabel), `the pinned version line is surfaced: ${peek!.pinnedLabel}`);
	});

	// --- plan 32 iter 3: run a Skill across every project document (the P3 gap) ---

	test('runSkillAcrossProject fans the grade over every living document with a real per-doc verdict', async () => {
		const service = createService([], { boardNote: true });
		await service.loadDocument(WEEKLY);
		await service.loadDocument(BOARD);

		const summary = await service.runSkillAcrossProject('financial', 'Financial agent');
		assert.strictEqual(summary.skillId, 'financial');
		// Every living document in the folder is graded (WEEKLY + BOARD; the plain README is not living).
		assert.ok(summary.results.length >= 2, `every living doc is graded: ${summary.results.map(r => r.docTitle).join(', ')}`);
		assert.ok(summary.results.every(r => r.status === 'pass' || r.status === 'flag' || r.status === 'skipped'), 'each result is a real grade');
		assert.strictEqual(summary.flagged + summary.passed + summary.skipped, summary.results.length, 'the tallies cover every result');
	});

	test('on-open freshness shows a changed source as stale without a manual refresh', async () => {
		const service = createService();
		await service.loadDocument(WEEKLY);
		assert.strictEqual(service.getFreshness(WEEKLY).dirty, false, 'current on first open');

		// A source moves on while the doc is closed; re-opening must surface the staleness.
		lastFiles!.set(URI.file('/ws/metrics.csv').toString(), METRICS_CSV + '\n25,Jun 26,52000,470,2.2,210');
		await service.loadDocument(WEEKLY);

		assert.ok(service.getFreshness(WEEKLY).dirty, 'on-open recompute flags the changed source');
	});

	test('getSourcePeek returns in-surface source data (no side editor): bound keys, selected cells, referencing docs', async () => {
		const opened: IOpenedEditor[] = [];
		const service = createService(opened, { boardNote: true });
		await service.loadDocument(WEEKLY);
		await service.loadDocument(BOARD); // a second living doc that shares metrics.csv
		opened.length = 0;

		const peek = service.getSourcePeek(WEEKLY, ['metrics.mrr']);

		assert.ok(peek, 'returns in-surface peek data for a living doc');
		const projection = {
			openedEditors: opened.length, // the abrasion: source-peek must NOT open a 2nd editor group
			source: peek!.source,
			selectedKeys: peek!.rows.filter(r => r.selected).map(r => r.key),
			hasOtherBoundKeys: peek!.rows.some(r => !r.selected),
			referencesBoard: peek!.referencedBy.includes('Board Note'),
		};
		assert.deepStrictEqual(projection, {
			openedEditors: 0,
			source: 'metrics.csv',
			selectedKeys: ['metrics.mrr'],
			hasOtherBoundKeys: true,
			referencesBoard: true,
		});
	});

	// --- snapshots / versions (plan 26 iter 2: the trust spine) -------------------

	// One chat reply that queues an edit + an insert, so a bulk approve has two real changes to land.
	function chatEditAndInsert(): object {
		return modelMessage({
			reply: 'Edited and added.',
			edits: [{ heading: 'Commentary', oldText: 'Growth remained steady this week.', newText: 'Growth accelerated this week.', rationale: 'r' }],
			inserts: [{ afterHeading: 'Commentary', newText: 'A new closing note.', rationale: 'r' }],
		});
	}

	test('refreshFromSources creates one snapshot labelled "Before refresh" when figures change', async () => {
		const service = createService();
		await service.loadDocument(WEEKLY);
		const bodyBeforeRefresh = service.getRawText(WEEKLY);
		lastFiles!.set(URI.file('/ws/metrics.csv').toString(), METRICS_CSV + '\n25,Jun 26,52000,470,2.2,210');

		await service.refreshFromSources();

		const snapshots = service.getSnapshots(WEEKLY);
		assert.deepStrictEqual(
			{ count: snapshots.length, label: snapshots[0]?.label, via: snapshots[0]?.via, body: snapshots[0]?.body },
			{ count: 1, label: 'Before refresh', via: 'refresh', body: bodyBeforeRefresh },
		);
	});

	test('a bulk approve creates one snapshot labelled "Before bulk approve" (via: bulk-approve)', async () => {
		const service = createService([], { model: chatEditAndInsert() });
		await service.loadDocument(WEEKLY);
		await service.sendChatMessage(WEEKLY, 'Tighten the commentary and add a note');
		assert.strictEqual(service.getPendingForDoc(WEEKLY).length, 2, 'two changes queued');
		const bodyBeforeApprove = service.getRawText(WEEKLY);

		await service.approveAll(WEEKLY.toString());

		const snapshots = service.getSnapshots(WEEKLY);
		assert.deepStrictEqual(
			{ count: snapshots.length, label: snapshots[0]?.label, via: snapshots[0]?.via, body: snapshots[0]?.body },
			{ count: 1, label: 'Before bulk approve', via: 'bulk-approve', body: bodyBeforeApprove },
		);
	});

	test('snapshots cap at 50 with oldest-eviction, keeping the newest', async () => {
		const service = createService();
		await service.loadDocument(WEEKLY);
		for (let i = 0; i < 55; i++) {
			await service.saveSnapshot(WEEKLY, `Version ${i}`, 'manual');
		}

		const snapshots = service.getSnapshots(WEEKLY); // newest first
		assert.deepStrictEqual(
			{ count: snapshots.length, newest: snapshots[0].label, oldestKept: snapshots[snapshots.length - 1].label },
			{ count: 50, newest: 'Version 54', oldestKept: 'Version 5' },
		);
	});

	test('restoreSnapshot writes the body back, audits it (via: restore), and re-flags stale bindings', async () => {
		const service = createService();
		await service.loadDocument(WEEKLY);
		const originalBody = service.getRawText(WEEKLY); // week-23 authored figures

		// Version the original, then refresh so the on-disk body moves to the current source values and
		// the lock's binding hashes catch up (freshness clears).
		await service.saveSnapshot(WEEKLY, 'Original', 'manual');
		await service.refreshFromSources();
		assert.notStrictEqual(service.getRawText(WEEKLY), originalBody, 'the body moved on after refresh');
		assert.deepStrictEqual(service.getFreshness(WEEKLY).staleBindings, [], 'freshness clear after refresh');

		// The source moves on again (a new week). Nothing has re-synced the lock, so restoring the older
		// version and recomputing freshness must surface the bindings as stale again (correct + visible).
		lastFiles!.set(URI.file('/ws/metrics.csv').toString(), METRICS_CSV + '\n25,Jun 26,52000,510,2.1,220');

		const original = service.getSnapshots(WEEKLY).find(s => s.label === 'Original')!;
		await service.restoreSnapshot(WEEKLY, original.id);

		const lock = service.getLock(WEEKLY)!;
		const restoreEntry = lock.audit.find(e => e.via === 'restore');
		assert.deepStrictEqual(
			{
				body: service.getRawText(WEEKLY),
				pending: service.getPendingForDoc(WEEKLY).length,
				auditVia: restoreEntry?.via,
				auditAction: restoreEntry?.action,
				staleReflagged: service.getFreshness(WEEKLY).staleBindings.length > 0,
			},
			{ body: originalBody, pending: 0, auditVia: 'restore', auditAction: 'approved', staleReflagged: true },
		);
	});

	test('restoreSnapshot rejects pending changes for the document first', async () => {
		const service = createService([], { model: chatEditAndInsert() });
		await service.loadDocument(WEEKLY);
		// Version the original, then refresh so the current body differs from that version (so restoring
		// it is a real body change, not a no-op).
		await service.saveSnapshot(WEEKLY, 'Original', 'manual');
		await service.refreshFromSources();
		// Queue changes WITHOUT approving them, then restore: the pending set must be rejected first.
		await service.sendChatMessage(WEEKLY, 'Tighten the commentary and add a note');
		assert.ok(service.getPendingForDoc(WEEKLY).length > 0, 'changes are pending before restore');

		const original = service.getSnapshots(WEEKLY).find(s => s.label === 'Original')!;
		await service.restoreSnapshot(WEEKLY, original.id);

		assert.strictEqual(service.getPendingForDoc(WEEKLY).length, 0, 'pending changes were rejected by the restore');
	});

	// (debt: sample root mount) Reproduce the web/memfs "mount" scenario for the SAMPLE ROOT: a single
	// workspace folder labelled with a mount stub ("mount"), shipping an `.abstract-name` marker at its
	// root AND holding documents both at the top level and inside a subfolder. The project name must
	// resolve to the marker ("Living Docs Sample") - not the stub - and the top-level + nested documents
	// must all be listed (the root is NOT "0 docs").
	function createMountService(opts: { folderName?: string; marker?: string; withDocs?: boolean; lateProvider?: boolean } = {}): { service: LivingDocsService; files: Map<string, string>; registerProvider: () => void } {
		const mountRoot = URI.parse('vscode-test-web://mount/');
		const files = new Map<string, string>();
		if (opts.marker !== undefined) {
			files.set(URI.parse('vscode-test-web://mount/.abstract-name').toString(), opts.marker);
		}
		if (opts.withDocs) {
			// Two top-level documents + one inside a `brief/` subfolder, mirroring the shipped sample root.
			files.set(URI.parse('vscode-test-web://mount/Board Note.md').toString(), PLAIN_MD);
			files.set(URI.parse('vscode-test-web://mount/Team Notes.md').toString(), PLAIN_MD);
			files.set(URI.parse('vscode-test-web://mount/brief/Project Brief.md').toString(), PLAIN_MD);
		}
		// Model the web-build race: until the file-system provider registers, reads/scans on the mount fail
		// with a no-provider error (matching the real `ENOPRO`). `registerProvider()` fires the registration
		// event the service listens to, so a test can prove the marker + document scan retry once it arrives.
		const registrations = new Emitter<{ added: boolean; scheme: string }>();
		let providerReady = !opts.lateProvider;
		const assertProvider = (resource: URI) => {
			if (!providerReady && resource.scheme === mountRoot.scheme) { throw new Error(`ENOPRO: no provider for ${resource.toString()}`); }
		};
		const fileService = {
			onDidChangeFileSystemProviderRegistrations: registrations.event,
			readFile: async (resource: URI) => {
				assertProvider(resource);
				const content = files.get(resource.toString());
				if (content === undefined) { throw new Error(`not found: ${resource.toString()}`); }
				return { value: VSBuffer.fromString(content) };
			},
			writeFile: async (resource: URI, buffer: VSBuffer) => { files.set(resource.toString(), buffer.toString()); },
			resolve: async (resource: URI) => {
				assertProvider(resource);
				const prefix = resource.toString().replace(/\/+$/, '') + '/';
				const children: { resource: URI; isDirectory: boolean }[] = [];
				const dirs = new Set<string>();
				for (const key of files.keys()) {
					if (!key.startsWith(prefix)) { continue; }
					const rest = key.slice(prefix.length);
					const slash = rest.indexOf('/');
					if (slash < 0) { children.push({ resource: URI.parse(key), isDirectory: false }); }
					else { dirs.add(prefix + rest.slice(0, slash)); }
				}
				for (const dir of dirs) { children.push({ resource: URI.parse(dir), isDirectory: true }); }
				return { children };
			},
		} as unknown as IFileService;
		store.add(registrations);
		const registerProvider = () => { providerReady = true; registrations.fire({ added: true, scheme: mountRoot.scheme }); };
		const editorService = { openEditor: async () => undefined, onDidActiveEditorChange: Event.None, activeEditor: undefined } as unknown as IEditorService;
		const viewsService = { openView: async () => null } as unknown as IViewsService;
		const configurationService = { getValue: () => true } as unknown as IConfigurationService;
		const notificationService = { info: () => undefined } as unknown as INotificationService;
		const requestService = { request: async () => ({ res: { statusCode: 200, headers: {} }, stream: bufferToStream(VSBuffer.fromString('{}')) }) } as unknown as IRequestService;
		const workspaceService = { getWorkspace: () => ({ folders: [{ uri: mountRoot, name: opts.folderName ?? 'mount' }] }), onDidChangeWorkspaceFolders: Event.None } as unknown as IWorkspaceContextService;
		const fileDialogService = { showOpenDialog: async () => undefined } as unknown as IFileDialogService;
		const hostService = { openWindow: async () => undefined } as unknown as IHostService;
		const clipboardService = { writeText: async () => undefined } as unknown as IClipboardService;
		const commandService = { executeCommand: async () => undefined } as unknown as ICommandService;
		const service = new LivingDocsService(fileService, editorService, viewsService, configurationService, notificationService, new NullLogService(), requestService, workspaceService, fileDialogService, hostService, new NullAnalyticsService(), store.add(new InMemoryStorageService()), commandService, clipboardService, { isVisible: () => false } as unknown as IWorkbenchLayoutService);
		store.add(service);
		return { service, files, registerProvider };
	}

	test('the sample ROOT mount resolves its `.abstract-name` marker (not the "mount" stub)', async () => {
		const { service } = createMountService({ marker: 'Living Docs Sample\n', withDocs: true });
		// The marker is read asynchronously in the constructor; let that microtask settle.
		await Promise.resolve();
		await Promise.resolve();
		assert.strictEqual(service.getProjectDisplayName(), 'Living Docs Sample');
	});

	test('the sample ROOT mount lists its top-level AND nested documents (not "0 docs")', async () => {
		const { service } = createMountService({ marker: 'Living Docs Sample\n', withDocs: true });
		const docs = await service.listDocuments();
		const titles = docs.map(d => d.resource.path);
		assert.strictEqual(docs.length, 3, `expected 3 documents, got ${docs.length}: ${titles.join(', ')}`);
	});

	test('a mount folder that ships NO marker still shows its honest stub name (never fabricated)', async () => {
		const { service } = createMountService({ withDocs: true });
		await Promise.resolve();
		await Promise.resolve();
		assert.strictEqual(service.getProjectDisplayName(), 'mount');
	});

	test('the sample ROOT marker resolves once the mount provider registers late (the web-build race)', async () => {
		// The provider is not ready at construction, so the startup marker read fails - the crumb is the
		// bare stub, exactly the reported "mount / 0 docs" symptom.
		const { service, registerProvider } = createMountService({ marker: 'Living Docs Sample\n', withDocs: true, lateProvider: true });
		await Promise.resolve();
		await Promise.resolve();
		assert.strictEqual(service.getProjectDisplayName(), 'mount', 'stub shown while the provider is unavailable');

		// When the mount provider registers, the marker is re-read and the name resolves truthfully.
		registerProvider();
		await Promise.resolve();
		await Promise.resolve();
		assert.strictEqual(service.getProjectDisplayName(), 'Living Docs Sample', 'marker resolves after the provider arrives');
		// The same registration retries the document scan, so the root is no longer "0 docs".
		assert.strictEqual((await service.listDocuments()).length, 3);
	});

	// --- provenance-safe file operations (issue #125, docs 20 section 1d / map-D6) ---

	test('deleting a depended-on source flags its dependents STALE (orphaned, not broken); Undo restores them fresh', async () => {
		const service = createService();
		await service.loadDocument(WEEKLY);
		assert.strictEqual(service.getFreshness(WEEKLY).dirty, false, 'fresh after load');

		await service.deleteFile(URI.file('/ws/metrics.csv'));
		const stale = service.getFreshness(WEEKLY);
		assert.ok(stale.staleBindings.includes('metrics.mrr'), `metrics.mrr flagged stale after the source delete, got: [${stale.staleBindings.join(', ')}]`);
		assert.strictEqual(service.getStatus(WEEKLY), 'Sources changed - may be affected', 'the sync pill reads stale, never "All sources synced"');
		// Orphaned gracefully: the cached resolved values survive (the document still renders its figures).
		assert.ok(service.getResolved(WEEKLY).has('metrics.mrr'), 'cached lock value kept for the orphaned binding');

		// The Undo toast restores the pair; the dependent re-reads fresh (values resolve, hashes still match).
		const toast = lastNotifications.find(n => n.message === 'Deleted "metrics.csv".');
		assert.ok(toast?.actions?.primary?.[0], 'delete toast carries an Undo action');
		await toast!.actions!.primary![0].run();
		const fresh = service.getFreshness(WEEKLY);
		assert.deepStrictEqual({ dirty: fresh.dirty, staleBindings: [...fresh.staleBindings] }, { dirty: false, staleBindings: [] }, 'fresh again after Undo');
		assert.strictEqual(service.getStatus(WEEKLY), 'All sources synced');
	});

	test('a dependent opened AFTER its source was deleted loads flagged stale, with its cached figures intact', async () => {
		const service = createService();
		await service.loadDocument(WEEKLY); // records the lock (the provenance the orphan keeps)
		await service.deleteFile(URI.file('/ws/metrics.csv'));

		// A fresh open of the dependent (re-load from disk) must flag, not crash and not read synced.
		await service.loadDocument(WEEKLY);
		const fresh = service.getFreshness(WEEKLY);
		assert.ok(fresh.staleBindings.includes('metrics.mrr'), `stale on fresh open, got: [${fresh.staleBindings.join(', ')}]`);
		assert.strictEqual(service.getStatus(WEEKLY), 'Sources changed - may be affected');
		assert.ok(service.getDoc(WEEKLY)!.blocks.length > 0, 'the document still renders');
		assert.ok(service.getResolved(WEEKLY).has('metrics.mrr'), 'cached lock value kept');
	});

	test('an api-backed document does NOT flag stale from the missing-file check (resolution misses keep their behaviour)', async () => {
		const service = createService([], { api: true });
		await service.loadDocument(API);
		// The api source is not a local file; whatever its resolution does, the deleted-file re-flag must not fire.
		const fresh = service.getFreshness(API);
		assert.strictEqual(fresh.staleBindings.length, 0, `no stale bindings from the exists probe, got: [${fresh.staleBindings.join(', ')}]`);
	});

	test('a failed sidecar delete rolls the file back - the delete pair never half-applies', async () => {
		const service = createService([], { failLockDelete: true });
		await service.loadDocument(WEEKLY); // bootstraps + persists the lock sidecar
		const lockKey = URI.file('/ws/Weekly Summary.lock.json').toString();
		assert.ok(lastFiles!.has(lockKey), 'lock sidecar exists before the delete');
		const before = lastFiles!.get(WEEKLY.toString());

		await service.deleteFile(WEEKLY);
		assert.strictEqual(lastFiles!.get(WEEKLY.toString()), before, 'the file was rolled back after the sidecar delete failed');
		assert.ok(lastFiles!.has(lockKey), 'the lock sidecar is untouched');
		const err = lastNotifications.find(n => /sidecar could not be removed/.test(n.message));
		assert.ok(err, `a named error was raised, got: [${lastNotifications.map(n => n.message).join(' | ')}]`);
		assert.ok(/Nothing was changed\./.test(err!.message), 'the error honestly reports nothing changed');
		assert.strictEqual(lastNotifications.some(n => n.message === 'Deleted "Weekly Summary.md".'), false, 'no success toast for a failed delete');
	});

	// --- plan 42 L5: a rename is a plain human edit and succeeds SILENTLY (no toast to dismiss) ---

	test('renaming a document moves the file and raises NO toast (only the error paths speak up)', async () => {
		const service = createService();
		await service.loadDocument(WEEKLY); // a living doc, so a lock sidecar exists and moves with the file

		await service.renameFile(WEEKLY, 'Board Summary');

		const target = URI.file('/ws/Board Summary.md');
		assert.deepStrictEqual(
			{
				movedFile: lastFiles!.has(target.toString()),
				oldFileGone: lastFiles!.has(WEEKLY.toString()),
				movedLock: lastFiles!.has(URI.file('/ws/Board Summary.lock.json').toString()),
				oldLockGone: lastFiles!.has(URI.file('/ws/Weekly Summary.lock.json').toString()),
				toasts: lastNotifications.map(n => n.message),
			},
			{ movedFile: true, oldFileGone: false, movedLock: true, oldLockGone: false, toasts: [] },
			'the file + lock move together and the rename is silent - no success/Undo toast'
		);
	});

	test('renaming onto an existing name refuses and names the clash (a legitimate error still speaks up)', async () => {
		const service = createService();
		lastFiles!.set(URI.file('/ws/Board Notes.md').toString(), '# Board Notes\n');
		await service.loadDocument(README);

		await service.renameFile(README, 'Board Notes');

		assert.deepStrictEqual(
			{ stillThere: lastFiles!.has(README.toString()), toasts: lastNotifications.map(n => n.message) },
			{ stillThere: true, toasts: ['Cannot rename to "Board Notes.md" - a file with that name already exists.'] },
			'nothing moved and the one error names the clash'
		);
	});

	// --- the Tidy verb: folder-convention moves through the review grammar (issue #132, doc 22 section 5) ---

	// A move plan item addressing a real file, built by hand so the move op can be exercised directly (the
	// conservative plan builder is unit-tested separately in tidyPlan.test.ts).
	function moveItem(from: URI, to: URI, dependents: readonly { resource: URI; title: string }[] = []) {
		return { fromResource: from, toResource: to, fromLabel: relFromWs(from), toLabel: relFromWs(to), reason: 'test move', dependents };
	}
	function relFromWs(uri: URI): string { return uri.path.replace('/ws/', ''); }

	test('applyTidyMoves moves a document AND its lock sidecar together, creating the folder on demand', async () => {
		const service = createService();
		await service.loadDocument(WEEKLY); // persists the lock sidecar beside the document
		const lockKey = URI.file('/ws/Weekly Summary.lock.json').toString();
		assert.ok(lastFiles!.has(lockKey), 'the sidecar exists before the move');

		await service.applyTidyMoves([moveItem(WEEKLY, URI.file('/ws/archive/Weekly Summary.md'))]);

		assert.ok(lastFiles!.has(URI.file('/ws/archive/Weekly Summary.md').toString()), 'the document moved into archive/');
		assert.ok(lastFiles!.has(URI.file('/ws/archive/Weekly Summary.lock.json').toString()), 'the lock sidecar followed it atomically');
		assert.strictEqual(lastFiles!.has(WEEKLY.toString()), false, 'the original document is gone');
		assert.strictEqual(lastFiles!.has(lockKey), false, 'the original sidecar is gone');
		assert.ok(createdFolders.includes(URI.file('/ws/archive').toString()), 'the archive/ folder was created on demand');
		assert.ok(lastNotifications.find(n => /Tidied 1 file into folders\./.test(n.message))?.actions?.primary?.[0], 'a sticky Undo toast is raised');
	});

	test('applyTidyMoves re-points every dependent lock + frontmatter so bindings survive the move', async () => {
		const service = createService();
		await service.loadDocument(WEEKLY); // Weekly binds metrics.csv; persists its lock

		const deps = await service.getFileDependents(URI.file('/ws/metrics.csv'));
		assert.deepStrictEqual(deps.map(d => d.title), ['Weekly Operating Summary'], 'metrics.csv has the Weekly Summary as a dependent');

		await service.applyTidyMoves([moveItem(URI.file('/ws/metrics.csv'), URI.file('/ws/data/metrics.csv'), deps)]);

		assert.ok(lastFiles!.has(URI.file('/ws/data/metrics.csv').toString()), 'the CSV moved into data/');
		assert.strictEqual(lastFiles!.has(URI.file('/ws/metrics.csv').toString()), false, 'the original CSV is gone');
		// The dependent's frontmatter source AND its lock binding source are both re-pointed to the new path.
		assert.match(lastFiles!.get(WEEKLY.toString())!, /data\/metrics\.csv/, 'the dependent frontmatter source is re-pointed');
		assert.ok(!/- metrics\.csv$/m.test(lastFiles!.get(WEEKLY.toString())!), 'the old bare source name is gone from frontmatter');
		assert.match(lastFiles!.get(URI.file('/ws/Weekly Summary.lock.json').toString())!, /data\/metrics\.csv/, 'the dependent lock binding source is re-pointed');
	});

	test('Undo inverts an applied Tidy move - files, sidecars AND dependent references all restored', async () => {
		const service = createService();
		await service.loadDocument(WEEKLY);
		const deps = await service.getFileDependents(URI.file('/ws/metrics.csv'));
		await service.applyTidyMoves([moveItem(URI.file('/ws/metrics.csv'), URI.file('/ws/data/metrics.csv'), deps)]);

		const toast = lastNotifications.find(n => /Tidied 1 file/.test(n.message));
		assert.ok(toast?.actions?.primary?.[0], 'the Undo action is present');
		await toast!.actions!.primary![0].run();

		assert.ok(lastFiles!.has(URI.file('/ws/metrics.csv').toString()), 'the CSV is back at the root');
		assert.strictEqual(lastFiles!.has(URI.file('/ws/data/metrics.csv').toString()), false, 'the data/ copy is gone');
		assert.match(lastFiles!.get(WEEKLY.toString())!, /- metrics\.csv/, 'the dependent frontmatter source is restored');
		assert.ok(!/data\/metrics\.csv/.test(lastFiles!.get(WEEKLY.toString())!), 'no re-pointed path lingers after undo');
	});

	test('a clashing destination is refused with a named error and never half-applies (the rest of the batch continues)', async () => {
		const service = createService();
		await service.loadDocument(WEEKLY);
		// The destination for the CSV already exists; the loose Team Notes move should still go through.
		lastFiles!.set(URI.file('/ws/data/metrics.csv').toString(), 'PRE-EXISTING');
		lastFiles!.set(URI.file('/ws/scratch.md').toString(), '# scratch\n');

		await service.applyTidyMoves([
			moveItem(URI.file('/ws/metrics.csv'), URI.file('/ws/data/metrics.csv')),
			moveItem(URI.file('/ws/scratch.md'), URI.file('/ws/working-files/scratch.md')),
		]);

		assert.strictEqual(lastFiles!.get(URI.file('/ws/data/metrics.csv').toString()), 'PRE-EXISTING', 'the clashing target was not overwritten');
		assert.ok(lastFiles!.has(URI.file('/ws/metrics.csv').toString()), 'the clashing move left its source untouched');
		assert.ok(lastNotifications.some(n => /Could not tidy "metrics\.csv" - "data\/metrics\.csv" already exists\./.test(n.message)), 'a named clash error is raised');
		assert.ok(lastFiles!.has(URI.file('/ws/working-files/scratch.md').toString()), 'the non-clashing move still applied');
	});

	test('a failed sidecar move rolls the document back - the pair never half-applies', async () => {
		const service = createService([], { failLockMove: true });
		await service.loadDocument(WEEKLY); // creates the sidecar, so the move will try (and fail) to carry it
		const before = lastFiles!.get(WEEKLY.toString());

		await service.applyTidyMoves([moveItem(WEEKLY, URI.file('/ws/archive/Weekly Summary.md'))]);

		assert.strictEqual(lastFiles!.get(WEEKLY.toString()), before, 'the document was rolled back to its original location');
		assert.strictEqual(lastFiles!.has(URI.file('/ws/archive/Weekly Summary.md').toString()), false, 'no half-moved document lingers');
		assert.ok(lastNotifications.some(n => /Could not tidy "Weekly Summary\.md".*Nothing was changed\./.test(n.message)), 'a named failure names that nothing changed');
		assert.strictEqual(lastNotifications.some(n => /Tidied/.test(n.message)), false, 'no success toast for a failed move');
	});

	test('buildTidyPlan proposes a loose data file for data/ but leaves a bound source alone (conservative)', async () => {
		const service = createService();
		lastFiles!.set(URI.file('/ws/extra.csv').toString(), 'a,b\n1,2\n'); // loose, unreferenced

		const plan = await service.buildTidyPlan();
		const targets = plan.map(p => p.toLabel);
		assert.ok(targets.includes('data/extra.csv'), `the loose CSV is proposed for data/, got: [${targets.join(', ')}]`);
		assert.ok(!plan.some(p => p.fromLabel === 'metrics.csv'), 'the bound metrics.csv is NOT proposed (it lives where its lock points)');
	});

	// --- pin 6 file ops: Duplicate + Move to… (P6.4), through the additive service methods (#225) ---

	test('duplicateFile copies the document AND its lock sidecar under a distinct name, and opens the copy', async () => {
		const service = createService();
		await service.loadDocument(WEEKLY); // living doc -> a lock sidecar exists to be copied
		const copy = await service.duplicateFile(WEEKLY);

		const copyUri = URI.file('/ws/Weekly Summary copy.md');
		assert.deepStrictEqual(
			{
				returned: copy?.toString(),
				copyExists: lastFiles!.has(copyUri.toString()),
				originalKept: lastFiles!.has(WEEKLY.toString()),
				copySidecar: lastFiles!.has(URI.file('/ws/Weekly Summary copy.lock.json').toString()),
				sameBody: lastFiles!.get(copyUri.toString()) === lastFiles!.get(WEEKLY.toString()),
			},
			{ returned: copyUri.toString(), copyExists: true, originalKept: true, copySidecar: true, sameBody: true },
			'the copy + its sidecar land under a distinct name; the original is untouched; the copy is a verbatim clone'
		);
	});

	test('duplicateFile picks the next free name when the first copy already exists', async () => {
		const service = createService();
		lastFiles!.set(URI.file('/ws/Weekly Summary copy.md').toString(), '# taken\n');
		await service.duplicateFile(WEEKLY);
		assert.ok(lastFiles!.has(URI.file('/ws/Weekly Summary copy 2.md').toString()), 'the second copy uses the " copy 2" suffix');
	});

	test('moveFile carries the document + sidecar into the target folder and re-points every dependent, with an Undo that restores both', async () => {
		const service = createService();
		await service.loadDocument(WEEKLY); // Weekly binds metrics.csv; persists its lock

		// Move the bound SOURCE into data/ so the re-pointing of the dependent (Weekly) is observable.
		await service.moveFile(URI.file('/ws/metrics.csv'), URI.file('/ws/data'));

		assert.ok(lastFiles!.has(URI.file('/ws/data/metrics.csv').toString()), 'the CSV moved into data/');
		assert.strictEqual(lastFiles!.has(URI.file('/ws/metrics.csv').toString()), false, 'the original CSV is gone');
		assert.match(lastFiles!.get(WEEKLY.toString())!, /data\/metrics\.csv/, 'the dependent frontmatter source is re-pointed');
		assert.match(lastFiles!.get(URI.file('/ws/Weekly Summary.lock.json').toString())!, /data\/metrics\.csv/, 'the dependent lock binding source is re-pointed');

		const toast = lastNotifications.find(n => n.message === 'Moved "metrics.csv".');
		assert.ok(toast?.actions?.primary?.[0], 'a sticky Undo toast is raised');
		await toast!.actions!.primary![0].run();
		assert.ok(lastFiles!.has(URI.file('/ws/metrics.csv').toString()), 'Undo brings the CSV back to the root');
		assert.strictEqual(lastFiles!.has(URI.file('/ws/data/metrics.csv').toString()), false, 'no moved copy lingers after Undo');
		assert.match(lastFiles!.get(WEEKLY.toString())!, /- metrics\.csv/, 'Undo restores the dependent frontmatter source');
	});

	test('moveFile refuses a clashing destination and never half-applies', async () => {
		const service = createService();
		await service.loadDocument(WEEKLY);
		lastFiles!.set(URI.file('/ws/data/Weekly Summary.md').toString(), 'PRE-EXISTING');

		await service.moveFile(WEEKLY, URI.file('/ws/data'));

		assert.deepStrictEqual(
			{ stillThere: lastFiles!.has(WEEKLY.toString()), clashKept: lastFiles!.get(URI.file('/ws/data/Weekly Summary.md').toString()), moved: lastNotifications.some(n => /Moved/.test(n.message)) },
			{ stillThere: true, clashKept: 'PRE-EXISTING', moved: false },
			'nothing moved, the clashing file is untouched, and no success toast is raised'
		);
		assert.ok(lastNotifications.some(n => /a file with that name already exists in that folder/.test(n.message)), 'the clash is named');
	});

	test('renaming a titled document rewrites its own title frontmatter to follow the new name (silent-rename, P6.3), but a plain H1 doc gains no injected title', async () => {
		const service = createService();
		await service.loadDocument(WEEKLY); // WEEKLY declares `title: Weekly Operating Summary`
		await service.loadDocument(README); // README is a plain H1 doc with NO frontmatter title

		await service.renameFile(WEEKLY, 'Board Summary');
		await service.renameFile(README, 'Board Notes');

		const weekly = lastFiles!.get(URI.file('/ws/Board Summary.md').toString())!;
		const readme = lastFiles!.get(URI.file('/ws/Board Notes.md').toString())!;
		assert.deepStrictEqual(
			{ titledFollows: /title:\s*Board Summary/.test(weekly), plainStaysPlain: /^---/.test(readme.trimStart()) },
			{ titledFollows: true, plainStaysPlain: false },
			'the titled doc\'s frontmatter title follows the rename; the plain doc never gains an injected title block'
		);
	});

	test('renaming a document born from a template clears its needsSourceBinding nudge only once a source binds (PN.1)', async () => {
		const service = createService();
		// A template-born doc with NO source bound reports the nudge; binding a source clears it.
		const fromTemplate = URI.file('/ws/From Template.md');
		lastFiles!.set(fromTemplate.toString(), ['---', 'title: From Template', 'template: Weekly report', '---', '', '# From Template', '', 'Body.', ''].join('\n'));
		const before = (await service.listDocuments()).find(d => d.resource.toString() === fromTemplate.toString());
		assert.strictEqual(before?.needsSourceBinding, true, 'a template-born doc with no source bound reports the nudge');

		await service.loadDocument(fromTemplate); // the doc is open when the user binds a source in the app
		await service.addSource(fromTemplate, 'metrics.csv');
		const after = (await service.listDocuments()).find(d => d.resource.toString() === fromTemplate.toString());
		assert.strictEqual(after?.needsSourceBinding, false, 'the nudge clears once a source binds (the doc is now living)');
	});

	// --- spreadsheets as CSV sources + PDF as read-only context (issue #131, doc 22 §4) ---

	test('useXlsxAsSource extracts each sheet to data/<workbook>/<sheet>.csv, writes the manifest, and names limitations', async () => {
		const service = createService([], { workbook: true });
		const result = await service.useXlsxAsSource(WORKBOOK);
		// The CSV + manifest land on disk as plain files; the sheet's named limitation is surfaced, not hidden.
		assert.deepStrictEqual(
			{
				ok: result.ok,
				relativePath: result.sheets[0]?.relativePath,
				warning: result.sheets[0]?.warnings[0],
				csv: lastFiles!.get(URI.file('/ws/data/Budget/FY26.csv').toString()),
				manifestWorkbook: JSON.parse(lastFiles!.get(URI.file('/ws/data/Budget/.abstract-source.json').toString()) ?? '{}').workbook,
			},
			{
				ok: true,
				relativePath: 'data/Budget/FY26.csv',
				warning: 'This sheet has merged header cells - values may misalign with their columns.',
				csv: 'Month,MRR\n2026-01-05,1234.56\n2026-02-05,2000\n',
				manifestWorkbook: 'Budget.xlsx',
			},
		);
	});

	test('a failed xlsx extraction with the broker UP surfaces an honest request-failure notice, not "proxy not running" (#131/#245 C2)', async () => {
		// The broker answers /healthz (it is up) but the extraction POST fails at the transport (the measured CORS
		// case). The user must see a plain-words request failure - never silence, and never a false "proxy down".
		const service = createService([], { workbook: true, failInterop: true });
		const result = await service.useXlsxAsSource(WORKBOOK);
		const notice = lastNotifications.map(n => n.message).join('\n');
		assert.deepStrictEqual(
			{ ok: result.ok, notified: lastNotifications.length > 0, saysRequestFailed: /extraction request failed/.test(notice), notFalselyDown: !/not running/.test(notice) },
			{ ok: false, notified: true, saysRequestFailed: true, notFalselyDown: true },
		);
	});

	test('the provenance drawer shows the figure → CSV row → workbook chain for an extracted CSV', async () => {
		const service = createService([], { workbook: true, xlsxReport: true });
		await service.useXlsxAsSource(WORKBOOK);       // writes data/Budget/FY26.csv + records provenance
		await service.loadDocument(XLSX_REPORT);        // binds FY26.MRR against the extracted CSV
		const peek = service.getSourcePeek(XLSX_REPORT, ['FY26.MRR']);
		assert.deepStrictEqual(
			{ source: peek?.source, workbook: peek?.workbook?.workbook, sheet: peek?.workbook?.sheet, value: peek?.rows.find(r => r.key === 'FY26.MRR')?.value },
			{ source: 'data/Budget/FY26.csv', workbook: 'Budget.xlsx', sheet: 'FY26', value: '2000' },
		);
	});

	test('usePdfAsSource registers a readable PDF as a context edge with its extracted text, and names an image-only PDF unreadable', async () => {
		// Readable text PDF: becomes a context edge on the document + its extracted text is cached for the model.
		const service = createService([], { pdf: PDF_TEXT });
		await service.loadDocument(WEEKLY);
		const ok = await service.usePdfAsSource(PDF_FILE, WEEKLY);
		// The extracted text is persisted to the portable cache that _readContext reads instead of PDF bytes.
		const cacheKey = [...lastFiles!.keys()].find(k => k.includes('/knowledge/') && k.endsWith('.txt'));
		assert.deepStrictEqual(
			{ ok: ok.ok, pages: ok.pages, isContext: service.getDoc(WEEKLY)!.context.includes('Board Pack.pdf'), cached: cacheKey ? lastFiles!.get(cacheKey) : undefined },
			{ ok: true, pages: 2, isContext: true, cached: PDF_TEXT.text },
		);

		// Image-only/scanned PDF: names itself unreadable and creates NO edge (never empty context).
		const scanned = createService([], { pdf: PDF_IMAGE_ONLY });
		await scanned.loadDocument(WEEKLY);
		const bad = await scanned.usePdfAsSource(PDF_FILE, WEEKLY);
		assert.deepStrictEqual(
			{ ok: bad.ok, reason: bad.reason, isContext: scanned.getDoc(WEEKLY)!.context.includes('Board Pack.pdf') },
			{ ok: false, reason: 'This PDF has no selectable text - it looks scanned or image-only.', isContext: false },
		);
	});

	// --- panel-request replay (46-c defect P6.5): focusPanel must survive the rail mounting ---
	// "View history" on a not-yet-open document fires focusPanel BEFORE the review rail exists, so the
	// synchronous onDidRequestPanel event is lost. focusPanel also records the request as pending so the
	// rail consumes-and-clears it on mount. These cover the whole contract in one snapshot each.

	test('a focusPanel request made before the rail mounts survives as a pending request the mount consumes once', () => {
		const service = createService();
		// The rail is not yet subscribed (closed-doc path): the synchronous event fires into the void, but
		// the request is recorded. The mounting rail reads it, and a second read (a later mount) sees nothing.
		service.focusPanel('history', { blockId: 'b-42' });
		assert.deepStrictEqual(
			{ firstConsume: service.consumePendingPanel(), secondConsume: service.consumePendingPanel() },
			{ firstConsume: { tab: 'history', payload: { blockId: 'b-42' } }, secondConsume: undefined },
		);
	});

	test('a focusPanel request while the rail is mounted reaches it synchronously AND is not left sticky after consumption', () => {
		const service = createService();
		// Model the mounted rail: it is subscribed to the synchronous event.
		const seen: string[] = [];
		store.add(service.onDidRequestPanel(request => seen.push(request.tab)));
		service.focusPanel('review');
		// The mounted rail also consumes the pending request on its next mount; after that nothing is left.
		const consumed = service.consumePendingPanel();
		assert.deepStrictEqual(
			{ syncEvent: seen, consumed, afterConsume: service.consumePendingPanel() },
			{ syncEvent: ['review'], consumed: { tab: 'review', payload: undefined }, afterConsume: undefined },
		);
	});

	test('the pending panel is last-request-wins: a newer focusPanel overwrites an un-consumed older one', () => {
		const service = createService();
		service.focusPanel('history');
		service.focusPanel('chat');
		assert.deepStrictEqual(
			{ consumed: service.consumePendingPanel(), afterConsume: service.consumePendingPanel() },
			{ consumed: { tab: 'chat', payload: undefined }, afterConsume: undefined },
		);
	});
});
