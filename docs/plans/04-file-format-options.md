# Canonical file-format options (open decision — do NOT silently pick)

This memo exists to *frame*, not settle, the canonical-format question for Living Documents (open
question **Q1** in `docs/05-open-questions.md`). The decision is deferred on purpose — it is downstream
of two bigger calls (the WYSIWYG-editor depth, and fork-vs-greenfield). What ships now is the low-risk,
reversible step: a **"Download as Markdown"** export (Item G) that flattens a document's *resolved*
state to a clean static `.md`.

## The tension
We want the canonical document to be persistent, human-editable Markdown — portable, hand-editable,
Obsidian-openable, git-diffable, agent-native. But linking + annotation + inference add metadata that
raw Markdown can't hold cleanly. The spike's `.living.md` already smuggles bindings into HTML comments,
shows `{cell}` templates on disk, and keeps provenance in a sidecar `.audit.json`. The richer the
document gets, the more the raw Markdown is "ruined" by the metadata it has to carry.

## The three options

### 1. Markdown-primary with comment metadata (current spike choice)
The `.living.md` is canonical; bindings live in `<!-- bind ... -->` / `<!-- table ... -->` comments,
provenance in a `.audit.json` sidecar.
- **Pros:** portable-ish, hand-editable, git-diffable, agent-native, opens in any Markdown viewer.
- **Cons:** fragile metadata (a hand-edit can break a binding), `{cell}` placeholders visible on disk,
  no in-file provenance, awkward fit once documents get rich (tables, nested structure, comments).

### 2. JSON / LDOC-primary; Markdown as export-only
Canonical is structured JSON (blocks, bindings, provenance, audit inline). Markdown becomes a
flatten-export (the Item G "Download as Markdown" / the HTML export), produced on demand.
- **Pros:** clean lossless model for a real WYSIWYG editor; no comment-smuggling; provenance is first-class.
- **Cons:** not hand-editable, not an Obsidian source-of-truth, not git-diff-friendly as prose.

### 3. Hybrid: clean Markdown body + `.ldoc.json` sidecar keyed by stable block anchors
Prose stays clean Markdown; a sidecar holds bindings/provenance keyed by stable per-block anchors.
- **Pros:** clean portable Markdown *and* lossless metadata.
- **Cons:** two files to keep in sync; the hard part is stable block-anchoring that survives external
  edits to the Markdown.

## Coupling (why it's deferred)
- **WYSIWYG editor depth (Q2):** a real block editor (vs the current contenteditable spike) makes
  option 2/3 far more natural; staying contenteditable keeps option 1 pragmatic.
- **Fork-vs-greenfield (Q3):** for a greenfield web app, option 2 or 3 is cleaner; for the fork spike,
  option 1 was the fastest way to prove the engine.

## Recommendation
Defer the canonical-format pick. Ship the **"Download as Markdown"** export now (done — Item G): it
flattens the resolved document to a clean static `.md` (no bindings, no `{cell}` placeholders, live
values inlined) and is useful under *any* of the three options. Revisit the canonical format once the
WYSIWYG-editor and fork-vs-greenfield decisions are made — the current lean is **Markdown-primary now,
move canonical to option 2/3 if/when the editor becomes a real block editor.**
