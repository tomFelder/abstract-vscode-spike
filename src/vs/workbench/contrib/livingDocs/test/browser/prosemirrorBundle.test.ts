/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { decodeBase64 } from '../../../../../base/common/buffer.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { PROSEMIRROR_BUNDLE_BASE64 } from '../../browser/prosemirrorBundle.js';

// The headless surface the vendored bundle exposes for round-trip testing. The bundle is the SAME
// artifact shipped into the webview (decision 43/46); we exercise it directly so the test proves the
// real bound-figure node + Markdown serialize/parse, not a re-implementation.
interface ILwdpmTestSurface {
	roundTrip(markdown: string): string;
	docJSON(markdown: string): unknown;
}

// Decode + evaluate the vendored IIFE once. It assigns `window.LWDPM`; we hand it a plain object as
// `window` so it never touches the real global. `roundTrip`/`docJSON` only use the Markdown
// parser/serializer (no DOM), so this is safe in the unit-test environment.
function loadLwdpm(): ILwdpmTestSurface {
	const code = decodeBase64(PROSEMIRROR_BUNDLE_BASE64).toString();
	const sandbox: { LWDPM?: ILwdpmTestSurface } = {};
	new Function('window', code)(sandbox);
	if (!sandbox.LWDPM) {
		throw new Error('vendored ProseMirror bundle did not define window.LWDPM');
	}
	return sandbox.LWDPM;
}

suite('ProseMirror vendored bundle (LWDPM)', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	const lwdpm = loadLwdpm();

	test('a bound figure parses to a bound_figure node and round-trips to [label](bind:key)', () => {
		const md = 'Revenue reached [49,800](bind:metrics.mrr.latest) this quarter.';

		// The figure is a first-class atom node (decision 46) carrying the resolved label + its key,
		// sitting inline between the surrounding text runs - not a stripped link or plain text.
		// (Normalize through JSON: ProseMirror's toJSON gives attrs a null prototype.)
		const json = JSON.parse(JSON.stringify(lwdpm.docJSON(md)));
		assert.deepStrictEqual(json, {
			type: 'doc',
			content: [{
				type: 'paragraph',
				content: [
					{ type: 'text', text: 'Revenue reached ' },
					{ type: 'bound_figure', attrs: { label: '49,800', key: 'metrics.mrr.latest' } },
					{ type: 'text', text: ' this quarter.' }
				]
			}]
		});

		// And it serializes back byte-identically (the on-disk round-trip the keystone needs).
		assert.strictEqual(lwdpm.roundTrip(md).trim(), md);
	});

	test('plain Markdown (heading, emphasis, list) round-trips unchanged', () => {
		const md = '# Heading\n\nA paragraph with **bold** and *italic*.\n\n* one\n* two';
		assert.strictEqual(lwdpm.roundTrip(md).trim(), md.trim());
	});

	test('a normal link stays a normal link (only bind: links become figures)', () => {
		const md = 'Growth of [12%](bind:metrics.growth) beside a [real link](https://example.com).';
		const json = JSON.stringify(lwdpm.docJSON(md));
		// Exactly one bound_figure (the bind: link); the http link is preserved as a link mark.
		assert.strictEqual(json.split('"bound_figure"').length - 1, 1);
		assert.ok(json.includes('https://example.com'), 'normal link href should survive');
		assert.strictEqual(lwdpm.roundTrip(md).trim(), md);
	});
});
