/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Living Documents — research spike data model.
// A document is a flat list of blocks; "bound" blocks declare which source cells feed them.

export interface ILivingDocBinding {
	readonly source: string;        // sibling source file, e.g. "metrics.csv"
	readonly cells: readonly string[]; // column names the block depends on
}

export type LivingDocBlockType = 'heading' | 'paragraph' | 'kpiTable';

export interface ILivingDocBlock {
	readonly id: string;
	readonly type: LivingDocBlockType;
	text?: string;                  // mutated in-place when a change is applied
	readonly binding?: ILivingDocBinding;
	readonly kind?: 'figure' | 'narrative';
}

export interface ILivingDoc {
	title: string;
	subtitle: string;
	source: string;
	syncedWeek: number;
	readonly blocks: ILivingDocBlock[];
	// True when the file declares itself a Living Document (frontmatter livingDoc: true) or
	// carries data bindings. Plain Markdown (READMEs, notes) renders generically instead.
	readonly isLiving: boolean;
	// Markdown body after the frontmatter, used to render plain documents and as the
	// source-of-truth fallback for the raw editing view.
	readonly body: string;
}

// figure  -> low risk, auto-applies
// meaning -> changes the meaning, waits for one-click approval
export type ChangeKind = 'figure' | 'meaning';

export interface IProposedChange {
	readonly id: string;
	readonly blockId: string;
	readonly oldText: string;
	readonly newText: string;
	readonly kind: ChangeKind;
	readonly confidence: number;    // 0..1
	readonly rationale: string;
	readonly sourceCells: readonly string[];
}

export interface IAuditEntry {
	readonly time: string;
	readonly blockId: string;
	readonly action: 'auto-applied' | 'approved' | 'rejected';
	readonly oldText: string;
	readonly newText: string;
	readonly via: 'model' | 'heuristic';
}

export interface IKpiRow {
	readonly metric: string;
	readonly prev: string;
	readonly curr: string;
	readonly delta: string;
	readonly positive: boolean;
}
