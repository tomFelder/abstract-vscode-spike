/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Templates: the real template library (a card grid of the project's `*.template.md` files) plus the
// from-examples wizard and the generate sheet. Only `renderTemplates` is public. Split out of
// screenRender.ts so the Home + Templates lane owns its own file; shared helpers come from the shell.

import { countTemplateSlots } from '../common/livingDocMarkdown.js';
import { ITemplateInfo } from '../common/livingDocs.js';
import { avatar, esc, IScreenState, pickerSheet, pickRow, sheet } from './screenRenderShell.js';

// ---- Templates (plan 28): the real template library. A card grid of the `*.template.md` files discovered
// in the project (plus the starters we ship), each with a Use Template + Edit action, and New Template. An
// empty folder shows a calm invitation. Real data only: cards + counts come from listTemplates(). ----
export function renderTemplates(state: IScreenState): string {
	const templates = state.templates ?? [];

	// One paper card per template (comp style: 2-letter avatar, name, description, mono `N slots · M sources`
	// count line, Use Template primary + Edit ghost). Counts are TRUE - slots from the body, sources from the
	// declared `sources:` list. The description falls back to a calm neutral line only when none was authored.
	const card = (t: ITemplateInfo) => {
		const av = avatar(t.name);
		const slots = countTemplateSlots(t.body);
		const srcCount = t.sources.length;
		const counts = `${slots} slot${slots === 1 ? '' : 's'} &middot; ${srcCount} source${srcCount === 1 ? '' : 's'}`;
		const desc = t.description.trim() || 'A reusable starting point for a new document.';
		const uri = esc(t.uri.toString());
		return `<div style="display:flex;flex-direction:column;background:#fff;border:1px solid #e9eaee;border-radius:14px;padding:20px 20px 16px;gap:12px">
			<div style="display:flex;align-items:center;gap:10px">
				<span style="width:34px;height:34px;flex:none;border-radius:9px;background:${av.color};color:#fff;font:600 13px/34px system-ui;text-align:center">${av.text}</span>
				<span style="font:600 15px/1.25 system-ui;color:#1a1c20;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(t.name)}</span>
			</div>
			<div style="font:400 13px/1.5 system-ui;color:#52575f;flex:1;min-height:38px">${esc(desc)}</div>
			<div style="font:400 11px/1 'JetBrains Mono',ui-monospace,monospace;color:#a3a8b2">${counts}</div>
			<div style="display:flex;gap:8px;margin-top:4px">
				<button class="btn-primary" style="flex:1;padding:10px;font:600 13px/1 system-ui" data-msg="generateFromTemplate" data-sheet-open="generate" data-arg="${uri}" data-name="">Use Template</button>
				<button class="btn-ghost" style="padding:9px 14px;font:500 12px/1 system-ui" data-msg="editTemplate" data-arg="${uri}">Edit</button>
			</div>
		</div>`;
	};

	// The from-examples wizard (F18, journey 1x): its picker offers the project's real documents as examples.
	// The agent names what they share THROUGH THE REVIEW GRAMMAR, then proposes a real template file. Real
	// data only - the options come from the service's folder scan; with none the sheet shows a calm empty line.
	const exampleDocs = state.docFiles ?? [];
	const exampleRows = exampleDocs.map(f => pickRow(f, f, 'document')).join('');
	const fromExamplesSheet = pickerSheet('fromexamples', {
		title: 'New template from examples',
		sub: 'Pick 3-10 past documents. The agent names what they share - structure, recurring figures, tone - as changes to review, then proposes a template file.',
		nameLabel: 'Template Name',
		namePlaceholder: 'e.g. Board note',
		pickLabel: 'Example documents (3-10)',
		submitMsg: 'newTemplateFromExamples',
		submitLabel: 'Analyse Examples',
		rows: exampleRows,
		empty: 'This project has no documents to learn from yet. Add a few finished documents to grow a template from them.',
	});

	// The calm empty state (real-data guardrail): no templates on disk -> one line + the two ways in. The
	// from-examples wizard leads (journey 1x is its whole subject) when there are documents to learn from; the
	// blank manual editor is always offered as the second, quieter way.
	if (templates.length === 0) {
		const emptyActions = exampleDocs.length
			? `<button class="btn-primary" style="padding:11px 18px;font:600 13px/1 system-ui" data-sheet-open="fromexamples">New from examples</button>
				<button class="btn-ghost" style="padding:10px 16px;font:500 12.5px/1 system-ui" data-msg="newTemplate">New blank template</button>`
			: `<button class="btn-primary" style="padding:11px 18px;font:600 13px/1 system-ui" data-msg="newTemplate">Create your first template</button>`;
		return `<div class="screen">
	<div class="scr-head" style="display:block"><h2 class="scr-title">Templates</h2><div class="scr-sub">Reusable starting points for new documents.</div></div>
	<div class="scr-body"><div style="flex:1;min-height:60vh;display:flex;align-items:center;justify-content:center">
		<div style="text-align:center;max-width:440px;padding:40px">
			<div style="font-size:40px;line-height:1;margin-bottom:16px">&#9636;</div>
			<div style="font:600 17px/1.3 system-ui;color:#15171c;margin-bottom:8px">No templates yet</div>
			<p style="margin:0 0 22px;font:400 13.5px/1.6 system-ui;color:#52575f">A template is an ordinary Markdown file in this project with a structure, sources and a brief. Grow one from a few past documents, or author one by hand.</p>
			<div style="display:flex;gap:10px;align-items:center;justify-content:center">${emptyActions}</div>
		</div>
	</div></div>
	${fromExamplesSheet}
</div>`;
	}

	const grid = `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:16px">${templates.map(card).join('')}</div>`;
	// The D28-B generate sheet: one calm prompt (document name + an optional note), shared across cards - the
	// card that opened it carries its template URI. Generate drafts the document through the review engine.
	const generateSheet = sheet('generate', {
		title: 'New document from a template',
		sub: 'Name it, then generate a first draft. The draft arrives as changes to review - nothing is written for you.',
		nameLabel: 'Document Name',
		namePlaceholder: 'e.g. Weekly report - week 24',
		note: true,
		body: `<div style="display:flex;gap:8px;margin-top:20px;justify-content:flex-end">
			<button class="btn-ghost" data-sheet-close="generate">Cancel</button>
			<button class="btn-primary" data-sheet-submit data-sheet-default data-msg="generateFromTemplate">Generate Draft</button>
		</div>`,
	});
	return `<div class="screen">
	<div class="scr-head" style="display:block"><h2 class="scr-title">Templates</h2><div class="scr-sub">Reusable starting points for new documents.</div></div>
	<div class="scr-body">
		<div style="max-width:1080px;margin:0 auto;padding:28px 36px 80px">
			<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:18px">
				<span style="font:600 11px/1 'JetBrains Mono',ui-monospace,monospace;letter-spacing:.12em;color:#a3a8b2">${templates.length} TEMPLATE${templates.length === 1 ? '' : 'S'}</span>
				<div style="display:flex;gap:8px">
					${exampleDocs.length ? `<button class="btn-primary" style="padding:9px 15px;font:600 12.5px/1 system-ui" data-sheet-open="fromexamples">New From Examples</button>` : ''}
					<button class="btn-ghost" style="padding:9px 14px;font:500 12.5px/1 system-ui" data-msg="newTemplate">New Blank Template</button>
				</div>
			</div>
			${grid}
		</div>
	</div>
	${generateSheet}
	${fromExamplesSheet}
</div>`;
}
