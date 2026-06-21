/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { ILivingDocRenderInput, IPresentState, PresentChoice, renderLivingDocHtml } from '../../browser/livingDocRender.js';
import { ILivingDoc } from '../../common/livingDocsModel.js';

suite('livingDocs Present modal (renderLivingDocHtml)', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	const doc: ILivingDoc = {
		title: 'Weekly Operating Summary', subtitle: 'Week 24',
		sources: ['metrics.csv'], context: [], blocks: [], isLiving: true, body: '',
	};

	function html(present: IPresentState): string {
		const input: ILivingDocRenderInput = {
			doc, pending: [], resolved: new Map(), dirty: false, status: '',
			recent: new Set(), mode: 'rendered', rawText: '', present,
		};
		return renderLivingDocHtml(input);
	}

	test('WHO CAN ACCESS is offered for every export choice, not just the hosted web page', () => {
		const choices: PresentChoice[] = ['gdoc', 'gsheet', 'docx', 'xlsx', 'site'];
		for (const choice of choices) {
			const h = html({ open: true, choice, scope: 'internal' });
			assert.ok(h.includes('WHO CAN ACCESS'), `scope selector shown for ${choice}`);
			assert.ok(h.includes('Workspace only') && h.includes('Anyone with link') && h.includes('Public'), `all three scopes for ${choice}`);
		}
	});

	test('the shareable URL row appears for link/public scopes and is hidden when workspace-only', () => {
		assert.ok(!html({ open: true, choice: 'gdoc', scope: 'internal' }).includes('opportunity-os.live'), 'no public URL when workspace-only');
		assert.ok(html({ open: true, choice: 'gdoc', scope: 'link' }).includes('opportunity-os.live'), 'URL shown for anyone-with-link');
		assert.ok(html({ open: true, choice: 'gdoc', scope: 'public' }).includes('opportunity-os.live'), 'URL shown for public');
	});
});
