/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Pure, DOM-free helpers for the image-asset pipeline (issue #141): pasted/dropped images are written
// beside the document under `assets/<doc-basename>/` (the #129 import layout), and relative image srcs
// in a doc body are resolved to a data URI for display. Everything here is string-in/string-out so it is
// unit-testable and, in the case of `isRelativeImageSrc`, injectable verbatim into the webview RUNTIME via
// `String(fn)` (no imports, no captured state, no TS-only syntax that would transpile to a helper).

// The extension we give an asset whose supplied name carries none, keyed off the MIME the webview reported.
const MIME_EXT: Record<string, string> = {
	'image/png': 'png',
	'image/jpeg': 'jpg',
	'image/jpg': 'jpg',
	'image/gif': 'gif',
	'image/webp': 'webp',
	'image/svg+xml': 'svg',
	'image/bmp': 'bmp',
	'image/x-icon': 'ico',
	'image/vnd.microsoft.icon': 'ico',
	'image/avif': 'avif',
	'image/tiff': 'tiff',
};

// The MIME we serve a resolved relative image back as, keyed off its file extension. Unknown extensions
// fall back to a generic image type so the browser still attempts to render it rather than download it.
const EXT_MIME: Record<string, string> = {
	png: 'image/png',
	jpg: 'image/jpeg',
	jpeg: 'image/jpeg',
	gif: 'image/gif',
	webp: 'image/webp',
	svg: 'image/svg+xml',
	bmp: 'image/bmp',
	ico: 'image/x-icon',
	avif: 'image/avif',
	tif: 'image/tiff',
	tiff: 'image/tiff',
};

/** The file extension (no dot, lower-case) for a reported MIME, defaulting to `png` for an unknown type. */
export function extForMime(mime: string | undefined): string {
	const key = String(mime ?? '').toLowerCase().split(';')[0].trim();
	return MIME_EXT[key] ?? 'png';
}

/** The image MIME to serve a file back as, derived from its extension; defaults to a generic PNG. */
export function imageMimeForName(name: string): string {
	const raw = String(name ?? '');
	const dot = raw.lastIndexOf('.');
	const ext = dot >= 0 ? raw.slice(dot + 1).toLowerCase().replace(/[^a-z0-9]+/g, '') : '';
	return EXT_MIME[ext] ?? 'image/png';
}

/**
 * Turn a clipboard/drop file name into a safe on-disk asset name: strip any directory components, keep a
 * single lower-cased extension (deriving one from the MIME when the name has none), and reduce the stem to
 * a conservative `[A-Za-z0-9._-]` set so it is safe across file systems. An empty stem becomes `image`.
 */
export function sanitizeImageAssetName(name: string, mime?: string): string {
	// Drop any path the browser may have prefixed (some drops carry `folder/name.png`).
	const base = String(name ?? '').replace(/^.*[\\/]/, '').trim();
	const dot = base.lastIndexOf('.');
	let stem = dot > 0 ? base.slice(0, dot) : base;
	let ext = dot > 0 ? base.slice(dot + 1) : '';
	stem = stem.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^[-.]+|[-.]+$/g, '');
	if (!stem) { stem = 'image'; }
	ext = ext.replace(/[^A-Za-z0-9]+/g, '').toLowerCase();
	if (!ext) { ext = extForMime(mime); }
	return stem + '.' + ext;
}

/**
 * De-duplicate an asset file name against the names already present in the target folder (case-insensitive):
 * `chart.png` -> `chart.png` when free, else `chart-2.png`, `chart-3.png`, ... The dedupe suffix is inserted
 * before the extension so the file keeps a valid, recognisable type.
 */
export function dedupeAssetName(name: string, existing: readonly string[]): string {
	const taken = new Set(existing.map(n => n.toLowerCase()));
	if (!taken.has(name.toLowerCase())) { return name; }
	const dot = name.lastIndexOf('.');
	const stem = dot > 0 ? name.slice(0, dot) : name;
	const ext = dot > 0 ? name.slice(dot) : '';
	let n = 2;
	while (taken.has((stem + '-' + n + ext).toLowerCase())) { n++; }
	return stem + '-' + n + ext;
}

/**
 * True when an image `src` is a document-relative path that the host must resolve to a data URI before it
 * can display (e.g. `assets/Probe/logo.png`, `./img/a.png`). False for anything already loadable on its own:
 * a `data:`/`blob:` URI, a protocol-relative `//host/...`, or any absolute scheme (`http:`, `https:`, `file:`,
 * `vscode-webview:`, ...). Kept fully self-contained (regex + String only) so it can be injected verbatim into
 * the webview RUNTIME via `String(fn)`.
 */
export function isRelativeImageSrc(src: string): boolean {
	const s = src ? String(src).trim() : '';
	if (!s) { return false; }
	if (s.indexOf('data:') === 0) { return false; }
	if (s.indexOf('blob:') === 0) { return false; }
	if (s.indexOf('//') === 0) { return false; }
	if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(s)) { return false; }
	return true;
}
