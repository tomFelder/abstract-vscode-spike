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
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { AuthInfo, Credentials, IRequestCompleteEvent, IRequestService } from '../../../../../platform/request/common/request.js';
import { IRequestContext, IRequestOptions } from '../../../../../base/parts/request/common/request.js';
import { InMemoryStorageService, StorageScope } from '../../../../../platform/storage/common/storage.js';
import { AnalyticsService } from '../../browser/analyticsService.js';

// A request service that records the payloads it was asked to send, implementing the real IRequestService
// interface (no `any` fakes) so the analytics service can be driven end-to-end offline.
class RecordingRequestService implements IRequestService {
	declare readonly _serviceBrand: undefined;
	readonly sent: { url: string; body: Record<string, unknown> }[] = [];
	private readonly _onDidCompleteRequest = new Emitter<IRequestCompleteEvent>();
	readonly onDidCompleteRequest: Event<IRequestCompleteEvent> = this._onDidCompleteRequest.event;
	async request(options: IRequestOptions, _token: CancellationToken): Promise<IRequestContext> {
		this.sent.push({ url: options.url ?? '', body: JSON.parse(options.data ?? '{}') });
		return { res: { headers: {}, statusCode: 200 }, stream: bufferToStream(VSBuffer.fromString('{"ok":true}')) };
	}
	async resolveProxy(): Promise<string | undefined> { return undefined; }
	async lookupAuthorization(_authInfo: AuthInfo): Promise<Credentials | undefined> { return undefined; }
	async lookupKerberosAuthorization(): Promise<string | undefined> { return undefined; }
	async loadCertificates(): Promise<string[]> { return []; }
}

// A configuration stub that returns the proxy base URL the sink posts to (nothing else is read here).
function configWith(proxyUrl: string): IConfigurationService {
	return { getValue: (key: string) => (key === 'livingDocs.modelProxyUrl' ? proxyUrl : undefined) } as unknown as IConfigurationService;
}

suite('AnalyticsService (plan 36: consent + identity + local sink)', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();

	const PROXY = 'http://localhost:8090';

	function make(proxyUrl = PROXY) {
		const storage = store.add(new InMemoryStorageService());
		const request = new RecordingRequestService();
		const service = store.add(new AnalyticsService(storage, request, configWith(proxyUrl), new NullLogService()));
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

	test('consent enables capture, mints a stable anonymous id, and writes the flat typed record to the local sink', () => {
		const { service, request } = make();
		service.setConsent(true);
		service.capture('app_opened', { version: '9.9.9', first_open: true });
		assert.strictEqual(request.sent.length, 1, 'one event written after consent');
		const { url, body } = request.sent[0];
		assert.strictEqual(url, `${PROXY}/event`, 'the event goes to the local sink, never an external endpoint');
		assert.deepStrictEqual(
			{ event: body.event, hasDistinctId: typeof body.distinct_id === 'string' && (body.distinct_id as string).length > 0, version: body.version, first_open: body.first_open, hasApiKey: body.api_key !== undefined },
			{ event: 'app_opened', hasDistinctId: true, version: '9.9.9', first_open: true, hasApiKey: false });
	});

	test('every captured event goes to the LOCAL sink, never a PostHog capture endpoint', () => {
		const { service, request } = make();
		service.setConsent(true);
		service.capture('change_resolved', { resolution: 'approve', bulk: false });
		service.capture('undo_after_approve', { depth: 1 });
		const external = request.sent.filter(s => !s.url.endsWith('/event'));
		assert.deepStrictEqual(external, [], 'no event may leave the machine: every write is to the local /event sink');
	});

	test('the anonymous id is stable across a restart (persisted in storage)', () => {
		const storage = store.add(new InMemoryStorageService());
		const request = new RecordingRequestService();
		const first = store.add(new AnalyticsService(storage, request, configWith(PROXY), new NullLogService()));
		first.setConsent(true);
		first.capture('app_opened', {});
		const idA = request.sent[0].body.distinct_id;
		// A fresh service over the same storage (a restart) reads the same consent + id and reuses it.
		const second = store.add(new AnalyticsService(storage, request, configWith(PROXY), new NullLogService()));
		second.capture('app_opened', {});
		const idB = request.sent[1].body.distinct_id;
		assert.strictEqual(idA, idB, 'the anonymous id is stable across restarts');
	});

	test('a payload that fails the property-linter is dropped, never written', () => {
		const { service, request } = make();
		service.setConsent(true);
		// A path smuggled through a hashed prop must be rejected before it leaves the machine.
		service.capture('this_was_wrong_reported', { ref_id: '/Users/someone/secret project/report.md' });
		assert.strictEqual(request.sent.length, 0, 'the linter dropped the leaky event');
	});

	test('identify is only for a consented user and records the alias to the local sink', () => {
		const { service, request } = make();
		service.setConsent(true);
		service.identify('founder@example.com');
		const { url, body } = request.sent[0];
		assert.deepStrictEqual(
			{ url, event: body.event, email: body.email },
			{ url: `${PROXY}/event`, event: '$identify', email: 'founder@example.com' });
	});

	test('hashPath yields an opaque, path-free id that passes the hashed-prop linter', () => {
		const id = AnalyticsService.hashPath('/Users/someone/secret project/report.md');
		assert.ok(!/[\s/\\]/.test(id) && id.length <= 80, 'hashed path is opaque and bounded');
	});
});
