/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, addDisposableListener, append, clearNode, getWindow } from '../../../../base/browser/dom.js';
import { safeSetInnerHtml } from '../../../../base/browser/domSanitize.js';
import { IAction, Separator, SubmenuAction, toAction } from '../../../../base/common/actions.js';
import { disposableTimeout } from '../../../../base/common/async.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { ThemeIcon } from '../../../../base/common/themables.js';
import { Disposable, DisposableStore, MutableDisposable } from '../../../../base/common/lifecycle.js';
import { URI } from '../../../../base/common/uri.js';
import { localize } from '../../../../nls.js';
import { IClipboardService } from '../../../../platform/clipboard/common/clipboardService.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
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
import { getDefaultHoverDelegate } from '../../../../base/browser/ui/hover/hoverDelegateFactory.js';
import { AMBER, FONT, GREEN, HAIRLINE, INDIGO, INK, PAPER, RADIUS, RED, SHADOW, TRACKING, TYPE } from '../common/abstractTokens.js';
import { buildTurnPointers, describeRestoredProposals, IChangePointer, inlineWidgetAnswer } from '../common/changePointer.js';
import { IChatSession, splitTabs, visibleTabCap } from '../common/chatSessions.js';
import { addressLabel, resolveBlockLine } from '../common/livingDocAddress.js';
import { CLOSE_CHAT_COMMAND_ID, IChatMessage, IChatStep, ILivingDocsService, IModelOption, ISkillCheck, ModelProvider, ModelReadiness, ModelTier } from '../common/livingDocs.js';
import { bulkApproveConfirm, IProposedChange, reviewFraming } from '../common/livingDocsModel.js';
import { historyHtml } from './historyRender.js';
import { ScreenEditorInput } from './screenEditorInput.js';
import { ScreenId } from './screenRender.js';

type PanelTab = 'chat' | 'review' | 'history';

// How long a transcript pointer click waits for a freshly-opened document to report which inline widgets it
// mounted (plan 52 WP-A1 fix 1). Generous, because it is only ever spent on the first click into a document
// this session - a document that has already reported answers from the recorded report with no wait at all -
// and because the alternative to waiting is guessing, which is the defect this fix removes. A surface that
// has still said nothing by then is treated as showing nothing, and the click lands in Review.
const POINTER_WIDGET_REPORT_TIMEOUT = 1500;

// How long a click holds a REMEMBERED "the widget is mounted" open before acting on it (plan 52 WP-A1 fix 2,
// #301). A recorded report was true when it was taken, and the surface re-reports on every render - so this is
// simply long enough for a render already in flight to overrule a memory that has just gone out of date. Short,
// because it is spent on the healthy path too; invisible, because the scroll-and-flash was already asked for
// before the wait began, so all this delays is the decision to ALSO fall back to Review.
const POINTER_WIDGET_RECHECK_WINDOW = 250;

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

// The health dot colour for the composer model control + popover rows (issue #236, plan 47 P14.5). Honest,
// never fabricated, and now drawn from the design system's meaning palette (doc 28) rather than the round-1
// hexes: `ready` = green (all clear); `budget-paused` = amber (waiting on you - the included tier's daily cap
// is spent but the model is otherwise fine); broker-down / unconfigured = red (failed - the model genuinely
// cannot answer); undefined (not yet probed) = the neutral frame border, a window the settled-status cache
// keeps to near-zero so the dot never blinks on a surface crossing.
// Exported so the unit test pins the readiness -> colour mapping without a live broker.
export function modelHealthDotColour(readiness: ModelReadiness | undefined): string {
	switch (readiness) {
		case 'ready': return GREEN.base;
		case 'budget-paused': return AMBER.base;
		case 'broker-down':
		case 'unconfigured': return RED.base;
		default: return PAPER.frameBorder;
	}
}

// The plain-words state shown on the model control (and the empty popover) when there is no model label to
// show (issue #236, P14.5): the broker state named honestly, never a fabricated "connected". Externalised so
// every surface speaks the same words. Exported for the unit test.
export function modelStateWords(readiness: ModelReadiness | undefined): string {
	switch (readiness) {
		case 'budget-paused': return localize('livingDocs.model.state.paused', "Daily limit reached");
		case 'ready': return localize('livingDocs.model.state.ready', "Model ready");
		case 'broker-down':
		case 'unconfigured': return localize('livingDocs.model.state.unavailable', "Model unavailable");
		default: return localize('livingDocs.model.state.checking', "Checking model…");
	}
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
	// The single in-flight "scroll Review to the card this deep link named" pass (plan 52 WP-A1). A
	// MutableDisposable so a second deep link replaces the first rather than leaving two timers racing.
	private readonly _revealReviewCard = this._register(new MutableDisposable());
	// The Document-Agents section is relocated to an on-demand disclosure at the bottom of Review (the
	// "Workbench v2" comp drops the always-on panel; the agents stay reachable). Collapsed by default so the
	// Review tab matches the comp; this remembers the open/closed state across re-renders this session.
	private _checksExpanded = false;
	// Which shape the Review tab's FIGURES card is in, per document (comp 2b). Pure view state, reset each
	// session: `grouped` shows the value transitions, `collapsed` folds them away once they have been read, and
	// `each` breaks the group back into individual cards with their own Approve / Reject - the escape hatch out
	// of the bulk verb. A document with no entry is `grouped`.
	private readonly _figuresMode = new Map<string, 'grouped' | 'collapsed' | 'each'>();
	// Whether the Attach suggestion row is expanded to the full mentionable-file list (#177). Collapsed by
	// default each session so the chat history keeps the reclaimed room; a re-render preserves the choice.
	private _attachExpanded = false;
	// The live @mention picker for the current composer render (#178), or undefined while none is mounted.
	// Rebuilt each _renderChatComposer; the textarea input/keydown handlers reach it through this field.
	private _composerPicker: MentionPicker | undefined;
	private readonly _renderDisposables = this._register(new DisposableStore());
	// The rail's last laid-out width, which decides how many chat tabs fit (plan 52 WP-B residuals). 0 until
	// the first layout, which `visibleTabCap` reads as "not measured yet" and answers with its fixed fallback.
	private _railWidth = 0;
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
	// The door actually answering right now (plan 51 WP-D): needed alongside `_signedIn` so the composer can name
	// the honest signed-in-but-can't-serve state - signed in to ChatGPT while the included model is the door that
	// answered (the #120/#259 fallback). Without this the composer would fall silent in that state and only the
	// Model Access screen would tell the truth. Undefined until the first /healthz probe resolves.
	private _provider: ModelProvider | undefined;
	// The model picker (issue #179): the active backend's models and the selected id, fetched cheaply from the
	// service (which caches /models) and refreshed alongside the sign-in state. The composer renders a compact
	// dropdown from these; empty models -> no picker. Undefined until the first fetch resolves.
	private _models: readonly IModelOption[] | undefined;
	private _selectedModelId: string | undefined;
	// The open model-selector popover (issue #236, plan 47 P14.3), or empty when none is up. A MutableDisposable
	// so opening a second popover, selecting a model, or re-rendering the composer tears the previous one down -
	// the DOM node + its outside-click/Escape listeners live in the store this holds, so nothing leaks.
	private readonly _modelPopover = this._register(new MutableDisposable<DisposableStore>());
	// Plan 42 slice L2 (issue #198) + plan 51 device auth: the inline first-use ChatGPT sign-in state. Undefined
	// = no sign-in in flight (the two-door choice shows); a set `_inlineSignInPending` = the device round-trip is
	// in flight, so the choice renders the device code + verification link + spinner. Reset once the flow
	// completes, errors, or is dismissed. The device code + verification URI are the RFC 8628 fields from the
	// broker's `/auth/openai/start` (issue #283); the interval is the poll cadence the rail must not beat.
	private _inlineSignInPending = false;
	private _inlineSignInUserCode: string | undefined;
	private _inlineSignInUrl: string | undefined;
	private _inlineSignInPollMs = 5000;
	// A plain-words inline sign-in error to show in the choice card when the last attempt failed (plan 51): the
	// local model helper isn't running, or upstream rejected. Cleared when a fresh attempt starts.
	private _inlineSignInError: string | undefined;
	// The single in-flight inline sign-in poll timer; a MutableDisposable so a re-open / completion never leaks one.
	private readonly _inlineSignInPoll = this._register(new MutableDisposable());

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
		@IClipboardService private readonly _clipboardService: IClipboardService,
		@ICommandService private readonly _commands: ICommandService,
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
		// While this rail is mounted, register interest in the live provider status (issue #236, the D1 down->up
		// recovery). If the broker is down, the service re-probes /healthz on a low frequency and fires onDidChange
		// on the real recovery, which drives _refreshSignedIn above and returns the composer to green. Registered
		// with the render lifecycle so the interest (and the service's background timer) unwinds when the rail unmounts.
		this._register(this._livingDocs.watchProviderStatus());
		// Append streamed chat deltas to the live turn without a full re-render (plan 27 iter 3).
		this._register(this._livingDocs.onDidStreamChat(resource => this._onStreamDelta(resource)));
		this._register(this._livingDocs.onDidRequestPanel(request => {
			this._activeTab = request.tab;
			this._render();
			// A Review deep link names the block it wants read (plan 48's Home cards, and now a transcript pointer
			// whose change has no inline widget). Scroll to that card once the renders have settled.
			this._revealReviewCardFor(request.payload?.blockId);
		}));
		this._register(this._livingDocs.onDidRequestChatAttach(file => this._attachToChatDraft(file)));
		this._register(this._editors.onDidActiveEditorChange(() => { if (this._activeTab === 'review' || this._activeTab === 'chat') { this._render(); } }));
		// A document reported which inline widgets it really mounted (plan 52 WP-A1 fix 1), which is what decides
		// whether a transcript pointer wears its "REVIEW" marker. Re-render so the marker reflects the answer the
		// moment it arrives - a pointer drawn before its document had ever been looked at wears nothing, and
		// gains the marker when the document says there is no widget. The service only fires when the answer
		// actually changed, so an ordinary re-render storm never reaches here.
		this._register(this._livingDocs.onDidReportInlineWidgets(() => { if (this._activeTab === 'chat') { this._render(); } }));
		void this._refreshSignedIn();
		// Replay a panel request made before this rail mounted: "View history" (and other deep links) on a
		// not-yet-open document fires focusPanel BEFORE the rail exists, so its synchronous event is lost.
		// The service keeps it pending; consume-and-clear it here so we still land on the requested tab.
		const pending = this._livingDocs.consumePendingPanel();
		if (pending) {
			this._activeTab = pending.tab;
		}
		this._render();
		if (pending) { this._revealReviewCardFor(pending.payload?.blockId); }
	}

	// Scroll the Review list to the card for `blockId` (plan 52 WP-A1). Scheduled rather than done inline
	// because `reviewBlock` fires its panel request BEFORE it loads the document, and that load triggers a
	// second render which resets the scroll - a scroll performed during the first render is undone a moment
	// later. One delayed pass runs after both. Being one-shot it then leaves the reader's own scrolling alone,
	// unlike a flag re-applied on every render. A block id that matches no card is simply a no-op.
	private _revealReviewCardFor(blockId: string | undefined): void {
		if (!blockId) { this._revealReviewCard.clear(); return; }
		this._revealReviewCard.value = disposableTimeout(() => {
			// The Review list is rendered as one HTML string, not built element by element, so there are no
			// element handles to hold onto - a selector is the only way back to a card, and the block id it
			// matches on is the same durable address the document and the rail already agree about.
			// eslint-disable-next-line no-restricted-syntax
			this._root?.querySelector(`.ldr-card[data-block-id="${CSS.escape(blockId)}"]`)?.scrollIntoView({ block: 'center' });
		}, 250);
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
		// Tear down any open model popover before we clear the DOM (issue #236): its node lives inside the composer
		// box we are about to remove, and its window-level dismiss listeners must not outlive that node.
		this._modelPopover.clear();
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

		// The calm collapse control (plan 42 slice L4): a slim chevron pinned to the right of the tab strip
		// that returns to the quiet shell. It is the discoverable counterpart to the slim edge affordance
		// (which peeks the rail open); activating it collapses the rail AND records `collapsed` as the user's
		// manual choice, so the quiet shell is restorable through the UI and the choice persists.
		const collapseLabel = localize("livingDocs.collapseReviewRail", "Collapse");
		const collapse = append(tabs, $('button.ldp-collapse', { 'aria-label': collapseLabel, 'tabindex': '0' })) as HTMLButtonElement;
		collapse.appendChild($(ThemeIcon.asCSSSelector(Codicon.chevronRight)));
		this._renderDisposables.add(this.hoverService.setupDelayedHover(collapse, () => ({ content: collapseLabel })));
		this._renderDisposables.add(addDisposableListener(collapse, 'click', () => this._livingDocs.collapseReviewRail()));

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
			if (this._signedIn !== status.signedIn || this._readiness !== status.readiness || this._provider !== status.provider || modelsChanged) {
				this._signedIn = status.signedIn;
				this._readiness = status.readiness;
				this._provider = status.provider;
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

		// One shared shape for the three states below: a 6px state dot, a plain sentence, and a fix-it link.
		// Written once because the three lines differ only in their words - the geometry is the design system's
		// "a dot plus a sentence" state atom, and three copies of it drift.
		const stateRow = (dotColour: string): { text: HTMLElement } => {
			const row = append(footer, $('div'));
			row.style.cssText = `display:flex;align-items:center;gap:6px;padding:0 2px;font:${TYPE.secondary};color:${INK.secondary}`;
			const dot = append(row, $('span'));
			dot.style.cssText = `width:6px;height:6px;flex:none;border-radius:${RADIUS.pill};background:${dotColour}`;
			return { text: append(row, $('span')) };
		};
		const fixItLink = (parent: HTMLElement, label: string): void => {
			const link = append(parent, $('button')) as HTMLButtonElement;
			link.style.cssText = `border:none;background:transparent;padding:0;font:600 12.5px/1.5 ${FONT.sans};color:${INDIGO.base};cursor:pointer`;
			link.textContent = label;
			this._renderDisposables.add(addDisposableListener(link, 'click', openModelAccess));
		};

		// Model genuinely unavailable, or the day's included usage is spent: an honest state + a fix-it link.
		if (this._readiness === 'broker-down' || this._readiness === 'unconfigured' || this._readiness === 'budget-paused') {
			// The dot is the same honest readiness -> colour mapping the composer's model control uses, so the two
			// state reports on the same surface can never disagree.
			const { text } = stateRow(modelHealthDotColour(this._readiness));
			text.textContent = this._readiness === 'budget-paused' ? 'Daily limit reached · ' : 'Model unavailable · ';
			fixItLink(text, 'Open model access');
			return;
		}

		// Ready + signed in to ChatGPT but the INCLUDED model is the door that answered (plan 51 WP-D; the #120/#259
		// fallback): say so honestly here too, not only on the Model Access screen. Driven from /healthz truth
		// (signedIn AND the serving provider is 'included'), never invented - so the composer never falls silent on
		// a state where the user is signed in yet ChatGPT is not the door serving them. A fix-it link opens Model
		// Access for the full explanation. When ChatGPT actually serves (provider 'chatgpt'), this does not fire.
		if (this._signedIn === true && this._provider === 'included') {
			// Amber: this is a "waiting on you" state - the door you chose is not the door answering.
			const { text } = stateRow(AMBER.base);
			text.textContent = localize('livingDocs.composer.signedInFallback', "Signed in to ChatGPT, but the included model is serving · ");
			fixItLink(text, localize('livingDocs.composer.signedInFallbackLink', "Details"));
			return;
		}

		// Ready. Only invite sign-in while signed OUT; once signed in to ChatGPT there is nothing to nag about.
		if (this._signedIn !== false) { return; }
		// Nothing is wrong here, so the dot carries no meaning colour: it is the neutral frame border.
		const { text } = stateRow(PAPER.frameBorder);
		text.textContent = 'Using the included model · ';
		fixItLink(text, 'Sign in with ChatGPT');
		const tail = append(text, $('span'));
		tail.textContent = ' for unlimited.';
	}

	// Plan 42 slice L2 (issue #198): the inline sign-in vs included-model choice shown in the chat rail when a
	// send hit an unconfigured backend. Rendered above the composer with the typed prompt already visible in the
	// transcript, so choosing a door replays the ORIGINAL request (the service holds and replays the prompt).
	// While the ChatGPT sign-in round-trip is in flight this shows the "open the sign-in page" affordance + a
	// spinner; a completed sign-in (or the included pick) replays the prompt and the choice disappears.
	private _renderInlineModelChoice(footer: HTMLElement, doc: URI): void {
		const card = append(footer, $('div'));
		card.style.cssText = `border:1px solid ${INDIGO.tintBorder};border-radius:${RADIUS.card};background:${PAPER.card};padding:14px 15px;box-shadow:${SHADOW.card}`;

		const title = append(card, $('div'));
		title.style.cssText = `font:${TYPE.uiBodyStrong};color:${INK.heading};margin:0 0 4px`;
		title.textContent = localize('livingDocs.inlineModel.title', "Choose how to run your request");
		const sub = append(card, $('div'));
		sub.style.cssText = `font:${TYPE.secondary};color:${INK.secondary};margin:0 0 13px`;
		sub.textContent = localize('livingDocs.inlineModel.sub', "Your message is ready to send. Pick a model to answer it - your typed prompt is kept either way.");

		// The pending sign-in state (plan 51 device auth): once the user clicks "Sign in with ChatGPT" we show
		// the device code (copyable in one click) + a clickable verification link (never popup-dependent) + a
		// spinner, and poll the flow at the broker's interval. A completed sign-in replays the held prompt.
		if (this._inlineSignInPending) {
			const waiting = append(card, $('div'));
			waiting.style.cssText = `display:flex;align-items:center;gap:9px;font:600 12.5px/1 ${FONT.sans};color:${INK.bodySoft};margin:0 0 12px`;
			const spin = append(waiting, $('span'));
			spin.style.cssText = `width:12px;height:12px;border:2px solid ${PAPER.control};border-top-color:${INDIGO.base};border-radius:${RADIUS.pill};animation:lwdSpin .8s linear infinite`;
			append(waiting, $('span')).textContent = localize('livingDocs.inlineModel.waiting', "Waiting for you to finish signing in…");
			// The device code: shown large, copyable in one click. Absent only if the broker omitted it.
			if (this._inlineSignInUserCode) {
				const codeRow = append(card, $('div'));
				codeRow.style.cssText = 'display:flex;align-items:center;gap:9px;flex-wrap:wrap;margin:0 0 12px';
				const code = append(codeRow, $('span'));
				code.style.cssText = `font:600 18px/1 ${FONT.mono};letter-spacing:${TRACKING.kindBadge};color:${INK.heading};background:${PAPER.sunken};border:1px solid ${PAPER.sunkenBorder};border-radius:${RADIUS.input};padding:10px 14px;user-select:all`;
				code.textContent = this._inlineSignInUserCode;
				const copy = append(codeRow, $('button')) as HTMLButtonElement;
				copy.style.cssText = `border:1px solid ${PAPER.control};background:${PAPER.card};border-radius:${RADIUS.control};padding:9px 13px;font:600 12.5px/1 ${FONT.sans};color:${INK.body};cursor:pointer`;
				copy.textContent = localize('livingDocs.inlineModel.copyCode', "Copy code");
				this._renderDisposables.add(addDisposableListener(copy, 'click', () => {
					const codeText = this._inlineSignInUserCode ?? '';
					const restore = () => { copy.textContent = localize('livingDocs.inlineModel.copyCode', "Copy code"); };
					copy.textContent = localize('livingDocs.inlineModel.copied', "Copied");
					this._clipboardService.writeText(codeText).finally(() => setTimeout(restore, 1400));
				}));
			}
			if (this._inlineSignInUrl) {
				const open = append(card, $('a')) as HTMLAnchorElement;
				open.href = this._inlineSignInUrl;
				open.style.cssText = `display:inline-flex;align-items:center;gap:7px;border-radius:${RADIUS.control};padding:10px 16px;background:${INDIGO.base};color:#fff;font:600 12.5px/1 ${FONT.sans};text-decoration:none;cursor:pointer`;
				open.textContent = localize('livingDocs.inlineModel.openSignIn', "Open the sign-in page");
				this._renderDisposables.add(addDisposableListener(open, 'click', (e: MouseEvent) => { e.preventDefault(); this.openerService.open(URI.parse(this._inlineSignInUrl!), { openExternal: true }); }));
			}
			return;
		}

		// An honest inline error from the last attempt (plan 51): the local model helper isn't running, or
		// upstream rejected. Shown above the choice so the user can read the real reason and try again.
		if (this._inlineSignInError) {
			const err = append(card, $('div'));
			// A failure block, so it wears the removed/failed fill - no border, because the fill IS the signal.
			err.style.cssText = `font:${TYPE.secondary};color:${RED.blockInk};background:${RED.blockBg};border-radius:${RADIUS.control};padding:9px 11px;margin:0 0 12px`;
			err.textContent = this._inlineSignInError;
		}

		const buttons = append(card, $('div'));
		buttons.style.cssText = 'display:flex;flex-direction:column;gap:9px';

		// "Sign in with ChatGPT" - the user's own subscription (unlimited); starts the same device-auth flow the
		// settings screen uses, kept in place so the held prompt replays once the round-trip lands signed-in.
		const signIn = append(buttons, $('button')) as HTMLButtonElement;
		signIn.style.cssText = `border:none;border-radius:${RADIUS.input};padding:11px 16px;background:${INDIGO.base};color:#fff;font:${TYPE.uiBodyStrong};cursor:pointer;text-align:left`;
		signIn.textContent = localize('livingDocs.inlineModel.signIn', "Sign in with ChatGPT - use your own plan, no limit");
		this._renderDisposables.add(addDisposableListener(signIn, 'click', () => void this._inlineSignIn(doc)));

		// "Use the included model" - the free metered tier; selects it and replays the prompt immediately.
		const included = append(buttons, $('button')) as HTMLButtonElement;
		included.style.cssText = `border:1px solid ${PAPER.control};border-radius:${RADIUS.input};padding:11px 16px;background:${PAPER.card};color:${INK.body};font:${TYPE.uiBodyStrong};cursor:pointer;text-align:left`;
		included.textContent = localize('livingDocs.inlineModel.included', "Use the included model - free, a little each day");
		this._renderDisposables.add(addDisposableListener(included, 'click', () => void this._livingDocs.chooseIncludedModelAndReplay(doc)));
	}

	// Begin the ChatGPT sign-in from the inline choice (plan 51 device auth): fetch the device code + verification
	// link, open it externally, move to the pending state, and poll at the broker's interval until the round-trip
	// lands signed-in (then replay the held prompt) or resets. On failure, show the real reason in the choice card
	// instead of silently doing nothing. The poll re-reads the pending flag so a dismissal never leaves a spinner.
	private async _inlineSignIn(doc: URI): Promise<void> {
		this._inlineSignInError = undefined;
		const start = await this._livingDocs.startSignInForChat();
		if (!start.ok) {
			// Honest failure: name the real cause (broker unreachable / upstream rejected / broker error). The
			// reason is plain words from the service; an upstream rejection appends its forwarded status.
			this._inlineSignInError = start.kind === 'upstream-rejected' && typeof start.upstreamStatus === 'number'
				? localize('livingDocs.inlineModel.errorUpstream', "{0} (OpenAI responded with {1})", start.reason, String(start.upstreamStatus))
				: start.reason;
			this._render();
			return;
		}
		const openUri = start.verificationUriComplete ?? start.verificationUri;
		this._inlineSignInPending = true;
		this._inlineSignInUserCode = start.userCode;
		this._inlineSignInUrl = openUri;
		this._inlineSignInPollMs = Math.max(1000, start.interval * 1000);
		this.openerService.open(URI.parse(openUri), { openExternal: true });
		this._render();
		this._pollInlineSignIn(doc);
	}

	private _pollInlineSignIn(doc: URI): void {
		this._inlineSignInPoll.value = disposableTimeout(async () => {
			// The user dismissed or the prompt was replayed elsewhere: stop polling and drop the pending state.
			if (!this._livingDocs.getPendingModelPrompt(doc)) { this._resetInlineSignIn(); return; }
			const { stage, error } = await this._livingDocs.pollChatGptSignIn();
			if (stage === 'signed-in') {
				this._resetInlineSignIn();
				await this._livingDocs.completeSignInAndReplay(doc);
				return;
			}
			if (stage === 'expired' || stage === 'error') {
				this._resetInlineSignIn();
				this._inlineSignInError = error ?? (stage === 'expired'
					? localize('livingDocs.inlineModel.expired', "The sign-in code expired. Try again to get a fresh one.")
					: localize('livingDocs.inlineModel.errorGeneric', "Sign-in didn't complete. Please try again."));
				this._render();
				return;
			}
			this._pollInlineSignIn(doc);
		}, this._inlineSignInPollMs);
	}

	// Drop the in-flight inline sign-in state (pending flag, code, link). Leaves any error untouched so a caller
	// can set one after resetting.
	private _resetInlineSignIn(): void {
		this._inlineSignInPending = false;
		this._inlineSignInUserCode = undefined;
		this._inlineSignInUrl = undefined;
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

	/**
	 * The Review tab is the LEDGER (comp 2b): a snapshot promise, then one card per outstanding decision - a
	 * MEANING card for each judgement call and a single FIGURES card grouping that document's low-risk value
	 * updates - closed by a foot that counts what is left and offers the bulk verb, quietly.
	*
	 * The grouping is what makes the rail readable past three changes. Four near-identical figure cards read as
	 * four decisions when they are really one; folding them into a card that shows every transition as a line
	 * keeps each one checkable while asking for a single answer, and "Each…" always breaks the group back apart.
	*
	 * The rail spans EVERY document with pending changes, not only the one on screen, which the comp has no
	 * need to show. So a section label naming the document stays, and it carries that document's own bulk verbs
	 * ONLY while more than one document is in play - with a single document the foot already says it, and a
	 * bulk verb repeated is a bulk verb pressed by accident.
	 */
	private _renderReview(content: HTMLElement, pending: readonly IProposedChange[]): void {
		// Group pending changes by the document they belong to.
		const groups = new Map<string, typeof pending[number][]>();
		for (const change of pending) {
			const list = groups.get(change.docTitle) ?? [];
			list.push(change);
			groups.set(change.docTitle, list);
		}

		const status = append(content, $('div.ldr-status'));
		// The promise the comp opens the ledger with, and it is one the product keeps: `approveAll` /
		// `approveAllPending` both snapshot first (plan 26), so History can always restore.
		// The empty state is on the entry path (the rail's Review tab is reachable before any AI/source use),
		// so it stays markdown-first (plan 42 L3): it says what the tab is FOR -- agent edits land here to
		// review -- without the "Living Document" / "Refresh from sources" ceremony a fresh user has not met yet.
		status.textContent = pending.length
			? localize('livingDocs.review.snapshotPromise', "A snapshot is taken before any bulk approve - you can always restore.")
			: localize("livingDocs.review.empty", "No changes waiting. When the agent proposes an edit, it lands here for you to review.");

		const multiDoc = groups.size > 1;
		for (const [docTitle, changes] of groups) {
			const group = append(content, $('div.ldr-group'));
			const docId = changes[0].docId;

			const groupHeader = append(group, $('div.ldr-group-head'));
			// The document title opens that document (so its inline diffs are visible), Cursor-style. The
			// whole label is the click target; the per-document Approve all / Reject all sit on the right.
			const titleBtn = append(groupHeader, $('button.ldr-group-title')) as HTMLButtonElement;
			titleBtn.title = localize('livingDocs.review.openDoc', "Open {0}", docTitle);
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

			if (multiDoc) {
				const groupActions = append(groupHeader, $('div.ldr-group-actions'));
				const approveAll = append(groupActions, $('button.ldr-quiet-btn')) as HTMLButtonElement;
				approveAll.textContent = localize('livingDocs.review.approveAllDoc', "Approve all {0}…", changes.length);
				this._renderDisposables.add(addDisposableListener(approveAll, 'click', async () => {
					// Bulk-approve safety net (plan 31 iter 4): confirm when the set includes any meaning change;
					// a version snapshot is taken first (plan 26). Figures-only bulk approves stay one-click.
					const confirm = bulkApproveConfirm(this._livingDocs.getPendingForDoc(URI.parse(docId)), true);
					if (confirm.needed) {
						const { confirmed } = await this._dialogService.confirm({ message: confirm.message, primaryButton: localize('livingDocs.review.approveAllConfirm', "Approve all") });
						if (!confirmed) { return; }
					}
					await this._livingDocs.approveAll(docId);
					this._openNextPending(docId);
				}));
				const rejectAll = append(groupActions, $('button.ldr-quiet-btn')) as HTMLButtonElement;
				rejectAll.textContent = localize('livingDocs.review.rejectAllDoc', "Reject all…");
				this._renderDisposables.add(addDisposableListener(rejectAll, 'click', () => void this._livingDocs.rejectAll(docId)));
			}

			// Meaning first, because a judgement call is what the reader is here for; the figures fold into one
			// card beneath it. Order within each kind is the order the agent proposed them.
			for (const change of changes) {
				if (change.kind === 'meaning') { this._appendChangeCard(group, change); }
			}
			const figures = changes.filter(c => c.kind !== 'meaning');
			if (figures.length === 1) {
				// One figure is not a group. Grouping it would put a bulk verb ("Approve 1 figures") on a single
				// decision, which is the exact ceremony the FIGURES card exists to remove.
				this._appendChangeCard(group, figures[0]);
			} else if (figures.length) {
				this._appendFiguresCard(group, docId, figures);
			}
		}

		// The rail foot (comp 2b): what is left to decide, and the bulk verbs - quiet, and confirmed. A bulk
		// verb is never a filled button here: filling it would make "approve everything" the easiest thing on
		// the surface, which is the opposite of what a review rail is for.
		if (pending.length) {
			const foot = append(content, $('div.ldr-foot'));
			const left = append(foot, $('span.ldr-foot-count'));
			// Literally true of what the rail is showing: a decided change leaves the pending set, so nothing
			// still on this surface has been decided. The rail keeps no memory of a batch, so the total is the
			// live count rather than a fabricated "started with N".
			left.textContent = localize('livingDocs.review.decided', "0 of {0} decided", pending.length);
			append(foot, $('span.ldr-spacer'));
			const rejectAll = append(foot, $('button.ldr-quiet-btn')) as HTMLButtonElement;
			rejectAll.textContent = localize('livingDocs.review.rejectAll', "Reject all…");
			this._renderDisposables.add(addDisposableListener(rejectAll, 'click', () => void this._livingDocs.rejectAllPending()));
			const approveAll = append(foot, $('button.ldr-quiet-btn')) as HTMLButtonElement;
			approveAll.textContent = localize('livingDocs.review.approveAll', "Approve all {0}…", pending.length);
			this._renderDisposables.add(addDisposableListener(approveAll, 'click', async () => {
				const confirm = bulkApproveConfirm(pending, true);
				if (confirm.needed) {
					const { confirmed } = await this._dialogService.confirm({ message: confirm.message, primaryButton: localize('livingDocs.review.approveAllConfirm', "Approve all") });
					if (!confirmed) { return; }
				}
				await this._livingDocs.approveAllPending();
			}));
		}

		// Document agents (the skill graders) are relocated to an on-demand disclosure at the bottom of
		// Review (v4 iter 4): collapsed by default so the Review tab matches the comp, expandable to reach
		// the wired v1 agents (Run / Re-run / Apply fix). The disclosure only shows for a living document.
		this._appendChecks(content);
	}

	/**
	 * One decision card (comp 2b): the kind badge and the address, the plain-words summary, the WAS/NOW pair,
	 * the provenance atom, then Approve / Reject.
	*
	 * The WAS/NOW pair replaces round 1's stacked red/green diff strip. Past roughly 60% of a paragraph
	 * rewritten a word-grain diff stops being readable (doc 28, "Diff"), and a rail card is where the whole
	 * replacement usually is - so the rail states the two versions and lets the document show the word grain.
	 */
	private _appendChangeCard(parent: HTMLElement, change: IProposedChange): void {
		const card = append(parent, $('div.ldr-card'));
		// Plan 52 WP-A1: the durable block id this card is about, so a deep link that reveals Review (a
		// transcript pointer whose change has no inline widget) can scroll to THIS card rather than dropping
		// the reader at the top of a list of every pending change across every document. It is the same id
		// the panel request already carries as its payload. Purely an anchor - the card renders unchanged.
		card.dataset.blockId = change.blockId;

		// The self-explaining framing (plan 31 iter 2): the same confidence word, rationale and source the
		// inline widget and cross-doc cards render, built from the one `reviewFraming`.
		const framing = reviewFraming(change, change.sourceCells.join(', '));

		const top = append(card, $('div.ldr-card-top'));
		const tag = append(top, $(change.kind === 'meaning' ? 'span.ldr-tag.attn' : 'span.ldr-tag.ok'));
		tag.textContent = this._kindBadgeLabel(change);
		append(top, $('span.ldr-spacer'));
		// Cite the same gutter address the inline widget cites (spec 43 section 3.1 / pin 11): resolve the
		// change's durable block id to its current display line against the live doc and render the shared
		// "Line N" string in the same mono treatment. Recomputed display-time; omitted (like the inline
		// widget) when the doc is not loaded or the block is gone.
		const changeDoc = this._livingDocs.getDoc(URI.parse(change.docId));
		const addressLine = changeDoc ? resolveBlockLine(changeDoc, change.blockId) : undefined;
		if (typeof addressLine === 'number') {
			// Pin 13.5: the "Line N" citation is a click target - it opens the change's document and scrolls
			// the editor to that block (navigate-only, via the address model's reveal-block seam). Rendered as
			// a button so it reads/behaves as the actionable address the gutter, Home cards and ledger share.
			this._appendAddressLink(top, change.docId, change.blockId, addressLine);
		}

		// The summary line. The comp bolds the reframing; what the rail actually knows is WHICH block is being
		// rewritten, so the block is what carries the weight, and the model's own rationale follows it in plain
		// words. Rationale only when the model supplied one (no "AI suggested this" filler, plan 31 iter 2).
		const summary = append(card, $('div.ldr-summary'));
		const lead = append(summary, $('strong'));
		lead.textContent = change.blockLabel;
		if (framing.rationale) {
			const rest = append(summary, $('span'));
			rest.textContent = ` ${framing.rationale}`;
		}

		// The WAS/NOW pair. Still the navigate-only jump into the document it always was (plan 19, E-A):
		// clicking it NEVER approves - the reader reads the change in full context and decides wherever
		// they like (the inline widget or the buttons below).
		const blocks = append(card, $('div.ldr-diff'));
		blocks.title = localize('livingDocs.review.openInDoc', "Open in the document");
		this._renderDisposables.add(addDisposableListener(blocks, 'click', () => void this._navigateToChange(change)));
		// An insertion has no previous version to show, so it renders as NOW alone rather than an empty WAS.
		if (!change.insert && change.oldText.trim()) {
			const was = append(blocks, $('div.ldr-o'));
			append(was, $('span.ldr-block-tag')).textContent = localize('livingDocs.review.was', "WAS");
			append(was, $('span')).textContent = ` ${change.oldText}`;
		}
		const now = append(blocks, $('div.ldr-n'));
		append(now, $('span.ldr-block-tag')).textContent = localize('livingDocs.review.now', "NOW");
		append(now, $('span')).textContent = ` ${change.newText}`;

		this._appendProvenance(card, framing.sourceLabel, [localize('livingDocs.review.confidence', "confidence: {0}", framing.confidence === 'high'
			? localize('livingDocs.review.confidence.high', "high")
			: localize('livingDocs.review.confidence.inferred', "inferred"))]);

		const actions = append(card, $('div.ldr-actions'));
		const approve = append(actions, $('button.ldr-approve')) as HTMLButtonElement;
		approve.textContent = localize('livingDocs.review.approve', "Approve");
		this._renderDisposables.add(addDisposableListener(approve, 'click', () => this._livingDocs.approve(change.id)));
		const reject = append(actions, $('button.ldr-reject')) as HTMLButtonElement;
		reject.textContent = localize('livingDocs.review.reject', "Reject");
		this._renderDisposables.add(addDisposableListener(reject, 'click', () => void this._rejectWithReason(change.id)));
	}

	/**
	 * The FIGURES card (comp 2b): one document's low-risk value updates, grouped into a single decision with
	 * every transition still shown as a line the reader can check.
	*
	 * Its bulk verb is a HAIRLINE button, not the indigo primary. Approving three figures at once is the right
	 * default and deserves to be easy, but it is still a bulk verb, and the design system reserves the one
	 * filled button for a single, scoped act. "Each…" beside it breaks the group into individual cards.
	 */
	private _appendFiguresCard(parent: HTMLElement, docId: string, figures: readonly IProposedChange[]): void {
		const mode = this._figuresMode.get(docId) ?? 'grouped';
		const card = append(parent, $(mode === 'each' ? 'div.ldr-figs-each' : 'div.ldr-card'));

		const head = append(card, $('div.ldr-card-top'));
		const tag = append(head, $('span.ldr-tag.figs'));
		tag.textContent = localize('livingDocs.review.figuresBadge', "FIGURES · {0}", figures.length);
		append(head, $('span.ldr-spacer'));
		const toggle = append(head, $('button.ldr-link')) as HTMLButtonElement;
		// The caret rides OUTSIDE the localized words: it is a direction, not language, and a translator has no
		// business receiving it (the same reason the icon-in-localized-string rule exists).
		toggle.textContent = mode === 'grouped'
			? `${localize('livingDocs.review.collapseFigures', "collapse")} \u25B4`
			: mode === 'collapsed'
				? `${localize('livingDocs.review.expandFigures', "expand")} \u25BE`
				: `${localize('livingDocs.review.groupFigures', "group")} \u25B4`;
		this._renderDisposables.add(addDisposableListener(toggle, 'click', () => {
			this._figuresMode.set(docId, mode === 'grouped' ? 'collapsed' : 'grouped');
			this._render();
		}));

		// Broken apart: each figure is its own card with its own controls, so the group's bulk verb is gone
		// (there is nothing left to bulk) and the head's link is the way back.
		if (mode === 'each') {
			for (const figure of figures) { this._appendChangeCard(card, figure); }
			return;
		}

		if (mode === 'grouped') {
			const list = append(card, $('div.ldr-figs'));
			for (const figure of figures) {
				const row = append(list, $('div'));
				append(row, $('span')).textContent = `${figure.blockLabel} ${figure.oldText} → `;
				append(row, $('strong')).textContent = figure.newText;
				const figDoc = this._livingDocs.getDoc(URI.parse(figure.docId));
				const line = figDoc ? resolveBlockLine(figDoc, figure.blockId) : undefined;
				if (typeof line === 'number') { this._appendAddressLink(row, figure.docId, figure.blockId, line); }
			}
			// One provenance atom for the whole group: the real, deduped source cells the figures were read
			// from, then the class that earns them their grouping.
			const cells = [...new Set(figures.flatMap(f => f.sourceCells))];
			this._appendProvenance(card, cells.join(', '), [localize('livingDocs.review.lowRisk', "low-risk class")]);
		}

		const actions = append(card, $('div.ldr-actions'));
		const approveFigures = append(actions, $('button.ldr-secondary')) as HTMLButtonElement;
		approveFigures.textContent = localize('livingDocs.review.approveFigures', "Approve {0} figures", figures.length);
		// Composed from the per-change approve the individual cards use, over ids captured before the first
		// call - so this approves exactly these figures and never the document's meaning changes with them.
		const figureIds = figures.map(f => f.id);
		this._renderDisposables.add(addDisposableListener(approveFigures, 'click', async () => {
			for (const id of figureIds) { await this._livingDocs.approve(id); }
		}));
		const each = append(actions, $('button.ldr-quiet-btn')) as HTMLButtonElement;
		each.textContent = localize('livingDocs.review.eachFigure', "Each…");
		this._renderDisposables.add(addDisposableListener(each, 'click', () => {
			this._figuresMode.set(docId, 'each');
			this._render();
		}));
	}

	/**
	 * The mono kind badge a card wears (doc 28: "Kind badges - mono, coloured by risk"). Built from the change
	 * itself so it is always true: which kind of edit it is, and whether it rewrites prose or adds new prose.
	 */
	private _kindBadgeLabel(change: IProposedChange): string {
		if (change.kind === 'meaning') {
			return change.insert
				? localize('livingDocs.review.kind.meaningNew', "MEANING · NEW")
				: localize('livingDocs.review.kind.meaningRewrite', "MEANING · REWRITE");
		}
		return change.insert
			? localize('livingDocs.review.kind.figureNew', "FIGURE · NEW")
			: localize('livingDocs.review.kind.figureUpdate', "FIGURE · UPDATE");
	}

	/**
	 * The one provenance atom the design system puts on every card (doc 28): where the change came from, then
	 * the facts that qualify it.
	*
	 * The source name is set in mono and inked indigo, the same treatment a bound figure wears in the document,
	 * so the reader recognises it as the thing standing behind the change. It is INK, not a control: the rail
	 * has no seam for opening a source file, and a link that goes nowhere is worse than a name that never
	 * promised to go anywhere. Nothing renders when there is neither a source nor a fact.
	 */
	private _appendProvenance(card: HTMLElement, sourceLabel: string, facts: readonly string[]): void {
		if (!sourceLabel && !facts.length) { return; }
		const line = append(card, $('div.ldr-prov'));
		let needsSeparator = false;
		if (sourceLabel) {
			append(line, $('span')).textContent = localize('livingDocs.review.from', "from ");
			append(line, $('span.ldr-prov-src')).textContent = sourceLabel;
			needsSeparator = true;
		}
		for (const fact of facts) {
			append(line, $('span')).textContent = needsSeparator ? ` · ${fact}` : fact;
			needsSeparator = true;
		}
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

	// Pin 13.5: render a clickable "Line N" address citation that scrolls the editor to the addressed block.
	// Shared by the Review cards and the chat meaning-change proposal cards so every rail surface speaks the same
	// address vocabulary AND makes it actionable. The label is the address-model string (`addressLabel`); clicking
	// opens the block's document and reveals the block via the reveal-block seam (navigate-only - never approves,
	// never re-tabs the rail). The durable block id is resolved to its current ordinal at click time, so a doc that
	// changed since render still lands on the right block and a deleted block degrades to opening the doc.
	private _appendAddressLink(parent: HTMLElement, docId: string, blockId: string, line: number): void {
		const addr = append(parent, $('button.ldr-card-addr')) as HTMLButtonElement;
		addr.textContent = addressLabel(line);
		addr.title = localize('livingDocs.address.reveal', "Go to {0} in the document", addressLabel(line));
		this._renderDisposables.add(addDisposableListener(addr, 'click', (e: MouseEvent) => {
			e.stopPropagation();
			void this._livingDocs.revealBlockAddress(URI.parse(docId), blockId);
		}));
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
					await this._livingDocs.reportChangeWrong({ changeRef: parsed.ref, comment, docTitle: parsed.title ?? '' });
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

		this._renderChatTabs(content);
		// "Chats mentioning this document" sits directly under the strip: it is a way of CHANGING which chat you
		// are in, so it belongs with the tabs rather than inside the conversation.
		this._renderChatMentions(content, doc);

		const scroll = append(content, $('div'));
		scroll.style.cssText = 'flex:1;min-height:0;overflow-y:auto;padding:14px 12px;display:flex;flex-direction:column;gap:16px';

		// Chat belongs to the workspace now (plan 52 WP-B), so a conversation reads with or without a document
		// open - only SENDING needs a document to act on, which the composer already gates.
		const messages = this._livingDocs.getChatMessages(doc ?? URI.from({ scheme: 'untitled', path: 'chat' }));
		if (messages.length === 0) {
			this._renderChatEmpty(scroll, doc);
		} else {
			// Whatever the storage caps dropped is named once, above the oldest turn that survived.
			this._renderChatTrimNotice(scroll);
			messages.forEach((m, i) => this._renderChatMessage(scroll, m, i === messages.length - 1));
		}

		if (doc && this._livingDocs.isChatBusy(doc)) {
			this._renderStreamingTurn(scroll, doc);
		}

		// The standing "something is waiting on you" note (comp 2a): an amber block, because amber is the one
		// colour that means a human decision is outstanding. It is a SENTENCE first - the chat narrates and
		// points, the document and the Review ledger own the decisions - which is the whole of the comp at n=1.
		//
		// The chat-level bulk verbs (plan 18: Accept all / Reject all across the WHOLE working set, criterion 2)
		// are kept, because they are the only route to a set that spans documents. But they are quiet text now,
		// and they appear only once there IS a set: at one change there is nothing to bulk, so the note simply
		// points at it.
		if (pendingCount > 0) {
			const pending = this._livingDocs.getAllPending();
			const docCount = new Set(pending.map(c => c.docId)).size;
			const note = append(scroll, $('div.ldp-waiting'));
			const line = append(note, $('div'));
			line.textContent = docCount > 1
				? localize('livingDocs.chat.waitingDocs', "{0} changes waiting on you across {1} documents - decide them in the document, or in Review.", pendingCount, docCount)
				: pendingCount === 1
					? localize('livingDocs.chat.waitingOne', "1 change waiting on you - decide it in the document.")
					: localize('livingDocs.chat.waitingMany', "{0} changes waiting on you - decide them in the document.", pendingCount);

			const actions = append(note, $('div.ldp-waiting-actions'));
			const reviewEach = append(actions, $('button.ldr-link')) as HTMLButtonElement;
			reviewEach.textContent = pendingCount > 1
				? localize('livingDocs.chat.reviewEach', "Review each")
				: localize('livingDocs.chat.reviewIt', "Review it");
			this._renderDisposables.add(addDisposableListener(reviewEach, 'click', () => { this._activeTab = 'review'; this._render(); }));
			if (pendingCount > 1) {
				const acceptAll = append(actions, $('button.ldr-quiet-btn')) as HTMLButtonElement;
				// Spans every document, not just the one in view (the chat instruction edited the whole set).
				acceptAll.textContent = localize('livingDocs.chat.approveAll', "Approve all {0}\u2026", pendingCount);
				this._renderDisposables.add(addDisposableListener(acceptAll, 'click', () => void this._livingDocs.approveAllPending()));
				const rejectAll = append(actions, $('button.ldr-quiet-btn')) as HTMLButtonElement;
				rejectAll.textContent = localize('livingDocs.chat.rejectAll', "Reject all\u2026");
				this._renderDisposables.add(addDisposableListener(rejectAll, 'click', () => void this._livingDocs.rejectAllPending()));
			}

			// Cursor-style changed-documents list: one row per changed doc with its +N/-N, clickable to open
			// that document (so its inline diffs show). Shown only when the change spans more than one doc.
			if (docCount > 1) {
				const list = append(note, $('div.ldp-waiting-docs'));
				for (const [docId, changes] of this._groupByDoc(pending)) {
					const stat = this._diffStat(changes);
					const row = append(list, $('button.ldp-waiting-doc')) as HTMLButtonElement;
					row.title = localize('livingDocs.review.openDocRow', "Open {0}", changes[0].docTitle);
					const nm = append(row, $('span.ldp-waiting-doc-name'));
					nm.textContent = `\u25A4 ${changes[0].docTitle}`;
					const st = append(row, $('span.ldp-waiting-doc-stat'));
					st.textContent = `+${stat.added} -${stat.removed}`;
					const arrow = append(row, $('span.ldp-waiting-doc-go'));
					arrow.textContent = '\u2192';
					this._renderDisposables.add(addDisposableListener(row, 'click', () => void this._editors.openEditor({ resource: URI.parse(docId) })));
				}
			}
		}

		this._renderChatComposer(content, doc);
	}

	/**
	 * The workspace chat tab strip (plan 52 WP-B, decision 178; redesigned for the residuals, issue #312).
	 * Chats belong to the workspace, so this is the only place that says which conversation you are in.
	*
	 * Three design decisions live here, and the first two changed in the residuals pass:
	*
	 * 1. The strip is ALWAYS drawn, even for a single chat. It used to appear only once a second conversation
	 *    existed - which meant the "+" that starts one was invisible until you had already found `Cmd+T`, and
	 *    a brand-new workspace showed no evidence that chats were a plural thing at all. One chat now reads as
	 *    one tab: the same shape, holding one.
	 * 2. How many tabs are shown is derived from the rail's real width (`visibleTabCap`), not from a fixed
	 *    count. The fixed count is what squeezed the third tab down to a single letter and an ellipsis - a tab
	 *    nobody can choose deliberately. Every visible tab is now at least `MIN_TAB_WIDTH` wide, and anything
	 *    that will not fit at that width goes to the overflow menu, where titles are shown in full.
	 * 3. The active tab is always on screen (`splitTabs` guarantees it), because a strip that hides the
	 *    conversation you are having is a strip that lies about where you are.
	*
	 * The sole tab carries no close box: closing the only chat immediately opens another (the strip is never
	 * empty), so an × there would promise something it cannot do. Start a new chat with "+" instead.
	*
	 * And a fourth, added in fix round 1 (#312): **below the width where even ONE tab clears `MIN_TAB_WIDTH`,
	 * the strip stops being a strip.** The first cut floored the cap at one, so the guaranteed-visible tab -
	 * the active one, the conversation you are actually in - was handed whatever pixels were left: 32px at a
	 * 151px rail, which draws as a bare close box with no title. That is the same "a tab nobody can choose"
	 * defect this pass set out to fix, landing on the worst possible tab. So at that width the surface becomes
	 * a PICKER: one full-width control naming the chat you are in, with a chevron opening every chat. It is
	 * honest (it does not claim to be a row of tabs), the title is readable because it has the whole strip to
	 * itself, and nothing becomes unreachable.
	 */
	private _renderChatTabs(content: HTMLElement): void {
		// The active session is asked for FIRST because asking is what creates one in a workspace that has never
		// chatted - read the list first and this render would draw an empty strip and wait for an event to fix it.
		const activeId = this._livingDocs.getActiveChatSession();
		const sessions = this._livingDocs.getChatSessions();
		if (!sessions.length) { return; }
		const cap = this._chatTabCap();
		const { visible, overflow } = splitTabs(sessions, activeId, cap);

		const strip = append(content, $('div'));
		// The strip carries a faint ground of its own so the active tab - which is the rail's own background -
		// reads as a TAB lifted out of it. Without it, a single white tab on a white rail reads as a text field
		// (caught in the live walk of the one-chat state). `overflow:hidden` is the belt to the cap's braces: a
		// tab that ran past the panel edge (as the first cut did) reads as a broken layout, not as "more chats".
		strip.style.cssText = `display:flex;align-items:center;gap:4px;padding:6px 8px 0;background:var(--vscode-editorGroupHeader-tabsBackground,${PAPER.sunken});border-bottom:1px solid var(--vscode-widget-border,${HAIRLINE.strong});flex:0 0 auto;overflow:hidden`;

		// The rail is too narrow for a strip: draw the picker described above instead of a titleless stub.
		if (cap === 0) {
			this._renderChatPicker(strip, sessions, activeId);
			this._appendNewChatButton(strip);
			return;
		}

		const soleTab = sessions.length === 1;
		for (const session of visible) {
			const isActive = session.id === activeId;
			const tab = append(strip, $('div'));
			// `flex:1 1 0` shares the strip's room evenly between the tabs that fit, so each one gets at least
			// MIN_TAB_WIDTH (which is how the cap was computed) - the ellipsis then trims a long title inside a
			// tab that is still wide enough to read, rather than trimming the tab itself out of existence.
			//
			// The font is written as LONGHANDS on purpose. It used to be a `font:` shorthand ending in
			// `var(--vscode-font-family)`, which is not defined in this workbench - and one invalid component
			// throws the WHOLE shorthand away, so the active tab's 600 weight never applied and the strip laid
			// itself out at the inherited 13px against a 96px minimum tuned for 12px (#312 fix round 1).
			tab.style.cssText = `display:flex;align-items:center;gap:4px;flex:1 1 0;min-width:0;max-width:180px;padding:5px 8px;border-radius:6px 6px 0 0;cursor:pointer;`
				+ `font-family:${FONT.sans};font-size:12px;line-height:1.2;font-weight:${isActive ? 600 : 400};color:${isActive ? INK.heading : INK.secondary};`
				+ `background:${isActive ? `var(--vscode-editor-background,${PAPER.card})` : 'transparent'};border:1px solid ${isActive ? `var(--vscode-widget-border,${HAIRLINE.strong})` : 'transparent'};border-bottom:none`;
			const label = append(tab, $('span'));
			label.textContent = session.title;
			label.style.cssText = 'flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
			this._renderDisposables.add(this.hoverService.setupManagedHover(getDefaultHoverDelegate('mouse'), tab, session.title));
			this._renderDisposables.add(addDisposableListener(tab, 'click', () => this._livingDocs.activateChatSession(session.id)));

			if (soleTab) { continue; }
			const close = append(tab, $('span'));
			close.textContent = '×';
			close.style.cssText = 'flex:none;opacity:.55;padding:0 2px;border-radius:3px';
			close.setAttribute('role', 'button');
			close.setAttribute('aria-label', localize('livingDocs.chat.closeTab', "Close Chat"));
			this._renderDisposables.add(addDisposableListener(close, 'click', e => {
				// The close box must not also activate the tab it is closing.
				e.stopPropagation();
				// Through the command, never through the service: closing deletes the conversation from workspace
				// storage with no undo, and the command is where the "close X? its N messages cannot be brought
				// back" question lives (#312 fix round 3). Calling the service here would be a route around it.
				void this._commands.executeCommand(CLOSE_CHAT_COMMAND_ID, session.id);
			}));
		}

		if (overflow.length) {
			// The overflow route has to look like a control, not like a caption: a bordered chip with a chevron,
			// which opens a menu listing every hidden chat. The menu is vertical, so it shows the whole derived
			// title rather than the strip's cut-off version - the title itself is still capped at TITLE_MAX.
			const more = append(strip, $('div'));
			more.style.cssText = `display:flex;align-items:center;gap:4px;flex:0 0 auto;padding:4px 7px;margin-bottom:1px;border:1px solid var(--vscode-widget-border,${HAIRLINE.strong});border-radius:6px;background:transparent;font-family:${FONT.sans};font-size:11.5px;line-height:1.2;font-weight:400;color:${INK.secondary};cursor:pointer;white-space:nowrap`;
			const moreLabel = append(more, $('span'));
			moreLabel.textContent = localize('livingDocs.chat.moreTabs', "{0} more", overflow.length);
			const moreChevron = append(more, $('span'));
			moreChevron.style.cssText = 'font-size:9px;opacity:.7';
			moreChevron.textContent = '\u25BE';
			more.setAttribute('role', 'button');
			this._renderDisposables.add(this.hoverService.setupManagedHover(getDefaultHoverDelegate('mouse'), more, localize('livingDocs.chat.moreTabsHint', "Show the other chats")));
			this._renderDisposables.add(addDisposableListener(more, 'click', e => {
				this.contextMenuService.showContextMenu({
					getAnchor: () => ({ x: e.clientX, y: e.clientY }),
					getActions: () => this._chatMenuActions(overflow, sessions, activeId),
				});
			}));
		}

		this._appendNewChatButton(strip);
	}

	/**
	 * The trailing "+". Shared by the strip and the narrow-rail picker, because "start another chat" is the one
	 * control that must survive every width - it is how a user discovers chats are plural without finding Cmd+T.
	 */
	private _appendNewChatButton(strip: HTMLElement): void {
		const add = append(strip, $('div'));
		add.textContent = '+';
		add.style.cssText = `flex:0 0 auto;margin-left:4px;padding:4px 8px;border-radius:6px;cursor:pointer;font-family:${FONT.sans};font-size:13px;line-height:1;font-weight:600;color:${INK.secondary}`;
		add.setAttribute('role', 'button');
		add.setAttribute('aria-label', localize('livingDocs.chat.newTab', "New Chat"));
		this._renderDisposables.add(this.hoverService.setupManagedHover(getDefaultHoverDelegate('mouse'), add, localize('livingDocs.chat.newTabHint', "New Chat (Cmd+T)")));
		this._renderDisposables.add(addDisposableListener(add, 'click', () => this._livingDocs.newChatSession()));
	}

	/**
	 * What the strip becomes when the rail is too narrow for a single tab at `MIN_TAB_WIDTH` (#312 fix round 1).
	*
	 * One control, the whole width the "+" does not need, reading as the chat you are in plus a chevron. The
	 * menu lists EVERY chat with the current one ticked, so nothing is less reachable than it was - it is the
	 * overflow menu doing the whole job rather than half of it. No close box: at this width there is no room
	 * for one, and a control that closes the only thing named on screen is not what a 150px rail is for.
	 */
	private _renderChatPicker(strip: HTMLElement, sessions: readonly IChatSession[], activeId: string): void {
		const active = sessions.find(s => s.id === activeId) ?? sessions[0];
		const picker = append(strip, $('div'));
		picker.style.cssText = `display:flex;align-items:center;gap:4px;flex:1 1 0;min-width:0;margin-bottom:1px;padding:4px 7px;border:1px solid var(--vscode-widget-border,${HAIRLINE.strong});border-radius:6px;`
			+ `background:var(--vscode-editor-background,${PAPER.card});font-family:${FONT.sans};font-size:12px;line-height:1.2;font-weight:600;color:${INK.heading};cursor:pointer`;
		const label = append(picker, $('span'));
		label.style.cssText = 'flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
		label.textContent = active.title;
		const chevron = append(picker, $('span'));
		chevron.style.cssText = 'flex:none;font-size:9px;opacity:.7';
		chevron.textContent = '\u25BE';
		picker.setAttribute('role', 'button');
		picker.setAttribute('aria-label', localize('livingDocs.chat.pickerLabel', "Chat: {0}. Choose another chat.", active.title));
		this._renderDisposables.add(this.hoverService.setupManagedHover(getDefaultHoverDelegate('mouse'), picker, localize('livingDocs.chat.pickerHint', "Choose a chat - the rail is too narrow for tabs")));
		this._renderDisposables.add(addDisposableListener(picker, 'click', e => {
			this.contextMenuService.showContextMenu({
				getAnchor: () => ({ x: e.clientX, y: e.clientY }),
				getActions: () => this._chatMenuActions(sessions, sessions, active.id),
			});
		}));
	}

	/**
	 * The rows behind the overflow chip and the narrow-rail picker: the chats you can switch to, and - since
	 * fix round 2 (#312) - the chats you can close.
	*
	 * `closeChatSession` had exactly ONE caller: the × on a visible tab. So closing a chat was only ever
	 * reachable from the tab you were already standing on. Below the width where the strip becomes a picker
	 * nothing could be closed at all, and at the default rail width with several chats only the active one
	 * could, because only the active one has a tab. Both holes are the same hole, and a "Close Chat" submenu in
	 * the menus that already exist closes it at every width for no pixels - which is why the picker still has
	 * no × of its own: it does not need one.
	*
	 * The submenu lists EVERY chat, not just the hidden ones, so the menu is a complete close route rather than
	 * half of one. It is absent for a sole chat, matching the sole tab's missing × - closing the only chat
	 * immediately opens another, so offering it there would promise something it cannot do.
	*
	 * Every close row runs the `Close Chat` COMMAND rather than the service (#312 fix round 3). This submenu is
	 * precisely where the destruction is cheapest to trigger by accident - a vertical list of similar, elided
	 * titles, where the row above the one you meant costs a whole conversation - so it must not be able to
	 * reach the primitive directly. The command names the chat it is about to close and asks.
	 */
	private _chatMenuActions(rows: readonly IChatSession[], all: readonly IChatSession[], activeId: string | undefined): IAction[] {
		const actions: IAction[] = rows.map((session: IChatSession) => toAction({
			id: `livingDocs.chat.session.${session.id}`,
			label: session.title,
			checked: session.id === activeId,
			run: () => this._livingDocs.activateChatSession(session.id),
		}));
		if (all.length > 1) {
			actions.push(new Separator());
			actions.push(new SubmenuAction('livingDocs.chat.closeSubmenu', localize('livingDocs.chat.closeMenu', "Close Chat"), all.map((session: IChatSession) => toAction({
				id: `livingDocs.chat.close.${session.id}`,
				label: session.title,
				run: () => void this._commands.executeCommand(CLOSE_CHAT_COMMAND_ID, session.id),
			}))));
		}
		return actions;
	}

	/**
	 * "Chats mentioning this document" (plan 52 WP-B residuals, issue #312) - the surface for the service's
	 * `getChatSessionsMentioning`, which until now had no caller at all.
	*
	 * The problem it answers: chat used to belong to the document, so opening a file showed you the thread you
	 * had had about it. Chats belong to the WORKSPACE now, which is right - a conversation survives navigation -
	 * but it took away the "what did I already say about this one?" reading. A document joins a chat's attach
	 * set the moment you chat while it is open, so that reading is recoverable: this row names the OTHER chats
	 * that have this document attached, and picking one activates it. Hidden entirely when there are none, so
	 * the common single-chat case pays nothing for it.
	 */
	private _renderChatMentions(content: HTMLElement, doc: URI | undefined): void {
		if (!doc) { return; }
		const activeId = this._livingDocs.getActiveChatSession();
		const others = this._livingDocs.getChatSessionsMentioning(doc).filter(session => session.id !== activeId);
		if (!others.length) { return; }
		const row = append(content, $('button')) as HTMLButtonElement;
		row.style.cssText = `display:flex;align-items:center;gap:6px;width:100%;box-sizing:border-box;flex:0 0 auto;border:none;border-bottom:1px solid var(--vscode-widget-border,${HAIRLINE.strong});background:transparent;padding:7px 12px;cursor:pointer;text-align:left`;
		const glyph = append(row, $('span'));
		glyph.style.cssText = `flex:none;font:400 11px/1 ${FONT.sans};color:${INK.meta}`;
		glyph.textContent = '\u25CB';
		const label = append(row, $('span'));
		label.style.cssText = `flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font:400 11.5px/1.3 ${FONT.sans};color:${INDIGO.base}`;
		label.textContent = others.length === 1
			? localize('livingDocs.chat.mentionedOnce', "1 other chat mentions this document")
			: localize('livingDocs.chat.mentionedMany', "{0} other chats mention this document", others.length);
		const chevron = append(row, $('span'));
		chevron.style.cssText = `flex:none;font:400 10px/1 ${FONT.sans};color:${INK.meta}`;
		chevron.textContent = '\u25BE';
		this._renderDisposables.add(this.hoverService.setupManagedHover(getDefaultHoverDelegate('mouse'), row, localize('livingDocs.chat.mentionedHint', "Open a chat that mentions this document")));
		this._renderDisposables.add(addDisposableListener(row, 'click', e => {
			this.contextMenuService.showContextMenu({
				getAnchor: () => ({ x: e.clientX, y: e.clientY }),
				getActions: () => others.map((session: IChatSession) => toAction({
					id: `livingDocs.chat.mentioning.${session.id}`,
					label: session.title,
					run: () => this._livingDocs.activateChatSession(session.id),
				})),
			});
		}));
	}

	/**
	 * The empty chat (plan 52 WP-B residuals): a fresh workspace's only conversation, or a new tab. It used to
	 * be one grey sentence floating in the middle of the rail, which read as "nothing here" rather than as an
	 * invitation. It now names the surface, says what it can do with the document in view, and - because the
	 * strip above it is now always drawn - sits under a visible "+" rather than under nothing.
	 */
	private _renderChatEmpty(scroll: HTMLElement, doc: URI | undefined): void {
		const empty = append(scroll, $('div'));
		empty.style.cssText = 'margin:auto 0;display:flex;flex-direction:column;align-items:center;gap:7px;text-align:center;padding:24px 14px';
		const mark = append(empty, $('span'));
		mark.style.cssText = `width:30px;height:30px;border-radius:${RADIUS.pill};background:${INDIGO.tint};color:${INDIGO.base};font:600 14px/30px ${FONT.sans}`;
		mark.textContent = '\u273B';
		const title = append(empty, $('div'));
		title.style.cssText = `font:${TYPE.uiBodyStrong};color:${INK.bodySoft}`;
		title.textContent = doc
			? localize('livingDocs.chat.emptyTitleDoc', "Ask about this document")
			: localize('livingDocs.chat.emptyTitleWorkspace', "Ask about this workspace");
		const hint = append(empty, $('div'));
		hint.style.cssText = `font:${TYPE.secondary};color:${INK.meta};max-width:260px`;
		hint.textContent = doc
			? localize('livingDocs.chat.emptyHintDoc', "Ask a question, or ask for a change - proposals land in the document for you to approve. @mention a source to pull it in.")
			: localize('livingDocs.chat.emptyHintWorkspace', "Open a document, or @mention one, to make changes to it.");
	}

	/**
	 * The honest header of a trimmed conversation (plan 52 WP-B residuals): what the storage caps left out.
	 * A trimmed transcript must never be presented as the whole of it - the count is stored alongside the
	 * messages exactly so this line can be true. Nothing is drawn when nothing was left out.
	*
	 * The tense is PRESENT, and that is the fix of round 2 (#312). It read "N earlier messages were not kept",
	 * which is exactly right after a restore - those messages really are gone - and wrong during a live
	 * session, where every one of them is still on screen above the notice and the number can go DOWN: a chat
	 * starved by a neighbour's fill reports 15, and is rescued back to 0 the moment you send a message in it,
	 * because the budget is spent on the active chat first. Past tense announces a loss that has not happened
	 * to the reader and may never happen at all. "Are not being kept" is true in both readings - it describes
	 * what storage holds right now - and the hover says which reading you are looking at.
	 */
	private _renderChatTrimNotice(scroll: HTMLElement): void {
		const dropped = this._livingDocs.getDroppedChatMessages();
		if (!dropped) { return; }
		const note = append(scroll, $('div'));
		note.style.cssText = `align-self:center;font:400 11px/1.4 ${FONT.sans};color:${INK.meta};background:${PAPER.chip};border-radius:${RADIUS.pill};padding:5px 11px`;
		note.textContent = dropped === 1
			? localize('livingDocs.chat.trimmedOne', "1 earlier message in this chat is not being kept")
			: localize('livingDocs.chat.trimmedMany', "{0} earlier messages in this chat are not being kept", dropped);
		this._renderDisposables.add(this.hoverService.setupManagedHover(getDefaultHoverDelegate('mouse'), note,
			localize('livingDocs.chat.trimmedHint', "This workspace keeps only the most recent part of each conversation. Messages still on screen are kept in memory, but will not be there after a restart.")));
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
		avatar.style.cssText = `flex:none;width:24px;height:24px;border-radius:${RADIUS.pill};background:${INDIGO.base};color:#fff;font:600 12px/24px ${FONT.sans};text-align:center`;
		if (!text) { avatar.style.animation = 'ldp-pulse 1.4s ease-in-out infinite'; }
		avatar.textContent = '\u273B';
		const col = append(row, $('div'));
		col.style.cssText = 'flex:1;min-width:0;display:flex;flex-direction:column;gap:10px';

		const stepsWrap = append(col, $('div'));
		this._appendStepsCard(stepsWrap, steps);

		const bodyWrap = append(col, $('p'));
		bodyWrap.style.cssText = `margin:0;font:400 13.5px/1.6 ${FONT.sans};white-space:pre-wrap;color:${INK.body}`;
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

	/**
	 * The agent's narration, shared by a settled assistant turn and the live streaming turn (comp 2a).
	*
	 * Round 1 drew this as a bordered mono card, which read as terminal output - a log the agent kept, sitting
	 * beside the prose it wrote. The comp draws it as what it is: sentences the agent is saying, in the
	 * secondary ink at a generous 1.8 line height, where only the MARKER carries colour. Green marks something
	 * the agent finished, indigo marks Abstract having acted (it proposed an edit), and a muted glyph marks a
	 * document policy told it to leave alone (issue #257). Renders nothing for no steps.
	 */
	private _appendStepsCard(parent: HTMLElement, steps: readonly IChatStep[]): void {
		if (!steps.length) { return; }
		const block = append(parent, $('div'));
		block.style.cssText = `display:flex;flex-direction:column;font:400 13px/1.8 ${FONT.sans};color:${INK.secondary}`;
		for (const step of steps) {
			const stepRow = append(block, $('div'));
			stepRow.style.cssText = 'display:flex;gap:7px;align-items:baseline';
			const skipped = step.status === 'skipped';
			const queued = step.status === 'queued';
			const glyph = append(stepRow, $('span'));
			glyph.style.cssText = `flex:none;color:${skipped ? INK.meta : queued ? INDIGO.base : GREEN.base}`;
			glyph.textContent = skipped ? '\u2298' : queued ? '\u270e' : '\u2713';
			const label = append(stepRow, $('span'));
			label.style.cssText = 'flex:1;min-width:0';
			label.textContent = step.label;
		}
	}

	private _renderChatMessage(scroll: HTMLElement, m: IChatMessage, isLast: boolean): void {
		if (m.role === 'user') {
			const wrap = append(scroll, $('div'));
			wrap.style.cssText = 'align-self:flex-end;max-width:88%;display:flex;flex-direction:column;align-items:flex-end;gap:6px';
			if (m.mentions && m.mentions.length) {
				const chips = append(wrap, $('div'));
				chips.style.cssText = 'display:flex;gap:5px;flex-wrap:wrap;justify-content:flex-end';
				for (const mention of m.mentions) {
					const chip = append(chips, $('span.ldp-context-chip'));
					chip.textContent = `@${mention}`;
				}
			}
			const bubble = append(wrap, $('div'));
			// Comp 2a: a chip-paper bubble, no border and no tail. The tail was drawing a speech balloon around
			// something that is not speech, and the border was a second edge on a surface the fill already sets
			// apart from the rail.
			bubble.style.cssText = `background:${PAPER.chip};border-radius:${RADIUS.input};padding:12px 14px;max-width:240px;font:${TYPE.uiBody};color:${INK.body};white-space:pre-wrap`;
			bubble.textContent = m.content;
			// The user's OWN question can be clipped too, and it is the message a user can most easily make long
			// enough to trigger it - a pasted brief runs to thousands of characters where a model reply rarely
			// does. This branch used to return before reaching the marker, so a question came back cut mid-word
			// and presented as the whole thing: the exact failure the marker exists to prevent, on the exact
			// message type most likely to hit it (#312 fix round 1).
			this._appendClippedNote(wrap, m);
			// A RESTORED question with nothing under it (plan 52 WP-B residuals): the app was closed while the
			// reply was still coming. The question is kept - it is what the user typed - and the missing answer is
			// named rather than left as a silence the reader has to interpret. Restoring never re-runs the ask.
			if (isLast && m.restored) {
				const note = append(wrap, $('span'));
				note.style.cssText = `font:400 11px/1.4 ${FONT.sans};color:${INK.meta}`;
				note.textContent = localize('livingDocs.chat.closedBeforeReply', "The app closed before the agent replied. Ask again to re-run this.");
			}
			return;
		}

		const row = append(scroll, $('div'));
		row.style.cssText = 'display:flex;gap:9px';
		const avatar = append(row, $('span'));
		avatar.style.cssText = `flex:none;width:24px;height:24px;border-radius:${RADIUS.pill};background:${INDIGO.base};color:#fff;font:600 12px/24px ${FONT.sans};text-align:center`;
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
			err.style.cssText = `display:flex;flex-direction:column;gap:9px;font:${TYPE.uiBody};color:${AMBER.label};background:${AMBER.bg};border:1px solid ${AMBER.border};border-radius:${RADIUS.input};padding:9px 11px`;
			const line = append(err, $('span'));
			line.textContent = m.content || 'The agent model is not reachable.';
			const list = append(err, $('div'));
			list.style.cssText = `display:flex;flex-direction:column;gap:3px;font:${TYPE.secondary};color:${AMBER.headline}`;
			for (const d of m.failedDocs) {
				const item = append(list, $('span'));
				item.textContent = `\u2022 ${d.title}`;
			}
			const retry = append(err, $('button')) as HTMLButtonElement;
			retry.style.cssText = `align-self:flex-start;border:1px solid ${PAPER.control};border-radius:7px;padding:5px 15px;background:${PAPER.card};color:${INK.body};font:600 12.5px/1 ${FONT.sans};cursor:pointer`;
			retry.textContent = 'Retry failed';
			this._renderDisposables.add(addDisposableListener(retry, 'click', () => { const d = this._activeDoc(); if (d) { this._livingDocs.retryFailedDocs(d); } }));
			// Fall through so any proposals this partial run DID land still render as review cards below.
			this._appendProposalPointers(col, m);
			return;
		}

		// A genuinely failed turn (plan 27 iter 3): an honest error line + an inline Retry that re-sends the
		// same user message (the service drops this failed turn and re-runs). No prose / proposals follow.
		if (m.failed) {
			const err = append(col, $('div'));
			err.style.cssText = `display:flex;flex-direction:column;gap:9px;font:${TYPE.uiBody};color:${AMBER.label};background:${AMBER.bg};border:1px solid ${AMBER.border};border-radius:${RADIUS.input};padding:9px 11px`;
			const line = append(err, $('span'));
			line.textContent = m.content || 'The model call failed.';
			const retry = append(err, $('button')) as HTMLButtonElement;
			retry.style.cssText = `align-self:flex-start;border:1px solid ${PAPER.control};border-radius:7px;padding:5px 15px;background:${PAPER.card};color:${INK.body};font:600 12.5px/1 ${FONT.sans};cursor:pointer`;
			retry.textContent = 'Retry';
			this._renderDisposables.add(addDisposableListener(retry, 'click', () => { const d = this._activeDoc(); if (d) { this._livingDocs.retryChat(d); } }));
			return;
		}

		const body = append(col, $('p'));
		const fallback = m.via === 'fallback';
		body.style.cssText = `margin:0;font:400 13.5px/1.6 ${FONT.sans};white-space:pre-wrap;color:${fallback ? AMBER.label : INK.body}${fallback ? `;background:${AMBER.bg};border:1px solid ${AMBER.border};border-radius:${RADIUS.input};padding:9px 11px` : ''}`;
		body.textContent = m.content || (m.stopped ? 'Stopped before the agent replied.' : '');

		// A stored answer the per-message character cap shortened (plan 52 WP-B residuals): say so, rather than
		// presenting the first few thousand characters as though they were the whole reply.
		this._appendClippedNote(col, m);

		// A stopped turn (D27-B) carries the salvaged prose plus a muted "stopped" tag, so it reads as a real
		// but deliberately-interrupted answer (never a silent truncation).
		if (m.stopped) {
			const tag = append(col, $('span'));
			tag.style.cssText = `align-self:flex-start;font:400 10.5px/1 ${FONT.mono};letter-spacing:${TRACKING.kindBadge};color:${INK.meta};background:${PAPER.chip};border-radius:${RADIUS.pill};padding:4px 7px`;
			tag.textContent = 'STOPPED';
		}

		// One compact pointer per proposal this turn produced (plan 52 WP-A1) - the document owns the controls.
		this._appendProposalPointers(col, m);
	}

	/**
	 * The "this was shortened when it was saved" line, for EITHER side of the conversation (#312 fix round 1).
	*
	 * It lives in one place because both message types need it and only one of them had it. The wording differs
	 * by role: calling the user's own pasted brief an "answer" would be wrong, and a reader who cannot tell
	 * which end of the exchange was cut cannot tell what they are missing. Nothing is drawn for a whole message,
	 * so an unclipped conversation pays nothing.
	 */
	private _appendClippedNote(parent: HTMLElement, m: IChatMessage): void {
		if (!m.clipped) { return; }
		const tag = append(parent, $('span'));
		// Sits under its own bubble, so it follows the side that bubble is on rather than always the left.
		tag.style.cssText = `align-self:${m.role === 'user' ? 'flex-end' : 'flex-start'};font:400 11px/1.4 ${FONT.sans};color:${INK.meta}`;
		tag.textContent = m.role === 'user'
			? localize('livingDocs.chat.clippedQuestion', "This message was shortened when it was saved.")
			: localize('livingDocs.chat.clipped', "This answer was shortened when it was saved.");
	}

	// Plan 52 WP-A1 (issue #301): one POINTER per proposal this turn produced - never a second copy of it.
	//
	// This used to render a full review card: the whole proposed sentence repeated verbatim, under its own
	// Apply / Reject. The document was already rendering the same change as an inline widget with its own
	// Edit / Approve changes / Reject, so a single pending change had two renderings and two live controls.
	// That is the "doesn't feel trustworthy" complaint: the reader cannot tell which one is the real change,
	// or what happens if they disagree. The document owns the controls now. The transcript keeps only enough
	// to know a change landed and where to go and read it: kind, section, "Line N", and the same word-run
	// counts the inline widget prints. No prose, no Apply, no Reject.
	//
	// Read from the LIVE pending set by id, so a pointer disappears the moment its change is approved or
	// rejected anywhere - the inline widget, the Review tab, Accept all. The transcript stays honest about
	// what is still open. Shared by the plain assistant turn and the F14 partial-failure turn.
	private _appendProposalPointers(col: HTMLElement, m: IChatMessage): void {
		// A turn read back from storage (plan 52 WP-B residuals, issue #312) carries a COUNT of the changes it
		// proposed, never their ids. Pending changes live in memory only, so a restart clears them and any stored
		// id would be a pointer that leads nowhere - the one thing a pointer must never be. The count is said
		// plainly instead, so a restored turn that proposed work still reads as having proposed work.
		if (m.restored) {
			// ...and it names what BECAME of them. It used to say one thing about every restored proposal -
			// "changes waiting for review are cleared when the workspace closes" - which is true of a change nobody
			// reviewed and false of one the user approved, which is on disk and in the History tab three inches
			// away (#312 fix round 2). The outcome is recorded as the user acts, so it is read off the record here
			// rather than assumed. The sentences themselves live in `describeRestoredProposals`, where they are
			// unit-tested; this branch only draws the one it is given.
			const note = describeRestoredProposals(m.proposedCount, m.approvedCount, m.rejectedCount);
			if (!note) { return; }
			const gone = append(col, $('div'));
			gone.style.cssText = `display:flex;align-items:center;gap:7px;border:1px dashed ${note.applied ? GREEN.border : HAIRLINE.strong};border-radius:${RADIUS.input};padding:7px 10px;font:400 11.5px/1.4 ${FONT.sans};color:${INK.meta}`;
			const kind = append(gone, $('span'));
			// An approved turn is the one outcome that LANDED, so its marker carries the same applied-green the
			// rest of the app uses for a change that is in the document. Everything else stays a muted record.
			kind.style.cssText = `flex:none;font:400 10.5px/1 ${FONT.mono};letter-spacing:${TRACKING.kindBadge};color:${note.applied ? GREEN.base : INK.meta}`;
			kind.textContent = note.tag;
			const line = append(gone, $('span'));
			line.style.cssText = 'flex:1;min-width:0';
			line.textContent = note.text;
			return;
		}
		if (!m.proposedIds || !m.proposedIds.length) { return; }
		const pointers = buildTurnPointers(
			m.proposedIds,
			this._livingDocs.getAllPending(),
			docId => this._livingDocs.getDoc(URI.parse(docId)),
			docId => this._livingDocs.getInlineWidgets(URI.parse(docId)),
		);
		if (!pointers.length) { return; }
		const list = append(col, $('div.ldp-pointers'));
		for (const pointer of pointers) {
			// Comp 2a draws the pointer as an INDIGO LINK - "Note to the board \u00b7 line 4 \u2193" - not as a card. The
			// card it used to be looked like a second copy of the change (the exact defect plan 52 WP-A1 removed
			// from the transcript); a link looks like what it is, a way to get to the one real copy.
			//
			// The whole pointer is still ONE click target: one control, one destination. A nested "Line N" button
			// (as the Review card carries) would be invalid inside it and would re-introduce a second thing to aim at.
			const row = append(list, $('button.ldp-pointer')) as HTMLButtonElement;
			// The tooltip says only what is KNOWN. A document that has never been opened has never reported, so the
			// honest promise is "take me there" - the click opens it, reads the report and picks the surface then.
			row.title = pointer.route === 'review'
				? localize('livingDocs.pointer.tip.review', "This change has no inline preview in the document. Open it in Review, where it can be read and approved.")
				: pointer.route === 'document'
					? localize('livingDocs.pointer.tip.document', "Go to this change in the document, where it can be read and approved.")
					: localize('livingDocs.pointer.tip.unknown', "Go to this change - in the document if it previews there, otherwise in Review.");

			// The section is what the reader navigates by, so it leads and gets the room; the rail is ~300px, and
			// sharing this line with everything else clipped "Commentary" to "Commen..." in the live walk.
			const where = append(row, $('span.ldp-pointer-where'));
			where.textContent = pointer.insert
				? localize('livingDocs.pointer.after', "after {0}", pointer.blockLabel)
				: pointer.blockLabel;
			// The shared address vocabulary (spec 43 section 3.1): the same "Line N" string the gutter, the inline
			// widget, the Review card and the ledger cite, so the transcript names the place the same way they do.
			if (typeof pointer.line === 'number') {
				const addr = append(row, $('span.ldp-pointer-addr'));
				addr.textContent = ` \u00b7 ${addressLabel(pointer.line)}`;
			}
			const go = append(row, $('span.ldp-pointer-go'));
			go.textContent = ' \u2193';

			// The quiet tail: how big the change is, and where this pointer actually goes. It stays because both
			// facts are load-bearing - the counts are the same word runs the inline widget prints, so the two can
			// never disagree, and the REVIEW marker is what stops a click landing on a paragraph with nothing on it.
			const meta = append(row, $('span.ldp-pointer-meta'));
			// An insertion has nothing to diff, so it carries no counts.
			if (typeof pointer.added === 'number' && typeof pointer.removed === 'number') {
				const stat = append(meta, $('span'));
				stat.textContent = localize('livingDocs.pointer.stat', "+{0} -{1}", pointer.added, pointer.removed);
			}
			// Say plainly where a review-routed pointer goes, rather than surprising the reader with a tab switch.
			// Only shown for an OBSERVED `review` - the document was asked to decorate this change and mounted
			// nothing. A pointer whose document has never been looked at wears no marker and promises nothing.
			if (pointer.route === 'review') {
				const hint = append(meta, $('span.ldp-pointer-hint'));
				hint.textContent = localize('livingDocs.pointer.hint.review', "REVIEW");
			}

			this._renderDisposables.add(addDisposableListener(row, 'click', () => void this._openPointer(pointer)));
		}
	}

	// Follow a transcript pointer to its change (plan 52 WP-A1). Navigate-only: this never approves anything.
	//
	// The invariant this method exists to hold is "a pointer can never land on nothing". The first cut tried to
	// hold it by PREDICTING, from the change's Markdown, whether the document would mount an inline widget for
	// it - and the prediction was wrong for whole block classes, which is precisely how a reader ends up staring
	// at a paragraph with no change on it. So nothing is predicted here any more. The document is asked, and
	// only its answer is acted on:
	//
	//   1. go to the document (which is where the change lives, and what mounts the surface that answers);
	//   2. read that document's widget report, waiting briefly when the click is what opened it;
	//   3. if the report does NOT name this change, reveal it in the Review tab, which always renders the full
	//      diff and Approve & apply / Reject.
	//
	// Step 3 is the fallback, and it fires on the evidence rather than on a rule about Markdown - so a block
	// class nobody has thought of yet still lands the reader somewhere readable.
	private async _openPointer(pointer: IChangePointer): Promise<void> {
		const resource = URI.parse(pointer.docId);
		// The change may have been approved or rejected between this pointer being drawn and being clicked. Open
		// its document anyway (the reader asked to go there) but reveal nothing - there is no change to land on.
		const change = this._livingDocs.getAllPending().find(c => c.id === pointer.changeId);
		if (!change) {
			await this._editors.openEditor({ resource });
			return;
		}
		// The plan-19 navigate-to-inline path the Review card's diff click already uses: open the document and
		// flash its widget. Reused rather than reimplemented, and it addresses the WIDGET (not the block), which
		// is the only thing that can land an insertion - an insertion has no block of its own to scroll to. When
		// the widget is there this is the whole interaction; when it is not, the scroll is harmless and the
		// reveal below carries the reader on to a surface that can actually show them the change.
		await this._navigateToChange(change);
		if (await this._landedOnInlineWidget(resource, change.id)) { return; }
		// The document says this change has no inline widget (#300 - a list, a table cell, or any block whose
		// Markdown carries syntax mounts nothing), or it never answered. Either way there is nothing here for the
		// reader to read, so reveal the change in the Review tab, which renders the full red/green diff and
		// Approve & apply / Reject for exactly this change.
		await this._livingDocs.reviewBlock(resource, pointer.blockId);
	}

	// The document's own answer to "did the reader just land on a real widget?" (plan 52 WP-A1 fix 1, fix 2).
	//
	// A document that has already reported on THIS change answers instantly - the common case, because every
	// render reports. Otherwise the answer is waited for: either the click is what opened the document (so its
	// first report is still in flight), or the change was proposed after the last decoration pass and the
	// surface has not been asked about it yet. Both are "nobody has looked", and neither is grounds to guess.
	//
	// The wait is bounded, and running out is answered `false`: a surface that has still said nothing is one the
	// reader is staring at without seeing their change, which is exactly the case Review exists to catch. So the
	// only way to stay in the document is a positive, observed "yes, it is mounted".
	//
	// Fix 2 (#301) closes the hole this method used to have: a recorded "mounted" was treated as a fact, and a
	// validator stranded a reader by closing a document, changing the file underneath it, and clicking - the
	// memory said "mounted", so nothing was revealed and nothing was on screen. Two things answer that. The
	// service now retires a report when the surface that made it stops watching that content (a closed editor, a
	// reload from disk), so a memory of a document nobody is looking at is never consulted at all. And a
	// remembered "mounted" is held open for one short beat below, long enough for a re-render already in flight
	// to correct it. Both only ever move the answer towards Review, which can render any change; neither can
	// keep a reader in a document that has nothing to show them.
	private _landedOnInlineWidget(resource: URI, changeId: string): Promise<boolean> {
		const known = inlineWidgetAnswer(this._livingDocs.getInlineWidgets(resource), changeId);
		if (known === undefined) {
			// Silence: nobody has looked at this change yet, or what looked at it has gone. Wait for a real
			// observation - there is nothing else honest to do.
			return this._awaitInlineWidgetReport(resource, changeId, POINTER_WIDGET_REPORT_TIMEOUT);
		}
		// Observed and NOT mounted: the surface tried and there is nothing there. Settled, and Review is the answer.
		if (!known) { return Promise.resolve(false); }
		// Observed and mounted - but observed BEFORE this click, and a render may be in flight right now (the reader
		// typed over the anchor, a source refresh landed, the file was reloaded). Give a fresher observation a beat
		// to overrule this one. It costs the reader nothing: the scroll-and-flash has already been asked for, so
		// this beat only delays the decision to ALSO open Review, which on a healthy widget is a decision to do
		// nothing at all.
		return this._awaitInlineWidgetReport(resource, changeId, POINTER_WIDGET_RECHECK_WINDOW);
	}

	// Resolve on this document's next report that covers `changeId`; if none arrives within `ms`, answer from
	// whatever the service holds AT THAT MOMENT.
	//
	// Reading the live report at the deadline rather than closing over the one this wait began with is the whole
	// point (plan 52 WP-A1 fix 2, #301): a captured value is a memory, and answering from a memory is the defect.
	// So every exit here is a live read, and anything short of a live report that names this change as mounted is
	// `false` - no report, a retired one, or one that has stopped naming this change all mean "nothing is known to
	// be on screen", and Review can render any change.
	private _awaitInlineWidgetReport(resource: URI, changeId: string, ms: number): Promise<boolean> {
		return new Promise(resolve => {
			// A local store, not `this._renderDisposables` and not `this._register`: this runs once per click, so
			// hanging it off the view would leak a listener and a timer per click for the view's whole lifetime.
			const store = new DisposableStore();
			const settle = (answer: boolean) => { store.dispose(); resolve(answer); };
			const readNow = () => inlineWidgetAnswer(this._livingDocs.getInlineWidgets(resource), changeId);
			store.add(this._livingDocs.onDidReportInlineWidgets(e => {
				if (e.docId !== resource.toString()) { return; }
				// Only a report that COVERS this change is an answer about it. A report that has simply not been asked
				// about it (or the report being retired) says nothing, so it must not cut the wait short.
				const answer = readNow();
				if (answer !== undefined) { settle(answer); }
			}));
			store.add(disposableTimeout(() => settle(readNow() ?? false), ms));
		});
	}

	// Reject one proposal, first offering an optional plain-words reason (1f frame-3: "the optional reason
	// becomes context for the next derivation"). Escape or an empty note still rejects - the reason is never
	// mandatory. The reason rides through reject() onto the audit row, which persists and shows it in History.
	private async _rejectWithReason(changeId: string): Promise<void> {
		const reason = await this._quickInput.input({
			prompt: localize('livingDocs.reject.reasonPrompt', "Why reject this change? (optional - Enter to reject, Escape to cancel)"),
			placeHolder: localize('livingDocs.reject.reasonPlaceholder', "e.g. the figure is stale, or this changes the meaning"),
			value: '',
		});
		// Escape returns undefined (the reviewer backed out - do not reject); an empty string rejects with no reason.
		if (reason === undefined) { return; }
		await this._livingDocs.reject(changeId, reason);
	}

	private _renderChatComposer(content: HTMLElement, doc: URI | undefined): void {
		const footer = append(content, $('div.ldp-composer-foot'));

		// Plan 42 slice L2 (issue #198): when the user's first send hit an unconfigured backend, the typed prompt
		// is held and the sign-in vs included-model choice renders INLINE here, right above the composer. The user
		// turn is already visible in the transcript, so the prompt is preserved; picking a door replays it. While
		// the choice is up we render it INSTEAD of the persistent sign-in hint (they would say the same thing).
		const pendingPrompt = doc ? this._livingDocs.getPendingModelPrompt(doc) : undefined;
		if (doc && pendingPrompt) {
			this._renderInlineModelChoice(footer, doc);
		} else {
			// The persistent, calm sign-in affordance (plan 38): one line above the composer while signed out.
			this._renderSignInHint(footer);
		}

		const mentions = doc ? this._livingDocs.getMentionableFiles(doc) : [];
		// Comp 2a puts the context chips ABOVE the box: what this message will be able to see, stated before
		// the thing you type into. Round 1 had them inside the box under the caret, where they read as part of
		// the draft rather than as its context. Created here (empty) and filled once `insertMention` exists.
		const chips = mentions.length ? append(footer, $('div.ldp-chips')) : undefined;

		const box = append(footer, $('div.ldp-composer'));

		// The working set: the documents this instruction edits across (plan 18, decision 60). A separate
		// row from the @mention "Attach" context chips above - these are edit targets, not data bindings.
		if (doc) { this._renderWorkingSetRow(box, doc); }

		const input = append(box, $('textarea')) as HTMLTextAreaElement;
		input.placeholder = doc ? 'Ask about this document, or run a skill\u2026' : 'Open a document to chat\u2026';
		input.value = this._chatDraft;
		input.rows = 2;
		input.disabled = !doc;
		input.style.cssText = `width:100%;box-sizing:border-box;border:none;outline:none;resize:none;background:transparent;font:400 13px/1.5 ${FONT.sans};color:${INK.body}`;
		this._renderDisposables.add(addDisposableListener(input, 'input', () => { this._chatDraft = input.value; this._composerPicker?.update(); }));
		// Caret-only moves (ArrowLeft/Right, Home/End, a mouse click) change `selectionStart` without an
		// `input` event, so re-sync the picker on keyup/click too - otherwise it lingers open with stale
		// matches and could insert the wrong one. `update()` closes it when the caret leaves an "@query".
		this._renderDisposables.add(addDisposableListener(input, 'keyup', () => this._composerPicker?.update()));
		this._renderDisposables.add(addDisposableListener(input, 'click', () => this._composerPicker?.update()));

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
		if (chips) {
			// #177: collapsed to the first few chips (two lines) with an expander so ~30 mentionable files no
			// longer bury the conversation. Expanding shows the full list; the choice survives the re-render each
			// message triggers but resets to collapsed next session. The expander is the comp's fullwidth plus - one more
			// thing this message could see - rather than round 1's ellipsis, which read as truncation.
			const { shown, hasMore } = collapseAttachChips(mentions, this._attachExpanded);
			for (const file of shown) {
				const chip = append(chips, $('button.ldp-context-chip')) as HTMLButtonElement;
				chip.textContent = `@${file}`;
				this._renderDisposables.add(addDisposableListener(chip, 'click', () => insertMention(file)));
			}
			if (hasMore || this._attachExpanded) {
				const toggle = append(chips, $('button.ldp-chip-more')) as HTMLButtonElement;
				toggle.textContent = this._attachExpanded ? localize('livingDocs.composer.showLess', "Show less") : '\uFF0B';
				toggle.title = this._attachExpanded
					? localize('livingDocs.composer.showFewerFiles', "Show fewer files")
					: localize('livingDocs.composer.showAllFiles', "Show all mentionable files");
				this._renderDisposables.add(addDisposableListener(toggle, 'click', () => {
					this._attachExpanded = !this._attachExpanded;
					this._render();
				}));
			}
		}

		const bar = append(box, $('div'));
		// P14.1 action row order: plus-Skill, at-mention, spacer, model control, send. The spacer (flex:1) pushes the
		// model control and send button to the right edge; gap 4px matches the mock's tight action-row rhythm.
		bar.style.cssText = 'display:flex;align-items:center;gap:4px;padding-top:8px';

		// + Skill: opens the same skill list that backs the Review disclosure; runs through the shared
		// runSkillCheck path. Only available when a living document is active (same gate as the disclosure).
		const skillReport = doc ? this._livingDocs.getSkillReport(doc) : [];
		const skillBtn = append(bar, $('button.ldp-composer-chip')) as HTMLButtonElement;
		skillBtn.textContent = '+ Skill';
		skillBtn.disabled = !doc || !skillReport.length;
		if (!doc || !skillReport.length) { skillBtn.style.opacity = '0.45'; }
		this._renderDisposables.add(addDisposableListener(skillBtn, 'click', () => {
			if (!doc) { return; }
			this._openSkillMenu(skillBtn, doc);
		}));

		// @ Mention: inserts a "@" and opens the caret-anchored picker (#178) so the user can type-to-filter
		// the mentionable files; selecting one inserts the token the message parser accepts (`@filename`).
		const mentionBtn = append(bar, $('button.ldp-composer-chip')) as HTMLButtonElement;
		mentionBtn.textContent = '@';
		mentionBtn.title = localize('livingDocs.composer.mention', "Mention a source");
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

		// P14.1 spacer: pushes the model control + send button to the right, leaving + Skill / @ on the left.
		const spacer = append(bar, $('div'));
		spacer.style.cssText = 'flex:1';

		// P14.2-P14.5 the quiet model control: mono 11px muted, 6px health dot + model id + a caret, metadata look
		// (no border/bg until hover). Click opens the grouped popover (P14.3). Rendered even with one model so
		// the surface stays consistent across the included tier and a signed-in ChatGPT; the health dot always
		// reflects the settled broker readiness (P14.5), so an honest state shows without flicker on crossings.
		this._renderModelControl(bar, box);

		const busy = !!doc && this._livingDocs.isChatBusy(doc);
		const submit = () => {
			if (!doc || busy) { return; }
			const text = input.value.trim();
			if (!text) { return; }
			this._chatDraft = '';
			void this._livingDocs.sendChatMessage(doc, text);
		};

		const action = append(bar, $('button.ldp-send')) as HTMLButtonElement;
		if (busy) {
			// While a reply streams the send button becomes a Stop square (plan 27 iter 3): it cancels the
			// in-flight call; the prose so far is kept as a muted "stopped" turn (D27-B). Esc cancels too.
			// It wears red because stopping a call in flight is the one destructive thing on this row.
			action.style.background = RED.base;
			action.textContent = '\u25a0';
			action.title = localize('livingDocs.composer.stop', "Stop");
			this._renderDisposables.add(addDisposableListener(action, 'click', () => this._livingDocs.cancelChat(doc!)));
		} else {
			// Comp 2a: a 24px round indigo send, carrying a white arrow.
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

		// The promise under the composer (comp 2a). It belongs here, at the moment of asking, because this is
		// where a reader decides how much to trust what they are about to set off - and the product keeps it:
		// every edit an agent produces lands as a pending change in this rail, never in the file.
		const promise = append(footer, $('div.ldp-composer-promise'));
		promise.textContent = localize('livingDocs.composer.proposalsOnly', "Edits land as proposals you review - nothing applies silently.");

		// Keep the cursor in the composer across the re-render that each message triggers.
		if (doc && !busy) { input.focus(); }
	}

	// The quiet model control (issue #236, plan 47 pin 14): mono 11px muted, a 6px health dot + the selected
	// model's label + a small caret, reading as metadata (no border/bg until hover). It sits on the composer action
	// row after the spacer (P14.1). Clicking it opens the grouped popover (P14.3). Rendered only once the
	// catalogue has resolved so nothing flashes before the truth is known; an empty catalogue (broker unreachable)
	// still renders the control with an honest "Model unavailable" state and the removed dot (P14.5), so the user
	// always sees the real broker state - never a fabricated "connected". Health comes from the SETTLED readiness
	// the service caches (P14.5, the #211-4 flicker fix), so the dot never blinks on Editor -> Home -> Editor.
	private _renderModelControl(bar: HTMLElement, box: HTMLElement): void {
		const models = this._models;
		const readiness = this._readiness;
		// Not yet probed AND no catalogue: render nothing to avoid a flash before the first truth resolves. Once
		// either resolves we render the control - with a real model label when we have one, else the honest state.
		if (readiness === undefined && (!models || !models.length)) { return; }

		const control = append(bar, $('button')) as HTMLButtonElement;
		// P14.2 metadata look: mono 11px in the meta ink, 26px tall, radius 7, NO border/bg until hover.
		control.style.cssText = `display:flex;align-items:center;gap:5px;flex:none;height:26px;padding:0 8px;border:none;border-radius:7px;background:transparent;color:${INK.meta};font:400 11px/1 ${FONT.mono};cursor:pointer;max-width:150px`;
		const dot = append(control, $('span'));
		dot.style.cssText = `width:6px;height:6px;flex:none;border-radius:999px;background:${modelHealthDotColour(readiness)}`;
		const label = append(control, $('span'));
		label.style.cssText = 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
		const selected = models?.find(m => m.id === this._selectedModelId);
		// The control names the model when we have one; otherwise it names the state in plain words (P14.5).
		label.textContent = selected ? selected.label : modelStateWords(readiness);
		const caret = append(control, $('span'));
		caret.style.cssText = `font-size:8px;flex:none;color:${INK.meta}`;
		caret.textContent = '\u25be';
		control.title = selected
			? localize('livingDocs.model.control.title', "Model: {0}", selected.label)
			: localize('livingDocs.model.control.titleState', "The model that answers your calls");
		// Hover reveals the control (P14.2): a quiet bg + darker text, matching the +Skill / @ chips' hover feel.
		this._renderDisposables.add(addDisposableListener(control, 'mouseenter', () => { control.style.background = PAPER.sunken; control.style.color = INK.body; }));
		this._renderDisposables.add(addDisposableListener(control, 'mouseleave', () => { control.style.background = 'transparent'; control.style.color = INK.meta; }));
		this._renderDisposables.add(addDisposableListener(control, 'click', () => this._openModelPopover(control, box)));
	}

	// The model popover (P14.3): the broker's models grouped by tier (included vs own-key, plan 35), the current
	// model checked, and a per-row health dot. Anchored above the control inside the composer box (like the
	// @mention picker), so it rides the rail's own DOM and needs no external layer. Selecting a model persists it
	// (P14.4) and switches the model used for the NEXT call, then closes. Registered on a local store torn down on
	// close or on the next composer re-render, so no listener leaks. Broker-down / empty catalogue: the popover
	// shows the honest state line rather than a fabricated list (P14.5), so the surface never lies.
	private _openModelPopover(anchor: HTMLElement, box: HTMLElement): void {
		// Toggle: a second click (or a re-open) closes any open popover first.
		this._modelPopover.clear();
		const store = new DisposableStore();
		this._modelPopover.value = store;

		const pop = append(box, $('div'));
		// Anchored above the control, right-aligned to the composer box; card styling matches the mention picker.
		pop.style.cssText = `position:absolute;right:9px;bottom:calc(100% + 4px);z-index:20;min-width:200px;max-width:260px;padding:5px;background:${PAPER.card};border:1px solid ${HAIRLINE.strong};border-radius:11px;box-shadow:${SHADOW.dialog}`;
		// Guard: swallow the mousedown that would otherwise bubble to the outside-dismiss listener below and
		// close the popover before a row's click lands.
		store.add(addDisposableListener(pop, 'mousedown', e => e.stopPropagation()));

		const models = this._models ?? [];
		const readiness = this._readiness;
		if (!models.length) {
			// Honest empty state (P14.5): the model genuinely cannot answer; no fabricated rows.
			const state = append(pop, $('div'));
			state.style.cssText = `display:flex;align-items:center;gap:7px;padding:9px 10px;font:400 11.5px/1.4 ${FONT.sans};color:${INK.meta}`;
			const sdot = append(state, $('span'));
			sdot.style.cssText = `width:6px;height:6px;flex:none;border-radius:999px;background:${modelHealthDotColour(readiness)}`;
			append(state, $('span')).textContent = modelStateWords(readiness);
		} else {
			// Group by tier: included first (the founder-funded fallback), then own-key (the user's subscription).
			// Only groups with members render a header, so a single-tier catalogue shows one clean section.
			const groups: { tier: ModelTier; heading: string }[] = [
				{ tier: 'included', heading: localize('livingDocs.model.group.included', "Included") },
				{ tier: 'own-key', heading: localize('livingDocs.model.group.ownKey', "Your subscription") },
			];
			for (const group of groups) {
				const rows = models.filter(m => m.tier === group.tier);
				if (!rows.length) { continue; }
				const heading = append(pop, $('div'));
				heading.style.cssText = `padding:6px 9px 3px;font:400 11px/1 ${FONT.mono};letter-spacing:${TRACKING.sectionLabel};text-transform:uppercase;color:${INK.meta}`;
				heading.textContent = group.heading;
				for (const model of rows) {
					const row = append(pop, $('button')) as HTMLButtonElement;
					const isCurrent = model.id === this._selectedModelId;
					row.style.cssText = `display:flex;align-items:center;gap:8px;width:100%;box-sizing:border-box;height:30px;padding:0 9px;border:none;border-radius:7px;background:transparent;color:${INK.body};font:400 12.5px/1 ${FONT.sans};cursor:pointer;text-align:left`;
					// Per-row health dot (P14.3): all of the active backend's models share its live readiness, so the
					// dot honestly mirrors the broker state per row rather than fabricating per-model health.
					const rdot = append(row, $('span'));
					rdot.style.cssText = `width:6px;height:6px;flex:none;border-radius:999px;background:${modelHealthDotColour(readiness)}`;
					const name = append(row, $('span'));
					name.style.cssText = 'flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
					name.textContent = model.label;
					// The current model carries a check (P14.3); the tick space is reserved so rows align.
					const check = append(row, $('span'));
					check.style.cssText = `flex:none;font-size:12px;color:${INDIGO.base};width:12px;text-align:center;visibility:${isCurrent ? 'visible' : 'hidden'}`;
					check.textContent = '✓';
					store.add(addDisposableListener(row, 'mouseenter', () => { row.style.background = INDIGO.tint; }));
					store.add(addDisposableListener(row, 'mouseleave', () => { row.style.background = 'transparent'; }));
					store.add(addDisposableListener(row, 'click', () => {
						this._modelPopover.clear();
						if (model.id === this._selectedModelId) { return; }
						this._selectedModelId = model.id;
						void this._livingDocs.setSelectedModelId(model.id);
					}));
				}
			}
		}

		// Dismiss on an outside pointer-down or Escape. The window is resolved from the control's own element so
		// the listener lands on the right window in a multi-window / webview scenario; the pop's own mousedown
		// (above) stops the bubble so an in-popover click never self-dismisses before it lands.
		const win = getWindow(anchor);
		store.add(addDisposableListener(win, 'mousedown', () => this._modelPopover.clear()));
		store.add(addDisposableListener(win, 'keydown', (e: KeyboardEvent) => { if (e.key === 'Escape') { this._modelPopover.clear(); } }));
		store.add({ dispose: () => pop.remove() });
	}

	// The working-set row in the composer: the documents a single instruction fans out across (plan 18).
	// Each is a removable chip; the "Add" affordance offers the whole folder or any single document. When
	// the set is empty the row is just the discoverable add affordance (no set -> single-doc chat, D-B).
	private _renderWorkingSetRow(box: HTMLElement, doc: URI): void {
		const set = this._livingDocs.getWorkingSet(doc);
		const row = append(box, $('div'));
		row.style.cssText = `display:flex;gap:5px;flex-wrap:wrap;align-items:center;padding:0 0 8px;border-bottom:1px solid ${HAIRLINE.soft};margin-bottom:8px`;

		const label = append(row, $('span'));
		label.style.cssText = `font:400 11px/1.6 ${FONT.sans};color:${INK.meta}`;
		label.textContent = set.length ? 'Editing:' : 'Edit across:';

		for (const wsDoc of set) {
			const chip = append(row, $('span'));
			chip.style.cssText = `display:inline-flex;align-items:center;gap:5px;font:400 11.5px/1 ${FONT.sans};color:${INK.body};background:${PAPER.chip};border-radius:${RADIUS.pill};padding:3px 5px 3px 10px`;
			const name = append(chip, $('span'));
			name.textContent = `\u25A4 ${wsDoc.title}`;
			const remove = append(chip, $('button')) as HTMLButtonElement;
			remove.style.cssText = `border:none;background:transparent;color:${INK.meta};cursor:pointer;font:600 13px/1 ${FONT.sans};padding:0 2px`;
			remove.textContent = '\u00D7';
			remove.title = `Remove ${wsDoc.title} from the working set`;
			this._renderDisposables.add(addDisposableListener(remove, 'click', () => this._livingDocs.removeFromWorkingSet(doc, wsDoc.resource)));
		}

		const add = append(row, $('button')) as HTMLButtonElement;
		add.style.cssText = `border:1px dashed ${PAPER.frameBorder};background:transparent;color:${INK.secondary};border-radius:${RADIUS.pill};padding:3px 10px;font:400 11.5px/1 ${FONT.sans};cursor:pointer`;
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

	// The + Skill picker in the composer: the SINGLE home for every capability the removed Skills tab carried
	// (pin 13.2, plan 20 Part F). It reads the same live grader report (getSkillReport) the old disclosure did and
	// surfaces, per skill: its status (annotated in the row label so PASS / FLAG / NO MODEL / READY reads at a
	// glance), a Run / Re-run action (the data-skill-run path), and - on a flagged, fixable skill - an Apply fix
	// action (the data-skill-fix path). Both actions route through the exact service methods the disclosure buttons
	// called (runSkillCheck / applySkillFix); no new run logic is introduced, so nothing from the Skills inventory
	// is dropped in the fold. The decorative "RUN ON EXPORT" toggle and "Add skill from library" affordance carried
	// no behaviour (no data-* hook, no handler), so they are cosmetic-only and are not resurrected here.
	private _openSkillMenu(anchor: HTMLElement, doc: URI): void {
		const report = this._livingDocs.getSkillReport(doc);
		if (!report.length) { return; }
		const statusLabel: Record<ISkillCheck['status'], string> = {
			pass: localize('livingDocs.skill.status.pass', "Pass"),
			flag: localize('livingDocs.skill.status.flag', "Flag"),
			'needs-model': localize('livingDocs.skill.status.needsModel', "No model"),
			ready: localize('livingDocs.skill.status.ready', "Ready"),
		};
		const actions: IAction[] = [];
		for (const s of report) {
			// A skill's primary action mirrors its disclosure button: Re-run once it has passed, Run otherwise.
			const runVerb = s.status === 'pass'
				? localize('livingDocs.skill.rerun', "Re-run {0}", s.name)
				: localize('livingDocs.skill.run', "Run {0}", s.name);
			if (s.canRun) {
				actions.push(toAction({
					id: `livingDocs.skill.run.${s.id}`,
					label: localize('livingDocs.skill.runRow', "{0} · {1}", runVerb, statusLabel[s.status]),
					run: () => { this._livingDocs.runSkillCheck(doc, s.id); },
				}));
			}
			// Apply fix rides the same data-skill-fix path the disclosure surfaced: a flagged skill with a
			// deterministic one-tap edit (e.g. Formatting heading-case). Kept out of the fold would silently drop
			// a real capability, so it is offered here alongside the run action.
			if (s.fixable && s.status === 'flag') {
				actions.push(toAction({
					id: `livingDocs.skill.fix.${s.id}`,
					label: localize('livingDocs.skill.applyFix', "Apply fix for {0}", s.name),
					run: () => { void this._livingDocs.applySkillFix(doc, s.id); },
				}));
			}
		}
		this.contextMenuService.showContextMenu({ getAnchor: () => anchor, getActions: () => actions });
	}

	private _injectStyles(container: HTMLElement): void {
		if (this._stylesInjected) { return; }
		this._stylesInjected = true;
		const style = document.createElement('style');
		style.textContent = `
		/* The rail is a paper surface (doc 28): the rails step of the canvas -> frame -> rail -> page -> card
		nest, so a white card sitting on it reads as lifted without needing a shadow to say so. */
		.living-docs-panel{display:flex;flex-direction:column;height:100%;font:${TYPE.uiBody};color:${INK.body};background:${PAPER.rail}}
		/* Comp 2a/2b tab strip: no chip, no fill. An inactive tab is 13/400 meta ink; the active one darkens to
		heading ink at 600 and carries a 2px indigo underline 4px below its label - the only mark on the strip. */
		.living-docs-panel .ldp-tabs{display:flex;align-items:center;gap:16px;flex:none;height:44px;padding:0 18px}
		.living-docs-panel .ldp-tab{border:none;background:transparent;padding:0 0 4px;font:400 13px/1 ${FONT.sans};color:${INK.meta};cursor:pointer;display:flex;align-items:center;gap:6px;border-bottom:2px solid transparent}
		.living-docs-panel .ldp-tab:hover{color:${INK.secondary}}
		.living-docs-panel .ldp-tab.active{color:${INK.heading};font-weight:600;border-bottom-color:${INDIGO.base}}
		.living-docs-panel .ldp-tab-count{box-sizing:border-box;text-align:center;font:400 10px/1.5 ${FONT.sans};color:#fff;background:${AMBER.base};border-radius:${RADIUS.pill};padding:1px 6px}
		.living-docs-panel .ldp-collapse{margin-left:auto;align-self:center;border:none;background:transparent;border-radius:6px;padding:5px;color:${INK.meta};cursor:pointer;display:flex;align-items:center}
		.living-docs-panel .ldp-collapse:hover{color:${INK.heading};background:${PAPER.chip}}
		.living-docs-panel .ldp-collapse:focus-visible{outline:2px solid ${INDIGO.base};outline-offset:1px}
		.living-docs-panel .ldp-collapse .codicon{font-size:14px}
		.living-docs-panel .ldp-content{flex:1;overflow-y:auto}
		.living-docs-panel .ldr-content,.living-docs-panel .ldp-content{padding:16px 18px}
		.living-docs-panel .ldr-spacer{flex:1}

		/* --- the Review ledger (comp 2b) --- */
		.living-docs-panel .ldr-status{font:${TYPE.secondary};color:${INK.meta};margin-bottom:14px}
		.living-docs-panel .ldr-group{margin-bottom:16px}
		.living-docs-panel .ldr-group-head{display:flex;align-items:center;gap:8px;margin:2px 0 10px}
		.living-docs-panel .ldr-group-title{display:flex;align-items:center;gap:7px;border:none;background:transparent;padding:0;cursor:pointer;font:400 11px/1 ${FONT.mono};letter-spacing:${TRACKING.sectionLabel};color:${INK.meta};text-transform:uppercase;text-align:left}
		.living-docs-panel .ldr-group-title:hover span:first-child{text-decoration:underline}
		.living-docs-panel .ldr-group-count{font:400 10px/1.5 ${FONT.sans};letter-spacing:0;color:#fff;background:${AMBER.base};border-radius:${RADIUS.pill};padding:1px 6px}
		.living-docs-panel .ldr-group-stat{display:inline-flex;gap:6px;margin-left:auto;font:400 11px/1 ${FONT.mono}}
		.living-docs-panel .ldr-stat-add{color:${GREEN.base}}
		.living-docs-panel .ldr-stat-del{color:${RED.base}}
		.living-docs-panel .ldr-group-actions{display:flex;gap:2px}
		.living-docs-panel .ldr-card{display:flex;flex-direction:column;gap:10px;border:1px solid ${HAIRLINE.strong};border-radius:${RADIUS.card};padding:14px 16px;margin-bottom:12px;background:${PAPER.card}}
		.living-docs-panel .ldr-card-top{display:flex;align-items:center;gap:8px}
		.living-docs-panel .ldr-card-addr{border:none;background:transparent;padding:0;font:400 10.5px/1 ${FONT.mono};color:${INK.meta};flex:none;cursor:pointer}
		.living-docs-panel .ldr-card-addr:hover{color:${INDIGO.base};text-decoration:underline}
		.living-docs-panel .ldr-card-addr:focus-visible{outline:2px solid ${INDIGO.base};outline-offset:1px;border-radius:3px}
		/* Kind badges are mono and coloured by risk - no pill, because a filled chip reads as a permanent status. */
		.living-docs-panel .ldr-tag{font:400 10px/1 ${FONT.mono};letter-spacing:${TRACKING.kindBadge}}
		.living-docs-panel .ldr-tag.attn{color:${AMBER.label}}
		.living-docs-panel .ldr-tag.ok,.living-docs-panel .ldr-tag.figs{color:${GREEN.base}}
		.living-docs-panel .ldr-summary{font:400 13px/1.55 ${FONT.sans};color:${INK.body}}
		.living-docs-panel .ldr-summary strong{font-weight:600}
		/* The WAS/NOW pair: two blocks, not one bordered strip. The fill is the whole signal, which is why the
		red block carries no strikethrough - a struck-through paragraph is unreadable, and the reader has to
		read it to judge the replacement. */
		.living-docs-panel .ldr-diff{display:flex;flex-direction:column;gap:6px;cursor:pointer}
		.living-docs-panel .ldr-o{background:${RED.blockBg};color:${RED.blockInk};border-radius:7px;padding:8px 10px;font:400 12px/1.5 ${FONT.sans}}
		.living-docs-panel .ldr-n{background:${GREEN.blockBg};color:${GREEN.diffInk};border-radius:7px;padding:8px 10px;font:400 12px/1.5 ${FONT.sans}}
		.living-docs-panel .ldr-block-tag{font:400 9px/1 ${FONT.mono};letter-spacing:${TRACKING.kindBadge}}
		.living-docs-panel .ldr-prov{font:400 12px/1.45 ${FONT.sans};color:${INK.meta}}
		.living-docs-panel .ldr-prov-src{font-family:${FONT.mono};color:${INDIGO.base}}
		.living-docs-panel .ldr-figs{font:400 12.5px/1.9 ${FONT.sans};color:${INK.body}}
		.living-docs-panel .ldr-figs strong{font-weight:600}
		.living-docs-panel .ldr-figs .ldr-card-addr{margin-left:6px}
		.living-docs-panel .ldr-figs-each{display:flex;flex-direction:column}
		.living-docs-panel .ldr-figs-each > .ldr-card-top{margin:2px 0 8px}
		.living-docs-panel .ldr-actions{display:flex;align-items:center;gap:7px}
		/* One filled button per card, and it is always the single scoped act. */
		.living-docs-panel .ldr-approve{border:none;border-radius:7px;padding:5px 15px;background:${INDIGO.base};color:#fff;font:600 12.5px/1.4 ${FONT.sans};cursor:pointer}
		.living-docs-panel .ldr-approve:hover{background:${INDIGO.hover}}
		.living-docs-panel .ldr-reject{border:1px solid ${PAPER.control};border-radius:7px;padding:5px 12px;background:${PAPER.card};color:${INK.body};font:400 12.5px/1.4 ${FONT.sans};cursor:pointer}
		.living-docs-panel .ldr-reject:hover{background:${PAPER.sunken}}
		.living-docs-panel .ldr-secondary{border:1px solid ${PAPER.control};border-radius:7px;padding:5px 15px;background:${PAPER.card};color:${INK.body};font:600 12.5px/1.4 ${FONT.sans};cursor:pointer}
		.living-docs-panel .ldr-secondary:hover{background:${PAPER.sunken}}
		/* Every bulk verb in the product is quiet text plus a confirm - never a fill, never green or red. */
		.living-docs-panel .ldr-quiet-btn{border:none;background:transparent;border-radius:${RADIUS.control};padding:5px 10px;font:${TYPE.secondary};color:${INK.secondary};cursor:pointer}
		.living-docs-panel .ldr-quiet-btn:hover{background:${PAPER.chip};color:${INK.body}}
		.living-docs-panel .ldr-link{border:none;background:transparent;padding:0;font:400 11.5px/1.4 ${FONT.sans};color:${INDIGO.base};cursor:pointer}
		.living-docs-panel .ldr-link:hover{text-decoration:underline}
		.living-docs-panel .ldr-foot{display:flex;align-items:center;gap:10px;margin-top:2px;padding-top:12px;border-top:1px solid ${HAIRLINE.medium}}
		.living-docs-panel .ldr-foot-count{font:${TYPE.secondary};color:${INK.secondary}}
		.living-docs-panel .ldr-checks{margin-top:8px;padding-top:8px}

		/* --- the Chat tab (comp 2a) --- */
		.living-docs-panel .ldp-waiting{display:flex;flex-direction:column;gap:8px;border:1px solid ${AMBER.border};background:${AMBER.subtleBg};border-radius:${RADIUS.input};padding:11px 14px;font:400 13px/1.5 ${FONT.sans};color:${AMBER.label}}
		.living-docs-panel .ldp-waiting-actions{display:flex;align-items:center;gap:4px;flex-wrap:wrap}
		.living-docs-panel .ldp-waiting-docs{display:flex;flex-direction:column;gap:2px;border-top:1px solid ${AMBER.edge};padding-top:8px}
		.living-docs-panel .ldp-waiting-doc{display:flex;align-items:center;gap:8px;border:none;background:transparent;padding:5px 4px;border-radius:6px;cursor:pointer;text-align:left;font:400 12px/1.3 ${FONT.sans};color:${INK.body}}
		.living-docs-panel .ldp-waiting-doc:hover{background:${PAPER.card}}
		.living-docs-panel .ldp-waiting-doc-name{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
		.living-docs-panel .ldp-waiting-doc-stat{font:400 11px/1 ${FONT.mono};color:${INK.meta}}
		.living-docs-panel .ldp-waiting-doc-go{color:${INK.meta};font-size:12px}
		/* A transcript pointer is a LINK, not a card: it takes you to the one real copy of the change. */
		.living-docs-panel .ldp-pointers{display:flex;flex-direction:column;gap:2px}
		.living-docs-panel .ldp-pointer{display:flex;align-items:baseline;flex-wrap:wrap;width:100%;box-sizing:border-box;text-align:left;border:none;background:transparent;padding:1px 0;cursor:pointer;font:400 13px/1.6 ${FONT.sans};color:${INDIGO.base}}
		.living-docs-panel .ldp-pointer:hover .ldp-pointer-where{text-decoration:underline}
		.living-docs-panel .ldp-pointer-where{max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
		.living-docs-panel .ldp-pointer-addr{font-family:${FONT.mono};font-size:11.5px}
		.living-docs-panel .ldp-pointer-go{flex:none}
		.living-docs-panel .ldp-pointer-meta{display:inline-flex;align-items:baseline;gap:6px;margin-left:8px;font:400 10.5px/1.4 ${FONT.mono};color:${INK.meta}}
		.living-docs-panel .ldp-pointer-hint{letter-spacing:${TRACKING.kindBadge};background:${PAPER.chip};border-radius:${RADIUS.pill};padding:2px 6px}

		/* --- the composer (comp 2a) --- */
		.living-docs-panel .ldp-composer-foot{flex:none;display:flex;flex-direction:column;gap:8px;border-top:1px solid ${HAIRLINE.strong};padding:12px 18px 14px;background:${PAPER.rail}}
		.living-docs-panel .ldp-chips{display:flex;gap:6px;flex-wrap:wrap;align-items:center}
		.living-docs-panel .ldp-context-chip{border:none;font:400 11.5px/1.5 ${FONT.sans};color:${INDIGO.base};background:${INDIGO.tint};border-radius:${RADIUS.pill};padding:3px 10px;cursor:pointer}
		.living-docs-panel button.ldp-context-chip:hover{background:${INDIGO.tintBorder}}
		.living-docs-panel .ldp-chip-more{border:none;background:transparent;font:400 11.5px/1.5 ${FONT.sans};color:${INK.meta};padding:3px 4px;cursor:pointer}
		.living-docs-panel .ldp-chip-more:hover{color:${INK.secondary}}
		.living-docs-panel .ldp-composer{position:relative;border:1px solid ${HAIRLINE.strong};border-radius:${RADIUS.input};background:${PAPER.card};padding:10px 12px}
		.living-docs-panel .ldp-composer:focus-within{border-color:${INDIGO.tintBorder}}
		.living-docs-panel .ldp-composer-chip{border:1px solid ${PAPER.control};border-radius:${RADIUS.control};padding:4px 9px;background:transparent;color:${INK.secondary};font:400 11.5px/1 ${FONT.sans};cursor:pointer}
		.living-docs-panel .ldp-composer-chip:hover:not(:disabled){background:${PAPER.sunken};color:${INK.body}}
		.living-docs-panel .ldp-send{width:24px;height:24px;flex:none;border:none;border-radius:${RADIUS.pill};background:${INDIGO.base};color:#fff;font-size:12px;cursor:pointer;display:flex;align-items:center;justify-content:center}
		.living-docs-panel .ldp-send:hover:not(:disabled){background:${INDIGO.hover}}
		.living-docs-panel .ldp-composer-promise{font:400 11px/1.5 ${FONT.sans};color:${INK.meta}}

		.living-docs-panel .ldp-busy{display:flex;gap:9px;align-items:center}
		.living-docs-panel .ldp-busy-avatar{flex:none;width:24px;height:24px;border-radius:${RADIUS.pill};background:${INDIGO.base};color:#fff;font:600 12px/24px ${FONT.sans};text-align:center;animation:ldp-pulse 1.4s ease-in-out infinite}
		.living-docs-panel .ldp-busy-label{font:400 13px/1.8 ${FONT.sans};color:${INK.meta}}
		.living-docs-panel .ldp-busy-dots::after{content:"";animation:ldp-dots 1.4s steps(4,end) infinite}
		.living-docs-panel .ldp-caret{display:inline-block;width:2px;height:1.05em;margin-left:1px;vertical-align:text-bottom;background:${INDIGO.base};animation:ldp-blink 1s steps(2,start) infinite}
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
		// How many chat tabs the strip can show is a function of the rail's REAL width (plan 52 WP-B residuals):
		// see `visibleTabCap`. A resize that changes the answer has to re-render the strip, but a drag that never
		// crosses a boundary must cost nothing - so the cap, not the pixel width, is what is compared.
		const before = this._chatTabCap();
		this._railWidth = width;
		if (this._activeTab === 'chat' && this._chatTabCap() !== before) { this._render(); }
	}

	/** How many chat tabs fit at the rail's current width - the strip's cap, and the resize trigger above. */
	private _chatTabCap(): number {
		return visibleTabCap(this._railWidth, this._livingDocs.getChatSessions().length);
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
		? `<span style="margin-left:auto;font:400 10px/1.5 ${FONT.sans};letter-spacing:0;color:#fff;background:${AMBER.base};border-radius:${RADIUS.pill};padding:1px 6px">${flags}</span>`
		: '';
	const toggle = `<button data-checks-toggle style="display:flex;align-items:center;gap:8px;width:100%;border:none;background:transparent;border-top:1px solid ${HAIRLINE.medium};margin-top:8px;padding:13px 2px 11px;cursor:pointer;font:400 11px/1 ${FONT.mono};letter-spacing:${TRACKING.sectionLabel};color:${INK.meta};text-transform:uppercase">`
		+ `<span style="color:${INK.meta};font-size:11px">${chevron}</span>DOCUMENT AGENTS${flagBadge}</button>`;
	return toggle + (expanded ? skillsHtml(report, docTitle) : '');
}

// Skills (document agents) -- the agents that run on this document, on demand or before export.
// Data-driven from the live grader report (spec 5). Financial + Formatting are deterministic verdicts on
// the active document; Strategy reports a needs-model state. "Run"/"Re-run" re-grade. The decorative RUN
// ON EXPORT toggle + Add-skill row match the comp. Rendered only when the disclosure above is expanded.
function skillsHtml(report: readonly ISkillCheck[], docTitle: string | undefined): string {
	if (!report.length) {
		return `<div style="font:${TYPE.secondary};color:${INK.meta};padding:8px 2px">Open a Living Document to see the Skills that run on it.</div>`;
	}
	const icons: Record<string, { glyph: string; bg: string; fg: string }> = {
		strategy: { glyph: '&#9672;', bg: AMBER.bg, fg: AMBER.label },
		financial: { glyph: '&#8721;', bg: GREEN.bg, fg: GREEN.base },
		formatting: { glyph: '&#182;', bg: PAPER.chip, fg: INK.body },
	};
	// The verdict badge: mono, coloured by what the verdict MEANS - green passed, amber wants you, meta says
	// nothing can be said yet, indigo means Abstract can act. No fill, per the kind-badge rule (doc 28).
	const badge = (s: ISkillCheck): string => {
		const m: Record<string, { label: string; color: string }> = {
			pass: { label: 'PASS', color: GREEN.base },
			flag: { label: 'FLAG', color: AMBER.label },
			'needs-model': { label: 'NO MODEL', color: INK.meta },
			ready: { label: 'READY', color: INDIGO.base },
		};
		const b = m[s.status];
		return `<span style="margin-left:auto;font:400 10px/1 ${FONT.mono};letter-spacing:${TRACKING.kindBadge};color:${b.color};flex:none">${b.label}</span>`;
	};
	const runBtn = (s: ISkillCheck): string => s.canRun
		? `<button data-skill-run="${s.id}" style="border:1px solid ${PAPER.control};border-radius:7px;padding:5px 12px;background:${PAPER.card};color:${INK.body};font:400 12.5px/1.4 ${FONT.sans};cursor:pointer">${s.status === 'pass' ? 'Re-run' : 'Run'}</button>`
		: '';
	// "Apply fix" appears on a flagged skill that carries a deterministic edit (Formatting heading-case);
	// it is the primary action, so it takes the right-aligned slot with Run beside it.
	const fixBtn = (s: ISkillCheck): string => (s.fixable && s.status === 'flag')
		? `<button data-skill-fix="${s.id}" style="margin-left:auto;border:none;border-radius:7px;padding:5px 15px;background:${INDIGO.base};color:#fff;font:600 12.5px/1.4 ${FONT.sans};cursor:pointer">Apply fix</button>`
		: '';
	const card = (s: ISkillCheck): string => {
		// A flagged skill paints its kind on a 3px left edge (doc 28) rather than thickening its whole border,
		// which used to make the card itself read as the alarm.
		const edge = s.status === 'flag' ? `border-left:3px solid ${AMBER.base};` : '';
		const ic = icons[s.id];
		const detailColor = s.status === 'flag' ? INK.body : INK.meta;
		return `<div style="border:1px solid ${HAIRLINE.strong};${edge}border-radius:${RADIUS.card};overflow:hidden;margin-bottom:11px;background:${PAPER.card}">`
			+ `<div style="display:flex;align-items:center;gap:9px;padding:11px 13px"><span style="width:28px;height:28px;flex:none;border-radius:${RADIUS.control};background:${ic.bg};color:${ic.fg};font-size:14px;display:flex;align-items:center;justify-content:center">${ic.glyph}</span><div style="min-width:0"><div style="font:${TYPE.uiBodyStrong};color:${INK.heading}">${esc(s.name)}</div><div style="font:400 11.5px/1.4 ${FONT.sans};color:${INK.meta}">${esc(s.blurb)}</div></div>${badge(s)}</div>`
			+ `<div style="margin:0 13px;border-top:1px solid ${HAIRLINE.soft};padding:10px 0;display:flex;align-items:center;gap:8px"><span style="flex:1;font:400 12px/1.45 ${FONT.sans};color:${detailColor}">${esc(s.detail)}</span>${fixBtn(s)}${runBtn(s)}</div></div>`;
	};
	const sub = docTitle ? `Skills that run on ${esc(docTitle)} - on demand or before export.` : 'Skills that run on this document.';
	// The "DOCUMENT AGENTS" label lives on the disclosure toggle (checksDisclosureHtml) now, so this body
	// starts straight at the sub-line. The whole body only renders when the disclosure is expanded.
	return `<div style="display:flex;flex-direction:column;padding-top:11px">
	<div style="font:${TYPE.secondary};color:${INK.meta};padding:0 2px 14px">${sub}</div>
	${report.map(card).join('')}
	<div style="font:400 11px/1 ${FONT.mono};letter-spacing:${TRACKING.sectionLabel};color:${INK.meta};padding:0 2px 8px">RUN ON EXPORT</div>
	<div style="display:flex;align-items:center;gap:9px;border:1px solid ${HAIRLINE.strong};background:${PAPER.card};border-radius:${RADIUS.input};padding:10px 12px;margin-bottom:14px"><span style="font:400 12.5px/1.4 ${FONT.sans};color:${INK.body}">Formatting + Financial</span><span style="margin-left:auto;width:34px;height:20px;border-radius:${RADIUS.pill};background:${INDIGO.base};position:relative;flex:none"><span style="position:absolute;top:2px;right:2px;width:16px;height:16px;border-radius:${RADIUS.pill};background:${PAPER.card}"></span></span></div>
	<button style="width:100%;border:1px dashed ${PAPER.frameBorder};background:${PAPER.card};border-radius:${RADIUS.control};padding:9px;font:400 12.5px/1.4 ${FONT.sans};color:${INK.secondary};cursor:pointer">&#65291; Add skill from library</button>
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
		this._list.style.cssText = `display:none;position:absolute;left:9px;right:9px;bottom:calc(100% + 4px);z-index:10;margin:0;padding:4px;list-style:none;max-height:184px;overflow-y:auto;background:${PAPER.card};border:1px solid ${HAIRLINE.strong};border-radius:${RADIUS.input};box-shadow:${SHADOW.dialog}`;
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
			item.style.cssText = `font:400 11.5px/1 ${FONT.mono};color:${INDIGO.base};border-radius:6px;padding:6px 8px;cursor:pointer;${selected ? `background:${INDIGO.tint}` : ''}`;
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
