/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IAuditEntry, ISnapshotEntry, SnapshotVia } from '../common/livingDocsModel.js';

// The truthful History tab body (plan 26 iter 3), kept as a pure, side-effect-free render module (mirroring
// livingDocRender / treeRail) so it stays unit-testable without pulling in the ViewPane graph. It renders
// REAL snapshots (restorable versions) interleaved with the REAL audit entries recorded since each one - all
// from the active document's lock, never the fabricated v14/v13 sample.

function esc(s: string): string {
	return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// One timeline row: a dot/glyph + connector on the left, then title (+ optional badge and right-aligned
// action) over a body line and a mono meta line. Shared by the version, change and origin rows.
function timelineRow(dot: string, title: string, badge: string, body: string, meta: string, last: boolean, action = ''): string {
	const connector = last ? '' : `<span style="flex:1;width:2px;background:#e6e8ed"></span>`;
	return `<div style="display:flex;gap:11px"><div style="flex:none;display:flex;flex-direction:column;align-items:center">${dot}${connector}</div>`
		+ `<div style="flex:1;padding-bottom:${last ? '0' : '18px'}"><div style="display:flex;align-items:center;gap:7px"><span style="font:600 12.5px/1 system-ui;color:#1a1c20">${title}</span>${badge}${action}</div>`
		+ `<div style="font:400 12.5px/1.5 system-ui;color:#52575f;margin:5px 0 3px">${body}</div><div style="font:400 11px/1 'JetBrains Mono',ui-monospace,monospace;color:#a3a8b2">${meta}</div></div></div>`;
}

// A calm, honest relative time from a REAL ISO timestamp (never the fabricated "just now &middot; Tom"
// sample line). Deterministic and side-effect-free so the History render stays unit-testable.
export function relTime(iso: string, now: number): string {
	const t = Date.parse(iso);
	if (!isFinite(t)) { return ''; }
	const s = Math.max(0, Math.round((now - t) / 1000));
	if (s < 60) { return 'moments ago'; }
	const m = Math.round(s / 60);
	if (m < 60) { return `${m}m ago`; }
	const h = Math.round(m / 60);
	if (h < 24) { return `${h}h ago`; }
	const d = Math.round(h / 24);
	if (d < 7) { return `${d}d ago`; }
	return new Date(t).toISOString().slice(0, 10);
}

// The via glyph + human label for a snapshot's provenance (D26-B): what caused this version.
const SNAPSHOT_VIA: Record<SnapshotVia, { glyph: string; label: string }> = {
	refresh: { glyph: '&#10227;', label: 'Refresh' },
	'bulk-approve': { glyph: '&#10003;', label: 'Bulk approve' },
	publish: { glyph: '&#9733;', label: 'Published' },
	manual: { glyph: '&#9998;', label: 'Saved version' },
};

// A History timeline event: a saved version (restorable) or an audit change, unified on its timestamp so
// the two interleave newest-first and the changes read under the version they followed.
interface IHistoryEvent {
	readonly at: number;
	readonly html: (last: boolean) => string;
}

// The truthful History tab body: the live document title as header, a manual "Save version" affordance,
// then real snapshots interleaved with the real audit entries recorded since each - all from THIS
// document's lock. No fabricated v14/v13 sample; a calm one-line empty state when there is nothing yet.
// `now` is injected so the relative times are deterministic under test.
export function historyHtml(snapshots: readonly ISnapshotEntry[], audit: readonly IAuditEntry[], docTitle?: string, fromTemplate?: string, now: number = Date.now()): string {
	const dot = (color: string) => `<span style="width:10px;height:10px;border-radius:50%;background:${color}"></span>`;
	const headText = docTitle ? esc(docTitle).toUpperCase() : 'VERSION HISTORY';
	const label = `<div style="font:600 10px/1 'JetBrains Mono',ui-monospace,monospace;letter-spacing:.08em;color:#a3a8b2;padding:0 2px">${docTitle ? `VERSION HISTORY &middot; ${headText}` : 'VERSION HISTORY'}</div>`;
	// The manual "Save version" entry point (D26-B): only offered while a living document is open so the
	// action always has a body to snapshot. Routes through saveSnapshot(..., 'manual').
	const saveBtn = docTitle
		? `<button data-save-version style="border:1px solid #e0e2e8;border-radius:7px;padding:5px 9px;background:#fff;color:#52575f;font:600 10.5px/1 system-ui;cursor:pointer">&#9998; Save version</button>`
		: '';
	const head = `<div style="display:flex;align-items:center;gap:8px;padding:0 2px 16px">${label}<span style="flex:1"></span>${saveBtn}</div>`;

	// No document open: a calm, honest prompt rather than a fabricated timeline.
	if (!docTitle) {
		return head + `<div style="font:400 12.5px/1.6 system-ui;color:#a3a8b2;padding:8px 2px">Open a Living Document to see its version history.</div>`;
	}

	const restoreBtn = (id: string) =>
		`<button data-restore="${esc(id)}" title="Restore this version" style="margin-left:auto;border:1px solid #e0e2e8;border-radius:6px;padding:3px 8px;background:#fff;color:#52575f;font:500 10px/1 system-ui;cursor:pointer">Restore</button>`;
	const currentBadge = `<span style="font:600 9px/1 'JetBrains Mono',ui-monospace,monospace;color:#1f7a44;background:#e7f6ec;border-radius:999px;padding:3px 6px">CURRENT</span>`;
	const snapshotBadge = `<span style="font:500 9px/1 'JetBrains Mono',ui-monospace,monospace;color:#9a6b16;background:#fdf2dc;border-radius:999px;padding:3px 6px">SNAPSHOT</span>`;

	// A version row (restorable snapshot): via glyph + label as the title, an amber SNAPSHOT badge for a
	// pinned/published milestone, the relative time as meta, and a quiet Restore action.
	const events: IHistoryEvent[] = [];
	for (const s of snapshots) {
		const via = SNAPSHOT_VIA[s.via];
		const title = `<span style="color:oklch(0.55 0.13 255);font-size:12px">${via.glyph}</span> ${esc(s.label)}`;
		const badge = s.via === 'publish' ? snapshotBadge : '';
		const glyph = s.via === 'publish'
			? `<span style="font-size:12px;color:oklch(0.66 0.16 45)">&#9733;</span>`
			: dot('#cfd3da');
		events.push({ at: Date.parse(s.at) || 0, html: last => timelineRow(glyph, title, badge, `${via.label}`, relTime(s.at, now), last, restoreBtn(s.id)) });
	}
	// A change row (audit entry): the verb + block, the via + relative time. Not restorable on its own.
	for (const e of audit) {
		const verb = e.action === 'rejected' ? 'Rejected' : e.action === 'approved' ? (e.via === 'restore' ? 'Restored' : 'Approved') : 'Auto-applied';
		events.push({ at: Date.parse(e.time) || 0, html: last => timelineRow(dot('#e0e3ea'), verb, '', `${esc(e.docTitle)} / ${esc(e.blockId)}`, `${esc(e.via)} &middot; ${relTime(e.time, now)}`, last) });
	}

	// A real origin row for a template-generated document (plan 28, iter 3): the oldest row, at the base of
	// the timeline, driven by the document's own `fromTemplate` provenance.
	const originHtml = fromTemplate
		? (last: boolean) => timelineRow(`<span style="font-size:12px;color:oklch(0.66 0.16 45)">&#9733;</span>`, `Created from ${esc(fromTemplate)} template`, `<span style="font:500 9px/1 'JetBrains Mono',ui-monospace,monospace;color:#9a6b16;background:#fdf2dc;border-radius:999px;padding:3px 6px">FROM TEMPLATE</span>`, 'This document was generated from a template.', `${esc(fromTemplate)}.template.md`, last)
		: undefined;

	// Nothing recorded yet: one calm line, no fabricated versions.
	if (!events.length && !originHtml) {
		return head + `<div style="font:400 12.5px/1.6 system-ui;color:#a3a8b2;padding:8px 2px">No versions yet - changes you approve will appear here.</div>`;
	}

	// Newest first; the top row is the live state, so it carries the CURRENT badge.
	events.sort((a, b) => b.at - a.at);

	// Cap the display at the 20 most recent rows (the lock keeps the full record); a mono line names the
	// remainder rather than silently truncating.
	const CAP = 20;
	const shown = events.slice(0, CAP);
	const hidden = events.length - shown.length;

	const rows: string[] = [];
	// The current live state marker sits above the recorded versions/changes (CURRENT badge, no Restore).
	rows.push(timelineRow(dot('oklch(0.55 0.13 255)'), 'Current version', currentBadge, 'The document as it is right now.', 'live', false));
	shown.forEach((ev, i) => {
		const last = i === shown.length - 1 && hidden === 0 && !originHtml;
		rows.push(ev.html(last));
	});
	if (hidden > 0) {
		rows.push(`<div style="font:400 11px/1 'JetBrains Mono',ui-monospace,monospace;color:#bcc0c8;padding:2px 2px 16px 31px">${hidden} earlier ${hidden === 1 ? 'entry' : 'entries'}</div>`);
	}
	if (originHtml) { rows.push(originHtml(true)); }
	return head + rows.join('');
}
