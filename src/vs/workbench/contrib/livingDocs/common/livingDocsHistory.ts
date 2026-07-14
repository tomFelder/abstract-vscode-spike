/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IAuditEntry, ISnapshotEntry } from './livingDocsModel.js';

// The History timeline's merge/dedupe/ordering, kept as a pure, DOM-free module so it stays
// unit-testable and the browser `historyRender` layer is a thin HTML mapper over the model it returns.
//
// F19 (issue #121): the timeline must rehydrate from the persisted lock `audit[]` (+ snapshots) on a
// cold open, not only from entries appended in-session. The lock is the single source of truth for both
// (loaded from `<doc>.lock.json` on open, mutated + persisted on approve), so a re-read after a reload
// yields the same entries. Because the same logical change can be recorded more than once across a
// merge (a re-read that overlaps an in-session append, a lock hand-edit, a legacy double-write), the
// model dedupes by a stable identity so no entry ever renders twice, and orders newest-first
// deterministically so the cold-open timeline matches the in-session one.

// A single History event: a restorable saved version, or an audit change. `at` is the parsed epoch of
// the event's ISO timestamp (0 when unparseable) so ordering never throws on a corrupt lock.
export type IHistoryEvent =
	| { readonly kind: 'version'; readonly at: number; readonly snapshot: ISnapshotEntry }
	| { readonly kind: 'change'; readonly at: number; readonly entry: IAuditEntry };

// A stable identity for an audit entry: two entries with the same timestamp, block, action, provenance
// and text are the same recorded change. JSON-encoding the tuple keeps the boundary unambiguous (an
// internal quote or separator in any field is escaped, so no value can bleed across to forge a collision).
export function auditKey(e: IAuditEntry): string {
	return JSON.stringify([e.time, e.blockId, e.action, e.via, e.oldText, e.newText]);
}

// Drop duplicate audit entries, keeping the first occurrence (stable). Used when the persisted `audit[]`
// is merged with any in-session view of the same lock so a reload never doubles a change.
export function dedupeAudit(audit: readonly IAuditEntry[]): IAuditEntry[] {
	const seen = new Set<string>();
	const out: IAuditEntry[] = [];
	for (const e of audit) {
		const key = auditKey(e);
		if (seen.has(key)) { continue; }
		seen.add(key);
		out.push(e);
	}
	return out;
}

// Build the ordered, deduped History timeline from a document's persisted lock (its snapshots + audit).
// Newest-first; a version and a change that share a timestamp keep a deterministic order (versions before
// their follow-on changes), matching the in-session render so a cold open looks identical.
export function buildHistoryTimeline(snapshots: readonly ISnapshotEntry[], audit: readonly IAuditEntry[]): IHistoryEvent[] {
	const events: IHistoryEvent[] = [];
	for (const snapshot of snapshots) {
		events.push({ kind: 'version', at: Date.parse(snapshot.at) || 0, snapshot });
	}
	for (const entry of dedupeAudit(audit)) {
		events.push({ kind: 'change', at: Date.parse(entry.time) || 0, entry });
	}
	// Newest first. Equal timestamps fall back to insertion order (a stable sort keeps versions, pushed
	// first, above the changes recorded at the same instant) so the ordering is deterministic.
	events.sort((a, b) => b.at - a.at);
	return events;
}
