/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, addDisposableListener, append, clearNode } from '../../../../base/browser/dom.js';
import { safeSetInnerHtml } from '../../../../base/browser/domSanitize.js';
import { IAction, Separator, toAction } from '../../../../base/common/actions.js';
import { Disposable, DisposableStore } from '../../../../base/common/lifecycle.js';
import { URI } from '../../../../base/common/uri.js';
import { localize } from '../../../../nls.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { IContextMenuService } from '../../../../platform/contextview/browser/contextView.js';
import { IDialogService } from '../../../../platform/dialogs/common/dialogs.js';
import { IHoverService } from '../../../../platform/hover/browser/hover.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { IKeybindingService } from '../../../../platform/keybinding/common/keybinding.js';
import { IOpenerService } from '../../../../platform/opener/common/opener.js';
import { IQuickInputService } from '../../../../platform/quickinput/common/quickInput.js';
import { IThemeService } from '../../../../platform/theme/common/themeService.js';
import { IViewPaneOptions, ViewPane } from '../../../browser/parts/views/viewPane.js';
import { IViewDescriptorService } from '../../../common/views.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { IChatMessage, IChatStep, ILivingDocsService, IModelOption, ISkillCheck, ModelReadiness } from '../common/livingDocs.js';
import { bulkApproveConfirm, IProposedChange, reviewFraming } from '../common/livingDocsModel.js';
import { historyHtml } from './historyRender.js';
import { ScreenEditorInput } from './screenEditorInput.js';
import { ScreenId } from './screenRender.js';

type PanelTab = 'chat' | 'review' | 'history';

// The History body and the Document-Agents disclosure are built as pure HTML strings (historyHtml /
// checksDisclosureHtml) whose entire visual language is inline `style=` on `<button>`/`<span>`/`<div>`,
// with `data-*` hooks the click delegation reads. VS Code's Trusted Types CSP blocks a raw `innerHTML`
// assignment, so both go through `safeSetInnerHtml`, which sanitises then resets the node. The default
// allow-list keeps neither `<button>` nor `style`, so we augment both; `data-*` and `title` survive by
// default. All interpolated user content (titles, labels) is already `esc()`-escaped by the builders.
// Exported so the regression test (`reviewRailSanitize.test.ts`) exercises the REAL production config.
export const REVIEW_RAIL_HTML_SANITIZER = Object.freeze({
	allowedTags: { augment: ['button'] },
	allowedAttributes: { augment: ['style'] },
});

function esc(s: string): string {
	return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// How many Attach chips show before the "..." expander (#177). Four fits ~two lines in the 392px rail
// (Overview / Architecture / What we built / Learnings for the sample corpus) - the rest collapse away
// so the chat history reclaims the vertical space. Exported for the collapse-cap unit tests.
export const ATTACH_COLLAPSED_CAP = 4;

/**
 * Split the mentionable file list into the chips shown while collapsed and whether a "..." expander is
 * needed. When expanded (or when the list already fits the cap) every file is shown and no expander is
 * added. Pure so the cap behaviour can be unit-tested without any DOM.
 */
export function collapseAttachChips(files: readonly string[], expanded: boolean): { shown: readonly string[]; hasMore: boolean } {
	if (expanded || files.length <= ATTACH_COLLAPSED_CAP) {
		return { shown: files, hasMore: files.length > ATTACH_COLLAPSED_CAP };
	}
	return { shown: files.slice(0, ATTACH_COLLAPSED_CAP), hasMore: true };
}

// How many suggestions the caret-anchored @mention picker shows at once (#178). Kept short so the popup
// never overwhelms the 392px rail; the type-to-filter narrows the candidate set before this cap applies.
export const MENTION_PICKER_LIMIT = 8;

/**
 * Filter and rank mentionable files against the partial query typed after "@" (the query excludes the
 * "@"). A case-insensitive substring match; a prefix match ranks above a mid-string match, then shorter
 * names, then alphabetical - so "over" surfaces "overview" before "handover-notes". Returns at most
 * `limit` results. Pure so the ranking can be unit-tested without any DOM.
 */
export function filterMentions(files: readonly string[], query: string, limit: number = MENTION_PICKER_LIMIT): string[] {
	const q = query.toLowerCase();
	const scored: { file: string; rank: number }[] = [];
	for (const file of files) {
		const idx = file.toLowerCase().indexOf(q);
		if (idx < 0) { continue; }
		scored.push({ file, rank: idx === 0 ? 0 : 1 });
	}
	scored.sort((a, b) => a.rank - b.rank || a.file.length - b.file.length || a.file.localeCompare(b.file));
	return scored.slice(0, limit).map(s => s.file);
}

/**
 * The partial "@" mention the caret sits inside, or undefined when the caret is not in one. An active
 * mention starts at an "@" that is at the start of the text or preceded by whitespace, runs of non-space
 * characters up to the caret, and must not itself contain whitespace. Returns the "@" start index and the
 * query text after it (which may be empty right after typing "@"). Pure - drives both the picker's
 * filter and the token replacement below.
 */
export function activeMention(text: string, caret: number): { start: number; query: string } | undefined {
	const upto = text.slice(0, caret);
	const at = upto.lastIndexOf('@');
	if (at < 0) { return undefined; }
	if (at > 0 && !/\s/.test(text.charAt(at - 1))) { return undefined; }
	const query = upto.slice(at + 1);
	if (/\s/.test(query)) { return undefined; }
	return { start: at, query };
}

/**
 * Replace the partial "@query" the caret sits in with the chosen "@file" token, leaving the rest of the
 * text untouched. When the caret is not in a mention the token is appended at the caret. The token gets a
 * trailing space unless the following text already starts with whitespace (so we never double the
 * separator). Returns the new text and the caret offset just after the inserted token so the textarea
 * selection can be restored there. Pure so the text edit is unit-testable without a real textarea.
 */
export function replaceActiveMention(text: string, caret: number, file: string): { text: string; caret: number } {
	const active = activeMention(text, caret);
	const suffix = text.slice(caret);
	const token = `@${file}${/^\s/.test(suffix) ? '' : ' '}`;
	if (!active) {
		const before = text.slice(0, caret);
		const sep = before.length && !before.endsWith(' ') ? ' ' : '';
		return { text: `${before}${sep}${token}${suffix}`, caret: before.length + sep.length + token.length };
	}
	return { text: `${text.slice(0, active.start)}${token}${suffix}`, caret: active.start + token.length };
}

// The Studio right panel: the comp's exact Chat / Review / History 3-tab surface. Chat is the agent
// front door; Review shows the real pending meaning-changes (wired to approve/reject) AND the document
// checks (the skill graders, folded in here so the tab strip matches the comp - v3 iter 3); History is
// the version timeline (seeded from the real audit when present). Our own surface -- no core patch.
export class ReviewRailView extends ViewPane {

	private _root: HTMLElement | undefined;
	private _activeTab: PanelTab = 'review';
	private _stylesInjected = false;
	// The unsent composer text, kept across re-renders so a background refresh never eats a draft.
	private _chatDraft = '';
	// The Document-Agents section is relocated to an on-demand disclosure at the bottom of Review (the
	// "Workbench v2" comp drops the always-on panel; the agents stay reachable). Collapsed by default so the
	// Review tab matches the comp; this remembers the open/closed state across re-renders this session.
	private _checksExpanded = false;
	// Whether the Attach suggestion row is expanded to the full mentionable-file list (#177). Collapsed by
	// default each session so the chat history keeps the reclaimed room; a re-render preserves the choice.
	private _attachExpanded = false;
	// The live @mention picker for the current composer render (#178), or undefined while none is mounted.
	// Rebuilt each _renderChatComposer; the textarea input/keydown handlers reach it through this field.
	private _composerPicker: MentionPicker | undefined;
	private readonly _renderDisposables = this._register(new DisposableStore());
	// Plan 27 iter 3: the live streaming turn's DOM handles, so a delta event appends token-by-token
	// WITHOUT a full re-render (which would reset the scroll position and the composer caret). Rebuilt each
	// time _renderChat runs; the doc key guards against a stale delta from a document no longer in view.
	private _streamScroll: HTMLElement | undefined;
	private _streamBody: HTMLElement | undefined;
	private _streamSteps: HTMLElement | undefined;
	private _streamCaret: HTMLElement | undefined;
	private _streamDoc: string | undefined;
	// Whether the model provider is signed in to ChatGPT (plan 38): when false, the composer shows one calm
	// line inviting sign-in for unlimited usage; it disappears once signed in. Fetched async from the live
	// provider status (the broker's /healthz) on first render and refreshed on onDidChange (which fires on a
	// sign-in/out). Undefined until the first fetch resolves, so nothing flashes before we know the truth.
	private _signedIn: boolean | undefined;
	// The truthful broker readiness (issue #170): the composer status line MUST reflect /healthz, never claim
	// "Using the included model" when the broker is down or no backend is wired. Undefined until first fetch.
	private _readiness: ModelReadiness | undefined;
	// The model picker (issue #179): the active backend's models and the selected id, fetched cheaply from the
	// service (which caches /models) and refreshed alongside the sign-in state. The composer renders a compact
	// dropdown from these; empty models -> no picker. Undefined until the first fetch resolves.
	private _models: readonly IModelOption[] | undefined;
	private _selectedModelId: string | undefined;

	constructor(
		options: IViewPaneOptions,
		@IKeybindingService keybindingService: IKeybindingService,
		@IContextMenuService contextMenuService: IContextMenuService,
		@IConfigurationService configurationService: IConfigurationService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IViewDescriptorService viewDescriptorService: IViewDescriptorService,
		@IInstantiationService instantiationService: IInstantiationService,
		@IOpenerService openerService: IOpenerService,
		@IThemeService themeService: IThemeService,
		@IHoverService hoverService: IHoverService,
		@ILivingDocsService private readonly _livingDocs: ILivingDocsService,
		@IEditorService private readonly _editors: IEditorService,
		@IDialogService private readonly _dialogService: IDialogService,
		@IQuickInputService private readonly _quickInput: IQuickInputService,
	) {
		super(options, keybindingService, contextMenuService, configurationService, contextKeyService, viewDescriptorService, instantiationService, openerService, themeService, hoverService);
	}

	// The Review tab grades the active document (the checks section), so re-render when the active
	// editor changes.
	private _activeDoc(): URI | undefined {
		// Chat (and the rail) are available on EVERY open document (decision 48), not just living ones -
		// "living" is a data-binding badge, not a chat gate. The Skills/checks section stays tied to real
		// bindings via getSkillReport (which returns nothing for a plain doc), so a plain doc gets the chat
		// surface + any chat proposals without the source-bound affordances.
		const resource = this._editors.activeEditor?.resource;
		return resource && this._livingDocs.getDoc(resource) ? resource : undefined;
	}

	protected override renderBody(container: HTMLElement): void {
		super.renderBody(container);
		this._root = append(container, $('.living-docs-panel'));
		this._root.style.height = '100%';
		this._injectStyles(container);
		this._register(this._livingDocs.onDidChange(() => { void this._refreshSignedIn(); this._render(); }));
		// Append streamed chat deltas to the live turn without a full re-render (plan 27 iter 3).
		this._register(this._livingDocs.onDidStreamChat(resource => this._onStreamDelta(resource)));
		this._register(this._livingDocs.onDidRequestPanel(tab => { this._activeTab = tab; this._render(); }));
		this._register(this._livingDocs.onDidRequestChatAttach(file => this._attachToChatDraft(file)));
		this._register(this._editors.onDidActiveEditorChange(() => { if (this._activeTab === 'review' || this._activeTab === 'chat') { this._render(); } }));
		void this._refreshSignedIn();
		this._render();
	}

	// "Add to chat" from the Files tab (docs 20 section 1d, the 1m entry): append the file as an @mention
	// to the composer draft (de-duplicated) and show the Chat tab. focusPanel('chat') already switched the
	// tab; this seeds the draft and re-renders so the mention is visible for the user to send.
	private _attachToChatDraft(file: string): void {
		const mention = `@${file}`;
		if (!this._chatDraft.split(/\s+/).includes(mention)) {
			const sep = this._chatDraft.length && !this._chatDraft.endsWith(' ') ? ' ' : '';
			this._chatDraft = `${this._chatDraft}${sep}${mention} `;
		}
		this._activeTab = 'chat';
		this._render();
	}

	private _render(): void {
		const root = this._root;
		if (!root) { return; }
		this._renderDisposables.clear();
		clearNode(root);

		const pending = this._livingDocs.getAllPending();

		// --- tab strip ---
		const tabs = append(root, $('div.ldp-tabs'));
		const addTab = (tab: PanelTab, label: string, count?: number) => {
			const el = append(tabs, $(`button.ldp-tab${this._activeTab === tab ? '.active' : ''}`)) as HTMLButtonElement;
			el.textContent = label;
			if (count) {
				const badge = append(el, $('span.ldp-tab-count'));
				badge.textContent = `${count}`;
			}
			this._renderDisposables.add(addDisposableListener(el, 'click', () => {
				if (this._activeTab !== tab) { this._activeTab = tab; this._render(); }
			}));
		};
		addTab('chat', 'Chat');
		addTab('review', 'Review', pending.length);
		addTab('history', 'History');

		// --- content ---
		const content = append(root, $('div.ldp-content'));
		if (this._activeTab === 'chat') {
			this._renderChat(content, pending.length);
		} else if (this._activeTab === 'history') {
			this._renderHistory(content);
		} else {
			this._renderReview(content, pending);
		}
	}

	// Re-read the live provider status (the proxy's /healthz) and, if the signed-in state changed, re-render so
	// the composer's sign-in line appears/disappears. Kept resilient: a failed probe leaves the last known
	// state rather than flashing the invite off.
	private async _refreshSignedIn(): Promise<void> {
		try {
			const status = await this._livingDocs.getModelProviderStatus();
			// The model catalogue + selection for the picker (issue #179). Fetched from the service, which caches
			// /models, so this is cheap on a repeated render; only a real change (backend switch, first fetch, a new
			// selection) re-renders the composer. Read together with the status so one probe refreshes both.
			const models = await this._livingDocs.getModelCatalogue();
			const selected = await this._livingDocs.getSelectedModelId();
			const modelsChanged = JSON.stringify(this._models ?? null) !== JSON.stringify(models.models) || this._selectedModelId !== selected;
			if (this._signedIn !== status.signedIn || this._readiness !== status.readiness || modelsChanged) {
				this._signedIn = status.signedIn;
				this._readiness = status.readiness;
				this._models = models.models;
				this._selectedModelId = selected;
				this._render();
			}
		} catch {
			// Leave the last known state; the next onDidChange retries.
		}
	}

	// The composer status line (plan 38, doc 18 section 2.1) - now gated on the truthful broker readiness so it
	// NEVER claims a model is connected when it is not (issue #170). One calm line only (P7, no modal, no nag),
	// with a fix-it link that always opens the Model access screen:
	//   - broker-down / unconfigured -> "Model unavailable" (the model genuinely cannot answer);
	//   - budget-paused             -> "Daily limit reached" (the included tier's cap is spent for today);
	//   - ready + not signed in     -> "Using the included model · Sign in with ChatGPT for unlimited.";
	//   - signed in to ChatGPT      -> nothing (unlimited; no nag).
	private _renderSignInHint(footer: HTMLElement): void {
		// Undefined = not yet probed, so render nothing to avoid a flash before we know the truth.
		if (this._readiness === undefined) { return; }

		const openModelAccess = () => void this._openScreen('settings');

		// Model genuinely unavailable, or the day's included usage is spent: an honest state + a fix-it link.
		if (this._readiness === 'broker-down' || this._readiness === 'unconfigured' || this._readiness === 'budget-paused') {
			const row = append(footer, $('div'));
			row.style.cssText = 'display:flex;align-items:center;gap:6px;padding:0 2px 9px;font:400 11.5px/1.5 system-ui;color:#868b95';
			const dot = append(row, $('span'));
			const dotColour = this._readiness === 'budget-paused' ? '#e0b341' : '#d98a8a';
			dot.style.cssText = `width:6px;height:6px;flex:none;border-radius:50%;background:${dotColour}`;
			const text = append(row, $('span'));
			text.textContent = this._readiness === 'budget-paused' ? 'Daily limit reached · ' : 'Model unavailable · ';
			const link = append(text, $('button')) as HTMLButtonElement;
			link.style.cssText = 'border:none;background:transparent;padding:0;font:600 11.5px/1.5 system-ui;color:oklch(0.55 0.13 255);cursor:pointer';
			link.textContent = 'Open Model access';
			this._renderDisposables.add(addDisposableListener(link, 'click', openModelAccess));
			return;
		}

		// Ready. Only invite sign-in while signed OUT; once signed in to ChatGPT there is nothing to nag about.
		if (this._signedIn !== false) { return; }
		const row = append(footer, $('div'));
		row.style.cssText = 'display:flex;align-items:center;gap:6px;padding:0 2px 9px;font:400 11.5px/1.5 system-ui;color:#868b95';
		const dot = append(row, $('span'));
		dot.style.cssText = 'width:6px;height:6px;flex:none;border-radius:50%;background:#cdd1d8';
		const text = append(row, $('span'));
		text.textContent = 'Using the included model · ';
		const link = append(text, $('button')) as HTMLButtonElement;
		link.style.cssText = 'border:none;background:transparent;padding:0;font:600 11.5px/1.5 system-ui;color:oklch(0.55 0.13 255);cursor:pointer';
		link.textContent = 'Sign in with ChatGPT';
		this._renderDisposables.add(addDisposableListener(link, 'click', openModelAccess));
		const tail = append(text, $('span'));
		tail.textContent = ' for unlimited.';
	}

	// Open an Abstract screen (e.g. Model Access) without leaking the transient editor input. `ScreenEditorInput`
	// is a Singleton with a `matches` override, so when a screen is already open the editor service reuses the
	// existing editor and does NOT adopt the instance we created - leaving us the owner. We therefore dispose our
	// instance unless the resolved pane is actually backed by it. Mirrors the fire-and-forget open used elsewhere,
	// but closes the LEAKED DISPOSABLE the fire-and-forget form produced on a repeat open.
	private async _openScreen(screen: ScreenId): Promise<void> {
		const input = this.instantiationService.createInstance(ScreenEditorInput, screen);
		const pane = await this._editors.openEditor(input, { pinned: true });
		if (pane?.input !== input) {
			input.dispose();
		}
	}

	private _renderReview(content: HTMLElement, pending: readonly IProposedChange[]): void {
		// Group pending changes by the document they belong to.
		const groups = new Map<string, typeof pending[number][]>();
		for (const change of pending) {
			const list = groups.get(change.docTitle) ?? [];
			list.push(change);
			groups.set(change.docTitle, list);
		}

		const status = append(content, $('div.ldr-status'));
		status.textContent = pending.length
			? `${pending.length} change${pending.length > 1 ? 's' : ''} ${pending.length > 1 ? 'need' : 'needs'} approval across ${groups.size} document${groups.size > 1 ? 's' : ''}.`
			: 'No changes waiting. Open a Living Document and click "Refresh from sources".';

		for (const [docTitle, changes] of groups) {
			const group = append(content, $('div.ldr-group'));
			const docId = changes[0].docId;

			const groupHeader = append(group, $('div.ldr-group-head'));
			// The document title opens that document (so its inline diffs are visible), Cursor-style. The
			// whole label is the click target; the per-document Approve all / Reject all sit on the right.
			const titleBtn = append(groupHeader, $('button.ldr-group-title')) as HTMLButtonElement;
			titleBtn.title = `Open ${docTitle}`;
			const titleText = append(titleBtn, $('span'));
			titleText.textContent = docTitle;
			const count = append(titleBtn, $('span.ldr-group-count'));
			count.textContent = `${changes.length}`;
			this._renderDisposables.add(addDisposableListener(titleBtn, 'click', () => {
				void this._editors.openEditor({ resource: URI.parse(docId) });
			}));

			// The +N / -N line summary for the document, like Cursor's per-file changed-line count.
			const stat = this._diffStat(changes);
			const stats = append(groupHeader, $('span.ldr-group-stat'));
			const add = append(stats, $('span.ldr-stat-add'));
			add.textContent = `+${stat.added}`;
			const del = append(stats, $('span.ldr-stat-del'));
			del.textContent = `-${stat.removed}`;

			const groupActions = append(groupHeader, $('div.ldr-group-actions'));
			const approveAll = append(groupActions, $('button.ldr-group-btn.approve')) as HTMLButtonElement;
			approveAll.textContent = 'Approve all';
			this._renderDisposables.add(addDisposableListener(approveAll, 'click', async () => {
				// Bulk-approve safety net (plan 31 iter 4): confirm when the set includes any meaning change;
				// a version snapshot is taken first (plan 26). Figures-only bulk approves stay one-click.
				const confirm = bulkApproveConfirm(this._livingDocs.getPendingForDoc(URI.parse(docId)), true);
				if (confirm.needed) {
					const { confirmed } = await this._dialogService.confirm({ message: confirm.message, primaryButton: 'Approve all' });
					if (!confirmed) { return; }
				}
				await this._livingDocs.approveAll(docId);
				this._openNextPending(docId);
			}));
			const rejectAll = append(groupActions, $('button.ldr-group-btn')) as HTMLButtonElement;
			rejectAll.textContent = 'Reject all';
			this._renderDisposables.add(addDisposableListener(rejectAll, 'click', () => void this._livingDocs.rejectAll(docId)));

			for (const change of changes) {
				const card = append(group, $('div.ldr-card'));

				// The self-explaining framing (plan 31 iter 2): the same kind tag, confidence chip, rationale and
				// source chip the inline widget and cross-doc cards render, built from the one `reviewFraming`.
				const framing = reviewFraming(change, change.sourceCells.join(', '));

				const top = append(card, $('div.ldr-card-top'));
				const name = append(top, $('span.ldr-card-name'));
				name.textContent = change.blockLabel;
				const tag = append(top, $(framing.kindAttention ? 'span.ldr-tag.attn' : 'span.ldr-tag.ok'));
				tag.textContent = framing.kindLabel;

				const diff = append(card, $('div.ldr-diff'));
				// Click the diff to jump the editor to this change in full document context (navigate-only).
				diff.style.cursor = 'pointer';
				diff.title = 'Open in the document';
				this._renderDisposables.add(addDisposableListener(diff, 'click', () => void this._navigateToChange(change)));
				const o = append(diff, $('div.ldr-o'));
				o.textContent = change.oldText;
				const n = append(diff, $('div.ldr-n'));
				n.textContent = change.newText;

				// Rationale only when the model supplied one (no "AI suggested this" filler, plan 31 iter 2).
				if (framing.rationale) {
					const why = append(card, $('div.ldr-why'));
					why.textContent = `Why: ${framing.rationale}`;
				}

				const meta = append(card, $('div.ldr-meta'));
				const conf = append(meta, $(framing.confidence === 'inferred' ? 'span.ldr-conf.inferred' : 'span.ldr-conf.high'));
				conf.textContent = framing.confidenceLabel;
				const risk = append(meta, $('span'));
				risk.innerText = 'Risk: narrative';
				if (framing.sourceLabel) {
					const src = append(meta, $('span'));
					src.innerText = `Source: ${framing.sourceLabel}`;
				}

				const actions = append(card, $('div.ldr-actions'));
				const approve = append(actions, $('button.ldr-approve')) as HTMLButtonElement;
				approve.textContent = 'Approve & apply';
				this._renderDisposables.add(addDisposableListener(approve, 'click', () => this._livingDocs.approve(change.id)));
				const reject = append(actions, $('button.ldr-reject')) as HTMLButtonElement;
				reject.textContent = 'Reject';
				this._renderDisposables.add(addDisposableListener(reject, 'click', () => this._livingDocs.reject(change.id)));
			}
		}

		// Document agents (the skill graders) are relocated to an on-demand disclosure at the bottom of
		// Review (v4 iter 4): collapsed by default so the Review tab matches the comp, expandable to reach
		// the wired v1 agents (Run / Re-run / Apply fix). The disclosure only shows for a living document.
		this._appendChecks(content);
	}

	// Group pending changes by their document, preserving first-seen order, so the changed-docs list and
	// the review groups iterate documents consistently.
	private _groupByDoc(pending: readonly IProposedChange[]): Map<string, IProposedChange[]> {
		const groups = new Map<string, IProposedChange[]>();
		for (const change of pending) {
			const list = groups.get(change.docId) ?? [];
			list.push(change);
			groups.set(change.docId, list);
		}
		return groups;
	}

	// Navigate-only rail-to-editor jump (plan 19, E-A): open the change's document and ask its editor to
	// scroll to + flash that change's inline diff. Clicking a card body NEVER approves - the user reads the
	// change in full context and then approves wherever they like (the inline widget or the rail buttons).
	private async _navigateToChange(change: IProposedChange): Promise<void> {
		await this._editors.openEditor({ resource: URI.parse(change.docId) });
		this._livingDocs.focusChange(change.id);
	}

	// After a per-document "Approve all", open the next document that still has pending changes so the
	// user lands on the next set of diffs without hunting for it (Cursor-style step-through).
	private _openNextPending(approvedDocId: string): void {
		const next = this._livingDocs.getAllPending().find(c => c.docId !== approvedDocId);
		if (next) { void this._editors.openEditor({ resource: URI.parse(next.docId) }); }
	}

	// The +N / -N changed-line summary for a document's pending changes: newText lines added, oldText
	// lines removed (an insertion has no oldText, so it counts as pure additions).
	private _diffStat(changes: readonly IProposedChange[]): { added: number; removed: number } {
		const lines = (s: string) => s.trim() ? s.trim().split('\n').length : 0;
		let added = 0, removed = 0;
		for (const c of changes) { added += lines(c.newText); removed += lines(c.oldText); }
		return { added, removed };
	}

	// The truthful version timeline (plan 26 iter 3): real snapshots (restorable versions) interleaved with
	// the real audit entries recorded since each one, all read from THIS document's lock - never a fabricated
	// sample. The header is the live document title; a manual "Save version" takes a snapshot on demand; each
	// version row carries a quiet Restore that confirms then routes through the one restoreSnapshot path.
	private _renderHistory(content: HTMLElement): void {
		const resource = this._activeDoc();
		const doc = resource ? this._livingDocs.getDoc(resource) : undefined;
		const lock = resource ? this._livingDocs.getLock(resource) : undefined;
		const snapshots = resource ? this._livingDocs.getSnapshots(resource) : [];
		const audit = lock ? lock.audit : [];
		safeSetInnerHtml(content, historyHtml(snapshots, audit, doc?.title, doc?.fromTemplate), REVIEW_RAIL_HTML_SANITIZER);
		if (!resource) { return; }

		// Delegated click handling: "Save version" snapshots the current body under a user-supplied label;
		// each "Restore" confirms (native dialog) then routes through restoreSnapshot (the one approve path -
		// rejects pending, writes the body, audits it, re-flags staleness). No bypass write.
		this._renderDisposables.add(addDisposableListener(content, 'click', async e => {
			let el = e.target as HTMLElement | null;
			while (el && el !== content) {
				if (el.getAttribute('data-save-version') !== null) {
					const label = await this._quickInput.input({ prompt: 'Name this version', placeHolder: 'e.g. Before the board edits', value: '' });
					if (label && label.trim()) { await this._livingDocs.saveSnapshot(resource, label.trim(), 'manual'); }
					return;
				}
				const restoreId = el.getAttribute('data-restore');
				if (restoreId) {
					const snap = snapshots.find(s => s.id === restoreId);
					const { confirmed } = await this._dialogService.confirm({
						message: `Restore "${snap ? snap.label : 'this version'}"?`,
						detail: 'Replaces the current body. Pending changes will be rejected. This is recorded in the audit trail.',
						primaryButton: 'Restore',
					});
					if (confirmed) { await this._livingDocs.restoreSnapshot(resource, restoreId); }
					return;
				}
				// The feedback verb (doc 18 section 2.5): "this was wrong" on an applied change. Flag + optional
				// comment -> a consent-gated analytics event (a hashed ref only) + a founder-visible log line
				// (which keeps the comment). A thin version suffices: the comment prompt is optional (Escape = just
				// the flag). The change ref is the block id; the doc title labels the founder log.
				const wrong = el.getAttribute('data-wrong');
				if (wrong) {
					let parsed: { ref?: string; title?: string } | null;
					try { parsed = JSON.parse(wrong); } catch { return; }
					if (!parsed?.ref) { return; }
					const comment = await this._quickInput.input({
						prompt: localize('livingDocs.feedback.prompt', "What was wrong with this change? (optional - Enter to flag, Escape to cancel the note)"),
						placeHolder: localize('livingDocs.feedback.placeholder', "e.g. the figure is stale, or the wording changed the meaning"),
						value: '',
					});
					// Escape returns undefined (cancel the whole report); an empty string is a flag with no comment.
					if (comment === undefined) { return; }
					this._livingDocs.reportChangeWrong({ changeRef: parsed.ref, comment, docTitle: parsed.title ?? '' });
					this._dialogService.info(localize('livingDocs.feedback.confirmation', "Thanks - we log every \"this was wrong\" report and read them all."));
					return;
				}
				el = el.parentElement;
			}
		}));
	}

	private _appendChecks(parent: HTMLElement): void {
		const resource = this._activeDoc();
		// No living document open -> no agents affordance (the comp's Review tab shows only review content).
		if (!resource) { return; }
		const report = this._livingDocs.getSkillReport(resource);
		if (!report.length) { return; }
		const title = this._livingDocs.getDoc(resource)?.title;
		const flags = report.filter(s => s.status === 'flag').length;
		const section = append(parent, $('div.ldr-checks'));
		safeSetInnerHtml(section, checksDisclosureHtml(this._checksExpanded, flags, report, title), REVIEW_RAIL_HTML_SANITIZER);
		// The disclosure toggle relocates the agents off the always-on rail. "Run" / "Re-run" re-grade the
		// live document (Strategy calls the model via the proxy); "Apply fix" applies a skill's deterministic
		// edit (Formatting title-cases the flagged headings). All re-render when the service fires onDidChange.
		this._renderDisposables.add(addDisposableListener(section, 'click', e => {
			let el = e.target as HTMLElement | null;
			while (el && el !== section) {
				if (el.getAttribute('data-checks-toggle') !== null) {
					this._checksExpanded = !this._checksExpanded;
					this._render();
					return;
				}
				const fixId = el.getAttribute('data-skill-fix');
				if (fixId) {
					void this._livingDocs.applySkillFix(resource, fixId as ISkillCheck['id']);
					return;
				}
				const id = el.getAttribute('data-skill-run');
				if (id) {
					this._livingDocs.runSkillCheck(resource, id as ISkillCheck['id']);
					return;
				}
				el = el.parentElement;
			}
		}));
	}

	// The Chat tab is a real, model-backed agent surface: a scrolling conversation over the active
	// Living Document plus a live composer with @mention chips. Replies (and any prose edits the agent
	// proposes) come from livingDocsService.sendChatMessage; proposed edits land in the Review rail, so
	// "Approve all / Review each" keep working on them. Built as DOM (the rail is not a webview).
	private _renderChat(content: HTMLElement, pendingCount: number): void {
		const doc = this._activeDoc();
		// A full re-render throws away the previous live-turn nodes; clear the handles so a stale delta
		// event never writes into a detached node (they are reset below when a live turn is rendered).
		this._streamScroll = this._streamBody = this._streamSteps = this._streamCaret = undefined;
		this._streamDoc = undefined;
		content.style.cssText = 'display:flex;flex-direction:column;height:100%;padding:0';

		const scroll = append(content, $('div'));
		scroll.style.cssText = 'flex:1;min-height:0;overflow-y:auto;padding:14px 12px;display:flex;flex-direction:column;gap:16px';

		const messages = doc ? this._livingDocs.getChatMessages(doc) : [];
		if (!doc) {
			this._renderChatEmpty(scroll, 'Open a document in the editor to chat with its agent.');
		} else if (messages.length === 0) {
			this._renderChatEmpty(scroll, 'Ask the agent about this document, or @mention a source to pull it in.');
		} else {
			for (const m of messages) { this._renderChatMessage(scroll, m); }
		}

		if (doc && this._livingDocs.isChatBusy(doc)) {
			this._renderStreamingTurn(scroll, doc);
		}

		// The standing chat-level accept/reject summary: whenever changes are pending, the agent surfaces
		// one-tap controls that span the WHOLE working set (plan 18) - Accept all / Reject all every change
		// across every document at once, plus a way to step through them. (criterion 2 keeps these wired.)
		if (pendingCount > 0) {
			const pending = this._livingDocs.getAllPending();
			const docCount = new Set(pending.map(c => c.docId)).size;
			const summary = append(scroll, $('div'));
			summary.style.cssText = 'border:1px solid #e0e6ff;background:#f7f9ff;border-radius:10px;padding:11px 12px';
			const head = append(summary, $('div'));
			head.style.cssText = 'font:600 11.5px/1 system-ui;color:#3a3f49;margin-bottom:9px';
			head.textContent = docCount > 1
				? `${pendingCount} changes across ${docCount} documents`
				: `${pendingCount} change${pendingCount > 1 ? 's' : ''} waiting on you`;
			const actions = append(summary, $('div'));
			actions.style.cssText = 'display:flex;gap:7px';
			const acceptAll = append(actions, $('button')) as HTMLButtonElement;
			acceptAll.style.cssText = 'flex:1;border:none;border-radius:8px;padding:9px;background:oklch(0.55 0.13 255);color:#fff;font:600 12.5px/1 system-ui;cursor:pointer';
			// Span every document, not just the one in view (the chat instruction edited the whole set).
			acceptAll.textContent = docCount > 1 ? 'Accept all' : 'Approve all';
			this._renderDisposables.add(addDisposableListener(acceptAll, 'click', () => void this._livingDocs.approveAllPending()));
			const rejectAll = append(actions, $('button')) as HTMLButtonElement;
			rejectAll.style.cssText = 'border:1px solid #e7c9c6;border-radius:8px;padding:9px 12px;background:#fff;color:#b4332f;font:500 12.5px/1 system-ui;cursor:pointer';
			rejectAll.textContent = 'Reject all';
			this._renderDisposables.add(addDisposableListener(rejectAll, 'click', () => void this._livingDocs.rejectAllPending()));
			const reviewEach = append(actions, $('button')) as HTMLButtonElement;
			reviewEach.style.cssText = 'border:1px solid #d8e0fb;border-radius:8px;padding:9px 12px;background:#fff;color:oklch(0.5 0.13 255);font:500 12.5px/1 system-ui;cursor:pointer';
			reviewEach.textContent = 'Review each';
			this._renderDisposables.add(addDisposableListener(reviewEach, 'click', () => { this._activeTab = 'review'; this._render(); }));

			// Cursor-style changed-documents list: one row per changed doc with its +N/-N, clickable to open
			// that document (so its inline diffs show). Shown only when the change spans more than one doc.
			if (docCount > 1) {
				const list = append(summary, $('div'));
				list.style.cssText = 'margin-top:10px;border-top:1px solid #e4e9fb;padding-top:8px;display:flex;flex-direction:column;gap:2px';
				for (const [docId, changes] of this._groupByDoc(pending)) {
					const stat = this._diffStat(changes);
					const row = append(list, $('button')) as HTMLButtonElement;
					row.style.cssText = 'display:flex;align-items:center;gap:8px;border:none;background:transparent;padding:5px 4px;border-radius:6px;cursor:pointer;text-align:left;font:500 11.5px/1.2 system-ui;color:#3a3f49';
					row.title = `Open ${changes[0].docTitle}`;
					const nm = append(row, $('span'));
					nm.style.cssText = 'flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
					nm.textContent = `\u25A4 ${changes[0].docTitle}`;
					const st = append(row, $('span'));
					st.style.cssText = 'font:600 10px/1 ui-monospace,monospace;color:#868b95';
					st.textContent = `+${stat.added} -${stat.removed}`;
					const arrow = append(row, $('span'));
					arrow.style.cssText = 'color:#aab; font-size:12px';
					arrow.textContent = '→';
					this._renderDisposables.add(addDisposableListener(row, 'click', () => void this._editors.openEditor({ resource: URI.parse(docId) })));
				}
			}
		}

		this._renderChatComposer(content, doc);
	}

	private _renderChatEmpty(scroll: HTMLElement, text: string): void {
		const empty = append(scroll, $('div'));
		empty.style.cssText = 'margin:auto 0;text-align:center;font:400 12.5px/1.6 system-ui;color:#a3a8b2;padding:24px 8px';
		empty.textContent = text;
	}

	// The live assistant turn while a reply streams (plan 27 iter 3). Before the first delta there is no
	// prose yet, so the pulse-avatar + "Thinking" reads as alive (plan 16 iter 5); the first delta swaps
	// that for the growing prose trailed by a subtle blinking caret. Tool steps appear in their card as the
	// service settles them. The DOM handles are kept so onDidStreamChat appends without a full re-render.
	private _renderStreamingTurn(scroll: HTMLElement, doc: URI): void {
		const stream = this._livingDocs.getStreamingChat(doc);
		const text = stream?.text ?? '';
		const steps = stream?.steps ?? [];

		const row = append(scroll, $('div'));
		row.style.cssText = 'display:flex;gap:9px';
		const avatar = append(row, $('span.ldp-stream-avatar'));
		avatar.style.cssText = 'flex:none;width:24px;height:24px;border-radius:50%;background:oklch(0.55 0.13 255);color:#fff;font:600 12px/24px system-ui;text-align:center';
		if (!text) { avatar.style.animation = 'ldp-pulse 1.4s ease-in-out infinite'; }
		avatar.textContent = '\u273B';
		const col = append(row, $('div'));
		col.style.cssText = 'flex:1;min-width:0;display:flex;flex-direction:column;gap:10px';

		const stepsWrap = append(col, $('div'));
		this._appendStepsCard(stepsWrap, steps);

		const bodyWrap = append(col, $('p'));
		bodyWrap.style.cssText = 'margin:0;font:400 13.5px/1.6 system-ui;white-space:pre-wrap;color:#2c2f36';
		const bodyText = append(bodyWrap, $('span'));
		bodyText.textContent = text;
		if (!text) {
			// No delta yet: the calm "Thinking" hint (swapped out on the first delta by _onStreamDelta).
			const hint = append(bodyWrap, $('span.ldp-busy-label'));
			hint.textContent = 'Thinking';
			append(hint, $('span.ldp-busy-dots'));
		}
		const caret = append(bodyWrap, $('span.ldp-caret'));
		caret.style.display = text ? 'inline-block' : 'none';

		this._streamScroll = scroll;
		this._streamBody = bodyText;
		this._streamSteps = stepsWrap;
		this._streamCaret = caret;
		this._streamDoc = doc.toString();
	}

	// Append a delta to the live turn in place (plan 27 iter 3). On the FIRST delta the structure switches
	// from the "Thinking" pulse to the caret form, so a single full re-render lands the new shape; every
	// later delta is a cheap text write + steps refresh, keeping the scroll and the composer caret intact.
	private _onStreamDelta(resource: URI): void {
		if (this._activeTab !== 'chat' || this._streamDoc !== resource.toString()) { return; }
		const stream = this._livingDocs.getStreamingChat(resource);
		if (!stream) { return; }
		// The pulse -> caret switch is a structural change; re-render once so the live turn takes its streamed shape.
		if (!this._streamBody || (stream.text && this._streamCaret?.style.display === 'none')) { this._render(); return; }
		const scroll = this._streamScroll;
		const pinned = !!scroll && (scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight) < 60;
		this._streamBody.textContent = stream.text;
		if (this._streamSteps) { clearNode(this._streamSteps); this._appendStepsCard(this._streamSteps, stream.steps); }
		// Autoscroll pinned to the bottom only when the user has not scrolled up to read earlier turns.
		if (pinned && scroll) { scroll.scrollTop = scroll.scrollHeight; }
	}

	// The tool-step card shared by a settled assistant turn and the live streaming turn: one mono row per
	// step, tick for a completed read/analysis, arrow for a queued proposal. Renders nothing for no steps.
	private _appendStepsCard(parent: HTMLElement, steps: readonly IChatStep[]): void {
		if (!steps.length) { return; }
		const card = append(parent, $('div'));
		card.style.cssText = 'border:1px solid #eceef2;border-radius:10px;overflow:hidden;background:#fff';
		steps.forEach((step, i) => {
			const stepRow = append(card, $('div'));
			const queued = step.status === 'queued';
			stepRow.style.cssText = `display:flex;gap:8px;padding:8px 12px;font:400 11.5px/1.4 ui-monospace,monospace;color:${queued ? '#9a6b16' : '#5d8a66'}${i < steps.length - 1 ? ';border-bottom:1px solid #f4f5f7' : ''}`;
			const glyph = append(stepRow, $('span'));
			glyph.textContent = queued ? '\u2192' : '\u2713';
			const label = append(stepRow, $('span'));
			label.textContent = step.label;
		});
	}

	private _renderChatMessage(scroll: HTMLElement, m: IChatMessage): void {
		if (m.role === 'user') {
			const wrap = append(scroll, $('div'));
			wrap.style.cssText = 'align-self:flex-end;max-width:88%;display:flex;flex-direction:column;align-items:flex-end;gap:6px';
			if (m.mentions && m.mentions.length) {
				const chips = append(wrap, $('div'));
				chips.style.cssText = 'display:flex;gap:5px;flex-wrap:wrap;justify-content:flex-end';
				for (const mention of m.mentions) {
					const chip = append(chips, $('span'));
					chip.style.cssText = 'font:500 10.5px/1 ui-monospace,monospace;color:#5b6dc4;background:#eef1ff;border:1px solid #e0e6ff;border-radius:6px;padding:4px 7px';
					chip.textContent = `@${mention}`;
				}
			}
			const bubble = append(wrap, $('div'));
			bubble.style.cssText = 'background:#eef1f6;border:1px solid #e4e7ee;border-radius:13px 13px 4px 13px;padding:10px 13px;font:400 13.5px/1.55 system-ui;color:#2c2f36;white-space:pre-wrap';
			bubble.textContent = m.content;
			return;
		}

		const row = append(scroll, $('div'));
		row.style.cssText = 'display:flex;gap:9px';
		const avatar = append(row, $('span'));
		avatar.style.cssText = 'flex:none;width:24px;height:24px;border-radius:50%;background:oklch(0.55 0.13 255);color:#fff;font:600 12px/24px system-ui;text-align:center';
		avatar.textContent = '\u273B';
		const col = append(row, $('div'));
		col.style.cssText = 'flex:1;min-width:0;display:flex;flex-direction:column;gap:10px';

		if (m.steps && m.steps.length) { this._appendStepsCard(col, m.steps); }

		// A fan-out with a model outage (F14, issue #123): a NAMED error naming the model as unreachable and
		// listing every document that failed, plus a "Retry failed" that re-runs ONLY those documents. Distinct
		// from `failed` (a whole-turn failure): a partial fan-out still queued proposals, so the proposal cards
		// are rendered BELOW the error banner - the surface never reads as a silent all-clear.
		if (m.failedDocs && m.failedDocs.length) {
			const err = append(col, $('div'));
			err.style.cssText = 'display:flex;flex-direction:column;gap:9px;font:400 13.5px/1.6 system-ui;color:#9a6b16;background:#fdf6e9;border:1px solid #f0e2c4;border-radius:9px;padding:9px 11px';
			const line = append(err, $('span'));
			line.textContent = m.content || 'The agent model is not reachable.';
			const list = append(err, $('div'));
			list.style.cssText = 'display:flex;flex-direction:column;gap:3px;font:500 12.5px/1.4 system-ui;color:#7a5a13';
			for (const d of m.failedDocs) {
				const item = append(list, $('span'));
				item.textContent = `\u2022 ${d.title}`;
			}
			const retry = append(err, $('button')) as HTMLButtonElement;
			retry.style.cssText = 'align-self:flex-start;border:1px solid #e6c98f;border-radius:7px;padding:6px 12px;background:#fff;color:#9a6b16;font:600 12px/1 system-ui;cursor:pointer';
			retry.textContent = 'Retry failed';
			this._renderDisposables.add(addDisposableListener(retry, 'click', () => { const d = this._activeDoc(); if (d) { this._livingDocs.retryFailedDocs(d); } }));
			// Fall through so any proposals this partial run DID land still render as review cards below.
			this._appendProposalCards(col, m);
			return;
		}

		// A genuinely failed turn (plan 27 iter 3): an honest error line + an inline Retry that re-sends the
		// same user message (the service drops this failed turn and re-runs). No prose / proposals follow.
		if (m.failed) {
			const err = append(col, $('div'));
			err.style.cssText = 'display:flex;flex-direction:column;gap:9px;font:400 13.5px/1.6 system-ui;color:#9a6b16;background:#fdf6e9;border:1px solid #f0e2c4;border-radius:9px;padding:9px 11px';
			const line = append(err, $('span'));
			line.textContent = m.content || 'The model call failed.';
			const retry = append(err, $('button')) as HTMLButtonElement;
			retry.style.cssText = 'align-self:flex-start;border:1px solid #e6c98f;border-radius:7px;padding:6px 12px;background:#fff;color:#9a6b16;font:600 12px/1 system-ui;cursor:pointer';
			retry.textContent = 'Retry';
			this._renderDisposables.add(addDisposableListener(retry, 'click', () => { const d = this._activeDoc(); if (d) { this._livingDocs.retryChat(d); } }));
			return;
		}

		const body = append(col, $('p'));
		const fallback = m.via === 'fallback';
		body.style.cssText = `margin:0;font:400 13.5px/1.6 system-ui;white-space:pre-wrap;color:${fallback ? '#9a6b16' : '#2c2f36'}${fallback ? ';background:#fdf6e9;border:1px solid #f0e2c4;border-radius:9px;padding:9px 11px' : ''}`;
		body.textContent = m.content || (m.stopped ? 'Stopped before the agent replied.' : '');

		// A stopped turn (D27-B) carries the salvaged prose plus a muted "stopped" tag, so it reads as a real
		// but deliberately-interrupted answer (never a silent truncation).
		if (m.stopped) {
			const tag = append(col, $('span'));
			tag.style.cssText = 'align-self:flex-start;font:600 9px/1 ui-monospace,monospace;letter-spacing:.04em;color:#868b95;background:#eef1f6;border-radius:999px;padding:4px 7px';
			tag.textContent = 'STOPPED';
		}

		// F5: a Copilot/Cursor-style review card per proposal this turn produced.
		this._appendProposalCards(col, m);
	}

	// F5: a Copilot/Cursor-style review card per proposal this turn produced. Read the LIVE pending change by
	// id so the card naturally disappears once accepted/rejected (here or in the document). Shared by the plain
	// assistant turn and the F14 partial-failure turn (proposals that landed alongside a model outage).
	private _appendProposalCards(col: HTMLElement, m: IChatMessage): void {
		if (!m.proposedIds || !m.proposedIds.length) { return; }
		const live = this._livingDocs.getAllPending().filter(c => m.proposedIds!.includes(c.id));
		for (const change of live) {
			const isInsert = !!change.insert;
			const card = append(col, $('div'));
			card.style.cssText = 'border:1px solid #e4e7ee;border-radius:10px;overflow:hidden;background:#fbfcff';
			const head = append(card, $('div'));
			head.style.cssText = `display:flex;align-items:center;gap:7px;padding:9px 12px 7px;font:600 10.5px/1 ui-monospace,monospace;letter-spacing:.04em;color:${isInsert ? '#1f7a44' : '#9a6b16'}`;
			const tag = append(head, $('span'));
			tag.textContent = isInsert ? '+ NEW CONTENT' : '\u270E EDIT';
			const where = append(head, $('span'));
			where.style.cssText = 'color:#868b95;font-weight:400';
			where.textContent = isInsert ? `after ${change.blockLabel}` : change.blockLabel;
			const preview = append(card, $('div'));
			preview.style.cssText = 'padding:2px 12px 9px;font:400 12.5px/1.5 system-ui;color:#52575f;white-space:pre-wrap;max-height:96px;overflow:hidden;cursor:pointer';
			preview.title = 'Open in the document';
			preview.textContent = change.newText.length > 240 ? change.newText.slice(0, 240) + '\u2026' : change.newText;
			// Click the preview to read this change inline in the document (navigate-only; Apply still applies).
			this._renderDisposables.add(addDisposableListener(preview, 'click', () => void this._navigateToChange(change)));
			const actions = append(card, $('div'));
			actions.style.cssText = 'display:flex;gap:7px;padding:9px 12px;border-top:1px solid #eef0f3';
			const approve = append(actions, $('button')) as HTMLButtonElement;
			approve.style.cssText = 'flex:1;border:none;border-radius:7px;padding:8px;background:oklch(0.55 0.13 255);color:#fff;font:600 12px/1 system-ui;cursor:pointer';
			approve.textContent = isInsert ? 'Insert' : 'Apply';
			this._renderDisposables.add(addDisposableListener(approve, 'click', () => void this._livingDocs.approve(change.id)));
			const reject = append(actions, $('button')) as HTMLButtonElement;
			reject.style.cssText = 'border:1px solid #e0e2e8;border-radius:7px;padding:8px 12px;background:#fff;color:#696e78;font:500 12px/1 system-ui;cursor:pointer';
			reject.textContent = 'Reject';
			this._renderDisposables.add(addDisposableListener(reject, 'click', () => this._livingDocs.reject(change.id)));
		}
	}

	private _renderChatComposer(content: HTMLElement, doc: URI | undefined): void {
		const footer = append(content, $('div'));
		footer.style.cssText = 'flex:none;border-top:1px solid #eef0f3;padding:10px 12px;background:#fbfbfc';

		// The persistent, calm sign-in affordance (plan 38): one line above the composer while signed out.
		this._renderSignInHint(footer);

		const box = append(footer, $('div'));
		// Comp C6: border tinted accent (#d9d7fb), 13px radius, subtle lifted shadow.
		box.style.cssText = 'position:relative;border:1px solid #d9d7fb;border-radius:13px;background:#fff;padding:8px 9px;box-shadow:0 6px 16px -12px rgba(86,97,201,.35)';

		// The working set: the documents this instruction edits across (plan 18, decision 60). A separate
		// row from the @mention "Attach" source chips below - these are edit targets, not data bindings.
		if (doc) { this._renderWorkingSetRow(box, doc); }

		const input = append(box, $('textarea')) as HTMLTextAreaElement;
		input.placeholder = doc ? 'Ask about this document, or run a skill\u2026' : 'Open a document to chat\u2026';
		input.value = this._chatDraft;
		input.rows = 2;
		input.disabled = !doc;
		input.style.cssText = 'width:100%;box-sizing:border-box;border:none;outline:none;resize:none;background:transparent;font:400 13px/1.5 system-ui;color:#2c2f36';
		this._renderDisposables.add(addDisposableListener(input, 'input', () => { this._chatDraft = input.value; this._composerPicker?.update(); }));
		// Caret-only moves (ArrowLeft/Right, Home/End, a mouse click) change `selectionStart` without an
		// `input` event, so re-sync the picker on keyup/click too - otherwise it lingers open with stale
		// matches and could insert the wrong one. `update()` closes it when the caret leaves an "@query".
		this._renderDisposables.add(addDisposableListener(input, 'keyup', () => this._composerPicker?.update()));
		this._renderDisposables.add(addDisposableListener(input, 'click', () => this._composerPicker?.update()));

		const mentions = doc ? this._livingDocs.getMentionableFiles(doc) : [];
		const insertMention = (file: string) => {
			const sep = input.value.length && !input.value.endsWith(' ') ? ' ' : '';
			input.value = `${input.value}${sep}@${file} `;
			this._chatDraft = input.value;
			input.focus();
		};

		// #178: the caret-anchored @mention picker. Owns its popup DOM + keyboard nav; the textarea's input
		// and keydown handlers drive it, and the "@ Mention" button opens it. Registered on the render store
		// so its listeners are torn down with the composer on the next re-render (no leaked global listeners).
		const picker = this._composerPicker = this._renderDisposables.add(new MentionPicker(box, input, mentions, chosen => {
			const replaced = replaceActiveMention(input.value, input.selectionStart ?? input.value.length, chosen);
			this._chatDraft = input.value = replaced.text;
			input.focus();
			// Restore the caret just after the inserted token: assigning `value` otherwise jumps it to the end,
			// which would strand a mid-draft insertion at the bottom of the textarea.
			input.setSelectionRange(replaced.caret, replaced.caret);
		}));
		this._renderDisposables.add({ dispose: () => { if (this._composerPicker === picker) { this._composerPicker = undefined; } } });
		if (mentions.length) {
			// #177: collapsed to the first few chips (two lines) with a "..." expander so ~30 mentionable
			// files no longer bury the conversation. Expanding shows the full list; the choice survives the
			// re-render each message triggers but resets to collapsed next session.
			const chips = append(box, $('div'));
			chips.style.cssText = 'display:flex;gap:5px;flex-wrap:wrap;padding:8px 0 2px';
			const hint = append(chips, $('span'));
			hint.style.cssText = 'font:500 10.5px/1.6 system-ui;color:#bcc0c8';
			hint.textContent = 'Attach:';
			const { shown, hasMore } = collapseAttachChips(mentions, this._attachExpanded);
			for (const file of shown) {
				const chip = append(chips, $('button')) as HTMLButtonElement;
				chip.style.cssText = 'font:500 10.5px/1 ui-monospace,monospace;color:#5b6dc4;background:#eef1ff;border:1px solid #e0e6ff;border-radius:6px;padding:4px 7px;cursor:pointer';
				chip.textContent = `@${file}`;
				this._renderDisposables.add(addDisposableListener(chip, 'click', () => insertMention(file)));
			}
			if (hasMore || this._attachExpanded) {
				const toggle = append(chips, $('button')) as HTMLButtonElement;
				toggle.style.cssText = 'font:500 10.5px/1 ui-monospace,monospace;color:#868b95;background:transparent;border:1px solid #e0e6ff;border-radius:6px;padding:4px 7px;cursor:pointer';
				toggle.textContent = this._attachExpanded ? 'Show less' : '…';
				toggle.title = this._attachExpanded ? 'Show fewer files' : 'Show all mentionable files';
				this._renderDisposables.add(addDisposableListener(toggle, 'click', () => {
					this._attachExpanded = !this._attachExpanded;
					this._render();
				}));
			}
		}

		const bar = append(box, $('div'));
		bar.style.cssText = 'display:flex;align-items:center;gap:6px;padding-top:8px';

		// + Skill: opens the same skill list that backs the Review disclosure; runs through the shared
		// runSkillCheck path. Only available when a living document is active (same gate as the disclosure).
		const skillReport = doc ? this._livingDocs.getSkillReport(doc) : [];
		const skillBtn = append(bar, $('button')) as HTMLButtonElement;
		// Comp: chip text is slate #52575F (Part B secondary text / quiet buttons), border #e6e8ec, 8px radius.
		skillBtn.style.cssText = 'border:1px solid #e6e8ec;border-radius:8px;padding:5px 9px;background:transparent;color:#52575f;font:500 11px/1 system-ui;cursor:pointer';
		skillBtn.textContent = '+ Skill';
		skillBtn.disabled = !doc || !skillReport.length;
		if (!doc || !skillReport.length) { skillBtn.style.opacity = '0.45'; }
		this._renderDisposables.add(addDisposableListener(skillBtn, 'click', () => {
			if (!doc) { return; }
			this._openSkillMenu(skillBtn, doc);
		}));

		// @ Mention: inserts a "@" and opens the caret-anchored picker (#178) so the user can type-to-filter
		// the mentionable files; selecting one inserts the token the message parser accepts (`@filename`).
		const mentionBtn = append(bar, $('button')) as HTMLButtonElement;
		mentionBtn.style.cssText = 'border:1px solid #e6e8ec;border-radius:8px;padding:5px 9px;background:transparent;color:#52575f;font:500 11px/1 system-ui;cursor:pointer';
		mentionBtn.textContent = '@ Mention';
		mentionBtn.disabled = !doc;
		if (!doc) { mentionBtn.style.opacity = '0.45'; }
		this._renderDisposables.add(addDisposableListener(mentionBtn, 'click', () => {
			const sep = input.value.length && !input.value.endsWith(' ') ? ' ' : '';
			input.value = `${input.value}${sep}@`;
			this._chatDraft = input.value;
			input.focus();
			input.setSelectionRange(input.value.length, input.value.length);
			picker.update();
		}));

		// The model picker (issue #179): a compact dropdown of the active backend's models, rendered even when
		// only one model exists so the surface is consistent across the included tier and a signed-in ChatGPT.
		this._renderModelPicker(bar);

		const busy = !!doc && this._livingDocs.isChatBusy(doc);
		const submit = () => {
			if (!doc || busy) { return; }
			const text = input.value.trim();
			if (!text) { return; }
			this._chatDraft = '';
			void this._livingDocs.sendChatMessage(doc, text);
		};

		const action = append(bar, $('button')) as HTMLButtonElement;
		if (busy) {
			// While a reply streams the send button becomes a Stop square (plan 27 iter 3): it cancels the
			// in-flight call; the prose so far is kept as a muted "stopped" turn (D27-B). Esc cancels too.
			action.style.cssText = 'margin-left:auto;width:28px;height:28px;border:none;border-radius:8px;background:#b4332f;color:#fff;font-size:11px;cursor:pointer;display:flex;align-items:center;justify-content:center';
			action.textContent = '\u25a0';
			action.title = 'Stop';
			this._renderDisposables.add(addDisposableListener(action, 'click', () => this._livingDocs.cancelChat(doc!)));
		} else {
			// Comp: 28x28 accent send button
			action.style.cssText = 'margin-left:auto;width:28px;height:28px;border:none;border-radius:8px;background:oklch(0.55 0.13 255);color:#fff;font-size:14px;cursor:pointer;display:flex;align-items:center;justify-content:center';
			action.textContent = '\u2191';
			action.disabled = !doc;
			this._renderDisposables.add(addDisposableListener(action, 'click', submit));
		}

		this._renderDisposables.add(addDisposableListener(input, 'keydown', (e: KeyboardEvent) => {
			// Give the @mention picker first crack at navigation keys while it is open (#178) so ArrowUp/Down
			// move the selection, Enter/Tab insert the mention, and Escape closes the picker (not the chat).
			if (picker.handleKeydown(e)) { return; }
			if (e.key === 'Escape' && doc && this._livingDocs.isChatBusy(doc)) { e.preventDefault(); this._livingDocs.cancelChat(doc); return; }
			if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); }
		}));

		// Keep the cursor in the composer across the re-render that each message triggers.
		if (doc && !busy) { input.focus(); }
	}

	// The model picker (issue #179): a compact dropdown in the composer footer listing the active backend's
	// models, sitting beside the +Skill / @Mention chips. Renders only once the catalogue has resolved (nothing
	// flashes before we know the truth), and renders EVEN when only one model exists so the surface is consistent
	// between the included tier (one "Included model") and a signed-in ChatGPT (its several tiers) - single-model
	// case is styled inert (disabled) since there is nothing to choose. Changing the selection persists it per
	// backend via the service; the broker validates the id and falls back to its default, so a pick never 500s a
	// call. A native <select> keeps it keyboard-accessible and visually consistent with the rail's quiet chips.
	private _renderModelPicker(bar: HTMLElement): void {
		const models = this._models;
		// Undefined = not yet fetched: render nothing to avoid a flash before the catalogue resolves. An empty
		// list (broker unreachable) also renders nothing - the composer degrades to no picker, never an error.
		if (!models || !models.length) { return; }

		const single = models.length === 1;
		const select = append(bar, $('select')) as HTMLSelectElement;
		// Quiet chip styling to match the +Skill / @Mention buttons: slate text, hairline border, 8px radius.
		select.style.cssText = 'border:1px solid #e6e8ec;border-radius:8px;padding:4px 6px;background:transparent;color:#52575f;font:500 11px/1 system-ui;cursor:pointer;max-width:120px';
		select.title = single ? 'The model serving your calls' : 'Choose the model for your calls';
		if (single) {
			// One model: inert (disabled) - there is nothing to choose, but the picker still shows for consistency.
			select.disabled = true;
			select.style.cursor = 'default';
			select.style.opacity = '0.7';
		}
		for (const model of models) {
			const opt = append(select, $('option')) as HTMLOptionElement;
			opt.value = model.id;
			opt.textContent = model.label;
			if (model.id === this._selectedModelId) { opt.selected = true; }
		}
		if (!single) {
			this._renderDisposables.add(addDisposableListener(select, 'change', () => {
				const id = select.value;
				this._selectedModelId = id;
				void this._livingDocs.setSelectedModelId(id);
			}));
		}
	}

	// The working-set row in the composer: the documents a single instruction fans out across (plan 18).
	// Each is a removable chip; the "Add" affordance offers the whole folder or any single document. When
	// the set is empty the row is just the discoverable add affordance (no set -> single-doc chat, D-B).
	private _renderWorkingSetRow(box: HTMLElement, doc: URI): void {
		const set = this._livingDocs.getWorkingSet(doc);
		const row = append(box, $('div'));
		row.style.cssText = 'display:flex;gap:5px;flex-wrap:wrap;align-items:center;padding:0 0 8px;border-bottom:1px solid #f1f2f5;margin-bottom:8px';

		const label = append(row, $('span'));
		label.style.cssText = 'font:500 10.5px/1.6 system-ui;color:#bcc0c8';
		label.textContent = set.length ? 'Editing:' : 'Edit across:';

		for (const wsDoc of set) {
			const chip = append(row, $('span'));
			chip.style.cssText = 'display:inline-flex;align-items:center;gap:5px;font:500 11px/1 system-ui;color:#3c4250;background:#f1f3f8;border:1px solid #e3e7ef;border-radius:6px;padding:4px 5px 4px 8px';
			const name = append(chip, $('span'));
			name.textContent = `\u25A4 ${wsDoc.title}`;
			const remove = append(chip, $('button')) as HTMLButtonElement;
			remove.style.cssText = 'border:none;background:transparent;color:#9aa0ac;cursor:pointer;font:600 13px/1 system-ui;padding:0 2px';
			remove.textContent = '\u00D7';
			remove.title = `Remove ${wsDoc.title} from the working set`;
			this._renderDisposables.add(addDisposableListener(remove, 'click', () => this._livingDocs.removeFromWorkingSet(doc, wsDoc.resource)));
		}

		const add = append(row, $('button')) as HTMLButtonElement;
		add.style.cssText = 'border:1px dashed #cdd2dc;background:transparent;color:#6b7280;border-radius:6px;padding:4px 8px;font:500 11px/1 system-ui;cursor:pointer';
		add.textContent = set.length ? '\uFF0B Add' : '\uFF0B Add documents';
		this._renderDisposables.add(addDisposableListener(add, 'click', () => this._openWorkingSetMenu(add, doc)));
	}

	// The add-to-working-set menu: the whole folder in one click, or pick any single document not yet in
	// the set. Mutating the set fires onDidChange, which re-renders the composer with the new chips.
	private async _openWorkingSetMenu(anchor: HTMLElement, doc: URI): Promise<void> {
		const candidates = await this._livingDocs.getWorkingSetCandidates(doc);
		const actions: IAction[] = [
			toAction({ id: 'livingDocs.ws.addFolder', label: 'Add all documents in the folder', run: () => void this._livingDocs.addFolderToWorkingSet(doc) }),
		];
		if (candidates.length) {
			actions.push(new Separator());
			for (const c of candidates) {
				actions.push(toAction({ id: `livingDocs.ws.add.${c.resource.toString()}`, label: c.title, run: () => void this._livingDocs.addToWorkingSet(doc, [c.resource]) }));
			}
		}
		this.contextMenuService.showContextMenu({ getAnchor: () => anchor, getActions: () => actions });
	}

	// The + Skill picker in the composer: reuses the same skill list as the Review disclosure
	// (_appendChecks / skillsHtml, which reads from getSkillReport). Selecting a skill runs it
	// via runSkillCheck - the identical path as the data-skill-run buttons in the disclosure.
	// No new run logic is introduced; this is purely a second entry-point to the same method.
	private _openSkillMenu(anchor: HTMLElement, doc: URI): void {
		const report = this._livingDocs.getSkillReport(doc);
		if (!report.length) { return; }
		const actions: IAction[] = report.map(s =>
			toAction({
				id: `livingDocs.skill.run.${s.id}`,
				label: s.name,
				run: () => { this._livingDocs.runSkillCheck(doc, s.id); },
			})
		);
		this.contextMenuService.showContextMenu({ getAnchor: () => anchor, getActions: () => actions });
	}

	private _injectStyles(container: HTMLElement): void {
		if (this._stylesInjected) { return; }
		this._stylesInjected = true;
		const style = document.createElement('style');
		style.textContent = `
		.living-docs-panel{display:flex;flex-direction:column;height:100%;font:13px system-ui;background:#fbfbfc}
		.living-docs-panel .ldp-tabs{display:flex;gap:2px;flex:none;padding:0 4px;border-bottom:1px solid #eef0f3}
		.living-docs-panel .ldp-tab{position:relative;border:none;background:transparent;padding:11px 11px 10px;font:500 12.5px/1 system-ui;color:#868b95;cursor:pointer;display:flex;align-items:center;gap:6px}
		.living-docs-panel .ldp-tab:hover{color:#1a1c20}
		.living-docs-panel .ldp-tab.active{color:#1a1c20;font-weight:600}
		.living-docs-panel .ldp-tab.active::after{content:"";position:absolute;left:8px;right:8px;bottom:-1px;height:2px;border-radius:2px;background:oklch(0.55 0.13 255)}
		.living-docs-panel .ldp-tab-count{font:600 9px/1 'JetBrains Mono',ui-monospace,monospace;color:#fff;background:oklch(0.66 0.16 45);border-radius:999px;padding:3px 5px}
		.living-docs-panel .ldp-content{flex:1;overflow-y:auto}
		.living-docs-panel .ldr-content,.living-docs-panel .ldp-content{padding:14px 12px}
		.living-docs-panel .ldr-status{font:400 11.5px/1.5 system-ui;color:#868b95;margin-bottom:14px}
		.living-docs-panel .ldr-group{margin-bottom:16px}
		.living-docs-panel .ldr-group-head{display:flex;align-items:center;gap:8px;margin:6px 0 8px}
		.living-docs-panel .ldr-group-title{display:flex;align-items:center;gap:7px;border:none;background:transparent;padding:0;cursor:pointer;font:600 11px/1 system-ui;letter-spacing:.02em;color:#1a1c20;text-transform:uppercase;text-align:left}
		.living-docs-panel .ldr-group-title:hover span:first-child{text-decoration:underline}
		.living-docs-panel .ldr-group-count{font:600 10px/1 'JetBrains Mono',ui-monospace,monospace;color:#868b95;background:#0001;border-radius:999px;padding:2px 7px}
		.living-docs-panel .ldr-group-stat{display:inline-flex;gap:6px;margin-left:auto;font:600 10px/1 'JetBrains Mono',ui-monospace,monospace}
		.living-docs-panel .ldr-stat-add{color:#1f7a43}
		.living-docs-panel .ldr-stat-del{color:#b4332f}
		.living-docs-panel .ldr-group-actions{display:flex;gap:6px}
		.living-docs-panel .ldr-group-btn{border:1px solid #e0e2e8;border-radius:7px;padding:5px 9px;background:#fff;color:#52575f;font:600 10.5px/1 system-ui;cursor:pointer;text-transform:none;letter-spacing:0}
		.living-docs-panel .ldr-group-btn:hover{background:#f4f5f7}
		.living-docs-panel .ldr-group-btn.approve{border-color:transparent;background:oklch(0.55 0.13 255);color:#fff}
		.living-docs-panel .ldr-group-btn.approve:hover{background:oklch(0.5 0.13 255)}
		.living-docs-panel .ldr-card{border:1px solid #eceef2;border-radius:10px;padding:13px;margin-bottom:12px;background:#fff}
		.living-docs-panel .ldr-card-top{display:flex;align-items:center;justify-content:space-between;margin-bottom:9px}
		.living-docs-panel .ldr-card-name{font:600 12.5px/1 system-ui;color:#1a1c20}
		.living-docs-panel .ldr-tag{font:600 9px/1 'JetBrains Mono',ui-monospace,monospace;letter-spacing:.04em;border-radius:999px;padding:4px 7px}
		.living-docs-panel .ldr-tag.attn{color:#9a6b16;background:#fdf6e9;border:1px solid #f0e2c4}
		.living-docs-panel .ldr-tag.ok{color:#2c8159;background:#eef7f0;border:1px solid #d7ecdc}
		.living-docs-panel .ldr-conf{font:600 10px/1.4 system-ui;border-radius:999px;padding:3px 8px}
		.living-docs-panel .ldr-conf.high{color:#2c8159;background:#eef7f0;border:1px solid #d7ecdc}
		.living-docs-panel .ldr-conf.inferred{color:#8a6d1a;background:#fdfaf2;border:1px solid #e4dccb}
		.living-docs-panel .ldr-diff{border:1px solid #eceef2;border-radius:7px;overflow:hidden;margin-bottom:10px}
		.living-docs-panel .ldr-o{background:#fdecec;color:#7a3a38;text-decoration:line-through;text-decoration-color:rgba(180,51,47,.4);padding:8px 10px;font:400 12.5px/1.45 system-ui}
		.living-docs-panel .ldr-n{background:#e7f6ec;color:#1f5a36;padding:8px 10px;font:400 12.5px/1.45 system-ui}
		.living-docs-panel .ldr-why{font:400 12.5px/1.55 system-ui;color:#4a4f6a;background:#f4f6ff;border:1px solid #e2e8ff;border-radius:9px;padding:11px 12px;margin-bottom:16px}
		.living-docs-panel .ldr-meta{display:flex;flex-wrap:wrap;gap:12px;font:600 10px/1.4 'JetBrains Mono',ui-monospace,monospace;color:#868b95;margin-bottom:12px}
		.living-docs-panel .ldr-actions{display:flex;gap:8px}
		.living-docs-panel .ldr-approve{flex:1;border:none;border-radius:8px;padding:11px;background:oklch(0.55 0.13 255);color:#fff;font:600 13px/1 system-ui;cursor:pointer}
		.living-docs-panel .ldr-approve:hover{background:oklch(0.5 0.13 255)}
		.living-docs-panel .ldr-reject{border:1px solid #e0e2e8;border-radius:8px;padding:11px 16px;background:#fff;color:#696e78;font:500 13px/1 system-ui;cursor:pointer}
		.living-docs-panel .ldr-reject:hover{background:#f4f5f7}
		.living-docs-panel .ldr-checks{margin-top:6px;padding-top:16px;border-top:1px solid #eef0f3}
		.living-docs-panel .ldp-busy{display:flex;gap:9px;align-items:center}
		.living-docs-panel .ldp-busy-avatar{flex:none;width:24px;height:24px;border-radius:50%;background:oklch(0.55 0.13 255);color:#fff;font:600 12px/24px system-ui;text-align:center;animation:ldp-pulse 1.4s ease-in-out infinite}
		.living-docs-panel .ldp-busy-label{font:400 13px/1.6 system-ui;color:#a3a8b2}
		.living-docs-panel .ldp-busy-dots::after{content:"";animation:ldp-dots 1.4s steps(4,end) infinite}
		.living-docs-panel .ldp-caret{display:inline-block;width:2px;height:1.05em;margin-left:1px;vertical-align:text-bottom;background:oklch(0.55 0.13 255);animation:ldp-blink 1s steps(2,start) infinite}
		@keyframes ldp-blink{0%,49%{opacity:1}50%,100%{opacity:0}}
		@keyframes ldp-pulse{0%,100%{opacity:1}50%{opacity:.45}}
		@keyframes ldp-dots{0%{content:""}25%{content:"\\2009."}50%{content:"\\2009.."}75%{content:"\\2009..."}100%{content:"\\2009..."}}
		`;
		container.appendChild(style);
	}

	protected override layoutBody(height: number, width: number): void {
		super.layoutBody(height, width);
		if (this._root) {
			this._root.style.height = `${height}px`;
		}
	}
}

// ---- Static comp-faithful bodies (the document-checks section folded into Review). Light colours match
// the registered "Abstract" theme, so hardcoding them here reproduces the comp exactly. (Chat is a live DOM
// surface in _renderChat; the History timeline moved to the pure historyRender module.) ----

// The on-demand "Document agents" disclosure at the bottom of Review (v4 iter 4): a single calm toggle row
// (so the Review tab matches the "Workbench v2" comp, which dropped the always-on panel) that expands to
// the wired agents. A small flag count rides on the row so an outstanding fix is not hidden.
function checksDisclosureHtml(expanded: boolean, flags: number, report: readonly ISkillCheck[], docTitle: string | undefined): string {
	const chevron = expanded ? '&#9662;' : '&#9656;';
	const flagBadge = (flags > 0 && !expanded)
		? `<span style="margin-left:auto;font:600 10px/1 'JetBrains Mono',ui-monospace,monospace;color:#9a6b16;background:#fdf2dc;border-radius:999px;padding:4px 7px">${flags}</span>`
		: '';
	const toggle = `<button data-checks-toggle style="display:flex;align-items:center;gap:8px;width:100%;border:none;background:transparent;border-top:1px solid #eef0f3;margin-top:8px;padding:13px 2px 11px;cursor:pointer;font:600 10px/1 'JetBrains Mono',ui-monospace,monospace;letter-spacing:.08em;color:#a3a8b2;text-transform:uppercase">`
		+ `<span style="color:#bcc0c8;font-size:11px">${chevron}</span>DOCUMENT AGENTS${flagBadge}</button>`;
	return toggle + (expanded ? skillsHtml(report, docTitle) : '');
}

// Skills (document agents) -- the agents that run on this document, on demand or before export.
// Data-driven from the live grader report (spec 5). Financial + Formatting are deterministic verdicts on
// the active document; Strategy reports a needs-model state. "Run"/"Re-run" re-grade. The decorative RUN
// ON EXPORT toggle + Add-skill row match the comp. Rendered only when the disclosure above is expanded.
function skillsHtml(report: readonly ISkillCheck[], docTitle: string | undefined): string {
	if (!report.length) {
		return `<div style="font:400 12.5px/1.6 system-ui;color:#868b95;padding:8px 2px">Open a Living Document to see the Skills that run on it.</div>`;
	}
	const icons: Record<string, { glyph: string; bg: string; fg: string }> = {
		strategy: { glyph: '&#9672;', bg: '#fdf2dc', fg: '#9a6b16' },
		financial: { glyph: '&#8721;', bg: '#e7f3ec', fg: '#217346' },
		formatting: { glyph: '&#182;', bg: '#eef1f6', fg: '#52575f' },
	};
	const badge = (s: ISkillCheck): string => {
		const m: Record<string, { label: string; color: string; bg: string }> = {
			pass: { label: 'PASS', color: '#1f7a44', bg: '#e7f6ec' },
			flag: { label: 'FLAG', color: '#9a6b16', bg: '#fdf2dc' },
			'needs-model': { label: 'NO MODEL', color: '#868b95', bg: '#eef1f6' },
			ready: { label: 'READY', color: 'oklch(0.55 0.13 255)', bg: '#eef2fb' },
		};
		const b = m[s.status];
		return `<span style="margin-left:auto;font:600 10px/1 'JetBrains Mono',ui-monospace,monospace;color:${b.color};background:${b.bg};border-radius:999px;padding:4px 7px;flex:none">${b.label}</span>`;
	};
	const runBtn = (s: ISkillCheck): string => s.canRun
		? `<button data-skill-run="${s.id}" style="border:1px solid #e0e2e8;border-radius:7px;padding:7px 11px;background:#fff;color:#52575f;font:500 11.5px/1 system-ui;cursor:pointer">${s.status === 'pass' ? 'Re-run' : 'Run'}</button>`
		: '';
	// "Apply fix" appears on a flagged skill that carries a deterministic edit (Formatting heading-case);
	// it is the primary action, so it takes the right-aligned slot with Run beside it.
	const fixBtn = (s: ISkillCheck): string => (s.fixable && s.status === 'flag')
		? `<button data-skill-fix="${s.id}" style="margin-left:auto;border:none;border-radius:7px;padding:7px 11px;background:oklch(0.55 0.13 255);color:#fff;font:600 11.5px/1 system-ui;cursor:pointer">Apply fix</button>`
		: '';
	const card = (s: ISkillCheck): string => {
		const ic = icons[s.id];
		const border = s.status === 'flag' ? '1.5px solid oklch(0.78 0.1 70)' : '1px solid #eceef2';
		const detailColor = s.status === 'flag' ? '#52575f' : '#868b95';
		return `<div style="border:${border};border-radius:11px;overflow:hidden;margin-bottom:11px">`
			+ `<div style="display:flex;align-items:center;gap:9px;padding:11px 13px"><span style="width:28px;height:28px;flex:none;border-radius:8px;background:${ic.bg};color:${ic.fg};font-size:14px;display:flex;align-items:center;justify-content:center">${ic.glyph}</span><div style="min-width:0"><div style="font:600 13px/1.2 system-ui;color:#1a1c20">${esc(s.name)}</div><div style="font:400 11px/1.3 system-ui;color:#868b95">${esc(s.blurb)}</div></div>${badge(s)}</div>`
			+ `<div style="margin:0 13px;border-top:1px solid #f4f5f7;padding:10px 0;display:flex;align-items:center;gap:8px"><span style="flex:1;font:400 12px/1.4 system-ui;color:${detailColor}">${esc(s.detail)}</span>${fixBtn(s)}${runBtn(s)}</div></div>`;
	};
	const sub = docTitle ? `Skills that run on ${esc(docTitle)} &mdash; on demand or before export.` : 'Skills that run on this document.';
	// The "DOCUMENT AGENTS" label lives on the disclosure toggle (checksDisclosureHtml) now, so this body
	// starts straight at the sub-line. The whole body only renders when the disclosure is expanded.
	return `<div style="display:flex;flex-direction:column;padding-top:11px">
	<div style="font:400 11px/1.45 system-ui;color:#a3a8b2;padding:0 2px 14px">${sub}</div>
	${report.map(card).join('')}
	<div style="font:600 9.5px/1 'JetBrains Mono',ui-monospace,monospace;letter-spacing:.08em;color:#bcc0c8;padding:0 2px 8px">RUN ON EXPORT</div>
	<div style="display:flex;align-items:center;gap:9px;border:1px solid #eceef2;background:#fff;border-radius:9px;padding:10px 12px;margin-bottom:14px"><span style="font:400 12px/1.4 system-ui;color:#52575f">Formatting + Financial</span><span style="margin-left:auto;width:34px;height:20px;border-radius:999px;background:oklch(0.55 0.13 255);position:relative;flex:none"><span style="position:absolute;top:2px;right:2px;width:16px;height:16px;border-radius:50%;background:#fff"></span></span></div>
	<button style="width:100%;border:1px dashed #d4d7de;background:#fff;border-radius:8px;padding:9px;font:500 12px/1 system-ui;color:#868b95;cursor:pointer">&#65291; Add skill from library</button>
</div>`;
}

/**
 * The caret-anchored @mention picker for the chat composer (#178). A hand-rolled listbox rather than a
 * shared primitive: the composer is plain workbench DOM (not a webview or a Monaco editor), so the
 * editor's suggest widget and IQuickInputService (a centred modal) both fit poorly in the 392px aux-bar
 * rail. The popup is absolutely positioned inside the (position:relative) composer box, bottom-aligned so
 * it opens upward above the textarea - simpler than per-character caret tracking and the right look in the
 * narrow rail. It watches the textarea for an active "@query" (see activeMention) and shows the top ~8
 * ranked matches; ArrowUp/Down move a highlighted option, Enter/Tab insert it, Escape closes. Follows the
 * listbox aria pattern (role=listbox on the ul, role=option + aria-selected on each item, and
 * aria-activedescendant on the textarea) so the selection is announced. All DOM and listeners are owned by
 * this disposable, torn down with the composer render.
 */
class MentionPicker extends Disposable {

	private readonly _list: HTMLUListElement;
	// Per-render listeners for the option `<li>`s. `_render()` runs on every keystroke and arrow move, so
	// these must be cleared each render rather than piling up on the picker's own store until it is torn
	// down (the repo's disposable rule for objects created in repeatedly-called methods).
	private readonly _optionDisposables = this._register(new DisposableStore());
	private _matches: string[] = [];
	private _active = 0;
	private _open = false;
	private static _seq = 0;
	private readonly _id = `ldp-mention-${MentionPicker._seq++}`;

	constructor(
		anchor: HTMLElement,
		private readonly _input: HTMLTextAreaElement,
		private readonly _files: readonly string[],
		private readonly _onSelect: (file: string) => void,
	) {
		super();
		this._list = append(anchor, $('ul')) as HTMLUListElement;
		this._list.id = this._id;
		this._list.setAttribute('role', 'listbox');
		this._list.style.cssText = 'display:none;position:absolute;left:9px;right:9px;bottom:calc(100% + 4px);z-index:10;margin:0;padding:4px;list-style:none;max-height:184px;overflow-y:auto;background:#fff;border:1px solid #d9d7fb;border-radius:10px;box-shadow:0 10px 28px -12px rgba(86,97,201,.5)';
		this._input.setAttribute('role', 'combobox');
		this._input.setAttribute('aria-autocomplete', 'list');
		this._input.setAttribute('aria-controls', this._id);
		this._input.setAttribute('aria-expanded', 'false');
		this._register({ dispose: () => this._close() });
	}

	/** Recompute the popup from the textarea's current text + caret. Called on input and when opened. */
	update(): void {
		const mention = activeMention(this._input.value, this._input.selectionStart ?? this._input.value.length);
		if (!mention) { this._close(); return; }
		this._matches = filterMentions(this._files, mention.query);
		if (!this._matches.length) { this._close(); return; }
		this._active = 0;
		this._render();
	}

	/**
	 * Handle a composer keydown while the picker is open. Returns true when the key was consumed (so the
	 * composer's own Enter=submit / Escape=cancel handling is skipped for that stroke).
	 */
	handleKeydown(e: KeyboardEvent): boolean {
		if (!this._open) { return false; }
		switch (e.key) {
			case 'ArrowDown': e.preventDefault(); this._move(1); return true;
			case 'ArrowUp': e.preventDefault(); this._move(-1); return true;
			case 'Enter':
			case 'Tab': e.preventDefault(); this._select(); return true;
			case 'Escape': e.preventDefault(); this._close(); return true;
			default: return false;
		}
	}

	private _move(delta: number): void {
		this._active = (this._active + delta + this._matches.length) % this._matches.length;
		this._render();
	}

	private _select(): void {
		const file = this._matches[this._active];
		if (!file) { return; }
		this._close();
		this._onSelect(file);
	}

	private _render(): void {
		this._optionDisposables.clear();
		clearNode(this._list);
		this._matches.forEach((file, i) => {
			const item = append(this._list, $('li')) as HTMLLIElement;
			item.id = `${this._id}-${i}`;
			item.setAttribute('role', 'option');
			const selected = i === this._active;
			item.setAttribute('aria-selected', String(selected));
			item.style.cssText = `font:500 11.5px/1 ui-monospace,monospace;color:#5b6dc4;border-radius:6px;padding:6px 8px;cursor:pointer;${selected ? 'background:#eef1ff' : ''}`;
			item.textContent = `@${file}`;
			this._optionDisposables.add(addDisposableListener(item, 'mousedown', e => { e.preventDefault(); this._active = i; this._select(); }));
			this._optionDisposables.add(addDisposableListener(item, 'mousemove', () => { if (this._active !== i) { this._active = i; this._render(); } }));
		});
		this._list.style.display = 'block';
		this._open = true;
		this._input.setAttribute('aria-expanded', 'true');
		this._input.setAttribute('aria-activedescendant', `${this._id}-${this._active}`);
	}

	private _close(): void {
		this._open = false;
		this._list.style.display = 'none';
		this._optionDisposables.clear();
		clearNode(this._list);
		this._input.setAttribute('aria-expanded', 'false');
		this._input.removeAttribute('aria-activedescendant');
	}
}
