/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// @ts-check

// Per-user daily budget meter for the founder-funded OpenRouter fallback tier (plan 35 iter 3; doc 18
// section 2.1). This is a byte-faithful JS MIRROR of the authoritative, unit-tested TypeScript module at
// src/vs/workbench/contrib/livingDocs/common/spendMeter.ts. It exists because the proxy runs in a
// dependency-free Node process that cannot import compiled TypeScript; the two must be kept in sync, and the
// TS tests pin the behaviour this mirror has to match.
//
// PURE: no fetch, no file system, no wall clock. Reads an injectable clock (`clock.now()` returning epoch
// milliseconds) so day-rollover is deterministic in tests. All arithmetic is in US dollars.

'use strict';

class SpendMeter {
	/** @param {{ dailyBudgetUsd: number; clock: { now(): number } }} options */
	constructor(options) {
		// A non-positive budget would pause the very first call; clamp to a tiny positive floor so a
		// misconfigured budget never bricks the fallback (the proxy still logs the configured value).
		this._budgetUsd = options.dailyBudgetUsd > 0 ? options.dailyBudgetUsd : 0.0001;
		this._clock = options.clock;
		this._dayKey = this._currentDayKey();
		this._todayUsd = 0;
	}

	/** Days since the Unix epoch in UTC - a stable per-day bucket key that changes exactly at 00:00 UTC. */
	_currentDayKey() {
		return Math.floor(this._clock.now() / 86400000);
	}

	/** Reset the running total to zero when the clock has advanced into a new day since the last read. */
	_rolloverIfNewDay() {
		const day = this._currentDayKey();
		if (day !== this._dayKey) {
			this._dayKey = day;
			this._todayUsd = 0;
		}
	}

	/** True when today's included usage is already spent (checked BEFORE admitting a call). */
	isOverBudget() {
		this._rolloverIfNewDay();
		return this._todayUsd >= this._budgetUsd;
	}

	/** The running total spent today (US dollars), after applying any pending day rollover. */
	dailyTotalUsd() {
		this._rolloverIfNewDay();
		return this._todayUsd;
	}

	/**
	 * Charge one completed model call's cost against today's budget and report the new running total and
	 * whether the cap is now hit. A negative cost is treated as zero (a bad number never credits the budget).
	 * @param {number} costUsd
	 * @returns {{ dailyTotalUsd: number; capHit: boolean }}
	 */
	charge(costUsd) {
		this._rolloverIfNewDay();
		this._todayUsd += costUsd > 0 ? costUsd : 0;
		return { dailyTotalUsd: this._todayUsd, capHit: this._todayUsd >= this._budgetUsd };
	}
}

module.exports = { SpendMeter };
