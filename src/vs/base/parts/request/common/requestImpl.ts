/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { bufferToStream, newWriteableBufferStream, VSBuffer, VSBufferReadableStream } from '../../../common/buffer.js';
import { CancellationToken } from '../../../common/cancellation.js';
import { canceled } from '../../../common/errors.js';
import { IDisposable } from '../../../common/lifecycle.js';
import { IHeaders, IRequestContext, IRequestOptions, OfflineError } from './request.js';

export async function request(options: IRequestOptions, token: CancellationToken, isOnline?: () => boolean): Promise<IRequestContext> {
	if (token.isCancellationRequested) {
		throw canceled();
	}

	const cancellation = new AbortController();
	const disposable = token.onCancellationRequested(() => cancellation.abort());
	const signal = options.timeout ? AbortSignal.any([
		cancellation.signal,
		AbortSignal.timeout(options.timeout),
	]) : cancellation.signal;

	// An incremental response hands the body to the caller while it is still arriving, so the cancellation
	// subscription has to outlive this function - it is the thing that aborts a body mid-flight. The pump
	// disposes it once the body is done.
	let handedOff = false;
	try {
		const fetchInit: RequestInit = {
			method: options.type || 'GET',
			headers: getRequestHeaders(options),
			body: options.data,
			signal
		};
		if (options.disableCache) {
			fetchInit.cache = 'no-store';
		}
		const res = await fetch(options.url || '', fetchInit);
		const context = {
			res: {
				statusCode: res.status,
				headers: getResponseHeaders(res),
			},
		};
		if (options.incrementalResponse && res.body) {
			handedOff = true;
			return { ...context, stream: incrementalStream(res.body, disposable, options.timeout) };
		}
		return {
			...context,
			stream: bufferToStream(VSBuffer.wrap(new Uint8Array(await res.arrayBuffer()))),
		};
	} catch (err) {
		if (isOnline && !isOnline()) {
			throw new OfflineError();
		}
		if (err?.name === 'AbortError') {
			throw canceled();
		}
		if (err?.name === 'TimeoutError') {
			throw new Error(`Fetch timeout: ${options.timeout}ms`);
		}
		throw err;
	} finally {
		if (!handedOff) {
			disposable.dispose();
		}
	}
}

/**
 * Pumps a `fetch` body into a {@link VSBufferReadableStream} chunk by chunk, so a caller that asked for an
 * incremental response sees each chunk as it lands rather than the whole body at the end. `cancellation` is
 * the request's token subscription, held until the body is done so cancelling mid-body still aborts the
 * underlying fetch; reading to the end is what releases the connection deterministically rather than leaving
 * it open until GC gets to it.
 *
 * A caller that has seen enough - an error envelope it will not read, or the last event of a stream the
 * server keeps open - says so with `destroy()`, which cancels the body rather than merely dropping the
 * listeners. Without that, "stop reading" would silently mean "keep the connection and read it all anyway".
 */
function incrementalStream(body: ReadableStream<Uint8Array>, cancellation: IDisposable, timeoutMs: number | undefined): VSBufferReadableStream {
	const stream = newWriteableBufferStream();
	const reader = body.getReader();
	const destroy = stream.destroy.bind(stream);
	stream.destroy = () => {
		reader.cancel().catch(() => undefined);
		destroy();
	};
	(async () => {
		try {
			while (true) {
				const { done, value } = await reader.read();
				if (done) {
					break;
				}
				if (value) {
					await stream.write(VSBuffer.wrap(value));
				}
			}
		} catch (err) {
			// The same three outcomes the buffered path reports, told apart the same way: a body cut short by a
			// timeout is a timeout, not a cancellation the caller asked for.
			if (err?.name === 'TimeoutError') {
				stream.error(new Error(`Fetch timeout: ${timeoutMs}ms`));
			} else if (err?.name === 'AbortError') {
				stream.error(canceled());
			} else {
				stream.error(err);
			}
		} finally {
			cancellation.dispose();
			stream.end();
		}
	})();
	return stream;
}

function getRequestHeaders(options: IRequestOptions) {
	if (options.headers || options.user || options.password || options.proxyAuthorization) {
		const headers = new Headers();
		outer: for (const k in options.headers) {
			switch (k.toLowerCase()) {
				case 'user-agent':
				case 'accept-encoding':
				case 'content-length':
					// unsafe headers
					continue outer;
			}
			const header = options.headers[k];
			if (typeof header === 'string') {
				headers.set(k, header);
			} else if (Array.isArray(header)) {
				for (const h of header) {
					headers.append(k, h);
				}
			}
		}
		if (options.user || options.password) {
			headers.set('Authorization', 'Basic ' + btoa(`${options.user || ''}:${options.password || ''}`));
		}
		if (options.proxyAuthorization) {
			headers.set('Proxy-Authorization', options.proxyAuthorization);
		}
		return headers;
	}
	return undefined;
}

function getResponseHeaders(res: Response): IHeaders {
	const headers: IHeaders = Object.create(null);
	res.headers.forEach((value, key) => {
		if (headers[key]) {
			if (Array.isArray(headers[key])) {
				headers[key].push(value);
			} else {
				headers[key] = [headers[key], value];
			}
		} else {
			headers[key] = value;
		}
	});
	return headers;
}
