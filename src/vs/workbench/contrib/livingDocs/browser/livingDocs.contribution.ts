/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { disposableTimeout } from '../../../../base/common/async.js';
import { $, addDisposableListener, append } from '../../../../base/browser/dom.js';
import { mainWindow } from '../../../../base/browser/window.js';
import { IHoverService } from '../../../../platform/hover/browser/hover.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { KeyChord, KeyCode, KeyMod } from '../../../../base/common/keyCodes.js';
import { IKeybindings, KeybindingsRegistry } from '../../../../platform/keybinding/common/keybindingsRegistry.js';
import { Disposable, DisposableStore, MutableDisposable } from '../../../../base/common/lifecycle.js';
import { ThemeIcon } from '../../../../base/common/themables.js';
import { localize, localize2 } from '../../../../nls.js';
import { Action2, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { IConfigurationRegistry, Extensions as ConfigurationExtensions } from '../../../../platform/configuration/common/configurationRegistry.js';
import { SyncDescriptor } from '../../../../platform/instantiation/common/descriptors.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { IInstantiationService, ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { registerIcon } from '../../../../platform/theme/common/iconRegistry.js';
import { EditorPaneDescriptor, IEditorPaneRegistry } from '../../../browser/editor.js';
import { ViewPaneContainer } from '../../../browser/parts/views/viewPaneContainer.js';
import { registerWorkbenchContribution2, WorkbenchPhase, IWorkbenchContribution } from '../../../common/contributions.js';
import { EditorExtensions, IEditorFactoryRegistry } from '../../../common/editor.js';
import { Extensions as ViewExtensions, IViewContainersRegistry, IViewDescriptor, IViewsRegistry, ViewContainer, ViewContainerLocation } from '../../../common/views.js';
import { IEditorResolverService, RegisteredEditorPriority } from '../../../services/editor/common/editorResolverService.js';
import { IEditorGroupsService } from '../../../services/editor/common/editorGroupsService.js';
import { IWorkbenchLayoutService, Parts } from '../../../services/layout/browser/layoutService.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { IWorkspaceContextService, WorkbenchState } from '../../../../platform/workspace/common/workspace.js';
import { decideStartupRoute, StartupRouteKind } from '../common/startupRouting.js';
import { decideReviewRailOpenOnEntry, RailGesture, recordedChoiceForRailGesture, reviewRailManualChoiceFromPersistedCollapse, ReviewRailManualChoice, treeRailHiddenOnEntry } from '../common/railVisibility.js';
import { IViewsService } from '../../../services/views/common/viewsService.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IProductService } from '../../../../platform/product/common/productService.js';
import { DOCUMENTS_CONTAINER_ID, DOCUMENTS_VIEW_ID, ILivingDocsService, REVIEW_RAIL_CONTAINER_ID, REVIEW_RAIL_VIEW_ID } from '../common/livingDocs.js';
import { IAbstractHeaderService } from '../common/abstractHeader.js';
import { AbstractHeaderService } from './abstractHeaderService.js';
import { AbstractHeaderContribution } from './abstractHeader.js';
import { IAnalyticsService } from '../common/analytics.js';
import { AnalyticsService } from './analyticsService.js';
import { LivingDocEditor } from './livingDocEditor.js';
import { LivingDocEditorInput, LIVING_DOC_EDITOR_ID } from './livingDocEditorInput.js';
import { LivingDocSourceEditor } from './livingDocSourceEditor.js';
import { LivingDocSourceInput, LivingDocSourceInputSerializer } from './livingDocSourceInput.js';
import { parsePersistedTabStrip } from '../common/livingDocTabs.js';
import { setTabRestoreInProgress, tabStripStorageKey } from './abstractTabStrip.js';
import { URI } from '../../../../base/common/uri.js';
import { LivingDocsService } from './livingDocsService.js';
import { ReviewRailView } from './reviewRailView.js';
import { TreeRailView } from './treeRailView.js';
import { ScreenEditor } from './screenEditor.js';
import { ScreenEditorInput } from './screenEditorInput.js';
import { ScreenLauncherView } from './screenLauncherView.js';
import { EditorNavLauncherView, openEditorNavTarget } from './editorNavLauncherView.js';
import { openDocQuickSwitch } from './docQuickSwitch.js';
import { ScreenId } from './screenRender.js';

// The built-in IDE view containers (Search, Source Control, Run and Debug, Extensions) are the
// icon-nav "this is an IDE" tells, so they are deregistered, leaving the living-docs nav items.
// v6 (decision 42, plan 14): the native File Explorer was previously KEPT so the core authoring
// loop could create folders/files on disk from a real file tree (F1).
// plan 25 iter 2 (decision D25-C): the redesign comp (Part C1) shows EXACTLY five nav items
// (Home . Editor . Templates . Knowledge . Agents) over a single tree-rail. The Explorer's own
// activity-bar icon is redundant with that tree-rail (Files / Context / Outline already fronts the
// on-disk folder) and its long "Explorer" label overflowed the 60px labeled item, so the Explorer
// container is now deregistered here too. This does NOT remove disk access: the custom Workspace
// tree-rail (DOCUMENTS_CONTAINER_ID, isDefault below) remains the primary sidebar and still lists /
// creates real files. Logged in 03-merge-tax-ledger.md + 07-decision-log.md.
const IDE_VIEW_CONTAINER_IDS = [
	'workbench.view.search',
	'workbench.view.scm',
	'workbench.view.debug',
	'workbench.view.extensions',
	'workbench.view.explorer',
	// The stock upstream Copilot "Chat" tab (auxiliary bar): it opens the raw "Build with Agent" panel
	// gated on Copilot sign-in, unrelated to the open document. The only Chat we expose is the Review-rail
	// Chat (workbench.viewContainer.livingDocs), so deregister this one (plan 37 F2 / walk finding X4). Its
	// `when` clause has OR branches that leak the tab even with chat.disableAIFeatures set, so config alone
	// is not enough - deregistering the container removes it unconditionally.
	'workbench.panel.chat',
];

// --- service ---
registerSingleton(ILivingDocsService, LivingDocsService, InstantiationType.Delayed);
// The product-analytics seam (plan 36). Eager so it is ready to read consent + capture app_opened at the
// first-run consent moment below; the rest of the app captures only through IAnalyticsService.
registerSingleton(IAnalyticsService, AnalyticsService, InstantiationType.Eager);
// The 48px header's per-surface content service (plan 43 section 3.3, plan 44-b). Delayed: only the header view
// and the surfaces that publish content read it.
registerSingleton(IAbstractHeaderService, AbstractHeaderService, InstantiationType.Delayed);

// --- configuration ---
Registry.as<IConfigurationRegistry>(ConfigurationExtensions.Configuration).registerConfiguration({
	id: 'livingDocs',
	order: 100,
	title: localize('livingDocs.config.title', "Living Documents"),
	type: 'object',
	properties: {
		'abstract.analytics.enabled': {
			type: 'boolean',
			default: true,
			description: localize('abstract.analytics.enabled', "Help us improve Abstract by sharing anonymous product analytics. We count actions (how often features are used), never your words - document content never leaves your machine. On by default; turn it off here any time."),
			tags: ['usesOnlineServices'],
		},
		'livingDocs.useModel': {
			type: 'boolean',
			default: true,
			description: localize('livingDocs.useModel', "Use a language model to rewrite narrative commentary when a source changes. When off, or when no model is available, a deterministic built-in heuristic is used instead."),
		},
		'livingDocs.commentaryModel': {
			type: 'string',
			default: '',
			description: localize('livingDocs.commentaryModel', "Model id used for narrative rewrites and the Strategy grader. Leave empty to use the default ({0}).", 'claude-opus-4-8'),
		},
		'livingDocs.modelProxyUrl': {
			type: 'string',
			default: 'http://localhost:8090',
			description: localize('livingDocs.modelProxyUrl', "Base URL of the local model broker the app calls for model-backed features. The app starts and supervises the broker automatically; it holds the model credential server-side and translates to the configured backend, so no credential is ever embedded in the app."),
		},
		'livingDocs.fanoutContextBudget': {
			type: 'number',
			default: 24000,
			minimum: 2000,
			description: localize('livingDocs.fanoutContextBudget', "Token budget for one whole-project fan-out model call (plan 30, track 3). When you ask across the whole project, the documents are packed into batches that fit this budget rather than sent in one over-large call; a document larger than the budget is flagged as too large for the run instead of being silently truncated."),
		},
	},
});

// (issue #180) The default colour theme id. This MUST stay exactly equal to the `settingsId` of the fork's
// light theme contribution (`id`/`label` "Abstract", `uiTheme` "vs" in extensions/theme-defaults/package.json)
// -- `workbench.colorTheme` is resolved by matching this string against installed themes, and a typo does NOT
// error: it silently falls back to the inherited DARK default on a cold boot. Extracted to a named constant so
// the load-bearing literal is greppable and the invariant is documented next to it.
const ABSTRACT_LIGHT_THEME_ID = 'Abstract';

// --- calm shell: hide the IDE chrome by registering product setting defaults ---
// (plan 16 iter 1, decision 54). The product is a document tool, not an editor, so the workbench
// shell parts are OFF by default: the status-bar footer, the editor tab strip, and the breadcrumb.
// These are all real, user-overridable settings, so this is an ADDITIVE CONTRIBUTION (no core patch)
// -- a user who wants the IDE shell back can flip any of them. The activity bar is intentionally NOT
// hidden: the fork repurposes it as the labelled 76px icon-nav (Home / Editor / Templates / Knowledge
// / Agents), which is how you move between surfaces, so hiding it would strand a folder window with no
// navigation (issue #172). The calm topbar + the tree-rail inside the document surface are the chrome
// that stays; the desktop title bar (OS window controls) is intentionally NOT touched here. Logged in
// 06-design-notes ledger.
// Registered at module load (an import side effect, the earliest phase) so the layout reads these as
// the effective defaults on its first startup pass, before any part is laid out.
// (plan 16 iter 2, decision 55) ALSO kill the cold-launch noise + trust leaks by the same additive
// config-default route: trust the product's own workspaces (no Restricted-Mode banner), skip the
// Copilot onboarding modal + the welcome page, hide the built-in GitHub Copilot AI chrome (the
// Sign-In button + Copilot status -- the product has its OWN chat in the Review rail), and replace
// the "${rootName} [remote]" title with just the document name. All user-overridable settings, so
// still 0 core patches. Logged in 06-design-notes ledger D8.
Registry.as<IConfigurationRegistry>(ConfigurationExtensions.Configuration).registerDefaultConfigurations([{
	overrides: {
		// iter 1 -- strip the IDE shell parts (but keep the activity bar: it is the labelled 76px
		// icon-nav, issue #172)
		'workbench.statusBar.visible': false,
		'workbench.editor.showTabs': 'none',
		'breadcrumbs.enabled': false,
		// (issue #180) -- pin the workbench to the light Abstract palette for beta. VS Code inherits a DARK
		// default theme, which leaked in three ways: the native title bar + notification toasts rendered dark,
		// the tree-rail (its CSS reads `--vscode-*` theme vars) rendered dark in folder windows, and the doc
		// editor's webview default styles painted `blockquote{background:var(--vscode-textBlockQuote-background)}`
		// a dark panel (the webview host's `_defaultStyles`, `vs/workbench/contrib/webview/browser/pre/index.html`).
		// Defaulting `workbench.colorTheme` to the fork's own light theme ("Abstract", uiTheme `vs`) resolves every
		// `--vscode-*` var to the light design-system palette in ONE move. `window.autoDetectColorScheme` is pinned
		// off so the app stays light even when the OS is in dark mode (beta ships light only). Both are real,
		// user-overridable settings, so this stays an ADDITIVE contribution (no core patch). The calm chrome has no
		// theme-picker affordance and the command palette is already neutralised, so there is no user-facing toggle.
		'workbench.colorTheme': ABSTRACT_LIGHT_THEME_ID,
		'window.autoDetectColorScheme': false,
		// (issue #172) Turn on the Modern UI style-override group by default. This is what activates the
		// Studio styleOverrides (the `.style-override` class the StyleOverridesContribution toggles
		// only when this is on): the calm floating-card panels AND, critically, the labelled 76px icon-nav
		// (Home / Editor / Templates / Knowledge / Agents rendered with text labels via studio.css ::after)
		// plus hiding the redundant Workspace tree-rail icon. Without it, restoring the activity bar (above)
		// would show a raw, unlabelled IDE icon column with the Workspace viewlet icon leaking through --
		// exactly what #172 says must not happen. A real, user-overridable setting, so still additive.
		'workbench.experimental.modernUI': true,
		// iter 2 -- kill the cold-launch noise + trust leaks
		'security.workspace.trust.enabled': false,
		'workbench.welcomePage.experimentalOnboarding': false,
		'workbench.startupEditor': 'none',
		'chat.disableAIFeatures': true,
		// (plan 33 iter 1, decision 95, leaks L1/L2/L4) -- close the last title-bar leaks by the SAME
		// additive config-default route (no core patch). The native title bar on screen surfaces was still
		// showing the command-centre "Review Project" search pill, the layout-toggle icons and the
		// editor-group action icons; the window/tab title still read the old brand. All three are real,
		// user-overridable workbench settings, so turning them off by default stays an additive contribution.
		// (plan 44-b) The 48px Abstract header repurposes the title bar part (decision 170). The title bar is
		// hidden in web when it is "empty"; we make it non-empty by ENABLING the command centre by default, then
		// hide the stock command-centre / toolbars / window-title with the `.abstract-header` rules in studio.css
		// and paint the Abstract header over the container (AbstractHeaderContribution). This keeps the title
		// bar's VISIBILITY a settings-tier default (0 core); only its 48px HEIGHT needs the one sanctioned core
		// seam of this bundle (V2-2). Layout + editor actions stay hidden so nothing stock renders behind it.
		'window.commandCenter': true,
		'workbench.layoutControl.enabled': false,
		'workbench.editor.editorActionsLocation': 'hidden',
		// (issue #182, leak 1) The docs live inside a git repo, so opening the folder makes the built-in
		// git extension raise the stock "A git repository was found in the parent folders..." toast --
		// meaningless in a document tool. The `never` value is a real, user-overridable git setting that
		// suppresses that prompt at the source: the git model gates BOTH of its parent-repository prompt sites
		// on the setting reading `prompt` -- the initial-scan path (extensions/git/src/model.ts:336-339) and the
		// per-repository open path (extensions/git/src/model.ts:632-642) both call `showParentRepositoryNotification()`
		// only when `openRepositoryInParentFolders === 'prompt'`, so `never` skips both entirely
		// without opening the parent repo. No livingDocs feature depends on the git extension (the SCM
		// container is deregistered above), so this is pure settings-tier suppression -- 0 core patch.
		'git.openRepositoryInParentFolders': 'never',
		// The window/tab title is the workspace (project) name then the brand, e.g. "Project Brief - Abstract".
		// ${separator} collapses when a token is empty, so a no-folder window reads simply "Abstract".
		'window.title': '${rootName}${separator}Abstract',
		// (plan 33 iter 3, L4 follow-up) VS Code's default title separator on macOS is " — " (an EM DASH),
		// so the brand title rendered "Project - Abstract" with an em dash - an old-brand-adjacent leak the
		// iter-1 verification missed (the web tab title, not the OS title bar). Pin it to a plain " - " so the
		// user-visible window/tab title carries no em dash, on every platform. Settings tier, no core patch.
		'window.titleSeparator': ' - ',
		// iter 4 (decision 57) -- hide the internal plumbing from the native Explorer. `.lock.json`
		// (provenance/claim sidecars) and `agents.json` (the agent registry) are implementation detail, not
		// documents. Object-valued default configurations MERGE in VS Code, so these patterns ADD to the
		// built-in excludes (`.git`, `.DS_Store`, ...) rather than replacing them. The files stay on disk;
		// the user just never sees them in their document list. The custom tree-rail already shows only `.md`.
		'files.exclude': {
			'**/*.lock.json': true,
			'**/agents.json': true,
			// (plan 33 iter 2, L5) the project-name marker is plumbing, not a document.
			'**/.abstract-name': true,
		},
		// (plan 46-b, P5.5 -- routed via orchestrator, plan 44 ownership) The Files-rail tree wants a 14px
		// per-level child indent (spec pin 5, section 3.6). `WorkbenchObjectTree` unconditionally overrides any
		// per-instance `indent` option with `workbench.tree.indent` (listService.ts, default 8), so the only
		// path the widget honours is this settings-tier default. The calm shell hides every stock IDE tree
		// (Explorer / Search / SCM containers are deregistered), so the Files rail is effectively the only
		// visible tree the value reaches; it is a real, user-overridable setting, so this stays additive (0 core).
		'workbench.tree.indent': 14,
	}
}]);

// --- calm shell: neutralise the residual IDE keyboard chords (plan 33 iter 3, L3/L6) ---
// The command-palette + quick-open chords were already removed at the core seam (the decision-30 pattern,
// v3 iter 2, guarded by check-seams). A SECOND tier of IDE chords still fired on our surfaces: the
// view-container switches (Cmd+Shift+E/F/G/X/M) open containers we have DEREGISTERED (Explorer, Search,
// SCM, Extensions, Problems), and the panel / integrated-terminal / secondary-side-bar toggles surface IDE
// affordances that the contextual rails (decision 94: the rails are editor companions) have made redundant.
// We neutralise each leaking chord the cheapest way - an ADDITIVE keybinding contribution that shadows the
// chord with the built-in `noop` command at a weight above every core/extension binding, so the chord is
// swallowed with NO core patch (KeybindingsRegistry is a public registry, called from our own module).
// The primary Side Bar chord (Cmd+B) is deliberately KEPT: it collapses the tree-rail (a first-class
// product surface) and doubles as Bold inside the ProseMirror writing surface. Full verdict per chord in
// docs/plans/33-verify/keyboard-audit.md.
const NEUTRALISED_IDE_CHORDS: readonly IKeybindings[] = [
	{ primary: KeyMod.CtrlCmd | KeyCode.KeyJ },																// workbench.action.togglePanel - no panel in the calm shell
	{ primary: KeyMod.CtrlCmd | KeyCode.Backquote, mac: { primary: KeyMod.WinCtrl | KeyCode.Backquote } },	// terminal.toggleTerminal
	{ primary: KeyMod.CtrlCmd | KeyMod.Alt | KeyCode.KeyB },													// toggleAuxiliaryBar (Secondary Side Bar) - the L3 tooltip chord
	{ primary: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KeyE },													// Explorer viewlet (deregistered)
	{ primary: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KeyF },													// Search viewlet (deregistered)
	{ primary: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KeyG, mac: { primary: KeyMod.WinCtrl | KeyMod.Shift | KeyCode.KeyG } },	// SCM (deregistered)
	{ primary: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KeyX },													// Extensions viewlet (deregistered)
	{ primary: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KeyM },													// Problems panel
	{ primary: KeyMod.CtrlCmd | KeyMod.Alt | KeyCode.KeyI, mac: { primary: KeyMod.CtrlCmd | KeyMod.WinCtrl | KeyCode.KeyI } },	// stock Copilot Chat toggle (container deregistered, F2/X4)
];
for (const chord of NEUTRALISED_IDE_CHORDS) {
	// Weight 1000 sits above ExternalExtension (400) so this swallow always wins the chord resolution.
	KeybindingsRegistry.registerKeybindingRule({ id: 'noop', weight: 1000, when: undefined, ...chord });
}

// --- v2 header rail-toggle chords (plan 44-b, P2.2) ---
// The 48px header's two rail toggles also carry keyboard chords: Cmd+\ collapses the tree rail, Cmd+Shift+\
// collapses the right rail. These re-use the stock part-toggle commands, so a keyboard toggle and a header
// button toggle are the same action (no divergence).
//
// Cmd+\ is the stock split-editor chord (workbench.action.splitEditor, weight WorkbenchContrib ~200). Binding
// the tree-rail toggle to Cmd+\ at weight 1000 both wires our chord AND neutralises the split-editor chord in
// one registration (the higher weight wins resolution, so split-editor never fires) - the "neutralised via
// keybinding registration, weight 1000" the plan calls for, with no core patch to the keybinding tables.
//
// Cmd+B (the stock Primary Side Bar toggle) is deliberately UNTOUCHED (P2.6): it keeps its dual role - Bold
// inside the ProseMirror writing surface (the webview swallows it in editor focus) and tree-rail toggle in
// shell focus. We do not re-bind or shadow it here.
KeybindingsRegistry.registerKeybindingRule({
	id: 'workbench.action.toggleSidebarVisibility',
	weight: 1000,
	when: undefined,
	primary: KeyMod.CtrlCmd | KeyCode.Backslash,
});
KeybindingsRegistry.registerKeybindingRule({
	id: 'workbench.action.toggleAuxiliaryBar',
	weight: 1000,
	when: undefined,
	primary: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.Backslash,
});

// --- neutralise the residual split / group-creation chords (routed via orchestrator, plan 44 ownership) ---
// The bare Cmd+\ (workbench.action.splitEditor) is claimed above by the tree-rail toggle. But the stock editor
// still ships a second tier of split chords that survive the calm shell and open a group a keyboard user can
// reach - and, because closeEmptyGroups only reaps a group when its LAST editor closes (an editor that split
// path never opened), a split into an empty group PERSISTS. That directly contradicts P7.8's "no other split
// path" intent (the ONE sanctioned split is openToTheRight). We shadow each surviving chord with `noop` at the
// same weight-1000 tier the rail toggles use, so the chord is swallowed with no core patch.
//
// Chord audit (stock editorActions.ts / editorCommands.ts):
//   Cmd+K Cmd+\        -> splitEditor{Orthogonal,Left,Right,Up,Down} (all five share this chord) -> NEW group. LIVE LEAK, neutralised.
//   Cmd+K Cmd+Shift+\  -> splitEditorInGroup / toggleSplitEditorInGroup -> in-group side-by-side split. LIVE, neutralised.
//   newGroup{Left,Right,Above,Below}                    -> f1-only, no keybinding -> command palette is neutralised -> already dead.
//   {move,copy}EditorGroupToNewWindow, restoreEditors…  -> no keybinding -> already dead.
// (copyEditorToNewWindow's Cmd+K O is an editor-into-window move, not a shell split-group, and is left as-is.)
const NEUTRALISED_SPLIT_CHORDS: readonly IKeybindings[] = [
	{ primary: KeyChord(KeyMod.CtrlCmd | KeyCode.KeyK, KeyMod.CtrlCmd | KeyCode.Backslash) },					// splitEditor Left/Right/Up/Down/Orthogonal -> new group
	{ primary: KeyChord(KeyMod.CtrlCmd | KeyCode.KeyK, KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.Backslash) },		// splitEditorInGroup / toggleSplitEditorInGroup
];
for (const chord of NEUTRALISED_SPLIT_CHORDS) {
	KeybindingsRegistry.registerKeybindingRule({ id: 'noop', weight: 1000, when: undefined, ...chord });
}

// --- Cmd/Ctrl+P document switcher (issue #212) ---
// The core patch stripped Cmd+P from workbench.action.quickOpen (Seam 4) and the calm-shell chord neutralisation
// above does not claim it, so Cmd/Ctrl+P is a FREE chord. We bind it to a livingDocs-owned command via the public
// KeybindingsRegistry - zero core patch (check-seams Seam 4 only guards the two core files) - that opens an
// MRU-ranked quick pick of the folder's documents (docQuickSwitch.ts). Weight 1000 matches the chord-shadow tier
// so the binding wins resolution over any residual core/extension claim. Cmd+O is bound as a FALLBACK for the
// document-editor (ProseMirror webview) surface, which can swallow a bare Cmd+P before it reaches the workbench.
KeybindingsRegistry.registerCommandAndKeybindingRule({
	id: 'livingDocs.quickSwitchDoc',
	weight: 1000,
	when: undefined,
	primary: KeyMod.CtrlCmd | KeyCode.KeyP,
	secondary: [KeyMod.CtrlCmd | KeyCode.KeyO],
	handler: accessor => void accessor.get(IInstantiationService).invokeFunction(openDocQuickSwitch),
});

// --- editor pane ---
Registry.as<IEditorPaneRegistry>(EditorExtensions.EditorPane).registerEditorPane(
	EditorPaneDescriptor.create(LivingDocEditor, LivingDocEditor.ID, localize('livingDocEditor', "Living Document")),
	[new SyncDescriptor(LivingDocEditorInput)]
);

// The source-viewer pane (pin 7 / P7.4): a source opened from the tree SOURCES rows (or, plan 49, the
// Knowledge table) renders here as a product tab on the same strip as the document.
Registry.as<IEditorPaneRegistry>(EditorExtensions.EditorPane).registerEditorPane(
	EditorPaneDescriptor.create(LivingDocSourceEditor, LivingDocSourceEditor.ID, localize('livingDocSourceEditor', "Source")),
	[new SyncDescriptor(LivingDocSourceInput)]
);

// The source-viewer input has no editor-resolver (it opens by a typed input, not a resource), so it needs its
// own serializer to restore across a window reload (pin 7 / P7.7).
Registry.as<IEditorFactoryRegistry>(EditorExtensions.EditorFactory).registerEditorSerializer(LivingDocSourceInput.ID, LivingDocSourceInputSerializer);

// The main-area Abstract screens (Templates / Knowledge / Agents) share one webview editor.
Registry.as<IEditorPaneRegistry>(EditorExtensions.EditorPane).registerEditorPane(
	EditorPaneDescriptor.create(ScreenEditor, ScreenEditor.ID, localize('livingDocsScreen', "Abstract")),
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

// The comp's nav order is Home . Editor . Templates . Knowledge . Agents. Editor (order 2) is the
// document surface and is registered separately below (it opens a Living Document, not a screen);
// the screens carry orders 1/3/4/5 around it.
const SCREEN_NAV: readonly IScreenNavEntry[] = [
	{ screen: 'home', containerId: 'workbench.viewContainer.livingDocs.home', viewId: 'workbench.view.livingDocs.home', title: 'Home', icon: Codicon.home, order: 1 },
	{ screen: 'templates', containerId: 'workbench.viewContainer.livingDocs.templates', viewId: 'workbench.view.livingDocs.templates', title: 'Templates', icon: Codicon.layout, order: 3 },
	{ screen: 'knowledge', containerId: 'workbench.viewContainer.livingDocs.knowledge', viewId: 'workbench.view.livingDocs.knowledge', title: 'Knowledge', icon: Codicon.library, order: 4 },
	{ screen: 'agents', containerId: 'workbench.viewContainer.livingDocs.agents', viewId: 'workbench.view.livingDocs.agents', title: 'Agents', icon: Codicon.sync, order: 5 },
];

for (const entry of SCREEN_NAV) {
	const icon = registerIcon(`living-docs-${entry.screen}`, entry.icon, localize('livingDocs.screenIcon', "Abstract {0}", entry.title));
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
				category: localize2('livingDocs.category', "Abstract"),
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

// Cross-document review (C5, plan 24) is a project-scale destination reached FROM a project-wide run, not
// a top-level nav item, so it is not in SCREEN_NAV. Register a palette command to open it directly - the
// real in-product entry (the fan-out's "Review across the project ->") is wired in plan 24.3.
registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'livingDocs.open.review-project',
			title: localize2('livingDocs.openReviewProject', "Review Across the Project"),
			category: localize2('livingDocs.category', "Abstract"),
			f1: true,
		});
	}
	override async run(accessor: ServicesAccessor): Promise<void> {
		const editorService = accessor.get(IEditorService);
		const instantiationService = accessor.get(IInstantiationService);
		await editorService.openEditor(instantiationService.createInstance(ScreenEditorInput, 'review-project'), { pinned: true });
	}
});

// Model access (plan 35 iter 4): the provider picker + onboarding survey. It is a Settings destination, not a
// top-level nav item, so it is reached by this palette command ("Model Access") and by the first-run step
// below. The screen shows which door serves you, today's included usage, "Sign in with ChatGPT" (primary) /
// "Use the included model" (secondary), and the three survey questions.
registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'livingDocs.open.settings',
			title: localize2('livingDocs.openModelAccess', "Model Access"),
			category: localize2('livingDocs.category', "Abstract"),
			f1: true,
		});
	}
	override async run(accessor: ServicesAccessor): Promise<void> {
		const editorService = accessor.get(IEditorService);
		const instantiationService = accessor.get(IInstantiationService);
		await editorService.openEditor(instantiationService.createInstance(ScreenEditorInput, 'settings'), { pinned: true });
	}
});

// The D26 onboarding walkthrough (doc 20 section D26): the two-wow, ten-minute path. It opens automatically on
// a fresh profile (the first-run step below); this palette command ("Onboarding") reopens it any time so a
// returning user can revisit the demo, the provenance peek and the single-diff iteration.
registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'livingDocs.open.onboarding',
			title: localize2('livingDocs.openOnboarding', "Onboarding"),
			category: localize2('livingDocs.category', "Abstract"),
			f1: true,
		});
	}
	override async run(accessor: ServicesAccessor): Promise<void> {
		const editorService = accessor.get(IEditorService);
		const instantiationService = accessor.get(IInstantiationService);
		await editorService.openEditor(instantiationService.createInstance(ScreenEditorInput, 'onboarding'), { pinned: true });
	}
});

// --- the "Editor" nav item (order 2, first after Home) ---
// Unlike the screens above, Editor opens the actual document surface: the active/last Living Document,
// or the first document in the folder (D25-B, see editorNavLauncherView.ts). It is an activity-bar
// container + slim launcher view (same icon-nav mechanics as the screens) plus a palette command.
// ADDITIVE-CONTRIBUTION (merge-tax ledger): no core edit; the 76px labeled bar is the pre-existing
// activity-bar width patch (v2 iter 9) + the studio.css label layer.
const EDITOR_NAV_CONTAINER_ID = 'workbench.viewContainer.livingDocs.editor';
const EDITOR_NAV_VIEW_ID = 'workbench.view.livingDocs.editor';
const editorNavIcon = registerIcon('living-docs-editor', Codicon.edit, localize('livingDocs.editorIcon', "Abstract {0}", 'Editor'));
const editorNavContainer = Registry.as<IViewContainersRegistry>(ViewExtensions.ViewContainersRegistry).registerViewContainer({
	id: EDITOR_NAV_CONTAINER_ID,
	title: { value: 'Editor', original: 'Editor' },
	icon: editorNavIcon,
	ctorDescriptor: new SyncDescriptor(ViewPaneContainer, [EDITOR_NAV_CONTAINER_ID, { mergeViewWithContainerWhenSingleView: true }]),
	storageId: EDITOR_NAV_CONTAINER_ID,
	hideIfEmpty: false,
	order: 2,
}, ViewContainerLocation.Sidebar);

Registry.as<IViewsRegistry>(ViewExtensions.ViewsRegistry).registerViews([{
	id: EDITOR_NAV_VIEW_ID,
	name: { value: 'Editor', original: 'Editor' },
	containerIcon: editorNavIcon,
	ctorDescriptor: new SyncDescriptor(EditorNavLauncherView),
	canToggleVisibility: false,
	canMoveView: false,
}], editorNavContainer);

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'livingDocs.open.editor',
			title: localize2('livingDocs.openScreen', "Open {0}", 'Editor'),
			category: localize2('livingDocs.category', "Abstract"),
			f1: true,
		});
	}
	override async run(accessor: ServicesAccessor): Promise<void> {
		await openEditorNavTarget(accessor, true);
	}
});

// --- first-run flow: launch reads as a document app, not an IDE ---
// The Welcome / Getting Started editor is the last IDE tell on launch. Close it so the workspace
// lands in the editor with a document open, not on a wizard. ADDITIVE-CONTRIBUTION (merge-tax ledger).
const WELCOME_INPUT_TYPE_ID = 'workbench.editors.gettingStartedInput';

// Plan 42 slice L1 (editor-first cold start): opening the app lands in the editor surface with a document open
// and focused -- never the Welcome walkthrough, never Home. With a folder, that is the most-recently-opened
// document, else the folder's first document, else a new untitled Markdown doc; with no folder, a blank untitled
// Markdown doc (the "Open a folder" affordance lives on the always-present Home nav item and the tree rail, so the
// user is never gated by a wizard). VS Code restores editors per-workspace natively, so this routing runs ONLY in
// the `editors.length === 0` branch -- a restored editor or a deep-link always wins. The walkthrough survives as a
// dismissible "See a 90-second demo" entry point on Home + first-run, reached through the palette / a Home card,
// never as a cold-start destination. The routing DECISION is the pure decideStartupRoute() (unit-tested); this
// contribution only gathers the facts and executes the chosen route.
// Restore the product-tab set per group across a window reload (plan 45 pin 7 / P7.7, persistence key spec 43
// section 3.5). VS Code's native editor restoration only reliably brings back the active editor for our webview
// pane family, so the persisted `livingDocs.v2.tabs.<groupId>` set (written by the tab strip) is the source of
// truth: on restore we re-open every persisted tab into its group, in order, and re-activate the persisted tab.
// Documents open by resource (the `*.md` resolver picks the LivingDocEditor); non-`.md` resources open as a
// source-viewer tab. A resource that no longer exists is skipped so a moved/renamed file never wedges restore.
class LivingDocsTabRestoreContribution extends Disposable implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.livingDocs.tabRestore';

	constructor(
		@IEditorGroupsService private readonly _editorGroups: IEditorGroupsService,
		@IEditorService private readonly _editorService: IEditorService,
		@IStorageService private readonly _storageService: IStorageService,
	) {
		super();
		// Gate strip persistence for the whole restore window BEFORE any pane mounts. Native editor restoration
		// brings a group back with only its active editor first; an un-gated strip would then overwrite the full
		// persisted set with that partial one. The gate protects the persisted keys so `_restore` can read the
		// intact set after `whenReady` (groups do not exist yet at this BlockRestore-phase construction).
		setTabRestoreInProgress(true);
		void this._restore();
	}

	private async _restore(): Promise<void> {
		try {
			await this._editorGroups.whenReady;
			for (const group of this._editorGroups.groups) {
				// The persisted set is still intact because the gate blocked every strip write during restore.
				const persisted = parsePersistedTabStrip(this._storageService.get(tabStripStorageKey(group.id), StorageScope.WORKSPACE));
				if (persisted.ids.length === 0) { continue; }
				for (const id of persisted.ids) {
					const resource = this._safeParse(id);
					if (!resource) { continue; }
					// Skip a tab native restore already brought back (avoid duplicating the active editor).
					if (group.editors.some(e => e.resource?.toString() === resource.toString())) { continue; }
					if (resource.path.toLowerCase().endsWith('.md')) {
						await this._editorService.openEditor({ resource, options: { pinned: true, inactive: true } }, group);
					} else {
						await this._editorService.openEditor(new LivingDocSourceInput(resource), { pinned: true, inactive: true }, group);
					}
				}
				// Re-activate the persisted active tab (last so it wins over the restore order).
				if (persisted.activeId) {
					const active = this._safeParse(persisted.activeId);
					const editor = active && group.editors.find(e => e.resource?.toString() === active.toString());
					if (editor) { await this._editorService.openEditor(editor, group); }
				}
			}
		} finally {
			// Restore done: strips may persist again, and the current (full) set is written back immediately.
			setTabRestoreInProgress(false);
			for (const group of this._editorGroups.groups) {
				const ids = group.editors.map(e => e.resource?.toString()).filter((s): s is string => !!s);
				if (ids.length > 0) {
					this._storageService.store(tabStripStorageKey(group.id), JSON.stringify({ ids, activeId: group.activeEditor?.resource?.toString() }), StorageScope.WORKSPACE, StorageTarget.MACHINE);
				}
			}
		}
	}

	private _safeParse(id: string): URI | undefined {
		try { return URI.parse(id); } catch { return undefined; }
	}
}
registerWorkbenchContribution2(LivingDocsTabRestoreContribution.ID, LivingDocsTabRestoreContribution, WorkbenchPhase.BlockRestore);

class StudioStartupContribution extends Disposable implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.livingDocs.studioStartup';

	constructor(
		@IEditorGroupsService private readonly _editorGroups: IEditorGroupsService,
		@IEditorService private readonly _editorService: IEditorService,
		@IWorkspaceContextService private readonly _workspace: IWorkspaceContextService,
		@IInstantiationService private readonly _instantiationService: IInstantiationService,
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
		// Cold-start landing: only when nothing was restored (a restored editor / deep-link wins natively).
		if (this._editorService.editors.length === 0) {
			void this._openStartupSurface();
		}
		// The two rails (tree-rail + review rail) are EDITOR companions, revealed + sized when the document editor
		// is the active surface (RailVisibilityContribution below). A folder now lands on Project Home (a full-width
		// screen with neither rail); the rails come up once the user opens a document from it. Because the
		// walkthrough demo no longer runs on entry, the review rail reflects only real pending work, never
		// left-over demo proposals.
	}

	// Execute the cold-start routing decision (map-D2, WP-H): a folder open (a project) lands on Project Home;
	// no folder lands on a blank untitled Markdown doc. Re-check `editors.length === 0` before the open so a
	// restored editor or a deep-link that arrived while we were deciding still wins.
	private async _openStartupSurface(): Promise<void> {
		const state = this._workspace.getWorkbenchState();
		const hasFolder = state === WorkbenchState.FOLDER || state === WorkbenchState.WORKSPACE;
		const route = decideStartupRoute({ hasFolder });
		if (this._editorService.editors.length !== 0) {
			return;
		}
		if (route.kind === StartupRouteKind.OpenHome) {
			// Project Home: the project's front door (what ran, what's stale, recent files; the empty-project
			// front door when the folder has no documents yet). The editor is one click deeper, via a file.
			const input = this._instantiationService.createInstance(ScreenEditorInput, 'home');
			const pane = await this._editorService.openEditor(input, { pinned: true });
			// Singleton input: if the service adopted a different instance (or none), dispose ours to avoid a leak.
			if (pane?.input !== input) {
				input.dispose();
			}
			return;
		}
		// No folder: a new, blank untitled Markdown document so the cursor lands in editable text (zero-ceremony
		// plain Markdown -- no living-doc artefacts until an agent touches it). The "Open a folder" affordance
		// stays one click away on the Home nav item; never a wizard.
		await this._editorService.openEditor({ resource: undefined, languageId: 'markdown', options: { pinned: true } });
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

// --- rails are editor companions (Part C1 / shell) ---
// The tree-rail (SIDEBAR_PART, 264px: Files / Context / Outline / Search) and the review rail
// (AUXILIARYBAR_PART, 392px: Chat / Review / History) are companions to the DOCUMENT being edited,
// not global chrome. They belong to the editor surface only; the screen surfaces (Home / Templates /
// Knowledge / Agents, and the project-run / review-project screens) are full-width with neither rail.
// The rails stay collapsible on the editor surface -- this only asserts the default when CROSSING
// between a screen and the editor, so a user who pops a rail closed while editing keeps it closed as
// they move document to document. The 76px labeled nav (ACTIVITYBAR_PART) is intentionally NOT touched
// here: it is how you move between surfaces. ADDITIVE-CONTRIBUTION (our-surface, no core patch): it
// only reads the active editor and toggles part visibility via IWorkbenchLayoutService.
//
// (issue #173) The rail WIDTHS (264/392) are a FIRST-RUN default only, seeded once per profile. After
// that the sashes are draggable (the global sash lock is gone) and the workbench persists whatever the
// user drags natively, so we never re-pin -- doing so would clobber the user's chosen width on every
// screen->editor crossing. The part-level minimum widths (170px, stock) keep the rails usable.
//
// (plan 42 slice L4 - quiet shell on entry) The LEFT rail (tree-rail) always comes up on the editor
// surface as above. The RIGHT rail (review rail) is now QUIET on entry: it starts collapsed when it has
// nothing to say (no pending review, no chat history for the document), and opens only when it does.
// It still expands automatically on first AI invocation and when a review arrives -- those paths run
// through LivingDocsService.focusPanel() -> IViewsService.openView(), which un-hides the part -- so no
// extra wiring is needed for auto-expand; this contribution only sets the DEFAULT on entry and records
// the user's MANUAL choice so it wins on the next crossing and across restart. A slim edge affordance
// (RailAffordanceContribution below) keeps the AI door one click away while collapsed.
//
// The RECORDING RULE (plan 42 slice L4, fix-round for defect 1): a manual choice is recorded ONLY by an
// explicit gesture on the rail itself. Every focusPanel-driven reveal -- the edge affordance, an AI
// invocation, the L2 held-prompt, a proposal arriving -- is a PEEK: it fires onDidRequestPanel, which we
// guard so the openView-driven visibility change is not mistaken for a deliberate `open`. The sole
// recorder is the rail's calm collapse control (onDidRequestCollapseReviewRail -> `collapsed`). After the
// fix, NO UI gesture records `open`; that is intentional -- precedence still honours a stored `collapsed`,
// and the has-something-to-say default (chat history / pending review) covers the "opens on its own" cases.
// The decision itself is the pure decideReviewRailOpenOnEntry() (common/railVisibility.ts, unit-tested):
// a pending proposal ALWAYS forces the rail open (the agent-edit trust grammar is untouchable), then the
// manual choice, then the has-something-to-say default.
class RailVisibilityContribution extends Disposable implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.livingDocs.railVisibility';
	// Set once the first-run 264 sidebar / 392 review default has been seeded; afterwards the user's
	// persisted width wins. The review width seeds independently (below) since the review rail can start
	// collapsed, so its width must be seeded the first time it actually opens, not on the first doc entry.
	static readonly RAIL_WIDTHS_SEEDED_KEY = 'livingDocs.railWidthsSeeded';
	static readonly REVIEW_WIDTH_SEEDED_KEY = 'livingDocs.reviewWidthSeeded';
	// The per-workspace rail collapse state (plan 43 section 3.5, plan 44-b P2.4). WORKSPACE scope /
	// MACHINE target: this is per-workspace UI state that survives reload but does not roam. Presence
	// records an EXPLICIT user choice; an unset key means "no choice yet" (the tree rail then defaults
	// open, the right rail falls back to the quiet-shell has-something-to-say rule). These keys are the
	// single source of truth for the user's explicit collapse choice, superseding the old profile-scoped
	// `livingDocs.reviewRailManualChoice` (migrated on first read below).
	static readonly TREE_RAIL_COLLAPSED_KEY = 'livingDocs.v2.treeRailCollapsed';
	static readonly RIGHT_RAIL_COLLAPSED_KEY = 'livingDocs.v2.rightRailCollapsed';
	// The legacy profile-scoped review-rail choice (plan 42 L4). Read once and migrated into
	// RIGHT_RAIL_COLLAPSED_KEY so there is only one source of truth; never written again.
	private static readonly LEGACY_REVIEW_RAIL_CHOICE_KEY = 'livingDocs.reviewRailManualChoice';
	private static readonly DEFAULT_SIDEBAR_WIDTH = 264;
	private static readonly DEFAULT_AUXILIARYBAR_WIDTH = 392;

	private _lastKind: 'doc' | 'screen' | undefined;
	// True while THIS contribution is toggling the review-rail part, so the resulting part-visibility
	// event is not mistaken for a user's manual open/collapse.
	private _programmaticReviewToggle = false;
	// True while THIS contribution is toggling the tree-rail (SIDEBAR) part on sync, so the resulting
	// part-visibility event is not persisted as a user's manual collapse choice (plan 44-b P2.4).
	private _programmaticTreeToggle = false;
	// The single pending re-assert/seed timeout (replaced each sync so repeated editor changes never
	// accumulate disposables on the class store).
	private readonly _deferred = this._register(new MutableDisposable());
	// (plan 42 slice L4, defect 1) Every reveal driven by ILivingDocsService.focusPanel() -- the AI door
	// affordance, a chat send, the L2 held-prompt, a proposal arriving -- fires onDidRequestPanel and then
	// un-hides the auxiliary bar via IViewsService.openView(). Those reveals are PEEKS, not decisions: only
	// an explicit collapse/expand gesture on the rail itself records a manual choice. openView un-hides the
	// part on a LATER microtask, so a synchronous flag would already be cleared; this clears the guard on a
	// deferred tick, after the peek's visibility event has been swallowed.
	private readonly _peekGuard = this._register(new MutableDisposable());

	constructor(
		@IEditorService private readonly _editorService: IEditorService,
		@IViewsService private readonly _viewsService: IViewsService,
		@IWorkbenchLayoutService private readonly _layoutService: IWorkbenchLayoutService,
		@IStorageService private readonly _storageService: IStorageService,
		@ILivingDocsService private readonly _livingDocs: ILivingDocsService,
	) {
		super();
		this._migrateLegacyReviewRailChoice();
		this._sync();
		this._register(this._editorService.onDidActiveEditorChange(() => this._sync()));
		// Record the user's manual open/collapse of either rail so it wins on the next entry AND across
		// reload (plan 44-b P2.4). Only a toggle the user made while ON the editor surface counts -- our own
		// programmatic toggles are flagged out, and toggles on a screen surface (where both rails are always
		// hidden) are ignored.
		this._register(this._layoutService.onDidChangePartVisibility(e => this._onPartVisibilityChange(e.partId, e.visible)));
		// (defect 1) A focusPanel-driven reveal is a PEEK: guard the visibility event it will raise so it is
		// not recorded as a manual `open`. onDidRequestPanel fires synchronously just before openView, whose
		// visibility change lands on a later tick, so hold the guard across one deferred tick.
		this._register(this._livingDocs.onDidRequestPanel(() => this._beginPeek()));
		// (defect 2) The rail's own calm collapse control: hide the part AND record `collapsed` as the manual
		// choice, so the quiet shell is restorable through the UI and the choice sticks (the counterpart to
		// the slim edge affordance, which only PEEKS the rail open).
		this._register(this._livingDocs.onDidRequestCollapseReviewRail(() => this._collapseReviewRailAsChoice()));
	}

	// Mark the imminent focusPanel-driven reveal as a peek: set the programmatic guard so the openView
	// visibility change is not recorded as a manual choice, then release it on the next tick.
	private _beginPeek(): void {
		this._programmaticReviewToggle = true;
		this._peekGuard.value = disposableTimeout(() => { this._programmaticReviewToggle = false; }, 0);
	}

	// The user activated the rail's calm collapse control: hide the part programmatically (so the resulting
	// visibility event is guarded out) and record the choice the pure rule assigns to this gesture
	// (`collapsed`). Keeping the classification in recordedChoiceForRailGesture() keeps the recording rule
	// unit-testable and single-sourced.
	private _collapseReviewRailAsChoice(): void {
		this._setReviewRailHidden(true);
		const choice = recordedChoiceForRailGesture(RailGesture.CollapseControl);
		if (choice === ReviewRailManualChoice.Collapsed) {
			this._storeRightRailCollapsed(true);
		}
	}

	// One-time migration (plan 44-b P2.4): fold the legacy profile-scoped `livingDocs.reviewRailManualChoice`
	// into the new per-workspace `livingDocs.v2.rightRailCollapsed`, then clear the legacy key so there is a
	// single source of truth. Only runs when the new key is unset (a genuine new choice must never be
	// clobbered by stale legacy state).
	private _migrateLegacyReviewRailChoice(): void {
		if (this._storageService.getBoolean(RailVisibilityContribution.RIGHT_RAIL_COLLAPSED_KEY, StorageScope.WORKSPACE) !== undefined) {
			return;
		}
		const legacy = this._storageService.get(RailVisibilityContribution.LEGACY_REVIEW_RAIL_CHOICE_KEY, StorageScope.PROFILE);
		if (legacy === ReviewRailManualChoice.Open || legacy === ReviewRailManualChoice.Collapsed) {
			this._storeRightRailCollapsed(legacy === ReviewRailManualChoice.Collapsed);
		}
		this._storageService.remove(RailVisibilityContribution.LEGACY_REVIEW_RAIL_CHOICE_KEY, StorageScope.PROFILE);
	}

	// Persist an explicit right-rail collapse choice per-workspace (plan 43 section 3.5 key). WORKSPACE /
	// MACHINE: survives reload, does not roam. Presence of the key records that the user has chosen.
	private _storeRightRailCollapsed(collapsed: boolean): void {
		this._storageService.store(RailVisibilityContribution.RIGHT_RAIL_COLLAPSED_KEY, collapsed, StorageScope.WORKSPACE, StorageTarget.MACHINE);
	}

	// Persist an explicit tree-rail collapse choice per-workspace (plan 43 section 3.5 key, P2.4).
	private _storeTreeRailCollapsed(collapsed: boolean): void {
		this._storageService.store(RailVisibilityContribution.TREE_RAIL_COLLAPSED_KEY, collapsed, StorageScope.WORKSPACE, StorageTarget.MACHINE);
	}

	private _surfaceKind(): 'doc' | 'screen' {
		// The editor surface is any open Living Document (living or plain .md); everything else -- the
		// ScreenEditor screens and the no-editor case -- is a screen surface.
		return this._editorService.activeEditor instanceof LivingDocEditorInput ? 'doc' : 'screen';
	}

	private _onPartVisibilityChange(partId: string, visible: boolean): void {
		if (this._surfaceKind() !== 'doc') {
			return;
		}
		// A genuine user toggle of the TREE rail while editing (NOT a programmatic sync): persist the
		// collapse choice per-workspace so it survives reload (plan 44-b P2.4). The header's left toggle,
		// the Cmd+\ chord and Cmd+B all route through toggleSidebarVisibility, so every user gesture lands
		// here as a SIDEBAR visibility flip.
		if (partId === Parts.SIDEBAR_PART) {
			if (!this._programmaticTreeToggle) {
				this._storeTreeRailCollapsed(!visible);
			}
			return;
		}
		if (partId !== Parts.AUXILIARYBAR_PART || this._programmaticReviewToggle) {
			return;
		}
		// A genuine user toggle of the review rail while editing (NOT a programmatic sync and NOT a guarded
		// focusPanel peek): persist it so it wins on the next entry and across reload (a pending review no
		// longer force-opens; the badge dot surfaces it, P2.5). In the calm shell the only such gesture is
		// the rail's own collapse control, which records `collapsed` directly; this remains the safety net
		// for any residual native hide/show gesture.
		this._storeRightRailCollapsed(!visible);
		if (visible) {
			// The user opened the rail: seed its default width if this is the first time it has ever opened.
			this._seedReviewWidthOnce();
		}
	}

	private _reviewRailManualChoice(): ReviewRailManualChoice {
		return reviewRailManualChoiceFromPersistedCollapse(
			this._storageService.getBoolean(RailVisibilityContribution.RIGHT_RAIL_COLLAPSED_KEY, StorageScope.WORKSPACE));
	}

	private _sync(): void {
		const kind = this._surfaceKind();
		if (kind === 'screen') {
			// A screen surface is always full-width: assert both rails hidden. Clicking a nav item is itself
			// an activity-bar action that re-opens the sidebar (the slim launcher bounces it to the Workspace
			// rail), so re-assert the hide on the next tick to win that race; otherwise the tree-rail lingers.
			this._lastKind = 'screen';
			const hide = () => {
				this._setTreeRailHidden(true);
				this._setReviewRailHidden(true);
			};
			hide();
			this._deferred.value = disposableTimeout(hide, 0);
			return;
		}
		// kind === 'doc': only assert the rail defaults when CROSSING into the editor from a screen, so a user
		// who pops a rail closed (or open) while editing keeps that choice as they move document to document.
		if (this._lastKind === 'doc') {
			return;
		}
		this._lastKind = 'doc';
		// The left tree-rail opens by default on the editor surface UNLESS the user has explicitly collapsed
		// it (persisted per-workspace, plan 44-b P2.4). Respect the stored choice instead of force-showing.
		const treeHidden = treeRailHiddenOnEntry(
			this._storageService.getBoolean(RailVisibilityContribution.TREE_RAIL_COLLAPSED_KEY, StorageScope.WORKSPACE));
		this._setTreeRailHidden(treeHidden);
		if (!treeHidden) {
			void this._viewsService.openView(DOCUMENTS_VIEW_ID, false);
		}
		// The right review rail is quiet on entry: open it only when the pure decision says so -- a pending
		// proposal forces it (trust grammar), else the user's stored manual choice, else has-something-to-say.
		const activeResource = this._editorService.activeEditor?.resource;
		const openReview = decideReviewRailOpenOnEntry({
			hasPendingReview: activeResource ? this._livingDocs.getPendingForDoc(activeResource).length > 0 : this._livingDocs.getAllPending().length > 0,
			hasChatHistory: activeResource ? this._livingDocs.getChatMessages(activeResource).length > 0 : false,
			manualChoice: this._reviewRailManualChoice(),
		});
		this._setReviewRailHidden(!openReview);
		if (openReview) {
			// Reveal the review rail without stealing focus; seed its width the first time it opens.
			void this._viewsService.openView(REVIEW_RAIL_VIEW_ID, false);
			this._seedReviewWidthOnce();
		}
		this._seedSidebarWidthOnce();
	}

	// Toggle the tree-rail (SIDEBAR) part while flagging the change as programmatic, so the resulting
	// part-visibility event is not persisted as a user's manual collapse choice (plan 44-b P2.4).
	private _setTreeRailHidden(hidden: boolean): void {
		if (this._layoutService.isVisible(Parts.SIDEBAR_PART, mainWindow) === !hidden) {
			return;
		}
		this._programmaticTreeToggle = true;
		try {
			this._layoutService.setPartHidden(hidden, Parts.SIDEBAR_PART);
		} finally {
			this._programmaticTreeToggle = false;
		}
	}

	// Toggle the review-rail part while flagging the change as programmatic, so the resulting
	// part-visibility event is not recorded as a user's manual choice.
	private _setReviewRailHidden(hidden: boolean): void {
		if (this._layoutService.isVisible(Parts.AUXILIARYBAR_PART, mainWindow) === !hidden) {
			return;
		}
		this._programmaticReviewToggle = true;
		try {
			this._layoutService.setPartHidden(hidden, Parts.AUXILIARYBAR_PART);
		} finally {
			this._programmaticReviewToggle = false;
		}
	}

	// Seed the 264 tree-rail width ONCE per profile. After the first run the sash is draggable and the
	// workbench persists the user's chosen width, so we must not re-apply the default (that would clobber a
	// dragged width every time the user crosses from a screen back into the editor -- issue #173).
	private _seedSidebarWidthOnce(): void {
		if (this._storageService.getBoolean(RailVisibilityContribution.RAIL_WIDTHS_SEEDED_KEY, StorageScope.PROFILE, false)) {
			return;
		}
		const seed = () => {
			try {
				this._layoutService.setSize(Parts.SIDEBAR_PART, { width: RailVisibilityContribution.DEFAULT_SIDEBAR_WIDTH, height: this._layoutService.getSize(Parts.SIDEBAR_PART).height });
			} catch (e) { /* layout not ready in some hosts; the config default width still applies */ }
		};
		this._deferred.value = disposableTimeout(seed, 0);
		seed();
		this._storageService.store(RailVisibilityContribution.RAIL_WIDTHS_SEEDED_KEY, true, StorageScope.PROFILE, StorageTarget.MACHINE);
	}

	// Seed the 392 review-rail width ONCE per profile, the first time the rail actually opens. Because the
	// rail can start collapsed (quiet shell), its width cannot be seeded on first doc entry -- setSize is a
	// no-op while a part is hidden -- so this runs from the open paths (#173: never re-pin a dragged width).
	private _seedReviewWidthOnce(): void {
		if (this._storageService.getBoolean(RailVisibilityContribution.REVIEW_WIDTH_SEEDED_KEY, StorageScope.PROFILE, false)) {
			return;
		}
		const seed = () => {
			try {
				this._layoutService.setSize(Parts.AUXILIARYBAR_PART, { width: RailVisibilityContribution.DEFAULT_AUXILIARYBAR_WIDTH, height: this._layoutService.getSize(Parts.AUXILIARYBAR_PART).height });
			} catch (e) { /* layout not ready in some hosts; the config default width still applies */ }
		};
		this._deferred.value = disposableTimeout(seed, 0);
		seed();
		this._storageService.store(RailVisibilityContribution.REVIEW_WIDTH_SEEDED_KEY, true, StorageScope.PROFILE, StorageTarget.MACHINE);
	}
}
registerWorkbenchContribution2(RailVisibilityContribution.ID, RailVisibilityContribution, WorkbenchPhase.AfterRestored);

// --- the slim "AI door" affordance while the review rail is collapsed (plan 42 slice L4) ---
// When the quiet shell starts (or the user collapses) the review rail, the native way back -- the
// auxiliary bar's own activity strip -- disappears with the part, and the toggle chord is neutralised
// in the calm shell (NEUTRALISED_IDE_CHORDS above). So the AI door would be more than one click away.
// This contribution keeps it ONE click away: a slim edge tab pinned to the right edge of the editor
// area, shown only while editing a document AND the review rail is collapsed, that opens the Chat tab
// (focused) in one click. ADDITIVE-CONTRIBUTION (our-surface, no core patch): it appends its own element
// to the editor part container and toggles part visibility via ILivingDocsService.focusPanel(); the
// `.style-override .lwd-rail-affordance` CSS in studio.css paints it.
class RailAffordanceContribution extends Disposable implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.livingDocs.railAffordance';

	private _tab: HTMLElement | undefined;
	private readonly _tabStore = this._register(new MutableDisposable<DisposableStore>());

	constructor(
		@IEditorService private readonly _editorService: IEditorService,
		@IWorkbenchLayoutService private readonly _layoutService: IWorkbenchLayoutService,
		@ILivingDocsService private readonly _livingDocs: ILivingDocsService,
		@IHoverService private readonly _hoverService: IHoverService,
	) {
		super();
		this._update();
		this._register(this._editorService.onDidActiveEditorChange(() => this._update()));
		this._register(this._layoutService.onDidChangePartVisibility(e => {
			if (e.partId === Parts.AUXILIARYBAR_PART) {
				this._update();
			}
		}));
	}

	private _isDocSurface(): boolean {
		return this._editorService.activeEditor instanceof LivingDocEditorInput;
	}

	private _update(): void {
		// Show the affordance only while a document is open AND the review rail is collapsed.
		const shouldShow = this._isDocSurface() && !this._layoutService.isVisible(Parts.AUXILIARYBAR_PART, mainWindow);
		if (!shouldShow) {
			this._tabStore.clear();
			this._tab = undefined;
			return;
		}
		if (this._tab) {
			return;
		}
		const editorContainer = this._layoutService.getContainer(mainWindow, Parts.EDITOR_PART);
		if (!editorContainer) {
			return;
		}
		const store = new DisposableStore();
		const label = localize("livingDocs.openAiRail", "Open Chat");
		const tab = append(editorContainer, $('button.lwd-rail-affordance', { 'aria-label': label, 'tabindex': '0' }));
		tab.appendChild($(ThemeIcon.asCSSSelector(Codicon.commentDiscussion)));
		store.add(this._hoverService.setupDelayedHover(tab, () => ({ content: label })));
		store.add(addDisposableListener(tab, 'click', () => this._livingDocs.focusPanel('chat')));
		store.add({ dispose: () => tab.remove() });
		this._tab = tab;
		this._tabStore.value = store;
	}
}
registerWorkbenchContribution2(RailAffordanceContribution.ID, RailAffordanceContribution, WorkbenchPhase.AfterRestored);

// --- the 48px Abstract header (plan 44-b, pins 1/2 + the header block) ---
// Renders the header DOM into the titlebar part container (decision 170: the titlebar is repurposed, not
// a new part). AfterRestored so the titlebar container exists; the contribution guards + rebuilds if the
// part is (re)created.
registerWorkbenchContribution2(AbstractHeaderContribution.ID, AbstractHeaderContribution, WorkbenchPhase.AfterRestored);

// --- active nav chip (Part C1) ---
// The comp marks the CURRENT surface with a white chip in the icon-nav. The activity bar's own
// `.checked` state tracks the active sidebar CONTAINER, but the living-docs nav items are slim
// launchers that open a screen / document in the editor and then bounce the sidebar back to the
// Workspace tree-rail -- so `.checked` is always Workspace and never lands on a visible nav item.
// The right signal is therefore the active EDITOR, not the active container. This contribution maps
// the active editor to its nav item and toggles an `lwd-nav-active` class on that item's action-item;
// studio.css paints the chip off that class. ADDITIVE-CONTRIBUTION (our-surface, no core patch): it
// only reads IEditorService + the activity-bar part container and toggles a class on existing DOM, it
// does not modify the activity bar part. NOTE: it addresses nav items by their `codicon-living-docs-<id>`
// label class (fragile if the icon ids change) because the activity bar exposes no per-item API; the DOM
// walk uses `element.children` (not the lint-banned query APIs). Re-pin if the icon ids move.
const NAV_ACTIVE_CLASS = 'lwd-nav-active';
const NAV_ITEM_CODICON_CLASS: Record<string, string> = {
	home: 'codicon-living-docs-home',
	editor: 'codicon-living-docs-editor',
	templates: 'codicon-living-docs-templates',
	knowledge: 'codicon-living-docs-knowledge',
	agents: 'codicon-living-docs-agents',
};

class ActiveNavChipContribution extends Disposable implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.livingDocs.activeNavChip';

	constructor(
		@IEditorService private readonly _editorService: IEditorService,
		@IWorkbenchLayoutService private readonly _layoutService: IWorkbenchLayoutService,
	) {
		super();
		this._sync();
		this._register(this._editorService.onDidActiveEditorChange(() => this._sync()));
	}

	private _activeNavId(): string | undefined {
		const active = this._editorService.activeEditor;
		if (active instanceof ScreenEditorInput) {
			// The 'home' screen maps to the Home nav item; the other screens map 1:1 by id.
			return active.screen;
		}
		if (active instanceof LivingDocEditorInput) {
			// Any open Living Document is the "Editor" surface.
			return 'editor';
		}
		return undefined;
	}

	private _sync(): void {
		const bar = this._layoutService.getContainer(mainWindow, Parts.ACTIVITYBAR_PART);
		if (!bar) {
			return;
		}
		const activeNavId = this._activeNavId();
		const activeCodicon = activeNavId ? NAV_ITEM_CODICON_CLASS[activeNavId] : undefined;
		const knownCodicons = new Set(Object.values(NAV_ITEM_CODICON_CLASS));
		// Walk the activity-bar part's descendants (via `children`, avoiding the fragile-selector query
		// APIs the house lint bans) and match each nav item by its `codicon-living-docs-<id>` label class
		// (the bar exposes no per-item API). Each label's `.action-item` ancestor carries the chip class.
		const visit = (element: Element): void => {
			for (const codicon of knownCodicons) {
				if (element.classList.contains(codicon)) {
					const item = element.closest('.action-item');
					if (item) {
						item.classList.toggle(NAV_ACTIVE_CLASS, codicon === activeCodicon);
					}
					break;
				}
			}
			for (let i = 0; i < element.children.length; i++) {
				visit(element.children[i]);
			}
		};
		visit(bar);
	}
}
registerWorkbenchContribution2(ActiveNavChipContribution.ID, ActiveNavChipContribution, WorkbenchPhase.AfterRestored);

// --- analytics Settings mirror (plan 36 iter 1; first-run dialog removed) ---
// Analytics is on by default: the `abstract.analytics.enabled` setting (default true) is the single visible
// control, and unticking it in Settings opts out at any time. There is no first-run consent dialog - on
// startup this contribution adopts the setting into the service, and thereafter keeps the two in step, so
// flipping the toggle enables/disables capture through the same one seam. This contribution is the ONLY
// caller of the consent API; the rest of the app captures through IAnalyticsService.
class AnalyticsConsentContribution extends Disposable implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.abstract.analyticsConsent';

	constructor(
		@IAnalyticsService private readonly _analytics: IAnalyticsService,
		@IConfigurationService private readonly _configuration: IConfigurationService,
		@IProductService private readonly _productService: IProductService,
	) {
		super();
		// Keep the service and the Settings toggle in step: the setting is the single source of truth the user
		// can always see, and a change there drives the service.
		this._register(this._configuration.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration('abstract.analytics.enabled')) {
				this._adoptSetting();
			}
		}));
		const firstOpen = !this._analytics.hasChosen;
		this._adoptSetting();
		// The first UI funnel event (doc 15 section 3.1): captured only when analytics is on (the service gates it).
		this._analytics.capture('app_opened', { version: this._productService.version, first_open: firstOpen });
	}

	private _adoptSetting(): void {
		const enabled = this._configuration.getValue<boolean>('abstract.analytics.enabled') === true;
		if (!this._analytics.hasChosen || enabled !== this._analytics.isEnabled) {
			this._analytics.setConsent(enabled);
		}
	}
}
registerWorkbenchContribution2(AnalyticsConsentContribution.ID, AnalyticsConsentContribution, WorkbenchPhase.AfterRestored);
