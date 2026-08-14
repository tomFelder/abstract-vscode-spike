/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Knowledge (round 2, comp panel 4a): the project's real source library, repainted onto the warm-paper
// design system (docs/28-design-system-round2.md). Four parts: K1 the title block (screen title + the
// user-unit summary, the project/organization scope pills and the "+ Add source" primary); K2 the source
// table (SOURCE · KIND · SYNCED · FEEDS · FIGURES, kind glyphs, the F12 freshness vocabulary, FEEDS chips
// that open the doc, a row click that selects the source); K3 the selected source's detail card beside the
// static HOW BINDING WORKS aside, plus at most one attention card for the stalest stale source.
// Only `renderKnowledge` is public.
//
// The two rules this screen is judged on (comp caption 4a): "user units, consistent freshness words, no
// template tokens". The FIGURES column therefore reads "feeds 23" - never "23 binds" - because a figure is
// what the reader sees in their document, and every freshness word comes from the ONE vocabulary in
// common/sourceFreshness so the table, drawer, tree meta, hover-peek and Context tab cannot drift apart.
// Real data only: every row is a real folder source, and nothing (row counts, cadences) is fabricated.

import { localize } from '../../../../nls.js';
import { ILivingDocSummary, ISourceInfo } from '../common/livingDocs.js';
import { AMBER, FONT, HAIRLINE, INDIGO, INK, PAPER, RADIUS, TRACKING, TYPE } from '../common/abstractTokens.js';
import { freshnessLabel, FRESHNESS_COLOURS, relativeSyncedShort, sourceFreshness, SourceFreshness } from '../common/sourceFreshness.js';
import { esc, IScreenState } from './screenRenderShell.js';

// The SEMANTIC kind of a source (K2.2). This is the ONE classification: both the KIND word and the KIND-cell
// glyph derive from it, so the two can never disagree (D1 fix - the glyph used to be keyed on the transport
// `s.kind` file/api/mcp, which drifted from the semantic word). The axis is what the source IS, not how it
// arrives: a table (CSV/data), a transcript (text influence file), a reference (context-only doc), or a live
// feed (api/mcp endpoint).
const enum KindCategory {
	Table,
	Transcript,
	Reference,
	Feed,
}

// The one grid the header row and every source row share, so a cell can never drift out of its column
// (comp 4a: SOURCE · KIND · SYNCED · FEEDS · FIGURES).
const TABLE_GRID = '2fr 1fr 1.2fr 2.2fr 1fr';

// The table's column labels: mono 10 tracked .12em in meta ink, exactly as the comp draws them. Slightly
// tighter than the kind-badge step because a five-column header has to stay quiet under the row it labels.
const COL_LABEL = `400 10px/1 ${FONT.mono}`;

// Classify a source semantically. "Live feed" for an api/mcp source, "Reference" for a context-only doc,
// "Table" for a CSV/data file, "Transcript" for any other (markdown/text influence) file.
function kindCategory(s: ISourceInfo, contextOnly: boolean): KindCategory {
	if (s.kind === 'api' || s.kind === 'mcp') { return KindCategory.Feed; }
	if (contextOnly) { return KindCategory.Reference; }
	if (/\.(csv|json|tsv|xlsx?)$/i.test(s.id)) { return KindCategory.Table; }
	return KindCategory.Transcript;
}

// The plain-English name for the KIND column, keyed off the semantic category (one truth with the glyph).
function kindWord(cat: KindCategory): string {
	switch (cat) {
		case KindCategory.Feed: return localize("livingDocs.knowledge.kind.feed", "Live feed");
		case KindCategory.Reference: return localize("livingDocs.knowledge.kind.reference", "Reference");
		case KindCategory.Table: return localize("livingDocs.knowledge.kind.table", "Table");
		case KindCategory.Transcript: return localize("livingDocs.knowledge.kind.transcript", "Transcript");
	}
}

// The KIND-cell glyph, keyed off the SAME semantic category as the word (source-hygiene: non-ASCII written as
// HTML entities). Table = the squared-plus table glyph, Transcript = the fisheye glyph, Reference/Feed = the
// diamond reference glyph. Round 2 draws every glyph in heading ink: kind is carried by the shape and by the
// KIND word, never by a hue (a hue in this product means a state, and a source's kind is not a state).
function kindGlyph(cat: KindCategory): string {
	switch (cat) {
		case KindCategory.Table: return '&#8862;';
		case KindCategory.Transcript: return '&#9677;';
		case KindCategory.Reference: return '&#9671;';
		case KindCategory.Feed: return '&#9671;';
	}
}

// True when every document that uses this source uses it as context/influence (no value bindings) - the
// "context only" F12 state. A source with no dependents at all is treated as context-only (nothing binds it).
function isContextOnly(s: ISourceInfo): boolean {
	return s.usedBy.length === 0 || s.usedBy.every(u => u.context);
}

// How many FIGURES a source feeds: the total number of distinct bind keys its dependents resolve from it.
// The user unit is the figure they read in the document, so this count is always spoken as "feeds 23" and
// never as the internal token count ("23 binds") - comp 4a's correction.
function figureCount(s: ISourceInfo): number {
	let n = 0;
	for (const u of s.usedBy) { n += u.keys.length; }
	return n;
}

// ---- Knowledge (round 2, comp 4a). ----
export function renderKnowledge(state: IScreenState): string {
	const isOrg = state.knScope === 'org';
	const sources = state.sources ?? [];
	const docs = state.docs ?? [];
	const dataFiles = state.dataFiles ?? [];
	const now = state.knNow ?? 0;

	// The screen body floats on the plan-44 elevation card; the webview body is transparent so that card shows
	// through (same no-rails shell as Home + Templates). Knowledge never repaints its own canvas.
	const scroll = (inner: string) => `<div class="screen" style="background:transparent"><div style="flex:1;overflow-y:auto;background:transparent">${inner}</div></div>`;

	// The honest "Soon" body for the Organization scope: no org store exists yet, so nothing is fabricated.
	const orgBody = `<div style="min-height:52vh;display:flex;align-items:center;justify-content:center">
		<div style="text-align:center;max-width:430px;padding:40px">
			<div style="font-size:38px;line-height:1;margin-bottom:14px">&#127970;</div>
			<div style="font:600 17px/1.3 ${FONT.sans};color:${INK.heading};margin-bottom:8px">${localize("livingDocs.knowledge.org.title", "Organization knowledge")} <span style="font:${TYPE.kindBadge};letter-spacing:${TRACKING.kindBadge};color:${AMBER.label};background:${AMBER.bg};border-radius:${RADIUS.pill};padding:4px 8px;vertical-align:middle">${localize("livingDocs.knowledge.org.soon", "SOON")}</span></div>
			<p style="margin:0;font:${TYPE.uiBody};color:${INK.bodySoft}">${localize("livingDocs.knowledge.org.body", "An org-wide store of shared sources and decisions is not connected yet. Switch back to this project to see the sources it draws on.")}</p>
		</div>
	</div>`;

	// The detail card follows the selection; with none (or with one that no longer exists on disk) it falls back
	// to the first value-feeding source, so the card is never an empty shell while the table has rows.
	const selected = sources.find(s => s.id === state.knSelectedSource) ?? sources.find(s => !isContextOnly(s)) ?? sources[0];
	const selectedId = selected?.id;

	// K2: one SOURCES-table row. The whole row is a button that SELECTS the source, which fills the detail card
	// below (comp 4a's highlighted row + detail pattern); the file itself opens from that card's "open source"
	// link, so the row press has exactly one meaning. A stale row paints the shared cream, and the selected row
	// sits a half-step below the card surface so the selection reads without borrowing a hue that means something.
	const row = (s: ISourceInfo, last: boolean) => {
		const contextOnly = isContextOnly(s);
		const cat = kindCategory(s, contextOnly);
		const st = sourceFreshness({ fresh: s.fresh, contextOnly, markedExpected: s.markedExpected });
		const fresh = freshnessLabel(st, s.syncedAt, now);
		const figures = figureCount(s);
		const stale = st === SourceFreshness.Stale;
		// FEEDS: document chips (up to two, then "+N"), each opening its doc - two is what the column holds on
		// one line, and a row that stays one line tall is what makes the table scannable. A context-only source
		// that no document binds reads the quiet "available to all docs" line (the comp's brand-guidelines row).
		const bindingDocs = s.usedBy.filter(u => !u.context);
		const feedDocs = bindingDocs.length ? bindingDocs : s.usedBy;
		const chips = feedDocs.length === 0
			? `<span style="font:400 11.5px/1.4 ${FONT.sans};color:${INK.meta}">${localize("livingDocs.knowledge.feeds.all", "available to all docs")}</span>`
			: feedDocs.slice(0, 2).map(u => `<span data-msg="openDoc" data-arg="${esc(u.doc.toString())}" data-stop style="padding:3px 10px;display:inline-block;border-radius:${RADIUS.pill};background:${PAPER.chip};color:${INK.body};font:400 11.5px/1.5 ${FONT.sans};cursor:pointer;max-width:170px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(u.title)}</span>`).join('')
			+ (feedDocs.length > 2 ? `<span style="font:400 11.5px/1.3 ${FONT.sans};color:${INK.meta};align-self:center">+${feedDocs.length - 2}</span>` : '');
		// FIGURES: the user unit, right-aligned. A context-only source feeds none, and says so with a plain
		// dash rather than a zero (nothing is broken - it was never a value source).
		const figuresCell = figures > 0
			? `<span style="text-align:right;font:400 13px/1.3 ${FONT.sans};color:${INK.bodySoft}">${localize("livingDocs.knowledge.figures", "feeds {0}", figures)}</span>`
			: `<span style="text-align:right;font:400 13px/1.3 ${FONT.sans};color:${INK.meta}">-</span>`;
		const cells = `<span style="display:flex;align-items:center;gap:8px;min-width:0;font:600 14.5px/1.3 ${FONT.sans};color:${INK.heading}"><span style="flex:none">${kindGlyph(cat)}</span><span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(s.label)}</span></span>
			<span style="font:400 13px/1.3 ${FONT.sans};color:${INK.bodySoft}">${kindWord(cat)}</span>
			<span style="display:flex;align-items:center;gap:6px;font:400 13px/1.3 ${FONT.sans};color:${fresh.text}"><span style="width:6px;height:6px;flex:none;border-radius:${RADIUS.pill};background:${fresh.dot}"></span>${esc(fresh.label)}</span>
			<span style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;min-width:0">${chips}</span>
			${figuresCell}`;
		const bg = stale ? FRESHNESS_COLOURS.staleRowBg : (s.id === selectedId ? PAPER.page : PAPER.card);
		const hoverBg = stale ? AMBER.bg : PAPER.sunken;
		const filterKey = esc((s.label + ' ' + s.usedBy.map(u => u.title).join(' ')).toLowerCase());
		return `<button class="kn-row" data-kn-row data-kn-name="${filterKey}" data-msg="selectSource" data-arg="${esc(s.id)}" data-rowhover="${hoverBg}" data-rowbg="${bg}" style="display:grid;grid-template-columns:${TABLE_GRID};align-items:center;gap:12px;width:100%;text-align:left;padding:15px 24px;background:${bg};border:none;cursor:pointer;${last ? '' : `border-bottom:1px solid ${HAIRLINE.soft};`}">${cells}</button>`;
	};

	// The header row + the rows, in the bordered card. Header: mono 10/.12em meta ink on the rail surface,
	// under a medium hairline (the weight that separates a card's head from its rows).
	const header = `<div style="display:grid;grid-template-columns:${TABLE_GRID};gap:12px;padding:10px 24px;background:${PAPER.rail};border-bottom:1px solid ${HAIRLINE.medium};font:${COL_LABEL};letter-spacing:.12em;color:${INK.meta}">
		<span>${localize("livingDocs.knowledge.col.source", "SOURCE")}</span><span>${localize("livingDocs.knowledge.col.kind", "KIND")}</span><span>${localize("livingDocs.knowledge.col.synced", "SYNCED")}</span><span>${localize("livingDocs.knowledge.col.feeds", "FEEDS")}</span><span style="text-align:right">${localize("livingDocs.knowledge.col.figures", "FIGURES")}</span>
	</div>`;
	const table = sources.length === 0
		? `<div style="border:1px solid ${HAIRLINE.strong};border-radius:${RADIUS.cardLarge};background:${PAPER.rail};padding:40px 32px;text-align:center">
				<div style="font-size:30px;line-height:1;margin-bottom:12px;color:${INK.meta}">&#8862;</div>
				<div style="font:600 15px/1.3 ${FONT.sans};color:${INK.heading};margin-bottom:6px">${localize("livingDocs.knowledge.empty.title", "No sources yet")}</div>
				<p style="margin:0 auto;max-width:380px;font:${TYPE.uiBody};color:${INK.secondary}">${localize("livingDocs.knowledge.empty.body", "When a document in this project binds a CSV, JSON or an API, it appears here with its freshness and the documents that depend on it.")}</p>
			</div>`
		: `<div class="kn-table" style="background:${PAPER.card};border:1px solid ${HAIRLINE.strong};border-radius:${RADIUS.cardLarge};overflow:hidden">${header}${sources.map((s, i) => row(s, i === sources.length - 1)).join('')}</div>`;

	// K3.1: at most ONE attention card - the stalest stale source that is not marked-expected - with working
	// Re-sync + mark-as-expected. Amber is the one colour that means "waiting on you", so this is a strip above
	// the table rather than a permanent pill: all-fresh (or all stale-but-expected) renders nothing at all.
	const staleSources = sources.filter(s => !s.fresh && !s.markedExpected);
	// The stalest = the oldest sync time among the stale set (undefined sync sorts oldest).
	const stalest = staleSources.slice().sort((a, b) => (a.syncedAt ?? '') < (b.syncedAt ?? '') ? -1 : 1)[0];
	const attentionCard = stalest
		? (() => {
			const cite = stalest.usedBy.find(u => !u.context) ?? stalest.usedBy[0];
			const citeName = cite ? cite.title : localize("livingDocs.knowledge.attention.someDoc", "a document");
			const age = relativeSyncedShort(stalest.syncedAt, now);
			return `<div style="border:1px solid ${AMBER.border};background:${AMBER.subtleBg};border-radius:${RADIUS.card};padding:14px 16px;margin-bottom:16px">
				<div style="font:${TYPE.kindBadge};letter-spacing:${TRACKING.kindBadge};color:${AMBER.label};margin-bottom:6px">${localize("livingDocs.knowledge.attention.tag", "STALE SOURCE")}</div>
				<div style="font:400 13px/1.55 ${FONT.sans};color:${AMBER.body}">${localize("livingDocs.knowledge.attention.body", "{0} changed {1} but {2} cites it. ", esc(stalest.label), esc(age), esc(citeName))}<span data-msg="resyncSource" data-arg="${esc(stalest.id)}" style="color:${INDIGO.base};cursor:pointer;text-decoration:underline">${localize("livingDocs.knowledge.attention.resync", "Re-sync")}</span> ${localize("livingDocs.knowledge.attention.or", "or")} <span data-msg="markSourceExpected" data-arg="${esc(stalest.id)}" style="color:${INDIGO.base};cursor:pointer;text-decoration:underline">${localize("livingDocs.knowledge.attention.expected", "mark as expected")}</span>.</div>
			</div>`;
		})()
		: '';
	// When a source has been marked-expected, offer a quiet honest note to undo it (so the calm is reversible).
	const expectedSources = sources.filter(s => s.markedExpected && !s.fresh);
	const expectedNote = expectedSources.length
		? `<div style="margin-top:12px;font:${TYPE.secondary};color:${INK.meta}">${localize("livingDocs.knowledge.expected.note", "{0} marked as expected.", expectedSources.map(s => esc(s.label)).join(', '))} <span data-msg="unmarkSourceExpected" data-arg="${esc(expectedSources[0].id)}" style="color:${INDIGO.base};cursor:pointer;text-decoration:underline">${localize("livingDocs.knowledge.expected.undo", "Undo")}</span></div>`
		: '';

	// K3.2: the selected source's detail card - the dependency fan-in in user units. Every line is real: the
	// documents that draw on the source, the exact keys they resolve, and the two doors (open the document, or
	// detach the source from it). The footer states the promise that makes binding safe.
	const detailCard = selected ? (() => {
		const contextOnly = isContextOnly(selected);
		const cat = kindCategory(selected, contextOnly);
		const figures = figureCount(selected);
		// Mono provenance: only facts we actually hold. An api source shows its endpoint (its label is only the
		// host); a file source shows just the sync fact, because its name is already the heading beside it.
		const syncedPhrase = selected.syncedAt
			? localize("livingDocs.knowledge.detail.synced", "synced {0}", relativeSyncedShort(selected.syncedAt, now))
			: localize("livingDocs.knowledge.detail.neverSynced", "not yet synced");
		const provenance = selected.id === selected.label ? syncedPhrase : `${selected.id} · ${syncedPhrase}`;
		const openSource = selected.resource
			? `<span data-msg="openSource" data-arg="${esc(selected.resource.toString())}" style="font:400 12.5px/1.3 ${FONT.sans};color:${INDIGO.base};cursor:pointer">${localize("livingDocs.knowledge.detail.openSource", "open source")} &#8599;</span>`
			: '';
		const headline = figures > 0
			? localize("livingDocs.knowledge.detail.feeds", "Feeds {0} figure{1} in {2} document{3}.", figures, figures === 1 ? '' : 's', selected.usedBy.length, selected.usedBy.length === 1 ? '' : 's')
			: selected.usedBy.length
				? localize("livingDocs.knowledge.detail.context", "Read as context by {0} document{1}.", selected.usedBy.length, selected.usedBy.length === 1 ? '' : 's')
				: localize("livingDocs.knowledge.detail.none", "No document draws on this yet.");
		const lines = selected.usedBy.map(u => {
			const keys = u.keys.length
				? `<span style="font:400 11.5px/1.4 ${FONT.mono}">${esc(u.keys.slice(0, 4).join(', '))}</span>${u.keys.length > 4 ? ` ${localize("livingDocs.knowledge.detail.moreKeys", "+{0} more", u.keys.length - 4)}` : ''}`
				: localize("livingDocs.knowledge.detail.asContext", "read as context");
			const detachArg = esc(JSON.stringify({ doc: u.doc.toString(), source: selected.id, context: u.context }));
			return `<div>${esc(u.title)} - ${keys} · <span data-msg="openDoc" data-arg="${esc(u.doc.toString())}" style="color:${INDIGO.base};cursor:pointer">${localize("livingDocs.knowledge.detail.open", "open")} &#8599;</span> · <span data-msg="detachSource" data-arg="${detachArg}" style="color:${INDIGO.base};cursor:pointer">${localize("livingDocs.knowledge.detail.detach", "detach")}</span></div>`;
		}).join('');
		const footer = cat === KindCategory.Feed
			? localize("livingDocs.knowledge.detail.footerFeed", "If this feed changes shape or stops answering, every dependent figure flags stale instead of guessing.")
			: localize("livingDocs.knowledge.detail.footerFile", "If this file moves or its columns change, every dependent figure flags stale instead of guessing.");
		return `<div style="background:${PAPER.card};border:1px solid ${HAIRLINE.strong};border-radius:${RADIUS.cardLarge};padding:20px 24px;display:flex;flex-direction:column;gap:12px">
			<div style="display:flex;align-items:center;gap:10px">
				<span style="font:600 15px/1.3 ${FONT.sans};color:${INK.heading}">${kindGlyph(cat)} ${esc(selected.label)}</span>
				<span style="font:400 11px/1.4 ${FONT.mono};color:${INK.meta};overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(provenance)}</span>
				<span style="flex:1"></span>
				${openSource}
			</div>
			<div style="font:400 13px/1.7 ${FONT.sans};color:${INK.bodySoft}">
				<strong style="color:${INK.heading}">${headline}</strong>
				${lines}
			</div>
			<div style="border-top:1px solid ${HAIRLINE.soft};padding-top:10px;font:400 12px/1.5 ${FONT.sans};color:${INK.meta}">${footer}</div>
		</div>`;
	})() : '';

	// The static explainer beside it, on the sunken surface: what a binding IS, in the reader's terms.
	const explainer = `<div style="background:${PAPER.sunken};border:1px solid ${PAPER.sunkenBorder};border-radius:${RADIUS.cardLarge};padding:20px 24px;display:flex;flex-direction:column;gap:8px">
		<span style="font:${TYPE.kindBadge};letter-spacing:${TRACKING.sectionLabel};color:${INK.secondary}">${localize("livingDocs.knowledge.explainer.tag", "HOW BINDING WORKS")}</span>
		<p style="margin:0;font:400 13px/1.65 ${FONT.sans};color:${INK.bodySoft}">${localize("livingDocs.knowledge.explainer.body", "A bound figure is a live reference into one of these sources. When the source changes, every document that cites it updates - through the approval rules you set per document. You can always trace a figure back to its exact cell.")}</p>
	</div>`;
	const detailRow = sources.length === 0 ? '' : `<div style="display:grid;grid-template-columns:1.4fr 1fr;gap:16px;margin-top:24px">${detailCard}${explainer}</div>${expectedNote}`;

	// K1.2: the summary line in user units - sources, the figures they feed, and the documents that read them.
	// Every number is counted from the real registry; an empty registry says so rather than reading "0 of 0".
	const totalFigures = sources.reduce((n, s) => n + figureCount(s), 0);
	const dependentDocs = new Set<string>();
	for (const s of sources) {
		for (const u of s.usedBy) { dependentDocs.add(u.doc.toString()); }
	}
	const sub = sources.length === 0
		? localize("livingDocs.knowledge.sub.empty", "Everything your documents draw on. Nothing is bound yet.")
		: localize("livingDocs.knowledge.sub", "Everything your documents draw on. {0} source{1} feed{2} {3} figure{4} across {5} document{6}.",
			sources.length, sources.length === 1 ? '' : 's', sources.length === 1 ? 's' : '',
			totalFigures, totalFigures === 1 ? '' : 's',
			dependentDocs.size, dependentDocs.size === 1 ? '' : 's');

	// K1.1: the title block. The scope pills are a real concept (the honest org-"Soon" body lives behind the
	// second one), so they are drawn as the comp's segmented control: chip-filled group, the active pill white
	// with a strong hairline. The primary opens the same Add-source sheet the global header's action opens.
	const scopeTab = (label: string, on: boolean, msg: string) => `<button data-msg="${msg}" style="border:1px solid ${on ? HAIRLINE.strong : 'transparent'};border-radius:${RADIUS.pill};padding:5px 16px;font:${on ? 600 : 400} 12.5px/1.3 ${FONT.sans};cursor:pointer;background:${on ? PAPER.card : 'transparent'};color:${on ? INK.heading : INK.meta}">${esc(label)}</button>`;
	const titleRow = `<div style="display:flex;align-items:flex-end;gap:16px;margin-bottom:24px">
			<div style="display:flex;flex-direction:column;gap:6px;min-width:0">
				<h1 style="margin:0;font:${TYPE.screenTitle};letter-spacing:${TRACKING.screenTitle};color:${INK.heading}">${localize("livingDocs.knowledge.title", "Knowledge")}</h1>
				<p style="margin:0;font:400 14.5px/1.45 ${FONT.sans};color:${INK.bodySoft}">${isOrg ? '' : esc(sub)}</p>
			</div>
			<span style="flex:1"></span>
			<div style="display:flex;background:${PAPER.chip};border-radius:${RADIUS.pill};padding:3px">${scopeTab(localize("livingDocs.knowledge.scope.project", "This project"), !isOrg, 'setKnProject')}${scopeTab(localize("livingDocs.knowledge.scope.org", "Organization"), isOrg, 'setKnOrg')}</div>
			<button class="btn-primary" style="flex:none;padding:7px 16px;font:600 13px/1.25 ${FONT.sans}" data-sheet-open="addsource">&#65291; ${localize("livingDocs.knowledge.addSource", "Add source")}</button>
		</div>`;

	// The live filter sits directly above the table it narrows (the comp's title row is full). A "no matches"
	// line replaces the table when the query hides every row, so the surface never reads as empty/broken.
	const filterRow = sources.length === 0 ? '' : `<div style="display:flex;align-items:center;margin-bottom:12px"><span style="flex:1"></span><label class="tpl-filter">&#8981;<input data-kn-filter type="text" placeholder="${localize("livingDocs.knowledge.filter", "Filter sources…")}" aria-label="${localize("livingDocs.knowledge.filter", "Filter sources…")}"></label></div>`;
	const noMatch = `<div data-kn-nomatch style="display:none;font:${TYPE.uiBody};color:${INK.secondary};margin-top:14px">${localize("livingDocs.knowledge.noMatch", "No sources match your filter.")}</div>`;

	const projectBody = `${attentionCard}${filterRow}${table}${noMatch}${detailRow}`;

	const addSheet = renderAddSourceSheet(docs, dataFiles);
	const body = `<div style="max-width:1180px;margin:0 auto;padding:56px 48px 80px">
		${titleRow}
		${isOrg ? orgBody : projectBody}
	</div>`;
	return scroll(body) + addSheet;
}

// The Add-source sheet body (plan 29 iter 2, retained for 49-a K1.2): a target-document picker + a file/API
// source picker. The file rows are the folder's real data files (decision 40's in-app picker), landing in the
// folder's sources/ on first use; an API URL row covers the api kind. Both submit `addSource`/`addSourceApi`
// with the chosen document + source through the service write path (never a fabricated binding).
function renderAddSourceSheet(docs: readonly ILivingDocSummary[], dataFiles: readonly string[]): string {
	const sectionLabel = `font:${TYPE.kindBadge};letter-spacing:${TRACKING.kindBadge};color:${INK.meta}`;
	const docOptions = docs.map(d => `<option value="${esc(d.resource.toString())}">${esc(d.title)}</option>`).join('');
	const fileRows = dataFiles.length
		? dataFiles.map(f => `<button class="sheet-row" data-sheet-submit data-msg="addSource" data-arg="${esc(f)}"><span style="width:28px;height:28px;flex:none;border-radius:${RADIUS.control};background:${INDIGO.tint};color:${INDIGO.base};font-size:12px;display:flex;align-items:center;justify-content:center">&#8862;</span><span style="flex:1;min-width:0;font:${TYPE.uiBodyStrong};color:${INK.heading};overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(f)}</span></button>`).join('')
		: `<div style="font:${TYPE.secondary};color:${INK.meta};padding:8px 2px">${localize("livingDocs.knowledge.sheet.noFiles", "No unused data files in this folder.")}</div>`;
	const body = `<label class="sheet-label" style="margin-top:14px">${localize("livingDocs.knowledge.sheet.bindTo", "Bind to document")}</label>
		<select class="sheet-input" data-field="target">${docOptions}</select>
		<div style="${sectionLabel};margin:16px 0 2px">${localize("livingDocs.knowledge.sheet.folderFiles", "FOLDER DATA FILES")}</div>
		${fileRows}
		<div style="${sectionLabel};margin:16px 0 8px">${localize("livingDocs.knowledge.sheet.orApi", "OR AN API ENDPOINT")}</div>
		<div style="display:flex;gap:8px">
			<input class="sheet-input" data-field="apiurl" placeholder="https://api.example.com/metrics" style="flex:1">
			<button class="btn-primary" data-sheet-submit data-msg="addSourceApi" style="flex:none;padding:0 16px;font:${TYPE.uiBodyStrong}">${localize("livingDocs.knowledge.sheet.add", "Add")}</button>
		</div>
		<div style="display:flex;gap:8px;margin-top:18px;justify-content:flex-end"><button class="btn-ghost" data-sheet-close="addsource">${localize("livingDocs.knowledge.sheet.cancel", "Cancel")}</button></div>`;
	return `<div class="sheet-back" id="sheet-addsource" data-sheet="addsource">
		<div class="sheet-card" role="dialog" aria-modal="true">
			<h2 class="sheet-title">${localize("livingDocs.knowledge.sheet.title", "Add a source")}</h2>
			<p class="sheet-sub">${localize("livingDocs.knowledge.sheet.sub", "Bind a data file or an API endpoint to a document. It joins the document's sources and its figures resolve against it.")}</p>
			${body}
		</div>
	</div>`;
}
