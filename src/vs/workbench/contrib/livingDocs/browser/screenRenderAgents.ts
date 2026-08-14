/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Agents (round 2, comp panel 3a): the live registry list, the de-IDE'd agent detail page, the activity
// ledger and the cross-project skill-run strip - repainted onto the warm-paper design system
// (docs/28-design-system-round2.md). Only `renderAgents` is public. Split out of screenRender.ts so the
// Knowledge + Agents lane owns its own file; shared helpers come from the shell.
//
// The correction this screen is judged on (comp caption 3a): "three questions instead of a pipeline". The
// detail page used to draw the machine's flow graph - trigger, sources, agent, verify gate, policy gate,
// documents, review rail - which is an IDE's answer to a question nobody asked. A reader has exactly three
// questions about an agent: when does it run, what may it touch, and what may it do without asking me. So the
// graph is gone and the page answers those three, in three cards. Every control the graph strip carried moved
// into the card that answers its question (the trigger editor into WHEN IT RUNS, the policy dial into WITHOUT
// ASKING, IT MAY), so the diagram left and no behaviour left with it.
//
// Real data only, everywhere: the schedule words are the agent's true trigger, the documents and sources are
// its declared flow (an empty flow honestly reads "every document in this project" rather than a fabricated
// list), and every receipt row is a persisted run.

import { localize } from '../../../../nls.js';
import { AgentTriggerKind, IAgentDef, IAgentRun, IAgentTrigger, ISkillRunSummary } from '../common/livingDocsModel.js';
import { agentPolicyTable, agentPolicyToLevel } from '../common/agentPolicyGrammar.js';
import { docPolicyToneHex, DocPolicyTone } from '../common/docPolicy.js';
import { IActivityLedger, ILedgerEntry } from '../common/livingDocLedger.js';
import { AMBER, FONT, GREEN, HAIRLINE, INDIGO, INK, PAPER, RADIUS, RED, SHADOW, TRACKING, TYPE } from '../common/abstractTokens.js';
import { renderPolicyEditor } from './policyEditorRender.js';
import { esc, IScreenState } from './screenRenderShell.js';

// ---- Agents: the card grid (A1/A2) and the de-IDE'd detail page for one agent (comp 3a). ----
export function renderAgents(state: IScreenState): string {
	const open = state.openAgentId ? state.agents.find(a => a.id === state.openAgentId) : undefined;
	return open ? renderAgentCanvas(open, state) : renderAgentCards(state);
}

const AGENT_ICON: Record<string, string> = { cron: '&#10227;', heartbeat: '&#9673;', event: '&#8853;', lifecycle: '&#9638;', manual: '&#9654;' };

function base(path: string): string { return esc(path.split('/').pop() ?? path); }

// A mono section label - the ONE way a group of cards or rows is named on this screen ("WHEN IT RUNS",
// "RECENT RUNS", "ACTIVITY"). The comp draws it at the kind-badge size with the section-label tracking.
function sectionLabel(text: string): string {
	return `<span style="font:${TYPE.kindBadge};letter-spacing:${TRACKING.sectionLabel};color:${INK.secondary}">${text}</span>`;
}

// The state dot at its two DS sizes (banner 11px, card/row 7px). One dot, one meaning: green is a settled
// all-clear, amber wants you, red failed, and the frame-border grey means nothing happened at all.
function stateDot(colour: string, size = 7): string {
	return `<span style="width:${size}px;height:${size}px;flex:none;border-radius:${RADIUS.pill};background:${colour}"></span>`;
}

// The agent's live status as the comp draws it (3a): a 7px dot plus ONE plain word, in the dot's own ink.
// This is the only place the detail page states status - the DS has no permanent status pill, so state shows
// where it means something. Every registry status keeps a word, so nothing the round-1 badge said is lost.
function liveStatus(agent: IAgentDef): string {
	const dot = (colour: string, ink: string, word: string) =>
		`<span style="display:inline-flex;align-items:center;gap:6px;font:${TYPE.secondary};color:${ink}">${stateDot(colour)}${word}</span>`;
	if (agent.disabled) { return dot(PAPER.frameBorder, INK.secondary, localize('livingDocs.agents.status.paused', "paused")); }
	switch (agent.status) {
		// Indigo is "Abstract acting", so a run in flight is indigo - never amber, which would claim the
		// reader owes it a decision.
		case 'running': return dot(INDIGO.base, INDIGO.base, localize('livingDocs.agents.status.running', "running"));
		case 'needs-approval': return dot(AMBER.base, AMBER.label, localize('livingDocs.agents.status.needsYou', "waiting on you"));
		case 'blocked': return dot(RED.base, RED.base, localize('livingDocs.agents.status.blocked', "blocked"));
		case 'error': return dot(RED.base, RED.base, localize('livingDocs.agents.status.error', "last run failed"));
		default: return dot(GREEN.base, GREEN.base, localize('livingDocs.agents.status.on', "on"));
	}
}

// The one-line, plain-language purpose of an agent (A2.2), derived from its real trigger + flow - never
// fabricated. Names the real documents it feeds when the flow declares them, else the honest "all documents".
function agentPurpose(a: IAgentDef): string {
	const docs = a.flow.docs.length ? a.flow.docs.map(base).join(' and ') : 'the project documents';
	switch (a.trigger.kind) {
		case 'cron': return `Keeps ${docs} current on a ${esc(a.trigger.cron ?? 'schedule')} schedule.`;
		case 'heartbeat': return `Sweeps ${docs} for stale figures every ${a.trigger.everyHours ?? 6} hours.`;
		case 'event': return `Refreshes ${docs} when ${a.trigger.source && a.trigger.source !== '*' ? esc(base(a.trigger.source)) : 'a source'} changes.`;
		case 'lifecycle': return `Runs against ${docs} ${a.trigger.lifecycle === 'before-export' ? 'before an export' : a.trigger.lifecycle === 'on-publish' ? 'on publish' : 'on open'}.`;
		default: return `Runs against ${docs} when you ask.`;
	}
}

// The count of sources an active agent watches (A2.1 "watching N sources"): the agent's own declared flow
// sources when it names them, else the whole project's source registry (an empty flow means "all sources").
// Real numbers only - it counts the live registry, never a made-up figure.
function watchingCount(a: IAgentDef, state: IScreenState): number {
	return a.flow.sources.length ? a.flow.sources.length : (state.sources?.length ?? 0);
}

// One agent card (A2): the tinted glyph tile + name + mono status line + the indigo pause/resume toggle; the
// one-line purpose; the three-tier policy table (values honestly mapped from the stored dial); and the footer
// (the real workspace model id + Edit policy, which reveals the SHARED policy editor).
function renderAgentCard(a: IAgentDef, state: IScreenState): string {
	const paused = !!a.disabled;
	// A2.1 glyph tile: 34px, radius 10; active = indigo tint on an indigo hairline; paused = the sunken paper.
	const tileBg = paused ? PAPER.sunken : INDIGO.tint;
	const tileBorder = paused ? HAIRLINE.strong : INDIGO.tintBorder;
	const tileFg = paused ? INK.secondary : INDIGO.hover;
	const glyph = AGENT_ICON[a.trigger.kind] ?? '&#9679;';
	// A2.1 status line (mono 10px): a filled dot + "active - watching N sources" in the all-clear green, or a
	// hollow dot + "paused" in meta ink. The dots are HTML entities (filled &#9679; / hollow &#9675;).
	const n = watchingCount(a, state);
	const statusLine = paused
		? `<span style="display:block;font:400 10px/1.3 ${FONT.mono};color:${INK.meta}">&#9675; paused</span>`
		: `<span style="display:block;font:400 10px/1.3 ${FONT.mono};color:${GREEN.base}">&#9679; active &middot; watching ${n} source${n === 1 ? '' : 's'}</span>`;
	// A2.1 toggle (36x20, knob 16): indigo when active, control grey when paused; posts pause/resume via
	// setAgentDisabled.
	const toggleMsg = paused ? 'resumeAgent' : 'pauseAgent';
	const toggleBg = paused ? PAPER.control : INDIGO.base;
	const knob = paused ? 'left:2px' : 'right:2px';
	const toggle = `<button data-msg="${toggleMsg}" data-arg="${esc(a.id)}" data-stop title="${paused ? 'Resume this agent' : 'Pause this agent'}" style="flex:none;width:36px;height:20px;border:none;border-radius:${RADIUS.pill};background:${toggleBg};position:relative;cursor:pointer;padding:0"><span style="position:absolute;${knob};top:2px;width:16px;height:16px;border-radius:${RADIUS.pill};background:${PAPER.card}"></span></button>`;
	// A2.2 policy table: label + right-aligned coloured value, EXACTLY the three-tier grammar, honestly mapped.
	// The tone colours come from the shared grammar (docPolicyToneHex), never from a local hex, so this table,
	// the detail page's third question card and the document's own dial cannot speak different colours.
	const rows = agentPolicyTable(a.policy).map(row => policyRow(row.label, row.level === 'auto-apply' ? 'ok' : row.level === 'ask-first' ? 'attention' : 'removed')).join('');
	// A2.3 footer: the real workspace model id (omitted when the broker is unreachable) + the Edit policy link,
	// which reveals the SHARED plain-language policy editor (the same component as Properties). A model id is a
	// metadata value, so it is NOT mono (DS: mono is reserved for section labels, badges and provenance facts).
	const modelId = state.agentModelId
		? localize('livingDocs.agents.card.runsOn', "runs on {0}", esc(state.agentModelId))
		: localize('livingDocs.agents.card.noModel', "no model connected yet");
	const footer = `<div style="margin-top:12px;padding-top:12px;border-top:1px solid ${HAIRLINE.medium};display:flex;align-items:center;gap:8px"><span style="font:${TYPE.secondary};color:${INK.meta}">${modelId}</span><span style="flex:1"></span><a href="#" data-agent-policy-edit style="font:${TYPE.secondary};color:${INDIGO.base};text-decoration:none;cursor:pointer">${localize('livingDocs.agents.card.editPolicy', "Edit policy")}</a></div>`;
	// The shared policy editor, hidden until Edit policy reveals it (A2.3): the SAME renderPolicyEditor DOM the
	// doc Properties panel hosts, keyed by the agent id, its current selection the honest per-agent level.
	const policyEditor = `<div data-agent-policy-box style="display:none;margin-top:12px;padding-top:12px;border-top:1px solid ${HAIRLINE.medium}">${renderPolicyEditor({ selected: agentPolicyToLevel(a.policy), name: a.id })}</div>`;
	// A2.5 doors (CD-1 fix): the card is the primary door - the whole card opens the agent's detail page by
	// mouse (data-msg openAgent) and by keyboard (role=button + tabindex + data-keyactivate fires the same click
	// on Enter/Space). An explicit Open + Run-now action row keeps the doors discoverable and gives the roster a
	// one-click run; both carry data-stop so they post their own message instead of the card's open. Every inner
	// control (toggle, Edit policy, policy rows) already stops propagation, so the card-open never fires on top.
	const openLabel = localize('livingDocs.agents.card.open', "Open");
	const runLabel = localize('livingDocs.agents.card.runNow', "Run now");
	const actions = `<div style="margin-top:12px;display:flex;align-items:center;gap:8px">
		<button data-msg="openAgent" data-arg="${esc(a.id)}" data-stop style="border:1px solid ${PAPER.control};border-radius:${RADIUS.control};padding:8px 14px;background:${PAPER.card};color:${INK.bodySoft};font:${TYPE.uiBodyStrong};cursor:pointer">${openLabel}</button>
		<span style="flex:1"></span>
		<button data-msg="runWf" data-arg="${esc(a.id)}" data-stop style="border:none;border-radius:${RADIUS.control};padding:8px 14px;background:${INDIGO.base};color:${PAPER.card};font:${TYPE.uiBodyStrong};cursor:pointer">&#9654; ${runLabel}</button>
	</div>`;
	const openHint = localize('livingDocs.agents.card.openHint', "Open {0}", a.name);
	return `<div data-agent-card data-msg="openAgent" data-arg="${esc(a.id)}" data-keyactivate role="button" tabindex="0" aria-label="${esc(openHint)}" style="flex:1 1 320px;min-width:300px;max-width:520px;background:${PAPER.card};border:1px solid ${HAIRLINE.strong};border-radius:${RADIUS.cardLarge};padding:18px 20px;box-shadow:${SHADOW.card};cursor:pointer${paused ? ';opacity:.75' : ''}">
		<div style="display:flex;align-items:center;gap:12px;margin-bottom:8px">
			<span style="flex:none;width:34px;height:34px;border-radius:${RADIUS.input};background:${tileBg};border:1px solid ${tileBorder};display:flex;align-items:center;justify-content:center;color:${tileFg};font-size:15px">${glyph}</span>
			<span style="min-width:0"><span style="display:block;font:600 14.5px/1.25 ${FONT.sans};color:${INK.heading}">${esc(a.name)}</span>${statusLine}</span>
			<span style="flex:1"></span>${toggle}
		</div>
		<div style="font:400 12.5px/1.55 ${FONT.sans};color:${INK.bodySoft};margin-bottom:12px">${esc(agentPurpose(a))}</div>
		<div style="display:flex;flex-direction:column;gap:8px">${rows}</div>
		${footer}${actions}${policyEditor}
	</div>`;
}

// The Agents card grid (A1, A2): the no-rails shell, the trust-contract framing line, one card per agent and
// the dashed New-agent tile. The header pill (agent health) is published by the ScreenEditor to the one global
// Abstract header (plan 44), not drawn here.
function renderAgentCards(state: IScreenState): string {
	const agents = state.agents;
	const cards = agents.map(a => renderAgentCard(a, state)).join('');
	// A2.4 dashed New-agent tile: opens the existing create flow ("from a skill or from scratch").
	const newTile = `<div data-msg="createAgent" style="width:280px;flex:none;border:1px dashed ${PAPER.frameBorder};border-radius:${RADIUS.cardLarge};display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;color:${INK.secondary};cursor:pointer;min-height:180px"><span style="font-size:22px">&#65291;</span><span style="font:600 13px/1 ${FONT.sans}">${localize('livingDocs.agents.newAgent', "New agent")}</span><span style="font:400 11.5px/1 ${FONT.sans};color:${INK.meta}">${localize('livingDocs.agents.newAgent.sub', "from a skill or from scratch")}</span></div>`;
	const emptyLine = agents.length
		? ''
		: `<div style="font:400 13px/1.6 ${FONT.sans};color:${INK.secondary};max-width:520px;margin-bottom:20px">No agents yet. Create one to keep your documents current when their sources change.</div>`;
	// The project fan-out door (CD-1 fix): "Run across the project" opens the whole-project run surface - the
	// same entry the project-run idle screen's "Go to Agents" button promises, now honoured. runProject had no
	// emitter before this; the header carries it so the wedge fan-out is reachable from the Agents screen.
	const runProjectLabel = localize('livingDocs.agents.runProject', "Run across the project");
	const runProjectBtn = `<button data-msg="runProject" style="flex:none;display:inline-flex;align-items:center;gap:8px;border:none;border-radius:${RADIUS.control};padding:10px 16px;background:${INDIGO.base};color:${PAPER.card};font:600 13px/1 ${FONT.sans};cursor:pointer">&#10022; ${runProjectLabel}</button>`;
	return `<div class="screen">
	<div class="scr-body">
		<div style="max-width:1180px;margin:0 auto;padding:56px 48px 80px">
			<div style="display:flex;align-items:flex-start;gap:16px;margin-bottom:6px"><div style="flex:1;min-width:0"><div style="font:${TYPE.screenTitle};letter-spacing:${TRACKING.screenTitle};color:${INK.heading}">Agents</div></div>${runProjectBtn}</div>
			<div style="font:400 14.5px/1.45 ${FONT.sans};color:${INK.bodySoft};margin-bottom:32px">Agents only act on documents that opted in. Every action lands in the ledger below.</div>
			${emptyLine}
			<div style="display:flex;flex-wrap:wrap;gap:16px;align-items:stretch">${cards}${newTile}</div>
			${renderAgentLedger(state)}
		</div>
	</div>
</div>`;
}

// The ledger's mono timestamp (A3.1, 52px column): a calendar-style stamp computed at render time from the
// event epoch + the injected render clock (never Date.now here - the ScreenEditor supplies `ledgerNow`). Today
// reads as "HH:MM", this week as the weekday ("Fri"), older as "D Mon"; a WAITING row (no recorded time, at 0)
// reads as "now" - the live, unresolved call. Deterministic given `now`, so the snapshot tests are stable.
const LEDGER_DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const LEDGER_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function ledgerStamp(at: number, now: number): string {
	if (at <= 0) { return 'now'; }
	const then = new Date(at);
	const today = new Date(now);
	const sameDay = then.getFullYear() === today.getFullYear() && then.getMonth() === today.getMonth() && then.getDate() === today.getDate();
	if (sameDay) {
		const hh = String(then.getHours()).padStart(2, '0');
		const mm = String(then.getMinutes()).padStart(2, '0');
		return `${hh}:${mm}`;
	}
	const ageDays = Math.floor((now - at) / 86400000);
	if (ageDays < 7) { return LEDGER_DAYS[then.getDay()]; }
	return `${then.getDate()} ${LEDGER_MONTHS[then.getMonth()]}`;
}

// The status dot (A3.1, 7px): amber waiting / green applied / grey admin. Exactly the three tiers - no fourth.
const LEDGER_DOT: Record<ILedgerEntry['kind'], string> = { waiting: AMBER.base, applied: GREEN.base, admin: PAPER.frameBorder };

// The right-aligned mono badge (A3.1): an amber WAITING pill on the quiet amber fill; a green "auto-applied ·
// reversible"; a meta "by <user>" / administrative note. The badge text is the read model's; the styling is
// the tier's. The middot in the badge copy is written as its HTML entity for the source-hygiene rule.
function ledgerBadge(entry: ILedgerEntry): string {
	const text = esc(entry.badge).replace(/ · /g, ' &middot; ');
	const badge = `font:${TYPE.kindBadge};letter-spacing:${TRACKING.kindBadge}`;
	if (entry.kind === 'waiting') {
		return `<span style="${badge};color:${AMBER.label};background:${AMBER.subtleBg};border:1px solid ${AMBER.border};border-radius:${RADIUS.pill};padding:3px 8px">${text}</span>`;
	}
	if (entry.kind === 'applied') {
		return `<span style="${badge};color:${GREEN.base}">${text}</span>`;
	}
	return `<span style="${badge};color:${INK.meta}">${text}</span>`;
}

// One ledger row's plain-language sentence (A3.1, 13px): the lead text, then - when the event names a real
// document - the doc link citing its gutter address ("Weekly Summary · line 6", A3.3). A WAITING row's link is
// a deep link into that document's Review tab (posts `ledgerReview` with the durable block id, surviving the
// closed-doc path); every other doc link opens the document. Plain text with no doc reads as a bare sentence.
function ledgerSentence(entry: ILedgerEntry): string {
	const lead = esc(entry.lead);
	const tail = esc(entry.tail);
	const line = `flex:1;min-width:0;font:400 13px/1.4 ${FONT.sans};color:${INK.body}`;
	if (!entry.doc) {
		return `<span style="${line}">${lead}${tail}</span>`;
	}
	const label = esc(entry.doc.label).replace(/ · /g, ' &middot; ');
	const msg = entry.deepLink ? 'ledgerReview' : 'openDoc';
	const blockAttr = entry.deepLink && entry.doc.blockId ? ` data-block="${esc(entry.doc.blockId)}"` : '';
	const link = `<a data-msg="${msg}" data-arg="${esc(entry.doc.docId)}"${blockAttr} data-stop href="#" style="color:${INDIGO.base};text-decoration:none;cursor:pointer">${label}</a>`;
	return `<span style="${line}">${lead}${link}${tail}</span>`;
}

// The activity ledger (A3): the ACTIVITY label + a white, bordered chronological list (newest first), each row
// a mono timestamp (52px col) · 7px status dot · plain-language sentence · right mono badge. Rows come straight
// from the read model (A3.2, real events only); the truncation line is honest (A3.4). A truthful empty state
// renders when the project has no recorded activity yet - never a fabricated row.
function renderAgentLedger(state: IScreenState): string {
	const ledger: IActivityLedger | undefined = state.ledger;
	const now = state.ledgerNow ?? 0;
	const label = `<div style="margin:34px 0 10px">${sectionLabel('ACTIVITY')}</div>`;
	const frame = `background:${PAPER.card};border:1px solid ${HAIRLINE.strong};border-radius:${RADIUS.card}`;
	if (!ledger || ledger.entries.length === 0) {
		// A3.2 truthful empty state: no rows fabricated - a plain line inside the same bordered frame.
		return `${label}<div style="${frame};padding:22px 18px;font:${TYPE.uiBody};color:${INK.secondary}">No agent or review activity yet. When an agent runs or you approve a change, it lands here.</div>`;
	}
	const rows = ledger.entries.map((entry, i) => {
		const last = i === ledger.entries.length - 1 && !ledger.truncated;
		const border = last ? '' : `;border-bottom:1px solid ${HAIRLINE.medium}`;
		return `<div style="display:flex;align-items:center;gap:12px;padding:12px 18px${border}">
			<span style="font:${TYPE.sectionLabel};color:${INK.meta};width:52px;flex:none">${esc(ledgerStamp(entry.at, now))}</span>
			${stateDot(LEDGER_DOT[entry.kind])}
			${ledgerSentence(entry)}
			${ledgerBadge(entry)}
		</div>`;
	}).join('');
	// A3.4 honest truncation line: shown only when the fold produced more than the cap - older activity lives
	// in each document's History tab.
	const more = ledger.truncated
		? `<div style="padding:11px 18px;border-top:1px solid ${HAIRLINE.medium};font:${TYPE.secondary};color:${INK.meta}">Showing the most recent ${ledger.entries.length}. Older activity lives in each document's History.</div>`
		: '';
	return `${label}<div style="${frame};overflow:hidden">${rows}${more}</div>`;
}

// ---- The de-IDE'd agent detail page (comp 3a). ----

// The weekday a cron day abbreviation names, in the plural the comp speaks ("Mondays at 9:00"): a schedule is
// a habit, not a single date.
function dayWord(abbrev: string): string {
	switch (abbrev) {
		case 'Mon': return localize('livingDocs.agents.day.mon', "Mondays");
		case 'Tue': return localize('livingDocs.agents.day.tue', "Tuesdays");
		case 'Wed': return localize('livingDocs.agents.day.wed', "Wednesdays");
		case 'Thu': return localize('livingDocs.agents.day.thu', "Thursdays");
		case 'Fri': return localize('livingDocs.agents.day.fri', "Fridays");
		case 'Sat': return localize('livingDocs.agents.day.sat', "Saturdays");
		case 'Sun': return localize('livingDocs.agents.day.sun', "Sundays");
		default: return esc(abbrev);
	}
}

// The agent's real trigger in plain words (3a, card 1's headline). Never the stored cron string itself:
// "Mon 09:00" is a machine fact, and this page is de-IDE'd - the machine fact stays in the editor chip below,
// where it is a control rather than a claim.
function scheduleWords(t: IAgentTrigger): string {
	switch (t.kind) {
		case 'cron': {
			const match = /^(?<day>\w{3})\s+(?<hour>\d{1,2}):(?<minute>\d{2})$/.exec(t.cron ?? '');
			if (!match?.groups) { return localize('livingDocs.agents.when.cronUnset', "On a weekly schedule"); }
			return localize('livingDocs.agents.when.cron', "{0} at {1}:{2}", dayWord(match.groups.day), Number(match.groups.hour), match.groups.minute);
		}
		case 'heartbeat': {
			const hours = t.everyHours ?? 6;
			return hours === 1
				? localize('livingDocs.agents.when.hourly', "Every hour")
				: localize('livingDocs.agents.when.everyHours', "Every {0} hours", hours);
		}
		case 'event': return (!t.source || t.source === '*')
			? localize('livingDocs.agents.when.anySource', "When any source changes")
			: localize('livingDocs.agents.when.source', "When {0} changes", base(t.source));
		case 'lifecycle': switch (t.lifecycle) {
			case 'before-export': return localize('livingDocs.agents.when.beforeExport', "Before every export");
			case 'on-publish': return localize('livingDocs.agents.when.onPublish', "Whenever a document is published");
			default: return localize('livingDocs.agents.when.onOpen', "Whenever a document is opened");
		}
		default: return localize('livingDocs.agents.when.manual', "Only when you ask");
	}
}

// One of the three question cards (3a): a white card on a strong hairline, radius 14, its mono question at the
// top and its answer beneath. `attrs` lets a card carry the shell's delegation hooks (the policy card is a
// [data-agent-card] so the shared Edit-policy toggle finds its editor box).
function questionCard(question: string, body: string, attrs = ''): string {
	return `<div${attrs ? ` ${attrs}` : ''} style="min-width:0;background:${PAPER.card};border:1px solid ${HAIRLINE.strong};border-radius:${RADIUS.cardLarge};padding:20px 22px;display:flex;flex-direction:column;gap:12px">
		${sectionLabel(question)}
		${body}
	</div>`;
}

// The answer headline of a question card: 15/600 in heading ink - one short, true sentence fragment.
function cardHeadline(text: string): string {
	return `<div style="font:600 15px/1.35 ${FONT.sans};color:${INK.heading}">${text}</div>`;
}

// A card's closing helper line: 12.5 in meta ink, with any link in indigo.
function cardNote(html: string): string {
	return `<div style="font:${TYPE.secondary};color:${INK.meta};line-height:1.55">${html}</div>`;
}

function cardLink(html: string, attrs: string): string {
	return `<a href="#" ${attrs} style="color:${INDIGO.base};text-decoration:none;cursor:pointer">${html}</a>`;
}

// Question 1 - WHEN IT RUNS. The schedule in plain words, then the REAL trigger editor (the same
// data-trigger-box the flow-graph page carried, repainted as sunken chips so it reads as a control rather
// than a form), then the honest second line: what else wakes it. A cron agent is not woken by a source change,
// so this line never claims one - it states the trigger that is always true (a manual Run now), and a paused
// agent says the schedule is being skipped instead.
function whenCard(agent: IAgentDef): string {
	const t = agent.trigger;
	const chip = `font:400 13px/1.2 ${FONT.sans};color:${INK.body};padding:6px 12px;border:1px solid ${PAPER.control};border-radius:${RADIUS.control};background:${PAPER.sunken}`;
	const hint = `font:${TYPE.secondary};color:${INK.meta}`;
	const kindOpt = (v: string, label: string) => `<option value="${v}"${t.kind === v ? ' selected' : ''}>${label}</option>`;
	const dayOpt = (v: string) => `<option value="${v}"${(t.cron ?? '').startsWith(v) ? ' selected' : ''}>${v}</option>`;
	const cronMatch = /^(?<day>\w{3})\s+(?<time>\d{2}:\d{2})$/.exec(t.cron ?? '');
	const cronTime = cronMatch?.groups ? cronMatch.groups.time : '09:00';
	// The kind <select> and its dependent fields keep their data-tfield/data-tgroup contract: the shell's script
	// shows the group matching the chosen kind and the Save button gathers the whole box into one message.
	const editor = `<div data-trigger-box style="display:flex;flex-wrap:wrap;align-items:center;gap:8px">
		<select data-tfield="kind" style="${chip};cursor:pointer">${kindOpt('cron', localize('livingDocs.agents.trigger.cron', "On a schedule"))}${kindOpt('heartbeat', localize('livingDocs.agents.trigger.heartbeat', "On a sweep"))}${kindOpt('event', localize('livingDocs.agents.trigger.event', "On a source change"))}${kindOpt('manual', localize('livingDocs.agents.trigger.manual', "Only when you ask"))}</select>
		<div data-tgroup="cron" style="display:${t.kind === 'cron' ? 'flex' : 'none'};gap:8px;align-items:center">
			<select data-tfield="day" style="${chip};cursor:pointer">${['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(dayOpt).join('')}</select>
			<input data-tfield="time" type="time" value="${cronTime}" style="${chip}" />
		</div>
		<div data-tgroup="heartbeat" style="display:${t.kind === 'heartbeat' ? 'flex' : 'none'};gap:8px;align-items:center">
			<input data-tfield="hours" type="number" min="1" value="${t.everyHours ?? 6}" style="${chip};width:70px" /><span style="${hint}">${localize('livingDocs.agents.trigger.hours', "hours between sweeps")}</span>
		</div>
		<div data-tgroup="event" style="display:${t.kind === 'event' ? 'flex' : 'none'};gap:8px;align-items:center">
			<input data-tfield="source" type="text" value="${esc(t.source ?? '*')}" placeholder="* (any source)" style="${chip};width:180px" /><span style="${hint}">${localize('livingDocs.agents.trigger.sourcePath', "source path, or * for any")}</span>
		</div>
		<button data-trigger-save data-arg="${esc(agent.id)}" style="border:none;border-radius:${RADIUS.control};padding:6px 12px;background:${INDIGO.base};color:${PAPER.card};font:600 12.5px/1.2 ${FONT.sans};cursor:pointer">${localize('livingDocs.agents.trigger.save', "Save")}</button>
	</div>`;
	const runNow = cardLink(localize('livingDocs.agents.when.runNowLink', "Run now"), `data-msg="runWf" data-arg="${esc(agent.id)}"`);
	// A paused agent keeps the round-1 promise verbatim: the scheduler skips it, a manual run still works.
	const note = agent.disabled
		? localize('livingDocs.agents.when.paused', "Paused - the scheduler skips this agent until you resume. {0} still works.", runNow)
		: localize('livingDocs.agents.when.alsoManual', "Also runs the moment you press {0}.", runNow);
	// `scheduleWords` already escapes the parts it interpolates (a source file name), so it is not escaped again.
	return questionCard(localize('livingDocs.agents.q.when', "WHEN IT RUNS"), `${cardHeadline(scheduleWords(t))}${editor}${cardNote(note)}`);
}

// Question 2 - WHAT IT MAY TOUCH. Counts and names come from the agent's declared flow; an agent that declares
// no documents genuinely runs over every document in the project, so it says exactly that instead of listing a
// set we would have to invent. Sources fall back to the project's real registry for the same reason (an empty
// flow means "all sources" - the same rule the roster card's "watching N sources" counts).
function touchCard(agent: IAgentDef, state: IScreenState): string {
	const docs = agent.flow.docs;
	const sourceNames = agent.flow.sources.length
		? agent.flow.sources.map(base)
		: (state.sources ?? []).map(s => esc(s.label));
	const sourceCount = sourceNames.length;
	const countLine = docs.length
		? localize('livingDocs.agents.touch.counts', "{0} document{1} &middot; {2} source{3}", docs.length, docs.length === 1 ? '' : 's', sourceCount, sourceCount === 1 ? '' : 's')
		: localize('livingDocs.agents.touch.allDocs', "Every document &middot; {0} source{1}", sourceCount, sourceCount === 1 ? '' : 's');
	const docLines = docs.length
		? `<div style="font:400 13px/1.8 ${FONT.sans};color:${INK.body};overflow-wrap:anywhere">${docs.map(base).join('<br>')}</div>`
		: `<div style="font:400 13px/1.8 ${FONT.sans};color:${INK.body}">${localize('livingDocs.agents.touch.everyDoc', "Every document in this project")}</div>`;
	// The source names are provenance facts (real file names), so they are the one mono run on this card.
	const shown = sourceNames.slice(0, 4).join(' &middot; ');
	const rest = sourceNames.length > 4 ? ` ${localize('livingDocs.agents.touch.moreSources', "+{0} more", sourceNames.length - 4)}` : '';
	const readsLine = sourceCount
		? cardNote(localize('livingDocs.agents.touch.reads', "reads {0}", `<span style="font:400 11.5px/1.5 ${FONT.mono}">${shown}</span>${rest}`))
		: cardNote(localize('livingDocs.agents.touch.noSources', "No sources are bound yet, so it has nothing to re-derive from."));
	return questionCard(localize('livingDocs.agents.q.touch', "WHAT IT MAY TOUCH"), `${cardHeadline(countLine)}${docLines}${readsLine}`);
}

// One row of the three-tier policy table: the change kind, and right-aligned what the agent may do with it.
// The tone colour is the shared grammar's (docPolicyToneHex) so the dial reads identically on the roster card,
// on this page and in the document's own header.
function policyRow(label: string, tone: DocPolicyTone): string {
	const word: Record<DocPolicyTone, string> = {
		ok: localize('livingDocs.agents.tier.auto', "auto-apply"),
		attention: localize('livingDocs.agents.tier.ask', "ask first"),
		removed: localize('livingDocs.agents.tier.never', "never"),
	};
	return `<span style="display:flex;justify-content:space-between;gap:12px;font:400 13.5px/1.45 ${FONT.sans};color:${INK.body}"><span>${esc(label)}</span><span style="color:${docPolicyToneHex(tone)};font-weight:600">${word[tone]}</span></span>`;
}

// Question 3 - WITHOUT ASKING, IT MAY. The three-tier table, honestly mapped from the stored dial, over the
// SHARED policy editor the document's own dial uses - "edit" reveals it. The card carries data-agent-card so
// the shell's one Edit-policy delegation (toggle the box, and post setAgentPolicyLevel from a row) works here
// exactly as it does on the roster, with no second mechanism to keep in step.
function policyCard(agent: IAgentDef): string {
	const rows = agentPolicyTable(agent.policy)
		.map(row => policyRow(row.label, row.level === 'auto-apply' ? 'ok' : row.level === 'ask-first' ? 'attention' : 'removed'))
		.join('');
	const table = `<div style="display:flex;flex-direction:column;gap:8px">${rows}</div>`;
	const edit = cardLink(localize('livingDocs.agents.policy.editLink', "edit"), 'data-agent-policy-edit');
	const note = cardNote(localize('livingDocs.agents.policy.sameDial', "Same dial as the document header - {0}", edit));
	const editor = `<div data-agent-policy-box style="display:none;border-top:1px solid ${HAIRLINE.soft};padding-top:12px">${renderPolicyEditor({ selected: agentPolicyToLevel(agent.policy), name: agent.id })}</div>`;
	return questionCard(localize('livingDocs.agents.q.policy', "WITHOUT ASKING, IT MAY"), `${table}${note}${editor}`, 'data-agent-card');
}

// What woke a run, in plain words - the receipt's answer to the round-1 "VIA" column. Kept because it is real
// data that changes the meaning of the row: a scheduled run and a run you asked for are not the same event. A
// run persisted before `via` existed carries no trigger, and the receipt then simply omits this clause rather
// than guessing at one.
function viaWords(via: AgentTriggerKind): string {
	switch (via) {
		case 'cron': return localize('livingDocs.agents.via.cron', "On schedule");
		case 'heartbeat': return localize('livingDocs.agents.via.heartbeat', "On the sweep");
		case 'event': return localize('livingDocs.agents.via.event', "A source changed");
		case 'lifecycle': return localize('livingDocs.agents.via.lifecycle', "At a document moment");
		default: return localize('livingDocs.agents.via.manual', "You ran it");
	}
}

// One receipt: the plain-words sentence for a persisted run, and the 7px dot that grades it. Green is a run
// that finished with nothing left for you; amber is a run that either recovered (a skip) or left changes
// waiting on your call; the frame-border grey is a sweep that found nothing to change; red is a failure. The
// counts are the run's own - a run that queued changes carries the live link into the review surface.
function runReceipt(r: IAgentRun): { readonly text: string; readonly dot: string } {
	const lead = r.via ? `${viaWords(r.via)} &middot; ` : '';
	if (r.skippedReason === 'still-running') {
		return { text: `${lead}${localize('livingDocs.agents.run.skipped', "Skipped - a previous run was still running")}`, dot: AMBER.base };
	}
	if (r.error) {
		return { text: `${lead}${localize('livingDocs.agents.run.failed', "Failed - {0}", esc(r.error))}`, dot: RED.base };
	}
	const docs = r.docsTouched ?? 0;
	const parts: string[] = [];
	if (docs) { parts.push(localize('livingDocs.agents.run.swept', "swept {0} document{1}", docs, docs === 1 ? '' : 's')); }
	if (r.applied) { parts.push(localize('livingDocs.agents.run.applied', "{0} figure{1} applied", r.applied, r.applied === 1 ? '' : 's')); }
	if (r.queued) {
		parts.push(cardLink(localize('livingDocs.agents.run.queued', "{0} queued for review", r.queued), 'data-msg="goReview"'));
	}
	if (!parts.length) {
		return { text: `${lead}${localize('livingDocs.agents.run.nothing', "nothing to change")}`, dot: PAPER.frameBorder };
	}
	return { text: `${lead}${parts.join(' &middot; ')}`, dot: r.queued ? AMBER.base : GREEN.base };
}

// The receipt's mono time stamp (3a): "MON 07:00" inside the last week, "MON 30 JUN" beyond it - the weekday
// is what a reader remembers about a weekly agent. Uppercase because it is a provenance fact, not prose.
const RUN_DAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
const RUN_MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
function runStamp(iso: string | undefined, now: number): string {
	const at = iso ? Date.parse(iso) : NaN;
	if (!isFinite(at)) { return '-'; }
	const then = new Date(at);
	const day = RUN_DAYS[then.getDay()];
	if (now - at < 7 * 86400000) {
		return `${day} ${String(then.getHours()).padStart(2, '0')}:${String(then.getMinutes()).padStart(2, '0')}`;
	}
	return `${day} ${then.getDate()} ${RUN_MONTHS[then.getMonth()]}`;
}

// How many receipts the page shows before it says so. The registry keeps up to AGENT_RUN_CAP runs per project;
// a detail page is a recent history, not an archive, so it shows the newest few and states the rest honestly.
const RECENT_RUN_LIMIT = 10;

// RECENT RUNS (3a): the mono section label over a white card of receipt rows - time, what happened, state dot.
// Truthful empty state when the agent has never run; nothing here is fabricated.
function renderRecentRuns(state: IScreenState): string {
	const label = sectionLabel(localize('livingDocs.agents.q.runs', "RECENT RUNS"));
	const runs = state.openAgentRuns ?? [];
	// The detail page has no injected render clock (the ScreenEditor supplies `ledgerNow` only for the roster's
	// ledger), so the stamp falls back to the live clock - the same fallback the round-1 run log used.
	const now = state.ledgerNow ?? Date.now();
	const frame = `background:${PAPER.card};border:1px solid ${HAIRLINE.strong};border-radius:${RADIUS.card};overflow:hidden`;
	const modelLine = state.agentModelId
		? localize('livingDocs.agents.runs.model', "Runs on {0}", esc(state.agentModelId))
		: localize('livingDocs.agents.runs.noModel', "No model is connected yet");
	// "model access" opens the Model Access screen through the existing door (the message the onboarding card
	// posts); this footer is the second entrance to it, so no new host message is invented.
	const footer = cardNote(`${modelLine} &middot; ${cardLink(localize('livingDocs.agents.runs.modelAccess', "model access"), 'data-msg="onbModelAccess"')}`);
	if (!runs.length) {
		const empty = `<div style="${frame};padding:20px 22px;font:${TYPE.uiBody};color:${INK.secondary}">${localize('livingDocs.agents.runs.empty', "No runs yet. Run it now, or wait for the schedule above.")}</div>`;
		return `<div style="display:flex;flex-direction:column;gap:12px">${label}${empty}${footer}</div>`;
	}
	const shown = runs.slice(0, RECENT_RUN_LIMIT);
	const rows = shown.map((r, i) => {
		const receipt = runReceipt(r);
		const last = i === shown.length - 1 && runs.length <= RECENT_RUN_LIMIT;
		return `<div style="display:flex;align-items:center;gap:12px;padding:13px 20px${last ? '' : `;border-bottom:1px solid ${HAIRLINE.soft}`}">
			<span style="font:${TYPE.sectionLabel};color:${INK.meta};flex:none">${runStamp(r.finishedAt ?? r.startedAt, now)}</span>
			<span style="flex:1;min-width:0;font:${TYPE.uiBody};color:${INK.body}">${receipt.text}</span>
			${stateDot(receipt.dot)}
		</div>`;
	}).join('');
	// The honest overflow line: what is not on the page, and where the rest of the story lives.
	const more = runs.length > RECENT_RUN_LIMIT
		? `<div style="padding:11px 20px;font:${TYPE.secondary};color:${INK.meta}">${localize('livingDocs.agents.runs.more', "Showing the {0} most recent of {1} runs. Older activity lives in each document's History.", RECENT_RUN_LIMIT, runs.length)}</div>`
		: '';
	return `<div style="display:flex;flex-direction:column;gap:12px">${label}<div style="${frame}">${rows}${more}</div>${footer}</div>`;
}

// The agent detail page (comp 3a, de-IDE'd): a back link and the two verbs, the agent's name with its live
// status and a plain-words paragraph, the three question cards, the recent-run receipts, and the cross-project
// skill-run strip. The ONE banner above it all is the run that just happened - state appears where it needs
// you, in one place, and never as a permanent pill.
function renderAgentCanvas(agent: IAgentDef, state: IScreenState): string {
	const run = state.lastRun && state.lastRun.agentId === agent.id ? state.lastRun : undefined;
	let banner = '';
	if (run) {
		const strip = `flex:none;display:flex;align-items:center;gap:12px;padding:12px 24px;font:400 12.5px/1.4 ${FONT.sans}`;
		banner = run.blocked
			? `<div style="${strip};background:${RED.diffBg};border-bottom:1px solid ${RED.diffInk};color:${RED.base}">${stateDot(RED.base, 11)}Blocked at the verify gate &middot; ${esc(run.blocked)}</div>`
			: `<div style="${strip};background:${AMBER.bg};border-bottom:1px solid ${AMBER.border};color:${AMBER.label}">${stateDot(AMBER.base, 11)}Run complete &middot; ${run.applied} figure update${run.applied === 1 ? '' : 's'} applied &middot; ${run.queued} change${run.queued === 1 ? '' : 's'} queued<button data-msg="goReview" style="margin-left:auto;border:none;background:none;font:${TYPE.uiBodyStrong};color:${INDIGO.base};cursor:pointer">Review &#8594;</button></div>`;
	}
	// The header row: one quiet way back, then the verbs. Duplicate and Pause are hairline secondaries; Run now
	// is the single indigo primary (green is never a button colour, whatever round 1 did).
	const secondary = `border:1px solid ${PAPER.control};border-radius:${RADIUS.control};padding:6px 14px;background:${PAPER.card};color:${INK.bodySoft};font:400 12.5px/1.3 ${FONT.sans};cursor:pointer`;
	const pauseBtn = agent.disabled
		? `<button data-msg="resumeAgent" data-arg="${esc(agent.id)}" style="${secondary}">${localize('livingDocs.agents.detail.resume', "Resume")}</button>`
		: `<button data-msg="pauseAgent" data-arg="${esc(agent.id)}" style="${secondary}">${localize('livingDocs.agents.detail.pause', "Pause")}</button>`;
	const header = `<div style="display:flex;align-items:center;gap:12px">
		<button data-msg="closeAgent" style="border:none;background:none;padding:0;font:400 13px/1.4 ${FONT.sans};color:${INK.secondary};cursor:pointer">&#8592; ${localize('livingDocs.agents.detail.back', "Agents")}</button>
		<span style="flex:1"></span>
		<button data-msg="duplicateAgent" data-arg="${esc(agent.id)}" style="${secondary}">${localize('livingDocs.agents.detail.duplicate', "Duplicate")}</button>
		${pauseBtn}
		<button data-msg="runWf" data-arg="${esc(agent.id)}" style="border:none;border-radius:${RADIUS.control};padding:7px 18px;background:${INDIGO.base};color:${PAPER.card};font:600 13px/1.3 ${FONT.sans};cursor:pointer">&#9654; ${localize('livingDocs.agents.detail.runNow', "Run now")}</button>
	</div>`;
	// The title block: the name at the screen-title step beside the live status, then what the agent does in
	// the reader's words - including the promise that makes an agent safe to keep on.
	const docsPhrase = agent.flow.docs.length
		? localize('livingDocs.agents.detail.nDocs', "{0} document{1}", agent.flow.docs.length, agent.flow.docs.length === 1 ? '' : 's')
		: localize('livingDocs.agents.detail.allDocs', "every document in this project");
	const purpose = localize('livingDocs.agents.detail.purpose', "{0}, it refreshes {1} from their sources. Every change it makes lands in review - nothing applies on its own beyond what you allow below.", scheduleWords(agent.trigger), docsPhrase);
	const title = `<div style="display:flex;flex-direction:column;gap:8px">
		<div style="display:flex;align-items:center;gap:12px">
			<h2 style="margin:0;font:${TYPE.screenTitle};letter-spacing:${TRACKING.screenTitle};color:${INK.heading}">${esc(agent.name)}</h2>
			${liveStatus(agent)}
		</div>
		<p style="margin:0;font:400 15px/1.6 ${FONT.sans};color:${INK.bodySoft};max-width:74ch">${purpose}</p>
	</div>`;
	// The three questions, side by side. `auto-fit` resolves to the comp's three equal columns at the page's own
	// width and folds them down rather than crushing them when the editor is split narrow - a webview has no
	// media query of its own to fall back on.
	const cards = `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:16px;align-items:start">${whenCard(agent)}${touchCard(agent, state)}${policyCard(agent)}</div>`;
	return `<div class="screen">
	${banner}
	<div class="scr-body">
		<div style="max-width:1000px;margin:0 auto;padding:44px 72px 56px;display:flex;flex-direction:column;gap:28px">
			${header}
			${title}
			${cards}
			${renderRecentRuns(state)}
			${renderSkillRunCard(state.skillRun)}
		</div>
	</div>
</div>`;
}

// The cross-project skill run strip (plan 32 iter 3, the P3 gap): the "Run skill across project" affordance and,
// after a run, one row per document with its grade (flag/pass/skipped) and the grader's one-line reason. Real
// data only - skipped is honest (not living, or a model-backed skill with no model), never a fabricated pass.
function renderSkillRunCard(summary: ISkillRunSummary | undefined): string {
	const skillBtn = (id: string, label: string) => `<button data-msg="runSkillProject" data-arg="${id}" style="border:1px solid ${PAPER.control};border-radius:${RADIUS.control};padding:8px 13px;background:${PAPER.card};color:${INK.bodySoft};font:${TYPE.uiBodyStrong};cursor:pointer">${label}</button>`;
	const actions = `<div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:12px">${skillBtn('formatting', localize('livingDocs.agents.skill.formatting', "Run formatting across the project"))}${skillBtn('financial', localize('livingDocs.agents.skill.financial', "Run financial across the project"))}${skillBtn('strategy', localize('livingDocs.agents.skill.strategy', "Run strategy across the project"))}</div>`;
	let body: string;
	if (!summary) {
		body = `<div style="font:${TYPE.secondary};color:${INK.secondary}">Run a Skill grader across every document in the project - results land in the review rail as usual.</div>${actions}`;
	} else {
		const rows = summary.results.map(r => {
			const dot = r.status === 'flag' ? AMBER.base : r.status === 'pass' ? GREEN.base : PAPER.frameBorder;
			const label = r.status === 'flag' ? 'Flag' : r.status === 'pass' ? 'Pass' : 'Skipped';
			const colour = r.status === 'flag' ? AMBER.label : r.status === 'pass' ? GREEN.base : INK.secondary;
			return `<div style="display:flex;align-items:center;gap:12px;padding:12px 16px;border-bottom:1px solid ${HAIRLINE.soft};font:${TYPE.secondary};color:${INK.body}">
				${stateDot(dot)}
				<span style="flex:1.4;font-weight:600;color:${INK.heading}">${esc(r.docTitle)}</span>
				<span style="flex:none;font:600 11px/1 ${FONT.sans};color:${colour}">${label}</span>
				<span style="flex:2.4;font:400 11.5px/1.4 ${FONT.sans};color:${INK.secondary}">${esc(r.detail)}</span>
			</div>`;
		}).join('') || `<div style="padding:18px 16px;font:${TYPE.secondary};color:${INK.meta}">No gradeable documents in this project.</div>`;
		const summaryLine = `${summary.flagged} flagged &middot; ${summary.passed} passed${summary.skipped ? ` &middot; ${summary.skipped} skipped` : ''}`;
		body = `<div style="font:${TYPE.secondary};color:${INK.bodySoft};margin-bottom:2px"><strong style="color:${INK.heading};font-weight:600">${esc(summary.skillName)}</strong> across the project &middot; ${summaryLine}</div>${actions}<div style="margin-top:12px;border:1px solid ${HAIRLINE.medium};border-radius:${RADIUS.input};overflow:hidden">${rows}</div>`;
	}
	return `<div style="background:${PAPER.card};border:1px solid ${HAIRLINE.strong};border-radius:${RADIUS.card};padding:16px 18px;display:flex;flex-direction:column;gap:12px">${sectionLabel(localize('livingDocs.agents.skill.label', "RUN A SKILL ACROSS THE PROJECT"))}${body}</div>`;
}
