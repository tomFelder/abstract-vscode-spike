/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Agents: the live registry list, the per-agent workflow canvas + detail drawer (policy select, trigger
// editor), the run log and the cross-project skill-run strip. Only `renderAgents` is public. Split out of
// screenRender.ts so the Knowledge + Agents lane owns its own file; shared helpers come from the shell.

import { localize } from '../../../../nls.js';
import { IAgentDef, IAgentRun, IAgentTrigger, ISkillRunSummary } from '../common/livingDocsModel.js';
import { agentPolicyTable, agentPolicyToLevel } from '../common/agentPolicyGrammar.js';
import { docPolicyToneHex, DocPolicyTone } from '../common/docPolicy.js';
import { IActivityLedger, ILedgerEntry } from '../common/livingDocLedger.js';
import { renderPolicyEditor } from './policyEditorRender.js';
import { ACCENT, ACCENT_DK, esc, IScreenState } from './screenRenderShell.js';

// ---- Agents: the v2 card grid (A1/A2) and the workflow canvas for one agent. ----
export function renderAgents(state: IScreenState): string {
	const open = state.openAgentId ? state.agents.find(a => a.id === state.openAgentId) : undefined;
	return open ? renderAgentCanvas(open, state) : renderAgentCards(state);
}

const AGENT_ICON: Record<string, string> = { cron: '&#10227;', heartbeat: '&#9673;', event: '&#8853;', lifecycle: '&#9638;', manual: '&#9654;' };

function base(path: string): string { return esc(path.split('/').pop() ?? path); }

function triggerLabel(t: IAgentTrigger): string {
	switch (t.kind) {
		case 'cron': return `cron &middot; ${esc(t.cron ?? '')}`;
		case 'heartbeat': return `heartbeat &middot; ${t.everyHours ?? 6}h`;
		case 'event': return `event &middot; ${esc(t.source ?? '*')}`;
		case 'lifecycle': return `lifecycle &middot; ${esc(t.lifecycle ?? '')}`;
		default: return 'manual';
	}
}

// Format the agent's last-run ISO timestamp as the comp's relative label ("2m ago" / "1h ago" /
// "yesterday"); an em dash when the agent has never run. (lastRun is a real timestamp - the
// orchestrator parses it for due-checks - so it is formatted here, not stored as a label.)
function relTime(iso: string | undefined): string {
	if (!iso) { return '\u2014'; }
	const ms = Date.now() - Date.parse(iso);
	if (!isFinite(ms) || ms < 0) { return 'just now'; }
	const mins = Math.floor(ms / 60000);
	if (mins < 1) { return 'just now'; }
	if (mins < 60) { return `${mins}m ago`; }
	const hrs = Math.floor(mins / 60);
	if (hrs < 24) { return `${hrs}h ago`; }
	const days = Math.floor(hrs / 24);
	return days === 1 ? 'yesterday' : `${days}d ago`;
}

function statusBadge(status: string): string {
	const dot = (color: string, label: string, fg = '#52575f') => `<span style="display:inline-flex;align-items:center;gap:6px;font:600 11px/1 system-ui;color:${fg}"><span style="width:7px;height:7px;border-radius:50%;background:${color}"></span>${label}</span>`;
	switch (status) {
		case 'running': return dot('oklch(0.66 0.16 45)', 'Running', '#9a6b16');
		case 'needs-approval': return `<span style="font:600 11px/1 system-ui;color:#9a6b16;background:#fdf2dc;border-radius:999px;padding:5px 10px">Needs approval</span>`;
		case 'blocked': return `<span style="font:600 11px/1 system-ui;color:#b4332f;background:#fdecec;border-radius:999px;padding:5px 10px">Blocked</span>`;
		case 'error': return dot('#b4332f', 'Error', '#b4332f');
		case 'paused': return dot('#cdd1d8', 'Paused', '#868b95');
		default: return dot('#cdd1d8', 'Idle', '#868b95');
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

// One agent card (A2): the tinted glyph tile + name + mono status line + the accent pause/resume toggle; the
// one-line purpose; the three-tier policy table (values honestly mapped from the stored dial); and the footer
// (mono "runs on" + the real workspace model id + Edit policy, which reveals the SHARED policy editor).
function renderAgentCard(a: IAgentDef, state: IScreenState): string {
	const paused = !!a.disabled;
	// A2.1 glyph tile: 34px, radius 10; active = accent-tint bg / accent border / accent glyph; paused = grey.
	const tileBg = paused ? '#F6F7F9' : '#F4F5FD';
	const tileBorder = paused ? '#E9EAEE' : '#E0E5FB';
	const tileFg = paused ? '#868B95' : '#4650B8';
	const glyph = AGENT_ICON[a.trigger.kind] ?? '&#9679;';
	// A2.1 status line (mono 10px): a filled dot + "active - watching N sources" in ok green, or a hollow dot +
	// "paused" in faint. The dots are HTML entities (filled &#9679; / hollow &#9675;), the copy is real.
	const n = watchingCount(a, state);
	const statusLine = paused
		? `<span style="display:block;font:400 10px/1.3 'JetBrains Mono',ui-monospace,monospace;color:#A3A8B2">&#9675; paused</span>`
		: `<span style="display:block;font:400 10px/1.3 'JetBrains Mono',ui-monospace,monospace;color:#2C8159">&#9679; active &middot; watching ${n} source${n === 1 ? '' : 's'}</span>`;
	// A2.1 toggle (36x20, knob 16): accent when active, grey when paused; posts pause/resume via setAgentDisabled.
	const toggleMsg = paused ? 'resumeAgent' : 'pauseAgent';
	const toggleBg = paused ? '#D5D8DE' : '#5B6DC4';
	const knob = paused ? 'left:2px' : 'right:2px';
	const toggle = `<button data-msg="${toggleMsg}" data-arg="${esc(a.id)}" data-stop title="${paused ? 'Resume this agent' : 'Pause this agent'}" style="flex:none;width:36px;height:20px;border:none;border-radius:999px;background:${toggleBg};position:relative;cursor:pointer;padding:0"><span style="position:absolute;${knob};top:2px;width:16px;height:16px;border-radius:999px;background:#fff"></span></button>`;
	// A2.2 policy table: label + right-aligned coloured value, EXACTLY the three-tier grammar, honestly mapped.
	const toneWord: Record<DocPolicyTone, string> = { ok: 'auto-apply', attention: 'ask first', removed: 'never' };
	const rows = agentPolicyTable(a.policy).map(row => {
		const tone: DocPolicyTone = row.level === 'auto-apply' ? 'ok' : row.level === 'ask-first' ? 'attention' : 'removed';
		return `<span style="display:flex;justify-content:space-between"><span>${esc(row.label)}</span><span style="color:${docPolicyToneHex(tone)};font-weight:500">${toneWord[tone]}</span></span>`;
	}).join('');
	// A2.3 footer: mono "runs on" + the real workspace model id (omitted when the broker is unreachable) + the
	// Edit policy link, which reveals the SHARED plain-language policy editor (the same component as Properties).
	const modelId = state.agentModelId
		? `<span style="font:400 10.5px/1 'JetBrains Mono',ui-monospace,monospace;color:#52575F">${esc(state.agentModelId)}</span>`
		: `<span style="font:400 10.5px/1 'JetBrains Mono',ui-monospace,monospace;color:#A3A8B2">model unavailable</span>`;
	const footer = `<div style="margin-top:12px;padding-top:10px;border-top:1px solid #EEF0F3;display:flex;align-items:center;gap:8px"><span style="font:400 10px/1 'JetBrains Mono',ui-monospace,monospace;color:#A3A8B2">runs on</span>${modelId}<span style="flex:1"></span><a href="#" data-agent-policy-edit style="font:500 12px/1 system-ui;color:${ACCENT_DK};text-decoration:none;cursor:pointer">${localize('livingDocs.agents.card.editPolicy', "Edit Policy")}</a></div>`;
	// The shared policy editor, hidden until Edit policy reveals it (A2.3): the SAME renderPolicyEditor DOM the
	// doc Properties panel hosts, keyed by the agent id, its current selection the honest per-agent level.
	const policyEditor = `<div data-agent-policy-box style="display:none;margin-top:12px;padding-top:12px;border-top:1px solid #EEF0F3">${renderPolicyEditor({ selected: agentPolicyToLevel(a.policy), name: a.id })}</div>`;
	// A2.5 doors (CD-1 fix): the card is the primary door - the whole card opens the agent's detail canvas
	// (Run now, run log, schedule editor, flow graph) by mouse (data-msg openAgent) and by keyboard (role=button
	// + tabindex + data-keyactivate fires the same click on Enter/Space). An explicit Open + Run-now action row
	// keeps the doors discoverable and gives the roster a one-click run; both carry data-stop so they post their
	// own message instead of the card's open. Every inner control (toggle, Edit policy, policy rows) already
	// stops propagation, so the card-open never fires on top of them.
	const openLabel = localize('livingDocs.agents.card.open', "Open");
	const runLabel = localize('livingDocs.agents.card.runNow', "Run Now");
	const actions = `<div style="margin-top:12px;display:flex;align-items:center;gap:8px">
		<button data-msg="openAgent" data-arg="${esc(a.id)}" data-stop style="border:1px solid #D4D7DD;border-radius:8px;padding:8px 14px;background:#fff;color:#52575F;font:600 12px/1 system-ui;cursor:pointer">${openLabel}</button>
		<span style="flex:1"></span>
		<button data-msg="runWf" data-arg="${esc(a.id)}" data-stop style="border:none;border-radius:8px;padding:8px 14px;background:oklch(0.55 0.14 150);color:#fff;font:600 12px/1 system-ui;cursor:pointer">&#9654; ${runLabel}</button>
	</div>`;
	const openHint = localize('livingDocs.agents.card.openHint', "Open {0}", a.name);
	return `<div data-agent-card data-msg="openAgent" data-arg="${esc(a.id)}" data-keyactivate role="button" tabindex="0" aria-label="${esc(openHint)}" style="flex:1 1 320px;min-width:300px;max-width:520px;background:#fff;border:1px solid #E6E8EC;border-radius:13px;padding:18px 20px;box-shadow:0 1px 2px rgba(20,22,28,.05);cursor:pointer${paused ? ';opacity:.75' : ''}">
		<div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">
			<span style="flex:none;width:34px;height:34px;border-radius:10px;background:${tileBg};border:1px solid ${tileBorder};display:flex;align-items:center;justify-content:center;color:${tileFg};font-size:15px">${glyph}</span>
			<span style="min-width:0"><span style="display:block;font:600 14.5px/1.25 system-ui;color:#1A1C20">${esc(a.name)}</span>${statusLine}</span>
			<span style="flex:1"></span>${toggle}
		</div>
		<div style="font:400 12.5px/1.55 system-ui;color:#52575F;margin-bottom:12px">${esc(agentPurpose(a))}</div>
		<div style="display:flex;flex-direction:column;gap:5px;font:400 12px/1.4 system-ui;color:#52575F">${rows}</div>
		${footer}${actions}${policyEditor}
	</div>`;
}

// The v2 Agents card grid (A1, A2): the no-rails shell, the trust-contract framing line, one card per agent
// and the dashed New-agent tile. The header pill (agent health) is published by the ScreenEditor to the one
// global Abstract header (plan 44), not drawn here.
function renderAgentCards(state: IScreenState): string {
	const agents = state.agents;
	const cards = agents.map(a => renderAgentCard(a, state)).join('');
	// A2.4 dashed New-agent tile: opens the existing create flow ("from a skill or from scratch").
	const newTile = `<div data-msg="createAgent" style="width:280px;flex:none;border:1px dashed #C6CAD2;border-radius:13px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;color:#868B95;cursor:pointer;min-height:180px"><span style="font-size:22px">&#65291;</span><span style="font:500 13px/1 system-ui">New agent</span><span style="font:400 11.5px/1 system-ui;color:#A3A8B2">from a skill or from scratch</span></div>`;
	const emptyLine = agents.length
		? ''
		: `<div style="font:400 13px/1.6 system-ui;color:#868B95;max-width:520px;margin-bottom:20px">No agents yet. Create one to keep your documents current when their sources change.</div>`;
	// The project fan-out door (CD-1 fix): "Run across the project" opens the whole-project run surface - the
	// same entry the project-run idle screen's "Go to Agents" button promises, now honoured. runProject had no
	// emitter before this; the header carries it so the wedge fan-out is reachable from the Agents screen.
	const runProjectLabel = localize('livingDocs.agents.runProject', "Run Across the Project");
	const runProjectBtn = `<button data-msg="runProject" style="flex:none;display:inline-flex;align-items:center;gap:8px;border:none;border-radius:9px;padding:10px 16px;background:${ACCENT};color:#fff;font:600 13px/1 system-ui;cursor:pointer">&#10022; ${runProjectLabel}</button>`;
	return `<div class="screen">
	<div class="scr-body">
		<div style="max-width:1180px;margin:0 auto;padding:56px 48px 80px">
			<div style="display:flex;align-items:flex-start;gap:16px;margin-bottom:6px"><div style="flex:1;min-width:0"><div style="font:600 30px/1.12 system-ui;letter-spacing:-0.02em;color:#14161A">Agents</div></div>${runProjectBtn}</div>
			<div style="font:400 14px/1.5 system-ui;color:#868B95;margin-bottom:32px">Agents only act on documents that opted in. Every action lands in the ledger below.</div>
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
const LEDGER_DOT: Record<ILedgerEntry['kind'], string> = { waiting: '#C99A2E', applied: '#2C8159', admin: '#D5D8DE' };

// The right-aligned mono badge (A3.1): an amber WAITING pill on cream with a border; a green "auto-applied ·
// reversible"; a grey "by <user>" / administrative note. The badge text is the read model's; the styling is
// the tier's. The middot in the badge copy is written as its HTML entity for the source-hygiene rule.
function ledgerBadge(entry: ILedgerEntry): string {
	const text = esc(entry.badge).replace(/ · /g, ' &middot; ');
	if (entry.kind === 'waiting') {
		return `<span style="font:600 10px/1 'JetBrains Mono',ui-monospace,monospace;color:#8A6D1A;background:#FDFAF2;border:1px solid #E4DCCB;border-radius:999px;padding:2px 8px">${text}</span>`;
	}
	if (entry.kind === 'applied') {
		return `<span style="font:400 10px/1 'JetBrains Mono',ui-monospace,monospace;color:#2C8159">${text}</span>`;
	}
	return `<span style="font:400 10px/1 'JetBrains Mono',ui-monospace,monospace;color:#A3A8B2">${text}</span>`;
}

// One ledger row's plain-language sentence (A3.1, 13px): the lead text, then - when the event names a real
// document - the doc link citing its gutter address ("Weekly Summary · line 6", A3.3). A WAITING row's link is
// a deep link into that document's Review tab (posts `ledgerReview` with the durable block id, surviving the
// closed-doc path); every other doc link opens the document. Plain text with no doc reads as a bare sentence.
function ledgerSentence(entry: ILedgerEntry): string {
	const lead = esc(entry.lead);
	const tail = esc(entry.tail);
	if (!entry.doc) {
		return `<span style="flex:1;min-width:0;font:400 13px/1.4 system-ui;color:#26292F">${lead}${tail}</span>`;
	}
	const label = esc(entry.doc.label).replace(/ · /g, ' &middot; ');
	const msg = entry.deepLink ? 'ledgerReview' : 'openDoc';
	const blockAttr = entry.deepLink && entry.doc.blockId ? ` data-block="${esc(entry.doc.blockId)}"` : '';
	const link = `<a data-msg="${msg}" data-arg="${esc(entry.doc.docId)}"${blockAttr} data-stop href="#" style="color:${ACCENT_DK};text-decoration:none;cursor:pointer">${label}</a>`;
	return `<span style="flex:1;min-width:0;font:400 13px/1.4 system-ui;color:#26292F">${lead}${link}${tail}</span>`;
}

// The v2 activity ledger (A3): the ACTIVITY label + a bordered, radius-13 chronological list (newest first),
// each row a mono timestamp (52px col) · 7px status dot · plain-language sentence · right mono badge. Rows come
// straight from the read model (A3.2, real events only); the truncation line is honest (A3.4). A truthful empty
// state renders when the project has no recorded activity yet - never a fabricated row.
function renderAgentLedger(state: IScreenState): string {
	const ledger: IActivityLedger | undefined = state.ledger;
	const now = state.ledgerNow ?? 0;
	const label = `<div style="font:600 10px/1 'JetBrains Mono',ui-monospace,monospace;letter-spacing:.12em;color:#A3A8B2;margin:34px 0 10px">ACTIVITY</div>`;
	if (!ledger || ledger.entries.length === 0) {
		// A3.2 truthful empty state: no rows fabricated - a plain line inside the same bordered frame.
		return `${label}<div style="border:1px solid #E9EAEE;border-radius:13px;padding:22px 18px;font:400 13px/1.5 system-ui;color:#868B95">No agent or review activity yet. When an agent runs or you approve a change, it lands here.</div>`;
	}
	const rows = ledger.entries.map((entry, i) => {
		const last = i === ledger.entries.length - 1 && !ledger.truncated;
		const border = last ? '' : ';border-bottom:1px solid #EEF0F3';
		return `<div style="display:flex;align-items:center;gap:12px;padding:12px 18px${border}">
			<span style="font:400 10.5px/1 'JetBrains Mono',ui-monospace,monospace;color:#A3A8B2;width:52px;flex:none">${esc(ledgerStamp(entry.at, now))}</span>
			<span style="width:7px;height:7px;border-radius:999px;background:${LEDGER_DOT[entry.kind]};flex:none"></span>
			${ledgerSentence(entry)}
			${ledgerBadge(entry)}
		</div>`;
	}).join('');
	// A3.4 honest truncation line: shown only when the fold produced more than the cap - older activity lives
	// in each document's History tab.
	const more = ledger.truncated
		? `<div style="padding:11px 18px;border-top:1px solid #EEF0F3;font:400 12px/1.4 system-ui;color:#A3A8B2">Showing the most recent ${ledger.entries.length}. Older activity lives in each document's History.</div>`
		: '';
	return `${label}<div style="border:1px solid #E9EAEE;border-radius:13px;overflow:hidden">${rows}${more}</div>`;
}

// The detail drawer (plan 32 iter 3, D32-B): the read-only canvas strip (the loop, spec 5) plus the inline
// controls (policy select, trigger editor), the run log (relative time, via, outcome counts, the "N queued"
// review link, failure/skip lines), and the create/duplicate/pause + cross-project skill-run actions.
function renderAgentCanvas(agent: IAgentDef, state: IScreenState): string {
	const run = state.lastRun && state.lastRun.agentId === agent.id ? state.lastRun : undefined;
	const node = (label: string, sub: string, accent = false, tint = '#fff') => `<div style="flex:none;width:150px;background:${tint};border:1.5px solid ${accent ? ACCENT : '#e6e8ed'};border-radius:11px;padding:12px 13px;box-shadow:0 1px 3px rgba(0,0,0,.05)"><div style="font:600 12.5px/1.2 system-ui;color:#1a1c20">${label}</div><div style="font:400 10.5px/1.35 'JetBrains Mono',ui-monospace,monospace;color:#a3a8b2;margin-top:6px">${sub}</div></div>`;
	const arrow = `<div style="flex:none;align-self:center;color:#c2c8d4;font-size:18px">&#8594;</div>`;
	const stages = [
		node('Trigger', triggerLabel(agent.trigger), true),
		arrow,
		node('Sources', agent.flow.sources.length ? agent.flow.sources.map(base).join('<br>') : 'workspace sources'),
		arrow,
		node(esc(agent.name), 'read &middot; diff &middot; rewrite'),
		arrow,
		node('Verify', 'Financial &middot; Strategy &middot; Formatting', true, '#f7f9ff'),
		arrow,
		node('Policy gate', esc(agent.policy), true, '#f7f9ff'),
		arrow,
		node('Documents', agent.flow.docs.length ? agent.flow.docs.map(base).join('<br>') : 'workspace docs'),
		arrow,
		node('Review rail', run ? `${run.queued} queued` : 'awaiting run', true, '#fdf6e9'),
	].join('');
	let banner = '';
	if (run) {
		banner = run.blocked
			? `<div style="flex:none;display:flex;align-items:center;gap:10px;padding:11px 24px;background:#fdecec;border-bottom:1px solid #f3c9c6;font:500 12.5px/1.4 system-ui;color:#b4332f"><span style="width:8px;height:8px;border-radius:50%;background:#b4332f"></span>Blocked at the verify gate &middot; ${esc(run.blocked)}</div>`
			: `<div style="flex:none;display:flex;align-items:center;gap:10px;padding:11px 24px;background:#fdf6e9;border-bottom:1px solid #f0e2c4;font:500 12.5px/1.4 system-ui;color:#9a6b16"><span style="width:8px;height:8px;border-radius:50%;background:oklch(0.66 0.16 45)"></span>Run complete &middot; ${run.applied} figure update${run.applied === 1 ? '' : 's'} applied &middot; ${run.queued} change${run.queued === 1 ? '' : 's'} queued<button data-msg="goReview" style="margin-left:auto;border:none;background:none;font:600 12.5px/1 system-ui;color:${ACCENT_DK};cursor:pointer">Review &#8594;</button></div>`;
	}
	const pauseBtn = agent.disabled
		? `<button data-msg="resumeAgent" data-arg="${esc(agent.id)}" style="border:1px solid #d4d7dd;border-radius:8px;padding:9px 14px;background:#fff;color:#52575f;font:600 12.5px/1 system-ui;cursor:pointer">&#9654; Resume</button>`
		: `<button data-msg="pauseAgent" data-arg="${esc(agent.id)}" style="border:1px solid #d4d7dd;border-radius:8px;padding:9px 14px;background:#fff;color:#52575f;font:600 12.5px/1 system-ui;cursor:pointer">&#10073;&#10073; Pause</button>`;
	const pausedNote = agent.disabled
		? `<div style="flex:none;display:flex;align-items:center;gap:10px;padding:10px 24px;background:#f4f5f7;border-bottom:1px solid #e9eaee;font:500 12.5px/1.4 system-ui;color:#696e78"><span style="width:8px;height:8px;border-radius:50%;background:#c2c8d4"></span>Paused &middot; the scheduler skips this agent. Run now still works.</div>`
		: '';
	return `<div class="screen">
	<div style="flex:none;display:flex;align-items:center;gap:14px;padding:13px 24px;border-bottom:1px solid #eef0f3">
		<button class="btn-ghost" data-msg="closeAgent">&#8592; Agents</button>
		<div><div style="display:flex;align-items:center;gap:8px"><span style="color:${ACCENT}">${AGENT_ICON[agent.trigger.kind] ?? '&#9679;'}</span><h2 style="margin:0;font:600 16px/1.2 system-ui;color:#15171c">${esc(agent.name)}</h2>${agent.disabled ? `<span style="font:600 9px/1 'JetBrains Mono',ui-monospace,monospace;color:#868b95;background:#eef0f3;border-radius:999px;padding:3px 7px">PAUSED</span>` : ''}</div><div style="font:400 11.5px/1 'JetBrains Mono',ui-monospace,monospace;color:#a3a8b2;margin-top:4px">${triggerLabel(agent.trigger)} &middot; ${esc(agent.policy)}</div></div>
		<div style="margin-left:auto;display:flex;align-items:center;gap:10px">${agent.disabled ? statusBadge('paused') : statusBadge(agent.status)}<button data-msg="duplicateAgent" data-arg="${esc(agent.id)}" style="border:1px solid #d4d7dd;border-radius:8px;padding:9px 14px;background:#fff;color:#52575f;font:600 12.5px/1 system-ui;cursor:pointer">&#10697; Duplicate</button>${pauseBtn}<button data-msg="runWf" data-arg="${esc(agent.id)}" style="border:none;border-radius:8px;padding:9px 16px;background:oklch(0.55 0.14 150);color:#fff;font:600 13px/1 system-ui;cursor:pointer">&#9654; Run now</button></div>
	</div>
	${pausedNote}${banner}
	<div style="flex:1;overflow:auto;background:#f8f9fb;background-image:radial-gradient(#e2e6ee 1px,transparent 1px);background-size:22px 22px">
		<div style="display:flex;align-items:stretch;gap:8px;padding:36px 28px 20px;min-width:max-content">${stages}</div>
		<div style="padding:0 28px 8px;font:400 12px/1.5 'JetBrains Mono',ui-monospace,monospace;color:#bcc0c8">The loop: trigger &#8594; sources &#8594; agent &#8594; verify gate &#8594; policy gate &#8594; documents &#8594; review rail.</div>
		<div style="padding:8px 28px 40px;display:flex;flex-direction:column;gap:18px;max-width:900px">
			${renderAgentControls(agent)}
			${renderAgentRunLog(agent, state.openAgentRuns ?? [])}
			${renderSkillRunCard(state.skillRun)}
		</div>
	</div>
</div>`;
}

const POLICY_LABELS: Record<string, string> = {
	'auto-figures': 'Auto-apply figures',
	'ask-before-apply': 'Ask before applying',
	'draft-only': 'Draft only',
};

// The inline policy select + trigger editor (D32-B): the safety dial has exactly the three levels (spec 09 section 4)
// and the trigger picker composes a cron day/time, a heartbeat cadence, or an event source. Both post on change.
function renderAgentControls(agent: IAgentDef): string {
	const card = (title: string, body: string) => `<div style="background:#fff;border:1px solid #e9eaee;border-radius:12px;padding:16px 18px">
		<div style="font:600 10px/1 'JetBrains Mono',ui-monospace,monospace;letter-spacing:.06em;color:#a3a8b2;margin-bottom:12px">${title}</div>${body}</div>`;
	const opt = (v: string) => `<option value="${v}"${agent.policy === v ? ' selected' : ''}>${POLICY_LABELS[v]}</option>`;
	const policyBody = `<select data-change-msg="setAgentPolicy" data-arg="${esc(agent.id)}" style="font:500 13px/1 system-ui;color:#15181f;padding:9px 12px;border:1px solid #dfe1e6;border-radius:8px;background:#fff;cursor:pointer">${opt('auto-figures')}${opt('ask-before-apply')}${opt('draft-only')}</select>
		<div style="font:400 11.5px/1.5 system-ui;color:#969ba4;margin-top:9px">Figures may auto-apply; prose waits for approval; draft-only never auto-lands.</div>`;
	// The trigger picker: a kind select toggling the cron day/time, the heartbeat hours, or the event source.
	const t = agent.trigger;
	const kindOpt = (v: string, label: string) => `<option value="${v}"${t.kind === v ? ' selected' : ''}>${label}</option>`;
	const dayOpt = (v: string) => `<option value="${v}"${(t.cron ?? '').startsWith(v) ? ' selected' : ''}>${v}</option>`;
	const cronMatch = /^(\w{3})\s+(\d{2}:\d{2})$/.exec(t.cron ?? '');
	const cronTime = cronMatch ? cronMatch[2] : '09:00';
	const fld = `font:500 12.5px/1 system-ui;color:#15181f;padding:8px 10px;border:1px solid #dfe1e6;border-radius:7px;background:#fff`;
	const triggerBody = `<div data-trigger-box style="display:flex;flex-direction:column;gap:10px">
		<select data-tfield="kind" style="${fld};cursor:pointer;width:max-content">${kindOpt('cron', 'Schedule (cron)')}${kindOpt('heartbeat', 'Heartbeat')}${kindOpt('event', 'On source change')}${kindOpt('manual', 'Manual only')}</select>
		<div data-tgroup="cron" style="display:${t.kind === 'cron' ? 'flex' : 'none'};gap:8px;align-items:center">
			<select data-tfield="day" style="${fld};cursor:pointer">${['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(dayOpt).join('')}</select>
			<input data-tfield="time" type="time" value="${cronTime}" style="${fld}" />
		</div>
		<div data-tgroup="heartbeat" style="display:${t.kind === 'heartbeat' ? 'flex' : 'none'};gap:8px;align-items:center">
			<input data-tfield="hours" type="number" min="1" value="${t.everyHours ?? 6}" style="${fld};width:70px" /><span style="font:400 12px/1 system-ui;color:#969ba4">hours between sweeps</span>
		</div>
		<div data-tgroup="event" style="display:${t.kind === 'event' ? 'flex' : 'none'};gap:8px;align-items:center">
			<input data-tfield="source" type="text" value="${esc(t.source ?? '*')}" placeholder="* (any source)" style="${fld};width:220px" /><span style="font:400 12px/1 system-ui;color:#969ba4">source path, or * for any</span>
		</div>
		<div><button data-trigger-save data-arg="${esc(agent.id)}" style="border:none;border-radius:7px;padding:8px 14px;background:${ACCENT};color:#fff;font:600 12px/1 system-ui;cursor:pointer">Save trigger</button></div>
	</div>`;
	return `<div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">${card('POLICY', policyBody)}${card('TRIGGER', triggerBody)}</div>`;
}

// The run log (plan 32 iter 3): the agent's persisted runs newest-first, each a row of relative time, the
// trigger `via`, the outcome counts (docs / applied / queued), and a failure or skip line where honest. A run
// that queued changes carries an "N queued" link into the review surface. Truthful empty state when it never ran.
function renderAgentRunLog(agent: IAgentDef, runs: readonly IAgentRun[]): string {
	const head = `<div style="display:flex;align-items:center;padding:10px 16px;background:#f8f9fb;border-bottom:1px solid #eef0f3;font:600 10px/1 'JetBrains Mono',ui-monospace,monospace;letter-spacing:.06em;color:#a3a8b2"><div style="flex:1.4">WHEN</div><div style="flex:1.1">VIA</div><div style="flex:2.6">OUTCOME</div><div style="flex:1.2"></div></div>`;
	if (!runs.length) {
		return `<div style="background:#fff;border:1px solid #e9eaee;border-radius:12px;overflow:hidden"><div style="padding:11px 16px;font:600 10px/1 'JetBrains Mono',ui-monospace,monospace;letter-spacing:.06em;color:#a3a8b2;border-bottom:1px solid #eef0f3">RUN LOG</div><div style="padding:22px 16px;font:400 12.5px/1.5 system-ui;color:#969ba4">No runs yet. This agent has not run - Run now, or wait for its ${esc(agent.trigger.kind)} trigger.</div></div>`;
	}
	const rows = runs.map(r => {
		let outcome: string;
		let outcomeColor = '#52575f';
		if (r.skippedReason === 'still-running') {
			outcome = 'Skipped &middot; a previous run was still running';
			outcomeColor = '#868b95';
		} else if (r.error) {
			outcome = `Failed &middot; ${esc(r.error)}`;
			outcomeColor = '#b4332f';
		} else {
			const docs = r.docsTouched ?? 0;
			outcome = `${docs} doc${docs === 1 ? '' : 's'} &middot; ${r.applied} applied &middot; ${r.queued} queued`;
		}
		const reviewLink = (!r.error && !r.skippedReason && r.queued > 0)
			? `<button data-msg="goReview" style="border:none;background:none;font:600 12px/1 system-ui;color:${ACCENT_DK};cursor:pointer">${r.queued} queued &#8594;</button>`
			: '';
		return `<div style="display:flex;align-items:center;padding:12px 16px;border-bottom:1px solid #f4f5f7;font:400 12.5px/1.4 system-ui">
			<div style="flex:1.4;color:#52575f">${relTime(r.finishedAt ?? r.startedAt)}</div>
			<div style="flex:1.1;font:400 11px/1 'JetBrains Mono',ui-monospace,monospace;color:#868b95">${esc(r.via ?? 'manual')}</div>
			<div style="flex:2.6;color:${outcomeColor}">${outcome}</div>
			<div style="flex:1.2;text-align:right">${reviewLink}</div>
		</div>`;
	}).join('');
	return `<div style="background:#fff;border:1px solid #e9eaee;border-radius:12px;overflow:hidden"><div style="padding:11px 16px;font:600 10px/1 'JetBrains Mono',ui-monospace,monospace;letter-spacing:.06em;color:#a3a8b2;border-bottom:1px solid #eef0f3">RUN LOG &middot; ${runs.length}</div>${head}${rows}</div>`;
}

// The cross-project skill run strip (plan 32 iter 3, the P3 gap): the "Run skill across project" affordance and,
// after a run, one row per document with its grade (flag/pass/skipped) and the grader's one-line reason. Real
// data only - skipped is honest (not living, or a model-backed skill with no model), never a fabricated pass.
function renderSkillRunCard(summary: ISkillRunSummary | undefined): string {
	const skillBtn = (id: string, label: string) => `<button data-msg="runSkillProject" data-arg="${id}" style="border:1px solid #d4d7dd;border-radius:8px;padding:8px 13px;background:#fff;color:#52575f;font:600 12px/1 system-ui;cursor:pointer">${label} across project</button>`;
	const actions = `<div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:10px">${skillBtn('formatting', 'Run Formatting')}${skillBtn('financial', 'Run Financial')}${skillBtn('strategy', 'Run Strategy')}</div>`;
	let body: string;
	if (!summary) {
		body = `<div style="font:400 12.5px/1.5 system-ui;color:#969ba4">Run a Skill grader across every document in the project - results land in the review rail as usual.</div>${actions}`;
	} else {
		const rows = summary.results.map(r => {
			const dot = r.status === 'flag' ? 'oklch(0.66 0.16 45)' : r.status === 'pass' ? 'oklch(0.55 0.14 150)' : '#cdd1d8';
			const label = r.status === 'flag' ? 'Flag' : r.status === 'pass' ? 'Pass' : 'Skipped';
			const color = r.status === 'flag' ? '#9a6b16' : r.status === 'pass' ? '#1f7a44' : '#868b95';
			return `<div style="display:flex;align-items:center;gap:10px;padding:10px 16px;border-bottom:1px solid #f4f5f7;font:400 12.5px/1.4 system-ui">
				<span style="width:7px;height:7px;flex:none;border-radius:50%;background:${dot}"></span>
				<span style="flex:1.4;font-weight:500;color:#1a1c20">${esc(r.docTitle)}</span>
				<span style="flex:none;font:600 11px/1 system-ui;color:${color}">${label}</span>
				<span style="flex:2.4;font:400 11.5px/1.4 system-ui;color:#868b95">${esc(r.detail)}</span>
			</div>`;
		}).join('') || `<div style="padding:18px 16px;font:400 12.5px/1.5 system-ui;color:#969ba4">No gradeable documents in this project.</div>`;
		const summaryLine = `${summary.flagged} flagged &middot; ${summary.passed} passed${summary.skipped ? ` &middot; ${summary.skipped} skipped` : ''}`;
		body = `<div style="font:400 12.5px/1.5 system-ui;color:#52575f;margin-bottom:2px"><strong style="color:#1a1c20;font-weight:600">${esc(summary.skillName)}</strong> across the project &middot; ${summaryLine}</div>${actions}<div style="margin-top:12px;border:1px solid #eef0f3;border-radius:10px;overflow:hidden">${rows}</div>`;
	}
	return `<div style="background:#fff;border:1px solid #e9eaee;border-radius:12px;padding:16px 18px"><div style="font:600 10px/1 'JetBrains Mono',ui-monospace,monospace;letter-spacing:.06em;color:#a3a8b2;margin-bottom:12px">RUN A SKILL ACROSS THE PROJECT</div>${body}</div>`;
}
