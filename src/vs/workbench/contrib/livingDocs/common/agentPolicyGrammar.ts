/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// The agent policy grammar bridge (spec 43 A2.2; plan 49-b). The agent registry (`agents.json`) stores ONE
// legacy per-agent policy dial - `auto-figures` / `ask-before-apply` / `draft-only` (`AgentPolicy`, spec 09
// section 4.2). The Editor v2 surfaces speak a single three-tier trust grammar everywhere - `auto-apply` /
// `ask-first` / `never` (`DocAutonomyLevel`, spec 43 section 3.4). This module is the ONE honest map between
// the two, in the DISPLAY layer only: it never rewrites the stored dial (the router still reads the legacy
// value verbatim - `agentStore`/`agentOrchestrator` semantics are unchanged). It turns one stored dial into
// the per-agent policy table the card renders, where each row is a change KIND and its tier is derived from
// what that dial actually does to that kind at run time (see `livingDocsService._runFiguresByPolicy`):
//
//   - `auto-figures`     figures land on their own; everything else waits -> figures `auto-apply`, meaning
//                        `ask-first`, structure `never` (an agent never rewrites structure).
//   - `ask-before-apply` nothing lands on its own; every change waits for approval -> figures + meaning
//                        `ask-first`, structure `never`.
//   - `draft-only`       nothing lands on its own; the agent only ever drafts -> the three-tier grammar cannot
//                        distinguish "drafts" from "waits for approval" (both are `ask-first`), so it reads the
//                        same as ask-before-apply. This is honest: the grammar has exactly three tiers and we
//                        invent no fourth display state for the draft/queue nuance (spec do-not-break section 5).
//
// The map is total and one-directional (legacy -> display); there is no display -> legacy inverse here because
// the shared policy editor's three levels do not round-trip cleanly onto the three legacy dials (auto-apply
// clearly maps to `auto-figures`, but `ask-first` and `never` both collapse onto "do not auto-apply"). The
// agent card's Edit policy therefore persists the chosen level through `coerceAgentPolicyFromLevel` below,
// which picks the closest legacy dial the router understands, and does so reversibly - the stored value is
// always one of the three known dials, never an undefined state.

import { AgentPolicy } from './livingDocsModel.js';
import { DocAutonomyLevel } from './docPolicy.js';

/** One row of an agent's display policy table: a plain-language change KIND and the tier it reads in. */
export interface IAgentPolicyRow {
	/** The plain-language action this row governs (e.g. "Update figures & dates"). A verb phrase, no jargon. */
	readonly label: string;
	/** The three-tier display level this kind resolves to under the agent's stored dial. */
	readonly level: DocAutonomyLevel;
}

/**
 * The display policy table for a stored agent dial: the three change kinds (figures, meaning, structure) each
 * resolved to their honest three-tier level. Derived from what the dial does at run time, never fabricated.
 *
 * The labels are VERB phrases, not noun phrases (comp 3a). The card that carries this table is headed
 * "WITHOUT ASKING, IT MAY", so each row has to complete that sentence: "without asking, it may update figures
 * and dates". The round-1 noun labels ("Figures & dates") left the heading dangling, which is how a reader
 * ends up unsure whether the row describes what the agent may do or merely what it looks at.
 */
export function agentPolicyTable(policy: AgentPolicy): readonly IAgentPolicyRow[] {
	const figures: DocAutonomyLevel = policy === 'auto-figures' ? 'auto-apply' : 'ask-first';
	return [
		{ label: 'Update figures & dates', level: figures },
		{ label: 'Change meaning', level: 'ask-first' },
		{ label: 'Restructure', level: 'never' },
	];
}

/**
 * The single three-tier level a whole agent reads as, for the shared policy editor's current selection (the
 * editor edits one level, not a table): the strongest thing the dial will do on its own. `auto-figures` reads
 * as `auto-apply` (it lands figures unattended); the other two read as `ask-first` (nothing lands unattended).
 * No dial reads as `never` - an agent that touches nothing would not exist in the registry.
 */
export function agentPolicyToLevel(policy: AgentPolicy): DocAutonomyLevel {
	return policy === 'auto-figures' ? 'auto-apply' : 'ask-first';
}

/**
 * Map a chosen three-tier level back onto the closest legacy dial the router understands, reversibly (the
 * result is always one of the three known `AgentPolicy` dials, never an undefined state). `auto-apply` ->
 * `auto-figures` (land figures unattended); `ask-first` -> `ask-before-apply` (wait for approval); `never` ->
 * `draft-only` (the most conservative dial - the agent only ever drafts, nothing lands). This is the write
 * path for the agent card's Edit policy; it goes through the store additively (`setAgentPolicy`), so the
 * registry file only ever carries a value the existing router already reads (semantics unchanged).
 */
export function coerceAgentPolicyFromLevel(level: DocAutonomyLevel): AgentPolicy {
	switch (level) {
		case 'auto-apply': return 'auto-figures';
		case 'ask-first': return 'ask-before-apply';
		case 'never': return 'draft-only';
	}
}
