/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// The "main-area" Opportunity OS screens beyond the document editor -- Templates, Knowledge and
// Agents (with the workflow canvas). Each is rendered into a webview editor (see screenEditor.ts)
// so it fills the editor area at the comp's intended width, matching the Workbench hi-fi. These are
// our own surfaces (no core patch): the HTML below is ported from the locked design comp, with the
// comp's non-ASCII glyphs written as HTML entities to satisfy the source-hygiene rule.

export type ScreenId = 'home' | 'templates' | 'knowledge' | 'agents';

export interface IScreenState {
	/** Knowledge: which scope tab is selected. */
	readonly knScope: 'org' | 'project';
	/** Agents: whether the workflow canvas is open (vs the agents list). */
	readonly agentOpen: boolean;
	/** Agents: whether the open workflow has been run (drives the canvas highlights). */
	readonly ranWf: boolean;
}

const ACCENT = 'oklch(0.55 0.13 255)';
const ACCENT_DK = 'oklch(0.5 0.13 255)';

// Shared webview head: same font stack, selection colour and scrollbar treatment as the comp shell.
const HEAD = `<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<style>
*{box-sizing:border-box}
html,body{margin:0;height:100%}
body{font-family:system-ui,-apple-system,'Segoe UI',sans-serif;color:#1a1c20;background:#fff}
::selection{background:rgba(80,110,235,.18)}
::-webkit-scrollbar{width:11px;height:11px}
::-webkit-scrollbar-thumb{background:#d7d9df;border:3px solid transparent;background-clip:content-box;border-radius:8px}
::-webkit-scrollbar-thumb:hover{background:#c2c5cd;background-clip:content-box}
@keyframes lwdPulse{0%,100%{opacity:1}50%{opacity:.35}}
.screen{height:100vh;display:flex;flex-direction:column;min-height:0;background:#fff}
.scr-head{flex:none;display:flex;align-items:center;gap:16px;padding:18px 28px;border-bottom:1px solid #eef0f3}
.scr-title{margin:0 0 4px;font:600 18px/1.2 system-ui;color:#15171c}
.scr-sub{font:400 12px/1 'JetBrains Mono',ui-monospace,monospace;color:#a3a8b2}
.scr-body{flex:1;overflow-y:auto;background:#f8f9fb}
.btn-primary{border:none;border-radius:8px;padding:10px 16px;background:${ACCENT};color:#fff;font:600 13px/1 system-ui;cursor:pointer}
.btn-ghost{border:1px solid #e0e2e8;background:#fff;border-radius:8px;padding:8px 13px;font:500 12px/1 system-ui;color:#52575f;cursor:pointer}
</style>`;

// Generic message bridge: any element with data-msg posts {type:<msg>, arg:<data-arg>} to the host.
const SCRIPT = `const vscode = acquireVsCodeApi();
for (const el of document.querySelectorAll('[data-msg]')) {
	el.addEventListener('click', () => vscode.postMessage({ type: el.getAttribute('data-msg'), arg: el.getAttribute('data-arg') || undefined }));
}`;

function page(body: string): string {
	return `<!DOCTYPE html><html><head>${HEAD}</head><body>${body}<script>${SCRIPT}</script></body></html>`;
}

export function renderScreenHtml(screen: ScreenId, state: IScreenState): string {
	switch (screen) {
		case 'home': return page(renderHome());
		case 'templates': return page(renderTemplates());
		case 'knowledge': return page(renderKnowledge(state));
		case 'agents': return page(renderAgents(state));
	}
}

// ---- Home: the landing dashboard -- greeting, quick start, and the projects grid. ----
function renderHome(): string {
	const quick = (msg: string, iconBg: string, iconFg: string, icon: string, title: string, sub: string, primary: boolean) => `<button ${msg ? `data-msg="${msg}" ` : ''}style="flex:1;min-width:200px;text-align:left;border:1px solid ${primary ? '#e0e6ff' : '#e9eaee'};background:${primary ? '#f7f9ff' : '#fff'};border-radius:12px;padding:15px 16px;cursor:pointer;display:flex;align-items:center;gap:12px"><span style="width:34px;height:34px;flex:none;border-radius:9px;background:${iconBg};color:${iconFg};font-size:16px;display:flex;align-items:center;justify-content:center">${icon}</span><span><span style="display:block;font:600 13.5px/1.2 system-ui;color:#1a1c20;margin-bottom:3px">${title}</span><span style="font:400 12px/1.3 system-ui;color:#868b95">${sub}</span></span></button>`;
	const since = (dot: string, html: string) => `<div style="display:flex;gap:9px;margin-bottom:9px"><span style="width:7px;height:7px;border-radius:50%;background:${dot};margin-top:5px;flex:none"></span><span style="font:400 12.5px/1.5 system-ui;color:#3a3f49">${html}</span></div>`;
	const project = (mono: string, monoBg: string, name: string, badge: string, stats: string, since1: string, since2: string, actions: string) => `<div style="background:#fff;border:1px solid #e9eaee;border-radius:13px;overflow:hidden;display:flex;flex-direction:column">
		<div style="padding:16px 17px 14px"><div style="display:flex;align-items:center;gap:10px;margin-bottom:3px"><span style="width:26px;height:26px;flex:none;border-radius:7px;background:${monoBg};color:#fff;font:600 12px/1 system-ui;display:flex;align-items:center;justify-content:center">${mono}</span><span style="font:600 15px/1.2 system-ui;color:#15171c">${name}</span>${badge}</div><div style="font:400 11.5px/1 'JetBrains Mono',ui-monospace,monospace;color:#a3a8b2;padding-left:36px">${stats}</div></div>
		<div style="margin:0 17px;border-top:1px solid #f1f2f5;padding:13px 0 4px"><div style="font:600 9.5px/1 'JetBrains Mono',ui-monospace,monospace;letter-spacing:.08em;color:#bcc0c8;margin-bottom:9px">SINCE YOUR LAST VISIT</div>${since1}${since2}</div>
		<div style="margin-top:auto;display:flex;gap:8px;padding:14px 17px;border-top:1px solid #f1f2f5">${actions}</div></div>`;
	const toApprove = `<span style="margin-left:auto;font:600 10px/1 'JetBrains Mono',ui-monospace,monospace;color:#9a6b16;background:#fdf2dc;border-radius:999px;padding:5px 9px">1 TO APPROVE</span>`;
	const healthy = `<span style="margin-left:auto;display:inline-flex;align-items:center;gap:6px;font:600 10px/1 system-ui;color:#1f7a44"><span style="width:7px;height:7px;border-radius:50%;background:oklch(0.6 0.13 150)"></span>Healthy</span>`;
	const reviewBtn = `<button data-msg="goReview" style="border:none;border-radius:8px;padding:9px 14px;background:${ACCENT};color:#fff;font:600 12.5px/1 system-ui;cursor:pointer">Review change</button>`;
	const openBtn = `<button data-msg="present" style="border:1px solid #e0e2e8;border-radius:8px;padding:9px 14px;background:#fff;color:#52575f;font:500 12.5px/1 system-ui;cursor:pointer">Open project</button>`;
	const grey = '#cfd3da', amber = 'oklch(0.66 0.16 45)', green = 'oklch(0.6 0.13 150)';

	return `<div class="screen"><div style="flex:1;overflow-y:auto;background:#f8f9fb">
		<div style="max-width:1080px;margin:0 auto;padding:40px 36px 80px">
			<div style="display:flex;align-items:flex-end;justify-content:space-between;gap:24px;margin-bottom:8px"><h1 style="margin:0;font:600 26px/1.2 system-ui;color:#15171c;letter-spacing:-.01em">Good morning, Tom</h1><div style="font:400 12.5px/1 'JetBrains Mono',ui-monospace,monospace;color:#a3a8b2">Saturday, Jun 20</div></div>
			<p style="margin:0 0 26px;font:400 14.5px/1.5 system-ui;color:#696e78">Across <strong style="font-weight:600;color:#3a3f49">4 projects</strong> &mdash; <strong style="font-weight:600;color:#9a6b16">2 changes need your approval</strong>, and 3 agents ran since you were last here.</p>
			<div style="font:600 11px/1 'JetBrains Mono',ui-monospace,monospace;letter-spacing:.1em;color:#a3a8b2;margin-bottom:12px">QUICK START</div>
			<div style="display:flex;gap:12px;margin-bottom:34px;flex-wrap:wrap">
				${quick('', ACCENT, '#fff', '&#65291;', 'New project', 'Bind sources, set agents', true)}
				${quick('goTemplates', '#eef1f6', '#52575f', '&#9636;', 'New doc from template', 'Weekly report, Quote, SOP&hellip;', false)}
				${quick('goEditor', '#eef1f6', '#52575f', '&#9998;', 'Blank document', 'Start writing, link later', false)}
			</div>
			<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px"><div style="font:600 11px/1 'JetBrains Mono',ui-monospace,monospace;letter-spacing:.1em;color:#a3a8b2">YOUR PROJECTS</div><div style="display:flex;gap:5px"><span style="font:500 11.5px/1 system-ui;color:#15181f;background:#fff;border:1px solid #e6e8ed;border-radius:7px;padding:6px 10px">All &middot; 4</span><span style="font:500 11.5px/1 system-ui;color:#9a6b16;padding:6px 10px">Needs approval &middot; 2</span></div></div>
			<div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
				${project('OS', ACCENT, 'Opportunity OS', toApprove, '6 docs &middot; 4 sources &middot; 3 agents', since(amber, '<strong style="font-weight:600">Weekly refresh</strong> ran 2m ago &mdash; 3 figures applied to Weekly Summary, <strong style="font-weight:600;color:#9a6b16">1 narrative change awaiting approval</strong>.'), since(grey, 'Board Note auto-updated from kpi.webhook &middot; no review needed.'), reviewBtn + openBtn)}
				${project('AC', '#0e7c66', 'Acme Co &mdash; Client', healthy, '3 docs &middot; 1 source &middot; 1 agent', since(green, '<strong style="font-weight:600">Quote &rarr; tracker</strong> extracted 2 new line items from <em>Acme SOW.pdf</em> into the pipeline.'), since(grey, 'Client Update draft regenerated &middot; ready to send.'), openBtn)}
				${project('F3', '#5a3ea8', 'Fund III &mdash; LP Reporting', toApprove, '4 docs &middot; 2 sources &middot; 2 agents', since(amber, 'Portfolio markdown detected &mdash; <strong style="font-weight:600;color:#9a6b16">a TVPI figure dropped</strong>, so the LP letter&#39;s tone change needs sign-off.'), since(grey, 'Capital-account tables refreshed for all 12 LPs.'), reviewBtn + openBtn)}
				${project('JS', '#b5642a', 'Job Search 2026', healthy, '2 docs &middot; 1 source &middot; 1 agent', since(grey, '<strong style="font-weight:600;color:#3a3f49">Weekly tracker</strong> compiled 4 new applications from the inbox &middot; status synced.'), '', openBtn)}
			</div>
		</div>
	</div></div>`;
}

// ---- Templates: run a template -> fill from sources -> review the diff. ----
function renderTemplates(): string {
	const step = (n: string, label: string, extra: string, inner: string) => `<div style="background:#fff;border:1px solid #e9eaee;border-radius:12px;padding:16px">`
		+ `<div style="display:flex;align-items:center;gap:8px;margin-bottom:12px"><span style="width:20px;height:20px;border-radius:50%;background:${ACCENT};color:#fff;font:600 11px/20px system-ui;text-align:center">${n}</span><span style="font:600 13px/1 system-ui">${label}</span>${extra}</div>${inner}</div>`;
	const green = (t: string) => `<span style="background:#e7f6ec;color:#1f5a36;padding:0 4px;border-radius:3px;font-weight:600">${t}</span>`;
	const srcChip = (t: string) => `<span style="display:flex;align-items:center;gap:6px;font:500 12px/1 'JetBrains Mono',ui-monospace,monospace;color:#52575f;background:#f4f6ff;border:1px solid #e2e8ff;border-radius:999px;padding:6px 10px"><span style="width:6px;height:6px;border-radius:50%;background:${ACCENT}"></span>${t}</span>`;
	return `<div class="screen">
	<div class="scr-head" style="display:block"><h2 class="scr-title">Run template &mdash; Weekly report</h2><div class="scr-sub">Fill from sources, generate a draft, review the diff before it lands.</div></div>
	<div class="scr-body">
		<div style="max-width:980px;margin:0 auto;padding:26px 28px 80px;display:flex;gap:20px;align-items:flex-start">
			<div style="width:380px;flex:none;display:flex;flex-direction:column;gap:14px">
				${step('1', 'Template', '', `<div style="border:1px solid #e6e8ed;border-radius:8px;padding:10px 12px;display:flex;align-items:center;gap:8px;font:500 13px/1 system-ui;color:#2c2f36">&#9636; Weekly report<span style="margin-left:auto;color:#a3a8b2">&#9662;</span></div>`)}
				${step('2', 'Prompt', `<button class="btn-ghost" style="margin-left:auto;display:flex;align-items:center;gap:6px;padding:5px 9px;font:500 11px/1 system-ui">&#127897; Voice</button>`, `<div style="border:1px solid #e6e8ed;border-radius:8px;padding:11px 12px;font:400 13.5px/1.55 system-ui;color:#2c2f36;background:#fcfcfd">Summarise week 24. Flag the signup spike and call out that growth accelerated.</div>`)}
				${step('3', 'Sources', '', `<div style="display:flex;flex-wrap:wrap;gap:7px">${srcChip('metrics.csv')}${srcChip('crm &middot; api')}<span style="display:flex;align-items:center;gap:6px;font:500 12px/1 'JetBrains Mono',ui-monospace,monospace;color:#868b95;background:#fff;border:1px dashed #d4d7de;border-radius:999px;padding:6px 10px">&#65291; add source</span></div>`)}
				<button class="btn-primary" style="border-radius:10px;padding:13px;font:600 14px/1 system-ui">Generate draft</button>
			</div>
			<div style="flex:1;min-width:0;background:#fff;border:1px solid #e9eaee;border-radius:12px;overflow:hidden">
				<div style="display:flex;align-items:center;gap:10px;padding:13px 18px;border-bottom:1px solid #f1f2f5"><span style="font:600 12px/1 system-ui;color:#2c2f36">Draft preview</span><span style="font:600 10px/1 'JetBrains Mono',ui-monospace,monospace;color:#1f7a44;background:#e7f6ec;border-radius:999px;padding:4px 8px">ALL SLOTS RESOLVED</span><div style="margin-left:auto;display:flex;gap:7px"><button class="btn-ghost" style="padding:6px 11px;font:500 12px/1 system-ui" data-msg="goReview">Review diff &#8594;</button><button class="btn-ghost" style="padding:6px 11px;font:500 12px/1 system-ui" data-msg="present">Export</button></div></div>
				<div style="padding:28px 32px">
					<h1 style="margin:0 0 4px;font:600 23px/1.2 system-ui;color:#15171c">Weekly Operating Summary</h1>
					<div style="font:400 12px/1 'JetBrains Mono',ui-monospace,monospace;color:#a3a8b2;margin-bottom:24px">Week ${green('24')} &middot; Jun 15&ndash;19</div>
					<h2 style="margin:0 0 10px;font:600 16px/1.3 system-ui;color:#23262c">Highlights</h2>
					<p style="margin:0 0 20px;font:400 15px/1.7 system-ui;color:#2c2f36">Revenue grew ${green('18%')} to ${green('$48.6k')} MRR on ${green('427')} new signups.</p>
					<h2 style="margin:0 0 10px;font:600 16px/1.3 system-ui;color:#23262c">Commentary</h2>
					<p style="margin:0;font:400 15px/1.7 system-ui;color:#2c2f36">Growth ${green('accelerated sharply')} &mdash; fastest pace this quarter. The signup spike is the headline; watch activation next week.</p>
					<div style="margin-top:22px;padding-top:16px;border-top:1px dashed #e6e8ed;font:400 11.5px/1.6 'JetBrains Mono',ui-monospace,monospace;color:#bcc0c8"><span style="color:#1f7a44">green</span> = filled from source &middot; grey template slots all resolved</div>
				</div>
			</div>
		</div>
	</div>
</div>`;
}

// ---- Knowledge: the decision stack (Org enduring / Project directional) agents align to. ----
function renderKnowledge(state: IScreenState): string {
	const isOrg = state.knScope === 'org';
	const tabStyle = (on: boolean) => on
		? 'background:#fff;color:#1a1c20;box-shadow:0 1px 2px rgba(0,0,0,.06)'
		: 'background:transparent;color:#868b95';
	const card = (border: string, label: string, labelColor: string, inner: string) => `<div style="background:#fff;border:1px solid #e9eaee;${border};border-radius:11px;padding:18px 20px;margin-bottom:11px"><div style="font:600 11px/1 'JetBrains Mono',ui-monospace,monospace;letter-spacing:.06em;color:${labelColor};margin-bottom:8px">${label}</div>${inner}</div>`;
	const krBar = (label: string, val: string, valColor: string, pct: string, barColor: string) => `<div><div style="display:flex;justify-content:space-between;font:400 12.5px/1.4 system-ui;color:#52575f;margin-bottom:5px"><span>${label}</span><span style="font-weight:600;color:${valColor}">${val}</span></div><div style="height:6px;border-radius:999px;background:#eef0f3;overflow:hidden"><div style="width:${pct};height:100%;background:${barColor}"></div></div></div>`;
	const metric = (label: string, val: string, sub: string, subColor: string) => `<div style="flex:1;background:#fff;border:1px solid #e9eaee;border-radius:11px;padding:15px 16px"><div style="font:600 10px/1 'JetBrains Mono',ui-monospace,monospace;letter-spacing:.06em;color:#a3a8b2;margin-bottom:9px">${label}</div><div style="font:600 22px/1 system-ui;color:#1d1b16;margin-bottom:4px">${val}</div><div style="font:400 11px/1 'JetBrains Mono',ui-monospace,monospace;color:${subColor}">${sub}</div></div>`;
	const value = (t: string) => `<span style="font:500 12px/1 system-ui;color:#52575f;background:#f4f6ff;border:1px solid #e2e8ff;border-radius:999px;padding:6px 11px">${t}</span>`;
	const principle = (n: string, t: string) => `<div style="display:flex;gap:10px"><span style="font:600 12px/1.5 system-ui;color:oklch(0.6 0.13 60)">${n}</span><span style="font:400 14px/1.5 system-ui;color:#2f2c26">${t}</span></div>`;
	const arrow = (t: string) => `<div style="display:flex;gap:10px"><span style="color:${ACCENT};font:600 13px/1.5 system-ui">&#8594;</span><span style="font:400 14px/1.5 system-ui;color:#2f2c26">${t}</span></div>`;

	const org = `<div style="font:600 10px/1 'JetBrains Mono',ui-monospace,monospace;letter-spacing:.1em;color:#bcb199;margin:0 0 12px">ENDURING &middot; WHY WE EXIST</div>
		${card('border-left:3px solid oklch(0.6 0.13 60)', 'MISSION', '#a99b78', `<p style="margin:0;font:500 19px/1.4 system-ui;color:#1d1b16;letter-spacing:-.01em">Make every business document trustworthy by default.</p>`)}
		${card('border-left:3px solid oklch(0.6 0.13 60)', 'VISION', '#a99b78', `<p style="margin:0;font:400 16px/1.55 system-ui;color:#2f2c26">A world where teams act on the documents in front of them without ever having to re-check the numbers or the wording.</p>`)}
		<div style="font:600 10px/1 'JetBrains Mono',ui-monospace,monospace;letter-spacing:.1em;color:#bcb199;margin:20px 0 12px">HOW WE OPERATE</div>
		<div style="display:flex;gap:11px;margin-bottom:11px"><div style="flex:1;background:#fff;border:1px solid #e9eaee;border-radius:11px;padding:16px 18px"><div style="font:600 11px/1 'JetBrains Mono',ui-monospace,monospace;letter-spacing:.06em;color:#a3a8b2;margin-bottom:11px">VALUES</div><div style="display:flex;flex-wrap:wrap;gap:7px">${value('Truth over polish')}${value('Auditability')}${value('Calm software')}${value('Customer proximity')}</div></div></div>
		<div style="background:#fff;border:1px solid #e9eaee;border-radius:11px;padding:16px 18px"><div style="font:600 11px/1 'JetBrains Mono',ui-monospace,monospace;letter-spacing:.06em;color:#a3a8b2;margin-bottom:11px">PRINCIPLES</div><div style="display:flex;flex-direction:column;gap:10px">${principle('01', `Never ship a change a human can't trace back to its source.`)}${principle('02', 'Automate the safe, escalate the meaningful.')}${principle('03', 'Default to the calm path: fewer surfaces, clearer diffs.')}</div></div>`;

	const project = `<div style="font:600 10px/1 'JetBrains Mono',ui-monospace,monospace;letter-spacing:.1em;color:#bcb199;margin:0 0 12px">DIRECTIONAL &middot; HOW WE WIN</div>
		${card('border-left:3px solid ' + ACCENT, 'PRODUCT STRATEGY', '#8a93c4', `<div style="display:flex;flex-direction:column;gap:10px">${arrow('<strong style="font-weight:600">Wedge:</strong> land on recurring, data-linked reports &mdash; the painful work that repeats.')}${arrow('<strong style="font-weight:600">Moat:</strong> provenance + approval trail nobody can retrofit onto a chatbot.')}${arrow('<strong style="font-weight:600">Expand:</strong> from one bound report outward to quotes, SOPs and trackers.')}</div>`)}
		<div style="font:600 10px/1 'JetBrains Mono',ui-monospace,monospace;letter-spacing:.1em;color:#bcb199;margin:20px 0 12px">MEASURABLE &middot; WHAT WE TRACK</div>
		<div style="background:#fff;border:1px solid #e9eaee;border-radius:11px;padding:16px 18px;margin-bottom:11px"><div style="display:flex;align-items:center;gap:9px;margin-bottom:13px"><span style="font:600 11px/1 'JetBrains Mono',ui-monospace,monospace;letter-spacing:.06em;color:#a3a8b2">Q3 OKRs</span><span style="font:600 10px/1 system-ui;color:#9a6b16;background:#fdf2dc;border-radius:999px;padding:4px 8px">OBJECTIVE 2</span></div><p style="margin:0 0 14px;font:500 15px/1.4 system-ui;color:#1d1b16">Prove the report wedge with real recurring usage.</p><div style="display:flex;flex-direction:column;gap:12px">${krBar('KR1 &middot; 25 weekly reports live', '18 / 25', '#1f7a44', '72%', 'oklch(0.55 0.14 150)')}${krBar('KR2 &middot; +20% MRR from reporting tier', '+13%', '#9a6b16', '65%', 'oklch(0.7 0.14 70)')}${krBar('KR3 &middot; 90% changes reviewed in &lt;1 day', '94%', '#1f7a44', '94%', 'oklch(0.55 0.14 150)')}</div></div>
		<div style="display:flex;gap:11px">${metric('ACTIVATION', '61%', 'target 55% &#10003;', '#1f7a44')}${metric('NET RETENTION', '118%', 'target 110% &#10003;', '#1f7a44')}${metric('TIME-TO-TRUST', '2.1d', 'target 1d', '#9a6b16')}</div>`;

	return `<div class="screen">
	<div class="scr-head">
		<div><h2 class="scr-title">Knowledge</h2><div class="scr-sub">The decision stack &mdash; what agents and documents align to.</div></div>
		<div style="margin-left:auto;display:flex;gap:5px;background:#f1f2f5;border-radius:9px;padding:3px">
			<button data-msg="setKnOrg" style="border:none;border-radius:7px;padding:7px 13px;font:500 12px/1 system-ui;cursor:pointer;${tabStyle(isOrg)}">Organization</button>
			<button data-msg="setKnProject" style="border:none;border-radius:7px;padding:7px 13px;font:500 12px/1 system-ui;cursor:pointer;${tabStyle(!isOrg)}">Project &middot; Opportunity OS</button>
		</div>
		<button class="btn-ghost">Edit</button>
	</div>
	<div class="scr-body">
		<div style="max-width:1040px;margin:0 auto;padding:26px 28px 80px;display:flex;gap:22px;align-items:flex-start">
			<div style="flex:1;min-width:0">${isOrg ? org : project}</div>
			<div style="width:288px;flex:none">
				<div style="background:#fff;border:1px solid #e9eaee;border-radius:12px;padding:16px 17px;margin-bottom:14px">
					<div style="font:600 11px/1 system-ui;color:#1a1c20;margin-bottom:10px">How this is used</div>
					<p style="margin:0 0 14px;font:400 12.5px/1.55 system-ui;color:#696e78">This is the decision stack teams align to. Agents read it; documents inherit it; reviews check against it.</p>
					<div style="display:flex;flex-direction:column;gap:9px">
						<div style="display:flex;gap:9px;align-items:flex-start"><span style="width:24px;height:24px;flex:none;border-radius:7px;background:#fdf2dc;color:#9a6b16;font-size:12px;display:flex;align-items:center;justify-content:center">&#9672;</span><span style="font:400 12px/1.45 system-ui;color:#52575f"><strong style="font-weight:600">Strategy agent</strong> tests document claims against this.</span></div>
						<div style="display:flex;gap:9px;align-items:flex-start"><span style="width:24px;height:24px;flex:none;border-radius:7px;background:#eef1ff;color:${ACCENT_DK};font-size:12px;display:flex;align-items:center;justify-content:center">&#9635;</span><span style="font:400 12px/1.45 system-ui;color:#52575f">Auto-attached to <strong style="font-weight:600">6 documents</strong> as context.</span></div>
						<div style="display:flex;gap:9px;align-items:flex-start"><span style="width:24px;height:24px;flex:none;border-radius:7px;background:#e7f6ec;color:#1f7a44;font-size:12px;display:flex;align-items:center;justify-content:center">&#10003;</span><span style="font:400 12px/1.45 system-ui;color:#52575f">Last reviewed <strong style="font-weight:600">2 weeks ago</strong> by Tom.</span></div>
					</div>
				</div>
				<div style="background:#fdfaf2;border:1px solid #e4dccb;border-radius:12px;padding:14px 16px">
					<div style="font:600 10px/1 'JetBrains Mono',ui-monospace,monospace;letter-spacing:.06em;color:#a99b78;margin-bottom:9px">DECISION STACK</div>
					<div style="display:flex;flex-direction:column;gap:6px;font:500 12px/1.4 system-ui">
						<div style="background:#fff;border:1px solid #efe7d6;border-radius:7px;padding:8px 10px;color:#1d1b16">Mission &amp; Vision <span style="font-weight:400;color:#a99b78">&mdash; enduring</span></div>
						<div style="text-align:center;color:#cdbf9f;font-size:11px">&#8595;</div>
						<div style="background:#fff;border:1px solid #efe7d6;border-radius:7px;padding:8px 10px;color:#1d1b16">Strategy <span style="font-weight:400;color:#a99b78">&mdash; directional</span></div>
						<div style="text-align:center;color:#cdbf9f;font-size:11px">&#8595;</div>
						<div style="background:#fff;border:1px solid #efe7d6;border-radius:7px;padding:8px 10px;color:#1d1b16">OKRs &amp; KPIs <span style="font-weight:400;color:#a99b78">&mdash; measurable</span></div>
					</div>
				</div>
			</div>
		</div>
	</div>
</div>`;
}

// ---- Agents: the list of background agents, and the workflow canvas for one. ----
function renderAgents(state: IScreenState): string {
	return state.agentOpen ? renderAgentCanvas(state) : renderAgentList();
}

function renderAgentList(): string {
	const openBadge = `<span style="font:400 10px/1 'JetBrains Mono',ui-monospace,monospace;color:#aeb6e0">open &#8599;</span>`;
	const row = (icon: string, name: string, trigger: string, flow: string, last: string, status: string, opts: { open?: boolean; bg?: string } = {}) => `<div ${opts.open ? 'data-msg="openAgent" ' : ''}style="display:flex;align-items:center;padding:15px 18px;border-bottom:1px solid #f1f2f5;font:400 13px/1.4 system-ui;${opts.open ? 'cursor:pointer;' : ''}${opts.bg ? 'background:' + opts.bg : ''}">
		<div style="flex:2.4;display:flex;align-items:center;gap:9px"><span style="color:${ACCENT}">${icon}</span><span style="font-weight:500">${name}</span>${opts.open ? openBadge : ''}</div>
		<div style="flex:1.4;font:400 12px/1 'JetBrains Mono',ui-monospace,monospace;color:#696e78">${trigger}</div>
		<div style="flex:2.6;font:400 12px/1.5 'JetBrains Mono',ui-monospace,monospace;color:#868b95">${flow}</div>
		<div style="flex:1.3;color:#969ba4">${last}</div>
		<div style="flex:1.4">${status}</div>
	</div>`;
	const healthy = `<span style="display:inline-flex;align-items:center;gap:6px;font:600 11px/1 system-ui;color:#1f7a44"><span style="width:7px;height:7px;border-radius:50%;background:oklch(0.6 0.13 150)"></span>Healthy</span>`;
	const idle = `<span style="display:inline-flex;align-items:center;gap:6px;font:600 11px/1 system-ui;color:#868b95"><span style="width:7px;height:7px;border-radius:50%;background:#cdd1d8"></span>Idle</span>`;
	const approval = `<span style="font:600 11px/1 system-ui;color:#9a6b16;background:#fdf2dc;border-radius:999px;padding:5px 10px">1 approval</span>`;
	const filterChip = (label: string, on: boolean, warn = false) => `<span style="font:500 12px/1 system-ui;${on ? 'color:#15181f;background:#fff;border:1px solid #e6e8ed;box-shadow:0 1px 2px rgba(0,0,0,.04);border-radius:8px;' : warn ? 'color:#9a6b16;' : 'color:#868b95;'}padding:7px 12px">${label}</span>`;
	return `<div class="screen">
	<div class="scr-head"><div><h2 class="scr-title">Agents</h2><div class="scr-sub">Documents talking to documents &mdash; running quietly in the background.</div></div><button class="btn-primary" style="margin-left:auto">&#65291; New agent</button></div>
	<div class="scr-body">
		<div style="max-width:1040px;margin:0 auto;padding:24px 28px 80px">
			<div style="display:flex;gap:6px;margin-bottom:16px">${filterChip('All &middot; 4', true)}${filterChip('Scheduled', false)}${filterChip('Triggered', false)}${filterChip('Needs approval &middot; 1', false, true)}</div>
			<div style="background:#fff;border:1px solid #e9eaee;border-radius:12px;overflow:hidden">
				<div style="display:flex;align-items:center;padding:11px 18px;background:#f8f9fb;border-bottom:1px solid #eef0f3;font:600 10px/1 'JetBrains Mono',ui-monospace,monospace;letter-spacing:.06em;color:#a3a8b2"><div style="flex:2.4">AGENT</div><div style="flex:1.4">TRIGGER</div><div style="flex:2.6">FLOW</div><div style="flex:1.3">LAST RUN</div><div style="flex:1.4">STATUS</div></div>
				${row('&#10227;', 'Weekly refresh', 'cron &middot; Mon 9:00', 'metrics.csv &#8594; Weekly Summary.md', '2m ago', approval, { open: true, bg: '#fcfdff' })}
				${row('&#8853;', 'Quote &#8594; tracker', 'folder watch', '/quotes &#8594; pipeline.csv', '9m ago', healthy)}
				${row('&#9719;', 'KPI &#8594; commentary', 'webhook', 'kpi.api &#8594; Board Note.md', '1h ago', healthy)}
				${row('&#9638;', 'SOP &#8594; policy index', 'cron &middot; daily', '/sops &#8594; Policy Index.md', 'yesterday', idle)}
			</div>
			<div style="margin-top:14px;font:400 12px/1.5 'JetBrains Mono',ui-monospace,monospace;color:#bcc0c8">Tip: open an agent to see and edit its flow on the canvas.</div>
		</div>
	</div>
</div>`;
}

function renderAgentCanvas(state: IScreenState): string {
	const ran = state.ranWf;
	const wsStroke = ran ? 'oklch(0.66 0.16 45)' : '#cdd5e2';
	const bnStroke = ran ? 'oklch(0.6 0.13 150)' : '#cdd5e2';
	const wsNodeBorder = ran ? 'oklch(0.78 0.1 70)' : '#e6e8ed';
	const runBanner = ran
		? `<div style="flex:none;display:flex;align-items:center;gap:10px;padding:11px 24px;background:#fdf6e9;border-bottom:1px solid #f0e2c4;font:500 12.5px/1.4 system-ui;color:#9a6b16"><span style="width:8px;height:8px;border-radius:50%;background:oklch(0.66 0.16 45)"></span>Run complete &middot; 3 figure updates applied &middot; 1 narrative change needs approval<button data-msg="goReview" style="margin-left:auto;border:none;background:none;font:600 12.5px/1 system-ui;color:${ACCENT_DK};cursor:pointer">Review &#8594;</button></div>`
		: '';
	const wsNodeInner = ran
		? `<button data-msg="goReview" style="margin-top:9px;width:100%;text-align:left;border:1px solid #f0e2c4;background:#fdf6e9;border-radius:7px;padding:7px 9px;font:600 11px/1.3 system-ui;color:#9a6b16;cursor:pointer">2 applied &middot; 1 to review &#8594;</button>`
		: `<div style="font:400 10.5px/1.3 'JetBrains Mono',ui-monospace,monospace;color:#a3a8b2;margin-top:7px">awaiting run</div>`;
	const bnNodeInner = ran
		? `<div style="display:inline-flex;align-items:center;gap:6px;margin-top:9px;font:600 11px/1 system-ui;color:#1f7a44;background:#e7f6ec;border-radius:999px;padding:5px 9px">&#10003; 1 figure applied</div>`
		: `<div style="font:400 10.5px/1.3 'JetBrains Mono',ui-monospace,monospace;color:#a3a8b2;margin-top:7px">awaiting run</div>`;
	const q2NodeInner = ran
		? `<div style="font:400 11px/1.3 'JetBrains Mono',ui-monospace,monospace;color:#969ba4;margin-top:9px">no change &middot; source stable</div>`
		: `<div style="font:400 10.5px/1.3 'JetBrains Mono',ui-monospace,monospace;color:#a3a8b2;margin-top:7px">awaiting run</div>`;
	const wsPulse = ran ? `<span style="margin-left:auto;width:8px;height:8px;border-radius:50%;background:oklch(0.7 0.15 150);animation:lwdPulse 1.4s infinite"></span>` : '';
	const lastRun = ran ? '' : `<span style="font:400 11.5px/1 'JetBrains Mono',ui-monospace,monospace;color:#a3a8b2">last run 2m ago</span>`;
	return `<div class="screen">
	<div style="flex:none;display:flex;align-items:center;gap:14px;padding:13px 24px;border-bottom:1px solid #eef0f3">
		<button class="btn-ghost" data-msg="closeAgent">&#8592; Agents</button>
		<div><div style="display:flex;align-items:center;gap:8px"><span style="color:${ACCENT}">&#10227;</span><h2 style="margin:0;font:600 16px/1.2 system-ui;color:#15171c">Weekly refresh</h2></div><div style="font:400 11.5px/1 'JetBrains Mono',ui-monospace,monospace;color:#a3a8b2;margin-top:4px">cron &middot; Mon 9:00 &middot; 2 sources &#8594; 3 documents</div></div>
		<div style="margin-left:auto;display:flex;align-items:center;gap:12px">${lastRun}<button data-msg="runWf" style="border:none;border-radius:8px;padding:9px 16px;background:oklch(0.55 0.14 150);color:#fff;font:600 13px/1 system-ui;cursor:pointer">&#9654; Run now</button></div>
	</div>
	${runBanner}
	<div style="flex:1;overflow:auto;background:#f8f9fb;background-image:radial-gradient(#e2e6ee 1px,transparent 1px);background-size:22px 22px">
		<div style="position:relative;width:980px;height:520px;margin:28px auto">
			<svg width="980" height="520" style="position:absolute;top:0;left:0;pointer-events:none">
				<path d="M208,120 C300,120 300,250 380,250" stroke="#cdd5e2" stroke-width="2" fill="none"></path>
				<path d="M208,330 C300,330 300,250 380,250" stroke="#cdd5e2" stroke-width="2" fill="none"></path>
				<path d="M590,250 C680,250 680,90 740,90" stroke="${wsStroke}" stroke-width="2" fill="none"></path>
				<path d="M590,250 C680,250 680,262 740,262" stroke="${bnStroke}" stroke-width="2" fill="none"></path>
				<path d="M590,250 C680,250 680,422 740,422" stroke="#cdd5e2" stroke-width="2" fill="none"></path>
				<circle cx="380" cy="250" r="3.5" fill="#cdd5e2"></circle>
				<circle cx="740" cy="90" r="3.5" fill="${wsStroke}"></circle>
				<circle cx="740" cy="262" r="3.5" fill="${bnStroke}"></circle>
				<circle cx="740" cy="422" r="3.5" fill="#cdd5e2"></circle>
			</svg>
			<div style="position:absolute;left:18px;top:160px;font:600 9px/1 'JetBrains Mono',ui-monospace,monospace;letter-spacing:.1em;color:#bcc0c8">SOURCES</div>
			<div style="position:absolute;left:20px;top:92px;width:188px;background:#fff;border:1px solid #e6e8ed;border-radius:10px;padding:12px 13px;box-shadow:0 1px 3px rgba(0,0,0,.05)"><div style="display:flex;align-items:center;gap:7px;font:600 12.5px/1 'JetBrains Mono',ui-monospace,monospace;color:#52575f"><span style="color:#5b6dc4">&#8862;</span>metrics.csv</div><div style="font:400 10.5px/1.3 'JetBrains Mono',ui-monospace,monospace;color:#a3a8b2;margin-top:6px">12 rows &middot; changed 2m ago</div></div>
			<div style="position:absolute;left:20px;top:302px;width:188px;background:#fff;border:1px solid #e6e8ed;border-radius:10px;padding:12px 13px;box-shadow:0 1px 3px rgba(0,0,0,.05)"><div style="display:flex;align-items:center;gap:7px;font:600 12.5px/1 'JetBrains Mono',ui-monospace,monospace;color:#52575f"><span style="color:#5b6dc4">&#8644;</span>crm.api</div><div style="font:400 10.5px/1.3 'JetBrains Mono',ui-monospace,monospace;color:#a3a8b2;margin-top:6px">win-rate &middot; polled hourly</div></div>
			<div style="position:absolute;left:380px;top:212px;width:210px;background:#1a1c20;border-radius:11px;padding:13px 15px;box-shadow:0 6px 18px rgba(20,30,60,.2)"><div style="display:flex;align-items:center;gap:8px;font:600 13px/1 system-ui;color:#fff"><span style="color:#9db4ff">&#10227;</span>Weekly refresh${wsPulse}</div><div style="font:400 10.5px/1.4 'JetBrains Mono',ui-monospace,monospace;color:#9aa0b4;margin-top:8px">read &middot; diff &middot; rewrite<br>policy: ask before apply</div></div>
			<div style="position:absolute;left:740px;top:160px;font:600 9px/1 'JetBrains Mono',ui-monospace,monospace;letter-spacing:.1em;color:#bcc0c8">DOCUMENTS</div>
			<div style="position:absolute;left:740px;top:58px;width:222px;background:#fff;border:1.5px solid ${wsNodeBorder};border-radius:10px;padding:12px 13px;box-shadow:0 1px 3px rgba(0,0,0,.05)"><div style="display:flex;align-items:center;gap:7px;font:600 12.5px/1 system-ui;color:#1a1c20"><span style="color:${ACCENT}">&#9635;</span>Weekly Summary.md</div>${wsNodeInner}</div>
			<div style="position:absolute;left:740px;top:230px;width:222px;background:#fff;border:1px solid #e6e8ed;border-radius:10px;padding:12px 13px;box-shadow:0 1px 3px rgba(0,0,0,.05)"><div style="display:flex;align-items:center;gap:7px;font:600 12.5px/1 system-ui;color:#1a1c20">&#9634; Board Note.md</div>${bnNodeInner}</div>
			<div style="position:absolute;left:740px;top:392px;width:222px;background:#fff;border:1px solid #e6e8ed;border-radius:10px;padding:12px 13px;box-shadow:0 1px 3px rgba(0,0,0,.05)"><div style="display:flex;align-items:center;gap:7px;font:600 12.5px/1 system-ui;color:#1a1c20">&#9634; Q2 Strategy.md</div>${q2NodeInner}</div>
		</div>
	</div>
</div>`;
}
