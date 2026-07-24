/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Home: the landing dashboard + the empty-project front door, plus the front-door pieces they share
// (the whole-project chat composer, the WHILE YOU WERE AWAY feed + all-clear promotion, the Tidy surface,
// the resume/demo banner, the F17 birth sheets, the New-document sheet). Only `renderHome` is public; every
// helper below is private to this screen. Split out of screenRender.ts so the Home + Templates lane never
// collides with the Knowledge + Agents lane in one file. Shared helpers come from screenRenderShell.

import { localize } from '../../../../nls.js';
import { countTemplateSlots } from '../common/livingDocMarkdown.js';
import { ILivingDocSummary, ITemplateInfo } from '../common/livingDocs.js';
import { docRailDot } from '../common/railStatus.js';
import { ACCENT, ACCENT_DK, avatar, esc, IHomeNeedsYou, IScreenState, pickerSheet, pickRow, sheet } from './screenRenderShell.js';

// The time-of-day greeting, the real date, and the document status chip (H1.2 / H3.1 / H3.4). All three read
// real facts (the wall clock; the doc's live status signals) so Home never fabricates a mood or a state.

/** The time-of-day half of the greeting ("Good morning/afternoon/evening"), from the real local hour. */
function greetingTimeOfDay(hour: number): string {
	if (hour < 12) { return localize("livingDocs.home.morning", "Good morning"); }
	if (hour < 18) { return localize("livingDocs.home.afternoon", "Good afternoon"); }
	return localize("livingDocs.home.evening", "Good evening");
}

/** The mono date stamp beside the greeting, e.g. "Mon 14 Jul" - the real current date, weekday + day + month. */
function greetingDate(now: Date): string {
	const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
	const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
	return `${days[now.getDay()]} ${now.getDate()} ${months[now.getMonth()]}`;
}

/**
 * The ALL DOCUMENTS status chip (H3.1 / H3.4). Derived from the SAME `docRailDot` helper the tree rail's dots
 * read, so a chip and its row dot can never disagree: any coloured band (red/yellow/green - something to
 * attend to) reads "needs you"; a calm living doc reads "in sync"; a plain (non-living) document reads
 * "markdown". Three visual bands, one truth. Palette exact to the mock (attention cream / ok green / muted).
 */
function docStatusChip(d: ILivingDocSummary): string {
	const dot = docRailDot(d);
	const chip = (bg: string, border: string, colour: string, label: string) =>
		`<span style="height:20px;padding:0 8px;display:inline-flex;align-items:center;border-radius:999px;background:${bg};border:1px solid ${border};color:${colour};font:500 10.5px/1 system-ui">${label}</span>`;
	if (dot.color !== 'grey') {
		return chip('#FDFAF2', '#E4DCCB', '#8A6D1A', localize("livingDocs.home.chip.needsYou", "needs you"));
	}
	if (d.isLiving) {
		return chip('#EEF7F0', '#D7ECDC', '#2C8159', localize("livingDocs.home.chip.inSync", "in sync"));
	}
	return chip('#F6F7F9', '#E9EAEE', '#868B95', localize("livingDocs.home.chip.markdown", "markdown"));
}

// ---- Home front-door pieces (F15 / journey 1w): the whole-project chat composer and the empty-project front
// door. All are DOM-free HTML over the real state. ----

// The whole-project chat composer (map-D21/D24): "Ask this project anything..." defaulting to whole-project
// scope. A question answers read-only with citations (rendered below the box); a change request opens the
// run/task surface. The client script gathers the textarea and posts one `askProject` message with the text.
function renderHomeComposer(state: IScreenState): string {
	const answer = state.projectAnswer;
	// The read-only answer + its real citations (map-D24: "answers read-only with citations"). Citation chips
	// name the exact documents/sources consulted - never fabricated (the service intersects with what it read).
	// The row leads with a "Consulted:" label because that is exactly what the list is: on the fallback path
	// (the model named no citations) it carries EVERY file read for the answer, so an unlabelled row could read
	// as "sources supporting this answer" and over-claim; "Consulted" stays true on both paths.
	const citations = answer && answer.citations.length
		? `<div style="display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin-top:10px"><span style="font:600 10px/1 'JetBrains Mono',ui-monospace,monospace;letter-spacing:.06em;color:#a3a8b2">Consulted:</span>${answer.citations.map(c => `<span style="font:500 10.5px/1 'JetBrains Mono',ui-monospace,monospace;color:#5661c9;background:#eef1ff;border:1px solid #e0e5fb;border-radius:6px;padding:4px 8px">&#128206; ${esc(c)}</span>`).join('')}</div>`
		: '';
	const answerBlock = answer
		? `<div style="margin-top:14px;background:#fff;border:1px solid #e6e8ed;border-radius:12px;padding:16px 18px">
			<div style="font:600 10px/1 'JetBrains Mono',ui-monospace,monospace;letter-spacing:.1em;color:#a3a8b2;margin-bottom:8px">ANSWER &middot; READ-ONLY</div>
			<div style="font:400 13.5px/1.6 system-ui;color:#2a2c32;white-space:pre-wrap">${esc(answer.answer)}</div>
			${citations}
		</div>`
		: '';
	const busy = state.askBusy
		? `<div style="margin-top:12px;display:flex;align-items:center;gap:9px;font:400 12.5px/1 system-ui;color:#868b95"><span style="width:12px;height:12px;border:2px solid #d7d9df;border-top-color:${ACCENT};border-radius:50%;animation:lwdSpin .8s linear infinite"></span>Reading the project&hellip;</div>`
		: '';
	return `<div data-ask-box style="background:#fff;border:1px solid #e0e5fb;border-radius:15px;padding:18px 20px;margin-bottom:34px;box-shadow:0 12px 30px -24px rgba(86,97,201,.4)">
		<div style="display:flex;align-items:center;gap:8px;margin-bottom:10px"><span style="font:600 11px/1 'JetBrains Mono',ui-monospace,monospace;letter-spacing:.1em;color:#5661c9">ASK THIS PROJECT</span><span style="font:500 10px/1 system-ui;color:#5d8a66;background:#eef7f0;border:1px solid #d7ecdc;border-radius:999px;padding:4px 9px">Whole project</span></div>
		<textarea data-ask-input rows="2" placeholder="Ask this project anything - or ask me to change something across it&hellip;" style="width:100%;resize:vertical;border:1px solid #dfe1e7;border-radius:10px;padding:11px 12px;font:400 13.5px/1.5 system-ui;color:#1a1c20;background:#fff;outline:none"></textarea>
		<div style="display:flex;align-items:center;justify-content:space-between;gap:12px;margin-top:10px">
			<span style="font:400 11px/1.4 system-ui;color:#a3a8b2">A question is answered read-only with citations; a change request opens a task.</span>
			<button data-ask-send style="border:none;border-radius:9px;padding:9px 16px;background:${ACCENT};color:#fff;font:600 12.5px/1 system-ui;cursor:pointer">Ask</button>
		</div>
		${busy}${answerBlock}
	</div>`;
}

// The empty-project front door (journey 1w frame 4): a folder is open but has no documents. Cures the 1a
// empty-folder dead-end with "New from template / Blank document / ...or ask me to create one" - the New-doc
// sheet (Blank + real templates) plus the whole-project composer, never a dead card.
// The demoted walkthrough entry point (plan 42 slice L1). Rendered on BOTH Home paths (dashboard and
// empty-project front door): the cold start now lands in the editor, never on the walkthrough, so the demo has
// to be REACHABLE from Home rather than forced on entry. Two mutually-exclusive shapes:
//  - an onboarding is in progress -> the "Continue your walkthrough" banner re-enters the guide at its saved
//    step (the onboarding screen is displaced by the demo document during the flow, so Home is the reliable
//    re-entry, and an empty project - demo doc deleted or not yet generated - still needs it);
//  - otherwise -> a DISMISSIBLE "See a 90-second demo" card (never a gate: a small x removes it for good).
function renderResumeBanner(state: IScreenState): string {
	if (state.onboardingResumeStep) {
		return `<div style="display:flex;align-items:center;gap:14px;background:#f4f5fd;border:1px solid #e0e5fb;border-radius:12px;padding:14px 18px;margin-bottom:22px">
				<span style="font-size:18px;color:${ACCENT}">&#10022;</span>
				<div style="flex:1"><div style="font:600 13.5px/1.3 system-ui;color:#26292f">${localize('livingDocs.onboarding.resume.title', "Your walkthrough is in progress")}</div><div style="font:400 12.5px/1.4 system-ui;color:#696e78">${localize('livingDocs.onboarding.resume.body', "Pick up the two-wow tour where you left off.")}</div></div>
				<button data-msg="openOnboarding" style="flex:none;border:none;border-radius:9px;padding:10px 16px;background:${ACCENT};color:#fff;font:600 12.5px/1 system-ui;cursor:pointer">${localize('livingDocs.onboarding.resume.action', "Continue Your Walkthrough")}</button>
			</div>`;
	}
	if (state.demoCardDismissed) {
		return '';
	}
	return `<div style="display:flex;align-items:center;gap:14px;background:#f4f5fd;border:1px solid #e0e5fb;border-radius:12px;padding:14px 18px;margin-bottom:22px">
			<span style="font-size:18px;color:${ACCENT}">&#10022;</span>
			<div style="flex:1"><div style="font:600 13.5px/1.3 system-ui;color:#26292f">${localize('livingDocs.onboarding.demoCard.title', "See a 90-second demo")}</div><div style="font:400 12.5px/1.4 system-ui;color:#696e78">${localize('livingDocs.onboarding.demoCard.body', "Watch Abstract keep a figure bound to its source and turn one prompt into a single reviewable edit.")}</div></div>
			<button data-msg="openOnboarding" style="flex:none;border:none;border-radius:9px;padding:10px 16px;background:${ACCENT};color:#fff;font:600 12.5px/1 system-ui;cursor:pointer">${localize('livingDocs.onboarding.demoCard.action', "See a 90-Second Demo")}</button>
			<button data-msg="dismissDemoCard" title="${localize('livingDocs.onboarding.demoCard.dismiss', "Dismiss")}" aria-label="${localize('livingDocs.onboarding.demoCard.dismiss', "Dismiss")}" style="flex:none;border:none;background:none;color:#9aa0aa;font:400 18px/1 system-ui;cursor:pointer;padding:2px 4px">&#215;</button>
		</div>`;
}

// The F17 birth sheets shared by both Home paths: the New-document sheet (whose "From sources..." row
// obeys the real-data guardrail - present only when the folder scan found at least one source) plus the
// source picker sheet it opens. The empty-project front door needs these as much as the dashboard: a
// folder of CSVs with no documents yet is exactly the from-sources moment.
function renderBirthSheets(state: IScreenState): string {
	const dataFiles = state.dataFiles ?? [];
	const docFiles = state.docFiles ?? [];
	const hasSources = dataFiles.length + docFiles.length > 0;
	const sourceRows = [
		...dataFiles.map(f => pickRow(f, f, 'data source')),
		...docFiles.map(f => pickRow(f, f, 'document')),
	].join('');
	const fromSourcesSheet = pickerSheet('fromsources', {
		title: 'New document from sources',
		sub: 'Pick the sources to draft from, name it, and the draft arrives as changes to review - nothing is written for you.',
		nameLabel: 'Document Name',
		namePlaceholder: 'e.g. Board note - March',
		note: true,
		pickLabel: 'Sources',
		submitMsg: 'newFromSources',
		submitLabel: 'Draft From Sources',
		rows: sourceRows,
		empty: 'This project has no sources yet. Add a csv, json or document to the folder to draft from it.',
	});
	return renderNewDocSheet(state.templates ?? [], hasSources) + fromSourcesSheet;
}

function renderEmptyProjectFrontDoor(state: IScreenState, folderName: string): string {
	const scroll = (inner: string) => `<div class="screen" style="background:transparent"><div style="flex:1;overflow-y:auto;background:transparent">${inner}</div></div>`;
	const templates = state.templates ?? [];
	const templateHint = templates.length
		? `Start from one of your ${templates.length} template${templates.length === 1 ? '' : 's'}, from a blank page, or ask me to draft one.`
		: 'Start from a blank page, or ask me to draft your first document.';
	return scroll(`<div style="max-width:760px;margin:0 auto;padding:56px 36px 80px">
		${renderResumeBanner(state)}
		<div style="text-align:center;margin-bottom:30px">
			<div style="font-size:38px;line-height:1;margin-bottom:14px">&#128196;</div>
			<h1 style="margin:0 0 8px;font:600 24px/1.25 system-ui;color:#15171c;letter-spacing:-.01em">${esc(folderName)} is empty</h1>
			<p style="margin:0;font:400 14px/1.6 system-ui;color:#696e78">${templateHint}</p>
		</div>
		<div style="display:flex;gap:12px;justify-content:center;margin-bottom:30px">
			<button data-msg="newDocument" data-sheet-open="newdoc" style="border:none;border-radius:10px;padding:12px 20px;background:${ACCENT};color:#fff;font:600 13.5px/1 system-ui;cursor:pointer">&#65291; New document</button>
			<button data-msg="goTemplates" style="border:1px solid #e6e8ed;background:#fff;border-radius:10px;padding:11px 18px;font:500 13px/1 system-ui;color:#52575f;cursor:pointer">Browse templates</button>
		</div>
		${renderHomeComposer(state)}
		${renderBirthSheets(state)}
	</div>`);
}

// ---- Home: the landing dashboard. The open folder IS the project (decision #39): an empty state when no
// folder is open, otherwise the folder's name + every Markdown document (living ones badged). ----
export function renderHome(state: IScreenState): string {
	// The screen body floats on the plan-44 elevation card (the editor part paints the white paper + radius 14
	// + shadow-editor on chrome); the webview body is transparent so that card shows through - Home never
	// repaints its own canvas (shell CSS belongs to plan 44).
	const scroll = (inner: string) => `<div class="screen" style="background:transparent"><div style="flex:1;overflow-y:auto;background:transparent">${inner}</div></div>`;

	// No folder open: one plain-words line + one button, nothing else (H1.5, closes #211 items 1-2). Zero
	// product vocabulary - no "Living Documents", "sources" or "agents"; just an honest invitation to open a
	// folder of files to work on.
	if (!state.hasFolder) {
		return `<div class="screen" style="background:transparent"><div style="flex:1;overflow-y:auto;background:transparent;display:flex;align-items:center;justify-content:center">
			<div style="text-align:center;max-width:420px;padding:40px">
				<h1 style="margin:0 0 12px;font:600 22px/1.3 system-ui;color:#14161A;letter-spacing:-.02em">${localize("livingDocs.home.noFolder.title", "Open a folder to start working.")}</h1>
				<button data-msg="openFolder" style="border:none;border-radius:10px;padding:13px 22px;background:${ACCENT};color:#fff;font:600 14px/1 system-ui;cursor:pointer">${localize("livingDocs.home.noFolder.action", "Open a Folder")}</button>
			</div>
		</div></div>`;
	}

	const docs = state.docs ?? [];
	const folderName = state.folderName ?? 'Workspace';

	// Empty-project front door (journey 1w frame 4): a folder is open but has no documents. Land on the
	// front door ("New from template / Blank / ...or ask me") rather than an empty dashboard - cures the 1a
	// empty-folder dead-end.
	if (docs.length === 0) {
		return renderEmptyProjectFrontDoor(state, folderName);
	}

	// The truthful needs-you count (H1.3): "N documents need you · everything else is in sync." when work
	// pends, or the calm all-clear equivalent when nothing does. Real data only - the count is the live pending
	// set, and the all-clear says "in sync" honestly (never a fabricated status).
	const pendingDocCount = docs.filter(d => d.pendingCount > 0).length;
	const summary = pendingDocCount === 1
		? localize("livingDocs.home.summary.one", "1 document needs you · everything else is in sync.")
		: pendingDocCount > 1
			? localize("livingDocs.home.summary.many", "{0} documents need you · everything else is in sync.", pendingDocCount)
			: localize("livingDocs.home.summary.clear", "Everything is in sync.");

	// NEEDS YOU cards (H2): at most the two most-pending documents, from the REAL per-doc detail the host
	// computed (`homeNeedsYou`) - the plain-language reason + freshness stamp are real, never fabricated.
	// Anatomy (H2.2): 3px accent top-border, radius 13, e1; an 8px attention pulse dot; name 14.5/600; a mono
	// amber "N TO APPROVE" pill (radius 999); the one-line reason; an accent Review button (30px, radius 8)
	// that deep-links into the doc with the Review tab open and scrolls to the addressed block (H2.3u, via the
	// address model - `data-block` carries the top change's durable block id); and the mono freshness stamp.
	const needsCard = (c: IHomeNeedsYou) => {
		const n = c.pendingCount;
		const pill = n === 1
			? localize("livingDocs.home.card.toApprove.one", "1 TO APPROVE")
			: localize("livingDocs.home.card.toApprove.many", "{0} TO APPROVE", n);
		const stamp = c.refreshedLabel
			? `<span style="font-family:'JetBrains Mono',ui-monospace,monospace;font-size:10.5px;color:#A3A8B2">${esc(c.refreshedLabel)}</span>`
			: '';
		return `<div style="flex:1;min-width:0;background:#fff;border:1px solid #E6E8EC;border-top:3px solid #5B6DC4;border-radius:13px;padding:18px 20px;box-shadow:0 1px 2px rgba(20,22,28,.05)">
			<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px"><span style="width:8px;height:8px;flex:none;border-radius:999px;background:#C99A2E;animation:lwdPulse 2.4s ease-in-out infinite"></span><span style="font:600 14.5px/1.2 system-ui;color:#1A1C20;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(c.title)}</span><span style="flex:1"></span><span style="flex:none;font-family:'JetBrains Mono',ui-monospace,monospace;font-size:10px;font-weight:600;color:#8A6D1A;background:#FDFAF2;border:1px solid #E4DCCB;border-radius:999px;padding:3px 8px">${pill}</span></div>
			<div style="font:400 13px/1.55 system-ui;color:#52575F;margin-bottom:14px">${esc(c.reason)}</div>
			<div style="display:flex;align-items:center;gap:10px"><button data-msg="reviewNeedsYou" data-arg="${esc(c.resource)}" data-block="${esc(c.blockId ?? '')}" style="height:30px;padding:0 14px;display:inline-flex;align-items:center;border-radius:8px;background:#5B6DC4;color:#fff;font:600 12.5px/1 system-ui;border:none;cursor:pointer">${localize("livingDocs.home.card.review", "Review")}</button>${stamp}</div>
		</div>`;
	};
	const cards = state.homeNeedsYou ?? [];
	const overflow = (state.homeNeedsYouTotal ?? 0) - cards.length;
	// "+N more" overflow (H2.1): when more than two documents need the user, one quiet row links to the Review
	// surface where the whole pending set lives.
	const overflowRow = overflow > 0
		? `<button data-msg="reviewProject" style="margin-top:12px;border:none;background:none;cursor:pointer;font:600 12px/1 system-ui;color:${ACCENT_DK};padding:2px 0">${localize("livingDocs.home.needsYou.more", "+{0} more", overflow)} &#8594;</button>`
		: '';
	// H2.5: the whole section is absent when nothing pends (no empty shell).
	const needsYou = cards.length
		? `<div style="font-family:'JetBrains Mono',ui-monospace,monospace;font-size:10px;font-weight:600;letter-spacing:.12em;color:#A3A8B2;margin-bottom:10px">${localize("livingDocs.home.needsYou.label", "NEEDS YOU")}</div>
			<div style="display:flex;gap:16px;margin-bottom:40px;flex-wrap:wrap">${cards.map(needsCard).join('')}</div>${overflowRow}`
		: '';

	// ALL DOCUMENTS grid (H3): a 4-col grid (gap 12) of the open folder's real documents (decision 39 - the
	// folder IS the project, no fixture cards). Each card: a 26px two-letter avatar (plan 20 palette), the
	// name (13/600), the status chip (derived from the same `docRailDot` helper as the tree dots - H3.4), and
	// a mono source count. Clicking opens the doc. A dashed "New document" (plus) tile closes the grid (H3.3).
	const docCard = (d: ILivingDocSummary) => {
		const av = avatar(d.title);
		const srcCount = new Set(d.sources).size;
		const sourceMeta = srcCount > 0
			? (srcCount === 1 ? localize("livingDocs.home.card.source.one", "1 source") : localize("livingDocs.home.card.source.many", "{0} sources", srcCount))
			: localize("livingDocs.home.card.noBinds", "no binds");
		return `<button data-msg="openDoc" data-arg="${esc(d.resource.toString())}" class="doc-tile" style="text-align:left;background:#FBFCFD;border:1px solid #E9EAEE;border-radius:13px;padding:14px 16px;cursor:pointer">
			<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px"><span style="width:26px;height:26px;flex:none;border-radius:8px;background:${av.color};color:#fff;display:flex;align-items:center;justify-content:center;font:600 10px/1 system-ui">${av.text}</span><span style="font:600 13px/1.2 system-ui;color:#1A1C20;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(d.title)}</span></div>
			<div style="display:flex;align-items:center;gap:6px">${docStatusChip(d)}<span style="font-family:'JetBrains Mono',ui-monospace,monospace;font-size:10px;color:#A3A8B2">${sourceMeta}</span></div>
		</button>`;
	};
	const newDocTile = `<button data-msg="newDocument" data-sheet-open="newdoc" class="doc-newtile" style="border:1px dashed #C6CAD2;background:none;border-radius:13px;padding:14px 16px;display:flex;align-items:center;justify-content:center;gap:8px;color:#868B95;cursor:pointer;min-height:76px"><span style="font-size:16px">&#65291;</span><span style="font:500 13px/1 system-ui">${localize("livingDocs.home.newDocument", "New document")}</span></button>`;
	const docsGrid = `<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px">${docs.map(docCard).join('')}${newDocTile}</div>`;

	// The birth sheets (New document + From sources) still back the grid's plus tile and the header's New action.
	const birthSheets = renderBirthSheets(state);
	// D26 / plan 42 L1: a "Continue your walkthrough" banner (in-progress) or a dismissible "See a 90-second
	// demo" card - the demoted walkthrough entry point. Reachable from Home, never a gate (the cold start still
	// lands in the editor). Kept above the greeting so the calm Home stays the hero.
	const resumeBanner = renderResumeBanner(state);
	const name = state.userName;
	const greeting = name
		? localize("livingDocs.home.greeting.name", "{0}, {1}.", greetingTimeOfDay(new Date().getHours()), name)
		: localize("livingDocs.home.greeting", "{0}.", greetingTimeOfDay(new Date().getHours()));
	return scroll(`<div style="max-width:1080px;margin:0 auto;padding:64px 48px 80px">
		${resumeBanner}
		<div style="display:flex;align-items:baseline;gap:14px;margin-bottom:10px"><h1 style="margin:0;flex:none;white-space:nowrap;font:600 30px/1.12 system-ui;color:#14161A;letter-spacing:-.02em">${esc(greeting)}</h1><span style="flex:none;font-family:'JetBrains Mono',ui-monospace,monospace;font-size:13px;color:#A3A8B2">${greetingDate(new Date())}</span></div>
		<p style="margin:0 0 36px;font:400 14px/1.5 system-ui;color:#868B95">${summary}</p>
		${renderHomeComposer(state)}
		${needsYou}
		<div style="font-family:'JetBrains Mono',ui-monospace,monospace;font-size:10px;font-weight:600;letter-spacing:.12em;color:#A3A8B2;margin-bottom:10px">${localize("livingDocs.home.allDocuments", "ALL DOCUMENTS")}</div>
		${docsGrid}
		${birthSheets}
	</div>`);
}

// The name-or-template sheet (plan 28, iter 4, D28-B shape): a name field, a Blank-document default row
// (Enter), and each real template as a secondary row that routes to the iter-3 generate flow with the same
// typed name. Real data only: the template rows come from `listTemplates()`; with none, only Blank shows.
function renderNewDocSheet(templates: readonly ITemplateInfo[], hasSources: boolean): string {
	const blankRow = `<button class="sheet-row" data-sheet-submit data-sheet-default data-msg="newDocument" style="background:#f7f8ff;border-color:#dfe1e7">
		<span style="width:30px;height:30px;flex:none;border-radius:8px;background:#eef1ff;color:${ACCENT_DK};font:600 15px/30px system-ui;text-align:center">&#65291;</span>
		<span style="flex:1;min-width:0"><span style="display:block;font:600 13px/1.3 system-ui;color:#1a1c20">Blank document</span><span style="display:block;font:400 11.5px/1.4 system-ui;color:#868b95">Start from an empty page - press Enter</span></span>
	</button>`;
	// The third birth (F17, map-D4): "From sources..." opens the source picker sheet. Shown only when the
	// project has at least one source to draft from (real-data guardrail); it carries the typed name across.
	const fromSourcesRow = hasSources
		? `<button class="sheet-row" data-sheet-open="fromsources" data-name="">
			<span style="width:30px;height:30px;flex:none;border-radius:8px;background:#eaf3ee;color:#2f7d55;font:600 14px/30px system-ui;text-align:center">&#9635;</span>
			<span style="flex:1;min-width:0"><span style="display:block;font:600 13px/1.3 system-ui;color:#1a1c20">From sources&hellip;</span><span style="display:block;font:400 11.5px/1.4 system-ui;color:#868b95">Draft from your data and documents, through review</span></span>
		</button>`
		: '';
	const templateRow = (t: ITemplateInfo) => {
		const av = avatar(t.name);
		const slots = countTemplateSlots(t.body);
		const meta = `${slots} slot${slots === 1 ? '' : 's'} &middot; ${t.sources.length} source${t.sources.length === 1 ? '' : 's'}`;
		return `<button class="sheet-row" data-sheet-submit data-msg="generateFromTemplate" data-arg="${esc(t.uri.toString())}">
			<span style="width:30px;height:30px;flex:none;border-radius:8px;background:${av.color};color:#fff;font:600 12px/30px system-ui;text-align:center">${av.text}</span>
			<span style="flex:1;min-width:0"><span style="display:block;font:600 13px/1.3 system-ui;color:#1a1c20;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(t.name)}</span><span style="display:block;font:400 11px/1.4 'JetBrains Mono',ui-monospace,monospace;color:#a3a8b2">${meta}</span></span>
		</button>`;
	};
	const templateSection = templates.length
		? `<div style="font:600 10px/1 'JetBrains Mono',ui-monospace,monospace;letter-spacing:.1em;color:#a3a8b2;margin:18px 0 2px">OR START FROM A TEMPLATE</div>${templates.map(templateRow).join('')}`
		: '';
	return sheet('newdoc', {
		title: 'New document',
		sub: 'Name it and start blank, or pick a template to generate a first draft through review.',
		nameLabel: 'Document Name',
		namePlaceholder: 'Name this document (optional)',
		body: `<div style="margin-top:18px">${blankRow}${fromSourcesRow}${templateSection}</div>
			<div style="display:flex;gap:8px;margin-top:18px;justify-content:flex-end"><button class="btn-ghost" data-sheet-close="newdoc">Cancel</button></div>`,
	});
}
