/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IChangeStoreFileSystem } from '../../common/changeJournal.js';
import { hashContent, IChangeAnchor } from '../../common/changeRecord.js';
import { IChangeStoreDocuments } from '../../common/changeStore.js';

// Fakes for the change store's two injected seams (docs/30 section 6, store tier). They exist so the
// adversarial suite can stage the failures that matter and cannot be staged against a real disk: an append
// that never reaches the platter, a machine that dies between two document writes, a journal whose last
// record is half-written. Both implement the production interfaces rather than being stubbed in with casts,
// per the repo's injectable-dependency rule.

/**
 * An in-memory file system whose appends can be made to fail on demand.
 *
 * `failAppendWhen` is matched against the framed record text, so a test says which JOURNAL STEP fails
 * ("the J1 intent", "any doc commit") rather than counting writes - which is both readable and immune to
 * an implementation that adds a record somewhere else.
 */
export class FakeChangeFileSystem implements IChangeStoreFileSystem {

	readonly files = new Map<string, string>();

	/** Return true to make this append fail, as a full disk or a read-only volume would. */
	failAppendWhen: ((path: string, text: string) => boolean) | undefined;

	/** Return true to make this whole-file replace fail. */
	failReplaceWhen: ((path: string) => boolean) | undefined;

	async read(path: string): Promise<string | undefined> {
		return this.files.get(path);
	}

	async append(path: string, text: string): Promise<void> {
		if (this.failAppendWhen?.(path, text)) {
			throw new Error('ENOSPC: no space left on device');
		}
		this.files.set(path, (this.files.get(path) ?? '') + text);
	}

	async replace(path: string, text: string): Promise<void> {
		if (this.failReplaceWhen?.(path)) {
			throw new Error('EACCES: permission denied');
		}
		this.files.set(path, text);
	}

	async list(dir: string): Promise<readonly string[]> {
		const prefix = `${dir}/`;
		return [...this.files.keys()].filter(p => p.startsWith(prefix)).map(p => p.slice(prefix.length));
	}
}

/** An in-memory document set that records every write and can fail chosen ones. */
export class FakeChangeDocuments implements IChangeStoreDocuments {

	readonly docs = new Map<string, string>();

	/** Every document written, in order. The evidence that a fail-closed path wrote NOTHING. */
	readonly writes: string[] = [];

	/** Every document snapshotted, in order. A snapshot always precedes the intent that writes it. */
	readonly snapshots: string[] = [];

	/** Return true to make this document's write fail. */
	failWriteWhen: ((docUri: string) => boolean) | undefined;

	/**
	 * Transform the text on its way to storage, the way a serialiser that re-emits a parsed document does.
	 * This is the class of failure invariant I6 exists for: the write "succeeds", and what is on disk is not
	 * what was asked for. The store must catch it by reading back, never by trusting the request.
	 */
	normaliseOnWrite: ((text: string) => string) | undefined;

	async read(docUri: string): Promise<string | undefined> {
		return this.docs.get(docUri);
	}

	async snapshot(docUri: string): Promise<string> {
		this.snapshots.push(docUri);
		return `snapshot-${this.snapshots.length}`;
	}

	async write(docUri: string, text: string): Promise<void> {
		if (this.failWriteWhen?.(docUri)) {
			throw new Error('write failed');
		}
		this.writes.push(docUri);
		this.docs.set(docUri, this.normaliseOnWrite ? this.normaliseOnWrite(text) : text);
	}
}

/**
 * Build an anchor against a document's CURRENT text by locating `oldText` in it. Tests therefore never hand
 * the store offsets by hand, which is the same discipline the production differ keeps: geometry is measured
 * from the document, never asserted about it.
 */
export function anchorAt(docs: FakeChangeDocuments, docUri: string, oldText: string, newText: string): IChangeAnchor {
	const text = docs.docs.get(docUri) ?? '';
	const start = text.indexOf(oldText);
	if (start < 0) {
		throw new Error(`anchorAt: "${oldText}" is not in ${docUri}`);
	}
	return { docUri, baseRevision: hashContent(text), span: { start, end: start + oldText.length }, oldText, newText };
}

/** A monotonic clock so records order deterministically and a test can read the timestamps it expects. */
export function fakeClock(): () => number {
	let tick = 0;
	return () => ++tick;
}

/** Sequential ids, so a failure message names `change-3` rather than a uuid nobody can trace. */
export function fakeIds(): () => string {
	let next = 0;
	return () => `id-${++next}`;
}
