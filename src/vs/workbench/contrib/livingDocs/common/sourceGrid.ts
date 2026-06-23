/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// The raw source grid behind the in-surface source-peek pane. The comp shows the source's actual CSV
// rows (week / date / mrr / signups / churn / active ...) with the latest row highlighted - not just the
// bound key->value pairs. This pure builder parses the CSV text into that grid so the pane can render it
// (and the parsing is unit-tested without a DOM). The latest row is the last data row (CSV is append-only
// by week), which is the row the document's figures bind to.

export interface ISourceGrid {
	readonly headers: readonly string[];
	readonly rows: readonly (readonly string[])[];
	// Index into `rows` of the latest (most recent) row - the one the document binds to. -1 if no rows.
	readonly latestIndex: number;
}

export function buildSourceGrid(text: string): ISourceGrid | undefined {
	const lines = text.split(/\r?\n/).filter(l => l.trim().length > 0);
	if (lines.length < 2) {
		return undefined;
	}
	const headers = lines[0].split(',').map(c => c.trim());
	const rows = lines.slice(1).map(l => l.split(',').map(c => c.trim()));
	return { headers, rows, latestIndex: rows.length - 1 };
}
