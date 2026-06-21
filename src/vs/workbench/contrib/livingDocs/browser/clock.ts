/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { mainWindow } from '../../../../base/browser/window.js';
import { IDisposable, toDisposable } from '../../../../base/common/lifecycle.js';

// A thin, injectable clock so cron + heartbeat scheduling is testable with a fake clock (spec 09
// section 8: the scheduler is a thin clock, not a framework). The orchestrator reads `now()` and
// registers a periodic tick; tests advance time and fire ticks deterministically.
export interface IClock {
	now(): number;
	scheduleInterval(intervalMs: number, callback: () => void): IDisposable;
}

export class RealClock implements IClock {
	now(): number { return Date.now(); }
	scheduleInterval(intervalMs: number, callback: () => void): IDisposable {
		const handle = mainWindow.setInterval(callback, intervalMs);
		return toDisposable(() => mainWindow.clearInterval(handle));
	}
}
