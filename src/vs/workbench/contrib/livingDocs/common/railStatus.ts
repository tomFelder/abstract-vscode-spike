/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../nls.js';
import { IAuditEntry, SourceKind } from './livingDocsModel.js';

// The PURE status-dot contract for the Files rail (issue #212). Every Files-rail row prefixes a small,
// meaningful status indicator instead of the old 13px blue glyph; this module decides that dot from cheap
// facts the view/service gather, with no DOM, no service, and no wall clock - so the precedence ladder and
// the since-last-looked comparison are unit-tested directly. The DOM view (`treeRailView.ts`) owns only the
// colour->CSS-class mapping and the IHoverService tooltip wiring; every semantic decision lives here.

/** The visual shape of a rail status indicator: a filled dot (documents) or a muted dash (source/extra rows). */
export type RailDotShape = 'dot' | 'dash';

/**
 * The colour band of a document's status dot, in precedence order. `grey` is the calm resting state ("nothing
 * to report"); the coloured bands appear only where an action or a change exists, so the rail stays a quiet
 * column of grey with colour only where it earns it (the quiet-shell L4 rule).
 */
export type RailDotColor = 'grey' | 'green' | 'yellow' | 'red';

/** A resolved rail status indicator: its shape, its colour band, and the plain-words hover tooltip. */
export interface IRailDot {
	readonly shape: RailDotShape;
	readonly color: RailDotColor;
	/** The plain-words hover reason + count, localized, e.g. "3 changes waiting for approval". */
	readonly tooltip: string;
}

/**
 * The facts a document's status dot reads (issue #212). All are cheap projections the service already computes
 * for the rail: the pending-review count, the count of agent auto-applies the user has not yet seen (computed by
 * {@link countUnseenAgentEdits}), and the three "needs input" red signals - a relink-flagged change, a stale
 * binding/context drift, or a fan-out run that failed for this document.
 */
export interface IDocDotInput {
	/** Pending meaning-changes waiting for approval (mirrors the Review rail count) -> the yellow band. */
	readonly pendingCount: number;
	/** Agent auto-applies newer than the user's last-viewed anchor for this doc -> the green band. */
	readonly unseenAgentEdits: number;
	/** Relink-flagged changes for this document (the claim anchor no longer confidently matches) -> red. */
	readonly relinkCount: number;
	/** True when a binding/context source has drifted since last sync/review (`getFreshness().dirty`) -> red. */
	readonly stale: boolean;
	/** True when a whole-project fan-out run failed to reach the model for this document -> red. */
	readonly fanoutFailed: boolean;
}

/**
 * Decide a document row's status dot (issue #212). Precedence, strictly red > yellow > green > grey:
 *
 * 1. RED - the document needs the user's input: a relink-flagged change, a stale binding/context drift, or a
 *    fan-out run that failed for it. Red wins even when changes are also waiting for approval (yellow).
 * 2. YELLOW - changes are waiting for approval (`pendingCount > 0`). The user has something to review.
 * 3. GREEN - the agent applied changes since the user last looked (`unseenAgentEdits > 0`). Clears when the user
 *    opens the document (the service stamps it seen, so the count drops to 0 on the next render).
 * 4. GREY - nothing to report. A plain document with no lock always lands here (the L3 earned-living rule: a
 *    plain doc is never red, never an error), because every red/yellow/green signal reads 0/false for it.
 *
 * The tooltip carries the winning band's plain-words reason + count. Counts are localized with `{0}` placeholders.
 */
export function docRailDot(input: IDocDotInput): IRailDot {
	// 1. RED: needs input. Relink is the loudest (a change the user must re-anchor); stale + fan-out failure
	// are the other two "the document needs you" signals. One red band, its tooltip named by the strongest cause.
	if (input.relinkCount > 0) {
		return { shape: 'dot', color: 'red', tooltip: relinkTooltip(input.relinkCount) };
	}
	if (input.fanoutFailed) {
		return { shape: 'dot', color: 'red', tooltip: localize("livingDocs.dot.fanoutFailed", "A run could not reach the model for this document") };
	}
	if (input.stale) {
		return { shape: 'dot', color: 'red', tooltip: localize("livingDocs.dot.stale", "A source changed - this document may be out of date") };
	}
	// 2. YELLOW: changes waiting for approval.
	if (input.pendingCount > 0) {
		return { shape: 'dot', color: 'yellow', tooltip: pendingTooltip(input.pendingCount) };
	}
	// 3. GREEN: agent-applied changes since the user last looked.
	if (input.unseenAgentEdits > 0) {
		return { shape: 'dot', color: 'green', tooltip: unseenTooltip(input.unseenAgentEdits) };
	}
	// 4. GREY: nothing to report (the calm resting state; a plain no-lock doc always lands here).
	return { shape: 'dot', color: 'grey', tooltip: localize("livingDocs.dot.nothing", "Nothing to report") };
}

function relinkTooltip(count: number): string {
	return count === 1
		? localize("livingDocs.dot.relink.one", "1 change needs re-linking")
		: localize("livingDocs.dot.relink.many", "{0} changes need re-linking", count);
}

function pendingTooltip(count: number): string {
	return count === 1
		? localize("livingDocs.dot.pending.one", "1 change waiting for approval")
		: localize("livingDocs.dot.pending.many", "{0} changes waiting for approval", count);
}

function unseenTooltip(count: number): string {
	return count === 1
		? localize("livingDocs.dot.unseen.one", "1 change applied since you last looked")
		: localize("livingDocs.dot.unseen.many", "{0} changes applied since you last looked", count);
}

/**
 * Decide a non-document row's status indicator (issue #212): a source (CSV/API/MCP) or a not-yet-imported extra.
 * These carry no change state, so they read a tiny muted grey dash; the kind/reason moves into the hover tooltip
 * so the rail stays calm. `note` (a not-yet-imported reason) wins the tooltip when present; otherwise the source
 * kind names it.
 */
export function sourceRailDot(kind: 'source' | 'unsupported', sourceKind?: SourceKind, note?: string): IRailDot {
	if (kind === 'unsupported') {
		return { shape: 'dash', color: 'grey', tooltip: note ?? localize("livingDocs.dot.notImported", "Not yet imported") };
	}
	const tooltip = sourceKind === 'api'
		? localize("livingDocs.dot.apiSource", "API source")
		: sourceKind === 'mcp'
			? localize("livingDocs.dot.mcpSource", "MCP source")
			: localize("livingDocs.dot.fileSource", "File source");
	return { shape: 'dash', color: 'grey', tooltip };
}

/**
 * Count the agent auto-applies the user has NOT yet seen for a document (issue #212, the green-band input). An
 * edit counts when it is an `auto-applied` audit entry, was NOT an audited override (`via: 'override'`, which is
 * the user's own past action, never a surprise), and its timestamp is strictly newer than the user's `lastViewedAt`
 * anchor. `approved` entries never count - the user saw that diff when approving it. An undefined anchor (the user
 * has never opened this document) counts every qualifying entry, so a colleague's agent edits are surfaced on first
 * sight. The comparison is a plain ISO-string compare (the audit times are ISO, monotonic per document).
 *
 * NOTE (accepted residual, issue #212): publish writes an `auto-applied` audit entry, so a document published while
 * another document was active can false-green until the user opens it. Accepted - the green then simply says "the
 * document changed since you last looked", which is still true; opening it clears the dot.
 */
export function countUnseenAgentEdits(audit: readonly IAuditEntry[], lastViewedAt: string | undefined): number {
	let count = 0;
	for (const entry of audit) {
		if (entry.action !== 'auto-applied') { continue; }
		if (entry.via === 'override') { continue; }
		// Strictly newer than the anchor: an entry at the exact anchor time was already seen (excluded). With no
		// anchor at all (never opened) every qualifying entry counts.
		if (lastViewedAt === undefined || entry.time > lastViewedAt) { count++; }
	}
	return count;
}
