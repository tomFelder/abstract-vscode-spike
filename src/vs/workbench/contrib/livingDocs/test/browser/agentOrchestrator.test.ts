/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { VSBuffer } from '../../../../../base/common/buffer.js';
import { URI } from '../../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { NullLogService } from '../../../../../platform/log/common/log.js';
import { IFileService } from '../../../../../platform/files/common/files.js';
import { AgentOrchestrator } from '../../browser/agentOrchestrator.js';
import { IAgentStore } from '../../browser/agentStore.js';
import { IAgentDef } from '../../common/livingDocsModel.js';

// Two documents that share metrics.csv; one also draws on market-research.md as context.
const WEEKLY = URI.file('/ws/Weekly Summary.md');
const BOARD = URI.file('/ws/Board Note.md');

const WEEKLY_MD = [
	'---', 'title: Weekly', 'sources:', '  - metrics.csv', 'context:', '  - market-research.md', '---', '',
	'## Highlights', '', 'MRR is [$48.6k](bind:metrics.mrr).',
].join('\n') + '\n';

const BOARD_MD = [
	'---', 'title: Board', 'sources:', '  - metrics.csv', '---', '',
	'## Numbers', '', 'MRR is [$48.6k](bind:metrics.mrr).',
].join('\n') + '\n';

suite('AgentOrchestrator', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();

	function createOrchestrator(opts: { agents?: IAgentDef[] } = {}): { orch: AgentOrchestrator; written: { agents?: readonly IAgentDef[] } } {
		const files = new Map<string, string>([
			[WEEKLY.toString(), WEEKLY_MD],
			[BOARD.toString(), BOARD_MD],
		]);
		const fileService = {
			readFile: async (resource: URI) => {
				const content = files.get(resource.toString());
				if (content === undefined) { throw new Error(`not found: ${resource}`); }
				return { value: VSBuffer.fromString(content) };
			},
		} as unknown as IFileService;

		const written: { agents?: readonly IAgentDef[] } = {};
		const agentStore: IAgentStore = {
			read: async () => opts.agents,
			write: async agents => { written.agents = agents; },
		};
		const orch = new AgentOrchestrator(fileService, new NullLogService(), agentStore, async () => [WEEKLY, BOARD]);
		store.add(orch);
		return { orch, written };
	}

	test('a single write to a shared source dirties every dependent document (reverse-edge walk)', async () => {
		const { orch } = createOrchestrator();

		const dirtied = await orch.propagate('/ws/metrics.csv');

		assert.deepStrictEqual(dirtied.map(u => u.toString()).sort(), [BOARD.toString(), WEEKLY.toString()].sort(), 'both docs binding metrics.csv are dirtied from one event');
		assert.deepStrictEqual(orch.getDirty(WEEKLY)!.value, ['metrics.csv'], 'recorded as a value-edge dirty bit');
	});

	test('a context-source write dirties only its influence dependents', async () => {
		const { orch } = createOrchestrator();

		const dirtied = await orch.propagate('market-research.md');

		assert.deepStrictEqual(dirtied.map(u => u.toString()), [WEEKLY.toString()], 'only the doc that lists it as context');
		assert.deepStrictEqual(orch.getDirty(WEEKLY)!.influence, ['market-research.md'], 'recorded as an influence-edge dirty bit');
	});

	test('a write to an unrelated source dirties nothing', async () => {
		const { orch } = createOrchestrator();
		assert.deepStrictEqual(await orch.propagate('/ws/unrelated.csv'), []);
	});

	test('clearDirty removes a document from the queue', async () => {
		const { orch } = createOrchestrator();
		await orch.propagate('/ws/metrics.csv');
		orch.clearDirty(WEEKLY);
		assert.deepStrictEqual({ weekly: orch.isDirty(WEEKLY), board: orch.isDirty(BOARD) }, { weekly: false, board: true });
	});

	test('the registry seeds the default automation set when none is stored', async () => {
		const { orch, written } = createOrchestrator();
		await orch.ensureLoaded();
		assert.deepStrictEqual(
			orch.getAgents().map(a => ({ id: a.id, trigger: a.trigger.kind, policy: a.policy })),
			[
				{ id: 'weekly-refresh', trigger: 'cron', policy: 'ask-before-apply' },
				{ id: 'source-watcher', trigger: 'event', policy: 'auto-figures' },
				{ id: 'freshness-sweep', trigger: 'heartbeat', policy: 'draft-only' },
				{ id: 'before-export-gate', trigger: 'lifecycle', policy: 'ask-before-apply' },
				{ id: 'on-publish-snapshot', trigger: 'lifecycle', policy: 'auto-figures' },
			],
		);
		assert.ok(written.agents && written.agents.length === 5, 'seeded registry is persisted');
	});

	test('a stored registry is used as-is (no re-seed)', async () => {
		const custom: IAgentDef[] = [{ id: 'only', name: 'Only', trigger: { kind: 'manual' }, flow: { sources: [], docs: [] }, policy: 'draft-only', status: 'idle' }];
		const { orch } = createOrchestrator({ agents: custom });
		await orch.ensureLoaded();
		assert.deepStrictEqual(orch.getAgents().map(a => a.id), ['only']);
	});
});
