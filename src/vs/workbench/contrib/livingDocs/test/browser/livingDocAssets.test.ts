/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { dedupeAssetName, extForMime, imageMimeForName, isRelativeImageSrc, matchMarkdownImageAt, rewriteMarkdownImageSrcs, sanitizeImageAssetName } from '../../common/livingDocAssets.js';

suite('LivingDoc image assets', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	// --- sanitizeImageAssetName: safe on-disk names for pasted/dropped files ---

	test('a clean name passes through with a lower-cased extension', () => {
		assert.strictEqual(sanitizeImageAssetName('chart.png'), 'chart.png');
		assert.strictEqual(sanitizeImageAssetName('Shot.PNG'), 'Shot.png');
	});

	test('unsafe characters collapse to dashes; path prefixes are stripped', () => {
		assert.strictEqual(sanitizeImageAssetName('my screen shot (1).png'), 'my-screen-shot-1.png');
		assert.strictEqual(sanitizeImageAssetName('folder/sub\\evil name.png'), 'evil-name.png');
	});

	test('a missing extension is derived from the MIME; a missing name becomes image.<ext>', () => {
		assert.strictEqual(sanitizeImageAssetName('screenshot', 'image/png'), 'screenshot.png');
		assert.strictEqual(sanitizeImageAssetName('photo', 'image/jpeg'), 'photo.jpg');
		assert.strictEqual(sanitizeImageAssetName('', 'image/gif'), 'image.gif');
		assert.strictEqual(sanitizeImageAssetName('...', 'image/webp'), 'image.webp');
	});

	test('an unknown MIME still yields a usable extension', () => {
		assert.strictEqual(extForMime('image/whoknows'), 'png');
		assert.strictEqual(extForMime(undefined), 'png');
		assert.strictEqual(extForMime('image/svg+xml'), 'svg');
	});

	// --- dedupeAssetName: name.png, name-2.png, ... ---

	test('a free name is kept as-is', () => {
		assert.strictEqual(dedupeAssetName('chart.png', []), 'chart.png');
		assert.strictEqual(dedupeAssetName('chart.png', ['other.png']), 'chart.png');
	});

	test('a collision inserts -2 before the extension, then counts up', () => {
		assert.strictEqual(dedupeAssetName('chart.png', ['chart.png']), 'chart-2.png');
		assert.strictEqual(dedupeAssetName('chart.png', ['chart.png', 'chart-2.png']), 'chart-3.png');
	});

	test('dedupe is case-insensitive (safe on case-insensitive file systems)', () => {
		assert.strictEqual(dedupeAssetName('Chart.png', ['chart.PNG']), 'Chart-2.png');
	});

	// --- imageMimeForName: the MIME a resolved relative image is served back as ---

	test('the reply MIME derives from the extension, with a PNG fallback', () => {
		assert.strictEqual(imageMimeForName('assets/Probe/logo.png'), 'image/png');
		assert.strictEqual(imageMimeForName('photo.JPEG'), 'image/jpeg');
		assert.strictEqual(imageMimeForName('anim.gif'), 'image/gif');
		assert.strictEqual(imageMimeForName('icon.svg'), 'image/svg+xml');
		assert.strictEqual(imageMimeForName('mystery.zzz'), 'image/png');
	});

	// --- isRelativeImageSrc: what the webview must round-trip to the host ---

	test('relative paths are classified as needing host resolution', () => {
		assert.strictEqual(isRelativeImageSrc('assets/Probe/shot.png'), true);
		assert.strictEqual(isRelativeImageSrc('logo.png'), true);
		assert.strictEqual(isRelativeImageSrc('./img/a.png'), true);
		assert.strictEqual(isRelativeImageSrc('../up/a.png'), true);
	});

	test('already-loadable srcs are left alone', () => {
		assert.strictEqual(isRelativeImageSrc('data:image/png;base64,AAA'), false);
		assert.strictEqual(isRelativeImageSrc('blob:https://x/y'), false);
		assert.strictEqual(isRelativeImageSrc('http://example.com/a.png'), false);
		assert.strictEqual(isRelativeImageSrc('https://example.com/a.png'), false);
		assert.strictEqual(isRelativeImageSrc('file:///tmp/a.png'), false);
		assert.strictEqual(isRelativeImageSrc('vscode-webview://abc/a.png'), false);
		assert.strictEqual(isRelativeImageSrc('//cdn.example.com/a.png'), false);
		assert.strictEqual(isRelativeImageSrc(''), false);
		assert.strictEqual(isRelativeImageSrc('   '), false);
	});

	// --- RUNTIME injectability: the classifier is interpolated into the webview script via String(fn), so
	// its compiled source must be fully self-contained (no imports/require/TS-emitted helper references). ---

	test('isRelativeImageSrc is String(fn)-injectable into the webview RUNTIME', () => {
		const src = String(isRelativeImageSrc);
		assert.ok(src.startsWith('function isRelativeImageSrc('), 'a plain named function declaration');
		assert.ok(!src.includes('import'), 'no import references');
		assert.ok(!src.includes('require'), 'no require references');
		assert.ok(!src.includes('exports'), 'no exports references');
		assert.ok(!src.includes('__'), 'no TS-emitted helper references (e.g. __awaiter)');
		// Ensure the injected copy actually evaluates standalone.
		// eslint-disable-next-line no-eval
		const fn = (0, eval)(`(${src})`);
		assert.strictEqual(fn('assets/x.png'), true);
		assert.strictEqual(fn('data:image/png;base64,AAA'), false);
	});

	// --- matchMarkdownImageAt: the destination parse the exporter feeds off (issue #131/#245 D2) ---

	test('a space-containing import path is matched whole, not truncated at the first space', () => {
		// The docx importer emits `![](assets/<stem>/image-N.ext)` with the doc's stem verbatim, so a document
		// named "Weekly Report.docx" yields a path with a raw space. The naive first-space stop dropped it.
		const md = '![](assets/Weekly Report/image-1.png)';
		assert.deepStrictEqual(matchMarkdownImageAt(md, 0), { src: 'assets/Weekly Report/image-1.png', end: md.length });
	});

	test('bare, angle-wrapped, quoted-title and balanced-paren destinations all parse', () => {
		const cases: [string, string | undefined][] = [
			['![a](assets/Probe/logo.png)', 'assets/Probe/logo.png'],
			['![a](<assets/My Doc/pic.png>)', 'assets/My Doc/pic.png'],
			['![a](assets/My Doc/pic.png "a title")', 'assets/My Doc/pic.png'],
			['![a](assets/some(paren)/x.png)', 'assets/some(paren)/x.png'],
			['not an image', undefined],
		];
		assert.deepStrictEqual(cases.map(([md]) => matchMarkdownImageAt(md, 0)?.src), cases.map(([, src]) => src));
	});

	// --- rewriteMarkdownImageSrcs: inline resolved images for a self-contained export (issue #131/#245 D1) ---

	test('relative image srcs are rewritten to their resolved data URIs, angle-wrapped; unresolved paths are left', () => {
		const md = 'Intro\n\n![chart](assets/Weekly Report/image-1.png)\n\n![missing](assets/Weekly Report/gone.png)';
		const out = rewriteMarkdownImageSrcs(md, new Map([['assets/Weekly Report/image-1.png', 'data:image/png;base64,AAAB']]));
		assert.strictEqual(out, 'Intro\n\n![chart](<data:image/png;base64,AAAB>)\n\n![missing](assets/Weekly Report/gone.png)');
	});
});
