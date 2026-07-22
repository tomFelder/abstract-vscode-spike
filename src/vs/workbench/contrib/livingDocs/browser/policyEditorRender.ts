/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { DOC_AUTONOMY_LEVELS, DocAutonomyLevel, docPolicyToneHex } from '../common/docPolicy.js';

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
// same way. `renderPolicyEditor.CLICK_SELECTOR` names the delegation target so hosts never hard-code it.

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
}

function escAttr(value: string): string {
	return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * Render the three-tier policy control as an HTML string. The selected row reads in its spec tone; the others
 * are quiet. Every row is a `[data-policy]` button so the host can delegate one click handler over the group.
 */
export function renderPolicyEditor(input: IPolicyEditorInput): string {
	const rows = DOC_AUTONOMY_LEVELS.map(option => {
		const on = option.level === input.selected;
		const toneHex = docPolicyToneHex(option.tone);
		// The selected row carries its tone in an inline custom property the CSS reads, so the one stylesheet
		// paints ok/attention/removed without a rule per level. Idle rows stay neutral.
		const style = on ? ` style="--pol-tone:${toneHex}"` : '';
		return `<button type="button" class="pol-opt${on ? ' on' : ''}" data-policy="${escAttr(option.level)}"${style}>`
			+ `<span class="pol-dot"></span>`
			+ `<span class="pol-text"><span class="pol-label">${escAttr(option.label)}</span>`
			+ `<span class="pol-desc">${escAttr(option.description)}</span></span>`
			+ `<span class="pol-check">${on ? '&#10003;' : ''}</span></button>`;
	}).join('');
	return `<div class="policy-editor" data-policy-editor="${escAttr(input.name)}">${rows}</div>`;
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
.pol-check{flex:none;margin-left:auto;font:600 12px/1 system-ui;color:var(--pol-tone);min-width:12px;text-align:right}`;
