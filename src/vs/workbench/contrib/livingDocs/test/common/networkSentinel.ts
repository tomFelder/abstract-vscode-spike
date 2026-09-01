/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';

// Ticket #375. The living-docs suites must be STRUCTURALLY incapable of reaching a live model, not merely
// watched in case they do.
//
// A port trap - a real listener where the model ladder aims - can only ever see traffic that arrives at an
// address it holds, which makes it conditional on all the wrong things: which loopback family a name
// resolves to, whether the port was bindable, whether the caller awaited its own leak, and whether a third
// party happened to knock. Every one of those was a way for a leak to pass a green run.
//
// This stands somewhere the answer is unconditional: the global network primitives themselves. Every attempt
// is recorded AT THE CALL, synchronously, before anything leaves the process - so an un-awaited leak is as
// visible as an awaited one - and every attempt is refused, so no test can emit a billed model call whatever
// address it aims at. The only sanctioned route out of the living-docs area is IRequestService, which is
// injected and therefore doubled.
//
// It is deliberately not clever about intent. A living-docs test that genuinely needs the network does not
// exist; if one ever does, it belongs outside this guard and should say why.

/** The refusal every guarded primitive raises, so a leak reads as a rule rather than a mystery failure. */
export const NETWORK_BLOCKED = 'the living-docs test suites may not use the network: all traffic belongs to IRequestService';

export interface INetworkSentinel {
	/** Every attempt to use a global network primitive, in order, as "<api> <target>". */
	readonly attempts: readonly string[];
	/** The primitives actually stood in front of, so a failure can name what was and was not covered. */
	readonly guarded: readonly string[];
	dispose(): void;
}

function describe(target: unknown): string {
	if (typeof target === 'string') {
		return target;
	}
	const url = (target as { url?: unknown } | undefined)?.url;
	return typeof url === 'string' ? url : String(target);
}

/**
 * Replace every global network primitive with a recorder that refuses. Restore with `dispose()`.
 */
export function installNetworkSentinel(): INetworkSentinel {
	const attempts: string[] = [];
	const guarded: string[] = [];
	const restore: (() => void)[] = [];
	const scope = globalThis as unknown as Record<string, unknown>;

	const note = (api: string, target: unknown) => { attempts.push(`${api} ${describe(target)}`); };

	const swap = (api: string, replacement: unknown) => {
		if (scope[api] === undefined) {
			return; // not present in this environment - nothing to stand in front of
		}
		const original = scope[api];
		guarded.push(api);
		scope[api] = replacement;
		restore.push(() => { scope[api] = original; });
	};

	// `fetch` records synchronously and returns a REJECTED promise, so a caller that never awaits its own
	// leak is recorded all the same - the shape a port trap cannot see, because it reads its hits before the
	// request has landed.
	swap('fetch', (input: unknown) => {
		note('fetch', input);
		return Promise.reject(new Error(NETWORK_BLOCKED));
	});
	swap('XMLHttpRequest', class {
		open(_method: string, url: string) { note('XMLHttpRequest', url); throw new Error(NETWORK_BLOCKED); }
		send() { throw new Error(NETWORK_BLOCKED); }
	});
	swap('WebSocket', class { constructor(url: unknown) { note('WebSocket', url); throw new Error(NETWORK_BLOCKED); } });
	swap('EventSource', class { constructor(url: unknown) { note('EventSource', url); throw new Error(NETWORK_BLOCKED); } });

	const nav = (globalThis as { navigator?: { sendBeacon?: unknown } }).navigator;
	if (nav && typeof nav.sendBeacon === 'function') {
		const original = nav.sendBeacon;
		guarded.push('navigator.sendBeacon');
		nav.sendBeacon = (url: unknown) => { note('navigator.sendBeacon', url); return false; };
		restore.push(() => { nav.sendBeacon = original; });
	}

	return {
		attempts,
		guarded,
		dispose: () => { while (restore.length) { restore.pop()!(); } },
	};
}

/**
 * Install the sentinel around every test in the calling suite and fail any test that touched the network.
 * Returns a live view, so a test can also assert on the attempts itself rather than only at teardown.
 */
export function ensureNoNetworkInTestSuite(): INetworkSentinel {
	let sentinel: INetworkSentinel | undefined;

	setup(() => { sentinel = installNetworkSentinel(); });
	teardown(() => {
		const attempts = [...(sentinel?.attempts ?? [])];
		const guarded = [...(sentinel?.guarded ?? [])];
		sentinel?.dispose();
		sentinel = undefined;
		assert.deepStrictEqual(attempts, [], `this test reached for the network directly (guarded: ${guarded.join(', ')}). Model traffic belongs to IRequestService, which is injected and doubled - see ticket #375.`);
	});

	return {
		get attempts() { return sentinel?.attempts ?? []; },
		get guarded() { return sentinel?.guarded ?? []; },
		dispose: () => sentinel?.dispose(),
	};
}
