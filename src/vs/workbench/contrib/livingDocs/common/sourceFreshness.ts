/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// The ONE source-freshness vocabulary (#122 F12, plan 49-a). Every surface that shows whether a source is
// still trustworthy - the Knowledge table + drawer, the figure hover-peek, the tree SOURCES meta and the
// Context tab - reads its dot colour, its text colour and its label from THIS module, so the words never
// drift between surfaces. Freshness is the engine's existing hash-drift boolean (never a new time
// threshold): warn-never-auto-fix stays intact; the "Nd" in a stale label is only how long the stale data
// has sat, computed from an INJECTABLE clock so relative times are testable (never `Date.now()` in a render
// path). See the F12 inventory comment on issue #239 for the surface-by-surface mapping.

// The three source states the whole product speaks in. A fourth display state is never invented (the same
// discipline as the three-tier trust grammar).
export const enum SourceFreshness {
	/** The source still matches every dependent lock's hash and feeds at least one value binding. */
	Fresh = 'fresh',
	/** A dependent binding's hash has drifted since the last sync - warn, never auto-fix. */
	Stale = 'stale',
	/** The source is influence/context only (no value bindings), so freshness is not a trust question. */
	ContextOnly = 'context-only',
}

// The palette F12 speaks in (exact hexes from the mock's Knowledge frame). One place, so a colour change is
// a one-line edit that lands on every surface at once.
export const FRESHNESS_COLOURS = {
	freshDot: '#2C8159',
	freshText: '#2C8159',
	staleDot: '#C99A2E',
	staleText: '#8A6D1A',
	/** The cream a stale table row is painted (K2.3). */
	staleRowBg: '#FDFAF2',
	contextDot: '#D5D8DE',
	contextText: '#868B95',
} as const;

/**
 * Classify a source into one of the three freshness states from the two facts every surface already has:
 * whether its hash still matches (`fresh`) and whether it is used only as context. A source marked
 * "as expected" by the user (K3.1) is calmed to context-grey honestly - the staleness is acknowledged, so
 * it no longer reads as an unresolved warning.
 */
export function sourceFreshness(opts: { readonly fresh: boolean; readonly contextOnly: boolean; readonly markedExpected?: boolean }): SourceFreshness {
	if (opts.markedExpected) { return SourceFreshness.ContextOnly; }
	if (!opts.fresh) { return SourceFreshness.Stale; }
	if (opts.contextOnly) { return SourceFreshness.ContextOnly; }
	return SourceFreshness.Fresh;
}

// A remote (api/mcp) source the app could not READ at all this pass - the proxy was down, the host was in
// cooldown, the MCP server never answered - has no current reading whatsoever. That is not a fourth state:
// it is presented in the STALE family (the same amber dot and stale text colour every other surface uses)
// carrying these plain words, so its last-known value is never dressed up as current (the staleness-escape
// guardrail, docs/20 journey 1p). The marker is the amber label; the line is the plain-words explanation that
// sits under it on both the figure hover-peek and the source drawer.
export const UNREACHABLE_SOURCE_MARKER = 'Stale · source unreachable';
export const UNREACHABLE_SOURCE_LINE = 'Live value unavailable - showing the last synced value';

/**
 * The label + plain-words line + stale-family colours a surface renders for a source it could not reach.
 * Deliberately NOT a `SourceFreshness` case: the vocabulary stays at three states, and an unreachable source
 * borrows the stale presentation rather than inventing a fourth colour.
 */
export function unreachableSourceLabel(): { readonly label: string; readonly line: string; readonly dot: string; readonly text: string } {
	return { label: UNREACHABLE_SOURCE_MARKER, line: UNREACHABLE_SOURCE_LINE, dot: FRESHNESS_COLOURS.staleDot, text: FRESHNESS_COLOURS.staleText };
}

/**
 * The short relative-time form the compact SYNC surfaces use ("2m ago" / "1h ago" / "3d ago"), agreeing on
 * the same thresholds as the long-form `relativeSyncedLabel` prose. `now` is injectable so the render is
 * deterministic under a fake clock (never `Date.now()` inline). Undefined/unparseable = never synced.
 */
export function relativeSyncedShort(iso: string | undefined, now: number): string {
	if (!iso) { return 'not yet synced'; }
	const t = Date.parse(iso);
	if (Number.isNaN(t)) { return 'not yet synced'; }
	const s = Math.max(0, Math.floor((now - t) / 1000));
	if (s < 60) { return 'just now'; }
	const m = Math.floor(s / 60);
	if (m < 60) { return `${m}m ago`; }
	const h = Math.floor(m / 60);
	if (h < 24) { return `${h}h ago`; }
	const d = Math.floor(h / 24);
	return `${d}d ago`;
}

/** Whole days since `iso` (min 1), for the stale label's "Nd" tail; 0 when sub-day (the caller shows hours). */
function staleDays(iso: string | undefined, now: number): number {
	if (!iso) { return 0; }
	const t = Date.parse(iso);
	if (Number.isNaN(t)) { return 0; }
	return Math.floor(Math.max(0, now - t) / 86400000);
}

/** Whole hours since `iso` (min 0), for a sub-day stale label ("stale · Nh"). */
function staleHours(iso: string | undefined, now: number): number {
	if (!iso) { return 0; }
	const t = Date.parse(iso);
	if (Number.isNaN(t)) { return 0; }
	return Math.floor(Math.max(0, now - t) / 3600000);
}

/**
 * The label + colours a SYNC surface renders for a source, from its state and its last-sync time. The stale
 * label reports how long the stale data has sat ("stale · 9d", or "stale · 4h" when sub-day) so a stale
 * source never reads as freshly synced; fresh reports the short relative time; context-only is a fixed word.
 */
export function freshnessLabel(state: SourceFreshness, syncedAt: string | undefined, now: number): { readonly label: string; readonly dot: string; readonly text: string } {
	switch (state) {
		case SourceFreshness.Stale: {
			const days = staleDays(syncedAt, now);
			const tail = days >= 1 ? `${days}d` : `${staleHours(syncedAt, now)}h`;
			return { label: `stale · ${tail}`, dot: FRESHNESS_COLOURS.staleDot, text: FRESHNESS_COLOURS.staleText };
		}
		case SourceFreshness.ContextOnly:
			return { label: 'context only', dot: FRESHNESS_COLOURS.contextDot, text: FRESHNESS_COLOURS.contextText };
		case SourceFreshness.Fresh:
		default:
			return { label: relativeSyncedShort(syncedAt, now), dot: FRESHNESS_COLOURS.freshDot, text: FRESHNESS_COLOURS.freshText };
	}
}
