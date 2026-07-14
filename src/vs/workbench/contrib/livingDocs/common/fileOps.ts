/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ILivingDocLock } from './livingDocsModel.js';

// Pure logic for the provenance-safe file operations (docs 20 section 1d / map-D6): sidecar-path
// derivation, the dependent scan behind delete's warn-and-list, and the lock source-path rewrite that
// keeps a renamed source's dependents bound. String/data in, string/data out - no DOM, no fs, no URI:
// the browser view + service wire these to IFileService, and they are unit-tested in isolation.

// Derive the lock sidecar's file NAME from a document's file name. A `.md` document's lock is
// `<stem>.lock.json`; a non-`.md` file (a data source like `metrics.csv`) has no `.md` suffix to strip,
// so its notional sidecar keeps the full name (`metrics.csv.lock.json`) - which does not exist on disk,
// so the paired move simply finds no sidecar to carry. Single source of truth for `lockUriFor`.
export function sidecarNameFor(fileName: string): string {
	return fileName.replace(/\.md$/, '') + '.lock.json';
}

// A document reference for the dependent scan: its identity, display title, and declared references.
export interface IFileRef {
	readonly id: string;
	readonly title: string;
	readonly sources: readonly string[];
	readonly context: readonly string[];
}

// One document that depends on a file being renamed/deleted, with how it references it.
export interface IFileDependent {
	readonly id: string;
	readonly title: string;
	/** References the file in frontmatter `sources:` (a value binding). */
	readonly viaSources: boolean;
	/** References the file in frontmatter `context:` (an influence edge). */
	readonly viaContext: boolean;
}

// The documents (other than the file's own document) that reference `targetName` in their frontmatter
// `sources:`/`context:`. Powers map-D6's warn-and-list on delete and the rename dependent rewrite.
// Sorted by title for a stable warning list; `selfId` (the file's own document, when it is one) is
// never counted as its own dependent.
export function scanDependents(docs: readonly IFileRef[], targetName: string, selfId?: string): IFileDependent[] {
	const out: IFileDependent[] = [];
	for (const d of docs) {
		if (selfId && d.id === selfId) { continue; }
		const viaSources = d.sources.includes(targetName);
		const viaContext = d.context.includes(targetName);
		if (viaSources || viaContext) { out.push({ id: d.id, title: d.title, viaSources, viaContext }); }
	}
	out.sort((a, b) => a.title.localeCompare(b.title));
	return out;
}

// Rewrite every provenance reference to `oldName` inside a lock so it points at `newName` (a source file
// was renamed). Binding `source` fields are `"<file>#<field>"` (or a bare `"<file>"`); the file PREFIX is
// rewritten and the `#field` qualifier preserved. Context entries are keyed by file name, so the `oldName`
// key is re-homed under `newName`. Returns a NEW lock (the input is not mutated) plus whether anything
// changed - so the caller only rewrites the sidecar on disk when there was a real reference to update.
export function rewriteLockSources(lock: ILivingDocLock, oldName: string, newName: string): { lock: ILivingDocLock; changed: boolean } {
	let changed = false;
	const bindings: ILivingDocLock['bindings'] = {};
	for (const key of Object.keys(lock.bindings)) {
		const entry = lock.bindings[key];
		if (entry.source === oldName || entry.source.startsWith(oldName + '#')) {
			bindings[key] = { ...entry, source: newName + entry.source.slice(oldName.length) };
			changed = true;
		} else {
			bindings[key] = entry;
		}
	}
	const context: ILivingDocLock['context'] = {};
	for (const file of Object.keys(lock.context)) {
		if (file === oldName) { context[newName] = lock.context[file]; changed = true; }
		else { context[file] = lock.context[file]; }
	}
	return { lock: { ...lock, bindings, context }, changed };
}
