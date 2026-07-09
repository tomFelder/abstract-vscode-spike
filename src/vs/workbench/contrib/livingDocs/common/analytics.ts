/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';

export const IAnalyticsService = createDecorator<IAnalyticsService>('analyticsService');

/**
 * The one seam between Abstract and its product-analytics tool (PostHog). The rest of the codebase
 * NEVER imports the analytics tool directly - it captures through this service so the tool can be
 * swapped and the whole no-consent state collapses to a single null-object ({@link NullAnalyticsService}).
 *
 * The privacy invariant (doc 15): document content never leaves the machine as analytics. Event
 * properties carry counts, kinds, durations, ids and booleans - never prose, never bound figures,
 * never file names beyond hashed/opaque ids. Every typed event's payload is checked against
 * {@link lintEventProps} before it is captured, so a property that smuggles free text or an over-long
 * value fails loudly rather than silently shipping content.
 */
export interface IAnalyticsService {
	readonly _serviceBrand: undefined;

	/** True once the user has made an explicit consent choice (either way) - drives whether the moment shows. */
	readonly hasChosen: boolean;

	/** True when the user consented to analytics. Capture is a no-op unless this is true. */
	readonly isEnabled: boolean;

	/**
	 * Record the user's consent choice. `true` enables capture (and identifies the stable anonymous id on
	 * first enable); `false` disables it entirely - not just replay, the whole capture path. Persisted so the
	 * moment is not shown again; revisitable from Settings.
	 */
	setConsent(enabled: boolean): void;

	/**
	 * Capture one typed product event. A no-op unless consent is enabled. The event name must be a member of
	 * {@link ANALYTICS_EVENTS}; the props are validated against that event's schema and the property-linter
	 * before anything leaves the machine. An event whose props fail the linter is dropped and logged - it is
	 * never sent, so a content leak cannot ship.
	 */
	capture(event: AnalyticsEventName, props?: AnalyticsProps): void;

	/**
	 * Tie the stable anonymous id to a known identity (email) - called ONLY at waitlist redemption, never at
	 * first run. A no-op unless consent is enabled.
	 */
	identify(email: string): void;
}

/** A single analytics property value. Deliberately narrow: no nested objects, no arrays of prose. */
export type AnalyticsPropValue = string | number | boolean | undefined;

/** The property bag for a captured event. Keys are the schema keys of the event; values are scalars. */
export type AnalyticsProps = Readonly<Record<string, AnalyticsPropValue>>;

/**
 * The kind of a schema property, which the linter enforces:
 * - `count`   - a non-negative integer (sizes, depths, latencies-in-ms).
 * - `flag`    - a boolean.
 * - `label`   - a short enumerated/controlled string (kinds, resolutions, formats, version strings). Bounded
 *               length; must NOT be free-form user prose. New labels are fine, unbounded prose is not.
 * - `hashed`  - an opaque id / hash (a document id, a "this was wrong" report id, a hashed path). Bounded
 *               length; must not contain path separators or spaces (a giveaway that a real path leaked).
 */
export type AnalyticsPropKind = 'count' | 'flag' | 'label' | 'hashed';

/** The maximum length of a `label` property. Longer than any legitimate enum value, shorter than any prose. */
export const LABEL_MAX_LENGTH = 64;

/** The maximum length of a `hashed` property (a uuid is 36; a sha-256 hex is 64). */
export const HASHED_MAX_LENGTH = 80;

/** One typed event's schema: the allowed property keys mapped to their kind. */
export type AnalyticsEventSchema = Readonly<Record<string, AnalyticsPropKind>>;

/**
 * The typed event dictionary (doc 15 §3.1). Every product event is registered here with a schema, whether
 * or not its surface exists yet - registering the name now keeps later plans from drifting the schema when
 * they wire the surface. Events whose surface exists today are emitted (iter 2); the rest are reserved.
 */
export const ANALYTICS_EVENTS = {
	// --- UI funnel events (emitted at their surfaces) ---
	app_opened: { version: 'label', first_open: 'flag' },
	project_opened: { doc_count: 'count', has_bindings: 'flag', is_first: 'flag' },
	provenance_peeked: { mode: 'label' },
	skill_invoked: { skill: 'label', thinking: 'flag', duration_ms: 'count' },
	all_clear_reached: { items_cleared: 'count', time_to_clear_ms: 'count' },
	export_or_publish: { format: 'label', provenance_mode: 'label', stale_sources_present: 'flag' },
	model_configured: { provider: 'label' },
	model_spend: { provider: 'label', cost_cents: 'count', daily_total_cents: 'count', cap_hit: 'flag' },

	// --- audit-mirror events (emitted once, at the audit layer) ---
	proposal_created: { source_kind: 'label', change_kind: 'label', confidence: 'label' },
	proposal_resolved: { resolution: 'label', latency_ms: 'count', bulk: 'flag' },
	run_started: { scope_size: 'count' },
	run_finished: { scope_size: 'count', cancelled: 'flag', failures: 'count', duration_ms: 'count' },
	source_synced: { kind: 'label', ok: 'flag', staleness_age_ms: 'count' },
	undo_after_approve: { depth: 'count' },

	// --- reserved: the surface does not exist yet (doc 15), registered so later plans emit without drift ---
	onboarding_step: { step: 'label' },
	this_was_wrong_reported: { ref_id: 'hashed' },
} as const satisfies Record<string, AnalyticsEventSchema>;

/** The union of every registered event name. New code can only capture a name that exists in the dictionary. */
export type AnalyticsEventName = keyof typeof ANALYTICS_EVENTS;

/**
 * A path-separator giveaway: an enum label or an opaque id never contains one, so its presence means a real
 * file path may have leaked. Covers the ASCII separators AND the common Unicode homoglyph slashes (fraction
 * slash U+2044, division slash U+2215, big solidus U+29F8, fullwidth solidus U+FF0F, fullwidth reverse solidus
 * U+FF3C) so a path dressed in look-alike separators cannot slip past the ASCII-only guard. Defence in depth:
 * the emitters only ever route bounded enums into label/hashed slots, but a future emitter mistake is caught here.
 */
const PATH_SEPARATOR = /[/\\⁄∕⧸／＼]/;

/** One property-linter finding: the offending key + a plain-words reason. */
export interface IAnalyticsLintError {
	readonly key: string;
	readonly reason: string;
}

/**
 * The privacy property-linter (doc 15's invariant made executable). Given an event name and its props, it
 * returns every property that violates its schema - an unknown key, a wrong scalar kind, an over-long value,
 * a `hashed` value that still looks like a path. The service refuses to send an event with any finding, and
 * the canary test drives this over every registered event so a new event that smuggles content fails the
 * build. Pure and dependency-free so it runs identically in the service and in the test.
 */
export function lintEventProps(event: AnalyticsEventName, props: AnalyticsProps): readonly IAnalyticsLintError[] {
	const schema = ANALYTICS_EVENTS[event] as AnalyticsEventSchema;
	const errors: IAnalyticsLintError[] = [];
	for (const key of Object.keys(props)) {
		const value = props[key];
		if (value === undefined) {
			continue; // an omitted optional property is fine.
		}
		const kind = schema[key];
		if (!kind) {
			errors.push({ key, reason: `not declared in the "${event}" schema` });
			continue;
		}
		switch (kind) {
			case 'flag':
				if (typeof value !== 'boolean') {
					errors.push({ key, reason: `must be a boolean flag, got ${typeof value}` });
				}
				break;
			case 'count':
				if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
					errors.push({ key, reason: 'must be a non-negative integer count' });
				}
				break;
			case 'label':
				if (typeof value !== 'string') {
					errors.push({ key, reason: `must be a short label string, got ${typeof value}` });
				} else if (value.length > LABEL_MAX_LENGTH) {
					errors.push({ key, reason: `label exceeds ${LABEL_MAX_LENGTH} chars - looks like free text, not an enum` });
				} else if (PATH_SEPARATOR.test(value)) {
					errors.push({ key, reason: 'label contains a path separator - an enum value never does, so a real path may have leaked' });
				}
				break;
			case 'hashed':
				if (typeof value !== 'string') {
					errors.push({ key, reason: `must be an opaque id string, got ${typeof value}` });
				} else if (value.length > HASHED_MAX_LENGTH) {
					errors.push({ key, reason: `id exceeds ${HASHED_MAX_LENGTH} chars - looks like content, not a hash` });
				} else if (/\s/.test(value) || PATH_SEPARATOR.test(value)) {
					errors.push({ key, reason: 'id contains whitespace or a path separator - a raw path or prose may have leaked' });
				}
				break;
		}
	}
	return errors;
}

/**
 * The no-consent / decline state as a single null-object (doc 15: "declining disables capture entirely").
 * Capturing, identifying and consent-choice queries all resolve to "off" with zero work - there is no code
 * path from a decline to a network call.
 */
export class NullAnalyticsService implements IAnalyticsService {
	declare readonly _serviceBrand: undefined;
	readonly hasChosen = true;
	readonly isEnabled = false;
	setConsent(_enabled: boolean): void { /* no-op: the null object never captures. */ }
	capture(_event: AnalyticsEventName, _props?: AnalyticsProps): void { /* no-op. */ }
	identify(_email: string): void { /* no-op. */ }
}
