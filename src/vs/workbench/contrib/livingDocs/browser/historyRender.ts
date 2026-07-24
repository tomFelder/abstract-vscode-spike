/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IAuditEntry, ISnapshotEntry, SnapshotVia } from '../common/livingDocsModel.js';
import { buildHistoryTimeline } from '../common/livingDocsHistory.js';
import { localize } from '../../../../nls.js';

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

// The truthful History tab body: the live document title as header, a manual "Save version" affordance,
// then real snapshots interleaved with the real audit entries recorded since each - all from THIS
// document's lock. No fabricated v14/v13 sample; a calm one-line empty state when there is nothing yet.
// `now` is injected so the relative times are deterministic under test.
export function historyHtml(snapshots: readonly ISnapshotEntry[], audit: readonly IAuditEntry[], docTitle?: string, fromTemplate?: string, now: number = Date.now()): string {
	const dot = (color: string) => `<span style="width:10px;height:10px;border-radius:50%;background:${color}"></span>`;
	const headText = docTitle ? esc(docTitle).toUpperCase() : 'VERSION HISTORY';
	const label = `<div style="font:600 10px/1 'JetBrains Mono',ui-monospace,monospace;letter-spacing:.08em;color:#a3a8b2;padding:0 2px">${docTitle ? `VERSION HISTORY &middot; ${headText}` : 'VERSION HISTORY'}</div>`;
	// The manual "Save version" entry point (D26-B): offered while ANY document is open (living or plain
	// Markdown). saveSnapshot writes the body to the `<doc>.lock.json` regardless of `isLiving`, so a plain
	// document can pin versions too (issue #181); the action always has a body to snapshot.
	const saveBtn = docTitle
		? `<button data-save-version style="border:1px solid #e0e2e8;border-radius:7px;padding:5px 9px;background:#fff;color:#52575f;font:600 10.5px/1 system-ui;cursor:pointer">&#9998; Save version</button>`
		: '';
	const head = `<div style="display:flex;align-items:center;gap:8px;padding:0 2px 16px">${label}<span style="flex:1"></span>${saveBtn}</div>`;

	// No document open: a calm, honest prompt rather than a fabricated timeline. Versions apply to any open
	// document, not only Living Documents, so the prompt says "a document" (issue #181).
	if (!docTitle) {
		return head + `<div style="font:400 12.5px/1.6 system-ui;color:#a3a8b2;padding:8px 2px">Open a document to see its version history.</div>`;
	}

	const restoreBtn = (id: string) =>
		`<button data-restore="${esc(id)}" title="Restore this version" style="margin-left:auto;border:1px solid #e0e2e8;border-radius:6px;padding:3px 8px;background:#fff;color:#52575f;font:500 10px/1 system-ui;cursor:pointer">Restore</button>`;
	const currentBadge = `<span style="font:600 9px/1 'JetBrains Mono',ui-monospace,monospace;color:#1f7a44;background:#e7f6ec;border-radius:999px;padding:3px 6px">CURRENT</span>`;
	const snapshotBadge = `<span style="font:500 9px/1 'JetBrains Mono',ui-monospace,monospace;color:#9a6b16;background:#fdf2dc;border-radius:999px;padding:3px 6px">SNAPSHOT</span>`;

	// The ordered, deduped timeline model (F19): snapshots interleaved with the audit changes, newest
	// first, read from THIS document's lock - identical whether the entries were rehydrated from the
	// on-disk `<doc>.lock.json` on a cold open or appended in-session. Each model event maps to one row.
	const rowFns = buildHistoryTimeline(snapshots, audit).map(ev => {
		if (ev.kind === 'version') {
			// A version row (restorable snapshot): via glyph + label as the title, an amber SNAPSHOT badge for
			// a pinned/published milestone, the relative time as meta, and a quiet Restore action.
			const s = ev.snapshot;
			const via = SNAPSHOT_VIA[s.via];
			const title = `<span style="color:oklch(0.55 0.13 255);font-size:12px">${via.glyph}</span> ${esc(s.label)}`;
			const badge = s.via === 'publish' ? snapshotBadge : '';
			const glyph = s.via === 'publish'
				? `<span style="font-size:12px;color:oklch(0.66 0.16 45)">&#9733;</span>`
				: dot('#cfd3da');
			// A published snapshot names the real pins it froze (plan 32 iter 4), replacing the comp mock. Only
			// shown when a real count was recorded; a 0-pin publish reads "no sources to pin" truthfully.
			const body = s.via === 'publish' && typeof s.pinnedSources === 'number'
				? (s.pinnedSources > 0 ? `${via.label} &middot; pinned ${s.pinnedSources} source version${s.pinnedSources === 1 ? '' : 's'}` : `${via.label} &middot; no sources to pin`)
				: `${via.label}`;
			return (last: boolean) => timelineRow(glyph, title, badge, body, relTime(s.at, now), last, restoreBtn(s.id));
		}
		// A change row (audit entry): the verb + block, the via + relative time. Not restorable on its own.
		const e = ev.entry;
		const verb = e.action === 'rejected' ? 'Rejected' : e.action === 'external-overwrite-kept' ? 'Kept your version' : e.action === 'approved' ? (e.via === 'restore' ? 'Restored' : 'Approved') : 'Auto-applied';
		// The feedback verb (doc 18 section 2.5): "this was wrong" on any APPLIED change (approved or
		// auto-applied, not a rejection or a restore). Once flagged (persisted on the row as `wrong`, issue #258)
		// the row reads as flagged instead of offering an infinitely re-flaggable button. The change ref is the
		// row's own ISO time - a stable, unique key so the flag lands on THIS row after relaunch. The reviewRail
		// turns an unflagged click into a persisted flag + optional comment, logged for the founder + counted.
		const isApplied = e.action !== 'rejected' && e.action !== 'external-overwrite-kept' && e.via !== 'restore';
		const flaggedBadge = `<span title="${esc(localize('livingDocs.history.flagged.title', "You flagged this applied change as wrong"))}" style="margin-left:auto;border:1px solid #eeced0;border-radius:6px;padding:3px 8px;background:#fdf1f0;color:#b4332f;font:600 10px/1 system-ui">${esc(localize('livingDocs.history.flagged.label', "Flagged Wrong"))}</span>`;
		const wrongBtn = isApplied
			? (e.wrong
				? flaggedBadge
				: `<button data-wrong="${esc(JSON.stringify({ ref: e.time, title: e.docTitle }))}" title="${esc(localize('livingDocs.history.flagWrong.title', "Flag this applied change as wrong"))}" style="margin-left:auto;border:1px solid #eeced0;border-radius:6px;padding:3px 8px;background:#fff;color:#b4332f;font:500 10px/1 system-ui;cursor:pointer">${esc(localize('livingDocs.history.flagWrong.label', "This Was Wrong"))}</button>`)
			: '';
		// Surface the persisted note beneath the row: a rejection's optional reason (1f frame-3) or a flag's
		// comment, so the trail reads why - not just what. Both are plain reviewer words kept local on the lock.
		const note = e.action === 'rejected' ? e.reason : e.wrong?.comment;
		const body = note
			? `${esc(e.docTitle)} / ${esc(e.blockId)}<div style="margin-top:4px;font:400 11.5px/1.4 system-ui;color:#8a6d6b">&ldquo;${esc(note)}&rdquo;</div>`
			: `${esc(e.docTitle)} / ${esc(e.blockId)}`;
		return (last: boolean) => timelineRow(dot('#e0e3ea'), verb, '', body, `${esc(e.via)} &middot; ${relTime(e.time, now)}`, last, wrongBtn);
	});

	// A real origin row for a template-generated document (plan 28, iter 3): the oldest row, at the base of
	// the timeline, driven by the document's own `fromTemplate` provenance.
	const originHtml = fromTemplate
		? (last: boolean) => timelineRow(`<span style="font-size:12px;color:oklch(0.66 0.16 45)">&#9733;</span>`, `Created from ${esc(fromTemplate)} template`, `<span style="font:500 9px/1 'JetBrains Mono',ui-monospace,monospace;color:#9a6b16;background:#fdf2dc;border-radius:999px;padding:3px 6px">FROM TEMPLATE</span>`, 'This document was generated from a template.', `${esc(fromTemplate)}.template.md`, last)
		: undefined;

	// Nothing recorded yet: one calm line, no fabricated versions.
	if (!rowFns.length && !originHtml) {
		return head + `<div style="font:400 12.5px/1.6 system-ui;color:#a3a8b2;padding:8px 2px">No versions yet - changes you approve will appear here.</div>`;
	}

	// Cap the display at the 20 most recent rows (the lock keeps the full record); a mono line names the
	// remainder rather than silently truncating.
	const CAP = 20;
	const shown = rowFns.slice(0, CAP);
	const hidden = rowFns.length - shown.length;

	const rows: string[] = [];
	// The current live state marker sits above the recorded versions/changes (CURRENT badge, no Restore).
	rows.push(timelineRow(dot('oklch(0.55 0.13 255)'), 'Current version', currentBadge, 'The document as it is right now.', 'live', false));
	shown.forEach((rowFn, i) => {
		const last = i === shown.length - 1 && hidden === 0 && !originHtml;
		rows.push(rowFn(last));
	});
	if (hidden > 0) {
		rows.push(`<div style="font:400 11px/1 'JetBrains Mono',ui-monospace,monospace;color:#bcc0c8;padding:2px 2px 16px 31px">${hidden} earlier ${hidden === 1 ? 'entry' : 'entries'}</div>`);
	}
	if (originHtml) { rows.push(originHtml(true)); }
	return head + rows.join('');
}
