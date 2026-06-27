# Plan 15 — iteration 6 prompt: chat on every doc + F7 fresh-project end-to-end

Handoff prompt for the next `/loop` iteration of [15-unify-editor-f7-loop.md](15-unify-editor-f7-loop.md).
Iters 1–5 are done (PRs #25/#26/#27 merged; **#28 is the iter-5 flip**, awaiting merge). Paste the block
below into a fresh session **after #28 is merged to `main`** (branch off a current main).

State of play after iter 5 (the flip): **ProseMirror is the single editing surface for every `.md`.** A
living doc opens straight into PM with the calm chrome (formatting toolbar wired to `LWDPM.cmd`, Present,
sync bar, source drawer); `renderDoc` is gone; `LivingDocViewMode` is `'raw' | 'pm'`. All of U1/U2/U3 and
F1–F6/F8 pass live **on the flipped PM default**, plus a desktop `code.sh` real-disk smoke. Decisions 46–53
are settled — **don't re-litigate.** The ONE remaining gate is **F7 — the whole loop from a *freshly
created* doc** — and it is blocked by exactly one thing: **chat is still gated to living documents**
(decision 48 not yet wired). A brand-new doc is plain, so it opens in PM but has no chat.

---

Run iteration 6 of the editor-unification /loop (docs/plans/15-unify-editor-f7-loop.md). Iters 1–5 are
MERGED to main; branch off a current main. **This iteration closes F7 by wiring decision 48
(chat-on-every-doc) and then verifying the fresh-project loop end-to-end.** In order:

1. **Drop the `isLiving` chat gate (decision 48 — "living" is just a data-binding badge, never a gate on
   chat).** Make chat work on ANY open `.md`, plain or living:
   - `livingDocsService.ts` `sendChatMessage` (~line 1427): remove the `!state.doc.isLiving` early-return
     (keep the `!state` guard and the `_hasModel()` fallback). `_chatRespond` (~1448) already builds the
     prompt from the doc body + @mentioned/`context` sources — make sure it degrades cleanly when a plain
     doc has **no `sources`/`context`** (empty source list is fine; @mention still works per decision 41).
   - Relax the proposal/pending gates that assume living: `getPendingForDoc` (~220) and the
     proposal-render path (~273) gate on `isLiving` — a chat edit/insert (decision 45) must be allowed to
     land + render its in-PM decoration on a plain doc too. (The PM decoration path itself is already
     `pmSurface`-gated, not `isLiving`-gated, after iter 5 — so the diff renders once proposals aren't
     filtered out.)
   - `reviewRailView.ts`: `_activeChatResource` (~67) returns a resource only when the doc `isLiving` →
     broaden to any open doc; the chat empty-state (~234 "Open a Living Document…") and input placeholder
     (~372) likewise. Chat is available the moment a doc is open.
   - **Keep "living" meaningful where it should be:** the sync pill / "Refresh from sources" / source
     drawer / provenance gutter stay tied to actual data bindings (a plain doc has none). Only *chat* is
     ungated. Accepting a chat insert on a plain doc keeps it plain (no binding was added) — living is
     still "has `sources:`/`context:`/bind links", per decision 48.

2. **F7 — fresh-project end-to-end, verified LIVE.** From a *newly created* folder via the **native
   Explorer** (decision 42): create a folder + a new `.md` → it opens in **ProseMirror** (the flip) →
   chat **"generate me a top-10 list"** → inline all-additions diff in the doc + the chat-rail review card
   (U3/F4/F5) → **accept** → continue the thread → **"change a couple of them"** → accept. **No CLI, no
   hand-edited Markdown.** This is the headline iteration deliverable.

3. **HOLD (regression gates — re-verify LIVE on the new chat gate):** F1–F6 + F8 on existing living docs;
   U1–U3 on the PM default; v5 R1–R6 (open/create folder, folder-reflecting Home, edit→disk,
   sources/context/@mention); the design gates (G1 one quiet surface, G2 calm header, G5 detached gutter +
   inline figures, G6 nav never blanks / no dev toasts, G4-as-revised). Confirm ungating chat did **not**
   light up sync/figure affordances on plain docs.

4. **Desktop `code.sh` disk smoke (REQUIRED, decision 38).** F7's create-folder/create-file path is the
   one v5/v6 never proved on real disk (web is memfs). Prove the **whole F7 loop on desktop, real disk**:
   create a folder + doc via the Explorer, chat-generate + accept, then **re-read the new `.md` from disk**
   and confirm the generated+accepted content is there. (Launch gotchas from iter 5: `export TMPDIR=/tmp`
   before the launch skill so the IPC `.sock` path stays < 103 chars; dismiss the Copilot sign-in +
   "Make It Yours" welcome modals on first run — living docs use the OpenRouter proxy, not Copilot.)

Method: TDD any new pure logic (e.g. the relaxed gate predicates / any new "is chat available" helper).
Rebuild the vendored bundle offline ONLY if the schema/commands change (F7 needs no bundle change —
decorations + commands already exist). Verify LIVE on a REAL folder via `code-web` + chrome-devtools with
the OpenRouter proxy running, and RE-READ disk for every write; a desktop `code.sh` smoke is REQUIRED.
Branch off main (continue the PR line). Log any core patch in the merge-tax ledger inside
docs/06-design-notes.md (target 0). Update 07-decision-log + 06-design-notes + plan 15 iter-6 log + the
`living-docs-v6-chatdoc` memory. Commit ONE change; post before/after screenshots as a PR comment.

Settled going in (don't re-ask): chat on every doc (decision 48); accepting a chat change on a plain doc
keeps it plain (living = has data bindings). STOP and ask before building only if a genuinely new
product/architecture decision appears (46–53 are settled).

**Stop when F7 passes live on a freshly created folder with OpenRouter-backed chat (create → PM-edit →
chat-generate → inline diff + card → accept → continue → accept), AND every HOLD gate still passes on the
new chat gate, AND a desktop `code.sh` smoke confirms the fresh-create + accepted-chat content on real
disk — or after the loop's 20 iterations. Then post a final readiness summary as a PR comment with the
final shots: this closes plan 15 and the v6 stop condition (all F1–F8 live on a freshly created folder +
the desktop disk smoke).**
