/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IKpiRow, ILivingDoc, IProposedChange } from '../common/livingDocsModel.js';

function esc(s: string): string {
	return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
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
.hint{max-width:720px;margin:0 auto;padding:0 40px 30px;font:400 12px/1.6 system-ui;color:#a3a8b2}`;

const SCRIPT = `const vscode = acquireVsCodeApi();
for (const b of document.querySelectorAll('[data-refresh]')) { b.addEventListener('click', () => vscode.postMessage({ type: 'refresh' })); }
for (const d of document.querySelectorAll('[data-cells]')) { d.addEventListener('click', () => vscode.postMessage({ type: 'reveal', cells: d.getAttribute('data-cells').split(',') })); }`;

export function renderLivingDocHtml(doc: ILivingDoc | undefined, pending: readonly IProposedChange[], kpiRows: readonly IKpiRow[], status: string, recent: ReadonlySet<string>): string {
	const body = doc ? renderDoc(doc, pending, kpiRows, recent) : `<div class="empty">No document loaded.</div>`;
	const warn = pending.length ? 'warn' : '';
	const topbar = `<div class="topbar"><div class="brand"><span class="logo">L</span>Opportunity OS<span class="crumb">/ Living Document</span></div>`
		+ `<div class="right"><span class="pill ${warn}"><span class="dot"></span>${esc(status)}</span>`
		+ `<button class="btn" data-refresh>&#8635; Refresh from sources</button></div></div>`;
	const hint = `<div class="hint">Bound text is dotted-underlined &mdash; click a provenance dot to trace it back to the source. `
		+ `Figures apply automatically; meaning-changes wait in the Review rail (right side bar).</div>`;
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
			parts.push(`<h2 class="section">${esc(block.text ?? '')}</h2>`);
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
		const textClass = `block${block.binding ? ' bound' : ''}${isRecent ? ' applied' : ''}`;
		parts.push(`<div class="row"><div class="gutter">${dot}</div><p class="${textClass}">${esc(block.text ?? '')}</p></div>`);
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
