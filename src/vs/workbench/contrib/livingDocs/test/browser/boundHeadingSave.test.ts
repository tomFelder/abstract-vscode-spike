/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { decodeBase64 } from '../../../../../base/common/buffer.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { PROSEMIRROR_BUNDLE_BASE64 } from '../../browser/prosemirrorBundle.js';
import { ChangeStore, IChangeStoreDocuments } from '../../common/changeStore.js';
import { extractBindLinks, withReplacedBody } from '../../common/livingDocMarkdown.js';
import { anchorAt, FakeChangeDocuments, FakeChangeFileSystem, fakeClock, fakeIds } from './changeStoreFakes.js';

// A bound figure in a heading survives a save (#319, ticket #384).
//
// The defect this suite guards was silent on-disk data loss. Upstream ProseMirror ships `heading` as
// `(text | image)*`, so ANY inline atom in a heading made `createAndFill` return null and ProseMirror
// resolved that by dropping the heading with all of its inline content. The 300ms autosave then wrote the
// result to disk, which is why one keystroke in an UNRELATED paragraph was enough to lose a line the user
// had never touched. The vendored bundle now widens the expression to admit the product's inline atoms.
//
// What was missing was the assertion the user actually cares about: not "the parser round-trips", but
// "the bytes on disk still hold my heading after a save". That is what this suite makes a post-condition,
// over BOTH write paths a document has:
//
//   - the autosave path, where the live surface serialises itself back to Markdown and the host persists it;
//   - the change store's approve path, where an accepted change is spliced into the body.
//
// The on-disk assertion runs against the store's injected document interface (seam S3,
// {@link IChangeStoreDocuments}), so it needs no real file system. That seam speaks BODY text, never whole
// files - the frontmatter quarantine (docs/30 section 8.3) - so the document seeded here is a plain body and
// every assertion below is about body bytes.
//
// TO WATCH THIS SUITE FAIL THE WAY THE USER EXPERIENCED IT (the failing-first check, for anyone who needs to
// confirm this guard still bites): narrow the vendored bundle's heading content expression back to what
// upstream ships, re-transpile, and run this suite. The first two tests then report the heading missing from
// disk entirely, which is the reported repro.
//
//   node -e "const fs=require('fs'),p='src/vs/workbench/contrib/livingDocs/browser/prosemirrorBundle.ts', \
//     s=fs.readFileSync(p,'utf8'),m=s.match(/'([A-Za-z0-9+/=]{1000,})'/), \
//     j=Buffer.from(m[1],'base64').toString('utf8'); \
//     fs.writeFileSync(p,s.replace(m[1],Buffer.from(j.replace('(text | image | bound_figure | wikilink)*', \
//     '(text | image)*'),'utf8').toString('base64')))"
//
// Restore with `git checkout -- src/vs/workbench/contrib/livingDocs/browser/prosemirrorBundle.ts`.

// The slice of the vendored bundle this suite drives. The bundle is a base64 artifact rather than an
// importable module, so the shapes it hands back are restated here (as `prosemirrorBundle.test.ts` does).
interface ILwdpmView {
	state: { doc: { content: { size: number } }; tr: unknown };
	dispatch(tr: unknown): void;
}

interface ILwdpmSurface {
	mount(parent: HTMLElement, markdown: string, options?: { onChange?: () => void; editable?: boolean }): ILwdpmView;
	toMarkdown(view: ILwdpmView): string;
	destroy(view: ILwdpmView): void;
}

// Decode + evaluate the vendored IIFE once, handing it a plain object as `window` so it never touches the
// real global. Driving the SHIPPED artifact is the whole point: a re-implementation of the schema would
// guard nothing, because the schema is exactly what was wrong.
function loadLwdpm(): ILwdpmSurface {
	const code = decodeBase64(PROSEMIRROR_BUNDLE_BASE64).toString();
	const sandbox: { LWDPM?: ILwdpmSurface } = {};
	new Function('window', code)(sandbox);
	if (!sandbox.LWDPM) {
		throw new Error('vendored ProseMirror bundle did not define window.LWDPM');
	}
	return sandbox.LWDPM;
}

const HOME = 'file:///ws/.abstract';
const DOC = 'file:///ws/weekly.md';

/** The heading the defect deleted: a bound figure sitting inside heading text. */
const BOUND_HEADING = '## Revenue [18%](bind:metrics.mrr.delta)';

/** The document as it sits on disk before anyone touches it. */
const BODY = [
	'# Weekly Review',
	'',
	'Revenue is fine.',
	'',
	BOUND_HEADING,
	'',
	'Some prose here.',
].join('\n') + '\n';

suite('a bound figure in a heading survives a save (#319)', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	const lwdpm = loadLwdpm();

	function seed(): { readonly docs: FakeChangeDocuments; readonly store: ChangeStore } {
		const fs = new FakeChangeFileSystem();
		const docs = new FakeChangeDocuments();
		docs.docs.set(DOC, BODY);
		return { docs, store: new ChangeStore(fs, docs, HOME, fakeClock(), fakeIds()) };
	}

	/**
	 * One autosave, run the way the shipped path runs it.
	 *
	 * The host hands the live surface the document body, the surface holds it as a ProseMirror document, the
	 * user types, and 300ms later the surface serialises ITSELF back to Markdown (`toMarkdown`) and the host
	 * persists that through `withReplacedBody` (`livingDocEditor.ts`'s `pmEdit` case). Nothing here re-derives
	 * the body from the parsed model: the bytes written are the bytes the editor produced, which is precisely
	 * why a heading the schema refused to build was a heading deleted from the file.
	 *
	 * `typedAt` is a document position; the caller picks one inside a paragraph that is NOT the heading, so
	 * what is under test is a save the user never aimed anywhere near the line they lost.
	 */
	async function autosave(documents: IChangeStoreDocuments, typed: string, typedAt: (size: number) => number): Promise<void> {
		const onDisk = (await documents.read(DOC)) ?? '';
		const parent = document.createElement('div');
		const view = lwdpm.mount(parent, onDisk, {});
		try {
			const tr = view.state.tr as { insertText(text: string, from: number): unknown };
			view.dispatch(tr.insertText(typed, typedAt(view.state.doc.content.size)));
			await documents.write(DOC, withReplacedBody(onDisk, lwdpm.toMarkdown(view)));
		} finally {
			lwdpm.destroy(view);
		}
	}

	/** A position inside the LAST paragraph ("Some prose here."), two blocks below the bound heading. */
	const inTheLastParagraph = (size: number) => size - 1;

	test('typing in an unrelated paragraph autosaves without deleting the bound heading', async () => {
		const { docs } = seed();

		await autosave(docs, ' Updated.', inTheLastParagraph);

		const onDisk = docs.docs.get(DOC)!;
		// Byte-exact: the ONLY difference from the seeded body is the text the user typed. Asserting the whole
		// document rather than `includes(BOUND_HEADING)` is what makes this a statement about the file - a
		// heading that survived with its bind markup stripped, or with its level or spacing rewritten, is
		// still the user's line altered behind their back.
		assert.strictEqual(onDisk, BODY.replace('Some prose here.', 'Some prose here. Updated.'));
		assert.ok(onDisk.includes(`${BOUND_HEADING}\n`), 'the bound heading must still be on disk, byte for byte');
		// The binding itself survived, not just the words around it: a "fix" that kept the heading by stripping
		// its `bind:` link would pass the line above and still lose what makes the figure live.
		assert.deepStrictEqual(extractBindLinks(onDisk), [{ value: '18%', key: 'metrics.mrr.delta' }]);
	});

	test('a run of autosaves never erodes the bound heading', async () => {
		const { docs } = seed();

		// The reported repro was a SINGLE keystroke, but the failure mode was a document rebuilt from a schema
		// that could not hold the heading - so it would have been lost again on every subsequent save. Ten
		// saves in a row prove the heading is stable under the save loop, not merely present after the first.
		for (let i = 0; i < 10; i++) {
			await autosave(docs, 'x', inTheLastParagraph);
		}

		const onDisk = docs.docs.get(DOC)!;
		assert.strictEqual(onDisk, BODY.replace('Some prose here.', `Some prose here.${'x'.repeat(10)}`));
		assert.deepStrictEqual(extractBindLinks(onDisk), [{ value: '18%', key: 'metrics.mrr.delta' }]);
	});

	test('approving a change in an unrelated paragraph leaves the bound heading byte-exact', async () => {
		// The store's own write path, held to invariant I6: untouched content is PROVEN untouched. A change is
		// approved two blocks away, and the heading has to come through the splice unaltered.
		const { docs, store } = seed();
		await store.open();

		const anchor = anchorAt(docs, DOC, 'Some prose here.', 'Some prose here, revised.');
		const receipts = await store.propose({
			setId: 'set-1',
			changes: [{ anchors: [anchor], kind: 'meaning', baseLength: BODY.length }],
		});
		const report = await store.approveByIds([receipts.receipts[0].changeId]);

		const onDisk = docs.docs.get(DOC)!;
		assert.deepStrictEqual({
			status: report.resolved.map(r => r.status),
			onDisk,
			binds: extractBindLinks(onDisk),
		}, {
			status: ['approved'],
			onDisk: BODY.replace('Some prose here.', 'Some prose here, revised.'),
			binds: [{ value: '18%', key: 'metrics.mrr.delta' }],
		});
	});
});
