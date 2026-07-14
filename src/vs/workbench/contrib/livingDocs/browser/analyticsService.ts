/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../../base/common/cancellation.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { hash } from '../../../../base/common/hash.js';
import { generateUuid } from '../../../../base/common/uuid.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IProductService } from '../../../../platform/product/common/productService.js';
import { IRequestService } from '../../../../platform/request/common/request.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { AnalyticsEventName, AnalyticsProps, IAnalyticsService, lintEventProps } from '../common/analytics.js';

/** The obvious placeholder shipped in product.json until the founder pastes the real PostHog project key. */
export const POSTHOG_KEY_PLACEHOLDER = 'phc_REPLACE_ME';

const CONSENT_KEY = 'abstract.analytics.consent'; // '1' enabled, '0' declined, absent = not yet chosen.
const ANON_ID_KEY = 'abstract.analytics.anonId'; // the stable anonymous distinct id, minted on first enable.

/**
 * The real {@link IAnalyticsService}: consent-gated capture to PostHog. It is the ONLY place in the codebase
 * that knows PostHog exists. The transport is a thin native HTTP POST to PostHog's `/capture` JSON endpoint
 * via {@link IRequestService} rather than the posthog-js SDK: the SDK would need the offline esbuild-vendor
 * route (docs/lwd-pm-bundle-build.md), which is heavy for this session, and the capture endpoint is a plain
 * JSON POST with a publishable project key. The trade-off: no autocapture and no session replay from the SDK
 * (replay is iteration 3's job and will be revisited then); every event here is explicit and typed, which is
 * exactly what the privacy invariant wants. Swapping to the SDK later only touches this file.
 */
export class AnalyticsService extends Disposable implements IAnalyticsService {
	declare readonly _serviceBrand: undefined;

	private _consent: boolean | undefined;
	private _anonId: string | undefined;

	constructor(
		@IStorageService private readonly _storage: IStorageService,
		@IRequestService private readonly _request: IRequestService,
		@IProductService private readonly _product: IProductService,
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
		void this._send({
			event,
			distinct_id: this._anonId ?? 'anonymous',
			properties: this._clean(props),
		});
	}

	identify(email: string): void {
		if (!this.isEnabled || !this._anonId) {
			return;
		}
		// $identify aliases the stable anonymous id to the known person. Called ONLY at waitlist redemption.
		void this._send({
			event: '$identify',
			distinct_id: this._anonId,
			properties: { $set: { email } },
		});
	}

	/** Strip omitted (undefined) properties so the wire payload only carries the values that were set. */
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

	private async _send(body: { event: string; distinct_id: string; properties: object }): Promise<void> {
		const key = this._product.posthog?.projectApiKey;
		const host = this._product.posthog?.host ?? 'https://us.i.posthog.com';
		if (!key || key === POSTHOG_KEY_PLACEHOLDER) {
			// No real project yet (iteration 3 is blocked on the founder creating the PostHog project). We do
			// NOT fake a connection: log at trace and drop. Consent, identity and the linter still work fully.
			this._log.trace(`[analytics] no PostHog project key configured - "${body.event}" not sent`);
			return;
		}
		try {
			await this._request.request({
				type: 'POST',
				url: `${host.replace(/\/$/, '')}/capture/`,
				headers: { 'Content-Type': 'application/json' },
				data: JSON.stringify({ api_key: key, ...body }),
				callSite: 'analytics.capture',
			}, CancellationToken.None);
		} catch (e) {
			// Analytics must never break the app: a failed send is swallowed at debug.
			this._log.debug('[analytics] capture send failed', e instanceof Error ? e.message : String(e));
		}
	}

	/**
	 * Hash a file path to an opaque id so a document can be counted across events without its path (which can
	 * carry a project or person's name) ever leaving the machine. Callers pass the result as a `hashed` prop.
	 */
	static hashPath(path: string): string {
		return `d${(hash(path) >>> 0).toString(16)}`;
	}
}
