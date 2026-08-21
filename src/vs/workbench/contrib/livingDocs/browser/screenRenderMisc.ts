/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// The remaining Abstract screens that no lane owns exclusively: Model access (Settings), Onboarding, the
// whole-project run surface (project-run) and the cross-document review surface (review-project). Public:
// renderSettings, renderOnboarding, renderProjectRun, renderReviewProject. Split out of screenRender.ts to
// keep the shell thin; shared helpers come from screenRenderShell.

import { localize } from '../../../../nls.js';
import { buildBulkSet, groupPendingByDoc, IDecisionGroup, IProjectRunSummary, IProposedChange, IReviewedDoc, ProjectRunDocStatus, reviewConfidence, reviewFraming } from '../common/livingDocsModel.js';
import { ChatGptSignInStage } from '../common/livingDocs.js';
import { ONBOARDING_STEPS, onboardingStepIndex, OnboardingStep } from '../common/onboarding.js';
import { AMBER, AVATAR_NAVY, FONT, GREEN, HAIRLINE, INDIGO, INK, PAPER, RADIUS, RED, TRACKING, TYPE } from '../common/abstractTokens.js';
import { avatar, esc, IScreenState } from './screenRenderShell.js';

// Two shared button styles, so a screen can never invent a third. The system has exactly one filled
// button - the indigo primary - and one hairline secondary on white; a bulk verb that could undo a lot of
// work is quiet text (see `quietVerb`), never a filled or coloured button.
const BTN_PRIMARY = `border:none;border-radius:${RADIUS.control};padding:11px 20px;background:${INDIGO.base};color:${PAPER.card};font:${TYPE.uiBodyStrong};cursor:pointer`;
const BTN_SECONDARY = `border:1px solid ${PAPER.control};background:${PAPER.card};border-radius:${RADIUS.control};padding:10px 16px;font:${TYPE.uiBody};color:${INK.body};cursor:pointer`;
// A quiet (text) bulk verb: "Approve all 4…" is a lot of work in one click, so it reads as a sentence the
// user chooses, not a button that invites the click. Never green, never red, never filled.
const BTN_QUIET = `border:none;background:none;padding:6px 10px;font:${TYPE.secondary};color:${INK.secondary};cursor:pointer`;
// The one card: white paper, a `strong` hairline, the 12px card radius.
const CARD = `background:${PAPER.card};border:1px solid ${HAIRLINE.strong};border-radius:${RADIUS.cardLarge}`;
// A kind badge: mono, uppercase, tracked - coloured by risk (amber = a call is waiting on you, green =
// figures, already settled). The label string itself is never rewritten, only cased by CSS.
const kindBadge = (attention: boolean) => `font:${TYPE.kindBadge};letter-spacing:${TRACKING.kindBadge};text-transform:uppercase;color:${attention ? AMBER.label : GREEN.base}`;

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
	// The ring changes hue only when it means something: amber once the day's usage is nearly spent (a
	// decision is coming), red once it is effectively gone. Below that it is simply Abstract working.
	const colour = pct >= 0.9 ? RED.base : (pct >= 0.75 ? AMBER.base : INDIGO.base);
	return `<svg width="40" height="40" viewBox="0 0 40 40" style="flex:none">
		<circle cx="20" cy="20" r="${r}" fill="none" stroke="${HAIRLINE.strong}" stroke-width="4"></circle>
		<circle cx="20" cy="20" r="${r}" fill="none" stroke="${colour}" stroke-width="4" stroke-linecap="round"
			stroke-dasharray="${dash} ${(c - Number(dash)).toFixed(2)}" transform="rotate(-90 20 20)"></circle>
		<text x="20" y="24" text-anchor="middle" style="font:600 11px/1 ${FONT.sans};fill:${INK.bodySoft}">${Math.round(pct * 100)}%</text>
	</svg>`;
}

// The pending "Sign in with ChatGPT" device-authorization block (plan 51, issue #283). We show the two things
// the RFC 8628 device flow needs the user to do: (1) enter/confirm the DEVICE CODE - shown large, copyable in
// one click; (2) open the VERIFICATION LINK in their browser. We still attempt the automatic browser open, but
// a post-await window.open is popup-blocked (especially in Incognito), so we never depend on it - the anchor is
// a genuine user gesture the host opens OUTSIDE the sandboxed webview (openerService -> system browser). A "Copy
// link" fallback covers blocked environments, and the URL is selectable text so it can always be pasted by hand.
// Plain words throughout (P5); no "OAuth"/"device code" jargon in the copy.
function pendingSignInBlock(userCode: string | undefined, verificationUri: string | undefined): string {
	const waiting = `<div style="display:inline-flex;align-items:center;gap:9px;font:${TYPE.uiBodyStrong};color:${INK.bodySoft};margin-bottom:14px"><span style="width:13px;height:13px;border:2px solid ${PAPER.control};border-top-color:${INDIGO.base};border-radius:50%;animation:lwdSpin .8s linear infinite"></span>Waiting for you to finish signing in&hellip;</div>`;
	// The device code the user confirms on the sign-in page: shown large, copyable in one click (reuses the
	// generic data-copy-link handler by carrying the code in data-link). Absent only if the broker omitted it.
	// The code itself is mono - it is a fact to be typed character for character, which is what mono is for.
	const codeBlock = userCode
		? `<div style="margin:0 0 16px">
			<div style="font:${TYPE.sectionLabel};letter-spacing:${TRACKING.sectionLabel};color:${INK.meta};text-transform:uppercase;margin:0 0 8px">Your code</div>
			<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
				<span style="font:600 22px/1 ${FONT.mono};letter-spacing:.12em;color:${INK.heading};background:${PAPER.sunken};border:1px solid ${PAPER.sunkenBorder};border-radius:${RADIUS.input};padding:12px 16px;user-select:all">${esc(userCode)}</span>
				<button data-copy-link data-link="${esc(userCode)}" style="${BTN_SECONDARY}">Copy code</button>
			</div>
			<p style="margin:9px 0 0;font:${TYPE.secondary};color:${INK.meta}">Enter this on the sign-in page if it asks for it.</p>
		</div>`
		: '';
	if (!verificationUri) {
		return `<div>${waiting}${codeBlock}</div>`;
	}
	const url = esc(verificationUri);
	return `<div>
		${waiting}
		${codeBlock}
		<p style="margin:0 0 12px;font:${TYPE.secondary};color:${INK.secondary}">If your browser didn&#39;t open, open the sign-in page yourself:</p>
		<div style="display:flex;align-items:center;gap:9px;flex-wrap:wrap;margin-bottom:12px">
			<a data-open-external href="${url}" style="display:inline-flex;align-items:center;gap:8px;${BTN_PRIMARY};text-decoration:none">Open the sign-in page &#8599;</a>
			<button data-copy-link data-link="${url}" style="${BTN_SECONDARY}">Copy link</button>
		</div>
		<div style="font:${TYPE.provenance};color:${INK.meta};background:${PAPER.sunken};border:1px solid ${PAPER.sunkenBorder};border-radius:${RADIUS.control};padding:9px 11px;word-break:break-all;user-select:all">${url}</div>
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
	// Green means "all clear" - a door is genuinely serving. With no door, the dot carries no meaning, so it
	// takes the frame's own border colour rather than borrowing a hue.
	const dot = status.provider === 'none' ? PAPER.frameBorder : GREEN.base;

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
		usageBlock = `<div style="display:flex;align-items:center;gap:14px;margin-top:18px;padding-top:18px;border-top:1px solid ${HAIRLINE.soft}">
			${usageRing(frac)}
			<div><div style="font:${TYPE.uiBodyStrong};color:${INK.heading}">Today&#39;s included usage</div>
			<div style="font:${TYPE.secondary};color:${INK.secondary}">US$${spent} of US$${budget} used today &middot; picks up again tomorrow</div></div>
		</div>`;
	}

	// The "Sign in with ChatGPT" primary button, reflecting the flow stage. When signed in, the badge tells
	// the truth about whether the subscription is actually serving (issue #259): a plain green affirmation
	// ONLY when ChatGPT answered the last call; otherwise the honest signed-in-but-falling-back badge below.
	const signedInBadge = signedInButFallenBack
		? `<div style="display:flex;flex-direction:column;gap:8px">
				<div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
					<span style="font:${TYPE.uiBodyStrong};color:${AMBER.label};display:flex;align-items:center;gap:7px"><span style="width:8px;height:8px;border-radius:${RADIUS.pill};background:${AMBER.base};flex:none"></span>${esc(localize('livingDocs.settings.signedInFallback', "Signed in to ChatGPT, but calls are currently served by {0}", fallbackDoorName))}</span>
					<button data-msg="signOutChatGpt" style="${BTN_SECONDARY}">${esc(localize('livingDocs.settings.signOut', "Sign out"))}</button>
				</div>
				<details data-signin-why style="margin-top:2px">
					<summary style="list-style:none;cursor:pointer;font:600 12.5px/1 ${FONT.sans};color:${INDIGO.base};display:inline-flex;align-items:center;gap:6px">${esc(localize('livingDocs.settings.seeWhy', "See why"))}<span style="font-size:11px">&#9662;</span></summary>
					<p style="margin:9px 0 0;font:${TYPE.secondary};color:${INK.secondary};background:${AMBER.subtleBg};border:1px solid ${AMBER.border};border-radius:${RADIUS.control};padding:11px 13px">${esc(localize('livingDocs.settings.fallbackWhy', "Your ChatGPT sign-in worked, but Abstract can't yet complete model calls through your ChatGPT plan, so it's falling back to the included model for now. Your work still gets done; we're fixing the ChatGPT path. You stay signed in."))}</p>
				</details>
			</div>`
		: `<div style="display:flex;align-items:center;gap:12px">
				<span style="font:${TYPE.uiBodyStrong};color:${GREEN.base};display:flex;align-items:center;gap:7px"><span style="width:8px;height:8px;border-radius:${RADIUS.pill};background:${GREEN.base}"></span>${esc(localize('livingDocs.settings.signedIn', "Signed in to ChatGPT"))}</span>
				<button data-msg="signOutChatGpt" style="${BTN_SECONDARY}">${esc(localize('livingDocs.settings.signOut', "Sign out"))}</button>
			</div>`;
	// When the flow ended (error / expired), the button offers a fresh attempt with honest label copy: an
	// expired code says "Start again", a failure says "Try again" - never a bare "Sign in" that hides that the
	// last attempt failed. Signed-out shows the plain primary button; pending shows the device-code block.
	const primaryLabel = stage === 'expired'
		? localize('livingDocs.settings.signInAgain', "Start again")
		: stage === 'error'
			? localize('livingDocs.settings.signInRetry', "Try again")
			: localize('livingDocs.settings.signInChatGpt', "Sign in with ChatGPT");
	const signInBtn = stage === 'signed-in'
		? signedInBadge
		: stage === 'pending'
			? pendingSignInBlock(state.signInUserCode, state.signInVerificationUri)
			: `<button data-msg="signInChatGpt" style="${BTN_PRIMARY}">${esc(primaryLabel)}</button>`;

	// The honest failure state (plan 51, issue #283 section B): each cause reads distinctly. Expired uses a calm amber
	// note (nothing broke - the code just timed out); a real error uses the red note and, when the broker
	// forwarded an upstream rejection, appends the HTTP status + a short body snippet so the reason is the real
	// one, never invented. Broker-unreachable / broker-error carry only the plain-words reason.
	let signInError = '';
	if (stage === 'expired' && state.signInError) {
		signInError = `<p style="margin:12px 0 0;font:${TYPE.secondary};color:${AMBER.label}">${esc(state.signInError)}</p>`;
	} else if (stage === 'error' && state.signInError) {
		// The upstream detail is a verbatim fact from the other end of the wire, so it is mono on the red
		// block fill - the same "this failed" grammar the WAS block uses, and no border to shout with.
		const upstreamLine = typeof state.signInUpstreamStatus === 'number'
			? `<div style="margin:8px 0 0;font:${TYPE.provenance};color:${RED.blockInk};background:${RED.blockBg};border-radius:${RADIUS.control};padding:8px 10px;word-break:break-word">${esc(localize('livingDocs.settings.upstreamStatus', "OpenAI responded with {0}", String(state.signInUpstreamStatus)))}${state.signInUpstreamBody ? ` &middot; ${esc(state.signInUpstreamBody)}` : ''}</div>`
			: '';
		signInError = `<div style="margin:12px 0 0"><p style="margin:0;font:${TYPE.secondary};color:${RED.base}">${esc(state.signInError)}</p>${upstreamLine}</div>`;
	}

	// The survey: three plain-words questions. Recorded once; a thank-you replaces the form after saving.
	const field = `width:100%;border:1px solid ${PAPER.control};border-radius:${RADIUS.input};padding:11px 12px;font:${TYPE.uiBody};color:${INK.heading};background:${PAPER.card};outline:none`;
	const fieldLabel = `display:block;font:600 12.5px/1 ${FONT.sans};color:${INK.bodySoft};margin:0 0 7px`;
	const surveyBody = state.surveySaved
		? `<div style="display:flex;align-items:center;gap:10px;font:${TYPE.uiBody};color:${GREEN.base}"><span style="width:8px;height:8px;border-radius:${RADIUS.pill};background:${GREEN.base}"></span>Thanks &mdash; that helps us build the right templates first.</div>`
		: `<div data-survey style="display:flex;flex-direction:column;gap:16px">
				<div><label style="${fieldLabel}">Which frontier model is your daily driver?</label>
					<input data-sfield="daily" placeholder="ChatGPT, Claude, Gemini&hellip;" style="${field}"></div>
				<div><label style="${fieldLabel}">Which subscriptions do you own?</label>
					<input data-sfield="subs" placeholder="ChatGPT Plus, Claude Pro&hellip;" style="${field}"></div>
				<div><label style="${fieldLabel}">What do you make each week?</label>
					<input data-sfield="weekly" placeholder="Reports, briefs, proposals&hellip;" style="${field}"></div>
				<button data-survey-save style="align-self:flex-start;${BTN_SECONDARY}">Save</button>
			</div>`;

	return `<div class="screen">
		<div class="scr-head"><div><h1 class="scr-title">Model access</h1><div class="scr-sub">how your work gets its intelligence</div></div></div>
		<div class="scr-body"><div style="max-width:720px;margin:0 auto;padding:32px 28px 60px">

			<div style="${CARD};padding:24px 26px;margin-bottom:22px">
				<div style="display:flex;align-items:center;gap:9px;margin-bottom:4px"><span style="width:8px;height:8px;border-radius:${RADIUS.pill};background:${dot}"></span><span style="font:600 12.5px/1 ${FONT.sans};color:${INK.secondary}">Serving you now</span></div>
				<div style="font:${TYPE.bannerHeadline};color:${INK.heading};margin:0 0 20px">${esc(doorLabel)}</div>

				<div style="font:600 12.5px/1 ${FONT.sans};color:${INK.bodySoft};margin:0 0 10px">Sign in with your own subscription</div>
				<p style="margin:0 0 14px;font:${TYPE.uiBody};color:${INK.secondary}">Use your own ChatGPT plan and every model call in Abstract draws on it &mdash; nothing to set up, no usage limit from us.</p>
				${signInBtn}
				${signInError}

				<div style="font:600 12.5px/1 ${FONT.sans};color:${INK.bodySoft};margin:22px 0 10px;padding-top:18px;border-top:1px solid ${HAIRLINE.soft}">Or use the included model</div>
				<p style="margin:0 0 14px;font:${TYPE.uiBody};color:${INK.secondary}">A capable model we include for free, with a small amount of usage each day. It pauses politely when the day&#39;s usage is spent and picks up again tomorrow.</p>
				<button data-msg="useIncludedModel" style="${BTN_SECONDARY}">Use the included model</button>
				${usageBlock}
			</div>

			<div style="${CARD};padding:24px 26px;margin-bottom:22px">
				<div style="font:${TYPE.bannerHeadline};color:${INK.heading};margin:0 0 5px">A few quick questions</div>
				<p style="margin:0 0 20px;font:${TYPE.uiBody};color:${INK.secondary}">This helps us build the right things first. Your answers stay on your computer.</p>
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
	const line = (text: string) => `<li style="margin:0 0 9px;font:${TYPE.uiBody};color:${INK.bodySoft}">${text}</li>`;
	return `<div style="${CARD};padding:6px 26px">
		<details data-dataflow>
			<summary style="list-style:none;cursor:pointer;display:flex;align-items:center;gap:10px;padding:18px 0;font:${TYPE.uiBodyStrong};color:${INK.heading}">
				<span style="width:22px;height:22px;flex:none;border-radius:${RADIUS.control};background:${INDIGO.tint};border:1px solid ${INDIGO.tintBorder};color:${INDIGO.base};display:flex;align-items:center;justify-content:center;font-size:12px">&#128274;</span>
				<span style="flex:1">What does Abstract send?</span>
				<span style="color:${INK.meta};font-size:12px">&#9662;</span>
			</summary>
			<div style="padding:2px 0 22px">
				<p style="margin:0 0 14px;font:${TYPE.uiBody};color:${INK.secondary}">Abstract sends content only when you ask it to work &mdash; or when an agent you have left running does its scheduled check. Here is exactly what is sent, and what never is.</p>
				<ul style="margin:0 0 14px;padding-left:20px">
					${line('When you <strong>chat about a document</strong>, Abstract sends that one open document and the source files you attached to it &mdash; nothing else in your folder.')}
					${line('When you <strong>run one instruction across your project</strong>, it sends only the documents you selected for that run and their shared sources.')}
					${line('Three <strong>built-in agents run on their own</strong> &mdash; when a source file changes, every six hours, and on Monday mornings. When a document&#39;s figures need updating, the double-check may send that document&#39;s changed sentences and its attached context files. Pause any agent on the Agents screen to stop this.')}
					${line('Model calls go through your own <strong>ChatGPT sign-in</strong>, or the <strong>included model</strong> when you are not signed in. Your sign-in stays on this computer &mdash; the app never sees it.')}
					${line('<strong>Files that are not documents, attached sources, or @-mentions &mdash; and your edit history &mdash; stay on your computer.</strong> A folder listing is never sent.')}
					${line('<strong>Usage analytics is on by default and you can turn it off here any time</strong> &mdash; it stays on this computer, counts your actions, never your words, and forwarding it anywhere is not built yet.')}
				</ul>
				${analyticsConsentRow(analyticsEnabled)}
				<p style="margin:0;font:${TYPE.secondary};color:${INK.meta}">The full plain-words page: <span style="font:${TYPE.provenance};color:${INK.secondary}">docs/27-data-flow-one-pager.md</span></p>
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
	// Indigo when it is counting (Abstract acting); the meta ink when it is not - "off" is not a state that
	// needs a colour.
	const dot = on ? INDIGO.base : INK.meta;
	return `<div style="display:flex;align-items:center;gap:12px;margin:0 0 14px;padding:13px 15px;background:${PAPER.sunken};border:1px solid ${PAPER.sunkenBorder};border-radius:${RADIUS.card}">
		<span style="width:8px;height:8px;flex:none;border-radius:${RADIUS.pill};background:${dot}"></span>
		<div style="flex:1">
			<div style="font:600 12.5px/1.3 ${FONT.sans};color:${INK.heading}">Anonymous usage analytics</div>
			<div style="font:${TYPE.secondary};color:${INK.secondary}">${state}. Change it any time.</div>
		</div>
		<button data-msg="setAnalyticsConsent" data-arg="${btnArg}" style="flex:none;${BTN_SECONDARY}">${btnLabel}</button>
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
		'first-approve-sample': localize('livingDocs.onboarding.rail.approve', "Approve"), 'first-folder': localize('livingDocs.onboarding.rail.folder', "Your folder"), 'first-approve-own': localize('livingDocs.onboarding.rail.aha', "Aha"),
	};
	const rail = ONBOARDING_STEPS.map((s, i) => {
		const done = i < idx;
		const cur = i === idx;
		// Green for a step already done (settled), indigo for the step Abstract is on, and the paper's own
		// hairline for the steps still ahead - a step you have not reached yet is not a state.
		const bg = done ? GREEN.base : cur ? INDIGO.base : HAIRLINE.strong;
		const fg = (done || cur) ? PAPER.card : INK.meta;
		const mark = done ? '&#10003;' : String(i + 1);
		return `<div style="display:flex;flex-direction:column;align-items:center;gap:6px;flex:1;min-width:0">
			<span style="width:26px;height:26px;border-radius:${RADIUS.pill};background:${bg};color:${fg};display:flex;align-items:center;justify-content:center;font:600 12px/1 ${FONT.sans}">${mark}</span>
			<span style="font:${cur ? '600' : '400'} 10.5px/1.2 ${FONT.sans};color:${cur ? INK.heading : INK.meta};text-align:center">${railLabels[s]}</span>
		</div>`;
	}).join(`<div style="height:1px;background:${HAIRLINE.strong};flex:none;width:14px;margin-top:13px"></div>`);

	const btn = (label: string, msg: string, primary: boolean) => primary
		? `<button data-msg="${msg}" style="${BTN_PRIMARY}">${esc(label)}</button>`
		: `<button data-msg="${msg}" style="${BTN_SECONDARY}">${esc(label)}</button>`;

	const wowBadge = (n: number) => `<span style="display:inline-flex;align-items:center;gap:6px;background:${AMBER.bg};border:1px solid ${AMBER.border};border-radius:${RADIUS.pill};padding:4px 11px;font:600 11px/1 ${FONT.sans};color:${AMBER.label};margin-bottom:14px">&#10022; ${localize('livingDocs.onboarding.wowBadge', "Wow moment {0}", n)}</span>`;

	// The consent line, reflecting the choice already made at the consent moment (reused, not rebuilt).
	const consentLine = ob.consentEnabled
		? `<span style="color:${GREEN.base}"><span style="width:7px;height:7px;border-radius:${RADIUS.pill};background:${GREEN.base};display:inline-block;margin-right:7px"></span>${localize('livingDocs.onboarding.analyticsOn', "Analytics on - we count actions, never your words. Document content never leaves your machine.")}</span>`
		: `<span style="color:${INK.secondary}"><span style="width:7px;height:7px;border-radius:${RADIUS.pill};background:${PAPER.frameBorder};display:inline-block;margin-right:7px"></span>${localize('livingDocs.onboarding.analyticsOff', "Analytics off - onboarding still works, it just isn't measured. Turn it on any time in Model access.")}</span>`;
	const consentCard = `<div style="margin-top:22px;padding-top:18px;border-top:1px solid ${HAIRLINE.soft};font:${TYPE.secondary}">${consentLine}</div>`;

	// Amber, because this is the one line on the screen that is waiting on a decision from the reader.
	const noModel = !ob.hasModel
		? `<p style="margin:14px 0 0;font:${TYPE.secondary};color:${AMBER.label};background:${AMBER.bg};border:1px solid ${AMBER.border};border-radius:${RADIUS.control};padding:10px 13px">${localize('livingDocs.onboarding.noModel.prefix', "No model is connected yet.")} <a data-msg="onbModelAccess" style="color:${INDIGO.base};cursor:pointer;text-decoration:underline">${localize('livingDocs.onboarding.noModel.link', "Connect one in Model access")}</a> ${localize('livingDocs.onboarding.noModel.suffix', "so the prompted edit can run - the demo report and its provenance still work without it.")}</p>`
		: '';

	// Per-step card content. Each primary action drives the real engine + records the funnel step.
	let head = '';
	let body = '';
	let actions = '';
	let badge = '';
	switch (ob.step) {
		case 'open':
			head = localize('livingDocs.onboarding.open.head', "Two wows, ten minutes, no setup");
			body = localize('livingDocs.onboarding.open.body', "Abstract keeps your documents bound to their sources, so numbers stay true and edits are reviewed. In the next few minutes we'll show you the magic twice - with nothing to set up. We start from a demo report generated from a bundled dataset.");
			actions = btn(localize('livingDocs.onboarding.open.primary', "See it work"), 'onbSeeItWork', true) + btn(localize('livingDocs.onboarding.open.secondary', "Model access & a few questions"), 'onbModelAccess', false);
			break;
		case 'demo-report':
			head = localize('livingDocs.onboarding.demo.head', "Your demo report is ready");
			body = localize('livingDocs.onboarding.demo.body', "We generated a <strong>Demo Report</strong> from a bundled dataset in your open folder. Its figures are bound to that data. Let's see the first wow.");
			actions = btn(localize('livingDocs.onboarding.demo.primary', "Show me the first wow"), 'onbAdvance', true) + btn(localize('livingDocs.onboarding.openDemo', "Open the demo report"), 'onbOpenDemo', false);
			break;
		case 'provenance-peek':
			badge = wowBadge(1);
			head = localize('livingDocs.onboarding.peek.head', "See where every number comes from");
			body = localize('livingDocs.onboarding.peek.body', "In the Demo Report, hover the <strong>$48.6k</strong> figure (or any bound number). Abstract shows a peek: its <strong>source</strong>, its <strong>value</strong>, and <strong>when it synced</strong> - so you never wonder where a figure came from or whether it's stale.");
			actions = btn(localize('livingDocs.onboarding.peek.primary', "I saw where it came from"), 'onbAdvance', true) + btn(localize('livingDocs.onboarding.openDemo', "Open the demo report"), 'onbOpenDemo', false);
			break;
		case 'first-diff':
			badge = wowBadge(2);
			head = localize('livingDocs.onboarding.diff.head', "Ask for one change, get one clean diff");
			body = localize('livingDocs.onboarding.diff.body', "Now ask Abstract to improve a paragraph. We'll ask it to <strong>tighten the note to the board</strong>. A single inline <span style=\"color:{0}\">red</span>/<span style=\"color:{1}\">green</span> diff streams into that exact paragraph - nothing else moves, and nothing changes until you approve.", RED.base, GREEN.base);
			actions = btn(localize('livingDocs.onboarding.diff.primary', "Prompt one edit"), 'onbPromptEdit', true) + btn(localize('livingDocs.onboarding.openDemo', "Open the demo report"), 'onbOpenDemo', false);
			body += noModel;
			break;
		case 'first-approve-sample':
			head = localize('livingDocs.onboarding.approveSample.head', "Approve it - and it's saved");
			body = localize('livingDocs.onboarding.approveSample.body', "Open the <strong>Review</strong> panel on the right and approve the single proposal. It applies to the paragraph and is recorded as a version in <strong>History</strong> you can restore. On the web build a reload is ephemeral; on desktop the approved version persists (the X1 cure).");
			actions = btn(localize('livingDocs.onboarding.approveSample.primary', "I approved it"), 'onbAdvance', true) + btn(localize('livingDocs.onboarding.openDemo', "Open the demo report"), 'onbOpenDemo', false);
			break;
		case 'first-folder':
			head = localize('livingDocs.onboarding.folder.head', "Now bring your own work");
			body = localize('livingDocs.onboarding.folder.body', "That was the sample. The moment Abstract is built for is the first change you approve on <strong>your own file</strong>. Open a real folder to make it live - you keep everything you just learned.");
			actions = btn(localize('livingDocs.onboarding.folder.primary', "Bring a real folder"), 'onbOpenFolder', true);
			break;
		case 'first-approve-own':
			head = localize('livingDocs.onboarding.done.head', "You're all set");
			body = localize('livingDocs.onboarding.done.body', "Open one of your documents, ask for a change, and approve it - that first approved change on your own file is the aha this whole flow was for. You can revisit this walkthrough any time from the command palette.");
			actions = btn(localize('livingDocs.onboarding.done.primary', "Go to Home"), 'onbDone', true);
			break;
	}

	return `<div class="screen">
		<div class="scr-head"><div><h1 class="scr-title">${localize('livingDocs.onboarding.title', "Welcome to Abstract")}</h1><div class="scr-sub">${localize('livingDocs.onboarding.subtitle', "the two-wow, ten-minute path")}</div></div></div>
		<div class="scr-body"><div style="max-width:720px;margin:0 auto;padding:30px 28px 60px">
			<div style="display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:30px">${rail}</div>
			<div style="${CARD};padding:28px 30px">
				${badge}
				<h2 style="margin:0 0 12px;font:${TYPE.docHeading};color:${INK.heading}">${head}</h2>
				<p style="margin:0 0 22px;font:${TYPE.docBody};color:${INK.bodySoft}">${body}</p>
				<div style="display:flex;gap:12px;flex-wrap:wrap">${actions}</div>
				${ob.step === 'open' ? consentCard : ''}
			</div>
			<p style="margin:18px 2px 0;font:${TYPE.secondary};color:${INK.meta}">${localize('livingDocs.onboarding.progress', "Step {0} of {1} - you can leave and come back - onboarding remembers where you were.", idx + 1, total)}</p>
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
	const pill = (bg: string, border: string, ink: string) => `display:inline-flex;align-items:center;gap:6px;background:${bg};border:1px solid ${border};border-radius:${RADIUS.pill};padding:3px 10px;font:600 12.5px/1 ${FONT.sans};color:${ink}`;
	const livePill = run?.inFlight
		? `<span style="${pill(INDIGO.tint, INDIGO.tintBorder, INDIGO.base)}"><span style="width:6px;height:6px;border-radius:${RADIUS.pill};background:${INDIGO.base};animation:lwdPulse 1.6s ease-in-out infinite"></span>Live</span>`
		: run?.paused
			? `<span style="${pill(AMBER.bg, AMBER.border, AMBER.label)}"><span style="width:6px;height:6px;border-radius:${RADIUS.pill};background:${AMBER.base}"></span>Paused</span>`
			: run?.stopped
				? `<span style="${pill(PAPER.sunken, PAPER.sunkenBorder, INK.secondary)}"><span style="width:6px;height:6px;border-radius:${RADIUS.pill};background:${RED.base}"></span>Stopped</span>`
				: '';
	const runTopBar = `<div style="height:48px;flex:none;display:flex;align-items:center;gap:12px;padding:0 18px;border-bottom:1px solid ${HAIRLINE.strong};background:${PAPER.rail}">
		<span style="width:20px;height:20px;border-radius:6px;background:${AVATAR_NAVY};display:flex;align-items:center;justify-content:center;color:${PAPER.card};font:600 10px/1 ${FONT.sans}">${projectAv.text}</span>
		<span style="font:${TYPE.uiBodyStrong};color:${INK.heading}">${esc(folderName)}</span><span style="color:${INK.meta}">/</span>
		<span style="display:inline-flex;align-items:center;gap:7px;font:${TYPE.uiBody};color:${INDIGO.base}">&#10022; Agent run</span>
		${livePill}
	</div>`;

	// The command strip (C4): 32px accent avatar + the instruction in reading type + the attached
	// source chip + a `Whole project` pill. When there is a live/last run, show its REAL instruction
	// + source; otherwise the strip reflects the idle state with a calm prompt (no fabricated ISMS copy).
	// The source name is a provenance fact, so it is mono on the indigo tint - the same chip the rest of the
	// product uses for "this is the file it came from".
	const sourceChip = run?.source
		? `<span style="font:${TYPE.provenance};color:${INDIGO.base};background:${INDIGO.tint};border:1px solid ${INDIGO.tintBorder};border-radius:6px;padding:2px 8px">${esc(run.source)}</span>`
		: '';
	const instruction = run?.instruction
		? `${sourceChip ? 'From ' + sourceChip + ', ' : ''}&ldquo;${esc(run.instruction)}&rdquo;`
		: 'No project run in progress. Start one from Agents or ask across the whole project in Chat.';
	const instructionColor = run?.instruction ? INK.heading : INK.meta;
	// A Stop run control while the fan-out is in flight (plan 27 iter 4): cancels the whole-project model
	// call; docs that never settled a change are marked skipped honestly. Only shown while genuinely live.
	// A plain secondary, not a red button: red means "removed / failed" and is never a button colour. The
	// red square glyph carries the stop; the button itself stays quiet.
	const stopRun = run?.inFlight
		? `<button data-msg="stopProjectRun" style="flex:none;display:inline-flex;align-items:center;gap:7px;${BTN_SECONDARY}"><span style="width:9px;height:9px;border-radius:2px;background:${RED.base}"></span>Stop run</button>`
		: '';
	// The batch chip (plan 30, track 3, D30-B): the fan-out packs the working set into context-bounded
	// batches; when a run spans more than one batch the strip reports `Batch K of M` so the user sees the
	// run proceeding in batches rather than stalling on a large folder. Shown only for a live multi-batch
	// run (index > 0, count > 1); a single-batch run shows nothing extra (the common small-scale case).
	const batch = run?.batch;
	const batchChip = batch && batch.count > 1 && batch.index > 0
		? `<span style="flex:none;font:${TYPE.provenance};color:${INDIGO.base};background:${INDIGO.tint};border:1px solid ${INDIGO.tintBorder};border-radius:${RADIUS.control};padding:7px 12px">Batch ${batch.index} of ${batch.count}</span>`
		: '';
	// "Whole project" states the scope of the run - it is a chip, not a button, so it takes the indigo tint
	// rather than the indigo fill the one primary button owns.
	const commandStrip = `<div style="flex:none;padding:18px 28px;border-bottom:1px solid ${HAIRLINE.medium};display:flex;align-items:center;gap:16px">
		<span style="width:32px;height:32px;border-radius:${RADIUS.pill};background:${AVATAR_NAVY};color:${PAPER.card};display:flex;align-items:center;justify-content:center;font:600 12px/1 ${FONT.sans};flex:none">TS</span>
		<div style="flex:1;font:${TYPE.docBody};color:${instructionColor}">${instruction}</div>
		${batchChip}
		${stopRun}
		<span style="flex:none;font:600 12.5px/1 ${FONT.sans};color:${INDIGO.base};background:${INDIGO.tint};border:1px solid ${INDIGO.tintBorder};border-radius:${RADIUS.pill};padding:5px 14px">Whole project</span>
	</div>`;

	// Truthful idle body (guardrail): no fabricated numbers, shown only when no run has started. The primary
	// "Run Across the Project" button is the ONE explicit action that launches the fan-out (#265 CR-1): opening
	// this surface never auto-starts a run, so the user deliberately kicks it here (or from the Chat composer).
	const idleBody = `<div style="flex:1;overflow:auto;background:${PAPER.page};display:flex;align-items:center;justify-content:center;padding:40px">
		<div style="text-align:center;max-width:460px">
			<div style="width:44px;height:44px;margin:0 auto 16px;border-radius:${RADIUS.card};background:${INDIGO.tint};border:1px solid ${INDIGO.tintBorder};display:flex;align-items:center;justify-content:center;font-size:20px;color:${INDIGO.base}">&#10022;</div>
			<h2 style="margin:0 0 10px;font:${TYPE.bannerHeadline};color:${INK.heading}">Ready to run across the project</h2>
			<p style="margin:0 0 22px;font:${TYPE.uiBody};color:${INK.secondary}">Nothing has started yet. Launch a whole-project run below, or ask across the whole project in Chat. The sub-agent swarm and the decisions the agent understands will appear here as the run proceeds.</p>
			<div style="display:flex;gap:10px;align-items:center;justify-content:center">
				<button data-msg="launchProjectRun" style="${BTN_PRIMARY}">Run across the project</button>
				<button data-msg="goAgents" style="${BTN_SECONDARY}">Go to Agents</button>
			</div>
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
	// Documents left alone by "Never change this doc" (issue #257) are their own honest bucket - NEVER folded into
	// "unchanged", so the run bar shows the dial was honoured rather than reading a false all-clear over them.
	const policyDocs = summary?.policyDocs ?? 0;
	const numeral = (n: number) => `<strong style="font:${TYPE.uiBodyStrong};color:${INK.heading}">${n}</strong>`;
	const tailParts = [`&middot; ${workingCount} working`, `&middot; ${unchangedDocs} unchanged`];
	if (skippedDocs) { tailParts.push(`&middot; ${skippedDocs} skipped`); }
	if (oversizeDocs) { tailParts.push(`&middot; ${oversizeDocs} too large`); }
	if (failedDocs) { tailParts.push(`&middot; <span style="color:${AMBER.label}">${failedDocs} failed</span>`); }
	if (policyDocs) { tailParts.push(`&middot; <span style="color:${INK.secondary}">${policyDocs} left alone</span>`); }
	const tail = tailParts.join(' ');
	// The lead line stays honest under a model outage: when documents failed and nothing was proposed, it names
	// the model as unreachable (F14) instead of the false "0 changes proposed in 0 documents" all-clear.
	const lead = failedDocs > 0 && changed === 0
		? `<span style="font:${TYPE.uiBody};color:${AMBER.label}">The agent model is not reachable &mdash; ${numeral(failedDocs)} documents could not be processed</span>`
		: `<span style="font:${TYPE.uiBody};color:${INK.body}">${numeral(changed)} changes proposed in ${numeral(changedDocs)} documents</span>`;
	const bottomBar = `<div style="flex:none;height:66px;border-top:1px solid ${HAIRLINE.medium};background:${PAPER.rail};display:flex;align-items:center;padding:0 28px;gap:18px">
		${lead}
		<span style="font:${TYPE.secondary};color:${INK.meta}">${tail}</span>
		<button data-msg="reviewProject" style="margin-left:auto;${BTN_PRIMARY}">Review across the project &#8594;</button>
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
	const header = `<div style="font:${TYPE.sectionLabel};letter-spacing:${TRACKING.sectionLabel};text-transform:uppercase;color:${INDIGO.base};margin-bottom:16px">${headerLabel}</div>`;
	const shell = (body: string) => `<div style="width:360px;flex:none;border-right:1px solid ${HAIRLINE.strong};background:${PAPER.rail};padding:22px;overflow:hidden;display:flex;flex-direction:column">${header}${body}</div>`;

	if (!decisions.length) {
		const message = inFlight
			? 'Reading the source and extracting the decisions across the project&hellip;'
			: 'No decisions were grounded in the source for this run.';
		return shell(`<div style="flex:1;display:flex;align-items:center;justify-content:center;text-align:center;color:${INK.meta}">
			<p style="margin:0;font:${TYPE.uiBody};max-width:240px">${message}</p>
		</div>`);
	}

	// One card per decision, matching the comp's structure: the source chip on top (`transcript .
	// line N`, mono), then the decision in reading type, then `-> N documents affected` in accent. The
	// line clause and whole chip are dropped when the decision has no verified line / grounding (the
	// honest degrade) - never a fabricated line. Reading type stays UI sans per handoff Part B/F
	// (decision 4b: the handoff wins over the comp's Newsreader serif - a deliberate, logged departure).
	const cards = decisions.map(d => {
		const chip = d.grounded
			? `<div style="font:${TYPE.provenance};color:${INDIGO.base};margin-bottom:7px">${sourceName}${typeof d.sourceLine === 'number' ? ` &middot; line ${d.sourceLine}` : ''}</div>`
			: '';
		const docs = d.docsAffected;
		return `<div style="background:${PAPER.card};border:1px solid ${HAIRLINE.strong};border-radius:${RADIUS.card};padding:15px 16px">
			${chip}
			<div style="font:${TYPE.docBody};color:${INK.heading};margin-bottom:10px">${esc(d.quote)}</div>
			<div style="font:600 12.5px/1 ${FONT.sans};color:${INDIGO.base}">&#8594; ${docs} ${docs === 1 ? 'document' : 'documents'} affected</div>
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
	// The comp sets a card/section title at 15.5/600; the sentence under it is the secondary step.
	const title = `font:600 15.5px/1 ${FONT.sans};color:${INK.heading}`;
	const sub = `font:${TYPE.secondary};color:${INK.meta}`;
	const heading = busy
		? `<span style="${title}">Orchestrating ${total} sub-agents</span><span style="${sub}">reading every document in parallel</span>`
		: paused
			? `<span style="${title}">Run paused &mdash; today's included usage is spent</span><span style="${sub}">${summary.changedDocs} of ${total} documents changed &middot; the rest resume tomorrow &middot; finished proposals are ready to review</span>`
			: stopped
				? `<span style="${title}">Run stopped</span><span style="${sub}">${summary.changedDocs} of ${total} documents changed before you stopped &middot; ${summary.skippedDocs} skipped</span>`
				: failedCount > 0
					? `<span style="font:600 15.5px/1 ${FONT.sans};color:${AMBER.label}">Model unreachable for ${failedCount} of ${total} documents</span><span style="${sub}">${summary.changedDocs} changed &middot; ${failedCount} failed &mdash; retry the failed documents from Chat</span>`
					: `<span style="${title}">${total} sub-agents finished</span><span style="${sub}">every document read across the project</span>`;
	const progress = `<div style="display:flex;align-items:center;gap:12px;margin-bottom:14px">${heading}<span style="margin-left:auto;font:${TYPE.provenance};color:${INK.bodySoft}">${done} / ${total} done</span></div>
		<div style="height:5px;background:${HAIRLINE.strong};border-radius:3px;margin-bottom:18px;overflow:hidden"><div style="width:${pct}%;height:100%;background:${INDIGO.base};border-radius:3px"></div></div>`;
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
	const nameStyle = `font:${TYPE.secondary};white-space:nowrap;overflow:hidden;text-overflow:ellipsis`;
	// Every tile's status word is a fact about the run, so it is mono at the kind-badge step.
	const statusWord = `font:${TYPE.kindBadge}`;
	const tile = `border-radius:${RADIUS.input};padding:10px 11px;display:flex;flex-direction:column;justify-content:space-between`;
	if (isWorking || status === 'working') {
		return `<div style="background:${PAPER.card};border:1px solid ${INDIGO.tintBorder};${tile}">
			<div style="display:flex;align-items:center;gap:6px"><span style="width:11px;height:11px;border:2px solid ${INDIGO.tintBorder};border-top-color:${INDIGO.base};border-radius:50%;animation:lwdSpin .8s linear infinite;flex:none"></span><span style="${nameStyle};color:${INK.body}">${name}</span></div>
			<span style="${statusWord};color:${INK.meta};font-style:italic">reviewing&hellip;</span>
		</div>`;
	}
	if (status === 'changed') {
		return `<div style="background:${INDIGO.tint};border:1px solid ${INDIGO.tintBorder};${tile}">
			<div style="display:flex;align-items:center;gap:6px"><span style="color:${GREEN.base};font-size:11px">&#10003;</span><span style="${nameStyle};color:${INK.body}">${name}</span></div>
			<span style="${statusWord};color:${INDIGO.base}">${count} ${count === 1 ? 'change' : 'changes'}</span>
		</div>`;
	}
	// A skipped tile (plan 27 iter 4): the run stopped before this document ran. A dashed border + honest
	// "skipped" label distinguishes it from a document that ran and settled with no change. Skipped is not
	// failure - nothing went wrong here - so it borrows no state hue.
	if (status === 'skipped') {
		return `<div style="background:${PAPER.rail};border:1px dashed ${PAPER.frameBorder};${tile}">
			<div style="display:flex;align-items:center;gap:6px"><span style="color:${INK.meta};font-size:11px">&#9723;</span><span style="${nameStyle};color:${INK.meta}">${name}</span></div>
			<span style="${statusWord};color:${INK.meta}">skipped</span>
		</div>`;
	}
	// An oversize tile (plan 30, track 3, D30-B): the document is too large for the fan-out's context budget,
	// so it was NEVER sent - an amber border + a warning glyph + the honest "too large for this run" label
	// tells the user why it produced nothing, rather than a silent drop or a false "no change".
	if (status === 'oversize') {
		return `<div style="background:${AMBER.bg};border:1px solid ${AMBER.border};${tile}">
			<div style="display:flex;align-items:center;gap:6px"><span style="color:${AMBER.base};font-size:11px">&#9888;</span><span style="${nameStyle};color:${AMBER.label}">${name}</span></div>
			<span style="${statusWord};color:${AMBER.label}">too large for this run</span>
		</div>`;
	}
	// A failed tile (F14, issue #123): the model could not be reached for this document during the run. The red
	// block fill + a warning glyph + the honest "model unreachable" label tells the user WHY it produced nothing,
	// so a model outage never reads as a silent "no change" all-clear. Retry from Chat re-runs just the failed docs.
	if (status === 'failed') {
		return `<div style="background:${RED.blockBg};border:1px solid ${RED.diffBg};${tile}">
			<div style="display:flex;align-items:center;gap:6px"><span style="color:${RED.base};font-size:11px">&#9888;</span><span style="${nameStyle};color:${RED.blockInk}">${name}</span></div>
			<span style="${statusWord};color:${RED.base}">model unreachable</span>
		</div>`;
	}
	// A policy tile (issue #257): the document is dialled "Never change this doc", so the run left it alone by the
	// human's own choice. A recessed tile + a "no-entry" glyph + the honest "left alone (policy: never)" label
	// tells the user WHY it produced nothing - the dial was honoured, never a silent "no change" that would hide it.
	if (status === 'policy') {
		return `<div style="background:${PAPER.sunken};border:1px solid ${PAPER.sunkenBorder};${tile}">
			<div style="display:flex;align-items:center;gap:6px"><span style="color:${INK.secondary};font-size:11px">&#8856;</span><span style="${nameStyle};color:${INK.secondary}">${name}</span></div>
			<span style="${statusWord};color:${INK.secondary}">left alone (policy: never)</span>
		</div>`;
	}
	return `<div style="background:${PAPER.rail};border:1px solid ${HAIRLINE.medium};${tile}">
		<div style="display:flex;align-items:center;gap:6px"><span style="color:${PAPER.frameBorder};font-size:12px">&middot;</span><span style="${nameStyle};color:${INK.meta}">${name}</span></div>
		<span style="${statusWord};color:${INK.meta}">no change</span>
	</div>`;
}


// ---- Cross-document review (C5, plan 24). A SECOND presentation of the existing review model at
// project scale: the live pending changes (getAllPending) grouped by document. Left = a 292px doc-nav
// rail (count header + progress bar + one row per changed doc with a check "reviewed" / filled-dot
// "current" / hollow-dot "pending" glyph + count); centre = the current document's change cards, each
// showing the change in context, a `decision . line NN` source chip, and a filled-dot "High" / half-dot
// "Inferred" confidence chip (D24-A). Accept / Tweak / Reject per card and the sticky bar (Accept all here /
// Next / Accept all remaining) post messages the editor routes to the EXISTING engine
// (approve/reject plus the captured-set bulk path); the C6 Review rail consumes the same model and stays in sync.
export function renderReviewProject(state: IScreenState): string {
	const rp = state.reviewProject;
	const pending = rp?.pending ?? [];
	const groups = groupPendingByDoc(pending);
	const folderName = rp?.folderName ?? 'Project';
	const projectAv = avatar(folderName);
	const reviewed = rp?.reviewedDocs ?? [];

	// The 48px topbar: project avatar + name crumb + `Review project update` + the attached source pill.
	// The right side reports the session totals from the reviewed set - honest zeros when nothing has been
	// reviewed yet. The bulk verb posts `reviewAcceptAllRemaining`, which captures the everywhere set; shown
	// only while something is still pending.
	const sourcePill = rp?.source
		? `<span style="font:${TYPE.provenance};color:${INDIGO.base};background:${INDIGO.tint};border:1px solid ${INDIGO.tintBorder};border-radius:${RADIUS.pill};padding:4px 10px">${esc(rp.source)}</span>`
		: '';
	const totalRemaining = pending.length;
	// The bulk verb is quiet text (comp 2b): approving everything at once is the single click that can move
	// the most work, so it must not look like the thing to press. It is never green and never red - a bulk
	// approve is not a state, and the trailing ellipsis promises the confirm that follows.
	const acceptRemaining = totalRemaining
		? `<button data-msg="reviewAcceptAllRemaining" style="${BTN_QUIET}">Approve all ${totalRemaining}&hellip;</button>`
		: '';
	const topBar = `<div style="height:48px;flex:none;display:flex;align-items:center;gap:12px;padding:0 18px;border-bottom:1px solid ${HAIRLINE.strong};background:${PAPER.rail}">
		<span style="width:20px;height:20px;border-radius:6px;background:${AVATAR_NAVY};display:flex;align-items:center;justify-content:center;color:${PAPER.card};font:600 10px/1 ${FONT.sans}">${projectAv.text}</span>
		<span style="font:${TYPE.uiBodyStrong};color:${INK.heading}">${esc(folderName)}</span><span style="color:${INK.meta}">/</span><span style="font:${TYPE.uiBody};color:${INK.meta}">Review project update</span>
		${sourcePill}
		<div style="margin-left:auto;display:flex;align-items:center;gap:12px"><span style="font:${TYPE.secondary};color:${INK.secondary}">${reviewed.length} reviewed</span>${acceptRemaining}</div>
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
		return `<div class="screen">${topBar}<div style="flex:1;display:flex;align-items:center;justify-content:center;background:${PAPER.page};padding:40px">
			<div style="text-align:center;max-width:420px">
				<div style="width:44px;height:44px;margin:0 auto 16px;border-radius:${RADIUS.card};background:${GREEN.bg};border:1px solid ${GREEN.border};display:flex;align-items:center;justify-content:center;font-size:20px;color:${GREEN.base}">${glyph}</div>
				<h2 style="margin:0 0 10px;font:${TYPE.bannerHeadline};color:${INK.heading}">${heading}</h2>
				<p style="margin:0;font:${TYPE.uiBody};color:${INK.secondary}">${body}</p>
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
	// Green on the bar because it reports work already settled, and the progress line under it is the plain
	// "N of M reviewed" sentence the ledger reads by (comp 2b).
	const header = `<div style="padding:17px 18px;border-bottom:1px solid ${HAIRLINE.medium}">
		<div style="font:${TYPE.uiBodyStrong};color:${INK.heading};margin-bottom:10px">${docTotal} document${docTotal === 1 ? '' : 's'} &middot; ${changeTotal} change${changeTotal === 1 ? '' : 's'}</div>
		<div style="height:5px;background:${HAIRLINE.strong};border-radius:3px;overflow:hidden"><div style="width:${pct}%;height:100%;background:${GREEN.base};border-radius:3px"></div></div>
		<div style="font:${TYPE.secondary};color:${INK.secondary};margin-top:7px">${reviewedCount} of ${docTotal} reviewed</div>
	</div>`;

	// Reviewed docs (0 pending) come first as muted check rows showing the HUMAN title (not the docId URI),
	// then the still-pending docs. A reviewed doc has no changes left, so it is not in `groups` - it shows
	// here once the editor derives it (a seen doc, now zero pending) via `reviewedDocsFromSeen`.
	const rowText = `flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis`;
	const reviewedRows = reviewed.map(r => `<div style="display:flex;align-items:center;gap:9px;padding:8px 10px">
		<span style="color:${GREEN.base};font-size:12px;width:13px;text-align:center">&#10003;</span>
		<span style="font:${TYPE.meta};color:${INK.meta};${rowText}">${esc(r.title)}</span>
	</div>`).join('');

	// The count on each row is a fact about the document, so it is mono; the current row takes the indigo
	// tint and a 3px indigo edge - indigo is Abstract acting, and this is the row it is acting on.
	const rows = groups.map(g => {
		const isCurrent = g.docId === currentDocId;
		const count = g.changes.length;
		if (isCurrent) {
			return `<div data-msg="reviewDoc" data-arg="${esc(g.docId)}" style="display:flex;align-items:center;gap:9px;padding:8px 10px;border-radius:${RADIUS.control};background:${INDIGO.tint};border:1px solid ${INDIGO.tintBorder};position:relative;cursor:pointer">
				<span style="position:absolute;left:0;top:7px;bottom:7px;width:3px;border-radius:3px;background:${INDIGO.base}"></span>
				<span style="width:13px;display:flex;justify-content:center"><span style="width:7px;height:7px;border-radius:${RADIUS.pill};background:${INDIGO.base}"></span></span>
				<span style="font:600 12px/1.5 ${FONT.sans};color:${INK.heading};${rowText}">${esc(g.docTitle)}</span>
				<span style="font:${TYPE.provenanceInline};color:${INDIGO.base}">${count}</span>
			</div>`;
		}
		return `<div data-msg="reviewDoc" data-arg="${esc(g.docId)}" style="display:flex;align-items:center;gap:9px;padding:8px 10px;cursor:pointer">
			<span style="color:${PAPER.frameBorder};font-size:12px;width:13px;text-align:center">&#9675;</span>
			<span style="font:${TYPE.meta};color:${INK.body};${rowText}">${esc(g.docTitle)}</span>
			<span style="font:${TYPE.provenanceInline};color:${INK.meta}">${count}</span>
		</div>`;
	}).join('');

	return `<div style="width:292px;flex:none;background:${PAPER.rail};border-right:1px solid ${HAIRLINE.strong};display:flex;flex-direction:column;overflow:hidden">
		${header}
		<div style="flex:1;overflow:auto;padding:8px;display:flex;flex-direction:column;gap:1px">${reviewedRows}${rows}</div>
	</div>`;
}

// The centre review column (C5), on comp 2b's ledger grammar: the current document's title + a per-change
// card list. Each card states its kind in a mono badge, shows WAS/NOW blocks, and names its provenance and
// confidence in words. The bottom bar carries the still-attention count, the QUIET bulk verb, and the one
// indigo primary - `Next`, the only thing on the bar that moves you forward rather than deciding for you.
// All actions drive the EXISTING engine (24.2): the bulk verb -> approveAll(docId), `Next` -> advance the
// current doc (nextPendingDocId), the per-card Approve/Reject/Edit -> approve/reject/focusChange.
function reviewColumn(changes: readonly IProposedChange[], docId: string, docTitle: string, currentIndex: number, groups: readonly { docId: string; docTitle: string }[]): string {
	const total = groups.length;
	const eyebrow = `<div style="font:${TYPE.sectionLabel};letter-spacing:${TRACKING.sectionLabel};text-transform:uppercase;color:${INK.meta};margin-bottom:7px">Document ${currentIndex + 1} of ${total}</div>`;
	const cards = changes.map(reviewCard).join('');
	const inferredCount = changes.filter(c => reviewConfidence(c) === 'inferred').length;

	// `Next` advances to the next changed document; the label names it. Only shown when more than one
	// document still has changes (the editor computes the real target via nextPendingDocId when clicked).
	const next = groups[currentIndex + 1] ?? groups[0];
	const nextBtn = total > 1
		? `<button data-msg="reviewNext" data-arg="${esc(docId)}" style="${BTN_PRIMARY}">Next: ${esc(next.docTitle)} &#8594;</button>`
		: '';
	const attention = inferredCount
		? `${inferredCount} change${inferredCount === 1 ? '' : 's'} need${inferredCount === 1 ? 's' : ''} your eyes`
		: 'All changes look confident';
	const bottomBar = `<div style="flex:none;height:64px;border-top:1px solid ${HAIRLINE.medium};background:${PAPER.rail};display:flex;align-items:center;padding:0 40px;gap:14px">
		<span style="font:${TYPE.secondary};color:${INK.secondary}">${attention}</span>
		<div style="margin-left:auto;display:flex;align-items:center;gap:10px">
			<button data-msg="reviewAcceptAllHere" data-arg="${esc(docId)}" style="${BTN_QUIET}">Approve all ${changes.length} here${buildBulkSet({ verb: 'approve', docId }, changes).confirmNeeded ? '&hellip;' : ''}</button>
			${nextBtn}
		</div>
	</div>`;

	return `<div style="flex:1;overflow:hidden;background:${PAPER.page};display:flex;flex-direction:column">
		<div style="flex:1;overflow:auto;padding:30px 40px 30px">
			<div style="max-width:720px">
				${eyebrow}
				<h1 style="font:${TYPE.screenTitle};letter-spacing:${TRACKING.screenTitle};color:${INK.heading};margin:0 0 3px">${esc(docTitle)}</h1>
				<p style="font:${TYPE.secondary};color:${INK.secondary};margin:0 0 24px">${changes.length} change${changes.length === 1 ? '' : 's'} proposed &middot; review each in context</p>
				${cards}
			</div>
		</div>
		${bottomBar}
	</div>`;
}

// One change card, on the round-2 ledger grammar (comp 2b). The kind is a mono badge coloured by risk, not a
// filled pill; the change reads as word-grain diff spans; the provenance and the confidence WORD share one
// quiet meta line; and Accept / Edit / Reject sit at the foot. A change the model only inferred paints the
// card amber, because "inferred" is exactly the state that is waiting on a human.
function reviewCard(change: IProposedChange): string {
	const level = reviewConfidence(change);
	const inferred = level === 'inferred';
	const cardStyle = inferred
		? `border:1px solid ${AMBER.border};border-radius:${RADIUS.card};padding:16px 18px;margin-bottom:13px;background:${AMBER.subtleBg}`
		: `border:1px solid ${HAIRLINE.strong};border-radius:${RADIUS.card};padding:16px 18px;margin-bottom:13px;background:${PAPER.card}`;

	// The change in context: the addition, then the removal struck through. A fill behind running text means
	// exactly one thing in this design system - "this span is changing" - so these are the only fills here.
	// An insertion (`insert`) has no oldText, so only the addition renders. Text is escaped: this is prose.
	const removal = !change.insert && change.oldText.trim()
		? ` <span style="background:${RED.diffBg};color:${RED.diffInk};text-decoration:line-through;border-radius:3px;padding:0 2px">${esc(change.oldText)}</span>`
		: '';
	const addition = change.newText.trim()
		? `<span style="background:${GREEN.diffBg};color:${GREEN.diffInk};border-radius:3px;padding:0 2px">${esc(change.newText)}</span>`
		: '';
	const prose = `<p style="font:${TYPE.docBody};color:${INK.body};margin:0 0 12px">${addition}${removal}</p>`;

	// The self-explaining framing (plan 31 iter 2): the kind badge + the model's rationale, so the cross-doc
	// card reads with the same kind / rationale / source / confidence order the inline widget and the rail do.
	// Round 2 makes the kind a mono badge coloured by risk (amber = needs your call, green = low risk) rather
	// than a bordered pill - the colour alone carries the risk, so the chrome around it is noise.
	const framing = reviewFraming(change, '');
	const kindChip = `<span style="${kindBadge(framing.kindAttention)}">${esc(framing.kindLabel)}</span>`;
	// Rationale only when the model supplied one (no filler, plan 31 iter 2).
	const why = framing.rationale
		? `<p style="font:${TYPE.secondary};color:${INK.secondary};margin:0 0 12px">${esc(framing.rationale)}</p>`
		: '';

	// The provenance atom + the confidence WORD on one meta line (never a percentage, per the design system).
	// The source reads `decision . line NN` when a real line is known, else just `decision` - never a
	// fabricated line. The verbatim decision quote (sourceQuote), when present, is its hover title.
	const hasLine = typeof change.sourceLine === 'number';
	const chipTitle = change.sourceQuote ? ` title="${esc(change.sourceQuote)}"` : '';
	const source = `<span${chipTitle} style="font:${TYPE.provenanceInline};color:${INK.secondary}">decision${hasLine ? ` &middot; line ${change.sourceLine}` : ''}</span>`;
	const confidence = inferred
		? localize("livingDocs.review.confidence.inferred", "confidence: inferred - needs your eyes")
		: localize("livingDocs.review.confidence.high", "confidence: high");
	const meta = `<div style="display:flex;align-items:center;gap:8px;font:${TYPE.meta};color:${INK.meta}">${source}<span>&middot;</span><span>${esc(confidence)}</span></div>`;

	// Tweak (amend-before-approve, plan 31 iter 3, D31-A): the same in-place editor the inline widget offers.
	// Edit opens a contenteditable over the proposed text; Save & Approve amends the pending change then
	// approves through the one engine path (reviewTweakSave); Cancel restores. Hidden for a figure (figures
	// come from sources). The secondary "Open in document" navigate-through is kept as a card link (D31-A).
	const canTweak = change.kind !== 'figure';
	const editor = canTweak
		? `<div class="rv-tweakwrap" style="display:none;margin:0 0 12px"><div class="rv-tweakedit" contenteditable="true" data-orig="${esc(change.newText)}" style="border:1px solid ${AMBER.border};border-radius:${RADIUS.input};padding:10px 13px;font:${TYPE.docBody};color:${INK.body};background:${AMBER.subtleBg};outline:none">${esc(change.newText)}</div></div>`
		: '';
	const secondary = `font:${TYPE.uiBodyStrong};color:${INK.body};background:${PAPER.card};border:1px solid ${PAPER.control};border-radius:${RADIUS.control};padding:7px 16px;cursor:pointer`;
	const primary = `font:${TYPE.uiBodyStrong};color:#fff;background:${INDIGO.base};border:none;border-radius:${RADIUS.control};padding:7px 20px;cursor:pointer`;
	const quiet = `font:${TYPE.secondary};color:${INK.secondary};background:none;border:none;padding:7px 6px;cursor:pointer`;
	const tweakBtn = canTweak
		? `<button data-tweak-open style="${secondary}">${esc(localize("livingDocs.review.edit", "Edit"))}</button>`
		: '';
	// Actions wired to the EXISTING engine (24.2): Accept -> approve(id), Reject -> reject(id).
	const normalActs = `<span class="rv-normacts" style="display:flex;gap:8px">
		<button data-msg="reviewAccept" data-arg="${esc(change.id)}" style="${primary}">${esc(localize("livingDocs.review.approve", "Approve"))}</button>
		${tweakBtn}
		<button data-msg="reviewReject" data-arg="${esc(change.id)}" style="${secondary}">${esc(localize("livingDocs.review.reject", "Reject"))}</button>
	</span>`;
	const tweakActs = canTweak
		? `<span class="rv-tweakacts" style="display:none;gap:8px">
		<button data-tweak-save data-arg="${esc(change.id)}" style="${primary}">${esc(localize("livingDocs.review.saveApprove", "Save and approve"))}</button>
		<button data-tweak-cancel style="${quiet}">${esc(localize("livingDocs.review.cancel", "Cancel"))}</button>
	</span>`
		: '';
	const openLink = `<button data-msg="reviewTweak" data-arg="${esc(change.id)}" style="${quiet}" title="${esc(localize("livingDocs.review.openInDoc.title", "Open in the document"))}">${esc(localize("livingDocs.review.openInDoc", "Open in document"))} &#8599;</button>`;
	const actions = `<div style="margin-left:auto;display:flex;align-items:center;gap:8px">${openLink}${normalActs}${tweakActs}</div>`;

	return `<div class="rv-card" style="${cardStyle}">
		<div style="display:flex;align-items:center;gap:8px;margin:0 0 10px">${kindChip}</div>
		${prose}
		${why}
		${editor}
		<div style="display:flex;align-items:center;gap:12px">${meta}${actions}</div>
	</div>`;
}
