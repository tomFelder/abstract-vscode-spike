/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { renderMarkdown } from '../../../../base/browser/markdownRenderer.js';
import { IFigureChange, ISourcePeek } from '../common/livingDocs.js';
import { reconcileBindLinks } from '../common/livingDocMarkdown.js';
import { ILivingDoc, ILivingDocBlock, IProposedChange } from '../common/livingDocsModel.js';

// Bind links render as plain text - the resolved value is its own visible text, and the `bind:` URL
// is never shown to the reader (spec 3.2). A blue gutter dot marks the bound line instead.
const BIND_LINK_RE = /\[([^\]]*)\]\(bind:([^)\s]+)\)/g;
function bindToValue(text: string): string {
	return text.replace(BIND_LINK_RE, '$1');
}

const EMPTY_RESOLVED: ReadonlyMap<string, string> = new Map<string, string>();

export type LivingDocViewMode = 'rendered' | 'raw';

export type PresentChoice = 'gdoc' | 'gsheet' | 'docx' | 'xlsx' | 'site';
export type ShareScope = 'internal' | 'link' | 'public';

export interface IPresentState {
	readonly open: boolean;
	readonly choice: PresentChoice;
	readonly scope: ShareScope;
}

export interface ILivingDocRenderInput {
	readonly doc: ILivingDoc | undefined;
	readonly pending: readonly IProposedChange[];
	/** Resolved value per bind key; the visible cache is reconciled to these at render time (lock wins). */
	readonly resolved: ReadonlyMap<string, string>;
	/** True when a source changed since last sync/review ("may be affected"). */
	readonly dirty: boolean;
	readonly status: string;
	readonly recent: ReadonlySet<string>;
	readonly mode: LivingDocViewMode;
	readonly rawText: string;
	readonly present: IPresentState;
	/** The figure diff from the last "Sync across" (drives the synced banner). */
	readonly syncDiff: readonly IFigureChange[];
	/**
	 * When set, the in-surface source-peek pane is open (the comp's "Sync across" source panel): it
	 * renders to the LEFT of the document inside the one surface - never a second editor group.
	 */
	readonly sourcePeek?: ISourcePeekRender;
}

/** The source-peek data plus the editor-held sync state (the divider circle's synced confirmation). */
export interface ISourcePeekRender extends ISourcePeek {
	readonly synced: boolean;
	readonly syncedCount: number;
}

function esc(s: string): string {
	return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Render generic Markdown (headings, paragraphs, lists, bold/italic, code, links) by reusing
// VS Code's own sanitizing renderer, so any plain .md shows real content instead of a blank page.
function renderGenericMarkdown(body: string): string {
	const rendered = renderMarkdown({ value: body });
	try {
		return rendered.element.innerHTML;
	} finally {
		rendered.dispose();
	}
}

const ACCENT = 'oklch(0.55 0.13 255)';
const ACCENT_DK = 'oklch(0.45 0.13 255)';

// Style and script are single left-aligned template literals so source indentation stays tab-only.
const STYLE = `*{box-sizing:border-box}
html,body{margin:0;height:100%;background:#fff;color:#1a1c20;font-family:system-ui,-apple-system,'Segoe UI',sans-serif}
.topbar{position:sticky;top:0;height:48px;display:flex;align-items:center;justify-content:space-between;padding:0 16px 0 14px;border-bottom:1px solid #e9eaee;background:#fbfbfc;z-index:5}
.brand{display:flex;align-items:center;gap:10px;font:600 13px/1 system-ui;color:#2a2c32}
.logo{width:20px;height:20px;border-radius:6px;background:${ACCENT};color:#fff;display:flex;align-items:center;justify-content:center;font:600 11px/1 system-ui}
.sep{color:#c8cbd2}
.crumb{color:#868b95;font-weight:400}
.right{display:flex;align-items:center;gap:10px}
.pill{display:flex;align-items:center;gap:7px;font:500 11.5px/1 system-ui;color:#5d8a66;background:#eef7f0;border:1px solid #d7ecdc;border-radius:999px;padding:6px 11px;cursor:pointer}
.pill .dot{width:7px;height:7px;border-radius:50%;background:oklch(0.6 0.13 150)}
.pill.warn{color:#9a6b16;background:#fdf2dc;border-color:#f0e2c0}
.pill.warn .dot{background:oklch(0.66 0.16 45)}
.btn{border:none;border-radius:8px;padding:8px 14px;background:${ACCENT};color:#fff;font:600 12px/1 system-ui;cursor:pointer}
.av{flex:none;width:27px;height:27px;border-radius:50%;background:${ACCENT};color:#fff;font:600 11px/27px system-ui;text-align:center}
.docwrap{max-width:780px;margin:0 auto;padding:48px 28px 80px;display:grid;grid-template-columns:30px 1fr;column-gap:10px;align-items:start}
.docfull{grid-column:1 / -1}
h1.title{margin:0 0 6px;font:600 30px/1.2 system-ui;letter-spacing:-.015em;color:#15171c}
.subtitle{font:400 12.5px/1 'JetBrains Mono',ui-monospace,monospace;color:#a3a8b2;margin-bottom:34px}
h2.section{margin:26px 0 12px;font:600 19px/1.3 system-ui;color:#23262c}
/* True left gutter: a fixed column holding only the provenance marker, detached from the prose column
 * so markers never indent the text. One grid row per document line; a line that wraps is just a taller
 * prose cell. A bound line shows a dot; a multi-line edit blends its marker into a spanning bar. */
.gutter2{grid-column:1;display:flex;flex-direction:column;align-items:center;gap:6px;padding-top:7px;-webkit-user-select:none;user-select:none}
.gutter2.span{align-self:stretch}
.pcell{grid-column:2;min-width:0}
.pdot{width:8px;height:8px;border-radius:50%;background:${ACCENT};cursor:pointer}
.pdot.warn{background:oklch(0.66 0.16 45);box-shadow:0 0 0 4px rgba(220,150,60,.14)}
/* A multi-line edit blends its marker into a vertical bar spanning the changed rows. */
.gbar{width:3px;flex:1;min-height:16px;border-radius:2px;background:${ACCENT};cursor:pointer}
.gbar.warn{background:oklch(0.66 0.16 45)}
p.block{margin:0 0 22px;font:400 16px/1.78 system-ui;color:#2c2f36}
/* A source-bound figure inline in the prose: the comp's faint-blue highlight + underline, so the reader
 * sees exactly which words are live. Clicking one peeks its source. */
.bound{background:rgba(80,110,235,.08);border-bottom:1.5px solid oklch(0.6 0.1 255);border-radius:2px;padding:0 2px;cursor:pointer}
.bound:hover{background:rgba(80,110,235,.16)}
.editable{border-radius:4px;transition:background .1s,box-shadow .1s;cursor:text}
.editable:hover{background:rgba(80,90,160,.06)}
.editable:focus{outline:none;background:rgba(80,90,160,.08);box-shadow:0 0 0 1px #c2c9f0}
h2.section.editable{margin-left:-6px;padding-left:6px}
.applied{background:rgba(31,122,68,.09);border-radius:4px;padding:1px 4px;animation:flash 1.6s ease}
@keyframes flash{0%{background:rgba(31,122,68,.34)}100%{background:rgba(31,122,68,.09)}}
/* Hover a bound line (or its gutter dot) to light up the provenance link to its source. */
[data-prov]{cursor:pointer}
.pcell[data-prov]:hover,p.bound[data-prov]:hover{background:#f4f6ff;border-radius:4px}
.pdot[data-prov]:hover{box-shadow:0 0 0 4px rgba(91,109,196,.18)}
/* Inline word-diff for a meaning-change, matching the hi-fi (edit-in-place, not a stacked block). */
.editblock{box-shadow:inset 2px 0 0 oklch(0.66 0.16 45);padding-left:14px}
.editp{margin:0 0 12px;font:400 16px/1.78 system-ui;color:#2c2f36}
.d-o{background:#fdecec;color:#b4332f;text-decoration:line-through;text-decoration-color:rgba(180,51,47,.5);border-radius:2px;padding:0 2px}
.d-n{background:#e7f6ec;color:#1f7a44;border-radius:2px;padding:0 2px}
.ctrl{display:flex;align-items:center;gap:10px;margin-top:13px;background:#fff;border:1px solid #eceef2;border-radius:9px;padding:9px 11px;flex-wrap:wrap}
.ctrl .cdot{width:7px;height:7px;border-radius:50%;background:oklch(0.66 0.16 45);flex:none}
.ctrl .lbl{font:500 12px/1.4 system-ui;color:#52575f}
.ctrl .src{font-family:'JetBrains Mono',ui-monospace,monospace;color:${ACCENT}}
.ctrl .add{color:#1f7a44}.ctrl .rem{color:#b4332f}
.ctrl .acts{margin-left:auto;display:flex;gap:7px}
.ctrl .approve{border:none;border-radius:7px;padding:8px 14px;background:${ACCENT};color:#fff;font:600 12px/1 system-ui;cursor:pointer}
.ctrl .approve:hover{background:oklch(0.5 0.13 255)}
.ctrl .reject{border:1px solid #e0e2e8;border-radius:7px;padding:8px 12px;background:#fff;color:#696e78;font:500 12px/1 system-ui;cursor:pointer}
.ctrl .reject:hover{background:#f4f5f7}
table.kpi{flex:1;border:1px solid #eceef2;border-radius:10px;border-collapse:separate;border-spacing:0;overflow:hidden;font:400 13.5px/1 system-ui;margin-bottom:22px}
table.kpi th{background:#f8f9fb;font:600 11px/1 'JetBrains Mono',ui-monospace,monospace;color:#a3a8b2;letter-spacing:.04em;text-align:right;padding:10px 14px}
table.kpi th:first-child{text-align:left}
table.kpi td{border-top:1px solid #f1f2f5;padding:10px 14px;text-align:right}
table.kpi td:first-child{text-align:left;font-weight:500}
.up{color:#1f7a44}.down{color:#b4332f}
.empty{padding:60px;color:#9a9aa3;text-align:center}
.hint{max-width:720px;margin:0 auto;padding:0 40px 30px;font:400 12px/1.6 system-ui;color:#a3a8b2}
.toggle{border:1px solid #d9dae0;border-radius:8px;padding:7px 12px;background:#fff;color:#4a4c54;font:600 12px/1 system-ui;cursor:pointer}
.toggle:hover{background:#f4f4f6}
/* Floating selection toolbar: formatting appears only on a text selection (the comp has no persistent toolbar) - keeps the header calm while holding inline-formatting functionality. */
.seltoolbar{position:absolute;display:none;align-items:center;gap:2px;background:#fff;border:1px solid #e6e8ed;border-radius:9px;box-shadow:0 6px 20px rgba(20,30,60,.16);padding:4px 6px;z-index:30}
.seltoolbar .fdiv{width:1px;height:18px;background:#e6e8ed;margin:0 5px}
.seltoolbar .fbtn{border:none;background:transparent;border-radius:7px;padding:6px 9px;color:#52575f;font:500 12.5px/1 system-ui;cursor:pointer}
.seltoolbar .fbtn.ic{width:30px;height:30px;padding:0;font-size:13px}
.seltoolbar .fbtn.b{font-weight:700}.seltoolbar .fbtn.i{font-style:italic}.seltoolbar .fbtn.u{text-decoration:underline}
.seltoolbar .fbtn:hover{background:#f4f5f7;color:#23262c}
.hint-raw{border:none;background:none;padding:0;margin-left:5px;color:#8a93c4;font:500 12px/1.6 system-ui;cursor:pointer;text-decoration:underline}
.hint-raw:hover{color:oklch(0.5 0.13 255)}
/* Source-peek / Sync-across banner. */
.syncbar{display:flex;align-items:center;gap:8px;margin:14px 16px 0;padding:9px 13px;border:1px solid #f0e2c4;background:#fdf6e9;border-radius:9px;font:500 12px/1.4 system-ui;color:#9a6b16}
.syncbar.done{border-color:#d7ecdc;background:#eef7f0;color:#1f5a36}
.syncbar .sb-spacer{flex:1}
.syncbar .sb-btn{border:none;border-radius:7px;padding:7px 12px;background:oklch(0.55 0.13 255);color:#fff;font:600 11.5px/1 system-ui;cursor:pointer}
.syncbar .sb-btn:hover{background:oklch(0.5 0.13 255)}
.syncbar .sb-diff{font:500 11px/1.5 'JetBrains Mono',ui-monospace,monospace}
/* In-surface source-peek pane (the comp's "Sync across" source panel) - LEFT of the doc, one surface. */
.peekwrap{display:flex;align-items:stretch;position:relative;min-height:0}
.peekwrap .docside{flex:1;min-width:0;overflow-y:auto}
.srcpane{width:46%;flex:none;border-right:1px solid #e9eaee;background:#fcfcfd;display:flex;flex-direction:column;min-width:0;overflow-y:auto}
.srcpane .sp-head{flex:none;display:flex;align-items:center;gap:9px;padding:11px 14px;border-bottom:1px solid #eef0f3;background:#f6f7f9}
.srcpane .sp-name{font:500 12.5px/1 'JetBrains Mono',ui-monospace,monospace;color:#52575f}
.srcpane .sp-meta{font:400 10.5px/1 'JetBrains Mono',ui-monospace,monospace;color:#a3a8b2}
.srcpane .sp-x{margin-left:auto;border:none;background:none;color:#9aa0aa;font-size:14px;cursor:pointer;padding:4px 6px}
.srcpane .sp-x:hover{color:#52575f}
.srcpane .sp-body{flex:1;overflow:auto;padding:14px 16px}
.srcpane table{width:100%;border-collapse:collapse;font:400 12px/1.5 'JetBrains Mono',ui-monospace,monospace}
.srcpane th{text-align:left;padding:7px 9px;font-weight:600;color:#a3a8b2;border-bottom:1px solid #e9eaee}
.srcpane td{padding:6px 9px;border-bottom:1px solid #f4f5f7;color:#2c2f36}
.srcpane tr.sel td{background:#fef6e9;box-shadow:inset 2px 0 0 oklch(0.66 0.16 45);font-weight:600}
.srcpane .sp-refs{margin-top:18px;border-top:1px solid #eef0f3;padding-top:14px}
.srcpane .sp-refs-h{font:600 10px/1 'JetBrains Mono',ui-monospace,monospace;letter-spacing:.08em;color:#a3a8b2;margin-bottom:10px}
.srcpane .sp-ref{display:flex;align-items:center;gap:7px;font:400 12.5px/1.6 system-ui;color:#52575f}
/* Sits on the divider, but BELOW the source-pane header so it never overlaps the close button. */
.synccircle{position:absolute;top:64px;left:46%;transform:translateX(-50%);z-index:20;display:flex;flex-direction:column;align-items:center;gap:6px}
.synccircle .sc-btn{width:42px;height:42px;border-radius:50%;border:1px solid #d8e0fb;background:#fff;box-shadow:0 4px 14px rgba(40,70,160,.18);color:oklch(0.5 0.13 255);font-size:18px;cursor:pointer;display:flex;align-items:center;justify-content:center}
.synccircle .sc-btn:hover{background:#f4f6ff}
.synccircle .sc-lbl{font:600 10px/1 system-ui;color:#5b6dc4;background:#fff;border:1px solid #e0e6ff;border-radius:999px;padding:4px 8px;box-shadow:0 2px 6px rgba(40,70,160,.1);white-space:nowrap}
.synccircle.done .sc-btn{border-color:#c5e7d0;background:#e7f6ec;color:#1f7a44;cursor:default}
.synccircle.done .sc-lbl{color:#1f7a44;border-color:#c5e7d0}
.prose{max-width:720px;margin:0 auto;padding:24px 40px 80px;font:400 15px/1.7 system-ui;color:#2a2a31}
.prose h1{font:600 27px/1.25 system-ui;letter-spacing:-.01em;color:#15151a;margin:24px 0 12px}
.prose h2{font:600 20px/1.3 system-ui;color:#26262d;margin:26px 0 10px}
.prose h3{font:600 16px/1.3 system-ui;color:#34343c;margin:22px 0 8px}
.prose h4,.prose h5,.prose h6{font:600 14px/1.3 system-ui;color:#46464e;margin:18px 0 6px}
.prose p{margin:0 0 14px}
.prose ul,.prose ol{margin:0 0 14px;padding-left:26px}
.prose li{margin:3px 0}
.prose a{color:${ACCENT};text-decoration:none}
.prose a:hover{text-decoration:underline}
.prose code{font:400 13px/1.5 'JetBrains Mono',ui-monospace,monospace;background:#f3f3f5;border-radius:4px;padding:1px 5px}
.prose pre{background:#f7f7f9;border:1px solid #ececf0;border-radius:8px;padding:14px 16px;overflow:auto;margin:0 0 14px}
.prose pre code{background:none;padding:0}
.prose blockquote{margin:0 0 14px;padding:2px 16px;border-left:3px solid #e1e2e8;color:#6a6a73}
.prose table{border-collapse:collapse;margin:0 0 14px;font-size:13px}
.prose th,.prose td{border:1px solid #ececf0;padding:7px 12px;text-align:left}
.prose img{max-width:100%}
.rawwrap{max-width:860px;margin:0 auto;padding:20px 40px 60px}
textarea.raw{width:100%;min-height:70vh;box-sizing:border-box;border:1px solid #e1e2e8;border-radius:10px;padding:18px 20px;resize:vertical;background:#fbfbfc;color:#23242a;font:400 13px/1.7 'JetBrains Mono',ui-monospace,monospace;tab-size:2}
textarea.raw:focus{outline:none;border-color:${ACCENT}}
/* Present & export modal. */
.pm-overlay{position:fixed;inset:0;z-index:60;background:rgba(20,26,40,.34);display:flex;align-items:center;justify-content:center;padding:32px}
.pm-card{width:740px;max-width:100%;max-height:100%;background:#fff;border-radius:16px;box-shadow:0 24px 70px rgba(15,22,40,.32);overflow:hidden;display:flex;flex-direction:column}
.pm-head{flex:none;display:flex;align-items:center;gap:11px;padding:18px 22px;border-bottom:1px solid #eef0f3}
.pm-title{margin:0 0 3px;font:600 16px/1.2 system-ui;color:#15171c}
.pm-sub{font:400 12px/1 'JetBrains Mono',ui-monospace,monospace;color:#a3a8b2}
.pm-x{margin-left:auto;border:none;background:none;color:#9aa0aa;font-size:18px;cursor:pointer;padding:4px 8px}
.pm-body{flex:1;display:flex;min-height:0}
.pm-list{width:300px;flex:none;border-right:1px solid #eef0f3;background:#fbfbfc;overflow-y:auto;padding:14px}
.pm-detail{flex:1;min-width:0;overflow-y:auto;padding:22px}`;

const SCRIPT = `const vscode = acquireVsCodeApi();
for (const b of document.querySelectorAll('[data-refresh]')) { b.addEventListener('click', () => vscode.postMessage({ type: 'refresh' })); }
for (const d of document.querySelectorAll('[data-cells]')) { d.addEventListener('click', () => vscode.postMessage({ type: 'reveal', cells: d.getAttribute('data-cells').split(',') })); }
const toRaw = document.querySelector('[data-to-raw]');
if (toRaw) { toRaw.addEventListener('click', () => vscode.postMessage({ type: 'setMode', mode: 'raw' })); }
for (const b of document.querySelectorAll('[data-approve]')) { b.addEventListener('click', e => { e.stopPropagation(); vscode.postMessage({ type: 'approve', id: b.getAttribute('data-approve') }); }); }
for (const b of document.querySelectorAll('[data-reject]')) { b.addEventListener('click', e => { e.stopPropagation(); vscode.postMessage({ type: 'reject', id: b.getAttribute('data-reject') }); }); }
for (const c of document.querySelectorAll('[data-source-close]')) { c.addEventListener('click', () => vscode.postMessage({ type: 'closeSource' })); }
for (const b of document.querySelectorAll('[data-sync]')) { b.addEventListener('click', () => vscode.postMessage({ type: 'sync' })); }
const presentOpen = document.querySelector('[data-present-open]');
if (presentOpen) { presentOpen.addEventListener('click', () => vscode.postMessage({ type: 'presentOpen' })); }
for (const c of document.querySelectorAll('[data-present-close]')) { c.addEventListener('click', () => vscode.postMessage({ type: 'presentClose' })); }
const presentStop = document.querySelector('[data-present-stop]');
if (presentStop) { presentStop.addEventListener('click', e => e.stopPropagation()); }
for (const c of document.querySelectorAll('[data-present-choice]')) { c.addEventListener('click', () => vscode.postMessage({ type: 'presentChoice', choice: c.getAttribute('data-present-choice') })); }
for (const s of document.querySelectorAll('[data-present-scope]')) { s.addEventListener('click', () => vscode.postMessage({ type: 'presentScope', scope: s.getAttribute('data-present-scope') })); }
const presentCta = document.querySelector('[data-present-cta]');
if (presentCta) { presentCta.addEventListener('click', () => vscode.postMessage({ type: 'presentCta' })); }
for (const f of document.querySelectorAll('[data-fmt]')) { f.addEventListener('mousedown', e => { e.preventDefault(); document.execCommand(f.getAttribute('data-fmt'), false); }); }
const seltb = document.querySelector('.seltoolbar');
function placeSelToolbar() {
	if (!seltb) { return; }
	const sel = window.getSelection();
	if (!sel || sel.isCollapsed || sel.rangeCount === 0) { seltb.style.display = 'none'; return; }
	const range = sel.getRangeAt(0);
	const node = range.commonAncestorContainer;
	const host = (node.nodeType === 1 ? node : node.parentElement);
	if (!host || !host.closest('[data-block]')) { seltb.style.display = 'none'; return; }
	const rect = range.getBoundingClientRect();
	seltb.style.display = 'flex';
	seltb.style.top = Math.max(8, rect.top + window.scrollY - seltb.offsetHeight - 8) + 'px';
	seltb.style.left = Math.max(8, rect.left + window.scrollX + rect.width / 2 - seltb.offsetWidth / 2) + 'px';
}
document.addEventListener('selectionchange', placeSelToolbar);
const toRendered = document.querySelector('[data-to-rendered]');
const rawArea = document.querySelector('textarea.raw');
if (toRendered) { toRendered.addEventListener('click', () => vscode.postMessage({ type: 'applyRaw', text: rawArea ? rawArea.value : '' })); }
for (const el of document.querySelectorAll('[data-block]')) {
	el.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); el.blur(); } });
	el.addEventListener('blur', () => {
		const text = el.innerText.replace(/\\s+/g, ' ').trim();
		if (text !== el.getAttribute('data-orig')) { vscode.postMessage({ type: 'edit', blockId: el.getAttribute('data-block'), text: text }); }
	});
}`;

export function renderLivingDocHtml(input: ILivingDocRenderInput): string {
	const { doc, pending, resolved, dirty, status, recent, mode, rawText } = input;
	const isLiving = !!doc?.isLiving;
	const crumb = isLiving ? 'Living Document' : 'Markdown';

	const isRendered = mode === 'rendered';

	// The comp's calm 48px bar carries only: brand/crumb + the sync pill + Present + avatar. The status
	// pill IS the refresh affordance (click to re-derive from sources) - no separate Refresh/Download
	// buttons (Download is covered by the Present & export modal; per-doc sync by the Sync-across pane).
	const warn = (pending.length || dirty) ? 'warn' : '';
	const livingControls = isLiving
		? `<span class="pill ${warn}" data-refresh title="Refresh from sources"><span class="dot"></span>${esc(status)}</span>`
		: '';
	// In raw mode, offer the way back to the rendered view.
	const rawToggleTop = mode === 'raw'
		? `<button class="toggle" data-to-rendered>&#10003; Done editing source</button>`
		: '';
	const presentBtn = (doc && isRendered) ? `<button class="toggle" data-present-open>&#8599; Present</button>` : '';

	const topbar = `<div class="topbar"><div class="brand"><span class="logo">L</span>Opportunity OS<span class="sep">/</span><span class="crumb">${crumb}</span></div>`
		+ `<div class="right">${livingControls}${rawToggleTop}${presentBtn}<span class="av">TS</span></div></div>`;

	const modal = input.present.open && doc ? renderPresentModal(input.present, doc.title) : '';

	// Formatting lives in a floating toolbar shown only on a text selection (built below; positioned by
	// the webview script). It is always in the DOM for a living doc but hidden until text is selected.
	const selToolbar = (isLiving && isRendered)
		? `<div class="seltoolbar">`
		+ `<button class="fbtn" data-fmt="formatBlock" data-fmt-arg="&lt;h2&gt;">Heading</button>`
		+ `<span class="fdiv"></span>`
		+ `<button class="fbtn ic b" data-fmt="bold" title="Bold">B</button>`
		+ `<button class="fbtn ic i" data-fmt="italic" title="Italic">I</button>`
		+ `<button class="fbtn ic u" data-fmt="underline" title="Underline">U</button>`
		+ `<button class="fbtn ic" data-fmt="insertUnorderedList" title="List">&#9679;&#8202;&#9679;</button>`
		+ `<button class="fbtn ic" data-fmt="formatBlock" data-fmt-arg="&lt;blockquote&gt;" title="Quote">&#10078;</button>`
		+ `</div>`
		: '';

	// Source-peek / "Sync across" banner: when a linked source changed, offer a one-tap Sync; after a
	// sync, show the figure diff (old -> new) so the source edit's effect on the document is visible.
	const syncDiff = input.syncDiff ?? [];
	const syncBar = (isLiving && isRendered)
		? (dirty
			? `<div class="syncbar"><span>&#9888; A linked source changed since the last sync.</span><span class="sb-spacer"></span><button class="sb-btn" data-sync>Sync figures</button></div>`
			: (syncDiff.length
				? `<div class="syncbar done"><span>&#10003; Synced ${syncDiff.length} figure${syncDiff.length === 1 ? '' : 's'}:</span> <span class="sb-diff">${syncDiff.map(c => `${esc(c.key)} ${esc(c.old)}&rarr;${esc(c.next)}`).join(' &middot; ')}</span></div>`
				: ''))
		: '';

	let body: string;
	if (mode === 'raw') {
		body = `<div class="rawwrap"><textarea class="raw" spellcheck="false">${esc(rawText)}</textarea></div>`;
	} else if (!doc) {
		body = `<div class="empty">No document loaded.</div>`;
	} else if (isLiving) {
		const docHtml = renderDoc(doc, pending, recent, resolved);
		body = syncBar + (input.sourcePeek
			? renderSourcePeekLayout(input.sourcePeek, docHtml)
			: docHtml);
	} else {
		body = `<div class="doc prose">${renderGenericMarkdown(doc.body)}</div>`;
	}

	const hint = (mode === 'rendered' && isLiving)
		? `<div class="hint">Bound figures are highlighted in blue &mdash; click one (or a gutter dot) to trace it back to the source. `
		+ `Figures apply automatically; meaning-changes wait in the Review rail (right side bar). `
		+ `<button class="hint-raw" data-to-raw>Edit raw Markdown</button></div>`
		: '';
	return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${STYLE}</style></head><body>${topbar}${body}${hint}${selToolbar}${modal}<script>${SCRIPT}</script></body></html>`;
}

// The in-surface source-peek layout: the styled source pane to the LEFT, a floating "Sync across"
// circle on the divider, and the document to the RIGHT - all inside the one surface (no editor split).
function renderSourcePeekLayout(peek: ISourcePeekRender, docHtml: string): string {
	const rows = peek.rows.map(r =>
		`<tr class="${r.selected ? 'sel' : ''}"><td>${esc(r.key)}</td><td>${esc(r.value)}</td></tr>`).join('');
	const refs = peek.referencedBy.length
		? `<div class="sp-refs"><div class="sp-refs-h">REFERENCED BY &middot; ${peek.referencedBy.length} DOCUMENT${peek.referencedBy.length === 1 ? '' : 'S'}</div>`
		+ peek.referencedBy.map(t => `<div class="sp-ref">&#9636; ${esc(t)}</div>`).join('') + `</div>`
		: '';
	const circle = peek.synced
		? `<div class="synccircle done"><div class="sc-btn">&#10003;</div><span class="sc-lbl">${peek.syncedCount} change${peek.syncedCount === 1 ? '' : 's'} synced</span></div>`
		: `<div class="synccircle"><button class="sc-btn" data-sync title="Apply your source edits to the report">&#10227;</button><span class="sc-lbl">Sync across &rarr;</span></div>`;
	const pane = `<div class="srcpane"><div class="sp-head"><span class="sp-name">&#8862; ${esc(peek.source)}</span>`
		+ `<span class="sp-meta">source &middot; ${peek.rows.length} bound</span>`
		+ `<button class="sp-x" data-source-close title="Close source">&#10005;</button></div>`
		+ `<div class="sp-body"><table><thead><tr><th>Key</th><th>Resolved</th></tr></thead><tbody>${rows}</tbody></table>${refs}</div></div>`;
	return `<div class="peekwrap">${pane}${circle}<div class="docside">${docHtml}</div></div>`;
}

// The Present & export modal: a destination list (Google Docs / Sheets / Word / Excel / hosted page)
// and a detail pane with the live-behaviour blurb, a document preview and the export CTA. Ported from
// the comp; share scope appears only for the hosted-page destination.
interface IPresentDef { label: string; accent: string; cta: string; live: string; icon: string; tint: string }
const PRESENT_DEFS: Record<PresentChoice, IPresentDef> = {
	gdoc: { label: 'Google Docs', accent: '#2a6fdb', cta: 'Export to Google Docs', live: 'Editable copy &middot; text &amp; tables formatted natively', icon: 'G', tint: '#eaf1fd' },
	gsheet: { label: 'Google Sheets', accent: '#1f8a5b', cta: 'Export to Google Sheets', live: 'Tables become live sheets &middot; links to source kept as a snapshot', icon: 'G', tint: '#e7f5ee' },
	docx: { label: 'Microsoft Word', accent: '#2b579a', cta: 'Download .docx', live: 'Offline file &middot; styles preserved, data values frozen at export', icon: 'W', tint: '#eaf0fa' },
	xlsx: { label: 'Microsoft Excel', accent: '#217346', cta: 'Download .xlsx', live: 'Tables only &middot; one sheet per linked table', icon: 'X', tint: '#e7f3ec' },
	site: { label: 'Hosted web page', accent: ACCENT, cta: 'Publish web page', live: 'Live page that re-renders when the source updates', icon: '&#9673;', tint: '#eef1ff' },
};
const PRESENT_ORDER: readonly PresentChoice[] = ['gdoc', 'gsheet', 'docx', 'xlsx', 'site'];

function renderPresentModal(present: IPresentState, title: string): string {
	const pc = PRESENT_DEFS[present.choice];
	const rows = PRESENT_ORDER.map(k => {
		const d = PRESENT_DEFS[k];
		const sel = k === present.choice;
		const rowStyle = sel ? 'border:1.5px solid ' + ACCENT + ';background:#f7f9ff' : 'border:1px solid #e9eaee;background:#fff';
		return `<button class="pm-row" data-present-choice="${k}" style="text-align:left;border-radius:10px;padding:11px 12px;cursor:pointer;display:flex;align-items:center;gap:11px;${rowStyle}">`
			+ `<span style="width:30px;height:30px;flex:none;border-radius:7px;background:${d.tint};color:${d.accent};font:700 13px/1 system-ui;display:flex;align-items:center;justify-content:center">${d.icon}</span>`
			+ `<span style="min-width:0"><span style="display:block;font:600 13px/1.2 system-ui;color:#1a1c20">${d.label}</span></span></button>`;
	}).join('');

	const scopeStyle = (on: boolean) => on
		? 'border:1.5px solid ' + ACCENT + ';background:#f4f6ff;color:' + ACCENT_DK
		: 'border:1px solid #e0e2e8;background:#fff;color:#696e78';
	const scopeBtn = (scope: ShareScope, label: string) => `<button class="pm-scope" data-present-scope="${scope}" style="border-radius:8px;padding:9px 12px;font:500 12px/1 system-ui;cursor:pointer;${scopeStyle(present.scope === scope)}">${label}</button>`;
	// WHO CAN ACCESS applies to every export (the comp shows it for all destinations, not only the
	// hosted page): the scope sets who may open the copy. The shareable-URL row only makes sense once
	// the scope is beyond the workspace (anyone-with-link / public), so it is gated on that.
	const showUrl = present.scope !== 'internal';
	const urlRow = showUrl
		? `<div style="display:flex;align-items:center;gap:8px;border:1px solid #e6e8ed;border-radius:8px;padding:9px 11px;background:#fcfcfd"><span style="font:400 12px/1 'JetBrains Mono',ui-monospace,monospace;color:#52575f;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">opportunity-os.live/weekly-summary</span><button class="pm-copy" style="border:1px solid #e0e2e8;background:#fff;border-radius:6px;padding:6px 10px;font:500 11px/1 system-ui;color:#52575f;cursor:pointer">Copy</button></div>`
		: '';
	const siteScope = `<div style="margin-bottom:18px"><div style="font:600 10px/1 'JetBrains Mono',ui-monospace,monospace;letter-spacing:.06em;color:#a3a8b2;margin-bottom:9px">WHO CAN ACCESS</div>`
		+ `<div style="display:flex;gap:7px;margin-bottom:${showUrl ? '12px' : '0'}">${scopeBtn('internal', '&#128274; Workspace only')}${scopeBtn('link', '&#128279; Anyone with link')}${scopeBtn('public', '&#127760; Public')}</div>`
		+ `${urlRow}</div>`;

	return `<div class="pm-overlay" data-present-close>`
		+ `<div class="pm-card" data-present-stop>`
		+ `<div class="pm-head"><div><h2 class="pm-title">Present &amp; export</h2><div class="pm-sub">${esc(title)} &middot; 4 linked blocks</div></div><button class="pm-x" data-present-close>&#10005;</button></div>`
		+ `<div class="pm-body">`
		+ `<div class="pm-list"><div style="font:600 10px/1 'JetBrains Mono',ui-monospace,monospace;letter-spacing:.08em;color:#a3a8b2;margin-bottom:9px">SEND A COPY TO</div><div style="display:flex;flex-direction:column;gap:7px">${rows}</div></div>`
		+ `<div class="pm-detail">`
		+ `<div style="display:flex;align-items:center;gap:10px;margin-bottom:6px"><h3 style="margin:0;font:600 17px/1.2 system-ui;color:#15171c">${pc.label}</h3></div>`
		+ `<p style="margin:0 0 18px;font:400 13.5px/1.55 system-ui;color:#696e78">${pc.live}</p>`
		+ `<div style="border:1px solid #eceef2;border-radius:10px;overflow:hidden;margin-bottom:18px"><div style="padding:13px 15px;border-bottom:1px solid #f4f5f7"><div style="font:600 13px/1.3 system-ui;color:#23262c;margin-bottom:5px">${esc(title)}</div><div style="font:400 11px/1.5 system-ui;color:#969ba4">Highlights &middot; KPI table &middot; Commentary &middot; What to watch</div></div><div style="display:flex;align-items:center;gap:8px;padding:10px 15px;background:#fafbfc;font:400 11.5px/1.4 system-ui;color:#52575f"><span style="width:7px;height:7px;border-radius:50%;background:${ACCENT}"></span>4 source-linked blocks included</div></div>`
		+ siteScope
		+ `<button class="pm-cta" data-present-cta style="width:100%;border:none;border-radius:9px;padding:12px;background:${ACCENT};color:#fff;font:600 13.5px/1 system-ui;cursor:pointer">${pc.cta}</button>`
		+ `<div style="margin-top:11px;font:400 11px/1.5 system-ui;color:#bcc0c8;text-align:center">Provenance &amp; approval history are retained on export.</div>`
		+ `</div></div></div></div>`;
}

// A line's gutter cell holds only its provenance marker (no line numbers -- those read as a code
// editor). A bound line gets a dot; a multi-line edit gets a vertical bar spanning the changed rows.
// The marker carries the source cells so hovering/clicking reveals provenance.
function gutterCell(marker: string, span: boolean): string {
	return `<div class="gutter2${span ? ' span' : ''}">${marker}</div>`;
}

// Word-level diff of old -> new, rendered inline (removed = red strikethrough, added = green), so a
// meaning-change reads as an edit-in-place like the hi-fi, not a stacked before/after block.
function inlineDiff(oldText: string, newText: string): { html: string; added: number; removed: number } {
	const a = oldText.split(/\s+/).filter(Boolean);
	const b = newText.split(/\s+/).filter(Boolean);
	const n = a.length, m = b.length;
	const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
	for (let i = n - 1; i >= 0; i--) {
		for (let j = m - 1; j >= 0; j--) {
			dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
		}
	}
	type Op = { t: 'eq' | 'del' | 'ins'; w: string };
	const ops: Op[] = [];
	let i = 0, j = 0;
	while (i < n && j < m) {
		if (a[i] === b[j]) { ops.push({ t: 'eq', w: a[i] }); i++; j++; }
		else if (dp[i + 1][j] >= dp[i][j + 1]) { ops.push({ t: 'del', w: a[i] }); i++; }
		else { ops.push({ t: 'ins', w: b[j] }); j++; }
	}
	while (i < n) { ops.push({ t: 'del', w: a[i++] }); }
	while (j < m) { ops.push({ t: 'ins', w: b[j++] }); }

	// Merge consecutive ops of the same kind into runs and render with a single space between runs.
	const segs: string[] = [];
	let added = 0, removed = 0;
	let k = 0;
	while (k < ops.length) {
		const t = ops[k].t;
		const words: string[] = [];
		while (k < ops.length && ops[k].t === t) { words.push(ops[k].w); k++; }
		const text = esc(words.join(' '));
		if (t === 'eq') { segs.push(text); }
		else if (t === 'del') { segs.push(`<span class="d-o">${text}</span>`); removed++; }
		else { segs.push(`<span class="d-n">${text}</span>`); added++; }
	}
	return { html: segs.join(' '), added, removed };
}

// Render one block's Markdown to sanitized HTML, with bind links reconciled to their resolved value
// (lock wins) and shown as plain text.
function renderBlockMarkdown(block: ILivingDocBlock, resolved: ReadonlyMap<string, string>): string {
	const raw = block.type === 'heading' ? `${'#'.repeat(block.level ?? 2)} ${block.text}` : block.text;
	const rendered = renderMarkdown({ value: bindToValue(reconcileBindLinks(raw, resolved)) });
	try {
		return rendered.element.innerHTML;
	} finally {
		rendered.dispose();
	}
}

// A bound paragraph: render its Markdown, but wrap each resolved figure in a `.bound` span (the comp's
// blue dotted-underline highlight) so the reader can see exactly which words are source-bound. Each
// figure is tokenized BEFORE Markdown rendering (so any formatting around it survives) and the token is
// swapped for the highlighted span afterwards -- safe against the sanitizing Markdown renderer.
function renderBoundParagraph(block: ILivingDocBlock, resolved: ReadonlyMap<string, string>): string {
	const SEP = '\u0001';
	const tokenized = reconcileBindLinks(block.text, resolved).replace(BIND_LINK_RE, (_m, value, key) => `${SEP}${key}${SEP}${value}${SEP}`);
	const rendered = renderMarkdown({ value: tokenized });
	let html: string;
	try {
		html = rendered.element.innerHTML;
	} finally {
		rendered.dispose();
	}
	const tokenRe = new RegExp(`${SEP}([^${SEP}]+)${SEP}([^${SEP}]*)${SEP}`, 'g');
	return html.replace(tokenRe, (_m, key, value) => `<span class="bound" data-cells="${key}" data-prov>${value}</span>`);
}

function renderDoc(doc: ILivingDoc, pending: readonly IProposedChange[], recent: ReadonlySet<string>, resolved: ReadonlyMap<string, string>): string {
	const parts: string[] = [`<div class="docwrap">`,
		`<div class="docfull"><h1 class="title">${esc(doc.title)}</h1><div class="subtitle">${esc(doc.subtitle)}</div></div>`];

	for (const block of doc.blocks) {
		const change = pending.find(c => c.blockId === block.id);
		const cells = block.binds.map(b => b.key).join(',');
		const isRecent = recent.has(block.id);
		const bound = block.binds.length > 0;

		if (change) {
			// Render the meaning-change as an inline word-diff with an amber accent and a control row.
			const d = inlineDiff(bindToValue(change.oldText), bindToValue(change.newText));
			const src = esc(doc.sources.concat(doc.context).join(', '));
			parts.push(gutterCell(`<span class="gbar warn" data-cells="${cells}" data-prov title="Pending change"></span>`, true),
				`<div class="pcell editblock">`
				+ `<p class="editp">${d.html}</p>`
				+ `<div class="ctrl"><span class="cdot"></span>`
				+ `<span class="lbl">Tone rewrite from <span class="src">${src}</span> &middot; <span class="add">+${d.added} added</span> &middot; <span class="rem">${d.removed} removed</span> &middot; ${Math.round(change.confidence * 100)}% confidence</span>`
				+ `<span class="acts"><button class="approve" data-approve="${esc(change.id)}">Approve changes</button>`
				+ `<button class="reject" data-reject="${esc(change.id)}">Reject</button></span></div></div>`);
			continue;
		}

		if (block.type === 'heading' && !bound) {
			// Headings are hand-editable in place (plain text, not rendered Markdown).
			parts.push(gutterCell('', false),
				`<div class="pcell"><h2 class="section editable" contenteditable="true" data-block="${esc(block.id)}" data-orig="${esc(block.text)}">${esc(block.text)}</h2></div>`);
			continue;
		}

		if (bound) {
			// A bound block is driven by its sources: a blue gutter dot, rendered Markdown with the
			// resolved values inline, and hover/click reveals provenance. Not hand-editable. Bound prose
			// additionally highlights each figure inline (the comp's blue underline); tables stay plain.
			const inner = block.type === 'paragraph'
				? renderBoundParagraph(block, resolved)
				: renderBlockMarkdown(block, resolved);
			parts.push(gutterCell(`<span class="pdot${isRecent ? ' warn' : ''}" data-cells="${cells}" data-prov title="Bound to source"></span>`, false),
				`<div class="pcell${isRecent ? ' applied' : ''}" data-cells="${cells}" data-prov>${inner}</div>`);
			continue;
		}

		if (block.type === 'paragraph') {
			// Non-bound prose is hand-editable in place.
			const text = esc(block.text);
			parts.push(gutterCell('', false),
				`<div class="pcell"><p class="block editable${isRecent ? ' applied' : ''}" contenteditable="true" data-block="${esc(block.id)}" data-orig="${text}">${text}</p></div>`);
			continue;
		}

		// Non-bound tables (and other rich blocks): render as Markdown, no inline editing.
		parts.push(gutterCell('', false), `<div class="pcell">${renderBlockMarkdown(block, resolved)}</div>`);
	}

	parts.push(`</div>`);
	return parts.join('\n');
}

// Clean, self-contained export: no IDE chrome, no provenance dots, no diff UI -- just the
// document's current state as a print-ready HTML page that opens anywhere.
const EXPORT_STYLE = `*{box-sizing:border-box}
html,body{margin:0;background:#fff;color:#1a1c20;font-family:Georgia,'Times New Roman',serif}
.page{max-width:720px;margin:0 auto;padding:56px 48px 80px}
h1{font:600 30px/1.25 system-ui,sans-serif;letter-spacing:-.01em;color:#15151a;margin:0 0 4px}
.subtitle{font:400 13px/1.4 system-ui,sans-serif;color:#8a8a93;margin:0 0 32px}
h2{font:600 17px/1.3 system-ui,sans-serif;color:#26262d;margin:30px 0 10px}
p{font-size:16px;line-height:1.7;margin:0 0 14px}
ul,ol{font-size:16px;line-height:1.7}
table{border-collapse:collapse;width:100%;margin:6px 0 16px;font:400 13px/1.4 system-ui,sans-serif}
th{background:#f7f7f9;color:#86868f;text-align:right;padding:9px 12px;border-bottom:1px solid #e6e6ea;font-weight:600}
th:first-child,td:first-child{text-align:left}
td{padding:9px 12px;border-bottom:1px solid #f0f0f3;text-align:right}
.up{color:#1f7a44}.down{color:#b4332f}
code{font-family:ui-monospace,monospace;background:#f3f3f5;border-radius:4px;padding:1px 5px}
pre{background:#f7f7f9;border:1px solid #ececf0;border-radius:8px;padding:14px 16px;overflow:auto}
blockquote{margin:0 0 14px;padding:2px 16px;border-left:3px solid #e1e2e8;color:#6a6a73}
footer{margin-top:48px;padding-top:14px;border-top:1px solid #eee;font:400 11px/1.5 system-ui,sans-serif;color:#a3a8b2}`;

/** Build a standalone, shareable HTML page from a document's current (resolved) state. */
export function renderExportHtml(doc: ILivingDoc, resolved: ReadonlyMap<string, string> = EMPTY_RESOLVED): string {
	const body = renderGenericMarkdown(renderExportMarkdown(doc, resolved));
	const footer = `<footer>Exported from Opportunity OS &middot; Living Document</footer>`;
	return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${esc(doc.title)}</title><style>${EXPORT_STYLE}</style></head><body><main class="page">${body}${footer}</main></body></html>`;
}

/**
 * Build a clean, static Markdown document from a document's current (resolved) state: the bind links
 * collapse to their resolved values, so there are no bindings and no metadata -- just portable
 * Markdown that opens anywhere (Obsidian, GitHub, a share).
 */
export function renderExportMarkdown(doc: ILivingDoc, resolved: ReadonlyMap<string, string> = EMPTY_RESOLVED): string {
	if (!doc.isLiving) {
		// Plain Markdown already is its own clean export.
		return doc.body.trim() + '\n';
	}
	const parts: string[] = [`# ${doc.title}`];
	if (doc.subtitle) { parts.push(`_${doc.subtitle}_`); }
	for (const block of doc.blocks) {
		if (block.type === 'heading') {
			parts.push(`${'#'.repeat(block.level ?? 2)} ${block.text}`);
		} else {
			parts.push(bindToValue(reconcileBindLinks(block.text, resolved)));
		}
	}
	return parts.join('\n\n') + '\n';
}
