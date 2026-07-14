/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../../base/common/cancellation.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { hash } from '../../../../base/common/hash.js';
import { generateUuid } from '../../../../base/common/uuid.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IRequestService } from '../../../../platform/request/common/request.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { AnalyticsEventName, AnalyticsProps, IAnalyticsService, lintEventProps } from '../common/analytics.js';

/** The obvious placeholder shipped in product.json until the founder pastes the real PostHog project key. */
export const POSTHOG_KEY_PLACEHOLDER = 'phc_REPLACE_ME';

/**
 * External forwarding to PostHog is DEFERRED (plan 36 iteration 3). This build never POSTs an event to a real
 * external analytics endpoint: consent-gated events land ONLY in the local sink (the proxy's `/event` route ->
 * `~/.abstract/events.log`), which stays on the user's machine, matching the doc 27 promise ("today no
 * analytics leaves the machine"). When the founder creates the PostHog project and iteration 3 lands, flip
 * this flag and route through the (already-written) PostHog leg; nothing else in the app changes because the
 * whole codebase captures through {@link IAnalyticsService}. Kept as a typed boolean (not a literal) so the
 * forwarding leg stays live code, checked by the compiler, rather than silently rotting behind `false`.
 */
export const POSTHOG_FORWARDING_ENABLED: boolean = false;

/** The local model proxy that also owns the events sink; matches livingDocs.modelProxyUrl's default. */
const DEFAULT_PROXY_URL = 'http://localhost:8090';

const CONSENT_KEY = 'abstract.analytics.consent'; // '1' enabled, '0' declined, absent = not yet chosen.
const ANON_ID_KEY = 'abstract.analytics.anonId'; // the stable anonymous distinct id, minted on first enable.

/**
 * The real {@link IAnalyticsService}: consent-gated capture to the LOCAL events sink. It is the ONLY place in
 * the codebase that knows where analytics events go. Every captured event is POSTed - after the consent gate
 * and the privacy property-linter - to the local proxy's `/event` route, which appends one JSON line to
 * `~/.abstract/events.log` on the user's own machine. Nothing leaves the machine: external forwarding to
 * PostHog is deferred to iteration 3 and gated OFF by {@link POSTHOG_FORWARDING_ENABLED}, so this build wires
 * no real external endpoint (doc 27's "today no analytics leaves" stays true). Session replay is likewise
 * iteration 3's job. Every event here is explicit and typed, which is exactly what the privacy invariant
 * wants; swapping in real PostHog forwarding later only touches this file.
 */
export class AnalyticsService extends Disposable implements IAnalyticsService {
	declare readonly _serviceBrand: undefined;

	private _consent: boolean | undefined;
	private _anonId: string | undefined;

	constructor(
		@IStorageService private readonly _storage: IStorageService,
		@IRequestService private readonly _request: IRequestService,
		@IConfigurationService private readonly _config: IConfigurationService,
		@ILogService private readonly _log: ILogService,
	) {
		super();
		const stored = this._storage.get(CONSENT_KEY, StorageScope.APPLICATION);
		this._consent = stored === undefined ? undefined : stored === '1';
		this._anonId = this._storage.get(ANON_ID_KEY, StorageScope.APPLICATION);
	}

	get hasChosen(): boolean {
		return this._consent !== undefined;
	}

	get isEnabled(): boolean {
		return this._consent === true;
	}

	setConsent(enabled: boolean): void {
		this._consent = enabled;
		this._storage.store(CONSENT_KEY, enabled ? '1' : '0', StorageScope.APPLICATION, StorageTarget.USER);
		if (enabled) {
			// Mint the stable anonymous id on first enable (never before consent). Kept across sessions.
			if (!this._anonId) {
				this._anonId = generateUuid();
				this._storage.store(ANON_ID_KEY, this._anonId, StorageScope.APPLICATION, StorageTarget.USER);
			}
		}
	}

	capture(event: AnalyticsEventName, props: AnalyticsProps = {}): void {
		if (!this.isEnabled) {
			return; // consent gate: no capture before consent, none after decline.
		}
		// The privacy invariant, enforced before anything leaves the machine: a payload that smuggles free
		// text, an over-long value, or a path is dropped and logged - never sent.
		const errors = lintEventProps(event, props);
		if (errors.length > 0) {
			this._log.warn(`[analytics] dropped "${event}" - property-linter rejected it: ${errors.map(e => `${e.key} (${e.reason})`).join(', ')}`);
			return;
		}
		// The event lands in the local sink as one flat JSON record: the event name, the stable anonymous id,
		// and the (cleaned) typed props. The proxy stamps the UTC `ts`. No document prose is present - the
		// linter above guarantees it - so this file never leaves the machine as anything but counts and kinds.
		void this._sink({
			event,
			distinct_id: this._anonId ?? 'anonymous',
			...this._clean(props),
		});
	}

	identify(email: string): void {
		if (!this.isEnabled || !this._anonId) {
			return;
		}
		// Alias the stable anonymous id to the known person. Called ONLY at waitlist redemption. Recorded to the
		// local sink like any other event; it never leaves the machine while external forwarding is deferred.
		void this._sink({ event: '$identify', distinct_id: this._anonId, email });
	}

	/** Strip omitted (undefined) properties so the recorded payload only carries the values that were set. */
	private _clean(props: AnalyticsProps): Record<string, string | number | boolean> {
		const out: Record<string, string | number | boolean> = {};
		for (const key of Object.keys(props)) {
			const value = props[key];
			if (value !== undefined) {
				out[key] = value;
			}
		}
		return out;
	}

	/** The local model proxy base URL (which also owns the `/event` sink); config-overridable, slash-trimmed. */
	private _proxyUrl(): string {
		const raw = this._config.getValue<string>('livingDocs.modelProxyUrl');
		const url = (typeof raw === 'string' && raw.length > 0) ? raw : DEFAULT_PROXY_URL;
		return url.replace(/\/+$/, '');
	}

	private async _sink(record: { event: string; distinct_id: string;[prop: string]: string | number | boolean }): Promise<void> {
		if (POSTHOG_FORWARDING_ENABLED) {
			// Deferred (iteration 3): once the founder has created the PostHog project, forward the same record
			// to the external endpoint here. Off in this build, so no event ever reaches an external service.
			this._forwardToPostHog(record);
		}
		try {
			await this._request.request({
				type: 'POST',
				url: `${this._proxyUrl()}/event`,
				headers: { 'Content-Type': 'application/json' },
				data: JSON.stringify(record),
				callSite: 'analytics.capture',
			}, CancellationToken.None);
		} catch (e) {
			// Analytics must never break the app: a failed sink write is swallowed at debug.
			this._log.debug('[analytics] event sink write failed', e instanceof Error ? e.message : String(e));
		}
	}

	/**
	 * DEFERRED external forwarding (plan 36 iteration 3). Reserved and gated OFF by
	 * {@link POSTHOG_FORWARDING_ENABLED}: this build never calls a real PostHog endpoint. The publishable
	 * project key still lives in product.json (placeholder until the founder pastes the real one); wiring the
	 * POST to `${host}/capture/` here is all iteration 3 needs, because everything already flows through here.
	 */
	private _forwardToPostHog(record: { event: string; distinct_id: string }): void {
		this._log.trace(`[analytics] PostHog forwarding is deferred (iteration 3) - "${record.event}" stays local`);
	}

	/**
	 * Hash a file path to an opaque id so a document can be counted across events without its path (which can
	 * carry a project or person's name) ever leaving the machine. Callers pass the result as a `hashed` prop.
	 */
	static hashPath(path: string): string {
		return `d${(hash(path) >>> 0).toString(16)}`;
	}
}
