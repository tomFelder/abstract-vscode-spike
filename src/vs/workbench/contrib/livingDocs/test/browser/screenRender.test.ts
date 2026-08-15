/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { URI } from '../../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { ILivingDocSummary, ISourceInfo, ITemplateCard, ITemplateInfo } from '../../common/livingDocs.js';
import { countBindSlots, parseLivingDoc, templateSkeletonRows } from '../../common/livingDocMarkdown.js';
import { IAgentDef, IAgentRun, ISkillRunSummary, summariseProjectRun, summariseSkillRun } from '../../common/livingDocsModel.js';
import { IScreenState, renderScreenHtml, ScreenId } from '../../browser/screenRender.js';
import { IActivityLedger } from '../../common/livingDocLedger.js';
import { AMBER, FONT, GREEN, HAIRLINE, INDIGO, INK, PAPER, RADIUS, RED } from '../../common/abstractTokens.js';

suite('livingDocs screenRender', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	const state: IScreenState = { knScope: 'org', agents: [], filter: 'all' };

	// (plan 44-b PH.4) The per-webview brand/crumb top bar is GONE from every main-area screen: the one
	// global Abstract header (the repurposed title bar, painted natively above the webviews) now carries
	// the breadcrumb, the surface action and the avatar. The screen body must draw NO top bar of its own,
	// so there is never a double header on any surface. (Round 2 also retired the header's standing sync
	// pill on Home and Knowledge - Home's banner and Knowledge's SYNCED column already state that fact.)
	const screens: { id: ScreenId; crumb: string }[] = [
		{ id: 'home', crumb: 'Home' },
		{ id: 'templates', crumb: 'Templates' },
		{ id: 'knowledge', crumb: 'Knowledge' },
		{ id: 'agents', crumb: 'Agents' },
	];

	// A project with a living surface (one living doc): even so, the screen body draws no top bar and no
	// in-body sync pill - the header owns both now.
	const livingState: IScreenState = { ...state, docs: [{ resource: URI.file('/ws/A.md'), title: 'A', isLiving: true, sourceKinds: ['file'], sources: ['a.csv'], lastSynced: '', pendingCount: 0, folder: '', unseenAgentEdits: 0, relinkCount: 0, stale: false, fanoutFailed: false, needsSourceBinding: false }] };

	for (const { id } of screens) {
		test(`${id} draws no per-webview top bar (the global Abstract header carries it - PH.4)`, () => {
			const html = renderScreenHtml(id, livingState);
			assert.deepStrictEqual({
				topBar: html.includes('class="topbar"'),
				inBodyPresent: /class="tb-present"/.test(html),
			}, { topBar: false, inBodyPresent: false });
		});
	}

	// --- D26 onboarding surface: the guided two-wow flow renders the current funnel step + its real action ---

	test('onboarding open step shows the intro, the consent status and the See it work action', () => {
		// Round 2 (doc 28, "Sentence case everywhere, including buttons"): the round-1 title-cased headline
		// "Two Wows, Ten Minutes, No Setup" is a defect now, so the intro is pinned in sentence case.
		const html = renderScreenHtml('onboarding', { ...state, onboarding: { step: 'open', consentEnabled: true, consentChosen: true, hasModel: true, demoGenerated: false } });
		assert.deepStrictEqual({
			headline: html.includes('Two wows, ten minutes, no setup'),
			seeItWork: /data-msg="onbSeeItWork"/.test(html),
			consentLine: html.includes('never your words'),
			progress: html.includes('Step 1 of 7'),
		}, { headline: true, seeItWork: true, consentLine: true, progress: true });
	});

	test('onboarding wow steps name each wow and drive the real engine (peek + prompt one edit)', () => {
		const peek = renderScreenHtml('onboarding', { ...state, onboarding: { step: 'provenance-peek', consentEnabled: true, consentChosen: true, hasModel: true, demoGenerated: true } });
		assert.ok(peek.includes('Wow moment 1'), 'wow-1 badge');
		assert.ok(peek.includes('$48.6k'), 'points at a bound figure to peek');
		assert.ok(/data-msg="onbAdvance"/.test(peek), 'advance is wired');

		const diff = renderScreenHtml('onboarding', { ...state, onboarding: { step: 'first-diff', consentEnabled: true, consentChosen: true, hasModel: true, demoGenerated: true } });
		assert.ok(diff.includes('Wow moment 2'), 'wow-2 badge');
		assert.ok(/data-msg="onbPromptEdit"/.test(diff), 'prompt one edit is wired');
	});

	test('onboarding warns honestly when no model is connected, without dead-ending', () => {
		const diff = renderScreenHtml('onboarding', { ...state, onboarding: { step: 'first-diff', consentEnabled: true, consentChosen: true, hasModel: false, demoGenerated: true } });
		assert.ok(diff.includes('No model is connected yet'), 'names the no-model state');
		assert.ok(/data-msg="onbModelAccess"/.test(diff), 'offers a route to Model Access');
	});

	test('onboarding hand-off offers bring-a-real-folder (the 1a own-file path)', () => {
		const html = renderScreenHtml('onboarding', { ...state, onboarding: { step: 'first-folder', consentEnabled: true, consentChosen: true, hasModel: true, demoGenerated: true } });
		assert.ok(/data-msg="onbOpenFolder"/.test(html), 'has the bring-a-folder hand-off');
		assert.ok(html.includes('your own file'), 'frames the own-file aha');
	});

	test('home offers a wired resume banner only for an in-progress walkthrough', () => {
		const resumed = renderScreenHtml('home', { ...state, hasFolder: true, onboardingResumeStep: 'provenance-peek' });
		assert.ok(resumed.includes('Your walkthrough is in progress'), 'shows the resume status');
		assert.ok(/data-msg="openOnboarding"/.test(resumed), 'resume action reopens onboarding');

		const fresh = renderScreenHtml('home', { ...state, hasFolder: true });
		assert.ok(!fresh.includes('Your walkthrough is in progress'), 'does not show a resume banner without a saved step');
	});

	test('home offers the dismissible "See a 90-second demo" entry point (plan 42 L1), never a gate', () => {
		// With no in-progress walkthrough, Home shows the demoted walkthrough entry point: a card that opens
		// onboarding AND a dismiss control, so the demo is reachable but never forced.
		const card = renderScreenHtml('home', { ...state, hasFolder: true });
		assert.ok(card.includes('See a 90-second demo'), 'shows the demo entry card');
		assert.ok(/data-msg="openOnboarding"/.test(card), 'the demo card opens the walkthrough');
		assert.ok(/data-msg="dismissDemoCard"/.test(card), 'the demo card is dismissible');

		// Once dismissed, the card is gone for good.
		const dismissed = renderScreenHtml('home', { ...state, hasFolder: true, demoCardDismissed: true });
		assert.ok(!dismissed.includes('See a 90-second demo'), 'a dismissed demo card stays hidden');

		// An in-progress walkthrough shows the resume banner INSTEAD of the demo card (mutually exclusive).
		const inProgress = renderScreenHtml('home', { ...state, hasFolder: true, onboardingResumeStep: 'provenance-peek' });
		assert.ok(!inProgress.includes('See a 90-second demo'), 'the resume banner replaces the demo card mid-walkthrough');
	});

	// --- Home reflects the real open folder (the folder IS the project; decision #39) ---

	function summary(path: string, title: string, isLiving: boolean, pendingCount = 0): ILivingDocSummary {
		return { resource: URI.file(path), title, isLiving, sourceKinds: isLiving ? ['file'] : [], sources: isLiving ? ['metrics.csv'] : [], lastSynced: '', pendingCount, folder: '', unseenAgentEdits: 0, relinkCount: 0, stale: false, fanoutFailed: false, needsSourceBinding: false };
	}

	test('home with no folder open shows one plain-words line + one button, zero product vocabulary (H1.5, #211 items 1-2)', () => {
		const html = renderScreenHtml('home', { ...state, hasFolder: false });
		assert.ok(html.includes('Open a folder to start working.'), 'shows the plain-words invitation line');
		assert.ok(/data-msg="openFolder"/.test(html), 'the empty state has an Open folder action');
		// H1.5 / #211 items 1-2: the no-folder state must carry NO product vocabulary in its user-visible copy -
		// a plain invitation to open a folder of files, not a pitch for "Living Documents", "sources" or "agents".
		// Assert against the visible body only (the shared <style>/<script> the shell appends to every screen
		// carry code comments naming those concepts, which the user never reads).
		const visible = html.replace(/<style[\s\S]*?<\/style>/g, '').replace(/<script[\s\S]*?<\/script>/g, '');
		assert.ok(!/Living Documents/i.test(visible) && !/\bsources\b/i.test(visible) && !/\bagents\b/i.test(visible), 'no product vocabulary in the visible no-folder copy');
		assert.ok(!html.includes('Acme Co') && !html.includes('Job Search 2026'), 'no hardcoded demo project cards');
	});

	test('home v2 dashboard: greeting + the ONE amber state banner that becomes the queue, over a DOCUMENTS grid (H1-H3, comp 1b)', () => {
		// Round 2 (comp 1b, doc 28 "there is no permanent status pill"): Home's state lives in exactly ONE place -
		// the banner. It names the real pending set in its headline and GROWS the review queue below its own head,
		// so the work and the summary of the work are never two surfaces to reconcile. The round-1 `summary` line
		// ("1 document needs you"), the per-card "N TO APPROVE" pill and the "ALL DOCUMENTS" label are all gone.
		const docs = [summary('/ws/Weekly Update.md', 'Weekly Update', true, 3), summary('/ws/Team Notes.md', 'Team Notes', false, 0)];
		const html = renderScreenHtml('home', {
			...state, hasFolder: true, folderName: 'realdocs-test', docs,
			userName: 'Tom',
			homeNeedsYou: [{ resource: URI.file('/ws/Weekly Update.md').toString(), title: 'Weekly Update', pendingCount: 3, reason: 'Revenue line changed - waiting on your call at line 6.', refreshedLabel: 'refreshed 2m ago' }],
			homeNeedsYouTotal: 1,
		});

		// H1: person-first greeting (real name); the folder name is not printed in the body (the plan-44 header
		// breadcrumb owns it) and the greeting is by person (decision 39 - the folder IS the project).
		assert.ok(/Good (morning|afternoon|evening), Tom\./.test(html), 'greets the person by name with a real time-of-day');
		assert.deepStrictEqual({
			// H1: the amber banner states the REAL pending set - 3 changes, all sitting in one document - over an
			// indigo primary that opens the review. Amber is the one hue that means "waiting on you".
			bannerHeadline: html.includes('3 changes in 1 document are waiting on you.'),
			bannerAmber: html.includes(`background:${AMBER.bg};border:1px solid ${AMBER.border}`),
			bannerDot: html.includes(`width:11px;height:11px;flex:none;border-radius:${RADIUS.pill};background:${AMBER.base}`),
			reviewAction: html.includes('Review 3 changes') && /data-msg="reviewProject"/.test(html),
			// H2: the banner's queue - a mono MEANING badge, the host's real reason, its real freshness fact, and a
			// review link that deep-links the exact block.
			queueBadge: html.includes('MEANING'),
			queueRow: html.includes('<strong>Weekly Update</strong>') && html.includes('waiting on your call at line 6'),
			queueFact: html.includes('refreshed 2m ago'),
			queueReview: /data-msg="reviewNeedsYou"/.test(html),
			// H3: the grid leads with what needs the reader and still lists every real document.
			gridLabel: html.includes('DOCUMENTS · NEEDS YOU FIRST'),
			quietDoc: html.includes('Team Notes'),
			// Retired in round 2: the summary line, the per-card status pill, the round-1 grid label.
			noSummaryLine: !html.includes('1 document needs you'),
			noApprovePill: !html.includes('3 TO APPROVE'),
			noOldGridLabel: !/ALL DOCUMENTS/.test(html),
			// Never: fixture cards, a multi-project dashboard, the no-op New project button (decision 39).
			noFixtures: !html.includes('Acme Co') && !html.includes('Fund III') && !/ALL PROJECTS/.test(html),
			noNewProject: !html.includes('data-msg="newProject"') && !/>New project</.test(html),
		}, {
			bannerHeadline: true, bannerAmber: true, bannerDot: true, reviewAction: true,
			queueBadge: true, queueRow: true, queueFact: true, queueReview: true,
			gridLabel: true, quietDoc: true,
			noSummaryLine: true, noApprovePill: true, noOldGridLabel: true, noFixtures: true, noNewProject: true,
		});
	});

	test('home v2: a document card is a title, an optional 7px state dot and ONE plain-words line (H3.4 - one truth, comp 1a/1b)', () => {
		// Round 2 (comp 1a/1b): the round-1 avatar and status chip are gone from a document card - identity is not
		// state, and a permanent chip is exactly the pill the banner replaced. A card is a title, an optional 7px
		// dot, and one plain-words line; that line is the SAME docRailDot tooltip the tree rail's dot carries, so a
		// card and its rail row can never disagree. A quiet document earns no dot at all - colour only where earned.
		const docs = [
			summary('/ws/Pending.md', 'Pending', true, 2),          // yellow rail band -> waiting: amber dot + the rail's sentence
			summary('/ws/Calm.md', 'Calm', true, 0),                // grey rail band -> quiet: bound and calm, no dot
			summary('/ws/Plain.md', 'Plain', false, 0),             // grey rail band -> quiet: nothing has happened, no dot
		];
		const html = renderScreenHtml('home', { ...state, hasFolder: true, folderName: 'ws', docs, userName: 'Tom' });
		const cardDot = `width:7px;height:7px;flex:none;border-radius:${RADIUS.pill}`;
		assert.deepStrictEqual({
			waitingLine: html.includes('2 changes waiting for approval'),
			waitingDot: html.includes(`${cardDot};background:${AMBER.base}`),
			calmLine: html.includes('In sync with metrics.csv'),
			plainLine: html.includes('Nothing has changed since you last looked.'),
			// Exactly one card dot renders: the two quiet documents state what they are in words, not in colour.
			dotCount: (html.match(new RegExp(cardDot.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) ?? []).length,
			// The round-1 chips are gone for good (doc 28: "There is no permanent status pill").
			noChips: !/>needs you</.test(html) && !/>in sync</.test(html) && !/>markdown</.test(html),
			newDocTile: /class="doc-newtile"/.test(html) && /data-msg="newDocument"/.test(html),
		}, { waitingLine: true, waitingDot: true, calmLine: true, plainLine: true, dotCount: 1, noChips: true, newDocTile: true });
	});

	test('CD-1: the populated dashboard carries the "Ask this project" composer so the fan-out is launchable (1j/1w)', () => {
		const html = renderScreenHtml('home', { ...state, hasFolder: true, folderName: 'ws', userName: 'Tom', docs: [summary('/ws/A.md', 'A', true, 0)] });
		assert.deepStrictEqual({
			composer: /data-ask-box/.test(html),
			sends: /data-ask-send/.test(html),
			label: html.includes('ASK THIS PROJECT'),
		}, { composer: true, sends: true, label: true });
	});

	test('home v2: the banner queue carries the host\'s two detail rows and hands the rest to Review in plain words (H2.1, comp 1b)', () => {
		// The host projects detail for at most two documents. Round 2 turns the round-1 "+N more" chip into a real
		// queue row in the banner's own voice ("1 more document is waiting on you."), so the overflow reads as work
		// rather than as a count, and hands the rest to the cross-document review surface instead of inventing rows.
		const html = renderScreenHtml('home', {
			...state, hasFolder: true, folderName: 'ws', userName: 'Tom',
			docs: [summary('/ws/A.md', 'A', true, 1), summary('/ws/B.md', 'B', true, 1), summary('/ws/C.md', 'C', true, 1)],
			homeNeedsYou: [
				{ resource: URI.file('/ws/A.md').toString(), title: 'A', pendingCount: 1, reason: '1 change is waiting for your review.' },
				{ resource: URI.file('/ws/B.md').toString(), title: 'B', pendingCount: 1, reason: '1 change is waiting for your review.' },
			],
			homeNeedsYouTotal: 3,
		});
		assert.deepStrictEqual({
			headline: html.includes('3 changes across 3 documents are waiting on you.'),
			rowA: html.includes('<strong>A</strong>'),
			rowB: html.includes('<strong>B</strong>'),
			overflowRow: html.includes('1 more document is waiting on you.'),
			reviewAll: html.includes('review all') && /data-msg="reviewProject"/.test(html),
			noCountChip: !html.includes('+1 more'),
		}, { headline: true, rowA: true, rowB: true, overflowRow: true, reviewAll: true, noCountChip: true });
	});

	// The name-or-template on-ramp (plan 28, iter 4): Home carries a New document primary that opens a sheet
	// with a name field, a Blank-document default (Enter), and each real template as a secondary row.
	test('home offers a New document on-ramp: a name-or-template sheet with blank + real template rows', () => {
		const templates = [template('Weekly report', 'A weekly summary.', ['metrics.csv'], '# {{slot:title}}\n\nMRR is [pending](bind:metrics.mrr).')];
		const html = renderScreenHtml('home', { ...state, hasFolder: true, folderName: 'realdocs-test', docs: [], templates });

		assert.ok(/data-msg="newDocument"[^>]*data-sheet-open="newdoc"|data-sheet-open="newdoc"[^>]*data-msg="newDocument"/.test(html), 'New document opens the on-ramp sheet');
		assert.ok(html.includes('id="sheet-newdoc"'), 'the name-or-template sheet is present');
		assert.ok(/data-sheet-default[^>]*data-msg="newDocument"|data-msg="newDocument"[^>]*data-sheet-default/.test(html), 'Blank document is the Enter default');
		// The real template shows as a secondary row routing to the iter-3 generate flow with the typed name.
		assert.ok(html.includes('OR START FROM A TEMPLATE') && html.includes('Weekly report'), 'the real template is a secondary row');
		assert.ok(html.includes('data-msg="generateFromTemplate"') && html.includes('data-arg="' + esc(templates[0].uri.toString()) + '"'), 'the template row carries its real uri and generates');
	});

	test('home with no templates shows only the blank option in the on-ramp (real data only)', () => {
		const html = renderScreenHtml('home', { ...state, hasFolder: true, folderName: 'empty', docs: [], templates: [] });
		assert.ok(html.includes('id="sheet-newdoc"'), 'the on-ramp sheet is still present');
		assert.ok(!html.includes('OR START FROM A TEMPLATE'), 'no template section when the folder ships no templates');
	});

	// --- F17 "From sources..." (journey 1b's third birth): the on-ramp gains a From-sources birth + picker ---
	test('home offers the "From your sources..." birth: a source picker sheet driven by the real folder sources', () => {
		// Round 2 (comp 4c): the birth row and its picker both say "your sources" - the possessive is what makes it
		// the reader's own data rather than a product noun.
		const html = renderScreenHtml('home', {
			...state, hasFolder: true, folderName: 'realdocs-test', docs: [], templates: [],
			dataFiles: ['metrics.csv'], docFiles: ['market-research.md', 'Team Notes.md'],
		});
		assert.deepStrictEqual({
			// The third birth is present in the New-document sheet and opens its own picker sheet.
			birthRow: /data-sheet-open="fromsources"/.test(html),
			pickerSheet: html.includes('id="sheet-fromsources"'),
			pickerTitle: html.includes('New document from your sources'),
			// Real data only: every folder source is a checkbox pick; the submit posts newFromSources.
			dataPick: html.includes('data-pick="metrics.csv"'),
			docPicks: html.includes('data-pick="market-research.md"') && html.includes('data-pick="Team Notes.md"'),
			submits: /data-msg="newFromSources"/.test(html),
			nameAndNote: /data-field="name"/.test(html) && /data-field="note"/.test(html),
		}, { birthRow: true, pickerSheet: true, pickerTitle: true, dataPick: true, docPicks: true, submits: true, nameAndNote: true });
	});

	test('home omits the From-sources birth when the project has no sources (real data only)', () => {
		const html = renderScreenHtml('home', { ...state, hasFolder: true, folderName: 'empty', docs: [], templates: [], dataFiles: [], docFiles: [] });
		assert.ok(!/data-sheet-open="fromsources"/.test(html), 'no From sources row when there is nothing to draft from');
	});

	// --- Empty-project front door (F15 / journey 1w frame 4): a folder is open with no documents ---

	test('home with a folder open but no documents lands on the empty-project front door (cures the 1a dead-end)', () => {
		const html = renderScreenHtml('home', { ...state, hasFolder: true, folderName: 'empty-folder', docs: [] });
		assert.ok(html.includes('empty-folder'), 'still shows the open folder name');
		// The front door, not the dashboard: New document + Browse templates + the whole-project composer.
		assert.ok(/is empty/.test(html), 'names the empty project so the on-ramp is calm');
		assert.ok(/data-sheet-open="newdoc"/.test(html), 'offers New document (Blank / templates)');
		assert.ok(/data-ask-box/.test(html) && /data-msg="askProject"|data-ask-send/.test(html), 'carries the "...or ask me" composer');
		assert.ok(!/NEEDS YOU/.test(html), 'no NEEDS-YOU section when there is no pending work');
		assert.ok(!html.includes('Acme Co') && !html.includes('Fund III'), 'no hardcoded demo project cards');
	});

	// --- Home v2: zero-pending calm state (H1.3 / H2.5, comp 1a) ---
	// Round 2 gives Home ONE state banner in two states. Calm is the GREEN state of that same banner - the
	// round-1 "Everything is in sync." summary line is gone, because a second sentence saying the same thing is
	// exactly the duplication the one-banner rule removes. With nothing pending the banner grows no queue, and
	// the grid label drops its needs-you half. The "Ask this project" composer leads both Home paths (CD-1 fix).

	test('home v2 all-clear: ONE green banner reads "All clear - nothing needs you." and grows no queue (H1.3 / H2.5, comp 1a)', () => {
		const html = renderScreenHtml('home', { ...state, hasFolder: true, folderName: 'ws', userName: 'Tom', docs: [summary('/ws/A.md', 'A', true, 0)] });
		assert.deepStrictEqual({
			headline: html.includes('All clear - nothing needs you.'),
			greenBanner: html.includes(`background:${GREEN.bg};border:1px solid ${GREEN.border}`),
			bannerDot: html.includes(`width:11px;height:11px;flex:none;border-radius:${RADIUS.pill};background:${GREEN.base}`),
			// With no run log to report, the body says so honestly rather than rendering an empty sentence.
			quietBody: html.includes('Nothing has changed since you were last here.'),
			historyPill: html.includes('History'),
			// No queue and no needs-you framing when nothing pends (no empty shell), and the round-1 summary is gone.
			noQueue: !html.includes('MEANING'),
			noOldSummary: !html.includes('Everything is in sync.'),
			calmGridLabel: !/NEEDS YOU/.test(html),
			// The pre-v2 dashboard surfaces stay gone from the v2 Home body (they were never a v2 criterion).
			noPreV2: !/WHILE YOU WERE AWAY/.test(html) && !/failed on/.test(html),
		}, {
			headline: true, greenBanner: true, bannerDot: true, quietBody: true, historyPill: true,
			noQueue: true, noOldSummary: true, calmGridLabel: true, noPreV2: true,
		});
	});

	// --- Templates v2 (plan 48 T1-T3): the pattern gallery, driven by listTemplateGallery() ---

	function template(name: string, description: string, sources: readonly string[], body: string): ITemplateInfo {
		return { uri: URI.file(`/ws/templates/${name}.template.md`), name, description, sources, body };
	}

	// An ITemplateCard for the v2 gallery: the ITemplateInfo plus the real bind-slot count, usage lineage and
	// the parsed skeleton rows (derived here from the body so the fixture matches the real service projection).
	function templateCard(name: string, description: string, sources: readonly string[], body: string, usageCount: number): ITemplateCard {
		const info = template(name, description, sources, body);
		return { ...info, bindSlots: countBindSlots(body), usageCount, skeleton: templateSkeletonRows(parseLivingDoc('---\ntemplate: true\n---\n\n' + body)) };
	}

	test('templates v2: the title row carries a live filter field and the comp\'s sub-line (T1.1 / T1.2, comp 4b)', () => {
		// Round 2 (comp 4b): the sub-line says what a template IS, in the comp's own words. The round-1 section
		// labels are gone with the row they labelled - the gallery is the only grid on the screen, so "YOUR
		// TEMPLATES" labels nothing, and the STARTERS row is retired (see the retirement test below).
		const html = renderScreenHtml('templates', { ...state, templateCards: [templateCard('Weekly Summary', 'Operating recap · expects a metrics CSV', ['metrics.csv'], '# {{slot:title}}\n\nMRR is [pending](bind:metrics.mrr).', 3)] });
		// The retired section labels are asserted against the VISIBLE body only: the shared <style>/<script> the
		// shell appends to every screen carry code comments that still name them, which the user never reads.
		const visible = html.replace(/<style[\s\S]*?<\/style>/g, '').replace(/<script[\s\S]*?<\/script>/g, '');
		assert.deepStrictEqual({
			filterField: /data-tpl-filter/.test(html),
			filterLabelled: html.includes('Filter templates'),
			subLine: html.includes(`A template is how a recurring report is born - structure, bound figures, and the agent's instructions, reused every cycle.`),
			noOldSubLine: !html.includes('Start a living document from a pattern. Sources bind after creation.'),
			noSectionLabels: !/YOUR TEMPLATES/.test(visible) && !/STARTERS/.test(visible),
		}, { filterField: true, filterLabelled: true, subLine: true, noOldSubLine: true, noSectionLabels: true });
	});

	test('templates v2: a card reads outcome copy over a skeleton drawn from the parsed doc, and offers Use + Edit (T2.2 / T2.3, comp 4b)', () => {
		// The correction this screen is judged on (comp caption 4b): "outcome copy instead of '1 slot · 0 sources'".
		// A card's meta says what the template does FOR the reader - what it draws on and whether it has earned its
		// keep - never how it is built inside. The comp's own two meta lines are the pins: "draws on metrics.csv ·
		// used N times" and "binds after creation · not used yet". Colours come from the tokens, not from literals.
		const cards = [
			templateCard('Weekly Summary', 'Operating recap · expects a metrics CSV', ['metrics.csv'], '# {{slot:title}}\n\nMRR is [pending](bind:metrics.mrr), up [pending](bind:metrics.mrr.delta).', 12),
			templateCard('Board Note', 'Monthly narrative for the board', [], '# {{slot:client}}\n\nProgress.', 0),
		];
		const html = renderScreenHtml('templates', { ...state, templateCards: cards });
		const bar = (colour: string) => `height:8px;border-radius:4px;background:${colour}`;
		assert.deepStrictEqual({
			names: html.includes('Weekly Summary') && html.includes('Board Note'),
			description: html.includes('Operating recap'),
			// Weekly Summary declares a source and has been used 12 times; the source name is the one mono run.
			drawsOn: html.includes(`draws on <span style="font:400 11.5px/1.4 ${FONT.mono}">metrics.csv</span>`),
			usedTimes: html.includes(' · used 12 times'),
			// Board Note binds nothing yet and honestly reports it has never been used.
			bindsLater: html.includes('binds after creation · not used yet'),
			// The round-1 internals copy and the LWD chip are gone.
			noSlotCount: !/bind slot/.test(html) && !/used \d+&times;/.test(html),
			noLwdChip: !/\bLWD\b/.test(html),
			// The skeleton thumbnail is drawn from the PARSED doc: a strong-hairline title bar, medium-hairline
			// prose bars, and ONE indigo tint-border bar marking where live data lands, on the rail-paper canvas.
			skeletonTitle: html.includes(bar(HAIRLINE.strong)),
			skeletonProse: html.includes(bar(HAIRLINE.medium)),
			skeletonAccent: html.includes(bar(INDIGO.tintBorder)),
			skeletonCanvas: html.includes(`background:${PAPER.rail};border-bottom:1px solid ${HAIRLINE.medium}`),
			// Use duplicates the template into the folder with its binds emptied to slots (no generate sheet);
			// round 2 restores Edit beside it (comp 4b draws both verbs on every card).
			useCount: html.split('data-msg="useTemplate"').length - 1,
			editCount: html.split('data-msg="editTemplate"').length - 1,
			noGenerateSheet: !/data-msg="generateFromTemplate"/.test(html),
		}, {
			names: true, description: true, drawsOn: true, usedTimes: true, bindsLater: true,
			noSlotCount: true, noLwdChip: true,
			skeletonTitle: true, skeletonProse: true, skeletonAccent: true, skeletonCanvas: true,
			useCount: 2, editCount: 2, noGenerateSheet: true,
		});
	});

	test('templates v2: the STARTERS row is retired - a starter only ever preset a filename (comp 4b)', () => {
		// Round 2 removes the hollow affordance outright: `newStarter` exists nowhere in the product any more, and
		// neither do the four built-in names. A template is grown from real documents or saved from a real one -
		// both of which are the dashed on-ramps below the gallery - so a fake "Blank living doc" starter is a
		// door onto nothing. Guarded on BOTH states, because the round-1 empty state carried the row too.
		const populated = renderScreenHtml('templates', { ...state, templateCards: [templateCard('T', 'd', [], 'body {{slot:x}}', 0)] });
		const empty = renderScreenHtml('templates', { ...state, templateCards: [] });
		const retired = (html: string) => ({
			noLabel: !/STARTERS/.test(html),
			noStarterPath: !/newStarter/.test(html),
			noBuiltIns: !html.includes('Blank living doc') && !html.includes('Project brief') && !html.includes('Meeting notes') && !html.includes('Metrics digest'),
		});
		const gone = { noLabel: true, noStarterPath: true, noBuiltIns: true };
		assert.deepStrictEqual({ populated: retired(populated), empty: retired(empty) }, { populated: gone, empty: gone });
	});

	test('templates v2: the empty state is calm, keeps both on-ramps, and has no fake preview', () => {
		const html = renderScreenHtml('templates', { ...state, templateCards: [], docFiles: ['a.md'] });
		assert.deepStrictEqual({
			emptyLine: /No templates yet/i.test(html),
			byHandDoor: /data-msg="newTemplate"/.test(html) && html.includes('Create your first template'),
			// The two ways the NEXT template is born stay offered even with nothing on disk (comp 4b).
			growRamp: html.includes('Grow one from past documents') && /data-sheet-open="fromexamples"/.test(html),
			saveRamp: html.includes('Save the current document as a template') && /data-msg="saveAsTemplate"/.test(html),
			// No fabricated draft / resolved-slots preview.
			noFakePreview: !html.includes('Weekly Operating Summary') && !html.includes('ALL SLOTS RESOLVED'),
		}, { emptyLine: true, byHandDoor: true, growRamp: true, saveRamp: true, noFakePreview: true });
	});

	// --- comp 4b: the two dashed on-ramps sit below the gallery, in BOTH states ---
	// Round 1 hid the from-examples wizard on the empty state only, so a project that already had one template
	// lost the door that grows the next one from real work. The comp draws both on-ramps under the grid: grow
	// one from past documents, and save the current document as one.
	test('templates populated grid: both dashed on-ramps sit below the gallery (comp 4b)', () => {
		const cards = [templateCard('Weekly report', 'A weekly operating summary.', ['metrics.csv'], '# {{slot:title}}\n\nMRR.', 0)];
		const html = renderScreenHtml('templates', { ...state, templateCards: cards, docFiles: ['Board Note.md', 'Team Notes.md', 'Weekly Summary.md', 'market-research.md'] });
		assert.deepStrictEqual({
			growRamp: html.includes('Grow one from past documents') && /data-sheet-open="fromexamples"/.test(html),
			growSheet: html.includes('id="sheet-fromexamples"'),
			saveRamp: html.includes('Save the current document as a template') && /data-msg="saveAsTemplate"/.test(html),
			// The dashed edge is the paper's own frame border - an on-ramp is not a state, so it borrows no hue.
			dashedEdge: html.includes(`border:1px dashed ${PAPER.frameBorder}`),
		}, { growRamp: true, growSheet: true, saveRamp: true, dashedEdge: true });
	});

	test('templates from-examples wizard lists the real project documents as examples', () => {
		const html = renderScreenHtml('templates', { ...state, templateCards: [], docFiles: ['a.md', 'b.md', 'c.md'] });
		assert.deepStrictEqual({
			entry: /data-sheet-open="fromexamples"/.test(html),
			sheet: html.includes('id="sheet-fromexamples"'),
			picks: html.includes('data-pick="a.md"') && html.includes('data-pick="c.md"'),
			submits: /data-msg="newTemplateFromExamples"/.test(html),
			byHandDoor: /data-msg="newTemplate"/.test(html) && html.includes('Create your first template'),
		}, { entry: true, sheet: true, picks: true, submits: true, byHandDoor: true });
	});

	test('templates from-examples wizard explains itself rather than dead-ending when there is nothing to learn from', () => {
		// Real-data guardrail: the on-ramp is always offered (it is one of the two ways a template is born), but
		// with no documents to learn from the sheet states that honestly and withholds its submit, so the door
		// explains itself instead of promising an analysis it cannot run.
		const html = renderScreenHtml('templates', { ...state, templateCards: [], docFiles: [] });
		assert.deepStrictEqual({
			entry: /data-sheet-open="fromexamples"/.test(html),
			honestEmpty: html.includes('This project has no documents to learn from yet.'),
			noSubmit: !/data-msg="newTemplateFromExamples"/.test(html),
			byHandDoor: html.includes('Create your first template'),
		}, { entry: true, honestEmpty: true, noSubmit: true, byHandDoor: true });
	});

	test('templates screen carries no "Soon" labels', () => {
		const withTemplates = renderScreenHtml('templates', { ...state, templateCards: [templateCard('T', 'd', [], 'body {{slot:x}}', 0)] });
		const empty = renderScreenHtml('templates', { ...state, templateCards: [] });
		assert.ok(!/\bSoon\b/i.test(withTemplates) && !/\bSoon\b/i.test(empty), 'zero "Soon" labels on the Templates screen');
	});

	// --- Knowledge: the project's real source registry (plan 29, D29-A) ---

	function source(id: string, kind: 'file' | 'api', fresh: boolean, usedBy: { path: string; title: string; keys: string[]; context?: boolean }[], extra?: Partial<ISourceInfo>): ISourceInfo {
		return {
			id, kind,
			label: kind === 'api' ? new URL(id).host : id,
			syncedAt: new Date().toISOString(),
			fresh,
			resource: kind === 'file' ? URI.file('/ws/' + id) : undefined,
			usedBy: usedBy.map(u => ({ doc: URI.file(u.path), title: u.title, keys: u.keys, context: !!u.context })),
			...extra,
		};
	}

	test('Knowledge Project tab renders the SOURCE · KIND · SYNCED · FEEDS · FIGURES table in user units (comp 4a)', () => {
		// The correction this screen is judged on (comp caption 4a): "user units, consistent freshness words".
		// Round 2 renames the last two columns: SYNC becomes SYNCED, and BINDS becomes FIGURES - because a figure
		// is what the reader sees in their document, and "N binds" is the engine's word, not theirs. The cell
		// therefore reads "feeds 3", never "3 binds". Freshness words come from the ONE F12 vocabulary.
		const sources = [
			source('metrics.csv', 'file', true, [
				{ path: '/ws/Weekly.md', title: 'Weekly Summary', keys: ['metrics.mrr', 'metrics.signups'] },
				{ path: '/ws/Board.md', title: 'Board Note', keys: ['metrics.mrr'] },
			]),
			source('https://api.example.com/repo', 'api', false, [{ path: '/ws/Eco.md', title: 'Ecosystem', keys: ['repo.stars'] }]),
		];
		const html = renderScreenHtml('knowledge', { ...state, knScope: 'project', sources, knNow: Date.parse('2026-01-01T00:00:00Z') });
		assert.deepStrictEqual({
			fileLabel: html.includes('metrics.csv'),
			apiLabel: html.includes('api.example.com'),
			columns: />SOURCE<[\s\S]*>KIND<[\s\S]*>SYNCED<[\s\S]*>FEEDS<[\s\S]*>FIGURES</.test(html),
			noOldColumns: !/>SYNC</.test(html) && !/>BINDS</.test(html),
			// User units: metrics.csv resolves 3 distinct keys across its two dependents.
			figuresCell: html.includes('feeds 3'),
			noEngineUnits: !/\d+ binds/.test(html),
			feedsChips: html.includes('Weekly Summary') && html.includes('Board Note'),
			// The F12 stale vocabulary, and the amber cream a stale row is painted (amber = waiting on you).
			staleLabel: /stale · /.test(html),
			staleRow: html.includes(`background:${AMBER.subtleBg}`),
			noAdHocWords: !html.includes('Source changed') && !html.includes('>Fresh<'),
			noSoon: !/\bSoon\b/i.test(html),
			// K2.6: the row press SELECTS the source (filling the detail card below); the detail card carries the
			// one "open source" door, so a row press has exactly one meaning.
			rowSelects: /data-msg="selectSource"[^>]*data-arg="metrics\.csv"/.test(html),
			detailOpensSource: /data-msg="openSource"[^>]*data-arg="[^"]*metrics\.csv"/.test(html),
			addSource: /data-sheet-open="addsource"/.test(html),
		}, {
			fileLabel: true, apiLabel: true, columns: true, noOldColumns: true, figuresCell: true, noEngineUnits: true,
			feedsChips: true, staleLabel: true, staleRow: true, noAdHocWords: true, noSoon: true,
			rowSelects: true, detailOpensSource: true, addSource: true,
		});
	});

	test('Knowledge KIND glyph and KIND word derive from ONE semantic classification, so they never diverge (D1)', () => {
		// One source of every semantic kind: a data table, a text transcript, a context-only reference, a live
		// feed. The glyph and the word live in the same row, so pairing each row's glyph to its word proves the
		// two are keyed off the same axis (the old bug: a "Reference" .md rendered with the table glyph).
		const sources = [
			source('metrics.csv', 'file', true, [{ path: '/ws/W.md', title: 'W', keys: ['metrics.mrr'] }]),
			source('market-research.md', 'file', true, [{ path: '/ws/W.md', title: 'W', keys: ['research.tam'] }]),
			source('brand.md', 'file', true, [{ path: '/ws/W.md', title: 'W', keys: [], context: true }]),
			source('https://api.example.com/repo', 'api', true, [{ path: '/ws/W.md', title: 'W', keys: ['repo.stars'] }]),
		];
		const html = renderScreenHtml('knowledge', { ...state, knScope: 'project', sources, knNow: Date.now() });
		// For each semantic kind, the row's glyph and word must both appear paired within the same KIND cell.
		// &#8862; ⊞ table · &#9677; ◍ transcript · &#9671; ◇ reference/feed.
		const pairs: { glyph: string; word: string }[] = [
			{ glyph: '&#8862;', word: 'Table' },       // metrics.csv
			{ glyph: '&#9677;', word: 'Transcript' },  // market-research.md (bound, not context)
			{ glyph: '&#9671;', word: 'Reference' },   // brand.md (context-only)
			{ glyph: '&#9671;', word: 'Live feed' },   // api endpoint
		];
		for (const { glyph, word } of pairs) {
			// The glyph opens the row, the word follows in the next cell: assert the glyph precedes its word with
			// no intervening KIND word (so a Table glyph can never sit above a "Reference" word).
			const re = new RegExp(glyph + '[\\s\\S]*?>' + word + '<');
			assert.ok(re.test(html), `the ${word} row carries the ${glyph} glyph`);
		}
		// Guard the exact D1 symptom: the ⊞ table glyph must NEVER precede the "Reference" word.
		assert.ok(!/&#8862;(?:(?!&#\d)[\s\S])*?>Reference</.test(html), 'a Reference source never renders the table glyph (D1)');
	});

	test('Knowledge summary line counts sources, figures and documents in user units (K1.2, comp 4a)', () => {
		// Round 2 (comp 4a) states the library in the reader's three nouns, in the comp's own sentence shape:
		// "Everything your documents draw on. N sources feed N figures across N documents." The round-1 line
		// counted "bound figures" as an engine fact and never named the documents that actually read them.
		const sources = [
			source('metrics.csv', 'file', true, [{ path: '/ws/Weekly.md', title: 'Weekly Summary', keys: ['metrics.mrr', 'metrics.churn'] }]),
			source('brand.md', 'file', true, [{ path: '/ws/Weekly.md', title: 'Weekly Summary', keys: [], context: true }]),
		];
		const html = renderScreenHtml('knowledge', { ...state, knScope: 'project', sources, knNow: Date.now() });
		assert.deepStrictEqual({
			summary: html.includes('Everything your documents draw on. 2 sources feed 2 figures across 1 document.'),
			noOldSummary: !html.includes('2 sources in this folder · 2 bound figures depend on them.'),
			contextOnly: html.includes('context only'),
		}, { summary: true, noOldSummary: true, contextOnly: true });
	});

	test('Knowledge health strip: one attention card for the stalest source, with Re-sync + mark-as-expected', () => {
		const sources = [
			source('metrics.csv', 'file', true, [{ path: '/ws/Weekly.md', title: 'Weekly Summary', keys: ['metrics.mrr'] }]),
			source('pipeline.csv', 'file', false, [{ path: '/ws/Exec.md', title: 'Executive Summary', keys: ['pipeline.count'] }], { syncedAt: '2026-01-01T00:00:00Z' }),
		];
		const html = renderScreenHtml('knowledge', { ...state, knScope: 'project', sources, knNow: Date.parse('2026-01-10T00:00:00Z') });
		assert.ok(html.includes('STALE SOURCE') && html.includes('HOW BINDING WORKS'), 'one attention card beside the static explainer');
		assert.ok(/data-msg="resyncSource"[^>]*data-arg="pipeline.csv"/.test(html), 'Re-sync routes to the existing sync machinery');
		assert.ok(/data-msg="markSourceExpected"[^>]*data-arg="pipeline.csv"/.test(html), 'mark-as-expected is wired');
		assert.ok((html.match(/STALE SOURCE/g) || []).length === 1, 'at most ONE attention card renders (the stalest)');
	});

	test('Knowledge health strip: all-fresh shows no attention card, and a marked-expected source is calmed', () => {
		const allFresh = renderScreenHtml('knowledge', { ...state, knScope: 'project', sources: [source('metrics.csv', 'file', true, [{ path: '/ws/W.md', title: 'W', keys: ['metrics.mrr'] }])], knNow: Date.now() });
		assert.ok(!allFresh.includes('STALE SOURCE') && allFresh.includes('HOW BINDING WORKS'), 'all-fresh renders the explainer alone');
		const expected = renderScreenHtml('knowledge', { ...state, knScope: 'project', sources: [source('pipeline.csv', 'file', false, [{ path: '/ws/E.md', title: 'E', keys: ['pipeline.count'] }], { markedExpected: true })], knNow: Date.now() });
		assert.ok(!expected.includes('STALE SOURCE') && expected.includes('context only'), 'a marked-expected stale source is calmed to context-grey, no attention card');
	});

	test('Knowledge Project tab shows the honest empty state when no source is referenced', () => {
		const html = renderScreenHtml('knowledge', { ...state, knScope: 'project', sources: [] });
		assert.ok(html.includes('No sources yet'), 'the honest empty registry state');
		assert.ok(!/\bSoon\b/i.test(html), 'the empty Project tab fabricates nothing (no "Soon")');
	});

	test('Knowledge Organization tab is an honest "Soon", never fabricated org content', () => {
		const html = renderScreenHtml('knowledge', { ...state, knScope: 'org', sources: [] });
		assert.ok(/\bSOON\b/i.test(html), 'the Org tab is labelled Soon');
		assert.ok(!html.includes('Mission') && !html.includes('OKRs'), 'no fabricated mission/OKR decision stack');
	});

	test('Knowledge Add-source sheet offers the real folder data files and the project documents', () => {
		const docs = [summary('/ws/Weekly.md', 'Weekly Summary', true)];
		const html = renderScreenHtml('knowledge', { ...state, knScope: 'project', sources: [], docs, dataFiles: ['metrics.csv', 'pipeline.json'] });
		assert.ok(/id="sheet-addsource"/.test(html), 'the Add-source sheet is present');
		assert.ok(html.includes('pipeline.json') && html.includes('metrics.csv'), 'the folder data files are offered as picker rows');
		assert.ok(/data-field="target"[\s\S]*Weekly Summary/.test(html), 'the target-document picker lists the project documents');
		assert.ok(/data-msg="addSourceApi"/.test(html), 'an API endpoint can be added as a source');
	});

	// --- project-run: Stop the fan-out with truthful per-doc states (plan 27 iter 4) ---

	const runDocs = [{ docId: 'a', docTitle: 'Access Control' }, { docId: 'b', docTitle: 'Acceptable Use' }];

	test('an in-flight project-run shows a Stop run control and the Live pill (plan 27 iter 4)', () => {
		const html = renderScreenHtml('project-run', {
			...state, projectRun: {
				instruction: 'Apply the review across every policy', inFlight: true,
				summary: summariseProjectRun(runDocs, []), working: runDocs.map(d => d.docId), decisions: [],
			},
		});
		assert.ok(/data-msg="stopProjectRun"/.test(html), 'a Stop run control is wired while in flight');
		assert.ok(html.includes('Stop run'), 'the control reads Stop run');
		assert.ok(html.includes('Live'), 'the topbar shows the Live pill while running');
	});

	test('a stopped project-run renders skipped tiles, a Stopped state and no Stop control (plan 27 iter 4)', () => {
		// A stopped whole-project run: nothing settled, so both documents are honestly skipped (never ran),
		// the topbar reads Stopped, and the Stop control is gone (there is nothing left to stop).
		const html = renderScreenHtml('project-run', {
			...state, projectRun: {
				instruction: 'Apply the review across every policy', inFlight: false, stopped: true,
				summary: summariseProjectRun(runDocs, [], true), working: [], decisions: [],
			},
		});
		assert.ok(html.includes('skipped'), 'not-yet-run documents render as skipped, not "no change"');
		assert.ok(!/data-msg="stopProjectRun"/.test(html), 'no Stop control once the run has stopped');
		assert.ok(html.includes('Stopped'), 'the topbar shows the Stopped state');
		assert.ok(html.includes('Run stopped'), 'the swarm heading reflects the stop honestly');
	});

	test('#265 CR-1: the idle project-run surface offers an EXPLICIT launch action, never auto-running a default prompt', () => {
		// The bare Agents-header entry opens this surface with no run in flight. It must NOT read as a run already
		// under way (no default-prompt fan-out), and it must carry ONE explicit launch affordance so the 1j walk is
		// still launchable with a single deliberate action - alongside the calmer "Go to Agents" door.
		const html = renderScreenHtml('project-run', { ...state });
		assert.deepStrictEqual({
			explicitLaunch: /data-msg="launchProjectRun"/.test(html),
			// Round 2 (doc 28): sentence case everywhere, including buttons - "Run Across the Project" is a defect.
			launchLabel: html.includes('Run across the project'),
			goAgents: /data-msg="goAgents"/.test(html),
			noLivePill: !html.includes('>Live<'),
			noStopControl: !/data-msg="stopProjectRun"/.test(html),
		}, { explicitLaunch: true, launchLabel: true, goAgents: true, noLivePill: true, noStopControl: true });
	});

	// --- project-run: fan-out context budgeting UI (plan 30, track 3, D30-B) ---

	test('a multi-batch project-run shows the Batch K of M chip in the command strip (plan 30 track 3)', () => {
		const html = renderScreenHtml('project-run', {
			...state, projectRun: {
				instruction: 'Apply the review across every policy', inFlight: true,
				summary: summariseProjectRun(runDocs, []), working: runDocs.map(d => d.docId), decisions: [],
				batch: { index: 2, count: 3 },
			},
		});
		assert.ok(html.includes('Batch 2 of 3'), 'the command strip reports which batch of how many is running');
	});

	test('a single-batch run and a not-yet-started batch show NO batch chip (the common small-scale case)', () => {
		const single = renderScreenHtml('project-run', {
			...state, projectRun: {
				instruction: 'Apply the review', inFlight: true,
				summary: summariseProjectRun(runDocs, []), working: [], decisions: [],
				batch: { index: 1, count: 1 },
			},
		});
		assert.ok(!/Batch \d+ of \d+/.test(single), 'a one-batch run shows nothing extra');
		const notStarted = renderScreenHtml('project-run', {
			...state, projectRun: {
				instruction: 'Apply the review', inFlight: true,
				summary: summariseProjectRun(runDocs, []), working: [], decisions: [],
				batch: { index: 0, count: 3 },
			},
		});
		assert.ok(!/Batch \d+ of \d+/.test(notStarted), 'no live batch (index 0) shows no chip');
	});

	test('an oversize document renders the amber "too large for this run" tile and the "N too large" bucket (plan 30 track 3)', () => {
		// Document `b` was too large for the fan-out budget: its tile must say so (never a silent drop or a
		// false "no change"), and the bottom bar reports the oversize bucket with the real count.
		const html = renderScreenHtml('project-run', {
			...state, projectRun: {
				instruction: 'Apply the review across every policy', inFlight: false,
				summary: summariseProjectRun(runDocs, [], false, ['b']), working: [], decisions: [],
			},
		});
		assert.ok(html.includes('too large for this run'), 'the oversize tile reads "too large for this run"');
		// Asserted against the token, not a literal: the point is that "too large" borrows the ONE hue that means
		// "waiting on you", so pinning a hex here would let the tile and the rest of the product drift apart.
		assert.ok(html.includes(`color:${AMBER.label}">too large for this run`), 'the oversize tile uses the amber that means waiting on you');
		assert.ok(html.includes('1 too large'), 'the bottom bar reports the oversize bucket with the real count');
		assert.ok(!html.includes('reviewing&hellip;'), 'an oversize tile never renders as a spinning sub-agent');
	});

	// --- project-run: a model outage must never render as "no changes proposed" (F14, issue #123) ---

	test('a failed document renders the "model unreachable" tile, never "no change" (F14 issue #123)', () => {
		// The model was unreachable for document `b`: its tile must name the outage (never the silent
		// "no change" all-clear), and the bottom bar reports the failed bucket with the real count.
		const html = renderScreenHtml('project-run', {
			...state, projectRun: {
				instruction: 'Apply the review across every policy', inFlight: false,
				summary: summariseProjectRun(runDocs, [], false, [], ['b']), working: [], decisions: [],
			},
		});
		assert.ok(html.includes('model unreachable'), 'the failed tile reads "model unreachable"');
		assert.ok(html.includes('1 failed'), 'the bottom bar reports the failed bucket with the real count');
		assert.ok(!html.includes('reviewing&hellip;'), 'a failed tile never renders as a spinning sub-agent');
	});

	test('a run where EVERY document failed leads with the named outage, never "0 changes proposed" (F14 issue #123)', () => {
		const html = renderScreenHtml('project-run', {
			...state, projectRun: {
				instruction: 'Apply the review across every policy', inFlight: false,
				summary: summariseProjectRun(runDocs, [], false, [], ['a', 'b']), working: [], decisions: [],
			},
		});
		assert.ok(html.includes('The agent model is not reachable'), 'the bottom bar names the outage in plain words');
		assert.ok(!html.includes('0</strong> changes proposed'), 'the false "0 changes proposed" all-clear is gone');
		assert.ok(html.includes('Model unreachable for 2 of 2 documents'), 'the swarm heading names the outage');
		assert.ok(!html.includes('every document read across the project'), 'no false "every document read" all-clear');
	});

	test('a budget-paused run reads the calm plain-words pause - not an error, not an all-clear (map-D15 / F14 item 3)', () => {
		// The run paused before the documents ran: the heading reads the calm pause, the not-yet-run documents
		// are skipped (never "no change"), the topbar shows a Paused pill, and nothing reads as failed.
		const html = renderScreenHtml('project-run', {
			...state, projectRun: {
				instruction: 'Apply the review across every policy', inFlight: false, paused: true,
				summary: summariseProjectRun(runDocs, [], true), working: [], decisions: [],
			},
		});
		assert.ok(html.includes('Run paused'), 'the swarm heading reads the calm pause');
		assert.ok(html.includes('Paused'), 'the topbar shows the Paused pill');
		assert.ok(html.includes('skipped'), 'the not-yet-run document is honestly skipped, never "no change"');
		assert.ok(!html.includes('model unreachable'), 'a pause is not rendered as a model failure');
		assert.ok(!html.includes('every document read across the project'), 'a pause is not rendered as an all-clear');
	});

	// --- Agents screen: the list + the detail drawer (plan 32 iter 3) ---

	function agent(over: Partial<IAgentDef> = {}): IAgentDef {
		return { id: 'weekly-refresh', name: 'Weekly refresh', trigger: { kind: 'cron', cron: 'Mon 09:00' }, flow: { sources: [], docs: [] }, policy: 'auto-figures', status: 'idle', ...over };
	}
	function run(over: Partial<IAgentRun> = {}): IAgentRun {
		return { agentId: 'weekly-refresh', startedAt: new Date().toISOString(), finishedAt: new Date().toISOString(), applied: 0, queued: 0, via: 'cron', ...over };
	}

	test('the Agents card grid states the trust contract and wires the New-agent tile to create (A1.2, A2.4)', () => {
		const agents = [agent(), agent({ id: 'sweep', name: 'Freshness sweep', trigger: { kind: 'heartbeat', everyHours: 6 }, policy: 'draft-only', disabled: true })];
		const html = renderScreenHtml('agents', { ...state, agents });
		assert.ok(html.includes('Agents only act on documents that opted in. Every action lands in the ledger below.'), 'the framing line states the trust contract verbatim (A1.2)');
		assert.ok(/data-msg="createAgent"/.test(html) && html.includes('from a skill or from scratch'), 'the dashed New-agent tile opens the create flow (A2.4)');
	});

	test('CD-1: the roster card opens a pre-existing agent by mouse + keyboard and offers a one-click Run now (A2.5)', () => {
		const html = renderScreenHtml('agents', { ...state, agents: [agent()] });
		assert.deepStrictEqual({
			// The whole card is a keyboard-focusable open door pointing at the real agent id (mouse + keyboard).
			cardOpensAgent: /data-agent-card[^>]*data-msg="openAgent"[^>]*data-arg="weekly-refresh"/.test(html),
			cardFocusable: /data-agent-card[^>]*role="button"[^>]*tabindex="0"/.test(html) && /data-agent-card[^>]*data-keyactivate/.test(html),
			// An explicit Open button (also emits openAgent) keeps the door discoverable, not just a bare card click.
			openButton: /data-msg="openAgent"[^>]*data-arg="weekly-refresh"[^>]*data-stop/.test(html),
			// A one-click Run now on the card fires the existing runWf machinery for that same pre-existing agent.
			runNow: /data-msg="runWf"[^>]*data-arg="weekly-refresh"[^>]*data-stop/.test(html),
			// The project-wide fan-out has a real emitter on the Agents screen (runProject had none before CD-1).
			runProject: /data-msg="runProject"/.test(html),
			// #265 CR-2: the injected keyboard-activation handler ignores key events bubbled from a nested control,
			// so Enter on Run now / Open fires that button, not the card. The guard ships in every screen's SCRIPT.
			keyactivateGuard: html.includes('if (e.target !== el) { return; }'),
		}, { cardOpensAgent: true, cardFocusable: true, openButton: true, runNow: true, runProject: true, keyactivateGuard: true });
	});

	test('an active card shows the mono status line + accent pause toggle; a paused card is 75% opacity + resume (A2.1)', () => {
		const html = renderScreenHtml('agents', { ...state, agents: [agent()], sources: [source('metrics.csv', 'file', true, []), source('pipeline.csv', 'file', true, [])] });
		// A2.1 status line: the all-clear green active line names the real watched-source count (2 registry
		// sources). Asserted against GREEN.base rather than a literal hex, so the test protects the MEANING
		// ("this is the applied/fresh/all-clear green") rather than a string that churns next redesign.
		assert.ok(html.includes(`color:${GREEN.base}">&#9679; active &middot; watching 2 sources`), 'an active card reads "active · watching N sources" in the all-clear green from the real registry');
		assert.ok(/data-msg="pauseAgent"[^>]*data-arg="weekly-refresh"/.test(html), 'the accent toggle pauses via setAgentDisabled');
		const paused = renderScreenHtml('agents', { ...state, agents: [agent({ disabled: true })] });
		assert.ok(paused.includes('opacity:.75') && paused.includes('&#9675; paused'), 'a paused card renders at 75% opacity with the "○ paused" status');
		assert.ok(/data-msg="resumeAgent"[^>]*data-arg="weekly-refresh"/.test(paused), 'a paused card toggle resumes via setAgentDisabled');
	});

	test('the policy table uses exactly the three-tier grammar in the comp\'s policy-dial inks (A2.2, comp 3a)', () => {
		// auto-figures: figures auto-apply (green), meaning ask first (amber), structure never (red).
		// The three inks are pinned against the TOKENS the comp names for this dial, not against literals:
		//   comp 3a line 873-875 draws them #1F7A4D / #B45309 / #B3261E, and abstractTokens transcribes those as
		//   GREEN.base ("applied / all clear"), AMBER.askFirst ("the 'ask first' tier ink on the agent policy
		//   dial") and RED.base ("...the 'never' policy tier"). Any other amber or red here is the wrong hue.
		const autoFigures = renderScreenHtml('agents', { ...state, agents: [agent({ policy: 'auto-figures' })] });
		assert.deepStrictEqual({
			autoApply: new RegExp(`${GREEN.base}[^<]*">auto-apply`).test(autoFigures),
			askFirst: new RegExp(`${AMBER.askFirst}[^<]*">ask first`).test(autoFigures),
			never: new RegExp(`${RED.base}[^<]*">never`).test(autoFigures),
		}, { autoApply: true, askFirst: true, never: true });
		// ask-before-apply + draft-only: nothing auto-applies (no auto-apply row); both read the same (no 4th state).
		const askBeforeApply = renderScreenHtml('agents', { ...state, agents: [agent({ policy: 'ask-before-apply' })] });
		assert.ok(!/">auto-apply</.test(askBeforeApply), 'ask-before-apply never shows an auto-apply row (nothing lands unattended)');
	});

	test('Edit policy opens the SHARED policy editor (the same DOM as Properties) and the footer shows the real model id (A2.3)', () => {
		const html = renderScreenHtml('agents', { ...state, agents: [agent()], agentModelId: 'claude-sonnet-4.5' });
		// The shared component: the same data-policy-editor container + data-policy rows the Properties panel hosts.
		assert.ok(/data-policy-editor="weekly-refresh"/.test(html), 'the card hosts the shared policy editor keyed by the agent id');
		assert.ok(/data-policy="auto-apply"/.test(html) && /data-policy="ask-first"/.test(html) && /data-policy="never"/.test(html), 'the shared editor renders exactly the three DocAutonomy levels');
		assert.ok(html.includes('runs on') && html.includes('claude-sonnet-4.5'), 'the footer shows the real workspace model id');
		assert.ok(/data-agent-policy-edit/.test(html), 'Edit policy reveals the shared editor');
	});

	test('the activity ledger renders real rows in the three tiers, cites gutter addresses and deep-links WAITING (A3.1/A3.3)', () => {
		const ledger: IActivityLedger = {
			truncated: false,
			entries: [
				{ at: 0, kind: 'waiting', lead: 'A meaning change is waiting on your call in ', doc: { label: 'Weekly Summary · line 6', docId: 'file:///ws/weekly.md', blockId: 'b-6' }, tail: '', badge: 'WAITING', deepLink: true },
				{ at: Date.parse('2026-07-06T09:40:00.000Z'), kind: 'applied', lead: 'Reporting agent refreshed 4 bound figures', tail: '', badge: 'auto-applied · reversible', deepLink: false },
				{ at: Date.parse('2026-07-06T08:15:00.000Z'), kind: 'admin', lead: 'Meeting agent paused', tail: '', badge: 'by Tom', deepLink: false },
			],
		};
		const html = renderScreenHtml('agents', { ...state, agents: [agent()], ledger, ledgerNow: Date.parse('2026-07-06T10:00:00.000Z') });
		// Every colour below is asserted against its token, never a literal hex: the three ledger tiers exist to
		// speak the product's one colour language (amber waits on you, green is settled, neutral is administrative),
		// so a test that pinned a string would let the ledger drift out of the system while still passing.
		assert.deepStrictEqual({
			label: html.includes('>ACTIVITY<'),
			waitingDot: html.includes(`background:${AMBER.base}`),
			appliedDot: html.includes(`background:${GREEN.base}`),
			adminDot: html.includes(`background:${PAPER.frameBorder}`),
			waitingPill: new RegExp(`${AMBER.label};background:${AMBER.subtleBg};border:1px solid ${AMBER.border}[^>]*>WAITING`).test(html),
			applied: new RegExp(`${GREEN.base}">auto-applied &middot; reversible`).test(html),
			admin: new RegExp(`${INK.meta}">by Tom`).test(html),
			address: html.includes('Weekly Summary &middot; line 6'),
			deepLink: /data-msg="ledgerReview" data-arg="file:\/\/\/ws\/weekly.md" data-block="b-6"/.test(html),
			// The same-day applied row reads as a wall-clock HH:MM stamp (local time, so the exact hour is not
			// asserted - the format is), and the WAITING row (at 0) reads as the live "now".
			sameDayStamp: /width:52px;flex:none">\d{2}:\d{2}</.test(html),
			nowStamp: html.includes('width:52px;flex:none">now<'),
		}, {
			label: true, waitingDot: true, appliedDot: true, adminDot: true, waitingPill: true,
			applied: true, admin: true, address: true, deepLink: true, sameDayStamp: true, nowStamp: true,
		});
	});

	test('the ledger renders a truthful empty state (no fabricated rows) and an honest truncation line (A3.2/A3.4)', () => {
		const empty = renderScreenHtml('agents', { ...state, agents: [agent()], ledger: { entries: [], truncated: false }, ledgerNow: 0 });
		const truncated = renderScreenHtml('agents', { ...state, agents: [agent()], ledger: { entries: [{ at: 1, kind: 'applied', lead: 'A change', tail: '', badge: 'auto-applied · reversible', deepLink: false }], truncated: true }, ledgerNow: 100000000 });
		assert.deepStrictEqual({
			emptyLine: empty.includes('No agent or review activity yet'),
			emptyHasNoBadge: !empty.includes('WAITING') && !empty.includes('auto-applied'),
			truncationLine: truncated.includes('Older activity lives in each document\'s History'),
		}, { emptyLine: true, emptyHasNoBadge: true, truncationLine: true });
	});

	test('the agent detail page answers three questions instead of drawing a pipeline (comp 3a)', () => {
		// The correction this screen is judged on (comp caption 3a): "three questions instead of a pipeline". The
		// round-1 flow graph - trigger, sources, agent, verify gate, policy gate, documents, review rail - is an
		// IDE's answer to a question nobody asked. A reader has exactly three questions about an agent, and the
		// page answers them in three cards. Every control the graph carried moved into the card that answers its
		// question, so the diagram left and no behaviour left with it.
		const html = renderScreenHtml('agents', { ...state, agents: [agent()], openAgentId: 'weekly-refresh', openAgentRuns: [] });
		assert.deepStrictEqual({
			whenCard: html.includes('WHEN IT RUNS'),
			touchCard: html.includes('WHAT IT MAY TOUCH'),
			policyCard: html.includes('WITHOUT ASKING, IT MAY'),
			// The schedule reads in plain words, never the stored cron string (that stays in the editor chip below).
			scheduleWords: html.includes('Mondays at 9:00'),
			noPipeline: !html.includes('Policy gate') && !html.includes('Review rail'),
			// The policy card hosts the SHARED three-tier editor (the same DOM the doc Properties panel renders),
			// keyed by the agent id, with this agent's honest current level marked - not a bespoke <select>.
			sharedEditor: /data-policy-editor="weekly-refresh"/.test(html),
			threeLevels: /data-policy="auto-apply"/.test(html) && /data-policy="ask-first"/.test(html) && /data-policy="never"/.test(html),
			currentLevelMarked: /class="pol-opt on" data-policy="auto-apply"/.test(html),
			noBespokeSelect: !/data-change-msg="setAgentPolicy"/.test(html) && !html.includes('value="ask-before-apply"'),
		}, {
			whenCard: true, touchCard: true, policyCard: true, scheduleWords: true, noPipeline: true,
			sharedEditor: true, threeLevels: true, currentLevelMarked: true, noBespokeSelect: true,
		});
	});

	test('the detail drawer trigger editor offers a cron day/time picker and a Save trigger action', () => {
		const html = renderScreenHtml('agents', { ...state, agents: [agent()], openAgentId: 'weekly-refresh', openAgentRuns: [] });
		assert.ok(/data-trigger-box/.test(html), 'a trigger editor box is present');
		assert.ok(/data-tfield="day"/.test(html) && /data-tfield="time"/.test(html), 'a cron day + time picker is offered');
		assert.ok(/data-tfield="hours"/.test(html), 'a heartbeat-hours field is offered');
		assert.ok(/data-trigger-save[^>]*data-arg="weekly-refresh"/.test(html), 'a Save trigger action carries the agent id');
	});

	test('RECENT RUNS renders receipt rows - a mono stamp, plain words, a state dot - not a column table (comp 3a)', () => {
		// Round 2 (comp 3a) replaces the round-1 WHEN/VIA/OUTCOME table with the product's one receipt-row atom:
		// time (mono) -> what happened (plain words) -> state dot. The counted facts survive, spoken as a sentence
		// rather than tallied into columns, so a run reads as an event instead of a spreadsheet row.
		const runs = [run({ via: 'cron', docsTouched: 2, applied: 1, queued: 3 })];
		const html = renderScreenHtml('agents', { ...state, agents: [agent()], openAgentId: 'weekly-refresh', openAgentRuns: runs });
		assert.deepStrictEqual({
			label: html.includes('RECENT RUNS'),
			noColumns: !/>WHEN</.test(html) && !/>VIA</.test(html) && !/>OUTCOME</.test(html),
			// The mono stamp leads the row, uppercase weekday + wall clock (the comp's "MON 07:00").
			stamp: /(SUN|MON|TUE|WED|THU|FRI|SAT) \d{2}:\d{2}/.test(html),
			// What woke it, then what it did - every count is the run's own.
			via: html.includes('On schedule'),
			counts: html.includes('swept 2 documents') && html.includes('1 figure applied') && html.includes('3 queued for review'),
			reviewLink: /data-msg="goReview"[^>]*>3 queued for review/.test(html),
			// A run that left changes waiting on the reader grades amber; nothing here is a settled green.
			amberDot: html.includes(`background:${AMBER.base}`),
		}, { label: true, noColumns: true, stamp: true, via: true, counts: true, reviewLink: true, amberDot: true });
	});

	test('the run log truthfully shows a failed run and a still-running skip (no fabricated success)', () => {
		const runs = [run({ error: 'metrics.csv unreadable', failed: 1 }), run({ skippedReason: 'still-running', applied: 0, queued: 0 })];
		const html = renderScreenHtml('agents', { ...state, agents: [agent({ status: 'error' })], openAgentId: 'weekly-refresh', openAgentRuns: runs });
		assert.ok(html.includes('Failed') && html.includes('metrics.csv unreadable'), 'a failed run shows the grader reason');
		assert.ok(html.includes('Skipped') && html.includes('still running'), 'a skipped run reads "still running"');
	});

	test('the run log shows a truthful empty state when the agent has never run', () => {
		const html = renderScreenHtml('agents', { ...state, agents: [agent()], openAgentId: 'weekly-refresh', openAgentRuns: [] });
		assert.ok(html.includes('No runs yet'), 'the empty run log states there are no runs');
		assert.ok(!/data-msg="goReview"/.test(html), 'no fabricated review link when nothing ran');
	});

	test('the detail drawer offers Duplicate + Pause (Resume when paused) and the run-now action', () => {
		const active = renderScreenHtml('agents', { ...state, agents: [agent()], openAgentId: 'weekly-refresh', openAgentRuns: [] });
		assert.ok(/data-msg="duplicateAgent"[^>]*data-arg="weekly-refresh"/.test(active), 'Duplicate is wired');
		assert.ok(/data-msg="pauseAgent"[^>]*data-arg="weekly-refresh"/.test(active), 'an enabled agent offers Pause');
		assert.ok(/data-msg="runWf"[^>]*data-arg="weekly-refresh"/.test(active), 'Run now is wired');
		const paused = renderScreenHtml('agents', { ...state, agents: [agent({ disabled: true })], openAgentId: 'weekly-refresh', openAgentRuns: [] });
		assert.ok(/data-msg="resumeAgent"[^>]*data-arg="weekly-refresh"/.test(paused), 'a paused agent offers Resume');
		assert.ok(paused.includes('the scheduler skips this agent'), 'a paused agent explains the scheduler skips it, but Run now still works');
	});

	test('the cross-project skill run affordance is present, and after a run shows a per-doc flag/pass strip', () => {
		const idle = renderScreenHtml('agents', { ...state, agents: [agent()], openAgentId: 'weekly-refresh', openAgentRuns: [] });
		assert.ok(/data-msg="runSkillProject"[^>]*data-arg="formatting"/.test(idle), 'a Run Formatting across project affordance is wired');
		const skillRun: ISkillRunSummary = summariseSkillRun('formatting', 'Formatting agent', [
			{ docId: 'a', docTitle: 'Access Control', status: 'flag', detail: '2 heading-case fixes suggested.' },
			{ docId: 'b', docTitle: 'Acceptable Use', status: 'pass', detail: 'All headings follow house style.' },
		]);
		const done = renderScreenHtml('agents', { ...state, agents: [agent()], openAgentId: 'weekly-refresh', openAgentRuns: [], skillRun });
		assert.ok(done.includes('Access Control') && done.includes('Acceptable Use'), 'each project document shows a row');
		assert.ok(done.includes('Flag') && done.includes('Pass'), 'the per-doc grade is the real verdict');
		assert.ok(done.includes('1 flagged') && done.includes('1 passed'), 'the strip summarises the real tallies');
	});

	// --- Settings: the model-access provider picker + onboarding survey (plan 35 iter 4) ---

	test('the provider picker offers "Sign in with ChatGPT" (primary) and "Use the included model" (secondary)', () => {
		const html = renderScreenHtml('settings', { ...state, providerStatus: { provider: 'none', readiness: 'unconfigured', signedIn: false, dailyBudgetUsd: 0 } });
		assert.ok(html.includes('Sign in with ChatGPT') && /data-msg="signInChatGpt"/.test(html), 'the primary door signs in with ChatGPT');
		assert.ok(html.includes('Use the included model') && /data-msg="useIncludedModel"/.test(html), 'the secondary door uses the included model');
	});

	test('a signed-in ChatGPT tier ACTUALLY serving shows the plain signed-in state + a Sign out control (issue #259)', () => {
		const html = renderScreenHtml('settings', { ...state, providerStatus: { provider: 'chatgpt', readiness: 'ready', signedIn: true, dailyBudgetUsd: 1 }, signInStage: 'signed-in' });
		assert.ok(html.includes('Signed in to ChatGPT'), 'the signed-in state is shown');
		assert.ok(/data-msg="signOutChatGpt"/.test(html), 'a Sign out control is wired');
		assert.ok(html.includes('Your ChatGPT subscription'), 'the "serving you now" line names the subscription door');
		// When the subscription is genuinely the door, the badge is the plain green affirmation - and there is
		// NO contradictory fallback wording, since ChatGPT really is answering.
		assert.ok(!/currently served by/.test(html) && !/data-signin-why/.test(html), 'no fallback caveat when ChatGPT actually serves');
	});

	// The core #259 fix: signed in to ChatGPT but the broker fell back to the included model (the #120
	// subscription-call failure). The screen must state ONE serving door (the included model) and the
	// sign-in badge must say so explicitly instead of a second green "everything's fine" affirmation.
	test('signed in to ChatGPT but served by the included model states one door and names the fallback honestly (issue #259)', () => {
		const html = renderScreenHtml('settings', { ...state, providerStatus: { provider: 'included', readiness: 'ready', signedIn: true, dailyBudgetUsd: 1, dailyTotalUsd: 0.2 }, signInStage: 'signed-in' });
		// Exactly one serving door is stated, and it is the door that actually answered (the included model).
		assert.ok(html.includes('The included model'), 'the serving door is the included model (the backend that answered)');
		assert.ok(!html.includes('Your ChatGPT subscription'), 'the ChatGPT subscription is NOT claimed as the serving door');
		// The sign-in badge tells the truth: signed in, but calls are currently served by the included model.
		assert.ok(html.includes('Signed in to ChatGPT, but calls are currently served by the included model'), 'the badge names the signed-in-but-falling-back truth');
		// An in-place honest explanation referencing the known issue is offered, without lying that ChatGPT serves.
		assert.ok(/data-signin-why/.test(html) && html.includes('See why'), 'an explain-in-place affordance is offered');
		assert.ok(html.includes('complete model calls through your ChatGPT plan') && html.includes('You stay signed in'), 'the explanation is honest about the ChatGPT path and reassures sign-in is kept');
		// Sign out is still reachable in the fallback state.
		assert.ok(/data-msg="signOutChatGpt"/.test(html), 'Sign out is still available while falling back');
	});

	// Plain included tier, NOT signed in: no ChatGPT claim of any kind, one honest door.
	test('the plain included tier (not signed in) makes no ChatGPT claim and states one serving door (issue #259)', () => {
		const html = renderScreenHtml('settings', { ...state, providerStatus: { provider: 'included', readiness: 'ready', signedIn: false, dailyBudgetUsd: 1, dailyTotalUsd: 0.6 } });
		assert.ok(html.includes('The included model'), 'the included model is the stated serving door');
		assert.ok(!html.includes('Signed in to ChatGPT'), 'no false "signed in" claim when the user is not signed in');
		assert.ok(/data-msg="signInChatGpt"/.test(html), 'the sign-in door is offered, not asserted as active');
	});

	// Broker down: no invented serving door, and no ChatGPT affirmation even if a stale sign-in existed.
	test('a broker-down state degrades honestly - no invented serving door (issue #259)', () => {
		const html = renderScreenHtml('settings', { ...state, providerStatus: { provider: 'none', readiness: 'broker-down', signedIn: false, dailyBudgetUsd: 0 } });
		assert.ok(html.includes('Connecting to the model service'), 'the broker-down state names the connecting state, not a fake door');
		assert.ok(!html.includes('The included model') && !html.includes('Your ChatGPT subscription'), 'no serving door is invented while the broker is down');
	});

	test('the included tier shows today\'s usage in plain words with a D19 usage ring', () => {
		const html = renderScreenHtml('settings', { ...state, providerStatus: { provider: 'included', readiness: 'ready', signedIn: false, dailyBudgetUsd: 1, dailyTotalUsd: 0.6 } });
		assert.ok(html.includes('Today&#39;s included usage'), 'the usage block is labelled in plain words');
		assert.ok(html.includes('US$0.60 of US$1.00 used today'), 'the real spend against the budget is shown');
		assert.ok(html.includes('<svg') && html.includes('60%'), 'a usage ring reflects the 60% spent fraction');
	});

	// Plan 51 device auth: the pending state renders the device code (copyable in one click) + the verification
	// link (opens the browser), and each failure names its real, visually distinct state - never a catch-all.
	const signedOutStatus = { provider: 'none' as const, readiness: 'unconfigured' as const, signedIn: false, dailyBudgetUsd: 0 };

	test('a pending sign-in renders the device code (copyable) + the verification link, and honours the poll interval', () => {
		const pending = renderScreenHtml('settings', {
			...state, providerStatus: signedOutStatus,
			signInStage: 'pending', signInUserCode: 'ABCD-EFGH', signInVerificationUri: 'https://auth.example/device?user_code=ABCD-EFGH',
		});
		assert.deepStrictEqual({
			waiting: /Waiting for you to finish signing in/i.test(pending),
			showsCode: pending.includes('ABCD-EFGH'),
			codeIsCopyable: /data-copy-link data-link="ABCD-EFGH"/.test(pending),
			opensVerificationLink: /data-open-external href="https:\/\/auth\.example\/device/.test(pending),
		}, { waiting: true, showsCode: true, codeIsCopyable: true, opensVerificationLink: true });
	});

	test('every sign-in failure names its real, visually distinct state (broker-down / upstream-rejected / expired)', () => {
		const brokerDown = renderScreenHtml('settings', { ...state, providerStatus: signedOutStatus, signInStage: 'error', signInError: 'The local model helper isn\'t running or can\'t be reached.' });
		const upstream = renderScreenHtml('settings', { ...state, providerStatus: signedOutStatus, signInStage: 'error', signInError: 'OpenAI rejected the sign-in.', signInUpstreamStatus: 429, signInUpstreamBody: 'slow_down' });
		const expired = renderScreenHtml('settings', { ...state, providerStatus: signedOutStatus, signInStage: 'expired', signInError: 'The sign-in code expired before it was approved. Start again to get a fresh code.' });
		assert.deepStrictEqual({
			brokerDownNamesHelper: brokerDown.includes('The local model helper isn\'t running or can\'t be reached.'),
			upstreamShowsStatus: upstream.includes('OpenAI rejected the sign-in.') && upstream.includes('OpenAI responded with 429') && upstream.includes('slow_down'),
			expiredNamesExpiry: expired.includes('The sign-in code expired before it was approved.'),
			// Round 2 (doc 28): sentence case on buttons too - "Start Again" is a round-1 artefact.
			expiredOffersStartAgain: expired.includes('Start again'),
		}, { brokerDownNamesHelper: true, upstreamShowsStatus: true, expiredNamesExpiry: true, expiredOffersStartAgain: true });
	});

	test('the onboarding survey captures the three questions and saves once (thank-you state after)', () => {
		const form = renderScreenHtml('settings', { ...state, providerStatus: { provider: 'none', readiness: 'unconfigured', signedIn: false, dailyBudgetUsd: 0 } });
		assert.ok(form.includes('Which frontier model is your daily driver?') && form.includes('Which subscriptions do you own?') && form.includes('What do you make each week?'), 'all three survey questions are present');
		assert.ok(/data-survey-save/.test(form), 'the survey has a Save action');
		const saved = renderScreenHtml('settings', { ...state, providerStatus: { provider: 'none', readiness: 'unconfigured', signedIn: false, dailyBudgetUsd: 0 }, surveySaved: true });
		// Assert on the rendered Save BUTTON, not the bare `data-survey-save` selector: the client SCRIPT
		// that ships with every screen contains `querySelectorAll('[data-survey-save]')`, so a loose
		// `/data-survey-save/` match is always true regardless of state (issue #135: corrected here).
		assert.ok(saved.includes('Thanks') && !/<button data-survey-save/.test(saved), 'once saved, a thank-you replaces the form');
	});

	test('the Model access screen carries the "What does Abstract send?" data-flow section (issue #135)', () => {
		const html = renderScreenHtml('settings', { ...state, providerStatus: { provider: 'none', readiness: 'unconfigured', signedIn: false, dailyBudgetUsd: 0 } });
		// The in-product home of the data-flow one-pager: a calm expandable section, not a new panel.
		assert.ok(html.includes('What does Abstract send?'), 'the data-flow question is reachable on the Model access screen');
		assert.ok(/<details data-dataflow>/.test(html), 'it is an inline expandable section that shows the answer on click');
		// The load-bearing honesty claims are present in plain words (each traces to a real code path).
		assert.ok(html.includes('Abstract sends content only when you ask it to work'), 'the plain-words summary is shown');
		assert.ok(html.includes('or when an agent you have left running does its scheduled check'), 'the summary owns the scheduled-agent path (default-enabled agents can send without a gesture at that moment)');
		assert.ok(html.includes('built-in agents run on their own') && html.includes('Pause any agent on the Agents screen'), 'the proactive-agent path is named with its off switch');
		// The honesty claim after analytics became real (issue #134): default-on with a visible off switch, and
		// even when on it stays on the machine because forwarding is not built. This is the true successor to
		// the "no analytics today" line - it must keep guarding the claim, just the honest one.
		assert.ok(/on by default and you can turn it off/i.test(html), 'the default-on honesty claim is present with its off switch');
		assert.ok(/counts your actions, never your words/i.test(html) && /forwarding it anywhere is not built yet/i.test(html), 'it says analytics counts actions not words and does not leave the machine');
		assert.ok(html.includes('docs/27-data-flow-one-pager.md'), 'it points to the full one-pager');
	});

	test('the data-flow card carries the revocable analytics-consent row reflecting On/Off (issue #134)', () => {
		const base = { ...state, providerStatus: { provider: 'none' as const, readiness: 'unconfigured' as const, signedIn: false, dailyBudgetUsd: 0 } };
		const off = renderScreenHtml('settings', { ...base, analyticsEnabled: false });
		const on = renderScreenHtml('settings', { ...base, analyticsEnabled: true });
		// The row exists on the data-flow card and always drives the one consent seam.
		assert.ok(/data-msg="setAnalyticsConsent"/.test(off) && /data-msg="setAnalyticsConsent"/.test(on), 'the consent row is present in both states');
		assert.ok(off.includes('Anonymous usage analytics'), 'the row is labelled in plain words');
		// Off state: the toggle offers "Turn on" (arg=on) and says nothing is counted.
		assert.ok(/data-msg="setAnalyticsConsent" data-arg="on"/.test(off) && off.includes('Turn on') && off.includes('nothing is counted'), 'when off, the row offers to turn it on and reports nothing counted');
		// On state: the toggle offers "Turn off" (arg=off) and says it is counting.
		assert.ok(/data-msg="setAnalyticsConsent" data-arg="off"/.test(on) && on.includes('Turn off') && on.includes('counting your actions locally'), 'when on, the row offers to turn it off and reports it is counting');
	});

	test('the Settings screen uses plain words only (no "OAuth", "token" or "rate limit")', () => {
		const html = (
			renderScreenHtml('settings', { ...state, providerStatus: { provider: 'chatgpt', readiness: 'ready', signedIn: true, dailyBudgetUsd: 1 }, signInStage: 'signed-in' })
			+ renderScreenHtml('settings', { ...state, providerStatus: { provider: 'included', readiness: 'ready', signedIn: false, dailyBudgetUsd: 1, dailyTotalUsd: 0.9 } })
			+ renderScreenHtml('settings', { ...state, providerStatus: { provider: 'none', readiness: 'unconfigured', signedIn: false, dailyBudgetUsd: 0 } })
		).toLowerCase();
		assert.ok(!html.includes('oauth') && !html.includes('rate limit') && !/\btoken\b/.test(html), 'no jargon leaks into the user-facing copy (P5)');
	});

	// --- Lifecycle gate: the export/present modal surfaces a failed before-export gate (plan 32 iter 4) ---
	// (Asserted on the document-editor present modal via its own render module in livingDocRender.test.ts.)

	// The renderer escapes the same way the screen does, so a uri assertion matches the emitted attribute.
	function esc(s: string): string {
		return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
	}
});
