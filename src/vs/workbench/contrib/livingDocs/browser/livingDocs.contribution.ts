/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { disposableTimeout } from '../../../../base/common/async.js';
import { lockAllSashes } from '../../../../base/browser/ui/sash/sash.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { Disposable, DisposableStore } from '../../../../base/common/lifecycle.js';
import { ThemeIcon } from '../../../../base/common/themables.js';
import { localize, localize2 } from '../../../../nls.js';
import { Action2, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { IConfigurationRegistry, Extensions as ConfigurationExtensions } from '../../../../platform/configuration/common/configurationRegistry.js';
import { SyncDescriptor } from '../../../../platform/instantiation/common/descriptors.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { IInstantiationService, ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { registerIcon } from '../../../../platform/theme/common/iconRegistry.js';
import { EditorPaneDescriptor, IEditorPaneRegistry } from '../../../browser/editor.js';
import { ViewPaneContainer } from '../../../browser/parts/views/viewPaneContainer.js';
import { registerWorkbenchContribution2, WorkbenchPhase, IWorkbenchContribution } from '../../../common/contributions.js';
import { EditorExtensions } from '../../../common/editor.js';
import { Extensions as ViewExtensions, IViewContainersRegistry, IViewDescriptor, IViewsRegistry, ViewContainer, ViewContainerLocation } from '../../../common/views.js';
import { IEditorResolverService, RegisteredEditorPriority } from '../../../services/editor/common/editorResolverService.js';
import { IEditorGroupsService } from '../../../services/editor/common/editorGroupsService.js';
import { IWorkbenchLayoutService, Parts } from '../../../services/layout/browser/layoutService.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { IViewsService } from '../../../services/views/common/viewsService.js';
import { DOCUMENTS_CONTAINER_ID, DOCUMENTS_VIEW_ID, ILivingDocsService, REVIEW_RAIL_CONTAINER_ID, REVIEW_RAIL_VIEW_ID } from '../common/livingDocs.js';
import { LivingDocEditor } from './livingDocEditor.js';
import { LivingDocEditorInput, LIVING_DOC_EDITOR_ID } from './livingDocEditorInput.js';
import { LivingDocsService } from './livingDocsService.js';
import { ReviewRailView } from './reviewRailView.js';
import { TreeRailView } from './treeRailView.js';
import { ScreenEditor } from './screenEditor.js';
import { ScreenEditorInput } from './screenEditorInput.js';
import { ScreenLauncherView } from './screenLauncherView.js';
import { ScreenId } from './screenRender.js';

// The built-in IDE view containers (Search, Source Control, Run and Debug, Extensions) are the
// icon-nav "this is an IDE" tells, so they are deregistered, leaving Documents / Templates /
// Knowledge / Agents alongside the native Explorer.
// v6 (decision 42, plan 14): the native File Explorer is DELIBERATELY kept (removed from this list)
// so the core authoring loop can create folders/files on disk from a real file tree (F1). This
// REVISES G4 / decisions 25 & 30 (the de-IDE calls) for functional power; the custom tree-rail stays
// the default sidebar container (registered with isDefault below), and the Explorer is a second
// activity-bar icon for raw file ops. Logged in 03-merge-tax-ledger.md + 07-decision-log.md.
const IDE_VIEW_CONTAINER_IDS = [
	'workbench.view.search',
	'workbench.view.scm',
	'workbench.view.debug',
	'workbench.view.extensions',
];

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
			description: localize('livingDocs.commentaryModel', "Claude model id used for narrative rewrites and the Strategy grader. Leave empty to use the default ({0}).", 'claude-opus-4-8'),
		},
		'livingDocs.modelProxyUrl': {
			type: 'string',
			default: 'http://localhost:8090',
			description: localize('livingDocs.modelProxyUrl', "Base URL of the local Anthropic OAuth proxy (scripts/lwd-anthropic-proxy.js) the renderer calls for model-backed features. The proxy holds the developer's OAuth token server-side; no credential is ever embedded in the app."),
		},
	},
});

// --- calm shell: hide the IDE chrome by registering product setting defaults ---
// (plan 16 iter 1, decision 54). The product is a document tool, not an editor, so the workbench
// shell parts are OFF by default: the status-bar footer, the activity-bar icon column, the editor
// tab strip, and the breadcrumb. These are all real, user-overridable settings, so this is an
// ADDITIVE CONTRIBUTION (no core patch) -- a user who wants the IDE shell back can flip any of them.
// The calm topbar + the tree-rail inside the document surface are the chrome that stays; the desktop
// title bar (OS window controls) is intentionally NOT touched here. Logged in 06-design-notes ledger.
// Registered at module load (an import side effect, the earliest phase) so the layout reads these as
// the effective defaults on its first startup pass, before any part is laid out.
Registry.as<IConfigurationRegistry>(ConfigurationExtensions.Configuration).registerDefaultConfigurations([{
	overrides: {
		'workbench.statusBar.visible': false,
		'workbench.activityBar.location': 'hidden',
		'workbench.editor.showTabs': 'none',
		'breadcrumbs.enabled': false,
	}
}]);

// --- editor pane ---
Registry.as<IEditorPaneRegistry>(EditorExtensions.EditorPane).registerEditorPane(
	EditorPaneDescriptor.create(LivingDocEditor, LivingDocEditor.ID, localize('livingDocEditor', "Living Document")),
	[new SyncDescriptor(LivingDocEditorInput)]
);

// The main-area Opportunity OS screens (Templates / Knowledge / Agents) share one webview editor.
Registry.as<IEditorPaneRegistry>(EditorExtensions.EditorPane).registerEditorPane(
	EditorPaneDescriptor.create(ScreenEditor, ScreenEditor.ID, localize('livingDocsScreen', "Opportunity OS")),
	[new SyncDescriptor(ScreenEditorInput)]
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

// --- the left tree-rail in the primary sidebar (one rail: Files / Context / Outline / Search + a
// folder tree, replacing the file Explorer AND the spike-era separate Documents + Context containers).
// The single TreeRailView holds the tabbed rail (decision log 23). ADDITIVE-CONTRIBUTION (merge-tax ledger).
const workspaceIcon = registerIcon('living-docs-workspace', Codicon.listTree, localize('livingDocs.workspaceIcon', "Workspace tree-rail"));

const workspaceContainer: ViewContainer = Registry.as<IViewContainersRegistry>(ViewExtensions.ViewContainersRegistry).registerViewContainer({
	id: DOCUMENTS_CONTAINER_ID,
	title: localize2('livingDocs.workspace', "Workspace"),
	icon: workspaceIcon,
	ctorDescriptor: new SyncDescriptor(ViewPaneContainer, [DOCUMENTS_CONTAINER_ID, { mergeViewWithContainerWhenSingleView: true }]),
	storageId: DOCUMENTS_CONTAINER_ID,
	hideIfEmpty: false,
	order: 0,
}, ViewContainerLocation.Sidebar, { isDefault: true });

const treeRailViewDescriptor: IViewDescriptor = {
	id: DOCUMENTS_VIEW_ID,
	name: localize2('livingDocs.workspaceView', "Workspace"),
	containerIcon: workspaceIcon,
	ctorDescriptor: new SyncDescriptor(TreeRailView),
	canToggleVisibility: false,
	canMoveView: false,
};
Registry.as<IViewsRegistry>(ViewExtensions.ViewsRegistry).registerViews([treeRailViewDescriptor], workspaceContainer);

// Hide the built-in IDE view containers additively: deregister them once registries are populated,
// rather than patching each contribution. ADDITIVE-CONTRIBUTION (merge-tax ledger). NOTE: this leans
// on internal container ids and fails unsafely if an id changes upstream -- re-pin on rebase.
class HideIdeContainersContribution extends Disposable implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.livingDocs.hideIdeContainers';

	constructor() {
		super();
		const registry = Registry.as<IViewContainersRegistry>(ViewExtensions.ViewContainersRegistry);
		for (const id of IDE_VIEW_CONTAINER_IDS) {
			const container = registry.get(id);
			if (container) {
				registry.deregisterViewContainer(container);
			}
		}
	}
}
registerWorkbenchContribution2(HideIdeContainersContribution.ID, HideIdeContainersContribution, WorkbenchPhase.BlockRestore);

// G4 (remove IDE optionality): the calm shell has no user-resizable panes. Lock every layout
// sash into a non-draggable state at startup. The lock is global + sticky, so sashes created
// later (and re-evaluated on every layout) stay non-interactive. CORE-PATCH (merge-tax ledger).
class LockLayoutSashesContribution extends Disposable implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.livingDocs.lockLayoutSashes';

	constructor() {
		super();
		lockAllSashes();
	}
}
registerWorkbenchContribution2(LockLayoutSashesContribution.ID, LockLayoutSashesContribution, WorkbenchPhase.BlockRestore);

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

// --- icon-nav screens (Templates / Knowledge / Agents) in the activity bar ---
// Each is an activity-bar container whose slim launcher view opens the full-width screen in the
// editor area, mirroring the comp's icon nav. ADDITIVE-CONTRIBUTION (merge-tax ledger).
interface IScreenNavEntry {
	readonly screen: ScreenId;
	readonly containerId: string;
	readonly viewId: string;
	readonly title: string;
	readonly icon: ThemeIcon;
	readonly order: number;
}

const SCREEN_NAV: readonly IScreenNavEntry[] = [
	{ screen: 'home', containerId: 'workbench.viewContainer.livingDocs.home', viewId: 'workbench.view.livingDocs.home', title: 'Home', icon: Codicon.home, order: 1 },
	{ screen: 'templates', containerId: 'workbench.viewContainer.livingDocs.templates', viewId: 'workbench.view.livingDocs.templates', title: 'Templates', icon: Codicon.layout, order: 2 },
	{ screen: 'knowledge', containerId: 'workbench.viewContainer.livingDocs.knowledge', viewId: 'workbench.view.livingDocs.knowledge', title: 'Knowledge', icon: Codicon.library, order: 3 },
	{ screen: 'agents', containerId: 'workbench.viewContainer.livingDocs.agents', viewId: 'workbench.view.livingDocs.agents', title: 'Agents', icon: Codicon.sync, order: 4 },
];

for (const entry of SCREEN_NAV) {
	const icon = registerIcon(`living-docs-${entry.screen}`, entry.icon, localize('livingDocs.screenIcon', "Opportunity OS {0}", entry.title));
	const container = Registry.as<IViewContainersRegistry>(ViewExtensions.ViewContainersRegistry).registerViewContainer({
		id: entry.containerId,
		title: { value: entry.title, original: entry.title },
		icon,
		ctorDescriptor: new SyncDescriptor(ViewPaneContainer, [entry.containerId, { mergeViewWithContainerWhenSingleView: true }]),
		storageId: entry.containerId,
		hideIfEmpty: false,
		order: entry.order,
	}, ViewContainerLocation.Sidebar);

	Registry.as<IViewsRegistry>(ViewExtensions.ViewsRegistry).registerViews([{
		id: entry.viewId,
		name: { value: entry.title, original: entry.title },
		containerIcon: icon,
		ctorDescriptor: new SyncDescriptor(ScreenLauncherView),
		canToggleVisibility: false,
		canMoveView: false,
	}], container);

	registerAction2(class extends Action2 {
		constructor() {
			super({
				id: `livingDocs.open.${entry.screen}`,
				title: localize2('livingDocs.openScreen', "Open {0}", entry.title),
				category: localize2('livingDocs.category', "Opportunity OS"),
				f1: true,
			});
		}
		override async run(accessor: ServicesAccessor): Promise<void> {
			const editorService = accessor.get(IEditorService);
			const instantiationService = accessor.get(IInstantiationService);
			await editorService.openEditor(instantiationService.createInstance(ScreenEditorInput, entry.screen), { pinned: true });
		}
	});
}

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
		@IEditorService private readonly _editorService: IEditorService,
		@IInstantiationService private readonly _instantiation: IInstantiationService,
		@IWorkbenchLayoutService layoutService: IWorkbenchLayoutService,
	) {
		super();
		// First-run only: the Getting Started / Welcome editor can be opened a tick late by the
		// startup-page logic, so close any that exist now, then watch exactly ONE more editor-change
		// to catch the late open -- and then stop, so a user who later opens Welcome themselves keeps it.
		this._closeWelcomeEditors();
		const once = this._register(new DisposableStore());
		once.add(this._editorService.onDidActiveEditorChange(() => {
			this._closeWelcomeEditors();
			once.dispose();
		}));
		// Land on the Home dashboard (the comp's default screen) when nothing else is open, so launch
		// reads as a document app rather than an empty editor.
		if (this._editorService.editors.length === 0) {
			void this._editorService.openEditor(this._instantiation.createInstance(ScreenEditorInput, 'home'), { pinned: true });
		}
		// Reveal the Studio right panel (Chat / Review / History / Skills) without stealing focus, then
		// pin the shell to the comp's pixel widths: a 264px tree-rail and a 392px right rail. Sizing
		// happens AFTER the rail is revealed (setSize is a no-op on a hidden part) and after a layout
		// tick so it isn't overwritten by the workbench's own size restore. The product is an opinionated
		// single surface, so the layout is set rather than left at the IDE defaults.
		void viewsService.openView(REVIEW_RAIL_VIEW_ID, false).then(() => {
			this._pinShellWidths(layoutService);
		});
	}

	private _pinShellWidths(layoutService: IWorkbenchLayoutService): void {
		const apply = () => {
			try {
				layoutService.setSize(Parts.SIDEBAR_PART, { width: 264, height: layoutService.getSize(Parts.SIDEBAR_PART).height });
				layoutService.setSize(Parts.AUXILIARYBAR_PART, { width: 392, height: layoutService.getSize(Parts.AUXILIARYBAR_PART).height });
			} catch (e) { /* layout not ready in some hosts; the default widths still apply */ }
		};
		// Run after the current layout pass and once more on the next animation frame, so the sizes win
		// over the workbench's restore (which can land a tick later).
		this._register(disposableTimeout(apply, 0));
		apply();
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
