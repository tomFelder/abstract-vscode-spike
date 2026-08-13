/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { disposableTimeout } from '../../../../base/common/async.js';
import { Disposable, IDisposable, MutableDisposable } from '../../../../base/common/lifecycle.js';

/**
 * How long after a button is released a second click still belongs to the same gesture.
 *
 * Chromium decides what a double-click IS: it counts a second press as `detail: 2` - and fires the `dblclick`
 * that pins a document - only within its own 500ms threshold, and no browser exposes the user's real system
 * setting. 500ms is therefore the widest window a double-click can occupy; the margin on top covers timer
 * jitter and a slow first paint, so every sequence the platform would call a double-click is held whole.
 *
 * It is a hold, not a delay the user waits on: the pane settles this long after the LAST button release, and
 * only the rail's own furniture is held - the document opens the instant it is clicked, as it always did.
 */
export const CLICK_GESTURE_WINDOW_MS = 600;

/**
 * The longest a gesture is allowed to stay in flight without its release ever arriving. A `mouseup` that
 * lands outside this window's document (the pointer was dragged out of the application) would otherwise
 * hold the guard open for the rest of the session; this cap makes the worst case a few seconds of held
 * redraws rather than a rail that has stopped repainting.
 */
export const CLICK_GESTURE_STUCK_MS = 5000;

/** Schedules `handler` to run after `delayMs`; the returned disposable cancels it. Injected so tests can drive time. */
export type GestureScheduler = (handler: () => void, delayMs: number) => IDisposable;

/**
 * A guard around ONE rule: **within the double-click interval, nothing under the pointer may move as a
 * consequence of the first click.**
 *
 * A click in the tree rail opens a document, and opening a document changes what the rail draws - a new
 * Recent row, a different active row, a re-ordered jump-list. Whatever the layout does with that change, it
 * arrives BETWEEN the two clicks of a double-click, and anything it moves is something the second click was
 * aimed at. That is how a double-click came to pin a document the user never chose: the row they aimed at
 * slid away and another one took its place under the cursor.
 *
 * The fix is not to place the growing element somewhere safer - there is nowhere safe, because the second
 * click can land anywhere the first one could. It is to hold the CONSEQUENCES of the click until the gesture
 * that caused them is over. The guard holds from `begin` (button down) until the double-click window has
 * elapsed after `end` (button up), and replays exactly one deferred redraw when it releases. Geometry under
 * the cursor cannot change mid-gesture, and no space is permanently reserved to buy that.
 *
 * It keys off the GESTURE, not the pointer's position: a hover-scoped guard is defeated by any excursion
 * between the two clicks, while a gesture-scoped one holds under a shaky hand, a trackpad or an assistive
 * pointer. Press-and-hold is covered too - the window only starts once the button comes back up.
 */
export class ClickGestureGuard extends Disposable {

	private _down = false;
	private _held = false;
	private readonly _release = this._register(new MutableDisposable());

	constructor(
		private readonly _onRelease: () => void,
		private readonly _windowMs: number = CLICK_GESTURE_WINDOW_MS,
		private readonly _stuckMs: number = CLICK_GESTURE_STUCK_MS,
		private readonly _schedule: GestureScheduler = (handler, delayMs) => disposableTimeout(handler, delayMs),
	) {
		super();
	}

	/** True while a click sequence is in flight and layout changes must be held. */
	get inFlight(): boolean {
		return !!this._release.value;
	}

	/** A button went down: the gesture starts, and any pending release from the previous click is cancelled. */
	begin(): void {
		this._down = true;
		this._arm(this._stuckMs);
	}

	/** The button came up: the gesture stays in flight for the double-click window, then releases. */
	end(): void {
		if (!this._down) { return; } // a release from a press that started elsewhere is not our gesture
		this._down = false;
		this._arm(this._windowMs);
	}

	/**
	 * Ask to defer a layout change until the gesture is over. Returns true when it was held - the caller must
	 * NOT do the work now; it is replayed once through `onRelease`. Returns false when there is no gesture to
	 * protect and the caller should proceed immediately.
	 */
	hold(): boolean {
		if (!this.inFlight) { return false; }
		this._held = true;
		return true;
	}

	private _arm(delayMs: number): void {
		this._release.value = this._schedule(() => this._flush(), delayMs);
	}

	private _flush(): void {
		this._release.clear();
		if (!this._held) { return; }
		this._held = false;
		this._onRelease();
	}
}
