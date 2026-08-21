/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * The retry policy behind a failed model call (plan 55 B1; doc 30 section 2.6). Pure and
 * clock-free: every source of non-determinism - the jitter and the server's own `Retry-After` -
 * arrives as an argument, so the numbers are unit-testable without a timer or a stubbed global.
 *
 * The policy exists because the previous behaviour was a single IMMEDIATE retry. During a fan-out
 * wave that is a thundering herd: N concurrent calls hit the same transient upstream fault, and all
 * N re-fire in the same millisecond at twice the wave's width - which is how a recoverable blip
 * becomes a rate-limit, and a rate-limit becomes a failed run.
 */
export interface IRetryPolicy {
	/** The delay before the first retry, before jitter and before any exponential growth. */
	readonly baseDelayMs: number;
	/** The ceiling on any single wait, however large the server's `Retry-After` is. */
	readonly maxDelayMs: number;
}

/**
 * The policy the model client runs. `baseDelayMs` is short because there is only ever ONE retry and
 * a human is usually waiting on the other side of it; `maxDelayMs` bounds a hostile or mistaken
 * `Retry-After` so a single rate-limited call can never hang a run for minutes.
 */
export const MODEL_RETRY_POLICY: IRetryPolicy = { baseDelayMs: 500, maxDelayMs: 20_000 };

/**
 * Read a `Retry-After` header into milliseconds. Both wire forms are accepted: delta-seconds
 * (`Retry-After: 30`) and an HTTP-date (`Retry-After: Wed, 21 Oct 2026 07:28:00 GMT`), which is
 * resolved against `nowMs` rather than a read of the clock so the function stays pure. Anything
 * unparseable, negative, or absent returns `undefined` - the caller then falls back to its own
 * backoff rather than trusting a header it could not read.
 *
 * @param value the raw header value, or `undefined` when the response carried none.
 * @param nowMs the current time, for resolving the HTTP-date form.
 */
export function parseRetryAfterMs(value: string | undefined, nowMs: number): number | undefined {
	if (typeof value !== 'string') { return undefined; }
	const trimmed = value.trim();
	if (!trimmed) { return undefined; }
	// Delta-seconds: a bare non-negative integer.
	if (/^\d+$/.test(trimmed)) {
		return Number(trimmed) * 1000;
	}
	// Anything else numeric-looking (a negative, a decimal) is a MALFORMED delta-seconds, not a date - and
	// must not fall through to Date.parse, which happily reads "-5" as a year and yields a past instant.
	if (/^[-+.\d]+$/.test(trimmed)) { return undefined; }
	const at = Date.parse(trimmed);
	if (Number.isNaN(at)) { return undefined; }
	const delta = at - nowMs;
	return delta > 0 ? delta : 0;
}

/**
 * How long to wait before retry number `attempt` (1 for the first retry).
 *
 * Two regimes, and the difference matters:
 *
 *  - The server named a wait (`retryAfterMs`, from a 429). That is an instruction, not a hint, so it
 *    is honoured as a FLOOR and only clamped by `maxDelayMs`. A small jitter is added on top so a
 *    wave of calls all told "retry after 1s" does not re-fire in the same millisecond - which would
 *    reproduce the herd the header exists to prevent.
 *  - Nothing was named. Full jitter over an exponentially growing window
 *    (`random() * base * 2^(attempt-1)`), the standard shape: it spreads a simultaneous wave across
 *    the whole window instead of clustering it at the end, which is what "backoff plus a little
 *    jitter" gets wrong.
 *
 * `random` is passed in rather than read from `Math.random` so a test can pin the exact delay.
 *
 * @param attempt 1-based retry number.
 * @param retryAfterMs the server's own instruction in ms, or `undefined`.
 * @param random a source of numbers in [0, 1).
 * @param policy the delays to work within.
 */
export function retryDelayMs(attempt: number, retryAfterMs: number | undefined, random: () => number, policy: IRetryPolicy = MODEL_RETRY_POLICY): number {
	const jitter = Math.max(0, Math.min(1, random()));
	if (retryAfterMs !== undefined && retryAfterMs >= 0) {
		const honoured = Math.min(retryAfterMs, policy.maxDelayMs);
		return Math.round(honoured + jitter * policy.baseDelayMs);
	}
	const window = Math.min(policy.baseDelayMs * Math.pow(2, Math.max(0, attempt - 1)), policy.maxDelayMs);
	return Math.round(jitter * window);
}
