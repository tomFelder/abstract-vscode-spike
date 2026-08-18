#!/usr/bin/env bash
#
# check-seams.sh - the executable re-pin gate for the merge-tax ledger's shell seams.
#
# The Abstract fork de-IDEs VS Code almost entirely through the cheap tiers (settings, theme,
# styleOverrides CSS, additive contributions), but a handful of seams DO couple to upstream core
# and a bad rebase can silently re-expose the IDE (see docs/plans/03-merge-tax-ledger.md, "Where
# the residual tax actually lives"). Most fail *soft* (cosmetic), a few fail *unsafe* (the IDE
# reappears). This script asserts each seam mechanically so the checklist is executable, not tribal
# knowledge. It exits non-zero naming the first broken seam.
#
# Run from anywhere; it resolves the repo root itself. Wire it next to valid-layers-check.
#
# Usage: ./scripts/check-seams.sh

set -u

# Resolve repo root (this script lives in <root>/scripts).
if [[ "${OSTYPE:-}" == "darwin"* ]]; then
	_abspath() { [[ $1 = /* ]] && echo "$1" || echo "$PWD/${1#./}"; }
	ROOT=$(dirname "$(dirname "$(_abspath "$0")")")
else
	ROOT=$(dirname "$(dirname "$(readlink -f "$0")")")
fi
cd "$ROOT" || { echo "check-seams: cannot cd to repo root" >&2; exit 2; }

FAILURES=0

# fail SEAM MESSAGE - record a broken seam and keep going so one run reports every break.
fail() {
	echo "  FAIL [$1] $2" >&2
	FAILURES=$((FAILURES + 1))
}

# grep_has FILE PATTERN - true when PATTERN (extended regex) is found in FILE.
grep_has() { grep -Eq -- "$2" "$1" 2>/dev/null; }

LDC="src/vs/workbench/contrib/livingDocs/browser/livingDocs.contribution.ts"
STUDIO_CSS="src/vs/workbench/contrib/styleOverrides/browser/media/studio.css"
ELEVATION_CSS="src/vs/workbench/contrib/styleOverrides/browser/media/elevation.css"
FLOATING_PANELS_CSS="src/vs/workbench/browser/media/floatingPanels.css"
LAYOUT_SERVICE="src/vs/workbench/services/layout/browser/layoutService.ts"
EDITOR_PART="src/vs/workbench/browser/parts/editor/editorPart.ts"
PANE_COMPOSITE_PART="src/vs/workbench/browser/parts/paneCompositePart.ts"
ACTIVITYBAR="src/vs/workbench/browser/parts/activitybar/activitybarPart.ts"
WINDOW_TS="src/vs/platform/window/common/window.ts"
TITLEBAR_PART="src/vs/workbench/browser/parts/titlebar/titlebarPart.ts"
BUILTIN_SCANNER="src/vs/workbench/services/extensionManagement/browser/builtinExtensionsScannerService.ts"
CMD_PALETTE="src/vs/workbench/contrib/quickaccess/browser/commandsQuickAccess.ts"
QUICK_OPEN="src/vs/workbench/browser/actions/quickAccessActions.ts"
VIEWS_COMMON="src/vs/workbench/common/views.ts"
VIEWS_EXT_POINT="src/vs/workbench/api/browser/viewsExtensionPoint.ts"
EXTENSIONS_VIEWLET="src/vs/workbench/contrib/extensions/browser/extensionsViewlet.ts"
WORKBENCH_HTML="src/vs/code/electron-browser/workbench/workbench.html"
WORKBENCH_DEV_HTML="src/vs/code/electron-browser/workbench/workbench-dev.html"

echo "check-seams: verifying the merge-tax ledger's shell seams..."

# --- Seam 1: the five deregistered IDE view containers (HIGH / fails UNSAFE - the IDE icon reappears) ---
# Each id must (a) be present in our deregister list, and (b) still be registered upstream somewhere
# OTHER than our contribution (so the deregister still targets a real container). If upstream renames
# a container, (b) fails here loudly instead of the icon silently returning to the activity bar.
CONTAINER_IDS=(workbench.view.explorer workbench.view.search workbench.view.scm workbench.view.debug workbench.view.extensions)
for id in "${CONTAINER_IDS[@]}"; do
	if ! grep_has "$LDC" "'${id}'"; then
		fail "deregister-list" "container id '${id}' is missing from IDE_VIEW_CONTAINER_IDS in $LDC"
	fi
	# "still exists upstream": the id appears in at least one core file that is NOT our contribution.
	if ! grep -Erq --include=*.ts -- "'${id}'" src/vs --exclude-dir=livingDocs; then
		fail "deregister-upstream" "container id '${id}' no longer appears upstream - the deregister may target a renamed/removed container"
	fi
done
# The deregister loop itself must still run over the list.
if ! grep_has "$LDC" "for \(const id of IDE_VIEW_CONTAINER_IDS\)"; then
	fail "deregister-loop" "the IDE_VIEW_CONTAINER_IDS deregister loop is gone from $LDC"
fi

# --- Seam 2: the 76px activity-bar width (core-patch, v2 iter 9) ---
if ! grep_has "$ACTIVITYBAR" "ACTIVITYBAR_WIDTH = 76"; then
	fail "activitybar-width" "ACTIVITYBAR_WIDTH is no longer 76 in $ACTIVITYBAR (the labeled 76px nav layout will break)"
fi

# --- Seam 3: the builtin-extension denylist (core-patch, v2 iter 6) ---
for id in vscode.emmet vscode.git-base vscode.merge-conflict; do
	if ! grep_has "$BUILTIN_SCANNER" "$id"; then
		fail "builtin-denylist" "'${id}' is missing from LIVING_DOCS_EXCLUDED_BUILTINS in $BUILTIN_SCANNER"
	fi
done
if ! grep_has "$BUILTIN_SCANNER" "bundledExtensions = bundledExtensions\.filter"; then
	fail "builtin-denylist-filter" "the LIVING_DOCS_EXCLUDED_BUILTINS filter is gone from $BUILTIN_SCANNER (excluded builtins will 404 again)"
fi

# --- Seam 4: the palette + quick-open keybindings stay REMOVED (core-patch, v3 iter 2) ---
# ShowAllCommandsAction must carry f1:false and NOT re-register a keybinding (Cmd/Ctrl+Shift+P, F1).
if ! grep_has "$CMD_PALETTE" "f1: false"; then
	fail "palette-f1" "ShowAllCommandsAction no longer sets f1:false in $CMD_PALETTE (the command palette re-lists)"
fi
# A rebase that restores keybinding wiring would add KeybindingsRegistry / a keybinding to this action's
# constructor - guard against the palette chord returning.
if grep -A12 "class ShowAllCommandsAction" "$CMD_PALETTE" | grep -Eq "keybinding:|primary:|KeyMod\."; then
	fail "palette-keybinding" "a keybinding reappeared on ShowAllCommandsAction in $CMD_PALETTE (Cmd+Shift+P / F1 back)"
fi
# Quick Open (Go to File) must keep f1:false so command mode (the '>' prefix) is unreachable.
if ! grep -A20 "id: 'workbench.action.quickOpen'," "$QUICK_OPEN" | grep -q "f1: false"; then
	fail "quickopen-f1" "workbench.action.quickOpen no longer sets f1:false in $QUICK_OPEN (Cmd+P / command mode back)"
fi

# --- Seam 5 (RETIRED, issue #173): the global sash lock is intentionally GONE. sash.ts is back to
# upstream stock and the rails are user-resizable by design, so there is no seam to re-pin here. ---

# --- Seam 6: the studio.css chrome-removal + labeled-nav selectors (styleOverrides, fail-soft) ---
STUDIO_SELECTORS=(
	".editor-group-watermark"
	".editor-group-container > .title"
	".part.auxiliarybar > .composite.title"
	".part.activitybar"
)
for sel in "${STUDIO_SELECTORS[@]}"; do
	if ! grep -Fq -- "$sel" "$STUDIO_CSS"; then
		fail "studio-css" "the studio.css selector '${sel}' is gone (residual IDE chrome may show through)"
	fi
done

# --- Seam 7: the shell-identity config defaults (settings, plan 33 iters 1-2, fail-soft) ---
# (plan 44-b) window.commandCenter is now `true`, not `false`: the 48px Abstract header repurposes the
# title bar (decision 170), which is hidden in web when "empty", so the command centre is enabled to keep
# the title bar visible - its stock UI is then hidden by studio.css's `.abstract-header` rules. Re-pin: if
# a rebase resets this to false the title bar goes empty and the Abstract header disappears in web.
IDENTITY_DEFAULTS=(
	"'window.commandCenter': true"
	"'workbench.layoutControl.enabled': false"
	"'workbench.editor.editorActionsLocation': 'hidden'"
)
for def in "${IDENTITY_DEFAULTS[@]}"; do
	if ! grep -Fq -- "$def" "$LDC"; then
		fail "identity-defaults" "the config default \"${def}\" is gone from $LDC (title-bar IDE chrome returns)"
	fi
done
if ! grep_has "$LDC" "'window.title':"; then
	fail "window-title" "the branded window.title default is gone from $LDC"
fi
# The project-name marker stays hidden plumbing (plan 33 iter 2).
if ! grep_has "$LDC" "\.abstract-name"; then
	fail "project-name-marker" "the .abstract-name files.exclude default is gone from $LDC (the marker leaks into the file list)"
fi

# --- Seam 8: IDE chords stay neutralised on our surfaces (additive contribution, plan 33 iter 3) ---
# The keyboard audit neutralises the leaking IDE chords via a shadowing no-op keybinding contribution.
if ! grep_has "$LDC" "NeutraliseIdeChords|neutralise.*[Cc]hord|lwd.noop|livingDocs\.noopChord"; then
	fail "ide-chord-neutralise" "the IDE-chord neutralisation (plan 33 iter 3) is gone from $LDC (Cmd+J panel / terminal chords leak again)"
fi

# --- Seam 9: the v2 elevation model (plan 44-a, ledger row V2-1). The elevation.css cards RIDE the
# core "floating panels" feature (browser/media/floatingPanels.css + AbstractPaneCompositePart, which
# reserves FLOATING_PANEL_MARGIN so the card content never clips) and re-skin it (chrome backdrop,
# radius 14, #E9EAEE border, rail/paper bg, shadow-rail/shadow-editor), gating on the `.floating-panels`
# class core toggles when modernUI is on. If a rebase renames that class or removes the feature, the
# cards silently lose their gaps/dims - this asserts the coupling loudly. ---
if ! grep_has "$ELEVATION_CSS" "floating-panels"; then
	fail "elevation-floating-panels" "elevation.css no longer gates on the core .floating-panels class ($ELEVATION_CSS) - the v2 cards ride that feature; re-pin per ledger V2-1"
fi
# The core feature the elevation cards ride must still exist and still toggle that class.
if ! grep_has "$FLOATING_PANELS_CSS" "floating-panels .part.sidebar"; then
	fail "floating-panels-feature" "the core floating-panels card feature is gone/renamed in $FLOATING_PANELS_CSS (the v2 elevation cards lose their margins + content-dim sync)"
fi
# The elevation chrome + card tokens must stay pinned to the plan-43 section 1 values.
for token in "#EDEFF3" "#E9EAEE" "0 8px 28px -14px rgba\(20, 22, 28, .22\)" "0 12px 36px -16px rgba\(20, 22, 28, .26\)"; do
	if ! grep_has "$ELEVATION_CSS" "$token"; then
		fail "elevation-tokens" "the elevation token '${token}' is gone from $ELEVATION_CSS (v2 chrome/card/shadow drifted from plan 43 section 1)"
	fi
done

# --- Seam 9b: the v2 12px top/bottom frame inset (plan 44-a round 2, ledger row V2-1: the ONE core
# seam of the wave, PENDING-merge). Stock floating panels keep the cards flush under the title bar
# (0px top) and give the editor a single 6px bottom gap; the elevation model floats the whole stack
# 12px clear of the top + bottom frame edges. This is a REAL core coupling: a CSS-only margin would
# clip card contents, so the reservation lives in core (FLOATING_PANEL_MODERN_FRAME_INSET in
# layoutService.ts, consumed by editorPart + paneCompositePart) and MUST stay in lock-step with the
# margin in elevation.css. If a rebase drops the constant, its consumers, or the CSS margins, the top
# frame edge silently returns to 0px (P1.2 defect) - assert every leg of the coupling loudly. ---
if ! grep_has "$LAYOUT_SERVICE" "FLOATING_PANEL_MODERN_FRAME_INSET = 12"; then
	fail "frame-inset-constant" "FLOATING_PANEL_MODERN_FRAME_INSET is no longer 12 in $LAYOUT_SERVICE (the v2 12px top/bottom frame inset drifts; re-pin per ledger V2-1)"
fi
if ! grep_has "$EDITOR_PART" "FLOATING_PANEL_MODERN_FRAME_INSET"; then
	fail "frame-inset-editor" "editorPart no longer reserves FLOATING_PANEL_MODERN_FRAME_INSET ($EDITOR_PART) - the editor card contents will clip or the top inset reverts to 0px"
fi
if ! grep_has "$PANE_COMPOSITE_PART" "FLOATING_PANEL_MODERN_FRAME_INSET"; then
	fail "frame-inset-panecomposite" "paneCompositePart no longer reserves FLOATING_PANEL_MODERN_FRAME_INSET ($PANE_COMPOSITE_PART) - the rail cards will clip or the top inset reverts to 0px"
fi
# The matching CSS margins must stay in elevation.css or the reserved space shows as an empty gap.
if ! grep_has "$ELEVATION_CSS" "margin-top: var\(--vscode-spacing-size120"; then
	fail "frame-inset-css" "the 12px top/bottom card margin is gone from $ELEVATION_CSS (core reserves the space but the cards no longer float clear of the frame edges)"
fi

# --- Seam 10: the 48px Abstract header (plan 44-b, ledger row V2-2 - the wave's SECOND + final core seam,
# decision 169/170). The header repurposes the title bar part; its 48px height is the grid slot the layout
# reserves for the part, so a CSS-only height would clip. One fork constant (ABSTRACT_HEADER_HEIGHT = 48 in
# window.ts) lifts the reserved height, consumed in BrowserTitlebarPart.minimumHeight - the ACTIVITYBAR_WIDTH
# 48->76 precedent. If a rebase drops the constant or its consumer the header shrinks to the stock 35px and
# clips; if the title-bar visibility default or the studio.css overlay go, the header disappears - assert
# every leg loudly. ---
if ! grep_has "$WINDOW_TS" "ABSTRACT_HEADER_HEIGHT = 48"; then
	fail "header-height-constant" "ABSTRACT_HEADER_HEIGHT is no longer 48 in $WINDOW_TS (the 48px Abstract header shrinks to the stock title bar height; re-pin per ledger V2-2)"
fi
if ! grep_has "$TITLEBAR_PART" "ABSTRACT_HEADER_HEIGHT"; then
	fail "header-height-consumer" "BrowserTitlebarPart no longer reserves ABSTRACT_HEADER_HEIGHT ($TITLEBAR_PART) - the header's grid slot reverts to 35px and clips"
fi
# The studio.css overlay + the 48px paint must stay, or the title bar shows stock chrome / the wrong height.
if ! grep_has "$STUDIO_CSS" "abstract-header"; then
	fail "header-overlay-css" "the .abstract-header rules are gone from $STUDIO_CSS (the stock title bar shows through / the Abstract header is unstyled)"
fi

# --- Seam 11: the loopback broker origins in the workbench CSP (file-reality wave #245, ledger row FR-1 -
# the ONE core seam of the wave). The desktop workbench renderer polls the local model broker over plain
# http on 8090 (DEFAULT_PROXY_URL = http://localhost:8090); the stock connect-src is `'self' https: ws:`
# which blocks the fetch before a socket opens, so the packaged app reports "Model unavailable" and every
# broker-backed feature (model calls, docx import/export) is dead. Both workbench html files must carry the
# two exact loopback origins in connect-src. If a rebase drops either line the packaged app silently loses
# the broker again - assert both files, both origins, loudly. ---
for html in "$WORKBENCH_HTML" "$WORKBENCH_DEV_HTML"; do
	for origin in "http://localhost:8090" "http://127.0.0.1:8090"; do
		if ! grep_has "$html" "$origin"; then
			fail "csp-broker-origin" "the loopback broker origin '${origin}' is missing from connect-src in $html (the packaged workbench renderer cannot reach its own model broker; re-pin per ledger FR-1)"
		fi
	done
done

# --- Seam 12: the curated Manage (gear) + Accounts menus (issue #260, WP-I, additive contribution) ---
# CurateShellMenusContribution shadows the stock GlobalActivity gear + AccountsContext Accounts entries out of
# the calm shell by id, and re-lists the demoted stock power tools under an Advanced submenu. The gear side hides
# "everything not in a fork group", so a renamed stock gear entry is hidden by default (fail-safe, no re-pin
# needed). The Accounts side + the Advanced re-list target ids by exact string, so a rebase that renames one
# would silently either leak the stock Accounts entry or drop the Advanced re-list. Assert (a) the ids are still
# referenced in our contribution, and (b) still exist upstream OUTSIDE our contribution, so a rename fails here
# loudly instead of regressing the shell. Fails soft (the affected entry re-leaks / drops, not the whole shell).
WP_I_IDS=(
	# Accounts stock entries we shadow (leak 4).
	"_manageAccountPreferencesForExtension"
	"workbench.action.chat.manageLanguageModelAuthentication"
	# Stock power tools re-listed under Advanced (must keep working as the explicit stock route).
	"workbench.action.openSettings"
	"workbench.action.showCommands"
	"workbench.action.openGlobalKeybindings"
)
for id in "${WP_I_IDS[@]}"; do
	if ! grep_has "$LDC" "'${id}'"; then
		fail "shell-menu-curation" "command id '${id}' is missing from CurateShellMenusContribution in $LDC (a shadowed Accounts entry may re-leak, or the Advanced re-list may drop; re-pin per WP-I / issue #260)"
	fi
	if ! grep -Erq --include=*.ts -- "'${id}'" src/vs --exclude-dir=livingDocs; then
		fail "shell-menu-curation-upstream" "command id '${id}' no longer appears upstream - the WP-I gear/Accounts curation may target a renamed/removed command"
	fi
done
# The curation contribution + its re-apply-on-change wiring must still be present (some stock gear entries are
# registered late, so the one-shot pass alone would miss them).
if ! grep_has "$LDC" "class CurateShellMenusContribution"; then
	fail "shell-menu-curation-contrib" "CurateShellMenusContribution is gone from $LDC (the gear + Accounts menus re-leak the stock IDE)"
fi
if ! grep_has "$LDC" "MenuRegistry\.onDidChangeMenu"; then
	fail "shell-menu-curation-reapply" "the onDidChangeMenu re-apply is gone from $LDC (late-registered stock gear entries would leak)"
fi

# --- Seam 12b: the curated command-palette DEFAULT VIEW + the two settings chords (issue #260, WP-I, V-1/V-2) ---
# The same contribution shadows the stock command-palette wall (MenuId.CommandPalette) behind the palette-advanced
# key, keeping the default view Abstract-led, and re-owns Cmd+, / Cmd+K Cmd+S. Assert the palette curation wiring +
# the explicit "All Commands" lift route + the two chord re-owns are present, so a regression fails here loudly.
if ! grep_has "$LDC" "MenuId\.CommandPalette"; then
	fail "palette-default-curation" "the CommandPalette default-view shadow is gone from $LDC (the stock developer wall re-leaks as the palette's first screen; re-pin per WP-I V-2 / issue #260)"
fi
if ! grep_has "$LDC" "'livingDocs\.palette\.allCommands'"; then
	fail "palette-advanced-route" "the explicit 'All Commands' stock route is gone from $LDC (the demoted palette wall becomes unreachable; re-pin per WP-I V-2)"
fi
# Cmd+, must be re-owned onto Model Access (livingDocs.open.settings) and Cmd+K Cmd+S neutralised - both at the
# weight-1000 chord tier - so the universal settings chords no longer bypass the curated gear door (V-1). The Cmd+,
# rebind carries a KeyCode.Comma primary; the Cmd+K Cmd+S neutralisation carries the exact chord constant.
if ! grep_has "$LDC" "KeyMod\.CtrlCmd \| KeyCode\.Comma"; then
	fail "settings-chord-comma" "Cmd+, is no longer re-owned onto Model Access in $LDC (the stock Settings editor re-collides as the universal settings chord; re-pin per WP-I V-1 / issue #260)"
fi
if ! grep_has "$LDC" "KeyChord\(KeyMod\.CtrlCmd \| KeyCode\.KeyK, KeyMod\.CtrlCmd \| KeyCode\.KeyS\)"; then
	fail "settings-chord-keybindings" "Cmd+K Cmd+S is no longer neutralised in $LDC (the stock Keyboard Shortcuts editor re-opens on the bare chord; re-pin per WP-I V-1)"
fi

# --- Seam 13: the missing-view-container guards that seam 1's deregisters require (core-patch) ---
# Deregistering the stock containers (seam 1) breaks two upstream assumptions that a container is
# always there: the extension-views fallback resolved the Explorer by hard-coded id + `!`, and the
# extensions viewlet resolved its own container the same way. Both threw on every boot, and the
# first throw aborted the whole extension-views handler - so NO extension-contributed view was
# registered at all. Fails soft (boot errors return, extension views are lost again), so assert all
# three legs.
if ! grep_has "$VIEWS_EXT_POINT" "getDefaultViewContainers\(ViewContainerLocation\.Sidebar\)"; then
	fail "views-fallback-default-container" "the extension-views fallback in $VIEWS_EXT_POINT no longer resolves the registered default sidebar container (a hard-coded Explorer id returns undefined here and throws on boot; re-pin per the missing-container round in docs/plans/03-merge-tax-ledger.md)"
fi
if ! grep_has "$VIEWS_EXT_POINT" "ViewContainerDoesnotExistNoFallback"; then
	fail "views-fallback-no-container" "the 'no default container at all' branch is gone from $VIEWS_EXT_POINT (views would be registered against undefined again)"
fi
if ! grep_has "$EXTENSIONS_VIEWLET" "if \(container\) \{"; then
	fail "extensions-viewlet-container-guard" "ExtensionsViewletViewsContribution in $EXTENSIONS_VIEWLET no longer guards on its view container existing (it registers views against undefined once seam 1 deregisters workbench.view.extensions)"
fi
if ! grep_has "$VIEWS_COMMON" "defaultViewContainers\.splice"; then
	fail "deregister-clears-default" "deregisterViewContainer in $VIEWS_COMMON no longer clears the default registration (a deregistered container can be handed back as the fallback)"
fi

echo ""
if [[ $FAILURES -eq 0 ]]; then
	echo "check-seams: OK - all shell seams intact."
	exit 0
else
	echo "check-seams: ${FAILURES} broken seam(s) - re-pin per docs/plans/03-merge-tax-ledger.md before shipping." >&2
	exit 1
fi
