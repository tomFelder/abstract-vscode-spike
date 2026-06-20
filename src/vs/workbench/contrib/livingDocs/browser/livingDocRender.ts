/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { renderMarkdown } from '../../../../base/browser/markdownRenderer.js';
import { IKpiRow, ILivingDoc, IProposedChange } from '../common/livingDocsModel.js';

export type LivingDocViewMode = 'rendered' | 'raw';

export interface ILivingDocRenderInput {
	readonly doc: ILivingDoc | undefined;
	readonly pending: readonly IProposedChange[];
	readonly kpiRows: readonly IKpiRow[];
	readonly status: string;
	readonly recent: ReadonlySet<string>;
	readonly mode: LivingDocViewMode;
	readonly rawText: string;
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

// Style and script are single left-aligned template literals so source indentation stays tab-only.
const STYLE = `*{box-sizing:border-box}
html,body{margin:0;height:100%;background:#fff;color:#1a1c20;font-family:system-ui,-apple-system,'Segoe UI',sans-serif}
.topbar{position:sticky;top:0;height:48px;display:flex;align-items:center;justify-content:space-between;padding:0 18px;border-bottom:1px solid #e9eaee;background:#fbfbfc;z-index:5}
.brand{display:flex;align-items:center;gap:10px;font:600 13px/1 system-ui;color:#2a2c32}
.logo{width:20px;height:20px;border-radius:6px;background:${ACCENT};color:#fff;display:flex;align-items:center;justify-content:center;font:600 11px/1 system-ui}
.crumb{color:#868b95;font-weight:400}
.right{display:flex;align-items:center;gap:10px}
.pill{display:flex;align-items:center;gap:7px;font:500 11.5px/1 system-ui;color:#5d8a66;background:#eef7f0;border:1px solid #d7ecdc;border-radius:999px;padding:6px 11px}
.pill .dot{width:7px;height:7px;border-radius:50%;background:oklch(0.6 0.13 150)}
.pill.warn{color:#9a6b16;background:#fdf2dc;border-color:#f0e2c0}
.pill.warn .dot{background:oklch(0.66 0.16 45)}
.btn{border:none;border-radius:8px;padding:8px 14px;background:${ACCENT};color:#fff;font:600 12px/1 system-ui;cursor:pointer}
.doc{max-width:720px;margin:0 auto;padding:40px 40px 80px}
h1.title{margin:0 0 4px;font:600 27px/1.2 system-ui;letter-spacing:-.01em;color:#15151a}
.subtitle{font:400 13px/1 'JetBrains Mono',ui-monospace,monospace;color:#9a9aa3;margin-bottom:30px}
h2.section{margin:26px 0 10px;font:600 15px/1.2 system-ui;color:#34343c}
.row{display:flex}
.gutter{width:30px;flex:none;display:flex;justify-content:center;padding-top:7px}
.pdot{width:8px;height:8px;border-radius:50%;background:${ACCENT};cursor:pointer}
.pdot.warn{background:oklch(0.66 0.16 45);box-shadow:0 0 0 4px rgba(220,150,60,.14)}
p.block{flex:1;margin:0 0 4px;font:400 15px/1.7 system-ui;color:#2a2a31}
.bound{border-bottom:1.5px dotted #c2c9f0}
.editable{border-radius:4px;transition:background .1s,box-shadow .1s;cursor:text}
.editable:hover{background:rgba(80,90,160,.06)}
.editable:focus{outline:none;background:rgba(80,90,160,.08);box-shadow:0 0 0 1px #c2c9f0}
h2.section.editable{margin-left:-6px;padding-left:6px}
.applied{background:rgba(31,122,68,.09);border-radius:4px;padding:1px 4px;animation:flash 1.6s ease}
@keyframes flash{0%{background:rgba(31,122,68,.34)}100%{background:rgba(31,122,68,.09)}}
table.kpi{flex:1;border:1px solid #ececf0;border-radius:8px;border-collapse:separate;border-spacing:0;overflow:hidden;font:400 13px/1 system-ui;margin-bottom:6px}
table.kpi th{background:#f7f7f9;font:600 11px/1 'JetBrains Mono',ui-monospace,monospace;color:#86868f;text-align:right;padding:9px 12px}
table.kpi th:first-child{text-align:left}
table.kpi td{border-top:1px solid #f0f0f3;padding:9px 12px;text-align:right}
table.kpi td:first-child{text-align:left}
.up{color:#1f7a44}.down{color:#b4332f}
.diff{flex:1;border:1px solid #ececf0;border-radius:8px;overflow:hidden;margin-bottom:6px}
.diff .o{background:#fdecec;color:#7a3a38;text-decoration:line-through;text-decoration-color:rgba(180,51,47,.4);padding:9px 12px;font:400 15px/1.6 system-ui}
.diff .n{background:#e7f6ec;color:#1f5a36;padding:9px 12px;font:400 15px/1.6 system-ui}
.await{display:inline-flex;align-items:center;gap:6px;margin:8px 0 0 30px;font:600 11px/1 'JetBrains Mono',ui-monospace,monospace;color:#9a6b16;background:#fdf2dc;border-radius:999px;padding:5px 10px}
.empty{padding:60px;color:#9a9aa3;text-align:center}
.hint{max-width:720px;margin:0 auto;padding:0 40px 30px;font:400 12px/1.6 system-ui;color:#a3a8b2}
.toggle{border:1px solid #d9dae0;border-radius:8px;padding:7px 12px;background:#fff;color:#4a4c54;font:600 12px/1 system-ui;cursor:pointer}
.toggle:hover{background:#f4f4f6}
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
textarea.raw:focus{outline:none;border-color:${ACCENT}}`;

const SCRIPT = `const vscode = acquireVsCodeApi();
for (const b of document.querySelectorAll('[data-refresh]')) { b.addEventListener('click', () => vscode.postMessage({ type: 'refresh' })); }
for (const d of document.querySelectorAll('[data-cells]')) { d.addEventListener('click', () => vscode.postMessage({ type: 'reveal', cells: d.getAttribute('data-cells').split(',') })); }
const toRaw = document.querySelector('[data-to-raw]');
if (toRaw) { toRaw.addEventListener('click', () => vscode.postMessage({ type: 'setMode', mode: 'raw' })); }
const exportBtn = document.querySelector('[data-export]');
if (exportBtn) { exportBtn.addEventListener('click', () => vscode.postMessage({ type: 'export' })); }
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
	const { doc, pending, kpiRows, status, recent, mode, rawText } = input;
	const isLiving = !!doc?.isLiving;
	const crumb = isLiving ? '/ Living Document' : '/ Markdown';

	// Toggle between the rendered view and an editable raw-Markdown view.
	const toggle = mode === 'raw'
		? `<button class="toggle" data-to-rendered>&#10003; Rendered</button>`
		: `<button class="toggle" data-to-raw>&lt;/&gt; Raw Markdown</button>`;

	// Status pill + "Refresh from sources" are only meaningful for bound Living Documents.
	const warn = pending.length ? 'warn' : '';
	const livingControls = isLiving
		? `<span class="pill ${warn}"><span class="dot"></span>${esc(status)}</span>`
		: '';
	const refresh = isLiving && mode === 'rendered'
		? `<button class="btn" data-refresh>&#8635; Refresh from sources</button>`
		: '';
	// Export the document to a self-contained HTML page.
	const exportBtn = (doc && mode === 'rendered')
		? `<button class="toggle" data-export>&#8682; Export</button>`
		: '';

	const topbar = `<div class="topbar"><div class="brand"><span class="logo">L</span>Opportunity OS<span class="crumb">${crumb}</span></div>`
		+ `<div class="right">${livingControls}${toggle}${exportBtn}${refresh}</div></div>`;

	let body: string;
	if (mode === 'raw') {
		body = `<div class="rawwrap"><textarea class="raw" spellcheck="false">${esc(rawText)}</textarea></div>`;
	} else if (!doc) {
		body = `<div class="empty">No document loaded.</div>`;
	} else if (isLiving) {
		body = renderDoc(doc, pending, kpiRows, recent);
	} else {
		body = `<div class="doc prose">${renderGenericMarkdown(doc.body)}</div>`;
	}

	const hint = (mode === 'rendered' && isLiving)
		? `<div class="hint">Bound text is dotted-underlined &mdash; click a provenance dot to trace it back to the source. `
		+ `Figures apply automatically; meaning-changes wait in the Review rail (right side bar).</div>`
		: '';
	return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${STYLE}</style></head><body>${topbar}${body}${hint}<script>${SCRIPT}</script></body></html>`;
}

function renderDoc(doc: ILivingDoc, pending: readonly IProposedChange[], kpiRows: readonly IKpiRow[], recent: ReadonlySet<string>): string {
	const parts: string[] = [`<div class="doc">`,
		`<h1 class="title">${esc(doc.title)}</h1>`,
		`<div class="subtitle">${esc(doc.subtitle)}</div>`];

	for (const block of doc.blocks) {
		const change = pending.find(c => c.blockId === block.id);
		const cells = block.binding?.cells.join(',') ?? '';
		const isRecent = recent.has(block.id);

		if (block.type === 'heading') {
			parts.push(`<h2 class="section editable" contenteditable="true" data-block="${esc(block.id)}" data-orig="${esc(block.text ?? '')}">${esc(block.text ?? '')}</h2>`);
			continue;
		}

		if (block.type === 'kpiTable') {
			parts.push(`<div class="row"><div class="gutter"><span class="pdot" data-cells="${cells}" title="Bound to source"></span></div>${renderKpi(kpiRows, isRecent)}</div>`);
			continue;
		}

		if (change) {
			parts.push(`<div class="row"><div class="gutter"><span class="pdot warn" data-cells="${cells}" title="Pending change"></span></div>`
				+ `<div class="diff"><div class="o">${esc(change.oldText)}</div><div class="n">${esc(change.newText)}</div></div></div>`
				+ `<div class="await">&#9679; awaiting approval in Review rail &middot; ${Math.round(change.confidence * 100)}% confidence</div>`);
			continue;
		}

		const dot = block.binding ? `<span class="pdot" data-cells="${cells}" title="Bound to source"></span>` : '';
		const text = esc(block.text ?? '');
		// Non-bound prose is hand-editable in place; bound prose stays driven by its source.
		const textClass = `block${block.binding ? ' bound' : ' editable'}${isRecent ? ' applied' : ''}`;
		const editAttrs = block.binding ? '' : ` contenteditable="true" data-block="${esc(block.id)}" data-orig="${text}"`;
		parts.push(`<div class="row"><div class="gutter">${dot}</div><p class="${textClass}"${editAttrs}>${text}</p></div>`);
	}

	parts.push(`</div>`);
	return parts.join('\n');
}

function renderKpi(rows: readonly IKpiRow[], isRecent: boolean): string {
	if (!rows.length) {
		return `<table class="kpi"><tr><td>No source rows available.</td></tr></table>`;
	}
	const head = `<tr><th>METRIC</th><th>Prev</th><th>Current</th><th>&Delta;</th></tr>`;
	const body = rows.map(r => `<tr><td>${esc(r.metric)}</td><td style="color:#86868f">${esc(r.prev)}</td><td${isRecent ? ' class="applied"' : ''}>${esc(r.curr)}</td><td class="${r.positive ? 'up' : 'down'}">${esc(r.delta)}</td></tr>`).join('');
	return `<table class="kpi">${head}${body}</table>`;
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

function exportKpi(rows: readonly IKpiRow[]): string {
	if (!rows.length) { return ''; }
	const head = `<tr><th>Metric</th><th>Prev</th><th>Current</th><th>Change</th></tr>`;
	const body = rows.map(r => `<tr><td>${esc(r.metric)}</td><td>${esc(r.prev)}</td><td>${esc(r.curr)}</td><td class="${r.positive ? 'up' : 'down'}">${esc(r.delta)}</td></tr>`).join('');
	return `<table>${head}${body}</table>`;
}

/** Build a standalone, shareable HTML page from a document's current (resolved) state. */
export function renderExportHtml(doc: ILivingDoc, kpiRows: readonly IKpiRow[]): string {
	let body: string;
	if (doc.isLiving) {
		const parts: string[] = [`<h1>${esc(doc.title)}</h1>`];
		if (doc.subtitle) { parts.push(`<div class="subtitle">${esc(doc.subtitle)}</div>`); }
		for (const block of doc.blocks) {
			if (block.type === 'heading') { parts.push(`<h2>${esc(block.text ?? '')}</h2>`); }
			else if (block.type === 'kpiTable') { parts.push(exportKpi(kpiRows)); }
			else { parts.push(`<p>${esc(block.text ?? '')}</p>`); }
		}
		body = parts.join('\n');
	} else {
		body = renderGenericMarkdown(doc.body);
	}
	const footer = `<footer>Exported from Opportunity OS &middot; Living Document</footer>`;
	return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${esc(doc.title)}</title><style>${EXPORT_STYLE}</style></head><body><main class="page">${body}${footer}</main></body></html>`;
}
