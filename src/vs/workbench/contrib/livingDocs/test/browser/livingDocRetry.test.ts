/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { MODEL_RETRY_POLICY, parseRetryAfterMs, retryDelayMs } from '../../common/livingDocRetry.js';

// The jitter source is a parameter, not a global, so every delay below is an exact number rather than a
// range - no timers, no stubbed Math.random, no flake.
const NO_JITTER = () => 0;
const HALF_JITTER = () => 0.5;
const MAX_JITTER = () => 0.999999;

// A fixed "now" for the HTTP-date form of Retry-After.
const NOW = Date.parse('2026-08-21T10:00:00Z');

suite('livingDocRetry - the model-call backoff policy', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	test('with no Retry-After, the wait is FULL jitter over an exponentially growing window', () => {
		const base = MODEL_RETRY_POLICY.baseDelayMs;
		assert.deepStrictEqual(
			{
				floorAt1: retryDelayMs(1, undefined, NO_JITTER),
				midAt1: retryDelayMs(1, undefined, HALF_JITTER),
				midAt2: retryDelayMs(2, undefined, HALF_JITTER),
				midAt3: retryDelayMs(3, undefined, HALF_JITTER),
			},
			// Full jitter spans [0, window): the floor is 0 and the window doubles per attempt. That spread is
			// the whole point - "backoff plus a little jitter" would cluster a wave at the end of the window.
			{ floorAt1: 0, midAt1: base / 2, midAt2: base, midAt3: base * 2 },
		);
	});

	test('a Retry-After is honoured as a FLOOR, with jitter only spreading the wave above it', () => {
		// The server said 2s. Every retry waits at least 2s - an instruction, not a hint - and the jitter adds
		// at most one base delay on top so N calls told the same thing do not all re-fire in one millisecond.
		assert.deepStrictEqual(
			{
				floor: retryDelayMs(1, 2000, NO_JITTER),
				spread: retryDelayMs(1, 2000, HALF_JITTER),
				ceiling: retryDelayMs(1, 2000, MAX_JITTER),
			},
			{ floor: 2000, spread: 2000 + MODEL_RETRY_POLICY.baseDelayMs / 2, ceiling: 2000 + MODEL_RETRY_POLICY.baseDelayMs },
		);
	});

	test('an absurd Retry-After is clamped, so one rate-limited call cannot hang a run', () => {
		assert.strictEqual(retryDelayMs(1, 10 * 60 * 1000, NO_JITTER), MODEL_RETRY_POLICY.maxDelayMs);
	});

	test('a Retry-After of 0 still means wait-then-retry, never the old immediate re-fire', () => {
		// The distinction matters: `0` is a real instruction ("go again now"), `undefined` is "we were not
		// told", and only the second one falls through to the exponential window.
		assert.deepStrictEqual(
			{ told: retryDelayMs(1, 0, HALF_JITTER), notTold: retryDelayMs(1, undefined, HALF_JITTER) },
			{ told: MODEL_RETRY_POLICY.baseDelayMs / 2, notTold: MODEL_RETRY_POLICY.baseDelayMs / 2 },
		);
	});

	test('parseRetryAfterMs reads both wire forms and refuses to guess at anything else', () => {
		assert.deepStrictEqual(
			{
				deltaSeconds: parseRetryAfterMs('30', NOW),
				zero: parseRetryAfterMs('0', NOW),
				padded: parseRetryAfterMs('  12  ', NOW),
				httpDate: parseRetryAfterMs('Fri, 21 Aug 2026 10:00:45 GMT', NOW),
				pastDate: parseRetryAfterMs('Fri, 21 Aug 2026 09:59:00 GMT', NOW),
				absent: parseRetryAfterMs(undefined, NOW),
				empty: parseRetryAfterMs('   ', NOW),
				nonsense: parseRetryAfterMs('soon', NOW),
				negative: parseRetryAfterMs('-5', NOW),
			},
			{
				deltaSeconds: 30_000,
				zero: 0,
				padded: 12_000,
				httpDate: 45_000,
				// A date already past means "now", never a negative wait.
				pastDate: 0,
				absent: undefined,
				empty: undefined,
				nonsense: undefined,
				// `-5` is not a valid delta-seconds and is not a date: unreadable, so the caller backs off itself.
				negative: undefined,
			},
		);
	});
});
