/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// The remaining Abstract screens that no lane owns exclusively: Model access (Settings), Onboarding, the
// whole-project run surface (project-run) and the cross-document review surface (review-project). Public:
// renderSettings, renderOnboarding, renderProjectRun, renderReviewProject. Split out of screenRender.ts to
// keep the shell thin; shared helpers come from screenRenderShell.

import { localize } from '../../../../nls.js';
import { groupPendingByDoc, IDecisionGroup, IProjectRunSummary, IProposedChange, IReviewedDoc, ProjectRunDocStatus, reviewConfidence, reviewFraming } from '../common/livingDocsModel.js';
import { ChatGptSignInStage } from '../common/livingDocs.js';
import { ONBOARDING_STEPS, onboardingStepIndex, OnboardingStep } from '../common/onboarding.js';
import { ACCENT, avatar, esc, IScreenState } from './screenRenderShell.js';

// ---- Model access: the provider picker + onboarding survey (plan 35 iter 4; doc 18 sections 2.1 + 2.4).
// The first-run/Settings step where the user chooses how their model calls are paid for: "Sign in with
// ChatGPT" (their own subscription, primary) or "Use the included model" (the founder-funded fallback,
// secondary). The active door + today's included-usage are shown live from the proxy's /healthz (D19: usage
// glanceable). Below it, the three onboarding survey questions are captured once and recorded as the local
// `model_configured` event. All copy is plain words (P5): never "OAuth", "token" or "rate limit". ----

// A compact usage ring (D19 semantics) rendered as an inline SVG donut: the fraction of today's included
// usage spent. Reused idiom, not the chat contrib's token-context ring (that widget is a DOM component bound
// to chat models - see the report's deviation note); this shows the DOLLAR fraction the cap actually meters.
function usageRing(fraction: number): string {
	const pct = Math.max(0, Math.min(1, fraction));
	const r = 15;
	const c = 2 * Math.PI * r;
	const dash = (pct * c).toFixed(2);
	const colour = pct >= 0.9 ? '#b4332f' : (pct >= 0.75 ? '#9a6b16' : ACCENT);
	return `<svg width="40" height="40" viewBox="0 0 40 40" style="flex:none">
		<circle cx="20" cy="20" r="${r}" fill="none" stroke="#eceef2" stroke-width="4"></circle>
		<circle cx="20" cy="20" r="${r}" fill="none" stroke="${colour}" stroke-width="4" stroke-linecap="round"
			stroke-dasharray="${dash} ${(c - Number(dash)).toFixed(2)}" transform="rotate(-90 20 20)"></circle>
		<text x="20" y="24" text-anchor="middle" style="font:600 11px/1 system-ui;fill:#52575f">${Math.round(pct * 100)}%</text>
	</svg>`;
}

// The pending "Sign in with ChatGPT" block (plan 38): we still attempt the automatic browser open, but a
// post-await window.open is popup-blocked (especially in Incognito), so we never depend on it. Instead we
// surface a real anchor the user clicks directly - a genuine user gesture opens the tab, never swallowed -
// routed to the host so it opens OUTSIDE the sandboxed webview (openerService -> system browser). A "Copy
// link" fallback covers corporate/blocked environments where even the direct open is intercepted, and the
// URL is shown as selectable text so it can always be pasted by hand. Plain words throughout (P5).
function pendingSignInBlock(authorizeUrl: string | undefined): string {
	const waiting = `<div style="display:inline-flex;align-items:center;gap:9px;font:600 13px/1 system-ui;color:#52575f;margin-bottom:14px"><span style="width:13px;height:13px;border:2px solid #d3d6dd;border-top-color:${ACCENT};border-radius:50%;animation:lwdSpin .8s linear infinite"></span>Waiting for you to finish signing in&hellip;</div>`;
	if (!authorizeUrl) {
		return `<div>${waiting}</div>`;
	}
	const url = esc(authorizeUrl);
	return `<div>
		${waiting}
		<p style="margin:0 0 12px;font:400 12.5px/1.55 system-ui;color:#696e78">If your browser didn&#39;t open, open the sign-in page yourself:</p>
		<div style="display:flex;align-items:center;gap:9px;flex-wrap:wrap;margin-bottom:12px">
			<a data-open-external href="${url}" style="display:inline-flex;align-items:center;gap:8px;border:none;border-radius:10px;padding:12px 20px;background:${ACCENT};color:#fff;font:600 13.5px/1 system-ui;text-decoration:none;cursor:pointer">Open the sign-in page &#8599;</a>
			<button data-copy-link data-link="${url}" style="border:1px solid #d4d7dd;background:#fff;border-radius:10px;padding:11px 16px;font:600 12.5px/1 system-ui;color:#52575f;cursor:pointer">Copy link</button>
		</div>
		<div style="font:400 11px/1.5 ui-monospace,SFMono-Regular,monospace;color:#9aa0ac;background:#f7f8fa;border:1px solid #eceef2;border-radius:8px;padding:9px 11px;word-break:break-all;user-select:all">${url}</div>
	</div>`;
}

export function renderSettings(state: IScreenState): string {
	const status = state.providerStatus ?? { provider: 'none' as const, readiness: 'broker-down' as const, signedIn: false, dailyBudgetUsd: 0 };
	const stage: ChatGptSignInStage = state.signInStage ?? (status.signedIn ? 'signed-in' : 'signed-out');

	// The live "what is serving you now" line - real data only, keyed off the truthful readiness (issue #170)
	// so the broker-not-up state is distinct from a reachable-but-unconfigured backend. This is the SINGLE
	// stated serving door: exactly one, derived from the backend that actually answered the last call
	// (broker /healthz `backend`), never the sign-in status (issue #259). A user must be able to read one
	// answer to "which door is answering me right now".
	const doorLabel = status.provider === 'chatgpt'
		? localize('livingDocs.settings.door.chatgpt', "Your ChatGPT subscription")
		: status.provider === 'included'
			? (status.readiness === 'budget-paused'
				? localize('livingDocs.settings.door.includedPaused', "The included model (daily limit reached)")
				: localize('livingDocs.settings.door.included', "The included model"))
			: status.readiness === 'broker-down'
				? localize('livingDocs.settings.door.connecting', "Connecting to the model service…")
				: localize('livingDocs.settings.door.none', "The built-in fallback (no model connected)");
	const dot = status.provider === 'none' ? '#cdd1d8' : 'oklch(0.6 0.13 150)';

	// The honesty seam for issue #259: a user can be signed in to ChatGPT while their calls are actually
	// served by the included model (the #120 subscription-call failure falls back to OpenRouter). The
	// serving door above already tells the truth; here we make sure the sign-in badge does NOT read as a
	// second, contradictory "you are being served by ChatGPT" affirmation. `servedByChatGpt` is the only
	// state where the plain green "Signed in to ChatGPT" is honest; whenever we are signed in but a
	// different door answered, we say so explicitly and offer an in-place explanation.
	const servedByChatGpt = status.provider === 'chatgpt';
	const signedInButFallenBack = status.signedIn && !servedByChatGpt;
	const fallbackDoorName = status.provider === 'included'
		? localize('livingDocs.settings.fallback.included', "the included model")
		: localize('livingDocs.settings.fallback.none', "the built-in fallback");

	// The included-tier usage line + ring (only meaningful for the metered fallback).
	let usageBlock = '';
	if (typeof status.dailyTotalUsd === 'number' && status.dailyBudgetUsd > 0) {
		const frac = status.dailyTotalUsd / status.dailyBudgetUsd;
		const spent = status.dailyTotalUsd.toFixed(2);
		const budget = status.dailyBudgetUsd.toFixed(2);
		usageBlock = `<div style="display:flex;align-items:center;gap:14px;margin-top:18px;padding-top:18px;border-top:1px solid #f1f2f5">
			${usageRing(frac)}
			<div><div style="font:600 13px/1.3 system-ui;color:#1a1c20">Today&#39;s included usage</div>
			<div style="font:400 12px/1.4 system-ui;color:#696e78">US$${spent} of US$${budget} used today &middot; picks up again tomorrow</div></div>
		</div>`;
	}

	// The "Sign in with ChatGPT" primary button, reflecting the flow stage. When signed in, the badge tells
	// the truth about whether the subscription is actually serving (issue #259): a plain green affirmation
	// ONLY when ChatGPT answered the last call; otherwise the honest signed-in-but-falling-back badge below.
	const signedInBadge = signedInButFallenBack
		? `<div style="display:flex;flex-direction:column;gap:8px">
				<div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
					<span style="font:600 13px/1.3 system-ui;color:#9a6b16;display:flex;align-items:center;gap:7px"><span style="width:8px;height:8px;border-radius:50%;background:#e0a63a;flex:none"></span>${esc(localize('livingDocs.settings.signedInFallback', "Signed in to ChatGPT, but calls are currently served by {0}", fallbackDoorName))}</span>
					<button data-msg="signOutChatGpt" style="border:1px solid #e0e2e8;background:#fff;border-radius:9px;padding:9px 15px;font:600 12.5px/1 system-ui;color:#52575f;cursor:pointer">${esc(localize('livingDocs.settings.signOut', "Sign Out"))}</button>
				</div>
				<details data-signin-why style="margin-top:2px">
					<summary style="list-style:none;cursor:pointer;font:600 12px/1 system-ui;color:${ACCENT};display:inline-flex;align-items:center;gap:6px">${esc(localize('livingDocs.settings.seeWhy', "See why"))}<span style="font-size:11px">&#9662;</span></summary>
					<p style="margin:9px 0 0;font:400 12.5px/1.6 system-ui;color:#696e78;background:#fbf7ee;border:1px solid #f0e5cf;border-radius:9px;padding:11px 13px">${esc(localize('livingDocs.settings.fallbackWhy', "Your ChatGPT sign-in worked, but Abstract can't yet complete model calls through your ChatGPT plan, so it's falling back to the included model for now. Your work still gets done; we're fixing the ChatGPT path. You stay signed in."))}</p>
				</details>
			</div>`
		: `<div style="display:flex;align-items:center;gap:12px">
				<span style="font:600 13px/1 system-ui;color:oklch(0.5 0.13 150);display:flex;align-items:center;gap:7px"><span style="width:8px;height:8px;border-radius:50%;background:oklch(0.6 0.13 150)"></span>${esc(localize('livingDocs.settings.signedIn', "Signed in to ChatGPT"))}</span>
				<button data-msg="signOutChatGpt" style="border:1px solid #e0e2e8;background:#fff;border-radius:9px;padding:9px 15px;font:600 12.5px/1 system-ui;color:#52575f;cursor:pointer">${esc(localize('livingDocs.settings.signOut', "Sign Out"))}</button>
			</div>`;
	const signInBtn = stage === 'signed-in'
		? signedInBadge
		: stage === 'pending'
			? pendingSignInBlock(state.signInAuthorizeUrl)
			: `<button data-msg="signInChatGpt" style="border:none;border-radius:10px;padding:13px 22px;background:${ACCENT};color:#fff;font:600 14px/1 system-ui;cursor:pointer">${esc(localize('livingDocs.settings.signInChatGpt', "Sign in with ChatGPT"))}</button>`;

	const signInError = stage === 'error' && state.signInError
		? `<p style="margin:12px 0 0;font:400 12.5px/1.5 system-ui;color:#b4332f">${esc(state.signInError)}</p>`
		: '';

	// The survey: three plain-words questions. Recorded once; a thank-you replaces the form after saving.
	const surveyBody = state.surveySaved
		? `<div style="display:flex;align-items:center;gap:10px;font:500 13px/1.4 system-ui;color:oklch(0.5 0.13 150)"><span style="width:8px;height:8px;border-radius:50%;background:oklch(0.6 0.13 150)"></span>Thanks &mdash; that helps us build the right templates first.</div>`
		: `<div data-survey style="display:flex;flex-direction:column;gap:16px">
				<div><label style="display:block;font:600 12px/1 system-ui;color:#52575f;margin:0 0 7px">Which frontier model is your daily driver?</label>
					<input data-sfield="daily" placeholder="ChatGPT, Claude, Gemini&hellip;" style="width:100%;border:1px solid #dfe1e7;border-radius:9px;padding:11px 12px;font:400 13.5px/1.3 system-ui;color:#1a1c20;outline:none"></div>
				<div><label style="display:block;font:600 12px/1 system-ui;color:#52575f;margin:0 0 7px">Which subscriptions do you own?</label>
					<input data-sfield="subs" placeholder="ChatGPT Plus, Claude Pro&hellip;" style="width:100%;border:1px solid #dfe1e7;border-radius:9px;padding:11px 12px;font:400 13.5px/1.3 system-ui;color:#1a1c20;outline:none"></div>
				<div><label style="display:block;font:600 12px/1 system-ui;color:#52575f;margin:0 0 7px">What do you make each week?</label>
					<input data-sfield="weekly" placeholder="Reports, briefs, proposals&hellip;" style="width:100%;border:1px solid #dfe1e7;border-radius:9px;padding:11px 12px;font:400 13.5px/1.3 system-ui;color:#1a1c20;outline:none"></div>
				<button data-survey-save style="align-self:flex-start;border:1px solid #d4d7dd;background:#fff;border-radius:9px;padding:10px 17px;font:600 12.5px/1 system-ui;color:#52575f;cursor:pointer">Save</button>
			</div>`;

	return `<div class="screen">
		<div class="scr-head"><div><h1 class="scr-title">Model access</h1><div class="scr-sub">how your work gets its intelligence</div></div></div>
		<div class="scr-body"><div style="max-width:720px;margin:0 auto;padding:32px 28px 60px">

			<div style="background:#fff;border:1px solid #e9eaee;border-radius:16px;padding:24px 26px;margin-bottom:22px">
				<div style="display:flex;align-items:center;gap:9px;margin-bottom:4px"><span style="width:8px;height:8px;border-radius:50%;background:${dot}"></span><span style="font:600 12px/1 system-ui;color:#696e78">Serving you now</span></div>
				<div style="font:600 17px/1.3 system-ui;color:#15171c;margin:0 0 20px">${esc(doorLabel)}</div>

				<div style="font:600 12px/1 system-ui;color:#52575f;margin:0 0 10px">Sign in with your own subscription</div>
				<p style="margin:0 0 14px;font:400 13px/1.55 system-ui;color:#696e78">Use your own ChatGPT plan and every model call in Abstract draws on it &mdash; nothing to set up, no usage limit from us.</p>
				${signInBtn}
				${signInError}

				<div style="font:600 12px/1 system-ui;color:#52575f;margin:22px 0 10px;padding-top:18px;border-top:1px solid #f1f2f5">Or use the included model</div>
				<p style="margin:0 0 14px;font:400 13px/1.55 system-ui;color:#696e78">A capable model we include for free, with a small amount of usage each day. It pauses politely when the day&#39;s usage is spent and picks up again tomorrow.</p>
				<button data-msg="useIncludedModel" style="border:1px solid #d4d7dd;background:#fff;border-radius:10px;padding:11px 18px;font:600 13px/1 system-ui;color:#52575f;cursor:pointer">Use the included model</button>
				${usageBlock}
			</div>

			<div style="background:#fff;border:1px solid #e9eaee;border-radius:16px;padding:24px 26px;margin-bottom:22px">
				<div style="font:600 16px/1.3 system-ui;color:#15171c;margin:0 0 5px">A few quick questions</div>
				<p style="margin:0 0 20px;font:400 13px/1.55 system-ui;color:#696e78">This helps us build the right things first. Your answers stay on your computer.</p>
				${surveyBody}
			</div>

			${dataFlowCard(state.analyticsEnabled === true)}

		</div></div>
	</div>`;
}

// A calm, small "What does Abstract send?" section on the Model access screen (issue #135). It is the
// in-product home of the plain-words data-flow one-pager (docs/27): a single expandable row that shows
// the answer inline on click - no new panel, no navigation. The copy is a short, faithful retelling of
// docs/27 and every line traces to a real code path (model calls go through the localhost proxy in
// scripts/lwd-model-broker.js; chats/runs send the open/selected documents + attached sources -
// livingDocsService.ts _chatRespond/_chatRespondMulti; the default-enabled scheduled agents
// (agentOrchestrator.ts defaultAgents) may send a checked document's changed sentences + context files
// through the verify gate's strategy grader - livingDocsService.ts _runFiguresByPolicy/_gradeStrategy;
// the sign-in + keys live only in the proxy). Plain words per P5: no "OAuth", no "token", no "rate
// limit". The full page carries the provider-retention detail and the founder-review notes.
function dataFlowCard(analyticsEnabled: boolean): string {
	const line = (text: string) => `<li style="margin:0 0 9px;font:400 13px/1.55 system-ui;color:#52575f">${text}</li>`;
	return `<div style="background:#fff;border:1px solid #e9eaee;border-radius:16px;padding:6px 26px">
		<details data-dataflow>
			<summary style="list-style:none;cursor:pointer;display:flex;align-items:center;gap:10px;padding:18px 0;font:600 14px/1.3 system-ui;color:#15171c">
				<span style="width:22px;height:22px;flex:none;border-radius:7px;background:#f4f5fd;border:1px solid #e0e5fb;color:${ACCENT};display:flex;align-items:center;justify-content:center;font-size:12px">&#128274;</span>
				<span style="flex:1">What does Abstract send?</span>
				<span style="color:#a3a8b2;font-size:12px">&#9662;</span>
			</summary>
			<div style="padding:2px 0 22px">
				<p style="margin:0 0 14px;font:400 13px/1.6 system-ui;color:#696e78">Abstract sends content only when you ask it to work &mdash; or when an agent you have left running does its scheduled check. Here is exactly what is sent, and what never is.</p>
				<ul style="margin:0 0 14px;padding-left:20px">
					${line('When you <strong>chat about a document</strong>, Abstract sends that one open document and the source files you attached to it &mdash; nothing else in your folder.')}
					${line('When you <strong>run one instruction across your project</strong>, it sends only the documents you selected for that run and their shared sources.')}
					${line('Three <strong>built-in agents run on their own</strong> &mdash; when a source file changes, every six hours, and on Monday mornings. When a document&#39;s figures need updating, the double-check may send that document&#39;s changed sentences and its attached context files. Pause any agent on the Agents screen to stop this.')}
					${line('Model calls go through your own <strong>ChatGPT sign-in</strong>, or the <strong>included model</strong> when you are not signed in. Your sign-in stays on this computer &mdash; the app never sees it.')}
					${line('<strong>Files that are not documents, attached sources, or @-mentions &mdash; and your edit history &mdash; stay on your computer.</strong> A folder listing is never sent.')}
					${line('<strong>Usage analytics is on by default and you can turn it off here any time</strong> &mdash; it stays on this computer, counts your actions, never your words, and forwarding it anywhere is not built yet.')}
				</ul>
				${analyticsConsentRow(analyticsEnabled)}
				<p style="margin:0;font:400 12.5px/1.5 system-ui;color:#a3a8b2">The full plain-words page: <span style="font:500 12.5px/1.5 ui-monospace,monospace;color:#696e78">docs/27-data-flow-one-pager.md</span></p>
			</div>
		</details>
	</div>`;
}

// The revocable analytics consent control (plan 36 / issue #134), living right beside the data-flow copy that
// explains it. It reflects and flips the `abstract.analytics.enabled` setting through the host (data-msg), so
// this row, the first-run moment and the Settings toggle are all the same one choice. Off is total: with it
// off, IAnalyticsService captures nothing, so not a single event line is written.
function analyticsConsentRow(enabled: boolean): string {
	const on = enabled === true;
	const state = on ? 'On &mdash; counting your actions locally' : 'Off &mdash; nothing is counted';
	const btnLabel = on ? 'Turn off' : 'Turn on';
	const btnArg = on ? 'off' : 'on';
	const dot = on ? ACCENT : '#a3a8b2';
	return `<div style="display:flex;align-items:center;gap:12px;margin:0 0 14px;padding:13px 15px;background:#f7f8fb;border:1px solid #eceef3;border-radius:12px">
		<span style="width:8px;height:8px;flex:none;border-radius:50%;background:${dot}"></span>
		<div style="flex:1">
			<div style="font:600 12.5px/1.3 system-ui;color:#15171c">Anonymous usage analytics</div>
			<div style="font:400 12px/1.4 system-ui;color:#696e78">${state}. Change it any time.</div>
		</div>
		<button data-msg="setAnalyticsConsent" data-arg="${btnArg}" style="flex:none;border:1px solid #d4d7dd;background:#fff;border-radius:9px;padding:8px 15px;font:600 12.5px/1 system-ui;color:#52575f;cursor:pointer">${btnLabel}</button>
	</div>`;
}

// The D26 onboarding surface (doc 20 section D26): the guided two-wow, ten-minute, no-setup flow. It does NOT
// rebuild review machinery (doc 20: "built on the composed golden paths of 1e/1f/1h/1p") - each step drives the
// EXISTING engine (generate the demo, peek provenance in the editor, prompt one iteration through chat, approve
// in Review, open a folder) and records the matching `onboarding_step` funnel event. The card reflects where the
// user is; the wows are experienced in the document editor + Review rail this screen sends them to.
export function renderOnboarding(state: IScreenState): string {
	const ob = state.onboarding ?? { step: 'open' as OnboardingStep, consentEnabled: false, consentChosen: false, hasModel: false, demoGenerated: false };
	const idx = onboardingStepIndex(ob.step);
	const total = ONBOARDING_STEPS.length;

	// The funnel progress rail: a labelled dot per step, the current one filled, past ones ticked.
	const railLabels: Record<OnboardingStep, string> = {
		'open': localize('livingDocs.onboarding.rail.start', "Start"), 'demo-report': localize('livingDocs.onboarding.rail.demo', "Demo"), 'provenance-peek': localize('livingDocs.onboarding.rail.wowOne', "Wow 1"), 'first-diff': localize('livingDocs.onboarding.rail.wowTwo', "Wow 2"),
		'first-approve-sample': localize('livingDocs.onboarding.rail.approve', "Approve"), 'first-folder': localize('livingDocs.onboarding.rail.folder', "Your Folder"), 'first-approve-own': localize('livingDocs.onboarding.rail.aha', "Aha"),
	};
	const rail = ONBOARDING_STEPS.map((s, i) => {
		const done = i < idx;
		const cur = i === idx;
		const bg = done ? 'oklch(0.6 0.13 150)' : cur ? ACCENT : '#e4e6ea';
		const fg = (done || cur) ? '#fff' : '#9aa0aa';
		const mark = done ? '&#10003;' : String(i + 1);
		return `<div style="display:flex;flex-direction:column;align-items:center;gap:6px;flex:1;min-width:0">
			<span style="width:26px;height:26px;border-radius:50%;background:${bg};color:${fg};display:flex;align-items:center;justify-content:center;font:600 12px/1 system-ui">${mark}</span>
			<span style="font:${cur ? '600' : '500'} 10.5px/1.2 system-ui;color:${cur ? '#1a1c20' : '#9aa0aa'};text-align:center">${railLabels[s]}</span>
		</div>`;
	}).join('<div style="height:1px;background:#e4e6ea;flex:none;width:14px;margin-top:13px"></div>');

	const btn = (label: string, msg: string, primary: boolean) => primary
		? `<button data-msg="${msg}" style="border:none;border-radius:10px;padding:13px 22px;background:${ACCENT};color:#fff;font:600 14px/1 system-ui;cursor:pointer">${esc(label)}</button>`
		: `<button data-msg="${msg}" style="border:1px solid #d4d7dd;background:#fff;border-radius:10px;padding:12px 18px;font:600 13px/1 system-ui;color:#52575f;cursor:pointer">${esc(label)}</button>`;

	const wowBadge = (n: number) => `<span style="display:inline-flex;align-items:center;gap:6px;background:#fdf2dc;border:1px solid #f0dcae;border-radius:999px;padding:4px 11px;font:700 11px/1 system-ui;color:#9a6b16;margin-bottom:14px">&#10022; ${localize('livingDocs.onboarding.wowBadge', "Wow moment {0}", n)}</span>`;

	// The consent line, reflecting the choice already made at the consent moment (reused, not rebuilt).
	const consentLine = ob.consentEnabled
		? `<span style="color:oklch(0.5 0.13 150)"><span style="width:7px;height:7px;border-radius:50%;background:oklch(0.6 0.13 150);display:inline-block;margin-right:7px"></span>${localize('livingDocs.onboarding.analyticsOn', "Analytics on - we count actions, never your words. Document content never leaves your machine.")}</span>`
		: `<span style="color:#868b95"><span style="width:7px;height:7px;border-radius:50%;background:#cdd1d8;display:inline-block;margin-right:7px"></span>${localize('livingDocs.onboarding.analyticsOff', "Analytics off - onboarding still works, it just isn't measured. Turn it on any time in Model Access.")}</span>`;
	const consentCard = `<div style="margin-top:22px;padding-top:18px;border-top:1px solid #f1f2f5;font:400 12.5px/1.6 system-ui">${consentLine}</div>`;

	const noModel = !ob.hasModel
		? `<p style="margin:14px 0 0;font:400 12.5px/1.5 system-ui;color:#9a6b16;background:#fdf2dc;border:1px solid #f0dcae;border-radius:9px;padding:10px 13px">${localize('livingDocs.onboarding.noModel.prefix', "No model is connected yet.")} <a data-msg="onbModelAccess" style="color:${ACCENT};cursor:pointer;text-decoration:underline">${localize('livingDocs.onboarding.noModel.link', "Connect One in Model Access")}</a> ${localize('livingDocs.onboarding.noModel.suffix', "so the prompted edit can run - the demo report and its provenance still work without it.")}</p>`
		: '';

	// Per-step card content. Each primary action drives the real engine + records the funnel step.
	let head = '';
	let body = '';
	let actions = '';
	let badge = '';
	switch (ob.step) {
		case 'open':
			head = localize('livingDocs.onboarding.open.head', "Two Wows, Ten Minutes, No Setup");
			body = localize('livingDocs.onboarding.open.body', "Abstract keeps your documents bound to their sources, so numbers stay true and edits are reviewed. In the next few minutes we'll show you the magic twice - with nothing to set up. We start from a demo report generated from a bundled dataset.");
			actions = btn(localize('livingDocs.onboarding.open.primary', "See It Work"), 'onbSeeItWork', true) + btn(localize('livingDocs.onboarding.open.secondary', "Model Access & a Few Questions"), 'onbModelAccess', false);
			break;
		case 'demo-report':
			head = localize('livingDocs.onboarding.demo.head', "Your Demo Report Is Ready");
			body = localize('livingDocs.onboarding.demo.body', "We generated a <strong>Demo Report</strong> from a bundled dataset in your open folder. Its figures are bound to that data. Let's see the first wow.");
			actions = btn(localize('livingDocs.onboarding.demo.primary', "Show Me the First Wow"), 'onbAdvance', true) + btn(localize('livingDocs.onboarding.openDemo', "Open the Demo Report"), 'onbOpenDemo', false);
			break;
		case 'provenance-peek':
			badge = wowBadge(1);
			head = localize('livingDocs.onboarding.peek.head', "See Where Every Number Comes From");
			body = localize('livingDocs.onboarding.peek.body', "In the Demo Report, hover the <strong>$48.6k</strong> figure (or any bound number). Abstract shows a peek: its <strong>source</strong>, its <strong>value</strong>, and <strong>when it synced</strong> - so you never wonder where a figure came from or whether it's stale.");
			actions = btn(localize('livingDocs.onboarding.peek.primary', "I Saw Where It Came From"), 'onbAdvance', true) + btn(localize('livingDocs.onboarding.openDemo', "Open the Demo Report"), 'onbOpenDemo', false);
			break;
		case 'first-diff':
			badge = wowBadge(2);
			head = localize('livingDocs.onboarding.diff.head', "Ask for One Change, Get One Clean Diff");
			body = localize('livingDocs.onboarding.diff.body', "Now ask Abstract to improve a paragraph. We'll ask it to <strong>tighten the note to the board</strong>. A single inline <span style=\"color:#b4332f\">red</span>/<span style=\"color:#1f7a44\">green</span> diff streams into that exact paragraph - nothing else moves, and nothing changes until you approve.");
			actions = btn(localize('livingDocs.onboarding.diff.primary', "Prompt One Edit"), 'onbPromptEdit', true) + btn(localize('livingDocs.onboarding.openDemo', "Open the Demo Report"), 'onbOpenDemo', false);
			body += noModel;
			break;
		case 'first-approve-sample':
			head = localize('livingDocs.onboarding.approveSample.head', "Approve It - and It's Saved");
			body = localize('livingDocs.onboarding.approveSample.body', "Open the <strong>Review</strong> panel on the right and approve the single proposal. It applies to the paragraph and is recorded as a version in <strong>History</strong> you can restore. On the web build a reload is ephemeral; on desktop the approved version persists (the X1 cure).");
			actions = btn(localize('livingDocs.onboarding.approveSample.primary', "I Approved It"), 'onbAdvance', true) + btn(localize('livingDocs.onboarding.openDemo', "Open the Demo Report"), 'onbOpenDemo', false);
			break;
		case 'first-folder':
			head = localize('livingDocs.onboarding.folder.head', "Now Bring Your Own Work");
			body = localize('livingDocs.onboarding.folder.body', "That was the sample. The moment Abstract is built for is the first change you approve on <strong>your own file</strong>. Open a real folder to make it live - you keep everything you just learned.");
			actions = btn(localize('livingDocs.onboarding.folder.primary', "Bring a Real Folder"), 'onbOpenFolder', true);
			break;
		case 'first-approve-own':
			head = localize('livingDocs.onboarding.done.head', "You're All Set");
			body = localize('livingDocs.onboarding.done.body', "Open one of your documents, ask for a change, and approve it - that first approved change on your own file is the aha this whole flow was for. You can revisit this walkthrough any time from the command palette.");
			actions = btn(localize('livingDocs.onboarding.done.primary', "Go to Home"), 'onbDone', true);
			break;
	}

	return `<div class="screen">
		<div class="scr-head"><div><h1 class="scr-title">${localize('livingDocs.onboarding.title', "Welcome to Abstract")}</h1><div class="scr-sub">${localize('livingDocs.onboarding.subtitle', "the two-wow, ten-minute path")}</div></div></div>
		<div class="scr-body"><div style="max-width:720px;margin:0 auto;padding:30px 28px 60px">
			<div style="display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:30px">${rail}</div>
			<div style="background:#fff;border:1px solid #e9eaee;border-radius:16px;padding:28px 30px">
				${badge}
				<h2 style="margin:0 0 12px;font:600 21px/1.3 system-ui;color:#15171c">${head}</h2>
				<p style="margin:0 0 22px;font:400 14.5px/1.65 system-ui;color:#4a4f57">${body}</p>
				<div style="display:flex;gap:12px;flex-wrap:wrap">${actions}</div>
				${ob.step === 'open' ? consentCard : ''}
			</div>
			<p style="margin:18px 2px 0;font:400 12px/1.5 system-ui;color:#a3a8b2">${localize('livingDocs.onboarding.progress', "Step {0} of {1} - you can leave and come back - onboarding remembers where you were.", idx + 1, total)}</p>
		</div></div>
	</div>`;
}

export function renderProjectRun(state: IScreenState): string {
	const run = state.projectRun;
	const folderName = state.folderName ?? 'Project';
	const projectAv = avatar(folderName);

	// The 48px run topbar: navy project avatar + name crumb + `Agent run` label + a Live pulse pill
	// only while the fan-out is genuinely in flight (isChatBusy). A stopped run shows a calm "Stopped" pill
	// (plan 27 iter 4) instead; no live/stopped run => no pill.
	const livePill = run?.inFlight
		? `<span style="display:inline-flex;align-items:center;gap:6px;background:#f4f5fd;border:1px solid #e0e5fb;border-radius:999px;padding:3px 10px;font:600 11.5px/1 system-ui;color:#4650b8"><span style="width:6px;height:6px;border-radius:50%;background:${ACCENT};animation:lwdPulse 1.6s ease-in-out infinite"></span>Live</span>`
		: run?.paused
			? `<span style="display:inline-flex;align-items:center;gap:6px;background:#fdf6e9;border:1px solid #f0e2c4;border-radius:999px;padding:3px 10px;font:600 11.5px/1 system-ui;color:#9a6b16"><span style="width:6px;height:6px;border-radius:50%;background:#d9a62b"></span>Paused</span>`
			: run?.stopped
				? `<span style="display:inline-flex;align-items:center;gap:6px;background:#f6f7f9;border:1px solid #e6e8ec;border-radius:999px;padding:3px 10px;font:600 11.5px/1 system-ui;color:#868b95"><span style="width:6px;height:6px;border-radius:50%;background:#b4332f"></span>Stopped</span>`
				: '';
	const runTopBar = `<div style="height:48px;flex:none;display:flex;align-items:center;gap:12px;padding:0 18px;border-bottom:1px solid #e9eaee;background:#fbfbfc">
		<span style="width:20px;height:20px;border-radius:6px;background:#3b4d8f;display:flex;align-items:center;justify-content:center;color:#fff;font:600 10px/1 system-ui">${projectAv.text}</span>
		<span style="font:600 13px/1 system-ui;color:#1a1c20">${esc(folderName)}</span><span style="color:#cfd3da">/</span>
		<span style="display:inline-flex;align-items:center;gap:7px;font:500 13px/1 system-ui;color:#5661c9">&#10022; Agent run</span>
		${livePill}
	</div>`;

	// The command strip (C4): 32px accent avatar + the instruction in reading type + the attached
	// source chip + a `Whole project` pill. When there is a live/last run, show its REAL instruction
	// + source; otherwise the strip reflects the idle state with a calm prompt (no fabricated ISMS copy).
	const sourceChip = run?.source
		? `<span style="font:500 12.5px/1 'JetBrains Mono',ui-monospace,monospace;color:#4650b8;background:#f4f5fd;border:1px solid #e0e5fb;border-radius:6px;padding:2px 8px">${esc(run.source)}</span>`
		: '';
	const instruction = run?.instruction
		? `${sourceChip ? 'From ' + sourceChip + ', ' : ''}&ldquo;${esc(run.instruction)}&rdquo;`
		: 'No project run in progress. Start one from Agents or ask across the whole project in Chat.';
	const instructionColor = run?.instruction ? '#26292f' : '#868b95';
	// A Stop run control while the fan-out is in flight (plan 27 iter 4): cancels the whole-project model
	// call; docs that never settled a change are marked skipped honestly. Only shown while genuinely live.
	const stopRun = run?.inFlight
		? `<button data-msg="stopProjectRun" style="flex:none;display:inline-flex;align-items:center;gap:7px;font:600 12.5px/1 system-ui;color:#b4332f;background:#fff;border:1px solid #e7c9c6;border-radius:8px;padding:8px 14px;cursor:pointer"><span style="width:9px;height:9px;border-radius:2px;background:#b4332f"></span>Stop run</button>`
		: '';
	// The batch chip (plan 30, track 3, D30-B): the fan-out packs the working set into context-bounded
	// batches; when a run spans more than one batch the strip reports `Batch K of M` so the user sees the
	// run proceeding in batches rather than stalling on a large folder. Shown only for a live multi-batch
	// run (index > 0, count > 1); a single-batch run shows nothing extra (the common small-scale case).
	const batch = run?.batch;
	const batchChip = batch && batch.count > 1 && batch.index > 0
		? `<span style="flex:none;font:600 12.5px/1 'JetBrains Mono',ui-monospace,monospace;color:#4650b8;background:#f4f5fd;border:1px solid #e0e5fb;border-radius:8px;padding:7px 12px">Batch ${batch.index} of ${batch.count}</span>`
		: '';
	const commandStrip = `<div style="flex:none;padding:18px 28px;border-bottom:1px solid #eef0f3;display:flex;align-items:center;gap:16px">
		<span style="width:32px;height:32px;border-radius:50%;background:${ACCENT};color:#fff;display:flex;align-items:center;justify-content:center;font:600 12px/1 system-ui;flex:none">TS</span>
		<div style="flex:1;font:400 18px/1.4 system-ui;color:${instructionColor}">${instruction}</div>
		${batchChip}
		${stopRun}
		<span style="flex:none;font:600 12.5px/1 system-ui;color:#fff;background:${ACCENT};border-radius:8px;padding:8px 14px">Whole Project</span>
	</div>`;

	// Truthful idle body (guardrail): no fabricated numbers, shown only when no run has started.
	const idleBody = `<div style="flex:1;overflow:auto;background:#f8f9fb;display:flex;align-items:center;justify-content:center;padding:40px">
		<div style="text-align:center;max-width:460px">
			<div style="width:44px;height:44px;margin:0 auto 16px;border-radius:12px;background:#f4f5fd;border:1px solid #e0e5fb;display:flex;align-items:center;justify-content:center;font-size:20px;color:${ACCENT}">&#10022;</div>
			<h2 style="margin:0 0 10px;font:600 18px/1.3 system-ui;color:#1a1c20">No project run in progress</h2>
			<p style="margin:0 0 22px;font:400 14px/1.6 system-ui;color:#696e78">Start one from Agents or ask across the whole project in Chat. The sub-agent swarm and the decisions the agent understands will appear here as the run proceeds.</p>
			<button data-msg="goAgents" style="border:none;border-radius:10px;padding:11px 20px;background:${ACCENT};color:#fff;font:600 13px/1 system-ui;cursor:pointer">Go to Agents</button>
		</div>
	</div>`;

	// The live fan-out body (C4): the decisions-understood rail (a truthful 23.4 placeholder for now)
	// on the left, and the sub-agent swarm grid + progress bar on the right - all from REAL run data.
	const summary = run?.summary;
	const workingSet = new Set(run?.working ?? []);
	const runBody = summary
		? `<div style="flex:1;display:flex;overflow:hidden;min-height:0">
		${decisionsRail(run?.decisions ?? [], run?.source, !!run?.inFlight)}
		${swarmPane(summary, workingSet, !!run?.stopped, !!run?.paused)}
	</div>`
		: idleBody;

	// Bottom-bar totals. When a run is active they read from the REAL summary (`summariseProjectRun`) +
	// the live working count; idle shows honest zeros. The primary "Review across the project" opens the
	// cross-document review screen (C5) on the first changed doc - handled by `reviewProject` in screenEditor.
	const changed = summary?.totalChanges ?? 0;
	const changedDocs = summary?.changedDocs ?? 0;
	const workingCount = summary ? workingSet.size : 0;
	// Unchanged = documents that have settled with no change. While the run is live, a working tile has
	// not settled yet, so it is not counted as unchanged; the selector's unchangedDocs includes them, so
	// subtract the live working count to keep the buckets (changed + working + unchanged + skipped) truthful.
	const unchangedDocs = summary ? Math.max(0, summary.unchangedDocs - workingCount) : 0;
	// A stopped run's not-yet-changed docs are skipped, not unchanged (plan 27 iter 4) - reported honestly.
	const skippedDocs = summary?.skippedDocs ?? 0;
	// Documents too large for the fan-out budget (plan 30, track 3) are reported as their own honest bucket.
	const oversizeDocs = summary?.oversizeDocs ?? 0;
	// Documents the model could not be reached for (F14, issue #123) are their own honest bucket - NEVER folded
	// into "unchanged", so a model outage can never read as a silent all-clear on the run's bottom bar.
	const failedDocs = summary?.failedDocs ?? 0;
	const numeral = (n: number) => `<strong style="font:500 20px/1 system-ui;color:#14161a">${n}</strong>`;
	const tailParts = [`&middot; ${workingCount} working`, `&middot; ${unchangedDocs} unchanged`];
	if (skippedDocs) { tailParts.push(`&middot; ${skippedDocs} skipped`); }
	if (oversizeDocs) { tailParts.push(`&middot; ${oversizeDocs} too large`); }
	if (failedDocs) { tailParts.push(`&middot; <span style="color:#9a6b16">${failedDocs} failed</span>`); }
	const tail = tailParts.join(' ');
	// The lead line stays honest under a model outage: when documents failed and nothing was proposed, it names
	// the model as unreachable (F14) instead of the false "0 changes proposed in 0 documents" all-clear.
	const lead = failedDocs > 0 && changed === 0
		? `<span style="font:400 14px/1 system-ui;color:#9a6b16">The agent model is not reachable &mdash; ${numeral(failedDocs)} documents could not be processed</span>`
		: `<span style="font:400 14px/1 system-ui;color:#3a3f49">${numeral(changed)} changes proposed in ${numeral(changedDocs)} documents</span>`;
	const bottomBar = `<div style="flex:none;height:66px;border-top:1px solid #eef0f3;background:#fbfbfc;display:flex;align-items:center;padding:0 28px;gap:18px">
		${lead}
		<span style="font:400 13px/1 system-ui;color:#a3a8b2">${tail}</span>
		<button data-msg="reviewProject" style="margin-left:auto;font:600 14px/1 system-ui;color:#fff;background:${ACCENT};border:none;border-radius:10px;padding:12px 22px;cursor:pointer">Review Across the Project &#8594;</button>
	</div>`;

	return `<div class="screen">${runTopBar}${commandStrip}${runBody}${bottomBar}</div>`;
}

// The left "decisions understood" rail (360px, C4 left column, plan 23.4). One card per decision the
// agent extracted, grouped from the REAL pending changes by their source grounding (`groupDecisions`).
// Each card shows the decision (the verbatim source quote in reading type), a source chip
// (`transcript . line N`, mono - the line is OMITTED when unknown so nothing is fabricated) and
// `-> N documents affected` (distinct docs sharing that decision). When the run is still in flight and
// nothing has grounded yet, a calm reading state; when a run produced changes but the model gave no
// grounding, the cards degrade honestly (grouped by rationale, no line chip).
function decisionsRail(decisions: readonly IDecisionGroup[], source: string | undefined, inFlight: boolean): string {
	// The source label for the chip: the attached source name (e.g. `Security Review - 3 Mar.txt`),
	// else the neutral `transcript`. Kept short so the mono chip does not wrap.
	const sourceName = source ? esc(source) : 'transcript';
	// Header carries a count when decisions exist ("6 decisions understood"), matching the comp's
	// "N decisions understood"; the idle/empty state keeps the bare label.
	const count = decisions.length;
	const headerLabel = count ? `${count} ${count === 1 ? 'decision' : 'decisions'} understood` : 'Decisions understood';
	const header = `<div style="font:600 10px/1 'JetBrains Mono',ui-monospace,monospace;letter-spacing:.12em;text-transform:uppercase;color:#5661c9;margin-bottom:16px">${headerLabel}</div>`;
	const shell = (body: string) => `<div style="width:360px;flex:none;border-right:1px solid #eef0f3;background:#fafbfc;padding:22px;overflow:hidden;display:flex;flex-direction:column">${header}${body}</div>`;

	if (!decisions.length) {
		const message = inFlight
			? 'Reading the source and extracting the decisions across the project&hellip;'
			: 'No decisions were grounded in the source for this run.';
		return shell(`<div style="flex:1;display:flex;align-items:center;justify-content:center;text-align:center;color:#a3a8b2">
			<p style="margin:0;font:400 13px/1.6 system-ui;max-width:240px">${message}</p>
		</div>`);
	}

	// One card per decision, matching the comp's structure: the source chip on top (`transcript .
	// line N`, mono), then the decision in reading type, then `-> N documents affected` in accent. The
	// line clause and whole chip are dropped when the decision has no verified line / grounding (the
	// honest degrade) - never a fabricated line. Reading type stays UI sans per handoff Part B/F
	// (decision 4b: the handoff wins over the comp's Newsreader serif - a deliberate, logged departure).
	const cards = decisions.map(d => {
		const chip = d.grounded
			? `<div style="font:400 11px/1 'JetBrains Mono',ui-monospace,monospace;color:#5661c9;margin-bottom:7px">${sourceName}${typeof d.sourceLine === 'number' ? ` &middot; line ${d.sourceLine}` : ''}</div>`
			: '';
		const docs = d.docsAffected;
		return `<div style="background:#fff;border:1px solid #e6e8ec;border-radius:13px;padding:15px 16px">
			${chip}
			<div style="font:400 15.5px/1.4 system-ui;color:#1a1c20;margin-bottom:10px">${esc(d.quote)}</div>
			<div style="font:600 12px/1 system-ui;color:#4650b8">&#8594; ${docs} ${docs === 1 ? 'document' : 'documents'} affected</div>
		</div>`;
	}).join('');
	return shell(`<div style="flex:1;overflow:auto;min-height:0;display:flex;flex-direction:column;gap:12px">${cards}</div>`);
}

// The right sub-agent swarm pane (C4): a progress header + bar, then a 4-column grid of one tile per
// project document. Every tile's status comes from the REAL run: `changed` (accent tint + check +
// `N changes`) from `summariseProjectRun`, `working` (spinner + `reviewing...`) layered on live while
// the fan-out is in flight, and settled `no-change` (muted `no change`). Nothing is fabricated.
function swarmPane(summary: IProjectRunSummary, working: ReadonlySet<string>, stopped = false, paused = false): string {
	const total = summary.tiles.length;
	// A document is "done" once it has settled - it is no longer in the live working set. Progress counts
	// settled docs (X) against the whole project (Y), matching the comp's "21 / 24 done".
	const done = summary.tiles.filter(t => !working.has(t.docId)).length;
	const pct = total > 0 ? Math.round((done / total) * 100) : 0;
	const busy = working.size > 0;
	// A stopped run reports honestly (plan 27 iter 4): how many settled with a change vs were skipped, not
	// "every document read" (which never happened). A live run and a fully-completed run keep their headings.
	// A PAUSED run (spent daily budget, map-D15 / F14 item 3) reads the calm plain-words pause - finished
	// proposals stay reviewable, not-yet-run docs are skipped, and it is neither a failure nor an all-clear.
	// A settled run where the model was unreachable for some documents (F14, issue #123) must NOT read
	// "every document read across the project" (a false all-clear); it names the outage honestly instead.
	const failedCount = summary.failedDocs;
	const heading = busy
		? `<span style="font:600 15px/1 system-ui;color:#1a1c20">Orchestrating ${total} sub-agents</span><span style="font:400 13px/1 system-ui;color:#a3a8b2">reading every document in parallel</span>`
		: paused
			? `<span style="font:600 15px/1 system-ui;color:#1a1c20">Run paused &mdash; today's included usage is spent</span><span style="font:400 13px/1 system-ui;color:#a3a8b2">${summary.changedDocs} of ${total} documents changed &middot; the rest resume tomorrow &middot; finished proposals are ready to review</span>`
			: stopped
				? `<span style="font:600 15px/1 system-ui;color:#1a1c20">Run stopped</span><span style="font:400 13px/1 system-ui;color:#a3a8b2">${summary.changedDocs} of ${total} documents changed before you stopped &middot; ${summary.skippedDocs} skipped</span>`
				: failedCount > 0
					? `<span style="font:600 15px/1 system-ui;color:#9a6b16">Model unreachable for ${failedCount} of ${total} documents</span><span style="font:400 13px/1 system-ui;color:#a3a8b2">${summary.changedDocs} changed &middot; ${failedCount} failed &mdash; retry the failed documents from Chat</span>`
					: `<span style="font:600 15px/1 system-ui;color:#1a1c20">${total} sub-agents finished</span><span style="font:400 13px/1 system-ui;color:#a3a8b2">every document read across the project</span>`;
	const progress = `<div style="display:flex;align-items:center;gap:12px;margin-bottom:14px">${heading}<span style="margin-left:auto;font:400 12px/1 'JetBrains Mono',ui-monospace,monospace;color:#52575f">${done} / ${total} done</span></div>
		<div style="height:5px;background:#e9eaee;border-radius:3px;margin-bottom:18px;overflow:hidden"><div style="width:${pct}%;height:100%;background:${ACCENT};border-radius:3px"></div></div>`;
	const tiles = summary.tiles.map(t => swarmTile(t.docId, t.docTitle, t.status, t.changeCount, working.has(t.docId))).join('');
	return `<div style="flex:1;overflow:hidden;padding:22px 28px;display:flex;flex-direction:column">
		${progress}
		<div style="flex:1;display:grid;grid-template-columns:repeat(4,1fr);grid-auto-rows:1fr;gap:9px;overflow:auto">${tiles}</div>
	</div>`;
}

// One document tile. The live `isWorking` overlay wins over the selector's changed/no-change status so
// an in-flight document reads as a spinning sub-agent even before its edits (if any) have landed.
function swarmTile(_docId: string, title: string, status: ProjectRunDocStatus, count: number, isWorking: boolean): string {
	const name = esc(title);
	const nameStyle = 'font:500 11.5px/1.2 system-ui;white-space:nowrap;overflow:hidden;text-overflow:ellipsis';
	if (isWorking || status === 'working') {
		return `<div style="background:#fff;border:1.5px solid #c9cff5;border-radius:10px;padding:10px 11px;display:flex;flex-direction:column;justify-content:space-between">
			<div style="display:flex;align-items:center;gap:6px"><span style="width:11px;height:11px;border:2px solid #c9cff5;border-top-color:${ACCENT};border-radius:50%;animation:lwdSpin .8s linear infinite;flex:none"></span><span style="${nameStyle};color:#26292f">${name}</span></div>
			<span style="font:400 10.5px/1 'JetBrains Mono',ui-monospace,monospace;color:#a3a8b2;font-style:italic">reviewing&hellip;</span>
		</div>`;
	}
	if (status === 'changed') {
		return `<div style="background:#f4f5fd;border:1px solid #e0e5fb;border-radius:10px;padding:10px 11px;display:flex;flex-direction:column;justify-content:space-between">
			<div style="display:flex;align-items:center;gap:6px"><span style="color:#2c8159;font-size:11px">&#10003;</span><span style="${nameStyle};color:#26292f">${name}</span></div>
			<span style="font:600 10.5px/1 'JetBrains Mono',ui-monospace,monospace;color:#4650b8">${count} ${count === 1 ? 'change' : 'changes'}</span>
		</div>`;
	}
	// A skipped tile (plan 27 iter 4): the run stopped before this document ran. A dashed border + honest
	// "skipped" label distinguishes it from a document that ran and settled with no change.
	if (status === 'skipped') {
		return `<div style="background:#fafbfc;border:1px dashed #dcdfe6;border-radius:10px;padding:10px 11px;display:flex;flex-direction:column;justify-content:space-between">
			<div style="display:flex;align-items:center;gap:6px"><span style="color:#b4332f;font-size:11px">&#9723;</span><span style="${nameStyle};color:#9a9ea7">${name}</span></div>
			<span style="font:600 10.5px/1 'JetBrains Mono',ui-monospace,monospace;color:#b0b4bc">skipped</span>
		</div>`;
	}
	// An oversize tile (plan 30, track 3, D30-B): the document is too large for the fan-out's context budget,
	// so it was NEVER sent - an amber border + a warning glyph + the honest "too large for this run" label
	// tells the user why it produced nothing, rather than a silent drop or a false "no change".
	if (status === 'oversize') {
		return `<div style="background:#fdf6ec;border:1px solid #f0d9a8;border-radius:10px;padding:10px 11px;display:flex;flex-direction:column;justify-content:space-between">
			<div style="display:flex;align-items:center;gap:6px"><span style="color:#9a6b16;font-size:11px">&#9888;</span><span style="${nameStyle};color:#7a5a13">${name}</span></div>
			<span style="font:600 10.5px/1 'JetBrains Mono',ui-monospace,monospace;color:#9a6b16">too large for this run</span>
		</div>`;
	}
	// A failed tile (F14, issue #123): the model could not be reached for this document during the run. A red
	// border + a warning glyph + the honest "model unreachable" label tells the user WHY it produced nothing,
	// so a model outage never reads as a silent "no change" all-clear. Retry from Chat re-runs just the failed docs.
	if (status === 'failed') {
		return `<div style="background:#fdf2f1;border:1px solid #ecc9c6;border-radius:10px;padding:10px 11px;display:flex;flex-direction:column;justify-content:space-between">
			<div style="display:flex;align-items:center;gap:6px"><span style="color:#b4332f;font-size:11px">&#9888;</span><span style="${nameStyle};color:#8a2f2b">${name}</span></div>
			<span style="font:600 10.5px/1 'JetBrains Mono',ui-monospace,monospace;color:#b4332f">model unreachable</span>
		</div>`;
	}
	return `<div style="background:#fafbfc;border:1px solid #eceef2;border-radius:10px;padding:10px 11px;display:flex;flex-direction:column;justify-content:space-between">
		<div style="display:flex;align-items:center;gap:6px"><span style="color:#cfd3da;font-size:12px">&middot;</span><span style="${nameStyle};color:#a3a8b2">${name}</span></div>
		<span style="font:400 10.5px/1 'JetBrains Mono',ui-monospace,monospace;color:#cfd3da">no change</span>
	</div>`;
}


// ---- Cross-document review (C5, plan 24). A SECOND presentation of the existing review model at
// project scale: the live pending changes (getAllPending) grouped by document. Left = a 292px doc-nav
// rail (count header + progress bar + one row per changed doc with a check "reviewed" / filled-dot
// "current" / hollow-dot "pending" glyph + count); centre = the current document's change cards, each
// showing the change in context, a `decision . line NN` source chip, and a filled-dot "High" / half-dot
// "Inferred" confidence chip (D24-A). Accept / Tweak / Reject per card and the sticky bar (Accept all here /
// Next / Accept all remaining) post messages the editor routes to the EXISTING engine
// (approve/reject/approveAll/approveAllPending); the C6 Review rail consumes the same model and stays in sync.
export function renderReviewProject(state: IScreenState): string {
	const rp = state.reviewProject;
	const pending = rp?.pending ?? [];
	const groups = groupPendingByDoc(pending);
	const folderName = rp?.folderName ?? 'Project';
	const projectAv = avatar(folderName);
	const reviewed = rp?.reviewedDocs ?? [];

	// The 48px topbar: project avatar + name crumb + `Review project update` + the attached source pill.
	// The right side reports the session totals from the reviewed set - honest zeros when nothing has been
	// reviewed yet. `Accept All Remaining` -> approveAllPending() (posts `reviewAcceptAllRemaining`); shown
	// only while something is still pending.
	const sourcePill = rp?.source
		? `<span style="font:500 11.5px/1 'JetBrains Mono',ui-monospace,monospace;color:#5661c9;background:#f4f5fd;border:1px solid #e0e5fb;border-radius:999px;padding:4px 10px">${esc(rp.source)}</span>`
		: '';
	const totalRemaining = pending.length;
	const acceptRemaining = totalRemaining
		? `<button data-msg="reviewAcceptAllRemaining" style="font:600 12.5px/1 system-ui;color:#5661c9;background:#fff;border:1px solid #d9d7fb;border-radius:9px;padding:7px 13px;cursor:pointer">Accept All Remaining (${totalRemaining})</button>`
		: '';
	const topBar = `<div style="height:48px;flex:none;display:flex;align-items:center;gap:12px;padding:0 18px;border-bottom:1px solid #e9eaee;background:#fbfbfc">
		<span style="width:20px;height:20px;border-radius:6px;background:#3b4d8f;display:flex;align-items:center;justify-content:center;color:#fff;font:600 10px/1 system-ui">${projectAv.text}</span>
		<span style="font:600 13px/1 system-ui;color:#1a1c20">${esc(folderName)}</span><span style="color:#cfd3da">/</span><span style="font:500 13px/1 system-ui;color:#868b95">Review project update</span>
		${sourcePill}
		<div style="margin-left:auto;display:flex;align-items:center;gap:12px"><span style="font:400 13px/1 system-ui;color:#a3a8b2">${reviewed.length} reviewed</span>${acceptRemaining}</div>
	</div>`;

	// The end-state: nothing pending. Honest copy - the celebratory "All changes reviewed" only when a
	// review actually happened this session (docs were actioned to zero); otherwise the calm idle state.
	if (!groups.length) {
		const didReview = reviewed.length > 0;
		const glyph = didReview ? '&#10003;' : '&#9679;';
		const heading = didReview ? 'All changes reviewed' : 'Nothing waiting';
		const body = didReview
			? `Every proposed change across ${reviewed.length} document${reviewed.length === 1 ? '' : 's'} has been actioned. Nothing is left to review.`
			: 'No changes are waiting across the project. Run an agent across the project to propose updates.';
		return `<div class="screen">${topBar}<div style="flex:1;display:flex;align-items:center;justify-content:center;background:#f8f9fb;padding:40px">
			<div style="text-align:center;max-width:420px">
				<div style="width:44px;height:44px;margin:0 auto 16px;border-radius:12px;background:#eef7f0;border:1px solid #d7ecdc;display:flex;align-items:center;justify-content:center;font-size:20px;color:#2c8159">${glyph}</div>
				<h2 style="margin:0 0 10px;font:600 18px/1.3 system-ui;color:#1a1c20">${heading}</h2>
				<p style="margin:0;font:400 14px/1.6 system-ui;color:#696e78">${body}</p>
			</div>
		</div></div>`;
	}

	// The current document = the selected doc if it still has changes, else the first changed doc. This
	// is local screen navigation (clicking a rail row posts `reviewDoc`), not an engine action.
	const current = groups.find(g => g.docId === rp?.currentDocId) ?? groups[0];
	const currentIndex = groups.findIndex(g => g.docId === current.docId);

	return `<div class="screen">${topBar}<div style="flex:1;display:flex;overflow:hidden;min-height:0">${reviewRail(groups, current.docId, reviewed)}${reviewColumn(current.changes, current.docId, current.docTitle, currentIndex, groups)}</div></div>`;
}

// The 292px doc-nav rail (C5): a header count `N docs . M changes`, a green progress bar (reviewed /
// total docs seen this session), then one row per document WITH pending changes. Each row carries a
// status glyph - check "reviewed" (a doc reviewed this session, now 0 pending - only ever appears once a
// doc empties, so in a fresh run every changed doc is hollow-dot "pending" or filled-dot "current"),
// filled-dot "current" (the selected doc, accent tint + 3px accent bar), hollow-dot "pending" (still has
// changes, not selected) - and its count.
function reviewRail(groups: readonly { docId: string; docTitle: string; changes: readonly IProposedChange[] }[], currentDocId: string, reviewed: readonly IReviewedDoc[]): string {
	const changeTotal = groups.reduce((n, g) => n + g.changes.length, 0);
	const docTotal = groups.length + reviewed.length;
	const reviewedCount = reviewed.length;
	const pct = docTotal > 0 ? Math.round((reviewedCount / docTotal) * 100) : 0;
	const header = `<div style="padding:17px 18px;border-bottom:1px solid #eef0f3">
		<div style="font:600 13px/1 system-ui;color:#1a1c20;margin-bottom:10px">${docTotal} document${docTotal === 1 ? '' : 's'} &middot; ${changeTotal} change${changeTotal === 1 ? '' : 's'}</div>
		<div style="height:5px;background:#e9eaee;border-radius:3px;overflow:hidden"><div style="width:${pct}%;height:100%;background:oklch(0.6 0.13 150);border-radius:3px"></div></div>
		<div style="font:400 11.5px/1 system-ui;color:#a3a8b2;margin-top:7px">${reviewedCount} of ${docTotal} reviewed</div>
	</div>`;

	// Reviewed docs (0 pending) come first as muted check rows showing the HUMAN title (not the docId URI),
	// then the still-pending docs. A reviewed doc has no changes left, so it is not in `groups` - it shows
	// here once the editor derives it (a seen doc, now zero pending) via `reviewedDocsFromSeen`.
	const reviewedRows = reviewed.map(r => `<div style="display:flex;align-items:center;gap:9px;padding:8px 10px">
		<span style="color:#2c8159;font-size:12px;width:13px;text-align:center">&#10003;</span>
		<span style="font:500 12px/1 system-ui;color:#a3a8b2;flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(r.title)}</span>
	</div>`).join('');

	const rows = groups.map(g => {
		const isCurrent = g.docId === currentDocId;
		const count = g.changes.length;
		if (isCurrent) {
			return `<div data-msg="reviewDoc" data-arg="${esc(g.docId)}" style="display:flex;align-items:center;gap:9px;padding:8px 10px;border-radius:8px;background:#eef0fb;border:1px solid #e0e5fb;position:relative;cursor:pointer">
				<span style="position:absolute;left:0;top:7px;bottom:7px;width:3px;border-radius:3px;background:${ACCENT}"></span>
				<span style="width:13px;display:flex;justify-content:center"><span style="width:7px;height:7px;border-radius:50%;background:${ACCENT}"></span></span>
				<span style="font:600 12px/1 system-ui;color:#2a2f60;flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(g.docTitle)}</span>
				<span style="font:600 11px/1 'JetBrains Mono',ui-monospace,monospace;color:#4650b8">${count}</span>
			</div>`;
		}
		return `<div data-msg="reviewDoc" data-arg="${esc(g.docId)}" style="display:flex;align-items:center;gap:9px;padding:8px 10px;cursor:pointer">
			<span style="color:#cfd3da;font-size:12px;width:13px;text-align:center">&#9675;</span>
			<span style="font:500 12px/1 system-ui;color:#3a3f49;flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(g.docTitle)}</span>
			<span style="font:400 11px/1 'JetBrains Mono',ui-monospace,monospace;color:#868b95">${count}</span>
		</div>`;
	}).join('');

	return `<div style="width:292px;flex:none;background:#fafbfc;border-right:1px solid #e9eaee;display:flex;flex-direction:column;overflow:hidden">
		${header}
		<div style="flex:1;overflow:auto;padding:8px;display:flex;flex-direction:column;gap:1px">${reviewedRows}${rows}</div>
	</div>`;
}

// The centre review column (C5): the current document's title + a per-change card list. Each card shows
// the change IN CONTEXT (old struck through -> new added, reusing the addition/removal tokens the rail +
// editor use; an insertion has no oldText so it renders as pure additions), a `decision . line NN` source
// chip (from sourceQuote/sourceLine, plan 23.4 - the line is OMITTED when unknown so nothing is
// fabricated), and a filled-dot "High" / half-dot "Inferred" confidence chip per D24-A. The bottom bar
// reports the still-attention count + the batch controls. All actions drive the EXISTING engine (24.2):
// `Accept All N Here` -> approveAll(docId), `Next` -> advance the current doc (nextPendingDocId), the
// per-card Accept/Reject/Tweak -> approve/reject/focusChange.
function reviewColumn(changes: readonly IProposedChange[], docId: string, docTitle: string, currentIndex: number, groups: readonly { docId: string; docTitle: string }[]): string {
	const total = groups.length;
	const eyebrow = `<div style="font:400 11px/1 'JetBrains Mono',ui-monospace,monospace;letter-spacing:.1em;text-transform:uppercase;color:#a3a8b2;margin-bottom:7px">Document ${currentIndex + 1} of ${total}</div>`;
	const cards = changes.map(reviewCard).join('');
	const inferredCount = changes.filter(c => reviewConfidence(c) === 'inferred').length;

	// `Next` advances to the next changed document; the label names it. Only shown when more than one
	// document still has changes (the editor computes the real target via nextPendingDocId when clicked).
	const next = groups[currentIndex + 1] ?? groups[0];
	const nextBtn = total > 1
		? `<button data-msg="reviewNext" data-arg="${esc(docId)}" style="font:600 13px/1 system-ui;color:#fff;background:#1a1c20;border:none;border-radius:9px;padding:10px 18px;cursor:pointer">Next: ${esc(next.docTitle)} &#8594;</button>`
		: '';
	const attention = inferredCount
		? `${inferredCount} change${inferredCount === 1 ? '' : 's'} need${inferredCount === 1 ? 's' : ''} your eyes`
		: 'All changes look confident';
	const bottomBar = `<div style="flex:none;height:64px;border-top:1px solid #eef0f3;background:#fafbfc;display:flex;align-items:center;padding:0 40px;gap:14px">
		<span style="font:400 13px/1 system-ui;color:#a3a8b2">${attention}</span>
		<div style="margin-left:auto;display:flex;gap:10px">
			<button data-msg="reviewAcceptAllHere" data-arg="${esc(docId)}" style="font:600 13px/1 system-ui;color:#52575f;background:#fff;border:1px solid #e0e2e8;border-radius:9px;padding:10px 16px;cursor:pointer">Accept All ${changes.length} Here</button>
			${nextBtn}
		</div>
	</div>`;

	return `<div style="flex:1;overflow:hidden;background:#fff;display:flex;flex-direction:column">
		<div style="flex:1;overflow:auto;padding:30px 40px 30px">
			<div style="max-width:720px">
				${eyebrow}
				<h1 style="font:600 28px/1.12 system-ui;letter-spacing:-.02em;color:#14161a;margin:0 0 3px">${esc(docTitle)}</h1>
				<p style="font:400 13.5px/1 system-ui;color:#868b95;margin:0 0 24px">${changes.length} change${changes.length === 1 ? '' : 's'} proposed &middot; review each in context</p>
				${cards}
			</div>
		</div>
		${bottomBar}
	</div>`;
}

// One change card. The prose renders the change in context: `newText` with the addition tokens, then
// `oldText` struck through with the removal tokens (an insertion has no oldText -> pure additions). Below,
// the source chip + confidence chip + Accept / Tweak / Reject wired to the engine (24.2). An `inferred`
// change gets the attention-tinted card (bg #fffdf8, border #e4dccb) + the amber half-dot chip.
function reviewCard(change: IProposedChange): string {
	const level = reviewConfidence(change);
	const inferred = level === 'inferred';
	const cardStyle = inferred
		? 'border:1px solid #e4dccb;border-radius:13px;padding:16px 18px;margin-bottom:13px;background:#fffdf8'
		: 'border:1px solid #e6e8ec;border-radius:13px;padding:16px 18px;margin-bottom:13px';

	// The change in context: removal (struck) then addition. Additions use the `ok` tokens (#e9f6ee /
	// #2c8159); removals the `removed` tokens (#fbeeee / #b5514b strike). An insertion (`insert`) has no
	// oldText, so only the addition renders. Text is escaped - this is prose, not markup.
	const removal = !change.insert && change.oldText.trim()
		? ` <span style="background:#fbeeee;color:#b5514b;text-decoration:line-through;text-decoration-color:#cf5a53;border-radius:3px;padding:0 3px">${esc(change.oldText)}</span>`
		: '';
	const addition = change.newText.trim()
		? `<span style="background:#e9f6ee;color:#2c8159;border-radius:3px;padding:0 3px">${esc(change.newText)}</span>`
		: '';
	const prose = `<p style="font:400 16px/1.7 system-ui;color:#26292f;margin:0 0 12px">${addition}${removal}</p>`;

	// The self-explaining framing (plan 31 iter 2): the kind tag + the model's rationale, so the cross-doc
	// card reads with the same kind / confidence / rationale / source order the inline widget and rail do.
	const framing = reviewFraming(change, '');
	const kindChip = framing.kindAttention
		? `<span style="font:600 10.5px/1 system-ui;letter-spacing:.04em;text-transform:uppercase;color:#9a6b16;background:#fdf6e9;border:1px solid #f0e2c4;border-radius:999px;padding:4px 9px">${esc(framing.kindLabel)}</span>`
		: `<span style="font:600 10.5px/1 system-ui;letter-spacing:.04em;text-transform:uppercase;color:#2c8159;background:#eef7f0;border:1px solid #d7ecdc;border-radius:999px;padding:4px 9px">${esc(framing.kindLabel)}</span>`;
	// Rationale only when the model supplied one (no filler, plan 31 iter 2).
	const why = framing.rationale
		? `<p style="font:400 12.5px/1.5 system-ui;color:#5b616b;margin:0 0 12px">${esc(framing.rationale)}</p>`
		: '';

	// The source chip: `decision . line NN` when a real line is known, else just `decision` (never a
	// fabricated line). The verbatim decision quote (sourceQuote), when present, is the chip's hover title.
	const hasLine = typeof change.sourceLine === 'number';
	const chipTitle = change.sourceQuote ? ` title="${esc(change.sourceQuote)}"` : '';
	const sourceChip = `<span${chipTitle} style="display:inline-flex;align-items:center;gap:5px;font:500 11px/1 'JetBrains Mono',ui-monospace,monospace;color:#5661c9;background:#f4f5fd;border:1px solid #e0e5fb;border-radius:999px;padding:4px 10px"><span style="width:5px;height:5px;border-radius:50%;background:${ACCENT}"></span>decision${hasLine ? ` &middot; line ${change.sourceLine}` : ''}</span>`;

	// The confidence chip (D24-A): filled-dot "High" (ok/accent) or half-dot "Inferred . needs your eyes" (attention).
	const confChip = inferred
		? `<span style="font:600 11px/1 system-ui;color:#8a6d1a;background:#fdfaf2;border:1px solid #e4dccb;border-radius:999px;padding:5px 10px">&#9680; Inferred &middot; needs your eyes</span>`
		: `<span style="font:600 11px/1 system-ui;color:#2c8159;background:#eef7f0;border:1px solid #d7ecdc;border-radius:999px;padding:5px 10px">&#9679; High</span>`;

	// Tweak (amend-before-approve, plan 31 iter 3, D31-A): the same in-place editor the inline widget offers.
	// Edit opens a contenteditable over the proposed text; Save & Approve amends the pending change then
	// approves through the one engine path (reviewTweakSave); Cancel restores. Hidden for a figure (figures
	// come from sources). The secondary "Open in document" navigate-through is kept as a card link (D31-A).
	const canTweak = change.kind !== 'figure';
	const editor = canTweak
		? `<div class="rv-tweakwrap" style="display:none;margin:0 0 12px"><div class="rv-tweakedit" contenteditable="true" data-orig="${esc(change.newText)}" style="border:1px solid #d9b98e;border-radius:9px;padding:10px 13px;font:400 16px/1.6 system-ui;color:#26292f;background:#fffdf8;outline:none">${esc(change.newText)}</div></div>`
		: '';
	const tweakBtn = canTweak
		? `<button data-tweak-open style="font:600 12px/1 system-ui;color:#52575f;background:#fff;border:1px solid #e0e2e8;border-radius:8px;padding:8px 12px;cursor:pointer">Edit</button>`
		: '';
	// Actions wired to the EXISTING engine (24.2): Accept -> approve(id), Reject -> reject(id).
	const normalActs = `<span class="rv-normacts" style="display:flex;gap:7px">
		${tweakBtn}
		<button data-msg="reviewAccept" data-arg="${esc(change.id)}" style="font:600 12px/1 system-ui;color:#fff;background:${ACCENT};border:none;border-radius:8px;padding:8px 14px;cursor:pointer">Accept</button>
		<button data-msg="reviewReject" data-arg="${esc(change.id)}" style="font:600 12px/1 system-ui;color:#a3a8b2;background:none;border:none;padding:8px 4px;cursor:pointer">Reject</button>
	</span>`;
	const tweakActs = canTweak
		? `<span class="rv-tweakacts" style="display:none;gap:7px">
		<button data-tweak-save data-arg="${esc(change.id)}" style="font:600 12px/1 system-ui;color:#fff;background:${ACCENT};border:none;border-radius:8px;padding:8px 14px;cursor:pointer">Save &amp; Approve</button>
		<button data-tweak-cancel style="font:600 12px/1 system-ui;color:#a3a8b2;background:none;border:none;padding:8px 4px;cursor:pointer">Cancel</button>
	</span>`
		: '';
	const openLink = `<button data-msg="reviewTweak" data-arg="${esc(change.id)}" style="font:500 11.5px/1 system-ui;color:#8a8f99;background:none;border:none;padding:8px 4px;cursor:pointer" title="Open in the document">Open in document &#8599;</button>`;
	const actions = `<div style="margin-left:auto;display:flex;align-items:center;gap:7px">${openLink}${normalActs}${tweakActs}</div>`;

	return `<div class="rv-card" style="${cardStyle}">
		<div style="display:flex;align-items:center;gap:8px;margin:0 0 10px">${kindChip}</div>
		${prose}
		${why}
		${editor}
		<div style="display:flex;align-items:center;gap:8px">${sourceChip}${confChip}${actions}</div>
	</div>`;
}
