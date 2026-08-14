/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IAuditEntry, ISnapshotEntry, SnapshotVia } from '../common/livingDocsModel.js';
import { buildHistoryTimeline } from '../common/livingDocsHistory.js';
import { localize } from '../../../../nls.js';
import { AMBER, FONT, GREEN, HAIRLINE, INK, PAPER, RADIUS, RED, TRACKING, TYPE } from '../common/abstractTokens.js';

// The truthful History tab body (plan 26 iter 3), kept as a pure, side-effect-free render module (mirroring
// livingDocRender / treeRail) so it stays unit-testable without pulling in the ViewPane graph. It renders
// REAL snapshots (restorable versions) interleaved with the REAL audit entries recorded since each one - all
// from the active document's lock, never the fabricated v14/v13 sample.
//
// Round 2 of the redesign (doc 28) replaced the vertical timeline - dots joined by a 2px connector - with the
// design system's RECEIPT ROW: time, then what happened in plain words, then a state dot. The connector was
// drawing a shape ("a branching history") the data does not have; a receipt says the same true thing in one
// line, and it is the same atom Home's while-you-were-away and the agent run logs use, so the reading is
// learned once and reused everywhere.

function esc(s: string): string {
	return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * The four states a receipt row may report (doc 28, "State"): one dot, one meaning. Green is something that
 * landed cleanly, the frame border is a row with nothing to do, amber warns, red failed. A row that wants a
 * fifth colour is a row trying to say two things at once.
 */
type ReceiptState = 'clean' | 'idle' | 'warned' | 'failed';

const RECEIPT_DOT: Record<ReceiptState, string> = {
	clean: GREEN.base,
	idle: PAPER.frameBorder,
	warned: AMBER.base,
	failed: RED.base,
};

// One receipt row: a mono time stamp, the sentence, an optional trailing control, then the 7px state dot.
// Rows are divided by the SOFT hairline because they are lines within one record, not separate surfaces.
function receiptRow(time: string, sentence: string, state: ReceiptState, first: boolean, trailing = ''): string {
	return `<div style="display:flex;align-items:baseline;gap:10px;padding:9px 2px${first ? '' : `;border-top:1px solid ${HAIRLINE.soft}`}">`
		+ `<span style="flex:none;width:60px;font:400 11px/1.5 ${FONT.mono};color:${INK.meta}">${time}</span>`
		+ `<span style="flex:1;min-width:0;font:${TYPE.secondary};color:${INK.body}">${sentence}</span>`
		+ trailing
		+ `<span style="flex:none;width:7px;height:7px;border-radius:${RADIUS.pill};background:${RECEIPT_DOT[state]}"></span></div>`;
}

// The muted tail of a receipt sentence: the facts that qualify what happened (which block, by what route)
// without competing with the verb that opens the line.
function tail(text: string): string {
	return `<span style="color:${INK.meta}"> &middot; ${text}</span>`;
}

// A kind badge (doc 28): mono, tracked, coloured by meaning - never a filled pill, which would read as a
// permanent status chip. Used for CURRENT / SNAPSHOT / FROM TEMPLATE.
function kindBadge(label: string, colour: string): string {
	return `<span style="margin-left:6px;font:400 10.5px/1 ${FONT.mono};letter-spacing:${TRACKING.kindBadge};color:${colour}">${label}</span>`;
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
	const headText = docTitle ? esc(docTitle).toUpperCase() : 'VERSION HISTORY';
	const label = `<div style="font:400 11px/1 ${FONT.mono};letter-spacing:${TRACKING.sectionLabel};color:${INK.meta};padding:0 2px">${docTitle ? `VERSION HISTORY &middot; ${headText}` : 'VERSION HISTORY'}</div>`;
	// The manual "Save version" entry point (D26-B): offered while ANY document is open (living or plain
	// Markdown). saveSnapshot writes the body to the `<doc>.lock.json` regardless of `isLiving`, so a plain
	// document can pin versions too (issue #181); the action always has a body to snapshot.
	const saveBtn = docTitle
		? `<button data-save-version style="border:1px solid ${PAPER.control};border-radius:${RADIUS.control};padding:6px 10px;background:${PAPER.card};color:${INK.body};font:600 12.5px/1 ${FONT.sans};cursor:pointer">&#9998; Save version</button>`
		: '';
	const head = `<div style="display:flex;align-items:center;gap:8px;padding:0 2px 14px">${label}<span style="flex:1"></span>${saveBtn}</div>`;

	// No document open: a calm, honest prompt rather than a fabricated timeline. Versions apply to any open
	// document, not only Living Documents, so the prompt says "a document" (issue #181).
	if (!docTitle) {
		return head + `<div style="font:${TYPE.secondary};color:${INK.meta};padding:8px 2px">Open a document to see its version history.</div>`;
	}

	const restoreBtn = (id: string) =>
		`<button data-restore="${esc(id)}" title="Restore this version" style="flex:none;border:1px solid ${PAPER.control};border-radius:${RADIUS.control};padding:4px 10px;background:${PAPER.card};color:${INK.body};font:600 12.5px/1 ${FONT.sans};cursor:pointer">Restore</button>`;

	// The ordered, deduped timeline model (F19): snapshots interleaved with the audit changes, newest
	// first, read from THIS document's lock - identical whether the entries were rehydrated from the
	// on-disk `<doc>.lock.json` on a cold open or appended in-session. Each model event maps to one row.
	const rowFns = buildHistoryTimeline(snapshots, audit).map(ev => {
		if (ev.kind === 'version') {
			// A version row (restorable snapshot): the label as the sentence, the cause as its muted tail, a
			// SNAPSHOT badge for a pinned/published milestone, and a quiet Restore beside the state dot.
			const s = ev.snapshot;
			const via = SNAPSHOT_VIA[s.via];
			// A published snapshot names the real pins it froze (plan 32 iter 4), replacing the comp mock. Only
			// shown when a real count was recorded; a 0-pin publish reads "no sources to pin" truthfully.
			const cause = s.via === 'publish' && typeof s.pinnedSources === 'number'
				? (s.pinnedSources > 0 ? `${via.label} &middot; pinned ${s.pinnedSources} source version${s.pinnedSources === 1 ? '' : 's'}` : `${via.label} &middot; no sources to pin`)
				: via.label;
			const sentence = `<span style="color:${INK.meta}">${via.glyph}</span> ${esc(s.label)}${s.via === 'publish' ? kindBadge('SNAPSHOT', AMBER.label) : ''}${tail(cause)}`;
			// A publish is a thing that LANDED (it froze a version and its pins); every other snapshot is simply
			// a resting point on the record, with nothing outstanding on it.
			return (first: boolean) => receiptRow(relTime(s.at, now), sentence, s.via === 'publish' ? 'clean' : 'idle', first, restoreBtn(s.id));
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
		const flaggedBadge = `<span title="${esc(localize('livingDocs.history.flagged.title', "You flagged this applied change as wrong"))}" style="flex:none;font:400 10.5px/1 ${FONT.mono};letter-spacing:${TRACKING.kindBadge};color:${RED.base}">${esc(localize('livingDocs.history.flagged.label', "Flagged Wrong"))}</span>`;
		const wrongBtn = isApplied
			? (e.wrong
				? flaggedBadge
				: `<button data-wrong="${esc(JSON.stringify({ ref: e.time, title: e.docTitle }))}" title="${esc(localize('livingDocs.history.flagWrong.title', "Flag this applied change as wrong"))}" style="flex:none;border:1px solid ${PAPER.control};border-radius:${RADIUS.control};padding:4px 10px;background:${PAPER.card};color:${INK.secondary};font:400 12.5px/1 ${FONT.sans};cursor:pointer">${esc(localize('livingDocs.history.flagWrong.label', "This Was Wrong"))}</button>`)
			: '';
		// Surface the persisted note beneath the row: a rejection's optional reason (1f frame-3) or a flag's
		// comment, so the trail reads why - not just what. Both are plain reviewer words kept local on the lock.
		const note = e.action === 'rejected' ? e.reason : e.wrong?.comment;
		const noteHtml = note
			? `<div style="margin-top:4px;font:400 12px/1.45 ${FONT.sans};color:${INK.secondary}">&ldquo;${esc(note)}&rdquo;</div>`
			: '';
		const sentence = `${verb}${tail(`${esc(e.docTitle)} / ${esc(e.blockId)} &middot; ${esc(e.via)}`)}${noteHtml}`;
		// The dot reports what became of the change: a flagged row failed the reader, a kept-your-version row is
		// a conflict that warned, a rejection left nothing to do, and anything else landed cleanly.
		const state: ReceiptState = e.wrong ? 'failed' : e.action === 'external-overwrite-kept' ? 'warned' : e.action === 'rejected' ? 'idle' : 'clean';
		return (first: boolean) => receiptRow(relTime(e.time, now), sentence, state, first, wrongBtn);
	});

	// A real origin row for a template-generated document (plan 28, iter 3): the oldest row, at the base of
	// the timeline, driven by the document's own `fromTemplate` provenance. The template file name is a
	// provenance fact, so it is set in mono.
	const originHtml = fromTemplate
		? (first: boolean) => receiptRow(
			'origin',
			`Created from ${esc(fromTemplate)} template${kindBadge('FROM TEMPLATE', AMBER.label)}`
			+ tail(`<span style="font-family:${FONT.mono}">${esc(fromTemplate)}.template.md</span>`),
			'idle',
			first,
		)
		: undefined;

	// Nothing recorded yet: one calm line, no fabricated versions.
	if (!rowFns.length && !originHtml) {
		return head + `<div style="font:${TYPE.secondary};color:${INK.meta};padding:8px 2px">No versions yet - changes you approve will appear here.</div>`;
	}

	// Cap the display at the 20 most recent rows (the lock keeps the full record); a mono line names the
	// remainder rather than silently truncating.
	const CAP = 20;
	const shown = rowFns.slice(0, CAP);
	const hidden = rowFns.length - shown.length;

	const rows: string[] = [];
	// The current live state marker sits above the recorded versions/changes (CURRENT badge, no Restore).
	rows.push(receiptRow('live', `Current version${kindBadge('CURRENT', GREEN.base)}${tail('the document as it is right now')}`, 'clean', true));
	shown.forEach(rowFn => rows.push(rowFn(false)));
	if (hidden > 0) {
		rows.push(`<div style="font:400 11px/1 ${FONT.mono};color:${INK.meta};border-top:1px solid ${HAIRLINE.soft};padding:11px 2px 0">${hidden} earlier ${hidden === 1 ? 'entry' : 'entries'}</div>`);
	}
	if (originHtml) { rows.push(originHtml(false)); }
	return head + rows.join('');
}
