/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// The earned-upgrade rule (plan 42 slice L3: "markdown-first, 'living' is earned"). Plain Markdown is the
// default citizen on the entry path: a new `.md` carries no lock, no provenance machinery, and no
// Living-Document vocabulary before the user meets an agent. A document upgrades to living -- silently, at
// that moment -- only when the first source is bound (a frontmatter `sources:`/`context:` entry or a bind
// link) or the first agent edit is accepted (which writes the sibling lock). This module is the PURE,
// service-free statement of "has this document earned living?" and "does this project have anything living
// to speak of yet?", so the rule is unit-tested directly and every entry-path surface that decides whether
// to show living vocabulary reads from ONE place instead of re-deriving it inline. No DOM, no service, no I/O.

/**
 * The facts a single document exposes about whether it has crossed into "living". Mirrors the model's
 * `isLiving` derivation (`common/livingDocMarkdown.ts`: sources/context/binds) and adds the service-only
 * signal the model cannot see: a sibling `<doc>.lock.json` on disk (the mark an accepted agent edit or an
 * import leaves). Kept as plain facts so callers -- parser output, service state, or a summary -- can each
 * supply them without this module reaching for a document instance.
 */
export interface ILivingUpgradeFacts {
	/** Frontmatter `sources:` declares one or more value-binding sources. */
	readonly hasFrontmatterSources: boolean;
	/** Frontmatter `context:` declares one or more influence sources. */
	readonly hasFrontmatterContext: boolean;
	/** The body carries at least one inline bind link. */
	readonly hasBindLinks: boolean;
	/** A sibling `<doc>.lock.json` exists on disk (an accepted agent edit / import wrote it). */
	readonly hasSiblingLock: boolean;
}

/**
 * Has this document EARNED living status? True when a source is bound (frontmatter sources/context or a bind
 * link) or when a sibling lock exists (the first accepted agent edit / an import wrote it). A plain `.md`
 * the user merely opened, typed into, and saved has none of these, so it stays plain -- no lock is owed and
 * no living vocabulary is shown. This is the single predicate the entry path consults; keeping the two
 * upgrade triggers named together here is what makes "living is earned" explicit rather than implied.
 */
export function docHasEarnedLiving(facts: ILivingUpgradeFacts): boolean {
	return facts.hasFrontmatterSources || facts.hasFrontmatterContext || facts.hasBindLinks || facts.hasSiblingLock;
}

/**
 * Does the PROJECT have any living surface yet -- i.e. is there anything for a "sources synced" status to
 * honestly describe? True when at least one discovered document is living, OR the project has at least one
 * bound source in its registry. Until then the entry-path shell must not claim source-sync state (plan 42
 * L3 copy audit): a fresh folder of plain Markdown has no sources to be "synced", so the sync pill is
 * omitted rather than fabricated. Both inputs are optional so callers can pass whichever they have.
 */
export function projectHasLivingSurface(facts: { readonly anyDocLiving?: boolean; readonly boundSourceCount?: number }): boolean {
	return !!facts.anyDocLiving || (facts.boundSourceCount ?? 0) > 0;
}
