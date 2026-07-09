/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { ISpendClock, SpendMeter } from '../../common/spendMeter.js';

// Per-user daily budget meter (plan 35 iter 3; doc 18 section 2.1). The founder-funded OpenRouter fallback
// is capped at a small daily budget per user; at the cap the run pauses gracefully and resumes at day
// rollover. The meter is pure and reads an injectable clock (decision 135's IClock seam), so accumulation,
// the cap trip, the day-rollover reset, and the resume are proven with a FAKE clock - never a wall-clock
// wait. The proxy carries a byte-faithful JS mirror (scripts/lwd-spend-meter.js); these tests pin the
// behaviour both must match.

suite('livingDocs spendMeter (plan 35 iter 3)', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	// A mutable fake clock: `at` sets the wall time the meter reads, in epoch milliseconds.
	class FakeClock implements ISpendClock {
		private _ms: number;
		constructor(ms: number) { this._ms = ms; }
		now(): number { return this._ms; }
		at(ms: number): void { this._ms = ms; }
	}

	const DAY = 86_400_000;
	// A fixed reference day (day 20_000 since the epoch), noon UTC, so a same-day advance never crosses midnight.
	const NOON = 20_000 * DAY + DAY / 2;

	// Charge values are binary-clean fractions (eighths of a dollar) so the running totals are exact for a
	// deepStrictEqual - the meter accumulates real floats, and non-clean costs would drift by a rounding ulp.

	test('accumulates spend within the day and reports the running total, not yet capped', () => {
		const clock = new FakeClock(NOON);
		const meter = new SpendMeter({ dailyBudgetUsd: 1, clock });
		const first = meter.charge(0.25);
		const second = meter.charge(0.5);
		assert.deepStrictEqual(
			{ over: meter.isOverBudget(), total: meter.dailyTotalUsd(), first, second },
			{ over: false, total: 0.75, first: { dailyTotalUsd: 0.25, capHit: false }, second: { dailyTotalUsd: 0.75, capHit: false } },
		);
	});

	test('trips the cap when the running total reaches the budget, and stays over for the next call', () => {
		const clock = new FakeClock(NOON);
		const meter = new SpendMeter({ dailyBudgetUsd: 1, clock });
		meter.charge(0.5);
		const tripping = meter.charge(0.75); // total 1.25 >= 1 -> cap hit; the admitted call still completed
		assert.deepStrictEqual(
			{ tripping, overAfter: meter.isOverBudget(), total: meter.dailyTotalUsd() },
			{ tripping: { dailyTotalUsd: 1.25, capHit: true }, overAfter: true, total: 1.25 },
		);
	});

	test('resets the running total to zero when the clock rolls into a new day (resume)', () => {
		const clock = new FakeClock(NOON);
		const meter = new SpendMeter({ dailyBudgetUsd: 1, clock });
		meter.charge(1.2); // spent for today
		const overToday = meter.isOverBudget();
		clock.at(NOON + DAY); // next calendar day
		const overTomorrow = meter.isOverBudget();
		const afterRollover = meter.charge(0.2); // a fresh day's ledger starts at zero
		assert.deepStrictEqual(
			{ overToday, overTomorrow, afterRollover },
			{ overToday: true, overTomorrow: false, afterRollover: { dailyTotalUsd: 0.2, capHit: false } },
		);
	});

	test('a negative cost never credits the budget (a bad number cannot un-spend the day)', () => {
		const clock = new FakeClock(NOON);
		const meter = new SpendMeter({ dailyBudgetUsd: 1, clock });
		meter.charge(0.75);
		const outcome = meter.charge(-5); // ignored, not subtracted
		assert.deepStrictEqual(outcome, { dailyTotalUsd: 0.75, capHit: false });
	});
});
