/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Agents: the live registry list, the per-agent workflow canvas + detail drawer (policy select, trigger
// editor), the run log and the cross-project skill-run strip. Only `renderAgents` is public. Split out of
// screenRender.ts so the Knowledge + Agents lane owns its own file; shared helpers come from the shell.

import { IAgentDef, IAgentFlow, IAgentRun, IAgentTrigger, ISkillRunSummary } from '../common/livingDocsModel.js';
import { ACCENT, ACCENT_DK, AgentFilter, esc, IScreenState } from './screenRenderShell.js';

// ---- Agents: the live registry table, and the workflow canvas for one agent. ----
export function renderAgents(state: IScreenState): string {
	const open = state.openAgentId ? state.agents.find(a => a.id === state.openAgentId) : undefined;
	return open ? renderAgentCanvas(open, state) : renderAgentList(state);
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

function flowLabel(f: IAgentFlow): string {
	const s = f.sources.length ? f.sources.map(base).join(', ') : 'all sources';
	const d = f.docs.length ? f.docs.map(base).join(', ') : 'all documents';
	return `${s} &#8594; ${d}`;
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

function isScheduled(a: IAgentDef): boolean { return a.trigger.kind === 'cron' || a.trigger.kind === 'heartbeat'; }
function isEvent(a: IAgentDef): boolean { return a.trigger.kind === 'event' || a.trigger.kind === 'lifecycle'; }

function renderAgentList(state: IScreenState): string {
	const agents = state.agents;
	const counts = {
		all: agents.length,
		scheduled: agents.filter(isScheduled).length,
		event: agents.filter(isEvent).length,
		needs: agents.filter(a => a.status === 'needs-approval').length,
	};
	const chip = (id: AgentFilter, label: string, warn = false) => {
		const on = state.filter === id;
		return `<button data-msg="setFilter" data-arg="${id}" style="font:500 12px/1 system-ui;cursor:pointer;${on ? 'color:#15181f;background:#fff;border:1px solid #e6e8ed;box-shadow:0 1px 2px rgba(0,0,0,.04);' : `color:${warn ? '#9a6b16' : '#868b95'};background:none;border:1px solid transparent;`}border-radius:8px;padding:7px 12px">${label}</button>`;
	};
	const shown = agents.filter(a => state.filter === 'all'
		|| (state.filter === 'scheduled' && isScheduled(a))
		|| (state.filter === 'event' && isEvent(a))
		|| (state.filter === 'needs-approval' && a.status === 'needs-approval'));
	const rows = shown.map(a => `<div data-msg="openAgent" data-arg="${esc(a.id)}" style="display:flex;align-items:center;padding:15px 18px;border-bottom:1px solid #f1f2f5;font:400 13px/1.4 system-ui;cursor:pointer${a.disabled ? ';opacity:.62' : ''}">
		<div style="flex:2.4;display:flex;align-items:center;gap:9px"><span style="color:${ACCENT}">${AGENT_ICON[a.trigger.kind] ?? '&#9679;'}</span><span style="font-weight:500">${esc(a.name)}</span>${a.disabled ? `<span style="font:600 9px/1 'JetBrains Mono',ui-monospace,monospace;color:#868b95;background:#eef0f3;border-radius:999px;padding:3px 7px">PAUSED</span>` : ''}<span style="font:400 10px/1 'JetBrains Mono',ui-monospace,monospace;color:#aeb6e0">open &#8599;</span></div>
		<div style="flex:1.4;font:400 12px/1 'JetBrains Mono',ui-monospace,monospace;color:#696e78">${triggerLabel(a.trigger)}</div>
		<div style="flex:2.6;font:400 12px/1.5 'JetBrains Mono',ui-monospace,monospace;color:#868b95">${flowLabel(a.flow)}</div>
		<div style="flex:1.3;color:#969ba4;font:400 12px/1 system-ui">${relTime(a.lastRun)}</div>
		<div style="flex:1.4">${a.disabled ? statusBadge('paused') : statusBadge(a.status)}</div>
	</div>`).join('');
	const empty = `<div style="padding:24px 18px;font:400 12.5px/1.5 system-ui;color:#969ba4">No agents match this filter.</div>`;
	return `<div class="screen">
	<div class="scr-head"><div><h2 class="scr-title">Agents</h2><div class="scr-sub">Documents talking to documents &mdash; running quietly in the background.</div></div><div style="margin-left:auto;display:flex;align-items:center;gap:8px"><button class="btn-ghost" data-msg="createAgent">&#65291; New agent</button><button class="btn-primary" data-msg="runProject">&#10022; Run Across the Project</button></div></div>
	<div class="scr-body">
		<div style="max-width:1040px;margin:0 auto;padding:24px 28px 80px">
			<div style="display:flex;gap:6px;margin-bottom:16px">${chip('all', `All &middot; ${counts.all}`)}${chip('scheduled', `Scheduled &middot; ${counts.scheduled}`)}${chip('event', `Event &middot; ${counts.event}`)}${chip('needs-approval', `Needs approval &middot; ${counts.needs}`, true)}</div>
			<div style="background:#fff;border:1px solid #e9eaee;border-radius:12px;overflow:hidden">
				<div style="display:flex;align-items:center;padding:11px 18px;background:#f8f9fb;border-bottom:1px solid #eef0f3;font:600 10px/1 'JetBrains Mono',ui-monospace,monospace;letter-spacing:.06em;color:#a3a8b2"><div style="flex:2.4">AGENT</div><div style="flex:1.4">TRIGGER</div><div style="flex:2.6">FLOW</div><div style="flex:1.3">LAST RUN</div><div style="flex:1.4">STATUS</div></div>
				${rows || empty}
			</div>
			<div style="margin-top:14px;font:400 12px/1.5 'JetBrains Mono',ui-monospace,monospace;color:#bcc0c8">Tip: open an agent to see its flow on the canvas, then Run now.</div>
		</div>
	</div>
</div>`;
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
