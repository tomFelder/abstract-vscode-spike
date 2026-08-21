/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// @ts-check

'use strict';

// Zero-dependency Office Open XML (WordprocessingML) writer for the living-document docx export (doc 22 section 3).
// It turns the renderer's already-resolved export Markdown (bind values inlined as plain text) into a clean
// .docx whose paragraphs map onto Word's BUILT-IN styles (Title, Heading 1..6, Normal, List Bullet, List
// Number) so the receiving organisation can restyle. No Abstract chrome, provenance dots, or diff UI ever
// reaches the output - the export is the trust story (doc 14 section 1).
//
// PURE: no fetch, no wall clock, no file system. Everything is string assembly + byte packing, so the writer
// is exercised end-to-end by a plain Node unit script (test/lwd-docx.test.js) without a workbench build - the
// "pure node path" the acceptance criteria are proven on.

const MAX_IMAGE_WIDTH_EMU = 5486400; // 6 inches at 914400 EMU/inch - the printable body width, so an image never overflows the page horizontally.
const MAX_IMAGE_HEIGHT_EMU = 8229600; // 9 inches - the printable body height (Letter, 1-inch margins), so a tall image is not clipped off the page.
const EMU_PER_PX = 9525; // 914400 EMU per inch / 96 px per inch.

// --- XML helpers ----------------------------------------------------------------------------------------

// Characters forbidden in XML 1.0 char data: the C0 controls except tab/newline/carriage-return, plus the two
// non-characters U+FFFE/U+FFFF. A single one of these (e.g. a NUL in a bound value) makes document.xml malformed,
// so we drop them before entity-escaping. The class is built from a STRING, not a regex literal, so
// `no-control-regex` never sees it in source and no lint suppression is needed to express it.
const XML_FORBIDDEN = new RegExp('[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]', 'g');

/** Escape the five XML predefined entities so nothing in a source value can break out as markup. */
function xml(s) {
	return String(s ?? '')
		.replace(XML_FORBIDDEN, '')
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&apos;');
}

// --- inline Markdown -> runs ----------------------------------------------------------------------------

/**
 * Match a Markdown inline image `![alt](dest "title")` starting at `i` in `text`. Handles angle-bracket
 * destinations (`<a b.png>` with spaces) and bare destinations containing balanced parentheses
 * (`foo(bar).png`), plus an optional title, so a valid local image is never dropped or truncated at the first
 * space or `)`. The returned `src` is the DECODED destination (brackets stripped) - the same key the service's
 * `matchMarkdownImageAt` produces, so an image collected there is found in this writer's image map.
 * @param {string} text @param {number} i
 * @returns {{ alt: string; src: string; len: number } | null}
 */
function matchImageAt(text, i) {
	if (text[i] !== '!' || text[i + 1] !== '[') { return null; }
	let j = i + 2;
	let alt = '';
	while (j < text.length && text[j] !== ']') { alt += text[j]; j++; }
	if (text[j] !== ']' || text[j + 1] !== '(') { return null; }
	j += 2;
	let src = '';
	if (text[j] === '<') {
		j++;
		while (j < text.length && text[j] !== '>') { src += text[j]; j++; }
		if (text[j] !== '>') { return null; }
		j++;
	} else {
		let depth = 0;
		while (j < text.length) {
			const c = text[j];
			if (c === ')' && depth === 0) { break; }
			if (/\s/.test(c)) { break; }
			if (c === '(') { depth++; }
			if (c === ')') { depth--; }
			src += c;
			j++;
		}
	}
	while (j < text.length && text[j] !== ')') { j++; }
	if (text[j] !== ')') { return null; }
	return { alt, src, len: j + 1 - i };
}

/**
 * True when a run of `d` (length `len`) at `i` can CLOSE emphasis: it must be right-flanking (preceded by a
 * non-whitespace char) and, for `_`, not sit intra-word (followed by a word char). This is the guard that keeps
 * `customer_id` from being read as an italic toggle.
 * @param {string} text @param {number} i @param {string} d @param {number} len
 */
function canCloseEmphasis(text, i, d, len) {
	const before = text[i - 1];
	if (before === undefined || /\s/.test(before)) { return false; }
	if (d === '_' && /\w/.test(text[i + len] || '')) { return false; }
	return true;
}

/**
 * Index of the next valid closing delimiter run for `d`×`len` at/after `from`, or -1 when the emphasis is never
 * closed (so the opener should be emitted literally rather than swallowed).
 * @param {string} text @param {number} from @param {string} d @param {number} len
 */
function findEmphasisCloser(text, from, d, len) {
	let j = from;
	while (j < text.length) {
		if (text[j] !== d) { j++; continue; }
		let k = j;
		while (k < text.length && text[k] === d) { k++; }
		if (k - j >= len && canCloseEmphasis(text, j, d, len)) { return j; }
		j = k;
	}
	return -1;
}

/**
 * True when a run of `d` (length `len`) at `i` can OPEN emphasis: it must be left-flanking (followed by a
 * non-whitespace char), not intra-word for `_`, and have a matching closer somewhere ahead. Unmatched or
 * intra-word delimiters fail here and are kept as literal text.
 * @param {string} text @param {number} i @param {string} d @param {number} len
 */
function canOpenEmphasis(text, i, d, len) {
	const after = text[i + len];
	if (after === undefined || /\s/.test(after)) { return false; }
	if (d === '_' && /\w/.test(text[i - 1] || '')) { return false; }
	return findEmphasisCloser(text, i + len, d, len) !== -1;
}

/**
 * Tokenise one line of Markdown into styled runs. Handles the beta inline floor: bold (`**`/`__`), italic
 * (`*`/`_`), inline code (`` ` ``), links (`[text](url)`) and inline images (`![alt](src)`). Everything else
 * is literal text. The walk is deliberately simple and left-to-right so it never mis-nests, and it only
 * consumes a `*`/`_` as emphasis when a matching, word-boundary-respecting closer exists - so intra-word or
 * unmatched delimiters (`customer_id`, `a * b`, `unmatched_`) survive as literal characters.
 * @param {string} text
 * @returns {Array<{ kind: 'text'|'link'|'image'; text?: string; bold?: boolean; italic?: boolean; code?: boolean; href?: string; src?: string; alt?: string }>}
 */
function parseInline(text) {
	const runs = [];
	let i = 0;
	let plain = '';
	let bold = false;
	let italic = false;
	let boldChar = '';
	let italicChar = '';
	const flush = () => { if (plain) { runs.push({ kind: 'text', text: plain, bold, italic }); plain = ''; } };
	while (i < text.length) {
		const rest = text.slice(i);
		// Inline image: ![alt](src) - angle-bracket + balanced-paren aware, so paths with spaces/parens survive.
		const img = matchImageAt(text, i);
		if (img) { flush(); runs.push({ kind: 'image', alt: img.alt, src: img.src }); i += img.len; continue; }
		// Link: [text](href)
		let m = /^\[([^\]]*)\]\(([^)\s]+)[^)]*\)/.exec(rest);
		if (m) { flush(); runs.push({ kind: 'link', text: m[1], href: m[2], bold, italic }); i += m[0].length; continue; }
		// Inline code: `code`
		m = /^`([^`]+)`/.exec(rest);
		if (m) { flush(); runs.push({ kind: 'text', text: m[1], code: true }); i += m[0].length; continue; }
		// Bold: ** or __ - close only a run opened by the same delimiter; open only when a matching closer exists.
		if (rest.startsWith('**') || rest.startsWith('__')) {
			const d = rest[0];
			if (bold && boldChar === d && canCloseEmphasis(text, i, d, 2)) { flush(); bold = false; boldChar = ''; i += 2; continue; }
			if (!bold && canOpenEmphasis(text, i, d, 2)) { flush(); bold = true; boldChar = d; i += 2; continue; }
			plain += rest.slice(0, 2); i += 2; continue;
		}
		// Italic: single * or _ - same open/close discipline as bold.
		if (rest[0] === '*' || rest[0] === '_') {
			const d = rest[0];
			if (italic && italicChar === d && canCloseEmphasis(text, i, d, 1)) { flush(); italic = false; italicChar = ''; i += 1; continue; }
			if (!italic && canOpenEmphasis(text, i, d, 1)) { flush(); italic = true; italicChar = d; i += 1; continue; }
			plain += d; i += 1; continue;
		}
		plain += text[i];
		i += 1;
	}
	flush();
	return runs;
}

// --- block Markdown -> block model ----------------------------------------------------------------------

/**
 * Split resolved Markdown into a flat block model. Covers the beta fidelity floor: headings, paragraphs,
 * nested bullet/number lists, GFM pipe tables, block quotes, fenced code and standalone images.
 * @param {string} md
 * @returns {Array<object>}
 */
function parseBlocks(md) {
	const lines = String(md ?? '').replace(/\r\n?/g, '\n').split('\n');
	const blocks = [];
	let i = 0;
	const isTableSep = s => /^\s*\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)+\|?\s*$/.test(s);
	while (i < lines.length) {
		const line = lines[i];
		if (line.trim() === '') { i++; continue; }
		// Fenced code block.
		let m = /^\s*```(.*)$/.exec(line);
		if (m) {
			const code = [];
			i++;
			while (i < lines.length && !/^\s*```/.test(lines[i])) { code.push(lines[i]); i++; }
			i++; // closing fence
			blocks.push({ type: 'code', text: code.join('\n') });
			continue;
		}
		// Heading.
		m = /^(#{1,6})\s+(.*)$/.exec(line);
		if (m) { blocks.push({ type: 'heading', level: m[1].length, text: m[2].trim() }); i++; continue; }
		// GFM table: a header row followed by a separator row.
		if (/\|/.test(line) && i + 1 < lines.length && isTableSep(lines[i + 1])) {
			const rows = [];
			while (i < lines.length && /\|/.test(lines[i]) && lines[i].trim() !== '') { rows.push(lines[i]); i++; }
			const cells = row => {
				let s = row.trim();
				if (s.startsWith('|')) { s = s.slice(1); }
				if (s.endsWith('|')) { s = s.slice(0, -1); }
				return s.split('|').map(c => c.trim());
			};
			const header = cells(rows[0]);
			const body = rows.slice(2).map(cells);
			blocks.push({ type: 'table', header, rows: body });
			continue;
		}
		// Block quote (consecutive `>` lines).
		if (/^\s*>/.test(line)) {
			const quote = [];
			while (i < lines.length && /^\s*>/.test(lines[i])) { quote.push(lines[i].replace(/^\s*>\s?/, '')); i++; }
			blocks.push({ type: 'quote', text: quote.join(' ').trim() });
			continue;
		}
		// List (bullet or ordered), possibly nested by indentation.
		if (/^\s*([-*+]|\d+[.)])\s+/.test(line)) {
			const items = [];
			let start = 1;
			let sawOrdered = false;
			while (i < lines.length && /^\s*([-*+]|\d+[.)])\s+/.test(lines[i])) {
				const li = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(lines[i]);
				const indent = li[1].replace(/\t/g, '    ').length;
				const ordered = /\d/.test(li[2]);
				// Remember the first ordered marker's ordinal so `3. Third` keeps starting at 3, not 1.
				if (ordered && !sawOrdered) { start = parseInt(li[2], 10) || 1; sawOrdered = true; }
				items.push({ level: Math.min(4, Math.floor(indent / 2)), ordered, text: li[3].trim() });
				i++;
			}
			blocks.push({ type: 'list', items, start });
			continue;
		}
		// Standalone image paragraph (angle-bracket + balanced-paren aware, and only when it is the whole line).
		const trimmed = line.trim();
		const stImg = matchImageAt(trimmed, 0);
		if (stImg && stImg.len === trimmed.length) { blocks.push({ type: 'image', alt: stImg.alt, src: stImg.src }); i++; continue; }
		// Paragraph: gather until a blank line or a structural line.
		const para = [line];
		i++;
		while (i < lines.length && lines[i].trim() !== '' && !/^(#{1,6}\s|\s*```|\s*>|\s*([-*+]|\d+[.)])\s)/.test(lines[i]) && !(/\|/.test(lines[i]) && i + 1 < lines.length && isTableSep(lines[i + 1]))) {
			para.push(lines[i]);
			i++;
		}
		blocks.push({ type: 'paragraph', text: para.join(' ').trim() });
	}
	return blocks;
}

// --- image dimension sniffing --------------------------------------------------------------------------

/**
 * Read the intrinsic pixel size of a PNG/JPEG/GIF buffer so the exported image keeps its aspect ratio.
 * Falls back to a sensible default box for anything it cannot parse (SVG, unknown) - never throws.
 * @param {Buffer} buf
 * @returns {{ w: number; h: number }}
 */
function imageSize(buf) {
	try {
		// PNG: 8-byte signature, then IHDR with width/height as big-endian uint32 at offsets 16/20.
		if (buf.length > 24 && buf[0] === 0x89 && buf[1] === 0x50) {
			return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
		}
		// GIF: width/height little-endian uint16 at offsets 6/8.
		if (buf.length > 10 && buf[0] === 0x47 && buf[1] === 0x49) {
			return { w: buf.readUInt16LE(6), h: buf.readUInt16LE(8) };
		}
		// JPEG: scan segments for a Start-Of-Frame marker (0xC0..0xCF, excluding 0xC4/0xC8/0xCC).
		if (buf.length > 4 && buf[0] === 0xFF && buf[1] === 0xD8) {
			let o = 2;
			while (o + 9 < buf.length) {
				if (buf[o] !== 0xFF) { o++; continue; }
				const marker = buf[o + 1];
				if (marker >= 0xC0 && marker <= 0xCF && marker !== 0xC4 && marker !== 0xC8 && marker !== 0xCC) {
					return { h: buf.readUInt16BE(o + 5), w: buf.readUInt16BE(o + 7) };
				}
				const len = buf.readUInt16BE(o + 2);
				o += 2 + len;
			}
		}
	} catch { /* fall through to default */ }
	return { w: 576, h: 384 };
}

/** Map a data-URI mime to a media-file extension. */
function extForMime(mime) {
	if (/png/.test(mime)) { return 'png'; }
	if (/jpe?g/.test(mime)) { return 'jpeg'; }
	if (/gif/.test(mime)) { return 'gif'; }
	if (/svg/.test(mime)) { return 'svg'; }
	if (/webp/.test(mime)) { return 'webp'; }
	return 'png';
}

// --- document.xml assembly -----------------------------------------------------------------------------

const BULLET_NUM_ID = 1;
const ORDERED_NUM_ID = 2; // The default numId the built-in ListNumber style points at.
const ORDERED_NUM_BASE = 100; // Per-ordered-list numbering instances start here, so each list numbers independently.

/** Serialise one styled run into a `<w:r>`. */
function runXml(r, rels) {
	if (r.kind === 'image') {
		return imageRunXml(r, rels);
	}
	const rpr = [];
	if (r.bold) { rpr.push('<w:b/>'); }
	if (r.italic) { rpr.push('<w:i/>'); }
	if (r.code) { rpr.push('<w:rStyle w:val="VerbatimChar"/>'); }
	const rprXml = rpr.length ? `<w:rPr>${rpr.join('')}</w:rPr>` : '';
	// xml:space="preserve" keeps leading/trailing spaces that carry meaning between adjacent runs.
	return `<w:r>${rprXml}<w:t xml:space="preserve">${xml(r.text || '')}</w:t></w:r>`;
}

/** A hyperlink: the visual run wrapped in `<w:hyperlink>` bound to an external relationship. */
function linkXml(r, rels) {
	const rId = rels.addHyperlink(r.href);
	const inner = `<w:r><w:rPr><w:rStyle w:val="Hyperlink"/>${r.bold ? '<w:b/>' : ''}${r.italic ? '<w:i/>' : ''}</w:rPr><w:t xml:space="preserve">${xml(r.text || r.href)}</w:t></w:r>`;
	return `<w:hyperlink r:id="${rId}">${inner}</w:hyperlink>`;
}

/** An inline image drawing. Registers the media part + relationship and sizes it to the intrinsic aspect. */
function imageRunXml(r, rels) {
	const media = rels.addImage(r.src);
	if (!media) { return `<w:r><w:t xml:space="preserve">${xml('[image: ' + (r.alt || r.src) + ']')}</w:t></w:r>`; }
	let cx = Math.max(1, media.w) * EMU_PER_PX;
	let cy = Math.max(1, media.h) * EMU_PER_PX;
	// Scale down proportionally so the image fits within BOTH the printable width and height - a tall
	// screenshot that is only width-clamped would otherwise run dozens of inches off the bottom of the page.
	const scale = Math.min(1, MAX_IMAGE_WIDTH_EMU / cx, MAX_IMAGE_HEIGHT_EMU / cy);
	cx = Math.round(cx * scale);
	cy = Math.round(cy * scale);
	const id = media.id;
	const name = xml(r.alt || `image${id}`);
	return `<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0">`
		+ `<wp:extent cx="${cx}" cy="${cy}"/><wp:effectExtent l="0" t="0" r="0" b="0"/>`
		+ `<wp:docPr id="${id}" name="${name}" descr="${name}"/>`
		+ `<wp:cNvGraphicFramePr><a:graphicFrameLocks xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" noChangeAspect="1"/></wp:cNvGraphicFramePr>`
		+ `<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">`
		+ `<pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">`
		+ `<pic:nvPicPr><pic:cNvPr id="${id}" name="${name}" descr="${name}"/><pic:cNvPicPr/></pic:nvPicPr>`
		+ `<pic:blipFill><a:blip r:embed="${media.rId}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>`
		+ `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm>`
		+ `<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic>`
		+ `</a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`;
}

/** Render the inline runs of one text line into the run-level XML. */
function inlineXml(text, rels) {
	return parseInline(text).map(r => r.kind === 'link' ? linkXml(r, rels) : runXml(r, rels)).join('');
}

/** A styled paragraph. `style` is a Word built-in styleId; `numId`/`ilvl` attach list numbering. */
function paragraphXml(style, inline, numId, ilvl) {
	const ppr = [];
	if (style) { ppr.push(`<w:pStyle w:val="${style}"/>`); }
	if (numId) { ppr.push(`<w:numPr><w:ilvl w:val="${ilvl || 0}"/><w:numId w:val="${numId}"/></w:numPr>`); }
	const pprXml = ppr.length ? `<w:pPr>${ppr.join('')}</w:pPr>` : '';
	return `<w:p>${pprXml}${inline}</w:p>`;
}

/** A GFM table mapped to the built-in Table Grid style with a bold header row. */
function tableXml(block, rels) {
	const cols = block.header.length || 1;
	const grid = `<w:tblGrid>${'<w:gridCol/>'.repeat(cols)}</w:tblGrid>`;
	const cell = (text, bold) => {
		const inline = bold
			? `<w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">${xml(text)}</w:t></w:r>`
			: inlineXml(text, rels);
		return `<w:tc><w:tcPr><w:tcW w:w="0" w:type="auto"/></w:tcPr><w:p>${inline || '<w:r><w:t/></w:r>'}</w:p></w:tc>`;
	};
	const headerRow = `<w:tr>${block.header.map(h => cell(h, true)).join('')}</w:tr>`;
	const bodyRows = block.rows.map(row => {
		const padded = [];
		for (let c = 0; c < cols; c++) { padded.push(cell(row[c] ?? '', false)); }
		return `<w:tr>${padded.join('')}</w:tr>`;
	}).join('');
	return `<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/><w:tblW w:w="0" w:type="auto"/></w:tblPr>${grid}${headerRow}${bodyRows}</w:tbl>`;
}

const HEADING_STYLE = ['Title', 'Heading1', 'Heading2', 'Heading3', 'Heading4', 'Heading5', 'Heading6'];

/** Turn one block into its body XML (may be several paragraphs). */
function blockXml(block, rels) {
	switch (block.type) {
		case 'heading':
			return paragraphXml(HEADING_STYLE[Math.min(6, block.level)], inlineXml(block.text, rels));
		case 'paragraph':
			return paragraphXml('', inlineXml(block.text, rels));
		case 'quote':
			return paragraphXml('Quote', inlineXml(block.text, rels));
		case 'code':
			// Preformatted: each source line is its own no-spacing paragraph in the built-in HTML Preformatted style.
			return block.text.split('\n').map(l => paragraphXml('HTMLPreformatted', `<w:r><w:t xml:space="preserve">${xml(l)}</w:t></w:r>`)).join('');
		case 'image':
			return paragraphXml('', imageRunXml(block, rels));
		case 'list': {
			// Allocate ONE ordered numbering instance for this list block (lazily, only if it has ordered items) so
			// separate ordered lists number independently and this one starts at its captured ordinal.
			let orderedNumId = 0;
			return block.items.map(it => {
				if (it.ordered) {
					if (!orderedNumId) { orderedNumId = rels.addOrderedList(block.start); }
					return paragraphXml('ListNumber', inlineXml(it.text, rels), orderedNumId, it.level);
				}
				return paragraphXml('ListBullet', inlineXml(it.text, rels), BULLET_NUM_ID, it.level);
			}).join('');
		}
		case 'table':
			// A trailing empty paragraph keeps Word from merging a table with whatever follows.
			return tableXml(block, rels) + '<w:p/>';
		default:
			return '';
	}
}

// --- relationship + media registry ---------------------------------------------------------------------

/** Tracks document.xml relationships (styles, numbering, images, hyperlinks) and the media parts. */
function makeRels(images) {
	// rId1/rId2 are reserved for styles + numbering (see documentRels()).
	let next = 3;
	let picId = 1000;
	const hyperlinks = [];
	const media = [];
	const orderedLists = [];
	return {
		addHyperlink(href) {
			const rId = `rId${next++}`;
			hyperlinks.push({ rId, href: href || '' });
			return rId;
		},
		addOrderedList(start) {
			const numId = ORDERED_NUM_BASE + orderedLists.length;
			orderedLists.push({ numId, start: start > 0 ? start : 1 });
			return numId;
		},
		addImage(src) {
			const data = images && images[src];
			if (!data) { return null; }
			const m = /^data:([^;]+);base64,(.*)$/.exec(data);
			if (!m) { return null; }
			let buf;
			try { buf = Buffer.from(m[2], 'base64'); } catch { return null; }
			const ext = extForMime(m[1]);
			const dim = imageSize(buf);
			const rId = `rId${next++}`;
			const idx = media.length + 1;
			const partName = `media/image${idx}.${ext}`;
			media.push({ rId, partName, ext, buf });
			return { rId, id: picId++, w: dim.w, h: dim.h };
		},
		hyperlinks,
		media,
		orderedLists,
	};
}

// --- fixed parts ---------------------------------------------------------------------------------------

function contentTypes(media) {
	const seen = new Set();
	const defaults = ['<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>',
		'<Default Extension="xml" ContentType="application/xml"/>'];
	for (const m of media) {
		if (seen.has(m.ext)) { continue; }
		seen.add(m.ext);
		const ct = m.ext === 'png' ? 'image/png' : m.ext === 'jpeg' ? 'image/jpeg' : m.ext === 'gif' ? 'image/gif' : m.ext === 'svg' ? 'image/svg+xml' : m.ext === 'webp' ? 'image/webp' : 'application/octet-stream';
		defaults.push(`<Default Extension="${m.ext}" ContentType="${ct}"/>`);
	}
	return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`
		+ `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">`
		+ defaults.join('')
		+ `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>`
		+ `<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>`
		+ `<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>`
		+ `</Types>`;
}

const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`
	+ `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`
	+ `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>`
	+ `</Relationships>`;

function documentRels(rels) {
	const parts = [`<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>`,
		`<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>`];
	for (const h of rels.hyperlinks) {
		parts.push(`<Relationship Id="${h.rId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="${xml(h.href)}" TargetMode="External"/>`);
	}
	for (const m of rels.media) {
		parts.push(`<Relationship Id="${m.rId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="${m.partName}"/>`);
	}
	return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`
		+ `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${parts.join('')}</Relationships>`;
}

// styles.xml: declares the Word BUILT-IN styles the body references, each with its real built-in styleId and
// name so Word treats them as the native styles (a Heading 1 restyle in the receiving doc reflows ours).
function stylesXml() {
	const heading = (n, size) => `<w:style w:type="paragraph" w:styleId="Heading${n}"><w:name w:val="heading ${n}"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="240" w:after="60"/><w:outlineLvl w:val="${n - 1}"/></w:pPr><w:rPr><w:b/><w:sz w:val="${size}"/></w:rPr></w:style>`;
	return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`
		+ `<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">`
		+ `<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:sz w:val="22"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="160" w:line="259" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>`
		+ `<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>`
		+ `<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:after="120"/></w:pPr><w:rPr><w:sz w:val="56"/><w:b/></w:rPr></w:style>`
		+ `<w:style w:type="paragraph" w:styleId="Subtitle"><w:name w:val="Subtitle"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:rPr><w:i/><w:color w:val="595959"/><w:sz w:val="24"/></w:rPr></w:style>`
		+ heading(1, 36) + heading(2, 30) + heading(3, 26) + heading(4, 24) + heading(5, 22) + heading(6, 22)
		+ `<w:style w:type="paragraph" w:styleId="ListBullet"><w:name w:val="List Bullet"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:numPr><w:numId w:val="${BULLET_NUM_ID}"/></w:numPr></w:pPr></w:style>`
		+ `<w:style w:type="paragraph" w:styleId="ListNumber"><w:name w:val="List Number"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:numPr><w:numId w:val="${ORDERED_NUM_ID}"/></w:numPr></w:pPr></w:style>`
		+ `<w:style w:type="paragraph" w:styleId="Quote"><w:name w:val="Quote"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:ind w:left="720"/></w:pPr><w:rPr><w:i/><w:color w:val="404040"/></w:rPr></w:style>`
		+ `<w:style w:type="paragraph" w:styleId="HTMLPreformatted"><w:name w:val="HTML Preformatted"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/><w:sz w:val="20"/></w:rPr></w:style>`
		+ `<w:style w:type="character" w:styleId="Hyperlink"><w:name w:val="Hyperlink"/><w:rPr><w:color w:val="0563C1"/><w:u w:val="single"/></w:rPr></w:style>`
		+ `<w:style w:type="character" w:styleId="VerbatimChar"><w:name w:val="Verbatim Char"/><w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/><w:sz w:val="20"/></w:rPr></w:style>`
		+ `<w:style w:type="table" w:default="1" w:styleId="TableNormal"><w:name w:val="Normal Table"/><w:tblPr><w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:left w:w="108" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/><w:right w:w="108" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style>`
		+ `<w:style w:type="table" w:styleId="TableGrid"><w:name w:val="Table Grid"/><w:basedOn w:val="TableNormal"/><w:tblPr><w:tblBorders><w:top w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:left w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:bottom w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:right w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:insideH w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:insideV w:val="single" w:sz="4" w:space="0" w:color="auto"/></w:tblBorders></w:tblPr></w:style>`
		+ `</w:styles>`;
}

// numbering.xml: one bullet list + one decimal list, each with five indent levels so nested items render
// real glyphs (referencing a built-in List style alone does not carry the numbering association). Every ordered
// list block from the body also gets its OWN `<w:num>` instance (via rels.orderedLists), each overriding the
// level-0 start so separate lists number independently and a list beginning at `3.` keeps its ordinal.
function numberingXml(rels) {
	const levels = fmt => {
		let out = '';
		for (let l = 0; l < 5; l++) {
			const indent = 720 * (l + 1);
			out += `<w:lvl w:ilvl="${l}"><w:start w:val="1"/><w:numFmt w:val="${fmt}"/><w:lvlText w:val="${fmt === 'bullet' ? '•' : '%' + (l + 1) + '.'}"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="${indent}" w:hanging="360"/></w:pPr>${fmt === 'bullet' ? '<w:rPr><w:rFonts w:ascii="Symbol" w:hAnsi="Symbol"/></w:rPr>' : ''}</w:lvl>`;
		}
		return out;
	};
	const orderedInstances = ((rels && rels.orderedLists) || [])
		.map(o => `<w:num w:numId="${o.numId}"><w:abstractNumId w:val="1"/><w:lvlOverride w:ilvl="0"><w:startOverride w:val="${o.start}"/></w:lvlOverride></w:num>`)
		.join('');
	return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`
		+ `<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">`
		+ `<w:abstractNum w:abstractNumId="0"><w:multiLevelType w:val="hybridMultilevel"/>${levels('bullet')}</w:abstractNum>`
		+ `<w:abstractNum w:abstractNumId="1"><w:multiLevelType w:val="multilevel"/>${levels('decimal')}</w:abstractNum>`
		+ `<w:num w:numId="${BULLET_NUM_ID}"><w:abstractNumId w:val="0"/></w:num>`
		+ `<w:num w:numId="${ORDERED_NUM_ID}"><w:abstractNumId w:val="1"/></w:num>`
		+ orderedInstances
		+ `</w:numbering>`;
}

function documentXml(title, subtitle, blocks, rels) {
	const body = [];
	if (title) { body.push(paragraphXml('Title', inlineXml(title, rels))); }
	if (subtitle) { body.push(paragraphXml('Subtitle', inlineXml(subtitle, rels))); }
	for (const block of blocks) { body.push(blockXml(block, rels)); }
	// A section with Letter page size + 1-inch margins, so the printable width matches MAX_IMAGE_WIDTH_EMU.
	const sectPr = `<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr>`;
	return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`
		+ `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" `
		+ `xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" `
		+ `xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" `
		+ `xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" `
		+ `xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">`
		+ `<w:body>${body.join('')}${sectPr}</w:body></w:document>`;
}

// --- store-method ZIP packaging ------------------------------------------------------------------------

const CRC_TABLE = (() => {
	const t = new Int32Array(256);
	for (let n = 0; n < 256; n++) {
		let c = n;
		for (let k = 0; k < 8; k++) { c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1); }
		t[n] = c;
	}
	return t;
})();

function crc32(buf) {
	let c = 0 ^ -1;
	for (let i = 0; i < buf.length; i++) { c = (c >>> 8) ^ CRC_TABLE[(c ^ buf[i]) & 0xFF]; }
	return (c ^ -1) >>> 0;
}

/**
 * Pack named entries into a valid ZIP using the STORE method (no compression). Store is deliberate: it needs
 * no deflate state and no compressed-size bookkeeping, so the archive is bulletproof and the writer stays
 * dependency-free bar CRC32. Word opens store-method .docx files without complaint.
 * @param {Array<{ name: string; data: Buffer }>} entries
 * @returns {Buffer}
 */
function zipStore(entries) {
	const locals = [];
	const central = [];
	let offset = 0;
	for (const e of entries) {
		const nameBuf = Buffer.from(e.name, 'utf8');
		const crc = crc32(e.data);
		const size = e.data.length;
		const local = Buffer.alloc(30);
		local.writeUInt32LE(0x04034b50, 0); // local file header signature
		local.writeUInt16LE(20, 4); // version needed
		local.writeUInt16LE(0x0800, 6); // general purpose flag: UTF-8 names
		local.writeUInt16LE(0, 8); // method: store
		local.writeUInt16LE(0, 10); // mod time
		local.writeUInt16LE(0x21, 12); // mod date (deterministic, 1980-01-01)
		local.writeUInt32LE(crc, 14);
		local.writeUInt32LE(size, 18); // compressed size == size for store
		local.writeUInt32LE(size, 22); // uncompressed size
		local.writeUInt16LE(nameBuf.length, 26);
		local.writeUInt16LE(0, 28); // extra length
		locals.push(local, nameBuf, e.data);

		const cen = Buffer.alloc(46);
		cen.writeUInt32LE(0x02014b50, 0); // central directory signature
		cen.writeUInt16LE(20, 4); // version made by
		cen.writeUInt16LE(20, 6); // version needed
		cen.writeUInt16LE(0x0800, 8); // flags: UTF-8
		cen.writeUInt16LE(0, 10); // method
		cen.writeUInt16LE(0, 12); // time
		cen.writeUInt16LE(0x21, 14); // date
		cen.writeUInt32LE(crc, 16);
		cen.writeUInt32LE(size, 20);
		cen.writeUInt32LE(size, 24);
		cen.writeUInt16LE(nameBuf.length, 28);
		cen.writeUInt16LE(0, 30); // extra
		cen.writeUInt16LE(0, 32); // comment
		cen.writeUInt16LE(0, 34); // disk number
		cen.writeUInt16LE(0, 36); // internal attrs
		cen.writeUInt32LE(0, 38); // external attrs
		cen.writeUInt32LE(offset, 42); // local header offset
		central.push(cen, nameBuf);

		offset += local.length + nameBuf.length + e.data.length;
	}
	const centralBuf = Buffer.concat(central);
	const eocd = Buffer.alloc(22);
	eocd.writeUInt32LE(0x06054b50, 0); // end of central dir signature
	eocd.writeUInt16LE(0, 4); // disk
	eocd.writeUInt16LE(0, 6); // central dir disk
	eocd.writeUInt16LE(entries.length, 8); // entries this disk
	eocd.writeUInt16LE(entries.length, 10); // total entries
	eocd.writeUInt32LE(centralBuf.length, 12); // central dir size
	eocd.writeUInt32LE(offset, 16); // central dir offset
	eocd.writeUInt16LE(0, 20); // comment length
	return Buffer.concat([...locals, centralBuf, eocd]);
}

// --- public API ----------------------------------------------------------------------------------------

/**
 * Build a .docx from a living document's resolved export Markdown.
 * @param {{ title?: string; subtitle?: string; markdown: string; images?: Record<string, string> }} input
 *   `markdown` is the renderer's resolved export Markdown (bind values already inlined as plain text);
 *   `images` maps a Markdown image src to a `data:<mime>;base64,<...>` URI.
 * @returns {Buffer} the .docx bytes.
 */
function renderDocx(input) {
	const images = input.images || {};
	const rels = makeRels(images);
	const blocks = parseBlocks(input.markdown || '');
	// The export Markdown leads with `# title` then a wholly-italic `_subtitle_` paragraph (renderExportMarkdown).
	// When no explicit title is passed, promote that leading heading to Word's Title style and the italic line to
	// Subtitle, then drop them from the body - so the title renders once, in the built-in Title style.
	let title = input.title || '';
	let subtitle = input.subtitle || '';
	if (!title && blocks[0] && blocks[0].type === 'heading' && blocks[0].level === 1) {
		title = blocks.shift().text;
		if (!subtitle && blocks[0] && blocks[0].type === 'paragraph' && /^_[^_]+_$|^\*[^*]+\*$/.test(blocks[0].text.trim())) {
			subtitle = blocks.shift().text.trim().replace(/^[_*]|[_*]$/g, '');
		}
	}
	// document.xml must be built BEFORE the parts that depend on the registry (media list, rels), because
	// assembling the body is what populates them.
	const docXml = documentXml(title, subtitle, blocks, rels);
	const entries = [
		{ name: '[Content_Types].xml', data: Buffer.from(contentTypes(rels.media), 'utf8') },
		{ name: '_rels/.rels', data: Buffer.from(ROOT_RELS, 'utf8') },
		{ name: 'word/document.xml', data: Buffer.from(docXml, 'utf8') },
		{ name: 'word/_rels/document.xml.rels', data: Buffer.from(documentRels(rels), 'utf8') },
		{ name: 'word/styles.xml', data: Buffer.from(stylesXml(), 'utf8') },
		{ name: 'word/numbering.xml', data: Buffer.from(numberingXml(rels), 'utf8') },
	];
	for (const m of rels.media) {
		entries.push({ name: `word/${m.partName}`, data: m.buf });
	}
	return zipStore(entries);
}

module.exports = { renderDocx, parseBlocks, parseInline, imageSize, zipStore, crc32 };
