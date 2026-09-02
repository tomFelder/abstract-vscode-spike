/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { timeout } from '../../../../../base/common/async.js';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { URI } from '../../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { EditorInput } from '../../../../common/editor/editorInput.js';
import { EditorService } from '../../../../services/editor/browser/editorService.js';
import { IEditorGroupsService } from '../../../../services/editor/common/editorGroupsService.js';
import { IEditorService } from '../../../../services/editor/common/editorService.js';
import { ILifecycleService } from '../../../../services/lifecycle/common/lifecycle.js';
import { createEditorPart, registerTestEditor, TestEditorPart, workbenchInstantiationService, workbenchTeardown } from '../../../../test/browser/workbenchTestServices.js';
import { TestLifecycleService } from '../../../../test/common/workbenchTestServices.js';
import { SyncDescriptor } from '../../../../../platform/instantiation/common/descriptors.js';
import { TestInstantiationService } from '../../../../../platform/instantiation/test/common/instantiationServiceMock.js';
import { EmptyEditorLandingContribution } from '../../browser/emptyEditorLanding.js';
import { LivingDocSourceInput } from '../../browser/livingDocSourceInput.js';
import { ScreenEditorInput } from '../../browser/screenEditorInput.js';
import { ensureNoNetworkInTestSuite } from '../common/networkSentinel.js';

// S4 - the workbench service-level harness (issue #299 / ticket #388). The bug: closing the last open document tab
// left the editor group with no input, and this fork's editor part has no styled empty-editor watermark, so the
// group fell through to a bare blank pane (the report's "featureless white rectangle") with no way back. The fix is
// the runtime twin of StudioStartupContribution's cold-start branch: when the editor area runs empty at runtime,
// land the writer on Project Home - a DEFINED surface - rather than a blank pane. These tests drive the assembled
// editor part + editor service (the real close path any tab-close funnels through) and assert the resulting surface.
suite('livingDocs empty-editor landing (issue #299 / #388)', () => {

	const disposables = new DisposableStore();
	const TEST_EDITOR_ID = 'livingDocsEmptyEditorLanding.testEditor';

	ensureNoNetworkInTestSuite();

	setup(() => {
		// One test pane that can host both a document-family tab (LivingDocSourceInput) and the Project Home screen
		// (ScreenEditorInput), so both open through the assembled service without the real webview panes.
		disposables.add(registerTestEditor(TEST_EDITOR_ID, [new SyncDescriptor(LivingDocSourceInput), new SyncDescriptor(ScreenEditorInput)]));
	});

	teardown(() => {
		disposables.clear();
	});

	async function createHarness(): Promise<{ instantiationService: TestInstantiationService; editorService: EditorService; part: TestEditorPart; lifecycle: TestLifecycleService; cleanup: () => Promise<void> }> {
		const instantiationService = workbenchInstantiationService(undefined, disposables);

		const part = await createEditorPart(instantiationService, disposables);
		instantiationService.stub(IEditorGroupsService, part);

		const editorService = disposables.add(instantiationService.createInstance(EditorService, undefined));
		instantiationService.stub(IEditorService, editorService);

		const lifecycle = instantiationService.get(ILifecycleService) as TestLifecycleService;

		disposables.add(instantiationService.createInstance(EmptyEditorLandingContribution));

		const cleanup = async () => {
			await workbenchTeardown(instantiationService);
			part.dispose();
		};

		return { instantiationService, editorService, part, lifecycle, cleanup };
	}

	/** Name the landing surface for a snapshot assert: the screen id for Project Home, else "other" / "blank". */
	function describeSurface(input: EditorInput | undefined | null): string {
		if (input instanceof ScreenEditorInput) {
			return input.screen;
		}
		return input ? 'other' : 'blank';
	}

	/** Poll until the active editor is Project Home, or a short budget elapses (so a red run fails by assert, not hang). */
	async function waitForHome(editorService: IEditorService): Promise<void> {
		const deadline = Date.now() + 1000;
		while (!(editorService.activeEditor instanceof ScreenEditorInput) && Date.now() < deadline) {
			await timeout(5);
		}
	}

	test('closing the last tab lands on Project Home, never a blank editor area (issue #299)', async () => {
		const { editorService, part, cleanup } = await createHarness();

		const docInput = disposables.add(new LivingDocSourceInput(URI.file('/project/weekly.md')));
		await editorService.openEditor(docInput, { pinned: true });
		assert.strictEqual(editorService.activeEditor, docInput, 'a document tab is open before the close');

		// Close the last tab through the assembled service (the path every tab-close funnels through).
		await part.activeGroup.closeEditor(docInput);
		await waitForHome(editorService);

		assert.deepStrictEqual(
			{
				landedSurface: describeSurface(editorService.activeEditor),
				editorCount: editorService.editors.length,
			},
			{
				landedSurface: 'home', // a DEFINED surface, not the bare blank pane
				editorCount: 1,         // the editor area is never left empty
			});

		await cleanup();
	});

	test('a close while the window is shutting down never re-opens Home, so the open document is what restores (issue #299 guard)', async () => {
		const { editorService, part, lifecycle, cleanup } = await createHarness();

		const docInput = disposables.add(new LivingDocSourceInput(URI.file('/project/weekly.md')));
		await editorService.openEditor(docInput, { pinned: true });

		// A window close / reload tears every editor down on its way out; landing Home then would be serialised into
		// the restored working set and resurrect Home next launch over the document the writer had open.
		lifecycle.willShutdown = true;
		await part.activeGroup.closeEditor(docInput);
		await timeout(50);

		assert.deepStrictEqual(
			{
				active: editorService.activeEditor ? 'present' : 'none',
				editorCount: editorService.editors.length,
			},
			{
				active: 'none', // no surface re-opened during shutdown
				editorCount: 0,
			});

		await cleanup();
	});

	ensureNoDisposablesAreLeakedInTestSuite();
});
