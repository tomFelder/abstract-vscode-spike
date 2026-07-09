/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Per-user daily budget meter for the founder-funded OpenRouter fallback tier (plan 35 iter 3; doc 18
// section 2.1). The founder cannot fund API-priced usage for the cohort, so fallback spend is capped at a
// small daily budget per user (default US$1). This is the AUTHORITATIVE, unit-tested implementation of the
// metering contract; the proxy (scripts/lwd-spend-meter.js) carries a byte-faithful JS mirror because it
// runs in a dependency-free Node process that cannot import compiled TypeScript. Keep the two in sync - the
// tests here pin the behaviour the proxy must match.
//
// The module is PURE: no fetch, no file system, no service, no wall clock. It reads an injectable clock
// (`now()` returning epoch milliseconds) so the day-rollover reset is proven with a fake clock, never a
// real wall-clock wait - the IClock seam pattern established by decision 135. All arithmetic is in dollars.

/** The minimal clock the meter reads: epoch milliseconds. Injected so day rollover is testable. */
export interface ISpendClock {
	now(): number;
}

export interface ISpendMeterOptions {
	/** The per-user daily budget in US dollars. At or above this the day's included usage is spent. */
	readonly dailyBudgetUsd: number;
	/** The clock the meter reads to key spend by day and to detect a rollover. */
	readonly clock: ISpendClock;
}

/** The outcome of charging one model call against the day's budget. */
export interface ISpendOutcome {
	/** The running total spent today (US dollars) AFTER this charge, on the current day's ledger. */
	readonly dailyTotalUsd: number;
	/** True when the running total has reached or exceeded the daily budget - the day's usage is now spent. */
	readonly capHit: boolean;
}

/**
 * Accumulates per-day spend against a fixed daily budget, resetting automatically when the calendar day
 * rolls over. "Day" is the UTC calendar day of the injected clock (a stable, timezone-free key - the cap is
 * a fair-usage guardrail, not a billing boundary, so a fixed reference day avoids DST/locale ambiguity).
 *
 * The cap is enforced at the START of a request (`isOverBudget`), not by refusing a charge: a call that is
 * admitted always completes and is always charged, so the running total can end a hair over budget - that is
 * intentional (the last admitted call finishes; the NEXT call is the one that pauses). This mirrors the
 * plan's "in-flight work finishes, then the run pauses" contract.
 */
export class SpendMeter {
	private readonly _budgetUsd: number;
	private readonly _clock: ISpendClock;
	/** The day key (days since the epoch, UTC) the running total belongs to; a change triggers a reset. */
	private _dayKey: number;
	private _todayUsd: number;

	constructor(options: ISpendMeterOptions) {
		// A non-positive budget would pause the very first call; clamp to a tiny positive floor so a
		// misconfigured budget never bricks the fallback (the proxy still logs the configured value).
		this._budgetUsd = options.dailyBudgetUsd > 0 ? options.dailyBudgetUsd : 0.0001;
		this._clock = options.clock;
		this._dayKey = this._currentDayKey();
		this._todayUsd = 0;
	}

	/** Days since the Unix epoch in UTC - a stable per-day bucket key that changes exactly at 00:00 UTC. */
	private _currentDayKey(): number {
		return Math.floor(this._clock.now() / 86_400_000);
	}

	/** Reset the running total to zero when the clock has advanced into a new day since the last read. */
	private _rolloverIfNewDay(): void {
		const day = this._currentDayKey();
		if (day !== this._dayKey) {
			this._dayKey = day;
			this._todayUsd = 0;
		}
	}

	/** True when today's included usage is already spent (checked BEFORE admitting a call). */
	isOverBudget(): boolean {
		this._rolloverIfNewDay();
		return this._todayUsd >= this._budgetUsd;
	}

	/** The running total spent today (US dollars), after applying any pending day rollover. */
	dailyTotalUsd(): number {
		this._rolloverIfNewDay();
		return this._todayUsd;
	}

	/**
	 * Charge one completed model call's cost against today's budget and report the new running total and
	 * whether the cap is now hit. A negative cost is treated as zero (a bad number never credits the budget).
	 */
	charge(costUsd: number): ISpendOutcome {
		this._rolloverIfNewDay();
		this._todayUsd += costUsd > 0 ? costUsd : 0;
		return { dailyTotalUsd: this._todayUsd, capHit: this._todayUsd >= this._budgetUsd };
	}
}
