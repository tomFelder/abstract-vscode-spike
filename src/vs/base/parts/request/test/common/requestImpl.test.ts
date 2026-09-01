/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { timeout } from '../../../../common/async.js';
import { VSBuffer } from '../../../../common/buffer.js';
import { CancellationToken, CancellationTokenSource } from '../../../../common/cancellation.js';
import { listenStream } from '../../../../common/stream.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../test/common/utils.js';
import { request } from '../../common/requestImpl.js';

suite('requestImpl - incrementalResponse', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	const URL = 'https://example.invalid/stream';

	// A response body this test writes into by hand, so "has the caller seen this chunk yet?" has a definite
	// answer rather than being a race against a real network.
	function openBody(): { body: ReadableStream<Uint8Array>; push(text: string): void; fail(err: Error): void; close(): void; wasCancelled(): boolean } {
		let controller!: ReadableStreamDefaultController<Uint8Array>;
		let cancelled = false;
		const body = new ReadableStream<Uint8Array>({ start: c => { controller = c; }, cancel: () => { cancelled = true; } });
		const encoder = new TextEncoder();
		return {
			body,
			push: text => controller.enqueue(encoder.encode(text)),
			fail: err => controller.error(err),
			close: () => controller.close(),
			wasCancelled: () => cancelled,
		};
	}

	function stubFetch(handler: (init: RequestInit | undefined) => Response): { restore(): void } {
		const original = globalThis.fetch;
		globalThis.fetch = (async (_input: unknown, init?: RequestInit) => handler(init)) as typeof globalThis.fetch;
		return { restore: () => { globalThis.fetch = original; } };
	}

	/** Collect everything a stream emits; resolves when it ends, with the error if it errored. */
	function drain(stream: { on: (...args: never[]) => unknown }, seen: string[]): Promise<Error | undefined> {
		return new Promise(resolve => listenStream<VSBuffer>(stream as never, {
			onData: data => seen.push(data.toString()),
			onError: err => resolve(err),
			onEnd: () => resolve(undefined),
		}));
	}

	/** Poll a few real macrotasks for a condition, so a chunk in flight has every chance to arrive. */
	async function settle(until: () => boolean): Promise<void> {
		for (let i = 0; i < 50 && !until(); i++) { await timeout(1); }
	}

	test('an incremental response delivers each chunk as it lands, not all of it at the end', async () => {
		const { body, push, close } = openBody();
		push('first ');
		const stub = stubFetch(() => new Response(body, { status: 200 }));
		try {
			const context = await request({ url: URL, callSite: 'test.incremental', incrementalResponse: true }, CancellationToken.None);
			const seen: string[] = [];
			const ended = drain(context.stream, seen);

			// The body is still OPEN here, so the first chunk has to have arrived on its own.
			await settle(() => seen.length > 0);
			assert.deepStrictEqual(seen, ['first '], 'the first chunk arrives while the body is still being written');

			push('second');
			close();
			assert.strictEqual(await ended, undefined);
			assert.strictEqual(seen.join(''), 'first second', 'and the rest follows, in order');
		} finally {
			stub.restore();
		}
	});

	test('without the flag the body is read whole before the caller is handed anything', async () => {
		const { body, push, close } = openBody();
		push('first ');
		const stub = stubFetch(() => new Response(body, { status: 200 }));
		try {
			const pending = request({ url: URL, callSite: 'test.buffered' }, CancellationToken.None);
			assert.strictEqual(
				await Promise.race([pending.then(() => 'resolved'), timeout(20).then(() => 'still reading')]),
				'still reading',
				'a buffered request does not resolve until the whole body has been read',
			);

			push('second');
			close();
			const seen: string[] = [];
			await drain((await pending).stream, seen);
			assert.strictEqual(seen.join(''), 'first second');
		} finally {
			stub.restore();
		}
	});

	test('destroying the stream cancels the body: "stop reading" is not "read it all anyway"', async () => {
		// The caller that says this is one holding a response it will not read - an error envelope, or the last
		// event of a stream the server keeps open. Dropping the listeners alone would leave the connection open.
		const { body, push, wasCancelled } = openBody();
		push('first ');
		const stub = stubFetch(() => new Response(body, { status: 200 }));
		try {
			const context = await request({ url: URL, callSite: 'test.destroyed', incrementalResponse: true }, CancellationToken.None);
			context.stream.destroy();

			await settle(() => wasCancelled());
			assert.strictEqual(wasCancelled(), true, 'destroy() cancels the underlying body');
		} finally {
			stub.restore();
		}
	});

	test('cancelling mid-body aborts the request and ends the stream in an error, never leaving it open', async () => {
		const { body, push, fail } = openBody();
		push('first ');
		// A real `fetch` errors its body when the signal aborts; the stub does the same, so the cancellation
		// path is modelled rather than assumed. This is what the request's token subscription buys: it has to
		// outlive `request()` itself, or a body handed over incrementally can never be cancelled.
		const stub = stubFetch(init => {
			init?.signal?.addEventListener('abort', () => fail(new DOMException('aborted', 'AbortError')));
			return new Response(body, { status: 200 });
		});
		const source = new CancellationTokenSource();
		try {
			const context = await request({ url: URL, callSite: 'test.cancelled', incrementalResponse: true }, source.token);
			const seen: string[] = [];
			const ended = drain(context.stream, seen);

			await settle(() => seen.length > 0);
			source.cancel();

			assert.ok(await ended, 'cancelling the token ends the stream in an error rather than leaving it open');
			assert.deepStrictEqual(seen, ['first '], 'what had already arrived is still the caller\'s to keep');
		} finally {
			source.dispose();
			stub.restore();
		}
	});
});
