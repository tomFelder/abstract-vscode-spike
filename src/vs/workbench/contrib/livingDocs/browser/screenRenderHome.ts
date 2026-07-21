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
import { IAwayFeed } from '../common/projectHomeFeed.js';
import { ACCENT, ACCENT_DK, avatar, esc, IRecentProject, IScreenState, ITidyReviewItem, pickerSheet, pickRow, sheet } from './screenRenderShell.js';

// Health indicator for a project tile. Comp pattern: In Sync = small `ok`-token green dot (no text);
// pending = amber chip with just the count number (attention tokens). Matches Part B tokens exactly.
function healthIndicator(pending: number): string {
	if (pending === 0) {
		// `ok` green dot: 6px, `oklch(0.6 0.13 150)` = #2C8159 approx
		return `<span style="display:flex;align-items:center;gap:5px;font:500 11px/1 system-ui;color:#5d8a66;flex:none"><span style="width:6px;height:6px;border-radius:50%;background:oklch(0.6 0.13 150)"></span></span>`;
	}
	// `attention` amber chip: just the number, no "to approve" text (matches comp exactly)
	return `<span style="font:600 9px/1 'JetBrains Mono',ui-monospace,monospace;color:#8a6d1a;background:#fdfaf2;border:1px solid #e4dccb;border-radius:5px;padding:3px 6px;flex:none">${pending}</span>`;
}

// ---- Home front-door pieces (F15 / journey 1w): the whole-project chat composer, the WHILE YOU WERE AWAY
// feed + all-clear promotion, and the empty-project front door. All are DOM-free HTML over the real state. ----

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

// The Tidy verb surface (doc 22 section 5, the P2 folder conventions): "Tidy this project" proposes a move
// plan through the review grammar - each move an individually approve/skip-able row, applied only on Apply,
// nothing moved before that. Model-free: the plan is deterministic heuristics with a stated reason per row.
// Collapsed to a single entry button until invoked; an empty plan renders the honest "nothing to tidy".
function renderTidy(state: IScreenState): string {
	const review = state.tidyReview;
	if (!review) {
		return `<button data-msg="tidyProject" style="display:flex;align-items:center;gap:11px;width:100%;text-align:left;margin:0 0 34px;padding:14px 16px;background:#fff;border:1px solid #e6e8ed;border-radius:12px;cursor:pointer">
			<span style="width:26px;height:26px;flex:none;border-radius:8px;background:#f4f5fd;color:${ACCENT};font:600 14px/26px system-ui;text-align:center">&#10022;</span>
			<span style="flex:1"><span style="display:block;font:600 13px/1.3 system-ui;color:#26292f">Tidy this project</span><span style="display:block;font:400 12px/1.4 system-ui;color:#868b95">Propose moving loose files into data/, assets/, archive/ &mdash; you approve every move.</span></span>
			<span style="flex:none;font:600 12px/1 system-ui;color:${ACCENT_DK}">Review &#8594;</span>
		</button>`;
	}
	// The applied summary: a calm confirmation that points at the sticky Undo toast the service raised.
	if (review.applied !== undefined) {
		return `<div style="display:flex;align-items:center;gap:11px;background:#eef7f0;border:1px solid #d7ecdc;border-radius:12px;padding:14px 16px;margin-bottom:34px">
			<span style="width:22px;height:22px;flex:none;border-radius:50%;background:oklch(0.6 0.13 150);color:#fff;font:600 13px/22px system-ui;text-align:center">&#10003;</span>
			<div style="flex:1"><div style="font:600 13.5px/1.3 system-ui;color:#2f6b45">Tidied ${review.applied} file${review.applied === 1 ? '' : 's'}</div><div style="font:400 12px/1.4 system-ui;color:#5d8a66">Each move is undoable from the notification. Nothing else was touched.</div></div>
			<button data-msg="tidyCancel" style="flex:none;border:1px solid #cfe4d4;background:#fff;border-radius:8px;padding:8px 13px;font:500 12px/1 system-ui;color:#2f6b45;cursor:pointer">Done</button>
		</div>`;
	}
	// The honest empty plan (doc 22: never a fabricated row): the project is already well organised.
	if (!review.items.length) {
		return `<div style="display:flex;align-items:center;gap:11px;background:#fff;border:1px solid #e6e8ed;border-radius:12px;padding:14px 16px;margin-bottom:34px">
			<span style="width:22px;height:22px;flex:none;border-radius:50%;background:#eef1ff;color:${ACCENT};font:600 12px/22px system-ui;text-align:center">&#10003;</span>
			<div style="flex:1"><div style="font:600 13.5px/1.3 system-ui;color:#26292f">Nothing to tidy</div><div style="font:400 12px/1.4 system-ui;color:#868b95">This project is already well organised &mdash; no loose files to move.</div></div>
			<button data-msg="tidyCancel" style="flex:none;border:1px solid #e0e2e8;background:#fff;border-radius:8px;padding:8px 13px;font:500 12px/1 system-ui;color:#52575f;cursor:pointer">Close</button>
		</div>`;
	}
	const approved = review.items.filter(i => i.decision === 'approved').length;
	const card = (it: ITidyReviewItem, i: number) => {
		const skipped = it.decision === 'skipped';
		// The would-orphan warning (map-D6 shape): name the dependent documents that will be re-pointed to the
		// new location in the same atomic move (their bindings survive), so the move is never a silent break.
		const deps = it.dependents.length
			? `<div style="margin-top:8px;display:flex;gap:7px;background:#fdf6e9;border:1px solid #f0e2c4;border-radius:8px;padding:8px 10px"><span style="color:#9a6b16;flex:none">&#9888;</span><span style="font:400 11.5px/1.5 system-ui;color:#9a6b16">${it.dependents.length} document${it.dependents.length === 1 ? ' references' : 's reference'} this file &mdash; their links will be re-pointed so nothing breaks: ${it.dependents.map(esc).join(', ')}</span></div>`
			: '';
		const toggle = skipped
			? `<button data-msg="tidyApproveOne" data-arg="${i}" style="flex:none;border:1px solid ${ACCENT};background:#fff;border-radius:8px;padding:7px 12px;font:600 12px/1 system-ui;color:${ACCENT_DK};cursor:pointer">Approve</button>`
			: `<button data-msg="tidySkipOne" data-arg="${i}" style="flex:none;border:1px solid #e0e2e8;background:#fff;border-radius:8px;padding:7px 12px;font:500 12px/1 system-ui;color:#868b95;cursor:pointer">Skip</button>`;
		const opacity = skipped ? 'opacity:.55;' : '';
		return `<div style="display:flex;align-items:flex-start;gap:12px;padding:14px 16px;border-bottom:1px solid #f0f1f4;${opacity}">
			<div style="flex:1;min-width:0">
				<div style="font:600 13px/1.35 system-ui;color:#1a1c20;word-break:break-word">${esc(it.fromLabel)} <span style="color:#c2c5cd">&#8594;</span> <span style="font:500 12.5px/1.35 'JetBrains Mono',ui-monospace,monospace;color:${ACCENT_DK}">${esc(it.toLabel)}</span></div>
				<div style="margin-top:4px;font:400 12px/1.5 system-ui;color:#696e78">${esc(it.reason)}${skipped ? ' <span style="color:#a3a8b2">&middot; will stay put</span>' : ''}</div>
				${deps}
			</div>
			${toggle}
		</div>`;
	};
	return `<div style="margin-bottom:34px">
		<div style="display:flex;align-items:baseline;justify-content:space-between;gap:12px;margin-bottom:12px">
			<div style="font:600 11px/1 'JetBrains Mono',ui-monospace,monospace;letter-spacing:.12em;color:${ACCENT}">TIDY &middot; ${review.items.length} PROPOSED MOVE${review.items.length === 1 ? '' : 'S'}</div>
			<span style="font:400 11px/1.4 system-ui;color:#a3a8b2">Nothing moves until you apply.</span>
		</div>
		<div style="background:#fff;border:1px solid #e9eaee;border-radius:14px;overflow:hidden">${review.items.map(card).join('')}
			<div style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:14px 16px;background:#fbfbfd">
				<span style="font:400 12px/1.4 system-ui;color:#696e78">${approved} of ${review.items.length} approved</span>
				<div style="display:flex;gap:8px">
					<button data-msg="tidyCancel" style="border:1px solid #e0e2e8;background:#fff;border-radius:9px;padding:9px 15px;font:500 12.5px/1 system-ui;color:#52575f;cursor:pointer">Cancel</button>
					<button data-msg="tidyApply"${approved === 0 ? ' disabled' : ''} style="border:none;border-radius:9px;padding:9px 16px;background:${approved === 0 ? '#c7cbe8' : ACCENT};color:#fff;font:600 12.5px/1 system-ui;cursor:${approved === 0 ? 'default' : 'pointer'}">Apply ${approved} move${approved === 1 ? '' : 's'}</button>
				</div>
			</div>
		</div>
	</div>`;
}

// The WHILE YOU WERE AWAY feed + the all-clear promotion (map-D14). Real data only: the rows are agent runs
// since the last visit (from the persisted run log); when nothing ran the section is absent, and when nothing
// needs review the calm all-clear promotion is shown ("Everything is in sync") rather than a fabricated feed.
function renderAwaySection(feed: IAwayFeed): string {
	// The all-clear promotion (map-D14): nothing pending -> a calm green banner, the honest "in sync" state.
	const allClear = feed.allClear
		? `<div style="display:flex;align-items:center;gap:11px;background:#eef7f0;border:1px solid #d7ecdc;border-radius:12px;padding:14px 16px;margin-bottom:26px">
			<span style="width:22px;height:22px;flex:none;border-radius:50%;background:oklch(0.6 0.13 150);color:#fff;font:600 13px/22px system-ui;text-align:center">&#10003;</span>
			<div><div style="font:600 13.5px/1.3 system-ui;color:#2f6b45">Everything is in sync</div><div style="font:400 12px/1.4 system-ui;color:#5d8a66">Nothing needs your review right now.</div></div>
		</div>`
		: '';
	if (!feed.hasActivity) {
		// No runs in the window: show the all-clear if clear, else nothing (a non-empty pending set already
		// surfaces through NEEDS YOU below - the feed never invents activity to fill the space).
		return allClear;
	}
	const row = (r: IAwayFeed['rows'][number]) => {
		const av = avatar(r.agentName);
		// Honest per-run outcome: a failure names itself; a skip says why; otherwise the applied/queued tally.
		const outcome = r.failed
			? `<span style="font:500 11.5px/1.3 system-ui;color:#9a6b16">Failed${r.error ? ` &mdash; ${esc(r.error)}` : ''}</span>`
			: r.skipped
				? `<span style="font:500 11.5px/1.3 system-ui;color:#a3a8b2">Skipped &mdash; a previous run was still going</span>`
				: `<span style="font:400 11.5px/1.3 system-ui;color:#52575f">${r.docsTouched} doc${r.docsTouched === 1 ? '' : 's'} &middot; ${r.applied} applied</span>`;
		const needs = r.queued > 0
			? `<span style="flex:none;font:600 9.5px/1 'JetBrains Mono',ui-monospace,monospace;letter-spacing:.03em;color:#8a6d1a;background:#fdfaf2;border:1px solid #e4dccb;border-radius:5px;padding:4px 7px">${r.queued} NEEDS YOU</span>`
			: `<span style="flex:none;display:flex;align-items:center"><span style="width:6px;height:6px;border-radius:50%;background:oklch(0.6 0.13 150)"></span></span>`;
		return `<div style="display:flex;align-items:center;gap:11px;padding:12px 14px;border-bottom:1px solid #f0f1f4">
			<span style="width:26px;height:26px;flex:none;border-radius:7px;background:${av.color};color:#fff;font:600 10px/26px system-ui;text-align:center">${av.text}</span>
			<div style="flex:1;min-width:0"><div style="font:600 13px/1.3 system-ui;color:#1a1c20;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(r.agentName)}</div>${outcome}</div>
			<span style="flex:none;font:400 10.5px/1 'JetBrains Mono',ui-monospace,monospace;color:#a3a8b2">${esc(r.whenLabel)}</span>
			${needs}
		</div>`;
	};
	const label = feed.firstVisit ? 'RECENT ACTIVITY' : 'WHILE YOU WERE AWAY';
	return `${allClear}<div style="font:600 11px/1 'JetBrains Mono',ui-monospace,monospace;letter-spacing:.12em;color:#a3a8b2;margin-bottom:12px">${label}</div>
		<div style="background:#fff;border:1px solid #e9eaee;border-radius:14px;overflow:hidden;margin-bottom:34px">${feed.rows.map(row).join('')}</div>`;
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
	const scroll = (inner: string) => `<div class="screen"><div style="flex:1;overflow-y:auto;background:#f8f9fb">${inner}</div></div>`;
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
	const scroll = (inner: string) => `<div class="screen"><div style="flex:1;overflow-y:auto;background:#f8f9fb">${inner}</div></div>`;

	// No folder open: a single calm invitation to open one (the on-ramp).
	if (!state.hasFolder) {
		return `<div class="screen"><div style="flex:1;overflow-y:auto;background:#f8f9fb;display:flex;align-items:center;justify-content:center">
			<div style="text-align:center;max-width:430px;padding:40px">
				<div style="font-size:42px;line-height:1;margin-bottom:16px">&#128193;</div>
				<h1 style="margin:0 0 10px;font:600 23px/1.25 system-ui;color:#15171c;letter-spacing:-.01em">Open a folder to begin</h1>
				<p style="margin:0 0 24px;font:400 14px/1.6 system-ui;color:#696e78">Living Documents works on a folder of Markdown files on your computer. Open one to see its documents, sources and agents &mdash; everything stays on disk.</p>
				<button data-msg="openFolder" style="border:none;border-radius:10px;padding:13px 22px;background:${ACCENT};color:#fff;font:600 14px/1 system-ui;cursor:pointer">Open folder&hellip;</button>
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

	// NEEDS YOU + the greeting summary are derived from the REAL per-document pending count that
	// listDocuments() already carries (ILivingDocSummary.pendingCount = the live pending set for that
	// doc). Never fabricated: if nothing pends the section is absent and the summary is "in sync".
	const pendingDocs = docs.filter(d => d.pendingCount > 0).sort((a, b) => b.pendingCount - a.pendingCount);
	const totalPending = pendingDocs.reduce((n, d) => n + d.pendingCount, 0);
	// When work pends, the greeting names it; when clear, it hands off to the all-clear promotion below rather
	// than repeating "in sync" here (the map-D14 banner in the WHILE YOU WERE AWAY section carries that line).
	const summary = pendingDocs.length
		? `${pendingDocs.length} document${pendingDocs.length === 1 ? '' : 's'} need${pendingDocs.length === 1 ? 's' : ''} your review across this project. <strong style="font-weight:600;color:#8a6d1a">${totalPending} change${totalPending === 1 ? '' : 's'} to approve</strong>.`
		: `Here is where ${esc(folderName)} stands.`;

	// One NEEDS-YOU card per document with pending work: accent top-border, a 2.4s pulse dot, the doc
	// name, the amber `N TO APPROVE` chip (attention tokens), and a primary Review that opens the doc.
	const needsCard = (d: ILivingDocSummary) => {
		const av = avatar(d.title);
		const n = d.pendingCount;
		return `<div style="flex:1;min-width:0;max-width:520px;background:#fff;border:1px solid #e0e5fb;border-radius:15px;padding:20px 22px;box-shadow:0 12px 30px -20px rgba(86,97,201,.45);position:relative">
			<div style="position:absolute;top:0;left:22px;right:22px;height:3px;background:${ACCENT};border-radius:0 0 3px 3px"></div>
			<div style="display:flex;align-items:center;gap:10px;margin-bottom:6px"><span style="width:28px;height:28px;flex:none;border-radius:8px;background:${av.color};color:#fff;font:600 11px/28px system-ui;text-align:center">${av.text}</span><span style="font:600 16px/1.2 system-ui;color:#1a1c20;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(d.title)}</span><span style="margin-left:auto;flex:none;font:600 9.5px/1 'JetBrains Mono',ui-monospace,monospace;letter-spacing:.04em;color:#8a6d1a;background:#fdfaf2;border:1px solid #e4dccb;border-radius:5px;padding:4px 7px">${n} TO APPROVE</span></div>
			<div style="font:400 11.5px/1 'JetBrains Mono',ui-monospace,monospace;color:#a3a8b2;margin-bottom:16px;padding-left:38px">${d.sources.length ? `${d.sources.length} source${d.sources.length === 1 ? '' : 's'}` : 'Living document'}</div>
			<div style="display:flex;gap:8px;margin-bottom:16px"><span style="width:7px;height:7px;border-radius:50%;background:oklch(0.66 0.16 45);margin-top:5px;flex:none;animation:lwdPulse 2.4s ease-in-out infinite"></span><span style="font:400 12.5px/1.5 system-ui;color:#52575f"><strong style="color:#1a1c20;font-weight:600">${n} change${n === 1 ? '' : 's'}</strong> from a source refresh ${n === 1 ? 'is' : 'are'} waiting for your review.</span></div>
			<button data-msg="openDoc" data-arg="${esc(d.resource.toString())}" style="width:100%;font:600 13px/1 system-ui;color:#fff;background:${ACCENT};border:none;border-radius:9px;padding:11px;cursor:pointer">Review ${n} change${n === 1 ? '' : 's'}</button>
		</div>`;
	};
	// The quiet attention line for a failed scheduled run (plan 32 iter 2): one calm amber row linking to the
	// Agents screen. Only rendered when a run actually failed (real data) - no fake activity when all is well.
	const fail = state.homeFailure;
	const failureLine = fail
		? `<button data-msg="goAgents" title="${esc(fail.error)}" style="display:flex;align-items:center;gap:9px;width:100%;text-align:left;margin:0 0 26px;padding:11px 14px;background:#fdf6e9;border:1px solid #f0e2c4;border-radius:10px;font:500 12.5px/1.4 system-ui;color:#9a6b16;cursor:pointer"><span style="width:7px;height:7px;flex:none;border-radius:50%;background:oklch(0.66 0.16 45)"></span><span style="flex:1">${esc(fail.agentName)} failed on ${esc(fail.day)}</span><span style="font:600 12px/1 system-ui;color:${ACCENT_DK}">View details &#8594;</span></button>`
		: '';
	const needsYou = pendingDocs.length
		? `<div style="font:600 11px/1 'JetBrains Mono',ui-monospace,monospace;letter-spacing:.12em;color:#5661c9;margin-bottom:14px;display:flex;align-items:center;gap:8px"><span style="width:6px;height:6px;border-radius:50%;background:${ACCENT};animation:lwdPulse 2.4s ease-in-out infinite"></span>NEEDS YOU</div>
			<div style="display:flex;gap:16px;margin-bottom:34px;flex-wrap:wrap">${pendingDocs.slice(0, 2).map(needsCard).join('')}</div>`
		: '';

	// ALL PROJECTS grid (D22-A): the current folder prominently + recent folders as additional tiles.
	// Counts for the current folder are REAL (from the live listDocuments() data + distinct sources).
	// Counts for recent folders are DEFERRED (not yet loaded) - show name + avatar only, per the
	// real-data guardrail (never fabricate counts for unloaded projects).
	const distinctSources = new Set<string>();
	for (const d of docs) { for (const s of d.sources) { distinctSources.add(s); } }
	const docCount = docs.length;
	const srcCount = distinctSources.size;
	const countsLabel = srcCount > 0
		? `${docCount} doc${docCount === 1 ? '' : 's'} &middot; ${srcCount} source${srcCount === 1 ? '' : 's'}`
		: `${docCount} doc${docCount === 1 ? '' : 's'}`;

	// Current-project tile (comp: 1px border, 14px radius, 17x18px padding, 24px avatar/7px-radius).
	// The current project tile gets the same uniform border as the comp (no 2px accent outline) but
	// a subtle accent-tint background so the active project reads as distinct from recent ones.
	const currentAv = avatar(folderName);
	const currentTile = `<button data-msg="openFirstDoc" style="text-align:left;background:#f7f9ff;border:1px solid #e0e5fb;border-radius:14px;padding:17px 18px;cursor:pointer;display:flex;flex-direction:column;gap:12px;width:100%">
		<div style="display:flex;align-items:center;gap:9px">
			<span style="width:24px;height:24px;flex:none;border-radius:7px;background:${currentAv.color};color:#fff;font:600 10px/24px system-ui;text-align:center">${currentAv.text}</span>
			<span style="font:600 14px/1 system-ui;color:#1a1c20;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1">${esc(folderName)}</span>
			${healthIndicator(totalPending)}
		</div>
		<div style="font:400 11px/1 'JetBrains Mono',ui-monospace,monospace;color:#a3a8b2">${countsLabel}</div>
	</button>`;

	// Recent-folder tiles (D22-A): name + avatar only, "Open" affordance instead of counts.
	// Filter out the current folder so it does not appear twice.
	const recents = (state.recentFolders ?? []).filter(r => r.name !== folderName);
	const recentTile = (r: IRecentProject) => {
		const av = avatar(r.name);
		return `<button data-msg="openRecentFolder" data-arg="${esc(r.folderUri)}" style="text-align:left;background:#fff;border:1px solid #e9eaee;border-radius:14px;padding:17px 18px;cursor:pointer;display:flex;flex-direction:column;gap:12px;width:100%">
			<div style="display:flex;align-items:center;gap:9px">
				<span style="width:24px;height:24px;flex:none;border-radius:7px;background:${av.color};color:#fff;font:600 10px/24px system-ui;text-align:center">${av.text}</span>
				<span style="font:600 14px/1 system-ui;color:#1a1c20;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1">${esc(r.name)}</span>
				<span style="font:500 10px/1 system-ui;color:#a3a8b2;flex:none">Open &#8599;</span>
			</div>
			<div style="font:400 11px/1 'JetBrains Mono',ui-monospace,monospace;color:#c2c5cd">Open to see counts</div>
		</button>`;
	};

	const allTiles = [currentTile, ...recents.map(recentTile)];
	// 3-column grid for >= 3 tiles; 2-column for fewer (comp uses 3-col).
	const cols = allTiles.length >= 3 ? 3 : (allTiles.length === 2 ? 2 : 1);
	const projectsGrid = `<div style="display:grid;grid-template-columns:repeat(${cols},1fr);gap:14px">${allTiles.join('')}</div>`;

	// New-document on-ramp (plan 28, iter 4): a "New document" primary + a name-or-template sheet. Blank
	// (Enter/default) makes a titled `<name>.md` - or an Untitled name-on-save doc when the name is empty
	// (decision 56); the template rows reach the iter-3 generate flow with that same typed name.
	// The "From sources..." birth (F17): its picker offers the project's real data files (csv/json bind
	// sources) and documents (md/txt knowledge). With none, the New-document sheet omits the row and the
	// picker shows a calm empty line. Real data only - the options come from the service's folder scan.
	const birthSheets = renderBirthSheets(state);
	// The whole-project chat composer (map-D21/D24) leads the front door; the WHILE YOU WERE AWAY feed +
	// all-clear promotion (map-D14) sit between it and the NEEDS-YOU cards. Both render from real state only.
	const composer = renderHomeComposer(state);
	const awaySection = state.awayFeed ? renderAwaySection(state.awayFeed) : '';
	// D26: a "Continue your walkthrough" banner when an onboarding is in progress (shared with the
	// empty-project front door - see renderResumeBanner for why both Home paths carry it).
	const resumeBanner = renderResumeBanner(state);
	return scroll(`<div style="max-width:1080px;margin:0 auto;padding:40px 36px 80px">
		${resumeBanner}
		<div style="display:flex;align-items:baseline;justify-content:space-between;gap:24px;margin-bottom:6px"><h1 style="margin:0;flex:none;white-space:nowrap;font:600 26px/1.2 system-ui;color:#15171c;letter-spacing:-.01em">Good morning, Tom</h1><div style="flex:none;display:flex;gap:8px"><button data-msg="newDocument" data-sheet-open="newdoc" style="border:none;border-radius:8px;padding:8px 14px;background:${ACCENT};color:#fff;font:600 12px/1 system-ui;cursor:pointer">&#65291; New document</button><button data-msg="openFolder" style="border:1px solid #e6e8ed;background:#fff;border-radius:8px;padding:7px 12px;font:500 12px/1 system-ui;color:#52575f;cursor:pointer">Switch folder&hellip;</button></div></div>
		<p style="margin:0 0 22px;font:400 14.5px/1.5 system-ui;color:#52575f">${summary}</p>
		${composer}
		${renderTidy(state)}
		${failureLine}
		${awaySection}
		${needsYou}
		<div style="font:600 11px/1 'JetBrains Mono',ui-monospace,monospace;letter-spacing:.12em;color:#a3a8b2;margin-bottom:14px">ALL PROJECTS</div>
		${projectsGrid}
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
