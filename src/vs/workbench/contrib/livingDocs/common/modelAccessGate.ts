/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, Event } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { URI } from '../../../../base/common/uri.js';
import { IModelProviderStatus, IPendingModelPrompt } from './livingDocs.js';

/**
 * Plan 42 slice L2 - "Model access moves to first AI use".
 *
 * The entry path shows NO model/account decision. The first time the user invokes the agent (a chat send, a
 * skill run, any AI door) while no backend is configured, the sign-in vs included-model choice must render
 * INLINE in the chat rail at that moment, and picking a door must proceed with the ORIGINAL request without
 * losing the typed prompt.
 *
 * This is the extractable, DOM-free, service-free state machine behind that behaviour, so the pending-prompt /
 * inline-choice contract is unit-testable in isolation (no model, no broker, no workbench). The service owns one
 * instance; the review rail reads its pending state to render the inline choice and calls back to replay.
 */

/**
 * Whether a send against this provider status must first show the inline model-access choice. True only when no
 * usable door is serving: `provider === 'none'` - the broker reports no configured backend (`unconfigured`) or
 * is not up yet (`broker-down`). A signed-in ChatGPT tier or a ready/paused included tier is NOT gated here:
 *   - `chatgpt` / `included` + `ready`  -> serve the request (no gate);
 *   - `included` + `budget-paused`      -> the day's cap is spent; the existing calm paused turn handles it,
 *                                          NOT the first-use choice (a door is already chosen, just rate-capped);
 *   - `none`    + `unconfigured`/`broker-down` -> no backend chosen yet: this is the first-AI-use moment.
 *
 * Pure so the gating decision is proven deterministically without a broker.
 */
export function needsModelChoice(status: IModelProviderStatus): boolean {
	return status.provider === 'none' && (status.readiness === 'unconfigured' || status.readiness === 'broker-down');
}

/**
 * Holds the at-most-one pending prompt per document and fires when that set changes so the rail re-renders the
 * inline choice (or drops it once the prompt is replayed / cleared). Keyed by resource so several open documents
 * can each hold their own first-use prompt independently. The prompt lives in memory only; the ChatGPT sign-in
 * round-trip polls in-process (no workbench reload), so an in-memory hold survives it - the prompt is replayed
 * verbatim the moment a door is chosen.
 */
export class ModelAccessGate extends Disposable {

	private readonly _pending = new Map<string, IPendingModelPrompt>();

	private readonly _onDidChangePending = this._register(new Emitter<void>());
	/** Fires whenever a prompt is held, replayed, or cleared, so the rail re-renders. */
	readonly onDidChangePending: Event<void> = this._onDidChangePending.event;

	/**
	 * Record the first-use prompt for `resource`, replacing any earlier one (the newest send wins - a user who
	 * edits and re-sends before choosing a door gets the latest text replayed). Fires the change event.
	 */
	holdPrompt(resource: URI, text: string, displayText?: string): void {
		this._pending.set(resource.toString(), { resource, text, displayText });
		this._onDidChangePending.fire();
	}

	/** The prompt held for `resource`, or undefined when none is pending. Read by the rail to render the choice. */
	getPending(resource: URI): IPendingModelPrompt | undefined {
		return this._pending.get(resource.toString());
	}

	/** Whether a first-use prompt is currently held for `resource`. */
	hasPending(resource: URI): boolean {
		return this._pending.has(resource.toString());
	}

	/**
	 * Pop the held prompt for `resource` for replay: returns it and removes it from the pending set (firing the
	 * change event so the inline choice disappears), or undefined when none was held. The caller replays it.
	 */
	takePending(resource: URI): IPendingModelPrompt | undefined {
		const key = resource.toString();
		const pending = this._pending.get(key);
		if (pending) {
			this._pending.delete(key);
			this._onDidChangePending.fire();
		}
		return pending;
	}

	/** Drop any held prompt for `resource` without replaying it (e.g. the user dismisses the choice). */
	clear(resource: URI): void {
		if (this._pending.delete(resource.toString())) {
			this._onDidChangePending.fire();
		}
	}
}
