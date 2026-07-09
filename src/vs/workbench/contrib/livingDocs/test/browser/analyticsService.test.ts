/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { Emitter, Event } from '../../../../../base/common/event.js';
import { VSBuffer, bufferToStream } from '../../../../../base/common/buffer.js';
import { CancellationToken } from '../../../../../base/common/cancellation.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { NullLogService } from '../../../../../platform/log/common/log.js';
import { IProductConfiguration } from '../../../../../base/common/product.js';
import { IProductService } from '../../../../../platform/product/common/productService.js';
import { AuthInfo, Credentials, IRequestCompleteEvent, IRequestService } from '../../../../../platform/request/common/request.js';
import { IRequestContext, IRequestOptions } from '../../../../../base/parts/request/common/request.js';
import { InMemoryStorageService, StorageScope } from '../../../../../platform/storage/common/storage.js';
import { AnalyticsService, POSTHOG_KEY_PLACEHOLDER } from '../../browser/analyticsService.js';

// A request service that records the capture payloads it was asked to send, implementing the real
// IRequestService interface (no `any` fakes) so the analytics service can be driven end-to-end offline.
class RecordingRequestService implements IRequestService {
	declare readonly _serviceBrand: undefined;
	readonly sent: { url: string; body: object }[] = [];
	private readonly _onDidCompleteRequest = new Emitter<IRequestCompleteEvent>();
	readonly onDidCompleteRequest: Event<IRequestCompleteEvent> = this._onDidCompleteRequest.event;
	async request(options: IRequestOptions, _token: CancellationToken): Promise<IRequestContext> {
		this.sent.push({ url: options.url ?? '', body: JSON.parse(options.data ?? '{}') });
		return { res: { headers: {}, statusCode: 200 }, stream: bufferToStream(VSBuffer.fromString('1')) };
	}
	async resolveProxy(): Promise<string | undefined> { return undefined; }
	async lookupAuthorization(_authInfo: AuthInfo): Promise<Credentials | undefined> { return undefined; }
	async lookupKerberosAuthorization(): Promise<string | undefined> { return undefined; }
	async loadCertificates(): Promise<string[]> { return []; }
}

function productWith(projectApiKey: string): IProductService {
	return { version: '9.9.9', posthog: { projectApiKey } } as Partial<IProductConfiguration> as IProductService;
}

suite('AnalyticsService (plan 36 iter 1: consent + identity)', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();

	function make(projectApiKey = 'phc_realkey') {
		const storage = store.add(new InMemoryStorageService());
		const request = new RecordingRequestService();
		const service = store.add(new AnalyticsService(storage, request, productWith(projectApiKey), new NullLogService()));
		return { service, request, storage };
	}

	test('no capture before consent, and consent state starts unchosen', () => {
		const { service, request } = make();
		assert.deepStrictEqual(
			{ hasChosen: service.hasChosen, isEnabled: service.isEnabled },
			{ hasChosen: false, isEnabled: false });
		service.capture('app_opened', { version: '9.9.9', first_open: true });
		assert.strictEqual(request.sent.length, 0, 'nothing is sent before a consent choice');
	});

	test('decline is total: no capture, no identify, no anon id ever minted', () => {
		const { service, request, storage } = make();
		service.setConsent(false);
		service.capture('app_opened', { version: '9.9.9', first_open: true });
		service.identify('a@b.com');
		assert.deepStrictEqual(
			{ chosen: service.hasChosen, enabled: service.isEnabled, sent: request.sent.length, anon: storage.get('abstract.analytics.anonId', StorageScope.APPLICATION) },
			{ chosen: true, enabled: false, sent: 0, anon: undefined });
	});

	test('consent enables capture, mints a stable anonymous id, and sends the typed event', () => {
		const { service, request } = make();
		service.setConsent(true);
		service.capture('app_opened', { version: '9.9.9', first_open: true });
		assert.strictEqual(request.sent.length, 1, 'one event sent after consent');
		const body = request.sent[0].body as { event: string; distinct_id: string; api_key: string; properties: object };
		assert.deepStrictEqual(
			{ event: body.event, hasDistinctId: body.distinct_id.length > 0, key: body.api_key, props: body.properties },
			{ event: 'app_opened', hasDistinctId: true, key: 'phc_realkey', props: { version: '9.9.9', first_open: true } });
	});

	test('the anonymous id is stable across a restart (persisted in storage)', () => {
		const storage = store.add(new InMemoryStorageService());
		const request = new RecordingRequestService();
		const first = store.add(new AnalyticsService(storage, request, productWith('phc_realkey'), new NullLogService()));
		first.setConsent(true);
		first.capture('app_opened', {});
		const idA = (request.sent[0].body as { distinct_id: string }).distinct_id;
		// A fresh service over the same storage (a restart) reads the same consent + id and reuses it.
		const second = store.add(new AnalyticsService(storage, request, productWith('phc_realkey'), new NullLogService()));
		second.capture('app_opened', {});
		const idB = (request.sent[1].body as { distinct_id: string }).distinct_id;
		assert.strictEqual(idA, idB, 'the anonymous id is stable across restarts');
	});

	test('a payload that fails the property-linter is dropped, never sent', () => {
		const { service, request } = make();
		service.setConsent(true);
		// A path smuggled through a hashed prop must be rejected before it leaves the machine.
		service.capture('this_was_wrong_reported', { ref_id: '/Users/someone/secret project/report.md' });
		assert.strictEqual(request.sent.length, 0, 'the linter dropped the leaky event');
	});

	test('the placeholder key never sends (no faked connection) but consent + id still work', () => {
		const { service, request } = make(POSTHOG_KEY_PLACEHOLDER);
		service.setConsent(true);
		service.capture('app_opened', {});
		assert.deepStrictEqual(
			{ enabled: service.isEnabled, sent: request.sent.length },
			{ enabled: true, sent: 0 });
	});

	test('identify is only for a consented user and aliases the anon id to the email', () => {
		const { service, request } = make();
		service.setConsent(true);
		service.identify('founder@example.com');
		const body = request.sent[0].body as { event: string; properties: { $set: { email: string } } };
		assert.deepStrictEqual(
			{ event: body.event, email: body.properties.$set.email },
			{ event: '$identify', email: 'founder@example.com' });
	});

	test('hashPath yields an opaque, path-free id that passes the hashed-prop linter', () => {
		const id = AnalyticsService.hashPath('/Users/someone/secret project/report.md');
		assert.ok(!/[\s/\\]/.test(id) && id.length <= 80, 'hashed path is opaque and bounded');
	});
});
