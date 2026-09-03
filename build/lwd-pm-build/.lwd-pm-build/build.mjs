// Build the vendored LWDPM ProseMirror bundle (decision 43/46).
//   node build.mjs           -> writes bundle.iife.js + prints stats + smoke-tests round-trip
//   node build.mjs --emit    -> also rewrites the repo's prosemirrorBundle.ts with fresh base64
import { build } from 'esbuild';
import { readFileSync, writeFileSync } from 'node:fs';

const REPO = process.env.LWD_REPO || '/Users/tommy/Sites/abstract-vscode-spike';
const TARGET = REPO + '/src/vs/workbench/contrib/livingDocs/browser/prosemirrorBundle.ts';

const NON_ASCII = new RegExp('[^\\u0000-\\u007f]', 'g');

const result = await build({
	entryPoints: ['lwdpm-entry.js'],
	bundle: true,
	format: 'iife',
	minify: true,
	charset: 'ascii',
	write: false,
	legalComments: 'none',
	target: ['es2020']
});

let code = result.outputFiles[0].text;

// esbuild's --charset=ascii escapes string literals but NOT bytes inside regex
// literals; escape any residual non-ASCII to keep the vendored .ts ASCII-only
// (repo hygiene gate). \uXXXX inside a regex literal is a valid equivalent.
let nonAsciiBefore = 0;
code = code.replace(NON_ASCII, ch => {
	nonAsciiBefore++;
	return '\\u' + ch.charCodeAt(0).toString(16).padStart(4, '0');
});

const stillNonAscii = NON_ASCII.test(code);
NON_ASCII.lastIndex = 0;
writeFileSync('bundle.iife.js', code, 'utf8');

console.log('bundle bytes:', code.length);
console.log('non-ascii escaped:', nonAsciiBefore);
console.log('ascii-clean:', !stillNonAscii);

// --- Smoke test the round-trip headlessly (parser/serializer need no DOM) ------
const sandbox = { window: {} };
// prosemirror-view guards document/navigator with typeof checks, so a bare run is safe.
new Function('window', code).call(sandbox, sandbox.window);
const LWDPM = sandbox.window.LWDPM;
const samples = [
	'Revenue reached [49,800](bind:metrics.mrr.latest) this quarter.',
	'# Heading\n\nA paragraph with **bold** and *italic*.\n\n* one\n* two\n',
	'Growth of [12%](bind:metrics.growth) with a [normal link](https://example.com).',
	// A GFM table with bound figures in cells must round-trip byte-for-byte (canonical form).
	'| Metric | Previous | Current |\n| --- | --- | --- |\n| MRR | [$41.2k](bind:metrics.mrr.prev) | [$48.6k](bind:metrics.mrr) |',
	// Wikilinks (decision 179): the on-disk form is the product contract - `[[Doc Name]]` must survive a
	// round-trip byte-for-byte, and must NOT be claimed inside a fence or an inline code span.
	'See [[Team Notes]] and [[Q3 Plan|the plan]] for detail.',
	'```\nnot a link: [[Team Notes]]\n```',
	'Inline `[[Team Notes]]` stays code.',
	'A slot {{customer}} beside [[Team Notes]] and [49,800](bind:metrics.mrr).',
	// An inline ATOM inside a heading. Upstream's heading content expression rejects it, which dropped the
	// heading AND collapsed the whole document to an empty paragraph - true on main for bind: too.
	'## Heading with [[Team Notes]] and [49,800](bind:metrics.mrr)\n\nBody text.',
	'* A list item with [[Team Notes]].\n* Second item.'
];
let allOk = true;
for (const md of samples) {
	const rt = LWDPM.roundTrip(md);
	const ok = rt.trim() === md.trim();
	if (!ok) {
		allOk = false;
		console.log('ROUNDTRIP MISMATCH\n--- in  ---\n' + md + '\n--- out ---\n' + rt);
	}
}
const json = LWDPM.docJSON(samples[0]);
const hasFigure = JSON.stringify(json).includes('"bound_figure"');
const hasTable = JSON.stringify(LWDPM.docJSON(samples[3])).includes('"table_block"');
const hasWikilink = JSON.stringify(LWDPM.docJSON(samples[4])).includes('"wikilink"');
// The inverse is just as load-bearing: a fenced `[[...]]` must stay text, or code samples silently become links.
const fenceStaysText = !JSON.stringify(LWDPM.docJSON(samples[5])).includes('"wikilink"');
console.log('roundtrip-ok:', allOk);
console.log('parses-bound_figure-node:', hasFigure);
console.log('parses-table_block-node:', hasTable);
console.log('parses-wikilink-node:', hasWikilink);
console.log('fenced-wikilink-stays-text:', fenceStaysText);

if (process.argv.includes('--emit')) {
	if (stillNonAscii) {
		throw new Error('refusing to emit: bundle still has non-ASCII bytes');
	}
	if (!allOk || !hasFigure || !hasTable || !hasWikilink || !fenceStaysText) {
		throw new Error('refusing to emit: round-trip/figure/table/wikilink smoke test failed');
	}
	const b64 = Buffer.from(code, 'utf8').toString('base64');
	const header = readFileSync(TARGET, 'utf8').split('export const PROSEMIRROR_BUNDLE_BASE64')[0];
	writeFileSync(TARGET, header + "export const PROSEMIRROR_BUNDLE_BASE64 = '" + b64 + "';\n", 'utf8');
	console.log('emitted ->', TARGET, '(', b64.length, 'b64 chars )');
}
