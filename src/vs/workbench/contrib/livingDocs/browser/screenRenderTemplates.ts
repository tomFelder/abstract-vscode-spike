/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Templates (v2, plan 48): the pattern gallery on the white surface - a template is a living doc with empty
// binds. Three parts: the no-rails shell (a live filter field in the title row), the YOUR TEMPLATES 3-col
// grid of skeleton-thumbnail cards derived from each template's PARSED doc (grey prose bars + accent-tint
// bind-slot chips that literally show where live data lands), and a STARTERS row of four quieter built-ins.
// Only `renderTemplates` is public. Split out of screenRender.ts so the Home + Templates lane owns its own
// file; shared helpers come from the shell. Real data only: cards + counts come from listTemplateGallery(),
// and the "used N times" count is real lineage (honest "used 0"), never a hardcoded number.

import { localize } from '../../../../nls.js';
import { ITemplateSkeletonRow } from '../common/livingDocMarkdown.js';
import { ITemplateCard } from '../common/livingDocs.js';
import { esc, IScreenState, pickerSheet, pickRow } from './screenRenderShell.js';

/** One built-in starter (T3): a compact seed created through the existing review-safe path (a blank named doc). */
interface IStarter {
	/** The starter id posted to the host (`newStarter`), mapping to its document name. */
	readonly id: string;
	/** The card title, also the created document's name. */
	readonly name: string;
	/** The one-line purpose beneath the name. */
	readonly purpose: string;
}

// The four built-in starters (T3.1), a STATIC manifest (never model output). Each creates its named document
// through the existing review-safe creation path (a blank titled `.md`, opened for editing) - no fabricated
// prose is written for the user (decision 17). Visually subordinate so YOUR TEMPLATES stays the hero.
function starters(): readonly IStarter[] {
	return [
		{ id: 'blank', name: localize("livingDocs.templates.starter.blank.name", "Blank living doc"), purpose: localize("livingDocs.templates.starter.blank.purpose", "Empty page, agent-ready") },
		{ id: 'project-brief', name: localize("livingDocs.templates.starter.brief.name", "Project brief"), purpose: localize("livingDocs.templates.starter.brief.purpose", "Goals · scope · risks") },
		{ id: 'meeting-notes', name: localize("livingDocs.templates.starter.meeting.name", "Meeting notes"), purpose: localize("livingDocs.templates.starter.meeting.purpose", "Binds a transcript source") },
		{ id: 'metrics-digest', name: localize("livingDocs.templates.starter.metrics.name", "Metrics digest"), purpose: localize("livingDocs.templates.starter.metrics.purpose", "Table + figure narrative") },
	];
}

// One skeleton-thumbnail row (T2.2), drawn from the template's PARSED doc: a `title` row is a stronger grey
// bar (`#D5D8DE`), a `prose` row is a lighter grey bar (`#E9EAEE`), and a `slots` row is one accent-tint chip
// (`#E0E5FB`) per bind slot on that line - so the accent bars sit exactly where live data will land.
function skeletonRow(row: ITemplateSkeletonRow): string {
	if (row.kind === 'slots') {
		const chips = (row.slots ?? []).map(w => `<span style="width:${w}px;height:12px;border-radius:4px;background:#E0E5FB"></span>`).join('');
		return `<div style="display:flex;gap:5px;margin-top:2px">${chips}</div>`;
	}
	const colour = row.kind === 'title' ? '#D5D8DE' : '#E9EAEE';
	const height = row.kind === 'title' ? 9 : 6;
	return `<div style="width:${row.widthPct ?? 80}%;height:${height}px;border-radius:3px;background:${colour}"></div>`;
}

// The 110px skeleton thumbnail (T2.2): the parsed-doc rows on the `#F6F7F9` canvas with a `#EEF0F3` bottom
// border. No screenshots, no canned art - every bar is derived from the template's real structure.
function thumbnail(card: ITemplateCard): string {
	const rows = card.skeleton.map(skeletonRow).join('');
	return `<div style="height:110px;background:#F6F7F9;border-bottom:1px solid #EEF0F3;padding:16px 18px 0;display:flex;flex-direction:column;gap:6px">${rows}</div>`;
}

// ---- Templates (v2, plan 48 T1-T3): the pattern gallery. ----
export function renderTemplates(state: IScreenState): string {
	// The screen body floats on the plan-44 elevation card (the editor part paints the white paper + radius 14
	// + shadow-editor on chrome); the webview body is transparent so that card shows through - Templates never
	// repaints its own canvas (shell CSS belongs to plan 44). Same no-rails shell as Home.
	const scroll = (inner: string) => `<div class="screen" style="background:transparent"><div style="flex:1;overflow-y:auto;background:transparent">${inner}</div></div>`;

	const cards = state.templateCards ?? [];
	const exampleDocs = state.docFiles ?? [];

	// The from-examples wizard (F18, journey 1x): its picker offers the project's real documents as examples.
	// Real data only - the options come from the service's folder scan; with none the sheet shows a calm empty
	// line. Kept from plan 28 (the New-template door still grows a template from past work).
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

	// The STARTERS row (T3): four quieter built-in cards (rail bg, no thumbnail), visually subordinate to YOUR
	// TEMPLATES. Each creates its named document through the existing review-safe path (`newStarter`).
	const starterCard = (s: IStarter) => `<button data-msg="newStarter" data-arg="${esc(s.id)}" class="tpl-starter" style="text-align:left;background:#FBFCFD;border:1px solid #E9EAEE;border-radius:13px;padding:14px 16px;cursor:pointer">
			<div style="font:600 13px/1.2 system-ui;color:#1A1C20;margin-bottom:3px">${esc(s.name)}</div>
			<div style="font:400 12px/1.4 system-ui;color:#868B95">${esc(s.purpose)}</div>
		</button>`;
	const startersRow = `<div style="font-family:'JetBrains Mono',ui-monospace,monospace;font-size:10px;font-weight:600;letter-spacing:.12em;color:#A3A8B2;margin-bottom:10px">${localize("livingDocs.templates.starters", "STARTERS")}</div>
		<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px">${starters().map(starterCard).join('')}</div>`;

	// The title row (T1.1): the 30/600 title, a spacer, and the 240px live filter field. The header's
	// "+ New template" action is the plan-44 global header's (not drawn here). Sub-line is EXACT (T1.2).
	const titleRow = `<div style="display:flex;align-items:center;gap:14px;margin-bottom:6px">
			<h1 style="margin:0;font:600 30px/1.12 system-ui;color:#14161A;letter-spacing:-.02em">${localize("livingDocs.templates.title", "Templates")}</h1>
			<span style="flex:1"></span>
			<label class="tpl-filter">&#8981;<input data-tpl-filter type="text" placeholder="${localize("livingDocs.templates.filter", "Filter templates…")}" aria-label="${localize("livingDocs.templates.filter", "Filter templates…")}"></label>
		</div>
		<div style="font:400 14px/1.4 system-ui;color:#868B95;margin-bottom:32px">${localize("livingDocs.templates.sub", "Start a living document from a pattern. Sources bind after creation.")}</div>`;

	// A template card (T2.1-T2.3): the 110px skeleton thumbnail over the body (name 14/600 + LWD chip, a
	// one-line description naming the expected source, and the mono "N bind slots, used N" meta with the
	// accent Use button). `data-filter` (name + description, lower-cased) drives the live filter.
	const card = (c: ITemplateCard) => {
		const slotLabel = c.bindSlots === 1
			? localize("livingDocs.templates.card.slot.one", "1 bind slot")
			: localize("livingDocs.templates.card.slot.many", "{0} bind slots", c.bindSlots);
		const usedLabel = localize("livingDocs.templates.card.used", "used {0}&times;", c.usageCount);
		const desc = c.description.trim() || localize("livingDocs.templates.card.noDesc", "A reusable pattern for a new document.");
		const uri = esc(c.uri.toString());
		const filterKey = esc((c.name + ' ' + c.description).toLowerCase());
		return `<div class="tpl-card" data-filter="${filterKey}" style="background:#fff;border:1px solid #E6E8EC;border-radius:13px;overflow:hidden;box-shadow:0 1px 2px rgba(20,22,28,.05)">
			${thumbnail(c)}
			<div style="padding:14px 18px">
				<div style="display:flex;align-items:center;gap:8px;margin-bottom:4px"><span style="font:600 14px/1.2 system-ui;color:#1A1C20;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(c.name)}</span><span style="flex:1"></span><span style="font-family:'JetBrains Mono',ui-monospace,monospace;font-size:9.5px;font-weight:600;color:#5B6DC4;background:#F4F5FD;border:1px solid #E0E5FB;border-radius:5px;padding:2px 5px">LWD</span></div>
				<div style="font:400 12.5px/1.5 system-ui;color:#868B95">${esc(desc)}</div>
				<div style="display:flex;align-items:center;gap:6px;margin-top:10px"><span style="font-family:'JetBrains Mono',ui-monospace,monospace;font-size:10px;color:#A3A8B2">${slotLabel} &middot; ${usedLabel}</span><span style="flex:1"></span><button class="btn-primary" style="height:26px;padding:0 11px;font:600 12px/1 system-ui;border-radius:7px" data-msg="useTemplate" data-arg="${uri}">${localize("livingDocs.templates.card.use", "Use")}</button></div>
			</div>
		</div>`;
	};

	// The dashed Save-current-doc-as-template tile (T2.5, closes the grid). It writes the ACTIVE document to
	// `.abstract/templates/<name>.template.md` with its binds emptied to slots + `template: true` frontmatter;
	// the service fires onDidChange so the new card appears in the grid (T2.6 discovery). With no document
	// active the service answers with a plain-words nudge rather than a silent no-op (never a dead button).
	const saveTile = `<button class="tpl-newtile" data-msg="saveAsTemplate" style="border:1px dashed #C6CAD2;background:none;border-radius:13px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;color:#868B95;cursor:pointer;min-height:220px">
			<span style="font-size:22px">&#65291;</span><span style="font:500 13px/1 system-ui">${localize("livingDocs.templates.saveAsTemplate", "Save current doc as template")}</span>
		</button>`;

	// A "no matches" line for the live filter (T1.1): shown only when the query hides every card (toggled by
	// the shell script), so the grid never reads as an empty/broken surface.
	const noMatch = `<div data-tpl-nomatch style="display:none;font:400 13px/1.5 system-ui;color:#868B95;margin-bottom:36px">${localize("livingDocs.templates.noMatch", "No templates match your filter.")}</div>`;

	// The calm empty state (real-data guardrail): no templates on disk -> the title + sub-line, the honest
	// empty line and the two ways in, plus the STARTERS row (the four built-ins are always a way to begin).
	if (cards.length === 0) {
		const emptyActions = exampleDocs.length
			? `<button class="btn-primary" style="padding:11px 18px;font:600 13px/1 system-ui" data-sheet-open="fromexamples">${localize("livingDocs.templates.empty.fromExamples", "New from examples")}</button>
				<button class="btn-ghost" style="padding:10px 16px;font:500 12.5px/1 system-ui" data-msg="newTemplate">${localize("livingDocs.templates.empty.blank", "New blank template")}</button>`
			: `<button class="btn-primary" style="padding:11px 18px;font:600 13px/1 system-ui" data-msg="newTemplate">${localize("livingDocs.templates.empty.first", "Create your first template")}</button>`;
		return scroll(`<div style="max-width:1180px;margin:0 auto;padding:56px 48px 80px">
			${titleRow}
			<div style="font-family:'JetBrains Mono',ui-monospace,monospace;font-size:10px;font-weight:600;letter-spacing:.12em;color:#A3A8B2;margin-bottom:10px">${localize("livingDocs.templates.yourTemplates", "YOUR TEMPLATES")}</div>
			<div style="border:1px solid #E9EAEE;border-radius:13px;background:#FBFCFD;padding:40px 32px;text-align:center;margin-bottom:36px">
				<div style="font:600 15px/1.3 system-ui;color:#15171c;margin-bottom:6px">${localize("livingDocs.templates.empty.title", "No templates yet")}</div>
				<p style="margin:0 0 20px;font:400 13px/1.6 system-ui;color:#868B95;max-width:440px;margin-left:auto;margin-right:auto">${localize("livingDocs.templates.empty.body", "A template is a living document with its binds left empty - a pattern for the next document. Grow one from a few past documents, or start from a blank one below.")}</p>
				<div style="display:flex;gap:10px;align-items:center;justify-content:center">${emptyActions}</div>
			</div>
			${startersRow}
			${fromExamplesSheet}
		</div>`);
	}

	const grid = `<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:14px;margin-bottom:36px">${cards.map(card).join('')}${saveTile}</div>`;
	return scroll(`<div style="max-width:1180px;margin:0 auto;padding:56px 48px 80px">
		${titleRow}
		<div style="font-family:'JetBrains Mono',ui-monospace,monospace;font-size:10px;font-weight:600;letter-spacing:.12em;color:#A3A8B2;margin-bottom:10px">${localize("livingDocs.templates.yourTemplates", "YOUR TEMPLATES")}</div>
		${grid}
		${noMatch}
		${startersRow}
	</div>`);
}
