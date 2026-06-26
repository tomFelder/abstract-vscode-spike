# Rebuilding the vendored ProseMirror bundle (`prosemirrorBundle.ts`)

The Living Document editor surface is a real ProseMirror `EditorView` (decision 43, plan 14). To avoid
touching the fork's root build pipeline and the repo hygiene gates (no new `.js` files, ASCII-only
sources), the editor is shipped as a **prebuilt, minified, ASCII IIFE, base64-encoded into a `.ts`** at
`src/vs/workbench/contrib/livingDocs/browser/prosemirrorBundle.ts`. `livingDocRender.ts` decodes it once
and inlines it; it defines `window.LWDPM`.

The bundle is built **offline** (outside the repo, so its `.js`/`.mjs` sources never hit the
no-new-JavaScript gate). The build directory used during plan 15 is `/Users/tommy/Sites/.lwd-pm-build`.
The exact sources are reproduced below so the bundle can always be rebuilt from scratch.

## What the bundle exposes

`window.LWDPM = { mount, toMarkdown, cmd, destroy, roundTrip, docJSON }`

- `mount(parentEl, markdown, { onChange, editable })` → mounts an `EditorView`, returns it.
- `toMarkdown(view)` → serializes the live doc back to Markdown.
- `cmd(view, name)` → runs a formatting command (`bold`/`italic`/`bullet_list`/`ordered_list`/
  `blockquote`/`h1`/`h2`/`h3`/`paragraph`) for the toolbar.
- `destroy(view)` → tears the view down.
- `roundTrip(md)` / `docJSON(md)` → **headless** (no DOM) helpers so the Markdown parse/serialize and
  the `bound_figure` node can be unit-tested against the real artifact
  (`test/browser/prosemirrorBundle.test.ts`).

### The keystone — bound figures (decision 46)

A bound figure `[label](bind:key)` parses to a first-class **`bound_figure` atom inline node**:
non-editable (`atom: true` + `contenteditable=false`), renders the resolved value (the `label`, which the
clean-file format bakes in), and **serializes back to `[label](bind:key)`** so it round-trips on disk. A
markdown-it core rule folds the `bind:` link's `link_open / text / link_close` run into a single
`bound_figure` token; a serializer node writes it back. Normal links stay normal links.

## Rebuild

```bash
cd /Users/tommy/Sites/.lwd-pm-build   # offline, outside the repo
npm install --no-audit --no-fund \
  prosemirror-model@1 prosemirror-state@1 prosemirror-view@1 prosemirror-markdown@1 \
  prosemirror-schema-list@1 prosemirror-keymap@1 prosemirror-commands@1 prosemirror-history@1 \
  markdown-it@14 esbuild

node build.mjs            # build + smoke-test the round-trip (writes bundle.iife.js)
node build.mjs --emit     # also rewrite the repo's prosemirrorBundle.ts with fresh base64
```

`build.mjs` runs esbuild (`--format=iife --minify --charset=ascii`), then escapes any residual non-ASCII
bytes inside regex literals (esbuild's `--charset=ascii` only escapes string literals), smoke-tests the
round-trip headlessly, and refuses to `--emit` unless the bundle is ASCII-clean and the round-trip +
`bound_figure` checks pass. After emitting, re-run the repo hygiene/typecheck and
`./scripts/test.sh --grep "ProseMirror vendored bundle"`.

## `lwdpm-entry.js` (the bundle source)

```js
// LWDPM — the vendored ProseMirror surface for the Living Document webview.
import { Schema } from 'prosemirror-model';
import { EditorState } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import {
	schema as mdSchema, defaultMarkdownParser, defaultMarkdownSerializer,
	MarkdownParser, MarkdownSerializer
} from 'prosemirror-markdown';
import { keymap } from 'prosemirror-keymap';
import { history, undo, redo } from 'prosemirror-history';
import { baseKeymap, toggleMark, setBlockType, wrapIn } from 'prosemirror-commands';
import { wrapInList, splitListItem, liftListItem, sinkListItem } from 'prosemirror-schema-list';
import markdownit from 'markdown-it';

// Schema: commonmark + a bound_figure atom inline node.
const nodes = mdSchema.spec.nodes.addToEnd('bound_figure', {
	inline: true, group: 'inline', atom: true, selectable: true, draggable: false,
	attrs: { label: { default: '' }, key: { default: '' } },
	toDOM(node) {
		return ['span', { 'class': 'bound', 'data-key': node.attrs.key,
			'data-label': node.attrs.label, 'contenteditable': 'false' }, node.attrs.label];
	},
	parseDOM: [{ tag: 'span.bound', getAttrs(dom) {
		return { key: dom.getAttribute('data-key') || '',
			label: dom.getAttribute('data-label') || dom.textContent || '' };
	} }]
});
const schema = new Schema({ nodes, marks: mdSchema.spec.marks });

// Parser: fold `[label](bind:key)` links into a single bound_figure token.
const md = markdownit('commonmark', { html: false });
md.core.ruler.push('bound_figure', state => {
	for (const blockToken of state.tokens) {
		if (blockToken.type !== 'inline' || !blockToken.children) { continue; }
		const children = blockToken.children;
		const out = [];
		for (let i = 0; i < children.length; i++) {
			const t = children[i];
			if (t.type === 'link_open') {
				const href = t.attrGet('href') || '';
				if (href.indexOf('bind:') === 0) {
					let j = i + 1, label = '';
					while (j < children.length && children[j].type !== 'link_close') {
						label += children[j].content || ''; j++;
					}
					const tok = new state.Token('bound_figure', '', 0);
					tok.attrSet('key', href.slice('bind:'.length));
					tok.attrSet('label', label);
					tok.content = label;
					out.push(tok); i = j; continue;
				}
			}
			out.push(t);
		}
		blockToken.children = out;
	}
});
const parser = new MarkdownParser(schema, md, Object.assign({}, defaultMarkdownParser.tokens, {
	bound_figure: { node: 'bound_figure',
		getAttrs: tok => ({ key: tok.attrGet('key') || '', label: tok.attrGet('label') || '' }) }
}));

// Serializer: write bound_figure back as `[label](bind:key)`.
const serializer = new MarkdownSerializer(
	Object.assign({}, defaultMarkdownSerializer.nodes, {
		bound_figure(state, node) {
			state.text('[' + node.attrs.label + '](bind:' + node.attrs.key + ')', false);
		}
	}),
	defaultMarkdownSerializer.marks
);

function buildPlugins(onChange) {
	return [
		history(),
		keymap({ 'Mod-z': undo, 'Mod-y': redo, 'Shift-Mod-z': redo }),
		keymap({ 'Enter': splitListItem(schema.nodes.list_item),
			'Tab': sinkListItem(schema.nodes.list_item),
			'Shift-Tab': liftListItem(schema.nodes.list_item) }),
		keymap(baseKeymap)
	];
}
function mount(parent, markdown, options) {
	const opts = options || {};
	const doc = parser.parse(markdown || '');
	const state = EditorState.create({ doc, plugins: buildPlugins(opts.onChange) });
	const view = new EditorView(parent, {
		state,
		editable: () => opts.editable !== false,
		dispatchTransaction(tr) {
			const next = view.state.apply(tr);
			view.updateState(next);
			if (tr.docChanged && typeof opts.onChange === 'function') { opts.onChange(); }
		}
	});
	return view;
}
function toMarkdown(view) { return serializer.serialize(view.state.doc); }
const COMMANDS = {
	bold: toggleMark(schema.marks.strong), italic: toggleMark(schema.marks.em),
	bullet_list: wrapInList(schema.nodes.bullet_list), ordered_list: wrapInList(schema.nodes.ordered_list),
	blockquote: wrapIn(schema.nodes.blockquote),
	h1: setBlockType(schema.nodes.heading, { level: 1 }), h2: setBlockType(schema.nodes.heading, { level: 2 }),
	h3: setBlockType(schema.nodes.heading, { level: 3 }), paragraph: setBlockType(schema.nodes.paragraph)
};
function cmd(view, name) {
	const command = COMMANDS[name];
	if (!command) { return false; }
	const ok = command(view.state, view.dispatch, view);
	view.focus();
	return ok;
}
function destroy(view) { if (view && typeof view.destroy === 'function') { view.destroy(); } }
function roundTrip(markdown) { return serializer.serialize(parser.parse(markdown || '')); }
function docJSON(markdown) { return parser.parse(markdown || '').toJSON(); }

window.LWDPM = { mount, toMarkdown, cmd, destroy, roundTrip, docJSON };
```

## `build.mjs` (the build + emit script)

```js
import { build } from 'esbuild';
import { readFileSync, writeFileSync } from 'node:fs';

const REPO = '/Users/tommy/Sites/abstract-vscode-spike';
const TARGET = REPO + '/src/vs/workbench/contrib/livingDocs/browser/prosemirrorBundle.ts';
const NON_ASCII = new RegExp('[^\\u0000-\\u007f]', 'g');

const result = await build({
	entryPoints: ['lwdpm-entry.js'], bundle: true, format: 'iife', minify: true,
	charset: 'ascii', write: false, legalComments: 'none', target: ['es2020']
});
let code = result.outputFiles[0].text;
let nonAsciiBefore = 0;
code = code.replace(NON_ASCII, ch => { nonAsciiBefore++; return '\\u' + ch.charCodeAt(0).toString(16).padStart(4, '0'); });
const stillNonAscii = NON_ASCII.test(code); NON_ASCII.lastIndex = 0;
writeFileSync('bundle.iife.js', code, 'utf8');
console.log('bundle bytes:', code.length, 'non-ascii escaped:', nonAsciiBefore, 'ascii-clean:', !stillNonAscii);

const sandbox = { window: {} };
new Function('window', code).call(sandbox, sandbox.window);
const LWDPM = sandbox.window.LWDPM;
const samples = [
	'Revenue reached [49,800](bind:metrics.mrr.latest) this quarter.',
	'# Heading\n\nA paragraph with **bold** and *italic*.\n\n* one\n* two\n',
	'Growth of [12%](bind:metrics.growth) with a [normal link](https://example.com).'
];
let allOk = true;
for (const sample of samples) { if (LWDPM.roundTrip(sample).trim() !== sample.trim()) { allOk = false; } }
const hasFigure = JSON.stringify(LWDPM.docJSON(samples[0])).includes('"bound_figure"');
console.log('roundtrip-ok:', allOk, 'parses-bound_figure-node:', hasFigure);

if (process.argv.includes('--emit')) {
	if (stillNonAscii || !allOk || !hasFigure) { throw new Error('refusing to emit: a check failed'); }
	const b64 = Buffer.from(code, 'utf8').toString('base64');
	const header = readFileSync(TARGET, 'utf8').split('export const PROSEMIRROR_BUNDLE_BASE64')[0];
	writeFileSync(TARGET, header + "export const PROSEMIRROR_BUNDLE_BASE64 = '" + b64 + "';\n", 'utf8');
	console.log('emitted ->', TARGET);
}
```
