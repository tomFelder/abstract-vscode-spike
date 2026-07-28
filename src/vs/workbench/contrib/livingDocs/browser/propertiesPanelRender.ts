/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { DocAutonomyLevel } from '../common/docPolicy.js';
import { IBoundSourceSummary } from '../common/livingDocs.js';
import { renderPolicyEditor } from './policyEditorRender.js';

// The Properties panel - the plain-language front door to a document's frontmatter + lock (spec 43 pin 12,
// Obsidian's Properties in Abstract's calm palette). A 284px inset panel at the editor card's right edge that
// reads/writes TITLE / STATUS / TAGS / created-updated / BOUND SOURCES / AGENT POLICY. This module is a pure
// `(model) -> html` renderer; the host (livingDocRender + livingDocEditor) owns the toggle, the persistence and
// the delegation. Title/status/tags edits round-trip to frontmatter on disk; created/updated + bind counts are
// truthful reads from the file stat + the lock; AGENT POLICY reuses the shared policy editor verbatim (#122 F11).

/** The data a host hands the panel renderer. All display values; the host coerces/looks them up first. */
export interface IPropertiesPanelInput {
	/** The document id (resource string), used as the policy editor's stable name. */
	readonly docId: string;
	/** The authored frontmatter title ('' when the file has none - shown as the derived title placeholder). */
	readonly title: string;
	/** The derived display title (first H1 / filename fallback), the TITLE field's placeholder when unauthored. */
	readonly displayTitle: string;
	/** The plain-language status ('' when unauthored). */
	readonly status: string;
	/** The document's tags. */
	readonly tags: readonly string[];
	/** Created/updated epoch millis from the file stat (undefined => a plain dash, never a fabricated date). */
	readonly created?: number;
	readonly updated?: number;
	/** The document's bound sources with truthful per-source bind counts. */
	readonly boundSources: readonly IBoundSourceSummary[];
	/** The autonomy level actually IN EFFECT for the shared policy editor (`effectiveDocPolicy`, never the coerced middle). */
	readonly policy: DocAutonomyLevel;
	/** Whether a human dialled that level. False on a never-dialled document, which the editor badges "Default". */
	readonly policyAuthored: boolean;
}

function esc(s: string): string {
	return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// A mono short date ("12 Jul 2026") for the CREATED/UPDATED rows, or a plain dash when the time is unknown, so
// the panel never claims the epoch as a real date. Pure formatting; the caller supplies epoch millis.
function shortDate(ms: number | undefined): string {
	if (!ms) { return '&mdash;'; }
	const d = new Date(ms);
	const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
	return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;
}

// One labelled field block: a mono UPPER label above its value/control (label styling per P12.2).
function field(label: string, body: string): string {
	return `<div class="pp-field"><div class="pp-lab">${esc(label)}</div>${body}</div>`;
}

/**
 * Render the Properties panel HTML. The host wraps this in its inset-panel host and toggles it from the toolbar;
 * this function owns only the panel's own content (header + fields + footer).
 */
export function renderPropertiesPanel(input: IPropertiesPanelInput): string {
	// TITLE: an editable text field writing back to frontmatter `title:`. The placeholder shows the derived
	// title so an unauthored doc still names itself while inviting a title.
	const titleField = field('Title',
		`<input class="pp-input" type="text" data-prop-title value="${esc(input.title)}" placeholder="${esc(input.displayTitle)}" spellcheck="false">`);

	// CREATED / UPDATED: truthful mono dates read from the file stat (P12.3), side by side.
	const dates = `<div class="pp-field"><div class="pp-dates">`
		+ `<div><div class="pp-lab">Created</div><div class="pp-date">${shortDate(input.created)}</div></div>`
		+ `<div><div class="pp-lab">Updated</div><div class="pp-date">${shortDate(input.updated)}</div></div>`
		+ `</div></div>`;

	// STATUS: an editable chip reading in the `ok` pill treatment (P12.2). Editing writes `status:` to disk.
	const statusField = field('Status',
		`<div class="pp-status${input.status ? ' set' : ''}">`
		+ `<span class="pp-status-dot"></span>`
		+ `<input class="pp-status-in" type="text" data-prop-status value="${esc(input.status)}" placeholder="Set a status&#8230;" spellcheck="false">`
		+ `</div>`);

	// TAGS: accent-tint chips each with a quiet remove x, plus a dashed add button revealing an inline input.
	const tagChips = input.tags.map(t =>
		`<span class="pp-tag">${esc(t)}<button type="button" class="pp-tag-x" data-prop-tag-remove="${esc(t)}" title="Remove tag">&#10005;</button></span>`
	).join('');
	const tagsField = field('Tags',
		`<div class="pp-tags">${tagChips}`
		+ `<button type="button" class="pp-tag-add" data-prop-tag-add title="Add a tag">&#65291;</button>`
		+ `<input class="pp-tag-in" type="text" data-prop-tag-input placeholder="new tag&#8230;" spellcheck="false" style="display:none">`
		+ `</div>`);

	// BOUND SOURCES: 32px rows on white with the truthful bind count; a click opens the source drawer at that
	// source's keys (reusing the existing reveal path). Empty state stays quiet (no fabricated rows).
	const sourceRows = input.boundSources.length
		? input.boundSources.map(s =>
			`<button type="button" class="pp-src" data-prop-source="${esc(s.keys.join(','))}" title="Open ${esc(s.source)}">`
			+ `<span class="pp-src-glyph">&#8862;</span>`
			+ `<span class="pp-src-name">${esc(s.source)}</span>`
			+ `<span class="pp-src-count">${s.count}</span></button>`
		).join('')
		: `<div class="pp-empty">No bound sources yet.</div>`;
	const sourcesField = field('Bound Sources', `<div class="pp-srcs">${sourceRows}</div>`);

	// AGENT POLICY: the shared plain-language policy editor (spec 3.4), reused verbatim by plan 49. A document
	// nobody has dialled shows the level that is genuinely in effect, badged "Default" with the unset hint -
	// never a stricter level than the pipeline enforces.
	const policyField = field('Agent Policy', renderPolicyEditor({ selected: input.policy, name: input.docId, unset: !input.policyAuthored }));

	const header = `<div class="pp-head"><span class="pp-title">Properties</span>`
		+ `<button type="button" class="pp-x" data-props-close title="Close properties">&#10005;</button></div>`;

	// Footer: the pro back door. "Edit raw YAML" opens the raw markdown view (P12.5).
	const footer = `<div class="pp-foot"><button type="button" class="pp-raw" data-props-raw>Edit raw YAML &rarr;</button></div>`;

	return `<aside class="propspanel" data-props-panel>${header}`
		+ `<div class="pp-body">${titleField}${dates}${statusField}${tagsField}${sourcesField}${policyField}</div>`
		+ `${footer}</aside>`;
}
