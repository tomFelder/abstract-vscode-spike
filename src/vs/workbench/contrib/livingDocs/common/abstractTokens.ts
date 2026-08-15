/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// The Abstract design system, as code. This module is the single source of truth for every colour,
// type step, radius, and shadow the product draws - the "DS" sheet of the round-2 redesign comp
// (docs/design/abstract-redesign/Abstract Redesign Screens.dc.html) transcribed literally.
//
// Why it lives in `common/`: the product paints across three independent style universes that cannot
// share a stylesheet - the workbench chrome (real .css files under styleOverrides/), the screens
// webview (an inlined <style> in screenRenderShell), and the document-editor webview (an inlined
// <style> in livingDocRender). Webviews are separate documents, so a CSS custom property declared on
// the workbench :root is invisible inside them. A TypeScript module is the only seam all three can
// import, so the tokens are values here and each universe inlines them at render time.
//
// The rule the comp states, and this module encodes: every hue has exactly one meaning.
//   indigo = Abstract acting · green = applied/fresh/all clear · amber = waiting on you
//   red = removed/failed · warm neutrals = the paper · ink ramp = the words
// Green and red are never button colours; a highlight fill only ever means "this span is changing".

import { ABSTRACT_FONT_FACE_CSS } from './abstractFont.js';

/**
 * Indigo - Abstract acting. Primary buttons, links, active nav, agent narration marks, and the
 * bound-figure underline. The only colour a button may be filled with.
 */
export const INDIGO = {
	/** Primary fill and link ink. */
	base: '#4353C9',
	/** Hover/pressed state for both fills and links. */
	hover: '#333FA3',
	/** The flat tint behind selected rows, chips, and the focused-input glow. */
	tint: '#EEEFFA',
	/** Border weight of the tint - chips, selected cells, focus rings. */
	tintBorder: '#C8CBE8',
	/** The bound-figure underline. Deliberately lighter than `base` so prose stays readable. */
	underline: '#B4B9E8',
	/** Accent ink on a dark surface (the hover-peek tooltip's call to action). */
	onDark: '#8F94D9',
} as const;

/**
 * Green - applied / fresh / all clear. Never a button colour: green reports a settled state, it
 * never invites a click.
 */
export const GREEN = {
	/** The dot, the "synced" ink, the FIGURE kind badge. */
	base: '#1F7A4D',
	/** All-clear banner fill. */
	bg: '#F0F6F1',
	/** All-clear banner hairline. */
	border: '#CFE3D4',
	/** Banner headline ink. */
	headline: '#164A31',
	/** Banner body ink. */
	body: '#4E7059',
	/** Diff insertion fill - the "this span is arriving" highlight. */
	diffBg: '#E4F2E7',
	/** Diff insertion ink. */
	diffInk: '#175B38',
	/** NOW block fill in a WAS/NOW pair. */
	blockBg: '#EFF7F1',
} as const;

/**
 * Amber - waiting on you. Pending-change edges, needs-you banners, MEANING badges. Amber is the
 * only colour that means "a human decision is outstanding".
 */
export const AMBER = {
	/** The dot, the pending-change left edge, the count pill. */
	base: '#C77E1F',
	/** Needs-you banner fill. */
	bg: '#FDF6EC',
	/** Needs-you banner hairline. */
	border: '#EAD9BC',
	/** A quieter amber fill for in-document strips and rail notes. */
	subtleBg: '#FDF8EF',
	/** MEANING / kind-badge label ink. */
	label: '#8A5A12',
	/** Banner headline ink. */
	headline: '#6E4A10',
	/** Banner body ink. */
	body: '#8A6A33',
	/** Hairline between rows inside an amber banner. */
	hairline: '#F5F0E4',
	/** Hairline between an amber banner's head and its queue. */
	edge: '#F0E4CC',
	/** The "ask first" tier ink on the agent policy dial. */
	askFirst: '#B45309',
} as const;

/**
 * Red - removed / failed. Strikethrough spans, WAS blocks, failed runs. Never decoration, and never
 * a button colour.
 */
export const RED = {
	/** Failed-run dot, FAILED kind badge, the "never" policy tier. */
	base: '#B3261E',
	/** Diff deletion fill - the "this span is leaving" highlight. */
	diffBg: '#FBE9E7',
	/** Diff deletion ink, struck through. */
	diffInk: '#A13527',
	/** WAS block fill in a WAS/NOW pair. */
	blockBg: '#FBF1F0',
	/** WAS block ink. */
	blockInk: '#7C2D22',
} as const;

/**
 * Cool neutrals - the paper. The surfaces nest outward-in: canvas -> app frame -> rails -> page ->
 * cards, each a step lighter, so depth reads without a single shadow.
 *
 * NOTE - this is the one place the implementation deliberately departs from the round-2 comp. The comp
 * draws the paper warm (#EFEEE9 / #FCFBF9 and a warm ink ramp); the product keeps the cool slate ramp it
 * has always had. Only the neutrals changed: every meaning colour below - indigo, green, amber, red - is
 * exactly as the comp specifies, because those carry meaning and the paper does not.
 */
export const PAPER = {
	/** The canvas behind the app window. Derived one step below `frame` on this ramp's own spacing. */
	canvas: '#E3E6EC',
	/** The app frame - the window chrome the rails sit on. */
	frame: '#ECEEF2',
	/** Rails and table headers. */
	rail: '#F5F6F8',
	/** The page surface a screen's body scrolls on. */
	page: '#FAFBFC',
	/** Cards, inputs, and anything that must read as "on top". */
	card: '#FFFFFF',
	/** A recessed fill for helper boxes and quiet tiles. */
	sunken: '#F2F3F6',
	/** The border that belongs to `sunken`. */
	sunkenBorder: '#E5E8ED',
	/** Chip fill and the lightest hairline's sibling. */
	chip: '#EDEFF2',
	/** The frame's own outer border, and every dashed on-ramp edge. */
	frameBorder: '#CBCFD8',
	/** Secondary-button and control borders. */
	control: '#DADDE3',
} as const;

/**
 * The one stroke: a 1px hairline in three weights. `strong` separates surfaces, `medium` separates
 * rows inside a card, `soft` separates lines inside a row.
 */
export const HAIRLINE = {
	strong: '#DFE2E8',
	medium: '#E7E9EE',
	soft: '#EDEFF2',
} as const;

/**
 * The ink ramp - four steps, and only four. Headings, body, secondary, then placeholder/meta.
 * Cool slate, to sit on the cool paper above.
 */
export const INK = {
	/** Headings and the strongest emphasis. */
	heading: '#1B1B20',
	/** Document and UI body copy. */
	body: '#34373D',
	/** A softer body ink for descriptions that sit under a heading. Midway between body and secondary. */
	bodySoft: '#4D5158',
	/** Secondary copy - captions, helper lines, inactive nav labels. */
	secondary: '#676B74',
	/** Placeholder and meta - provenance lines, mono muted, empty-field text. */
	meta: '#9498A3',
	/** Secondary text on a dark surface (the hover-peek tooltip). */
	onDark: '#B4B8C2',
} as const;

/** The dark surface the hover peek is drawn on - the only inverted surface in the product. */
export const DARK_SURFACE = '#1B1B20';

/** The project avatar's navy. Identity, not state, so it sits outside the meaning palette. */
export const AVATAR_NAVY = '#23408F';

/**
 * Type. Two families, two weights - sans is the system stack, mono is IBM Plex Mono. Mono is
 * reserved for section labels, kind badges, and provenance facts (file names, cells, synced-when,
 * line numbers, version chips); never for metadata values or model ids.
 */
export const FONT = {
	sans: `-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif`,
	mono: `'IBM Plex Mono',ui-monospace,SFMono-Regular,Menlo,monospace`,
} as const;

/**
 * The type scale, as ready-to-use CSS `font` shorthands. Sizes are exact to the comp; only 400 and
 * 600 exist as weights. Anything not on this ladder is a bug, not a variation.
 */
export const TYPE = {
	/** Greeting and page title - 34/600. */
	greeting: `600 34px/1.2 ${FONT.sans}`,
	/** Screen title - 28/600. Knowledge, Templates, Agent detail. */
	screenTitle: `600 28px/1.25 ${FONT.sans}`,
	/** Document heading - 21/600. An `h3` inside a document. */
	docHeading: `600 21px/1.3 ${FONT.sans}`,
	/** Dialog title - 19/600. The New-document sheet and its siblings. */
	dialogTitle: `600 19px/1.25 ${FONT.sans}`,
	/** Banner headline - 18/600, always in a state ink. */
	bannerHeadline: `600 18px/1.35 ${FONT.sans}`,
	/** Document body - 16/400/1.65. Reads like paper, never highlighted at rest. */
	docBody: `400 16px/1.65 ${FONT.sans}`,
	/** Card title - 15.5/600. A document tile, a template card. */
	cardTitle: `600 15.5px/1.3 ${FONT.sans}`,
	/** Card value - 15/600. The answer inside an agent question card. */
	cardValue: `600 15px/1.35 ${FONT.sans}`,
	/** Field text - 14.5/400. Input values, table cells, source names. */
	field: `400 14.5px/1.3 ${FONT.sans}`,
	/** Row title - 14/600. A picker row, a birth option. */
	rowTitle: `600 14px/1.3 ${FONT.sans}`,
	/** Banner body - 14/400/1.6. The sentence under a state headline. */
	bannerBody: `400 14px/1.6 ${FONT.sans}`,
	/** UI body - 13.5/400. Buttons, rows, rail text. */
	uiBody: `400 13.5px/1.45 ${FONT.sans}`,
	/** UI body, emphasised - 13.5/600. */
	uiBodyStrong: `600 13.5px/1.45 ${FONT.sans}`,
	/** Body small - 13/400/1.55. Card description lines, helper paragraphs. */
	bodySmall: `400 13px/1.55 ${FONT.sans}`,
	/** Secondary - 12.5/400. Receipts, captions, helper lines. */
	secondary: `400 12.5px/1.5 ${FONT.sans}`,
	/** Meta - 12/400. The quietest sans step: provenance prose, confidence, counts. */
	meta: `400 12px/1.5 ${FONT.sans}`,
	/** Section label - mono 11, tracked 0.14em. Always uppercase. */
	sectionLabel: `400 11px/1 ${FONT.mono}`,
	/** Kind badge - mono 10.5, tracked 0.1em. Always uppercase. */
	kindBadge: `400 10.5px/1 ${FONT.mono}`,
	/** Provenance facts - mono 12. File names, cells, synced-when, line numbers. */
	provenance: `400 12px/1.4 ${FONT.mono}`,
	/** Provenance, inline - mono 11.5. The same facts when they sit inside running prose. */
	provenanceInline: `400 11.5px/1.4 ${FONT.mono}`,
	/** Table header - mono 10, tracked 0.12em. Always uppercase. */
	tableHeader: `400 10px/1 ${FONT.mono}`,
} as const;

/** Letter-spacing for the two tracked mono steps, plus the negative tracking on large titles. */
export const TRACKING = {
	sectionLabel: '0.14em',
	kindBadge: '0.1em',
	greeting: '-0.015em',
	screenTitle: '-0.01em',
} as const;

/** Radii: 8 controls · 10 inputs · 12-14 cards · 999 pills and dots. */
export const RADIUS = {
	control: '8px',
	input: '10px',
	card: '12px',
	cardLarge: '14px',
	pill: '999px',
} as const;

/** Elevation. Five shadows, each with exactly one job. */
export const SHADOW = {
	/** A screen or app frame floating on the canvas. */
	frame: '0 2px 12px rgba(27,27,32,0.08)',
	/** A change card lifted off the page. */
	card: '0 1px 5px rgba(27,27,32,0.08)',
	/** A modal dialog. */
	dialog: '0 12px 40px rgba(27,27,32,0.28)',
	/** The hover-peek tooltip on its dark surface. */
	tooltip: '0 8px 24px rgba(27,27,32,0.3)',
	/** The source drawer, lifting upward from the bottom edge. */
	drawer: '0 -6px 24px rgba(27,27,32,0.07)',
} as const;

/**
 * The CSS custom properties every webview inlines, preceded by the `@font-face` that makes the mono
 * real. Keeping the names short (`--ab-*`) keeps the inline `style=` attributes in the renderers
 * readable, and having them as variables means a webview's own stylesheet can reference a token
 * without a template interpolation.
 *
 * The font is inlined here rather than linked because a webview is a separate document on a different
 * origin: a relative `url()` resolves to nothing inside one. Shipping it with the tokens means no
 * surface can adopt the type scale while silently falling back to whatever mono the machine happens
 * to have - which is exactly what the round-1 'JetBrains Mono' declaration did.
 *
 * Emitted into each webview's `<style>` block via `abstractTokenCss()`.
 */
export function abstractTokenCss(): string {
	return `${ABSTRACT_FONT_FACE_CSS}
:root{
--ab-indigo:${INDIGO.base};--ab-indigo-hover:${INDIGO.hover};--ab-indigo-tint:${INDIGO.tint};--ab-indigo-tint-border:${INDIGO.tintBorder};--ab-indigo-underline:${INDIGO.underline};
--ab-green:${GREEN.base};--ab-green-bg:${GREEN.bg};--ab-green-border:${GREEN.border};--ab-green-headline:${GREEN.headline};--ab-green-body:${GREEN.body};--ab-green-diff-bg:${GREEN.diffBg};--ab-green-diff-ink:${GREEN.diffInk};--ab-green-block-bg:${GREEN.blockBg};
--ab-amber:${AMBER.base};--ab-amber-bg:${AMBER.bg};--ab-amber-border:${AMBER.border};--ab-amber-subtle-bg:${AMBER.subtleBg};--ab-amber-label:${AMBER.label};--ab-amber-headline:${AMBER.headline};--ab-amber-body:${AMBER.body};--ab-amber-hairline:${AMBER.hairline};--ab-amber-edge:${AMBER.edge};
--ab-red:${RED.base};--ab-red-diff-bg:${RED.diffBg};--ab-red-diff-ink:${RED.diffInk};--ab-red-block-bg:${RED.blockBg};--ab-red-block-ink:${RED.blockInk};
--ab-canvas:${PAPER.canvas};--ab-frame:${PAPER.frame};--ab-rail:${PAPER.rail};--ab-page:${PAPER.page};--ab-card:${PAPER.card};--ab-sunken:${PAPER.sunken};--ab-sunken-border:${PAPER.sunkenBorder};--ab-chip:${PAPER.chip};--ab-frame-border:${PAPER.frameBorder};--ab-control:${PAPER.control};
--ab-line:${HAIRLINE.strong};--ab-line-med:${HAIRLINE.medium};--ab-line-soft:${HAIRLINE.soft};
--ab-ink:${INK.heading};--ab-ink-body:${INK.body};--ab-ink-soft:${INK.bodySoft};--ab-ink-2:${INK.secondary};--ab-ink-3:${INK.meta};
--ab-font-sans:${FONT.sans};--ab-font-mono:${FONT.mono};
--ab-r-control:${RADIUS.control};--ab-r-input:${RADIUS.input};--ab-r-card:${RADIUS.card};--ab-r-card-lg:${RADIUS.cardLarge};--ab-r-pill:${RADIUS.pill};
--ab-shadow-frame:${SHADOW.frame};--ab-shadow-card:${SHADOW.card};--ab-shadow-dialog:${SHADOW.dialog};--ab-shadow-tooltip:${SHADOW.tooltip};--ab-shadow-drawer:${SHADOW.drawer};
}`;
}
