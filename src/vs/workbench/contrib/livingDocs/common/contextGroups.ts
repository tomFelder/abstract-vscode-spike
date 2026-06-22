/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IAddedContext, IFreshness, ILivingDoc, SourceKind } from './livingDocsModel.js';

// The Context panel (spec 3.5) groups everything the agent can see when working on a document, by
// kind - mirroring the design's "Linked sources / Referenced files" sections. This pure builder maps
// the parsed document + its always-on freshness bits into those groups so the view stays a thin
// renderer (and the grouping is unit-tested without a DOM).

// A reference is an influence (context) file the agent reads but binds no figures from; the value
// sources keep their resolved SourceKind (file | api | mcp). `image`, `pasted` and `knowledge` are the
// comp's extra context kinds (Images / Pasted text / Company knowledge).
export type ContextItemKind = SourceKind | 'reference' | 'image' | 'pasted' | 'knowledge';

const IMAGE_RE = /\.(png|jpe?g|gif|svg|webp)$/i;

export interface IContextItem {
	readonly name: string;
	readonly kind: ContextItemKind;
	// Sub-label under the name, e.g. "live - feeds 2 blocks" or "current".
	readonly detail: string;
	// Freshness: a value source whose hash drifted since sync, or a context file changed since review.
	readonly changed: boolean;
}

export interface IContextGroup {
	readonly label: string;
	readonly items: readonly IContextItem[];
}

export function sourceKindOf(source: string): SourceKind {
	return /^https?:\/\//.test(source) ? 'api' : 'file';
}

// The binding namespace a bind key belongs to == its first dotted segment ("metrics.mrr" -> "metrics").
function keyNamespace(key: string): string {
	const dot = key.indexOf('.');
	return dot === -1 ? key : key.slice(0, dot);
}

// The binding namespace a source owns == its filename stem ("metrics.csv" -> "metrics").
function sourceNamespace(source: string): string {
	const base = source.slice(source.lastIndexOf('/') + 1);
	const dot = base.indexOf('.');
	return dot === -1 ? base : base.slice(0, dot);
}

// U+00B7 MIDDLE DOT - the separator the design uses between a source name's sub-label parts. Kept as
// an escape so the source stays ASCII-only (the hygiene rule); textContent renders it directly.
const DOT = ' · ';

export function buildContextGroups(doc: ILivingDoc, freshness: IFreshness, added: readonly IAddedContext[] = []): IContextGroup[] {
	const groups: IContextGroup[] = [];
	const staleBind = new Set(freshness.staleBindings);
	const staleCtx = new Set(freshness.staleContext);

	// Linked sources: the value-binding sources that feed this document's figures.
	if (doc.sources.length) {
		const items = doc.sources.map<IContextItem>(source => {
			const kind = sourceKindOf(source);
			const ns = sourceNamespace(source);
			const feeds = doc.blocks.filter(b => b.binds.some(bind => keyNamespace(bind.key) === ns)).length;
			const changed = doc.blocks.some(b => b.binds.some(bind => keyNamespace(bind.key) === ns && staleBind.has(bind.key)));
			let detail: string;
			if (kind === 'api') {
				detail = changed ? `live${DOT}changed since sync` : `live${DOT}polled`;
			} else if (feeds > 0) {
				detail = `${changed ? 'changed' : 'live'}${DOT}feeds ${feeds} block${feeds === 1 ? '' : 's'}`;
			} else {
				detail = changed ? 'changed since sync' : 'live';
			}
			return { name: source, kind, detail, changed };
		});
		groups.push({ label: 'Linked sources', items });
	}

	// Referenced files: influence sources the agent reads but binds no figures from. Image files split
	// out into their own group (the comp's Images section).
	const referenced = doc.context.filter(f => !IMAGE_RE.test(f));
	const imageFiles = doc.context.filter(f => IMAGE_RE.test(f));
	if (referenced.length) {
		const items = referenced.map<IContextItem>(file => {
			const changed = staleCtx.has(file);
			return { name: file, kind: 'reference', detail: changed ? 'changed since review' : 'current', changed };
		});
		groups.push({ label: 'Referenced files', items });
	}

	// Images: image-kind context files plus any image the user added by hand.
	const addedImages = added.filter(a => a.kind === 'image');
	if (imageFiles.length || addedImages.length) {
		const items: IContextItem[] = [
			...imageFiles.map<IContextItem>(file => ({ name: file, kind: 'image', detail: staleCtx.has(file) ? 'changed since review' : 'current', changed: staleCtx.has(file) })),
			...addedImages.map<IContextItem>(a => ({ name: a.label, kind: 'image', detail: a.detail ?? 'added', changed: false })),
		];
		groups.push({ label: 'Images', items });
	}

	// Pasted text + Company knowledge: user-added context, each its own group (the comp's sections).
	const addedGroup = (kind: IAddedContext['kind'], label: string): void => {
		const items = added.filter(a => a.kind === kind).map<IContextItem>(a => ({ name: a.label, kind, detail: a.detail ?? 'added', changed: false }));
		if (items.length) { groups.push({ label, items }); }
	};
	addedGroup('pasted', 'Pasted text');
	addedGroup('knowledge', 'Company knowledge');

	return groups;
}
