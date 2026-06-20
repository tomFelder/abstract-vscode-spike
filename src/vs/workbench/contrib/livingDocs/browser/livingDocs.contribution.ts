/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Codicon } from '../../../../base/common/codicons.js';
import { Disposable, DisposableStore } from '../../../../base/common/lifecycle.js';
import { localize, localize2 } from '../../../../nls.js';
import { IConfigurationRegistry, Extensions as ConfigurationExtensions } from '../../../../platform/configuration/common/configurationRegistry.js';
import { SyncDescriptor } from '../../../../platform/instantiation/common/descriptors.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { registerIcon } from '../../../../platform/theme/common/iconRegistry.js';
import { EditorPaneDescriptor, IEditorPaneRegistry } from '../../../browser/editor.js';
import { ViewPaneContainer } from '../../../browser/parts/views/viewPaneContainer.js';
import { registerWorkbenchContribution2, WorkbenchPhase, IWorkbenchContribution } from '../../../common/contributions.js';
import { EditorExtensions } from '../../../common/editor.js';
import { Extensions as ViewExtensions, IViewContainersRegistry, IViewDescriptor, IViewsRegistry, ViewContainer, ViewContainerLocation } from '../../../common/views.js';
import { IEditorResolverService, RegisteredEditorPriority } from '../../../services/editor/common/editorResolverService.js';
import { IEditorGroupsService } from '../../../services/editor/common/editorGroupsService.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { IViewsService } from '../../../services/views/common/viewsService.js';
import { DOCUMENTS_CONTAINER_ID, DOCUMENTS_VIEW_ID, ILivingDocsService, REVIEW_RAIL_CONTAINER_ID, REVIEW_RAIL_VIEW_ID } from '../common/livingDocs.js';
import { DocumentsView } from './documentsView.js';
import { LivingDocEditor } from './livingDocEditor.js';
import { LivingDocEditorInput, LIVING_DOC_EDITOR_ID } from './livingDocEditorInput.js';
import { LivingDocsService } from './livingDocsService.js';
import { ReviewRailView } from './reviewRailView.js';

// The built-in File Explorer is the single biggest "this is an IDE" signal. The Documents home
// (below) replaces it as the default primary-sidebar container.
const EXPLORER_VIEW_CONTAINER_ID = 'workbench.view.explorer';

// --- service ---
registerSingleton(ILivingDocsService, LivingDocsService, InstantiationType.Delayed);

// --- configuration ---
Registry.as<IConfigurationRegistry>(ConfigurationExtensions.Configuration).registerConfiguration({
	id: 'livingDocs',
	order: 100,
	title: localize('livingDocs.config.title', "Living Documents"),
	type: 'object',
	properties: {
		'livingDocs.useModel': {
			type: 'boolean',
			default: true,
			description: localize('livingDocs.useModel', "Use a language model to rewrite narrative commentary when a source changes. When off, or when no model is available, a deterministic built-in heuristic is used instead."),
		},
		'livingDocs.commentaryModel': {
			type: 'string',
			default: '',
			description: localize('livingDocs.commentaryModel', "Preferred language model id for narrative rewrites. Leave empty to use the first available model."),
		},
	},
});

// --- editor pane ---
Registry.as<IEditorPaneRegistry>(EditorExtensions.EditorPane).registerEditorPane(
	EditorPaneDescriptor.create(LivingDocEditor, LivingDocEditor.ID, localize('livingDocEditor', "Living Document")),
	[new SyncDescriptor(LivingDocEditorInput)]
);

// --- editor resolver: open Markdown in the Living Document editor by default ---
// The product is a word processor, so we claim every *.md as the default editor (rendered view
// with an in-editor Raw Markdown toggle). The built-in text editor stays one click away via
// "Reopen Editor With... > Text Editor", so README-style raw editing is never blocked.
class LivingDocsEditorResolverContribution extends Disposable implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.livingDocs.editorResolver';

	constructor(
		@IEditorResolverService editorResolverService: IEditorResolverService,
		@IInstantiationService instantiationService: IInstantiationService,
	) {
		super();
		this._register(editorResolverService.registerEditor(
			'**/*.md',
			{
				id: LIVING_DOC_EDITOR_ID,
				label: localize('livingDoc.label', "Living Document"),
				priority: RegisteredEditorPriority.default,
			},
			{
				singlePerResource: true,
				canSupportResource: uri => uri.path.endsWith('.md'),
			},
			{
				createEditorInput: ({ resource, options }) => ({
					editor: instantiationService.createInstance(LivingDocEditorInput, resource),
					options,
				}),
			}
		));
	}
}
registerWorkbenchContribution2(LivingDocsEditorResolverContribution.ID, LivingDocsEditorResolverContribution, WorkbenchPhase.BlockRestore);

// --- "Documents" home in the primary sidebar (replaces the file Explorer) ---
const documentsIcon = registerIcon('living-docs-documents', Codicon.book, localize('livingDocs.documentsIcon', "Living Documents home"));

const documentsContainer: ViewContainer = Registry.as<IViewContainersRegistry>(ViewExtensions.ViewContainersRegistry).registerViewContainer({
	id: DOCUMENTS_CONTAINER_ID,
	title: localize2('livingDocs.documents', "Documents"),
	icon: documentsIcon,
	ctorDescriptor: new SyncDescriptor(ViewPaneContainer, [DOCUMENTS_CONTAINER_ID, { mergeViewWithContainerWhenSingleView: true }]),
	storageId: DOCUMENTS_CONTAINER_ID,
	hideIfEmpty: false,
	order: 0,
}, ViewContainerLocation.Sidebar, { isDefault: true });

const documentsViewDescriptor: IViewDescriptor = {
	id: DOCUMENTS_VIEW_ID,
	name: localize2('livingDocs.documentsView', "Documents"),
	containerIcon: documentsIcon,
	ctorDescriptor: new SyncDescriptor(DocumentsView),
	canToggleVisibility: false,
	canMoveView: false,
};
Registry.as<IViewsRegistry>(ViewExtensions.ViewsRegistry).registerViews([documentsViewDescriptor], documentsContainer);

// Hide the built-in File Explorer additively: deregister its view container once registries are
// populated, rather than patching the explorer contribution. ADDITIVE-CONTRIBUTION (merge-tax ledger).
class HideExplorerContribution extends Disposable implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.livingDocs.hideExplorer';

	constructor() {
		super();
		const registry = Registry.as<IViewContainersRegistry>(ViewExtensions.ViewContainersRegistry);
		const explorer = registry.get(EXPLORER_VIEW_CONTAINER_ID);
		if (explorer) {
			registry.deregisterViewContainer(explorer);
		}
	}
}
registerWorkbenchContribution2(HideExplorerContribution.ID, HideExplorerContribution, WorkbenchPhase.BlockRestore);

// --- Studio right panel (Chat / Review / History) in the auxiliary bar ---
const reviewIcon = registerIcon('living-docs-review', Codicon.checklist, localize('livingDocs.reviewIcon', "Living Documents review rail"));

const reviewContainer: ViewContainer = Registry.as<IViewContainersRegistry>(ViewExtensions.ViewContainersRegistry).registerViewContainer({
	id: REVIEW_RAIL_CONTAINER_ID,
	title: localize2('livingDocs.review', "Review"),
	icon: reviewIcon,
	ctorDescriptor: new SyncDescriptor(ViewPaneContainer, [REVIEW_RAIL_CONTAINER_ID, { mergeViewWithContainerWhenSingleView: true }]),
	storageId: REVIEW_RAIL_CONTAINER_ID,
	hideIfEmpty: false,
	order: 0,
}, ViewContainerLocation.AuxiliaryBar, { isDefault: true });

const reviewViewDescriptor: IViewDescriptor = {
	id: REVIEW_RAIL_VIEW_ID,
	name: localize2('livingDocs.reviewView', "Review"),
	containerIcon: reviewIcon,
	ctorDescriptor: new SyncDescriptor(ReviewRailView),
	canToggleVisibility: true,
	canMoveView: true,
};
Registry.as<IViewsRegistry>(ViewExtensions.ViewsRegistry).registerViews([reviewViewDescriptor], reviewContainer);

// --- first-run flow: launch reads as a document app, not an IDE ---
// The Welcome / Getting Started editor is the last IDE tell on launch. Close it so the workspace
// lands on the Documents home (sidebar) with a clean editor area, and reveal the Studio right panel
// so Review is one glance away. ADDITIVE-CONTRIBUTION (merge-tax ledger).
const WELCOME_INPUT_TYPE_ID = 'workbench.editors.gettingStartedInput';

class StudioStartupContribution extends Disposable implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.livingDocs.studioStartup';

	constructor(
		@IViewsService viewsService: IViewsService,
		@IEditorGroupsService private readonly _editorGroups: IEditorGroupsService,
		@IEditorService editorService: IEditorService,
	) {
		super();
		// First-run only: the Getting Started / Welcome editor can be opened a tick late by the
		// startup-page logic, so close any that exist now, then watch exactly ONE more editor-change
		// to catch the late open -- and then stop, so a user who later opens Welcome themselves keeps it.
		this._closeWelcomeEditors();
		const once = this._register(new DisposableStore());
		once.add(editorService.onDidActiveEditorChange(() => {
			this._closeWelcomeEditors();
			once.dispose();
		}));
		// Reveal the Studio right panel (Chat / Review / History) without stealing focus.
		void viewsService.openView(REVIEW_RAIL_VIEW_ID, false);
	}

	private _closeWelcomeEditors(): void {
		for (const group of this._editorGroups.groups) {
			for (const editor of [...group.editors]) {
				if (editor.typeId === WELCOME_INPUT_TYPE_ID) {
					void group.closeEditor(editor);
				}
			}
		}
	}
}
registerWorkbenchContribution2(StudioStartupContribution.ID, StudioStartupContribution, WorkbenchPhase.AfterRestored);
