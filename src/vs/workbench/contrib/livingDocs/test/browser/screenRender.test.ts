/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { URI } from '../../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { ILivingDocSummary, ISourceInfo, ITemplateInfo } from '../../common/livingDocs.js';
import { IAgentDef, IAgentRun, ISkillRunSummary, summariseProjectRun, summariseSkillRun } from '../../common/livingDocsModel.js';
import { buildAwayFeed } from '../../common/projectHomeFeed.js';
import { IScreenState, renderScreenHtml, ScreenId } from '../../browser/screenRender.js';

suite('livingDocs screenRender', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	const state: IScreenState = { knScope: 'org', agents: [], filter: 'all' };

	// Every main-area screen carries the comp's global top bar: brand + per-screen crumb on the left,
	// the sync-status pill + Present + the user avatar on the right.
	const screens: { id: ScreenId; crumb: string }[] = [
		{ id: 'home', crumb: 'Home' },
		{ id: 'templates', crumb: 'Templates' },
		{ id: 'knowledge', crumb: 'Knowledge' },
		{ id: 'agents', crumb: 'Agents' },
	];

	for (const { id, crumb } of screens) {
		test(`${id} renders the global top bar (brand, ${crumb} crumb, sync pill, Present, avatar)`, () => {
			const html = renderScreenHtml(id, state);
			const head = html.indexOf('class="topbar"');
			assert.ok(head >= 0, 'has a top bar');
			// The top bar precedes the screen content (it is the first flex child of .screen).
			assert.ok(head < html.indexOf('class="scr-body"') || html.indexOf('class="scr-body"') === -1, 'top bar is above the body');
			assert.ok(html.includes('Abstract'), 'shows the product brand');
			assert.ok(html.includes(`class="crumb">${crumb}<`), `crumb reads ${crumb}`);
			assert.ok(html.includes('All sources synced'), 'shows the sync-status pill');
			assert.ok(/data-msg="present"[^>]*class="tb-present"|class="tb-present"[^>]*data-msg="present"/.test(html), 'has a Present control wired to the present message');
			assert.ok(html.includes('class="av">TS<'), 'shows the user avatar');
		});
	}

	test('exactly one top bar is rendered per screen', () => {
		for (const { id } of screens) {
			const html = renderScreenHtml(id, state);
			assert.strictEqual(html.split('class="topbar"').length - 1, 1, `${id} has a single top bar`);
		}
	});

	// --- D26 onboarding surface: the guided two-wow flow renders the current funnel step + its real action ---

	test('onboarding open step shows the intro, the consent status and the See it work action', () => {
		const html = renderScreenHtml('onboarding', { ...state, onboarding: { step: 'open', consentEnabled: true, consentChosen: true, hasModel: true, demoGenerated: false } });
		assert.ok(html.includes('Two Wows, Ten Minutes, No Setup'), 'intro headline');
		assert.ok(/data-msg="onbSeeItWork"/.test(html), 'has the See it work action');
		assert.ok(html.includes('never your words'), 'shows the plain-words consent line');
		assert.ok(html.includes('Step 1 of 7'), 'shows funnel progress');
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
		return { resource: URI.file(path), title, isLiving, sourceKinds: isLiving ? ['file'] : [], sources: isLiving ? ['metrics.csv'] : [], lastSynced: '', pendingCount, folder: '' };
	}

	test('home with no folder open shows the empty state and an Open folder action (no demo projects)', () => {
		const html = renderScreenHtml('home', { ...state, hasFolder: false });
		assert.ok(html.includes('Open a folder to begin'), 'shows the empty-state prompt');
		assert.ok(/data-msg="openFolder"/.test(html), 'the empty state has an Open folder action');
		assert.ok(!html.includes('Acme Co') && !html.includes('Job Search 2026'), 'no hardcoded demo project cards');
	});

	test('home with a folder open reflects the real folder: its name as the project, and a NEEDS-YOU card per doc with pending work', () => {
		// The home dashboard (plan 22) leads with the project name + a NEEDS-YOU section: one card per
		// document that has pending changes, each opening that document to review. A doc with no pending
		// work is truthfully absent from NEEDS-YOU (it is not "waiting for you").
		const docs = [summary('/ws/Weekly Update.md', 'Weekly Update', true, 3), summary('/ws/Team Notes.md', 'Team Notes', false, 0)];
		const html = renderScreenHtml('home', { ...state, hasFolder: true, folderName: 'realdocs-test', docs });

		assert.ok(html.includes('realdocs-test'), 'shows the open folder name as the project');
		assert.ok(/NEEDS YOU/.test(html), 'shows the NEEDS-YOU section when a doc has pending work');
		assert.ok(html.includes('Weekly Update'), 'the doc with pending changes is a NEEDS-YOU card');
		assert.strictEqual(html.split('data-msg="openDoc"').length - 1, 1, 'only the doc with pending work carries a Review action');
		assert.ok(!html.includes('Acme Co') && !html.includes('Fund III'), 'no hardcoded demo project cards');
		assert.ok(/data-msg="openFolder"/.test(html) || /data-msg="openFirstDoc"/.test(html), 'the populated home is interactive');
		assert.ok(!html.includes('data-msg="newProject"') && !/>New project</.test(html), 'the no-op New project button is gone');
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
	test('home offers the "From sources..." birth: a source picker sheet driven by the real folder sources', () => {
		const html = renderScreenHtml('home', {
			...state, hasFolder: true, folderName: 'realdocs-test', docs: [], templates: [],
			dataFiles: ['metrics.csv'], docFiles: ['market-research.md', 'Team Notes.md'],
		});
		// The third birth is present in the New-document sheet and opens its own picker sheet.
		assert.ok(/data-sheet-open="fromsources"/.test(html), 'the New-document sheet carries a From sources... row');
		assert.ok(html.includes('id="sheet-fromsources"'), 'the source picker sheet is present');
		assert.ok(html.includes('New document from sources'), 'the picker names the birth');
		// Real data only: every folder source is a checkbox pick; the submit posts newFromSources.
		assert.ok(html.includes('data-pick="metrics.csv"'), 'the csv data source is a pick');
		assert.ok(html.includes('data-pick="market-research.md"') && html.includes('data-pick="Team Notes.md"'), 'the documents are picks');
		assert.ok(/data-msg="newFromSources"/.test(html), 'the picker submits to newFromSources');
		assert.ok(/data-field="name"/.test(html) && /data-field="note"/.test(html), 'the picker has a name and an optional instruction');
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

	// --- Home failed-run attention line (plan 32 iter 2): truthful, links to Agents ---

	test('home surfaces one quiet attention line when a scheduled run failed, linking to Agents', () => {
		const html = renderScreenHtml('home', {
			...state, hasFolder: true, folderName: 'realdocs-test', docs: [summary('/ws/Weekly Update.md', 'Weekly Update', true, 0)],
			homeFailure: { agentName: 'Weekly refresh', day: 'Monday', error: 'metrics.csv unreadable' },
		});
		assert.ok(html.includes('Weekly refresh failed on Monday'), 'shows the agent + day in the failure line');
		assert.ok(/data-msg="goAgents"/.test(html), 'the failure line links to the Agents screen');
		assert.ok(html.includes('View details'), 'offers a details affordance');
	});

	test('home shows NO failure line when nothing failed (truthful automation, no fake activity)', () => {
		const html = renderScreenHtml('home', { ...state, hasFolder: true, folderName: 'realdocs-test', docs: [summary('/ws/Weekly Update.md', 'Weekly Update', true, 0)] });
		assert.ok(!/failed on/.test(html), 'no fabricated failure line when there is no failure');
	});

	// --- Home front door (F15 / journey 1w): WHILE YOU WERE AWAY feed, all-clear promotion, chat composer ---

	const now = Date.parse('2026-07-13T12:00:00Z');

	test('home carries the whole-project chat composer defaulting to whole-project scope (map-D21/D24)', () => {
		const html = renderScreenHtml('home', { ...state, hasFolder: true, folderName: 'ws', docs: [summary('/ws/A.md', 'A', true, 0)] });
		assert.ok(/data-ask-box/.test(html), 'renders the composer box');
		assert.ok(/data-ask-input/.test(html) && /data-ask-send/.test(html), 'has an input + Ask control');
		assert.ok(/ASK THIS PROJECT/.test(html) && /Whole project/.test(html), 'defaults to whole-project scope');
	});

	test('home renders the WHILE YOU WERE AWAY feed from real run rows, with needs-you counts', () => {
		const awayFeed = buildAwayFeed({
			runs: [{ agentId: 'refresh', startedAt: '2026-07-13T11:00:00Z', applied: 1, queued: 2, docsTouched: 3, via: 'cron' }],
			agentNames: { refresh: 'Weekly refresh' },
			needsYouTotal: 2,
			sinceMs: Date.parse('2026-07-13T00:00:00Z'),
			nowMs: now,
		});
		const html = renderScreenHtml('home', { ...state, hasFolder: true, folderName: 'ws', docs: [summary('/ws/A.md', 'A', true, 2)], awayFeed });
		assert.ok(/WHILE YOU WERE AWAY/.test(html), 'shows the away section when a run happened in the window');
		assert.ok(html.includes('Weekly refresh'), 'names the real agent that ran');
		assert.ok(/2 NEEDS YOU/.test(html), 'carries the run\'s needs-you count');
		assert.ok(!/Everything is in sync/.test(html), 'no all-clear promotion while work pends');
	});

	test('home promotes the all-clear (map-D14) when nothing pends, and never fabricates feed rows', () => {
		const awayFeed = buildAwayFeed({ runs: [], agentNames: {}, needsYouTotal: 0, sinceMs: 1, nowMs: now });
		const html = renderScreenHtml('home', { ...state, hasFolder: true, folderName: 'ws', docs: [summary('/ws/A.md', 'A', true, 0)], awayFeed });
		assert.ok(html.includes('Everything is in sync'), 'shows the calm all-clear promotion');
		assert.ok(!/WHILE YOU WERE AWAY/.test(html), 'no feed section when nothing ran (no fabricated rows)');
	});

	test('home renders a read-only project answer with citation chips (map-D24)', () => {
		const html = renderScreenHtml('home', {
			...state, hasFolder: true, folderName: 'ws', docs: [summary('/ws/A.md', 'A', true, 0)],
			projectAnswer: { answer: 'Revenue is on plan, no surprises.', citations: ['Board Note', 'metrics.csv'], via: 'model' },
		});
		assert.ok(/READ-ONLY/.test(html), 'labels the answer as read-only');
		assert.ok(html.includes('Revenue is on plan, no surprises.'), 'shows the answer prose');
		assert.ok(html.includes('Board Note') && html.includes('metrics.csv'), 'shows the real citation chips');
		// The chip row leads with "Consulted:" - exactly-true wording, since the fallback path lists every file
		// read for the answer (not a model-attested "supporting sources" set).
		assert.ok(html.includes('Consulted:'), 'the chip row is labelled Consulted so it never over-claims support');
	});

	// --- Templates (plan 28): the real template library, driven by listTemplates() ---

	function template(name: string, description: string, sources: readonly string[], body: string): ITemplateInfo {
		return { uri: URI.file(`/ws/templates/${name}.template.md`), name, description, sources, body };
	}

	test('templates screen lists real cards with true slot/source counts and Use/Edit/New wired', () => {
		const templates = [
			template('Weekly report', 'A weekly operating summary.', ['metrics.csv'], '# {{slot:title}}\n\nWeek {{slot:week}}\n\nMRR is [pending](bind:metrics.mrr).'),
			template('Client update', 'A warm progress note.', [], '# {{slot:client}}\n\nProgress.'),
		];
		const html = renderScreenHtml('templates', { ...state, templates });

		assert.ok(html.includes('Weekly report') && html.includes('Client update'), 'lists every discovered template by name');
		assert.ok(html.includes('A weekly operating summary.'), 'shows the authored description');
		// True counts: Weekly report has 2 slots + 1 source; Client update has 1 slot + 0 sources.
		assert.ok(html.includes('2 slots &middot; 1 source'), 'Weekly report shows the true 2 slots / 1 source count');
		assert.ok(html.includes('1 slot &middot; 0 sources'), 'Client update shows the true 1 slot / 0 sources count');
		// Actions wired to the real template uri. Use Template opens the D28-B generate sheet and posts the
		// generateFromTemplate message (plan 28, iter 3); Edit opens the file; New Template is present.
		assert.strictEqual(html.split('data-msg="generateFromTemplate"').length - 1, 3, 'each card wires Use Template to generate, plus the sheet submit');
		assert.strictEqual(html.split('data-sheet-open="generate"').length - 1, 2, 'each card opens the generate sheet');
		assert.strictEqual(html.split('data-msg="editTemplate"').length - 1, 2, 'each card has an Edit action');
		assert.ok(html.includes('data-arg="' + esc(templates[0].uri.toString()) + '"'), 'the action carries the real template uri');
		assert.ok(/data-msg="newTemplate"/.test(html), 'New Template is wired');
		// The generate sheet itself: a required document-name field and a Generate Draft submit (D28-B).
		assert.ok(html.includes('id="sheet-generate"') && html.includes('Generate Draft'), 'the calm generate sheet is present with a Generate Draft action');
		assert.ok(/data-field="name"/.test(html) && /data-field="note"/.test(html), 'the sheet has a name field and an optional note field');
	});

	test('templates screen shows a calm empty state with Create your first template, no fake preview', () => {
		const html = renderScreenHtml('templates', { ...state, templates: [] });
		assert.ok(/No templates yet/i.test(html), 'shows the empty-state line');
		assert.ok(/data-msg="newTemplate"/.test(html) && html.includes('Create your first template'), 'offers to create the first template');
		// The old mockup content is gone (no fabricated draft / resolved-slots preview).
		assert.ok(!html.includes('Weekly Operating Summary') && !html.includes('ALL SLOTS RESOLVED'), 'no fabricated draft preview');
	});

	// --- F18 from-examples template wizard (journey 1x): a picker over the real project documents ---
	test('templates screen offers the from-examples wizard: a picker over the real documents, keeping the blank editor', () => {
		const templates = [template('Weekly report', 'A weekly operating summary.', ['metrics.csv'], '# {{slot:title}}\n\nMRR.')];
		const html = renderScreenHtml('templates', { ...state, templates, docFiles: ['Board Note.md', 'Team Notes.md', 'Weekly Summary.md', 'market-research.md'] });
		assert.ok(/data-sheet-open="fromexamples"/.test(html), 'a New From Examples action opens the wizard');
		assert.ok(html.includes('id="sheet-fromexamples"'), 'the from-examples picker sheet is present');
		assert.ok(html.includes('New template from examples'), 'the sheet names the wizard');
		assert.ok(html.includes('data-pick="Board Note.md"') && html.includes('data-pick="market-research.md"'), 'every real document is a pick');
		assert.ok(/data-msg="newTemplateFromExamples"/.test(html), 'the wizard submits to newTemplateFromExamples');
		// The manual editor stays, labelled as editing/blank - not the wizard (spec 1x).
		assert.ok(/data-msg="newTemplate"/.test(html) && html.includes('New Blank Template'), 'the manual blank editor is retained and labelled as such');
	});

	test('templates empty state leads with the from-examples wizard when there are documents to learn from', () => {
		const html = renderScreenHtml('templates', { ...state, templates: [], docFiles: ['a.md', 'b.md', 'c.md'] });
		assert.ok(/data-sheet-open="fromexamples"/.test(html), 'the empty state offers New from examples');
		assert.ok(html.includes('id="sheet-fromexamples"'), 'the wizard sheet is present in the empty state');
		assert.ok(/data-msg="newTemplate"/.test(html) && html.includes('New blank template'), 'the blank editor is still offered');
	});

	test('templates empty state falls back to the blank editor when there are no documents to learn from', () => {
		const html = renderScreenHtml('templates', { ...state, templates: [], docFiles: [] });
		assert.ok(!/data-sheet-open="fromexamples"/.test(html), 'no wizard entry without documents to learn from');
		assert.ok(html.includes('Create your first template'), 'still offers to author a template by hand');
	});

	test('templates screen carries no "Soon" labels', () => {
		const withTemplates = renderScreenHtml('templates', { ...state, templates: [template('T', 'd', [], 'body {{slot:x}}')] });
		const empty = renderScreenHtml('templates', { ...state, templates: [] });
		assert.ok(!/\bSoon\b/i.test(withTemplates) && !/\bSoon\b/i.test(empty), 'zero "Soon" labels on the Templates screen');
	});

	// --- Knowledge: the project's real source registry (plan 29, D29-A) ---

	function source(id: string, kind: 'file' | 'api', fresh: boolean, usedBy: { path: string; title: string; keys: string[]; context?: boolean }[]): ISourceInfo {
		return {
			id, kind,
			label: kind === 'api' ? new URL(id).host : id,
			syncedAt: new Date().toISOString(),
			fresh,
			usedBy: usedBy.map(u => ({ doc: URI.file(u.path), title: u.title, keys: u.keys, context: !!u.context })),
		};
	}

	test('Knowledge Project tab renders the real SOURCES table with per-source freshness and the used-by count', () => {
		const sources = [
			source('metrics.csv', 'file', true, [
				{ path: '/ws/Weekly.md', title: 'Weekly Summary', keys: ['metrics.mrr', 'metrics.signups'] },
				{ path: '/ws/Board.md', title: 'Board Note', keys: ['metrics.mrr'] },
			]),
			source('https://api.example.com/repo', 'api', false, [{ path: '/ws/Eco.md', title: 'Ecosystem', keys: ['repo.stars'] }]),
		];
		const html = renderScreenHtml('knowledge', { ...state, knScope: 'project', sources });
		assert.ok(html.includes('metrics.csv'), 'the file source label shows');
		assert.ok(html.includes('api.example.com'), 'the api source shows its host label');
		assert.ok(html.includes('2 docs'), 'the shared CSV shows a used-by count of 2');
		assert.ok(html.includes('Fresh'), 'a fresh source shows the fresh state');
		assert.ok(html.includes('Source changed'), 'a stale source shows the truthful changed state');
		assert.ok(!/\bSoon\b/i.test(html), 'the Project tab carries no "Soon" label');
		assert.ok(/data-msg="selectSource"[^>]*data-arg="metrics.csv"/.test(html), 'a source row selects into its detail drawer');
		assert.ok(/data-sheet-open="addsource"/.test(html), 'an Add source action is wired');
	});

	test('Knowledge Project tab shows the honest empty state when no source is referenced', () => {
		const html = renderScreenHtml('knowledge', { ...state, knScope: 'project', sources: [] });
		assert.ok(html.includes('No sources yet'), 'the honest empty registry state');
		assert.ok(!/\bSoon\b/i.test(html), 'the empty Project tab fabricates nothing (no "Soon")');
	});

	test('Knowledge source drawer lists the dependent documents with jump-to-doc and Detach', () => {
		const sources = [source('metrics.csv', 'file', true, [
			{ path: '/ws/Weekly.md', title: 'Weekly Summary', keys: ['metrics.mrr'] },
			{ path: '/ws/Notes.md', title: 'Market notes', keys: [], context: true },
		])];
		const html = renderScreenHtml('knowledge', { ...state, knScope: 'project', sources, knSelectedSource: 'metrics.csv' });
		assert.ok(html.includes('USED BY 2 DOCUMENTS'), 'the drawer names the two dependent documents');
		assert.ok(html.includes('metrics.mrr'), 'a value dependency shows its bind key');
		assert.ok(html.includes('Context reference'), 'a context dependency is labelled as influence, not a fake key');
		assert.ok(/data-msg="openDoc"[^>]*data-arg="[^"]*Weekly\.md"/.test(html), 'jump-to-doc opens the dependent document');
		assert.ok(/data-msg="detachSource"/.test(html), 'each dependency has a Detach action');
		assert.ok(html.includes('&quot;context&quot;:true'), 'the detach arg records whether the use is a context reference');
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
		assert.ok(html.includes('#9a6b16'), 'the oversize tile uses the amber treatment');
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

	test('the Agents list wires New agent to create and shows a PAUSED chip for a disabled agent', () => {
		const agents = [agent(), agent({ id: 'sweep', name: 'Freshness sweep', trigger: { kind: 'heartbeat', everyHours: 6 }, policy: 'draft-only', disabled: true })];
		const html = renderScreenHtml('agents', { ...state, agents });
		assert.ok(/data-msg="createAgent"/.test(html), 'New agent is wired to createAgent');
		assert.ok(html.includes('PAUSED'), 'a disabled agent shows a PAUSED chip in the list');
	});

	test('the detail drawer shows the read-only canvas strip and the inline policy select with the three levels', () => {
		const html = renderScreenHtml('agents', { ...state, agents: [agent()], openAgentId: 'weekly-refresh', openAgentRuns: [] });
		// The read-only canvas strip (D32-B): the loop nodes.
		assert.ok(html.includes('Policy gate') && html.includes('Verify') && html.includes('Review rail'), 'the read-only canvas strip renders the loop');
		// The inline policy select posts setAgentPolicy on change and carries exactly the three levels.
		assert.ok(/data-change-msg="setAgentPolicy"[^>]*data-arg="weekly-refresh"/.test(html), 'the policy select posts setAgentPolicy for this agent');
		assert.ok(html.includes('value="auto-figures"') && html.includes('value="ask-before-apply"') && html.includes('value="draft-only"'), 'exactly the three policy levels are offered');
		assert.ok(/value="auto-figures" selected/.test(html), 'the current policy is pre-selected');
	});

	test('the detail drawer trigger editor offers a cron day/time picker and a Save trigger action', () => {
		const html = renderScreenHtml('agents', { ...state, agents: [agent()], openAgentId: 'weekly-refresh', openAgentRuns: [] });
		assert.ok(/data-trigger-box/.test(html), 'a trigger editor box is present');
		assert.ok(/data-tfield="day"/.test(html) && /data-tfield="time"/.test(html), 'a cron day + time picker is offered');
		assert.ok(/data-tfield="hours"/.test(html), 'a heartbeat-hours field is offered');
		assert.ok(/data-trigger-save[^>]*data-arg="weekly-refresh"/.test(html), 'a Save trigger action carries the agent id');
	});

	test('the run log renders relative time, via and outcome-count columns, with an "N queued" review link', () => {
		const runs = [run({ via: 'cron', docsTouched: 2, applied: 1, queued: 3 })];
		const html = renderScreenHtml('agents', { ...state, agents: [agent()], openAgentId: 'weekly-refresh', openAgentRuns: runs });
		assert.ok(/WHEN/.test(html) && /VIA/.test(html) && /OUTCOME/.test(html), 'the run-log columns are present');
		assert.ok(html.includes('2 docs') && html.includes('1 applied') && html.includes('3 queued'), 'the outcome counts render');
		assert.ok(/data-msg="goReview"[^>]*>3 queued/.test(html), 'a run that queued changes links to the review surface');
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

	test('a signed-in ChatGPT tier shows the signed-in state + a Sign out control', () => {
		const html = renderScreenHtml('settings', { ...state, providerStatus: { provider: 'chatgpt', readiness: 'ready', signedIn: true, dailyBudgetUsd: 1 }, signInStage: 'signed-in' });
		assert.ok(html.includes('Signed in to ChatGPT'), 'the signed-in state is shown');
		assert.ok(/data-msg="signOutChatGpt"/.test(html), 'a Sign out control is wired');
		assert.ok(html.includes('Your ChatGPT subscription'), 'the "serving you now" line names the subscription door');
	});

	test('the included tier shows today\'s usage in plain words with a D19 usage ring', () => {
		const html = renderScreenHtml('settings', { ...state, providerStatus: { provider: 'included', readiness: 'ready', signedIn: false, dailyBudgetUsd: 1, dailyTotalUsd: 0.6 } });
		assert.ok(html.includes('Today&#39;s included usage'), 'the usage block is labelled in plain words');
		assert.ok(html.includes('US$0.60 of US$1.00 used today'), 'the real spend against the budget is shown');
		assert.ok(html.includes('<svg') && html.includes('60%'), 'a usage ring reflects the 60% spent fraction');
	});

	test('a pending sign-in shows the "waiting for your browser" state, and an error shows plain-words copy', () => {
		const pending = renderScreenHtml('settings', { ...state, providerStatus: { provider: 'none', readiness: 'unconfigured', signedIn: false, dailyBudgetUsd: 0 }, signInStage: 'pending' });
		assert.ok(/Waiting for you to finish signing in/i.test(pending), 'the pending state tells the user to complete sign-in in the browser');
		const errored = renderScreenHtml('settings', { ...state, providerStatus: { provider: 'none', readiness: 'unconfigured', signedIn: false, dailyBudgetUsd: 0 }, signInStage: 'error', signInError: 'Sign-in did not complete - please try again.' });
		assert.ok(errored.includes('Sign-in did not complete'), 'a sign-in error is surfaced in plain words');
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
		// The honesty claim after analytics became real (issue #134): consent-first, and even when on it stays
		// on the machine because forwarding is not built. This is the true successor to the "no analytics today"
		// line - it must keep guarding the claim, just the honest one.
		assert.ok(/off unless you turn it on/i.test(html), 'the consent-first honesty claim is present');
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
