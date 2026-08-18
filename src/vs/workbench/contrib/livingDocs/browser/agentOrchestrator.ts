/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../../base/common/cancellation.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { Disposable, MutableDisposable } from '../../../../base/common/lifecycle.js';
import { URI } from '../../../../base/common/uri.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { parseLivingDoc } from '../common/livingDocMarkdown.js';
import { AGENT_RUN_CAP, AgentTriggerKind, IAgentDef, IAgentRun, IAgentTrigger, IDirtyEntry } from '../common/livingDocsModel.js';
import { IAgentRegistry, IAgentStore } from './agentStore.js';
import { IClock, RealClock } from './clock.js';

// How the orchestrator runs an agent once a trigger fires: the host (the service) supplies the actual
// work (re-derive figures, impact-pass, draft) given the agent + the documents in scope, and reports
// what landed/queued so the orchestrator can set status and record the run.
export interface IAgentRunContext {
	readonly trigger: AgentTriggerKind;
	readonly docs: readonly URI[];
	// The per-run cancellation token (plan 27 iter 4): the runner checks it between documents so a Stop
	// leaves the remaining documents unprocessed (reported as `skipped`) rather than running to completion.
	readonly token?: CancellationToken;
}
export interface IAgentRunResult {
	readonly applied: number;
	readonly queued: number;
	readonly blocked?: string;
	// Documents the run did not process because it was cancelled mid-flight (plan 27 iter 4).
	readonly skipped?: number;
	// Documents the run actually processed (the run-log "N docs" outcome count, plan 32 iter 2). Optional so
	// an event/lifecycle runner that touches none can omit it (defaults to the docs handed to the run).
	readonly docsTouched?: number;
}
export type AgentRunner = (agent: IAgentDef, context: IAgentRunContext) => Promise<IAgentRunResult>;

// Map a weekday abbreviation to its UTC day index (cron is interpreted in UTC for test determinism).
const WEEKDAYS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
const TICK_MS = 60_000;

// The orchestration engine (spec 09): the agent registry, the dependency-graph event-bus, and (in
// later items) the trigger layer, policy router, and verify gate. Owned by LivingDocsService - it is
// not a DI singleton, so it has a plain constructor.
//
// The propagation rule (spec 4.1): triggers wake the loop, the dependency graph decides what is
// affected, the review rail is where output lands. There is no doc-to-doc wiring: a write to any node
// emits a single event, and the orchestrator walks the graph's reverse edges to mark dependents dirty.

// The default automation set (spec 7), held in memory when a workspace has no registry yet. It is NOT
// written out on load - `agents.json` appears only once the user's first real edit or run persists it.
function defaultAgents(): IAgentDef[] {
	return [
		{ id: 'weekly-refresh', name: 'Weekly refresh', trigger: { kind: 'cron', cron: 'Mon 09:00' }, flow: { sources: [], docs: [] }, policy: 'auto-figures', status: 'idle' },
		{ id: 'source-watcher', name: 'Source-change watcher', trigger: { kind: 'event', source: '*' }, flow: { sources: [], docs: [] }, policy: 'auto-figures', status: 'idle' },
		{ id: 'freshness-sweep', name: 'Freshness sweep', trigger: { kind: 'heartbeat', everyHours: 6 }, flow: { sources: [], docs: [] }, policy: 'draft-only', status: 'idle' },
		{ id: 'before-export-gate', name: 'Before-export gate', trigger: { kind: 'lifecycle', lifecycle: 'before-export' }, flow: { sources: [], docs: [] }, policy: 'ask-before-apply', status: 'idle' },
		{ id: 'on-publish-snapshot', name: 'On-publish snapshot', trigger: { kind: 'lifecycle', lifecycle: 'on-publish' }, flow: { sources: [], docs: [] }, policy: 'auto-figures', status: 'idle' },
	];
}

// The final path segment, used as the dependency-graph key so a watcher event (full URI) matches a
// document's relative `sources:` / `context:` entry.
function pathKey(path: string): string {
	return path.split('/').pop() ?? path;
}

interface IReverseEdges {
	readonly value: URI[];       // docs that bind this source (value edges)
	readonly influence: URI[];   // docs that draw on this source as context (influence edges)
}

export class AgentOrchestrator extends Disposable {

	private readonly _onDidChange = this._register(new Emitter<void>());
	readonly onDidChange: Event<void> = this._onDidChange.event;

	private _agents: IAgentDef[] = [];
	private _loaded = false;
	// The in-flight load, so concurrent `ensureLoaded` callers await the SAME read instead of the first one
	// winning a `_loaded` flag it has not earned yet and the rest running against an empty registry.
	private _loading: Promise<void> | undefined;
	// The workspace-wide dirty queue: doc URI -> changed dependency paths, split by edge kind. The
	// Freshness-sweep heartbeat drains this.
	private readonly _dirty = new Map<string, IDirtyEntry>();
	private _runner: AgentRunner | undefined;
	private readonly _ticker = this._register(new MutableDisposable());
	// The capped run log (D32-A, decision 150), newest-last in memory and persisted to `agents.json`. The
	// Agents screen renders it newest-first; the last run per agent is derived from it.
	private _runs: IAgentRun[] = [];
	// Agents whose run is currently in flight (overlap guard, spec 09 section 3, plan 32 iter 2): a due agent whose
	// previous run has not finished is skipped with a recorded "still running" run rather than stacking.
	// Ref-counted per agentId (finding 2): a manual run bypasses the guard but still counts as in-flight, so
	// when a manual + scheduled run overlap the marker must clear only when the LAST of them finishes - a
	// plain Set would clear on the first `finally` and let a scheduled trigger in that window stack.
	private readonly _inFlight = new Map<string, number>();

	constructor(
		private readonly _files: IFileService,
		private readonly _log: ILogService,
		private readonly _agentStore: IAgentStore,
		private readonly _provideDocUris: () => Promise<URI[]>,
		private readonly _clock: IClock = new RealClock(),
	) {
		super();
	}

	// The host (the service) registers how an agent actually does its work. Kept as a setter so the
	// service can wire it after construction without a circular dependency.
	setRunner(runner: AgentRunner): void { this._runner = runner; }

	// --- agent registry ---

	/**
	 * Load the registry from the store, once. Reading is SIDE-EFFECT FREE: merely opening a workspace must
	 * never touch `agents.json` (issue: the sample workspace's committed registry was reshaped on every
	 * launch, and any folder opened without a registry had one created for it unasked). A workspace with no
	 * registry yet gets the default automation set IN MEMORY only; the file is written the first time
	 * something real happens to it - an edit through the drawer, or a run (see `_persistAgents` callers).
	 *
	 * A store read that FAILS (as opposed to finding no registry) leaves the orchestrator unloaded, so the
	 * next caller retries. That matters because the file-system provider for the open folder can register
	 * after this service constructs (see livingDocsService.ts, the provider-registration retry): treating
	 * that transient failure as "no registry yet" used to overwrite a real registry with the defaults.
	 */
	async ensureLoaded(): Promise<void> {
		if (this._loaded) { return; }
		if (!this._loading) {
			this._loading = this._load().finally(() => { this._loading = undefined; });
		}
		await this._loading;
	}

	private async _load(): Promise<void> {
		let stored: IAgentRegistry | undefined;
		try {
			stored = await this._agentStore.read();
		} catch (e) {
			// Unreadable right now (no provider yet, transient I/O, corrupt file): show the defaults so the
			// Agents screen is not blank, but stay UNLOADED so a later call re-reads - and write nothing.
			this._log.warn('[livingDocs] agents read failed', e instanceof Error ? e.message : String(e));
			this._agents = defaultAgents();
			this._onDidChange.fire();
			return;
		}
		this._loaded = true;
		if (stored && stored.agents.length) {
			this._agents = stored.agents;
			this._runs = stored.runs.slice(-AGENT_RUN_CAP);
		} else {
			this._agents = defaultAgents();
		}
		this._onDidChange.fire();
	}

	getAgents(): readonly IAgentDef[] { return this._agents; }
	getAgent(id: string): IAgentDef | undefined { return this._agents.find(a => a.id === id); }

	// The persisted run log (D32-A), newest-first for the Agents screen. `runsForAgent` filters to one agent.
	getRuns(): readonly IAgentRun[] { return [...this._runs].reverse(); }
	getRunsForAgent(agentId: string): readonly IAgentRun[] { return this.getRuns().filter(r => r.agentId === agentId); }

	// --- registry editing (plan 32 iter 3): create / duplicate / pause / inline policy + trigger edits ---
	// The Agents-screen detail drawer edits the registry through these; each persists and fires onDidChange
	// so the screen re-renders. `agents.json` is the store (decision 150), so every edit survives a reload.

	// Create a new agent from a partial def (the drawer's "New agent" affordance). Fills a unique id + sane
	// defaults, appends it, persists and returns the created def. Editing/pause happen through the setters below.
	async createAgent(partial?: Partial<Pick<IAgentDef, 'name' | 'trigger' | 'flow' | 'policy'>>): Promise<IAgentDef> {
		await this.ensureLoaded();
		const id = this._uniqueId((partial?.name ?? 'agent'));
		const agent: IAgentDef = {
			id,
			name: partial?.name ?? 'New agent',
			trigger: partial?.trigger ?? { kind: 'manual' },
			flow: partial?.flow ?? { sources: [], docs: [] },
			policy: partial?.policy ?? 'draft-only',
			status: 'idle',
		};
		this._agents.push(agent);
		await this._persistAgents();
		this._onDidChange.fire();
		return agent;
	}

	// Duplicate an existing agent (the drawer's Duplicate action): a fresh id, a "(copy)" name, the same
	// trigger/flow/policy, no run history of its own (runs are keyed by agentId), starting idle + enabled.
	async duplicateAgent(agentId: string): Promise<IAgentDef | undefined> {
		await this.ensureLoaded();
		const source = this.getAgent(agentId);
		if (!source) { return undefined; }
		return this.createAgent({
			name: `${source.name} (copy)`,
			trigger: { ...source.trigger },
			flow: { sources: [...source.flow.sources], docs: [...source.flow.docs] },
			policy: source.policy,
		});
	}

	// Pause / resume an agent (the drawer's Pause toggle): sets/clears the `disabled` flag the scheduler
	// respects. Only ever writes `disabled:true` or deletes it, so an older registry with no flag stays enabled.
	async setAgentDisabled(agentId: string, disabled: boolean): Promise<void> {
		await this.ensureLoaded();
		const agent = this.getAgent(agentId);
		if (!agent) { return; }
		if (disabled) { agent.disabled = true; } else { delete agent.disabled; }
		await this._persistAgents();
		this._onDidChange.fire();
	}

	// Inline policy edit (the drawer's three-level select). Guards against an invalid value so a stray
	// message can never write a policy the router does not understand.
	async setAgentPolicy(agentId: string, policy: IAgentDef['policy']): Promise<void> {
		await this.ensureLoaded();
		const agent = this.getAgent(agentId);
		if (!agent || (policy !== 'auto-figures' && policy !== 'ask-before-apply' && policy !== 'draft-only')) { return; }
		agent.policy = policy;
		await this._persistAgents();
		this._onDidChange.fire();
	}

	// Inline trigger edit (the drawer's cron day/time picker or heartbeat-hours field). Replaces the whole
	// trigger; the caller composes it from the picker fields, so this just validates the shape minimally.
	async setAgentTrigger(agentId: string, trigger: IAgentTrigger): Promise<void> {
		await this.ensureLoaded();
		const agent = this.getAgent(agentId);
		if (!agent || !trigger || !trigger.kind) { return; }
		agent.trigger = trigger;
		await this._persistAgents();
		this._onDidChange.fire();
	}

	// A registry-unique agent id derived from a name: a slug plus a numeric suffix when the slug collides.
	private _uniqueId(name: string): string {
		const slug = (name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'agent');
		if (!this._agents.some(a => a.id === slug)) { return slug; }
		let n = 2;
		while (this._agents.some(a => a.id === `${slug}-${n}`)) { n++; }
		return `${slug}-${n}`;
	}

	// The most recent run of ANY agent that failed and is still the latest for that agent (plan 32 iter 2):
	// the Home attention line. Truthful - undefined when the newest run of every agent succeeded or skipped.
	getLatestFailure(): IAgentRun | undefined {
		const latestByAgent = new Map<string, IAgentRun>();
		for (const run of this._runs) { latestByAgent.set(run.agentId, run); } // in-memory is oldest-first, so last wins
		for (const run of [...latestByAgent.values()].sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt))) {
			if (run.error) { return run; }
		}
		return undefined;
	}

	// Write the registry. Only ever called for a real state change (an edit through the drawer, a recorded
	// run) - never from the load path, so opening a workspace leaves `agents.json` exactly as it was.
	private async _persistAgents(): Promise<void> {
		if (!this._loaded) {
			// We never managed to read the registry, so we do not know what is on disk: writing here would
			// replace someone's real registry with this session's defaults. Keep the change in memory instead.
			this._log.warn('[livingDocs] agents write skipped - the registry was never loaded');
			return;
		}
		try {
			await this._agentStore.write({ agents: this._agents, runs: this._runs });
		} catch (e) {
			this._log.warn('[livingDocs] agents write failed', e instanceof Error ? e.message : String(e));
		}
	}

	// Append a run to the capped log (oldest-eviction) and persist. Used for both executed and skipped runs.
	private _recordRun(run: IAgentRun): void {
		this._runs.push(run);
		if (this._runs.length > AGENT_RUN_CAP) { this._runs = this._runs.slice(-AGENT_RUN_CAP); }
	}

	// --- the dependency-graph event-bus (spec 4.1) ---

	// Build the reverse edges of the workspace dependency graph: source/context path -> dependent docs.
	// Keyed by final path segment so a watcher's full URI matches a doc's relative declaration.
	private async _buildReverseEdges(): Promise<Map<string, IReverseEdges>> {
		const graph = new Map<string, IReverseEdges>();
		const ensure = (key: string): IReverseEdges => {
			let edges = graph.get(key);
			if (!edges) { edges = { value: [], influence: [] }; graph.set(key, edges); }
			return edges;
		};
		for (const uri of await this._provideDocUris()) {
			let sources: readonly string[];
			let context: readonly string[];
			try {
				const doc = parseLivingDoc((await this._files.readFile(uri)).value.toString());
				if (!doc.isLiving) { continue; }
				sources = doc.sources;
				context = doc.context;
			} catch (e) {
				this._log.trace('[livingDocs] graph parse skipped', e instanceof Error ? e.message : String(e));
				continue;
			}
			for (const s of sources) { ensure(pathKey(s)).value.push(uri); }
			for (const c of context) { ensure(pathKey(c)).influence.push(uri); }
		}
		return graph;
	}

	/**
	 * The propagation rule: a single write to `changedPath` walks the graph's reverse edges and marks
	 * every dependent document dirty (value bindings vs influence context distinguished by edge kind).
	 * Returns the dirtied document URIs. No prose is touched - this is the cheap, workspace-wide hook.
	 */
	async propagate(changedPath: string): Promise<URI[]> {
		const key = pathKey(changedPath);
		const edges = (await this._buildReverseEdges()).get(key);
		if (!edges) { return []; }
		const dirtied: URI[] = [];
		const mark = (uri: URI, kind: 'value' | 'influence') => {
			const id = uri.toString();
			const prior = this._dirty.get(id) ?? { value: [], influence: [] };
			const next: IDirtyEntry = { value: [...prior.value], influence: [...prior.influence] };
			if (!next[kind].includes(key)) { next[kind].push(key); }
			this._dirty.set(id, next);
			if (!dirtied.some(u => u.toString() === id)) { dirtied.push(uri); }
		};
		for (const uri of edges.value) { mark(uri, 'value'); }
		for (const uri of edges.influence) { mark(uri, 'influence'); }
		if (dirtied.length) { this._onDidChange.fire(); }
		return dirtied;
	}

	/**
	 * The documents that bind `source` as a VALUE source (plan 30, track 1): a reverse-edge lookup used by
	 * the scoped refresh to fan out to the co-dependents of a changed source (a CSV shared by many reports).
	 * Matched by final path segment, like the rest of the graph, so a relative `sources:` entry resolves.
	 */
	async docsBoundToSource(source: string): Promise<URI[]> {
		const edges = (await this._buildReverseEdges()).get(pathKey(source));
		return edges ? [...edges.value] : [];
	}

	// --- the trigger layer (spec 3): event + scheduled (cron/heartbeat) + manual ---

	// Start the scheduler: a single periodic tick checks which cron/heartbeat agents are due. Idempotent.
	start(): void {
		this._ticker.value = this._clock.scheduleInterval(TICK_MS, () => void this.runDueAgents());
	}

	// Fire every cron/heartbeat agent that is due at the clock's current time. Public + awaitable so a
	// fake clock can drive it deterministically in tests.
	async runDueAgents(): Promise<void> {
		await this.ensureLoaded();
		for (const agent of this._agents) {
			// A paused agent stays scheduled-in-name but the scheduler skips it (plan 32 iter 3): a due cron/
			// heartbeat tick never fires while `disabled` is set. Manual "Run now" bypasses this (see runAgent).
			if (agent.disabled) { continue; }
			if (agent.trigger.kind === 'cron' && this._cronDue(agent)) {
				await this.runAgent(agent.id, 'cron', await this._provideDocUris());
			} else if (agent.trigger.kind === 'heartbeat' && this._heartbeatDue(agent)) {
				await this.runHeartbeat(agent.id);
			}
		}
	}

	// Cron "Mon 09:00" is due when now (UTC) matches its weekday + time and it has not already fired
	// within this minute.
	private _cronDue(agent: IAgentDef): boolean {
		const match = /^(\w{3})\s+(\d{2}):(\d{2})$/.exec(agent.trigger.cron ?? '');
		if (!match) { return false; }
		const day = WEEKDAYS[match[1]];
		const now = this._clock.now();
		const d = new Date(now);
		if (day === undefined || d.getUTCDay() !== day || d.getUTCHours() !== Number(match[2]) || d.getUTCMinutes() !== Number(match[3])) {
			return false;
		}
		return !agent.lastRun || now - Date.parse(agent.lastRun) >= TICK_MS;
	}

	private _heartbeatDue(agent: IAgentDef): boolean {
		const everyMs = (agent.trigger.everyHours ?? 6) * 3_600_000;
		const last = agent.lastRun ? Date.parse(agent.lastRun) : 0;
		return this._clock.now() - last >= everyMs;
	}

	// A source/folder change (from a correlated watcher): walk the graph (cheap dirty flagging) and fire
	// any event-triggered agent whose source matches ('*' = any).
	async onSourceChanged(changedPath: string): Promise<void> {
		await this.ensureLoaded();
		const dirtied = await this.propagate(changedPath);
		for (const agent of this._agents) {
			if (agent.disabled) { continue; } // a paused event agent does not fire on a source change (plan 32 iter 3)
			const source = agent.trigger.source;
			if (agent.trigger.kind === 'event' && (source === '*' || (source && pathKey(source) === pathKey(changedPath)))) {
				await this.runAgent(agent.id, 'event', dirtied);
			}
		}
	}

	// The heartbeat drains the dirty queue: it only ever processes flagged docs, and is a no-op when the
	// queue is empty (it does NOT re-derive everything - spec 3).
	async runHeartbeat(agentId: string): Promise<void> {
		const docs = this.getDirtyDocs();
		if (!docs.length) { return; }
		await this.runAgent(agentId, 'heartbeat', docs);
	}

	getLastRun(agentId: string): IAgentRun | undefined {
		const runs = this._runs;
		for (let i = runs.length - 1; i >= 0; i--) { if (runs[i].agentId === agentId) { return runs[i]; } }
		return undefined;
	}

	// Run one agent end-to-end via the host runner (also the manual "Run now" path). Sets status from
	// the result (blocked / needs-approval / idle) and records the run for the Agents view + History.
	//
	// Overlap guard (spec 09 section 3, plan 32 iter 2): a scheduled/event trigger for an agent whose previous run is
	// still in flight is NOT stacked - it records a "skipped (still running)" run and returns. A manual "Run
	// now" is always honoured (the user explicitly asked). Runs therefore never queue up behind a slow run.
	async runAgent(agentId: string, trigger: AgentTriggerKind, docs: readonly URI[], token: CancellationToken = CancellationToken.None): Promise<IAgentRun | undefined> {
		const agent = this.getAgent(agentId);
		if (!agent || !this._runner) { return undefined; }
		if (this._inFlight.has(agentId) && trigger !== 'manual') {
			const at = new Date(this._clock.now()).toISOString();
			const skipped: IAgentRun = { agentId, startedAt: at, finishedAt: at, applied: 0, queued: 0, via: trigger, docsTouched: 0, skippedReason: 'still-running' };
			this._recordRun(skipped);
			await this._persistAgents();
			this._onDidChange.fire();
			return skipped;
		}
		this._inFlight.set(agentId, (this._inFlight.get(agentId) ?? 0) + 1);
		const startedAt = new Date(this._clock.now()).toISOString();
		agent.status = 'running';
		this._onDidChange.fire();
		const run: IAgentRun = { agentId, startedAt, applied: 0, queued: 0, via: trigger };
		try {
			const result = await this._runner(agent, { trigger, docs, token });
			run.applied = result.applied;
			run.queued = result.queued;
			run.blocked = result.blocked;
			run.docsTouched = result.docsTouched ?? docs.length;
			agent.status = result.blocked ? 'blocked' : result.queued > 0 ? 'needs-approval' : 'idle';
		} catch (e) {
			agent.status = 'error';
			run.failed = 1;
			run.error = e instanceof Error ? e.message : String(e);
			this._log.warn('[livingDocs] agent run failed', agentId, run.error);
		} finally {
			// Decrement the ref-count; only the LAST in-flight run for this agent clears the marker (finding 2),
			// so a scheduled trigger while any run (manual or scheduled) is still going records a still-running skip.
			const remaining = (this._inFlight.get(agentId) ?? 1) - 1;
			if (remaining > 0) { this._inFlight.set(agentId, remaining); } else { this._inFlight.delete(agentId); }
		}
		run.finishedAt = new Date(this._clock.now()).toISOString();
		agent.lastRun = run.finishedAt;
		this._recordRun(run);
		await this._persistAgents();
		this._onDidChange.fire();
		return run;
	}

	// --- the dirty queue (drained by the heartbeat) ---

	getDirty(resource: URI): IDirtyEntry | undefined { return this._dirty.get(resource.toString()); }
	getDirtyDocs(): URI[] { return [...this._dirty.keys()].map(s => URI.parse(s)); }
	isDirty(resource: URI): boolean { return this._dirty.has(resource.toString()); }
	clearDirty(resource: URI): void {
		if (this._dirty.delete(resource.toString())) { this._onDidChange.fire(); }
	}

	/**
	 * Clear only the dirty keys a run actually processed (plan 32 iter 2 fix, finding 1): the caller
	 * snapshots the doc's dirty entry at the moment it starts processing it and passes that snapshot back
	 * here. Any key added AFTER the snapshot - a concurrent source event that interleaved during the run's
	 * awaited work - is NOT in the snapshot, so it survives for the heartbeat to drain. Only when the entry
	 * has no remaining keys is it removed. A blanket `clearDirty` would delete the freshly-added bit and the
	 * second change would be missed until a later edit.
	 */
	clearDirtyKeys(resource: URI, snapshot: IDirtyEntry): void {
		const id = resource.toString();
		const current = this._dirty.get(id);
		if (!current) { return; }
		const value = current.value.filter(k => !snapshot.value.includes(k));
		const influence = current.influence.filter(k => !snapshot.influence.includes(k));
		if (value.length || influence.length) {
			this._dirty.set(id, { value, influence });
		} else {
			this._dirty.delete(id);
		}
		this._onDidChange.fire();
	}
}
