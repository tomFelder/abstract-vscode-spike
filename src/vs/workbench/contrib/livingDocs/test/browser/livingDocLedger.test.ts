/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { buildActivityLedger, ILedgerAuditInput, ILedgerRunInput, ILedgerWaitingInput, LEDGER_CAP } from '../../common/livingDocLedger.js';
import { IAgentRun, IAuditEntry, IProposedChange } from '../../common/livingDocsModel.js';

// The Agents activity ledger's read model (plan 49-c A3): a pure fold of the real event streams (orchestrator
// runs + per-document lock audits) plus the live pending set. It NEVER mutates its inputs (read-only), maps
// each event to exactly one of the three tiers (waiting / applied / admin - no fourth invented), orders
// newest-first, bounds the list, and degrades a doc link to a bare title when the addressed block is gone.
// This module is DOM-free, so it is unit-tested here without the render layer.
suite('livingDocs activity ledger read model (livingDocLedger)', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	function run(over: Partial<IAgentRun>): IAgentRun {
		return { agentId: 'a1', startedAt: '2026-07-06T09:00:00.000Z', finishedAt: '2026-07-06T09:00:05.000Z', applied: 0, queued: 0, ...over };
	}
	function runInput(agentName: string, over: Partial<IAgentRun>): ILedgerRunInput {
		return { agentName, run: run(over) };
	}
	function audit(over: Partial<IAuditEntry>): IAuditEntry {
		return { time: '2026-07-06T08:00:00.000Z', docTitle: 'Weekly Summary', blockId: 'b-6', action: 'auto-applied', oldText: 'a', newText: 'b', via: 'heuristic', ...over };
	}
	function auditInput(over: Partial<ILedgerAuditInput>): ILedgerAuditInput {
		return { docId: 'file:///ws/weekly.md', docTitle: 'Weekly Summary', entries: [], blockIds: ['b-1', 'b-2', 'b-3', 'b-4', 'b-5', 'b-6'], ...over };
	}
	function change(over: Partial<IProposedChange>): IProposedChange {
		return { id: 'c1', docId: 'file:///ws/weekly.md', docTitle: 'Weekly Summary', blockId: 'b-6', blockLabel: 'Commentary', oldText: 'x', newText: 'y', kind: 'meaning', confidence: 0.9, rationale: 'r', sourceCells: [], ...over };
	}
	function waitingInput(over: { readonly change?: Partial<IProposedChange>; readonly blockLine?: number }): ILedgerWaitingInput {
		return { change: change(over.change ?? {}), blockLine: over.blockLine };
	}

	test('folds every real event stream into the three tiers, orders newest-first, addresses docs by line', () => {
		const ledger = buildActivityLedger({
			runs: [
				runInput('Reporting agent', { queued: 1, applied: 0, finishedAt: '2026-07-06T09:41:00.000Z' }),
				runInput('Reporting agent', { applied: 4, queued: 0, finishedAt: '2026-07-06T09:40:00.000Z' }),
			],
			audits: [auditInput({
				entries: [
					audit({ action: 'approved', via: 'model', blockId: 'b-3', time: '2026-07-06T08:15:00.000Z' }),
					audit({ action: 'auto-applied', via: 'heuristic', blockId: 'b-6', time: '2026-07-06T08:00:00.000Z' }),
				]
			})],
			waiting: [waitingInput({ change: { blockId: 'b-6' }, blockLine: 6 })],
		}, 'Tom');
		// A snapshot of the whole shape: the WAITING row leads (live call), then dated rows newest-first; each
		// row's tier, badge, doc-link label ("Weekly Summary · line N") and deep-link intent are all real.
		assert.deepStrictEqual(ledger, {
			truncated: false,
			entries: [
				{ at: 0, kind: 'waiting', lead: 'A meaning change is waiting on your call in ', doc: { label: 'Weekly Summary · line 6', docId: 'file:///ws/weekly.md', blockId: 'b-6' }, tail: '', badge: 'WAITING', deepLink: true },
				{ at: Date.parse('2026-07-06T09:41:00.000Z'), kind: 'waiting', lead: 'Reporting agent proposed 1 change for your review', tail: '', badge: 'WAITING', deepLink: false },
				{ at: Date.parse('2026-07-06T09:40:00.000Z'), kind: 'applied', lead: 'Reporting agent refreshed 4 bound figures', tail: '', badge: 'auto-applied · reversible', deepLink: false },
				{ at: Date.parse('2026-07-06T08:15:00.000Z'), kind: 'applied', lead: 'Approved a change in ', doc: { label: 'Weekly Summary · line 3', docId: 'file:///ws/weekly.md', blockId: undefined }, tail: '', badge: 'by Tom', deepLink: false },
				{ at: Date.parse('2026-07-06T08:00:00.000Z'), kind: 'applied', lead: 'Auto-applied a change in ', doc: { label: 'Weekly Summary · line 6', docId: 'file:///ws/weekly.md', blockId: undefined }, tail: '', badge: 'auto-applied · reversible', deepLink: false },
			],
		});
	});

	test('a deleted block degrades the doc link to the bare title (no stale line number, never throws)', () => {
		const ledger = buildActivityLedger({
			runs: [],
			// The audit references a block id no longer in the document's current block order.
			audits: [auditInput({ blockIds: ['b-1', 'b-2'], entries: [audit({ action: 'approved', via: 'model', blockId: 'gone' })] })],
			waiting: [],
		}, 'Tom');
		assert.deepStrictEqual(ledger.entries[0].doc, { label: 'Weekly Summary', docId: 'file:///ws/weekly.md', blockId: undefined }, 'gone block => bare title, no "· line N"');
	});

	test('bounds to the cap with an honest truncation flag; a skipped run is not a row', () => {
		const runs: ILedgerRunInput[] = [];
		// LEDGER_CAP + 5 real applied runs, each at a distinct earlier time, plus one overlap-skipped run that
		// must NOT surface (it never executed).
		for (let i = 0; i < LEDGER_CAP + 5; i++) {
			const min = String(i % 60).padStart(2, '0');
			const hr = String(i % 24).padStart(2, '0');
			runs.push(runInput('Reporting agent', { applied: 1, finishedAt: `2026-07-0${(i % 9) + 1}T${hr}:${min}:00.000Z` }));
		}
		runs.push(runInput('Meeting agent', { skippedReason: 'still-running', applied: 0, queued: 0 }));
		const ledger = buildActivityLedger({ runs, audits: [], waiting: [] }, 'Tom');
		assert.deepStrictEqual(
			{ count: ledger.entries.length, truncated: ledger.truncated, anySkipped: ledger.entries.some(e => e.lead.includes('Meeting agent')) },
			{ count: LEDGER_CAP, truncated: true, anySkipped: false },
		);
	});

	test('an error run and a paused/rejected admin event map to the grey admin tier, never waiting/applied', () => {
		const ledger = buildActivityLedger({
			runs: [runInput('Reporting agent', { error: 'source unreachable', applied: 0, queued: 0 })],
			audits: [auditInput({ entries: [audit({ action: 'rejected', via: 'model' })] })],
			waiting: [],
		}, 'Tom');
		assert.deepStrictEqual(ledger.entries.map(e => e.kind), ['admin', 'admin'], 'both are administrative, grey');
	});

	test('I1: an approval that could not be applied is an admin row saying so, never an applied "Approved a change"', () => {
		// docs/30 I1, issue #329. The audit fold ends in a fall-through that reads any unhandled action as
		// "Approved a change in", so a new failure action that is not caught explicitly does not merely go
		// unrendered - it renders as the exact false claim the invariant exists to stop.
		const ledger = buildActivityLedger({
			runs: [],
			audits: [auditInput({ entries: [audit({ action: 'apply-failed', via: 'model', reason: 'the text it was written for has changed since it was proposed' })] })],
			waiting: [],
		}, 'Tom');
		assert.deepStrictEqual(
			ledger.entries.map(e => ({ kind: e.kind, lead: e.lead, badge: e.badge })),
			[{ kind: 'admin', lead: 'A change could not be applied to ', badge: 'not applied' }],
		);
	});
});
