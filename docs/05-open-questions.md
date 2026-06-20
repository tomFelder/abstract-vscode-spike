# 05 — Open questions (unresolved decisions)

These are deliberately left open. Each is coupled to the others; resolving them prematurely would
over-commit the spike.

---

## Q1 — The file format: Markdown vs LDOC/JSON (the big one)

### The tension (in Tom's words, paraphrased)
The original hope was **"just work on top of Markdown"** — a persistent `.md` you can edit by hand,
open in **Obsidian**, share as a plain file, or hand to an agent that processes Markdown natively.
But once we **link, annotate, and infer** from other sources, the document carries metadata that
raw Markdown can't hold cleanly — so after processing, "the raw markdown just gets ruined." We don't
actually have clean Markdown anymore. So how should the canonical document be stored?

### Where the spike landed (and why it's unsatisfying)
The spike uses **`.living.md`**: Markdown with frontmatter + bindings smuggled into HTML comments +
`{cell}` templates for api blocks, with provenance/audit in a sidecar `.audit.json`. Problems:
- The on-disk file shows `{stargazers_count}` placeholders, not values — it doesn't render cleanly
  in a foreign viewer.
- HTML-comment bindings are fragile: another editor (Obsidian) or an agent could strip/reorder them,
  and block identity isn't stable across external edits.
- Provenance/diff/audit don't live in the document at all (sidecar).
- It's neither truly portable Markdown nor a good home for rich structure once WYSIWYG matures.

### The options (write-up, not yet a decision)
1. **Markdown-primary (current).** Bindings in HTML comments, sidecar for audit.
   - Pros: portable-ish, human-editable, git-diffable, agent-native, Obsidian-openable.
   - Cons: fragile metadata, placeholders on disk, no in-file provenance, poor fit for rich docs.
2. **JSON/LDOC-primary; Markdown as an export.** The canonical doc is structured JSON (blocks,
   bindings, provenance, audit inline). Markdown becomes a **"Download as Markdown"** flatten-export
   (like the HTML export) that inlines resolved values into clean static `.md` at export time.
   - Pros: clean model for rich WYSIWYG, lossless metadata, no comment-smuggling, no placeholders.
   - Cons: not hand-editable as a raw file, not an Obsidian source-of-truth, not git-diff-friendly.
3. **Hybrid: clean Markdown body + `.ldoc.json` sidecar** keyed by stable block anchors.
   - Pros: clean portable Markdown AND lossless metadata; edit the prose anywhere.
   - Cons: two files to keep in sync; **stable block anchoring across external edits is the hard
     part** (and the part most likely to break).

### Tom's current lean
Keep **persistent Markdown** for editability / Obsidian / sharing, but:
- Add a **"Download as Markdown"** action (mirroring the HTML/Docs export) that flattens to a clean
  static `.md` on demand — so "give me the Markdown" is always one click, regardless of the
  canonical format.
- Possibly move the canonical to a **JSON-attached LDOC** once it's a *real* WYSIWYG editor.
- **"Maybe it all changes once it's a proper WYSIWYG editor."** Right now the editor doesn't feel
  fully fledged, so locking the format now would be premature.

### Recommendation captured
**Defer the canonical-format decision; ship the "Download as Markdown" export now.** The choice is
downstream of two bigger decisions (the WYSIWYG editor, and fork-vs-greenfield). For a greenfield
build, option 2 or 3 is likely cleaner; for the fork spike, option 1 was the pragmatic choice and is
fine to keep. This is wired into the next plan as **ITEM G**
([plans/02](plans/02-studio-de-ide-handoff.md)).

---

## Q2 — How "real" should the editor be?

The current editor is a webview preview with `contenteditable` on non-bound prose. It is **not** a
full WYSIWYG: no rich toolbar, no block insert/move/delete, no list/table editing, no real selection
model, whole-document re-render on change. Open questions: how much editor do we actually need for
the audience (Word/Docs/Notion users expect a *lot*); and which substrate
(`contenteditable` + own model / ProseMirror / Lexical / VS Code notebook-cell primitives / custom
canvas). The full-app decision so far leans to **VS Code's own primitives** for the fork path, but
this is the decision most entangled with Q1 and Q3.

---

## Q3 — Fork VS Code, or build greenfield? (the decision the whole spike serves)

**The engine is proven on the fork.** **The shell fights the calm/non-technical north star.** The
spike quantified that the calm look is ~80% free (settings) but the last 20% — the parts users
notice — is recurring merge-tax or things we'd build ourselves anyway.

**Tom's standing assumption (not retired by the spike):** users will still feel a VS Code-derived
product is too technical; the IDE's flexibility/customization/density is wrong for an audience used
to Word/Docs/Notion; **greenfield may be the better production path.** The spike's value was proving
the engine is real and cheap to build — which *de-risks greenfield too* (we now know exactly what
engine to build, having built it once).

**This is the open question to resolve next**, informed by the upcoming "Studio" de-IDE pass: if
that pass needs many fragile core patches to approach the hi-fi, that is strong evidence for
greenfield. The merge-tax ledger in [plans/02](plans/02-studio-de-ide-handoff.md) (ITEM H) is
designed to produce exactly that evidence.
