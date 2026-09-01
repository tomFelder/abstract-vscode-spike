---
number: 56
status: "**Done (plan 16 iter 3, branch `calm-surface-3`, PR → `calm-surface-2`).** Tier: **our-surface, 0 core patches** (template in `livingDocsService.ts`; `focusPm` in `livingDocRender.ts`; `focus()` override in `livingDocEditor.ts`). Verified live web (code-web): New document → blank PM surface, \"Markdown\" crumb, writable. **Desktop disk smoke (decision 38, `TMPDIR=/tmp`, fresh folder):** the empty-state \"New document\" created `Untitled.md` on **real disk** containing only a newline (no `title:`, no boilerplate); typing persisted it as **clean plain Markdown** (`Q3 Planning Notes for the launch`) — re-read from disk. HOLD re-verified live: the living doc still opens in PM with the calm toolbar + bound figure `49800` (U1/U2/G2/G5), the PM editor reports `focused`. _Observed (flagged for iter 6 polish, not introduced here): the calm formatting toolbar shows for living docs but not for a blank plain doc._"
provenance: "plan 16"
source: docs/07-decision-log.md
---

# A new document is a blank writing surface

**The document-first on-ramp: a new doc is a BLANK writing surface that opens focused; keep Home as the friendly landing**

Iter 3 makes "just start writing" the on-ramp. (a) **New document → blank surface.** `createDocument` already created + opened the `.md` in one action, but the `NEW_DOCUMENT_TEMPLATE` injected `---\ntitle: Untitled document\n---` + a "## Overview / Write your document here…" boilerplate — IDE-template muscle memory, not a calm writing surface. Replaced it with a single newline so the doc opens **blank** (one empty ProseMirror paragraph), no frontmatter, no boilerplate; the user types their title as the first line (name-on-first-save deferred — the file is already uniquely named `Untitled.md`). (b) **Cursor ready.** Nothing focused the editor on open, so a new doc needed a click before typing. Added `pmView.focus()` on PM mount (`livingDocRender` `focusPm`, fires once per mount — decision 50's mount-once means re-renders never steal the caret) + a `LivingDocEditor.focus()` override that forwards pane focus into the webview iframe so the in-iframe focus actually lands. (c) **Landing.** Considered opening the last/blank doc at startup, but kept the **Home dashboard** as the landing — it is the friendly, designed on-ramp (recents + New document + empty-state), not the "bare Explorer" the plan warns against.
