/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// The shared plain-language autonomy policy (spec 43 section 3.4, owner: plan 45 / PR-c; consumer: plan 49).
// Closes issue #122 F11 (the per-document autonomy dial).
//
// The contract in one paragraph: a single three-tier grammar - `auto-apply` / `ask-first` / `never` - names
// how much an automated change may do before a human sees it, and reads IDENTICALLY everywhere it appears (the
// document Properties panel and, later, the Agents screen cards). This module is the ONE source of truth for
// that grammar: `DOC_AUTONOMY_LEVELS` is the ordered option list (each carrying its plain-language label,
// one-line description and provenance tone), `defaultDocPolicy()` is the safe fallback (`ask-first` - a change
// waits for a human by default), `coerceDocPolicy` normalises any stored string (frontmatter `policy:`) back
// onto a known level, and `docPolicyToneHex` maps a level to its exact spec colour so callers never hard-code
// a hex. Consumers render the levels through the shared browser renderer (`policyEditorRender.ts`) so no
// surface ever duplicates the policy UI (principle P2). Persistence is per-document frontmatter (`policy:` in
// the doc's YAML), read/written through the frontmatter API on `livingDocMarkdown.ts`; the level string is the
// durable value, the label/tone are display-time.

/** The per-document autonomy level: how far an automated change may go before a human reviews it. */
export type DocAutonomyLevel = 'auto-apply' | 'ask-first' | 'never';

/** The provenance tone a level reads in: `ok` (green) for auto-apply, `attention` (amber) for ask-first, `removed` (red) for never. */
export type DocPolicyTone = 'ok' | 'attention' | 'removed';

/** One autonomy level's full display descriptor: its durable value, plain-language label, one-line meaning and tone. */
export interface IDocAutonomyOption {
	readonly level: DocAutonomyLevel;
	/** The plain-language label shown to the reader ("Apply automatically"). Title-style capitalisation. */
	readonly label: string;
	/** A one-line description of what the level does, in plain words (no jargon). */
	readonly description: string;
	/** The provenance tone the level reads in, driving its exact spec colour. */
	readonly tone: DocPolicyTone;
}

/**
 * The three autonomy levels in escalation order (most autonomous first), each with its plain-language grammar.
 * This is the ONE ordered list every surface renders from - the document Properties panel and the Agents cards
 * read the same labels, descriptions and tones, so the policy reads identically everywhere (spec 3.4, P2).
 */
export const DOC_AUTONOMY_LEVELS: readonly IDocAutonomyOption[] = [
	{
		level: 'auto-apply',
		label: 'Apply automatically',
		description: 'Trusted changes land on their own; you can still undo them.',
		tone: 'ok',
	},
	{
		level: 'ask-first',
		label: 'Ask me first',
		description: 'Every change waits in Review until you approve it.',
		tone: 'attention',
	},
	{
		level: 'never',
		label: 'Never change this doc',
		description: 'Agents leave this document alone entirely.',
		tone: 'removed',
	},
];

/** The safe default: a change waits for a human ("ask first") until the reader opts into more autonomy. */
export function defaultDocPolicy(): DocAutonomyLevel {
	return 'ask-first';
}

/**
 * Normalise any stored/parsed policy string back onto a known level. An absent, empty or unrecognised value
 * (an older doc with no `policy:`, a hand-edited typo) degrades to the safe default rather than throwing, so a
 * document is never left in an undefined autonomy state.
 */
export function coerceDocPolicy(raw: string | undefined): DocAutonomyLevel {
	const value = (raw ?? '').trim();
	return DOC_AUTONOMY_LEVELS.some(option => option.level === value) ? value as DocAutonomyLevel : defaultDocPolicy();
}

/** The display descriptor for a level (never undefined - an unknown level coerces to the default first). */
export function docPolicyOption(level: DocAutonomyLevel): IDocAutonomyOption {
	return DOC_AUTONOMY_LEVELS.find(option => option.level === level) ?? DOC_AUTONOMY_LEVELS[1];
}

/**
 * The exact spec colour for a policy tone (spec pin 12 / A2): `ok` green, `attention` ink `#8A6D1A`, `removed`
 * ink `#B5514B`. Callers use this instead of hard-coding a hex so the three surfaces stay pixel-identical.
 */
export function docPolicyToneHex(tone: DocPolicyTone): string {
	switch (tone) {
		case 'ok': return '#2C8159';
		case 'attention': return '#8A6D1A';
		case 'removed': return '#B5514B';
	}
}
