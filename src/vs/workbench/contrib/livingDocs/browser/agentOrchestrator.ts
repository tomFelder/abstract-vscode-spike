/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, Event } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { URI } from '../../../../base/common/uri.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { parseLivingDoc } from '../common/livingDocMarkdown.js';
import { IAgentDef, IDirtyEntry } from '../common/livingDocsModel.js';
import { IAgentStore } from './agentStore.js';

// The orchestration engine (spec 09): the agent registry, the dependency-graph event-bus, and (in
// later items) the trigger layer, policy router, and verify gate. Owned by LivingDocsService - it is
// not a DI singleton, so it has a plain constructor.
//
// The propagation rule (spec 4.1): triggers wake the loop, the dependency graph decides what is
// affected, the review rail is where output lands. There is no doc-to-doc wiring: a write to any node
// emits a single event, and the orchestrator walks the graph's reverse edges to mark dependents dirty.

// The default automation set (spec 7) seeded when no registry exists yet.
function defaultAgents(): IAgentDef[] {
	return [
		{ id: 'weekly-refresh', name: 'Weekly refresh', trigger: { kind: 'cron', cron: 'Mon 09:00' }, flow: { sources: [], docs: [] }, policy: 'ask-before-apply', status: 'idle' },
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
	// The workspace-wide dirty queue: doc URI -> changed dependency paths, split by edge kind. The
	// Freshness-sweep heartbeat (Item 2) drains this.
	private readonly _dirty = new Map<string, IDirtyEntry>();

	constructor(
		private readonly _files: IFileService,
		private readonly _log: ILogService,
		private readonly _agentStore: IAgentStore,
		private readonly _provideDocUris: () => Promise<URI[]>,
	) {
		super();
	}

	// --- agent registry ---

	async ensureLoaded(): Promise<void> {
		if (this._loaded) { return; }
		this._loaded = true;
		const stored = await this._agentStore.read();
		if (stored && stored.length) {
			this._agents = stored;
		} else {
			this._agents = defaultAgents();
			await this._persistAgents();
		}
		this._onDidChange.fire();
	}

	getAgents(): readonly IAgentDef[] { return this._agents; }
	getAgent(id: string): IAgentDef | undefined { return this._agents.find(a => a.id === id); }

	private async _persistAgents(): Promise<void> {
		try {
			await this._agentStore.write(this._agents);
		} catch (e) {
			this._log.warn('[livingDocs] agents write failed', e instanceof Error ? e.message : String(e));
		}
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

	// --- the dirty queue (drained by the heartbeat in Item 2) ---

	getDirty(resource: URI): IDirtyEntry | undefined { return this._dirty.get(resource.toString()); }
	getDirtyDocs(): URI[] { return [...this._dirty.keys()].map(s => URI.parse(s)); }
	isDirty(resource: URI): boolean { return this._dirty.has(resource.toString()); }
	clearDirty(resource: URI): void {
		if (this._dirty.delete(resource.toString())) { this._onDidChange.fire(); }
	}
}
