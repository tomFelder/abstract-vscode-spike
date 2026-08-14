/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Templates (round 2, comp panel 4b): the gallery of patterns a recurring report is born from, repainted
// onto the warm-paper design system (docs/28-design-system-round2.md). Three parts: the title block, the
// 3-column card grid (a skeleton thumbnail drawn from the template's PARSED doc, outcome copy, Use + Edit),
// and the two dashed on-ramps that create the next template - grow one from past documents, or save the
// current document as one. Only `renderTemplates` is public.
//
// The correction this screen is judged on (comp caption 4b): "outcome copy instead of '1 slot · 0 sources';
// grow-from-examples on-ramp; no rainbow avatars". A card's meta line therefore says what the template does
// FOR the reader ("draws on metrics.csv · used every week"), never how it is built inside ("1 bind slot").
// Real data only: the cards, their sources and their usage counts come from listTemplateGallery(), so a
// template nothing was born from honestly reads "not used yet".

import { localize } from '../../../../nls.js';
import { ITemplateSkeletonRow } from '../common/livingDocMarkdown.js';
import { ITemplateCard } from '../common/livingDocs.js';
import { FONT, HAIRLINE, INDIGO, INK, PAPER, RADIUS, TRACKING, TYPE } from '../common/abstractTokens.js';
import { esc, IScreenState, pickerSheet, pickRow } from './screenRenderShell.js';

// One skeleton-thumbnail bar: an 8px rule at a derived width. Neutral bars are the paper's own hairlines
// (a heading sits a step stronger than its prose); the ONE indigo bar marks where live data lands.
function skeletonBar(widthPct: number, colour: string): string {
	return `<span style="width:${widthPct}%;height:8px;border-radius:4px;background:${colour}"></span>`;
}

// One neutral (heading or prose) bar at the width the parser derived for that line.
function skeletonRow(row: ITemplateSkeletonRow): string {
	const heading = row.kind === 'title';
	return skeletonBar(row.widthPct ?? (heading ? 55 : 72), heading ? HAIRLINE.strong : HAIRLINE.medium);
}

// The skeleton thumbnail (comp 4b), drawn from the template's PARSED doc - never a screenshot or canned art.
// A `title` row is a strong hairline bar, a `prose` row a medium one, and the FIRST `slots` row becomes the
// single indigo bar that stands for a bound slot. Exactly one indigo bar per card: the thumbnail is a glyph
// for "this pattern binds live data", and repeating the accent would read as a chart rather than a page.
function thumbnail(card: ITemplateCard): string {
	const bars: string[] = [];
	let boundBar = false;
	for (const row of card.skeleton) {
		if (bars.length >= 4) { break; }
		if (row.kind === 'slots') {
			if (boundBar) { continue; }
			boundBar = true;
			bars.push(skeletonBar(30, INDIGO.tintBorder));
			continue;
		}
		bars.push(skeletonRow(row));
	}
	// A template whose bind slots sit past the fourth line (or that declares its sources without an inline slot)
	// still binds live data, so the last bar carries the accent rather than letting the thumbnail claim the
	// pattern is structure-only. A template with neither draws no accent at all - it really is structure.
	if (!boundBar && (card.bindSlots > 0 || card.sources.length > 0) && bars.length) {
		bars[bars.length - 1] = skeletonBar(30, INDIGO.tintBorder);
	}
	return `<div style="min-height:80px;padding:18px 20px 14px;background:${PAPER.rail};border-bottom:1px solid ${HAIRLINE.medium};display:flex;flex-direction:column;gap:5px">${bars.join('')}</div>`;
}

// The card's meta line, in outcome words (comp 4b). What the reader needs is what the template draws on and
// whether it has earned its keep - not its slot count. Every phrase is derived from the real template: its
// declared sources, its bind slots, and its true usage lineage (an honest "not used yet" at zero). Cadence is
// deliberately absent: a template carries no schedule, so "used every week" would be a claim we cannot make.
function outcomeMeta(c: ITemplateCard): string {
	const mono = (s: string) => `<span style="font:400 11.5px/1.4 ${FONT.mono}">${esc(s)}</span>`;
	const draws = c.sources.length === 1
		? localize("livingDocs.templates.card.drawsOn", "draws on {0}", mono(c.sources[0]))
		: c.sources.length > 1
			? localize("livingDocs.templates.card.drawsOnMore", "draws on {0} +{1} more", mono(c.sources[0]), c.sources.length - 1)
			: c.bindSlots > 0
				? localize("livingDocs.templates.card.bindsLater", "binds after creation")
				: localize("livingDocs.templates.card.structureOnly", "structure only, no bound figures");
	const used = c.usageCount === 0
		? localize("livingDocs.templates.card.unused", "not used yet")
		: c.usageCount === 1
			? localize("livingDocs.templates.card.usedOnce", "used once")
			: localize("livingDocs.templates.card.usedTimes", "used {0} times", c.usageCount);
	return `${draws} · ${used}`;
}

// ---- Templates (round 2, comp 4b): the pattern gallery. ----
export function renderTemplates(state: IScreenState): string {
	// The screen body floats on the plan-44 elevation card (the editor part paints the paper + radius + shadow
	// on chrome); the webview body is transparent so that card shows through - Templates never repaints its own
	// canvas (shell CSS belongs to plan 44). Same no-rails shell as Home.
	const scroll = (inner: string) => `<div class="screen" style="background:transparent"><div style="flex:1;overflow-y:auto;background:transparent">${inner}</div></div>`;

	const cards = state.templateCards ?? [];
	const exampleDocs = state.docFiles ?? [];

	// The from-examples wizard (F18, journey 1x): its picker offers the project's real documents as examples.
	// Real data only - the options come from the service's folder scan; with none the sheet shows a calm empty
	// line and no submit, so the on-ramp explains itself rather than dead-ending.
	const exampleRows = exampleDocs.map(f => pickRow(f, f, 'document')).join('');
	const fromExamplesSheet = pickerSheet('fromexamples', {
		title: localize("livingDocs.templates.wizard.title", "Grow a template from past documents"),
		sub: localize("livingDocs.templates.wizard.sub", "Pick 3-10 past documents. The agent names what they share - structure, recurring figures, tone - as changes to review, then proposes a template file."),
		nameLabel: localize("livingDocs.templates.wizard.nameLabel", "Template name"),
		namePlaceholder: localize("livingDocs.templates.wizard.namePlaceholder", "e.g. Board note"),
		pickLabel: localize("livingDocs.templates.wizard.pickLabel", "Example documents (3-10)"),
		submitMsg: 'newTemplateFromExamples',
		submitLabel: localize("livingDocs.templates.wizard.submit", "Analyse examples"),
		rows: exampleRows,
		empty: localize("livingDocs.templates.wizard.empty", "This project has no documents to learn from yet. Add a few finished documents to grow a template from them."),
	});

	// The title block (comp 4b): the screen title over the sentence that says what a template IS, with the live
	// filter where the comp puts its primary (the one "+ New template" action lives in the global header, so
	// drawing a second one here would be two doors to the same place).
	const titleRow = `<div style="display:flex;align-items:flex-end;gap:16px;margin-bottom:26px">
			<div style="display:flex;flex-direction:column;gap:6px;min-width:0">
				<h1 style="margin:0;font:${TYPE.screenTitle};letter-spacing:${TRACKING.screenTitle};color:${INK.heading}">${localize("livingDocs.templates.title", "Templates")}</h1>
				<p style="margin:0;font:400 14.5px/1.45 ${FONT.sans};color:${INK.bodySoft}">${localize("livingDocs.templates.sub", "A template is how a recurring report is born - structure, bound figures, and the agent's instructions, reused every cycle.")}</p>
			</div>
			<span style="flex:1"></span>
			<label class="tpl-filter">&#8981;<input data-tpl-filter type="text" placeholder="${localize("livingDocs.templates.filter", "Filter templates…")}" aria-label="${localize("livingDocs.templates.filter", "Filter templates…")}"></label>
		</div>`;

	// A template card: the skeleton thumbnail over the name, the outcome description, the outcome meta line and
	// the two verbs. Use duplicates the template into the folder with its binds emptied to slots; Edit opens the
	// `.template.md` itself (it is ordinary Markdown, so it round-trips on disk). `data-filter` drives the live
	// filter. No avatar and no kind chip: identity may not borrow a hue that means something (comp 4b).
	const card = (c: ITemplateCard) => {
		const desc = c.description.trim() || localize("livingDocs.templates.card.noDesc", "The next document starts from this structure, with its figures ready to bind.");
		const uri = esc(c.uri.toString());
		const filterKey = esc((c.name + ' ' + c.description).toLowerCase());
		return `<div class="tpl-card" data-filter="${filterKey}" style="background:${PAPER.card};border:1px solid ${HAIRLINE.strong};border-radius:${RADIUS.cardLarge};overflow:hidden;display:flex;flex-direction:column">
			${thumbnail(c)}
			<div style="padding:16px 20px 18px;display:flex;flex-direction:column;gap:8px;flex:1">
				<span style="font:600 15.5px/1.25 ${FONT.sans};color:${INK.heading};overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(c.name)}</span>
				<span style="font:400 13px/1.6 ${FONT.sans};color:${INK.bodySoft};flex:1">${esc(desc)}</span>
				<div style="font:400 12px/1.5 ${FONT.sans};color:${INK.meta}">${outcomeMeta(c)}</div>
				<div style="display:flex;gap:8px;padding-top:4px">
					<button class="btn-primary" style="padding:6px 16px;font:600 12.5px/1.3 ${FONT.sans};border-radius:7px" data-msg="useTemplate" data-arg="${uri}">${localize("livingDocs.templates.card.use", "Use")}</button>
					<button class="btn-ghost" style="padding:6px 14px;font:400 12.5px/1.3 ${FONT.sans};border-radius:7px;color:${INK.bodySoft}" data-msg="editTemplate" data-arg="${uri}">${localize("livingDocs.templates.card.edit", "Edit")}</button>
				</div>
			</div>
		</div>`;
	};

	// The two dashed on-ramps (comp 4b): the ways the NEXT template is born. Both are wired to existing paths -
	// the from-examples wizard sheet (F18) and the save-the-active-document writer (T2.5), which answers with a
	// plain-words nudge when no document is active rather than dying silently.
	const onRamp = (glyph: string, glyphColour: string, title: string, body: string, button: string, action: string) => `<div style="border:1px dashed ${PAPER.frameBorder};border-radius:${RADIUS.cardLarge};padding:22px 24px;display:flex;align-items:center;gap:16px">
			<span style="font-size:20px;line-height:1;flex:none;color:${glyphColour}">${glyph}</span>
			<div style="flex:1;min-width:0">
				<div style="font:600 14.5px/1.3 ${FONT.sans};color:${INK.heading}">${title}</div>
				<div style="font:400 13px/1.55 ${FONT.sans};color:${INK.secondary};margin-top:3px">${body}</div>
			</div>
			<button class="btn-ghost" style="flex:none;padding:7px 14px;font:600 12.5px/1.3 ${FONT.sans}" ${action}>${button}</button>
		</div>`;
	const growRamp = onRamp('&#10022;', INDIGO.base,
		localize("livingDocs.templates.grow.title", "Grow one from past documents"),
		localize("livingDocs.templates.grow.body", "Pick 3-10 reports you've already written - I'll find the pattern (structure, recurring figures, tone) and propose a template you can edit."),
		localize("livingDocs.templates.grow.action", "Choose documents…"), 'data-sheet-open="fromexamples"');
	const saveRamp = onRamp('&#9636;', INK.meta,
		localize("livingDocs.templates.saveCurrent.title", "Save the current document as a template"),
		localize("livingDocs.templates.saveCurrent.body", "Its headings become the structure; its bound figures become slots the next document fills."),
		localize("livingDocs.templates.saveCurrent.action", "Save as template"), 'data-msg="saveAsTemplate"');
	const onRamps = `<div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">${growRamp}${saveRamp}</div>`;

	// A "no matches" line for the live filter: shown only when the query hides every card (toggled by the shell
	// script), so the grid never reads as an empty/broken surface.
	const noMatch = `<div data-tpl-nomatch style="display:none;font:${TYPE.uiBody};color:${INK.secondary};margin-bottom:26px">${localize("livingDocs.templates.noMatch", "No templates match your filter.")}</div>`;

	// The calm empty state (real-data guardrail): no templates on disk -> the title block, the honest empty
	// card with the by-hand door, and the same two on-ramps (the other two ways a template is born).
	if (cards.length === 0) {
		return scroll(`<div style="max-width:1180px;margin:0 auto;padding:56px 48px 80px">
			${titleRow}
			<div style="border:1px solid ${HAIRLINE.strong};border-radius:${RADIUS.cardLarge};background:${PAPER.rail};padding:40px 32px;text-align:center;margin-bottom:26px">
				<div style="font:600 15px/1.3 ${FONT.sans};color:${INK.heading};margin-bottom:6px">${localize("livingDocs.templates.empty.title", "No templates yet")}</div>
				<p style="margin:0 auto 20px;max-width:440px;font:${TYPE.uiBody};color:${INK.secondary}">${localize("livingDocs.templates.empty.body", "A template is a living document with its binds left empty - a pattern for the next document. Grow one from a few past documents, or start from a blank one.")}</p>
				<button class="btn-primary" style="padding:9px 18px;font:600 13px/1.25 ${FONT.sans}" data-msg="newTemplate">${localize("livingDocs.templates.empty.first", "Create your first template")}</button>
			</div>
			${onRamps}
			${fromExamplesSheet}
		</div>`);
	}

	const grid = `<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin-bottom:26px">${cards.map(card).join('')}</div>`;
	return scroll(`<div style="max-width:1180px;margin:0 auto;padding:56px 48px 80px">
		${titleRow}
		${grid}
		${noMatch}
		${onRamps}
		${fromExamplesSheet}
	</div>`);
}
