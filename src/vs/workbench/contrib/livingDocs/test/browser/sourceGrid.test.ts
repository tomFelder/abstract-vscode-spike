/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { buildSourceGrid } from '../../common/sourceGrid.js';

suite('sourceGrid', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('parses headers + rows and flags the latest (last) row', () => {
		const csv = 'week,date,mrr,signups,churn,active\n22,Jun 1,41.2,312,3.1,188\n23,Jun 8,44.9,389,2.7,201\n24,Jun 15,48.6,427,2.4,205\n';
		assert.deepStrictEqual(buildSourceGrid(csv), {
			headers: ['week', 'date', 'mrr', 'signups', 'churn', 'active'],
			rows: [
				['22', 'Jun 1', '41.2', '312', '3.1', '188'],
				['23', 'Jun 8', '44.9', '389', '2.7', '201'],
				['24', 'Jun 15', '48.6', '427', '2.4', '205'],
			],
			latestIndex: 2,
		});
	});

	test('returns undefined when there is no data row (header only or empty)', () => {
		assert.strictEqual(buildSourceGrid('week,mrr'), undefined);
		assert.strictEqual(buildSourceGrid(''), undefined);
		assert.strictEqual(buildSourceGrid('\n\n'), undefined);
	});
});
