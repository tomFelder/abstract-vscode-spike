/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Knowledge: the project's real source library (the SOURCES table + per-source detail drawer) and the
// Add-source sheet. Only `renderKnowledge` is public. Split out of screenRender.ts so the Knowledge +
// Agents lane owns its own file; shared helpers come from the shell.

import { relativeSyncedLabel } from '../common/livingDocPmDecorations.js';
import { ILivingDocSummary, ISourceInfo } from '../common/livingDocs.js';
import { ACCENT_DK, avatar, esc, IScreenState } from './screenRenderShell.js';

// ---- Knowledge: the project's real source library (plan 29, D29-A). The Project tab is a SOURCES table
// (every bound source + its freshness + the documents that depend on it) with a per-source detail drawer;
// the Organization tab is an honest "Soon" until a real org store exists (never fabricated). ----

// The relative "last synced" label is the single shared `relativeSyncedLabel` (common/livingDocPmDecorations)
// so the Knowledge library, the source detail drawer and the in-document figure hover all read identically
// (plan 37 F12 - one formatter, one source of truth; stale-vs-current is enforced upstream in `listSources`).

// Kind glyph for a source row (source-hygiene: non-ASCII written as HTML entities).
const SOURCE_KIND_ICON: Record<string, string> = { file: '&#9635;', api: '&#127760;', mcp: '&#9670;' };

export function renderKnowledge(state: IScreenState): string {
	const isOrg = state.knScope === 'org';
	const sources = state.sources ?? [];
	const docs = state.docs ?? [];
	const dataFiles = state.dataFiles ?? [];
	const tabStyle = (on: boolean) => on
		? 'background:#fff;color:#1a1c20;box-shadow:0 1px 2px rgba(0,0,0,.06)'
		: 'background:transparent;color:#868b95';

	// The honest "Soon" body for the Organization scope: no org store exists yet, so nothing is fabricated.
	const orgBody = `<div style="flex:1;min-height:52vh;display:flex;align-items:center;justify-content:center">
		<div style="text-align:center;max-width:430px;padding:40px">
			<div style="font-size:38px;line-height:1;margin-bottom:14px">&#127970;</div>
			<div style="font:600 17px/1.3 system-ui;color:#15171c;margin-bottom:8px">Organization knowledge <span style="font:600 10px/1 'JetBrains Mono',ui-monospace,monospace;color:#9a6b16;background:#fdf2dc;border-radius:999px;padding:4px 8px;vertical-align:middle">SOON</span></div>
			<p style="margin:0;font:400 13.5px/1.6 system-ui;color:#52575f">An org-wide store of shared sources and decisions is not connected yet. This project's own sources are on the Project tab.</p>
		</div>
	</div>`;

	// The freshness dot + label: green when the source still matches the lock, amber "Source changed" when a
	// dependent binding is stale (the always-on dirty signal, truthful per source).
	const freshCell = (fresh: boolean) => fresh
		? `<span style="display:inline-flex;align-items:center;gap:6px;font:500 11.5px/1 system-ui;color:#5d8a66"><span style="width:7px;height:7px;border-radius:50%;background:oklch(0.6 0.13 150)"></span>Fresh</span>`
		: `<span style="display:inline-flex;align-items:center;gap:6px;font:500 11.5px/1 system-ui;color:#9a6b16"><span style="width:7px;height:7px;border-radius:50%;background:oklch(0.66 0.16 45)"></span>Source changed</span>`;

	// One SOURCES table row: kind icon, label, kind, last-synced, freshness, used-by count. Selecting it
	// opens the detail drawer (local screen navigation; the counts stay live/real).
	const row = (s: ISourceInfo) => {
		const on = state.knSelectedSource === s.id;
		const av = avatar(s.label);
		return `<button data-msg="selectSource" data-arg="${esc(s.id)}" style="display:grid;grid-template-columns:26px 1fr 62px 128px 128px 84px;align-items:center;gap:12px;width:100%;text-align:left;background:${on ? '#f4f6ff' : '#fff'};border:1px solid ${on ? '#d5ddff' : '#edeef2'};border-radius:10px;padding:12px 14px;margin-bottom:8px;cursor:pointer">
			<span style="width:26px;height:26px;flex:none;border-radius:7px;background:${av.color};color:#fff;font-size:12px;display:flex;align-items:center;justify-content:center">${SOURCE_KIND_ICON[s.kind] ?? SOURCE_KIND_ICON.file}</span>
			<span style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font:600 13px/1.3 system-ui;color:#1a1c20">${esc(s.label)}</span>
			<span style="font:500 10px/1 'JetBrains Mono',ui-monospace,monospace;letter-spacing:.04em;text-transform:uppercase;color:#868b95">${s.kind}</span>
			<span style="font:400 11.5px/1 'JetBrains Mono',ui-monospace,monospace;color:#a3a8b2">${relativeSyncedLabel(s.syncedAt)}</span>
			<span>${freshCell(s.fresh)}</span>
			<span style="font:500 11.5px/1 system-ui;color:#52575f">${s.usedBy.length} doc${s.usedBy.length === 1 ? '' : 's'}</span>
		</button>`;
	};

	// The empty registry: no source is referenced by any document in this folder (the honest empty state).
	const table = sources.length === 0
		? `<div style="background:#fff;border:1px dashed #dfe1e7;border-radius:12px;padding:40px 24px;text-align:center">
				<div style="font-size:34px;line-height:1;margin-bottom:12px">&#9635;</div>
				<div style="font:600 15px/1.3 system-ui;color:#15171c;margin-bottom:6px">No sources yet</div>
				<p style="margin:0 auto;max-width:360px;font:400 13px/1.6 system-ui;color:#52575f">When a document in this project binds a CSV, JSON or an API, it appears here with its freshness and the documents that depend on it.</p>
			</div>`
		: `<div style="display:grid;grid-template-columns:26px 1fr 62px 128px 128px 84px;gap:12px;padding:0 14px 8px;font:600 10px/1 'JetBrains Mono',ui-monospace,monospace;letter-spacing:.06em;color:#a3a8b2"><span></span><span>SOURCE</span><span>KIND</span><span>LAST SYNCED</span><span>FRESHNESS</span><span>USED BY</span></div>
			${sources.map(row).join('')}`;

	// The per-source detail drawer: the documents (and bind keys) that depend on the selected source, each
	// with jump-to-doc and a Detach action that edits that document's frontmatter through the service.
	const selected = sources.find(s => s.id === state.knSelectedSource);
	const usageRow = (s: ISourceInfo, u: ISourceInfo['usedBy'][number]) => {
		const av = avatar(u.title);
		const detachArg = esc(JSON.stringify({ doc: u.doc.toString(), source: s.id, context: u.context }));
		const keys = u.context
			? `<span style="font:400 11px/1.4 'JetBrains Mono',ui-monospace,monospace;color:#a3a8b2">Context reference</span>`
			: (u.keys.length
				? `<span style="font:400 11px/1.5 'JetBrains Mono',ui-monospace,monospace;color:#8a93c4">${u.keys.map(esc).join(' &middot; ')}</span>`
				: `<span style="font:400 11px/1.4 'JetBrains Mono',ui-monospace,monospace;color:#a3a8b2">Bound source</span>`);
		return `<div style="background:#fff;border:1px solid #edeef2;border-radius:10px;padding:12px 13px;margin-bottom:8px">
			<div style="display:flex;align-items:center;gap:9px;margin-bottom:7px">
				<span style="width:24px;height:24px;flex:none;border-radius:7px;background:${av.color};color:#fff;font:600 10px/24px system-ui;text-align:center">${av.text}</span>
				<span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font:600 12.5px/1.3 system-ui;color:#1a1c20">${esc(u.title)}</span>
			</div>
			<div style="margin:0 0 9px 33px">${keys}</div>
			<div style="display:flex;gap:7px;margin-left:33px">
				<button data-msg="openDoc" data-arg="${esc(u.doc.toString())}" style="border:1px solid #e0e2e8;background:#fff;border-radius:7px;padding:6px 11px;font:500 11.5px/1 system-ui;color:#52575f;cursor:pointer">Open document &#8599;</button>
				<button data-msg="detachSource" data-arg="${detachArg}" style="border:1px solid #ecdede;background:#fff;border-radius:7px;padding:6px 11px;font:500 11.5px/1 system-ui;color:#a4453f;cursor:pointer">Detach</button>
			</div>
		</div>`;
	};
	const drawer = selected
		? `<div style="background:#fbfbfc;border:1px solid #e9eaee;border-radius:12px;padding:16px 16px 14px">
				<div style="font:600 11px/1 'JetBrains Mono',ui-monospace,monospace;letter-spacing:.06em;color:#a3a8b2;margin-bottom:4px">SOURCE</div>
				<div style="font:600 15px/1.3 system-ui;color:#15171c;margin-bottom:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(selected.label)}</div>
				<div style="font:400 11.5px/1 'JetBrains Mono',ui-monospace,monospace;color:#a3a8b2;margin-bottom:14px">${selected.kind} &middot; ${relativeSyncedLabel(selected.syncedAt)}</div>
				<div style="font:600 10px/1 'JetBrains Mono',ui-monospace,monospace;letter-spacing:.06em;color:#a3a8b2;margin-bottom:9px">USED BY ${selected.usedBy.length} DOCUMENT${selected.usedBy.length === 1 ? '' : 'S'}</div>
				${selected.usedBy.map(u => usageRow(selected, u)).join('')}
			</div>`
		: `<div style="background:#fbfbfc;border:1px solid #e9eaee;border-radius:12px;padding:22px 18px;text-align:center">
				<div style="font:400 12.5px/1.6 system-ui;color:#868b95">Select a source to see the documents that depend on it.</div>
			</div>`;

	// The Add-source sheet (plan 29 iter 2): bind a folder data file or an API URL to a target document,
	// through the existing frontmatter write path. Real data only - the file rows are the folder's actual
	// csv/json, and the document rows are the project's real documents.
	const addSheet = renderAddSourceSheet(docs, dataFiles);

	const projectBody = `<div style="max-width:1080px;margin:0 auto;padding:24px 28px 80px">
		<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px">
			<span style="font:600 11px/1 'JetBrains Mono',ui-monospace,monospace;letter-spacing:.12em;color:#a3a8b2">${sources.length} SOURCE${sources.length === 1 ? '' : 'S'}</span>
			<button class="btn-primary" style="padding:9px 15px;font:600 12.5px/1 system-ui" data-sheet-open="addsource">&#65291; Add source</button>
		</div>
		<div style="display:flex;gap:20px;align-items:flex-start">
			<div style="flex:1;min-width:0">${table}</div>
			<div style="width:300px;flex:none">${drawer}</div>
		</div>
	</div>`;

	return `<div class="screen">
	<div class="scr-head">
		<div><h2 class="scr-title">Knowledge</h2><div class="scr-sub">Every source your documents depend on &mdash; where it comes from, how fresh it is.</div></div>
		<div style="margin-left:auto;display:flex;gap:5px;background:#f1f2f5;border-radius:9px;padding:3px">
			<button data-msg="setKnProject" style="border:none;border-radius:7px;padding:7px 13px;font:500 12px/1 system-ui;cursor:pointer;${tabStyle(!isOrg)}">Project</button>
			<button data-msg="setKnOrg" style="border:none;border-radius:7px;padding:7px 13px;font:500 12px/1 system-ui;cursor:pointer;${tabStyle(isOrg)}">Organization</button>
		</div>
	</div>
	<div class="scr-body">${isOrg ? orgBody : projectBody}</div>
	${addSheet}
</div>`;
}

// The Add-source sheet body (plan 29 iter 2): a target-document picker + a file/API source picker. The file
// rows are the folder's real data files (decision 40's in-app picker), and an API URL row covers the api
// kind; both submit `addSource` with the chosen document + source through the service write path.
function renderAddSourceSheet(docs: readonly ILivingDocSummary[], dataFiles: readonly string[]): string {
	const docOptions = docs.map(d => `<option value="${esc(d.resource.toString())}">${esc(d.title)}</option>`).join('');
	const fileRows = dataFiles.length
		? dataFiles.map(f => `<button class="sheet-row" data-sheet-submit data-msg="addSource" data-arg="${esc(f)}"><span style="width:28px;height:28px;flex:none;border-radius:7px;background:#eef1ff;color:${ACCENT_DK};font-size:12px;display:flex;align-items:center;justify-content:center">&#9635;</span><span style="flex:1;min-width:0;font:600 12.5px/1.3 system-ui;color:#1a1c20;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(f)}</span></button>`).join('')
		: `<div style="font:400 12px/1.5 system-ui;color:#a3a8b2;padding:8px 2px">No unused data files in this folder.</div>`;
	const body = `<label class="sheet-label" style="margin-top:14px">Bind to document</label>
		<select class="sheet-input" data-field="target">${docOptions}</select>
		<div style="font:600 10px/1 'JetBrains Mono',ui-monospace,monospace;letter-spacing:.1em;color:#a3a8b2;margin:16px 0 2px">FOLDER DATA FILES</div>
		${fileRows}
		<div style="font:600 10px/1 'JetBrains Mono',ui-monospace,monospace;letter-spacing:.1em;color:#a3a8b2;margin:16px 0 8px">OR AN API ENDPOINT</div>
		<div style="display:flex;gap:8px">
			<input class="sheet-input" data-field="apiurl" placeholder="https://api.example.com/metrics" style="flex:1">
			<button class="btn-primary" data-sheet-submit data-msg="addSourceApi" style="flex:none;padding:0 15px;font:600 12.5px/1 system-ui">Add</button>
		</div>
		<div style="display:flex;gap:8px;margin-top:18px;justify-content:flex-end"><button class="btn-ghost" data-sheet-close="addsource">Cancel</button></div>`;
	return `<div class="sheet-back" id="sheet-addsource" data-sheet="addsource">
		<div class="sheet-card" role="dialog" aria-modal="true">
			<h2 class="sheet-title">Add a source</h2>
			<p class="sheet-sub">Bind a data file or an API endpoint to a document. It joins the document's sources and its figures resolve against it.</p>
			${body}
		</div>
	</div>`;
}
