/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { renderMarkdown } from '../../../../base/browser/markdownRenderer.js';
import { decodeBase64 } from '../../../../base/common/buffer.js';
import { localize } from '../../../../nls.js';
import { addressLabel, IBlockGutterEntry } from '../common/livingDocAddress.js';
import { isRelativeImageSrc, rewriteMarkdownImageSrcs } from '../common/livingDocAssets.js';
import { IFigureChange, ISourcePeek } from '../common/livingDocs.js';
import { parseLivingDoc, reconcileBindLinks } from '../common/livingDocMarkdown.js';
import { buildBulkSet, ILivingDoc, IProposedChange, IReviewFraming, reviewFraming } from '../common/livingDocsModel.js';
import { buildPmDecorationSpec, IPmDiffSegment, IPmEditDecoration, IPmGutterMarker, IPmInsertDecoration, IPmProvenance } from '../common/livingDocPmDecorations.js';
import { deleteCol, deleteRow, gfmEscapeCell, gfmIsAlignRow, gfmParseAlign, gfmSplitCells, insertCol, insertRow, parseGfmTable, serializeGfmTable, setCell } from '../common/livingDocTableEdit.js';
import { isWordHtml, normalizeWordPasteHtml, pasteStartShouldClose } from '../common/livingDocWordPaste.js';
import { activeWikilink, matchTypedWikilink, rankWikilinkTargets, resolveWikilinkTarget, splitWikilinkQuery, WIKILINK_PICKER_LIMIT, wikilinksToPlainText } from '../common/wikilinks.js';
import { FRESHNESS_COLOURS, UNREACHABLE_SOURCE_LINE, UNREACHABLE_SOURCE_MARKER } from '../common/sourceFreshness.js';
import { AMBER, DARK_SURFACE, FONT, GREEN, HAIRLINE, INDIGO, INK, PAPER, RADIUS, RED, SHADOW, TRACKING, TYPE } from '../common/abstractTokens.js';
import { FIND_WIDGET_HTML, FIND_WIDGET_RUNTIME, FIND_WIDGET_STYLE } from './livingDocFindWidget.js';
import { POLICY_EDITOR_STYLE } from './policyEditorRender.js';
import { PROSEMIRROR_BUNDLE_BASE64 } from './prosemirrorBundle.js';

// The vendored ProseMirror IIFE (decision 43) is shipped base64-encoded to keep the source ASCII +
// single-quoted (repo hygiene); decode it once, lazily, and reuse the decoded text on every render.
let _pmBundleCache: string | undefined;
function proseMirrorBundle(): string {
	if (_pmBundleCache === undefined) {
		_pmBundleCache = decodeBase64(PROSEMIRROR_BUNDLE_BASE64).toString();
	}
	return _pmBundleCache;
}

// The Markdown for the initial ProseMirror mount is embedded in the shell as a JSON-encoded global
// (`<` escaped so it can never break out of the script); the RUNTIME reads it on load. Any literal
// '</script' in the vendored bundle is defensively split when it is inlined into the shell.
function escapeForScript(text: string): string {
	return JSON.stringify(text).replace(/</g, '\\u003c');
}

// Bind links render as plain text - the resolved value is its own visible text, and the `bind:` URL
// is never shown to the reader (spec 3.2). A blue gutter dot marks the bound line instead.
const BIND_LINK_RE = /\[([^\]]*)\]\(bind:([^)\s]+)\)/g;
function bindToValue(text: string): string {
	return text.replace(BIND_LINK_RE, '$1');
}

const EMPTY_RESOLVED: ReadonlyMap<string, string> = new Map<string, string>();

// 'pm' = the unified ProseMirror surface - the single editing surface for EVERY document, plain and
// living (plan 15 iter 5 flipped the default and retired the bespoke renderDoc body); 'raw' = the
// Markdown textarea, reachable from the editor for hand-editing source.
export type LivingDocViewMode = 'raw' | 'pm';

// (plan 33 iter 4, L8; doc 22 section 3) Present offers what Abstract actually produces today: a self-contained
// HTML page, clean portable Markdown, a print-to-PDF and a Word .docx mapped to built-in styles. The
// remaining cloud/spreadsheet destinations (Google Docs, Google Sheets, Excel) are real product goals but
// not built yet, so they stay honest "Soon" rows (non-selectable) rather than fabricating a format - the
// plan-17 rule against dead-end affordances.
export type PresentChoice = 'html' | 'markdown' | 'pdf' | 'docx' | 'gdoc' | 'gsheet' | 'xlsx';

export interface IPresentState {
	readonly open: boolean;
	readonly choice: PresentChoice;
	/**
	 * The before-export gate's verdict (plan 32 iter 4), computed by the editor when the modal opens. When
	 * `pass:false` the modal SHOWS the grader's one-line `flag` and swaps the export CTA for "Export anyway"
	 * (audited override) + "Fix first" (jumps to the flagged block) - no silent block, no silent override.
	 * Absent = not yet computed / clean, so the modal reads as a normal export.
	 */
	readonly gate?: { readonly pass: boolean; readonly flag?: string };
}

export interface ILivingDocRenderInput {
	readonly doc: ILivingDoc | undefined;
	readonly pending: readonly IProposedChange[];
	/** Resolved value per bind key; the visible cache is reconciled to these at render time (lock wins). */
	readonly resolved: ReadonlyMap<string, string>;
	/** True when a source changed since last sync/review ("may be affected"). */
	readonly dirty: boolean;
	readonly status: string;
	readonly recent: ReadonlySet<string>;
	readonly mode: LivingDocViewMode;
	readonly rawText: string;
	readonly present: IPresentState;
	/** The figure diff from the last "Sync across" (drives the synced banner). */
	readonly syncDiff: readonly IFigureChange[];
	/**
	 * When set, the in-surface source-peek pane is open (the comp's "Sync across" source panel): it
	 * renders to the LEFT of the document inside the one surface - never a second editor group.
	 */
	readonly sourcePeek?: ISourcePeekRender;
	/**
	 * The next document (other than this one) that still has pending changes, if any (plan 19 iter 4).
	 * Drives the editor action bar's "Next document with changes" button - shown only when there is
	 * somewhere to advance to. Computed by the editor pane (which sees workspace-wide pending).
	 */
	readonly nextChangedDocTitle?: string;
	/**
	 * The PREVIOUS document with pending changes, if any (docs/30 section 4.3). Drives the review bar's
	 * "Previous document" button - the backward half of the cross-document walk, because review is not
	 * monotonic. Same source as `nextChangedDocTitle`, opposite direction.
	 */
	readonly prevChangedDocTitle?: string;
	/** Total pending changes across EVERY document (plan 19 iter 5) - drives "Approve all everywhere". */
	readonly totalPendingCount?: number;
	/**
	 * Per-bind-key provenance for the figure/gutter hover tooltip (plan 29, iter 3): where each bound value
	 * came from, when it synced, and whether it is still fresh. Built by the editor pane from the lock +
	 * freshness; empty for a plain (non-living) document. Real data only - never a fabricated sync state.
	 */
	readonly provenance?: readonly IPmProvenance[];
	/**
	 * The number of saved versions (snapshots) recorded for this document (plan 26 iter 4): drives the
	 * toolbar's honest `Saved &middot; vN` chip. Absent/0 => a plain `Saved` (no fabricated version number).
	 */
	readonly snapshotCount?: number;
	/**
	 * True in the web build (issue #121 / decision 162): the workspace mount is an in-memory / memfs
	 * provider whose writes do NOT survive a page reload, so the beta demotes the web build to a dev
	 * harness. When set, the toolbar's save chip states plainly that changes live only in this tab
	 * instead of the persistent "Saved" claim it makes on the Electron desktop build (where writes reach
	 * disk). Never fabricate a durable "Saved" state the provider can't back.
	 */
	readonly ephemeral?: boolean;
	/**
	 * The opened workspace folder's display name (issue #174), e.g. "docs" - the FIRST, clickable segment of
	 * the editor breadcrumb (project / document title). Absent when no folder is open (e.g. a screen), in
	 * which case the bar falls back to the brand crumb. Supplied by the editor pane from the workspace service.
	 */
	readonly projectName?: string;
	/**
	 * The document's on-disk file name (issue #174), e.g. "25-why-abstract.md" - shown in muted grey beside the
	 * document title so the reader always knows which file they are in, even scrolled deep into a long doc.
	 * Supplied by the editor pane from the document resource.
	 */
	readonly fileName?: string;
	/**
	 * The Properties panel state (plan 45 pin 12): the panel's rendered content and whether it is open. Present
	 * only in PM mode on a document; absent otherwise (raw mode / no doc), so the toolbar Properties button and
	 * the inset panel appear only where the panel is meaningful. Open state persists per-doc (the editor reads
	 * `livingDocs.v2.props.<docId>` from the storage service and hands it here).
	 */
	readonly properties?: IPropertiesRenderState;
	/**
	 * Every document name in the workspace (no `.md`), for the `[[` picker and the resolved/unresolved chip
	 * (plan 52 WP-C). The webview cannot scan the folder, so the host supplies the list; it is seeded into the
	 * shell for the first paint and refreshed afterwards by `lwdDocs` messages. Absent/empty simply means every
	 * wikilink renders unresolved - a truthful state, never a fabricated resolution.
	 */
	readonly docNames?: readonly string[];
}

/** The Properties panel's render state: whether it is open plus the panel's own HTML (built by the editor). */
export interface IPropertiesRenderState {
	readonly open: boolean;
	/** The panel's inner HTML (from `renderPropertiesPanel`); rendered into the inset host when open. */
	readonly html: string;
}

/** The source-peek data plus the editor-held sync state (the divider circle's synced confirmation). */
export interface ISourcePeekRender extends ISourcePeek {
	readonly synced: boolean;
	readonly syncedCount: number;
}

function esc(s: string): string {
	return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Render generic Markdown (headings, paragraphs, lists, bold/italic, code, links) by reusing
// VS Code's own sanitizing renderer, so any plain .md shows real content instead of a blank page.
function renderGenericMarkdown(body: string): string {
	const rendered = renderMarkdown({ value: body });
	try {
		return rendered.element.innerHTML;
	} finally {
		rendered.dispose();
	}
}

// Style and script are single left-aligned template literals so source indentation stays tab-only.
// Every colour, type step, radius and shadow below comes from `common/abstractTokens.ts` - the round-2
// design system as code (doc 28). The editor used to declare its own `ACCENT` constant, which meant the
// document surface could drift from the screens whenever one of the two was repainted; importing the token
// makes that drift impossible by construction.
const STYLE = `*{box-sizing:border-box}
/* Reset the webview harness's body padding (0 20px, injected by src/vs/workbench/contrib/webview/browser/pre/index.html)
 * as well as its margin. The harness inset survives a margin-only reset and pushes the top bar + formatting toolbar
 * ~20px off each pane rail (issue #175). Zeroing padding lets the full-bleed chrome reach both rails; the centred
 * 720px prose column keeps its own breathing room via the .pmwrap 40px lateral padding. */
html,body{margin:0;padding:0;height:100%;background:${PAPER.page};color:${INK.heading};font-family:${FONT.sans}}
/* The per-document brand/crumb top bar the doc used to draw is gone (plan 44-b): the one global Abstract
 * header (the repurposed title bar) carries the breadcrumb, the sync pill and the Present action. The
 * formatting toolbar (.etoolbar) now sticks at the top of the webview; the raw-mode exit lives in .rawtop. */
.rawtop{position:sticky;top:0;height:46px;z-index:5;flex:none;display:flex;align-items:center;padding:0 16px;border-bottom:1px solid ${HAIRLINE.medium};background:${PAPER.page}}
/* The PM change widgets (inline diff / insert) sit full-width in a .pcell column. */
.pcell{min-width:0}
/* THE BOUND FIGURE (doc 28; comp 2a/4d). Round 1 drew it as a tinted, bolded, dotted-underlined chip. Round 2
 * makes it an UNDERLINE and nothing else: a fill behind running text is reserved for "this span is changing"
 * (the diff spans and the changing table cell), so a document at rest reads like paper rather than a
 * highlighter test. The underline colour is deliberately lighter than the indigo base so 16px prose stays
 * readable while the binding is still unmistakable. Clicking one peeks its source. */
.bound{text-decoration:underline;text-decoration-color:${INDIGO.underline};text-underline-offset:3px;text-decoration-thickness:2px;cursor:pointer}
.bound:hover{text-decoration-color:${INDIGO.base}}
/* The ONE case where a figure carries a fill: the figure whose source drawer is open. The underline goes to
 * the indigo base and the tint arrives behind it, so while the drawer is up the reader can see at a glance
 * which figure the cell below belongs to. Cleared again the moment the drawer closes. */
.bound.focused{text-decoration-color:${INDIGO.base};background:${INDIGO.tint};border-radius:3px;padding:0 2px}
/* The keyboard route to the provenance drawer (#254): a tabbed-to bound figure shows a clear focus ring so a
 * keyboard user can see which figure Enter/Space will trace. */
.bound:focus-visible{outline:2px solid ${INDIGO.base};outline-offset:1px;border-radius:3px}
/* A [[wikilink]] chip (plan 52 WP-C, decision 179). Deliberately a DIFFERENT visual family from .bound: a
 * bound figure is live DATA traced to a source (an indigo underline, no fill); a wikilink is NAVIGATION to
 * another document (a quiet tinted chip), so the two are never confused mid-read. */
.wikilink{background:${INDIGO.tint};color:${INDIGO.base};border-bottom:1px solid ${INDIGO.tintBorder};border-radius:3px;padding:0 3px;cursor:pointer}
.wikilink:hover{background:${INDIGO.tintBorder};border-bottom-color:${INDIGO.base}}
.wikilink:focus-visible{outline:2px solid ${INDIGO.base};outline-offset:1px}
/* An UNRESOLVED link - no document of that name exists yet. It must read as different at a glance, not merely
 * on hover, so the reader knows the link is a promise rather than a destination: the warm attention family,
 * a dashed underline, and a trailing dot standing in for "not there yet". Clicking creates it (Obsidian). */
.wikilink.unresolved{background:${AMBER.bg};color:${AMBER.label};border-bottom:1px dashed ${AMBER.border}}
.wikilink.unresolved:hover{background:${AMBER.bg};border-bottom-color:${AMBER.label}}
.wikilink.unresolved::after{content:"\\00b7";margin-left:3px;font-weight:600;color:${AMBER.base}}
/* The caret-anchored [[ picker: fixed to the webview viewport (measured from PM's coordsAtPos), capped in
 * height, quiet enough to read as a suggestion rather than a dialog. */
.lwd-wikipicker{position:fixed;z-index:90;min-width:260px;max-width:360px;background:${PAPER.card};border:1px solid ${HAIRLINE.strong};border-radius:${RADIUS.input};box-shadow:${SHADOW.dialog};padding:5px}
.lwd-wikipicker .wp-head{padding:6px 9px 5px;font:${TYPE.sectionLabel};letter-spacing:${TRACKING.sectionLabel};text-transform:uppercase;color:${INK.meta}}
.lwd-wikipicker .wp-list{max-height:238px;overflow-y:auto}
.lwd-wikipicker .wp-item{display:flex;align-items:center;gap:8px;width:100%;text-align:left;border:none;background:none;border-radius:${RADIUS.control};padding:7px 9px;font:${TYPE.uiBody};color:${INK.body};cursor:pointer}
.lwd-wikipicker .wp-item:hover{background:${PAPER.sunken}}
.lwd-wikipicker .wp-item.sel{background:${INDIGO.tint};color:${INDIGO.base}}
.lwd-wikipicker .wp-glyph{flex:none;width:16px;font:400 11px/1 ${FONT.mono};color:${INK.meta}}
.lwd-wikipicker .wp-item.sel .wp-glyph{color:${INDIGO.base}}
.lwd-wikipicker .wp-name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
/* The "create this document" row uses the same warm vocabulary as the unresolved chip, so they read as one idea. */
.lwd-wikipicker .wp-item.wp-new .wp-glyph{color:${AMBER.base}}
.lwd-wikipicker .wp-item.wp-new.sel{background:${AMBER.bg};color:${AMBER.label}}
/* The applied-flash keyframe, reused by the PM provenance gutter's recently-APPLIED marker. Green, because
 * that is what the hue means in round 2 (applied / fresh / all clear) - the value has landed, it is not
 * waiting on anyone. The 8-digit hex is the token plus an alpha byte, so the fade cannot drift from GREEN. */
@keyframes flash{0%{background:${GREEN.base}57}100%{background:${GREEN.base}17}}
/* THE DECISION CARD (comp 2a) - the single most important surface in the product, the moment a human decides.
 * A white card lifted off the page by one soft shadow, with the change's KIND painted on a 3px left edge
 * (amber = a human decision is outstanding). Its children, in order: the kind badge + provenance atom, the
 * changed paragraph with word-grain diff spans, the model's reason, then the one button row. The 13px gap is
 * the card's only vertical rhythm - the children carry no margins of their own. */
.editblock{background:${PAPER.card};border-left:3px solid ${AMBER.base};border-radius:6px;box-shadow:${SHADOW.card};padding:20px 24px;display:flex;flex-direction:column;gap:13px}
.editp{margin:0;font:${TYPE.docBody};color:${INK.body}}
/* Word-diff spans (doc 28). The only fill that ever sits behind running prose, and it always means exactly
 * one thing: this span is changing. Leaving = the removed family, struck through; arriving = the applied
 * family. Same shape for both, so the eye reads the colour rather than the geometry. */
.d-o{background:${RED.diffBg};color:${RED.diffInk};text-decoration:line-through;border-radius:3px;padding:0 2px}
.d-n{background:${GREEN.diffBg};color:${GREEN.diffInk};border-radius:3px;padding:0 2px}
/* A generative insertion proposed by Chat wears the same card as a meaning change - it is equally a decision
 * waiting on you, so it takes the same amber edge. Its BODY carries the green "arriving" fill, which is the
 * diff rule applied to a whole block instead of a run of words. */
.insertblock{background:${PAPER.card};border-left:3px solid ${AMBER.base};border-radius:6px;box-shadow:${SHADOW.card};padding:20px 24px;display:flex;flex-direction:column;gap:13px}
.insertbody{background:${GREEN.blockBg};border:1px solid ${GREEN.border};border-radius:${RADIUS.control};padding:6px 14px;margin:0}
.insertbody>:first-child{margin-top:6px}.insertbody>:last-child{margin-bottom:6px}
.cdot.add{background:${GREEN.base}}
/* The button row: a hairline rule, then one indigo primary and two hairline secondaries, with the meta line
 * pushed right. Confidence is a WORD there, never a percentage (doc 28) - a number invites arithmetic on a
 * judgement the model cannot actually quantify. */
.ctrl{display:flex;align-items:center;gap:8px;border-top:1px solid ${HAIRLINE.soft};padding-top:13px;flex-wrap:wrap}
.ctrl .cdot{width:7px;height:7px;border-radius:${RADIUS.pill};background:${AMBER.base};flex:none}
.ctrl .lbl{font:${TYPE.secondary};color:${INK.secondary}}
.ctrl .src{font-family:${FONT.mono};color:${INDIGO.base}}
.ctrl .add{color:${GREEN.diffInk}}.ctrl .rem{color:${RED.diffInk}}
.ctrl .acts{display:flex;align-items:center;gap:8px}
.ctrl .conf{margin-left:auto;font:400 12px/1.4 ${FONT.sans};color:${INK.meta}}
.ctrl .approve{border:none;border-radius:${RADIUS.control};padding:7px 20px;background:${INDIGO.base};color:${PAPER.card};font:${TYPE.uiBodyStrong};cursor:pointer}
.ctrl .approve:hover{background:${INDIGO.hover}}
/* Reject and Edit are hairline secondaries on white, NOT a red ghost: red means removed/failed, never
 * decoration, so it may not colour a control the reader has merely hovered. */
.ctrl .reject,.ctrl .tweak{border:1px solid ${PAPER.control};border-radius:${RADIUS.control};padding:7px 16px;background:${PAPER.card};color:${INK.body};font:${TYPE.uiBody};cursor:pointer}
.ctrl .reject:hover,.ctrl .tweak:hover{background:${PAPER.sunken}}
/* A PENDING PARAGRAPH THAT IS NOT THE FOCUSED DECISION (comp 2b). At two or more pending changes the page
 * would be shredded if every one of them opened a full card, so only the focused change is a card; the rest
 * keep the document readable - the paragraph stays legible (dimmed one ink step), marked by the same 3px
 * amber edge, with a mono label naming what is waiting and one link that opens the card in place. */
.editblock.quiet,.insertblock.quiet{background:none;box-shadow:none;border-radius:4px;padding:4px 0 4px 20px;gap:6px}
.pendmark{display:none;flex-direction:column;gap:6px}
.editblock.quiet .pendmark,.insertblock.quiet .pendmark{display:flex}
.editblock.quiet .editcard,.insertblock.quiet .editcard{display:none}
.pendmark .pw-text{margin:0;font:400 16px/1.7 ${FONT.sans};color:${INK.secondary}}
.pendmark .pw-row{display:flex;align-items:center;gap:8px}
.pendmark .pw-lab{font:400 10px/1 ${FONT.mono};letter-spacing:${TRACKING.kindBadge};text-transform:uppercase;color:${AMBER.label}}
.pendmark .pw-open{border:none;background:none;padding:0;font:400 12px/1.4 ${FONT.sans};color:${INDIGO.base};cursor:pointer}
.pendmark .pw-open:hover{color:${INDIGO.hover};text-decoration:underline}
.editcard{display:flex;flex-direction:column;gap:13px}
table.kpi{flex:1;border:1px solid ${HAIRLINE.strong};border-radius:${RADIUS.input};border-collapse:separate;border-spacing:0;overflow:hidden;font:${TYPE.uiBody};margin-bottom:22px}
table.kpi th{background:${PAPER.sunken};font:600 13px/1.45 ${FONT.sans};color:${INK.bodySoft};text-align:right;padding:10px 14px}
table.kpi th:first-child{text-align:left}
table.kpi td{border-top:1px solid ${HAIRLINE.medium};padding:10px 14px;text-align:right}
table.kpi td:first-child{text-align:left;font-weight:600}
.up{color:${GREEN.base}}.down{color:${RED.base}}
.empty{padding:60px;color:${INK.meta};text-align:center;font:${TYPE.uiBody}}
/* The helper line under the figures table (comp 2a): it names the binding in plain words, with the source
 * file in mono because a file name is a provenance fact. */
.hint{max-width:720px;margin:0 auto;padding:0 40px 30px;font:400 12px/1.6 ${FONT.sans};color:${INK.meta}}
.hint .hint-src{font:400 11.5px/1.6 ${FONT.mono}}
.toggle{border:1px solid ${PAPER.control};border-radius:${RADIUS.control};padding:7px 12px;background:${PAPER.card};color:${INK.body};font:${TYPE.uiBodyStrong};cursor:pointer}
.toggle:hover{background:${PAPER.sunken}}
/* Persistent calm formatting toolbar (the comp's "Workbench v2" word-processor toolbar - formatting
 * essentials only): borderless heading dropdown + B/I/U + list/ordered/quote, with a quiet "Saved" status
 * on the right. Sticks just below the 48px top bar. No Link-to-source / Run-skill / History (the comp
 * dropped them to keep the editor calm). */
.etoolbar{position:sticky;top:0;z-index:4;height:46px;flex:none;display:flex;align-items:center;gap:2px;padding:0 16px;border-bottom:1px solid ${HAIRLINE.medium};background:${PAPER.page}}
.etoolbar select.tb-h{border:none;background:transparent;border-radius:${RADIUS.control};padding:7px 24px 7px 9px;font:${TYPE.uiBody};color:${INK.body};cursor:pointer}
.etoolbar select.tb-h:hover{background:${PAPER.sunken}}
.etoolbar .tb-div{width:1px;height:18px;background:${HAIRLINE.medium};margin:0 8px}
.etoolbar .tb-b{width:30px;height:30px;border:none;background:transparent;border-radius:${RADIUS.control};color:${INK.bodySoft};cursor:pointer}
.etoolbar .tb-b:hover{background:${PAPER.sunken}}
.etoolbar .tb-b.bold{font:600 13px/1 ${FONT.sans}}
.etoolbar .tb-b.ital{font:400 13px/1 ${FONT.sans};font-style:italic}
.etoolbar .tb-b.ic{font:400 14px/1 ${FONT.sans}}
/* The toolbar right-side group (plan 45 pin 8): Ask AI, Properties and the Saved chip, pushed right as one unit. */
.etoolbar .tb-right{margin-left:auto;display:flex;align-items:center;gap:8px}
/* Ask AI is Abstract acting, so it is the one indigo thing in the toolbar; Properties is a neutral control. */
.etoolbar .tb-ai{display:flex;align-items:center;gap:5px;height:30px;padding:0 11px;border:none;border-radius:${RADIUS.control};background:transparent;color:${INDIGO.base};font:${TYPE.secondary};cursor:pointer}
.etoolbar .tb-ai:hover{background:${INDIGO.tint}}
/* Properties button (P8.2): list glyph + label, 30px, radius 8; active state is the indigo tint. */
.etoolbar .tb-props{display:flex;align-items:center;gap:6px;height:30px;padding:0 11px;border:none;border-radius:${RADIUS.control};background:transparent;color:${INK.bodySoft};font:${TYPE.secondary};cursor:pointer}
.etoolbar .tb-props:hover{background:${PAPER.sunken}}
.etoolbar .tb-props.on{background:${INDIGO.tint};color:${INDIGO.base}}
.etoolbar .tb-props-glyph{font:400 13px/1 ${FONT.sans}}
.etoolbar .tb-saved{display:flex;align-items:center;gap:7px;font:400 11px/1 ${FONT.mono};color:${INK.meta}}
.etoolbar .tb-saved .sdot{width:6px;height:6px;border-radius:${RADIUS.pill};background:${GREEN.base}}
/* Web dev-harness save chip (issue #121 / decision 162): an amber, plain-words notice that writes are
 * in-memory only and lost on reload, so the web build never masquerades as a durable "Saved" state. */
.etoolbar .tb-saved.tb-ephemeral{color:${AMBER.label};cursor:help}
/* THE STICKY BULK REVIEW BAR (comp 2b). It earns its place only at two or more pending changes in this
 * document: at n=1 there is nothing to do in bulk, and a bar offering "approve all" over a single change is
 * just a second way to press the card's own Approve (comp 2a deliberately has no bar at all). It sticks under
 * the formatting toolbar (top:0, h46) at top:46px, spans the full document width, and states the count in
 * plain words in the amber that means "waiting on you". When the last change is approved the bar simply
 * disappears - that disappearance is the "done" signal, not a persistent status pill. */
.reviewbar{position:sticky;top:46px;z-index:5;display:flex;align-items:center;gap:12px;padding:11px 40px;border-bottom:1px solid ${AMBER.border};background:${AMBER.subtleBg}}
/* When this document is clear but the review is not finished, the same bar turns the all-clear green. */
.reviewbar.clear{border-bottom-color:${GREEN.border};background:${GREEN.bg}}
.reviewbar .rv-dot{flex:none;width:8px;height:8px;border-radius:${RADIUS.pill};background:${AMBER.base}}
.reviewbar .rv-say{font:400 13.5px/1.45 ${FONT.sans};color:${AMBER.headline}}
.reviewbar .rv-say strong{font-weight:600}
.reviewbar .rv-spacer{flex:1}
.reviewbar .rv-btn{border:1px solid ${PAPER.control};border-radius:${RADIUS.control};padding:6px 14px;background:${PAPER.card};color:${INK.body};font:${TYPE.uiBodyStrong};cursor:pointer;max-width:240px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.reviewbar .rv-btn:hover{background:${PAPER.sunken}}
/* A bulk verb renders QUIET (text) plus a confirm dialog - never a filled button, and never green or red.
 * The weight of "approve four changes at once" belongs in the confirm, not in a button begging to be hit. */
.reviewbar .rv-quiet{border:none;background:none;border-radius:${RADIUS.control};padding:6px 10px;font:${TYPE.secondary};color:${INK.secondary};cursor:pointer}
.reviewbar .rv-quiet:hover{color:${INK.body};text-decoration:underline}
.reviewbar .rv-clear{display:flex;align-items:center;gap:8px;font:${TYPE.uiBody};color:${GREEN.headline}}
.reviewbar .rv-tick{width:15px;height:15px;border-radius:${RADIUS.pill};background:${GREEN.base};color:${PAPER.card};display:flex;align-items:center;justify-content:center;font:600 9px/1 ${FONT.sans}}
.hint-raw{border:none;background:none;padding:0;margin-left:5px;color:${INDIGO.base};font:400 12px/1.6 ${FONT.sans};cursor:pointer;text-decoration:underline}
.hint-raw:hover{color:${INDIGO.hover}}
/* Source-peek / Sync-across banner: full-bleed under the toolbar in the same grammar as the review bar (a
 * state colour, a sentence, one hairline control), so the document never grows a second banner vocabulary. */
.syncbar{display:flex;align-items:center;gap:8px;padding:11px 40px;border-bottom:1px solid ${AMBER.border};background:${AMBER.subtleBg};font:400 13px/1.45 ${FONT.sans};color:${AMBER.headline}}
.syncbar.done{border-bottom-color:${GREEN.border};background:${GREEN.bg};color:${GREEN.headline}}
.syncbar .sb-spacer{flex:1}
.syncbar .sb-btn{border:1px solid ${PAPER.control};border-radius:${RADIUS.control};padding:6px 14px;background:${PAPER.card};color:${INK.body};font:${TYPE.uiBodyStrong};cursor:pointer}
.syncbar .sb-btn:hover{background:${PAPER.sunken}}
.syncbar .sb-diff{font:${TYPE.provenance}}
/* In-surface source drawer (the comp's "Workbench v2" bottom overlay): slides up over the bottom of the
 * doc, full-width, so the document is NEVER split into a side-by-side pane. The sync action is the drawer
 * header's primary button (no floating divider circle). Fixed to the webview viewport so it overlays. */
/* THE SOURCE DRAWER (comp 4d) - the far end of the provenance wedge. It rises from the bottom edge of the
 * document (never a second editor group, never a side-by-side split), so the sentence the reader clicked
 * from stays on screen above it. White, rounded at the top only, lifted by the one upward shadow. */
.srcdrawer{position:fixed;left:0;right:0;bottom:0;height:52%;z-index:25;display:flex;flex-direction:column;background:${PAPER.card};border-top:1px solid ${HAIRLINE.strong};border-radius:${RADIUS.cardLarge} ${RADIUS.cardLarge} 0 0;box-shadow:${SHADOW.drawer}}
.srcdrawer .sd-grip{flex:none;display:flex;justify-content:center;padding:7px 0 0}
.srcdrawer .sd-grip span{width:34px;height:4px;border-radius:${RADIUS.pill};background:${PAPER.control}}
.srcdrawer .sd-head{flex:none;display:flex;align-items:center;gap:12px;padding:14px 32px;border-bottom:1px solid ${HAIRLINE.soft}}
.srcdrawer .sd-name{font:600 12.5px/1.3 ${FONT.mono};color:${INK.heading};flex:none}
.srcdrawer .sd-meta{font:400 12px/1.3 ${FONT.sans};color:${INK.meta};min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
/* Freshness in the ONE vocabulary (sourceFreshness.ts): a 6px dot plus the same relative words the hover
 * peek and the Knowledge table use, so no two surfaces can ever disagree about how fresh a source is. */
.srcdrawer .sd-fresh{display:flex;align-items:center;gap:5px;flex:none;font:400 12px/1.3 ${FONT.sans}}
.srcdrawer .sd-fresh .sd-dot{width:6px;height:6px;border-radius:${RADIUS.pill};background:currentColor;flex:none}
.srcdrawer .sd-actions{flex:none;margin-left:auto;display:flex;align-items:center;gap:8px}
/* Sync is a hairline secondary, not a filled primary: the drawer is a place to READ provenance, and the one
 * filled button in the document belongs to the decision card. */
.srcdrawer .sd-sync{display:flex;align-items:center;gap:6px;border:1px solid ${PAPER.control};border-radius:${RADIUS.control};padding:6px 14px;background:${PAPER.card};color:${INK.body};font:${TYPE.uiBodyStrong};cursor:pointer;white-space:nowrap}
.srcdrawer .sd-sync:hover{background:${PAPER.sunken}}
.srcdrawer .sd-synced{display:flex;align-items:center;gap:6px;border:1px solid ${GREEN.border};background:${GREEN.bg};border-radius:${RADIUS.control};padding:6px 14px;font:${TYPE.uiBodyStrong};color:${GREEN.base};white-space:nowrap}
.srcdrawer .sd-x{border:none;background:none;color:${INK.meta};font-size:14px;cursor:pointer;padding:4px 6px}
.srcdrawer .sd-x:hover{color:${INK.body}}
/* The body is the comp's two-column split: the source's own grid on the left (wider, it is the evidence),
 * what that row feeds on the right, divided by one soft hairline. */
.srcdrawer .sd-body{flex:1;overflow:auto;display:grid;grid-template-columns:1.6fr 1fr}
.srcdrawer .sd-left{padding:18px 32px;border-right:1px solid ${HAIRLINE.soft};min-width:0}
.srcdrawer .sd-right{padding:18px 28px;min-width:0}
.srcdrawer table{width:100%;border-collapse:collapse;font:400 13px/1.5 ${FONT.sans}}
.srcdrawer th{text-align:left;padding:0 8px 8px;font:400 10.5px/1.3 ${FONT.mono};letter-spacing:.08em;text-transform:uppercase;color:${INK.meta};border-bottom:1px solid ${HAIRLINE.soft}}
.srcdrawer td{padding:8px;border-bottom:1px solid ${PAPER.sunken};color:${INK.secondary}}
/* THE CITED ROW - the whole point of the wedge. The row the document quotes is lifted onto the indigo tint
 * with heading ink, and the ONE cell that feeds the figure the reader clicked carries the indigo underline,
 * so "where did this number come from" is answered by pointing, not by prose. */
.srcdrawer tr.sel td{background:${INDIGO.tint};color:${INK.heading};font-weight:600;border-bottom-color:transparent}
.srcdrawer tr.sel td:first-child{border-radius:${RADIUS.control} 0 0 ${RADIUS.control}}
.srcdrawer tr.sel td:last-child{border-radius:0 ${RADIUS.control} ${RADIUS.control} 0}
.srcdrawer .sp-cite{text-decoration:underline;text-decoration-color:${INDIGO.base};text-underline-offset:3px;text-decoration-thickness:2px}
.srcdrawer .sp-caption{font:400 11.5px/1.5 ${FONT.sans};color:${INK.meta};padding-top:10px}
/* A section label in the drawer: mono 10, tracked .12em, in meta ink. Deliberately NOT text-transformed -
 * a section label is written in capitals in the copy, but a source's file name that lands here must keep its
 * own case (metrics.csv, not METRICS.CSV). */
.srcdrawer .sp-sec{font:400 10px/1.3 ${FONT.mono};letter-spacing:.12em;color:${INK.meta};margin:0 0 12px}
.srcdrawer .sp-sec:not(:first-child){margin-top:16px}
.srcdrawer table.sp-grid td,.srcdrawer table.sp-grid th{white-space:nowrap}
.srcdrawer .sp-refs{margin-top:16px}
.srcdrawer .sp-refs-h{font:400 10px/1.3 ${FONT.mono};letter-spacing:.12em;color:${INK.meta};margin-bottom:10px}
/* api/mcp raw response payload (plan 29 iter 4): the actual JSON / tool result, with the extracted field
 * highlighted, so non-file provenance shows the real payload instead of a pretend CSV. */
.srcdrawer .sp-payload{margin:0 0 8px;padding:12px 14px;background:${PAPER.sunken};border:1px solid ${PAPER.sunkenBorder};border-radius:${RADIUS.control};font:400 11.5px/1.6 ${FONT.mono};color:${INK.body};white-space:pre-wrap;word-break:break-word;overflow:auto;max-height:220px}
.srcdrawer .sp-field{background:${AMBER.bg};box-shadow:inset 0 -1px 0 ${AMBER.base};border-radius:3px;padding:0 2px;font-weight:600;color:${AMBER.label}}
.srcdrawer .sp-ref{display:flex;align-items:center;gap:7px;font:${TYPE.secondary};color:${INK.body}}
.srcdrawer .sp-drift{margin:0 0 8px;font:400 11.5px/1.5 ${FONT.sans};color:${AMBER.label}}
/* CHANGED state (drift) keeps its own truthful cream. When a row is BOTH cited and changed, the changed
 * background wins (two fills would clash) - the row then reads as "cited AND drifted", with the then->now
 * amber cell inside it saying which way. */
.srcdrawer tr.changed td,.srcdrawer tr.sel.changed td{background:${AMBER.subtleBg}}
.srcdrawer .sp-then{color:${INK.meta};text-decoration:line-through}
.srcdrawer .sp-arrow{color:${INK.meta};padding:0 2px}
.srcdrawer .sp-now{color:${AMBER.label};font-weight:600}
/* The bound-figure list on the right reads as key -> value lines, not a grid: the key is a provenance fact
 * (mono), the value is prose, and the location is meta. */
.srcdrawer table.sp-figs td{border-bottom:none;padding:3px 0}
.srcdrawer table.sp-figs td:first-child{font-family:${FONT.mono};font-size:11.5px;width:1%;white-space:nowrap;padding-right:10px}
.srcdrawer table.sp-figs td:last-child{color:${INK.body};font-size:12.5px}
/* UNREACHABLE state (the staleness-escape guardrail, docs/20 journey 1p): an api/mcp source that could not be
 * read at all has no live value to compare, so the row keeps its last-synced reading but is marked in the
 * STALE family from the one freshness vocabulary - the same cream field, amber dot and stale text the
 * Knowledge table uses - never a fourth colour, and never presented as the source's current answer. */
.srcdrawer tr.unreached td,.srcdrawer tr.sel.unreached td{background:${FRESHNESS_COLOURS.staleRowBg}}
.srcdrawer .sp-unreach{margin:0 0 8px;font:400 11.5px/1.5 ${FONT.sans};color:${FRESHNESS_COLOURS.staleText}}
.srcdrawer .sp-unreach-tag{display:inline-flex;align-items:center;gap:5px;margin-left:8px;font:400 11.5px/1.5 ${FONT.sans};color:${FRESHNESS_COLOURS.staleText}}
.srcdrawer .sp-unreach-tag::before{content:"";width:6px;height:6px;border-radius:${RADIUS.pill};background:${FRESHNESS_COLOURS.staleDot};flex:none}
/* The reading column. Document body is the 16/1.65 step (doc 28) and the heading ladder steps 28 -> 21 -> 18
 * -> 16, all at 600 - there is no weight 500 anywhere in round 2. */
.prose{max-width:720px;margin:0 auto;padding:24px 40px 80px;font:${TYPE.docBody};color:${INK.body}}
.prose h1{font:${TYPE.screenTitle};letter-spacing:${TRACKING.screenTitle};color:${INK.heading};margin:24px 0 12px}
.prose h2{font:${TYPE.docHeading};color:${INK.heading};margin:26px 0 10px}
.prose h3{font:600 18px/1.35 ${FONT.sans};color:${INK.heading};margin:22px 0 8px}
.prose h4,.prose h5,.prose h6{font:600 16px/1.4 ${FONT.sans};color:${INK.body};margin:18px 0 6px}
.prose p{margin:0 0 14px}
.prose ul,.prose ol{margin:0 0 14px;padding-left:26px}
.prose li{margin:3px 0}
.prose a{color:${INDIGO.base};text-decoration:none}
.prose a:hover{text-decoration:underline}
.prose code{font:400 13px/1.5 ${FONT.mono};background:${PAPER.chip};border-radius:4px;padding:1px 5px}
.prose pre{background:${PAPER.sunken};border:1px solid ${PAPER.sunkenBorder};border-radius:${RADIUS.control};padding:14px 16px;overflow:auto;margin:0 0 14px}
.prose pre code{background:none;padding:0}
/* (issue #180) background:transparent neutralises the webview host's default blockquote style: its
 * _defaultStyles block (vs/workbench/contrib/webview/browser/pre/index.html) paints
 * blockquote background var(--vscode-textBlockQuote-background) in the @layer vscode-default cascade
 * layer. Our unlayered .prose rule already wins for border/colour, but never set a background, so a
 * dark theme's grey block-quote fill showed through. Pinning it transparent makes the design-system
 * block quote (a quiet left rule, no fill) theme-independent - correct even if a future theme leaks. */
.prose blockquote{margin:0 0 14px;padding:2px 16px;border-left:3px solid ${HAIRLINE.strong};color:${INK.secondary};background:transparent}
/* The figures table (comp 2a): a hairline-bordered card with a sunken header row, rows separated by the
 * medium hairline, and generous 9px/16px cells - the same table the comp draws around bound figures. */
.prose table{border-collapse:separate;border-spacing:0;margin:0 0 14px;width:100%;border:1px solid ${HAIRLINE.strong};border-radius:${RADIUS.input};overflow:hidden;font:400 14.5px/1.45 ${FONT.sans}}
.prose th{background:${PAPER.sunken};font:600 13px/1.45 ${FONT.sans};color:${INK.bodySoft};padding:9px 16px;text-align:left}
.prose td{border-top:1px solid ${HAIRLINE.medium};padding:9px 16px;text-align:left}
.prose img{max-width:100%}
/* A relative image the host could not read (issue #141): a visible broken state, never a silent gap. The
 * <img> keeps its (unresolvable) relative src so its title carries "image not found: <path>" on hover. */
.prose img.lwd-img-broken{min-width:120px;min-height:42px;outline:1px dashed ${RED.diffInk};outline-offset:-1px;background:${RED.blockBg};border-radius:4px}
/* Plain-Markdown ProseMirror editor (F2): the document IS the writing surface (reuses .prose type).
 * Layout (plan 45 pin 9, revises plan 21 / C2 - decision 168): a flex row that centres a reading group of
 * [70px numbered gutter][720px reading column]. The gutter is a real reserved column (via the prose column's
 * 70px left padding) so the line numbers live to the LEFT of the prose and the prose NEVER shifts when the
 * numbers or their provenance tone change. The .prose element is content-box with max-width:720px (the
 * reading text) + padding-left:70px (the reserved gutter lane), giving a total element width of 790px.
 * PROSE-NEVER-SHIFTS (P9.1): widening the lane 30px->70px added 40px to the element; the extra lane must NOT
 * push the reading text. A translateX(-18px) on .prose pulls the whole reading group left by ~half the added
 * width so the TEXT column's centre stays exactly where the 30px-lane baseline put it (measured: text left
 * edge 207.75px, text right edge 896.25px at 1440x900). The gutter travels with it, so numbers stay glued to
 * the text edge.
 * Edge-to-edge chrome (issue #175): the 32px/40px wrapper padding is scoped to .pmwrap so it insets ONLY
 * the prose column. The top bar and formatting toolbar are rendered as SIBLINGS of .pmwrap (see the html
 * assembly in renderLivingDocContent), so their page-paper backgrounds and hairline borders run
 * rail-to-rail with no white gutter, while the reading column stays centred. Do NOT move the bars inside
 * .pmwrap or they inherit this padding and lose the full-bleed edges. This only reaches the rails because the
 * html,body rule above resets the webview harness's body padding (0 20px) - without that reset the harness
 * inset survives and pushes every bar ~20px off each rail. */
.pmwrap{display:flex;justify-content:center;padding:32px 40px 90px}
/* THE READING COLUMN IS A LANE, NOT A SHRINK-WRAP (#320). It is a flex item, so flex:0 1 auto sized it
 * from its CONTENT: a brand-new blank document has none, so the column - and the .ProseMirror mount inside
 * it - computed to 0px wide, leaving nothing to click into and nowhere for a caret to go. A flex-grow of 1
 * makes the column claim the lane it is designed to be (max-width 720px of reading text beside the 70px
 * gutter) whether the document holds a chapter, one word, or nothing at all; flex-shrink keeps it giving
 * way on a narrow pane. The measure is therefore a property of the surface, not of what has been typed
 * into it, which is also why the first line of a new document lands exactly where every later line will. */
.pmwrap .prose{flex:1 1 auto;max-width:720px;margin:0;padding-left:70px;padding-right:0;box-sizing:content-box;position:relative;transform:translateX(-18px)}
.pmwrap .ProseMirror{outline:none;min-height:60vh;white-space:pre-wrap;word-wrap:break-word;-webkit-font-smoothing:antialiased}
.pmwrap .ProseMirror:focus{outline:none}
.pmwrap .ProseMirror p.is-editor-empty:first-child::before{color:${INK.meta};content:attr(data-placeholder);float:left;pointer-events:none;height:0}
.rawwrap{max-width:860px;margin:0 auto;padding:20px 40px 60px}
textarea.raw{width:100%;min-height:70vh;box-sizing:border-box;border:1px solid ${HAIRLINE.strong};border-radius:${RADIUS.input};padding:18px 20px;resize:vertical;background:${PAPER.page};color:${INK.body};font:400 13px/1.7 ${FONT.mono};tab-size:2}
textarea.raw:focus{outline:none;border-color:${INDIGO.base}}
/* Present & export modal. The scrim is the ink token at ~34% alpha (the 8-digit hex is the token plus an
 * alpha byte), so the modal can never drift to a different black from the rest of the product. */
.pm-overlay{position:fixed;inset:0;z-index:60;background:${DARK_SURFACE}57;display:flex;align-items:center;justify-content:center;padding:32px}
.pm-card{width:740px;max-width:100%;max-height:100%;background:${PAPER.card};border-radius:${RADIUS.cardLarge};box-shadow:${SHADOW.dialog};overflow:hidden;display:flex;flex-direction:column}
.pm-head{flex:none;display:flex;align-items:center;gap:11px;padding:18px 22px;border-bottom:1px solid ${HAIRLINE.medium}}
.pm-title{margin:0 0 3px;font:600 16px/1.2 ${FONT.sans};color:${INK.heading}}
.pm-sub{font:${TYPE.provenance};color:${INK.meta}}
.pm-x{margin-left:auto;border:none;background:none;color:${INK.meta};font-size:18px;cursor:pointer;padding:4px 8px}
.pm-body{flex:1;display:flex;min-height:0}
.pm-list{width:300px;flex:none;border-right:1px solid ${HAIRLINE.medium};background:${PAPER.rail};overflow-y:auto;padding:14px}
.pm-detail{flex:1;min-width:0;overflow-y:auto;padding:22px}
.pmwrap .ProseMirror span.bound{cursor:pointer}
/* Numbered gutter (plan 45 pin 9; revises plan 21 / C2, decision 168). Each top-level block gets a
 * ProseMirror node decoration carrying its 1-based line number in data-lwd-num; the number paints into the
 * 70px gutter lane reserved by .prose's 70px left padding (so the prose never shifts). Numbers are mono
 * 11px, right-aligned, their right edge 22px from the text edge, idle colour the frame border. Only
 * the block's FIRST visual row carries a number: the ::before is absolutely positioned at top:.62em so a
 * wrapped paragraph shows one number and a blank gutter on rows 2-3 (D1 wrap rule, P9.4). Provenance rides
 * the number: a bound block's number turns indigo/600 with a 9px dot to its left; a pending-edit block's
 * number turns amber with a 3px amber bar spanning its rows. Idle numbers are inert; hovering a
 * bound/pending number opens the source-peek drawer (wired in the RUNTIME). */
.pmwrap .ProseMirror .pm-num{position:relative}
.pmwrap .ProseMirror .pm-num::before{content:attr(data-lwd-num);position:absolute;top:.62em;right:calc(100% + 22px);width:34px;text-align:right;font:400 11px/1 ${FONT.mono};color:${PAPER.frameBorder};white-space:nowrap;pointer-events:none;-webkit-font-smoothing:antialiased}
/* A source-bound block: indigo number (600) with a 9px indigo dot to its left. The dot sits in the gutter
 * lane just left of the number's left edge; the number becomes hover-live to open the source-peek drawer. */
.pmwrap .ProseMirror .pm-num.bound::before{color:${INDIGO.base};font-weight:600;pointer-events:auto;cursor:pointer}
.pmwrap .ProseMirror .pm-num.bound::after{content:"";position:absolute;top:.62em;right:calc(100% + 60px);width:9px;height:9px;border-radius:${RADIUS.pill};background:${INDIGO.base}}
/* Recently APPLIED (not pending): green, the hue that means the value has landed and is fresh. */
.pmwrap .ProseMirror .pm-num.bound.recent::after{background:${GREEN.base};box-shadow:0 0 0 4px ${GREEN.base}24;animation:flash 1.6s ease}
/* A pending-edit block: the amber that means "waiting on you", plus a 3px amber bar spanning exactly its
 * rows. The number is hover-live (opens the source-peek for its binds when it has any). */
.pmwrap .ProseMirror .pm-num.pending::before{color:${AMBER.label};font-weight:600;pointer-events:auto;cursor:pointer}
.pmwrap .ProseMirror .pm-num.pending::after{content:"";position:absolute;top:2px;bottom:2px;right:calc(100% + 15px);width:3px;border-radius:${RADIUS.pill};background:${AMBER.base}}
/* A multi-line edited paragraph hangs a 3px attention bar in the gutter spanning the diff-text rows only
 * (the .editp), so it does not overspill into the Approve/Reject control row below. The original block node
 * is hidden and replaced by the widget, so the bar rides the visible widget's .editp here. */
.pmwrap .ProseMirror .pm-edit-bar .editp{position:relative}
.pmwrap .ProseMirror .pm-edit-bar .editp::before{content:"";position:absolute;left:-18px;top:2px;bottom:2px;width:3px;border-radius:${RADIUS.pill};background:${AMBER.base};cursor:pointer}
/* A block with a pending meaning-change is hidden; the diff + accept/reject widget renders in its place. */
.pmwrap .ProseMirror .pm-orig-hidden{display:none}
/* The diff / insert widgets are host-rendered with the renderDoc markup (.editblock/.insertblock/.ctrl),
 * so they need no new styles; they sit full-width in the PM column. */
.pmwrap .ProseMirror .editblock,.pmwrap .ProseMirror .insertblock{margin:0 0 14px;transition:box-shadow .3s ease,background-color .3s ease}
/* Inline review prominence (plan 19 iter 3): hovering a pending change lifts the whole CARD, so it reads as
 * one actionable unit you can decide while reading, without adding permanent chrome. A quiet (unfocused)
 * pending paragraph is not a card and must not lift - it is meant to stay part of the page. */
.pmwrap .ProseMirror .editblock:not(.quiet):hover,.pmwrap .ProseMirror .insertblock:not(.quiet):hover{box-shadow:${SHADOW.frame}}
/* The card's head row (comp 2a): the mono kind badge on the left, the block's address beside it, and the
 * reusable provenance atom ("from <source> - synced <when>") right-aligned. The kind badge is bare mono in a
 * risk colour, not a pill: a pill would read as a permanent status chip, and round 2 has none of those. */
.pmwrap .ProseMirror .frame{display:flex;flex-wrap:wrap;align-items:center;gap:6px 10px;margin:0;font:400 12px/1.4 ${FONT.sans}}
.pmwrap .ProseMirror .fr-kind{font:${TYPE.kindBadge};letter-spacing:${TRACKING.kindBadge};text-transform:uppercase}
.pmwrap .ProseMirror .fr-kind.attn{color:${AMBER.label}}
.pmwrap .ProseMirror .fr-kind.ok{color:${GREEN.base}}
.pmwrap .ProseMirror .pm-addr{font:${TYPE.kindBadge};color:${INK.meta}}
/* The provenance atom - one line, one shape, on every card and drawer in the product. */
.pmwrap .ProseMirror .fr-prov{margin-left:auto;font:400 12px/1.4 ${FONT.sans};color:${INK.meta}}
.pmwrap .ProseMirror .fr-prov .src{font-family:${FONT.mono};color:${INDIGO.base}}
/* The model's reason, under the diff: "Why: ..." in italic secondary ink, so it reads as an aside to the
 * change rather than as part of the document's prose. */
.pmwrap .ProseMirror .editwhy{margin:0;font:400 13px/1.5 ${FONT.sans};font-style:italic;color:${INK.secondary}}
/* Tweak (plan 31 iter 3): the in-place editor is hidden until Edit is pressed; then the diff hides, the
 * contenteditable shows, and the action row swaps Approve/Reject for Save & approve / Cancel. */
.pmwrap .ProseMirror .tweakwrap{display:none;margin:0}
.pmwrap .ProseMirror .tweakedit{border:1px solid ${AMBER.border};border-radius:${RADIUS.control};padding:8px 11px;font:${TYPE.docBody};color:${INK.body};background:${AMBER.subtleBg};outline:none}
.pmwrap .ProseMirror .tweakacts{display:none}
.pmwrap .ProseMirror .editblock.tweaking .editp{display:none}
.pmwrap .ProseMirror .editblock.tweaking .tweakwrap{display:block}
.pmwrap .ProseMirror .editblock.tweaking .normacts{display:none}
.pmwrap .ProseMirror .editblock.tweaking .tweakacts{display:inline-flex;gap:8px}
/* Rail-to-editor navigation (plan 19 iter 2): the change the rail sent us to gets a brief calm ring +
 * tint so the eye lands on it, then fades - no permanent chrome. */
.pmwrap .ProseMirror .lwd-focus-flash{box-shadow:0 0 0 3px ${AMBER.base}80;background:${AMBER.subtleBg}}
/* Figure/gutter hover provenance tooltip (plan 29 iter 3): a quiet floating card that answers "where from,
 * how fresh" for a bound figure without shifting layout - it is fixed-position and pointer-events:none so it
 * floats over the prose and never intercepts a click (the click still opens the source drawer). */
/* THE HOVER PEEK (comp 4d) - the ONE inverted surface in the product. Everything else is paper; this floats
 * over it, so it is drawn on the ink token and lifted by the tooltip shadow. Three lines: what the figure is
 * (a provenance fact, so mono), how fresh it is and what it was when approved, then the invitation to open
 * the drawer. pointer-events:none so it never intercepts the click that opens that drawer. */
.lwd-tip{position:fixed;z-index:80;max-width:320px;pointer-events:none;background:${DARK_SURFACE};color:${PAPER.card};border-radius:${RADIUS.input};padding:12px 16px;box-shadow:${SHADOW.tooltip};display:flex;flex-direction:column;gap:4px;font:400 12px/1.5 ${FONT.sans};opacity:0;transition:opacity .1s ease}
.lwd-tip.show{opacity:1}
.lwd-tip .tip-src{font:600 12px/1.4 ${FONT.mono};color:${PAPER.card};word-break:break-all}
.lwd-tip .tip-meta{color:${INK.onDark}}
.lwd-tip .tip-cta{font:400 11.5px/1.4 ${FONT.sans};color:${INDIGO.onDark}}
.lwd-tip .tip-stale{display:flex;align-items:center;gap:6px;color:${AMBER.base};font-weight:600}
.lwd-tip .tip-stale::before{content:"";width:6px;height:6px;border-radius:${RADIUS.pill};background:${AMBER.base};flex:none}
/* Then-vs-now peek (#122 F13): the value at bind time struck through, an arrow, and the source's live value in
 * warm amber - the same then/now grammar the source drawer uses, so hover and drawer read identically. */
.lwd-tip .tip-then{padding-top:6px;border-top:1px solid ${INK.body};font:400 11.5px/1.5 ${FONT.mono}}
.lwd-tip .tn-lab{font-size:9.5px;letter-spacing:${TRACKING.kindBadge};text-transform:uppercase;color:${INK.meta}}
.lwd-tip .tn-then{color:${INK.onDark};text-decoration:line-through}
.lwd-tip .tn-arrow{color:${INK.meta};padding:0 1px}
.lwd-tip .tn-now{color:${AMBER.base};font-weight:600}
/* An api/mcp value whose live reading was unavailable: name the fallback plainly, never dressed as current. */
.lwd-tip .tip-fallback{padding-top:6px;border-top:1px solid ${INK.body};color:${INK.onDark};font-size:11.5px;line-height:1.5}
.lwd-tip .tn-kind{display:inline-block;margin-right:5px;font:600 9px/1.4 ${FONT.mono};letter-spacing:${TRACKING.kindBadge};color:${INK.meta}}
/* Table cell editing (issue #140): the GFM table_block renders as a static, contenteditable=false atom.
 * An in-place edit affordance sits OVER it - a fixed-position input over the clicked cell, plus a small
 * floating row/column toolbar - so a cell can be edited and rows/cols added without the node-select
 * type-over that used to wipe the whole table. Cells show a text cursor to signal they are editable. */
.pmwrap .ProseMirror table.lwd-table td,.pmwrap .ProseMirror table.lwd-table th{cursor:text}
/* A figures-table cell whose value is CHANGING (comp 2b). The same amber fill, meaning exactly the same
 * thing, as a diff span in prose: this span is changing. Painted by the runtime from the live provenance
 * (the source has drifted from the value the document shows), never guessed from the markup. */
.pmwrap .ProseMirror table.lwd-table td.lwd-changing{background:${AMBER.bg}}
.lwd-cell-editor{position:fixed;z-index:70;box-sizing:border-box;border:2px solid ${INDIGO.base};border-radius:4px;padding:1px 6px;margin:0;font:400 13px/1.4 ${FONT.sans};color:${INK.heading};background:${PAPER.card};box-shadow:${SHADOW.card};outline:none}
.lwd-table-tools{position:fixed;z-index:71;display:flex;gap:4px;padding:4px;background:${PAPER.card};border:1px solid ${HAIRLINE.strong};border-radius:${RADIUS.control};box-shadow:${SHADOW.frame}}
.lwd-table-tools button{border:1px solid ${PAPER.control};background:${PAPER.card};color:${INK.body};border-radius:6px;padding:5px 9px;font:400 11.5px/1 ${FONT.sans};cursor:pointer}
.lwd-table-tools button:hover{background:${PAPER.sunken}}
/* Properties panel (plan 45 pin 12): a 284px inset panel at the editor card's right edge, on the page paper
 * with a strong hairline left border. It is fixed to the webview's right edge below the sticky formatting
 * toolbar (top:46px) so it insets INTO the card rather than floating over it; the reading column re-centres
 * because .props-open reserves 284px of right padding on .pmwrap (measured re-centre, P12.6). */
.propspanel{position:fixed;top:46px;right:0;bottom:0;width:284px;z-index:6;display:flex;flex-direction:column;background:${PAPER.page};border-left:1px solid ${HAIRLINE.strong}}
.pp-head{flex:none;height:44px;display:flex;align-items:center;padding:0 14px;border-bottom:1px solid ${HAIRLINE.strong}}
.pp-title{font:${TYPE.uiBodyStrong};color:${INK.body}}
.pp-x{margin-left:auto;border:none;background:none;color:${INK.meta};font-size:13px;cursor:pointer;padding:4px 6px;border-radius:6px}
.pp-x:hover{background:${PAPER.sunken};color:${INK.body}}
.pp-body{flex:1;min-height:0;overflow-y:auto;padding:14px}
.pp-field{margin-bottom:16px}
/* Field labels (P12.2): the section-label step - mono, uppercase, tracked, in meta ink. */
.pp-lab{font:${TYPE.sectionLabel};letter-spacing:${TRACKING.sectionLabel};text-transform:uppercase;color:${INK.meta};margin-bottom:6px}
.pp-input{width:100%;box-sizing:border-box;border:1px solid ${HAIRLINE.strong};border-radius:${RADIUS.control};padding:7px 9px;font:${TYPE.uiBody};color:${INK.heading};background:${PAPER.card}}
.pp-input:focus{outline:none;border-color:${INDIGO.base}}
.pp-input::placeholder{color:${INK.meta}}
.pp-dates{display:flex;gap:18px}
.pp-date{font:400 11.5px/1.3 ${FONT.mono};color:${INK.secondary}}
/* STATUS chip: the all-clear family with an inline editable label. */
.pp-status{display:flex;align-items:center;gap:7px;border:1px solid ${GREEN.border};border-radius:${RADIUS.pill};padding:5px 11px;background:${GREEN.bg}}
.pp-status-dot{flex:none;width:7px;height:7px;border-radius:${RADIUS.pill};background:${PAPER.control}}
.pp-status.set .pp-status-dot{background:${GREEN.base}}
.pp-status-in{flex:1;min-width:0;border:none;background:transparent;font:600 12px/1.2 ${FONT.sans};color:${GREEN.base}}
.pp-status-in::placeholder{color:${INK.meta};font-weight:400}
.pp-status-in:focus{outline:none}
/* TAGS: indigo-tint chips + a dashed add button. */
.pp-tags{display:flex;flex-wrap:wrap;gap:6px;align-items:center}
.pp-tag{display:inline-flex;align-items:center;gap:5px;background:${INDIGO.tint};border:1px solid ${INDIGO.tintBorder};border-radius:6px;padding:3px 8px;font:400 12px/1.2 ${FONT.sans};color:${INDIGO.base}}
.pp-tag-x{border:none;background:none;color:${INDIGO.underline};font-size:9px;cursor:pointer;padding:0;line-height:1}
.pp-tag-x:hover{color:${INDIGO.base}}
.pp-tag-add{width:24px;height:24px;border:1px dashed ${PAPER.frameBorder};border-radius:6px;background:transparent;color:${INK.meta};font-size:13px;cursor:pointer;line-height:1}
.pp-tag-add:hover{border-color:${INDIGO.base};color:${INDIGO.base}}
.pp-tag-in{border:1px solid ${INDIGO.tintBorder};border-radius:6px;padding:3px 8px;font:400 12px/1.2 ${FONT.sans};color:${INK.heading};min-width:90px}
.pp-tag-in:focus{outline:none;border-color:${INDIGO.base}}
/* BOUND SOURCES: 32px rows on white with the truthful bind count; click opens the drawer. */
.pp-srcs{display:flex;flex-direction:column;gap:4px}
.pp-src{display:flex;align-items:center;gap:8px;height:32px;width:100%;text-align:left;border:1px solid ${HAIRLINE.strong};border-radius:${RADIUS.control};background:${PAPER.card};padding:0 10px;cursor:pointer;font:inherit}
.pp-src:hover{background:${PAPER.sunken}}
.pp-src-glyph{flex:none;font:400 12px/1 ${FONT.mono};color:${INDIGO.base}}
.pp-src-name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font:400 12.5px/1.2 ${FONT.sans};color:${INK.body}}
.pp-src-count{flex:none;font:600 11px/1 ${FONT.mono};color:${INDIGO.base}}
.pp-empty{font:400 11.5px/1.4 ${FONT.sans};color:${INK.meta}}
.pp-foot{flex:none;border-top:1px solid ${HAIRLINE.strong};padding:10px 14px}
.pp-raw{border:none;background:none;padding:0;font:400 11px/1 ${FONT.mono};color:${INK.secondary};cursor:pointer}
.pp-raw:hover{color:${INDIGO.base}}
/* Re-centre: when the panel is open the reading column gets 284px of right padding so it re-centres in the
 * remaining width rather than sitting under the panel (P12.6). */
.props-open .pmwrap{padding-right:324px}
${POLICY_EDITOR_STYLE}
${FIND_WIDGET_STYLE}`;

// The webview RUNTIME (set up ONCE per webview via the shell). It mounts the ProseMirror view a single
// time and thereafter re-renders the document body from 'lwdRender' messages instead of a fresh setHtml,
// so the live editor is never torn down and the ~370KB bundle is inlined only once (mount-once-then-
// message; plan 15 iter 2). Event handling is DELEGATED on the persistent #lwd-root container, so it keeps
// working across innerHTML swaps without re-binding. On an update the live ProseMirror node is detached,
// the body is swapped, and the same node is re-inserted into the new #pm-root (PM survives reparenting).
// The pure GFM-table helpers (common/livingDocTableEdit.ts) are shared verbatim between the unit tests
// and the webview: their compiled source is interpolated into the RUNTIME below so the in-place cell
// editor's DOM shim can call them. Each is self-contained (asserted by the unit test), so String(fn)
// yields injectable ES with no dangling import/helper references.
const TABLE_HELPERS = [gfmSplitCells, gfmIsAlignRow, gfmParseAlign, gfmEscapeCell, parseGfmTable, serializeGfmTable, setCell, insertRow, deleteRow, insertCol, deleteCol].map(fn => String(fn)).join('\n');

// The pure wikilink rules (plan 52 WP-C, decision 179) are injected the same way the table helpers are, so
// the picker running INSIDE the webview and the unit tests in `common/` are literally the same code - in
// particular the ranking, which is the @-mention picker's rule (`filterMentions`, #178) lifted to `common/`
// rather than reimplemented. Each is asserted self-contained by `test/browser/wikilinks.test.ts`.
const WIKILINK_HELPERS = [activeWikilink, matchTypedWikilink, rankWikilinkTargets, resolveWikilinkTarget, splitWikilinkQuery].map(fn => String(fn)).join('\n');

// The RUNTIME is plain injected JavaScript and cannot call `localize()` itself, so every user-visible string
// it shows is built HERE with a `{0}` placeholder and handed over as data. `wlFmt` below does the
// substitution in the webview - never string concatenation, so a translation can reorder the sentence.
const WIKILINK_STRINGS = {
	open: localize('livingDocs.wikilink.open', "Open {0}"),
	create: localize('livingDocs.wikilink.create', "{0} - this document does not exist yet. Click to create it."),
	pickerHeader: localize('livingDocs.wikilink.pickerHeader', "Link to a document"),
	pickerNew: localize('livingDocs.wikilink.pickerNew', "Create \"{0}\""),
	pickerAlias: localize('livingDocs.wikilink.pickerAlias', "{0} - shown as \"{1}\""),
};

const RUNTIME = `${TABLE_HELPERS}
${WIKILINK_HELPERS}
const vscode = acquireVsCodeApi();
const root = document.getElementById('lwd-root');
let pmView = null, pmTimer = 0;
// Image assets (issue #141). A request-id sequence + in-flight guard, plus caches keyed by the doc-relative
// src so a relative image only round-trips to the host ONCE even though ProseMirror recreates its <img> on
// every re-render: _imgCache holds resolved data URIs, _imgBroken marks paths the host could not read.
let _imgSeq = 0;
const _imgReq = Object.create(null), _imgPending = Object.create(null), _imgCache = Object.create(null), _imgBroken = Object.create(null);
// isRelativeImageSrc is injected verbatim from common/livingDocAssets.ts (pure, self-contained) so the
// classifier is the SAME code the host + unit tests use.
${String(isRelativeImageSrc)}
// Swap the DOM src of every relative <img> matching rel to its resolved data URI (display only - the PM
// doc keeps the relative path so serialization still writes ![alt](assets/...)). Idempotent across re-renders.
function applyResolvedImg(rel, dataUri){ const imgs = root.querySelectorAll('#pm-root img'); for (let i = 0; i < imgs.length; i++){ if (imgs[i].getAttribute('src') === rel){ imgs[i].classList.remove('lwd-img-broken'); imgs[i].removeAttribute('title'); imgs[i].src = dataUri; } } }
// A path the host could not read: keep the (unresolvable) relative src so the broken state is visible, and
// carry the reason in the title - never a silent skip.
function markBrokenImg(rel){ const imgs = root.querySelectorAll('#pm-root img'); for (let i = 0; i < imgs.length; i++){ if (imgs[i].getAttribute('src') === rel){ imgs[i].classList.add('lwd-img-broken'); imgs[i].title = 'image not found: ' + rel; } } }
// Find every relative <img> in the live doc and resolve it (from cache, or by asking the host once).
function resolveRelativeImages(){ if (!root){ return; } const imgs = root.querySelectorAll('#pm-root img'); for (let i = 0; i < imgs.length; i++){ const rel = imgs[i].getAttribute('src'); if (!isRelativeImageSrc(rel)){ continue; } if (_imgBroken[rel]){ markBrokenImg(rel); continue; } const cached = _imgCache[rel]; if (cached){ applyResolvedImg(rel, cached); continue; } if (_imgPending[rel]){ continue; } _imgPending[rel] = true; const reqId = 'img' + (++_imgSeq); _imgReq[reqId] = rel; vscode.postMessage({ type: 'resolveImg', src: rel, reqId: reqId }); } }
// Insert an image node at the current selection (undoable, and fires the normal save path via onChange),
// then resolve its freshly-written relative src so it displays immediately.
function insertImage(rel, alt){ if (!pmView || !window.LWDPM){ return; } try { const node = pmView.state.schema.nodes.image.create({ src: rel, alt: alt || null }); pmView.dispatch(pmView.state.tr.replaceSelectionWith(node, false)); } catch (e) {} resolveRelativeImages(); }
// Image paste + drop (issue #141), capture-phase so an image File is intercepted BEFORE ProseMirror's own
// paste/drop handling. We act ONLY when the payload carries image/* File(s) (files take priority over any
// text flavours); every other payload falls straight through untouched, so text/HTML/Word paste is unaffected.
function imageFilesFrom(dt){ const out = []; if (!dt || !dt.files){ return out; } for (let i = 0; i < dt.files.length; i++){ const f = dt.files[i]; if (f && f.type && f.type.indexOf('image/') === 0){ out.push(f); } } return out; }
function inPm(node){ return !!(pmView && pmView.dom && (pmView.dom === node || pmView.dom.contains(node))); }
function sendImageFile(f){ const reqId = 'img' + (++_imgSeq); const reader = new FileReader(); reader.onload = function(){ const res = String(reader.result || ''); const comma = res.indexOf(','); const b64 = comma >= 0 ? res.slice(comma + 1) : res; vscode.postMessage({ type: 'imageFile', name: f.name || '', mime: f.type || '', b64: b64, reqId: reqId }); }; reader.readAsDataURL(f); }
function onImagePaste(e){ if (!inPm(e.target)){ return; } const imgs = imageFilesFrom(e.clipboardData); if (!imgs.length){ return; } e.preventDefault(); e.stopPropagation(); for (let i = 0; i < imgs.length; i++){ sendImageFile(imgs[i]); } }
function onImageDrop(e){ if (!inPm(e.target)){ return; } const imgs = imageFilesFrom(e.dataTransfer); if (!imgs.length){ return; } e.preventDefault(); e.stopPropagation(); try { const at = pmView.posAtCoords({ left: e.clientX, top: e.clientY }); if (at && typeof at.pos === 'number'){ const sel = pmView.state.selection.constructor.near(pmView.state.doc.resolve(at.pos)); pmView.dispatch(pmView.state.tr.setSelection(sel)); pmView.focus(); } } catch (e2) {} for (let i = 0; i < imgs.length; i++){ sendImageFile(imgs[i]); } }
document.addEventListener('paste', onImagePaste, true);
document.addEventListener('drop', onImageDrop, true);
// PM recreates <img> nodes on every re-render, so relative srcs must be re-resolved idempotently: observe the
// persistent #lwd-root subtree and re-run resolution (debounced) whenever nodes/srcs change.
let _imgObsTimer = 0;
const _imgObserver = new MutationObserver(function(){ clearTimeout(_imgObsTimer); _imgObsTimer = setTimeout(function(){ resolveRelativeImages(); enrichWikilinks(); }, 30); });
_imgObserver.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['src'] });
// The open in-place table cell editor (issue #140): { input, tIdx, r, c }. tIdx is the table's index
// in document order (robust to PM rebuilding the atom's DOM on setNodeMarkup); r < 0 addresses the
// header row, r >= 0 a body row. tblToolbar is its floating +/- Row/Col affordance. null when idle.
let tblEditor = null, tblToolbar = null;
// True only while a PROGRAMMATIC body swap (pmReplaceBody, on a model-driven pmReset) is being dispatched.
// dispatchTransaction fires pmOnChange for that swap too, which would echo the just-applied body straight
// back to the host as a spurious pmEdit save (double-persist over the approve's own write; a flickering
// Saving chip). This suppresses that ONE echo; a real user edit, or a user Ctrl+Z that reverts the swap,
// runs with the flag cleared and so saves normally (issue #142).
let _pmEchoSuppressed = false;
// Word-paste normalisation seam (issue #137). These pure, DOM-free helpers are the SAME code unit-tested
// in common/livingDocWordPaste.ts, injected verbatim so the webview and the tests share one implementation.
// The paste listener below is the seam #138 (tables) / #139 (tracked changes) extend via the normaliser's
// internal transform chain - it never has to be rewritten.
${String(isWordHtml)}
${String(normalizeWordPasteHtml)}
${String(pasteStartShouldClose)}
// Per-key provenance for the hover tooltip (plan 29 iter 3), refreshed from every decoration payload so the
// tooltip always reads the current lock state (a source edit that flips freshness re-renders the payload).
let _prov = Object.create(null);
function setProv(spec){ _prov = Object.create(null); if (spec && spec.provenance) { for (let i = 0; i < spec.provenance.length; i++) { _prov[spec.provenance[i].key] = spec.provenance[i]; } } }
// While the user is typing, the toolbar chip reads "Saving..." for the length of the 300ms debounce; when
// the edit persists the server re-renders the chip back to its honest saved state, with an optional version
// suffix when a snapshot exists (plan 26 iter 4).
function setSaving(){ const s = root.querySelector('.tb-saved-text'); if (s) { s.textContent = 'Saving\\u2026'; } }
function pmOnChange(){ if (_pmEchoSuppressed) { return; } findRefresh(); setSaving(); clearTimeout(pmTimer); pmTimer = setTimeout(function(){ if (pmView) { vscode.postMessage({ type: 'pmEdit', text: window.LWDPM.toMarkdown(pmView) }); } }, 300); }
function pmDeco(spec){ setProv(spec); if (pmView && spec && window.LWDPM) { window.LWDPM.setDecorations(pmView, spec); } enrichBoundFigures(); enrichWikilinks(); reportWidgets(specChangeIds(spec)); }
// The change ids this decoration pass ASKED for - every pending edit and insertion in the spec.
function specChangeIds(spec){ const ids = []; if (spec) { const lists = [spec.edits, spec.inserts]; for (let l = 0; l < lists.length; l++) { const arr = lists[l] || []; for (let i = 0; i < arr.length; i++) { if (arr[i] && arr[i].id) { ids.push(arr[i].id); } } } } return ids; }
// Ground truth for the chat transcript's change pointers (plan 52 WP-A1 fix 1, #301/#300): tell the host
// which pending changes ACTUALLY have a live inline widget in this document, by looking at the DOM rather
// than predicting it. The host cannot see inside this iframe, and the rule that places a widget (match the
// decoration's text anchor against a rendered ProseMirror node) lives in the vendored PM bundle - so a
// host-side guess at "will this decorate?" was wrong for whole block classes (a list, a table cell), and a
// pointer built on that guess landed the reader on a block showing nothing at all.
//
// Every mounted widget - edit and insert alike - carries the data-approve="changeId" button, which is the
// very element focusChange scrolls to. So "did a widget mount?" and "can the reader be landed on it?" are
// literally the same question, asked of the same element. Scoped to pmView.dom so the review bar's own
// cards (which live in the surrounding chrome and carry the same attribute) are never counted.
//
// The requested list rides along because "absent from mounted" on its own is not evidence: a change made
// after this pass simply was not asked for yet, and the host must tell those two states apart.
// Deferred a tick so a decoration pass that renders its widgets during the view update has finished, and
// wrapped so a torn-down view can never break a render.
function reportWidgets(requested){ setTimeout(function(){
	try {
		const mounted = [];
		if (pmView && pmView.dom) {
			const els = pmView.dom.querySelectorAll('[data-approve]');
			for (let i = 0; i < els.length; i++) { const id = els[i].getAttribute('data-approve'); if (id) { mounted.push(id); } }
		}
		vscode.postMessage({ type: 'pmWidgets', requested: requested || [], mounted: mounted });
	} catch (e) {}
}, 0); }
// Make every bound figure a real, reachable provenance door (#254). The bundle renders it as a plain
// span.bound atom with no affordance beyond colour; here we give each one a keyboard tab-stop, a button role,
// and an accessible name/title built from the live provenance so a screen-reader user (and a hover) both learn
// "trace <value> to <source>". Idempotent: re-run after every decoration pass (a source edit can flip the
// freshness text), skipping spans already enriched with the current label. The Enter/Space activation is
// handled by a delegated keydown on root (see below) so it survives the innerHTML swaps.
// It also paints the ONE fill a figure may carry in a table (comp 2b): a cell whose value is CHANGING. The
// signal is the live provenance - p.now is set only when the source has drifted from the value the document
// currently shows - so the amber says exactly what a diff span says in prose ("this span is changing") off
// real data, never off a guess about the markup. Prose figures keep the underline and no fill; only the
// table cell takes the highlight, because that is where the comp puts it.
function enrichBoundFigures(){ if (!pmView){ return; } const figs = pmView.dom.querySelectorAll('span.bound[data-key]'); for (let i = 0; i < figs.length; i++){ const fig = figs[i]; const key = fig.getAttribute('data-key'); const p = _prov[key]; const src = p && p.source ? p.source : null; const cell = fig.closest && fig.closest('table.lwd-table td'); if (cell){ if (p && p.now !== undefined){ cell.classList.add('lwd-changing'); } else { cell.classList.remove('lwd-changing'); } } const label = src ? ('Bound figure ' + (fig.textContent || '') + ' - trace to ' + src) : ('Bound figure ' + (fig.textContent || '') + ' - trace to source'); if (fig.getAttribute('aria-label') === label && fig.getAttribute('tabindex') === '0'){ continue; } fig.setAttribute('tabindex', '0'); fig.setAttribute('role', 'button'); fig.setAttribute('aria-label', label); fig.setAttribute('title', label); } }
// The focused figure (comp 4d): while the source drawer is open, the figure it belongs to is the ONE figure
// allowed to carry a fill, so the reader can see which sentence the cell below is answering for. Exactly one
// at a time, and cleared when the drawer closes or when a drawer is opened from somewhere that is not a
// figure (the Properties panel's BOUND SOURCES rows), where no single figure is the subject.
function focusFigure(el){ if (!pmView){ return; } const figs = pmView.dom.querySelectorAll('span.bound.focused'); for (let i = 0; i < figs.length; i++){ figs[i].classList.remove('focused'); } if (el){ el.classList.add('focused'); } }
// History-preserving body swap for a model-driven pmReset (approve/reject/refresh), replacing the old
// LWDPM.setDoc path which built a FRESH EditorState with a fresh (empty) history() plugin and so wiped the
// whole session's undo stack (issue #142). Here the new body is parsed to a doc node (via docJSON, so the
// same Markdown->PM mapping is used) and swapped in as ONE transaction on the LIVE state: history records it,
// so Ctrl+Z undoes the approve and a second Ctrl+Z still reaches the user's pre-approve typing. The selection
// is remapped through the transaction and clamped into the fresh doc so the caret never lands past the end.
// The single dispatch is echo-suppressed (see _pmEchoSuppressed) so it does not double-persist the approve.
function pmReplaceBody(md){
	if (!pmView || !window.LWDPM) { return; }
	const st = pmView.state;
	const json = window.LWDPM.docJSON(md);
	const node = st.schema.nodeFromJSON(json);
	const tr = st.tr.replaceWith(0, st.doc.content.size, node.content);
	try {
		const Sel = st.selection.constructor;
		const head = Math.min(tr.selection.head, tr.doc.content.size);
		if (Sel && typeof Sel.near === 'function') { tr.setSelection(Sel.near(tr.doc.resolve(head))); }
	} catch (e) {}
	_pmEchoSuppressed = true;
	try { pmView.dispatch(tr); } finally { _pmEchoSuppressed = false; }
}
// A single reused tooltip element (created lazily), floated over the prose with pointer-events:none so it
// never intercepts the click that opens the source drawer. esc keeps any source/location text inert markup.
let _tip = null;
function tipEsc(s){ return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function showTip(el, key){ const p = _prov[key]; if (!p) { return; } if (!_tip) { _tip = document.createElement('div'); _tip.className = 'lwd-tip'; document.body.appendChild(_tip); }
	// THE HOVER PEEK (comp 4d), three lines. Line 1 is WHAT the figure is - source and the cell inside it,
	// both provenance facts, so both mono. Line 2 is how fresh it is and what it was when the human approved
	// it, which is the question a reader actually has mid-sentence. Line 3 names the door the click opens.
	const loc = p.location ? (' &middot; ' + tipEsc(p.location)) : '';
	// "was X when approved" is the applied value from the lock - real, or omitted. It is never inferred.
	const wasApproved = p.then ? (' &middot; was ' + tipEsc(p.then) + ' when approved') : '';
	// The ONE freshness vocabulary (#122 F12): the hover-peek leads with "Stale" so the tooltip agrees with the
	// Knowledge table + drawer + tree meta, then names what drifted in plain words. A source that could not be
	// REACHED (p.fallback) is never in the document's stale set - nothing could be hash-compared - so it carries
	// the same stale-family marker from its own label, and the plain-words line below says why.
	const stale = !p.fresh ? '<div class="tip-stale">Stale &middot; source changed since last sync</div>'
		: (p.fallback ? '<div class="tip-stale">${UNREACHABLE_SOURCE_MARKER}</div>' : '');
	// The then-vs-now peek (#122 F13): when a stale source has a readable live value that drifted, show
		// "then -> now" so the reader sees the value at bind time versus what the source says now - the same
		// vocabulary the source drawer uses. For an api/mcp binding whose live value could NOT be fetched, name
		// the fallback plainly (never dress the last-synced value up as the current reading). A fresh binding
		// shows neither line: it still equals its applied value, so there is nothing to compare.
		let thenNow = '';
		if (p.now !== undefined) {
			thenNow = '<div class="tip-then"><span class="tn-lab">then</span> <span class="tn-then">' + tipEsc(p.then) + '</span> <span class="tn-arrow">&rarr;</span> <span class="tn-lab">now</span> <span class="tn-now">' + tipEsc(p.now) + '</span></div>';
		} else if (p.fallback) {
			thenNow = '<div class="tip-fallback"><span class="tn-kind">' + tipEsc((p.kind || '').toUpperCase()) + ' fallback</span> ' + tipEsc(p.fallback) + '</div>';
		}
		_tip.innerHTML = '<div class="tip-src">' + tipEsc(p.source) + loc + '</div><div class="tip-meta">' + tipEsc(p.synced) + wasApproved + '</div>' + stale + thenNow
				+ '<div class="tip-cta">click to open the source &darr;</div>';
	const box = el.getBoundingClientRect();
	// Measure then place above the figure (or below when it would clip the top of the viewport).
	_tip.classList.add('show');
	const th = _tip.getBoundingClientRect().height;
	let top = box.top - th - 8; if (top < 6) { top = box.bottom + 8; }
	let left = box.left; if (left + 300 > window.innerWidth) { left = Math.max(6, window.innerWidth - 306); }
	_tip.style.left = left + 'px'; _tip.style.top = top + 'px';
}
function hideTip(){ if (_tip) { _tip.classList.remove('show'); } }
// Paste-slice open-boundary guard (#256). ProseMirror parses a pasted fragment into a Slice and, via
// Slice.maxOpen, gives it an OPEN start boundary (openStart > 0) so an inline paste flows into the caret's
// current textblock - correct for "a few words" pasted mid-sentence. But when the FIRST pasted node is a
// STRUCTURAL block (a heading, list, table or blockquote) and the caret sits inside a NON-EMPTY paragraph,
// that same open boundary merges the block's text INTO the paragraph: a pasted Word H1 loses its heading
// level and glues onto the prior line ("...for the bound report.Quarterly Title Zed"). The normaliser
// already rewrites Word heading paragraphs to real <hN>, so the slice's first child IS a heading node - the
// defect is purely the open start boundary at the insertion site, not the tag rewrite. This registers a
// transformPasted editor prop (the sanctioned ProseMirror hook, checked before plugin props by someProp)
// that CLOSES the start boundary (openStart -> 0) for exactly that case, so the first structural block lands
// as its own block. Everything else is returned byte-for-byte: an inline/plain-text paste still merges
// inline, a paste into an empty paragraph is unchanged (nothing to glue onto), and a first pasted PARAGRAPH
// keeps the ordinary merge behaviour. Installed once per mount (idempotent), no bundle edit, no core patch.
function installPasteBoundaryGuard(view){
	if (!view || view._lwdPasteGuard || typeof view.setProps !== 'function') { return; }
	view._lwdPasteGuard = true;
	view.setProps({ transformPasted: function(slice, v, isPlainText){
		try {
			if (!slice) { return slice; }
			const first = slice.content && slice.content.firstChild;
			const firstType = (first && first.type) ? first.type.name : '';
			const parent = v.state.selection.$from.parent;
			const parentIsTextblock = !!(parent && parent.isTextblock);
			const parentSize = parent ? parent.content.size : 0;
			// The decision (close the open start so a leading structural block lands as its own block) lives in
			// the SAME pure predicate that is unit-tested in common/livingDocWordPaste.ts, injected verbatim.
			if (pasteStartShouldClose(firstType, slice.openStart, isPlainText, parentIsTextblock, parentSize)) {
				return new slice.constructor(slice.content, 0, slice.openEnd);
			}
			return slice;
		} catch (err) { return slice; }
	} });
}
// ---- [[Wikilinks]] (plan 52 WP-C, decision 179) ------------------------------------------------
// The picker, the resolved/unresolved chip and the click-to-navigate all live here rather than in the
// vendored bundle: the bundle owns the Markdown GRAMMAR (the wikilink atom node, so \`[[Doc Name]]\` survives
// parse + serialise byte-for-byte on disk), and the host webview owns everything that depends on knowing
// WHICH DOCUMENTS EXIST - which the bundle cannot know.
const WL_S = ${JSON.stringify(WIKILINK_STRINGS)};
// Substitute the {0} (and optional {1}) placeholders. Never concatenate a user-visible sentence: the host
// built these with localize() and a translation is free to reorder the placeholders.
function wlFmt(template, value, second){
	const one = String(template).split('{0}').join(String(value));
	return second === undefined ? one : one.split('{1}').join(String(second));
}
// Every document name in the workspace, pushed by the host (it alone can scan the folder). Seeded on the
// shell so the first paint already marks links resolved/unresolved, then refreshed by 'lwdDocs' messages.
let _docNames = Array.isArray(window.__LWD_DOCS) ? window.__LWD_DOCS : [];
// The open picker: { el, list, items, index, from, to } in PM document positions, or null.
let wikiPicker = null;
let _wikiDismissed = -1;
// The document position of a '[[' the user dismissed with Escape, or -1. Escape has to be remembered, not
// merely acted on: the same keystroke's keyup runs the refresh, which would find the caret still inside the
// partial link and reopen the picker the user just dismissed. Cleared as soon as the caret leaves that link,
// so retyping '[[' offers the picker again.
// Is this position CODE? Both senses of it: inside a fenced/indented code BLOCK, and inside an inline
// \`code\` SPAN. Typing \`[[\` in either is a code sample, never a link - and that is not a house preference, it
// is what the Markdown parser does: a fence's content is never inline-parsed, and markdown-it's \`backticks\`
// rule claims a span before the wikilink rule is ever reached. So the picker must not open here and the
// input rule must not fire here, or the editor would disagree with the file it just wrote. One helper for
// both, because two guards that must agree are a defect waiting to happen.
function pmIsCodeAt($pos, storedMarks){
	for (let d = $pos.depth; d >= 0; d--){ const t = $pos.node(d).type; if (t && (t.name === 'code_block' || t.spec && t.spec.code)){ return true; } }
	const codeMark = pmView && pmView.state.schema.marks.code;
	if (!codeMark){ return false; }
	const marks = storedMarks || $pos.marks();
	return !!(marks && codeMark.isInSet(marks));
}
// The caret's textblock text up to the caret, with each inline LEAF contributing exactly one character so
// string offsets line up 1:1 with ProseMirror's parentOffset (a bound figure is 1 position but contributes
// no textContent, which would otherwise skew every position we compute). Returns null when the caret is
// somewhere a wikilink must never be offered: a non-empty selection, a non-textblock, or code.
function pmCaretContext(){
	if (!pmView){ return null; }
	const sel = pmView.state.selection;
	if (!sel.empty || !sel.$from){ return null; }
	const $from = sel.$from;
	const parent = $from.parent;
	if (!parent || !parent.isTextblock){ return null; }
	if (pmIsCodeAt($from, pmView.state.storedMarks)){ return null; }
	let text = '';
	try { text = parent.textBetween(0, $from.parentOffset, undefined, '\\ufffc'); } catch (e) { return null; }
	return { text: text, offset: $from.parentOffset, start: $from.start() };
}
function closeWikiPicker(){ if (!wikiPicker){ return; } if (wikiPicker.el && wikiPicker.el.parentNode){ wikiPicker.el.parentNode.removeChild(wikiPicker.el); } wikiPicker = null; }
// Recompute the picker from the live caret. Called after every input/keyup/click in the surface, so the
// list narrows as the query is typed and the picker closes the moment the caret leaves the partial link.
function refreshWikiPicker(){
	const ctx = pmCaretContext();
	if (!ctx){ return closeWikiPicker(); }
	const active = activeWikilink(ctx.text, ctx.offset);
	if (!active){ _wikiDismissed = -1; return closeWikiPicker(); }
	const from = ctx.start + active.start;
	if (from === _wikiDismissed){ return closeWikiPicker(); }
	// Obsidian's alias form is authored right here, in the query: everything after the first '|' is the words
	// the link will SHOW, and only the half before it is matched against the document list. Without this split
	// the whole run is searched, matches nothing, and the picker offers to create a document literally named
	// "Q3 Plan|the plan" - a name no filesystem will take. The split is the same one the parser makes.
	const parts = splitWikilinkQuery(active.query);
	const query = parts.target.trim();
	const alias = parts.alias;
	const matches = rankWikilinkTargets(_docNames, parts.target, ${WIKILINK_PICKER_LIMIT});
	const items = [];
	for (let i = 0; i < matches.length; i++){ items.push({ target: matches[i], label: alias ? wlFmt(WL_S.pickerAlias, matches[i], alias) : matches[i], isNew: false }); }
	// No match is not a dead end: offer to create the document the user is clearly naming. The link inserts
	// either way and renders unresolved until the document exists - the same Obsidian promise.
	if (query && !resolveWikilinkTarget(query, _docNames)){
		const made = wlFmt(WL_S.pickerNew, query);
		items.push({ target: query, label: alias ? wlFmt(WL_S.pickerAlias, made, alias) : made, isNew: true });
	}
	if (!items.length){ return closeWikiPicker(); }
	const keep = wikiPicker ? wikiPicker.items[wikiPicker.index] : null;
	let index = 0;
	if (keep){ for (let i = 0; i < items.length; i++){ if (items[i].target === keep.target && items[i].isNew === keep.isNew){ index = i; break; } } }
	showWikiPicker(items, index, from, ctx.start + ctx.offset, alias);
}
function showWikiPicker(items, index, from, to, alias){
	if (!wikiPicker){
		const el = document.createElement('div');
		el.className = 'lwd-wikipicker';
		el.setAttribute('role', 'listbox');
		el.setAttribute('aria-label', WL_S.pickerHeader);
		const head = document.createElement('div');
		head.className = 'wp-head';
		head.textContent = WL_S.pickerHeader;
		const list = document.createElement('div');
		list.className = 'wp-list';
		el.appendChild(head); el.appendChild(list);
		document.body.appendChild(el);
		// mousedown (not click) so the accept runs BEFORE the editor loses focus to the picker.
		list.addEventListener('mousedown', function(e){ const row = e.target.closest && e.target.closest('[data-wp-index]'); if (!row){ return; } e.preventDefault(); e.stopPropagation(); acceptWikiPick(Number(row.getAttribute('data-wp-index'))); });
		wikiPicker = { el: el, list: list, items: [], index: 0, from: from, to: to, alias: '' };
	}
	wikiPicker.items = items; wikiPicker.index = index; wikiPicker.from = from; wikiPicker.to = to;
	wikiPicker.alias = alias || '';
	paintWikiPicker();
	placeWikiPicker(from);
}
function paintWikiPicker(){
	if (!wikiPicker){ return; }
	const rows = [];
	for (let i = 0; i < wikiPicker.items.length; i++){
		const it = wikiPicker.items[i];
		const b = document.createElement('button');
		b.type = 'button';
		b.className = 'wp-item' + (it.isNew ? ' wp-new' : '') + (i === wikiPicker.index ? ' sel' : '');
		b.setAttribute('data-wp-index', String(i));
		b.setAttribute('role', 'option');
		b.setAttribute('aria-selected', i === wikiPicker.index ? 'true' : 'false');
		const g = document.createElement('span');
		g.className = 'wp-glyph';
		// allow-any-unicode-next-line
		g.textContent = it.isNew ? '\\uff0b' : '\\u25a6';
		const n = document.createElement('span');
		n.className = 'wp-name';
		n.textContent = it.label;
		b.appendChild(g); b.appendChild(n);
		rows.push(b);
	}
	wikiPicker.list.textContent = '';
	for (let i = 0; i < rows.length; i++){ wikiPicker.list.appendChild(rows[i]); }
	const sel = wikiPicker.list.querySelector('.sel');
	if (sel && sel.scrollIntoView){ sel.scrollIntoView({ block: 'nearest' }); }
}
// Anchor under the '[[' that opened it, flipping above when it would fall off the bottom of the webview.
function placeWikiPicker(from){
	if (!wikiPicker || !pmView){ return; }
	let coords;
	try { coords = pmView.coordsAtPos(from); } catch (e) { return; }
	const box = wikiPicker.el.getBoundingClientRect();
	let top = coords.bottom + 6;
	if (top + box.height > window.innerHeight - 6){ top = Math.max(6, coords.top - box.height - 6); }
	let left = coords.left;
	if (left + box.width > window.innerWidth - 6){ left = Math.max(6, window.innerWidth - box.width - 6); }
	wikiPicker.el.style.left = left + 'px';
	wikiPicker.el.style.top = top + 'px';
}
function moveWikiSel(delta){ if (!wikiPicker){ return; } const n = wikiPicker.items.length; wikiPicker.index = ((wikiPicker.index + delta) % n + n) % n; paintWikiPicker(); }
// Accept: replace the typed '[[query' run with a real wikilink NODE (so the serializer writes exactly
// [[Doc Name]] to disk) plus a trailing space, as ONE transaction - one undo step, one save.
function acceptWikiPick(index){
	if (!wikiPicker || !pmView){ return; }
	const it = wikiPicker.items[typeof index === 'number' ? index : wikiPicker.index];
	const from = wikiPicker.from, to = wikiPicker.to;
	// An alias equal to its target is noise on disk, so it is dropped - the same rule serializeWikilink holds.
	const alias = wikiPicker.alias && it && wikiPicker.alias !== it.target ? wikiPicker.alias : '';
	closeWikiPicker();
	if (!it){ return; }
	_wikiDismissed = -1;
	const type = pmView.state.schema.nodes.wikilink;
	if (!type){ return; }
	try {
		const node = type.create({ target: it.target, alias: alias });
		const tr = pmView.state.tr.replaceWith(from, to, node);
		tr.insertText(' ', from + node.nodeSize);
		pmView.dispatch(tr);
	} catch (e) { return; }
	enrichWikilinks();
	try { pmView.focus(); } catch (e) {}
}
// Hand-typed links (fix round 1, #314). A \`[[Doc Name]]\` that arrives from disk, or from the picker, is a
// real wikilink NODE and so serialises back unescaped. One merely TYPED was plain text - and
// prosemirror-markdown's text serializer escapes \`[\` and \`]\`, so it reached disk as \`\\[\\[Doc Name\\]\\]\` and
// was corrupt from the very first save, permanently. Because the picker could not author an alias,
// hand-typing was also the ONLY route to \`[[Target|Alias]]\`, which made the one syntax the grammar, the
// round-trip and the export all support the one syntax guaranteed to break.
//
// The fix is the ProseMirror input-rule shape: watch the text as it is typed and, the moment the closing
// \`]]\` lands, insert a real NODE instead of that bracket. It needs NO bundle edit - the bundle's grammar was
// already right, only the typing path was missing - because \`handleTextInput\` is an editor PROP, checked
// before plugin props by someProp, the same sanctioned seam the paste-boundary guard uses (#256).
//
// The decision is the pure \`matchTypedWikilink\` from common/wikilinks.ts, injected verbatim and unit-tested
// there. It mirrors the bundle's markdown-it inline rule exactly, so typing a link and reloading the file
// can never disagree about what is a link. CODE is the one thing a string cannot know, so it is guarded
// here, where the nodes and marks around the caret are visible.
function installWikilinkInputRule(view){
	if (!view || view._lwdWikiInput || typeof view.setProps !== 'function'){ return; }
	view._lwdWikiInput = true;
	view.setProps({ handleTextInput: function(v, from, to, text){
		try {
			const type = v.state.schema.nodes.wikilink;
			if (!type || !text){ return false; }
			const $from = v.state.doc.resolve(from);
			if (!$from.parent || !$from.parent.isTextblock){ return false; }
			if (pmIsCodeAt($from, v.state.storedMarks)){ return false; }
			// The typed character is not in the document yet, so it is appended by hand: the rule has to see
			// the text as it WILL be, which is the whole point of firing on the closing bracket.
			const before = $from.parent.textBetween(0, $from.parentOffset, undefined, '\\ufffc') + text;
			const hit = matchTypedWikilink(before);
			if (!hit){ return false; }
			const start = from - (hit.length - text.length);
			if (start < $from.start()){ return false; }
			// An alias identical to its target is noise on disk; drop it, exactly as serializeWikilink does.
			const alias = hit.alias && hit.alias !== hit.target ? hit.alias : '';
			v.dispatch(v.state.tr.replaceWith(start, to, type.create({ target: hit.target, alias: alias })).scrollIntoView());
			_wikiDismissed = -1;
			closeWikiPicker();
			setTimeout(enrichWikilinks, 0);
			return true;
		} catch (err) { return false; }
	} });
}
// Mark every chip resolved or unresolved, and make it a real keyboard-reachable door (the same contract
// enrichBoundFigures gives a bound figure). Idempotent - re-run after every render; data-lwd-wl records the
// state already painted so a repeat pass touches nothing.
function enrichWikilinks(){
	if (!pmView){ return; }
	const links = pmView.dom.querySelectorAll('span.wikilink[data-target]');
	for (let i = 0; i < links.length; i++){
		const el = links[i];
		const target = el.getAttribute('data-target') || '';
		const match = resolveWikilinkTarget(target, _docNames);
		const label = match ? wlFmt(WL_S.open, match) : wlFmt(WL_S.create, target);
		const state = match ? 'r' : 'u';
		if (el.getAttribute('data-lwd-wl') === state && el.getAttribute('title') === label){ continue; }
		el.setAttribute('data-lwd-wl', state);
		if (match){ el.classList.remove('unresolved'); } else { el.classList.add('unresolved'); }
		el.setAttribute('role', 'link');
		el.setAttribute('tabindex', '0');
		el.setAttribute('title', label);
		el.setAttribute('aria-label', label);
	}
}
// Following a link is NOT idempotent - an unresolved one creates a document - so the same click must never
// be able to fire it twice. A wikilink inside a table cell is seen by two handlers: the capture-phase cell
// mousedown (which has to run, or the click opens the cell editor instead of the link) and the bubble-phase
// click delegate. Left alone that pair created TWO documents from one click, observed in the desktop walk.
// Collapsing them here rather than removing one call site keeps a table-cell link working whichever handler
// wins, which is the property that actually matters.
let _wlLastFollow = { target: '', at: 0 };
function openWikilink(el){
	const target = el.getAttribute('data-target');
	if (!target){ return; }
	const now = Date.now();
	if (target === _wlLastFollow.target && (now - _wlLastFollow.at) < 700){ return; }
	_wlLastFollow = { target: target, at: now };
	vscode.postMessage({ type: 'openWikilink', target: target });
}
// The picker reads the caret AFTER ProseMirror has applied the change, so every hook defers a tick.
function scheduleWikiRefresh(){ setTimeout(refreshWikiPicker, 0); }
function onWikiKeydown(e){
	if (!wikiPicker){ return; }
	if (e.key === 'Escape'){ e.preventDefault(); e.stopPropagation(); _wikiDismissed = wikiPicker.from; closeWikiPicker(); return; }
	if (e.key === 'ArrowDown'){ e.preventDefault(); e.stopPropagation(); moveWikiSel(1); return; }
	if (e.key === 'ArrowUp'){ e.preventDefault(); e.stopPropagation(); moveWikiSel(-1); return; }
	if (e.key === 'Enter' || e.key === 'Tab'){ e.preventDefault(); e.stopPropagation(); acceptWikiPick(); return; }
}
function wireWikilinks(){
	if (!pmView || pmView.__lwdWikiWired){ return; }
	pmView.__lwdWikiWired = true;
	// Capture phase on the view's own element: the picker's Enter/Arrow/Esc must be claimed before
	// ProseMirror's keymap turns Enter into a paragraph split.
	pmView.dom.addEventListener('keydown', onWikiKeydown, true);
	pmView.dom.addEventListener('input', scheduleWikiRefresh);
	pmView.dom.addEventListener('keyup', scheduleWikiRefresh);
	pmView.dom.addEventListener('mouseup', scheduleWikiRefresh);
	installWikilinkInputRule(pmView);
	enrichWikilinks();
}
// A click anywhere outside the picker dismisses it (the caret has moved on).
document.addEventListener('mousedown', function(e){ if (!wikiPicker){ return; } if (wikiPicker.el.contains(e.target)){ return; } closeWikiPicker(); }, true);
window.addEventListener('scroll', function(){ if (wikiPicker){ placeWikiPicker(wikiPicker.from); } }, true);
window.addEventListener('resize', function(){ if (wikiPicker){ placeWikiPicker(wikiPicker.from); } });
function mountPm(md, spec){ const r = root.querySelector('#pm-root'); if (r && window.LWDPM) { pmView = window.LWDPM.mount(r, md || '', { onChange: pmOnChange }); installPasteBoundaryGuard(pmView); pmDeco(spec); wireTableEditing(); wireWikilinks(); resolveRelativeImages(); focusPm(); } }
// plan 16 iter 3 (decision 56): land the caret in the document on first mount so a freshly-opened (or
// freshly-created blank) doc is immediately writable -- "one click -> cursor ready", no extra click to
// start typing. Only fires on the initial mount (mount-once-then-message, decision 50), so re-renders
// never steal the caret. Fail-soft: a focus that throws (view torn down) is ignored.
function focusPm(){ try { if (pmView && pmView.focus) { setTimeout(function(){ try { pmView && pmView.focus(); } catch (e) {} }, 0); } } catch (e) {} }
// Re-render the body from a message. The live ProseMirror node is detached, the body HTML is swapped, and
// the same node re-attached (PM is never remounted). A model-driven body change (an approved change)
// arrives as pmReset and resets the live doc to disk truth; pending changes + the gutter are decorations.
function applyUpdate(htmlStr, pmMd, spec, pmReset){
	const live = (pmView && pmMd !== null) ? pmView.dom : null;
	if (live && live.parentNode) { live.parentNode.removeChild(live); }
	root.innerHTML = htmlStr;
	if (pmMd !== null) {
		const r = root.querySelector('#pm-root');
		if (live && r) {
			r.appendChild(live);
			// A decoration-only re-render (e.g. the debounced save after a cell commit) keeps the live PM
			// node - and so the table DOM the overlay sits over - intact; reposition the editor rather than
			// tearing it down, so a save landing mid-edit never closes the cell the user just opened. A
			// pmReset rebuilds the doc to disk truth, which invalidates any open editor, so drop it there.
			// The reset goes through pmReplaceBody (issue #142) so it swaps the body as ONE transaction on the
			// live state and preserves the undo stack, rather than the old history-wiping setDoc path.
			if (typeof pmReset === 'string' && window.LWDPM) { teardownCellInput(); pmReplaceBody(pmReset); }
			pmDeco(spec);
			revalidateCellEditor();
			resolveRelativeImages();
		} else if (r && window.LWDPM) { teardownCellInput(); mountPm(pmMd, spec); }
	} else if (pmView) { teardownCellInput(); window.LWDPM.destroy(pmView); pmView = null; reportWidgets(specChangeIds(spec)); }
}
// The calm formatting toolbar drives the live ProseMirror view through LWDPM.cmd (plan 15 iter 5) - NOT
// document.execCommand, which PM does not honour. The B/I/list/quote buttons fire on mousedown with
// preventDefault so the PM selection is kept; the heading <select> fires on change.
root.addEventListener('mousedown', e => {
	const b = e.target.closest('button[data-pmcmd]');
	if (b && pmView && window.LWDPM) { e.preventDefault(); window.LWDPM.cmd(pmView, b.getAttribute('data-pmcmd')); }
});
root.addEventListener('change', e => {
	const s = e.target.closest('select[data-pmcmd]');
	if (s && pmView && window.LWDPM) { window.LWDPM.cmd(pmView, s.value); }
});
root.addEventListener('click', e => {
	let el;
	// Tweak (plan 31 iter 3): Edit opens the in-place editor over the proposed text; Save & Approve amends the
	// pending change then approves through the one path; Cancel restores. The contenteditable lives inside the
	// widget DOM (never the PM document), so the doc stays read-only until approval - no undo-stack coupling.
	if (el = e.target.closest('[data-tweak]')) { e.stopPropagation(); const card = el.closest('[data-editcard]'); if (card) { card.classList.add('tweaking'); const ed = card.querySelector('.tweakedit'); if (ed) { ed.focus(); } } return; }
	if (el = e.target.closest('[data-tweak-cancel]')) { e.stopPropagation(); const card = el.closest('[data-editcard]'); if (card) { card.classList.remove('tweaking'); const ed = card.querySelector('.tweakedit'); if (ed) { ed.textContent = ed.getAttribute('data-orig') || ''; } } return; }
	if (el = e.target.closest('[data-tweak-save]')) { e.stopPropagation(); const card = el.closest('[data-editcard]'); const ed = card && card.querySelector('.tweakedit'); const text = ed ? ed.innerText.replace(/\\s+/g, ' ').trim() : ''; return vscode.postMessage({ type: 'amendApprove', id: el.getAttribute('data-tweak-save'), text: text }); }
	if (el = e.target.closest('[data-approve]')) { e.stopPropagation(); return vscode.postMessage({ type: 'approve', id: el.getAttribute('data-approve') }); }
	if (el = e.target.closest('[data-reject]')) { e.stopPropagation(); return vscode.postMessage({ type: 'reject', id: el.getAttribute('data-reject') }); }
	if (el = e.target.closest('[data-approve-all-doc]')) { return vscode.postMessage({ type: 'approveAllDoc' }); }
	if (el = e.target.closest('[data-approve-all-everywhere]')) { return vscode.postMessage({ type: 'approveAllEverywhere' }); }
	if (el = e.target.closest('[data-next-doc]')) { return vscode.postMessage({ type: 'nextDoc' }); }
	if (el = e.target.closest('[data-prev-doc]')) { return vscode.postMessage({ type: 'prevDoc' }); }
	// "Review each" (comp 2b) and a quiet pending marker's own link are the same gesture from two places:
	// promote a waiting change to the full decision card, in place, and land the reader on it. Both are
	// purely local - no round trip to the host, because nothing about the document changes by looking at it.
	if (el = e.target.closest('[data-review-each]')) { return openFirstCard(); }
	if (el = e.target.closest('[data-open-card]')) { e.stopPropagation(); return openCard(el.getAttribute('data-open-card')); }
	if (el = e.target.closest('[data-cells]')) { focusFigure(null); return vscode.postMessage({ type: 'reveal', cells: el.getAttribute('data-cells').split(',') }); }
	if (el = e.target.closest('span.bound[data-key]')) { focusFigure(el); return vscode.postMessage({ type: 'reveal', cells: [el.getAttribute('data-key')] }); }
	// A [[wikilink]] chip opens its document; an unresolved one creates it first (the Obsidian gesture).
	if (el = e.target.closest('span.wikilink[data-target]')) { e.preventDefault(); e.stopPropagation(); return openWikilink(el); }
	// A marked gutter number (bound or pending) opens the source-peek for the block's bind. The number is a
	// ::before on the block node painted into the gutter lane, so only fire when the click lands in that lane
	// (clientX left of the block's content edge); an idle number carries no bind and clicks through to text.
	if ((el = e.target.closest('.pm-num.bound, .pm-num.pending')) && e.clientX < el.getBoundingClientRect().left) { const key = gutterKeyFor(el); if (key) { focusFigure(el.querySelector('span.bound[data-key="' + key + '"]')); return vscode.postMessage({ type: 'reveal', cells: [key] }); } }
	if (el = e.target.closest('[data-to-raw]')) { return vscode.postMessage({ type: 'setMode', mode: 'raw' }); }
	// Properties panel (plan 45 pin 8/12). Toolbar buttons + panel controls are delegated here; the host owns
	// the toggle state, the frontmatter writes and the policy persistence.
	if (el = e.target.closest('[data-ask-ai]')) { return vscode.postMessage({ type: 'askAi' }); }
	if (el = e.target.closest('[data-props-toggle]')) { return vscode.postMessage({ type: 'toggleProperties' }); }
	if (el = e.target.closest('[data-props-close]')) { return vscode.postMessage({ type: 'toggleProperties' }); }
	if (el = e.target.closest('[data-props-raw]')) { return vscode.postMessage({ type: 'setMode', mode: 'raw' }); }
	// A BOUND SOURCES row opens the source drawer at that source's bind keys (the existing reveal path).
	if (el = e.target.closest('[data-prop-source]')) { const keys = el.getAttribute('data-prop-source'); focusFigure(null); return vscode.postMessage({ type: 'reveal', cells: keys ? keys.split(',') : [] }); }
	// A tag chip's remove button removes it (writes frontmatter on disk).
	if (el = e.target.closest('[data-prop-tag-remove]')) { return vscode.postMessage({ type: 'setDocTag', tag: el.getAttribute('data-prop-tag-remove'), add: false }); }
	// The dashed add button reveals the inline add input and focuses it (no message; the input's Enter commits).
	if (el = e.target.closest('[data-prop-tag-add]')) { const inp = root.querySelector('[data-prop-tag-input]'); if (inp) { inp.style.display = ''; inp.focus(); } return; }
	// A policy option selects that level (writes the doc's frontmatter policy on disk; #122 F11). The
	// container's data-policy-editor names which control fired (the doc id here).
	if (el = e.target.closest('[data-policy]')) { return vscode.postMessage({ type: 'setDocPolicy', policy: el.getAttribute('data-policy') }); }
	if (el = e.target.closest('[data-source-close]')) { focusFigure(null); return vscode.postMessage({ type: 'closeSource' }); }
	if (el = e.target.closest('[data-sync]')) { return vscode.postMessage({ type: 'sync' }); }
	if (el = e.target.closest('[data-present-choice]')) { return vscode.postMessage({ type: 'presentChoice', choice: el.getAttribute('data-present-choice') }); }
	if (el = e.target.closest('[data-present-cta-force]')) { return vscode.postMessage({ type: 'presentCtaForce' }); }
	if (el = e.target.closest('[data-present-fix-first]')) { return vscode.postMessage({ type: 'presentFixFirst' }); }
	if (el = e.target.closest('[data-present-cta]')) { return vscode.postMessage({ type: 'presentCta' }); }
	// The modal closes from the backdrop or the X (both data-present-close); a click inside the card
	// (data-present-stop) does not. Walk to whichever ancestor comes first and close only if it is a close.
	const modalHit = e.target.closest('[data-present-close],[data-present-stop]');
	if (modalHit && modalHit.hasAttribute('data-present-close')) { return vscode.postMessage({ type: 'presentClose' }); }
	if (el = e.target.closest('[data-apply-raw]')) { const ta = root.querySelector('textarea.raw'); return vscode.postMessage({ type: 'applyRaw', text: ta ? ta.value : '' }); }
});
root.addEventListener('keydown', e => {
	// The keyboard route to the wedge (#254): a focused bound figure activates its provenance drawer on
	// Enter/Space, the same reveal a click posts. enrichBoundFigures() made the span a tab-stop + role=button,
	// so this completes the "figure is a real, keyboard-reachable door" contract.
	const fig = e.target.closest && e.target.closest('span.bound[data-key]');
	if (fig && (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar')) { e.preventDefault(); focusFigure(fig); return vscode.postMessage({ type: 'reveal', cells: [fig.getAttribute('data-key')] }); }
	// The same keyboard door for a wikilink chip: Enter/Space follows it (or creates its document).
	const wl = e.target.closest && e.target.closest('span.wikilink[data-target]');
	if (wl && (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar')) { e.preventDefault(); return openWikilink(wl); }
	const b = e.target.closest('[data-block]');
	if (b && e.key === 'Enter') { e.preventDefault(); b.blur(); }
	// Properties inputs commit on Enter (title/status blur to fire their focusout write; the tag input posts and
	// clears). Escape on the tag input cancels the add.
	const ti = e.target.closest('[data-prop-tag-input]');
	if (ti) {
		if (e.key === 'Enter') { e.preventDefault(); const v = ti.value.trim(); ti.value = ''; ti.style.display = 'none'; if (v) { vscode.postMessage({ type: 'setDocTag', tag: v, add: true }); } return; }
		if (e.key === 'Escape') { ti.value = ''; ti.style.display = 'none'; ti.blur(); return; }
	}
	if (e.target.closest('[data-prop-title],[data-prop-status]') && e.key === 'Enter') { e.preventDefault(); e.target.blur(); }
});
// Properties title/status commit on focus loss: post only when the value actually changed from the rendered
// value, so a focus-through never triggers a redundant disk write.
root.addEventListener('focusout', e => {
	const t = e.target.closest('[data-prop-title]');
	if (t && t.value !== (t.getAttribute('value') || '')) { return vscode.postMessage({ type: 'setDocTitle', title: t.value }); }
	const s = e.target.closest('[data-prop-status]');
	if (s && s.value !== (s.getAttribute('value') || '')) { return vscode.postMessage({ type: 'setDocStatus', status: s.value }); }
});
// HTML-paste interception (issue #137 the T1-A finding, extended by #138/#139). Capture phase so we run
// BEFORE ProseMirror's own clipboard handler: when the clipboard carries a 'text/html' payload pasted INTO
// the live PM surface, rebuild its Word list paragraphs into real nested lists, drop Word's nbsp spacer
// crumbs, resolve tracked-changes residue, and serialise any pasted <table> to a table[data-md] element the
// table_block node adopts (#138) - all via the injected normaliser - then hand the cleaned HTML to PM's paste
// pipeline. We intercept when the payload is a Word/Office paste OR when it contains a <table> (issue #138
// covers ANY pasted HTML table, Word or plain browser HTML, since PM would otherwise hoist every cell out as
// a stray paragraph); the normaliser's Word-specific steps gate themselves, so a plain-HTML table paste only
// gets its table rewritten. Every OTHER non-Word paste - and a paste into a widget/textarea rather than the
// document - falls through byte-untouched. Fail-soft: if reading the clipboard or normalising throws, we do
// nothing and let the default paste proceed.
root.addEventListener('paste', e => {
	if (!pmView || !window.LWDPM || !pmView.dom || !pmView.dom.contains(e.target)) { return; }
	const cd = e.clipboardData || window.clipboardData;
	if (!cd) { return; }
	let html = '';
	try { html = cd.getData('text/html') || ''; } catch (err) { return; }
	if (!html || (!isWordHtml(html) && !/<table[\s>]/i.test(html))) { return; }
	e.preventDefault(); e.stopPropagation();
	let cleaned;
	try { cleaned = normalizeWordPasteHtml(html); } catch (err) { cleaned = html; }
	// If the insertion itself throws, nothing landed in the document: bail before posting wordPaste so the host
	// cannot raise a "content dropped" toast for content that was never inserted (#269 CR-3).
	try { pmView.pasteHTML(cleaned); } catch (err) { return; }
	// Ask the host to weigh the kept/dropped honesty notice (#256). The host owns the notification service and the
	// docx-import converter the notice reuses, so it computes wordPasteNotice(html) and shows a quiet toast only
	// when something was genuinely dropped (tracked-change marks, comments) - a lossless paste raises nothing.
	// Only Word/Office payloads carry droppable structure; a plain-HTML table paste needs no notice, so skip it.
	if (isWordHtml(html)) { try { vscode.postMessage({ type: 'wordPaste', html: html }); } catch (err) {} }
}, true);
// Hovering a bound figure (or its marked gutter number) floats a quiet tooltip answering "where from, how
// fresh" (plan 29 iter 3): the source file/endpoint, the cell within it, the relative sync time, and an amber
// "source changed" line when stale. Click still opens the source drawer (unchanged) - the tooltip is
// pointer-events:none so it never intercepts that click. Delegated on root so it survives the innerHTML swaps.
// A gutter number carries no data-key itself; resolve the key from the bound figure inside its block, and only
// fire when the pointer is over the number's gutter lane (clientX left of the block), so reading text stays quiet.
function gutterKeyFor(node){ const bound = node.querySelector('span.bound[data-key]'); return bound ? bound.getAttribute('data-key') : null; }
root.addEventListener('mouseover', e => {
	const fig = e.target.closest && e.target.closest('span.bound[data-key]');
	if (fig) { return showTip(fig, fig.getAttribute('data-key')); }
	const g = e.target.closest && e.target.closest('.pm-num.bound, .pm-num.pending');
	if (!g) { return; }
	const box = g.getBoundingClientRect();
	if (e.clientX > box.left) { return; }
	const key = gutterKeyFor(g);
	if (key) { showTip(g, key); }
});
root.addEventListener('mouseout', e => {
	const from = e.target.closest && (e.target.closest('span.bound[data-key]') || e.target.closest('.pm-num.bound, .pm-num.pending'));
	if (from) { hideTip(); }
});
root.addEventListener('focusout', e => {
	const b = e.target.closest('[data-block]');
	if (b) { const text = b.innerText.replace(/\\s+/g, ' ').trim(); if (text !== b.getAttribute('data-orig')) { vscode.postMessage({ type: 'edit', blockId: b.getAttribute('data-block'), text: text }); } }
});
// Scroll a pending change's inline diff into view and flash it (rail-to-editor navigation, plan 19 iter 2).
// The change's accept/reject widget carries data-approve="<id>"; reveal its surrounding diff/insert block.
// A short timeout lets the just-applied decorations lay out before we measure/scroll.
// Landing on a change also PROMOTES it: at two or more pending changes only one is drawn as a card, so a
// rail deep-link that scrolled to a quiet marker would have shown the reader a label rather than a decision.
// Un-quieting first means the rail always lands on the thing it promised.
function focusChange(id){ setTimeout(function(){ try { const el = root.querySelector('[data-approve="' + id + '"]'); const block = el && el.closest('.editblock, .insertblock'); if (block) { openCardBlock(block); block.scrollIntoView({ block: 'center', behavior: 'smooth' }); block.classList.add('lwd-focus-flash'); setTimeout(function(){ block.classList.remove('lwd-focus-flash'); }, 1600); } } catch (e) {} }, 30); }
// Promote a quiet pending marker to the full decision card. Exactly one card is open at a time, which is
// what makes "one canonical decision point" true rather than aspirational: opening a second would put the
// reader back in front of a stack of cards, which is the thing comp 2b exists to prevent.
function openCardBlock(block){ if (!block){ return; } const open = root.querySelectorAll('.editblock:not(.quiet), .insertblock:not(.quiet)'); for (let i = 0; i < open.length; i++){ if (open[i] !== block){ open[i].classList.add('quiet'); } } block.classList.remove('quiet'); }
function openCard(id){ const el = root.querySelector('[data-approve="' + id + '"]'); const block = el && el.closest('.editblock, .insertblock'); if (block){ openCardBlock(block); block.scrollIntoView({ block: 'center', behavior: 'smooth' }); } }
// "Review each": open the FIRST waiting change in document order and land on it, then let the reader work
// down the document. Deliberately not a modal queue - the changes live in the page, so the page is the queue.
function openFirstCard(){ const first = root.querySelector('.editblock, .insertblock'); if (first){ openCardBlock(first); first.scrollIntoView({ block: 'center', behavior: 'smooth' }); } }
// Scroll the surface to the Nth heading and flash it (Outline-to-editor navigation, issue #181). The doc
// renders one <h1..h6> per heading block in document order, so \`index\` (the heading's ordinal from
// buildOutline) selects the matching element. A short timeout lets a just-mounted body lay out first.
function revealHeading(index){ setTimeout(function(){ try { const scope = (pmView && pmView.dom) || root; const heads = scope.querySelectorAll('h1, h2, h3, h4, h5, h6'); const head = heads[index]; if (head) { head.scrollIntoView({ block: 'start', behavior: 'smooth' }); head.classList.add('lwd-focus-flash'); setTimeout(function(){ head.classList.remove('lwd-focus-flash'); }, 1600); } } catch (e) {} }, 30); }
// Scroll the surface to the Nth top-level block and flash it (Home NEEDS-YOU deep link, plan 48 H2.3u). One
// address per Markdown block (the D1 wrap rule), and the doc renders one top-level PM node per block in
// document order, so \`index\` (the block's 0-based ordinal, recomputed host-side from the durable block id via
// the address model) selects the matching element. A negative/out-of-range index (a block that was deleted -
// the address model returned undefined) is a no-op: the doc still opened with the Review tab, no scroll (the
// spec-3.1 graceful degrade). A short timeout lets a just-mounted body lay out first.
function revealBlock(index){ if (typeof index !== 'number' || index < 0) { return; } setTimeout(function(){ try { const scope = (pmView && pmView.dom) || root; const block = scope.children[index]; if (block) { block.scrollIntoView({ block: 'center', behavior: 'smooth' }); block.classList.add('lwd-focus-flash'); setTimeout(function(){ block.classList.remove('lwd-focus-flash'); }, 1600); } } catch (e) {} }, 30); }
// ---- In-place table cell editing (issue #140) -------------------------------------------------
// The shipped bundle renders a GFM table as a static \`table.lwd-table\` atom (contenteditable=false):
// clicking a cell node-selects the whole table, and the next printable key REPLACES it (a one-keystroke
// wipe). This shim keeps the atom but layers an edit affordance over it, all through history-friendly
// \`setNodeMarkup\` transactions on the node's \`markdown\` attr (one undo step per commit / structural op,
// and the normal pmEdit save path fires). The pure GFM helpers injected above do the string work.
function tablesInView(){ return pmView ? Array.prototype.slice.call(pmView.dom.querySelectorAll('table.lwd-table')) : []; }
// Resolve the Nth table_block node (document order === DOM order for block atoms) to { pos, node }.
// Index mapping is robust to two tables with identical content and to the atom being rebuilt on edit.
function tableNodeByIndex(idx){ if (!pmView || idx < 0) { return null; } let seen = -1, found = null; pmView.state.doc.descendants(function(node, pos){ if (node.type && node.type.name === 'table_block'){ seen++; if (seen === idx){ found = { pos: pos, node: node }; } return false; } return true; }); return found; }
function edTableEl(){ return tblEditor ? tablesInView()[tblEditor.tIdx] : null; }
// r < 0 => a header (thead) cell; r >= 0 => a body (tbody) row. cellIndex gives the column.
function cellCoords(tableEl, cell){ const c = cell.cellIndex; if (cell.closest('thead')){ return { r: -1, c: c }; } const tbody = tableEl.querySelector('tbody'); const r = tbody ? Array.prototype.indexOf.call(tbody.rows, cell.parentNode) : 0; return { r: r, c: c }; }
function cellAt(tableEl, coords){ if (!tableEl){ return null; } if (coords.r < 0){ const thead = tableEl.querySelector('thead'); const hr = thead && thead.rows[0]; return hr ? hr.cells[coords.c] : null; } const tbody = tableEl.querySelector('tbody'); const row = tbody && tbody.rows[coords.r]; return row ? (row.cells[coords.c] || null) : null; }
function cellRawText(node, r, c){ const t = parseGfmTable(node.attrs.markdown || ''); if (r < 0){ return t.header[c] || ''; } return (t.rows[r] && t.rows[r][c] != null) ? t.rows[r][c] : ''; }
// Position a fixed overlay exactly over a cell (both are viewport-anchored, so no reflow coupling).
function placeOver(el, cell){ const b = cell.getBoundingClientRect(); el.style.left = b.left + 'px'; el.style.top = b.top + 'px'; el.style.width = b.width + 'px'; el.style.height = b.height + 'px'; }
function teardownCellInput(){ if (tblToolbar){ if (tblToolbar.parentNode){ tblToolbar.parentNode.removeChild(tblToolbar); } tblToolbar = null; } if (!tblEditor){ return; } const ed = tblEditor; tblEditor = null; ed.input.removeEventListener('keydown', onCellKey); ed.input.removeEventListener('blur', onCellBlur); if (ed.input.parentNode){ ed.input.parentNode.removeChild(ed.input); } }
// After a re-render that KEPT the live PM node, re-anchor the open overlay over its (surviving) cell;
// if the cell is gone (its column/row was removed by the re-render), close the editor cleanly.
function revalidateCellEditor(){ if (!tblEditor){ return; } const tableEl = tablesInView()[tblEditor.tIdx]; const cell = cellAt(tableEl, { r: tblEditor.r, c: tblEditor.c }); if (!cell){ teardownCellInput(); return; } placeOver(tblEditor.input, cell); if (tblToolbar && tableEl){ const b = tableEl.getBoundingClientRect(); tblToolbar.style.left = b.left + 'px'; tblToolbar.style.top = Math.max(6, b.top - tblToolbar.offsetHeight - 6) + 'px'; } }
// Dispatch a single node-attr transaction: history-friendly (one undo step) and docChanged -> pmEdit save.
function dispatchTableMd(pos, md){ if (!pmView){ return; } pmView.dispatch(pmView.state.tr.setNodeMarkup(pos, null, { markdown: md })); enrichBoundFigures(); }
// Write the open editor's current value into the model and dispatch it (no-op when unchanged). Returns
// the { pos, node } AFTER dispatch so callers can chain a follow-up (Tab / structural op) off fresh state.
function commitCell(){ if (!tblEditor){ return null; } const ed = tblEditor; const loc = tableNodeByIndex(ed.tIdx); if (!loc){ return null; } const cur = cellRawText(loc.node, ed.r, ed.c); if (ed.input.value !== cur){ dispatchTableMd(loc.pos, serializeGfmTable(setCell(parseGfmTable(loc.node.attrs.markdown || ''), ed.r, ed.c, ed.input.value))); return tableNodeByIndex(ed.tIdx); } return loc; }
function openCellAt(tIdx, coords){ const tableEl = tablesInView()[tIdx]; const loc = tableNodeByIndex(tIdx); if (!tableEl || !loc){ return; } const cell = cellAt(tableEl, coords); if (!cell){ return; } const input = document.createElement('input'); input.type = 'text'; input.className = 'lwd-cell-editor'; input.setAttribute('aria-label', 'Edit table cell'); input.value = cellRawText(loc.node, coords.r, coords.c); document.body.appendChild(input); placeOver(input, cell); tblEditor = { input: input, tIdx: tIdx, r: coords.r, c: coords.c }; input.addEventListener('keydown', onCellKey); input.addEventListener('blur', onCellBlur); showTableToolbar(tableEl); input.focus(); input.select(); }
function onCellBlur(){ if (!tblEditor){ return; } commitCell(); teardownCellInput(); }
function onCellKey(e){ if (e.key === 'Enter'){ e.preventDefault(); commitCell(); teardownCellInput(); return; } if (e.key === 'Escape'){ e.preventDefault(); teardownCellInput(); return; } if (e.key === 'Tab'){ e.preventDefault(); moveCell(e.shiftKey ? -1 : 1); return; } }
// Tab/Shift+Tab: commit, then open the next/previous cell (wraps across rows). Tab past the last cell
// appends an empty row (Word muscle memory). All re-location is by tIdx off post-dispatch state.
function moveCell(dir){ const ed = tblEditor; if (!ed){ return; } const tIdx = ed.tIdx, r = ed.r, c = ed.c; const loc = commitCell(); teardownCellInput(); if (!loc){ return; } let t = parseGfmTable(loc.node.attrs.markdown || ''); const cols = t.header.length; if (!cols){ return; } let nr = r, nc = c; if (dir > 0){ nc = c + 1; if (nc >= cols){ nc = 0; nr = r + 1; } if (nr >= 0 && nr >= t.rows.length){ t = insertRow(t, t.rows.length); dispatchTableMd(loc.pos, serializeGfmTable(t)); nr = t.rows.length - 1; nc = 0; } } else { nc = c - 1; if (nc < 0){ nc = cols - 1; nr = r - 1; } if (nr < -1){ return; } } openCellAt(tIdx, { r: nr, c: nc }); }
// The floating +/- Row/Col affordance shown while a cell editor is open. Buttons preventDefault on
// mousedown so the cell input keeps focus (no premature blur-commit); each op folds the in-progress
// cell value in and dispatches ONE setNodeMarkup (one undo step), then reopens an editor to keep flow.
function showTableToolbar(tableEl){ if (tblToolbar){ if (tblToolbar.parentNode){ tblToolbar.parentNode.removeChild(tblToolbar); } tblToolbar = null; } const bar = document.createElement('div'); bar.className = 'lwd-table-tools'; bar.innerHTML = '<button data-tblop="row+" title="Add a row below">+ Row</button><button data-tblop="col+" title="Add a column to the right">+ Col</button><button data-tblop="row-" title="Delete this row">\\u2212 Row</button><button data-tblop="col-" title="Delete this column">\\u2212 Col</button>'; document.body.appendChild(bar); const b = tableEl.getBoundingClientRect(); bar.style.left = b.left + 'px'; bar.style.top = Math.max(6, b.top - bar.offsetHeight - 6) + 'px'; bar.addEventListener('mousedown', onTableToolMousedown); tblToolbar = bar; }
function onTableToolMousedown(e){ const btn = e.target.closest && e.target.closest('button[data-tblop]'); if (!btn){ return; } e.preventDefault(); applyTableOp(btn.getAttribute('data-tblop')); }
function applyTableOp(op){ const ed = tblEditor; if (!ed){ return; } const tIdx = ed.tIdx; const loc = tableNodeByIndex(tIdx); if (!loc){ return; } let t = setCell(parseGfmTable(loc.node.attrs.markdown || ''), ed.r, ed.c, ed.input.value); let fr = ed.r, fc = ed.c; if (op === 'row+'){ const at = ed.r + 1; t = insertRow(t, at); fr = at < 0 ? 0 : at; fc = ed.c; } else if (op === 'col+'){ const at = ed.c + 1; t = insertCol(t, at); fc = at; } else if (op === 'row-'){ if (ed.r < 0 || t.rows.length === 0){ return; } t = deleteRow(t, ed.r); if (!t.rows.length){ fr = -1; fc = ed.c; } else { fr = Math.min(ed.r, t.rows.length - 1); } } else if (op === 'col-'){ if (t.header.length <= 1){ return; } t = deleteCol(t, ed.c); fc = Math.min(ed.c, t.header.length - 1); } else { return; } teardownCellInput(); dispatchTableMd(loc.pos, serializeGfmTable(t)); openCellAt(tIdx, { r: fr, c: fc }); }
// Capture-phase mousedown on a cell: stop PM's node-select (the wipe trap can't even arm), commit any
// open editor first (may rebuild this table's DOM), then open the target cell resolved by table index.
// The wedge exception (#254): a bound figure inside a cell is the product's provenance door - a single click
// on it opens the source drawer (the advertised "click a figure to trace it back to the source" gesture), NOT
// the table cell editor. Cell editing stays reachable by a deliberate second gesture: double-click the figure
// (or single-click the cell's non-figure area) still opens the editor. Detected here because this capture-phase
// mousedown runs BEFORE the bubble-phase root click handler could ever see the figure, so the reveal must fire
// from here (posting reveal directly) rather than being left to the click delegate.
function onTableCellMousedown(e){ const cell = e.target.closest && e.target.closest('td, th'); if (!cell){ return; } const tableEl = cell.closest && cell.closest('table.lwd-table'); if (!tableEl || !pmView || !pmView.dom.contains(tableEl)){ return; }
	const fig = e.target.closest && e.target.closest('span.bound[data-key]');
	if (fig && e.detail < 2){ e.preventDefault(); e.stopPropagation(); if (tblEditor){ commitCell(); teardownCellInput(); } focusFigure(fig); return vscode.postMessage({ type: 'reveal', cells: [fig.getAttribute('data-key')] }); }
	// A wikilink inside a table cell gets the SAME wedge exception: a single click follows the link rather
	// than opening the cell editor; the cell stays editable by clicking its non-link area or double-clicking.
	const wcell = e.target.closest && e.target.closest('span.wikilink[data-target]');
	if (wcell && e.detail < 2){ e.preventDefault(); e.stopPropagation(); if (tblEditor){ commitCell(); teardownCellInput(); } return openWikilink(wcell); }
	e.preventDefault(); e.stopPropagation(); const tIdx = tablesInView().indexOf(tableEl); const coords = cellCoords(tableEl, cell); if (tblEditor){ commitCell(); teardownCellInput(); } openCellAt(tIdx, coords); }
// Capture-phase keydown guard: while a table atom is node-selected, a single printable key would replace
// it. Block that (the data-loss trap). Delete/Backspace still delete the table (a visible, undoable act);
// Ctrl/Meta chords (copy/cut) pass through. Skipped while a cell editor is open (its own input owns keys).
function onPmKeydownCapture(e){ if (tblEditor){ return; } const sel = pmView && pmView.state.selection; const node = sel && sel.node; if (node && node.type && node.type.name === 'table_block'){ if (e.key && e.key.length === 1 && !e.ctrlKey && !e.metaKey){ e.preventDefault(); } } }
function wireTableEditing(){ if (!pmView || pmView.__lwdTableWired){ return; } pmView.__lwdTableWired = true; pmView.dom.addEventListener('mousedown', onTableCellMousedown, true); pmView.dom.addEventListener('keydown', onPmKeydownCapture, true); }
// The doc scrolls inside the webview and a focus()/select() on the fixed overlay can itself scroll it
// into view; keep the overlay glued to its cell by repositioning on any scroll (capture catches inner
// scrollers too) rather than tearing it down - so opening a cell can never be undone by a stray scroll.
window.addEventListener('scroll', function(){ revalidateCellEditor(); }, true);
window.addEventListener('resize', function(){ revalidateCellEditor(); });
${FIND_WIDGET_RUNTIME}
window.addEventListener('message', e => { const m = e.data;
	if (m && m.type === 'lwdRender') { applyUpdate(m.html, m.pmMd, m.pmDeco, m.pmReset); findRefresh(); }
	// The workspace's document names changed (one created, renamed or deleted): re-mark every chip, so a link
	// that was unresolved a moment ago reads as resolved without a reload.
	else if (m && m.type === 'lwdDocs') { if (Array.isArray(m.names)) { _docNames = m.names; enrichWikilinks(); if (wikiPicker) { refreshWikiPicker(); } } }
	// The host's Cmd+F action (fired when focus sits in the pane host rather than in this frame).
	else if (m && m.type === 'findOpen') { openFind(); }
	else if (m && m.type === 'focusChange') { focusChange(m.id); }
	else if (m && m.type === 'revealHeading') { revealHeading(m.headingIndex); }
	else if (m && m.type === 'revealBlock') { revealBlock(m.blockIndex); }
	// The host wrote the pasted/dropped image beside the doc and returns its doc-relative path; insert it.
	else if (m && m.type === 'imageSaved') { if (typeof m.relPath === 'string') { insertImage(m.relPath, m.alt); } }
	// The host resolved a relative image to a data URI (or flagged it unreadable): cache + swap, or mark broken.
	else if (m && m.type === 'imageResolved') { const key = (typeof m.src === 'string') ? m.src : _imgReq[m.reqId]; if (m.reqId) { delete _imgReq[m.reqId]; } if (key) { delete _imgPending[key]; if (m.dataUri) { _imgCache[key] = m.dataUri; applyResolvedImg(key, m.dataUri); } else { _imgBroken[key] = true; markBrokenImg(key); } } }
});
if (typeof window.__LWD_PM_MD === 'string') { mountPm(window.__LWD_PM_MD, window.__LWD_PM_DECO); }
vscode.postMessage({ type: 'lwdReady' });`;

// One resolved decoration with its host-rendered widget HTML, ready for the bundle to place. An edit is
// placed by `blockOrdinal` (docs/30 section 4.3) with `anchorText` only as the fallback for a block that
// could not be addressed; an insert is still placed after the node matching `afterText`.
interface IPmDecoEdit { readonly id: string; readonly blockOrdinal?: number; readonly anchorText: string; readonly html: string }
interface IPmDecoInsert { readonly id: string; readonly afterText: string | null; readonly html: string }
/** The decoration payload pushed to the webview: pending diffs/inserts (with widget HTML) + gutter markers. */
export interface IPmDecoPayload {
	readonly edits: readonly IPmDecoEdit[];
	readonly inserts: readonly IPmDecoInsert[];
	readonly gutters: readonly IPmGutterMarker[];
	/** The ordered per-block numbered-rail entries (spec 43 section 3.1 / pin 9): one number per Markdown block. */
	readonly numbers: readonly IBlockGutterEntry[];
	/** Per-key provenance the RUNTIME reads to build the hover tooltip (plan 29, iter 3); [] for plain docs. */
	readonly provenance: readonly IPmProvenance[];
}

// Render the word-diff runs to the same inline add/del markup the renderDoc surface uses (one look).
function renderDiffSegments(segments: readonly IPmDiffSegment[]): string {
	return segments.map(s => {
		const t = esc(s.text);
		return s.t === 'del' ? `<span class="d-o">${t}</span>` : s.t === 'ins' ? `<span class="d-n">${t}</span>` : t;
	}).join(' ');
}

// The decision card's head row (comp 2a): the mono kind badge on the left ("MEANING CHANGE - NEEDS YOUR
// CALL" for a meaning change, "FIGURE" for a figure), the block's address beside it, then the reusable
// provenance atom pushed right. The confidence moved OUT of this row: the comp puts it in the button row as
// a word next to the verbs it qualifies, where it is read at the moment of deciding rather than skimmed past.
function pmFramingHtml(f: IReviewFraming, addr: string, provenanceAtom: string): string {
	const kindClass = f.kindAttention ? 'fr-kind attn' : 'fr-kind ok';
	return `<div class="frame"><span class="${kindClass}">${esc(f.kindLabel)}</span>${addr}${provenanceAtom}</div>`;
}

// The reusable provenance atom - ONE shape everywhere it appears (comp 2a's card, comp 4d's drawer, the
// rail): "from <source> - synced <when>", with the source in mono indigo because a file name is a
// provenance fact and a door to it. The synced half is only rendered when a real lock entry backs it: a
// figure whose source has never synced must not be handed a freshness it does not have.
function provenanceAtomHtml(source: string, provenance: readonly IPmProvenance[]): string {
	if (!source) { return ''; }
	const match = provenance.find(p => p.source === source);
	const synced = match ? ` &middot; ${esc(match.synced.toLowerCase())}` : '';
	return `<span class="fr-prov">from <span class="src">${esc(source)}</span>${synced}</span>`;
}

// THE DECISION CARD (comp 2a) - the canonical decision point, and the most important markup in the product.
// In order: the head row (kind badge, address, provenance atom), the changed paragraph carrying word-grain
// diff spans, the model's reason as a "Why:" line, then the hairline rule and the one button row.
//
// `quiet` renders the SAME widget as a pending marker instead (comp 2b): at two or more pending changes only
// the focused one is a card, so the document stays readable rather than being shredded into a stack of
// cards. Both states live in one widget on purpose - the card is merely hidden, so the change keeps its
// `data-approve` anchor and the host's widget census (`reportWidgets`) and the rail's `focusChange` deep
// link both keep working unchanged; opening the marker just un-hides what is already there.
function pmEditWidgetHtml(e: IPmEditDecoration, bar: boolean, provenance: readonly IPmProvenance[], quiet: boolean): string {
	// The gutter address (spec 43 section 3.1 / pin 11): the widget's mono tag row cites "Line N" so the change,
	// the gutter number and the rail card all speak one address vocabulary. Omitted when the block is gone.
	const addr = typeof e.addressLine === 'number' ? `<span class="src pm-addr">${esc(addressLabel(e.addressLine))}</span>` : '';
	// A multi-line edited paragraph carries the `attention` provenance bar (C2): it hangs a 3px bar in the
	// gutter column spanning the widget's rows. Single-line edits get no bar (nothing to span).
	const barClass = bar ? ' pm-edit-bar' : '';
	const f = reviewFraming(e, e.source);
	const framing = pmFramingHtml(f, addr, provenanceAtomHtml(e.source, provenance));
	// The model's reason, verbatim, under the diff. Absent when the model gave none - no filler sentence.
	const why = f.rationale ? `<div class="editwhy">Why: ${esc(f.rationale)}</div>` : '';
	// Confidence is a WORD, never a percentage (doc 28): the model's number is a calibration artefact, and
	// showing it invites arithmetic on a judgement it cannot actually support.
	const conf = `<span class="conf">confidence: ${esc(f.confidence)}</span>`;
	// Tweak (amend-before-approve, plan 31 iter 3, D31-A): Edit opens an in-place editor over the proposed
	// text. `Save & approve` amends the pending change then approves it through the one approve path;
	// `Cancel` restores. Hidden for a figure (figures come from sources; not hand-editable).
	const canTweak = e.kind !== 'figure';
	const tweakBtn = canTweak ? `<button class="tweak" data-tweak="${esc(e.id)}" title="Edit the proposed text">Edit</button>` : '';
	const editor = canTweak
		? `<div class="tweakwrap"><div class="tweakedit" contenteditable="true" data-orig="${esc(e.newText)}">${esc(e.newText)}</div></div>`
		: '';
	const tweakActs = canTweak
		? `<span class="acts tweakacts"><button class="approve" data-tweak-save="${esc(e.id)}">Save &amp; approve</button>`
		+ `<button class="reject" data-tweak-cancel="${esc(e.id)}">Cancel</button></span>`
		: '';
	// The quiet marker shows the paragraph AS IT STANDS (the block the widget replaced), dimmed one ink step,
	// so bulk review never hides the document from the person reviewing it.
	const waitLabel = e.kind === 'figure' ? 'Figure waiting' : 'Rewrite waiting';
	const mark = `<div class="pendmark"><p class="pw-text">${esc(e.anchorText)}</p>`
		+ `<div class="pw-row"><span class="pw-lab">${waitLabel}</span>`
		+ `<button class="pw-open" data-open-card="${esc(e.id)}">review it here &rarr;</button></div></div>`;
	return `<div class="pcell editblock${barClass}${quiet ? ' quiet' : ''}" data-editcard="${esc(e.id)}">`
		+ mark
		+ `<div class="editcard">`
		+ framing
		+ `<p class="editp">${renderDiffSegments(e.segments)}</p>`
		+ editor
		+ why
		+ `<div class="ctrl">`
		+ `<span class="acts normacts"><button class="approve" data-approve="${esc(e.id)}">Approve</button>`
		+ `${tweakBtn}<button class="reject" data-reject="${esc(e.id)}">Reject</button></span>${tweakActs}`
		+ conf
		+ `</div></div></div>`;
}

// The all-additions widget for a generative insertion. It wears the same card as a meaning change - it is
// equally a decision waiting on a human - with the arriving content in the green "this block is changing"
// block, and the same quiet marker when it is not the focused decision.
function pmInsertWidgetHtml(ins: IPmInsertDecoration, quiet: boolean): string {
	const f = reviewFraming(ins, 'Chat');
	const framing = pmFramingHtml(f, '', `<span class="fr-prov">from <span class="src">Chat</span></span>`);
	const why = f.rationale ? `<div class="editwhy">Why: ${esc(f.rationale)}</div>` : '';
	const mark = `<div class="pendmark">`
		+ `<div class="pw-row"><span class="pw-lab">New content waiting</span>`
		+ `<button class="pw-open" data-open-card="${esc(ins.id)}">review it here &rarr;</button></div></div>`;
	return `<div class="pcell insertblock${quiet ? ' quiet' : ''}">`
		+ mark
		+ `<div class="editcard">`
		+ framing
		+ `<div class="insertbody">${renderGenericMarkdown(ins.newText)}</div>`
		+ why
		+ `<div class="ctrl"><span class="cdot add"></span>`
		+ `<span class="lbl">Inserted after ${esc(ins.blockLabel)}</span>`
		+ `<span class="acts"><button class="approve" data-approve="${esc(ins.id)}">Approve</button>`
		+ `<button class="reject" data-reject="${esc(ins.id)}">Reject</button></span>`
		+ `<span class="conf">confidence: ${esc(f.confidence)}</span>`
		+ `</div></div></div>`;
}

// Build the decoration payload for the PM surface: the pure spec (TDD'd) augmented with widget HTML.
// ONE canonical decision point (comp 2a's correction): the first pending change in the payload renders as
// the full card and every other renders as a quiet marker, so a document with four pending changes still
// reads as a document. The rail can promote any of them by deep-linking to it (focusChange un-quiets it).
function renderPmDeco(doc: ILivingDoc, pending: readonly IProposedChange[], recent: ReadonlySet<string>, provenance: readonly IPmProvenance[]): IPmDecoPayload {
	const spec = buildPmDecorationSpec(doc, pending, recent);
	// The gutter bar for a multi-line edited paragraph hangs off that edit's visible widget (the original
	// node is hidden), so map the bar anchors onto the edit ids they belong to.
	const barAnchors = new Set(spec.gutters.filter(g => g.kind === 'bar').map(g => g.anchorText));
	return {
		edits: spec.edits.map((e, i) => ({
			id: e.id,
			...(e.blockOrdinal !== undefined ? { blockOrdinal: e.blockOrdinal } : {}),
			anchorText: e.anchorText,
			html: pmEditWidgetHtml(e, barAnchors.has(e.anchorText), provenance, i > 0),
		})),
		inserts: spec.inserts.map((ins, i) => ({ id: ins.id, afterText: ins.afterText, html: pmInsertWidgetHtml(ins, spec.edits.length > 0 || i > 0) })),
		gutters: spec.gutters,
		numbers: spec.numbers,
		provenance,
	};
}

/** The dynamic part of the doc surface: the body HTML, the Markdown to mount in ProseMirror (or null when
 * the surface is not a live PM editor - raw mode or no doc), and the PM decoration payload (or null). */
export interface ILivingDocContent {
	readonly html: string;
	readonly pmMd: string | null;
	readonly pmDeco: IPmDecoPayload | null;
}

// THE STICKY BULK REVIEW BAR (comp 2b), plus the cross-document review cycle it also carries (plan 19 iter
// 4 + 5). Its states:
//  - two or more changes here: the dot, the count sentence with its kind breakdown, "Review each", and a
//    QUIET "Approve all..." (a bulk verb is never a filled button, and the host raises a confirm);
//  - exactly one change here: NO bulk verb at all (comp 2a) - the card in the document is the decision, and
//    a bar offering to approve it in bulk is just a second, heavier way to press its own Approve. The bar
//    then exists only to carry the cross-document route, and only when there is somewhere to go;
//  - this doc is clear but others still have changes: the all-clear green, a tick, and the way onwards;
//  - nothing pending anywhere: no bar. Its disappearance IS the "done" signal (plan 19 iter 7) - there is no
//    persistent status pill anywhere in round 2.
//
// The cross-document route is BIDIRECTIONAL (docs/30 section 4.3): review is not monotonic, so a reviewer who
// steps past a document - or who wants to re-read the decision they just made - can walk back. Previous sits
// immediately left of Next, the same quiet `rv-btn` in the same slot, so the pair reads as one control.
function docReviewBar(pending: readonly IProposedChange[], totalPendingCount: number, nextChangedDocTitle: string | undefined, prevChangedDocTitle: string | undefined): string {
	const pendingCount = pending.length;
	if (totalPendingCount <= 0) {
		return '';
	}

	// Drawn only when the ring has somewhere else to go in that direction. With exactly two changed documents
	// both point at the same one, which is correct: either verb reaches the only other document there is.
	const prev = prevChangedDocTitle
		? `<button class="rv-btn" data-prev-doc title="${esc(localize('livingDocs.review.prevDocTitle', "Go to {0}", prevChangedDocTitle))}">&larr; ${esc(localize('livingDocs.review.prevDoc', "Previous document"))}</button>`
		: '';
	const next = nextChangedDocTitle
		? `<button class="rv-btn" data-next-doc title="${esc(localize('livingDocs.review.nextDocTitle', "Go to {0}", nextChangedDocTitle))}">${esc(localize('livingDocs.review.nextDoc', "Next document"))} &rarr;</button>`
		: '';
	const othersHavePending = totalPendingCount > pendingCount;
	// A bulk verb across documents is the widest gesture in the product, so it is the quietest control.
	const approveEverywhere = othersHavePending
		? `<button class="rv-quiet" data-approve-all-everywhere title="Approve every pending change across all documents">Approve everywhere&#8230;</button>`
		: '';

	if (pendingCount === 0) {
		// This document is clear, but the review is not finished - keep the cycle moving to the next doc.
		return `<div class="reviewbar clear">`
			+ `<span class="rv-clear"><span class="rv-tick">&#10003;</span>This document is clear</span>`
			+ `<span class="rv-spacer"></span>${prev}${next}${approveEverywhere}</div>`;
	}

	if (pendingCount === 1) {
		// No bulk verbs at n=1. With nowhere else to go there is nothing for the bar to say that the card in
		// the document does not already say better, so it is not drawn at all.
		if (!prev && !next && !approveEverywhere) {
			return '';
		}
		return `<div class="reviewbar"><span class="rv-dot"></span>`
			+ `<span class="rv-say"><strong>1 change</strong> waiting in this document - decide it in the document.</span>`
			+ `<span class="rv-spacer"></span>${prev}${next}${approveEverywhere}</div>`;
	}

	// The count sentence names the KINDS, because "1 meaning - 3 figures" is the fact that tells a reader
	// whether this is a careful read or a glance. Both halves are real counts off the pending set.
	const meaning = pending.filter(c => c.kind === 'meaning').length;
	const figures = pendingCount - meaning;
	const parts: string[] = [];
	if (meaning > 0) { parts.push(`${meaning} meaning`); }
	if (figures > 0) { parts.push(`${figures} figure${figures === 1 ? '' : 's'}`); }
	const breakdown = parts.length ? ` - ${parts.join(' &middot; ')}` : '';
	return `<div class="reviewbar"><span class="rv-dot"></span>`
		+ `<span class="rv-say"><strong>${pendingCount} changes</strong> waiting in this document${breakdown}</span>`
		+ `<span class="rv-spacer"></span>${prev}${next}`
		+ `<button class="rv-btn" data-review-each title="Open the first change in the document">Review each</button>`
		// The ellipsis is a promise that a dialog follows, so it is drawn only when this exact set would raise
		// one (docs/30 I4). A small figures-only set here is genuinely one click, and says so.
		+ `<button class="rv-quiet" data-approve-all-doc title="Approve every pending change in this document">Approve all${buildBulkSet({ verb: 'approve', docId: pending[0].docId }, pending).confirmNeeded ? '&#8230;' : ''}</button>`
		+ approveEverywhere
		+ `</div>`;
}

export function renderLivingDocContent(input: ILivingDocRenderInput): ILivingDocContent {
	const { doc, pending, dirty, recent, mode, rawText } = input;
	const isLiving = !!doc?.isLiving;

	// PM is the single editing surface for every document (plan 15 iter 5); the chrome shows in 'pm' mode.
	const isPm = mode === 'pm';

	// (plan 44-b) The per-document brand/crumb top bar is gone: the one global Abstract header (the repurposed
	// title bar) now carries the breadcrumb, the sync pill and the Present action. The editor pane publishes
	// this document's header content (breadcrumb, sync state, Present action) to IAbstractHeaderService.
	// In raw mode we keep a slim in-webview bar with the one way back to the PM surface (apply the raw text).
	const rawTop = mode === 'raw'
		? `<div class="rawtop"><button class="toggle" data-apply-raw>&#10003; Done editing source</button></div>`
		: '';

	const modal = input.present.open && doc ? renderPresentModal(input.present, doc.title) : '';

	// The comp's persistent calm formatting toolbar (sticks under the 48px top bar). Formatting essentials
	// only - a borderless heading dropdown, B/I, list/ordered/quote - and a quiet "Saved" status. Every
	// control drives the live ProseMirror view through LWDPM.cmd via [data-pmcmd] (plan 15 iter 5); the
	// names map 1:1 onto the bundle's COMMANDS. Underline is dropped (Markdown / the commonmark schema has
	// no underline mark - calm by subtraction). The comp also dropped Link-to-source / Run-skill / History.
	// plan 16 iter 6 (decision 59): the formatting toolbar shows for EVERY document in PM, plain or living --
	// PM is the one editing surface (decision 53), and a plain notes doc is just as writable, so it was wrong
	// to gate the toolbar on `isLiving` (a blank new doc opened with no way to format). The sync bar + the
	// bound-figure hint stay living-only (a plain doc has no sources/figures), but B/I/headings/lists are
	// universal.
	const docToolbar = (!!doc && isPm)
		? `<div class="etoolbar">`
		+ `<select class="tb-h" data-pmcmd title="Paragraph style">`
		+ `<option value="paragraph">Paragraph</option>`
		+ `<option value="h1">Heading 1</option>`
		+ `<option value="h2">Heading 2</option>`
		+ `<option value="h3">Heading 3</option>`
		+ `</select>`
		+ `<span class="tb-div"></span>`
		+ `<button class="tb-b bold" data-pmcmd="bold" title="Bold">B</button>`
		+ `<button class="tb-b ital" data-pmcmd="italic" title="Italic">I</button>`
		+ `<span class="tb-div"></span>`
		+ `<button class="tb-b ic" data-pmcmd="bullet_list" title="Bulleted list">&#8803;</button>`
		+ `<button class="tb-b ic" data-pmcmd="ordered_list" title="Numbered list">&#8862;</button>`
		+ `<button class="tb-b ic" data-pmcmd="blockquote" title="Quote">&#10077;</button>`
		// The right side (plan 45 pin 8 / P8.1): exactly Ask AI, Properties and the Saved chip (with vN),
		// pushed right as one group (tb-right's margin-left:auto), nothing else. Ask AI opens the Chat rail;
		// Properties toggles the inset panel (P8.2); the Saved chip stays the honest save/version status.
		+ `<span class="tb-right">`
		// allow-any-unicode-next-line
		+ `<button class="tb-ai" data-ask-ai title="Ask AI">&#10022; Ask AI</button>`
		+ `<button class="tb-props${input.properties?.open ? ' on' : ''}" data-props-toggle title="Properties"><span class="tb-props-glyph">&#9776;</span>Properties</button>`
		// Honest save/version chip (plan 26 iter 4): `Saved` after persist (the RUNTIME flips it to
		// `Saving...` during the 300ms debounce window), plus `&middot; vN` when the document has saved
		// versions - N is the real snapshot count from the lock, never the fabricated v14. In the web dev
		// harness (issue #121 / decision 162) the mount is in-memory and writes are lost on reload, so the
		// chip says so in plain words with a tooltip instead of claiming a durable save the tab can't back.
		+ (input.ephemeral
			? `<span class="tb-saved tb-ephemeral" title="Dev harness: this web build keeps your changes in memory only, so they are lost when you reload or close the tab. The desktop app saves to disk.">&#9888; <span class="tb-saved-text">Changes live only in this tab</span></span>`
			: `<span class="tb-saved"><span class="sdot"></span><span class="tb-saved-text">Saved${(input.snapshotCount ?? 0) > 0 ? ` &middot; v${input.snapshotCount}` : ''}</span></span>`)
		+ `</span>`
		+ `</div>`
		: '';

	// Source-peek / "Sync across" banner: when a linked source changed, offer a one-tap Sync; after a
	// sync, show the figure diff (old -> new) so the source edit's effect on the document is visible.
	const syncDiff = input.syncDiff ?? [];
	const syncBar = (isLiving && isPm)
		? (dirty
			? `<div class="syncbar"><span>&#9888; A linked source changed since the last sync.</span><span class="sb-spacer"></span><button class="sb-btn" data-sync>Sync figures</button></div>`
			: (syncDiff.length
				? `<div class="syncbar done"><span>&#10003; Synced ${syncDiff.length} figure${syncDiff.length === 1 ? '' : 's'}:</span> <span class="sb-diff">${syncDiff.map(c => `${esc(c.key)} ${esc(c.old)}&rarr;${esc(c.next)}`).join(' &middot; ')}</span></div>`
				: ''))
		: '';

	// PM is the single writing surface for every document (plan 15 iter 5): the document IS the editor.
	// Bound figures render as non-editable atom nodes; pending changes + the provenance gutter are PM
	// decorations (plan 15 iter 4); the source-peek opens as the SAME bottom drawer over the full-width doc
	// (G1 - never a split editor), driven by the existing reveal/sync messages. Raw mode is the one
	// alternative - a plain Markdown textarea for hand-editing source.
	const pmSurface = !!doc && isPm;

	let body: string;
	if (mode === 'raw') {
		body = `<div class="rawwrap"><textarea class="raw" spellcheck="false">${esc(rawText)}</textarea></div>`;
	} else if (!doc) {
		body = `<div class="empty">No document loaded.</div>`;
	} else {
		body = syncBar
			+ `<div class="pmwrap"><div id="pm-root" class="prose"></div></div>`
			+ (input.sourcePeek ? renderSourceDrawer(input.sourcePeek, input.provenance ?? []) : '');
	}

	// The helper line under the document (comp 2a). It names what the underline MEANS and what clicking one
	// buys you, in the comp's own words. The source is the document's real first source (in mono, because a
	// file name is a provenance fact); with several sources it says "your sources" rather than picking one.
	const sourceNames = doc?.sources ?? [];
	const boundTo = sourceNames.length === 1
		? `<span class="hint-src">${esc(sourceNames[0])}</span>`
		: 'your sources';
	const hint = (isPm && isLiving)
		? `<div class="hint">Underlined figures are bound to ${boundTo} - click one for its source, cell and freshness. `
		+ `<button class="hint-raw" data-to-raw>Edit raw Markdown</button></div>`
		: '';
	// ProseMirror is fed from the FRESH body (parsed from the raw text on disk): a model-driven change
	// (an approved change) mutates blocks + persists but leaves the cached doc.body stale, so the live
	// surface must reset to the reparsed body, not the stale cache.
	const pmMd = pmSurface && doc ? parseLivingDoc(rawText).body : null;
	const pmDeco = pmSurface && doc ? renderPmDeco(doc, pending, recent, input.provenance ?? []) : null;
	// Floating review bar: rendered directly below the formatting toolbar, present ONLY when there are
	// pending changes in this document or another (plan 19 iter 7). It is distinct from the formatting
	// chrome - it floats under it with a warm tint - so review never lives inside the WYSIWYG header.
	const reviewBar = (!!doc && isPm)
		? docReviewBar(pending, input.totalPendingCount ?? pending.length, input.nextChangedDocTitle, input.prevChangedDocTitle)
		: '';
	// The Properties panel (plan 45 pin 12): the inset panel is a sibling fixed to the card's right edge, and
	// `props-open` on the content wrapper re-centres the reading column (P12.6). Present only in PM mode where
	// the editor supplied panel state; absent otherwise so raw mode / screens stay unchanged.
	const props = input.properties;
	const propsPanel = props?.open ? props.html : '';
	const wrapClass = props?.open ? ' class="props-open"' : '';
	return { html: `<div${wrapClass}>${rawTop}${docToolbar}${reviewBar}${body}${hint}${propsPanel}${modal}</div>`, pmMd, pmDeco };
}

// The full webview document: the calm chrome + the dynamic content in a persistent #lwd-root, the vendored
// ProseMirror bundle, and the RUNTIME - all set ONCE via setHtml. Thereafter the editor pushes
// `renderLivingDocContent` payloads as 'lwdRender' messages (mount-once-then-message, plan 15 iter 2).
export function renderLivingDocHtml(input: ILivingDocRenderInput): string {
	const content = renderLivingDocContent(input);
	const bundle = proseMirrorBundle().replace(/<\/script/gi, '<\\/script');
	// Seed the initial mount Markdown AND the initial decoration spec as globals (the `<` is escaped so they
	// can't break out of the script); the RUNTIME reads them once on load (so a default-PM living doc shows
	// its changes/gutter without waiting for the first message).
	const decoLiteral = content.pmDeco === null ? 'null' : JSON.stringify(content.pmDeco).replace(/</g, '\\u003c');
	const docsLiteral = JSON.stringify(input.docNames ?? []).replace(/</g, '\\u003c');
	const pmInit = `<script>window.__LWD_PM_MD=${content.pmMd === null ? 'null' : escapeForScript(content.pmMd)};`
		+ `window.__LWD_PM_DECO=${decoLiteral};window.__LWD_DOCS=${docsLiteral};</script>`;
	return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${STYLE}</style></head><body>`
		+ `<div id="lwd-root">${content.html}</div>${FIND_WIDGET_HTML}`
		+ `${pmInit}<script>${bundle}</script><script>${RUNTIME}</script></body></html>`;
}

// The bottom source drawer (the comp's "Workbench v2" overlay) for the PM surface: a full-width overlay
// fixed to the bottom of the webview so the document is never split into a side-by-side pane.
function renderSourceDrawer(peek: ISourcePeekRender, provenance: readonly IPmProvenance[]): string {
	// then-vs-now (plan 37 F13): when the live source value has drifted from the applied value, show
	// "then -> now" so the reader sees what was approved versus what the source says now.
	const anyDrift = peek.rows.some(r => r.current !== undefined);
	// The bind keys whose api/mcp source could not be reached this pass, read off the SAME provenance the hover
	// peek uses (never a second staleness store): the drawer and the tooltip therefore mark the identical rows.
	const unreached = new Set(provenance.filter(p => p.fallback !== undefined).map(p => p.key));
	const rows = peek.rows.map(r => {
		const out = unreached.has(r.key);
		const resolved = r.current !== undefined
			? `<span class="sp-then">${esc(r.value)}</span> <span class="sp-arrow">&rarr;</span> <span class="sp-now">${esc(r.current)}</span>`
			: esc(r.value) + (out ? `<span class="sp-unreach-tag">${esc(UNREACHABLE_SOURCE_MARKER)}</span>` : '');
		return `<tr class="${r.selected ? 'sel' : ''}${r.current !== undefined ? ' changed' : ''}${out ? ' unreached' : ''}"><td>${esc(r.key)}</td><td>${resolved}</td></tr>`;
	}).join('');
	const driftHint = anyDrift ? `<div class="sp-drift">&#9650; then &rarr; now: the source changed since these figures were last synced.</div>` : '';
	// The staleness-escape guardrail (docs/20 journey 1p): when a listed figure's source could not be reached, say so
	// in plain words above the table, so the last-synced values below are never read as this morning's numbers.
	const unreachedHint = peek.rows.some(r => unreached.has(r.key))
		? `<div class="sp-unreach">&#9650; ${esc(UNREACHABLE_SOURCE_LINE)}.</div>`
		: '';
	// THE CITED CELL (comp 4d) - the whole point of the wedge. The clicked figure is the `selected` peek row;
	// its provenance entry names the field inside the source (`location`), and that field is a column of the
	// grid, so the exact cell the document quotes can be pointed at rather than described. Everything here is
	// gated on REAL provenance: with no lock entry, or a field that names no column, nothing is underlined and
	// the drawer simply shows the cited row - never a guessed cell.
	const grid = peek.grid;
	const citedKey = peek.rows.find(r => r.selected)?.key;
	const citedField = citedKey ? provenance.find(p => p.key === citedKey)?.location : undefined;
	const citedCol = grid && citedField
		? grid.headers.findIndex(h => h.trim().toLowerCase() === citedField.trim().toLowerCase())
		: -1;
	const citedRow = grid?.rows[grid.latestIndex];
	// The row's own label is its first cell (a week number, a date) - the reader's name for the row, not ours.
	const citedRowLabel = citedRow?.[0]?.trim() || (grid ? String(grid.latestIndex + 1) : '');
	// No heading above the grid: the drawer head already names the source, and the caption below the grid says
	// which row the document cites - a third label would just be chrome between the reader and the evidence.
	const gridHtml = grid
		? `<table class="sp-grid"><thead><tr>${grid.headers.map(h => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>`
		+ grid.rows.map((r, i) => `<tr class="${i === grid.latestIndex ? 'sel' : ''}">${r.map((c, ci) => (
			i === grid.latestIndex && ci === citedCol ? `<td><span class="sp-cite">${esc(c)}</span></td>` : `<td>${esc(c)}</td>`
		)).join('')}</tr>`).join('')
		+ `</tbody></table>`
		+ (citedCol >= 0
			? `<div class="sp-caption">Row ${esc(citedRowLabel)} is what your document cites - the cell feeding the figure you clicked is underlined.</div>`
			: `<div class="sp-caption">Row ${esc(citedRowLabel)} is what your document cites.</div>`)
		: '';
	// For an api/mcp bound value: show the REAL response payload with the extracted field highlighted, so the
	// source-peek stops pretending non-file sources are a CSV (plan 29 iter 4). Highlighting is a safe,
	// escape-on-render match of the field name in the escaped payload text (no markup ever injected).
	const payloadHtml = peek.payload
		? `<div class="sp-sec">${esc(peek.payload.source)} &middot; ${peek.payload.kind === 'mcp' ? 'MCP result' : 'API response'} &middot; field <span class="sp-field">${esc(peek.payload.field)}</span></div>`
		+ `<pre class="sp-payload">${highlightField(peek.payload.raw, peek.payload.field)}</pre>`
		: '';
	// "ALSO CITED BY" (comp 4d): the other documents that quote this source, so the reader can see the blast
	// radius of a sync before they run it. The titles are listed without an open-link: this webview has no
	// message that opens a document by title, and a link that does nothing is worse than no link at all.
	const refs = peek.referencedBy.length
		? `<div class="sp-refs"><div class="sp-refs-h">ALSO CITED BY</div>`
		+ peek.referencedBy.map(t => `<div class="sp-ref">&#9636; ${esc(t)}</div>`).join('') + `</div>`
		: '';
	// Header action: "Sync now", a hairline secondary, swapped for a "N synced" chip after a sync.
	const action = peek.synced
		? `<span class="sd-synced">&#10003; ${peek.syncedCount} synced</span>`
		: `<button class="sd-sync" data-sync title="Apply the changed cells to the report and show the diff"><span>&#10227;</span>Sync now</button>`;
	const rowCount = grid ? grid.rows.length : peek.rows.length;
	// A published document pins this source to a version (plan 32 iter 4): show the frozen-version line so a
	// reader of the published doc sees the pinned state, not the moving latest. Only when the source is pinned.
	const pinned = peek.pinnedLabel
		? `<span class="sd-meta" style="color:${AMBER.label}">&#128204; ${esc(peek.pinnedLabel)}</span>`
		: '';
	// Freshness in the ONE vocabulary: the dot and the words come from the same provenance the hover peek
	// reads, so the drawer and the tooltip can never disagree. Absent when nothing here has a lock entry yet.
	const sourceProv = provenance.find(p => p.source === peek.source);
	const freshness = sourceProv
		? `<span class="sd-fresh" style="color:${sourceProv.fresh ? FRESHNESS_COLOURS.freshText : FRESHNESS_COLOURS.staleText}"><span class="sd-dot"></span>${esc(sourceProv.synced.toLowerCase())}</span>`
		: '';
	// The head's meta line in user units (the doc-28 correction for the wedge): rows of evidence, and how
	// many figures IN THIS DOCUMENT they feed - never a template token, never an internal count.
	const figureCount = peek.rows.length;
	const headMeta = `source &middot; ${rowCount} row${rowCount === 1 ? '' : 's'} &middot; feeds ${figureCount} figure${figureCount === 1 ? '' : 's'} in this document`;
	// The right column's label only claims "fed by this row" when a real cited cell was resolved; otherwise it
	// states the plainer truth, that these are the figures bound to this source. Section labels are the one
	// place round 2 writes in capitals: they are typographic furniture (mono, tracked), not sentences.
	const figuresLabel = citedCol >= 0
		? `FIGURES FED BY THIS ROW &middot; ${figureCount}`
		: `BOUND FIGURES &middot; ${figureCount}`;
	const drawer = `<div class="srcdrawer">`
		+ `<div class="sd-grip"><span></span></div>`
		+ `<div class="sd-head"><span class="sd-name">&#8862; ${esc(peek.source)}</span>`
		+ `<span class="sd-meta">${headMeta}</span>${freshness}${pinned}`
		+ `<span class="sd-actions">${action}<button class="sd-x" data-source-close title="Close source">&#10005;</button></span></div>`
		+ `<div class="sd-body">`
		+ `<div class="sd-left">${gridHtml}${payloadHtml}${unreachedHint}${driftHint}</div>`
		+ `<div class="sd-right"><div class="sp-sec">${figuresLabel}</div>`
		+ `<table class="sp-figs"><tbody>${rows}</tbody></table>${refs}</div>`
		+ `</div></div>`;
	return drawer;
}

// Render a raw response payload, escaping ALL of it (the [04] injection invariant: MCP/API payloads are
// text, never markup), then wrapping each occurrence of the extracted field name in a highlight span. The
// highlight operates on the already-escaped text, so nothing the source returns can break out as markup.
function highlightField(raw: string, field: string): string {
	const safe = esc(raw);
	if (!field) { return safe; }
	const needle = esc(field);
	// Split on the escaped field and rejoin with the highlight span, so only literal text is ever emitted.
	return safe.split(needle).join(`<span class="sp-field">${needle}</span>`);
}

// The Present & export modal. Only the two destinations Abstract genuinely produces are selectable - a
// self-contained HTML page and clean portable Markdown - each mapped in `_runPresent` to a real writer.
// The native-format / cloud destinations are shown honestly as "Soon" (non-selectable) so the affordance
// never fabricates an export it cannot make (plan 33 L8; plan-17 no-dead-ends rule).
// Round 2 retires the per-destination brand colours (the same "no rainbow avatars" correction doc 28 makes
// for Templates): a hue in this product means one thing, and "this row is Google" is not one of them. Every
// glyph is therefore neutral ink on the recessed paper, and the only colour in the list is the indigo that
// marks WHICH row is selected - which is the one thing the reader actually needs to see.
interface IPresentDef { label: string; accent: string; cta: string; live: string; icon: string; tint: string; soon?: boolean }
const PRESENT_GLYPH_INK = INK.secondary;
const PRESENT_GLYPH_BG = PAPER.sunken;
const PRESENT_DEFS: Record<PresentChoice, IPresentDef> = {
	html: { label: 'Web page', accent: PRESENT_GLYPH_INK, cta: 'Export web page', live: 'Self-contained HTML file &middot; opens in any browser, no Abstract needed', icon: '&#9673;', tint: PRESENT_GLYPH_BG },
	markdown: { label: 'Markdown', accent: PRESENT_GLYPH_INK, cta: 'Export Markdown', live: 'Clean portable Markdown &middot; bound values inlined, opens in any editor', icon: 'M&#8595;', tint: PRESENT_GLYPH_BG },
	pdf: { label: 'PDF', accent: PRESENT_GLYPH_INK, cta: 'Export as PDF', live: 'Print-ready PDF of the document &middot; opens anywhere, no Abstract needed', icon: '&#9635;', tint: PRESENT_GLYPH_BG },
	docx: { label: 'Microsoft Word', accent: PRESENT_GLYPH_INK, cta: 'Export as Word', live: 'Offline .docx mapped to Word\'s built-in styles &middot; bound values inlined, restyle in Word', icon: 'W', tint: PRESENT_GLYPH_BG },
	gdoc: { label: 'Google Docs', accent: PRESENT_GLYPH_INK, cta: 'Coming soon', live: 'Editable copy with text &amp; tables formatted natively.', icon: 'G', tint: PRESENT_GLYPH_BG, soon: true },
	gsheet: { label: 'Google Sheets', accent: PRESENT_GLYPH_INK, cta: 'Coming soon', live: 'Linked tables become live sheets.', icon: 'G', tint: PRESENT_GLYPH_BG, soon: true },
	xlsx: { label: 'Microsoft Excel', accent: PRESENT_GLYPH_INK, cta: 'Coming soon', live: 'Linked tables as an .xlsx workbook.', icon: 'X', tint: PRESENT_GLYPH_BG, soon: true },
};
// Real destinations first, then the honest "Soon" group.
const PRESENT_ORDER: readonly PresentChoice[] = ['html', 'markdown', 'pdf', 'docx', 'gdoc', 'gsheet', 'xlsx'];

function renderPresentModal(present: IPresentState, title: string): string {
	// Guard: never let a "Soon" destination be the selected one (defensive - the rows are non-selectable).
	const activeChoice: PresentChoice = PRESENT_DEFS[present.choice].soon ? 'html' : present.choice;
	const pc = PRESENT_DEFS[activeChoice];
	const rows = PRESENT_ORDER.map(k => {
		const d = PRESENT_DEFS[k];
		const sel = k === activeChoice;
		// Soon rows are shown but not selectable - no data-present-choice, muted, with a "Soon" pill.
		const rowStyle = d.soon
			? `border:1px solid ${HAIRLINE.medium};background:${PAPER.rail};opacity:.72;cursor:default`
			: (sel ? `border:1.5px solid ${INDIGO.base};background:${INDIGO.tint};cursor:pointer` : `border:1px solid ${HAIRLINE.strong};background:${PAPER.card};cursor:pointer`);
		const choiceAttr = d.soon ? '' : ` data-present-choice="${k}"`;
		const soonPill = d.soon ? `<span style="margin-left:auto;font:${TYPE.kindBadge};letter-spacing:${TRACKING.kindBadge};color:${INK.meta};background:${PAPER.chip};border-radius:5px;padding:4px 6px">SOON</span>` : '';
		return `<button class="pm-row"${choiceAttr}${d.soon ? ' disabled aria-disabled="true"' : ''} style="text-align:left;border-radius:${RADIUS.input};padding:11px 12px;display:flex;align-items:center;gap:11px;${rowStyle}">`
			+ `<span style="width:30px;height:30px;flex:none;border-radius:${RADIUS.control};background:${d.tint};color:${d.accent};font:600 13px/1 ${FONT.sans};display:flex;align-items:center;justify-content:center">${d.icon}</span>`
			+ `<span style="min-width:0"><span style="display:block;font:${TYPE.uiBodyStrong};color:${INK.heading}">${d.label}</span></span>${soonPill}</button>`;
	}).join('');

	// The export writes a file next to the document (honest - no fabricated hosting or shareable URL).
	const destNote = `<div style="margin-bottom:18px;border:1px solid ${PAPER.sunkenBorder};border-radius:${RADIUS.control};padding:10px 12px;background:${PAPER.sunken};font:400 12px/1.5 ${FONT.sans};color:${INK.secondary}">The exported file is saved beside your document and opens for review.</div>`;

	// The before-export gate surface (plan 32 iter 4): when the gate failed, SHOW the grader's one-line reason
	// and swap the single export CTA for "Export anyway" (audited override, `presentCtaForce`) + "Fix first"
	// (jumps to the flagged block, `presentFixFirst`). No silent block, no silent override.
	const gateBlocked = present.gate && !present.gate.pass;
	const gateBanner = gateBlocked
		? `<div style="margin-bottom:16px;border:1px solid ${RED.diffInk}33;background:${RED.blockBg};border-radius:${RADIUS.input};padding:12px 14px"><div style="display:flex;align-items:center;gap:9px;font:600 12.5px/1.3 ${FONT.sans};color:${RED.base}"><span style="width:8px;height:8px;flex:none;border-radius:${RADIUS.pill};background:${RED.base}"></span>Before-export check failed</div><div style="font:400 12px/1.5 ${FONT.sans};color:${RED.blockInk};margin-top:6px">${esc(present.gate?.flag ?? 'A figure does not reconcile with its source.')}</div></div>`
		: '';
	// Even under a failed gate the override is not a red button: red reports a state (this failed), it never
	// invites a click. The override is the hairline secondary; the safe route keeps the indigo.
	const cta = gateBlocked
		? `<div style="display:flex;gap:10px"><button class="pm-cta" data-present-fix-first style="flex:1;border:none;border-radius:${RADIUS.control};padding:12px;background:${INDIGO.base};color:${PAPER.card};font:600 13px/1 ${FONT.sans};cursor:pointer">Fix first</button><button class="pm-cta" data-present-cta-force style="flex:1;border:1px solid ${PAPER.control};border-radius:${RADIUS.control};padding:12px;background:${PAPER.card};color:${INK.body};font:400 13px/1 ${FONT.sans};cursor:pointer">Export anyway</button></div>`
		: `<button class="pm-cta" data-present-cta style="width:100%;border:none;border-radius:${RADIUS.control};padding:12px;background:${INDIGO.base};color:${PAPER.card};font:${TYPE.uiBodyStrong};cursor:pointer">${pc.cta}</button>`;

	return `<div class="pm-overlay" data-present-close>`
		+ `<div class="pm-card" data-present-stop>`
		+ `<div class="pm-head"><div><h2 class="pm-title">Present &amp; export</h2><div class="pm-sub">${esc(title)}</div></div><button class="pm-x" data-present-close>&#10005;</button></div>`
		+ `<div class="pm-body">`
		+ `<div class="pm-list"><div style="font:${TYPE.sectionLabel};letter-spacing:${TRACKING.sectionLabel};color:${INK.meta};margin-bottom:9px">SEND A COPY TO</div><div style="display:flex;flex-direction:column;gap:7px">${rows}</div></div>`
		+ `<div class="pm-detail">`
		+ `<div style="display:flex;align-items:center;gap:10px;margin-bottom:6px"><h3 style="margin:0;font:600 18px/1.25 ${FONT.sans};color:${INK.heading}">${pc.label}</h3></div>`
		+ `<p style="margin:0 0 18px;font:${TYPE.uiBody};color:${INK.secondary}">${pc.live}</p>`
		+ `<div style="border:1px solid ${HAIRLINE.strong};border-radius:${RADIUS.input};overflow:hidden;margin-bottom:18px"><div style="padding:13px 15px"><div style="font:${TYPE.uiBodyStrong};color:${INK.heading}">${esc(title)}</div></div></div>`
		+ gateBanner
		+ destNote
		+ cta
		+ `<div style="margin-top:11px;font:400 11px/1.5 ${FONT.sans};color:${INK.meta};text-align:center">Provenance &amp; approval history are retained on export.</div>`
		+ `</div></div></div></div>`;
}

// Clean, self-contained export: no IDE chrome, no provenance dots, no diff UI -- just the
// document's current state as a print-ready HTML page that opens anywhere.
const EXPORT_STYLE = `*{box-sizing:border-box}
html,body{margin:0;background:${PAPER.card};color:${INK.heading};font-family:Georgia,'Times New Roman',serif}
.page{max-width:720px;margin:0 auto;padding:56px 48px 80px}
h1{font:${TYPE.screenTitle};letter-spacing:${TRACKING.screenTitle};color:${INK.heading};margin:0 0 4px}
.subtitle{font:400 13px/1.4 ${FONT.sans};color:${INK.meta};margin:0 0 32px}
h2{font:600 18px/1.35 ${FONT.sans};color:${INK.heading};margin:30px 0 10px}
p{font-size:16px;line-height:1.7;margin:0 0 14px}
ul,ol{font-size:16px;line-height:1.7}
table{border-collapse:collapse;width:100%;margin:6px 0 16px;font:400 13px/1.45 ${FONT.sans}}
th{background:${PAPER.sunken};color:${INK.bodySoft};text-align:left;padding:9px 12px;border-bottom:1px solid ${HAIRLINE.strong};font-weight:600}
td{padding:9px 12px;border-bottom:1px solid ${HAIRLINE.medium};text-align:left}
.up{color:${GREEN.base}}.down{color:${RED.base}}
code{font-family:${FONT.mono};background:${PAPER.chip};border-radius:4px;padding:1px 5px}
pre{background:${PAPER.sunken};border:1px solid ${PAPER.sunkenBorder};border-radius:${RADIUS.control};padding:14px 16px;overflow:auto}
blockquote{margin:0 0 14px;padding:2px 16px;border-left:3px solid ${HAIRLINE.strong};color:${INK.secondary}}
footer{margin-top:48px;padding-top:14px;border-top:1px solid ${HAIRLINE.medium};font:400 11px/1.5 ${FONT.sans};color:${INK.meta}}`;

// Empty image map default: an export with no relative images (or a caller that has not resolved them) still
// renders, and every relative `![](assets/...)` simply keeps its (unresolvable) path. Passing a resolved map
// (src -> `data:` URI) is what makes the exported HTML/PDF self-contained (issue #131/#245 D1).
const EMPTY_IMAGES: ReadonlyMap<string, string> = new Map();

/**
 * Build a standalone, shareable HTML page from a document's current (resolved) state. When `images` maps a
 * relative image `src` to a `data:` URI, that image is inlined into the page so the export is self-contained
 * (no project-folder dependency): the data URI is folded into the Markdown BEFORE it is rendered, so the
 * sanitising Markdown renderer - which would otherwise strip a relative `src` - keeps the allowed `data:` src
 * (issue #131/#245 D1). Relative images with no resolved data URI keep their path (named, never silently gone).
 */
export function renderExportHtml(doc: ILivingDoc, resolved: ReadonlyMap<string, string> = EMPTY_RESOLVED, images: ReadonlyMap<string, string> = EMPTY_IMAGES): string {
	const markdown = rewriteMarkdownImageSrcs(renderExportMarkdown(doc, resolved), images);
	const body = renderGenericMarkdown(markdown);
	const footer = `<footer>Exported from Abstract &middot; Living Document</footer>`;
	return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${esc(doc.title)}</title><style>${EXPORT_STYLE}</style></head><body><main class="page">${body}${footer}</main></body></html>`;
}

/**
 * Build a clean, static Markdown document from a document's current (resolved) state: the bind links
 * collapse to their resolved values, so there are no bindings and no metadata -- just portable
 * Markdown that opens anywhere (Obsidian, GitHub, a share).
 */
export function renderExportMarkdown(doc: ILivingDoc, resolved: ReadonlyMap<string, string> = EMPTY_RESOLVED): string {
	if (!doc.isLiving) {
		// Plain Markdown already is its own clean export - bar the wikilinks, which mean nothing outside the
		// workspace that resolves them.
		return wikilinksToPlainText(doc.body).trim() + '\n';
	}
	const parts: string[] = [`# ${doc.title}`];
	if (doc.subtitle) { parts.push(`_${doc.subtitle}_`); }
	for (const block of doc.blocks) {
		// Wikilinks collapse to the words a reader sees, exactly as bind links collapse to their value: an
		// exported file is read OUTSIDE the workspace, where `[[Team Notes]]` is neither a link nor readable
		// prose. Every export - md, html, docx and pdf - is built from this one resolved string, so doing it
		// here covers all four, and no chip markup can leak because none is ever produced.
		if (block.type === 'heading') {
			parts.push(`${'#'.repeat(block.level ?? 2)} ${wikilinksToPlainText(block.text)}`);
		} else {
			parts.push(wikilinksToPlainText(bindToValue(reconcileBindLinks(block.text, resolved))));
		}
	}
	return parts.join('\n\n') + '\n';
}
