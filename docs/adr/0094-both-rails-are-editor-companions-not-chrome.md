---
number: 94
status: "**Done (PR #85, merged to main).** 0 core patches; branch `rails-companions-clean`."
provenance: "post-redesign, PR #85"
source: docs/07-decision-log.md
---

# Both rails are editor companions, not chrome

**Both rails are EDITOR companions, not global chrome - hidden on the screen surfaces**

Tom's feedback after the redesign landed: the left tree-rail (`SIDEBAR_PART`: Files / Context / Outline / Search) and the right rail (`AUXILIARYBAR_PART`: Chat / Review / History) are companions to the DOCUMENT being edited. They belong to the editor surface only; Home / Templates / Knowledge / Agents (and the project-run / review-project screens) are separate full-width surfaces with neither rail. New `RailVisibilityContribution` (`livingDocs.contribution.ts`) shows both rails only when a `LivingDocEditor` is the active editor and hides both on every `ScreenEditorInput` surface; the 76px labeled nav (`ACTIVITYBAR_PART`) stays everywhere. Transition-based so a manual collapse while editing is respected (only re-asserts on crossing between a screen and the editor); screen surfaces re-assert hidden on a deferred tick to beat the nav-click sidebar-show race; the deferred timeout is held in a `MutableDisposable` so repeated editor changes never accumulate disposables. The unconditional rail reveals were removed from `StudioStartupContribution`. Verified live at 1440x900 (Home / Templates / Agents full-width no rails; Editor shows both).
