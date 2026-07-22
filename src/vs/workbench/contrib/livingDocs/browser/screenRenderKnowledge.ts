/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Knowledge (v2, plan 49-a): the project's real source library on the no-rails white surface. K1 the shell
// (1180px column, a 240px live filter, "+ Add source" into the folder's sources/, a truthful summary line);
// K2 the source table (the heart - SOURCE/KIND/SYNC/FEEDS/BINDS, kind glyphs, the F12 freshness vocabulary,
// FEEDS chips that open the doc, a row click that opens the source as a product tab); K3 the health strip (at
// most one attention card for the stalest stale source with Re-sync + mark-as-expected, beside the static
// HOW BINDING WORKS explainer). Only `renderKnowledge` is public. Real data only: every row is a real folder
// source, nothing fabricated; the SYNC column reads the ONE freshness vocabulary (common/sourceFreshness) so
// the table, drawer, tree meta, hover-peek and Context tab all speak the same words (#122 F12).

import { localize } from '../../../../nls.js';
import { ILivingDocSummary, ISourceInfo } from '../common/livingDocs.js';
import { freshnessLabel, FRESHNESS_COLOURS, relativeSyncedShort, sourceFreshness, SourceFreshness } from '../common/sourceFreshness.js';
import { ACCENT_DK, esc, IScreenState } from './screenRenderShell.js';

// The SEMANTIC kind of a source (K2.2). This is the ONE classification: both the KIND word and the KIND-cell
// glyph derive from it, so the two can never disagree (D1 fix - the glyph used to be keyed on the transport
// `s.kind` file/api/mcp, which drifted from the semantic word). The axis is what the source IS, not how it
// arrives: a table (CSV/data), a transcript (text influence file), a reference (context-only doc), or a live
// feed (api/mcp endpoint).
const enum KindCategory {
	Table,
	Transcript,
	Reference,
	Feed,
}

// Classify a source semantically. "Live feed" for an api/mcp source, "Reference" for a context-only doc,
// "Table" for a CSV/data file, "Transcript" for any other (markdown/text influence) file.
function kindCategory(s: ISourceInfo, contextOnly: boolean): KindCategory {
	if (s.kind === 'api' || s.kind === 'mcp') { return KindCategory.Feed; }
	if (contextOnly) { return KindCategory.Reference; }
	if (/\.(csv|json|tsv|xlsx?)$/i.test(s.id)) { return KindCategory.Table; }
	return KindCategory.Transcript;
}

// The plain-English name for the KIND column, keyed off the semantic category (one truth with the glyph).
function kindWord(cat: KindCategory): string {
	switch (cat) {
		case KindCategory.Feed: return localize("livingDocs.knowledge.kind.feed", "Live feed");
		case KindCategory.Reference: return localize("livingDocs.knowledge.kind.reference", "Reference");
		case KindCategory.Table: return localize("livingDocs.knowledge.kind.table", "Table");
		case KindCategory.Transcript: return localize("livingDocs.knowledge.kind.transcript", "Transcript");
	}
}

// The KIND-cell glyph, keyed off the SAME semantic category as the word (source-hygiene: non-ASCII written as
// HTML entities). Table = the squared-plus table glyph, Transcript = the fisheye glyph, Reference/Feed = the
// diamond reference glyph. A value-feeding source draws its glyph in accent; a context-only source quiet.
function kindGlyph(cat: KindCategory): string {
	switch (cat) {
		case KindCategory.Table: return '&#8862;';
		case KindCategory.Transcript: return '&#9677;';
		case KindCategory.Reference: return '&#9671;';
		case KindCategory.Feed: return '&#9671;';
	}
}

// True when every document that uses this source uses it as context/influence (no value bindings) - the
// "context only" F12 state. A source with no dependents at all is treated as context-only (nothing binds it).
function isContextOnly(s: ISourceInfo): boolean {
	return s.usedBy.length === 0 || s.usedBy.every(u => u.context);
}

// The bind count for a source: the total number of distinct bind keys its dependents resolve from it. Zero
// for a context-only source (the BINDS column then shows the faint dash).
function bindCount(s: ISourceInfo): number {
	let n = 0;
	for (const u of s.usedBy) { n += u.keys.length; }
	return n;
}

// ---- Knowledge (v2, plan 49-a K1-K3). ----
export function renderKnowledge(state: IScreenState): string {
	const isOrg = state.knScope === 'org';
	const sources = state.sources ?? [];
	const docs = state.docs ?? [];
	const dataFiles = state.dataFiles ?? [];
	const now = state.knNow ?? 0;

	// The screen body floats on the plan-44 elevation card; the webview body is transparent so that card shows
	// through (same no-rails shell as Home + Templates). Knowledge never repaints its own canvas.
	const scroll = (inner: string) => `<div class="screen" style="background:transparent"><div style="flex:1;overflow-y:auto;background:transparent">${inner}</div></div>`;

	// The honest "Soon" body for the Organization scope: no org store exists yet, so nothing is fabricated.
	const orgBody = `<div style="min-height:52vh;display:flex;align-items:center;justify-content:center">
		<div style="text-align:center;max-width:430px;padding:40px">
			<div style="font-size:38px;line-height:1;margin-bottom:14px">&#127970;</div>
			<div style="font:600 17px/1.3 system-ui;color:#15171c;margin-bottom:8px">${localize("livingDocs.knowledge.org.title", "Organization knowledge")} <span style="font:600 10px/1 'JetBrains Mono',ui-monospace,monospace;color:#9a6b16;background:#fdf2dc;border-radius:999px;padding:4px 8px;vertical-align:middle">${localize("livingDocs.knowledge.org.soon", "SOON")}</span></div>
			<p style="margin:0;font:400 13.5px/1.6 system-ui;color:#52575f">${localize("livingDocs.knowledge.org.body", "An org-wide store of shared sources and decisions is not connected yet. This project's own sources are on the Project tab.")}</p>
		</div>
	</div>`;

	// K2: one SOURCES-table row. Grid 2fr 1fr 1fr 1.4fr 90px, per-cell exact typography. The whole row is a
	// button: a file source opens as a product tab (K2.6, openSourceTab); an api/mcp source with no local file
	// is non-navigable (rendered as a plain div so the click never dead-ends). A stale row paints cream.
	const row = (s: ISourceInfo, last: boolean) => {
		const contextOnly = isContextOnly(s);
		const cat = kindCategory(s, contextOnly);
		const st = sourceFreshness({ fresh: s.fresh, contextOnly, markedExpected: s.markedExpected });
		const fresh = freshnessLabel(st, s.syncedAt, now);
		const glyphColour = contextOnly ? '#A3A8B2' : '#5B6DC4';
		const binds = bindCount(s);
		const stale = st === SourceFreshness.Stale;
		// FEEDS: accent-tint doc chips (up to 3, then "+N"), each opening its doc. A context-only source that
		// no document binds reads the quiet "available to all docs" line (the mock's brand-guidelines row).
		const bindingDocs = s.usedBy.filter(u => !u.context);
		const feedDocs = bindingDocs.length ? bindingDocs : s.usedBy;
		const chips = feedDocs.length === 0
			? `<span style="font:400 11px/1.4 system-ui;color:#A3A8B2">${localize("livingDocs.knowledge.feeds.all", "available to all docs")}</span>`
			: feedDocs.slice(0, 3).map(u => `<span data-msg="openDoc" data-arg="${esc(u.doc.toString())}" data-stop style="height:20px;padding:0 8px;display:inline-flex;align-items:center;border-radius:999px;background:#F4F5FD;border:1px solid #E0E5FB;color:#2A2F60;font:400 11px/1 system-ui;cursor:pointer;max-width:130px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(u.title)}</span>`).join('')
			+ (feedDocs.length > 3 ? `<span style="font:400 11px/1 system-ui;color:#A3A8B2;align-self:center">+${feedDocs.length - 3}</span>` : '');
		// BINDS: mono count right-aligned, accent/600 when >0, faint em-dash when none.
		const bindsCell = binds > 0
			? `<span style="text-align:right;font:600 12px/1 'JetBrains Mono',ui-monospace,monospace;color:#4650B8">${binds}</span>`
			: `<span style="text-align:right;font:400 12px/1 'JetBrains Mono',ui-monospace,monospace;color:#A3A8B2">&#8212;</span>`;
		const cells = `<span style="display:flex;align-items:center;gap:9px;min-width:0"><span style="font:400 12px/1 'JetBrains Mono',ui-monospace,monospace;color:${glyphColour}">${kindGlyph(cat)}</span><span style="font:600 13.5px/1.3 system-ui;color:#1A1C20;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(s.label)}</span></span>
			<span style="font:400 12.5px/1 system-ui;color:#52575F">${kindWord(cat)}</span>
			<span style="display:flex;align-items:center;gap:6px;font:400 12px/1 system-ui;color:${fresh.text}"><span style="width:7px;height:7px;flex:none;border-radius:999px;background:${fresh.dot}"></span>${esc(fresh.label)}</span>
			<span style="display:flex;gap:5px;flex-wrap:wrap;align-items:center;min-width:0">${chips}</span>
			${bindsCell}`;
		const bg = stale ? FRESHNESS_COLOURS.staleRowBg : '#fff';
		const hoverBg = stale ? '#FBF5E8' : '#F6F7F9';
		const filterKey = esc((s.label + ' ' + s.usedBy.map(u => u.title).join(' ')).toLowerCase());
		const common = `display:grid;grid-template-columns:2fr 1fr 1fr 1.4fr 90px;align-items:center;gap:12px;width:100%;text-align:left;padding:13px 18px;background:${bg};border:none;${last ? '' : 'border-bottom:1px solid #EEF0F3;'}`;
		if (s.resource) {
			return `<button class="kn-row" data-kn-row data-kn-name="${filterKey}" data-msg="openSource" data-arg="${esc(s.resource.toString())}" style="${common}cursor:pointer" data-rowhover="${hoverBg}" data-rowbg="${bg}">${cells}</button>`;
		}
		return `<div class="kn-row" data-kn-row data-kn-name="${filterKey}" style="${common}">${cells}</div>`;
	};

	// The header row + the rows, in the bordered card (radius 13). Header: mono 9.5/600/.12em faint on #FBFCFD.
	const header = `<div style="display:grid;grid-template-columns:2fr 1fr 1fr 1.4fr 90px;gap:12px;padding:10px 18px;background:#FBFCFD;border-bottom:1px solid #EEF0F3;font:600 9.5px/1 'JetBrains Mono',ui-monospace,monospace;letter-spacing:.12em;color:#A3A8B2">
		<span>${localize("livingDocs.knowledge.col.source", "SOURCE")}</span><span>${localize("livingDocs.knowledge.col.kind", "KIND")}</span><span>${localize("livingDocs.knowledge.col.sync", "SYNC")}</span><span>${localize("livingDocs.knowledge.col.feeds", "FEEDS")}</span><span style="text-align:right">${localize("livingDocs.knowledge.col.binds", "BINDS")}</span>
	</div>`;
	const table = sources.length === 0
		? `<div style="border:1px solid #E9EAEE;border-radius:13px;background:#FBFCFD;padding:40px 32px;text-align:center">
				<div style="font-size:30px;line-height:1;margin-bottom:12px">&#8862;</div>
				<div style="font:600 15px/1.3 system-ui;color:#15171c;margin-bottom:6px">${localize("livingDocs.knowledge.empty.title", "No sources yet")}</div>
				<p style="margin:0 auto;max-width:380px;font:400 13px/1.6 system-ui;color:#868B95">${localize("livingDocs.knowledge.empty.body", "When a document in this project binds a CSV, JSON or an API, it appears here with its freshness and the documents that depend on it.")}</p>
			</div>`
		: `<div class="kn-table" style="border:1px solid #E9EAEE;border-radius:13px;overflow:hidden">${header}${sources.map((s, i) => row(s, i === sources.length - 1)).join('')}</div>`;

	// K3: the health strip. At most ONE attention card - the stalest stale source that is not marked-expected -
	// with working Re-sync + mark-as-expected, beside the static HOW BINDING WORKS explainer. All-fresh (or all
	// stale-but-expected) renders the explainer alone (K3.3: no empty attention shell).
	const staleSources = sources.filter(s => !s.fresh && !s.markedExpected);
	// The stalest = the oldest sync time among the stale set (undefined sync sorts oldest).
	const stalest = staleSources.slice().sort((a, b) => (a.syncedAt ?? '') < (b.syncedAt ?? '') ? -1 : 1)[0];
	const attentionCard = stalest
		? (() => {
			const cite = stalest.usedBy.find(u => !u.context) ?? stalest.usedBy[0];
			const citeName = cite ? cite.title : localize("livingDocs.knowledge.attention.someDoc", "a document");
			const age = relativeSyncedShort(stalest.syncedAt, now);
			return `<div style="flex:1;border:1px solid #E4DCCB;background:#FDFAF2;border-radius:12px;padding:14px 16px">
				<div style="font:600 9.5px/1 'JetBrains Mono',ui-monospace,monospace;letter-spacing:.1em;color:#8A6D1A;margin-bottom:5px">${localize("livingDocs.knowledge.attention.tag", "STALE SOURCE")}</div>
				<div style="font:400 13px/1.55 system-ui;color:#52575F">${localize("livingDocs.knowledge.attention.body", "{0} changed {1} but {2} cites it. ", esc(stalest.label), esc(age), esc(citeName))}<span data-msg="resyncSource" data-arg="${esc(stalest.id)}" style="color:${ACCENT_DK};cursor:pointer;text-decoration:underline">${localize("livingDocs.knowledge.attention.resync", "Re-sync")}</span> ${localize("livingDocs.knowledge.attention.or", "or")} <span data-msg="markSourceExpected" data-arg="${esc(stalest.id)}" style="color:${ACCENT_DK};cursor:pointer;text-decoration:underline">${localize("livingDocs.knowledge.attention.expected", "mark as expected")}</span>.</div>
			</div>`;
		})()
		: '';
	const explainer = `<div style="flex:1;border:1px solid #E9EAEE;background:#FBFCFD;border-radius:12px;padding:14px 16px">
		<div style="font:600 9.5px/1 'JetBrains Mono',ui-monospace,monospace;letter-spacing:.1em;color:#A3A8B2;margin-bottom:5px">${localize("livingDocs.knowledge.explainer.tag", "HOW BINDING WORKS")}</div>
		<div style="font:400 13px/1.55 system-ui;color:#52575F">${localize("livingDocs.knowledge.explainer.body", "A bound figure is a live reference into one of these sources - edit the source and every citing document updates through the approval rules you set per doc.")}</div>
	</div>`;
	// When a source has been marked-expected, offer a quiet honest note to undo it (so the calm is reversible).
	const expectedSources = sources.filter(s => s.markedExpected && !s.fresh);
	const expectedNote = expectedSources.length
		? `<div style="margin-top:12px;font:400 12px/1.5 system-ui;color:#A3A8B2">${localize("livingDocs.knowledge.expected.note", "{0} marked as expected.", expectedSources.map(s => esc(s.label)).join(', '))} <span data-msg="unmarkSourceExpected" data-arg="${esc(expectedSources[0].id)}" style="color:${ACCENT_DK};cursor:pointer;text-decoration:underline">${localize("livingDocs.knowledge.expected.undo", "Undo")}</span></div>`
		: '';
	const healthStrip = sources.length === 0 ? '' : `<div style="display:flex;gap:16px;margin-top:28px">${attentionCard}${explainer}</div>${expectedNote}`;

	// K1.3: the truthful summary line - real source count + the dependent bind total.
	const totalBinds = sources.reduce((n, s) => n + bindCount(s), 0);
	const summary = localize("livingDocs.knowledge.summary", "{0} source{1} in this folder · {2} bound figure{3} depend on them.", sources.length, sources.length === 1 ? '' : 's', totalBinds, totalBinds === 1 ? '' : 's');

	// The title row (K1.1): the 30/600 title, a spacer, the Project/Organization scope toggle (the honest
	// org-Soon feature is preserved), then the 240px live filter field. The header's "+ Add source" action is
	// the plan-44 global header's (not drawn here); the in-body "+ Add source" button sits above the table.
	const scopeTab = (label: string, on: boolean, msg: string) => `<button data-msg="${msg}" style="border:none;border-radius:7px;padding:6px 12px;font:500 12px/1 system-ui;cursor:pointer;background:${on ? '#fff' : 'transparent'};color:${on ? '#1a1c20' : '#868b95'};${on ? 'box-shadow:0 1px 2px rgba(0,0,0,.06)' : ''}">${esc(label)}</button>`;
	const titleRow = `<div style="display:flex;align-items:center;gap:14px;margin-bottom:6px">
			<h1 style="margin:0;font:600 30px/1.12 system-ui;color:#14161A;letter-spacing:-.02em">${localize("livingDocs.knowledge.title", "Knowledge")}</h1>
			<span style="flex:1"></span>
			<div style="display:flex;gap:4px;background:#F1F2F5;border-radius:9px;padding:3px">${scopeTab(localize("livingDocs.knowledge.scope.project", "Project"), !isOrg, 'setKnProject')}${scopeTab(localize("livingDocs.knowledge.scope.org", "Organization"), isOrg, 'setKnOrg')}</div>
			<label class="tpl-filter">&#8981;<input data-kn-filter type="text" placeholder="${localize("livingDocs.knowledge.filter", "Filter sources…")}" aria-label="${localize("livingDocs.knowledge.filter", "Filter sources…")}"></label>
		</div>`;

	// The in-body "+ Add source" affordance (K1.2) sits on the right above the table, opening the same sheet
	// the global header's "+ Add Source" button opens (one sheet path). A "no matches" line for the filter.
	const addRow = `<div style="display:flex;align-items:center;margin-bottom:14px"><span style="flex:1"></span><button class="btn-primary" style="padding:9px 15px;font:600 12.5px/1 system-ui" data-sheet-open="addsource">&#65291; ${localize("livingDocs.knowledge.addSource", "Add source")}</button></div>`;
	const noMatch = `<div data-kn-nomatch style="display:none;font:400 13px/1.5 system-ui;color:#868B95;margin-top:14px">${localize("livingDocs.knowledge.noMatch", "No sources match your filter.")}</div>`;

	const projectBody = `${addRow}${table}${noMatch}${healthStrip}`;

	const addSheet = renderAddSourceSheet(docs, dataFiles);
	const body = `<div style="max-width:1180px;margin:0 auto;padding:56px 48px 80px">
		${titleRow}
		<div style="font:400 14px/1.4 system-ui;color:#868B95;margin-bottom:32px">${isOrg ? '' : esc(summary)}</div>
		${isOrg ? orgBody : projectBody}
	</div>`;
	return scroll(body) + addSheet;
}

// The Add-source sheet body (plan 29 iter 2, retained for 49-a K1.2): a target-document picker + a file/API
// source picker. The file rows are the folder's real data files (decision 40's in-app picker), landing in the
// folder's sources/ on first use; an API URL row covers the api kind. Both submit `addSource`/`addSourceApi`
// with the chosen document + source through the service write path (never a fabricated binding).
function renderAddSourceSheet(docs: readonly ILivingDocSummary[], dataFiles: readonly string[]): string {
	const docOptions = docs.map(d => `<option value="${esc(d.resource.toString())}">${esc(d.title)}</option>`).join('');
	const fileRows = dataFiles.length
		? dataFiles.map(f => `<button class="sheet-row" data-sheet-submit data-msg="addSource" data-arg="${esc(f)}"><span style="width:28px;height:28px;flex:none;border-radius:7px;background:#eef1ff;color:${ACCENT_DK};font-size:12px;display:flex;align-items:center;justify-content:center">&#8862;</span><span style="flex:1;min-width:0;font:600 12.5px/1.3 system-ui;color:#1a1c20;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(f)}</span></button>`).join('')
		: `<div style="font:400 12px/1.5 system-ui;color:#a3a8b2;padding:8px 2px">${localize("livingDocs.knowledge.sheet.noFiles", "No unused data files in this folder.")}</div>`;
	const body = `<label class="sheet-label" style="margin-top:14px">${localize("livingDocs.knowledge.sheet.bindTo", "Bind to document")}</label>
		<select class="sheet-input" data-field="target">${docOptions}</select>
		<div style="font:600 10px/1 'JetBrains Mono',ui-monospace,monospace;letter-spacing:.1em;color:#a3a8b2;margin:16px 0 2px">${localize("livingDocs.knowledge.sheet.folderFiles", "FOLDER DATA FILES")}</div>
		${fileRows}
		<div style="font:600 10px/1 'JetBrains Mono',ui-monospace,monospace;letter-spacing:.1em;color:#a3a8b2;margin:16px 0 8px">${localize("livingDocs.knowledge.sheet.orApi", "OR AN API ENDPOINT")}</div>
		<div style="display:flex;gap:8px">
			<input class="sheet-input" data-field="apiurl" placeholder="https://api.example.com/metrics" style="flex:1">
			<button class="btn-primary" data-sheet-submit data-msg="addSourceApi" style="flex:none;padding:0 15px;font:600 12.5px/1 system-ui">${localize("livingDocs.knowledge.sheet.add", "Add")}</button>
		</div>
		<div style="display:flex;gap:8px;margin-top:18px;justify-content:flex-end"><button class="btn-ghost" data-sheet-close="addsource">${localize("livingDocs.knowledge.sheet.cancel", "Cancel")}</button></div>`;
	return `<div class="sheet-back" id="sheet-addsource" data-sheet="addsource">
		<div class="sheet-card" role="dialog" aria-modal="true">
			<h2 class="sheet-title">${localize("livingDocs.knowledge.sheet.title", "Add a source")}</h2>
			<p class="sheet-sub">${localize("livingDocs.knowledge.sheet.sub", "Bind a data file or an API endpoint to a document. It joins the document's sources and its figures resolve against it.")}</p>
			${body}
		</div>
	</div>`;
}
