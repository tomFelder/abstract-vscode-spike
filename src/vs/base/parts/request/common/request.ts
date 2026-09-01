/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { VSBufferReadableStream } from '../../../common/buffer.js';

const offlineName = 'Offline';

/**
 * Checks if the given error is offline error
 */
export function isOfflineError(error: unknown): boolean {
	if (error instanceof OfflineError) {
		return true;
	}
	return error instanceof Error && error.name === offlineName && error.message === offlineName;
}

export class OfflineError extends Error {
	constructor() {
		super(offlineName);
		this.name = this.message;
	}
}

export interface IHeaders {
	'Proxy-Authorization'?: string;
	'x-operation-id'?: string;
	'retry-after'?: string;
	etag?: string;
	'Content-Length'?: string;
	'activityid'?: string;
	'X-Market-User-Id'?: string;
	[header: string]: string | string[] | undefined;
}

export interface IRequestOptions {
	type?: string;
	url?: string;
	user?: string;
	password?: string;
	headers?: IHeaders;
	timeout?: number;
	data?: string;
	followRedirects?: number;
	proxyAuthorization?: string;
	/**
	 * A signal to not cache the response. This may not
	 * be supported in all implementations.
	 */
	disableCache?: boolean;
	/**
	 * Deliver the response body INCREMENTALLY: the returned {@link IRequestContext.stream} emits each
	 * chunk as it arrives off the wire instead of the whole body landing in one piece once the response
	 * has been read to the end. Callers that consume a long-lived response as it is produced - a
	 * server-sent-event stream, say - need this; everyone else should leave it off and keep the simpler
	 * read-it-all-then-hand-it-over behaviour. This may not be supported in all implementations, which
	 * are always free to deliver the body in a single chunk.
	 */
	incrementalResponse?: boolean;
	/**
	 * Identifies the call site making this request, used for telemetry.
	 * Use "NO_FETCH_TELEMETRY" to opt out of request telemetry.
	 */
	callSite: string;
}

export interface IRequestContext {
	res: {
		headers: IHeaders;
		statusCode?: number;
	};
	stream: VSBufferReadableStream;
}
