/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../nls.js';
import { DOC_AUTONOMY_LEVELS, DocAutonomyLevel, docPolicyDefaultHint, docPolicyToneHex } from '../common/docPolicy.js';

// The shared plain-language policy editor - browser renderer (spec 43 section 3.4; owner plan 45 / PR-c;
// consumer plan 49). Pairs with the pure `common/docPolicy.ts` grammar. This is the ONE renderer for the
// three-tier autonomy control, so the document Properties panel (plan 45) and the Agents cards (plan 49) show
// pixel-identical policy UI with no duplicate markup (principle P2).
//
// The reuse contract in one paragraph: call `renderPolicyEditor({ selected, name })` to get the control's HTML
// string - a labelled list of the three levels (`auto-apply` / `ask-first` / `never`), the current one marked
// selected and tinted with its spec tone, each row carrying `data-policy="<level>"` and grouped under
// `data-policy-editor="<name>"`. The HOST is responsible for exactly one thing: delegate clicks on
// `[data-policy]` and, when one fires, read its `data-policy` value and its container's `data-policy-editor`
// name, then persist that level however the host persists (the Properties panel writes the doc's frontmatter
// `policy:` on disk; plan 49's agent card writes the agent registry). The renderer owns no state and posts no
// messages - it is pure `(model) -> html`, so a host in a webview and a host in the workbench render it the
// same way. `renderPolicyEditor.CLICK_SELECTOR` names the delegation target so hosts never hard-code it. A host
// whose level is only a DEFAULT (an un-dialled document) adds `unset: true`, and the control says so rather than
// dressing an unchosen level up as the reader's own choice.

/** The input a host hands the renderer: which level is current, plus a stable name to disambiguate the control. */
export interface IPolicyEditorInput {
	/** The currently selected autonomy level (coerce a stored string through `coerceDocPolicy` first). */
	readonly selected: DocAutonomyLevel;
	/**
	 * A stable identifier for this control instance, echoed as `data-policy-editor` so a host with several
	 * policy editors on one surface (plan 49's agent cards) can tell which one a click came from. For the doc
	 * Properties panel this is the document id; for an agent card it is the agent id.
	 */
	readonly name: string;
	/**
	 * True when NO human has chosen this level yet and `selected` is merely what is in effect by default (an
	 * un-dialled document - pass `effectiveDocPolicy(...)` as `selected`). The row still reads in its tone,
	 * because that IS the behaviour, but it is badged "Default" instead of ticked and a hint says the level is
	 * unset - so the control never presents an unchosen level as the reader's own choice. Hosts whose level is
	 * always authored (the Agents cards, whose registry always carries a policy) simply omit it.
	 */
	readonly unset?: boolean;
}

function escAttr(value: string): string {
	return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * Render the three-tier policy control as an HTML string. The selected row reads in its spec tone; the others
 * are quiet. Every row is a `[data-policy]` button so the host can delegate one click handler over the group.
 * When `unset` is set the marked row is the one in effect BY DEFAULT: it is badged "Default" rather than ticked
 * and the group carries a hint naming the unset state, so an un-dialled document reads honestly.
 */
export function renderPolicyEditor(input: IPolicyEditorInput): string {
	const rows = DOC_AUTONOMY_LEVELS.map(option => {
		const on = option.level === input.selected;
		const toneHex = docPolicyToneHex(option.tone);
		// The selected row carries its tone in an inline custom property the CSS reads, so the one stylesheet
		// paints ok/attention/removed without a rule per level. Idle rows stay neutral.
		const style = on ? ` style="--pol-tone:${toneHex}"` : '';
		// A tick means "you chose this"; an unset control says "Default" instead, so the badge never claims a
		// choice nobody made while the row still shows what actually happens.
		const mark = on ? (input.unset ? `<span class="pol-default">${escAttr(localize('livingDocs.policy.defaultBadge', "Default"))}</span>` : '&#10003;') : '';
		return `<button type="button" class="pol-opt${on ? ' on' : ''}" data-policy="${escAttr(option.level)}"${style}>`
			+ `<span class="pol-dot"></span>`
			+ `<span class="pol-text"><span class="pol-label">${escAttr(option.label)}</span>`
			+ `<span class="pol-desc">${escAttr(option.description)}</span></span>`
			+ `<span class="pol-check">${mark}</span></button>`;
	}).join('');
	const hint = input.unset ? `<div class="pol-hint">${escAttr(docPolicyDefaultHint())}</div>` : '';
	return `<div class="policy-editor" data-policy-editor="${escAttr(input.name)}"${input.unset ? ' data-policy-unset' : ''}>${rows}${hint}</div>`;
}

/** The delegation target a host binds one click handler to; also selects a row's level via `data-policy`. */
renderPolicyEditor.CLICK_SELECTOR = '[data-policy]';

/**
 * The shared stylesheet for the policy editor, so every host paints the control identically. Hosts inline this
 * once into their `<style>`. Colours per spec pin 12 / A2 (the tone is carried per-row via `--pol-tone`).
 */
export const POLICY_EDITOR_STYLE = `.policy-editor{display:flex;flex-direction:column;gap:4px}
.pol-opt{display:flex;align-items:flex-start;gap:9px;width:100%;text-align:left;border:1px solid #EDEFF3;border-radius:9px;background:#fff;padding:8px 10px;cursor:pointer;font:inherit;color:#3a3f49}
.pol-opt:hover{background:#F6F7F9}
.pol-opt.on{border-color:color-mix(in srgb,var(--pol-tone) 40%,#E9EAEE);background:color-mix(in srgb,var(--pol-tone) 7%,#fff)}
.pol-dot{flex:none;width:8px;height:8px;border-radius:50%;margin-top:4px;background:#D5D8DE}
.pol-opt.on .pol-dot{background:var(--pol-tone)}
.pol-text{display:flex;flex-direction:column;gap:2px;min-width:0}
.pol-label{font:600 12.5px/1.2 system-ui;color:#3a3f49}
.pol-opt.on .pol-label{color:var(--pol-tone)}
.pol-desc{font:400 11px/1.35 system-ui;color:#868b95}
.pol-check{flex:none;margin-left:auto;font:600 12px/1 system-ui;color:var(--pol-tone);min-width:12px;text-align:right}
.pol-default{display:inline-block;border:1px solid color-mix(in srgb,var(--pol-tone) 35%,#E9EAEE);border-radius:999px;padding:2px 7px;font:600 9.5px/1 system-ui;letter-spacing:.04em;text-transform:uppercase;color:var(--pol-tone);background:color-mix(in srgb,var(--pol-tone) 10%,#fff)}
.pol-hint{font:400 11px/1.45 system-ui;color:#868b95;padding:2px 2px 0}`;
