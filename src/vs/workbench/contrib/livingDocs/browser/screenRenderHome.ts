/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Home: the landing dashboard + the empty-project front door, plus the front-door pieces they share
// (the whole-project chat composer, the one state banner, the demoted walkthrough card, the F17 birth sheets,
// the New-document sheet). Only `renderHome` is public; every helper below is private to this screen. Split
// out of screenRender.ts so the Home + Templates lane never collides with the Knowledge + Agents lane in one
// file. Shared helpers come from screenRenderShell.
//
// Round 2 (docs/28-design-system-round2.md, comp panels 1a/1b/4c): every colour is a token from
// abstractTokens, every type step comes off the ladder, and the screen's state lives in ONE place - the
// banner. There is no permanent status pill on Home any more: the banner IS the status, green when nothing
// needs the user and amber (with the review queue folded into it) when something does.

import { localize } from '../../../../nls.js';
import { ILivingDocSummary, ITemplateInfo } from '../common/livingDocs.js';
import { IAwayFeed } from '../common/projectHomeFeed.js';
import { docRailDot } from '../common/railStatus.js';
import { AMBER, FONT, GREEN, HAIRLINE, INDIGO, INK, PAPER, RADIUS, TRACKING, TYPE } from '../common/abstractTokens.js';
import { esc, IHomeNeedsYou, IScreenState, pickerSheet, pickRow, sheet } from './screenRenderShell.js';

// The greeting and its date stamp (H1.2). Both read real facts (the wall clock, the resolved user name) so
// Home never fabricates a mood, a name or a date.

/** The time-of-day half of the greeting ("Good morning/afternoon/evening"), from the real local hour. */
function greetingTimeOfDay(hour: number): string {
	if (hour < 12) { return localize("livingDocs.home.morning", "Good morning"); }
	if (hour < 18) { return localize("livingDocs.home.afternoon", "Good afternoon"); }
	return localize("livingDocs.home.evening", "Good evening");
}

/** The mono date stamp beside the greeting, e.g. "Mon 14 Jul" - the real current date, weekday + day + month.
 *  The comp renders it uppercase; that is done in CSS (`text-transform`) rather than here, so the string this
 *  function returns stays the honest, readable date rather than a shouted one. */
function greetingDate(now: Date): string {
	const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
	const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
	return `${days[now.getDay()]} ${now.getDate()} ${months[now.getMonth()]}`;
}

// ---- Countable phrases. The banner, the queue and the composer all compose sentences out of the same four
// counted nouns, so the plural rules live in one place and every surface says "1 change" / "3 changes" the
// same way. Each is its own localized string (never "n" + a bare noun) so a translator can decline them. ----

function figuresPhrase(n: number): string {
	return n === 1
		? localize("livingDocs.home.count.figure.one", "1 figure")
		: localize("livingDocs.home.count.figure.many", "{0} figures", n);
}

function changesPhrase(n: number): string {
	return n === 1
		? localize("livingDocs.home.count.change.one", "1 change")
		: localize("livingDocs.home.count.change.many", "{0} changes", n);
}

function documentsPhrase(n: number): string {
	return n === 1
		? localize("livingDocs.home.count.document.one", "1 document")
		: localize("livingDocs.home.count.document.many", "{0} documents", n);
}

function sourcesPhrase(n: number): string {
	return n === 1
		? localize("livingDocs.home.count.source.one", "1 source")
		: localize("livingDocs.home.count.source.many", "{0} sources", n);
}

// ---- The state banner (comp 1a/1b) - the centrepiece of Home and the ONLY place state is drawn. One shape,
// two states: green when nothing needs the user, amber when something does. The amber state also *becomes*
// the review queue, so the work and the summary of the work are never two separate surfaces to reconcile. ----

/** The while-you-were-away facts, folded out of the real run log so the banner body is never fabricated. */
interface IAwaySummary {
	/** The plain-words sentence, e.g. "While you were away: Weekly refresh applied 2 figures." */
	readonly sentence: string;
	/** The relative time of the most recent run, rendered as the line's mono provenance atom ("15m ago"). */
	readonly when: string;
	/** Figures the runs applied without asking - drives the queue's FIGURES receipt row. */
	readonly applied: number;
	/** The agent whose run is the most recent, for the FIGURES row's sentence. */
	readonly agentName: string;
}

/**
 * Summarise the WHILE YOU WERE AWAY feed into the one line the banner carries. Failed and skipped runs are
 * left out: a run that never happened has no facts to report, and a failure is its own (separate) signal
 * rather than a footnote on the all-clear. Returns undefined when nothing ran in the window, so the caller
 * renders the honest "nothing has changed" line instead of an empty sentence.
 */
function summariseAway(feed: IAwayFeed | undefined): IAwaySummary | undefined {
	const rows = (feed?.rows ?? []).filter(r => !r.skipped && !r.failed);
	if (!rows.length) { return undefined; }
	// `buildAwayFeed` sorts newest-first, so row 0 is the run whose relative time labels the line.
	const latest = rows[0];
	let applied = 0;
	let queued = 0;
	for (const row of rows) { applied += row.applied; queued += row.queued; }
	// No full stops: the line is a run of facts separated by the comp's middle dot, and the run's relative time
	// is the last of them (added by `bannerBody` as the mono provenance atom).
	const sentence = applied > 0 && queued > 0
		? localize("livingDocs.home.away.appliedQueued", "While you were away: {0} applied {1} and queued {2} for you", latest.agentName, figuresPhrase(applied), changesPhrase(queued))
		: applied > 0
			? localize("livingDocs.home.away.applied", "While you were away: {0} applied {1}", latest.agentName, figuresPhrase(applied))
			: queued > 0
				? localize("livingDocs.home.away.queued", "While you were away: {0} queued {1} for you", latest.agentName, changesPhrase(queued))
				: localize("livingDocs.home.away.ran", "While you were away: {0} ran and found nothing to change", latest.agentName);
	return { sentence, when: latest.whenLabel, applied, agentName: latest.agentName };
}

/**
 * The "about N minutes to all clear" promise. Grounded in the REAL pending count at a flat 45-second budget
 * per change (which is what the comp's own "3 changes -> about 2 minutes" encodes): it is an arithmetic
 * projection of the work outstanding, never a measured prediction, so it is only ever stated in "about"
 * terms - and it cannot appear at all when nothing pends, because the banner is green then.
 */
function etaSentence(pendingTotal: number): string {
	const minutes = Math.max(1, Math.round((pendingTotal * 45) / 60));
	return minutes === 1
		? localize("livingDocs.home.banner.eta.one", "About a minute to all clear.")
		: localize("livingDocs.home.banner.eta.many", "About {0} minutes to all clear.", minutes);
}

/** The banner's 11px state dot. Card dots are 7px and source dots 6px - one dot scale, three sizes. */
function bannerDot(colour: string): string {
	return `<span style="width:11px;height:11px;flex:none;border-radius:${RADIUS.pill};background:${colour};margin-top:5px"></span>`;
}

/**
 * The banner body line: the plain-words sentence, then the mono provenance atom (the run's relative time),
 * then whatever the state adds after it (the amber hand-off + estimate). Every piece is optional, so the
 * line never renders a dangling separator for a fact we do not have.
 */
function bannerBody(colour: string, sentence: string, when: string | undefined, tail: string): string {
	const stamp = when ? `<span style="font:${TYPE.provenance}">&middot; ${esc(when)}</span>` : '';
	const parts = [sentence ? esc(sentence) : '', stamp, tail].filter(Boolean);
	return `<div style="font:400 14px/1.6 ${FONT.sans};color:${colour};margin-top:5px">${parts.join(' ')}</div>`;
}

/** One row of the amber banner's queue, before it is drawn. `sentence` and `action` are markup (the caller
 *  escapes every value it interpolates); `badge` and `fact` are plain text this module escapes. */
interface IQueueRow {
	readonly badge: string;
	readonly badgeColour: string;
	readonly sentence: string;
	readonly fact: string;
	readonly action: string;
}

/**
 * Draw one queue row. The anatomy is the comp's: a mono kind badge (amber for a MEANING change that needs a
 * human call, green for figures already applied), the sentence in plain words, the mono provenance fact
 * right-aligned, then the indigo action link. Rows are separated by the amber hairline; the last one is not,
 * because the banner's own border closes it.
 */
function queueRow(row: IQueueRow, last: boolean): string {
	const rule = last ? '' : `border-bottom:1px solid ${AMBER.hairline};`;
	const provenance = row.fact
		? `<span style="flex:none;font:${TYPE.provenance};color:${INK.meta}">${esc(row.fact)}</span>`
		: '';
	return `<div style="display:flex;align-items:center;gap:12px;padding:13px 26px;${rule}">
		<span style="flex:none;font:${TYPE.kindBadge};letter-spacing:${TRACKING.kindBadge};color:${row.badgeColour}">${esc(row.badge)}</span>
		<span style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font:${TYPE.uiBody};color:${INK.body}">${row.sentence}</span>
		<span style="flex:1"></span>
		${provenance}
		${row.action}
	</div>`;
}

/** The indigo text link that ends every queue row ("review ->", "receipts ->"). */
function queueAction(msg: string, label: string, arg?: string, block?: string): string {
	const args = `${arg !== undefined ? ` data-arg="${esc(arg)}"` : ''}${block !== undefined ? ` data-block="${esc(block)}"` : ''}`;
	return `<button data-msg="${msg}"${args} style="flex:none;border:none;background:none;padding:0;cursor:pointer;font:${TYPE.secondary};color:${INDIGO.base}">${esc(label)} &#8594;</button>`;
}

/**
 * The amber banner's queue (comp 1b): below the head, the banner becomes the work. One row per document that
 * needs a call (the real `homeNeedsYou` detail, deep-linking to the exact block), an overflow row when more
 * documents pend than the host projected cards for, and a green FIGURES receipt row for what was applied
 * without asking. Empty when there is nothing real to list - the head then stands alone rather than fronting
 * an empty table.
 */
function renderQueue(state: IScreenState, cards: readonly IHomeNeedsYou[], away: IAwaySummary | undefined): string {
	const meaning = localize("livingDocs.home.queue.badge.meaning", "MEANING");
	// The title carries the emphasis (it is what the user scans for); the reason is the host's real
	// plain-language sentence for the top pending change, address and all.
	const rows: IQueueRow[] = cards.map(card => ({
		badge: meaning,
		badgeColour: AMBER.label,
		sentence: `<strong>${esc(card.title)}</strong> - ${esc(card.reason)}`,
		fact: card.refreshedLabel ?? '',
		action: queueAction('reviewNeedsYou', localize("livingDocs.home.queue.review", "review"), card.resource, card.blockId ?? ''),
	}));
	// H2.1 overflow: the host projects detail for at most two documents, so when more pend the queue says so
	// honestly and hands the rest to the cross-document review surface rather than inventing rows.
	const overflow = (state.homeNeedsYouTotal ?? 0) - cards.length;
	if (overflow > 0) {
		rows.push({
			badge: meaning,
			badgeColour: AMBER.label,
			sentence: esc(overflow === 1
				? localize("livingDocs.home.queue.more.one", "1 more document is waiting on you.")
				: localize("livingDocs.home.queue.more.many", "{0} more documents are waiting on you.", overflow)),
			fact: '',
			action: queueAction('reviewProject', localize("livingDocs.home.queue.reviewAll", "review all")),
		});
	}
	// The FIGURES row is the receipt for what Abstract did WITHOUT asking - green, because it is settled, and
	// pointing at the activity ledger where the full receipt lives.
	if (away && away.applied > 0) {
		rows.push({
			badge: localize("livingDocs.home.queue.badge.figures", "FIGURES"),
			badgeColour: GREEN.base,
			sentence: esc(localize("livingDocs.home.queue.figures", "{0} applied {1} automatically", away.agentName, figuresPhrase(away.applied))),
			fact: away.when,
			action: queueAction('goAgents', localize("livingDocs.home.queue.receipts", "receipts")),
		});
	}
	if (!rows.length) { return ''; }
	const html = rows.map((row, i) => queueRow(row, i === rows.length - 1)).join('');
	return `<div style="border-top:1px solid ${AMBER.edge};background:${PAPER.card};display:flex;flex-direction:column">${html}</div>`;
}

/**
 * The one state banner (comp 1a/1b). Green: nothing needs the user, the body carries the real
 * while-you-were-away facts and a quiet History pill. Amber: the real pending set is named in the headline,
 * an indigo primary opens the review, and the banner grows the queue of the actual work below its head.
 * Every number here is the live pending set or the persisted run log - nothing is seeded.
 */
function renderStateBanner(state: IScreenState, docs: readonly ILivingDocSummary[]): string {
	const away = summariseAway(state.awayFeed);
	let pendingTotal = 0;
	let pendingDocs = 0;
	for (const doc of docs) {
		pendingTotal += doc.pendingCount;
		if (doc.pendingCount > 0) { pendingDocs++; }
	}

	if (pendingTotal === 0) {
		const sentence = away
			? away.sentence
			: localize("livingDocs.home.banner.clear.quiet", "Nothing has changed since you were last here.");
		return `<div style="display:flex;align-items:flex-start;gap:16px;background:${GREEN.bg};border:1px solid ${GREEN.border};border-radius:${RADIUS.cardLarge};padding:22px 26px">
			${bannerDot(GREEN.base)}
			<div style="flex:1;min-width:0">
				<div style="font:${TYPE.bannerHeadline};color:${GREEN.headline}">${esc(localize("livingDocs.home.banner.clear.headline", "All clear - nothing needs you."))}</div>
				${bannerBody(GREEN.body, sentence, away?.when, '')}
			</div>
			<button data-msg="goAgents" style="flex:none;font:${TYPE.secondary};color:${GREEN.body};background:${PAPER.card};border:1px solid ${GREEN.border};border-radius:${RADIUS.pill};padding:5px 14px;cursor:pointer">${esc(localize("livingDocs.home.banner.history", "History"))}</button>
		</div>`;
	}

	const headline = pendingTotal === 1
		? localize("livingDocs.home.banner.needs.one", "1 change is waiting on you.")
		: pendingDocs === 1
			? localize("livingDocs.home.banner.needs.oneDoc", "{0} changes in 1 document are waiting on you.", pendingTotal)
			: localize("livingDocs.home.banner.needs.many", "{0} changes across {1} documents are waiting on you.", pendingTotal, pendingDocs);
	// The body hands the work over: what was applied for the user, what is left for them, and how long the
	// rest should take. The hand-off sentence only claims figures were applied when the run log says so.
	const handoff = away && away.applied > 0
		? localize("livingDocs.home.banner.needs.handoff", "Figures were applied for you; the meaning changes below wait for your call.")
		: localize("livingDocs.home.banner.needs.handoffPlain", "The changes below are waiting for your call.");
	const handoffTail = `${esc(handoff)} <strong>${esc(etaSentence(pendingTotal))}</strong>`;
	// The hand-off is another fact on the same line, so it takes the same middle-dot separator - unless there
	// were no overnight facts at all, in which case it opens the line and needs no separator.
	const tail = away ? `&middot; ${handoffTail}` : handoffTail;
	const sentence = away ? away.sentence : '';
	return `<div style="background:${AMBER.bg};border:1px solid ${AMBER.border};border-radius:${RADIUS.cardLarge};overflow:hidden">
		<div style="display:flex;align-items:flex-start;gap:16px;padding:22px 26px 18px">
			${bannerDot(AMBER.base)}
			<div style="flex:1;min-width:0">
				<div style="font:${TYPE.bannerHeadline};color:${AMBER.headline}">${esc(headline)}</div>
				${bannerBody(AMBER.body, sentence, away?.when, tail)}
			</div>
			<button data-msg="reviewProject" class="btn-primary" style="flex:none">${esc(localize("livingDocs.home.banner.needs.action", "Review {0}", changesPhrase(pendingTotal)))}</button>
		</div>
		${renderQueue(state, state.homeNeedsYou ?? [], away)}
	</div>`;
}

// ---- Home front-door pieces (F15 / journey 1w): the whole-project chat composer and the empty-project front
// door. All are DOM-free HTML over the real state. ----

// The whole-project chat composer (map-D21/D24): "Ask anything..." defaulting to whole-project scope. A
// question answers read-only with citations (rendered below the box); a change request opens the run/task
// surface. The client script gathers the textarea and posts one `askProject` message with the text.
// Round 2 (comp 1a): the label is the indigo section label, and the old green "Whole project" pill is now a
// NEUTRAL count chip - green means "applied/fresh" in this system and a scope is neither, so the chip states
// the real scope in plain numbers instead of borrowing a meaning colour.
function renderHomeComposer(state: IScreenState, docs: readonly ILivingDocSummary[]): string {
	const answer = state.projectAnswer;
	// The read-only answer + its real citations (map-D24: "answers read-only with citations"). Citation chips
	// name the exact documents/sources consulted - never fabricated (the service intersects with what it read).
	// The row leads with a "Consulted:" label because that is exactly what the list is: on the fallback path
	// (the model named no citations) it carries EVERY file read for the answer, so an unlabelled row could read
	// as "sources supporting this answer" and over-claim; "Consulted" stays true on both paths.
	const citations = answer && answer.citations.length
		? `<div style="display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin-top:10px"><span style="font:${TYPE.kindBadge};letter-spacing:${TRACKING.kindBadge};color:${INK.meta}">${esc(localize("livingDocs.home.ask.consulted", "Consulted:"))}</span>${answer.citations.map(c => `<span style="font:${TYPE.provenance};color:${INDIGO.base};background:${INDIGO.tint};border:1px solid ${INDIGO.tintBorder};border-radius:${RADIUS.control};padding:4px 8px">&#128206; ${esc(c)}</span>`).join('')}</div>`
		: '';
	const answerBlock = answer
		? `<div style="margin-top:14px;background:${PAPER.card};border:1px solid ${HAIRLINE.strong};border-radius:${RADIUS.card};padding:16px 18px">
			<div style="font:${TYPE.kindBadge};letter-spacing:${TRACKING.kindBadge};color:${INK.meta};margin-bottom:8px">${esc(localize("livingDocs.home.ask.answerLabel", "ANSWER · READ-ONLY"))}</div>
			<div style="font:${TYPE.uiBody};color:${INK.body};white-space:pre-wrap">${esc(answer.answer)}</div>
			${citations}
		</div>`
		: '';
	const busy = state.askBusy
		? `<div style="margin-top:12px;display:flex;align-items:center;gap:9px;font:${TYPE.secondary};color:${INK.secondary}"><span style="width:12px;height:12px;border:2px solid ${PAPER.control};border-top-color:${INDIGO.base};border-radius:${RADIUS.pill};animation:lwdSpin .8s linear infinite"></span>${esc(localize("livingDocs.home.ask.busy", "Reading the project…"))}</div>`
		: '';
	// The scope chip states the real project scope. It is omitted on the empty-project front door: "0
	// documents" is true but useless, and there is nothing yet to scope a question to.
	const sourceNames = new Set<string>();
	for (const doc of docs) {
		for (const source of doc.sources) { sourceNames.add(source); }
	}
	const scopeChip = docs.length
		? `<span style="font:${TYPE.secondary};color:${INK.secondary};background:${PAPER.chip};border-radius:${RADIUS.pill};padding:3px 12px">${esc(localize("livingDocs.home.ask.scope", "{0} · {1}", documentsPhrase(docs.length), sourcesPhrase(sourceNames.size)))}</span>`
		: '';
	// No `outline:none` on the textarea: the composer is borderless to match the comp, so the browser's own
	// focus ring is the ONLY thing that shows a keyboard user where they are. The placeholder colour is the one
	// thing an inline style cannot express (`::placeholder` is a pseudo-element), so it rides in a one-rule
	// style block here rather than in the shell stylesheet - the composer owns it, and it travels with it.
	return `<style>[data-ask-input]::placeholder{color:${INK.meta}}</style>
	<div data-ask-box style="background:${PAPER.card};border:1px solid ${HAIRLINE.strong};border-radius:${RADIUS.cardLarge};padding:20px 24px 16px">
		<div style="display:flex;align-items:center;gap:10px;margin-bottom:12px"><span style="font:${TYPE.sectionLabel};letter-spacing:${TRACKING.sectionLabel};color:${INDIGO.base}">${esc(localize("livingDocs.home.ask.label", "ASK THIS PROJECT"))}</span>${scopeChip}</div>
		<textarea data-ask-input rows="2" placeholder="${esc(localize("livingDocs.home.ask.placeholder", "Ask anything, or ask me to change something across it…"))}" style="width:100%;resize:vertical;border:none;padding:8px 0 20px;font:${TYPE.docBody};color:${INK.heading};background:none"></textarea>
		<div style="display:flex;align-items:center;gap:12px;border-top:1px solid ${HAIRLINE.soft};padding-top:12px">
			<span style="flex:1;min-width:0;font:${TYPE.secondary};color:${INK.meta}">${esc(localize("livingDocs.home.ask.helper", "Questions are answered read-only, with citations. Change requests open a task you review."))}</span>
			<button data-ask-send class="btn-primary" style="flex:none">${esc(localize("livingDocs.home.ask.send", "Ask"))}</button>
		</div>
		${busy}${answerBlock}
	</div>`;
}

// The demoted walkthrough entry point (plan 42 slice L1, demoted again in round 2). It used to be a
// full-width banner above the greeting, which made the demo - not the user's work - the first thing on Home.
// The comp puts it in the documents grid as a quiet sunken card, so it is reachable without ever being a gate.
// Two mutually-exclusive shapes:
//  - an onboarding is in progress -> the card re-enters the guide at its saved step (the onboarding screen is
//    displaced by the demo document during the flow, so Home is the reliable re-entry);
//  - otherwise -> a DISMISSIBLE "See a 90-second demo" card (a small x removes it for good).
// The card is a div-with-role rather than a button so the dismiss control can nest inside it (a button may not
// contain a button); `data-keyactivate` gives it the same Enter/Space activation a real button would have.
function renderResumeCard(state: IScreenState): string {
	const tile = (title: string, sub: string, dismiss: string) => `<div data-msg="openOnboarding" data-keyactivate role="button" tabindex="0" style="background:${PAPER.sunken};border:1px solid ${PAPER.sunkenBorder};border-radius:${RADIUS.cardLarge};padding:18px 20px;display:flex;flex-direction:column;gap:7px;cursor:pointer">
			<div style="display:flex;align-items:center;gap:8px">
				<span style="font-size:13px;color:${INDIGO.base}">&#10022;</span>
				<span style="flex:1;min-width:0;font:600 14px/1.3 ${FONT.sans};color:${INK.bodySoft}">${esc(title)}</span>
				${dismiss}
			</div>
			<div style="font:${TYPE.secondary};color:${INK.meta}">${esc(sub)}</div>
		</div>`;
	if (state.onboardingResumeStep) {
		return tile(
			localize('livingDocs.onboarding.resume.title', "Your walkthrough is in progress"),
			localize('livingDocs.onboarding.resume.body', "Pick up the two-wow tour where you left off."),
			'');
	}
	if (state.demoCardDismissed) {
		return '';
	}
	// `data-stop` keeps the dismiss click off the card's own openOnboarding handler (the shell's message bridge
	// stops propagation for any element that carries it).
	const dismiss = `<button data-msg="dismissDemoCard" data-stop title="${esc(localize('livingDocs.onboarding.demoCard.dismiss', "Dismiss"))}" aria-label="${esc(localize('livingDocs.onboarding.demoCard.dismiss', "Dismiss"))}" style="flex:none;border:none;background:none;color:${INK.meta};font:400 16px/1 ${FONT.sans};cursor:pointer;padding:2px 4px">&#215;</button>`;
	return tile(
		localize('livingDocs.onboarding.demoCard.title', "See a 90-second demo"),
		localize('livingDocs.onboarding.demoCard.sub', "One figure bound to its source, one reviewable edit."),
		dismiss);
}

// The F17 birth sheets shared by both Home paths: the New-document sheet (whose "From your sources..." row
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
		title: localize("livingDocs.home.fromSources.title", "New document from your sources"),
		sub: localize("livingDocs.home.fromSources.sub", "Pick the sources to draft from, name it, and the draft arrives as changes to review - nothing is written for you."),
		nameLabel: localize("livingDocs.home.newDoc.nameLabel", "Name"),
		namePlaceholder: localize("livingDocs.home.fromSources.namePlaceholder", "e.g. Board note - March"),
		note: true,
		pickLabel: localize("livingDocs.home.fromSources.pickLabel", "Sources"),
		submitMsg: 'newFromSources',
		submitLabel: localize("livingDocs.home.fromSources.submit", "Draft from sources"),
		rows: sourceRows,
		empty: localize("livingDocs.home.fromSources.empty", "This project has no sources yet. Add a csv, json or document to the folder to draft from it."),
	});
	return renderNewDocSheet(state.templates ?? [], hasSources) + fromSourcesSheet;
}

function renderEmptyProjectFrontDoor(state: IScreenState, folderName: string): string {
	const scroll = (inner: string) => `<div class="screen" style="background:transparent"><div style="flex:1;overflow-y:auto;background:transparent">${inner}</div></div>`;
	const templates = state.templates ?? [];
	const templateHint = templates.length
		? localize("livingDocs.home.empty.hintTemplates", "Start from one of your {0}, from a blank page, or ask me to draft one.", templates.length === 1 ? localize("livingDocs.home.empty.template.one", "1 template") : localize("livingDocs.home.empty.template.many", "{0} templates", templates.length))
		: localize("livingDocs.home.empty.hintBlank", "Start from a blank page, or ask me to draft your first document.");
	// The demoted walkthrough card has no grid to sit in here, so it follows the composer as a single tile.
	const resumeCard = renderResumeCard(state);
	return scroll(`<div style="max-width:760px;margin:0 auto;padding:56px 36px 80px">
		<div style="text-align:center;margin-bottom:30px">
			<div style="font-size:38px;line-height:1;margin-bottom:14px">&#128196;</div>
			<h1 style="margin:0 0 8px;font:${TYPE.screenTitle};letter-spacing:${TRACKING.screenTitle};color:${INK.heading}">${esc(localize("livingDocs.home.empty.title", "{0} is empty", folderName))}</h1>
			<p style="margin:0;font:${TYPE.uiBody};color:${INK.secondary}">${esc(templateHint)}</p>
		</div>
		<div style="display:flex;gap:12px;justify-content:center;margin-bottom:30px">
			<button data-msg="newDocument" data-sheet-open="newdoc" class="btn-primary">&#65291; ${esc(localize("livingDocs.home.newDocument", "New document"))}</button>
			<button data-msg="goTemplates" class="btn-ghost">${esc(localize("livingDocs.home.empty.browseTemplates", "Browse templates"))}</button>
		</div>
		${renderHomeComposer(state, state.docs ?? [])}
		${resumeCard ? `<div style="margin-top:22px">${resumeCard}</div>` : ''}
		${renderBirthSheets(state)}
	</div>`);
}

// ---- The DOCUMENTS grid (comp 1a/1b H3). A card is the title, a state dot when the document is waiting or
// fresh, and ONE plain-words line about what actually happened to it. The round-1 avatar and status chip are
// gone: identity is not state, and a permanent chip is exactly the pill the banner replaced. ----

/** How a document reads at a glance: waiting on the user, freshly changed for them, or quiet. */
type DocCardState = 'waiting' | 'fresh' | 'quiet';

interface IDocCardLine {
	readonly text: string;
	readonly state: DocCardState;
}

/**
 * The card's one plain-words line, and the state it puts the card in. Derived from the SAME `docRailDot`
 * helper the tree rail's dots read, so a card and its rail row can never disagree - and the dot's tooltip is
 * already the plain-words sentence this line wants ("3 changes waiting for approval").
 *
 * The rail's red band ("needs input": a relink, a stale source, a failed fan-out) and its yellow band
 * ("waiting for approval") collapse into ONE waiting state here, because on Home they mean the same thing to
 * the reader: this document needs you. Amber carries that meaning in this system; the specific red reason is
 * not lost, it is what the line says. A quiet document has no dot at all, so colour only appears where it is
 * earned.
 */
function docCardLine(d: ILivingDocSummary): IDocCardLine {
	const dot = docRailDot(d);
	if (dot.color === 'red' || dot.color === 'yellow') { return { text: dot.tooltip, state: 'waiting' }; }
	if (dot.color === 'green') { return { text: dot.tooltip, state: 'fresh' }; }
	// Grey: nothing has happened, so the line states what the document IS rather than the dot's internal
	// "nothing to report". Every branch below is a real fact off the summary - never a fabricated age.
	if (d.needsSourceBinding) {
		return { text: localize("livingDocs.home.card.needsBinding", "No source bound yet - bind one to keep it live."), state: 'quiet' };
	}
	const sourceCount = new Set(d.sources).size;
	if (d.isLiving && sourceCount > 0) {
		const what = sourceCount === 1 ? d.sources[0] : sourcesPhrase(sourceCount);
		return {
			text: d.lastSynced
				? localize("livingDocs.home.card.boundSynced", "In sync with {0} · {1}", what, d.lastSynced)
				: localize("livingDocs.home.card.bound", "In sync with {0}", what),
			state: 'quiet',
		};
	}
	return { text: localize("livingDocs.home.card.quiet", "Nothing has changed since you last looked."), state: 'quiet' };
}

/**
 * The DOCUMENTS section: the label, then the 4-column grid of the open folder's real documents (decision 39 -
 * the folder IS the project, no fixture cards), the demoted walkthrough card, and the dashed New-document
 * tile. The grid is ordered waiting -> fresh -> quiet so the work is where the eye lands first; within a band
 * the service's title order is preserved (Array#sort is stable).
 *
 * The comp's label reads "DOCUMENTS · MOST RECENT FIRST". We cannot say that truthfully: `listDocuments`
 * sorts by title and `ILivingDocSummary` carries no timestamp, so the label names the order we DO produce.
 */
function renderDocumentsSection(state: IScreenState, docs: readonly ILivingDocSummary[]): string {
	const order: Record<DocCardState, number> = { waiting: 0, fresh: 1, quiet: 2 };
	const cards = docs.map(doc => ({ doc, line: docCardLine(doc) }));
	cards.sort((a, b) => order[a.line.state] - order[b.line.state]);
	const label = cards.some(c => c.line.state === 'waiting')
		? localize("livingDocs.home.documents.needsYouFirst", "DOCUMENTS · NEEDS YOU FIRST")
		: localize("livingDocs.home.documents", "DOCUMENTS");
	const docCard = (doc: ILivingDocSummary, line: IDocCardLine) => {
		const border = line.state === 'waiting' ? AMBER.border : HAIRLINE.strong;
		const lineColour = line.state === 'waiting' ? AMBER.body : INK.secondary;
		const dot = line.state === 'quiet'
			? ''
			: `<span style="width:7px;height:7px;flex:none;border-radius:${RADIUS.pill};background:${line.state === 'waiting' ? AMBER.base : GREEN.base}"></span>`;
		return `<button data-msg="openDoc" data-arg="${esc(doc.resource.toString())}" class="doc-tile" style="text-align:left;background:${PAPER.card};border:1px solid ${border};border-radius:${RADIUS.cardLarge};padding:18px 20px;display:flex;flex-direction:column;gap:7px;cursor:pointer">
			<span style="display:flex;align-items:center;gap:8px;min-width:0"><span style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font:600 15.5px/1.25 ${FONT.sans};color:${INK.heading}">${esc(doc.title)}</span>${dot}</span>
			<span style="font:400 13px/1.5 ${FONT.sans};color:${lineColour}">${esc(line.text)}</span>
		</button>`;
	};
	const newDocTile = `<button data-msg="newDocument" data-sheet-open="newdoc" class="doc-newtile" style="border:1px dashed ${PAPER.frameBorder};background:none;border-radius:${RADIUS.cardLarge};padding:18px 20px;display:flex;align-items:center;justify-content:center;gap:8px;color:${INK.secondary};font:${TYPE.uiBody};cursor:pointer"><span style="font-size:15px">&#65291;</span>${esc(localize("livingDocs.home.newDocument", "New document"))}</button>`;
	return `<div style="display:flex;flex-direction:column;gap:14px">
		<span style="font:${TYPE.sectionLabel};letter-spacing:${TRACKING.sectionLabel};color:${INK.secondary}">${label}</span>
		<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:14px">${cards.map(c => docCard(c.doc, c.line)).join('')}${renderResumeCard(state)}${newDocTile}</div>
	</div>`;
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
				<h1 style="margin:0 0 12px;font:${TYPE.docHeading};color:${INK.heading}">${localize("livingDocs.home.noFolder.title", "Open a folder to start working.")}</h1>
				<button data-msg="openFolder" class="btn-primary">${localize("livingDocs.home.noFolder.action", "Open folder")}</button>
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

	// The greeting names the user only when a name is genuinely known (the resolved profile/OS name); with
	// none it stays the plain time-of-day greeting rather than inventing a "there".
	const name = state.userName;
	const greeting = name
		? localize("livingDocs.home.greeting.name", "{0}, {1}.", greetingTimeOfDay(new Date().getHours()), name)
		: localize("livingDocs.home.greeting", "{0}.", greetingTimeOfDay(new Date().getHours()));
	return scroll(`<div style="max-width:1080px;margin:0 auto;padding:48px 56px 64px;display:flex;flex-direction:column;gap:30px">
		<div style="display:flex;align-items:baseline;gap:14px">
			<h1 style="margin:0;flex:none;white-space:nowrap;font:${TYPE.greeting};letter-spacing:${TRACKING.greeting};color:${INK.heading}">${esc(greeting)}</h1>
			<span style="flex:none;font:400 11.5px/1 ${FONT.mono};letter-spacing:.08em;text-transform:uppercase;color:${INK.meta}">${greetingDate(new Date())}</span>
		</div>
		${renderStateBanner(state, docs)}
		${renderHomeComposer(state, docs)}
		${renderDocumentsSection(state, docs)}
		${renderBirthSheets(state)}
	</div>`);
}

// ---- The New-document sheet (comp 4c: "name-first birth, three births, outcome copy on templates, Enter
// creates blank"). Name first, then the three ways a document can be born; the template rows say what the
// template will DO for you rather than counting its slots. Real data only: the template rows come from
// `listTemplates()`, and with none only the blank (and, when the folder has sources, the from-sources) row
// shows. Enter in the name field clicks the `data-sheet-default` row, which is the blank document. ----

/**
 * A template row's outcome copy. The round-1 meta read "2 slots · 1 source", which is the template's
 * internals, not what it does for the reader. This says what will happen instead, out of the template's own
 * real frontmatter: the sources it binds (so the figures fill live) and its authored description. A template
 * with no sources yet says "binds after creation" rather than the honest-but-useless "0 sources".
 */
function templateOutcome(t: ITemplateInfo): string {
	const description = t.description.trim();
	if (t.sources.length) {
		const list = t.sources.length === 1
			? t.sources[0]
			: localize("livingDocs.home.newDoc.sourceList", "{0} and {1} more", t.sources[0], t.sources.length - 1);
		const bound = localize("livingDocs.home.newDoc.outcomeBound", "Figures fill live from {0}", list);
		return description ? localize("livingDocs.home.newDoc.outcomeBoth", "{0}; {1}", bound, description) : bound;
	}
	return description
		? localize("livingDocs.home.newDoc.outcomeDescribed", "{0}; binds after creation", description)
		: localize("livingDocs.home.newDoc.outcomeUnbound", "A first draft to review; binds after creation");
}

function renderNewDocSheet(templates: readonly ITemplateInfo[], hasSources: boolean): string {
	// A 30px glyph tile leads each birth row: white-on-indigo for the pre-selected blank, sunken for the rest.
	const glyph = (background: string, border: string, colour: string, mark: string) =>
		`<span style="width:30px;height:30px;flex:none;border-radius:${RADIUS.control};background:${background};border:1px solid ${border};color:${colour};font:400 14px/28px ${FONT.sans};text-align:center">${mark}</span>`;
	const rowText = (title: string, sub: string) =>
		`<span style="flex:1;min-width:0"><span style="display:block;font:600 14px/1.3 ${FONT.sans};color:${INK.heading};overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(title)}</span><span style="display:block;font:${TYPE.secondary};color:${INK.secondary}">${esc(sub)}</span></span>`;
	// Birth 1, the default: pre-selected on the indigo tint, and the row Enter fires (`data-sheet-default`, which
	// the shell's name-field keydown handler clicks) - so naming a document and pressing Enter simply creates it.
	const blankRow = `<button class="sheet-row" data-sheet-submit data-sheet-default data-msg="newDocument" style="background:${INDIGO.tint};border-color:${INDIGO.tintBorder}">
		${glyph(PAPER.card, INDIGO.tintBorder, INDIGO.base, '&#65291;')}
		${rowText(localize("livingDocs.home.newDoc.blank", "Blank document"), localize("livingDocs.home.newDoc.blankSub", "An empty page with your name on it"))}
		<span style="flex:none;font:${TYPE.kindBadge};color:${INK.meta}">${esc(localize("livingDocs.home.newDoc.enterHint", "ENTER"))} &#9166;</span>
	</button>`;
	// Birth 2 (F17, map-D4): "From your sources..." opens the source picker sheet. Shown only when the project
	// has at least one source to draft from (real-data guardrail); it carries the typed name across.
	const fromSourcesRow = hasSources
		? `<button class="sheet-row" data-sheet-open="fromsources" data-name="">
			${glyph(PAPER.sunken, PAPER.sunkenBorder, INK.bodySoft, '&#8862;')}
			${rowText(localize("livingDocs.home.newDoc.fromSources", "From your sources…"), localize("livingDocs.home.newDoc.fromSourcesSub", "Drafted from your data and documents, through review"))}
		</button>`
		: '';
	// Birth 3: each real template, described by what it will do (never by its slot count), ending in the same
	// indigo "use ->" the gallery uses.
	const templateRow = (t: ITemplateInfo) => `<button class="sheet-row" data-sheet-submit data-msg="generateFromTemplate" data-arg="${esc(t.uri.toString())}">
			${rowText(t.name, templateOutcome(t))}
			<span style="flex:none;font:${TYPE.secondary};color:${INDIGO.base}">${esc(localize("livingDocs.home.newDoc.use", "use"))} &#8594;</span>
		</button>`;
	const templateSection = templates.length
		? `<div style="font:${TYPE.sectionLabel};letter-spacing:${TRACKING.sectionLabel};color:${INK.meta};margin:18px 0 2px">${esc(localize("livingDocs.home.newDoc.templateLabel", "OR START FROM A TEMPLATE"))}</div>${templates.map(templateRow).join('')}`
		: '';
	// The footer: a quiet text Cancel (no border - it is an escape, not an option) and the indigo primary,
	// which creates the same blank document the default row does.
	const footer = `<div style="display:flex;gap:8px;margin-top:18px;padding-top:14px;border-top:1px solid ${HAIRLINE.soft};justify-content:flex-end">
			<button data-sheet-close="newdoc" style="border:none;background:none;cursor:pointer;padding:7px 12px;font:${TYPE.uiBody};color:${INK.secondary}">${esc(localize("livingDocs.home.newDoc.cancel", "Cancel"))}</button>
			<button class="btn-primary" data-sheet-submit data-msg="newDocument">${esc(localize("livingDocs.home.newDoc.create", "Create"))}</button>
		</div>`;
	return sheet('newdoc', {
		title: localize("livingDocs.home.newDoc.title", "New document"),
		sub: localize("livingDocs.home.newDoc.sub", "Name it, then start blank or let a template draft the first version - through review, like everything else."),
		nameLabel: localize("livingDocs.home.newDoc.nameLabel", "Name"),
		namePlaceholder: localize("livingDocs.home.newDoc.namePlaceholder", "Name this document (optional)"),
		body: `<div style="margin-top:18px">${blankRow}${fromSourcesRow}${templateSection}</div>${footer}`,
	});
}
